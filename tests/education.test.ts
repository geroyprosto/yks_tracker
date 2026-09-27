import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {commandSchema} from '../src/lib/domain/commands';
import {defaultSetup,educationCommandSchema,normalizeCourseName,setupSchema} from '../src/lib/education';

test('education and YKS goal are independent and roles never enter personalization',()=>{
 const setup=defaultSetup();setup.profile.grade=10;
 assert.equal(setupSchema.safeParse(setup).success,true);
 setup.profile.education_level='university';setup.profile.grade=null;
 assert.equal(setupSchema.safeParse(setup).success,true);
 assert.equal(setupSchema.safeParse({...setup,profile:{...setup.profile,role:'admin'}}).success,false);
});
test('course normalization handles Turkish case, composition and whitespace, preserving context',()=>{
 assert.equal(normalizeCourseName('  BİLİŞİM  Teknolojileri '),'bilişim teknolojileri');
 assert.equal(normalizeCourseName('IŞIK'),'ışık');
 const setup=defaultSetup();setup.term={academic_year:'2026–2027',name:'Güz'};
 setup.courses=[{name:'MATEMATİK',context:'school'},{name:' Matematik ',context:'school'}];
 assert.equal(setupSchema.safeParse(setup).success,false);
 setup.courses[1]={name:'Matematik',context:'yks',exam:'TYT'};
 assert.equal(setupSchema.safeParse(setup).success,true);
});
test('unfinished drafts stay resumable but committing still validates every profile field',()=>{
 const setup=defaultSetup();setup.profile.grade=null;setup.term={academic_year:'',name:''};
 assert.equal(educationCommandSchema.safeParse({request_id:randomUUID(),type:'draft.save',payload:{expected_revision:0,step:1,data:setup}}).success,true);
 assert.equal(educationCommandSchema.safeParse({request_id:randomUUID(),type:'profile.save',payload:{expected_revision:0,...setup}}).success,false);
});
test('score zero is valid, blank is not zero and duration correction has no API command',()=>{
 const row={course_id:randomUUID(),exam_date:'2026-09-27',assessment_type:'Vize',score:0,scale:100};
 const batch=(rows:unknown[])=>educationCommandSchema.safeParse({request_id:randomUUID(),type:'results.batch',payload:{rows}}).success;
 assert.equal(batch([row]),true);assert.equal(batch([{...row,score:''}]),false);
 assert.equal(batch([{...row,score:16,scale:20}]),true);assert.equal(batch([{...row,score:21,scale:20}]),false);
 assert.equal(batch([{...row,exam_date:'2026-02-31'}]),false);
 assert.equal(commandSchema.safeParse({request_id:randomUUID(),type:'timer.correct',payload:{id:randomUUID(),expected_revision:1,confirmed_seconds:1,reason:'test'}}).success,false);
 const manual={request_id:randomUUID(),type:'manual_study.create',payload:{course_id:randomUUID(),confirmed_by_user:true,study_date:'2026-09-26',minutes:15}};
 assert.equal(commandSchema.safeParse(manual).success,true);
 assert.equal(commandSchema.safeParse({...manual,payload:{...manual.payload,course_id:null}}).success,false);
});
