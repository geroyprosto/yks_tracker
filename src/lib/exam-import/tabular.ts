import type {ImportCandidate, ImportResultSuggestion} from './types';

type Cell = {text:string;x:number;y:number};
type Column = {key:string;label:string;capacity:number|null;headers:[number,number,number]};

const normalize=(value:string)=>value.normalize('NFKC').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
const fold=(value:string)=>normalize(value).toLocaleLowerCase('tr-TR')
  .replaceAll('ı','i').replaceAll('ğ','g').replaceAll('ü','u')
  .replaceAll('ş','s').replaceAll('ö','o').replaceAll('ç','c');
const number=(value:string)=>{
  const clean=value.replace(',','.');
  return /^-?\d+(?:\.\d+)?$/.test(clean)?Number(clean):null;
};
const sections=[
  {key:'turkce',label:'TÜRKÇE',capacity:40},
  {key:'tarih',label:'TARİH',capacity:5},
  {key:'cografya',label:'COĞRAFYA',capacity:5},
  {key:'felsefe',label:'FELSEFE',capacity:5},
  {key:'din',label:'DİN',capacity:5},
  {key:'secimli_felsefe',label:'S.FELSEFE',capacity:5},
  {key:'matematik',label:'MATEMATİK',capacity:40},
  {key:'fizik',label:'FİZİK',capacity:7},
  {key:'kimya',label:'KİMYA',capacity:7},
  {key:'biyoloji',label:'BİYOLOJİ',capacity:6},
  {key:'toplam',label:'TOPLAMLAR',capacity:null},
] as const;

function cells(items:unknown[]):Cell[]{
  return items.flatMap(item=>{
    if(!item||typeof item!=='object'||!('str' in item)||!('transform' in item))return [];
    const value=item as {str:unknown;transform:unknown};
    if(typeof value.str!=='string'||!Array.isArray(value.transform))return [];
    const x=Number(value.transform[4]),y=Number(value.transform[5]);
    const text=normalize(value.str);
    return text&&Number.isFinite(x)&&Number.isFinite(y)?[{text,x,y}]:[];
  });
}

function nearestNumber(row:Cell[],x:number):number|null{
  const closest=row.filter(cell=>Math.abs(cell.x-x)<8)
    .sort((a,b)=>Math.abs(a.x-x)-Math.abs(b.x-x))[0];
  return closest?number(closest.text):null;
}

