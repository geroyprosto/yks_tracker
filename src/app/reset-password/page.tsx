import { ResetPassword } from '@/components/classroom/password-recovery';

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const query = await searchParams;
  return <ResetPassword invalidLink={Boolean(query.error)} />;
}
