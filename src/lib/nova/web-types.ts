import type {NovaBaseline,NovaMetrics,NovaProjection,NovaScore,NovaState} from './types';
export type NovaSettings={timezone:string;weekly_adaptation_limit:number};
export type NovaWebState={
 serverNow:string;demo:boolean;profile:{id:string;name:string;baseline:NovaBaseline;engine_version:string};
 today:NovaProjection|null;dayInfo:{seed:string;engineVersion:string;localDate:string;startState:NovaState}|null;
 race:{user:NovaScore;nova:NovaScore;userMetrics:NovaMetrics;novaMetrics:NovaMetrics}|null;
 weekly:Array<{localDate:string;userScore:number|null;novaScore:number|null;finalized:boolean}>;
 settings:NovaSettings;catchupRemaining:boolean;
};
