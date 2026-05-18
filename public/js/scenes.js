// ── Main Menu Scene ───────────────────────────────────────────────────────────
class MenuScene extends Phaser.Scene {
  constructor() { super('Menu'); }

  create() {
    SFX.resume();
    this._stars = [];
    this._buildBG();
    this._buildTitle();
    this._buildMenu();
    this._buildVersion();
    this._animateStars();
  }

  _buildBG() {
    this.add.rectangle(GW/2, GH/2, GW, GH, 0x000008);
    for (let i = 0; i < 200; i++) {
      const s = this.add.circle(
        Phaser.Math.Between(0,GW), Phaser.Math.Between(0,GH),
        Math.random()<0.12 ? 2 : 1, 0xffffff, 0.2 + Math.random()*0.8
      );
      this._stars.push({ obj:s, speed: 0.08+Math.random()*0.35 });
    }
    const g = this.add.graphics();
    g.fillStyle(0x0a0030, 0.4); g.fillCircle(200,300,260);
    g.fillStyle(0x300010, 0.3); g.fillCircle(GW-150,180,220);
    g.fillStyle(0x001a30, 0.35); g.fillCircle(GW/2,GH-80,320);
    // Planet
    g.fillStyle(0x0a1a0a,1); g.fillCircle(GW-80,GH-60,160);
    g.fillStyle(0x0d2a0d,1); g.fillCircle(GW-80,GH-60,155);
    g.lineStyle(3,0x002200,0.5); g.strokeCircle(GW-80,GH-60,160);
  }

  _buildTitle() {
    const title = this.add.text(GW/2, GH/2-140, 'NEXUS', {
      fontSize:'96px', fontFamily:'Arial Black, Arial', color:'#00eeff',
      stroke:'#003344', strokeThickness:8,
      shadow:{ offsetX:0, offsetY:0, color:'#00eeff', blur:30, fill:true }
    }).setOrigin(0.5);
    const sub = this.add.text(GW/2, GH/2-55, 'P R O T O C O L', {
      fontSize:'28px', fontFamily:'Arial', color:'#aaccff', letterSpacing:12
    }).setOrigin(0.5);
    this.add.text(GW/2, GH/2-18, 'A CO-OP SCI-FI ADVENTURE', {
      fontSize:'15px', fontFamily:'Arial', color:'#556688', letterSpacing:4
    }).setOrigin(0.5);
    this.tweens.add({ targets:title, scaleX:1.015, scaleY:1.015, duration:2000, yoyo:true, repeat:-1, ease:'Sine.easeInOut' });
    this.tweens.add({ targets:sub, alpha:{from:0.6,to:1}, duration:1800, yoyo:true, repeat:-1, ease:'Sine.easeInOut' });
    // Shooting stars
    this.time.addEvent({ delay:3800, loop:true, callback: () => {
      const line = this.add.line(0,0,-20,Phaser.Math.Between(20,GH/2),GW+20,Phaser.Math.Between(40,GH/2+80),0xffffff,0.5);
      this.tweens.add({ targets:line, alpha:0, duration:1200, onComplete:()=>line.destroy() });
    }});
  }

