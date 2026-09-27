# YKSim — Ürün gereksinimleri

Güncelleme: 24 Eylül 2026. Tam, yetkili gereksinim metni [docs/USER_REQUIREMENTS.md](docs/USER_REQUIREMENTS.md) dosyasındadır. Bu belge uygulanabilir özettir; hiçbir maddeyi kapsamdan çıkarmaz. Teslim durumu [FEATURE_CHECKLIST.md](FEATURE_CHECKLIST.md), sonraki iş sırası [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) içinde tutulur.

## Amaç ve kullanıcı

YKSim, Sümeyra'nın YKS 2027 sayısal hazırlığını Android telefon ve Windows bilgisayar arasında izleyen, tek hesaplı ve kalıcı veritabanı kullanan kişisel uygulamadır. Öncelik sırası veri doğruluğu/gizlilik, günlük kullanım, gerçek bağlantılar ve estetik ayrıntılardır. Türkçe arayüz, tr-TR biçimleri, Europe/Istanbul saat dilimi ve pazartesi hafta başlangıcı kullanılır. Sınav yılı, hedef sıralama ve sınav tarihi düzenlenebilir. Doğrulanmış 2027 takvimi veya kapsamı yoksa kesin tarih/kapsam gösterilmez.

Herkese açık kayıt, topluluk, liderlik tablosu, abonelik satışı ve sosyal ağ kapsam dışıdır. İlk kurulumda hiçbir kişisel ilerleme, süre, deneme, günlük veya hedef sıralama uydurulmaz. Başlangıç konu listesi gerçek kullanıcı başarısı değildir.

## Ürün akışı

Ana gezinme: Bugün, Görevlerim, Konularım, Denemelerim, Çalışma İstatistikleri, Günlüğüm, Analiz, Ayarlar. Masaüstünde kenar menüsü, telefonda sade alt gezinme ve tek sütun kullanılır. Ana ekran; karşılama, etkin sayaç, üç ilerleme göstergesi, bugünün görevleri/programı, konu özeti, son denemeler, haftalık süreler, günlük ve son analiz bağlantısını toplar. Eksik bağlantı veya veri açıkça anlatılır; kartın görünmesi özelliğin tamamlandığı anlamına gelmez.

Görev, konu, çalışma oturumu, deneme ve günlük ilişkileri aynı kaydın tekrar girilmesini önler. Görev bitirmek konuyu tamamlamaz; sayaç hedefi bitirmek görevi tamamlamaz.

## Mimari ve veri sözleşmeleri

Boş başlangıç klasöründe Next.js 16.3.6 App Router, React 19.2.8, TypeScript ve Tailwind 4 iskeleti kuruldu; Node.js 24 ve pnpm lockfile kullanılır. Supabase PostgreSQL/Auth tek kalıcı kaynaktır. UI, API ve gelecekteki MCP aynı doğrulanan servis işlemlerini kullanır. İş kuralları deterministik kodla hesaplanır; AI sayısal doğruluk kaynağı değildir.

Süreler saniye, zaman damgaları UTC, gün alanları YYYY-MM-DD olarak saklanır. Gün sınırları kullanıcının saat dilimine göre hesaplanır. localStorage yalnız uygun görünüm tercihleri içindir; cihazlar arası veri kaydı gibi sunulmaz. Gelecek çevrimdışı kuyruk IndexedDB, UUID, idempotency ve kayıt sürümü kullanır.

Model kapsamı: profil/ayarlar; ders-konu-alt konu ve durum geçmişi; kaynaklar; görevler/alt adımlar; günlük plan/puanlama sürümleri; çalışma oturumları/aktif aralıklar; soru çalışmaları; deneme formatları/sonuçlar; belgeler/içe aktarımlar; günlükler; analizler; bağlantılar ve denetim kayıtları. İlerleme yüzdeleri türetilir; geçmişe etkili plan/ayar değişiklikleri sürümlenir.

## Konular ve görevler

