export const ORDER_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export const ORDER_ATTACHMENT_ACCEPT =
  "image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".pdf"]);

function extensionOf(name: string): string {
  const match = name.toLowerCase().match(/(\.[a-z0-9]+)$/);
  return match?.[1] ?? "";
}

export type OrderAttachmentClientError = "empty" | "type" | "size";

export function validateOrderAttachmentFile(file: File): OrderAttachmentClientError | null {
  if (file.size <= 0) return "empty";
  if (file.size > ORDER_ATTACHMENT_MAX_BYTES) return "size";
  const ext = extensionOf(file.name);
  const mimeOk = file.type ? ALLOWED_MIME.has(file.type) : false;
  const extOk = ext ? ALLOWED_EXT.has(ext) : false;
  if (!mimeOk && !extOk) return "type";
  return null;
}

export function isImageAttachmentMime(mime: string | null | undefined): boolean {
  return Boolean(mime?.startsWith("image/"));
}
