import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { diskStorage } from 'multer';
import { extname } from 'path';

export const multerConfig: MulterOptions = {
  storage: diskStorage({
    destination: './uploads/temp',
    filename: (req, file, callback) => {
      callback(null, `${Date.now()}${extname(file.originalname)}`);
    },
  }),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
};