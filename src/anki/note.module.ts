import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Note } from './entities/note.entity';
import { UserCard } from './entities/user-cards.entity';
import { NoteController } from './note.controller';
import { NoteService } from './note.service';

@Module({
  imports: [TypeOrmModule.forFeature([Note, UserCard])],
  controllers: [NoteController],
  providers: [NoteService],
  exports: [NoteService],
})
export class NoteModule {}
