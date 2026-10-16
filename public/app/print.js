// Receipt printing: browser print dialog, Bluetooth (BLE ESC/POS via Web Bluetooth), or the RawBT app on Android.
import { lsGet, lsSet, toast, esc } from "./core.js";

const KEY = "kasira-printer";
export const printerPrefs = () => ({ mode: "browser", paper: 58, auto: false, ...lsGet(KEY, {}) });
export const savePrinterPrefs = p => lsSet(KEY, { ...printerPrefs(), ...p });
export const widthFor = paper => +paper === 80 ? 48 : 32;
export const hasWebBluetooth = () => !!(navigator.bluetooth && navigator.bluetooth.requestDevice);

// ESC/POS bytes for plain text. Non-ASCII characters are replaced so cheap printers do not print garbage.
function escpos(text, { cut = true } = {}) {
  const enc = [];
  const push = (...b) => enc.push(...b);
  push(0x1b, 0x40); // init
  const clean = text.replace(/[‐-―−]/g, "-").replace(/[·•]/g, "-").normalize("NFKD").replace(/[^\x0A\x20-\x7E]/g, "");
  for (const ch of clean) push(ch.charCodeAt(0));
  push(0x0a, 0x0a, 0x0a);
  if (cut) push(0x1d, 0x56, 0x42, 0x00);
  return new Uint8Array(enc);
}

let bt = null; // { device, characteristic }
const PRINTER_SERVICES = ["000018f0-0000-1000-8000-00805f9b34fb", "e7810a71-73ae-499d-8c15-faa9aef0c3f2", "49535343-fe7d-4ae5-8fa9-9fafd205e455", "0000ff00-0000-1000-8000-00805f9b34fb", "0000fee7-0000-1000-8000-00805f9b34fb"];
async function btConnect(force) {
  if (bt && bt.device.gatt.connected && !force) return bt;
  const device = bt && !force ? bt.device : await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: PRINTER_SERVICES });
  const server = await device.gatt.connect();
  for (const svc of await server.getPrimaryServices()) {
    for (const ch of await svc.getCharacteristics()) {
      if (ch.properties.write || ch.properties.writeWithoutResponse) { bt = { device, characteristic: ch }; savePrinterPrefs({ btName: device.name || "Printer" }); return bt; }
    }
  }
  throw new Error("Printer tidak punya jalur tulis. Coba mode RawBT.");
}
async function btWrite(bytes) {
  const { characteristic: ch } = await btConnect();
  for (let i = 0; i < bytes.length; i += 180) {
    const part = bytes.slice(i, i + 180);
    if (ch.properties.writeWithoutResponse && ch.writeValueWithoutResponse) await ch.writeValueWithoutResponse(part); else await ch.writeValue(part);
  }
}
export async function pairBluetooth() { await btConnect(true); toast("Printer " + (bt.device.name || "") + " tersambung"); }

function rawbt(bytes) {
  let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
  location.href = "rawbt:base64," + btoa(bin);
}

function browserPrint(text, paper) {
  const f = document.createElement("iframe");
  f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(f);
  const w = +paper === 80 ? "80mm" : "58mm";
  f.contentDocument.write(`<!doctype html><html><head><meta charset="utf-8"><title>Struk</title><style>@page{size:${w} auto;margin:3mm}body{margin:0;font:12px/1.35 "Courier New",monospace;width:${w};white-space:pre-wrap;color:#000}</style></head><body>${esc(text)}</body></html>`);
  f.contentDocument.close();
  setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 2000); }, 250);
}

export async function printText(text, opts = {}) {
  const p = printerPrefs();
  try {
    if (p.mode === "bluetooth") { if (!hasWebBluetooth()) throw new Error("Browser ini tidak mendukung Bluetooth. Pakai Chrome atau mode RawBT."); await btWrite(escpos(text, opts)); toast("Struk dicetak"); }
    else if (p.mode === "rawbt") rawbt(escpos(text, opts));
    else browserPrint(text, p.paper);
  } catch (e) { toast(e.message || "Gagal mencetak"); }
}
