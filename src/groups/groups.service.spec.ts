import { Test, TestingModule } from "@nestjs/testing";
import { GroupsService } from "./groups.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { GroupRole } from "@prisma/client";

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

describe("GroupsService", () => {
  let service: GroupsService;
  let prismaMock: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    prismaMock = createMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<GroupsService>(GroupsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("createGroup", () => {
    it("should create a group with members successfully", async () => {
      const dto = { name: "TestGroup", memberIds: ["user2", "user3"] };
      prismaMock.user.findMany.mockResolvedValue([
        { id: "user2" },
        { id: "user3" },
      ]);

      const txMock = createMockPrisma();
      txMock.group.create.mockResolvedValue({
        id: "grp1",
        name: "TestGroup",
        ownerId: "user1",
        members: [],
        owner: {
          id: "user1",
          username: "alice",
          nickname: "Alice",
          avatar: null,
        },
      });
      txMock.conversation.create.mockResolvedValue({ id: "conv1" });
      prismaMock.$transaction.mockImplementation(async (fn) => fn(txMock));

      const result = await service.createGroup("user1", dto as any);

      expect(result.conversationId).toBe("conv1");
      expect(txMock.group.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ownerId: "user1",
            members: expect.objectContaining({
              create: expect.arrayContaining([
                { userId: "user1", role: GroupRole.OWNER },
                { userId: "user2", role: GroupRole.MEMBER },
              ]),
            }),
          }),
        }),
      );
    });

    it("should throw NotFoundException if some member IDs are invalid", async () => {
      const dto = { name: "TestGroup", memberIds: ["user2", "nonexistent"] };
      prismaMock.user.findMany.mockResolvedValue([{ id: "user2" }]);

      await expect(service.createGroup("user1", dto as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should deduplicate member IDs", async () => {
      const dto = { name: "TestGroup", memberIds: ["user2", "user2"] };
      prismaMock.user.findMany.mockResolvedValue([{ id: "user2" }]);

      const txMock = createMockPrisma();
      txMock.group.create.mockResolvedValue({
        id: "grp1",
        name: "TestGroup",
        ownerId: "user1",
        members: [],
        owner: {},
      });
      txMock.conversation.create.mockResolvedValue({ id: "conv1" });
      prismaMock.$transaction.mockImplementation(async (fn) => fn(txMock));

      await service.createGroup("user1", dto as any);

      const createCall = txMock.group.create.mock.calls[0][0];
      const memberCreates = createCall.data.members.create;
      const memberUserIds = memberCreates.map((m: any) => m.userId);
      const uniqueUserIds = [...new Set(memberUserIds)];
      expect(memberUserIds.length).toBe(uniqueUserIds.length);
    });
  });

  describe("dissolveGroup", () => {
    it("should dissolve a group if user is owner", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        ownerId: "user1",
        isDissolved: false,
      });
      prismaMock.group.update.mockResolvedValue({});

      const result = await service.dissolveGroup("user1", "grp1");

      expect(result.message).toBe("Group dissolved successfully");
      expect(prismaMock.group.update).toHaveBeenCalledWith({
        where: { id: "grp1" },
        data: { isDissolved: true, dissolvedAt: expect.any(Date) },
      });
    });

    it("should throw NotFoundException if group not found", async () => {
      prismaMock.group.findUnique.mockResolvedValue(null);

      await expect(service.dissolveGroup("user1", "grp1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw BadRequestException if group already dissolved", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        ownerId: "user1",
        isDissolved: true,
      });

      await expect(service.dissolveGroup("user1", "grp1")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw ForbiddenException if user is not owner", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        ownerId: "user2",
        isDissolved: false,
      });

      await expect(service.dissolveGroup("user1", "grp1")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe("updateGroup", () => {
    it("should allow owner to update group", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [{ userId: "user1", role: GroupRole.OWNER }],
      });
      prismaMock.group.update.mockResolvedValue({
        id: "grp1",
        name: "NewName",
      });

      await service.updateGroup("user1", "grp1", { name: "NewName" } as any);

      expect(prismaMock.group.update).toHaveBeenCalled();
    });

    it("should allow admin to update group", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [{ userId: "user1", role: GroupRole.ADMIN }],
      });
      prismaMock.group.update.mockResolvedValue({ id: "grp1" });

      await service.updateGroup("user1", "grp1", { name: "NewName" } as any);

      expect(prismaMock.group.update).toHaveBeenCalled();
    });

    it("should throw ForbiddenException if user is only a member", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [{ userId: "user1", role: GroupRole.MEMBER }],
      });

      await expect(
        service.updateGroup("user1", "grp1", {} as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw NotFoundException if group not found", async () => {
      prismaMock.group.findUnique.mockResolvedValue(null);

      await expect(
        service.updateGroup("user1", "grp1", {} as any),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException if not a member", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [],
      });

      await expect(
        service.updateGroup("user1", "grp1", {} as any),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("getGroup", () => {
    it("should return group details for a member", async () => {
      const group = {
        id: "grp1",
        name: "TestGroup",
        isDissolved: false,
        members: [{ userId: "user1" }, { userId: "user2" }],
      };
      prismaMock.group.findUnique.mockResolvedValue(group);

      const result = await service.getGroup("user1", "grp1");

      expect(result.id).toBe("grp1");
    });

    it("should throw NotFoundException if group not found", async () => {
      prismaMock.group.findUnique.mockResolvedValue(null);

      await expect(service.getGroup("user1", "grp1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw ForbiddenException if user is not a member", async () => {
      const group = {
        id: "grp1",
        isDissolved: false,
        members: [{ userId: "user2" }],
      };
      prismaMock.group.findUnique.mockResolvedValue(group);

      await expect(service.getGroup("user1", "grp1")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe("getMyGroups", () => {
    it("should return groups the user belongs to", async () => {
      const groups = [
        { id: "grp1", name: "G1" },
        { id: "grp2", name: "G2" },
      ];
      prismaMock.group.findMany.mockResolvedValue(groups);

      const result = await service.getMyGroups("user1");

      expect(result).toHaveLength(2);
    });
  });

  describe("inviteMembers", () => {
    it("should throw NotFoundException if group not found", async () => {
      prismaMock.group.findUnique.mockResolvedValue(null);

      await expect(
        service.inviteMembers("user1", "grp1", { userIds: ["user3"] } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException if inviter is not a group member", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [{ userId: "user2", role: GroupRole.OWNER }],
      });

      await expect(
        service.inviteMembers("user1", "grp1", { userIds: ["user3"] } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should return no new members message if all are already members", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [
          { userId: "user1", role: GroupRole.OWNER },
          { userId: "user2", role: GroupRole.MEMBER },
        ],
      });

      const result = await service.inviteMembers("user1", "grp1", {
        userIds: ["user2"],
      } as any);

      expect(result.message).toBe("No new members to invite");
      expect(result.added).toEqual([]);
    });

    it("should invite new members and add to conversation", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [{ userId: "user1", role: GroupRole.OWNER }],
      });
      prismaMock.user.findMany.mockResolvedValue([{ id: "user3" }]);

      const txMock = createMockPrisma();
      txMock.groupMember.createMany.mockResolvedValue({ count: 1 });
      txMock.conversation.findFirst.mockResolvedValue({ id: "conv1" });
      txMock.conversationUser.createMany.mockResolvedValue({ count: 1 });
      txMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        members: [
          { userId: "user1", role: GroupRole.OWNER },
          { userId: "user3", role: GroupRole.MEMBER },
        ],
      });
      prismaMock.$transaction.mockImplementation(async (fn) => fn(txMock));

      const result = await service.inviteMembers("user1", "grp1", {
        userIds: ["user3"],
      } as any);

      expect(result.added).toContain("user3");
      expect(result.message).toBe("Members invited successfully");
      expect(txMock.conversationUser.createMany).toHaveBeenCalled();
    });

    it("should throw NotFoundException if some users to invite not found", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [{ userId: "user1", role: GroupRole.OWNER }],
      });
      prismaMock.user.findMany.mockResolvedValue([]);

      await expect(
        service.inviteMembers("user1", "grp1", { userIds: ["user3"] } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it("should handle no conversation for the group gracefully", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [{ userId: "user1", role: GroupRole.OWNER }],
      });
      prismaMock.user.findMany.mockResolvedValue([{ id: "user3" }]);

      const txMock = createMockPrisma();
      txMock.groupMember.createMany.mockResolvedValue({ count: 1 });
      txMock.conversation.findFirst.mockResolvedValue(null);
      txMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        members: [{ userId: "user1" }, { userId: "user3" }],
      });
      prismaMock.$transaction.mockImplementation(async (fn) => fn(txMock));

      const result = await service.inviteMembers("user1", "grp1", {
        userIds: ["user3"],
      } as any);

      expect(result.added).toContain("user3");
      expect(txMock.conversationUser.createMany).not.toHaveBeenCalled();
    });

    it("should deduplicate invited userIds", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [{ userId: "user1", role: GroupRole.OWNER }],
      });
      prismaMock.user.findMany.mockResolvedValue([{ id: "user3" }]);

      const txMock = createMockPrisma();
      txMock.groupMember.createMany.mockResolvedValue({ count: 1 });
      txMock.conversation.findFirst.mockResolvedValue(null);
      txMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        members: [{ userId: "user1" }, { userId: "user3" }],
      });
      prismaMock.$transaction.mockImplementation(async (fn) => fn(txMock));

      const result = await service.inviteMembers("user1", "grp1", {
        userIds: ["user3", "user3"],
      } as any);

      expect(result.added).toEqual(["user3"]);
    });
  });

  describe("removeMember", () => {
    it("should throw NotFoundException if group not found", async () => {
      prismaMock.group.findUnique.mockResolvedValue(null);

      await expect(
        service.removeMember("user1", "grp1", "user2"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException if operator is not a group member", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [{ userId: "user2", role: GroupRole.MEMBER }],
      });

      await expect(
        service.removeMember("user1", "grp1", "user2"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw NotFoundException if target user is not a group member", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [{ userId: "user1", role: GroupRole.OWNER }],
      });

      await expect(
        service.removeMember("user1", "grp1", "nonexistent"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException if a regular member tries to remove another member", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [
          { userId: "user1", role: GroupRole.MEMBER },
          { userId: "user2", role: GroupRole.MEMBER },
        ],
      });

      await expect(
        service.removeMember("user1", "grp1", "user2"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw ForbiddenException when trying to remove the owner", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [
          { userId: "owner", role: GroupRole.OWNER },
          { userId: "user1", role: GroupRole.ADMIN },
        ],
      });

      await expect(
        service.removeMember("user1", "grp1", "owner"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw ForbiddenException if admin tries to remove another admin", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [
          { userId: "admin1", role: GroupRole.ADMIN },
          { userId: "admin2", role: GroupRole.ADMIN },
        ],
      });

      await expect(
        service.removeMember("admin1", "grp1", "admin2"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should allow owner to remove a member", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [
          { userId: "user1", role: GroupRole.OWNER },
          { userId: "user2", role: GroupRole.MEMBER },
        ],
      });

      const txMock = createMockPrisma();
      txMock.groupMember.delete.mockResolvedValue({});
      txMock.conversation.findFirst.mockResolvedValue({ id: "conv1" });
      txMock.conversationUser.deleteMany.mockResolvedValue({ count: 1 });
      prismaMock.$transaction.mockImplementation(async (fn) => fn(txMock));

      const result = await service.removeMember("user1", "grp1", "user2");

      expect(result.message).toBe("Member removed successfully");
      expect(txMock.groupMember.delete).toHaveBeenCalledWith({
        where: { groupId_userId: { groupId: "grp1", userId: "user2" } },
      });
    });

    it("should handle no conversation when removing member", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [
          { userId: "user1", role: GroupRole.OWNER },
          { userId: "user2", role: GroupRole.MEMBER },
        ],
      });

      const txMock = createMockPrisma();
      txMock.groupMember.delete.mockResolvedValue({});
      txMock.conversation.findFirst.mockResolvedValue(null);
      prismaMock.$transaction.mockImplementation(async (fn) => fn(txMock));

      const result = await service.removeMember("user1", "grp1", "user2");

      expect(result.message).toBe("Member removed successfully");
      expect(txMock.conversationUser.deleteMany).not.toHaveBeenCalled();
    });

    it("should allow a member to remove themselves (leave via removeMember)", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [{ userId: "user1", role: GroupRole.MEMBER }],
      });

      const txMock = createMockPrisma();
      txMock.groupMember.delete.mockResolvedValue({});
      txMock.conversation.findFirst.mockResolvedValue(null);
      prismaMock.$transaction.mockImplementation(async (fn) => fn(txMock));

      const result = await service.removeMember("user1", "grp1", "user1");

      expect(result.message).toBe("Member removed successfully");
    });

    it("should allow admin to remove a regular member", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [
          { userId: "admin1", role: GroupRole.ADMIN },
          { userId: "member1", role: GroupRole.MEMBER },
        ],
      });

      const txMock = createMockPrisma();
      txMock.groupMember.delete.mockResolvedValue({});
      txMock.conversation.findFirst.mockResolvedValue(null);
      prismaMock.$transaction.mockImplementation(async (fn) => fn(txMock));

      const result = await service.removeMember("admin1", "grp1", "member1");

      expect(result.message).toBe("Member removed successfully");
    });
  });

  describe("leaveGroup", () => {
    it("should throw NotFoundException if group not found", async () => {
      prismaMock.group.findUnique.mockResolvedValue(null);

      await expect(service.leaveGroup("user1", "grp1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw ForbiddenException if user is not a member", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [{ userId: "user2", role: GroupRole.OWNER }],
      });

      await expect(service.leaveGroup("user1", "grp1")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("should throw BadRequestException if owner tries to leave without transferring", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [{ userId: "user1", role: GroupRole.OWNER }],
      });

      await expect(service.leaveGroup("user1", "grp1")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should allow a regular member to leave successfully", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [
          { userId: "user1", role: GroupRole.MEMBER },
          { userId: "user2", role: GroupRole.OWNER },
        ],
      });

      const txMock = createMockPrisma();
      txMock.groupMember.delete.mockResolvedValue({});
      txMock.conversation.findFirst.mockResolvedValue({ id: "conv1" });
      txMock.conversationUser.deleteMany.mockResolvedValue({ count: 1 });
      prismaMock.$transaction.mockImplementation(async (fn) => fn(txMock));

      const result = await service.leaveGroup("user1", "grp1");

      expect(result.message).toBe("Left group successfully");
      expect(txMock.groupMember.delete).toHaveBeenCalledWith({
        where: { groupId_userId: { groupId: "grp1", userId: "user1" } },
      });
    });

    it("should handle no conversation when leaving group", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [
          { userId: "user1", role: GroupRole.MEMBER },
          { userId: "user2", role: GroupRole.OWNER },
        ],
      });

      const txMock = createMockPrisma();
      txMock.groupMember.delete.mockResolvedValue({});
      txMock.conversation.findFirst.mockResolvedValue(null);
      prismaMock.$transaction.mockImplementation(async (fn) => fn(txMock));

      const result = await service.leaveGroup("user1", "grp1");

      expect(result.message).toBe("Left group successfully");
      expect(txMock.conversationUser.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe("transferOwner", () => {
    it("should throw NotFoundException if group not found", async () => {
      prismaMock.group.findUnique.mockResolvedValue(null);

      await expect(
        service.transferOwner("user1", "grp1", { newOwnerId: "user2" } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException if user is not the owner", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        ownerId: "user2",
        members: [
          { userId: "user2", role: GroupRole.OWNER },
          { userId: "user1", role: GroupRole.MEMBER },
        ],
      });

      await expect(
        service.transferOwner("user1", "grp1", { newOwnerId: "user2" } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw BadRequestException if transferring to self", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        ownerId: "user1",
        members: [{ userId: "user1", role: GroupRole.OWNER }],
      });

      await expect(
        service.transferOwner("user1", "grp1", { newOwnerId: "user1" } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw NotFoundException if target user is not a group member", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        ownerId: "user1",
        members: [{ userId: "user1", role: GroupRole.OWNER }],
      });

      await expect(
        service.transferOwner("user1", "grp1", { newOwnerId: "user3" } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it("should transfer ownership successfully, original owner becomes member", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        ownerId: "user1",
        members: [
          { userId: "user1", role: GroupRole.OWNER },
          { userId: "user2", role: GroupRole.MEMBER },
        ],
      });

      const txMock = createMockPrisma();
      txMock.groupMember.update.mockResolvedValue({});
      txMock.group.update.mockResolvedValue({
        id: "grp1",
        ownerId: "user2",
        owner: { id: "user2", username: "bob", nickname: "Bob", avatar: null },
        members: [
          { userId: "user1", role: GroupRole.MEMBER },
          { userId: "user2", role: GroupRole.OWNER },
        ],
      });
      prismaMock.$transaction.mockImplementation(async (fn) => fn(txMock));

      const result = await service.transferOwner("user1", "grp1", {
        newOwnerId: "user2",
      } as any);

      expect(txMock.groupMember.update).toHaveBeenCalledTimes(2);
      expect(txMock.groupMember.update).toHaveBeenCalledWith({
        where: { groupId_userId: { groupId: "grp1", userId: "user1" } },
        data: { role: GroupRole.MEMBER },
      });
      expect(txMock.groupMember.update).toHaveBeenCalledWith({
        where: { groupId_userId: { groupId: "grp1", userId: "user2" } },
        data: { role: GroupRole.OWNER },
      });
      expect(txMock.group.update).toHaveBeenCalledWith({
        where: { id: "grp1" },
        data: { ownerId: "user2" },
        include: expect.any(Object),
      });
      expect(result.ownerId).toBe("user2");
    });
  });

  describe("createAnnouncement", () => {
    it("should allow owner to create an announcement", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [{ userId: "user1", role: GroupRole.OWNER }],
      });
      prismaMock.groupAnnouncement.create.mockResolvedValue({ id: "ann1" });

      await service.createAnnouncement("user1", "grp1", {
        title: "Hello",
        content: "World",
      } as any);

      expect(prismaMock.groupAnnouncement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          groupId: "grp1",
          authorId: "user1",
          title: "Hello",
          content: "World",
          isPinned: false,
        }),
      });
    });

    it("should allow admin to create an announcement", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [{ userId: "user1", role: GroupRole.ADMIN }],
      });
      prismaMock.groupAnnouncement.create.mockResolvedValue({ id: "ann1" });

      await service.createAnnouncement("user1", "grp1", {
        title: "Test",
        content: "Content",
      } as any);

      expect(prismaMock.groupAnnouncement.create).toHaveBeenCalled();
    });

    it("should throw ForbiddenException if regular member tries to create", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [{ userId: "user1", role: GroupRole.MEMBER }],
      });

      await expect(
        service.createAnnouncement("user1", "grp1", {
          title: "T",
          content: "C",
        } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw NotFoundException if group not found", async () => {
      prismaMock.group.findUnique.mockResolvedValue(null);

      await expect(
        service.createAnnouncement("user1", "grp1", {
          title: "T",
          content: "C",
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException if not a member", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [],
      });

      await expect(
        service.createAnnouncement("user1", "grp1", {
          title: "T",
          content: "C",
        } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should set isPinned when provided", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [{ userId: "user1", role: GroupRole.OWNER }],
      });
      prismaMock.groupAnnouncement.create.mockResolvedValue({ id: "ann1" });

      await service.createAnnouncement("user1", "grp1", {
        title: "Hello",
        content: "World",
        isPinned: true,
      } as any);

      expect(prismaMock.groupAnnouncement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ isPinned: true }),
      });
    });
  });

  describe("getAnnouncements", () => {
    it("should return announcements for a group member", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [{ userId: "user1" }],
      });
      prismaMock.groupAnnouncement.findMany.mockResolvedValue([{ id: "ann1" }]);

      const result = await service.getAnnouncements("user1", "grp1");

      expect(result).toHaveLength(1);
    });

    it("should throw NotFoundException if group not found", async () => {
      prismaMock.group.findUnique.mockResolvedValue(null);

      await expect(service.getAnnouncements("user1", "grp1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw ForbiddenException if not a member", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [],
      });

      await expect(service.getAnnouncements("user1", "grp1")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe("updateAnnouncement", () => {
    it("should allow owner to update an announcement", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [{ userId: "user1", role: GroupRole.OWNER }],
      });
      prismaMock.groupAnnouncement.update.mockResolvedValue({ id: "ann1" });

      await service.updateAnnouncement("user1", "grp1", "ann1", {
        title: "Updated",
      } as any);

      expect(prismaMock.groupAnnouncement.update).toHaveBeenCalledWith({
        where: { id: "ann1" },
        data: { title: "Updated" },
      });
    });

    it("should throw ForbiddenException if regular member", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [{ userId: "user1", role: GroupRole.MEMBER }],
      });

      await expect(
        service.updateAnnouncement("user1", "grp1", "ann1", {} as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw NotFoundException if group not found", async () => {
      prismaMock.group.findUnique.mockResolvedValue(null);

      await expect(
        service.updateAnnouncement("user1", "grp1", "ann1", {} as any),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException if not a member", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [],
      });

      await expect(
        service.updateAnnouncement("user1", "grp1", "ann1", {} as any),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("deleteAnnouncement", () => {
    it("should allow admin to delete an announcement", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [{ userId: "user1", role: GroupRole.ADMIN }],
      });
      prismaMock.groupAnnouncement.delete.mockResolvedValue({ id: "ann1" });

      const result = await service.deleteAnnouncement("user1", "grp1", "ann1");

      expect(result.message).toBe("Announcement deleted successfully");
    });

    it("should throw ForbiddenException if regular member tries to delete", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [{ userId: "user1", role: GroupRole.MEMBER }],
      });

      await expect(
        service.deleteAnnouncement("user1", "grp1", "ann1"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw NotFoundException if group not found", async () => {
      prismaMock.group.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteAnnouncement("user1", "grp1", "ann1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException if not a member", async () => {
      prismaMock.group.findUnique.mockResolvedValue({
        id: "grp1",
        isDissolved: false,
        members: [],
      });

      await expect(
        service.deleteAnnouncement("user1", "grp1", "ann1"),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
