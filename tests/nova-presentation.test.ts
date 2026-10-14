import {test} from 'node:test';
import assert from 'node:assert/strict';
import {comparisonScores,catchupDates} from '../src/lib/nova/presentation';
import {weeklyRaceSummary} from '../src/lib/nova/race-summary';
import type {NovaMetrics} from '../src/lib/nova/types';
const metric:NovaMetrics={tasksCompleted:1,taskTotal:2,studyMinutes:60,studyTargetMinutes:120,questions:50,questionTarget:100,accuracyPercent:80,topicProgress:1,topicTarget:2,activeDays:7,observedDays:14};
test('comparison uses identical evidence and weights for both racers',()=>{
 const {user,nova}=comparisonScores({...metric,accuracyPercent:null,topicProgress:null},metric);
 assert.equal(user.total,nova.total);assert.equal(user.components.topics,null);assert.equal(nova.components.topics,null);
 assert.deepEqual(user.weights,nova.weights);
});
test('weekly totals include only completed shared days, never a missing side or the current day',()=>{
 const summary=weeklyRaceSummary([
  {localDate:'2026-10-07',userScore:45.5,novaScore:55.5,finalized:true},
  {localDate:'2026-10-08',userScore:null,novaScore:100,finalized:true},
  {localDate:'2026-10-09',userScore:100,novaScore:null,finalized:true},
  {localDate:'2026-10-10',userScore:60,novaScore:40,finalized:true},
  {localDate:'2026-10-11',userScore:0,novaScore:0,finalized:true},
  {localDate:'2026-10-12',userScore:null,novaScore:null,finalized:true},
  {localDate:'2026-10-13',userScore:90,novaScore:85,finalized:false},
 ]);
 assert.deepEqual(summary,{userTotal:105.5,novaTotal:95.5,includedDays:3});
});
test('weekly no-data remains null rather than zero or an invented winner',()=>{
 assert.deepEqual(weeklyRaceSummary([]),{userTotal:null,novaTotal:null,includedDays:0});
 assert.deepEqual(weeklyRaceSummary([
  {localDate:'2026-10-12',userScore:null,novaScore:60,finalized:true},
  {localDate:'2026-10-13',userScore:100,novaScore:100,finalized:false},
 ]),{userTotal:null,novaTotal:null,includedDays:0});
});
test('catch-up preserves calendar order and is bounded',()=>{
 assert.deepEqual(catchupDates('2026-10-01','2026-10-10',3),['2026-10-01','2026-10-02','2026-10-03']);
 assert.deepEqual(catchupDates('2026-10-10','2026-10-01',3),[]);
 assert.deepEqual(catchupDates('2026-12-31','2027-01-01',7),['2026-12-31','2027-01-01']);
});
