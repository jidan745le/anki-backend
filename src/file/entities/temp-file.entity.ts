import {
    Column,
    CreateDateColumn,
    Entity,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';

@Entity('temp_files')
export class TempFile {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  tempFileId: string;

  @Column()
  originalName: string;

  @Column()
  filename: string;

  @Column()
  mimetype: string;

  @Column()
  size: number;

  @Column()
  path: string;

  @Column({ nullable: true })
  url: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // 临时文件过期时间（默认24小时）
  @Column({
    type: 'datetime',
    default: () => 'DATE_ADD(NOW(), INTERVAL 24 HOUR)',
  })
  expiresAt: Date;
}
