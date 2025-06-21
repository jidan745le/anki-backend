import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Sse,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { LoginGuard } from '../login.guard';
import { AichatService } from './aichat.service';
import { CreateChatMessageDto } from './dto/create-chat-message.dto';

@UseGuards(LoginGuard)
@Controller('aichat')
export class AichatController {
  constructor(private readonly aichatService: AichatService) {}

  @Get(':chatId/messages')
  async getChatMessages(
    @Param('chatId') chatId: string,
    @Query('chunkId') chunkId: string,
  ) {
    return this.aichatService.getChatMessages(chatId, chunkId);
  }

  @Post('message')
  async createMessage(
    @Body(new ValidationPipe({ transform: true }))
    createMessageDto: CreateChatMessageDto,
  ) {
    return this.aichatService.createMessage(createMessageDto);
  }

  @Post('initSession')
  async createChatSession(
    @Body(new ValidationPipe({ transform: true }))
    createMessageDto: CreateChatMessageDto,
  ) {
    return this.aichatService.createChatSession(createMessageDto);
  }

  // @Public()
  @Sse('stream/:sessionId')
  streamChat(@Param('sessionId') sessionId: string): Observable<any> {
    return this.aichatService.getChatStream(sessionId);
  }

  // @Public()
  @Sse('status/:sessionId')
  getSessionStatus(@Param('sessionId') sessionId: string): Observable<any> {
    return this.aichatService.getSessionStatus(sessionId);
  }
}
