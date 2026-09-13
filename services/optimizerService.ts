
import JSZip from 'jszip';
import { PDFDocument, PDFName, PDFRawStream, PDFDict, PDFRef } from 'pdf-lib';
import pako from 'pako';
import { OptimizationResult } from '../types';

/**
 * Compresses an image blob using Canvas API while preserving transparency for PNG/GIF
 */
interface EncodedImage {
  blob: Blob;
  width: number;
  height: number;
}

const getMaxDimension = (quality: number): number => {
  if (quality <= 20) return 640;
  if (quality <= 45) return 840;
  if (quality <= 60) return 1024;
  if (quality <= 75) return 1280;
  if (quality <= 85) return 1600;
  if (quality <= 95) return 2048;
  return 3072;
};

async function compressImage(
  blob: Blob,
  quality: number,
  forceFormat?: string,
  maxDimension?: number
): Promise<EncodedImage> {
  const originalType = blob.type;
  const isPng = originalType.includes('png');
  const targetMime = forceFormat || (isPng ? 'image/png' : 'image/jpeg');
  
  const objectUrl = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        return reject(new Error('Canvas context failed'));
      }

      const maxDim = maxDimension ?? getMaxDimension(quality);

      // Max dimension check (Downscaling)
      let targetWidth = img.width;
      let targetHeight = img.height;
      if (img.width > maxDim || img.height > maxDim) {
        const ratio = Math.min(maxDim / img.width, maxDim / img.height);
        targetWidth = Math.round(img.width * ratio);
        targetHeight = Math.round(img.height * ratio);
      }

      canvas.width = targetWidth;
      canvas.height = targetHeight;

      if (targetMime === 'image/jpeg') {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, targetWidth, targetHeight);
      }

      ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, targetWidth, targetHeight);

      canvas.toBlob(
        (compressed) => {
          URL.revokeObjectURL(objectUrl);
          if (compressed) resolve({ blob: compressed, width: targetWidth, height: targetHeight });
          else reject(new Error('Compression failed'));
        },
        targetMime,
        quality / 100
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image for compression'));
    };
    img.src = objectUrl;
  });
}

/**
 * Optimized ZIP-based documents (HWPX, PPTX, SHOW)
 */
export const optimizeZipBasedDoc = async (
  file: File, 
  quality: number, 
  skipPng: boolean, // New option added
  onProgress: (progress: number) => void
): Promise<OptimizationResult> => {
  const originalSize = file.size;
  const logs: string[] = [`Starting optimization for: ${file.name}`];
  
  onProgress(5);
  const zip = await JSZip.loadAsync(file);
  
  const imageFiles = Object.keys(zip.files).filter(path => 
    /\.(jpe?g|png|gif|bmp)$/i.test(path)
  );

  logs.push(`Found ${imageFiles.length} images.`);

  if (imageFiles.length === 0) {
    onProgress(100);
    return {
      originalSize,
      compressedSize: originalSize,
      fileName: file.name,
      reductionPercentage: 0,
      blob: file,
      optimizationLogs: logs
    };
  }

  for (let i = 0; i < imageFiles.length; i++) {
    const path = imageFiles[i];
    
    // SKIP PNG if requested
    if (skipPng && path.toLowerCase().endsWith('.png')) {
      logs.push(`Skipping PNG as requested: ${path}`);
      continue;
    }

    const originalImage = zip.files[path];
    const extension = path.split('.').pop()?.toLowerCase();
    const mimeType = extension === 'png'
      ? 'image/png'
      : extension === 'gif'
        ? 'image/gif'
        : extension === 'bmp'
          ? 'image/bmp'
          : 'image/jpeg';
    const imageBytes = new Blob([await originalImage.async('uint8array')], { type: mimeType });
    
    try {
      const compressedImage = await compressImage(imageBytes, quality);
      if (compressedImage.blob.size < imageBytes.size) {
        // Keep the original file extension and its declared package content type valid.
        const sourceExt = path.split('.').pop()?.toLowerCase();
        const encodedExt = compressedImage.blob.type === 'image/jpeg' ? 'jpeg' : 'png';
        const extensionMatches = sourceExt === encodedExt || (sourceExt === 'jpg' && encodedExt === 'jpeg');
        if (extensionMatches) {
          zip.file(path, compressedImage.blob);
        } else {
          logs.push(`Skipping ${path}: recompression would change the image format without updating document relationships.`);
        }
      }
    } catch (e) {
      console.error(`Error processing ${path}: ${e}`);
    }
    
    const currentProgress = 10 + Math.round((i + 1) / imageFiles.length * 80);
    onProgress(currentProgress);
  }

  // HWPX packages expect the mimetype entry to remain uncompressed.
  const mimetypeEntry = zip.file('mimetype');
  if (mimetypeEntry) {
    zip.file('mimetype', await mimetypeEntry.async('uint8array'), { compression: 'STORE' });
  }

  const resultBlob = await zip.generateAsync({ 
    type: 'blob', 
    compression: "DEFLATE", 
    compressionOptions: { level: 9 } 
  });
  onProgress(100);
  
  return {
    originalSize,
    compressedSize: resultBlob.size,
    fileName: file.name,
    reductionPercentage: Math.max(0, ((originalSize - resultBlob.size) / originalSize) * 100),
    blob: resultBlob,
    optimizationLogs: logs
  };
};

