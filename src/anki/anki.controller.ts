import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  ValidationPipe,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { LoginGuard } from '../login.guard';
import { AnkiService } from './anki.service';
import { CreateAnkiDto } from './dto/create-anki.dto';
import { CreateDeckDto } from './dto/create-deck.dto';
import { SplitAudioDto } from './dto/split-audio.dto';
import { UpdateAnkiDto } from './dto/update-anki.dto';
import { ReviewQuality } from './entities/card.entity';

import { FileInterceptor } from '@nestjs/platform-express';
import { v4 as uuidv4 } from 'uuid';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { CreatePodcastDeckDto } from './dto/create-podcast-deck.dto';
import { DeckConfigDto } from './dto/deck-config.dto';
import { DeckStatus, DeckType } from './entities/deck.entity';
@UseGuards(LoginGuard)
@Controller('anki')
export class AnkiController {
  constructor(
    private readonly ankiService: AnkiService,
    private readonly websocketGateway: WebsocketGateway,
  ) {}

  @Get('getNextCard')
  async getNextCard(@Query('deckId') deckId: string) {
    return await this.ankiService.getNextCard(Number(deckId));
  }

  @Get('getDeckStats')
  async getDeckStats(@Query('deckId') deckId: string) {
    return await this.ankiService.getDeckStats(Number(deckId));
  }

  @Post('updateCardWithSM2/:reviewQuality')
  async updateCardWithSM2(
    @Body() body: UpdateAnkiDto,
    @Param('reviewQuality') reviewQuality: ReviewQuality,
  ) {
    const { id, deckId } = body;
    return await this.ankiService.updateCardWithSM2(deckId, id, reviewQuality);
  }

  @Get('getDecks')
  async getDecks(@Req() req) {
    const userId: number = req?.user?.id;
    return await this.ankiService.getDecks(userId);
  }

  @Post('addCard')
  async addCard(@Body(ValidationPipe) card: CreateAnkiDto) {
    return await this.ankiService.createCard(card);
  }

  @Post('updateCard')
  async updateCard(@Body(ValidationPipe) card: UpdateAnkiDto) {
    return await this.ankiService.updateCard(card);
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

      const newDeck = await this.ankiService.addDeck(deck, userId);
      if (file) {
        const cards = await this.ankiService.parseCardsFile(file);
        const insertedCards = await this.ankiService.addCards(
          cards,
          newDeck.id,
        );
      }
      return newDeck;
      // return this.ankiService.addDeck(deck);
    } catch (e) {
      console.log(e);
      throw e;
    }
  }

  @Post('deleteDeck/:deckId')
  async deleteDeck(@Param('deckId') deckId: number) {
    return await this.ankiService.deleteDeck(deckId);
  }

  @Get('media/:path(*)')
  async getMedia(@Param('path') filePath: string, @Req() req, @Res() res) {
    try {
      const absolutePath = path.join(process.cwd(), filePath);

      // Check if file exists
      if (!fs.existsSync(absolutePath)) {
        return res.status(404).send('File not found');
      }

      // Get file extension
      const ext = path.extname(absolutePath).toLowerCase();

      // Set appropriate content type
      let contentType = 'application/octet-stream';
      switch (ext) {
        case '.mp3':
          contentType = 'audio/mpeg';
          break;
        case '.wav':
          contentType = 'audio/wav';
          break;
        case '.ogg':
          contentType = 'audio/ogg';
          break;
        case '.m4a':
          contentType = 'audio/mp4';
          break;
        case '.jpg':
        case '.jpeg':
          contentType = 'image/jpeg';
          break;
        case '.png':
          contentType = 'image/png';
          break;
        case '.gif':
          contentType = 'image/gif';
          break;
      }

      // Get file stats for Content-Length header
      const stat = fs.statSync(absolutePath);

      // Handle range requests for audio streaming
      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        const chunksize = end - start + 1;
        const file = fs.createReadStream(absolutePath, { start, end });

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': contentType,
        });

        return file.pipe(res);
      }

      // Regular request (non-range)
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': contentType,
        'Content-Disposition': 'inline',
      });

      const fileStream = fs.createReadStream(absolutePath);
      return fileStream.pipe(res);
    } catch (error) {
      console.error('Error serving media:', error);
      return res.status(500).send('Error serving media file');
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
    return await this.ankiService.createAdvancedDeckWithAudio(
      file,
      splitAudioDto,
      userId,
    );
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

  @Post('configureDeck/:deckId')
  async configureDeck(
    @Param('deckId') deckId: number,
    @Body(ValidationPipe) config: DeckConfigDto,
    @Req() req,
  ) {
    const userId: number = req?.user?.id;
    return await this.ankiService.configureDeck(deckId, config, userId);
  }

  @Get('getDeckConfig/:deckId')
  async getDeckConfig(@Param('deckId') deckId: number, @Req() req) {
    const userId: number = req?.user?.id;
    return await this.ankiService.getDeckConfig(deckId, userId);
  }
}
