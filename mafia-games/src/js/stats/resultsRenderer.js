function getRoleDetails(
  role,
  gender = "male",
) {
  const isFemale =
    gender === "female";

  const roles = {
    thief: {
      name: isFemale
        ? "اللصة"
        : "اللص",
      icon: "🗡️",
      className: "thief",
    },

    citizen: {
      name: isFemale
        ? "مواطنة"
        : "مواطن",
      icon: "🛡️",
      className: "citizen",
    },

    nurse: {
      name: isFemale
        ? "ممرضة"
        : "ممرض",
      icon: "⚕️",
      className: "nurse",
    },

    king: {
      name: isFemale
        ? "الملكة"
        : "الملك",
      icon: "👑",
      className: "king",
    },
  };

  return (
    roles[role] ?? {
      name: role ?? "غير معروف",
      icon: "🎭",
      className: "unknown",
    }
  );
}

function getPositionDetails(index) {
  if (index === 0) {
    return {
      number: "1",
      className: "first",
    };
  }

  if (index === 1) {
    return {
      number: "2",
      className: "second",
    };
  }

  if (index === 2) {
    return {
      number: "3",
      className: "third",
    };
  }

  return {
    number: `${index + 1}`,
    className: "normal",
  };
}

function getPointsLabel(points) {
  return points === 1
    ? "نقطة"
    : "نقاط";
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderPlayerAvatar(player) {
  const playerName =
    escapeHTML(player?.name ?? "لاعب");

  if (player?.avatar) {
    return `
      <span class="final-player-avatar">
        <img
          src="${escapeHTML(player.avatar)}"
          alt="صورة ${playerName}"
        />
      </span>
    `;
  }

  return `
    <span
      class="final-player-avatar final-player-avatar--empty"
      aria-label="لا توجد صورة شخصية"
    >
      👤
    </span>
  `;
}

export function renderMatchResults(
  container,
  results,
) {
  if (!container) {
    console.error(
      "لم يتم العثور على حاوية نتائج المباراة.",
    );

    return;
  }

  const ranking =
    results?.ranking ?? [];

  if (ranking.length === 0) {
    container.innerHTML = `
      <div class="match-results-empty">
        لا توجد نتائج متاحة.
      </div>
    `;

    return;
  }

  const rankingHTML = ranking
    .map((player, index) => {
      const role =
        getRoleDetails(
          player.role,
          player.gender,
        );

      const position =
        getPositionDetails(index);

      const points =
        Number(
          player.matchPoints ?? 0,
        );

      return `
        <div
          class="
            final-ranking-row
            final-ranking-row--${position.className}
          "
        >
          <div class="final-ranking-position">
            ${
              index < 3
                ? `
                  <span
                    class="
                      final-position-laurel
                      final-position-laurel--${position.className}
                    "
                  >
                    <span>
                      ${position.number}
                    </span>
                  </span>
                `
                : `
                  <span class="final-position-number">
                    ${position.number}
                  </span>
                `
            }
          </div>

          <div class="final-ranking-player">
            ${renderPlayerAvatar(player)}

            <div class="final-ranking-player-info">
              <strong>
                ${escapeHTML(player.name)}
              </strong>

              ${
                index === 0
                  ? `
                    <span
                      class="final-best-player-star"
                      title="المركز الأول"
                    >
                      ⭐
                    </span>
                  `
                  : ""
              }
            </div>
          </div>

          <div class="final-ranking-role">
            <span
              class="
                final-role-badge
                final-role-badge--${role.className}
              "
            >
              <span class="final-role-icon">
                ${role.icon}
              </span>

              <span>
                ${role.name}
              </span>
            </span>
          </div>

          <div class="final-ranking-points">
            <strong>
              ${points}
            </strong>

            <span>
              ${getPointsLabel(points)}
            </span>
          </div>
        </div>
      `;
    })
    .join("");

  container.innerHTML = `
    <section class="final-results">
      <header class="final-results-header">
        <h2>
          <span>🏆</span>
          النتائج النهائية
        </h2>

        <p>
          <span class="final-title-decoration">
            ❖
          </span>

          انتهت المباراة! إليك ترتيب
          اللاعبين حسب النقاط

          <span
            class="
              final-title-decoration
              final-title-decoration--green
            "
          >
            ❖
          </span>
        </p>
      </header>

      <div class="final-ranking-table">
        <div class="final-ranking-head">
          <div>الترتيب</div>
          <div>اللاعب</div>
          <div>الدور</div>
          <div>النقاط</div>
        </div>

        <div class="final-ranking-body">
          ${rankingHTML}
        </div>
      </div>

      <div class="final-results-note">
        <span class="final-results-note-icon">
          ⓘ
        </span>

        <span>
          النقاط تُحسب بناءً على أدائك
          في اللعبة ومساهمتك في الفوز
        </span>

        <span class="final-results-note-decoration">
          ❖
        </span>
      </div>
    </section>
  `;
}