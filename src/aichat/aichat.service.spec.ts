import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Card } from '../anki/entities/card.entity';
import { UserCard } from '../anki/entities/user-cards.entity';
import { EmbeddingService } from '../embedding/embedding.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { AichatService } from './aichat.service';
import { ChatMessage } from './entities/chat-message.entity';
import { UserCharacterPreference } from './entities/user-character-preference.entity';
import { VirtualCharacter } from './entities/virtual-character.entity';

describe('AichatService', () => {
  let service: AichatService;
  let virtualCharacterRepository: Repository<VirtualCharacter>;
  let userCharacterPreferenceRepository: Repository<UserCharacterPreference>;

  const mockVirtualCharacter = {
    id: 1,
    uuid: 'test-uuid',
    code: 'chihana',
    name: '星野学助',
    description: '测试角色',
    systemPrompt: '你是一个测试角色',
    voiceId: 'test-voice-id',
    emotionPatterns: ['happy', 'sad'],
    avatar: 'test-avatar.png',
    isActive: true,
    sortOrder: 1,
    userPreferences: [],
    generateUuid: jest.fn(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as VirtualCharacter;

  const mockUserPreference = {
    id: 1,
    user: { id: 1 },
    character: mockVirtualCharacter,
    isDefault: false,
    usageCount: 0,
    lastUsedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AichatService,
        {
          provide: getRepositoryToken(VirtualCharacter),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(UserCharacterPreference),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(ChatMessage),
          useValue: {},
        },
        {
          provide: getRepositoryToken(Card),
          useValue: {},
        },
        {
          provide: getRepositoryToken(UserCard),
          useValue: {},
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test-api-key'),
          },
        },
        {
          provide: DataSource,
          useValue: {},
        },
        {
          provide: EmbeddingService,
          useValue: {},
        },
        {
          provide: WebsocketGateway,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<AichatService>(AichatService);
    virtualCharacterRepository = module.get<Repository<VirtualCharacter>>(
      getRepositoryToken(VirtualCharacter),
    );
    userCharacterPreferenceRepository = module.get<Repository<UserCharacterPreference>>(
      getRepositoryToken(UserCharacterPreference),
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getAvailableCharacters', () => {
    it('should return available characters', async () => {
      jest.spyOn(virtualCharacterRepository, 'find').mockResolvedValue([mockVirtualCharacter]);

      const result = await service.getAvailableCharacters();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].code).toBe('chihana');
      expect(virtualCharacterRepository.find).toHaveBeenCalledWith({
        where: { isActive: true },
        order: { sortOrder: 'ASC', createdAt: 'ASC' },
        select: [
          'id',
          'uuid',
          'code',
          'name',
          'description',
          'avatar',
          'emotionPatterns',
          'sortOrder',
        ],
      });
    });
  });

  describe('activateCharacterForUser', () => {
    it('should activate a new character for user', async () => {
      jest.spyOn(virtualCharacterRepository, 'findOne').mockResolvedValue(mockVirtualCharacter);
      jest.spyOn(userCharacterPreferenceRepository, 'findOne').mockResolvedValue(null);
      jest.spyOn(userCharacterPreferenceRepository, 'create').mockReturnValue(mockUserPreference as any);
      jest.spyOn(userCharacterPreferenceRepository, 'save').mockResolvedValue(mockUserPreference as any);

      const result = await service.activateCharacterForUser(1, 'chihana');

      expect(result.success).toBe(true);
      expect(result.data.isNewActivation).toBe(true);
      expect(result.data.character.code).toBe('chihana');
    });

    it('should return existing activation if character already activated', async () => {
      jest.spyOn(virtualCharacterRepository, 'findOne').mockResolvedValue(mockVirtualCharacter);
      jest.spyOn(userCharacterPreferenceRepository, 'findOne').mockResolvedValue(mockUserPreference as any);
      jest.spyOn(userCharacterPreferenceRepository, 'save').mockResolvedValue(mockUserPreference as any);

      const result = await service.activateCharacterForUser(1, 'chihana');

      expect(result.success).toBe(true);
      expect(result.data.isNewActivation).toBe(false);
      expect(result.data.character.code).toBe('chihana');
    });
  });

  describe('getUserActivatedCharacters', () => {
    it('should return user activated characters', async () => {
      jest.spyOn(userCharacterPreferenceRepository, 'find').mockResolvedValue([mockUserPreference as any]);

      const result = await service.getUserActivatedCharacters(1);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].code).toBe('chihana');
    });
  });
});
