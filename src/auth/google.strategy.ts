import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {
    super({
      clientID: configService.get('GOOGLE_CLIENT_ID'),
      clientSecret: configService.get('GOOGLE_CLIENT_SECRET'),
      callbackURL: '/api/oauth/callback/google',
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<any> {
    const { name, emails, photos } = profile;

    // 查找或创建 AuthUser
    const authUser = await this.authService.findOrCreateAuthUser({
      provider: 'google',
      providerId: profile.id,
      email: emails[0].value,
      firstName: name.givenName,
      lastName: name.familyName,
      picture: photos[0].value,
    });

    // 如果已关联 User，直接返回
    if (authUser.user) {
      return done(null, {
        id: authUser.user.id,
        username: authUser.user.username,
        authUserId: authUser.id,
        needRegister: false,
      });
    }

    // 未关联 User，需要注册
    return done(null, {
      authUserId: authUser.id,
      email: authUser.email,
      needRegister: true,
    });
  }
}
