import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Card } from 'src/anki/entities/card.entity';
import { EmbeddingModule } from 'src/embedding/embedding.module';
import { AichatController } from './aichat.controller';
import { AichatService } from './aichat.service';
import { ChatMessage } from './entities/chat-message.entity';
import { Chat } from './entities/chat.entity';
@Module({
  imports: [
    TypeOrmModule.forFeature([Chat, ChatMessage, Card]),
    EmbeddingModule,
  ],
  controllers: [AichatController],
  providers: [AichatService],
})
export class AichatModule {}
