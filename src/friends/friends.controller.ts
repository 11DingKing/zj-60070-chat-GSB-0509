import { Controller, Post, Get, Delete, Body, Query, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FriendsService } from './friends.service';
import { GetCurrentUser } from '../common/decorators/get-current-user.decorator';
import { SendFriendRequestDto } from './dto/send-friend-request.dto';
import { HandleFriendRequestDto } from './dto/handle-friend-request.dto';

@ApiTags('Friends')
@ApiBearerAuth()
@Controller('friends')
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  @Post('request')
  @ApiOperation({ summary: '发送好友申请' })
  async sendFriendRequest(
    @GetCurrentUser('userId') userId: string,
    @Body() dto: SendFriendRequestDto,
  ) {
    return this.friendsService.sendFriendRequest(userId, dto);
  }

  @Post('request/handle')
  @ApiOperation({ summary: '处理好友申请' })
  async handleFriendRequest(
    @GetCurrentUser('userId') userId: string,
    @Body() dto: HandleFriendRequestDto,
  ) {
    return this.friendsService.handleFriendRequest(userId, dto);
  }

  @Get('requests/sent')
  @ApiOperation({ summary: '获取已发送的好友申请' })
  async getSentRequests(@GetCurrentUser('userId') userId: string) {
    return this.friendsService.getFriendRequests(userId, 'sent');
  }

  @Get('requests/received')
  @ApiOperation({ summary: '获取收到的好友申请' })
  async getReceivedRequests(@GetCurrentUser('userId') userId: string) {
    return this.friendsService.getFriendRequests(userId, 'received');
  }

  @Get()
  @ApiOperation({ summary: '获取好友列表' })
  async getFriends(@GetCurrentUser('userId') userId: string) {
    return this.friendsService.getFriends(userId);
  }

  @Delete(':friendId')
  @ApiOperation({ summary: '删除好友' })
  async deleteFriend(
    @GetCurrentUser('userId') userId: string,
    @Param('friendId') friendId: string,
  ) {
    return this.friendsService.deleteFriend(userId, friendId);
  }

  @Post('block/:blockedId')
  @ApiOperation({ summary: '拉黑用户' })
  async blockUser(
    @GetCurrentUser('userId') userId: string,
    @Param('blockedId') blockedId: string,
  ) {
    return this.friendsService.blockUser(userId, blockedId);
  }

  @Post('unblock/:blockedId')
  @ApiOperation({ summary: '取消拉黑' })
  async unblockUser(
    @GetCurrentUser('userId') userId: string,
    @Param('blockedId') blockedId: string,
  ) {
    return this.friendsService.unblockUser(userId, blockedId);
  }

  @Get('blocked')
  @ApiOperation({ summary: '获取拉黑列表' })
  async getBlockedUsers(@GetCurrentUser('userId') userId: string) {
    return this.friendsService.getBlockedUsers(userId);
  }

  @Get('check/:targetId')
  @ApiOperation({ summary: '检查与指定用户的关系' })
  async checkFriendship(
    @GetCurrentUser('userId') userId: string,
    @Param('targetId') targetId: string,
  ) {
    return this.friendsService.checkFriendship(userId, targetId);
  }
}
