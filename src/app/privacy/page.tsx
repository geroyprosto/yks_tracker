import Link from 'next/link';

export default function PrivacyPage() {
  return <main className="public-info">
    <Link href="/about" className="text-button">← YKSim hakkında</Link>
    <p className="eyebrow">30 Eylül 2026</p>
    <h1>Gizlilik ve veri paylaşımı</h1>
    <section><h2>Google’dan alınan bilgiler</h2><p>Google Takvim’i bağlamayı seçersen YKSim, takvim listeni ve seçtiğin takvimlerdeki bugüne denk gelen etkinlikleri okumak için <code>calendar.calendarlist.readonly</code> ve <code>calendar.events.readonly</code> izinlerini ister. Takvimlerine yazma izni istemez.</p></section>
    <section><h2>Kullanım ve saklama</h2><p>Etkinlikler yalnızca kendi “Bugünün programı” görünümün için Google’dan alınır; sunucu veritabanına etkinlik kopyası kaydedilmez. Takvim etkinlikleri çalışma istatistiklerine eklenmez, öğretmenlere gösterilmez, reklam için kullanılmaz ve yapay zekâ analizine gönderilmez.</p><p>Bağlantıyı sürdürebilmek için Google yenileme belirteci şifreli olarak, seçtiğin takvim kimlikleri ve bağlantı zamanlarıyla birlikte hesabına bağlı sunucu veritabanında saklanır. Erişim belirteci yalnızca ilgili sunucu isteği sırasında kullanılır. Uygulama Vercel üzerinde çalışır; bağlantı kaydı Supabase’de tutulur.</p></section>
    <section><h2>Arkadaşlarla çalışma özeti</h2><p>Grup davetini kabul ettiğinde gruptaki tüm üyeler birbirinin bugünkü ve bu haftaki çalışma süresini, çözülen soru ve test sayısını ve tamamlanan görev sayısını görür. Sonradan davetle katılan üyeler de bu ortak sıralamaya dahil olur. Görev ayrıntıları, deneme sonuçları, günlük yazıları ve takvim etkinlikleri arkadaşlarla paylaşılmaz.</p><p>Davet bağlantısı tek kullanımlıktır ve yedi gün geçerlidir. Her üye gruba arkadaş davet edebilir. Arkadaşlar alanından gruptan ayrıldığında veya grup yöneticisi seni çıkardığında o grup üzerinden özetlere erişiminiz sona erer; başka bir ortak grubunuz varsa o gruptaki paylaşım devam eder. Ayrılan üyenin o gruba ait kullanılmamış davetleri iptal edilir. Grup yöneticisi ayrılırsa kalan bir üye yönetici olur.</p></section>
    <section><h2>Bağlantıyı kesme</h2><p><Link href="/calendar">Google Takvim bağlantısı</Link> sayfasındaki “Bağlantıyı kes” işlemi, Google iznini iptal etmeyi dener ve kayıtlı şifreli belirteci siler. Google’a ulaşılamadığı için iptal tamamlanmazsa izni <a href="https://myaccount.google.com/connections">Google Hesabı bağlantıları</a> sayfasından da kaldırabilirsin.</p></section>
    <p>Google bağlantısı, YKSim hesabına girişten ayrı bir izindir. İzin vermesen de takvim dışındaki hesap özelliklerini kullanabilirsin.</p>
    <nav aria-label="Bilgi bağlantıları"><Link href="/about">YKSim hakkında</Link><Link href="/terms">Kullanım koşulları</Link><Link href="/">Uygulamaya git</Link></nav>
  </main>;
}
