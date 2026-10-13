"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SAMPLE_RATE = 44100;
const BPM = 160;
const BEAT = 60 / BPM;
const BARS = 32;
const DURATION = BARS * 4 * BEAT;
const FRAME_COUNT = Math.round(DURATION * SAMPLE_RATE);
const TAU = Math.PI * 2;
const left = new Float32Array(FRAME_COUNT);
const right = new Float32Array(FRAME_COUNT);
let noiseSeed = 0x4e454f4e;

function midi(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

function noise() {
  noiseSeed ^= noiseSeed << 13;
  noiseSeed ^= noiseSeed >>> 17;
  noiseSeed ^= noiseSeed << 5;
  return ((noiseSeed >>> 0) / 4294967295) * 2 - 1;
}

function write(frame, value, pan = 0) {
  const index = ((frame % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
  const leftGain = Math.sqrt((1 - pan) * 0.5);
  const rightGain = Math.sqrt((1 + pan) * 0.5);
  left[index] += value * leftGain;
  right[index] += value * rightGain;
}

function envelope(time, duration, attack = 0.012, release = 0.16) {
  const fadeIn = Math.min(1, time / attack);
  const fadeOut = Math.min(1, (duration - time) / release);
  return Math.max(0, Math.min(fadeIn, fadeOut));
}

function oscillator(phase, type) {
  if (type === "square") return Math.sin(phase) >= 0 ? 1 : -1;
  if (type === "saw") return 2 * ((phase / TAU) - Math.floor(phase / TAU + 0.5));
  if (type === "triangle") return 2 * Math.abs(2 * ((phase / TAU) - Math.floor(phase / TAU + 0.5))) - 1;
  return Math.sin(phase);
}

function addSynth(start, duration, note, amplitude, type, pan = 0, options = {}) {
  const frequency = midi(note);
  const frames = Math.ceil(duration * SAMPLE_RATE);
  const startFrame = Math.round(start * SAMPLE_RATE);
  for (let frame = 0; frame < frames; frame += 1) {
    const time = frame / SAMPLE_RATE;
    const env = envelope(time, duration, options.attack ?? 0.012, options.release ?? 0.13);
    const vibrato = options.vibrato ? Math.sin(TAU * 5.2 * time) * options.vibrato : 0;
    const phase = TAU * frequency * time + vibrato;
    let sample = oscillator(phase, type);
    if (options.detune) sample += oscillator(phase * Math.pow(2, options.detune / 1200), type) * 0.65;
    if (options.drive) sample = Math.tanh(sample * options.drive) / Math.tanh(options.drive);
    write(startFrame + frame, sample * amplitude * env, pan);
  }
}

function addKick(start, amplitude = 0.8) {
  const duration = 0.27;
  const frames = Math.ceil(duration * SAMPLE_RATE);
  const startFrame = Math.round(start * SAMPLE_RATE);
  let phase = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    const time = frame / SAMPLE_RATE;
    const frequency = 42 + 112 * Math.exp(-time * 28);
    phase += TAU * frequency / SAMPLE_RATE;
    const body = Math.sin(phase) * Math.exp(-time * 13);
    const click = time < 0.012 ? noise() * (1 - time / 0.012) * 0.24 : 0;
    write(startFrame + frame, (body + click) * amplitude, 0);
  }
}

function addSnare(start, amplitude = 0.42) {
  const duration = 0.22;
  const frames = Math.ceil(duration * SAMPLE_RATE);
  const startFrame = Math.round(start * SAMPLE_RATE);
  let previousNoise = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    const time = frame / SAMPLE_RATE;
    const rawNoise = noise();
    const brightNoise = rawNoise - previousNoise * 0.72;
    previousNoise = rawNoise;
    const sample = brightNoise * Math.exp(-time * 18) * 0.72
      + Math.sin(TAU * 186 * time) * Math.exp(-time * 15) * 0.36;
    write(startFrame + frame, sample * amplitude, -0.06);
  }
}

function addHat(start, amplitude = 0.11, open = false) {
  const duration = open ? 0.19 : 0.055;
  const frames = Math.ceil(duration * SAMPLE_RATE);
  const startFrame = Math.round(start * SAMPLE_RATE);
  let previousNoise = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    const time = frame / SAMPLE_RATE;
    const rawNoise = noise();
    const brightNoise = rawNoise - previousNoise;
    previousNoise = rawNoise;
    write(startFrame + frame, brightNoise * Math.exp(-time * (open ? 16 : 58)) * amplitude, 0.18);
  }
}

