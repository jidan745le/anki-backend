import { PartialType } from '@nestjs/mapped-types';
import { CreateAichatDto } from './create-aichat.dto';

export class UpdateAichatDto extends PartialType(CreateAichatDto) {}
