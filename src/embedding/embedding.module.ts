import { Module } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';

@Module({
  providers: [EmbeddingService],
  exports: [EmbeddingService], // 导出服务以供其他模块使用
})
export class EmbeddingModule {}
