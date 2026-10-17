// Android app only (Capacitor): status bar colours and splash screen. The back button is handled in app.js.
const P = window.Capacitor.Plugins;

// Status bar takes the header colour of the current theme (light or dark).
function syncStatusBar() {
  if (!P.StatusBar) return;
  const hex = (getComputedStyle(document.documentElement).getPropertyValue("--surface") || "#FFFFFF").trim();
  const n = parseInt(hex.slice(1, 7), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const dark = (0.299 * r + 0.587 * g + 0.114 * b) < 128;
  P.StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
  P.StatusBar.setBackgroundColor({ color: hex }).catch(() => {});
  P.StatusBar.setStyle({ style: dark ? "DARK" : "LIGHT" }).catch(() => {});
}
new MutationObserver(syncStatusBar).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
if (window.matchMedia) matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => setTimeout(syncStatusBar, 50));

// Hide the splash first: it resets the status bar when it closes. Re-apply a few times during a cold start
// (the system may still be settling) and whenever the app returns to the foreground.
Promise.resolve(P.SplashScreen && P.SplashScreen.hide()).catch(() => {}).then(() => [300, 1200, 3000].forEach(ms => setTimeout(syncStatusBar, ms)));
if (P.App) P.App.addListener("resume", () => setTimeout(syncStatusBar, 200));