TYT ve AYT ayrıdır. Başlangıç TYT kataloğu Türkçe (paragraf/dil bilgisi), matematik/geometri, fizik, kimya, biyoloji, tarih, coğrafya, felsefe ve din; AYT sayısal kataloğu matematik/geometri, fizik, kimya ve biyolojidir. Diğer AYT dersleri eklenebilmelidir. Konu adları resmî kapsamla tek tek eşleştirilene kadar “düzenlenebilir başlangıç listesi” etiketi taşır.

Öğrenme düzeyi: Başlanmadı → Öğreniliyor → Konu anlatımı tamamlandı → Bağımsız soru çözülebiliyor → Konuya hâkimim. Çalışma türü bundan bağımsızdır: Konu anlatımı, Soru çözümü, Tekrar, Hızlı gözden geçirme, Yanlış analizi, Hâkimiyet kontrolü. Tekrar yapmak hâkimiyeti düşürmez. Kullanıcı düzeyi elle değiştirebilir; geçmiş korunur. Konu detayında kaynak/test/soru sonuçları, yardım ihtiyacı, süre, son çalışma, not ve sonraki adım bulunur; arama/filtre desteklenir. Tek kolay test otomatik hâkimiyet sağlamaz.

Görev alanları: başlık, yerel gün, ders/konu, kaynak, test/sayfa/soru hedefi, açıklama, net dakika, kişisel zorluk, öncelik, durum, tamamlanma ölçütü. Ekleme/düzenleme, sıralama, güne taşıma, geri alma, açık kısmi ilerleme, alt görev ve şablonlar gerekir. Görev sayacı bağlamı devralır. AI planı ancak inceleme/düzenleme sonrasında uygulanır.

## İlerleme kuralları

- Zorluk katsayıları varsayılan kolay 1, orta 1,25, zor 1,5; kullanıcı tarafından değiştirilebilir.
- Ağırlık = planlanan net dakika × zorluk katsayısı. Kullanıcı ağırlığı ayrıca değiştirebilir. Gerçek süre görev ağırlığını artırmaz.
- Görev ilerlemesi = 100 × Σ(ağırlık × 0–1 tamamlanma) / Σ(ağırlık).
- Ana görev ağırlığı alt adımlara dağıtılır; ebeveyn ve çocuk iki kez sayılmaz.
- Süre ilerlemesi = 100 × net çalışma saniyesi / hedef saniye.
- Günlük plan ilerlemesi = 0,70 × görev yüzdesi + 0,30 × min(süre yüzdesi, 100).
- Paylar ayarlanabilir ve toplamları 1 olur. Tanımsız bileşen çıkarılıp kalan paylar normalize edilir. İkisi de tanımsızsa puan yoktur.
- Halkalar %100 ile sınırlıdır; fazla çalışma ayrı belirtilir. Boş plan/sıfır hedef sahte başarı veya NaN üretmez.
- Haftanın günleri için hedefler, günlük istisna ve dinlenme günü desteklenir. Geçmiş puanlar bugünkü varsayılanlarla sessizce değişmez.
- Gösterge öğrenmeyi, insanın değerini, zekâyı veya kesin verimi ölçtüğünü iddia etmez.

Kabul örnekleri: 120/400 ağırlık = %30; görev %70 ve süre %50 = %64; 6 saat hedefte 3 saat net = %50.

## Sayaç

Kronometre ve ayarlanabilir geri sayım; isteğe bağlı çalışma/mola döngüleri. Başlık, ders, konu, görev ve çalışma türü seçilebilir; görev zorunlu değildir. Başlat/duraklat/sürdür/erken bitir/düzelt işlemleri gerekir. Mola net süreye katılmaz.

