import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../user/entities/user.entity';
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

    return await this.userDeckRepository.save(userDeck);
  }

  // 获取用户所有牌组关系
  async getUserDecks(userId: number) {
    return await this.userDeckRepository.find({
      where: { user: { id: userId } },
      relations: ['deck'],
    });
  }

  // 获取一个特定的用户-牌组关系
  async getUserDeck(userId: number, deckId: number) {
    return await this.userDeckRepository.findOne({
      where: {
        user: { id: userId },
        deck: { id: deckId },
      },
      relations: ['deck'],
    });
  }

  // 删除用户-牌组关系
  async removeUserDeck(userId: number, deckId: number) {
    const userDeck = await this.getUserDeck(userId, deckId);
    if (!userDeck) {
      throw new Error('User-Deck relationship not found');
    }

    return await this.userDeckRepository.remove(userDeck);
  }
}
