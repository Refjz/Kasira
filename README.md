# Kasira POS

Aplikasi kasir (POS) multi-tenant dengan tiga tingkat akun: Pemilik Aplikasi, Pemilik Usaha, dan staf (Manajer/Kasir). Mendukung mode Minimarket (barcode, harga grosir, kedaluwarsa) dan F&B (varian, meja, layar dapur).

- `public/index.html`: landing page. Tombol "Coba gratis" mengarah ke pendaftaran (`/app/#daftar`).
- `public/app/index.html`: aplikasi kasir satu file, tanpa build. Data disimpan di server lewat API.
- `functions/api/[[path]].js`: API (Cloudflare Pages Functions): daftar, masuk, sesi, produk, transaksi, staf, langganan, konsol pemilik aplikasi.
- `schema.sql`: tabel database Cloudflare D1 (`kasira-db`).
- `android/`, `capacitor.config.json`: aplikasi Android (Capacitor) yang memuat `https://kasira-c70.pages.dev/app/`.
- `docs/rencana-produk.md`: rencana produk, peran, stack, dan tahapan.

## Akun dan masa coba

- Usaha mendaftar sendiri di `/app/#daftar` dan langsung mendapat semua fitur selama **7 hari**.
- Setelah 7 hari, kasir terkunci. Pemilik usaha hanya bisa membuka menu Langganan dan mengajukan pembayaran (Bulanan Rp99.000 atau Tahunan Rp990.000). Semua paket berisi semua fitur tanpa batas; yang berbeda hanya periode tagihan. Staf melihat layar terkunci. Data tetap tersimpan.
- Pemilik Aplikasi melihat permintaan pembayaran di menu Pelanggan, lalu lewat tombol "Atur akun" bisa memperpanjang masa coba atau langsung menjadikan usaha pelanggan bulanan/tahunan. Selama masa coba, pemilik usaha bisa mengosongkan data di menu Pengaturan.
- Akun Pemilik Aplikasi diaktifkan sekali di `/app/#setup`. Hanya email yang tersimpan di secret `OWNER_EMAIL` yang bisa diaktifkan. Kata sandi tidak pernah disimpan di repo.

## Pengembangan lokal

```
npm install
npx wrangler d1 execute kasira-db --local --file schema.sql
echo OWNER_EMAIL=owner@kasira.test > .dev.vars
npm run dev
```

Buka http://127.0.0.1:8788.

## Deploy ke Cloudflare Pages

```
powershell -ExecutionPolicy Bypass -File deploy.ps1 -OwnerEmail <email-pemilik>
```

Skrip ini menyiapkan tabel D1, menyimpan `OWNER_EMAIL` sebagai secret, lalu mengunggah `public/` dan `functions/`. `-OwnerEmail` cukup diberikan sekali.

## Build Android

Butuh JDK 21 dan Android SDK (API 36). Upload key disimpan di luar repo (Google Drive, `Aplikasi POS (Kasira)\Kasira-keys`).

```
npx cap sync android
cd android
set UPLOAD_KEYSTORE_PATH=...\upload-keystore.jks
set UPLOAD_KEYSTORE_PASSWORD=...
set UPLOAD_KEY_PASSWORD=...
set VERSION_CODE=2
gradlew bundleRelease assembleRelease
```

Setiap unggahan ke Play Console butuh `VERSION_CODE` yang lebih besar dari sebelumnya.

