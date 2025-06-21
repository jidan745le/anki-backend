import { Chroma } from '@langchain/community/vectorstores/chroma';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { ChromaClient } from 'chromadb';
import * as fs from 'fs';
import { Document } from 'langchain/document';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import * as path from 'path';
import { Card } from 'src/anki/entities/card.entity';
import { Deck, DeckStatus } from 'src/anki/entities/deck.entity';
import { Repository } from 'typeorm';
import { Worker } from 'worker_threads';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { BailianChromaEmbeddings } from './bailian-chroma-embeddings';
import { BailianEmbeddingService } from './bailian-embedding.service';

const isDevelopment = process.env.NODE_ENV === 'development';
@Injectable()
export class EmbeddingService {
  private bailianService: BailianEmbeddingService;

  constructor(
    private configService: ConfigService,
    private readonly websocketGateway: WebsocketGateway,
    @InjectRepository(Deck)
    private readonly deckRepository: Repository<Deck>,
  ) {
    // 初始化百炼服务
    this.bailianService = new BailianEmbeddingService(configService);
  }
  private readonly logger = new Logger(EmbeddingService.name);

  async onModuleInit() {
    // try {
    //   this.logger.log('正在初始化embedding状态...');
    //   // 连接向量数据库
    //   const url = !isDevelopment
    //     ? 'http://vector-database:8000'
    //     : 'http://127.0.0.1:8000';
    //   const chromaClient = new ChromaClient({ path: url });
    //   // 获取所有集合
    //   const collections = await chromaClient.listCollections();
    //   this.logger.log(`发现 ${collections.length} 个向量集合`);
    //   // 解析deck集合并更新状态
    //   let updatedCount = 0;
    //   for (const collectionName of collections) {
    //     // 匹配 deck_{id}_vectors 格式
    //     const match = collectionName.match(/^deck_(\d+)_vectors$/);
    //     if (match) {
    //       const deckId = parseInt(match[1]);
    //       try {
    //         // 检查deck是否存在且未标记为已嵌入
    //         const deck = await this.deckRepository.findOne({
    //           where: { id: deckId },
    //         });
    //         if (deck && !deck.isEmbedding) {
    //           await this.deckRepository.update(
    //             { id: deckId },
    //             { isEmbedding: true, status: DeckStatus.COMPLETED },
    //           );
    //           updatedCount++;
    //           this.logger.log(`已更新 deck ${deckId} 的embedding状态`);
    //         }
    //       } catch (error) {
    //         this.logger.warn(`更新 deck ${deckId} 状态失败: ${error.message}`);
    //       }
    //     }
    //   }
    //   this.logger.log(`embedding状态初始化完成，共更新 ${updatedCount} 个deck`);
    // } catch (error) {
    //   this.logger.warn(`embedding状态初始化失败: ${error.message}`);
    //   // 不抛出错误，避免影响服务启动
    // }
  }

  // Worker任务管理
  private workers: Map<string, Worker> = new Map();
  private taskDeckMap: Map<string, number> = new Map();

  /**
   * 停止特定deck的所有Worker任务
   * @param deckId 牌组ID
   */
  async stopDeckTasks(deckId: number): Promise<{ stoppedTasks: string[] }> {
    const stoppedTasks: string[] = [];

    // 查找该deck相关的所有任务
    for (const [taskId, taskDeckId] of this.taskDeckMap.entries()) {
      if (taskDeckId === deckId) {
        const worker = this.workers.get(taskId);
        if (worker) {
          try {
            this.logger.log(
              `Terminating worker for task ${taskId}, deck ${deckId}`,
            );

            // 优雅地终止Worker
            await worker.terminate();

            // 清理映射
            this.workers.delete(taskId);
            this.taskDeckMap.delete(taskId);

            stoppedTasks.push(taskId);

            this.logger.log(
              `Successfully stopped task ${taskId} for deck ${deckId}`,
            );
          } catch (error) {
            this.logger.error(
              `Error stopping task ${taskId}: ${error.message}`,
            );
          }
        }
      }
    }

    return { stoppedTasks };
  }

  /**
   * 停止特定的任务
   * @param taskId 任务ID
   */
  async stopTask(taskId: string): Promise<boolean> {
    const worker = this.workers.get(taskId);
    if (worker) {
      try {
        this.logger.log(`Terminating specific task ${taskId}`);
        await worker.terminate();

        // 清理映射
        this.workers.delete(taskId);
        this.taskDeckMap.delete(taskId);

        this.logger.log(`Successfully stopped task ${taskId}`);
        return true;
      } catch (error) {
        this.logger.error(`Error stopping task ${taskId}: ${error.message}`);
        return false;
      }
    }
    return false;
  }

