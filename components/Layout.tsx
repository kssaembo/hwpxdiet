
import React from 'react';
import { Settings, FileText, ShieldCheck, Zap } from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
  quality: number;
  setQuality: (val: number) => void;
  activeTab: 'HWPX' | 'PDF';
}

const Layout: React.FC<LayoutProps> = ({ children, quality, setQuality, activeTab }) => {
  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className="w-full md:w-72 bg-white border-r border-slate-200 p-6 flex flex-col gap-8">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded-lg">
            <Zap className="text-white w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">파일 다이어트</h1>
        </div>

        <nav className="flex flex-col gap-1">
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 mt-2">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                <Settings size={16} /> 압축률
              </label>
              <span className="text-sm font-bold text-blue-600">{quality}%</span>
            </div>
            <input
              type="range"
              min="10"
              max="100"
              value={quality}
              onChange={(e) => setQuality(parseInt(e.target.value))}
              className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-slate-400">고압축</span>
              <span className="text-[10px] text-slate-400">고화질</span>
            </div>
          </div>
        </nav>

        <div className="mt-auto bg-blue-50 p-4 rounded-xl">
          <div className="flex items-center gap-2 text-blue-700 font-semibold text-sm mb-1">
            <ShieldCheck size={16} />
            보안 안내
          </div>
          <p className="text-xs text-blue-600 leading-relaxed">
            모든 파일 처리는 브라우저 내부에서 이루어집니다. 업로드하신 파일은 절대로 서버에 저장되지 않으므로 안심하고 사용하세요.
          </p>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center px-8 justify-between sticky top-0 z-10">
          <div className="flex items-center gap-2 text-slate-600">
            <FileText size={18} />
            <span className="text-sm font-medium">
              {activeTab === 'HWPX' ? 'HWPX 용량 줄이기' : 'PDF 용량 줄이기'}
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <span className="hidden sm:inline">v1.0.0 Stable</span>
          </div>
        </header>

        <div className="p-8 max-w-5xl mx-auto w-full flex-1">
          {children}
        </div>

        <footer className="py-8 text-center text-slate-400 text-sm border-t border-slate-100 bg-white">
          ⓒ 2025. Kwon's class. All rights reserved.
        </footer>
      </main>
    </div>
  );
};

export default Layout;
