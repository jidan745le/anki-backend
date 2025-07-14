import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { AIModel } from '../entities/chat-message.entity';

export enum ChatContextType {
  Card = 'Card',
  Deck = 'Deck',
  None = 'None',
}

export enum ChatType {
  Explain = 'Explain',
  Ask = 'Ask',
  Generic = 'Generic',
  WordLookup = 'WordLookup',
}

export enum CharacterType {
  CHIHANA = 'chihana',
  YUKI = 'yuki',
  SAKURA = 'sakura',
}

export class CreateChatMessageDto {
  @IsUUID()
  @IsOptional()
  cardId?: string;

  @IsString()
  @IsOptional()
  chunkId?: string;

  @IsEnum(ChatContextType)
  @IsNotEmpty()
  chatcontext: ChatContextType;

  @IsString()
  @IsOptional()
  contextContent?: string;

  @IsEnum(ChatType)
  @IsNotEmpty()
  chattype: ChatType;

  @IsString()
  @IsOptional()
  selectionText?: string;

  @IsString()
  @IsOptional()
  question: string;

  @IsEnum(AIModel)
  @IsNotEmpty()
  model?: AIModel = AIModel.DS_CHAT;

  @IsEnum(CharacterType)
  @IsOptional()
  character?: CharacterType;

  @IsString()
  @IsOptional()
  socketId?: string;
}
