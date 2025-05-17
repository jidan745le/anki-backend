import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import OpenAI from 'openai';
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { Card } from 'src/anki/entities/card.entity';
import { UserCard } from 'src/anki/entities/user-cards.entity';
import { EmbeddingService } from 'src/embedding/embedding.service';
import { DataSource, Repository } from 'typeorm';
import {
  ChatContextType,
  CreateChatMessageDto,
} from './dto/create-chat-message.dto';
import { ChatMessage, MessageRole } from './entities/chat-message.entity';
import {
  generatePrompt,
  generateSimplifiedPromptDisplay,
  getRetrievalUserPrompt,
  getSystemPrompt,
} from './utils/aichat.util';
@Injectable()
export class AichatService {
  private openai: OpenAI;
  private readonly logger = new Logger(AichatService.name);
  private pendingRequests = new Map<string, Promise<any>>();

  constructor(
    @InjectRepository(ChatMessage)
    private messageRepository: Repository<ChatMessage>,
    @InjectRepository(Card)
    private cardRepository: Repository<Card>,
    @InjectRepository(UserCard)
    private userCardRepository: Repository<UserCard>,
    private configService: ConfigService,
    private dataSource: DataSource,
    private embeddingService: EmbeddingService,
  ) {
    this.openai = new OpenAI({
      apiKey: this.configService.get('OPENAI_API_KEY'),
      baseURL: 'https://api.deepseek.com',
      maxRetries: 0,
    });
  }

  async getChatMessages(cardId: string, chunkId?: string) {
    const whereCondition: any = { userCard: { uuid: cardId } };

    // 只有当chunkId有值时才添加它作为查询条件
    if (chunkId) {
      whereCondition.chunkId = chunkId;
    }

    const messages = await this.messageRepository.find({
      where: whereCondition,
      order: { createdAt: 'DESC' },
    });

    const retMessages = messages.map((message) => {
      return {
        ...message,
        content:
          message.role === MessageRole.USER && message.prompt_config
            ? generateSimplifiedPromptDisplay(message.prompt_config)
            : message.content,
      };
    });

    return {
      messages: retMessages,
    };
  }

  async createMessage(dto: CreateChatMessageDto) {
    this.logger.log(
      `Attempting to create message with dto: ${JSON.stringify(dto)}`,
    );

    const idempotencyKey = `${dto.cardId || 'no-card'}-${
      dto.chunkId || 'no-chunk'
    }-${dto.chatcontext}-${dto.chattype}-${dto.selectionText || ''}-${
      dto.question || ''
    }-${dto.model}`;

    if (this.pendingRequests.has(idempotencyKey)) {
      this.logger.log(
        `Request with key ${idempotencyKey} is already in progress. Returning existing promise.`,
      );
      return this.pendingRequests.get(idempotencyKey);
    }

    this.logger.log(`Processing new request with key ${idempotencyKey}.`);
    const requestPromise = this._processCreateMessage(dto)
      .catch((error) => {
        // Ensure that if _processCreateMessage throws, the error is propagated
        // and the key is still removed.
        this.pendingRequests.delete(idempotencyKey);
        this.logger.error(
          `Error in processing request ${idempotencyKey}, removed from pending. Error: ${error.message}`,
        );
        throw error; // Re-throw the error to the caller
      })
      .finally(() => {
        // Original finally might not be called if catch re-throws and isn't caught by caller of createMessage
        // However, standard Promise behavior is that finally executes regardless of catch.
        // To be safe, and ensure deletion on error path if not re-thrown and caught above.
        if (this.pendingRequests.has(idempotencyKey)) {
          this.pendingRequests.delete(idempotencyKey);
          this.logger.log(
            `Request with key ${idempotencyKey} finished (or errored and caught by caller) and removed from pending.`,
          );
        }
      });

    this.pendingRequests.set(idempotencyKey, requestPromise);
    return requestPromise;
  }

  private async _processCreateMessage(dto: CreateChatMessageDto) {
    this.logger.log(
      `_processCreateMessage called with dto: ${JSON.stringify(dto)}`,
    );

    try {
      const card = await this.userCardRepository.findOne({
        where: { uuid: dto.cardId },
        relations: ['deck'],
      });
      const cardId = card.id;
      const deckId = card.deck.id;
      let content: string;
      let globalContext: string;
      if (dto.chatcontext === ChatContextType.Deck) {
        content = generatePrompt(
          dto.chatcontext,
          dto.contextContent,
          dto.chattype,
          dto.selectionText,
          dto.question,
        );
        console.log('\n');
        console.log('content', content);
        console.log('\n');
        const contentForKeywords = `${dto.contextContent}${
          dto.selectionText ? `\n\n以及其中内容${dto.selectionText}` : ''
        }${dto.question ? `\n\n以及问题${dto.question}` : ''}`;
        console.log('contentForKeywords', contentForKeywords);
        const keywords = await this.embeddingService.generateSearchKeywords(
          contentForKeywords,
        );
        console.log('keywords', keywords);
        console.log('\n');
        const globalContextSet = new Set<string>();
        await Promise.all(
          keywords.map((keyword) =>
            this.embeddingService
              .searchSimilarContent(deckId, keyword)
              .then((similarContentWithScores) => {
                console.log(
                  'similarContentWithScores',
                  similarContentWithScores,
                );
                similarContentWithScores.forEach((result) => {
                  globalContextSet.add(result[0].pageContent);
                });
              }),
          ),
        );
        globalContext = Array.from(globalContextSet).join('\n');
        console.log('\n');
        console.log(
          'globalContext',
          Array.from(globalContextSet),
          globalContext,
        );
        console.log('\n');
      } else {
        content = generatePrompt(
          dto.chatcontext,
          dto.contextContent,
          dto.chattype,
          dto.selectionText,
          dto.question,
        );
      }

      const userMessage = {
        role: MessageRole.USER,
        content:
          dto.chatcontext === ChatContextType.Deck
            ? getRetrievalUserPrompt(globalContext, content)
            : content,
      };
      console.log('\n');
      console.log('userMessage', userMessage);
      console.log('\n');
      let history: ChatMessage[] = [];

      const whereCondition: any = { userCard: { id: cardId } };

      if (dto.chunkId) {
        whereCondition.chunkId = dto.chunkId;
      }

      history = await this.messageRepository.find({
        where: whereCondition,
        order: { createdAt: 'DESC' },
        take: 5,
      });
      console.log('history', history, dto.chunkId);

      const messages: ChatCompletionMessageParam[] = [
        {
          role: 'system',
          content: getSystemPrompt(card.deck.deckType),
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
          userCard: { id: cardId },
          chunkId: dto.chunkId || null,
          content: userMessage.content,
          role: MessageRole.USER,
          prompt_config: {
            chatcontext: dto.chatcontext,
            contextContent: dto.contextContent,
            chattype: dto.chattype,
            selectionText: dto.selectionText,
            question: dto.question,
          },
          model: dto.model,
        }),
        this.messageRepository.create({
          userCard: { id: cardId },
          chunkId: dto.chunkId || null,
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
        aiMessage: {
          role: MessageRole.ASSISTANT,
          content: completion.choices[0].message.content,
        },
      };
    } catch (error) {
      this.logger.error(`Error in _processCreateMessage: ${error.message}`);
      throw error;
    }
  }
}
