import {createHash} from 'node:crypto';
import {scoreDay} from './core';
import type {NovaMetrics} from './types';

/** Compare like evidence: an unrecorded component must not advantage either side. */
export function comparisonScores(user: NovaMetrics, nova: NovaMetrics) {
 const a={...user},b={...nova};
 for(const key of Object.keys(a) as (keyof NovaMetrics)[])if(a[key]===null||b[key]===null){a[key]=null;b[key]=null;}
 return {user:scoreDay(a),nova:scoreDay(b)};
}
export function nextDate(day:string){return new Date(Date.parse(day+'T12:00:00Z')+86400000).toISOString().slice(0,10);}
export function catchupDates(first:string,last:string,limit=7){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(first)||!/^\d{4}-\d{2}-\d{2}$/.test(last))throw new Error('INVALID_DATE');
 const result:string[]=[];
 for(let date=first;date<=last&&result.length<Math.min(7,Math.max(0,limit));date=nextDate(date))result.push(date);
 return result;
}
export function sha256(value:string){return createHash('sha256').update(value).digest('hex');}
