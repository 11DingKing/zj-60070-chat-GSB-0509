import { IsString, IsNotEmpty, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class HandleFriendRequestDto {
  @ApiProperty({ description: '好友申请ID' })
  @IsString()
  @IsNotEmpty()
  requestId: string;

  @ApiProperty({ description: '是否接受' })
  @IsBoolean()
  accept: boolean;
}
