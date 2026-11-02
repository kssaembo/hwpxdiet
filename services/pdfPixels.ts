import { Inflate } from 'pako';

export function inflateBounded(bytes: Uint8Array, maximum: number): Uint8Array {
  const chunks: Uint8Array[] = []; let length = 0;
  const decoder = new Inflate();
  decoder.onData = chunk => {
    const data = chunk as Uint8Array;
    length += data.length;
    if (length > maximum) throw new Error('PDF 이미지 데이터가 예상 크기를 초과했습니다.');
    chunks.push(data);
  };
  decoder.push(bytes, true);
  if (decoder.err) throw new Error('이미지 압축 데이터를 풀지 못했습니다.');
  const output = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

export function unpackPixels(bytes: Uint8Array, width: number, height: number, bits: number, components: number, predictor: number): Uint8ClampedArray {
  if (!(components === 1 && [1, 2, 4, 8].includes(bits)) && !(components === 3 && bits === 8)) throw new Error('지원하지 않는 비트 깊이입니다.');
  const rowBytes = Math.ceil(width * bits * components / 8);
  const filterBytes = predictor >= 10 && predictor <= 15 ? 1 : 0;
  if (predictor !== 1 && !filterBytes) throw new Error('지원하지 않는 Predictor입니다.');
  if (bytes.length !== (rowBytes + filterBytes) * height) throw new Error('이미지 데이터 길이가 일치하지 않습니다.');
  const raw = new Uint8Array(rowBytes * height);
  const bpp = Math.max(1, Math.ceil(bits * components / 8));
  for (let y = 0; y < height; y++) {
    const src = y * (rowBytes + filterBytes), dst = y * rowBytes;
    const filter = filterBytes ? bytes[src] : 0;
    if (filter > 4) throw new Error('유효하지 않은 PNG 필터입니다.');
    for (let x = 0; x < rowBytes; x++) {
      const a = x >= bpp ? raw[dst + x - bpp] : 0, b = y ? raw[dst + x - rowBytes] : 0, c = y && x >= bpp ? raw[dst + x - rowBytes - bpp] : 0;
      let add = 0;
      if (filter === 1) add = a;
      if (filter === 2) add = b;
      if (filter === 3) add = Math.floor((a + b) / 2);
      if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      raw[dst + x] = (bytes[src + filterBytes + x] + add) & 255;
    }
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  const mask = (1 << bits) - 1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (components === 3) { const src = y * rowBytes + x * 3; rgba[i] = raw[src]; rgba[i + 1] = raw[src + 1]; rgba[i + 2] = raw[src + 2]; }
    else { const bit = x * bits, value = (raw[y * rowBytes + (bit >> 3)] >> (8 - bits - (bit & 7))) & mask; rgba[i] = rgba[i + 1] = rgba[i + 2] = Math.round(value * 255 / mask); }
    rgba[i + 3] = 255;
  }
  return rgba;
}

