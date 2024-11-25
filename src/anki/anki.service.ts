import { Injectable, NotFoundException, Inject, Logger } from '@nestjs/common';
import { InjectEntityManager, InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository, LessThan } from 'typeorm';
import { Card, CardType, ContentType, ReviewQuality } from './entities/card.entity';
import { Deck } from './entities/deck.entity';
import { UpdateAnkiDto } from './dto/update-anki.dto';
import { CreateAnkiDto } from './dto/create-anki.dto';
import { CreateDeckDto } from './dto/create-deck.dto';
import * as fs from 'fs';
import * as path from 'path';
import { User } from 'src/user/entities/user.entity';
import { RedisClientType } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import * as OSS from 'ali-oss';
import { SplitAudioDto } from './dto/split-audio.dto';
import * as ffmpeg from 'fluent-ffmpeg';
import { ConfigService } from '@nestjs/config';
import { execSync } from 'child_process';
import { CreatePodcastDeckDto } from './dto/create-podcast-deck.dto';
import puppeteer from 'puppeteer';
import axios from 'axios';
import { PodcastType } from './dto/create-podcast-deck.dto';
import { DeckType } from './entities/deck.entity';





@Injectable()
export class AnkiService {

  constructor(private configService: ConfigService) {
    // 获取 ffmpeg 路径
    try {
      // console.log(execSync(process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg').toString(),"dddd")
      const ffmpegPath = execSync(process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg').toString().trim().split('\n')[0];
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
  private readonly cardRepository: Repository<Card>

  @InjectRepository(Deck)
  private readonly deckRepository: Repository<Deck>

  @Inject("REDIS_CLIENT")
  private readonly redisClient: RedisClientType

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
    console.log(cacheKey, cached, "stats")

    if (cached) {
      return JSON.parse(cached);
    }

    // 计算新的统计数据
    const stats = await this.calculateStats(deckId);


    // 缓存到Redis，设置5分钟过期
    await this.redisClient.set(cacheKey, JSON.stringify(stats), { 'EX': 300 });

    return stats;
  }

  private async calculateStats(deckId: number) {
    const now = new Date();

    const [newCardsCount, dueCardsCount, totalReviewCardsCount] = await Promise.all([
      this.cardRepository.count({
        where: {
          deck: { id: deckId },
          card_type: CardType.NEW
        }
      }),
      this.cardRepository.count({
        where: {
          deck: { id: deckId },
          card_type: CardType.REVIEW,
          nextReviewTime: LessThan(now)
        }
      }),
      this.cardRepository.count({
        where: {
          deck: { id: deckId },
          card_type: CardType.REVIEW
        }
      })
    ]);

    return {
      newCards: newCardsCount,
      dueCards: dueCardsCount,
      totalReviewCards: totalReviewCardsCount,
      totalCards: newCardsCount + totalReviewCardsCount
    };
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
      .orderBy('RAND()') // MySQL的随机排序
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
        return null;  // deck中没有卡片
      } else {
        return {};//目前已学完
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
    await this.redisClient.set(cacheKey, JSON.stringify(deck), { 'EX': 3600 });

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
        return null;  // deck中没有卡片
      } else {
        return {}; // 目前已学完
      }
    }
  }

  async updateStatsCache(deckId: number, cardType: CardType) {
    const cacheKey = this.getStatsCacheKey(deckId);
    const cacheValue = await this.redisClient.get(cacheKey)
    if (!cacheValue) {
      return;
    }
    const deckStats = JSON.parse(cacheValue);

    if (cardType === CardType.NEW) {
      deckStats.newCards = deckStats.newCards - 1,
        deckStats.totalReviewCards = deckStats.totalReviewCards + 1
    } else {
      deckStats.dueCards = deckStats.dueCards - 1
    }

    this.redisClient.set(cacheKey, JSON.stringify(deckStats), {
      KEEPTTL: true
    });

  }

