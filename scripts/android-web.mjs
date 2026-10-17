// Copies the app screens into android-web/, the folder Capacitor bundles into the APK,
// so the Android app opens from local files instead of loading the website.
import { cpSync, rmSync, writeFileSync } from "node:fs";

const out = new URL("../android-web/", import.meta.url);
rmSync(out, { recursive: true, force: true });
cpSync(new URL("../public/app/", import.meta.url), new URL("app/", out), { recursive: true });
cpSync(new URL("../public/theme.js", import.meta.url), new URL("theme.js", out));
rmSync(new URL("app/sw.js", out), { force: true });
writeFileSync(new URL("index.html", out), '<!doctype html><meta charset="utf-8"><script>location.replace("app/index.html")</script>\n');
console.log("android-web siap");
