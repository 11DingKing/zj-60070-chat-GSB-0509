import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private redisService: RedisService,
  ) {}

  async register(registerDto: RegisterDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { username: registerDto.username },
    });

    if (existingUser) {
      throw new ConflictException('Username already exists');
    }

    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        username: registerDto.username,
        password: hashedPassword,
        nickname: registerDto.nickname || registerDto.username,
      },
      select: {
        id: true,
        username: true,
        nickname: true,
        avatar: true,
        signature: true,
        isOnline: true,
        createdAt: true,
      },
    });

    const tokens = await this.generateTokens(user.id, user.username);

    return {
      user,
      ...tokens,
    };
  }

  async login(loginDto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { username: loginDto.username },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.generateTokens(user.id, user.username);

    return {
      user: {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        avatar: user.avatar,
        signature: user.signature,
        isOnline: user.isOnline,
        createdAt: user.createdAt,
      },
      ...tokens,
    };
  }

  async setUserOnline(userId: string, deviceId: string) {
    await this.redisService.sadd(`user:${userId}:devices`, deviceId);
    await this.redisService.expire(`user:${userId}:devices`, 3600);

    await this.redisService.hset(`user:${userId}:device:${deviceId}`, 'lastPing', Date.now().toString());
    await this.redisService.expire(`user:${userId}:device:${deviceId}`, 45);

    await this.prisma.user.update({
      where: { id: userId },
      data: { isOnline: true, lastOnlineAt: new Date() },
    });
  }

  async setUserOffline(userId: string, deviceId: string) {
    await this.redisService.srem(`user:${userId}:devices`, deviceId);
    await this.redisService.del(`user:${userId}:device:${deviceId}`);

    const devices = await this.redisService.smembers(`user:${userId}:devices`);
    if (devices.length === 0) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { isOnline: false, lastOnlineAt: new Date() },
      });
    }
  }

  async isUserOnline(userId: string): Promise<boolean> {
    const devices = await this.redisService.smembers(`user:${userId}:devices`);
    return devices.length > 0;
  }

  async getUserDevices(userId: string): Promise<string[]> {
    return this.redisService.smembers(`user:${userId}:devices`);
  }

  async refreshToken(userId: string, username: string) {
    return this.generateTokens(userId, username);
  }

  private async generateTokens(userId: string, username: string) {
    const payload: JwtPayload = { sub: userId, username };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
    };
  }
}
