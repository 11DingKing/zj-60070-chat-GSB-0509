import { Controller, Post, Delete, Get, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { MessagesService } from './messages.service';
import { GetCurrentUser } from '../common/decorators/get-current-user.decorator';
import { ForwardMessageDto } from './dto/forward-message.dto';

@ApiTags('Messages')
@ApiBearerAuth()
@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post('recall/:messageId')
  @ApiOperation({ summary: '撤回消息（限2分钟内）' })
  async recallMessage(
    @GetCurrentUser('userId') userId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.messagesService.recallMessage(userId, messageId);
  }

  @Delete(':messageId')
  @ApiOperation({ summary: '删除消息（仅对自己不可见）' })
  async deleteMessage(
    @GetCurrentUser('userId') userId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.messagesService.deleteMessage(userId, messageId);
  }

  @Post('forward')
  @ApiOperation({ summary: '转发消息到其他会话' })
  async forwardMessages(
    @GetCurrentUser('userId') userId: string,
    @Body() dto: ForwardMessageDto,
  ) {
    return this.messagesService.forwardMessages(userId, dto);
  }

  @Get('conversation/:conversationId')
  @ApiOperation({ summary: '获取会话消息列表（分页）' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'before', required: false, type: String })
  async getConversationMessages(
    @GetCurrentUser('userId') userId: string,
    @Param('conversationId') conversationId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('before') before?: string,
  ) {
    const beforeDate = before ? new Date(before) : undefined;
    return this.messagesService.getConversationMessages(
      userId,
      conversationId,
      page || 1,
      limit || 50,
      beforeDate,
    );
  }

  @Get('search')
  @ApiOperation({ summary: '搜索聊天记录' })
  @ApiQuery({ name: 'keyword', required: true })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async searchMessages(
    @GetCurrentUser('userId') userId: string,
    @Query('keyword') keyword: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.messagesService.searchMessages(
      userId,
      keyword,
      page || 1,
      limit || 20,
    );
  }

  @Post('read')
  @ApiOperation({ summary: '标记消息为已读' })
  async markMessagesAsRead(
    @GetCurrentUser('userId') userId: string,
    @Body('messageIds') messageIds: string[],
  ) {
    return this.messagesService.markMessagesAsRead(userId, messageIds);
  }

  @Get('offline')
  @ApiOperation({ summary: '获取离线消息' })
  async getOfflineMessages(@GetCurrentUser('userId') userId: string) {
    return this.messagesService.getOfflineMessages(userId);
  }
}
