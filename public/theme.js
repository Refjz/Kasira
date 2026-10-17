// Light/dark theme: "auto" follows the device, "light"/"dark" force a theme. Saved per device.
(function () {
  var KEY = "kasira-theme";
  function get() { try { return localStorage.getItem(KEY) || "auto"; } catch (e) { return "auto"; } }
  function apply(v) {
    var r = document.documentElement;
    if (v === "light" || v === "dark") r.setAttribute("data-theme", v); else r.removeAttribute("data-theme");
    var dark = v === "dark" || (v !== "light" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", dark ? "#0E1412" : "#0C7A62");
  }
  window.kasiraTheme = {
    get: get,
    set: function (v) { try { localStorage.setItem(KEY, v); } catch (e) {} apply(v); },
    next: function () { var order = ["auto", "light", "dark"]; var v = order[(order.indexOf(get()) + 1) % 3]; this.set(v); return v; },
    label: function (v) { return { auto: "Otomatis", light: "Terang", dark: "Gelap" }[v || get()]; },
    icon: function (v) { return { auto: "◐", light: "☀", dark: "☾" }[v || get()]; }
  };
  apply(get());
  if (window.matchMedia) matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { apply(get()); });
})();
