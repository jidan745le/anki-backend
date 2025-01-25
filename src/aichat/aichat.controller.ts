import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AichatService } from './aichat.service';
import { CreateAichatDto } from './dto/create-aichat.dto';
import { UpdateAichatDto } from './dto/update-aichat.dto';
import { LoginGuard } from '../login.guard';
import { GetChatMessagesDto } from './dto/get-chat-messages.dto';
import { CreateChatMessageDto } from './dto/create-chat-message.dto';

@UseGuards(LoginGuard)
@Controller('aichat')
export class AichatController {
  constructor(private readonly aichatService: AichatService) {}

  @Get(':chatId/messages')
  async getChatMessages(@Param('chatId') chatId: string) {
    return this.aichatService.getChatMessages(chatId);
  }

  @Post('message')
  async createMessage(
    @Body(ValidationPipe) createMessageDto: CreateChatMessageDto,
  ) {
    return this.aichatService.createMessage(createMessageDto);
  }
}
