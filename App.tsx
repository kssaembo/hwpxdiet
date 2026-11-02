import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, CheckCircle2, FileText, FolderOpen, Gauge, LoaderCircle, ShieldCheck, SlidersHorizontal, X, Info, RotateCcw, LockKeyhole, ChevronRight } from 'lucide-react';
import { optimizePDF, optimizeZipBasedDoc } from './services/optimizerService';
import type { OptimizationResult, Progress } from './types';

const SchedulePanel = lazy(() => import('./components/SchedulePanel'));
type Kind = 'hwpx' | 'pdf' | 'office' | 'gone';
const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(2)} MB`;
const accepted = { hwpx: '.hwpx', pdf: '.pdf', office: '.pptx,.show', gone: '.pdf' };
const titles = { hwpx: '한글 HWPX', pdf: 'PDF', office: 'PPTX · SHOW', gone: 'G-ONE 일정표 변환' };

export default function App() {
  const [kind, setKind] = useState<Kind>('hwpx');
  const [reduction, setReduction] = useState(50);
  const [protectPng, setProtectPng] = useState(false);
  const [minimumSide, setMinimumSide] = useState(1000);
  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress>({ percent: 0, message: '' });
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [error, setError] = useState('');
  const [download, setDownload] = useState('');
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const privacyDialog = useRef<HTMLDialogElement>(null);
  const logsDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!result) { setDownload(''); return; }
    const url = URL.createObjectURL(result.blob); setDownload(url);
    return () => URL.revokeObjectURL(url);
  }, [result]);
  useEffect(() => () => controller.current?.abort(), []);

  const select = (selected?: File) => {
    if (!selected || running) return;
    const ext = selected.name.split('.').pop()?.toLowerCase();
    if (ext === 'hwp' || ext === 'ppt') { setError('한글·파워포인트에서 HWPX 또는 PPTX로 저장한 후 선택해 주세요.'); return; }
    const detected: Kind | undefined = ext === 'hwpx' ? 'hwpx' : ext === 'pdf' ? 'pdf' : ext === 'pptx' || ext === 'show' ? 'office' : undefined;
    if (!detected || !selected.size) { setError('비어 있지 않은 HWPX, PDF, PPTX, SHOW 파일을 선택해 주세요.'); return; }
    if (selected.size > 150 * 1024 ** 2) { setError('150MB 이하 파일을 선택해 주세요.'); return; }
    setKind(detected); setFile(selected); setResult(null); setError(''); setProgress({ percent: 0, message: '' });
  };

  const run = async () => {
    if (!file || running) return;
    const active = new AbortController(); controller.current = active;
    setRunning(true); setError(''); setResult(null);
    try {
      const options = { reduction, protectPng, minimumSide, signal: active.signal };
      const output = await (kind === 'pdf' ? optimizePDF : optimizeZipBasedDoc)(file, options, value => { if (!active.signal.aborted) setProgress(value); });
      if (!active.signal.aborted) setResult(output);
    } catch (err) {
      setError(active.signal.aborted ? '작업을 취소했습니다. 원본은 변경되지 않았습니다.' : err instanceof Error ? err.message : '처리 중 오류가 발생했습니다.');
    } finally { setRunning(false); controller.current = null; }
  };

  const clear = () => { if (!running) { setFile(null); setResult(null); setError(''); setProgress({ percent: 0, message: '' }); } };
  const target = file ? Math.floor(file.size * (1 - reduction / 100)) : 0;
  const statusTitle = running ? '목표 용량에 맞추는 중' : error ? '확인이 필요해요' : result ? result.achieved ? '목표 용량 달성' : result.reductionPercentage > 0 ? '가능한 범위까지 줄였어요' : '추가 압축이 어려워요' : '압축 결과를 여기서 확인하세요';
  return <div className="shell">
    <header className="topbar"><div className="brand"><span className="brand-icon"><FileText size={22} /></span><h1>파일 다이어트</h1><span className="wordmark">FILE DIET</span></div><div className="top-actions"><span className="local-badge"><LockKeyhole size={13} /> 브라우저 내 처리</span><span className="version">v2.2</span></div></header>
    <main>
      <section className="title-row"><h2>{kind === 'gone' ? <>G-ONE 일정표를 <em>편집 가능한 문서로.</em></> : <>무거운 문서를 <em>가볍게 줄이세요.</em></>}</h2><p>{kind === 'gone' ? '현재 연도 적용 → 요일 자동 추가 → XLSX·HWPX 다운로드' : '문서 선택 → 압축 목표 설정 → 다운로드. 필요한 기능을 한 화면에서.'}</p></section>
      <aside className="privacy-strip" aria-label="파일 처리 안내"><ShieldCheck size={17} /><strong>파일 전송·서버 저장 없음</strong><span>선택한 문서는 이 브라우저에서만 처리하며, 파일·내용을 서버에 수집·보관하지 않습니다.</span><button onClick={() => privacyDialog.current?.showModal()}>처리 방식 안내 <ChevronRight size={14} /></button></aside>
      <div className="workspace">
        <nav className="format-nav" aria-label="문서 형식"><span className="nav-label">문서 형식</span><div className="tabs" role="tablist" aria-orientation="vertical" aria-label="문서 형식">{(Object.keys(titles) as Kind[]).map(key => <button role="tab" key={key} aria-label={titles[key]} aria-selected={kind === key} disabled={running} className={kind === key ? 'active' : ''} onClick={() => { setKind(key); clear(); }}><span className={`format-icon ${key}`}>{key === 'hwpx' ? 'H' : key === 'pdf' ? 'PDF' : key === 'gone' ? 'G' : 'P'}</span><strong>{key === 'hwpx' ? '한글 문서' : key === 'pdf' ? 'PDF 문서' : key === 'gone' ? <>G-ONE<br />일정표 변환</> : '프레젠테이션'}</strong><small>{key === 'hwpx' ? 'HWPX' : key === 'pdf' ? '.pdf' : key === 'gone' ? 'PDF → 편집 문서' : 'PPTX · SHOW'}</small></button>)}</div><span className="nav-footnote">HWP·PPT는<br />새 형식으로 저장 후 이용</span></nav>
        {kind === 'gone' ? <Suspense fallback={<div className="gone-loading" role="status">일정표 변환을 준비하고 있습니다…</div>}><SchedulePanel /></Suspense> : <>
        <section className="card file-card" aria-label="파일 선택"><div className="card-heading"><span className="number">01</span><h3>파일 선택</h3><span className="hint">최대 150MB</span></div>
          <div className={`dropzone ${drag ? 'dragging' : ''} ${file ? 'loaded' : ''}`} onDragOver={event => { event.preventDefault(); if (!running) setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={event => { event.preventDefault(); setDrag(false); select(event.dataTransfer.files[0]); }}><button disabled={running} onClick={() => input.current?.click()}><span className="folder-icon">{file ? <FileText size={32} /> : <FolderOpen size={32} />}</span><strong>{file ? file.name : '파일을 선택하거나 끌어 놓으세요'}</strong><span>{file ? `${size(file.size)} · 다른 파일 선택` : `${titles[kind]} 문서를 가볍게`}</span></button><input ref={input} type="file" accept={accepted[kind]} hidden aria-label="문서 파일 선택" disabled={running} onChange={event => { select(event.target.files?.[0]); event.target.value = ''; }} /></div>
          <div className="file-meta"><span><CheckCircle2 size={13} /> 파일 형식 자동 인식</span><button disabled={!file || running} onClick={clear}><RotateCcw size={13} /> 파일 비우기</button></div>
          <div className="size-preview"><div><span>원본 용량</span><strong>{file ? size(file.size) : '—'}</strong></div><ChevronRight size={18} /><div><span>목표 용량 이하</span><strong className="blue">{file ? size(target) : '—'}</strong></div></div>
          <p className="file-help"><LockKeyhole size={13} /> 파일은 서버로 업로드하지 않습니다.<br /><span>작업 중 브라우저 메모리에서만 사용합니다.</span></p>
          <button className="run-button" disabled={!file || running} onClick={() => void run()}>{running ? <LoaderCircle className="spin" size={18} /> : <Gauge size={18} />}{running ? '목표에 맞춰 조절 중' : '목표 용량으로 줄이기'}</button>
        </section>
        <section className="card settings" aria-label="압축 설정"><div className="card-heading"><span className="number">02</span><h3>압축 목표 설정</h3><SlidersHorizontal size={16} className="hint" /></div>
          <div className="goal"><div><span>목표 절감률</span><p>원본의 {100 - reduction}% 이하로</p></div><strong>{reduction}<small>%</small></strong></div>
          <label htmlFor="reduction" className="sr-only">목표 절감률</label><input id="reduction" type="range" min={10} max={90} step={5} value={reduction} disabled={running} onChange={event => { setReduction(Number(event.target.value)); setResult(null); }} /><div className="range-labels"><span>10% 절감</span><span>90% 절감</span></div>
          <div className="presets">{[30, 50, 70, 90].map(value => <button key={value} disabled={running} aria-pressed={value === reduction} className={value === reduction ? 'active' : ''} onClick={() => { setReduction(value); setResult(null); }}>{value}%</button>)}</div>
          <div className="control"><label htmlFor="quality">화질 하한</label><select id="quality" disabled={running} value={minimumSide} onChange={event => { setMinimumSide(Number(event.target.value)); setResult(null); }}><option value={1600}>선명도 우선 · 1600px</option><option value={1000}>균형 · 1000px</option><option value={500}>강한 압축 · 500px</option></select><p>이미지 속 글자가 작다면 선명도 우선을 선택하세요.</p></div>
          <label className="toggle"><input type="checkbox" checked={protectPng} disabled={running} onChange={event => { setProtectPng(event.target.checked); setResult(null); }} /><span><strong>{kind === 'pdf' ? 'PDF 무손실 이미지 원본 유지' : 'PNG 이미지 원본 유지'}</strong><small>켜면 절감 가능한 이미지가 줄어듭니다.</small></span></label>
          <p className="protection"><ShieldCheck size={15} /><span>PNG 투명도는 기본으로 유지합니다.<br />PDF의 투명·특수 이미지는 원본을 보호합니다.</span></p>
          <p className="settings-note">절감률은 목표이며 파일 구성과 화질 하한에 따라 달성하지 못할 수 있습니다.</p>
        </section>
        <section className={`result card ${result?.achieved ? 'success' : ''}`} aria-label="압축 결과"><div className="card-heading"><span className="number">03</span><h3>결과 및 다운로드</h3><ArrowDownToLine size={16} className="hint" /></div>
          <div className={`result-status ${error ? 'has-error' : ''}`}><span className="status-icon">{running ? <LoaderCircle className="spin" size={22} /> : error ? <Info size={22} /> : result ? <CheckCircle2 size={22} /> : <ArrowDownToLine size={22} />}</span><h4>{statusTitle}</h4><p role={error ? 'alert' : undefined}>{error || (running ? progress.message : result ? result.achieved ? `${result.attempts}회 조절 후 목표에 도달했습니다.` : '이미지 구성 또는 화질 하한으로 인한 제한입니다.' : '파일 선택과 설정을 마치고 압축을 시작하세요.')}</p></div>
          {running && <div className="progress"><div><span role="status">진행률 {progress.percent}%</span><button onClick={() => controller.current?.abort()}><X size={13} /> 취소</button></div><progress max={100} value={progress.percent} aria-label="압축 진행률" /></div>}
          <div className="result-grid"><div><span>원본 용량</span><strong>{result ? size(result.originalSize) : file ? size(file.size) : '—'}</strong></div><div><span>목표 용량</span><strong>{file ? size(result?.targetSize ?? target) : '—'}</strong></div><div><span>실제 결과</span><strong>{result ? size(result.compressedSize) : '—'}</strong></div><div className="reduction-cell"><span>실제 절감률</span><strong>{result ? `${result.reductionPercentage.toFixed(1)}%` : '—'}</strong></div></div>
          <div className="result-detail">{result ? <>변경 이미지 {result.changedImages}개 · 보호/미지원 {result.skippedImages}개</> : '원본 파일을 변경하거나 덮어쓰지 않습니다.'}</div>
          {result && !result.achieved && minimumSide > 500 && <p className="advice">더 줄이려면 ‘강한 압축’으로 다시 시도하세요. 이미지 속 작은 글자는 흐려질 수 있어요.</p>}
          <div className="result-bottom">{result ? <a className="download" href={download || undefined} aria-disabled={!download} onClick={event => { if (!download) event.preventDefault(); }} download={`${result.reductionPercentage > 0 ? 'optimized_' : 'original_'}${result.fileName}`}><ArrowDownToLine size={17} />{result.reductionPercentage > 0 ? '줄인 파일 다운로드' : '원본 다운로드'}</a> : <button className="download" disabled><ArrowDownToLine size={17} /> 압축 후 다운로드</button>}<button className="logs-button" disabled={!result} onClick={() => logsDialog.current?.showModal()}>처리 기록 보기 <ChevronRight size={13} /></button></div>
        </section></>}
      </div>
      <footer><span>ⓒ {new Date().getFullYear()}. Kwon’s class.</span><span>HWPX · PDF · PPTX · SHOW / 암호화·전자서명 문서는 제외됩니다.</span><button onClick={() => privacyDialog.current?.showModal()}>파일·개인정보 처리 안내</button></footer>
    </main>
    <dialog ref={privacyDialog} aria-labelledby="privacy-title" className="info-dialog"><div className="dialog-heading"><h2 id="privacy-title"><ShieldCheck size={20} /> 파일·개인정보 처리 안내</h2><button aria-label="안내 닫기" onClick={() => privacyDialog.current?.close()}><X size={20} /></button></div><div className="dialog-content"><p className="dialog-lead">문서 파일을 서비스 서버에 전송하거나 저장하지 않습니다.</p><ul><li><strong>기기 안에서 처리:</strong> 문서의 이미지 분석·압축, 일정표의 글자 추출·요일 계산·XLSX/HWPX 생성은 이 페이지를 연 기기의 브라우저에서 실행됩니다.</li><li><strong>파일 수집·서버 보관 없음:</strong> 이 앱은 선택한 파일, 파일명, 문서 내용을 서버에 보내거나 보관하는 기능을 사용하지 않습니다.</li><li><strong>작업 중 임시 사용:</strong> 선택한 파일과 결과는 브라우저 메모리에 일시적으로 존재합니다. 파일 비우기·파일 변경·페이지 종료 후에는 이 앱에서 계속 보관하지 않습니다. 메모리의 실제 회수 시점은 브라우저가 관리합니다.</li><li><strong>추적 기능 없음:</strong> 이 앱의 코드에는 광고·방문 분석·사용자 추적, 쿠키·브라우저 저장소를 통한 사용자 정보 수집 기능이 없습니다.</li><li><strong>다운로드:</strong> 다운로드를 선택하면 결과 파일이 사용자의 기기에 저장됩니다.</li><li><strong>사이트 접속 기록:</strong> 페이지와 실행 파일을 불러오려면 인터넷 접속이 필요합니다. 호스팅 제공자는 운영·보안을 위한 접속 기록을 처리할 수 있습니다. ‘파일을 수집하지 않는다’는 안내가 호스팅 제공자의 모든 접속 기록까지 없다는 뜻은 아닙니다.</li></ul><p className="dialog-note">이 안내는 현재 제공된 앱 코드의 동작 범위를 설명합니다. 배포에 분석·광고·서버 업로드 기능을 추가하면 안내도 함께 변경해야 합니다.</p></div><button className="dialog-confirm" onClick={() => privacyDialog.current?.close()}>확인</button></dialog>
    <dialog ref={logsDialog} aria-labelledby="logs-title" className="info-dialog"><div className="dialog-heading"><h2 id="logs-title">처리 기록</h2><button aria-label="처리 기록 닫기" onClick={() => logsDialog.current?.close()}><X size={20} /></button></div><div className="dialog-content"><ul>{result?.logs.map((log, i) => <li key={i}>{log}</li>)}</ul></div></dialog>
  </div>;
}

