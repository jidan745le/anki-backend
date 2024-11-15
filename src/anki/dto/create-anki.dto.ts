import { IsEnum, IsNotEmpty, IsOptional, IsString, IsInt, IsBoolean, IsDecimal } from 'class-validator';
import { CardType } from '../entities/card.entity'; // 引入 CardType 枚举
import { Type } from 'class-transformer';

export class CreateAnkiDto {
  @IsNotEmpty()
  @IsString()
  front: string; // 卡片正面内容

  @IsNotEmpty()
  @IsString()
  back: string; // 卡片背面内容

  @IsOptional()
  @IsInt()
  interval?: number; // 复习间隔，默认为 0

  @IsOptional()
  @IsDecimal()
  easeFactor?: number; // 难度因子，默认为 2.5

  @IsOptional()
  @IsEnum(CardType)
  card_type?: CardType; // 卡片类型，默认为 NEW

  @IsOptional()
  @IsBoolean()
  reviewed?: boolean; // 是否已复习，默认为 false

  @IsOptional()
  @IsString()
  tags?: string; // 标签，非必填

  @IsNotEmpty()
  @IsInt()
  deckId: number; // 关联的卡组 ID
  
}