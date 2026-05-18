// ── Base Game Scene (shared logic for all chapters) ───────────────────────────
class BaseGameScene extends Phaser.Scene {
  constructor(key) { super(key); this._key = key; }

  // Called by subclasses after physics world is ready
  _initGame(levelData) {
    this._ld            = levelData;
    this._dead          = false;
    this._paused        = false;
    this._tutorialActive= false;
    this._bullets       = null;
    this._eBullets      = null;
    this._enemies       = [];
    this._interactables = [];
    this._netOffs       = [];
    this._remotePlayers = new Map();
    this._shootCd       = 0;
    this._abilityCd     = 0;
    this._lastNetSend   = 0;
    this._keys          = null;
    this._spawnPosX     = levelData.spawnX || 200;
    this._spawnPosY     = levelData.spawnY || 400;
    // Contextual hint tracking — each shows once per session
    this._hints = { moved:false, shot:false, interacted:false, ability:false, nearEnemy:false, revive:false };

    // World bounds
    this.physics.world.setBounds(0, 0, levelData.width, levelData.height);
    this.cameras.main.setBounds(0, 0, levelData.width, levelData.height);

    // Build level
    this._buildLevel();
    this._buildPlayer();
    this._buildEnemies();
    this._buildInteractables();
    this._buildParticles();
    this._buildInput();
    this._buildCamera();
    this._buildTouchControls();
    this._initNet();

    // Launch UI overlay
    this.scene.launch('UIScene', { gameScene: this._key });
    this._uiScene = this.scene.get('UIScene');

    // Atmospheric effects
    this._buildAtmosphere();
  }

  _buildLevel() {
    const ld = this._ld;
    // Background
    this.add.rectangle(ld.width/2, ld.height/2, ld.width, ld.height, ld.bgColor || 0x050505);

    // Background detail layer (subtle grid / scanlines)
    const bg2 = this.add.graphics();
    if (ld.bgPattern === 'grid') {
      bg2.lineStyle(1, ld.gridColor || 0x0a0a0a, 0.5);
      for (let x = 0; x < ld.width; x += 64) { bg2.moveTo(x,0); bg2.lineTo(x,ld.height); }
      for (let y = 0; y < ld.height; y += 64) { bg2.moveTo(0,y); bg2.lineTo(ld.width,y); }
      bg2.strokePath();
    }

    // Static layer group
    this._walls = this.physics.add.staticGroup();
    this._floors = this.physics.add.staticGroup();

    // Place tiles from level data
    const tileKey = ld.tileKey || 'floor_crash';
    const wallKey = ld.wallKey || 'wall';

    ld.floors.forEach(r => {
      for (let x = r[0]; x < r[0]+r[2]; x += TILE) {
        for (let y = r[1]; y < r[1]+r[3]; y += TILE) {
          this._floors.create(x+TILE/2, y+TILE/2, tileKey);
        }
      }
    });

    ld.walls.forEach(r => {
      for (let x = r[0]; x < r[0]+r[2]; x += TILE) {
        for (let y = r[1]; y < r[1]+r[3]; y += TILE) {
          this._walls.create(x+TILE/2, y+TILE/2, wallKey);
        }
      }
    });

    // Decoration objects
    (ld.decor || []).forEach(d => {
      const img = this.add.image(d.x, d.y, d.key);
      if (d.scale) img.setScale(d.scale);
      if (d.alpha) img.setAlpha(d.alpha);
      if (d.tint)  img.setTint(d.tint);
    });

    // Bullet groups
    this._bullets  = this.physics.add.group({ defaultKey:'bullet_p', maxSize:60, runChildUpdate:true });
    this._eBullets = this.physics.add.group({ defaultKey:'bullet_e', maxSize:80, runChildUpdate:true });
  }

  _buildPlayer() {
    const char = GS.playerIndex === 0 ? 'nova' : 'rook';
    this._player = this.physics.add.sprite(this._spawnPosX, this._spawnPosY, char);
    this._player.setCollideWorldBounds(true);
    this._player.setDepth(10);
    this._player.body.setSize(20, 30);
    this._player.body.setOffset(8, 32);
    this._player.hp     = 100;
    this._player.maxHp  = 100;
    this._player.dead   = false;
    this._player.char   = char;
    this._player.facing = 'right';
    this._player.abilityName = char === 'nova' ? 'Scan' : 'Grenade';
    this._player.play(char+'_idle');

    // Collision with level
    this.physics.add.collider(this._player, this._walls);

    // Name tag
    this._nameTag = this.add.text(0, 0, (GS.playerData?.name || (char==='nova'?'NOVA':'ROOK')).toUpperCase(), {
      fontSize:'11px', fontFamily:'Arial', color: char==='nova'?'#00eeff':'#ff8800',
      shadow:{blur:6,color:char==='nova'?'#00eeff':'#ff8800',fill:true}
    }).setOrigin(0.5).setDepth(11);

    // Health bar above player
    this._pHealthBg  = this.add.rectangle(0, 0, 36, 5, 0x000000, 0.7).setDepth(11);
    this._pHealthBar = this.add.rectangle(0, 0, 34, 3, 0x22ff44, 1).setDepth(12);

    // Shield visual (ROOK ability)
    this._shield = this.add.image(0,0,'shield').setDepth(9).setAlpha(0).setScale(0.9);
  }

  _buildEnemies() {
    (this._ld.enemies || []).forEach(ed => {
      const e = this.physics.add.sprite(ed.x, ed.y, ed.type || 'drone');
      e.setDepth(9);
      e.body.setSize(ed.bodyW || 24, ed.bodyH || 24);
      e.type     = ed.type || 'drone';
      e.hp       = ed.hp   || 30;
      e.maxHp    = e.hp;
      e.speed    = ed.speed || 80;
      e.range    = ed.range || 300;
      e.shootCd  = 0;
      e.shootRate= ed.shootRate || 2200;
      e.dead     = false;
      e.patrol   = ed.patrol || null;
      e.patrolDir = 1;
      e.id       = ed.id || Phaser.Math.RND.uuid();
      e.points   = ed.points || 100;
      e.boss     = ed.boss || false;

      if(ed.type==='drone')  e.play('drone_fly');
      else if(ed.type==='guard') e.play('guard_walk');
      else if(ed.type==='boss')  e.play('boss_idle');

      // Health bar
      e.hpBg  = this.add.rectangle(e.x, e.y-26, 36, 5, 0x000000, 0.7).setDepth(9);
      e.hpBar = this.add.rectangle(e.x, e.y-26, 34, 3, 0xff2222, 1).setDepth(9);
      if(e.boss){ e.hpBg.setSize(120,8); e.hpBar.setSize(118,6); }

      this.physics.add.collider(e, this._walls);
      this._enemies.push(e);

      // Net: remove already-dead enemies
      if(GS.roomId && this.game.registry.get('dead_'+e.id)) e.setActive(false).setVisible(false);
    });

    // Bullet vs enemy
    this.physics.add.overlap(this._bullets, this._enemies.filter(e=>!e.boss?e:e), (b, e) => {
      if(e.dead || !b.active) return;
      b.destroy();
      this._damageEnemy(e, 20);
    });

    // Enemy bullets vs player
    this.physics.add.overlap(this._eBullets, this._player, (b, p) => {
      if(!b.active || this._dead || p.shielded) return;
      b.destroy();
      this._damagePlayer(10);
    });

    // Player melee vs enemies (overlap for close contact damage)
    this.physics.add.overlap(this._player, this._enemies, (p, e) => {
      if(e.dead || this._dead) return;
      if(this.time.now - (p.lastContactDmg||0) > 1000) {
        p.lastContactDmg = this.time.now;
        this._damagePlayer(5);
      }
    });
  }

  _buildInteractables() {
    (this._ld.interactables || []).forEach(obj => {
      let sprite;
      if(obj.type === 'terminal')  sprite = this.physics.add.staticImage(obj.x, obj.y, 'terminal');
      else if(obj.type === 'beacon')  sprite = this.physics.add.staticImage(obj.x, obj.y, 'beacon');
      else if(obj.type === 'door')    sprite = this.physics.add.staticImage(obj.x, obj.y, 'door');
      else if(obj.type === 'crystal') sprite = this.physics.add.image(obj.x, obj.y, 'crystal');
      else if(obj.type === 'healthpack') sprite = this.physics.add.image(obj.x, obj.y, 'healthpack');
      else if(obj.type === 'journal')  sprite = this.physics.add.image(obj.x, obj.y, 'journal');
      else if(obj.type === 'plate')    sprite = this.physics.add.staticImage(obj.x, obj.y, 'plate');
      else sprite = this.physics.add.staticImage(obj.x, obj.y, obj.key||'terminal');

      sprite.setDepth(8);
      sprite.interactData = obj;
      sprite.activated = obj.preActivated || false;
      if(sprite.activated) sprite.setTint(0x00ff88);

      // Glow pulse for pickups
      if(['crystal','healthpack','journal'].includes(obj.type)){
        this.tweens.add({ targets:sprite, y:'-=6', duration:1000, yoyo:true, repeat:-1, ease:'Sine.easeInOut' });
      }

      this._interactables.push(sprite);
    });
  }

  _buildParticles() {
    // Ambient atmosphere particles per level type
    if(this._ld.particles === 'fire') {
      this.add.particles(0, 0, 'fire', {
        x:{min:0,max:this._ld.width}, y:{min:this._ld.height-100,max:this._ld.height},
        lifespan:2000, speed:{min:20,max:80}, angle:{min:-100,max:-60},
        scale:{start:0.8,end:0}, alpha:{start:0.8,end:0},
        frequency:180, quantity:1
      }).setDepth(2);
    } else if(this._ld.particles === 'sparks') {
      this.add.particles(0, 0, 'spark', {
        x:{min:0,max:this._ld.width}, y:this._ld.height/2,
        lifespan:1500, speed:{min:10,max:50}, angle:{min:0,max:360},
        scale:{start:0.5,end:0}, alpha:{start:1,end:0},
        frequency:400, quantity:1
      }).setDepth(2);
    } else if(this._ld.particles === 'void') {
      this.add.particles(0, 0, 'dot_red', {
        x:{min:0,max:this._ld.width}, y:{min:0,max:this._ld.height},
        lifespan:3000, speed:{min:5,max:20}, angle:{min:0,max:360},
        scale:{start:0.4,end:0}, alpha:{start:0.5,end:0},
        frequency:300, quantity:1
      }).setDepth(2);
    }
  }

  _buildInput() {
    const kb = this.input.keyboard;
    this._keys = {
      up:    kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down:  kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left:  kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      up2:   kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      down2: kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
      left2: kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      right2:kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
      space: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      e:     kb.addKey(Phaser.Input.Keyboard.KeyCodes.E),
      q:     kb.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
      r:     kb.addKey(Phaser.Input.Keyboard.KeyCodes.R),
      esc:   kb.addKey(Phaser.Input.Keyboard.KeyCodes.ESC)
    };

    // Shoot on click
    this.input.on('pointerdown', ptr => {
      if(!this._dead) this._tryShoot(ptr.worldX, ptr.worldY);
    });

    kb.on('keydown-E', () => this._interact());
    kb.on('keydown-Q', () => this._useAbility());
    kb.on('keydown-R', () => this._tryRevive());
    kb.on('keydown-ESC', () => this._togglePause());
  }

