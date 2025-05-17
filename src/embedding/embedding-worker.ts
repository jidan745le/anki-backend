import { HuggingFaceTransformersEmbeddings } from '@langchain/community/embeddings/huggingface_transformers';
import { Chroma } from '@langchain/community/vectorstores/chroma';
import { ChromaClient } from 'chromadb';
import { Document } from 'langchain/document';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { parentPort, workerData } from 'worker_threads';

// 接收来自主线程的数据
const {
  segments,
  deckId,
  batchSize = 20,
  chunkSize = 1000,
  chunkOverlap = 100,
  isDevelopment,
} = workerData;

// 格式化时间函数
function formatTime(seconds: number): string | null {
  if (isNaN(seconds)) {
    return null;
  }
  const date = new Date(seconds * 1000);
  return date.toISOString().substr(11, 8);
}

// 主要处理函数
async function buildVectorStore() {
  try {
    // 发送进度消息
    parentPort.postMessage({
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
    parentPort.postMessage({
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

    parentPort.postMessage({
      type: 'progress',
      progress: 15,
      message: `文档预处理完成，共 ${serializableDocs.length} 个文档`,
    });

    // 初始化 embeddings
    const embeddings = new HuggingFaceTransformersEmbeddings({
      model: 'nomic-ai/nomic-embed-text-v1',
    });

    // 分批处理文档
    const collectionName = `deck_${deckId}_vectors`;
    const url = !isDevelopment
      ? 'http://vector-database:8000'
      : 'http://127.0.0.1:8000';

    // 创建或获取向量存储
    let vectorStore;

    // 分批处理
    const totalBatches = Math.ceil(splitDocs.length / batchSize);
    parentPort.postMessage({
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
      const batchDocs = splitDocs.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;

      // 计算进度百分比: 20% 到 90% 的范围内
      const progressPercent = 20 + Math.floor((i / splitDocs.length) * 70);

      parentPort.postMessage({
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
            embedding_function: 'nomic-ai/nomic-embed-text-v1',
            embedding_dimension: 768,
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
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    parentPort.postMessage({
      type: 'progress',
      progress: 98,
      message: `成功添加所有 ${splitDocs.length} 个文档到向量存储`,
    });

    // 完成处理，发送成功消息
    parentPort.postMessage({
      progress: 100,
      type: 'complete',
      collectionName,
    });
  } catch (error) {
    // 发送错误消息
    parentPort.postMessage({
      type: 'error',
      error: error.message,
    });
  }
}

// 开始处理
buildVectorStore();
