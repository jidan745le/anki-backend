import { Test, TestingModule } from '@nestjs/testing';
import { AnkiService } from './anki.service';

describe('AnkiService', () => {
  let service: AnkiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AnkiService],
    }).compile();

    service = module.get<AnkiService>(AnkiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
