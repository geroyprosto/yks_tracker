import { Dashboard } from '@/components/dashboard';
import { Login } from '@/components/login';
import { getConfiguration } from '@/lib/server/auth';
import { classroomContext } from '@/lib/server/classroom';
import { demoUserId } from '@/lib/server/classroom-demo';
import { ApiError } from '@/lib/server/http';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function Home() {
  // The setup preview is public only while there is no configured account.
  if (!getConfiguration() && !await demoUserId()) return <Dashboard />;

  let account;
  try {
    ({account} = await classroomContext({readOnly:true}));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return <Login />;
    throw error;
  }
  if (!account || account.role !== 'student' || account.status !== 'approved') redirect('/classroom');
  return <Dashboard />;
}

