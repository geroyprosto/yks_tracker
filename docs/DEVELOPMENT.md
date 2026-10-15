# Yerel geliştirme

Önce [ürünü](PRODUCT.md), ardından bu rehberi oku. Gerçek Supabase/entegrasyon kurulumu için [SETUP.md](SETUP.md), kod içinde yön bulmak için [ARCHITECTURE.md](ARCHITECTURE.md) kullan.

## İlk çalıştırma

Node.js 24.x ve pnpm 11.19.0 gerekir. Proje kökünde:

```powershell
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm dev:demo
```

[127.0.0.1:3300/demo](http://127.0.0.1:3300/demo) üzerinden demo hesabı seç. Demo PGlite veritabanını `tmp/classroom-demo/` altında tutar; sayfa yenilemek veriyi sıfırlamaz. Öğretmen özelliklerinin duraklatılması demoda da geçerlidir. İşin bitince terminalde `Ctrl+C` kullan.

Gerçek kayıt akışını geliştireceksen [ortam ve hesap kurulumunu](SETUP.md) tamamla. `pnpm dev` normal geliştirme sunucusunu 3000 portunda açar. `.env.local` değişince sunucuyu yeniden başlat. Demo ile gerçek uygulama sekmelerinin portunu ve hesabını ayırt et.

## Komutlar

| Komut | İşlev |
| --- | --- |
| `pnpm dev` | Normal Next.js geliştirme sunucusu |
| `pnpm dev:demo` | 127.0.0.1:3300 üzerinde yerel PGlite demo |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript; dosya üretmeden tip denetimi |
| `pnpm test` | `tests/*.test.ts` birim/servis testleri |
| `pnpm test:db` | PGlite üzerinde `supabase/tests/*.test.ts` |
| `pnpm test:all` | Birim/servis ve DB testlerini birlikte çalıştırır |
| `pnpm test:e2e` | Ana Playwright paketi; ayrı test sunucusunu açar |
| `pnpm test:classroom` | Sınıf/hesap PGlite tarayıcı paketi |
| `pnpm test:nova` | Nova birim ve DB testleri |
| `pnpm test:nova:e2e` | Nova PGlite tarayıcı paketi |
| `pnpm build` | Üretim derlemesi |
| `pnpm start` | Önceden oluşturulmuş üretim derlemesini çalıştırır |

Test portları, tarayıcı kurulumu ve hangi paketin seçileceği [TESTING.md](TESTING.md) içinde. `test:all` çalıştırdıysan aynı birim/DB paketlerini ayrıca tekrarlaman gerekmez.

## Bir değişiklik yaparken

1. Kök [AGENTS.md](../AGENTS.md) ve dokunacağın modülün belgesini oku. Next.js API'si değişiyorsa kurulu paketin `node_modules/next/dist/docs/` belgelerini kontrol et.
2. Kullanıcı akışının başladığı bileşeni ve komut şemasını bul. Yeni iş kuralını yalnız ekranda uygulama; sunucu/RPC yetki ve doğrulamasını da değerlendir.
3. Veri değişiyorsa yeni migration ekle; eski migration geçmişini düzenleme. Tekrar anahtarı, kayıt revizyonu, sahiplik ve süre değişmezliğini koru.
4. Değişen davranışın ilgili testlerini ve [gerekli kontrolleri](TESTING.md) çalıştır. Mock/PGlite sonucu ile gerçek sağlayıcı kabulünü ayrı raporla.
5. Davranış ve kurulum belgelerini aynı değişiklikte güncelle. Yayın akışı için depo yönergesini ve [kurulumu](SETUP.md) izle.

## Sık karşılaşılan durumlar

| Belirti | İlk kontrol |
| --- | --- |
| Kurulum önizlemesi veya `SETUP_REQUIRED` | `.env.local`, yer tutucular, zorunlu değişkenler, sunucunun yeniden başlaması |
| Giriş var ama çalışma paneli yok | Hesap rolü/onayı; bekleyen öğrenci `/personalize`, diğer roller `/classroom` |
| `TEACHER_FEATURES_PAUSED` | Güncel ürün sınırı; [availability.ts](../src/lib/classroom/availability.ts) |
| Tablo veya RPC bulunamıyor | Doğru projeye tam migration sırası uygulanmış mı? |
| Kayıt tekrarında çakışma | Aynı işlem için aynı `request_id`; değişen içerik için yeni kimlik; güncel revizyon |
| Test sunucusu başlamıyor | 3100/3200/3400 portları, paralel paketler, Playwright tarayıcı kanalı |

Bağımlılık sürümlerini, ortam sırlarını veya üretim verisini belge düzeltmesinin yan etkisi olarak değiştirme. Sır değerleri `.env.example` veya test çıktısına kopyalanmaz.
