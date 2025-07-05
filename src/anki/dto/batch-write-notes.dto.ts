import { Type } from 'class-transformer';
import {
    IsArray,
    IsBoolean,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
    ValidateNested,
} from 'class-validator';

export class BatchNoteItemDto {
  @IsOptional()
  @IsNumber()
  id?: number; // 如果有ID则为更新，没有ID则为创建

  @IsOptional()
  @IsString()
  uuid?: string; // 用于更新时的标识

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  noteContent: string;

  @IsOptional()
  @IsString()
  referenceText?: string;

  @IsString()
  @IsNotEmpty()
  userCardUuid: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;
}

export class BatchWriteNotesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchNoteItemDto)
  notes: BatchNoteItemDto[];
}
