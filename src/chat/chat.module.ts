import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [AuthModule, UsersModule, PrismaModule, RedisModule],
  providers: [ChatGateway],
  exports: [ChatGateway],
})
export class ChatModule {}
