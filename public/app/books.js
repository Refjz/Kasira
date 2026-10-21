// Bookkeeping rules shared by the browser and the API: expense categories and the UMKM final income tax
// (PPh final 0,5% of gross turnover, PP 55/2022). Individuals pay nothing on the first Rp500 juta of turnover
// in a calendar year; companies (CV, PT, koperasi) pay from the first rupiah.

export const EXPENSE_CATS = ["Gaji & upah", "Sewa tempat", "Listrik & air", "Gas & bahan bakar", "Internet & pulsa", "Transportasi & kirim", "Perawatan & perbaikan", "Pemasaran & promosi", "Belanja di luar stok", "Pajak & retribusi", "Lainnya"];
export const TAX_MODES = {
  op: ["Orang pribadi", "Bebas pajak untuk omzet Rp500 juta pertama setiap tahun."],
  badan: ["Badan usaha (CV, PT, koperasi)", "Kena 0,5% dari omzet pertama."],
  off: ["Tidak dihitung", "Sembunyikan perkiraan pajak."]
};
export const TAX_RATE = 0.005;
export const TAX_FREE = 500000000;
export const taxMode = s => (s && s.books && TAX_MODES[s.books.taxMode] ? s.books.taxMode : "op");

// months: gross turnover per month (index 0 = January). Returns the taxable part and tax per month.
export function umkmTax(months, mode) {
  let cum = 0;
  return months.map(bruto => {
    const before = cum; cum += Math.max(0, +bruto || 0);
    const taxable = mode === "off" ? 0 : mode === "badan" ? Math.max(0, +bruto || 0) : Math.max(0, cum - TAX_FREE) - Math.max(0, before - TAX_FREE);
    return { bruto: Math.max(0, +bruto || 0), cum, taxable, tax: Math.round(taxable * TAX_RATE) };
  });
}