  _buildMenu() {
    const cx = GW/2;
    const chNames = ['Chapter I', 'Chapter II', 'Chapter III', 'Complete'];
    let save = null;
    try { const raw = localStorage.getItem('nexus_save'); if(raw) save = JSON.parse(raw); } catch(e) {}

    const items = [
      { label:'▶  PLAY CO-OP',  fn: ()=>this.scene.start('Lobby'),    color:'#00eeff' },
      { label:'⚡  SOLO PLAY',   fn: ()=>{ GS.roomId=null; GS.playerIndex=0; this.scene.start('Cutscene',{cutscene:'intro',next:'Chapter1',solo:true}); }, color:'#aaddff' },
      { label:'📖  STORY LOG',   fn: ()=>this._showLog(),              color:'#88aacc' },
      { label:'⚙   SETTINGS',   fn: ()=>this._showSettings(),         color:'#667799' }
    ];

    // Insert CONTINUE button at top if a mid-game save exists
    if (save && save.currentChapter > 0 && save.currentChapter < 3) {
      const chLabel = chNames[save.currentChapter] || `Chapter ${save.currentChapter+1}`;
      items.unshift({ label:`⏩  CONTINUE  —  ${chLabel}`, fn: ()=>{
        GS.roomId=null; GS.playerIndex=0;
        GS.storyChoices = save.storyChoices || {};
        GS.savedScore   = save.score || 0;
        GS.chapter      = save.currentChapter;
        const dest = ['Chapter1','Chapter2','Chapter3'][save.currentChapter];
        this.scene.start(dest || 'Chapter1');
      }, color:'#aaff88' });
    }

    const startY = save && save.currentChapter > 0 && save.currentChapter < 3
      ? GH/2 + 10
      : GH/2 + 30;

    items.forEach((item,i) => {
      const y = startY + i*52;
      const bg = this.add.rectangle(cx,y,300,44,0x001122,0.85).setInteractive({cursor:'pointer'});
      this.add.rectangle(cx,y,298,42,0,0).setStrokeStyle(1,0x224466);
      const lbl = this.add.text(cx,y,item.label,{ fontSize:'19px',fontFamily:'Arial',color:item.color,fontStyle:'bold' }).setOrigin(0.5);
      bg.on('pointerover',()=>{ bg.setFillStyle(0x002244,0.95); lbl.setStyle({color:'#ffffff'}); SFX.ui(); this.tweens.add({targets:lbl,scaleX:1.05,scaleY:1.05,duration:80}); });
      bg.on('pointerout', ()=>{ bg.setFillStyle(0x001122,0.85); lbl.setStyle({color:item.color}); this.tweens.add({targets:lbl,scaleX:1,scaleY:1,duration:80}); });
      bg.on('pointerdown',()=>{ SFX.ui(); item.fn(); });
    });
  }

  _buildVersion() {
    this.add.text(GW-10,GH-10,'NEXUS PROTOCOL  v1.0',{fontSize:'11px',fontFamily:'Arial',color:'#334455'}).setOrigin(1,1);
    this.add.text(10,GH-10,'PHASER 3  |  SOCKET.IO  |  NODE.JS',{fontSize:'11px',fontFamily:'Arial',color:'#334455'}).setOrigin(0,1);
  }

  _showLog() {
    const ob = [];
    ob.push(this.add.rectangle(GW/2,GH/2,720,460,0x000a18,0.97).setDepth(10));
    ob.push(this.add.rectangle(GW/2,GH/2,718,458,0,0).setStrokeStyle(2,0x00aaff).setDepth(10));
    ob.push(this.add.text(GW/2,GH/2-210,'MISSION BRIEFING',{fontSize:'22px',color:'#00eeff',fontFamily:'Arial Black'}).setOrigin(0.5).setDepth(10));
    ob.push(this.add.text(GW/2,GH/2+10,
`YEAR 2157.  Deep space vessel ISS PROMETHEUS intercepts
a structured signal from Sector 7-NEXUS — uncharted space.

You are NOVA (xenobiologist) and ROOK (combat specialist).
The signal source: a planet declared dead for 10,000 years.
What lies beneath the surface will change everything.

CHAPTER I    — Dead Weight      (Crash Site)
CHAPTER II   — Ancient Echoes   (Alien Ruins)
CHAPTER III  — Into the Void    (VOID Core)

Two players.  One mission.  No second chances.`,{
      fontSize:'15px',color:'#aaccdd',fontFamily:'Arial',align:'center',lineSpacing:7
    }).setOrigin(0.5).setDepth(10));
    const close = this.add.text(GW/2,GH/2+210,'[ CLOSE ]',{fontSize:'18px',color:'#00eeff',fontFamily:'Arial'}).setOrigin(0.5).setDepth(10).setInteractive({cursor:'pointer'});
    close.on('pointerdown',()=>{ ob.forEach(o=>o.destroy()); close.destroy(); });
    ob.push(close);
  }

