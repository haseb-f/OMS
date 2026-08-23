import { BadRequestException } from '@nestjs/common';

export const ATTACHMENT_MAX_BYTES = Number(
  process.env.ATTACHMENT_MAX_BYTES ?? 10 * 1024 * 1024,
);

export const ALLOWED_ATTACHMENT_MIME = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
} as const;

export type AllowedAttachmentMime = keyof typeof ALLOWED_ATTACHMENT_MIME;

export interface ValidatedUpload {
  mimeType: AllowedAttachmentMime;
  extension: string;
  originalName: string;
  sizeBytes: number;
}

function sniffMime(buffer: Buffer): AllowedAttachmentMime | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buffer.toString('ascii', 0, 4) === '%PDF') {
    return 'application/pdf';
  }
  return null;
}

function extensionOf(originalName: string): string {
  const match = originalName.toLowerCase().match(/(\.[a-z0-9]+)$/);
  return match?.[1] ?? '';
}

export function validateAttachmentUpload(
  file:
    | {
        buffer?: Buffer;
        originalname?: string;
        size?: number;
        mimetype?: string;
      }
    | undefined,
): ValidatedUpload {
  if (!file?.buffer || file.buffer.length === 0) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'The uploaded file is empty.',
      fields: [{ field: 'file', constraints: ['empty'] }],
    });
  }
  const sizeBytes = file.size ?? file.buffer.length;
  if (sizeBytes > ATTACHMENT_MAX_BYTES) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'The uploaded file exceeds the maximum size.',
      fields: [{ field: 'file', constraints: ['max_size'] }],
    });
  }
  const sniffed = sniffMime(file.buffer);
  if (!sniffed) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Only JPG, PNG, WEBP, and PDF files are allowed.',
      fields: [{ field: 'file', constraints: ['mime'] }],
    });
  }
  const originalName = file.originalname?.trim() || `attachment`;
  const extension = extensionOf(originalName);
  const allowedExt = ALLOWED_ATTACHMENT_MIME[sniffed] as readonly string[];
  if (extension && !allowedExt.includes(extension)) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'The file extension does not match the file contents.',
      fields: [{ field: 'file', constraints: ['extension'] }],
    });
  }
  return {
    mimeType: sniffed,
    extension: extension || allowedExt[0],
    originalName,
    sizeBytes,
  };
}
