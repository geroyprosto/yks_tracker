import assert from 'node:assert/strict';
import test from 'node:test';
import {buildStudyChartBuckets,summarizeStudyChartBuckets} from '../src/lib/study-statistics-buckets';
import type {StudyDay,StudyDayStatus,StudyReport} from '../src/lib/study-report';

function day(date:string,seconds:number,status:StudyDayStatus,tasks=0):StudyDay{
 return {date,seconds,status,tasks,targetMinutes:null,goalMet:false,sessions:0,exams:0,hasJournal:false};
}

function report(start:string,end:string,days:StudyDay[]):StudyReport{
 return {start,end,days,totalSeconds:0,averageAllSeconds:null,averageWorkedSeconds:null,highestDay:null,
  workedDays:0,goalMetDays:0,restDays:0,zeroDays:0,missingDays:0,subjects:[],topics:[],studyTypes:[]};
}

test('year view uses calendar months and averages only closed observed days',()=>{
 const source=report('2026-01-01','2026-04-10',[
  day('2026-01-01',3600,'worked',2),
  day('2026-01-02',0,'zero',1),
  day('2026-01-03',0,'missing'),
  day('2026-01-04',0,'rest'),
  day('2026-01-05',0,'planned-missing',3),
  day('2026-01-06',7200,'ongoing',1),
  day('2026-02-15',1800,'worked'),
  day('2026-04-09',5400,'worked'),
 ]);
 const buckets=buildStudyChartBuckets(source,'year');
 assert.deepEqual(buckets.map(bucket=>bucket.key),['2026-01','2026-02','2026-03','2026-04']);
 assert.deepEqual([buckets[0].start,buckets[0].end,buckets[3].start,buckets[3].end],
  ['2026-01-01','2026-01-31','2026-04-01','2026-04-10']);
 assert.equal(buckets[0].averageSeconds,1800);
 assert.equal(buckets[0].observedDays,2);
 assert.equal(buckets[0].totalSeconds,10800);
 assert.equal(buckets[0].taskCount,7);
 assert.equal(buckets[1].averageSeconds,1800);
 assert.equal(buckets[2].averageSeconds,null);
 assert.equal(buckets[2].observedDays,0);
 assert.equal(buckets[3].averageSeconds,5400);
});

test('daily buckets distinguish no observation from an explicit zero',()=>{
 const source=report('2026-09-20','2026-09-24',[
  day('2026-09-20',0,'missing'),
  day('2026-09-21',0,'rest'),
  day('2026-09-22',0,'zero'),
  day('2026-09-23',3600,'worked'),
  day('2026-09-24',900,'ongoing'),
 ]);
 const buckets=buildStudyChartBuckets(source,'week');
 assert.deepEqual(buckets.map(bucket=>bucket.averageSeconds),[null,null,0,3600,null]);
 assert.deepEqual(buckets.map(bucket=>bucket.totalSeconds),[0,0,0,3600,900]);
 assert.deepEqual(buckets.map(bucket=>bucket.observedDays),[0,0,1,1,0]);
});

test('custom ranges switch to weekly, monthly, then yearly buckets',()=>{
 const short=buildStudyChartBuckets(report('2026-09-01','2026-09-30',[]),'custom');
 const medium=buildStudyChartBuckets(report('2026-06-01','2026-09-24',[]),'custom');
 const monthly=buildStudyChartBuckets(report('2025-12-25','2026-12-31',[]),'custom');
 const long=buildStudyChartBuckets(report('2020-01-01','2029-12-31',[]),'custom');
 assert.equal(short.length,5);
 assert.ok(short.every(bucket=>bucket.granularity==='week'));
 assert.equal(monthly.length,13);
 assert.ok(monthly.every(bucket=>bucket.granularity==='month'));
 assert.ok(medium.length>=16&&medium.length<=18);
 assert.equal(medium[0].start,'2026-06-01');
 assert.equal(medium.at(-1)?.end,'2026-09-24');
 assert.equal(long.length,10);
 assert.equal(long[0].key,'2020');
 assert.equal(long.at(-1)?.key,'2029');
 assert.ok(long.every(bucket=>bucket.granularity==='year'));
 assert.ok(long.every(bucket=>bucket.averageSeconds===null));
});


