import { HuggingFaceTransformersEmbeddings } from '@langchain/community/embeddings/huggingface_transformers';
import { Chroma } from '@langchain/community/vectorstores/chroma';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Document } from 'langchain/document';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';

@Injectable()
export class EmbeddingService {
  constructor(private configService: ConfigService) {}
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
        url: 'http://vector-database:8000',
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

  // 生成搜索关键词
  async generateSearchKeywords(query: string): Promise<string[]> {
    try {
      const prompt = `生成5到10个精准的搜索关键词或短语，这些关键词将用于在技术文档库中检索相关信息。每个关键词应该简洁、精确，并且从不同角度覆盖用户问题的核心要素。请直接列出这些关键词，每行一个，不要有编号或其他说明。用户问题: ${query}`;

      // 调用 DeepSeek R1 模型 API
      const response = await axios.post(
        'https://api.deepseek.com/chat/completions', // 假设你有一个 DeepSeek 服务
        {
          model: 'deepseek-reasoner',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.configService.get('OPENAI_API_KEY')}`,
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

  // 增强的相似内容搜索方法
  async searchSimilarContent(deckId: number, query: string) {
    try {
      const embeddings = new HuggingFaceTransformersEmbeddings({
        model: 'nomic-ai/nomic-embed-text-v1',
      });

      const vectorStore = await Chroma.fromExistingCollection(embeddings, {
        collectionName: `deck_${deckId}_vectors`,
        url: 'http://vector-database:8000',
      });

      // vectorStore.collection.delete()

      const results = await vectorStore.similaritySearchWithScore(query, 5);
      return results;
    } catch (error) {
      this.logger.error(`Error searching similar content: ${error.message}`);
      throw error;
    }
  }
}
