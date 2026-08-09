import {
  ROLE_IDS,
  TEAMS,
  ROLE_DEFINITIONS,
  getRoleDetails,
} from "./roles/roles.js";

import {
  calculateMatchSummary,
} from "./stats/matchSummary.js";

import {
  renderMatchDetailsPage,
} from "./stats/matchDetailsRenderer.js";

import {
  openAdminPanel,
} from "./admin/adminPanel.js";

import {
  recordPlayerVote,
} from "./stats/statsSystem.js";

import {
  calculateMatchResults,
} from "./stats/matchResults.js";

import {
  renderMatchResults,
} from "./stats/resultsRenderer.js";

import {
  syncPlayersWithProfiles,
} from "./stats/playerProfiles.js";

import {
  addTimelineEvent,
  startMatchTimeline,
  endMatchTimeline,
} from "./stats/matchTimeline.js";

import {
  gameState,
  resetGameState,
} from "./game/gameState.js";

import {
  showSuccessToast,
  showErrorToast,
  showWarningToast,
  showInfoToast,
} from "./ui/toast.js";

import {
  getRoleCardImage,
} from "./ui/roleCards.js";

import {
  openOnlinePortal,
  restoreOnlineRoute,
} from "./online/onlineGame.js";

const DEFAULT_AVATARS = [
  {
    id: "avatar-01",
    name: "الشخصية 1",
    src: "/avatars/avatar-01.png",
  },
  {
    id: "avatar-02",
    name: "الشخصية 2",
    src: "/avatars/avatar-02.png",
  },
  {
    id: "avatar-03",
    name: "الشخصية 3",
    src: "/avatars/avatar-03.png",
  },
  {
    id: "avatar-04",
    name: "الشخصية 4",
    src: "/avatars/avatar-04.png",
  },
  {
    id: "avatar-05",
    name: "الشخصية 5",
    src: "/avatars/avatar-05.png",
  },
  {
    id: "avatar-06",
    name: "الشخصية 6",
    src: "/avatars/avatar-06.png",
  },
  {
    id: "avatar-07",
    name: "الشخصية 7",
    src: "/avatars/avatar-07.png",
  },
  {
    id: "avatar-08",
    name: "الشخصية 8",
    src: "/avatars/avatar-08.png",
  },
  {
    id: "avatar-09",
    name: "الشخصية 9",
    src: "/avatars/avatar-09.png",
  },
  {
    id: "avatar-10",
    name: "الشخصية 10",
    src: "/avatars/avatar-10.png",
  },
  {
    id: "avatar-11",
    name: "الشخصية 11",
    src: "/avatars/avatar-11.png",
  },
  {
    id: "avatar-12",
    name: "الشخصية 12",
    src: "/avatars/avatar-12.png",
  },
];
const app = document.querySelector("#app");

if (!app) {
  throw new Error(
    "لم يتم العثور على عنصر التطبيق.",
  );
}


const GAME_PHASES = Object.freeze({
  HOME: "home",
  PLAYERS: "players",
  SETTINGS: "settings",

  ROLE_HANDOFF: "role-handoff",
  ROLE_REVEAL: "role-reveal",
  ROLES_READY: "roles-ready",

  NIGHT_INTRO: "night-intro",

  THIEF_HANDOFF: "thief-handoff",
  THIEF_SELECTION: "thief-selection",

  NURSE_HANDOFF: "nurse-handoff",
  NURSE_SELECTION: "nurse-selection",

  KING_HANDOFF: "king-handoff",
  KING_SELECTION: "king-selection",
  KING_RESULT: "king-result",

  NIGHT_RESULT: "night-result",

  DAY_DISCUSSION: "day-discussion",

  VOTING_PREPARATION:
    "voting-preparation",

  VOTING_HANDOFF: "voting-handoff",
  VOTING_SELECTION: "voting-selection",
  VOTE_SAVED: "vote-saved",
  VOTING_RESULT: "voting-result",

  GAME_OVER: "game-over",
});


const NIGHT_ROLE_PHASES = Object.freeze({
  [ROLE_IDS.THIEF]:
    GAME_PHASES.THIEF_HANDOFF,

  [ROLE_IDS.NURSE]:
    GAME_PHASES.NURSE_HANDOFF,

  [ROLE_IDS.KING]:
    GAME_PHASES.KING_HANDOFF,
});


function getRolesDistribution(playerCount) {
  let thieves = 0;

  if (
    playerCount >= 4 &&
    playerCount <= 6
  ) {
    thieves = 1;
  } else if (playerCount <= 10) {
    thieves = 2;
  } else if (playerCount <= 14) {
    thieves = 3;
  } else if (playerCount <= 18) {
    thieves = 4;
  } else if (playerCount <= 22) {
    thieves = 5;
  }

  const king =
    playerCount >= 4 ? 1 : 0;

  const nurse =
    playerCount >= 4 ? 1 : 0;

  const citizens = Math.max(
    playerCount -
      thieves -
      king -
      nurse,
    0,
  );

  return {
    thieves,
    king,
    nurse,
    citizens,
  };
}


function renderHomePage() {
  app.innerHTML = `
    <main class="home-page">
      <div
        class="mafia-cinematic-scene"
        aria-hidden="true"
      >
        <div class="mafia-scene-vignette"></div>
        <div class="mafia-scene-grain"></div>

        <div
          class="mafia-glow mafia-glow-purple"
        ></div>

        <div
          class="mafia-glow mafia-glow-green"
        ></div>

        <div
          class="mafia-glow mafia-glow-center"
        ></div>

        <div
          class="mafia-light-ray mafia-light-ray-left"
        ></div>

        <div
          class="mafia-light-ray mafia-light-ray-right"
        ></div>

        <div class="mafia-city-silhouette">
          <span
            class="mafia-building mafia-building-1"
          ></span>

          <span
            class="mafia-building mafia-building-2"
          ></span>

          <span
            class="mafia-building mafia-building-3"
          ></span>

          <span
            class="mafia-building mafia-building-4"
          ></span>

          <span
            class="mafia-building mafia-building-5"
          ></span>

          <span
            class="mafia-building mafia-building-6"
          ></span>

          <span
            class="mafia-building mafia-building-7"
          ></span>

          <span
            class="mafia-building mafia-building-8"
          ></span>

          <span
            class="mafia-building mafia-building-9"
          ></span>
        </div>

        <div
          class="mafia-fog mafia-fog-back"
        ></div>

        <div
          class="mafia-fog mafia-fog-middle"
        ></div>

        <div
          class="mafia-fog mafia-fog-front"
        ></div>

        <div class="mafia-particles">
          <span></span>
          <span></span>
          <span></span>
          <span></span>
          <span></span>
          <span></span>
          <span></span>
          <span></span>
          <span></span>
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>

      <header class="top-bar">
        <div class="brand">
          <img
            src="/logo.png"
            class="brand-logo-image"
            alt="شعار لعبة مافيا"
          />

          <div>
            <h1>مافيا</h1>

            <p>
              الخداع، التحليل، البقاء
            </p>
          </div>
        </div>

        <button
          class="icon-button"
          id="soundButton"
          type="button"
          aria-label="تشغيل أو إيقاف الصوت"
        >
          ${
            gameState.soundEnabled
              ? "🔊"
              : "🔇"
          }
        </button>
      </header>

      <section class="hero">
        <div class="hero-card">
          <div
            class="logo-circle logo-circle-image"
          >
            <img
              src="/logo.png"
              alt="شعار لعبة مافيا"
            />
          </div>

          <p class="eyebrow">
            لعبة جماعية
          </p>

          <h2>
            مــــافــــيــــا
          </h2>

          <p class="hero-description">
            اكتشف اللصوص قبل أن يسيطروا
            على المدينة. ناقش، صوّت،
            وراقب كل حركة.
          </p>

          ${
            hasSavedGame()
              ? `
                <div class="saved-game-panel">
                  <div>
                    <strong>
                      توجد لعبة محفوظة
                    </strong>

                    <span>
                      الجولة
                      ${gameState.roundNumber}
                    </span>
                  </div>

                  <div class="saved-game-actions">
                    <button
                      id="resumeGameButton"
                      type="button"
                    >
                      استكمال اللعبة
                    </button>

                    <button
                      id="deleteSavedGameButton"
                      type="button"
                    >
                      حذف
                    </button>
                  </div>
                </div>
              `
              : ""
          }

          <div class="game-actions">
            <button
              class="game-button offline-button"
              id="offlineButton"
              type="button"
            >
              <span class="button-icon">
                📱
              </span>

              <span class="button-content">
                <strong>
                  اللعب بدون إنترنت
                </strong>

                <small>
                  استخدموا جهازًا واحدًا
                </small>
              </span>

              <span class="button-arrow">
                ←
              </span>
            </button>

            <button
              class="game-button online-button"
              id="onlineButton"
              type="button"
            >
              <span class="button-icon">
                🌐
              </span>

              <span class="button-content">
                <strong>
                  اللعب عن طريق الشبكة
                </strong>

                <small>
                  إنشاء غرفة أو الانضمام إليها
                </small>
              </span>

              <span class="button-arrow">
                ←
              </span>
            </button>
          </div>

          <p
            class="status-message"
            id="statusMessage"
          ></p>
        </div>
      </section>

      <section
        class="game-rules-section game-rules-neon-section"
        id="gameRulesSection"
        aria-labelledby="gameRulesTitle"
      >
        <div class="rules-neon-orb rules-neon-orb--purple"></div>
        <div class="rules-neon-orb rules-neon-orb--green"></div>

        <header class="rules-neon-header">
          <div class="rules-neon-emblem rules-neon-emblem--purple" aria-hidden="true">🗡️</div>

          <div class="rules-neon-title-wrap">
            <h2 id="gameRulesTitle">قوانين اللعبة</h2>
            <div class="rules-neon-title-line" aria-hidden="true"></div>
            <p>
              <span>✦</span>
              افهم القواعد جيدًا، وكن الأذكى لتقود فريقك إلى الفوز
              <span>✦</span>
            </p>
          </div>

          <div class="rules-neon-emblem rules-neon-emblem--green" aria-hidden="true">🏆</div>
        </header>

        <article class="rules-neon-idea-card">
          <div class="rules-neon-city" aria-hidden="true">
            <div class="rules-neon-city-glow"></div>
            <span>🌃</span>
          </div>

          <div class="rules-neon-idea-copy">
            <h3>فكرة اللعبة <span>✦</span></h3>
            <div class="rules-neon-idea-inner">
              <div class="rules-neon-idea-icon">👥</div>
              <p>
                تنقسم اللعبة إلى فريقين: اللصوص والمواطنون.<br />
                كل فريق يسعى لتحقيق هدفه وإقصاء الفريق الآخر.<br />
                اللعبة تعتمد على الذكاء، الملاحظة، والاستراتيجية.
              </p>
            </div>
          </div>
        </article>

        <div class="rules-neon-divider">
          <span></span>
          <h3>أدوار اللعبة</h3>
          <b>✦</b>
          <span></span>
        </div>

        <div class="rules-role-grid">
          <article class="rules-role-card rules-role-card--thief">
            <div class="rules-role-icon">🗡️</div>
            <h4>اللصوص</h4>
            <p>يستيقظون كل ليلة ويختارون شخصًا واحدًا لإخراجه من اللعبة.</p>
            <p>هدفهم أن يصبح عددهم مساويًا لعدد المواطنين الأحياء.</p>
          </article>

          <article class="rules-role-card rules-role-card--nurse">
            <div class="rules-role-icon">🏥</div>
            <h4>الممرض / الممرضة</h4>
            <p>يختار شخصًا واحدًا كل ليلة لحمايته من هجوم اللصوص.</p>
            <p>يستطيع حماية نفسه، ولا يكرر حماية الشخص نفسه في ليلتين متتاليتين.</p>
          </article>

          <article class="rules-role-card rules-role-card--investigator">
            <div class="rules-role-icon">🕵️</div>
            <h4>المحقق / المحققة</h4>
            <p>يفحص لاعبًا واحدًا فقط كل ليلة لمعرفة هويته.</p>
            <p>يظهر الملك والممرض كمواطنين حفاظًا على سرية الأدوار.</p>
          </article>

          <article class="rules-role-card rules-role-card--citizen">
            <div class="rules-role-icon">🛡️</div>
            <h4>المواطنون</h4>
            <p>لا يملكون قدرات ليلية.</p>
            <p>هدفهم اكتشاف اللصوص والتصويت لإخراجهم من اللعبة.</p>
          </article>

          <article class="rules-role-card rules-role-card--king">
            <div class="rules-role-icon">👑</div>
            <h4>الملك / الملكة</h4>
            <p>يمتلك 3 أوسمة عفو ملكي طوال المباراة.</p>
            <p>يمنح وسامًا لأي لاعب باستثناء نفسه، ومن يحمل الوسام لا يخرج عند التصويت عليه.</p>
          </article>
        </div>

        <div class="rules-neon-divider">
          <span></span>
          <h3>سير اللعبة</h3>
          <b>✦</b>
          <span></span>
        </div>

        <div class="rules-flow-grid">
  <article class="rules-flow-card rules-flow-card--night">
    <div class="rules-flow-icon">
      🌙
    </div>

    <h4>
      1. الليل
    </h4>

    <p>
      تستيقظ الأدوار الخاصة وتنفذ مهامها بترتيب محدد.
    </p>
  </article>

  <article class="rules-flow-card rules-flow-card--day">
    <div class="rules-flow-icon">
      🌞
    </div>

    <h4>
      2. النهار
    </h4>

    <p>
      يستيقظ الجميع، ويناقش اللاعبون أحداث الليلة ويتبادلون الاتهامات.
    </p>
  </article>

  <article class="rules-flow-card rules-flow-card--vote">
    <div class="rules-flow-icon">
      🗳️
    </div>

    <h4>
      3. التصويت
    </h4>

    <p>
      يصوت اللاعبون لإخراج شخص واحد من اللعبة.
    </p>
  </article>

  <article class="rules-flow-card rules-flow-card--results">
    <div class="rules-flow-icon">
      📢
    </div>

    <h4>
      4. النتائج
    </h4>

    <p>
      يتم إعلان نتيجة التصويت وتطبيق العفو أو إخراج اللاعب.
    </p>
  </article>

  <article class="rules-flow-card rules-flow-card--end">
    <div class="rules-flow-icon">
      🏆
    </div>

    <h4>
      5. نهاية اللعبة
    </h4>

    <p>
      يتم التحقق من شروط الفوز، وإذا لم تنته اللعبة تبدأ ليلة جديدة.
    </p>
  </article>
</div>

        <section class="rules-important-card">
          <h3>قوانين مهمة <span>🛡️</span></h3>

          <div class="rules-important-grid">
            <div>
              <p><span>👥</span> اللص والممرض لا يختاران الشخص نفسه الذي اختير في الجولة السابقة.</p>
              <p><span>💚</span> الممرض ينقذ لاعبًا واحدًا فقط كل ليلة.</p>
              <p><span>🗳️</span> التصويت يتم بالأغلبية، وعند التعادل لا يخرج أحد.</p>
            </div>

            <div>
              <p><span>🕵️</span> المحقق يفحص لاعبًا واحدًا فقط في الجولة ولا يغير اختياره بعد التأكيد.</p>
              <p><span>👑</span> الملك يمتلك 3 أوسمة عفو، ومن يحمل الوسام لا يخرج عند التصويت عليه.</p>
              <p><span>🗡️</span> اللصوص يعرفون بعضهم في بداية اللعبة.</p>
            </div>
          </div>
        </section>

        <div class="rules-player-count-strip">
          <span>👥</span>
          <div>
            <strong>عدد اللاعبين</strong>
            <p>من 4 إلى 22 لاعبًا، ويُحدد عدد اللصوص تلقائيًا حسب عدد المشاركين.</p>
          </div>
        </div>

        <div class="rules-neon-reminder">
          <span>✦</span>
          <strong>تذكر دائمًا: ثق بحدسك... ولكن لا تثق بأحد!</strong>
          <span>✦</span>
        </div>
      </section>

      <footer class="home-footer">
        <span>
          الإصدار التجريبي 1.0
        </span>
      </footer>
    </main>
  `;

  const resumeGameButton =
    document.querySelector(
      "#resumeGameButton",
    );

  const deleteSavedGameButton =
    document.querySelector(
      "#deleteSavedGameButton",
    );

  const offlineButton =
    document.querySelector(
      "#offlineButton",
    );

  const onlineButton =
    document.querySelector(
      "#onlineButton",
    );

  const soundButton =
    document.querySelector(
      "#soundButton",
    );

  resumeGameButton?.addEventListener(
    "click",
    resumeSavedGame,
  );

  deleteSavedGameButton?.addEventListener(
    "click",
    () => {
      const confirmed = window.confirm(
        "هل تريد حذف اللعبة المحفوظة؟",
      );

      if (!confirmed) {
        return;
      }

      deleteSavedGame();
      resetCompleteGame();
      renderHomePage();
    },
  );

  offlineButton?.addEventListener(
    "click",
    () => {
      transitionTo(
        GAME_PHASES.PLAYERS,
      );
    },
  );

  onlineButton?.addEventListener(
    "click",
    () => {
      openOnlinePortal({
        app,
        onBack: () => {
          history.replaceState({}, "", location.pathname);
          renderHomePage();
        },
      });
    },
  );

  soundButton?.addEventListener(
    "click",
    () => {
      gameState.soundEnabled =
        !gameState.soundEnabled;

      soundButton.textContent =
        gameState.soundEnabled
          ? "🔊"
          : "🔇";

      saveGame();
    },
  );
}


