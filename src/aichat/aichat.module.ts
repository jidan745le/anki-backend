import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AichatController } from './aichat.controller';
import { AichatService } from './aichat.service';
import { Chat } from './entities/chat.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { Card } from 'src/anki/entities/card.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Chat, ChatMessage, Card])],
  controllers: [AichatController],
  providers: [AichatService],
})
export class AichatModule {}
