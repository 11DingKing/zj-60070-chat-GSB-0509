// @ts-nocheck
import { Test, TestingModule } from '@nestjs/testing';
import { MessagesService } from './messages.service';
import { PrismaService } from '../prisma/prisma.service';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';

describe('MessagesService', () => {
  let service: MessagesService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MessagesService, PrismaService],
    })
      .overrideProvider(PrismaService)
      .useValue(mockDeep<PrismaClient>())
      .compile();

    service = module.get<MessagesService>(MessagesService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getConversationMessages', () => {
    const userId = 'user-1';
    const conversationId = 'conv-1';
    const mockConvUser = {
      id: 'cu-1',
      conversationId,
      userId,
      isDeleted: false,
    };

    it('should return conversation messages with pagination', async () => {
      const mockMessages = [
        {
          id: 'msg-2',
          senderId: userId,
          conversationId,
          content: 'Hi there',
          type: 'TEXT',
          createdAt: new Date('2024-01-01T10:01:00Z'),
          sender: { id: userId, nickname: 'User1' },
          reads: [],
        },
        {
          id: 'msg-1',
          senderId: 'user-2',
          conversationId,
          content: 'Hello',
          type: 'TEXT',
          createdAt: new Date('2024-01-01T10:00:00Z'),
          sender: { id: 'user-2', nickname: 'User2' },
          reads: [],
        },
      ];

      prisma.conversationUser.findFirst.mockResolvedValue(mockConvUser as any);
      prisma.message.findMany.mockResolvedValue(mockMessages as any);
      prisma.message.count.mockResolvedValue(2);

      const result = await service.getConversationMessages(userId, conversationId, 1, 50);

      expect(prisma.conversationUser.findFirst).toHaveBeenCalledWith({
        where: { conversationId, userId, isDeleted: false },
      });
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].id).toBe('msg-1');
      expect(result.messages[1].id).toBe('msg-2');
      expect(result.pagination.total).toBe(2);
      expect(result.pagination.hasMore).toBe(false);
    });

    it('should filter messages before the given date', async () => {
      const before = new Date('2024-01-01T10:00:30Z');
      const mockMessages = [
        {
          id: 'msg-1',
          senderId: 'user-2',
          conversationId,
          content: 'Hello',
          type: 'TEXT',
          createdAt: new Date('2024-01-01T10:00:00Z'),
          sender: { id: 'user-2', nickname: 'User2' },
          reads: [],
        },
      ];

      prisma.conversationUser.findFirst.mockResolvedValue(mockConvUser as any);
      prisma.message.findMany.mockResolvedValue(mockMessages as any);
      prisma.message.count.mockResolvedValue(1);

      await service.getConversationMessages(userId, conversationId, 1, 50, before);

      expect(prisma.message.findMany).toHaveBeenCalled();
      const callArgs = prisma.message.findMany.mock.calls[0][0];
      expect(callArgs.where.createdAt).toEqual({ lt: before });
    });

    it('should return hasMore true when there are more messages', async () => {
      const mockMessages = Array.from({ length: 10 }, (_, i) => ({
        id: `msg-${i + 1}`,
        senderId: 'user-2',
        conversationId,
        content: `Message ${i + 1}`,
        type: 'TEXT',
        createdAt: new Date(`2024-01-01T10:0${i}:00Z`),
        sender: { id: 'user-2', nickname: 'User2' },
        reads: [],
      }));

      prisma.conversationUser.findFirst.mockResolvedValue(mockConvUser as any);
      prisma.message.findMany.mockResolvedValue(mockMessages.slice(0, 5) as any);
      prisma.message.count.mockResolvedValue(10);

      const result = await service.getConversationMessages(userId, conversationId, 1, 5);

      expect(result.pagination.hasMore).toBe(true);
      expect(result.pagination.total).toBe(10);
    });

    it('should throw ForbiddenException when user is not authorized', async () => {
      prisma.conversationUser.findFirst.mockResolvedValue(null);

      await expect(
        service.getConversationMessages(userId, conversationId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('markMessagesAsRead', () => {
    const userId = 'user-1';
    const messageIds = ['msg-1', 'msg-2', 'msg-3'];

    it('should mark messages as read and return count', async () => {
      prisma.messageRead.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'read-1' } as any)
        .mockResolvedValueOnce(null);

      prisma.messageRead.create.mockResolvedValue({ id: 'new-read-1' } as any);

      const result = await service.markMessagesAsRead(userId, messageIds);

      expect(prisma.messageRead.create).toHaveBeenCalledTimes(2);
      expect(result.markedAsRead).toBe(2);
    });

    it('should not create duplicate read records', async () => {
      prisma.messageRead.findUnique.mockResolvedValue({ id: 'read-1' } as any);

      const result = await service.markMessagesAsRead(userId, ['msg-1']);

      expect(prisma.messageRead.create).not.toHaveBeenCalled();
      expect(result.markedAsRead).toBe(0);
    });

    it('should return timestamp', async () => {
      prisma.messageRead.findUnique.mockResolvedValue(null);
      prisma.messageRead.create.mockResolvedValue({ id: 'read-1' } as any);

      const before = new Date();
      const result = await service.markMessagesAsRead(userId, ['msg-1']);
      const after = new Date();

      expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('recallMessage', () => {
    const userId = 'user-1';
    const messageId = 'msg-1';

    it('should recall message within 2 minutes', async () => {
      const mockMessage = {
        id: messageId,
        senderId: userId,
        content: 'Hello',
        createdAt: new Date(Date.now() - 60000),
        isRecalled: false,
        sender: { id: userId, nickname: 'User1' },
      };

      prisma.message.findUnique.mockResolvedValue(mockMessage as any);
      prisma.message.update.mockResolvedValue({
        ...mockMessage,
        isRecalled: true,
        recalledAt: new Date(),
      } as any);

      const result = await service.recallMessage(userId, messageId);

      expect(prisma.message.update).toHaveBeenCalled();
      expect(result.isRecalled).toBe(true);
    });

    it('should throw NotFoundException when message not found', async () => {
      prisma.message.findUnique.mockResolvedValue(null);

      await expect(service.recallMessage(userId, messageId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when not the sender', async () => {
      const mockMessage = {
        id: messageId,
        senderId: 'user-2',
        content: 'Hello',
        createdAt: new Date(Date.now() - 60000),
        isRecalled: false,
      };

      prisma.message.findUnique.mockResolvedValue(mockMessage as any);

      await expect(service.recallMessage(userId, messageId)).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when already recalled', async () => {
      const mockMessage = {
        id: messageId,
        senderId: userId,
        content: 'Hello',
        createdAt: new Date(Date.now() - 60000),
        isRecalled: true,
      };

      prisma.message.findUnique.mockResolvedValue(mockMessage as any);

      await expect(service.recallMessage(userId, messageId)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when after 2 minutes', async () => {
      const mockMessage = {
        id: messageId,
        senderId: userId,
        content: 'Hello',
        createdAt: new Date(Date.now() - 180000),
        isRecalled: false,
      };

      prisma.message.findUnique.mockResolvedValue(mockMessage as any);

      await expect(service.recallMessage(userId, messageId)).rejects.toThrow(BadRequestException);
    });
  });

  describe('deleteMessage', () => {
    const userId = 'user-1';
    const messageId = 'msg-1';

    it('should delete message for user', async () => {
      prisma.message.findUnique.mockResolvedValue({ id: messageId } as any);
      prisma.deletedMessage.findUnique.mockResolvedValue(null);
      prisma.deletedMessage.create.mockResolvedValue({ id: 'deleted-1' } as any);

      const result = await service.deleteMessage(userId, messageId);

      expect(prisma.deletedMessage.create).toHaveBeenCalled();
      expect(result.message).toBe('Message deleted successfully');
    });

    it('should throw NotFoundException when message not found', async () => {
      prisma.message.findUnique.mockResolvedValue(null);

      await expect(service.deleteMessage(userId, messageId)).rejects.toThrow(NotFoundException);
    });

    it('should return already deleted message', async () => {
      prisma.message.findUnique.mockResolvedValue({ id: messageId } as any);
      prisma.deletedMessage.findUnique.mockResolvedValue({ id: 'deleted-1' } as any);

      const result = await service.deleteMessage(userId, messageId);

      expect(prisma.deletedMessage.create).not.toHaveBeenCalled();
      expect(result.message).toBe('Message already deleted for you');
    });
  });

  describe('getOfflineMessages', () => {
    const userId = 'user-1';

    it('should return empty when no offline messages', async () => {
      prisma.offlineMessage.findMany.mockResolvedValue([]);

      const result = await service.getOfflineMessages(userId);

      expect(result.messages).toEqual([]);
      expect(result.count).toBe(0);
    });

    it('should return offline messages and mark as delivered', async () => {
      const offlineMessages = [
        { id: 'om-1', messageId: 'msg-1', userId, isDelivered: false },
        { id: 'om-2', messageId: 'msg-2', userId, isDelivered: false },
      ];
      const messages = [
        {
          id: 'msg-1',
          senderId: 'user-2',
          content: 'Hello',
          isRecalled: false,
          sender: { id: 'user-2', nickname: 'User2' },
          reads: [],
        },
        {
          id: 'msg-2',
          senderId: 'user-2',
          content: 'World',
          isRecalled: false,
          sender: { id: 'user-2', nickname: 'User2' },
          reads: [],
        },
      ];

      prisma.offlineMessage.findMany.mockResolvedValue(offlineMessages as any);
      prisma.message.findMany.mockResolvedValue(messages as any);
      prisma.offlineMessage.updateMany.mockResolvedValue({ count: 2 } as any);

      const result = await service.getOfflineMessages(userId);

      expect(result.messages).toHaveLength(2);
      expect(result.count).toBe(2);
      expect(prisma.offlineMessage.updateMany).toHaveBeenCalled();
    });

    it('should filter out recalled messages', async () => {
      const offlineMessages = [{ id: 'om-1', messageId: 'msg-1', userId, isDelivered: false }];
      const messages = [];

      prisma.offlineMessage.findMany.mockResolvedValue(offlineMessages as any);
      prisma.message.findMany.mockResolvedValue(messages as any);
      prisma.offlineMessage.updateMany.mockResolvedValue({ count: 1 } as any);

      const result = await service.getOfflineMessages(userId);

      expect(result.messages).toHaveLength(0);
      expect(result.count).toBe(0);
    });
  });

  describe('searchMessages', () => {
    const userId = 'user-1';
    const keyword = 'hello';

    it('should search messages with keyword', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          senderId: userId,
          content: 'Hello world',
          sender: { id: userId, nickname: 'User1' },
          conversation: { id: 'conv-1', type: 'private' },
        },
        {
          id: 'msg-2',
          receiverId: userId,
          content: 'Say hello',
          sender: { id: 'user-2', nickname: 'User2' },
          conversation: { id: 'conv-2', type: 'private' },
        },
      ];

      prisma.message.findMany.mockResolvedValue(mockMessages as any);
      prisma.message.count.mockResolvedValue(2);

      const result = await service.searchMessages(userId, keyword);

      expect(result.messages).toHaveLength(2);
      expect(result.pagination.total).toBe(2);
    });

    it('should return empty when no matches', async () => {
      prisma.message.findMany.mockResolvedValue([]);
      prisma.message.count.mockResolvedValue(0);

      const result = await service.searchMessages(userId, 'nonexistent');

      expect(result.messages).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
    });

    it('should handle pagination correctly', async () => {
      const mockMessages = Array.from({ length: 5 }, (_, i) => ({
        id: `msg-${i + 1}`,
        content: `hello ${i + 1}`,
        sender: { id: 'user-2', nickname: 'User2' },
        conversation: { id: 'conv-1', type: 'private' },
      }));

      prisma.message.findMany.mockResolvedValue(mockMessages.slice(0, 3) as any);
      prisma.message.count.mockResolvedValue(5);

      const result = await service.searchMessages(userId, keyword, 1, 3);

      expect(result.pagination.hasMore).toBe(true);
      expect(result.pagination.total).toBe(5);
    });
  });

  describe('forwardMessages', () => {
    const userId = 'user-1';

    it('should forward messages to conversations', async () => {
      const dto = {
        messageIds: ['msg-1'],
        targetConversationIds: ['conv-1'],
      };
      const messages = [
        {
          id: 'msg-1',
          senderId: 'user-2',
          content: 'Hello',
          type: 'TEXT',
          isRecalled: false,
        },
      ];
      const conversations = [
        {
          id: 'conv-1',
          type: 'private',
          users: [{ userId }, { userId: 'user-2' }],
          group: null,
        },
      ];
      const newMessage = {
        id: 'new-msg-1',
        senderId: userId,
        content: 'Hello',
        sender: { id: userId, nickname: 'User1' },
      };

      prisma.message.findMany.mockResolvedValue(messages as any);
      prisma.conversation.findMany.mockResolvedValue(conversations as any);
      prisma.message.create.mockResolvedValue(newMessage as any);
      prisma.forwardedMessage.create.mockResolvedValue({ id: 'fw-1' } as any);
      prisma.conversationUser.findFirst.mockResolvedValue({ id: 'cu-1' } as any);
      prisma.conversationUser.update.mockResolvedValue({ id: 'cu-1' } as any);

      const result = await service.forwardMessages(userId, dto);

      expect(result.forwarded).toBe(true);
      expect(result.count).toBe(1);
      expect(prisma.message.create).toHaveBeenCalled();
    });

    it('should throw NotFoundException when some messages not found', async () => {
      const dto = {
        messageIds: ['msg-1', 'msg-2'],
        targetConversationIds: ['conv-1'],
      };

      prisma.message.findMany.mockResolvedValue([{ id: 'msg-1' }] as any);

      await expect(service.forwardMessages(userId, dto)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when some conversations not found', async () => {
      const dto = {
        messageIds: ['msg-1'],
        targetConversationIds: ['conv-1', 'conv-2'],
      };

      prisma.message.findMany.mockResolvedValue([{ id: 'msg-1' }] as any);
      prisma.conversation.findMany.mockResolvedValue([{ id: 'conv-1' }] as any);

      await expect(service.forwardMessages(userId, dto)).rejects.toThrow(NotFoundException);
    });

    it('should skip conversations where user has no permission', async () => {
      const dto = {
        messageIds: ['msg-1'],
        targetConversationIds: ['conv-1', 'conv-2'],
      };
      const messages = [{ id: 'msg-1', content: 'Hello', type: 'TEXT', isRecalled: false }];
      const conversations = [
        {
          id: 'conv-1',
          type: 'private',
          users: [{ userId }, { userId: 'user-2' }],
          group: null,
        },
        {
          id: 'conv-2',
          type: 'private',
          users: [{ userId: 'user-3' }, { userId: 'user-4' }],
          group: null,
        },
      ];
      const newMessage = {
        id: 'new-msg-1',
        sender: { id: userId, nickname: 'User1' },
      };

      prisma.message.findMany.mockResolvedValue(messages as any);
      prisma.conversation.findMany.mockResolvedValue(conversations as any);
      prisma.message.create.mockResolvedValue(newMessage as any);
      prisma.forwardedMessage.create.mockResolvedValue({ id: 'fw-1' } as any);
      prisma.conversationUser.findFirst.mockResolvedValue({ id: 'cu-1' } as any);
      prisma.conversationUser.update.mockResolvedValue({ id: 'cu-1' } as any);

      const result = await service.forwardMessages(userId, dto);

      expect(result.count).toBe(1);
    });

    it('should forward to group conversations', async () => {
      const dto = {
        messageIds: ['msg-1'],
        targetConversationIds: ['conv-1'],
      };
      const messages = [{ id: 'msg-1', content: 'Hello', type: 'TEXT', isRecalled: false }];
      const conversations = [
        {
          id: 'conv-1',
          type: 'group',
          users: [{ userId }, { userId: 'user-2' }],
          group: { id: 'group-1' },
        },
      ];
      const newMessage = {
        id: 'new-msg-1',
        sender: { id: userId, nickname: 'User1' },
      };

      prisma.message.findMany.mockResolvedValue(messages as any);
      prisma.conversation.findMany.mockResolvedValue(conversations as any);
      prisma.message.create.mockResolvedValue(newMessage as any);
      prisma.forwardedMessage.create.mockResolvedValue({ id: 'fw-1' } as any);
      prisma.conversationUser.findFirst.mockResolvedValue({ id: 'cu-1' } as any);
      prisma.conversationUser.update.mockResolvedValue({ id: 'cu-1' } as any);

      const result = await service.forwardMessages(userId, dto);

      expect(result.count).toBe(1);
    });
  });
});