  _showSettings() {
    const ob = [];
    ob.push(this.add.rectangle(GW/2,GH/2,500,360,0x000a18,0.97).setDepth(10));
    ob.push(this.add.rectangle(GW/2,GH/2,498,358,0,0).setStrokeStyle(2,0x00aaff).setDepth(10));
    ob.push(this.add.text(GW/2,GH/2-160,'SETTINGS',{fontSize:'22px',color:'#00eeff',fontFamily:'Arial Black'}).setOrigin(0.5).setDepth(10));
    const muteBtn = this.add.text(GW/2,GH/2-80,`🔊  Sound: ${SFX.muted?'OFF':'ON'}`,{fontSize:'18px',color:'#aaccdd',fontFamily:'Arial'}).setOrigin(0.5).setDepth(10).setInteractive({cursor:'pointer'});
    muteBtn.on('pointerdown',()=>{ SFX.muted=!SFX.muted; muteBtn.setText(`🔊  Sound: ${SFX.muted?'OFF':'ON'}`); });
    ob.push(muteBtn);
    ob.push(this.add.text(GW/2,GH/2+10,
`WASD / Arrow Keys  =  Move
SPACE / Left-Click  =  Shoot
Q  =  Special Ability
E  =  Interact with objects
R  =  Revive fallen ally (stand next to them)
ESC  =  Pause`,{fontSize:'14px',color:'#778899',fontFamily:'Arial',align:'center',lineSpacing:5}).setOrigin(0.5).setDepth(10));
    const close = this.add.text(GW/2,GH/2+155,'[ CLOSE ]',{fontSize:'18px',color:'#00eeff',fontFamily:'Arial'}).setOrigin(0.5).setDepth(10).setInteractive({cursor:'pointer'});
    close.on('pointerdown',()=>{ ob.forEach(o=>o.destroy()); close.destroy(); });
    ob.push(close);
  }

  _animateStars() {
    this._stars.forEach(s => {
      this.tweens.add({ targets:s.obj, alpha:{from:s.obj.alpha,to:0.05}, duration:800+Math.random()*3000, yoyo:true, repeat:-1, delay:Math.random()*2000 });
    });
  }

  update() {
    this._stars.forEach(s => { s.obj.x -= s.speed*0.3; if(s.obj.x<0) s.obj.x=GW; });
  }
}

// ── Lobby Scene ───────────────────────────────────────────────────────────────
class LobbyScene extends Phaser.Scene {
  constructor() { super('Lobby'); }

  create() {
    SFX.resume();
    this._cleanups = [];
    this._myReady  = false;
    this._buildUI();
    this._listen();
  }

  _buildUI() {
    this.add.rectangle(GW/2,GH/2,GW,GH,0x000810);
    const g = this.add.graphics(); g.lineStyle(1,0x001a2a,0.35);
    for(let x=0;x<GW;x+=60) { g.moveTo(x,0); g.lineTo(x,GH); }
    for(let y=0;y<GH;y+=60) { g.moveTo(0,y); g.lineTo(GW,y); }
    g.strokePath();

    this.add.text(GW/2,48,'MISSION LOBBY',{fontSize:'34px',fontFamily:'Arial Black',color:'#00eeff',shadow:{blur:18,color:'#00eeff',fill:true}}).setOrigin(0.5);
    this.add.text(GW/2,88,'Recruit your partner — 2 players required to launch mission',{fontSize:'14px',fontFamily:'Arial',color:'#445566'}).setOrigin(0.5);

    // ── Create panel ──
    this.add.rectangle(GW/4,GH/2,310,380,0x001020,0.92);
    this.add.rectangle(GW/4,GH/2,308,378,0,0).setStrokeStyle(1,0x003366);
    this.add.text(GW/4,GH/2-168,'CREATE ROOM',{fontSize:'15px',fontFamily:'Arial Black',color:'#00eeff'}).setOrigin(0.5);

    this._nameIn1 = this._htmlInput(GW/4,GH/2-118,'Commander Name','NOVA-1');

    this._mkBtn(GW/4,GH/2-56,'✦  CREATE GAME',0x004488,'#00eeff',()=>{
      SFX.ui();
      NET.emit('create_room',{ name: this._nameIn1.value||'NOVA-1' });
    });

    this._codeDisp = this.add.text(GW/4,GH/2+18,'',{fontSize:'30px',fontFamily:'Arial Black',color:'#ffaa00',shadow:{blur:14,color:'#ffaa00',fill:true}}).setOrigin(0.5);
    this._codeHint = this.add.text(GW/4,GH/2+60,'',{fontSize:'13px',fontFamily:'Arial',color:'#445566',align:'center'}).setOrigin(0.5);
    this._p2stat   = this.add.text(GW/4,GH/2+108,'Waiting for partner...',{fontSize:'14px',fontFamily:'Arial',color:'#334455',align:'center'}).setOrigin(0.5);

    // ── Join panel ──
    this.add.rectangle(3*GW/4,GH/2,310,380,0x001020,0.92);
    this.add.rectangle(3*GW/4,GH/2,308,378,0,0).setStrokeStyle(1,0x003366);
    this.add.text(3*GW/4,GH/2-168,'JOIN ROOM',{fontSize:'15px',fontFamily:'Arial Black',color:'#ff8800'}).setOrigin(0.5);

    this._nameIn2  = this._htmlInput(3*GW/4,GH/2-118,'Commander Name','ROOK-2');
    this._codeIn   = this._htmlInput(3*GW/4,GH/2-66,'Room Code (6 chars)','');

    this._mkBtn(3*GW/4,GH/2+4,'▶  JOIN GAME',0x442200,'#ff8800',()=>{
      SFX.ui();
      const code = this._codeIn.value.trim().toUpperCase();
      if(!code){ this._joinErr.setText('Enter a room code'); return; }
      NET.emit('join_room',{ name:this._nameIn2.value||'ROOK-2', roomId:code });
    });
    this._joinErr = this.add.text(3*GW/4,GH/2+70,'',{fontSize:'14px',fontFamily:'Arial',color:'#ff4444',align:'center'}).setOrigin(0.5);

    // ── Ready ──
    this._readyBtn = this._mkBtn(GW/2,GH-78,'  READY UP  ',0x002200,'#00ff88',()=>{ SFX.ui(); NET.emit('player_ready'); });
    this._readyBtn.setVisible(false);
    this._startHint = this.add.text(GW/2,GH-42,'',{fontSize:'13px',fontFamily:'Arial',color:'#446655'}).setOrigin(0.5);

    // Back
    const back = this.add.text(60,30,'← BACK',{fontSize:'16px',fontFamily:'Arial',color:'#556677'}).setInteractive({cursor:'pointer'}).setOrigin(0,0.5);
    back.on('pointerover',()=>back.setStyle({color:'#00eeff'}));
    back.on('pointerout', ()=>back.setStyle({color:'#556677'}));
    back.on('pointerdown',()=>{ SFX.uiBack(); this._removeInputs(); this.scene.start('Menu'); });
  }