  async buildVectorStore(
    segments: any[],
    deckId: number,
    batchSize = 20,
    chunkSize = 1000,
    chunkOverlap = 100,
    userId?: number,
    taskId?: string,
  ): Promise<string | Chroma> {
    // 如果提供了userId和taskId，使用Worker线程处理以避免阻塞主线程
    if (userId && taskId) {
      this.logger.log(
        `Starting vector embedding for deck ${deckId} in worker thread (using Bailian)`,
      );

      try {
        // 检查参数
        if (!segments || segments.length === 0) {
          throw new Error('No segments provided for vector embedding');
        }

        // 创建Worker线程
        // 根据环境确定正确的worker文件路径，使用百炼worker
        let workerPath;
        if (isDevelopment) {
          // 开发模式下，使用项目根目录下的dist路径
          workerPath = path.resolve(
            process.cwd(),
            'dist/embedding/bailian-embedding-worker.js',
          );

          // 确保worker文件存在
          if (!fs.existsSync(workerPath)) {
            this.logger.warn(
              `Bailian worker file not found at ${workerPath}, trying to compile it...`,
            );
            // 尝试编译worker文件
            try {
              const compileScript = path.resolve(
                process.cwd(),
                'compile-worker.js',
              );
              require(compileScript);
              // 等待一会儿确保编译完成
              await new Promise((resolve) => setTimeout(resolve, 2000));

              if (!fs.existsSync(workerPath)) {
                throw new Error(
                  `Bailian worker file still not found after compilation attempt`,
                );
              }
            } catch (compileError) {
              this.logger.error(
                `Failed to compile bailian worker: ${compileError.message}`,
              );
              throw new Error(
                `Bailian worker file not found and compilation failed: ${compileError.message}`,
              );
            }
          }
        } else {
          // 生产模式下，使用相对路径
          workerPath = path.resolve(__dirname, 'bailian-embedding-worker.js');
        }

        this.logger.log(`Initializing Bailian worker at path: ${workerPath}`);

        // 需要传递给Worker的数据
        const workerData = {
          segments,
          deckId,
          batchSize,
          chunkSize,
          chunkOverlap,
          isDevelopment,
        };

        // 启动Worker异步处理
        const worker = new Worker(workerPath, { workerData });

        // 注册Worker到管理器
        this.workers.set(taskId, worker);
        this.taskDeckMap.set(taskId, deckId);

        // 处理Worker事件和消息
        worker.on('message', async (message) => {
          if (message.type === 'progress') {
            // 发送进度更新
            this.websocketGateway.sendProgress(
              userId,
              taskId,
              message.progress,
              message.message,
            );
          } else if (message.type === 'log') {
            // 记录日志
            this.logger.log(`Bailian Worker: ${message.message}`);
          } else if (message.type === 'error') {
            // 记录错误
            this.logger.error(`Bailian Worker error: ${message.error}`);

            this.websocketGateway.sendProgress(
              userId,
              taskId,
              100,
              `向量嵌入失败: ${message.error}`,
            );
          } else if (message.type === 'complete') {
            this.logger.log(
              `Vector embedding completed for deck ${deckId} using Bailian`,
            );
            // 更新牌组状态
            await this.deckRepository.update(
              { id: deckId },
              { status: DeckStatus.COMPLETED, isEmbedding: true },
            );

            this.websocketGateway.sendProgress(
              userId,
              taskId,
              100,
              '向量嵌入处理完成',
            );

            // 清理已完成的任务
            this.workers.delete(taskId);
            this.taskDeckMap.delete(taskId);
            worker.terminate();
          }
        });

        worker.on('error', (error) => {
          this.logger.error(`Bailian Worker error: ${error.message}`);

          this.websocketGateway.sendProgress(
            userId,
            taskId,
            100,
            `向量处理错误: ${error.message}`,
          );

          // 清理出错的任务
          this.workers.delete(taskId);
          this.taskDeckMap.delete(taskId);
        });

        worker.on('exit', (code) => {
          if (code !== 0) {
            this.logger.error(`Bailian Worker stopped with exit code ${code}`);
          } else {
            this.logger.log(`Bailian Worker completed successfully`);
          }

          // 清理退出的任务
          this.workers.delete(taskId);
          this.taskDeckMap.delete(taskId);
        });

        // 立即返回，不等待Worker完成
        return `Bailian Worker started for deck ${deckId}`;
      } catch (error) {
        this.logger.error(
          `Failed to start Bailian vector embedding worker: ${error.message}`,
        );
        throw error;
      }
    } else {
      // 同步处理方式（使用百炼服务）
      this.logger.log('buildVectorStore with batching (using Bailian)');
      try {
        // 构建文档
        const docs = segments.map((segment, index) => {
          const metadata = {
            start: this.formatTime(segment.start),
            end: this.formatTime(segment.end),
            sequence: index + 1,
            speaker: segment.speaker,
            deckId: deckId,
            front: segment.front,
          };

          const filteredMetadata = Object.fromEntries(
            Object.entries(metadata).filter(([_, value]) => !!value),
          );

          return new Document({
            pageContent: segment.text.trim(),
            metadata: filteredMetadata,
          });
        });

        // 文本分割
        const textSplitter = new RecursiveCharacterTextSplitter({
          chunkSize,
          chunkOverlap,
        });
        const splitDocs = await textSplitter.splitDocuments(docs);

        // 保存可序列化的文档
        const serializableDocs = splitDocs.map((doc) => ({
          pageContent: doc.pageContent,
          metadata: doc.metadata,
        }));
        console.log(`Total docs to embed: ${serializableDocs.length}`);

        // 初始化百炼 embeddings
        const embeddings = new BailianChromaEmbeddings(this.bailianService, 1);

        // 分批处理文档
        const collectionName = `deck_${deckId}_vectors`;
        const url = !isDevelopment
          ? 'http://vector-database:8000'
          : 'http://127.0.0.1:8000';

        console.log('collectionName', collectionName);

        // 创建或获取向量存储
        let vectorStore: Chroma;

        // 分批处理
        const totalBatches = Math.ceil(splitDocs.length / batchSize);
        this.logger.log(
          `Processing ${totalBatches} batches with batch size ${batchSize} using Bailian`,
        );

        const chromaClient = new ChromaClient({
          path: url,
        });

        const collections = await chromaClient.listCollections();
        const isExist = collections.find(
          (collection) => collection === collectionName,
        );

        for (let i = 0; i < splitDocs.length; i += batchSize) {
          const batchDocs = splitDocs.slice(i, i + batchSize);
          const batchNum = Math.floor(i / batchSize) + 1;

          this.logger.log(
            `Processing batch ${batchNum}/${totalBatches} (${batchDocs.length} docs) with Bailian`,
          );

          if (i === 0 && !isExist) {
            // 首批创建新的集合
            vectorStore = await Chroma.fromDocuments(batchDocs, embeddings, {
              collectionName,
              url,
              collectionMetadata: {
                'hnsw:space': 'cosine',
                embedding_function: 'bailian-text-embedding-v4',
                embedding_dimension: 2048,
              },
            });
          } else {
            // 后续批次添加到现有集合
            if (!vectorStore) {
              vectorStore = await Chroma.fromExistingCollection(embeddings, {
                collectionName,
                url,
              });
            }

            await vectorStore.addDocuments(batchDocs);
          }

          // 在批次之间添加短暂延迟，减轻负载压力
          if (i + batchSize < splitDocs.length) {
            await new Promise((resolve) => setTimeout(resolve, 1000)); // 增加延迟到1秒，避免触发百炼限流
          }
        }

        this.logger.log(
          `Successfully added all ${splitDocs.length} documents to vector store using Bailian`,
        );
        return vectorStore;
      } catch (error) {
        this.logger.error(
          `Error building vector store with Bailian: ${error.message}`,
        );
        throw error;
      }
    }
  }