Kalıcı başlangıç/bitiş ve aktif aralıklar yenilemede süreyi yeniden kurar. Geri sayım en fazla hedef süresini yazar; ek çalışma ayrıca seçilir. Uzun unutulmuş kronometre doğrulanır. Kitap çalışırken ekran hareketsizliği mola sayılmaz. Gece yarısı oturumları yerel günlere bölünür. Çevrimiçi tek etkin oturum, eşzamanlı işlemlerde kilit/idempotency ve sürüm denetimi gerekir. Çevrimdışı cihaz çakışmaları incelemeye çıkar. Telefon kilitliyken/tarayıcı kapalıyken alarm garantisi verilmez.

Focus To-Do resmî belgelenmiş API doğrulanmadan bağlanmış gösterilmez. Çekirdek kendi sayacını kullanır; CSV/JSON eşleme ancak gerçek örneğe göre geliştirilecek ayrı import işidir.

## Denemeler ve istatistikler

Yeni deneme girişinde TYT, AYT Sayısal veya gerçek soru sayılı branş türü seçilir ve toplam net kaydedilir. Tarih varsayılan olarak bugündür, değiştirilebilir. Ad isteğe bağlıdır; boş bırakılırsa kayıt sırasına göre “3. deneme” gibi otomatik verilir. Notlar isteğe bağlıdır. Başlangıç şablonu TYT 120 ve AYT Sayısal 80 sorudur; branşın soru sayısı ayrıca girilir. Toplam net formatın izin verdiği aralıkta doğrulanır, negatif net mümkündür. Eski kayıtlardaki ders, puan, sıralama ve süre verileri korunur.

Grafikler gerçek toplam net sonuçlarını, haftalık/aylık ortalamaları ve katkı veren deneme sayılarını gösterir. Tür ve dönem filtreleri vardır; eksik dönem boş kalır. Farklı soru sayılı branş denemelerini karşılaştırırken soru sayısı dikkate alınır. Net farkı “+8 net” şeklindedir; az örnekten kesin gelişim hükmü çıkarılmaz.


Süre istatistikleri gün/hafta/ay/yıl/özel aralıkta toplam, iki farklı ortalama, en yüksek gün, çalışma/ hedefe ulaşma günleri ve ders/konu/tür dağılımını gösterir. Dinlenme, henüz kapanmamış gün, sıfır çalışma ve eksik kayıt ayrılır. Oturum düzeltmeleri raporları günceller; Calendar süreleri katılmaz.

## Günlük, AI ve ChatGPT bağlantısı

Serbest günlük metni korunur. Uyku/ruh hâli/enerji/stres/ortam/bölünme/aktivite/takma kişi etiketi/yemek-içecek gibi alanlar isteğe bağlıdır. AI düzenlemesi orijinali silmez, söylenmeyeni üretmez. Yerel güne bağlanır; “analize dahil etme” ve AI alan seçimi uygulanır.

AI için model OPENAI_MODEL ile ayarlanır; aday gpt-6-astra güncel resmî katalog ve hesap erişimiyle ayrıca doğrulanır. Başka modele sessiz geçilmez. Sunucuda anahtar, istek/harcama sınırı, token/kullanım ve mümkün maliyet görünürlüğü gerekir. API erişimi ChatGPT aboneliğinden varsayılmaz. Temel uygulama AI olmadan çalışır.

Dönem raporları kodla hesaplanmış verileri ve izinli günlük alanlarını yorumlar; veri günleri/eksikler/örnek sayıları/kaynak bağlantıları/alternatif açıklamalar/sınırlı öneriler içerir. Korelasyon nedensellik değildir; sağlık tanısı/ilaç tavsiyesi ve cezalandırıcı dil yoktur. 14 günde bir planlama kullanıcı etkinleştirmesiyle gerçek sunucu işi üzerinden çalışır. Cache/idempotency, durum/hata, saklanan raporlar ve veri değişince eskime işareti gerekir.

