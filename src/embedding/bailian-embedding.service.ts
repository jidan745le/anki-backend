import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface BailianEmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
    object: string;
  }>;
  model: string;
  object: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
  id: string;
}

export interface BailianBatchEmbeddingResponse {
  status_code: number;
  request_id: string;
  output: {
    task_id: string;
    task_status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
    url?: string;
    submit_time?: string;
    scheduled_time?: string;
    end_time?: string;
  };
  usage?: {
    total_tokens: number;
  };
}

@Injectable()
export class BailianEmbeddingService {
  private readonly logger = new Logger(BailianEmbeddingService.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://dashscope.aliyuncs.com';
  private readonly model = 'text-embedding-v4';
  private readonly dimension = 2048; // 默认维度，与原有系统保持一致

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('DASHSCOPE_API_KEY');
    if (!this.apiKey) {
      this.logger.warn('DASHSCOPE_API_KEY not found in environment variables');
    }
  }

  /**
   * 同步调用百炼embedding API
   * @param texts 文本数组，最多10条
   * @param dimension 向量维度，默认1024
   * @returns embedding向量数组
   */
  async embedTexts(
    texts: string[],
    dimension?: number,
    textType?: 'query' | 'document',
  ): Promise<number[][]> {
    if (!this.apiKey) {
      throw new Error(
        'DASHSCOPE_API_KEY is required for Bailian embedding service',
      );
    }

    if (texts.length === 0) {
      return [];
    }

    // 百炼API限制：最多10条文本
    if (texts.length > 10) {
      throw new Error('Maximum 10 texts per request for Bailian embedding API');
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/compatible-mode/v1/embeddings`,
        {
          model: this.model,
          input: texts,
          dimension: dimension || this.dimension,
          encoding_format: 'float',
          text_type: textType || 'document',
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000, // 30秒超时
        },
      );

      const result: BailianEmbeddingResponse = response.data;

      // 按index排序确保顺序正确
      const sortedData = result.data.sort((a, b) => a.index - b.index);

      this.logger.log(
        `Successfully embedded ${texts.length} texts, used ${result.usage.total_tokens} tokens`,
      );

      return sortedData.map((item) => item.embedding);
    } catch (error) {
      this.logger.error(
        `Error calling Bailian embedding API: ${error.message}`,
      );
      if (error.response) {
        this.logger.error(`Response status: ${error.response.status}`);
        this.logger.error(
          `Response data: ${JSON.stringify(error.response.data)}`,
        );
      }
      throw error;
    }
  }

  /**
   * 批量处理大量文本的embedding
   * @param texts 文本数组
   * @param batchSize 批次大小，默认10（百炼API限制）
   * @param dimension 向量维度
   * @param delayMs 批次之间的延迟时间（毫秒）
   * @returns embedding向量数组
   */
  async embedTextsBatch(
    texts: string[],
    batchSize = 10,
    dimension?: number,
    delayMs = 1000,
  ): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const results: number[][] = [];
    const totalBatches = Math.ceil(texts.length / batchSize);

    this.logger.log(
      `Starting batch embedding for ${texts.length} texts in ${totalBatches} batches`,
    );

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;

      this.logger.log(
        `Processing batch ${batchNum}/${totalBatches} (${batch.length} texts)`,
      );

      try {
        const batchResults = await this.embedTexts(batch, dimension);
        results.push(...batchResults);

        // 添加延迟避免触发限流
        if (i + batchSize < texts.length && delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      } catch (error) {
        this.logger.error(`Error in batch ${batchNum}: ${error.message}`);
        throw error;
      }
    }

    this.logger.log(
      `Successfully completed batch embedding for ${texts.length} texts`,
    );
    return results;
  }

  /**
   * 创建批处理任务（异步）
   * @param fileUrl 包含文本的文件URL
   * @param textType 文本类型，默认为document
   * @returns 批处理任务信息
   */
  async createBatchEmbeddingTask(
    fileUrl: string,
    textType: 'query' | 'document' = 'document',
  ): Promise<BailianBatchEmbeddingResponse> {
    if (!this.apiKey) {
      throw new Error(
        'DASHSCOPE_API_KEY is required for Bailian embedding service',
      );
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/api/v1/services/embeddings/text-embedding/text-embedding`,
        {
          model: 'text-embedding-async-v2',
          input: {
            url: fileUrl,
          },
          parameters: {
            text_type: textType,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'X-DashScope-Async': 'enable',
          },
          timeout: 30000,
        },
      );

      const result: BailianBatchEmbeddingResponse = response.data;
      this.logger.log(`Created batch embedding task: ${result.output.task_id}`);

      return result;
    } catch (error) {
      this.logger.error(
        `Error creating batch embedding task: ${error.message}`,
      );
      if (error.response) {
        this.logger.error(`Response status: ${error.response.status}`);
        this.logger.error(
          `Response data: ${JSON.stringify(error.response.data)}`,
        );
      }
      throw error;
    }
  }

  /**
   * 查询批处理任务状态
   * @param taskId 任务ID
   * @returns 任务状态信息
   */
  async getBatchTaskStatus(
    taskId: string,
  ): Promise<BailianBatchEmbeddingResponse> {
    if (!this.apiKey) {
      throw new Error(
        'DASHSCOPE_API_KEY is required for Bailian embedding service',
      );
    }

    try {
      const response = await axios.get(
        `${this.baseUrl}/api/v1/tasks/${taskId}`,
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
          timeout: 10000,
        },
      );

      return response.data;
    } catch (error) {
      this.logger.error(`Error getting batch task status: ${error.message}`);
      throw error;
    }
  }

  /**
   * 下载并解析批处理结果
   * @param resultUrl 结果文件URL
   * @returns 解析后的embedding结果
   */
  async downloadBatchResults(resultUrl: string): Promise<
    Array<{
      text_index: number;
      embedding: number[];
      usage: { total_tokens: number };
    }>
  > {
    try {
      const response = await axios.get(resultUrl, {
        responseType: 'text',
        timeout: 60000, // 1分钟超时
      });

      const results = [];
      const lines = response.data.split('\n').filter((line) => line.trim());

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.output && parsed.output.code === 200) {
            results.push({
              text_index: parsed.output.text_index,
              embedding: parsed.output.embedding,
              usage: parsed.output.usage,
            });
          } else {
            this.logger.warn(`Skipping invalid result line: ${line}`);
          }
        } catch (parseError) {
          this.logger.warn(`Error parsing result line: ${line}`);
        }
      }

      this.logger.log(
        `Downloaded and parsed ${results.length} embedding results`,
      );
      return results;
    } catch (error) {
      this.logger.error(`Error downloading batch results: ${error.message}`);
      throw error;
    }
  }
}
