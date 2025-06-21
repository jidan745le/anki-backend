import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  ValidationPipe,
} from '@nestjs/common';
import { LoginGuard } from '../login.guard';
import { AnkiService, LearnOrder } from './anki.service';
import { CreateAnkiDto } from './dto/create-anki.dto';
import { CreateDeckDto } from './dto/create-deck.dto';
import { ProcessSelectedTemplatesDto } from './dto/process-selected-templates.dto';
import { SplitAudioDto } from './dto/split-audio.dto';
import {
  UpdateCardWithFSRSDto,
  UpdateUserCardDto,
} from './dto/update-anki.dto';

import { FileInterceptor } from '@nestjs/platform-express';
import { v4 as uuidv4 } from 'uuid';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { AnkiApkgService } from './anki-apkg.service';
import { DeckReferenceService } from './deck-reference.service';
import { CreateEpubDeckDto } from './dto/create-epub-deck.dto';
import { CreatePodcastDeckDto } from './dto/create-podcast-deck.dto';
import { UpdateDeckConfigDto } from './dto/update-deck-config.dto';
import { AssignDeckDto } from './dto/user-deck.dto';
import { DeckStatus, DeckType } from './entities/deck.entity';
import { EpubService } from './epub.service';
import { UserDeckService } from './user-deck.service';

@UseGuards(LoginGuard)
@Controller('anki')
export class AnkiController {
  constructor(
    private readonly ankiService: AnkiService,
    private readonly websocketGateway: WebsocketGateway,
    private readonly userDeckService: UserDeckService,
    private readonly ankiApkgService: AnkiApkgService,
    private readonly deckReferenceService: DeckReferenceService,
    private readonly epubService: EpubService,
  ) {}

  @Get('getNextCard')
  async getNextCard(
    @Query('deckId') deckId: string,
    @Query('order') order: LearnOrder = LearnOrder.SEQUENTIAL,
    @Query('mount') mount = 'false',
    @Req() req,
  ) {
    console.log('deckId', deckId);
    console.log('order', order);
    console.log('mount', mount);
    const userId: number = req?.user?.id;
    const isMount = mount === 'true';
    return await this.ankiService.getNextCard(
      Number(deckId),
      userId,
      order,
      isMount,
    );
  }

  @Get('getCard')
  async getCard(
    @Query('uuid') uuid: string,
    @Query('includeStats') includeStats = 'true',
    @Query('includeAllCards') includeAllCards = 'true',
    @Req() req,
  ) {
    const userId: number = req?.user?.id;
    const includeStatsBoolean = includeStats === 'true';
    const includeAllCardsBoolean = includeAllCards === 'true';

    try {
      const result = await this.ankiService.getCardByUuid(
        uuid,
        userId,
        includeStatsBoolean,
        includeAllCardsBoolean,
      );

      return result;
    } catch (error) {
      return {
        success: false,
        data: null,
        message: error.message || 'Failed to retrieve card',
      };
    }
  }

  @Post('updateCardWithFSRS')
  async updateCardWithFSRS(@Body() body: UpdateCardWithFSRSDto) {
    const { userCardId, reviewQuality } = body;
    return await this.ankiService.updateCardWithFSRS(userCardId, reviewQuality);
  }

  @Get('getDecks')
  async getDecks(@Req() req) {
    const userId: number = req?.user?.id;
    return await this.ankiService.getDecks(userId);
  }

  @Post('addCard')
  async addCard(@Body(ValidationPipe) card: CreateAnkiDto, @Req() req) {
    const userId: number = req?.user?.id;
    return await this.ankiService.createCard(card, userId);
  }

