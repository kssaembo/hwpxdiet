import JSZip from 'jszip';
import { PDFDocument, PDFName, PDFNumber, PDFRef, PDFRawStream, PDFDict, PDFArray, PDFBool } from 'pdf-lib';
import { cancelled, encodeImage, identifyImage } from './image';
import { inflateBounded, unpackPixels } from './pdfPixels';
import type { Options, Progress, OptimizationResult } from '../types';

type Report = (value: Progress) => void;
interface ImageAsset { key: string; bytes: Uint8Array; mime: 'image/jpeg' | 'image/png' }
const yieldUI = () => new Promise<void>(resolve => window.setTimeout(resolve, 0));
const limitFile = (file: File) => { if (!file.size) throw new Error('비어 있는 파일입니다.'); if (file.size > 150 * 1024 * 1024) throw new Error('이 버전은 150MB 이하 파일을 지원합니다.'); };
const plan = (minimum: number) => [
  { quality: .86, side: 2600 }, { quality: .76, side: 2100 }, { quality: .65, side: 1700 },
  { quality: .53, side: 1350 }, { quality: .42, side: 1100 }, { quality: .32, side: 900 },
  { quality: .23, side: 700 }, { quality: .15, side: 500 },
].filter((step, i, steps) => i === 0 || Math.max(step.side, minimum) !== Math.max(steps[i - 1].side, minimum) || step.quality !== steps[i - 1].quality).map(step => ({ ...step, side: Math.max(minimum, step.side) }));

function result(file: File, best: Blob, target: number, changed: number, skipped: number, attempts: number, logs: string[]): OptimizationResult {
  const saved = Math.max(0, 100 * (1 - best.size / file.size));
  const achieved = best.size <= target;
  if (!achieved) logs.push('목표에 도달하지 못했습니다. 이미지 외 데이터, 보호된 이미지 또는 화질 하한이 제한 요인일 수 있습니다.');
  if (best === file) logs.push('더 작은 결과를 만들지 못해 원본 파일을 반환했습니다.');
  return { originalSize: file.size, compressedSize: best.size, blob: best, fileName: file.name, targetSize: target, achieved, reductionPercentage: saved, changedImages: changed, skippedImages: skipped, attempts, logs };
}

export async function optimizeZipBasedDoc(file: File, options: Options, report: Report): Promise<OptimizationResult> {
  limitFile(file); cancelled(options.signal);
  const target = Math.max(1, Math.floor(file.size * (1 - options.reduction / 100)));
  report({ percent: 2, message: '문서 구조와 이미지 확인 중' });
  const original = await JSZip.loadAsync(file);
  const names = Object.keys(original.files);
  if (names.length > 10000) throw new Error('문서 내부 파일 수가 너무 많습니다.');
  const estimated = Object.values(original.files).reduce((sum, entry) => sum + (Number((entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize) || 0), 0);
  if (estimated > 300 * 1024 * 1024) throw new Error('압축을 푼 데이터가 300MB를 넘습니다. 문서를 나눠 처리해 주세요.');
  if (/\.hwpx$/i.test(file.name) && !original.file('Contents/content.hpf')) throw new Error('HWPX 문서 구조를 확인하지 못했습니다.');
  if (/\.pptx$/i.test(file.name) && !original.file('[Content_Types].xml')) throw new Error('PPTX 문서 구조를 확인하지 못했습니다.');
  if (names.some(name => /(^|\/)(_xmlsignatures|signatures)(\/|\.)/i.test(name))) throw new Error('전자서명이 포함된 문서는 서명 보존을 위해 처리하지 않습니다.');
  const imageNames = names.filter(name => !original.files[name].dir && /\.(png|jpe?g|gif|bmp|webp|tiff?)$/i.test(name));
  if (imageNames.length > 500) throw new Error('이미지가 500개를 넘습니다. 문서를 나눠 처리해 주세요.');
  const assets: ImageAsset[] = [], logs: string[] = []; let skipped = 0;
  for (const name of imageNames) {
    cancelled(options.signal);
    if (!/\.(png|jpe?g)$/i.test(name) || options.protectPng && /\.png$/i.test(name)) { skipped++; continue; }
    const bytes = await original.file(name)!.async('uint8array');
    const mime = identifyImage(bytes);
    if (!mime || (mime === 'image/png') !== /\.png$/i.test(name)) { skipped++; logs.push(`형식 불일치 또는 미지원 이미지 원본 유지: ${name}`); continue; }
    assets.push({ key: name, bytes, mime });
  }
  let best: Blob = file, bestChanged = 0, attempts = 0;
  const steps = assets.length ? plan(options.minimumSide) : [{ quality: 1, side: 2600 }];
  const failed = new Set<string>();
  for (let pass = 0; pass < steps.length; pass++) {
    cancelled(options.signal); attempts++;
    const { quality, side } = steps[pass];
    const zip = new JSZip();
    // HWPX requires mimetype at the beginning, uncompressed.
    if (original.file('mimetype')) zip.file('mimetype', await original.file('mimetype')!.async('uint8array'), { compression: 'STORE' });
    for (const name of names) {
      if (name === 'mimetype') continue;
      const entry = original.files[name];
      zip.file(name, entry.async('uint8array'), { dir: entry.dir, date: entry.date, comment: entry.comment, unixPermissions: entry.unixPermissions, dosPermissions: entry.dosPermissions });
    }
    let changed = 0;
    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      cancelled(options.signal);
      report({ percent: 8 + Math.round((pass + i / Math.max(1, assets.length)) / steps.length * 85), message: `${pass + 1}차 조절 · 이미지 ${i + 1}/${assets.length}` });
      if (failed.has(asset.key)) continue;
      try {
        const encoded = await encodeImage(new Blob([asset.bytes], { type: asset.mime }), asset.mime, quality, side, options.signal);
        if (encoded.size < asset.bytes.length) { zip.file(asset.key, encoded, { date: original.files[asset.key].date }); changed++; }
      } catch (error) { cancelled(options.signal); failed.add(asset.key); logs.push(`원본 유지: ${asset.key} · ${String(error)}`); }
      await yieldUI();
    }
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } }, () => cancelled(options.signal));
    cancelled(options.signal);
    logs.push(`${attempts}차: 긴 변 ${side}px 상한, JPEG 품질 ${Math.round(quality * 100)}%, 결과 ${blob.size.toLocaleString()}바이트`);
    if (blob.size < best.size) { best = blob; bestChanged = changed; }
    if (best.size <= target) break;
  }
  report({ percent: 100, message: '처리 완료' });
  return result(file, best, target, bestChanged, skipped + failed.size, attempts, logs);
}

