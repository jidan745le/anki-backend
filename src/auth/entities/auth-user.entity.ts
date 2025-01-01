import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';

@Entity()
export class AuthUser {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  provider: string; // 'google', 'github' 等

  @Column()
  providerId: string; // 第三方的用户ID

  @Column()
  email: string;

  @Column({ nullable: true })
  firstName: string;

  @Column({ nullable: true })
  lastName: string;

  @Column({ nullable: true })
  picture: string;

  @ManyToOne(() => User, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn()
  user: User;

  @CreateDateColumn()
  createTime: Date;

  @UpdateDateColumn()
  updateTime: Date;
}
