// Business profiles: what the owner picks at sign-up. Each maps to a base type (drives tax, tables and
// starter data) and a default feature set, which the owner can still change later in Settings.
// Shared by the browser and the API.
export const FEATURES = {
  cost: ["Modal per produk", "Isi harga modal di tiap produk untuk menghitung laba."],
  barcode: ["Barcode", "Scan dan simpan barcode produk."],
  units: ["Satuan bertingkat", "Jual per pcs, pak, atau dus dengan harga masing-masing."],
  wholesale: ["Harga grosir", "Harga khusus untuk pembelian dalam jumlah banyak."],
  expiry: ["Tanggal kedaluwarsa", "Catat kedaluwarsa produk."],
  mods: ["Varian menu", "Pilihan seperti level pedas, gula, es, atau ukuran."],
  recipe: ["Resep bahan baku", "Stok bahan berkurang otomatis setiap menu terjual."],
  tables: ["Meja & open bill", "Pesan per meja, bayar belakangan."],
  kitchen: ["Layar dapur", "Pesanan langsung tampil di dapur."],
  track: ["Lacak stok produk baru", "Produk baru otomatis dilacak stoknya."]
};

const on = keys => Object.fromEntries(Object.keys(FEATURES).map(k => [k, keys.includes(k)]));
export const PROFILES = {
  restoran: { name: "Restoran / rumah makan", type: "F&B", hint: "Meja, dapur, varian menu", features: on(["mods", "recipe", "tables", "kitchen"]), categories: ["Makanan", "Minuman", "Snack", "Paket"] },
  kafe: { name: "Kafe / kedai kopi", type: "F&B", hint: "Varian gula & es, resep, meja", features: on(["mods", "recipe", "tables", "kitchen"]), categories: ["Kopi", "Non-kopi", "Makanan", "Snack"] },
  warung: { name: "Warung makan / kaki lima", type: "F&B", hint: "Simpel: pesan, bayar, selesai", features: on(["mods"]), categories: ["Makanan", "Minuman", "Gorengan"] },
  minimarket: { name: "Minimarket / toko kelontong", type: "Minimarket", hint: "Barcode, pcs-pak-dus, grosir", features: on(["cost", "barcode", "units", "wholesale", "expiry", "track"]), categories: ["Sembako", "Minuman", "Makanan ringan", "Kebutuhan rumah", "Perawatan diri", "Rokok"] },
  retail: { name: "Toko retail (pakaian, elektronik, dll)", type: "Retail", hint: "Barcode, varian ukuran/warna, stok", features: on(["cost", "barcode", "wholesale", "mods", "track"]), categories: ["Pakaian", "Aksesoris", "Elektronik", "Lainnya"] },
  jasa: { name: "Jasa (laundry, salon, bengkel)", type: "Jasa", hint: "Daftar layanan tanpa stok", features: on(["cost"]), categories: ["Layanan", "Produk"] }
};
const LEGACY = { "F&B": "restoran", Minimarket: "minimarket", Retail: "retail", Jasa: "jasa" };

// Profile key for a tenant: the saved one, or the closest match for accounts made before profiles existed.
export const profileOf = (settings, type) => (settings && PROFILES[settings.biz] ? settings.biz : LEGACY[type] || "restoran");
export function featuresOf(settings, type) {
  return { ...PROFILES[profileOf(settings, type)].features, ...((settings && settings.features) || {}) };
}
