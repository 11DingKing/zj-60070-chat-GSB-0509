import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TransferOwnerDto {
  @ApiProperty({ description: '新群主用户ID' })
  @IsString()
  @IsNotEmpty()
  newOwnerId: string;
}
