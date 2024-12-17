import { IsInt, Min, Max, IsNotEmpty } from 'class-validator';

export class DeckConfigDto {
  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Max(10080) // Max 7 days in minutes
  hardInterval: number;

  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Max(43200) // Max 30 days in minutes
  easyInterval: number;
}
