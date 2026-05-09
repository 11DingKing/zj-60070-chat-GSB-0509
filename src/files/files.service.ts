import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class FilesService {
  constructor(private prisma: PrismaService) {}

  async uploadFile(
    userId: string,
    file: Express.Multer.File,
  ) {
    const fileId = uuidv4();
    const ext = file.originalname.split('.').pop() || '';
    const fileName = `${fileId}.${ext}`;

    const fileRecord = await this.prisma.fileUpload.create({
      data: {
        id: fileId,
        userId,
        fileName: file.originalname,
        fileSize: file.size,
        fileType: file.mimetype,
        url: `/uploads/${fileName}`,
      },
    });

    return {
      id: fileRecord.id,
      fileName: fileRecord.fileName,
      fileSize: fileRecord.fileSize,
      fileType: fileRecord.fileType,
      url: fileRecord.url,
      thumbnailUrl: this.getThumbnailUrl(file.mimetype, fileRecord.url),
      createdAt: fileRecord.createdAt,
    };
  }

  async uploadMultipleFiles(
    userId: string,
    files: Express.Multer.File[],
  ) {
    const results = [];

    for (const file of files) {
      const result = await this.uploadFile(userId, file);
      results.push(result);
    }

    return results;
  }

  async getFile(userId: string, fileId: string) {
    const file = await this.prisma.fileUpload.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      return null;
    }

    return {
      id: file.id,
      fileName: file.fileName,
      fileSize: file.fileSize,
      fileType: file.fileType,
      url: file.url,
      thumbnailUrl: this.getThumbnailUrl(file.fileType, file.url),
      createdAt: file.createdAt,
    };
  }

  private getThumbnailUrl(fileType: string, originalUrl: string): string | null {
    if (fileType.startsWith('image/')) {
      return originalUrl;
    }
    return null;
  }
}
