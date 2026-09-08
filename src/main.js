import "./styles/variables.css";
import "./styles/global.css";
import "./styles/home.css";
import "./styles/toast.css";
import "./styles/role-card.css";
import "./styles/online.css";
import "./styles/native-app.css";

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

    const platform = Capacitor.getPlatform();
    document.documentElement.classList.add("native-app", `native-app--${platform}`);
    document.body.classList.add("native-app", `native-app--${platform}`);

    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#050912" });
  } catch (error) {
    console.info("Native platform features are not active in the browser.", error);
  }
}
function showSplashScreen() {
  const splash = document.createElement("div");
  splash.id = "mafia-splash";
  splash.innerHTML = `
    <div class="mafia-splash-content">
      <img src="/mafia-logo.png" alt="Mafia Logo" class="mafia-splash-logo">
      <h1>Mafia</h1>
    </div>
  `;

  document.body.appendChild(splash);

  setTimeout(() => {
    splash.classList.add("hide");
    setTimeout(() => splash.remove(), 500);
  }, 1800);
}
function showFirstRunRules() {
  const rulesSeen = localStorage.getItem("mafia_rules_seen");

  if (rulesSeen === "1") {
    return;
  }

  const overlay = document.createElement("div");
  overlay.id = "mafia-rules-overlay";

  overlay.innerHTML = `
    <div class="mafia-rules-sheet">
      <div class="mafia-rules-handle"></div>

      <h2>قوانين لعبة Mafia</h2>
      <p class="mafia-rules-subtitle">
        اقرأ القواعد قبل بدء اللعب
      </p>

      <div class="mafia-rules-scroll">
        <h3>1. هدف اللعبة</h3>
        <p>
          تنقسم اللعبة إلى فريق المافيا وفريق المواطنين.
          يحاول فريق المافيا التخلص من بقية اللاعبين، بينما يحاول المواطنون كشف أعضاء المافيا وإخراجهم.
        </p>

        <h3>2. الأدوار سرية</h3>
        <p>
          يجب على كل لاعب الاحتفاظ بدوره لنفسه وعدم إظهاره لبقية اللاعبين إلا عندما تطلب اللعبة ذلك.
        </p>

        <h3>3. مرحلة الليل</h3>
        <p>
          أثناء الليل ينفذ كل دور مهمته حسب التعليمات الظاهرة في التطبيق.
          يجب عدم النظر إلى شاشة لاعب آخر أو كشف القرارات.
        </p>

        <h3>4. مرحلة النهار</h3>
        <p>
          يناقش اللاعبون ما حدث ويحاولون معرفة أعضاء المافيا.
          بعد النقاش يتم التصويت حسب نظام الجولة.
        </p>

        <h3>5. التصويت</h3>
        <p>
          يلتزم كل لاعب بنتيجة التصويت المسجلة داخل اللعبة.
          اللاعب الذي يتم إخراجه لا يشارك في قرارات الجولات التالية.
        </p>

        <h3>6. اللعب النزيه</h3>
        <p>
          يمنع كشف الأدوار سرًا أو مشاركة معلومات من شاشة لاعب آخر أو تعطيل سير الجولة.
        </p>

        <h3>7. الفوز</h3>
        <p>
          يفوز المواطنون عند التخلص من جميع أعضاء المافيا.
          وتفوز المافيا عندما تصبح قادرة على السيطرة على عدد اللاعبين المتبقين.
        </p>
      </div>

      <div class="mafia-rules-actions">
        <button id="mafia-rules-skip" type="button">تخطي</button>
        <button id="mafia-rules-start" type="button">دخول اللعبة</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.classList.add("mafia-rules-open");

  function closeRules() {
    localStorage.setItem("mafia_rules_seen", "1");
    overlay.classList.add("hide");

    setTimeout(() => {
      overlay.remove();
      document.body.classList.remove("mafia-rules-open");
    }, 350);
  }

  document
    .getElementById("mafia-rules-skip")
    .addEventListener("click", closeRules);

  document
    .getElementById("mafia-rules-start")
    .addEventListener("click", closeRules);
}
showSplashScreen();
initializeNativeApp();

setTimeout(() => {
  showFirstRunRules();
}, 2300);
