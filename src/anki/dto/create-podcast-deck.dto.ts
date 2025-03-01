import { IsEnum, IsNotEmpty, IsOptional, IsString, IsInt, IsBoolean, IsDecimal, MaxLength } from 'class-validator';

export enum PodcastType {
    AmericanLife = 'this american life',
    Overthink = 'overthink',
}
export class CreatePodcastDeckDto {
  @IsNotEmpty()
  @IsString()
  name: string; // 名字

  @IsString()
  @MaxLength(500, { message: 'Description is too long' })
  description: string; // 描述

  @IsOptional()
  podcastType?:PodcastType 
  
  @IsOptional()
  @IsString()
  podcastUrl?:string
  
//   user: number; // 用户 ID

 
}