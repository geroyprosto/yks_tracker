import {requireAiStudyContext} from '@/lib/server/classroom';
import {createStudyRealtimeGet} from '@/lib/server/study-realtime-route';
import {studyRealtimeRedis} from '@/lib/server/study-realtime';

export const dynamic='force-dynamic';
export const runtime='nodejs';
export const maxDuration=60;

// Every handshake/reconnection rechecks approved student or the original owner.
export const GET=createStudyRealtimeGet({authorize:requireAiStudyContext,redis:studyRealtimeRedis});
