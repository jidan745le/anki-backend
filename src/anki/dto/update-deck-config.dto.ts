import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Steps } from 'ts-fsrs';

export class DeckConfigDto {
  @IsString()
  @IsOptional()
  size?: string; // 如 "16px"

  @IsString()
  @IsOptional()
  @IsIn(['left', 'center', 'right'])
  align?: string;
}

export class FSRSParametersDto {
  @IsNumber()
  @Min(0.1)
  @Max(1)
  request_retention: number;

  @IsNumber()
  @Min(1)
  @Max(100000)
  maximum_interval: number;

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  w?: number[];

  @IsOptional()
  @IsBoolean()
  enable_fuzz?: boolean;

  @IsOptional()
  @IsBoolean()
  enable_short_term?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  learning_steps?: Steps;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  relearning_steps?: Steps;
}

export class UpdateDeckConfigDto {
  @ValidateNested()
  @Type(() => DeckConfigDto)
  config: DeckConfigDto;

  @ValidateNested()
  @Type(() => FSRSParametersDto)
  fsrsParameters: FSRSParametersDto;
}
