import { Test, TestingModule } from "@nestjs/testing";
import { MessagesService } from "./messages.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";

function createMockPrisma() {
  const mock: any = {};
  const modelNames = [
    "message",
    "messageRead",
    "deletedMessage",
    "forwardedMessage",
    "conversation",
    "conversationUser",
    "offlineMessage",
    "user",
    "group",
    "groupMember",
    "groupAnnouncement",
  ];
  for (const name of modelNames) {
    mock[name] = {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    };
  }
  mock.$transaction = jest.fn((fn) => fn(mock));
  return mock as any;
}

describe("MessagesService", () => {
  let service: MessagesService;
  let prismaMock: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    prismaMock = createMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<MessagesService>(MessagesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("recallMessage", () => {
    it("should recall a message successfully", async () => {
      const message = {
        id: "msg1",
        senderId: "user1",
        isRecalled: false,
        createdAt: new Date(),
      };
      const recalledMessage = {
        ...message,
        isRecalled: true,
        recalledAt: new Date(),
      };

      prismaMock.message.findUnique.mockResolvedValue(message);
      prismaMock.message.update.mockResolvedValue(recalledMessage);

      const result = await service.recallMessage("user1", "msg1");

      expect(result.isRecalled).toBe(true);
      expect(prismaMock.message.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "msg1" },
          data: { isRecalled: true, recalledAt: expect.any(Date) },
        }),
      );
    });

    it("should throw NotFoundException if message not found", async () => {
      prismaMock.message.findUnique.mockResolvedValue(null);

      await expect(
        service.recallMessage("user1", "nonexistent"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException if user is not the sender", async () => {
      prismaMock.message.findUnique.mockResolvedValue({
        id: "msg1",
        senderId: "user2",
        isRecalled: false,
        createdAt: new Date(),
      });

      await expect(service.recallMessage("user1", "msg1")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("should throw BadRequestException if message already recalled", async () => {
      prismaMock.message.findUnique.mockResolvedValue({
        id: "msg1",
        senderId: "user1",
        isRecalled: true,
        createdAt: new Date(),
      });

      await expect(service.recallMessage("user1", "msg1")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw BadRequestException if recall after 2 minutes", async () => {
      const oldDate = new Date(Date.now() - 3 * 60 * 1000);
      prismaMock.message.findUnique.mockResolvedValue({
        id: "msg1",
        senderId: "user1",
        isRecalled: false,
        createdAt: oldDate,
      });

      await expect(service.recallMessage("user1", "msg1")).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe("deleteMessage", () => {
    it("should delete a message successfully", async () => {
      prismaMock.message.findUnique.mockResolvedValue({ id: "msg1" });
      prismaMock.deletedMessage.findUnique.mockResolvedValue(null);
      prismaMock.deletedMessage.create.mockResolvedValue({ id: "dm1" });

      const result = await service.deleteMessage("user1", "msg1");

      expect(result.message).toBe("Message deleted successfully");
      expect(prismaMock.deletedMessage.create).toHaveBeenCalledWith({
        data: { messageId: "msg1", userId: "user1" },
      });
    });

    it("should throw NotFoundException if message not found", async () => {
      prismaMock.message.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteMessage("user1", "nonexistent"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should return already deleted message if already deleted by user", async () => {
      prismaMock.message.findUnique.mockResolvedValue({ id: "msg1" });
      prismaMock.deletedMessage.findUnique.mockResolvedValue({ id: "dm1" });

      const result = await service.deleteMessage("user1", "msg1");

      expect(result.message).toBe("Message already deleted for you");
      expect(prismaMock.deletedMessage.create).not.toHaveBeenCalled();
    });
  });

  describe("forwardMessages", () => {
    it("should throw NotFoundException if some messages not found or recalled", async () => {
      prismaMock.message.findMany.mockResolvedValue([{ id: "msg1" }]);

      await expect(
        service.forwardMessages("user1", {
          messageIds: ["msg1", "msg2"],
          targetConversationIds: ["conv1"],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException if some conversations not found", async () => {
      prismaMock.message.findMany.mockResolvedValue([{ id: "msg1" }]);
      prismaMock.conversation.findMany.mockResolvedValue([]);

      await expect(
        service.forwardMessages("user1", {
          messageIds: ["msg1"],
          targetConversationIds: ["conv1"],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should forward messages to private conversation where user is a member", async () => {
      const message = {
        id: "msg1",
        type: "TEXT",
        content: "hello",
        thumbnailUrl: null,
      };
      const conversation = {
        id: "conv1",
        type: "private",
        group: null,
        users: [{ userId: "user1" }, { userId: "user2" }],
      };

      prismaMock.message.findMany.mockResolvedValue([message]);
      prismaMock.conversation.findMany.mockResolvedValue([conversation]);
      prismaMock.message.create.mockResolvedValue({
        id: "fwd1",
        senderId: "user1",
        type: "TEXT",
        content: "hello",
        sender: { id: "user1", nickname: "User1", avatar: null },
      });
      prismaMock.forwardedMessage.create.mockResolvedValue({ id: "fm1" });
      prismaMock.conversationUser.findFirst.mockResolvedValue({ id: "cu1" });
      prismaMock.conversationUser.update.mockResolvedValue({});

      const result = await service.forwardMessages("user1", {
        messageIds: ["msg1"],
        targetConversationIds: ["conv1"],
      });

      expect(result.forwarded).toBe(true);
      expect(result.count).toBe(1);
    });

    it("should skip conversations where user has no permission", async () => {
      const message = {
        id: "msg1",
        type: "TEXT",
        content: "hello",
        thumbnailUrl: null,
      };
      const conversation = {
        id: "conv1",
        type: "private",
        group: null,
        users: [{ userId: "user3" }],
      };

      prismaMock.message.findMany.mockResolvedValue([message]);
      prismaMock.conversation.findMany.mockResolvedValue([conversation]);

      const result = await service.forwardMessages("user1", {
        messageIds: ["msg1"],
        targetConversationIds: ["conv1"],
      });

      expect(result.count).toBe(0);
    });

    it("should forward messages to group conversation where user is a member", async () => {
      const message = {
        id: "msg1",
        type: "TEXT",
        content: "hello",
        thumbnailUrl: null,
      };
      const conversation = {
        id: "conv1",
        type: "group",
        group: { id: "grp1" },
        users: [{ userId: "user1" }, { userId: "user2" }],
      };

      prismaMock.message.findMany.mockResolvedValue([message]);
      prismaMock.conversation.findMany.mockResolvedValue([conversation]);
      prismaMock.message.create.mockResolvedValue({
        id: "fwd1",
        senderId: "user1",
        type: "TEXT",
        content: "hello",
        sender: { id: "user1", nickname: "User1", avatar: null },
      });
      prismaMock.forwardedMessage.create.mockResolvedValue({ id: "fm1" });
      prismaMock.conversationUser.findFirst.mockResolvedValue({ id: "cu1" });
      prismaMock.conversationUser.update.mockResolvedValue({});

      const result = await service.forwardMessages("user1", {
        messageIds: ["msg1"],
        targetConversationIds: ["conv1"],
      });

      expect(result.forwarded).toBe(true);
      expect(result.count).toBe(1);
    });

    it("should handle case where convUser not found when incrementing unread", async () => {
      const message = {
        id: "msg1",
        type: "TEXT",
        content: "hello",
        thumbnailUrl: null,
      };
      const conversation = {
        id: "conv1",
        type: "private",
        group: null,
        users: [{ userId: "user1" }, { userId: "user2" }],
      };

      prismaMock.message.findMany.mockResolvedValue([message]);
      prismaMock.conversation.findMany.mockResolvedValue([conversation]);
      prismaMock.message.create.mockResolvedValue({
        id: "fwd1",
        senderId: "user1",
        type: "TEXT",
        content: "hello",
        sender: { id: "user1", nickname: "User1", avatar: null },
      });
      prismaMock.forwardedMessage.create.mockResolvedValue({ id: "fm1" });
      prismaMock.conversationUser.findFirst.mockResolvedValue(null);

      const result = await service.forwardMessages("user1", {
        messageIds: ["msg1"],
        targetConversationIds: ["conv1"],
      });

      expect(result.forwarded).toBe(true);
      expect(prismaMock.conversationUser.update).not.toHaveBeenCalled();
    });

    it("should skip group conversation where user is not a member", async () => {
      const message = {
        id: "msg1",
        type: "TEXT",
        content: "hello",
        thumbnailUrl: null,
      };
      const conversation = {
        id: "conv1",
        type: "group",
        group: { id: "grp1" },
        users: [{ userId: "user3" }],
      };

      prismaMock.message.findMany.mockResolvedValue([message]);
      prismaMock.conversation.findMany.mockResolvedValue([conversation]);

      const result = await service.forwardMessages("user1", {
        messageIds: ["msg1"],
        targetConversationIds: ["conv1"],
      });

      expect(result.count).toBe(0);
    });
  });

  describe("getConversationMessages", () => {
    it("should throw ForbiddenException if user not in conversation", async () => {
      prismaMock.conversationUser.findFirst.mockResolvedValue(null);

      await expect(
        service.getConversationMessages("user1", "conv1"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should return messages with pagination (happy path)", async () => {
      prismaMock.conversationUser.findFirst.mockResolvedValue({ id: "cu1" });

      const messages = [
        {
          id: "msg1",
          createdAt: new Date("2024-01-01"),
          sender: {},
          reads: [],
        },
        {
          id: "msg2",
          createdAt: new Date("2024-01-02"),
          sender: {},
          reads: [],
        },
      ];
      prismaMock.message.findMany.mockResolvedValue(messages);
      prismaMock.message.count.mockResolvedValue(2);

      const result = await service.getConversationMessages(
        "user1",
        "conv1",
        1,
        50,
      );

      expect(result.messages).toHaveLength(2);
      expect(result.pagination.total).toBe(2);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.hasMore).toBe(false);
    });

    it("should filter messages before a given date", async () => {
      prismaMock.conversationUser.findFirst.mockResolvedValue({ id: "cu1" });
      const before = new Date("2024-06-01");
      prismaMock.message.findMany.mockResolvedValue([]);
      prismaMock.message.count.mockResolvedValue(0);

      const result = await service.getConversationMessages(
        "user1",
        "conv1",
        1,
        50,
        before,
      );

      expect(result.messages).toHaveLength(0);
      const findManyCall = prismaMock.message.findMany.mock.calls[0][0];
      expect(findManyCall.where.createdAt).toEqual({ lt: before });
    });

    it("should return hasMore=true when more messages exist", async () => {
      prismaMock.conversationUser.findFirst.mockResolvedValue({ id: "cu1" });
      prismaMock.message.findMany.mockResolvedValue([{}]);
      prismaMock.message.count.mockResolvedValue(10);

      const result = await service.getConversationMessages(
        "user1",
        "conv1",
        1,
        1,
      );

      expect(result.pagination.hasMore).toBe(true);
    });
  });

  describe("searchMessages", () => {
    it("should search messages by keyword with pagination", async () => {
      const messages = [{ id: "msg1", content: "hello world" }];
      prismaMock.message.findMany.mockResolvedValue(messages);
      prismaMock.message.count.mockResolvedValue(1);

      const result = await service.searchMessages("user1", "hello", 1, 20);

      expect(result.messages).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
    });
  });

  describe("markMessagesAsRead", () => {
    it("should mark unread messages as read", async () => {
      prismaMock.messageRead.findUnique.mockResolvedValueOnce(null);
      prismaMock.messageRead.create.mockResolvedValueOnce({
        id: "mr1",
        messageId: "msg1",
        userId: "user1",
        readAt: new Date(),
      });

      const result = await service.markMessagesAsRead("user1", ["msg1"]);

      expect(result.markedAsRead).toBe(1);
      expect(prismaMock.messageRead.create).toHaveBeenCalled();
    });

    it("should skip already-read messages", async () => {
      prismaMock.messageRead.findUnique.mockResolvedValue({
        id: "mr1",
        messageId: "msg1",
        userId: "user1",
        readAt: new Date(),
      });

      const result = await service.markMessagesAsRead("user1", ["msg1"]);

      expect(result.markedAsRead).toBe(0);
      expect(prismaMock.messageRead.create).not.toHaveBeenCalled();
    });
  });

  describe("getOfflineMessages", () => {
    it("should return empty array when no offline messages", async () => {
      prismaMock.offlineMessage.findMany.mockResolvedValue([]);

      const result = await service.getOfflineMessages("user1");

      expect(result.messages).toEqual([]);
      expect(result.count).toBe(0);
    });

    it("should return offline messages and mark them as delivered", async () => {
      const offlineMessages = [
        { id: "om1", messageId: "msg1", userId: "user1", isDelivered: false },
        { id: "om2", messageId: "msg2", userId: "user1", isDelivered: false },
      ];
      const messages = [
        { id: "msg1", content: "hello", sender: {}, reads: [] },
        { id: "msg2", content: "world", sender: {}, reads: [] },
      ];

      prismaMock.offlineMessage.findMany.mockResolvedValue(offlineMessages);
      prismaMock.message.findMany.mockResolvedValue(messages);
      prismaMock.offlineMessage.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.getOfflineMessages("user1");

      expect(result.messages).toHaveLength(2);
      expect(result.count).toBe(2);
      expect(prismaMock.offlineMessage.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { isDelivered: true, deliveredAt: expect.any(Date) },
        }),
      );
    });
  });
});
