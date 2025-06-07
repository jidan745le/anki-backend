// controllers/form.controller.ts
import {
  Controller,
  FileTypeValidator,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import * as fs from 'fs';
import { LoginGuard } from '../login.guard';
import { UploadResponseDto } from './dto/upload-response.dto';
import { FileService } from './file.service';

@Controller('file')
export class FileController {
  private readonly logger = new Logger(FileController.name);

  constructor(private readonly fileService: FileService) {}

  @UseGuards(LoginGuard)
  @Post('upload-temp')
  @UseInterceptors(FileInterceptor('file'))
  async uploadTempFile(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }), // 5MB
          new FileTypeValidator({
            fileType: /^image\/(jpeg|jpg|png|gif|webp)$/,
          }),
        ],
      }),
    )
    file: Express.Multer.File,
  ): Promise<UploadResponseDto> {
    try {
      this.logger.log(
        `Uploading file: ${file.originalname}, size: ${file.size}`,
      );

      const tempFile = await this.fileService.uploadTempFile(file);

      // 返回wangEditor兼容的格式
      const response: UploadResponseDto = {
        errno: 0,
        data: {
          url: tempFile.url,
          alt: tempFile.originalName,
          href: '',
          tempFileId: tempFile.tempFileId,
          originalName: tempFile.originalName,
          fileUrl: tempFile.url,
          path: tempFile.url,
        },
        success: true,
        message: 'Upload successful',
        url: tempFile.url,
      };

      this.logger.log(`Upload successful: ${tempFile.tempFileId}`);
      return response;
    } catch (error) {
      this.logger.error(`Upload failed: ${error.message}`);
      throw new HttpException(
        {
          errno: 1,
          message: error.message || 'Upload failed',
          success: false,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('temp/:tempFileId')
  async getTempFile(
    @Param('tempFileId') tempFileId: string,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const tempFile = await this.fileService.getTempFile(tempFileId);

      // 设置响应头
      res.setHeader('Content-Type', tempFile.mimetype);
      res.setHeader('Content-Length', tempFile.size);
      res.setHeader('Cache-Control', 'public, max-age=3600'); // 缓存1小时

      // 如果是图片，设置内联显示
      if (tempFile.mimetype.startsWith('image/')) {
        res.setHeader('Content-Disposition', 'inline');
      } else {
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${tempFile.originalName}"`,
        );
      }

      // 创建文件流并发送
      const fileStream = fs.createReadStream(tempFile.path);
      fileStream.pipe(res);

      fileStream.on('error', (error) => {
        this.logger.error(
          `Error streaming file ${tempFileId}: ${error.message}`,
        );
        if (!res.headersSent) {
          res.status(500).json({ error: 'File streaming error' });
        }
      });

      this.logger.log(`Served temp file: ${tempFileId}`);
    } catch (error) {
      this.logger.error(
        `Error serving temp file ${tempFileId}: ${error.message}`,
      );

      if (error.status === 404) {
        res.status(404).json({ error: 'File not found' });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  // 管理接口：清理过期文件
  @UseGuards(LoginGuard)
  @Post('cleanup')
  async cleanupExpiredFiles(): Promise<{ message: string }> {
    try {
      await this.fileService.cleanExpiredFiles();
      return { message: 'Cleanup completed successfully' };
    } catch (error) {
      this.logger.error(`Cleanup failed: ${error.message}`);
      throw new HttpException(
        'Cleanup failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
