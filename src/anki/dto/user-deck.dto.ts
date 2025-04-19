import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNumber, IsObject, IsOptional, IsPositive, ValidateNested } from 'class-validator';

export class FSRSParametersDto {
  @IsNumber()
  @IsPositive()
  request_retention: number;

  @IsNumber()
  @IsPositive()
  maximum_interval: number;

  @IsNumber({}, { each: true })
  w: number[];

  @IsBoolean()
  enable_fuzz: boolean;

  @IsBoolean()
  enable_short_term: boolean;
}

export class AssignDeckDto {
  @IsInt()
  @IsPositive()
  deckId: number;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => FSRSParametersDto)
  fsrsParameters?: FSRSParametersDto;

  @IsOptional()
  @IsBoolean()
  canEdit?: boolean;
}

export class UpdateFSRSParametersDto {
  @IsObject()
  @ValidateNested()
  @Type(() => FSRSParametersDto)
  fsrsParameters: FSRSParametersDto;
}

export class UpdateLearningProgressDto {
  @IsOptional()
  @IsInt()
  lastPosition?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  totalReviews?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  correctReviews?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  studyTimeMinutes?: number;
}

export class UpdateLearningSettingsDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  newCardsPerDay?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  reviewsPerDay?: number;
} 