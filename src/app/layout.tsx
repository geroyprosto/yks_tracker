import type { Metadata, Viewport } from 'next';
import './globals.css';
import './progress-rings.css';
import './timer-focus.css';
import './timer-setup.css';
import './ambient-cards.css';
import './practice-insights.css';
import './exams.css';
import './monthly-exam-chart.css';
import './today-layout.css';
import './google-calendar.css';
import './study-statistics.css';
import './study-stats-charts.css';
import './study-goal-calendar.css';
import './journal.css';
import './pdf-exam-import.css';
export const metadata: Metadata = { title:'YKSim · Kişisel çalışma alanın', description:'YKS hazırlığını kendi ritminde takip et.', applicationName:'YKSim', icons:{icon:'/icon-192.png',apple:'/icon-192.png'}, appleWebApp:{capable:true,statusBarStyle:'default',title:'YKSim'} };
export const viewport: Viewport = {width:'device-width', initialScale:1,themeColor:'#101b2c'};
export default function RootLayout({children}:{children:React.ReactNode}) {
 return <html lang="tr" suppressHydrationWarning><body>{children}</body></html>;
}