  async updateCardWithSM2(deckId: number, cardId: number, quality: ReviewQuality): Promise<Card> {
    const card = await this.cardRepository.findOne({ where: { id: cardId } });
    if (!card) {
      throw new NotFoundException(`Card with ID ${cardId} not found`);
    }

    const now = new Date();
    this.updateStatsCache(deckId, card.card_type);

    // 更新复习次数
    card.repetitions = (card.repetitions || 0) + 1;
    card.lastReviewTime = now;

    // 计算下次复习时间
    const nextReview = new Date(now);

    if (quality < ReviewQuality.HARD) {  // 如果回答困难
      // 5分钟后复习
      nextReview.setMinutes(nextReview.getMinutes() + 5);
      card.card_type = CardType.REVIEW;
      // 降低难度因子，最低为1.3
      card.easeFactor = Math.max(1.3, card.easeFactor - 0.2);
    } else {
      if (card.card_type === CardType.NEW) {
        // 新卡片第一次复习，30分钟后
        nextReview.setMinutes(nextReview.getMinutes() + 30);
        card.card_type = CardType.REVIEW;
      } else {
        // 已经复习过的卡片，30分钟后
        nextReview.setMinutes(nextReview.getMinutes() + 30);
      }

      // 保留SM-2算法的难度因子调整逻辑
      card.easeFactor = card.easeFactor + (0.1 - (3 - quality) * (0.08 + (3 - quality) * 0.02));
      card.easeFactor = Math.max(1.3, Math.min(2.5, card.easeFactor));  // 保持在1.3-2.5之间
    }

    card.nextReviewTime = nextReview;
    card.interval = Math.round((nextReview.getTime() - now.getTime()) / (1000 * 60)); // 保存间隔分钟数

    // 可以根据easeFactor稍微调整间隔时间
    if (card.easeFactor > 2.0 && quality >= ReviewQuality.HARD) {
      // 如果难度因子高且回答正确，可以稍微增加间隔
      nextReview.setMinutes(nextReview.getMinutes() + 5);
    }

    // 保存更新后的卡片
    return await this.cardRepository.save(card);
  }

  async getDecks(userId: number) {
    console.log(userId)

    const results = await this.manager.find(Deck, {
      where: { user: { id: userId } }
    });

    for (const deck of results) {
      const stats = await this.calculateStats(deck.id)
      await this.redisClient.set(this.getStatsCacheKey(deck.id), JSON.stringify(stats), { 'EX': 300 });

      Object.assign(deck, { stats })
    }

    return results;
  }

  async deleteDeck(deckId: number): Promise<void> {
    await this.deckRepository.delete(deckId);
  }

  async updateCard(updateAnkiDto: UpdateAnkiDto): Promise<Card> {
    // 查找要更新的卡片
    const card = await this.cardRepository.findOne({ where: { id: updateAnkiDto.id } });

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
      if (line.trim()) {  // Skip empty lines
        const [front, back] = line.split('|').map(part => part.trim());
        if (front && back) {
          const card = new Card();
          card.front = front;
          card.back = back;
          cards.push(card);
        }
      }
    }

    fs.unlinkSync(file.path);  // 删除临时文件

