import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class SuspendCardDto {
  @IsUUID()
  cardUuid: string;

  @IsOptional()
  @IsBoolean()
  isSuspended?: boolean = true;
}

export class BatchSuspendCardsDto {
  @IsUUID(4, { each: true })
  cardUuids: string[];

  @IsBoolean()
  isSuspended: boolean;
}
