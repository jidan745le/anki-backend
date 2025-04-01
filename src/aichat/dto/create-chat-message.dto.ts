import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { AIModel } from '../entities/chat-message.entity';

export enum ContextMode {
  Local = 'local',
  Global = 'global',
}

export class CreateChatMessageDto {
  @IsOptional()
  @IsUUID()
  cardId: string;

  @IsNotEmpty()
  @IsString()
  content: string;

  @IsOptional()
  @IsEnum(AIModel)
  model: AIModel = AIModel.DS_CHAT;

  //特指一个anki卡中选中的针对selection内容的问答聊天框
  @IsOptional()
  @IsString()
  chunkId: string;

  @IsOptional()
  @IsEnum(ContextMode)
  mode: ContextMode = ContextMode.Local;
}
