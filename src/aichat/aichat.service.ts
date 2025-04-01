import { Injectable, Logger } from '@nestjs/common';
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
import { getRetrievalUserPrompt, getSystemPrompt } from './utils/aichat.util';
@Injectable()
export class AichatService {
  private openai: OpenAI;
  private readonly logger = new Logger(AichatService.name);

  constructor(
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

  async getChatMessages(cardId: string) {
    const messages = await this.messageRepository.find({
      where: { card: { uuid: cardId } },
      order: { createdAt: 'DESC' },
    });

    return {
      messages,
    };
  }

  async createMessage(dto: CreateChatMessageDto) {
    this.logger.log(`Creating message with dto: ${JSON.stringify(dto)}`);

    try {
      // let messages: ChatMessage[];
      // if (dto.cardId) {
      //   messages = await this.messageRepository.find({
      //     where: { card: { uuid: dto.cardId }, chunkId: dto.chunkId },
      //     order: { createdAt: 'DESC' },
      //     take: 5,
      //   });
      // }
      const card = await this.cardRepository.findOne({
        where: { uuid: dto.cardId },
      });
      const cardId = card.id;

      let globalContext: string;
      if (dto.mode === ContextMode.Global) {
        const keywords = await this.embeddingService.generateSearchKeywords(
          dto.content,
        );
        console.log('keywords', keywords);
        const globalContextSet = new Set<string>();
        for (const keyword of keywords) {
          const similarContentWithScores =
            await this.embeddingService.searchSimilarContent(cardId, keyword);
          similarContentWithScores.forEach((result) => {
            globalContextSet.add(
              `${result[0].pageContent}(${result[0].metadata.start}-${result[0].metadata.end})`,
            );
          });
        }
        globalContext = Array.from(globalContextSet).join('\n');
        console.log('globalContext', globalContext);
      }

      // const userMessage = queryRunner.manager.create(ChatMessage, {
      //   chat,
      //   content:
      //     dto.mode === ContextMode.Global
      //       ? getRetrievalUserPrompt(globalContext, dto.content)
      //       : dto.content,
      //   role: MessageRole.USER,
      //   model: dto.model,
      // });
      const userMessage = {
        role: MessageRole.USER,
        content:
          dto.mode === ContextMode.Global
            ? getRetrievalUserPrompt(globalContext, dto.content)
            : dto.content,
      };

      let history: ChatMessage[] = [];
      if (dto.mode === ContextMode.Local) {
        //如果是基于单个卡片的对话，则需要获取最近5条消息，并且只需要获得单张卡片上下文
        history = await this.messageRepository.find({
          where: { card: { id: cardId }, chunkId: dto.chunkId },
          order: { createdAt: 'DESC' },
          take: 5,
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
        userMessage,
      ];
      this.logger.debug(`History: ${JSON.stringify(messages, null, 2)}`);

      this.logger.debug(`Calling OpenAI API with model: ${dto.model}`);
      const completion = await this.openai.chat.completions.create({
        model: dto.model,
        // max_tokens: 400,
        temperature: 0.7,
        messages: messages as ChatCompletionMessageParam[],
      });

      //一起插入两条 user 和 assistant 消息
      const entities = [
        this.messageRepository.create({
          card: { id: cardId },
          chunkId: dto.chunkId,
          content: dto.content,
          role: MessageRole.USER,
          model: dto.model,
        }),
        this.messageRepository.create({
          card: { id: cardId },
          chunkId: dto.chunkId,
          content: completion.choices[0].message.content,
          role: MessageRole.ASSISTANT,
          model: dto.model,
          promptTokens: completion.usage?.prompt_tokens,
          completionTokens: completion.usage?.completion_tokens,
          totalTokens: completion.usage?.total_tokens,
        }),
      ];
      await this.messageRepository.save(entities);

      return {
        userMessage,
        aiMessage: completion.choices[0].message.content,
      };
    } catch (error) {
      this.logger.error(`Error in createMessage: ${error.message}`);
      throw error;
    }
  }
}