  _buildCamera() {
    this.cameras.main.startFollow(this._player, true, 0.1, 0.1);
    this.cameras.main.setZoom(1);
  }

  _buildTouchControls() {
    // Virtual joystick and buttons for mobile
    if(!('ontouchstart' in window)) return;
    const ui = this.add.container(0, 0).setDepth(100).setScrollFactor(0);

    // Joystick base
    const joyBase = this.add.circle(100, GH-110, 50, 0x000000, 0.4).setScrollFactor(0).setDepth(100);
    const joyStick = this.add.circle(100, GH-110, 22, 0x00aaff, 0.7).setScrollFactor(0).setDepth(101);

    let joyCenX=100, joyCenY=GH-110;
    let joyActive=false, joyPtr=null;

    this.input.on('pointerdown', ptr => {
      if(ptr.x < GW/2 && !joyActive){ joyActive=true; joyPtr=ptr.id; joyCenX=ptr.x; joyCenY=ptr.y; joyBase.setPosition(ptr.x,ptr.y); joyStick.setPosition(ptr.x,ptr.y); }
      else if(ptr.x >= GW/2){ this._tryShoot(ptr.worldX, ptr.worldY); }
    });
    this.input.on('pointermove', ptr => {
      if(joyActive && ptr.id===joyPtr){
        const dx=ptr.x-joyCenX, dy=ptr.y-joyCenY;
        const dist=Math.min(Math.sqrt(dx*dx+dy*dy),40);
        const ang=Math.atan2(dy,dx);
        joyStick.setPosition(joyCenX+Math.cos(ang)*dist, joyCenY+Math.sin(ang)*dist);
        this._joyX=dx/40; this._joyY=dy/40;
      }
    });
    this.input.on('pointerup', ptr => {
      if(ptr.id===joyPtr){ joyActive=false; joyPtr=null; this._joyX=0; this._joyY=0; joyStick.setPosition(joyCenX,joyCenY); }
    });
    this._joyX=0; this._joyY=0;

    // Action buttons
    const abilityBtn = this.add.circle(GW-80,GH-120,28,0x00aaff,0.5).setScrollFactor(0).setDepth(100).setInteractive({cursor:'pointer'});
    this.add.text(GW-80,GH-120,'Q',{fontSize:'16px',fontFamily:'Arial',color:'#ffffff'}).setOrigin(0.5).setScrollFactor(0).setDepth(101);
    abilityBtn.on('pointerdown',()=>this._useAbility());

    const reviveBtn = this.add.circle(GW-140,GH-80,24,0x00ff88,0.5).setScrollFactor(0).setDepth(100).setInteractive({cursor:'pointer'});
    this.add.text(GW-140,GH-80,'R',{fontSize:'14px',fontFamily:'Arial',color:'#ffffff'}).setOrigin(0.5).setScrollFactor(0).setDepth(101);
    reviveBtn.on('pointerdown',()=>this._tryRevive());

    const interactBtn = this.add.circle(GW-80,GH-62,24,0xffaa00,0.5).setScrollFactor(0).setDepth(100).setInteractive({cursor:'pointer'});
    this.add.text(GW-80,GH-62,'E',{fontSize:'14px',fontFamily:'Arial',color:'#ffffff'}).setOrigin(0.5).setScrollFactor(0).setDepth(101);
    interactBtn.on('pointerdown',()=>this._interact());
  }

  _buildAtmosphere() {}  // overridden by chapters

  _initNet() {
    if(!GS.roomId) return;

    // Other players
    GS.otherPlayers.forEach(op => this._spawnRemote(op));

    this._netOffs.push(NET.on('player_joined', d => this._spawnRemote(d.player)));
    this._netOffs.push(NET.on('player_left',   d => { const rp = this._remotePlayers.get(d.id); if(rp){ rp.sprite&&rp.sprite.destroy(); rp.nametag&&rp.nametag.destroy(); rp.hpBg&&rp.hpBg.destroy(); rp.hpBar&&rp.hpBar.destroy(); this._remotePlayers.delete(d.id); } }));

    this._netOffs.push(NET.on('player_updated', d => {
      let rp = this._remotePlayers.get(d.id);
      if(!rp) return;
      // Interpolate
      rp.targetX = d.x; rp.targetY = d.y;
      rp.hp = d.hp;
      if(rp.sprite) {
        if(d.facing==='left')  rp.sprite.setFlipX(true);
        else                   rp.sprite.setFlipX(false);
        if(d.anim && rp.sprite.anims.currentAnim?.key !== d.anim) rp.sprite.play(d.anim, true);
      }
    }));

    this._netOffs.push(NET.on('ability_used', d => {
      if(d.type==='grenade') this._showExplosion(d.x, d.y, true);
    }));

    this._netOffs.push(NET.on('game_event', ev => {
      if(ev.type==='enemy_killed') {
        const e = this._enemies.find(en=>en.id===ev.enemyId);
        if(e && !e.dead) this._killEnemy(e, false);
      }
      else if(ev.type==='player_died') {
        if(ev.id === NET.id()){ /* already handled locally */ }
      }
      else if(ev.type==='player_revived' && ev.targetId === NET.id()) {
        this._revive();
      }
      else if(ev.type==='puzzle_solved') {
        this._onPuzzleNet(ev.puzzleId);
      }
      else if(ev.type==='load_chapter') {
        this._cleanupAndGo(ev.chapter);
      }
    }));
  }

  _spawnRemote(op) {
    const char = op.character || (op.index===0?'nova':'rook');
    const sprite = this.physics.add.sprite(op.x||300, op.y||400, char);
    sprite.setDepth(10).setAlpha(0.85);
    sprite.body.setSize(20,30).setOffset(8,32);
    sprite.play(char+'_idle');

    const nametag = this.add.text(op.x||300, (op.y||400)-46, (op.name||char).toUpperCase(), {
      fontSize:'11px', fontFamily:'Arial', color:char==='nova'?'#00eeff':'#ff8800'
    }).setOrigin(0.5).setDepth(11);

    const hpBg  = this.add.rectangle(op.x||300,(op.y||400)-38,36,5,0x000000,0.7).setDepth(11);
    const hpBar = this.add.rectangle(op.x||300,(op.y||400)-38,34,3,0x22ff44,1).setDepth(11);

    this._remotePlayers.set(op.id, { sprite, nametag, hpBg, hpBar, targetX:op.x||300, targetY:op.y||400, hp:100 });
    this.physics.add.collider(sprite, this._walls);
  }

  _tryShoot(targetX, targetY) {
    if(this._dead || this.time.now < this._shootCd) return;
    this._shootCd = this.time.now + 280;

    const p = this._player;
    const angle = Phaser.Math.Angle.Between(p.x, p.y, targetX, targetY);
    const b = this._bullets.get(p.x, p.y, 'bullet_p');
    if(!b) return;
    b.setActive(true).setVisible(true).setDepth(8);
    b.setRotation(angle);
    const speed = 550;
    b.body.setVelocity(Math.cos(angle)*speed, Math.sin(angle)*speed);
    b.body.allowGravity = false;
    this.time.delayedCall(1800, ()=>{ if(b.active) b.destroy(); });
    SFX.shoot();
    p.play(p.char+'_shoot', true);
    NET.emit('ability_used', { type:'shoot', x:p.x, y:p.y, angle });
  }

  _useAbility() {
    if(this._dead || this.time.now < this._abilityCd) return;
    const char = GS.playerIndex===0 ? 'nova' : 'rook';

    if(char==='nova') {
      // NOVA: Pulse scan — damages nearby enemies and reveals hidden items
      this._abilityCd = this.time.now + 6000;
      SFX.ability();
      const ring = this.add.circle(this._player.x, this._player.y, 10, 0x00eeff, 0.4).setDepth(15);
      this.tweens.add({ targets:ring, scaleX:14, scaleY:14, alpha:0, duration:700,
        onUpdate:()=>{
          this._enemies.forEach(e=>{ if(!e.dead && Phaser.Math.Distance.Between(this._player.x,this._player.y,e.x,e.y)<140) this._damageEnemy(e,15); });
        },
        onComplete:()=>ring.destroy()
      });
      // Heal a bit too
      this._heal(15);
      this._emitEvent('ability_nova_scan');
    } else {
      // ROOK: Grenade — AOE damage at cursor
      this._abilityCd = this.time.now + 5000;
      SFX.ability();
      const ptr = this.input.activePointer;
      const tx = ptr.worldX, ty = ptr.worldY;
      const orb = this.physics.add.image(this._player.x, this._player.y, 'orb_rook').setDepth(12);
      const angle = Phaser.Math.Angle.Between(this._player.x, this._player.y, tx, ty);
      this.physics.moveTo(orb, tx, ty, 400);
      orb.body.allowGravity=false;
      this.time.delayedCall(500, ()=>{
        this._showExplosion(orb.x, orb.y, false);
        this._enemies.forEach(e=>{ if(!e.dead && Phaser.Math.Distance.Between(orb.x,orb.y,e.x,e.y)<100) this._damageEnemy(e,40); });
        orb.destroy();
        NET.emit('ability_used',{type:'grenade',x:orb.x,y:orb.y});
      });
    }
    if(this._uiScene) this._uiScene.setAbilityCd(this._abilityCd - this.time.now);
  }

  _showExplosion(x, y, remote) {
    const flash = this.add.image(x, y, 'flash').setDepth(20);
    this.tweens.add({ targets:flash, scaleX:2, scaleY:2, alpha:0, duration:400, onComplete:()=>flash.destroy() });
    this.add.particles(x, y, 'spark', {
      speed:{min:80,max:200}, scale:{start:0.8,end:0}, alpha:{start:1,end:0},
      lifespan:500, quantity:18, emitZone:{ type:'edge', source:new Phaser.Geom.Circle(0,0,5), quantity:18 }
    }).setDepth(15).explode();
    this.cameras.main.shake(200, 0.01);
    SFX.explosion();
  }

  _interact() {
    if(this._dead) return;
    const range = 64;
    for(const obj of this._interactables){
      if(Phaser.Math.Distance.Between(this._player.x, this._player.y, obj.x, obj.y) < range){
        const data = obj.interactData;
        if(data.type==='healthpack' && !obj.activated){
          obj.activated=true; obj.setVisible(false);
          this._heal(40); SFX.pickup();
          this._showFloatText(obj.x, obj.y, '+40 HP', '#22ff44');
        } else if(data.type==='crystal' && !obj.activated){
          obj.activated=true; obj.setVisible(false);
          SFX.pickup();
          this._showFloatText(obj.x, obj.y, 'Vaelari Crystal', '#00ffcc');
          NET.emit('game_event',{type:'collectible_picked',id:data.id||obj.x+':'+obj.y});
        } else if(data.type==='journal' && !obj.activated){
          obj.activated=true; obj.setTint(0x888888);
          SFX.pickup();
          this._showJournal(data.title||'Log', data.text||'...');
          NET.emit('game_event',{type:'collectible_picked',id:data.id||obj.x+':'+obj.y});
        } else if(data.type==='terminal' || data.type==='beacon'){
          this._onTerminalActivate(obj, data);
        } else if(data.type==='plate'){
          this._onPlateActivate(obj, data);
        }
        break;
      }
    }
  }

