import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateNoteDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  noteContent?: string;

  @IsOptional()
  @IsString()
  referenceText?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;
}
