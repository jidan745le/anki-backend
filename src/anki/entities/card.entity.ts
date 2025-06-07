import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Deck } from './deck.entity';
import { UserCard } from './user-cards.entity';

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

  @Column({ type: 'varchar', length: 255, nullable: true })
  tags: string;

  @ManyToOne(() => Deck, (deck) => deck.cards, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deck_id' })
  deck: Deck;

  @OneToMany(() => UserCard, (userCard) => userCard.card)
  userCards: UserCard[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;

  @BeforeInsert()
  generateUuid() {
    if (!this.uuid) {
      this.uuid = uuidv4();
    }
  }
}