const nameOf = (object: unknown) => object instanceof PDFName ? object.decodeText() : '';
const numberOf = (object: unknown) => object instanceof PDFNumber ? object.asNumber() : 0;

async function pdfAsset(stream: PDFRawStream, doc: PDFDocument, key: string): Promise<ImageAsset> {
  const dict = stream.dict;
  const width = numberOf(dict.lookup(PDFName.of('Width'))), height = numberOf(dict.lookup(PDFName.of('Height')));
  const bits = numberOf(dict.lookup(PDFName.of('BitsPerComponent')));
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 20_000_000) throw new Error('이미지 크기 제한');
  if (dict.has(PDFName.of('Decode')) || dict.has(PDFName.of('SMask')) || dict.has(PDFName.of('Mask')) || dict.has(PDFName.of('SMaskInData')) || dict.has(PDFName.of('Alternates')) || dict.lookup(PDFName.of('ImageMask')) === PDFBool.True) throw new Error('투명도·마스크 또는 특수 이미지 보호');
  const color = nameOf(dict.lookup(PDFName.of('ColorSpace')));
  if (!['DeviceRGB', 'DeviceGray'].includes(color)) throw new Error('색 공간 원본 유지');
  let filter = dict.lookup(PDFName.of('Filter'));
  if (filter instanceof PDFArray) { if (filter.size() !== 1) throw new Error('복합 필터 원본 유지'); filter = filter.lookup(0); }
  const filterName = nameOf(filter);
  if (filter && !['FlateDecode', 'DCTDecode'].includes(filterName)) throw new Error('미지원 필터 원본 유지');
  if (filterName === 'DCTDecode') {
    if (bits !== 8 || dict.has(PDFName.of('DecodeParms'))) throw new Error('특수 JPEG 원본 유지');
    return { key, bytes: stream.getContents(), mime: 'image/jpeg' };
  }
  const components = color === 'DeviceRGB' ? 3 : 1;
  let params = dict.lookup(PDFName.of('DecodeParms'));
  if (params instanceof PDFArray) params = params.lookup(0);
  if (params && !(params instanceof PDFDict)) throw new Error('DecodeParms 원본 유지');
  let predictor = 1;
  if (params instanceof PDFDict) {
    predictor = numberOf(params.lookup(PDFName.of('Predictor'))) || 1;
    const columns = numberOf(params.lookup(PDFName.of('Columns'))) || 1;
    const colors = numberOf(params.lookup(PDFName.of('Colors'))) || 1;
    const depth = numberOf(params.lookup(PDFName.of('BitsPerComponent'))) || 8;
    if (predictor !== 1 && (columns !== width || colors !== components || depth !== bits)) throw new Error('Predictor 속성 불일치');
  }
  const expected = (Math.ceil(width * bits * components / 8) + (predictor >= 10 ? 1 : 0)) * height;
  const bytes = filterName === 'FlateDecode' ? inflateBounded(stream.getContents(), expected) : stream.getContents();
  const pixels = unpackPixels(bytes, width, height, bits, components, predictor);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  try {
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas 미지원');
    ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('이미지 추출 실패')), 'image/png'));
    return { key, bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png' };
  } finally { canvas.width = canvas.height = 0; }
}

