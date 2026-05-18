/* ============================================================
   NEXUS PROTOCOL — Co-op Sci-Fi Adventure
   Full client-side game: Phaser 3 + Socket.IO multiplayer
   ============================================================ */
'use strict';

// ── Constants ────────────────────────────────────────────────────────────────
const GW = 1280, GH = 720;
const TILE = 32;
const PSPEED = 190;
const CHAPTERS = ['chapter1','chapter2','chapter3'];

// ── Global Game State ────────────────────────────────────────────────────────
const GS = {
  socket: null,
  roomId: null,
  playerIndex: 0,
  playerData: null,
  otherPlayers: [],
  storyChoices: {},
  chapter: 0,
  saveKey: null,
  chatMessages: []
};

// ── Socket Manager ────────────────────────────────────────────────────────────
class SocketManager {
  constructor() {
    this.socket = null;
    this._handlers = {};
  }
  connect() {
    this.socket = io();
    GS.socket = this;
    const events = ['room_created','room_joined','join_error','room_full',
      'player_joined','player_left','player_updated','player_ready_update',
      'all_ready','game_event','ability_used','game_saved','game_loaded',
      'load_error','chat'];
    events.forEach(ev => {
      this.socket.on(ev, d => this._fire(ev, d));
    });
    this.socket.on('connect', () => console.log('Connected:', this.socket.id));
  }
  on(ev, fn) {
    (this._handlers[ev] = this._handlers[ev] || []).push(fn);
    return () => this.off(ev, fn);
  }
  off(ev, fn) {
    if (this._handlers[ev]) this._handlers[ev] = this._handlers[ev].filter(h => h !== fn);
  }
  _fire(ev, d) {
    (this._handlers[ev] || []).forEach(fn => fn(d));
  }
  emit(ev, d) { this.socket && this.socket.emit(ev, d); }
  id() { return this.socket ? this.socket.id : null; }
}
const NET = new SocketManager();

// ── Audio Manager (Web Audio API, no files needed) ───────────────────────────
class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
  }
  init() {
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    } catch(e) { console.warn('Audio unavailable'); }
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  _gain(vol = 1) {
    const g = this.ctx.createGain();
    g.gain.value = vol;
    g.connect(this.master);
    return g;
  }
  _osc(type, freq, dur, vol = 0.5, g = null) {
    if (!this.ctx || this.muted) return;
    const gain = g || this._gain(vol);
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, this.ctx.currentTime);
    o.connect(gain);
    o.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
    o.stop(this.ctx.currentTime + dur + 0.05);
  }
  _noise(dur, vol = 0.3) {
    if (!this.ctx || this.muted) return;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this._gain(vol);
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 800;
    src.connect(filt);
    filt.connect(g);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
    src.start();
  }
  shoot()    { this._osc('sawtooth', 880, 0.12, 0.4); this._osc('sawtooth', 660, 0.08, 0.2); }
  enemyShoot(){ this._osc('sawtooth', 440, 0.12, 0.3); }
  hit()      { this._noise(0.08, 0.4); this._osc('square', 220, 0.1, 0.3); }
  die()      { this._osc('sawtooth', 330, 0.3, 0.5); this._osc('sawtooth', 110, 0.5, 0.4); }
  pickup()   { this._osc('sine', 880, 0.1, 0.3); this._osc('sine', 1320, 0.15, 0.3); }
  ui()       { this._osc('sine', 660, 0.08, 0.25); }
  uiBack()   { this._osc('sine', 440, 0.08, 0.2); }
  explosion(){ this._noise(0.6, 0.6); this._osc('sawtooth', 60, 0.8, 0.5); }
  checkpoint(){ [880,1100,1320].forEach((f,i) => setTimeout(() => this._osc('sine',f,0.2,0.4), i*80)); }
  ability()  { this._osc('sine', 1760, 0.05, 0.3); this._osc('triangle', 880, 0.2, 0.4); }
  bossHit()  { this._noise(0.15, 0.5); this._osc('square', 110, 0.2, 0.4); }
  victory()  { [523,659,784,1047].forEach((f,i) => setTimeout(() => this._osc('sine',f,0.4,0.4), i*120)); }
}
const SFX = new AudioManager();

