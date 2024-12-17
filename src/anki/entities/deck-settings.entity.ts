import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Deck } from './deck.entity';

@Entity('deck_settings')
export class DeckSettings {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', default: 1440 }) // Default: 1 day in minutes
  hardInterval: number;

  @Column({ type: 'int', default: 4320 }) // Default: 3 days in minutes
  easyInterval: number;

  @OneToOne(() => Deck, { onDelete: 'CASCADE' })
  @JoinColumn()
  deck: Deck;
}
