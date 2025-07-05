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
import { ChatMessage } from '../../aichat/entities/chat-message.entity';
import { User } from '../../user/entities/user.entity';
import { Card } from './card.entity';
import { Deck } from './deck.entity';
import { Note } from './note.entity';

// 卡片状态枚举
export enum CardState {
  NEW = 0, // 新卡片
  LEARNING = 1, // 学习中
  REVIEW = 2, // 复习中
  RELEARNING = 3, // 重新学习
  SUSPENDED = 4, // 暂停学习
}

@Entity('user_cards')
export class UserCard {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    type: 'varchar',
    length: 36,
    unique: true,
    default: () => '(UUID())',
  })
  uuid: string;

  // 用户关联
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  // 基础卡片关联 - 设置为可空
  @ManyToOne(() => Card, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'card_id' })
  card: Card;

  // 所属牌组关联
  @ManyToOne(() => Deck, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deck_id' })
  deck: Deck;

  @Column({ type: 'text' })
  front: string;

  // 自定义卡片内容
  @Column({ type: 'text', nullable: true })
  customBack: string;

  // 用户自定义标签
  @Column({ type: 'varchar', length: 500, nullable: true })
  tags: string;

  // FSRS 调度参数
  @Column({ type: 'datetime' })
  dueDate: Date;

  @Column({ type: 'float' })
  stability: number;

  @Column({ type: 'float', default: 0.3 })
  difficulty: number;

  @Column({ type: 'float', default: 0 })
  elapsedDays: number;

  @Column({ type: 'float', default: 0 })
  scheduledDays: number;

  @Column({ type: 'int', default: 0 })
  learningSteps: number;

  // 学习统计
  @Column({ default: 0 })
  reps: number;

  @Column({ default: 0 })
  lapses: number;

  @Column({
    type: 'tinyint',
    default: 0,
  })
  state: number;

  @OneToMany(() => ChatMessage, (chatMessage) => chatMessage.userCard)
  messages: ChatMessage[];

  @OneToMany(() => Note, (note) => note.userCard)
  notes: Note[];

  @Column({ type: 'datetime', nullable: true })
  lastReviewDate: Date;

  // 暂停相关字段
  @Column({ type: 'tinyint', nullable: true })
  previousState: number; // 保存暂停前的状态，用于恢复

  @Column({ type: 'datetime', nullable: true })
  suspendedAt: Date; // 暂停时间

  // 时间戳
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