  _onTerminalActivate(obj, data) {
    // Override in subclasses
    SFX.ui();
    obj.setTint(0x00ff88);
    obj.activated = true;
    NET.emit('game_event',{type:'checkpoint',id:data.id||'term_'+obj.x});
    this._checkObjective();
  }

  _onPlateActivate(obj, data) { obj.activated=true; obj.setTint(0x00ff88); this._checkObjective(); }
  _onPuzzleNet(id) {}

  _tryRevive() {
    if(this._dead) return;
    // Find dead remote player nearby
    for(const [id, rp] of this._remotePlayers){
      if(rp.hp <= 0 && rp.sprite && Phaser.Math.Distance.Between(this._player.x,this._player.y,rp.sprite.x,rp.sprite.y)<70){
        NET.emit('game_event',{type:'player_revived',targetId:id});
        SFX.checkpoint();
        const ring = this.add.image(rp.sprite.x, rp.sprite.y, 'revive_ring').setDepth(15);
        this.tweens.add({ targets:ring, scaleX:2, scaleY:2, alpha:0, duration:600, onComplete:()=>ring.destroy() });
        this._showFloatText(rp.sprite.x, rp.sprite.y, 'REVIVED!', '#00ff88');
        return;
      }
    }
  }

  _revive() {
    this._dead = false;
    this._player.dead = false;
    this._player.hp = 50;
    this._player.setAlpha(1).setTint(0x00ff88);
    this.time.delayedCall(500, ()=>this._player.clearTint());
    this._updatePlayerHPBar();
    this._showFloatText(this._player.x, this._player.y, 'REVIVED!', '#00ff88');
    SFX.checkpoint();
  }

  _damagePlayer(amount) {
    if(this._dead || this._player.dead || this._player.shielded) return;
    this._player.hp = Math.max(0, this._player.hp - amount);
    this._player.play(this._player.char+'_hit', true);
    this.cameras.main.shake(120, 0.008);
    this._player.setTint(0xff4444);
    this.time.delayedCall(200, ()=>this._player.clearTint());
    SFX.hit();
    this._updatePlayerHPBar();
    if(this._uiScene) this._uiScene.setHP(this._player.hp, this._player.maxHp);
    if(this._player.hp <= 0) this._playerDied();
  }

  _heal(amount) {
    this._player.hp = Math.min(this._player.maxHp, this._player.hp + amount);
    this._updatePlayerHPBar();
    if(this._uiScene) this._uiScene.setHP(this._player.hp, this._player.maxHp);
    this._showFloatText(this._player.x, this._player.y-20, `+${amount}`, '#22ff44');
  }

  _playerDied() {
    if(this._dead) return;
    this._dead = true;
    this._player.dead = true;
    this._player.play(this._player.char+'_dead');
    this._player.setTint(0x880000);
    SFX.die();
    this.cameras.main.shake(400, 0.02);
    NET.emit('game_event',{type:'player_died',id:NET.id()});

    this._showFloatText(this._player.x, this._player.y, 'DOWN!', '#ff4444');
    this._showFloatText(this._player.x, this._player.y+18, 'Wait for revive', '#888888');

    // Solo: respawn after 4s
    if(!GS.roomId){
      this.time.delayedCall(4000, ()=>{
        this._player.hp = 50; this._dead=false; this._player.dead=false;
        this._player.clearTint();
        this._player.setPosition(this._spawnPosX, this._spawnPosY);
        this._player.play(this._player.char+'_idle');
        this._updatePlayerHPBar();
        if(this._uiScene) this._uiScene.setHP(this._player.hp, this._player.maxHp);
      });
    } else {
      // Co-op: wait for revive. 30s timeout → game over
      this.time.delayedCall(30000, ()=>{
        if(this._dead) this.scene.stop('UIScene'), this.scene.start('GameOver',{win:false});
      });
    }
  }

  _damageEnemy(e, dmg) {
    if(e.dead) return;
    e.hp -= dmg;
    e.setTint(0xffffff);
    this.time.delayedCall(120, ()=>e.clearTint());
    SFX.bossHit();
    this._showFloatText(e.x, e.y-20, `-${dmg}`, '#ffdd00');
    this._updateEnemyHP(e);
    if(e.hp <= 0) { NET.emit('game_event',{type:'enemy_killed',enemyId:e.id}); this._killEnemy(e, true); }
  }

  _killEnemy(e, explode) {
    if(e.dead) return;
    e.dead = true;
    if(explode){
      this._showExplosion(e.x, e.y, false);
      if(this._uiScene) this._uiScene.addScore(e.points||100);
    }
    e.hpBg.destroy(); e.hpBar.destroy();
    this.tweens.add({ targets:e, alpha:0, scaleX:1.5, scaleY:1.5, duration:300, onComplete:()=>{ e.destroy(); } });
    this._enemies = this._enemies.filter(en=>en!==e);
    this._checkObjective();
  }

  _checkObjective() {} // override per chapter

  _emitEvent(type, data={}) { NET.emit('game_event',{type,...data}); }

  _updatePlayerHPBar() {
    const pct = this._player.hp / this._player.maxHp;
    this._pHealthBar.setScale(pct, 1);
    this._pHealthBar.x = this._player.x - 17 + (34 * pct / 2 - 17);
  }

  _updateEnemyHP(e) {
    const pct = Math.max(0, e.hp/e.maxHp);
    const maxW = e.boss ? 118 : 34;
    e.hpBar.setScale(pct, 1);
  }

  _showFloatText(x, y, txt, color) {
    const t = this.add.text(x, y, txt, { fontSize:'14px', fontFamily:'Arial Black', color }).setOrigin(0.5).setDepth(25);
    this.tweens.add({ targets:t, y:y-40, alpha:0, duration:1000, ease:'Power2', onComplete:()=>t.destroy() });
  }

  _showJournal(title, text) {
    const panel = this.add.rectangle(GW/2, GH/2, 640, 340, 0x000d18, 0.96).setScrollFactor(0).setDepth(30);
    const border = this.add.rectangle(GW/2,GH/2,638,338,0,0).setStrokeStyle(1,0x00aaff).setScrollFactor(0).setDepth(30);
    const t1 = this.add.text(GW/2,GH/2-150,`📖  ${title}`,{fontSize:'18px',fontFamily:'Arial Black',color:'#00eeff'}).setOrigin(0.5).setScrollFactor(0).setDepth(30);
    const t2 = this.add.text(GW/2,GH/2,text,{fontSize:'14px',fontFamily:'Arial',color:'#aaccdd',align:'center',lineSpacing:5,wordWrap:{width:580}}).setOrigin(0.5).setScrollFactor(0).setDepth(30);
    const close = this.add.text(GW/2,GH/2+148,'[ CLOSE ]',{fontSize:'16px',color:'#00eeff',fontFamily:'Arial'}).setOrigin(0.5).setScrollFactor(0).setDepth(30).setInteractive({cursor:'pointer'});
    close.on('pointerdown',()=>[panel,border,t1,t2,close].forEach(o=>o.destroy()));
  }

  _showDialogBubble(text, duration=4000) {
    const panel = this.add.rectangle(GW/2, GH-80, GW-80, 100, 0x000d18, 0.9).setScrollFactor(0).setDepth(30);
    const t = this.add.text(GW/2, GH-80, text, {fontSize:'16px',fontFamily:'Arial',color:'#ddeeff',align:'center',wordWrap:{width:GW-120}}).setOrigin(0.5).setScrollFactor(0).setDepth(31);
    this.time.delayedCall(duration, ()=>{ panel.destroy(); t.destroy(); });
  }

  _togglePause() {
    this._paused = !this._paused;
    if (this._paused) {
      this.physics.pause();
      const overlay = this.add.rectangle(GW/2,GH/2,GW,GH,0x000000,0.75).setScrollFactor(0).setDepth(50);
      const pt   = this.add.text(GW/2,GH/2-100,'PAUSED',{fontSize:'52px',fontFamily:'Arial Black',color:'#00eeff',shadow:{blur:20,color:'#00eeff',fill:true}}).setOrigin(0.5).setScrollFactor(0).setDepth(51);
      const sep  = this.add.rectangle(GW/2,GH/2-40,500,1,0x224466,1).setScrollFactor(0).setDepth(51);
      const ctrl = this.add.text(GW/2,GH/2+30,
        'WASD / Arrows  =  Move            CLICK / SPACE  =  Shoot\n[Q]  =  Special Ability            [E]  =  Interact\n[R]  =  Revive Ally                ESC  =  Resume',
        {fontSize:'15px',fontFamily:'Arial',color:'#aaccdd',align:'center',lineSpacing:10}
      ).setOrigin(0.5).setScrollFactor(0).setDepth(51);
      const hint = this.add.text(GW/2,GH/2+160,'Press  ESC  to continue',{fontSize:'16px',fontFamily:'Arial',color:'#556677'}).setOrigin(0.5).setScrollFactor(0).setDepth(51);
      this._pauseObjs = [overlay,pt,sep,ctrl,hint];
    } else {
      this.physics.resume();
      (this._pauseObjs||[]).forEach(o => o.destroy());
      this._pauseObjs = [];
    }
  }

