import "./styles/variables.css";
import "./styles/global.css";
import "./styles/home.css";
import "./styles/toast.css";
import "./styles/role-card.css";
import "./styles/online.css";
import "./styles/native-app.css";
import "./styles/splash.css";

import { installGlobalSoundButton } from "./js/audio/audioManager.js";
import "./js/app.js";

function installStartupSplash() {
  const splash = document.createElement("div");
  splash.className = "mafia-startup-splash";
  splash.innerHTML = `
    <div class="mafia-startup-splash__logo" aria-label="جاري تحميل مافيا">
      <img class="mafia-startup-splash__logo-mono" src="/mafia-logo-v2.png?v=20261001b" alt="" />
      <div class="mafia-startup-splash__logo-color-wrap">
        <img class="mafia-startup-splash__logo-color" src="/mafia-logo-v2.png?v=20261001b" alt="Mafia" />
      </div>
    </div>
    <div class="mafia-startup-splash__loading" aria-hidden="true"><i></i></div>
    <p class="mafia-startup-splash__status">جاري تجهيز اللعبة...</p>
  `;
  document.body.appendChild(splash);

  const startedAt = performance.now();
  const minimumVisibleMs = 2200;
  const finish = () => {
    const wait = Math.max(0, minimumVisibleMs - (performance.now() - startedAt));
    window.setTimeout(() => {
      splash.classList.add("is-ready");
      window.setTimeout(() => splash.remove(), 650);
    }, wait);
  };

  if (document.readyState === "complete") finish();
  else window.addEventListener("load", finish, { once: true });

  window.setTimeout(finish, 6500);
}

installStartupSplash();
installGlobalSoundButton();

async function initializeNativeApp() {
  try {
    const [{ Capacitor }, { StatusBar, Style }] = await Promise.all([
      import("@capacitor/core"),
      import("@capacitor/status-bar"),
    ]);

    if (!Capacitor.isNativePlatform()) {
      return;
    }

    const platform = Capacitor.getPlatform();
    document.documentElement.classList.add("native-app", `native-app--${platform}`);
    document.body.classList.add("native-app", `native-app--${platform}`);

    // Keep the web view below the iPhone status bar so top controls
    // never collide with the clock, Dynamic Island, or notification area.
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#050912" });
  } catch (error) {
    console.info("Native platform features are not active in the browser.", error);
  }
}

initializeNativeApp();
