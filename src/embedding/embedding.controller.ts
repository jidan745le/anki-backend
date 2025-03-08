import { Controller, Get, Query } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';

@Controller('embedding')
export class EmbeddingController {
  constructor(private readonly embeddingService: EmbeddingService) {}

  @Get('search')
  async search(@Query('query') query: string, @Query('deckId') deckId: number) {
    return this.embeddingService.searchSimilarContent(deckId, query);
  }
}