/**
 * Safe numeric getter for PDF values
 */
const getNumericValue = (obj: any): number | null => {
  if (typeof obj === 'number') return obj;
  if (!obj) return null;
  if (typeof obj.asNumber === 'function') return obj.asNumber();
  if (typeof obj.value === 'number') return obj.value;
  return null;
};

/**
 * Checks if PDF filter dictates DCTDecode (JPEG)
 */
const hasDCTFilter = (filterObj: any): boolean => {
  if (!filterObj) return false;
  if (filterObj === PDFName.of('DCTDecode')) return true;
  if (filterObj instanceof PDFName && filterObj.decodeText() === 'DCTDecode') return true;
  if (typeof filterObj.asArray === 'function') {
    const array = filterObj.asArray();
    return array.some((f: any) => hasDCTFilter(f));
  }
  if (Array.isArray(filterObj)) {
    return filterObj.some((f: any) => hasDCTFilter(f));
  }
  return false;
};

/**
 * Checks if PDF filter dictates FlateDecode
 */
const hasFlateFilter = (filterObj: any): boolean => {
  if (!filterObj) return false;
  if (filterObj === PDFName.of('FlateDecode')) return true;
  if (filterObj instanceof PDFName && filterObj.decodeText() === 'FlateDecode') return true;
  if (typeof filterObj.asArray === 'function') {
    const array = filterObj.asArray();
    return array.some((f: any) => hasFlateFilter(f));
  }
  if (Array.isArray(filterObj)) {
    return filterObj.some((f: any) => hasFlateFilter(f));
  }
  return false;
};

/**
 * Decodes PNG predictor format (Predictor >= 10)
 */
function decodePngPredictor(
  compressedBytes: Uint8Array,
  width: number,
  height: number,
  bitsPerComponent: number,
  colorspaceComponents: number,
  predictor: number
): Uint8Array {
  const bpp = Math.max(1, Math.ceil((bitsPerComponent * colorspaceComponents) / 8));
  const bytesPerRow = Math.ceil((width * bitsPerComponent * colorspaceComponents) / 8);
  const rowLength = bytesPerRow + 1; // 1 byte for predictor type + row
  
  const decodedBytes = new Uint8Array(height * bytesPerRow);
  
  let srcPos = 0;
  for (let r = 0; r < height; r++) {
    if (srcPos >= compressedBytes.length) break;
    const predictorType = compressedBytes[srcPos];
    srcPos++;
    
    const rowStart = r * bytesPerRow;
    for (let c = 0; c < bytesPerRow; c++) {
      if (srcPos + c >= compressedBytes.length) break;
      const rawByte = compressedBytes[srcPos + c];
      const left = c >= bpp ? decodedBytes[rowStart + c - bpp] : 0;
      const up = r > 0 ? decodedBytes[rowStart - bytesPerRow + c] : 0;
      const upLeft = (r > 0 && c >= bpp) ? decodedBytes[rowStart - bytesPerRow + c - bpp] : 0;
      
      let val = 0;
      switch (predictorType) {
        case 0: // None
          val = rawByte;
          break;
        case 1: // Sub
          val = (rawByte + left) & 0xff;
          break;
        case 2: // Up
          val = (rawByte + up) & 0xff;
          break;
        case 3: // Average
          val = (rawByte + Math.floor((left + up) / 2)) & 0xff;
          break;
        case 4: // Paeth
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          let paeth = 0;
          if (pa <= pb && pa <= pc) paeth = left;
          else if (pb <= pc) paeth = up;
          else paeth = upLeft;
          val = (rawByte + paeth) & 0xff;
          break;
        default:
          val = rawByte;
      }
      decodedBytes[rowStart + c] = val;
    }
    srcPos += bytesPerRow;
  }
  return decodedBytes;
}

