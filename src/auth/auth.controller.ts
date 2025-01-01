import {
  Controller,
  Get,
  Req,
  Res,
  UseGuards,
  SetMetadata,
  Post,
  Body,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { Response } from 'express';

@Controller('oauth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly jwtService: JwtService,
  ) {}

  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleAuth(@Req() req) {}

  @Get('callback/google')
  @UseGuards(AuthGuard('google'))
  @SetMetadata('skipInterceptors', true)
  async googleAuthRedirect(@Req() req) {
    return this.authService.googleLogin(req);
  }

  @Post('register')
  async registerOAuthUser(
    @Body() body: { authUserId: number; username: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const user = await this.authService.registerAndLinkUser(
        body.authUserId,
        body.username,
      );
      if (user) {
        const token = await this.jwtService.signAsync({
          user: {
            id: user.id,
            username: user.username,
          },
        });
        res.setHeader('token', token);

        const refreshToken = await this.jwtService.signAsync(
          {
            user: {
              id: user.id,
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
}
