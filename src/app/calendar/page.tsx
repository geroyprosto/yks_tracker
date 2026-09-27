import Link from 'next/link';
import { GoogleCalendarSettings } from '@/components/google-calendar-settings';
import { classroomContext } from '@/lib/server/classroom';

export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  let approved = false;
  let back = '/classroom';
  try {
    const { account, demo } = await classroomContext({ readOnly: true });
    approved = !demo && account?.status === 'approved';
    if (account?.role === 'student') back = '/';
  } catch { /* The page still provides a sign-in link. */ }

  return <main className="calendar-page">
    <div className="calendar-page-heading">
      <Link href={back} className="text-button">← Çalışma alanına dön</Link>
      <h1>Google Takvim bağlantısı</h1>
      <p>Takvimini kendi hesabına bağla ve görüntülenecek takvimleri seç.</p>
    </div>
    {approved ? <GoogleCalendarSettings authenticated />
      : <div className="card"><p>Takvim bağlamak için onaylı hesabınla giriş yap.</p><Link href="/" className="text-button">Girişe git</Link></div>}
  </main>;
}
