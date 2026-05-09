import { Controller, Get, Put, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { GetCurrentUser } from '../common/decorators/get-current-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: '获取当前用户信息' })
  async getCurrentUser(@GetCurrentUser('userId') userId: string) {
    return this.usersService.findById(userId);
  }

  @Put('me')
  @ApiOperation({ summary: '更新当前用户资料' })
  async updateProfile(
    @GetCurrentUser('userId') userId: string,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(userId, updateProfileDto);
  }

  @Get('search')
  @ApiOperation({ summary: '搜索用户' })
  async searchUsers(@Query('keyword') keyword: string) {
    return this.usersService.searchUsers(keyword);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取指定用户信息' })
  async getUserById(@Query('id') id: string) {
    return this.usersService.findById(id);
  }

  @Get(':id/status')
  @ApiOperation({ summary: '获取用户在线状态' })
  async getUserStatus(@Query('id') id: string) {
    return this.usersService.getOnlineStatus(id);
  }
}