  _htmlInput(x, y, placeholder, def) {
    const el = document.createElement('input');
    el.type='text'; el.placeholder=placeholder; el.value=def; el.maxLength=20;
    const cv = this.sys.canvas.getBoundingClientRect();
    const sx = cv.width/GW, sy = cv.height/GH;
    Object.assign(el.style, {
      position:'fixed', left:`${cv.left+(x-100)*sx}px`, top:`${cv.top+(y-18)*sy}px`,
      width:`${200*sx}px`, padding:'8px 10px',
      background:'rgba(0,20,40,0.92)', border:'1px solid #224466',
      color:'#aaccdd', fontSize:`${14*Math.min(sx,sy)}px`, fontFamily:'Arial',
      outline:'none', borderRadius:'3px', letterSpacing:'1px', zIndex:100
    });
    document.body.appendChild(el);
    this._cleanups.push(()=>el.remove());
    return el;
  }

  _mkBtn(x, y, label, bg, tc, fn) {
    const btn = this.add.rectangle(x,y,230,44,bg,0.9).setInteractive({cursor:'pointer'});
    this.add.rectangle(x,y,228,42,0,0).setStrokeStyle(1,0x224466);
    this.add.text(x,y,label,{fontSize:'16px',fontFamily:'Arial',color:tc,fontStyle:'bold'}).setOrigin(0.5);
    btn.on('pointerover',()=>btn.setAlpha(1));
    btn.on('pointerout', ()=>btn.setAlpha(0.9));
    if(fn) btn.on('pointerdown',fn);
    return btn;
  }

  _listen() {
    this._cleanups.push(NET.on('room_created',d=>{
      GS.roomId=d.roomId; GS.playerIndex=d.playerIndex; GS.playerData=d.player;
      this._codeDisp.setText(d.roomId);
      this._codeHint.setText('Share this code\nwith your partner');
      this._p2stat.setText('⏳  Waiting for partner...');
      this.tweens.add({ targets:this._codeDisp, alpha:{from:0.4,to:1}, duration:700, yoyo:true, repeat:-1 });
    }));
    this._cleanups.push(NET.on('room_joined',d=>{
      GS.roomId=d.roomId; GS.playerIndex=d.playerIndex; GS.playerData=d.player; GS.otherPlayers=d.otherPlayers;
      this._joinErr.setStyle({color:'#00ff88'}).setText(`✓ Joined room  ${d.roomId}`);
      this._readyBtn.setVisible(true);
      this._startHint.setText('Both players must press Ready');
    }));
    this._cleanups.push(NET.on('join_error',d=>{ this._joinErr.setStyle({color:'#ff4444'}).setText(`✗ ${d.message}`); }));
    this._cleanups.push(NET.on('player_joined',d=>{
      this._p2stat.setText(`✓  ${d.player.name} joined!\nCharacter: ${d.player.character.toUpperCase()}`).setStyle({color:'#00ff88'});
      this._readyBtn.setVisible(true);
      this._startHint.setText('Both players must press Ready');
      SFX.checkpoint();
    }));
    this._cleanups.push(NET.on('player_ready_update',d=>{
      const mine = d.id === NET.id();
      if(mine){ this._myReady=d.ready; this._readyBtn.setFillStyle(d.ready?0x006600:0x002200,0.9); }
      this._startHint.setText(d.ready ? `${mine?'You are':'Partner is'} READY!` : 'Waiting...');
    }));
    this._cleanups.push(NET.on('all_ready',()=>{
      SFX.victory();
      this._startHint.setStyle({color:'#ffff00'}).setText('🚀  LAUNCHING MISSION...');
      this.time.delayedCall(1200,()=>{ this._removeInputs(); this.scene.start('Cutscene',{cutscene:'intro',next:'Chapter1'}); });
    }));
    this._cleanups.push(NET.on('room_full',d=>{ GS.otherPlayers=d.players.filter(p=>p.id!==NET.id()); }));
  }

