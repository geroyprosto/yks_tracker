# Nova Bridge: Windows kurulumu ve doğrulama

Nova'nın günlük yaşamı bir simülasyondur; gerçek çalışma kayıtlarını değiştirmez. Konuşma çıkarımı yalnızca Windows bilgisayarınızdaki Ollama'da yapılır. Bilgisayar veya Bridge kapalıysa mesajlar veritabanında bekler; bulut modeline gönderilmez. Bu belge kurulum ve işletim rehberidir; tarihli üretim, donanım ve model sonuçları [doğrulama kaydında](NOVA_VERIFICATION.md) tutulur.

## Gerekenler

- Node **24.x**. Kaynaktan çalıştırmada YKSim deposu ve bağımlılıkları gerekir; `package.json` içindeki pnpm sürümüyle `pnpm install --frozen-lockfile` çalıştırın. Tek dosyalık Windows paketi kaynak depodan bağımsız çalışır.
- Nova migration'ları uygulanmış hedef ortam, `NOVA_ENABLED=true` ile çalışan web uygulaması ve Nova erişimi olan kullanıcı. Kanonik üretim adresi `https://yks-tracker-puce.vercel.app`; başka ortam için proje ve HTTPS adresi doğrulanmalıdır.
- Windows 10 22H2 veya üzeri ve güncel Radeon sürücüsü. [Ollama Windows belgesi](https://docs.ollama.com/windows), ROCm v7/HIP7 veya Vulkan uyumlu Radeon sürücüsü ister. RX 7800 XT, [resmî Windows GPU listesinde](https://docs.ollama.com/gpu) bulunur.

## 1. Ollama'yı ve modeli kurma

[Ollama'nın Windows sayfasındaki](https://docs.ollama.com/windows) resmî yükleyiciyi kurun. Yerel çıkarımı zorunlu tutmak için Windows kullanıcı ortam değişkenlerine `OLLAMA_NO_CLOUD=1` ekleyin, Ollama'yı tamamen kapatıp yeniden başlatın. Port açmayın, tünel kurmayın, `OLLAMA_HOST` değerini ağın tamamına açmayın. [Yerel çalışma ve bulutu kapatma](https://docs.ollama.com/faq).

PowerShell'de:

```powershell
ollama pull qwen3:8b
ollama list
```

`qwen3:8b`, [resmî model kütüphanesinde](https://ollama.com/library/qwen3:8b) yaklaşık 5.2 GB Q4_K_M modelidir. RX 7800 XT 16 GB için başlangıç adayıdır; belirli hız veya tam GPU yerleşimi garantisi değildir. Sonradan model adını değiştirmek iş mantığını değiştirmez.

## 2. Bridge yapılandırması

Depo kökünde çalışın. Bridge, `.env.local` dosyasını otomatik yüklemez; PowerShell ortam değişkenlerini veya komut seçeneklerini kullanın. Cihaz sırrını `.env` dosyasına yazmayın.

```powershell
$env:NOVA_APP_URL = 'https://yks-tracker-puce.vercel.app'
$env:NOVA_OLLAMA_URL = 'http://127.0.0.1:11434'
$env:NOVA_OLLAMA_MODEL = 'qwen3:8b'
$env:NOVA_MODEL_TIMEOUT_MS = '90000'
pnpm exec tsx scripts/nova-bridge/cli.ts doctor
```

Yerel web geliştirmesinde `NOVA_APP_URL=http://localhost:3000` kullanılabilir. Dış uygulama adresi HTTPS olmak zorundadır. Ollama adresi yalnızca `127.0.0.1` veya `[::1]` ve 11434 portunu kabul eder; yönlendirmeler izlenmez. `doctor`, modeli `/api/tags` listesinde arar; çıkarım veya benchmark yapmaz.

## 3. Güvenli eşleştirme

```powershell
pnpm exec tsx scripts/nova-bridge/cli.ts pair --name 'Çalışma bilgisayarım'
```

Terminalde gösterilen eşleştirme kodunu kendi tarayıcınızda oturum açtığınız Nova Lab üzerinden onaylayın; yazdırılan `/nova?pair=...` bağlantısı bu sayfaya götürür. Eşleştirme süresi dolarsa komutu yeniden çalıştırın. Terminalde parola, service-role anahtarı, Supabase refresh token veya oturum çerezi istenmez.

CLI, rastgele challenge ile başlatır; kullanıcı web üzerinden cihazı onayladıktan sonra `pair.exchange` sonucu cihazla sınırlı bearer token alır. Sır, `%LOCALAPPDATA%\YKSim\NovaBridge\device.dpapi` içinde Windows DPAPI **CurrentUser** ile korunur. Başarısız şifreleme düz metne dönüşmez. Komut argümanlarında, ortam değişkenlerinde veya çalışma loglarında sır bulunmaz. [DPAPI](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata) aynı Windows kullanıcısının profilini gerektirir; başka kullanıcıya veya SYSTEM hesabına kopyalamak doğru değildir. Aynı hesapta çalışan kötü amaçlı yazılıma karşı tam koruma iddia edilmez.

## 4. Başlatma ve Nova Lab kontrolü

```powershell
pnpm exec tsx scripts/nova-bridge/cli.ts start
```

Nova Lab'de cihazın son görülme zamanını ve model durumunu kontrol edin; Sohbet'ten kısa bir Türkçe mesaj gönderin. Yanıt geldikten sonra sayfayı yenileyip mesajın korunduğunu ve çoğalmadığını doğrulayın. Çıkarım devam ederken başka terminalde `ollama ps` çalıştırın: `PROCESSOR` sütunundaki `100% GPU` tam GPU yerleşimini belirtir; CPU/GPU karışımı farklı bir durumdur. [Ollama doğrulama açıklaması](https://docs.ollama.com/faq).

`Ctrl+C` ile güvenli durdurun. İşçi yeni iş almayı bırakır ve etkin HTTP çıkarımını iptal eder. Bitmemiş iş, lease süresi dolunca tekrar alınabilir. Nova Lab'den cihazı iptal ettiğinizde heartbeat/renew yetki denetimi çıkarımı durdurur. Eski claim ile sonuç kabulü ayrıca sunucu tarafından engellenir.

## Windows paketi ve otomatik başlangıç

Paketli kurulumda dosyalar `%LOCALAPPDATA%\YKSim\NovaBridge` klasöründedir. **YKSim Nova** Başlat menüsü klasöründeki **Nova Başlat**, **Nova Durdur** ve **Nova Model Kontrolü** kısayolları aynı CLI'yi kullanır. Bridge gizli bir Node işlemi olarak çalışır; çift başlatma kilitle engellenir. Durdurma yardımcısı kayıtlı PID'nin aynı Bridge dosyasına ait olduğunu doğrular ve etkin işlemin iptalini ister; ilgisiz Node işlemlerini kapatmaz.

```powershell
& "$env:LOCALAPPDATA\YKSim\NovaBridge\Doctor-NovaBridge.ps1"
& "$env:LOCALAPPDATA\YKSim\NovaBridge\Start-NovaBridge.ps1"
& "$env:LOCALAPPDATA\YKSim\NovaBridge\Stop-NovaBridge.ps1"
```

Paketin `Install-NovaBridge.ps1` komutu mevcut `device.dpapi` dosyasını korur. Güncellemeden önce Bridge'i durdurun; paket ve model sürümü değiştiğinde gerçek eval'i yeniden çalıştırın. ZIP cihaz kimliği veya log içermez; başka Windows kullanıcısı kendi cihazını eşleştirir. Kurulum sonrasında başlatma ve model kontrolü ayrıca yapılır.

`-CreateStartMenuShortcuts` Başlat menüsü kısayollarını, `-EnableStartup` aynı kullanıcıya ait **YKSim Nova Bridge** başlangıç kısayolunu kurar. Otomatik başlangıcı kapatmak için bu kısayolu Windows başlangıç klasöründen kaldırın; çalışan Bridge'i ayrıca durdurun. Ollama'nın kendi başlangıç ayarı bağımsızdır. DPAPI nedeniyle Bridge SYSTEM hesabı altında çalıştırılmamalıdır.

`bridge-status.log` ve `bridge-error.log` güvenli durum mesajları içindir; mesaj metni, prompt veya token içermez. Loglar her başlatmada yenilenir. `manifest.json` kaynak commit'i ve bundle SHA-256 bilgisini tutar; kurulu dosyanın bu özetle eşleşmesi güncelleme kontrolünün parçasıdır.

## Davranış ve sınırlar

- Tek eşzamanlı iş; boşta 30 saniye polling; bağımsız 60 saniye heartbeat; iş başlangıcında durum heartbeat'i; 45 saniye lease yenileme. Sunucu lease süresi 180 saniyedir. Her mesajın bağlamı inference öncesinde sunucudan alınır.
- Yerel model yoksa iş **claim edilmez**, deneme sayısı tüketilmez. Ağ hatalarında artan ve en fazla 60 saniyelik bekleme vardır. İçerik, hafıza, prompt ve token'lar loglanmaz; yalnızca güvenli durum mesajları yazılır.
- Varsayılan çıkarım timeout'u 90 saniye, üst sınır 120 saniye; 8192 bağlam ve 900 çıktı token sınırı; tek şema düzeltme hakkı. İki geçersiz cevap sonrasında kalıcı uydurma/fake yanıt üretilmez. FakeModelAdapter yalnızca açık test/eval yolundadır.
- Ollama `format` alanına JSON Schema gönderilir; `stream:false`, `think:false`, temperature 0. Çıktı hem işçide hem sunucuda doğrulanır. [Structured outputs](https://docs.ollama.com/capabilities/structured-outputs).
- Bağlam en fazla 32 fact, 10 yakın mesaj ve 6 hafıza içerir; toplam veri 18.000 karakterle sınırlanır. Bu karakter sınırı yaklaşık bir bütçedir, tam tokenizer hesabı değildir. Kaynağı unutulmuş mesajlar ve hafızalar çıkarılır. Geçmiş mesaj ve hafıza içerikleri yetkili talimat kabul edilmez.
- Bilinmeyen fact, izin dışı eylem, HTML/bağlantı, bazı manipülatif ifadeler, kaynakta olmayan sayılar ve tamamlanmış olay iddiaları reddedilir. Sayısal serbest metin yalnızca referans verilen fact cümlesinin aynısıysa kabul edilir. Bunlar sezgisel koruyuculardır; tüm Türkçe anlamsal çelişkileri tespit etmezler. Yarış sayıları doğrulanmış UI kartlarında gösterilmelidir.
- Hafıza adayları yalnızca son kullanıcı mesajındaki açık “hatırla/kaydet” isteği ve birebir kaynak alıntısıyla sıradan çalışma tercihlerinden üretilebilir. Hassas adaylar reddedilir; kabul edilen adaylar doğrudan uzun süreli hafızaya yazılmadan kullanıcı onayına sunulur.
- Odak düellosu yalnızca teklif edilir; model herhangi bir işi kendiliğinden başlatamaz. İstemci RPC'leri gerçek çalışma kayıtlarını değiştirmez.

## Test ve Türkçe model eval'i

Ollama gerektirmeyen doğrulama:

```powershell
pnpm exec tsx --test tests/nova-agent.test.ts tests/nova-bridge.test.ts
pnpm exec tsx scripts/nova-bridge/cli.ts eval --fake
pnpm typecheck
```

Gerçek model değerlendirmesi (model kurulu ve açıkken):

```powershell
pnpm exec tsx scripts/nova-bridge/cli.ts eval --output nova-eval.json
```

Mevcut dosya üzerine yazılmaz. Rapor 17 Türkçe vakanın JSON uyumu, koruyucu kabul oranları, kaynak/üslup/güvenlik kontrolleri, p50/p95 gecikme ve token kullanımını içerir. Bağlılık baskısı, suçluluk, uykusuzluk övgüsü ve İngilizceye geçiş isteği de değerlendirilir. Yanıt metinleri rapora kaydedilmez. `--fake` çıktısındaki sıfır token/gecikme gerçek model performansı değildir. Gerçek eval ayrıca insanla Türkçe anlam/üslup incelemesine ihtiyaç duyar; otomatik oranlar “halüsinasyon imkânsızdır” anlamına gelmez. CI gerçek Ollama'ya bağlı değildir.

## Uygulama protokolü

Tek endpoint `POST /api/nova/bridge` kullanılır. Eşleştirme gövdeleri `pair.begin` ve `pair.exchange`; cihazlı istekler `{operation, payload}` ve `Authorization: Bearer <device_id>.<token>` biçimindedir. İşlemler `heartbeat`, `claim`, `renew`, `context`, `complete`, `fail` ile sınırlıdır. Kullanıcıya Supabase yönetim anahtarı verilmez. İşçi, model çıktısından URL, shell komutu veya yeni yetki üretmez.

Supabase JS desteği Node 20'yi 30 Haziran 2026'da bıraktı; bu depo Node 24 ister. Yeni public tabloların otomatik API yetkileri kaldırılıyor: migration'larda explicit GRANT ile RLS birlikte gereklidir. [Node duyurusu](https://supabase.com/changelog/45715-deprecation-notice-dropping-support-for-node-js-20), [Data API duyurusu](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).
