import { spawn, spawnSync } from "node:child_process";
import { requireFfmpeg } from "./binaries.js";

// Sound for the videos. The page declares its audio the way it declares everything else, in HTML:
//   <audio src="assets/music.mp3" data-start="0" data-volume="0.8" data-trim="12.4" data-duration="24"></audio>
// The engine plays those in step with the timeline (preview), and the exporter mixes them into the MP4 here.
// The agent can't hear, so analyzeAudio() measures a track for it: length, tempo, and where the big hits are.

export type Clip = {
  /** Absolute path of the audio file in the project. */
  file: string;
  /** When it starts in the video (seconds). */
  start: number;
  /** Where in the file to start playing (seconds). */
  trim: number;
  /** How long it plays (seconds), or 0 for "to the end of the file". */
  duration: number;
  /** 0..1 */
  volume: number;
};

/**
 * Lay the clips over a silent render: each placed at its start, trimmed, at its volume; mixed and loudness-normalised
 * to -14 LUFS (where social platforms play audio). `range` shifts and cuts the clips for a partial export.
 */
export async function muxAudio(videoIn: string, out: string, clips: Clip[], range: { from: number; to: number }): Promise<void> {
  const length = range.to - range.from;
  const placed = clips
    .map((c) => {
      // Shift into the exported range; a clip that started before it begins part-way through.
      let start = c.start - range.from;
      let trim = c.trim;
      let dur = c.duration || Infinity;
      if (start < 0) {
        trim -= start;
        dur -= -start;
        start = 0;
      }
      return { ...c, start, trim, dur: Math.min(dur, length - start) };
    })
    .filter((c) => c.start < length && c.dur > 0.02 && c.volume > 0);
  if (!placed.length) throw new Error("no audio in range");

  const args = ["-y", "-loglevel", "error", "-i", videoIn];
  for (const c of placed) args.push("-ss", c.trim.toFixed(3), "-i", c.file);
  const chains = placed.map((c, i) => {
    const ms = Math.round(c.start * 1000);
    return `[${i + 1}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=duration=${c.dur.toFixed(3)},adelay=${ms}|${ms},volume=${c.volume.toFixed(3)}[a${i}]`;
  });
  const mix = `${placed.map((_, i) => `[a${i}]`).join("")}amix=inputs=${placed.length}:normalize=0:dropout_transition=0,loudnorm=I=-14:TP=-1.5:LRA=11,alimiter=limit=0.84:level=false,apad,atrim=duration=${length.toFixed(3)}[mix]`;
  args.push("-filter_complex", [...chains, mix].join(";"), "-map", "0:v", "-map", "[mix]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", length.toFixed(3), out);

  await new Promise<void>((resolve, reject) => {
    const ff = spawn(requireFfmpeg(), args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    ff.stderr.on("data", (d) => (err += d));
    ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`mixing the audio failed: ${err.trim().slice(0, 400)}`))));
  });
}

export type AudioReport = {
  duration: number;
  /** Estimated tempo, and the time of the first beat on that grid. */
  bpm: number | null;
  firstBeat: number | null;
  /** The strongest onsets (sudden rises in loudness), strongest first: the big hit is usually the first one. */
  hits: { t: number; strength: number }[];
  /** Loudness over time in 1 s steps (0..1), to see the build-ups and drops. */
  energy: number[];
};

/** Measure a track: length, tempo, where the hits land, how the energy moves. */
export function analyzeAudio(file: string): AudioReport {
  const RATE = 8000;
  const r = spawnSync(requireFfmpeg(), ["-v", "error", "-i", file, "-ac", "1", "-ar", String(RATE), "-f", "f32le", "-"], { maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`Could not read ${file} as audio: ${String(r.stderr).trim().slice(0, 300)}`);
  const buf = r.stdout as Buffer;
  const pcm = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
  const duration = pcm.length / RATE;

  // Loudness in 20 ms windows, and onset strength = how much louder than the last 200 ms.
  const W = RATE / 50;
  const rms: number[] = [];
  for (let i = 0; i + W <= pcm.length; i += W) {
    let s = 0;
    for (let j = i; j < i + W; j++) s += pcm[j] * pcm[j];
    rms.push(Math.sqrt(s / W));
  }
  const onset = rms.map((v, i) => {
    const prev = rms.slice(Math.max(0, i - 10), i);
    const base = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : v;
    return Math.max(0, v - base);
  });
  const peak = Math.max(...onset, 1e-9);

  // Hits: local maxima of onset strength, at least 0.25 s apart.
  const cands = onset.map((v, i) => ({ i, v })).filter(({ i, v }) => v > peak * 0.2 && onset.slice(Math.max(0, i - 6), i + 7).every((w) => w <= v));
  cands.sort((a, b) => b.v - a.v);
  const hits: { t: number; strength: number }[] = [];
  for (const c of cands) {
    const t = c.i / 50;
    if (hits.every((h) => Math.abs(h.t - t) > 0.25)) hits.push({ t: Math.round(t * 100) / 100, strength: Math.round((c.v / peak) * 100) / 100 });
    if (hits.length >= 12) break;
  }

  // Tempo: the lag (60–180 BPM) where the onset curve best matches itself.
  let bpm: number | null = null;
  let firstBeat: number | null = null;
  if (duration > 4) {
    let best = 0;
    let bestLag = 0;
    for (let lag = Math.round(50 * 60 / 180); lag <= Math.round(50 * 60 / 60); lag++) {
      let s = 0;
      for (let i = lag; i < onset.length; i++) s += onset[i] * onset[i - lag];
      if (s > best) [best, bestLag] = [s, lag];
    }
    if (bestLag) {
      bpm = Math.round((60 * 50) / bestLag);
      // Phase: the offset within one beat that lines up with the most onset energy.
      let bestPhase = 0;
      let bestSum = -1;
      for (let p = 0; p < bestLag; p++) {
        let s = 0;
        for (let i = p; i < onset.length; i += bestLag) s += onset[i];
        if (s > bestSum) [bestSum, bestPhase] = [s, p];
      }
      firstBeat = Math.round((bestPhase / 50) * 100) / 100;
    }
  }

  const energy: number[] = [];
  const maxRms = Math.max(...rms, 1e-9);
  for (let s = 0; s < Math.ceil(duration); s++) {
    const slice = rms.slice(s * 50, s * 50 + 50);
    energy.push(Math.round((slice.reduce((a, b) => a + b, 0) / Math.max(1, slice.length) / maxRms) * 100) / 100);
  }

  return { duration: Math.round(duration * 100) / 100, bpm, firstBeat, hits, energy };
}
