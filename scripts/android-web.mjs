// Copies the app screens into android-web/, the folder Capacitor bundles into the APK,
// so the Android app opens from local files instead of loading the website.
import { cpSync, rmSync, writeFileSync, readFileSync } from "node:fs";

const out = new URL("../android-web/", import.meta.url);
rmSync(out, { recursive: true, force: true });
cpSync(new URL("../public/app/", import.meta.url), new URL("app/", out), { recursive: true });
cpSync(new URL("../public/theme.js", import.meta.url), new URL("theme.js", out));
rmSync(new URL("app/sw.js", out), { force: true });
writeFileSync(new URL("index.html", out), '<!doctype html><meta charset="utf-8"><script>location.replace("app/index.html")</script>\n');
// Test builds: KASIRA_API=https://uji.kasira-c70.pages.dev points the app at the preview server and test database.
if (process.env.KASIRA_API) {
  const idx = new URL("app/index.html", out), tag = '<script src="../theme.js"></script>';
  const html = readFileSync(idx, "utf8");
  if (!html.includes(tag)) throw new Error("app/index.html: theme.js script tag not found");
  writeFileSync(idx, html.replace(tag, "<script>window.KASIRA_API=" + JSON.stringify(process.env.KASIRA_API) + ";</script>\n" + tag));
}
console.log("android-web siap" + (process.env.KASIRA_API ? ", API: " + process.env.KASIRA_API : ""));