/**
 * Unpacks packed sub-8-bit component depths (e.g., 1-bit, 2-bit, 4-bit)
 */
function unpackSub8BitBytes(
  packedBytes: Uint8Array,
  width: number,
  height: number,
  bitsPerComponent: number
): Uint8Array {
  if (bitsPerComponent === 8) return packedBytes;
  
  const unpacked = new Uint8Array(width * height);
  const mask = (1 << bitsPerComponent) - 1;
  const pixelsPerByte = 8 / bitsPerComponent;
  
  let srcIdx = 0;
  let dstIdx = 0;
  
  for (let r = 0; r < height; r++) {
    const bytesPerRow = Math.ceil((width * bitsPerComponent) / 8);
    const rowBytes = packedBytes.subarray(srcIdx, srcIdx + bytesPerRow);
    srcIdx += bytesPerRow;
    
    let col = 0;
    for (let i = 0; i < rowBytes.length && col < width; i++) {
      const b = rowBytes[i];
      for (let p = 0; p < pixelsPerByte && col < width; p++) {
        const shift = 8 - bitsPerComponent * (p + 1);
        const val = (b >> shift) & mask;
        unpacked[dstIdx++] = val;
        col++;
      }
    }
  }
  
  return unpacked;
}

/**
 * Resolves PDF Colorspace names, references, arrays and indexed tables
 */
function resolveColorSpace(
  csObj: any,
  context: any
): { type: string; components: number; palette?: Uint8Array } {
  if (!csObj) {
    return { type: 'RGB', components: 3 };
  }

  if (csObj instanceof PDFRef) {
    csObj = context.lookup(csObj);
  }

  if (csObj instanceof PDFName) {
    const name = csObj.decodeText();
    if (name === 'DeviceRGB' || name === 'CalRGB') {
      return { type: 'RGB', components: 3 };
    }
    if (name === 'DeviceGray' || name === 'CalGray') {
      return { type: 'Gray', components: 1 };
    }
    if (name === 'DeviceCMYK') {
      return { type: 'CMYK', components: 4 };
    }
    return { type: 'RGB', components: 3 };
  }

  if (Array.isArray(csObj) || (csObj && typeof csObj.asArray === 'function')) {
    const arr = Array.isArray(csObj) ? csObj : csObj.asArray();
    if (arr.length === 0) return { type: 'RGB', components: 3 };
    
    let first = arr[0];
    if (first instanceof PDFRef) first = context.lookup(first);
    if (!(first instanceof PDFName)) return { type: 'RGB', components: 3 };

    const csName = first.decodeText();

    if (csName === 'Indexed') {
      const baseCS = arr[1];
      const hivalObj = arr[2];
      let lookupObj = arr[3];

      const hival = getNumericValue(hivalObj) || 255;
      
      if (lookupObj instanceof PDFRef) {
        lookupObj = context.lookup(lookupObj);
      }

      let palette: Uint8Array;
      if (lookupObj instanceof PDFRawStream) {
        palette = lookupObj.getContents();
      } else if (typeof lookupObj.asBytes === 'function') {
        palette = lookupObj.asBytes();
      } else if (typeof lookupObj.value === 'string') {
        const strVal = lookupObj.value;
        const bytes = [];
        for (let i = 0; i < strVal.length; i++) {
          bytes.push(strVal.charCodeAt(i) & 0xff);
        }
        palette = new Uint8Array(bytes);
      } else if (lookupObj && lookupObj.asString) {
        const strVal = lookupObj.asString();
        const bytes = [];
        for (let i = 0; i < strVal.length; i++) {
          bytes.push(strVal.charCodeAt(i) & 0xff);
        }
        palette = new Uint8Array(bytes);
      } else {
        palette = new Uint8Array();
      }

      return { type: 'Indexed', components: 1, palette };
    }

    if (csName === 'ICCBased') {
      let iccStream = arr[1];
      if (iccStream instanceof PDFRef) {
        iccStream = context.lookup(iccStream);
      }
      if (iccStream instanceof PDFRawStream) {
        const nObj = iccStream.dict.get(PDFName.of('N'));
        const nComp = getNumericValue(nObj) || 3;
        if (nComp === 4) return { type: 'CMYK', components: 4 };
        if (nComp === 3) return { type: 'RGB', components: 3 };
        if (nComp === 1) return { type: 'Gray', components: 1 };
      }
      return { type: 'RGB', components: 3 };
    }
  }

  return { type: 'RGB', components: 3 };
}

