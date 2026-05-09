import {
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UseGuards } from '@nestjs/common';
import { WsJwtAuthGuard } from '../common/guards/ws-jwt-auth.guard';
import { AuthService } from '../auth/auth.service';
import { UsersService } from '../users/users.service';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { MessageType } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private userSocketMap: Map<string, Set<string>> = new Map();

  constructor(
    private authService: AuthService,
    private usersService: UsersService,
    private redisService: RedisService,
    private prisma: PrismaService,
  ) {}

  afterInit() {
    console.log('WebSocket Gateway initialized');
  }

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token?.replace('Bearer ', '');
      if (!token) {
        client.disconnect();
        return;
      }

      const jwtService = (this.authService as any).jwtService;
      const payload = await jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET,
      });

      const userId = payload.sub;
      const deviceId = client.handshake.query.deviceId as string || uuidv4();

      client['userId'] = userId;
      client['deviceId'] = deviceId;

      if (!this.userSocketMap.has(userId)) {
        this.userSocketMap.set(userId, new Set());
      }
      this.userSocketMap.get(userId).add(client.id);

      await this.authService.setUserOnline(userId, deviceId);

      this.server.emit('user:online', { userId, deviceId });

      console.log(`User ${userId} connected with device ${deviceId}`);
    } catch (error) {
      console.error('Connection error:', error);
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = client['userId'];
    const deviceId = client['deviceId'];

    if (userId) {
      const userSockets = this.userSocketMap.get(userId);
      if (userSockets) {
        userSockets.delete(client.id);
        if (userSockets.size === 0) {
          this.userSocketMap.delete(userId);
        }
      }

      if (deviceId) {
        await this.authService.setUserOffline(userId, deviceId);
      }

      this.server.emit('user:offline', { userId, deviceId });

      console.log(`User ${userId} disconnected with device ${deviceId}`);
    }
  }

  @SubscribeMessage('ping')
  async handlePing(client: Socket) {
    const userId = client['userId'];
    const deviceId = client['deviceId'];

    if (userId && deviceId) {
      await this.usersService.heartbeat(userId, deviceId);
      return { event: 'pong', data: { timestamp: Date.now() } };
    }
  }

  @SubscribeMessage('message:send')
  async handleSendMessage(client: Socket, data: any) {
    const userId = client['userId'];
    if (!userId) return;

    try {
      const { receiverId, groupId, type, content, thumbnailUrl } = data;

      let conversationId: string;
      let targetUserIds: string[] = [];

      if (groupId) {
        const group = await this.prisma.group.findUnique({
          where: { id: groupId, isDissolved: false },
          include: { members: { select: { userId: true } } },
        });

        if (!group) {
          client.emit('error', { message: 'Group not found' });
          return;
        }

        const isMember = group.members.some((m) => m.userId === userId);
        if (!isMember) {
          client.emit('error', { message: 'Not a group member' });
          return;
        }

        targetUserIds = group.members.filter((m) => m.userId !== userId).map((m) => m.userId);

        let conversation = await this.prisma.conversation.findFirst({
          where: { groupId },
        });

        if (!conversation) {
          conversation = await this.prisma.conversation.create({
            data: {
              type: 'group',
              groupId,
            },
          });
        }
        conversationId = conversation.id;
      } else if (receiverId) {
        if (receiverId === userId) {
          client.emit('error', { message: 'Cannot send message to yourself' });
          return;
        }

        const isFriend = await this.prisma.friendship.findFirst({
          where: {
            OR: [
              { user1Id: userId, user2Id: receiverId },
              { user1Id: receiverId, user2Id: userId },
            ],
          },
        });

        if (!isFriend) {
          client.emit('error', { message: 'Not friends' });
          return;
        }

        const isBlocked = await this.prisma.blockedUser.findFirst({
          where: {
            OR: [
              { blockerId: userId, blockedId: receiverId },
              { blockerId: receiverId, blockedId: userId },
            ],
          },
        });

        if (isBlocked) {
          client.emit('error', { message: 'Message cannot be sent' });
          return;
        }

        targetUserIds = [receiverId];

        let conversation = await this.prisma.conversation.findFirst({
          where: {
            type: 'private',
            AND: [
              { users: { some: { userId } } },
              { users: { some: { userId: receiverId } } },
            ],
          },
        });

        if (!conversation) {
          conversation = await this.prisma.conversation.create({
            data: {
              type: 'private',
              users: {
                create: [
                  { userId },
                  { userId: receiverId },
                ],
              },
            },
          });
        }
        conversationId = conversation.id;
      } else {
        client.emit('error', { message: 'receiverId or groupId required' });
        return;
      }

      const message = await this.prisma.message.create({
        data: {
          senderId: userId,
          receiverId: groupId ? null : receiverId,
          groupId: groupId || null,
          conversationId,
          type: type as MessageType,
          content,
          thumbnailUrl,
        },
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              nickname: true,
              avatar: true,
            },
          },
        },
      });

      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessageId: message.id,
          lastMessageTime: message.createdAt,
        },
      });

      for (const targetUserId of targetUserIds) {
        const convUser = await this.prisma.conversationUser.findFirst({
          where: {
            conversationId,
            userId: targetUserId,
          },
        });

        if (convUser) {
          await this.prisma.conversationUser.update({
            where: { id: convUser.id },
            data: {
              unreadCount: { increment: 1 },
            },
          });
        }

        const isOnline = await this.authService.isUserOnline(targetUserId);
        if (!isOnline) {
          await this.prisma.offlineMessage.create({
            data: {
              messageId: message.id,
              userId: targetUserId,
            },
          });
        }
      }

      const messageData = {
        id: message.id,
        senderId: message.senderId,
        receiverId: message.receiverId,
        groupId: message.groupId,
        conversationId: message.conversationId,
        type: message.type,
        content: message.content,
        thumbnailUrl: message.thumbnailUrl,
        isRead: message.isRead,
        isRecalled: message.isRecalled,
        createdAt: message.createdAt,
        sender: message.sender,
      };

      client.emit('message:sent', messageData);

      for (const targetUserId of targetUserIds) {
        this.sendMessageToUser(targetUserId, 'message:receive', messageData);
      }

      return messageData;
    } catch (error) {
      console.error('Send message error:', error);
      client.emit('error', { message: error.message });
    }
  }

  @SubscribeMessage('message:read')
  async handleMessageRead(client: Socket, data: { messageIds: string[]; conversationId: string }) {
    const userId = client['userId'];
    if (!userId || !data.messageIds || data.messageIds.length === 0) return;

    const now = new Date();

    for (const messageId of data.messageIds) {
      const messageRead = await this.prisma.messageRead.findUnique({
        where: { messageId_userId: { messageId, userId } },
      });

      if (!messageRead) {
        await this.prisma.messageRead.create({
          data: {
            messageId,
            userId,
            readAt: now,
          },
        });
      }
    }

    if (data.conversationId) {
      const convUser = await this.prisma.conversationUser.findFirst({
        where: {
          conversationId: data.conversationId,
          userId,
        },
      });

      if (convUser) {
        const lastMessage = await this.prisma.message.findFirst({
          where: { conversationId: data.conversationId },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });

        await this.prisma.conversationUser.update({
          where: { id: convUser.id },
          data: {
            unreadCount: 0,
            lastReadMessageId: lastMessage?.id,
          },
        });
      }
    }

    const readReceipt = {
      userId,
      messageIds: data.messageIds,
      readAt: now,
    };

    this.server.emit('message:read:receipt', readReceipt);

    return readReceipt;
  }

  @SubscribeMessage('typing:start')
  async handleTypingStart(client: Socket, data: { conversationId: string; targetUserId?: string }) {
    const userId = client['userId'];
    if (!userId) return;

    if (data.targetUserId) {
      this.sendMessageToUser(data.targetUserId, 'typing:start', {
        userId,
        conversationId: data.conversationId,
      });
    }
  }

  @SubscribeMessage('typing:stop')
  async handleTypingStop(client: Socket, data: { conversationId: string; targetUserId?: string }) {
    const userId = client['userId'];
    if (!userId) return;

    if (data.targetUserId) {
      this.sendMessageToUser(data.targetUserId, 'typing:stop', {
        userId,
        conversationId: data.conversationId,
      });
    }
  }

  private sendMessageToUser(userId: string, event: string, data: any) {
    const userSockets = this.userSocketMap.get(userId);
    if (userSockets) {
      for (const socketId of userSockets) {
        const socket = this.server.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit(event, data);
        }
      }
    }
  }

  getSocketIdsForUser(userId: string): string[] {
    const sockets = this.userSocketMap.get(userId);
    return sockets ? Array.from(sockets) : [];
  }
}
