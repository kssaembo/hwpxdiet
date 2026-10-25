export interface Options { reduction: number; protectPng: boolean; minimumSide: number; signal: AbortSignal }
export interface Progress { percent: number; message: string }
export interface OptimizationResult {
  originalSize: number; compressedSize: number; fileName: string; blob: Blob;
  targetSize: number; achieved: boolean; reductionPercentage: number;
  changedImages: number; skippedImages: number; attempts: number; logs: string[];
}
