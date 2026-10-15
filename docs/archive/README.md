# Tarihsel belgeler

Bu klasör geçmiş gereksinimleri, tasarım bağlamını ve tarihli test/kurulum kanıtlarını korur. İçeriği güncel kurulum talimatı, son test sonucu veya canlı ortam envanteri olarak kullanma. Başlangıç noktası [güncel dokümantasyon indeksidir](../README.md).

15 Ekim 2026 düzenlemesinde belgeler silinip geçmiş kaybedilmek yerine bu alana taşındı. Eski belgedeki tarih ve ölçüm kendi dönemine aittir. Başlık, model adı, migration sayısı veya deployment kimliği güncel oldukları anlamına gelmez. Kaynak dosyaya verilmiş bir bağlantı bugün dosyanın yeni sürümünü açabilir; eski davranışı incelemek için ilgili dönemin Git commit'ini kullan.

| Belge | Neden arşivde? | Güncel karşılığı |
| --- | --- | --- |
| [USER_REQUIREMENTS.md](USER_REQUIREMENTS.md) | İlk kullanıcı talimatı; sonraki ürün değişikliklerinden önceki kapsam | [Ürün](../PRODUCT.md) |
| [README_HISTORY.md](README_HISTORY.md) | Eylül kurulum/yayın günlüğü ile kullanım açıklamaları karışıktı | [Kök README](../../README.md), [indeks](../README.md) |
| [SETUP_HISTORY.md](SETUP_HISTORY.md) | Eski tek sahip akışı, migration sayıları ve artık geçerli olmayan yayın durumu | [Kurulum](../SETUP.md) |
| [PHASE3_SETUP_HISTORY.md](PHASE3_SETUP_HISTORY.md) | AI/OAuth/MCP kurulum olayları ve kaldırılmış otomatik rapor talimatları | [AI ve MCP](../integrations/AI_MCP.md) |
| [TESTING_HISTORY.md](TESTING_HISTORY.md) | Birden fazla sürümün test sayıları ve teslim notları | [Test rehberi](../TESTING.md) |
| [GOOGLE_CALENDAR_HISTORY.md](GOOGLE_CALENDAR_HISTORY.md) | 24–26 Eylül canlı kurulum ve doğrulama beyanları | [Google Takvim](../integrations/GOOGLE_CALENDAR.md) |
| [STUDENT_PERSONALIZATION_HISTORY.md](STUDENT_PERSONALIZATION_HISTORY.md) | İlk dal/teslim/migration açıklaması | [Öğrenci çalışma alanı](../features/STUDENT_PERSONALIZATION.md) |
| [KIRKLARELI_MEDICINE_HISTORY.md](KIRKLARELI_MEDICINE_HISTORY.md) | İlk teknik açıklama ve dönemin yayın/test notu | [Kırklareli Tıp](../features/KIRKLARELI_MEDICINE.md) |
| [STUDENT_PERSONALIZATION_ACCEPTANCE.md](STUDENT_PERSONALIZATION_ACCEPTANCE.md) | Döneme ait AI model/kota ve kabul kanıtları | [Öğrenci çalışma alanı](../features/STUDENT_PERSONALIZATION.md), [testler](../TESTING.md) |
| [PERFORMANCE_HISTORY.md](PERFORMANCE_HISTORY.md) | 4–7 Ekim performans inceleme ve ölçüm günlüğü | [Performans yaklaşımı](../reference/PERFORMANCE.md) |
| [REALTIME_HISTORY.md](REALTIME_HISTORY.md) | Artık kullanılmayan SSE/publish mimarisi | [Polling ve yenileme](../features/REALTIME.md) |
| [NOVA_CORE_HISTORY.md](NOVA_CORE_HISTORY.md) | Kaldırılmış sohbet/ilişki yardımcılarını da içeren motor taslağı | [Aktif motor](../reference/NOVA_CORE.md) |
| [NOVA_DATABASE_HISTORY.md](NOVA_DATABASE_HISTORY.md) | Sohbet, cihaz, kuyruk ve Bridge SQL sözleşmeleri | [Nova](../features/NOVA.md) |
| [NOVA_VERIFICATION.md](NOVA_VERIFICATION.md), [NOVA_REFRESH_VERIFICATION.md](NOVA_REFRESH_VERIFICATION.md) | Eski sohbet/model/Bridge ve yayın doğrulaması | [Nova](../features/NOVA.md), [testler](../TESTING.md) |
| [SOURCES.md](SOURCES.md) | 24 Eylül kaynak taraması ve o günün doğrulama sınırları | Güncel kod ve ilgili özellik belgesi |

Kökteki [PRD.md](../../PRD.md), [IMPLEMENTATION_PLAN.md](../../IMPLEMENTATION_PLAN.md) ve [FEATURE_CHECKLIST.md](../../FEATURE_CHECKLIST.md) ilk aşamalara ait tarihsel belgelerdir. Eski bağlantılar ve başlangıç bağlamı için yerlerinde tutulur; güncel görev listesi olarak kullanılmaz.

`NOVA_BRIDGE.md` ve `NOVA_WINDOWS_PACKAGE.md` yalnız aynı kullanım dışı açıklamasını tekrarlıyordu; kaldırıldı. Ortak açıklama, HTTP 410 davranışı ve eski veri sınırı [aktif Nova belgesinde](../features/NOVA.md) tutulur. Bu arşiv eski Bridge kurulumunu yeniden etkinleştirme talimatı değildir.