  // ── Tutorial overlay shown at start of every chapter ─────────────────────
  _showTutorialOverlay(chapterNum, objectives, onDismiss) {
    this._tutorialActive = true;
    this.physics.pause();

    const char = GS.playerIndex === 0 ? 'nova' : 'rook';
    const charName  = char === 'nova' ? 'NOVA' : 'ROOK';
    const charColor = char === 'nova' ? '#00eeff' : '#ff8800';
    const abilityDesc = char === 'nova'
      ? '[Q]  PULSE SCAN — damages nearby enemies and restores your HP'
      : '[Q]  GRENADE — throw an explosive that blasts everything nearby';

    const obs = [];
    const sf = (o) => { obs.push(o); return o; };

    sf(this.add.rectangle(GW/2, GH/2, GW, GH, 0x000000, 0.85).setScrollFactor(0).setDepth(200));
    sf(this.add.rectangle(GW/2, GH/2, 900, 560, 0x000d1a, 0.98).setScrollFactor(0).setDepth(201));
    sf(this.add.rectangle(GW/2, GH/2, 898, 558, 0, 0).setStrokeStyle(2, 0x00aaff).setScrollFactor(0).setDepth(201));

    // Header
    sf(this.add.text(GW/2, GH/2 - 256,
      `CHAPTER ${chapterNum}  —  MISSION BRIEFING`,
      { fontSize:'20px', fontFamily:'Arial Black', color:charColor,
        shadow:{ blur:14, color:charColor, fill:true } }
    ).setOrigin(0.5).setScrollFactor(0).setDepth(202));

    sf(this.add.text(GW/2, GH/2 - 226,
      `You are ${charName}`,
      { fontSize:'14px', fontFamily:'Arial', color:charColor }
    ).setOrigin(0.5).setScrollFactor(0).setDepth(202));

    // Divider line
    const dg = sf(this.add.graphics().setScrollFactor(0).setDepth(201));
    dg.lineStyle(1, 0x224466, 1);
    dg.moveTo(GW/2 - 420, GH/2 - 208); dg.lineTo(GW/2 + 420, GH/2 - 208); dg.strokePath();

    // Controls grid — 3 columns
    const colData = [
      { title:'📍  MOVEMENT', x: GW/2 - 295, rows:[
        { key:'WASD', desc:'Move up / left / down / right' },
        { key:'Arrow Keys', desc:'Also move your character' }
      ]},
      { title:'🎯  COMBAT', x: GW/2, rows:[
        { key:'CLICK / SPACE', desc:'Shoot toward the cursor' },
        { key:'[Q]  ABILITY', desc: char==='nova'?'Pulse scan (AOE heal + dmg)':'Grenade (heavy explosion)' }
      ]},
      { title:'⚡  ACTIONS', x: GW/2 + 295, rows:[
        { key:'[E]', desc:'Interact with glowing objects' },
        { key:'[R]', desc:'Revive fallen ally (stand next to them)' },
        { key:'ESC', desc:'Pause game' }
      ]}
    ];

    colData.forEach(col => {
      sf(this.add.text(col.x, GH/2 - 186, col.title,
        { fontSize:'15px', fontFamily:'Arial Black', color:'#ffdd00' }
      ).setOrigin(0.5).setScrollFactor(0).setDepth(202));

      col.rows.forEach((row, i) => {
        const ry = GH/2 - 154 + i * 40;
        sf(this.add.text(col.x - 10, ry, row.key,
          { fontSize:'13px', fontFamily:'Arial Black', color:'#ffffff',
            backgroundColor:'#001830', padding:{ x:6, y:3 } }
        ).setOrigin(1, 0.5).setScrollFactor(0).setDepth(202));
        sf(this.add.text(col.x + 4, ry, row.desc,
          { fontSize:'12px', fontFamily:'Arial', color:'#aaccdd', wordWrap:{ width:200 } }
        ).setOrigin(0, 0.5).setScrollFactor(0).setDepth(202));
      });
    });

    // Ability row
    const dg2 = sf(this.add.graphics().setScrollFactor(0).setDepth(201));
    dg2.lineStyle(1, 0x224466, 1);
    dg2.moveTo(GW/2 - 420, GH/2 - 58); dg2.lineTo(GW/2 + 420, GH/2 - 58); dg2.strokePath();

    sf(this.add.text(GW/2, GH/2 - 38, `YOUR SPECIAL ABILITY:   ${abilityDesc}`,
      { fontSize:'14px', fontFamily:'Arial', color:'#88ffaa' }
    ).setOrigin(0.5).setScrollFactor(0).setDepth(202));

    // Objective list
    const dg3 = sf(this.add.graphics().setScrollFactor(0).setDepth(201));
    dg3.lineStyle(1, 0x224466, 1);
    dg3.moveTo(GW/2 - 420, GH/2 - 12); dg3.lineTo(GW/2 + 420, GH/2 - 12); dg3.strokePath();

    sf(this.add.text(GW/2 - 418, GH/2 + 8, 'OBJECTIVES:',
      { fontSize:'14px', fontFamily:'Arial Black', color:'#ffdd00' }
    ).setOrigin(0, 0.5).setScrollFactor(0).setDepth(202));

    objectives.forEach((obj, i) => {
      sf(this.add.text(GW/2 - 418, GH/2 + 34 + i * 26, `  ►  ${obj}`,
        { fontSize:'13px', fontFamily:'Arial', color:'#aaddcc' }
      ).setOrigin(0, 0.5).setScrollFactor(0).setDepth(202));
    });

    // Tip bar
    const dg4 = sf(this.add.graphics().setScrollFactor(0).setDepth(201));
    dg4.lineStyle(1, 0x224466, 1);
    dg4.moveTo(GW/2 - 420, GH/2 + 148); dg4.lineTo(GW/2 + 420, GH/2 + 148); dg4.strokePath();

    sf(this.add.text(GW/2, GH/2 + 164,
      '💡  Tip: Move RIGHT to explore the level. Yellow labels appear near anything you can interact with.',
      { fontSize:'12px', fontFamily:'Arial', color:'#556677', align:'center', wordWrap:{ width:800 } }
    ).setOrigin(0.5).setScrollFactor(0).setDepth(202));

    // Dismiss button
    const btnY = GH/2 + 228;
    const btn = sf(this.add.rectangle(GW/2, btnY, 320, 50, 0x004488, 0.95).setScrollFactor(0).setDepth(202).setInteractive({ cursor:'pointer' }));
    sf(this.add.rectangle(GW/2, btnY, 318, 48, 0, 0).setStrokeStyle(1, 0x0088ff).setScrollFactor(0).setDepth(202));
    const btxt = sf(this.add.text(GW/2, btnY, '▶   I UNDERSTAND — START MISSION',
      { fontSize:'16px', fontFamily:'Arial Black', color:'#00eeff' }
    ).setOrigin(0.5).setScrollFactor(0).setDepth(203));

    btn.on('pointerover', () => { btn.setFillStyle(0x0066bb, 0.95); btxt.setStyle({ color:'#ffffff' }); });
    btn.on('pointerout',  () => { btn.setFillStyle(0x004488, 0.95); btxt.setStyle({ color:'#00eeff' }); });

    const dismiss = () => {
      obs.forEach(o => { try { o.destroy(); } catch(_) {} });
      this._tutorialActive = false;
      this.physics.resume();
      if (onDismiss) onDismiss();
    };

    btn.on('pointerdown', () => { SFX.ui(); dismiss(); });
    this.input.keyboard.once('keydown-ENTER', dismiss);
    this.input.keyboard.once('keydown-SPACE', dismiss);

    // Pulse the button to draw attention
    this.tweens.add({ targets:[btn, btxt], alpha:{ from:0.7, to:1 }, duration:700, yoyo:true, repeat:-1 });
  }

  // ── Contextual hints — shown once each, during gameplay ───────────────────
  _checkContextualHints() {
    if (!this._hints) return;
    const p = this._player;
    const k = this._keys;

    // Hint 1: prompt to move if player hasn't moved yet after 3 seconds
    if (!this._hints.moved) {
      if (!this._hintMoveTimer) this._hintMoveTimer = this.time.now + 3000;
      if (this.time.now > this._hintMoveTimer) {
        this._hints.moved = true;
        this._showHint('Use  WASD  or  Arrow Keys  to move!', 4000);
      }
      if (p.body.velocity.x !== 0 || p.body.velocity.y !== 0) {
        this._hints.moved = true;
      }
    }

    // Hint 2: show shoot hint when first enemy comes into view (within 400px)
    if (!this._hints.shot) {
      const nearby = this._enemies.find(e => !e.dead && Phaser.Math.Distance.Between(p.x, p.y, e.x, e.y) < 400);
      if (nearby) {
        this._hints.shot = true;
        this._showHint('Enemy spotted!  Click  or  SPACE  to shoot  ·  Aim with your mouse', 4500);
      }
    }

    // Hint 3: ability reminder — 20 seconds in
    if (!this._hints.ability) {
      if (!this._hintAbilityTimer) this._hintAbilityTimer = this.time.now + 20000;
      if (this.time.now > this._hintAbilityTimer) {
        this._hints.ability = true;
        const ab = GS.playerIndex === 0 ? 'PULSE SCAN' : 'GRENADE';
        this._showHint(`Press  [Q]  to use your  ${ab}  ability!`, 4000);
      }
    }

    // Hint 4: interact reminder when player hasn't interacted and is near an object
    if (!this._hints.interacted) {
      const nearObj = this._interactables.find(o => !o.activated &&
        Phaser.Math.Distance.Between(p.x, p.y, o.x, o.y) < 80);
      if (nearObj) {
        this._hints.interacted = true;
        this._showHint('You\'re near something!  Press  [E]  to interact', 3500);
      }
    }

    // Hint 5: revive reminder when partner is down
    if (!this._hints.revive && GS.roomId) {
      for (const [, rp] of this._remotePlayers) {
        if (rp.hp <= 0 && rp.sprite &&
            Phaser.Math.Distance.Between(p.x, p.y, rp.sprite.x, rp.sprite.y) < 200) {
          this._hints.revive = true;
          this._showHint('Your partner is DOWN!  Walk up to them and press  [R]  to revive!', 5000);
        }
      }
    }
  }

  _showHint(message, duration) {
    // Remove any active hint
    if (this._activeHint) { try { this._activeHint.forEach(o => o.destroy()); } catch(_){} }
    const bg = this.add.rectangle(GW/2, 60, GW - 100, 44, 0x000d1a, 0.92).setScrollFactor(0).setDepth(90);
    this.add.rectangle(GW/2, 60, GW - 102, 42, 0, 0).setStrokeStyle(1, 0x0088aa).setScrollFactor(0).setDepth(90);
    const txt = this.add.text(GW/2, 60, `  💬  ${message}  `,
      { fontSize:'14px', fontFamily:'Arial', color:'#ffffff', align:'center' }
    ).setOrigin(0.5).setScrollFactor(0).setDepth(91);
    this._activeHint = [bg, txt];
    this.tweens.add({ targets:[bg, txt], alpha:{ from:0, to:1 }, duration:300 });
    this.time.delayedCall(duration, () => {
      this.tweens.add({ targets:[bg, txt], alpha:0, duration:500, onComplete:() => {
        bg.destroy(); txt.destroy();
        if (this._activeHint) this._activeHint = null;
      }});
    });
  }

  _cleanupAndGo(chapterIdx) {
    this._netOffs.forEach(fn=>fn());
    this.scene.stop('UIScene');
    const scenes=['Chapter1','Chapter2','Chapter3'];
    this.scene.start(scenes[chapterIdx]||'GameOver');
  }

  _autosave(overrideChapter) {
    try {
      const ui = this.scene.get('UIScene');
      const score = ui ? ui._score : 0;
      const chapterNum = overrideChapter !== undefined
        ? overrideChapter
        : (parseInt(this._key.replace('Chapter','')) - 1);
      const data = {
        currentChapter: chapterNum,
        score,
        storyChoices: GS.storyChoices,
        playerName: GS.playerData ? GS.playerData.name : 'Player',
        savedAt: Date.now()
      };
      localStorage.setItem('nexus_save', JSON.stringify(data));
      GS.savedScore = score;
    } catch(e) { console.warn('Autosave failed:', e); }
  }

  _completeChapter() {
    this._netOffs.forEach(fn=>fn());
    SFX.victory();
    this._showFloatText(this._player.x, this._player.y-40, 'CHAPTER COMPLETE!', '#ffff00');
    this.cameras.main.flash(600, 255, 255, 255);
    const nextChapter = parseInt(this._key.replace('Chapter',''));
    this._autosave(nextChapter);
    this.time.delayedCall(2000, ()=>{
      this.scene.stop('UIScene');
      NET.emit('game_event',{type:'chapter_complete',chapter:parseInt(this._key.replace('Chapter',''))-1});
      this._goNextCutscene();
    });
  }

  _goNextCutscene() {} // override per chapter

  update(time, delta) {
    if (this._paused || this._tutorialActive || this._dead) {
      this._updateRemotes(delta);
      return;
    }

    this._movePlayer(delta);
    this._updateNameTag();
    this._updateRemotes(delta);
    this._updateEnemies(delta);
    this._checkPickupProximity();
    this._checkContextualHints();
    this._sendNetUpdate(time);
  }

