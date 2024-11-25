// src/entities/deck.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, OneToMany, CreateDateColumn, UpdateDateColumn,ManyToOne } from 'typeorm';
import { Card } from './card.entity';
import {User} from "../../user/entities/user.entity"

export enum DeckType {
  NORMAL = 'normal',
  AUDIO = 'audio',
}

@Entity('decks') 
export class Deck {
  @PrimaryGeneratedColumn()
  id: number;

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

  @OneToMany(() => Card, card => card.deck)
  cards: Card[];

  @ManyToOne(() => User,user => user.decks)
  user:User
}
