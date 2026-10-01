const AUDIO_ENABLED_KEY = "mafia:audio-enabled";

const TRACKS = Object.freeze({
  music: "/audio/music/mafia-theme.mp3",
  cardFlip: "/audio/sfx/card-flip.mp3",
  nightStart: "/audio/sfx/night-start.mp3",
  morning: "/audio/sfx/morning.mp3",
  discussionFinal5: "/audio/sfx/discussion-final-5.mp3",
});

let enabled = localStorage.getItem(AUDIO_ENABLED_KEY) !== "false";
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
    backgroundMusic = audioFor(TRACKS.music, { loop: true, volume: 0.34 });
  }
  return backgroundMusic;
}

function updateButton() {
  const button = document.querySelector("#globalSoundButton");
  if (!button) return;
  button.textContent = enabled ? "🔊" : "🔇";
  button.setAttribute("aria-label", enabled ? "إيقاف جميع الأصوات" : "تشغيل جميع الأصوات");
  button.title = enabled ? "إيقاف الصوت" : "تشغيل الصوت";
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
  const button = document.createElement("button");
  button.id = "globalSoundButton";
  button.className = "global-sound-button";
  button.type = "button";
  document.body.appendChild(button);
  button.addEventListener("click", () => setAudioEnabled(!enabled));
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
