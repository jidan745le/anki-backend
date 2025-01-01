import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../user/entities/user.entity';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AuthUser } from './entities/auth-user.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(AuthUser)
    private authUserRepository: Repository<AuthUser>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private jwtService: JwtService,
  ) {}

  async findOrCreateAuthUser(
    authUserData: Partial<AuthUser>,
  ): Promise<AuthUser> {
    let authUser = await this.authUserRepository.findOne({
      where: {
        provider: authUserData.provider,
        providerId: authUserData.providerId,
      },
      relations: ['user'],
    });

    if (!authUser) {
      authUser = this.authUserRepository.create(authUserData);
      await this.authUserRepository.save(authUser);
    }

    return authUser;
  }

  async registerAndLinkUser(
    authUserId: number,
    username: string,
  ): Promise<User> {
    const authUser = await this.authUserRepository.findOne({
      where: { id: authUserId },
    });

    if (!authUser) {
      throw new NotFoundException('Auth user not found');
    }

    // 创建新用户
    const user = this.userRepository.create({
      username,
      password: randomUUID(), // 设置随机密码，因为用户使用 OAuth 登录
    });
    await this.userRepository.save(user);

    // 关联 AuthUser
    authUser.user = user;
    await this.authUserRepository.save(authUser);

    return user;
  }

  async googleLogin(req) {
    if (!req.user) {
      return 'No user from google';
    }

    const user = req.user;
    let token = '';
    let refreshToken = '';

    if (!user.needRegister) {
      // 已注册用户，生成 token
      token = await this.jwtService.signAsync({
        user: {
          id: user.id,
          username: user.username,
        },
      });

      refreshToken = await this.jwtService.signAsync(
        {
          user: {
            id: user.id,
          },
        },
        {
          expiresIn: '7d',
        },
      );
    }
    console.log(token, refreshToken, 'dddddd');

    // 返回 HTML，包含用户信息和 token（如果有）
    return `
      <html>
        <body>
          <script>
            window.opener.postMessage({
              isOAuthVerified: true,
              token: '${token}',
              refreshToken: '${refreshToken}',
              needRegister: ${user.needRegister},
              authUserId: ${user.authUserId},
              email: '${user.email || ''}',
            }, '*');
          </script>
        </body>
      </html>
    `;
  }
}
