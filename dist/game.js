(() => {
  "use strict";

  const canvas = document.querySelector("#canvas");
  const context = canvas.getContext("2d");
  const gameArea = document.querySelector("#game");
  const startScreen = document.querySelector("#start-screen");
  const startButton = document.querySelector("#start");
  const gameHint = document.querySelector("#game-hint");
  const scoreElement = document.querySelector("#score");
  const bestScoreElement = document.querySelector("#best-score");
  const levelElement = document.querySelector("#level");
  const levelProgress = document.querySelector("#level-progress");
  const speedLabel = document.querySelector("#speed-label");
  const resultElement = document.querySelector("#result");
  const finalScoreElement = document.querySelector("#final-score");
  const recordMessage = document.querySelector("#record-message");
  const restartButton = document.querySelector("#restart");
  const musicToggle = document.querySelector("#music-toggle");
  const music = document.querySelector("#music");

  const TAU = Math.PI * 2;
  const SWITCH_SECONDS = 0.22;
  const BASE_SPEED = 0.78;
  const MAX_SPEED = 1.65;
  const MUSIC_VOLUME = 0.38;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const state = {
    width: 0,
    height: 0,
    dpr: 1,
    centerX: 0,
    centerY: 0,
    innerRadius: 0,
    outerRadius: 0,
    mode: "ready",
    score: 0,
    bestScore: readNumber("neon-orbit-best"),
    level: 1,
    speed: BASE_SPEED,
    lastTime: 0,
    elapsed: 0,
    nextObstacleAngle: 0,
    lastSafeLane: 0,
    obstacleId: 0,
    hintShown: false,
    perfectFlash: 0,
    shake: 0,
    resultTimer: null,
    obstacles: [],
    particles: [],
    trail: [],
    stars: [],
    audioContext: null,
    musicMuted: readBoolean("neon-orbit-muted"),
    musicUnavailable: false,
    musicFadeToken: 0,
    resumeMusicOnVisible: false,
    player: {
      angle: -Math.PI / 2,
      radius: 0,
      lane: 0,
      targetLane: 0,
      switchFrom: 0,
      switchProgress: 1,
      lastSwitchAt: -Infinity,
    },
  };

  function readNumber(key) {
    try {
      return Math.max(0, Number.parseInt(localStorage.getItem(key), 10) || 0);
    } catch {
      return 0;
    }
  }

  function readBoolean(key) {
    try {
      return localStorage.getItem(key) === "true";
    } catch {
      return false;
    }
  }

  function storeValue(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      // Storage is optional; the game still works in privacy-restricted contexts.
    }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(from, to, amount) {
    return from + (to - from) * amount;
  }

  function easeInOut(value) {
    return value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
  }

  function random(min, max) {
    return min + Math.random() * (max - min);
  }

  function laneRadius(lane) {
    return lane === 0 ? state.innerRadius : state.outerRadius;
  }

  function resizeCanvas() {
    const rect = gameArea.getBoundingClientRect();
    state.width = Math.max(300, rect.width);
    state.height = Math.max(460, rect.height);
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(state.width * state.dpr);
    canvas.height = Math.round(state.height * state.dpr);
    context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);

    const orbitLimit = Math.min(state.width * 0.365, state.height * 0.265, 188);
    state.outerRadius = Math.max(112, orbitLimit);
    state.innerRadius = state.outerRadius * 0.67;
    state.centerX = state.width / 2;
    state.centerY = state.height * (state.width > state.height ? 0.52 : 0.46);
    if (state.player.switchProgress >= 1) state.player.radius = laneRadius(state.player.lane);
    createStars();
  }

  function createStars() {
    const count = Math.ceil((state.width * state.height) / 7500);
    state.stars = Array.from({ length: count }, () => ({
      x: Math.random() * state.width,
      y: Math.random() * state.height,
      size: random(0.45, 1.5),
      alpha: random(0.18, 0.78),
      phase: Math.random() * TAU,
    }));
  }

  function resetRound() {
    window.clearTimeout(state.resultTimer);
    state.mode = "ready";
    state.score = 0;
    state.level = 1;
    state.speed = BASE_SPEED;
    state.elapsed = 0;
    state.nextObstacleAngle = 0;
    state.lastSafeLane = 0;
    state.obstacleId = 0;
    state.perfectFlash = 0;
    state.shake = 0;
    state.obstacles = [];
    state.particles = [];
    state.trail = [];
    state.player.angle = -Math.PI / 2;
    state.player.lane = 0;
    state.player.targetLane = 0;
    state.player.switchFrom = 0;
    state.player.switchProgress = 1;
    state.player.radius = state.innerRadius;
    state.player.lastSwitchAt = -Infinity;
    scoreElement.textContent = "0";
    resultElement.hidden = true;
    startScreen.hidden = false;
    startScreen.classList.remove("hide");
    startScreen.setAttribute("aria-hidden", "false");
    gameArea.classList.remove("running");
    gameHint.hidden = true;
    updateDifficultyUI();
  }

  function startRound() {
    resetRound();
    state.mode = "running";
    state.nextObstacleAngle = state.player.angle + 1.35;
    startScreen.classList.add("hide");
    startScreen.hidden = true;
    startScreen.setAttribute("aria-hidden", "true");
    gameArea.classList.add("running");
    ensureObstacles();
    ensureAudio();
    startMusic();
    if (!state.hintShown) {
      gameHint.hidden = false;
      gameHint.classList.remove("fade");
    }
  }

  function minimumSpacing() {
    return Math.max(0.78, state.speed * (SWITCH_SECONDS + 0.43) + 0.28);
  }

  function addObstacle(angle, safeLane, type) {
    state.obstacles.push({
      id: state.obstacleId,
      angle,
      safeLane,
      blockedLane: 1 - safeLane,
      type,
      halfArc: type === "pulse" ? 0.12 : 0.14,
      scored: false,
      warning: false,
      pulsePhase: Math.random() * TAU,
    });
    state.obstacleId += 1;
    state.lastSafeLane = safeLane;
  }

  function generateObstacleGroup() {
    const spacing = minimumSpacing();
    const difficulty = clamp((state.level - 1) / 7, 0, 1);
    const roll = Math.random();
    let safeLane = Math.random() < 0.62 ? 1 - state.lastSafeLane : state.lastSafeLane;

    if (state.level >= 2 && roll < 0.24 + difficulty * 0.08) {
      addObstacle(state.nextObstacleAngle, safeLane, "staggered");
      safeLane = 1 - safeLane;
      addObstacle(state.nextObstacleAngle + spacing, safeLane, "staggered");
      state.nextObstacleAngle += spacing * 2;
    } else {
      const type = state.level >= 3 && roll > 0.78 ? "pulse" : "single";
      addObstacle(state.nextObstacleAngle, safeLane, type);
      state.nextObstacleAngle += spacing * random(1.02, 1.18);
    }
  }

  function ensureObstacles() {
    const lookAhead = state.player.angle + TAU * 1.35;
    while (state.nextObstacleAngle < lookAhead) generateObstacleGroup();
  }

  function switchLane() {
    if (state.mode !== "running" || state.player.switchProgress < 1) return;
    state.player.switchFrom = state.player.radius;
    state.player.targetLane = 1 - state.player.lane;
    state.player.switchProgress = 0;
    state.player.lastSwitchAt = performance.now();
    playTone(state.player.targetLane ? 510 : 390, 0.09, "sawtooth", 0.045);
    duckMusic();
    spawnSwitchParticles();
    if (!state.hintShown) {
      state.hintShown = true;
      gameHint.classList.add("fade");
      window.setTimeout(() => { gameHint.hidden = true; }, 260);
    }
  }

  function update(delta, time) {
    state.elapsed += delta;
    state.perfectFlash = Math.max(0, state.perfectFlash - delta * 2.8);
    state.shake = Math.max(0, state.shake - delta * 5);

    if (state.mode === "running") {
      state.player.angle += state.speed * delta;
      if (state.player.switchProgress < 1) {
        state.player.switchProgress = Math.min(1, state.player.switchProgress + delta / SWITCH_SECONDS);
        const amount = easeInOut(state.player.switchProgress);
        state.player.radius = lerp(state.player.switchFrom, laneRadius(state.player.targetLane), amount);
        if (state.player.switchProgress >= 1) state.player.lane = state.player.targetLane;
      }

      updateObstacles();
      ensureObstacles();
      rememberTrail();
    }

    updateParticles(delta);
    draw(time);
  }

  function updateObstacles() {
    const playerSize = clamp(state.outerRadius * 0.08, 9, 14);
    const trackBand = clamp(state.outerRadius * 0.055, 7, 11);

    for (const obstacle of state.obstacles) {
      const deltaAngle = obstacle.angle - state.player.angle;
      if (!obstacle.warning && deltaAngle < 0.52 && deltaAngle > 0) {
        obstacle.warning = true;
        playTone(220, 0.035, "square", 0.012);
      }

      if (Math.abs(deltaAngle) <= obstacle.halfArc) {
        const blockedRadius = laneRadius(obstacle.blockedLane);
        if (Math.abs(state.player.radius - blockedRadius) < playerSize + trackBand * 0.62) {
          endRound();
          return;
        }
      }

      if (!obstacle.scored && state.player.angle > obstacle.angle + obstacle.halfArc) {
        obstacle.scored = true;
        scorePoint(obstacle);
      }
    }

    state.obstacles = state.obstacles.filter((obstacle) => obstacle.angle > state.player.angle - 0.9);
  }

  function scorePoint(obstacle) {
    state.score += 1;
    scoreElement.textContent = String(state.score);
    const perfect = performance.now() - state.player.lastSwitchAt < 520
      && state.player.lane === obstacle.safeLane;
    if (perfect) {
      state.perfectFlash = 1;
      playTone(820, 0.08, "sine", 0.04);
      spawnPerfectParticles();
      if (!reducedMotion.matches && navigator.vibrate) navigator.vibrate(12);
    } else {
      playTone(620, 0.045, "sine", 0.025);
    }

    const nextLevel = Math.floor(state.score / 8) + 1;
    if (nextLevel !== state.level) {
      state.level = nextLevel;
      state.speed = Math.min(MAX_SPEED, BASE_SPEED + (state.level - 1) * 0.11);
      state.shake = reducedMotion.matches ? 0 : 0.28;
      playLevelUp();
    }
    updateDifficultyUI();
  }

  function updateDifficultyUI() {
    levelElement.textContent = `LV.${String(state.level).padStart(2, "0")}`;
    levelProgress.style.width = `${(state.score % 8) * 12.5}%`;
    speedLabel.textContent = state.level < 3 ? "稳定" : state.level < 6 ? "过载" : "极限";
  }

  function endRound() {
    if (state.mode !== "running") return;
    state.mode = "dead";
    gameArea.classList.remove("running");
    state.shake = reducedMotion.matches ? 0 : 1;
    state.bestScore = Math.max(state.bestScore, state.score);
    storeValue("neon-orbit-best", state.bestScore);
    bestScoreElement.textContent = String(state.bestScore);
    finalScoreElement.textContent = String(state.score);
    recordMessage.textContent = state.score === state.bestScore && state.score > 0
      ? "NEW RECORD / 新纪录"
      : `最高记录 ${state.bestScore}`;
    spawnCrashParticles();
    playCrash();
    fadeMusic(0, 600);
    if (!reducedMotion.matches && navigator.vibrate) navigator.vibrate([35, 35, 75]);
    state.resultTimer = window.setTimeout(() => {
      resultElement.hidden = false;
      restartButton.focus({ preventScroll: true });
    }, 380);
  }

  function rememberTrail() {
    const point = polarPoint(state.player.angle, state.player.radius);
    state.trail.unshift({ x: point.x, y: point.y });
    if (state.trail.length > (reducedMotion.matches ? 7 : 22)) state.trail.pop();
  }

  function polarPoint(angle, radius) {
    return {
      x: state.centerX + Math.cos(angle) * radius,
      y: state.centerY + Math.sin(angle) * radius,
    };
  }

  function spawnSwitchParticles() {
    const point = polarPoint(state.player.angle, state.player.radius);
    for (let index = 0; index < (reducedMotion.matches ? 4 : 10); index += 1) {
      state.particles.push({
        x: point.x,
        y: point.y,
        vx: random(-48, 48),
        vy: random(-48, 48),
        life: 1,
        decay: random(2.4, 3.8),
        size: random(1.2, 2.8),
        color: state.player.targetLane ? "#ff3fc8" : "#4af7ff",
      });
    }
  }

  function spawnPerfectParticles() {
    const point = polarPoint(state.player.angle, state.player.radius);
    for (let index = 0; index < (reducedMotion.matches ? 5 : 16); index += 1) {
      const angle = Math.random() * TAU;
      const speed = random(34, 105);
      state.particles.push({
        x: point.x,
        y: point.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        decay: random(1.6, 2.6),
        size: random(1.4, 3.2),
        color: index % 2 ? "#ffe766" : "#ffffff",
      });
    }
  }

  function spawnCrashParticles() {
    const point = polarPoint(state.player.angle, state.player.radius);
    for (let index = 0; index < (reducedMotion.matches ? 10 : 34); index += 1) {
      const angle = Math.random() * TAU;
      const speed = random(55, 210);
      state.particles.push({
        x: point.x,
        y: point.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        decay: random(0.9, 1.8),
        size: random(1.8, 4.2),
        color: index % 3 ? "#ff3fc8" : "#4af7ff",
      });
    }
  }

  function updateParticles(delta) {
    for (const particle of state.particles) {
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.vx *= Math.pow(0.12, delta);
      particle.vy *= Math.pow(0.12, delta);
      particle.life -= delta * particle.decay;
    }
    state.particles = state.particles.filter((particle) => particle.life > 0);
  }

  function draw(time) {
    context.clearRect(0, 0, state.width, state.height);
    context.save();
    if (state.shake > 0 && !reducedMotion.matches) {
      const amount = state.shake * 4;
      context.translate(random(-amount, amount), random(-amount, amount));
    }
    drawSpace(time);
    drawOrbitSystem(time);
    drawObstacles(time);
    drawTrail();
    drawPlayer();
    drawParticles();
    context.restore();
  }

  function drawSpace(time) {
    for (const star of state.stars) {
      const twinkle = 0.64 + Math.sin(time * 0.0015 + star.phase) * 0.36;
      context.fillStyle = `rgba(184, 226, 255, ${star.alpha * twinkle})`;
      context.beginPath();
      context.arc(star.x, star.y, star.size, 0, TAU);
      context.fill();
    }

    const glow = context.createRadialGradient(state.centerX, state.centerY, 0, state.centerX, state.centerY, state.outerRadius * 1.65);
    glow.addColorStop(0, "rgba(32, 105, 148, 0.13)");
    glow.addColorStop(0.52, "rgba(255, 63, 200, 0.035)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, state.width, state.height);
  }

  function drawOrbitSystem(time) {
    const energy = 1 + Math.min(state.score, 40) / 80;
    drawTrack(state.innerRadius, "#4af7ff");
    drawTrack(state.outerRadius, "#ff3fc8");

    context.save();
    context.translate(state.centerX, state.centerY);
    context.rotate(time * 0.00015 * energy);
    for (let index = 0; index < 3; index += 1) {
      context.beginPath();
      context.arc(0, 0, 35 + index * 13, index * 1.9, index * 1.9 + 1.05);
      context.strokeStyle = index % 2 ? "rgba(255,63,200,0.42)" : "rgba(74,247,255,0.5)";
      context.lineWidth = 2;
      context.shadowColor = index % 2 ? "#ff3fc8" : "#4af7ff";
      context.shadowBlur = 12;
      context.stroke();
    }
    context.restore();

    const pulse = 1 + Math.sin(time * 0.006) * 0.08;
    const core = context.createRadialGradient(state.centerX - 5, state.centerY - 6, 1, state.centerX, state.centerY, 30 * pulse);
    core.addColorStop(0, "#ffffff");
    core.addColorStop(0.18, "#ffe766");
    core.addColorStop(0.48, "rgba(74,247,255,0.76)");
    core.addColorStop(1, "rgba(74,247,255,0)");
    context.fillStyle = core;
    context.beginPath();
    context.arc(state.centerX, state.centerY, 32 * pulse, 0, TAU);
    context.fill();
    context.fillStyle = "#fff8b8";
    context.beginPath();
    context.arc(state.centerX, state.centerY, 7 * pulse, 0, TAU);
    context.fill();
  }

  function drawTrack(radius, color) {
    context.save();
    context.beginPath();
    context.arc(state.centerX, state.centerY, radius, 0, TAU);
    context.strokeStyle = color;
    context.globalAlpha = 0.17;
    context.lineWidth = 8;
    context.shadowColor = color;
    context.shadowBlur = 18;
    context.stroke();
    context.globalAlpha = 0.48;
    context.lineWidth = 1;
    context.setLineDash([3, 8]);
    context.stroke();
    context.restore();
  }

  function drawObstacles(time) {
    for (const obstacle of state.obstacles) {
      if (obstacle.angle < state.player.angle - 0.8) continue;
      const radius = laneRadius(obstacle.blockedLane);
      const angle = obstacle.angle % TAU;
      const color = obstacle.type === "pulse" ? "#ffe766" : obstacle.blockedLane ? "#ff3fc8" : "#4af7ff";
      const pulse = obstacle.type === "pulse" ? 0.68 + Math.sin(time * 0.012 + obstacle.pulsePhase) * 0.32 : 1;

      context.save();
      context.globalAlpha = pulse;
      context.beginPath();
      context.arc(state.centerX, state.centerY, radius, angle - obstacle.halfArc, angle + obstacle.halfArc);
      context.strokeStyle = color;
      context.lineWidth = 13;
      context.lineCap = "round";
      context.shadowColor = color;
      context.shadowBlur = obstacle.warning ? 26 : 16;
      context.stroke();
      context.lineWidth = 2;
      context.strokeStyle = "#ffffff";
      context.stroke();

      if (obstacle.type === "pulse") {
        const inner = polarPoint(angle, state.innerRadius - 13);
        const outer = polarPoint(angle, state.outerRadius + 13);
        context.beginPath();
        context.moveTo(inner.x, inner.y);
        context.lineTo(outer.x, outer.y);
        context.strokeStyle = "rgba(255,231,102,0.42)";
        context.lineWidth = 2;
        context.setLineDash([4, 5]);
        context.stroke();
      }
      context.restore();
    }
  }

  function drawTrail() {
    if (!state.trail.length) return;
    context.save();
    context.lineCap = "round";
    for (let index = 1; index < state.trail.length; index += 1) {
      const from = state.trail[index - 1];
      const to = state.trail[index];
      const alpha = (1 - index / state.trail.length) * 0.52;
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.strokeStyle = `rgba(255, 231, 102, ${alpha})`;
      context.lineWidth = Math.max(0.5, 7 * (1 - index / state.trail.length));
      context.stroke();
    }
    context.restore();
  }

  function drawPlayer() {
    if (state.mode === "dead") return;
    const point = polarPoint(state.player.angle, state.player.radius);
    const size = clamp(state.outerRadius * 0.08, 9, 14);
    context.save();
    context.translate(point.x, point.y);
    context.rotate(state.player.angle + Math.PI / 2);
    context.shadowColor = state.perfectFlash > 0 ? "#ffffff" : "#ffe766";
    context.shadowBlur = 18 + state.perfectFlash * 18;
    context.beginPath();
    context.moveTo(0, -size * 1.45);
    context.lineTo(size * 0.8, size);
    context.lineTo(0, size * 0.52);
    context.lineTo(-size * 0.8, size);
    context.closePath();
    const gradient = context.createLinearGradient(0, -size, 0, size);
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.42, "#fff59c");
    gradient.addColorStop(1, "#ff9e35");
    context.fillStyle = gradient;
    context.fill();
    context.strokeStyle = "rgba(255,255,255,0.9)";
    context.lineWidth = 1;
    context.stroke();
    context.restore();
  }

  function drawParticles() {
    context.save();
    for (const particle of state.particles) {
      context.globalAlpha = clamp(particle.life, 0, 1);
      context.fillStyle = particle.color;
      context.shadowColor = particle.color;
      context.shadowBlur = 7;
      context.beginPath();
      context.arc(particle.x, particle.y, particle.size, 0, TAU);
      context.fill();
    }
    context.restore();
  }

  function ensureAudio() {
    if (state.audioContext) {
      state.audioContext.resume?.();
      return;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) state.audioContext = new AudioContext();
  }

  function playTone(frequency, duration, type, volume, delay = 0) {
    if (!state.audioContext) return;
    const oscillator = state.audioContext.createOscillator();
    const gain = state.audioContext.createGain();
    const now = state.audioContext.currentTime + delay;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(state.audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  function playLevelUp() {
    playTone(440, 0.12, "square", 0.032);
    playTone(660, 0.13, "square", 0.028, 0.08);
    playTone(880, 0.16, "sine", 0.03, 0.16);
    duckMusic();
  }

  function playCrash() {
    playTone(125, 0.34, "sawtooth", 0.065);
    playTone(78, 0.42, "square", 0.035, 0.04);
  }

  function targetMusicVolume() {
    return state.musicMuted || state.musicUnavailable ? 0 : MUSIC_VOLUME;
  }

  function startMusic() {
    if (state.musicUnavailable) return;
    state.musicFadeToken += 1;
    music.currentTime = 0;
    music.volume = 0;
    music.muted = state.musicMuted;
    const playAttempt = music.play();
    if (playAttempt) {
      playAttempt.then(() => fadeMusic(targetMusicVolume(), 450)).catch(() => {
        state.musicUnavailable = true;
        musicToggle.setAttribute("aria-label", "音乐不可用");
      });
    }
  }

  function fadeMusic(target, duration) {
    const token = ++state.musicFadeToken;
    const startVolume = music.volume;
    const startedAt = performance.now();
    function step(now) {
      if (token !== state.musicFadeToken) return;
      const progress = clamp((now - startedAt) / duration, 0, 1);
      music.volume = lerp(startVolume, target, progress);
      if (progress < 1) requestAnimationFrame(step);
      else if (target === 0 && state.mode === "dead") music.pause();
    }
    requestAnimationFrame(step);
  }

  function duckMusic() {
    if (music.paused || state.musicMuted) return;
    fadeMusic(MUSIC_VOLUME * 0.7, 55);
    window.setTimeout(() => {
      if (state.mode === "running") fadeMusic(targetMusicVolume(), 150);
    }, 115);
  }

  function toggleMusic() {
    state.musicMuted = !state.musicMuted;
    storeValue("neon-orbit-muted", state.musicMuted);
    music.muted = state.musicMuted;
    updateMusicButton();
    if (!state.musicMuted && state.mode === "running" && music.paused && !state.musicUnavailable) {
      music.play().then(() => fadeMusic(MUSIC_VOLUME, 180)).catch(() => {});
    }
  }

  function updateMusicButton() {
    musicToggle.setAttribute("aria-pressed", String(state.musicMuted));
    musicToggle.setAttribute("aria-label", state.musicMuted ? "开启音乐" : "关闭音乐");
  }

  function handleGamePointer(event) {
    if (event.target.closest("button")) return;
    event.preventDefault();
    switchLane();
  }

  function frame(time) {
    const delta = Math.min((time - state.lastTime) / 1000 || 0, 0.033);
    state.lastTime = time;
    update(delta, time);
    requestAnimationFrame(frame);
  }

  startButton.addEventListener("click", startRound);
  restartButton.addEventListener("click", startRound);
  musicToggle.addEventListener("click", toggleMusic);
  gameArea.addEventListener("pointerdown", handleGamePointer);
  gameArea.addEventListener("contextmenu", (event) => event.preventDefault());
  window.addEventListener("resize", resizeCanvas);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      state.resumeMusicOnVisible = !music.paused && state.mode === "running";
      music.pause();
      state.audioContext?.suspend?.();
    } else {
      state.audioContext?.resume?.();
      if (state.resumeMusicOnVisible && !state.musicMuted && !state.musicUnavailable) {
        music.play().catch(() => {});
      }
      state.resumeMusicOnVisible = false;
      state.lastTime = performance.now();
    }
  });
  music.addEventListener("error", () => {
    state.musicUnavailable = true;
    musicToggle.setAttribute("aria-label", "音乐不可用");
  });

  bestScoreElement.textContent = String(state.bestScore);
  updateMusicButton();
  resizeCanvas();
  resetRound();
  requestAnimationFrame(frame);
})();