/**
 * Converts unpredicted stream bytes to raw RGB format
 */
function convertToRGB(
  decodedBytes: Uint8Array,
  width: number,
  height: number,
  bitsPerComponent: number,
  csInfo: { type: string; components: number; palette?: Uint8Array }
): Uint8Array {
  const pixelCount = width * height;
  const rgbBytes = new Uint8Array(pixelCount * 3);
  
  let bytes = decodedBytes;
  if (bitsPerComponent < 8 && (csInfo.type === 'Gray' || csInfo.type === 'Indexed')) {
    bytes = unpackSub8BitBytes(decodedBytes, width, height, bitsPerComponent);
    bitsPerComponent = 8;
  }
  
  let srcPos = 0;
  let dstPos = 0;
  
  if (csInfo.type === 'RGB') {
    if (bytes.length >= pixelCount * 3) {
      return bytes.subarray(0, pixelCount * 3);
    } else {
      rgbBytes.set(bytes.subarray(0, bytes.length));
      return rgbBytes;
    }
  } else if (csInfo.type === 'Gray') {
    const maxVal = (1 << bitsPerComponent) - 1;
    const scale = bitsPerComponent < 8 ? (255 / maxVal) : 1;
    
    for (let i = 0; i < pixelCount; i++) {
      const g = Math.round((bytes[i] || 0) * scale);
      rgbBytes[dstPos] = g;
      rgbBytes[dstPos + 1] = g;
      rgbBytes[dstPos + 2] = g;
      dstPos += 3;
    }
  } else if (csInfo.type === 'CMYK') {
    for (let i = 0; i < pixelCount; i++) {
      const idx = i * 4;
      const c = (bytes[idx] || 0) / 255;
      const m = (bytes[idx + 1] || 0) / 255;
      const y = (bytes[idx + 2] || 0) / 255;
      const k = (bytes[idx + 3] || 0) / 255;
      
      rgbBytes[dstPos] = Math.round(255 * (1 - c) * (1 - k));
      rgbBytes[dstPos + 1] = Math.round(255 * (1 - m) * (1 - k));
      rgbBytes[dstPos + 2] = Math.round(255 * (1 - y) * (1 - k));
      dstPos += 3;
    }
  } else if (csInfo.type === 'Indexed') {
    const palette = csInfo.palette || new Uint8Array();
    const paletteSize = palette.length;
    
    for (let i = 0; i < pixelCount; i++) {
      const index = bytes[i] || 0;
      const palIdx = index * 3;
      if (palIdx + 2 < paletteSize) {
        rgbBytes[dstPos] = palette[palIdx];
        rgbBytes[dstPos + 1] = palette[palIdx + 1];
        rgbBytes[dstPos + 2] = palette[palIdx + 2];
      } else {
        rgbBytes[dstPos] = 255;
        rgbBytes[dstPos + 1] = 255;
        rgbBytes[dstPos + 2] = 255;
      }
      dstPos += 3;
    }
  } else {
    rgbBytes.set(bytes.subarray(0, Math.min(bytes.length, rgbBytes.length)));
  }
  
  return rgbBytes;
}

