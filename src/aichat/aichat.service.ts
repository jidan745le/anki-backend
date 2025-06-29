import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import OpenAI from 'openai';
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { Observable, Subject } from 'rxjs';
import { Card } from 'src/anki/entities/card.entity';
import { UserCard } from 'src/anki/entities/user-cards.entity';
import { EmbeddingService } from 'src/embedding/embedding.service';
import { DataSource, In, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import {
  ChatContextType,
  ChatType,
  CreateChatMessageDto,
} from './dto/create-chat-message.dto';
import {
  AIModel,
  ChatMessage,
  MessageRole,
} from './entities/chat-message.entity';
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
  private chatSessions = new Map<
    string,
    {
      messages: ChatCompletionMessageParam[];
      userMessage: any;
      dto: CreateChatMessageDto;
      cardId: number;
      streamSubject: Subject<any>;
      content: string;
      responseComplete: boolean;
    }
  >();

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

  // 第一个接口：创建会话
  async createChatSession(dto: CreateChatMessageDto) {
    this.logger.log(`Creating chat session with dto: ${JSON.stringify(dto)}`);

    try {
      const card = await this.userCardRepository.findOne({
        where: { uuid: dto.cardId },
        relations: ['deck', 'user'],
      });
      const cardId = card.id;
      const deckId = card.deck.id;
      let content: string;
      let globalContext: string;

      if (dto.chatcontext === ChatContextType.Deck) {
        if (!card.deck.isEmbedding) {
          throw new HttpException(
            'Deck is not embedding',
            HttpStatus.BAD_REQUEST,
          );
        }
        content = generatePrompt(
          dto.chatcontext,
          dto.contextContent,
          dto.chattype,
          dto.selectionText,
          dto.question,
        );

        const contentForKeywords = `${dto.contextContent}${
          dto.selectionText ? `\n\n以及其中内容${dto.selectionText}` : ''
        }${dto.question ? `\n\n以及问题${dto.question}` : ''}`;

        console.log('contentForKeywords', contentForKeywords);

        const keywords = await this.embeddingService.generateSearchKeywords(
          contentForKeywords,
        );
        console.log('keywords', keywords);

        // 收集引用的卡片信息
        const referencedCards = new Map<
          string,
          { front: string; back: string; uuid: string }
        >();

        await Promise.all(
          keywords.map((keyword) =>
            this.embeddingService
              .searchSimilarContent(deckId, keyword)
              .then((similarContentWithScores) => {
                similarContentWithScores.forEach((result) => {
                  const doc = result[0];
                  const front = doc.metadata?.front || '未知卡片';
                  const back = doc.pageContent;
                  const uuid = doc.metadata?.uuid;
                  referencedCards.set(front, { front, back, uuid });
                });
              }),
          ),
        );
        console.log('referencedCards', referencedCards);
        //cards的uuid找出usercards的uuid
        const userCards = await this.userCardRepository.find({
          where: {
            card: {
              uuid: In(
                Array.from(referencedCards.values()).map((card) => card.uuid),
              ),
            },
            user: {
              id: card.user.id,
            },
          },
          relations: ['card', 'user'],
        });
        // console.log('userCards', userCards);
        const userCardsMap = new Map<string, string>();
        userCards.forEach((userCard) => {
          userCardsMap.set(userCard.card.uuid, userCard.uuid);
        });
        console.log('userCardsMap', userCardsMap);

        // 构建带有引用信息的上下文
        const contextWithReferences = Array.from(referencedCards.values())
          .map((c) => {
            return {
              front: c.front,
              uuid: userCardsMap.get(c.uuid),
              back: c.back,
            };
          })
          .filter((c) => c.uuid !== card.uuid)
          .map((card, index) => {
            return `引用卡片${index + 1}：「${card.front}」\n卡片ID：${
              card.uuid
            }\n内容：${card.back}`;
          })
          .join('\n\n');

        console.log('contextWithReferences', contextWithReferences);

        // 添加引用映射表
        const referenceMapping = Array.from(referencedCards.values())
          .map((c) => {
            return {
              front: c.front,
              uuid: userCardsMap.get(c.uuid),
              back: c.back,
            };
          })
          .filter((c) => c.uuid !== card.uuid)
          .map((card, index) => {
            return `- 引用卡片${index + 1} = 「${card.front}」(ID: ${
              card.uuid
            })`;
          })
          .join('\n');

        globalContext = `${contextWithReferences}\n\n=== 引用映射表 ===\n${referenceMapping}`;
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
      console.log('userMessage', userMessage);

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

      // 创建一个唯一的会话ID
      const sessionId = uuidv4();

      // 立即插入user和assistant消息到数据库
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
          content: '', // 空内容，等待流式填充
          role: MessageRole.ASSISTANT,
          model: dto.model,
          sessionId: sessionId, // 设置sessionId
        }),
      ];

      await this.messageRepository.save(entities);

      // 创建一个Subject用于流式传输
      const streamSubject = new Subject();

      // 存储会话信息
      this.chatSessions.set(sessionId, {
        messages,
        userMessage,
        dto,
        cardId,
        streamSubject,
        content: '',
        responseComplete: false,
      });

      return { sessionId };
    } catch (error) {
      this.logger.error(`Error creating chat session: ${error.message}`);
      throw error;
    }
  }

  // 第二个接口：SSE流式传输
  getChatStream(sessionId: string): Observable<any> {
    const session = this.chatSessions.get(sessionId);

    if (!session) {
      throw new Error(`Session with ID ${sessionId} not found`);
    }

    // 开始流式处理
    this.startStreaming(sessionId);

    return session.streamSubject.asObservable();
  }

  // 第三个接口：观察现有会话的流式状态
  getSessionStatus(sessionId: string): Observable<any> {
    const session = this.chatSessions.get(sessionId);

    if (!session) {
      throw new Error(`Session with ID ${sessionId} not found`);
    }

    // 创建一个新的Subject用于状态观察
    const statusSubject = new Subject();
    console.log('session', session);

    // 立即发送已有的内容
    if (session.content) {
      console.log('session.content', session.content);
      setTimeout(() => {
        statusSubject.next({
          event: 'existing_content',
          data: session.content,
        });
      });
    }

    // 如果响应已完成，发送完成事件
    if (session.responseComplete) {
      statusSubject.next({
        event: 'complete',
        data: JSON.stringify({
          complete: true,
          content: session.content,
        }),
      });
      statusSubject.complete();
      return statusSubject.asObservable();
    }

    // 订阅原始流，转发新的内容
    const subscription = session.streamSubject.subscribe({
      next: (data) => {
        // 只转发新的消息内容和完成事件，不重复发送已有内容
        if (data.event === 'message' || data.event === 'complete') {
          statusSubject.next(data);
        }
      },
      complete: () => {
        statusSubject.complete();
      },
      error: (error) => {
        statusSubject.error(error);
      },
    });

    // 返回状态观察流
    return statusSubject.asObservable();
  }

  private async startStreaming(sessionId: string) {
    const session = this.chatSessions.get(sessionId);

    if (!session) {
      return;
    }

    try {
      const stream = await this.openai.chat.completions.create({
        model: session.dto.model,
        temperature: 0.7,
        messages: session.messages as ChatCompletionMessageParam[],
        stream: true,
      });

      let promptTokens = 0;
      let completionTokens = 0;

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          session.content += content;
          session.streamSubject.next({
            event: 'message',
            data: content,
          });
        }

        // 更新token计数
        if (chunk.usage) {
          promptTokens = chunk.usage.prompt_tokens;
          completionTokens = chunk.usage.completion_tokens;
        }
      }

      // 流结束，发送完成事件
      session.responseComplete = true;
      session.streamSubject.next({
        event: 'complete',
        data: JSON.stringify({
          complete: true,
          content: session.content,
        }),
      });
      // console.log('session.content', session.content);

      // 更新数据库中的assistant消息
      await this.updateAssistantMessage(
        sessionId,
        session.content,
        promptTokens,
        completionTokens,
      );

      session.streamSubject.complete();
    } catch (error) {
      this.logger.error(`Error in streaming: ${error.message}`);
      session.streamSubject.error(error);
    } finally {
      // 流结束后清理会话
      setTimeout(() => {
        this.chatSessions.delete(sessionId);
      }, 5000); // 延迟5秒删除，确保客户端有时间接收所有消息
    }
  }

  private async saveMessages(
    sessionId: string,
    cardId: number,
    chunkId: string | null,
    userContent: string,
    assistantContent: string,
    model: string,
    promptTokens?: number,
    completionTokens?: number,
  ) {
    const session = this.chatSessions.get(sessionId);
    if (!session) return;

    try {
      const entities = [
        this.messageRepository.create({
          userCard: { id: cardId },
          chunkId: chunkId,
          content: userContent,
          role: MessageRole.USER,
          prompt_config: session.dto
            ? {
                chatcontext: session.dto.chatcontext,
                contextContent: session.dto.contextContent,
                chattype: session.dto.chattype,
                selectionText: session.dto.selectionText,
                question: session.dto.question,
              }
            : null,
          model: model as AIModel,
        }),
        this.messageRepository.create({
          userCard: { id: cardId },
          chunkId: chunkId,
          content: assistantContent,
          role: MessageRole.ASSISTANT,
          model: model as AIModel,
          promptTokens: promptTokens,
          completionTokens: completionTokens,
          totalTokens:
            promptTokens && completionTokens
              ? promptTokens + completionTokens
              : undefined,
        }),
      ];

      await this.messageRepository.save(entities);
      this.logger.log(`Messages saved for session ${sessionId}`);
    } catch (error) {
      this.logger.error(`Error saving messages: ${error.message}`);
    }
  }

  // 保留原来的方法用于向后兼容
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
      // 对于 WordLookup 类型，我们不需要卡片上下文，可以直接处理
      if (dto.chattype === ChatType.WordLookup) {
        return await this._processWordLookup(dto);
      }

      // 原有的逻辑保持不变
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
        // 收集引用的卡片信息
        const referencedCards = new Map<
          string,
          { front: string; back: string }
        >();

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
                  const doc = result[0];
                  const front = doc.metadata?.front || '未知卡片';
                  const back = doc.pageContent;
                  referencedCards.set(front, { front, back });
                });
              }),
          ),
        );

        // 构建带有引用信息的上下文
        const contextWithReferences = Array.from(referencedCards.values())
          .map((card, index) => {
            return `引用卡片${index + 1}：「${card.front}」\n内容：${
              card.back
            }`;
          })
          .join('\n\n');

        globalContext = contextWithReferences;
        console.log('\n');
        // console.log(
        //   'globalContext',
        //   Array.from(referencedCards.values()),
        //   globalContext,
        // );
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
      // console.log('userMessage', userMessage);
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
      // this.logger.debug(`History: ${JSON.stringify(messages, null, 2)}`);

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

  // 添加专门处理单词查询的方法
  private async _processWordLookup(dto: CreateChatMessageDto) {
    this.logger.log(`Processing word lookup for: ${dto.selectionText}`);

    try {
      // 生成单词查询的 prompt
      const content = generatePrompt(
        dto.chatcontext,
        dto.contextContent,
        dto.chattype,
        dto.selectionText,
        dto.question,
      );

      const userMessage = {
        role: MessageRole.USER,
        content: content,
      };

      // 构建消息数组 - 单词查询不需要历史上下文
      const messages = [
        {
          role: 'system',
          content: 'Dictionary. Brief word explanations only.',
        },
        userMessage,
      ];

      let aiResponse: string;
      let tokenUsage = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };

      // 判断是否使用qwen模型
      if (dto.model) {
        this.logger.debug(
          `Calling Qwen API for word lookup with model: ${dto.model}`,
        );

        // 使用qwen的API接口
        const response = await axios.post(
          'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
          {
            model: dto.model,
            messages: messages,
            temperature: 0,
            max_tokens: 150,
            top_p: 0.8,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.configService.get(
                'DASHSCOPE_API_KEY',
              )}`,
            },
          },
        );

        aiResponse = response.data.choices[0].message.content;
        if (response.data.usage) {
          tokenUsage = {
            promptTokens: response.data.usage.prompt_tokens || 0,
            completionTokens: response.data.usage.completion_tokens || 0,
            totalTokens: response.data.usage.total_tokens || 0,
          };
        }
      }

      // 对于单词查询，我们不保存到数据库（因为没有关联的卡片）
      // 直接返回结果
      return {
        userMessage,
        aiMessage: {
          role: MessageRole.ASSISTANT,
          content: aiResponse,
        },
        tokenUsage,
      };
    } catch (error) {
      this.logger.error(`Error in _processWordLookup: ${error.message}`);
      throw error;
    }
  }

  private async updateAssistantMessage(
    sessionId: string,
    content: string,
    promptTokens: number,
    completionTokens: number,
  ) {
    try {
      // 查找具有该sessionId的assistant消息
      const assistantMessage = await this.messageRepository.findOne({
        where: {
          sessionId: sessionId,
          role: MessageRole.ASSISTANT,
        },
      });

      if (assistantMessage) {
        // 更新消息内容和token信息，并清除sessionId
        assistantMessage.content = content;
        assistantMessage.promptTokens = promptTokens;
        assistantMessage.completionTokens = completionTokens;
        assistantMessage.totalTokens =
          promptTokens && completionTokens
            ? promptTokens + completionTokens
            : undefined;
        assistantMessage.sessionId = null; // 清除sessionId

        await this.messageRepository.save(assistantMessage);
        this.logger.log(`Assistant message updated for session ${sessionId}`);
      }
    } catch (error) {
      this.logger.error(`Error updating assistant message: ${error.message}`);
    }
  }
}
