import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../user/entities/user.entity';
import { DeckReferenceService } from './deck-reference.service';
import { Deck } from './entities/deck.entity';
import { UserDeck } from './entities/user-deck.entity';

interface FSRSParameters {
  request_retention: number;
  maximum_interval: number;
  w: number[];
  enable_fuzz: boolean;
  enable_short_term: boolean;
}

@Injectable()
export class UserDeckService {
  constructor(
    @InjectRepository(UserDeck)
    private userDeckRepository: Repository<UserDeck>,
    private deckReferenceService: DeckReferenceService,
  ) {}

  // 分配牌组给用户，可设置FSRS参数
  async assignDeckToUser(
    userId: number,
    deckId: number,
    fsrsParams?: FSRSParameters,
  ) {
    // 检查是否已存在关系
    const existing = await this.userDeckRepository.findOne({
      where: {
        user: { id: userId },
        deck: { id: deckId },
      },
    });

    if (existing) {
      // 更新已有关系
      if (fsrsParams) {
        existing.fsrsParameters = fsrsParams;
      }
      return await this.userDeckRepository.save(existing);
    }

    // 创建新关系
    const userDeck = this.userDeckRepository.create({
      user: { id: userId } as User,
      deck: { id: deckId } as Deck,
      fsrsParameters: {
        request_retention: fsrsParams?.request_retention || 0.9,
        maximum_interval: fsrsParams?.maximum_interval || 36500,
        w: fsrsParams?.w,
        enable_fuzz: fsrsParams?.enable_fuzz || true,
        enable_short_term: fsrsParams?.enable_short_term || true,
      },
    });

    const savedUserDeck = await this.userDeckRepository.save(userDeck);

    // 增加引用计数
    await this.deckReferenceService.incrementReference(deckId, userId);

    return savedUserDeck;
  }

  // 获取用户所有牌组关系
  async getUserDecks(userId: number) {
    return await this.userDeckRepository
      .createQueryBuilder('userDeck')
      .leftJoinAndSelect('userDeck.deck', 'deck')
      .where('userDeck.user_id = :userId', { userId })
      .andWhere('userDeck.deletedAt IS NULL') // 排除软删除的user_deck关系
      .andWhere('deck.deletedAt IS NULL') // 排除软删除的deck
      .getMany();
  }

  // 获取一个特定的用户-牌组关系
  async getUserDeck(userId: number, deckId: number) {
    return await this.userDeckRepository
      .createQueryBuilder('userDeck')
      .leftJoinAndSelect('userDeck.deck', 'deck')
      .where('userDeck.user_id = :userId', { userId })
      .andWhere('userDeck.deck_id = :deckId', { deckId })
      .andWhere('userDeck.deletedAt IS NULL') // 排除软删除的user_deck关系
      .andWhere('deck.deletedAt IS NULL') // 排除软删除的deck
      .getOne();
  }

  // 删除用户-牌组关系
  async removeUserDeck(userId: number, deckId: number) {
    const userDeck = await this.getUserDeck(userId, deckId);
    if (!userDeck) {
      throw new Error('User-Deck relationship not found');
    }

    // 软删除用户-牌组关系
    await this.userDeckRepository.softDelete(userDeck.id);

    // 软删除用户的相关UserCard记录
    await this.userDeckRepository.query(
      'UPDATE user_cards SET deletedAt = NOW() WHERE user_id = ? AND deck_id = ?',
      [userId, deckId],
    );

    // 减少引用计数
    const remainingReferences =
      await this.deckReferenceService.decrementReference(deckId, userId);

    return {
      removed: true,
      remainingReferences,
      message: `User-deck relationship and related user cards have been removed. ${remainingReferences} references remaining.`,
    };
  }
}
