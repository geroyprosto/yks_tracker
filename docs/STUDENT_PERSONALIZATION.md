# Öğrenci çalışma alanı

Bu değişiklik `793e0ae` üzerine `codex/student-personalization` dalında geliştirilmiştir. Kapsam YKS, lise ve üniversitedir. Eğitim profili yetki rolü değildir. Öğretmen, yönetici, başvuru onayı ve sınıf ilişkileri mevcut kontrolleri kullanır.

## Model ve akış

`education_profiles` eğitim düzeyini (`high_school`, `university`, `graduate`) YKS hedefinden ayrı tutar. Sınıf, isteğe bağlı bölüm/sınıf bilgisi, alan tercihi, görünür modüller ve aktif dönem bu profile aittir. Yeni bir YKS alan tercihi mevcut TYT / AYT Sayısal / branş deneme formatlarını dönüştürmez. Eksiksiz lise müfredatı veya bölümden otomatik üniversite ders listesi üretilmez.

`education_terms` arşivlenebilir dönemleri, `education_courses` kalıcı ders kimliklerini saklar. Okul dersinin dönemi zorunludur; YKS dersi TYT/AYT bağlamı taşır. Kullanıcı + dönem + bağlam + sınav + Türkçe normalize edilmiş ad benzersizdir. Aynı adlı farklı dönem dersleri ve okul Matematik / TYT Matematik ayrı kayıtlardır. YKS dersinin ilk katalog konusu `catalog_subject` alanında sabit tutulur; ad değişince eski konudan yeni görev veya sayaç başlatılabilir. Ad değişikliği ilişkileri koparmaz; tarihsel görev/oturum/sonuç etiketi korunur. Arşivleme kayıt silmez.

`course_exam_results` alınan puan ve orijinal ölçeği ayrı saklar. YKS `exams` tablosu ve net hesapları aynen kullanılır. Sonuç düzenlemeleri sahiplik, beklenen revizyon ve denetim kaydı ile yapılır. Toplu girişte boş alan kayıt üretmez, sıfır geçerlidir. CSV/TSV yerel ayrıştırılır; kolonlar ve belirsiz dersler önizlemede kullanıcı tarafından eşleştirilir. Bu işlemler AI çağırmaz.

Yeni öğrencide dört adımlı akış: eğitim/hedef → dönem → önizlemeli ders listesi → görünür araçlar ve açık kaydetme. Taslaklar ayrı `education_drafts` tablosundadır. İleri adımda veya “Taslağı kaydet” ile saklanır; sayfa yenilendiğinde sürdürülebilir. Ayarlardaki düzenleme aynı bileşen ve son kaydetme doğrulamasını kullanır; iptal aktif profili değiştirmez. Açıkça kaydedilmiş taslak ayrı kalır.

E-posta doğrulanmış, onay bekleyen öğrenci yalnız kendi taslağını okuyabilir/yazabilir. `/personalize` çalışma verilerini açmaz. Onaylı öğrencinin kurulum sırasında sınıf mesajları ve çalışma emri arayüzü korunur. Öğretmen/yönetici kurulum akışına zorlanmaz. Geçişte mevcut hesaplar YKS uyumluluk varsayılanını alır; yeniden kurulum zorunlu değildir. Ayarlardan eğitim durumu değiştirilebilir.

`/api/education` komutları kullanıcıya bağlı işlem UUID’si ve payload ile makbuz tutar. Tek işlem yeniden gönderildiğinde kopya üretmez; yeni gerçek sınav yeni UUID alır. `results.batch` tek SQL transaction içindedir. Hesap başına kilit eşzamanlı yazımları sıralar. Ders/dönem/sınav kimliklerinin sahibi SQL’de doğrulanır; istemci tarafındaki kartlara güvenilmez. Yeni tablolar RLS ve açık, dar yetkilendirme kullanır.

