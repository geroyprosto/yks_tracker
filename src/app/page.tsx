import { Dashboard } from '@/components/dashboard';
import { Login } from '@/components/login';
import { getConfiguration } from '@/lib/server/auth';
import { classroomContext } from '@/lib/server/classroom';
import { demoUserId } from '@/lib/server/classroom-demo';
import { ApiError } from '@/lib/server/http';
import { redirect } from 'next/navigation';
import { StudyRealtimeProvider } from '@/lib/realtime-client';

export const dynamic = 'force-dynamic';

export default async function Home() {
  // The setup preview is public only while there is no configured account.
  let account;
  let setupPreview = false;
  try {
    setupPreview = !getConfiguration() && !await demoUserId();
    if (!setupPreview) ({account} = await classroomContext({readOnly:true}));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return <Login />;
    throw error;
  }
  if (setupPreview) return <StudyRealtimeProvider><Dashboard /></StudyRealtimeProvider>;
  if(account?.role==='student'&&account.status==='pending')redirect('/personalize');
  if (!account || account.role !== 'student' || account.status !== 'approved') redirect('/classroom');
  return <StudyRealtimeProvider><Dashboard /></StudyRealtimeProvider>;
}

