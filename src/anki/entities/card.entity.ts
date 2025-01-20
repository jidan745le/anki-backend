import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  JoinColumn,
  BeforeInsert,
  OneToOne,
} from 'typeorm';
import { Deck } from './deck.entity';
import { v4 as uuidv4 } from 'uuid';
import { Chat } from '../../aichat/entities/chat.entity';

export enum CardType {
  NEW = 'new',
  REVIEW = 'review',
}

// 定义复习质量枚举
export enum ReviewQuality {
  AGAIN = 0, // 完全不记得
  HARD = 1, // 记得但很困难
  GOOD = 2, // 记得且正确
  EASY = 3, // 轻松记住
}

export enum ContentType {
  TEXT = 'text',
  IMAGE = 'image',
  AUDIO = 'audio',
  VIDEO = 'video',
}

@Entity('cards')
export class Card {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    type: 'varchar',
    length: 36,
    unique: true,
    default: () => '(UUID())',
  })
  uuid: string;

  @Column({
    type: 'enum',
    enum: ContentType,
    default: ContentType.TEXT,
  })
  frontType: ContentType;

  @Column({ type: 'text' })
  front: string;

  @Column({ type: 'text' })
  back: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  nextReviewTime: Date;

  @Column({ type: 'timestamp', nullable: true })
  lastReviewTime: Date; // 添加上次复习时间

  @Column({ type: 'int', default: 0 })
  interval: number;

  @Column({
    type: 'decimal',
    precision: 4,
    scale: 2,
    default: 2.5,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  easeFactor: number;

  @Column({ type: 'int', default: 0 })
  repetitions: number; // 添加复习次数

  @Column({
    type: 'enum',
    enum: CardType,
    default: CardType.NEW,
  })
  card_type: CardType;

  @Column('tinyint', { default: 0 })
  reviewed: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  tags: string;

  @ManyToOne(() => Deck, (deck) => deck.cards, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deck_id' })
  deck: Deck;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToOne(() => Chat, (chat) => chat.card)
  chat: Chat;

  @BeforeInsert()
  generateUuid() {
    if (!this.uuid) {
      this.uuid = uuidv4();
    }
  }
}
