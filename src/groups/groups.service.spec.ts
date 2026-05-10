// @ts-nocheck
import { Test, TestingModule } from '@nestjs/testing';
import { GroupsService } from './groups.service';
import { PrismaService } from '../prisma/prisma.service';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { PrismaClient, GroupRole } from '@prisma/client';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';

describe('GroupsService', () => {
  let service: GroupsService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GroupsService, PrismaService],
    })
      .overrideProvider(PrismaService)
      .useValue(mockDeep<PrismaClient>())
      .compile();

    service = module.get<GroupsService>(GroupsService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createGroup', () => {
    const userId = 'user-1';

    it('should create group successfully', async () => {
      const dto = {
        name: 'Test Group',
        description: 'A test group',
        avatar: 'avatar.jpg',
        memberIds: ['user-2', 'user-3'],
      };
      const mockGroup = {
        id: 'group-1',
        name: dto.name,
        description: dto.description,
        avatar: dto.avatar,
        ownerId: userId,
        members: [
          { userId, role: GroupRole.OWNER, user: { id: userId, nickname: 'User 1' } },
          { userId: 'user-2', role: GroupRole.MEMBER, user: { id: 'user-2', nickname: 'User 2' } },
          { userId: 'user-3', role: GroupRole.MEMBER, user: { id: 'user-3', nickname: 'User 3' } },
        ],
      };
      const mockConversation = { id: 'conv-1' };

      prisma.user.findMany.mockResolvedValue([{ id: 'user-2' }, { id: 'user-3' }] as any);
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => {
        const tx = mockDeep<PrismaClient>();
        tx.group.create.mockResolvedValue(mockGroup as any);
        tx.conversation.create.mockResolvedValue(mockConversation as any);
        return cb(tx);
      });

      const result = await service.createGroup(userId, dto);

      expect(result.id).toBe('group-1');
      expect(result.conversationId).toBe('conv-1');
    });

    it('should throw NotFoundException when some members not found', async () => {
      const dto = {
        name: 'Test Group',
        description: 'A test group',
        memberIds: ['user-2', 'user-nonexistent'],
      };

      prisma.user.findMany.mockResolvedValue([{ id: 'user-2' }] as any);

      await expect(service.createGroup(userId, dto)).rejects.toThrow(NotFoundException);
    });

    it('should deduplicate member ids', async () => {
      const dto = {
        name: 'Test Group',
        description: 'A test group',
        memberIds: ['user-2', 'user-2', 'user-3'],
      };

      prisma.user.findMany.mockResolvedValue([{ id: 'user-2' }, { id: 'user-3' }] as any);
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => {
        const tx = mockDeep<PrismaClient>();
        tx.group.create.mockResolvedValue({ id: 'group-1', members: [] } as any);
        tx.conversation.create.mockResolvedValue({ id: 'conv-1' } as any);
        return cb(tx);
      });

      await service.createGroup(userId, dto);

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['user-2', 'user-3'] } },
        }),
      );
    });
  });

  describe('inviteMembers', () => {
    const userId = 'user-1';
    const groupId = 'group-1';

    it('should allow owner to invite members', async () => {
      const dto = { userIds: ['user-2', 'user-3'] };
      const mockGroup = {
        id: groupId,
        ownerId: userId,
        isDissolved: false,
        members: [{ userId, role: GroupRole.OWNER }],
      };
      const mockConversation = { id: 'conv-1' };
      const updatedGroup = { ...mockGroup, members: [{ userId, role: GroupRole.OWNER }, { userId: 'user-2' }, { userId: 'user-3' }] };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      prisma.user.findMany.mockResolvedValue([{ id: 'user-2' }, { id: 'user-3' }] as any);
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => {
        const tx = mockDeep<PrismaClient>();
        tx.groupMember.createMany.mockResolvedValue({ count: 2 } as any);
        tx.conversation.findFirst.mockResolvedValue(mockConversation as any);
        tx.conversationUser.createMany.mockResolvedValue({ count: 2 } as any);
        tx.group.findUnique.mockResolvedValue(updatedGroup as any);
        return cb(tx);
      });

      const result = await service.inviteMembers(userId, groupId, dto);

      expect(result.message).toBe('Members invited successfully');
      expect(result.added).toEqual(['user-2', 'user-3']);
    });

    it('should allow admin to invite members', async () => {
      const dto = { userIds: ['user-2'] };
      const mockGroup = {
        id: groupId,
        ownerId: 'owner-id',
        isDissolved: false,
        members: [
          { userId: 'owner-id', role: GroupRole.OWNER },
          { userId, role: GroupRole.ADMIN },
        ],
      };
      const updatedGroup = { ...mockGroup, members: [...mockGroup.members, { userId: 'user-2' }] };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      prisma.user.findMany.mockResolvedValue([{ id: 'user-2' }] as any);
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => {
        const tx = mockDeep<PrismaClient>();
        tx.groupMember.createMany.mockResolvedValue({ count: 1 } as any);
        tx.conversation.findFirst.mockResolvedValue({ id: 'conv-1' } as any);
        tx.conversationUser.createMany.mockResolvedValue({ count: 1 } as any);
        tx.group.findUnique.mockResolvedValue(updatedGroup as any);
        return cb(tx);
      });

      const result = await service.inviteMembers(userId, groupId, dto);

      expect(result.message).toBe('Members invited successfully');
    });

    it('should allow member to invite new members', async () => {
      const dto = { userIds: ['user-2'] };
      const mockGroup = {
        id: groupId,
        ownerId: 'owner-id',
        isDissolved: false,
        members: [
          { userId: 'owner-id', role: GroupRole.OWNER },
          { userId, role: GroupRole.MEMBER },
        ],
      };
      const updatedGroup = { ...mockGroup, members: [...mockGroup.members, { userId: 'user-2' }] };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      prisma.user.findMany.mockResolvedValue([{ id: 'user-2' }] as any);
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => {
        const tx = mockDeep();
        tx.groupMember.createMany.mockResolvedValue({ count: 1 } as any);
        tx.conversation.findFirst.mockResolvedValue({ id: 'conv-1' } as any);
        tx.conversationUser.createMany.mockResolvedValue({ count: 1 } as any);
        tx.group.findUnique.mockResolvedValue(updatedGroup as any);
        return cb(tx);
      });

      const result = await service.inviteMembers(userId, groupId, dto);

      expect(result.message).toBe('Members invited successfully');
      expect(result.added).toEqual(['user-2']);
    });

    it('should throw NotFoundException when group not found', async () => {
      const dto = { userIds: ['user-2'] };
      prisma.group.findUnique.mockResolvedValue(null);

      await expect(service.inviteMembers(userId, groupId, dto)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when not a group member', async () => {
      const dto = { userIds: ['user-2'] };
      const mockGroup = {
        id: groupId,
        ownerId: 'owner-id',
        isDissolved: false,
        members: [{ userId: 'owner-id', role: GroupRole.OWNER }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(service.inviteMembers(userId, groupId, dto)).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when some users not found', async () => {
      const dto = { userIds: ['user-2', 'user-nonexistent'] };
      const mockGroup = {
        id: groupId,
        ownerId: userId,
        isDissolved: false,
        members: [{ userId, role: GroupRole.OWNER }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      prisma.user.findMany.mockResolvedValue([{ id: 'user-2' }] as any);

      await expect(service.inviteMembers(userId, groupId, dto)).rejects.toThrow(NotFoundException);
    });

    it('should skip already existing members', async () => {
      const dto = { userIds: ['user-2', 'user-3'] };
      const mockGroup = {
        id: groupId,
        ownerId: userId,
        isDissolved: false,
        members: [
          { userId, role: GroupRole.OWNER },
          { userId: 'user-2', role: GroupRole.MEMBER },
        ],
      };
      const updatedGroup = { ...mockGroup, members: [...mockGroup.members, { userId: 'user-3' }] };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      prisma.user.findMany.mockResolvedValue([{ id: 'user-3' }] as any);
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => {
        const tx = mockDeep<PrismaClient>();
        tx.groupMember.createMany.mockResolvedValue({ count: 1 } as any);
        tx.conversation.findFirst.mockResolvedValue({ id: 'conv-1' } as any);
        tx.conversationUser.createMany.mockResolvedValue({ count: 1 } as any);
        tx.group.findUnique.mockResolvedValue(updatedGroup as any);
        return cb(tx);
      });

      const result = await service.inviteMembers(userId, groupId, dto);

      expect(result.added).toEqual(['user-3']);
    });

    it('should return no new members when all are already members', async () => {
      const dto = { userIds: ['user-2'] };
      const mockGroup = {
        id: groupId,
        ownerId: userId,
        isDissolved: false,
        members: [
          { userId, role: GroupRole.OWNER },
          { userId: 'user-2', role: GroupRole.MEMBER },
        ],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      const result = await service.inviteMembers(userId, groupId, dto);

      expect(result.message).toBe('No new members to invite');
      expect(result.added).toEqual([]);
      expect(result.alreadyMembers).toEqual(['user-2']);
    });
  });

  describe('removeMember', () => {
    const userId = 'user-1';
    const groupId = 'group-1';
    const targetUserId = 'user-2';

    it('should allow owner to remove member', async () => {
      const mockGroup = {
        id: groupId,
        ownerId: userId,
        isDissolved: false,
        members: [
          { userId, role: GroupRole.OWNER },
          { userId: targetUserId, role: GroupRole.MEMBER },
        ],
      };
      const mockConversation = { id: 'conv-1' };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => {
        const tx = mockDeep<PrismaClient>();
        tx.groupMember.delete.mockResolvedValue({} as any);
        tx.conversation.findFirst.mockResolvedValue(mockConversation as any);
        tx.conversationUser.deleteMany.mockResolvedValue({ count: 1 } as any);
        return cb(tx);
      });

      const result = await service.removeMember(userId, groupId, targetUserId);

      expect(result.message).toBe('Member removed successfully');
    });

    it('should allow admin to remove member', async () => {
      const mockGroup = {
        id: groupId,
        ownerId: 'owner-id',
        isDissolved: false,
        members: [
          { userId: 'owner-id', role: GroupRole.OWNER },
          { userId, role: GroupRole.ADMIN },
          { userId: targetUserId, role: GroupRole.MEMBER },
        ],
      };
      const mockConversation = { id: 'conv-1' };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => {
        const tx = mockDeep<PrismaClient>();
        tx.groupMember.delete.mockResolvedValue({} as any);
        tx.conversation.findFirst.mockResolvedValue(mockConversation as any);
        tx.conversationUser.deleteMany.mockResolvedValue({ count: 1 } as any);
        return cb(tx);
      });

      const result = await service.removeMember(userId, groupId, targetUserId);

      expect(result.message).toBe('Member removed successfully');
    });

    it('should throw ForbiddenException when cannot remove owner', async () => {
      const ownerId = 'owner-id';
      const mockGroup = {
        id: groupId,
        ownerId,
        isDissolved: false,
        members: [
          { userId: ownerId, role: GroupRole.OWNER },
          { userId, role: GroupRole.ADMIN },
        ],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(service.removeMember(userId, groupId, ownerId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ForbiddenException when admin tries to remove another admin', async () => {
      const mockGroup = {
        id: groupId,
        ownerId: 'owner-id',
        isDissolved: false,
        members: [
          { userId: 'owner-id', role: GroupRole.OWNER },
          { userId, role: GroupRole.ADMIN },
          { userId: targetUserId, role: GroupRole.ADMIN },
        ],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(service.removeMember(userId, groupId, targetUserId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ForbiddenException when member tries to remove another member', async () => {
      const mockGroup = {
        id: groupId,
        ownerId: 'owner-id',
        isDissolved: false,
        members: [
          { userId: 'owner-id', role: GroupRole.OWNER },
          { userId, role: GroupRole.MEMBER },
          { userId: targetUserId, role: GroupRole.MEMBER },
        ],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(service.removeMember(userId, groupId, targetUserId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should allow member to remove themselves', async () => {
      const mockGroup = {
        id: groupId,
        ownerId: 'owner-id',
        isDissolved: false,
        members: [
          { userId: 'owner-id', role: GroupRole.OWNER },
          { userId, role: GroupRole.MEMBER },
        ],
      };
      const mockConversation = { id: 'conv-1' };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => {
        const tx = mockDeep<PrismaClient>();
        tx.groupMember.delete.mockResolvedValue({} as any);
        tx.conversation.findFirst.mockResolvedValue(mockConversation as any);
        tx.conversationUser.deleteMany.mockResolvedValue({ count: 1 } as any);
        return cb(tx);
      });

      const result = await service.removeMember(userId, groupId, userId);

      expect(result.message).toBe('Member removed successfully');
    });

    it('should throw NotFoundException when group not found', async () => {
      prisma.group.findUnique.mockResolvedValue(null);

      await expect(service.removeMember(userId, groupId, targetUserId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException when not a group member', async () => {
      const mockGroup = {
        id: groupId,
        ownerId: 'owner-id',
        isDissolved: false,
        members: [{ userId: 'owner-id', role: GroupRole.OWNER }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(service.removeMember(userId, groupId, targetUserId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw NotFoundException when target is not a member', async () => {
      const mockGroup = {
        id: groupId,
        ownerId: userId,
        isDissolved: false,
        members: [{ userId, role: GroupRole.OWNER }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(service.removeMember(userId, groupId, targetUserId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('leaveGroup', () => {
    const userId = 'user-1';
    const groupId = 'group-1';

    it('should allow member to leave group', async () => {
      const mockGroup = {
        id: groupId,
        ownerId: 'owner-id',
        isDissolved: false,
        members: [
          { userId: 'owner-id', role: GroupRole.OWNER },
          { userId, role: GroupRole.MEMBER },
        ],
      };
      const mockConversation = { id: 'conv-1' };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => {
        const tx = mockDeep<PrismaClient>();
        tx.groupMember.delete.mockResolvedValue({} as any);
        tx.conversation.findFirst.mockResolvedValue(mockConversation as any);
        tx.conversationUser.deleteMany.mockResolvedValue({ count: 1 } as any);
        return cb(tx);
      });

      const result = await service.leaveGroup(userId, groupId);

      expect(result.message).toBe('Left group successfully');
    });

    it('should throw BadRequestException when owner tries to leave', async () => {
      const mockGroup = {
        id: groupId,
        ownerId: userId,
        isDissolved: false,
        members: [{ userId, role: GroupRole.OWNER }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(service.leaveGroup(userId, groupId)).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when group not found', async () => {
      prisma.group.findUnique.mockResolvedValue(null);

      await expect(service.leaveGroup(userId, groupId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when not a group member', async () => {
      const mockGroup = {
        id: groupId,
        ownerId: 'owner-id',
        isDissolved: false,
        members: [{ userId: 'owner-id', role: GroupRole.OWNER }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(service.leaveGroup(userId, groupId)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('transferOwner', () => {
    const userId = 'user-1';
    const groupId = 'group-1';
    const newOwnerId = 'user-2';

    it('should transfer ownership successfully', async () => {
      const dto = { newOwnerId };
      const mockGroup = {
        id: groupId,
        ownerId: userId,
        isDissolved: false,
        members: [
          { userId, role: GroupRole.OWNER },
          { userId: newOwnerId, role: GroupRole.MEMBER },
        ],
      };
      const updatedGroup = {
        ...mockGroup,
        ownerId: newOwnerId,
        members: [
          { userId, role: GroupRole.MEMBER },
          { userId: newOwnerId, role: GroupRole.OWNER },
        ],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb) => {
        const tx = mockDeep<PrismaClient>();
        tx.groupMember.update.mockResolvedValue({} as any);
        tx.group.update.mockResolvedValue(updatedGroup as any);
        return cb(tx);
      });

      const result = await service.transferOwner(userId, groupId, dto);

      expect(result.ownerId).toBe(newOwnerId);
    });

    it('should throw ForbiddenException when not owner', async () => {
      const dto = { newOwnerId };
      const mockGroup = {
        id: groupId,
        ownerId: 'owner-id',
        isDissolved: false,
        members: [
          { userId: 'owner-id', role: GroupRole.OWNER },
          { userId, role: GroupRole.ADMIN },
          { userId: newOwnerId, role: GroupRole.MEMBER },
        ],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(service.transferOwner(userId, groupId, dto)).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when transferring to self', async () => {
      const dto = { newOwnerId: userId };
      const mockGroup = {
        id: groupId,
        ownerId: userId,
        isDissolved: false,
        members: [{ userId, role: GroupRole.OWNER }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(service.transferOwner(userId, groupId, dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when group not found', async () => {
      const dto = { newOwnerId };
      prisma.group.findUnique.mockResolvedValue(null);

      await expect(service.transferOwner(userId, groupId, dto)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when new owner is not a member', async () => {
      const dto = { newOwnerId: 'non-member' };
      const mockGroup = {
        id: groupId,
        ownerId: userId,
        isDissolved: false,
        members: [{ userId, role: GroupRole.OWNER }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(service.transferOwner(userId, groupId, dto)).rejects.toThrow(NotFoundException);
    });
  });

  describe('dissolveGroup', () => {
    const userId = 'user-1';
    const groupId = 'group-1';

    it('should dissolve group successfully', async () => {
      const mockGroup = {
        id: groupId,
        ownerId: userId,
        isDissolved: false,
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      prisma.group.update.mockResolvedValue({ ...mockGroup, isDissolved: true } as any);

      const result = await service.dissolveGroup(userId, groupId);

      expect(result.message).toBe('Group dissolved successfully');
    });

    it('should throw NotFoundException when group not found', async () => {
      prisma.group.findUnique.mockResolvedValue(null);

      await expect(service.dissolveGroup(userId, groupId)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when group already dissolved', async () => {
      const mockGroup = {
        id: groupId,
        ownerId: userId,
        isDissolved: true,
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(service.dissolveGroup(userId, groupId)).rejects.toThrow(BadRequestException);
    });

    it('should throw ForbiddenException when not owner', async () => {
      const mockGroup = {
        id: groupId,
        ownerId: 'owner-id',
        isDissolved: false,
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(service.dissolveGroup(userId, groupId)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateGroup', () => {
    const userId = 'user-1';
    const groupId = 'group-1';

    it('should allow owner to update group', async () => {
      const dto = { name: 'Updated Name', description: 'Updated description' };
      const mockGroup = {
        id: groupId,
        ownerId: userId,
        isDissolved: false,
        members: [{ userId, role: GroupRole.OWNER }],
      };
      const updatedGroup = { ...mockGroup, ...dto };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      prisma.group.update.mockResolvedValue(updatedGroup as any);

      const result = await service.updateGroup(userId, groupId, dto);

      expect(result.name).toBe('Updated Name');
    });

    it('should allow admin to update group', async () => {
      const dto = { name: 'Updated Name' };
      const mockGroup = {
        id: groupId,
        ownerId: 'owner-id',
        isDissolved: false,
        members: [
          { userId: 'owner-id', role: GroupRole.OWNER },
          { userId, role: GroupRole.ADMIN },
        ],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      prisma.group.update.mockResolvedValue({ ...mockGroup, ...dto } as any);

      await service.updateGroup(userId, groupId, dto);

      expect(prisma.group.update).toHaveBeenCalled();
    });

    it('should throw ForbiddenException when member tries to update', async () => {
      const dto = { name: 'Updated Name' };
      const mockGroup = {
        id: groupId,
        ownerId: 'owner-id',
        isDissolved: false,
        members: [
          { role: GroupRole.MEMBER },
        ],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(service.updateGroup(userId, groupId, dto)).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when group not found', async () => {
      const dto = { name: 'Updated Name' };
      prisma.group.findUnique.mockResolvedValue(null);

      await expect(service.updateGroup(userId, groupId, dto)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when not a group member', async () => {
      const dto = { name: 'Updated Name' };
      const mockGroup = {
        id: groupId,
        ownerId: 'owner-id',
        isDissolved: false,
        members: [],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(service.updateGroup(userId, groupId, dto)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getGroup', () => {
    const userId = 'user-1';
    const groupId = 'group-1';

    it('should return group for member', async () => {
      const mockGroup = {
        id: groupId,
        name: 'Test Group',
        isDissolved: false,
        members: [{ userId, role: GroupRole.MEMBER }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      const result = await service.getGroup(userId, groupId);

      expect(result.id).toBe(groupId);
    });

    it('should throw NotFoundException when group not found', async () => {
      prisma.group.findUnique.mockResolvedValue(null);

      await expect(service.getGroup(userId, groupId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when not a member', async () => {
      const mockGroup = {
        id: groupId,
        isDissolved: false,
        members: [{ userId: 'other-user', role: GroupRole.MEMBER }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(service.getGroup(userId, groupId)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getMyGroups', () => {
    const userId = 'user-1';

    it('should return groups for user', async () => {
      const mockGroups = [
        {
          id: 'group-1',
          name: 'Group 1',
          isDissolved: false,
          owner: { id: 'owner-1', nickname: 'Owner 1' },
          members: [{ userId, role: GroupRole.MEMBER }],
        },
        {
          id: 'group-2',
          name: 'Group 2',
          isDissolved: false,
          owner: { id: 'owner-2', nickname: 'Owner 2' },
          members: [{ userId, role: GroupRole.MEMBER }],
        },
      ];

      prisma.group.findMany.mockResolvedValue(mockGroups as any);

      const result = await service.getMyGroups(userId);

      expect(result).toHaveLength(2);
      expect(prisma.group.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            isDissolved: false,
            members: { some: { userId } },
          },
        }),
      );
    });

    it('should return empty array when no groups', async () => {
      prisma.group.findMany.mockResolvedValue([]);

      const result = await service.getMyGroups(userId);

      expect(result).toEqual([]);
    });
  });

  describe('createAnnouncement', () => {
    const userId = 'user-1';
    const groupId = 'group-1';

    it('should allow owner to create announcement', async () => {
      const dto = { title: 'Announcement', content: 'Content', isPinned: true };
      const mockGroup = {
        id: groupId,
        isDissolved: false,
        members: [{ role: GroupRole.OWNER }],
      };
      const mockAnnouncement = { id: 'ann-1', ...dto };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      prisma.groupAnnouncement.create.mockResolvedValue(mockAnnouncement as any);

      const result = await service.createAnnouncement(userId, groupId, dto);

      expect(result.id).toBe('ann-1');
    });

    it('should allow admin to create announcement', async () => {
      const dto = { title: 'Announcement', content: 'Content' };
      const mockGroup = {
        id: groupId,
        isDissolved: false,
        members: [{ role: GroupRole.ADMIN }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      prisma.groupAnnouncement.create.mockResolvedValue({ id: 'ann-1' } as any);

      await service.createAnnouncement(userId, groupId, dto);

      expect(prisma.groupAnnouncement.create).toHaveBeenCalled();
    });

    it('should throw ForbiddenException when member tries to create announcement', async () => {
      const dto = { title: 'Announcement', content: 'Content' };
      const mockGroup = {
        id: groupId,
        isDissolved: false,
        members: [{ role: GroupRole.MEMBER }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(
        service.createAnnouncement(userId, groupId, dto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when group not found', async () => {
      const dto = { title: 'Announcement', content: 'Content' };
      prisma.group.findUnique.mockResolvedValue(null);

      await expect(
        service.createAnnouncement(userId, groupId, dto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when not a group member', async () => {
      const dto = { title: 'Announcement', content: 'Content' };
      const mockGroup = {
        id: groupId,
        isDissolved: false,
        members: [],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(
        service.createAnnouncement(userId, groupId, dto),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getAnnouncements', () => {
    const userId = 'user-1';
    const groupId = 'group-1';

    it('should return announcements for member', async () => {
      const mockGroup = {
        id: groupId,
        isDissolved: false,
        members: [{ userId }],
      };
      const mockAnnouncements = [
        { id: 'ann-1', title: 'Announcement 1' },
        { id: 'ann-2', title: 'Announcement 2' },
      ];

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      prisma.groupAnnouncement.findMany.mockResolvedValue(mockAnnouncements as any);

      const result = await service.getAnnouncements(userId, groupId);

      expect(result).toHaveLength(2);
      expect(prisma.groupAnnouncement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
        }),
      );
    });

    it('should throw NotFoundException when group not found', async () => {
      prisma.group.findUnique.mockResolvedValue(null);

      await expect(service.getAnnouncements(userId, groupId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException when not a group member', async () => {
      const mockGroup = {
        id: groupId,
        isDissolved: false,
        members: [],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(service.getAnnouncements(userId, groupId)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('updateAnnouncement', () => {
    const userId = 'user-1';
    const groupId = 'group-1';
    const announcementId = 'ann-1';

    it('should allow owner to update announcement', async () => {
      const dto = { title: 'Updated Title' };
      const mockGroup = {
        id: groupId,
        isDissolved: false,
        members: [{ role: GroupRole.OWNER }],
      };
      const updatedAnnouncement = { id: announcementId, ...dto };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      prisma.groupAnnouncement.update.mockResolvedValue(updatedAnnouncement as any);

      const result = await service.updateAnnouncement(userId, groupId, announcementId, dto);

      expect(result.title).toBe('Updated Title');
    });

    it('should allow admin to update announcement', async () => {
      const dto = { content: 'Updated content' };
      const mockGroup = {
        id: groupId,
        isDissolved: false,
        members: [{ role: GroupRole.ADMIN }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      prisma.groupAnnouncement.update.mockResolvedValue({ id: announcementId } as any);

      await service.updateAnnouncement(userId, groupId, announcementId, dto);

      expect(prisma.groupAnnouncement.update).toHaveBeenCalled();
    });

    it('should throw ForbiddenException when member tries to update', async () => {
      const dto = { title: 'Updated Title' };
      const mockGroup = {
        id: groupId,
        isDissolved: false,
        members: [{ role: GroupRole.MEMBER }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(
        service.updateAnnouncement(userId, groupId, announcementId, dto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when group not found', async () => {
      const dto = { title: 'Updated Title' };
      prisma.group.findUnique.mockResolvedValue(null);

      await expect(
        service.updateAnnouncement(userId, groupId, announcementId, dto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when not a group member', async () => {
      const dto = { title: 'Updated Title' };
      const mockGroup = {
        id: groupId,
        isDissolved: false,
        members: [],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(
        service.updateAnnouncement(userId, groupId, announcementId, dto),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('deleteAnnouncement', () => {
    const userId = 'user-1';
    const groupId = 'group-1';
    const announcementId = 'ann-1';

    it('should allow owner to delete announcement', async () => {
      const mockGroup = {
        id: groupId,
        isDissolved: false,
        members: [{ role: GroupRole.OWNER }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      prisma.groupAnnouncement.delete.mockResolvedValue({} as any);

      const result = await service.deleteAnnouncement(userId, groupId, announcementId);

      expect(result.message).toBe('Announcement deleted successfully');
    });

    it('should allow admin to delete announcement', async () => {
      const mockGroup = {
        id: groupId,
        isDissolved: false,
        members: [{ role: GroupRole.ADMIN }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      prisma.groupAnnouncement.delete.mockResolvedValue({} as any);

      const result = await service.deleteAnnouncement(userId, groupId, announcementId);

      expect(result.message).toBe('Announcement deleted successfully');
    });

    it('should throw ForbiddenException when member tries to delete', async () => {
      const mockGroup = {
        id: groupId,
        isDissolved: false,
        members: [{ role: GroupRole.MEMBER }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(
        service.deleteAnnouncement(userId, groupId, announcementId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when group not found', async () => {
      prisma.group.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteAnnouncement(userId, groupId, announcementId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when not a group member', async () => {
      const mockGroup = {
        id: groupId,
        isDissolved: false,
        members: [],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(
        service.deleteAnnouncement(userId, groupId, announcementId),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
