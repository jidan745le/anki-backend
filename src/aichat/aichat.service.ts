import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Chat, ChatStatus } from './entities/chat.entity';
import { ChatMessage, MessageRole } from './entities/chat-message.entity';
import { GetChatMessagesDto } from './dto/get-chat-messages.dto';
import { CreateChatMessageDto } from './dto/create-chat-message.dto';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { Card } from 'src/anki/entities/card.entity';
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

@Injectable()
export class AichatService {
  private openai: OpenAI;
  private readonly logger = new Logger(AichatService.name);

  constructor(
    @InjectRepository(Chat)
    private chatRepository: Repository<Chat>,
    @InjectRepository(ChatMessage)
    private messageRepository: Repository<ChatMessage>,
    @InjectRepository(Card)
    private cardRepository: Repository<Card>,
    private configService: ConfigService,
    private dataSource: DataSource,
  ) {
    this.openai = new OpenAI({
      apiKey: this.configService.get('OPENAI_API_KEY'),
    });
  }

  async getChatMessages(chatId: string) {
    const chat = await this.chatRepository.findOne({
      where: { uuid: chatId },
    });

    if (!chat) {
      throw new NotFoundException(`Chat with ID ${chatId} not found`);
    }

    const messages = await this.messageRepository.find({
      where: { chat: { id: chat.id } },
      order: { createdAt: 'DESC' },
    });

    return {
      messages,
    };
  }

  async createMessage(dto: CreateChatMessageDto) {
    this.logger.log(`Creating message with dto: ${JSON.stringify(dto)}`);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      let chat: Chat;
      if (dto.cardId) {
        this.logger.debug(`Creating new chat for card ID: ${dto.cardId}`);
        const card = await queryRunner.manager.findOne(Card, {
          where: { uuid: dto.cardId },
        });

        if (!card) {
          this.logger.warn(`Card not found with ID: ${dto.cardId}`);
          throw new NotFoundException(`Card with ID ${dto.cardId} not found`);
        }

        chat = await queryRunner.manager.findOne(Chat, {
          where: { card: { id: card.id } },
        });
        if (!chat) {
          chat = queryRunner.manager.create(Chat, {
            card,
            name: `Chat for Card ${card.id}`,
            status: ChatStatus.ACTIVE,
            context: `You are a text explanation assistant. You will receive two information:
            1. **html content: html content of the text**
            2. **selection: Selection information**
            **Based on this information:**
            Briefly explain the selected word, entity, or phrase, using both context from the surrounding text manifested by html content and any knowledge you can find, if necessary.
            Focus on the selection itself, not the entire context.Use clear, concise language. Assume an intelligent reader who's unfamiliar with the topic.Break down any complex terms or concepts and explain the meaning in an easy to understand way. Avoid jargon and please use english to respond`,
          });
          await queryRunner.manager.save(chat);
        }
        this.logger.debug(`Created new chat with ID: ${chat.id}`);
      }

      this.logger.debug(`Saving user message for chat ID: ${chat.id}`);
      const userMessage = queryRunner.manager.create(ChatMessage, {
        chat,
        content: dto.content,
        role: MessageRole.USER,
        model: dto.model,
      });
      await queryRunner.manager.save(userMessage);

      this.logger.debug(`Fetching message history for chat ID: ${chat.id}`);
      const history = await queryRunner.manager.find(ChatMessage, {
        where: { chat: { id: chat.id } },
        order: { createdAt: 'DESC' },
        take: 10,
      });
      const messages = [
        {
          role: 'system',
          content: chat.context || 'You are a helpful assistant.',
        },
        ...history.reverse().map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
      ];
      this.logger.debug(`History: ${JSON.stringify(messages)}`);

      this.logger.debug(`Calling OpenAI API with model: ${dto.model}`);
      const completion = await this.openai.chat.completions.create({
        model: dto.model,
        max_tokens: 400,
        temperature: 0.7,
        messages: messages as ChatCompletionMessageParam[],
      });

      this.logger.debug(`Saving AI response for chat ID: ${chat.id}`);
      const aiMessage = queryRunner.manager.create(ChatMessage, {
        chat,
        content: completion.choices[0].message.content,
        role: MessageRole.ASSISTANT,
        model: dto.model,
        promptTokens: completion.usage?.prompt_tokens,
        completionTokens: completion.usage?.completion_tokens,
        totalTokens: completion.usage?.total_tokens,
      });
      await queryRunner.manager.save(aiMessage);

      await queryRunner.commitTransaction();
      this.logger.log(`Message creation completed for chat ID: ${chat.id}`);

      return {
        userMessage,
        aiMessage,
      };
    } catch (error) {
      this.logger.error(`Error in createMessage: ${error.message}`);
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
