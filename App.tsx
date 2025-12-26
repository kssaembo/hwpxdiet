
import React, { useState } from 'react';
import { 
  Upload, 
  Download, 
  FileWarning, 
  CheckCircle2, 
  ArrowRight, 
  BarChart3, 
  RotateCcw,
  FileText,
  Zap,
  AlertCircle
} from 'lucide-react';
import Layout from './components/Layout';
import { OptimizationResult } from './types';
import { optimizeZipBasedDoc, optimizePDF } from './services/optimizerService';

type TabType = 'HWPX' | 'PDF' | 'PPTX_SHOW';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('HWPX');
  const [quality, setQuality] = useState(70);
  const [skipPng, setSkipPng] = useState(true); // Default to true to be safe
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      setResult(null);
      setError(null);
      setProgress(0);
    }
  };

  const runOptimization = async () => {
    if (!file) return;

    setIsProcessing(true);
    setProgress(0);
    setError(null);
    try {
      let res: OptimizationResult;
      if (activeTab === 'HWPX' || activeTab === 'PPTX_SHOW') {
        res = await optimizeZipBasedDoc(file, quality, skipPng, (p) => setProgress(p));
      } else {
        res = await optimizePDF(file, quality, skipPng, (p) => setProgress(p));
      }
      setResult(res);
    } catch (err: any) {
      console.error(err);
      setError(`오류 발생: ${err.message || '알 수 없는 오류가 발생했습니다.'}\n파일이 손상되었거나 브라우저 메모리가 부족할 수 있습니다.`);
    } finally {
      setIsProcessing(false);
    }
  };

  const reset = () => {
    setFile(null);
    setResult(null);
    setError(null);
    setProgress(0);
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getAcceptExtensions = () => {
    switch(activeTab) {
      case 'HWPX': return '.hwpx';
      case 'PDF': return '.pdf';
      case 'PPTX_SHOW': return '.pptx,.show';
      default: return '';
    }
  };

  return (
    <Layout 
      quality={quality} 
      setQuality={setQuality} 
      skipPng={skipPng} 
      setSkipPng={setSkipPng} 
      activeTab={activeTab}
    >
      <div className="flex flex-col gap-8">
        {/* Tab Selection */}
        <div className="flex p-1 bg-slate-200 rounded-xl w-fit flex-wrap gap-1">
          <button
            onClick={() => { setActiveTab('HWPX'); reset(); }}
            className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'HWPX' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            HWPX 압축
          </button>
          <button
            onClick={() => { setActiveTab('PDF'); reset(); }}
            className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'PDF' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            PDF 압축
          </button>
          <button
            onClick={() => { setActiveTab('PPTX_SHOW'); reset(); }}
            className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'PPTX_SHOW' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            PPTX / SHOW 압축
          </button>
        </div>

        {!result ? (
          <div className="bg-white border-2 border-dashed border-slate-200 rounded-3xl p-12 flex flex-col items-center text-center">
            <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mb-6">
              <Upload className="text-blue-600 w-10 h-10" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">파일을 업로드하세요</h2>
            <div className="mb-8 flex flex-col items-center gap-2">
              <p className="text-slate-500 max-w-sm">
                최적화할 {activeTab === 'PPTX_SHOW' ? 'PPTX 또는 SHOW' : activeTab} 파일을 선택하거나 이 영역으로 드래그 앤 드롭 하세요.
              </p>
              {activeTab === 'HWPX' && (
                <p className="text-blue-600 text-sm font-medium">
                  * hwp 파일은 hwpx 파일로 변환 후 업로드 해주세요.
                </p>
              )}
              {activeTab === 'PPTX_SHOW' && (
                <div className="flex flex-col gap-1 items-center">
                  <p className="text-blue-600 text-sm font-medium">
                    * ppt 파일은 pptx 파일로 변환 후 업로드 해주세요.
                  </p>
                  <p className="text-slate-400 text-xs flex items-center gap-1">
                    <AlertCircle size={12} /> 100MB 이상의 대용량 파일은 처리 중 브라우저가 일시적으로 느려질 수 있습니다.
                  </p>
                </div>
              )}
            </div>
            
            <input
              type="file"
              id="fileInput"
              accept={getAcceptExtensions()}
              className="hidden"
              onChange={handleFileChange}
            />
            
            <div className="flex flex-col gap-4 w-full max-w-sm">
              <label
                htmlFor="fileInput"
                className="cursor-pointer bg-white border border-slate-300 hover:border-blue-400 text-slate-700 font-semibold py-3 px-6 rounded-xl shadow-sm transition-all flex items-center justify-center gap-2"
              >
                <FileText size={18} /> {file ? file.name : '파일 선택하기'}
              </label>

              {file && !isProcessing && (
                <button
                  onClick={runOptimization}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-xl shadow-lg shadow-blue-200 transition-all flex items-center justify-center gap-2"
                >
                  <Zap size={18} /> 다이어트 시작하기
                </button>
              )}

              {isProcessing && (
                <div className="w-full mt-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-bold text-blue-600">진행률</span>
                    <span className="text-sm font-bold text-blue-600">{progress}%</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-4 overflow-hidden">
                    <div 
                      className="bg-blue-600 h-full transition-all duration-300 ease-out"
                      style={{ width: `${progress}%` }}
                    ></div>
                  </div>
                  <p className="text-xs text-slate-400 mt-2 text-center">
                    {file && file.size > 100 * 1024 * 1024 
                      ? "대용량 파일을 처리 중입니다. 브라우저 창을 닫지 마세요." 
                      : "문서 용량을 줄이는 중입니다. 잠시만 기다려주세요."}
                  </p>
                </div>
              )}
            </div>

            {error && (
              <div className="mt-8 p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3 text-left w-full">
                <FileWarning className="text-red-500 shrink-0 mt-0.5" />
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-bold text-red-900 uppercase">에러 상세</span>
                  <p className="text-sm text-red-700 whitespace-pre-line">{error}</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-xl shadow-slate-200/50">
              <div className="p-8 border-b border-slate-100 bg-slate-50/50 flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                  <div className="bg-green-100 p-3 rounded-2xl">
                    <CheckCircle2 className="text-green-600 w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">최적화 완료!</h3>
                    <p className="text-sm text-slate-500">파일 용량이 획기적으로 줄어들었습니다.</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={reset}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-100 transition-colors"
                  >
                    <RotateCcw size={16} /> 다시하기
                  </button>
                  <a
                    href={URL.createObjectURL(result.blob)}
                    download={`optimized_${result.fileName}`}
                    className="flex items-center gap-2 px-6 py-2 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
                  >
                    <Download size={18} /> 다운로드
                  </a>
                </div>
              </div>

              <div className="p-8">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                  <div className="p-6 rounded-2xl bg-slate-50 border border-slate-100">
                    <span className="text-xs font-semibold text-slate-400 uppercase">원본 용량</span>
                    <p className="text-2xl font-bold text-slate-900 mt-1">{formatSize(result.originalSize)}</p>
                  </div>
                  <div className="p-6 rounded-2xl bg-blue-50 border border-blue-100">
                    <span className="text-xs font-semibold text-blue-400 uppercase">압축 후 용량</span>
                    <p className="text-2xl font-bold text-blue-600 mt-1">{formatSize(result.compressedSize)}</p>
                  </div>
                  <div className="p-6 rounded-2xl bg-green-50 border border-green-100">
                    <span className="text-xs font-semibold text-green-500 uppercase">절감률</span>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-2xl font-bold text-green-600">{result.reductionPercentage.toFixed(1)}%</p>
                      <BarChart3 className="text-green-500" size={20} />
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 bg-slate-100 p-1 rounded-2xl">
                  <div className="flex-1 bg-white p-4 rounded-xl flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-500">Original</span>
                    <div className="h-4 flex-1 mx-4 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-slate-300 w-full"></div>
                    </div>
                    <span className="text-xs font-bold text-slate-400">100%</span>
                  </div>
                  <ArrowRight className="text-slate-300" />
                  <div className="flex-1 bg-white p-4 rounded-xl flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-500">Diet</span>
                    <div className="h-4 flex-1 mx-4 bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-blue-600 transition-all duration-1000 ease-out" 
                        style={{ width: `${Math.max(5, 100 - result.reductionPercentage)}%` }}
                      ></div>
                    </div>
                    <span className="text-xs font-bold text-blue-600">{Math.round(100 - result.reductionPercentage)}%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-12">
          <div className="bg-white p-6 rounded-2xl border border-slate-200">
            <h4 className="font-bold text-slate-900 mb-2 flex items-center gap-2">
              <span className="w-1.5 h-6 bg-blue-600 rounded-full inline-block"></span>
              어떻게 압축되나요?
            </h4>
            <p className="text-sm text-slate-600 leading-relaxed">
              HWPX, PPTX, SHOW 파일은 내부의 이미지 자산을 찾아 설정하신 품질로 재인코딩합니다. PDF는 문서 내부의 고해상도 이미지를 추출하여 최적화하고 용량을 줄입니다. 텍스트 레이아웃은 보존됩니다.
            </p>
          </div>
          <div className="bg-white p-6 rounded-2xl border border-slate-200">
            <h4 className="font-bold text-slate-900 mb-2 flex items-center gap-2">
              <span className="w-1.5 h-6 bg-green-500 rounded-full inline-block"></span>
              보안 안내
            </h4>
            <p className="text-sm text-slate-600 leading-relaxed">
              본 서비스는 Client-side 전용 도구입니다. 데이터 전송이 발생하지 않으며, 처리된 파일은 브라우저 탭을 닫는 즉시 메모리에서 소멸됩니다. 기업용 문서 보안 가이드라인을 준수합니다.
            </p>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default App;
