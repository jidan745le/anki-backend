import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { CreateDeckDto } from './create-deck.dto';

export class CreateAnkiApkgDto extends CreateDeckDto {
  @IsOptional()
  @IsBoolean()
  preserveNoteStructure?: boolean;

  @IsOptional()
  @IsString()
  importMode?: 'simple' | 'templates'; // Simple = text only, Templates = preserves Anki templates
}
