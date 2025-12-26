
import JSZip from 'jszip';
import { PDFDocument, PDFName, PDFRawStream, PDFDict, PDFRef } from 'pdf-lib';
import { OptimizationResult } from '../types';

/**
 * Compresses an image blob using Canvas API while preserving transparency for PNG/GIF
 */
async function compressImage(blob: Blob, quality: number): Promise<Blob> {
  const originalType = blob.type;
  const isTransparentFormat = originalType.includes('png') || originalType.includes('gif');
  
  const targetMime = isTransparentFormat ? 'image/webp' : 'image/jpeg';
  
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

      canvas.width = img.width;
      canvas.height = img.height;

      if (targetMime === 'image/jpeg') {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      ctx.drawImage(img, 0, 0);

      canvas.toBlob(
        (compressed) => {
          URL.revokeObjectURL(objectUrl);
          if (compressed) resolve(compressed);
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
    const imageBytes = await originalImage.async('blob');
    
    try {
      const compressedImage = await compressImage(imageBytes, quality);
      if (compressedImage.size < imageBytes.size) {
        zip.file(path, compressedImage);
      }
    } catch (e) {
      console.error(`Error processing ${path}: ${e}`);
    }
    
    const currentProgress = 10 + Math.round((i + 1) / imageFiles.length * 80);
    onProgress(currentProgress);
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
 * Optimizes PDF file
 */
export const optimizePDF = async (
  file: File, 
  quality: number, 
  skipPng: boolean, // New option added
  onProgress: (progress: number) => void
): Promise<OptimizationResult> => {
  const originalSize = file.size;
  const logs: string[] = [`Starting PDF optimization: ${file.name}`];
  
  onProgress(10);
  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
  
  const pages = pdfDoc.getPages();
  const imageRefs: Set<PDFRef> = new Set();

  pages.forEach((page) => {
    const { node } = page as any;
    const resources = node.get(PDFName.of('Resources'));
    if (!(resources instanceof PDFDict)) return;

    const xObjects = resources.get(PDFName.of('XObject'));
    if (!(xObjects instanceof PDFDict)) return;

    xObjects.entries().forEach(([name, ref]) => {
      if (!(ref instanceof PDFRef)) return;
      const xObject = pdfDoc.context.lookup(ref);
      
      if (xObject instanceof PDFDict || xObject instanceof PDFRawStream) {
        const subtype = xObject instanceof PDFDict ? xObject.get(PDFName.of('Subtype')) : xObject.dict.get(PDFName.of('Subtype'));
        if (subtype === PDFName.of('Image')) {
          imageRefs.add(ref);
        }
      }
    });
  });

  const totalImages = imageRefs.size;
  
  if (totalImages === 0) {
    onProgress(100);
    const resultBytes = await pdfDoc.save({ useObjectStreams: true });
    return {
      originalSize,
      compressedSize: resultBytes.length,
      fileName: file.name,
      reductionPercentage: ((originalSize - resultBytes.length) / originalSize) * 100,
      blob: new Blob([resultBytes], { type: 'application/pdf' }),
      optimizationLogs: logs
    };
  }

  let processedImages = 0;
  for (const ref of imageRefs) {
    const imageObject = pdfDoc.context.lookup(ref);
    if (!(imageObject instanceof PDFRawStream)) {
      processedImages++;
      continue;
    }

    try {
      // PDF specific logic: Skip images that have a SoftMask (transparency) if skipPng is on
      const hasSMask = imageObject.dict.has(PDFName.of('SMask'));
      if (skipPng && hasSMask) {
        processedImages++;
        continue;
      }

      const bytes = imageObject.getContents();
      const blob = new Blob([bytes], { type: 'image/jpeg' });
      
      const compressedBlob = await compressImage(blob, quality);
      
      if (compressedBlob.size < bytes.length) {
        const compressedBytes = new Uint8Array(await compressedBlob.arrayBuffer());
        
        const newStream = pdfDoc.context.flateStream(compressedBytes, {
          Type: PDFName.of('XObject'),
          Subtype: PDFName.of('Image'),
          Width: imageObject.dict.get(PDFName.of('Width')),
          Height: imageObject.dict.get(PDFName.of('Height')),
          BitsPerComponent: imageObject.dict.get(PDFName.of('BitsPerComponent')) || 8,
          ColorSpace: imageObject.dict.get(PDFName.of('ColorSpace')) || PDFName.of('DeviceRGB'),
          Filter: PDFName.of('DCTDecode'), 
        });
        
        pdfDoc.context.assign(ref, newStream);
      }
    } catch (e) {
      console.error(`Error compressing PDF image:`, e);
    }
    
    processedImages++;
    onProgress(15 + Math.round((processedImages / totalImages) * 75));
  }
  
  onProgress(95);
  const resultBytes = await pdfDoc.save({
    useObjectStreams: true,
    addDefaultPage: false,
    updateFieldAppearances: false,
  });

  onProgress(100);
  const resultBlob = new Blob([resultBytes], { type: 'application/pdf' });
  return {
    originalSize,
    compressedSize: resultBlob.size,
    fileName: file.name,
    reductionPercentage: Math.max(0, ((originalSize - resultBlob.size) / originalSize) * 100),
    blob: resultBlob,
    optimizationLogs: logs
  };
};
