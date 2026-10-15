# YKSim

Türkçe çalışma takip uygulaması. Günlük görevler, çalışma sayacı, konu ilerlemesi, deneme ve okul sonuçları, günlük, arkadaş grupları ve isteğe bağlı analiz araçlarını bir araya getirir. YKS, lise ve üniversite çalışma profilleri; ayrıca Kırklareli Tıp ve Nova simülasyon modülleri bulunur.

**Geliştirici başlangıcı: [dokümantasyon ve okuma sırası](docs/README.md).**

## Yerelde çalıştır

Gerekenler: Node.js 24.x ve pnpm 11.19.0; kesin sürümler [package.json](package.json) içindedir.

```powershell
pnpm install --frozen-lockfile
pnpm dev:demo
```

[Yerel demo](http://127.0.0.1:3300/demo), gerçek hesap veya harici servis anahtarı gerektirmeyen PGlite veritabanıyla çalışır. Demo hesabını bu sayfadan seç. Yerel veriler `tmp/classroom-demo/` altında tutulur; demo üretimde kapalıdır.

Gerçek Supabase hesabıyla geliştirmek için [kurulumu](docs/SETUP.md) izle; ardından `pnpm dev` ile [localhost:3000](http://localhost:3000) adresini aç. Ortam değişkenleri olmadan açılan kurulum önizlemesi kalıcı bulut kayıt sağlamaz.

## Okuma sırası

1. [Ürün ve güncel sınırlar](docs/PRODUCT.md)
2. [Geliştirme akışı ve komutlar](docs/DEVELOPMENT.md)
3. [Mimari, roller ve veri akışı](docs/ARCHITECTURE.md)
4. [Testleri çalıştırma](docs/TESTING.md)
5. [Üzerinde çalışacağın modül](docs/README.md#konuya-göre-başvuru)

## Teknoloji

Next.js App Router, React, TypeScript, Tailwind/CSS, Supabase Auth/PostgreSQL/Storage; isteğe bağlı Upstash Redis ve sunucu entegrasyonları. Uygulama sürümleri için `package.json` ve `pnpm-lock.yaml`, veri şeması için `supabase/migrations/` esas alınır.

Öğrenci/öğretmen/yönetici rolleri vardır; öğretmen özellikleri mevcut kodda geçici olarak duraklatılmıştır. AI raporları manuel istek ve bütçe denetimiyle çalışır; otomatik ücretli rapor üretimi kapalıdır. Nova simülasyonu yerel model veya Windows Bridge gerektirmez. Ayrıntılar ve erişim koşulları ilgili modül rehberlerindedir.

## Doğrulama

```powershell
pnpm lint
pnpm typecheck
pnpm test:all
pnpm build
```

İlgili tarayıcı testleri ve gerçek sağlayıcı kabulü için [test rehberini](docs/TESTING.md) kullan. `test:all` tarayıcı testlerini içermez.

[Canlı uygulama](https://yks-tracker-puce.vercel.app/) · [İlk ürün talimatı](docs/archive/USER_REQUIREMENTS.md) · [Tarihsel kayıtlar](docs/archive/README.md)
