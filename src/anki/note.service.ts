import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BatchWriteNotesDto } from './dto/batch-write-notes.dto';
import { CreateNoteDto } from './dto/create-note.dto';
import { GetNotesDto } from './dto/get-notes.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { Note } from './entities/note.entity';
import { UserCard } from './entities/user-cards.entity';

@Injectable()
export class NoteService {
  constructor(
    @InjectRepository(Note)
    private noteRepository: Repository<Note>,
    @InjectRepository(UserCard)
    private userCardRepository: Repository<UserCard>,
  ) {}

  async create(createNoteDto: CreateNoteDto, userId: number): Promise<Note> {
    // 验证用户卡片是否存在且属于当前用户
    const userCard = await this.userCardRepository.findOne({
      where: { uuid: createNoteDto.userCardUuid, user: { id: userId } },
    });

    if (!userCard) {
      throw new NotFoundException('User card not found');
    }

    const note = this.noteRepository.create({
      title: createNoteDto.title,
      noteContent: createNoteDto.noteContent,
      referenceText: createNoteDto.referenceText,
      color: createNoteDto.color,
      isPinned: createNoteDto.isPinned || false,
      userCard,
      user: { id: userId },
    });

    return this.noteRepository.save(note);
  }

  async batchWrite(
    batchWriteNotesDto: BatchWriteNotesDto,
    userId: number,
  ): Promise<{
    created: Note[];
    updated: Note[];
    errors: Array<{ index: number; error: string }>;
  }> {
    const created: Note[] = [];
    const updated: Note[] = [];
    const errors: Array<{ index: number; error: string }> = [];

    for (let i = 0; i < batchWriteNotesDto.notes.length; i++) {
      const noteItem = batchWriteNotesDto.notes[i];

      try {
        // 验证用户卡片是否存在且属于当前用户
        const userCard = await this.userCardRepository.findOne({
          where: { uuid: noteItem.userCardUuid, user: { id: userId } },
        });

        if (!userCard) {
          errors.push({ index: i, error: 'User card not found' });
          continue;
        }

        if (noteItem.id || noteItem.uuid) {
          // 更新操作
          const whereCondition = noteItem.id
            ? { id: noteItem.id, user: { id: userId } }
            : { uuid: noteItem.uuid, user: { id: userId } };

          const existingNote = await this.noteRepository.findOne({
            where: whereCondition,
          });

          if (!existingNote) {
            errors.push({ index: i, error: 'Note not found for update' });
            continue;
          }

          Object.assign(existingNote, {
            title: noteItem.title,
            noteContent: noteItem.noteContent,
            referenceText: noteItem.referenceText,
            color: noteItem.color,
            isPinned: noteItem.isPinned,
            userCard,
          });

          const updatedNote = await this.noteRepository.save(existingNote);
          updated.push(updatedNote);
        } else {
          // 创建操作
          const note = this.noteRepository.create({
            title: noteItem.title,
            noteContent: noteItem.noteContent,
            referenceText: noteItem.referenceText,
            color: noteItem.color,
            isPinned: noteItem.isPinned || false,
            userCard,
            user: { id: userId },
          });

          const savedNote = await this.noteRepository.save(note);
          created.push(savedNote);
        }
      } catch (error) {
        errors.push({ index: i, error: error.message });
      }
    }

    return { created, updated, errors };
  }

  async findAll(
    userId: number,
    getNotesDto: GetNotesDto,
  ): Promise<{
    data: Note[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const {
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'DESC',
      userCardUuid,
      title,
      color,
      isPinned,
    } = getNotesDto;

    const queryBuilder = this.noteRepository
      .createQueryBuilder('note')
      .leftJoinAndSelect('note.userCard', 'userCard')
      .leftJoinAndSelect('userCard.deck', 'deck')
      .where('note.user_id = :userId', { userId });

    // 筛选条件
    if (userCardUuid) {
      queryBuilder.andWhere('userCard.uuid = :userCardUuid', { userCardUuid });
    }

    if (title) {
      queryBuilder.andWhere('note.title LIKE :title', { title: `%${title}%` });
    }

    if (color) {
      queryBuilder.andWhere('note.color = :color', { color });
    }

    if (isPinned !== undefined) {
      queryBuilder.andWhere('note.isPinned = :isPinned', { isPinned });
    }

    // 排序
    const orderDirection = sortOrder === 'ASC' ? 'ASC' : 'DESC';
    queryBuilder.orderBy(`note.${sortBy}`, orderDirection);

    // 分页
    const offset = (page - 1) * limit;
    queryBuilder.skip(offset).take(limit);

    const [notes, total] = await queryBuilder.getManyAndCount();

    return {
      data: notes,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: number, userId: number): Promise<Note> {
    const note = await this.noteRepository.findOne({
      where: { id, user: { id: userId } },
      relations: ['userCard', 'userCard.deck'],
    });

    if (!note) {
      throw new NotFoundException('Note not found');
    }

    return note;
  }

  async findByUuid(uuid: string, userId: number): Promise<Note> {
    const note = await this.noteRepository.findOne({
      where: { uuid, user: { id: userId } },
      relations: ['userCard', 'userCard.deck'],
    });

    if (!note) {
      throw new NotFoundException('Note not found');
    }

    return note;
  }

  async update(
    id: number,
    updateNoteDto: UpdateNoteDto,
    userId: number,
  ): Promise<Note> {
    const note = await this.noteRepository.findOne({
      where: { id, user: { id: userId } },
    });

    if (!note) {
      throw new NotFoundException('Note not found');
    }

    Object.assign(note, updateNoteDto);
    return this.noteRepository.save(note);
  }

  async remove(id: number, userId: number): Promise<void> {
    const note = await this.noteRepository.findOne({
      where: { id, user: { id: userId } },
    });

    if (!note) {
      throw new NotFoundException('Note not found');
    }

    await this.noteRepository.remove(note);
  }

  async getNotesForUserCard(
    userCardUuid: string,
    userId: number,
  ): Promise<Note[]> {
    // 首先验证用户卡片是否存在且属于当前用户
    const userCard = await this.userCardRepository.findOne({
      where: { uuid: userCardUuid, user: { id: userId } },
    });

    if (!userCard) {
      throw new NotFoundException('User card not found');
    }
    const notes = await this.noteRepository.find({
      where: { userCard: { uuid: userCardUuid }, user: { id: userId } },
      order: { isPinned: 'DESC', updatedAt: 'DESC' },
    });
    console.log(notes, 'notes');
    return notes;
  }

  async togglePin(id: number, userId: number): Promise<Note> {
    const note = await this.noteRepository.findOne({
      where: { id, user: { id: userId } },
    });

    if (!note) {
      throw new NotFoundException('Note not found');
    }

    note.isPinned = !note.isPinned;
    return this.noteRepository.save(note);
  }
}
