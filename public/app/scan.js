// Camera barcode scanning: native BarcodeDetector when available, otherwise ZXing (vendored, loaded on demand).
let stream = null, timer = null, zx = null, last = { code: "", at: 0 };

function loadScript(src) {
  return new Promise((ok, bad) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => bad(new Error("Gagal memuat pemindai")); document.head.appendChild(s); });
}

export async function startScanner(video, onCode) {
  stopScanner();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("Kamera tidak tersedia di perangkat ini");
  const emit = code => { const now = Date.now(); if (code === last.code && now - last.at < 1500) return; last = { code, at: now }; if (navigator.vibrate) navigator.vibrate(60); onCode(code); };
  let native = null;
  if ("BarcodeDetector" in window) {
    try { const formats = await window.BarcodeDetector.getSupportedFormats(); if (formats.length) native = new window.BarcodeDetector({ formats: formats.filter(f => /ean|upc|code|itf|qr|codabar/.test(f)) }); } catch (e) {}
  }
  if (native) {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    video.srcObject = stream; await video.play();
    const tick = async () => {
      if (!stream) return;
      try { const r = await native.detect(video); if (r && r[0]) emit(r[0].rawValue); } catch (e) {}
      timer = setTimeout(tick, 180);
    };
    tick();
    return;
  }
  if (!window.ZXing) await loadScript("vendor/zxing.min.js");
  zx = new window.ZXing.BrowserMultiFormatReader();
  await zx.decodeFromConstraints({ video: { facingMode: "environment" } }, video, res => { if (res) emit(res.getText()); });
}

export function stopScanner() {
  if (timer) clearTimeout(timer); timer = null;
  if (zx) { try { zx.reset(); } catch (e) {} zx = null; }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
}
