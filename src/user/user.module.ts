import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserCard } from '../anki/entities/user-cards.entity';
import { UserDeck } from '../anki/entities/user-deck.entity';
import { User } from './entities/user.entity';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, UserDeck, UserCard])],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
