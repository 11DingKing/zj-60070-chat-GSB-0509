import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ConversationsService {
  constructor(private prisma: PrismaService) {}

  async getConversations(userId: string) {
    const convUsers = await this.prisma.conversationUser.findMany({
      where: {
        userId,
        isDeleted: false,
      },
      include: {
        conversation: {
          include: {
            group: {
              select: {
                id: true,
                name: true,
                avatar: true,
                ownerId: true,
                isDissolved: true,
              },
            },
            users: {
              include: {
                user: {
                  select: {
                    id: true,
                    username: true,
                    nickname: true,
                    avatar: true,
                    isOnline: true,
                    lastOnlineAt: true,
                  },
                },
              },
            },
            messages: {
              where: {
                isRecalled: false,
                deletedBy: {
                  none: { userId },
                },
              },
              orderBy: { createdAt: 'desc' },
              take: 1,
              include: {
                sender: {
                  select: {
                    id: true,
                    nickname: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: [
        { isPinned: 'desc' },
        { conversation: { lastMessageTime: 'desc' } },
        { joinedAt: 'desc' },
      ],
    });

    const conversations = convUsers.map((cu) => {
      const conv = cu.conversation;
      const lastMessage = conv.messages[0];

      let targetUser = null;
      let displayName = '';
      let displayAvatar = '';

      if (conv.type === 'private') {
        targetUser = conv.users
          .map((u) => u.user)
          .find((u) => u.id !== userId);
        if (targetUser) {
          displayName = targetUser.nickname || targetUser.username;
          displayAvatar = targetUser.avatar;
        }
      } else if (conv.group) {
        displayName = conv.group.name;
        displayAvatar = conv.group.avatar;
      }

      return {
        id: conv.id,
        type: conv.type,
        groupId: conv.groupId,
        group: conv.group,
        targetUser,
        displayName,
        displayAvatar,
        lastMessage: lastMessage
          ? {
              id: lastMessage.id,
              content: lastMessage.content,
              type: lastMessage.type,
              senderId: lastMessage.senderId,
              sender: lastMessage.sender,
              createdAt: lastMessage.createdAt,
              isRecalled: lastMessage.isRecalled,
            }
          : null,
        unreadCount: cu.unreadCount,
        isPinned: cu.isPinned,
        isMuted: cu.isMuted,
        lastReadMessageId: cu.lastReadMessageId,
        lastMessageTime: conv.lastMessageTime,
        joinedAt: cu.joinedAt,
      };
    });

    return conversations;
  }

  async pinConversation(userId: string, conversationId: string) {
    const convUser = await this.prisma.conversationUser.findFirst({
      where: {
        conversationId,
        userId,
      },
    });

    if (!convUser) {
      throw new NotFoundException('Conversation not found');
    }

    return this.prisma.conversationUser.update({
      where: { id: convUser.id },
      data: { isPinned: true },
    });
  }

  async unpinConversation(userId: string, conversationId: string) {
    const convUser = await this.prisma.conversationUser.findFirst({
      where: {
        conversationId,
        userId,
      },
    });

    if (!convUser) {
      throw new NotFoundException('Conversation not found');
    }

    return this.prisma.conversationUser.update({
      where: { id: convUser.id },
      data: { isPinned: false },
    });
  }

  async muteConversation(userId: string, conversationId: string) {
    const convUser = await this.prisma.conversationUser.findFirst({
      where: {
        conversationId,
        userId,
      },
    });

    if (!convUser) {
      throw new NotFoundException('Conversation not found');
    }

    return this.prisma.conversationUser.update({
      where: { id: convUser.id },
      data: { isMuted: true },
    });
  }

  async unmuteConversation(userId: string, conversationId: string) {
    const convUser = await this.prisma.conversationUser.findFirst({
      where: {
        conversationId,
        userId,
      },
    });

    if (!convUser) {
      throw new NotFoundException('Conversation not found');
    }

    return this.prisma.conversationUser.update({
      where: { id: convUser.id },
      data: { isMuted: false },
    });
  }

  async deleteConversation(userId: string, conversationId: string) {
    const convUser = await this.prisma.conversationUser.findFirst({
      where: {
        conversationId,
        userId,
      },
    });

    if (!convUser) {
      throw new NotFoundException('Conversation not found');
    }

    return this.prisma.conversationUser.update({
      where: { id: convUser.id },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
        unreadCount: 0,
      },
    });
  }

  async clearUnreadCount(userId: string, conversationId: string) {
    const convUser = await this.prisma.conversationUser.findFirst({
      where: {
        conversationId,
        userId,
      },
    });

    if (!convUser) {
      throw new NotFoundException('Conversation not found');
    }

    const lastMessage = await this.prisma.message.findFirst({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    return this.prisma.conversationUser.update({
      where: { id: convUser.id },
      data: {
        unreadCount: 0,
        lastReadMessageId: lastMessage?.id,
      },
    });
  }

  async getOrCreatePrivateConversation(userId: string, targetUserId: string) {
    if (userId === targetUserId) {
      throw new ForbiddenException('Cannot create conversation with yourself');
    }

    let conversation = await this.prisma.conversation.findFirst({
      where: {
        type: 'private',
        AND: [
          { users: { some: { userId } } },
          { users: { some: { userId: targetUserId } } },
        ],
      },
      include: {
        users: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                nickname: true,
                avatar: true,
                isOnline: true,
              },
            },
          },
        },
      },
    });

    if (!conversation) {
      conversation = await this.prisma.conversation.create({
        data: {
          type: 'private',
          users: {
            create: [
              { userId },
              { userId: targetUserId },
            ],
          },
        },
        include: {
          users: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  nickname: true,
                  avatar: true,
                  isOnline: true,
                },
              },
            },
          },
        },
      });
    } else {
      const userRecords = conversation.users;
      for (const ur of userRecords) {
        if (ur.isDeleted) {
          await this.prisma.conversationUser.update({
            where: { id: ur.id },
            data: {
              isDeleted: false,
              deletedAt: null,
            },
          });
        }
      }
    }

    const targetUser = conversation.users
      .map((u) => u.user)
      .find((u) => u.id !== userId);

    const convUser = conversation.users.find((u) => u.userId === userId);

    return {
      id: conversation.id,
      type: conversation.type,
      targetUser,
      displayName: targetUser?.nickname || targetUser?.username,
      displayAvatar: targetUser?.avatar,
      isPinned: convUser?.isPinned || false,
      isMuted: convUser?.isMuted || false,
      unreadCount: convUser?.unreadCount || 0,
      joinedAt: convUser?.joinedAt,
    };
  }
}
