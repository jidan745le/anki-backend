import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import OpenAI from 'openai';
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { Observable, Subject } from 'rxjs';
import { Card } from 'src/anki/entities/card.entity';
import { UserCard } from 'src/anki/entities/user-cards.entity';
import { EmbeddingService } from 'src/embedding/embedding.service';
import { WebsocketGateway } from 'src/websocket/websocket.gateway';
import { DataSource, In, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import * as WebSocket from 'ws';
import {
  CharacterType,
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
  UserVoiceConnection,
  VoiceConnectionState,
  VoiceMessage,
  VoiceTaskState,
} from './types/voice-connection.types';
import {
  extractCleanText,
  extractEmotion,
  generatePrompt,
  generateSimplifiedPromptDisplay,
  getCharacterSystemPrompt,
  getRetrievalUserPrompt,
  getSystemPrompt,
  getVoiceForCharacter,
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
      userId: number;
      abortController?: AbortController; // 添加这一行
    }
  >();

  // 用户级别的语音连接管理
  private userVoiceConnections = new Map<number, UserVoiceConnection>();

  // 语音内容缓存管理
  private voiceContentCache = new Map<number, string[]>(); // 用户ID -> 缓存的内容数组

  // 阿里云API配置
  private readonly dashScopeApiKey: string;
  private readonly dashScopeUrl =
    'wss://dashscope.aliyuncs.com/api-ws/v1/inference/';

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
    @Inject(WebsocketGateway)
    private websocketGateway: WebsocketGateway,
  ) {
    this.openai = new OpenAI({
      apiKey: this.configService.get('OPENAI_API_KEY'),
      baseURL: 'https://api.deepseek.com',
      maxRetries: 0,
    });

    this.dashScopeApiKey =
      this.configService.get('DASHSCOPE_API_KEY') ||
      'sk-05183a08ef32464da03aa26b18e930e7';
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
      const userId = card.user.id;

      // 检查是否启用语音合成
      if (dto.character && dto.socketId) {
        const canStartVoice = this.canStartVoiceTask(userId);
        if (!canStartVoice) {
          throw new HttpException(
            'User already has an active voice task or connection is busy',
            HttpStatus.CONFLICT,
          );
        }
      }

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

      // 根据是否有角色选择不同的系统提示词
      let systemPrompt: string;
      if (dto.character) {
        systemPrompt = getCharacterSystemPrompt(dto.character);
      } else {
        systemPrompt = getSystemPrompt(card.deck.deckType);
      }

      const messages: ChatCompletionMessageParam[] = [
        {
          role: 'system',
          content: systemPrompt,
        },
        ...history.reverse().map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        userMessage,
      ];

      // 创建一个唯一的会话ID
      const sessionId = uuidv4();

      // 如果启用语音合成，初始化语音连接
      if (dto.character && dto.socketId) {
        console.log(
          'initializeVoiceConnection',
          userId,
          dto.socketId,
          dto.character,
          sessionId,
        );
        await this.initializeVoiceConnection(
          userId,
          dto.socketId,
          dto.character,
          sessionId,
        );
      }

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
        userId: userId,
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
    let promptTokens = 0;
    let completionTokens = 0;

    try {
      // 创建 AbortController 并存储到 session 中
      const abortController = new AbortController();
      session.abortController = abortController;

      // 并行启动 AI 流式请求和语音任务准备
      const streamPromise = this.openai.chat.completions.create(
        {
          model: session.dto.model,
          temperature: 0.7,
          messages: session.messages as ChatCompletionMessageParam[],
          stream: true,
        },
        {
          signal: abortController.signal, // 使用可控制的 AbortController
        },
      );

      // 如果启用语音合成，异步准备语音任务（不等待）
      if (session.dto.character) {
        this.prepareVoiceTaskAsync(session.userId, sessionId);
      }

      const stream = await streamPromise;

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          session.content += content;
          session.streamSubject.next({
            event: 'message',
            data: content,
          });

          // 处理语音合成（支持缓存机制）
          if (session.dto.character) {
            await this.processVoiceContentWithCache(
              session.userId,
              content,
              session.content,
            );
          }
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

      // 完成语音任务
      if (session.dto.character) {
        await this.finishVoiceTask(session.userId);
      }

      // 更新数据库中的assistant消息
      await this.updateAssistantMessage(
        sessionId,
        session.content,
        promptTokens,
        completionTokens,
      );

      session.streamSubject.complete();
    } catch (error) {
      // 处理中断错误
      if (error.name === 'AbortError') {
        this.logger.log(`Stream aborted for session ${sessionId}`);
        session.streamSubject.next({
          event: 'aborted',
          data: 'Stream was interrupted by user',
        });

        await this.updateAssistantMessage(
          sessionId,
          session.content,
          promptTokens,
          completionTokens,
        );
      } else {
        this.logger.error(`Error in streaming: ${error.message}`);
        session.streamSubject.error(error);
      }
    } finally {
      // 清理 AbortController
      if (session.abortController) {
        session.abortController = undefined;
      }

      // 流结束后清理会话和缓存
      setTimeout(() => {
        if (!session.dto.character) {
          console.log('delete chatSessions', sessionId, session);
          this.chatSessions.delete(sessionId);
        }
        // this.voiceContentCache.delete(session.userId);
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

  private canStartVoiceTask(userId: number): boolean {
    const userConnection = this.userVoiceConnections.get(userId);
    if (!userConnection) {
      return true; // 没有连接，可以启动
    }

    const { connectionState, taskState } = userConnection;

    // 如果连接已断开，可以启动新任务
    if (connectionState === VoiceConnectionState.DISCONNECTED) {
      return true;
    }

    // 如果连接空闲，可以启动新任务
    if (taskState === VoiceTaskState.IDLE) {
      return true;
    }

    // 如果任务已完成或失败，可以启动新任务
    if (
      taskState === VoiceTaskState.TASK_FINISHED ||
      taskState === VoiceTaskState.TASK_FAILED ||
      taskState === VoiceTaskState.TASK_INTERRUPTED
    ) {
      return true;
    }

    return false;
  }

  private async initializeVoiceConnection(
    userId: number,
    socketId: string,
    character: CharacterType,
    sessionId: string,
  ) {
    this.logger.log(
      `Initializing voice connection for user ${userId} with character ${character}`,
    );

    // 检查是否已有可用连接
    const existingConnection = this.userVoiceConnections.get(userId);
    if (existingConnection) {
      const { connectionState, taskState } = existingConnection;

      // 如果连接状态良好且可以复用
      if (
        (connectionState === VoiceConnectionState.CONNECTED ||
          connectionState === VoiceConnectionState.CONNECTING) &&
        taskState !== VoiceTaskState.TASK_FAILED
      ) {
        this.logger.log(`Reusing existing voice connection for user ${userId}`);

        // 更新会话信息
        existingConnection.currentSessionId = sessionId;
        existingConnection.character = character;
        existingConnection.socketId = socketId;
        existingConnection.lastActivity = new Date();

        // 重置任务相关状态
        existingConnection.emotionProcessed = false;
        existingConnection.audioStarted = false;
        existingConnection.previousAudioLength = 0;

        return; // 复用现有连接，直接返回
      } else {
        // 清理旧连接
        if (existingConnection.websocket) {
          existingConnection.websocket.close();
        }
      }
    }

    // 创建新连接
    const userConnection: UserVoiceConnection = {
      userId,
      socketId,
      character,
      connectionState: VoiceConnectionState.CONNECTING,
      taskState: VoiceTaskState.CONNECTION_INIT,
      websocket: null,
      currentTaskId: null,
      currentSessionId: sessionId,
      speechRate: 1.1, // 固定语速
      lastActivity: new Date(),
      emotionProcessed: false,
      audioStarted: false,
      previousAudioLength: 0,
    };

    this.userVoiceConnections.set(userId, userConnection);

    // 初始化WebSocket连接
    try {
      const ws = new WebSocket(this.dashScopeUrl, {
        headers: {
          Authorization: `bearer ${this.dashScopeApiKey}`,
          'X-DashScope-DataInspection': 'enable',
        },
      });

      userConnection.websocket = ws;

      ws.on('open', () => {
        this.logger.log(`Voice WebSocket connected for user ${userId}`);
        userConnection.connectionState = VoiceConnectionState.CONNECTED;
        userConnection.taskState = VoiceTaskState.IDLE;

        // 连接建立后处理缓存的内容
        this.processCachedVoiceContent(userId);
      });

      ws.on('message', (data, isBinary) => {
        this.handleVoiceMessage(userId, data, isBinary);
      });

      ws.on('close', () => {
        this.logger.log(`Voice WebSocket closed for user ${userId}`);
        userConnection.connectionState = VoiceConnectionState.DISCONNECTED;
        userConnection.taskState = VoiceTaskState.CONNECTION_CLOSE;
      });

      ws.on('error', (error) => {
        this.logger.error(`Voice WebSocket error for user ${userId}:`, error);
        userConnection.connectionState = VoiceConnectionState.DISCONNECTED;
        userConnection.taskState = VoiceTaskState.TASK_FAILED;
      });
    } catch (error) {
      this.logger.error(
        `Failed to initialize voice connection for user ${userId}:`,
        error,
      );
      userConnection.connectionState = VoiceConnectionState.DISCONNECTED;
      userConnection.taskState = VoiceTaskState.TASK_FAILED;
    }
  }

  private sendRunTaskMessage(userId: number) {
    const userConnection = this.userVoiceConnections.get(userId);
    if (!userConnection || !userConnection.websocket) {
      return;
    }

    const voiceId = getVoiceForCharacter(userConnection.character);
    const runTaskMessage: VoiceMessage = {
      header: {
        action: 'run-task',
        task_id: userConnection.currentTaskId,
        streaming: 'duplex',
      },
      payload: {
        task_group: 'audio',
        task: 'tts',
        function: 'SpeechSynthesizer',
        model: 'cosyvoice-v2',
        parameters: {
          text_type: 'PlainText',
          voice: voiceId,
          format: 'mp3',
          sample_rate: 22050,
          volume: 50,
          rate: userConnection.speechRate,
          pitch: 1,
          enable_ssml: false,
        },
        input: {},
      },
    };

    userConnection.websocket.send(JSON.stringify(runTaskMessage));
    this.logger.log(
      `Sent run-task message for user ${userId}, task ID: ${userConnection.currentTaskId}`,
    );
  }

  private async processVoiceContent(
    userId: number,
    chunk: string,
    fullContent: string,
  ) {
    const userConnection = this.userVoiceConnections.get(userId);
    if (
      !userConnection ||
      userConnection.taskState !== VoiceTaskState.TASK_STARTED
    ) {
      return;
    }

    // 处理情绪信息和语音合成
    if (!userConnection.emotionProcessed) {
      console.log('fullContent', fullContent);
      console.log(
        'userConnection.emotionProcessed',
        userConnection.emotionProcessed,
      );

      // 检查是否包含完整的表情标记
      if (fullContent.includes('】')) {
        console.log('fullContent includes 】');
        const emotion = extractEmotion(fullContent);
        if (emotion) {
          // 发送情绪信息给前端
          this.websocketGateway.sendToUser(
            userId,
            userConnection.socketId,
            'emotion_change',
            {
              emotion,
              sessionId: userConnection.currentSessionId,
            },
          );
          this.logger.log(`Extracted emotion for user ${userId}: ${emotion}`);
        }
      }

      // 无论是否有表情标记，都开始处理语音合成
      if (fullContent.includes('】') || !fullContent.includes('【')) {
        console.log('fullContent includes 】 or !fullContent.includes(【)');
        userConnection.emotionProcessed = true;
        userConnection.audioStarted = true;

        // 清理表情标记并发送给语音合成
        const cleanText = extractCleanText(fullContent);
        if (cleanText.length > 0) {
          this.logger.log(
            `Starting voice synthesis for user ${userId}, text: ${cleanText.substring(
              0,
              50,
            )}...`,
          );
          await this.sendVoiceText(userId, cleanText);
          userConnection.previousAudioLength = cleanText.length;
        }
      }
    } else if (userConnection.audioStarted) {
      // 表情已处理，正常处理后续文本
      const speechText = extractCleanText(fullContent);

      // 只发送新增的纯文本给CosyVoice
      if (speechText.length > userConnection.previousAudioLength) {
        const newText = speechText.substring(
          userConnection.previousAudioLength,
        );
        if (newText.trim()) {
          this.logger.log(
            `Sending new text to voice for user ${userId}: ${newText}`,
          );
          await this.sendVoiceText(userId, newText);
        }
        userConnection.previousAudioLength = speechText.length;
      }
    }
  }

  private async sendVoiceText(userId: number, text: string) {
    const userConnection = this.userVoiceConnections.get(userId);
    if (!userConnection || !userConnection.websocket || !text.trim()) {
      return;
    }

    const continueTaskMessage: VoiceMessage = {
      header: {
        action: 'continue-task',
        task_id: userConnection.currentTaskId,
        streaming: 'duplex',
      },
      payload: {
        input: {
          text: text.trim(),
        },
      },
    };

    userConnection.websocket.send(JSON.stringify(continueTaskMessage));
  }

  private async finishVoiceTask(userId: number) {
    const userConnection = this.userVoiceConnections.get(userId);
    if (
      !userConnection ||
      userConnection.taskState !== VoiceTaskState.TASK_STARTED
    ) {
      return;
    }

    userConnection.taskState = VoiceTaskState.MESSAGE_SENT_FINISHED;

    // 延迟发送finish-task确保所有文本都已发送
    setTimeout(() => {
      this.sendFinishTaskMessage(userId);
    });
  }

  private sendFinishTaskMessage(userId: number) {
    const userConnection = this.userVoiceConnections.get(userId);
    if (!userConnection || !userConnection.websocket) {
      return;
    }

    const finishTaskMessage: VoiceMessage = {
      header: {
        action: 'finish-task',
        task_id: userConnection.currentTaskId,
        streaming: 'duplex',
      },
      payload: {
        input: {},
      },
    };

    userConnection.websocket.send(JSON.stringify(finishTaskMessage));
    this.logger.log(`Sent finish-task message for user ${userId}`);
  }

  private handleVoiceMessage(userId: number, data: any, isBinary: boolean) {
    const userConnection = this.userVoiceConnections.get(userId);
    if (!userConnection) {
      return;
    }

    if (isBinary) {
      // 语音数据，发送给客户端
      this.logger.log(
        `Received audio data for user ${userId}: ${data.length} bytes`,
      );
      this.websocketGateway.sendToUser(
        userId,
        userConnection.socketId,
        'voice_audio',
        data,
        true,
      );
    } else {
      // 控制消息
      try {
        const message = JSON.parse(data);
        this.handleCosyVoiceMessage(userId, message);
      } catch (error) {
        this.logger.error(
          `Failed to parse voice message for user ${userId}:`,
          error,
        );
      }
    }
  }

  private handleCosyVoiceMessage(userId: number, message: any) {
    const userConnection = this.userVoiceConnections.get(userId);
    if (!userConnection) {
      return;
    }

    switch (message.header.event) {
      case 'task-started':
        userConnection.taskState = VoiceTaskState.TASK_STARTED;
        this.logger.log(`Voice task started for user ${userId}`);
        this.websocketGateway.sendToUser(
          userId,
          userConnection.socketId,
          'voice_task_started',
          {
            sessionId: userConnection.currentSessionId,
          },
        );
        break;

      case 'task-finished':
        userConnection.taskState = VoiceTaskState.TASK_FINISHED;
        this.logger.log(`Voice task finished for user ${userId}`);
        this.websocketGateway.sendToUser(
          userId,
          userConnection.socketId,
          'voice_task_finished',
          {
            sessionId: userConnection.currentSessionId,
          },
        );
        setTimeout(() => {
          console.log('delete chatSessions', userConnection.currentSessionId);
          this.chatSessions.delete(userConnection.currentSessionId);
        }, 5000);
        break;

      case 'task-failed':
        userConnection.taskState = VoiceTaskState.TASK_FAILED;
        this.logger.error(
          `Voice task failed for user ${userId}: ${message.header.error_message}`,
        );
        this.websocketGateway.sendToUser(
          userId,
          userConnection.socketId,
          'voice_task_failed',
          {
            sessionId: userConnection.currentSessionId,
            error: message.header.error_message,
          },
        );
        break;

      default:
        this.logger.log(
          `Unknown voice event for user ${userId}: ${message.header.event}`,
        );
        break;
    }
  }

  async interruptVoiceConversation(sessionId: string) {
    const session = this.chatSessions.get(sessionId);
    if (!session) {
      throw new HttpException('Session not found', HttpStatus.NOT_FOUND);
    }

    const userConnection = this.userVoiceConnections.get(session.userId);
    if (!userConnection) {
      throw new HttpException(
        'Voice connection not found',
        HttpStatus.NOT_FOUND,
      );
    }

    // 设置任务为中断状态
    userConnection.taskState = VoiceTaskState.TASK_INTERRUPTED;

    // 关闭WebSocket连接
    if (userConnection.websocket) {
      userConnection.websocket.close();
      userConnection.websocket = null;
    }

    // 更新连接状态
    userConnection.connectionState = VoiceConnectionState.DISCONNECTED;

    // 通知客户端
    this.websocketGateway.sendToUser(
      session.userId,
      userConnection.socketId,
      'voice_interrupted',
      {
        sessionId: sessionId,
      },
    );

    this.logger.log(
      `Voice conversation interrupted for user ${session.userId}`,
    );
    return { message: 'Voice conversation interrupted successfully' };
  }

  // 异步准备语音任务（不阻塞）
  private async prepareVoiceTaskAsync(
    userId: number,
    sessionId: string,
  ): Promise<void> {
    console.log('prepareVoiceTaskAsync', userId, sessionId);
    const userConnection = this.userVoiceConnections.get(userId);

    if (!userConnection) {
      return;
    }

    // 初始化缓存
    this.voiceContentCache.set(userId, []);

    // 如果连接已经就绪，直接准备任务
    if (userConnection.connectionState === VoiceConnectionState.CONNECTED) {
      this.startVoiceTask(userId, sessionId);
      return;
    }

    // 否则等待连接建立，最多5秒
    let retryCount = 0;
    const maxRetries = 50;

    while (
      (userConnection.connectionState as VoiceConnectionState) !==
        VoiceConnectionState.CONNECTED &&
      retryCount < maxRetries
    ) {
      console.log(
        `Waiting for WebSocket connection, retry ${
          retryCount + 1
        }/${maxRetries}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      retryCount++;
    }

    if (
      (userConnection.connectionState as VoiceConnectionState) ===
      VoiceConnectionState.CONNECTED
    ) {
      this.startVoiceTask(userId, sessionId);
    } else {
      this.logger.error(
        `WebSocket connection failed to establish within timeout for user ${userId}`,
      );
    }
  }

  // 启动语音任务
  private startVoiceTask(userId: number, sessionId: string) {
    const userConnection = this.userVoiceConnections.get(userId);
    if (!userConnection) return;

    userConnection.currentTaskId = uuidv4();
    userConnection.currentSessionId = sessionId;
    userConnection.taskState = VoiceTaskState.PENDING_TASK;
    userConnection.emotionProcessed = false;
    userConnection.audioStarted = false;
    userConnection.previousAudioLength = 0;

    // 发送run-task消息
    this.sendRunTaskMessage(userId);
  }

  // 处理缓存的语音内容
  private async processCachedVoiceContent(userId: number) {
    const cachedContent = this.voiceContentCache.get(userId);
    if (!cachedContent || cachedContent.length === 0) {
      return;
    }

    this.logger.log(
      `Processing ${cachedContent.length} cached voice contents for user ${userId}`,
    );

    // 将缓存的内容合并并处理
    const fullContent = cachedContent.join('');

    // 清空缓存
    this.voiceContentCache.set(userId, []);

    // 处理合并后的内容
    await this.processVoiceContent(userId, '', fullContent);
  }

  // 支持缓存的语音内容处理
  private async processVoiceContentWithCache(
    userId: number,
    chunk: string,
    fullContent: string,
  ) {
    const userConnection = this.userVoiceConnections.get(userId);

    // 如果连接还没准备好，缓存内容
    if (
      !userConnection ||
      userConnection.taskState !== VoiceTaskState.TASK_STARTED
    ) {
      const cache = this.voiceContentCache.get(userId) || [];
      cache.push(chunk);
      this.voiceContentCache.set(userId, cache);

      console.log(
        `Cached voice content for user ${userId}: ${chunk.substring(0, 20)}...`,
      );
      return;
    }

    // 连接已准备好，正常处理
    await this.processVoiceContent(userId, chunk, fullContent);
  }

  async interruptChatStream(sessionId: string) {
    const session = this.chatSessions.get(sessionId);

    if (!session) {
      throw new HttpException('Session not found', HttpStatus.NOT_FOUND);
    }

    if (!session.abortController) {
      throw new HttpException(
        'Stream not active or already completed',
        HttpStatus.BAD_REQUEST,
      );
    }

    // 中断 AI 流式响应
    session.abortController.abort();

    // 如果有语音任务也一并中断
    if (session.dto.character) {
      await this.interruptVoiceConversation(sessionId);
    }

    this.logger.log(`Chat stream interrupted for session ${sessionId}`);

    return { message: 'Chat stream interrupted successfully' };
  }

  async interruptSession(sessionId: string) {
    const session = this.chatSessions.get(sessionId);

    if (!session) {
      throw new HttpException('Session not found', HttpStatus.NOT_FOUND);
    }

    const results = {
      chatInterrupted: false,
      voiceInterrupted: false,
      message: '',
    };

    // 1. 检查并中断 Chat Streaming
    if (session.abortController && !session.responseComplete) {
      try {
        session.abortController.abort();
        results.chatInterrupted = true;
        this.logger.log(`Chat stream interrupted for session ${sessionId}`);
      } catch (error) {
        this.logger.error(`Failed to interrupt chat stream: ${error.message}`);
      }
    }

    // 2. 检查并中断 Voice Streaming
    const userConnection = this.userVoiceConnections.get(session.userId);
    if (userConnection && userConnection.currentSessionId === sessionId) {
      // 检查语音任务是否活跃
      const isVoiceActive = [
        VoiceTaskState.PENDING_TASK,
        VoiceTaskState.TASK_STARTED,
        VoiceTaskState.MESSAGE_SENT_FINISHED,
      ].includes(userConnection.taskState);

      if (isVoiceActive) {
        try {
          // 设置任务为中断状态
          userConnection.taskState = VoiceTaskState.TASK_INTERRUPTED;

          // 关闭WebSocket连接
          if (userConnection.websocket) {
            userConnection.websocket.close();
            userConnection.websocket = null;
          }

          // 更新连接状态
          userConnection.connectionState = VoiceConnectionState.DISCONNECTED;

          // 通知客户端
          this.websocketGateway.sendToUser(
            session.userId,
            userConnection.socketId,
            'voice_interrupted',
            { sessionId: sessionId },
          );

          results.voiceInterrupted = true;
          this.logger.log(`Voice stream interrupted for session ${sessionId}`);
        } catch (error) {
          this.logger.error(
            `Failed to interrupt voice stream: ${error.message}`,
          );
        }
      }
    }

    // 3. 生成结果消息
    if (results.chatInterrupted && results.voiceInterrupted) {
      results.message = 'Chat and voice streams interrupted successfully';
    } else if (results.chatInterrupted) {
      results.message = 'Chat stream interrupted successfully';
    } else if (results.voiceInterrupted) {
      results.message = 'Voice stream interrupted successfully';
    } else {
      results.message = 'No active streams found to interrupt';
    }

    this.logger.log(
      `Session ${sessionId} interrupt completed: ${results.message}`,
    );

    return results;
  }
}
