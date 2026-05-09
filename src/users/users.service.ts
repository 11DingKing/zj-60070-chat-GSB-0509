import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {}

  async findById(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        nickname: true,
        avatar: true,
        signature: true,
        email: true,
        phone: true,
        isOnline: true,
        lastOnlineAt: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async findByUsername(username: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        nickname: true,
        avatar: true,
        signature: true,
        isOnline: true,
        lastOnlineAt: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateProfile(userId: string, updateProfileDto: UpdateProfileDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: updateProfileDto,
      select: {
        id: true,
        username: true,
        nickname: true,
        avatar: true,
        signature: true,
        email: true,
        phone: true,
        isOnline: true,
        lastOnlineAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return user;
  }

  async searchUsers(keyword: string) {
    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { username: { contains: keyword, mode: 'insensitive' } },
          { nickname: { contains: keyword, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        username: true,
        nickname: true,
        avatar: true,
        signature: true,
        isOnline: true,
        lastOnlineAt: true,
      },
      take: 20,
    });

    return users;
  }

  async getOnlineStatus(userId: string) {
    const devices = await this.redisService.smembers(`user:${userId}:devices`);
    const isOnline = devices.length > 0;

    if (!isOnline) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { lastOnlineAt: true },
      });
      return {
        isOnline: false,
        lastOnlineAt: user?.lastOnlineAt,
      };
    }

    return {
      isOnline: true,
      lastOnlineAt: new Date(),
    };
  }

  async heartbeat(userId: string, deviceId: string) {
    await this.redisService.hset(`user:${userId}:device:${deviceId}`, 'lastPing', Date.now().toString());
    await this.redisService.expire(`user:${userId}:device:${deviceId}`, 45);
    await this.redisService.expire(`user:${userId}:devices`, 3600);
  }
}
