import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendFriendRequestDto {
  @ApiProperty({ description: '接收者用户ID' })
  @IsString()
  @IsNotEmpty()
  receiverId: string;

  @ApiProperty({ description: '验证消息', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  message?: string;
}
