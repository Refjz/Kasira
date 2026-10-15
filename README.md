# Kasira POS

Prototipe aplikasi kasir (POS) multi-tenant dengan tiga tingkat akun: Pemilik Aplikasi, Pemilik Usaha, dan staf (Manajer/Kasir). Mendukung mode Minimarket (barcode, harga grosir, kedaluwarsa) dan F&B (varian, meja, layar dapur).

- `index.html`: landing page Kasira.
- `app/index.html`: prototipe aplikasi kasir satu file, tanpa build. Data contoh disimpan di browser (localStorage).
- `docs/rencana-produk.md`: rencana produk, peran, stack, dan tahapan.

## Deploy ke Cloudflare Pages

Situs statis, tanpa langkah build:

- Framework preset: None
- Build command: (kosong)
- Build output directory: `/`