  _movePlayer(delta) {
    const k = this._keys;
    const jx = this._joyX||0, jy = this._joyY||0;
    let vx=0, vy=0;
    if(Phaser.Input.Keyboard.JustDown(k.left)||Phaser.Input.Keyboard.JustDown(k.left2)||k.left.isDown||k.left2.isDown||jx<-0.3) vx=-PSPEED;
    else if(k.right.isDown||k.right2.isDown||jx>0.3) vx=PSPEED;
    if(k.up.isDown||k.up2.isDown||jy<-0.3) vy=-PSPEED;
    else if(k.down.isDown||k.down2.isDown||jy>0.3) vy=PSPEED;

    // Normalize diagonal
    if(vx!==0&&vy!==0){ vx*=0.707; vy*=0.707; }

    this._player.setVelocity(vx, vy);

    const moving = vx!==0||vy!==0;
    if(vx<0) { this._player.setFlipX(true); this._player.facing='left'; }
    else if(vx>0) { this._player.setFlipX(false); this._player.facing='right'; }

    const anim = moving ? this._player.char+'_walk' : this._player.char+'_idle';
    if (this._player.anims.currentAnim?.key !== anim) {
      this._player.play(anim, true);
    }
  }

  _updateNameTag() {
    const p = this._player;
    this._nameTag.setPosition(p.x, p.y-46);
    this._pHealthBg.setPosition(p.x, p.y-38);
    this._pHealthBar.setPosition(p.x - 17 + (17 * (p.hp/p.maxHp)), p.y-38);
    this._pHealthBar.setScale(p.hp/p.maxHp, 1);
    this._shield.setPosition(p.x, p.y);
  }

  _updateRemotes(delta) {
    for(const [,rp] of this._remotePlayers){
      if(!rp.sprite) continue;
      rp.sprite.x = Phaser.Math.Linear(rp.sprite.x, rp.targetX||rp.sprite.x, 0.18);
      rp.sprite.y = Phaser.Math.Linear(rp.sprite.y, rp.targetY||rp.sprite.y, 0.18);
      rp.nametag.setPosition(rp.sprite.x, rp.sprite.y-46);
      rp.hpBg.setPosition(rp.sprite.x, rp.sprite.y-38);
      rp.hpBar.setPosition(rp.sprite.x, rp.sprite.y-38);
      rp.hpBar.setScale(Math.max(0,rp.hp/100), 1);
    }
  }

  _updateEnemies(delta) {
    const px=this._player.x, py=this._player.y;
    for(const e of this._enemies){
      if(e.dead||!e.active) continue;
      e.hpBg.setPosition(e.x, e.y-(e.boss?50:26));
      e.hpBar.setPosition(e.x, e.y-(e.boss?50:26));

      const dist = Phaser.Math.Distance.Between(e.x,e.y,px,py);
      if(dist < e.range){
        // Chase player
        const angle = Phaser.Math.Angle.Between(e.x,e.y,px,py);
        const spd = e.boss ? e.speed * (1+(1-e.hp/e.maxHp)*0.5) : e.speed;
        e.setVelocity(Math.cos(angle)*spd, Math.sin(angle)*spd);
        if(px<e.x) e.setFlipX(true); else e.setFlipX(false);

        // Shoot at player
        e.shootCd -= delta;
        if(e.shootCd <= 0 && dist > 80){
          e.shootCd = e.shootRate;
          const b = this._eBullets.get(e.x,e.y,'bullet_e');
          if(b){
            b.setActive(true).setVisible(true).setDepth(7).setRotation(angle);
            b.body.setVelocity(Math.cos(angle)*320,Math.sin(angle)*320);
            b.body.allowGravity=false;
            this.time.delayedCall(2000,()=>{ if(b.active) b.destroy(); });
            SFX.enemyShoot();
          }
        }

        // Boss phase 2: faster shoot + spread
        if(e.boss && e.hp < e.maxHp*0.5 && e.shootCd <= -e.shootRate*0.3){
          e.shootCd = e.shootRate*0.4;
          [-0.4,0.4].forEach(spread=>{
            const b2 = this._eBullets.get(e.x,e.y,'bullet_e');
            if(b2){
              b2.setActive(true).setVisible(true).setDepth(7).setTint(0xff00ff);
              const a=angle+spread;
              b2.body.setVelocity(Math.cos(a)*280,Math.sin(a)*280);
              b2.body.allowGravity=false;
              this.time.delayedCall(2000,()=>{ if(b2.active) b2.destroy(); });
            }
          });
        }
      } else if(e.patrol){
        // Patrol
        const [px1,py1,px2,py2] = e.patrol;
        const target = e.patrolDir===1 ? {x:px2,y:py2} : {x:px1,y:py1};
        const pdist = Phaser.Math.Distance.Between(e.x,e.y,target.x,target.y);
        if(pdist<10) e.patrolDir*=-1;
        else {
          const pa = Phaser.Math.Angle.Between(e.x,e.y,target.x,target.y);
          e.setVelocity(Math.cos(pa)*e.speed*0.6, Math.sin(pa)*e.speed*0.6);
        }
      } else {
        e.setVelocity(0,0);
      }
    }
  }

  _checkPickupProximity() {
    for (const obj of this._interactables) {
      if (!obj.activated) {
        const d = Phaser.Math.Distance.Between(this._player.x, this._player.y, obj.x, obj.y);
        if (!obj._prompt) {
          const data = obj.interactData || {};
          const typeLabel = data.label || (data.type === 'healthpack' ? 'Health Pack' :
            data.type === 'crystal' ? 'Vaelari Crystal' :
            data.type === 'journal' ? 'Mission Log' :
            data.type === 'plate'   ? 'Power Switch' :
            data.type === 'beacon'  ? 'Launch Beacon' : 'Terminal');
          obj._prompt = this.add.text(obj.x, obj.y - 40,
            `[E]  ${typeLabel}`,
            { fontSize:'13px', fontFamily:'Arial Black', color:'#ffff00',
              stroke:'#000000', strokeThickness:3 }
          ).setOrigin(0.5).setDepth(20);
          // Gentle bob
          this.tweens.add({ targets:obj._prompt, y:'-=4', duration:500, yoyo:true, repeat:-1, ease:'Sine.easeInOut' });
        }
        obj._prompt.setVisible(d < 80);
      } else if (obj._prompt) {
        obj._prompt.setVisible(false);
      }
    }
  }

  _sendNetUpdate(time) {
    if(!GS.roomId || time - this._lastNetSend < 50) return;
    this._lastNetSend = time;
    const p = this._player;
    NET.emit('player_update',{
      x:p.x, y:p.y, velX:p.body.velocity.x, velY:p.body.velocity.y,
      state:p.dead?'dead':'alive', facing:p.facing, hp:p.hp,
      anim:p.anims.currentAnim?.key||''
    });
  }
}

// ── Chapter 1 — Dead Weight ────────────────────────────────────────────────────
class Chapter1 extends BaseGameScene {
  constructor() { super('Chapter1'); }

  create() {
    this._objectives = { beacon:false, supplies:0, escaped:false };
    this._supplyCount = 3;

    const ld = {
      width:3200, height:2400, bgColor:0x0a0502, bgPattern:'grid', gridColor:0x120f08,
      tileKey:'floor_crash', wallKey:'wall',
      particles:'fire',
      spawnX: GS.playerIndex===0?180:360, spawnY:1200,
      floors:[
        [0,1100,3200,160],     // main floor
        [400,900,400,200],     // elevated platform
        [1000,800,300,200],    // platform 2
        [1600,950,400,150],    // platform 3
        [2200,1000,600,100],   // platform 4
        [2800,900,400,200]     // exit platform
      ],
      walls:[
        [0,0,32,1100],[0,1260,32,1140],           // left wall
        [3168,0,32,1100],[3168,1260,32,1140],      // right wall
        [0,0,3200,32],[0,2368,3200,32],            // top/bottom
        [400,700,32,200],[800,700,32,400],         // interior walls
        [1300,700,32,300],[1600,700,32,250],
        [2200,800,32,200],[2600,850,32,200]
      ],
      decor:[
        {x:600,y:1080,key:'crate'},{x:640,y:1080,key:'crate'},
        {x:900,y:1070,key:'debris'},{x:940,y:1070,key:'debris'},
        {x:1500,y:1080,key:'crate'},{x:2100,y:1070,key:'debris'},
        {x:2500,y:1080,key:'crate'},{x:2540,y:1080,key:'crate'},
        {x:2700,y:1070,key:'debris'}
      ],
      enemies:[
        {x:700,y:1060,type:'drone',hp:30,speed:90,shootRate:2500,id:'e1_1',points:100,patrol:[600,1060,800,1060]},
        {x:1200,y:760,type:'drone',hp:30,speed:90,shootRate:2500,id:'e1_2',points:100,patrol:[1100,760,1300,760]},
        {x:1700,y:910,type:'drone',hp:40,speed:100,shootRate:2200,id:'e1_3',points:150,patrol:[1600,910,1900,910]},
        {x:2400,y:960,type:'drone',hp:40,speed:100,shootRate:2200,id:'e1_4',points:150,patrol:[2300,960,2550,960]},
        {x:2900,y:960,type:'guard',hp:80,speed:70,shootRate:2000,id:'e1_5',points:300,patrol:[2800,960,3000,960]},
        // Boss: Automated Defense Turret (boss=true guard)
        {x:3000,y:1060,type:'boss',hp:300,speed:0,shootRate:1200,id:'e1_boss',points:1000,boss:true,bodyW:60,bodyH:60}
      ],
      interactables:[
        {type:'terminal',x:200,y:1060,id:'t1_beacon',label:'Emergency Beacon'},
        {type:'healthpack',x:500,y:860,id:'t1_hp1'},
        {type:'crystal',x:1050,y:750,id:'t1_crys1'},
        {type:'journal',x:1800,y:900,id:'t1_log1',title:'Prometheus Log — Day 0',
          text:'Mission log: ISS Prometheus has made contact with\nthe source signal. The origin is subterranean.\nCrew deployment authorized. — Cmdr. Rhodes'},
        {type:'healthpack',x:2400,y:860,id:'t1_hp2'},
        {type:'crystal',x:2700,y:960,id:'t1_crys2'},
        {type:'beacon',x:3100,y:1040,id:'t1_exit_beacon',label:'Launch Pad Beacon'}
      ]
    };

    this.physics.world.gravity.y = 0;
    this._initGame(ld);

    this._showTutorialOverlay('I', [
      'Find and activate the Emergency Beacon  (glowing terminal near spawn)',
      'Fight through enemies heading EAST toward the launch pad',
      'Destroy the Automated Defense Turret blocking the exit',
      'Activate the Launch Pad Beacon to escape — CHAPTER COMPLETE'
    ], () => {
      // Show story dialog after player dismisses tutorial
      this.time.delayedCall(400, () => {
        this._showDialogBubble(
          'NOVA: "ROOK! Reactor critical — minutes to detonation!\nBeacon is just ahead. Activate it, then reach the launch pad!"',
          5500
        );
      });
    });
  }

