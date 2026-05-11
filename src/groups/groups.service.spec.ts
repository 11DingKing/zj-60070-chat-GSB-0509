// @ts-nocheck
import { Test, TestingModule } from '@nestjs/testing';
import { GroupsService } from './groups.service';
import { PrismaService } from '../prisma/prisma.service';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { GroupRole } from '@prisma/client';

describe('GroupsService', () => {
  let service: GroupsService;
  let prisma: DeepMockProxy<PrismaService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GroupsService, PrismaService],
    })
      .overrideProvider(PrismaService)
      .useValue(mockDeep<PrismaService>())
      .compile();

    service = module.get<GroupsService>(GroupsService);
    prisma = module.get(PrismaService);
  });

  const mockUser = {
    id: 'user-1',
    username: 'testuser',
    nickname: 'Test User',
    avatar: 'avatar.jpg',
    isOnline: true,
  };

  const mockUser2 = {
    id: 'user-2',
    username: 'testuser2',
    nickname: 'Test User 2',
    avatar: 'avatar2.jpg',
    isOnline: false,
  };

  const mockUser3 = {
    id: 'user-3',
    username: 'testuser3',
    nickname: 'Test User 3',
    avatar: 'avatar3.jpg',
    isOnline: true,
  };

  describe('createGroup', () => {
    it('should create group successfully', async () => {
      const createGroupDto = {
        name: 'Test Group',
        description: 'A test group',
        avatar: 'group.jpg',
        memberIds: ['user-2', 'user-3'],
      };

      const mockGroup = {
        id: 'group-1',
        name: 'Test Group',
        description: 'A test group',
        avatar: 'group.jpg',
        ownerId: 'user-1',
        isDissolved: false,
        owner: mockUser,
        members: [
          { userId: 'user-1', role: GroupRole.OWNER, user: mockUser },
          { userId: 'user-2', role: GroupRole.MEMBER, user: mockUser2 },
          { userId: 'user-3', role: GroupRole.MEMBER, user: mockUser3 },
        ],
      };

      prisma.user.findMany.mockResolvedValue([{ id: 'user-2' }, { id: 'user-3' }] as any);
      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          group: {
            create: jest.fn().mockResolvedValue(mockGroup),
          },
          conversation: {
            create: jest.fn().mockResolvedValue({ id: 'conv-1' }),
          },
        };
        return callback(tx as any);
      });

      const result = await service.createGroup('user-1', createGroupDto);

      expect(result.id).toBe('group-1');
      expect(result.conversationId).toBe('conv-1');
    });

    it('should throw NotFoundException when some users not found', async () => {
      const createGroupDto = {
        name: 'Test Group',
        description: 'A test group',
        avatar: 'group.jpg',
        memberIds: ['user-2', 'user-999'],
      };

      prisma.user.findMany.mockResolvedValue([{ id: 'user-2' }] as any);

      await expect(service.createGroup('user-1', createGroupDto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('dissolveGroup', () => {
    it('should dissolve group successfully', async () => {
      const mockGroup = {
        id: 'group-1',
        ownerId: 'user-1',
        isDissolved: false,
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      prisma.group.update.mockResolvedValue({ ...mockGroup, isDissolved: true } as any);

      const result = await service.dissolveGroup('user-1', 'group-1');

      expect(result.message).toBe('Group dissolved successfully');
    });

    it('should throw NotFoundException when group not found', async () => {
      prisma.group.findUnique.mockResolvedValue(null);

      await expect(service.dissolveGroup('user-1', 'group-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when group already dissolved', async () => {
      prisma.group.findUnique.mockResolvedValue({ id: 'group-1', isDissolved: true } as any);

      await expect(service.dissolveGroup('user-1', 'group-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw ForbiddenException when not the owner', async () => {
      prisma.group.findUnique.mockResolvedValue(
        { id: 'group-1', ownerId: 'user-2', isDissolved: false } as any,
      );

      await expect(service.dissolveGroup('user-1', 'group-1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('inviteMembers', () => {
    it('should invite members successfully as owner', async () => {
      const mockGroup = {
        id: 'group-1',
        isDissolved: false,
        members: [
          { userId: 'user-1', role: GroupRole.OWNER },
          { userId: 'user-2', role: GroupRole.MEMBER },
        ],
      };

      const inviteDto = { userIds: ['user-3', 'user-4'] };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      prisma.user.findMany.mockResolvedValue([{ id: 'user-3' }, { id: 'user-4' }] as any);
      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          groupMember: {
            createMany: jest.fn().mockResolvedValue({ count: 2 }),
          },
          conversation: {
            findFirst: jest.fn().mockResolvedValue({ id: 'conv-1' }),
          },
          conversationUser: {
            createMany: jest.fn().mockResolvedValue({ count: 2 }),
          },
          group: {
            findUnique: jest.fn().mockResolvedValue({ ...mockGroup, members: [] }),
          },
        };
        return callback(tx as any);
      });

      const result = await service.inviteMembers('user-1', 'group-1', inviteDto);

      expect(result.message).toBe('Members invited successfully');
      expect(result.added).toEqual(['user-3', 'user-4']);
    });

    it('should invite members successfully as admin', async () => {
      const mockGroup = {
        id: 'group-1',
        isDissolved: false,
        members: [
          { userId: 'user-1', role: GroupRole.ADMIN },
          { userId: 'user-2', role: GroupRole.MEMBER },
        ],
      };

      const inviteDto = { userIds: ['user-3'] };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      prisma.user.findMany.mockResolvedValue([{ id: 'user-3' }] as any);
      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          groupMember: {
            createMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          conversation: {
            findFirst: jest.fn().mockResolvedValue({ id: 'conv-1' }),
          },
          conversationUser: {
            createMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          group: {
            findUnique: jest.fn().mockResolvedValue({ ...mockGroup, members: [] }),
          },
        };
        return callback(tx as any);
      });

      const result = await service.inviteMembers('user-1', 'group-1', inviteDto);

      expect(result.message).toBe('Members invited successfully');
    });

    it('should return no new members when all users are already members', async () => {
      const mockGroup = {
        id: 'group-1',
        isDissolved: false,
        members: [
          { userId: 'user-1', role: GroupRole.OWNER },
          { userId: 'user-2', role: GroupRole.MEMBER },
        ],
      };

      const inviteDto = { userIds: ['user-2'] };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      const result = await service.inviteMembers('user-1', 'group-1', inviteDto);

      expect(result.message).toBe('No new members to invite');
      expect(result.added).toEqual([]);
    });

    it('should throw NotFoundException when group not found', async () => {
      prisma.group.findUnique.mockResolvedValue(null);

      await expect(
        service.inviteMembers('user-1', 'group-1', { userIds: ['user-2'] }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when not a group member', async () => {
      const mockGroup = {
        id: 'group-1',
        isDissolved: false,
        members: [{ userId: 'user-2', role: GroupRole.MEMBER }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(
        service.inviteMembers('user-1', 'group-1', { userIds: ['user-3'] }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when some users not found', async () => {
      const mockGroup = {
        id: 'group-1',
        isDissolved: false,
        members: [{ userId: 'user-1', role: GroupRole.OWNER }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      prisma.user.findMany.mockResolvedValue([]);

      await expect(
        service.inviteMembers('user-1', 'group-1', { userIds: ['user-999'] }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeMember', () => {
    it('should remove member successfully as owner', async () => {
      const mockGroup = {
        id: 'group-1',
        isDissolved: false,
        members: [
          { userId: 'user-1', role: GroupRole.OWNER },
          { userId: 'user-2', role: GroupRole.MEMBER },
        ],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          groupMember: {
            delete: jest.fn().mockResolvedValue({}),
          },
          conversation: {
            findFirst: jest.fn().mockResolvedValue({ id: 'conv-1' }),
          },
          conversationUser: {
            deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
        };
        return callback(tx as any);
      });

      const result = await service.removeMember('user-1', 'group-1', 'user-2');

      expect(result.message).toBe('Member removed successfully');
    });

    it('should throw NotFoundException when group not found', async () => {
      prisma.group.findUnique.mockResolvedValue(null);

      await expect(service.removeMember('user-1', 'group-1', 'user-2')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException when not a group member', async () => {
      const mockGroup = {
        id: 'group-1',
        isDissolved: false,
        members: [{ userId: 'user-2', role: GroupRole.MEMBER }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(service.removeMember('user-1', 'group-1', 'user-2')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw NotFoundException when target user is not a member', async () => {
      const mockGroup = {
        id: 'group-1',
        isDissolved: false,
        members: [{ userId: 'user-1', role: GroupRole.OWNER }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(service.removeMember('user-1', 'group-1', 'user-2')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException when regular member tries to remove others', async () => {
      const mockGroup = {
        id: 'group-1',
        isDissolved: false,
        members: [
          { userId: 'user-1', role: GroupRole.MEMBER },
          { userId: 'user-2', role: GroupRole.MEMBER },
        ],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(service.removeMember('user-1', 'group-1', 'user-2')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ForbiddenException when trying to remove owner', async () => {
      const mockGroup = {
        id: 'group-1',
        isDissolved: false,
        members: [
          { userId: 'user-1', role: GroupRole.OWNER },
          { userId: 'user-2', role: GroupRole.ADMIN },
        ],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(service.removeMember('user-2', 'group-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ForbiddenException when admin tries to remove another admin', async () => {
      const mockGroup = {
        id: 'group-1',
        isDissolved: false,
        members: [
          { userId: 'user-1', role: GroupRole.ADMIN },
          { userId: 'user-2', role: GroupRole.ADMIN },
        ],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(service.removeMember('user-1', 'group-1', 'user-2')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('leaveGroup', () => {
    it('should leave group successfully as member', async () => {
      const mockGroup = {
        id: 'group-1',
        isDissolved: false,
        members: [
          { userId: 'user-1', role: GroupRole.OWNER },
          { userId: 'user-2', role: GroupRole.MEMBER },
        ],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          groupMember: {
            delete: jest.fn().mockResolvedValue({}),
          },
          conversation: {
            findFirst: jest.fn().mockResolvedValue({ id: 'conv-1' }),
          },
          conversationUser: {
            deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
        };
        return callback(tx as any);
      });

      const result = await service.leaveGroup('user-2', 'group-1');

      expect(result.message).toBe('Left group successfully');
    });

    it('should throw NotFoundException when group not found', async () => {
      prisma.group.findUnique.mockResolvedValue(null);

      await expect(service.leaveGroup('user-1', 'group-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when not a group member', async () => {
      const mockGroup = {
        id: 'group-1',
        isDissolved: false,
        members: [{ userId: 'user-2', role: GroupRole.MEMBER }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(service.leaveGroup('user-1', 'group-1')).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when owner tries to leave', async () => {
      const mockGroup = {
        id: 'group-1',
        isDissolved: false,
        members: [{ userId: 'user-1', role: GroupRole.OWNER }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(service.leaveGroup('user-1', 'group-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('transferOwner', () => {
    it('should transfer ownership successfully', async () => {
      const mockGroup = {
        id: 'group-1',
        ownerId: 'user-1',
        isDissolved: false,
        members: [
          { userId: 'user-1', role: GroupRole.OWNER },
          { userId: 'user-2', role: GroupRole.MEMBER },
        ],
      };

      const transferDto = { newOwnerId: 'user-2' };
      const updatedGroup = {
        ...mockGroup,
        ownerId: 'user-2',
        owner: mockUser2,
        members: [
          { userId: 'user-1', role: GroupRole.MEMBER, user: mockUser },
          { userId: 'user-2', role: GroupRole.OWNER, user: mockUser2 },
        ],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          groupMember: {
            update: jest.fn().mockResolvedValue({}),
          },
          group: {
            update: jest.fn().mockResolvedValue(updatedGroup),
          },
        };
        return callback(tx as any);
      });

      const result = await service.transferOwner('user-1', 'group-1', transferDto);

      expect(result.ownerId).toBe('user-2');
    });

    it('should throw NotFoundException when group not found', async () => {
      prisma.group.findUnique.mockResolvedValue(null);

      await expect(
        service.transferOwner('user-1', 'group-1', { newOwnerId: 'user-2' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when not the owner', async () => {
      const mockGroup = {
        id: 'group-1',
        ownerId: 'user-2',
        isDissolved: false,
        members: [
          { userId: 'user-1', role: GroupRole.MEMBER },
          { userId: 'user-2', role: GroupRole.OWNER },
        ],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(
        service.transferOwner('user-1', 'group-1', { newOwnerId: 'user-3' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when transferring to yourself', async () => {
      const mockGroup = {
        id: 'group-1',
        ownerId: 'user-1',
        isDissolved: false,
        members: [{ userId: 'user-1', role: GroupRole.OWNER }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(
        service.transferOwner('user-1', 'group-1', { newOwnerId: 'user-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when new owner is not a member', async () => {
      const mockGroup = {
        id: 'group-1',
        ownerId: 'user-1',
        isDissolved: false,
        members: [{ userId: 'user-1', role: GroupRole.OWNER }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(
        service.transferOwner('user-1', 'group-1', { newOwnerId: 'user-2' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getGroup', () => {
    it('should get group successfully', async () => {
      const mockGroup = {
        id: 'group-1',
        name: 'Test Group',
        isDissolved: false,
        owner: mockUser,
        members: [
          { userId: 'user-1', role: GroupRole.OWNER, user: mockUser },
          { userId: 'user-2', role: GroupRole.MEMBER, user: mockUser2 },
        ],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      const result = await service.getGroup('user-1', 'group-1');

      expect(result.id).toBe('group-1');
    });

    it('should throw NotFoundException when group not found', async () => {
      prisma.group.findUnique.mockResolvedValue(null);

      await expect(service.getGroup('user-1', 'group-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when not a member', async () => {
      const mockGroup = {
        id: 'group-1',
        isDissolved: false,
        members: [{ userId: 'user-2', role: GroupRole.MEMBER }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(service.getGroup('user-1', 'group-1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getMyGroups', () => {
    it('should return user groups', async () => {
      const mockGroups = [
        {
          id: 'group-1',
          name: 'Group 1',
          owner: mockUser,
          members: [{ userId: 'user-1', role: GroupRole.OWNER, user: mockUser }],
        },
      ];

      prisma.group.findMany.mockResolvedValue(mockGroups as any);

      const result = await service.getMyGroups('user-1');

      expect(result).toHaveLength(1);
      expect(prisma.group.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { updatedAt: 'desc' },
        }),
      );
    });
  });

  describe('updateGroup', () => {
    it('should update group successfully as owner', async () => {
      const mockGroup = {
        id: 'group-1',
        name: 'Old Name',
        isDissolved: false,
        members: [{ userId: 'user-1', role: GroupRole.OWNER }],
      };
      const updateDto = { name: 'New Name', description: 'New desc' };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      prisma.group.update.mockResolvedValue({ ...mockGroup, ...updateDto, owner: mockUser, members: [] } as any);

      const result = await service.updateGroup('user-1', 'group-1', updateDto);

      expect(result.name).toBe('New Name');
    });

    it('should update group successfully as admin', async () => {
      const mockGroup = {
        id: 'group-1',
        name: 'Old Name',
        isDissolved: false,
        members: [{ userId: 'user-1', role: GroupRole.ADMIN }],
      };
      const updateDto = { name: 'New Name' };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      prisma.group.update.mockResolvedValue({ ...mockGroup, ...updateDto, owner: mockUser2, members: [] } as any);

      const result = await service.updateGroup('user-1', 'group-1', updateDto);

      expect(result.name).toBe('New Name');
    });

    it('should throw NotFoundException when group not found', async () => {
      prisma.group.findUnique.mockResolvedValue(null);

      await expect(service.updateGroup('user-1', 'group-1', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException when not a member', async () => {
      const mockGroup = {
        id: 'group-1',
        isDissolved: false,
        members: [{ userId: 'user-2', role: GroupRole.MEMBER }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(service.updateGroup('user-1', 'group-1', {})).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ForbiddenException when regular member tries to update', async () => {
      const mockGroup = {
        id: 'group-1',
        isDissolved: false,
        members: [{ userId: 'user-1', role: GroupRole.MEMBER }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(service.updateGroup('user-1', 'group-1', {})).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('createAnnouncement', () => {
    it('should create announcement as owner', async () => {
      const mockGroup = {
        id: 'group-1',
        isDissolved: false,
        members: [{ userId: 'user-1', role: GroupRole.OWNER }],
      };
      const dto = { title: 'Test Announcement', content: 'Content', isPinned: true };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      prisma.groupAnnouncement.create.mockResolvedValue({ id: 'ann-1', ...dto } as any);

      const result = await service.createAnnouncement('user-1', 'group-1', dto);

      expect(result.id).toBe('ann-1');
    });

    it('should create announcement as admin', async () => {
      const mockGroup = {
        id: 'group-1',
        isDissolved: false,
        members: [{ userId: 'user-1', role: GroupRole.ADMIN }],
      };
      const dto = { title: 'Test Announcement', content: 'Content' };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      prisma.groupAnnouncement.create.mockResolvedValue({ id: 'ann-1', ...dto } as any);

      const result = await service.createAnnouncement('user-1', 'group-1', dto);

      expect(result.id).toBe('ann-1');
    });

    it('should throw NotFoundException when group not found', async () => {
      prisma.group.findUnique.mockResolvedValue(null);

      await expect(
        service.createAnnouncement('user-1', 'group-1', { title: '', content: '' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when not a member', async () => {
      const mockGroup = {
        id: 'group-1',
        isDissolved: false,
        members: [{ userId: 'user-2', role: GroupRole.MEMBER }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(
        service.createAnnouncement('user-1', 'group-1', { title: '', content: '' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when regular member tries to create', async () => {
      const mockGroup = {
        id: 'group-1',
        isDissolved: false,
        members: [{ userId: 'user-1', role: GroupRole.MEMBER }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(
        service.createAnnouncement('user-1', 'group-1', { title: '', content: '' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getAnnouncements', () => {
    it('should get announcements as member', async () => {
      const mockGroup = {
        id: 'group-1',
        isDissolved: false,
        members: [{ userId: 'user-1' }],
      };
      const mockAnnouncements = [
        { id: 'ann-1', title: 'Announcement 1', isPinned: true },
      ];

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      prisma.groupAnnouncement.findMany.mockResolvedValue(mockAnnouncements as any);

      const result = await service.getAnnouncements('user-1', 'group-1');

      expect(result).toHaveLength(1);
    });

    it('should throw NotFoundException when group not found', async () => {
      prisma.group.findUnique.mockResolvedValue(null);

      await expect(service.getAnnouncements('user-1', 'group-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException when not a member', async () => {
      const mockGroup = {
        id: 'group-1',
        isDissolved: false,
        members: [],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(service.getAnnouncements('user-1', 'group-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('updateAnnouncement', () => {
    it('should update announcement as owner', async () => {
      const mockGroup = {
        id: 'group-1',
        isDissolved: false,
        members: [{ userId: 'user-1', role: GroupRole.OWNER }],
      };
      const dto = { title: 'Updated Title' };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      prisma.groupAnnouncement.update.mockResolvedValue({ id: 'ann-1', ...dto } as any);

      const result = await service.updateAnnouncement('user-1', 'group-1', 'ann-1', dto);

      expect(result.title).toBe('Updated Title');
    });

    it('should update announcement as admin', async () => {
      const mockGroup = {
        id: 'group-1',
        isDissolved: false,
        members: [{ userId: 'user-1', role: GroupRole.ADMIN }],
      };
      const dto = { content: 'Updated Content' };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      prisma.groupAnnouncement.update.mockResolvedValue({ id: 'ann-1', ...dto } as any);

      const result = await service.updateAnnouncement('user-1', 'group-1', 'ann-1', dto);

      expect(result.content).toBe('Updated Content');
    });

    it('should throw NotFoundException when group not found', async () => {
      prisma.group.findUnique.mockResolvedValue(null);

      await expect(
        service.updateAnnouncement('user-1', 'group-1', 'ann-1', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when not a member', async () => {
      const mockGroup = {
        id: 'group-1',
        isDissolved: false,
        members: [{ userId: 'user-2', role: GroupRole.MEMBER }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(
        service.updateAnnouncement('user-1', 'group-1', 'ann-1', {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when regular member tries to update', async () => {
      const mockGroup = {
        id: 'group-1',
        isDissolved: false,
        members: [{ userId: 'user-1', role: GroupRole.MEMBER }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(
        service.updateAnnouncement('user-1', 'group-1', 'ann-1', {}),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('deleteAnnouncement', () => {
    it('should delete announcement as owner', async () => {
      const mockGroup = {
        id: 'group-1',
        isDissolved: false,
        members: [{ userId: 'user-1', role: GroupRole.OWNER }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      prisma.groupAnnouncement.delete.mockResolvedValue({} as any);

      const result = await service.deleteAnnouncement('user-1', 'group-1', 'ann-1');

      expect(result.message).toBe('Announcement deleted successfully');
    });

    it('should delete announcement as admin', async () => {
      const mockGroup = {
        id: 'group-1',
        isDissolved: false,
        members: [{ userId: 'user-1', role: GroupRole.ADMIN }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);
      prisma.groupAnnouncement.delete.mockResolvedValue({} as any);

      const result = await service.deleteAnnouncement('user-1', 'group-1', 'ann-1');

      expect(result.message).toBe('Announcement deleted successfully');
    });

    it('should throw NotFoundException when group not found', async () => {
      prisma.group.findUnique.mockResolvedValue(null);

      await expect(service.deleteAnnouncement('user-1', 'group-1', 'ann-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException when not a member', async () => {
      const mockGroup = {
        id: 'group-1',
        isDissolved: false,
        members: [{ userId: 'user-2', role: GroupRole.MEMBER }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(service.deleteAnnouncement('user-1', 'group-1', 'ann-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ForbiddenException when regular member tries to delete', async () => {
      const mockGroup = {
        id: 'group-1',
        isDissolved: false,
        members: [{ userId: 'user-1', role: GroupRole.MEMBER }],
      };

      prisma.group.findUnique.mockResolvedValue(mockGroup as any);

      await expect(service.deleteAnnouncement('user-1', 'group-1', 'ann-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
