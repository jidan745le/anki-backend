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
import { UserCard } from '../../anki/entities/user-cards.entity';
import { ChatContextType, ChatType } from '../dto/create-chat-message.dto';

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
  QWEN25_15B_INSTRUCT = 'qwen2.5-1.5b-instruct',
  QWEN25_32B_INSTRUCT = 'qwen2.5-32b-instruct',
}

export interface PromptConfig {
  chatcontext: ChatContextType;
  contextContent?: string;
  chattype: ChatType;
  selectionText?: string;
  question?: string;
}

@Entity('chat_messages')
@Index(['userCard', 'createdAt'])
@Index(['sessionId'])
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

  @Column('json', { nullable: true })
  prompt_config: PromptConfig;

  @Column('int', { nullable: true })
  promptTokens: number;

  @Column('int', { nullable: true })
  completionTokens: number;

  @Column('int', { nullable: true })
  totalTokens: number;

  @Column('varchar', { length: 36, nullable: true })
  sessionId: string;

  @ManyToOne(() => UserCard, (userCard) => userCard.messages, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_card_id' })
  userCard: UserCard;

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
