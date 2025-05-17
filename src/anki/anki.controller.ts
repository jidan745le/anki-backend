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
import { SplitAudioDto } from './dto/split-audio.dto';
import {
  UpdateCardWithFSRSDto,
  UpdateUserCardDto,
} from './dto/update-anki.dto';

import { FileInterceptor } from '@nestjs/platform-express';
import { v4 as uuidv4 } from 'uuid';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { CreatePodcastDeckDto } from './dto/create-podcast-deck.dto';
import { AssignDeckDto } from './dto/user-deck.dto';
import { DeckStatus, DeckType } from './entities/deck.entity';
import { UserDeckService } from './user-deck.service';

@UseGuards(LoginGuard)
@Controller('anki')
export class AnkiController {
  constructor(
    private readonly ankiService: AnkiService,
    private readonly websocketGateway: WebsocketGateway,
    private readonly userDeckService: UserDeckService,
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

      const taskId = uuidv4();
      const newDeck = await this.ankiService.addDeck(
        {
          ...deck,
          taskId,
          status: file ? DeckStatus.PROCESSING : DeckStatus.COMPLETED,
        },
        userId,
      );

      if (file) {
        // 发送初始化任务通知
        setTimeout(() => {
          this.websocketGateway.sendTaskInit(userId, taskId);
        }, 1000);

        // 异步处理卡片导入
        this.ankiService
          .parseCardsFileAndAddToUserDeck(file, newDeck.id, userId, taskId)
          .catch((error) => {
            console.error(
              `Error processing cards for deck ${newDeck.id}:`,
              error,
            );
          });

        // 立即返回响应
        return {
          ...newDeck,
          taskId,
          message: 'Processing started',
        };
      }

      return newDeck;
    } catch (e) {
      console.log(e);
      throw e;
    }
  }

  @Post('deleteDeck/:deckId')
  async deleteDeck(@Param('deckId') deckId: number) {
    return await this.ankiService.deleteDeck(deckId);
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
}
