# Kasvara POS: Rencana Produk

Aplikasi kasir (POS) berbasis web untuk publik, model SaaS multi-tenant seperti Amazstep: satu platform, banyak usaha pelanggan, tiap usaha punya tim sendiri.

> Nama "Kasvara" hanya nama kerja, bisa diganti. Riset web tentang Luna POS dan Amazstep tidak menemukan halaman fitur resmi, jadi perbandingan di bawah disusun dari pengetahuan umum tentang aplikasi kasir di Indonesia (Luna POS, Moka, Majoo, Pawoon) dan perlu dicek ulang.

## 1. Tiga tingkat akun

| Tingkat | Akun | Bisa melakukan |
|---|---|---|
| 1 | **Pemilik Aplikasi** (super admin, kamu) | Lihat semua usaha, MRR, GMV; tangguhkan/aktifkan usaha; atur paket & harga; masuk sebagai pemilik usaha untuk bantuan (impersonate, tercatat di log) |
| 2 | **Pelanggan / Pemilik Usaha** (tenant) | Daftar sendiri, pilih paket, kelola outlet, produk, stok, staf, laporan, tagihan langganan |
| 3 | **Akun internal pelanggan** | **Manajer**: kasir, produk, stok, dasbor. **Kasir**: jualan dan lihat transaksi miliknya saja. (Bisa ditambah: Gudang, Akuntan, Pelayan) |

Hak akses per peran disimpan sebagai tabel permission, bukan hardcode, supaya pemilik usaha bisa membuat peran kustom di paket Bisnis.

## 2. Fitur inti (MVP)

- Kasir: grid produk + pencarian/barcode, kategori, keranjang, diskon, PB1/PPN per usaha, bayar Tunai/QRIS/Kartu/Transfer, kembalian, struk cetak (printer Bluetooth 58mm) dan struk WhatsApp
- Produk & stok: harga jual, modal, margin, stok otomatis berkurang, peringatan stok menipis, varian & modifier (ukuran, level gula)
- Transaksi: riwayat, detail struk, refund/void dengan PIN manajer
- Dasbor: omzet, jumlah transaksi, rata-rata struk, laba kotor, grafik 7/30 hari, produk terlaris, jam tersibuk
- Staf: undang via email, PIN kasir 6 angka, shift buka/tutup kas
- Langganan: paket Gratis / Pro / Bisnis, batas staf/produk/outlet per paket, tagihan bulanan otomatis
- Konsol pemilik aplikasi: daftar tenant, status, paket, MRR, GMV, impersonate, audit log

## 3. Pembeda supaya lebih unggul dari Luna POS

1. **Offline-first**: kasir tetap jalan saat internet putus, sinkron otomatis saat online (PWA + IndexedDB)
2. **Untuk semua jenis usaha**: mode F&B (meja, dapur), Retail (barcode, grosir), Jasa (kiloan, booking), bukan hanya restoran
3. **Wawasan otomatis**: jam tersibuk, produk lambat laku, saran restock, ringkasan harian dikirim ke WhatsApp pemilik
4. **Self-order QR meja**: pelanggan pesan dan bayar QRIS dari HP, pesanan masuk ke kasir dan layar dapur
5. **Loyalty & member**: poin, voucher, database pelanggan dari nomor WA
6. **Coba gratis 7 hari** dengan semua fitur Pro, lalu wajib berlangganan
7. **Multi-outlet & transfer stok** di paket Bisnis
8. **Integrasi**: GoFood/GrabFood/ShopeeFood (stok sinkron), akuntansi (Jurnal/Accurate), API terbuka

## 3b. Mode jenis usaha

Saat daftar, pemilik memilih jenis usaha. Kasir, produk, dan dasbor menyesuaikan otomatis.

| | Minimarket / Retail | F&B (kafe, resto, warung) |
|---|---|---|
| Sudah ada di prototipe | Scan barcode (Enter langsung masuk keranjang), harga grosir otomatis per jumlah, tanggal kedaluwarsa + peringatan 14 hari | Varian/modifier (gula, es, level pedas), makan di sini dengan nomor meja / bawa pulang / ojol, layar dapur (Baru → Diproses → Siap), PB1 10% |
| Fase berikutnya | Satuan bertingkat (pcs/pak/dus), stok opname, penerimaan barang dari supplier & PO, batch/FIFO kedaluwarsa, timbangan digital, label harga, member & poin | Resep & bahan baku (stok berkurang per gram), denah meja & gabung/pisah bill, split bill, open bill/tab, cetak tiket dapur per stasiun (bar/dapur), self-order QR meja, integrasi GoFood/GrabFood/ShopeeFood |

## 4. Stack teknis yang disarankan

| Lapisan | Pilihan | Alasan |
|---|---|---|
| Frontend | Next.js (React) + Tailwind, dipasang sebagai PWA | Satu kode untuk web, tablet kasir, dan HP |
| Backend & DB | Supabase (PostgreSQL + Auth + Storage) | Row Level Security memisahkan data antar tenant di level database |
| Offline | IndexedDB (Dexie) + antrean sinkronisasi | Kasir tidak berhenti saat internet mati |
| Pembayaran | Midtrans atau Xendit | QRIS dinamis + tagihan langganan otomatis |
| WhatsApp | WhatsApp Business API (mis. Qontak, Fonnte) | Struk & ringkasan harian |
| Hosting | Vercel + Supabase cloud (region Singapura) | Cepat untuk pengguna Indonesia |

Model data multi-tenant: setiap tabel bisnis (`products`, `transactions`, `outlets`, `staff`, ...) punya kolom `tenant_id`; kebijakan RLS memastikan user hanya membaca baris `tenant_id` miliknya. Super admin memakai service role di konsol terpisah.

Tabel utama: `tenants`, `plans`, `subscriptions`, `users`, `memberships (user_id, tenant_id, role)`, `roles_permissions`, `outlets`, `products`, `product_variants`, `stock_movements`, `transactions`, `transaction_items`, `payments`, `shifts`, `customers`, `audit_logs`.

## 5. Paket langganan (usulan, harga perlu divalidasi)

| Paket | Harga/bulan | Batas |
|---|---|---|
| Coba gratis | Rp0 selama 7 hari | Semua fitur Pro; setelah 7 hari kasir terkunci sampai membayar |
| Pro | Rp99.000 | 3 outlet, 10 staf, produk tak terbatas, struk WA, ekspor laporan |
| Bisnis | Rp249.000 | Outlet & staf tak terbatas, transfer stok, API, peran kustom |

## 6. Tahapan

1. **Fase 1 (MVP)**: auth 3 tingkat, kasir, produk/stok, transaksi, dasbor, staf, langganan manual. Prototipe sudah ada.
2. **Fase 2**: offline-first, printer Bluetooth, QRIS Midtrans/Xendit, tagihan otomatis, struk WA
3. **Fase 3**: multi-outlet, self-order QR meja, layar dapur, loyalty
4. **Fase 4**: integrasi ojol & akuntansi, API publik, aplikasi Android (bungkus PWA)

## 7. Prototipe

File `prototipe-kasira.html` di folder ini: buka di browser, pilih akun contoh untuk mencoba tiap tingkat. Data contoh disimpan di browser masing-masing dan bisa di-reset dari layar masuk.
