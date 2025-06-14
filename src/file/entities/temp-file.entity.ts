import {
    Column,
    CreateDateColumn,
    Entity,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';

export enum FileType {
  TEMPORARY = 'temporary',
  PERMANENT = 'permanent',
}

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

  @Column({ nullable: true })
  userId: number; // 关联上传用户（永久文件需要）

  @Column({
    type: 'enum',
    enum: FileType,
    default: FileType.TEMPORARY,
  })
  fileType: FileType; // 文件类型：临时或永久

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // 临时文件过期时间（永久文件此字段为null）
  @Column({
    type: 'datetime',
    nullable: true,
    default: () => 'DATE_ADD(NOW(), INTERVAL 24 HOUR)',
  })
  expiresAt: Date;
}
