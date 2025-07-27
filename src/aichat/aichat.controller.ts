import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Sse,
  UseGuards,
  ValidationPipe
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { LoginGuard } from '../login.guard';
import { AichatService } from './aichat.service';
import {
  ChatContextType,
  ChatType,
  CreateChatMessageDto,
} from './dto/create-chat-message.dto';
import { AIModel } from './entities/chat-message.entity';

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

  @Post('word-lookup')
  async wordLookup(
    @Body(new ValidationPipe({ transform: true }))
    createMessageDto: any,
  ) {
    // 验证请求参数
    if (createMessageDto.chattype !== ChatType.WordLookup) {
      throw new HttpException(
        'This endpoint is only for word lookup requests',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!createMessageDto.selectionText) {
      throw new HttpException(
        'selectionText is required for word lookup',
        HttpStatus.BAD_REQUEST,
      );
    }

    // 设置默认值 - 默认使用qwen模型进行单词查询
    createMessageDto.chatcontext = ChatContextType.None;
    createMessageDto.model =
      createMessageDto.model || AIModel.QWEN25_32B_INSTRUCT;

    return this.aichatService.createMessage(createMessageDto);
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

  // 打断语音对话接口
  @Post('interrupt/:sessionId')
  async interruptVoiceConversation(@Param('sessionId') sessionId: string) {
    return this.aichatService.interruptVoiceConversation(sessionId);
  }

  // 新增：打断聊天流接口
  @Post('interrupt-chat/:sessionId')
  async interruptChatStream(@Param('sessionId') sessionId: string) {
    return this.aichatService.interruptChatStream(sessionId);
  }

  @Post('interrupt-session/:sessionId')
  async interruptSession(@Param('sessionId') sessionId: string) {
    return this.aichatService.interruptSession(sessionId);
  }

  // 获取可用的陪学虚拟人物列表
  @Get('characters/available')
  async getAvailableCharacters() {
    return this.aichatService.getAvailableCharacters();
  }

  // 为用户激活虚拟人物
  @Post('characters/:characterCode/activate')
  async activateCharacterForUser(
    @Param('characterCode') characterCode: string,
    @Req() req: any,
  ) {
    const userId = req?.user?.id;
    if (!userId) {
      throw new HttpException('User not authenticated', HttpStatus.UNAUTHORIZED);
    }
    return this.aichatService.activateCharacterForUser(userId, characterCode);
  }

  // 获取用户已激活的虚拟人物列表
  @Get('characters/activated')
  async getUserActivatedCharacters(@Req() req: any) {
    const userId = req?.user?.id;
    if (!userId) {
      throw new HttpException('User not authenticated', HttpStatus.UNAUTHORIZED);
    }
    return this.aichatService.getUserActivatedCharacters(userId);
  }
}
