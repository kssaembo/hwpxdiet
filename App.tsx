import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, CheckCircle2, FileText, FolderOpen, Gauge, LoaderCircle, ShieldCheck, SlidersHorizontal, X } from 'lucide-react';
import { optimizePDF, optimizeZipBasedDoc } from './services/optimizerService';
import type { OptimizationResult, Progress } from './types';

type Kind = 'hwpx' | 'pdf' | 'office';
const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(2)} MB`;
const accepted = { hwpx: '.hwpx', pdf: '.pdf', office: '.pptx,.show' };
const titles = { hwpx: '한글 HWPX', pdf: 'PDF', office: 'PPTX · SHOW' };

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

  const clear = () => { if (!running) { setFile(null); setResult(null); setError(''); } };
  const target = file ? Math.floor(file.size * (1 - reduction / 100)) : 0;
  return <div className="shell">
    <header><div className="brand"><span className="brand-icon"><FileText size={27} /></span><div><h1>파일 다이어트</h1><small>FILE DIET</small></div></div><span className="badge">v2.0 · 목표 용량 압축</span></header>
    <main><section className="intro"><span className="pill"><ShieldCheck size={14} /> 파일 전송 없이, 내 기기에서</span><h2>무거운 문서를<br /><em>가볍게 줄이세요.</em></h2><p>목표 절감률을 정하면, 이미지 품질과 크기를 조절하며<br className="desktop" /> 실제 파일 크기를 확인해 목표에 맞춰 압축합니다.</p></section>
    <div className="tabs" role="tablist" aria-label="문서 형식">{(Object.keys(titles) as Kind[]).map(key => <button role="tab" key={key} aria-selected={kind === key} disabled={running} className={kind === key ? 'active' : ''} onClick={() => { setKind(key); clear(); }}>{titles[key]}</button>)}</div>
    <div className="workspace">
      <section className="card file-card"><div className="card-heading"><span className="number">01</span><h3>파일 선택</h3><span className="hint">최대 150MB</span></div>
        <div className={`dropzone ${drag ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); if (!running) setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={event => { event.preventDefault(); setDrag(false); select(event.dataTransfer.files[0]); }}>
          <button disabled={running} onClick={() => input.current?.click()}><span className="folder-icon"><FolderOpen size={37} /></span><strong>{file ? file.name : '문서 파일 선택하기'}</strong><span>{file ? `${size(file.size)} · 다른 파일로 변경` : '여기에 파일을 끌어 놓아도 돼요'}</span></button>
          <input ref={input} type="file" accept={accepted[kind]} hidden aria-label="문서 파일 선택" disabled={running} onChange={event => { select(event.target.files?.[0]); event.target.value = ''; }} />
        </div>
        <p className="caption">HWPX · PDF · PPTX · SHOW <span>선택한 파일 형식 자동 인식</span></p>
        <div className="size-preview"><div><span>원본</span><strong>{file ? size(file.size) : '—'}</strong></div><span className="arrow">→</span><div><span>목표 용량 이하</span><strong className="blue">{file ? size(target) : '—'}</strong></div></div>
        <button className="run-button" disabled={!file || running} onClick={() => void run()}>{running ? <LoaderCircle className="spin" size={20} /> : <Gauge size={20} />}{running ? '목표에 맞춰 조절 중' : '목표 용량으로 줄이기'}</button>
        {running && <div className="progress"><div><span role="status">{progress.message}</span><button onClick={() => controller.current?.abort()}><X size={13} /> 취소</button></div><progress max={100} value={progress.percent} aria-label="압축 진행률" /><small>{progress.percent}% · 큰 문서는 시간이 걸릴 수 있어요.</small></div>}
      </section>
      <section className="card settings"><div className="card-heading"><span className="number">02</span><h3>압축 목표 설정</h3><SlidersHorizontal size={17} className="hint" /></div>
        <div className="goal"><span>목표 절감률</span><div><strong>{reduction}</strong><span>% 줄이기</span></div><p>원본의 {100 - reduction}% 크기 이하를 목표로 합니다.</p></div>
        <label htmlFor="reduction" className="sr-only">목표 절감률</label><input id="reduction" type="range" min={10} max={90} step={5} value={reduction} disabled={running} onChange={event => { setReduction(Number(event.target.value)); setResult(null); }} /><div className="range-labels"><span>10% 절감</span><span>90% 절감</span></div>
        <div className="presets">{[30, 50, 70, 90].map(value => <button key={value} disabled={running} className={value === reduction ? 'active' : ''} onClick={() => { setReduction(value); setResult(null); }}>{value}%</button>)}</div>
        <div className="control"><label htmlFor="quality">화질 하한</label><select id="quality" disabled={running} value={minimumSide} onChange={event => { setMinimumSide(Number(event.target.value)); setResult(null); }}><option value={1600}>선명도 우선 · 긴 변 1600px 하한</option><option value={1000}>균형 · 긴 변 1000px 하한</option><option value={500}>강한 압축 · 긴 변 500px 하한</option></select><p>작은 글자가 이미지에 들어 있다면 선명도 우선을 선택하세요. 원본보다 확대하지 않습니다.</p></div>
        <label className="toggle"><input type="checkbox" checked={protectPng} disabled={running} onChange={event => { setProtectPng(event.target.checked); setResult(null); }} /><span><strong>{kind === 'pdf' ? 'PDF 무손실 이미지 원본 유지' : 'PNG 이미지 원본 유지'}</strong><small>켜면 절감 가능한 이미지가 줄어듭니다.</small></span></label>
        <p className="protection"><ShieldCheck size={15} /> PNG 투명도는 옵션을 꺼도 유지합니다.<br />PDF의 투명 이미지·특수 인코딩은 원본을 보호합니다.</p>
      </section>
    </div>
    {error && <div className="error" role="alert">{error}</div>}
    {result && <section className={`result card ${result.achieved ? 'success' : ''}`} aria-label="압축 결과"><div className="result-heading"><CheckCircle2 size={25} /><div><h3>{result.achieved ? '목표 용량에 도달했어요!' : result.reductionPercentage > 0 ? '가능한 범위까지 줄였어요' : '이 설정에서는 더 줄이기 어려워요'}</h3><p>{result.achieved ? `${result.attempts}회 조절 후 목표를 달성했습니다.` : '이미지 외 데이터·보호된 이미지·화질 하한 때문에 목표에 도달하지 못했습니다.'}</p></div></div><div className="result-grid"><div><span>원본</span><strong>{size(result.originalSize)}</strong></div><div><span>목표</span><strong>{size(result.targetSize)} 이하</strong></div><div><span>실제 결과</span><strong>{size(result.compressedSize)}</strong></div><div><span>실제 절감률</span><strong className="blue">{result.reductionPercentage.toFixed(1)}%</strong></div></div><div className="result-actions"><span>변경 이미지 {result.changedImages}개 · 보호/미지원 {result.skippedImages}개</span><a className="download" href={download} download={`${result.reductionPercentage > 0 ? 'optimized_' : 'original_'}${result.fileName}`}><ArrowDownToLine size={17} />{result.reductionPercentage > 0 ? '줄인 파일 다운로드' : '원본 다운로드'}</a></div>{!result.achieved && minimumSide > 500 && <p className="advice">더 줄이려면 ‘강한 압축’을 선택해 다시 시도할 수 있습니다. 이미지 속 작은 글자의 선명도는 낮아질 수 있어요.</p>}<details><summary>처리 기록 보기</summary><ul>{result.logs.map((log, i) => <li key={i}>{log}</li>)}</ul></details></section>}
    <aside className="notice"><ShieldCheck size={19} /><p><strong>퍼센트는 목표이며, 달성을 보장하지는 않습니다.</strong> 사진이 많은 문서는 크게 줄일 수 있지만, 텍스트 중심이거나 이미 압축된 문서는 한계가 있어요. 문서의 텍스트·레이아웃 구조는 유지하고 이미지를 조절합니다. 결과는 원본보다 커지지 않으며, 원본 파일은 변경되지 않습니다.</p></aside>
    <footer><span>ⓒ {new Date().getFullYear()}. Kwon’s class.</span><span>HWP·PPT는 HWPX·PPTX로 저장 후 이용 · 암호화·전자서명 문서 제외</span></footer></main>
  </div>;
}