  private formatTime(seconds: number): string | null {
    if (isNaN(seconds)) {
      return null;
    }
    const date = new Date(seconds * 1000);
    return date.toISOString().substr(11, 8);
  }

  async addBaseCardToVectorStore(card: Card, deckId: number) {
    // 使用百炼embedding服务
    const embeddings = new BailianChromaEmbeddings(this.bailianService);

    try {
      let vectorStore = await Chroma.fromExistingCollection(embeddings, {
        collectionName: `deck_${deckId}_vectors`,
        url: !isDevelopment
          ? 'http://vector-database:8000'
          : 'http://127.0.0.1:8000',
      });

      if (!vectorStore) {
        console.log('创建空向量库 (using Bailian)');
        //创建空向量库
        vectorStore = await Chroma.fromDocuments([], embeddings, {
          collectionName: `deck_${deckId}_vectors`,
          url: !isDevelopment
            ? 'http://vector-database:8000'
            : 'http://127.0.0.1:8000',
          collectionMetadata: {
            'hnsw:space': 'cosine',
            embedding_function: 'bailian-text-embedding-v4',
            embedding_dimension: 2048,
          },
        });
      }

      await vectorStore.addDocuments([
        new Document({
          pageContent: card.back,
          metadata: { front: card.front },
        }),
      ]);
    } catch (error) {
      this.logger.error(
        `Error adding card to vector store with Bailian: ${error.message}`,
      );
      throw error;
    }
  }

