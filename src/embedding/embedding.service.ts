import { HuggingFaceTransformersEmbeddings } from '@langchain/community/embeddings/huggingface_transformers';
import { Chroma } from '@langchain/community/vectorstores/chroma';
import { Injectable, Logger } from '@nestjs/common';
import { Document } from 'langchain/document';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  async buildVectorStore(segments: any[], deckId: number) {
    try {
      // 构建文档
      const docs = segments.map((segment, index) => {
        return new Document({
          pageContent: segment.text.trim(),
          metadata: {
            start: this.formatTime(segment.start),
            end: this.formatTime(segment.end),
            sequence: index + 1,
            speaker: segment.speaker,
            deckId: deckId,
          },
        });
      });

      // 文本分割
      const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 100,
      });
      const splitDocs = await textSplitter.splitDocuments(docs);

      // 保存可序列化的文档
      const serializableDocs = splitDocs.map((doc) => ({
        pageContent: doc.pageContent,
        metadata: doc.metadata,
      }));
      console.log(serializableDocs, 'serializableDocs');

      // await fs.writeFile(
      //   `embeddings/deck_${deckId}.json`,
      //   JSON.stringify(serializableDocs, null, 2),
      //   'utf-8',
      // );

      // 初始化 embeddings
      const embeddings = new HuggingFaceTransformersEmbeddings({
        model: 'nomic-ai/nomic-embed-text-v1',
      });

      // 创建向量存储
      // const persistDirectory = `chroma_db/deck_${deckId}`;
      const vectorStore = await Chroma.fromDocuments(splitDocs, embeddings, {
        collectionName: `deck_${deckId}_vectors`,
        url: 'http://127.0.0.1:8000',
      });

      // 持久化存储
      // await vectorStore.persist();

      return vectorStore;
    } catch (error) {
      this.logger.error(`Error building vector store: ${error.message}`);
      throw error;
    }
  }

  private formatTime(seconds: number): string {
    const date = new Date(seconds * 1000);
    return date.toISOString().substr(11, 8);
  }

  // 添加相似内容搜索方法
  async searchSimilarContent(deckId: number, query: string) {
    try {
      const embeddings = new HuggingFaceTransformersEmbeddings({
        model: 'nomic-ai/nomic-embed-text-v1',
      });

      const vectorStore = await Chroma.fromExistingCollection(embeddings, {
        collectionName: `deck_${deckId}_vectors`,
        url: 'http://127.0.0.1:8000',
      });

      const results = await vectorStore.similaritySearch(query, 5);
      return results;
    } catch (error) {
      this.logger.error(`Error searching similar content: ${error.message}`);
      throw error;
    }
  }
}
