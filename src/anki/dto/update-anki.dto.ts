import { PartialType } from '@nestjs/mapped-types';
import { CreateAnkiDto } from './create-anki.dto';
import { IsInt } from 'class-validator';


export class UpdateAnkiDto extends PartialType(CreateAnkiDto) {
    @IsInt()
    id: number; // 卡片 ID，作为更新请求的一部分
}
