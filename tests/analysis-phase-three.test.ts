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
test('günlük analizi varsayılan olarak eski paylaşım seçimlerinden bağımsız tüm kayıtlı alanları içerir',()=>{
  const state={...emptyState(),server_now:'2026-09-25T10:00:00Z',journal_entries:[
    journal('2026-09-23',{}),journal('2026-09-24',{exclude_from_analysis:true,ai_shared_fields:['original_text','stress']})]};
  state.settings={journal_analysis_enabled:true} as typeof state.settings;
  const {snapshot}=buildAnalysisSnapshot(state,'2026-09-23','2026-09-24');
  const serialized=JSON.stringify(snapshot);
  assert.ok(serialized.includes('"mood":"iyi"'));
  assert.ok(serialized.includes('ÖZEL GÜNLÜK METNİ'));
  assert.ok(serialized.includes('"stress":4'));
  assert.deepEqual(snapshot.days[1].journal?.fields,{original_text:'ÖZEL GÜNLÜK METNİ',mood:'iyi',stress:4});
});
test('hesap ayarı kapalıyken günlük çıkartılır ve kaynak parmak izi değişir',()=>{
  const state={...emptyState(),server_now:'2026-09-25T10:00:00Z',journal_entries:[journal('2026-09-23',{})]};
  state.settings={journal_analysis_enabled:true} as typeof state.settings;
  const first=buildAnalysisSnapshot(state,'2026-09-23','2026-09-24').sourceHash;
  state.settings={journal_analysis_enabled:false} as typeof state.settings;
  const disabled=buildAnalysisSnapshot(state,'2026-09-23','2026-09-24');
  const second=disabled.sourceHash;
  assert.notEqual(first,second);
  assert.equal(disabled.snapshot.days[0].journal,null);
  assert.ok(!JSON.stringify(disabled.snapshot).includes('ÖZEL GÜNLÜK METNİ'));
  state.settings=null;
  assert.equal(buildAnalysisSnapshot(state,'2026-09-23','2026-09-24').snapshot.days[0].journal,null);
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

test('uzun dönem özeti günlükleri sessizce kesmek yerine daha kısa dönem ister',()=>{
  assert.throws(()=>providerPayload({period:{start:'2026-01-01',end:'2026-09-25'},summary:{data_days:200},
    days:Array.from({length:200},(_,index)=>({date:'2026-01-01',seconds:index,journal:{text:'x'.repeat(4000)}}))}),/daha kısa bir dönem seç/);
});

test('azami uzunluktaki tek günlük çok baytlı metniyle eksiksiz gönderilir',()=>{
  const originalText='ğ'.repeat(20000);
  const raw=providerPayload({days:[{journal:{fields:{original_text:originalText}}}]});
  assert.equal((JSON.parse(raw) as {days:Array<{journal:{fields:{original_text:string}}}>}).days[0].journal.fields.original_text,originalText);
});
