// controllers/form.controller.ts
import {
  Controller,
  Delete,
  FileTypeValidator,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Post,
  Query,
  Req,
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
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }), // 10MB max
          new FileTypeValidator({
            fileType: /^image\/(jpeg|jpg|png|gif|webp)$/,
          }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Query('storage') storageType: 'temp' | 'permanent' = 'temp',
    @Req() req,
  ): Promise<UploadResponseDto> {
    try {
      const userId = req?.user?.id;

      this.logger.log(
        `Uploading file: ${file.originalname}, size: ${file.size}, storage: ${storageType}, userId: ${userId}`,
      );

      let uploadedFile;

      if (storageType === 'permanent') {
        // 永久文件存储
        uploadedFile = await this.fileService.uploadPermanentFile(file, userId);
        this.logger.log(
          `✅ Permanent file uploaded: ${uploadedFile.tempFileId}`,
        );
      } else {
        // 临时文件存储（默认）
        uploadedFile = await this.fileService.uploadTempFile(file);
        this.logger.log(
          `✅ Temporary file uploaded: ${uploadedFile.tempFileId}`,
        );
      }

      // 返回统一格式
      const response: UploadResponseDto = {
        errno: 0,
        data: {
          url: uploadedFile.url,
          alt: uploadedFile.originalName,
          href: '',
          tempFileId: uploadedFile.tempFileId,
          originalName: uploadedFile.originalName,
          fileUrl: uploadedFile.url,
          path: uploadedFile.url,
          storageType: storageType,
        },
        success: true,
        message: `${
          storageType === 'permanent' ? 'Permanent' : 'Temporary'
        } upload successful`,
        url: uploadedFile.url,
      };

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

  // 保持向后兼容性 - 临时文件专用接口
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
        `Uploading temp file: ${file.originalname}, size: ${file.size}`,
      );

      const tempFile = await this.fileService.uploadTempFile(file);

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
          storageType: 'temp',
        },
        success: true,
        message: 'Temporary upload successful',
        url: tempFile.url,
      };

      this.logger.log(`✅ Temp upload successful: ${tempFile.tempFileId}`);
      return response;
    } catch (error) {
      this.logger.error(`Temp upload failed: ${error.message}`);
      throw new HttpException(
        {
          errno: 1,
          message: error.message || 'Temp upload failed',
          success: false,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // 保持向后兼容性 - 永久文件专用接口
  @UseGuards(LoginGuard)
  @Post('upload-permanent')
  @UseInterceptors(FileInterceptor('file'))
  async uploadPermanentFile(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }), // 10MB
          new FileTypeValidator({
            fileType: /^image\/(jpeg|jpg|png|gif|webp)$/,
          }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Req() req,
  ): Promise<UploadResponseDto> {
    try {
      const userId = req?.user?.id;
      this.logger.log(
        `Uploading permanent file: ${file.originalname}, size: ${file.size}, userId: ${userId}`,
      );

      const permanentFile = await this.fileService.uploadPermanentFile(
        file,
        userId,
      );

      const response: UploadResponseDto = {
        errno: 0,
        data: {
          url: permanentFile.url,
          alt: permanentFile.originalName,
          href: '',
          tempFileId: permanentFile.tempFileId,
          originalName: permanentFile.originalName,
          fileUrl: permanentFile.url,
          path: permanentFile.url,
          storageType: 'permanent',
        },
        success: true,
        message: 'Permanent upload successful',
        url: permanentFile.url,
      };

      this.logger.log(
        `✅ Permanent upload successful: ${permanentFile.tempFileId}`,
      );
      return response;
    } catch (error) {
      this.logger.error(`Permanent upload failed: ${error.message}`);
      throw new HttpException(
        {
          errno: 1,
          message: error.message || 'Permanent upload failed',
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

  @Get('permanent/:fileId')
  async getPermanentFile(
    @Param('fileId') fileId: string,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const permanentFile = await this.fileService.getPermanentFile(fileId);

      // 设置响应头
      res.setHeader('Content-Type', permanentFile.mimetype);
      res.setHeader('Content-Length', permanentFile.size);
      res.setHeader('Cache-Control', 'public, max-age=86400'); // 缓存24小时

      // 如果是图片，设置内联显示
      if (permanentFile.mimetype.startsWith('image/')) {
        res.setHeader('Content-Disposition', 'inline');
      } else {
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${permanentFile.originalName}"`,
        );
      }

      // 创建文件流并发送
      const fileStream = fs.createReadStream(permanentFile.path);
      fileStream.pipe(res);

      fileStream.on('error', (error) => {
        this.logger.error(
          `Error streaming permanent file ${fileId}: ${error.message}`,
        );
        if (!res.headersSent) {
          res.status(500).json({ error: 'File streaming error' });
        }
      });

      this.logger.log(`Served permanent file: ${fileId}`);
    } catch (error) {
      this.logger.error(
        `Error serving permanent file ${fileId}: ${error.message}`,
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

  // 删除永久文件
  @UseGuards(LoginGuard)
  @Delete('permanent/:fileId')
  async deletePermanentFile(
    @Param('fileId') fileId: string,
    @Req() req,
  ): Promise<{ message: string }> {
    try {
      const userId = req?.user?.id;
      await this.fileService.deletePermanentFile(fileId, userId);
      return { message: 'File deleted successfully' };
    } catch (error) {
      this.logger.error(`Delete permanent file failed: ${error.message}`);
      throw new HttpException(
        error.message || 'Delete failed',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // 获取用户的永久文件列表
  @UseGuards(LoginGuard)
  @Get('permanent')
  async getUserPermanentFiles(@Req() req) {
    try {
      const userId = req?.user?.id;
      const files = await this.fileService.getUserPermanentFiles(userId);
      return {
        success: true,
        data: files,
        message: 'Files retrieved successfully',
      };
    } catch (error) {
      this.logger.error(`Get user files failed: ${error.message}`);
      throw new HttpException(
        error.message || 'Failed to retrieve files',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
