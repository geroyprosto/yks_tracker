import assert from 'node:assert/strict';
import {test} from 'node:test';
import catalog from '../src/lib/catalogs/klu-medicine-2026.json';
import {readFileSync} from 'node:fs';

test('the published KLU catalog covers all 18 committees, eight clerkships and three KEG courses',()=>{
 for(const [year,count] of [[1,5],[2,6],[3,7],[4,8]]){
  const units=catalog.units.filter(unit=>unit.year===year&&unit.kind!=='keg');
  assert.equal(units.length,count);assert.ok(units.every(unit=>unit.weight>0&&unit.topics.length>0));
 }
 assert.equal(catalog.units.filter(unit=>unit.kind==='keg').length,3);
 // The source puts membrane dynamics in the first committee, and the nucleus in the second.
 assert.ok(catalog.units.find(unit=>unit.id==='d1-k1')!.topics.some(topic=>topic.name.includes('Hücre zarı')));
 assert.ok(catalog.units.find(unit=>unit.id==='d1-k2')!.topics.some(topic=>topic.name.includes('Nükleus')));
 assert.ok(catalog.units.find(unit=>unit.id==='d4-s1')!.topics.some(topic=>topic.name.toLocaleLowerCase('tr').includes('diabetes')));
 assert.ok(catalog.units.find(unit=>unit.id==='d4-s4')!.topics.some(topic=>topic.name.includes('EKG')));
 assert.ok(catalog.units.find(unit=>unit.id==='d4-s6')!.topics.some(topic=>topic.name.includes('Frontal ve Temporal')));
 assert.ok(!catalog.units.find(unit=>unit.id==='d4-s7')!.topics.some(topic=>topic.name.includes('Frontal ve Temporal')));
});
test('topic identities are unique, traceable to source pages and exclude teacher names and schedule placeholders',()=>{
 const all=catalog.units.flatMap(unit=>unit.topics);
 assert.equal(new Set(all.map(topic=>topic.id)).size,all.length);
 for(const unit of catalog.units){
  assert.ok(unit.sourceUrl.startsWith('https://tip.klu.edu.tr/'));
  for(const topic of unit.topics){
   assert.ok(topic.pages.length>0&&topic.pages.every(page=>page>0));
   assert.ok(topic.name.trim().length>2&&topic.subject.trim().length>0);
   assert.doesNotMatch(topic.name+' '+topic.subject,/Prof\.|Dr\.|Öğr\.|ÖĞRETİM ÜYESİ|SERBEST ÇALIŞMA|ÖĞLE ARASI/);
  }
 }
});
test('database keys and client catalog cannot diverge during publication',()=>{
 const migration=readFileSync(new URL('../supabase/migrations/20261013220338_kirklareli_medicine.sql',import.meta.url),'utf8');
 for(const unit of catalog.units){
  assert.ok(migration.includes(`('${unit.id}',${unit.year},'${unit.kind}',${unit.weight})`));
  for(const topic of unit.topics)assert.ok(migration.includes(`('${topic.id}','${unit.id}',${unit.year})`));
 }
});

