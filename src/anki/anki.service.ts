import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
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
import { User } from 'src/user/entities/user.entity';
import { WebsocketGateway } from 'src/websocket/websocket.gateway';
import { EntityManager, LessThan, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { CreateAnkiDto } from './dto/create-anki.dto';
import { CreateDeckDto } from './dto/create-deck.dto';
import {
  CreatePodcastDeckDto,
  PodcastType,
} from './dto/create-podcast-deck.dto';
import { DeckConfigDto } from './dto/deck-config.dto';
import { SplitAudioDto } from './dto/split-audio.dto';
import { UpdateAnkiDto } from './dto/update-anki.dto';
import {
  Card,
  CardType,
  ContentType,
  ReviewQuality,
} from './entities/card.entity';
import { DeckSettings } from './entities/deck-settings.entity';
import { Deck, DeckStatus, DeckType } from './entities/deck.entity';

@Injectable()
export class AnkiService {
  constructor(
    private configService: ConfigService,
    private readonly websocketGateway: WebsocketGateway,
    private readonly embeddingService: EmbeddingService,
  ) {
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

  async getHello() {
    const value = await this.redisClient.keys('*');
    console.log(value);

    return 'Hello World!';
  }

  private getStatsCacheKey(deckId: number) {
    return `deck:${deckId}:stats`;
  }

  async getDeckStats(deckId: number) {
    const cacheKey = this.getStatsCacheKey(deckId);

    // 尝试从Redis获取缓存
    const cached = await this.redisClient.get(cacheKey);
    console.log(cacheKey, cached, 'stats');

    if (cached) {
      return JSON.parse(cached);
    }

    // 计算新的统计数据
    const stats = await this.calculateStats(deckId);

    // 缓存到Redis，设置5分钟过期
    await this.redisClient.set(cacheKey, JSON.stringify(stats), { EX: 300 });

    return stats;
  }

  private async calculateStats(deckId: number) {
    const now = new Date();

    const [newCardsCount, dueCardsCount, totalReviewCardsCount] =
      await Promise.all([
        this.cardRepository.count({
          where: {
            deck: { id: deckId },
            card_type: CardType.NEW,
          },
        }),
        this.cardRepository.count({
          where: {
            deck: { id: deckId },
            card_type: CardType.REVIEW,
            nextReviewTime: LessThan(now),
          },
        }),
        this.cardRepository.count({
          where: {
            deck: { id: deckId },
            card_type: CardType.REVIEW,
          },
        }),
      ]);

    return {
      newCards: newCardsCount,
      dueCards: dueCardsCount,
      totalReviewCards: totalReviewCardsCount,
      totalCards: newCardsCount + totalReviewCardsCount,
    };
  }

  async getRandomCard(deckId: number) {
    const now = new Date();

    // 70%的概率获取新卡片
    if (Math.random() < 0.7) {
      const newCard = await this.cardRepository
        .createQueryBuilder('card')
        .leftJoinAndSelect('card.chat', 'chat')
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
      .leftJoinAndSelect('card.chat', 'chat')
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
      .leftJoinAndSelect('card.chat', 'chat')
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
      .leftJoinAndSelect('card.chat', 'chat')
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

  async updateStatsCache(deckId: number, cardType: CardType) {
    const cacheKey = this.getStatsCacheKey(deckId);
    const cacheValue = await this.redisClient.get(cacheKey);
    if (!cacheValue) {
      return;
    }
    const deckStats = JSON.parse(cacheValue);

    if (cardType === CardType.NEW) {
      (deckStats.newCards = deckStats.newCards - 1),
        (deckStats.totalReviewCards = deckStats.totalReviewCards + 1);
    } else {
      deckStats.dueCards = deckStats.dueCards - 1;
    }

    this.redisClient.set(cacheKey, JSON.stringify(deckStats), {
      KEEPTTL: true,
    });
  }

  // 添加获取deck settings的缓存方法
  private async getCachedDeckSettings(deckId: number): Promise<DeckSettings> {
    const cacheKey = `deck:${deckId}:settings`;

    // 尝试从缓存获取
    const cachedSettings = await this.redisClient.get(cacheKey);
    if (cachedSettings) {
      return JSON.parse(cachedSettings);
    }

    // 如果缓存中没有，从数据库获取
    const settings = await this.deckSettingsRepository.findOne({
      where: { deck: { id: deckId } },
    });

    // 使用默认值或数据库中的值
    const finalSettings = settings || {
      hardInterval: 1440, // 默认1天
      easyInterval: 4320, // 默认3天
    };

    // 缓存结果，设置1小时过期
    await this.redisClient.set(cacheKey, JSON.stringify(finalSettings), {
      EX: 3600, // 1小时过期
    });

    return finalSettings as DeckSettings;
  }

  // 修改 updateCardWithSM2 方法
  async updateCardWithSM2(
    deckId: number,
    cardId: number,
    quality: ReviewQuality,
  ): Promise<Card> {
    const card = await this.cardRepository.findOne({ where: { id: cardId } });
    if (!card) {
      throw new NotFoundException(`Card with ID ${cardId} not found`);
    }

    const now = new Date();
    this.updateStatsCache(deckId, card.card_type);

    // 获取缓存的deck settings
    const deckSettings = await this.getCachedDeckSettings(deckId);

    // 更新复习次数
    card.repetitions = (card.repetitions || 0) + 1;
    card.lastReviewTime = now;

    // 计算下次复习时间
    const nextReview = new Date(now);

    if (quality < ReviewQuality.HARD) {
      // 如果回答困难，重置复习进度
      card.interval = deckSettings.hardInterval;
      nextReview.setMinutes(nextReview.getMinutes() + card.interval);
      card.card_type = CardType.REVIEW;
      // 降低难度因子，最低为1.3
      card.easeFactor = Math.max(1.3, card.easeFactor - 0.2);
    } else {
      if (card.card_type === CardType.NEW) {
        // 新卡片第一次复习
        card.interval = deckSettings.easyInterval;
        card.card_type = CardType.REVIEW;
      } else {
        // 根据当前间隔和难度因子计算新间隔
        const intervalMultiplier = this.calculateIntervalMultiplier(
          card.repetitions,
          card.easeFactor,
          quality,
        );
        card.interval = Math.round(
          Math.max(card.interval * intervalMultiplier, 1),
        );
      }

      // 应用新间隔
      nextReview.setMinutes(nextReview.getMinutes() + card.interval);

      // 更新难度因子
      card.easeFactor =
        card.easeFactor + (0.1 - (3 - quality) * (0.08 + (3 - quality) * 0.02));
      card.easeFactor = Math.max(1.3, Math.min(2.5, card.easeFactor));
    }

    card.nextReviewTime = nextReview;

    // 保存更新后的卡片
    return await this.cardRepository.save(card);
  }

  private calculateIntervalMultiplier(
    repetitions: number,
    easeFactor: number,
    quality: ReviewQuality,
  ): number {
    // 基础乘数基于复习质量
    let baseMultiplier = 1;

    switch (quality) {
      case ReviewQuality.EASY:
        baseMultiplier = 2.5;
        break;
      case ReviewQuality.GOOD:
        baseMultiplier = 2.0;
        break;
      case ReviewQuality.HARD:
        baseMultiplier = 1.5;
        break;
      default:
        baseMultiplier = 1;
    }

    // 根据复习次数调整间隔
    const repetitionFactor = Math.min(repetitions / 2, 2); // 最多翻倍

    // 考虑难度因子的影响
    const easeFactorNormalized = (easeFactor - 1.3) / 1.2; // 归一化到0-1范围

    // 综合计算最终乘数
    const finalMultiplier =
      baseMultiplier * (1 + repetitionFactor) * (1 + easeFactorNormalized);

    return finalMultiplier;
  }

  async getDecks(userId: number) {
    console.log(userId);

    const results = await this.manager.find(Deck, {
      where: { user: { id: userId } },
      cache: false,
    });

    for (const deck of results) {
      const stats = await this.calculateStats(deck.id);
      await this.redisClient.set(
        this.getStatsCacheKey(deck.id),
        JSON.stringify(stats),
        { EX: 300 },
      );

      Object.assign(deck, { stats });
    }

    return results;
  }

  async deleteDeck(deckId: number): Promise<void> {
    await this.deckRepository.delete(deckId);
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

  async addDeck(createDeckDto: CreateDeckDto, userId: number): Promise<Deck> {
    const newDeck = new Deck();
    const user = new User();
    user.id = userId;
    Object.assign(newDeck, createDeckDto, { user });
    return await this.deckRepository.save(newDeck);
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

  async addCards(cards: Card[], deckId: number): Promise<void> {
    const deck = await this.deckRepository.findOne({ where: { id: deckId } });
    if (!deck) {
      throw new NotFoundException(`Deck with ID ${deckId} not found`);
    }

    // 为每个卡片设置对应的 deckId
    const cardsToSave = cards.map((card) => {
      card.deck = deck; // 假设 Card 实体有一个 deck 属性
      return card;
    });

    await this.cardRepository.save(cardsToSave);
  }
  async createCard(
    dto: CreateAnkiDto & { originalName?: string; contentType?: ContentType },
  ): Promise<Card> {
    const { deckId, front, back, originalName, contentType } = dto;
    return await this.createNormalCard(this.cardRepository, {
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
      deckId: number;
      front: string;
      back: string;
      contentType: ContentType;
    },
  ): Promise<Card> {
    const { deckId, front, back, contentType } = data;

    // 先创建实体实例
    const card = cardRepository.create({
      deck: { id: deckId },
      frontType: contentType || ContentType.TEXT,
      front,
      back,
      card_type: CardType.NEW,
      easeFactor: 2.5,
      interval: 0,
      repetitions: 0,
    });

    // 保存实例
    return await cardRepository.save(card);
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

        const card = await this.createCard({
          deckId: newDeck.id,
          front: audioUrl,
          back: segment.text,
          originalName: ossFileName,
          contentType: ContentType.AUDIO,
        });

        cards.push(card);
      }

      fs.unlinkSync(file.path); // 删除临时文件

      const stats = await this.calculateStats(newDeck.id);
      await this.redisClient.set(
        this.getStatsCacheKey(newDeck.id),
        JSON.stringify(stats),
        { EX: 300 },
      );

      return { deck: { ...newDeck, stats }, cards };
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

  async createAdvancedDeckWithAudio(
    file: Express.Multer.File,
    dto: SplitAudioDto,
    userId: number,
  ): Promise<{ deck: Partial<Deck> & { stats: any }; cards: Card[] }> {
    let newDeck: Deck;
    try {
      newDeck = await this.addDeck(
        {
          name: dto.name,
          description: dto.description,
          deckType: DeckType.AUDIO,
          status: DeckStatus.PROCESSING, // 设置为 processing 状态
        },
        userId,
      );

      // 1. 调用 Python 服务获取 transcript
      const formData = new FormData();
      formData.append(
        'file',
        new Blob([fs.readFileSync(file.path)]),
        file.originalname,
      );

      const response = await axios.post(
        'http://audio-processor:5000/process_audio',
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        },
      );

      const segments = response.data;
      console.log(segments, 'segments');

      // 构建向量存储
      await this.embeddingService.buildVectorStore(segments, newDeck.id);

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

        const audioUrl = await this.cutAndUploadAudioForOss(
          file.path,
          ossPath,
          startTime,
          duration,
        );

        const card = await this.createCard({
          deckId: newDeck.id,
          front: audioUrl,
          back: `${segment.speaker}: ${segment.text}`,
          originalName: ossFileName,
          contentType: ContentType.AUDIO,
        });
        cards.push(card);
      }
      const stats = await this.calculateStats(newDeck.id);
      fs.unlinkSync(file.path); // 删除临时文件
      await this.redisClient.set(
        this.getStatsCacheKey(newDeck.id),
        JSON.stringify(stats),
        { EX: 300 },
      );

      // 更新状态为完成
      await this.deckRepository.update(newDeck.id, {
        status: DeckStatus.COMPLETED,
      });

      return { deck: { ...newDeck, stats }, cards };
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

          const card = await this.createCard({
            deckId: newDeck.id,
            front: audioUrl,
            back: `${segment.role}: ${segment.text}`,
            originalName: ossFileName,
            contentType: ContentType.AUDIO,
          });

          cards.push(card);

          processedSegments++;
        }
        fs.unlinkSync(filePath); // 删除临时文件
        onProgress(90, 'Calculating statistics');
        const stats = await this.calculateStats(newDeck.id);
        await this.redisClient.set(
          this.getStatsCacheKey(newDeck.id),
          JSON.stringify(stats),
          { EX: 300 },
        );

        // 更新状态为完成
        await this.deckRepository.update(newDeck.id, {
          status: DeckStatus.COMPLETED,
        });
        onProgress(100, 'Processing complete');

        return { deck: { ...newDeck, stats }, cards };
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

  // 修改 configureDeck 方法以清除缓存
  async configureDeck(
    deckId: number,
    config: DeckConfigDto,
    userId: number,
  ): Promise<DeckSettings> {
    const deck = await this.deckRepository.findOne({
      where: { id: deckId },
      relations: ['user'],
    });

    if (!deck) {
      throw new NotFoundException(`Deck with ID ${deckId} not found`);
    }

    // Check if user owns the deck
    if (deck.user.id !== userId) {
      throw new ForbiddenException(
        'You do not have permission to configure this deck',
      );
    }

    let settings = await this.deckSettingsRepository.findOne({
      where: { deck: { id: deckId } },
    });

    if (!settings) {
      settings = this.deckSettingsRepository.create({
        deck,
        ...config,
      });
    } else {
      Object.assign(settings, config);
    }

    const settingsResult = await this.deckSettingsRepository.save(settings);

    // 更新后清除缓存
    const cacheKey = `deck:${deckId}:settings`;
    await this.redisClient.del(cacheKey);

    return settingsResult;
  }

  async getDeckConfig(deckId: number, userId: number): Promise<DeckSettings> {
    const deck = await this.deckRepository.findOne({
      where: { id: deckId },
      relations: ['user'],
    });

    if (!deck) {
      throw new NotFoundException(`Deck with ID ${deckId} not found`);
    }

    // Check if user owns the deck
    if (deck.user.id !== userId) {
      throw new ForbiddenException(
        'You do not have permission to view this deck configuration',
      );
    }

    const settings = await this.deckSettingsRepository.findOne({
      where: { deck: { id: deckId } },
    });

    if (!settings) {
      // Return default settings if none exist
      return {
        id: null,
        hardInterval: 1440, // 1 day in minutes
        easyInterval: 4320, // 3 days in minutes
        deck: deck,
      };
    }

    return settings;
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
