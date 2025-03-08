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
  chatId: string;

  @IsOptional()
  @IsUUID()
  cardId: string;

  @IsNotEmpty()
  @IsString()
  content: string;

  @IsOptional()
  @IsEnum(AIModel)
  model: AIModel = AIModel.DS_CHAT;

  @IsOptional()
  @IsEnum(ContextMode)
  mode: ContextMode = ContextMode.Local;
}