function renderPlayersPage() {
  setCurrentScreen(
    GAME_PHASES.PLAYERS,
  );

  const roles = getRolesDistribution(
    gameState.players.length,
  );

  app.innerHTML = `
    <main class="setup-page">
      <div
        class="background-orb background-orb-purple"
      ></div>

      <div
        class="background-orb background-orb-green"
      ></div>

      <header class="setup-header">
        <button
          class="back-button"
          id="backButton"
          type="button"
        >
          →
          الرجوع
        </button>

        <div class="setup-brand">
          <img
            src="/logo.png"
            alt="شعار مافيا"
          />

          <span>
            مافيا
          </span>
        </div>
      </header>

      <section class="players-layout">
        <div class="players-panel">
          <div class="section-heading">
            <p>
              إعداد الجلسة
            </p>

            <h1>
              إضافة المشاركين
            </h1>

            <span>
              أضف أسماء اللاعبين المشاركين
              في الجلسة.
            </span>
          </div>

          <form
            class="player-form"
            id="playerForm"
          >
            <div
              class="gender-selector"
              role="radiogroup"
              aria-label="اختيار جنس اللاعب"
            >
              <label class="gender-option">
                <input
                  type="radio"
                  name="playerGender"
                  value="male"
                  checked
                />

                <span>
                  👨 ذكر
                </span>
              </label>

              <label class="gender-option">
                <input
                  type="radio"
                  name="playerGender"
                  value="female"
                />

                <span>
                  👩 أنثى
                </span>
              </label>
            </div>

            <input
              id="playerNameInput"
              type="text"
              maxlength="24"
              autocomplete="off"
              placeholder="اكتب اسم اللاعب"
            />
<div class="avatar-picker">
  <div class="avatar-picker-header">
    <div class="avatar-picker-title">
      <span class="avatar-picker-title-icon">
        🎭
      </span>

      <div>
        <strong>
          اختر شخصيتك
        </strong>

        <span>
          اختيار الشخصية اختياري
        </span>
      </div>
    </div>

    <span class="avatar-picker-count">
      ${DEFAULT_AVATARS.length}
      شخصية
    </span>
  </div>

  <div
    class="avatar-options"
    id="avatarOptions"
    role="radiogroup"
    aria-label="اختيار الشخصية الافتراضية"
  >
    <label
      class="avatar-option avatar-option-none"
      title="اللعب بدون شخصية"
    >
      <input
        type="radio"
        name="playerAvatar"
        value=""
        checked
      />

      <span class="avatar-option-image avatar-none-image">
        <span class="avatar-none-icon">
          👤
        </span>
      </span>

      <span class="avatar-option-name">
        بدون شخصية
      </span>

      <span class="avatar-selected-check">
        ✓
      </span>
    </label>

    ${DEFAULT_AVATARS
      .map(
        (avatar) => `
          <label
            class="avatar-option"
            title="${avatar.name}"
          >
            <input
              type="radio"
              name="playerAvatar"
              value="${avatar.src}"
            />

            <span class="avatar-option-image">
              <img
                src="${avatar.src}"
                alt="${avatar.name}"
                loading="lazy"
              />
            </span>

            <span class="avatar-option-name">
              ${avatar.name}
            </span>

            <span class="avatar-selected-check">
              ✓
            </span>
          </label>
        `,
      )
      .join("")}
  </div>

  <div class="avatar-picker-footer">
    <span class="avatar-picker-footer-icon">
      ✦
    </span>

    <span>
      اضغط على الشخصية التي تريد استخدامها.
      يمكنك اللعب دون اختيار شخصية.
    </span>
  </div>
</div>
            <button type="submit">
              إضافة اللاعب
            </button>
          </form>

          <p
            class="form-message"
            id="formMessage"
          ></p>

          <div class="players-counter">
            <span>
              عدد المشاركين
            </span>

            <strong>
              ${gameState.players.length}
              من 22
            </strong>
          </div>

          <div
            class="players-list"
            id="playersList"
          >
            ${renderPlayersList()}
          </div>
        </div>

        <aside class="roles-panel">
          <div class="roles-heading">
            <p>
              التوزيع التلقائي
            </p>

            <h2>
              شخصيات اللعبة
            </h2>
          </div>

          <div class="roles-grid">
            ${renderRoleCard(
              "🗡️",
              "اللصوص",
              roles.thieves,
            )}

            ${renderRoleCard(
              "👑",
              "الملك",
              roles.king,
            )}

            ${renderRoleCard(
              "🏥",
              "الممرضة",
              roles.nurse,
            )}

            ${renderRoleCard(
              "👥",
              "المواطنون",
              roles.citizens,
            )}
          </div>

          <p class="roles-note">
            يتم تحديد عدد اللصوص تلقائيًا
            حسب عدد المشاركين.
          </p>

          <button
            class="continue-button"
            id="continueButton"
            type="button"
            ${
              gameState.players.length < 4
                ? "disabled"
                : ""
            }
          >
            متابعة إلى الإعدادات
          </button>

          <p class="minimum-note">
            الحد الأدنى لبدء اللعبة
            هو 4 مشاركين.
          </p>
        </aside>
      </section>
    </main>
  `;

  bindPlayersPageEvents();
}


function renderPlayersList() {
  if (gameState.players.length === 0) {
    return `
      <div class="empty-players">
        <span>
          👤
        </span>

        <p>
          لم تتم إضافة أي لاعب حتى الآن.
        </p>
      </div>
    `;
  }

  return gameState.players
    .map((player, index) => {
      const playerName =
        typeof player === "string"
          ? player
          : player.name;

      const playerGender =
        typeof player === "string"
          ? "male"
          : player.gender ?? "male";

      const genderLabel =
        playerGender === "female"
          ? "أنثى"
          : "ذكر";

      const genderIcon =
        playerGender === "female"
          ? "👩"
          : "👨";

      return `
        <div class="player-item">
          <div class="player-information">
            <span class="player-number">
              ${index + 1}
            </span>

            <div
              class="player-name-and-gender"
            >
              <strong>
                ${escapeHtml(playerName)}
              </strong>

              <small>
                ${genderIcon}
                ${genderLabel}
              </small>
            </div>
          </div>

          <button
            class="delete-player-button"
            type="button"
            data-player-index="${index}"
            aria-label="حذف ${escapeHtml(
              playerName,
            )}"
          >
            حذف
          </button>
        </div>
      `;
    })
    .join("");
}


function renderRoleCard(
  icon,
  title,
  count,
) {
  return `
    <article class="role-summary-card">
      <span class="role-summary-icon">
        ${icon}
      </span>

      <div>
        <p>
          ${title}
        </p>

        <strong>
          ${count}
        </strong>
      </div>
    </article>
  `;
}

function processPlayerAvatar(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve(null);
      return;
    }

    if (!file.type.startsWith("image/")) {
      reject(
        new Error("الملف المختار ليس صورة."),
      );
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const image = new Image();

      image.onload = () => {
        const size = 320;
        const canvas =
          document.createElement("canvas");

        const context =
          canvas.getContext("2d");

        canvas.width = size;
        canvas.height = size;

        const cropSize = Math.min(
          image.width,
          image.height,
        );

        const sourceX =
          (image.width - cropSize) / 2;

        const sourceY =
          (image.height - cropSize) / 2;

        context.drawImage(
          image,
          sourceX,
          sourceY,
          cropSize,
          cropSize,
          0,
          0,
          size,
          size,
        );

        resolve(
          canvas.toDataURL(
            "image/jpeg",
            0.8,
          ),
        );
      };

      image.onerror = () => {
        reject(
          new Error(
            "تعذر قراءة الصورة المختارة.",
          ),
        );
      };

      image.src = reader.result;
    };

    reader.onerror = () => {
      reject(
        new Error(
          "حدث خطأ أثناء تحميل الصورة.",
        ),
      );
    };

    reader.readAsDataURL(file);
  });
}
function bindPlayersPageEvents() {
  const backButton =
    document.querySelector(
      "#backButton",
    );

  const playerForm =
    document.querySelector(
      "#playerForm",
    );

  const playerNameInput =
    document.querySelector(
      "#playerNameInput",
    );

  const genderInputs =
    document.querySelectorAll(
      'input[name="playerGender"]',
    );
  const avatarOptions =
  document.querySelector(
    "#avatarOptions",
  );
  const formMessage =
    document.querySelector(
      "#formMessage",
    );

  const continueButton =
    document.querySelector(
      "#continueButton",
    );

  const deleteButtons =
    document.querySelectorAll(
      ".delete-player-button",
    );

  backButton?.addEventListener(
    "click",
    () => {
      transitionTo(
        GAME_PHASES.HOME,
      );
    },
  );

  playerForm?.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();

      const playerName =
        playerNameInput.value.trim();

      const selectedGender =
        [...genderInputs].find(
          (input) => input.checked,
        )?.value ?? "male";

       const selectedAvatar =
  document.querySelector(
    'input[name="playerAvatar"]:checked',
  )?.value ?? "";

      if (!playerName) {
        formMessage.textContent =
          "اكتب اسم اللاعب أولًا.";

        return;
      }

      if (
        gameState.players.length >= 22
      ) {
        formMessage.textContent =
          "وصلت إلى الحد الأعلى، وهو 22 لاعبًا.";

        return;
      }

      const nameAlreadyExists =
        gameState.players.some(
          (player) => {
            const existingName =
              typeof player === "string"
                ? player
                : player.name;

            return (
              existingName
                .trim()
                .toLocaleLowerCase("ar") ===
              playerName
                .toLocaleLowerCase("ar")
            );
          },
        );

      if (nameAlreadyExists) {
        formMessage.textContent =
          "هذا الاسم مضاف مسبقًا.";

        return;
      }

      gameState.players.push({
     id: generatePlayerId(),
     name: playerName,
     gender: selectedGender,
     avatar: selectedAvatar || null,
   });

      saveGame();
      renderPlayersPage();
    },
  );

  deleteButtons.forEach((button) => {
    button.addEventListener(
      "click",
      () => {
        const playerIndex = Number(
          button.dataset.playerIndex,
        );

        if (
          !Number.isInteger(playerIndex) ||
          playerIndex < 0 ||
          playerIndex >=
            gameState.players.length
        ) {
          return;
        }

        gameState.players.splice(
          playerIndex,
          1,
        );

        saveGame();
        renderPlayersPage();
      },
    );
  });

  continueButton?.addEventListener(
    "click",
    () => {
      if (
        gameState.players.length < 4
      ) {
        return;
      }

      transitionTo(
        GAME_PHASES.SETTINGS,
      );
    },
  );

  playerNameInput?.focus();
}


function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function generatePlayerId() {
  if (
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID ===
      "function"
  ) {
    return globalThis.crypto.randomUUID();
  }

  return `player-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
}


function renderSettingsPage() {
  setCurrentScreen(
    GAME_PHASES.SETTINGS,
  );

  const roles = getRolesDistribution(
    gameState.players.length,
  );

  const settings =
    gameState.settings;

  app.innerHTML = `
    <main
      class="setup-page settings-page"
    >
      <div
        class="background-orb background-orb-purple"
      ></div>

      <div
        class="background-orb background-orb-green"
      ></div>

      <header class="setup-header">
        <button
          class="back-button"
          id="backToPlayersButton"
          type="button"
        >
          →
          الرجوع
        </button>

        <div class="setup-brand">
          <img
            src="/logo.png"
            alt="شعار مافيا"
          />

          <span>
            إعداد اللعبة
          </span>
        </div>
      </header>

      <section class="settings-layout">
        <div class="settings-panel">
          <div class="section-heading">
            <p>
              المرحلة الثانية
            </p>

            <h1>
              إعداد المؤقتات
            </h1>

            <span>
              حدد مدة كل مرحلة قبل
              توزيع الشخصيات.
            </span>
          </div>

          <div class="time-settings">
            ${renderTimeSetting(
              "🌙",
              "مدة الليل",
              "nightDuration",
              settings.nightDuration,
              15,
              180,
              5,
            )}

            ${renderTimeSetting(
              "💬",
              "مدة النقاش",
              "discussionDuration",
              settings.discussionDuration,
              30,
              600,
              30,
            )}

            ${renderTimeSetting(
              "🗳️",
              "مدة التصويت",
              "votingDuration",
              settings.votingDuration,
              15,
              180,
              5,
            )}
          </div>

          <div class="option-settings">
            ${renderToggleSetting(
              "إظهار المؤقت",
              "إظهار الوقت المتبقي أثناء مراحل اللعبة.",
              "showTimer",
              settings.showTimer,
            )}

            ${renderToggleSetting(
              "تشغيل الأصوات",
              "تشغيل أصوات الليل والتنبيهات والانتقالات.",
              "soundEnabled",
              gameState.soundEnabled,
            )}

            ${renderToggleSetting(
              "اهتزاز الهاتف",
              "تنبيه اللاعب عند بداية دوره.",
              "vibrationEnabled",
              settings.vibrationEnabled,
            )}
          </div>

          <div class="advanced-rules-section">
            <div
              class="section-heading advanced-rules-heading"
            >
              <p>
                قواعد اختيارية
              </p>

              <h2>
                القواعد المتقدمة
              </h2>

              <span>
                يمكنك تشغيل أو إيقاف هذه
                القواعد حسب نظام جلستكم.
              </span>
            </div>

            <div class="option-settings">
              ${renderToggleSetting(
                "منع تكرار ضحية اللص",
                "لا يستطيع اللص اختيار نفس الضحية في ليلتين متتاليتين.",
                "preventRepeatVictim",
                settings.advancedRules
                  .preventRepeatVictim,
              )}

              ${renderToggleSetting(
                "منع تكرار إنقاذ الممرضة",
                "لا تستطيع الممرضة إنقاذ نفس اللاعب في ليلتين متتاليتين.",
                "preventRepeatSave",
                settings.advancedRules
                  .preventRepeatSave,
              )}
            </div>
          </div>
        </div>

        <aside class="game-summary-panel">
          <div class="roles-heading">
            <p>
              ملخص الجلسة
            </p>

            <h2>
              توزيع الشخصيات
            </h2>
          </div>

          <div class="summary-count">
            <span>
              عدد المشاركين
            </span>

            <strong>
              ${gameState.players.length}
            </strong>
          </div>

          <div class="roles-grid">
            ${renderRoleCard(
              "🗡️",
              "اللصوص",
              roles.thieves,
            )}

            ${renderRoleCard(
              "👑",
              "الملك",
              roles.king,
            )}

            ${renderRoleCard(
              "🏥",
              "الممرضة",
              roles.nurse,
            )}

            ${renderRoleCard(
              "👥",
              "المواطنون",
              roles.citizens,
            )}
          </div>

          <div class="duration-summary">
            <div>
              <span>
                الليل
              </span>

              <strong id="nightSummary">
                ${formatDuration(
                  settings.nightDuration,
                )}
              </strong>
            </div>

            <div>
              <span>
                النقاش
              </span>

              <strong
                id="discussionSummary"
              >
                ${formatDuration(
                  settings.discussionDuration,
                )}
              </strong>
            </div>

            <div>
              <span>
                التصويت
              </span>

              <strong id="votingSummary">
                ${formatDuration(
                  settings.votingDuration,
                )}
              </strong>
            </div>
          </div>

          <button
            class="continue-button"
            id="saveSettingsButton"
            type="button"
          >
            حفظ ومتابعة
          </button>

          <p class="minimum-note">
            المرحلة التالية ستكون توزيع
            الشخصيات سرًا.
          </p>
        </aside>
      </section>
    </main>
  `;

  bindSettingsPageEvents();
}


function renderTimeSetting(
  icon,
  title,
  settingName,
  currentValue,
  minimum,
  maximum,
  step,
) {
  return `
    <article class="time-setting-card">
      <div class="time-setting-heading">
        <span class="time-setting-icon">
          ${icon}
        </span>

        <div>
          <h2>
            ${title}
          </h2>

          <p>
            حدد المدة المناسبة للجلسة.
          </p>
        </div>
      </div>

      <div class="time-control">
        <button
          type="button"
          class="time-change-button"
          data-setting="${settingName}"
          data-change="-${step}"
          aria-label="تقليل ${title}"
        >
          −
        </button>

        <strong
          class="time-value"
          id="${settingName}Value"
        >
          ${formatDuration(currentValue)}
        </strong>

        <button
          type="button"
          class="time-change-button"
          data-setting="${settingName}"
          data-change="${step}"
          aria-label="زيادة ${title}"
        >
          +
        </button>
      </div>

      <input
        type="hidden"
        id="${settingName}Minimum"
        value="${minimum}"
      />

      <input
        type="hidden"
        id="${settingName}Maximum"
        value="${maximum}"
      />
    </article>
  `;
}


function renderToggleSetting(
  title,
  description,
  settingName,
  isEnabled,
) {
  return `
    <label class="toggle-setting">
      <div>
        <strong>
          ${title}
        </strong>

        <span>
          ${description}
        </span>
      </div>

      <input
        type="checkbox"
        data-toggle-setting="${settingName}"
        ${
          isEnabled
            ? "checked"
            : ""
        }
      />

      <span class="toggle-switch"></span>
    </label>
  `;
}


function bindSettingsPageEvents() {
  const backButton =
    document.querySelector(
      "#backToPlayersButton",
    );

  const saveSettingsButton =
    document.querySelector(
      "#saveSettingsButton",
    );

  const timeButtons =
    document.querySelectorAll(
      ".time-change-button",
    );

  const toggleInputs =
    document.querySelectorAll(
      "[data-toggle-setting]",
    );

  const advancedRuleNames = [
    "preventRepeatVictim",
    "preventRepeatSave",
  ];

  backButton?.addEventListener(
    "click",
    () => {
      transitionTo(
        GAME_PHASES.PLAYERS,
      );
    },
  );

  timeButtons.forEach((button) => {
    button.addEventListener(
      "click",
      () => {
        const settingName =
          button.dataset.setting;

        const changeAmount = Number(
          button.dataset.change,
        );

        if (
          !settingName ||
          !Number.isFinite(changeAmount)
        ) {
          return;
        }

        const minimumInput =
          document.querySelector(
            `#${settingName}Minimum`,
          );

        const maximumInput =
          document.querySelector(
            `#${settingName}Maximum`,
          );

        const minimum = Number(
          minimumInput?.value,
        );

        const maximum = Number(
          maximumInput?.value,
        );

        if (
          !Number.isFinite(minimum) ||
          !Number.isFinite(maximum)
        ) {
          return;
        }

        const currentValue = Number(
          gameState.settings[
            settingName
          ],
        );

        const safeCurrentValue =
          Number.isFinite(currentValue)
            ? currentValue
            : minimum;

        const newValue = Math.min(
          maximum,
          Math.max(
            minimum,
            safeCurrentValue +
              changeAmount,
          ),
        );

        gameState.settings[
          settingName
        ] = newValue;

        saveGame();

        const timeValueElement =
          document.querySelector(
            `#${settingName}Value`,
          );

        if (timeValueElement) {
          timeValueElement.textContent =
            formatDuration(newValue);
        }

        updateDurationSummary(
          settingName,
          newValue,
        );
      },
    );
  });

  toggleInputs.forEach((input) => {
    input.addEventListener(
      "change",
      () => {
        const settingName =
          input.dataset.toggleSetting;

        if (!settingName) {
          return;
        }

        if (
          settingName ===
          "soundEnabled"
        ) {
          gameState.soundEnabled =
            input.checked;

          saveGame();

          return;
        }

        if (
          advancedRuleNames.includes(
            settingName,
          )
        ) {
          if (
            !gameState.settings
              .advancedRules
          ) {
            gameState.settings
              .advancedRules = {
                preventRepeatVictim:
                  true,

                preventRepeatSave:
                  true,
              };
          }

          gameState.settings
            .advancedRules[
              settingName
            ] = input.checked;

          saveGame();

          return;
        }

        gameState.settings[
          settingName
        ] = input.checked;

        saveGame();
      },
    );
  });

  saveSettingsButton?.addEventListener(
    "click",
    () => {
      syncPlayersWithProfiles(
        gameState,
      );

      assignRoles();

      startMatchTimeline(
        gameState,
      );

      gameState.currentRevealIndex =
        0;

      saveGame();

      transitionTo(
        GAME_PHASES.ROLE_HANDOFF,
      );
    },
  );
}


