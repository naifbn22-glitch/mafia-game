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