/**
 * Compresses standard RGB pixels using a canvas, with auto-downscaling for oversized images
 */
async function compressRGBPixels(
  rgbBytes: Uint8Array,
  width: number,
  height: number,
  quality: number,
  logs: string[],
  maxDimension?: number
): Promise<EncodedImage | null> {
  return new Promise((resolve) => {
    try {
      // 1. Create source canvas with original size
      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = width;
      srcCanvas.height = height;
      const srcCtx = srcCanvas.getContext('2d');
      if (!srcCtx) return resolve(null);

      const imgData = srcCtx.createImageData(width, height);
      const data = imgData.data;

      let rIdx = 0;
      let wIdx = 0;
      const totalPixels = width * height;

      for (let i = 0; i < totalPixels; i++) {
        data[wIdx] = rgbBytes[rIdx];
        data[wIdx + 1] = rgbBytes[rIdx + 1];
        data[wIdx + 2] = rgbBytes[rIdx + 2];
        data[wIdx + 3] = 255;
        rIdx += 3;
        wIdx += 4;
      }
      srcCtx.putImageData(imgData, 0, 0);

      const maxDim = maxDimension ?? getMaxDimension(quality);

      // 2. Downscale if oversized
      let targetWidth = width;
      let targetHeight = height;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        targetWidth = Math.round(width * ratio);
        targetHeight = Math.round(height * ratio);
        logs.push(`Resizing oversized raw stream from ${width}x${height} to ${targetWidth}x${targetHeight}`);
      }

      const destCanvas = document.createElement('canvas');
      destCanvas.width = targetWidth;
      destCanvas.height = targetHeight;
      const destCtx = destCanvas.getContext('2d');
      if (!destCtx) return resolve(null);

      // Draw background white for JPEG
      destCtx.fillStyle = '#FFFFFF';
      destCtx.fillRect(0, 0, targetWidth, targetHeight);

      // Draw original onto destination (scales automatically)
      destCtx.drawImage(srcCanvas, 0, 0, width, height, 0, 0, targetWidth, targetHeight);

      destCanvas.toBlob(
        (blob) => resolve(blob ? { blob, width: targetWidth, height: targetHeight } : null),
        'image/jpeg',
        quality / 100
      );
    } catch (e) {
      console.error('Error compressing RGB pixels:', e);
      resolve(null);
    }
  });
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Optimizes PDF file
 */
