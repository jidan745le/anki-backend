import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsInt,
  IsBoolean,
  IsDecimal,
  MaxLength,
} from 'class-validator';
import { DeckStatus, DeckType } from '../entities/deck.entity';

export class CreateDeckDto {
  @IsNotEmpty()
  @IsString()
  name: string; // 名字

  @IsNotEmpty()
  @IsString()
  @MaxLength(500, { message: 'Description is too long' })
  description: string; // 描述

  @IsOptional()
  deckType?: DeckType;

  @IsOptional()
  status?: DeckStatus;

  @IsOptional()
  taskId?: string;

  //   user: number; // 用户 ID
}
