import { z } from 'zod';

export const leaderChatInputSchema = z.strictObject({
  id: z.uuid(),
  content: z.string().trim().min(1).max(4000),
});
export const leaderChatMessageSchema = z.strictObject({
  id: z.uuid(),
  author: z.enum(['user', 'leader']),
  content: z.string().min(1).max(6000),
  reply_to: z.uuid().nullable(),
  status: z.enum(['pending', 'done', 'expired']),
  created_at: z.iso.datetime({ offset: true }),
});
export const leaderChatMessagesSchema = z.array(leaderChatMessageSchema).max(60);
export type LeaderChatMessage = z.infer<typeof leaderChatMessageSchema>;
