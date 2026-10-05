import {z} from 'zod';

/** A hint to read authorized state; no records, identities or mutation input. */
export const studyRealtimeSchema={study:{dirty:z.object({}).strict()}};
export type StudyRealtimeEvents=typeof studyRealtimeSchema;
