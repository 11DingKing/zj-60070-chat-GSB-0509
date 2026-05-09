import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MessageType } from '@prisma/client';
import { ForwardMessageDto } from './dto/forward-message.dto';

@Injectable()
export class MessagesService {
  constructor(private prisma: PrismaService) {}

  async recallMessage(userId: string, messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (message.senderId !== userId) {
      throw new ForbiddenException('Not authorized to recall this message');
    }

    if (message.isRecalled) {
      throw new BadRequestException('Message already recalled');
    }

    const now = new Date();
    const messageTime = new Date(message.createdAt);
    const diffMs = now.getTime() - messageTime.getTime();
    const diffMins = diffMs / (1000 * 60);

    if (diffMins > 2) {
      throw new BadRequestException('Message can only be recalled within 2 minutes');
    }

    const recalledMessage = await this.prisma.message.update({
      where: { id: messageId },
      data: {
        isRecalled: true,
        recalledAt: new Date(),
      },
      include: {
        sender: {
          select: {
            id: true,
            nickname: true,
            avatar: true,
          },
        },
      },
    });

    return recalledMessage;
  }

  async deleteMessage(userId: string, messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    const existingDeleted = await this.prisma.deletedMessage.findUnique({
      where: { messageId_userId: { messageId, userId } },
    });

    if (existingDeleted) {
      return { message: 'Message already deleted for you' };
    }

    await this.prisma.deletedMessage.create({
      data: {
        messageId,
        userId,
      },
    });

    return { message: 'Message deleted successfully' };
  }

  async forwardMessages(userId: string, dto: ForwardMessageDto) {
    const messages = await this.prisma.message.findMany({
      where: {
        id: { in: dto.messageIds },
        isRecalled: false,
      },
    });

    if (messages.length !== dto.messageIds.length) {
      throw new NotFoundException('Some messages not found or already recalled');
    }

    const conversations = await this.prisma.conversation.findMany({
      where: {
        id: { in: dto.targetConversationIds },
      },
      include: {
        users: { select: { userId: true } },
        group: true,
      },
    });

    if (conversations.length !== dto.targetConversationIds.length) {
      throw new NotFoundException('Some conversations not found');
    }

    const forwardedMessages = [];

    for (const message of messages) {
      for (const conv of conversations) {
        let hasPermission = false;
        let targetUserIds: string[] = [];

        if (conv.type === 'private') {
          const convUser = conv.users.find((u) => u.userId === userId);
          if (convUser) {
            hasPermission = true;
            targetUserIds = conv.users.filter((u) => u.userId !== userId).map((u) => u.userId);
          }
        } else if (conv.type === 'group' && conv.group) {
          const isMember = conv.users.some((u) => u.userId === userId);
          if (isMember) {
            hasPermission = true;
            targetUserIds = conv.users.filter((u) => u.userId !== userId).map((u) => u.userId);
          }
        }

        if (!hasPermission) {
          continue;
        }

        const newMessage = await this.prisma.message.create({
          data: {
            senderId: userId,
            receiverId: conv.type === 'private' ? targetUserIds[0] : null,
            groupId: conv.group?.id || null,
            conversationId: conv.id,
            type: message.type,
            content: message.content,
            thumbnailUrl: message.thumbnailUrl,
          },
          include: {
            sender: {
              select: {
                id: true,
                nickname: true,
                avatar: true,
              },
            },
          },
        });

        await this.prisma.forwardedMessage.create({
          data: {
            originalMessageId: message.id,
            forwardedMessageId: newMessage.id,
            senderId: userId,
            conversationId: conv.id,
          },
        });

        for (const targetUserId of targetUserIds) {
          const convUser = await this.prisma.conversationUser.findFirst({
            where: {
              conversationId: conv.id,
              userId: targetUserId,
            },
          });

          if (convUser) {
            await this.prisma.conversationUser.update({
              where: { id: convUser.id },
              data: { unreadCount: { increment: 1 } },
            });
          }
        }

        forwardedMessages.push(newMessage);
      }
    }

    return {
      forwarded: true,
      count: forwardedMessages.length,
      messages: forwardedMessages,
    };
  }

  async getConversationMessages(
    userId: string,
    conversationId: string,
    page: number = 1,
    limit: number = 50,
    before?: Date,
  ) {
    const convUser = await this.prisma.conversationUser.findFirst({
      where: {
        conversationId,
        userId,
        isDeleted: false,
      },
    });

    if (!convUser) {
      throw new ForbiddenException('Not authorized to access this conversation');
    }

    const where: any = {
      conversationId,
      isRecalled: false,
      deletedBy: {
        none: {
          userId,
        },
      },
    };

    if (before) {
      where.createdAt = { lt: before };
    }

    const skip = (page - 1) * limit;

    const [messages, total] = await Promise.all([
      this.prisma.message.findMany({
        where,
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              nickname: true,
              avatar: true,
            },
          },
          reads: {
            select: {
              userId: true,
              readAt: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.message.count({ where }),
    ]);

    return {
      messages: messages.reverse(),
      pagination: {
        page,
        limit,
        total,
        hasMore: skip + messages.length < total,
      },
    };
  }

  async searchMessages(userId: string, keyword: string, page: number = 1, limit: number = 20) {
    const where: any = {
      OR: [
        { senderId: userId },
        { receiverId: userId },
        {
          conversation: {
            users: {
              some: { userId },
            },
          },
        },
      ],
      content: {
        contains: keyword,
        mode: 'insensitive',
      },
      isRecalled: false,
      deletedBy: {
        none: { userId },
      },
    };

    const skip = (page - 1) * limit;

    const [messages, total] = await Promise.all([
      this.prisma.message.findMany({
        where,
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              nickname: true,
              avatar: true,
            },
          },
          conversation: {
            select: {
              id: true,
              type: true,
              group: {
                select: {
                  id: true,
                  name: true,
                  avatar: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.message.count({ where }),
    ]);

    return {
      messages,
      pagination: {
        page,
        limit,
        total,
        hasMore: skip + messages.length < total,
      },
    };
  }

  async markMessagesAsRead(userId: string, messageIds: string[]) {
    const now = new Date();
    const results = [];

    for (const messageId of messageIds) {
      const existing = await this.prisma.messageRead.findUnique({
        where: { messageId_userId: { messageId, userId } },
      });

      if (!existing) {
        const read = await this.prisma.messageRead.create({
          data: {
            messageId,
            userId,
            readAt: now,
          },
        });
        results.push(read);
      }
    }

    return {
      markedAsRead: results.length,
      timestamp: now,
    };
  }

  async getOfflineMessages(userId: string) {
    const offlineMessages = await this.prisma.offlineMessage.findMany({
      where: {
        userId,
        isDelivered: false,
      },
      include: {
        user: false,
      },
      orderBy: { createdAt: 'asc' },
    });

    if (offlineMessages.length === 0) {
      return { messages: [], count: 0 };
    }

    const messageIds = offlineMessages.map((om) => om.messageId);

    const messages = await this.prisma.message.findMany({
      where: {
        id: { in: messageIds },
        isRecalled: false,
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
        reads: {
          select: {
            userId: true,
            readAt: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    await this.prisma.offlineMessage.updateMany({
      where: {
        id: { in: offlineMessages.map((om) => om.id) },
      },
      data: {
        isDelivered: true,
        deliveredAt: new Date(),
      },
    });

    return {
      messages,
      count: messages.length,
    };
  }
}
