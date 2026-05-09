import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Instant Messaging Backend Service is running!';
  }
}
