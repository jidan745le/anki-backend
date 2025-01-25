import { Module, NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { User } from './user/entities/user.entity';
import { Card } from './anki/entities/card.entity';
import { Deck } from './anki/entities/deck.entity';
import { UserModule } from './user/user.module';
import { AnkiModule } from './anki/anki.module';
import { JwtModule } from '@nestjs/jwt';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ResponseInterceptor } from './response.interceptor';
import { RedisModule } from './redis/redis.module';
import { FileModule } from './file/file.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WebsocketModule } from './websocket/websocket.module';
import * as path from 'path';
import { DeckSettings } from './anki/entities/deck-settings.entity';
import { AuthModule } from './auth/auth.module';
import { AuthUser } from './auth/entities/auth-user.entity';
import { AichatModule } from './aichat/aichat.module';
import { Chat } from './aichat/entities/chat.entity';
import { ChatMessage } from './aichat/entities/chat-message.entity';

@Module({
  imports: [
    UserModule,
    AnkiModule,
    WebsocketModule,
    ConfigModule.forRoot({
      envFilePath: path.join(__dirname, '.env'),
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'mysql',
        host:
          configService.get('NODE_ENV') === 'development'
            ? '127.0.0.1'
            : configService.getOrThrow('DB_HOST'),
        port: configService.getOrThrow('DB_PORT'),
        username: configService.getOrThrow('DB_USERNAME'),
        password: configService.getOrThrow('DB_PASSWORD'),
        database: configService.getOrThrow('DB_DATABASE'),
        synchronize: false,
        migrations: ['dist/migrations/*.js'],
        entities: [User, AuthUser, Card, Deck, DeckSettings, Chat, ChatMessage],
        poolSize: configService.getOrThrow('DB_POOL_SIZE'),
        connectorPackage: 'mysql2',
        extra: {
          authPlugin: 'sha256_password',
        },
      }),
      inject: [ConfigService],
    }),
    RedisModule.forRootAsync(),
    JwtModule.register({
      global: true,
      secret: 'secret',
      signOptions: { expiresIn: '1d' },
    }),
    RedisModule,
    FileModule,
    WebsocketModule,
    AuthModule,
    AichatModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor, // 注册全局拦截器
    },
    {
      provide: 'aaa',
      useValue: 'bbb',
    },
  ],
})
export class AppModule {}