function updateDurationSummary(
  settingName,
  value,
) {
  const summaryElements = {
    nightDuration:
      "#nightSummary",

    discussionDuration:
      "#discussionSummary",

    votingDuration:
      "#votingSummary",
  };

  const selector =
    summaryElements[settingName];

  if (!selector) {
    return;
  }

  const summaryElement =
    document.querySelector(selector);

  if (summaryElement) {
    summaryElement.textContent =
      formatDuration(value);
  }
}


function formatDuration(totalSeconds) {
  const safeSeconds = Math.max(
    0,
    Number(totalSeconds) || 0,
  );

  if (safeSeconds < 60) {
    return `${safeSeconds} ثانية`;
  }

  const minutes = Math.floor(
    safeSeconds / 60,
  );

  const seconds =
    safeSeconds % 60;

  if (seconds === 0) {
    return `${minutes} دقيقة`;
  }

  return `${minutes}:${String(
    seconds,
  ).padStart(2, "0")} دقيقة`;
}


function getThiefCount(playerCount) {
  if (
    playerCount >= 4 &&
    playerCount <= 6
  ) {
    return 1;
  }

  if (
    playerCount >= 7 &&
    playerCount <= 10
  ) {
    return 2;
  }

  if (
    playerCount >= 11 &&
    playerCount <= 14
  ) {
    return 3;
  }

  if (
    playerCount >= 15 &&
    playerCount <= 18
  ) {
    return 4;
  }

  if (
    playerCount >= 19 &&
    playerCount <= 22
  ) {
    return 5;
  }

  return 0;
}


function assignRoles() {
  const playerCount =
    gameState.players.length;

  const thiefCount =
    getThiefCount(playerCount);

  const roles = [
    ...Array(thiefCount).fill(
      ROLE_IDS.THIEF,
    ),

    ROLE_IDS.NURSE,
    ROLE_IDS.KING,
  ];

  while (
    roles.length < playerCount
  ) {
    roles.push(
      ROLE_IDS.CITIZEN,
    );
  }

  const shuffledRoles =
    shuffleArray([...roles]);

  gameState.assignedPlayers =
    gameState.players.map(
      (player, index) => {
        const isLegacyPlayer =
          typeof player === "string";

        return {
          id: isLegacyPlayer
            ? generatePlayerId()
            : player.id ??
              generatePlayerId(),

          name: isLegacyPlayer
            ? player
            : player.name,

          gender: isLegacyPlayer
            ? "male"
            : player.gender ??
              "male",

          role:
            shuffledRoles[index],

          alive: true,
          revealed: false,
          eliminatedRound: null,
        };
      },
    );

  gameState.currentRevealIndex = 0;

  saveGame();
}


function shuffleArray(array) {
  for (
    let index = array.length - 1;
    index > 0;
    index -= 1
  ) {
    const randomIndex =
      Math.floor(
        Math.random() *
          (index + 1),
      );

    [
      array[index],
      array[randomIndex],
    ] = [
      array[randomIndex],
      array[index],
    ];
  }

  return array;
}


function getPlayerRole(player) {
  if (!player) {
    return null;
  }

  return getRoleDetails(
    player.role,
  );
}


function isPlayerRole(
  player,
  roleId,
) {
  return Boolean(
    player &&
      player.role === roleId,
  );
}


function isPlayerTeam(
  player,
  teamId,
) {
  if (!player) {
    return false;
  }

  const role =
    getRoleDetails(player.role);

  return role?.team === teamId;
}


function getPlayersByRole(
  roleId,
  options = {},
) {
  const {
    aliveOnly = false,
  } = options;

  return gameState.assignedPlayers.filter(
    (player) => {
      const matchesRole =
        player.role === roleId;

      const matchesLifeState =
        !aliveOnly ||
        player.alive;

      return (
        matchesRole &&
        matchesLifeState
      );
    },
  );
}


function getActiveNightRoles() {
  return Object.values(
    ROLE_DEFINITIONS,
  )
    .filter((role) => {
      if (!role.hasNightAction) {
        return false;
      }

      const alivePlayersWithRole =
        getPlayersByRole(
          role.id,
          {
            aliveOnly: true,
          },
        );

      return (
        alivePlayersWithRole.length >
        0
      );
    })
    .sort(
      (
        firstRole,
        secondRole,
      ) => {
        return (
          firstRole.nightOrder -
          secondRole.nightOrder
        );
      },
    )
    .map((role) => role.id);
}


function prepareNightSequence() {
  gameState.nightSequence = {
    roleIds:
      getActiveNightRoles(),

    currentIndex: 0,
  };

  saveGame();
}


function getCurrentNightRoleId() {
  return (
    gameState.nightSequence
      ?.roleIds?.[
        gameState.nightSequence
          .currentIndex
      ] ?? null
  );
}


function getCurrentNightRole() {
  const roleId =
    getCurrentNightRoleId();

  if (!roleId) {
    return null;
  }

  return getRoleDetails(roleId);
}


function getNightRolePhase(roleId) {
  return (
    NIGHT_ROLE_PHASES[
      roleId
    ] ?? null
  );
}


function renderCurrentNightRole() {
  const roleId =
    getCurrentNightRoleId();

  if (!roleId) {
    resolveNight();
    return;
  }

  const rolePhase =
    getNightRolePhase(roleId);

  if (!rolePhase) {
    console.warn(
      `لا توجد مرحلة مسجلة للدور الليلي: ${roleId}`,
    );

    goToNextNightRole();

    return;
  }

  transitionTo(rolePhase);
}


function goToNextNightRole() {
  gameState.nightSequence
    .currentIndex += 1;

  saveGame();

  renderCurrentNightRole();
}


function getPlayersByTeam(
  teamId,
  options = {},
) {
  const {
    aliveOnly = false,
  } = options;

  return gameState.assignedPlayers.filter(
    (player) => {
      const matchesTeam =
        isPlayerTeam(
          player,
          teamId,
        );

      const matchesLifeState =
        !aliveOnly ||
        player.alive;

      return (
        matchesTeam &&
        matchesLifeState
      );
    },
  );
}


function getAliveRolePlayer(roleId) {
  return (
    getPlayersByRole(
      roleId,
      {
        aliveOnly: true,
      },
    )[0] ?? null
  );
}


function renderRoleHandoffPage() {
  setCurrentScreen(
    GAME_PHASES.ROLE_HANDOFF,
  );

  const player =
    gameState.assignedPlayers[
      gameState.currentRevealIndex
    ];

  if (!player) {
    transitionTo(
      GAME_PHASES.ROLES_READY,
    );

    return;
  }

  app.innerHTML = `
    <main class="role-page">
      <div
        class="background-orb background-orb-purple"
      ></div>

      <div
        class="background-orb background-orb-green"
      ></div>

      <header class="role-page-header">
        <div class="setup-brand">
          <img
            src="/logo.png"
            alt="شعار مافيا"
          />

          <span>
            توزيع الشخصيات
          </span>
        </div>

        <span class="reveal-progress">
          ${
            gameState.currentRevealIndex +
            1
          }
          من
          ${
            gameState.assignedPlayers
              .length
          }
        </span>
      </header>

      <section class="role-handoff-card">
        <p class="role-step-label">
          سلّم الجهاز إلى
        </p>

        <h1>
          ${escapeHtml(player.name)}
        </h1>

        <div class="handoff-icon">
          📱
        </div>

        <p class="handoff-description">
          تأكد أن اللاعب وحده ينظر إلى
          الشاشة. لا تكشف شخصيته لأي
          شخص آخر.
        </p>

        <button
          class="primary-role-button"
          id="showRoleButton"
          type="button"
        >
          أنا
          ${escapeHtml(player.name)}،
          اعرض شخصيتي
        </button>

        <button
          class="secondary-role-button"
          id="backToSettingsButton"
          type="button"
        >
          الرجوع إلى الإعدادات
        </button>
      </section>
    </main>
  `;

  document
    .querySelector(
      "#showRoleButton",
    )
    ?.addEventListener(
      "click",
      renderCurrentRolePage,
    );

  document
    .querySelector(
      "#backToSettingsButton",
    )
    ?.addEventListener(
      "click",
      () => {
        transitionTo(
          GAME_PHASES.SETTINGS,
        );
      },
    );
}


function renderRolePlayingCard(
  player,
  role,
) {
  const playerGender =
    player.gender ?? "male";

  const cardImage =
    getRoleCardImage(
      player.role,
      playerGender,
    );

  const displayedRoleName =
    getGenderedRoleName(
      player,
      role,
    );

  if (!cardImage) {
    return "";
  }

  return `
    <div class="role-card-stage">
      <div
        class="role-playing-card"
        id="currentRoleCard"
      >
        <div class="role-card-inner">
          <div
            class="role-card-face role-card-back"
          >
            <img
              class="role-card-back-logo"
              src="/logo.png"
              alt=""
            />

            <p class="role-card-back-title">
              مافيا
            </p>
          </div>

          <div
            class="role-card-face role-card-front"
          >
            <img
              class="role-card-front-image"
              src="${cardImage}"
              alt="بطاقة ${escapeHtml(
                displayedRoleName,
              )}"
            />

            <span
              class="role-card-shine"
              aria-hidden="true"
            ></span>
          </div>
        </div>
      </div>
    </div>
  `;
}


function getGenderedRoleName(
  player,
  role,
) {
  const gender =
    player.gender ?? "male";

  const names = {
    [ROLE_IDS.THIEF]: {
      male: "اللص",
      female: "اللصة",
    },

    [ROLE_IDS.KING]: {
      male: "الملك",
      female: "الملكة",
    },

    [ROLE_IDS.NURSE]: {
      male: "الممرض",
      female: "الممرضة",
    },

    [ROLE_IDS.CITIZEN]: {
      male: "المواطن",
      female: "المواطنة",
    },
  };

  return (
    names[player.role]?.[gender] ??
    role?.name ??
    "شخصية غير معروفة"
  );
}


function renderCurrentRolePage() {
  const player =
    gameState.assignedPlayers[
      gameState.currentRevealIndex
    ];

  if (!player) {
    transitionTo(
      GAME_PHASES.ROLES_READY,
    );

    return;
  }

  const role =
    getRoleDetails(player.role);

  if (!role) {
    showErrorToast(
      "تعذر التعرف على شخصية اللاعب.",
      "خطأ في الشخصية",
    );

    return;
  }

  const displayedRoleName =
    getGenderedRoleName(
      player,
      role,
    );

  app.innerHTML = `
    <main
      class="role-page ${role.className}"
    >
      <div
        class="background-orb background-orb-purple"
      ></div>

      <div
        class="background-orb background-orb-green"
      ></div>

      <section class="role-reveal-card">
        <p class="role-card-secret-label">
          بطاقتك السرية
        </p>

        <h1 class="role-card-player-name">
          ${escapeHtml(player.name)}
        </h1>

        ${renderRolePlayingCard(
          player,
          role,
        )}

        <div
          class="role-card-details"
          id="roleCardDetails"
        >
          <p class="role-team">
            ${escapeHtml(role.team)}
          </p>

          <h2>
            ${escapeHtml(
              displayedRoleName,
            )}
          </h2>

          <p class="role-description">
            ${escapeHtml(
              role.description,
            )}
          </p>

          ${
            player.role ===
            ROLE_IDS.THIEF
              ? renderThiefPartners(
                  player,
                )
              : ""
          }
        </div>

        <button
          class="primary-role-button role-card-action-hidden"
          id="hideRoleButton"
          type="button"
        >
          فهمت، أخفِ شخصيتي
        </button>
      </section>
    </main>
  `;

  player.revealed = true;

  saveGame();

  document
    .querySelector(
      "#hideRoleButton",
    )
    ?.addEventListener(
      "click",
      () => {
        gameState.currentRevealIndex +=
          1;

        saveGame();

        transitionTo(
          GAME_PHASES.ROLE_HANDOFF,
        );
      },
    );

  startRoleCardAnimation();
}


