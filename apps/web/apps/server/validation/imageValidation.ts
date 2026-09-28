import sharp from 'sharp';

type AllowedMime = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ImageValidationOptions {
  fieldName: string;
  maxBytes: number;
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
}

function stripDataUrlPrefix(input: string): string {
  const marker = 'base64,';
  const idx = input.indexOf(marker);
  if (idx === -1) return input;
  return input.slice(idx + marker.length);
}

function detectMime(buffer: Buffer): AllowedMime | null {
  // JPEG
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  // WebP (RIFF....WEBP)
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export async function validateBase64Image(
  base64Input: unknown,
  options: ImageValidationOptions,
): Promise<{ ok: true; mime: AllowedMime; width: number; height: number } | { ok: false; message: string }> {
  const {
    fieldName,
    maxBytes,
    minWidth,
    minHeight,
    maxWidth,
    maxHeight,
  } = options;

  if (typeof base64Input !== 'string' || base64Input.trim().length === 0) {
    return { ok: false, message: `${fieldName} is required.` };
  }

  const payload = stripDataUrlPrefix(base64Input.trim());
  let buffer: Buffer;
  try {
    buffer = Buffer.from(payload, 'base64');
  } catch {
    return { ok: false, message: `${fieldName} must be a valid base64 image.` };
  }

  if (!buffer || buffer.length === 0) {
    return { ok: false, message: `${fieldName} must be a valid base64 image.` };
  }

  if (buffer.length > maxBytes) {
    return {
      ok: false,
      message: `${fieldName} exceeds the maximum size of ${Math.floor(maxBytes / (1024 * 1024))}MB.`,
    };
  }

  const mime = detectMime(buffer);
  if (!mime) {
    return { ok: false, message: `${fieldName} must be JPEG, PNG, or WebP.` };
  }

  let width = 0;
  let height = 0;
  try {
    const metadata = await sharp(buffer).metadata();
    width = metadata.width || 0;
    height = metadata.height || 0;
  } catch {
    return { ok: false, message: `${fieldName} has invalid image data.` };
  }

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { ok: false, message: `${fieldName} has invalid dimensions.` };
  }

  if (width < minWidth || height < minHeight) {
    return {
      ok: false,
      message: `${fieldName} dimensions are too small. Minimum is ${minWidth}x${minHeight}.`,
    };
  }

  if (width > maxWidth || height > maxHeight) {
    return {
      ok: false,
      message: `${fieldName} dimensions are too large. Maximum is ${maxWidth}x${maxHeight}.`,
    };
  }

  return { ok: true, mime, width, height };
}
