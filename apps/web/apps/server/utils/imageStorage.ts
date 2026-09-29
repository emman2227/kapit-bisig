import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export const VERIFICATION_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const VERIFICATION_IMAGE_PUBLIC_BASE_PATH = '/uploads/resident-verification';

const UPLOAD_DIR = process.env.VERIFICATION_IMAGE_UPLOAD_DIR
  ? path.resolve(process.env.VERIFICATION_IMAGE_UPLOAD_DIR)
  : path.resolve(__dirname, '../../public', VERIFICATION_IMAGE_PUBLIC_BASE_PATH.replace(/^\/uploads\//, 'uploads/'));

function ensureUploadDir(): void {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

function parseDataUrl(input: string): { mime: string; base64: string } | null {
  const match = input.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  return { mime: match[1], base64: match[2] };
}

function getExtFromMime(mime: string): string {
  switch (mime) {
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    default:
      return '.jpg';
  }
}

function getMimeFromFileName(fileName: string): string {
  switch (path.extname(fileName).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.jpeg':
    case '.jpg':
    default:
      return 'image/jpeg';
  }
}

/**
 * Persist base64 data-url images and return a static URL path.
 * If value is already a non-base64 reference, it is returned unchanged.
 */
export function persistVerificationImage(value: string, prefix: string): string {
  const raw = String(value || '').trim();
  const parsed = parseDataUrl(raw);
  if (!parsed) {
    return raw;
  }

  const buffer = Buffer.from(parsed.base64, 'base64');
  if (buffer.length > VERIFICATION_IMAGE_MAX_BYTES) {
    throw new Error(`Verification image exceeds the maximum size of ${Math.floor(VERIFICATION_IMAGE_MAX_BYTES / (1024 * 1024))}MB.`);
  }

  // Also best-effort write to local disk if directory is writable (cache)
  try {
    ensureUploadDir();
    const ext = getExtFromMime(parsed.mime);
    const fileName = `${prefix}-${Date.now()}-${crypto.randomUUID()}${ext}`;
    const absPath = path.join(UPLOAD_DIR, fileName);
    fs.writeFileSync(absPath, buffer);
  } catch {
    // Disk write error is non-fatal since the data URL is stored in MongoDB
  }

  // Return the data URL directly so it is stored in MongoDB Atlas,
  // making it durable across cloud container redeploys and accessible from any client
  return raw;
}

/**
 * Resolve a stored verification-image reference for an authenticated API
 * response. File-backed images are returned as data URLs so sensitive IDs do
 * not need a separate public static-file route.
 */
export function readVerificationImageAsDataUrl(value: string | undefined): string {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('data:image')) {
    return raw;
  }

  if (!raw.startsWith(`${VERIFICATION_IMAGE_PUBLIC_BASE_PATH}/`)) {
    return raw;
  }

  const fileName = path.basename(raw);
  const absolutePath = path.join(UPLOAD_DIR, fileName);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    return '';
  }

  const base64 = fs.readFileSync(absolutePath).toString('base64');
  return `data:${getMimeFromFileName(fileName)};base64,${base64}`;
}
