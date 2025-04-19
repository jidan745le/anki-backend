import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectEntityManager, InjectRepository } from '@nestjs/typeorm';
import * as OSS from 'ali-oss';
import axios from 'axios';
import { execSync } from 'child_process';
import * as ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import * as path from 'path';
import puppeteer from 'puppeteer';
import { RedisClientType } from 'redis';
import { EmbeddingService } from 'src/embedding/embedding.service';
import { WebsocketGateway } from 'src/websocket/websocket.gateway';
import { WebSocketService } from 'src/websocket/websocket.socket';

import { Grade } from 'ts-fsrs';
import { EntityManager, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { CreateAnkiDto } from './dto/create-anki.dto';
import { CreateDeckDto } from './dto/create-deck.dto';
import {
  CreatePodcastDeckDto,
  PodcastType,
} from './dto/create-podcast-deck.dto';
import { SplitAudioDto } from './dto/split-audio.dto';
import { UpdateAnkiDto } from './dto/update-anki.dto';
import { Card, CardType, ContentType } from './entities/card.entity';
import { DeckSettings } from './entities/deck-settings.entity';
import { Deck, DeckStatus, DeckType } from './entities/deck.entity';
import { UserCard } from './entities/user-cards.entity';
import { FSRSService } from './fsrs.service';
import { UserDeckService } from './user-deck.service';
const isDevelopment = process.env.NODE_ENV === 'development';
@Injectable()
export class AnkiService implements OnApplicationBootstrap {
  constructor(
    private configService: ConfigService,
    private readonly websocketGateway: WebsocketGateway,
    private readonly embeddingService: EmbeddingService,
    private readonly userDeckService: UserDeckService,
    private readonly websocketService: WebSocketService,
    private readonly userCardRepository: Repository<UserCard>,
    private readonly fsrsService: FSRSService,
  ) {
    console.log('AnkiService constructor');
    // 获取 ffmpeg 路径
    try {
      // console.log(execSync(process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg').toString(),"dddd")
      const ffmpegPath = execSync(
        process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg',
      )
        .toString()
        .trim()
        .split('\n')[0];
      // const ffmpegPath = 'C:\\ffmpeg\\bin\\ffmpeg.exe'; // 根据实际安装路径修改
      ffmpeg.setFfmpegPath(ffmpegPath);

      // Verify ffmpeg is working
    } catch (error) {
      console.error('Error setting ffmpeg path:', error);
      throw new Error('Failed to set ffmpeg path');
    }
  }

  @InjectEntityManager()
  private manager: EntityManager;

  @InjectRepository(Card)
  private readonly cardRepository: Repository<Card>;

  @InjectRepository(Deck)
  private readonly deckRepository: Repository<Deck>;

  @InjectRepository(DeckSettings)
  private readonly deckSettingsRepository: Repository<DeckSettings>;

  @Inject('REDIS_CLIENT')
  private readonly redisClient: RedisClientType;

  private static ossClient: any;

  private readonly logger = new Logger(AnkiService.name);

  async onApplicationBootstrap() {
    console.log('AnkiService onApplicationBootstrap');
    const progressNodes = {
      whisper: 10,
      segmentation: 20,
      embeddings: 20,
    };
    this.websocketService.on('connection', () => {
      console.log('WebSocket connected');
    });

    this.websocketService.on('disconnect', () => {
      console.log('WebSocket disconnected');
    });

    this.websocketService.on('whisper_progress', (data) => {
      console.log(`Whisper progress: ${data.progress}% - ${data.message}`);
      // 可以通过 websocketGateway 转发给前端
      this.websocketGateway.sendProgress(
        data.user_id,
        data.task_id,
        Number((10 + progressNodes.whisper * (data.progress / 100)).toFixed(2)),
        data.message,
      );
    });

    this.websocketService.on('diarization_progress', (data) => {
      console.log(`Diarization: ${data.message}`);
      console.log(data.progress, 'data.progress');
      // 可以通过 websocketGateway 转发给前端
      if (data.progress) {
        this.websocketGateway.sendProgress(
          data.user_id,
          data.task_id,
          data.step === 'segmentation'
            ? Number(
                (
                  progressNodes.whisper +
                  progressNodes.segmentation * (data.progress / 100)
                ).toFixed(2),
              )
            : Number(
                (
                  progressNodes.whisper +
                  progressNodes.segmentation +
                  progressNodes.embeddings * (data.progress / 100)
                ).toFixed(2),
              ),
          data.message,
        );
      }
    });

    this.websocketService.on('processing_status', (data) => {
      console.log(`Processing status: ${data.status} - ${data.message}`);
      // 可以通过 websocketGateway 转发给前端
      this.websocketGateway.sendProgress(
        data.user_id,
        data.task_id,
        data.progress,
        data.message,
      );
    });
  }

  async getRandomCard(deckId: number) {
    const now = new Date();

    // 70%的概率获取新卡片
    if (Math.random() < 0.7) {
      const newCard = await this.cardRepository
        .createQueryBuilder('card')
        .where('card.deck_id = :deckId', { deckId })
        .andWhere('card.card_type = :type', { type: CardType.NEW })
        .orderBy('RAND()') // MySQL的随机排序
        .take(1)
        .getOne();

      if (newCard) {
        return newCard;
      }
    }

    // 30%的概率或没有新卡片时，随机获取一张需要复习的卡片
    const reviewCard = await this.cardRepository
      .createQueryBuilder('card')
      .where('card.deck_id = :deckId', { deckId })
      .andWhere('card.card_type = :type', { type: CardType.REVIEW })
      .andWhere('card.nextReviewTime <= :now', { now })
      .orderBy('card.nextReviewTime', 'ASC') // Changed from RAND()
      .take(1)
      .getOne();

    if (reviewCard) {
      return reviewCard;
    }

    // 如果没有复习卡片，返回新卡片
    const fallbackNewCard = await this.cardRepository
      .createQueryBuilder('card')
      .where('card.deck_id = :deckId', { deckId })
      .andWhere('card.card_type = :type', { type: CardType.NEW })
      .orderBy('RAND()') // MySQL的随机排序
      .take(1)
      .getOne();

    if (fallbackNewCard) {
      return fallbackNewCard;
    } else {
      const hasCards = await this.cardRepository
        .createQueryBuilder('card')
        .where('card.deck_id = :deckId', { deckId })
        .getCount();

      if (hasCards === 0) {
        return null; // deck中没有卡片
      } else {
        return {}; //目前已学完
      }
    }
  }

  private async getDeck(deckId: number): Promise<Deck> {
    const cacheKey = `deck:${deckId}`;

    // 尝试从Redis获取缓存
    const cachedDeck = await this.redisClient.get(cacheKey);
    if (cachedDeck) {
      return JSON.parse(cachedDeck);
    }

    // 如果缓存中没有,从数据库获取
    const deck = await this.deckRepository.findOne({ where: { id: deckId } });
    if (!deck) {
      throw new NotFoundException(`Deck with ID ${deckId} not found`);
    }

    // 将deck存入缓存,设置过期时间为1小时
    await this.redisClient.set(cacheKey, JSON.stringify(deck), { EX: 3600 });

    return deck;
  }

  async getNextCard(deckId: number) {
    const deck = await this.getDeck(deckId);

    if (deck.deckType === DeckType.AUDIO) {
      return await this.getSequentialCard(deckId);
    } else {
      return await this.getRandomCard(deckId);
    }
  }

  private async getSequentialCard(deckId: number) {
    const now = new Date();

    const card = await this.cardRepository
      .createQueryBuilder('card')
      .where('card.deck_id = :deckId', { deckId })
      .andWhere('card.nextReviewTime <= :now', { now })
      .orderBy('card.id', 'ASC')
      .take(1)
      .getOne();

    if (card) {
      return card;
    } else {
      const hasCards = await this.cardRepository
        .createQueryBuilder('card')
        .where('card.deck_id = :deckId', { deckId })
        .getCount();

      if (hasCards === 0) {
        return null; // deck中没有卡片
      } else {
        return {}; // 目前已学完
      }
    }
  }

  async updateCardWithFSRS(userCardId: string, reviewQuality: Grade) {
    const userCard = await this.userCardRepository.findOne({
      where: { uuid: userCardId },
    });
    if (!userCard) {
      throw new NotFoundException(`User card with ID ${userCardId} not found`);
    }
    const result = await this.fsrsService.updateCardWithRating(
      userCard.id,
      reviewQuality,
    );
    return result;
  }

  //获取用户所有deck pending to be implemented
  async getDecks(userId: number) {
    console.log(userId);
    const results = await this.userDeckService.getUserDecks(userId);
    return results;
  }

  async deleteDeck(deckId: number): Promise<void> {
    await this.deckRepository.delete(deckId);
    await this.embeddingService.deleteVectorStore(deckId);
  }

  async updateCard(updateAnkiDto: UpdateAnkiDto): Promise<Card> {
    // 查找要更新卡片
    const card = await this.cardRepository.findOne({
      where: { id: updateAnkiDto.id },
    });

    // 如果未找到卡片，抛出 NotFoundException
    if (!card) {
      throw new NotFoundException(`Card with ID ${updateAnkiDto.id} not found`);
    }

    // 更新卡片的属性
    Object.assign(card, updateAnkiDto);

    // 保存更改
    return await this.cardRepository.save(card);
  }

  //创建deck ~~~~~~~~
  async addDeck(createDeckDto: CreateDeckDto, userId: number): Promise<Deck> {
    const newDeck = new Deck();
    Object.assign(newDeck, createDeckDto);
    const deck = await this.deckRepository.save(newDeck);
    await this.userDeckService.assignDeckToUser(userId, deck.id);
    return deck;
  }

  async parseCardsFile(file: Express.Multer.File): Promise<Card[]> {
    const cards: Card[] = [];
    const fileContent = fs.readFileSync(file.path, 'utf8');
    const lines = fileContent.split('\n');

    for (const line of lines) {
      if (line.trim()) {
        // Skip empty lines
        const [front, back] = line.split('|').map((part) => part.trim());
        if (front && back) {
          const card = new Card();
          card.front = front;
          card.back = back;
          cards.push(card);
        }
      }
    }

    fs.unlinkSync(file.path); // 删除临时文件

    return cards;
  }

  /**
   * 为用户添加学习卡片记录
   * @param cards 基础卡片数组
   * @param deckId 牌组ID
   * @param userId 用户ID
   * @returns 创建的用户卡片记录
   */
  async addCardsForUserDeck(
    cards: Card[],
    deckId: number,
    userId: number,
  ): Promise<UserCard[]> {
    // 查找牌组
    const deck = await this.deckRepository.findOne({ where: { id: deckId } });
    if (!deck) {
      throw new NotFoundException(`Deck with ID ${deckId} not found`);
    }

    // 获取用户-牌组关系，主要是获取 FSRS 参数
    const userDeck = await this.userDeckService.getUserDeck(userId, deckId);
    if (!userDeck) {
      throw new NotFoundException(`User-Deck relationship not found`);
    }

    // 为用户创建卡片学习记录
    const userCards: UserCard[] = [];

    const baseCardsToSave = cards.map((card) => {
      return {
        ...card,
        deck,
      };
    });

    const baseCards = await this.cardRepository.save(baseCardsToSave);

    for (const card of baseCards) {
      // 创建用户卡片
      const userCard = this.userCardRepository.create({
        user: { id: userId },
        card,
        deck,
        front: card.front, // 从基础卡片复制内容
        customBack: null, // 初始没有自定义内容
      });

      this.fsrsService.initializeUserCard(userCard);

      userCards.push(userCard);
    }
    // 批量保存用户卡片
    const savedUserCards = await this.userCardRepository.save(userCards);

    // 构建向量存储，使用用户卡片内容
    await this.embeddingService.buildVectorStore(
      baseCards.map((card) => {
        return {
          text: card.back, // 使用基础卡片的背面内容
          front: card.front,
        };
      }),
      deckId,
    );

    return savedUserCards;
  }

  async createCard(
    dto: CreateAnkiDto & { originalName?: string; contentType?: ContentType },
    userId: number,
  ): Promise<Card> {
    const { deckId, front, back, originalName, contentType } = dto;
    return await this.createNormalCard(this.cardRepository, {
      userId,
      deckId,
      front,
      back,
      contentType,
    });
  }

  //create a common card entity
  private async createNormalCard(
    cardRepository: Repository<Card>,
    data: {
      userId: number;
      deckId: number;
      front: string;
      back: string;
      contentType: ContentType;
    },
  ): Promise<Card> {
    const { deckId, front, back, contentType, userId } = data;
    let baseCard;
    const deck = await this.getDeck(deckId);
    if (deck.creatorId === userId) {
      // 如果牌组创作者是用户，则创建卡片到
      const card = cardRepository.create({
        deck: { id: deckId },
        frontType: contentType || ContentType.TEXT,
        front,
        back,
      });

      // 保存实例
      baseCard = await cardRepository.save(card);
    }

    // 保存实例

    // 创建用户卡片
    const userCard = this.userCardRepository.create({
      user: { id: userId },
      card: baseCard || null,
      deck: { id: deckId },
      front: baseCard.front,
      customBack: null,
    });

    this.fsrsService.initializeUserCard(userCard);

    // 保存用户卡片
    await this.userCardRepository.save(userCard);

    return baseCard;
  }

  public createOSSClient() {
    if (AnkiService.ossClient) {
      return AnkiService.ossClient;
    }

    AnkiService.ossClient = new OSS({
      region: this.configService.getOrThrow('OSS_REGION'),
      accessKeyId: this.configService.getOrThrow('OSS_ACCESS_KEY_ID'),
      accessKeySecret: this.configService.getOrThrow('OSS_ACCESS_KEY_SECRET'),
      bucket: this.configService.getOrThrow('OSS_BUCKET'),
    });
    return AnkiService.ossClient;
  }

  //分割音频直接上传到oss
  public async createDeckWithAudioForOss(
    file: Express.Multer.File,
    dto: SplitAudioDto,
    userId: number,
  ) {
    const cards: Card[] = [];

    try {
      const newDeck = await this.addDeck(
        {
          name: dto.name,
          description: dto.description,
          deckType: DeckType.AUDIO,
        },
        userId,
      );

      const ossPrefix = `decks/${newDeck.id}/audio`;
      const segments = dto.text
        .split('\n')
        .map((line) => {
          const match = line.match(/(\d+:\d+:\d+\.\d+)\|(.*?):(.*)/);
          if (match) {
            const [_, timestamp, speaker, text] = match;
            const timeInSeconds = this.parseTimestamp(timestamp);
            return {
              timestamp: timeInSeconds,
              text: `${speaker}: ${text.trim()}`,
            };
          }
          return null;
        })
        .filter(Boolean);

      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const nextSegment = segments[i + 1];

        const ossFileName = `${uuidv4()}.mp3`;
        const ossPath = `${ossPrefix}/${ossFileName}`;

        // 直接切割并上传
        const audioUrl = await this.cutAndUploadAudioForOss(
          file.path,
          ossPath,
          segment.timestamp,
          nextSegment ? nextSegment.timestamp - segment.timestamp : undefined,
        );

        const card = await this.createCard(
          {
            deckId: newDeck.id,
            front: audioUrl,
            back: segment.text,
            originalName: ossFileName,
            contentType: ContentType.AUDIO,
          },
          userId,
        );

        cards.push(card);
      }

      fs.unlinkSync(file.path); // 删除临时文件

      // const stats = await this.calculateStats(newDeck.id);
      // await this.redisClient.set(
      //   this.getStatsCacheKey(newDeck.id),
      //   JSON.stringify(stats),
      //   { EX: 300 },
      // );

      return { deck: { ...newDeck, stats: {} }, cards };
    } catch (error) {
      // 发生错误时删除已上传到OSS的文件
      for (const card of cards || []) {
        try {
          await this.deleteFromOSS(card.front);
        } catch (e) {
          this.logger.error(`Failed to delete OSS file: ${card.front}`, e);
        }
      }
      throw error;
    } finally {
      // 清理所有临时文件
    }
  }

  private async deleteFromOSS(fileUrl: string): Promise<void> {
    try {
      this.logger.debug(`Attempting to delete file from OSS: ${fileUrl}`);

      // Get OSS client
      const ossClient = await this.createOSSClient();

      // Extract object key from URL if it's a full URL
      let objectKey = fileUrl;
      if (fileUrl.includes('http')) {
        const url = new URL(fileUrl);
        objectKey = url.pathname.substring(1); // Remove leading slash
      }

      // Delete the object
      await ossClient.delete(objectKey);

      this.logger.debug(`Successfully deleted file from OSS: ${objectKey}`);
    } catch (error) {
      this.logger.error(`Failed to delete file from OSS: ${fileUrl}`, error);
      throw new Error(`OSS deletion failed: ${error.message}`);
    }
  }
  private parseTimestamp(timestamp: string): number {
    const [hours, minutes, seconds] = timestamp.split(':').map(Number);
    return hours * 3600 + minutes * 60 + seconds;
  }

  async cutAndUploadAudioForOss(
    audioPath: string,
    outputFileName: string,
    startTime: number,
    duration: number,
  ): Promise<string> {
    try {
      const ossClient = await this.createOSSClient();
      const ossKey = `audio/${outputFileName}`;
      const tempOutputPath = `${process.cwd()}/uploads/${outputFileName}`;
      //写一段判断文件是否存在，不存在就创建目录
      const dir = tempOutputPath.substring(0, tempOutputPath.lastIndexOf('/'));
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true }); // recursive: true 表示递归创建
      }

      console.log(
        `Uploaded audio to OSS: ${ossKey}`,
        tempOutputPath,
        startTime,
        duration,
        typeof duration,
      );

      await new Promise((resolve, reject) => {
        const ffmpegInst = ffmpeg(audioPath).setStartTime(startTime);

        if (duration) {
          ffmpegInst.setDuration(duration);
        }
        ffmpegInst
          .output(tempOutputPath)
          .on('end', () => {
            console.log('ffmpeg end');
            resolve(1);
          })
          .on('error', (err) => {
            console.error('ffmpeg error:', err);
            reject(err);
          })
          .run();
      });

      // Upload stream directly to OSS
      await ossClient.put(ossKey, tempOutputPath);

      // Get public URL
      const publicUrl = ossClient.signatureUrl(ossKey, {
        expires: 31536000, // 1 year expiry
      });
      console.log(publicUrl, 'publicUrl');
      fs.unlinkSync(tempOutputPath); // 删除临时文件

      return publicUrl;
    } catch (error) {
      console.error('Error in cutAndUploadAudioForOss:', error);
      throw new Error('Failed to process and upload audio');
    }
  }

  // 执行播客切片插库任务
  public async executePodcastTask(
    file: Express.Multer.File,
    dto: CreatePodcastDeckDto,
    userId: number,
    newDeck: Deck,
  ): Promise<{ deck: Partial<Deck> & { stats: any }; cards: Card[] }> {
    try {
      //创建deck,先返回
      // 发送初始化任务消息
      if (dto.podcastType === PodcastType.AmericanLife) {
        this.websocketGateway.sendProgress(
          userId,
          newDeck.taskId,
          10,
          'Processing This American Life podcast',
        );
        const result = await this.processThisAmericanLife(
          dto,
          newDeck,
          (progress: number, status: string) => {
            this.websocketGateway.sendProgress(
              userId,
              newDeck.taskId,
              progress,
              status,
            );
          },
        );

        return result;
      }

      if (dto.podcastType === PodcastType.Overthink) {
        this.websocketGateway.sendProgress(
          userId,
          newDeck.taskId,
          10,
          'Processing Overthink podcast',
        );
        return;
      }
    } catch (error) {
      // 更新状态为失败
      await this.deckRepository.update(newDeck.id, {
        status: DeckStatus.FAILED,
      });

      this.websocketGateway.sendProgress(
        userId,
        newDeck.taskId,
        -1,
        `Error: ${error.message}`,
      );
      throw error;
    }
  }

  async beginAdvancedDeckWithAudioCreationTask(
    file: Express.Multer.File,
    newDeck: Deck,
  ): Promise<{ deck: Partial<Deck> & { stats: any }; cards: Card[] }> {
    try {
      // 1. 调用 Python 服务获取 transcript
      const formData = new FormData();
      formData.append(
        'file',
        new Blob([fs.readFileSync(file.path)]),
        file.originalname,
      );

      formData.append('taskId', newDeck.taskId);
      formData.append('userId', newDeck.users[0].id.toString());

      const response = await axios
        .post(
          isDevelopment
            ? 'http://8.222.155.238:8080/process_audio'
            : 'http://audio-processor:8080/process_audio',
          formData,
          {
            headers: {
              'Content-Type': 'multipart/form-data',
            },
          },
        )
        .catch((err) => {
          console.log(err, 'err');
          throw new Error('Failed to process audio');
        });

      const segments = response.data;
      console.log(segments, 'segments');
      this.websocketGateway.sendProgress(
        newDeck.users[0].id,
        newDeck.taskId,
        68,
        'building vector store',
      );
      // 构建向量存储
      await this.embeddingService.buildVectorStore(segments, newDeck.id);
      this.websocketGateway.sendProgress(
        newDeck.users[0].id,
        newDeck.taskId,
        70,
        'finished vector store',
      );
      // 3. 处理每个片段
      const cards: Card[] = [];

      // 上传到 OSS

      const ossPrefix = `decks/${newDeck.id}/audio`;

      const totalSegments = segments.length;
      for (let i = 0; i < totalSegments; i++) {
        const segment = segments[i];
        const nextSegment = segments[i + 1];

        const ossFileName = `${uuidv4()}.mp3`;
        const ossPath = `${ossPrefix}/${ossFileName}`;
        const startTime = segment.start;
        const duration = nextSegment
          ? nextSegment.start - startTime
          : undefined;

        this.websocketGateway.sendProgress(
          newDeck.users[0].id,
          newDeck.taskId,
          70 + Math.floor((i / totalSegments) * 20),
          `Processing segment ${i + 1} of ${totalSegments}`,
        );
        const audioUrl = await this.cutAndUploadAudioForOss(
          file.path,
          ossPath,
          startTime,
          duration,
        );

        const card = await this.createCard(
          {
            deckId: newDeck.id,
            front: audioUrl,
            back: `${segment.speaker}: ${segment.text}`,
            originalName: ossFileName,
            contentType: ContentType.AUDIO,
          },
          newDeck.users[0].id,
        );

        cards.push(card);
      }
      // const stats = await this.calculateStats(newDeck.id);
      fs.unlinkSync(file.path); // 删除临时文件
      // await this.redisClient.set(
      //   this.getStatsCacheKey(newDeck.id),
      //   JSON.stringify(stats),
      //   { EX: 300 },
      // );

      // 更新状态为完成
      await this.deckRepository.update(newDeck.id, {
        status: DeckStatus.COMPLETED,
      });
      this.websocketGateway.sendProgress(
        newDeck.users[0].id,
        newDeck.taskId,
        100,
        'Processing complete',
      );

      return { deck: { ...newDeck, stats: {} }, cards };
    } catch (error) {
      throw error;
    }
  }

  private async processThisAmericanLife(
    dto: CreatePodcastDeckDto,
    newDeck: Deck,
    onProgress: (progress: number, status: string) => void,
  ): Promise<{ deck: Partial<Deck> & { stats: any }; cards: Card[] }> {
    const cards: Card[] = [];

    onProgress(15, 'Launching browser');
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      timeout: 60000,
      dumpio: true,
    });

    try {
      onProgress(30, 'Loading podcast page');
      const page = await browser.newPage();
      await page.goto(dto.podcastUrl);

      onProgress(40, 'Extracting conversations');
      // 提取act-inner中的对话
      const conversations = await page.$$eval('.act-inner > div', (divs) =>
        divs.map((div) => {
          const roleElement = div.querySelector('h4');
          const role = roleElement ? roleElement.textContent.trim() : '';

          const paragraphs = Array.from(div.querySelectorAll('p'));
          const texts = paragraphs.map((p) => p.textContent.trim());
          const begins = paragraphs.map((p) => p.getAttribute('begin'));
          return { role, texts, begins };
        }),
      );

      const totalConversations = [];

      conversations.forEach((conversation) => {
        const { role, texts, begins } = conversation;
        texts.forEach((text, index) => {
          const begin = begins[index];
          totalConversations.push({ role, text, begin });
        });
      });

      const main = await page.$('.full-episode.goto.goto-episode');
      const href = await page.evaluate(
        (element) => element.getAttribute('href'),
        main,
      );
      await page.goto(`https://www.thisamericanlife.org${href}`);

      const downloadLink = await page.$eval(
        '.download .links-processed.internal',
        (el: HTMLAnchorElement) => el.href,
      );

      const downloadPath = path.resolve(process.cwd(), 'downloads');
      if (!fs.existsSync(downloadPath)) {
        fs.mkdirSync(downloadPath);
      }

      // 定义正则表达式模式
      const pattern =
        /www\.thisamericanlife\.org\/sites\/default\/files\/audio\/\d+\/[^/]+\/\d+\.mp3/;

      // 使用正则表达式匹配音频文件的 URL
      const match = downloadLink.match(pattern);

      if (match) {
        const audioUrl = match[0];
        const response = await axios.get(`https://${audioUrl}`, {
          responseType: 'stream',
        });

        const fileName = path.basename(audioUrl);
        const filePath = path.join(downloadPath, fileName);

        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
        });

        const ossPrefix = `decks/${newDeck.id}/audio`;
        onProgress(50, 'Processing audio segments');
        let processedSegments = 0;
        const totalSegments = totalConversations.length;

        for (let i = 0; i < totalConversations.length; i++) {
          const segment = totalConversations[i];
          const nextSegment = totalConversations[i + 1];

          onProgress(
            50 + Math.floor((i / totalSegments) * 40),
            `Processing segment ${i + 1} of ${totalSegments}`,
          );
          console.log('Processing segment', segment, 'segment');

          const ossFileName = `${uuidv4()}.mp3`;
          const ossPath = `${ossPrefix}/${ossFileName}`;

          const startTime = this.parseTimestamp(segment.begin);
          const duration = nextSegment
            ? this.parseTimestamp(nextSegment.begin) - startTime
            : undefined;

          const audioUrl = await this.cutAndUploadAudioForOss(
            filePath,
            ossPath,
            startTime,
            duration,
          );
          console.log(audioUrl, 'audioUrl');

          const card = await this.createCard(
            {
              deckId: newDeck.id,
              front: audioUrl,
              back: `${segment.role}: ${segment.text}`,
              originalName: ossFileName,
              contentType: ContentType.AUDIO,
            },
            newDeck.users[0].id,
          );

          cards.push(card);

          processedSegments++;
        }
        fs.unlinkSync(filePath); // 删除临时文件
        onProgress(90, 'Calculating statistics');
        // const stats = await this.calculateStats(newDeck.id);
        // await this.redisClient.set(
        //   this.getStatsCacheKey(newDeck.id),
        //   JSON.stringify(stats),
        //   { EX: 300 },
        // );

        // 更新状态为完成
        await this.deckRepository.update(newDeck.id, {
          status: DeckStatus.COMPLETED,
        });
        onProgress(100, 'Processing complete');

        return { deck: { ...newDeck, stats: {} }, cards };
      }
    } catch (error) {
      for (const card of cards || []) {
        try {
          await this.deleteFromOSS(card.front);
        } catch (e) {
          this.logger.error(`Failed to delete OSS file: ${card.front}`, e);
        }
      }
      throw error;
    } finally {
      await browser.close();
    }
  }

  // 添加相似内容搜索方法
  async findSimilarCards(deckId: number, query: string) {
    const similarContentWithScores =
      await this.embeddingService.searchSimilarContent(deckId, query);

    // 将搜索结果转换为卡片
    const cards = await Promise.all(
      similarContentWithScores.map(async (result) => {
        // 解构 [Document, score] 数组
        const [content, score] = result;

        const card = await this.cardRepository.findOne({
          where: {
            deck: { id: deckId },
            back: content.pageContent,
          },
        });

        // 如果找到卡片，添加相似度分数
        if (card) {
          return {
            ...card,
            similarity: score,
          };
        }

        return null;
      }),
    );

    return cards.filter((card) => card !== null);
  }
}