function addRiser(start, duration, amplitude = 0.08) {
  const frames = Math.ceil(duration * SAMPLE_RATE);
  const startFrame = Math.round(start * SAMPLE_RATE);
  let previousNoise = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    const time = frame / SAMPLE_RATE;
    const progress = time / duration;
    const rawNoise = noise();
    const brightNoise = rawNoise - previousNoise * (0.9 - progress * 0.35);
    previousNoise = rawNoise;
    const env = Math.pow(progress, 2.2) * Math.min(1, (duration - time) / 0.05);
    write(startFrame + frame, brightNoise * env * amplitude, -0.25 + progress * 0.5);
  }
}

const progressions = [
  [[52, 55, 59], [48, 52, 55], [43, 47, 50], [50, 54, 57]],
  [[52, 55, 59], [48, 52, 55], [50, 54, 57], [47, 51, 54]],
];
const bassRoots = [40, 36, 31, 38];
const arpPatterns = [0, 1, 2, 1, 2, 1, 0, 1, 0, 2, 1, 2, 0, 1, 2, 1];

for (let bar = 0; bar < BARS; bar += 1) {
  const section = Math.floor(bar / 8);
  const barStart = bar * 4 * BEAT;
  const chordIndex = bar % 4;
  const chord = progressions[section >= 2 ? 1 : 0][chordIndex];
  const root = section >= 2 && chordIndex === 3 ? 35 : bassRoots[chordIndex];

  for (let beat = 0; beat < 4; beat += 1) {
    const beatStart = barStart + beat * BEAT;
    addKick(beatStart, section >= 2 ? 0.84 : 0.76);
    if (beat === 1 || beat === 3) addSnare(beatStart, section >= 2 ? 0.48 : 0.4);
    if (section === 3 && beat === 2) addKick(beatStart + BEAT * 0.5, 0.58);
  }

  const hatDivision = section >= 2 ? 4 : 2;
  for (let step = 0; step < 4 * hatDivision; step += 1) {
    const open = step === 4 * hatDivision - 1 && bar % 4 === 3;
    addHat(barStart + step * BEAT / hatDivision, step % hatDivision === 0 ? 0.13 : 0.085, open);
  }

  for (let step = 0; step < 8; step += 1) {
    const note = root + (step === 6 && section >= 1 ? 7 : step % 4 === 3 ? 12 : 0);
    addSynth(barStart + step * BEAT * 0.5, BEAT * 0.44, note, section >= 2 ? 0.16 : 0.135, "saw", -0.08, {
      release: 0.07,
      drive: 2.3,
      detune: 6,
    });
  }

  for (const note of chord) {
    addSynth(barStart, 4 * BEAT, note, section >= 2 ? 0.07 : 0.052, "saw", note % 2 ? 0.34 : -0.34, {
      attack: 0.06,
      release: 0.24,
      drive: 1.7,
      detune: 8,
    });
  }

  for (let step = 0; step < 16; step += 1) {
    const chordNote = chord[arpPatterns[step]] + 24;
    addSynth(barStart + step * BEAT * 0.25, BEAT * 0.19, chordNote, section >= 1 ? 0.07 : 0.055, "triangle", step % 2 ? 0.55 : -0.55, {
      release: 0.045,
    });
  }

  if (bar % 8 === 7) addRiser(barStart + BEAT * 2, BEAT * 2, section === 3 ? 0.12 : 0.08);
}

const melodyA = [76, 79, 83, 81, 79, 76, 74, 71, 76, 79, 84, 83, 81, 79, 76, 74];
const melodyB = [79, 81, 83, 86, 84, 83, 81, 79, 76, 79, 81, 83, 86, 88, 86, 83];
const melodyC = [83, 83, 86, 88, 91, 88, 86, 83, 84, 83, 81, 79, 81, 83, 86, 88];

