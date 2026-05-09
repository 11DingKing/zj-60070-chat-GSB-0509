import { Injectable, NotFoundException, ForbiddenException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GroupRole } from '@prisma/client';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { InviteMembersDto } from './dto/invite-members.dto';
import { TransferOwnerDto } from './dto/transfer-owner.dto';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';

@Injectable()
export class GroupsService {
  constructor(private prisma: PrismaService) {}

  async createGroup(userId: string, dto: CreateGroupDto) {
    const uniqueMemberIds = [...new Set([...dto.memberIds])];
    
    const validMembers = await this.prisma.user.findMany({
      where: { id: { in: uniqueMemberIds } },
      select: { id: true },
    });

    if (validMembers.length !== uniqueMemberIds.length) {
      throw new NotFoundException('Some users not found');
    }

    return this.prisma.$transaction(async (prisma) => {
      const group = await prisma.group.create({
        data: {
          name: dto.name,
          description: dto.description,
          avatar: dto.avatar,
          ownerId: userId,
          members: {
            create: [
              { userId, role: GroupRole.OWNER },
              ...uniqueMemberIds.map((id) => ({ userId: id, role: GroupRole.MEMBER })),
            ],
          },
        },
        include: {
          owner: {
            select: {
              id: true,
              username: true,
              nickname: true,
              avatar: true,
            },
          },
          members: {
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

      const conversation = await prisma.conversation.create({
        data: {
          type: 'group',
          groupId: group.id,
          users: {
            create: [
              { userId },
              ...uniqueMemberIds.map((id) => ({ userId: id })),
            ],
          },
        },
      });

      return {
        ...group,
        conversationId: conversation.id,
      };
    });
  }

  async dissolveGroup(userId: string, groupId: string) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    if (group.isDissolved) {
      throw new BadRequestException('Group already dissolved');
    }

    if (group.ownerId !== userId) {
      throw new ForbiddenException('Only owner can dissolve the group');
    }

    await this.prisma.group.update({
      where: { id: groupId },
      data: {
        isDissolved: true,
        dissolvedAt: new Date(),
      },
    });

    return { message: 'Group dissolved successfully' };
  }

  async updateGroup(userId: string, groupId: string, dto: UpdateGroupDto) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId, isDissolved: false },
      include: {
        members: {
          where: { userId },
          select: { role: true },
        },
      },
    });

    if (!group) {
      throw new NotFoundException('Group not found or already dissolved');
    }

    const member = group.members[0];
    if (!member) {
      throw new ForbiddenException('Not a group member');
    }

    if (member.role !== GroupRole.OWNER && member.role !== GroupRole.ADMIN) {
      throw new ForbiddenException('Not authorized to update group');
    }

    return this.prisma.group.update({
      where: { id: groupId },
      data: dto,
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            nickname: true,
            avatar: true,
          },
        },
        members: {
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
  }

