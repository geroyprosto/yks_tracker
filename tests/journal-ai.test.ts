import assert from 'node:assert/strict';
import test from 'node:test';
import type {AnalysisProviderConfig} from '../src/lib/server/analysis-provider';
import {journalSuggestionHash} from '../src/lib/server/journal-ai';
import {requestJournalSuggestion, reservedJournalCostUsd, validateJournalSuggestion} from '../src/lib/server/journal-ai-provider';

const keys = ['sleep_at','wake_at','sleep_quality','mood','energy','stress',
  'environment','interruptions','activities','people_tags','food_drink','thoughts'];
function output(fields: Record<string, unknown>, evidence: Record<string, unknown>) {
  return {fields: Object.fromEntries(keys.map(key => [key, fields[key] ?? null])),
    evidence: Object.fromEntries(keys.map(key => [key, evidence[key] ?? null]))};
}
const config: AnalysisProviderConfig = {
  apiKey: 'test-only', model: 'test-model', inputPrice: 10, outputPrice: 50,
  monthlyRequests: 8, monthlyUsd: 2,
};

test('journal suggestions discard unsupported or invented fields', () => {
  const text = '07:30 uyandım. 2 kez bölündüm. Kütüphanede çalıştım ve kahve içtim.';
  const result = validateJournalSuggestion(output({wake_at:'07:30',interruptions:2,
    environment:'Kütüphanede',food_drink:'kahve',stress:5,mood:'mutlu'},
  {wake_at:'07:30 uyandım',interruptions:'2 kez bölündüm',
    environment:'Kütüphanede çalıştım',food_drink:'kahve içtim',
    stress:'çok stresliydim',mood:'mutlu oldum'}),text);
  assert.deepEqual(result,{wake_at:'07:30',interruptions:2,environment:'Kütüphanede',food_drink:'kahve'});
});

test('journal suggestion request is opt-in, stateless, bounded, and returns measured usage', async () => {
  const text='09:15 uyandım.';
  let calls=0;
  const fetcher: typeof fetch = async (_input, init) => {
    calls++;
    const body=JSON.parse(String(init?.body));
    assert.equal(body.store,false);
    assert.equal(body.model,config.model);
    assert.equal(body.input[1].content,text);
    assert.equal(body.text.format.strict,true);
    assert.ok(body.max_output_tokens<=1600);
    return Response.json({status:'completed',output_text:JSON.stringify(output(
      {wake_at:'09:15'}, {wake_at:'09:15 uyandım'})),
      usage:{input_tokens:200,output_tokens:100}});
  };
  const result=await requestJournalSuggestion(config,text,fetcher);
  assert.equal(calls,1);
  assert.deepEqual(result.fields,{wake_at:'09:15'});
  assert.equal(result.usage.input_tokens,200);
  assert.equal(result.cost,0.007);
  assert.ok(reservedJournalCostUsd(config,text)>result.cost);
});

test('same diary text has different cache keys by date or model', () => {
  const first=journalSuggestionHash('2026-09-24','Bugün iyiydim.','model-a');
  assert.notEqual(first,journalSuggestionHash('2026-09-25','Bugün iyiydim.','model-a'));
  assert.notEqual(first,journalSuggestionHash('2026-09-24','Bugün iyiydim.','model-b'));
});
