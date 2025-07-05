import {
    BeforeInsert,
    Column,
    CreateDateColumn,
    DeleteDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { User } from '../../user/entities/user.entity';
import { UserCard } from './user-cards.entity';

@Entity('notes')
export class Note {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    type: 'varchar',
    length: 36,
    unique: true,
    default: () => '(UUID())',
  })
  uuid: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text' })
  noteContent: string;

  // 引用文本字段
  @Column({ type: 'text', nullable: true })
  referenceText: string;

  // 关联到用户卡片
  @ManyToOne(() => UserCard, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_card_id' })
  userCard: UserCard;

  // 关联到用户
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  // 笔记颜色或标签（可选）
  @Column({ type: 'varchar', length: 50, nullable: true })
  color: string;

  // 是否固定
  @Column({ type: 'boolean', default: false })
  isPinned: boolean;

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
