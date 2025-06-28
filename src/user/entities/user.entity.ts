import {
  Column,
  CreateDateColumn,
  Entity,
  Generated,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Deck } from '../../anki/entities/deck.entity';
import { UserDeck } from '../../anki/entities/user-deck.entity';

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  @Generated('uuid')
  uuid: string;

  @Column({
    length: 50,
    comment: '用户名',
  })
  username: string;

  @Column({
    length: 50,
    comment: '密码',
  })
  password: string;

  @CreateDateColumn({
    comment: '创建时间',
  })
  createTime: Date;

  @UpdateDateColumn({
    comment: '更新时间',
  })
  updateTime: Date;

  // 用户的牌组关系
  @OneToMany(() => UserDeck, (userDeck) => userDeck.user)
  userDecks: UserDeck[];

  // 保留向后兼容的方法 (可选)
  get decks(): Deck[] {
    return this.userDecks?.map((ud) => ud.deck) || [];
  }

  @OneToMany(() => Deck, (deck) => deck.creator)
  createdDecks: Deck[];
}
