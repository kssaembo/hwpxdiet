import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { parseSchedule, type PdfPage } from './scheduleModel';
GlobalWorkerOptions.workerSrc = workerUrl;
export async function readSchedule(file:File, signal:AbortSignal, onProgress:(value:number)=>void) {
  if(file.size>30*1024*1024)throw new Error('30MB 이하의 G-ONE 월간 인쇄 PDF를 선택해 주세요.');
  signal.throwIfAborted();
  const base=new URL(import.meta.env.BASE_URL,document.baseURI);
  const loading=getDocument({data:new Uint8Array(await file.arrayBuffer()),cMapUrl:new URL('pdf-assets/cmaps/',base).href,cMapPacked:true,standardFontDataUrl:new URL('pdf-assets/standard_fonts/',base).href,useSystemFonts:true,isEvalSupported:false,useWasm:false});
  const abort=()=>{ void loading.destroy(); };signal.addEventListener('abort',abort,{once:true});
  try {
    const pdf=await loading.promise;signal.throwIfAborted();
    if(pdf.numPages>100)throw new Error('100페이지 이하의 월간 인쇄 PDF를 선택해 주세요.');
    const pages:PdfPage[]=[];
    for(let i=1;i<=pdf.numPages;i++){
      signal.throwIfAborted();const p=await pdf.getPage(i);const text=await p.getTextContent();
      const items=text.items.flatMap(item=>'str' in item && item.str.trim() ? [{text:item.str,x:item.transform[4],y:item.transform[5],width:item.width,height:item.height}]:[]);
      pages.push({page:i,width:p.view[2]-p.view[0],height:p.view[3]-p.view[1],items});p.cleanup();onProgress(Math.round(i/pdf.numPages*100));
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    signal.throwIfAborted();return parseSchedule(pages,new Date().getFullYear());
  } catch(e) {
    if(signal.aborted)throw new DOMException('변환을 취소했습니다.','AbortError');
    if(e instanceof Error && e.name==='PasswordException')throw new Error('암호가 설정된 PDF는 지원하지 않습니다. 암호가 없는 월간 인쇄 PDF를 선택해 주세요.');
    throw e;
  } finally { signal.removeEventListener('abort',abort);await loading.destroy(); }
}