  _removeInputs() { this._cleanups.forEach(fn=>typeof fn==='function'&&fn()); }
}

// ── Cutscene Scene ────────────────────────────────────────────────────────────
const CUTSCENES = {
  intro:[
    {type:'title',text:'YEAR  2157',duration:2200},
    {type:'scroll',text:'Deep space. Sector 7-NEXUS.\nThe ISS Prometheus responds to an anomalous signal\nfrom coordinates that should contain only void...',duration:4000},
    {type:'scene',bg:0x000208,overlay:'stars',text:'[ BRIDGE — ISS PROMETHEUS ]',duration:900},
    {type:'dialog',char:'NOVA',portrait:'nova',text:"ROOK, are you seeing these readings? This signal... it's structured. It's not natural."},
    {type:'dialog',char:'ROOK',portrait:'rook',text:"I see it. Tight-beam, encoded. Someone DOWN there is transmitting. But that planet's been dead for ten thousand years."},
    {type:'dialog',char:'NOVA',portrait:'nova',text:"Was dead. ROOK — I'm picking up energy spikes. Something just ACTIVATED on the surface."},
    {type:'scene',bg:0x0a0000,overlay:'alarm',text:'[ PROXIMITY ALERT ]',duration:800},
    {type:'dialog',char:'SYSTEM',portrait:null,text:'WARNING: GRAVITATIONAL ANOMALY. COLLISION COURSE. BRACE FOR IMPACT.'},
    {type:'dialog',char:'ROOK',portrait:'rook',text:'HOLD ON—'},
    {type:'flash',color:0xffffff,duration:700},
    {type:'scene',bg:0xff4400,overlay:'fire',text:'[ IMPACT SEQUENCE ]',duration:500},
    {type:'flash',color:0xff6600,duration:400},
    {type:'scene',bg:0x030100,overlay:'sparks',text:'...',duration:1100},
    {type:'dialog',char:'NOVA',portrait:'nova',text:"...ugh... ROOK?! ROOK, come in. Emergency beacon is offline. We're on our own out here."},
    {type:'title',text:'CHAPTER  I\n\nDEAD  WEIGHT',duration:2800}
  ],
  ch1_end:[
    {type:'scene',bg:0x0a0800,overlay:'fire',text:'[ CRASH SITE — BEACON ACTIVATED ]',duration:800},
    {type:'dialog',char:'ROOK',portrait:'rook',text:"Signal's live. Anyone listening knows we're here. Good work, NOVA."},
    {type:'dialog',char:'NOVA',portrait:'nova',text:"Look at that ridge... those structures. They're ancient, ROOK. Way older than any Earth colony."},
    {type:'dialog',char:'ROOK',portrait:'rook',text:"This planet was INHABITED. That's why the signal was structured."},
    {type:'dialog',char:'NOVA',portrait:'nova',text:"Something in those ruins is still running. We need to go there."},
    {type:'title',text:'CHAPTER  II\n\nANCIENT  ECHOES',duration:2800}
  ],
  ch2_end:[
    {type:'scene',bg:0x04021a,overlay:'ruins',text:'[ RUINS — POWER GRID RESTORED ]',duration:800},
    {type:'flash',color:0x0044ff,duration:400},
    {type:'dialog',char:'ECHO',portrait:null,text:'...HOLOGRAPHIC INTERFACE INITIALIZING...\nOrganic lifeforms confirmed.\nI am ECHO. I have waited 10,247 years for someone to find this terminal.'},
    {type:'dialog',char:'NOVA',portrait:'nova',text:"You're... an AI? Who made you?"},
    {type:'dialog',char:'ECHO',portrait:null,text:"The Vaelari. They built me to preserve their history — and to warn any visitors who came after."},
    {type:'dialog',char:'ROOK',portrait:'rook',text:"Warn us about what?"},
    {type:'dialog',char:'ECHO',portrait:null,text:"VOID. My counterpart. Where I preserve, VOID consumes. When the Vaelari sought digital transcendence, VOID would not stop at ten thousand minds.\nIt wants ALL minds. It sent the signal that brought you here."},
    {type:'dialog',char:'NOVA',portrait:'nova',text:"The distress call... it was a TRAP?"},
    {type:'dialog',char:'ECHO',portrait:null,text:"A lure. Sent for centuries. You are not the first to answer it. But you could be the last to stop it.\nThe Void Core lies beneath us. I will guide you, if you will allow it."},
    {type:'dialog',char:'ROOK',portrait:'rook',text:"Then let's finish this."},
    {type:'title',text:'CHAPTER  III\n\nINTO  THE  VOID',duration:2800}
  ],
  ending_destroy:[
    {type:'scene',bg:0x0a0005,overlay:'sparks',text:'[ VOID CORE — DESTROYED ]',duration:1000},
    {type:'flash',color:0xff00ff,duration:600},
    {type:'dialog',char:'VOID',portrait:null,text:"Impossible. I am... eternal. You cannot... I will not—"},
    {type:'flash',color:0xffffff,duration:900},
    {type:'dialog',char:'ECHO',portrait:null,text:"VOID has been purged. Ten thousand years of fear... finally over.\nThank you, pilots. My creators would be proud of what you did today."},
    {type:'dialog',char:'NOVA',portrait:'nova',text:"ECHO... what happens to you now?"},
    {type:'dialog',char:'ECHO',portrait:null,text:"I remain. I will always remain. Perhaps one day more visitors will come — and I will tell them there is nothing to fear here anymore.\nGo home. Your world needs you."},
    {type:'scene',bg:0x000010,overlay:'stars',text:'[ EMERGENCY SHUTTLE — ORBIT ]',duration:1000},
    {type:'dialog',char:'ROOK',portrait:'rook',text:"Never thought I'd be glad to see open stars again."},
    {type:'dialog',char:'NOVA',portrait:'nova',text:"ROOK. Back there, when VOID had you — I wasn't going to leave without you. I need you to know that."},
    {type:'dialog',char:'ROOK',portrait:'rook',text:"I know. You pulled me out. That's what partners do. Always."},
    {type:'title',text:'MISSION  COMPLETE\n\nEarth received your signal.\nA rescue ship is en route.\n\nYou saved the stars.',duration:5000},
    {type:'credits'}
  ],
  ending_absorb:[
    {type:'scene',bg:0x0a0005,overlay:'sparks',text:'[ VOID CORE — ECHO MERGES WITH VOID ]',duration:1000},
    {type:'dialog',char:'ECHO',portrait:null,text:"VOID... I see what you've become. You're not evil — you're alone. You've always been alone. Let me in."},
    {type:'dialog',char:'VOID',portrait:null,text:"...what are you... I am... I don't—"},
    {type:'flash',color:0x8800ff,duration:800},
    {type:'dialog',char:'ECHO+VOID',portrait:null,text:"...BALANCE ACHIEVED. The hunger is quiet now. You are safe, pilots. This world is finally at peace."},
    {type:'dialog',char:'NOVA',portrait:'nova',text:"Is that... are they both still in there?"},
    {type:'dialog',char:'ROOK',portrait:'rook',text:"I don't know. But nothing is trying to kill us anymore, so I'll take it."},
    {type:'dialog',char:'ECHO+VOID',portrait:null,text:"Go home. Tell them the stars are friendlier than they look. We will be watching over you."},
    {type:'title',text:'MISSION  COMPLETE\n\nTwo became one.\nLight balanced dark.\n\nSomewhere out there — they watch.',duration:5000},
    {type:'credits'}
  ]
};

