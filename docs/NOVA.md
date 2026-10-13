# Nova: yerel çalışma arkadaşı

Nova, YKSim içinde kalıcı durumu ve simüle programı olan dijital çalışma arkadaşıdır. `/nova` adresinden veya ana menüdeki Nova bölümünden açılır. Sohbet çıkarımı yalnız Windows bilgisayarda çalışan Ollama üzerinden yapılır. Mevcut uygulamanın başka özelliklerindeki bulut AI kodu değiştirilmedi; Nova bu sağlayıcılara bağlanmaz.

## Etkinleştirme ve dağıtım

Nova, web sunucusunda `NOVA_ENABLED=true` ve hesap için ayrı `nova_access_grants` izniyle açılır; bayrak verilmezse kapalıdır. Kanonik uygulama [yks-tracker-puce.vercel.app](https://yks-tracker-puce.vercel.app/nova), Vercel projesi `yks-tracker` ve üretim dalı `main`'dir. Uygulama, migration, cihaz bağlantısı ve gerçek model kalitesi farklı doğrulama katmanlarıdır; tarihli kanıtlar [doğrulama kaydında](NOVA_VERIFICATION.md) bulunur. Yerel PGlite test ortamı gerçek Supabase projesinden ayrıdır.

## Mimari

- `src/lib/nova/core.ts`: saat, seed, sürüm ve ölçümler dışarıdan verilen saf motor. Gün programı, durum, puan, kalibrasyon ve proaktif fırsatlar burada üretilir.
- `src/lib/nova/agent.ts`: sınırlı doğrulanmış bağlam, Türkçe çıktı şeması, kaynak/sayı/eylem/hafıza doğrulaması ve tek onarım hakkı.
- `scripts/nova-bridge/`: Node 24 CLI, Windows DPAPI cihaz kimliği, dışarıya HTTPS bağlantısı, tek eşzamanlı üretim, model sağlığı ve lease yenileme.
- `src/lib/server/nova.ts`, `/api/nova`, `/api/nova/bridge`: kısa kimlik doğrulama, simülasyon senkronizasyonu ve kuyruk işlemleri. Sunucu model yanıtını bekleyen uzun bir istek tutmaz.
- `src/components/nova/`: Bugün, Sohbet, Yarış ve Nova Lab. Mevcut CSS değişkenlerini ve bileşen stillerini kullanır.
- `supabase/migrations/*_nova_local_companion.sql`: sahiplik, erişim izni, kalıcı günler, olaylar, mesajlar, kuyruk, cihazlar, hafıza ve kontrollü RPC'ler.

## Geliştirme ortamı

Node.js 24.x ve `package.json` içindeki `packageManager` sürümünü kullanın. Doğrulama sırasında kullanılan araç sürümleri test kaydında ayrıca belirtilir.

```powershell
pnpm install --frozen-lockfile
pnpm test:nova
pnpm test:nova:e2e
pnpm lint
pnpm typecheck
pnpm build
```

`test:nova:e2e` 127.0.0.1:3400 üzerinde izole Next/PGlite ortamını başlatır, demo hesabıyla giriş yapar ve gerçek HTTP/RPC yolunu FakeModelAdapter ile kullanır. Canlı e-posta, veritabanı veya model anahtarı kullanılmaz. CI gerçek Ollama gerektirmez.

## Supabase ve web kurulumu

Yeni bir ortamı hazırlarken önce ayrı geliştirme Supabase ortamında mevcut migration'ları ve Nova migration'larını uygulayın. Migration kendi başına hiçbir gerçek kullanıcıya Nova erişimi vermez. Üretimde onaylı hedef proje, commit ve hesap doğrulandıktan sonra aşağıdaki sıra izlenir; kurulmuş ortamda adımlar körlemesine tekrarlanmaz.

1. Veritabanı yedeği ve ayrı ortam testini tamamlayın.
2. Yeni migration'ı uygulayın; [veritabanı belgesindeki](NOVA_DATABASE.md) RLS/RPC kontrollerini çalıştırın.
3. Mevcut `auth.users` ve `classroom_accounts` kayıtlarından doğru onaylı hesabı doğrulayın. UUID tahmin etmeyin. Yalnız seçilen hesaba yönetici işlemiyle `nova_access_grants` kaydı ekleyin.
4. Web sunucusunun mevcut `NEXT_PUBLIC_SUPABASE_URL`, publishable key, `APP_ORIGIN` ve yalnız sunucuda `SUPABASE_SECRET_KEY` yapılandırmasını kullanın. `NOVA_ENABLED=true` yapın. Demo bayraklarını production'da kullanmayın.
5. Hesapla `/nova` açın. İlk giriş, geçmiş 14 tamamlanmış günden profil oluşturur; olmayan kullanıcı kayıtlarını üretmez.
6. Windows Bridge'i aşağıdaki rehberle eşleştirin.

Sunucu secret'ı tarayıcıya veya Bridge'e verilmez. RLS hem onaylı hesabı hem ayrı Nova erişim iznini denetler; tarayıcı doğrudan iş sonucu veya simülasyon puanı yazamaz. Cihaz iptali her heartbeat, claim, renew, context ve complete çağrısında geçerlidir.

## Windows kurulumu

Ayrıntılı, gerçek CLI komutları: [Nova Bridge rehberi](NOVA_BRIDGE.md).

1. [Resmî Ollama Windows kurulumunu](https://docs.ollama.com/windows) tamamlayın. RX 7800 XT [desteklenen AMD kartları](https://docs.ollama.com/gpu) arasında; uyumlu AMD sürücüsü gerekir.
2. PowerShell'de `ollama pull qwen3:8b` çalıştırın.
3. Projede `pnpm install --frozen-lockfile` çalıştırın.
4. `pnpm nova:bridge doctor` ile modelin yerel listede bulunduğunu kontrol edin.
5. `pnpm nova:bridge pair --app https://yks-tracker-puce.vercel.app` çalıştırın. Gösterilen kodu aynı uygulamanın Nova Lab ekranında onaylayın. Şifre veya anahtar paylaşmayın. Başka bir ortam kullanıyorsanız önce onun HTTPS adresini doğrulayın.
6. `pnpm nova:bridge start` çalıştırın. Bridge eşleştirme sırasında saklanan uygulama adresine dışarıya bağlantı açar; port forwarding/tünel gerekmez.
7. Nova Lab'de cihaz/model sağlığını kontrol edin ve Sohbet'ten test mesajı gönderin.

Windows dağıtım paketi kullanıldığında Node bağımlılıkları tek Bridge dosyasında bulunur; kaynak depoyu sürekli açık tutmak gerekmez. Paket `%LOCALAPPDATA%\YKSim\NovaBridge` klasörüne kurulur. Başlat menüsü ve isteğe bağlı Windows başlangıç kısayolları aynı kullanıcının DPAPI kimliğini kullanır. Güncelleme sırasında Bridge durdurulur ve mevcut `device.dpapi` korunur. Kaynaktan CLI ile paketli kullanım aynı eşleştirme ve kuyruk protokolünü izler.

## Gün, puan ve çevrimdışı davranış

Gün snapshot'ı yalnız bir kez kaydedilir. Benzersizlik `nova_id + local_date` üzerinden kurulur; sürüm değişikliği ikinci gün veya yeniden puanlama oluşturmaz. UTC zamanlar saklanır; gün sınırı IANA timezone ile hesaplanır. Sayfa, o anki sunucu saatine kadar biten etkinlikleri gösterir. Planlanan etkinlik sonuçları ve gelecekteki neden kodları gizlenir.

Kullanıcının günlük hedefi ilk gün snapshot'ına alınır. Gün içinde hedef düzenlemek karşılaştırmayı yeniden yazmaz. Eksik bileşenler iki taraf için aynı şekilde çıkarılır ve kalan ağırlıklar normalize edilir. Soru kayıtlarında doğru/yanlış alanı bulunmadığından doğruluk uydurulmaz. [Puan ve kalibrasyon ayrıntıları](NOVA_CORE.md).

Haftalık yarış özeti, sunucunun gönderdiği **son yedi kayıtlı tarihteki** kesinleşmiş ortak günleri toplar; bu, boş günleri doldurulmuş bir takvim haftası değildir. Yalnız hem kullanıcı hem Nova puanı bulunan aynı günler iki toplama da katılır. Sürmekte olan gün ve tek tarafın puanı eksik günler dışarıda kalır; hiç ortak gün yoksa toplamlar sıfır yerine “veri yok” anlamında null olur. Özette dahil edilen gün sayısı gösterilir. Her gün 0–100 olduğundan en fazla yedi günlük toplamın üst sınırı **700** puandır; daha az ortak gün varsa karşılık gelen üst sınır gün sayısı × 100'dür.

Web uygulaması her senkronizasyonda en fazla yedi günü sıralı ve yeniden çalıştırılabilir biçimde tamamlar. Haftalık adaptasyon yalnız kesinleşmiş yedi günden gelir; güç çarpanı en fazla ±%5 değişir. Motor sürümü geçmiş snapshot'ları yeniden üretmez.

Bilgisayar kapalıyken sunucuya ulaşan mesaj kalıcı kuyrukta kalır. **Tarayıcının interneti de kesikse** mesaj sunucuya kaydedilmiş sayılmaz; taslak ekranda kalır ve kullanıcı yeniden göndermelidir. Bu sürüm tarayıcı için IndexedDB gönderim kuyruğu sağlamaz. Nova'nın simüle etkinliği ve Bridge'in teknik bağlantısı farklı alanlarda gösterilir.

## Hafıza, ilişki ve proaktif mesaj

Model yalnız açık hatırlama isteğindeki sıradan tercihleri, tam kaynak alıntısıyla aday gösterebilir. Adaylar onay bekler; hassas bilgi ve sır adayları reddedilir. Kullanıcı hafızayı düzenleyebilir, sabitleyebilir, unutabilir ve eski kaynak mesajını açabilir. Unutma kaynak tombstone'u bırakır; ilgili bağlamları temizler ve devam eden claim'leri geçersizleştirir. Eski sohbet mesajının kendisi silinmez. Unutulan bilginin eski yanıtların yeniden anlatımıyla geri gelmesini engellemek için unutma öncesindeki sohbet geçmişi sonraki model bağlamlarından çıkarılır; diğer açıkça onaylı hafızalar korunur.

İlişki sayıları yalnız simülasyonun üslup parametreleridir. Sessizlik, yokluk veya düello reddi nedeniyle ceza yoktur. Düello kabulü kalıcı teklif yanıtını kaydeder; kullanıcının gerçek çalışma sayacını kendiliğinden başlatmaz ve tamamlanmış çalışma üretmez.

Proaktif mesajlar varsayılan kapalıdır; açılınca günlük varsayılan iki, sessiz saatler 23–08, haftalık düello sınırı üçtür. Eski fırsat expire olur; cevapsız mesaj varken yenisi oluşturulmaz. Ürün bildirim tercihi ayrı tutulur, fakat bu MVP telefon push bildirimi göndermez. Sürekli bulut ajanı veya cron yoktur: fırsatlar görünür uygulama senkronizasyonunda değerlendirilir.

## Güvenlik ve bilinen sınırlar

- JSON ve regex denetimleri tam anlamsal doğruluk garantisi değildir. Sayısal yarış bilgisi doğrulanmış UI kartlarında kalır. Geçersiz çıktıda en fazla bir onarım denenir; yine geçersizse hata görünür.
- GPU yerleşimi, yanıt gecikmesi ve Türkçe yanıt kabulü ayrı ölçümlerdir. [Eval paketi](../evals/nova/) gerçek modelle çalıştırılmalı; `ollama ps` çıktısındaki GPU bilgisi Türkçe kaliteyi kanıtlamaz. Fake eval gerçek model başarısı değildir. Son donanım/model ölçümleri [doğrulama kaydındadır](NOVA_VERIFICATION.md).
- PGlite testleri gerçek gömülü Postgres mantığını kullanır. Ayrı PostgreSQL bağlantılarıyla yük altında yarış testinin ve gerçek Supabase/JWT/RLS kabulünün yerine geçmez.
- Tarayıcı görünürken 30 saniyelik polling, Bridge boşta 30 saniyelik polling ve düşük sıklıklı heartbeat kullanır. Bu MVP Nova için Realtime uyandırma entegrasyonu içermez. Her token için yazma veya her görünüm için LLM işi yoktur.
- Günlük program başlangıç MVP'sinde en fazla 300 dakika simüle çalışma planlar. Yüksek çalışma hacminde Nova kullanıcıdan düşük başlayabilir; performans veya bilimsel başarı tahmini yapılmaz.
- Motor programı mevcut okul/takvim entegrasyonuna bağlı değildir; genel günlük rutin simülasyonu kullanır. Fine-tuning, ses ve hareketli avatar kapsam dışıdır.
- Gerçek veritabanı/hosting/elektrik maliyeti ölçülmedi. Yerel model, bütün sistemin ücretsiz olduğu anlamına gelmez.

## Doğrulama belgeleri

- [Core ve oyun parametreleri](NOVA_CORE.md)
- [Veritabanı, yetki ve kuyruk](NOVA_DATABASE.md)
- [Bridge, model ve Windows kurulumu](NOVA_BRIDGE.md)
- [Test kapsamı ve başlangıç kusuru](NOVA_VERIFICATION.md)
