
export enum FileType {
  HWPX = 'HWPX',
  PDF = 'PDF'
}

export interface OptimizationResult {
  originalSize: number;
  compressedSize: number;
  fileName: string;
  reductionPercentage: number;
  blob: Blob;
  optimizationLogs: string[];
}

export interface FileState {
  file: File | null;
  type: FileType;
  quality: number;
  isProcessing: boolean;
  result: OptimizationResult | null;
  error: string | null;
}