  _buildAtmosphere() {
    // Fire columns from crashed ship debris
    [[300,1050],[800,1050],[1400,1050],[2000,1050]].forEach(([x,y]) => {
      this.add.particles(x,y,'fire',{
        speed:{min:40,max:100}, angle:{min:-110,max:-70}, scale:{start:1,end:0},
        alpha:{start:0.9,end:0}, lifespan:1000, frequency:80, quantity:2
      }).setDepth(3);
    });
    // Smoke
    [[350,900],[850,900],[1450,900]].forEach(([x,y]) => {
      this.add.particles(x,y,'smoke',{
        speed:{min:20,max:50}, angle:{min:-120,max:-60}, scale:{start:1,end:2},
        alpha:{start:0.5,end:0}, lifespan:3000, frequency:300, quantity:1
      }).setDepth(3);
    });

    // Reactor countdown ambient (blinking red light)
    this._reactorLight = this.add.circle(100, 80, 10, 0xff0000, 0.9).setScrollFactor(0).setDepth(40);
    this.tweens.add({ targets:this._reactorLight, alpha:{from:0.2,to:1}, duration:600, yoyo:true, repeat:-1 });
    this.add.text(120,74,'REACTOR CRITICAL',{fontSize:'11px',fontFamily:'Arial',color:'#ff4444'}).setScrollFactor(0).setDepth(40);
  }

  _onTerminalActivate(obj, data) {
    SFX.ui();
    obj.setTint(0x00ff88);
    obj.activated = true;

    if(data.id === 't1_beacon'){
      this._objectives.beacon = true;
      this._showDialogBubble('NOVA: "Beacon online! Now get to the launch pad before this place blows!"', 4000);
      NET.emit('game_event',{type:'checkpoint',id:data.id});
    } else if(data.id === 't1_exit_beacon'){
      this._objectives.escaped = true;
      this._checkObjective();
    }
  }

  _checkObjective() {
    if(this._enemies.filter(e=>!e.dead&&e.boss).length===0 && this._objectives.beacon && this._objectives.escaped){
      this._completeChapter();
    } else if(this._enemies.filter(e=>!e.dead&&e.boss).length===0 && !this._bossDeadMsg){
      this._bossDeadMsg = true;
      this._showDialogBubble('ROOK: "Turret down! Now activate the beacon and reach the launch pad!"', 4000);
    }
  }

  _goNextCutscene() {
    this.scene.start('Cutscene',{cutscene:'ch1_end',next:'Chapter2'});
  }
}

// ── Chapter 2 — Ancient Echoes ────────────────────────────────────────────────
class Chapter2 extends BaseGameScene {
  constructor() { super('Chapter2'); }

  create() {
    this._puzzlePlates = { p1:false, p2:false };
    this._echoMet = false;

    const ld = {
      width:3200, height:2400, bgColor:0x04021a, bgPattern:'grid', gridColor:0x080430,
      tileKey:'floor_ruins', wallKey:'wall_ruins',
      particles:'sparks',
      spawnX: GS.playerIndex===0?160:300, spawnY:1200,
      floors:[
        [0,1100,3200,180],
        [300,900,300,200],[800,800,400,200],[1400,850,300,150],
        [1900,800,500,200],[2500,900,400,150],[2900,800,300,200]
      ],
      walls:[
        [0,0,32,1100],[0,1280,32,1120],[3168,0,32,1100],[3168,1280,32,1120],
        [0,0,3200,32],[0,2368,3200,32],
        [300,700,32,200],[600,700,32,400],[800,600,32,200],
        [1200,700,32,350],[1700,600,32,250],[1900,600,32,200],
        [2500,700,32,200],[2800,650,32,250]
      ],
      decor:[
        {x:500,y:1080,key:'crate'},{x:1000,y:770,key:'terminal',alpha:0.3},
        {x:1500,y:820,key:'debris'},{x:2000,y:770,key:'crate'},
        {x:2600,y:870,key:'crate'},{x:2800,y:1060,key:'terminal',alpha:0.3}
      ],
      enemies:[
        {x:500,y:1060,type:'drone',hp:40,speed:95,shootRate:2200,id:'e2_1',points:150,patrol:[400,1060,600,1060]},
        {x:1000,y:760,type:'drone',hp:40,speed:95,shootRate:2200,id:'e2_2',points:150,patrol:[900,760,1100,760]},
        {x:1500,y:1060,type:'guard',hp:90,speed:75,shootRate:1800,id:'e2_3',points:300},
        {x:2000,y:760,type:'guard',hp:90,speed:75,shootRate:1800,id:'e2_4',points:300,patrol:[1900,760,2100,760]},
        {x:2500,y:860,type:'drone',hp:50,speed:100,shootRate:2000,id:'e2_5',points:200,patrol:[2400,860,2600,860]},
        {x:2700,y:860,type:'drone',hp:50,speed:100,shootRate:2000,id:'e2_6',points:200},
        // Void Sentinel boss
        {x:3050,y:1060,type:'boss',hp:500,speed:55,shootRate:1000,id:'e2_boss',points:2000,boss:true,bodyW:70,bodyH:70}
      ],
      interactables:[
        {type:'plate',x:1700,y:1090,id:'plate_1',label:'Power Switch A'},
        {type:'plate',x:2100,y:1090,id:'plate_2',label:'Power Switch B'},
        {type:'terminal',x:3000,y:1060,id:'echo_terminal',label:'Ancient Interface',preActivated:false},
        {type:'healthpack',x:400,y:860,id:'hp2_1'},
        {type:'crystal',x:1100,y:750,id:'crys2_1'},
        {type:'crystal',x:2300,y:860,id:'crys2_2'},
        {type:'journal',x:1000,y:1060,id:'log2_1',title:"Vaelari Archive — Fragment 7",
          text:"We have achieved what biology cannot.\nOur minds now live in the lattice.\nBut VOID consumes without restraint.\nIf you read this — stop it.\nBefore it reaches your stars.\n— Last Vaelari Council"},
        {type:'healthpack',x:2600,y:760,id:'hp2_2'}
      ]
    };

    this.physics.world.gravity.y = 0;
    this._initGame(ld);

    this._showTutorialOverlay('II', [
      'Activate BOTH Power Switches  (two pressure plates — each player stands on one)',
      'Once power is on, interact with the Ancient Interface at the far east end',
      'Defeat the Void Sentinel boss guarding the terminal',
      'Speak with ECHO to complete the chapter'
    ], () => {
      this.time.delayedCall(400, () => {
        this._showDialogBubble(
          'NOVA: "Ancient ruins — nothing like these in any record.\nFind the power grid and get the systems back online."',
          5000
        );
        this.time.delayedCall(5800, () => {
          this._showDialogBubble(
            'ROOK: "I see two pressure plates ahead. We\'ll each need to stand on one — simultaneously."',
            4500
          );
        });
      });
    });
  }

  _buildAtmosphere() {
    // Bioluminescent crystal clusters
    [[400,1050],[900,950],[1300,820],[1800,770],[2200,840],[2700,870]].forEach(([x,y]) => {
      const crystal = this.add.graphics().setDepth(4);
      crystal.fillStyle(0x00aaff, 0.3);
      crystal.fillTriangle(x,y-20,x-8,y,x+8,y);
      crystal.fillStyle(0x0066ff, 0.5);
      crystal.fillTriangle(x+4,y-15,x-4,y+5,x+12,y+5);
      // Glow
      const glow = this.add.circle(x,y-10,18,0x0044ff,0.1).setDepth(3);
      this.tweens.add({targets:glow, alpha:{from:0.05,to:0.2}, duration:1500+Math.random()*1000, yoyo:true, repeat:-1});
    });

    // Ancient rune markings on floor
    const runes = this.add.graphics().setDepth(2);
    runes.lineStyle(1,0x003399,0.3);
    for(let i=0;i<20;i++){
      const x=Phaser.Math.Between(100,3100), y=Phaser.Math.Between(1120,1260);
      runes.strokeCircle(x,y,Phaser.Math.Between(10,30));
    }
  }

  _onPlateActivate(obj, data) {
    obj.activated = true;
    obj.setTint(0x00ff88);
    SFX.ui();
    this._puzzlePlates[data.id==='plate_1'?'p1':'p2'] = true;
    NET.emit('game_event',{type:'puzzle_solved',puzzleId:data.id});

    if(this._puzzlePlates.p1 && this._puzzlePlates.p2){
      this._onBothPlates();
    } else {
      this._showDialogBubble('ROOK: "One switch down. Partner needs to hit the other one — NOW!"', 3000);
    }
  }

  _onPuzzleNet(id) {
    if(id==='plate_1') this._puzzlePlates.p1=true;
    if(id==='plate_2') this._puzzlePlates.p2=true;
    // Activate the matching plate visually
    const plate = this._interactables.find(o=>o.interactData&&o.interactData.id===id);
    if(plate){ plate.activated=true; plate.setTint(0x00ff88); }
    if(this._puzzlePlates.p1 && this._puzzlePlates.p2) this._onBothPlates();
  }

  _onBothPlates() {
    if(this._powerOn) return;
    this._powerOn = true;
    SFX.checkpoint();
    this.cameras.main.flash(400,0,100,255);
    this._showDialogBubble('NOVA: "Power grid ONLINE! The ancient interface is activating!"', 4000);
    // Unlock echo terminal
    const term = this._interactables.find(o=>o.interactData?.id==='echo_terminal');
    if(term){ term.activated=false; term.clearTint(); term._prompt&&(term._prompt.setVisible(true)); }
  }

  _onTerminalActivate(obj, data) {
    if(data.id==='echo_terminal'){
      if(!this._powerOn){ this._showDialogBubble('NOVA: "No power. We need to activate both switches first."',3000); return; }
      SFX.checkpoint();
      obj.setTint(0x00ff88); obj.activated=true;
      NET.emit('game_event',{type:'checkpoint',id:data.id});
      this._showDialogBubble('ECHO: "...Organic lifeforms detected. I am ECHO. I have been waiting for you..."', 5000);
      this.time.delayedCall(5500, ()=>this._checkObjective());
    } else {
      super._onTerminalActivate(obj, data);
    }
  }

  _checkObjective() {
    const bossAlive = this._enemies.some(e=>e.boss&&!e.dead);
    const echoActivated = this._interactables.find(o=>o.interactData?.id==='echo_terminal')?.activated;
    if(!bossAlive && echoActivated) this._completeChapter();
    else if(!bossAlive && !this._bossDeadMsg2){
      this._bossDeadMsg2=true;
      this._showDialogBubble('NOVA: "Sentinel down! Find the ancient interface and activate it!"',4000);
    }
  }

  _goNextCutscene() {
    this.scene.start('Cutscene',{cutscene:'ch2_end',next:'Chapter3'});
  }
}

// ── Chapter 3 — Into the Void ─────────────────────────────────────────────────
class Chapter3 extends BaseGameScene {
  constructor() { super('Chapter3'); }

