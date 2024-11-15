// controllers/form.controller.ts
import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FileService } from './file.service';
import { multerConfig } from './config/multer.config';

@Controller('file')
export class FileController {
  constructor(
    private fileService: FileService,
  ) {}

  @Post('upload-temp')
  @UseInterceptors(FileInterceptor('file', multerConfig))
  async uploadTemp(@UploadedFile() file: Express.Multer.File) {
    return await this.fileService.saveTempFile(file);
  }


}