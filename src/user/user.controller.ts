import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import {
  Controller,
  Post,
  Body,
  Inject,
  Req,
  Res,
  Get,
  ValidationPipe,
  HttpException,
  Logger,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { UserService } from './user.service';
import { JwtService } from '@nestjs/jwt';
import { Response } from 'express';
import { WebsocketGateway } from 'src/websocket/websocket.gateway';
import { LoginGuard } from 'src/login.guard';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Inject(JwtService)
  private jwtService: JwtService;

  @Inject(WebsocketGateway)
  private websocketGateway: WebsocketGateway;

  @Post('login')
  async login(
    @Body() user: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const foundUser = await this.userService.login(user);

      if (foundUser) {
        const token = await this.jwtService.signAsync({
          user: {
            id: foundUser.id,
            username: foundUser.username,
          },
        });
        res.setHeader('token', token);
        return 'login success';
      } else {
        return 'login fail';
      }
    } catch (err) {
      Logger.error(err);
      throw err;
    }
  }
  @Post('register')
  async register(
    @Body(ValidationPipe) user: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const userInfo = await this.userService.register(user);
      const foundUser = await this.userService.login(userInfo);
      if (foundUser) {
        const token = await this.jwtService.signAsync({
          user: {
            id: foundUser.id,
            username: foundUser.username,
          },
        });
        res.setHeader('token', token);
        return 'success';
      } else {
        throw new HttpException('failure', 200);
      }
    } catch (err) {
      throw err;
    }
  }
  @UseGuards(LoginGuard)
  @Post('logout')
  async logout(@Req() req) {
    try {
      const userId = req?.user?.id;
      Logger.log(`Logout user: ${userId}`);
      if (userId) {
        await this.websocketGateway.clearUserConnections(userId);
        return 'Logout successful';
      }
      throw new HttpException('User not found', HttpStatus.BAD_REQUEST);
    } catch (error) {
      Logger.error('Logout error:', error);
      throw error;
    }
  }
}
