import { MAX_COVER_LENGTH } from './domain.ts';

/** Decode locally and re-encode to a bounded raster; original file/EXIF are never stored. */
export async function prepareCoverPhoto(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('JPG, PNG, WebP 사진을 선택해 주세요.');
  if (file.size > 12 * 1024 * 1024) throw new Error('12MB 이하 사진을 선택해 주세요.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve(); image.onerror = () => reject(new Error('사진을 읽지 못했어요. 다른 사진을 선택해 주세요.')); image.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 48_000_000) throw new Error('사진 해상도가 너무 커요. 크기를 줄여 주세요.');
    const canvas = document.createElement('canvas');
    let size = 1280;
    while (size >= 500) {
      const scale = Math.min(1, size / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('이 브라우저에서 사진을 처리할 수 없어요.');
      ctx.fillStyle = '#f6f7f2'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.82, 0.68, 0.52]) {
        const data = canvas.toDataURL('image/webp', quality);
        if (!data.startsWith('data:image/webp;base64,')) throw new Error('이 브라우저는 사진 저장을 지원하지 않아요.');
        if (data.length <= MAX_COVER_LENGTH) return data;
      }
      size = Math.floor(size * 0.75);
    }
    throw new Error('사진을 충분히 줄이지 못했어요. 다른 사진을 선택해 주세요.');
  } finally { URL.revokeObjectURL(url); }
}
