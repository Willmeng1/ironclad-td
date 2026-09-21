const canvas = document.querySelector("#gameCanvas");
const STATIC_HOSTING = location.protocol === "file:" || typeof io !== "function";
const forceMobileLayout = location.search.includes("mobile=1");
const forceLaptopLayout = !forceMobileLayout && (location.pathname === "/laptop"
  || location.search.includes("laptop=1")
  || location.port === "3003"
  || !window.matchMedia("(pointer: coarse)").matches);
document.body.classList.toggle("laptop-layout", forceLaptopLayout);
const isTouchDevice = forceMobileLayout || window.matchMedia("(pointer: coarse)").matches;
document.body.classList.toggle("mobile-layout", isTouchDevice && !forceLaptopLayout);

async function requestLandscapeMode() {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
    }
  } catch {
    // Fullscreen is optional; the portrait gate still prevents play.
  }

  try {
    if (screen.orientation?.lock) await screen.orientation.lock("landscape");
  } catch {
    // Some mobile browsers only allow the user to rotate the device manually.
  }
}

if (isTouchDevice && !forceLaptopLayout) requestLandscapeMode();
const ctx = canvas.getContext("2d");
const MAX_TOWER_LEVEL = 5;
const WAVE_HEALTH_GROWTH_FACTOR = 0.8;
const MAX_ACTIVE_SHOTS = 90;
const MAX_ACTIVE_CHAIN_SHOTS = 12;
const CHAIN_RANGE = 75;
const CHAIN_RANGE_SQ = CHAIN_RANGE * CHAIN_RANGE;
const MAX_SIM_STEP = 0.05;
const MAX_CATCHUP_SECONDS = 5;
const SELL_CONFIRM_MS = 7000;
const EXCHANGE_RATE = 5;
const DAILY_REWARDS = [
  { day: 1, type: "gems", amount: 20 },
  { day: 2, type: "xp", amount: 100 },
  { day: 3, type: "gems", amount: 40 },
  { day: 4, type: "xp", amount: 200 },
  { day: 5, type: "gems", amount: 60 },
  { day: 6, type: "xp", amount: 300 },
  { day: 7, type: "gems", amount: 100 },
];
const STARTER_TOWER_IDS = ["dart", "ice", "spark"];
const TOWER_PLACEMENT_LIMITS = {
  bank: 4,
  barracks: 5,
  haste: 2,
  power: 2,
};
const BASE_POINT = [940, 392];
const BASE_RECT = { x: 900, y: 336, w: 96, h: 112 };
const BASE_GATE = [BASE_RECT.x, BASE_POINT[1]];
const BASE_SPRITE = { x: 810, y: 270, size: 185 };
const CODE_NOTE_STAGE = 1;
const CODE_NOTE = { x: 156, y: 124, w: 18, h: 14 };
const baseImage = new Image();
baseImage.src = "./assets/base.png?v=2";
const sound = createSoundSystem();
const music = createMusicSystem("./assets/calm-game-background-loop.mp3");

function startCoinsForStage(stageId) {
  const baseCoins = stageId === 15 ? 850 : 300 + stageId * 28;
  return Math.floor((baseCoins * 1.35) / 10) * 10;
}

const state = {
  account: null,
  authToken: null,
  playerLevel: 1,
  xp: 0,
  gems: 15,
  unlocked: new Set(),
  clearedStages: new Set(),
  stageStars: {},
  dailyRewards: {
    day: 1,
    lastClaimDate: null,
    lastClaimedDay: null,
    claimedDays: [],
  },
  loadout: [...STARTER_TOWER_IDS],
  redeemedCodes: new Set(),
  selectedTowerType: null,
  selectedPlaced: null,
  sellConfirmTower: null,
  previewX: null,
  previewY: null,
  previewPlaceable: false,
  previewPlaceKey: "",
  screen: "home",
  currentLevel: null,
  coins: 0,
  baseHp: 20,
  wave: 0,
  runningWave: false,
  pendingWaveStart: false,
  awaitingRemoteWave: false,
  levelEnded: false,
  mobs: [],
  placed: [],
  soldiers: [],
  shots: [],
  spawns: [],
  startedWaves: new Set(),
  kills: 0,
  earnedGems: 0,
  metaCoins: 0,
  towerLevels: {},
  mobIndex: new Set(),
  gameSpeed: 1,
  exchangeDirection: "gemsToCoins",
  earnedXp: 0,
  lastTime: 0,
  mobSyncTimer: 0,
  hudTimer: 0,
  lastMobSyncAt: 0,
  nextMobId: 1,
};

  const towers = [
  { id: "dart", name: "Dart", cost: 85, unlockLevel: 1, gems: 0, range: 118, fire: 0.72, damage: 12, color: "#e7d06f", kind: "basic", description: "Cheap, fast, and reliable early damage. Best used in groups to cover long lanes." },
  { id: "ice", name: "Ice", cost: 115, unlockLevel: 1, gems: 0, range: 105, fire: 1.2, damage: 8, slow: 0.52, color: "#8bd7ff", kind: "slow", description: "Slows enemies so other towers get more time to fire. Strong near corners and crowded choke points." },
  { id: "spark", name: "Zap", cost: 175, unlockLevel: 1, gems: 0, range: 128, fire: 1.2, damage: 14, color: "#b98cff", kind: "chain", description: "Chains lightning between nearby enemies. Great when waves bunch up, weaker against spread-out targets." },
  { id: "sniper", name: "Sniper", cost: 240, unlockLevel: 6, gems: 90, range: 230, fire: 2.2, damage: 55, color: "#b9c6d0", kind: "basic", description: "Long-range single-target damage for picking off tough enemies. Place where it can see as much path as possible." },
  { id: "venom", name: "Poison", cost: 190, unlockLevel: 9, gems: 135, range: 106, fire: 1.05, damage: 13, poison: 30, color: "#70d45e", kind: "dot", description: "Applies lingering poison that keeps hurting enemies after the hit. Best when enemies survive long enough for the poison to tick." },
  { id: "bank", name: "Bank", cost: 185, unlockLevel: 18, gems: 320, range: 0, fire: 6.5, damage: 0, color: "#ffd35a", kind: "income", description: "Generates extra coins during waves instead of attacking. Build early if you can survive with fewer weapons." },
  { id: "tesla", name: "Tesla", cost: 390, unlockLevel: 21, gems: 390, range: 120, fire: 1.4, damage: 29, color: "#65ffe4", kind: "chain", description: "Heavy chain lightning with stronger multi-target pressure. Excellent against dense waves and mixed enemy packs." },
  { id: "ember", name: "Fire", cost: 375, unlockLevel: 22, gems: 470, range: 112, fire: 0.85, damage: 24, burn: 38, color: "#ff9158", kind: "dot", description: "Fast fire attacks apply burn damage over time. Strong into steady waves that stay alive long enough to burn." },
  { id: "haste", name: "Haste", cost: 430, unlockLevel: 23, gems: 430, range: 120, fire: 0, damage: 0, aura: { fireRate: 0.1, fireRateStep: 0.04 }, color: "#6ee7c8", kind: "support", description: "Boosts nearby towers so they attack faster. Put it in the middle of your best damage cluster." },
  { id: "power", name: "Power", cost: 460, unlockLevel: 25, gems: 470, range: 120, fire: 0, damage: 0, aura: { damage: 0.12, damageStep: 0.04 }, color: "#ffbe5b", kind: "support", description: "Raises nearby tower damage for bigger hits. Pairs well with slow, sniper, rail, and other high-value attacks." },
  { id: "barracks", name: "Guard", cost: 190, unlockLevel: 26, gems: 520, range: 0, fire: 21, damage: 24, soldierHp: 48, soldierSpeed: 32, color: "#8fcf74", kind: "summon", description: "Spawns guards that block and fight enemies on the path. Upgrades make them tougher and eventually add ranged fire." },
  { id: "void", name: "Void", cost: 540, unlockLevel: 27, gems: 560, range: 112, fire: 2.1, damage: 18, slow: 0.45, splash: 52, color: "#7d6bff", kind: "control", description: "Creates slowing blasts that control groups of enemies. Use it to buy time for your heavy damage towers." },
  { id: "ranger", name: "Ranger", cost: 700, unlockLevel: 29, gems: 660, range: 185, fire: 0.62, damage: 39, color: "#d5b16a", kind: "basic", description: "High-rate precision damage with strong range. A flexible late-game tower for cleaning up leaks." },
  { id: "rail", name: "Rail", cost: 1035, unlockLevel: 30, gems: 820, range: 220, fire: 2.7, damage: 92, color: "#dfe9ef", kind: "pierce", description: "Expensive piercing shots that punish enemies lined up on the path. Best on long straight sections." },
  { id: "orbital", name: "Orbital", cost: 1440, unlockLevel: 32, gems: 1050, range: 170, fire: 1.65, damage: 88, color: "#ffffff", kind: "elite", description: "Locks on with a continuous beam for elite single-target damage. Costly, but devastating when protected by support." },
];

const stageBosses = [
  { name: "Grimjaw", color: "#b53838" },
  { name: "Nightclaw", color: "#6c48b8" },
  { name: "Bonehide", color: "#b8b16c" },
  { name: "Ashmaw", color: "#d86f37" },
  { name: "Frostfang", color: "#5bb7d8" },
  { name: "Rotspike", color: "#55a84f" },
  { name: "Ironhorn", color: "#8c96a1" },
  { name: "Bloodwing", color: "#bd2e5a" },
  { name: "Voidbite", color: "#5644d8" },
  { name: "Dreadeye", color: "#d1bf45" },
  { name: "Stoneback", color: "#8a6742" },
  { name: "Venomlord", color: "#35b35f" },
  { name: "Stormskull", color: "#43c6d1" },
  { name: "Hellgrin", color: "#e04434" },
  { name: "The Last Horror", color: "#f3f5f7" },
];

function createSoundSystem() {
  let ctx = null;
  let lastTimes = {};
  let enabled = localStorage.getItem("td-sfx") !== "off";
  const activeSamples = new Set();
  const hums = {};
  const masterVolume = 0.38;
  const samples = {
    zap: "./assets/zap-spell.mp3",
  };

  function setEnabled(value) {
    enabled = Boolean(value);
    localStorage.setItem("td-sfx", enabled ? "on" : "off");
    if (!enabled) {
      activeSamples.forEach((audio) => {
        audio.pause();
        audio.currentTime = 0;
      });
      activeSamples.clear();
      stopSupportHum("haste");
      stopSupportHum("power");
    }
  }

  function isEnabled() {
    return enabled;
  }

  function audioContext() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function canPlay(key, gap = 0.035) {
    const now = performance.now();
    if (lastTimes[key] && now - lastTimes[key] < gap * 1000) return false;
    lastTimes[key] = now;
    return true;
  }

  function tone({ freq = 440, endFreq = freq, duration = 0.12, type = "sine", volume = 0.18, when = 0 }) {
    if (!enabled) return;
    const ac = audioContext();
    const start = ac.currentTime + when;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume * masterVolume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(ac.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  function noise({ duration = 0.12, volume = 0.12, when = 0, filter = 900, type = "lowpass" }) {
    if (!enabled) return;
    const ac = audioContext();
    const start = ac.currentTime + when;
    const buffer = ac.createBuffer(1, Math.max(1, Math.floor(ac.sampleRate * duration)), ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    const source = ac.createBufferSource();
    const gain = ac.createGain();
    const biquad = ac.createBiquadFilter();
    source.buffer = buffer;
    biquad.type = type;
    biquad.frequency.setValueAtTime(filter, start);
    gain.gain.setValueAtTime(volume * masterVolume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(biquad).connect(gain).connect(ac.destination);
    source.start(start);
    source.stop(start + duration + 0.02);
  }

  function sample({ src, duration = 0.55, rate = 1, volume = 0.5 }) {
    if (!enabled) return;
    const audio = new Audio(src);
    audio.volume = Math.min(1, volume * masterVolume);
    audio.playbackRate = rate;
    audio.currentTime = 0;
    activeSamples.add(audio);
    const cleanup = () => activeSamples.delete(audio);
    audio.addEventListener("ended", cleanup, { once: true });
    audio.play().catch(cleanup);
    setTimeout(() => {
      audio.pause();
      audio.currentTime = 0;
      cleanup();
    }, duration * 1000);
  }

  function startSupportHum(kind) {
    if (!enabled || hums[kind]) return;
    const ac = audioContext();
    const osc = ac.createOscillator();
    const tremolo = ac.createOscillator();
    const tremoloGain = ac.createGain();
    const gain = ac.createGain();
    const isHaste = kind === "haste";

    osc.type = "sine";
    osc.frequency.setValueAtTime(isHaste ? 82 : 62, ac.currentTime);
    tremolo.type = "sine";
    tremolo.frequency.setValueAtTime(isHaste ? 2.7 : 1.9, ac.currentTime);
    tremoloGain.gain.setValueAtTime(isHaste ? 0.006 : 0.007, ac.currentTime);
    gain.gain.setValueAtTime(0.0001, ac.currentTime);
    gain.gain.linearRampToValueAtTime((isHaste ? 0.032 : 0.038) * masterVolume, ac.currentTime + 0.35);

    tremolo.connect(tremoloGain).connect(gain.gain);
    osc.connect(gain).connect(ac.destination);
    osc.start();
    tremolo.start();
    hums[kind] = { osc, tremolo, gain };
  }

  function stopSupportHum(kind) {
    const hum = hums[kind];
    if (!hum) return;
    const ac = ctx;
    if (ac) {
      hum.gain.gain.cancelScheduledValues(ac.currentTime);
      hum.gain.gain.setTargetAtTime(0.0001, ac.currentTime, 0.08);
    }
    setTimeout(() => {
      hum.osc.stop();
      hum.tremolo.stop();
    }, 160);
    delete hums[kind];
  }

  function supportHum(hasHaste, hasPower) {
    if (!enabled) {
      stopSupportHum("haste");
      stopSupportHum("power");
      return;
    }
    if (hasHaste) startSupportHum("haste");
    else stopSupportHum("haste");
    if (hasPower) startSupportHum("power");
    else stopSupportHum("power");
  }

  function click() {
    if (!canPlay("click", 0.025)) return;
    tone({ freq: 520, endFreq: 720, duration: 0.045, type: "triangle", volume: 0.08 });
  }

  function error() {
    if (!canPlay("error", 0.12)) return;
    tone({ freq: 170, endFreq: 95, duration: 0.18, type: "sawtooth", volume: 0.1 });
  }

  function coins() {
    if (!canPlay("coins", 0.09)) return;
    tone({ freq: 880, endFreq: 1180, duration: 0.08, type: "triangle", volume: 0.1 });
    tone({ freq: 1180, endFreq: 1540, duration: 0.08, type: "triangle", volume: 0.08, when: 0.045 });
  }

  function upgrade() {
    if (!canPlay("upgrade", 0.08)) return;
    tone({ freq: 440, endFreq: 660, duration: 0.1, type: "triangle", volume: 0.1 });
    tone({ freq: 660, endFreq: 990, duration: 0.12, type: "triangle", volume: 0.1, when: 0.07 });
  }

  function place() {
    if (!canPlay("place", 0.06)) return;
    noise({ duration: 0.07, volume: 0.07, filter: 520 });
    tone({ freq: 220, endFreq: 170, duration: 0.09, type: "triangle", volume: 0.08 });
  }

  function sell() {
    if (!canPlay("sell", 0.08)) return;
    tone({ freq: 360, endFreq: 220, duration: 0.13, type: "square", volume: 0.07 });
  }

  function wave() {
    if (!canPlay("wave", 0.4)) return;
    tone({ freq: 260, endFreq: 520, duration: 0.2, type: "sawtooth", volume: 0.08 });
    tone({ freq: 390, endFreq: 780, duration: 0.18, type: "triangle", volume: 0.07, when: 0.08 });
  }

  function result(won) {
    if (!canPlay(`result-${won}`, 0.5)) return;
    if (won) {
      tone({ freq: 520, endFreq: 700, duration: 0.16, type: "triangle", volume: 0.1 });
      tone({ freq: 700, endFreq: 1040, duration: 0.22, type: "triangle", volume: 0.1, when: 0.13 });
    } else {
      tone({ freq: 240, endFreq: 150, duration: 0.32, type: "sawtooth", volume: 0.11 });
      noise({ duration: 0.18, volume: 0.06, filter: 240, when: 0.04 });
    }
  }

  function electricCrackle({ base = 820, volume = 0.07, heavy = false } = {}) {
    noise({ duration: heavy ? 0.09 : 0.055, volume: volume * 0.85, filter: heavy ? 3200 : 2600, type: "highpass" });
    tone({ freq: base, endFreq: base * 0.58, duration: 0.035, type: "square", volume });
    tone({ freq: base * 1.36, endFreq: base * 0.82, duration: 0.032, type: "square", volume: volume * 0.72, when: 0.018 });
    tone({ freq: base * 0.78, endFreq: base * 1.12, duration: 0.026, type: "sawtooth", volume: volume * 0.5, when: 0.043 });
    if (heavy) tone({ freq: base * 0.44, endFreq: base * 0.3, duration: 0.075, type: "square", volume: volume * 0.58, when: 0.018 });
  }

  function attack(style = "basic") {
    const electric = ["lightning", "tesla", "chainLightning", "chainTesla"].includes(style);
    const minDelay = style === "orbital" ? 0.16 : electric ? 0.24 : 0.045;
    if (!canPlay(`attack-${electric ? "electric" : style}`, minDelay)) return;
    const sounds = {
      arrow: () => {
        noise({ duration: 0.05, volume: 0.04, filter: 2800, type: "highpass" });
        tone({ freq: 760, endFreq: 520, duration: 0.045, type: "triangle", volume: 0.035 });
      },
      ranger: () => {
        noise({ duration: 0.045, volume: 0.045, filter: 3200, type: "highpass" });
        tone({ freq: 420, endFreq: 620, duration: 0.05, type: "triangle", volume: 0.04 });
      },
      bullet: () => {
        noise({ duration: 0.035, volume: 0.08, filter: 2200, type: "highpass" });
        tone({ freq: 150, endFreq: 75, duration: 0.055, type: "square", volume: 0.045 });
      },
      soldier: () => {
        noise({ duration: 0.032, volume: 0.045, filter: 1900, type: "highpass" });
        tone({ freq: 210, endFreq: 130, duration: 0.035, type: "square", volume: 0.026 });
      },
      ice: () => {
        tone({ freq: 1180, endFreq: 1680, duration: 0.085, type: "sine", volume: 0.06 });
        tone({ freq: 620, endFreq: 820, duration: 0.1, type: "triangle", volume: 0.035, when: 0.025 });
      },
      poison: () => {
        tone({ freq: 310, endFreq: 245, duration: 0.11, type: "triangle", volume: 0.055 });
        tone({ freq: 510, endFreq: 390, duration: 0.045, type: "sine", volume: 0.03, when: 0.05 });
      },
      fire: () => {
        noise({ duration: 0.13, volume: 0.065, filter: 680 });
        tone({ freq: 160, endFreq: 300, duration: 0.095, type: "sawtooth", volume: 0.04 });
      },
      void: () => {
        tone({ freq: 140, endFreq: 58, duration: 0.18, type: "sine", volume: 0.085 });
        noise({ duration: 0.09, volume: 0.035, filter: 260, when: 0.03 });
      },
      rail: () => {
        tone({ freq: 70, endFreq: 230, duration: 0.18, type: "sawtooth", volume: 0.055 });
        tone({ freq: 140, endFreq: 62, duration: 0.16, type: "square", volume: 0.036, when: 0.035 });
        noise({ duration: 0.13, volume: 0.05, filter: 1700, type: "bandpass", when: 0.02 });
        noise({ duration: 0.035, volume: 0.08, filter: 4200, type: "highpass", when: 0.135 });
      },
      lightning: () => {
        electricCrackle({ base: 760, volume: 0.035 });
      },
      tesla: () => {
        electricCrackle({ base: 1080, volume: 0.04, heavy: true });
      },
      chainLightning: () => {
        electricCrackle({ base: 700, volume: 0.025 });
      },
      chainTesla: () => {
        electricCrackle({ base: 980, volume: 0.03, heavy: true });
      },
      laser: () => {
        tone({ freq: 700, endFreq: 920, duration: 0.07, type: "sine", volume: 0.052 });
        tone({ freq: 1400, endFreq: 1150, duration: 0.04, type: "triangle", volume: 0.025 });
      },
      orbital: () => {
        tone({ freq: 92, endFreq: 105, duration: 0.25, type: "sawtooth", volume: 0.035 });
        tone({ freq: 184, endFreq: 196, duration: 0.25, type: "square", volume: 0.018 });
        noise({ duration: 0.22, volume: 0.018, filter: 1500, type: "bandpass", when: 0.01 });
      },
      melee: () => {
        noise({ duration: 0.065, volume: 0.065, filter: 480 });
        tone({ freq: 120, endFreq: 85, duration: 0.045, type: "triangle", volume: 0.035 });
      },
      spawn: () => {
        tone({ freq: 260, endFreq: 330, duration: 0.08, type: "triangle", volume: 0.04 });
        noise({ duration: 0.045, volume: 0.028, filter: 700 });
      },
      coinPulse: coins,
    };
    (sounds[style] || (() => tone({ freq: 420, endFreq: 360, duration: 0.07, type: "triangle", volume: 0.045 })))();
  }

  return { click, error, coins, upgrade, place, sell, wave, result, attack, supportHum, setEnabled, isEnabled };
}

function createMusicSystem(src) {
  const audio = new Audio(src);
  audio.loop = true;
  audio.preload = "auto";
  audio.volume = 0.3;
  let enabled = localStorage.getItem("td-music") !== "off";

  function play() {
    if (!enabled) return;
    const attempt = audio.play();
    if (attempt) attempt.catch(() => {});
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    localStorage.setItem("td-music", enabled ? "on" : "off");
    if (enabled) {
      play();
    } else {
      audio.pause();
    }
  }

  function isEnabled() {
    return enabled;
  }

  function unlock() {
    play();
  }

  audio.addEventListener("ended", () => {
    audio.currentTime = 0;
    play();
  });

  return { setEnabled, isEnabled, unlock };
}

const stageMonsters = [
  [{ name: "Mudling", color: "#5d4531", edge: "#b0895d", eye: "#ff684f", hp: 1.18, speed: 0.95, damage: 1, reward: 1.05, shape: "brute" }, { name: "Briar Imp", color: "#315c35", edge: "#7fc26e", eye: "#ffe66b", hp: 0.85, speed: 1.28, damage: 1, reward: 1.1, shape: "runner" }],
  [{ name: "Rust Crawler", color: "#7a4a31", edge: "#d28a55", eye: "#ffdf79", hp: 1.35, speed: 0.9, damage: 2, reward: 1.2, shape: "armored" }, { name: "Ash Sprite", color: "#4b4f57", edge: "#c4c9d0", eye: "#ff815b", hp: 0.9, speed: 1.35, damage: 1, reward: 1.15, shape: "winged" }],
  [{ name: "Mossback", color: "#3f5f36", edge: "#9bc56a", eye: "#f7f36a", hp: 1.55, speed: 0.82, damage: 2, reward: 1.25, shape: "brute" }, { name: "Needle Fiend", color: "#253d31", edge: "#78d58b", eye: "#ff5b55", hp: 1.05, speed: 1.22, damage: 1, reward: 1.15, shape: "spiked" }],
  [{ name: "Cinder Hound", color: "#6e2e24", edge: "#ff9158", eye: "#ffe66b", hp: 1.12, speed: 1.32, damage: 2, reward: 1.22, shape: "runner" }, { name: "Coal Golem", color: "#302925", edge: "#c46f43", eye: "#ff684f", hp: 1.85, speed: 0.7, damage: 3, reward: 1.35, shape: "armored" }],
  [{ name: "Frost Wretch", color: "#315a6b", edge: "#9bdcff", eye: "#ffffff", hp: 1.32, speed: 0.9, damage: 2, reward: 1.22, shape: "spiked" }, { name: "Shardling", color: "#6aa9bd", edge: "#d4f5ff", eye: "#1d2c38", hp: 0.95, speed: 1.38, damage: 1, reward: 1.18, shape: "winged" }],
  [{ name: "Rot Grub", color: "#4f5f27", edge: "#b5ca5d", eye: "#ff5b55", hp: 1.45, speed: 0.86, damage: 2, reward: 1.28, shape: "brute" }, { name: "Plague Bat", color: "#3d2d4f", edge: "#9b7dcb", eye: "#a8ff78", hp: 0.82, speed: 1.45, damage: 1, reward: 1.2, shape: "winged" }],
  [{ name: "Iron Mite", color: "#59616a", edge: "#d3dce5", eye: "#ffdf79", hp: 1.7, speed: 0.76, damage: 3, reward: 1.35, shape: "armored" }, { name: "Gear Imp", color: "#716047", edge: "#e1b84f", eye: "#65ffe4", hp: 1.08, speed: 1.18, damage: 2, reward: 1.22, shape: "spiked" }],
  [{ name: "Blood Skitter", color: "#6b1f36", edge: "#ff6f8e", eye: "#ffe66b", hp: 1.02, speed: 1.42, damage: 2, reward: 1.24, shape: "runner" }, { name: "Marrow Hulk", color: "#8c816c", edge: "#f3e4c0", eye: "#ff5b55", hp: 1.9, speed: 0.68, damage: 3, reward: 1.42, shape: "brute" }],
  [{ name: "Void Leech", color: "#332b67", edge: "#8a7dff", eye: "#d7c8ff", hp: 1.36, speed: 1.0, damage: 2, reward: 1.3, shape: "spiked" }, { name: "Phase Imp", color: "#4d3d7a", edge: "#bba8ff", eye: "#65ffe4", hp: 0.88, speed: 1.5, damage: 1, reward: 1.25, shape: "winged" }],
  [{ name: "Dread Stalker", color: "#4d3329", edge: "#e1b84f", eye: "#ff684f", hp: 1.28, speed: 1.2, damage: 2, reward: 1.28, shape: "runner" }, { name: "Stonejaw", color: "#62584a", edge: "#b8aa92", eye: "#f7f36a", hp: 2.05, speed: 0.62, damage: 4, reward: 1.5, shape: "armored" }],
  [{ name: "Thornback", color: "#2f5531", edge: "#8fd66f", eye: "#ffe66b", hp: 1.65, speed: 0.84, damage: 3, reward: 1.35, shape: "spiked" }, { name: "Bog Runner", color: "#455629", edge: "#c7d46b", eye: "#ff815b", hp: 1.0, speed: 1.45, damage: 2, reward: 1.26, shape: "runner" }],
  [{ name: "Storm Wisp", color: "#24576a", edge: "#65ffe4", eye: "#ffffff", hp: 0.92, speed: 1.55, damage: 2, reward: 1.3, shape: "winged" }, { name: "Thunder Brute", color: "#3c4650", edge: "#9fd3ff", eye: "#f7f36a", hp: 1.88, speed: 0.74, damage: 4, reward: 1.5, shape: "brute" }],
  [{ name: "Hell Pup", color: "#76291f", edge: "#ff9158", eye: "#ffe66b", hp: 1.1, speed: 1.52, damage: 2, reward: 1.32, shape: "runner" }, { name: "Lava Guard", color: "#4d241d", edge: "#ffbe5b", eye: "#ffef8a", hp: 2.15, speed: 0.64, damage: 4, reward: 1.55, shape: "armored" }],
  [{ name: "Night Shard", color: "#28283f", edge: "#8c9bff", eye: "#d7c8ff", hp: 1.45, speed: 1.12, damage: 3, reward: 1.4, shape: "spiked" }, { name: "Moon Bat", color: "#34385a", edge: "#c3ceff", eye: "#65ffe4", hp: 0.9, speed: 1.62, damage: 2, reward: 1.35, shape: "winged" }],
  [{ name: "Final Horror", color: "#2a1f24", edge: "#f3f5f7", eye: "#ff5b55", hp: 1.7, speed: 1.02, damage: 4, reward: 1.55, shape: "spiked" }, { name: "Doom Hulk", color: "#5b2431", edge: "#ff9aa8", eye: "#ffe66b", hp: 2.35, speed: 0.58, damage: 5, reward: 1.7, shape: "brute" }],
];

const extraMonsters = [
  { name: "Dust Rat", color: "#6a513c", edge: "#b68a60", eye: "#ffe66b", hp: 0.78, speed: 1.5, damage: 1, reward: 1.08, shape: "runner" },
  { name: "Shell Bug", color: "#4d4a3f", edge: "#d0c08a", eye: "#ff815b", hp: 1.55, speed: 0.78, damage: 2, reward: 1.28, shape: "armored" },
  { name: "Gloom Bat", color: "#2f3248", edge: "#8d99d6", eye: "#d7c8ff", hp: 0.86, speed: 1.55, damage: 1, reward: 1.2, shape: "winged" },
  { name: "Root Mauler", color: "#3c4f2c", edge: "#9fc46a", eye: "#f7f36a", hp: 1.75, speed: 0.72, damage: 3, reward: 1.38, shape: "brute" },
  { name: "Glass Imp", color: "#637d8c", edge: "#d4f5ff", eye: "#ffffff", hp: 0.92, speed: 1.32, damage: 2, reward: 1.22, shape: "spiked" },
  { name: "Tar Blob", color: "#29231f", edge: "#7a5a3e", eye: "#ffdf79", hp: 1.4, speed: 0.82, damage: 2, reward: 1.3, shape: "brute" },
  { name: "Soot Skipper", color: "#4a3b34", edge: "#c46f43", eye: "#ff684f", hp: 0.95, speed: 1.48, damage: 2, reward: 1.24, shape: "runner" },
  { name: "Crystal Creep", color: "#426b7a", edge: "#9bdcff", eye: "#f3f5f7", hp: 1.22, speed: 1.02, damage: 2, reward: 1.28, shape: "spiked" },
  { name: "Grave Worm", color: "#62584a", edge: "#b8aa92", eye: "#a8ff78", hp: 1.62, speed: 0.74, damage: 3, reward: 1.36, shape: "armored" },
  { name: "Ember Moth", color: "#70321f", edge: "#ffbe5b", eye: "#ffe66b", hp: 0.88, speed: 1.6, damage: 2, reward: 1.3, shape: "winged" },
  { name: "Acid Nibbler", color: "#3e6b2f", edge: "#b5ca5d", eye: "#a8ff78", hp: 1.05, speed: 1.2, damage: 2, reward: 1.25, shape: "runner" },
  { name: "Bone Knight", color: "#8c816c", edge: "#f3e4c0", eye: "#ff5b55", hp: 1.82, speed: 0.68, damage: 4, reward: 1.5, shape: "armored" },
  { name: "Rune Wisp", color: "#3b3a76", edge: "#bba8ff", eye: "#65ffe4", hp: 0.9, speed: 1.5, damage: 2, reward: 1.32, shape: "winged" },
  { name: "Hook Fiend", color: "#57313f", edge: "#ff6f8e", eye: "#ffdf79", hp: 1.32, speed: 1.08, damage: 3, reward: 1.36, shape: "spiked" },
  { name: "Magma Ox", color: "#5a241d", edge: "#ff9158", eye: "#ffe66b", hp: 2.05, speed: 0.62, damage: 4, reward: 1.6, shape: "brute" },
  { name: "Feral Wisp", color: "#24576a", edge: "#65ffe4", eye: "#ffffff", hp: 0.82, speed: 1.68, damage: 2, reward: 1.34, shape: "winged" },
];

function makeStageMonsters(stageId) {
  const pool = [...stageMonsters.flat(), ...extraMonsters];
  const lineup = [];
  const start = ((stageId - 1) * 5) % pool.length;

  for (let i = 0; lineup.length < 7 && i < pool.length * 2; i += 1) {
    const index = (start + i * 3 + Math.floor(i / 2) * stageId) % pool.length;
    const monster = pool[index];
    if (!lineup.some((existing) => existing.name === monster.name)) lineup.push(monster);
  }

  const tierHp = [0.7, 0.95, 1.25, 1.7, 2.3, 3.05, 4.0];
  const tierDamage = [1, 1, 1.15, 1.35, 1.65, 2, 2.35];
  return lineup
    .sort((a, b) => monsterThreat(a) - monsterThreat(b))
    .map((monster, tier) => ({
      ...monster,
      tier,
      hp: monster.hp * tierHp[tier],
      damage: monster.damage * tierDamage[tier],
      reward: monster.reward * (1 + tier * 0.12),
    }));
}

function monsterThreat(monster) {
  const speedPressure = monster.shape === "runner" || monster.shape === "winged" ? monster.speed * 1.45 : monster.speed;
  return monster.hp * monster.damage * speedPressure;
}

function route(points) {
  return addRoadBends([...points, BASE_GATE]);
}

function addRoadBends(points) {
  const bent = [points[0]];

  for (let i = 0; i < points.length - 1; i += 1) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);

    if (length > 135) {
      const seed = Math.abs(Math.round(ax * 3 + ay * 5 + bx * 7 + by * 11 + i * 17));
      const bend = (terrainRand(seed, 37) - 0.5) * Math.min(88, length * 0.34);
      const nx = -dy / length;
      const ny = dx / length;

      if (length > 260) {
        const firstBend = bend * 0.75;
        const secondBend = -bend * 0.45;
        bent.push([
          ax + dx * 0.34 + nx * firstBend,
          ay + dy * 0.34 + ny * firstBend,
        ]);
        bent.push([
          ax + dx * 0.68 + nx * secondBend,
          ay + dy * 0.68 + ny * secondBend,
        ]);
      } else {
        bent.push([
          ax + dx * 0.52 + nx * bend,
          ay + dy * 0.52 + ny * bend,
        ]);
      }
    }

    bent.push(points[i + 1]);
  }

  return bent;
}

const mapLayouts = [
  [route([[-40, 540], [120, 470], [250, 300], [420, 210], [620, 270], [760, 430], [850, 390]])],
  [route([[-40, 120], [120, 190], [260, 360], [430, 500], [610, 420], [760, 250], [850, 390]])],
  [route([[-40, 420], [130, 320], [260, 120], [460, 150], [630, 330], [780, 520], [850, 390]])],
  [route([[-40, 250], [130, 120], [310, 180], [450, 390], [620, 520], [790, 470], [850, 390]])],
  [
    route([[-40, 130], [130, 210], [330, 160], [520, 260], [700, 230], [850, 390]]),
    route([[-40, 540], [160, 470], [330, 560], [530, 470], [710, 520], [850, 390]]),
  ],
  [
    route([[170, -40], [130, 140], [260, 280], [480, 250], [650, 150], [820, 270], [850, 390]]),
    route([[-40, 520], [150, 500], [300, 360], [500, 430], [680, 560], [850, 390]]),
  ],
  [
    route([[-40, 80], [150, 120], [280, 280], [470, 220], [650, 340], [850, 390]]),
    route([[-40, 390], [160, 350], [320, 500], [520, 560], [700, 440], [850, 390]]),
  ],
  [
    route([[520, -40], [430, 120], [500, 280], [670, 300], [820, 220], [850, 390]]),
    route([[-40, 330], [130, 230], [310, 340], [500, 520], [690, 540], [850, 390]]),
  ],
  [
    route([[-40, 150], [120, 90], [290, 180], [480, 140], [650, 260], [850, 390]]),
    route([[-40, 360], [140, 380], [320, 510], [540, 470], [710, 520], [850, 390]]),
    route([[350, -40], [300, 140], [430, 280], [620, 340], [800, 310], [850, 390]]),
  ],
  [
    route([[-40, 90], [150, 170], [300, 320], [520, 260], [700, 190], [850, 390]]),
    route([[-40, 500], [150, 530], [330, 420], [520, 510], [710, 470], [850, 390]]),
    route([[650, -40], [580, 150], [710, 270], [800, 330], [850, 390]]),
  ],
  [
    route([[-40, 230], [150, 210], [320, 90], [520, 150], [680, 290], [850, 390]]),
    route([[-40, 430], [170, 390], [340, 530], [540, 500], [720, 430], [850, 390]]),
    route([[270, -40], [240, 150], [390, 280], [600, 340], [780, 310], [850, 390]]),
  ],
  [
    route([[-40, 120], [180, 170], [360, 310], [550, 250], [720, 170], [850, 390]]),
    route([[-40, 330], [170, 300], [340, 420], [560, 410], [740, 510], [850, 390]]),
    route([[460, -40], [430, 120], [560, 230], [740, 270], [820, 330], [850, 390]]),
  ],
  [
    route([[-40, 70], [170, 120], [330, 260], [530, 200], [700, 120], [850, 390]]),
    route([[-40, 510], [190, 470], [390, 540], [600, 450], [760, 500], [850, 390]]),
    route([[760, -40], [700, 150], [780, 250], [820, 320], [850, 390]]),
  ],
  [
    route([[-40, 210], [190, 190], [390, 90], [580, 160], [740, 280], [850, 390]]),
    route([[-40, 410], [170, 370], [370, 500], [580, 360], [740, 470], [850, 390]]),
    route([[180, -40], [230, 130], [390, 260], [620, 290], [800, 330], [850, 390]]),
  ],
  [
    route([[-40, 100], [170, 150], [340, 330], [550, 260], [730, 190], [850, 390]]),
    route([[-40, 520], [170, 480], [350, 340], [560, 500], [740, 520], [850, 390]]),
    route([[520, -40], [470, 130], [620, 230], [740, 310], [850, 390]]),
  ],
];

const BIOMES = [
  {
    key: "meadow",
    ground: ["#55823a", "#639145", "#446d2e"],
    patches: ["#3f6d2a", "#75a24c", "#2f5522", "#83ad58"],
    speckles: ["#3a5f28", "#6d9648", "#89ab5e", "#2f4f1f", "#7c9b55"],
    scratch: "#2c481d",
    vignette: "#0f1c09",
    road: { outer: "#57402c", mid: "#8b6d49", inner: "#9c7d52", dash: "#5c442f" },
    rock: { base: "#7d8073", dark: "#5d6055", light: "#a3a698" },
    props: ["tree", "tree", "tree", "bush", "rock"],
  },
  {
    key: "desert",
    ground: ["#c9a666", "#d7b678", "#b08d52"],
    patches: ["#bd9857", "#e0c188", "#a8814a", "#d3ad6c"],
    speckles: ["#a07c44", "#caa76a", "#8d6c3c", "#e2c48d", "#b6935a"],
    scratch: "#8a6a3a",
    vignette: "#221604",
    road: { outer: "#9c7847", mid: "#c3a06a", inner: "#d2b47e", dash: "#8a6a3d" },
    rock: { base: "#b98e5c", dark: "#8f6a40", light: "#d9b57f" },
    props: ["cactus", "cactus", "rock", "shrub", "rock"],
  },
  {
    key: "swamp",
    ground: ["#42523a", "#4c6040", "#31402c"],
    patches: ["#39512f", "#5a7146", "#26381f", "#4e6a52"],
    speckles: ["#2e4a2a", "#51693f", "#6a8352", "#233820", "#5d7747"],
    scratch: "#1f3220",
    vignette: "#0a1408",
    road: { outer: "#3a3325", mid: "#5c5236", inner: "#6b5f40", dash: "#2e2a1c" },
    rock: { base: "#6d7a62", dark: "#4c5745", light: "#8d9a7e" },
    props: ["swampTree", "swampTree", "reeds", "rock", "reeds"],
  },
  {
    key: "tundra",
    ground: ["#dfe8ee", "#eef4f8", "#c9d6e0"],
    patches: ["#cfdde7", "#f4f9fc", "#bccbd8", "#e6eef4"],
    speckles: ["#b8c9d6", "#e8f1f7", "#a7bac9", "#f5fafc", "#c4d3de"],
    scratch: "#9fb4c4",
    vignette: "#2c3a46",
    road: { outer: "#8d9aa6", mid: "#b9c6cf", inner: "#cbd7de", dash: "#7d8b98" },
    rock: { base: "#aebfca", dark: "#8698a6", light: "#dbe7ee" },
    props: ["pine", "pine", "pine", "iceRock", "rock"],
  },
  {
    key: "volcanic",
    ground: ["#3a3134", "#46393a", "#2a2426"],
    patches: ["#332b2e", "#514243", "#241f21", "#5a4846"],
    speckles: ["#2a2325", "#4d3f40", "#5f4d4a", "#1f1a1c", "#564546"],
    scratch: "#1c1719",
    vignette: "#000000",
    road: { outer: "#241f21", mid: "#4a3f3c", inner: "#584a44", dash: "#191517" },
    rock: { base: "#3b3540", dark: "#26222b", light: "#5a5264" },
    props: ["deadTree", "lavaRock", "vent", "lavaRock", "rock"],
  },
];

function biomeForStage(stageId) {
  return BIOMES[Math.min(BIOMES.length - 1, Math.floor((stageId - 1) / 3))];
}

function pickPropKind(biome, roll) {
  return biome.props[Math.floor(roll * biome.props.length) % biome.props.length];
}

const levelData = Array.from({ length: 15 }, (_, i) => {
  const n = i + 1;
  const paths = mapLayouts[i];
  const features = makeFeatures(paths, n);
  return {
    id: n,
    name: `Stage ${n}`,
    rewardGems: 16 + n * 7,
    rewardXp: 105 + n * 48,
    baseHp: Math.max(10, 25 - Math.floor((n - 1) / 4) * 5),
    startCoins: startCoinsForStage(n),
    waves: n === 15 ? 25 : Math.min(25, 10 + Math.floor((n - 1) / 4) * 5),
    paths,
    boss: stageBosses[i],
    monsters: makeStageMonsters(n),
    backgroundBlockers: [],
    features,
  };
});

state.unlocked = new Set(STARTER_TOWER_IDS);
state.clearedStages = new Set(levelData.map((level) => level.id));

const els = {
  authScreen: document.querySelector("#authScreen"),
  showLogin: document.querySelector("#showLogin"),
  showSignup: document.querySelector("#showSignup"),
  authModal: document.querySelector("#authModal"),
  authTitle: document.querySelector("#authTitle"),
  closeAuth: document.querySelector("#closeAuth"),
  authUsername: document.querySelector("#authUsername"),
  authPassword: document.querySelector("#authPassword"),
  submitAuth: document.querySelector("#submitAuth"),
  authStatus: document.querySelector("#authStatus"),
  home: document.querySelector("#home"),
  game: document.querySelector("#game"),
  playerLevel: document.querySelector("#playerLevel"),
  playerXp: document.querySelector("#playerXp"),
  nextXp: document.querySelector("#nextXp"),
  xpFill: document.querySelector("#xpFill"),
  gems: document.querySelector("#gems"),
  levelList: document.querySelector("#levelList"),
  loadout: document.querySelector("#loadout"),
  towerGrid: document.querySelector("#towerGrid"),
  speedToggle: document.querySelector("#speedToggle"),
  metaCoins: document.querySelector("#metaCoins"),
  resultCoins: document.querySelector("#resultCoins"),
  openMobIndex: document.querySelector("#openMobIndex"),
  closeMobIndex: document.querySelector("#closeMobIndex"),
  mobIndexModal: document.querySelector("#mobIndexModal"),
  mobIndexList: document.querySelector("#mobIndexList"),
  mobIndexCount: document.querySelector("#mobIndexCount"),
  openLevels: document.querySelector("#openLevels"),
  closeLevels: document.querySelector("#closeLevels"),
  levelModal: document.querySelector("#levelModal"),
  levelTitle: document.querySelector("#levelTitle"),
  modeModal: document.querySelector("#modeModal"),
  closeMode: document.querySelector("#closeMode"),
  soloMode: document.querySelector("#soloMode"),
  multiplayerMode: document.querySelector("#multiplayerMode"),
  multiplayerModal: document.querySelector("#multiplayerModal"),
  closeMultiplayer: document.querySelector("#closeMultiplayer"),
  openSettings: document.querySelector("#openSettings"),
  closeSettings: document.querySelector("#closeSettings"),
  settingsModal: document.querySelector("#settingsModal"),
  toggleSfx: document.querySelector("#toggleSfx"),
  toggleMusic: document.querySelector("#toggleMusic"),
  codeButton: document.querySelector("#codeButton"),
  codeModal: document.querySelector("#codeModal"),
  closeCode: document.querySelector("#closeCode"),
  codeForm: document.querySelector("#codeForm"),
  codeInput: document.querySelector("#codeInput"),
  codeStatus: document.querySelector("#codeStatus"),
  codeNoteModal: document.querySelector("#codeNoteModal"),
  closeCodeNote: document.querySelector("#closeCodeNote"),
  openInventory: document.querySelector("#openInventory"),
  closeInventory: document.querySelector("#closeInventory"),
  inventoryModal: document.querySelector("#inventoryModal"),
  openDailyRewards: document.querySelector("#openDailyRewards"),
  closeDailyRewards: document.querySelector("#closeDailyRewards"),
  dailyRewardsModal: document.querySelector("#dailyRewardsModal"),
  dailyRewardsGrid: document.querySelector("#dailyRewardsGrid"),
  dailyStatus: document.querySelector("#dailyStatus"),
  dailyCountdown: document.querySelector("#dailyCountdown"),
  claimDailyReward: document.querySelector("#claimDailyReward"),
  openExchange: document.querySelector("#openExchange"),
  closeExchange: document.querySelector("#closeExchange"),
  exchangeModal: document.querySelector("#exchangeModal"),
  exchangeGems: document.querySelector("#exchangeGems"),
  exchangeCoins: document.querySelector("#exchangeCoins"),
  exchangeGemsToCoins: document.querySelector("#exchangeGemsToCoins"),
  exchangeCoinsToGems: document.querySelector("#exchangeCoinsToGems"),
  exchangeAmount: document.querySelector("#exchangeAmount"),
  exchangeAmountLabel: document.querySelector("#exchangeAmountLabel"),
  exchangePreview: document.querySelector("#exchangePreview"),
  confirmExchange: document.querySelector("#confirmExchange"),
  connectionStatus: document.querySelector("#connectionStatus"),
  createRoom: document.querySelector("#createRoom"),
  joinRoomForm: document.querySelector("#joinRoomForm"),
  roomCodeInput: document.querySelector("#roomCodeInput"),
  roomInfo: document.querySelector("#roomInfo"),
  chooseMultiplayerMap: document.querySelector("#chooseMultiplayerMap"),
  leaveRoom: document.querySelector("#leaveRoom"),
  resultModal: document.querySelector("#resultModal"),
  resultTitle: document.querySelector("#resultTitle"),
  resultGems: document.querySelector("#resultGems"),
  resultXp: document.querySelector("#resultXp"),
  resultCountdown: document.querySelector("#resultCountdown"),
  battleLoadout: document.querySelector("#battleLoadout"),
  selectedInfo: document.querySelector("#selectedInfo"),
  coins: document.querySelector("#coins"),
  baseHp: document.querySelector("#baseHp"),
  kills: document.querySelector("#kills"),
  towerCount: document.querySelector("#towerCount"),
  bossBar: document.querySelector("#bossBar"),
  bossName: document.querySelector("#bossName"),
  bossHpText: document.querySelector("#bossHpText"),
  bossHpCurrent: document.querySelector("#bossHpCurrent"),
  bossHpMax: document.querySelector("#bossHpMax"),
  bossHpTrail: document.querySelector("#bossHpTrail"),
  bossHpFill: document.querySelector("#bossHpFill"),
  waveBonus: document.querySelector("#waveBonus"),
  gameTitle: document.querySelector("#gameTitle"),
  waveText: document.querySelector("#waveText"),
  startWave: document.querySelector("#startWave"),
  leaveMatch: document.querySelector("#leaveMatch"),
  backHome: document.querySelector("#backHome"),
  sellTower: document.querySelector("#sellTower"),
  upgradeTower: document.querySelector("#upgradeTower"),
  toast: document.querySelector("#toast"),
};

const multiplayer = {
  socket: null,
  room: null,
  playerId: null,
  lastRoomCode: null,
  simOwnerId: null,
  choosingMap: false,
  active: false,
  waveStartTimer: null,
};
const MIN_PLAYERS_TO_START = 1;
const MAX_MULTIPLAYER_PLAYERS = 4;

function isMultiplayerGame() {
  return multiplayer.active && multiplayer.socket?.connected;
}

function isHostPlayer() {
  return multiplayer.room?.hostId === multiplayer.socket?.id;
}

function isSimulationOwner() {
  return (multiplayer.simOwnerId || multiplayer.room?.hostId) === multiplayer.socket?.id;
}

function towerOwnerName(ownerId) {
  return multiplayer.room?.players.find((player) => player.id === ownerId)?.name || "Another player";
}

function ownPlacedTowers() {
  if (!isMultiplayerGame()) return state.placed;
  return state.placed.filter((tower) => tower.ownerId === multiplayer.socket.id);
}

function activeLoadout() {
  const equipped = state.loadout.filter((id) => towerById(id));
  return equipped.length ? equipped.slice(0, 5) : [...STARTER_TOWER_IDS];
}

function removePlayerTowers(ownerId, towerIds = []) {
  if (!ownerId && !towerIds.length) return;
  const removedIds = new Set(towerIds);
  state.placed = state.placed.filter((tower) => tower.ownerId !== ownerId && !removedIds.has(tower.uid));
  state.soldiers = state.soldiers.filter((soldier) => soldier.owner?.ownerId !== ownerId && !removedIds.has(soldier.owner?.uid));
  if (state.selectedPlaced && (state.selectedPlaced.ownerId === ownerId || removedIds.has(state.selectedPlaced.uid))) {
    state.selectedPlaced = null;
    resetSellConfirmation();
  }
  updateHud();
}

function towerById(id) {
  return towers.find((tower) => tower.id === id);
}

const notificationMotion = new WeakMap();
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function animateNotification(element, duration, clearText = false) {
  const previous = notificationMotion.get(element);
  if (previous) {
    clearTimeout(previous.timer);
    previous.animations.forEach((animation) => animation.cancel());
  }
  const motion = { animations: [], timer: null };
  notificationMotion.set(element, motion);
  element.classList.add("show");
  const boss = element.classList.contains("toast-boss");
  const fromTop = boss || element === els.waveBonus;
  const resting = "translate(-50%, 0) scale(1)";
  const frames = reducedMotion.matches
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [
      { opacity: 0, transform: `translate(-50%, ${fromTop ? -24 : 24}px) scale(${boss ? .78 : .88})`, offset: 0 },
      { opacity: 1, transform: `translate(-50%, ${fromTop ? 3 : -3}px) scale(${boss ? 1.06 : 1.025})`, offset: .7 },
      { opacity: 1, transform: resting, offset: 1 },
    ];
  motion.animations.push(element.animate(frames, {
    duration: reducedMotion.matches ? 140 : boss ? 580 : 420,
    easing: "cubic-bezier(.2,.75,.25,1)",
  }));
  if (!reducedMotion.matches) {
    const accent = getComputedStyle(element).getPropertyValue("--notice-accent").trim() || "#90caff";
    motion.animations.push(element.animate([
      { boxShadow: `0 0 0 0 ${accent}, 0 8px 24px #0006` },
      { boxShadow: `0 0 0 7px transparent, 0 0 24px ${accent}`, offset: .45 },
      { boxShadow: "0 0 0 10px transparent, 0 8px 24px #0006" },
    ], { duration: boss ? 950 : 720, easing: "ease-out" }));
  }
  motion.timer = setTimeout(() => {
    const exit = element.animate(reducedMotion.matches
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [{ opacity: 1, transform: resting }, { opacity: 0, transform: `translate(-50%, ${fromTop ? -12 : 12}px) scale(.96)` }],
    { duration: reducedMotion.matches ? 120 : 260, easing: "ease-in", fill: "forwards" });
    motion.animations.push(exit);
    exit.onfinish = () => {
      if (notificationMotion.get(element) !== motion) return;
      element.classList.remove("show");
      if (clearText) element.textContent = "";
      motion.animations.forEach((animation) => animation.cancel());
      notificationMotion.delete(element);
    };
  }, duration);
}

function toast(message, type = "info") {
  els.toast.textContent = message;
  els.toast.className = `toast toast-${type}${state.screen === "game" ? " game-toast" : ""}`;
  const duration = type === "boss" ? 3200 : type === "discovery" ? 2600 : type === "reward" ? 2200 : 1800;
  animateNotification(els.toast, duration);
}

function setButtonLabel(button, label) {
  const text = document.createElement("span");
  text.className = "button-label";
  text.textContent = label;
  button.replaceChildren(text);
}

function resetSellConfirmation() {
  state.sellConfirmTower = null;
  clearTimeout(resetSellConfirmation.timer);
  if (!els.sellTower) return;
  setButtonLabel(els.sellTower, "Sell Selected");
  els.sellTower.classList.remove("danger-button");
}

function announceWaveBonus(amount) {
  if (!els.waveBonus) return;
  cancelAnimationFrame(announceWaveBonus.countFrame);
  els.waveBonus.innerHTML = `<span class="wave-reward-emblem" aria-hidden="true">✦</span>
    <span class="wave-reward-copy"><small>WAVE BONUS</small><strong>+<span class="wave-reward-count"></span> <span class="wave-reward-unit">COINS</span></strong></span>
    <span class="wave-reward-shine" aria-hidden="true"></span>`;
  const counter = els.waveBonus.querySelector(".wave-reward-count");
  counter.textContent = reducedMotion.matches ? String(amount) : "0";
  animateNotification(els.waveBonus, 5000, true);
  if (!reducedMotion.matches) {
    const started = performance.now();
    const countUp = (now) => {
      if (!counter.isConnected) return;
      const progress = Math.max(0, Math.min(1, (now - started) / 720));
      counter.textContent = String(Math.round(amount * (1 - (1 - progress) ** 3)));
      if (progress < 1) announceWaveBonus.countFrame = requestAnimationFrame(countUp);
    };
    announceWaveBonus.countFrame = requestAnimationFrame(countUp);
  }
}

function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysBetween(startKey, endKey = dateKey()) {
  if (!startKey) return Infinity;
  const start = new Date(`${startKey}T00:00:00`);
  const end = new Date(`${endKey}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return Infinity;
  return Math.round((end - start) / 86400000);
}

function cleanDailyRewards(dailyRewards = {}) {
  const day = Math.max(1, Math.min(7, Math.floor(Number(dailyRewards.day) || 1)));
  const lastClaimDate = typeof dailyRewards.lastClaimDate === "string" ? dailyRewards.lastClaimDate : null;
  let lastClaimedDay = dailyRewards.lastClaimedDay
    ? Math.max(1, Math.min(7, Math.floor(Number(dailyRewards.lastClaimedDay))))
    : null;
  let claimedDays = Array.isArray(dailyRewards.claimedDays)
    ? [...new Set(dailyRewards.claimedDays
      .map((claimedDay) => Math.max(1, Math.min(7, Math.floor(Number(claimedDay) || 0))))
      .filter(Boolean))]
    : [];
  if (lastClaimDate === dateKey() && !claimedDays.length) {
    lastClaimedDay = day === 1 ? 7 : day - 1;
    claimedDays = [lastClaimedDay];
  }
  return { day, lastClaimDate, lastClaimedDay, claimedDays };
}

function refreshDailyStreak() {
  state.dailyRewards = cleanDailyRewards(state.dailyRewards);
  const gap = daysBetween(state.dailyRewards.lastClaimDate);
  if (gap > 1) {
    state.dailyRewards.day = 1;
    state.dailyRewards.lastClaimDate = null;
    state.dailyRewards.lastClaimedDay = null;
    state.dailyRewards.claimedDays = [];
    return true;
  }
  if (gap === 1 && state.dailyRewards.lastClaimedDay === 7) {
    state.dailyRewards.claimedDays = [];
    state.dailyRewards.lastClaimedDay = null;
    return true;
  }
  return false;
}

function currentDailyReward() {
  refreshDailyStreak();
  return DAILY_REWARDS[state.dailyRewards.day - 1] || DAILY_REWARDS[0];
}

function dailyRewardClaimedToday() {
  refreshDailyStreak();
  return state.dailyRewards.lastClaimDate === dateKey();
}

function rewardLabel(reward) {
  return reward.type === "gems" ? `${reward.amount} gems` : `${reward.amount} XP`;
}

function msUntilNextDailyReward() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return Math.max(0, next - now);
}

function formatCountdown(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function updateDailyCountdown() {
  const claimedToday = dailyRewardClaimedToday();
  if (els.openDailyRewards) els.openDailyRewards.classList.toggle("has-reward", !claimedToday);
  if (!els.dailyCountdown) return;
  els.dailyCountdown.textContent = claimedToday
    ? `Next reward in ${formatCountdown(msUntilNextDailyReward())}`
    : "Next reward is ready now.";
}

function startDailyCountdown() {
  stopDailyCountdown();
  updateDailyCountdown();
  startDailyCountdown.timer = setInterval(() => {
    updateDailyCountdown();
    if (!dailyRewardClaimedToday()) {
      renderDailyRewards();
    }
  }, 1000);
}

function stopDailyCountdown() {
  clearInterval(startDailyCountdown.timer);
}

function renderDailyRewards() {
  if (!els.dailyRewardsGrid) return;
  const reward = currentDailyReward();
  const claimedToday = dailyRewardClaimedToday();
  const claimedDays = new Set(state.dailyRewards.claimedDays);
  els.dailyStatus.textContent = claimedToday
    ? "Today's reward is claimed. Come back tomorrow."
    : `Day ${reward.day} is ready: ${rewardLabel(reward)}.`;
  els.claimDailyReward.disabled = claimedToday;
  els.claimDailyReward.textContent = claimedToday ? "Claimed Today" : `Claim Day ${reward.day}`;
  updateDailyCountdown();
  els.dailyRewardsGrid.innerHTML = DAILY_REWARDS.map((item) => {
    const isCurrent = !claimedToday && item.day === reward.day;
    const isClaimed = claimedDays.has(item.day);
    return `
      <article class="daily-reward day-${item.day} ${isCurrent ? "current" : ""} ${isClaimed ? "claimed" : ""}">
        <span>Day ${item.day}</span>
        <b>${rewardLabel(item)}</b>
        <small>${isClaimed ? "Claimed" : isCurrent ? "Ready" : "Streak reward"}</small>
      </article>
    `;
  }).join("");
}

function claimDailyReward() {
  const reward = currentDailyReward();
  if (dailyRewardClaimedToday()) return toast("Come back tomorrow");
  if (reward.type === "gems") {
    state.gems += reward.amount;
  } else {
    addXp(reward.amount);
  }
  state.dailyRewards.lastClaimDate = dateKey();
  state.dailyRewards.lastClaimedDay = reward.day;
  state.dailyRewards.claimedDays = [...new Set([...state.dailyRewards.claimedDays, reward.day])];
  state.dailyRewards.day = reward.day >= 7 ? 1 : reward.day + 1;
  sound.coins();
  save();
  renderHome();
  renderDailyRewards();
  toast(`Claimed ${rewardLabel(reward)}`, "reward");
}

function saveDataFromState() {
  return {
    towerVersion: 2,
    playerLevel: state.playerLevel,
    xp: state.xp,
    gems: state.gems,
    unlocked: [...state.unlocked],
    clearedStages: [...state.clearedStages],
    stageStars: state.stageStars,
    dailyRewards: state.dailyRewards,
    metaCoins: state.metaCoins,
    towerLevels: state.towerLevels,
    mobIndex: [...state.mobIndex],
    loadout: state.loadout,
    redeemedCodes: [...state.redeemedCodes],
  };
}

function applySaveData(data) {
  if (!data || typeof data !== "object") return;
  state.playerLevel = data.playerLevel || 1;
  state.xp = data.xp || 0;
  state.gems = data.gems ?? 30;
  state.unlocked = new Set((data.unlocked || STARTER_TOWER_IDS)
    .map((id) => (id === "cannon" ? "barracks" : id === "nova" ? "ranger" : id))
    .filter((id) => towerById(id)));
  state.clearedStages = new Set(data.clearedStages || []);
  state.stageStars = data.stageStars && typeof data.stageStars === "object" ? data.stageStars : {};
  state.dailyRewards = cleanDailyRewards(data.dailyRewards);
  state.metaCoins = Math.max(0, Math.floor(Number(data.metaCoins) || 0));
  state.towerLevels = data.towerLevels && typeof data.towerLevels === "object" ? data.towerLevels : {};
  state.mobIndex = new Set(Array.isArray(data.mobIndex) ? data.mobIndex : []);
  state.redeemedCodes = new Set(data.redeemedCodes || []);
  state.loadout = (data.loadout || state.loadout)
    .map((id) => (id === "cannon" ? "barracks" : id === "nova" ? "ranger" : id))
    .filter((id, index, list) => state.unlocked.has(id) && list.indexOf(id) === index)
    .slice(0, 5);
  if (!state.loadout.length) state.loadout = [...STARTER_TOWER_IDS];
}

function save() {
  const data = saveDataFromState();
  localStorage.setItem("hardline-td-save", JSON.stringify(data));
  queueAccountSave();
}

function load() {
  try {
    const data = JSON.parse(localStorage.getItem("hardline-td-save"));
    if (!data) return;
    applySaveData(data);
    const dailyWasReset = refreshDailyStreak();
    if (dailyWasReset) save();
  } catch {
    localStorage.removeItem("hardline-td-save");
  }
}

let authMode = "login";
let accountSaveTimer = null;
let accountHeartbeatTimer = null;

function authHeaders() {
  return state.authToken ? { Authorization: `Bearer ${state.authToken}` } : {};
}

function showAuthStatus(message, type = "") {
  if (!els.authStatus) return;
  els.authStatus.textContent = message;
  els.authStatus.className = `auth-status ${type}`.trim();
}

function openAuth(mode) {
  authMode = mode;
  els.authTitle.textContent = mode === "signup" ? "Sign Up" : "Login";
  els.submitAuth.textContent = mode === "signup" ? "Create Account" : "Login";
  els.authPassword.autocomplete = mode === "signup" ? "new-password" : "current-password";
  els.authUsername.value = "";
  els.authPassword.value = "";
  showAuthStatus("");
  openModal(els.authModal);
  setTimeout(() => els.authUsername.focus(), 0);
}

function showAuthGate() {
  state.screen = "auth";
  els.authScreen.classList.add("active");
  els.home.classList.remove("active");
  els.game.classList.remove("active");
}

function showHomeAfterAuth(username, token, saveData) {
  state.account = username;
  state.authToken = token;
  if (token) localStorage.setItem("ironclad-td-token", token);
  localStorage.setItem("ironclad-td-user", username);
  if (saveData) applySaveData(saveData);
  localStorage.setItem("hardline-td-save", JSON.stringify(saveDataFromState()));
  els.authScreen.classList.remove("active");
  closeModal(els.authModal);
  switchScreen("home");
  renderHome();
  if (token) startAccountHeartbeat();
}

async function submitAuth(event) {
  event.preventDefault();
  const username = els.authUsername.value.trim();
  const password = els.authPassword.value;
  if (!username || !password) {
    showAuthStatus("Enter a username and password.", "error");
    return;
  }
  els.submitAuth.disabled = true;
  showAuthStatus(authMode === "signup" ? "Creating account..." : "Logging in...");
  try {
    const response = await fetch(`/api/auth/${authMode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        password,
        saveData: authMode === "signup" ? saveDataFromState() : undefined,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      showAuthStatus(data.error || "Account request failed.", "error");
      return;
    }
    showAuthStatus("Success", "success");
    showHomeAfterAuth(data.username, data.token, data.saveData);
  } catch {
    showAuthStatus("Start the local server first, then try again.", "error");
  } finally {
    els.submitAuth.disabled = false;
  }
}

async function resumeAccountSession() {
  const token = localStorage.getItem("ironclad-td-token");
  if (!token) {
    showAuthGate();
    return;
  }
  state.authToken = token;
  try {
    const response = await fetch("/api/auth/me", { headers: authHeaders() });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Session expired");
    showHomeAfterAuth(data.username, token, data.saveData);
  } catch {
    state.authToken = null;
    state.account = null;
    localStorage.removeItem("ironclad-td-token");
    localStorage.removeItem("ironclad-td-user");
    showAuthGate();
  }
}

function queueAccountSave() {
  if (!state.authToken) return;
  clearTimeout(accountSaveTimer);
  accountSaveTimer = setTimeout(syncAccountSave, 350);
}

async function syncAccountSave() {
  if (!state.authToken) return;
  try {
    const response = await fetch("/api/auth/save", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ saveData: saveDataFromState() }),
    });
    if (response.status === 401) {
      state.authToken = null;
      localStorage.removeItem("ironclad-td-token");
      toast("Account logged out. Login again.");
      showAuthGate();
    }
  } catch {
    // Keep local progress; the next save will try syncing again.
  }
}

function startAccountHeartbeat() {
  clearInterval(accountHeartbeatTimer);
  accountHeartbeatTimer = setInterval(async () => {
    if (!state.authToken) return;
    try {
      const response = await fetch("/api/auth/heartbeat", {
        method: "POST",
        headers: authHeaders(),
      });
      if (response.status === 401) {
        clearInterval(accountHeartbeatTimer);
        state.authToken = null;
        localStorage.removeItem("ironclad-td-token");
        toast("Login expired.");
        showAuthGate();
      }
    } catch {
      // If the server briefly drops, keep the local game open.
    }
  }, 15000);
}

function addXp(amount) {
  state.xp += amount;
  while (state.xp >= state.playerLevel * 120) {
    state.xp -= state.playerLevel * 120;
    state.playerLevel += 1;
    toast(`Player level ${state.playerLevel} reached`, "reward");
  }
}

const MOB_SHAPE_GROUPS = [
  ["brute", "Brutes"],
  ["armored", "Armored"],
  ["runner", "Runners"],
  ["winged", "Winged"],
  ["spiked", "Spiked"],
];

function allIndexMonsters() {
  const seen = new Set();
  return [...stageMonsters.flat(), ...extraMonsters].filter((monster) => {
    if (seen.has(monster.name)) return false;
    seen.add(monster.name);
    return true;
  });
}

function recordMobDiscovery(mob) {
  const key = mob.boss ? mob.bossName : mob.monsterName;
  if (!key || state.mobIndex.has(key)) return;
  state.mobIndex.add(key);
  toast(`New mob recorded: ${key}`, "discovery");
  save();
}

const mobPortraitCache = new Map();
const MOB_ART_NAMES = [
  "Mudling",
  "Mossback",
  "Rot Grub",
  "Marrow Hulk",
  "Thunder Brute",
  "Doom Hulk",
  "Root Mauler",
  "Tar Blob",
  "Magma Ox",
  "Rust Crawler",
  "Coal Golem",
  "Iron Mite",
  "Stonejaw",
  "Lava Guard",
  "Shell Bug",
  "Grave Worm",
  "Bone Knight",
  "Briar Imp",
  "Cinder Hound",
  "Blood Skitter",
  "Dread Stalker",
  "Bog Runner",
  "Hell Pup",
  "Dust Rat",
  "Soot Skipper",
  "Acid Nibbler",
  "Ash Sprite",
  "Shardling",
  "Plague Bat",
  "Phase Imp",
  "Storm Wisp",
  "Moon Bat",
  "Gloom Bat",
  "Ember Moth",
  "Rune Wisp",
  "Feral Wisp",
  "Needle Fiend",
  "Frost Wretch",
  "Gear Imp",
  "Void Leech",
  "Thornback",
  "Night Shard",
  "Final Horror",
  "Glass Imp",
  "Crystal Creep",
  "Hook Fiend",
  "Grimjaw",
  "Nightclaw",
  "Bonehide",
  "Ashmaw",
  "Frostfang",
  "Rotspike",
  "Ironhorn",
  "Bloodwing",
  "Voidbite",
  "Dreadeye",
  "Stoneback",
  "Venomlord",
  "Stormskull",
  "Hellgrin",
  "The Last Horror"
];
const mobArtIndices = new Map(MOB_ART_NAMES.map((name, index) => [name, index]));
const mobArtAtlas = new Image();
let mobArtReady = false;

function preloadMobArt() {
  mobArtAtlas.onload = () => {
    mobArtReady = true;
    mobPortraitCache.clear();
    if (els.mobIndexModal.classList.contains("open")) renderMobIndex();
  };
  mobArtAtlas.onerror = () => {
    console.warn("Mob artwork could not load; using the built-in fallback.");
  };
  mobArtAtlas.src = "./assets/mob-art-v2/sprites.webp?v=1";
}

function mobArtCell(name) {
  const index = mobArtIndices.get(name);
  if (!mobArtReady || index === undefined) return null;
  return { x: (index % 8) * 256, y: Math.floor(index / 8) * 256 };
}

function drawGeneratedMob(mob, size) {
  const cell = mobArtCell(mob.boss ? mob.bossName : mob.monsterName);
  if (!cell) return false;
  const dimension = size * 3;
  ctx.save();
  ctx.fillStyle = "#0b0d1044";
  ctx.beginPath();
  ctx.ellipse(mob.x, mob.y + size * .78, size * .8, size * .22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.drawImage(mobArtAtlas, cell.x, cell.y, 256, 256,
    mob.x - dimension / 2, mob.y - dimension * .54, dimension, dimension);
  ctx.restore();
  return true;
}

function drawMobHealthBar(mob, topOffset = 24) {
  ctx.fillStyle = "#111417";
  ctx.fillRect(mob.x - 18, mob.y - topOffset, 36, 5);
  ctx.fillStyle = mob.hp / mob.maxHp > 0.45 ? "#79d77b" : "#ec675d";
  ctx.fillRect(mob.x - 18, mob.y - topOffset, Math.max(0, 36 * (mob.hp / mob.maxHp)), 5);
}

function mobPortraitDataUrl(key, monster, boss) {
  if (mobPortraitCache.has(key)) return mobPortraitCache.get(key);
  const cell = mobArtCell(boss?.name || monster?.name);
  if (cell) {
    const portrait = document.createElement("canvas");
    portrait.width = portrait.height = 120;
    portrait.getContext("2d").drawImage(mobArtAtlas, cell.x, cell.y, 256, 256, 0, 0, 120, 120);
    const url = portrait.toDataURL();
    mobPortraitCache.set(key, url);
    return url;
  }
  const region = 150;
  const shape = monster?.shape || "normal";
  const size = boss ? 22 : shape === "armored" || shape === "brute" ? 17 : shape === "runner" || shape === "winged" ? 13 : 14;
  const scale = (region / 2 - 8) / (size * 1.72);
  ctx.save();
  ctx.clearRect(0, 0, region, region);
  ctx.scale(scale, scale);
  drawMob({
    x: region / 2 / scale,
    y: (region / 2 + size * scale * 0.16) / scale,
    portrait: true,
    boss: Boolean(boss),
    heavy: false,
    monsterName: monster?.name,
    monsterColor: monster?.color,
    monsterEdge: monster?.edge,
    monsterEye: monster?.eye,
    monsterShape: monster?.shape || "normal",
    bossName: boss?.name,
    bossColor: boss?.color,
    hp: 1,
    maxHp: 1,
    slowTimer: 0,
    poisonTimer: 0,
    burnTimer: 0,
    shockTimer: 0,
    voidTimer: 0,
    dot: 0,
  });
  const out = document.createElement("canvas");
  out.width = 120;
  out.height = 120;
  out.getContext("2d").drawImage(canvas, 0, 0, region, region, 0, 0, 120, 120);
  ctx.clearRect(0, 0, region, region);
  ctx.restore();
  const url = out.toDataURL();
  mobPortraitCache.set(key, url);
  return url;
}

const towerPortraitCache = new Map();
const towerUiImages = new Map();
const TOWER_UI_VERSION = 5;
// Ground-level selection ovals follow the pedestal, not the weapon or level badge.
// Offsets are relative to the unchanged ground/placement anchor.
const TOWER_SELECTION_RINGS = {
  dart: { x: 0, y: -8, radiusX: 32, radiusY: 12 },
  ice: { x: 0, y: -8, radiusX: 30, radiusY: 12 },
  spark: { x: 0, y: -8, radiusX: 29, radiusY: 12 },
  sniper: { x: 0, y: -8, radiusX: 29, radiusY: 12 },
  venom: { x: 0, y: -8, radiusX: 31, radiusY: 12 },
  bank: { x: 1, y: -8, radiusX: 34, radiusY: 12 },
  tesla: { x: 0, y: -8, radiusX: 30, radiusY: 12 },
  ember: { x: 0, y: -8, radiusX: 33, radiusY: 12 },
  haste: { x: 1, y: -8, radiusX: 32, radiusY: 12 },
  power: { x: 0, y: -8, radiusX: 32, radiusY: 12 },
  void: { x: 0, y: -8, radiusX: 33, radiusY: 12 },
  barracks: { x: 0, y: -8, radiusX: 33, radiusY: 12 },
  ranger: { x: 0, y: -8, radiusX: 33, radiusY: 12 },
  rail: { x: 0, y: -8, radiusX: 28, radiusY: 12 },
  orbital: { x: 0, y: -8, radiusX: 35, radiusY: 12 },
};
const DEFAULT_TOWER_SELECTION_RING = { x: 0, y: 6, radiusX: 26, radiusY: 12 };
const TOWER_BASE_CLEARANCE = 4; // Includes the white outlines' 2.5px stroke.

function towerSelectionRing(towerId) {
  return TOWER_SELECTION_RINGS[towerId] || DEFAULT_TOWER_SELECTION_RING;
}
const stageBackgroundImages = new Map();
const STAGE_BACKGROUND_VERSION = 2;

function towerPortraitDataUrl(tower) {
  if (towerPortraitCache.has(tower.id)) return towerPortraitCache.get(tower.id);
  const url = `./assets/tower-ui-v2/${tower.id}.png?v=${TOWER_UI_VERSION}`;
  towerPortraitCache.set(tower.id, url);
  return url;
}

function towerUiImage(tower) {
  if (!tower?.id) return null;
  if (!towerUiImages.has(tower.id)) {
    const img = new Image();
    img.src = towerPortraitDataUrl(tower);
    towerUiImages.set(tower.id, img);
  }
  const img = towerUiImages.get(tower.id);
  return img.complete && img.naturalWidth ? img : null;
}

function preloadTowerUiImages() {
  towers.forEach((tower) => towerUiImage(tower));
}

function stageBackgroundImage(stageId) {
  if (!stageId) return null;
  if (!stageBackgroundImages.has(stageId)) {
    const img = new Image();
    img.src = `./assets/stage-backgrounds/stage-${String(stageId).padStart(2, "0")}.webp?v=${STAGE_BACKGROUND_VERSION}`;
    stageBackgroundImages.set(stageId, img);
  }
  const img = stageBackgroundImages.get(stageId);
  return img.complete && img.naturalWidth ? img : null;
}

function preloadStageBackgrounds() {
  levelData.forEach((level) => stageBackgroundImage(level.id));
}

function mobFirstEncounter(name) {
  for (const level of levelData) {
    const found = (level.monsters || []).find((m) => m.name === name);
    if (found) return { stage: level.id, monster: found };
  }
  return null;
}

function mobStageAppearances(name) {
  return levelData
    .filter((level) => (level.monsters || []).some((monster) => monster.name === name))
    .map((level) => level.id);
}

function stageListLabel(stages) {
  if (!stages.length) return "Unknown";
  return `Stage${stages.length === 1 ? "" : "s"} ${stages.join(", ")}`;
}

function mobBaselineStats(baseMonster) {
  const encounter = mobFirstEncounter(baseMonster.name);
  const stages = mobStageAppearances(baseMonster.name);
  const stage = encounter ? encounter.stage : 1;
  const m = encounter ? encounter.monster : baseMonster;
  const stagePressure = 1 + Math.min(0.08, Math.max(0, (stage - 1) * 0.006));
  const stageCountScale = stage === 15 ? 0.92 : 1;
  const hp = Math.round((14 + stage * 5) * stagePressure * m.hp * 0.78 * stageCountScale);
  const speed = Math.round((37 + stage * 0.85) * 1.08 * (1 + (m.speed - 1) * 0.7));
  const bounty = Math.max(1, Math.round((9 + Math.floor(stage * 1.5)) * m.reward));
  const damage = Math.max(1, Math.round(m.damage * 0.75));
  const speedLabel = m.speed < 0.8 ? "Slow" : m.speed <= 1.05 ? "Normal" : m.speed <= 1.35 ? "Fast" : "Very fast";
  return { stage, stages, hp, speed, bounty, damage, speedLabel };
}

function bossIndexStats(stageNumber) {
  const level = levelData[stageNumber - 1];
  const stage = level?.id || stageNumber;
  const baseHp = 14 + stage * 5;
  const waves = level?.waves || 1;
  const waveHpScale = waveHealthScale(stage, waves, waves);
  const speed = (37 + stage * 0.85 + 16 + stage * 0.7) * 1.08;
  const stagePressure = 1 + Math.min(0.08, Math.max(0, (stage - 1) * 0.006));
  const stageBossScale = 4.2 + stage * 0.18;
  const hp = baseHp * waveHpScale * (7.5 + stage * 0.48) * stagePressure * stageBossScale * 1.8 * lateStageBossHpScale(stage);
  return {
    hp: Math.round(hp),
    speed: Math.round(speed * 0.56),
    damage: 5 + Math.floor(stage / 5),
    bounty: (10 + Math.floor(stage * 1.5)) * 15 * 3,
  };
}

function mobCardMarkup(monster, found) {
  if (!found) {
    const silhouette = mobPortraitDataUrl(`m:${monster.name}`, monster, null);
    return `
      <article class="mob-card unknown">
        <img class="mob-portrait mob-silhouette" src="${silhouette}" alt="Unknown mob silhouette">
        <b>???</b>
        <small>Defeat one to record it</small>
      </article>
    `;
  }
  const portrait = mobPortraitDataUrl(`m:${monster.name}`, monster, null);
  const stats = mobBaselineStats(monster);
  return `
      <article class="mob-card">
      <img class="mob-portrait" src="${portrait}" alt="${monster.name}">
      <b>${monster.name}</b>
      <div class="mob-stage-list"><small>Appears</small><span>${stageListLabel(stats.stages)}</span></div>
      <div class="mob-stat-grid">
        <span class="mob-stat hp"><small>HP</small><b>${stats.hp}</b></span>
        <span class="mob-stat speed"><small>${stats.speedLabel}</small><b>${stats.speed}</b></span>
        <span class="mob-stat damage"><small>Damage</small><b>${stats.damage}</b></span>
        <span class="mob-stat bounty"><small>Bounty</small><b>${stats.bounty}</b></span>
      </div>
    </article>
  `;
}

function bossCardMarkup(boss, stageNumber, found) {
  if (!found) {
    const silhouette = mobPortraitDataUrl(`b:${boss.name}`, null, boss);
    return `
      <article class="mob-card unknown boss">
        <img class="mob-portrait mob-silhouette" src="${silhouette}" alt="Unknown boss silhouette">
        <b>???</b>
        <small>Stage ${stageNumber} boss</small>
      </article>
    `;
  }
  const portrait = mobPortraitDataUrl(`b:${boss.name}`, null, boss);
  const stats = bossIndexStats(stageNumber);
  return `
    <article class="mob-card boss">
      <img class="mob-portrait" src="${portrait}" alt="${boss.name}">
      <b>${boss.name}</b>
      <div class="mob-stage-chip">Stage ${stageNumber} Boss</div>
      <div class="mob-stat-grid">
        <span class="mob-stat hp"><small>HP</small><b>${stats.hp}</b></span>
        <span class="mob-stat speed"><small>Speed</small><b>${stats.speed}</b></span>
        <span class="mob-stat damage"><small>Base</small><b>KO</b></span>
        <span class="mob-stat bounty"><small>Bounty</small><b>${stats.bounty}</b></span>
      </div>
    </article>
  `;
}

function mobIndexSection(label, cards, foundCount, totalCount) {
  return `
    <section class="mob-index-section">
      <h3>${label} <span>${foundCount} / ${totalCount}</span></h3>
      <div class="mob-index-grid">${cards.join("")}</div>
    </section>
  `;
}

function renderMobIndex() {
  const monsters = allIndexMonsters();
  const found = (name) => state.mobIndex.has(name);
  const totalFound = monsters.filter((m) => found(m.name)).length + stageBosses.filter((b) => found(b.name)).length;
  els.mobIndexCount.textContent = `${totalFound} / ${monsters.length + stageBosses.length} discovered`;
  const sections = MOB_SHAPE_GROUPS.map(([shape, label]) => {
    const group = monsters.filter((monster) => monster.shape === shape);
    if (!group.length) return "";
    const foundCount = group.filter((m) => found(m.name)).length;
    return mobIndexSection(label, group.map((m) => mobCardMarkup(m, found(m.name))), foundCount, group.length);
  }).join("");
  const bossFound = stageBosses.filter((b) => found(b.name)).length;
  const bossSection = mobIndexSection(
    "Bosses",
    stageBosses.map((boss, i) => bossCardMarkup(boss, i + 1, found(boss.name))),
    bossFound,
    stageBosses.length
  );
  els.mobIndexList.innerHTML = sections + bossSection;
}

function renderHome() {
  refreshDailyStreak();
  const nextXp = state.playerLevel * 120;
  els.playerLevel.textContent = state.playerLevel;
  els.playerXp.textContent = state.xp;
  els.nextXp.textContent = nextXp;
  els.xpFill.style.width = `${Math.min(100, (state.xp / nextXp) * 100)}%`;
  els.gems.textContent = state.gems;
  if (els.metaCoins) els.metaCoins.textContent = state.metaCoins;
  renderExchange();
  els.loadout.innerHTML = "";
  for (let i = 0; i < 5; i += 1) {
    const id = state.loadout[i];
    const tower = id ? towerById(id) : null;
    const slot = document.createElement("button");
    slot.className = `loadout-slot ${id ? "filled" : ""}`;
    if (tower) {
      slot.style.setProperty("--tc", tower.color);
      slot.innerHTML = `<img src="${towerPortraitDataUrl(tower)}" alt=""><span>${tower.name}</span>`;
    } else {
      slot.textContent = "Empty";
    }
    if (id && tower) slot.onclick = () => removeFromLoadout(id);
    els.loadout.append(slot);
  }

  renderDailyRewards();

  renderLevelList();

  els.towerGrid.innerHTML = "";
  towers.forEach((tower) => {
    const unlocked = state.unlocked.has(tower.id);
    const levelLocked = state.playerLevel < tower.unlockLevel;
    const inLoadout = state.loadout.includes(tower.id);
    const stats = towerStatsAtLevel(tower, 1);
    const card = document.createElement("article");
    card.className = `tower-card ${unlocked ? "" : "locked"}`;
    const statMarkup = tower.kind === "support"
      ? `
        <span>Aura <b>${formatStat(stats.range)}</b></span>
        ${tower.id === "haste" ? `<span>Fire Rate <b>${percentLabel(stats.fireRateBoost || 0)}</b></span>` : ""}
        ${tower.id === "power" ? `<span>Damage <b>${percentLabel(stats.damageBoost || 0)}</b></span>` : ""}
      `
      : tower.id === "orbital"
        ? `
          <span>Beam DPS <b>${formatStat(stats.beamDamage)}</b></span>
          <span>Range <b>${formatStat(stats.range)}</b></span>
          <span class="continuous-stat">Beam <b>Continuous</b></span>
        `
        : tower.kind === "summon"
          ? `
            <span>HP <b>${formatStat(stats.soldierHp)}</b></span>
            <span>Speed <b>${formatStat(stats.soldierSpeed)}</b></span>
            <span>Spawn <b>${formatStat(stats.reload)}s</b></span>
          `
        : `
          <span>Dmg <b>${formatStat(stats.damage)}</b></span>
          <span>Range <b>${stats.range ? formatStat(stats.range) : "none"}</b></span>
          <span>Reload <b>${formatStat(stats.reload)}s</b></span>
        `;
    const metaLevel = towerMetaLevel(tower.id);
    card.style.setProperty("--tc", tower.color);
    card.innerHTML = `
      <div class="tower-card-head">
        <div>
          <h3 style="color:${tower.color}">${tower.name}</h3>
          <div class="tower-meta">
            <span class="chip">${tower.kind}</span>
            <span class="chip">${tower.cost} coins</span>
            <span class="chip">Level ${tower.unlockLevel}</span>
            <span class="chip">${tower.gems} gems</span>
            <span class="chip meta-level-chip">Lv ${metaLevel}/10</span>
          </div>
        </div>
        <img class="tower-card-art" src="${towerPortraitDataUrl(tower)}" alt="">
      </div>
      <div class="tower-stats" style="display:grid">
        ${statMarkup}
      </div>
      <div class="tower-effects" style="display:grid">
        ${towerEffectMarkup(tower, stats)}
      </div>
      <p class="tower-description" style="display:block">${tower.description}</p>
    `;
    const actions = document.createElement("div");
    actions.className = "tower-actions";
    if (!unlocked) {
      const buy = document.createElement("button");
      buy.textContent = levelLocked ? `Need level ${tower.unlockLevel} - ${tower.gems} gems` : `Buy ${tower.gems} gems`;
      buy.disabled = levelLocked || state.gems < tower.gems;
      buy.onclick = () => unlockTower(tower);
      actions.append(buy);
    } else {
      const pick = document.createElement("button");
      pick.textContent = inLoadout ? "Unequip" : "Equip";
      pick.className = inLoadout ? "danger-button" : "";
      pick.disabled = !inLoadout && state.loadout.length >= 5;
      pick.onclick = () => (inLoadout ? removeFromLoadout(tower.id) : addToLoadout(tower.id));
      actions.append(pick);
      const up = document.createElement("button");
      if (metaLevel >= 10) {
        up.textContent = "Max Level";
        up.disabled = true;
      } else {
        const cost = towerLevelUpCost(metaLevel);
        up.textContent = `Level Up - ${cost} coins`;
        up.disabled = state.metaCoins < cost;
        up.onclick = () => levelUpTower(tower.id);
      }
      up.classList.add("level-up-button");
      actions.append(up);
    }
    card.append(actions);
    els.towerGrid.append(card);
  });
  renderRoomInfo();
}

function renderExchange() {
  if (!els.exchangeModal) return;
  if (els.exchangeGems) els.exchangeGems.textContent = state.gems;
  if (els.exchangeCoins) els.exchangeCoins.textContent = state.metaCoins;
  const gemsToCoins = state.exchangeDirection === "gemsToCoins";
  const maxAmount = gemsToCoins ? state.gems : Math.floor(state.metaCoins / EXCHANGE_RATE);
  const current = Math.min(maxAmount, Math.max(0, Number(els.exchangeAmount?.value) || 0));
  if (els.exchangeGemsToCoins) els.exchangeGemsToCoins.classList.toggle("active", gemsToCoins);
  if (els.exchangeCoinsToGems) els.exchangeCoinsToGems.classList.toggle("active", !gemsToCoins);
  if (els.exchangeAmount) {
    els.exchangeAmount.max = maxAmount;
    els.exchangeAmount.value = current;
    els.exchangeAmount.disabled = maxAmount <= 0;
  }
  const spendLabel = gemsToCoins
    ? `${current} ${current === 1 ? "gem" : "gems"}`
    : `${current * EXCHANGE_RATE} coins`;
  const receiveLabel = gemsToCoins
    ? `${current * EXCHANGE_RATE} coins`
    : `${current} ${current === 1 ? "gem" : "gems"}`;
  if (els.exchangeAmountLabel) els.exchangeAmountLabel.textContent = maxAmount > 0 ? `Trade ${spendLabel}` : "Nothing to exchange";
  if (els.exchangePreview) els.exchangePreview.textContent = maxAmount > 0 ? `Get ${receiveLabel}` : "Need more currency";
  if (els.confirmExchange) els.confirmExchange.disabled = current <= 0;
}

function setExchangeDirection(direction) {
  state.exchangeDirection = direction;
  if (els.exchangeAmount) els.exchangeAmount.value = 0;
  renderExchange();
}

function exchangeCurrency() {
  const amount = Math.floor(Number(els.exchangeAmount?.value) || 0);
  if (amount <= 0) return toast("Choose an amount");
  if (state.exchangeDirection === "gemsToCoins") {
    if (state.gems < amount) return toast("Not enough gems");
    state.gems -= amount;
    state.metaCoins += amount * EXCHANGE_RATE;
    toast(`Exchanged ${amount} ${amount === 1 ? "gem" : "gems"} for ${amount * EXCHANGE_RATE} coins`);
  } else {
    const cost = amount * EXCHANGE_RATE;
    if (state.metaCoins < cost) return toast("Not enough coins");
    state.metaCoins -= cost;
    state.gems += amount;
    toast(`Exchanged ${cost} coins for ${amount} ${amount === 1 ? "gem" : "gems"}`);
  }
  sound.coins();
  save();
  renderHome();
}

function renderLevelList() {
  const multiplayerMapPick = multiplayer.choosingMap && multiplayer.room;
  const isHost = multiplayerMapPick && multiplayer.room.hostId === multiplayer.socket?.id;
  const maxStage = multiplayerMapPick ? multiplayer.room.maxStage : highestUnlockedStage();

  els.levelTitle.textContent = multiplayerMapPick ? `Choose Co-op Map: Stage 1-${maxStage}` : "Levels";
  els.levelList.innerHTML = "";

  levelData.forEach((level) => {
    const soloLocked = !stageIsUnlocked(level.id);
    const multiplayerLocked = multiplayerMapPick && level.id > maxStage;
    const locked = multiplayerMapPick ? multiplayerLocked : soloLocked;
    const card = document.createElement("article");
    card.className = `level-card ${locked ? "locked" : ""}`;
    const earnedStars = Math.max(0, Math.min(3, Number(state.stageStars[level.id]) || 0));
    card.innerHTML = `
      <div class="level-card-main">
        <h3>${level.name}</h3>
        <div class="stage-stars" aria-label="${earnedStars} of 3 stars">
          ${[1, 2, 3].map((star) => `<span class="${star <= earnedStars ? "earned" : ""}">★</span>`).join("")}
        </div>
        <div class="level-meta">
          <span class="chip">${level.waves} waves</span>
          <span class="chip">Base Health ${level.baseHp}</span>
        </div>
        <p>Max reward: ${level.rewardGems} gems, ${level.rewardXp} XP</p>
      </div>
    `;
    const btn = document.createElement("button");
    btn.className = "level-action";

    if (multiplayerMapPick) {
      btn.textContent = !isHost ? "Host Only" : locked ? "Locked" : "Start Co-op";
      btn.disabled = !isHost || locked;
      btn.onclick = () => chooseMultiplayerStage(level.id);
    } else {
      btn.textContent = locked ? "Locked" : state.clearedStages.has(level.id) ? "Replay" : "Play";
      btn.disabled = locked;
      btn.onclick = () => startLevel(level.id);
    }

    card.append(btn);
    els.levelList.append(card);
  });
}

function renderRoomInfo() {
  if (!els.roomInfo) return;
  if (!multiplayer.room) {
    els.roomInfo.textContent = "Create a code or enter a friend's code to start a co-op room.";
    els.chooseMultiplayerMap.disabled = true;
    els.chooseMultiplayerMap.textContent = "Start";
    els.leaveRoom.disabled = true;
    return;
  }

  const isHost = multiplayer.room.hostId === multiplayer.socket?.id;
  const players = multiplayer.room.players.map((player) => {
    const you = player.id === multiplayer.socket?.id ? " (you)" : "";
    const loadout = player.loadout.length ? player.loadout.join(", ") : "no towers equipped";
    const host = player.id === multiplayer.room.hostId ? " Host" : "";
    return `${player.name}${you}${host}: Stage ${player.highestStage}, ${loadout}`;
  });

  els.roomInfo.innerHTML = `
    <div class="room-code">Code <b>${multiplayer.room.code}</b></div>
    <div>${players.join("<br>")}</div>
    <div>${multiplayer.room.players.length} / ${MAX_MULTIPLAYER_PLAYERS} players connected. Max co-op map: Stage ${multiplayer.room.maxStage}</div>
  `;
  const roomCanStart = multiplayer.room.players.length >= MIN_PLAYERS_TO_START;
  els.chooseMultiplayerMap.disabled = !isHost || !roomCanStart;
  els.chooseMultiplayerMap.textContent = isHost ? (roomCanStart ? "Start" : "Waiting for teammate") : "Waiting for host";
  els.leaveRoom.disabled = false;
}

function setConnectionStatus(text, online) {
  if (!els.connectionStatus) return;
  els.connectionStatus.textContent = text;
  els.connectionStatus.classList.toggle("online", online);
}

function showRoomError(message = "Invalid code. Check it and try again.") {
  if (els.roomInfo) {
    els.roomInfo.innerHTML = `<div class="room-error">${message}</div>`;
  }
  toast(message);
}

function setupMultiplayer() {
  if (typeof io !== "function") {
    setConnectionStatus("Server off", false);
    if (els.roomInfo) {
      els.roomInfo.innerHTML = `
        <div>Multiplayer needs the local server.</div>
        <div>Run <b>npm run dev</b>, then open <b>http://localhost:3001</b>.</div>
      `;
    }
    return;
  }

  multiplayer.socket = io();

  multiplayer.socket.on("connect", () => {
    setConnectionStatus("Online", true);
    reconnectMultiplayerRoom();
  });

  multiplayer.socket.on("disconnect", () => {
    setConnectionStatus("Offline", false);
  });

  multiplayer.socket.on("room:created", (room) => {
    multiplayer.room = room;
    multiplayer.playerId = multiplayer.socket.id;
    multiplayer.lastRoomCode = room.code;
    sound.upgrade();
    toast(`Room ${room.code} created`);
    if (els.roomCodeInput) els.roomCodeInput.value = "";
    renderRoomInfo();
  });

  multiplayer.socket.on("room:joined", (room) => {
    multiplayer.room = room;
    multiplayer.playerId = multiplayer.socket.id;
    multiplayer.lastRoomCode = room.code;
    sound.upgrade();
    toast(`Joined room ${room.code}`);
    if (els.roomCodeInput) els.roomCodeInput.value = "";
    renderRoomInfo();
  });

  multiplayer.socket.on("room:update", (room) => {
    multiplayer.room = room;
    renderRoomInfo();
    if (multiplayer.choosingMap) renderLevelList();
  });

  multiplayer.socket.on("room:error", (message) => {
    const normalized = String(message || "").toLowerCase();
    const display = normalized.includes("not found") || normalized.includes("invalid") || normalized.includes("code")
      ? "Invalid code. Check it and try again."
      : message || "Could not join that room.";
    showRoomError(display);
  });

  multiplayer.socket.on("room:closed", ({ result } = {}) => {
    clearMultiplayerRoomAfterGame(result);
  });

  multiplayer.socket.on("room:reconnected", ({ oldPlayerId, newPlayerId, room, game }) => {
    migrateMultiplayerPlayerId(oldPlayerId, newPlayerId);
    multiplayer.room = room;
    multiplayer.playerId = newPlayerId;
    multiplayer.lastRoomCode = room?.code || multiplayer.lastRoomCode;
    multiplayer.simOwnerId = game?.simOwnerId || multiplayer.simOwnerId || room?.hostId;
    multiplayer.active = Boolean(game);
    if (game?.towers) syncPlacedTowersFromGame(game.towers);
    toast("Reconnected to multiplayer");
    renderRoomInfo();
    updateHud();
  });

  multiplayer.socket.on("player:reconnected", ({ oldPlayerId, newPlayerId }) => {
    migrateMultiplayerPlayerId(oldPlayerId, newPlayerId);
    updateHud();
  });

  multiplayer.socket.on("game:start", (game) => {
    multiplayer.choosingMap = false;
    multiplayer.active = true;
    multiplayer.simOwnerId = game.simOwnerId || multiplayer.room?.hostId || multiplayer.socket.id;
    if (startLevel(game.stageId, { multiplayer: true, game })) {
      closeModal(els.multiplayerModal);
      closeModal(els.levelModal);
      closeModal(els.modeModal);
    }
  });

  multiplayer.socket.on("game:state", (game) => {
    if (!isMultiplayerGame() || !game) return;
    multiplayer.simOwnerId = game.simOwnerId || multiplayer.simOwnerId || multiplayer.room?.hostId;
    state.baseHp = game.baseHp;
    updateHud();
  });

  multiplayer.socket.on("tower:placed", (placed) => {
    const tower = towerById(placed.type);
    if (!tower || state.placed.some((existing) => existing.uid === placed.uid)) return;

    state.placed.push({
      ...tower,
      uid: placed.uid,
      ownerId: placed.ownerId,
      x: placed.x,
      y: placed.y,
      level: placed.level,
      cooldown: 0,
    });

    if (placed.ownerId === multiplayer.socket.id) {
      state.coins -= tower.cost;
      state.selectedTowerType = null;
      state.previewX = null;
      state.previewY = null;
      sound.place();
      renderBattleLoadout();
    }

    updateHud();
  });

  multiplayer.socket.on("tower:upgraded", ({ uid }) => {
    const tower = state.placed.find((placed) => placed.uid === uid);
    if (!tower) return;

    if (tower.ownerId === multiplayer.socket.id) {
      state.coins -= upgradeCost(tower);
      sound.upgrade();
      toast(`${tower.name} upgraded to L${tower.level + 1}`, "upgrade");
    }
    tower.level += 1;
    updateHud();
  });

  multiplayer.socket.on("tower:sold", ({ uid }) => {
    const tower = state.placed.find((placed) => placed.uid === uid);
    if (!tower) return;

    if (tower.ownerId === multiplayer.socket.id) {
      state.coins += sellValue(tower);
      sound.sell();
    }
    state.placed = state.placed.filter((placed) => placed.uid !== uid);
    state.soldiers = state.soldiers.filter((soldier) => soldier.owner !== tower);
    if (state.selectedPlaced?.uid === uid) {
      state.selectedPlaced = null;
      resetSellConfirmation();
    }
    updateHud();
  });

  multiplayer.socket.on("wave:start", ({ wave, startsAt }) => {
    scheduleMultiplayerWaveStart(wave, startsAt);
  });

  multiplayer.socket.on("mobs:sync", (snapshot) => {
    if (!isMultiplayerGame() || isSimulationOwner()) return;
    const remoteMobs = snapshot.mobs || [];
    const remoteSpawns = snapshot.spawns || [];

    state.baseHp = snapshot.baseHp;
    if (!state.runningWave || snapshot.wave >= state.wave) state.wave = snapshot.wave;
    state.lastMobSyncAt = performance.now();
    state.pendingWaveStart = false;
    state.awaitingRemoteWave = false;
    state.runningWave = snapshot.runningWave;
    mergeRemoteMobs(remoteMobs);
    state.spawns = remoteSpawns.map((spawn) => ({ ...spawn }));
    mergeRemoteSoldiers(snapshot.soldiers || []);
    state.shots = (snapshot.shots || []).slice(-MAX_ACTIVE_SHOTS).map((shot) => ({ ...shot, simple: true }));
    state.kills = snapshot.kills;
    updateHud();
  });

  multiplayer.socket.on("coins:reward", ({ amount, kind }) => {
    if (!isMultiplayerGame() || isSimulationOwner()) return;
    const reward = Math.max(0, Math.floor(Number(amount) || 0));
    if (!reward) return;
    state.coins += reward;
    if (kind === "waveBonus") announceWaveBonus(reward);
    updateHud();
  });

  multiplayer.socket.on("room:notice", ({ message }) => {
    toast(message);
  });

  multiplayer.socket.on("sim:changed", ({ simOwnerId }) => {
    multiplayer.simOwnerId = simOwnerId;
    if (simOwnerId === multiplayer.socket.id) {
      state.pendingWaveStart = false;
      state.awaitingRemoteWave = false;
      if (state.mobs.length || state.spawns.length) state.runningWave = true;
    }
    updateHud();
  });

  multiplayer.socket.on("host:changed", ({ hostId, message }) => {
    if (multiplayer.room) multiplayer.room.hostId = hostId;
    if (message) toast(message);
    renderRoomInfo();
    updateHud();
  });

  multiplayer.socket.on("player:left", () => {
    updateHud();
  });

  multiplayer.socket.on("towers:remove", ({ ownerId, towerIds }) => {
    removePlayerTowers(ownerId, towerIds);
  });
}

function reconnectMultiplayerRoom() {
  if (!multiplayer.room || !multiplayer.lastRoomCode || !multiplayer.playerId) return;
  if (multiplayer.playerId === multiplayer.socket.id) return;
  multiplayer.socket.emit("room:reconnect", {
    code: multiplayer.lastRoomCode,
    playerId: multiplayer.playerId,
    loadout: activeLoadout(),
    highestStage: highestUnlockedStage(),
  });
}

function migrateMultiplayerPlayerId(oldPlayerId, newPlayerId) {
  if (!oldPlayerId || !newPlayerId || oldPlayerId === newPlayerId) return;
  if (multiplayer.room) {
    multiplayer.room.players.forEach((player) => {
      if (player.id === oldPlayerId) player.id = newPlayerId;
    });
    if (multiplayer.room.hostId === oldPlayerId) multiplayer.room.hostId = newPlayerId;
  }
  if (multiplayer.simOwnerId === oldPlayerId) multiplayer.simOwnerId = newPlayerId;
  state.placed.forEach((tower) => {
    if (tower.ownerId === oldPlayerId) tower.ownerId = newPlayerId;
  });
}

function createMultiplayerRoom() {
  if (!multiplayer.socket?.connected) {
    if (els.roomInfo) {
      els.roomInfo.innerHTML = `
        <div>Cannot create a code from this page.</div>
        <div>Use <b>http://localhost:3001</b> so the backend can make the room.</div>
      `;
    }
    return toast("Open http://localhost:3001 first");
  }
  multiplayer.socket.emit("room:create", {
    stageId: state.currentLevel?.id || 1,
    loadout: activeLoadout(),
    highestStage: highestUnlockedStage(),
  });
}

function joinMultiplayerRoom(event) {
  event.preventDefault();
  if (!multiplayer.socket?.connected) return toast("Start the server first");

  const code = els.roomCodeInput.value.trim().toUpperCase();
  if (!code) return showRoomError("Enter a room code.");
  if (code.length < 5) return showRoomError("Invalid code. Enter the full 5-letter code.");

  if (els.roomInfo) {
    els.roomInfo.innerHTML = `<div>Checking code <b>${code}</b>...</div>`;
  }

  multiplayer.socket.emit("room:join", {
    code,
    loadout: activeLoadout(),
    highestStage: highestUnlockedStage(),
  });
}

function leaveMultiplayerRoom() {
  if (multiplayer.socket?.connected && multiplayer.room) {
    multiplayer.socket.emit("room:leave");
  }
  multiplayer.room = null;
  multiplayer.playerId = null;
  multiplayer.lastRoomCode = null;
  multiplayer.simOwnerId = null;
  multiplayer.active = false;
  multiplayer.choosingMap = false;
  clearTimeout(multiplayer.waveStartTimer);
  closeModal(els.multiplayerModal);
  closeModal(els.levelModal);
  closeModal(els.modeModal);
  switchScreen("home");
  renderHome();
}

function endMultiplayerRoom(result) {
  if (!isMultiplayerGame() || !multiplayer.socket?.connected || !multiplayer.room) return;
  multiplayer.socket.emit("game:end", { result });
}

function clearMultiplayerRoomAfterGame(result) {
  const wasInGame = state.screen === "game";
  multiplayer.room = null;
  multiplayer.playerId = null;
  multiplayer.lastRoomCode = null;
  multiplayer.simOwnerId = null;
  multiplayer.active = false;
  multiplayer.choosingMap = false;
  clearTimeout(multiplayer.waveStartTimer);
  closeModal(els.multiplayerModal);
  closeModal(els.levelModal);
  closeModal(els.modeModal);
  renderRoomInfo();

  if (wasInGame && !state.levelEnded) {
    state.levelEnded = true;
    state.runningWave = false;
    state.pendingWaveStart = false;
    toast(result === "won" ? "Stage complete. Multiplayer room closed." : "Game over. Multiplayer room closed.");
    switchScreen("home");
    renderHome();
  }
}

function unlockTower(tower) {
  state.gems -= tower.gems;
  state.unlocked.add(tower.id);
  if (state.loadout.length < 5) state.loadout.push(tower.id);
  sound.upgrade();
  save();
  renderHome();
  toast(`${tower.name} unlocked`, "reward");
}

function addToLoadout(id) {
  if (state.loadout.length >= 5) return toast("Loadout is full");
  state.loadout.push(id);
  sound.click();
  save();
  renderHome();
}

function removeFromLoadout(id) {
  state.loadout = state.loadout.filter((towerId) => towerId !== id);
  sound.sell();
  save();
  renderHome();
}

function stageIsUnlocked(id) {
  return id === 1 || state.clearedStages.has(id - 1);
}

function highestUnlockedStage() {
  let highest = 1;
  for (const level of levelData) {
    if (!stageIsUnlocked(level.id)) break;
    highest = level.id;
  }
  return highest;
}

function switchScreen(screen) {
  state.screen = screen;
  els.home.classList.toggle("active", screen === "home");
  els.game.classList.toggle("active", screen === "game");
  if (screen !== "game") sound.supportHum(false, false);
}

function openModal(modal) {
  modal.classList.add("open");
}

function closeModal(modal) {
  modal.classList.remove("open");
}

function updateSupportHum() {
  if (state.screen !== "game") {
    sound.supportHum(false, false);
    return;
  }
  const hasHaste = state.placed.some((tower) => tower.id === "haste");
  const hasPower = state.placed.some((tower) => tower.id === "power");
  sound.supportHum(hasHaste, hasPower);
}

function renderSettings() {
  const sfxOn = sound.isEnabled();
  const musicOn = music.isEnabled();
  els.toggleSfx.classList.toggle("on", sfxOn);
  els.toggleSfx.querySelector("b").textContent = sfxOn ? "On" : "Off";
  els.toggleMusic.classList.toggle("on", musicOn);
  els.toggleMusic.querySelector("b").textContent = musicOn ? "On" : "Off";
}

function openSettings() {
  renderSettings();
  openModal(els.settingsModal);
}

function toggleSoundEffects() {
  sound.setEnabled(!sound.isEnabled());
  renderSettings();
}

function toggleMusicSetting() {
  music.setEnabled(!music.isEnabled());
  renderSettings();
}

const redeemableCodes = {
  poop: {
    success: "All towers unlocked",
    apply() {
      towers.forEach((tower) => state.unlocked.add(tower.id));
    },
  },
  poopy: {
    success: "All stages unlocked",
    apply() {
      levelData.forEach((level) => state.clearedStages.add(level.id));
    },
  },
  bestgame: {
    success: "300 XP and 100 gems added",
    apply() {
      addXp(300);
      state.gems += 100;
    },
  },
  bumbum: {
    success: "1000 coins added",
    apply() {
      state.metaCoins += 1000;
    },
  },
  bum: {
    success: (towerName) => (towerName ? `${towerName} unlocked` : "All towers already unlocked"),
    apply() {
      const bestIndex = towers.reduce((best, tower, index) => (
        state.unlocked.has(tower.id) ? Math.max(best, index) : best
      ), -1);
      const nextTower = towers.slice(bestIndex + 1).find((tower) => !state.unlocked.has(tower.id));
      if (!nextTower) return "";
      state.unlocked.add(nextTower.id);
      if (state.loadout.length < 5) state.loadout.push(nextTower.id);
      return nextTower.name;
    },
  },
  poops: {
    success: "100000 coins added",
    apply() {
      state.metaCoins += 100000;
    },
  },
};

function openCodeRedeem() {
  closeModal(els.settingsModal);
  els.codeForm.reset();
  showCodeStatus("");
  openModal(els.codeModal);
  setTimeout(() => els.codeInput.focus(), 0);
}

function openCodeNote() {
  openModal(els.codeNoteModal);
}

function showCodeStatus(message, type = "") {
  els.codeStatus.textContent = message;
  els.codeStatus.className = `code-status ${type}`.trim();
}

function redeemCode(event) {
  event.preventDefault();
  const code = els.codeInput.value.trim().toLowerCase();
  if (!code) {
    showCodeStatus("Enter a code", "error");
    return;
  }

  const reward = redeemableCodes[code];
  if (!reward) {
    showCodeStatus("Invalid code", "error");
    return;
  }
  if (state.redeemedCodes.has(code)) {
    showCodeStatus("Code already redeemed", "error");
    return;
  }

  const rewardResult = reward.apply();
  const success = typeof reward.success === "function" ? reward.success(rewardResult) : reward.success;
  state.redeemedCodes.add(code);
  sound.upgrade();
  save();
  renderHome();
  els.codeForm.reset();
  showCodeStatus(`Successfully redeemed: ${success}`, "success");
}

function openSoloLevels() {
  multiplayer.choosingMap = false;
  closeModal(els.modeModal);
  renderLevelList();
  openModal(els.levelModal);
}

function openMultiplayerLobby() {
  closeModal(els.modeModal);
  renderRoomInfo();
  openModal(els.multiplayerModal);
}

function openMultiplayerMapPicker() {
  if (!multiplayer.room) return toast("Create or join a room first");
  if (multiplayer.room.hostId !== multiplayer.socket?.id) return toast("Only the host can choose the map");
  multiplayer.choosingMap = true;
  closeModal(els.multiplayerModal);
  renderLevelList();
  openModal(els.levelModal);
}

function chooseMultiplayerStage(id) {
  if (!multiplayer.socket?.connected || !multiplayer.room) return toast("Create or join a room first");
  multiplayer.socket.emit("room:startStage", { stageId: id });
}

function syncPlacedTowersFromGame(gameTowers = []) {
  const existingByUid = new Map(state.placed.map((tower) => [tower.uid, tower]));
  state.placed = gameTowers.flatMap((placed) => {
    const tower = towerById(placed.type);
    if (!tower) return [];
    const existing = existingByUid.get(placed.uid);
    return [{
      ...tower,
      uid: placed.uid,
      ownerId: placed.ownerId,
      x: placed.x,
      y: placed.y,
      level: placed.level,
      cooldown: existing?.cooldown || 0,
    }];
  });
  state.soldiers = state.soldiers.filter((soldier) => state.placed.includes(soldier.owner));
  if (state.selectedPlaced) {
    const refreshedSelection = state.placed.find((tower) => tower.uid === state.selectedPlaced.uid);
    state.selectedPlaced = refreshedSelection || null;
    if (!refreshedSelection) resetSellConfirmation();
  }
}

function startLevel(id, options = {}) {
  if (!state.loadout.length) {
    state.loadout = activeLoadout();
  }
  if (!state.loadout.length) {
    toast("Equip at least one tower");
    return false;
  }
  const level = levelData[id - 1];
  if (!level) {
    toast("Map not found");
    return false;
  }
  if (!options.multiplayer && !stageIsUnlocked(level.id)) {
    toast(`Clear Stage ${level.id - 1} first`);
    return false;
  }
  multiplayer.active = Boolean(options.multiplayer);
  clearTimeout(multiplayer.waveStartTimer);
  state.currentLevel = level;
  state.coins = level.startCoins;
  state.baseHp = options.game?.baseHp ?? level.baseHp;
  state.wave = 0;
  state.runningWave = false;
  state.pendingWaveStart = false;
  state.awaitingRemoteWave = false;
  state.levelEnded = false;
  state.mobs = [];
  state.placed = [];
  state.soldiers = [];
  state.shots = [];
  state.spawns = [];
  state.startedWaves = new Set();
  state.kills = 0;
  state.earnedGems = 0;
  state.earnedXp = 0;
  state.mobSyncTimer = 0;
  state.hudTimer = 0;
  state.lastMobSyncAt = 0;
  state.nextMobId = 1;
  state.selectedPlaced = null;
  state.selectedTowerType = null;
  state.volcanoFx = { timer: 26 + Math.random() * 10, blobs: [], pools: [], flash: 0 };
  state.gameSpeed = 1;
  if (els.speedToggle) {
    els.speedToggle.textContent = "Speed: x1";
    els.speedToggle.disabled = Boolean(options.multiplayer);
  }
  if (options.game?.towers?.length) {
    syncPlacedTowersFromGame(options.game.towers);
  }
  els.gameTitle.textContent = level.name;
  renderBattleLoadout();
  updateHud();
  closeModal(els.levelModal);
  closeModal(els.multiplayerModal);
  closeModal(els.modeModal);
  switchScreen("game");
  return true;
}

function renderBattleLoadout() {
  els.battleLoadout.innerHTML = "";
  state.loadout.forEach((id) => {
    const tower = towerById(id);
    if (!tower) return;
    const btn = document.createElement("button");
    btn.className = `battle-card ${state.selectedTowerType === id ? "active" : ""}`;
    btn.style.setProperty("--tc", tower.color);
    btn.innerHTML = `
      <img class="battle-card-art" src="${towerPortraitDataUrl(tower)}" alt="">
      <span class="battle-card-info">
        <b>${tower.name}</b>
        <span class="battle-card-cost">${tower.cost} coins</span>
      </span>`;
    btn.onclick = () => {
      resetSellConfirmation();
      state.selectedTowerType = state.selectedTowerType === id ? null : id;
      state.selectedPlaced = null;
      state.previewX = null;
      state.previewY = null;
      renderBattleLoadout();
      updateSelectedInfo();
    };
    els.battleLoadout.append(btn);
  });
}

function updateHud() {
  els.coins.textContent = Math.floor(state.coins);
  els.baseHp.textContent = Math.max(0, state.baseHp);
  els.kills.textContent = state.kills;
  els.towerCount.textContent = `${ownPlacedTowers().length} / ${towerLimit()}`;
  const pending = state.pendingWaveStart || state.awaitingRemoteWave ? " starting" : "";
  els.waveText.textContent = `Wave ${state.wave}${pending} / ${state.currentLevel?.waves || 0}`;
  els.startWave.disabled = state.pendingWaveStart || state.awaitingRemoteWave || state.runningWave || state.wave >= state.currentLevel.waves;
  updateBossBar();
  updateSelectedInfo();
}

function towerLimit() {
  if (isMultiplayerGame()) return 15;
  if (!state.currentLevel) return 15;
  return state.currentLevel.id > 10 ? 20 : 15;
}

function updateBossBar() {
  const boss = state.mobs.find((mob) => mob.boss && mob.hp > 0);
  if (!boss) {
    els.bossBar.classList.remove("show");
    updateBossBar.previous = null;
    return;
  }
  const hp = Math.max(0, Math.ceil(boss.hp));
  const maxHp = Math.ceil(boss.maxHp);
  const key = `${state.currentLevel?.id}:${state.wave}:${boss.uid ?? boss.bossName}:${maxHp}`;
  const previous = updateBossBar.previous;
  const now = performance.now();
  const isNew = !previous || previous.key !== key;
  els.bossName.textContent = boss.bossName || "Boss";
  els.bossHpCurrent.textContent = String(hp);
  els.bossHpMax.textContent = String(maxHp);
  const percentage = Math.max(0, Math.min(100, (boss.hp / boss.maxHp) * 100));
  els.bossHpFill.style.width = `${percentage}%`;
  els.bossHpTrail.style.width = `${percentage}%`;
  // A new encounter must not inherit a previous boss's damage trail.
  if (isNew) els.bossHpTrail.getAnimations().forEach(animation => animation.finish());
  els.bossBar.classList.toggle("critical", percentage <= 25);
  els.bossBar.classList.add("show");
  let lastHit = previous?.lastHit || 0;
  if (isNew && !reducedMotion.matches) {
    els.bossName.getAnimations().forEach(a => a.cancel());
    els.bossName.animate([
      { opacity: 0, transform: "translateY(8px) scale(.9)", letterSpacing: ".16em" },
      { opacity: 1, transform: "translateY(-2px) scale(1.03)", offset: .7 },
      { opacity: 1, transform: "none", letterSpacing: ".035em" },
    ], { duration: 650, easing: "cubic-bezier(.2,.8,.2,1)" });
  } else if (!isNew && hp < previous.hp && now - lastHit > 180 && !reducedMotion.matches) {
    lastHit = now;
    els.bossHpCurrent.getAnimations().forEach(a => a.cancel());
    els.bossHpCurrent.animate([
      { color: "#fff4c9", transform: "scale(1.12)" },
      { color: "#fff4ed", transform: "scale(1)" },
    ], { duration: 260, easing: "ease-out" });
  }
  updateBossBar.previous = { key, hp, lastHit };
}

function updateSelectedInfo() {
  const accentTower = state.selectedPlaced || (state.selectedTowerType ? towerById(state.selectedTowerType) : null);
  els.selectedInfo.style.setProperty("--tc", accentTower ? accentTower.color : "#3b4651");
  els.selectedInfo.classList.toggle("has-selection", Boolean(accentTower));
  if (state.selectedPlaced) {
    const tower = state.selectedPlaced;
    const current = combatStatsForTower(tower);
    const next = combatStatsForTower({ ...tower, level: tower.level + 1 });
    const isSupport = tower.kind === "support";
    const supportBuffLabel = supportBuffStatLabel(tower);
    const supportBuffCurrent = supportBuffValueText(tower, current);
    const damageLabel = tower.id === "orbital" ? "DPS" : "Damage";
    const showsTowerRange = tower.kind !== "summon";
    const rangeLabel = isSupport ? "Aura Range" : "Range";
    const damageValue = tower.id === "orbital" ? formatStat(current.beamDamage) : formatStat(current.damage);
    const damageNextValue = tower.id === "orbital" ? formatStat(next.beamDamage) : formatStat(next.damage);
    const showsTowerDamage = tower.kind !== "summon";
    const showsSoldierDamage = tower.kind === "summon" && tower.level >= 3;
    const confirmingSell = state.sellConfirmTower === tower;
    if (tower.level >= MAX_TOWER_LEVEL) {
      els.selectedInfo.innerHTML = `
        <div class="selected-title">${tower.name} L${tower.level}</div>
        <div class="upgrade-costs">
          <span>Upgrade <b>Max</b></span>
          <span>Sell <b>${sellValue(tower)}</b></span>
        </div>
        <div class="selection-grid">
          ${showsTowerDamage ? selectionStatLine(damageLabel, damageValue) : ""}
          ${showsTowerRange ? selectionStatLine(rangeLabel, formatStat(current.range)) : ""}
          ${tower.id === "orbital" ? selectionStatLine("Beam", "Cont.") : ""}
          ${!isSupport && tower.id !== "orbital" ? selectionStatLine(tower.kind === "summon" ? "Spawn" : "Reload", `${formatStat(current.reload)}s`) : ""}
          ${isSupport && supportBuffLabel ? selectionStatLine(supportBuffLabel, supportBuffCurrent) : ""}
          ${!isSupport && current.splash ? selectionStatLine(tower.kind === "control" ? "Blast" : "Splash", formatStat(current.splash)) : ""}
          ${!isSupport && current.slow ? selectionStatLine("Slow", slowLabel(current.slow)) : ""}
          ${!isSupport && current.poison ? selectionStatLine("Poison", formatStat(current.poison)) : ""}
          ${!isSupport && current.burn ? selectionStatLine("Burn", formatStat(current.burn)) : ""}
          ${!isSupport && current.pierceHits ? selectionStatLine("Pierce", current.pierceHits) : ""}
          ${!isSupport && current.chainTargets ? selectionStatLine("Chains", chainHitCount(current)) : ""}
          ${!isSupport && current.income ? selectionStatLine("Income", current.income) : ""}
          ${tower.kind === "summon" ? selectionStatLine("Guard HP", formatStat(current.soldierHp)) : ""}
          ${showsSoldierDamage ? selectionStatLine("Guard Dmg", formatStat(current.soldierDamage)) : ""}
          ${tower.kind === "summon" ? selectionStatLine("Guard Spd", formatStat(current.soldierSpeed)) : ""}
          ${tower.kind === "summon" && current.soldierRange ? selectionStatLine("Gun Range", formatStat(current.soldierRange)) : ""}
          ${tower.kind === "summon" && current.soldierReload ? selectionStatLine("Gun Reload", `${formatStat(current.soldierReload)}s`) : ""}
        </div>
      `;
    } else {
      els.selectedInfo.innerHTML = `
        <div class="selected-title">${tower.name} L${tower.level}</div>
        <div class="upgrade-costs">
          <span>Upgrade <b>${upgradeCost(tower)}</b></span>
          <span>Sell <b>${sellValue(tower)}</b></span>
        </div>
        <div class="upgrade-grid">
          ${showsTowerDamage ? statLine(damageLabel, damageValue, damageNextValue) : ""}
          ${showsTowerRange ? statLine(rangeLabel, formatStat(current.range), formatStat(next.range)) : ""}
          ${tower.id === "orbital"
            ? statLine("Beam", "Cont.", "Cont.")
            : isSupport
              ? statLine("Mode", "Aura", "Aura")
              : statLine(tower.kind === "summon" ? "Spawn" : "Reload", `${formatStat(current.reload)}s`, `${formatStat(next.reload)}s`)}
          ${specialStatLines(tower, current, next)}
        </div>
      `;
    }
    els.sellTower.disabled = false;
    setButtonLabel(els.sellTower, confirmingSell ? `Sure? Sell for ${sellValue(tower)}` : "Sell Selected");
    els.sellTower.classList.toggle("danger-button", confirmingSell);
    els.upgradeTower.disabled = tower.level >= MAX_TOWER_LEVEL || state.coins < upgradeCost(tower);
    setButtonLabel(els.upgradeTower, tower.level >= MAX_TOWER_LEVEL
      ? "Max Level"
      : "Upgrade Selected");
    return;
  }
  resetSellConfirmation();
  els.sellTower.disabled = true;
  els.upgradeTower.disabled = true;
  setButtonLabel(els.upgradeTower, "Upgrade Selected");
  const tower = towerById(state.selectedTowerType);
  if (!tower) {
    els.selectedInfo.textContent = "Pick a tower, then place it on open buildable ground.";
    return;
  }
  const stats = towerStatsAtLevel(tower, 1);
  const isSupport = tower.kind === "support";
  const showsTowerRange = tower.kind !== "summon";
  const supportBuffLabel = supportBuffStatLabel(tower);
  const supportBuffValue = supportBuffValueText(tower, stats);
  const damageLabel = tower.id === "orbital" ? "DPS" : "Damage";
  const showsTowerDamage = tower.kind !== "summon";
  const rangeLabel = isSupport ? "Aura Range" : "Range";
  els.selectedInfo.innerHTML = `
    <div class="selected-title">${tower.name}</div>
    <div class="selection-meta">
      <span>Cost <b>${tower.cost}</b></span>
      <span>Type <b>${prettyKind(tower.kind)}</b></span>
    </div>
    <div class="selection-grid">
      ${showsTowerDamage ? selectionStatLine(damageLabel, tower.id === "orbital" ? formatStat(stats.beamDamage) : formatStat(stats.damage)) : ""}
      ${showsTowerRange ? selectionStatLine(rangeLabel, formatStat(stats.range)) : ""}
      ${tower.id === "orbital" ? selectionStatLine("Beam", "Cont.") : ""}
      ${!isSupport && tower.id !== "orbital" ? selectionStatLine(tower.kind === "summon" ? "Spawn" : "Reload", `${formatStat(stats.reload)}s`) : ""}
      ${isSupport && supportBuffLabel ? selectionStatLine(supportBuffLabel, supportBuffValue) : ""}
      ${!isSupport && stats.splash ? selectionStatLine(tower.kind === "control" ? "Blast" : "Splash", formatStat(stats.splash)) : ""}
      ${!isSupport && stats.slow ? selectionStatLine("Slow", slowLabel(stats.slow)) : ""}
      ${!isSupport && stats.poison ? selectionStatLine("Poison", formatStat(stats.poison)) : ""}
      ${!isSupport && stats.burn ? selectionStatLine("Burn", formatStat(stats.burn)) : ""}
      ${!isSupport && stats.chainTargets ? selectionStatLine("Chains", chainHitCount(stats)) : ""}
      ${!isSupport && stats.income ? selectionStatLine("Income", stats.income) : ""}
      ${tower.kind === "summon" ? selectionStatLine("Guard HP", formatStat(stats.soldierHp)) : ""}
      ${tower.kind === "summon" ? selectionStatLine("Guard Spd", formatStat(stats.soldierSpeed)) : ""}
      ${tower.kind === "summon" && stats.soldierRange ? selectionStatLine("Gun Range", formatStat(stats.soldierRange)) : ""}
      ${tower.kind === "summon" && stats.soldierReload ? selectionStatLine("Gun Reload", `${formatStat(stats.soldierReload)}s`) : ""}
    </div>
    <div class="selection-note">Place it on open ground away from roads and obstacles.</div>
  `;
}

function statLine(label, current, next) {
  return `<span>${label}</span><b>${current}</b><b class="after">${next}</b>`;
}

function selectionStatLine(label, value) {
  return `<span>${label}</span><b>${value}</b>`;
}

function chainHitCount(stats) {
  return stats.chainTargets ? stats.chainTargets + 1 : 0;
}

function prettyKind(kind) {
  return kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : "Tower";
}

function specialStatLines(tower, current, next) {
  const lines = [];
  if (current.splash || next.splash) lines.push(statLine(tower.kind === "control" ? "Blast" : "Splash", formatStat(current.splash || 0), formatStat(next.splash || 0)));
  if (current.slow || next.slow) lines.push(statLine("Slow", slowLabel(current.slow), slowLabel(next.slow)));
  if (current.poison || next.poison) lines.push(statLine("Poison", formatStat(current.poison || 0), formatStat(next.poison || 0)));
  if (current.burn || next.burn) lines.push(statLine("Burn", formatStat(current.burn || 0), formatStat(next.burn || 0)));
  if (current.pierceHits || next.pierceHits) lines.push(statLine("Pierce", current.pierceHits || 0, next.pierceHits || 0));
  if (current.chainTargets || next.chainTargets) lines.push(statLine("Chains", chainHitCount(current), chainHitCount(next)));
  if (current.income || next.income) lines.push(statLine("Income", `${current.income || 0}`, `${next.income || 0}`));
  if (current.soldierHp || next.soldierHp) lines.push(statLine("Guard HP", formatStat(current.soldierHp || 0), formatStat(next.soldierHp || 0)));
  if (tower.kind === "summon" && tower.level >= 3 && (current.soldierDamage || next.soldierDamage)) {
    lines.push(statLine("Guard Dmg", formatStat(current.soldierDamage || 0), formatStat(next.soldierDamage || 0)));
  }
  if (current.soldierSpeed || next.soldierSpeed) lines.push(statLine("Guard Spd", formatStat(current.soldierSpeed || 0), formatStat(next.soldierSpeed || 0)));
  if (current.soldierRange || next.soldierRange) lines.push(statLine("Gun Range", current.soldierRange ? formatStat(current.soldierRange) : "none", next.soldierRange ? formatStat(next.soldierRange) : "none"));
  if (current.soldierReload || next.soldierReload) lines.push(statLine("Gun Reload", current.soldierReload ? `${formatStat(current.soldierReload)}s` : "none", next.soldierReload ? `${formatStat(next.soldierReload)}s` : "none"));
  const supportBuffLabel = supportBuffStatLabel(tower);
  if (tower?.id === "haste") {
    lines.push(statLine(supportBuffLabel, percentLabel(current.fireRateBoost || 0), percentLabel(next.fireRateBoost || 0)));
  }
  if (tower?.id === "power") {
    lines.push(statLine(supportBuffLabel, percentLabel(current.damageBoost || 0), percentLabel(next.damageBoost || 0)));
  }
  return lines.join("");
}

function supportBuffStatLabel(tower) {
  if (tower?.id === "haste") return "Fire Rate";
  if (tower?.id === "power") return "Damage";
  return null;
}

function supportBuffValueText(tower, stats) {
  if (tower?.id === "haste") return percentLabel(stats.fireRateBoost || 0);
  if (tower?.id === "power") return percentLabel(stats.damageBoost || 0);
  return "";
}

function towerMetaLevel(id) {
  return Math.min(10, Math.max(1, Math.floor(state.towerLevels?.[id] || 1)));
}

function towerLevelUpCost(level) {
  return Math.round(100 * Math.pow(1.45, level - 1));
}

function levelUpTower(id) {
  const level = towerMetaLevel(id);
  if (level >= 10) return;
  const cost = towerLevelUpCost(level);
  if (state.metaCoins < cost) {
    toast("Not enough coins");
    return;
  }
  state.metaCoins -= cost;
  state.towerLevels[id] = level + 1;
  sound.coins();
  save();
  renderHome();
  toast(`${towerById(id).name} is now Lv ${level + 1}`, "reward");
}

function towerStatsAtLevel(tower, level) {
  const boost = level - 1;
  const metaBoost = towerMetaLevel(tower.id) - 1;
  const meta = 1 + metaBoost * 0.05;
  const metaRange = 1 + metaBoost * 0.012;
  const metaReload = 1 + metaBoost * 0.018;
  const metaSupportBoost = metaBoost * 0.005;
  const slowStep = tower.id === "ice" ? 0.055 : tower.id === "void" ? 0.05 : 0.035;
  const slowCap = tower.id === "ice" ? 0.28 : tower.id === "void" ? 0.25 : 0.22;
  return {
    damage: tower.kind === "support" ? 0 : tower.damage * (1 + boost * 0.36) * meta,
    range: tower.range ? tower.range * (1 + boost * 0.08) * metaRange : 0,
    reload: tower.id === "orbital" || tower.kind === "support"
      ? 0
      : tower.kind === "summon"
        ? Math.max(15.4, tower.fire - boost * 1.35) / metaReload
        : tower.fire * (tower.id === "tesla" ? 1.18 : 1) / (1 + level * 0.16) / metaReload,
    splash: tower.splash ? tower.splash * (1 + boost * 0.07) : 0,
    slow: tower.slow ? Math.max(slowCap, tower.slow - boost * slowStep) : 0,
    poison: tower.poison ? tower.poison * (1 + boost * 0.25) * meta : 0,
    burn: tower.burn ? tower.burn * (1 + boost * 0.25) * meta : 0,
    pierceHits: tower.kind === "pierce" ? 2 + Math.floor(level / 2) : 0,
    chainTargets: tower.kind === "chain" ? chainTargetsAtLevel(tower, level) : 0,
    income: tower.kind === "income" ? Math.round((26 + level * 13) * meta) : 0,
    soldierHp: tower.kind === "summon" ? soldierHpAtLevel(tower, level) * meta : 0,
    soldierDamage: tower.kind === "summon" ? tower.damage * 0.84 * (1 + boost * 0.22) * meta : 0,
    soldierSpeed: tower.kind === "summon" ? tower.soldierSpeed : 0,
    soldierRange: tower.kind === "summon" && level >= 3 ? 90 + boost * 15 : 0,
    soldierReload: tower.kind === "summon" && level >= 3 ? Math.max(0.85, 1.35 - boost * 0.1) : 0,
    fireRateBoost: tower.aura?.fireRate ? tower.aura.fireRate + boost * (tower.aura.fireRateStep || 0.04) + metaSupportBoost : 0,
    damageBoost: tower.aura?.damage ? tower.aura.damage + boost * (tower.aura.damageStep || 0.04) + metaSupportBoost : 0,
    beamDamage: tower.id === "orbital" ? tower.damage * (1 + boost * 0.36) * meta : 0,
  };
}

function chainTargetsAtLevel(tower, level) {
  if (tower.id === "spark") return Math.min(2, 1 + Math.floor(level / 4));
  if (tower.id === "tesla") return [0, 2, 2, 3, 3, 4][level] || 4;
  return Math.min(4, level);
}

function soldierHpAtLevel(tower, level) {
  if (level < 3) return tower.soldierHp * (1.18 + (level - 1) * 0.16);
  return tower.soldierHp * (1.08 + (level - 3) * 0.035);
}

function formatStat(value) {
  return Number.isInteger(value) ? value : value.toFixed(1);
}

function percentLabel(value) {
  const percent = Math.round(value * 1000) / 10;
  const label = Number.isInteger(percent) ? percent : percent.toFixed(1);
  return `${value > 0 ? "+" : ""}${label}%`;
}

function slowLabel(value) {
  if (!value) return "none";
  return `${Math.round((1 - value) * 100)}%`;
}

function towerEffectMarkup(tower, stats) {
  const effects = [];
  if (tower.kind === "basic") {
    effects.push(["Role", "Single-target damage"]);
    effects.push(["Special", tower.id === "ranger" ? "Fast cleanup shots" : "No extra effect"]);
  }
  if (tower.kind === "slow") {
    effects.push(["Slow", slowLabel(stats.slow)]);
    effects.push(["Duration", "1.8s"]);
  }
  if (tower.kind === "chain") {
    const maxHits = chainHitCount(towerStatsAtLevel(tower, MAX_TOWER_LEVEL));
    const currentHits = chainHitCount(stats);
    effects.push(["Chain Hits", maxHits > currentHits ? `${currentHits}-${maxHits}` : currentHits]);
  }
  if (tower.kind === "pierce") {
    effects.push(["Pierce", stats.pierceHits || 0]);
    effects.push(["Best On", "Straight paths"]);
  }
  if (tower.kind === "dot") {
    if (stats.poison) effects.push(["Poison", formatStat(stats.poison)]);
    if (stats.burn) effects.push(["Burn", formatStat(stats.burn)]);
    effects.push(["Duration", stats.poison ? "2.8s" : "2.4s"]);
  }
  if (tower.kind === "income") {
    effects.push(["Income", `${stats.income} coins`]);
    effects.push(["Role", "Economy"]);
  }
  if (tower.kind === "support") {
    effects.push(["Role", "Aura support"]);
    effects.push(["Placement", "Cluster towers"]);
  }
  if (tower.kind === "summon") {
    effects.push(["Summons", "Path guards"]);
    effects.push(["Melee Dmg", formatStat(stats.soldierDamage)]);
    effects.push(["Guns", "Unlock at L3"]);
  }
  if (tower.kind === "control") {
    effects.push(["Blast", formatStat(stats.splash)]);
    effects.push(["Slow", slowLabel(stats.slow)]);
  }
  if (tower.kind === "elite") {
    effects.push(["Targeting", "Lock-on"]);
    effects.push(["Role", "Elite focus fire"]);
  }
  return effects.map(([label, value]) => `<span>${label} <b>${value}</b></span>`).join("");
}

function multiplayerPlayerCount() {
  if (!isMultiplayerGame()) return 1;
  return Math.max(1, Math.min(4, multiplayer.room?.players?.length || 1));
}

function multiplayerFinalDifficultyScale(playerCount) {
  return {
    2: 1.7,
    3: 2.4,
    4: 3.2,
  }[playerCount] || 1;
}

function multiplayerWaveDifficulty(wave, totalWaves) {
  const playerCount = multiplayerPlayerCount();
  const targetScale = multiplayerFinalDifficultyScale(playerCount);
  if (targetScale <= 1) return { total: 1, count: 1, hp: 1, speed: 1, bossHp: 1, bossSpeed: 1 };

  const waveProgress = (wave - 1) / Math.max(1, totalWaves - 1);
  const ramp = Math.pow(Math.max(0, (waveProgress - 0.2) / 0.8), 1.35);
  const total = 1 + (targetScale - 1) * ramp;
  const count = Math.sqrt(total);

  return {
    total,
    count,
    hp: total / count,
    speed: 1 + (total - 1) * 0.04,
    bossHp: total,
    bossSpeed: 1 + (total - 1) * 0.03,
  };
}

function midGamePressure(wave, totalWaves) {
  const start = Math.max(4, Math.round(totalWaves * 0.32));
  const end = Math.max(start + 2, Math.round(totalWaves * 0.72));
  if (wave < start || wave > end) return { count: 1, hp: 1, speed: 1 };

  const middle = (start + end) / 2;
  const halfRange = Math.max(1, (end - start) / 2);
  const centerStrength = 1 - Math.min(1, Math.abs(wave - middle) / halfRange);
  const pressure = 0.45 + centerStrength * 0.55;
  return {
    count: 1 + pressure * 0.14,
    hp: 1 + pressure * 0.18,
    speed: 1 + pressure * 0.045,
  };
}

function lateStageBossHpScale(stage) {
  if (stage < 10) return 1;
  return {
    10: 0.82,
    11: 0.76,
    12: 0.7,
    13: 0.67,
    14: 0.65,
    15: 0.65,
  }[stage] || 0.65;
}

function waveHealthScale(stage, wave, totalWaves, tier = null) {
  const progress = (wave - 1) / Math.max(1, totalWaves - 1);
  const ramp = Math.pow(progress, 1.65);
  const stageGrowth = 1 + ramp * (2.25 + stage * 0.12);
  const tierGrowth = tier === null ? 1 : 1 + ramp * (0.28 + tier * 0.04) / 0.78;
  const previousScale = stageGrowth * midGamePressure(wave, totalWaves).hp * tierGrowth;
  // Preserve wave-one HP; reduce the combined additional HP by exactly 20%.
  // Apply this once after combining growth factors, not once per multiplier.
  return 1 + (previousScale - 1) * WAVE_HEALTH_GROWTH_FACTOR;
}

function beginWave() {
  sound.wave();
  if (isMultiplayerGame()) {
    if (state.pendingWaveStart || state.awaitingRemoteWave) return;
    multiplayer.socket.emit("wave:start");
    return;
  }
  beginLocalWave();
}

function scheduleMultiplayerWaveStart(wave, startsAt) {
  if (state.startedWaves.has(wave) && (state.runningWave || state.pendingWaveStart || state.awaitingRemoteWave)) return;
  clearTimeout(multiplayer.waveStartTimer);
  state.pendingWaveStart = true;
  state.awaitingRemoteWave = false;
  state.wave = wave;
  state.spawns = [];
  state.mobs = [];
  toast(`Wave ${wave} starting`);
  updateHud();

  const delay = Math.max(0, Number(startsAt) - Date.now());
  multiplayer.waveStartTimer = setTimeout(() => {
    state.pendingWaveStart = false;
    if (isSimulationOwner()) {
      beginLocalWave(wave);
      return;
    }

    state.wave = wave;
    state.awaitingRemoteWave = true;
    state.runningWave = false;
    state.spawns = [];
    state.mobs = [];
    updateHud();
  }, delay);
}

function beginLocalWave(nextWave = state.wave + 1) {
  if (state.runningWave || state.wave >= state.currentLevel.waves) return;
  if (state.startedWaves.has(nextWave)) return;
  state.pendingWaveStart = false;
  state.awaitingRemoteWave = false;
  state.startedWaves.add(nextWave);
  state.wave = nextWave;
  state.runningWave = true;
  const waveProgress = (state.wave - 1) / Math.max(1, state.currentLevel.waves - 1);
  const waveRamp = Math.pow(waveProgress, 1.65);
  const coopScale = multiplayerWaveDifficulty(state.wave, state.currentLevel.waves);
  const midPressure = midGamePressure(state.wave, state.currentLevel.waves);
  const stage = state.currentLevel.id;
  const startCount = stage >= 10 ? 10 : 5;
  const finalExtra = 36 + stage * 2 + Math.floor(state.currentLevel.waves / 5) * 5;
  let count = startCount + Math.round((finalExtra * waveRamp) / 5) * 5;
  count = Math.ceil((count * coopScale.count * midPressure.count) / 5) * 5;
  if (state.wave === 1 && stage >= 10) count = Math.max(6, Math.floor(count * 0.6));
  const baseHp = 14 + stage * 5;
  const waveHpScale = waveHealthScale(stage, state.wave, state.currentLevel.waves);
  const speed = (37 + stage * 0.85 + waveRamp * (16 + stage * 0.7)) * midPressure.speed * 1.08;
  const spacing = Math.min(1.5, 1 + waveRamp * 0.3 + Math.max(0, stage - 1) * 0.012);
  const stagePressure = 1 + Math.min(0.08, Math.max(0, (stage - 1) * 0.006));
  const hp = baseHp * stagePressure * coopScale.hp;
  const stageCountScale = stage === 15 ? 0.92 : 1;
  const stageBossScale = 4.2 + stage * 0.18;
  const bossHpScale = lateStageBossHpScale(stage);
  const pathCount = state.currentLevel.paths.length;
  const pathSpawnCounts = Array(pathCount).fill(0);
  let lastSpawnTime = 0;
  for (let i = 0; i < count; i += 1) {
    const pathIndex = pathCount > 1 ? i % pathCount : 0;
    const spawnTime = pathSpawnCounts[pathIndex] * spacing;
    pathSpawnCounts[pathIndex] += 1;
    lastSpawnTime = Math.max(lastSpawnTime, spawnTime);
    const monster = monsterForSpawn(i);
    const heavy = monster.shape === "brute" || monster.shape === "armored";
    const tier = monster.tier || 0;
    const monsterHpScale = monster.hp * 0.78;
    const monsterWaveHpScale = waveHealthScale(stage, state.wave, state.currentLevel.waves, tier);
    const monsterSpeedScale = 1 + (monster.speed - 1) * (0.7 + waveRamp * 0.25);
    const monsterBaseDamage = Math.max(1, Math.round(monster.damage * (0.75 + waveRamp * 0.55)));
    state.spawns.push({
      t: spawnTime,
      pathIndex,
      hp: hp * monsterWaveHpScale * monsterHpScale * stageCountScale,
      speed: speed * coopScale.speed * monsterSpeedScale,
      reward: Math.round((9 + Math.floor(stage * 1.5)) * monster.reward * (1 + waveRamp * 0.4)),
      baseDamage: monsterBaseDamage,
      boss: false,
      heavy,
      monster,
    });
  }
  if (state.wave === state.currentLevel.waves) {
    const boss = state.currentLevel.boss;
    state.spawns.push({
      t: lastSpawnTime + 10,
      pathIndex: longestPathIndex(state.currentLevel.paths),
      hp: baseHp * waveHpScale * (7.5 + stage * 0.48) * stagePressure * stageBossScale * coopScale.bossHp * 1.8 * bossHpScale,
      speed: speed * 0.56 * coopScale.bossSpeed,
      reward: (10 + Math.floor(stage * 1.5)) * 15,
      baseDamage: 5 + Math.floor(stage / 5),
      boss: true,
      heavy: false,
      bossName: boss.name,
      bossColor: boss.color,
      monster: null,
    });
    const bossLane = longestPathIndex(state.currentLevel.paths);
    const bossMessage = state.currentLevel.paths.length > 1
      ? `${boss.name} is coming - Lane ${bossLane + 1}`
      : `${boss.name} is coming`;
    toast(bossMessage, "boss");
    broadcastRoomNotice(bossMessage);
  }
  updateHud();
}

function broadcastRoomNotice(message) {
  if (!isMultiplayerGame() || !isSimulationOwner()) return;
  multiplayer.socket.emit("room:notice", { message });
}

function monsterForSpawn(index) {
  const monsters = state.currentLevel.monsters || [];
  const waveRatio = (state.wave - 1) / Math.max(1, state.currentLevel.waves - 1);
  if (!monsters.length) {
    return { name: "Creep", color: "#303942", edge: "#aeb8bf", eye: "#ff5b55", hp: 1, speed: 1, damage: 1, reward: 1, shape: "normal" };
  }

  const activeCount = Math.min(monsters.length, 2 + Math.floor(waveRatio * 6));
  const activeMonsters = monsters.slice(0, activeCount);
  const advancedChance = Math.min(0.84, 0.08 + waveRatio * 0.68);
  const eliteChance = Math.min(0.34, Math.max(0, (waveRatio - 0.5) * 0.62));
  const roll = terrainRand(index + state.wave * 41 + state.currentLevel.id * 97, 1201);

  if (roll < eliteChance) {
    const elitePool = activeMonsters.slice(Math.max(0, activeMonsters.length - 3));
    return elitePool[index % elitePool.length];
  }
  if (roll < advancedChance) return activeMonsters[(index + state.wave) % activeMonsters.length];
  return activeMonsters[index % Math.min(2, activeMonsters.length)];
}

function spawnMob(spawn) {
  const path = state.currentLevel.paths[spawn.pathIndex];
  const monster = spawn.monster;
  state.mobs.push({
    uid: state.nextMobId++,
    x: path[0][0],
    y: path[0][1],
    hp: spawn.hp,
    maxHp: spawn.hp,
    speed: spawn.speed,
    reward: spawn.reward * (spawn.boss ? 3 : 1),
    baseDamage: spawn.baseDamage,
    pathIndex: spawn.pathIndex,
    waypoint: 1,
    slowTimer: 0,
    slowFactor: 1,
    dot: 0,
    poisonTimer: 0,
    burnTimer: 0,
    shockTimer: 0,
    shockColor: "#65ffe4",
    voidTimer: 0,
    boss: spawn.boss,
    heavy: spawn.heavy,
    monsterName: monster?.name,
    monsterColor: monster?.color,
    monsterEdge: monster?.edge,
    monsterEye: monster?.eye,
    monsterShape: monster?.shape || "normal",
    bossName: spawn.bossName,
    bossColor: spawn.bossColor,
  });
}

function baseDamageForEscapedMob(mob) {
  const healthRatio = mob.maxHp ? Math.max(0, Math.min(1, mob.hp / mob.maxHp)) : 1;
  return Math.max(1, Math.ceil(mob.baseDamage * healthRatio));
}

function update(dt) {
  if (!state.currentLevel) return;

  updateVolcanoFx(dt);
  state.shakeT = Math.max(0, (state.shakeT || 0) - dt);
  for (const spawn of state.spawns) spawn.t -= dt;
  const ready = state.spawns.filter((spawn) => spawn.t <= 0);
  state.spawns = state.spawns.filter((spawn) => spawn.t > 0);
  ready.forEach(spawnMob);

  for (const mob of state.mobs) {
    mob.prevX = mob.x;
    mob.prevY = mob.y;
    mob.prevProgress = mobPathProgress(mob);
    if (mob.dot > 0) {
      const dealt = Math.min(mob.dot * dt, mob.hp);
      mob.hp -= dealt;
      mob.dot = Math.max(0, mob.dot - 14 * dt);
    }
    mob.slowTimer -= dt;
    mob.poisonTimer = Math.max(0, (mob.poisonTimer || 0) - dt);
    mob.burnTimer = Math.max(0, (mob.burnTimer || 0) - dt);
    mob.shockTimer = Math.max(0, (mob.shockTimer || 0) - dt);
    mob.voidTimer = Math.max(0, (mob.voidTimer || 0) - dt);
    const speed = mob.speed * (mob.slowTimer > 0 ? mob.slowFactor : 1);
    moveMob(mob, speed * dt);
    mob.progress = calculateMobPathProgress(mob);
  }

  const escaped = state.mobs.filter((mob) => mob.escaped);
  if (escaped.length) {
    if (escaped.some((mob) => mob.boss)) {
      state.baseHp = 0;
    } else {
      const damage = escaped.reduce((sum, mob) => sum + baseDamageForEscapedMob(mob), 0);
      state.baseHp = state.wave === 1 ? Math.max(1, state.baseHp - damage) : state.baseHp - damage;
    }
    state.mobs = state.mobs.filter((mob) => !mob.escaped);
    if (state.baseHp <= 0) loseLevel();
  }

  state.placed.forEach((tower) => updateTower(tower, dt));
  updateSoldiers(dt);
  const railImpacts = [];
  state.shots = state.shots.filter((shot) => {
    if (shot.impactTarget && state.mobs.includes(shot.impactTarget) && shot.impactTarget.hp > 0) {
      shot.tx = shot.impactTarget.x;
      shot.ty = shot.impactTarget.y;
    }
    shot.life -= dt;
    if (shot.impactTarget && !shot.impacted && shot.life <= shot.impactLife) {
      shot.impacted = true;
      railImpacts.push(shot);
    }
    return shot.life > 0;
  });
  railImpacts.forEach((shot) => {
    if (!state.mobs.includes(shot.impactTarget) || shot.impactTarget.hp <= 0) return;
    applyDamage(shot.impactTower, shot.impactTarget, shot.impactStats);
  });
  if (state.shots.length > MAX_ACTIVE_SHOTS) {
    state.shots.splice(0, state.shots.length - MAX_ACTIVE_SHOTS);
  }

  const dead = state.mobs.filter((mob) => mob.hp <= 0);
  if (dead.length) {
    const killReward = dead.reduce((sum, mob) => sum + mob.reward, 0);
    state.kills += dead.length;
    dead.forEach(recordMobDiscovery);
    if (!isMultiplayerGame() || isSimulationOwner()) state.coins += killReward;
    broadcastCoinReward(killReward);
    if (!isMultiplayerGame() || isSimulationOwner()) {
      state.earnedXp += dead.reduce((sum, mob) => sum + mob.baseDamage * 2, 0);
    }
    state.mobs = state.mobs.filter((mob) => mob.hp > 0);
  }

  if (state.runningWave && state.spawns.length === 0 && state.mobs.length === 0) {
    state.runningWave = false;
    if (isMultiplayerGame() && isSimulationOwner()) {
      multiplayer.socket.emit("wave:end", { wave: state.wave });
    }
    const waveBonus = 75 + state.wave * 15;
    if (!isMultiplayerGame() || isSimulationOwner()) state.coins += waveBonus;
    broadcastCoinReward(waveBonus, "waveBonus");
    if (!isMultiplayerGame() || isSimulationOwner()) {
      announceWaveBonus(waveBonus);
      state.earnedGems += Math.max(1, Math.floor(state.currentLevel.rewardGems / state.currentLevel.waves));
      state.earnedXp += Math.max(8, Math.floor(state.currentLevel.rewardXp / state.currentLevel.waves));
    }
    if (state.wave >= state.currentLevel.waves) winLevel();
  }
  updateHudThrottled(dt);
  syncMobsToRoom(dt);
}

function updateHudThrottled(dt) {
  state.hudTimer -= dt;
  if (state.hudTimer > 0) return;
  state.hudTimer = 0.12;
  updateHud();
}

function broadcastCoinReward(amount, kind = "kill") {
  if (!isMultiplayerGame() || !isSimulationOwner() || amount <= 0) return;
  multiplayer.socket.emit("coins:reward", { amount, kind });
}

function mergeRemoteMobs(remoteMobs) {
  const existingById = new Map(state.mobs.map((mob) => [mob.uid, mob]));
  const numericIds = remoteMobs.map((mob) => Number(mob.uid)).filter((uid) => Number.isFinite(uid));
  if (numericIds.length) state.nextMobId = Math.max(state.nextMobId, Math.max(...numericIds) + 1);
  state.mobs = remoteMobs.map((remote, index) => {
    const uid = remote.uid ?? `remote-${index}`;
    const existing = existingById.get(uid);
    if (!existing) {
      return {
        ...remote,
        uid,
        targetX: remote.x,
        targetY: remote.y,
      };
    }

    return {
      ...existing,
      ...remote,
      uid,
      x: existing.x,
      y: existing.y,
      targetX: remote.x,
      targetY: remote.y,
    };
  });
}

function mergeRemoteSoldiers(remoteSoldiers) {
  state.soldiers = remoteSoldiers.map((remote, index) => {
    const owner = state.placed.find((tower) => tower.uid === remote.ownerUid) || null;
    const existing = state.soldiers[index];
    if (!existing) return { ...remote, owner, targetX: remote.x, targetY: remote.y };
    return {
      ...existing,
      ...remote,
      owner,
      x: existing.x,
      y: existing.y,
      targetX: remote.x,
      targetY: remote.y,
    };
  });
}

function updateRemoteEntities(dt) {
  const snap = Math.min(1, dt * 14);
  state.mobs.forEach((mob) => {
    if (typeof mob.targetX !== "number" || typeof mob.targetY !== "number") return;
    mob.x += (mob.targetX - mob.x) * snap;
    mob.y += (mob.targetY - mob.y) * snap;
  });
  state.soldiers.forEach((soldier) => {
    if (typeof soldier.targetX !== "number" || typeof soldier.targetY !== "number") return;
    soldier.x += (soldier.targetX - soldier.x) * snap;
    soldier.y += (soldier.targetY - soldier.y) * snap;
  });
}

function syncMobsToRoom(dt) {
  if (!isMultiplayerGame() || !isSimulationOwner()) return;
  state.mobSyncTimer -= dt;
  if (state.mobSyncTimer > 0) return;
  state.mobSyncTimer = 0.08;

  multiplayer.socket.emit("mobs:sync", {
    baseHp: state.baseHp,
    wave: state.wave,
    runningWave: state.runningWave,
    kills: state.kills,
    mobs: state.mobs.map((mob) => ({
      uid: mob.uid,
      x: mob.x,
      y: mob.y,
      hp: mob.hp,
      maxHp: mob.maxHp,
      speed: mob.speed,
      reward: mob.reward,
      baseDamage: mob.baseDamage,
      pathIndex: mob.pathIndex,
      waypoint: mob.waypoint,
      slowTimer: mob.slowTimer,
      slowFactor: mob.slowFactor,
      dot: mob.dot,
      poisonTimer: mob.poisonTimer,
      burnTimer: mob.burnTimer,
      shockTimer: mob.shockTimer,
      shockColor: mob.shockColor,
      voidTimer: mob.voidTimer,
      boss: mob.boss,
      heavy: mob.heavy,
      monsterName: mob.monsterName,
      monsterColor: mob.monsterColor,
      monsterEdge: mob.monsterEdge,
      monsterEye: mob.monsterEye,
      monsterShape: mob.monsterShape,
      bossName: mob.bossName,
      bossColor: mob.bossColor,
    })),
    spawns: state.spawns.map((spawn) => ({ ...spawn })),
    soldiers: state.soldiers.map((soldier) => ({
      ownerUid: soldier.owner?.uid,
      x: soldier.x,
      y: soldier.y,
      pathIndex: soldier.pathIndex,
      progress: soldier.progress,
      hp: soldier.hp,
      maxHp: soldier.maxHp,
      damage: soldier.damage,
      speed: soldier.speed,
      range: soldier.range,
      reload: soldier.reload,
      cooldown: soldier.cooldown,
      color: soldier.color,
    })),
    shots: state.shots.map((shot) => ({
      x: shot.x,
      y: shot.y,
      tx: shot.tx,
      ty: shot.ty,
      color: shot.color,
      life: shot.life,
      radius: shot.radius,
      style: shot.style,
      beam: shot.beam,
      width: shot.width,
      maxLife: shot.maxLife,
    })),
  });
}

function moveMob(mob, distance) {
  const path = state.currentLevel.paths[mob.pathIndex];
  while (distance > 0 && mob.waypoint < path.length) {
    const target = path[mob.waypoint];
    const dx = target[0] - mob.x;
    const dy = target[1] - mob.y;
    const len = Math.hypot(dx, dy);
    if (len <= distance) {
      mob.x = target[0];
      mob.y = target[1];
      mob.waypoint += 1;
      distance -= len;
    } else {
      mob.x += (dx / len) * distance;
      mob.y += (dy / len) * distance;
      distance = 0;
    }
  }
  if (mob.waypoint >= path.length) mob.escaped = true;
}

function pathLength(path) {
  if (Number.isFinite(path.cachedLength)) return path.cachedLength;
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  }
  path.cachedLength = total;
  return total;
}

function longestPathIndex(paths) {
  let bestIndex = 0;
  let bestLength = -1;
  paths.forEach((path, index) => {
    const length = pathLength(path);
    if (length > bestLength) {
      bestLength = length;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function pointOnPath(path, progress) {
  let remaining = Math.max(0, Math.min(pathLength(path), progress));
  for (let i = 1; i < path.length; i += 1) {
    const from = path[i - 1];
    const to = path[i];
    const segment = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (remaining <= segment) {
      const ratio = segment ? remaining / segment : 0;
      return {
        x: from[0] + (to[0] - from[0]) * ratio,
        y: from[1] + (to[1] - from[1]) * ratio,
      };
    }
    remaining -= segment;
  }
  const last = path[path.length - 1];
  return { x: last[0], y: last[1] };
}

function moveSoldierAlongPath(soldier, progressDelta) {
  const path = state.currentLevel.paths[soldier.pathIndex];
  soldier.progress = Math.max(0, Math.min(pathLength(path), soldier.progress + progressDelta));
  const point = pointOnPath(path, soldier.progress);
  soldier.x = point.x;
  soldier.y = point.y;
}

function supportBonusesForTower(tower) {
  if (tower.kind === "support" || tower.kind === "income") {
    return { fireRate: 1, damage: 1 };
  }

  let fireRate = 1;
  let damage = 1;
  for (const support of state.placed) {
    if (support.kind !== "support" || support === tower) continue;
    const supportStats = towerStatsAtLevel(support, support.level);
    if (!supportStats.range) continue;
    if (Math.hypot(support.x - tower.x, support.y - tower.y) > supportStats.range) continue;
    fireRate += supportStats.fireRateBoost || 0;
    damage += supportStats.damageBoost || 0;
  }
  return { fireRate, damage };
}

function combatStatsForTower(tower) {
  const stats = towerStatsAtLevel(tower, tower.level);
  if (tower.kind === "support") return stats;
  const bonuses = supportBonusesForTower(tower);
  return {
    ...stats,
    damage: stats.damage * bonuses.damage,
    poison: stats.poison ? stats.poison * bonuses.damage : 0,
    burn: stats.burn ? stats.burn * bonuses.damage : 0,
    reload: tower.id === "orbital" ? 0 : tower.kind === "summon" ? stats.reload : stats.reload / Math.max(0.1, bonuses.fireRate),
    beamDamage: tower.id === "orbital" ? stats.beamDamage * bonuses.damage * bonuses.fireRate : 0,
    soldierDamage: stats.soldierDamage ? stats.soldierDamage * bonuses.damage : 0,
    soldierReload: stats.soldierReload ? stats.soldierReload / Math.max(0.1, bonuses.fireRate) : 0,
  };
}

function towerShotOrigin(tower) {
  // These coordinates match the visible weapon, crystal, coil, or effect drawn in drawTower.
  const anchors = {
    dart: { x: 28, y: -24 },
    ice: { x: -1, y: -59 },
    spark: { x: 0, y: -51 },
    sniper: { x: -29, y: -20 },
    venom: { x: 0, y: -45 },
    bank: { x: -2, y: -57 },
    tesla: { x: 0, y: -50 },
    ember: { x: 1, y: -48 },
    haste: { x: 0, y: -32 },
    power: { x: -2, y: -46 },
    barracks: { x: 1, y: -43 },
    void: { x: 0, y: -45 },
    ranger: { x: -25, y: -38 },
    rail: { x: -26, y: -17 },
    orbital: { x: 0, y: -49 },
    laser: { x: 18, y: -18 },
    quake: { x: 0, y: -40 },
  };
  const anchor = anchors[tower.id] || { x: 0, y: -16 };
  return { x: tower.x + anchor.x, y: tower.y + anchor.y };
}

function updateTower(tower, dt) {
  if (tower.kind === "support") return;
  if (tower.kind === "income" && (!state.runningWave || state.wave < 1)) return;
  if (tower.kind === "summon" && (!state.runningWave || state.wave < 1)) return;
  tower.cooldown -= dt;
  const stats = combatStatsForTower(tower);
  if (tower.kind === "summon" && tower.cooldown <= 0) {
    spawnSoldier(tower, stats);
    tower.cooldown = stats.reload;
    return;
  }
  if (tower.kind === "income" && tower.cooldown <= 0) {
    if (!isMultiplayerGame() || tower.ownerId === multiplayer.socket.id) {
      const origin = towerShotOrigin(tower);
      state.coins += stats.income;
      sound.coins();
      state.shots.push({
        x: origin.x,
        y: origin.y,
        tx: origin.x,
        ty: origin.y,
        color: tower.color,
        life: 0.42,
        maxLife: 0.42,
        style: "coinPulse",
        radius: 26,
      });
    }
    tower.cooldown = stats.reload;
    return;
  }
  if (tower.id === "orbital") {
    const target = findFirstTarget(tower, stats);
    if (!target) return;
    tower.target = target;
    target.hp -= stats.beamDamage * dt;
    const origin = towerShotOrigin(tower);
    state.shots.push({
      x: origin.x,
      y: origin.y,
      tx: target.x,
      ty: target.y,
      color: tower.color,
      life: Math.max(0.04, dt + 0.02),
      maxLife: Math.max(0.04, dt + 0.02),
      style: "orbital",
      beam: true,
      width: 4.5,
    });
    sound.attack("orbital");
    return;
  }
  if (tower.cooldown > 0) return;
  const target = findFirstTarget(tower, stats);
  if (!target) return;
  tower.target = target;
  tower.cooldown = stats.reload;
  const shot = createTowerShot(tower, target, stats);
  if (tower.id === "rail") {
    shot.impactTarget = target;
    shot.impactTower = tower;
    shot.impactStats = stats;
    // Apply damage on the same frame that the faster visible rail streak reaches its target.
    shot.impactLife = shot.life * 0.3;
  } else {
    applyDamage(tower, target, stats);
  }
  state.shots.push(shot);
  sound.attack(shot.style);
}

function createTowerShot(tower, target, stats) {
  const origin = towerShotOrigin(tower);
  const base = {
    x: origin.x,
    y: origin.y,
    tx: target.x,
    ty: target.y,
    color: tower.color,
    radius: stats.splash || 0,
  };
  const styles = {
    dart: { style: "arrow", life: 0.24, width: 3 },
    ice: { style: "ice", life: 0.28, width: 4 },
    spark: { style: "lightning", life: 0.12, width: 2 },
    tesla: { style: "tesla", life: 0.13, width: 2.5 },
    sniper: { style: "bullet", life: 0.18, width: 2.5 },
    rail: { style: "rail", life: 0.18, width: 5 },
    venom: { style: "poison", life: 0.3, width: 5 },
    ember: { style: "fire", life: 0.3, width: 6 },
    laser: { style: "laser", life: 0.22, width: 4 },
    void: { style: "void", life: 0.32, width: 5 },
    ranger: { style: "ranger", life: 0.18, width: 3 },
  };
  const shot = { ...base, ...(styles[tower.id] || { style: tower.kind || "basic", life: 0.16, width: 3 }) };
  shot.maxLife = shot.life;
  return shot;
}

function spawnSoldier(tower, stats) {
  const existing = state.soldiers.filter((soldier) => soldier.owner === tower).length;

  const pathIndex = tower.spawnPathIndex || 0;
  tower.spawnPathIndex = pathIndex + 1;
  const path = state.currentLevel.paths[pathIndex % state.currentLevel.paths.length];
  const startProgress = Math.max(0, pathLength(path) - 8 - existing * 12);
  const point = pointOnPath(path, startProgress);
  state.soldiers.push({
    owner: tower,
    x: point.x,
    y: point.y,
    pathIndex: pathIndex % state.currentLevel.paths.length,
    progress: startProgress,
    hp: stats.soldierHp,
    maxHp: stats.soldierHp,
    damage: stats.soldierDamage,
    speed: stats.soldierSpeed,
    range: stats.soldierRange,
    reload: stats.soldierReload,
    cooldown: 0,
    color: tower.color,
  });
  state.shots.push({
    x: point.x,
    y: point.y,
    tx: point.x,
    ty: point.y,
    color: tower.color,
    life: 0.45,
    maxLife: 0.45,
    style: "spawn",
    radius: 24,
  });
  sound.attack("spawn");
}

function updateSoldiers(dt) {
  for (const soldier of state.soldiers) {
    soldier.cooldown -= dt;
    const collision = soldierCollisionTarget(soldier);
    if (collision) {
      resolveSoldierCollision(soldier, collision);
      continue;
    }

    const target = soldier.range ? soldierTargetInRange(soldier) : soldierTarget(soldier);
    if (!target) {
      moveSoldierAlongPath(soldier, -soldier.speed * dt);
      continue;
    }

    const targetProgress = mobPathProgress(target);
    const progressDistance = targetProgress - soldier.progress;
    const screenDistance = Math.hypot(target.x - soldier.x, target.y - soldier.y);

    if (soldier.range && screenDistance <= soldier.range) {
      if (soldier.cooldown <= 0) {
        target.hp -= soldier.damage * 0.55;
        soldier.cooldown = soldier.reload;
        state.shots.push({
          x: soldier.x + 21,
          y: soldier.y - 7,
          tx: target.x,
          ty: target.y,
          color: soldier.color,
          life: 0.12,
          maxLife: 0.12,
          width: 2,
          style: "soldier",
        });
        sound.attack("soldier");
      }
      continue;
    }

    if (progressDistance < -18) {
      moveSoldierAlongPath(soldier, -soldier.speed * dt);
      continue;
    }

    if (progressDistance > 18) continue;

    if (soldier.cooldown > 0) continue;
    resolveSoldierCollision(soldier, target);
    soldier.cooldown = 0.55;
  }

  state.soldiers = state.soldiers.filter((soldier) => soldier.hp > 0 && soldier.progress > 0.5);
}

function resolveSoldierCollision(soldier, mob) {
  state.shots.push({
    x: soldier.x,
    y: soldier.y,
    tx: mob.x,
    ty: mob.y,
    color: soldier.color,
    life: 0.18,
    maxLife: 0.18,
    style: "melee",
    radius: 18,
  });
  sound.attack("melee");
  if (soldier.hp >= mob.hp) {
    soldier.hp -= mob.hp;
    mob.hp = 0;
    return;
  }
  mob.hp -= soldier.hp;
  soldier.hp = 0;
}

function soldierCollisionTarget(soldier) {
  let best = null;
  let bestDistance = Infinity;
  for (const mob of state.mobs) {
    if (mob.hp <= 0) continue;
    const screenDistance = Math.hypot(mob.x - soldier.x, mob.y - soldier.y);
    const samePathDistance = mob.pathIndex === soldier.pathIndex ? soldierPathCollisionDistance(soldier, mob) : Infinity;
    const intersectsOtherPath = mob.pathIndex !== soldier.pathIndex && screenDistance <= 30;
    const intersectsSamePath = samePathDistance <= 34;
    const distance = intersectsSamePath ? samePathDistance : screenDistance;
    if ((intersectsSamePath || intersectsOtherPath) && distance < bestDistance) {
      best = mob;
      bestDistance = distance;
    }
  }
  return best;
}

function soldierPathCollisionDistance(soldier, mob) {
  const currentProgress = mobPathProgress(mob);
  const previousProgress = Number.isFinite(mob.prevProgress) ? mob.prevProgress : currentProgress;
  const soldierProgress = soldier.progress;
  const directDistance = Math.abs(currentProgress - soldierProgress);
  const crossedSoldier = previousProgress <= soldierProgress + 10 && currentProgress >= soldierProgress - 10;
  return crossedSoldier ? 0 : directDistance;
}

function soldierTarget(soldier) {
  let best = null;
  let bestProgressDistance = Infinity;
  for (const mob of state.mobs) {
    if (mob.hp <= 0 || mob.pathIndex !== soldier.pathIndex) continue;
    const distance = Math.abs(mobPathProgress(mob) - soldier.progress);
    if (distance < bestProgressDistance) {
      best = mob;
      bestProgressDistance = distance;
    }
  }
  return best;
}

function soldierTargetInRange(soldier) {
  let best = null;
  let bestDistanceToBase = Infinity;
  for (const mob of state.mobs) {
    if (mob.hp <= 0) continue;
    if (Math.hypot(mob.x - soldier.x, mob.y - soldier.y) > soldier.range) continue;
    const distanceToBase = mobDistanceToBase(mob);
    if (distanceToBase < bestDistanceToBase) {
      best = mob;
      bestDistanceToBase = distanceToBase;
    }
  }
  return best;
}

function lockedTarget(tower, stats) {
  if (tower.target && targetIsValid(tower, tower.target, stats)) return tower.target;
  tower.target = findFirstTarget(tower, stats);
  return tower.target;
}

function targetIsValid(tower, target, stats) {
  return state.mobs.includes(target) && target.hp > 0 && Math.hypot(target.x - tower.x, target.y - tower.y) <= stats.range;
}

function findFirstTarget(tower, stats) {
  let best = null;
  let bestDistanceToBase = Infinity;
  const rangeSq = stats.range * stats.range;
  for (const mob of state.mobs) {
    if (mob.hp <= 0) continue;
    const dx = mob.x - tower.x;
    const dy = mob.y - tower.y;
    if (dx * dx + dy * dy > rangeSq) continue;
    const distanceToBase = mobDistanceToBase(mob);
    if (distanceToBase < bestDistanceToBase) {
      best = mob;
      bestDistanceToBase = distanceToBase;
    }
  }
  return best;
}

function mobDistanceToBase(mob) {
  const path = state.currentLevel.paths[mob.pathIndex];
  return Math.max(0, pathLength(path) - mobPathProgress(mob));
}

function mobPathProgress(mob) {
  if (Number.isFinite(mob.progress)) return mob.progress;
  mob.progress = calculateMobPathProgress(mob);
  return mob.progress;
}

function calculateMobPathProgress(mob) {
  const path = state.currentLevel.paths[mob.pathIndex];
  let progress = 0;
  for (let i = 1; i < mob.waypoint; i += 1) {
    progress += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  }
  if (mob.waypoint < path.length) {
    progress += Math.hypot(mob.x - path[mob.waypoint - 1][0], mob.y - path[mob.waypoint - 1][1]);
  }
  return progress;
}

function applyDamage(tower, target, stats) {
  const affected = stats.splash
    ? state.mobs.filter((mob) => Math.hypot(mob.x - target.x, mob.y - target.y) <= stats.splash)
    : [target];

  if (stats.splash) {
    affected.forEach((mob) => {
      mob.hp -= stats.damage;
    });
  } else {
    target.hp -= stats.damage;
    if (stats.pierceHits > 1) {
      const pierceHits = tower.id === "rail" ? railPierceHits(tower, target, stats) : samePathPierceHits(target, stats);
      pierceHits.forEach(({ mob }, index) => {
        mob.hp -= stats.damage * Math.max(0.55, 0.85 - index * 0.1);
      });
    }
  }
  if (stats.slow) {
    affected.forEach((mob) => {
      mob.slowTimer = 1.8;
      mob.slowFactor = stats.slow;
    });
  }
  if (stats.poison || stats.burn) {
    affected.forEach((mob) => {
      mob.dot += stats.poison || stats.burn;
      if (stats.poison) mob.poisonTimer = Math.max(mob.poisonTimer || 0, 2.8);
      if (stats.burn) mob.burnTimer = Math.max(mob.burnTimer || 0, 2.4);
    });
  }
  if (tower.id === "void") {
    affected.forEach((mob) => {
      mob.voidTimer = Math.max(mob.voidTimer || 0, 2.1);
    });
  }
  if (tower.kind === "chain") {
    const shockColor = tower.id === "spark" ? "#b98cff" : "#65ffe4";
    const drawChainFx = state.shots.length < MAX_ACTIVE_SHOTS * 0.55 && state.mobs.length < 90;
    const maxDrawnJumps = drawChainFx ? Math.min(stats.chainTargets, 2) : 0;
    target.shockTimer = Math.max(target.shockTimer || 0, drawChainFx ? 0.24 : 0.1);
    target.shockColor = shockColor;
    let chainSource = target;
    const jumps = nearestChainTargets(target, stats.chainTargets);
    let activeChainShots = state.shots.reduce((count, shot) => (
      shot.style === "chainLightning" || shot.style === "chainTesla" ? count + 1 : count
    ), 0);
    jumps.forEach((mob, index) => {
      const chainDamageScale = tower.id === "tesla"
        ? Math.max(0.12, 0.44 - index * 0.07)
        : Math.max(0.2, 0.4 - index * 0.05);
      mob.hp -= stats.damage * chainDamageScale;
      mob.shockTimer = Math.max(mob.shockTimer || 0, drawChainFx ? 0.24 : 0.1);
      mob.shockColor = shockColor;
      if (index < maxDrawnJumps && state.shots.length < MAX_ACTIVE_SHOTS && activeChainShots < MAX_ACTIVE_CHAIN_SHOTS) {
        state.shots.push({
          x: chainSource.x,
          y: chainSource.y,
          tx: mob.x,
          ty: mob.y,
          color: tower.color,
          life: tower.id === "tesla" ? 0.16 : 0.14,
          maxLife: tower.id === "tesla" ? 0.16 : 0.14,
          style: tower.id === "tesla" ? "chainTesla" : "chainLightning",
          width: tower.id === "tesla" ? 2 : 1.6,
          simple: true,
        });
        activeChainShots += 1;
      }
      chainSource = mob;
    });
    if (jumps.length && drawChainFx) sound.attack(tower.id === "tesla" ? "chainTesla" : "chainLightning");
  }
}

function nearestChainTargets(target, maxTargets) {
  if (!maxTargets) return [];
  const nearest = [];
  for (const mob of state.mobs) {
    if (mob === target || mob.hp <= 0) continue;
    const dx = mob.x - target.x;
    const dy = mob.y - target.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq > CHAIN_RANGE_SQ) continue;
    let insertAt = nearest.length;
    while (insertAt > 0 && distanceSq < nearest[insertAt - 1].distanceSq) insertAt -= 1;
    if (insertAt >= maxTargets) continue;
    nearest.splice(insertAt, 0, { mob, distanceSq });
    if (nearest.length > maxTargets) nearest.pop();
  }
  return nearest.map((entry) => entry.mob);
}

function samePathPierceHits(target, stats) {
  const targetProgress = mobPathProgress(target);
  return state.mobs
    .filter((mob) => mob !== target && mob.pathIndex === target.pathIndex && mob.hp > 0)
    .map((mob) => ({ mob, progress: mobPathProgress(mob) }))
    .filter(({ progress }) => progress < targetProgress && targetProgress - progress <= 110)
    .sort((a, b) => b.progress - a.progress)
    .slice(0, stats.pierceHits - 1);
}

function railPierceHits(tower, target, stats) {
  const dx = target.x - tower.x;
  const dy = target.y - tower.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = dx / length;
  const ny = dy / length;
  const endX = tower.x + nx * stats.range;
  const endY = tower.y + ny * stats.range;

  return state.mobs
    .filter((mob) => mob !== target && mob.hp > 0)
    .map((mob) => ({
      mob,
      projection: (mob.x - tower.x) * nx + (mob.y - tower.y) * ny,
      lineDistance: distanceToSegment(mob.x, mob.y, tower.x, tower.y, endX, endY),
    }))
    .filter(({ projection, lineDistance }) => projection > 18 && projection <= stats.range + 12 && lineDistance <= 24)
    .sort((a, b) => a.projection - b.projection)
    .slice(0, stats.pierceHits - 1);
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  if (state.shakeT > 0 && state.shakePower) {
    const k = state.shakeT / (state.shakeDur || 1);
    ctx.translate((Math.random() - 0.5) * 2 * state.shakePower * k, (Math.random() - 0.5) * 2 * state.shakePower * k);
  }
  drawMap();
  drawLavaPools();
  drawSelectedRange();
  drawPlacementPreview();
  state.placed.forEach(drawTower);
  state.soldiers.forEach(drawSoldier);
  state.mobs.forEach(drawMob);
  state.mobs.forEach(drawMobNameLabel);
  state.shots.forEach(drawShot);
  drawLavaBlobs();
  drawBossWarning();
  ctx.restore();
}

function triggerShake(duration, power) {
  state.shakeT = Math.max(state.shakeT || 0, duration);
  state.shakeDur = duration;
  state.shakePower = power;
}

function drawMuzzleCharge(tower, tipX, tipY, color, chargeWindow = 0.9) {
  if (!(tower.cooldown > 0 && tower.cooldown <= chargeWindow)) return;
  const readiness = 1 - tower.cooldown / chargeWindow;
  const t = performance.now() / 1000;
  ctx.save();
  ctx.fillStyle = color;
  for (let i = 0; i < 4; i += 1) {
    const a = t * 6 + (i * Math.PI) / 2;
    const d = 3 + 13 * (1 - readiness);
    ctx.globalAlpha = 0.3 + readiness * 0.6;
    ctx.beginPath();
    ctx.arc(tipX + Math.cos(a) * d, tipY + Math.sin(a) * d * 0.7, 1.2 + readiness * 1.3, 0, Math.PI * 2);
    ctx.fill();
  }
  const glowR = 4 + readiness * 6;
  const glow = ctx.createRadialGradient(tipX, tipY, 1, tipX, tipY, glowR);
  glow.addColorStop(0, color);
  glow.addColorStop(1, "#ffffff00");
  ctx.globalAlpha = 0.25 + readiness * 0.6;
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(tipX, tipY, glowR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function laneEntryPoint(path) {
  const [x0, y0] = path[0];
  const [x1, y1] = path[1] || path[0];
  for (let t = 0; t <= 1; t += 0.05) {
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    if (x >= 34 && x <= canvas.width - 34 && y >= 34 && y <= canvas.height - 34) return { x, y };
  }
  return { x: x1, y: y1 };
}

function drawBossWarning() {
  const spawn = state.spawns.find((s) => s.boss);
  if (!spawn || !state.currentLevel) {
    drawBossWarning.motion = null;
    return;
  }
  const now = performance.now();
  const key = `${state.currentLevel.id}:${state.wave}:${spawn.bossName}:${spawn.pathIndex}`;
  const seconds = Math.max(0, Math.ceil(spawn.t));
  if (drawBossWarning.motion?.key !== key) drawBossWarning.motion = { key, started: now, tick: now, seconds };
  const motion = drawBossWarning.motion;
  if (motion.seconds !== seconds) { motion.seconds = seconds; motion.tick = now; }
  const path = state.currentLevel.paths[spawn.pathIndex];
  if (!path) return;
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#ff4d3d";
  ctx.globalAlpha = 0.12 + pulse * 0.14;
  ctx.lineWidth = 54;
  traceRoadPath(path);
  ctx.stroke();
  ctx.globalAlpha = 0.32 + pulse * 0.3;
  ctx.lineWidth = 5;
  ctx.setLineDash([26, 20]);
  ctx.lineDashOffset = -(performance.now() / 24) % 46;
  traceRoadPath(path);
  ctx.stroke();
  ctx.setLineDash([]);

  const p = laneEntryPoint(path);
  const ringR = 26 + pulse * 6;
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#ff6f5e";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(p.x, p.y, ringR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#150808ee";
  ctx.beginPath();
  ctx.arc(p.x, p.y, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ff6f5e";
  ctx.font = "bold 20px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("☠", p.x, p.y + 1);
  ctx.font = "bold 15px sans-serif";
  ctx.fillStyle = "#ffd7d2";
  const label = `${spawn.bossName || "Boss"} in ${seconds}s`;
  const labelX = canvas.width / 2;
  // Leave room above for a wave-bonus banner or the active boss health bar.
  const labelY = els.bossBar.classList.contains("show") ? 210 : els.waveBonus.classList.contains("show") ? 145 : 100;
  ctx.strokeStyle = "#150808";
  ctx.lineWidth = 4;
  const maxLabelWidth = canvas.width - 48;
  const measured = ctx.measureText(label).width;
  if (measured > maxLabelWidth) ctx.font = `bold ${Math.max(9, Math.floor(15 * maxLabelWidth / measured))}px sans-serif`;
  const enter = Math.min(1, (now - motion.started) / 440);
  const tick = Math.max(0, 1 - (now - motion.tick) / 240);
  ctx.globalAlpha = Math.min(enter * 2, 1) * Math.min(1, Math.max(0, spawn.t) / .25);
  ctx.translate(labelX, labelY - (reducedMotion.matches ? 0 : 16 * (1 - enter) ** 2));
  const scale = reducedMotion.matches ? 1 : 1 - .14 * (1 - enter) ** 2 + .045 * Math.sin(tick * Math.PI);
  ctx.scale(scale, scale);
  const panelWidth = Math.min(maxLabelWidth, ctx.measureText(label).width) + 28;
  ctx.fillStyle = "#210e14ee";
  ctx.strokeStyle = "#ff7868";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(-panelWidth / 2, -18, panelWidth, 36, 10);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "#150808";
  ctx.lineWidth = 3;
  ctx.fillStyle = "#ffe5df";
  ctx.strokeText(label, 0, 0, maxLabelWidth);
  ctx.fillText(label, 0, 0, maxLabelWidth);
  ctx.restore();
}

function drawPlacementPreview() {
  if (!state.selectedTowerType || state.previewX === null || state.previewY === null) return;
  const tower = towerById(state.selectedTowerType);
  const previewTower = { ...tower, x: state.previewX, y: state.previewY, level: 1 };
  const stats = towerStatsAtLevel(previewTower, 1);
  const placeable = state.previewPlaceable;
  const ringColor = placeable ? "#ffffff" : "#ec675d";

  if (stats.range) {
    ctx.strokeStyle = `${ringColor}aa`;
    ctx.lineWidth = stats.range > 180 ? 1.6 : 2;
    ctx.beginPath();
    ctx.arc(previewTower.x, previewTower.y, stats.range, 0, Math.PI * 2);
    if (stats.range <= 180) {
      ctx.fillStyle = `${tower.color}12`;
      ctx.fill();
    }
    ctx.stroke();
  }

  ctx.save();
  ctx.globalAlpha = placeable ? 0.65 : 0.5;
  drawTower(previewTower, { ghost: true, blocked: !placeable });
  ctx.restore();
}

function drawSelectedRange() {
  const tower = state.selectedPlaced;
  if (!tower) return;
  const stats = towerStatsAtLevel(tower, tower.level);
  if (!stats.range) return;
  ctx.fillStyle = `${tower.color}14`;
  ctx.strokeStyle = `${tower.color}aa`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(tower.x, tower.y, stats.range, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawMap() {
  const biome = biomeForStage(state.currentLevel.id);
  drawBiomeBackground(biome);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  state.currentLevel.paths.forEach((path) => {
    ctx.strokeStyle = biome.road.outer;
    ctx.lineWidth = 50;
    traceRoadPath(path);
    ctx.stroke();

    ctx.strokeStyle = biome.road.mid;
    ctx.lineWidth = 38;
    ctx.stroke();

    ctx.strokeStyle = biome.road.inner;
    ctx.lineWidth = 24;
    ctx.globalAlpha = 0.72;
    ctx.stroke();

    ctx.strokeStyle = biome.road.dash;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.22;
    ctx.setLineDash([18, 22]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  });
  drawForegroundFeaturesOverRoad();
  drawCodeNote();
  drawBase();
}

function traceRoadPath(path) {
  ctx.beginPath();
  ctx.moveTo(path[0][0], path[0][1]);
  if (path.length <= 2) {
    path.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
    return;
  }

  for (let i = 1; i < path.length - 1; i += 1) {
    const [x, y] = path[i];
    const [nextX, nextY] = path[i + 1];
    ctx.quadraticCurveTo(x, y, (x + nextX) / 2, (y + nextY) / 2);
  }
  const last = path[path.length - 1];
  ctx.lineTo(last[0], last[1]);
}

function drawBiomeVignette(biome) {
  ctx.globalAlpha = 0.26;
  const vignette = ctx.createRadialGradient(canvas.width * 0.48, canvas.height * 0.45, 80, canvas.width * 0.5, canvas.height * 0.5, canvas.width * 0.72);
  vignette.addColorStop(0, "#ffffff00");
  vignette.addColorStop(1, biome.vignette);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1;
}

function drawBiomeBackground(biome) {
  const sseed = state.currentLevel.id * 53;
  const generatedBg = stageBackgroundImage(state.currentLevel.id);
  if (generatedBg) {
    drawStageBackgroundImage(generatedBg);
    drawBiomeVignette(biome);
    return;
  }

  const ground = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  ground.addColorStop(0, biome.ground[0]);
  ground.addColorStop(0.42, biome.ground[1]);
  ground.addColorStop(1, biome.ground[2]);
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 30; i += 1) {
    const col = i % 7;
    const row = Math.floor(i / 7);
    const cellW = canvas.width / 7;
    const cellH = canvas.height / 4;
    const x = col * cellW + cellW * (0.2 + terrainRand(i + sseed, 3) * 0.62);
    const y = row * cellH + cellH * (0.18 + terrainRand(i + sseed, 9) * 0.66);
    const rx = 54 + terrainRand(i + sseed, 15) * 92;
    const ry = 20 + terrainRand(i + sseed, 21) * 46;
    const patch = ctx.createRadialGradient(x, y, 3, x, y, rx);
    const earthy = biome.patches[i % biome.patches.length];
    patch.addColorStop(0, `${earthy}b8`);
    patch.addColorStop(0.62, `${earthy}42`);
    patch.addColorStop(1, `${earthy}00`);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(terrainRand(i + sseed, 27) * Math.PI);
    ctx.scale(1, ry / rx);
    ctx.fillStyle = patch;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 210; i += 1) {
    const x = terrainRand(i + sseed, 101) * canvas.width;
    const y = terrainRand(i + sseed, 207) * canvas.height;
    const w = 2.5 + terrainRand(i + sseed, 313) * 8;
    const h = 1.8 + terrainRand(i + sseed, 419) * 4.5;
    ctx.fillStyle = biome.speckles[i % biome.speckles.length];
    ctx.beginPath();
    ctx.ellipse(x, y, w, h, terrainRand(i + sseed, 521) * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = biome.scratch;
  ctx.lineWidth = 2;
  for (let i = 0; i < 26; i += 1) {
    const x = terrainRand(i + sseed, 631) * canvas.width;
    const y = terrainRand(i + sseed, 727) * canvas.height;
    const length = 16 + terrainRand(i + sseed, 811) * 34;
    const bend = -12 + terrainRand(i + sseed, 907) * 24;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + length * 0.45, y + bend, x + length, y - bend * 0.35);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  if (biome.key === "meadow") drawMeadowExtras(sseed);
  else if (biome.key === "desert") drawDesertExtras(sseed);
  else if (biome.key === "swamp") drawSwampExtras(sseed);
  else if (biome.key === "tundra") drawTundraExtras(sseed);
  else drawVolcanicExtras(sseed);
  drawNaturalScatter(biome, sseed);

  drawBiomeVignette(biome);
}

function drawStageBackgroundImage(img) {
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
}

function drawBase() {
  ctx.save();
  ctx.fillStyle = "rgba(10, 14, 13, 0.24)";
  ctx.beginPath();
  ctx.ellipse(
    BASE_SPRITE.x + BASE_SPRITE.size * 0.5,
    BASE_SPRITE.y + BASE_SPRITE.size * 0.78,
    BASE_SPRITE.size * 0.39,
    BASE_SPRITE.size * 0.1,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  if (baseImage.complete && baseImage.naturalWidth) {
    ctx.filter = "saturate(0.88) contrast(0.94)";
    ctx.drawImage(baseImage, BASE_SPRITE.x, BASE_SPRITE.y, BASE_SPRITE.size, BASE_SPRITE.size);
    ctx.filter = "none";
  } else {
    ctx.fillStyle = "#ec675d";
    ctx.fillRect(BASE_RECT.x, BASE_RECT.y, BASE_RECT.w, BASE_RECT.h);
    ctx.fillStyle = "#f5e8d1";
    ctx.fillRect(BASE_RECT.x + 10, BASE_RECT.y + 16, 14, BASE_RECT.h - 32);
    ctx.fillStyle = "#b9413d";
    ctx.fillRect(BASE_RECT.x + 18, BASE_RECT.y + 28, BASE_RECT.w - 26, BASE_RECT.h - 56);
    ctx.fillStyle = "#8d2e2b";
    ctx.fillRect(BASE_RECT.x + 44, BASE_RECT.y + 42, 18, 44);
  }
  ctx.fillStyle = "rgba(237, 243, 247, 0.82)";
  ctx.font = "700 14px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("BASE", BASE_SPRITE.x + BASE_SPRITE.size / 2, BASE_SPRITE.y - 10);
  ctx.restore();
}

function drawBackgroundObstaclesOverRoad() {
  const generatedBg = stageBackgroundImage(state.currentLevel.id);
  const volcanoes = (state.currentLevel.features || []).filter((feature) => feature.kind === "volcano");
  if (!generatedBg || !volcanoes.length) return;

  ctx.save();
  ctx.beginPath();
  volcanoes.forEach((feature) => {
    traceVolcanoBodyPath(feature);
  });
  ctx.clip();
  drawStageBackgroundImage(generatedBg);
  ctx.restore();
}

function drawForegroundFeaturesOverRoad() {
  if (biomeForStage(state.currentLevel.id).key !== "volcanic") return;
  const generatedBg = stageBackgroundImage(state.currentLevel.id);
  (state.currentLevel.features || []).forEach((feature) => {
    if (feature.kind !== "volcano") return;
    if (generatedBg) drawGeneratedVolcanoFx(feature);
    else drawVolcanoFeature(feature);
  });
}

function drawMeadowExtras(seed) {
  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = "#2f5522";
  ctx.beginPath();
  ctx.moveTo(0, 92);
  ctx.quadraticCurveTo(canvas.width * 0.22, 18, canvas.width * 0.46, 78);
  ctx.quadraticCurveTo(canvas.width * 0.7, 10, canvas.width, 86);
  ctx.lineTo(canvas.width, 0);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  const petals = ["#e8e26b", "#d97fae", "#e6ecf2", "#e2924f"];
  for (let i = 0; i < 46; i += 1) {
    const x = terrainRand(i + seed, 1013) * canvas.width;
    const y = 40 + terrainRand(i + seed, 1117) * (canvas.height - 60);
    const r = 1.6 + terrainRand(i + seed, 1219) * 1.8;
    ctx.fillStyle = petals[i % petals.length];
    ctx.globalAlpha = 0.85;
    for (let p = 0; p < 4; p += 1) {
      const a = (p / 4) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#f4d23c";
    ctx.beginPath();
    ctx.arc(x, y, r * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function isCodeNoteVisible() {
  return state.currentLevel?.id === CODE_NOTE_STAGE;
}

function isPointOnCodeNote(x, y) {
  if (!isCodeNoteVisible()) return false;
  const hitPad = 8;
  return (
    x >= CODE_NOTE.x - CODE_NOTE.w / 2 - hitPad &&
    x <= CODE_NOTE.x + CODE_NOTE.w / 2 + hitPad &&
    y >= CODE_NOTE.y - CODE_NOTE.h / 2 - hitPad &&
    y <= CODE_NOTE.y + CODE_NOTE.h / 2 + hitPad
  );
}

function drawCodeNote() {
  if (!isCodeNoteVisible()) return;
  ctx.save();
  ctx.translate(CODE_NOTE.x, CODE_NOTE.y);
  ctx.rotate(-0.13);
  ctx.shadowColor = "#0008";
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = "#f4e5b7";
  ctx.strokeStyle = "#8b6a3c";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(-CODE_NOTE.w / 2, -CODE_NOTE.h / 2, CODE_NOTE.w, CODE_NOTE.h, 2);
  ctx.fill();
  ctx.stroke();
  ctx.shadowColor = "transparent";
  ctx.fillStyle = "#d2b46f";
  ctx.beginPath();
  ctx.moveTo(CODE_NOTE.w / 2 - 5, -CODE_NOTE.h / 2);
  ctx.lineTo(CODE_NOTE.w / 2, -CODE_NOTE.h / 2);
  ctx.lineTo(CODE_NOTE.w / 2, -CODE_NOTE.h / 2 + 5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#5d4228";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(-5, -2.5);
  ctx.quadraticCurveTo(0, -4, 5, -2.5);
  ctx.moveTo(-5, 2);
  ctx.quadraticCurveTo(0, 0.5, 4.5, 2);
  ctx.stroke();
  ctx.restore();
}

function drawDesertExtras(seed) {
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "#7d5631";
  for (let i = 0; i < 3; i += 1) {
    const cx = canvas.width * (0.14 + i * 0.34 + terrainRand(i + seed, 1301) * 0.1);
    const w = 120 + terrainRand(i + seed, 1409) * 120;
    const h = 46 + terrainRand(i + seed, 1511) * 30;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, 78);
    ctx.lineTo(cx - w * 0.3, 78 - h);
    ctx.lineTo(cx + w * 0.26, 78 - h);
    ctx.lineTo(cx + w / 2, 78);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  for (let i = 0; i < 9; i += 1) {
    const x = terrainRand(i + seed, 1601) * canvas.width * 0.8;
    const y = 90 + terrainRand(i + seed, 1707) * (canvas.height - 130);
    const len = 110 + terrainRand(i + seed, 1811) * 190;
    const arc = 14 + terrainRand(i + seed, 1913) * 22;
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = "#eed3a0";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + len * 0.5, y - arc, x + len, y + arc * 0.4);
    ctx.stroke();
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = "#8a6236";
    ctx.beginPath();
    ctx.moveTo(x + 3, y + 4);
    ctx.quadraticCurveTo(x + len * 0.5, y - arc + 4, x + len - 4, y + arc * 0.4 + 4);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawSwampExtras(seed) {
  (state.currentLevel.features || []).forEach((f, i) => {
    if (f.kind !== "pond") return;
    const { x, y, rx, ry } = f;
    ctx.fillStyle = "#20362f";
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#5d7a52";
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#4e7a6a";
    ctx.beginPath();
    ctx.ellipse(x - rx * 0.25, y - ry * 0.3, rx * 0.4, ry * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    for (let p = 0; p < 3; p += 1) {
      const px = x + (terrainRand(i * 9 + p + seed, 2517) - 0.5) * rx * 1.3;
      const py = y + (terrainRand(i * 9 + p + seed, 2621) - 0.5) * ry * 1.2;
      const pr = 4.5 + terrainRand(i * 9 + p + seed, 2713) * 4;
      ctx.fillStyle = "#5f8a43";
      ctx.beginPath();
      ctx.arc(px, py, pr, 0.35, Math.PI * 2);
      ctx.lineTo(px, py);
      ctx.closePath();
      ctx.fill();
    }
  });
  const fog = ctx.createLinearGradient(0, 0, 0, 130);
  fog.addColorStop(0, "#c9d6c2");
  fog.addColorStop(1, "#c9d6c200");
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = fog;
  ctx.fillRect(0, 0, canvas.width, 130);
  ctx.globalAlpha = 1;
}

function drawTundraExtras(seed) {
  ctx.save();
  ctx.globalAlpha = 0.32;
  ctx.fillStyle = "#7d93a6";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 70);
  for (let i = 1; i <= 10; i += 1) {
    const x = (canvas.width / 10) * i;
    ctx.lineTo(x - canvas.width / 20, 90 - terrainRand(i + seed, 3103) * 70);
    ctx.lineTo(x, 78 - terrainRand(i + seed, 3209) * 30);
  }
  ctx.lineTo(canvas.width, 0);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = "#a9bdcc";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 46);
  for (let i = 1; i <= 7; i += 1) {
    const x = (canvas.width / 7) * i;
    ctx.lineTo(x - canvas.width / 14, 62 - terrainRand(i + seed, 3313) * 50);
    ctx.lineTo(x, 50 - terrainRand(i + seed, 3417) * 24);
  }
  ctx.lineTo(canvas.width, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  for (let i = 0; i < 12; i += 1) {
    const x = terrainRand(i + seed, 3301) * canvas.width;
    const y = 110 + terrainRand(i + seed, 3407) * (canvas.height - 150);
    const rx = 26 + terrainRand(i + seed, 3511) * 44;
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(x, y, rx, rx * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#9fb4c4";
    ctx.beginPath();
    ctx.ellipse(x + rx * 0.18, y + rx * 0.12, rx * 0.8, rx * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  (state.currentLevel.features || []).forEach((f) => {
    if (f.kind === "snowSink") {
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "#f4f9fc";
      ctx.beginPath();
      ctx.ellipse(f.x, f.y - 3, f.rx * 1.1, f.ry * 1.12, 0, 0, Math.PI * 2);
      ctx.fill();
      const bowl = ctx.createRadialGradient(f.x, f.y + f.ry * 0.2, 2, f.x, f.y, f.rx);
      bowl.addColorStop(0, "#7f97a8");
      bowl.addColorStop(0.6, "#a5bac8");
      bowl.addColorStop(1, "#cfdde7");
      ctx.fillStyle = bowl;
      ctx.beginPath();
      ctx.ellipse(f.x, f.y, f.rx, f.ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#5f7181";
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(f.x, f.y + 1, f.rx * 0.7, f.ry * 0.66, 0, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(f.x, f.y - 2, f.rx * 0.82, f.ry * 0.76, 0, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (f.kind === "icePond") {
      const { x: px, y: py } = f;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "#b7dcea";
      ctx.beginPath();
      ctx.ellipse(px, py, f.rx, f.ry, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#e8f4f9";
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(px - 30, py - 8);
      ctx.lineTo(px + 2, py + 4);
      ctx.lineTo(px + 26, py - 6);
      ctx.moveTo(px - 8, py + 14);
      ctx.lineTo(px + 2, py + 4);
      ctx.stroke();
    }
  });
  ctx.globalAlpha = 1;
}

function drawVolcanicExtras(seed) {
  const features = state.currentLevel.features || [];
  for (let i = 0; i < 8; i += 1) {
    const x = terrainRand(i + seed, 4201) * canvas.width;
    const y = 90 + terrainRand(i + seed, 4307) * (canvas.height - 130);
    if (distanceToPathList(x, y, state.currentLevel.paths) < 60) continue;
    if (pointNearAnyVolcanoFeature(x, y, features, 18)) continue;
    ctx.strokeStyle = "#ff5a1f";
    ctx.lineWidth = 6;
    ctx.globalAlpha = 0.16;
    strokeLavaCrack(x, y, i + seed);
    ctx.strokeStyle = "#ffa03c";
    ctx.lineWidth = 2.2;
    ctx.globalAlpha = 0.85;
    strokeLavaCrack(x, y, i + seed);
  }

  for (let i = 0; i < 26; i += 1) {
    ctx.globalAlpha = 0.5 + terrainRand(i + seed, 4703) * 0.4;
    ctx.fillStyle = i % 3 ? "#ff8a3c" : "#ffc46b";
    const x = terrainRand(i + seed, 4801) * canvas.width;
    const y = terrainRand(i + seed, 4907) * canvas.height;
    if (pointNearAnyVolcanoFeature(x, y, features, 8)) continue;
    ctx.beginPath();
    ctx.arc(x, y, 1.2 + terrainRand(i + seed, 4507) * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  (state.currentLevel.features || []).forEach((f) => {
    if (f.kind === "volcano") drawVolcanoFeature(f);
  });
}

function drawNaturalScatter(biome, seed) {
  const features = state.currentLevel.features || [];
  for (let i = 0; i < 70; i += 1) {
    const x = 28 + terrainRand(i + seed, 5101) * (canvas.width - 56);
    const y = 34 + terrainRand(i + seed, 5209) * (canvas.height - 60);
    if (distanceToPathList(x, y, state.currentLevel.paths) < 48) continue;
    if (x > BASE_RECT.x - 130 && y > BASE_RECT.y - 110 && y < BASE_RECT.y + BASE_RECT.h + 120) continue;
    if (pointNearAnyVolcanoFeature(x, y, features, 10)) continue;
    const size = 4 + terrainRand(i + seed, 5311) * 10;
    const tone = terrainRand(i + seed, 5417);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((tone - 0.5) * 1.6);
    if (biome.key === "meadow") drawGroundTuft(size, tone, ["#264d1f", "#386d2a", "#79a94f"], i % 5 === 0);
    else if (biome.key === "desert") drawPebbleCluster(size, tone, ["#8a6236", "#c79c5d", "#6f4e30"]);
    else if (biome.key === "swamp") drawGroundTuft(size * 1.08, tone, ["#263d26", "#4e6d36", "#6f8751"], i % 4 === 0);
    else if (biome.key === "tundra") drawSnowScatter(size, tone);
    else drawPebbleCluster(size, tone, ["#241f21", "#5b4a46", "#ff8a3c"]);
    ctx.restore();
  }
}

function drawGroundTuft(size, tone, colors, flower) {
  ctx.globalAlpha = 0.62;
  ctx.strokeStyle = colors[Math.floor(tone * colors.length) % colors.length];
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  for (let b = -2; b <= 2; b += 1) {
    const h = size * (0.75 + terrainRand(Math.abs(b) + Math.floor(tone * 100), 5521) * 0.55);
    ctx.beginPath();
    ctx.moveTo(b * 2, 5);
    ctx.quadraticCurveTo(b * 2.4, 2 - h * 0.45, b * 3.1, -h);
    ctx.stroke();
  }
  if (flower) {
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = tone > 0.5 ? "#f4d23c" : "#e6ecf2";
    ctx.beginPath();
    ctx.arc(0, -size * 0.78, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawPebbleCluster(size, tone, colors) {
  for (let p = 0; p < 3; p += 1) {
    ctx.globalAlpha = 0.45 + p * 0.12;
    ctx.fillStyle = colors[(p + Math.floor(tone * 10)) % colors.length];
    const px = (p - 1) * size * 0.42;
    const py = (terrainRand(p + Math.floor(tone * 90), 5639) - 0.5) * size * 0.52;
    ctx.beginPath();
    ctx.ellipse(px, py, size * (0.28 + p * 0.08), size * (0.16 + p * 0.05), tone * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawSnowScatter(size, tone) {
  ctx.globalAlpha = 0.52;
  ctx.fillStyle = tone > 0.5 ? "#f5fafc" : "#c4d3de";
  ctx.beginPath();
  ctx.ellipse(0, 0, size * 0.9, size * 0.28, tone * Math.PI, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.48;
  ctx.strokeStyle = "#e8f1f7";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-size * 0.45, -size * 0.1);
  ctx.lineTo(size * 0.48, size * 0.08);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function traceVolcanoBodyPath(f) {
  const { x, y, rx, ry } = f;
  const coneH = f.coneH || ry * 1.4;
  const craterY = y - coneH;
  const craterRx = rx * 0.33;
  const craterRy = craterRx * 0.42;
  ctx.moveTo(x - rx, y);
  ctx.quadraticCurveTo(x - rx * 0.52, craterY + coneH * 0.32, x - craterRx, craterY);
  ctx.ellipse(x, craterY, craterRx, craterRy, 0, Math.PI, Math.PI * 2, false);
  ctx.quadraticCurveTo(x + rx * 0.52, craterY + coneH * 0.32, x + rx, y);
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI, false);
  ctx.closePath();
}

function clipOutsideVolcanoBody() {
  const volcano = (state.currentLevel?.features || []).find((f) => f.kind === "volcano");
  if (!volcano) return false;
  ctx.beginPath();
  ctx.rect(-4, -4, canvas.width + 8, canvas.height + 8);
  traceVolcanoBodyPath(volcano);
  ctx.clip("evenodd");
  return true;
}

function drawVolcanoFeature(f) {
  const { x, y, rx, ry } = f;
  const coneH = f.coneH || ry * 1.4;
  const craterY = y - coneH;
  const craterRx = rx * 0.33;
  const craterRy = craterRx * 0.42;
  const seed = state.currentLevel.id * 97;
  const flash = state.volcanoFx ? state.volcanoFx.flash : 0;

  ctx.globalAlpha = 0.3;
  ctx.fillStyle = "#120d0c";
  ctx.beginPath();
  ctx.ellipse(x + rx * 0.22, y + ry * 0.3, rx * 1.05, ry * 0.8, 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  const skirt = ctx.createRadialGradient(x, y, rx * 0.3, x, y, rx * 1.35);
  skirt.addColorStop(0, "#3a2e2c55");
  skirt.addColorStop(1, "#2a232200");
  ctx.fillStyle = skirt;
  ctx.beginPath();
  ctx.ellipse(x, y, rx * 1.35, ry * 1.5, 0, 0, Math.PI * 2);
  ctx.fill();

  const bodyPath = () => {
    ctx.beginPath();
    traceVolcanoBodyPath(f);
  };

  const grade = ctx.createLinearGradient(0, craterY - craterRy, 0, y + ry);
  grade.addColorStop(0, "#6a5850");
  grade.addColorStop(0.4, "#57453f");
  grade.addColorStop(0.8, "#43342f");
  grade.addColorStop(1, "#332826");
  ctx.fillStyle = grade;
  bodyPath();
  ctx.fill();

  const light = ctx.createLinearGradient(x - rx, 0, x + rx, 0);
  light.addColorStop(0, "#a8907f3d");
  light.addColorStop(0.45, "#a8907f00");
  light.addColorStop(0.75, "#00000000");
  light.addColorStop(1, "#00000055");
  ctx.fillStyle = light;
  bodyPath();
  ctx.fill();

  ctx.save();
  bodyPath();
  ctx.clip();
  ctx.lineCap = "round";
  for (let i = 0; i < 12; i += 1) {
    const t = i / 11;
    const u = t * 2 - 1;
    const topX = x + u * craterRx * 0.96;
    const topY = craterY + craterRy * Math.sqrt(Math.max(0, 1 - u * u));
    const spreadJ = (terrainRand(i + seed, 8101) - 0.5) * 0.3;
    const uBot = Math.max(-1, Math.min(1, u + spreadJ));
    const botX = x + uBot * rx * 0.94;
    const botY = y + ry * 0.55 * Math.sqrt(Math.max(0, 1 - uBot * uBot));
    const midX = (topX + botX) / 2 + (terrainRand(i + seed, 8207) - 0.5) * rx * 0.14;
    const midY = (topY + botY) / 2 + terrainRand(i + seed, 8311) * coneH * 0.08;
    ctx.strokeStyle = "#1c1512";
    ctx.globalAlpha = 0.4 + terrainRand(i + seed, 8407) * 0.25;
    ctx.lineWidth = 1.6 + terrainRand(i + seed, 8503) * 2.6;
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.quadraticCurveTo(midX, midY, botX, botY);
    ctx.stroke();
    ctx.strokeStyle = "#8a766a";
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(topX + 2.4, topY + 1);
    ctx.quadraticCurveTo(midX + 2.4, midY + 1, botX + 2.4, botY + 1);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  for (let i = 0; i < 7; i += 1) {
    const u = terrainRand(i + seed, 8601) * 1.7 - 0.85;
    const v = 0.25 + terrainRand(i + seed, 8707) * 0.6;
    const dx = x + u * (craterRx + (rx - craterRx) * v);
    const dy = craterY + coneH * v;
    const dr = rx * (0.06 + terrainRand(i + seed, 8811) * 0.09);
    const dent = ctx.createRadialGradient(dx, dy, 1, dx, dy, dr);
    dent.addColorStop(0, "#241b18bb");
    dent.addColorStop(1, "#241b1800");
    ctx.fillStyle = dent;
    ctx.beginPath();
    ctx.ellipse(dx, dy, dr, dr * 0.62, u * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#8a766a";
    ctx.globalAlpha = 0.2;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(dx, dy - dr * 0.32, dr * 0.7, dr * 0.3, u * 0.4, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  for (let i = 0; i < 3; i += 1) {
    const u = -0.5 + i * 0.5 + (terrainRand(i + seed, 9001) - 0.5) * 0.25;
    const topX = x + u * craterRx * 0.9;
    const topY = craterY + craterRy * Math.sqrt(Math.max(0, 1 - u * u));
    const reach = 0.45 + terrainRand(i + seed, 9107) * 0.4;
    const botX = x + u * rx * (0.5 + reach * 0.5);
    const botY = craterY + coneH * reach + ry * 0.2;
    const midX = (topX + botX) / 2 + (terrainRand(i + seed, 9203) - 0.5) * rx * 0.1;
    const midY = (topY + botY) / 2;
    ctx.strokeStyle = "#ff5a1f";
    ctx.globalAlpha = 0.22 + flash * 0.25;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.quadraticCurveTo(midX, midY, botX, botY);
    ctx.stroke();
    ctx.strokeStyle = "#ffa03c";
    ctx.globalAlpha = 0.75 + flash * 0.2;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.quadraticCurveTo(midX, midY, botX, botY);
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  for (let i = 0; i < 10; i += 1) {
    const a = Math.PI * (0.08 + terrainRand(i + seed, 7301) * 0.84);
    const bx = x + Math.cos(a) * rx * (1 + terrainRand(i + seed, 7407) * 0.16);
    const by = y + Math.sin(a) * ry * (0.85 + terrainRand(i + seed, 7511) * 0.4);
    const br = 3 + terrainRand(i + seed, 7603) * 5;
    ctx.fillStyle = i % 2 ? "#3c302e" : "#2b2322";
    ctx.beginPath();
    ctx.ellipse(bx, by, br, br * 0.66, a, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#191212";
  ctx.beginPath();
  ctx.ellipse(x, craterY, craterRx, craterRy, 0, 0, Math.PI * 2);
  ctx.fill();
  const lava = ctx.createRadialGradient(x, craterY + craterRy * 0.1, 2, x, craterY + craterRy * 0.1, craterRx * 0.8);
  lava.addColorStop(0, "#ffe27a");
  lava.addColorStop(0.45, "#ff9d3c");
  lava.addColorStop(0.8, "#f4511e");
  lava.addColorStop(1, "#8f1d12");
  ctx.fillStyle = lava;
  ctx.beginPath();
  ctx.ellipse(x, craterY + craterRy * 0.12, craterRx * 0.78, craterRy * 0.68, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#7d6a5e";
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.ellipse(x, craterY, craterRx, craterRy, 0, Math.PI * 0.06, Math.PI * 0.94);
  ctx.stroke();
  ctx.strokeStyle = "#141010";
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(x, craterY, craterRx, craterRy, 0, Math.PI * 1.06, Math.PI * 1.94);
  ctx.stroke();
  ctx.globalAlpha = 1;

  const pulse = 0.55 + Math.sin(performance.now() / 600) * 0.2 + flash;
  const glow = ctx.createRadialGradient(x, craterY, 2, x, craterY, craterRx * 2.4);
  glow.addColorStop(0, `rgba(255, 122, 40, ${Math.min(0.65, 0.26 * pulse + flash * 0.35)})`);
  glow.addColorStop(1, "rgba(255, 122, 40, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.ellipse(x, craterY, craterRx * 2.4, craterRy * 3.4, 0, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < 3; i += 1) {
    ctx.globalAlpha = 0.22 - i * 0.055 + flash * 0.12;
    ctx.fillStyle = "#8d8489";
    const drift = Math.sin(performance.now() / 900 + i * 2.1) * (6 + i * 4);
    ctx.beginPath();
    ctx.arc(x + drift, craterY - craterRy - coneH * (0.12 + i * 0.16), craterRx * (0.34 + i * 0.16), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawGeneratedVolcanoFx(f) {
  const { x, y, rx, ry } = f;
  const coneH = f.coneH || ry * 1.4;
  const craterY = y - coneH;
  const craterRx = rx * 0.28;
  const craterRy = craterRx * 0.38;
  const flash = state.volcanoFx ? state.volcanoFx.flash : 0;
  const pulse = 0.55 + Math.sin(performance.now() / 620) * 0.18 + flash * 0.75;

  ctx.save();
  const glow = ctx.createRadialGradient(x, craterY, 2, x, craterY, craterRx * 2.15);
  glow.addColorStop(0, `rgba(255, 169, 70, ${Math.min(0.62, 0.25 + pulse * 0.22)})`);
  glow.addColorStop(0.45, `rgba(255, 96, 30, ${Math.min(0.32, 0.12 + pulse * 0.12)})`);
  glow.addColorStop(1, "rgba(255, 96, 30, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.ellipse(x, craterY, craterRx * 2.1, craterRy * 2.7, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.32 + flash * 0.28;
  ctx.fillStyle = "#ffe08a";
  ctx.beginPath();
  ctx.ellipse(x, craterY + craterRy * 0.12, craterRx * 0.75, craterRy * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < 3; i += 1) {
    const drift = Math.sin(performance.now() / 980 + i * 1.9) * (5 + i * 3);
    ctx.globalAlpha = 0.16 - i * 0.028 + flash * 0.08;
    ctx.fillStyle = "#9a9291";
    ctx.beginPath();
    ctx.arc(x + drift, craterY - craterRy - coneH * (0.1 + i * 0.13), craterRx * (0.36 + i * 0.17), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function updateVolcanoFx(dt) {
  const fx = state.volcanoFx;
  if (!fx) return;
  fx.flash = Math.max(0, fx.flash - dt * 0.8);
  const volcano = (state.currentLevel?.features || []).find((f) => f.kind === "volcano");
  if (volcano) {
    fx.timer -= dt;
    if (fx.timer <= 0) {
      fx.timer = 52 + Math.random() * 16;
      fx.flash = 1;
      const count = 6 + Math.floor(Math.random() * 4);
      for (let i = 0; i < count; i += 1) {
        const a = Math.random() * Math.PI * 2;
        const dist = volcano.rx * 0.85 + Math.random() * 160;
        fx.blobs.push({
          sx: volcano.x,
          sy: volcano.y - (volcano.coneH || volcano.ry) - 6,
          tx: Math.min(canvas.width - 20, Math.max(20, volcano.x + Math.cos(a) * dist)),
          ty: Math.min(canvas.height - 20, Math.max(20, volcano.y + Math.sin(a) * dist * 0.78)),
          t: 0,
          dur: 0.8 + Math.random() * 0.7,
          arc: 70 + Math.random() * 90,
          size: 4 + Math.random() * 5,
        });
      }
    }
  }
  fx.blobs = fx.blobs.filter((b) => {
    b.t += dt;
    if (b.t >= b.dur) {
      fx.pools.push({ x: b.tx, y: b.ty, r: b.size * 2.2 + Math.random() * 6, life: 12, max: 12 });
      return false;
    }
    return true;
  });
  fx.pools = fx.pools.filter((p) => {
    p.life -= dt;
    return p.life > 0;
  });
}

function drawLavaPools() {
  const fx = state.volcanoFx;
  if (!fx || !fx.pools.length) return;
  ctx.save();
  clipOutsideVolcanoBody();
  fx.pools.forEach((p) => {
    const k = Math.max(0, p.life / p.max);
    ctx.globalAlpha = Math.min(1, k * 4) * 0.85;
    ctx.fillStyle = "#3a231d";
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, p.r * 1.15, p.r * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
    const g = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, p.r);
    g.addColorStop(0, `rgba(255, 224, 110, ${0.95 * k})`);
    g.addColorStop(0.55, `rgba(255, 138, 44, ${0.8 * k})`);
    g.addColorStop(1, `rgba(183, 40, 18, ${0.35 * k})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, p.r, p.r * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  });
  ctx.restore();
}

function drawLavaBlobs() {
  const fx = state.volcanoFx;
  if (!fx || !fx.blobs.length) return;
  ctx.save();
  clipOutsideVolcanoBody();
  fx.blobs.forEach((b) => {
    const k = b.t / b.dur;
    const gx = b.sx + (b.tx - b.sx) * k;
    const gy = b.sy + (b.ty - b.sy) * k;
    const y = gy - Math.sin(Math.PI * k) * b.arc;
    ctx.globalAlpha = 0.25 * k;
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.ellipse(gx, gy, b.size * 0.9, b.size * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#ff8a3c";
    ctx.beginPath();
    ctx.arc(gx - (b.tx - b.sx) * 0.03, y + 5, b.size * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    const g = ctx.createRadialGradient(gx, y, 1, gx, y, b.size);
    g.addColorStop(0, "#ffe27a");
    g.addColorStop(0.6, "#ff8a3c");
    g.addColorStop(1, "#e64a19");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(gx, y, b.size, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

function strokeLavaCrack(x, y, seed) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  let cx = x;
  let cy = y;
  for (let s = 0; s < 5; s += 1) {
    cx += 14 + terrainRand(seed * 7 + s, 4401) * 26;
    cy += (terrainRand(seed * 7 + s, 4503) - 0.5) * 34;
    ctx.lineTo(cx, cy);
  }
  ctx.stroke();
}

function pointNearVolcanoFeature(x, y, feature, padding = 0) {
  if (feature.kind !== "volcano") return false;
  const coneH = feature.coneH || feature.ry * 1.4;
  const topY = feature.y - coneH;
  const dx = Math.abs(x - feature.x);
  const dyBase = (y - feature.y) / (feature.ry + padding);
  if ((dx / (feature.rx + padding)) ** 2 + dyBase ** 2 <= 1) return true;
  const t = (y - topY) / coneH;
  if (t < 0 || t > 1.08) return false;
  const halfWidth = feature.rx * 0.33 + feature.rx * 0.67 * t + padding;
  return dx <= halfWidth;
}

function pointNearAnyVolcanoFeature(x, y, features, padding = 0) {
  return (features || []).some((feature) => pointNearVolcanoFeature(x, y, feature, padding));
}

const STAGE_BACKGROUND_BLOCKERS = {
  1: [
    [85, 50, 76, 64], [130, 92, 70, 58], [820, 78, 62, 50], [72, 236, 80, 58],
    [854, 324, 54, 46], [68, 592, 88, 66], [352, 596, 62, 48], [842, 560, 86, 64],
    [943, 525, 58, 46], [430, 332, 28, 24],
  ],
  2: [
    [45, 60, 92, 64], [830, 58, 78, 58], [58, 370, 84, 56], [892, 390, 72, 52],
    [120, 560, 88, 58], [748, 574, 86, 62], [940, 526, 48, 42], [362, 246, 58, 42],
    [245, 392, 54, 38], [626, 310, 42, 34],
  ],
  3: [
    [72, 76, 120, 76], [210, 64, 86, 56], [58, 225, 110, 70], [894, 86, 84, 58],
    [875, 230, 78, 56], [92, 490, 104, 70], [260, 575, 96, 58], [780, 548, 100, 66],
    [497, 310, 48, 42], [377, 210, 58, 42], [602, 380, 62, 44],
  ],
  4: [
    [72, 68, 94, 58], [930, 62, 82, 52], [56, 300, 68, 50], [930, 318, 70, 54],
    [92, 560, 86, 60], [888, 560, 112, 68], [205, 116, 44, 34], [650, 105, 48, 36],
    [520, 445, 34, 28],
  ],
  5: [
    [95, 56, 142, 72], [896, 78, 126, 74], [80, 302, 82, 60], [908, 312, 102, 68],
    [92, 590, 128, 72], [878, 565, 132, 72], [302, 120, 54, 38], [638, 126, 46, 34],
    [656, 405, 48, 36],
  ],
  6: [
    [128, 122, 88, 66], [318, 92, 92, 62], [804, 96, 118, 76], [98, 430, 92, 58],
    [816, 438, 112, 72], [292, 548, 86, 60], [602, 292, 52, 38], [390, 365, 60, 42],
    [676, 566, 74, 48],
  ],
  7: [
    [70, 74, 102, 76], [885, 76, 96, 72], [74, 398, 86, 64], [900, 392, 100, 70],
    [135, 565, 86, 58], [792, 568, 100, 64], [330, 130, 52, 42], [530, 214, 44, 36],
    [650, 438, 58, 42],
  ],
  8: [
    [78, 78, 104, 74], [850, 82, 110, 74], [90, 404, 96, 70], [884, 440, 120, 84],
    [126, 560, 92, 62], [800, 570, 118, 70], [310, 150, 58, 42], [646, 152, 48, 38],
    [548, 470, 44, 34],
  ],
  9: [
    [92, 95, 88, 72], [820, 92, 130, 84], [110, 495, 124, 86], [850, 490, 120, 78],
    [458, 146, 78, 56], [476, 355, 60, 46], [334, 430, 58, 42], [686, 330, 54, 44],
    [280, 228, 46, 38],
  ],
  10: [
    [62, 78, 90, 66], [332, 82, 90, 62], [786, 70, 90, 62], [62, 545, 104, 70],
    [300, 558, 86, 58], [862, 536, 108, 72], [640, 148, 54, 42], [720, 320, 48, 36],
    [452, 390, 42, 34],
  ],
  11: [
    [70, 82, 120, 80], [292, 92, 86, 62], [856, 80, 116, 78], [82, 390, 100, 72],
    [900, 385, 112, 78], [82, 568, 104, 68], [496, 565, 80, 58], [756, 560, 100, 66],
    [590, 160, 64, 46], [350, 338, 54, 42],
  ],
  12: [
    [78, 96, 120, 84], [338, 88, 110, 76], [735, 92, 130, 86], [80, 412, 112, 80],
    [886, 408, 130, 86], [92, 564, 110, 72], [520, 570, 94, 62], [826, 560, 122, 76],
    [492, 210, 60, 46], [620, 382, 54, 42],
  ],
  13: [
    [60, 64, 110, 70], [920, 70, 92, 64], [68, 544, 120, 74], [888, 552, 118, 78],
    [196, 156, 54, 48], [210, 382, 58, 48], [392, 460, 42, 36], [670, 400, 52, 42],
    [760, 160, 60, 46],
  ],
  14: [
    [58, 70, 120, 78], [904, 76, 118, 76], [72, 554, 124, 78], [895, 548, 118, 76],
    [184, 176, 54, 46], [292, 346, 56, 44], [504, 498, 50, 42], [678, 140, 58, 46],
    [746, 374, 58, 48],
  ],
  15: [
    [58, 70, 128, 82], [920, 80, 118, 76], [76, 550, 138, 82], [900, 548, 130, 82],
    [226, 160, 58, 48], [324, 318, 54, 44], [506, 476, 52, 42], [688, 164, 62, 48],
    [760, 382, 58, 46],
  ],
};

function makeBackgroundBlockers(stageId) {
  return (STAGE_BACKGROUND_BLOCKERS[stageId] || []).map(([x, y, rx, ry]) => ({ x, y, rx, ry }));
}

levelData.forEach((level) => {
  level.backgroundBlockers = makeBackgroundBlockers(level.id);
});

function makeTrees(paths, stageId, features = []) {
  const biome = biomeForStage(stageId);
  const trees = [];
  const targetClusters = 6 + (stageId % 4);
  let clusters = 0;
  let nearRoadClusters = 0;

  for (let attempt = 0; attempt < 180 && clusters < targetClusters; attempt += 1) {
    const seed = stageId * 1000 + attempt;
    const x = 55 + terrainRand(seed, 11) * 790;
    const y = 55 + terrainRand(seed, 17) * 540;
    const roadDistance = distanceToPathList(x, y, paths);
    const nearRoad = roadDistance < 112;

    if (x > BASE_RECT.x - 150 && y > BASE_RECT.y - 120 && y < BASE_RECT.y + BASE_RECT.h + 120) continue;
    if (roadDistance < 48) continue;
    if (pointNearAnyVolcanoFeature(x, y, features, 38)) continue;
    if (nearRoad && nearRoadClusters >= 2) continue;
    if (trees.some((tree) => Math.hypot(tree.x - x, tree.y - y) < 72)) continue;

    const count = 3 + Math.floor(terrainRand(seed, 23) * 4);
    const spread = 24 + terrainRand(seed, 31) * 28;
    const cluster = [];

    for (let i = 0; i < count; i += 1) {
      const angle = terrainRand(seed + i, 41) * Math.PI * 2;
      const radius = (0.3 + terrainRand(seed + i, 47) * 0.9) * spread;
      const tx = x + Math.cos(angle) * radius;
      const ty = y + Math.sin(angle) * radius;
      const size = 14 + terrainRand(seed + i, 59) * 8;

      if (tx < 26 || tx > canvas.width - 26 || ty < 35 || ty > canvas.height - 20) continue;
      if (tx > BASE_RECT.x - 120 && ty > BASE_RECT.y - 110 && ty < BASE_RECT.y + BASE_RECT.h + 110) continue;
      if (distanceToPathList(tx, ty, paths) < 42) continue;
      if (pointNearAnyVolcanoFeature(tx, ty, features, size + 22)) continue;
      if (trees.some((tree) => Math.hypot(tree.x - tx, tree.y - ty) < tree.size + size + 8)) continue;
      if (cluster.some((tree) => Math.hypot(tree.x - tx, tree.y - ty) < tree.size + size - 2)) continue;

      cluster.push({
        x: tx,
        y: ty,
        size,
        lean: -0.18 + terrainRand(seed + i, 67) * 0.36,
        tone: terrainRand(seed + i, 71),
        kind: pickPropKind(biome, terrainRand(seed + i, 83)),
      });
    }

    if (cluster.length < 3) continue;
    trees.push(...cluster);
    clusters += 1;
    if (nearRoad) nearRoadClusters += 1;
  }

  if (stageId === 9) {
    const waterProps = [
      { x: 74, y: 500, size: 18, lean: -0.12, tone: 0.34, kind: "swampTree" },
      { x: 128, y: 546, size: 16, lean: 0.08, tone: 0.72, kind: "swampTree" },
      { x: 174, y: 512, size: 12, lean: 0.02, tone: 0.48, kind: "reeds" },
      { x: 716, y: 126, size: 17, lean: -0.08, tone: 0.62, kind: "swampTree" },
      { x: 792, y: 118, size: 15, lean: 0.14, tone: 0.42, kind: "swampTree" },
      { x: 745, y: 169, size: 11, lean: -0.04, tone: 0.56, kind: "reeds" },
      { x: 62, y: 250, size: 15, lean: 0.1, tone: 0.28, kind: "swampTree" },
      { x: 128, y: 228, size: 13, lean: -0.09, tone: 0.66, kind: "swampTree" },
      { x: 104, y: 284, size: 10, lean: 0.03, tone: 0.5, kind: "reeds" },
    ];
    waterProps.forEach((prop) => {
      if (prop.x > BASE_RECT.x - 120 && prop.y > BASE_RECT.y - 110 && prop.y < BASE_RECT.y + BASE_RECT.h + 110) return;
      if (distanceToPathList(prop.x, prop.y, paths) < 42) return;
      if (trees.some((tree) => Math.hypot(tree.x - prop.x, tree.y - prop.y) < tree.size + prop.size + 4)) return;
      trees.push(prop);
    });
  }

  return trees.sort((a, b) => a.y - b.y);
}

function makeFeatures(paths, stageId) {
  const biome = biomeForStage(stageId);
  const seed = stageId * 53;
  const features = [];
  const nearBase = (x, y) => x > BASE_RECT.x - 140 && y > BASE_RECT.y - 130 && y < BASE_RECT.y + BASE_RECT.h + 130;

  if (biome.key === "swamp") {
    if (stageId === 9) {
      [
        { x: 116, y: 516, rx: 62, ry: 28 },
        { x: 755, y: 140, rx: 56, ry: 25 },
        { x: 98, y: 258, rx: 48, ry: 23 },
      ].forEach((pond) => {
        if (distanceToPathList(pond.x, pond.y, paths) >= 70 && !nearBase(pond.x, pond.y)) {
          features.push({ kind: "pond", ...pond });
        }
      });
    }
    for (let i = 0; i < 5; i += 1) {
      const x = 80 + terrainRand(i + seed, 2101) * (canvas.width - 200);
      const y = 90 + terrainRand(i + seed, 2207) * (canvas.height - 160);
      if (distanceToPathList(x, y, paths) < 70 || nearBase(x, y)) continue;
      const rx = 34 + terrainRand(i + seed, 2311) * 40;
      const ry = rx * (0.4 + terrainRand(i + seed, 2413) * 0.2);
      features.push({ kind: "pond", x, y, rx, ry });
    }
  }

  if (biome.key === "tundra") {
    for (let i = 0; i < 4; i += 1) {
      const x = 90 + terrainRand(i + seed, 3801) * (canvas.width - 220);
      const y = 100 + terrainRand(i + seed, 3907) * (canvas.height - 170);
      if (distanceToPathList(x, y, paths) < 66 || nearBase(x, y)) continue;
      const rx = 30 + terrainRand(i + seed, 3511) * 34;
      features.push({ kind: "snowSink", x, y, rx, ry: rx * 0.62 });
    }
    const px = canvas.width * (0.25 + terrainRand(seed, 3601) * 0.4);
    const py = canvas.height * (0.3 + terrainRand(seed, 3707) * 0.35);
    if (distanceToPathList(px, py, paths) >= 70 && !nearBase(px, py)) {
      features.push({ kind: "icePond", x: px, y: py, rx: 56, ry: 30 });
    }
  }

  if (biome.key === "volcanic") {
    const sizes = [150, 135, 120, 105, 90, 78];
    const candidates = [];
    for (let gx = 0; gx < 12; gx += 1) {
      for (let gy = 0; gy < 8; gy += 1) {
        const x = 70 + (gx / 11) * (canvas.width - 140);
        const y = 90 + (gy / 7) * (canvas.height - 150);
        if (nearBase(x, y)) continue;
        candidates.push({ x, y, clearance: distanceToPathList(x, y, paths) });
      }
    }
    let placed = null;
    if (stageId === 13) {
      placed = makeVolcanoFeature(260, 396, 105);
    } else if (stageId === 14) {
      placed = makeVolcanoFeature(746, 223, 105);
    } else if (stageId === 15) {
      placed = makeVolcanoFeature(260, 584, 92);
    } else {
      candidates.sort((a, b) => b.clearance - a.clearance);
      for (const r of sizes) {
        for (const cand of candidates) {
          if (volcanoFits(cand.x, cand.y, r, paths)) {
            placed = makeVolcanoFeature(cand.x, cand.y, r);
            break;
          }
        }
        if (placed) break;
      }
    }
    if (!placed && candidates.length) {
      const open = candidates.reduce((a, b) => (a.clearance > b.clearance ? a : b));
      placed = makeVolcanoFeature(open.x, open.y, Math.max(56, Math.min(78, open.clearance - 36)));
    }
    if (placed) features.push(placed);
  }

  return features;
}

function volcanoFits(x, y, r, paths) {
  const coneH = r * 1.05;
  const rx = r;
  const ry = r * 0.5;
  const craterRx = rx * 0.33;
  const craterRy = craterRx * 0.42;
  if (x - rx < 14 || x + rx > canvas.width - 14) return false;
  if (y + ry > canvas.height - 14 || y - coneH - craterRy < 8) return false;
  const pts = [];
  for (let i = 0; i <= 8; i += 1) {
    const a = (i / 8) * Math.PI;
    pts.push([x + Math.cos(a) * rx, y + Math.sin(a) * ry]);
  }
  for (let i = 1; i < 6; i += 1) {
    const t = i / 6;
    const fx = rx + (craterRx - rx) * t;
    pts.push([x - fx, y - coneH * t], [x + fx, y - coneH * t]);
  }
  for (let i = 0; i <= 6; i += 1) {
    const a = Math.PI + (i / 6) * Math.PI;
    pts.push([x + Math.cos(a) * craterRx, y - coneH + Math.sin(a) * craterRy]);
  }
  return pts.every(([px, py]) => distanceToPathList(px, py, paths) >= 31);
}

function makeVolcanoFeature(x, y, r) {
  const coneH = r * 1.05;
  const rx = r;
  const ry = r * 0.5;
  const cx = Math.min(canvas.width - rx - 24, Math.max(rx + 24, x));
  const cy = Math.min(canvas.height - ry - 20, Math.max(coneH + ry * 0.6 + 40, y));
  return {
    kind: "volcano",
    x: cx,
    y: cy,
    rx,
    ry,
    coneH,
    by: cy - coneH * 0.45,
    brx: rx,
    bry: ry + coneH * 0.5,
  };
}

function terrainRand(index, salt) {
  return Math.abs(Math.sin(index * 127.1 + salt * 311.7) * 43758.5453) % 1;
}

function drawTrees() {
  const biome = biomeForStage(state.currentLevel.id);
  state.currentLevel.trees.forEach((prop) => {
    const rigid = prop.kind === "rock" || prop.kind === "iceRock" || prop.kind === "lavaRock" || prop.kind === "vent";
    ctx.save();
    ctx.translate(prop.x, prop.y);
    ctx.rotate(rigid ? 0 : prop.lean);

    ctx.fillStyle = "#1a120d66";
    ctx.beginPath();
    ctx.ellipse(2, 15, prop.size * 0.9, prop.size * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();

    switch (prop.kind) {
      case "bush": drawBushProp(prop); break;
      case "rock": drawRockProp(prop, biome.rock); break;
      case "cactus": drawCactusProp(prop); break;
      case "shrub": drawShrubProp(prop); break;
      case "swampTree": drawSwampTreeProp(prop); break;
      case "reeds": drawReedsProp(prop); break;
      case "pine": drawPineProp(prop); break;
      case "iceRock": drawRockProp(prop, { base: "#aebfca", dark: "#8698a6", light: "#e2edf3" }); break;
      case "deadTree": drawDeadTreeProp(prop); break;
      case "lavaRock": drawLavaRockProp(prop, biome.rock); break;
      case "vent": drawVentProp(prop); break;
      default: drawLeafTreeProp(prop);
    }
    ctx.restore();
  });
}

function drawLeafTreeProp(tree) {
  const trunkWidth = Math.max(7, tree.size * 0.34);
  ctx.fillStyle = "#3f2818";
  ctx.beginPath();
  ctx.moveTo(-trunkWidth * 0.45, 12);
  ctx.lineTo(trunkWidth * 0.45, 12);
  ctx.lineTo(trunkWidth * 0.32, -tree.size * 0.72);
  ctx.lineTo(-trunkWidth * 0.32, -tree.size * 0.72);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "#6d4428";
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-1, 8);
  ctx.lineTo(-2, -tree.size * 0.55);
  ctx.stroke();
  ctx.globalAlpha = 1;

  const leafBase = tree.tone > 0.66 ? "#214d2b" : tree.tone > 0.33 ? "#2f6636" : "#3b733b";
  const leafDark = tree.tone > 0.66 ? "#15351f" : "#1d4729";
  const leafLight = tree.tone > 0.66 ? "#3f7a42" : "#5c9b52";

  ctx.fillStyle = leafDark;
  ctx.beginPath();
  ctx.arc(0, -tree.size * 1.1, tree.size * 0.95, 0, Math.PI * 2);
  ctx.arc(-tree.size * 0.65, -tree.size * 0.55, tree.size * 0.78, 0, Math.PI * 2);
  ctx.arc(tree.size * 0.68, -tree.size * 0.58, tree.size * 0.78, 0, Math.PI * 2);
  ctx.arc(0, -tree.size * 0.36, tree.size * 0.92, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = leafBase;
  ctx.beginPath();
  ctx.arc(-tree.size * 0.18, -tree.size * 1.16, tree.size * 0.72, 0, Math.PI * 2);
  ctx.arc(-tree.size * 0.58, -tree.size * 0.62, tree.size * 0.56, 0, Math.PI * 2);
  ctx.arc(tree.size * 0.52, -tree.size * 0.68, tree.size * 0.58, 0, Math.PI * 2);
  ctx.arc(0, -tree.size * 0.38, tree.size * 0.66, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = leafLight;
  ctx.globalAlpha = 0.36;
  ctx.beginPath();
  ctx.arc(-tree.size * 0.36, -tree.size * 1.22, tree.size * 0.28, 0, Math.PI * 2);
  ctx.arc(tree.size * 0.25, -tree.size * 0.86, tree.size * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function capsulePath(x, y, w, h) {
  const r = w / 2;
  ctx.beginPath();
  ctx.moveTo(x, y + r);
  ctx.arc(x + r, y + r, r, Math.PI, 0);
  ctx.lineTo(x + w, y + h - r);
  ctx.arc(x + r, y + h - r, r, 0, Math.PI);
  ctx.closePath();
}

function drawBushProp(prop) {
  const s = prop.size;
  ctx.fillStyle = "#1d4729";
  ctx.beginPath();
  ctx.arc(-s * 0.5, 2, s * 0.55, 0, Math.PI * 2);
  ctx.arc(0, -s * 0.25, s * 0.68, 0, Math.PI * 2);
  ctx.arc(s * 0.52, 3, s * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#2f6636";
  ctx.beginPath();
  ctx.arc(-s * 0.36, -2, s * 0.44, 0, Math.PI * 2);
  ctx.arc(s * 0.1, -s * 0.3, s * 0.5, 0, Math.PI * 2);
  ctx.arc(s * 0.5, -1, s * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = "#5c9b52";
  ctx.beginPath();
  ctx.arc(-s * 0.1, -s * 0.42, s * 0.24, 0, Math.PI * 2);
  ctx.arc(s * 0.34, -s * 0.2, s * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawRockProp(prop, palette) {
  const s = prop.size;
  ctx.fillStyle = palette.dark;
  ctx.beginPath();
  ctx.moveTo(-s * 0.9, 10);
  ctx.lineTo(-s * 0.72, -s * 0.34);
  ctx.lineTo(-s * 0.2, -s * 0.78);
  ctx.lineTo(s * 0.42, -s * 0.66);
  ctx.lineTo(s * 0.88, -s * 0.1);
  ctx.lineTo(s * 0.74, 10);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = palette.base;
  ctx.beginPath();
  ctx.moveTo(-s * 0.72, 8);
  ctx.lineTo(-s * 0.58, -s * 0.3);
  ctx.lineTo(-s * 0.12, -s * 0.62);
  ctx.lineTo(s * 0.34, -s * 0.5);
  ctx.lineTo(s * 0.6, 8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = palette.light;
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.moveTo(-s * 0.5, -s * 0.28);
  ctx.lineTo(-s * 0.1, -s * 0.56);
  ctx.lineTo(s * 0.24, -s * 0.44);
  ctx.lineTo(-s * 0.08, -s * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = palette.dark;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-s * 0.2, -s * 0.5);
  ctx.lineTo(0, 2);
  ctx.moveTo(s * 0.3, -s * 0.4);
  ctx.lineTo(s * 0.2, 6);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawCactusProp(prop) {
  const s = prop.size;
  const h = s * 2.1;
  const bodyW = s * 0.52;
  ctx.fillStyle = "#3e7d3a";
  capsulePath(-bodyW / 2, -h, bodyW, h + 12);
  ctx.fill();
  ctx.fillStyle = "#376f34";
  ctx.fillRect(-s * 0.72, -h * 0.36, s * 0.5, s * 0.24);
  capsulePath(-s * 0.78, -h * 0.64, s * 0.3, h * 0.36);
  ctx.fill();
  ctx.fillRect(s * 0.16, -h * 0.5, s * 0.5, s * 0.24);
  capsulePath(s * 0.48, -h * 0.82, s * 0.3, h * 0.4);
  ctx.fill();
  ctx.strokeStyle = "#2c5c2a";
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-bodyW * 0.22, -h + 6);
  ctx.lineTo(-bodyW * 0.22, 8);
  ctx.moveTo(bodyW * 0.22, -h + 6);
  ctx.lineTo(bodyW * 0.22, 8);
  ctx.stroke();
  ctx.globalAlpha = 1;
  if (prop.tone > 0.72) {
    ctx.fillStyle = "#e17fae";
    ctx.beginPath();
    ctx.arc(0, -h - 2, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawShrubProp(prop) {
  const s = prop.size;
  ctx.strokeStyle = "#8a6a3a";
  ctx.lineWidth = 2;
  for (let i = 0; i < 7; i += 1) {
    const a = -Math.PI * 0.15 - (i / 6) * Math.PI * 0.7;
    ctx.beginPath();
    ctx.moveTo(0, 10);
    ctx.quadraticCurveTo(Math.cos(a) * s * 0.5, 10 + Math.sin(a) * s * 0.9, Math.cos(a) * s * 1.1, 10 + Math.sin(a) * s * 1.5);
    ctx.stroke();
  }
  ctx.fillStyle = "#a8874d";
  ctx.globalAlpha = 0.8;
  for (let i = 0; i < 6; i += 1) {
    const a = -Math.PI * 0.16 - (i / 5) * Math.PI * 0.68;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * s * 1.05, 10 + Math.sin(a) * s * 1.42, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawSwampTreeProp(prop) {
  const s = prop.size;
  ctx.fillStyle = "#41321f";
  ctx.beginPath();
  ctx.moveTo(-s * 0.55, 12);
  ctx.lineTo(-s * 0.16, -s * 0.8);
  ctx.lineTo(s * 0.16, -s * 0.8);
  ctx.lineTo(s * 0.55, 12);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#243d22";
  ctx.beginPath();
  ctx.arc(0, -s * 1.14, s * 1.05, 0, Math.PI * 2);
  ctx.arc(-s * 0.85, -s * 0.78, s * 0.7, 0, Math.PI * 2);
  ctx.arc(s * 0.85, -s * 0.8, s * 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#33552c";
  ctx.beginPath();
  ctx.arc(-s * 0.3, -s * 1.2, s * 0.66, 0, Math.PI * 2);
  ctx.arc(s * 0.42, -s * 1.02, s * 0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#7c9a5a";
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i += 1) {
    const mx = -s * 0.9 + i * s * 0.6;
    const drop = s * (0.5 + ((i + Math.floor(prop.tone * 10)) % 3) * 0.16);
    ctx.beginPath();
    ctx.moveTo(mx, -s * 0.72);
    ctx.quadraticCurveTo(mx + 2, -s * 0.72 + drop * 0.6, mx - 2, -s * 0.72 + drop);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawReedsProp(prop) {
  const s = prop.size;
  for (let i = 0; i < 6; i += 1) {
    const bx = -s * 0.6 + i * s * 0.24;
    const hgt = s * (1.2 + ((i + Math.floor(prop.tone * 100)) % 5) * 0.14);
    const sway = (i % 2 ? 1 : -1) * s * 0.16;
    ctx.strokeStyle = i % 2 ? "#5d7a3f" : "#6e8c4a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx, 12);
    ctx.quadraticCurveTo(bx + sway, 12 - hgt * 0.6, bx + sway * 1.6, 12 - hgt);
    ctx.stroke();
    if (i % 2 === 0) {
      ctx.fillStyle = "#6b4a2a";
      capsulePath(bx + sway * 1.6 - 1.8, 12 - hgt - 8, 3.6, 10);
      ctx.fill();
    }
  }
}

function drawPineProp(prop) {
  const s = prop.size;
  ctx.fillStyle = "#4a3322";
  ctx.fillRect(-s * 0.12, -s * 0.2, s * 0.24, s * 0.4 + 10);
  const layers = [
    { y: -s * 0.1, w: s * 1.05, h: s * 0.75 },
    { y: -s * 0.68, w: s * 0.82, h: s * 0.68 },
    { y: -s * 1.2, w: s * 0.55, h: s * 0.6 },
  ];
  layers.forEach((layer, idx) => {
    ctx.fillStyle = idx % 2 ? "#2a5c40" : "#1f4a33";
    ctx.beginPath();
    ctx.moveTo(-layer.w, layer.y);
    ctx.lineTo(0, layer.y - layer.h);
    ctx.lineTo(layer.w, layer.y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#eef6fa";
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(-layer.w * 0.55, layer.y - layer.h * 0.45);
    ctx.lineTo(0, layer.y - layer.h);
    ctx.lineTo(layer.w * 0.55, layer.y - layer.h * 0.45);
    ctx.quadraticCurveTo(0, layer.y - layer.h * 0.28, -layer.w * 0.55, layer.y - layer.h * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  });
}

function drawDeadTreeProp(prop) {
  const s = prop.size;
  ctx.strokeStyle = "#2e2521";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(5, s * 0.26);
  ctx.beginPath();
  ctx.moveTo(0, 12);
  ctx.lineTo(0, -s * 1.1);
  ctx.stroke();
  ctx.lineWidth = Math.max(2.4, s * 0.13);
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.4);
  ctx.lineTo(-s * 0.62, -s * 1.05);
  ctx.moveTo(0, -s * 0.72);
  ctx.lineTo(s * 0.6, -s * 1.3);
  ctx.moveTo(0, -s * 1.1);
  ctx.lineTo(-s * 0.3, -s * 1.62);
  ctx.stroke();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = "#5a4638";
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.moveTo(-1, 8);
  ctx.lineTo(-1, -s * 0.9);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawLavaRockProp(prop, palette) {
  drawRockProp(prop, palette);
  const s = prop.size;
  ctx.strokeStyle = "#ff5a1f";
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = 4;
  strokeLavaRockCracks(s);
  ctx.strokeStyle = "#ffa03c";
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 1.6;
  strokeLavaRockCracks(s);
  ctx.globalAlpha = 1;
}

function strokeLavaRockCracks(s) {
  ctx.beginPath();
  ctx.moveTo(-s * 0.5, 4);
  ctx.lineTo(-s * 0.2, -s * 0.3);
  ctx.lineTo(s * 0.1, -s * 0.16);
  ctx.lineTo(s * 0.36, -s * 0.44);
  ctx.moveTo(-s * 0.12, -s * 0.24);
  ctx.lineTo(-s * 0.06, 6);
  ctx.stroke();
}

function drawVentProp(prop) {
  const s = prop.size;
  ctx.fillStyle = "#463a3c";
  ctx.beginPath();
  ctx.ellipse(0, 4, s * 0.95, s * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#241f21";
  ctx.beginPath();
  ctx.ellipse(0, -2, s * 0.5, s * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  const glow = ctx.createRadialGradient(0, -2, 1, 0, -2, s * 0.45);
  glow.addColorStop(0, "#ff8a3cd9");
  glow.addColorStop(1, "#ff8a3c00");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.ellipse(0, -2, s * 0.45, s * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#8d8489";
  for (let i = 0; i < 3; i += 1) {
    ctx.globalAlpha = 0.26 - i * 0.07;
    ctx.beginPath();
    ctx.arc(i % 2 ? 4 : -3, -s * (0.5 + i * 0.42), s * (0.24 + i * 0.12), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawTower(tower, options = {}) {
  ctx.save();
  ctx.translate(tower.x, tower.y);
  const uiImage = towerUiImage(tower);

  if (state.selectedPlaced === tower || options.ghost) {
    const ring = towerSelectionRing(tower.id);
    ctx.strokeStyle = options.blocked ? "#ec675d" : "#ffffff";
    ctx.lineWidth = 2.5;
    if (options.ghost) ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.ellipse(ring.x, ring.y, ring.radiusX, ring.radiusY, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (tower.kind === "support" && !options.ghost && !tower.portrait) {
    const stats = towerStatsAtLevel(tower, tower.level);
    const pulse = ((performance.now() / 1200 + tower.x * 0.003) % 1);
    const auraColor = tower.id === "haste" ? "#6ee7c8" : "#ffbe5b";
    ctx.strokeStyle = `${auraColor}aa`;
    ctx.lineWidth = 2.5;
    const radius = 24 + (stats.range - 24) * pulse;
    ctx.globalAlpha = 0.72 * (1 - pulse);
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `${auraColor}0f`;
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    ctx.arc(0, 0, stats.range, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  if (uiImage) {
    drawTowerUiImage(tower, uiImage, options);
    ctx.restore();
    return;
  }

  ctx.fillStyle = "#0d1115";
  ctx.beginPath();
  ctx.ellipse(0, 16, 22, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#111417";
  ctx.lineWidth = 3;
  ctx.fillStyle = tower.color;

  switch (tower.id) {
    case "dart":
      drawTowerBase("diamond");
      ctx.fillStyle = tower.color;
      drawSpike(0, -26, 0);
      ctx.fillStyle = "#1d242b";
      ctx.beginPath();
      ctx.moveTo(-12, -9);
      ctx.lineTo(-4, -17);
      ctx.lineTo(-4, -5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(12, -9);
      ctx.lineTo(4, -17);
      ctx.lineTo(4, -5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(0, -25, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    case "ice":
      drawTowerBase("hex");
      ctx.fillStyle = tower.color;
      drawCrystal(-8, -20, 14);
      drawCrystal(7, -24, 18);
      drawCrystal(0, -14, 10);
      ctx.strokeStyle = "#d4f5ff";
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, -20, 17, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();
      ctx.fillStyle = "#eafcff";
      ctx.beginPath();
      ctx.arc(-14, -31, 1.4, 0, Math.PI * 2);
      ctx.arc(13, -35, 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#111417";
      ctx.lineWidth = 3;
      break;
    case "barracks":
      drawTowerBase("block");
      ctx.fillStyle = "#6f4d2d";
      ctx.fillRect(-13, -28, 26, 12);
      ctx.strokeRect(-13, -28, 26, 12);
      ctx.fillStyle = "#111417";
      ctx.fillRect(-4, -6, 8, 16);
      ctx.fillStyle = tower.color;
      ctx.fillRect(-17, -31, 34, 5);
      ctx.beginPath();
      ctx.moveTo(15, -31);
      ctx.lineTo(15, -46);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(15, -46);
      ctx.lineTo(26, -42.5);
      ctx.lineTo(15, -39);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    case "spark":
      drawTowerBase("hex");
      ctx.fillStyle = tower.color;
      drawProng(-10, -20);
      drawProng(10, -20);
      ctx.strokeStyle = "#e8dcff";
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1.5;
      drawJaggedLine(-8, -19, 8, -19, 4, 3);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#111417";
      ctx.lineWidth = 3;
      drawBolt(0, -22, 12);
      break;
    case "tesla":
      drawTowerBase("hex");
      ctx.fillStyle = "#26313a";
      ctx.fillRect(-4, -34, 8, 18);
      ctx.strokeRect(-4, -34, 8, 18);
      ctx.fillStyle = tower.color;
      ctx.fillRect(-7, -33, 14, 3);
      ctx.strokeRect(-7, -33, 14, 3);
      ctx.fillRect(-7, -27, 14, 3);
      ctx.strokeRect(-7, -27, 14, 3);
      ctx.fillRect(-7, -21, 14, 3);
      ctx.strokeRect(-7, -21, 14, 3);
      ctx.fillStyle = "#10141a";
      ctx.beginPath();
      ctx.arc(0, -38, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = tower.color;
      ctx.beginPath();
      ctx.arc(0, -38, 2.2, 0, Math.PI * 2);
      ctx.fill();
      drawProng(-12, -16);
      drawProng(12, -16);
      break;
    case "sniper":
      drawTowerBase("block");
      ctx.fillStyle = "#4a4438";
      ctx.beginPath();
      ctx.roundRect(-16, -6, 32, 11, 5);
      ctx.fill();
      ctx.stroke();
      ctx.save();
      ctx.translate(-2, -16);
      ctx.rotate(-0.08);
      ctx.fillStyle = "#101417";
      ctx.fillRect(0, -2.6, 42, 5.2);
      ctx.fillStyle = "#6d7a80";
      ctx.fillRect(0, -1.8, 40, 3.6);
      ctx.fillStyle = "#cbd5d7";
      ctx.globalAlpha = 0.5;
      ctx.fillRect(2, -1.6, 26, 1.2);
      ctx.globalAlpha = 1;
      ctx.strokeRect(0, -1.8, 40, 3.6);
      ctx.fillStyle = "#0d1115";
      ctx.fillRect(34, -3.6, 7, 7.2);
      ctx.strokeRect(34, -3.6, 7, 7.2);
      ctx.restore();
      ctx.fillStyle = "#0d1115";
      ctx.fillRect(-10, -27, 16, 7);
      ctx.strokeRect(-10, -27, 16, 7);
      ctx.fillStyle = "#9bdcff";
      ctx.beginPath();
      ctx.arc(6, -23.5, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(24, -14);
      ctx.lineTo(20, -2);
      ctx.moveTo(30, -14);
      ctx.lineTo(34, -2);
      ctx.stroke();
      ctx.lineWidth = 3;
      if (!options.ghost) drawMuzzleCharge(tower, -37, -8, "#ffe8ab", 0.85);
      break;
    case "rail":
      drawTowerBase("hex");
      ctx.fillStyle = "#10141a";
      ctx.beginPath();
      ctx.arc(-9, -16, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#9fd0ff";
      ctx.beginPath();
      ctx.arc(-9, -16, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#5f6b70";
      ctx.fillRect(-2, -21, 42, 3.4);
      ctx.strokeRect(-2, -21, 42, 3.4);
      ctx.fillRect(-2, -13, 42, 3.4);
      ctx.strokeRect(-2, -13, 42, 3.4);
      ctx.fillStyle = "#bfe0ff";
      ctx.globalAlpha = 0.5;
      ctx.fillRect(2, -17.4, 36, 4.2);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#26313a";
      ctx.fillRect(6, -24.5, 4.8, 16);
      ctx.strokeRect(6, -24.5, 4.8, 16);
      ctx.fillRect(19, -24.5, 4.8, 16);
      ctx.strokeRect(19, -24.5, 4.8, 16);
      ctx.fillRect(32, -24.5, 4.8, 16);
      ctx.strokeRect(32, -24.5, 4.8, 16);
      ctx.fillStyle = tower.color;
      ctx.fillRect(6, -24.5, 4.8, 3.4);
      ctx.fillRect(19, -24.5, 4.8, 3.4);
      ctx.fillRect(32, -24.5, 4.8, 3.4);
      if (!options.ghost) drawMuzzleCharge(tower, -34, -24, "#9fd0ff", 1.1);
      break;
    case "venom":
      drawTowerBase("pot");
      ctx.fillStyle = tower.color;
      drawBubble(-8, -24, 5);
      drawBubble(4, -28, 7);
      drawBubble(11, -20, 4);
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.moveTo(-11, -12);
      ctx.quadraticCurveTo(-9, -2, -12, 7);
      ctx.quadraticCurveTo(-15, -2, -11, -12);
      ctx.fill();
      ctx.strokeStyle = tower.color;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-2, -33);
      ctx.quadraticCurveTo(2, -39, -1, -45);
      ctx.moveTo(8, -34);
      ctx.quadraticCurveTo(12, -40, 9, -46);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#111417";
      ctx.lineWidth = 3;
      break;
    case "laser":
      drawTowerBase("diamond");
      drawLens(0, -20, 13);
      ctx.fillStyle = tower.color;
      ctx.beginPath();
      ctx.arc(0, -20, 5.5, 0, Math.PI * 2);
      ctx.fill();
      drawBarrel(18, -18, 18, 4);
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(-4, -24, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    case "quake":
      drawTowerBase("drum");
      drawRing(0, -14, 17);
      ctx.fillStyle = "#26313a";
      ctx.fillRect(-5, -35, 10, 15);
      ctx.strokeRect(-5, -35, 10, 15);
      ctx.fillStyle = tower.color;
      ctx.fillRect(-9, -40, 18, 6);
      ctx.strokeRect(-9, -40, 18, 6);
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-15, 12);
      ctx.lineTo(-21, 17);
      ctx.moveTo(15, 12);
      ctx.lineTo(21, 17);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 3;
      break;
    case "bank":
      drawTowerBase("vault");
      drawCoinStack(-7, -26);
      drawCoinStack(8, -22);
      ctx.fillStyle = "#39d2c0";
      ctx.beginPath();
      ctx.moveTo(0, -34);
      ctx.lineTo(4.5, -29);
      ctx.lineTo(0, -24);
      ctx.lineTo(-4.5, -29);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    case "haste":
      drawTowerBase("diamond");
      drawLens(0, -18, 10);
      ctx.strokeStyle = tower.color;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(0, -18);
      ctx.lineTo(0, -24.5);
      ctx.moveTo(0, -18);
      ctx.lineTo(5, -15.5);
      ctx.stroke();
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(-15, -26);
      ctx.lineTo(-23, -26);
      ctx.moveTo(-13, -20);
      ctx.lineTo(-21, -20);
      ctx.moveTo(15, -26);
      ctx.lineTo(23, -26);
      ctx.moveTo(13, -20);
      ctx.lineTo(21, -20);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#111417";
      ctx.lineWidth = 3;
      break;
    case "power":
      drawTowerBase("drum");
      drawRing(0, -15, 16);
      drawBolt(0, -23, 15);
      ctx.strokeStyle = tower.color;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -33);
      ctx.lineTo(0, -39);
      ctx.moveTo(-13, -28);
      ctx.lineTo(-17, -33);
      ctx.moveTo(13, -28);
      ctx.lineTo(17, -33);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#111417";
      ctx.lineWidth = 3;
      break;
    case "ember":
      drawTowerBase("pot");
      drawFlame(0, -25);
      ctx.fillStyle = "#ffbe5b";
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(-11, -37, 1.6, 0, Math.PI * 2);
      ctx.arc(9, -41, 2, 0, Math.PI * 2);
      ctx.arc(1, -47, 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    case "void":
      drawTowerBase("hex");
      drawRing(0, -18, 14);
      drawLens(0, -18, 7);
      ctx.strokeStyle = tower.color;
      ctx.lineWidth = 1.8;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      for (let i = 0; i <= 20; i += 1) {
        const spiralA = i * 0.5;
        const spiralR = 1.5 + i * 0.55;
        const spx = Math.cos(spiralA) * spiralR;
        const spy = -18 + Math.sin(spiralA) * spiralR * 0.8;
        if (i === 0) ctx.moveTo(spx, spy);
        else ctx.lineTo(spx, spy);
      }
      ctx.stroke();
      ctx.fillStyle = "#d7c8ff";
      ctx.beginPath();
      ctx.arc(13, -27, 1.8, 0, Math.PI * 2);
      ctx.arc(-14, -9, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#111417";
      ctx.lineWidth = 3;
      break;
    case "ranger":
      drawTowerBase("diamond");
      drawScope(-3, -22);
      drawBarrel(15, -18, 26, 4);
      ctx.fillStyle = "#10141a";
      ctx.fillRect(4, -11, 20, 3);
      ctx.strokeRect(4, -11, 20, 3);
      ctx.fillStyle = tower.color;
      ctx.beginPath();
      ctx.moveTo(-15, -27);
      ctx.lineTo(-6, -31);
      ctx.lineTo(-6, -23);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    case "orbital":
      drawTowerBase("diamond");
      ctx.fillStyle = "#dfe9ef";
      ctx.beginPath();
      ctx.ellipse(0, -25, 15, 8, -0.25, Math.PI * 0.95, Math.PI * 2.05);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#10141a";
      ctx.beginPath();
      ctx.arc(2, -28, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(2, -37, 1.6, 0, Math.PI * 2);
      ctx.arc(4, -44, 1.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      drawLens(0, -14, 7);
      break;
    default:
      drawTowerBase("block");
  }

  if (tower.id === "barracks") {
    ctx.fillStyle = "#f3f5f7";
    ctx.beginPath();
    ctx.arc(0, 2, 8, 0, Math.PI * 2);
    ctx.fill();
  }
  drawTowerLevelBadge(tower.level);
  ctx.restore();
}

function drawTowerUiImage(tower, img, options = {}) {
  const size = tower.id === "sniper" || tower.id === "orbital" ? 76 : tower.id === "rail" ? 68 : 70;
  const x = -size / 2;
  // Repaired sprites share a ground-contact baseline at pixel 240 of 256.
  const y = -size * (240 / 256);
  ctx.save();
  ctx.globalAlpha = options.ghost ? 0.58 : 1;
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(7, 11, 14, .28)";
  ctx.beginPath();
  ctx.ellipse(0, 0, size * .32, size * .055, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.filter = tower.id === "sniper" || tower.id === "rail" ? "brightness(1.15)" : "none";
  ctx.drawImage(img, x, y, size, size);
  ctx.filter = "none";
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  ctx.restore();

  if (!options.ghost) {
    const muzzle = towerShotOrigin(tower);
    if (tower.id === "sniper") drawMuzzleCharge(tower, muzzle.x - tower.x, muzzle.y - tower.y, "#ffe8ab", 0.85);
    if (tower.id === "rail") drawMuzzleCharge(tower, muzzle.x - tower.x, muzzle.y - tower.y, "#9fd0ff", 1.1);
  }

  drawTowerLevelBadge(tower.level);
}

function drawTowerLevelBadge(level) {
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#edf3f7";
  ctx.strokeStyle = "#111417";
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.arc(0, 7, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#111417";
  ctx.font = "900 14px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(String(level ?? 1), 0, 12);
  ctx.textAlign = "left";
}

function drawTowerBase(shape) {
  const baseColor = ctx.fillStyle;
  ctx.save();
  ctx.beginPath();
  traceTowerBase(shape);
  ctx.closePath();
  ctx.fillStyle = "#071013";
  ctx.translate(0, 3);
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  traceTowerBase(shape);
  ctx.closePath();
  ctx.fillStyle = baseColor;
  ctx.fill();
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  traceTowerBase(shape);
  ctx.closePath();
  ctx.clip();

  ctx.globalAlpha = 0.26;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(-7, -12, 12, 7, -0.35, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.22;
  ctx.fillStyle = "#020405";
  ctx.fillRect(-24, 5, 48, 22);

  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-13, -5);
  ctx.lineTo(13, -5);
  ctx.moveTo(-9, 7);
  ctx.lineTo(9, 7);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "#07090b";
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.45;
  if (shape === "drum") {
    ctx.beginPath();
    ctx.ellipse(0, -7, 14, 7, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (shape === "vault") {
    ctx.strokeRect(-10, -9, 20, 21);
    ctx.beginPath();
    ctx.arc(0, 1, 5, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(0, 1, 6, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function traceTowerBase(shape) {
  if (shape === "diamond") {
    ctx.moveTo(0, -21);
    ctx.lineTo(19, -4);
    ctx.lineTo(12, 17);
    ctx.lineTo(-12, 17);
    ctx.lineTo(-19, -4);
  } else if (shape === "hex") {
    ctx.moveTo(0, -22);
    ctx.lineTo(18, -11);
    ctx.lineTo(18, 11);
    ctx.lineTo(0, 22);
    ctx.lineTo(-18, 11);
    ctx.lineTo(-18, -11);
  } else if (shape === "pot") {
    ctx.moveTo(-16, -12);
    ctx.quadraticCurveTo(0, -24, 16, -12);
    ctx.lineTo(13, 17);
    ctx.lineTo(-13, 17);
  } else if (shape === "drum") {
    ctx.ellipse(0, -7, 18, 11, 0, 0, Math.PI * 2);
    ctx.rect(-16, -7, 32, 24);
  } else if (shape === "vault") {
    ctx.rect(-17, -17, 34, 34);
    ctx.moveTo(-11, -17);
    ctx.lineTo(0, -27);
    ctx.lineTo(11, -17);
  } else {
    ctx.rect(-17, -18, 34, 36);
  }
}

function drawBarrel(x, y, length, width) {
  ctx.fillStyle = "#101417";
  ctx.fillRect(-1, y - width / 2 - 2, length + 3, width + 4);
  ctx.fillStyle = "#5f6b70";
  ctx.fillRect(0, y - width / 2, length, width);
  ctx.fillStyle = "#cbd5d7";
  ctx.globalAlpha = 0.45;
  ctx.fillRect(2, y - width / 2, Math.max(6, length * 0.64), Math.max(1, width * 0.28));
  ctx.globalAlpha = 1;
  ctx.strokeRect(0, y - width / 2, length, width);
  ctx.fillStyle = "#0d1115";
  ctx.beginPath();
  ctx.roundRect(x, y - width / 2 - 3, 8, width + 6, 3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = ctx.strokeStyle;
}

function drawSpike(x, y) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 8, y + 24);
  ctx.lineTo(x - 8, y + 24);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawCrystal(x, y, h) {
  ctx.beginPath();
  ctx.moveTo(x, y - h);
  ctx.lineTo(x + 7, y);
  ctx.lineTo(x, y + 5);
  ctx.lineTo(x - 7, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawProng(x, y) {
  ctx.fillRect(x - 3, y, 6, 18);
  ctx.strokeRect(x - 3, y, 6, 18);
}

function drawBolt(x, y, size) {
  ctx.fillStyle = "#f7f36a";
  ctx.beginPath();
  ctx.moveTo(x + 2, y - size);
  ctx.lineTo(x - 6, y);
  ctx.lineTo(x + 1, y);
  ctx.lineTo(x - 3, y + size);
  ctx.lineTo(x + 9, y - 3);
  ctx.lineTo(x + 2, y - 3);
  ctx.closePath();
  ctx.fill();
}

function drawScope(x, y) {
  ctx.fillStyle = "#0d1115";
  ctx.fillRect(x - 7, y - 4, 14, 8);
  ctx.strokeRect(x - 7, y - 4, 14, 8);
}

function drawBubble(x, y, radius) {
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawLens(x, y, radius) {
  ctx.fillStyle = "#10141a";
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(x - radius * 0.25, y - radius * 0.25, radius * 0.28, 0, Math.PI * 2);
  ctx.fill();
}

function drawRing(x, y, radius) {
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 3;
}

function drawCoinStack(x, y) {
  ctx.fillStyle = "#ffd35a";
  for (let i = 0; i < 3; i += 1) {
    ctx.fillRect(x - 7, y + i * 5, 14, 5);
    ctx.strokeRect(x - 7, y + i * 5, 14, 5);
  }
}

function drawFlame(x, y) {
  ctx.fillStyle = "#ff5b32";
  ctx.beginPath();
  ctx.moveTo(x, y - 19);
  ctx.bezierCurveTo(x + 18, y - 4, x + 8, y + 12, x, y + 13);
  ctx.bezierCurveTo(x - 13, y + 8, x - 12, y - 3, x, y - 19);
  ctx.fill();
  ctx.fillStyle = "#ffe66b";
  ctx.beginPath();
  ctx.moveTo(x, y - 8);
  ctx.bezierCurveTo(x + 8, y + 2, x + 3, y + 9, x, y + 9);
  ctx.bezierCurveTo(x - 6, y + 6, x - 5, y, x, y - 8);
  ctx.fill();
}

function drawStar(x, y, radius) {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? radius : radius * 0.42;
    const px = x + Math.cos(angle) * r;
    const py = y + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawSatellite(x, y) {
  ctx.fillStyle = "#dfe9ef";
  ctx.fillRect(x - 4, y - 8, 8, 16);
  ctx.fillRect(x - 22, y - 4, 13, 8);
  ctx.fillRect(x + 9, y - 4, 13, 8);
  ctx.strokeRect(x - 4, y - 8, 8, 16);
}

function drawSoldier(soldier) {
  const hasGun = soldier.range > 0;
  ctx.save();
  ctx.translate(soldier.x, soldier.y);

  ctx.fillStyle = "#0b0d10";
  ctx.beginPath();
  ctx.ellipse(0, 11, 11, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = hasGun ? "#4d6f47" : "#6f7f4a";
  ctx.strokeStyle = "#111417";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(-8, -12, 16, 22, 5);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#d9b68a";
  ctx.beginPath();
  ctx.arc(0, -18, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = soldier.color;
  ctx.beginPath();
  ctx.arc(0, -24, 3.5, 0, Math.PI * 2);
  ctx.fill();

  if (hasGun) {
    ctx.fillStyle = "#2a3036";
    ctx.fillRect(5, -9, 16, 4);
    ctx.strokeRect(5, -9, 16, 4);
  } else {
    ctx.strokeStyle = "#d9b68a";
    ctx.beginPath();
    ctx.moveTo(-8, -4);
    ctx.lineTo(-15, 5);
    ctx.moveTo(8, -4);
    ctx.lineTo(15, 5);
    ctx.stroke();
  }

  ctx.restore();

  ctx.fillStyle = "#111417";
  ctx.fillRect(soldier.x - 12, soldier.y - 32, 24, 4);
  ctx.fillStyle = soldier.hp / soldier.maxHp > 0.45 ? "#79d77b" : "#ec675d";
  ctx.fillRect(soldier.x - 12, soldier.y - 32, Math.max(0, 24 * (soldier.hp / soldier.maxHp)), 4);
}

function drawMob(mob) {
  const shape = mob.monsterShape || "normal";
  const size = mob.boss ? 22 : shape === "armored" || shape === "brute" ? 17 : shape === "runner" || shape === "winged" ? 13 : 14;
  const body = mob.boss ? mob.bossColor : mob.monsterColor || (mob.heavy ? "#6f5a23" : "#303942");
  const edge = mob.boss ? "#f3f5f7" : mob.monsterEdge || (mob.heavy ? "#e1b84f" : "#aeb8bf");
  const eye = mob.boss ? "#ffe66b" : mob.monsterEye || "#ff5b55";
  const variant = monsterVariant(mob.monsterName || mob.bossName || shape);

  if (drawGeneratedMob(mob, size)) {
    if (!mob.portrait) {
      drawMobStatusEffects(mob, size, eye);
      drawMobHealthBar(mob, Math.ceil(size * 1.5) + 7);
    }
    return;
  }

  ctx.save();
  ctx.translate(mob.x, mob.y);

  ctx.fillStyle = "#0b0d10";
  ctx.beginPath();
  ctx.ellipse(0, size * 0.78, size * 0.9, size * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();

  drawMonsterSilhouette(shape, size, body, edge, variant);

  ctx.fillStyle = edge;
  ctx.beginPath();
  ctx.moveTo(-size * 0.7, -size * 0.52);
  ctx.lineTo(-size * (shape === "winged" ? 1.55 : 1.18), -size * (shape === "runner" ? 1.0 : 1.28));
  ctx.lineTo(-size * 0.16, -size * 0.82);
  ctx.lineTo(size * 0.16, -size * 0.82);
  ctx.lineTo(size * (shape === "winged" ? 1.55 : 1.18), -size * (shape === "runner" ? 1.0 : 1.28));
  ctx.lineTo(size * 0.7, -size * 0.52);
  ctx.closePath();
  ctx.fill();

  if (mob.boss) {
    ctx.beginPath();
    ctx.moveTo(-size * 0.26, -size * 0.9);
    ctx.lineTo(0, -size * 1.55);
    ctx.lineTo(size * 0.26, -size * 0.9);
    ctx.fill();
  }

  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.bezierCurveTo(size * 0.95, -size * 0.82, size * (shape === "brute" ? 1.35 : 1.12), size * 0.2, size * 0.62, size * 0.85);
  ctx.lineTo(size * 0.3, size * 0.65);
  ctx.lineTo(0, size * 1.02);
  ctx.lineTo(-size * 0.3, size * 0.65);
  ctx.lineTo(-size * 0.62, size * 0.85);
  ctx.bezierCurveTo(-size * (shape === "brute" ? 1.35 : 1.12), size * 0.2, -size * 0.95, -size * 0.82, 0, -size);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = edge;
  ctx.lineWidth = 2.2;
  ctx.stroke();

  drawMonsterMarkings(shape, size, body, edge, eye, variant);

  if (shape === "armored") {
    ctx.strokeStyle = edge;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 3;
    for (const y of [-0.45, -0.05, 0.35]) {
      ctx.beginPath();
      ctx.moveTo(-size * 0.48, size * y);
      ctx.lineTo(size * 0.48, size * y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  if (shape === "spiked") {
    ctx.fillStyle = edge;
    for (const x of [-0.5, 0, 0.5]) {
      ctx.beginPath();
      ctx.moveTo(size * x - size * 0.14, -size * 0.72);
      ctx.lineTo(size * x, -size * 1.18);
      ctx.lineTo(size * x + size * 0.14, -size * 0.72);
      ctx.closePath();
      ctx.fill();
    }
  }

  ctx.fillStyle = edge;
  ctx.beginPath();
  ctx.moveTo(-size * 0.84, size * 0.16);
  ctx.lineTo(-size * (shape === "runner" ? 1.52 : 1.3), size * 0.42);
  ctx.lineTo(-size * 0.86, size * 0.55);
  ctx.moveTo(size * 0.84, size * 0.16);
  ctx.lineTo(size * (shape === "runner" ? 1.52 : 1.3), size * 0.42);
  ctx.lineTo(size * 0.86, size * 0.55);
  ctx.fill();

  ctx.fillStyle = eye;
  ctx.beginPath();
  if (variant % 4 === 0 && !mob.boss) {
    ctx.ellipse(0, -size * 0.22, size * 0.25, size * 0.3, 0, 0, Math.PI * 2);
  } else {
    ctx.ellipse(-size * 0.34, -size * 0.18, size * 0.18, size * 0.27, -0.45, 0, Math.PI * 2);
    ctx.ellipse(size * 0.34, -size * 0.18, size * 0.18, size * 0.27, 0.45, 0, Math.PI * 2);
  }
  ctx.fill();

  ctx.strokeStyle = "#07090b";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-size * 0.5, size * 0.24);
  ctx.quadraticCurveTo(0, size * 0.48, size * 0.5, size * 0.24);
  ctx.stroke();

  ctx.fillStyle = "#f2f5f7";
  for (const tooth of [-0.22, 0, 0.22]) {
    ctx.beginPath();
    ctx.moveTo(size * tooth - size * 0.08, size * 0.29);
    ctx.lineTo(size * tooth + size * 0.08, size * 0.29);
    ctx.lineTo(size * tooth, size * 0.55);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();

  if (mob.portrait) return;

  drawMobStatusEffects(mob, size, eye);
  drawMobHealthBar(mob);
}

function drawMobNameLabel(mob) {
  const name = mob.bossName || mob.monsterName;
  if (!name) return;
  const shape = mob.monsterShape || "normal";
  const size = mob.boss ? 22 : shape === "armored" || shape === "brute" ? 17 : shape === "runner" || shape === "winged" ? 13 : 14;
  const topOffset = mobArtCell(name) ? Math.ceil(size * 1.5) + 17 : size + 18;
  const y = mob.y - topOffset;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.font = mob.bossName ? "900 15px Arial, sans-serif" : "900 12px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = mob.bossName ? 4 : 3;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
  ctx.strokeText(name, mob.x, y, 96);
  ctx.fillStyle = "#111417";
  ctx.fillText(name, mob.x, y, 96);
  ctx.restore();
}

function drawMobStatusEffects(mob, size, eye) {
  const now = performance.now() / 1000;
  ctx.save();
  ctx.translate(mob.x, mob.y);

  if (mob.slowTimer > 0) {
    ctx.strokeStyle = "#9bdcffcc";
    ctx.fillStyle = "#bff4ff22";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, -size * 0.12, size * 1.18, size * 1.05, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 0.65;
    for (let i = 0; i < 4; i += 1) {
      const angle = now * 1.5 + i * Math.PI * 0.5 + mob.uid * 0.1;
      drawCrystal(Math.cos(angle) * size * 0.72, -size * 0.15 + Math.sin(angle) * size * 0.62, size * 0.22);
    }
    ctx.globalAlpha = 1;
  }

  if (mob.poisonTimer > 0) {
    ctx.fillStyle = "#78f06e88";
    ctx.strokeStyle = "#163d19";
    for (let i = 0; i < 5; i += 1) {
      const rise = ((now * 18 + i * 11 + mob.uid * 3) % 34) / 34;
      const x = Math.sin(now * 2.1 + i * 1.7 + mob.uid) * size * 0.72;
      const y = size * 0.52 - rise * size * 1.65;
      const r = size * (0.1 + i * 0.018);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  if (mob.burnTimer > 0) {
    const flicker = 0.45 + Math.sin(now * 14 + mob.uid) * 0.16;
    ctx.fillStyle = "#ff7a3240";
    ctx.strokeStyle = "#ffbe5bcc";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.ellipse(0, size * 0.12, size * (1.18 + flicker), size * 1.08, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 0.72;
    drawFlame(-size * 0.42, size * 0.15);
    drawFlame(size * 0.38, size * 0.1);
    ctx.globalAlpha = 1;
  }

  if (mob.shockTimer > 0) {
    const effectsBusy = state.shots.length > MAX_ACTIVE_SHOTS * 0.5 || state.mobs.length > 80;
    if (effectsBusy && !mob.boss) {
      ctx.globalAlpha = 0.42;
      ctx.fillStyle = mob.shockColor || "#65ffe4";
      ctx.beginPath();
      ctx.arc(0, -size * 0.1, size * 0.48, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    const shockColor = mob.shockColor || "#65ffe4";
    ctx.strokeStyle = shockColor;
    ctx.lineWidth = effectsBusy ? 1.6 : 2;
    if (!effectsBusy) {
      ctx.shadowColor = shockColor;
      ctx.shadowBlur = 4;
    }
    for (let i = 0; i < (effectsBusy ? 1 : 2); i += 1) {
      const a = now * 8 + i * 2.1 + mob.uid;
      const sx = Math.cos(a) * size * 0.72;
      const sy = Math.sin(a) * size * 0.56;
      if (effectsBusy) drawSimpleLine(sx, sy, -sx * 0.45, -sy * 0.45);
      else drawJaggedLine(sx, sy, -sx * 0.55, -sy * 0.55, 3, 3);
    }
    ctx.shadowBlur = 0;
  }

  if (mob.voidTimer > 0) {
    const pulse = 0.5 + Math.sin(now * 6 + mob.uid) * 0.5;
    ctx.strokeStyle = "#9b7dffcc";
    ctx.lineWidth = 2 + pulse * 1.5;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.ellipse(0, -size * 0.05, size * (1.25 + pulse * 0.25), size * (0.95 + pulse * 0.2), now * 0.8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = `${eye}30`;
    ctx.beginPath();
    ctx.arc(0, -size * 0.18, size * (0.35 + pulse * 0.16), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function monsterVariant(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 997;
  return hash;
}

function drawMonsterSilhouette(shape, size, body, edge, variant) {
  ctx.save();
  if (shape === "winged") {
    ctx.fillStyle = `${edge}88`;
    ctx.beginPath();
    ctx.ellipse(-size * 1.15, -size * 0.34, size * 0.75, size * 0.32, -0.55, 0, Math.PI * 2);
    ctx.ellipse(size * 1.15, -size * 0.34, size * 0.75, size * 0.32, 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(-size * 0.55, -size * 0.28);
    ctx.lineTo(-size * 1.65, -size * 0.55);
    ctx.moveTo(size * 0.55, -size * 0.28);
    ctx.lineTo(size * 1.65, -size * 0.55);
    ctx.stroke();
  } else if (shape === "runner") {
    ctx.strokeStyle = edge;
    ctx.lineWidth = 3;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * size * 0.55, size * 0.35);
      ctx.lineTo(side * size * 1.15, size * (variant % 2 ? 0.8 : 0.62));
      ctx.lineTo(side * size * 1.55, size * 0.58);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(side * size * 0.36, size * 0.62);
      ctx.lineTo(side * size * 0.95, size * 1.1);
      ctx.stroke();
    }
  } else if (shape === "brute") {
    ctx.fillStyle = body;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 2;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(side * size * 0.9, size * 0.05, size * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  } else if (shape === "armored") {
    ctx.fillStyle = edge;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(-size * 0.85, -size * 0.7);
    ctx.lineTo(0, -size * 1.2);
    ctx.lineTo(size * 0.85, -size * 0.7);
    ctx.lineTo(size * 1.05, size * 0.35);
    ctx.lineTo(0, size * 0.95);
    ctx.lineTo(-size * 1.05, size * 0.35);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawMonsterMarkings(shape, size, body, edge, eye, variant) {
  const mark = variant % 5;
  ctx.save();
  if (mark === 0) {
    ctx.strokeStyle = edge;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 2;
    for (const x of [-0.28, 0, 0.28]) {
      ctx.beginPath();
      ctx.moveTo(size * x, -size * 0.72);
      ctx.lineTo(size * x * 0.55, size * 0.52);
      ctx.stroke();
    }
  } else if (mark === 1) {
    ctx.fillStyle = edge;
    ctx.globalAlpha = 0.75;
    for (const [x, y] of [[-0.28, -0.55], [0.26, -0.35], [0, 0.18]]) {
      ctx.beginPath();
      ctx.arc(size * x, size * y, size * 0.13, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (mark === 2) {
    ctx.fillStyle = edge;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * size * 0.22, -size * 0.82);
      ctx.lineTo(side * size * 0.62, -size * 1.18);
      ctx.lineTo(side * size * 0.42, -size * 0.65);
      ctx.closePath();
      ctx.fill();
    }
  } else if (mark === 3) {
    ctx.strokeStyle = eye;
    ctx.globalAlpha = 0.72;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, -size * 0.22, size * 0.52, 0.18, Math.PI - 0.18);
    ctx.stroke();
  } else {
    ctx.fillStyle = edge;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(0, size * 0.78);
    ctx.quadraticCurveTo(size * (variant % 2 ? 1.0 : -1.0), size * 1.05, size * (variant % 2 ? 1.24 : -1.24), size * 0.36);
    ctx.lineTo(size * (variant % 2 ? 0.82 : -0.82), size * 0.48);
    ctx.closePath();
    ctx.fill();
  }

  if (shape === "winged" && mark !== 1) {
    ctx.fillStyle = eye;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.arc(-size * 1.1, -size * 0.34, size * 0.13, 0, Math.PI * 2);
    ctx.arc(size * 1.1, -size * 0.34, size * 0.13, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawShot(shot) {
  const lifeRatio = shot.maxLife ? Math.max(0, Math.min(1, shot.life / shot.maxLife)) : 1;
  const effectsBusy = state.shots.length > MAX_ACTIVE_SHOTS * 0.65;
  const dx = shot.tx - shot.x;
  const dy = shot.ty - shot.y;
  const angle = Math.atan2(dy, dx);
  const distance = Math.hypot(dx, dy) || 1;
  const nx = Math.cos(angle);
  const ny = Math.sin(angle);
  const px = -ny;
  const py = nx;
  const progress = 1 - lifeRatio;
  const easedProgress = Math.min(1, progress * 1.18);
  const projectileProgress = shot.style === "rail" ? Math.min(1, progress * 1.45) : easedProgress;
  const projectileX = shot.x + dx * projectileProgress;
  const projectileY = shot.y + dy * projectileProgress;
  const tailLength = Math.min(distance * 0.22, 34);
  const tailX = projectileX - nx * tailLength;
  const tailY = projectileY - ny * tailLength;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = Math.min(1, 0.3 + lifeRatio * 0.9);
  ctx.strokeStyle = shot.color;
  ctx.fillStyle = shot.color;
  ctx.lineWidth = shot.width || 3;

  if (shot.style === "coinPulse") {
    const radius = (shot.radius || 24) * (0.9 + progress * 0.35);
    const rise = 24 * progress;
    ctx.shadowColor = "#ffd35a";
    ctx.shadowBlur = 7;
    ctx.strokeStyle = "#ffd35a";
    ctx.fillStyle = "#ffd35a18";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(shot.x, shot.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    for (let i = 0; i < 5; i += 1) {
      const a = i * Math.PI * 0.4 - 0.8;
      const coinX = shot.x + Math.cos(a) * radius * 0.62;
      const coinY = shot.y + Math.sin(a) * radius * 0.35 - rise * (0.35 + i * 0.08);
      ctx.fillStyle = "#ffd35a";
      ctx.strokeStyle = "#fff0a6";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(coinX, coinY, 4.2, 6, 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "#9b6b18";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(coinX, coinY - 3.1);
      ctx.lineTo(coinX, coinY + 3.1);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffd35a";
    ctx.font = "900 16px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("+$", shot.x, shot.y - rise);
    ctx.restore();
    return;
  }

  if (shot.style === "spawn") {
    const radius = (shot.radius || 22) * (1.2 - lifeRatio * 0.2);
    ctx.strokeStyle = shot.color;
    ctx.fillStyle = `${shot.color}22`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(shot.x, shot.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#d4c2a277";
    for (let i = 0; i < 4; i += 1) {
      const angle = i * Math.PI * 0.5 + lifeRatio;
      ctx.beginPath();
      ctx.arc(shot.x + Math.cos(angle) * radius * 0.45, shot.y + Math.sin(angle) * radius * 0.25, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  if (shot.beam || shot.style === "orbital") {
    const beamTime = performance.now() / 1000;
    const pulse = 0.75 + Math.sin(beamTime * 26) * 0.25;
    ctx.lineCap = "round";

    const sheath = ctx.createLinearGradient(shot.x, shot.y, shot.tx, shot.ty);
    sheath.addColorStop(0, "#7fd8ff22");
    sheath.addColorStop(0.5, "#a8e6ff88");
    sheath.addColorStop(1, "#e8fbffcc");
    ctx.strokeStyle = sheath;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = ((shot.width || 4.5) + 8) * pulse;
    ctx.beginPath();
    ctx.moveTo(shot.x, shot.y);
    ctx.lineTo(shot.tx, shot.ty);
    ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = (shot.width || 4.5) * (0.8 + pulse * 0.3);
    ctx.beginPath();
    ctx.moveTo(shot.x, shot.y);
    ctx.lineTo(shot.tx, shot.ty);
    ctx.stroke();

    ctx.strokeStyle = "#8fe0ff";
    ctx.lineWidth = 2.4;
    ctx.setLineDash([10, 26]);
    ctx.lineDashOffset = -((beamTime * 320) % 36);
    ctx.beginPath();
    ctx.moveTo(shot.x, shot.y);
    ctx.lineTo(shot.tx, shot.ty);
    ctx.stroke();
    ctx.setLineDash([]);

    const flare = 10 + Math.sin(beamTime * 30) * 3;
    const impact = ctx.createRadialGradient(shot.tx, shot.ty, 1, shot.tx, shot.ty, flare * 2.4);
    impact.addColorStop(0, "#ffffff");
    impact.addColorStop(0.35, "#bfeaffcc");
    impact.addColorStop(1, "#4fc3f700");
    ctx.fillStyle = impact;
    ctx.beginPath();
    ctx.arc(shot.tx, shot.ty, flare * 2.4, 0, Math.PI * 2);
    ctx.fill();

    const ringPhase = (beamTime * 40) % 14;
    ctx.strokeStyle = "#bfeaff";
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.7 * (1 - ringPhase / 14);
    ctx.beginPath();
    ctx.arc(shot.tx, shot.ty, 8 + ringPhase, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#e8fbff";
    for (let i = 0; i < 3; i += 1) {
      const sparkA = beamTime * 7 + (i * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.arc(shot.tx + Math.cos(sparkA) * 13, shot.ty + Math.sin(sparkA) * 8, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    const src = ctx.createRadialGradient(shot.x, shot.y, 1, shot.x, shot.y, 14);
    src.addColorStop(0, "#ffffffdd");
    src.addColorStop(1, "#8fe0ff00");
    ctx.globalAlpha = 1;
    ctx.fillStyle = src;
    ctx.beginPath();
    ctx.arc(shot.x, shot.y, 14, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
    return;
  }

  if (shot.style === "chainLightning" || shot.style === "chainTesla") {
    ctx.shadowColor = shot.color;
    ctx.shadowBlur = shot.style === "chainTesla" ? 12 : 8;
    ctx.strokeStyle = "#ffffff";
    ctx.globalAlpha = effectsBusy ? 0.38 : 0.62;
    ctx.lineWidth = (shot.width || 1.2) + 1.2;
    drawJaggedLine(shot.x, shot.y, shot.tx, shot.ty, 5, shot.style === "chainTesla" ? 8 : 6);
    ctx.strokeStyle = shot.color;
    ctx.globalAlpha = effectsBusy ? 0.55 : 0.9;
    ctx.lineWidth = shot.width || 1.2;
    drawJaggedLine(shot.x, shot.y, shot.tx, shot.ty, 7, shot.style === "chainTesla" ? 10 : 7);
    ctx.restore();
    return;
  }

  if (shot.style === "lightning" || shot.style === "tesla") {
    const coreR = shot.style === "tesla" ? 6 : 4.5;
    ctx.shadowColor = shot.color;
    ctx.shadowBlur = shot.style === "tesla" ? 14 : 9;
    ctx.strokeStyle = `${shot.color}aa`;
    ctx.lineWidth = shot.style === "tesla" ? 2.2 : 1.6;
    drawJaggedLine(tailX, tailY, projectileX, projectileY, 5, shot.style === "tesla" ? 8 : 5);
    ctx.fillStyle = shot.color;
    if (!effectsBusy) {
      ctx.globalAlpha = 0.22;
      ctx.beginPath();
      ctx.arc(projectileX, projectileY, coreR * 1.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = effectsBusy ? 0.65 : 0.88;
    ctx.beginPath();
    ctx.arc(projectileX, projectileY, coreR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  if (shot.style === "rail") {
    const railFade = Math.min(1, lifeRatio / 0.3);
    ctx.lineCap = "round";

    const railGrad = ctx.createLinearGradient(tailX, tailY, projectileX, projectileY);
    railGrad.addColorStop(0, "#6ea9ff00");
    railGrad.addColorStop(0.28, "#6ea9ff66");
    railGrad.addColorStop(1, "#f4fbff");
    ctx.shadowColor = "#86c7ff";
    ctx.shadowBlur = 12;
    ctx.strokeStyle = railGrad;
    ctx.globalAlpha = railFade;
    ctx.lineWidth = 8;
    drawSimpleLine(tailX, tailY, projectileX, projectileY);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.6;
    drawSimpleLine(tailX, tailY, projectileX, projectileY);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    if (lifeRatio < 0.3) {
      const boom = 1 - lifeRatio / 0.3;
      drawImpactRing(shot.tx, shot.ty, 12 + boom * 26, "#dfe9ef");
      drawImpactRing(shot.tx, shot.ty, 6 + boom * 14, "#9fd0ff");
      ctx.strokeStyle = "#bfe0ff";
      ctx.globalAlpha = Math.max(0, 0.85 - boom);
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 3; i += 1) {
        const arcA = angle + (i - 1) * 1.6 + boom * 2;
        drawJaggedLine(
          shot.tx,
          shot.ty,
          shot.tx + Math.cos(arcA) * (12 + boom * 14),
          shot.ty + Math.sin(arcA) * (12 + boom * 14),
          4,
          5
        );
      }
      ctx.fillStyle = "#e6f3ff";
      ctx.globalAlpha = 0.9 * (1 - boom * 0.6);
      for (let i = 0; i < 6; i += 1) {
        const shardA = angle + (i - 2.5) * 0.42;
        const shardD = 8 + boom * 26;
        ctx.beginPath();
        ctx.arc(shot.tx + Math.cos(shardA) * shardD, shot.ty + Math.sin(shardA) * shardD, 2.2 - boom, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  } else if (shot.style === "arrow") {
    drawDartProjectile(projectileX, projectileY, angle, 21, "#fff1a6", "#6f5527");
  } else if (shot.style === "bullet") {
    if (lifeRatio > 0.78) {
      const snap = (lifeRatio - 0.78) / 0.22;
      ctx.strokeStyle = "#ffffff";
      ctx.globalAlpha = snap * 0.85;
      ctx.lineWidth = 2.4 + snap * 2.4;
      drawSimpleLine(shot.x, shot.y, shot.tx, shot.ty);
      ctx.globalAlpha = 1;
    }
    const tracer = ctx.createLinearGradient(shot.x, shot.y, projectileX, projectileY);
    tracer.addColorStop(0, "#b9c6d000");
    tracer.addColorStop(0.7, "#dfe9ef55");
    tracer.addColorStop(1, "#ffffffee");
    ctx.lineCap = "round";
    ctx.strokeStyle = tracer;
    ctx.lineWidth = 2.6;
    drawSimpleLine(shot.x, shot.y, projectileX, projectileY);

    ctx.strokeStyle = "#cfe2f288";
    ctx.lineWidth = 1;
    drawSimpleLine(projectileX - nx * 26 - px * 2.5, projectileY - ny * 26 - py * 2.5, projectileX - nx * 8 - px * 2.5, projectileY - ny * 8 - py * 2.5);
    drawSimpleLine(projectileX - nx * 26 + px * 2.5, projectileY - ny * 26 + py * 2.5, projectileX - nx * 8 + px * 2.5, projectileY - ny * 8 + py * 2.5);

    const bullGlow = ctx.createRadialGradient(projectileX, projectileY, 1, projectileX, projectileY, 10);
    bullGlow.addColorStop(0, "#ffffff");
    bullGlow.addColorStop(1, "#ffd77600");
    ctx.fillStyle = bullGlow;
    ctx.beginPath();
    ctx.arc(projectileX, projectileY, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff3c9";
    ctx.beginPath();
    ctx.ellipse(projectileX, projectileY, 9, 2.6, angle, 0, Math.PI * 2);
    ctx.fill();

    const smokeK = 1 - lifeRatio;
    ctx.fillStyle = "#aeb8bf";
    ctx.globalAlpha = 0.3 * lifeRatio;
    ctx.beginPath();
    ctx.arc(shot.x + nx * 9, shot.y + ny * 9 - smokeK * 7, 3 + smokeK * 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    const casX = shot.x - px * (6 + smokeK * 17);
    const casY = shot.y - py * (6 + smokeK * 17) - Math.sin(smokeK * Math.PI) * 11;
    ctx.save();
    ctx.translate(casX, casY);
    ctx.rotate(smokeK * 7);
    ctx.fillStyle = "#e1b84f";
    ctx.globalAlpha = Math.min(1, lifeRatio * 3);
    ctx.fillRect(-2.4, -1.2, 4.8, 2.4);
    ctx.restore();
    ctx.globalAlpha = 1;

    if (lifeRatio > 0.72) {
      const flash = (lifeRatio - 0.72) / 0.28;
      ctx.fillStyle = "#fff0b8";
      ctx.globalAlpha = flash;
      for (let i = 0; i < 4; i += 1) {
        const flashA = angle + (i - 1.5) * 0.42;
        ctx.beginPath();
        ctx.moveTo(shot.x, shot.y);
        ctx.lineTo(shot.x + Math.cos(flashA) * (10 + flash * 8), shot.y + Math.sin(flashA) * (10 + flash * 8));
        ctx.lineTo(shot.x + Math.cos(flashA + 0.16) * 5, shot.y + Math.sin(flashA + 0.16) * 5);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    if (lifeRatio < 0.35) {
      const hit = 1 - lifeRatio / 0.35;
      drawImpactRing(shot.tx, shot.ty, 8 + hit * 12, "#ffe8ab");
      ctx.strokeStyle = "#fff3c9";
      ctx.globalAlpha = 1 - hit * 0.5;
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 5; i += 1) {
        const sparkA = (i / 5) * Math.PI * 2 + 0.5;
        ctx.beginPath();
        ctx.moveTo(shot.tx + Math.cos(sparkA) * 3, shot.ty + Math.sin(sparkA) * 3);
        ctx.lineTo(shot.tx + Math.cos(sparkA) * (7 + hit * 8), shot.ty + Math.sin(sparkA) * (7 + hit * 8));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  } else if (shot.style === "ice") {
    ctx.strokeStyle = "#9bdcff99";
    ctx.lineWidth = 3;
    drawSimpleLine(projectileX - nx * 18, projectileY - ny * 18, projectileX, projectileY);
    ctx.fillStyle = "#e7fbff";
    drawDiamondProjectile(projectileX, projectileY, angle, 15, 7);
    if (lifeRatio < 0.35) drawImpactRing(shot.tx, shot.ty, 12 + (1 - lifeRatio) * 8, "#9bdcff");
  } else if (shot.style === "poison") {
    drawPoisonGlob(projectileX, projectileY, angle);
  } else if (shot.style === "fire") {
    const grad = ctx.createLinearGradient(tailX, tailY, projectileX, projectileY);
    grad.addColorStop(0, "#fff0a6");
    grad.addColorStop(0.45, "#ff9b42");
    grad.addColorStop(1, "#ec675d");
    ctx.strokeStyle = grad;
    ctx.lineWidth = 6;
    drawSimpleLine(projectileX - nx * 18, projectileY - ny * 18, projectileX, projectileY);
    ctx.fillStyle = "#ffbe5b";
    ctx.beginPath();
    ctx.arc(projectileX, projectileY, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ec675d";
    drawFlame(projectileX, projectileY);
  } else if (shot.style === "void") {
    ctx.shadowColor = "#7d6bff";
    ctx.shadowBlur = 18;
    ctx.strokeStyle = "#c9bfff";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(projectileX, projectileY, 16 + progress * 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "#7d6bffaa";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(projectileX, projectileY, 8 + (1 - lifeRatio) * 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#120f2f";
    ctx.beginPath();
    ctx.arc(projectileX, projectileY, 10 + (1 - lifeRatio) * 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#9b7dff";
    ctx.beginPath();
    ctx.arc(projectileX, projectileY, 4 + (1 - lifeRatio) * 3, 0, Math.PI * 2);
    ctx.fill();
    if (lifeRatio < 0.42) {
      drawImpactRing(shot.tx, shot.ty, shot.radius || 30, "#7d6bff");
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = "#7d6bff";
      ctx.beginPath();
      ctx.arc(shot.tx, shot.ty, (shot.radius || 30) * (1.08 - lifeRatio * 0.4), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  } else if (shot.style === "laser") {
    ctx.shadowColor = shot.color;
    ctx.shadowBlur = 13;
    ctx.fillStyle = shot.color;
    drawDiamondProjectile(projectileX, projectileY, angle, 18, 5);
    ctx.strokeStyle = "#ffffffaa";
    ctx.lineWidth = 2;
    drawSimpleLine(projectileX - nx * 16, projectileY - ny * 16, projectileX, projectileY);
  } else if (shot.style === "ranger") {
    drawDartProjectile(projectileX, projectileY, angle, 18, "#ffe28a", "#8a633c");
  } else if (shot.style === "soldier") {
    drawBulletProjectile(projectileX, projectileY, angle, 8, "#f1d49b");
    if (lifeRatio < 0.35) drawImpactRing(shot.tx, shot.ty, 6 + (1 - lifeRatio) * 5, "#f1d49b");
  } else if (shot.style === "melee") {
    const hitX = (shot.x + shot.tx) / 2;
    const hitY = (shot.y + shot.ty) / 2;
    ctx.strokeStyle = "#d4c2a2cc";
    ctx.fillStyle = "#7a5f4088";
    ctx.lineWidth = 3;
    drawImpactRing(hitX, hitY, shot.radius || 16, "#d4c2a2");
    ctx.beginPath();
    ctx.ellipse(hitX, hitY + 5, 13, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 5; i += 1) {
      const angle = i * 1.25 + lifeRatio;
      ctx.beginPath();
      ctx.moveTo(hitX, hitY);
      ctx.lineTo(hitX + Math.cos(angle) * 14, hitY + Math.sin(angle) * 9);
      ctx.stroke();
    }
  } else {
    drawSimpleLine(shot.x, shot.y, shot.tx, shot.ty);
  }

  if (shot.radius && lifeRatio < 0.35 && !["coinPulse", "spawn", "melee", "void"].includes(shot.style)) {
    drawImpactRing(shot.tx, shot.ty, shot.radius, shot.color);
  }
  ctx.restore();
}

function drawSimpleLine(x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawJaggedLine(x1, y1, x2, y2, segments, wobble) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  const px = -dy / length;
  const py = dx / length;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  for (let i = 1; i < segments; i += 1) {
    const t = i / segments;
    const offset = (i % 2 === 0 ? -1 : 1) * wobble * (0.55 + ((i * 17) % 5) / 10);
    ctx.lineTo(x1 + dx * t + px * offset, y1 + dy * t + py * offset);
  }
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawArrowHead(x, y, angle, size) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - Math.cos(angle - 0.45) * size, y - Math.sin(angle - 0.45) * size);
  ctx.lineTo(x - Math.cos(angle) * size * 0.45, y - Math.sin(angle) * size * 0.45);
  ctx.lineTo(x - Math.cos(angle + 0.45) * size, y - Math.sin(angle + 0.45) * size);
  ctx.closePath();
  ctx.fill();
}

function drawDartProjectile(x, y, angle, length, tipColor, shaftColor) {
  const nx = Math.cos(angle);
  const ny = Math.sin(angle);
  const px = -ny;
  const py = nx;
  const tip = { x, y };
  const tail = { x: x - nx * length, y: y - ny * length };
  const headBack = { x: x - nx * 7, y: y - ny * 7 };

  ctx.fillStyle = tipColor;
  ctx.strokeStyle = "#15100a";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(headBack.x + px * 4.5, headBack.y + py * 4.5);
  ctx.lineTo(headBack.x - px * 4.5, headBack.y - py * 4.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = shaftColor;
  ctx.lineWidth = 3;
  drawSimpleLine(headBack.x, headBack.y, tail.x, tail.y);

  ctx.fillStyle = "#d85d46";
  ctx.beginPath();
  ctx.moveTo(tail.x, tail.y);
  ctx.lineTo(tail.x - nx * 5 + px * 4, tail.y - ny * 5 + py * 4);
  ctx.lineTo(tail.x + nx * 3, tail.y + ny * 3);
  ctx.lineTo(tail.x - nx * 5 - px * 4, tail.y - ny * 5 - py * 4);
  ctx.closePath();
  ctx.fill();
}

function drawBulletProjectile(x, y, angle, length, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.strokeStyle = "#111417";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.roundRect(-length * 0.8, -2.4, length, 4.8, 2.4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#fff6c2";
  ctx.beginPath();
  ctx.ellipse(length * 0.22, 0, 3.2, 2.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPoisonGlob(x, y, angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = "#90ff76";
  ctx.strokeStyle = "#163d19";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(0, 0, 9, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#d8ffd0aa";
  ctx.beginPath();
  ctx.arc(-2, -2, 2.2, 0, Math.PI * 2);
  ctx.arc(4, 1, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawDiamondProjectile(x, y, angle, length, width) {
  const nx = Math.cos(angle);
  const ny = Math.sin(angle);
  const px = -ny;
  const py = nx;
  ctx.beginPath();
  ctx.moveTo(x + nx * length, y + ny * length);
  ctx.lineTo(x + px * width, y + py * width);
  ctx.lineTo(x - nx * length * 0.7, y - ny * length * 0.7);
  ctx.lineTo(x - px * width, y - py * width);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawImpactRing(x, y, radius, color) {
  ctx.save();
  ctx.strokeStyle = `${color}99`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function placeOrSelect(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * canvas.width;
  const y = ((clientY - rect.top) / rect.height) * canvas.height;
  if (isPointOnCodeNote(x, y)) {
    resetSellConfirmation();
    state.selectedPlaced = null;
    state.selectedTowerType = null;
    state.previewX = null;
    state.previewY = null;
    updateHud();
    openCodeNote();
    return;
  }
  const existing = state.placed.find((tower) => Math.hypot(tower.x - x, tower.y - y) < 25);
  if (existing) {
    if (state.selectedPlaced !== existing) resetSellConfirmation();
    if (isMultiplayerGame() && existing.ownerId !== multiplayer.socket.id) {
      resetSellConfirmation();
      state.selectedPlaced = null;
      state.selectedTowerType = null;
      toast(`${towerOwnerName(existing.ownerId)} owns that tower`);
      updateHud();
      return;
    }
    state.selectedPlaced = existing;
    state.selectedTowerType = null;
    state.previewX = null;
    state.previewY = null;
    renderBattleLoadout();
    updateHud();
    return;
  }
  if (!state.selectedTowerType) {
    resetSellConfirmation();
    state.selectedPlaced = null;
    updateHud();
    return;
  }
  const tower = towerById(state.selectedTowerType);
  if (state.coins < tower.cost) {
    sound.error();
    return toast("Not enough coins");
  }
  const ownTowers = ownPlacedTowers();
  const limitStatus = towerTypeLimitStatus(tower.id, ownTowers);
  if (!limitStatus.ok) {
    sound.error();
    return toast(limitStatus.message);
  }
  if (ownTowers.length >= towerLimit()) {
    sound.error();
    return toast(`Tower limit reached (${towerLimit()})`);
  }
  const placement = placementStatus(x, y);
  if (!placement.ok) {
    sound.error();
    return toast(placement.message);
  }
  if (isMultiplayerGame()) {
    resetSellConfirmation();
    multiplayer.socket.emit("tower:place", { type: tower.id, x, y });
    return;
  }
  state.coins -= tower.cost;
  state.placed.push({ ...tower, x, y, level: 1, cooldown: 0 });
  sound.place();
  state.selectedTowerType = null;
  resetSellConfirmation();
  state.previewX = null;
  state.previewY = null;
  renderBattleLoadout();
  updateHud();
}

function updatePlacementPreview(clientX, clientY) {
  if (!state.selectedTowerType || state.screen !== "game") {
    state.previewX = null;
    state.previewY = null;
    state.previewPlaceKey = "";
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const nextX = ((clientX - rect.left) / rect.width) * canvas.width;
  const nextY = ((clientY - rect.top) / rect.height) * canvas.height;
  const key = `${state.selectedTowerType}:${nextX}:${nextY}:${state.placed.length}`;
  state.previewX = nextX;
  state.previewY = nextY;
  if (key === state.previewPlaceKey) return;
  state.previewPlaceKey = key;
  state.previewPlaceable = canPlaceTower(nextX, nextY);
}

function towerOverlaps(x, y, towerId = state.selectedTowerType) {
  const ring = towerSelectionRing(towerId);
  return state.placed.some((placed) => {
    // Keep the existing minimum spacing, including for towers directly above/below.
    if (Math.hypot(placed.x - x, placed.y - y) < 38) return true;
    const other = towerSelectionRing(placed.id);
    const dx = x + ring.x - placed.x - other.x;
    const dy = y + ring.y - placed.y - other.y;
    // Use the larger pedestal for both envelopes so even differently-sized
    // ellipses cannot intersect diagonally. Drawing and placement share the data.
    const width = 2 * Math.max(ring.radiusX, other.radiusX) + TOWER_BASE_CLEARANCE;
    const height = 2 * Math.max(ring.radiusY, other.radiusY) + TOWER_BASE_CLEARANCE;
    return (dx / width) ** 2 + (dy / height) ** 2 < 1;
  });
}

function canPlaceTower(x, y) {
  const tower = towerById(state.selectedTowerType);
  if (tower && !towerTypeLimitStatus(tower.id, ownPlacedTowers()).ok) return false;
  return placementStatus(x, y).ok;
}

function towerTypeLimitStatus(towerId, placedTowers = ownPlacedTowers()) {
  const limit = TOWER_PLACEMENT_LIMITS[towerId];
  if (!limit) return { ok: true, message: "" };
  const count = placedTowers.filter((tower) => tower.id === towerId).length;
  if (count < limit) return { ok: true, message: "" };
  const tower = towerById(towerId);
  return { ok: false, message: `${tower?.name || "Tower"} limit reached (${limit})` };
}

function placementStatus(x, y) {
  if (towerOverlaps(x, y)) return { ok: false, message: "Leave space between towers' white base circles" };
  const distance = distanceToRoads(x, y);
  if (distance < 46) return { ok: false, message: "Cannot place on roads" };
  return { ok: true, message: "" };
}

function featureOverlaps(x, y) {
  return (state.currentLevel.features || []).some((f) => {
    if (f.kind === "volcano") return pointNearVolcanoFeature(x, y, f, 18);
    return false;
  });
}

function backgroundObstacleOverlaps(x, y) {
  return (state.currentLevel.backgroundBlockers || []).some((blocker) => {
    const nx = (x - blocker.x) / (blocker.rx + 18);
    const ny = (y - blocker.y) / (blocker.ry + 18);
    return nx * nx + ny * ny <= 1;
  });
}

function distanceToRoads(x, y) {
  return distanceToPathList(x, y, state.currentLevel.paths);
}

function distanceToPathList(x, y, paths) {
  let best = Infinity;
  for (const path of paths) {
    for (let i = 1; i < path.length; i += 1) {
      best = Math.min(best, distanceToSegment(x, y, path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]));
    }
  }
  return best;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq)) : 0;
  const x = ax + t * dx;
  const y = ay + t * dy;
  return Math.hypot(px - x, py - y);
}

function upgradeCost(tower) {
  const cost = tower.cost * (1.05 + tower.level * 0.9);
  if (tower.id === "barracks") return Math.floor(cost * 1.12);
  return Math.floor(tower.id === "bank" ? cost * 1.22 : cost);
}

function sellValue(tower) {
  return Math.floor(tower.cost * (0.48 + tower.level * 0.2));
}

function upgradeSelected() {
  const tower = state.selectedPlaced;
  if (!tower) return toast("Select a tower first");
  if (!state.placed.includes(tower)) {
    state.selectedPlaced = null;
    updateHud();
    return toast("Select a tower first");
  }
  resetSellConfirmation();
  const cost = upgradeCost(tower);
  if (isMultiplayerGame()) {
    if (tower.ownerId !== multiplayer.socket.id) return toast("You can only upgrade your towers");
    if (tower.level >= MAX_TOWER_LEVEL) return toast("Tower is max level");
    if (state.coins < cost) {
      sound.error();
      return toast(`Need ${Math.ceil(cost - state.coins)} more coins`);
    }
    multiplayer.socket.emit("tower:upgrade", { uid: tower.uid });
    return;
  }
  if (tower.level >= MAX_TOWER_LEVEL) return toast("Tower is max level");
  if (state.coins < cost) {
    sound.error();
    return toast(`Need ${Math.ceil(cost - state.coins)} more coins`);
  }
  state.coins -= cost;
  tower.level += 1;
  sound.upgrade();
  toast(`${tower.name} upgraded to L${tower.level}`, "upgrade");
  updateHud();
}

function sellSelected() {
  const tower = state.selectedPlaced;
  if (!tower) return toast("Select a tower first");
  if (state.sellConfirmTower !== tower) {
    state.sellConfirmTower = tower;
    updateHud();
    toast("Click Sell again to confirm");
    clearTimeout(resetSellConfirmation.timer);
    resetSellConfirmation.timer = setTimeout(() => {
      if (state.sellConfirmTower === tower) {
        resetSellConfirmation();
        updateHud();
      }
    }, SELL_CONFIRM_MS);
    return;
  }
  resetSellConfirmation();
  if (isMultiplayerGame()) {
    if (tower.ownerId !== multiplayer.socket.id) return toast("You can only sell your towers");
    multiplayer.socket.emit("tower:sell", { uid: tower.uid });
    return;
  }
  state.coins += sellValue(tower);
  state.placed = state.placed.filter((placed) => placed !== tower);
  state.soldiers = state.soldiers.filter((soldier) => soldier.owner !== tower);
  state.selectedPlaced = null;
  sound.sell();
  updateHud();
}

function winLevel() {
  if (state.levelEnded) return;
  state.levelEnded = true;
  const stars = state.baseHp >= state.currentLevel.baseHp
    ? 3
    : state.baseHp >= Math.ceil(state.currentLevel.baseHp * 0.5) ? 2 : 1;
  const rewardScale = stars === 3 ? 1 : stars === 2 ? 0.8 : 0.6;
  const gems = Math.max(1, Math.round(state.currentLevel.rewardGems * rewardScale));
  const coins = Math.max(1, Math.round(state.currentLevel.rewardGems * 12 * rewardScale));
  const xp = Math.max(1, Math.round(state.currentLevel.rewardXp * rewardScale)) + state.earnedXp;
  state.gems += gems;
  state.metaCoins += coins;
  state.clearedStages.add(state.currentLevel.id);
  state.stageStars[state.currentLevel.id] = Math.max(Number(state.stageStars[state.currentLevel.id]) || 0, stars);
  addXp(xp);
  save();
  state.runningWave = false;
  state.pendingWaveStart = false;
  state.awaitingRemoteWave = false;
  state.spawns = [];
  state.mobs = [];
  sound.result(true);
  endMultiplayerRoom("won");
  showResult("Won", gems, xp, coins, stars);
}

function loseLevel() {
  if (state.levelEnded) return;
  state.levelEnded = true;
  const waveProgress = state.currentLevel ? state.wave / state.currentLevel.waves : 0;
  const gems = Math.max(1, Math.floor(state.earnedGems * 0.45 + waveProgress * state.currentLevel.rewardGems * 0.12));
  const coins = Math.max(10, Math.floor(waveProgress * state.currentLevel.rewardGems * 7));
  const xp = Math.max(10, Math.floor(state.earnedXp * 0.55 + waveProgress * state.currentLevel.rewardXp * 0.18));
  state.gems += gems;
  state.metaCoins += coins;
  addXp(xp);
  save();
  state.runningWave = false;
  state.pendingWaveStart = false;
  state.awaitingRemoteWave = false;
  state.spawns = [];
  state.mobs = [];
  sound.result(false);
  endMultiplayerRoom("lost");
  showResult("Lost", gems, xp, coins);
}

function showResult(result, gems, xp, coins = 0, stars = 0) {
  els.resultTitle.textContent = result;
  els.resultGems.textContent = gems;
  els.resultXp.textContent = xp;
  if (els.resultCoins) els.resultCoins.textContent = coins;
  const resultStars = document.querySelector("#resultStars");
  if (resultStars) {
    resultStars.hidden = result.toLowerCase() !== "won";
    resultStars.setAttribute("aria-label", `${stars} of 3 stars earned`);
    resultStars.innerHTML = [1, 2, 3]
      .map((star) => `<span class="${star <= stars ? "earned" : ""}" style="--star-delay:${(star - 1) * 0.16}s">★</span>`)
      .join("");
  }
  els.resultCountdown.textContent = "5";
  els.resultModal.querySelector(".result-card").className = `result-card panel ${result.toLowerCase()}`;
  els.resultModal.classList.add("open");
  let secondsLeft = 5;
  const countdown = setInterval(() => {
    secondsLeft -= 1;
    els.resultCountdown.textContent = Math.max(0, secondsLeft);
    if (secondsLeft <= 0) clearInterval(countdown);
  }, 1000);
  setTimeout(() => {
    clearInterval(countdown);
    els.resultModal.classList.remove("open");
    switchScreen("home");
    renderHome();
  }, 5000);
}

function stepGame(dt) {
  if (state.screen === "game") {
    let remaining = Math.min(MAX_CATCHUP_SECONDS, Math.max(0, dt));
    while (remaining > 0) {
      const step = Math.min(MAX_SIM_STEP, remaining);
      update(step * (state.gameSpeed || 1));
      remaining -= step;
    }
    draw();
    updateSupportHum();
  } else {
    sound.supportHum(false, false);
  }
}

function tick(now = performance.now()) {
  const dt = state.lastTime ? (now - state.lastTime) / 1000 : 0;
  state.lastTime = now;
  stepGame(dt);
}

function loop(time) {
  tick(time);
  requestAnimationFrame(loop);
}

setInterval(() => {
  if (document.hidden) tick(performance.now());
}, 250);

document.addEventListener("click", (event) => {
  music.unlock();
  if (event.target.closest("button")) sound.click();
});

els.startWave.onclick = beginWave;
if (els.speedToggle) {
  els.speedToggle.onclick = () => {
    state.gameSpeed = state.gameSpeed === 2 ? 1 : 2;
    els.speedToggle.textContent = `Speed: x${state.gameSpeed}`;
  };
}
els.backHome.onclick = () => {
  if (isMultiplayerGame() || multiplayer.room) {
    leaveMultiplayerRoom();
    return;
  }
  multiplayer.active = false;
  switchScreen("home");
  renderHome();
};
els.openLevels.onclick = () => openModal(els.modeModal);
els.closeMode.onclick = () => closeModal(els.modeModal);
els.soloMode.onclick = openSoloLevels;
els.multiplayerMode.onclick = openMultiplayerLobby;
els.closeLevels.onclick = () => {
  multiplayer.choosingMap = false;
  closeModal(els.levelModal);
};
els.closeMultiplayer.onclick = () => closeModal(els.multiplayerModal);
els.openSettings.onclick = openSettings;
els.closeSettings.onclick = () => closeModal(els.settingsModal);
els.toggleSfx.onclick = toggleSoundEffects;
els.toggleMusic.onclick = toggleMusicSetting;
els.codeButton.onclick = openCodeRedeem;
els.closeCode.onclick = () => closeModal(els.codeModal);
els.codeForm.addEventListener("submit", redeemCode);
if (els.closeCodeNote) els.closeCodeNote.onclick = () => closeModal(els.codeNoteModal);
els.openInventory.onclick = () => openModal(els.inventoryModal);
els.closeInventory.onclick = () => closeModal(els.inventoryModal);
els.openMobIndex.onclick = () => {
  renderMobIndex();
  openModal(els.mobIndexModal);
};
els.closeMobIndex.onclick = () => closeModal(els.mobIndexModal);
els.openDailyRewards.onclick = () => {
  renderDailyRewards();
  openModal(els.dailyRewardsModal);
  startDailyCountdown();
};
els.closeDailyRewards.onclick = () => {
  stopDailyCountdown();
  closeModal(els.dailyRewardsModal);
};
els.claimDailyReward.onclick = claimDailyReward;
els.openExchange.onclick = () => {
  if (els.exchangeAmount) els.exchangeAmount.value = 0;
  renderExchange();
  openModal(els.exchangeModal);
};
els.closeExchange.onclick = () => closeModal(els.exchangeModal);
els.exchangeGemsToCoins.onclick = () => setExchangeDirection("gemsToCoins");
els.exchangeCoinsToGems.onclick = () => setExchangeDirection("coinsToGems");
let exchangeBackdropPressed = false;
let suppressExchangeBackdropClose = false;
let exchangeSliderDragging = false;
function blockExchangeBackdropClose() {
  suppressExchangeBackdropClose = true;
  setTimeout(() => {
    suppressExchangeBackdropClose = false;
  }, 250);
}
els.exchangeAmount.addEventListener("pointerdown", () => {
  exchangeBackdropPressed = false;
  exchangeSliderDragging = true;
  blockExchangeBackdropClose();
});
els.exchangeAmount.addEventListener("mousedown", () => {
  exchangeBackdropPressed = false;
  exchangeSliderDragging = true;
  blockExchangeBackdropClose();
});
els.exchangeAmount.addEventListener("touchstart", () => {
  exchangeBackdropPressed = false;
  exchangeSliderDragging = true;
  blockExchangeBackdropClose();
}, { passive: true });
document.addEventListener("pointerup", () => {
  if (!exchangeSliderDragging) return;
  exchangeSliderDragging = false;
  exchangeBackdropPressed = false;
  blockExchangeBackdropClose();
});
document.addEventListener("mouseup", () => {
  if (!exchangeSliderDragging) return;
  exchangeSliderDragging = false;
  exchangeBackdropPressed = false;
  blockExchangeBackdropClose();
});
document.addEventListener("touchend", () => {
  if (!exchangeSliderDragging) return;
  exchangeSliderDragging = false;
  exchangeBackdropPressed = false;
  blockExchangeBackdropClose();
});
els.exchangeAmount.addEventListener("input", renderExchange);
els.confirmExchange.onclick = exchangeCurrency;
els.showLogin.onclick = () => openAuth("login");
els.showSignup.onclick = () => openAuth("signup");
els.closeAuth.onclick = () => closeModal(els.authModal);
els.submitAuth.addEventListener("click", submitAuth);
els.authPassword.addEventListener("keydown", (event) => {
  if (event.key === "Enter") submitAuth(event);
});
els.authModal.addEventListener("click", (event) => {
  if (event.target === els.authModal) closeModal(els.authModal);
});
els.createRoom.onclick = createMultiplayerRoom;
els.joinRoomForm.addEventListener("submit", joinMultiplayerRoom);
els.chooseMultiplayerMap.onclick = openMultiplayerMapPicker;
els.leaveRoom.onclick = leaveMultiplayerRoom;
els.leaveMatch.onclick = leaveMultiplayerRoom;
els.modeModal.addEventListener("click", (event) => {
  if (event.target === els.modeModal) closeModal(els.modeModal);
});
els.levelModal.addEventListener("click", (event) => {
  if (event.target === els.levelModal) {
    multiplayer.choosingMap = false;
    closeModal(els.levelModal);
  }
});
els.multiplayerModal.addEventListener("click", (event) => {
  if (event.target === els.multiplayerModal) closeModal(els.multiplayerModal);
});
els.settingsModal.addEventListener("click", (event) => {
  if (event.target === els.settingsModal) closeModal(els.settingsModal);
});
els.codeModal.addEventListener("click", (event) => {
  if (event.target === els.codeModal) closeModal(els.codeModal);
});
els.codeNoteModal.addEventListener("click", (event) => {
  if (event.target === els.codeNoteModal) closeModal(els.codeNoteModal);
});
els.inventoryModal.addEventListener("click", (event) => {
  if (event.target === els.inventoryModal) closeModal(els.inventoryModal);
});
els.mobIndexModal.addEventListener("click", (event) => {
  if (event.target === els.mobIndexModal) closeModal(els.mobIndexModal);
});
els.exchangeModal.addEventListener("pointerdown", (event) => {
  exchangeBackdropPressed = event.target === els.exchangeModal;
});
els.exchangeModal.addEventListener("click", (event) => {
  if (event.target === els.exchangeModal && exchangeBackdropPressed && !suppressExchangeBackdropClose) {
    closeModal(els.exchangeModal);
  }
  exchangeBackdropPressed = false;
});
els.dailyRewardsModal.addEventListener("click", (event) => {
  if (event.target === els.dailyRewardsModal) {
    stopDailyCountdown();
    closeModal(els.dailyRewardsModal);
  }
});
els.upgradeTower.onclick = upgradeSelected;
els.sellTower.onclick = sellSelected;
canvas.addEventListener("click", (event) => placeOrSelect(event.clientX, event.clientY));
canvas.addEventListener("mousemove", (event) => updatePlacementPreview(event.clientX, event.clientY));
canvas.addEventListener("mouseleave", () => {
  state.previewX = null;
  state.previewY = null;
});

function setupBattlefieldLayout() {
  const viewport = document.querySelector(".battle-viewport");
  const map = document.querySelector(".battle-map");
  const fitMap = () => {
    // One shared scale preserves the original 1000x650 world in both axes.
    // Resize the actual canvas element, not object-fit, so pointer coordinates
    // still map directly to its visible content without letterbox offsets.
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    if (!width || !height) return;
    const scale = Math.min(width / canvas.width, height / canvas.height);
    map.style.width = `${canvas.width * scale}px`;
    map.style.height = `${canvas.height * scale}px`;
    const bounds = canvas.getBoundingClientRect();
    document.body.style.setProperty("--battle-map-width", `${bounds.width}px`);
    document.body.style.setProperty("--battle-map-center", `${bounds.left + bounds.width / 2}px`);
    document.body.style.setProperty("--battle-map-bottom-gap", `${Math.max(0, innerHeight - bounds.bottom)}px`);
  };
  const observer = new ResizeObserver(fitMap);
  observer.observe(viewport);
  window.addEventListener("resize", fitMap);
  fitMap();
}

setupBattlefieldLayout();
load();
preloadMobArt();
preloadTowerUiImages();
preloadStageBackgrounds();
setupMultiplayer();
renderSettings();
showAuthGate();
if (STATIC_HOSTING) {
  showHomeAfterAuth("Player", null, null);
} else {
  resumeAccountSession();
}
requestAnimationFrame(loop);
