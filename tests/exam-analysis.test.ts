import assert from 'node:assert/strict';
import test from 'node:test';
import type {ExamRecord} from '../src/lib/domain/types';
import {examRange,examSeries,examValue} from '../src/lib/exam-analysis';

const format={code:'TYT' as const,version:1,label:'TYT',total_questions:120,wrong_divisor:4,sections:[{key:'turkish',label:'Türkçe',question_count:40},{key:'math',label:'Matematik',question_count:40},{key:'social',label:'Sosyal',question_count:20},{key:'science',label:'Fen',question_count:20}]};
function exam(id:string,date:string,net:number|null,score:number|null=null):ExamRecord{
 return {id,name:id,publisher:'Test',exam_date:date,format_code:'TYT',format_version:1,format_snapshot:format,duration_minutes:165,notes:'',score,rank:null,source_document_id:null,import_metadata:null,results:net===null?[]:[{section_key:'turkish',correct:null,wrong:null,blank:null,net}],reported_total_net:null,total_net:net,total_net_source:net===null?null:'sections',revision:1,created_at:date+'T09:00:00Z',updated_at:date+'T09:00:00Z'};
}
test('hafta pazartesi başlar; toplam net puandan bağımsızdır',()=>{
 assert.deepEqual(examRange('week','2026-09-24'),{start:'2026-09-21',end:'2026-09-24'});
 assert.equal(examValue(exam('a','2026-09-24',-2.5,312),'total','net'),-2.5);
 assert.equal(examValue(exam('a','2026-09-24',-2.5,312),'turkish','accuracy'),null);
});
test('haftalık grafik boş haftayı sıfıra çevirmeden bırakır ve gerçek örnek sayısını gösterir',()=>{
 const points=examSeries([exam('a','2026-09-07',32),exam('b','2026-09-09',40),exam('c','2026-09-21',-2.5)],{format:'TYT',publisher:'',section:'total',measure:'net',grouping:'week',start:'2026-09-07',end:'2026-09-27'});
 assert.deepEqual(points.map(point=>[point.value,point.count]),[[36,2],[null,0],[-2.5,1]]);
});
test('eksik genel sonuç noktası net trendine katılmaz',()=>{
 const points=examSeries([exam('a','2026-09-21',null),exam('b','2026-09-22',42)],{format:'TYT',publisher:'Test',section:'total',measure:'net',grouping:'exam',start:'2026-09-21',end:'2026-09-24'});
 assert.deepEqual(points.map(point=>[point.value,point.count]),[[null,0],[42,1]]);
});

test('bütün deneme süresi tek derse hız olarak yazılmaz',()=>{
 const result=exam('hız','2026-09-24',40);
 assert.equal(examValue(result,'total','seconds-per-question'),82.5);
 assert.equal(examValue(result,'turkish','seconds-per-question'),null);
});
