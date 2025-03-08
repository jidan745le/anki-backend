import { Module } from '@nestjs/common';
import { EmbeddingController } from './embedding.controller';
import { EmbeddingService } from './embedding.service';

@Module({
  providers: [EmbeddingService],
  controllers: [EmbeddingController],
  exports: [EmbeddingService], // 导出服务以供其他模块使用
})
export class EmbeddingModule {}
