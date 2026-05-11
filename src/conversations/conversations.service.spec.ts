// @ts-nocheck
import { Test, TestingModule } from '@nestjs/testing';
import { ConversationsService } from './conversations.service';
import { PrismaService } from '../prisma/prisma.service';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

describe('ConversationsService', () => {
  let service: ConversationsService;
  let prisma: DeepMockProxy<PrismaService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ConversationsService, PrismaService],
    })
      .overrideProvider(PrismaService)
      .useValue(mockDeep<PrismaService>())
      .compile();

    service = module.get<ConversationsService>(ConversationsService);
    prisma = module.get(PrismaService);
  });

  const mockUser = {
    id: 'user-1',
    username: 'testuser',
    nickname: 'Test User',
    avatar: 'avatar.jpg',
    isOnline: true,
    lastOnlineAt: new Date(),
  };

  const mockUser2 = {
    id: 'user-2',
    username: 'testuser2',
    nickname: 'Test User 2',
    avatar: 'avatar2.jpg',
    isOnline: false,
    lastOnlineAt: new Date(),
  };

  describe('getOrCreatePrivateConversation', () => {
    it('should return existing conversation if it exists', async () => {
      const mockExistingConversation = {
        id: 'conv-1',
        type: 'private',
        users: [
          { id: 'cu-1', userId: 'user-1', isDeleted: false, isPinned: false, isMuted: false, unreadCount: 0, joinedAt: new Date(), user: mockUser },
          { id: 'cu-2', userId: 'user-2', isDeleted: false, isPinned: false, isMuted: false, unreadCount: 0, joinedAt: new Date(), user: mockUser2 },
        ],
      };

      prisma.conversation.findFirst.mockResolvedValue(mockExistingConversation as any);

      const result = await service.getOrCreatePrivateConversation('user-1', 'user-2');

      expect(result.id).toBe('conv-1');
      expect(prisma.conversation.create).not.toHaveBeenCalled();
      expect(prisma.conversationUser.update).not.toHaveBeenCalled();
    });

    it('should create new conversation if it does not exist', async () => {
      const mockNewConversation = {
        id: 'conv-new',
        type: 'private',
        users: [
          { id: 'cu-1', userId: 'user-1', isDeleted: false, isPinned: false, isMuted: false, unreadCount: 0, joinedAt: new Date(), user: mockUser },
          { id: 'cu-2', userId: 'user-2', isDeleted: false, isPinned: false, isMuted: false, unreadCount: 0, joinedAt: new Date(), user: mockUser2 },
        ],
      };

      prisma.conversation.findFirst.mockResolvedValue(null);
      prisma.conversation.create.mockResolvedValue(mockNewConversation as any);

      const result = await service.getOrCreatePrivateConversation('user-1', 'user-2');

      expect(result.id).toBe('conv-new');
      expect(prisma.conversation.create).toHaveBeenCalled();
    });

    it('should restore deleted users in existing conversation', async () => {
      const mockExistingConversation = {
        id: 'conv-1',
        type: 'private',
        users: [
          { id: 'cu-1', userId: 'user-1', isDeleted: true, isPinned: false, isMuted: false, unreadCount: 0, joinedAt: new Date(), user: mockUser },
          { id: 'cu-2', userId: 'user-2', isDeleted: false, isPinned: false, isMuted: false, unreadCount: 0, joinedAt: new Date(), user: mockUser2 },
        ],
      };

      prisma.conversation.findFirst.mockResolvedValue(mockExistingConversation as any);
      prisma.conversationUser.update.mockResolvedValue({} as any);

      const result = await service.getOrCreatePrivateConversation('user-1', 'user-2');

      expect(result.id).toBe('conv-1');
      expect(prisma.conversationUser.update).toHaveBeenCalledWith({
        where: { id: 'cu-1' },
        data: { isDeleted: false, deletedAt: null },
      });
    });

    it('should throw ForbiddenException when trying to create conversation with yourself', async () => {
      await expect(service.getOrCreatePrivateConversation('user-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('getConversations', () => {
    it('should return conversations sorted by pinned and last message time', async () => {
      const mockConvUsers = [
        {
          id: 'cu-1',
          userId: 'user-1',
          conversationId: 'conv-1',
          isPinned: true,
          isMuted: false,
          isDeleted: false,
          unreadCount: 2,
          lastReadMessageId: 'msg-1',
          joinedAt: new Date(),
          conversation: {
            id: 'conv-1',
            type: 'private',
            groupId: null,
            lastMessageTime: new Date(),
            users: [
              { userId: 'user-1', user: mockUser },
              { userId: 'user-2', user: mockUser2 },
            ],
            messages: [
              {
                id: 'msg-1',
                content: 'Hello',
                type: 'TEXT',
                senderId: 'user-2',
                createdAt: new Date(),
                isRecalled: false,
                sender: mockUser2,
              },
            ],
          },
        },
        {
          id: 'cu-2',
          userId: 'user-1',
          conversationId: 'conv-2',
          isPinned: false,
          isMuted: false,
          isDeleted: false,
          unreadCount: 0,
          lastReadMessageId: null,
          joinedAt: new Date(),
          conversation: {
            id: 'conv-2',
            type: 'group',
            groupId: 'group-1',
            lastMessageTime: new Date(),
            group: {
              id: 'group-1',
              name: 'Test Group',
              avatar: 'group.jpg',
              ownerId: 'user-1',
              isDissolved: false,
            },
            users: [],
            messages: [],
          },
        },
      ];

      prisma.conversationUser.findMany.mockResolvedValue(mockConvUsers as any);

      const result = await service.getConversations('user-1');

      expect(result).toHaveLength(2);
      expect(result[0].isPinned).toBe(true);
      expect(result[0].displayName).toBe('Test User 2');
      expect(result[1].displayName).toBe('Test Group');
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

    it('should handle conversations without last message', async () => {
      const mockConvUsers = [
        {
          id: 'cu-1',
          userId: 'user-1',
          conversationId: 'conv-1',
          isPinned: false,
          isMuted: false,
          isDeleted: false,
          unreadCount: 0,
          lastReadMessageId: null,
          joinedAt: new Date(),
          conversation: {
            id: 'conv-1',
            type: 'private',
            groupId: null,
            lastMessageTime: null,
            users: [
              { userId: 'user-1', user: mockUser },
              { userId: 'user-2', user: mockUser2 },
            ],
            messages: [],
          },
        },
      ];

      prisma.conversationUser.findMany.mockResolvedValue(mockConvUsers as any);

      const result = await service.getConversations('user-1');

      expect(result[0].lastMessage).toBeNull();
    });
  });

  describe('pinConversation', () => {
    it('should pin conversation successfully', async () => {
      const mockConvUser = { id: 'cu-1', userId: 'user-1', conversationId: 'conv-1' };
      prisma.conversationUser.findFirst.mockResolvedValue(mockConvUser as any);
      prisma.conversationUser.update.mockResolvedValue({ ...mockConvUser, isPinned: true } as any);

      const result = await service.pinConversation('user-1', 'conv-1');

      expect(result.isPinned).toBe(true);
      expect(prisma.conversationUser.update).toHaveBeenCalledWith({
        where: { id: 'cu-1' },
        data: { isPinned: true },
      });
    });

    it('should throw NotFoundException when conversation not found', async () => {
      prisma.conversationUser.findFirst.mockResolvedValue(null);

      await expect(service.pinConversation('user-1', 'conv-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('unpinConversation', () => {
    it('should unpin conversation successfully', async () => {
      const mockConvUser = { id: 'cu-1', userId: 'user-1', conversationId: 'conv-1' };
      prisma.conversationUser.findFirst.mockResolvedValue(mockConvUser as any);
      prisma.conversationUser.update.mockResolvedValue({ ...mockConvUser, isPinned: false } as any);

      const result = await service.unpinConversation('user-1', 'conv-1');

      expect(result.isPinned).toBe(false);
    });

    it('should throw NotFoundException when conversation not found', async () => {
      prisma.conversationUser.findFirst.mockResolvedValue(null);

      await expect(service.unpinConversation('user-1', 'conv-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('muteConversation', () => {
    it('should mute conversation successfully', async () => {
      const mockConvUser = { id: 'cu-1', userId: 'user-1', conversationId: 'conv-1' };
      prisma.conversationUser.findFirst.mockResolvedValue(mockConvUser as any);
      prisma.conversationUser.update.mockResolvedValue({ ...mockConvUser, isMuted: true } as any);

      const result = await service.muteConversation('user-1', 'conv-1');

      expect(result.isMuted).toBe(true);
    });

    it('should throw NotFoundException when conversation not found', async () => {
      prisma.conversationUser.findFirst.mockResolvedValue(null);

      await expect(service.muteConversation('user-1', 'conv-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('unmuteConversation', () => {
    it('should unmute conversation successfully', async () => {
      const mockConvUser = { id: 'cu-1', userId: 'user-1', conversationId: 'conv-1' };
      prisma.conversationUser.findFirst.mockResolvedValue(mockConvUser as any);
      prisma.conversationUser.update.mockResolvedValue({ ...mockConvUser, isMuted: false } as any);

      const result = await service.unmuteConversation('user-1', 'conv-1');

      expect(result.isMuted).toBe(false);
    });

    it('should throw NotFoundException when conversation not found', async () => {
      prisma.conversationUser.findFirst.mockResolvedValue(null);

      await expect(service.unmuteConversation('user-1', 'conv-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteConversation', () => {
    it('should mark conversation as deleted', async () => {
      const mockConvUser = { id: 'cu-1', userId: 'user-1', conversationId: 'conv-1' };
      prisma.conversationUser.findFirst.mockResolvedValue(mockConvUser as any);
      prisma.conversationUser.update.mockResolvedValue({ ...mockConvUser, isDeleted: true } as any);

      const result = await service.deleteConversation('user-1', 'conv-1');

      expect(result.isDeleted).toBe(true);
      expect(prisma.conversationUser.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isDeleted: true, unreadCount: 0 }),
        }),
      );
    });

    it('should throw NotFoundException when conversation not found', async () => {
      prisma.conversationUser.findFirst.mockResolvedValue(null);

      await expect(service.deleteConversation('user-1', 'conv-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('clearUnreadCount', () => {
    it('should clear unread count and set last read message', async () => {
      const mockConvUser = { id: 'cu-1', userId: 'user-1', conversationId: 'conv-1' };
      const mockLastMessage = { id: 'msg-last' };
      prisma.conversationUser.findFirst.mockResolvedValue(mockConvUser as any);
      prisma.message.findFirst.mockResolvedValue(mockLastMessage as any);
      prisma.conversationUser.update.mockResolvedValue({ ...mockConvUser, unreadCount: 0 } as any);

      await service.clearUnreadCount('user-1', 'conv-1');

      expect(prisma.conversationUser.update).toHaveBeenCalledWith({
        where: { id: 'cu-1' },
        data: { unreadCount: 0, lastReadMessageId: 'msg-last' },
      });
    });

    it('should handle conversation without messages', async () => {
      const mockConvUser = { id: 'cu-1', userId: 'user-1', conversationId: 'conv-1' };
      prisma.conversationUser.findFirst.mockResolvedValue(mockConvUser as any);
      prisma.message.findFirst.mockResolvedValue(null);
      prisma.conversationUser.update.mockResolvedValue({ ...mockConvUser, unreadCount: 0 } as any);

      await service.clearUnreadCount('user-1', 'conv-1');

      expect(prisma.conversationUser.update).toHaveBeenCalledWith({
        where: { id: 'cu-1' },
        data: { unreadCount: 0, lastReadMessageId: undefined },
      });
    });

    it('should throw NotFoundException when conversation not found', async () => {
      prisma.conversationUser.findFirst.mockResolvedValue(null);

      await expect(service.clearUnreadCount('user-1', 'conv-1')).rejects.toThrow(NotFoundException);
    });
  });
});
