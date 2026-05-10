// @ts-nocheck
import { Test, TestingModule } from '@nestjs/testing';
import { ConversationsService } from './conversations.service';
import { PrismaService } from '../prisma/prisma.service';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

describe('ConversationsService', () => {
  let service: ConversationsService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ConversationsService, PrismaService],
    })
      .overrideProvider(PrismaService)
      .useValue(mockDeep<PrismaClient>())
      .compile();

    service = module.get<ConversationsService>(ConversationsService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getConversations', () => {
    const userId = 'user-1';

    it('should return private conversations with target user', async () => {
      const mockConvUsers = [
        {
          id: 'cu-1',
          conversationId: 'conv-1',
          userId,
          isDeleted: false,
          isPinned: false,
          isMuted: false,
          unreadCount: 2,
          joinedAt: new Date('2024-01-01'),
          lastReadMessageId: null,
          conversation: {
            id: 'conv-1',
            type: 'private',
            groupId: null,
            lastMessageTime: new Date('2024-01-10'),
            group: null,
            users: [
              {
                userId,
                isDeleted: false,
                user: {
                  id: userId,
                  username: 'user1',
                  nickname: 'User 1',
                  avatar: 'avatar1.jpg',
                  isOnline: true,
                  lastOnlineAt: new Date(),
                },
              },
              {
                userId: 'user-2',
                isDeleted: false,
                user: {
                  id: 'user-2',
                  username: 'user2',
                  nickname: 'User 2',
                  avatar: 'avatar2.jpg',
                  isOnline: false,
                  lastOnlineAt: new Date(),
                },
              },
            ],
            messages: [
              {
                id: 'msg-1',
                content: 'Hello',
                type: 'TEXT',
                senderId: 'user-2',
                createdAt: new Date('2024-01-10'),
                isRecalled: false,
                sender: { id: 'user-2', nickname: 'User 2' },
              },
            ],
          },
        },
      ];

      prisma.conversationUser.findMany.mockResolvedValue(mockConvUsers as any);

      const result = await service.getConversations(userId);

      expect(prisma.conversationUser.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId, isDeleted: false },
        }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('private');
      expect(result[0].targetUser?.id).toBe('user-2');
      expect(result[0].displayName).toBe('User 2');
      expect(result[0].displayAvatar).toBe('avatar2.jpg');
      expect(result[0].unreadCount).toBe(2);
      expect(result[0].lastMessage?.content).toBe('Hello');
    });

    it('should return group conversations with group info', async () => {
      const mockConvUsers = [
        {
          id: 'cu-1',
          conversationId: 'conv-1',
          userId,
          isDeleted: false,
          isPinned: false,
          isMuted: false,
          unreadCount: 5,
          joinedAt: new Date('2024-01-01'),
          lastReadMessageId: null,
          conversation: {
            id: 'conv-1',
            type: 'group',
            groupId: 'group-1',
            lastMessageTime: new Date('2024-01-10'),
            group: {
              id: 'group-1',
              name: 'Test Group',
              avatar: 'group-avatar.jpg',
              ownerId: 'user-3',
              isDissolved: false,
            },
            users: [
              {
                userId,
                isDeleted: false,
                user: {
                  id: userId,
                  username: 'user1',
                  nickname: 'User 1',
                  avatar: 'avatar1.jpg',
                  isOnline: true,
                  lastOnlineAt: new Date(),
                },
              },
            ],
            messages: [
              {
                id: 'msg-1',
                content: 'Group message',
                type: 'TEXT',
                senderId: 'user-3',
                createdAt: new Date('2024-01-10'),
                isRecalled: false,
                sender: { id: 'user-3', nickname: 'User 3' },
              },
            ],
          },
        },
      ];

      prisma.conversationUser.findMany.mockResolvedValue(mockConvUsers as any);

      const result = await service.getConversations(userId);

      expect(result[0].type).toBe('group');
      expect(result[0].displayName).toBe('Test Group');
      expect(result[0].displayAvatar).toBe('group-avatar.jpg');
      expect(result[0].group?.id).toBe('group-1');
    });

    it('should handle conversations without last message', async () => {
      const mockConvUsers = [
        {
          id: 'cu-1',
          conversationId: 'conv-1',
          userId,
          isDeleted: false,
          isPinned: false,
          isMuted: false,
          unreadCount: 0,
          joinedAt: new Date('2024-01-01'),
          lastReadMessageId: null,
          conversation: {
            id: 'conv-1',
            type: 'private',
            groupId: null,
            lastMessageTime: null,
            group: null,
            users: [
              {
                userId,
                isDeleted: false,
                user: { id: userId, username: 'user1', nickname: 'User 1' },
              },
              {
                userId: 'user-2',
                isDeleted: false,
                user: { id: 'user-2', username: 'user2', nickname: 'User 2' },
              },
            ],
            messages: [],
          },
        },
      ];

      prisma.conversationUser.findMany.mockResolvedValue(mockConvUsers as any);

      const result = await service.getConversations(userId);

      expect(result[0].lastMessage).toBeNull();
    });

    it('should order by pinned first, then lastMessageTime desc', async () => {
      prisma.conversationUser.findMany.mockResolvedValue([]);
      await service.getConversations(userId);

      expect(prisma.conversationUser.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [
            { isPinned: 'desc' },
            { conversation: { lastMessageTime: 'desc' } },
            { joinedAt: 'desc' },
          ],
        }),
      );
    });
  });

  describe('getOrCreatePrivateConversation', () => {
    const userId = 'user-1';
    const targetUserId = 'user-2';

    it('should return existing conversation if it exists', async () => {
      const existingConversation = {
        id: 'conv-1',
        type: 'private',
        users: [
          {
            userId,
            isDeleted: false,
            isPinned: true,
            isMuted: false,
            unreadCount: 3,
            joinedAt: new Date('2024-01-01'),
            user: {
              id: userId,
              username: 'user1',
              nickname: 'User 1',
              avatar: 'avatar1.jpg',
              isOnline: true,
            },
          },
          {
            userId: targetUserId,
            isDeleted: false,
            user: {
              id: targetUserId,
              username: 'user2',
              nickname: 'User 2',
              avatar: 'avatar2.jpg',
              isOnline: false,
            },
          },
        ],
      };

      prisma.conversation.findFirst.mockResolvedValue(existingConversation as any);

      const result = await service.getOrCreatePrivateConversation(userId, targetUserId);

      expect(prisma.conversation.findFirst).toHaveBeenCalled();
      expect(prisma.conversation.create).not.toHaveBeenCalled();
      expect(result.id).toBe('conv-1');
      expect(result.targetUser?.id).toBe(targetUserId);
      expect(result.displayName).toBe('User 2');
      expect(result.isPinned).toBe(true);
      expect(result.unreadCount).toBe(3);
    });

    it('should create new conversation if it does not exist', async () => {
      const newConversation = {
        id: 'conv-new',
        type: 'private',
        users: [
          {
            userId,
            isDeleted: false,
            isPinned: false,
            isMuted: false,
            unreadCount: 0,
            joinedAt: new Date('2024-01-15'),
            user: {
              id: userId,
              username: 'user1',
              nickname: 'User 1',
              avatar: 'avatar1.jpg',
              isOnline: true,
            },
          },
          {
            userId: targetUserId,
            isDeleted: false,
            user: {
              id: targetUserId,
              username: 'user2',
              nickname: 'User 2',
              avatar: 'avatar2.jpg',
              isOnline: false,
            },
          },
        ],
      };

      prisma.conversation.findFirst.mockResolvedValue(null);
      prisma.conversation.create.mockResolvedValue(newConversation as any);

      const result = await service.getOrCreatePrivateConversation(userId, targetUserId);

      expect(prisma.conversation.create).toHaveBeenCalled();
      expect(result.id).toBe('conv-new');
    });

    it('should restore deleted conversation users', async () => {
      const existingConversation = {
        id: 'conv-1',
        type: 'private',
        users: [
          {
            id: 'cu-1',
            userId,
            isDeleted: true,
            isPinned: false,
            isMuted: false,
            unreadCount: 0,
            user: { id: userId, username: 'user1', nickname: 'User 1' },
          },
          {
            id: 'cu-2',
            userId: targetUserId,
            isDeleted: true,
            user: { id: targetUserId, username: 'user2', nickname: 'User 2' },
          },
        ],
      };

      prisma.conversation.findFirst.mockResolvedValue(existingConversation as any);
      prisma.conversationUser.update.mockResolvedValue({} as any);

      await service.getOrCreatePrivateConversation(userId, targetUserId);

      expect(prisma.conversationUser.update).toHaveBeenCalledTimes(2);
      expect(prisma.conversationUser.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cu-1' },
          data: { isDeleted: false, deletedAt: null },
        }),
      );
    });

    it('should throw ForbiddenException when creating conversation with yourself', async () => {
      await expect(
        service.getOrCreatePrivateConversation(userId, userId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should use username when nickname is not set', async () => {
      const existingConversation = {
        id: 'conv-1',
        type: 'private',
        users: [
          {
            userId,
            isDeleted: false,
            isPinned: false,
            isMuted: false,
            unreadCount: 0,
            user: { id: userId, username: 'user1', nickname: null },
          },
          {
            userId: targetUserId,
            isDeleted: false,
            user: { id: targetUserId, username: 'user2', nickname: null },
          },
        ],
      };

      prisma.conversation.findFirst.mockResolvedValue(existingConversation as any);

      const result = await service.getOrCreatePrivateConversation(userId, targetUserId);

      expect(result.displayName).toBe('user2');
    });
  });

  describe('pinConversation', () => {
    const userId = 'user-1';
    const conversationId = 'conv-1';

    it('should pin conversation successfully', async () => {
      const convUser = { id: 'cu-1', conversationId, userId };

      prisma.conversationUser.findFirst.mockResolvedValue(convUser as any);
      prisma.conversationUser.update.mockResolvedValue({ ...convUser, isPinned: true } as any);

      const result = await service.pinConversation(userId, conversationId);

      expect(prisma.conversationUser.update).toHaveBeenCalledWith({
        where: { id: convUser.id },
        data: { isPinned: true },
      });
      expect(result.isPinned).toBe(true);
    });

    it('should throw NotFoundException when conversation not found', async () => {
      prisma.conversationUser.findFirst.mockResolvedValue(null);

      await expect(service.pinConversation(userId, conversationId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('unpinConversation', () => {
    const userId = 'user-1';
    const conversationId = 'conv-1';

    it('should unpin conversation successfully', async () => {
      const convUser = { id: 'cu-1', conversationId, userId };

      prisma.conversationUser.findFirst.mockResolvedValue(convUser as any);
      prisma.conversationUser.update.mockResolvedValue({ ...convUser, isPinned: false } as any);

      const result = await service.unpinConversation(userId, conversationId);

      expect(prisma.conversationUser.update).toHaveBeenCalledWith({
        where: { id: convUser.id },
        data: { isPinned: false },
      });
      expect(result.isPinned).toBe(false);
    });

    it('should throw NotFoundException when conversation not found', async () => {
      prisma.conversationUser.findFirst.mockResolvedValue(null);

      await expect(service.unpinConversation(userId, conversationId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('muteConversation', () => {
    const userId = 'user-1';
    const conversationId = 'conv-1';

    it('should mute conversation successfully', async () => {
      const convUser = { id: 'cu-1', conversationId, userId };

      prisma.conversationUser.findFirst.mockResolvedValue(convUser as any);
      prisma.conversationUser.update.mockResolvedValue({ ...convUser, isMuted: true } as any);

      const result = await service.muteConversation(userId, conversationId);

      expect(prisma.conversationUser.update).toHaveBeenCalledWith({
        where: { id: convUser.id },
        data: { isMuted: true },
      });
      expect(result.isMuted).toBe(true);
    });

    it('should throw NotFoundException when conversation not found', async () => {
      prisma.conversationUser.findFirst.mockResolvedValue(null);

      await expect(service.muteConversation(userId, conversationId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('unmuteConversation', () => {
    const userId = 'user-1';
    const conversationId = 'conv-1';

    it('should unmute conversation successfully', async () => {
      const convUser = { id: 'cu-1', conversationId, userId };

      prisma.conversationUser.findFirst.mockResolvedValue(convUser as any);
      prisma.conversationUser.update.mockResolvedValue({ ...convUser, isMuted: false } as any);

      const result = await service.unmuteConversation(userId, conversationId);

      expect(prisma.conversationUser.update).toHaveBeenCalledWith({
        where: { id: convUser.id },
        data: { isMuted: false },
      });
      expect(result.isMuted).toBe(false);
    });

    it('should throw NotFoundException when conversation not found', async () => {
      prisma.conversationUser.findFirst.mockResolvedValue(null);

      await expect(service.unmuteConversation(userId, conversationId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteConversation', () => {
    const userId = 'user-1';
    const conversationId = 'conv-1';

    it('should delete conversation for user', async () => {
      const convUser = { id: 'cu-1', conversationId, userId };

      prisma.conversationUser.findFirst.mockResolvedValue(convUser as any);
      prisma.conversationUser.update.mockResolvedValue({
        ...convUser,
        isDeleted: true,
        unreadCount: 0,
      } as any);

      const result = await service.deleteConversation(userId, conversationId);

      expect(prisma.conversationUser.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: convUser.id },
          data: expect.objectContaining({ isDeleted: true, unreadCount: 0 }),
        }),
      );
      expect(result.isDeleted).toBe(true);
    });

    it('should throw NotFoundException when conversation not found', async () => {
      prisma.conversationUser.findFirst.mockResolvedValue(null);

      await expect(service.deleteConversation(userId, conversationId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('clearUnreadCount', () => {
    const userId = 'user-1';
    const conversationId = 'conv-1';

    it('should clear unread count and set lastReadMessageId', async () => {
      const convUser = { id: 'cu-1', conversationId, userId };
      const lastMessage = { id: 'msg-last' };

      prisma.conversationUser.findFirst.mockResolvedValue(convUser as any);
      prisma.message.findFirst.mockResolvedValue(lastMessage as any);
      prisma.conversationUser.update.mockResolvedValue({
        ...convUser,
        unreadCount: 0,
        lastReadMessageId: 'msg-last',
      } as any);

      const result = await service.clearUnreadCount(userId, conversationId);

      expect(prisma.message.findFirst).toHaveBeenCalledWith({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      expect(prisma.conversationUser.update).toHaveBeenCalledWith({
        where: { id: convUser.id },
        data: { unreadCount: 0, lastReadMessageId: 'msg-last' },
      });
      expect(result.unreadCount).toBe(0);
    });

    it('should handle case when there are no messages', async () => {
      const convUser = { id: 'cu-1', conversationId, userId };

      prisma.conversationUser.findFirst.mockResolvedValue(convUser as any);
      prisma.message.findFirst.mockResolvedValue(null);
      prisma.conversationUser.update.mockResolvedValue({
        ...convUser,
        unreadCount: 0,
        lastReadMessageId: null,
      } as any);

      await service.clearUnreadCount(userId, conversationId);

      expect(prisma.conversationUser.update).toHaveBeenCalledWith({
        where: { id: convUser.id },
        data: { unreadCount: 0, lastReadMessageId: undefined },
      });
    });

    it('should throw NotFoundException when conversation not found', async () => {
      prisma.conversationUser.findFirst.mockResolvedValue(null);

      await expect(service.clearUnreadCount(userId, conversationId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
