import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
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
}
