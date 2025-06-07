import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as path from 'path';
import { AichatModule } from './aichat/aichat.module';
import { ChatMessage } from './aichat/entities/chat-message.entity';
import { AnkiModule } from './anki/anki.module';
import { Card } from './anki/entities/card.entity';
import { DeckSettings } from './anki/entities/deck-settings.entity';
import { Deck } from './anki/entities/deck.entity';
import { UserCard } from './anki/entities/user-cards.entity';
import { UserDeck } from './anki/entities/user-deck.entity';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { AuthUser } from './auth/entities/auth-user.entity';
import { TempFile } from './file/entities/temp-file.entity';
import { FileModule } from './file/file.module';
import { RedisModule } from './redis/redis.module';
import { ResponseInterceptor } from './response.interceptor';
import { User } from './user/entities/user.entity';
import { UserModule } from './user/user.module';
import { WebsocketModule } from './websocket/websocket.module';

@Module({
  imports: [
    UserModule,
    AnkiModule,
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
        synchronize: true,
        logging: false,
        migrations: ['dist/migrations/*.js'],
        entities: [
          User,
          AuthUser,
          Card,
          Deck,
          DeckSettings,
          ChatMessage,
          UserDeck,
          UserCard,
          TempFile,
        ],
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
export class AppModule implements OnModuleInit {
  async onModuleInit() {
    console.log('onModuleInit');
  }
}
