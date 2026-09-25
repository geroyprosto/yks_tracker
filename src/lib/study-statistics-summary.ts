import type {AppState} from './domain/types';
import {secondsByDay} from './timing';
import {localDate} from './ui';

export type StudyStatisticsSummary={
 totalSeconds:number;
 weekSeconds:number;
 todaySeconds:number;
 completedTasks:number;
 weekCompletedTasks:number;
 todayCompletedTasks:number;
 today:string;
 weekStart:string;
};

/**
 * Headline totals are independent of the selected chart range. Time is actual
 * session time, including saved/current intervals today. Completed tasks belong
 * to their plan_date because the model does not store a completion timestamp.
 */
export function buildStudyStatisticsSummary(state:AppState,now=Date.parse(state.server_now)):StudyStatisticsSummary{
 const timezone=state.settings?.timezone??'Europe/Istanbul';
 const today=localDate(now,timezone);
 const monday=new Date(`${today}T12:00:00Z`);
 monday.setUTCDate(monday.getUTCDate()-((monday.getUTCDay()+6)%7));
 const weekStart=monday.toISOString().slice(0,10);
 const summary:StudyStatisticsSummary={totalSeconds:0,weekSeconds:0,todaySeconds:0,
  completedTasks:0,weekCompletedTasks:0,todayCompletedTasks:0,today,weekStart};
 for(const [date,seconds] of Object.entries(secondsByDay(state,timezone,now))){
  summary.totalSeconds+=seconds;
  if(date>=weekStart&&date<=today)summary.weekSeconds+=seconds;
  if(date===today)summary.todaySeconds+=seconds;
 }
 for(const task of state.tasks){
  if(task.progress<1)continue;
  summary.completedTasks++;
  if(task.plan_date>=weekStart&&task.plan_date<=today)summary.weekCompletedTasks++;
  if(task.plan_date===today)summary.todayCompletedTasks++;
 }
 return summary;
}