export const optimizePDF = async (
  file: File, 
  quality: number,
  _skipPng: boolean,
  onProgress: (progress: number) => void
): Promise<OptimizationResult> => {
  const originalSize = file.size;
  const logs: string[] = [`Starting PDF optimization: ${file.name}`];
  const targetSize = Math.round(originalSize * (quality / 100));
  const tolerance = Math.max(4096, Math.round(targetSize * 0.03));
  let currentBytes = new Uint8Array(await file.arrayBuffer());
  let previousSize = currentBytes.length;
  let optimizedAnyImage = false;

  onProgress(8);

  // A PDF's exact size cannot be inferred from JPEG quality. Each pass measures the
  // actual document and tightens the image byte budget until the target is reached.
  for (let pass = 0; pass < 3 && currentBytes.length > targetSize + tolerance; pass++) {
    const pdfDoc = await PDFDocument.load(currentBytes, { ignoreEncryption: true });
    const imageRefs: PDFRef[] = [];
    let totalImageBytes = 0;

    pdfDoc.context.enumerateIndirectObjects().forEach(([ref, object]) => {
      if (!(object instanceof PDFRawStream)) return;
      if (object.dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) return;

      const filter = object.dict.get(PDFName.of('Filter'));
      const hasFilterArray = Boolean(filter && typeof (filter as any).asArray === 'function');
      const supportedFilter = !filter || (!hasFilterArray && (hasDCTFilter(filter) || hasFlateFilter(filter)));
      const hasTransparency = object.dict.has(PDFName.of('SMask')) || object.dict.has(PDFName.of('Mask'));
      const isImageMask = object.dict.has(PDFName.of('ImageMask'));
      if (!supportedFilter || hasTransparency || isImageMask) return;

      const width = getNumericValue(object.dict.get(PDFName.of('Width')));
      const height = getNumericValue(object.dict.get(PDFName.of('Height')));
      if (!width || !height) return;

      imageRefs.push(ref);
      totalImageBytes += object.getContents().length;
    });

    logs.push(`Pass ${pass + 1}: ${imageRefs.length} safely optimizable image(s), ${formatBytes(totalImageBytes)} total.`);
    if (imageRefs.length === 0 || totalImageBytes === 0) {
      currentBytes = await pdfDoc.save({
        useObjectStreams: true,
        addDefaultPage: false,
        updateFieldAppearances: false,
      });
      logs.push(`Structural optimization result: ${formatBytes(currentBytes.length)}.`);
      break;
    }

    const bytesToRemove = Math.max(0, currentBytes.length - targetSize);
    const targetImageRatio = Math.max(0.06, Math.min(0.98, (totalImageBytes - bytesToRemove) / totalImageBytes));
    const passQuality = Math.max(12, Math.round(quality * Math.pow(0.72, pass)));
    const baseMaxDimension = Math.max(480, Math.round(getMaxDimension(quality) * Math.pow(0.78, pass)));

    let processedImages = 0;
    for (const ref of imageRefs) {
      const imageObject = pdfDoc.context.lookup(ref);
      if (!(imageObject instanceof PDFRawStream)) continue;

      try {
        const width = getNumericValue(imageObject.dict.get(PDFName.of('Width')))!;
        const height = getNumericValue(imageObject.dict.get(PDFName.of('Height')))!;
        const filterObj = imageObject.dict.get(PDFName.of('Filter'));
        const isDCT = hasDCTFilter(filterObj);
        const bytes = imageObject.getContents();
        const desiredImageSize = Math.max(1024, Math.round(bytes.length * targetImageRatio));
        let rgbBytes: Uint8Array | null = null;

        if (!isDCT) {
          const colorSpaceObj = imageObject.dict.get(PDFName.of('ColorSpace'));
          const colorspaceInfo = resolveColorSpace(colorSpaceObj, pdfDoc.context);
          const bitsPerComponent = getNumericValue(imageObject.dict.get(PDFName.of('BitsPerComponent'))) || 8;
          if (![1, 2, 4, 8].includes(bitsPerComponent)) throw new Error(`Unsupported ${bitsPerComponent}-bit image`);
          if (bitsPerComponent < 8 && !['Gray', 'Indexed'].includes(colorspaceInfo.type)) {
            throw new Error('Packed RGB/CMYK image is not safely supported');
          }
          if (colorspaceInfo.type === 'Indexed' && (!colorspaceInfo.palette || colorspaceInfo.palette.length === 0)) {
            throw new Error('Indexed image has no readable palette');
          }

          let params: any = imageObject.dict.get(PDFName.of('DecodeParms'));
          if (params instanceof PDFRef) params = pdfDoc.context.lookup(params);
          if (params && typeof params.asArray === 'function') throw new Error('Decode parameter arrays are not supported');
          const predictor = params instanceof PDFDict
            ? (getNumericValue(params.get(PDFName.of('Predictor'))) || 1)
            : 1;
          if (predictor === 2) throw new Error('TIFF predictor is not safely supported');

          let decodedBytes: Uint8Array;
          try {
            decodedBytes = hasFlateFilter(filterObj) ? pako.inflate(bytes) : bytes;
          } catch (inflateErr: any) {
            throw new Error(`FlateDecode failed: ${inflateErr.message || inflateErr}`);
          }
          const rawBytes = predictor >= 10
            ? decodePngPredictor(decodedBytes, width, height, bitsPerComponent, colorspaceInfo.components, predictor)
            : decodedBytes;
          rgbBytes = convertToRGB(rawBytes, width, height, bitsPerComponent, colorspaceInfo);
        }

        let selected: EncodedImage | null = null;
        const attempts = [1, 0.78, 0.58, 0.42];
        for (const factor of attempts) {
          const candidateQuality = Math.max(10, Math.round(passQuality * factor));
          const candidateMaxDimension = Math.max(420, Math.round(baseMaxDimension * Math.sqrt(factor)));
          const candidate = isDCT
            ? await compressImage(new Blob([bytes], { type: 'image/jpeg' }), candidateQuality, 'image/jpeg', candidateMaxDimension)
            : await compressRGBPixels(rgbBytes!, width, height, candidateQuality, logs, candidateMaxDimension);
          if (!candidate) continue;
          if (!selected || candidate.blob.size < selected.blob.size) selected = candidate;
          if (candidate.blob.size <= desiredImageSize) {
            selected = candidate;
            break;
          }
        }

        if (selected && selected.blob.size < bytes.length) {
          const compressedBytes = new Uint8Array(await selected.blob.arrayBuffer());
          const dictMap = new Map<PDFName, any>();
          imageObject.dict.entries().forEach(([key, val]) => dictMap.set(key, val));

          // JPEG bytes produced by Canvas are always 8-bit DeviceRGB. Keeping the
          // old dimensions/colorspace is invalid and caused malformed or tinted PDFs.
          dictMap.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
          dictMap.set(PDFName.of('Width'), pdfDoc.context.obj(selected.width));
          dictMap.set(PDFName.of('Height'), pdfDoc.context.obj(selected.height));
          dictMap.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
          dictMap.set(PDFName.of('BitsPerComponent'), pdfDoc.context.obj(8));
          dictMap.delete(PDFName.of('DecodeParms'));
          dictMap.delete(PDFName.of('Decode'));
          dictMap.delete(PDFName.of('Length'));

          pdfDoc.context.assign(ref, PDFRawStream.of(
            PDFDict.fromMapWithContext(dictMap, pdfDoc.context),
            compressedBytes
          ));
          optimizedAnyImage = true;
          logs.push(`Optimized ${ref.toString()}: ${formatBytes(bytes.length)} -> ${formatBytes(selected.blob.size)}.`);
        }
      } catch (error: any) {
        logs.push(`Skipped ${ref.toString()}: ${error.message || error}`);
      }

      processedImages++;
      const passStart = 10 + pass * 27;
      onProgress(passStart + Math.round((processedImages / imageRefs.length) * 25));
    }

    const savedBytes = await pdfDoc.save({
      useObjectStreams: true,
      addDefaultPage: false,
      updateFieldAppearances: false,
    });
    currentBytes = savedBytes;
    logs.push(`Pass ${pass + 1} document size: ${formatBytes(currentBytes.length)}.`);

    // Stop when another lossy pass would provide negligible benefit.
    if (previousSize - currentBytes.length < Math.max(2048, previousSize * 0.005)) break;
    previousSize = currentBytes.length;
  }

  onProgress(96);
  const useOriginal = currentBytes.length >= originalSize;
  const resultBytes = useOriginal ? new Uint8Array(await file.arrayBuffer()) : currentBytes;
  const targetAchieved = resultBytes.length <= targetSize + tolerance;
  const warning = targetAchieved
    ? undefined
    : optimizedAnyImage
      ? `목표 ${quality}%에 도달하지 못했습니다. 이 PDF는 이미지 외의 텍스트, 글꼴, 벡터 데이터 비중이 커서 원본 대비 ${(resultBytes.length / originalSize * 100).toFixed(1)}%까지 안전하게 줄였습니다.`
      : '안전하게 재압축할 수 있는 이미지가 없어 목표 용량에 도달하지 못했습니다. 텍스트와 벡터 품질을 유지하는 범위에서는 더 줄일 수 없습니다.';

  onProgress(100);
  const resultBlob = new Blob([resultBytes], { type: 'application/pdf' });
  return {
    originalSize,
    compressedSize: resultBlob.size,
    fileName: file.name,
    reductionPercentage: Math.max(0, ((originalSize - resultBlob.size) / originalSize) * 100),
    blob: resultBlob,
    optimizationLogs: logs,
    targetSize,
    targetAchieved,
    warning
  };
};