function startRoleCardAnimation() {
  const card =
    document.querySelector(
      "#currentRoleCard",
    );

  const details =
    document.querySelector(
      "#roleCardDetails",
    );

  const hideRoleButton =
    document.querySelector(
      "#hideRoleButton",
    );

  if (!card) {
    details?.classList.add(
      "details-visible",
    );

    hideRoleButton?.classList.remove(
      "role-card-action-hidden",
    );

    hideRoleButton?.classList.add(
      "role-card-action-visible",
    );

    return;
  }

  window.requestAnimationFrame(
    () => {
      card.classList.add(
        "card-entered",
      );
    },
  );

  window.setTimeout(
    () => {
      card.classList.add(
        "card-flipped",
      );
    },
    850,
  );

  window.setTimeout(
    () => {
      details?.classList.add(
        "details-visible",
      );

      hideRoleButton?.classList.remove(
        "role-card-action-hidden",
      );

      hideRoleButton?.classList.add(
        "role-card-action-visible",
      );
    },
    2100,
  );
}


function renderThiefPartners(
  currentPlayer,
) {
  const partners =
    getPlayersByRole(
      ROLE_IDS.THIEF,
    ).filter(
      (player) =>
        player.id !==
        currentPlayer.id,
    );

  if (
    partners.length === 0
  ) {
    return `
      <p class="role-partners-empty">
        أنت اللص الوحيد في هذه المباراة.
      </p>
    `;
  }

  return `
    <div class="role-partners">
      <span>
        شركاؤك من اللصوص
      </span>

      ${partners
        .map(
          (player) => `
            <strong>
              ${escapeHtml(
                player.name,
              )}
            </strong>
          `,
        )
        .join("")}
    </div>
  `;
}


function renderRolesReadyPage() {
  setCurrentScreen(
    GAME_PHASES.ROLES_READY,
  );

  app.innerHTML = `
    <main class="role-page">
      <div
        class="background-orb background-orb-purple"
      ></div>

      <div
        class="background-orb background-orb-green"
      ></div>

      <section
        class="role-handoff-card roles-ready-card"
      >
        <img
          class="ready-logo"
          src="/logo.png"
          alt="شعار مافيا"
        />

        <p class="role-step-label">
          اكتمل التوزيع
        </p>

        <h1>
          الجميع عرف شخصيته
        </h1>

        <p class="handoff-description">
          ضع الجهاز في مكان مناسب.
          تبدأ اللعبة بالمرحلة الليلية.
        </p>

        <button
          class="primary-role-button"
          id="startGameButton"
          type="button"
        >
          بدء الليلة الأولى
        </button>

        <button
          class="secondary-role-button"
          id="repeatRolesButton"
          type="button"
        >
          إعادة عرض الشخصيات
        </button>
      </section>
    </main>
  `;

  document
    .querySelector(
      "#repeatRolesButton",
    )
    ?.addEventListener(
      "click",
      () => {
        gameState.currentRevealIndex =
          0;

        gameState.assignedPlayers.forEach(
          (player) => {
            player.revealed = false;
          },
        );

        saveGame();

        transitionTo(
          GAME_PHASES.ROLE_HANDOFF,
        );
      },
    );

  document
    .querySelector(
      "#startGameButton",
    )
    ?.addEventListener(
      "click",
      startNight,
    );
}
function startNight() {
  stopActiveTimer();

  gameState.nightAction = {
    victimId: null,
    savedPlayerId: null,
    inspectedPlayerId: null,
  };

  prepareNightSequence();

  saveGame();

  transitionTo(
    GAME_PHASES.NIGHT_INTRO,
  );
}


function renderNightIntroPage() {
  setCurrentScreen(
    GAME_PHASES.NIGHT_INTRO,
  );

  const activeNightRoles =
    gameState.nightSequence?.roleIds ??
    [];

  const activeRoleNames =
    activeNightRoles
      .map((roleId) => {
        const role =
          getRoleDetails(roleId);

        return role?.name ?? null;
      })
      .filter(Boolean);

  app.innerHTML = `
    <main class="night-page night-intro-page">
      <div
        class="night-background-glow night-background-glow-purple"
      ></div>

      <div
        class="night-background-glow night-background-glow-blue"
      ></div>

      <div
        class="night-stars"
        aria-hidden="true"
      >
        <span></span>
        <span></span>
        <span></span>
        <span></span>
        <span></span>
        <span></span>
        <span></span>
        <span></span>
      </div>

      <section class="night-card">
        <img
          class="night-logo"
          src="/logo.png"
          alt="شعار مافيا"
        />

        <p class="night-round">
          الليلة
          ${gameState.roundNumber}
        </p>

        <div class="night-main-icon">
          🌙
        </div>

        <h1>
          حلّ الليل على المدينة
        </h1>

        <p class="night-description">
          على جميع اللاعبين إغلاق أعينهم.
          سيتم استدعاء أصحاب الأدوار
          الليلية واحدًا بعد الآخر.
        </p>

        ${
          activeRoleNames.length > 0
            ? `
              <div class="night-active-roles">
                <span>
                  الأدوار النشطة هذه الليلة
                </span>

                <strong>
                  ${activeRoleNames
                    .map((name) =>
                      escapeHtml(name),
                    )
                    .join(" • ")}
                </strong>
              </div>
            `
            : `
              <div class="night-active-roles">
                <span>
                  لا توجد أدوار ليلية نشطة
                </span>
              </div>
            `
        }

        <button
          class="night-primary-button"
          id="beginNightRolesButton"
          type="button"
        >
          بدء أدوار الليل
        </button>
      </section>
    </main>
  `;

  const beginNightRolesButton =
    document.querySelector(
      "#beginNightRolesButton",
    );

  beginNightRolesButton?.addEventListener(
    "click",
    () => {
      renderCurrentNightRole();
    },
  );
}


function renderNightRoleHandoff({
  roleId,
  pageClass,
  icon,
  title,
  description,
  buttonText,
  nextPhase,
}) {
  const rolePlayers =
    getPlayersByRole(roleId, {
      aliveOnly: true,
    });

  if (rolePlayers.length === 0) {
    goToNextNightRole();
    return;
  }

  const role =
    getRoleDetails(roleId);

  const playerNames =
    rolePlayers
      .map((player) =>
        escapeHtml(player.name),
      )
      .join("، ");

  app.innerHTML = `
    <main
      class="night-page ${pageClass}"
    >
      <div
        class="night-background-glow night-background-glow-purple"
      ></div>

      <div
        class="night-background-glow night-background-glow-blue"
      ></div>

      <section class="night-card night-handoff-card">
        <div class="night-role-icon">
          ${icon}
        </div>

        <p class="night-round">
          الليلة
          ${gameState.roundNumber}
        </p>

        <h1>
          ${title}
        </h1>

        <p class="night-role-player-name">
          ${playerNames}
        </p>

        <p class="night-description">
          ${description}
        </p>

        <div class="night-privacy-warning">
          <span>
            🔒
          </span>

          <p>
            تأكد أن أصحاب هذا الدور فقط
            ينظرون إلى الشاشة.
          </p>
        </div>

        <button
          class="night-primary-button"
          id="continueNightRoleButton"
          type="button"
        >
          ${buttonText}
        </button>

        <p class="night-role-caption">
          ${escapeHtml(
            role?.description ?? "",
          )}
        </p>
      </section>
    </main>
  `;

  const continueButton =
    document.querySelector(
      "#continueNightRoleButton",
    );

  continueButton?.addEventListener(
    "click",
    () => {
      transitionTo(nextPhase);
    },
  );
}


function renderThiefHandoffPage() {
  setCurrentScreen(
    GAME_PHASES.THIEF_HANDOFF,
  );

  renderNightRoleHandoff({
    roleId: ROLE_IDS.THIEF,

    pageClass:
      "thief-night",

    icon: "🗡️",

    title:
      "يستيقظ اللصوص",

    description:
      "افتحوا أعينكم بهدوء، واتفقوا سرًا على اللاعب الذي تريدون اغتياله.",

    buttonText:
      "اختيار الضحية",

    nextPhase:
      GAME_PHASES.THIEF_SELECTION,
  });
}


function getPreviousNightVictimId() {
  const previousVictimId =
    gameState.previousNightActions
      ?.victimId ??
    gameState.lastNightAction
      ?.victimId ??
    null;

  return previousVictimId;
}


function getThiefTargets() {
  const alivePlayers =
    gameState.assignedPlayers.filter(
      (player) => player.alive,
    );

  const eligiblePlayers =
    alivePlayers.filter(
      (player) =>
        !isPlayerTeam(
          player,
          TEAMS.THIEVES,
        ),
    );

  const preventRepeatVictim =
    gameState.settings
      ?.advancedRules
      ?.preventRepeatVictim ??
    true;

  if (!preventRepeatVictim) {
    return eligiblePlayers;
  }

  const previousVictimId =
    getPreviousNightVictimId();

  if (!previousVictimId) {
    return eligiblePlayers;
  }

  const filteredPlayers =
    eligiblePlayers.filter(
      (player) =>
        player.id !==
        previousVictimId,
    );

  /*
   * إذا لم يبقَ سوى اللاعب السابق،
   * نسمح باختياره حتى لا تتعطل اللعبة.
   */
  return filteredPlayers.length > 0
    ? filteredPlayers
    : eligiblePlayers;
}


function renderThiefSelectionPage() {
  setCurrentScreen(
    GAME_PHASES.THIEF_SELECTION,
  );

  const targets =
    getThiefTargets();

  if (targets.length === 0) {
    gameState.nightAction.victimId =
      null;

    saveGame();
    goToNextNightRole();

    return;
  }

  renderNightPlayerSelection({
    title:
      "اختاروا ضحية هذه الليلة",

    description:
      "حددوا لاعبًا واحدًا من خارج فريق اللصوص. سيتم تنفيذ الاختيار بعد انتهاء جميع الأدوار الليلية.",

    icon: "🗡️",

    players: targets,

    selectedPlayerId:
      gameState.nightAction
        .victimId,

    buttonText:
      "تأكيد اختيار الضحية",

    onConfirm(playerId) {
      const selectedPlayer =
        targets.find(
          (player) =>
            player.id === playerId,
        );

      if (!selectedPlayer) {
        showErrorToast(
          "اللاعب المحدد غير متاح.",
          "تعذر حفظ الاختيار",
        );

        return;
      }

      gameState.nightAction.victimId =
        playerId;

      saveGame();

      goToNextNightRole();
    },
  });
}


function renderNurseHandoffPage() {
  setCurrentScreen(
    GAME_PHASES.NURSE_HANDOFF,
  );

  renderNightRoleHandoff({
    roleId: ROLE_IDS.NURSE,

    pageClass:
      "nurse-night",

    icon: "🩺",

    title:
      "تستيقظ الممرضة",

    description:
      "افتحي عينيك واختاري لاعبًا واحدًا لحمايته هذه الليلة.",

    buttonText:
      "اختيار اللاعب المحمي",

    nextPhase:
      GAME_PHASES.NURSE_SELECTION,
  });
}


function getPreviousNurseSaveId() {
  const previousSavedPlayerId =
    gameState.previousNightActions
      ?.savedPlayerId ??
    gameState.lastNightAction
      ?.savedPlayerId ??
    null;

  return previousSavedPlayerId;
}


function getNurseTargets() {
  const alivePlayers =
    gameState.assignedPlayers.filter(
      (player) => player.alive,
    );

  const preventRepeatSave =
    gameState.settings
      ?.advancedRules
      ?.preventRepeatSave ??
    true;

  if (!preventRepeatSave) {
    return alivePlayers;
  }

  const previousSavedPlayerId =
    getPreviousNurseSaveId();

  if (!previousSavedPlayerId) {
    return alivePlayers;
  }

  const filteredPlayers =
    alivePlayers.filter(
      (player) =>
        player.id !==
        previousSavedPlayerId,
    );

  /*
   * عند عدم وجود بديل، نسمح بنفس
   * اللاعب حتى تستمر الجولة.
   */
  return filteredPlayers.length > 0
    ? filteredPlayers
    : alivePlayers;
}


function renderNurseSelectionPage() {
  setCurrentScreen(
    GAME_PHASES.NURSE_SELECTION,
  );

  const targets =
    getNurseTargets();

  if (targets.length === 0) {
    gameState.nightAction
      .savedPlayerId = null;

    saveGame();
    goToNextNightRole();

    return;
  }

  renderNightPlayerSelection({
    title:
      "اختاري اللاعب الذي ستحمينه",

    description:
      "يمكن للممرضة حماية أي لاعب حي، بما في ذلك نفسها. إذا كان هو هدف اللصوص فسينجو.",

    icon: "🩺",

    players: targets,

    selectedPlayerId:
      gameState.nightAction
        .savedPlayerId,

    buttonText:
      "تأكيد الحماية",

    onConfirm(playerId) {
      const selectedPlayer =
        targets.find(
          (player) =>
            player.id === playerId,
        );

      if (!selectedPlayer) {
        showErrorToast(
          "اللاعب المحدد غير متاح.",
          "تعذر حفظ الحماية",
        );

        return;
      }

      gameState.nightAction
        .savedPlayerId = playerId;

      saveGame();

      goToNextNightRole();
    },
  });
}


function renderKingHandoffPage() {
  setCurrentScreen(
    GAME_PHASES.KING_HANDOFF,
  );

  renderNightRoleHandoff({
    roleId: ROLE_IDS.KING,

    pageClass:
      "king-night",

    icon: "👑",

    title:
      "يستيقظ الملك",

    description:
      "افتح عينيك واختر لاعبًا واحدًا لتعرف حقيقته سرًا.",

    buttonText:
      "اختيار لاعب للكشف",

    nextPhase:
      GAME_PHASES.KING_SELECTION,
  });
}


function getKingTargets() {
  const king =
    getAliveRolePlayer(
      ROLE_IDS.KING,
    );

  if (!king) {
    return [];
  }

  return gameState.assignedPlayers.filter(
    (player) =>
      player.alive &&
      player.id !== king.id,
  );
}


function renderKingSelectionPage() {
  setCurrentScreen(
    GAME_PHASES.KING_SELECTION,
  );

  const targets =
    getKingTargets();

  if (targets.length === 0) {
    gameState.nightAction
      .inspectedPlayerId = null;

    saveGame();
    goToNextNightRole();

    return;
  }

  renderNightPlayerSelection({
    title:
      "اختر لاعبًا لكشف حقيقته",

    description:
      "ستظهر النتيجة على هذه الشاشة بصورة سرية. احفظها جيدًا ولا تكشفها مباشرة.",

    icon: "👑",

    players: targets,

    selectedPlayerId:
      gameState.nightAction
        .inspectedPlayerId,

    buttonText:
      "كشف الشخصية",

    onConfirm(playerId) {
      const selectedPlayer =
        targets.find(
          (player) =>
            player.id === playerId,
        );

      if (!selectedPlayer) {
        showErrorToast(
          "اللاعب المحدد غير متاح.",
          "تعذر تنفيذ الكشف",
        );

        return;
      }

      gameState.nightAction
        .inspectedPlayerId =
        playerId;

      saveGame();

      transitionTo(
        GAME_PHASES.KING_RESULT,
      );
    },
  });
}


function getKingInspectionDetails(
  player,
) {
  const role =
    getPlayerRole(player);

  if (!role) {
    return {
      title:
        "غير معروف",

      description:
        "تعذر التعرف على شخصية هذا اللاعب.",

      icon: "❔",

      className:
        "inspection-unknown",
    };
  }

  if (
    role.team ===
    TEAMS.THIEVES
  ) {
    return {
      title:
        "هذا اللاعب لص",

      description:
        "هذا اللاعب ينتمي إلى فريق اللصوص.",

      icon: "🗡️",

      className:
        "inspection-thief",
    };
  }

  if (
    role.id ===
    ROLE_IDS.NURSE
  ) {
    return {
      title:
        "هذه هي الممرضة",

      description:
        "هذا اللاعب هو الممرضة التي تحمي اللاعبين أثناء الليل.",

      icon: "✚",

      className:
        "inspection-nurse",
    };
  }

  return {
    title:
      "هذا اللاعب مواطن",

    description:
      "لم يظهر أن هذا اللاعب لص أو ممرضة.",

    icon: "👤",

    className:
      "inspection-citizen",
  };
}


