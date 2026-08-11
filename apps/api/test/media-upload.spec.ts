import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { AdminMediaController } from '../src/media.controller';

describe('admin image uploads', () => {
  let directory = '';

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'myvoice-media-'));
    process.env.UPLOAD_DIR = directory;
  });

  afterEach(async () => {
    delete process.env.UPLOAD_DIR;
    await rm(directory, { recursive: true, force: true });
  });

  test('normalizes an uploaded image to metadata-free WebP', async () => {
    const audit = jest.fn().mockResolvedValue({});
    const prisma = { adminAuditLog: { create: audit } };
    const controller = new AdminMediaController(prisma as never);
    const input = await sharp({
      create: { width: 2200, height: 1100, channels: 4, background: '#18a892' },
    })
      .png()
      .toBuffer();

    const result = await controller.uploadImage(
      { adminId: '00000000-0000-4000-8000-000000000001' } as never,
      { buffer: input, size: input.length },
    );

    expect(result.url).toMatch(/^\/api\/media\/[a-f0-9]{48}\.webp$/);
    expect(result.width).toBe(1600);
    expect(result.height).toBe(800);
    const output = await readFile(join(directory, result.url.split('/').at(-1)!));
    await expect(sharp(output).metadata()).resolves.toMatchObject({ format: 'webp' });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'MEDIA_IMAGE_UPLOAD' }) }),
    );
  });

  test('rejects a non-image payload', async () => {
    const controller = new AdminMediaController({ adminAuditLog: { create: jest.fn() } } as never);
    const buffer = Buffer.from('not an image');
    await expect(
      controller.uploadImage({ adminId: 'admin' } as never, { buffer, size: buffer.length }),
    ).rejects.toThrow('valid image');
  });
});
