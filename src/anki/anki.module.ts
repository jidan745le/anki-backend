import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmbeddingService } from '../embedding/embedding.service';
import { FileModule } from '../file/file.module';
import { AnkiApkgService } from './anki-apkg.service';
import { AnkiController } from './anki.controller';
import { AnkiService } from './anki.service';
import { DeckReferenceService } from './deck-reference.service';
import { Card } from './entities/card.entity';
import { DeckSettings } from './entities/deck-settings.entity';
import { Deck } from './entities/deck.entity';
import { UserCard } from './entities/user-cards.entity';
import { UserDeck } from './entities/user-deck.entity';
import { EpubService } from './epub.service';
import { FSRSService } from './fsrs.service';
import { UserDeckService } from './user-deck.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Card, Deck, DeckSettings, UserDeck, UserCard]),
    FileModule,
  ],
  controllers: [AnkiController],
  providers: [
    AnkiService,
    UserDeckService,
    DeckReferenceService,
    EmbeddingService,
    FSRSService,
    AnkiApkgService,
    EpubService,
  ],
  exports: [AnkiService, UserDeckService, FSRSService, AnkiApkgService],
})
export class AnkiModule {}
