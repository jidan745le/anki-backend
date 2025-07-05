import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateNoteDto {
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