for (let bar = 8; bar < BARS; bar += 1) {
  const section = Math.floor(bar / 8);
  const melody = section === 1 ? melodyA : section === 2 ? melodyB : melodyC;
  const barStart = bar * 4 * BEAT;
  for (let step = 0; step < 8; step += 1) {
    const phraseOffset = (bar % 2) * 8;
    let note = melody[phraseOffset + step];
    if (bar % 8 === 7 && step >= 6) note -= step === 7 ? 7 : 2;
    addSynth(barStart + step * BEAT * 0.5, step % 4 === 3 ? BEAT * 0.78 : BEAT * 0.42, note, section === 3 ? 0.115 : 0.095, "square", 0.05, {
      attack: 0.008,
      release: 0.09,
      vibrato: 0.018,
      detune: 4,
      drive: 1.35,
    });
  }
}

function finalizeMix() {
  let sumSquares = 0;
  let peak = 0;
  for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
    left[frame] = Math.tanh(left[frame] * 1.12) / Math.tanh(1.12);
    right[frame] = Math.tanh(right[frame] * 1.12) / Math.tanh(1.12);
    peak = Math.max(peak, Math.abs(left[frame]), Math.abs(right[frame]));
    sumSquares += left[frame] * left[frame] + right[frame] * right[frame];
  }

  const rms = Math.sqrt(sumSquares / (FRAME_COUNT * 2));
  const targetRms = Math.pow(10, -14 / 20);
  const targetPeak = Math.pow(10, -1 / 20);
  const gain = Math.min(targetRms / rms, targetPeak / peak);
  for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
    left[frame] *= gain;
    right[frame] *= gain;
  }

  const crossfadeFrames = 768;
  for (let frame = 0; frame < crossfadeFrames; frame += 1) {
    const amount = frame / (crossfadeFrames - 1);
    const endIndex = FRAME_COUNT - crossfadeFrames + frame;
    left[endIndex] = left[endIndex] * (1 - amount) + left[frame] * amount;
    right[endIndex] = right[endIndex] * (1 - amount) + right[frame] * amount;
  }

  return { rms: rms * gain, peak: peak * gain };
}

function writeWav(filePath) {
  const bytesPerSample = 2;
  const channels = 2;
  const dataSize = FRAME_COUNT * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bytesPerSample * 8, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  let offset = 44;
  for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
    buffer.writeInt16LE(Math.round(clampSample(left[frame]) * 32767), offset);
    buffer.writeInt16LE(Math.round(clampSample(right[frame]) * 32767), offset + 2);
    offset += 4;
  }
  fs.writeFileSync(filePath, buffer);
}

function clampSample(value) {
  return Math.max(-1, Math.min(1, value));
}

function convert(wavPath, outputPath, codecArguments) {
  const temporaryFfmpeg = "/tmp/neon-audio-tools/node_modules/ffmpeg-static/ffmpeg";
  const ffmpegPath = process.env.FFMPEG_PATH || (fs.existsSync(temporaryFfmpeg) ? temporaryFfmpeg : "ffmpeg");
  const result = spawnSync(ffmpegPath, [
    "-y",
    "-loglevel", "error",
    "-i", wavPath,
    ...codecArguments,
    outputPath,
  ], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed for ${path.basename(outputPath)}: ${result.stderr || result.stdout}`);
  }
}

const outputDirectory = path.resolve(__dirname, "../dist/assets/audio");
const wavPath = path.join(outputDirectory, "neon-orbit.wav");
fs.mkdirSync(outputDirectory, { recursive: true });
const levels = finalizeMix();
writeWav(wavPath);
convert(wavPath, path.join(outputDirectory, "neon-orbit.ogg"), ["-c:a", "libvorbis", "-q:a", "5"]);
convert(wavPath, path.join(outputDirectory, "neon-orbit.mp3"), ["-c:a", "libmp3lame", "-b:a", "192k"]);
fs.unlinkSync(wavPath);
process.stdout.write(`Generated ${DURATION.toFixed(2)}s Neon Orbit loop (RMS ${(20 * Math.log10(levels.rms)).toFixed(1)} dBFS, peak ${(20 * Math.log10(levels.peak)).toFixed(1)} dBFS).\n`);