// ── Sprite Factory ────────────────────────────────────────────────────────────
const SF = {
  make(w, h, fn) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    fn(c.getContext('2d'));
    return c;
  },

  register(scene, key, w, h, fn) {
    if (scene.textures.exists(key)) return;
    const c = this.make(w, h, fn);
    scene.textures.addCanvas(key, c);
  },

  // Creates an animated spritesheet: fn(ctx, frame, total)
  sheet(scene, key, fw, fh, frames, fn) {
    if (scene.textures.exists(key)) return;
    const c = document.createElement('canvas');
    c.width = fw * frames; c.height = fh;
    const ctx = c.getContext('2d');
    for (let i = 0; i < frames; i++) { ctx.save(); ctx.translate(i * fw, 0); fn(ctx, i, frames); ctx.restore(); }
    scene.textures.addCanvas(key, c);
    scene.textures.get(key).add('__BASE', 0, 0, 0, fw * frames, fh);
    const frameData = [];
    for (let i = 0; i < frames; i++) frameData.push({ x: i * fw, y: 0, width: fw, height: fh });
    const tex = scene.textures.get(key);
    frameData.forEach((f, i) => tex.add(i, 0, f.x, f.y, f.width, f.height));
  },

  all(scene) {
    this.nova(scene);
    this.rook(scene);
    this.drone(scene);
    this.guard(scene);
    this.boss(scene);
    this.env(scene);
    this.ui(scene);
    this.fx(scene);
  },

  _char(ctx, fw, fh, colors, frame) {
    const { body, visor, accent, dark } = colors;
    const leg = [0,3,0,-3][frame % 4];
    const arm = [2,0,-2,0][frame % 4];

    ctx.clearRect(0, 0, fw, fh);

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(fw/2, fh-3, 10, 4, 0, 0, Math.PI*2); ctx.fill();

    // legs
    ctx.fillStyle = dark;
    ctx.fillRect(fw/2-10, fh-24+leg, 9, 14);
    ctx.fillRect(fw/2+1,  fh-24-leg, 9, 14);

    // boots
    ctx.fillStyle = accent;
    ctx.fillRect(fw/2-11, fh-12+leg, 10, 5);
    ctx.fillRect(fw/2,    fh-12-leg, 10, 5);

    // belt
    ctx.fillStyle = accent;
    ctx.fillRect(fw/2-11, fh-28, 22, 4);

    // torso
    ctx.fillStyle = body;
    ctx.fillRect(fw/2-12, fh-46, 24, 18);

    // chest armor
    ctx.fillStyle = Phaser.Display.Color.ValueToColor(body).lighten(15).rgba;
    ctx.fillRect(fw/2-9, fh-44, 18, 14);

    // chest light
    ctx.shadowBlur = 10; ctx.shadowColor = visor;
    ctx.fillStyle = visor;
    ctx.fillRect(fw/2-3, fh-38, 6, 6);
    ctx.shadowBlur = 0;

    // arms
    ctx.fillStyle = body;
    ctx.fillRect(fw/2-18, fh-44+arm, 8, 16);
    ctx.fillRect(fw/2+10, fh-44-arm, 8, 16);

    // neck
    ctx.fillStyle = dark;
    ctx.fillRect(fw/2-5, fh-50, 10, 6);

    // helmet
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(fw/2, fh-57, 12, 0, Math.PI*2);
    ctx.fill();

    // visor
    ctx.shadowBlur = 12; ctx.shadowColor = visor;
    ctx.fillStyle = visor;
    ctx.beginPath();
    ctx.ellipse(fw/2, fh-57, 7, 5, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // visor shine
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillRect(fw/2-5, fh-61, 4, 2);
  },

  nova(scene) {
    this.sheet(scene, 'nova', 36, 72, 8, (ctx, f) => {
      this._char(ctx, 36, 72, {
        body: '#1a3a8c', visor: '#00eeff', accent: '#ff8c00', dark: '#0a1e5c'
      }, f);
      // antenna
      ctx.fillStyle = '#ff8c00';
      ctx.fillRect(30, 72-70, 2, 6);
      ctx.shadowBlur=6; ctx.shadowColor='#ff8c00';
      ctx.fillStyle='#ffaa00';
      ctx.beginPath(); ctx.arc(31,72-70,2,0,Math.PI*2); ctx.fill();
      ctx.shadowBlur=0;
    });
    scene.anims.create({ key:'nova_idle',  frames: scene.anims.generateFrameNumbers('nova',{start:0,end:0}), frameRate:4, repeat:-1 });
    scene.anims.create({ key:'nova_walk',  frames: scene.anims.generateFrameNumbers('nova',{start:0,end:3}), frameRate:8, repeat:-1 });
    scene.anims.create({ key:'nova_shoot', frames: scene.anims.generateFrameNumbers('nova',{start:4,end:5}), frameRate:10, repeat:0 });
    scene.anims.create({ key:'nova_hit',   frames: scene.anims.generateFrameNumbers('nova',{start:6,end:6}), frameRate:4, repeat:0 });
    scene.anims.create({ key:'nova_dead',  frames: scene.anims.generateFrameNumbers('nova',{start:7,end:7}), frameRate:4, repeat:0 });
  },

  rook(scene) {
    this.sheet(scene, 'rook', 38, 72, 8, (ctx, f) => {
      this._char(ctx, 38, 72, {
        body: '#7a2800', visor: '#ff6600', accent: '#cc2200', dark: '#3a1000'
      }, f);
      // shoulder armor
      ctx.fillStyle = '#aa4400';
      ctx.fillRect(0, 72-46, 8, 10);
      ctx.fillRect(30, 72-46, 8, 10);
    });
    scene.anims.create({ key:'rook_idle',  frames: scene.anims.generateFrameNumbers('rook',{start:0,end:0}), frameRate:4, repeat:-1 });
    scene.anims.create({ key:'rook_walk',  frames: scene.anims.generateFrameNumbers('rook',{start:0,end:3}), frameRate:8, repeat:-1 });
    scene.anims.create({ key:'rook_shoot', frames: scene.anims.generateFrameNumbers('rook',{start:4,end:5}), frameRate:10, repeat:0 });
    scene.anims.create({ key:'rook_hit',   frames: scene.anims.generateFrameNumbers('rook',{start:6,end:6}), frameRate:4, repeat:0 });
    scene.anims.create({ key:'rook_dead',  frames: scene.anims.generateFrameNumbers('rook',{start:7,end:7}), frameRate:4, repeat:0 });
  },

  drone(scene) {
    this.sheet(scene, 'drone', 32, 32, 4, (ctx, f) => {
      ctx.clearRect(0,0,32,32);
      const r = (f * 22.5) * Math.PI/180;
      ctx.save(); ctx.translate(16,16); ctx.rotate(r);
      ctx.shadowBlur=12; ctx.shadowColor='#ff0000';
      // body
      ctx.fillStyle='#110011';
      ctx.fillRect(-8,-8,16,16);
      ctx.fillRect(-12,-4,24,8);
      // core
      ctx.fillStyle='#ff0000';
      ctx.beginPath(); ctx.arc(0,0,4,0,Math.PI*2); ctx.fill();
      // eyes
      ctx.fillStyle='#ff4400';
      ctx.fillRect(-6,-6,3,3); ctx.fillRect(3,-6,3,3);
      // weapon tips
      ctx.fillStyle='#ff3300';
      ctx.fillRect(-14,-2,4,4); ctx.fillRect(10,-2,4,4);
      ctx.shadowBlur=0; ctx.restore();
    });
    scene.anims.create({ key:'drone_fly', frames: scene.anims.generateFrameNumbers('drone',{start:0,end:3}), frameRate:8, repeat:-1 });
  },

  guard(scene) {
    this.sheet(scene, 'guard', 40, 48, 4, (ctx, f) => {
      ctx.clearRect(0,0,40,48);
      const bob = Math.sin(f * Math.PI/2) * 2;
      ctx.shadowBlur=14; ctx.shadowColor='#cc0044';

      // legs
      ctx.fillStyle='#1a0033';
      ctx.fillRect(10, 32+bob, 8, 14); ctx.fillRect(22, 32-bob, 8, 14);
      // body
      ctx.fillStyle='#2a0055';
      ctx.fillRect(6, 14, 28, 20);
      // chest plates
      ctx.fillStyle='#4400aa';
      ctx.fillRect(8,15,12,16); ctx.fillRect(20,15,12,16);
      // core
      ctx.fillStyle='#cc0044';
      ctx.beginPath(); ctx.arc(20,24,6,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#ff00aa'; ctx.shadowBlur=18; ctx.shadowColor='#ff00aa';
      ctx.beginPath(); ctx.arc(20,24,3,0,Math.PI*2); ctx.fill();
      ctx.shadowBlur=0;
      // head
      ctx.fillStyle='#1a0033';
      ctx.fillRect(12,2,16,14);
      // visor
      ctx.fillStyle='#ff3366'; ctx.shadowBlur=10; ctx.shadowColor='#ff3366';
      ctx.fillRect(14,6,12,4);
      ctx.shadowBlur=0;
      // shoulder cannon
      ctx.fillStyle='#220044';
      ctx.fillRect(32,10,8,6);
    });
    scene.anims.create({ key:'guard_walk', frames: scene.anims.generateFrameNumbers('guard',{start:0,end:3}), frameRate:6, repeat:-1 });
  },

  boss(scene) {
    this.sheet(scene, 'boss', 80, 90, 6, (ctx, f) => {
      ctx.clearRect(0,0,80,90);
      const pulse = 0.5 + 0.5*Math.sin(f * Math.PI/3);
      ctx.shadowBlur = 20 + pulse*10; ctx.shadowColor='#ff00ff';

      // legs
      ctx.fillStyle='#110022';
      ctx.fillRect(15,66,16,20); ctx.fillRect(49,66,16,20);
      // cloak/body
      ctx.fillStyle='#0a0015';
      ctx.beginPath();
      ctx.moveTo(10,80); ctx.lineTo(5,20); ctx.lineTo(75,20); ctx.lineTo(70,80);
      ctx.fill();
      // body armor
      ctx.fillStyle='#220044';
      ctx.fillRect(16,20,48,46);
      // chest crystal
      const grad = ctx.createRadialGradient(40,43,2,40,43,16);
      grad.addColorStop(0,'#ff00ff'); grad.addColorStop(0.5,'#8800aa'); grad.addColorStop(1,'#330033');
      ctx.fillStyle=grad;
      ctx.beginPath(); ctx.arc(40,43,16,0,Math.PI*2); ctx.fill();
      // inner glow
      ctx.fillStyle=`rgba(255,0,255,${0.4+pulse*0.4})`;
      ctx.beginPath(); ctx.arc(40,43,8,0,Math.PI*2); ctx.fill();
      ctx.shadowBlur=0;
      // shoulder spikes
      ctx.fillStyle='#440066';
      [[8,18],[64,18],[4,30],[68,30]].forEach(([x,y]) => {
        ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x-6,y-10); ctx.lineTo(x+6,y-10); ctx.fill();
      });
      // head
      ctx.fillStyle='#110022';
      ctx.beginPath(); ctx.arc(40,14,16,0,Math.PI*2); ctx.fill();
      // mask
      ctx.fillStyle='#cc00ff'; ctx.shadowBlur=12; ctx.shadowColor='#cc00ff';
      ctx.beginPath(); ctx.ellipse(40,14,10,7,0,0,Math.PI*2); ctx.fill();
      ctx.shadowBlur=0;
      // eye slits
      ctx.fillStyle='#ffffff';
      ctx.fillRect(32,11,6,3); ctx.fillRect(42,11,6,3);
    });
    scene.anims.create({ key:'boss_idle',     frames: scene.anims.generateFrameNumbers('boss',{start:0,end:5}), frameRate:6, repeat:-1 });
    scene.anims.create({ key:'boss_attack',   frames: scene.anims.generateFrameNumbers('boss',{start:3,end:5}), frameRate:10, repeat:0 });
    scene.anims.create({ key:'boss_phase2',   frames: scene.anims.generateFrameNumbers('boss',{start:0,end:5}), frameRate:10, repeat:-1 });
  },

  env(scene) {
    // floor tiles — crash site
    this.register(scene, 'floor_crash', 32, 32, ctx => {
      ctx.fillStyle='#1a1208'; ctx.fillRect(0,0,32,32);
      ctx.fillStyle='#221a0a'; ctx.fillRect(1,1,30,30);
      ctx.strokeStyle='#2a2010'; ctx.lineWidth=1;
      ctx.strokeRect(0,0,32,32);
      // scorch marks
      ctx.fillStyle='rgba(255,80,0,0.08)';
      ctx.beginPath(); ctx.arc(16,16,10,0,Math.PI*2); ctx.fill();
    });
    // floor — ruins
    this.register(scene, 'floor_ruins', 32, 32, ctx => {
      ctx.fillStyle='#0a0818'; ctx.fillRect(0,0,32,32);
      ctx.fillStyle='#0d0b20'; ctx.fillRect(1,1,30,30);
      ctx.strokeStyle='#1a1440'; ctx.lineWidth=1; ctx.strokeRect(0,0,32,32);
      // glyph
      ctx.strokeStyle='rgba(0,200,255,0.15)'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(8,8); ctx.lineTo(24,24); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(24,8); ctx.lineTo(8,24); ctx.stroke();
    });
    // floor — VOID tech
    this.register(scene, 'floor_void', 32, 32, ctx => {
      ctx.fillStyle='#0c0008'; ctx.fillRect(0,0,32,32);
      ctx.fillStyle='#110010'; ctx.fillRect(1,1,30,30);
      ctx.strokeStyle='rgba(200,0,200,0.2)'; ctx.lineWidth=1; ctx.strokeRect(4,4,24,24);
      ctx.fillStyle='rgba(150,0,150,0.1)';
      ctx.fillRect(14,0,4,32); ctx.fillRect(0,14,32,4);
    });
    // wall
    this.register(scene, 'wall', 32, 32, ctx => {
      ctx.fillStyle='#0e0e0e'; ctx.fillRect(0,0,32,32);
      ctx.fillStyle='#161616'; ctx.fillRect(1,1,30,14);
      ctx.fillStyle='#121212'; ctx.fillRect(1,17,30,14);
      ctx.strokeStyle='#222'; ctx.lineWidth=1; ctx.strokeRect(0,0,32,32);
    });
    // wall ruins
    this.register(scene, 'wall_ruins', 32, 32, ctx => {
      ctx.fillStyle='#080614'; ctx.fillRect(0,0,32,32);
      ctx.fillStyle='rgba(0,180,255,0.1)';
      ctx.beginPath(); ctx.arc(16,16,12,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle='#1a1030'; ctx.lineWidth=2; ctx.strokeRect(0,0,32,32);
    });
    // wall void
    this.register(scene, 'wall_void', 32, 32, ctx => {
      ctx.fillStyle='#0a0010'; ctx.fillRect(0,0,32,32);
      ctx.strokeStyle='rgba(180,0,180,0.3)'; ctx.lineWidth=2; ctx.strokeRect(2,2,28,28);
      ctx.fillStyle='rgba(150,0,150,0.15)'; ctx.fillRect(0,14,32,4);
    });
    // crate
    this.register(scene, 'crate', 32, 28, ctx => {
      ctx.fillStyle='#5a3c10'; ctx.fillRect(1,1,30,26);
      ctx.fillStyle='#7a5218'; ctx.fillRect(2,2,28,8);
      ctx.fillStyle='#4a3008'; ctx.fillRect(2,10,28,16);
      ctx.strokeStyle='#8a6428'; ctx.lineWidth=2;
      ctx.strokeRect(1,1,30,26);
      ctx.strokeStyle='#6a4c18';
      ctx.beginPath(); ctx.moveTo(16,1); ctx.lineTo(16,27); ctx.stroke();
    });
    // terminal
    this.register(scene, 'terminal', 28, 36, ctx => {
      ctx.fillStyle='#1a1a2e'; ctx.fillRect(2,4,24,28);
      ctx.fillStyle='#00ccff'; ctx.shadowBlur=8; ctx.shadowColor='#00ccff';
      ctx.fillRect(5,7,18,16);
      ctx.shadowBlur=0;
      ctx.fillStyle='#003344'; ctx.fillRect(6,8,16,14);
      // scanline
      ctx.fillStyle='rgba(0,255,255,0.3)'; ctx.fillRect(6,13,16,2);
      // base
      ctx.fillStyle='#111'; ctx.fillRect(6,32,16,4);
      ctx.fillRect(0,34,28,2);
    });
    // beacon
    this.register(scene, 'beacon', 20, 32, ctx => {
      ctx.fillStyle='#2a2a2a'; ctx.fillRect(7,16,6,16); // pole
      ctx.fillStyle='#ffaa00'; ctx.shadowBlur=12; ctx.shadowColor='#ffaa00';
      ctx.beginPath(); ctx.arc(10,12,8,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#ffffff'; ctx.shadowBlur=0;
      ctx.beginPath(); ctx.arc(10,12,4,0,Math.PI*2); ctx.fill();
    });
    // energy node
    this.register(scene, 'node', 24, 24, ctx => {
      ctx.fillStyle='#0a0a1a'; ctx.fillRect(4,4,16,16);
      ctx.strokeStyle='#0044ff'; ctx.lineWidth=2; ctx.strokeRect(4,4,16,16);
      ctx.fillStyle='rgba(0,100,255,0.3)';
      ctx.beginPath(); ctx.arc(12,12,6,0,Math.PI*2); ctx.fill();
    });
    // door
    this.register(scene, 'door', 32, 48, ctx => {
      ctx.fillStyle='#222'; ctx.fillRect(2,2,28,44);
      ctx.strokeStyle='#00ccff'; ctx.lineWidth=2; ctx.strokeRect(2,2,28,44);
      ctx.fillStyle='rgba(0,200,255,0.2)'; ctx.fillRect(3,3,26,42);
      ctx.fillStyle='#00ccff'; ctx.shadowBlur=8; ctx.shadowColor='#00ccff';
      ctx.fillRect(12,20,8,8);
      ctx.shadowBlur=0;
    });
    // crystal collectible
    this.register(scene, 'crystal', 16, 22, ctx => {
      ctx.fillStyle='rgba(0,255,200,0.7)'; ctx.shadowBlur=10; ctx.shadowColor='#00ffcc';
      ctx.beginPath();
      ctx.moveTo(8,0); ctx.lineTo(14,8); ctx.lineTo(8,22); ctx.lineTo(2,8); ctx.closePath();
      ctx.fill();
      ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.fillRect(5,3,3,6);
      ctx.shadowBlur=0;
    });
    // pressure plate
    this.register(scene, 'plate', 32, 8, ctx => {
      ctx.fillStyle='#334'; ctx.fillRect(0,0,32,8);
      ctx.strokeStyle='#557'; ctx.lineWidth=1; ctx.strokeRect(1,1,30,6);
    });
    // bullet (player)
    this.register(scene, 'bullet_p', 12, 5, ctx => {
      ctx.fillStyle='#00ffff'; ctx.shadowBlur=6; ctx.shadowColor='#00ffff';
      ctx.beginPath(); ctx.ellipse(6,2.5,5,2,0,0,Math.PI*2); ctx.fill();
      ctx.shadowBlur=0;
    });
    // bullet (enemy)
    this.register(scene, 'bullet_e', 10, 5, ctx => {
      ctx.fillStyle='#ff2200'; ctx.shadowBlur=6; ctx.shadowColor='#ff2200';
      ctx.beginPath(); ctx.ellipse(5,2.5,4,2,0,0,Math.PI*2); ctx.fill();
      ctx.shadowBlur=0;
    });
    // ability orb nova (heal/scan)
    this.register(scene, 'orb_nova', 20, 20, ctx => {
      const g = ctx.createRadialGradient(10,10,2,10,10,9);
      g.addColorStop(0,'#ffffff'); g.addColorStop(0.5,'#00eeff'); g.addColorStop(1,'rgba(0,200,255,0)');
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(10,10,9,0,Math.PI*2); ctx.fill();
    });
    // ability orb rook (grenade)
    this.register(scene, 'orb_rook', 18, 18, ctx => {
      const g = ctx.createRadialGradient(9,9,2,9,9,8);
      g.addColorStop(0,'#ffffff'); g.addColorStop(0.5,'#ff6600'); g.addColorStop(1,'rgba(255,60,0,0)');
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(9,9,8,0,Math.PI*2); ctx.fill();
    });
    // lore journal
    this.register(scene, 'journal', 16, 20, ctx => {
      ctx.fillStyle='#8B6914'; ctx.fillRect(1,1,14,18);
      ctx.fillStyle='#c8a048'; ctx.fillRect(2,2,12,16);
      ctx.fillStyle='#6a4e10'; ctx.fillRect(2,2,3,16);
      ['#8a6018','#8a6018','#8a6018'].forEach((c,i) => {
        ctx.fillStyle=c; ctx.fillRect(6,5+i*4,7,1);
      });
    });
    // shield (ROOK ability)
    this.register(scene, 'shield', 48, 56, ctx => {
      ctx.strokeStyle='rgba(255,120,0,0.7)'; ctx.lineWidth=3;
      ctx.beginPath();
      ctx.moveTo(24,2); ctx.lineTo(44,10); ctx.lineTo(44,30); ctx.lineTo(24,54); ctx.lineTo(4,30); ctx.lineTo(4,10); ctx.closePath();
      ctx.stroke();
      ctx.fillStyle='rgba(255,100,0,0.15)';
      ctx.fill();
    });
    // health pack
    this.register(scene, 'healthpack', 20, 20, ctx => {
      ctx.fillStyle='#cc0000'; ctx.fillRect(2,2,16,16);
      ctx.fillStyle='#ffffff';
      ctx.fillRect(8,5,4,10); ctx.fillRect(5,8,10,4);
    });
    // debri tile
    this.register(scene, 'debris', 32, 16, ctx => {
      ctx.fillStyle='#2a2010';
      [[0,0,14,16],[16,4,16,12],[4,8,10,8]].forEach(([x,y,w,h]) => { ctx.fillRect(x,y,w,h); });
      ctx.strokeStyle='#3a3018'; ctx.lineWidth=1; ctx.strokeRect(0,0,32,16);
    });
  },

  ui(scene) {
    // health bar bg
    this.register(scene, 'bar_bg', 130, 18, ctx => {
      ctx.fillStyle='rgba(0,0,0,0.7)'; ctx.fillRect(0,0,130,18);
      ctx.strokeStyle='#444'; ctx.lineWidth=1; ctx.strokeRect(0,0,130,18);
    });
    // health bar fill
    this.register(scene, 'bar_hp', 120, 10, ctx => {
      const g = ctx.createLinearGradient(0,0,120,0);
      g.addColorStop(0,'#22ff44'); g.addColorStop(1,'#00cc22');
      ctx.fillStyle=g; ctx.fillRect(0,0,120,10);
    });
    // xp bar fill
    this.register(scene, 'bar_xp', 120, 6, ctx => {
      const g = ctx.createLinearGradient(0,0,120,0);
      g.addColorStop(0,'#00aaff'); g.addColorStop(1,'#0044ff');
      ctx.fillStyle=g; ctx.fillRect(0,0,120,6);
    });
    // minimap bg
    this.register(scene, 'mm_bg', 160, 120, ctx => {
      ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(0,0,160,120);
      ctx.strokeStyle='#336'; ctx.lineWidth=2; ctx.strokeRect(0,0,160,120);
    });
    // avatar nova
    this.register(scene, 'av_nova', 32, 32, ctx => {
      ctx.fillStyle='#1a3a8c'; ctx.beginPath(); ctx.arc(16,16,14,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#00eeff'; ctx.shadowBlur=8; ctx.shadowColor='#00eeff';
      ctx.beginPath(); ctx.ellipse(16,16,8,6,0,0,Math.PI*2); ctx.fill(); ctx.shadowBlur=0;
      ctx.strokeStyle='#0af'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(16,16,14,0,Math.PI*2); ctx.stroke();
    });
    // avatar rook
    this.register(scene, 'av_rook', 32, 32, ctx => {
      ctx.fillStyle='#7a2800'; ctx.beginPath(); ctx.arc(16,16,14,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#ff6600'; ctx.shadowBlur=8; ctx.shadowColor='#ff6600';
      ctx.fillRect(10,13,12,6); ctx.shadowBlur=0;
      ctx.strokeStyle='#f60'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(16,16,14,0,Math.PI*2); ctx.stroke();
    });
    // cooldown overlay
    this.register(scene, 'cd_overlay', 32, 32, ctx => {
      ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.arc(16,16,14,0,Math.PI*2); ctx.fill();
    });
  },

  fx(scene) {
    // star
    this.register(scene, 'star', 4, 4, ctx => {
      ctx.fillStyle='#fff'; ctx.fillRect(1,0,2,4); ctx.fillRect(0,1,4,2);
    });
    // spark
    this.register(scene, 'spark', 6, 6, ctx => {
      ctx.fillStyle='rgba(255,220,0,0.9)'; ctx.beginPath(); ctx.arc(3,3,3,0,Math.PI*2); ctx.fill();
    });
    // blood (enemy hit)
    this.register(scene, 'dot_red', 6, 6, ctx => {
      ctx.fillStyle='rgba(200,0,0,0.8)'; ctx.beginPath(); ctx.arc(3,3,3,0,Math.PI*2); ctx.fill();
    });
    // blue dot (player hit)
    this.register(scene, 'dot_blue', 6, 6, ctx => {
      ctx.fillStyle='rgba(0,180,255,0.8)'; ctx.beginPath(); ctx.arc(3,3,3,0,Math.PI*2); ctx.fill();
    });
    // fire particle
    this.register(scene, 'fire', 8, 8, ctx => {
      const g = ctx.createRadialGradient(4,4,1,4,4,4);
      g.addColorStop(0,'#fff'); g.addColorStop(0.4,'#ff8800'); g.addColorStop(1,'rgba(200,0,0,0)');
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(4,4,4,0,Math.PI*2); ctx.fill();
    });
    // smoke
    this.register(scene, 'smoke', 12, 12, ctx => {
      ctx.fillStyle='rgba(80,80,80,0.5)'; ctx.beginPath(); ctx.arc(6,6,6,0,Math.PI*2); ctx.fill();
    });
    // explosion flash
    this.register(scene, 'flash', 64, 64, ctx => {
      const g = ctx.createRadialGradient(32,32,4,32,32,32);
      g.addColorStop(0,'rgba(255,255,200,0.9)'); g.addColorStop(0.3,'rgba(255,150,0,0.6)');
      g.addColorStop(1,'rgba(255,50,0,0)');
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(32,32,32,0,Math.PI*2); ctx.fill();
    });
    // revive pulse
    this.register(scene, 'revive_ring', 48, 48, ctx => {
      ctx.strokeStyle='rgba(0,255,150,0.8)'; ctx.lineWidth=3;
      ctx.beginPath(); ctx.arc(24,24,20,0,Math.PI*2); ctx.stroke();
    });
    // void beam
    this.register(scene, 'beam', 80, 16, ctx => {
      const g = ctx.createLinearGradient(0,0,80,0);
      g.addColorStop(0,'rgba(200,0,200,0)'); g.addColorStop(0.5,'rgba(255,0,255,0.9)'); g.addColorStop(1,'rgba(200,0,200,0)');
      ctx.fillStyle=g; ctx.fillRect(0,3,80,10);
    });
  }
};

// ── Boot Scene ────────────────────────────────────────────────────────────────
class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  create() {
    NET.connect();
    SFX.init();
    SF.all(this);
    // Remove loading overlay
    const el = document.getElementById('loading');
    if (el) {
      el.style.transition = 'opacity 0.5s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 600);
    }
    this.scene.start('Menu');
  }
}
