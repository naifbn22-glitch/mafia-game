function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getPhaseName(phase) {
  const phases = {
    night: "الليل",
    day: "النهار",
    voting: "التصويت",
    start: "البداية",
    "game-over": "نهاية المباراة",
  };

  return phases[phase] ?? "";
}

function renderTimelineEvents(events) {
  if (!events.length) {
    return `
      <p class="match-details-empty">
        لم يتم تسجيل أحداث للمباراة.
      </p>
    `;
  }

  return events
    .map(
      (event) => `
        <article class="timeline-event">
          <div class="timeline-event-icon">
            ${event.icon ?? "•"}
          </div>

          <div class="timeline-event-content">
            <strong>
              ${escapeHtml(event.title)}
            </strong>

            ${
              event.description
                ? `
                  <p>
                    ${escapeHtml(event.description)}
                  </p>
                `
                : ""
            }

            <small>
              الجولة ${event.round ?? "-"}
              ${
                event.phase
                  ? `— ${getPhaseName(event.phase)}`
                  : ""
              }
            </small>
          </div>
        </article>
      `,
    )
    .join("");
}

export function renderMatchDetailsPage({
  app,
  gameState,
  results,
  summary,
  onBack,
}) {
  const bestPlayers = results.bestPlayers ?? [];

  const bestPlayersNames = bestPlayers
    .map((player) => escapeHtml(player.name))
    .join(" و ");

  app.innerHTML = `
    <main class="match-details-page">
      <section class="match-details-header">
        <button
          type="button"
          class="match-details-back-button"
          id="back-to-game-over"
        >
          رجوع
        </button>

        <div>
          <p>إحصائيات المباراة</p>
          <h1>تفاصيل المباراة</h1>
        </div>
      </section>

      <section class="match-details-mvp">
        <span>🏆</span>
        <p>أفضل لاعب</p>
        <h2>${bestPlayersNames || "غير متوفر"}</h2>

        ${
          bestPlayers[0]
            ? `
              <strong>
                ${bestPlayers[0].matchPoints} نقطة
              </strong>
            `
            : ""
        }
      </section>

      <section class="match-summary-grid">
        <article>
          <strong>${summary.totalRounds}</strong>
          <span>عدد الجولات</span>
        </article>

        <article>
          <strong>${summary.totalPlayers}</strong>
          <span>عدد اللاعبين</span>
        </article>

        <article>
          <strong>${summary.survivingPlayers}</strong>
          <span>الناجون</span>
        </article>

        <article>
          <strong>${summary.eliminatedPlayers}</strong>
          <span>اللاعبون الخارجون</span>
        </article>

        <article>
          <strong>${summary.timelineEvents}</strong>
          <span>أحداث المباراة</span>
        </article>

        <article>
          <strong>${summary.durationText}</strong>
          <span>مدة المباراة</span>
        </article>
      </section>

      <section class="match-details-section">
        <h2>ترتيب اللاعبين</h2>

        <div class="match-details-ranking">
          ${results.ranking
            .map(
              (player, index) => `
                <article class="details-ranking-card">
                  <span class="details-rank-number">
                    ${index + 1}
                  </span>

                  <div>
                    <strong>
                      ${escapeHtml(player.name)}
                    </strong>

                    <small>
                      ${escapeHtml(player.role)}
                    </small>
                  </div>

                  <div class="details-player-points">
                    <strong>
                      ${player.matchPoints}
                    </strong>
                    <span>نقطة</span>
                  </div>
                </article>
              `,
            )
            .join("")}
        </div>
      </section>

      <section class="match-details-section">
        <h2>سجل المباراة</h2>

        <div class="match-timeline">
          ${renderTimelineEvents(
            gameState.matchTimeline ?? [],
          )}
        </div>
      </section>
    </main>
  `;

  document
    .querySelector("#back-to-game-over")
    ?.addEventListener("click", onBack);
}