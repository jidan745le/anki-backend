import { ApiProperty } from '@nestjs/swagger';
import {
    IsArray,
    IsInt,
    IsOptional,
    IsString,
    IsUrl,
    Max,
    Min,
} from 'class-validator';

export class EmbedTextsDto {
  @ApiProperty({
    description: '要进行向量化的文本数组',
    example: ['你好世界', '这是测试文本'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  texts: string[];

  @ApiProperty({
    description: '向量维度',
    example: 1024,
    required: false,
    minimum: 64,
    maximum: 2048,
  })
  @IsOptional()
  @IsInt()
  @Min(64)
  @Max(2048)
  dimension?: number;
}

export class BatchEmbeddingDto {
  @ApiProperty({
    description: '要进行向量化的文本数组',
    example: ['文本1', '文本2', '文本3'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  texts: string[];

  @ApiProperty({
    description: '批次大小，默认10',
    example: 10,
    required: false,
    minimum: 1,
    maximum: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  batchSize?: number;

  @ApiProperty({
    description: '向量维度',
    example: 1024,
    required: false,
    minimum: 64,
    maximum: 2048,
  })
  @IsOptional()
  @IsInt()
  @Min(64)
  @Max(2048)
  dimension?: number;

  @ApiProperty({
    description: '批次间延迟时间(毫秒)',
    example: 1000,
    required: false,
    minimum: 0,
    maximum: 10000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  delayMs?: number;
}

export class BatchTaskDto {
  @ApiProperty({
    description: '包含文本数据的文件URL',
    example: 'https://example.com/texts.txt',
  })
  @IsUrl()
  fileUrl: string;

  @ApiProperty({
    description: '文本类型',
    example: 'document',
    enum: ['query', 'document'],
    required: false,
  })
  @IsOptional()
  @IsString()
  textType?: 'query' | 'document';
}

export class BatchTaskStatusDto {
  @ApiProperty({
    description: '任务ID',
    example: 'task_123456',
  })
  @IsString()
  taskId: string;
}

export class SearchSimilarDto {
  @ApiProperty({
    description: 'Deck ID',
    example: 1,
  })
  @IsInt()
  @Min(1)
  deckId: number;

  @ApiProperty({
    description: '搜索查询',
    example: '什么是机器学习',
  })
  @IsString()
  query: string;

  @ApiProperty({
    description: '返回结果数量',
    example: 5,
    required: false,
    minimum: 1,
    maximum: 20,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  topK?: number;
}

export class GenerateKeywordsDto {
  @ApiProperty({
    description: '要提取关键词的内容',
    example: '这是一段关于人工智能和机器学习的文本内容',
  })
  @IsString()
  content: string;
}

export class RebuildVectorsDto {
  @ApiProperty({
    description: 'Deck ID',
    example: 1,
  })
  @IsInt()
  @Min(1)
  deckId: number;
}

// 响应DTO
export class EmbeddingResponseDto {
  @ApiProperty({
    description: '操作是否成功',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: '响应数据',
  })
  data?: any;

  @ApiProperty({
    description: '错误信息',
    required: false,
  })
  message?: string;
}

export class HealthCheckResponseDto {
  @ApiProperty({
    description: '操作是否成功',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: '健康检查数据',
    example: {
      bailianService: 'healthy',
      vectorDimension: 1024,
      timestamp: '2024-01-01T00:00:00.000Z',
    },
  })
  data: {
    bailianService: 'healthy' | 'unhealthy';
    vectorDimension?: number;
    error?: string;
    timestamp: string;
  };
}
