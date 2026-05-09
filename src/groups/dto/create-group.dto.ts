import { IsString, IsNotEmpty, IsOptional, IsArray, ArrayNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateGroupDto {
  @ApiProperty({ description: '群名称' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: '群描述', required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: '群头像URL', required: false })
  @IsString()
  @IsOptional()
  avatar?: string;

  @ApiProperty({ description: '初始成员ID列表（不包含群主自己）' })
  @IsArray()
  @ArrayNotEmpty()
  memberIds: string[];
}
