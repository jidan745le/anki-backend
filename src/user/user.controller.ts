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
  Query,
  UnauthorizedException,
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

        const refreshToken = await this.jwtService.signAsync(
          {
            user: {
              id: foundUser.id,
            },
          },
          {
            expiresIn: '7d',
          },
        );

        res.setHeader('refreshToken', refreshToken);
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

        const refreshToken = await this.jwtService.signAsync(
          {
            user: {
              id: foundUser.id,
            },
          },
          {
            expiresIn: '7d',
          },
        );
        res.setHeader('token', token);
        res.setHeader('refreshToken', refreshToken);
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

  @Get('refresh')
  async refresh(@Query('refresh_token') refreshToken: string) {
    try {
      const data = this.jwtService.verify(refreshToken);

      const user = await this.userService.findUserById(data.user.id);

      const access_token = this.jwtService.sign({
        user: {
          id: user.id,
          username: user.username,
        },
      });

      const refresh_token = this.jwtService.sign(
        {
          user: {
            id: user.id,
          },
        },
        {
          expiresIn: '7d',
        },
      );

      return {
        access_token,
        refresh_token,
      };
    } catch (e) {
      throw new UnauthorizedException('token 已失效，请重新登录');
    }
  }
}
