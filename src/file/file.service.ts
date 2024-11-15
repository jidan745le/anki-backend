// services/file.service.ts
import { Injectable } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import * as path from 'path';
import { moveFile } from './file.util';

@Injectable()
export class FileService {
  private readonly tempDir = 'uploads/temp';
  private readonly uploadDir = 'uploads';

  async saveTempFile(file: Express.Multer.File) {
    const tempFileId = uuid();
    const tempPath = path.join(this.tempDir, `${tempFileId}-${file.originalname}`);
    
    await moveFile(file.path, tempPath);
    
    return {
      tempFileId,
      originalName: file.originalname,
    };
  }

  async moveToFinal(tempFileId: string, fileName: string, formId: number) {
    const tempPath = path.join(this.tempDir, `${tempFileId}-${fileName}`);
    const finalPath = path.join(this.uploadDir, String(formId), fileName);
    
    await moveFile(tempPath, finalPath);
    
    return finalPath;
  }
}