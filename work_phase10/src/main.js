
// منع Service Worker من عرض نسخة قديمة أثناء التطوير المحلي.
if (import.meta.env.DEV && "serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));

    if ("caches" in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
    }
  });
}

import "./styles/variables.css";
import "./styles/global.css";
import "./styles/home.css";
import "./styles/toast.css";
import "./styles/role-card.css";
import "./styles/online.css";

import "./js/app.js";
async function initializeNativeApp() {
  try {
    const [{ Capacitor }, { StatusBar, Style }] = await Promise.all([
      import("@capacitor/core"),
      import("@capacitor/status-bar"),
    ]);

    if (!Capacitor.isNativePlatform()) {
      return;
    }

    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#050912" });
  } catch (error) {
    console.info("Native platform features are not active in the browser.", error);
  }
}

initializeNativeApp();