test('month view uses clipped calendar weeks, including leap day and current saved time',()=>{
 const buckets=buildStudyChartBuckets(report('2024-02-01','2024-02-29',[
  day('2024-02-01',3600,'worked'),day('2024-02-04',1800,'worked'),
  day('2024-02-05',7200,'worked'),day('2024-02-29',2700,'ongoing'),
 ]),'month');
 assert.equal(buckets.length,5);
 assert.ok(buckets.every(bucket=>bucket.granularity==='week'));
 assert.deepEqual(buckets.map(bucket=>[bucket.start,bucket.end]),[
  ['2024-02-01','2024-02-04'],['2024-02-05','2024-02-11'],['2024-02-12','2024-02-18'],
  ['2024-02-19','2024-02-25'],['2024-02-26','2024-02-29'],
 ]);
 assert.deepEqual(buckets.map(bucket=>bucket.totalSeconds),[5400,7200,0,0,2700]);
 assert.equal(buckets[4].averageSeconds,null);
 const summary=summarizeStudyChartBuckets(buckets);
 assert.equal(summary.totalSeconds,15300);
 assert.equal(summary.averageBucketSeconds,3060);
 assert.equal(summary.bestBucket?.key,'week-2024-02-05');
});

test('week boundaries crossing year and completion counts use task plan dates',()=>{
 const buckets=buildStudyChartBuckets(report('2025-12-29','2026-01-04',[
  day('2025-12-31',3600,'worked',1),day('2026-01-01',1800,'worked',2),
 ]),'week',[
  {plan_date:'2025-12-28',progress:1},{plan_date:'2025-12-31',progress:1},
  {plan_date:'2026-01-01',progress:.5},{plan_date:'2026-01-01',progress:1},
  {plan_date:'2026-01-05',progress:1},
 ]);
 assert.equal(buckets.length,7);
 assert.equal(buckets[0].key,'2025-12-29');
 assert.equal(buckets.at(-1)?.key,'2026-01-04');
 assert.deepEqual(buckets.map(bucket=>bucket.completedTaskCount),[0,0,1,1,0,0,0]);
 const summary=summarizeStudyChartBuckets(buckets);
 assert.equal(summary.completedTaskCount,2);
 assert.equal(summary.averageCompletedTasks,2/7);
 assert.equal(summary.averageBucketSeconds,5400/7);
});

test('monthly and yearly buckets preserve clipped range totals across years',()=>{
 const source=report('2023-12-20','2026-01-03',[
  day('2023-12-19',1000,'worked'),day('2023-12-20',3600,'worked'),
  day('2024-02-29',7200,'worked'),day('2026-01-03',1800,'ongoing'),
  day('2026-01-04',1000,'worked'),
 ]);
 const buckets=buildStudyChartBuckets(source,'custom');
 assert.deepEqual(buckets.map(bucket=>bucket.key),['2023','2024','2025','2026']);
 assert.equal(buckets[0].start,'2023-12-20');
 assert.equal(buckets.at(-1)?.end,'2026-01-03');
 assert.deepEqual(buckets.map(bucket=>bucket.totalSeconds),[3600,7200,0,1800]);
 assert.equal(summarizeStudyChartBuckets(buckets).averageBucketSeconds,3150);
 const months=buildStudyChartBuckets(report('2023-12-20','2024-02-29',source.days),'year');
 assert.deepEqual(months.map(bucket=>bucket.key),['2023-12','2024-01','2024-02']);
 assert.equal(months[2].end,'2024-02-29');
 assert.equal(months[2].totalSeconds,7200);
});

test('empty chart summary has no best bucket and zero totals',()=>{
 assert.deepEqual(summarizeStudyChartBuckets([]),{totalSeconds:0,averageBucketSeconds:0,bestBucket:null,completedTaskCount:0,averageCompletedTasks:0});
 const buckets=buildStudyChartBuckets(report('2026-01-01','2026-01-31',[]),'month');
 assert.equal(summarizeStudyChartBuckets(buckets).bestBucket,null);
});

test('explicit yearly grouping summarizes adjacent calendar years in a short history',()=>{
 const source=report('2025-12-01','2026-02-15',[
  day('2025-12-31',3600,'worked'),day('2026-02-15',1800,'ongoing'),
 ]);
 const buckets=buildStudyChartBuckets(source,'custom',[
  {plan_date:'2025-12-31',progress:1},{plan_date:'2026-02-15',progress:1},
 ],'year');
 assert.deepEqual(buckets.map(bucket=>[bucket.key,bucket.start,bucket.end,bucket.granularity]),[
  ['2025','2025-12-01','2025-12-31','year'],['2026','2026-01-01','2026-02-15','year'],
 ]);
 assert.deepEqual(buckets.map(bucket=>bucket.totalSeconds),[3600,1800]);
 assert.deepEqual(buckets.map(bucket=>bucket.completedTaskCount),[1,1]);
 assert.equal(summarizeStudyChartBuckets(buckets).averageBucketSeconds,2700);
});
