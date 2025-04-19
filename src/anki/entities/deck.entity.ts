// src/entities/deck.entity.ts
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { User } from '../../user/entities/user.entity';
import { Card } from './card.entity';
import { UserDeck } from './user-deck.entity';

export enum DeckType {
  NORMAL = 'normal',
  AUDIO = 'audio',
}

export enum DeckStatus {
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity('decks')
export class Deck {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    type: 'varchar',
    length: 36,
    unique: true,
    default: () => '(UUID())',
  })
  uuid: string;

  @Column({ length: 100 })
  name: string;

  @Column({ length: 500, nullable: true })
  description: string;

  @Column({
    type: 'enum',
    enum: DeckType,
    default: DeckType.NORMAL,
  })
  deckType: DeckType;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Card, (card) => card.deck)
  cards: Card[];

  // 牌组的用户关系
  @OneToMany(() => UserDeck, (userDeck) => userDeck.deck)
  userDecks: UserDeck[];

  // 创建者/拥有者 (可选，用于向后兼容)
  @Column({ nullable: true })
  creatorId: number;

  @Column({ nullable: true })
  taskId: string;

  @Column({
    type: 'enum',
    enum: DeckStatus,
    default: DeckStatus.COMPLETED,
  })
  status: DeckStatus;

  @BeforeInsert()
  generateUuid() {
    if (!this.uuid) {
      this.uuid = uuidv4();
    }
  }

  // 获取拥有此牌组的用户 (可选，用于向后兼容)
  get users(): User[] {
    return this.userDecks?.map((ud) => ud.user) || [];
  }
}
