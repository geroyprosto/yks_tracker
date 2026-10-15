# Test ve doğrulama

Komutların kaynağı [package.json](../package.json), tarayıcı ayarlarının kaynağı ilgili Playwright config dosyasıdır. Bu sayfa testlerin nasıl çalıştırılacağını ve hangi sonucu kanıtladığını açıklar. Eski koşuların sayıları güncel test sonucu değildir; [tarihsel test kaydında](archive/TESTING_HISTORY.md) korunur.

## Test katmanları

| Komut | Kapsam | Kanıt sınırı |
| --- | --- | --- |
| `pnpm test` | `tests/*.test.ts`: alan hesapları, şemalar, servis/istemci sözleşmeleri | Gerçek sağlayıcı veya tarayıcı kabulü değildir. Bazı testler statik kaynak sözleşmelerini de kontrol eder. |
| `pnpm test:db` | `supabase/tests/*.test.ts`: PGlite üzerinde migration, RPC, RLS ve transaction davranışı | Docker veya uzak Supabase gerekmez. Auth kimlik kaynağı ve gerekli Storage parçaları test düzeneklerinde taklit edilir. |
| `pnpm test:all` | Yukarıdaki iki dosya grubunu tek koşuda çalıştırır | Playwright'ı içermez; ayrıca `test` ve `test:db` çalıştırmak aynı testleri tekrarlar. |
| `pnpm test:e2e` | Genel uygulama akışları, `tests/e2e` | Dış hizmetler kurulumsuz sunucu/HTTP mock ile ayrılır; gerçek Google, OpenAI veya Supabase kabulü değildir. |
| `pnpm test:classroom` | Hesap/rol/üyelik akışları, `tests/classroom-e2e` | Yerel PGlite demosunda çalışır. Öğretmen alanının duraklatılmasına bağlı senaryolar atlanabilir; atlanan test başarılı kabul değildir. |
| `pnpm test:nova` | Nova adını taşıyan birim ve DB testleri | Tam test paketinin yerine geçmez. |
| `pnpm test:nova:e2e` | Nova simülasyonu ve yarış, `tests/nova-e2e` | Yerel demo; canlı hesap/sağlayıcı kabulü değildir. |

## Tarayıcı hazırlığı ve portlar

Playwright testleri sunucuyu kendileri başlatır. Önceden ayrı test sunucusu açma; ilgili port boş olmalıdır. `reuseExistingServer:false` başka çalışan sunucunun yanlışlıkla test edilmesini engeller.

| Config | Adres | Paralellik ve çıktı |
| --- | --- | --- |
| [playwright.config.ts](../playwright.config.ts) | `http://127.0.0.1:3100` | 2 worker; varsayılan `test-results/` |
| [playwright.classroom.config.ts](../playwright.classroom.config.ts) | `http://127.0.0.1:3200` | 1 worker; `tmp/playwright-classroom-results/` |
| [playwright.nova.config.ts](../playwright.nova.config.ts) | `http://127.0.0.1:3400` | 1 worker; `tmp/playwright-nova-results/` |

Windows'ta varsayılan tarayıcı kanalı `msedge`, diğer sistemlerde Playwright Chromium'dur. Chromium kurmak ve Windows'ta açıkça seçmek için:

```powershell
pnpm exec playwright install chromium
$env:PLAYWRIGHT_CHANNEL = 'chromium'
pnpm test:e2e
Remove-Item Env:PLAYWRIGHT_CHANNEL
```

Linux CI sistem bağımlılıkları için `pnpm exec playwright install --with-deps chromium` kullanır. Üç config de `tr-TR`, `Europe/Istanbul`, hata halinde screenshot/trace ve engellenmiş service worker ile çalışır. Config env değerleri dış hizmet erişimini sınırlar; testleri üretim kimlik bilgileriyle genişletme.

## Değişiklik için uygun kontrolü seç

Genel yerel kalite koşusu:

```powershell
pnpm lint
pnpm typecheck
pnpm test:all
pnpm build
```

Davranış veya arayüz değiştiğinde ilgili Playwright paketini de çalıştır. Tek bir akışı incelemek için:

```powershell
pnpm exec tsx --test tests/progress.test.ts
pnpm exec playwright test tests/e2e/calendar.spec.ts
pnpm exec playwright test --config playwright.classroom.config.ts tests/classroom-e2e/account-deletion.spec.ts
```

Şema değişiminde DB testlerine ek olarak ayrı geliştirme Supabase ortamında migration uygulamasını ve gerçek Auth/Storage davranışını doğrula. PGlite'ın taklit ettiği platform parçaları bu son kontrolü gerekli kılar. Lint, typecheck ve build birbirini ikame etmez.

[Nova CI iş akışı](../.github/workflows/nova.yml) ilgili PR dosya filtreleriyle lint, typecheck, `test:nova`, Nova E2E ve build çalıştırır. Bu workflow'un yeşil olması tüm uygulama E2E paketinin çalıştığı anlamına gelmez.

## Canlı kabul ayrı kayıt tutulur

Gerçek sağlayıcı kabulünde hangi ortamı/commit'i, hangi hesabın rolünü, hangi akışı ve hangi sonucu doğruladığını tarihli yaz. Sırları veya kişisel kayıt içeriklerini kanıt dosyasına koyma. En azından giriş ve yetkisiz erişim, kayıt/yenileme, iki cihaz, Google bağlama/iptal, özel Storage erişimi ve etkinse AI/MCP sınırları ilgili değişikliğe göre değerlendirilir.

AI için mock cevap, gerçek model çağrısı ve raporun DB/tarayıcıda tamamlanması ayrı kanıtlardır. Gerçek model değerlendirmesi ücret doğurabilir. `scripts/evaluate-student-reports.ts` varsayılan çevrimdışı sentetik değerlendirmedir; `--paid-approved` yolu açık izin ve izole altı sentetik hesap ister. Bu script'in başarılı olması koçluk raporunun bütün kullanıcı akışını doğrulamaz.

Çıktıyı “geçti/başarısız/atlandı” olarak, çalıştırılan komut ve kapsamıyla yaz. Tarihsel `169/169` gibi sayıları yeni kontrol yapmadan güncel sonuç diye kullanma. Önceki AI/MCP kabul notları [Aşama 3 geçmişinde](archive/PHASE3_SETUP_HISTORY.md), güncel entegrasyon sınırları [AI/MCP rehberindedir](integrations/AI_MCP.md).