function renderKingInspectionResult(
  playerId,
) {
  setCurrentScreen(
    GAME_PHASES.KING_RESULT,
  );

  const inspectedPlayer =
    gameState.assignedPlayers.find(
      (player) =>
        player.id === playerId,
    );

  if (!inspectedPlayer) {
    console.error(
      "لم يتم العثور على اللاعب الذي فحصه الملك.",
    );

    goToNextNightRole();

    return;
  }

  const inspection =
    getKingInspectionDetails(
      inspectedPlayer,
    );

  const king =
    getAliveRolePlayer(
      ROLE_IDS.KING,
    );

  const inspectedPlayerIsThief =
    isPlayerTeam(
      inspectedPlayer,
      TEAMS.THIEVES,
    );

  if (inspectedPlayerIsThief) {
    if (!gameState.matchStats) {
      gameState.matchStats = {};
    }

    if (
      !Array.isArray(
        gameState.matchStats
          .kingThiefReveals,
      )
    ) {
      gameState.matchStats
        .kingThiefReveals = [];
    }

    const revealAlreadyRecorded =
      gameState.matchStats
        .kingThiefReveals
        .some((record) => {
          return (
            record.round ===
              gameState.roundNumber &&
            record.kingId ===
              king?.id &&
            record.targetId ===
              inspectedPlayer.id
          );
        });

    if (!revealAlreadyRecorded) {
      gameState.matchStats
        .kingThiefReveals
        .push({
          round:
            gameState.roundNumber,

          kingId:
            king?.id ?? null,

          targetId:
            inspectedPlayer.id,
        });

      addTimelineEvent(
        gameState,
        {
          type:
            "king-reveal",

          title:
            `كشف الملك أن ${inspectedPlayer.name} لص`,

          description:
            "استخدم الملك قدرته ونجح في كشف أحد اللصوص.",

          icon: "👑",

          round:
            gameState.roundNumber,

          phase: "night",

          playerId:
            king?.id ?? null,

          targetId:
            inspectedPlayer.id,
        },
      );

      saveGame();
    }
  }

  app.innerHTML = `
    <main
      class="night-page king-night"
    >
      <div
        class="night-background-glow night-background-glow-gold"
      ></div>

      <section
        class="night-card inspection-result-card ${inspection.className}"
      >
        <div class="night-role-icon">
          ${inspection.icon}
        </div>

        <p class="night-round">
          نتيجة الكشف السرية
        </p>

        <h1>
          ${escapeHtml(
            inspectedPlayer.name,
          )}
        </h1>

        <p class="inspection-role">
          ${escapeHtml(
            inspection.title,
          )}
        </p>

        <p class="night-description">
          ${escapeHtml(
            inspection.description,
          )}
        </p>

        <div class="night-privacy-warning">
          <span>
            🤫
          </span>

          <p>
            احفظ النتيجة ولا تكشفها
            لبقية اللاعبين.
          </p>
        </div>

        <button
          class="night-primary-button"
          id="finishKingTurnButton"
          type="button"
        >
          فهمت، أخفِ النتيجة
        </button>
      </section>
    </main>
  `;

  const finishKingTurnButton =
    document.querySelector(
      "#finishKingTurnButton",
    );

  finishKingTurnButton
    ?.addEventListener(
      "click",
      () => {
        goToNextNightRole();
      },
    );
}


function renderNightPlayerSelection({
  title,
  description,
  icon,
  players,
  selectedPlayerId,
  buttonText,
  onConfirm,
}) {
  const safePlayers =
    Array.isArray(players)
      ? players
      : [];

  app.innerHTML = `
    <main class="night-page">
      <div
        class="night-background-glow night-background-glow-purple"
      ></div>

      <div
        class="night-background-glow night-background-glow-blue"
      ></div>

      <section class="night-selection-card">
        <div class="night-role-icon">
          ${icon}
        </div>

        <p class="night-round">
          الليلة
          ${gameState.roundNumber}
        </p>

        <h1>
          ${title}
        </h1>

        <p class="night-description">
          ${description}
        </p>

        <div
          class="night-players-grid"
        >
          ${safePlayers
            .map((player) => {
              const playerInitial =
                String(
                  player.name ?? "?",
                )
                  .trim()
                  .charAt(0)
                  .toUpperCase();

              const isSelected =
                selectedPlayerId ===
                player.id;

              return `
                <button
                  class="night-player-option ${
                    isSelected
                      ? "selected"
                      : ""
                  }"
                  type="button"
                  data-night-player-id="${escapeHtml(
                    player.id,
                  )}"
                  aria-pressed="${
                    isSelected
                      ? "true"
                      : "false"
                  }"
                >
                  <span
                    class="night-player-avatar"
                  >
                    ${escapeHtml(
                      playerInitial,
                    )}
                  </span>

                  <strong>
                    ${escapeHtml(
                      player.name,
                    )}
                  </strong>
                </button>
              `;
            })
            .join("")}
        </div>

        <p
          class="night-selection-message"
          id="nightSelectionMessage"
          aria-live="polite"
        ></p>

        <button
          class="night-primary-button"
          id="confirmNightSelectionButton"
          type="button"
          ${
            selectedPlayerId
              ? ""
              : "disabled"
          }
        >
          ${buttonText}
        </button>
      </section>
    </main>
  `;

  let currentSelectionId =
    selectedPlayerId ?? null;

  const options =
    document.querySelectorAll(
      "[data-night-player-id]",
    );

  const confirmButton =
    document.querySelector(
      "#confirmNightSelectionButton",
    );

  const message =
    document.querySelector(
      "#nightSelectionMessage",
    );

  options.forEach((option) => {
    option.addEventListener(
      "click",
      () => {
        const selectedId =
          option.dataset
            .nightPlayerId;

        if (!selectedId) {
          return;
        }

        currentSelectionId =
          selectedId;

        options.forEach((item) => {
          item.classList.remove(
            "selected",
          );

          item.setAttribute(
            "aria-pressed",
            "false",
          );
        });

        option.classList.add(
          "selected",
        );

        option.setAttribute(
          "aria-pressed",
          "true",
        );

        if (confirmButton) {
          confirmButton.disabled =
            false;
        }

        if (message) {
          message.textContent =
            "";
        }
      },
    );
  });

  confirmButton?.addEventListener(
    "click",
    () => {
      if (!currentSelectionId) {
        if (message) {
          message.textContent =
            "اختر لاعبًا أولًا.";
        }

        return;
      }

      const selectedPlayerExists =
        safePlayers.some(
          (player) =>
            player.id ===
            currentSelectionId,
        );

      if (!selectedPlayerExists) {
        if (message) {
          message.textContent =
            "الاختيار غير متاح. اختر لاعبًا آخر.";
        }

        return;
      }

      confirmButton.disabled =
        true;

      onConfirm(
        currentSelectionId,
      );
    },
  );
}


function ensureMatchStatsStructure() {
  if (!gameState.matchStats) {
    gameState.matchStats = {};
  }

  if (
    !Array.isArray(
      gameState.matchStats.votes,
    )
  ) {
    gameState.matchStats.votes = [];
  }

  if (
    !Array.isArray(
      gameState.matchStats
        .successfulNurseSaves,
    )
  ) {
    gameState.matchStats
      .successfulNurseSaves = [];
  }

  if (
    !Array.isArray(
      gameState.matchStats
        .kingThiefReveals,
    )
  ) {
    gameState.matchStats
      .kingThiefReveals = [];
  }

  if (
    !gameState.matchStats
      .eliminationRounds ||
    typeof gameState.matchStats
      .eliminationRounds !==
      "object"
  ) {
    gameState.matchStats
      .eliminationRounds = {};
  }

  if (
    !Object.prototype.hasOwnProperty.call(
      gameState.matchStats,
      "finalResults",
    )
  ) {
    gameState.matchStats
      .finalResults = null;
  }

  if (
    typeof gameState.matchStats
      .applied !== "boolean"
  ) {
    gameState.matchStats
      .applied = false;
  }
}


function resolveNight() {
  ensureMatchStatsStructure();

  const victim =
    gameState.assignedPlayers.find(
      (player) =>
        player.id ===
        gameState.nightAction
          .victimId,
    ) ?? null;

  const nurse =
    getAliveRolePlayer(
      ROLE_IDS.NURSE,
    );

  const wasSaved =
    Boolean(victim) &&
    gameState.nightAction
      .victimId ===
      gameState.nightAction
        .savedPlayerId;

  if (victim && wasSaved) {
    const saveAlreadyRecorded =
      gameState.matchStats
        .successfulNurseSaves
        .some((record) => {
          return (
            record.round ===
              gameState.roundNumber &&
            record.nurseId ===
              nurse?.id &&
            record.targetId ===
              victim.id
          );
        });

    if (!saveAlreadyRecorded) {
      gameState.matchStats
        .successfulNurseSaves
        .push({
          round:
            gameState.roundNumber,

          nurseId:
            nurse?.id ?? null,

          targetId:
            victim.id,
        });

      addTimelineEvent(
        gameState,
        {
          type:
            "nurse-save",

          title:
            `أنقذت الممرضة ${victim.name}`,

          description:
            "نجحت الممرضة في حماية هدف اللصوص، ولم يخرج أحد هذه الليلة.",

          icon: "🩺",

          round:
            gameState.roundNumber,

          phase: "night",

          playerId:
            nurse?.id ?? null,

          targetId:
            victim.id,
        },
      );
    }
  }

  if (victim && !wasSaved) {
    victim.alive = false;

    victim.eliminatedRound =
      gameState.roundNumber;

    gameState.matchStats
      .eliminationRounds[
        victim.id
      ] = gameState.roundNumber;

    addTimelineEvent(
      gameState,
      {
        type:
          "night-kill",

        title:
          `اغتال اللصوص ${victim.name}`,

        description:
          "تم إخراج اللاعب خلال مرحلة الليل.",

        icon: "🗡️",

        round:
          gameState.roundNumber,

        phase: "night",

        targetId:
          victim.id,
      },
    );
  }

  /*
   * الاحتفاظ باختيارات الليلة لاستخدام
   * قواعد منع التكرار في الجولة القادمة.
   */
  gameState.previousNightActions = {
    victimId:
      gameState.nightAction
        .victimId ?? null,

    savedPlayerId:
      gameState.nightAction
        .savedPlayerId ?? null,

    inspectedPlayerId:
      gameState.nightAction
        .inspectedPlayerId ?? null,

    round:
      gameState.roundNumber,
  };

  gameState.lastNightAction = {
    ...gameState.previousNightActions,
  };

  setGamePhase(
    GAME_PHASES.NIGHT_RESULT,
    false,
  );

  saveGame();

  renderNightResultPage(
    victim,
    wasSaved,
  );
}


function renderNightResultPage(
  victim,
  wasSaved,
) {
  setCurrentScreen(
    GAME_PHASES.NIGHT_RESULT,
  );

  const noVictimSelected =
    !victim;

  let resultContent = "";

  if (wasSaved) {
    resultContent = `
      <div class="night-result-icon">
        🛡️
      </div>

      <h1>
        لم يمت أحد هذه الليلة
      </h1>

      <p class="night-victim-name">
        ${escapeHtml(
          victim?.name ?? "",
        )}
      </p>

      <p class="night-description">
        نجحت الممرضة في حماية هدف
        اللصوص في اللحظة المناسبة.
      </p>
    `;
  } else if (noVictimSelected) {
    resultContent = `
      <div class="night-result-icon">
        🌅
      </div>

      <h1>
        مرّت الليلة بسلام
      </h1>

      <p class="night-description">
        لم يتم اختيار ضحية خلال هذه
        الليلة، ولم يخرج أي لاعب.
      </p>
    `;
  } else {
    resultContent = `
      <div class="night-result-icon">
        🕯️
      </div>

      <h1>
        خرج لاعب من اللعبة
      </h1>

      <p class="night-victim-name">
        ${escapeHtml(
          victim.name,
        )}
      </p>

      <p class="night-description">
        تم اغتياله أثناء الليل.
        لا يتم كشف شخصيته لبقية
        اللاعبين.
      </p>
    `;
  }

  app.innerHTML = `
    <main
      class="night-page result-night"
    >
      <div
        class="night-background-glow night-background-glow-purple"
      ></div>

      <section class="night-card">
        <img
          class="night-logo"
          src="/logo.png"
          alt="شعار مافيا"
        />

        <p class="night-round">
          انتهت الليلة
          ${gameState.roundNumber}
        </p>

        ${resultContent}

        <button
          class="night-primary-button"
          id="startDayButton"
          type="button"
        >
          بدء مرحلة النهار
        </button>
      </section>
    </main>
  `;

  const startDayButton =
    document.querySelector(
      "#startDayButton",
    );

  startDayButton?.addEventListener(
    "click",
    () => {
      const winner =
        checkGameWinner();

      if (winner) {
        renderGameOverPage(
          winner,
        );

        return;
      }

      transitionTo(
        GAME_PHASES.DAY_DISCUSSION,
      );
    },
  );
}


function stopActiveTimer() {
  const intervalId =
    gameState.timer
      ?.intervalId;

  if (intervalId) {
    window.clearInterval(
      intervalId,
    );
  }

  if (!gameState.timer) {
    gameState.timer = {
      remainingSeconds: 0,
      isPaused: false,
      intervalId: null,
      discussionRound: null,
    };

    return;
  }

  gameState.timer.intervalId =
    null;
}
function renderDayPage() {
  setCurrentScreen(
    GAME_PHASES.DAY_DISCUSSION,
  );

  stopActiveTimer();

  if (!gameState.timer) {
    gameState.timer = {
      remainingSeconds:
        gameState.settings
          .discussionDuration,

      isPaused: false,
      intervalId: null,
      discussionRound: null,
    };
  }

  const remainingSeconds =
    Number(
      gameState.timer
        .remainingSeconds,
    );

  const remainingSecondsIsValid =
    Number.isFinite(
      remainingSeconds,
    );

  const isNewDiscussionRound =
    gameState.timer
      .discussionRound !==
      gameState.roundNumber ||
    !remainingSecondsIsValid;

  if (isNewDiscussionRound) {
    gameState.timer
      .remainingSeconds =
      gameState.settings
        .discussionDuration;

    gameState.timer.isPaused =
      false;

    gameState.timer
      .discussionRound =
      gameState.roundNumber;

    saveGame();
  }

  const alivePlayers =
    getAlivePlayers();

  const deadPlayers =
    gameState.assignedPlayers.filter(
      (player) => !player.alive,
    );

  const timerIsFinished =
    gameState.timer
      .remainingSeconds <= 0;

  const timerStatusText =
    timerIsFinished
      ? "انتهى وقت النقاش"
      : gameState.timer.isPaused
        ? "المؤقت متوقف مؤقتًا"
        : "النقاش جارٍ الآن";

  const pauseButtonText =
    gameState.timer.isPaused
      ? "استكمال المؤقت"
      : "إيقاف المؤقت";

  app.innerHTML = `
    <main class="day-page">
      <div
        class="day-sun"
        aria-hidden="true"
      >
        ☀️
      </div>

      <header class="day-header">
        <div class="setup-brand">
          <img
            src="/logo.png"
            alt="شعار مافيا"
          />

          <span>
            الجولة
            ${gameState.roundNumber}
          </span>
        </div>

        <div class="day-status">
          <span>
            المرحلة الحالية
          </span>

          <strong>
            النقاش النهاري
          </strong>
        </div>
      </header>

      <section class="day-layout">
        <div class="discussion-panel">
          <div class="day-heading">
            <p>
              استيقظت المدينة
            </p>

            <h1>
              ابدؤوا النقاش
            </h1>

            <span>
              ناقشوا أحداث الليلة،
              وحاولوا تحديد هوية اللصوص
              قبل بدء التصويت.
            </span>
          </div>

          ${
            gameState.settings.showTimer
              ? `
                <div
                  class="discussion-timer"
                  id="discussionTimer"
                >
                  <div
                    class="timer-progress-ring"
                    id="timerProgressRing"
                    role="timer"
                    aria-live="polite"
                    aria-label="الوقت المتبقي للنقاش"
                  >
                    <div
                      class="timer-progress-ring-track"
                    ></div>

                    <div
                      class="timer-progress-ring-value"
                    ></div>

                    <div
                      class="timer-content"
                    >
                      <span>
                        الوقت المتبقي
                      </span>

                      <strong
                        id="discussionTimerValue"
                      >
                        ${formatTimerValue(
                          gameState.timer
                            .remainingSeconds,
                        )}
                      </strong>

                      <small
                        id="discussionTimerStatus"
                      >
                        ${timerStatusText}
                      </small>
                    </div>
                  </div>

                  <div
                    class="discussion-progress"
                    aria-hidden="true"
                  >
                    <span
                      class="discussion-progress-bar"
                      id="discussionProgressBar"
                    ></span>
                  </div>

                  <div
                    class="timer-actions"
                  >
                    <button
                      class="pause-timer-button ${
                        gameState.timer.isPaused
                          ? "timer-paused"
                          : ""
                      }"
                      id="pauseTimerButton"
                      type="button"
                      ${
                        timerIsFinished
                          ? "disabled"
                          : ""
                      }
                    >
                      ${pauseButtonText}
                    </button>

                    <button
                      class="finish-discussion-button"
                      id="finishDiscussionButton"
                      type="button"
                    >
                      إنهاء النقاش والتصويت
                    </button>
                  </div>

                  <p
                    class="discussion-message"
                    id="discussionMessage"
                    aria-live="polite"
                  >
                    ${
                      timerIsFinished
                        ? "انتهى وقت النقاش. يمكنكم الانتقال إلى التصويت."
                        : ""
                    }
                  </p>
                </div>
              `
              : `
                <div
                  class="discussion-without-timer"
                >
                  <div
                    class="discussion-without-timer-icon"
                  >
                    💬
                  </div>

                  <h2>
                    ناقشوا بهدوء
                  </h2>

                  <p>
                    المؤقت غير ظاهر وفق
                    إعدادات اللعبة. انتقلوا
                    إلى التصويت عندما ينتهي
                    النقاش.
                  </p>

                  <button
                    class="finish-discussion-button"
                    id="finishDiscussionButton"
                    type="button"
                  >
                    إنهاء النقاش والتصويت
                  </button>
                </div>
              `
          }
        </div>

        <aside class="day-players-panel">
          <div class="day-players-heading">
            <div>
              <p>
                حالة المدينة
              </p>

              <h2>
                اللاعبون
              </h2>
            </div>

            <span>
              ${alivePlayers.length}
              أحياء
            </span>
          </div>

          <div class="alive-players-list">
            <h3>
              اللاعبون الأحياء
            </h3>

            ${alivePlayers
              .map(
                (
                  player,
                  index,
                ) => `
                  <div
                    class="day-player-item"
                  >
                    <span
                      class="day-player-number"
                    >
                      ${index + 1}
                    </span>

                    <strong>
                      ${escapeHtml(
                        player.name,
                      )}
                    </strong>

                    <span
                      class="alive-badge"
                    >
                      حي
                    </span>
                  </div>
                `,
              )
              .join("")}
          </div>

          ${
            deadPlayers.length > 0
              ? `
                <div
                  class="eliminated-players-list"
                >
                  <h3>
                    اللاعبون الخارجون
                  </h3>

                  ${deadPlayers
                    .map(
                      (player) => `
                        <div
                          class="day-player-item eliminated"
                        >
                          <span
                            class="day-player-number"
                          >
                            ×
                          </span>

                          <strong>
                            ${escapeHtml(
                              player.name,
                            )}
                          </strong>

                          <span
                            class="eliminated-badge"
                          >
                            خارج
                          </span>
                        </div>
                      `,
                    )
                    .join("")}
                </div>
              `
              : ""
          }
        </aside>
      </section>
    </main>
  `;

  bindDayPageEvents();

  if (
    gameState.settings.showTimer &&
    gameState.timer
      .remainingSeconds > 0
  ) {
    startDiscussionTimer();
  } else {
    updateDiscussionTimerDisplay();
  }
}


