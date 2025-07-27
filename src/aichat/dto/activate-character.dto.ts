import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';

export class ActivateCharacterDto {
  @IsString()
  @IsNotEmpty()
  characterCode: string;

  @IsOptional()
  @IsBoolean()
  setAsDefault?: boolean; // 是否设置为默认角色
}

export class CharacterResponseDto {
  id: number;
  uuid: string;
  code: string;
  name: string;
  description?: string;
  avatar?: string;
  emotionPatterns?: string[];
  sortOrder?: number;
}

export class ActivatedCharacterResponseDto extends CharacterResponseDto {
  isDefault: boolean;
  usageCount: number;
  lastUsedAt?: Date;
  activatedAt: Date;
}

export class ActivateCharacterResponseDto {
  success: boolean;
  data: {
    character: CharacterResponseDto;
    isNewActivation: boolean;
  };
  message: string;
}

export class AvailableCharactersResponseDto {
  success: boolean;
  data: CharacterResponseDto[];
  message: string;
}

export class UserActivatedCharactersResponseDto {
  success: boolean;
  data: ActivatedCharacterResponseDto[];
  message: string;
}
