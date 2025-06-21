import { Embeddings } from '@langchain/core/embeddings';
import { BailianEmbeddingService } from './bailian-embedding.service';

/**
 * 百炼Embedding适配器，兼容LangChain的Embeddings接口
 * 用于与Chroma向量数据库无缝集成
 */
export class BailianChromaEmbeddings extends Embeddings {
  private bailianService: BailianEmbeddingService;
  private dimension: number;

  constructor(bailianService: BailianEmbeddingService, dimension = 2048) {
    super({});
    this.bailianService = bailianService;
    this.dimension = dimension;
  }

  /**
   * 对文档文本进行embedding
   * @param texts 文档文本数组
   * @returns embedding向量数组
   */
  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    // 使用批量处理来处理大量文档
    return await this.bailianService.embedTextsBatch(
      texts,
      10, // 批次大小
      this.dimension,
      1000, // 1秒延迟
    );
  }

  /**
   * 对查询文本进行embedding
   * @param text 查询文本
   * @returns embedding向量
   */
  async embedQuery(text: string): Promise<number[]> {
    const results = await this.bailianService.embedTexts(
      [text],
      this.dimension,
      'query',
    );
    return results[0] || [];
  }
}
