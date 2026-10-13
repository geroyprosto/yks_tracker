# Nova doğrulama kaydı

Tarih: 13 Ekim 2026. Yerel sonuçlar, GitHub Actions ve üretim/gerçek model doğrulamaları ayrı tutulur. Başlangıç commit'i: `9638346fc10a2e6ee4ad793ae9aa2a48220ba5e3`.

## Başlangıç durumu

Nova değişikliklerinden önceki tam test koşusunda **499 testin 498'i geçti**. `tests/mcp-analysis-tool.test.ts:50` içindeki `priority_summary.high` okuması `undefined` olduğu için bir test başarısızdı. Başlangıç logunda hata `Cannot read properties of undefined (reading 'high')` olarak kayıtlıdır. Bu önceden mevcut hata Nova regresyonu olarak sunulmamalı; tam depo testleri de tamamen geçti diye raporlanmamalıdır.

Yerel çalışma Node 24 kullandı. `package.json` pnpm **11.19.0** sürümünü bildiriyor; bu oturumdaki mevcut yerel pnpm **11.25** idi. CI depo sözleşmesini izleyerek 11.19.0 sürümünü kurar. Dolayısıyla yereldeki sonuç, GitHub runner üzerinde aynı araç zinciriyle tamamlanmış bir CI koşusu yerine geçmez.

## Kaydedilen Nova doğrulamaları

| Kapsam | Sonuç | Kanıtın sınırı |
| --- | --- | --- |
| Nova birim/veritabanı testleri | **58/58 geçti** | Core 19, Agent/Bridge 16, sunum 5, RLS/kuyruk 18; tam depo koşusuna dahil. |
| Tam depo birim/veritabanı | **557 test: 556 geçti, 1 başarısız** | Tek başarısızlık başlangıçta da bulunan `mcp-analysis-tool` testi. |
| Gerçek Windows DPAPI denemesi | Şifreleme → dosya → yükleme → çözme başarılı | Sentetik cihaz verisi kullanıldı; canlı token kullanılmadı; diskte açık token bulunmadığı kontrol edildi; sentetik dosya kaldırıldı. |
| Türkçe eval yürütücüsü | **17/17 fake vaka kabul edildi** | Sıfır token/gecikme gerçek model performansı değildir. |
| Nova tarayıcı testleri | **2/2 geçti** | Yerel demo/PGlite ve FakeModelAdapter; gerçek Supabase/Ollama veya üretim hesabı değil. |
| Tam ESLint, TypeScript, Next build | **Üçü de geçti** | Son kaynak değişikliklerinden sonra `pnpm lint`, `pnpm typecheck`, `pnpm build`. |
| Mevcut genel tarayıcı paketi | **149 geçti, 18 başarısız** | Aynı 18 hata, temiz başlangıç commit'inde aynı hata imzalarıyla tekrarlandı. |

Agent testleri şema/JSON hataları, bilinmeyen fact, kaynaksız sayı ve olay, prompt injection, unutulmuş kaynak, hassas/izinsiz hafıza, manipülatif Türkçe ifadeler, uykusuzluk övgüsü, bariz İngilizce çıktı ve tek onarım sınırını kapsar. Bridge testleri model yokken claim yapılmaması, lease kaybında iptal, iptal edilmiş cihaz, güvenli URL/kimlik taşıma, model timeout'u ve yanıt boyutu sınırlarını kapsar.

Tarayıcı koşusu giriş, Nova ekranı, model çevrimdışıyken dayanıklı mesaj, cihaz eşleştirme, gerçek HTTP kullanan fake Bridge cevabı, tekrar completion için başarılı idempotent yanıt, yenilemeden sonra tek kalıcı mesaj, hafıza onayı/kaynak/sabitleme/unutma, mobil taşma kontrolü, cihaz iptali ve yetkisiz hesap/istek reddini kapsar.

Eski tarayıcı hatalarının ayrımı için Nova içermeyen temiz başlangıç kopyasında başarısızlık içeren dokuz spec ayrıca çalıştırıldı: **37 geçti, 18 başarısız**. Test kimlikleri ve Error/Expected/Received/Locator/Timeout imzaları birebir aynı. Başlangıçta tüm 167 test tekrar çalıştırılmadı; bu karşılaştırma bildirilen 18 hatanın Nova olmadan da oluştuğunu doğrular. İlgisiz testler gevşetilmedi veya değiştirilmedi.

## GitHub Actions

`.github/workflows/nova.yml`, ilgili kaynak, test, migration, bağımlılık veya yapılandırma değişen pull request'lerde ve elle tetiklendiğinde çalışır. Token yetkisi yalnızca `contents: read`; checkout kimlik bilgisini saklamaz. Action sürümleri resmî depoların etiketlerinden doğrulanan commit SHA'larına sabitlendi.

İş akışı Node 24, pnpm 11.19.0 ve `pnpm install --frozen-lockfile` kullanır. Sırasıyla şu depo komutlarını çalıştırır:

```text
pnpm lint
pnpm typecheck
pnpm test:nova
pnpm exec playwright install --with-deps chromium
pnpm test:nova:e2e
pnpm build
```

Gerçek Ollama/model kurulmaz ve çıkarım yapılmaz. E2E yapılandırması yerel demo veritabanını başlatır ve canlı servis anahtarlarını boş bırakır. Workflow üretim migration, deploy, merge, paket yayımlama veya başka bir dış yazma işlemi içermez. Bu dosyanın hazırlanması, GitHub üzerinde çalıştığı veya branch protection ayarlarının değiştirildiği anlamına gelmez.

Kurulum kararları [GitHub Node.js CI belgesi](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs), [pnpm action belgesi](https://github.com/pnpm/action-setup) ve [Playwright CI belgesi](https://playwright.dev/docs/ci-intro) üzerinden doğrulandı. Chromium için resmî `install --with-deps` akışı kullanılır.

## Henüz doğrulanmayanlar

- Gerçek RX 7800 XT üzerinde Ollama çıkarımı, GPU yerleşimi, VRAM tüketimi ve gecikme.
- `qwen3:8b` ile gerçek Türkçe eval sonuçları ve insan tarafından anlamsal/üslup incelemesi.
- Üretim Supabase migration'ı, üretim RLS smoke testi ve production deployment.

GitHub runner sonucu için PR'ın güncel Checks sekmesine bakılmalıdır; yerel testler uzaktaki CI koşusunun yerine geçmez.

Regex ve JSON Schema koruyucuları tüm Türkçe anlam çelişkilerini kanıtlayamaz. Sayısal yarış sonuçları Core/veritabanı gerçeklerinden gösterilir; modelin serbest anlatımı daha dar kabul kurallarıyla sınırlandırılır. Gerçek model kurulumu ve değerlendirmesi için `docs/NOVA_BRIDGE.md` izlenmelidir.
