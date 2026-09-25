import type {AppState,StudySession} from './domain/types';
import {localDate} from './ui';
export function sessionSeconds(session:StudySession,now=Date.now()){
 const active=session.status==='running'&&session.active_since?Math.max(0,Math.floor((now-Date.parse(session.active_since))/1000)):0;
 const seconds=session.accumulated_seconds+active;
 return session.mode==='countdown'&&session.target_seconds!==null?Math.min(session.target_seconds,seconds):seconds;
}
/** Split actual active intervals at local-date boundaries, including DST zones. No calendar plans enter this function. */
export function secondsByDay(state:Pick<AppState,'intervals'|'sessions'>&Partial<Pick<AppState,'manual_study_entries'>>,timezone='Europe/Istanbul',now=Date.now()){
 const totals:Record<string,number>={};
 const sessions=new Map(state.sessions.map(s=>[s.id,s]));
 for(const interval of state.intervals){
   const session=sessions.get(interval.session_id);if(!session)continue;
   let start=Date.parse(interval.started_at);
   let end=interval.ended_at?Date.parse(interval.ended_at):now;
   if(!interval.ended_at&&session.mode==='countdown'&&session.target_seconds!==null)end=Math.min(end,start+Math.max(0,session.target_seconds-session.accumulated_seconds)*1000);
   if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)continue;
   while(start<end){
     const day=localDate(start,timezone);
     let boundary=end;
     if(localDate(end-1,timezone)!==day){
       let low=start,high=Math.min(end,start+27*3600_000);
       while(high-low>1){const mid=Math.floor((high+low)/2);if(localDate(mid,timezone)===day)low=mid;else high=mid}
       boundary=high;
     }
     totals[day]=(totals[day]??0)+(boundary-start)/1000;
     start=boundary;
   }
 }
 for(const entry of state.manual_study_entries??[]){
   // Reported durations have a date but no clock interval to split.
   totals[entry.study_date]=(totals[entry.study_date]??0)+entry.duration_seconds;
 }
 for(const day in totals)totals[day]=Math.floor(totals[day]);
 return totals;
}