export async function optimizePDF(file: File, options: Options, report: Report): Promise<OptimizationResult> {
  limitFile(file); cancelled(options.signal);
  const target = Math.max(1, Math.floor(file.size * (1 - options.reduction / 100)));
  report({ percent: 2, message: 'PDF 이미지와 문서 구조 확인 중' });
  const originalBytes = await file.arrayBuffer();
  let original: PDFDocument;
  try { original = await PDFDocument.load(originalBytes, { updateMetadata: false }); }
  catch { throw new Error('PDF를 읽지 못했습니다. 암호화·DRM 문서는 지원하지 않습니다.'); }
  const objects = original.context.enumerateIndirectObjects();
  if (objects.some(([, object]) => object instanceof PDFDict && (nameOf(object.lookup(PDFName.of('FT'))) === 'Sig' || object.has(PDFName.of('ByteRange'))))) throw new Error('전자서명 PDF는 서명 보존을 위해 처리하지 않습니다.');
  const protectedRefs = new Set<string>();
  for (const [, object] of objects) if (object instanceof PDFRawStream) for (const key of ['SMask', 'Mask']) {
    const ref = object.dict.get(PDFName.of(key)); if (ref instanceof PDFRef) protectedRefs.add(ref.toString());
  }
  const streams = objects.filter(([, object]) => object instanceof PDFRawStream && nameOf(object.dict.lookup(PDFName.of('Subtype'))) === 'Image') as [PDFRef, PDFRawStream][];
  if (streams.length > 500) throw new Error('PDF 이미지가 500개를 넘습니다. 문서를 나눠 처리해 주세요.');
  const assets: ImageAsset[] = [], logs: string[] = []; let skipped = 0, totalPixels = 0;
  for (let i = 0; i < streams.length; i++) {
    cancelled(options.signal);
    const [ref, stream] = streams[i];
    report({ percent: 3 + Math.round(i / Math.max(1, streams.length) * 17), message: `PDF 이미지 분석 ${i + 1}/${streams.length}` });
    try {
      if (protectedRefs.has(ref.toString())) throw new Error('투명도 마스크 원본 유지');
      if (options.protectPng && nameOf(stream.dict.lookup(PDFName.of('Filter'))) !== 'DCTDecode') throw new Error('무손실 이미지 보호 설정');
      totalPixels += numberOf(stream.dict.lookup(PDFName.of('Width'))) * numberOf(stream.dict.lookup(PDFName.of('Height')));
      if (totalPixels > 80_000_000) throw new Error('문서 전체 이미지 메모리 한도');
      assets.push(await pdfAsset(stream, original, ref.toString()));
    } catch (error) { skipped++; logs.push(`이미지 ${ref.toString()} 원본 유지: ${String(error)}`); }
    await yieldUI();
  }
  let best: Blob = file, bestChanged = 0, attempts = 0;
  const steps = assets.length ? plan(options.minimumSide) : [{ quality: 1, side: 2600 }];
  for (let pass = 0; pass < steps.length; pass++) {
    cancelled(options.signal); attempts++;
    const doc = await PDFDocument.load(originalBytes, { updateMetadata: false });
    const refs = new Map(doc.context.enumerateIndirectObjects().map(([ref, object]) => [ref.toString(), { ref, object }]));
    const { quality, side } = steps[pass]; let changed = 0;
    for (let i = 0; i < assets.length; i++) {
      cancelled(options.signal);
      const asset = assets[i], entry = refs.get(asset.key)!;
      report({ percent: 20 + Math.round((pass + i / Math.max(1, assets.length)) / steps.length * 75), message: `${pass + 1}차 조절 · PDF 이미지 ${i + 1}/${assets.length}` });
      try {
        const blob = await encodeImage(new Blob([asset.bytes], { type: asset.mime }), 'image/jpeg', quality, side, options.signal);
        const old = entry.object as PDFRawStream;
        if (blob.size >= old.getContents().length) continue;
        const embedded = await doc.embedJpg(await blob.arrayBuffer());
        await embedded.embed();
        const replacement = doc.context.lookup(embedded.ref);
        if (!(replacement instanceof PDFRawStream)) throw new Error('PDF 이미지 삽입 실패');
        // Retain only properties that remain meaningful for the new pixels.
        for (const key of ['Interpolate', 'Intent', 'OC']) {
          const value = old.dict.get(PDFName.of(key)); if (value) replacement.dict.set(PDFName.of(key), value);
        }
        doc.context.assign(entry.ref, replacement);
        // Avoid retaining a second copy of the same JPEG under its temporary ref.
        doc.context.delete(embedded.ref);
        changed++;
      } catch (error) { cancelled(options.signal); if (pass === 0) logs.push(`이미지 ${asset.key} 교체 생략: ${String(error)}`); }
      await yieldUI();
    }
    const bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
    cancelled(options.signal);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    logs.push(`${attempts}차: 긴 변 ${side}px 상한, JPEG 품질 ${Math.round(quality * 100)}%, 결과 ${blob.size.toLocaleString()}바이트`);
    if (blob.size < best.size) { best = blob; bestChanged = changed; }
    if (best.size <= target) break;
  }
  report({ percent: 100, message: '처리 완료' });
  return result(file, best, target, bestChanged, skipped, attempts, logs);
}
