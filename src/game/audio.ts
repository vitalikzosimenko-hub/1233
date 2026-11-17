// Procedural chunky SFX plus streamed music loops.
type Material = 'wood' | 'stone' | 'dirt' | 'glass' | 'wool' | 'flesh' | 'metal';

export type SfxName =
  | 'dig' | 'break' | 'place' | 'hurt' | 'zombie' | 'hiss' | 'explode' | 'cannon' | 'pickup'
  | 'craft' | 'click' | 'leap' | 'stomp' | 'giant' | 'horn' | 'dawn' | 'victory' | 'defeat'
  | 'hit' | 'deny' | 'recruit' | 'land' | 'hoist'
  | 'bell' | 'quest' | 'thunder' | 'ballista' | 'mortar' | 'phantom' | 'spider' | 'legdamage'
  | 'swing' | 'slash' | 'crit' | 'poof' | 'kill' | 'oof' | 'heartbeat' | 'levelup' | 'step'
  | 'grapple' | 'reel' | 'warhorn' | 'steam' | 'ram' | 'bump' | 'page' | 'wave' | 'relic' | 'crossbow'
  | 'success' | 'whoosh' | 'firework' | 'bark' | 'groundpound' | 'jackpot' | 'crate'
  | 'baa' | 'cheer' | 'cluck' | 'feat' | 'howl' | 'shear' | 'squish' | 'star' | 'villager'
  // The crane: its winch, a chain latching, the strain, a building torn out, a block snapping home, a storey landing.
  | 'winch' | 'latch' | 'strain' | 'rip' | 'snap' | 'thud'
  | MonsterSound;

/** The monsters' and bosses' own voices (recorded; synthesised until they load). */
export type MonsterSound =
  | 'groan' | 'zhurt' | 'rattle' | 'bow' | 'arrowhit' | 'fuse' | 'charged' | 'teleport' | 'scream'
  | 'witch' | 'splash' | 'drink' | 'illager' | 'raidhorn' | 'roar' | 'cast' | 'fangs' | 'vex'
  | 'witherspawn' | 'withershoot' | 'withergrowl' | 'ghast' | 'fireball' | 'totem' | 'clank'
  | 'bossdeath' | 'beacon' | 'slime'
  // The Long March: the seals and their guardians, and the new lands' monsters.
  | 'shatter' | 'quake' | 'freeze' | 'blaze' | 'gurgle' | 'wind' | 'bear' | 'croak' | 'magma' | 'queen' | 'chapter' | 'zap';

/** Recorded effects and ambience loops (procedural sounds stand in until they load). */
export type SampleName =
  | 'stomp' | 'cannon' | 'explode' | 'hoist' | 'amb_day' | 'amb_night'
  | 'walk' | 'rain' | 'cave' | 'bell' | 'quest' | 'thunder' | 'ballista' | 'mortar' | 'phantom' | 'spider' | 'legdamage'
  | 'swing' | 'slash' | 'crit' | 'poof' | 'oof' | 'heartbeat' | 'levelup'
  | 'grapple' | 'reel' | 'warhorn' | 'steam' | 'ram' | 'page' | 'wave' | 'relic' | 'crossbow'
  | 'success' | 'whoosh' | 'firework' | 'bark' | 'groundpound' | 'jackpot' | 'crate'
  | 'baa' | 'cheer' | 'cluck' | 'feat' | 'howl' | 'shear' | 'squish' | 'star' | 'villager'
  | 'winch' | 'latch' | 'strain' | 'rip' | 'snap' | 'thud'
  | MonsterSound;

/** Every monster sound (for loading their recordings). */
export const MONSTER_SOUNDS: readonly MonsterSound[] = [
  'groan', 'zhurt', 'rattle', 'bow', 'arrowhit', 'fuse', 'charged', 'teleport', 'scream',
  'witch', 'splash', 'drink', 'illager', 'raidhorn', 'roar', 'cast', 'fangs', 'vex',
  'witherspawn', 'withershoot', 'withergrowl', 'ghast', 'fireball', 'totem', 'clank',
  'bossdeath', 'beacon', 'slime',
  'shatter', 'quake', 'freeze', 'blaze', 'gurgle', 'wind', 'bear', 'croak', 'magma', 'queen', 'chapter',
];

/** How loud each monster recording plays, and the shortest gap between two of the same. */
const MONSTER_MIX: Record<MonsterSound, readonly [volume: number, gap: number]> = {
  groan: [0.55, 0.5], zhurt: [0.6, 0.12], rattle: [0.55, 0.15], bow: [0.6, 0.08], arrowhit: [0.5, 0.06],
  fuse: [0.75, 0.3], charged: [0.5, 0.4], teleport: [0.7, 0.1], scream: [0.8, 1.2], witch: [0.7, 0.8],
  splash: [0.8, 0.08], drink: [0.7, 0.6], illager: [0.6, 0.4], raidhorn: [1, 2], roar: [1, 0.8],
  cast: [0.75, 0.3], fangs: [0.65, 0.05], vex: [0.55, 0.25], witherspawn: [1, 2], withershoot: [0.7, 0.1],
  withergrowl: [0.75, 1], ghast: [0.7, 0.8], fireball: [0.75, 0.1], totem: [1, 0.5], clank: [0.65, 0.06],
  bossdeath: [1, 2], beacon: [0.9, 1], slime: [0.6, 0.08],
  shatter: [1, 1.5], quake: [1, 0.8], freeze: [0.8, 0.5], blaze: [0.6, 0.6], gurgle: [0.6, 0.6], wind: [0.75, 0.08],
  bear: [0.8, 0.8], croak: [0.45, 0.4], magma: [0.6, 0.1], queen: [0.9, 1], chapter: [0.9, 2], zap: [0.6, 0.25],
};

