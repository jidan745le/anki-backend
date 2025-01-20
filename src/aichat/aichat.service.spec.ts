import { Test, TestingModule } from '@nestjs/testing';
import { AichatService } from './aichat.service';

describe('AichatService', () => {
  let service: AichatService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AichatService],
    }).compile();

    service = module.get<AichatService>(AichatService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
