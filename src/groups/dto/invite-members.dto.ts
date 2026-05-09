import { IsArray, ArrayNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InviteMembersDto {
  @ApiProperty({ description: '要邀请的成员ID列表' })
  @IsArray()
  @ArrayNotEmpty()
  userIds: string[];
}
