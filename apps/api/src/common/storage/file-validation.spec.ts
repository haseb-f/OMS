import { BadRequestException } from '@nestjs/common';
import {
  ATTACHMENT_MAX_BYTES,
  validateAttachmentUpload,
} from './file-validation';

function jpeg(): Buffer {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xd9, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
}

function png(): Buffer {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
  ]);
}

function webp(): Buffer {
  return Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.from([0x10, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP'),
    Buffer.from([0, 0, 0, 0]),
  ]);
}

function pdf(): Buffer {
  return Buffer.from('%PDF-1.4\n%\n\n\n\n');
}

describe('validateAttachmentUpload', () => {
  it.each([
    ['image.jpg', jpeg(), 'image/jpeg'],
    ['shot.png', png(), 'image/png'],
    ['pic.webp', webp(), 'image/webp'],
    ['doc.pdf', pdf(), 'application/pdf'],
  ])('accepts %s', (name, buffer, mime) => {
    const result = validateAttachmentUpload({
      buffer,
      originalname: name,
      size: buffer.length,
    });
    expect(result.mimeType).toBe(mime);
    expect(result.originalName).toBe(name);
  });

  it('rejects empty files', () => {
    expect(() =>
      validateAttachmentUpload({
        buffer: Buffer.alloc(0),
        originalname: 'a.jpg',
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects executables and unknown types', () => {
    expect(() =>
      validateAttachmentUpload({
        buffer: Buffer.from('MZ'),
        originalname: 'malware.exe',
        size: 2,
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects oversized files', () => {
    const buffer = Buffer.concat([jpeg(), Buffer.alloc(ATTACHMENT_MAX_BYTES)]);
    expect(() =>
      validateAttachmentUpload({
        buffer,
        originalname: 'huge.jpg',
        size: buffer.length,
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects a mismatched extension even when magic bytes look valid', () => {
    expect(() =>
      validateAttachmentUpload({
        buffer: jpeg(),
        originalname: 'photo.exe',
        size: jpeg().length,
      }),
    ).toThrow(BadRequestException);
  });
});
