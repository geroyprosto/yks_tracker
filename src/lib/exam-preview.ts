import type {ExamFormat,ExamRecord} from './domain/types';

const tyt:ExamFormat={code:'TYT',version:1,label:'TYT · örnek şablon',total_questions:120,wrong_divisor:4,sections:[{key:'turkce',label:'Türkçe',question_count:40},{key:'tarih',label:'Tarih',question_count:5},{key:'cografya',label:'Coğrafya',question_count:5},{key:'felsefe',label:'Felsefe',question_count:5},{key:'din',label:'Din Kültürü',question_count:5},{key:'matematik',label:'Temel Matematik',question_count:40},{key:'fizik',label:'Fizik',question_count:7},{key:'kimya',label:'Kimya',question_count:7},{key:'biyoloji',label:'Biyoloji',question_count:6}]};
const ayt:ExamFormat={code:'AYT_SAYISAL',version:1,label:'AYT Sayısal · örnek şablon',total_questions:80,wrong_divisor:4,sections:[{key:'matematik',label:'Matematik',question_count:40},{key:'fizik',label:'Fizik',question_count:14},{key:'kimya',label:'Kimya',question_count:13},{key:'biyoloji',label:'Biyoloji',question_count:13}]};
const branch:ExamFormat={code:'BRANCH',version:1,label:'Branş · örnek şablon',total_questions:40,wrong_divisor:4,sections:[{key:'branch',label:'Branş',question_count:40}]};
export const previewExamFormats=[tyt,ayt,branch];
function prior(day:string,count:number){const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-count);return date.toISOString().slice(0,10)}
export function previewExams(today:string,stamp:string,prefix:string):ExamRecord[]{
 const samples:[ExamFormat,number,number[],string][]=[
  [tyt,48,[24,3,3,3,3,18,3,3,3],'Örnek · TYT 1'],
  [tyt,34,[27,3,4,3,4,21,4,4,3],'Örnek · TYT 2'],
  [tyt,20,[29,4,4,4,4,24,4,4,4],'Örnek · TYT 3'],
  [tyt,6,[30,4,4,4,4,25,5,5,4],'Örnek · TYT 4'],
  [ayt,41,[18,7,7,7],'Örnek · AYT 1'],
  [ayt,24,[21,8,8,8],'Örnek · AYT 2'],
  [ayt,10,[23,9,8,9],'Örnek · AYT 3'],
 ];
 return samples.map(([format,daysBack,nets,name],index)=>({id:prefix+'exam_'+index,name,publisher:'Örnek Yayın',exam_date:prior(today,daysBack),format_code:format.code,format_version:format.version,format_snapshot:format,duration_minutes:format.code==='TYT'?165:180,notes:'Yalnızca etiketli önizleme kaydı.',score:null,rank:null,source_document_id:null,import_metadata:null,results:format.sections.map((section,i)=>({section_key:section.key,correct:null,wrong:null,blank:null,net:nets[i]})),reported_total_net:null,total_net:nets.reduce((sum,value)=>sum+value,0),total_net_source:'sections',revision:1,created_at:stamp,updated_at:stamp}));
}
