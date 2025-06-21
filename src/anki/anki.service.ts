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

import { omit } from 'lodash';
import { Grade } from 'ts-fsrs';
import { EntityManager, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { DeckReferenceService } from './deck-reference.service';
import { CreateAnkiDto } from './dto/create-anki.dto';
import { CreateDeckDto } from './dto/create-deck.dto';
import {
  CreatePodcastDeckDto,
  PodcastType,
} from './dto/create-podcast-deck.dto';
import { SplitAudioDto } from './dto/split-audio.dto';
import { UpdateUserCardDto } from './dto/update-anki.dto';
import { Card, ContentType } from './entities/card.entity';
import { DeckSettings } from './entities/deck-settings.entity';
import { Deck, DeckStatus, DeckType } from './entities/deck.entity';
import { CardState, UserCard } from './entities/user-cards.entity';
import { FSRSService } from './fsrs.service';
import { UserDeckService } from './user-deck.service';

export enum LearnOrder {
  RANDOM = 'random',
  SEQUENTIAL = 'sequential',
}

export interface DeckStats {
  newCount: number;
  learningCount: number;
  reviewCount: number;
}

export interface NextCardResponse {
  card: UserCard | { message: 'all_done' } | null;
  stats: DeckStats;
  allCards: UserCardSummary[];
}

interface UserCardSummary {
  uuid: string;
  state: CardState;
  dueDate: Date;
  lastReviewDate: Date | null;
}

const isDevelopment = process.env.NODE_ENV === 'development';
@Injectable()
export class AnkiService implements OnApplicationBootstrap {
  constructor(
    private configService: ConfigService,
    private readonly websocketGateway: WebsocketGateway,
    private readonly embeddingService: EmbeddingService,
    private readonly userDeckService: UserDeckService,
    private readonly websocketService: WebSocketService,
    private readonly deckReferenceService: DeckReferenceService,
    @InjectRepository(UserCard)
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

  async getRandomCard(deckId: number, userId: number) {
    const now = new Date();

    // 70%的概率获取新卡片
    if (Math.random() < 0.7) {
      const newCard = await this.userCardRepository
        .createQueryBuilder('userCard')
        .where('userCard.deck_id = :deckId', { deckId })
        .andWhere('userCard.user_id = :userId', { userId })
        .andWhere('userCard.state = :state', { state: CardState.NEW })
        .orderBy('RAND()') // MySQL的随机排序
        .take(1)
        .getOne();

      if (newCard) {
        return newCard;
      }
    }

    //  30%的概率或没有新卡片时返回学习中的卡片
    const learningCard = await this.userCardRepository
      .createQueryBuilder('userCard')
      .where('userCard.deck_id = :deckId', { deckId })
      .andWhere('userCard.user_id = :userId', { userId })
      .andWhere('userCard.state IN (:...states)', {
        states: [CardState.LEARNING, CardState.RELEARNING],
      })
      .andWhere('userCard.dueDate <= :now', { now })
      .orderBy('userCard.dueDate', 'ASC')
      .take(1)
      .getOne();

    if (learningCard) {
      return learningCard;
    }

    // 没有学习中的卡片，随机获取一张需要复习的卡片
    const reviewCard = await this.userCardRepository
      .createQueryBuilder('userCard')
      .where('userCard.deck_id = :deckId', { deckId })
      .andWhere('userCard.user_id = :userId', { userId })
      .andWhere('userCard.state = :state', { state: CardState.REVIEW })
      .andWhere('userCard.dueDate <= :now', { now })
      .orderBy('userCard.dueDate', 'ASC') // 优先显示最早到期的卡片
      .take(1)
      .getOne();

    if (reviewCard) {
      return reviewCard;
    }

    // 如果没有可复习的卡片，返回任何新卡片
    const fallbackNewCard = await this.userCardRepository
      .createQueryBuilder('userCard')
      .innerJoinAndSelect('userCard.card', 'card')
      .where('userCard.deck_id = :deckId', { deckId })
      .andWhere('userCard.user_id = :userId', { userId })
      .andWhere('userCard.state = :state', { state: CardState.NEW })
      .orderBy('RAND()') // MySQL的随机排序
      .take(1)
      .getOne();

    if (fallbackNewCard) {
      return fallbackNewCard;
    } else {
      const hasCards = await this.userCardRepository
        .createQueryBuilder('userCard')
        .where('userCard.deck_id = :deckId', { deckId })
        .andWhere('userCard.user_id = :userId', { userId })
        .getCount();

      if (hasCards === 0) {
        return null; // 用户没有这个牌组的卡片
      } else {
        return { message: 'all_done' }; // 所有卡片已经学习完成，暂时没有要复习的
      }
    }
  }

  private getDeckStatsCacheKey(userId: number, deckId: number): string {
    return `user:${userId}:deck:${deckId}:cards_summary`;
  }

  // Redis缓存的默认过期时间（秒）
  private CACHE_TTL = 3600; // 1小时

  private async refreshUserDeckCardsInRedis(
    userId: number,
    deckId: number,
  ): Promise<void> {
    const userCards = await this.userCardRepository.find({
      where: { user: { id: userId }, deck: { id: deckId } },
      select: ['uuid', 'state', 'dueDate', 'lastReviewDate'],
    });
    const summaries: UserCardSummary[] = userCards.map((uc) => ({
      uuid: uc.uuid,
      state: uc.state,
      dueDate: uc.dueDate,
      lastReviewDate: uc.lastReviewDate,
    }));
    await this.redisClient.set(
      this.getDeckStatsCacheKey(userId, deckId),
      JSON.stringify(summaries),
      { EX: this.CACHE_TTL }, // 设置过期时间
    );
  }

  private async updateUserCardInRedis(
    userId: number,
    deckId: number,
    updatedCardSummary: UserCardSummary,
  ): Promise<void> {
    const cacheKey = this.getDeckStatsCacheKey(userId, deckId);
    const cachedData = await this.redisClient.get(cacheKey);

    // 如果缓存不存在，则从数据库重新加载
    if (!cachedData) {
      await this.refreshUserDeckCardsInRedis(userId, deckId);
      return;
    }

    const summaries: UserCardSummary[] = JSON.parse(cachedData);
    const index = summaries.findIndex(
      (s) => s.uuid === updatedCardSummary.uuid,
    );
    if (index > -1) {
      summaries[index] = updatedCardSummary;
    } else {
      // 如果找不到卡片，可能是缓存与数据库不同步，重新获取整个列表
      this.logger.warn(
        `Card ${updatedCardSummary.uuid} not found in Redis cache, refreshing cache.`,
      );
      await this.refreshUserDeckCardsInRedis(userId, deckId);
      return;
    }
    await this.redisClient.set(cacheKey, JSON.stringify(summaries), {
      EX: this.CACHE_TTL,
    });
  }

  private async addUserCardToRedis(
    userId: number,
    deckId: number,
    newCardSummary: UserCardSummary,
  ): Promise<void> {
    const cacheKey = this.getDeckStatsCacheKey(userId, deckId);
    const cachedData = await this.redisClient.get(cacheKey);

    // 如果缓存不存在，则从数据库重新加载
    if (!cachedData) {
      await this.refreshUserDeckCardsInRedis(userId, deckId);
      return;
    }

    const summaries: UserCardSummary[] = JSON.parse(cachedData);
    // 避免重复添加相同的卡片
    if (!summaries.find((s) => s.uuid === newCardSummary.uuid)) {
      summaries.push(newCardSummary);
      await this.redisClient.set(cacheKey, JSON.stringify(summaries), {
        EX: this.CACHE_TTL,
      });
    }
  }

  private async calculateDeckStats(
    userId: number,
    deckId: number,
  ): Promise<DeckStats> {
    const cacheKey = this.getDeckStatsCacheKey(userId, deckId);
    const cachedData = await this.redisClient.get(cacheKey);

    // 如果缓存不存在或已过期，则从数据库重新加载
    if (!cachedData) {
      await this.refreshUserDeckCardsInRedis(userId, deckId);
      // 重新从Redis获取刚刚刷新的数据
      const refreshedData = await this.redisClient.get(cacheKey);
      if (!refreshedData) {
        // 如果仍然无法获取，返回默认值
        this.logger.error(
          `Failed to refresh cache for user ${userId}, deck ${deckId}`,
        );
        return { newCount: 0, learningCount: 0, reviewCount: 0 };
      }

      // 继续计算统计信息，现在使用刷新后的数据
      const summaries: UserCardSummary[] = JSON.parse(refreshedData);
      return this.computeStatsFromSummaries(summaries);
    }

    const summaries: UserCardSummary[] = JSON.parse(cachedData);
    return this.computeStatsFromSummaries(summaries);
  }

  // 从卡片摘要计算统计数据的辅助方法
  private computeStatsFromSummaries(summaries: UserCardSummary[]): DeckStats {
    const now = new Date();
    let newCount = 0;
    let learningCount = 0;
    let reviewCount = 0;

    for (const summary of summaries) {
      const dueDate = new Date(summary.dueDate); // 确保dueDate是Date对象
      if (summary.state === CardState.NEW) {
        newCount++;
      } else if (
        (summary.state === CardState.LEARNING ||
          summary.state === CardState.RELEARNING) &&
        dueDate <= now
      ) {
        learningCount++;
      } else if (summary.state === CardState.REVIEW && dueDate <= now) {
        reviewCount++;
      }
    }
    return { newCount, learningCount, reviewCount };
  }

  async getNextCard(
    deckId: number,
    userId: number,
    order: LearnOrder,
    mount: boolean,
  ): Promise<NextCardResponse> {
    if (mount) {
      await this.refreshUserDeckCardsInRedis(userId, deckId);
    }

    const stats = await this.calculateDeckStats(userId, deckId);

    // 获取所有卡片的摘要信息
    const cacheKey = this.getDeckStatsCacheKey(userId, deckId);
    const cachedDataRaw = await this.redisClient.get(cacheKey);
    const allCards: UserCardSummary[] = cachedDataRaw
      ? JSON.parse(cachedDataRaw)
      : [];

    let nextCardToShow: UserCard | { message: 'all_done' } | null;

    if (order === LearnOrder.SEQUENTIAL) {
      // Type assertion or ensure getSequentialCard matches the expected return type more strictly
      nextCardToShow = (await this.getSequentialCard(deckId, userId)) as
        | UserCard
        | { message: 'all_done' }
        | null;
    } else {
      // Type assertion or ensure getRandomCard matches the expected return type more strictly
      nextCardToShow = (await this.getRandomCard(deckId, userId)) as
        | UserCard
        | { message: 'all_done' }
        | null;
    }
    return { card: nextCardToShow, stats, allCards };
  }

  private async getSequentialCard(deckId: number, userId: number) {
    const now = new Date();

    // 50%概率按顺序取新卡片
    if (Math.random() < 0.5) {
      const newCard = await this.userCardRepository
        .createQueryBuilder('userCard')
        .where('userCard.deck_id = :deckId', { deckId })
        .andWhere('userCard.user_id = :userId', { userId })
        .andWhere('userCard.state = :state', { state: CardState.NEW })
        .orderBy('userCard.id', 'ASC') // 按ID顺序
        .take(1)
        .getOne();

      if (newCard) {
        return newCard;
      }
    }

    // 没有新卡片或随机落入另外50%概率，按照以下逻辑获取卡片

    // 1. 先查找过期时间最久的学习/重学卡片
    const learningCard = await this.userCardRepository
      .createQueryBuilder('userCard')
      .where('userCard.deck_id = :deckId', { deckId })
      .andWhere('userCard.user_id = :userId', { userId })
      .andWhere('userCard.state IN (:...states)', {
        states: [CardState.LEARNING, CardState.RELEARNING],
      })
      .andWhere('userCard.dueDate <= :now', { now })
      .orderBy('userCard.dueDate', 'ASC') // 按到期时间升序（最早到期的优先）
      .take(1)
      .getOne();

    if (learningCard) {
      return learningCard;
    }

    // 2. 没有学习/重学卡片，再查找过期时间最久的复习卡片
    const reviewCard = await this.userCardRepository
      .createQueryBuilder('userCard')
      .where('userCard.deck_id = :deckId', { deckId })
      .andWhere('userCard.user_id = :userId', { userId })
      .andWhere('userCard.state = :state', { state: CardState.REVIEW })
      .andWhere('userCard.dueDate <= :now', { now })
      .orderBy('userCard.dueDate', 'ASC') // 按到期时间升序（最早到期的优先）
      .take(1)
      .getOne();

    if (reviewCard) {
      return reviewCard;
    }

    // 3. 最后，如果没有可学习或复习的卡片，获取按ID排序的新卡片
    const fallbackNewCard = await this.userCardRepository
      .createQueryBuilder('userCard')
      .where('userCard.deck_id = :deckId', { deckId })
      .andWhere('userCard.user_id = :userId', { userId })
      .andWhere('userCard.state = :state', { state: CardState.NEW })
      .orderBy('userCard.id', 'ASC') // 按ID顺序获取
      .take(1)
      .getOne();

    if (fallbackNewCard) {
      return fallbackNewCard;
    } else {
      const hasCards = await this.userCardRepository
        .createQueryBuilder('userCard')
        .where('userCard.deck_id = :deckId', { deckId })
        .andWhere('userCard.user_id = :userId', { userId })
        .getCount();

      if (hasCards === 0) {
        return null; // 用户没有这个牌组的卡片
      } else {
        //新的学完了 待学习的还没到期
        return { message: 'all_done' }; // 所有卡片已经学习完成，暂时没有要复习的
      }
    }
  }

  async updateCardWithFSRS(
    userCardUuid: string,
    reviewQuality: Grade,
  ): Promise<UserCard> {
    const userCard = await this.userCardRepository.findOne({
      where: { uuid: userCardUuid },
      relations: ['user', 'deck'],
    });
    if (!userCard) {
      throw new NotFoundException(
        `User card with UUID ${userCardUuid} not found`,
      );
    }

    const userDeck = await this.userDeckService.getUserDeck(
      userCard.user.id,
      userCard.deck.id,
    );

    const reviewResult = await this.fsrsService.updateCardWithRating(
      userCard.id,
      reviewQuality,
      userDeck.fsrsParameters,
    );

    // The fsrsService.updateCardWithRating returns an object containing the updated UserCard
    // and saves it to the database.
    if (reviewResult && reviewResult.card) {
      const updatedUserCard = reviewResult.card;
      await this.updateUserCardInRedis(userCard.user.id, userCard.deck.id, {
        uuid: updatedUserCard.uuid,
        state: updatedUserCard.state,
        dueDate: updatedUserCard.dueDate,
        lastReviewDate: updatedUserCard.lastReviewDate,
      });
      return updatedUserCard; // Return the updated UserCard entity
    } else {
      this.logger.error(
        `FSRS service did not return expected card data structure for ${userCardUuid}.`,
      );
      // This case should ideally not happen if fsrsService is working correctly.
      // Throwing an error or returning the original card with a warning might be options.
      // For now, throwing an error as the update is critical.
      throw new Error(
        `FSRS service failed to return updated card data for ${userCardUuid}`,
      );
    }
  }

  //获取用户所有deck pending to be implemented
  async getDecks(userId: number) {
    const userDecks = await this.userDeckService.getUserDecks(userId);
    // await this.embeddingService.vectorStoreLogger();

    const decksWithStats = await Promise.all(
      userDecks.map(async (userDeck) => {
        if (!userDeck.deck) {
          // Handle cases where a userDeck might not have an associated deck (should ideally not happen)
          this.logger.warn(`UserDeck ${userDeck.id} has no associated deck.`);
          return {
            ...omit(userDeck, 'deck'),
            // deck properties would be undefined here
            stats: { newCount: 0, learningCount: 0, reviewCount: 0 }, // Default stats
          };
        }
        const stats = await this.calculateDeckStats(userId, userDeck.deck.id);
        return {
          ...omit(userDeck, 'deck'), // Spreads properties of userDeck itself (e.g., fsrsParams)
          ...userDeck.deck, // Spreads properties of the actual Deck entity
          owned: userDeck.deck.creatorId === userId,
          status:
            userDeck.deck.creatorId === userId
              ? userDeck.deck.status
              : DeckStatus.COMPLETED,
          stats, // Adds the calculated statistics
        };
      }),
    );

    return decksWithStats;
  }

  async deleteDeck(
    deckId: number,
    userId?: number,
  ): Promise<{
    deleted: boolean;
    message: string;
    type: 'physical' | 'soft';
    stoppedTasks?: string[];
  }> {
    if (!userId) {
      throw new Error('User ID is required for deck deletion');
    }

    // 验证用户是否有权限删除此deck
    const deck = await this.deckRepository.findOne({
      where: { id: deckId },
      withDeleted: false,
    });

    if (!deck) {
      throw new Error('Deck not found');
    }

    // if (deck.creatorId !== userId) {
    //   throw new Error('Only the creator can delete this deck');
    // }

    // 检查是否可以物理删除
    const canPhysicallyDelete =
      await this.deckReferenceService.canPhysicallyDelete(deckId, userId);

    this.logger.log(
      `Deck ${deckId} canPhysicallyDelete: ${canPhysicallyDelete}`,
    );

    if (canPhysicallyDelete) {
      // 物理删除：创造者本人删除且没有其他人使用

      // 首先停止所有相关的embedding任务
      const stoppedTasks = await this.embeddingService.stopDeckTasks(deckId);
      this.logger.log(
        `Stopped ${stoppedTasks.stoppedTasks.length} embedding tasks for deck ${deckId}`,
      );

      await this.deckReferenceService.physicallyDeleteDeck(deckId);
      await this.embeddingService.deleteVectorStore(deckId);

      return {
        deleted: true,
        message: 'Deck has been permanently deleted (no other users)',
        type: 'physical',
        stoppedTasks: stoppedTasks.stoppedTasks,
      };
    } else {
      // 软删除：有其他人在使用
      const activeUserCount =
        await this.deckReferenceService.getActiveUserCount(deckId);

      // 如果是创建者删除，停止相关的embedding任务
      let stoppedTasks: string[] = [];
      if (deck.creatorId === userId) {
        const stoppedTasksResult = await this.embeddingService.stopDeckTasks(
          deckId,
        );
        stoppedTasks = stoppedTasksResult.stoppedTasks;
        this.logger.log(
          `Stopped ${stoppedTasks.length} embedding tasks for deck ${deckId}`,
        );

        await this.deckRepository.update(deckId, { isShared: false });
      }

      // 只删除创造者的UserDeck关系，不删除deck本身
      await this.userDeckService.removeUserDeck(userId, deckId);

      return {
        deleted: true,
        message: `Your access to the deck has been removed (${
          activeUserCount - 1
        } other users still have access)`,
        type: 'soft',
        stoppedTasks: stoppedTasks.length > 0 ? stoppedTasks : undefined,
      };
    }
  }

  async updateUserCard(
    updateUserCardDto: UpdateUserCardDto,
  ): Promise<UserCard> {
    // 查找要更新卡片
    const card = await this.userCardRepository.findOne({
      where: { uuid: updateUserCardDto.id },
    });

    // 如果未找到卡片，抛出 NotFoundException
    if (!card) {
      throw new NotFoundException(
        `Card with ID ${updateUserCardDto.id} not found`,
      );
    }

    // 更新卡片的属性
    Object.assign(card, { customBack: updateUserCardDto.custom_back });

    // 保存更改
    return await this.userCardRepository.save(card);
  }

  //创建deck ~~~~~~~~
  async addDeck(
    createDeckDto: CreateDeckDto,
    userId: number,
  ): Promise<Deck & { user: any }> {
    const newDeck = new Deck();
    Object.assign(newDeck, createDeckDto, { creatorId: userId });
    const deck = await this.deckRepository.save(newDeck);
    await this.userDeckService.assignDeckToUser(userId, deck.id);
    return { ...deck, user: { id: userId } } as Deck & { user: any };
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
        customBack: card.back,
      });

      this.fsrsService.initializeUserCard(userCard);

      userCards.push(userCard);
    }
    // 批量保存用户卡片
    const savedUserCards = await this.userCardRepository.save(userCards);

    // // 异步触发向量存储构建 - 不等待完成
    // const cardTexts = baseCards.map((card) => ({
    //   text: card.back,
    //   front: card.front,
    // }));

    // setImmediate(async () => {
    //   try {
    //     this.logger.log(
    //       `Triggering async vector store building for deck ${deckId}`,
    //     );
    //     await this.embeddingService.buildVectorStore(cardTexts, deckId);
    //   } catch (error) {
    //     this.logger.error(
    //       `Error in async vector store building: ${error.message}`,
    //     );
    //   }
    // });

    // // Refresh Redis cache after adding new cards
    await this.refreshUserDeckCardsInRedis(userId, deckId);

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
    let baseCard: Card;
    let savedBaseCard: Card | null = null;
    const deck = await this.deckRepository.findOne({ where: { id: deckId } });
    this.logger.log(userId, deck.creatorId, 'userId, deck.creatorId');
    if (userId === deck.creatorId) {
      baseCard = cardRepository.create({
        deck: { id: deckId },
        frontType: contentType || ContentType.TEXT,
        front,
        back,
      });
      savedBaseCard = await cardRepository.save(baseCard);
      this.logger.log(
        `Created base card ${savedBaseCard.id} for deck ${deckId}`,
      );
    }

    // 创建用户卡片
    const userCardEntity = this.userCardRepository.create({
      user: { id: userId },
      card: savedBaseCard, // 关联保存的基础卡片
      deck: { id: deckId },
      front: front,
      customBack: back,
    });

    this.fsrsService.initializeUserCard(userCardEntity);

    // 保存用户卡片
    const savedUserCard = await this.userCardRepository.save(userCardEntity);

    // 将新卡片添加到Redis缓存
    if (savedUserCard) {
      await this.addUserCardToRedis(userId, deckId, {
        uuid: savedUserCard.uuid,
        state: savedUserCard.state,
        dueDate: savedUserCard.dueDate,
        lastReviewDate: savedUserCard.lastReviewDate,
      });
    }

    if (savedBaseCard) {
      //本人卡
      await this.embeddingService.addBaseCardToVectorStore(
        savedBaseCard,
        deckId,
      );
    }

    return savedBaseCard; // 返回保存的基础卡片
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
    newDeck: Deck & { user: any },
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
          newDeck as Deck & { user: any },
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
    newDeck: Deck & { user: any },
  ): Promise<{ deck: Partial<Deck> & { stats: any }; cards: Card[] }> {
    try {
      // 1. 调用 Python 服务获取 transcript
      const formData = new FormData();
      formData.append(
        'file',
        new Blob([fs.readFileSync(file.path)]),
        file.originalname,
      );
      console.log(newDeck, 'newDeck.taskId');
      formData.append('taskId', newDeck.taskId);
      formData.append('userId', newDeck.user.id.toString());

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
        newDeck.user.id,
        newDeck.taskId,
        68,
        'building vector store',
      );
      // 构建向量存储
      await this.embeddingService.buildVectorStore(segments, newDeck.id);
      this.websocketGateway.sendProgress(
        newDeck.user.id,
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
          newDeck.user.id,
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
          newDeck.user.id,
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
        newDeck.user.id,
        newDeck.taskId,
        100,
        'Processing complete',
      );

      // Build vector store
      // 不构建向量库，因为已经createcard构建过了
      // await this.embeddingService.buildVectorStore(
      //   cards.map((card) => ({ text: card.back, front: card.front })),
      //   newDeck.id,
      // );

      return { deck: { ...newDeck, stats: {} }, cards };
    } catch (error) {
      throw error;
    }
  }

  private async processThisAmericanLife(
    dto: CreatePodcastDeckDto,
    newDeck: Deck & { user: any },
    onProgress: (progress: number, status: string) => void,
  ): Promise<{ deck: Partial<Deck> & { stats: any }; cards: Card[] }> {
    const cards: Card[] = [];
    const segmentsForVectorStore: any[] = []; // Initialize array for vector store segments

    onProgress(15, 'Launching browser');
    const browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
      ],
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
            newDeck.user.id,
          );

          cards.push(card);

          // Prepare segment for vector store
          const endTime =
            duration !== undefined ? startTime + duration : undefined;
          segmentsForVectorStore.push({
            text: segment.text, // Use raw text for vector store
            front: audioUrl, // Audio URL
            speaker: segment.role, // Speaker information
            start: startTime, // Start time
            end: endTime, // End time
          });

          processedSegments++;
        }
        fs.unlinkSync(filePath); // 删除临时文件

        // 更新状态为完成
        await this.deckRepository.update(newDeck.id, {
          status: DeckStatus.COMPLETED,
        });

        onProgress(95, 'Building vector store');

        // Build vector store
        // 不构建向量库，因为已经createcard构建过了
        // await this.embeddingService.buildVectorStore(
        //   segmentsForVectorStore, // Use the new detailed segments array
        //   newDeck.id,
        // );

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

  async parseCardsFileAndAddToUserDeck(
    file: Express.Multer.File,
    deckId: number,
    userId: number,
    taskId?: string,
    // useEmbedding?: boolean,
  ): Promise<void> {
    try {
      // this.logger.log(
      //   `Starting async card processing for deck ${deckId}, task ${taskId}`,
      // );
      // if (useEmbedding) {
      //   setTimeout(() => {
      //     this.websocketGateway.sendTaskInit(userId, taskId);
      //   }, 1000);
      // }
      // this.websocketGateway.sendTaskInit(userId, taskId);

      // 第一步：解析文件
      // this.websocketGateway.sendProgress(userId, taskId, 10, '正在解析文件...');
      const cards = await this.parseCardsFile(file);

      // // 第二步：开始添加卡片
      // this.websocketGateway.sendProgress(
      //   userId,
      //   taskId,
      //   30,
      //   `已解析 ${cards.length} 张卡片，开始加入牌组...`,
      // );

      // 第三步：处理卡片和向量存储
      // 向 addCardsForUserDeckBatch 传递 taskId 使其能使用 Worker 异步处理向量存储
      await this.addCardsForUserDeckBatch(cards, deckId, userId, taskId, false);

      // 第四步：处理完成 - Worker 会在向量存储完成时发送100%进度
      this.logger.log(
        `Completed async card processing for deck ${deckId}, task ${taskId}`,
      );
    } catch (error) {
      this.logger.error(
        `Error in parseCardsFileAndAddToUserDeck: ${error.message}`,
      );

      // 更新为失败状态
      await this.deckRepository.update(
        { id: deckId },
        { status: DeckStatus.FAILED },
      );

      // 发送错误进度
      this.websocketGateway.sendProgress(
        userId,
        taskId,
        100,
        `处理失败：${error.message}`,
      );

      // 重新抛出错误，让调用方可以捕获
      throw error;
    }
  }

  // 添加卡片批次处理方法
  private async addCardsForUserDeckBatch(
    cards: Card[],
    deckId: number,
    userId: number,
    taskId?: string,
    useEmbedding?: boolean,
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
        customBack: card.back,
      });

      this.fsrsService.initializeUserCard(userCard);
      userCards.push(userCard);
    }

    // 批量保存用户卡片
    const savedUserCards = await this.userCardRepository.save(userCards);
    await this.refreshUserDeckCardsInRedis(userId, deckId);

    // 构建向量存储，使用用户卡片内容
    const cardTexts = baseCards.map((card) => ({
      text: card.back, // 使用基础卡片的背面内容
      front: card.front,
    }));

    if (useEmbedding) {
      // 如果提供了taskId，使用Worker模式异步处理，否则使用同步模式
      if (taskId) {
        // 使用Worker模式 - 传递userId和taskId使其在Worker线程中处理
        await this.embeddingService
          .buildVectorStore(cardTexts, deckId, 20, 1000, 100, userId, taskId)
          .catch((error) => {
            this.logger.error(
              `Error building vector store using worker: ${error.message}`,
            );
          });
      } else {
        // 使用原有同步模式
        await this.embeddingService
          .buildVectorStore(cardTexts, deckId, 20)
          .catch((error) => {
            this.logger.error(`Error building vector store: ${error.message}`);
          });
      }
    }
    return savedUserCards;
  }

  // 分享deck
  async shareDeck(deckId: number, userId: number): Promise<any> {
    const deck = await this.deckRepository.findOne({
      where: { id: deckId, creatorId: userId },
    });

    if (!deck) {
      throw new NotFoundException('Deck not found or you are not the creator');
    }

    deck.isShared = true;
    return await this.deckRepository.save(deck);
  }

  // 获取共享的deck（排除自己的）
  async getSharedDecks(userId: number): Promise<any[]> {
    const sharedDecks = await this.deckRepository
      .createQueryBuilder('deck')
      .where('deck.isShared = :isShared', { isShared: true })
      .andWhere('deck.creatorId != :userId', { userId })
      .leftJoinAndSelect('deck.cards', 'cards')
      .leftJoinAndSelect('deck.creator', 'creator')
      // .leftJoinAndSelect('userDecks.user', 'user')
      .getMany();

    const myDecks = await this.deckRepository
      .createQueryBuilder('deck')
      .where('user.id = :userId', { userId })
      .leftJoinAndSelect('deck.userDecks', 'userDecks')
      .leftJoinAndSelect('deck.cards', 'cards')
      .leftJoinAndSelect('userDecks.user', 'user')
      // .leftJoinAndSelect('deck.creator', 'creator')
      .getMany();
    //shareddecks中有myDecks的deck，则加一个duplicated=true属性
    const duplicatedDecks = sharedDecks.filter((deck) =>
      myDecks.some((myDeck) => myDeck.id === deck.id),
    );
    console.log(duplicatedDecks, 'duplicatedDecks');
    duplicatedDecks.forEach((deck) => {
      (deck as any).duplicated = true;
    });
    console.log(sharedDecks, 'sharedDecks');

    const result = [
      ...sharedDecks.map((deck) => ({
        ...deck,
        totalCards: deck.cards?.length || 0,
        cards: undefined,
      })),
    ];

    return result;
  }

  // 复制shared deck
  async duplicateDeck(deckId: number, userId: number): Promise<Deck> {
    // 检查原deck是否存在且是shared的
    const originalDeck = await this.deckRepository.findOne({
      where: { id: deckId, isShared: true },
      relations: ['cards'],
    });

    if (!originalDeck) {
      throw new NotFoundException('Shared deck not found');
    }

    // 检查用户是否已经有这个deck的关联关系
    const existingUserDeck = await this.userDeckService.getUserDeck(
      userId,
      deckId,
    );
    if (existingUserDeck) {
      throw new Error('You already have access to this deck');
    }

    // 为用户创建用户-deck关系（不创建新的deck，直接关联现有的shared deck）
    await this.userDeckService.assignDeckToUser(userId, deckId);

    // 为用户创建学习记录 - 基于现有的cards
    if (originalDeck.cards && originalDeck.cards.length > 0) {
      await this.createUserCardsForExistingCards(
        originalDeck.cards,
        deckId,
        userId,
      );
    }

    return originalDeck;
  }

  // 为现有卡片创建用户学习记录（不重复创建基础卡片）
  private async createUserCardsForExistingCards(
    existingCards: Card[],
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

    for (const card of existingCards) {
      // 创建用户卡片
      const userCard = this.userCardRepository.create({
        user: { id: userId },
        card, // 直接使用现有的基础卡片
        deck,
        front: card.front, // 从基础卡片复制内容
        customBack: card.back,
      });

      this.fsrsService.initializeUserCard(userCard);
      userCards.push(userCard);
    }

    // 批量保存用户卡片
    const savedUserCards = await this.userCardRepository.save(userCards);

    // Refresh Redis cache after adding new cards
    await this.refreshUserDeckCardsInRedis(userId, deckId);

    return savedUserCards;
  }

  // 分页查询deck中的原始卡片
  async getDeckOriginalCards(
    deckId: number,
    userId: number,
    page = 1,
    limit = 20,
  ): Promise<{
    data: Card[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
    deckInfo: {
      id: number;
      name: string;
      description: string;
      deckType: string;
      isShared: boolean;
      createdAt: Date;
      updatedAt: Date;
      creator: {
        id: number;
        username: string;
      };
      totalCards: number;
    };
  }> {
    // 首先验证用户是否有访问该deck的权限
    const userDeck = await this.userDeckService.getUserDeck(userId, deckId);

    // 查询 deck 信息，包含创建者信息
    const deck = await this.deckRepository.findOne({
      where: { id: deckId },
      relations: ['creator'],
    });

    if (!deck) {
      throw new NotFoundException('Deck not found');
    }

    if (!userDeck && !deck.isShared) {
      throw new NotFoundException('You do not have access to this deck');
    }

    // 计算偏移量
    const skip = (page - 1) * limit;

    // 查询总数
    const total = await this.cardRepository.count({
      where: { deck: { id: deckId } },
    });

    // 分页查询卡片
    const cards = await this.cardRepository.find({
      where: { deck: { id: deckId } },
      order: { createdAt: 'ASC' },
      skip,
      take: limit,
    });

    const totalPages = Math.ceil(total / limit);

    // 构建 deck 信息对象
    const deckInfo = {
      id: deck.id,
      name: deck.name,
      description: deck.description || '',
      deckType: deck.deckType,
      isShared: deck.isShared,
      createdAt: deck.createdAt,
      updatedAt: deck.updatedAt,
      creator: {
        id: deck.creator?.id || deck.creatorId,
        username: deck.creator?.username || 'Unknown',
      },
      totalCards: total,
    };

    return {
      data: cards,
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
      deckInfo,
    };
  }

  /**
   * 根据UUID获取指定的用户卡片
   * @param cardUuid 卡片UUID
   * @param userId 用户ID
   * @param includeStats 是否包含统计信息
   * @param includeAllCards 是否包含所有卡片摘要
   * @returns 卡片详情及可选的统计信息
   */
  async getCardByUuid(
    cardUuid: string,
    userId: number,
    includeStats = true,
    includeAllCards = true,
  ): Promise<NextCardResponse> {
    // 查找指定UUID的用户卡片
    const userCard = await this.userCardRepository.findOne({
      where: {
        uuid: cardUuid,
        user: { id: userId },
      },
      relations: ['card', 'deck', 'user'],
    });

    if (!userCard) {
      throw new NotFoundException(
        `Card with UUID ${cardUuid} not found or you don't have access to it`,
      );
    }

    let stats: DeckStats = { newCount: 0, learningCount: 0, reviewCount: 0 };
    let allCards: UserCardSummary[] = [];

    if (includeStats || includeAllCards) {
      const deckId = userCard.deck.id;

      if (includeStats) {
        stats = await this.calculateDeckStats(userId, deckId);
      }

      if (includeAllCards) {
        const cacheKey = this.getDeckStatsCacheKey(userId, deckId);
        const cachedDataRaw = await this.redisClient.get(cacheKey);
        allCards = cachedDataRaw ? JSON.parse(cachedDataRaw) : [];

        // 如果缓存中没有数据，从数据库获取
        if (allCards.length === 0) {
          await this.refreshUserDeckCardsInRedis(userId, deckId);
          const refreshedData = await this.redisClient.get(cacheKey);
          allCards = refreshedData ? JSON.parse(refreshedData) : [];
        }
      }
    }

    return {
      card: userCard,
      stats,
      allCards,
    };
  }

  /**
   * 为现有deck的所有cards进行embedding
   * @param deckId 牌组ID
   * @param userId 用户ID
   * @param taskId 任务ID（可选，用于异步处理）
   * @returns 处理结果
   */
  async embeddingExistingDeckCards(
    deckId: number,
    userId: number,
    taskId?: string,
  ): Promise<{ totalCards: number }> {
    try {
      // 验证用户是否有权限访问该deck
      const userDeck = await this.userDeckService.getUserDeck(userId, deckId);
      const deck = await this.deckRepository.findOne({
        where: { id: deckId },
        relations: ['cards'],
      });

      if (!deck) {
        throw new NotFoundException(`Deck with ID ${deckId} not found`);
      }

      // 检查用户权限：要么是创建者，要么有用户-deck关系
      if (!userDeck && deck.creatorId !== userId) {
        throw new NotFoundException('You do not have access to this deck');
      }

      // 获取该deck的所有cards
      const cards = await this.cardRepository.find({
        where: { deck: { id: deckId } },
      });

      if (!cards || cards.length === 0) {
        return {
          totalCards: 0,
        };
      }

      this.logger.log(
        `Starting embedding for ${cards.length} cards in deck ${deckId}`,
      );

      // 如果提供了taskId，更新deck状态为处理中
      if (taskId) {
        await this.deckRepository.update(deckId, {
          taskId,
          status: DeckStatus.PROCESSING,
        });
      }

      // 准备embedding数据
      const cardTexts = cards.map((card) => ({
        text: card.back,
        front: card.front,
        id: card.id,
        uuid: card.uuid,
      }));

      // 如果提供了taskId，使用异步处理
      if (taskId) {
        // 发送初始化任务通知
        this.websocketGateway.sendTaskInit(userId, taskId);
        this.websocketGateway.sendProgress(
          userId,
          taskId,
          10,
          `开始为${cards.length}张卡片生成向量嵌入...`,
        );

        // 使用Worker模式异步处理
        await this.embeddingService
          .buildVectorStore(cardTexts, deckId, 20, 1000, 100, userId, taskId)
          .catch(async (error) => {
            this.logger.error(
              `Error building vector store for existing deck: ${error.message}`,
            );

            // 更新deck状态为失败
            await this.deckRepository.update(deckId, {
              status: DeckStatus.FAILED,
            });

            this.websocketGateway.sendProgress(
              userId,
              taskId,
              100,
              `向量嵌入失败: ${error.message}`,
            );
          });

        return {
          totalCards: cards.length,
        };
      }
    } catch (error) {
      this.logger.error(
        `Error embedding existing deck cards: ${error.message}`,
      );

      if (taskId) {
        // 更新deck状态为失败
        await this.deckRepository.update(deckId, {
          status: DeckStatus.FAILED,
        });

        this.websocketGateway.sendProgress(
          userId,
          taskId,
          100,
          `处理失败：${error.message}`,
        );
      }

      throw error;
    }
  }

  /**
   * 更新deck配置
   * @param deckId 牌组ID
   * @param userId 用户ID
   * @param config deck配置
   * @param fsrsParameters FSRS参数
   * @returns 更新结果
   */
  async updateDeckConfig(
    deckId: number,
    userId: number,
    config: { size?: string; align?: string },
    fsrsParameters: any,
  ): Promise<{ success: boolean; message: string }> {
    try {
      // 验证用户是否有权限更新该deck
      const userDeck = await this.userDeckService.getUserDeck(userId, deckId);
      const deck = await this.deckRepository.findOne({
        where: { id: deckId },
      });

      if (!deck) {
        throw new NotFoundException(`Deck with ID ${deckId} not found`);
      }

      // 检查用户权限：必须有用户-deck关系
      if (!userDeck) {
        throw new NotFoundException('You do not have access to this deck');
      }

      // 更新用户的deck配置和FSRS参数
      const updatedFsrsParameters = {
        request_retention: fsrsParameters.request_retention,
        maximum_interval: fsrsParameters.maximum_interval,
        w: fsrsParameters.w || userDeck.fsrsParameters?.w,
        enable_fuzz: fsrsParameters.enable_fuzz ?? true,
        enable_short_term: fsrsParameters.enable_short_term ?? true,
        learning_steps: fsrsParameters.learning_steps,
        relearning_steps: fsrsParameters.relearning_steps,
      };

      await this.userDeckService.updateUserDeckConfigAndFsrsParameters(
        userId,
        deckId,
        config,
        updatedFsrsParameters,
      );

      this.logger.log(
        `Updated config and FSRS parameters for user ${userId}, deck ${deckId}`,
      );

      return {
        success: true,
        message: 'Deck configuration updated successfully',
      };
    } catch (error) {
      this.logger.error(
        `Error updating deck config for deck ${deckId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * 根据deck ID和user ID获取所有user cards的front和uuid
   */
  async getUserCardsFrontAndUuid(
    deckId: number,
    userId: number,
  ): Promise<{ front: string; uuid: string }[]> {
    try {
      // 验证deck是否存在
      const deck = await this.deckRepository.findOne({
        where: { id: deckId },
      });

      if (!deck) {
        throw new NotFoundException('Deck not found');
      }
      console.log(deck.deckType, 'deck.deckType');
      // 检查deck类型，只有书本格式导入的deck才可以查看目录
      if (deck.deckType !== DeckType.BOOK) {
        throw new Error('只有书本格式导入的deck才可以查看目录');
      }

      // 检查用户权限：要么是deck的创建者，要么有该deck的用户deck记录
      const isCreator = deck.creatorId === userId;
      let hasAccess = isCreator;

      if (!isCreator) {
        const userDeck = await this.userDeckService.getUserDeck(userId, deckId);
        hasAccess = !!userDeck;
      }

      if (!hasAccess) {
        throw new Error('You do not have permission to access this deck');
      }

      // 获取所有该用户在该deck下的user cards
      const userCards = await this.userCardRepository.find({
        where: {
          deck: { id: deckId },
          user: { id: userId },
        },
        select: ['front', 'uuid'],
        order: {
          createdAt: 'ASC', // 按创建时间升序排列
        },
      });

      return userCards.map((card) => ({
        front: card.front,
        uuid: card.uuid,
      }));
    } catch (error) {
      this.logger.error(
        `Failed to get user cards front and uuid for deck ${deckId} and user ${userId}:`,
        error.stack,
      );
      throw error;
    }
  }
}