Ortak seçici sayaç, görev ve ders yönetiminde aynı ders kimliklerini kullanır. Seçiciden ders eklemek açık formu korur. Toplu sınav tablosunda aktif dönem dersleri doğrudan hazırdır. Aktif sayaç sırasında profil/dönem değişimi ve ders arşivleme engellenir; eski oturum yeni derse taşınmaz. Sonlandırılmış oturum süresi, aralıkları ve manuel kesinleşmiş süreler normal API/RPC/MCP veya doğrudan tablo yazımıyla değiştirilemez. Hesap kapatma için yetkili Auth kullanıcı silme zinciri ayrı kalır.

İstatistiklerde puan, yüzde ve net ayrı anlam taşır. Karşılaştırma ders, tür, özel sınav adı ve ölçeğe göre sınırlandırılır. Fark “puan” veya “yüzde puan”dır; öğrenme artışı iddia edilmez. Eksik sınav sıfır sayılmaz. Dönem ağırlıkları/harf notu/GPA bu sürümde hesaplanmaz.

## Migration yaklaşımı

Sıralı dosyalar:

1. `supabase/migrations/20260927152739_student_personalization.sql`
2. `supabase/migrations/20260927152814_ai_student_reports.sql`

İlk migration tabloları ve nullable ders ilişkilerini ekler, mevcut konu kataloğundan kullanıcıya ait YKS derslerini kurar. Görevler yalnız aynı kullanıcı/sınav/normalize adın kesin eşleşmesinde, sayaç ve manuel süreler yalnız açık TYT/AYT ön ekiyle eşleştiğinde bağlanır. Eski konuları, kaynak/not/öğrenme düzeylerini, denemeleri, doğru/yanlış/boş/net kayıtlarını ve süreleri silmez veya yeniden hesaplamaz. Belirsiz geçmiş ders etiketleri korunur. İkinci migration rapor sürümünü, sabit hesap kotasını ve uygulama bütçe denetimini ekler; AI varsayılan kapalıdır.

Eşleşmemiş eski etiketleri yetkili operatör veya kendi kayıtları üzerinde RLS ile raporlamak için:

```sql
select 'task' kind,id,subject,exam from public.tasks
where course_id is null and subject is not null
union all
select 'session',id,subject,null from public.study_sessions
where course_id is null and subject is not null
union all
select 'manual',id,subject,null from public.manual_study_entries
where course_id is null;
```

Canlı migration çalıştırılmadı. Ayrı test veritabanında tam migration sırası, kayıt/süre/net karşılaştırması ve yetki testleri doğrulanmalıdır. Yerel PGlite testleri PostgreSQL davranışının bir kısmını doğrular; Supabase Auth, Data API, Storage ve ağ eşzamanlılığının kabulü ayrıca yapılır. Canlıda geri dönüş için uygulama geri alınabilir; ek tablolar ve veri korunur. Yeni kayıtlar oluştuktan sonra tabloları silen bir “down” migration uygulanmaz. Kota ve süre değişmezliğini sağlayan güvenlik migration’ları korunur.

## Temel dosyalar

- Model/doğrulama: `src/lib/education.ts`, `src/lib/domain/commands.ts`, `src/lib/server/education.ts`.
- Kurulum/ayar/seçici: `education-setup.tsx`, `education-settings.tsx`, `course-selector.tsx`, `personalization-page.tsx`.
- Panel entegrasyonu: `dashboard.tsx`, `today.tsx`, `timer.tsx`, `tasks.tsx`, `preferences.tsx`, `statistics-workspace.tsx`.
- Sonuçlar: `school-results-entry.tsx`, `school-results.tsx`, `src/lib/school-results.ts`.
- AI: `src/lib/ai-report.ts`, `analysis-snapshot.ts`, `server/analysis-provider.ts`, `server/analysis.ts`, `server/journal-ai.ts`.

Değişken sağlayıcı davranışları için [Supabase RLS belgesi](https://supabase.com/docs/guides/database/postgres/row-level-security) ve AI kabul belgesindeki resmi OpenAI kaynakları kullanıldı. Next.js 16.3.6 için kurulu paketin `node_modules/next/dist/docs/` rehberleri okundu.
