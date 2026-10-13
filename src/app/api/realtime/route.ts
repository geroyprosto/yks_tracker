import {requireAiStudyContext} from '@/lib/server/classroom';
import {createStudyRealtimeGet} from '@/lib/server/study-realtime-route';
import {studyRealtimeRedis} from '@/lib/server/study-realtime';

export const dynamic='force-dynamic';
export const runtime='nodejs';
export const maxDuration=10;

// Every short version check rechecks approved student or the original owner.
export const GET=createStudyRealtimeGet({authorize:requireAiStudyContext,redis:studyRealtimeRedis});
