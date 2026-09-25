export type ProgressTask={planned_minutes:number;difficulty:'easy'|'medium'|'hard';progress:number;weight_override?:number|null;steps?:{completed:boolean}[]};
export const difficultyFactor={easy:1,medium:1.25,hard:1.5};
export function taskCompletion(task:ProgressTask){return task.steps?.length?task.steps.filter(s=>s.completed).length/task.steps.length:Math.min(1,Math.max(0,task.progress))}
export function taskProgress(tasks:ProgressTask[],factors=difficultyFactor):number|null{
 const weights=tasks.map(t=>t.weight_override??t.planned_minutes*factors[t.difficulty]);
 if(weights.some(w=>!Number.isFinite(w)||w<0)||tasks.some(t=>!Number.isFinite(t.progress)))return null;
 const total=weights.reduce((a,b)=>a+b,0);
 return total>0?100*weights.reduce((sum,w,i)=>sum+w*taskCompletion(tasks[i]),0)/total:null;
}
export function timeProgress(seconds:number,targetMinutes:number):number|null{return Number.isFinite(seconds)&&Number.isFinite(targetMinutes)&&targetMinutes>0?100*Math.max(0,seconds)/(targetMinutes*60):null}
export function combinedProgress(task:number|null,time:number|null,taskShare=.7):number|null{
 if(!Number.isFinite(taskShare)||taskShare<0||taskShare>1)return null;
 const parts=[{value:task,weight:taskShare},{value:time,weight:1-taskShare}].filter(p=>p.value!==null&&Number.isFinite(p.value)&&p.weight>0);
 const weight=parts.reduce((sum,p)=>sum+p.weight,0);
 if(!weight)return null;
 return parts.reduce((sum,p)=>sum+p.weight*Math.min(100,Math.max(0,p.value!)),0)/weight;
}
export function elapsedSeconds(startedAt:string,accumulatedSeconds:number,now=Date.now()){return accumulatedSeconds+Math.max(0,Math.floor((now-new Date(startedAt).getTime())/1000))}

