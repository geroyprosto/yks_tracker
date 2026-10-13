import { teacherFeaturesEnabled, teacherFeaturesPausedMessage } from '../classroom/availability';
import type { AccountIdentity } from './classroom-application';
import { ApiError } from './http';

export function isPausedPresenceCommand(type: string) {
  return !teacherFeaturesEnabled && (type === 'presence.heartbeat' || type === 'presence.leave');
}

export function requireClassroomCommandAvailable(account: AccountIdentity | null, type: string) {
  if (teacherFeaturesEnabled) return;
  const administrative = account?.role === 'admin' && ['application.review', 'account.suspend', 'account.delete', 'student.remove'].includes(type);
  const leaving = account?.role === 'student' && type === 'student.remove';
  if (!administrative && !leaving) throw new ApiError(503, 'TEACHER_FEATURES_PAUSED', teacherFeaturesPausedMessage);
}

export function pausedTeacherState(account: AccountIdentity | null) {
  if (teacherFeaturesEnabled || account?.role !== 'teacher') return null;
  return {
    account, teacher_features_paused: true, server_now: new Date().toISOString(),
    accounts: [], applications: [], invites: [], messages: [], alerts: [], feedback: [], students: [],
  };
}
