import { Module } from '@nestjs/common';
import { AnkiController } from './anki.controller';
import { AnkiService } from './anki.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Card } from './entities/card.entity';
import { Deck } from './entities/deck.entity';
import { DeckSettings } from './entities/deck-settings.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Card, Deck, DeckSettings])],
  controllers: [AnkiController],
  providers: [AnkiService],
})
export class AnkiModule {}
