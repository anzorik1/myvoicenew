import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomBytes } from 'node:crypto';
import { access, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Response } from 'express';
import sharp from 'sharp';
import { AdminAuthGuard, AuthRequest } from './common';
import { PrismaService } from './prisma.service';

type UploadedImage = {
  buffer: Buffer;
  size: number;
};

const uploadDirectory = () => resolve(process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads'));

@Controller('media')
export class MediaController {
  @Get(':filename')
  async image(@Param('filename') filename: string, @Res() response: Response) {
    if (!/^[a-f0-9]{48}\.webp$/.test(filename)) throw new NotFoundException('Image not found');
    const directory = uploadDirectory();
    try {
      await access(join(directory, filename));
    } catch {
      throw new NotFoundException('Image not found');
    }
    response.setHeader('cache-control', 'public, max-age=31536000, immutable');
    response.type('image/webp');
    response.sendFile(filename, { root: directory });
  }
}

@Controller('admin/media')
@UseGuards(AdminAuthGuard)
export class AdminMediaController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('images')
  @UseInterceptors(FileInterceptor('image', { limits: { files: 1, fileSize: 5 * 1024 * 1024 } }))
  async uploadImage(@Req() req: AuthRequest, @UploadedFile() file?: UploadedImage) {
    if (!file?.buffer?.length) throw new BadRequestException('Choose an image to upload');
    let metadata: sharp.Metadata;
    try {
      metadata = await sharp(file.buffer, {
        limitInputPixels: 40_000_000,
        failOn: 'warning',
      }).metadata();
    } catch {
      throw new BadRequestException('The file is not a valid image');
    }
    if (!metadata.format || !['jpeg', 'png', 'webp'].includes(metadata.format)) {
      throw new BadRequestException('Only JPEG, PNG, and WebP images are supported');
    }
    if ((metadata.pages ?? 1) > 1)
      throw new BadRequestException('Animated images are not supported');
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > 40_000_000) {
      throw new BadRequestException('Image dimensions are too large');
    }
    const directory = uploadDirectory();
    await mkdir(directory, { recursive: true });
    const filename = `${randomBytes(24).toString('hex')}.webp`;
    const output = await sharp(file.buffer, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 84, effort: 5 })
      .toFile(join(directory, filename));
    const url = `/api/media/${filename}`;
    await this.prisma.adminAuditLog.create({
      data: {
        adminId: req.adminId!,
        action: 'MEDIA_IMAGE_UPLOAD',
        entityType: 'MediaAsset',
        entityId: filename,
        after: {
          url,
          width: output.width,
          height: output.height,
          bytes: output.size,
        },
      },
    });
    return { url, width: output.width, height: output.height, bytes: output.size };
  }
}