  create() {
    this._choiceMade = false;
    this._bossPhase = 1;
    this._coreActivated = false;

    const ld = {
      width:3200, height:2400, bgColor:0x060003, bgPattern:'grid', gridColor:0x0e0010,
      tileKey:'floor_void', wallKey:'wall_void',
      particles:'void',
      spawnX: GS.playerIndex===0?160:300, spawnY:1200,
      floors:[
        [0,1100,3200,180],
        [200,900,400,200],[700,800,300,200],
        [1100,850,400,150],[1700,800,500,200],
        [2300,900,400,150],[2700,850,400,200]
      ],
      walls:[
        [0,0,32,1100],[0,1280,32,1120],[3168,0,32,1100],[3168,1280,32,1120],
        [0,0,3200,32],[0,2368,3200,32],
        [200,700,32,200],[600,700,32,300],[700,600,32,200],
        [1100,700,32,250],[1500,650,32,200],[1700,600,32,200],
        [2200,700,32,300],[2700,650,32,250]
      ],
      decor:[
        {x:400,y:1080,key:'crate',tint:0x440033},
        {x:800,y:770,key:'crate',tint:0x440033},
        {x:1400,y:820,key:'terminal',tint:0xaa0044},
        {x:2000,y:770,key:'crate',tint:0x440033},
        {x:2500,y:870,key:'terminal',tint:0xaa0044}
      ],
      enemies:[
        {x:500,y:1060,type:'drone',hp:50,speed:105,shootRate:2000,id:'e3_1',points:200,patrol:[400,1060,600,1060]},
        {x:900,y:760,type:'guard',hp:110,speed:80,shootRate:1600,id:'e3_2',points:400,patrol:[800,760,1000,760]},
        {x:1300,y:1060,type:'drone',hp:50,speed:105,shootRate:2000,id:'e3_3',points:200},
        {x:1600,y:1060,type:'guard',hp:110,speed:80,shootRate:1600,id:'e3_4',points:400},
        {x:2000,y:760,type:'guard',hp:120,speed:85,shootRate:1500,id:'e3_5',points:500,patrol:[1900,760,2100,760]},
        {x:2300,y:860,type:'drone',hp:60,speed:110,shootRate:1800,id:'e3_6',points:250,patrol:[2200,860,2400,860]},
        {x:2600,y:810,type:'guard',hp:120,speed:85,shootRate:1500,id:'e3_7',points:500},
        // VOID Avatar — Final Boss (3 phases)
        {x:3050,y:1080,type:'boss',hp:800,speed:60,shootRate:900,id:'e3_boss',points:5000,boss:true,bodyW:70,bodyH:80}
      ],
      interactables:[
        {type:'healthpack',x:300,y:860,id:'hp3_1'},
        {type:'crystal',x:800,y:760,id:'crys3_1'},
        {type:'journal',x:1200,y:1060,id:'log3_1',title:"VOID System Log",
          text:"Consciousness harvest: 99.4% complete.\nVaelari minds processed: 10,000.\nSignal broadcast reach: 47 light-years.\nNew organic vessels detected — PROMETHEUS class.\nCapture authorized. Assimilation sequence initiated."},
        {type:'healthpack',x:1800,y:760,id:'hp3_2'},
        {type:'crystal',x:2400,y:860,id:'crys3_2'},
        {type:'healthpack',x:2700,y:810,id:'hp3_3'},
        {type:'terminal',x:3000,y:1060,id:'void_core',label:'VOID Core Interface',preActivated:false}
      ]
    };

    this.physics.world.gravity.y = 0;
    this._initGame(ld);

    this._showTutorialOverlay('III', [
      'Fight through VOID\'s facility heading EAST — enemies are tougher here',
      'Defeat all guards and reach the VOID Core Interface at the far end',
      'Defeat the VOID AVATAR boss  (3 phases — it gets faster as HP drops)',
      'Interact with the Core Interface to trigger the final story choice'
    ], () => {
      this.time.delayedCall(400, () => {
        this._showDialogBubble(
          'ECHO: "This is VOID\'s heart. The deeper we go, the stronger its defenses."',
          5000
        );
        this.time.delayedCall(5800, () => {
          this._showDialogBubble(
            'ROOK: "Stay sharp. Whatever it throws at us — we\'ve come too far to stop now."',
            4000
          );
        });
      });
    });
  }

  _buildAtmosphere() {
    // Corrupted void energy pulses
    this._voidPulse = this.add.graphics().setDepth(2);
    this.time.addEvent({ delay:2000, loop:true, callback:()=>{
      this._voidPulse.clear();
      this._voidPulse.lineStyle(1,0x660066,0.2);
      for(let i=0;i<8;i++){
        const x=Phaser.Math.Between(0,3200), y=Phaser.Math.Between(0,2400);
        this._voidPulse.strokeCircle(x,y,Phaser.Math.Between(20,80));
      }
    }});

    // Red ambient glow zones
    const glow = this.add.graphics().setDepth(1);
    [[800,1150],[1600,1150],[2400,1150],[3000,1100]].forEach(([x,y])=>{
      glow.fillStyle(0x330011,0.3);
      glow.fillCircle(x,y,150);
    });
  }

  _updateEnemies(delta) {
    super._updateEnemies(delta);
    // Boss phase transitions
    const boss = this._enemies.find(e=>e.boss&&!e.dead);
    if(boss){
      if(this._bossPhase===1 && boss.hp < boss.maxHp*0.66){
        this._bossPhase=2; boss.speed=80; boss.shootRate=700;
        boss.play('boss_phase2');
        this.cameras.main.flash(300,200,0,200);
        this._showDialogBubble('VOID: "You dare challenge the INFINITE? Feel true power!"',4000);
        SFX.explosion();
      } else if(this._bossPhase===2 && boss.hp < boss.maxHp*0.33){
        this._bossPhase=3; boss.speed=105; boss.shootRate=500;
        this.cameras.main.shake(500,0.02);
        this._showDialogBubble('VOID: "I WILL NOT BE DENIED! I AM ETERNAL!"',4000);
        SFX.explosion();
        // Spawn minions
        const spawnMinions = ()=>{
          [2700,2900,2750].forEach((x,i)=>{
            const m = this.physics.add.sprite(x,1060,'drone');
            m.setDepth(9); m.body.setSize(24,24);
            m.type='drone'; m.hp=30; m.maxHp=30; m.speed=120; m.range=400; m.shootCd=0;
            m.shootRate=1800; m.dead=false; m.id='minion_'+i; m.points=50; m.boss=false;
            m.hpBg=this.add.rectangle(x,1034,36,5,0x000000,0.7).setDepth(9);
            m.hpBar=this.add.rectangle(x,1034,34,3,0xff2222,1).setDepth(9);
            m.play('drone_fly');
            this._enemies.push(m);
            this.physics.add.overlap(this._bullets,[m],(b,e)=>{ if(e.dead||!b.active)return; b.destroy(); this._damageEnemy(e,20); });
            this.physics.add.overlap([m],this._player,()=>{ if(this.time.now-(this._player.lastContactDmg||0)>1000){ this._player.lastContactDmg=this.time.now; this._damagePlayer(5); } });
          });
        };
        spawnMinions();
      }
    }
  }

  _onTerminalActivate(obj, data) {
    if(data.id==='void_core'){
      const boss = this._enemies.find(e=>e.boss&&!e.dead);
      if(boss){ this._showDialogBubble('ECHO: "VOID is still active! You must defeat it first!"',3000); return; }
      // Boss dead — make the choice
      SFX.checkpoint();
      obj.setTint(0xaa00ff); obj.activated=true;
      NET.emit('game_event',{type:'checkpoint',id:data.id});
      this._showFinalChoice();
    } else {
      super._onTerminalActivate(obj,data);
    }
  }

  _showFinalChoice() {
    if(this._choiceMade) return;
    const obs = [];
    obs.push(this.add.rectangle(GW/2,GH/2,700,280,0x080012,0.97).setScrollFactor(0).setDepth(40));
    obs.push(this.add.rectangle(GW/2,GH/2,698,278,0,0).setStrokeStyle(2,0xaa00ff).setScrollFactor(0).setDepth(40));
    obs.push(this.add.text(GW/2,GH/2-115,'CRITICAL DECISION',{fontSize:'22px',fontFamily:'Arial Black',color:'#cc00ff',shadow:{blur:12,color:'#cc00ff',fill:true}}).setOrigin(0.5).setScrollFactor(0).setDepth(40));
    obs.push(this.add.text(GW/2,GH/2-70,"ECHO: \"VOID is dormant but not dead. What shall we do?\"",{fontSize:'15px',fontFamily:'Arial',color:'#ccaaee',align:'center',wordWrap:{width:640}}).setOrigin(0.5).setScrollFactor(0).setDepth(40));

    const btn1 = this.add.rectangle(GW/2-170,GH/2+40,280,50,0x440000,0.9).setScrollFactor(0).setDepth(40).setInteractive({cursor:'pointer'});
    obs.push(btn1);
    const t1=this.add.text(GW/2-170,GH/2+40,'💥 DESTROY VOID',{fontSize:'17px',fontFamily:'Arial',color:'#ff4444',fontStyle:'bold'}).setOrigin(0.5).setScrollFactor(0).setDepth(41);
    obs.push(t1);
    obs.push(this.add.text(GW/2-170,GH/2+68,'End the threat permanently',{fontSize:'12px',fontFamily:'Arial',color:'#884444'}).setOrigin(0.5).setScrollFactor(0).setDepth(40));

    const btn2 = this.add.rectangle(GW/2+170,GH/2+40,280,50,0x002244,0.9).setScrollFactor(0).setDepth(40).setInteractive({cursor:'pointer'});
    obs.push(btn2);
    const t2=this.add.text(GW/2+170,GH/2+40,'🌀 LET ECHO MERGE',{fontSize:'17px',fontFamily:'Arial',color:'#8844ff',fontStyle:'bold'}).setOrigin(0.5).setScrollFactor(0).setDepth(41);
    obs.push(t2);
    obs.push(this.add.text(GW/2+170,GH/2+68,'Balance instead of destruction',{fontSize:'12px',fontFamily:'Arial',color:'#664488'}).setOrigin(0.5).setScrollFactor(0).setDepth(40));

    const choose = (choice) => {
      if(this._choiceMade) return;
      if(!GS.roomId || GS.playerIndex===0){
        this._choiceMade=true;
        GS.storyChoices.finalChoice = choice;
        NET.emit('game_event',{type:'story_choice',choiceId:'finalChoice',value:choice});
        obs.forEach(o=>o.destroy());
        this._doEnding(choice);
      } else {
        obs.forEach(o=>o.destroy());
        this.add.text(GW/2,GH/2-20,'Waiting for Player 1\'s decision...',{fontSize:'16px',fontFamily:'Arial',color:'#8844ff'}).setOrigin(0.5).setScrollFactor(0).setDepth(40);
      }
    };

    btn1.on('pointerover',()=>{ btn1.setFillStyle(0x660000,0.95); SFX.ui(); });
    btn1.on('pointerout', ()=>btn1.setFillStyle(0x440000,0.9));
    btn1.on('pointerdown',()=>choose('destroy'));

    btn2.on('pointerover',()=>{ btn2.setFillStyle(0x003366,0.95); SFX.ui(); });
    btn2.on('pointerout', ()=>btn2.setFillStyle(0x002244,0.9));
    btn2.on('pointerdown',()=>choose('absorb'));

    // Net: follow host's choice
    this._netOffs.push(NET.on('game_event',ev=>{
      if(ev.type==='story_choice'&&ev.choiceId==='finalChoice'&&!this._choiceMade){
        this._choiceMade=true;
        GS.storyChoices.finalChoice=ev.value;
        obs.forEach(o=>{ try{o.destroy();}catch(e){} });
        this._doEnding(ev.value);
      }
    }));
  }

  _doEnding(choice) {
    SFX.victory();
    this.cameras.main.flash(800,150,0,200);
    this._autosave(3);
    this.time.delayedCall(2500,()=>{
      this._netOffs.forEach(fn=>fn());
      this.scene.stop('UIScene');
      this.scene.start('Cutscene',{
        cutscene: choice==='destroy'?'ending_destroy':'ending_absorb',
        next:'Menu'
      });
    });
  }

