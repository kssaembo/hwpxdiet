export function cancelled(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('취소되었습니다.', 'AbortError');
}
export async function encodeImage(blob: Blob, mime: 'image/jpeg' | 'image/png', quality: number, side: number, signal: AbortSignal): Promise<Blob> {
  cancelled(signal);
  const image = new Image();
  const url = URL.createObjectURL(blob);
  const canvas = document.createElement('canvas');
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve(); image.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
      image.src = url;
    });
    cancelled(signal);
    if (image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error('4천만 픽셀을 넘는 이미지는 원본을 유지합니다.');
    const scale = Math.min(1, side / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('이미지 처리 기능을 사용할 수 없습니다.');
    if (mime === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('이미지를 인코딩하지 못했습니다.')), mime, quality));
    cancelled(signal);
    if (result.type !== mime) throw new Error('요청한 이미지 형식을 지원하지 않는 브라우저입니다.');
    return result;
  } finally { URL.revokeObjectURL(url); canvas.width = canvas.height = 0; image.src = ''; }
}

// Only accepts formats actually supported by this encoder. The ZIP filename is
// also checked by the caller so the replacement can retain the original format.
export function identifyImage(bytes: Uint8Array): 'image/png' | 'image/jpeg' | null {
  if (bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  return null;
}
