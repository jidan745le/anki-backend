// services/file.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { promises as fs } from 'fs';
import * as path from 'path';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { FileType, TempFile } from './entities/temp-file.entity';
import { moveFile } from './file.util';

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);
  private readonly uploadDir = path.join(process.cwd(), 'uploads', 'temp');
  private readonly permanentDir = path.join(
    process.cwd(),
    'uploads',
    'permanent',
  );

  constructor(
    @InjectRepository(TempFile)
    private tempFileRepository: Repository<TempFile>,
  ) {
    // 确保上传目录存在 - 异步初始化
    this.initializeDirectories();
  }

  private async initializeDirectories() {
    await this.ensureUploadDir();
    await this.ensurePermanentDir();
  }

  private async ensureUploadDir() {
    try {
      await fs.access(this.uploadDir);
    } catch {
      await fs.mkdir(this.uploadDir, { recursive: true });
      this.logger.log(`Created upload directory: ${this.uploadDir}`);
    }
  }

  private async ensurePermanentDir() {
    try {
      await fs.access(this.permanentDir);
    } catch {
      await fs.mkdir(this.permanentDir, { recursive: true });
      this.logger.log(`Created permanent directory: ${this.permanentDir}`);
    }
  }

  async uploadTempFile(file: Express.Multer.File): Promise<TempFile> {
    const tempFileId = uuidv4();
    const fileExtension = path.extname(file.originalname);
    const filename = `${tempFileId}${fileExtension}`;
    const filePath = path.join(this.uploadDir, filename);

    try {
      // 保存文件到临时目录
      await fs.writeFile(filePath, file.buffer);

      // 构建访问URL
      const url = `/api/file/temp/${tempFileId}`;

      // 保存文件信息到数据库
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24); // 24小时后过期

      const tempFile = this.tempFileRepository.create({
        tempFileId,
        originalName: file.originalname,
        filename,
        mimetype: file.mimetype,
        size: file.size,
        path: filePath,
        url,
        expiresAt,
      });

      const savedFile = await this.tempFileRepository.save(tempFile);
      this.logger.log(`Uploaded temp file: ${tempFileId}`);

      return savedFile;
    } catch (error) {
      this.logger.error(`Failed to upload file: ${error.message}`);
      // 如果数据库保存失败，删除已保存的文件
      if (
        await fs.access(filePath).then(
          () => true,
          () => false,
        )
      ) {
        await fs.unlink(filePath);
      }
      throw error;
    }
  }

  async getTempFile(tempFileId: string): Promise<TempFile> {
    const tempFile = await this.tempFileRepository.findOne({
      where: { tempFileId },
    });

    if (!tempFile) {
      throw new NotFoundException('File not found');
    }

    // 只对临时文件检查过期时间
    if (tempFile.fileType === FileType.TEMPORARY && tempFile.expiresAt) {
      if (new Date() > tempFile.expiresAt) {
        // 删除过期文件
        await this.deleteTempFile(tempFileId);
        throw new NotFoundException('File has expired');
      }
    }

    // 检查物理文件是否存在
    if (
      !(await fs.access(tempFile.path).then(
        () => true,
        () => false,
      ))
    ) {
      this.logger.warn(`Physical file not found: ${tempFile.path}`);
      throw new NotFoundException('Physical file not found');
    }

    return tempFile;
  }

  async deleteTempFile(tempFileId: string): Promise<void> {
    const tempFile = await this.tempFileRepository.findOne({
      where: { tempFileId },
    });

    if (tempFile) {
      // 删除物理文件
      if (
        await fs.access(tempFile.path).then(
          () => true,
          () => false,
        )
      ) {
        await fs.unlink(tempFile.path);
        this.logger.log(`Deleted physical file: ${tempFile.path}`);
      }

      // 删除数据库记录
      await this.tempFileRepository.remove(tempFile);
      this.logger.log(`Deleted temp file record: ${tempFileId}`);
    }
  }

  // 清理过期文件的定时任务
  async cleanExpiredFiles(): Promise<void> {
    const expiredFiles = await this.tempFileRepository
      .createQueryBuilder('tempFile')
      .where('tempFile.fileType = :fileType', { fileType: FileType.TEMPORARY })
      .andWhere('tempFile.expiresAt < NOW()')
      .getMany();

    for (const file of expiredFiles) {
      try {
        await this.deleteTempFile(file.tempFileId);
      } catch (error) {
        this.logger.error(
          `Failed to delete expired file ${file.tempFileId}: ${error.message}`,
        );
      }
    }

    this.logger.log(`Cleaned ${expiredFiles.length} expired files`);
  }

  async saveTempFile(file: Express.Multer.File) {
    const tempFileId = uuidv4();
    const tempPath = path.join(
      this.uploadDir,
      `${tempFileId}-${file.originalname}`,
    );

    await moveFile(file.path, tempPath);

    return {
      tempFileId,
      originalName: file.originalname,
    };
  }

  async moveToFinal(tempFileId: string, fileName: string, formId: number) {
    const tempPath = path.join(this.uploadDir, `${tempFileId}-${fileName}`);
    const finalPath = path.join(this.uploadDir, String(formId), fileName);

    await moveFile(tempPath, finalPath);

    return finalPath;
  }

  async uploadPermanentFile(
    file: Express.Multer.File,
    userId?: number,
  ): Promise<TempFile> {
    const tempFileId = uuidv4();
    const fileExtension = path.extname(file.originalname);
    const filename = `${tempFileId}${fileExtension}`;
    const filePath = path.join(this.permanentDir, filename);

    try {
      // 保存文件到永久目录
      await fs.writeFile(filePath, file.buffer);

      // 构建访问URL
      const url =
        process.env.NODE_ENV === 'development'
          ? `/api/file/permanent/${tempFileId}`
          : `https://api.myanki.cc/file/permanent/${tempFileId}`;

      // 保存文件信息到数据库 - 永久文件不设置过期时间
      const tempFile = this.tempFileRepository.create({
        tempFileId,
        originalName: file.originalname,
        filename,
        mimetype: file.mimetype,
        size: file.size,
        path: filePath,
        url,
        fileType: FileType.PERMANENT,
        userId,
        expiresAt: null, // 永久文件不过期
      });

      const savedFile = await this.tempFileRepository.save(tempFile);
      this.logger.log(`Uploaded permanent file: ${tempFileId}`);

      return savedFile;
    } catch (error) {
      this.logger.error(`Failed to upload permanent file: ${error.message}`);
      // 如果数据库保存失败，删除已保存的文件
      if (
        await fs.access(filePath).then(
          () => true,
          () => false,
        )
      ) {
        await fs.unlink(filePath);
      }
      throw error;
    }
  }

  async getPermanentFile(tempFileId: string): Promise<TempFile> {
    const tempFile = await this.tempFileRepository.findOne({
      where: { tempFileId },
    });

    if (!tempFile || tempFile.fileType !== FileType.PERMANENT) {
      throw new NotFoundException('Permanent file not found');
    }

    // 检查物理文件是否存在
    if (
      !(await fs.access(tempFile.path).then(
        () => true,
        () => false,
      ))
    ) {
      this.logger.warn(`Physical permanent file not found: ${tempFile.path}`);
      throw new NotFoundException('Physical permanent file not found');
    }

    return tempFile;
  }

  async deletePermanentFile(
    tempFileId: string,
    userId?: number,
  ): Promise<void> {
    const tempFile = await this.tempFileRepository.findOne({
      where: { tempFileId },
    });

    if (!tempFile || tempFile.fileType !== FileType.PERMANENT) {
      throw new NotFoundException('Permanent file not found');
    }

    // 如果指定了userId，检查权限（只有上传者可以删除）
    if (userId && tempFile.userId && tempFile.userId !== userId) {
      throw new Error('You do not have permission to delete this file');
    }

    // 删除物理文件
    if (
      await fs.access(tempFile.path).then(
        () => true,
        () => false,
      )
    ) {
      await fs.unlink(tempFile.path);
      this.logger.log(`Deleted physical permanent file: ${tempFile.path}`);
    }

    // 删除数据库记录
    await this.tempFileRepository.remove(tempFile);
    this.logger.log(`Deleted permanent file record: ${tempFileId}`);
  }

  // 获取用户的所有永久文件
  async getUserPermanentFiles(userId: number): Promise<TempFile[]> {
    return await this.tempFileRepository.find({
      where: { fileType: FileType.PERMANENT, userId },
      order: { createdAt: 'DESC' },
    });
  }
}
