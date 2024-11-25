// redis.module.ts
import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigService, ConfigModule } from '@nestjs/config';
import { createClient } from 'redis';

interface RedisOptions {
  host: string;
  port: number;
}

@Global()
@Module({})
export class RedisModule {
  static forRootAsync(): DynamicModule {
    return {
      module: RedisModule,
      imports: [ConfigModule],
      providers: [
        {
          provide: 'REDIS_CLIENT',
          useFactory: async (configService: ConfigService) => {
            const client = createClient({
              socket: {
                host: configService.get('NODE_ENV') === 'development' 
                  ? 'localhost'
                  : configService.getOrThrow('REDIS_HOST'),
                port: configService.getOrThrow('REDIS_PORT')
              }
            });
            await client.connect();
            return client;
          },
          inject: [ConfigService]
        }
      ],
      exports: ['REDIS_CLIENT']
    };
  }
}