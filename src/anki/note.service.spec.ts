import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Note } from './entities/note.entity';
import { UserCard } from './entities/user-cards.entity';
import { NoteService } from './note.service';

describe('NoteService', () => {
  let service: NoteService;
  let noteRepository: Repository<Note>;
  let userCardRepository: Repository<UserCard>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NoteService,
        {
          provide: getRepositoryToken(Note),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            remove: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(UserCard),
          useValue: {
            findOne: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<NoteService>(NoteService);
    noteRepository = module.get<Repository<Note>>(getRepositoryToken(Note));
    userCardRepository = module.get<Repository<UserCard>>(
      getRepositoryToken(UserCard),
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a note', async () => {
      const userCard = { id: 1, uuid: 'test-uuid' } as UserCard;
      const createNoteDto = {
        title: 'Test Note',
        noteContent: 'Test content',
        userCardUuid: 'test-uuid',
      };

      jest.spyOn(userCardRepository, 'findOne').mockResolvedValue(userCard);
      jest.spyOn(noteRepository, 'create').mockReturnValue({} as Note);
      jest.spyOn(noteRepository, 'save').mockResolvedValue({} as Note);

      await service.create(createNoteDto, 1);

      expect(userCardRepository.findOne).toHaveBeenCalledWith({
        where: { uuid: 'test-uuid', user: { id: 1 } },
      });
      expect(noteRepository.create).toHaveBeenCalled();
      expect(noteRepository.save).toHaveBeenCalled();
    });
  });
});
