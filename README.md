# Kasvara POS

Aplikasi kasir (POS) multi-tenant dengan tiga tingkat akun: Pemilik Aplikasi, Pemilik Usaha, dan staf (Manajer/Kasir). Mendukung mode Minimarket dan F&B, dan tetap bisa berjualan saat internet putus.

Fitur utama: shift kasir dengan selisih kas, refund/batal dengan PIN manajer, struk Bluetooth/RawBT/WhatsApp, mode offline, total dihitung ulang di server, laporan lengkap dengan ekspor Excel, lupa/ganti kata sandi, barang masuk dari supplier, stok opname, riwayat stok, scan barcode kamera HP, satuan bertingkat (pcs/pak/dus), open bill, split bill, denah meja, resep bahan baku, QRIS otomatis (Midtrans), member dan poin, promo dan voucher, multi-outlet dengan transfer stok.

- `public/index.html`: landing page. Tombol "Coba gratis" mengarah ke pendaftaran (`/app/#daftar`).
- `public/app/`: aplikasi kasir (ES modules, tanpa build). `core.js` state/API/offline, `pricing.js` perhitungan harga yang dipakai bersama oleh browser dan server, `pos.js` kasir/meja/dapur, `manage.js` produk/stok/member/promo/staf/outlet/pengaturan, `reports.js` laporan/transaksi/shift, `app.js` menu/login/akun/langganan/konsol. `sw.js` menyimpan aplikasi untuk dipakai offline. `vendor/` berisi SheetJS (Excel), ZXing (barcode), dan qrcode-generator.
- `functions/api/[[path]].js`: API (Cloudflare Pages Functions): daftar, masuk, sesi, produk, transaksi, staf, langganan, konsol pemilik aplikasi.
- `schema.sql`: tabel database Cloudflare D1 (`kasira-db`).
- `android/`, `capacitor.config.json`: aplikasi Android (Capacitor) yang memuat `https://kasira-c70.pages.dev/app/`.
- `docs/rencana-produk.md`: rencana produk, peran, stack, dan tahapan.

## Akun dan masa coba

- Usaha mendaftar sendiri di `/app/#daftar` dan langsung mendapat semua fitur selama **7 hari**.
- Setelah 7 hari, kasir terkunci. Pemilik usaha hanya bisa membuka menu Langganan dan mengajukan pembayaran (Bulanan Rp99.000 atau Tahunan Rp990.000). Semua paket berisi semua fitur tanpa batas; yang berbeda hanya periode tagihan. Staf melihat layar terkunci. Data tetap tersimpan.
- Pemilik Aplikasi melihat permintaan pembayaran di menu Pelanggan, lalu lewat tombol "Atur akun" bisa memperpanjang masa coba atau langsung menjadikan usaha pelanggan bulanan/tahunan. Pemilik usaha (masa coba maupun berlangganan) bisa mengosongkan data di menu Pengaturan dengan memasukkan kata sandinya.
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

Secret opsional (atur dengan `npx wrangler pages secret put NAMA --project-name kasira`):

| Secret | Untuk |
| --- | --- |
| `RESEND_API_KEY`, `MAIL_FROM` | Email lupa kata sandi lewat Resend. Tanpa ini, Pemilik Aplikasi bisa membuat tautan ganti kata sandi dari menu Pelanggan. |
| `MIDTRANS_SERVER_KEY` | Pembayaran langganan otomatis lewat Midtrans Snap. Tanpa ini, permintaan bayar dikonfirmasi manual. |
| `MIDTRANS_PRODUCTION` | Isi `true` untuk mode produksi Midtrans. |

QRIS otomatis untuk pelanggan toko memakai Server Key Midtrans milik masing-masing usaha (diisi pemilik usaha di Pengaturan). Atur Payment Notification URL di dashboard Midtrans ke `https://<domain>/api/midtrans/notify`.

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


## Aplikasi Android

Aplikasi Android memuat tampilan dari dalam APK (folder `android-web/`, dibuat dari `public/app` oleh `scripts/android-web.mjs`), bukan membuka situs di browser. Data tetap lewat API di `https://kasira-c70.pages.dev/api/`; sesi dikirim sebagai header `Authorization: Bearer`, dan server hanya membuka CORS untuk origin aplikasi (`https://localhost`, `capacitor://localhost`).

Build APK + AAB bertanda tangan: `powershell -ExecutionPolicy Bypass -File build-android.ps1 -VersionCode 3` (naikkan setiap unggah ke Play Console). Tampilan baru di situs baru masuk ke aplikasi setelah build ulang, tetapi perubahan API langsung berlaku setelah deploy.

Printer Bluetooth di aplikasi Android memakai plugin BLE native (`@capacitor-community/bluetooth-le`), karena WebView Android tidak punya Web Bluetooth. Printer yang hanya Bluetooth Classic tetap bisa lewat mode RawBT. Status bar dan splash diatur `public/app/native.js`.

## Lingkungan uji

Deploy ke cabang selain `main` (mis. `npx wrangler pages deploy --project-name kasira --branch uji`) memakai database terpisah `kasira-db-test` (`[env.preview]` di `wrangler.toml`), di https://uji.kasira-c70.pages.dev. APK uji: isi env `KASIRA_API=https://uji.kasira-c70.pages.dev` sebelum `npm run android:sync`.
