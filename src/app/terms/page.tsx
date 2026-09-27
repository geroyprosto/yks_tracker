import Link from 'next/link';

export default function TermsPage() {
  return <main className="public-info">
    <Link href="/about" className="text-button">← YKSim hakkında</Link>
    <p className="eyebrow">26 Eylül 2026</p>
    <h1>Kullanım koşulları</h1>
    <section><h2>Hesap erişimi</h2><p>YKSim çalışma ve sınıf alanları onaylı hesaplar içindir. Hesap bilgilerini güvenli tutmalı ve yalnızca erişme yetkin olan Google Takvim hesabını bağlamalısın.</p></section>
    <section><h2>Google Takvim</h2><p>Takvim bağlantısı isteğe bağlıdır ve yalnızca okuma amaçlıdır. Hangi takvimlerin görüntüleneceğini seçebilir, bağlantıyı istediğin zaman kesebilirsin. Etkinlikleri düzenlemek için Google Takvim’i kullanmalısın.</p></section>
    <section><h2>Hizmet</h2><p>Google Takvim bağlantısı internet erişimine ve Google hizmetlerinin kullanılabilirliğine bağlıdır. Takvim bağlantısını kesmen YKSim hesabını silmez; YKSim hesabından çıkman da Google iznini otomatik olarak iptal etmez.</p></section>
    <nav aria-label="Bilgi bağlantıları"><Link href="/about">YKSim hakkında</Link><Link href="/privacy">Gizlilik ve Google Takvim verileri</Link><Link href="/">Uygulamaya git</Link></nav>
  </main>;
}