function bindDayPageEvents() {
  const pauseButton =
    document.querySelector(
      "#pauseTimerButton",
    );

  const finishButton =
    document.querySelector(
      "#finishDiscussionButton",
    );

  pauseButton?.addEventListener(
    "click",
    () => {
      if (
        gameState.timer
          .remainingSeconds <= 0
      ) {
        return;
      }

      gameState.timer.isPaused =
        !gameState.timer.isPaused;

      pauseButton.textContent =
        gameState.timer.isPaused
          ? "استكمال المؤقت"
          : "إيقاف المؤقت";

      pauseButton.classList.toggle(
        "timer-paused",
        gameState.timer.isPaused,
      );

      updateDiscussionTimerDisplay();
      saveGame();
    },
  );

  finishButton?.addEventListener(
    "click",
    () => {
      stopActiveTimer();

      gameState.timer.isPaused =
        true;

      saveGame();

      transitionTo(
        GAME_PHASES
          .VOTING_PREPARATION,
      );
    },
  );
}


function startDiscussionTimer() {
  stopActiveTimer();

  if (
    !gameState.settings.showTimer ||
    gameState.timer
      .remainingSeconds <= 0
  ) {
    updateDiscussionTimerDisplay();
    return;
  }

  updateDiscussionTimerDisplay();

  gameState.timer.intervalId =
    window.setInterval(
      () => {
        if (
          gameState.timer.isPaused
        ) {
          return;
        }

        gameState.timer
          .remainingSeconds =
          Math.max(
            0,
            gameState.timer
              .remainingSeconds - 1,
          );

        updateDiscussionTimerDisplay();

        /*
         * يتم الحفظ كل خمس ثوانٍ
         * لتقليل عمليات localStorage
         * مع ضمان استعادة الوقت بدقة.
         */
        if (
          gameState.timer
            .remainingSeconds %
            5 ===
          0
        ) {
          saveGame();
        }

        if (
          gameState.timer
            .remainingSeconds <= 0
        ) {
          stopActiveTimer();
          handleDiscussionTimerEnd();
        }
      },
      1000,
    );
}


function updateDiscussionTimerDisplay() {
  if (!gameState.timer) {
    return;
  }

  const timerValue =
    document.querySelector(
      "#discussionTimerValue",
    );

  const timerStatus =
    document.querySelector(
      "#discussionTimerStatus",
    );

  const progressRing =
    document.querySelector(
      "#timerProgressRing",
    );

  const progressBar =
    document.querySelector(
      "#discussionProgressBar",
    );

  const pauseButton =
    document.querySelector(
      "#pauseTimerButton",
    );

  const totalDuration =
    Math.max(
      1,
      Number(
        gameState.settings
          .discussionDuration,
      ) || 1,
    );

  const remainingSeconds =
    Math.max(
      0,
      Number(
        gameState.timer
          .remainingSeconds,
      ) || 0,
    );

  const progressPercentage =
    Math.min(
      100,
      Math.max(
        0,
        (remainingSeconds /
          totalDuration) *
          100,
      ),
    );

  if (timerValue) {
    timerValue.textContent =
      formatTimerValue(
        remainingSeconds,
      );
  }

  if (timerStatus) {
    if (remainingSeconds <= 0) {
      timerStatus.textContent =
        "انتهى وقت النقاش";
    } else if (
      gameState.timer.isPaused
    ) {
      timerStatus.textContent =
        "المؤقت متوقف مؤقتًا";
    } else {
      timerStatus.textContent =
        "النقاش جارٍ الآن";
    }
  }

  if (progressRing) {
    progressRing.style.setProperty(
      "--timer-progress",
      `${progressPercentage}%`,
    );

    progressRing.classList.remove(
      "timer-normal",
      "timer-warning",
      "timer-danger",
      "timer-finished",
      "timer-is-paused",
    );

    if (remainingSeconds <= 0) {
      progressRing.classList.add(
        "timer-finished",
      );
    } else if (
      remainingSeconds <= 10
    ) {
      progressRing.classList.add(
        "timer-danger",
      );
    } else if (
      remainingSeconds <=
      totalDuration * 0.3
    ) {
      progressRing.classList.add(
        "timer-warning",
      );
    } else {
      progressRing.classList.add(
        "timer-normal",
      );
    }

    progressRing.classList.toggle(
      "timer-is-paused",
      gameState.timer.isPaused &&
        remainingSeconds > 0,
    );
  }

  if (progressBar) {
    progressBar.style.width =
      `${progressPercentage}%`;

    progressBar.classList.remove(
      "progress-normal",
      "progress-warning",
      "progress-danger",
      "progress-finished",
    );

    if (remainingSeconds <= 0) {
      progressBar.classList.add(
        "progress-finished",
      );
    } else if (
      remainingSeconds <= 10
    ) {
      progressBar.classList.add(
        "progress-danger",
      );
    } else if (
      remainingSeconds <=
      totalDuration * 0.3
    ) {
      progressBar.classList.add(
        "progress-warning",
      );
    } else {
      progressBar.classList.add(
        "progress-normal",
      );
    }
  }

  if (pauseButton) {
    pauseButton.disabled =
      remainingSeconds <= 0;

    pauseButton.textContent =
      gameState.timer.isPaused
        ? "استكمال المؤقت"
        : "إيقاف المؤقت";

    pauseButton.classList.toggle(
      "timer-paused",
      gameState.timer.isPaused,
    );
  }
}


function handleDiscussionTimerEnd() {
  gameState.timer
    .remainingSeconds = 0;

  gameState.timer.isPaused =
    true;

  const message =
    document.querySelector(
      "#discussionMessage",
    );

  const pauseButton =
    document.querySelector(
      "#pauseTimerButton",
    );

  if (message) {
    message.textContent =
      "انتهى وقت النقاش. انتقلوا الآن إلى التصويت.";

    message.classList.add(
      "discussion-message-visible",
    );
  }

  if (pauseButton) {
    pauseButton.disabled = true;
  }

  updateDiscussionTimerDisplay();
  saveGame();

  if (
    gameState.settings
      .vibrationEnabled &&
    "vibrate" in navigator
  ) {
    navigator.vibrate([
      250,
      120,
      250,
    ]);
  }

  if (
    gameState.soundEnabled
  ) {
    playTimerEndSound();
  }
}


function playTimerEndSound() {
  try {
    const audioContextClass =
      window.AudioContext ??
      window.webkitAudioContext;

    if (!audioContextClass) {
      return;
    }

    const audioContext =
      new audioContextClass();

    const oscillator =
      audioContext
        .createOscillator();

    const gainNode =
      audioContext
        .createGain();

    oscillator.type =
      "sine";

    oscillator.frequency
      .setValueAtTime(
        740,
        audioContext.currentTime,
      );

    oscillator.frequency
      .exponentialRampToValueAtTime(
        440,
        audioContext.currentTime +
          0.45,
      );

    gainNode.gain
      .setValueAtTime(
        0.0001,
        audioContext.currentTime,
      );

    gainNode.gain
      .exponentialRampToValueAtTime(
        0.16,
        audioContext.currentTime +
          0.04,
      );

    gainNode.gain
      .exponentialRampToValueAtTime(
        0.0001,
        audioContext.currentTime +
          0.5,
      );

    oscillator.connect(gainNode);
    gainNode.connect(
      audioContext.destination,
    );

    oscillator.start();
    oscillator.stop(
      audioContext.currentTime +
        0.52,
    );

    oscillator.addEventListener(
      "ended",
      () => {
        audioContext.close()
          .catch(() => {});
      },
      {
        once: true,
      },
    );
  } catch (error) {
    console.warn(
      "تعذر تشغيل صوت انتهاء المؤقت:",
      error,
    );
  }
}


function formatTimerValue(
  totalSeconds,
) {
  const safeSeconds =
    Math.max(
      0,
      Math.floor(
        Number(totalSeconds) || 0,
      ),
    );

  const minutes =
    Math.floor(
      safeSeconds / 60,
    );

  const seconds =
    safeSeconds % 60;

  return `${String(
    minutes,
  ).padStart(
    2,
    "0",
  )}:${String(
    seconds,
  ).padStart(
    2,
    "0",
  )}`;
}


function renderVotingPreparationPage() {
  setCurrentScreen(
    GAME_PHASES
      .VOTING_PREPARATION,
  );

  stopActiveTimer();

  const alivePlayers =
    getAlivePlayers();

  app.innerHTML = `
    <main
      class="day-page voting-preparation-page"
    >
      <div
        class="background-orb background-orb-purple"
      ></div>

      <div
        class="background-orb background-orb-green"
      ></div>

      <section
        class="voting-preparation-card"
      >
        <div
          class="voting-preparation-icon"
        >
          🗳️
        </div>

        <p>
          انتهت مرحلة النقاش
        </p>

        <h1>
          استعدوا للتصويت
        </h1>

        <span>
          سيصوّت كل لاعب حي سرًا
          لاختيار الشخص الذي يعتقد
          أنه لص، أو يمكنه الامتناع
          عن التصويت.
        </span>

        <div
          class="voting-preparation-summary"
        >
          <div>
            <span>
              عدد المصوتين
            </span>

            <strong>
              ${alivePlayers.length}
            </strong>
          </div>

          <div>
            <span>
              الجولة
            </span>

            <strong>
              ${gameState.roundNumber}
            </strong>
          </div>
        </div>

        <div
          class="voting-preparation-warning"
        >
          <span>
            🔒
          </span>

          <p>
            يجب أن ينظر كل لاعب إلى
            الشاشة منفردًا أثناء اختياره.
          </p>
        </div>

        <button
          class="finish-discussion-button"
          id="startVotingButton"
          type="button"
          ${
            alivePlayers.length === 0
              ? "disabled"
              : ""
          }
        >
          بدء التصويت
        </button>

        <button
          class="pause-timer-button"
          id="returnToDiscussionButton"
          type="button"
        >
          العودة إلى النقاش
        </button>
      </section>
    </main>
  `;

  document
    .querySelector(
      "#returnToDiscussionButton",
    )
    ?.addEventListener(
      "click",
      () => {
        gameState.timer.isPaused =
          true;

        saveGame();

        transitionTo(
          GAME_PHASES
            .DAY_DISCUSSION,
        );
      },
    );

  document
    .querySelector(
      "#startVotingButton",
    )
    ?.addEventListener(
      "click",
      startVoting,
    );
}


function startVoting() {
  stopActiveTimer();

  const alivePlayers =
    getAlivePlayers();

  if (alivePlayers.length === 0) {
    showErrorToast(
      "لا يوجد لاعبون أحياء يمكنهم التصويت.",
      "تعذر بدء التصويت",
    );

    return;
  }

  gameState.voting = {
    voterIndex: 0,
    votes: [],
    round:
      gameState.roundNumber,
  };

  saveGame();

  transitionTo(
    GAME_PHASES.VOTING_HANDOFF,
  );
}


function getAlivePlayers() {
  return gameState
    .assignedPlayers
    .filter(
      (player) => player.alive,
    );
}


function getCurrentVoter() {
  const alivePlayers =
    getAlivePlayers();

  const voterIndex =
    Number(
      gameState.voting
        ?.voterIndex,
    ) || 0;

  return (
    alivePlayers[
      voterIndex
    ] ?? null
  );
}


function renderVotingHandoffPage() {
  setCurrentScreen(
    GAME_PHASES.VOTING_HANDOFF,
  );

  const voter =
    getCurrentVoter();

  if (!voter) {
    setGamePhase(
      GAME_PHASES.VOTING_RESULT,
    );

    renderVotingResultsPage();

    return;
  }

  const voterPosition =
    gameState.voting
      .voterIndex + 1;

  const totalVoters =
    getAlivePlayers().length;

  app.innerHTML = `
    <main class="voting-page">
      <header class="voting-header">
        <div class="setup-brand">
          <img
            src="/logo.png"
            alt="شعار مافيا"
          />

          <span>
            التصويت
          </span>
        </div>

        <span
          class="voting-progress"
        >
          ${voterPosition}
          من
          ${totalVoters}
        </span>
      </header>

      <section
        class="voting-handoff-card"
      >
        <div
          class="voting-main-icon"
        >
          📱
        </div>

        <p class="voting-label">
          سلّم الجهاز إلى
        </p>

        <h1>
          ${escapeHtml(
            voter.name,
          )}
        </h1>

        <p
          class="voting-description"
        >
          تأكد أن
          ${escapeHtml(
            voter.name,
          )}
          وحده ينظر إلى الشاشة قبل
          إظهار قائمة التصويت.
        </p>

        <div
          class="voting-privacy-warning"
        >
          <span>
            🔒
          </span>

          <p>
            التصويت سري ولا تظهر
            اختيارات اللاعبين الآخرين.
          </p>
        </div>

        <button
          class="voting-primary-button"
          id="showVotingButton"
          type="button"
        >
          أنا
          ${escapeHtml(
            voter.name,
          )}،
          ابدأ التصويت
        </button>
      </section>
    </main>
  `;

  document
    .querySelector(
      "#showVotingButton",
    )
    ?.addEventListener(
      "click",
      () => {
        transitionTo(
          GAME_PHASES
            .VOTING_SELECTION,
        );
      },
    );
}


