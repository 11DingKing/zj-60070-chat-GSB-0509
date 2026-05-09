import { IsString, IsNotEmpty, IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateAnnouncementDto {
  @ApiProperty({ description: '公告标题' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ description: '公告内容' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({ description: '是否置顶', required: false, default: false })
  @IsBoolean()
  @IsOptional()
  isPinned?: boolean;
}