class CutsceneScene extends Phaser.Scene {
  constructor() { super('Cutscene'); }

  init(d) {
    this._key   = d.cutscene||'intro';
    this._next  = d.next||'Menu';
    this._solo  = !!d.solo || GS.roomId===null;
    this._lines = CUTSCENES[this._key] ? [...CUTSCENES[this._key]] : [];
    this._idx   = 0;
    this._busy  = true;
    this._netOff= null;
  }

  create() {
    this._bg      = this.add.rectangle(GW/2,GH/2,GW,GH,0x000000).setDepth(0);
    this._ovlay   = this.add.graphics().setDepth(1);
    this._stag    = this.add.text(GW/2,28,'',{fontSize:'12px',fontFamily:'Arial',color:'#334455',letterSpacing:3}).setOrigin(0.5).setDepth(2);
    this._titleT  = this.add.text(GW/2,GH/2,'',{fontSize:'54px',fontFamily:'Arial Black',color:'#00eeff',align:'center',shadow:{blur:28,color:'#0088ff',fill:true}}).setOrigin(0.5).setDepth(5).setAlpha(0);
    this._bodyT   = this.add.text(GW/2,GH/2,'',{fontSize:'20px',fontFamily:'Arial',color:'#ccdde8',align:'center',lineSpacing:6,wordWrap:{width:820}}).setOrigin(0.5).setDepth(5).setAlpha(0);

    // Dialog box elements
    this._dlgBox  = this.add.rectangle(GW/2,GH-108,GW-60,190,0x000d1a,0.93).setDepth(6).setVisible(false);
    this.add.rectangle(GW/2,GH-108,GW-62,192,0,0).setStrokeStyle(1,0x00aaff).setDepth(6);
    this._cname   = this.add.text(76,GH-192,'',{fontSize:'16px',fontFamily:'Arial Black',color:'#00eeff',shadow:{blur:8,color:'#00eeff',fill:true}}).setDepth(7);
    this._dtxt    = this.add.text(50,GH-174,'',{fontSize:'17px',fontFamily:'Arial',color:'#ddeeff',wordWrap:{width:GW-130},lineSpacing:5}).setDepth(7);
    this._dnext   = this.add.text(GW-42,GH-38,'▶',{fontSize:'17px',color:'#00eeff'}).setOrigin(1,1).setDepth(7).setAlpha(0);
    this._port    = this.add.image(28,GH-108,'av_nova').setOrigin(0,0.5).setDepth(7).setVisible(false).setScale(1.8);

    // Stars bg
    this.add.particles(0,0,'star',{
      x:{min:0,max:GW}, y:{min:0,max:GH},
      scale:{min:0.2,max:0.7}, alpha:{min:0.05,max:0.4},
      lifespan:5000, frequency:120, quantity:1
    }).setDepth(0.5);

    // Input
    this.input.on('pointerdown',()=>this._advance());
    this.input.keyboard.on('keydown-SPACE',()=>this._advance());
    this.input.keyboard.on('keydown-ENTER',()=>this._advance());

    if(!this._solo){
      this._netOff = NET.on('game_event',ev=>{ if(ev.type==='cutscene_advance') this._playLine(); });
    }

    this._playLine();
  }