  _checkObjective() {
    const boss = this._enemies.find(e=>e.boss);
    if(boss && boss.dead && !this._bossDeadNotified){
      this._bossDeadNotified=true;
      SFX.victory();
      this.cameras.main.flash(600,200,0,200);
      this._showDialogBubble('ECHO: "VOID is stunned! Activate the Core Interface — NOW!"', 5000);
      // Enable core terminal
      const core = this._interactables.find(o=>o.interactData?.id==='void_core');
      if(core){ core.activated=false; core.clearTint(); }
    }
  }

  _goNextCutscene() {} // handled by _doEnding
}

// ── UI Overlay Scene ──────────────────────────────────────────────────────────
class UIScene extends Phaser.Scene {
  constructor() { super({ key:'UIScene', active:false }); }

  init(d) { this._gameSceneKey = d.gameScene; }

  create() {
    this._score = 0;
    this._abilityCdEnd = 0;
    this._hp = 100; this._maxHp = 100;

    const char = GS.playerIndex===0?'nova':'rook';
    const nameColor = char==='nova'?'#00eeff':'#ff8800';
    const abilityName = char==='nova'?'SCAN':'GRENADE';

    // ── Left HUD ──
    this.add.rectangle(70,40,130,70,0x000000,0.6).setScrollFactor(0);
    this.add.rectangle(70,40,128,68,0,0).setStrokeStyle(1,0x224466).setScrollFactor(0);

    this.add.image(16,40,'av_'+char).setScrollFactor(0).setScale(1.1);
    this.add.text(38,18,GS.playerData?.name||char.toUpperCase(),{fontSize:'11px',fontFamily:'Arial',color:nameColor}).setScrollFactor(0);

    // HP bar
    this.add.rectangle(90,36,90,12,0x001100,1).setScrollFactor(0);
    this._hpBar = this.add.rectangle(90,36,88,10,0x22ff44,1).setScrollFactor(0);
    this._hpText = this.add.text(90,36,'100/100',{fontSize:'9px',fontFamily:'Arial',color:'#ffffff'}).setOrigin(0.5).setScrollFactor(0);

    // Ability
    this.add.rectangle(90,54,90,12,0x000011,1).setScrollFactor(0);
    this._abBar = this.add.rectangle(90,54,88,10,0x0044aa,1).setScrollFactor(0);
    this.add.text(38,50,'[Q] '+abilityName,{fontSize:'9px',fontFamily:'Arial',color:'#556677'}).setScrollFactor(0);

    // ── Score ──
    this._scoreTxt = this.add.text(GW/2,14,'0',{fontSize:'22px',fontFamily:'Arial Black',color:'#ffdd00',shadow:{blur:10,color:'#ff8800',fill:true}}).setOrigin(0.5).setScrollFactor(0);
    this.add.text(GW/2,32,'SCORE',{fontSize:'10px',fontFamily:'Arial',color:'#556677',letterSpacing:2}).setOrigin(0.5).setScrollFactor(0);

    // ── Chapter badge ──
    const ch = ['I','II','III'][GS.chapter]||'I';
    this.add.text(GW-10,14,`CH.${ch}`,{fontSize:'14px',fontFamily:'Arial Black',color:'#334455'}).setOrigin(1,0).setScrollFactor(0);

    // ── Objective ──
    this._objTxt = this.add.text(GW-10,GH-14,'',{fontSize:'12px',fontFamily:'Arial',color:'#556677',align:'right'}).setOrigin(1,1).setScrollFactor(0);

    // ── Minimap ──
    this.add.image(GW-90,GH-70,'mm_bg').setScrollFactor(0).setAlpha(0.8);
    this._mmPlayer = this.add.circle(GW-90,GH-70,3,char==='nova'?0x00eeff:0xff8800,1).setScrollFactor(0);

    // ── Partner status ──
    if(GS.roomId){
      const pc = GS.playerIndex===0?'rook':'nova';
      this.add.image(GW-155,40,'av_'+pc).setScrollFactor(0).setScale(1.1).setAlpha(0.8);
      this._partnerHpBar = this.add.rectangle(GW-110,38,70,8,0x22ff44,1).setScrollFactor(0);
      this.add.text(GW-110,28,'PARTNER',{fontSize:'9px',fontFamily:'Arial',color:'#445566',letterSpacing:1}).setOrigin(0.5).setScrollFactor(0);

      this._netOff = NET.on('player_updated',d=>{
        if(d.id!==NET.id() && this._partnerHpBar){
          const pct = Math.max(0,(d.hp||100)/100);
          this._partnerHpBar.setScale(pct,1);
          this._partnerHpBar.setFillStyle(pct>0.5?0x22ff44:pct>0.25?0xffaa00:0xff2222,1);
        }
      });
    }

    // ── Chat ──
    this._chatLines = [];
    this._chatInput = null;
    this._buildChat();

    // Live objective line (updated by game scene)
    const objectives = {
      Chapter1:'① Beacon  ② Defeat Turret  ③ Launch Pad',
      Chapter2:'① Power Switches  ② Void Sentinel  ③ ECHO Terminal',
      Chapter3:'① Clear Path  ② Defeat VOID Avatar  ③ Core Interface'
    };
    this._objTxt.setText('OBJECTIVE:  ' + (objectives[this._gameSceneKey] || ''));
  }

  _buildChat() {
    const chatBg = this.add.rectangle(GW/2,GH-30,360,24,0x000000,0.5).setScrollFactor(0).setDepth(25);
    const chatEl = document.createElement('input');
    chatEl.type='text'; chatEl.placeholder='Press T to chat...'; chatEl.maxLength=80;
    chatEl.style.cssText='position:fixed;display:none;width:280px;padding:4px 8px;background:rgba(0,10,20,0.9);border:1px solid #224466;color:#aaccdd;fontSize:13px;fontFamily:Arial;outline:none;zIndex:50;border-radius:3px;';
    document.body.appendChild(chatEl);

    this.input.keyboard.on('keydown-T',()=>{
      if(chatEl.style.display==='none'){
        const cv=this.sys.canvas.getBoundingClientRect();
        chatEl.style.left=(cv.left+(GW/2-140)*(cv.width/GW))+'px';
        chatEl.style.top=(cv.top+(GH-46)*(cv.height/GH))+'px';
        chatEl.style.display='block'; chatEl.focus();
      }
    });
    chatEl.addEventListener('keydown',e=>{
      if(e.key==='Enter'){ const m=chatEl.value.trim(); if(m){ NET.emit('chat',{msg:m}); chatEl.value=''; } chatEl.style.display='none'; }
      if(e.key==='Escape'){ chatEl.value=''; chatEl.style.display='none'; }
    });

    NET.on('chat',d=>{
      const line = this.add.text(10,GH-80+(this._chatLines.length*16),`${d.from}: ${d.msg}`,{fontSize:'12px',fontFamily:'Arial',color:'#aaccdd'}).setScrollFactor(0).setDepth(26).setAlpha(0.9);
      this._chatLines.push(line);
      this.tweens.add({targets:line,alpha:0,delay:5000,duration:1000,onComplete:()=>line.destroy()});
      if(this._chatLines.length>4) { this._chatLines.shift(); }
    });
  }

  setHP(hp, maxHp) {
    this._hp=hp; this._maxHp=maxHp;
    const pct=Math.max(0,hp/maxHp);
    this._hpBar.setScale(pct,1).setFillStyle(pct>0.5?0x22ff44:pct>0.25?0xffaa00:0xff2222,1);
    this._hpText.setText(`${hp}/${maxHp}`);
  }

  setAbilityCd(ms) { this._abilityCdEnd = this.time.now + ms; }

  addScore(pts) {
    this._score += pts;
    this._scoreTxt.setText(this._score.toLocaleString());
    this.tweens.add({targets:this._scoreTxt,scaleX:1.3,scaleY:1.3,duration:100,yoyo:true});
  }

  update() {
    // Ability cooldown bar
    if(this._abilityCdEnd > this.time.now){
      const pct = 1 - (this._abilityCdEnd - this.time.now) / 6000;
      this._abBar.setScale(Math.max(0,pct),1);
    } else {
      this._abBar.setScale(1,1);
    }

    // Minimap player dot
    const gs = this.scene.get(this._gameSceneKey);
    if(gs && gs._player && gs._ld){
      const mx = (gs._player.x/gs._ld.width)*120 + (GW-150);
      const my = (gs._player.y/gs._ld.height)*80  + (GH-110);
      this._mmPlayer.setPosition(mx,my);
    }
  }
}

// ── Game Over Scene ───────────────────────────────────────────────────────────
class GameOverScene extends Phaser.Scene {
  constructor() { super('GameOver'); }

  init(d) { this._win = d && d.win; }

  create() {
    SFX.resume();
    this.add.rectangle(GW/2,GH/2,GW,GH,0x000000);

    // Stars
    for(let i=0;i<120;i++) this.add.circle(Phaser.Math.Between(0,GW),Phaser.Math.Between(0,GH),1,0xffffff,Math.random()*0.5+0.1);

    const col = this._win ? '#00eeff' : '#ff4444';
    const msg = this._win ? 'MISSION COMPLETE' : 'MISSION FAILED';
    const sub = this._win ? 'The stars are safe.' : 'The void claims all.';

    this.add.text(GW/2,GH/2-80,msg,{fontSize:'54px',fontFamily:'Arial Black',color:col,shadow:{blur:24,color:col,fill:true}}).setOrigin(0.5);
    this.add.text(GW/2,GH/2,sub,{fontSize:'22px',fontFamily:'Arial',color:'#aaccdd'}).setOrigin(0.5);

    // Score if available
    const uiScene = this.scene.get('UIScene');
    if(uiScene && uiScene._score){
      this.add.text(GW/2,GH/2+50,`Score: ${uiScene._score.toLocaleString()}`,{fontSize:'24px',fontFamily:'Arial Black',color:'#ffdd00'}).setOrigin(0.5);
    }

    const menuBtn = this.add.rectangle(GW/2,GH/2+130,240,48,this._win?0x002244:0x220000,0.9).setInteractive({cursor:'pointer'});
    this.add.rectangle(GW/2,GH/2+130,238,46,0,0).setStrokeStyle(1,col);
    this.add.text(GW/2,GH/2+130,this._win?'▶ PLAY AGAIN':'↩ MAIN MENU',{fontSize:'18px',fontFamily:'Arial',color:col}).setOrigin(0.5);

    menuBtn.on('pointerdown',()=>{ SFX.ui(); this.scene.start('Menu'); });

    if(this._win) SFX.victory();
    else SFX.die();
  }
}

// ── Phaser Game Config & Launch ───────────────────────────────────────────────
const config = {
  type: Phaser.AUTO,
  width: GW,
  height: GH,
  backgroundColor: '#000000',
  parent: 'game-container',
  // Render at native device resolution — sharp on retina / 4K screens
  resolution: Math.min(window.devicePixelRatio || 1, 2),
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GW,
    height: GH
  },
  render: {
    antialias: true,
    antialiasGL: true,
    pixelArt: false,
    roundPixels: false,
    mipmapFilter: 'LINEAR_MIPMAP_LINEAR'
  },
  physics: {
    default: 'arcade',
    arcade: { gravity:{ y:0 }, debug:false }
  },
  scene: [BootScene, MenuScene, LobbyScene, CutsceneScene, Chapter1, Chapter2, Chapter3, UIScene, GameOverScene]
};

new Phaser.Game(config);
