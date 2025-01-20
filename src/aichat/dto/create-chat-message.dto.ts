import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { MessageRole, AIModel } from '../entities/chat-message.entity';

export class CreateChatMessageDto {
  @IsOptional()
  @IsUUID()
  chatId: string;

  @IsUUID()
  cardId: string;

  @IsNotEmpty()
  @IsString()
  content: string;

  @IsEnum(AIModel)
  model: AIModel = AIModel.GPT35;
}
