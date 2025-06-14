import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { Deck } from './deck.entity';

interface FSRSParameters {
  request_retention?: number;
  maximum_interval?: number;
  w?: number[];
  enable_fuzz?: boolean;
  enable_short_term?: boolean;
}

@Entity('user_decks')
export class UserDeck {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, (user) => user.userDecks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Deck, (deck) => deck.userDecks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deck_id' })
  deck: Deck;

  // FSRS 参数
  @Column({ type: 'json', nullable: true })
  fsrsParameters: FSRSParameters;

  @Column({ type: 'json', nullable: true })
  config: any;

  // 学习进度
  @Column({ default: 0 })
  lastPosition: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // 软删除字段
  @DeleteDateColumn()
  deletedAt: Date;
}
