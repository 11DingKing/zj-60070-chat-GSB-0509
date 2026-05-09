import { IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateGroupDto {
  @ApiProperty({ description: '群名称', required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ description: '群描述', required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: '群头像URL', required: false })
  @IsString()
  @IsOptional()
  avatar?: string;
}
