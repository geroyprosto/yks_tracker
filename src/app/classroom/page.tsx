import { ClassroomWorkspace } from '@/components/classroom/workspace';
import { getConfiguration } from '@/lib/server/auth';
import { classroomContext } from '@/lib/server/classroom';
import { demoUserId } from '@/lib/server/classroom-demo';
import { ApiError } from '@/lib/server/http';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function ClassroomPage() {
  if (!getConfiguration() && !await demoUserId()) redirect('/');
  try {
    await classroomContext({readOnly:true});
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/');
    throw error;
  }
  return <ClassroomWorkspace />;
}
