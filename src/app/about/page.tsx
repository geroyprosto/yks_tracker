import Link from 'next/link';

export default function AboutPage() {
  return <main className="public-info">
    <Link href="/" className="text-button">← YKSim’e dön</Link>
    <p className="eyebrow">YKSim</p>
    <h1>YKS hazırlığı için kişisel çalışma alanı</h1>
    <p>YKSim; çalışma planı, görev, sayaç, deneme sonucu ve ilerleme kayıtlarını tek yerde takip etmeye yardımcı olur. Onaylı öğrenci hesapları kendi çalışma alanını kullanır; öğretmenler bağlı öğrencilerin çalışma ilerlemesini görebilir.</p>
    <p>Google Takvim bağlantısı isteğe bağlıdır. Bağladığında seçtiğin takvimlerin bugüne ait etkinlikleri yalnızca sana gösterilir. YKSim takviminde etkinlik oluşturmaz veya değiştirmez.</p>
    <nav aria-label="Bilgi bağlantıları"><Link href="/privacy">Gizlilik ve Google Takvim verileri</Link><Link href="/terms">Kullanım koşulları</Link><Link href="/">Uygulamaya git</Link></nav>
  </main>;
}