  @Post('updateCard')
  async updateCard(@Body(ValidationPipe) card: UpdateUserCardDto) {
    return await this.ankiService.updateUserCard(card);
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      dest: 'uploads',
    }),
  )
  uploadFile(@UploadedFile() file: Express.Multer.File, @Body() body) {
    console.log('body', body);
    console.log('file', file);
  }

  @Post('addDeck')
  @UseInterceptors(
    FileInterceptor('file', {
      dest: 'uploads',
    }),
  )
  async createDeck(
    @UploadedFile() file: Express.Multer.File,
    @Body() deck: CreateDeckDto,
    @Req() req,
  ) {
    try {
      console.log('file', file);
      console.log('deck', deck);
      const userId: number = req?.user?.id;
      console.log('userId', userId);
      const newDeck = await this.ankiService.addDeck(
        {
          ...deck,
        },
        userId,
      );
      if (file.originalname.endsWith('.txt')) {
        // 异步处理卡片导入
        await this.ankiService
          .parseCardsFileAndAddToUserDeck(file, newDeck.id, userId)
          .catch((error) => {
            console.error(
              `Error processing cards for deck ${newDeck.id}:`,
              error,
            );
          });
        return {
          ...newDeck,
        };

        // 立即返回响应
      }
      return {
        ...newDeck,
      };
    } catch (e) {
      console.log(e);
      throw e;
    }
  }

  @Post('deleteDeck/:deckId')
  async deleteDeck(@Param('deckId') deckId: number, @Req() req) {
    const userId: number = req?.user?.id;
    return await this.ankiService.deleteDeck(deckId, userId);
  }

  @Post('parseApkgTemplates')
  @UseInterceptors(
    FileInterceptor('file', {
      dest: 'uploads',
    }),
  )
  async parseApkgTemplates(
    @UploadedFile() file: Express.Multer.File,
    @Req() req,
  ) {
    try {
      const userId: number = req?.user?.id;
      console.log('解析APKG模板:', file.originalname, 'userId:', userId);

      if (!file.originalname.endsWith('.apkg')) {
        throw new Error('文件必须是.apkg格式');
      }

      return await this.ankiApkgService.parseApkgTemplates(file, userId);
    } catch (error) {
      console.error('解析APKG模板失败:', error);
      throw error;
    }
  }

  @Post('processSelectedTemplates')
  async processSelectedTemplates(
    @Body(ValidationPipe) body: ProcessSelectedTemplatesDto,
    @Req() req,
  ) {
    try {
      const userId: number = req?.user?.id;
      console.log('处理选择的模板:', body);

      // 创建牌组
      const taskId = body.taskId;
      const newDeck = await this.ankiService.addDeck(
        {
          ...body.deckInfo,
          taskId,
          status: DeckStatus.PROCESSING,
        },
        userId,
      );

      return await this.ankiApkgService.processSelectedTemplates(
        body.taskId,
        body.selectedTemplates,
        newDeck,
        userId,
      );
    } catch (error) {
      console.error('处理选择的模板失败:', error);
      throw error;
    }
  }

  @Post('createDeckWithAudio')
  @UseInterceptors(
    FileInterceptor('file', {
      dest: 'uploads/temp',
    }),
  )
  async createDeckWithAudio(
    @UploadedFile() file: Express.Multer.File,
    @Body() splitAudioDto: SplitAudioDto,
    @Req() req,
  ) {
    const userId: number = req?.user?.id;
    return await this.ankiService.createDeckWithAudioForOss(
      file,
      splitAudioDto,
      userId,
    );
  }

  @Post('createAdvancedDeckWithAudio')
  @UseInterceptors(
    FileInterceptor('file', {
      dest: 'uploads/temp',
    }),
  )
  async createAdvancedDeckWithAudio(
    @UploadedFile() file: Express.Multer.File,
    @Body() splitAudioDto: SplitAudioDto,
    @Req() req,
  ) {
    const userId: number = req?.user?.id;
    const taskId = uuidv4();
    const newDeck = await this.ankiService.addDeck(
      {
        name: splitAudioDto.name,
        taskId,
        description: splitAudioDto.description,
        deckType: DeckType.AUDIO,
        status: DeckStatus.PROCESSING,
      },
      userId,
    );
    setTimeout(() => {
      this.websocketGateway.sendTaskInit(userId, taskId);
    }, 1000);
    this.ankiService.beginAdvancedDeckWithAudioCreationTask(file, newDeck);
    return {
      taskId: taskId,
      deckId: newDeck.id,
      message: 'Processing started',
    };
  }

  @Post('createDeckWithPodcast')
  @UseInterceptors(
    FileInterceptor('file', {
      dest: 'uploads/temp',
    }),
  )
  async createDeckWithPodcast(
    @UploadedFile() file: Express.Multer.File,
    @Body() deck: CreatePodcastDeckDto,
    @Req() req,
  ) {
    const userId: number = req?.user?.id;
    const taskId = uuidv4();

    const newDeck = await this.ankiService.addDeck(
      {
        name: deck.name,
        taskId,
        description: deck.description,
        deckType: DeckType.AUDIO,
        status: DeckStatus.PROCESSING,
      },
      userId,
    );

    // 使用 process.nextTick 确保在响应返回后再发送 WebSocket 消息
    setTimeout(() => {
      this.websocketGateway.sendTaskInit(userId, taskId);
    }, 1000);

    // Start the async process
    this.ankiService
      .executePodcastTask(file, deck, userId, newDeck)
      .catch((err) => {
        console.error('Error creating podcast deck:', err);
      });

    // Return immediately with the taskId and deckId
    return {
      taskId,
      deckId: newDeck.id,
      message: 'Processing started',
    };
  }

  @Post('user-decks/assign')
  async assignDeckToUser(@Body() assignDeckDto: AssignDeckDto, @Req() req) {
    const userId: number = req?.user?.id;
    return await this.userDeckService.assignDeckToUser(
      userId,
      assignDeckDto.deckId,
      assignDeckDto.fsrsParameters,
    );
  }

  @Get('user-decks')
  async getUserDecks(@Req() req) {
    const userId: number = req?.user?.id;
    return await this.userDeckService.getUserDecks(userId);
  }

  @Get('user-decks/:deckId')
  async getUserDeck(@Param('deckId', ParseIntPipe) deckId: number, @Req() req) {
    const userId: number = req?.user?.id;
    return await this.userDeckService.getUserDeck(userId, deckId);
  }

  @Delete('user-decks/:deckId')
  async removeUserDeck(
    @Param('deckId', ParseIntPipe) deckId: number,
    @Req() req,
  ) {
    const userId: number = req?.user?.id;
    return await this.userDeckService.removeUserDeck(userId, deckId);
  }

  // 分享deck
  @Post('share/:deckId')
  async shareDeck(@Param('deckId', ParseIntPipe) deckId: number, @Req() req) {
    const userId: number = req?.user?.id;
    return await this.ankiService.shareDeck(deckId, userId);
  }

  // 获取共享的deck列表（排除自己的）
  @Get('shared-decks')
  async getSharedDecks(@Req() req) {
    const userId: number = req?.user?.id;
    return await this.ankiService.getSharedDecks(userId);
  }

  // 关联shared deck到用户账户
  @Post('duplicate/:deckId')
  async duplicateDeck(
    @Param('deckId', ParseIntPipe) deckId: number,
    @Req() req,
  ) {
    const userId: number = req?.user?.id;
    return await this.ankiService.duplicateDeck(deckId, userId);
  }

  // 分页查询deck中的原始卡片
  @Get('decks/:deckId/original-cards')
  async getDeckOriginalCards(
    @Param('deckId', ParseIntPipe) deckId: number,
    @Req() req,
    @Query('page') pageParam?: string,
    @Query('limit') limitParam?: string,
  ) {
    const userId: number = req?.user?.id;
    const page = pageParam ? parseInt(pageParam, 10) : 1;
    const limit = limitParam ? parseInt(limitParam, 10) : 20;

    // 验证参数范围
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), 100);

    return await this.ankiService.getDeckOriginalCards(
      deckId,
      userId,
      validPage,
      validLimit,
    );
  }

  // 管理接口：同步所有deck的引用计数
  @Post('admin/sync-reference-count')
  async syncReferenceCount(@Req() req) {
    const userId: number = req?.user?.id;
    // 这里可以添加管理员权限检查
    return await this.deckReferenceService.syncAllReferenceCount();
  }

  @Post('addEpubDeck')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit
      },
    }),
  )
  async createEpubDeck(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateEpubDeckDto,
    @Req() req,
  ) {
    try {
      const userId: number = req?.user?.id;
      this.websocketGateway.sendProgress(
        userId,
        'epub',
        0,
        'Processing EPUB file...',
      );

      console.log('File info:', {
        originalname: file?.originalname,
        mimetype: file?.mimetype,
        size: file?.size,
        bufferLength: file?.buffer?.length,
        hasBuffer: !!file?.buffer,
      });

      if (!file) {
        throw new Error('EPUB file is required');
      }

      if (!file.originalname.toLowerCase().endsWith('.epub')) {
        throw new Error('File must be an EPUB format');
      }

      if (!file.buffer) {
        throw new Error('File buffer is missing. Upload may have failed.');
      }

      // 处理EPUB文件
      // this.websocketGateway.sendProgress(
      //   userId,
      //   'epub',
      //   20,
      //   'Converting EPUB to Markdown...',
      // );
      const result = await this.epubService.processEpubToDeck(
        file,
        dto,
        userId,
      );

      // this.websocketGateway.sendProgress(
      //   userId,
      //   'epub',
      //   100,
      //   'EPUB processing completed',
      // );

      return {
        cardsCount: result.cards.length,
        message: `Successfully created deck "${result.deck.name}" with ${result.cards.length} cards`,
      };
    } catch (error) {
      console.error('EPUB processing error:', error);
      const userId: number = req?.user?.id;
      // this.websocketGateway.sendProgress(
      //   userId,
      //   'epub',
      //   -1,
      //   `Error: ${error.message}`,
      // );
      throw error;
    }
  }

  @Post('embedding/:deckId')
  async embeddingDeckCards(
    @Param('deckId', ParseIntPipe) deckId: number,
    @Req() req,
  ) {
    const userId: number = req?.user?.id;

    try {
      // 异步处理
      const taskId = uuidv4();
      const result = await this.ankiService.embeddingExistingDeckCards(
        deckId,
        userId,
        taskId,
      );

      return {
        ...result,
        taskId,
        async: true,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Failed to process embedding',
        totalCards: 0,
      };
    }
  }

  @Post('updateDeckConfig/:deckId')
  async updateDeckConfig(
    @Param('deckId', ParseIntPipe) deckId: number,
    @Body(ValidationPipe) updateDeckConfigDto: UpdateDeckConfigDto,
    @Req() req,
  ) {
    const userId: number = req?.user?.id;

    try {
      const result = await this.ankiService.updateDeckConfig(
        deckId,
        userId,
        updateDeckConfigDto.config,
        updateDeckConfigDto.fsrsParameters,
      );

      return result;
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Failed to update deck configuration',
      };
    }
  }

  @Get('user-cards/front-and-uuid/:deckId')
  async getUserCardsFrontAndUuid(
    @Param('deckId', ParseIntPipe) deckId: number,
    @Req() req,
  ) {
    const userId: number = req?.user?.id;

    try {
      const result = await this.ankiService.getUserCardsFrontAndUuid(
        deckId,
        userId,
      );

      return result;
    } catch (error) {
      throw error;
    }
  }
}
