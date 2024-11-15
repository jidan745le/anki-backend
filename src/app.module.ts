import { Module, NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { User } from './user/entities/user.entity';
import { Card } from './anki/entities/card.entity';
import { Deck } from './anki/entities/deck.entity';
import { UserModule } from './user/user.module';
import { AnkiModule } from './anki/anki.module';
import { JwtModule } from "@nestjs/jwt"
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ResponseInterceptor } from './response.interceptor';
import { RedisModule } from './redis/redis.module';
import { FileModule } from './file/file.module';

@Module({
  imports: [
    UserModule,
    AnkiModule,
    TypeOrmModule.forRoot({
      type: "mysql",
      host: process.env.NODE_ENV == "development" ? "localhost" : "mysql-container",
      port: 3306,
      username: "root",
      password: "123456",
      database: "anki",
      synchronize: true,
      // logging: true,
      entities: [User, Card, Deck],
      poolSize: 10,
      connectorPackage: 'mysql2',
      extra: {
        authPlugin: 'sha256_password',
      },

    }),
    RedisModule.forRoot({ host: process.env.NODE_ENV == "development" ? "localhost" : "redis-container", port: 6379 }),
    JwtModule.register({ global: true, secret: "secret", signOptions: { expiresIn: "1d" } }),
    RedisModule,
    FileModule,
  ],
  controllers: [
    AppController,

  ],
  providers: [
    AppService, {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor, // 注册全局拦截器
    }, {
      provide: "aaa",
      useValue: "bbb"
    }],
})
export class AppModule { } 
