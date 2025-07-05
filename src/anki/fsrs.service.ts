import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  createEmptyCard,
  fsrs,
  FSRS,
  Card as FSRSCard,
  generatorParameters,
  Grade,
  State,
} from 'ts-fsrs';
import { Repository } from 'typeorm';
import { CardState, UserCard } from './entities/user-cards.entity';

// 转换 TypeORM CardState 枚举到 ts-fsrs State 枚举
const mapCardStateToFSRSState = (state: number): State => {
  switch (state) {
    case CardState.NEW:
      return State.New;
    case CardState.LEARNING:
      return State.Learning;
    case CardState.REVIEW:
      return State.Review;
    case CardState.RELEARNING:
      return State.Relearning;
    default:
      return State.New;
  }
};

// 转换 ts-fsrs State 枚举到 TypeORM CardState 枚举
const mapFSRSStateToCardState = (state: State): number => {
  switch (state) {
    case State.New:
      return CardState.NEW;
    case State.Learning:
      return CardState.LEARNING;
    case State.Review:
      return CardState.REVIEW;
    case State.Relearning:
      return CardState.RELEARNING;
    default:
      return CardState.NEW;
  }
};

export interface CardReviewResult {
  card: UserCard;
  logRecord: {
    rating: number;
    state: number;
    due: Date;
    stability: number;
    difficulty: number;
    elapsed_days: number;
    last_elapsed_days: number;
    scheduled_days: number;
    review: Date;
  };
}

@Injectable()
export class FSRSService {
  constructor(
    @InjectRepository(UserCard)
    private userCardRepository: Repository<UserCard>,
  ) {}

  /**
   * 初始化用户卡片，设置初始FSRS参数
   */
  initializeUserCard(userCard: UserCard): UserCard {
    const now = new Date();

    // 创建空卡片获取初始参数
    const emptyCard = createEmptyCard(now);
    // console.log(emptyCard, emptyCard.due, 'emptyCard');

    // 设置初始FSRS参数
    userCard.dueDate = emptyCard.due;
    userCard.stability = emptyCard.stability;
    userCard.difficulty = emptyCard.difficulty;
    userCard.elapsedDays = emptyCard.elapsed_days;
    userCard.scheduledDays = emptyCard.scheduled_days;
    userCard.learningSteps = emptyCard.learning_steps;
    userCard.reps = emptyCard.reps;
    userCard.lapses = emptyCard.lapses;
    userCard.state = mapFSRSStateToCardState(emptyCard.state);
    userCard.lastReviewDate = null;

    return userCard;
  }

  /**
   * 从UserCard实体创建FSRS卡片对象
   */
  createFSRSCardFromUserCard(userCard: UserCard): FSRSCard {
    console.log(userCard, 'userCard');
    return {
      due: userCard.dueDate,
      stability: userCard.stability,
      difficulty: userCard.difficulty,
      elapsed_days: userCard.elapsedDays,
      scheduled_days: userCard.scheduledDays,
      reps: userCard.reps,
      lapses: userCard.lapses,
      state: mapCardStateToFSRSState(userCard.state),
      last_review: userCard.lastReviewDate || undefined,
      learning_steps: userCard.learningSteps || 0,
    };
  }

  /**
   * 批量初始化用户卡片
   */
  async batchInitializeUserCards(userCards: UserCard[]): Promise<UserCard[]> {
    userCards.forEach((card) => this.initializeUserCard(card));
    return await this.userCardRepository.save(userCards);
  }

  /**
   * 根据用户的牌组设置创建FSRS实例
   */
  createFSRSInstance(fsrsParams?: any): FSRS {
    console.log(fsrsParams, 'fsrsParams');
    // 使用用户自定义参数或默认参数
    const params = generatorParameters({
      request_retention: fsrsParams?.request_retention || 0.9,
      maximum_interval: fsrsParams?.maximum_interval || 36500,
      enable_fuzz:
        fsrsParams?.enable_fuzz !== undefined ? fsrsParams.enable_fuzz : true,
      enable_short_term:
        fsrsParams?.enable_short_term !== undefined
          ? fsrsParams.enable_short_term
          : true,
      learning_steps: fsrsParams?.learning_steps?.length
        ? fsrsParams.learning_steps
        : undefined,
      relearning_steps: fsrsParams?.relearning_steps?.length
        ? fsrsParams.relearning_steps
        : undefined,
      w: fsrsParams?.w?.length ? fsrsParams.w : undefined,
    });

    return fsrs(params);
  }

  /**
   * 根据用户评级更新卡片
   */
  async updateCardWithRating(
    userCardId: number,
    rating: Grade,
    fsrsParams?: any,
  ): Promise<CardReviewResult> {
    // 获取用户卡片
    const userCard = await this.userCardRepository.findOne({
      where: { id: userCardId },
    });
    if (!userCard) {
      throw new Error(`UserCard with ID ${userCardId} not found`);
    }

    const now = new Date();
    const fsrsCard = this.createFSRSCardFromUserCard(userCard);
    const fsrsInstance = this.createFSRSInstance(fsrsParams);

    // 获取指定评级的结果
    const result = fsrsInstance.next(fsrsCard, now, rating);

    // 更新卡片参数
    userCard.dueDate = result.card.due;
    userCard.stability = result.card.stability;
    userCard.difficulty = result.card.difficulty;
    userCard.elapsedDays = result.card.elapsed_days;
    userCard.scheduledDays = result.card.scheduled_days;
    userCard.learningSteps = result.card.learning_steps;
    userCard.reps = result.card.reps;
    userCard.lapses = result.card.lapses;
    userCard.state = mapFSRSStateToCardState(result.card.state);
    userCard.lastReviewDate = result.card.last_review;

    // 保存更新后的卡片
    await this.userCardRepository.save(userCard);

    // 创建日志记录
    const logRecord = {
      rating: result.log.rating,
      state: mapFSRSStateToCardState(result.log.state),
      due: result.log.due,
      stability: result.log.stability,
      difficulty: result.log.difficulty,
      elapsed_days: result.log.elapsed_days,
      learning_steps: result.log.learning_steps,
      last_elapsed_days: result.log.last_elapsed_days,
      scheduled_days: result.log.scheduled_days,
      review: result.log.review,
    };

    return { card: userCard, logRecord };
  }
}
