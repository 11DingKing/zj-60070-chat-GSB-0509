import { Controller, Post, Get, Put, Delete, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { GroupsService } from './groups.service';
import { GetCurrentUser } from '../common/decorators/get-current-user.decorator';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { InviteMembersDto } from './dto/invite-members.dto';
import { TransferOwnerDto } from './dto/transfer-owner.dto';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';

@ApiTags('Groups')
@ApiBearerAuth()
@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Post()
  @ApiOperation({ summary: '创建群聊' })
  async createGroup(
    @GetCurrentUser('userId') userId: string,
    @Body() dto: CreateGroupDto,
  ) {
    return this.groupsService.createGroup(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: '获取我加入的所有群聊' })
  async getMyGroups(@GetCurrentUser('userId') userId: string) {
    return this.groupsService.getMyGroups(userId);
  }

  @Get(':groupId')
  @ApiOperation({ summary: '获取群聊详情' })
  async getGroup(
    @GetCurrentUser('userId') userId: string,
    @Param('groupId') groupId: string,
  ) {
    return this.groupsService.getGroup(userId, groupId);
  }

  @Put(':groupId')
  @ApiOperation({ summary: '更新群聊信息' })
  async updateGroup(
    @GetCurrentUser('userId') userId: string,
    @Param('groupId') groupId: string,
    @Body() dto: UpdateGroupDto,
  ) {
    return this.groupsService.updateGroup(userId, groupId, dto);
  }

  @Post(':groupId/dissolve')
  @ApiOperation({ summary: '解散群聊（仅群主）' })
  async dissolveGroup(
    @GetCurrentUser('userId') userId: string,
    @Param('groupId') groupId: string,
  ) {
    return this.groupsService.dissolveGroup(userId, groupId);
  }

  @Post(':groupId/invite')
  @ApiOperation({ summary: '邀请成员加入群聊' })
  async inviteMembers(
    @GetCurrentUser('userId') userId: string,
    @Param('groupId') groupId: string,
    @Body() dto: InviteMembersDto,
  ) {
    return this.groupsService.inviteMembers(userId, groupId, dto);
  }

  @Delete(':groupId/members/:targetUserId')
  @ApiOperation({ summary: '移除群成员（仅群主/管理员）' })
  async removeMember(
    @GetCurrentUser('userId') userId: string,
    @Param('groupId') groupId: string,
    @Param('targetUserId') targetUserId: string,
  ) {
    return this.groupsService.removeMember(userId, groupId, targetUserId);
  }

  @Post(':groupId/leave')
  @ApiOperation({ summary: '退出群聊' })
  async leaveGroup(
    @GetCurrentUser('userId') userId: string,
    @Param('groupId') groupId: string,
  ) {
    return this.groupsService.leaveGroup(userId, groupId);
  }

  @Post(':groupId/transfer-owner')
  @ApiOperation({ summary: '转让群主（仅群主）' })
  async transferOwner(
    @GetCurrentUser('userId') userId: string,
    @Param('groupId') groupId: string,
    @Body() dto: TransferOwnerDto,
  ) {
    return this.groupsService.transferOwner(userId, groupId, dto);
  }

  @Post(':groupId/announcements')
  @ApiOperation({ summary: '创建群公告（仅群主/管理员）' })
  async createAnnouncement(
    @GetCurrentUser('userId') userId: string,
    @Param('groupId') groupId: string,
    @Body() dto: CreateAnnouncementDto,
  ) {
    return this.groupsService.createAnnouncement(userId, groupId, dto);
  }

  @Get(':groupId/announcements')
  @ApiOperation({ summary: '获取群公告列表' })
  async getAnnouncements(
    @GetCurrentUser('userId') userId: string,
    @Param('groupId') groupId: string,
  ) {
    return this.groupsService.getAnnouncements(userId, groupId);
  }

  @Put(':groupId/announcements/:announcementId')
  @ApiOperation({ summary: '更新群公告（仅群主/管理员）' })
  async updateAnnouncement(
    @GetCurrentUser('userId') userId: string,
    @Param('groupId') groupId: string,
    @Param('announcementId') announcementId: string,
    @Body() dto: Partial<CreateAnnouncementDto>,
  ) {
    return this.groupsService.updateAnnouncement(userId, groupId, announcementId, dto);
  }

  @Delete(':groupId/announcements/:announcementId')
  @ApiOperation({ summary: '删除群公告（仅群主/管理员）' })
  async deleteAnnouncement(
    @GetCurrentUser('userId') userId: string,
    @Param('groupId') groupId: string,
    @Param('announcementId') announcementId: string,
  ) {
    return this.groupsService.deleteAnnouncement(userId, groupId, announcementId);
  }
}
