import type { AppState } from '../domain/types';

export type ClassroomRole = 'admin' | 'teacher' | 'student';
export type ClassroomAccountStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
export type ClassroomMessageCategory = 'warning' | 'praise' | 'continue' | 'excellent';

export type ClassroomAccount = {
  id: string; name: string; email: string; role: ClassroomRole; status: ClassroomAccountStatus;
  teacher_id: string | null; created_at: string; updated_at: string;
};
export type ClassroomApplication = {
  id: string; user_id: string; name: string; email: string; requested_role: 'teacher' | 'student';
  teacher_id: string | null; status: 'pending' | 'approved' | 'rejected'; created_at: string;
  reviewed_at: string | null; reviewed_by: string | null;
};
export type ClassroomInvite = {
  id: string; teacher_id: string; token: string; expires_at: string; revoked_at: string | null; created_at: string;
};
export type ClassroomMessage = {
  id: string; teacher_id: string; student_id: string; sender_id: string; parent_id: string | null;
  category: ClassroomMessageCategory; body: string; created_at: string; read_at: string | null;
};
export type ClassroomAlert = {
  id: string; teacher_id: string; student_id: string; body: string; kind: 'initial' | 'followup';
  parent_id: string | null; status: 'pending' | 'accepted' | 'declined' | 'dismissed' | 'cancelled';
  refusal_count: number; created_at: string; accepted_at: string | null; followup_due_at: string | null;
  started_at: string | null; closed_at: string | null;
};
export type ClassroomFeedback = {
  id: string; alert_id: string; teacher_id: string; student_id: string;
  event: 'accepted' | 'started' | 'refused_ten' | 'followup_acknowledged'; body: string; created_at: string;
};
export type ClassroomPresence = {
  online: boolean; status: 'working' | 'break' | 'online' | 'offline';
  last_seen: string | null; session_id: string | null;
};
export type ClassroomStudent = {
  id: string; name: string; teacher_id: string; state: AppState; presence: ClassroomPresence;
};
export type ClassroomState = {
  account: ClassroomAccount | null; accounts: ClassroomAccount[]; applications: ClassroomApplication[];
  invites: ClassroomInvite[]; messages: ClassroomMessage[]; alerts: ClassroomAlert[];
  feedback: ClassroomFeedback[]; students: ClassroomStudent[]; server_now: string;
};
