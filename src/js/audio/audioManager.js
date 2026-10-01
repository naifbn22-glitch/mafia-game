const AUDIO_ENABLED_KEY = "mafia:audio-enabled";
const MUSIC_VOLUME_KEY = "mafia:music-volume";
const DEFAULT_MUSIC_VOLUME = 0.32;

const TRACKS = Object.freeze({
  music: "/audio/music/mafia-theme.mp3",
  cardFlip: "/audio/sfx/card-flip.mp3",
  nightStart: "/audio/sfx/night-start.mp3",
  morning: "/audio/sfx/morning.mp3",
  discussionFinal5: "/audio/sfx/discussion-final-5.mp3",
});

let enabled = localStorage.getItem(AUDIO_ENABLED_KEY) !== "false";
const storedMusicVolume = Number(localStorage.getItem(MUSIC_VOLUME_KEY));
let musicVolume = Number.isFinite(storedMusicVolume)
  ? Math.min(1, Math.max(0, storedMusicVolume))
  : DEFAULT_MUSIC_VOLUME;
let scene = "menu";
let backgroundMusic = null;
const sfxPool = new Map();
const playedKeys = new Set();

function audioFor(src, { loop = false, volume = 1 } = {}) {
  const audio = new Audio(src);
  audio.preload = "auto";
  audio.loop = loop;
  audio.volume = volume;
  return audio;
}

function ensureBackgroundMusic() {
  if (!backgroundMusic) {
    backgroundMusic = audioFor(TRACKS.music, { loop: true, volume: musicVolume });
  }
  return backgroundMusic;
}

function updateButton() {
  const button = document.querySelector("#globalSoundButton");
  if (button) {
    button.textContent = enabled ? "🔊" : "🔇";
    button.setAttribute("aria-label", "التحكم بالصوت");
    button.title = "التحكم بالصوت";
  }

  const muteButton = document.querySelector("#globalAudioMuteButton");
  if (muteButton) {
    muteButton.textContent = enabled ? "كتم الصوت" : "تشغيل الصوت";
    muteButton.setAttribute("aria-pressed", enabled ? "false" : "true");
  }

  const slider = document.querySelector("#globalMusicVolume");
  const value = document.querySelector("#globalMusicVolumeValue");
  if (slider) slider.value = String(Math.round(musicVolume * 100));
  if (value) value.textContent = `${Math.round(musicVolume * 100)}%`;
}

async function tryPlay(audio) {
  try {
    await audio.play();
  } catch (error) {
    // Browsers may block autoplay until the first user interaction.
    if (error?.name !== "NotAllowedError") {
      console.info("Audio playback was skipped.", error);
    }
  }
}

function syncMusic() {
  const music = ensureBackgroundMusic();
  const shouldPlay = enabled && (scene === "menu" || scene === "winner");
  if (shouldPlay) {
    tryPlay(music);
  } else {
    music.pause();
  }
}

export function installGlobalSoundButton() {
  if (document.querySelector("#globalSoundButton")) {
    updateButton();
    return;
  }
  const control = document.createElement("div");
  control.className = "global-audio-control";
  control.innerHTML = `
    <button id="globalSoundButton" class="global-sound-button" type="button" aria-expanded="false"></button>
    <div id="globalAudioPanel" class="global-audio-panel" aria-hidden="true">
      <div class="global-audio-panel-title">
        <strong>الصوت</strong>
        <span id="globalMusicVolumeValue">${Math.round(musicVolume * 100)}%</span>
      </div>
      <label class="global-volume-row" for="globalMusicVolume">
        <span>موسيقى الخلفية</span>
        <input id="globalMusicVolume" type="range" min="0" max="100" step="1" value="${Math.round(musicVolume * 100)}" />
      </label>
      <button id="globalAudioMuteButton" class="global-audio-mute-button" type="button"></button>
    </div>
  `;
  document.body.appendChild(control);

  const button = control.querySelector("#globalSoundButton");
  const panel = control.querySelector("#globalAudioPanel");
  const muteButton = control.querySelector("#globalAudioMuteButton");
  const slider = control.querySelector("#globalMusicVolume");

  button?.addEventListener("click", event => {
    event.stopPropagation();
    const open = !panel.classList.contains("is-open");
    panel.classList.toggle("is-open", open);
    panel.setAttribute("aria-hidden", open ? "false" : "true");
    button.setAttribute("aria-expanded", open ? "true" : "false");
  });

  muteButton?.addEventListener("click", () => setAudioEnabled(!enabled));
  slider?.addEventListener("input", event => setMusicVolume(Number(event.target.value) / 100));

  document.addEventListener("pointerdown", event => {
    if (!control.contains(event.target)) {
      panel.classList.remove("is-open");
      panel.setAttribute("aria-hidden", "true");
      button?.setAttribute("aria-expanded", "false");
    }
  });

  updateButton();

  const unlock = () => {
    syncMusic();
    window.removeEventListener("pointerdown", unlock, true);
    window.removeEventListener("keydown", unlock, true);
  };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
}