  async getGroup(userId: string, groupId: string) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId, isDissolved: false },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            nickname: true,
            avatar: true,
          },
        },
        members: {
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
      },
    });

    if (!group) {
      throw new NotFoundException('Group not found or already dissolved');
    }

    const isMember = group.members.some((m) => m.userId === userId);
    if (!isMember) {
      throw new ForbiddenException('Not a group member');
    }

    return group;
  }

  async getMyGroups(userId: string) {
    const groups = await this.prisma.group.findMany({
      where: {
        isDissolved: false,
        members: {
          some: { userId },
        },
      },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            nickname: true,
            avatar: true,
          },
        },
        members: {
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
      orderBy: { updatedAt: 'desc' },
    });

    return groups;
  }

  async inviteMembers(userId: string, groupId: string, dto: InviteMembersDto) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId, isDissolved: false },
      include: {
        members: {
          select: { userId: true, role: true },
        },
      },
    });

    if (!group) {
      throw new NotFoundException('Group not found or already dissolved');
    }

    const member = group.members.find((m) => m.userId === userId);
    if (!member) {
      throw new ForbiddenException('Not a group member');
    }

    const existingMemberIds = group.members.map((m) => m.userId);
    const newMemberIds = [...new Set(dto.userIds)].filter((id) => !existingMemberIds.includes(id));

    if (newMemberIds.length === 0) {
      return { message: 'No new members to invite', added: [], alreadyMembers: dto.userIds };
    }

    const validUsers = await this.prisma.user.findMany({
      where: { id: { in: newMemberIds } },
      select: { id: true },
    });

    if (validUsers.length !== newMemberIds.length) {
      throw new NotFoundException('Some users not found');
    }

    return this.prisma.$transaction(async (prisma) => {
      await prisma.groupMember.createMany({
        data: newMemberIds.map((id) => ({
          groupId,
          userId: id,
          role: GroupRole.MEMBER,
        })),
        skipDuplicates: true,
      });

      const conversation = await prisma.conversation.findFirst({
        where: { groupId },
      });

      if (conversation) {
        await prisma.conversationUser.createMany({
          data: newMemberIds.map((id) => ({
            conversationId: conversation.id,
            userId: id,
          })),
          skipDuplicates: true,
        });
      }

      const updatedGroup = await prisma.group.findUnique({
        where: { id: groupId },
        include: {
          members: {
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

      return {
        message: 'Members invited successfully',
        added: newMemberIds,
        group: updatedGroup,
      };
    });
  }

  async removeMember(userId: string, groupId: string, targetUserId: string) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId, isDissolved: false },
      include: {
        members: {
          select: { userId: true, role: true },
        },
      },
    });

    if (!group) {
      throw new NotFoundException('Group not found or already dissolved');
    }

    const operator = group.members.find((m) => m.userId === userId);
    if (!operator) {
      throw new ForbiddenException('Not a group member');
    }

    const target = group.members.find((m) => m.userId === targetUserId);
    if (!target) {
      throw new NotFoundException('Target user is not a group member');
    }

    if (operator.role === GroupRole.MEMBER && userId !== targetUserId) {
      throw new ForbiddenException('Only owner or admin can remove other members');
    }

    if (target.role === GroupRole.OWNER) {
      throw new ForbiddenException('Cannot remove owner');
    }

    if (operator.role === GroupRole.ADMIN && target.role === GroupRole.ADMIN) {
      throw new ForbiddenException('Admin cannot remove another admin');
    }

    return this.prisma.$transaction(async (prisma) => {
      await prisma.groupMember.delete({
        where: { groupId_userId: { groupId, userId: targetUserId } },
      });

      const conversation = await prisma.conversation.findFirst({
        where: { groupId },
      });

      if (conversation) {
        await prisma.conversationUser.deleteMany({
          where: {
            conversationId: conversation.id,
            userId: targetUserId,
          },
        });
      }

      return { message: 'Member removed successfully' };
    });
  }

  async leaveGroup(userId: string, groupId: string) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId, isDissolved: false },
      include: {
        members: {
          select: { userId: true, role: true },
        },
      },
    });

    if (!group) {
      throw new NotFoundException('Group not found or already dissolved');
    }

    const member = group.members.find((m) => m.userId === userId);
    if (!member) {
      throw new ForbiddenException('Not a group member');
    }

    if (member.role === GroupRole.OWNER) {
      throw new BadRequestException('Owner cannot leave group. Transfer ownership first or dissolve the group.');
    }

    return this.prisma.$transaction(async (prisma) => {
      await prisma.groupMember.delete({
        where: { groupId_userId: { groupId, userId } },
      });

      const conversation = await prisma.conversation.findFirst({
        where: { groupId },
      });

      if (conversation) {
        await prisma.conversationUser.deleteMany({
          where: {
            conversationId: conversation.id,
            userId,
          },
        });
      }

      return { message: 'Left group successfully' };
    });
  }

  async transferOwner(userId: string, groupId: string, dto: TransferOwnerDto) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId, isDissolved: false },
      include: {
        members: {
          select: { userId: true, role: true },
        },
      },
    });

    if (!group) {
      throw new NotFoundException('Group not found or already dissolved');
    }

    if (group.ownerId !== userId) {
      throw new ForbiddenException('Only owner can transfer ownership');
    }

    if (userId === dto.newOwnerId) {
      throw new BadRequestException('Cannot transfer ownership to yourself');
    }

    const newOwner = group.members.find((m) => m.userId === dto.newOwnerId);
    if (!newOwner) {
      throw new NotFoundException('Target user is not a group member');
    }

    return this.prisma.$transaction(async (prisma) => {
      await prisma.groupMember.update({
        where: { groupId_userId: { groupId, userId } },
        data: { role: GroupRole.MEMBER },
      });

      await prisma.groupMember.update({
        where: { groupId_userId: { groupId, userId: dto.newOwnerId } },
        data: { role: GroupRole.OWNER },
      });

      const updatedGroup = await prisma.group.update({
        where: { id: groupId },
        data: { ownerId: dto.newOwnerId },
        include: {
          owner: {
            select: {
              id: true,
              username: true,
              nickname: true,
              avatar: true,
            },
          },
          members: {
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

      return updatedGroup;
    });
  }

  async createAnnouncement(userId: string, groupId: string, dto: CreateAnnouncementDto) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId, isDissolved: false },
      include: {
        members: {
          where: { userId },
          select: { role: true },
        },
      },
    });

    if (!group) {
      throw new NotFoundException('Group not found or already dissolved');
    }

    const member = group.members[0];
    if (!member) {
      throw new ForbiddenException('Not a group member');
    }

    if (member.role !== GroupRole.OWNER && member.role !== GroupRole.ADMIN) {
      throw new ForbiddenException('Only owner or admin can create announcements');
    }

    return this.prisma.groupAnnouncement.create({
      data: {
        groupId,
        authorId: userId,
        title: dto.title,
        content: dto.content,
        isPinned: dto.isPinned || false,
      },
    });
  }

  async getAnnouncements(userId: string, groupId: string) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId, isDissolved: false },
      include: {
        members: {
          where: { userId },
          select: { userId: true },
        },
      },
    });

    if (!group) {
      throw new NotFoundException('Group not found or already dissolved');
    }

    if (!group.members.length) {
      throw new ForbiddenException('Not a group member');
    }

    return this.prisma.groupAnnouncement.findMany({
      where: { groupId },
      orderBy: [
        { isPinned: 'desc' },
        { createdAt: 'desc' },
      ],
    });
  }

  async updateAnnouncement(userId: string, groupId: string, announcementId: string, dto: Partial<CreateAnnouncementDto>) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId, isDissolved: false },
      include: {
        members: {
          where: { userId },
          select: { role: true },
        },
      },
    });

    if (!group) {
      throw new NotFoundException('Group not found or already dissolved');
    }

    const member = group.members[0];
    if (!member) {
      throw new ForbiddenException('Not a group member');
    }

    if (member.role !== GroupRole.OWNER && member.role !== GroupRole.ADMIN) {
      throw new ForbiddenException('Not authorized to update announcements');
    }

    return this.prisma.groupAnnouncement.update({
      where: { id: announcementId },
      data: dto,
    });
  }

  async deleteAnnouncement(userId: string, groupId: string, announcementId: string) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId, isDissolved: false },
      include: {
        members: {
          where: { userId },
          select: { role: true },
        },
      },
    });

    if (!group) {
      throw new NotFoundException('Group not found or already dissolved');
    }

    const member = group.members[0];
    if (!member) {
      throw new ForbiddenException('Not a group member');
    }

    if (member.role !== GroupRole.OWNER && member.role !== GroupRole.ADMIN) {
      throw new ForbiddenException('Not authorized to delete announcements');
    }

    await this.prisma.groupAnnouncement.delete({
      where: { id: announcementId },
    });

    return { message: 'Announcement deleted successfully' };
  }
}
