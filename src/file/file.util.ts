// utils/file.util.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import {fromFile} from 'file-type';
import { BadRequestException } from '@nestjs/common';


import { ContentType } from 'src/anki/entities/card.entity';

export async function ensureDir(dir: string) {
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

export async function moveFile(sourcePath: string, targetPath: string) {
  await ensureDir(path.dirname(targetPath));
  await fs.rename(sourcePath, targetPath);
}

export async function getFileType(filePath: string): Promise<ContentType> {
    const fileType = await fromFile(filePath);
    if (!fileType) {
        throw new BadRequestException('Unknown file type');
    }

    const mimeType = fileType.mime;
    
    if (mimeType.startsWith('image/')) {
        return ContentType.IMAGE;
    } else if (mimeType.startsWith('video/')) {
        return ContentType.VIDEO;
    } else if (mimeType.startsWith('audio/')) {
        return ContentType.AUDIO;
    } else {
        throw new BadRequestException('Unsupported file type');
    }
}