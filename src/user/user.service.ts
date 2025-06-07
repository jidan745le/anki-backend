import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'crypto';
import { Repository } from 'typeorm';
import { UserCard } from '../anki/entities/user-cards.entity';
import { UserDeck } from '../anki/entities/user-deck.entity';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { User } from './entities/user.entity';

function md5(str) {
  const hash = crypto.createHash('md5');
  hash.update(str);
  return hash.digest('hex');
}

@Injectable()
export class UserService implements OnModuleInit {
  private logger = new Logger();

  @InjectRepository(User)
  private userRepository: Repository<User>;

  @InjectRepository(UserDeck)
  private userDeckRepository: Repository<UserDeck>;

  @InjectRepository(UserCard)
  private userCardRepository: Repository<UserCard>;

  async onModuleInit() {
    console.log('UserService onModuleInit');
  }

  async login(user: LoginDto) {
    const foundUser = await this.userRepository.findOneBy({
      username: user.username,
    });

    if (!foundUser) {
      throw new HttpException('用户名不存在', 200);
    }
    if (foundUser.password !== md5(user.password)) {
      throw new HttpException('密码错误', 200);
    }
    return foundUser;
  }

  async register(user: RegisterDto) {
    const foundUser = await this.userRepository.findOneBy({
      username: user.username,
    });

    if (foundUser) {
      throw new HttpException('用户已存在', 200);
    }

    const newUser = new User();
    newUser.username = user.username;
    newUser.password = md5(user.password);

    try {
      await this.userRepository.save(newUser);
      return user;
    } catch (e) {
      this.logger.error(e, UserService);
      throw new BadRequestException('用户已存在');
    }
  }

  async findUserById(id: number) {
    return await this.userRepository.findOneBy({ id });
  }

  async getUserProfile(userId: number) {
    // 获取用户基本信息
    const user = await this.userRepository.findOneBy({ id: userId });

    if (!user) {
      throw new HttpException('用户不存在', 404);
    }

    // 获取总deck数量（排除软删除的）
    const totalDecks = await this.userDeckRepository
      .createQueryBuilder('userDeck')
      .leftJoin('userDeck.deck', 'deck')
      .where('userDeck.user_id = :userId', { userId })
      .andWhere('userDeck.deletedAt IS NULL')
      .andWhere('deck.deletedAt IS NULL')
      .getCount();

    // 获取总卡片数量（排除软删除的）
    const totalCards = await this.userCardRepository
      .createQueryBuilder('userCard')
      .leftJoin('userCard.deck', 'deck')
      .where('userCard.user_id = :userId', { userId })
      .andWhere('userCard.deletedAt IS NULL')
      .andWhere('deck.deletedAt IS NULL')
      .getCount();

    // 获取今天学习的卡片数量
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const studiedToday = await this.userCardRepository
      .createQueryBuilder('userCard')
      .leftJoin('userCard.deck', 'deck')
      .where('userCard.user_id = :userId', { userId })
      .andWhere('userCard.deletedAt IS NULL')
      .andWhere('deck.deletedAt IS NULL')
      .andWhere('userCard.lastReviewDate >= :today', { today })
      .andWhere('userCard.lastReviewDate < :tomorrow', { tomorrow })
      .getCount();

    return {
      username: user.username,
      email: null, // 如果user entity中没有email字段
      createdAt: user.createTime, // 使用createTime而不是createdAt
      totalDecks,
      totalCards,
      studiedToday,
    };
  }
}
