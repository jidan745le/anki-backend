import { Type } from 'class-transformer';
import {
    IsBoolean,
    IsDateString,
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    Max,
    Min,
} from 'class-validator';
import { CardState } from '../entities/user-cards.entity';

export class QueryUserCardsDto {
  // 分页参数
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  // 排序参数
  @IsOptional()
  @IsString()
  sortBy?:
    | 'createdAt'
    | 'updatedAt'
    | 'dueDate'
    | 'lastReviewDate'
    | 'reps'
    | 'difficulty'
    | 'stability' = 'createdAt';

  @IsOptional()
  @IsString()
  sortOrder?: 'ASC' | 'DESC' = 'DESC';

  // Filter参数
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  deckId?: number;

  @IsOptional()
  @IsString()
  front?: string; // 前面内容模糊查询

  @IsOptional()
  @IsString()
  back?: string; // 后面内容模糊查询（会查询card.back和customBack）

  @IsOptional()
  @IsString()
  tags?: string; // 标签模糊查询

  @IsOptional()
  @IsEnum(CardState)
  state?: CardState; // 卡片状态

  @IsOptional()
  @IsDateString()
  dueDateFrom?: string; // 到期日期范围开始

  @IsOptional()
  @IsDateString()
  dueDateTo?: string; // 到期日期范围结束

  @IsOptional()
  @IsDateString()
  lastReviewDateFrom?: string; // 最后复习日期范围开始

  @IsOptional()
  @IsDateString()
  lastReviewDateTo?: string; // 最后复习日期范围结束

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  repsMin?: number; // 最小复习次数

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  repsMax?: number; // 最大复习次数

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  lapsesMin?: number; // 最小失误次数

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  lapsesMax?: number; // 最大失误次数

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  @Max(1)
  difficultyMin?: number; // 最小难度

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  @Max(1)
  difficultyMax?: number; // 最大难度

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  stabilityMin?: number; // 最小稳定性

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  stabilityMax?: number; // 最大稳定性

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isSuspended?: boolean; // 是否暂停

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isOverdue?: boolean; // 是否过期

  @IsOptional()
  @IsString()
  deckName?: string; // 牌组名称模糊查询

  @IsOptional()
  @IsString()
  deckType?: string; // 牌组类型
}

export interface QueryUserCardsResult {
  data: UserCardWithDeckInfo[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface UserCardWithDeckInfo {
  id: number;
  uuid: string;
  front: string;
  customBack?: string;
  back?: string; // 来自card.back
  tags?: string; // 合并的标签（优先使用用户自定义）
  userTags?: string; // 用户自定义标签
  originalTags?: string; // 原始卡片标签
  dueDate: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: number;
  lastReviewDate?: Date;
  previousState?: number;
  suspendedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  deck: {
    id: number;
    name: string;
    description?: string;
    deckType: string;
    isShared: boolean;
  };
  card?: {
    id: number;
    uuid: string;
    back: string;
    tags?: string;
    frontType: string;
  };
}
