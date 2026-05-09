import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MessageType } from '@prisma/client';

export class SendMessageDto {
  @ApiProperty({ description: '接收者用户ID（单聊时使用）', required: false })
  @IsString()
  @IsOptional()
  receiverId?: string;

  @ApiProperty({ description: '群聊ID（群聊时使用）', required: false })
  @IsString()
  @IsOptional()
  groupId?: string;

  @ApiProperty({ description: '消息类型', enum: MessageType })
  @IsEnum(MessageType)
  @IsNotEmpty()
  type: MessageType;

  @ApiProperty({ description: '消息内容' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({ description: '缩略图URL（图片消息时使用）', required: false })
  @IsString()
  @IsOptional()
  thumbnailUrl?: string;
}