function renderCurrentVoterPage() {
  setCurrentScreen(
    GAME_PHASES
      .VOTING_SELECTION,
  );

  const voter =
    getCurrentVoter();

  if (!voter) {
    setGamePhase(
      GAME_PHASES.VOTING_RESULT,
    );

    renderVotingResultsPage();

    return;
  }

  const alivePlayers =
    getAlivePlayers();

  const eligibleTargets =
    alivePlayers.filter(
      (player) =>
        player.id !== voter.id,
    );

  app.innerHTML = `
    <main class="voting-page">
      <header class="voting-header">
        <div class="setup-brand">
          <img
            src="/logo.png"
            alt="شعار مافيا"
          />

          <span>
            تصويت
            ${escapeHtml(
              voter.name,
            )}
          </span>
        </div>

        <span
          class="voting-progress"
        >
          الجولة
          ${gameState.roundNumber}
        </span>
      </header>

      <section
        class="voting-selection-card"
      >
        <p class="voting-label">
          اختيار سري
        </p>

        <h1>
          من تعتقد أنه اللص؟
        </h1>

        <p
          class="voting-description"
        >
          اختر لاعبًا واحدًا، أو اختر
          الامتناع عن التصويت.
          لا يمكنك التصويت لنفسك.
        </p>

        <div
          class="vote-options-grid"
        >
          ${eligibleTargets
            .map((player) => {
              const playerInitial =
                String(
                  player.name ?? "?",
                )
                  .trim()
                  .charAt(0)
                  .toUpperCase();

              return `
                <button
                  class="vote-player-option"
                  type="button"
                  data-vote-target="${escapeHtml(
                    player.id,
                  )}"
                  aria-pressed="false"
                >
                  <span
                    class="vote-player-avatar"
                  >
                    ${escapeHtml(
                      playerInitial,
                    )}
                  </span>

                  <strong>
                    ${escapeHtml(
                      player.name,
                    )}
                  </strong>

                  <small>
                    اختيار هذا اللاعب
                  </small>
                </button>
              `;
            })
            .join("")}

          <button
            class="vote-player-option abstain-option"
            type="button"
            data-vote-target="abstain"
            aria-pressed="false"
          >
            <span
              class="vote-player-avatar"
            >
              ✋
            </span>

            <strong>
              الامتناع
            </strong>

            <small>
              عدم اختيار أي لاعب
            </small>
          </button>
        </div>

        <p
          class="voting-message"
          id="votingMessage"
          aria-live="polite"
        ></p>

        <button
          class="voting-primary-button"
          id="confirmVoteButton"
          type="button"
          disabled
        >
          تأكيد التصويت
        </button>
      </section>
    </main>
  `;

  bindCurrentVoteEvents(voter);
}


function bindCurrentVoteEvents(
  voter,
) {
  const options =
    document.querySelectorAll(
      "[data-vote-target]",
    );

  const confirmButton =
    document.querySelector(
      "#confirmVoteButton",
    );

  const votingMessage =
    document.querySelector(
      "#votingMessage",
    );

  let selectedTargetId =
    null;

  options.forEach((option) => {
    option.addEventListener(
      "click",
      () => {
        selectedTargetId =
          option.dataset.voteTarget ??
          null;

        options.forEach(
          (item) => {
            item.classList.remove(
              "selected",
            );

            item.setAttribute(
              "aria-pressed",
              "false",
            );
          },
        );

        option.classList.add(
          "selected",
        );

        option.setAttribute(
          "aria-pressed",
          "true",
        );

        if (confirmButton) {
          confirmButton.disabled =
            false;
        }

        if (votingMessage) {
          votingMessage.textContent =
            "";
        }
      },
    );
  });

  confirmButton?.addEventListener(
    "click",
    () => {
      if (!selectedTargetId) {
        if (votingMessage) {
          votingMessage.textContent =
            "اختر لاعبًا أو اختر الامتناع.";
        }

        return;
      }

      const voteAlreadyExists =
        gameState.voting.votes.some(
          (vote) =>
            vote.voterId ===
            voter.id,
        );

      if (voteAlreadyExists) {
        showWarningToast(
          "تم تسجيل تصويت هذا اللاعب مسبقًا.",
          "تصويت مكرر",
        );

        return;
      }

      const targetIsValid =
        selectedTargetId ===
          "abstain" ||
        gameState
          .assignedPlayers
          .some((player) => {
            return (
              player.id ===
                selectedTargetId &&
              player.alive &&
              player.id !==
                voter.id
            );
          });

      if (!targetIsValid) {
        if (votingMessage) {
          votingMessage.textContent =
            "الاختيار غير متاح. اختر لاعبًا آخر.";
        }

        return;
      }

      confirmButton.disabled =
        true;

      gameState.voting.votes.push({
        voterId: voter.id,
        targetId:
          selectedTargetId,
        round:
          gameState.roundNumber,
      });

      const selectedPlayer =
        gameState
          .assignedPlayers
          .find(
            (player) =>
              player.id ===
              selectedTargetId,
          );

      recordPlayerVote({
        gameState,

        round:
          gameState.roundNumber,

        voterId:
          voter.id,

        targetId:
          selectedTargetId,

        targetRole:
          selectedPlayer?.role ??
          null,
      });

      addTimelineEvent(
        gameState,
        {
          type: "vote",

          title:
            `${voter.name} أدلى بصوته`,

          description:
            selectedTargetId ===
            "abstain"
              ? "اختار اللاعب الامتناع عن التصويت."
              : "تم تسجيل اختيار اللاعب بصورة سرية.",

          icon: "🗳️",

          round:
            gameState.roundNumber,

          phase: "voting",

          playerId:
            voter.id,

          targetId:
            selectedTargetId ===
            "abstain"
              ? null
              : selectedTargetId,
        },
      );

      gameState.voting
        .voterIndex += 1;

      saveGame();

      transitionTo(
        GAME_PHASES.VOTE_SAVED,
      );
    },
  );
}


function renderVoteSavedPage() {
  setCurrentScreen(
    GAME_PHASES.VOTE_SAVED,
  );

  const nextVoter =
    getCurrentVoter();

  app.innerHTML = `
    <main class="voting-page">
      <section
        class="vote-saved-card"
      >
        <div
          class="vote-saved-icon"
        >
          🔒
        </div>

        <p class="voting-label">
          تصويت سري
        </p>

        <h1>
          تم تسجيل التصويت
        </h1>

        <p>
          تم حفظ الاختيار بنجاح.
          أخفِ الشاشة قبل تسليم الجهاز
          إلى اللاعب التالي.
        </p>

        <button
          class="voting-primary-button"
          id="nextVoterButton"
          type="button"
        >
          ${
            nextVoter
              ? "الانتقال إلى اللاعب التالي"
              : "عرض نتيجة التصويت"
          }
        </button>
      </section>
    </main>
  `;

  const nextVoterButton =
    document.querySelector(
      "#nextVoterButton",
    );

  nextVoterButton?.addEventListener(
    "click",
    () => {
      const currentNextVoter =
        getCurrentVoter();

      if (currentNextVoter) {
        transitionTo(
          GAME_PHASES
            .VOTING_HANDOFF,
        );

        return;
      }

      setGamePhase(
        GAME_PHASES
          .VOTING_RESULT,
      );

      renderVotingResultsPage();
    },
  );
}


function calculateVotingResult() {
  const counts = new Map();

  const votes =
    Array.isArray(
      gameState.voting?.votes,
    )
      ? gameState.voting.votes
      : [];

  votes.forEach((vote) => {
    if (!vote?.targetId) {
      return;
    }

    const currentCount =
      counts.get(
        vote.targetId,
      ) ?? 0;

    counts.set(
      vote.targetId,
      currentCount + 1,
    );
  });

  const results =
    [...counts.entries()]
      .sort(
        (
          firstResult,
          secondResult,
        ) => {
          return (
            secondResult[1] -
            firstResult[1]
          );
        },
      );

  if (results.length === 0) {
    return {
      outcome: "no-votes",
      eliminatedPlayer: null,
      highestVotes: 0,
      tiedTargetIds: [],
      counts,
    };
  }

  const highestVotes =
    results[0][1];

  const highestTargets =
    results
      .filter(
        (result) =>
          result[1] ===
          highestVotes,
      )
      .map(
        (result) =>
          result[0],
      );

  if (
    highestTargets.length === 1 &&
    highestTargets[0] ===
      "abstain"
  ) {
    return {
      outcome: "abstain",
      eliminatedPlayer: null,
      highestVotes,
      tiedTargetIds: [],
      counts,
    };
  }

  if (
    highestTargets.length > 1
  ) {
    return {
      outcome: "tie",
      eliminatedPlayer: null,
      highestVotes,
      tiedTargetIds:
        highestTargets,

      counts,
    };
  }

  const eliminatedPlayer =
    gameState
      .assignedPlayers
      .find((player) => {
        return (
          player.id ===
          highestTargets[0] &&
          player.alive
        );
      }) ?? null;

  if (!eliminatedPlayer) {
    return {
      outcome:
        "invalid-target",

      eliminatedPlayer: null,
      highestVotes,
      tiedTargetIds: [],
      counts,
    };
  }

  return {
    outcome: "eliminated",
    eliminatedPlayer,
    highestVotes,
    tiedTargetIds: [],
    counts,
  };
}
function renderVotingResultsPage() {
  setCurrentScreen(
    GAME_PHASES.VOTING_RESULT,
  );

  ensureMatchStatsStructure();

  const result =
    calculateVotingResult();

  if (
    result.outcome ===
      "eliminated" &&
    result.eliminatedPlayer
  ) {
    const eliminatedPlayer =
      result.eliminatedPlayer;

    /*
     * منع تسجيل الإقصاء مرتين إذا تمت
     * إعادة تحميل صفحة النتيجة.
     */
    if (eliminatedPlayer.alive) {
      eliminatedPlayer.alive =
        false;

      eliminatedPlayer
        .eliminatedRound =
        gameState.roundNumber;

      gameState.matchStats
        .eliminationRounds[
          eliminatedPlayer.id
        ] = gameState.roundNumber;

      addTimelineEvent(
        gameState,
        {
          type:
            "player-eliminated",

          title:
            `خرج ${eliminatedPlayer.name} من اللعبة`,

          description:
            "تم إخراج اللاعب بعد حصوله على أعلى عدد من الأصوات.",

          icon: "❌",

          round:
            gameState.roundNumber,

          phase: "voting",

          playerId:
            eliminatedPlayer.id,
        },
      );

      saveGame();
    }
  }

  app.innerHTML = `
    <main
      class="voting-page voting-result-page"
    >
      <section
        class="voting-results-card"
      >
        <img
          class="voting-result-logo"
          src="/logo.png"
          alt="شعار مافيا"
        />

        <p class="voting-label">
          نتيجة تصويت الجولة
          ${gameState.roundNumber}
        </p>

        ${renderVotingOutcome(
          result,
        )}

        <div
          class="vote-counts-list"
        >
          ${renderVoteCounts(
            result.counts,
          )}
        </div>

        <button
          class="voting-primary-button"
          id="continueAfterVotingButton"
          type="button"
        >
          متابعة
        </button>
      </section>
    </main>
  `;

  document
    .querySelector(
      "#continueAfterVotingButton",
    )
    ?.addEventListener(
      "click",
      () => {
        const winner =
          checkGameWinner();

        if (winner) {
          setGamePhase(
            GAME_PHASES.GAME_OVER,
          );

          renderGameOverPage(
            winner,
          );

          return;
        }

        gameState.roundNumber +=
          1;

        addTimelineEvent(
          gameState,
          {
            type:
              "round-start",

            title:
              `بدأت الجولة ${gameState.roundNumber}`,

            description:
              "بدأت جولة جديدة.",

            icon: "🔄",

            round:
              gameState.roundNumber,

            phase: "night",
          },
        );

        saveGame();
        startNight();
      },
    );
}


function renderVotingOutcome(
  result,
) {
  if (
    result.outcome ===
    "abstain"
  ) {
    return `
      <div
        class="voting-outcome-icon"
      >
        ✋
      </div>

      <h1>
        تم الامتناع
      </h1>

      <p
        class="voting-description"
      >
        حصل خيار الامتناع على أعلى
        عدد من الأصوات. لم يخرج أي
        لاعب.
      </p>
    `;
  }

  if (
    result.outcome === "tie"
  ) {
    return `
      <div
        class="voting-outcome-icon"
      >
        ⚖️
      </div>

      <h1>
        تعادل في الأصوات
      </h1>

      <p
        class="voting-description"
      >
        تساوى أكثر من اختيار في أعلى
        عدد من الأصوات. لم يخرج أي
        لاعب.
      </p>
    `;
  }

  if (
    result.outcome ===
      "eliminated" &&
    result.eliminatedPlayer
  ) {
    return `
      <div
        class="voting-outcome-icon"
      >
        🚪
      </div>

      <h1>
        خرج لاعب من اللعبة
      </h1>

      <p
        class="voted-player-name"
      >
        ${escapeHtml(
          result
            .eliminatedPlayer
            .name,
        )}
      </p>

      <p
        class="voting-description"
      >
        حصل على
        ${result.highestVotes}
        من الأصوات. لن يتم كشف
        شخصيته أثناء استمرار اللعبة.
      </p>
    `;
  }

  if (
    result.outcome ===
    "invalid-target"
  ) {
    return `
      <div
        class="voting-outcome-icon"
      >
        ⚠️
      </div>

      <h1>
        تعذر إخراج اللاعب
      </h1>

      <p
        class="voting-description"
      >
        لم يعد اللاعب صاحب أعلى
        الأصوات متاحًا داخل الجولة.
        لم يخرج أي لاعب.
      </p>
    `;
  }

  return `
    <div
      class="voting-outcome-icon"
    >
      🗳️
    </div>

    <h1>
      لم تسجل أصوات
    </h1>

    <p
      class="voting-description"
    >
      لم يخرج أي لاعب من هذه الجولة.
    </p>
  `;
}


function renderVoteCounts(
  counts,
) {
  const safeCounts =
    counts instanceof Map
      ? counts
      : new Map();

  const playerRows =
    gameState.assignedPlayers
      .map((player) => {
        return {
          id: player.id,
          name: player.name,

          count:
            safeCounts.get(
              player.id,
            ) ?? 0,
        };
      })
      .filter(
        (item) =>
          item.count > 0,
      );

  const abstainCount =
    safeCounts.get(
      "abstain",
    ) ?? 0;

  if (abstainCount > 0) {
    playerRows.push({
      id: "abstain",

      name:
        "الامتناع عن التصويت",

      count:
        abstainCount,
    });
  }

  if (
    playerRows.length === 0
  ) {
    return `
      <p
        class="no-votes-message"
      >
        لا توجد أصوات مسجلة.
      </p>
    `;
  }

  return playerRows
    .sort(
      (
        firstItem,
        secondItem,
      ) => {
        return (
          secondItem.count -
          firstItem.count
        );
      },
    )
    .map(
      (item) => `
        <div
          class="vote-count-item"
        >
          <span>
            ${escapeHtml(
              item.name,
            )}
          </span>

          <strong>
            ${item.count}
          </strong>
        </div>
      `,
    )
    .join("");
}


function checkGameWinner() {
  const aliveThieves =
    getPlayersByTeam(
      TEAMS.THIEVES,
      {
        aliveOnly: true,
      },
    ).length;

  const aliveCitizens =
    getPlayersByTeam(
      TEAMS.CITIZENS,
      {
        aliveOnly: true,
      },
    ).length;

  if (aliveThieves === 0) {
    return TEAMS.CITIZENS;
  }

  if (
    aliveThieves >=
    aliveCitizens
  ) {
    return TEAMS.THIEVES;
  }

  return null;
}


