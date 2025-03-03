import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmbeddingModule } from '../embedding/embedding.module';
import { AnkiController } from './anki.controller';
import { AnkiService } from './anki.service';
import { Card } from './entities/card.entity';
import { DeckSettings } from './entities/deck-settings.entity';
import { Deck } from './entities/deck.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Card, Deck, DeckSettings]),
    EmbeddingModule,
  ],
  controllers: [AnkiController],
  providers: [AnkiService],
})
export class AnkiModule {}
