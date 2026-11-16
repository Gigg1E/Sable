/** Longest edge sent to models: big enough for detail, small enough to upload quickly over mobile data. */
const MAX_EDGE = 1600;
const KEEP_AS_IS = 1.5 * 1024 * 1024;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export interface Uploaded {
  id: string;
  mime: string;
  width: number | null;
  height: number | null;
}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close?: () => void }> {
  if ('createImageBitmap' in window) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* fall back to <img> (e.g. older Safari) */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Downscale and re-encode in the browser before uploading: phone photos (often HEIC or 10+ MB)
 * become a compact JPEG/PNG that every model provider accepts.
 */
export async function prepareImage(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name || 'That file'} isn't an image.`);
  const img = await decode(file).catch(() => {
    throw new Error(`Couldn't read ${file.name || 'that image'}. Try a JPEG or PNG.`);
  });
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  const width = Math.round(img.width * scale);
  const height = Math.round(img.height * scale);
  if (scale === 1 && ACCEPTED.includes(file.type) && file.size <= KEEP_AS_IS) {
    img.close?.();
    return { blob: file, width, height };
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img.source, 0, 0, width, height);
  img.close?.();
  // Keep PNG for screenshots/graphics (sharp text, transparency); JPEG for photos.
  const png = file.type === 'image/png' && file.size < 4 * 1024 * 1024;
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, png ? 'image/png' : 'image/jpeg', 0.86));
  if (!blob) throw new Error("Couldn't process that image.");
  return { blob, width, height };
}

export async function uploadImage(blob: Blob, width: number, height: number): Promise<Uploaded> {
  const res = await fetch('/api/uploads', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': blob.type || 'image/jpeg', 'X-Image-Width': String(width), 'X-Image-Height': String(height) },
    body: blob,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`);
  return data as Uploaded;
}

export const imageUrl = (id: string) => `/api/uploads/${id}`;