ChatGPT erişimi uygulama AI'sinden ayrıdır. Kimliği doğrulanmış OAuth/MCP bağlantısı dar, şemalı okuma-yazma araçları kullanır; sahiplik doğrulanmış kimlikten gelir. Keyfi SQL/HTTP/dosya aracı yoktur. Yazma kaydı, kaynak/zaman denetimi, doğru anotasyonlar, tekrar güvenliği ve gerçek işlem sonrası kimlik/durum/açılabilir bağlantı gerekir. Belirsiz hedef, silme ve üzerine yazmada doğrulama alınır. ChatGPT sandbox dosya yolu sunucudan erişilebilir sayılmaz; destekli aktarım yoksa çıkarılan yapılandırılmış deneme verisi create_exam ile aktarılır.

## Google Calendar kapsamı

Yalnız “Bugünün Programı” okunur. Kullanıcı bağlantı kurar, takvimleri seçer ve bağlantıyı keser. Gerekli scope'lar calendar.events.readonly ve gerekiyorsa calendar.calendarlist.readonly ile sınırlıdır. Etkinlik ekleme/silme/taşıma, görev gönderme, RSVP, hatırlatıcı yönetimi ve iki yönlü eşitleme yoktur.

Yerel günle kesişen, tüm gün/tekrarlı/gece yarısını aşan/iptal edilmiş olaylar ve sayfalama doğru işlenir. Açılış/odaklanma/makul aralık/elle yenileme, son güncelleme ve bağlantı/çevrimdışı/boş gün durumları gerekir. Calendar süresi çalışmaya, geçen etkinlik görev tamamlanmasına dönüşmez. Ayrıca izin verilmeden AI'ye gönderilmez. Google izin yaşam döngüsü uygulama girişinden ayrıdır.

## Görünüm, güvenlik ve PWA

Varsayılan koyu lacivert/Çelik Mavisi. Grafit, Mercan/Gül, Okyanus, Aurora, Orman, Bordo, Mürdüm/Krem, Pastel ve Çelik Mavisi ayrı tema aileleridir; tüm renk listeleri tam gereksinimde korunmuştur. CSS tokenları arka plan/kart/metin/kenar/vurgu/grafik/durumları kapsar. Açık/koyu/sistem, az hareket, sade görünüm, hesapla tema eşitleme ve cihaz bazında sistem tercihi gerekir. Tema değişimi süreyi/veriyi etkilemez. Etiket/işaret, klavye, odak, kontrast ve dokunma erişimi sağlanır.

Tek izinli hesap sunucuda doğrulanır; genel kayıt kapalıdır. RLS ve özel depolama sahipliği uygular. Sırlar istemciye/repository'ye/loglara girmez. Girdi doğrulama, rate limit, OAuth state/PKCE, kısa ömürlü dosya bağlantıları ve güvenli token yaşam döngüsü gerekir. Günlük içeriği talimat değil veri kabul edilir; SSRF ve prompt injection sınırları uygulanır.

PWA manifest/ikon/service worker/kurulum rehberi gerekir. İlk çevrimdışı kapsam: önceden açılmış görevler, kuyruğa alınan tamamlanmalar, korunan sayaç kayıtları. İlk giriş, Google ve AI internet ister. Hassas API yanıtları gelişigüzel cache'lenmez. Çıkışta kişisel yerel veri temizlenir; eşitlenmemiş değişiklik önce uyarılır.

## Tamamlama ölçütü

Her aşamada çalışan sonuç, dürüst checklist ve gerçek test raporu bırakılır. Birim, entegrasyon, E2E, lint, typecheck ve production build ayrı kanıtlardır; mock test gerçek sağlayıcı doğrulaması değildir. Tam kabul listesi [orijinal talimatın 20. bölümü](docs/USER_REQUIREMENTS.md) ve [test planı](docs/TESTING.md) ile izlenir.

Sonraki kapsam: yanlış/takılma arşivi, tekrar önerileri, günlük→haftalık→aylık yol haritası, sürümlü ilişkili JSON ve CSV dışa alma, test edilmiş geri yükleme. Gerçek silme/üzerine yazma, dış hesap değişikliği, satın alma, GitHub push ve yayın için ayrıca açık yetki gerekir.



