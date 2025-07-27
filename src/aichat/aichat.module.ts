import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Card } from 'src/anki/entities/card.entity';
import { UserCard } from 'src/anki/entities/user-cards.entity';
import { EmbeddingModule } from 'src/embedding/embedding.module';
import { AichatController } from './aichat.controller';
import { AichatService } from './aichat.service';
import { ChatMessage } from './entities/chat-message.entity';
import { UserCharacterPreference } from './entities/user-character-preference.entity';
import { VirtualCharacter } from './entities/virtual-character.entity';
@Module({
  imports: [
    TypeOrmModule.forFeature([ChatMessage, Card, UserCard, VirtualCharacter, UserCharacterPreference]),
    EmbeddingModule,
  ],
  controllers: [AichatController],
  providers: [AichatService],
})
export class AichatModule {}

