import { Controller, Get, Post, Delete, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ConversationsService } from './conversations.service';
import { GetCurrentUser } from '../common/decorators/get-current-user.decorator';

@ApiTags('Conversations')
@ApiBearerAuth()
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  @ApiOperation({ summary: '获取会话列表（按最后消息时间排序）' })
  async getConversations(@GetCurrentUser('userId') userId: string) {
    return this.conversationsService.getConversations(userId);
  }

  @Post(':conversationId/pin')
  @ApiOperation({ summary: '置顶会话' })
  async pinConversation(
    @GetCurrentUser('userId') userId: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.conversationsService.pinConversation(userId, conversationId);
  }

  @Post(':conversationId/unpin')
  @ApiOperation({ summary: '取消置顶会话' })
  async unpinConversation(
    @GetCurrentUser('userId') userId: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.conversationsService.unpinConversation(userId, conversationId);
  }

  @Post(':conversationId/mute')
  @ApiOperation({ summary: '免打扰会话' })
  async muteConversation(
    @GetCurrentUser('userId') userId: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.conversationsService.muteConversation(userId, conversationId);
  }

  @Post(':conversationId/unmute')
  @ApiOperation({ summary: '取消免打扰' })
  async unmuteConversation(
    @GetCurrentUser('userId') userId: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.conversationsService.unmuteConversation(userId, conversationId);
  }

  @Delete(':conversationId')
  @ApiOperation({ summary: '删除会话（仅对自己不可见）' })
  async deleteConversation(
    @GetCurrentUser('userId') userId: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.conversationsService.deleteConversation(userId, conversationId);
  }

  @Post(':conversationId/clear-unread')
  @ApiOperation({ summary: '清除会话未读数' })
  async clearUnreadCount(
    @GetCurrentUser('userId') userId: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.conversationsService.clearUnreadCount(userId, conversationId);
  }

  @Post('private/:targetUserId')
  @ApiOperation({ summary: '获取或创建与指定用户的私聊会话' })
  async getOrCreatePrivateConversation(
    @GetCurrentUser('userId') userId: string,
    @Param('targetUserId') targetUserId: string,
  ) {
    return this.conversationsService.getOrCreatePrivateConversation(userId, targetUserId);
  }
}
