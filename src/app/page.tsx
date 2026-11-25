import { DashboardEntry } from '@/components/dashboard-entry';
import { Login } from '@/components/login';
import { getConfiguration } from '@/lib/server/auth';
import { classroomContext } from '@/lib/server/classroom';
import { demoUserId } from '@/lib/server/classroom-demo';
import { ApiError } from '@/lib/server/http';
import { getState } from '@/lib/server/service';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

async function loadInitialState(client: Parameters<typeof getState>[0], userId: string) {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getState(client, userId).catch(() => null),
      new Promise<null>(resolve => { deadline = setTimeout(() => resolve(null), 6000); }),
    ]);
  } finally {
    clearTimeout(deadline);
  }
}

export default async function Home() {
  let context;
  try {
    if (getConfiguration() || await demoUserId()) {
      context = await classroomContext({readOnly:true});
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return <Login />;
    throw error;
  }
  if (!context) return <DashboardEntry />;
  const { account, client, user } = context;
  if(account?.role==='student'&&account.status==='pending')redirect('/personalize');
  if (!account || account.role !== 'student' || account.status !== 'approved') redirect('/classroom');
  // Start the private read during the page request and stream it while the
  // browser loads the dashboard. A failed seed falls back to the state API.
  return <DashboardEntry initialState={loadInitialState(client, user.id)} />;
}

