import assert from 'node:assert/strict';
import test from 'node:test';
import {validateCoachingAnalysis} from '../src/lib/coaching-analysis';
import {requestCoachingAnalysis, type AnalysisProviderConfig} from '../src/lib/server/analysis-provider';

const config:AnalysisProviderConfig={apiKey:'synthetic-key',model:'test',inputPrice:.4,outputPrice:1.6,
  monthlyRequests:4,monthlyUsd:2};
const valid={schema_version:4,directions:[{title:'TYT Kimya · Mol',
  text:'Bu hafta Mol konu anlatımını ve bağımsız uygulamayı tamamla.',topic_id:'topic-1',task_ids:['task-1']}],
  journal_note:'Üç kayıtlı gün için yalnız gün bazında gözlem var.',exam_note:'TYT Coğrafya alt netini ayrı izle.'};

test('v4 provider sends strict schema and returns only verified topic and task references',async()=>{
  let calls=0;
  const fetcher:typeof fetch=async(_url,init)=>{
    calls++;
    const body=JSON.parse(String(init?.body));
    assert.equal(body.store,false);
    assert.equal(body.tools,undefined);
    assert.equal(body.text.format.strict,true);
    assert.deepEqual(body.text.format.schema.required,['schema_version','directions','journal_note','exam_note']);
    assert.match(body.input[0].content,/homework_results/);
    assert.match(body.input[0].content,/weekly_exam/);
    return Response.json({status:'completed',output_text:JSON.stringify(valid),usage:{input_tokens:100,output_tokens:50}});
  };
  const result=await requestCoachingAnalysis(config,'{"coaching":{}}',['topic-1'],['task-1'],fetcher);
  assert.equal(calls,1);
  assert.deepEqual(result.analysis,valid);
  assert.equal(result.cost,.00012);
});

test('v4 validator rejects invented IDs, instantaneous question counts and surplus directions',()=>{
  assert.throws(()=>validateCoachingAnalysis({...valid,directions:[{...valid.directions[0],topic_id:'invented'}]},
    ['topic-1'],['task-1']));
  assert.throws(()=>validateCoachingAnalysis({...valid,directions:[{...valid.directions[0],task_ids:['invented']}]},
    ['topic-1'],['task-1']));
  for(const text of ['Şimdi 20 soru çöz.','Bu hafta 40 soru tamamla.'])
    assert.throws(()=>validateCoachingAnalysis({...valid,directions:[{...valid.directions[0],text}]},
      ['topic-1'],['task-1']));
  assert.throws(()=>validateCoachingAnalysis({...valid,directions:Array(4).fill(valid.directions[0])},
    ['topic-1'],['task-1']));
});

test('invalid provider IDs fail without a second paid request',async()=>{
  let calls=0;
  await assert.rejects(()=>requestCoachingAnalysis(config,'{}',['topic-1'],['task-1'],async()=>{
    calls++;
    return Response.json({status:'completed',output_text:JSON.stringify({...valid,
      directions:[{...valid.directions[0],task_ids:['other-user-task']}]}),usage:{input_tokens:100,output_tokens:50}});
  }),/kaynak doğrulamasını geçmedi/);
  assert.equal(calls,1);
});