    return cards;
  }

  async addCards(cards: Card[], deckId: number): Promise<void> {
    const deck = await this.deckRepository.findOne({ where: { id: deckId } });
    if (!deck) {
      throw new NotFoundException(`Deck with ID ${deckId} not found`);
    }

    // 为每个卡片设置对应的 deckId
    const cardsToSave = cards.map(card => {
      card.deck = deck; // 假设 Card 实体有一个 deck 属性
      return card;
    });

    await this.cardRepository.save(cardsToSave);
  }
  async createCard(dto: CreateAnkiDto & { originalName?: string, contentType?: ContentType }): Promise<Card> {
    const { deckId, front, back, originalName, contentType } = dto;
    return await this.createNormalCard(this.cardRepository, { deckId, front, back, contentType });
  }

  //create a common card entity
  private async createNormalCard(
    cardRepository: Repository<Card>,
    data: { deckId: number; front: string; back: string, contentType: ContentType }
  ): Promise<Card> {
    const { deckId, front, back, contentType } = data;

    return await cardRepository.save({
      deck: { id: deckId },
      frontType: contentType || ContentType.TEXT,
      front,
      back,
      card_type: CardType.NEW,
      easeFactor: 2.5,
      interval: 0,
      repetitions: 0
    });
  }

  public createOSSClient() {
    if (AnkiService.ossClient) {
      return AnkiService.ossClient;
    }

    AnkiService.ossClient = new OSS({
      region: this.configService.getOrThrow('OSS_REGION'),
      accessKeyId: this.configService.getOrThrow('OSS_ACCESS_KEY_ID'),
      accessKeySecret: this.configService.getOrThrow('OSS_ACCESS_KEY_SECRET'),
      bucket: this.configService.getOrThrow('OSS_BUCKET')
    });
    return AnkiService.ossClient;
  }

  //分割音频直接上传到oss
  public async createDeckWithAudioForOss(
    file: Express.Multer.File,
    dto: SplitAudioDto,
    userId: number
  ) {
    const cards: Card[] = [];

    try {
      const newDeck = await this.addDeck({
        name: dto.name,
        description: dto.description,
        deckType: DeckType.AUDIO
      }, userId);

      const ossPrefix = `decks/${newDeck.id}/audio`;
      const segments = dto.text.split('\n').map(line => {
        const match = line.match(/(\d+:\d+:\d+\.\d+)\|(.*?):(.*)/);
        if (match) {
          const [_, timestamp, speaker, text] = match;
          const timeInSeconds = this.parseTimestamp(timestamp);
          return {
            timestamp: timeInSeconds,
            text: `${speaker}: ${text.trim()}`
          };
        }
        return null;
      }).filter(Boolean);

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
          nextSegment ? nextSegment.timestamp - segment.timestamp : undefined
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

      fs.unlinkSync(file.path);  // 删除临时文件

      const stats = await this.calculateStats(newDeck.id);
      await this.redisClient.set(
        this.getStatsCacheKey(newDeck.id),
        JSON.stringify(stats),
        { 'EX': 300 }
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

      console.log(`Uploaded audio to OSS: ${ossKey}`, tempOutputPath, startTime, duration, typeof duration);


      await new Promise((resolve, reject) => {
        const ffmpegInst = ffmpeg(audioPath)
          .setStartTime(startTime)

        if (duration) {
          ffmpegInst.setDuration(duration)

        }
        ffmpegInst.output(tempOutputPath)
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
        expires: 31536000 // 1 year expiry
      });
      console.log(publicUrl, "publicUrl")
      fs.unlinkSync(tempOutputPath);  // 删除临时文件

      return publicUrl;

    } catch (error) {
      console.error('Error in cutAndUploadAudioForOss:', error);
      throw new Error('Failed to process and upload audio');
    }
  }

  public async createDeckWithPodcast(
    file: Express.Multer.File,
    dto: CreatePodcastDeckDto,
    userId: number
  ): Promise<{ deck: Deck & { stats: any }; cards: Card[] }> {
    if (file) {
      return;
    }

    if (dto.podcastType === PodcastType.AmericanLife) {
      return await this.processThisAmericanLife(dto, userId);
    }

    if (dto.podcastType === PodcastType.Overthink) {
      return
      // await this.processOverthink(dto, userId);
    }

  }

  private async processThisAmericanLife(dto: CreatePodcastDeckDto, userId: number): Promise<{ deck: Deck & { stats: any }; cards: Card[] }> {
    const cards: Card[] = [];

    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const newDeck = await this.addDeck(
        {
          name: dto.name,
          description: dto.description,
          deckType: DeckType.AUDIO
        },
        userId
      );

      const page = await browser.newPage();

      await page.goto(dto.podcastUrl);

      // 提取act-inner中的对话
      const conversations = await page.$$eval(".act-inner > div", (divs) =>
        divs.map((div) => {
          const roleElement = div.querySelector("h4");
          const role = roleElement ? roleElement.textContent.trim() : "";

          const paragraphs = Array.from(div.querySelectorAll("p"));
          const texts = paragraphs.map((p) => p.textContent.trim());
          const begins = paragraphs.map((p) => p.getAttribute("begin"));
          return { role, texts, begins };
        })
      );

      const totalConversations = [];

      conversations.forEach((conversation) => {
        const { role, texts, begins } = conversation;
        texts.forEach((text, index) => {
          const begin = begins[index];
          totalConversations.push({ role, text, begin });
        });
      });

      const main = await page.$(".full-episode.goto.goto-episode");
      const href = await page.evaluate(
        (element) => element.getAttribute("href"),
        main
      );
      await page.goto(`https://www.thisamericanlife.org${href}`);

      const downloadLink = await page.$eval(
        ".download .links-processed.internal",
        (el: HTMLAnchorElement) => el.href
      );

      const downloadPath = path.resolve(process.cwd(), "downloads");
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
          responseType: "stream",
        });

        const fileName = path.basename(audioUrl);
        const filePath = path.join(downloadPath, fileName);

        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
          writer.on("finish", resolve);
          writer.on("error", reject);
        });

        const ossPrefix = `decks/${newDeck.id}/audio`;

        for (let i = 0; i < totalConversations.length; i++) {
          const segment = totalConversations[i];
          const nextSegment = totalConversations[i + 1];

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
            duration
          );
          console.log(audioUrl, "audioUrl")

          const card = await this.createCard({
            deckId: newDeck.id,
            front: audioUrl,
            back: `${segment.role}: ${segment.text}`,
            originalName: ossFileName,
            contentType: ContentType.AUDIO,
          });

          cards.push(card);
        }

        fs.unlinkSync(filePath);  // 删除临时文件

        const stats = await this.calculateStats(newDeck.id);
        await this.redisClient.set(
          this.getStatsCacheKey(newDeck.id),
          JSON.stringify(stats),
          { EX: 300 }
        );

        return { deck: { ...newDeck, stats }, cards };
      } else {
        throw new Error("No audio file found");
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
}