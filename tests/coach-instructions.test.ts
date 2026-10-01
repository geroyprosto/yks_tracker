import assert from 'node:assert/strict';
import test from 'node:test';
import {REPORT_INSTRUCTIONS} from '../src/lib/server/analysis-provider';

test('coach instructions use recorded progress, weekly priority ratios and journals for a concrete next action',()=>{
  assert.match(REPORT_INSTRUCTIONS,/topic_status_by_subject/);
  assert.match(REPORT_INSTRUCTIONS,/weekly_task_priority/);
  assert.match(REPORT_INSTRUCTIONS,/tamamlanan yüksek öncelikli.*planlanan yüksek öncelikli/);
  assert.match(REPORT_INSTRUCTIONS,/uyanma.*stres/);
  assert.match(REPORT_INSTRUCTIONS,/bu hafta konu anlatımını bitir/);
  assert.match(REPORT_INSTRUCTIONS,/Şimdi 20 soru çöz.*verme/);
  assert.match(REPORT_INSTRUCTIONS,/kaçıyor olabilir misin/);
  assert.match(REPORT_INSTRUCTIONS,/planlama tarihi/);
  assert.match(REPORT_INSTRUCTIONS,/resmî.*sınav tarihi/);
});
