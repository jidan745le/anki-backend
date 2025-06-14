import { IsBoolean, IsOptional } from 'class-validator';

export class EmbeddingDeckDto {
  @IsOptional()
  @IsBoolean()
  async?: boolean;
}
