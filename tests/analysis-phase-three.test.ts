import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAnalysisSnapshot, validAnalysisRange } from '../src/lib/analysis-snapshot';
import { emptyState, type JournalEntry } from '../src/lib/domain/types';
import { dueAnalysisWindow } from '../src/lib/server/analysis';
import { getAnalysisProviderConfig, providerPayload, reservedCostUsd, type AnalysisProviderConfig } from '../src/lib/server/analysis-provider';

function journal(date:string,override:Partial<JournalEntry>):JournalEntry {
  return {id:date,journal_date:date,original_text:'ÖZEL GÜNLÜK METNİ',structured_fields:{mood:'iyi',stress:4},
    exclude_from_analysis:false,ai_shared_fields:['mood'],revision:1,created_at:'2026-09-20T00:00:00Z',
    updated_at:'2026-09-20T00:00:00Z',...override};
}
test('AI özeti sadece açıkça paylaşılan günlük alanlarını içerir',()=>{
  const state={...emptyState(),server_now:'2026-09-25T10:00:00Z',journal_entries:[
    journal('2026-09-23',{}),journal('2026-09-24',{exclude_from_analysis:true,ai_shared_fields:['original_text','stress']})]};
  const {snapshot}=buildAnalysisSnapshot(state,'2026-09-23','2026-09-24');
  const serialized=JSON.stringify(snapshot);
  assert.ok(serialized.includes('"mood":"iyi"'));
  assert.ok(!serialized.includes('ÖZEL GÜNLÜK METNİ'));
  assert.ok(!serialized.includes('"stress":4'));
  assert.equal(snapshot.days[1].journal,null);
});
test('izin veya veri değişimi rapor kaynak parmak izini değiştirir',()=>{
  const state={...emptyState(),server_now:'2026-09-25T10:00:00Z',journal_entries:[journal('2026-09-23',{})]};
  const first=buildAnalysisSnapshot(state,'2026-09-23','2026-09-24').sourceHash;
  state.journal_entries[0].ai_shared_fields=['mood','original_text'];
  const second=buildAnalysisSnapshot(state,'2026-09-23','2026-09-24').sourceHash;
  assert.notEqual(first,second);
});
test('AI aralığı geçersiz takvim gününü, geleceği ve bir yılı aşmayı reddeder',()=>{
  assert.equal(validAnalysisRange('2026-02-30','2026-03-01','2026-09-25'),false);
  assert.equal(validAnalysisRange('2026-09-25','2026-09-26','2026-09-25'),false);
  assert.equal(validAnalysisRange('2025-01-01','2026-09-25','2026-09-25'),false);
  assert.equal(validAnalysisRange('2026-09-01','2026-09-25','2026-09-25'),true);
});
test('14 günlük zamanlayıcı yalnızca tamamlanan pencereyi seçer',()=>{
  assert.equal(dueAnalysisWindow('2026-09-01','2026-09-14'),null);
  assert.deepEqual(dueAnalysisWindow('2026-09-01','2026-09-15'),{start:'2026-09-01',end:'2026-09-14'});
  assert.deepEqual(dueAnalysisWindow('2026-09-01','2026-09-29'),{start:'2026-09-15',end:'2026-09-28'});
});
test('sunucu API anahtarı ve bütçe ayarları olmadan AI yapılandırılmış görünmez',()=>{
  const old={...process.env};
  try{delete process.env.OPENAI_API_KEY;process.env.OPENAI_MODEL='gpt-6-astra';
    assert.equal(getAnalysisProviderConfig(),null);
  }finally{process.env=old;}
});
test('ücret rezervasyonu giriş ve çıkış için üst sınır kullanır',()=>{
  const config:AnalysisProviderConfig={apiKey:'test',model:'test',inputPrice:10,outputPrice:50,monthlyRequests:10,monthlyUsd:2};
  assert.ok(reservedCostUsd(config,'bir rapor')>=0.11);
});

test('uzun dönem özeti sağlayıcı girdi sınırını aşmaz',()=>{
  const payload=providerPayload({period:{start:'2026-01-01',end:'2026-09-25'},summary:{data_days:200},
    days:Array.from({length:200},(_,index)=>({date:'2026-01-01',seconds:index,journal:{text:'x'.repeat(4000)}}))});
  assert.ok(Buffer.byteLength(payload,'utf8')<=32000);
  assert.ok(!payload.includes('x'.repeat(4000)));
});
