export interface PdfWord { text: string; x: number; y: number; width: number; height: number }
export interface PdfPage { page: number; width: number; height: number; items: PdfWord[] }
export interface ScheduleRow { day: number; weekday: string; title: string; owner: string; time: string }
export interface Schedule { year: number; sourceYear: number; month: number; rows: ScheduleRow[]; pages: number; warnings: string[] }
export const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
export function weekday(year: number, month: number, day: number) { return weekdays[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]; }
export function validDate(year: number, month: number, day: number) { const d = new Date(Date.UTC(year, month - 1, day)); return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day; }
const clean = (text: string) => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\s+/g, ' ').trim();
function join(items: PdfWord[]) { return items.sort((a,b) => a.x-b.x).reduce((s, v, i, a) => s + (i && v.x - (a[i-1].x+a[i-1].width) > Math.max(1,v.height*.25) ? ' ' : '') + v.text, '').trim(); }
/** G-ONE monthly print layout: day | time | title | optional owner. No OCR or inference. */
export function parseSchedule(pages: PdfPage[], year: number = new Date().getFullYear()): Schedule {
  const headers = pages.flatMap(p => p.items.filter(w => /^(?:19|20|21)\d{2}\s*[-./년]\s*(?:0?[1-9]|1[0-2])\s*월?$/.test(clean(w.text))).map(w => ({ page:p.page, word:w, match:clean(w.text).match(/(\d{4})\s*[-./년]\s*(\d{1,2})/)! })));
  if (!headers.length) throw new Error('G-ONE 월간 일정표의 연월 제목을 찾지 못했습니다. ‘2026-11’ 같은 제목이 있는 월간 인쇄 PDF를 선택해 주세요.');
  const months = new Set(headers.map(h => Number(h.match[2])));
  if (months.size !== 1) throw new Error('여러 달의 일정표가 섞여 있습니다. 한 달씩 PDF로 내려받아 주세요.');
  const month = Number(headers[0].match[2]), sourceYear = Number(headers[0].match[1]);
  const rows: ScheduleRow[] = []; let currentDay = 0, previousDay = 0; const seen = new Set<number>(); let previousRow: ScheduleRow | null = null;
  let unknownLines = 0;
  for (const page of pages) {
    const titleHeader = headers.find(h=>h.page===page.page)?.word;
    const dayWords = page.items.filter(w=>/^\d{1,2}$/.test(clean(w.text)) && w.x/page.width < .16 && w.y>page.height*.04 && w.y<page.height*.965);
    if (!dayWords.length && !currentDay) continue;
    const dayX = dayWords.length ? dayWords.map(w=>w.x).sort((a,b)=>a-b)[Math.floor(dayWords.length/2)] : page.width*.0945;
    const timeWords = page.items.filter(w=>/^(종일|\d{1,2}:\d{2}\s*[~～–-]\s*\d{1,2}:\d{2})$/.test(clean(w.text)) && w.x>dayX+5 && w.x<page.width*.3);
    if (!timeWords.length && page.items.some(w=>w.x>page.width*.25 && w.y>page.height*.1 && w.y<page.height*.9)) { unknownLines++; continue; }
    const timeRight = timeWords.length ? Math.max(...timeWords.map(w=>w.x+w.width)) : page.width*.22;
    const titleX = page.items.filter(w=>w.x>timeRight+2 && w.y>page.height*.04 && w.y<page.height*.965 && w.height<page.height*.03).map(w=>w.x).sort((a,b)=>a-b)[0];
    if (titleX===undefined) continue;
    const rightColumn = page.width*.67;
    const content = page.items.filter(w=>w.y>page.height*.04 && w.y<page.height*.965 && (!titleHeader || w.y<titleHeader.y-5) && w.x>=dayX-2 && !/^https?:\/\//.test(w.text));
    const lines: { y:number; items:PdfWord[] }[]=[];
    for (const word of content.sort((a,b)=>b.y-a.y || a.x-b.x)) {
      let line=lines.find(l=>Math.abs(l.y-word.y)<Math.max(3,word.height*.55));
      if (!line) {line={y:word.y,items:[]};lines.push(line);} line.items.push(word);
    }
    lines.sort((a,b)=>b.y-a.y);
    for (const line of lines) {
      const dayToken=line.items.find(w=>Math.abs(w.x-dayX)<6 && /^\d{1,2}$/.test(clean(w.text)));
      if (dayToken) {
        const day=Number(dayToken.text);
        if (!validDate(year,month,day)) throw new Error(`${year}년 ${month}월에는 ${day}일이 없습니다. 기기의 현재 연도에 적용할 수 없는 날짜입니다.`);
        if (day<previousDay || seen.has(day)) throw new Error('날짜 순서가 맞지 않거나 중복된 일정표입니다. 한 달의 월간 인쇄 PDF를 선택해 주세요.');
        currentDay=day; previousDay=day;seen.add(day);previousRow=null;
      }
      const time=clean(join(line.items.filter(w=>w.x>dayX+8 && w.x<titleX-3)));
      const title=clean(join(line.items.filter(w=>w.x>=titleX-2 && w.x<rightColumn)));
      const owner=clean(join(line.items.filter(w=>w.x>=rightColumn)));
      if (!currentDay) { if(title)unknownLines++; continue; }
      if (/^(종일|\d{1,2}:\d{2}\s*[~～–-]\s*\d{1,2}:\d{2})$/.test(time)) {
        if(!title) throw new Error(`${currentDay}일 일정의 제목을 읽지 못했습니다. 텍스트가 포함된 G-ONE 월간 PDF인지 확인해 주세요.`);
        const row={day:currentDay,weekday:weekday(year,month,currentDay),title,owner,time};rows.push(row);previousRow=row;
      } else if (title || owner) {
        if (previousRow && !dayToken) { if(title)previousRow.title+=' '+title; if(owner)previousRow.owner+=' '+owner; }
        else unknownLines++;
      }
    }
  }
  if (!rows.length) throw new Error('변환할 일정을 읽지 못했습니다. 스캔 이미지가 아닌 G-ONE 월간 인쇄 PDF를 선택해 주세요.');
  if (unknownLines) throw new Error('읽지 못한 행이 있어 변환을 중단했습니다. G-ONE 월간 인쇄 레이아웃과 다른 PDF일 수 있습니다.');
  if(seen.size<new Date(Date.UTC(sourceYear,month,0)).getUTCDate()) throw new Error('날짜가 누락되어 있습니다. 월간 일정표의 모든 페이지가 포함된 PDF를 선택해 주세요.');
  const complete:ScheduleRow[]=[];
  for(let day=1;validDate(year,month,day);day++) {const events=rows.filter(r=>r.day===day);complete.push(...(events.length?events:[{day,weekday:weekday(year,month,day),title:'',owner:'',time:''}]));}
  const warnings=[];
  if(sourceYear!==year) warnings.push(`PDF 표기 연도 ${sourceYear}년 대신 기기의 현재 연도 ${year}년으로 요일을 계산했습니다.`);
  if(complete.every(r=>!r.owner))warnings.push('PDF에 담당자 이름이 없어 담당자 칸은 비워 두었습니다.');
  warnings.push('PDF의 모든 일정을 원래 순서대로 표시합니다.');
  return {year,sourceYear,month,rows:complete,pages:pages.length,warnings};
}
export function displayTitle(row:ScheduleRow) {
  // Retain times that exist only in the separate PDF time column.
  return row.time && row.time!=='종일' && !row.title.includes(row.time.split(/\s*[~～–-]\s*/)[0]) ? `[${row.time}] ${row.title}` : row.title;
}