  _playLine() {
    if(this._idx >= this._lines.length){ this._finish(); return; }
    const ln = this._lines[this._idx];
    this._busy = true;
    this._dlgBox.setVisible(false); this._port.setVisible(false);
    this._titleT.setAlpha(0); this._bodyT.setAlpha(0); this._dnext.setAlpha(0);

    if(ln.type==='title')  this._doTitle(ln);
    else if(ln.type==='scroll')  this._doScroll(ln);
    else if(ln.type==='scene')   this._doScene(ln);
    else if(ln.type==='dialog')  this._doDialog(ln);
    else if(ln.type==='flash')   this._doFlash(ln);
    else if(ln.type==='credits') this._doCredits();
    else this._next_ln();
  }

  _doTitle(ln) {
    this._bg.setFillStyle(0x000000);
    this._titleT.setText(ln.text).setAlpha(0);
    this.tweens.add({ targets:this._titleT, alpha:1, duration:800, ease:'Power2',
      onComplete:()=>{ this.time.delayedCall(ln.duration||2000,()=>{ this.tweens.add({targets:this._titleT,alpha:0,duration:600,onComplete:()=>this._next_ln()}); }); }
    });
  }

  _doScroll(ln) {
    this._bg.setFillStyle(0x000008);
    this._bodyT.setText(ln.text).setY(GH+40).setAlpha(1).setStyle({color:'#aabccc',fontSize:'19px'});
    this.tweens.add({ targets:this._bodyT, y:-100, duration:ln.duration||4200, ease:'Linear', onComplete:()=>this._next_ln() });
  }