function renderGameOverPage(
  winner,
) {
  setCurrentScreen(
    GAME_PHASES.GAME_OVER,
  );

  stopActiveTimer();

  if (
    !gameState.matchEndedAt
  ) {
    endMatchTimeline(
      gameState,
      winner,
    );
  }

  ensureMatchStatsStructure();

  const thievesWon =
    winner === TEAMS.THIEVES;

  const matchResults =
    calculateMatchResults(
      gameState,
    );

  const survivingPlayers =
    getAlivePlayers();

  app.innerHTML = `
    <main
      class="game-over-page ${
        thievesWon
          ? "thieves-win"
          : "citizens-win"
      }"
    >
      <div
        class="background-orb background-orb-purple"
      ></div>

      <div
        class="background-orb background-orb-green"
      ></div>

      <section
       class="game-over-card game-over-card--wide"
       >
        <img
          class="game-over-logo"
          src="/logo.png"
          alt="شعار مافيا"
        />

        <p
          class="game-over-label"
        >
          انتهت اللعبة
        </p>

        <div
          class="game-over-icon"
        >
          ${
            thievesWon
              ? "🗡️"
              : "🏆"
          }
        </div>

        <h1>
          ${
            thievesWon
              ? "فاز اللصوص"
              : "فاز المواطنون"
          }
        </h1>

        <p
          class="game-over-description"
        >
          ${
            thievesWon
              ? `
                أصبح عدد اللصوص مساويًا
                لعدد المواطنين الأحياء،
                وسيطر اللصوص على المدينة.
              `
              : `
                نجح المواطنون في اكتشاف
                جميع اللصوص وإخراجهم من
                المدينة.
              `
          }
        </p>

        <div
          id="match-results-container"
        ></div>

        <button
          class="game-over-secondary-button"
          id="showMatchDetailsButton"
          type="button"
        >
          عرض تفاصيل المباراة
        </button>

        <div
          class="game-over-statistics"
        >
          <div>
            <span>
              عدد الجولات
            </span>

            <strong>
              ${gameState.roundNumber}
            </strong>
          </div>

          <div>
            <span>
              الناجون
            </span>

            <strong>
              ${survivingPlayers.length}
            </strong>
          </div>

          <div>
            <span>
              المشاركون
            </span>

            <strong>
              ${
                gameState
                  .assignedPlayers
                  .length
              }
            </strong>
          </div>
        </div>

        <button
          class="voting-primary-button"
          id="playAgainButton"
          type="button"
        >
          اللعب بنفس المشاركين
        </button>

        <button
          class="game-over-secondary-button"
          id="returnHomeButton"
          type="button"
        >
          العودة إلى الصفحة الرئيسية
        </button>
      </section>
    </main>
  `;

  const matchResultsContainer =
    document.querySelector(
      "#match-results-container",
    );

  if (matchResultsContainer) {
    renderMatchResults(
      matchResultsContainer,
      matchResults,
    );
  }

  document
    .querySelector(
      "#showMatchDetailsButton",
    )
    ?.addEventListener(
      "click",
      () => {
        const summary =
          calculateMatchSummary(
            gameState,
            winner,
          );

        renderMatchDetailsPage({
          app,
          gameState,

          results:
            matchResults,

          summary,

          onBack: () => {
            renderGameOverPage(
              winner,
            );
          },
        });
      },
    );

  document
    .querySelector(
      "#playAgainButton",
    )
    ?.addEventListener(
      "click",
      () => {
        prepareReplayWithSamePlayers();
      },
    );

  document
    .querySelector(
      "#returnHomeButton",
    )
    ?.addEventListener(
      "click",
      () => {
        resetCompleteGame();
        renderHomePage();
      },
    );

  saveGame();
}


function prepareReplayWithSamePlayers() {
  stopActiveTimer();

  const preservedPlayers =
    gameState.players.map(
      (player) => {
        if (
          typeof player === "string"
        ) {
          return {
            id: generatePlayerId(),
            name: player,
            gender: "male",
          };
        }

        return {
          id:
            player.id ??
            generatePlayerId(),

          name: player.name,

          gender:
            player.gender ??
            "male",
        };
      },
    );

  /*
   * ملفات اللاعبين محفوظة ولا يتم حذف
   * نقاطهم أو تاريخهم عند إعادة اللعب.
   */
  const preservedProfiles =
    Array.isArray(
      gameState.playerProfiles,
    )
      ? gameState.playerProfiles
      : [];

  resetGameState();

  gameState.players =
    preservedPlayers;

  gameState.playerProfiles =
    preservedProfiles;

  syncPlayersWithProfiles(
    gameState,
  );

  saveGame();

  transitionTo(
    GAME_PHASES.SETTINGS,
  );
}


function resetCompleteGame() {
  stopActiveTimer();

  resetGameState();

  deleteSavedGame();
}


const STORAGE_KEY =
  "mafiaGameSave";


function saveGame() {
  try {
    const savedState = {
      currentPhase:
        gameState.currentPhase,

      currentScreen:
        gameState.currentScreen,

      players:
        gameState.players,

      assignedPlayers:
        gameState.assignedPlayers,

      currentRevealIndex:
        gameState.currentRevealIndex,

      roundNumber:
        gameState.roundNumber,

      nightSequence:
        gameState.nightSequence,

      nightAction:
        gameState.nightAction,

      previousNightActions:
        gameState
          .previousNightActions ??
        null,

      lastNightAction:
        gameState
          .lastNightAction ??
        null,

      voting:
        gameState.voting,

      soundEnabled:
        gameState.soundEnabled,

      settings:
        gameState.settings,

      timer: {
        remainingSeconds:
          gameState.timer
            ?.remainingSeconds ??
          gameState.settings
            .discussionDuration,

        isPaused:
          gameState.timer
            ?.isPaused ??
          false,

        discussionRound:
          gameState.timer
            ?.discussionRound ??
          null,
      },

      matchStats:
        gameState.matchStats,

      matchTimeline:
        gameState.matchTimeline,

      matchStartedAt:
        gameState.matchStartedAt,

      matchEndedAt:
        gameState.matchEndedAt,

      playerProfiles:
        gameState.playerProfiles,
    };

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(savedState),
    );

    return true;
  } catch (error) {
    console.error(
      "تعذر حفظ اللعبة:",
      error,
    );

    return false;
  }
}


function loadSavedGame() {
  const savedData =
    localStorage.getItem(
      STORAGE_KEY,
    );

  if (!savedData) {
    return false;
  }

  try {
    const parsedState =
      JSON.parse(savedData);

    gameState.currentPhase =
      parsedState.currentPhase ??
      parsedState.currentScreen ??
      GAME_PHASES.HOME;

    gameState.currentScreen =
      gameState.currentPhase;

    gameState.players =
      Array.isArray(
        parsedState.players,
      )
        ? parsedState.players
        : [];

    gameState.assignedPlayers =
      Array.isArray(
        parsedState.assignedPlayers,
      )
        ? parsedState
            .assignedPlayers
        : [];

    gameState.currentRevealIndex =
      Number.isInteger(
        parsedState
          .currentRevealIndex,
      )
        ? parsedState
            .currentRevealIndex
        : 0;

    gameState.roundNumber =
      Number.isInteger(
        parsedState.roundNumber,
      ) &&
      parsedState.roundNumber > 0
        ? parsedState.roundNumber
        : 1;

    gameState.nightAction = {
      victimId:
        parsedState.nightAction
          ?.victimId ??
        null,

      savedPlayerId:
        parsedState.nightAction
          ?.savedPlayerId ??
        null,

      inspectedPlayerId:
        parsedState.nightAction
          ?.inspectedPlayerId ??
        null,
    };

    gameState.previousNightActions =
      parsedState
        .previousNightActions &&
      typeof parsedState
        .previousNightActions ===
        "object"
        ? {
            ...parsedState
              .previousNightActions,
          }
        : null;

    gameState.lastNightAction =
      parsedState
        .lastNightAction &&
      typeof parsedState
        .lastNightAction ===
        "object"
        ? {
            ...parsedState
              .lastNightAction,
          }
        : null;

    gameState.nightSequence = {
      roleIds:
        Array.isArray(
          parsedState
            .nightSequence
            ?.roleIds,
        )
          ? parsedState
              .nightSequence
              .roleIds
          : [],

      currentIndex:
        Number.isInteger(
          parsedState
            .nightSequence
            ?.currentIndex,
        )
          ? parsedState
              .nightSequence
              .currentIndex
          : 0,
    };

    gameState.voting = {
      voterIndex:
        Number.isInteger(
          parsedState.voting
            ?.voterIndex,
        )
          ? parsedState
              .voting
              .voterIndex
          : 0,

      votes:
        Array.isArray(
          parsedState.voting
            ?.votes,
        )
          ? parsedState
              .voting
              .votes
          : [],

      round:
        parsedState.voting
          ?.round ??
        null,
    };

    gameState.soundEnabled =
      parsedState
        .soundEnabled ??
      true;

    gameState.settings = {
      nightDuration:
        Number(
          parsedState.settings
            ?.nightDuration,
        ) || 45,

      discussionDuration:
        Number(
          parsedState.settings
            ?.discussionDuration,
        ) || 180,

      votingDuration:
        Number(
          parsedState.settings
            ?.votingDuration,
        ) || 45,

      showTimer:
        parsedState.settings
          ?.showTimer ??
        true,

      vibrationEnabled:
        parsedState.settings
          ?.vibrationEnabled ??
        true,

      advancedRules: {
        preventRepeatVictim:
          parsedState.settings
            ?.advancedRules
            ?.preventRepeatVictim ??
          true,

        preventRepeatSave:
          parsedState.settings
            ?.advancedRules
            ?.preventRepeatSave ??
          true,
      },
    };

    gameState.timer = {
      remainingSeconds:
        Number.isFinite(
          Number(
            parsedState.timer
              ?.remainingSeconds,
          ),
        )
          ? Math.max(
              0,
              Number(
                parsedState.timer
                  .remainingSeconds,
              ),
            )
          : gameState.settings
              .discussionDuration,

      isPaused:
        parsedState.timer
          ?.isPaused ??
        false,

      discussionRound:
        parsedState.timer
          ?.discussionRound ??
        null,

      intervalId: null,
    };

    gameState.matchTimeline =
      Array.isArray(
        parsedState
          .matchTimeline,
      )
        ? parsedState
            .matchTimeline
        : [];

    gameState.matchStartedAt =
      parsedState
        .matchStartedAt ??
      null;

    gameState.matchEndedAt =
      parsedState
        .matchEndedAt ??
      null;

    gameState.playerProfiles =
      Array.isArray(
        parsedState
          .playerProfiles,
      )
        ? parsedState
            .playerProfiles
        : [];

    gameState.matchStats = {
      votes:
        Array.isArray(
          parsedState
            .matchStats
            ?.votes,
        )
          ? parsedState
              .matchStats
              .votes
          : [],

      successfulNurseSaves:
        Array.isArray(
          parsedState
            .matchStats
            ?.successfulNurseSaves,
        )
          ? parsedState
              .matchStats
              .successfulNurseSaves
          : [],

      kingThiefReveals:
        Array.isArray(
          parsedState
            .matchStats
            ?.kingThiefReveals,
        )
          ? parsedState
              .matchStats
              .kingThiefReveals
          : [],

      eliminationRounds: {
        ...(
          parsedState
            .matchStats
            ?.eliminationRounds ??
          {}
        ),
      },

      finalResults:
        parsedState
          .matchStats
          ?.finalResults ??
        null,

      applied:
        parsedState
          .matchStats
          ?.applied ??
        false,
    };

    syncPlayersWithProfiles(
      gameState,
    );

    return true;
  } catch (error) {
    console.error(
      "تعذر قراءة بيانات اللعبة المحفوظة:",
      error,
    );

    localStorage.removeItem(
      STORAGE_KEY,
    );

    return false;
  }
}


function hasSavedGame() {
  const savedData =
    localStorage.getItem(
      STORAGE_KEY,
    );

  if (!savedData) {
    return false;
  }

  try {
    const parsedState =
      JSON.parse(savedData);

    return (
      Array.isArray(
        parsedState.players,
      ) &&
      parsedState.players.length >=
        4
    );
  } catch {
    return false;
  }
}


function deleteSavedGame() {
  localStorage.removeItem(
    STORAGE_KEY,
  );
}


function setCurrentScreen(
  screenName,
) {
  gameState.currentScreen =
    screenName;

  gameState.currentPhase =
    screenName;
scrollPageToTop();
  saveGame();

}


function resumeSavedGame() {
  const loaded =
    loadSavedGame();

  if (!loaded) {
    renderHomePage();
    return;
  }

  const savedPhase =
    gameState.currentPhase ??
    gameState.currentScreen;

  if (
    savedPhase ===
    GAME_PHASES.NIGHT_RESULT
  ) {
    const victim =
      gameState
        .assignedPlayers
        .find((player) => {
          return (
            player.id ===
            gameState
              .previousNightActions
              ?.victimId
          );
        }) ?? null;

    const wasSaved =
      Boolean(victim) &&
      gameState
        .previousNightActions
        ?.victimId ===
        gameState
          .previousNightActions
          ?.savedPlayerId;

    renderNightResultPage(
      victim,
      wasSaved,
    );

    return;
  }

  if (
    savedPhase ===
    GAME_PHASES.VOTING_RESULT
  ) {
    renderVotingResultsPage();
    return;
  }

  if (
    savedPhase ===
    GAME_PHASES.GAME_OVER
  ) {
    const winner =
      checkGameWinner();

    if (winner) {
      renderGameOverPage(
        winner,
      );

      return;
    }
  }

  const renderer =
    phaseRenderers[
      savedPhase
    ];

  if (
    typeof renderer ===
    "function"
  ) {
    renderer();
    return;
  }

  if (
    gameState.assignedPlayers
      .length > 0
  ) {
    transitionTo(
      GAME_PHASES.ROLES_READY,
    );

    return;
  }

  transitionTo(
    GAME_PHASES.PLAYERS,
  );
}


const phaseRenderers = {
  [GAME_PHASES.HOME]:
    renderHomePage,

  [GAME_PHASES.PLAYERS]:
    renderPlayersPage,

  [GAME_PHASES.SETTINGS]:
    renderSettingsPage,

  [GAME_PHASES.ROLE_HANDOFF]:
    renderRoleHandoffPage,

  [GAME_PHASES.ROLE_REVEAL]:
    renderCurrentRolePage,

  [GAME_PHASES.ROLES_READY]:
    renderRolesReadyPage,

  [GAME_PHASES.NIGHT_INTRO]:
    renderNightIntroPage,

  [GAME_PHASES.THIEF_HANDOFF]:
    renderThiefHandoffPage,

  [GAME_PHASES.THIEF_SELECTION]:
    renderThiefSelectionPage,

  [GAME_PHASES.NURSE_HANDOFF]:
    renderNurseHandoffPage,

  [GAME_PHASES.NURSE_SELECTION]:
    renderNurseSelectionPage,

  [GAME_PHASES.KING_HANDOFF]:
    renderKingHandoffPage,

  [GAME_PHASES.KING_SELECTION]:
    renderKingSelectionPage,

  [GAME_PHASES.KING_RESULT]:
    () => {
      const playerId =
        gameState.nightAction
          .inspectedPlayerId;

      if (!playerId) {
        goToNextNightRole();
        return;
      }

      renderKingInspectionResult(
        playerId,
      );
    },

  [GAME_PHASES.DAY_DISCUSSION]:
    renderDayPage,

  [GAME_PHASES.VOTING_PREPARATION]:
    renderVotingPreparationPage,

  [GAME_PHASES.VOTING_HANDOFF]:
    renderVotingHandoffPage,

  [GAME_PHASES.VOTING_SELECTION]:
    renderCurrentVoterPage,

  [GAME_PHASES.VOTE_SAVED]:
    renderVoteSavedPage,

  [GAME_PHASES.VOTING_RESULT]:
    renderVotingResultsPage,
};


function transitionTo(
  nextPhase,
  options = {},
) {
  const renderer =
    phaseRenderers[
      nextPhase
    ];

  if (
    typeof renderer !==
    "function"
  ) {
    console.error(
      `لا توجد دالة عرض مسجلة للمرحلة: ${nextPhase}`,
    );

    return;
  }

  stopActiveTimer();

  gameState.currentPhase =
    nextPhase;

  gameState.currentScreen =
    nextPhase;

  if (
    options.save !== false
  ) {
    saveGame();
  }

  renderer(
    options.payload,
  );
}


function setGamePhase(
  nextPhase,
  shouldSave = true,
) {
  gameState.currentPhase =
    nextPhase;

  gameState.currentScreen =
    nextPhase;

  if (shouldSave) {
    saveGame();
  }
}


function registerTemporaryAdminShortcut() {
  document.addEventListener(
    "keydown",
    (event) => {
      const isAdminShortcut =
        event.altKey &&
        event.shiftKey &&
        event.key
          .toLowerCase() ===
          "m";

      if (!isAdminShortcut) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      openAdminPanel({
        phaseLabel:
          gameState.currentPhase ??
          "غير معروفة",

        round:
          gameState.roundNumber,

        totalPlayers:
          gameState
            .assignedPlayers
            .length ||
          gameState.players.length,

        alivePlayers:
          getAlivePlayers()
            .length,

        eliminatedPlayers:
          gameState
            .assignedPlayers
            .filter(
              (player) =>
                !player.alive,
            ).length,
      });
    },
  );
}
function scrollPageToTop() {
  window.scrollTo(0, 0);

  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}

registerTemporaryAdminShortcut();

loadSavedGame();

const restoredOnlineRoute = restoreOnlineRoute({
  app,
  onBack: () => {
    history.replaceState({}, "", location.pathname);
    renderHomePage();
  },
});

if (!restoredOnlineRoute) {
  renderHomePage();
}