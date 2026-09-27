'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppState } from '@/lib/domain/types';

export type Account = { id: string; name: string; email: string; role: 'admin' | 'teacher' | 'student'; status: 'pending' | 'approved' | 'rejected' | 'suspended'; teacher_id: string | null; created_at: string; updated_at: string };
export type Application = { id: string; user_id: string; name: string; email: string; requested_role: 'teacher' | 'student'; teacher_id: string | null; status: string; created_at: string; reviewed_at: string | null };
export type Invite = { id: string; teacher_id: string; token: string; expires_at: string; revoked_at: string | null; created_at: string };
export type Category = 'warning' | 'praise' | 'continue' | 'excellent';
export type Message = { id: string; teacher_id: string; student_id: string; sender_id: string; parent_id: string | null; category: Category; body: string; created_at: string; read_at: string | null };
export type StudyAlert = { id: string; teacher_id: string; student_id: string; body: string; kind: 'initial' | 'followup'; parent_id: string | null; status: 'pending' | 'accepted' | 'declined' | 'dismissed' | 'cancelled'; refusal_count: number; created_at: string; accepted_at: string | null; started_at: string | null; followup_due_at: string | null; closed_at: string | null };
export type Feedback = { id: string; alert_id: string; teacher_id: string; student_id: string; event: string; body: string; created_at: string };
export type Student = { id: string; name: string; teacher_id: string; state: AppState; presence: { online: boolean; status: 'working' | 'break' | 'online' | 'offline'; last_seen: string | null; session_id: string | null; simulated?: boolean } };
export type ClassroomState = { account: Account | null; accounts?: Account[]; applications: Application[]; invites: Invite[]; messages: Message[]; alerts: StudyAlert[]; feedback: Feedback[]; students: Student[]; server_now: string; demo?: boolean; email_configured?: boolean; email_preview?: { subject: string; body: string; to: string }[] };
export type Command = (type: string, payload: Record<string, unknown>) => Promise<boolean>;

export const categories: Record<Category, { label: string; icon: string }> = {
  warning: { label: 'Uyarı', icon: '!' }, praise: { label: 'Takdir', icon: '★' }, continue: { label: 'Devam', icon: '↗' }, excellent: { label: 'Çok iyisin', icon: '✦' },
};
export const roleLabel = { admin: 'Yönetici', teacher: 'Öğretmen', student: 'Öğrenci' };
export const statusLabel: Record<string, string> = { pending: 'Onay bekliyor', approved: 'Onaylandı', rejected: 'Reddedildi', suspended: 'Erişim durduruldu' };
export function formatDate(value: string | null | undefined, time = true) {
  if (!value) return 'Henüz veri yok';
  return new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short', ...(time ? { hour: '2-digit', minute: '2-digit' } as const : {}) }).format(new Date(value));
}
export function errorMessage(body: { error?: string | { message?: string }; message?: string }, fallback: string) {
  return typeof body.error === 'string' ? body.error : body.error?.message ?? body.message ?? fallback;
}
export function useClassroom(enabled = true) {
  const [state, setState] = useState<ClassroomState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const retries = useRef(new Map<string, string>());
  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const response = await fetch('/api/classroom', { cache: 'no-store' });
      const body = await response.json();
      if (response.status === 401) {
        setState({ account: null, applications: [], invites: [], messages: [], alerts: [], feedback: [], students: [], server_now: new Date().toISOString() });
        setError(''); return;
      }
      if (!response.ok) throw new Error(errorMessage(body, 'Sınıf bilgileri yüklenemedi.'));
      setState(body.state ?? body); setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Bağlantı kurulamadı.'); }
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    queueMicrotask(() => void refresh());
    const events = new EventSource('/api/classroom/events');
    const update = () => void refresh();
    events.addEventListener('message', update); events.addEventListener('dirty', update);
    const reconnect = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('online', update); document.addEventListener('visibilitychange', reconnect);
    return () => { events.close(); window.removeEventListener('online', update); document.removeEventListener('visibilitychange', reconnect); };
  }, [enabled, refresh]);
  const command: Command = useCallback(async (type, payload) => {
    if (pending.current) return false;
    pending.current = true; setBusy(true); setError('');
    const fingerprint = JSON.stringify({ type, payload });
    const requestId = retries.current.get(fingerprint) ?? crypto.randomUUID();
    retries.current.set(fingerprint, requestId);
    try {
      const response = await fetch('/api/classroom', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: requestId, type, payload }) });
      const body = await response.json();
      if (!response.ok) { if (response.status < 500) retries.current.delete(fingerprint); throw new Error(errorMessage(body, 'İşlem tamamlanamadı.')); }
      retries.current.delete(fingerprint);
      if (body.state) setState(previous => ({ ...previous, ...body.state })); else await refresh();
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Bağlantı kurulamadı. Tekrar deneyebilirsin.'); return false; }
    finally { pending.current = false; setBusy(false); }
  }, [refresh]);
  return { state, error, busy, command, refresh };
}
