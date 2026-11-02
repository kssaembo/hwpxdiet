import { useEffect, useRef, useState } from 'react';
import { CalendarDays, FolderOpen, ArrowDownToLine, LoaderCircle, X, RotateCcw, ShieldCheck } from 'lucide-react';
import { displayTitle, type Schedule } from '../services/scheduleModel';
export default function SchedulePanel(){
  const [file,setFile]=useState<File|null>(null),[schedule,setSchedule]=useState<Schedule|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[exporting,setExporting]=useState(''),[progress,setProgress]=useState(0),[drag,setDrag]=useState(false);
  const input=useRef<HTMLInputElement>(null),task=useRef<AbortController|null>(null),serial=useRef(0),urls=useRef(new Set<string>());
  useEffect(()=>()=>{serial.current++;task.current?.abort();urls.current.forEach(URL.revokeObjectURL);urls.current.clear();},[]);
  const clear=()=>{serial.current++;task.current?.abort();setFile(null);setSchedule(null);setError('');setBusy(false);setExporting('');setProgress(0);};
  const select=async(selected?:File)=>{
    if(!selected)return;
    if(!/\.pdf$/i.test(selected.name)||!selected.size){setError('비어 있지 않은 PDF 파일을 선택해 주세요.');return;}
    if(selected.size>30*1024*1024){setError('30MB 이하 PDF를 선택해 주세요.');return;}
    task.current?.abort();const token=++serial.current,controller=new AbortController();task.current=controller;
    setFile(selected);setSchedule(null);setError('');setProgress(0);setBusy(true);
    try{const {readSchedule}=await import('../services/scheduleService');controller.signal.throwIfAborted();const result=await readSchedule(selected,controller.signal,v=>{if(token===serial.current)setProgress(v)});if(token===serial.current)setSchedule(result);}
    catch(e){if(token===serial.current)setError(controller.signal.aborted?'변환을 취소했습니다.':e instanceof Error?e.message:'PDF를 읽지 못했습니다.');}
    finally{if(token===serial.current){setBusy(false);task.current=null;}}
  };
  const save=async(format:'xlsx'|'hwpx')=>{
    if(!schedule||exporting)return;const token=serial.current;setExporting(format);setError('');
    try{const {exportXlsx,exportHwpx,scheduleName}=await import('../services/scheduleExport');const blob=await(format==='xlsx'?exportXlsx:exportHwpx)(schedule);if(token!==serial.current)return;const url=URL.createObjectURL(blob);urls.current.add(url);const a=document.createElement('a');a.href=url;a.download=scheduleName(schedule,format);document.body.append(a);a.click();a.remove();window.setTimeout(()=>{URL.revokeObjectURL(url);urls.current.delete(url)},30000);}
    catch(e){if(token===serial.current)setError(e instanceof Error?e.message:'파일을 만들지 못했습니다.');}
    finally{if(token===serial.current)setExporting('');}
  };
  const edit=(i:number,key:'title'|'owner',value:string)=>{setSchedule(s=>s?{...s,rows:s.rows.map((r,j)=>j===i?{...r,[key]:value}:r)}:s);};
  return <section className="gone-panel" aria-label="G-ONE 일정표 변환">
    <div className="gone-toolbar"><div><h3><CalendarDays size={21}/> G-ONE 일정표 변환</h3><p>PDF를 선택하면 요일이 있는 편집용 일정표로 바꿉니다.</p></div><span className="gone-year">{schedule?.year??new Date().getFullYear()}년 자동 적용</span></div>
    <div className="gone-workspace"><section className="card gone-source" aria-label="일정표 PDF 선택"><div className="card-heading"><span className="number">01</span><h3>월간 인쇄 PDF 선택</h3></div>
      <div className={'dropzone '+(drag?'dragging':'')} onDragOver={e=>{e.preventDefault();setDrag(true)}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);if(!busy&&!exporting)void select(e.dataTransfer.files[0])}}><button disabled={busy||!!exporting} onClick={()=>input.current?.click()}><span className="folder-icon"><FolderOpen size={32}/></span><strong>{file?.name??'G-ONE PDF를 골라 주세요'}</strong><span>모든 페이지가 포함된 월간 인쇄 PDF · 최대 30MB</span></button><input ref={input} type="file" accept=".pdf,application/pdf" hidden aria-label="G-ONE 일정표 PDF 선택" disabled={busy||!!exporting} onChange={e=>{void select(e.target.files?.[0]);e.target.value=''}}/></div>
      <button className="gone-reset" disabled={!file||!!exporting} onClick={clear}><RotateCcw size={15}/>파일 비우기</button>
      {busy&&<div className="gone-progress"><span role="status"><LoaderCircle className="spin" size={17}/>일정을 읽는 중 · {progress}%</span><progress max={100} value={progress} aria-label="일정표 변환 진행률"/><button onClick={()=>task.current?.abort()}><X size={14}/>취소</button></div>}
      <p className="gone-local"><ShieldCheck size={16}/> AI·서버 업로드 없이 기기 안에서 처리</p>
      {schedule&&<><div className="gone-stats"><strong>{schedule.month}월 일정 {schedule.rows.filter(r=>r.title).length}건</strong><span>원본 {schedule.pages}쪽 · 일·요일·제목·담당자</span></div><div className="gone-downloads"><button className="download" disabled={!!exporting} onClick={()=>void save('xlsx')}>{exporting==='xlsx'?<LoaderCircle className="spin" size={17}/>:<ArrowDownToLine size={17}/>}XLSX 다운로드</button><button className="download hwpx-download" disabled={!!exporting} onClick={()=>void save('hwpx')}>{exporting==='hwpx'?<LoaderCircle className="spin" size={17}/>:<ArrowDownToLine size={17}/>}HWPX 다운로드</button></div></>}
      <details className="gone-help"><summary>변환 안내</summary><p>연도는 기기의 현재 날짜 기준입니다. PDF에 적힌 월·일을 유지하고 현재 연도로 요일을 계산합니다.</p><p>일정이 없는 날도 표시합니다. 날짜와 요일은 같은 날의 첫 행에만 표시하며, 원본에 있는 일정은 제외하지 않습니다.</p><p>PDF에 담당자가 없으면 빈칸입니다. 제목과 담당자는 미리보기에서 수정할 수 있습니다. 수정한 내용은 두 다운로드 형식에 함께 적용됩니다.</p><p>스캔 이미지·주간/달력 격자형 PDF는 지원하지 않습니다. 글자를 읽을 수 있는 G-ONE 월간 인쇄 형식용입니다.</p></details>
    </section><section className="card gone-preview" aria-label="변환 일정표 미리보기"><div className="card-heading"><span className="number">02</span><h3>미리보기 및 수정</h3><span className="hint">제목·담당자 수정 가능</span></div>
      {error&&<p role="alert" className="gone-error">{error}</p>}
      {!schedule?<div className="gone-empty"><CalendarDays size={42}/><strong>{busy?'일정표를 만드는 중입니다':'PDF를 선택하면 일정표가 여기에 나타납니다'}</strong><p>요일을 자동으로 추가하고 XLSX·HWPX로 저장하세요.</p></div>:<><div className="gone-notices">{schedule.warnings.map(w=><p key={w}>{w}</p>)}</div><div className="gone-table-wrap" tabIndex={0} aria-label="일정표 스크롤 영역"><table><thead><tr><th scope="col">일</th><th scope="col">요일</th><th scope="col">제목</th><th scope="col">담당자</th></tr></thead><tbody>{schedule.rows.map((row,i)=>{const first=i===0||schedule.rows[i-1].day!==row.day;return <tr key={i} className={row.weekday==='일'?'sunday':row.weekday==='토'?'saturday':''}><td>{first?`${schedule.month}월 ${String(row.day).padStart(2,'0')}일`:''}</td><td>{first?row.weekday:''}</td><td><textarea aria-label={`${row.day}일 일정 ${i+1} 제목`} rows={Math.max(1,Math.ceil(displayTitle(row).length/36))} value={displayTitle(row)} disabled={!!exporting} maxLength={4000} onChange={e=>{const v=e.target.value;setSchedule(s=>s?{...s,rows:s.rows.map((r,j)=>j===i?{...r,title:v,time:''}:r)}:s)}}/></td><td><input aria-label={`${row.day}일 일정 ${i+1} 담당자`} value={row.owner} disabled={!!exporting} maxLength={100} onChange={e=>edit(i,'owner',e.target.value)}/></td></tr>})}</tbody></table></div></>}
    </section></div>
  </section>;
}
