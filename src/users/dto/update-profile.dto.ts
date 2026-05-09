import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiProperty({ description: '昵称', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  nickname?: string;

  @ApiProperty({ description: '头像URL', required: false })
  @IsString()
  @IsOptional()
  avatar?: string;

  @ApiProperty({ description: '个性签名', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  signature?: string;

  @ApiProperty({ description: '邮箱', required: false })
  @IsString()
  @IsOptional()
  email?: string;

  @ApiProperty({ description: '手机号', required: false })
  @IsString()
  @IsOptional()
  phone?: string;
}
