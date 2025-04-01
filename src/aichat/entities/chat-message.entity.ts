import { Card } from 'src/anki/entities/card.entity';
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

export enum MessageRole {
  SYSTEM = 'system',
  USER = 'user',
  ASSISTANT = 'assistant',
}

export enum AIModel {
  GPT35 = 'gpt-3.5-turbo',
  GPT4 = 'gpt-4',
  CLAUDE = 'claude-3-sonnet',
  DS_CHAT = 'deepseek-chat',
  DS_REASONING = 'deepseek-reasoner',
}

@Entity('chat_messages')
@Index(['chat', 'createdAt'])
export class ChatMessage {
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
    enum: MessageRole,
  })
  role: MessageRole;

  @Column({
    type: 'enum',
    enum: AIModel,
    default: AIModel.GPT35,
    nullable: true,
  })
  model: AIModel;

  @Column('text')
  content: string;

  @Column('text', { nullable: true })
  chunkId: string;

  @Column('int', { nullable: true })
  promptTokens: number;

  @Column('int', { nullable: true })
  completionTokens: number;

  @Column('int', { nullable: true })
  totalTokens: number;

  @ManyToOne(() => Card, (card) => card.messages, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'card_id' })
  card: Card;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  generateUuid() {
    if (!this.uuid) {
      this.uuid = uuidv4();
    }
  }
}
