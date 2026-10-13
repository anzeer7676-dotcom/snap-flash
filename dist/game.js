(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  const levelEl = $("#level");
  const livesEl = $("#lives");
  const scoreEl = $("#score");
  const promptEl = $("#prompt");
  const promptIcon = $("#prompt-icon");
  const timerFill = $("#timer-fill");
  const optionsEl = $("#options");
  const comboEl = $("#combo");
  const popupsEl = $("#popups");
  const playArea = $("#play-area");
  const startScreen = $("#start-screen");
  const startBtn = $("#start");
  const bestStart = $("#best-start");
  const resultScreen = $("#result");
  const finalScoreEl = $("#final-score");
  const bestResultEl = $("#best-result");
  const maxComboEl = $("#max-combo");
  const accuracyEl = $("#accuracy");
  const restartBtn = $("#restart");
  const muteBtn = $("#mute");

  const BEST_KEY = "snapflash-best";
  const MUTE_KEY = "snapflash-muted";
  const START_LIVES = 3;
  const LEVEL_STEP = 5;

  const COLORS = {
    红: "#FF4D4D",
    蓝: "#2D6BFF",
    黄: "#FFC61A",
    绿: "#17C37B",
    紫: "#A45CFF",
    橙: "#FF8A3D",
    粉: "#FF5CA8",
    青: "#16C7D6",
  };
  const BASIC_COLORS = ["红", "蓝", "黄", "绿"];
  const ALL_COLORS = Object.keys(COLORS);

  const SHAPES = {
    圆: "circle",
    方: "square",
    三角: "triangle",
    菱: "diamond",
    星: "star",
    六边: "hex",
  };
  const BASIC_SHAPES = ["圆", "方", "三角"];
  const ALL_SHAPES = Object.keys(SHAPES);

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const state = {
    running: false,
    score: 0,
    lives: START_LIVES,
    level: 1,
    combo: 0,
    maxCombo: 0,
    correct: 0,
    total: 0,
    best: readNumber(BEST_KEY),
    muted: readBool(MUTE_KEY),
    raf: 0,
    roundStart: 0,
    roundDuration: 0,
    round: null,
    lastType: "",
    transition: 0,
    audio: null,
  };

  // ---------- storage ----------
  function readNumber(key) {
    try {
      return Math.max(0, parseInt(localStorage.getItem(key), 10) || 0);
    } catch {
      return 0;
    }
  }

  function readBool(key) {
    try {
      return localStorage.getItem(key) === "true";
    } catch {
      return false;
    }
  }

  function store(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      // Storage is optional; the game still works without it.
    }
  }

  // ---------- helpers ----------
  const randInt = (n) => Math.floor(Math.random() * n);
  const pick = (arr) => arr[randInt(arr.length)];

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function difficulty(level) {
    const optionCount = level <= 2 ? 3 : level <= 4 ? 4 : level <= 6 ? 5 : 6;
    const duration = Math.max(0.85, 2.35 - (level - 1) * 0.16);
    return { optionCount, duration };
  }

  // ---------- round generation ----------
  function makeColorRound(level, n) {
    const pool = shuffle((level >= 3 ? ALL_COLORS : BASIC_COLORS).slice());
    const names = pool.slice(0, Math.min(n, pool.length));
    const target = names[0];
    const options = names.map((name) => ({ kind: "swatch", color: COLORS[name], name }));
    shuffle(options);
    const correctIndex = options.findIndex((o) => o.name === target);
    let ink = null;
    if (level >= 4 && Math.random() < 0.55) {
      const decoys = names.filter((nm) => nm !== target);
      if (decoys.length) ink = COLORS[pick(decoys)];
    }
    return { type: "color", prompt: `点出${target}色`, iconShape: null, options, correctIndex, ink };
  }

  function makeNumberRound(level, n) {
    const wantMax = Math.random() < 0.5;
    const spread = level <= 2 ? 18 : level <= 4 ? 8 : 3;
    const base = 5 + randInt(45);
    const set = new Set([base]);
    let guard = 0;
    while (set.size < n && guard++ < 200) set.add(base + randInt(spread * 2 + 1) - spread);
    const arr = shuffle([...set]);
    const target = wantMax ? Math.max(...arr) : Math.min(...arr);
    const options = arr.map((v) => ({ kind: "text", text: String(v) }));
    return {
      type: "number",
      prompt: wantMax ? "点出最大的数" : "点出最小的数",
      iconShape: null,
      options,
      correctIndex: arr.indexOf(target),
      ink: null,
    };
  }

  function makeOddRound(level, n) {
    const pool = shuffle((level >= 3 ? ALL_COLORS : BASIC_COLORS).slice());
    const same = pool[0];
    const diff = pool[1] || pool[0];
    const oddIndex = randInt(n);
    const options = Array.from({ length: n }, (_, i) => ({
      kind: "swatch",
      color: COLORS[i === oddIndex ? diff : same],
    }));
    return { type: "odd", prompt: "点出不同的那个", iconShape: null, options, correctIndex: oddIndex, ink: null };
  }

  function makeShapeRound(level, n) {
    const pool = shuffle((level >= 3 ? ALL_SHAPES : BASIC_SHAPES).slice());
    const target = pool[0];
    const others = pool.slice(1);
    const shapes = [target];
    for (let i = 1; i < n; i++) shapes.push(pick(others));
    shuffle(shapes);
    const options = shapes.map((shape) => ({ kind: "shape", shape }));
    return {
      type: "shape",
      prompt: "点出这个形状",
      iconShape: target,
      options,
      correctIndex: shapes.indexOf(target),
      ink: null,
    };
  }

  const MAKERS = [makeColorRound, makeNumberRound, makeOddRound, makeShapeRound];

  function buildRound() {
    const { optionCount } = difficulty(state.level);
    let round;
    let tries = 0;
    do {
      round = pick(MAKERS)(state.level, optionCount);
    } while (round.type === state.lastType && tries++ < 3);
    state.lastType = round.type;
    return round;
  }

  // ---------- rendering ----------
  function renderRound() {
    const r = state.round;
    promptEl.textContent = r.prompt;
    promptEl.style.color = r.ink || "";

    if (r.iconShape) {
      promptIcon.hidden = false;
      promptIcon.className = `prompt-icon shape shape-${SHAPES[r.iconShape]}`;
    } else {
      promptIcon.hidden = true;
      promptIcon.className = "prompt-icon";
    }

    optionsEl.dataset.count = String(r.options.length);
    optionsEl.innerHTML = "";
    r.options.forEach((opt, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tile";
      btn.dataset.index = String(i);
      if (opt.kind === "swatch") {
        btn.classList.add("tile-swatch");
        btn.style.setProperty("--c", opt.color);
      } else if (opt.kind === "text") {
        btn.classList.add("tile-text");
        btn.textContent = opt.text;
      } else {
        btn.classList.add("tile-shape");
        const shape = document.createElement("span");
        shape.className = `shape shape-${SHAPES[opt.shape]}`;
        btn.appendChild(shape);
      }
      btn.addEventListener("click", () => resolve(i));
      optionsEl.appendChild(btn);
    });
  }

  function comboMult() {
    return 1 + Math.min(Math.max(state.combo - 1, 0), 9) * 0.1;
  }

  function renderLives() {
    livesEl.innerHTML = "";
    for (let i = 0; i < START_LIVES; i++) {
      const dot = document.createElement("i");
      if (i >= state.lives) dot.classList.add("lost");
      livesEl.appendChild(dot);
    }
  }

  function updateHUD() {
    levelEl.textContent = String(state.level);
    scoreEl.textContent = String(state.score);
    renderLives();
    if (state.combo >= 2) {
      comboEl.hidden = false;
      comboEl.textContent = `${state.combo} 连击 ×${comboMult().toFixed(1)}`;
    } else {
      comboEl.hidden = true;
    }
  }

  // ---------- timing ----------
  function startTimer() {
    state.running = true;
    state.roundStart = performance.now();
    cancelAnimationFrame(state.raf);
    state.raf = requestAnimationFrame(tick);
  }

  function tick() {
    if (!state.running) return;
    const frac = 1 - (performance.now() - state.roundStart) / 1000 / state.roundDuration;
    if (frac <= 0) {
      timerFill.style.width = "0%";
      timerFill.classList.add("low");
      resolve(-1);
      return;
    }
    timerFill.style.width = `${(frac * 100).toFixed(1)}%`;
    timerFill.classList.toggle("low", frac < 0.32);
    state.raf = requestAnimationFrame(tick);
  }

  function nextRound() {
    state.roundDuration = difficulty(state.level).duration;
    state.round = buildRound();
    timerFill.classList.remove("low");
    renderRound();
    startTimer();
  }

  function schedule(delay, fn) {
    const token = ++state.transition;
    setTimeout(() => {
      if (token !== state.transition) return;
      fn();
    }, delay);
  }

  // ---------- judging ----------
  function resolve(index) {
    if (!state.running) return;
    state.running = false;
    cancelAnimationFrame(state.raf);
    state.raf = 0;

    const r = state.round;
    state.total++;

    if (index === r.correctIndex) {
      state.correct++;
      state.combo++;
      state.maxCombo = Math.max(state.maxCombo, state.combo);
      const remain = Math.max(0, 1 - (performance.now() - state.roundStart) / 1000 / state.roundDuration);
      const pts = Math.round((100 + Math.round(150 * remain)) * comboMult());
      state.score += pts;
      flash(index, "good");
      popupScore(index, `+${pts}`);
      updateHUD();
      sfxCorrect();
      if (state.correct % LEVEL_STEP === 0) {
        state.level++;
        popupCenter(`LEVEL ${state.level}`, "level");
        sfxLevel();
      }
      schedule(240, nextRound);
    } else {
      state.combo = 0;
      state.lives--;
      if (index >= 0) flash(index, "bad");
      if (r.correctIndex >= 0) flash(r.correctIndex, "reveal");
      updateHUD();
      sfxWrong();
      shake();
      if (state.lives <= 0) schedule(760, gameOver);
      else schedule(720, nextRound);
    }
  }

  function flash(index, cls) {
    const tile = optionsEl.querySelector(`[data-index="${index}"]`);
    if (tile) tile.classList.add(cls);
  }

  function popupScore(index, text) {
    const tile = optionsEl.querySelector(`[data-index="${index}"]`);
    if (!tile) return;
    const area = playArea.getBoundingClientRect();
    const rect = tile.getBoundingClientRect();
    spawnPop(text, "", rect.left - area.left + rect.width / 2, rect.top - area.top + rect.height / 2);
  }

  function popupCenter(text, cls) {
    const area = playArea.getBoundingClientRect();
    spawnPop(text, cls, area.width / 2, area.height / 2);
  }

  function spawnPop(text, cls, x, y) {
    const p = document.createElement("span");
    p.className = cls ? `pop ${cls}` : "pop";
    p.textContent = text;
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    popupsEl.appendChild(p);
    setTimeout(() => p.remove(), 800);
  }

  function shake() {
    if (reducedMotion) return;
    playArea.classList.remove("shake");
    void playArea.offsetWidth;
    playArea.classList.add("shake");
  }

  // ---------- audio ----------
  function audioContext() {
    if (state.muted) return null;
    try {
      if (!state.audio) state.audio = new (window.AudioContext || window.webkitAudioContext)();
      if (state.audio.state === "suspended") state.audio.resume();
      return state.audio;
    } catch {
      return null;
    }
  }

  function tone(freq, start, dur, type, vol) {
    const ac = audioContext();
    if (!ac) return;
    const t0 = ac.currentTime + start;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function sfxCorrect() {
    const base = 520 + Math.min(state.combo, 10) * 40;
    tone(base, 0, 0.09, "triangle", 0.09);
    tone(base * 1.5, 0.06, 0.12, "triangle", 0.07);
  }

  function sfxWrong() {
    tone(180, 0, 0.18, "sawtooth", 0.1);
    tone(120, 0.06, 0.22, "sawtooth", 0.09);
  }

  function sfxLevel() {
    [660, 880, 1170].forEach((f, i) => tone(f, i * 0.07, 0.14, "square", 0.06));
  }

  function sfxOver() {
    [400, 320, 240, 160].forEach((f, i) => tone(f, i * 0.12, 0.22, "square", 0.08));
  }

  // ---------- flow ----------
  function startGame() {
    state.transition++;
    state.score = 0;
    state.lives = START_LIVES;
    state.level = 1;
    state.combo = 0;
    state.maxCombo = 0;
    state.correct = 0;
    state.total = 0;
    state.lastType = "";

    startScreen.hidden = true;
    resultScreen.hidden = true;
    optionsEl.innerHTML = "";
    popupsEl.innerHTML = "";
    promptEl.style.color = "";
    promptIcon.hidden = true;
    timerFill.style.width = "100%";
    timerFill.classList.remove("low");

    updateHUD();
    audioContext();
    nextRound();
  }

  function gameOver() {
    state.running = false;
    cancelAnimationFrame(state.raf);
    state.raf = 0;
    if (state.score > state.best) {
      state.best = state.score;
      store(BEST_KEY, state.best);
    }
    finalScoreEl.textContent = String(state.score);
    bestResultEl.textContent = String(state.best);
    maxComboEl.textContent = String(state.maxCombo);
    accuracyEl.textContent = `${state.total ? Math.round((state.correct / state.total) * 100) : 0}%`;
    bestStart.textContent = String(state.best);
    optionsEl.innerHTML = "";
    comboEl.hidden = true;
    resultScreen.hidden = false;
    sfxOver();
  }

  function toggleMute() {
    state.muted = !state.muted;
    store(MUTE_KEY, state.muted);
    muteBtn.textContent = state.muted ? "🔇" : "🔊";
    muteBtn.setAttribute("aria-pressed", String(state.muted));
  }

  // ---------- wiring ----------
  startBtn.addEventListener("click", startGame);
  restartBtn.addEventListener("click", startGame);
  muteBtn.addEventListener("click", toggleMute);

  document.addEventListener("keydown", (e) => {
    if (!state.running) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= state.round.options.length) resolve(n - 1);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.running) resolve(-1);
  });

  bestStart.textContent = String(state.best);
  muteBtn.textContent = state.muted ? "🔇" : "🔊";
  muteBtn.setAttribute("aria-pressed", String(state.muted));
  renderLives();
})();
