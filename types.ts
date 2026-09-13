
export enum FileType {
  HWPX = 'HWPX',
  PDF = 'PDF',
  PPTX = 'PPTX',
  SHOW = 'SHOW'
}

export interface OptimizationResult {
  originalSize: number;
  compressedSize: number;
  fileName: string;
  reductionPercentage: number;
  blob: Blob;
  optimizationLogs: string[];
  targetSize?: number;
  targetAchieved?: boolean;
  warning?: string;
}

export interface FileState {
  file: File | null;
  type: FileType;
  quality: number;
  isProcessing: boolean;
  result: OptimizationResult | null;
  error: string | null;
}
