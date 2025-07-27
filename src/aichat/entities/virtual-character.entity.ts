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
import { UserCharacterPreference } from './user-character-preference.entity';

@Entity('virtual_characters')
export class VirtualCharacter {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    type: 'varchar',
    length: 36,
    unique: true,
  })
  uuid: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  code: string; // 'chihana', 'yuki', 'sakura'

  @Column({ type: 'varchar', length: 100 })
  name: string; // '星野学助', '夏目七海'

  @Column({ type: 'varchar', length: 200, nullable: true })
  description: string; // 角色描述

  @Column({ type: 'text' })
  systemPrompt: string; // 系统提示词

  @Column({ type: 'varchar', length: 200 })
  voiceId: string; // 语音ID

  @Column({ type: 'json' })
  emotionPatterns: string[]; // 表情模式数组

  @Column({ type: 'varchar', length: 500, nullable: true })
  avatar: string; // 头像URL

  @Column({ type: 'boolean', default: true })
  isActive: boolean; // 是否启用

  @Column({ type: 'int', default: 0 })
  sortOrder: number; // 排序

  @OneToMany(() => UserCharacterPreference, (pref) => pref.character)
  userPreferences: UserCharacterPreference[];

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