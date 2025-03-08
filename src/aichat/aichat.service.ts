import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import OpenAI from 'openai';
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { Card } from 'src/anki/entities/card.entity';
import { EmbeddingService } from 'src/embedding/embedding.service';
import { DataSource, Repository } from 'typeorm';
import {
  ContextMode,
  CreateChatMessageDto,
} from './dto/create-chat-message.dto';
import { ChatMessage, MessageRole } from './entities/chat-message.entity';
import { Chat, ChatStatus } from './entities/chat.entity';
import { getRetrievalUserPrompt, getSystemPrompt } from './utils/aichat.util';
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
    private embeddingService: EmbeddingService,
  ) {
    this.openai = new OpenAI({
      apiKey: this.configService.get('OPENAI_API_KEY'),
      baseURL: 'https://api.deepseek.com',
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
          relations: ['deck'],
        });

        if (!card) {
          this.logger.warn(`Card not found with ID: ${dto.cardId}`);
          throw new NotFoundException(`Card with ID ${dto.cardId} not found`);
        }

        chat = await queryRunner.manager.findOne(Chat, {
          where: { card: { id: card.id } },
          relations: ['card', 'card.deck'],
        });
        if (!chat) {
          //first time to init a chat row for a card
          chat = queryRunner.manager.create(Chat, {
            card,
            name: `Chat for Card ${card.id}`,
            status: ChatStatus.ACTIVE,
          });
          await queryRunner.manager.save(chat);
        }
        this.logger.debug(`Created new chat with ID: ${chat.id}`);
      } else if (dto.chatId) {
        chat = await queryRunner.manager.findOne(Chat, {
          where: { uuid: dto.chatId },
          relations: ['card', 'card.deck'],
        });
      }

      this.logger.debug(`Saving user message for chat ID: ${chat.id}`);
      let globalContext: string;
      if (dto.mode === ContextMode.Global) {
        console.log('chat.card.deck.id', chat);
        const similarContentWithScores =
          await this.embeddingService.searchSimilarContent(
            chat.card.deck.id,
            dto.content,
          );
        globalContext = similarContentWithScores
          .map((result) => result[0].pageContent)
          .join('\n');
        console.log('globalContext', globalContext);
      }

      const userMessage = queryRunner.manager.create(ChatMessage, {
        chat,
        content:
          dto.mode === ContextMode.Global
            ? getRetrievalUserPrompt(globalContext, dto.content)
            : dto.content,
        role: MessageRole.USER,
        model: dto.model,
      });
      await queryRunner.manager.save(userMessage);

      this.logger.debug(`Fetching message history for chat ID: ${chat.id}`);
      let history: ChatMessage[];
      if (dto.mode === ContextMode.Local) {
        //如果是基于单个卡片的对话，则需要获取最近5条消息，并且只需要获得单张卡片上下文
        history = await queryRunner.manager.find(ChatMessage, {
          where: { chat: { id: chat.id } },
          order: { createdAt: 'DESC' },
          take: 5,
        });
      } else if (dto.mode === ContextMode.Global) {
        history = await queryRunner.manager.find(ChatMessage, {
          where: { chat: { id: chat.id } },
          order: { createdAt: 'DESC' },
          take: 1,
        });
      }
      const messages: ChatCompletionMessageParam[] = [
        {
          role: 'system',
          content: getSystemPrompt(dto.mode),
        },
        ...history.reverse().map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
      ];
      this.logger.debug(`History: ${JSON.stringify(messages, null, 2)}`);

      this.logger.debug(`Calling OpenAI API with model: ${dto.model}`);
      const completion = await this.openai.chat.completions.create({
        model: dto.model,
        // max_tokens: 400,
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
