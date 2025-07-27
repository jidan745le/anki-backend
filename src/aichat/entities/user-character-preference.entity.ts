import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { VirtualCharacter } from './virtual-character.entity';

@Entity('user_character_preferences')
export class UserCharacterPreference {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => VirtualCharacter, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'character_id' })
  character: VirtualCharacter;

  @Column({ type: 'boolean', default: false })
  isDefault: boolean; // 是否为默认角色

  @Column({ type: 'int', default: 0 })
  usageCount: number; // 使用次数

  @Column({ type: 'datetime', nullable: true })
  lastUsedAt: Date; // 最后使用时间

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}