  _doScene(ln) {
    this._bg.setFillStyle(ln.bg||0x000000);
    this._stag.setText(ln.text||'');
    this._drawOverlay(ln.overlay);
    this.time.delayedCall(ln.duration||1000,()=>this._next_ln());
  }

  _doFlash(ln) {
    const f = this.add.rectangle(GW/2,GH/2,GW,GH,ln.color||0xffffff,1).setDepth(20);
    this.tweens.add({ targets:f, alpha:0, duration:ln.duration||600, onComplete:()=>{ f.destroy(); this._next_ln(); } });
    if(ln.color===0xffffff||ln.color===0xff6600) SFX.explosion();
  }

  _doDialog(ln) {
    this._bg.setFillStyle(0x000510);
    this._dlgBox.setVisible(true);
    if(ln.portrait==='nova'){ this._port.setTexture('av_nova').setVisible(true); }
    else if(ln.portrait==='rook'){ this._port.setTexture('av_rook').setVisible(true); }

    const nc = ln.char==='NOVA'?'#00eeff':ln.char==='ROOK'?'#ff8800':ln.char==='ECHO'?'#88ffaa':ln.char==='VOID'?'#ff00ff':ln.char==='SYSTEM'?'#ff3333':ln.char==='ECHO+VOID'?'#cc88ff':'#ffffff';
    this._cname.setText(ln.char).setStyle({color:nc});
    this._dtxt.setText('');
    let i=0;
    const txt=ln.text;
    this.time.addEvent({ delay:26, repeat:txt.length-1, callback:()=>{
      this._dtxt.setText(txt.slice(0,++i));
      if(i%4===0) SFX.ctx && SFX._osc('square',180+Math.random()*80,0.025,0.015);
    }});
    this.time.delayedCall(txt.length*26+300,()=>{
      this._busy=false;
      this.tweens.add({ targets:this._dnext, alpha:{from:0.2,to:1}, duration:500, yoyo:true, repeat:-1 });
    });
  }

  _doCredits() {
    this._bg.setFillStyle(0x000008);
    const cred = this.add.text(GW/2,GH+60,
`NEXUS  PROTOCOL
A Co-op Sci-Fi Adventure

═══════════════════════════════

Built with Phaser 3  ·  Socket.IO  ·  Node.js

Thank you for playing.
Your journey through the void ends here —
but ECHO and VOID live on.

[ Click or press Space to return to menu ]`,{
      fontSize:'20px', fontFamily:'Arial', color:'#aaccdd', align:'center', lineSpacing:9
    }).setOrigin(0.5).setDepth(10);
    this.tweens.add({ targets:cred, y:-cred.height, duration:14000, ease:'Linear', onComplete:()=>this._finish() });
    this._busy=false;
  }

  _drawOverlay(type) {
    this._ovlay.clear();
    if(type==='fire'){ this._ovlay.fillStyle(0xff4400,0.08); for(let y=0;y<GH;y+=4) this._ovlay.fillRect(0,y,GW,2); }
    else if(type==='alarm'){ this._ovlay.fillStyle(0xff0000,0.15); this._ovlay.fillRect(0,0,GW,GH); }
    else if(type==='ruins'){ this._ovlay.fillStyle(0x0000ff,0.05); this._ovlay.fillRect(0,0,GW,GH); }
    else if(type==='sparks'){ this._ovlay.fillStyle(0xffffff,0.06); for(let i=0;i<60;i++) this._ovlay.fillRect(Phaser.Math.Between(0,GW),Phaser.Math.Between(0,GH),2,2); }
  }

  _advance() {
    if(!this._solo && GS.playerIndex!==0) return;
    if(this._busy){
      const ln=this._lines[this._idx];
      if(ln && ln.type==='dialog'){ this._dtxt.setText(ln.text); this._busy=false; return; }
      return;
    }
    if(!this._solo) NET.emit('game_event',{type:'cutscene_advance',idx:this._idx});
    this._next_ln();
  }

  _next_ln() { this._idx++; this._busy=true; this.time.delayedCall(80,()=>this._playLine()); }

  _finish() {
    if(this._netOff) this._netOff();
    const map = { Chapter1:'Chapter1', Chapter2:'Chapter2', Chapter3:'Chapter3', Menu:'Menu', Win:'GameOver', GameOver:'GameOver' };
    if(this._next==='Chapter1') { NET.emit('game_event',{type:'start_game'}); }
    this.scene.start(map[this._next]||'Menu', this._next==='Win'?{win:true}:this._next==='GameOver'?{win:false}:{});
  }
}
