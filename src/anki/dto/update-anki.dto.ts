import { PartialType } from '@nestjs/mapped-types';
import { IsInt, IsString } from 'class-validator';
import { Grade } from 'ts-fsrs';
import { CreateAnkiDto } from './create-anki.dto';
export class UpdateAnkiDto extends PartialType(CreateAnkiDto) {
  @IsInt()
  id: number; // 卡片 ID，作为更新请求的一部分
}

export class UpdateUserCardDto {
  @IsString()
  id: string;

  @IsString()
  custom_back: string;
}

export class UpdateCardWithFSRSDto {
  @IsString()
  userCardId: string;

  @IsInt()
  reviewQuality: Grade;
}
