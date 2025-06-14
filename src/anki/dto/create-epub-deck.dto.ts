import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateEpubDeckDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(100)
  @Max(2000)
  chunkSize?: number = 500; // 文本分割的大小

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(200)
  chunkOverlap?: number = 50; // 文本分割的重叠部分

  @IsOptional()
  @IsString()
  language?: string = 'zh'; // 语言设置，用于更好的文本分割
}
