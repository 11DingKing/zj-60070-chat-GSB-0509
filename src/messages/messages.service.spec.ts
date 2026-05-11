// @ts-nocheck
import { Test, TestingModule } from '@nestjs/testing';
import { MessagesService } from './messages.service';
import { PrismaService } from '../prisma/prisma.service';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { MessageType } from '@prisma/client';

describe('MessagesService', () => {
  let service: MessagesService;
  let prisma: DeepMockProxy<PrismaService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MessagesService, PrismaService],
    })
      .overrideProvider(PrismaService)
      .useValue(mockDeep<PrismaService>())
      .compile();

    service = module.get<MessagesService>(MessagesService);
    prisma = module.get(PrismaService);
  });

  const mockUser = {
    id: 'user-1',
    username: 'testuser',
    nickname: 'Test User',
    avatar: 'avatar.jpg',
  };

  const mockMessage = {
    id: 'msg-1',
    senderId: 'user-1',
    receiverId: 'user-2',
    groupId: null,
    conversationId: 'conv-1',
    type: MessageType.TEXT,
    content: 'Hello',
    thumbnailUrl: null,
    isRead: false,
    isRecalled: false,
    createdAt: new Date(),
    recalledAt: null,
    sender: mockUser,
  };

  describe('getConversationMessages', () => {
    const mockConvUser = {
      id: 'cu-1',
      userId: 'user-1',
      conversationId: 'conv-1',
      isDeleted: false,
    };

    it('should return conversation messages with pagination', async () => {
      prisma.conversationUser.findFirst.mockResolvedValue(mockConvUser as any);
      prisma.message.findMany.mockResolvedValue([{ ...mockMessage, reads: [] }] as any);
      prisma.message.count.mockResolvedValue(1);

      const result = await service.getConversationMessages('user-1', 'conv-1', 1, 50);

      expect(result.messages).toHaveLength(1);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(50);
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.hasMore).toBe(false);
      expect(prisma.conversationUser.findFirst).toHaveBeenCalledWith({
        where: { conversationId: 'conv-1', userId: 'user-1', isDeleted: false },
      });
    });

    it('should filter messages before date when before is provided', async () => {
      const beforeDate = new Date('2024-01-01');
      prisma.conversationUser.findFirst.mockResolvedValue(mockConvUser as any);
      prisma.message.findMany.mockResolvedValue([]);
      prisma.message.count.mockResolvedValue(0);

      await service.getConversationMessages('user-1', 'conv-1', 1, 50, beforeDate);

      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { lt: beforeDate },
          }),
        }),
      );
    });

    it('should throw ForbiddenException when user is not in conversation', async () => {
      prisma.conversationUser.findFirst.mockResolvedValue(null);

      await expect(service.getConversationMessages('user-1', 'conv-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('markMessagesAsRead', () => {
    it('should mark messages as read and return count', async () => {
      prisma.messageRead.findUnique.mockResolvedValue(null);
      prisma.messageRead.create.mockResolvedValue({ id: 'read-1' } as any);

      const result = await service.markMessagesAsRead('user-1', ['msg-1', 'msg-2']);

      expect(result.markedAsRead).toBe(2);
      expect(prisma.messageRead.create).toHaveBeenCalledTimes(2);
    });

    it('should skip already read messages', async () => {
      prisma.messageRead.findUnique
        .mockResolvedValueOnce({ id: 'read-1' } as any)
        .mockResolvedValueOnce(null);
      prisma.messageRead.create.mockResolvedValue({ id: 'read-2' } as any);

      const result = await service.markMessagesAsRead('user-1', ['msg-1', 'msg-2']);

      expect(result.markedAsRead).toBe(1);
      expect(prisma.messageRead.create).toHaveBeenCalledTimes(1);
    });

    it('should handle empty message ids array', async () => {
      const result = await service.markMessagesAsRead('user-1', []);

      expect(result.markedAsRead).toBe(0);
      expect(prisma.messageRead.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('recallMessage', () => {
    it('should recall message within 2 minutes', async () => {
      const recentMessage = {
        ...mockMessage,
        createdAt: new Date(Date.now() - 60000),
      };
      prisma.message.findUnique.mockResolvedValue(recentMessage as any);
      prisma.message.update.mockResolvedValue({ ...recentMessage, isRecalled: true } as any);

      const result = await service.recallMessage('user-1', 'msg-1');

      expect(result.isRecalled).toBe(true);
      expect(prisma.message.update).toHaveBeenCalled();
    });

    it('should throw NotFoundException when message not found', async () => {
      prisma.message.findUnique.mockResolvedValue(null);

      await expect(service.recallMessage('user-1', 'msg-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when not the sender', async () => {
      prisma.message.findUnique.mockResolvedValue(mockMessage as any);

      await expect(service.recallMessage('user-2', 'msg-1')).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when message already recalled', async () => {
      prisma.message.findUnique.mockResolvedValue({ ...mockMessage, isRecalled: true } as any);

      await expect(service.recallMessage('user-1', 'msg-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when message is older than 2 minutes', async () => {
      const oldMessage = {
        ...mockMessage,
        createdAt: new Date(Date.now() - 180000),
      };
      prisma.message.findUnique.mockResolvedValue(oldMessage as any);

      await expect(service.recallMessage('user-1', 'msg-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('deleteMessage', () => {
    it('should delete message for user', async () => {
      prisma.message.findUnique.mockResolvedValue(mockMessage as any);
      prisma.deletedMessage.findUnique.mockResolvedValue(null);
      prisma.deletedMessage.create.mockResolvedValue({ id: 'del-1' } as any);

      const result = await service.deleteMessage('user-1', 'msg-1');

      expect(result.message).toBe('Message deleted successfully');
      expect(prisma.deletedMessage.create).toHaveBeenCalled();
    });

    it('should return already deleted message when already deleted', async () => {
      prisma.message.findUnique.mockResolvedValue(mockMessage as any);
      prisma.deletedMessage.findUnique.mockResolvedValue({ id: 'del-1' } as any);

      const result = await service.deleteMessage('user-1', 'msg-1');

      expect(result.message).toBe('Message already deleted for you');
      expect(prisma.deletedMessage.create).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when message not found', async () => {
      prisma.message.findUnique.mockResolvedValue(null);

      await expect(service.deleteMessage('user-1', 'msg-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getOfflineMessages', () => {
    it('should return empty array when no offline messages', async () => {
      prisma.offlineMessage.findMany.mockResolvedValue([]);

      const result = await service.getOfflineMessages('user-1');

      expect(result.messages).toHaveLength(0);
      expect(result.count).toBe(0);
    });

    it('should return offline messages and mark as delivered', async () => {
      const mockOfflineMessages = [
        { id: 'om-1', messageId: 'msg-1', userId: 'user-1', isDelivered: false },
      ];
      prisma.offlineMessage.findMany.mockResolvedValue(mockOfflineMessages as any);
      prisma.message.findMany.mockResolvedValue([{ ...mockMessage, reads: [] }] as any);
      prisma.offlineMessage.updateMany.mockResolvedValue({ count: 1 } as any);

      const result = await service.getOfflineMessages('user-1');

      expect(result.messages).toHaveLength(1);
      expect(result.count).toBe(1);
      expect(prisma.offlineMessage.updateMany).toHaveBeenCalled();
    });
  });

  describe('searchMessages', () => {
    it('should search messages with keyword', async () => {
      prisma.message.findMany.mockResolvedValue([{ ...mockMessage, conversation: { id: 'conv-1', type: 'private', group: null } }] as any);
      prisma.message.count.mockResolvedValue(1);

      const result = await service.searchMessages('user-1', 'hello', 1, 20);

      expect(result.messages).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
    });

    it('should handle empty search results', async () => {
      prisma.message.findMany.mockResolvedValue([]);
      prisma.message.count.mockResolvedValue(0);

      const result = await service.searchMessages('user-1', 'nonexistent');

      expect(result.messages).toHaveLength(0);
      expect(result.pagination.hasMore).toBe(false);
    });
  });

  describe('forwardMessages', () => {
    const forwardDto = {
      messageIds: ['msg-1'],
      targetConversationIds: ['conv-1'],
    };

    it('should forward messages to private conversation', async () => {
      const mockMessages = [{ ...mockMessage }];
      const mockConversations = [
        {
          id: 'conv-1',
          type: 'private',
          group: null,
          users: [{ userId: 'user-1' }, { userId: 'user-2' }],
        },
      ];

      prisma.message.findMany.mockResolvedValue(mockMessages as any);
      prisma.conversation.findMany.mockResolvedValue(mockConversations as any);
      prisma.message.create.mockResolvedValue({ id: 'msg-new', sender: mockUser } as any);
      prisma.forwardedMessage.create.mockResolvedValue({} as any);
      prisma.conversationUser.findFirst.mockResolvedValue({ id: 'cu-1' } as any);
      prisma.conversationUser.update.mockResolvedValue({} as any);

      const result = await service.forwardMessages('user-1', forwardDto);

      expect(result.forwarded).toBe(true);
      expect(result.count).toBe(1);
      expect(prisma.message.create).toHaveBeenCalled();
      expect(prisma.forwardedMessage.create).toHaveBeenCalled();
    });

    it('should forward messages to group conversation', async () => {
      const mockMessages = [{ ...mockMessage }];
      const mockConversations = [
        {
          id: 'conv-1',
          type: 'group',
          group: { id: 'group-1' },
          users: [{ userId: 'user-1' }, { userId: 'user-2' }, { userId: 'user-3' }],
        },
      ];

      prisma.message.findMany.mockResolvedValue(mockMessages as any);
      prisma.conversation.findMany.mockResolvedValue(mockConversations as any);
      prisma.message.create.mockResolvedValue({ id: 'msg-new', sender: mockUser } as any);
      prisma.forwardedMessage.create.mockResolvedValue({} as any);
      prisma.conversationUser.findFirst.mockResolvedValue({ id: 'cu-1' } as any);
      prisma.conversationUser.update.mockResolvedValue({} as any);

      const result = await service.forwardMessages('user-1', forwardDto);

      expect(result.forwarded).toBe(true);
      expect(result.count).toBe(1);
    });

    it('should skip conversations where user has no permission', async () => {
      const mockMessages = [{ ...mockMessage }];
      const mockConversations = [
        {
          id: 'conv-1',
          type: 'private',
          group: null,
          users: [{ userId: 'user-3' }, { userId: 'user-2' }],
        },
      ];

      prisma.message.findMany.mockResolvedValue(mockMessages as any);
      prisma.conversation.findMany.mockResolvedValue(mockConversations as any);

      const result = await service.forwardMessages('user-1', forwardDto);

      expect(result.count).toBe(0);
      expect(prisma.message.create).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when some messages not found', async () => {
      prisma.message.findMany.mockResolvedValue([]);

      await expect(service.forwardMessages('user-1', forwardDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when some conversations not found', async () => {
      prisma.message.findMany.mockResolvedValue([mockMessage] as any);
      prisma.conversation.findMany.mockResolvedValue([]);

      await expect(service.forwardMessages('user-1', forwardDto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
