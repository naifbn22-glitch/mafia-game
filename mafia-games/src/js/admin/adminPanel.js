import "../../styles/admin-panel.css";

let adminOverlay = null;
let previouslyFocusedElement = null;

/**
 * تحويل أي قيمة إلى نص آمن للعرض داخل HTML.
 */
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * إغلاق لوحة الإدارة.
 *
 * هذه الدالة لا تعدّل gameState ولا تؤثر على مراحل اللعبة.
 */
export function closeAdminPanel() {
  if (!adminOverlay) {
    return;
  }

  document.removeEventListener("keydown", handleAdminKeyboard);

  adminOverlay.remove();
  adminOverlay = null;

  if (
    previouslyFocusedElement &&
    typeof previouslyFocusedElement.focus === "function"
  ) {
    previouslyFocusedElement.focus();
  }

  previouslyFocusedElement = null;
}

/**
 * إغلاق اللوحة عند الضغط على زر Escape.
 */
function handleAdminKeyboard(event) {
  if (event.key === "Escape") {
    closeAdminPanel();
  }
}

/**
 * فتح لوحة الإدارة للعرض فقط.
 *
 * لا تستقبل gameState نفسه، بل تستقبل نسخة بسيطة من المعلومات.
 *
 * @param {Object} snapshot
 * @param {string} snapshot.phaseLabel
 * @param {number|string} snapshot.round
 * @param {number|string} snapshot.totalPlayers
 * @param {number|string} snapshot.alivePlayers
 * @param {number|string} snapshot.eliminatedPlayers
 */
export function openAdminPanel(snapshot = {}) {
  closeAdminPanel();

  previouslyFocusedElement = document.activeElement;

  const {
    phaseLabel = "غير محددة",
    round = 1,
    totalPlayers = 0,
    alivePlayers = 0,
    eliminatedPlayers = 0,
  } = snapshot;

  adminOverlay = document.createElement("div");
  adminOverlay.className = "mafia-admin-overlay";
  adminOverlay.setAttribute("role", "dialog");
  adminOverlay.setAttribute("aria-modal", "true");
  adminOverlay.setAttribute("aria-labelledby", "mafia-admin-title");

  adminOverlay.innerHTML = `
    <section class="mafia-admin-panel">
      <header class="mafia-admin-header">
        <div>
          <span class="mafia-admin-badge">وضع المشرف</span>

          <h2
            id="mafia-admin-title"
            class="mafia-admin-title"
          >
            لوحة الإدارة
          </h2>

          <p class="mafia-admin-subtitle">
            عرض معلومات المباراة فقط
          </p>
        </div>

        <button
          type="button"
          class="mafia-admin-close-icon"
          data-admin-close
          aria-label="إغلاق لوحة الإدارة"
        >
          ×
        </button>
      </header>

      <div class="mafia-admin-content">
        <article class="mafia-admin-info-card mafia-admin-info-card--wide">
          <span class="mafia-admin-info-label">
            المرحلة الحالية
          </span>

          <strong class="mafia-admin-info-value">
            ${escapeHtml(phaseLabel)}
          </strong>
        </article>

        <article class="mafia-admin-info-card">
          <span class="mafia-admin-info-label">
            الجولة الحالية
          </span>

          <strong class="mafia-admin-info-value">
            ${escapeHtml(round)}
          </strong>
        </article>

        <article class="mafia-admin-info-card">
          <span class="mafia-admin-info-label">
            جميع اللاعبين
          </span>

          <strong class="mafia-admin-info-value">
            ${escapeHtml(totalPlayers)}
          </strong>
        </article>

        <article class="mafia-admin-info-card mafia-admin-info-card--alive">
          <span class="mafia-admin-info-label">
            اللاعبون الأحياء
          </span>

          <strong class="mafia-admin-info-value">
            ${escapeHtml(alivePlayers)}
          </strong>
        </article>

        <article class="mafia-admin-info-card mafia-admin-info-card--eliminated">
          <span class="mafia-admin-info-label">
            اللاعبون الخارجون
          </span>

          <strong class="mafia-admin-info-value">
            ${escapeHtml(eliminatedPlayers)}
          </strong>
        </article>
      </div>

      <footer class="mafia-admin-footer">
        <p class="mafia-admin-readonly-note">
          لا توجد أي صلاحيات لتعديل المباراة في هذه النسخة.
        </p>

        <button
          type="button"
          class="mafia-admin-close-button"
          data-admin-close
        >
          إغلاق
        </button>
      </footer>
    </section>
  `;

  document.body.appendChild(adminOverlay);

  const closeButtons =
    adminOverlay.querySelectorAll("[data-admin-close]");

  closeButtons.forEach((button) => {
    button.addEventListener("click", closeAdminPanel);
  });

  adminOverlay.addEventListener("click", (event) => {
    if (event.target === adminOverlay) {
      closeAdminPanel();
    }
  });

  document.addEventListener("keydown", handleAdminKeyboard);

  const primaryCloseButton = adminOverlay.querySelector(
    ".mafia-admin-close-button",
  );

  primaryCloseButton?.focus();
}

/**
 * معرفة هل لوحة الإدارة مفتوحة حاليًا.
 */
export function isAdminPanelOpen() {
  return Boolean(adminOverlay);
}