import { Test, TestingModule } from "@nestjs/testing";
import { ConversationsService } from "./conversations.service";
import { PrismaService } from "../prisma/prisma.service";
import { NotFoundException, ForbiddenException } from "@nestjs/common";

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

describe("ConversationsService", () => {
  let service: ConversationsService;
  let prismaMock: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    prismaMock = createMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<ConversationsService>(ConversationsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getConversations", () => {
    it("should return conversations sorted by pin status and lastMessageTime", async () => {
      const convUsers = [
        {
          userId: "user1",
          isPinned: true,
          unreadCount: 0,
          isMuted: false,
          lastReadMessageId: null,
          joinedAt: new Date(),
          conversation: {
            id: "conv1",
            type: "private",
            groupId: null,
            group: null,
            lastMessageTime: new Date("2024-01-02"),
            users: [
              {
                user: {
                  id: "user2",
                  username: "bob",
                  nickname: "Bob",
                  avatar: null,
                  isOnline: true,
                  lastOnlineAt: null,
                },
              },
              {
                user: {
                  id: "user1",
                  username: "alice",
                  nickname: "Alice",
                  avatar: null,
                  isOnline: true,
                  lastOnlineAt: null,
                },
              },
            ],
            messages: [
              {
                id: "msg1",
                content: "hi",
                type: "TEXT",
                senderId: "user2",
                sender: { id: "user2", nickname: "Bob" },
                createdAt: new Date(),
                isRecalled: false,
              },
            ],
          },
        },
      ];

      prismaMock.conversationUser.findMany.mockResolvedValue(convUsers);

      const result = await service.getConversations("user1");

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("conv1");
      expect(result[0].displayName).toBe("Bob");
      expect(result[0].targetUser.id).toBe("user2");
      expect(result[0].isPinned).toBe(true);
    });

    it("should return group conversations with group name as displayName", async () => {
      const convUsers = [
        {
          userId: "user1",
          isPinned: false,
          unreadCount: 3,
          isMuted: false,
          lastReadMessageId: null,
          joinedAt: new Date(),
          conversation: {
            id: "conv2",
            type: "group",
            groupId: "grp1",
            group: {
              id: "grp1",
              name: "MyGroup",
              avatar: "avatar.png",
              ownerId: "user1",
              isDissolved: false,
            },
            lastMessageTime: new Date("2024-01-03"),
            users: [],
            messages: [],
          },
        },
      ];

      prismaMock.conversationUser.findMany.mockResolvedValue(convUsers);

      const result = await service.getConversations("user1");

      expect(result[0].displayName).toBe("MyGroup");
      expect(result[0].displayAvatar).toBe("avatar.png");
      expect(result[0].groupId).toBe("grp1");
    });

    it("should return null lastMessage when no messages exist", async () => {
      const convUsers = [
        {
          userId: "user1",
          isPinned: false,
          unreadCount: 0,
          isMuted: false,
          lastReadMessageId: null,
          joinedAt: new Date(),
          conversation: {
            id: "conv3",
            type: "private",
            groupId: null,
            group: null,
            lastMessageTime: null,
            users: [
              {
                user: {
                  id: "user2",
                  username: "bob",
                  nickname: null,
                  avatar: null,
                  isOnline: false,
                  lastOnlineAt: null,
                },
              },
              {
                user: {
                  id: "user1",
                  username: "alice",
                  nickname: "Alice",
                  avatar: null,
                  isOnline: true,
                  lastOnlineAt: null,
                },
              },
            ],
            messages: [],
          },
        },
      ];

      prismaMock.conversationUser.findMany.mockResolvedValue(convUsers);

      const result = await service.getConversations("user1");

      expect(result[0].lastMessage).toBeNull();
      expect(result[0].displayName).toBe("bob");
    });
  });

  describe("pinConversation", () => {
    it("should pin a conversation successfully", async () => {
      const convUser = {
        id: "cu1",
        conversationId: "conv1",
        userId: "user1",
        isPinned: false,
      };
      prismaMock.conversationUser.findFirst.mockResolvedValue(convUser);
      prismaMock.conversationUser.update.mockResolvedValue({
        ...convUser,
        isPinned: true,
      });

      await service.pinConversation("user1", "conv1");

      expect(prismaMock.conversationUser.update).toHaveBeenCalledWith({
        where: { id: "cu1" },
        data: { isPinned: true },
      });
    });

    it("should throw NotFoundException if conversation not found", async () => {
      prismaMock.conversationUser.findFirst.mockResolvedValue(null);

      await expect(service.pinConversation("user1", "conv1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("unpinConversation", () => {
    it("should unpin a conversation successfully", async () => {
      const convUser = {
        id: "cu1",
        conversationId: "conv1",
        userId: "user1",
        isPinned: true,
      };
      prismaMock.conversationUser.findFirst.mockResolvedValue(convUser);
      prismaMock.conversationUser.update.mockResolvedValue({
        ...convUser,
        isPinned: false,
      });

      await service.unpinConversation("user1", "conv1");

      expect(prismaMock.conversationUser.update).toHaveBeenCalledWith({
        where: { id: "cu1" },
        data: { isPinned: false },
      });
    });

    it("should throw NotFoundException if conversation not found", async () => {
      prismaMock.conversationUser.findFirst.mockResolvedValue(null);

      await expect(service.unpinConversation("user1", "conv1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("muteConversation", () => {
    it("should mute a conversation successfully", async () => {
      const convUser = { id: "cu1", isMuted: false };
      prismaMock.conversationUser.findFirst.mockResolvedValue(convUser);
      prismaMock.conversationUser.update.mockResolvedValue({
        ...convUser,
        isMuted: true,
      });

      await service.muteConversation("user1", "conv1");

      expect(prismaMock.conversationUser.update).toHaveBeenCalledWith({
        where: { id: "cu1" },
        data: { isMuted: true },
      });
    });

    it("should throw NotFoundException if conversation not found", async () => {
      prismaMock.conversationUser.findFirst.mockResolvedValue(null);

      await expect(service.muteConversation("user1", "conv1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("unmuteConversation", () => {
    it("should unmute a conversation successfully", async () => {
      const convUser = { id: "cu1", isMuted: true };
      prismaMock.conversationUser.findFirst.mockResolvedValue(convUser);
      prismaMock.conversationUser.update.mockResolvedValue({
        ...convUser,
        isMuted: false,
      });

      await service.unmuteConversation("user1", "conv1");

      expect(prismaMock.conversationUser.update).toHaveBeenCalledWith({
        where: { id: "cu1" },
        data: { isMuted: false },
      });
    });

    it("should throw NotFoundException if conversation not found", async () => {
      prismaMock.conversationUser.findFirst.mockResolvedValue(null);

      await expect(
        service.unmuteConversation("user1", "conv1"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("deleteConversation", () => {
    it("should delete a conversation (soft delete) successfully", async () => {
      const convUser = { id: "cu1", isDeleted: false };
      prismaMock.conversationUser.findFirst.mockResolvedValue(convUser);
      prismaMock.conversationUser.update.mockResolvedValue({});

      await service.deleteConversation("user1", "conv1");

      expect(prismaMock.conversationUser.update).toHaveBeenCalledWith({
        where: { id: "cu1" },
        data: { isDeleted: true, deletedAt: expect.any(Date), unreadCount: 0 },
      });
    });

    it("should throw NotFoundException if conversation not found", async () => {
      prismaMock.conversationUser.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteConversation("user1", "conv1"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("clearUnreadCount", () => {
    it("should clear unread count and update lastReadMessageId", async () => {
      const convUser = { id: "cu1", unreadCount: 5 };
      const lastMessage = { id: "msg10" };
      prismaMock.conversationUser.findFirst.mockResolvedValue(convUser);
      prismaMock.message.findFirst.mockResolvedValue(lastMessage);
      prismaMock.conversationUser.update.mockResolvedValue({});

      await service.clearUnreadCount("user1", "conv1");

      expect(prismaMock.conversationUser.update).toHaveBeenCalledWith({
        where: { id: "cu1" },
        data: { unreadCount: 0, lastReadMessageId: "msg10" },
      });
    });

    it("should throw NotFoundException if conversation not found", async () => {
      prismaMock.conversationUser.findFirst.mockResolvedValue(null);

      await expect(service.clearUnreadCount("user1", "conv1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should handle no last message (null)", async () => {
      const convUser = { id: "cu1", unreadCount: 3 };
      prismaMock.conversationUser.findFirst.mockResolvedValue(convUser);
      prismaMock.message.findFirst.mockResolvedValue(null);
      prismaMock.conversationUser.update.mockResolvedValue({});

      await service.clearUnreadCount("user1", "conv1");

      expect(prismaMock.conversationUser.update).toHaveBeenCalledWith({
        where: { id: "cu1" },
        data: { unreadCount: 0, lastReadMessageId: undefined },
      });
    });
  });

  describe("getOrCreatePrivateConversation", () => {
    it("should throw ForbiddenException when creating conversation with self", async () => {
      await expect(
        service.getOrCreatePrivateConversation("user1", "user1"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should create a new conversation if none exists", async () => {
      prismaMock.conversation.findFirst.mockResolvedValue(null);
      const newConversation = {
        id: "conv1",
        type: "private",
        users: [
          {
            id: "cu1",
            userId: "user1",
            isPinned: false,
            isMuted: false,
            unreadCount: 0,
            joinedAt: new Date(),
            isDeleted: false,
            user: {
              id: "user1",
              username: "alice",
              nickname: "Alice",
              avatar: null,
              isOnline: true,
            },
          },
          {
            id: "cu2",
            userId: "user2",
            isPinned: false,
            isMuted: false,
            unreadCount: 0,
            joinedAt: new Date(),
            isDeleted: false,
            user: {
              id: "user2",
              username: "bob",
              nickname: "Bob",
              avatar: "av.png",
              isOnline: false,
            },
          },
        ],
      };
      prismaMock.conversation.create.mockResolvedValue(newConversation);

      const result = await service.getOrCreatePrivateConversation(
        "user1",
        "user2",
      );

      expect(result.id).toBe("conv1");
      expect(result.targetUser.id).toBe("user2");
      expect(result.displayName).toBe("Bob");
      expect(prismaMock.conversation.create).toHaveBeenCalled();
    });

    it("should return existing conversation (dedup) without creating a new one", async () => {
      const existingConversation = {
        id: "conv-exist",
        type: "private",
        users: [
          {
            id: "cu1",
            userId: "user1",
            isPinned: true,
            isMuted: false,
            unreadCount: 2,
            joinedAt: new Date(),
            isDeleted: false,
            user: {
              id: "user1",
              username: "alice",
              nickname: "Alice",
              avatar: null,
              isOnline: true,
            },
          },
          {
            id: "cu2",
            userId: "user2",
            isPinned: false,
            isMuted: false,
            unreadCount: 0,
            joinedAt: new Date(),
            isDeleted: false,
            user: {
              id: "user2",
              username: "bob",
              nickname: "Bob",
              avatar: "av.png",
              isOnline: false,
            },
          },
        ],
      };
      prismaMock.conversation.findFirst.mockResolvedValue(existingConversation);

      const result = await service.getOrCreatePrivateConversation(
        "user1",
        "user2",
      );

      expect(result.id).toBe("conv-exist");
      expect(prismaMock.conversation.create).not.toHaveBeenCalled();
      expect(result.isPinned).toBe(true);
      expect(result.unreadCount).toBe(2);
    });

    it("should restore soft-deleted conversation users when reusing existing conversation", async () => {
      const existingConversation = {
        id: "conv-exist",
        type: "private",
        users: [
          {
            id: "cu1",
            userId: "user1",
            isPinned: false,
            isMuted: false,
            unreadCount: 0,
            joinedAt: new Date(),
            isDeleted: true,
            user: {
              id: "user1",
              username: "alice",
              nickname: "Alice",
              avatar: null,
              isOnline: true,
            },
          },
          {
            id: "cu2",
            userId: "user2",
            isPinned: false,
            isMuted: false,
            unreadCount: 0,
            joinedAt: new Date(),
            isDeleted: true,
            user: {
              id: "user2",
              username: "bob",
              nickname: "Bob",
              avatar: "av.png",
              isOnline: false,
            },
          },
        ],
      };
      prismaMock.conversation.findFirst.mockResolvedValue(existingConversation);
      prismaMock.conversationUser.update.mockResolvedValue({});

      const result = await service.getOrCreatePrivateConversation(
        "user1",
        "user2",
      );

      expect(result.id).toBe("conv-exist");
      expect(prismaMock.conversationUser.update).toHaveBeenCalledTimes(2);
      expect(prismaMock.conversationUser.update).toHaveBeenCalledWith({
        where: { id: "cu1" },
        data: { isDeleted: false, deletedAt: null },
      });
      expect(prismaMock.conversationUser.update).toHaveBeenCalledWith({
        where: { id: "cu2" },
        data: { isDeleted: false, deletedAt: null },
      });
    });

    it("should handle existing conversation with no deleted users", async () => {
      const existingConversation = {
        id: "conv-exist",
        type: "private",
        users: [
          {
            id: "cu1",
            userId: "user1",
            isPinned: false,
            isMuted: false,
            unreadCount: 0,
            joinedAt: new Date(),
            isDeleted: false,
            user: {
              id: "user1",
              username: "alice",
              nickname: "Alice",
              avatar: null,
              isOnline: true,
            },
          },
          {
            id: "cu2",
            userId: "user2",
            isPinned: false,
            isMuted: false,
            unreadCount: 0,
            joinedAt: new Date(),
            isDeleted: false,
            user: {
              id: "user2",
              username: "bob",
              nickname: "Bob",
              avatar: "av.png",
              isOnline: false,
            },
          },
        ],
      };
      prismaMock.conversation.findFirst.mockResolvedValue(existingConversation);

      const result = await service.getOrCreatePrivateConversation(
        "user1",
        "user2",
      );

      expect(result.id).toBe("conv-exist");
      expect(prismaMock.conversationUser.update).not.toHaveBeenCalled();
    });
  });
});
