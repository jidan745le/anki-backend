import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Deck } from 'src/anki/entities/deck.entity';
import { EmbeddingController } from './embedding.controller';
import { EmbeddingService } from './embedding.service';

@Module({
  imports: [TypeOrmModule.forFeature([Deck])],
  providers: [EmbeddingService],
  controllers: [EmbeddingController],
  exports: [EmbeddingService], // 导出服务以供其他模块使用
})
export class EmbeddingModule {}