export function isAudioEnabled() {
  return enabled;
}

export function setAudioEnabled(value) {
  enabled = Boolean(value);
  localStorage.setItem(AUDIO_ENABLED_KEY, String(enabled));
  if (!enabled) {
    ensureBackgroundMusic().pause();
    for (const audio of sfxPool.values()) {
      audio.pause();
      audio.currentTime = 0;
    }
  }
  updateButton();
  syncMusic();
  window.dispatchEvent(new CustomEvent("mafia:audio-change", { detail: { enabled } }));
}

export function setMusicVolume(value) {
  musicVolume = Math.min(1, Math.max(0, Number(value) || 0));
  localStorage.setItem(MUSIC_VOLUME_KEY, String(musicVolume));
  ensureBackgroundMusic().volume = musicVolume;
  updateButton();
  if (musicVolume > 0 && !enabled) setAudioEnabled(true);
  else syncMusic();
}

export function setAudioScene(nextScene) {
  scene = nextScene || "game";
  syncMusic();
}

export function playSfx(name, { key = "", volume = 0.8 } = {}) {
  if (!enabled || !TRACKS[name]) return false;
  if (key && playedKeys.has(key)) return false;
  if (key) playedKeys.add(key);

  let audio = sfxPool.get(name);
  if (!audio) {
    audio = audioFor(TRACKS[name], { volume });
    sfxPool.set(name, audio);
  }
  audio.pause();
  audio.currentTime = 0;
  audio.volume = volume;
  tryPlay(audio);
  return true;
}

export function syncOfflineAudioPhase(phase) {
  if (["home", "players", "settings"].includes(phase)) {
    setAudioScene("menu");
    return;
  }
  if (phase === "game-over") {
    setAudioScene("winner");
    return;
  }
  setAudioScene("game");
}

const onlineState = new Map();

export function syncOnlineAudio(room) {
  if (!room?.code) {
    setAudioScene("menu");
    return;
  }

  const previous = onlineState.get(room.code) || {};
  if (room.winner) setAudioScene("winner");
  else if (room.status === "waiting") setAudioScene("menu");
  else setAudioScene("game");

  const phaseKey = `${room.code}:${Number(room.matchSequence || 0)}:${room.phase}:${Number(room.nightNumber || 0)}:${Number(room.roundNumber || 0)}`;

  if (room.status === "playing" && room.phase === "eyes-closed" && previous.phase !== "eyes-closed") {
    playSfx("nightStart", { key: `night:${phaseKey}`, volume: 0.82 });
  }
  if (room.status === "playing" && room.phase === "day" && previous.phase !== "day") {
    playSfx("morning", { key: `morning:${phaseKey}`, volume: 0.82 });
  }

  onlineState.set(room.code, {
    phase: room.phase,
    winner: room.winner || null,
    matchSequence: Number(room.matchSequence || 0),
  });
}

export function playRoleCardFlip(key = "") {
  return playSfx("cardFlip", { key, volume: 0.78 });
}

export function playDiscussionFinalFive(key = "") {
  return playSfx("discussionFinal5", { key, volume: 0.82 });
}
