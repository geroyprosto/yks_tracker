# Ajan Evi: bulut ekibi ve Windows aktarımı

Altı bağımsız hosted ChatGPT görevi vardır: lider ve beş uzman. Bunlar ayrı model API anahtarı kullanmaz. Hosted görevlerin model seçimi hesap/çalışma ortamına bağlıdır; yerel Codex runner'ın model tablosu bu görevlerin fiilen seçilmiş modeli değildir.

Her rolün uzmanlığı `.agents/skills/ajan-evi-*/SKILL.md` dosyasındadır. Kurulum bu becerileri yalnız ilgili `private.agent_team_memory.skill` satırına taşır. Her görev kendi rolüyle `agent_team_read` çağırır. Ortak kaynak arşivini bütün ajanlara yüklemez.

## Çalışma akışı

1. Lider kullanıcının notunu veya yeni kayıt gözlemini alır, gereken uzmana gerçek bir istek gönderir.
2. Uzman kendi hafızası ve izinli kaynaklarıyla çalışır. Gerekirse başka bir uzmana soru gönderir. Bekleyen isteği hafızasında tutar; cevap uydurmaz.
3. `agent_team_commit` hafıza, gönderilen mesajlar ve tamamlanan gelen mesajları atomik kaydeder. Sürüm denetimi eski hafızanın yeni bilgiyi ezmesini önler. Tekrarlar run ID + içerik özetiyle doğrulanır; mesaj zinciri en fazla dört adımdır.
4. Lider `agent_team_briefs` ile yalnız paylaşılan kısa sonuçları alır. Uzmanların ham hafızasını veya özel sohbet dökümlerini almaz. Hazır uzman notlarıyla raporu `agent_house_stage_for_owner` üzerinden bekletir.
5. Windows kullanıcı oturumu açıldığında yerel yayıncı bekleyen raporu strict Zod şeması ve 128 KiB sınırıyla doğrular. Aynı run ID'yi atomik olarak yayınlar; arada değişen taslak yayınlanmaz. Geçersiz rapor mevcut raporu bozmaz.

Bu mantıksal görev/bağlam ayrımıdır; aynı hesap adına bağlı Supabase yönetim aracını kullanmaları ayrı bir kriptografik yetki sınırı oluşturmaz. Web istemcisi hafıza ve gelen kutusu tablolarına erişemez. Server RPC'leri yalnız doğrulanmış allowlist sahibine izin verir. Tüm kişisel kayıtlar Auth kullanıcı silmesine cascade bağlıdır.

## Lider odası

`GET/POST /api/agent-house/chat` oturumu doğrular. POST aynı origin ve UUID ile tekrar güvenliği gerektirir. Kullanıcının notu liderin gelen kutusuna gider; liderin o nota bağlı cevabı aynı konuşmada görünür. Açık odada yalnız yanıtlar 10 saniyede bir okunur; rapor yayını bundan ayrıdır.

### Not geldiğinde çalışma

`20261115103829_agent_note_mcp_events.sql` geçişi ve MCP uç noktası `leader.note.created` olayını destekler. ChatGPT'de bu olaya abone bir bulut görevi etkin olmalıdır; yalnız sunucu kodunu yayınlamak abonelik oluşturmaz. Saatlik lider görevi erişim veya olay teslimi kesintilerinde mevcut yedek akış olarak kalır. Model çağrıları ChatGPT'de çalışır; bu bağlantı ücretli bir model API'si çağırmaz.

OAuth ile doğrulanan hesap ve istemci için abonelik özel şemada saklanır. Sunucu yalnız doğrulanmış ChatGPT HTTPS geri çağrılarına, her bağlantıda denetlenip sabitlenen genel IPv4 adresleri üzerinden imzalı olay yollar; yönlendirmeleri izlemez. Olay yalnız not kimliği ve uygulama bağlantısı içerir. Not metni, günlük veya uzman hafızası webhook'a eklenmez. İmza anahtarı tarayıcıya ve loglara verilmez.

Yeni not ve olay kuyruğu aynı işlemde kaydedilir. `after()` teslimi yanıt sonrasında başlatır. Kalıcı kiralama/deneme makbuzları eşzamanlı çağrıları ve tekrarları yönetir; geçici hatalar artan aralıklarla en fazla beş kez denenir. Açık lider odasının okuması yarıda kalan teslimi sürdürür; 410/413 kalıcı olarak durdurulur. Abonelik süresi en fazla yedi gündür ve ChatGPT yeniler. İptal kuyruğu da kaldırır; hesap silme bütün abonelikleri ve teslim kayıtlarını siler. Saatlik görev kapatılmaz. Olayın kabul edilmesi yanıtın tamamlandığı anlamına gelmez; canlı doğrulama nota bağlı gerçek lider yanıtıyla yapılır.

Kaynak: https://developers.openai.com/plugins/build/mcp-events

## Windows kurulumu

Repo ve bağımlılıkları bu bilgisayarda kalmalı. Mevcut `.env.local` içindeki Supabase sunucu anahtarı ve `ALLOWED_USER_EMAIL` yalnız yayıncı tarafından yerel okunur; bulut görevlere, komut satırına veya registry'ye yazılmaz.

```powershell
& .\scripts\agent-house-codex\install-startup.ps1
pnpm agents:deliver --once
```

Kurulum HKCU Run içindeki `YKSimAgentHouseDelivery` girdisini oluşturur. `%LOCALAPPDATA%\YKSim\agent-house\publish-on-login.vbs` Node'u görünmez pencereyle başlatır. Bu, kullanıcı oturumu açılışıdır; giriş ekranı öncesi işletim sistemi açılışı değildir. Ağ henüz hazır değilse en fazla beş deneme, aralarında 30 saniye vardır. Sonuçlar aynı dizindeki `startup.jsonl` dosyasına kişisel içerik veya anahtar olmadan yazılır. İptal için yalnız bu HKCU Run değerini kaldırmak yeterlidir.

Bulut ekip controller'ı ve worker kimlikleri kullanıcının özel Page'inde tutulur; kişisel hafıza ve kaynak içerikleri Git'e yazılmaz. Eski ortak hafıza otomasyonu durdurulmuştur, kaynak arşivi korunur. Yerel Codex otomasyonu da durmuş kalır; iki sistem aynı anda rapor yayınlamaz.

## Sınırlar

- Hosted görevler planın kullanım sınırlarına ve bağlı kaynakların erişimine tabidir; sürekli çalışan bir sunucu veya yeni eğitim yapılmış model iddiası yoktur.
- Notion'da kitap künyesi, kitabın içeriğinin okunmuş olduğu anlamına gelmez. Yalnız açılan notlar/bölümler kaynak olur.
- İzinli eski ChatGPT sohbet arşivi erişilebilirdir. Yeni sohbetlerin tamamına bulut görevlerinden otomatik erişim doğrulanmadığından bu vaat edilmez.
- Davranış uzmanı gözlem, alternatif açıklama ve küçük deney önerir; tanı veya ilaç önerisi üretmez.
