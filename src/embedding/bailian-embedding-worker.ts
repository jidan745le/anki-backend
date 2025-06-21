import { Chroma } from '@langchain/community/vectorstores/chroma';
import { ConfigService } from '@nestjs/config';
import { ChromaClient } from 'chromadb';
import { Document } from 'langchain/document';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { parentPort, workerData } from 'worker_threads';
import { BailianChromaEmbeddings } from './bailian-chroma-embeddings';
import { BailianEmbeddingService } from './bailian-embedding.service';

// 接收来自主线程的数据
const {
  segments,
  deckId,
  batchSize = 20,
  chunkSize = 1000,
  chunkOverlap = 100,
  isDevelopment,
} = workerData;

// 终止标志
let shouldTerminate = false;

// 监听主线程消息
parentPort?.on('message', (message) => {
  if (message.type === 'terminate') {
    shouldTerminate = true;
    parentPort?.postMessage({
      type: 'log',
      message: 'Received termination signal, stopping gracefully...',
    });
  }
});

// 格式化时间函数
function formatTime(seconds: number): string | null {
  if (isNaN(seconds)) {
    return null;
  }
  const date = new Date(seconds * 1000);
  return date.toISOString().substr(11, 8);
}

// 检查是否应该终止
function checkTermination(): boolean {
  if (shouldTerminate) {
    parentPort?.postMessage({
      type: 'terminated',
      message: 'Worker terminated gracefully',
    });
    process.exit(0);
  }
  return false;
}

// 主要处理函数
async function buildVectorStore() {
  try {
    // 发送进度消息
    parentPort?.postMessage({
      type: 'progress',
      progress: 5,
      message: '开始处理文档',
    });

    // 构建文档
    const docs = segments.map((segment, index) => {
      const metadata = {
        start: formatTime(segment.start),
        end: formatTime(segment.end),
        sequence: index + 1,
        speaker: segment.speaker,
        deckId: deckId,
        front: segment.front,
        uuid: segment.uuid,
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
    parentPort?.postMessage({
      type: 'progress',
      progress: 10,
      message: '正在分割文本',
    });
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

    parentPort?.postMessage({
      type: 'progress',
      progress: 15,
      message: `文档预处理完成，共 ${serializableDocs.length} 个文档`,
    });

    // 初始化百炼embedding服务
    const configService = new ConfigService();
    const bailianService = new BailianEmbeddingService(configService);
    const embeddings = new BailianChromaEmbeddings(bailianService);

    // 分批处理文档
    const collectionName = `deck_${deckId}_vectors`;
    const url = !isDevelopment
      ? 'http://vector-database:8000'
      : 'http://127.0.0.1:8000';

    // 创建或获取向量存储
    let vectorStore: Chroma;

    // 分批处理
    const totalBatches = Math.ceil(splitDocs.length / batchSize);
    parentPort?.postMessage({
      type: 'log',
      message: `Processing ${totalBatches} batches with batch size ${batchSize}`,
    });

    const chromaClient = new ChromaClient({
      path: url,
    });

    const collections = await chromaClient.listCollections();
    const isExist = collections.find(
      (collection) => collection === collectionName,
    );

    for (let i = 0; i < splitDocs.length; i += batchSize) {
      // 检查是否应该终止
      checkTermination();

      const batchDocs = splitDocs.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;

      // 计算进度百分比: 20% 到 90% 的范围内
      const progressPercent = 20 + Math.floor((i / splitDocs.length) * 70);

      parentPort?.postMessage({
        type: 'progress',
        progress: progressPercent,
        message: `处理批次 ${batchNum}/${totalBatches}，当前批次包含 ${batchDocs.length} 个文档`,
      });

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
        // 将延迟分解为多个检查点，以便更快响应终止请求
        for (let delay = 0; delay < 1000; delay += 500) {
          checkTermination();
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }

    parentPort?.postMessage({
      type: 'progress',
      progress: 98,
      message: `成功添加所有 ${splitDocs.length} 个文档到向量存储`,
    });

    // 完成处理，发送成功消息
    parentPort?.postMessage({
      progress: 100,
      type: 'complete',
      collectionName,
      totalDocuments: splitDocs.length,
    });
  } catch (error) {
    parentPort?.postMessage({
      type: 'error',
      error: error.message,
    });
  }
}

// 启动向量存储构建
buildVectorStore().catch((error) => {
  parentPort?.postMessage({
    type: 'error',
    error: error.message,
  });
});
