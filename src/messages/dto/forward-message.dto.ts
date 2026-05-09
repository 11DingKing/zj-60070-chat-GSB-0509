import { IsString, IsNotEmpty, IsArray, ArrayNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ForwardMessageDto {
  @ApiProperty({ description: '要转发的消息ID数组' })
  @IsArray()
  @ArrayNotEmpty()
  messageIds: string[];

  @ApiProperty({ description: '目标会话ID列表' })
  @IsArray()
  @ArrayNotEmpty()
  targetConversationIds: string[];
}
