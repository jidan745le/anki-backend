import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { InjectEntityManager, InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository, LessThan } from 'typeorm';
import { Card, CardType, ContentType, ReviewQuality } from './entities/card.entity';
import { Deck } from './entities/deck.entity';
import { UpdateAnkiDto } from './dto/update-anki.dto';
import { CreateAnkiDto } from './dto/create-anki.dto';
import { CreateDeckDto } from './dto/create-deck.dto';
import * as fs from 'fs';
import { User } from 'src/user/entities/user.entity';
import { RedisClientType } from 'redis';
import { getFileType, moveFile } from 'src/file/file.util';
import { isUUID } from 'class-validator';
import { v4 as uuidv4 } from 'uuid';
import { SplitAudioDto } from './dto/split-audio.dto';
import * as ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';



@Injectable()
export class AnkiService {

  constructor() {
    // 获取 ffmpeg 路径
    try {
      // console.log(execSync(process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg').toString(),"dddd")
      // const ffmpegPath = execSync(process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg').toString().trim().split('\n')[0];
      // const ffmpegPath = 'C:\\ffmpeg\\bin\\ffmpeg.exe'; // 根据实际安装路径修改

      console.log('FFmpeg path:', ffmpegPath);
      // 设置 ffmpeg 路径
      ffmpeg.setFfmpegPath(ffmpegPath);
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




  async getNextCard(deckId: number) {
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

  async updateStatsCache(deckId: number, cardType: CardType) {
    const cacheKey = this.getStatsCacheKey(deckId);
    // {
    //   newCards: newCardsCount,
    //   dueCards: dueCardsCount,
    //   totalReviewCards: totalReviewCardsCount,
    //   totalCards: newCardsCount + totalReviewCardsCount
    // };
    const deckStats = JSON.parse(await this.redisClient.get(cacheKey));


    if (cardType === CardType.NEW) {
      deckStats.newCards = deckStats.newCards - 1,
        deckStats.totalReviewCards = deckStats.totalReviewCards + 1
    } else {
      deckStats.dueCards = deckStats.dueCards - 1
    }
    this.redisClient.set(cacheKey, JSON.stringify(deckStats));
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

    // 根据 SM-2 算法计算新的间隔和难度因子
    if (quality < ReviewQuality.HARD) {  // 如果回答错误
      card.interval = 1;  // 重置间隔
      card.easeFactor = Math.max(1.3, card.easeFactor - 0.2);  // 降低难度因子，最低为1.3
      card.card_type = CardType.REVIEW;
    } else {
      if (card.card_type === CardType.NEW) {
        // 新卡片的第一次复习
        card.interval = 1;
        card.card_type = CardType.REVIEW;
      } else {
        // 根据当前间隔和难度因子计算新间隔
        if (card.interval === 1) {
          card.interval = 6;  // 第二次复习后间隔6天
        } else {
          card.interval = Math.round(card.interval * card.easeFactor);
        }
      }

      // 根据答题质量调整难度因子
      card.easeFactor = card.easeFactor + (0.1 - (3 - quality) * (0.08 + (3 - quality) * 0.02));
      card.easeFactor = Math.max(1.3, Math.min(2.5, card.easeFactor));  // 保持在1.3-2.5之间
    }

    // 计算下次复习时间
    const nextReview = new Date(now);
    nextReview.setDate(nextReview.getDate() + card.interval);
    card.nextReviewTime = nextReview;

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
    if (isUUID(front)) {
      return await this.createMediaCard(this.cardRepository, { deckId, front, back });
    } else {
      return await this.createTextCard(this.cardRepository, { deckId, front, back,contentType });
    }

  }

  private async createMediaCard(
    cardRepository: Repository<Card>,
    data: { deckId: number; front: string; back: string, originalName?: string }
  ): Promise<Card> {
    const { deckId, front, back, originalName } = data;

    const tempPath = `uploads/temp/${front}-${originalName}`;
    const frontType = await getFileType(tempPath);

    const card = await cardRepository.save({
      deck: { id: deckId },
      frontType,
      front: '',
      back,
      card_type: CardType.NEW,
      easeFactor: 2.5,
      interval: 0,
      repetitions: 0
    });

    const finalPath = `uploads/decks/${deckId}/${front}-${originalName}`;
    await moveFile(tempPath, finalPath);

    await cardRepository.update(card.id, {
      front: finalPath
    });

    return card;
  }

  private async createTextCard(
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

  async createDeckWithAudio(
    file: Express.Multer.File,
    dto: SplitAudioDto,
    userId: number
  ) {
    try {
      // 1. 创建新的deck
      const newDeck = await this.addDeck({
        name: dto.name,
        description: dto.description
      }, userId);

      // 2. 创建输出目录
      const outputDir = `uploads/decks/${newDeck.id}/audio`;
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // 3. 解析时间戳和文本
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

      // 4. 分割音频并创建卡片
      const cards: Card[] = [];
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const nextSegment = segments[i + 1];

        const outputFileName = `${uuidv4()}.mp3`;
        const outputPath = `${outputDir}/${outputFileName}`;

        // 分割音频
        await this.cutAudio(
          file.path,
          outputPath,
          segment.timestamp,
          nextSegment ? nextSegment.timestamp - segment.timestamp : undefined
        );

        // 创建卡片
        const card = await this.createCard({
          deckId: newDeck.id,
          front: outputPath,
          back: segment.text,
          originalName: outputFileName,
          contentType: ContentType.AUDIO
        });

        cards.push(card);
      }

      // 5. 清理临时文件
      fs.unlinkSync(file.path);

      // 6. 更新统计信息缓存
      const stats = await this.calculateStats(newDeck.id);
      await this.redisClient.set(
        this.getStatsCacheKey(newDeck.id),
        JSON.stringify(stats),
        { 'EX': 300 }
      );

      // 7. 返回创建的deck和cards
      return {
        deck: {
          ...newDeck,
          stats
        },
        cards
      };

    } catch (error) {
      // 发生错误时清理已创建的文件
      if (file?.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
      throw error;
    }
  }

  private parseTimestamp(timestamp: string): number {
    const [hours, minutes, seconds] = timestamp.split(':').map(Number);
    return hours * 3600 + minutes * 60 + seconds;
  }

  private async cutAudio(
    inputPath: string,
    outputPath: string,
    start: number,
    duration?: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let command = ffmpeg(inputPath)
        .setStartTime(start);

      if (duration) {
        command = command.setDuration(duration);
      }

      command
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run();
    });
  }


}