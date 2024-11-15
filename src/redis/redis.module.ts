// redis.module.ts
import { DynamicModule, Global, Module } from '@nestjs/common';
import { createClient } from 'redis';

interface RedisOptions {
  host: string;
  port: number;
}

@Global()
@Module({})
export class RedisModule {
  static forRoot(options: RedisOptions): DynamicModule {
    return {
      module: RedisModule,
      providers: [
        {
          provide: 'REDIS_CLIENT',
          useFactory: async () => {
            const client = createClient({
              socket: {
                host: options.host,
                port: options.port
              }
            });
            await client.connect();
            return client;
          }
        }
      ],
      exports: ['REDIS_CLIENT']
    };
  }
}