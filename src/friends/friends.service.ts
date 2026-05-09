import { Injectable, BadRequestException, ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FriendRequestStatus } from '@prisma/client';
import { SendFriendRequestDto } from './dto/send-friend-request.dto';
import { HandleFriendRequestDto } from './dto/handle-friend-request.dto';

@Injectable()
export class FriendsService {
  constructor(private prisma: PrismaService) {}

  async sendFriendRequest(senderId: string, dto: SendFriendRequestDto) {
    if (senderId === dto.receiverId) {
      throw new BadRequestException('Cannot send friend request to yourself');
    }

    const receiver = await this.prisma.user.findUnique({
      where: { id: dto.receiverId },
    });

    if (!receiver) {
      throw new NotFoundException('Receiver not found');
    }

    const existingRequest = await this.prisma.friendRequest.findFirst({
      where: {
        OR: [
          { senderId, receiverId: dto.receiverId, status: FriendRequestStatus.PENDING },
          { senderId: dto.receiverId, receiverId: senderId, status: FriendRequestStatus.PENDING },
        ],
      },
    });

    if (existingRequest) {
      throw new ConflictException('Friend request already exists');
    }

    const isAlreadyFriend = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          { user1Id: senderId, user2Id: dto.receiverId },
          { user1Id: dto.receiverId, user2Id: senderId },
        ],
      },
    });

    if (isAlreadyFriend) {
      throw new ConflictException('Already friends');
    }

    const isBlocked = await this.prisma.blockedUser.findFirst({
      where: {
        OR: [
          { blockerId: senderId, blockedId: dto.receiverId },
          { blockerId: dto.receiverId, blockedId: senderId },
        ],
      },
    });

    if (isBlocked) {
      throw new ForbiddenException('Cannot send friend request');
    }

    const request = await this.prisma.friendRequest.create({
      data: {
        senderId,
        receiverId: dto.receiverId,
        message: dto.message,
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            nickname: true,
            avatar: true,
          },
        },
        receiver: {
          select: {
            id: true,
            username: true,
            nickname: true,
            avatar: true,
          },
        },
      },
    });

    return request;
  }

  async handleFriendRequest(userId: string, dto: HandleFriendRequestDto) {
    const request = await this.prisma.friendRequest.findUnique({
      where: { id: dto.requestId },
    });

    if (!request) {
      throw new NotFoundException('Friend request not found');
    }

    if (request.receiverId !== userId) {
      throw new ForbiddenException('Not authorized to handle this request');
    }

    if (request.status !== FriendRequestStatus.PENDING) {
      throw new BadRequestException('Friend request already handled');
    }

    if (dto.accept) {
      return this.prisma.$transaction(async (prisma) => {
        await prisma.friendRequest.update({
          where: { id: dto.requestId },
          data: { status: FriendRequestStatus.ACCEPTED },
        });

        const friendship = await prisma.friendship.create({
          data: {
            user1Id: request.senderId,
            user2Id: request.receiverId,
          },
          include: {
            user1: {
              select: {
                id: true,
                username: true,
                nickname: true,
                avatar: true,
                isOnline: true,
              },
            },
            user2: {
              select: {
                id: true,
                username: true,
                nickname: true,
                avatar: true,
                isOnline: true,
              },
            },
          },
        });

        return friendship;
      });
    } else {
      await this.prisma.friendRequest.update({
        where: { id: dto.requestId },
        data: { status: FriendRequestStatus.REJECTED },
      });

      return { message: 'Friend request rejected' };
    }
  }

  async getFriendRequests(userId: string, type: 'sent' | 'received') {
    const where = type === 'sent' 
      ? { senderId: userId, status: FriendRequestStatus.PENDING }
      : { receiverId: userId, status: FriendRequestStatus.PENDING };

    const requests = await this.prisma.friendRequest.findMany({
      where,
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            nickname: true,
            avatar: true,
          },
        },
        receiver: {
          select: {
            id: true,
            username: true,
            nickname: true,
            avatar: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return requests;
  }

  async getFriends(userId: string) {
    const friendships = await this.prisma.friendship.findMany({
      where: {
        OR: [
          { user1Id: userId },
          { user2Id: userId },
        ],
      },
      include: {
        user1: {
          select: {
            id: true,
            username: true,
            nickname: true,
            avatar: true,
            signature: true,
            isOnline: true,
            lastOnlineAt: true,
          },
        },
        user2: {
          select: {
            id: true,
            username: true,
            nickname: true,
            avatar: true,
            signature: true,
            isOnline: true,
            lastOnlineAt: true,
          },
        },
      },
    });

    const friends = friendships.map((f) => {
      const friend = f.user1Id === userId ? f.user2 : f.user1;
      return {
        ...friend,
        friendshipId: f.id,
        createdAt: f.createdAt,
      };
    });

    return friends;
  }

  async deleteFriend(userId: string, friendId: string) {
    const friendship = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          { user1Id: userId, user2Id: friendId },
          { user1Id: friendId, user2Id: userId },
        ],
      },
    });

    if (!friendship) {
      throw new NotFoundException('Friendship not found');
    }

    await this.prisma.friendship.delete({
      where: { id: friendship.id },
    });

    return { message: 'Friend deleted successfully' };
  }

  async blockUser(userId: string, blockedId: string) {
    if (userId === blockedId) {
      throw new BadRequestException('Cannot block yourself');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: blockedId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const existingBlock = await this.prisma.blockedUser.findUnique({
      where: { blockerId_blockedId: { blockerId: userId, blockedId } },
    });

    if (existingBlock) {
      throw new ConflictException('User already blocked');
    }

    await this.prisma.friendship.deleteMany({
      where: {
        OR: [
          { user1Id: userId, user2Id: blockedId },
          { user1Id: blockedId, user2Id: userId },
        ],
      },
    });

    await this.prisma.blockedUser.create({
      data: {
        blockerId: userId,
        blockedId,
      },
    });

    return { message: 'User blocked successfully' };
  }

  async unblockUser(userId: string, blockedId: string) {
    const blocked = await this.prisma.blockedUser.findUnique({
      where: { blockerId_blockedId: { blockerId: userId, blockedId } },
    });

    if (!blocked) {
      throw new NotFoundException('User is not blocked');
    }

    await this.prisma.blockedUser.delete({
      where: { blockerId_blockedId: { blockerId: userId, blockedId } },
    });

    return { message: 'User unblocked successfully' };
  }

  async getBlockedUsers(userId: string) {
    const blocked = await this.prisma.blockedUser.findMany({
      where: { blockerId: userId },
      include: {
        blocked: {
          select: {
            id: true,
            username: true,
            nickname: true,
            avatar: true,
          },
        },
      },
    });

    return blocked.map((b) => b.blocked);
  }

  async checkFriendship(userId: string, targetId: string) {
    if (userId === targetId) {
      return { relationship: 'self', isFriend: false, isBlocked: false };
    }

    const isFriend = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          { user1Id: userId, user2Id: targetId },
          { user1Id: targetId, user2Id: userId },
        ],
      },
    });

    const isBlocked = await this.prisma.blockedUser.findFirst({
      where: {
        OR: [
          { blockerId: userId, blockedId: targetId },
          { blockerId: targetId, blockedId: userId },
        ],
      },
    });

    const hasPendingRequest = await this.prisma.friendRequest.findFirst({
      where: {
        OR: [
          { senderId: userId, receiverId: targetId, status: FriendRequestStatus.PENDING },
          { senderId: targetId, receiverId: userId, status: FriendRequestStatus.PENDING },
        ],
      },
    });

    let relationship = 'stranger';
    if (isBlocked) {
      relationship = isBlocked.blockerId === userId ? 'blocking' : 'blocked';
    } else if (isFriend) {
      relationship = 'friend';
    } else if (hasPendingRequest) {
      relationship = hasPendingRequest.senderId === userId ? 'request_sent' : 'request_received';
    }

    return {
      relationship,
      isFriend: !!isFriend,
      isBlocked: !!isBlocked,
      hasPendingRequest: !!hasPendingRequest,
    };
  }
}