// General result reports print many students in one wide D/Y/Net table. Parse only
// when the complete TYT header is present, so ordinary single-result PDFs keep
// using the more permissive line parser.
export function parseTabularTytPage(items:unknown[],page:number):ImportCandidate[]{
  const all=cells(items);
  const title=all.find(cell=>/\btyt\b/.test(fold(cell.text))&&/\b(deneme|prova|sonuc)\b/.test(fold(cell.text)));
  if(!title||!all.some(cell=>fold(cell.text)==='genel sonuc raporu'))return [];
  const headings=all.filter(cell=>sections.some(section=>fold(cell.text)===fold(section.label)))
    .sort((a,b)=>a.x-b.x);
  if(headings.length!==sections.length||headings.some((cell,index)=>fold(cell.text)!==fold(sections[index].label)))return [];
  const headerY=headings[0].y;
  if(headings.some(cell=>Math.abs(cell.y-headerY)>3))return [];
  const markers=all.filter(cell=>Math.abs(cell.y-headerY)<20&&cell.y<headerY&&
    cell.x>headings[0].x-25&&cell.x<headings.at(-1)!.x+32&&/^(d|y|net)$/i.test(cell.text))
    .sort((a,b)=>a.x-b.x);
  if(markers.length!==sections.length*3||markers.some((cell,index)=>fold(cell.text)!==['d','y','net'][index%3]))return [];
  const columns:Column[]=sections.map((section,index)=>({
    ...section,headers:[markers[index*3].x,markers[index*3+1].x,markers[index*3+2].x],
  }));
  const markerY=markers[0].y;
  const scoreX=all.find(cell=>Math.abs(cell.y-markerY)<2&&fold(cell.text)==='tyt'&&cell.x>markers.at(-1)!.x)?.x;
  const rankX=all.filter(cell=>Math.abs(cell.y-markerY)<2&&fold(cell.text)==='genel'&&cell.x>(scoreX??markers.at(-1)!.x))
    .sort((a,b)=>b.x-a.x)[0]?.x;
  const names=all.filter(cell=>cell.x<markers[0].x-130&&cell.y<markerY-3&&
    cell.text.length>1&&!/ortalama/i.test(fold(cell.text)))
    .sort((a,b)=>b.y-a.y);
  const candidates:ImportCandidate[]=[];
  const publisher=title.text.split(/\s*[-–]\s*/)[0]?.trim().slice(0,120)??null;
  for(const student of names){
    const row=all.filter(cell=>Math.abs(cell.y-student.y)<1.6&&cell.x>markers[0].x-10);
    const first=nearestNumber(row,columns[0].headers[0]);
    if(first===null||!Number.isInteger(first)||first<0||first>40)continue;
    const warnings=["Sınav tarihi tabloda açıkça yazmıyor; kaydetmeden önce tarihi seç."];
    const results:ImportResultSuggestion[]=[];
    let optionalUsed=false;
    for(const column of columns){
      const [correctX,wrongX,netX]=column.headers;
      const correct=nearestNumber(row,correctX),wrong=nearestNumber(row,wrongX),printedNet=nearestNumber(row,netX);
      if(column.key==='toplam')continue;
      if(column.key==='secimli_felsefe'){
        optionalUsed=Boolean((correct??0)!==0||(wrong??0)!==0||(printedNet??0)!==0);
        continue;
      }
      if(correct===null||wrong===null||printedNet===null||
        !Number.isInteger(correct)||!Number.isInteger(wrong)||correct<0||wrong<0||
        correct+wrong>column.capacity!){
        warnings.push(`${column.label} satırı güvenle okunamadı; PDF ile karşılaştır.`);
        continue;
      }
      const uncertain=Math.abs(correct-wrong/4-printedNet)>0.011;
      if(uncertain)warnings.push(`${column.label} neti doğru/yanlış hesabıyla uyuşmuyor.`);
      results.push({section_key:column.key,correct,wrong,source_page:page,
        raw:`${column.label}: D ${correct}, Y ${wrong}, Net ${printedNet}`,uncertain});
    }
    if(optionalUsed)warnings.push('Seçmeli Felsefe sonuçları var; TYT şablonunda ayrı alan olmadığı için toplamı kontrol et.');
    const total=columns.at(-1)!;
    const totalCorrect=nearestNumber(row,total.headers[0]);
    const totalWrong=nearestNumber(row,total.headers[1]);
    const totalNet=nearestNumber(row,total.headers[2]);
    const validTotal=totalNet!==null&&totalNet>=-30&&totalNet<=120;
    if(!optionalUsed&&results.length===9&&totalCorrect!==null&&totalWrong!==null&&
      (results.reduce((sum,result)=>sum+(result.correct??0),0)!==totalCorrect||
       results.reduce((sum,result)=>sum+(result.wrong??0),0)!==totalWrong))
      warnings.push('Ders doğru/yanlış toplamları rapordaki genel toplamla uyuşmuyor.');
    const totalUncertain=validTotal&&totalCorrect!==null&&totalWrong!==null&&
      Math.abs(totalCorrect-totalWrong/4-totalNet)>0.011;
    if(totalUncertain)warnings.push('Genel net, toplam doğru/yanlış hesabıyla uyuşmuyor.');
    if(!validTotal)warnings.push('Genel net güvenle okunamadı.');
    const score=scoreX===undefined?null:nearestNumber(row,scoreX);
    const rank=rankX===undefined?null:nearestNumber(row,rankX);
    if(results.length===0&&!validTotal)continue;
    candidates.push({index:candidates.length,label:`${student.text} · TYT${validTotal?` · ${totalNet} net`:''}`,
      student_label:student.text,format_code:'TYT',exam_date:null,name:title.text.slice(0,240),
      publisher,score:score!==null&&score>=0&&score<=1000?score:null,
      rank:rank!==null&&Number.isInteger(rank)&&rank>0?rank:null,
      results,reported_total_net:validTotal?totalNet:null,
      reported_total_source:validTotal?{source_page:page,
        raw:`Toplamlar: D ${totalCorrect??'?'}, Y ${totalWrong??'?'}, Net ${totalNet}`,
        uncertain:Boolean(totalUncertain)}:null,
      source_pages:[page],warnings});
    if(candidates.length===50)break;
  }
  return candidates;
}
