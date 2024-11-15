import { IsEnum, IsNotEmpty, IsOptional, IsString, IsNumber, IsBoolean, IsDecimal, MaxLength } from 'class-validator';

// src/anki/dto/split-audio.dto.ts
export class SplitAudioDto {
    @IsString()
    text: string; // 包含时间戳的文本内容
    
    @IsString()
    name: string; // deck名称
    
    @IsString()
    @IsOptional()
    description?: string; // deck描述
  }