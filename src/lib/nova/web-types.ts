import type {NovaBaseline,NovaMetrics,NovaProjection,NovaScore,NovaState} from './types';
import type {NovaMetrics as GenerationMetrics} from './telemetry';
export type NovaMessage={id:string;sequence:number;sender:'user'|'nova';content:string;created_at:string;source_message_id:string|null;job_id:string|null;delivery_status:string;result?:{proposedAction?:{type:string;durationMinutes?:number}|null};duel_decision?:string|null};
export type NovaJob={id:string;status:string;kind:string;source_message_id:string|null;attempt_count:number;error:string|null;created_at:string;started_at?:string|null;completed_at:string|null;generation_metrics?:GenerationMetrics|null};
export type NovaMemory={id:string;content:string;status:string;pinned:boolean;source_message_id:string;sensitivity:string;created_at:string;updated_at?:string;tags?:string[];importance?:number};
export type NovaDevice={id:string;name:string;version:string|null;model:string|null;model_available:boolean;last_seen_at:string|null;revoked_at:string|null};
export type NovaSettings={timezone:string;quiet_start:number;quiet_end:number;proactive_enabled:boolean;proactive_daily_limit:number;duel_weekly_limit:number;memory_enabled:boolean;notifications_enabled:boolean;weekly_adaptation_limit:number};
export type NovaWebState={
 serverNow:string;demo:boolean;profile:{id:string;name:string;baseline:NovaBaseline;engine_version:string};
 today:NovaProjection|null;dayInfo:{seed:string;engineVersion:string;localDate:string;startState:NovaState}|null;
 race:{user:NovaScore;nova:NovaScore;userMetrics:NovaMetrics;novaMetrics:NovaMetrics}|null;
 weekly:Array<{localDate:string;userScore:number|null;novaScore:number|null;finalized:boolean}>;
 messages:NovaMessage[];jobs:NovaJob[];memories:NovaMemory[];devices:NovaDevice[];settings:NovaSettings;
 relationship:Record<string,unknown>|null;catchupRemaining:boolean;proactiveCount:number;
};
export type NovaChatState=Pick<NovaWebState,'serverNow'|'messages'|'jobs'|'devices'>;