/** Background music tracks (day and night load up front, the rest when first wanted). */
export type MusicName = 'day' | 'night' | 'siege' | 'desert' | 'snow' | 'raid' | 'wither' | 'swamp' | 'badlands' | 'ember' | 'guardian'
  // The main quest: exploring a wreck, its warden, the last fight, the way home.
  | 'expedition' | 'warden' | 'final' | 'epilogue';

/** Long loops that are fetched only when first used. */
const LAZY_SAMPLES = new Set<SampleName>(['rain', 'cave']);

/** Looping beds whose volume follows the game (the fortress walking, rain, a cave). */
export type LoopName = 'walk' | 'rain' | 'cave';

const MATERIAL_FREQ: Record<Material, number> = {
  wood: 950,
  stone: 2300,
  dirt: 520,
  glass: 3400,
  wool: 380,
  flesh: 700,
  metal: 3000,
};

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastPlayed = new Map<string, number>();
  private userMuted = false;
  private hostMuted = false;
  private musicURLs: Partial<Record<MusicName, string>> = {};
  private buffers: Partial<Record<MusicName, AudioBuffer>> = {};
  private loading = new Set<string>();
  private current: { name: MusicName; source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private wanted: MusicName | 'none' = 'none';
  private loops = new Map<LoopName, { source: AudioBufferSourceNode; gain: GainNode; level: number; rate: number }>();
  private loopWanted = new Map<LoopName, number>();
  private sampleURLs: Partial<Record<SampleName, string>> = {};
  private samples: Partial<Record<SampleName, AudioBuffer>> = {};
  private ambBus: GainNode | null = null;
  private amb: { name: 'day' | 'night'; source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private ambWanted: 'day' | 'night' | 'none' = 'none';
  onAudible: (() => void) | null = null;

  get muted(): boolean {
    return this.userMuted;
  }

  setMusicURLs(urls: Partial<Record<MusicName, string>>): void {
    this.musicURLs = urls;
  }

  setSampleURLs(urls: Partial<Record<SampleName, string>>): void {
    this.sampleURLs = urls;
  }

  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
      } catch {
        return;
      }
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.sfx = this.ctx.createGain();
      this.sfx.gain.value = 0.55;
      this.sfx.connect(this.master);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.3;
      this.musicBus.connect(this.master);
      this.ambBus = this.ctx.createGain();
      this.ambBus.gain.value = 0.42;
      this.ambBus.connect(this.master);
      const length = Math.floor(this.ctx.sampleRate * 1.5);
      this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
      this.applyMute();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    this.preloadMusic();
    this.preloadSamples();
  }

  private preloadSamples(): void {
    for (const name of Object.keys(this.sampleURLs) as SampleName[]) if (!LAZY_SAMPLES.has(name)) this.loadSample(name);
  }

  private loadSample(name: SampleName): void {
    const url = this.sampleURLs[name];
    if (!this.ctx || !url || this.samples[name] || this.loading.has(name)) return;
    const ctx = this.ctx;
    this.loading.add(name);
    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`sample ${response.status}`);
        return response.arrayBuffer();
      })
      .then((data) => ctx.decodeAudioData(data))
      .then((buffer) => {
        this.samples[name] = buffer;
        if ((name === 'amb_day' && this.ambWanted === 'day') || (name === 'amb_night' && this.ambWanted === 'night')) this.ambience(this.ambWanted);
      })
      .catch(() => undefined)
      .finally(() => this.loading.delete(name));
  }

  /**
   * Sets the volume of a looping bed (0 silences it) and its playback rate (the walking engine
   * labours faster at speed). Called every frame; the level glides, the loop starts once its
   * recording has loaded and stops a while after it falls silent.
   */
  loop(name: LoopName, level: number, rate = 1): void {
    this.loopWanted.set(name, level);
    const ctx = this.ctx;
    if (!ctx || !this.ambBus || ctx.state !== 'running') return;
    let l = this.loops.get(name);
    if (!l && level > 0.001) {
      const buffer = this.samples[name];
      if (!buffer) {
        this.loadSample(name);
        return;
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.playbackRate.value = rate;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(this.ambBus);
      source.start(0, Math.random() * Math.max(0, buffer.duration - 0.5));
      l = { source, gain, level: 0, rate };
      this.loops.set(name, l);
    }
    if (!l) return;
    if (Math.abs(l.rate - rate) > 0.02) {
      l.rate = rate;
      l.source.playbackRate.setTargetAtTime(rate, ctx.currentTime, 0.25);
    }
    const target = level <= 0.001 ? 0 : level;
    if (Math.abs(l.level - target) > 0.01 || (target === 0 && l.level !== 0)) {
      l.level = target;
      l.gain.gain.setTargetAtTime(target, ctx.currentTime, 0.35);
    }
    if (target === 0) {
      const old = l;
      this.loops.delete(name);
      window.setTimeout(() => {
        try {
          old.source.stop();
        } catch {
          // already stopped
        }
      }, 2500);
    }
  }

  /** Plays a recorded effect; false when it has not loaded (the caller synthesises one). */
  private sample(name: SampleName, volume: number, rate = 1, vary = true): boolean {
    const ctx = this.ctx;
    const buffer = this.samples[name];
    if (!ctx || !buffer || !this.sfx) return false;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    // (A little variety in pitch, except for notes that make a tune.)
    source.playbackRate.value = rate * (vary ? 0.94 + Math.random() * 0.12 : 1);
    const amp = ctx.createGain();
    amp.gain.value = volume;
    source.connect(amp);
    amp.connect(this.sfx);
    source.start();
    return true;
  }

  /** Looping outdoor ambience under the music. */
  ambience(name: 'day' | 'night' | 'none'): void {
    this.ambWanted = name;
    if (!this.ctx || !this.ambBus) return;
    if (this.amb && this.amb.name === name) return;
    const now = this.ctx.currentTime;
    if (this.amb) {
      const old = this.amb;
      old.gain.gain.setTargetAtTime(0, now, 1.2);
      window.setTimeout(() => {
        try {
          old.source.stop();
        } catch {
          // already stopped
        }
      }, 5000);
      this.amb = null;
    }
    if (name === 'none') return;
    const buffer = this.samples[name === 'day' ? 'amb_day' : 'amb_night'];
    if (!buffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(1, now, 1.5);
    source.connect(gain);
    gain.connect(this.ambBus);
    source.start(0, Math.random() * Math.max(0, buffer.duration - 1));
    this.amb = { name, source, gain };
  }

  setUserMuted(muted: boolean): void {
    this.userMuted = muted;
    this.applyMute();
  }

  setHostMuted(muted: boolean): void {
    this.hostMuted = muted;
    this.applyMute();
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend().catch(() => undefined);
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  private applyMute(): void {
    if (!this.master || !this.ctx) return;
    const target = this.userMuted || this.hostMuted ? 0 : 1;
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
  }

  private preloadMusic(): void {
    this.loadMusic('day');
    this.loadMusic('night');
    if (this.wanted !== 'none') this.loadMusic(this.wanted);
  }

  private loadMusic(name: MusicName): void {
    const url = this.musicURLs[name];
    if (!url || this.buffers[name] || this.loading.has(name) || !this.ctx) return;
    this.loading.add(name);
    const ctx = this.ctx;
    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`music ${response.status}`);
        return response.arrayBuffer();
      })
      .then((data) => ctx.decodeAudioData(data))
      .then((buffer) => {
        this.buffers[name] = buffer;
        if (this.wanted === name && (!this.current || this.current.name !== name)) this.playMusic(name);
      })
      .catch(() => undefined)
      .finally(() => this.loading.delete(name));
  }

  playMusic(name: MusicName | 'none'): void {
    this.wanted = name;
    if (!this.ctx || !this.musicBus) return;
    if (this.current && this.current.name === name) return;
    // Keep the current track playing until a newly wanted one has loaded.
    if (name !== 'none' && !this.buffers[name]) {
      this.loadMusic(name);
      if (this.current) return;
    }
    const now = this.ctx.currentTime;
    if (this.current) {
      const old = this.current;
      old.gain.gain.setTargetAtTime(0, now, 0.6);
      window.setTimeout(() => {
        try {
          old.source.stop();
        } catch {
          // already stopped
        }
      }, 3000);
      this.current = null;
    }
    if (name === 'none') return;
    const buffer = this.buffers[name];
    if (!buffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(1, now, 0.8);
    source.connect(gain);
    gain.connect(this.musicBus);
    source.start();
    this.current = { name, source, gain };
  }

  private throttle(name: string, minGap: number): boolean {
    if (!this.ctx) return false;
    const now = this.ctx.currentTime;
    const last = this.lastPlayed.get(name) ?? -1;
    if (now - last < minGap) return false;
    this.lastPlayed.set(name, now);
    return true;
  }

  private noiseBurst(duration: number, filterType: BiquadFilterType, freq: number, gain: number, freqEnd?: number, q = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.sfx) return;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(freq, now);
    filter.Q.value = q;
    if (freqEnd !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, now);
    amp.gain.exponentialRampToValueAtTime(0.0008, now + duration);
    source.connect(filter);
    filter.connect(amp);
    amp.connect(this.sfx);
    source.start(now, Math.random() * 0.5, duration + 0.05);
  }

  private tone(type: OscillatorType, f0: number, f1: number, duration: number, gain: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.exponentialRampToValueAtTime(gain, now + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0008, now + duration);
    osc.connect(amp);
    amp.connect(this.sfx);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  }

  play(name: SfxName, material: Material = 'stone', volume = 1, rate = 1): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const v = Math.max(0, Math.min(1.2, volume));
    const mix = MONSTER_MIX[name as MonsterSound];
    if (mix) {
      if (!this.throttle(name, mix[1])) return;
      if (!this.sample(name as MonsterSound, mix[0] * v, rate)) this.monsterSynth(name as MonsterSound, v, rate);
      this.onAudible?.();
      return;
    }
    switch (name) {
      case 'step':
        // A soft footfall coloured by the ground: a short filtered tap (planks get a hollow knock).
        if (!this.throttle('step', 0.12)) return;
        this.noiseBurst(0.06, 'bandpass', MATERIAL_FREQ[material] * 0.75 * rate, 0.16 * v, MATERIAL_FREQ[material] * 0.45, 1.6);
        if (material === 'wood') this.tone('sine', 210 * rate, 120, 0.05, 0.08 * v);
        return;
      case 'swing':
        if (!this.throttle('swing', 0.08)) return;
        if (this.sample('swing', 0.55 * v, rate)) break;
        this.noiseBurst(0.16, 'bandpass', 1900, 0.24 * v, 650, 1.1);
        break;
      case 'slash':
        if (!this.throttle('slash', 0.05)) return;
        if (this.sample('slash', 0.85 * v, rate)) break;
        this.noiseBurst(0.1, 'bandpass', 950 * rate, 0.5 * v, 300, 1.3);
        this.tone('sine', 150 * rate, 55, 0.13, 0.5 * v);
        break;
      case 'crit':
        if (!this.throttle('crit', 0.06)) return;
        if (this.sample('crit', 0.9 * v, rate)) break;
        this.tone('square', 1500, 900, 0.09, 0.12 * v);
        this.noiseBurst(0.14, 'bandpass', 2800, 0.35 * v, 1200, 2);
        this.tone('sine', 140, 50, 0.16, 0.6 * v);
        break;
      case 'poof':
        if (!this.throttle('poof', 0.07)) return;
        if (this.sample('poof', 0.45 * v, rate)) break;
        this.noiseBurst(0.25, 'lowpass', 1300, 0.22 * v, 260);
        break;
      case 'kill':
        // Kill streaks climb the scale.
        this.tone('triangle', 660 * rate, 660 * rate, 0.09, 0.16 * v);
        this.tone('triangle', 990 * rate, 990 * rate, 0.14, 0.14 * v, 0.07);
        break;
      case 'oof':
        if (!this.throttle('oof', 0.2)) return;
        if (this.sample('oof', 0.8 * v, rate)) break;
        this.tone('square', 320, 140, 0.18, 0.18 * v);
        break;
      case 'heartbeat':
        if (this.sample('heartbeat', 0.9 * v)) break;
        this.tone('sine', 62, 38, 0.13, 0.7 * v);
        this.tone('sine', 56, 34, 0.15, 0.55 * v, 0.24);
        break;
      case 'levelup':
        if (this.sample('levelup', 0.7 * v)) break;
        [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone('triangle', f, f, 0.22, 0.18 * v, i * 0.07));
        break;
      case 'grapple':
        if (!this.throttle('grapple', 0.15)) return;
        if (this.sample('grapple', 0.85 * v)) break;
        this.tone('square', 320, 180, 0.07, 0.15 * v);
        this.noiseBurst(0.35, 'bandpass', 700, 0.3 * v, 2600, 1.4);
        break;
      case 'reel':
        if (!this.throttle('reel', 0.4)) return;
        if (this.sample('reel', 0.6 * v)) break;
        this.noiseBurst(0.6, 'bandpass', 1300, 0.2 * v, 3200, 3);
        break;
      case 'warhorn':
        if (this.sample('warhorn', 1.0 * v)) break;
        this.tone('sawtooth', 98, 104, 2.2, 0.2 * v);
        this.tone('sawtooth', 147, 156, 2.2, 0.14 * v);
        this.tone('sine', 49, 52, 2.2, 0.3 * v);
        break;
      case 'steam':
        if (!this.throttle('steam', 1.2)) return;
        if (this.sample('steam', 0.75 * v)) break;
        this.tone('sine', 880, 870, 0.55, 0.16 * v);
        this.tone('sine', 1108, 1096, 0.55, 0.11 * v);
        this.noiseBurst(1.0, 'highpass', 3200, 0.22 * v, 1800);
        break;
      case 'ram':
        if (!this.throttle('ram', 0.3)) return;
        if (this.sample('ram', 1.0 * v)) break;
        this.noiseBurst(1.2, 'lowpass', 900, 0.9 * v, 60);
        this.tone('sine', 55, 24, 0.9, 0.9 * v);
        break;
      case 'bump':
        if (!this.throttle('bump', 0.5)) return;
        this.tone('sine', 92, 38, 0.28, 0.65 * v);
        this.noiseBurst(0.2, 'lowpass', 420, 0.45 * v);
        break;
      case 'page':
        if (this.sample('page', 0.8 * v)) break;
        this.noiseBurst(0.28, 'highpass', 2200, 0.14 * v, 5000);
        break;
      case 'wave':
        if (!this.throttle('wave', 2)) return;
        if (this.sample('wave', 0.95 * v)) break;
        for (let i = 0; i < 4; i += 1) this.tone('sine', 72, 36, 0.3, 0.6 * v, i * 0.32);
        this.tone('sawtooth', 87, 82, 1.6, 0.13 * v, 0.2);
        break;
      case 'relic':
        if (this.sample('relic', 0.85 * v)) break;
        [784, 988, 1175, 1568, 1976].forEach((f, i) => this.tone('sine', f, f, 0.6, 0.12 * v, i * 0.11));
        break;
      case 'crossbow':
        if (!this.throttle('crossbow', 0.08)) return;
        if (this.sample('crossbow', 0.85 * v, rate)) break;
        this.tone('square', 300, 120, 0.08, 0.16 * v);
        this.noiseBurst(0.15, 'bandpass', 2100, 0.3 * v, 800, 1.5);
        break;
      case 'success':
        // A training step done: a bright little arpeggio.
        if (!this.throttle('success', 0.3)) return;
        if (this.sample('success', 0.8 * v)) break;
        [784, 988, 1319].forEach((f, i) => this.tone('triangle', f, f, 0.32, 0.2 * v, i * 0.08));
        this.tone('sine', 2637, 2637, 0.5, 0.05 * v, 0.24);
        break;
      case 'whoosh':
        if (!this.throttle('whoosh', 0.25)) return;
        if (this.sample('whoosh', 0.45 * v)) break;
        this.noiseBurst(0.3, 'bandpass', 600, 0.12 * v, 2400, 0.9);
        break;
      case 'firework':
        if (!this.throttle('firework', 0.12)) return;
        if (this.sample('firework', 0.75 * v, rate)) break;
        this.tone('sine', 900 * rate, 2400 * rate, 0.7, 0.05 * v);
        this.noiseBurst(0.9, 'lowpass', 2600, 0.5 * v, 200);
        this.tone('sine', 90, 40, 0.5, 0.45 * v, 0.9);
        this.noiseBurst(1.1, 'highpass', 5000, 0.12 * v, 3000);
        break;
      case 'bark':
        if (!this.throttle('bark', 0.35)) return;
        if (this.sample('bark', 0.8 * v, rate)) break;
        this.tone('square', 520 * rate, 300 * rate, 0.09, 0.14 * v);
        this.tone('square', 560 * rate, 320 * rate, 0.09, 0.14 * v, 0.17);
        break;
      case 'groundpound':
        if (!this.throttle('groundpound', 0.4)) return;
        if (this.sample('groundpound', 1.0 * v)) break;
        this.tone('sine', 62, 24, 1.1, 1.0 * v);
        this.noiseBurst(1.4, 'lowpass', 1100, 0.9 * v, 50);
        this.tone('square', 220, 110, 0.12, 0.2 * v);
        break;
      case 'jackpot':
        if (!this.throttle('jackpot', 0.5)) return;
        if (this.sample('jackpot', 0.85 * v)) break;
        for (let i = 0; i < 9; i += 1) this.tone('triangle', 1046 + (i % 4) * 262, 1046 + (i % 4) * 262, 0.18, 0.12 * v, i * 0.07);
        break;
      case 'crate':
        if (!this.throttle('crate', 0.3)) return;
        if (this.sample('crate', 0.9 * v)) break;
        this.tone('sine', 120, 60, 0.25, 0.6 * v);
        this.noiseBurst(0.2, 'lowpass', 700, 0.5 * v);
        break;
      case 'baa':
        if (!this.throttle('baa', 0.5)) return;
        if (this.sample('baa', 0.7 * v, rate)) break;
        this.tone('sawtooth', 330 * rate, 300 * rate, 0.45, 0.08 * v);
        this.tone('sine', 660 * rate, 600 * rate, 0.45, 0.05 * v);
        break;
      case 'cluck':
        if (!this.throttle('cluck', 0.3)) return;
        if (this.sample('cluck', 0.65 * v, rate)) break;
        [0, 0.12, 0.2].forEach((d) => this.tone('square', 900 * rate, 620 * rate, 0.06, 0.07 * v, d));
        break;
      case 'shear':
        if (!this.throttle('shear', 0.2)) return;
        if (this.sample('shear', 0.85 * v, rate)) break;
        this.noiseBurst(0.05, 'highpass', 4200, 0.3 * v);
        this.noiseBurst(0.05, 'highpass', 4200, 0.3 * v, undefined, 1);
        this.noiseBurst(0.25, 'lowpass', 600, 0.2 * v, 200);
        break;
      case 'squish':
        if (!this.throttle('squish', 0.12)) return;
        if (this.sample('squish', 0.95 * v, rate)) break;
        this.noiseBurst(0.22, 'lowpass', 900, 0.6 * v, 120);
        this.tone('sine', 200 * rate, 60, 0.2, 0.4 * v);
        this.tone('square', 1400, 1800, 0.05, 0.05 * v, 0.16);
        break;
      case 'cheer':
        if (!this.throttle('cheer', 1.2)) return;
        if (this.sample('cheer', 0.8 * v, rate)) break;
        this.noiseBurst(1.1, 'bandpass', 1400, 0.25 * v, 900, 0.8);
        break;
      case 'feat':
        if (!this.throttle('feat', 0.6)) return;
        if (this.sample('feat', 0.8 * v)) break;
        [659, 784, 988, 1319].forEach((f, i) => this.tone('triangle', f, f, 0.3, 0.16 * v, i * 0.09));
        this.tone('sine', 2637, 2637, 0.6, 0.05 * v, 0.36);
        break;
      case 'howl':
        if (!this.throttle('howl', 2)) return;
        if (this.sample('howl', 0.75 * v, rate)) break;
        this.tone('sine', 420 * rate, 780 * rate, 0.6, 0.14 * v);
        this.tone('sine', 780 * rate, 520 * rate, 1.2, 0.12 * v, 0.6);
        break;
      case 'star':
        if (!this.throttle('star', 1)) return;
        if (this.sample('star', 0.8 * v)) break;
        this.noiseBurst(1.2, 'bandpass', 2800, 0.14 * v, 6000, 2);
        [1568, 2093, 2637, 3136].forEach((f, i) => this.tone('sine', f, f, 0.4, 0.05 * v, 0.3 + i * 0.12));
        break;
      case 'villager':
        if (!this.throttle('villager', 0.35)) return;
        if (this.sample('villager', 0.6 * v, rate)) break;
        this.tone('sawtooth', 190 * rate, 260 * rate, 0.2, 0.08 * v);
        this.tone('sawtooth', 260 * rate, 210 * rate, 0.18, 0.07 * v, 0.18);
        break;
      case 'dig':
        if (!this.throttle('dig', 0.07)) return;
        this.noiseBurst(0.07, 'bandpass', MATERIAL_FREQ[material], 0.35 * v, undefined, 2.2);
        break;
      case 'break':
        if (!this.throttle('break', 0.04)) return;
        this.noiseBurst(0.2, 'bandpass', MATERIAL_FREQ[material] * 0.8, 0.55 * v, MATERIAL_FREQ[material] * 0.4, 1.4);
        this.tone('sine', 180, 70, 0.12, 0.25 * v);
        break;
      case 'place':
        if (!this.throttle('place', 0.05)) return;
        this.noiseBurst(0.06, 'lowpass', 900, 0.4 * v);
        this.tone('sine', 160, 80, 0.1, 0.35 * v);
        break;
      case 'hit':
        if (!this.throttle('hit', 0.05)) return;
        this.noiseBurst(0.08, 'bandpass', 1200, 0.45 * v, 500, 1.5);
        this.tone('square', 240, 120, 0.08, 0.12 * v);
        break;
      case 'hurt':
        if (!this.throttle('hurt', 0.2)) return;
        this.tone('square', 320, 140, 0.18, 0.18 * v);
        break;
      case 'zombie':
        if (!this.throttle('zombie', 0.9)) return;
        this.tone('sawtooth', 110 + Math.random() * 20, 70, 0.7, 0.12 * v);
        this.noiseBurst(0.5, 'lowpass', 400, 0.08 * v);
        break;
      case 'hiss':
        if (!this.throttle('hiss', 0.4)) return;
        this.noiseBurst(1.4, 'highpass', 2600, 0.22 * v, 4200);
        break;
      case 'explode':
        if (!this.throttle('explode', 0.06)) return;
        if (this.sample('explode', 0.95 * v)) break;
        this.noiseBurst(1.3, 'lowpass', 1800, 0.9 * v, 90);
        this.tone('sine', 70, 28, 0.9, 0.8 * v);
        break;
      case 'cannon':
        if (!this.throttle('cannon', 0.08)) return;
        if (this.sample('cannon', 0.9 * v)) break;
        this.tone('sine', 140, 40, 0.3, 0.7 * v);
        this.noiseBurst(0.25, 'lowpass', 1400, 0.55 * v, 200);
        break;
      case 'hoist':
        if (this.sample('hoist', 0.9 * v)) break;
        this.noiseBurst(1.2, 'bandpass', 900, 0.3 * v, 300, 2);
        break;
      case 'winch':
        // A ratchet over a turning drum.
        if (!this.throttle('winch', 0.3)) return;
        if (this.sample('winch', 0.75 * v, rate)) break;
        for (let i = 0; i < 9; i += 1) this.tone('square', 1300 * rate, 900, 0.025, 0.05 * v, i * 0.09);
        this.noiseBurst(0.9, 'bandpass', 240 * rate, 0.2 * v, 160, 3);
        break;
      case 'latch':
        if (!this.throttle('latch', 0.06)) return;
        if (this.sample('latch', 0.8 * v, rate)) break;
        this.tone('triangle', 1650 * rate, 1100, 0.09, 0.2 * v);
        this.tone('square', 520 * rate, 380, 0.06, 0.12 * v);
        this.noiseBurst(0.18, 'highpass', 3200, 0.16 * v, 5200);
        break;
      case 'strain':
        if (!this.throttle('strain', 0.6)) return;
        if (this.sample('strain', 0.85 * v, rate)) break;
        this.tone('sawtooth', 92 * rate, 70, 1.4, 0.07 * v);
        this.noiseBurst(1.4, 'bandpass', 420 * rate, 0.16 * v, 260, 6);
        break;
      case 'rip':
        if (!this.throttle('rip', 0.3)) return;
        if (this.sample('rip', 1 * v, rate)) break;
        this.noiseBurst(1.1, 'lowpass', 1600, 0.75 * v, 120);
        this.tone('sine', 85, 32, 0.6, 0.6 * v);
        break;
      case 'snap':
        if (!this.throttle('snap', 0.035)) return;
        if (this.sample('snap', 0.6 * v, rate, false)) break;
        this.tone('triangle', 660 * rate, 520 * rate, 0.07, 0.16 * v);
        this.noiseBurst(0.04, 'bandpass', 2400 * rate, 0.12 * v, 1600, 2);
        break;
      case 'thud':
        if (!this.throttle('thud', 0.2)) return;
        if (this.sample('thud', 1 * v, rate)) break;
        this.tone('sine', 68, 30, 0.5, 0.7 * v);
        this.noiseBurst(0.5, 'lowpass', 700, 0.45 * v, 90);
        break;
      case 'pickup':
        if (!this.throttle('pickup', 0.05)) return;
        this.tone('sine', 620, 1240, 0.09, 0.18 * v);
        break;
      case 'craft':
        this.tone('triangle', 523, 523, 0.12, 0.25 * v);
        this.tone('triangle', 784, 784, 0.18, 0.25 * v, 0.1);
        break;
      case 'recruit':
        this.tone('triangle', 392, 392, 0.1, 0.22 * v);
        this.tone('triangle', 523, 523, 0.1, 0.22 * v, 0.09);
        this.tone('triangle', 659, 659, 0.2, 0.22 * v, 0.18);
        break;
      case 'click':
        if (!this.throttle('click', 0.03)) return;
        this.tone('square', 900, 700, 0.03, 0.08 * v);
        break;
      case 'deny':
        if (!this.throttle('deny', 0.15)) return;
        this.tone('square', 180, 150, 0.12, 0.1 * v);
        break;
      case 'leap':
        this.noiseBurst(0.4, 'bandpass', 400, 0.35 * v, 2200, 1.2);
        break;
      case 'land':
        if (!this.throttle('land', 0.1)) return;
        this.noiseBurst(0.1, 'lowpass', 500, 0.3 * v);
        break;
      case 'stomp':
        if (!this.throttle('stomp', 0.12)) return;
        if (this.sample('stomp', 0.85 * v)) break;
        this.tone('sine', 75, 38, 0.2, 0.45 * v);
        this.noiseBurst(0.12, 'lowpass', 300, 0.25 * v);
        break;
      case 'giant':
        if (!this.throttle('giant', 0.25)) return;
        this.tone('sine', 58, 30, 0.35, 0.6 * v);
        this.noiseBurst(0.25, 'lowpass', 220, 0.35 * v);
        break;
      case 'horn':
        this.tone('sawtooth', 110, 104, 1.3, 0.16 * v);
        this.tone('sawtooth', 165, 156, 1.3, 0.12 * v);
        break;
      case 'bell':
        if (!this.throttle('bell', 1)) return;
        if (this.sample('bell', 0.8 * v)) break;
        [880, 880, 880].forEach((f, i) => this.tone('triangle', f, f * 0.99, 0.4, 0.2 * v, i * 0.25));
        break;
      case 'quest':
        if (this.sample('quest', 0.8 * v)) break;
        [523, 659, 784, 1046].forEach((f, i) => this.tone('triangle', f, f, 0.25, 0.2 * v, i * 0.09));
        break;
      case 'thunder':
        if (!this.throttle('thunder', 2)) return;
        if (this.sample('thunder', 1.0 * v)) break;
        this.noiseBurst(2.5, 'lowpass', 600, 0.8 * v, 60);
        break;
      case 'ballista':
        if (!this.throttle('ballista', 0.1)) return;
        if (this.sample('ballista', 0.8 * v)) break;
        this.tone('square', 220, 90, 0.15, 0.2 * v);
        break;
      case 'mortar':
        if (!this.throttle('mortar', 0.1)) return;
        if (this.sample('mortar', 0.9 * v)) break;
        this.tone('sine', 90, 30, 0.5, 0.8 * v);
        break;
      case 'phantom':
        if (!this.throttle('phantom', 0.8)) return;
        if (this.sample('phantom', 0.7 * v)) break;
        this.tone('sawtooth', 900, 300, 0.6, 0.1 * v);
        break;
      case 'spider':
        if (!this.throttle('spider', 0.6)) return;
        if (this.sample('spider', 0.7 * v)) break;
        this.noiseBurst(0.3, 'highpass', 3000, 0.2 * v);
        break;
      case 'legdamage':
        if (!this.throttle('legdamage', 0.3)) return;
        if (this.sample('legdamage', 0.9 * v)) break;
        this.tone('sine', 120, 50, 0.3, 0.6 * v);
        break;
      case 'dawn':
        [523, 659, 784, 1046].forEach((f, i) => this.tone('triangle', f, f, 0.3, 0.2 * v, i * 0.12));
        break;
      case 'victory':
        [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone('triangle', f, f, 0.45, 0.24 * v, i * 0.14));
        break;
      case 'defeat':
        [392, 330, 262, 196].forEach((f, i) => this.tone('triangle', f, f * 0.97, 0.5, 0.22 * v, i * 0.2));
        break;
      default:
        break;
    }
    this.onAudible?.();
  }

  /** Stand-ins for the monsters' recorded voices while those load (or if they cannot). */
  private monsterSynth(name: MonsterSound, v: number, rate: number): void {
    switch (name) {
      case 'groan':
        this.tone('sawtooth', (105 + Math.random() * 25) * rate, 68 * rate, 0.9, 0.12 * v);
        this.noiseBurst(0.6, 'lowpass', 420, 0.08 * v);
        break;
      case 'zhurt':
        this.tone('sawtooth', 190 * rate, 90 * rate, 0.3, 0.14 * v);
        break;
      case 'rattle':
        for (let i = 0; i < 5; i += 1) this.tone('square', (900 + Math.random() * 600) * rate, 500 * rate, 0.03, 0.06 * v, i * 0.07);
        break;
      case 'bow':
        this.tone('triangle', 260 * rate, 120, 0.12, 0.18 * v);
        this.noiseBurst(0.25, 'bandpass', 2400, 0.18 * v, 900, 1.2);
        break;
      case 'arrowhit':
        this.noiseBurst(0.08, 'bandpass', 900, 0.35 * v, 400, 1.5);
        this.tone('sine', 180, 90, 0.08, 0.2 * v);
        break;
      case 'fuse':
        this.noiseBurst(1.5, 'highpass', 2600, 0.24 * v, 4400);
        break;
      case 'charged':
        for (let i = 0; i < 6; i += 1) this.noiseBurst(0.05, 'highpass', 3000 + Math.random() * 3000, 0.2 * v, undefined, 2);
        break;
      case 'teleport':
        this.tone('sine', 220 * rate, 1400 * rate, 0.35, 0.16 * v);
        this.tone('sine', 1500 * rate, 260 * rate, 0.35, 0.1 * v, 0.2);
        break;
      case 'scream':
        this.noiseBurst(1.2, 'bandpass', 1800, 0.3 * v, 600, 3);
        this.tone('sawtooth', 70, 50, 1.1, 0.15 * v);
        break;
      case 'witch':
        [0, 0.16, 0.3].forEach((d, i) => this.tone('square', (720 - i * 60) * rate, 560 * rate, 0.1, 0.07 * v, d));
        break;
      case 'splash':
        this.noiseBurst(0.12, 'highpass', 3800, 0.35 * v);
        this.noiseBurst(0.5, 'bandpass', 900, 0.3 * v, 2600, 0.8);
        break;
      case 'drink':
        [0, 0.28, 0.56].forEach((d) => this.tone('sine', 300 * rate, 180 * rate, 0.14, 0.2 * v, d));
        break;
      case 'illager':
        this.tone('sawtooth', 150 * rate, 120 * rate, 0.4, 0.1 * v);
        this.tone('sawtooth', 160 * rate, 200 * rate, 0.25, 0.08 * v, 0.2);
        break;
      case 'raidhorn':
        this.tone('sawtooth', 73, 70, 3, 0.2 * v);
        this.tone('sawtooth', 110, 104, 3, 0.12 * v);
        this.tone('sine', 37, 35, 3, 0.35 * v);
        break;
      case 'roar':
        this.tone('sawtooth', 90 * rate, 50 * rate, 1.4, 0.22 * v);
        this.noiseBurst(1.4, 'lowpass', 700, 0.4 * v, 120);
        break;
      case 'cast':
        [523, 659, 831, 1047].forEach((f, i) => this.tone('sine', f * rate, f * 1.5 * rate, 0.5, 0.07 * v, i * 0.1));
        this.noiseBurst(0.9, 'bandpass', 900, 0.12 * v, 4000, 1.2);
        break;
      case 'fangs':
        this.noiseBurst(0.1, 'bandpass', 1400, 0.45 * v, 500, 1.5);
        this.tone('square', 260, 90, 0.1, 0.12 * v);
        break;
      case 'vex':
        this.tone('sine', 1800 * rate, 2600 * rate, 0.35, 0.08 * v);
        this.noiseBurst(0.3, 'highpass', 4000, 0.1 * v);
        break;
      case 'witherspawn':
        this.noiseBurst(2.6, 'lowpass', 1500, 1 * v, 50);
        this.tone('sawtooth', 80, 40, 2.6, 0.25 * v, 0.2);
        this.tone('sine', 50, 25, 2.6, 0.8 * v);
        break;
      case 'withershoot':
        this.noiseBurst(0.5, 'lowpass', 1400, 0.45 * v, 200);
        this.tone('sawtooth', 160 * rate, 70 * rate, 0.4, 0.1 * v);
        break;
      case 'withergrowl':
        this.tone('sawtooth', 65 * rate, 52 * rate, 1.3, 0.16 * v);
        this.tone('sawtooth', 98 * rate, 80 * rate, 1.3, 0.1 * v);
        break;
      case 'ghast':
        this.tone('sine', 900 * rate, 640 * rate, 1.2, 0.1 * v);
        this.tone('sine', 1100 * rate, 700 * rate, 1, 0.06 * v, 0.2);
        break;
      case 'fireball':
        this.noiseBurst(0.7, 'lowpass', 2400, 0.6 * v, 300);
        this.tone('sine', 1200, 300, 0.3, 0.08 * v);
        break;
      case 'totem':
        [784, 988, 1175, 1568, 2093].forEach((f, i) => this.tone('triangle', f, f, 0.5, 0.14 * v, i * 0.08));
        this.noiseBurst(1, 'highpass', 2500, 0.2 * v, 6000);
        break;
      case 'clank':
        this.tone('square', 1900 * rate, 1600 * rate, 0.12, 0.08 * v);
        this.noiseBurst(0.12, 'bandpass', 3200, 0.3 * v, undefined, 4);
        break;
      case 'bossdeath':
        this.noiseBurst(3, 'lowpass', 900, 0.9 * v, 40);
        this.tone('sawtooth', 110, 30, 2.5, 0.2 * v);
        break;
      case 'beacon':
        [262, 392, 523, 784].forEach((f, i) => this.tone('sine', f, f * 1.01, 1.6, 0.1 * v, i * 0.18));
        break;
      case 'slime':
        this.noiseBurst(0.18, 'lowpass', 700, 0.4 * v, 150);
        this.tone('sine', 220 * rate, 120 * rate, 0.15, 0.25 * v);
        break;
      case 'shatter':
        this.noiseBurst(0.6, 'lowpass', 600, 0.9 * v, 60);
        for (let i = 0; i < 12; i += 1) this.tone('triangle', (2200 + Math.random() * 2400) * rate, 1600, 0.25, 0.06 * v, i * 0.09);
        break;
      case 'quake':
        this.noiseBurst(2, 'lowpass', 300, 0.9 * v, 40);
        this.tone('sine', 45, 30, 2, 0.5 * v);
        break;
      case 'freeze':
        this.noiseBurst(1, 'highpass', 3000, 0.3 * v, 7000);
        for (let i = 0; i < 6; i += 1) this.tone('triangle', (2600 + i * 300) * rate, 3200, 0.1, 0.05 * v, i * 0.08);
        break;
      case 'blaze':
        this.noiseBurst(1.2, 'bandpass', 600, 0.35 * v, 1400, 0.8);
        this.tone('sawtooth', 120 * rate, 90 * rate, 1, 0.06 * v);
        break;
      case 'gurgle':
        this.tone('sawtooth', 95 * rate, 70 * rate, 0.9, 0.1 * v);
        for (let i = 0; i < 5; i += 1) this.tone('sine', (300 + Math.random() * 300) * rate, 150, 0.06, 0.12 * v, i * 0.12);
        break;
      case 'wind':
        this.noiseBurst(0.6, 'bandpass', 900, 0.6 * v, 2500, 0.7);
        this.tone('sine', 160, 60, 0.3, 0.25 * v);
        break;
      case 'bear':
        this.tone('sawtooth', 110 * rate, 70 * rate, 1.1, 0.2 * v);
        this.noiseBurst(1, 'lowpass', 600, 0.35 * v, 150);
        break;
      case 'croak':
        this.tone('square', 140 * rate, 110 * rate, 0.12, 0.08 * v);
        this.tone('square', 150 * rate, 120 * rate, 0.12, 0.08 * v, 0.15);
        break;
      case 'magma':
        this.noiseBurst(0.25, 'lowpass', 600, 0.45 * v, 120);
        this.noiseBurst(0.5, 'highpass', 4000, 0.15 * v);
        break;
      case 'queen':
        this.noiseBurst(1.2, 'bandpass', 2600, 0.4 * v, 900, 2);
        for (let i = 0; i < 8; i += 1) this.tone('square', 1400 * rate, 900, 0.03, 0.05 * v, i * 0.09);
        break;
      case 'chapter':
        [392, 523, 659, 784].forEach((f, i) => this.tone('triangle', f, f, 0.7, 0.14 * v, i * 0.14));
        this.tone('sine', 98, 98, 1.6, 0.25 * v);
        break;
      case 'zap':
        this.tone('sawtooth', 800 * rate, 200 * rate, 0.25, 0.12 * v);
        this.noiseBurst(0.3, 'highpass', 2500, 0.25 * v, 5000);
        break;
      default:
        break;
    }
  }
}

export type { Material };