  // 生成搜索关键词
  async generateSearchKeywords(query: string): Promise<string[]> {
    try {
      const prompt = `根据query生成4个精准的搜索关键词或短语，请忽略query中的模板，html标签，引用和url等无关信息，这些关键词将用于在embedding向量数据库中检索相关信息。每个关键词应该简洁、精确，并且从不同角度覆盖用户问题的核心要素。请直接列出这些关键词，每行一个，不要有编号或其他说明。用户问题: ${query}`;

      // 调用通义千问 API
      const response = await axios.post(
        'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        {
          model: 'qwen2.5-32b-instruct',
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.7,
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

      // 解析响应，提取关键词
      const content = response.data.choices[0].message.content;
      const keywords = content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      return keywords;
    } catch (error) {
      this.logger.error(`Error generating search keywords: ${error.message}`);
      // 如果生成关键词失败，返回原始查询作为唯一关键词
      return [query];
    }
  }

  async deleteVectorStore(deckId: number) {
    try {
      const collectionName = `deck_${deckId}_vectors`;
      const url = !isDevelopment
        ? 'http://vector-database:8000'
        : 'http://127.0.0.1:8000';

      // 创建Chroma客户端
      const chromaClient = new ChromaClient({
        path: url,
      });

      const collections = await chromaClient.listCollections();
      this.logger.log(
        `Available collections before deletion: ${collections.length}`,
      );

      // 检查集合是否存在
      if (!collections.find((collection) => collection === collectionName)) {
        this.logger.log(
          `Collection ${collectionName} does not exist, nothing to delete.`,
        );
        return;
      }

      // 删除整个collection
      await chromaClient.deleteCollection({
        name: collectionName,
      });

      this.logger.log(`Successfully deleted collection ${collectionName}`);

      // 验证删除结果
      const collectionsAfter = await chromaClient.listCollections();
      this.logger.log(
        `Available collections after deletion: ${collectionsAfter.length}`,
      );
    } catch (error) {
      this.logger.error(`Error deleting vector store: ${error.message}`);
      throw error;
    }
  }

  async vectorStoreLogger() {
    try {
      const url = !isDevelopment
        ? 'http://vector-database:8000'
        : 'http://127.0.0.1:8000';

      // 创建Chroma客户端
      const chromaClient = new ChromaClient({
        path: url,
      });

      const collections = await chromaClient.listCollections();
      this.logger.log(`Available collections: ${collections.length}`);

      // 获取每个集合的详细信息
      for (const collectionName of collections) {
        try {
          // 使用默认或空的嵌入函数
          const collection = await chromaClient.getCollection({
            name: collectionName,
            embeddingFunction: {
              generate: async (texts: string[]) =>
                texts.map(() => new Array(768).fill(0)),
            },
          });

          const count = await collection.count();
          this.logger.log(`Collection ${collectionName}: ${count} items`);
        } catch (err) {
          this.logger.warn(
            `Could not get details for collection ${collectionName}: ${err.message}`,
          );
        }
      }

      return collections;
    } catch (error) {
      this.logger.error(`Error logging vector store: ${error.message}`);
      throw error;
    }
  }

  // 增强的相似内容搜索方法
  async searchSimilarContent(deckId: number, query: string, topK = 5) {
    try {
      // 使用百炼embedding服务
      const embeddings = new BailianChromaEmbeddings(this.bailianService);

      const collectionName = `deck_${deckId}_vectors`;
      const url = !isDevelopment
        ? 'http://vector-database:8000'
        : 'http://127.0.0.1:8000';

      this.logger.log(
        `Searching in collection: ${collectionName} (using Bailian)`,
      );

      const vectorStore = await Chroma.fromExistingCollection(embeddings, {
        collectionName,
        url,
      });

      const results = await vectorStore.similaritySearchWithScore(query, topK);
      return results;
    } catch (error) {
      this.logger.error(
        `Error searching similar content with Bailian: ${error.message}`,
      );
      throw error;
    }
  }
}
