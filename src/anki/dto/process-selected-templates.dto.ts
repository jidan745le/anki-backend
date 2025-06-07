import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsString, ValidateNested } from 'class-validator';
import { CreateDeckDto } from './create-deck.dto';

export class TemplateDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  front: string;

  @IsString()
  back: string;

  count?: number;
  fields?: string[];
  sampleCards?: any[];
}

export class ProcessSelectedTemplatesDto {
  @IsString()
  @IsNotEmpty()
  taskId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateDto)
  selectedTemplates: TemplateDto[];

  @ValidateNested()
  @Type(() => CreateDeckDto)
  deckInfo: CreateDeckDto;
}
