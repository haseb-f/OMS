import type { Response } from 'express';

const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Streams a generated Excel template as a download. */
export function sendWorkbook(
  res: Response,
  { buffer, fileName }: { buffer: Buffer; fileName: string },
) {
  res.setHeader('Content-Type', XLSX_TYPE);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(buffer);
}
