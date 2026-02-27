const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ══════════════════════════════════════════════════════════════
//  ⚙️  CONFIG
// ══════════════════════════════════════════════════════════════
const OWNER_NAME = 'Admin';       // ← ПОСТАВЬ СВОЙ НИК
const ADMIN_PASS = 'secret123';   // ← ПОСТАВЬ СВОЙ ПАРОЛЬ (передаётся при входе)

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
  } else { res.writeHead(404); res.end('Not found'); }
});

const wss = new WebSocket.Server({ server });

const WORLD_W = 5000, WORLD_H = 5000, TICK_RATE = 60;
const MAX_FOOD = 280, MAX_SHAPES = 160, MAX_PENTAGONS = 30, MAX_POWERUPS = 20, MAX_BOSSES = 3;

let players = {}, bullets = {}, food = [], shapes = [], powerups = [], bosses = [];
let nextId = 1;
let serverLog = [];       // event log
let chatHistory = [];     // global chat

// Уникальные имена — хранит SET занятых имён
const takenNames = new Set();
// Токены для защиты владельца: map имя→токен (генерируется при первом входе)
const ownerToken = crypto.randomBytes(16).toString('hex');
let ownerConnected = false; // только ОДИН владелец за раз

function rand(m,x){return Math.random()*(x-m)+m;}
function randInt(m,x){return Math.floor(rand(m,x+1));}
function dist(ax,ay,bx,by){return Math.sqrt((ax-bx)**2+(ay-by)**2);}
function angle(ax,ay,bx,by){return Math.atan2(by-ay,bx-ax);}
function clamp(v,mn,mx){return Math.max(mn,Math.min(mx,v));}

// ── TANK CONFIGS ──────────────────────────────────────────────
const TANK_CONFIGS = [
  {name:'Basic',      barrels:[{a:0,w:12,l:30}],                                                                                        fr:22,bs:8, bd:20,bl:90},
  {name:'Twin',       barrels:[{a:-0.18,w:10,l:30},{a:0.18,w:10,l:30}],                                                                fr:13,bs:8, bd:14,bl:85},
  {name:'Sniper',     barrels:[{a:0,w:8,l:54}],                                                                                         fr:38,bs:16,bd:55,bl:135},
  {name:'Machinegun', barrels:[{a:0,w:18,l:28}],                                                                                        fr:6, bs:7, bd:10,bl:62,spread:0.07},
  {name:'Flank',      barrels:[{a:0,w:12,l:30},{a:Math.PI,w:10,l:25}],                                                                 fr:20,bs:8, bd:17,bl:85},
  {name:'Triplet',    barrels:[{a:-0.28,w:10,l:30},{a:0,w:12,l:34},{a:0.28,w:10,l:30}],                                                fr:15,bs:8, bd:13,bl:80},
  {name:'Destroyer',  barrels:[{a:0,w:24,l:40}],                                                                                        fr:58,bs:11,bd:95,bl:98},
  {name:'Octo',       barrels:[0,1,2,3,4,5,6,7].map(i=>({a:i*Math.PI/4,w:10,l:28})),                                                  fr:10,bs:7, bd:11,bl:78},
  {name:'Tri-angle',  barrels:[{a:0,w:14,l:32},{a:2.35,w:10,l:26},{a:-2.35,w:10,l:26}],                                               fr:16,bs:9, bd:17,bl:84},
  {name:'Sprayer',    barrels:[{a:0,w:15,l:30}],                                                                                        fr:4, bs:9, bd:9, bl:72,spread:0.15},
  {name:'Booster',    barrels:[{a:0,w:12,l:32},{a:2.5,w:8,l:22},{a:-2.5,w:8,l:22},{a:Math.PI,w:8,l:20}],                             fr:15,bs:10,bd:15,bl:85},
  {name:'PentaShot',  barrels:[{a:-0.5,w:9,l:28},{a:-0.25,w:10,l:31},{a:0,w:12,l:34},{a:0.25,w:10,l:31},{a:0.5,w:9,l:28}],          fr:20,bs:8, bd:12,bl:80},
  {name:'Annihilator',barrels:[{a:0,w:32,l:46}],                                                                                        fr:75,bs:12,bd:140,bl:102},
  {name:'Auto3',      barrels:[{a:0,w:12,l:30},{a:2.09,w:10,l:28},{a:-2.09,w:10,l:28}],                                               fr:18,bs:8, bd:15,bl:84},
  {name:'Streamliner',barrels:[{a:0,w:9,l:50},{a:0,w:7,l:44},{a:0,w:5,l:38}],                                                         fr:8, bs:12,bd:12,bl:110},
];

const LEVEL_THRESH=[0,500,1000,2000,4000,7500,11250,15000,22500,30000,40000,55000,75000,100000];
function getLevel(s){for(let i=LEVEL_THRESH.length-1;i>=0;i--)if(s>=LEVEL_THRESH[i])return i;return 0;}

// ── WORLD INIT ────────────────────────────────────────────────
function spawnFood(){
  while(food.length<MAX_FOOD)
    food.push({id:nextId++,x:rand(60,WORLD_W-60),y:rand(60,WORLD_H-60),r:10,score:10});
}
function spawnShapes(){
  while(shapes.length<MAX_SHAPES){
    const r=Math.random(),t=r<0.44?'triangle':r<0.9?'square':'hexagon';
    const hp=t==='triangle'?30:t==='hexagon'?180:100;
    const sc=t==='triangle'?25:t==='hexagon'?200:100;
    shapes.push({id:nextId++,x:rand(120,WORLD_W-120),y:rand(120,WORLD_H-120),type:t,hp,maxHp:hp,score:sc,angle:rand(0,Math.PI*2),rotSpeed:rand(-0.016,0.016),vx:0,vy:0});
  }
  while(shapes.filter(s=>s.type==='pentagon').length<MAX_PENTAGONS)
    shapes.push({id:nextId++,x:rand(200,WORLD_W-200),y:rand(200,WORLD_H-200),type:'pentagon',hp:250,maxHp:250,score:300,angle:rand(0,Math.PI*2),rotSpeed:rand(-0.009,0.009),vx:0,vy:0});
  if(!shapes.find(s=>s.type==='alpha'))
    shapes.push({id:nextId++,x:rand(500,WORLD_W-500),y:rand(500,WORLD_H-500),type:'alpha',hp:4000,maxHp:4000,score:4000,angle:rand(0,Math.PI*2),rotSpeed:0.0025,vx:0,vy:0});
}
function spawnPowerup(){
  const types=['health','speed','damage','shield','freeze','magnet','ghost','nuke'];
  powerups.push({id:nextId++,x:rand(100,WORLD_W-100),y:rand(100,WORLD_H-100),type:types[randInt(0,types.length-1)],life:1000});
}
spawnFood(); spawnShapes();
for(let i=0;i<MAX_POWERUPS;i++) spawnPowerup();

// ── HELPERS ───────────────────────────────────────────────────
function broadcast(data){
  const m=JSON.stringify(data);
  for(const ws of wss.clients) if(ws.readyState===WebSocket.OPEN) ws.send(m);
}
function send(ws,data){if(ws&&ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(data));}
function ccoll(ax,ay,ar,bx,by,br){const dx=ax-bx,dy=ay-by;return dx*dx+dy*dy<(ar+br)*(ar+br);}
function logEv(msg){const e=`[${new Date().toLocaleTimeString()}] ${msg}`;serverLog.unshift(e);if(serverLog.length>100)serverLog.pop();console.log(e);}

function serialize(p){
  return{id:p.id,x:p.x,y:p.y,angle:p.angle,hp:p.hp,maxHp:p.maxHp,score:p.score,level:p.level,tankType:p.tankType,name:p.name,alive:p.alive,kills:p.kills,shieldActive:p.shieldActive,isOwner:p.isOwner,frozen:p.frozen,rainbow:p.rainbow,size:p.size||1,isBot:p.isBot||false,ghost:p.ghost||false};
}
function calcMaxHp(p){return Math.floor((100+p.stats.maxHealth*25)*(p.size||1));}
function applyStats(p){
  p.maxHp=calcMaxHp(p); if(p.hp>p.maxHp)p.hp=p.maxHp;
  const c=TANK_CONFIGS[p.tankType]||TANK_CONFIGS[0];
  p.fireRate=Math.max(3,c.fr-p.stats.reload*2);
  p.bulletSpeed=c.bs+p.stats.bulletSpeed*0.9;
  p.bulletDamage=c.bd+p.stats.bulletDamage*6;
  p.bulletLife=c.bl;
  p.speed=(3+p.stats.movementSpeed*0.45)/(p.size||1);
}
function upgradeTank(player){
  const lvl=getLevel(player.score);
  if(lvl!==player.level){
    const g=lvl-player.level;
    player.level=lvl;
    player.statPoints=Math.min(56,player.statPoints+g);
    applyStats(player);
    broadcast({type:'levelUp',id:player.id,level:lvl});
    if(player.ws&&player.ws.readyState===1)
      send(player.ws,{type:'statsUpdated',stats:player.stats,statPoints:player.statPoints,maxHp:player.maxHp});
  }
}

// ── UNIQUE NAME SYSTEM ────────────────────────────────────────
function makeUnique(name){
  const base=name.substring(0,18).trim()||'Player';
  if(!takenNames.has(base)){takenNames.add(base);return base;}
  for(let i=2;i<1000;i++){const n=`${base}${i}`;if(!takenNames.has(n)){takenNames.add(n);return n;}}
  return base+'_'+randInt(1000,9999);
}
function releaseName(name){takenNames.delete(name);}

// ── BOT AI ────────────────────────────────────────────────────
const BOT_STATES = {ROAM:0, HUNT:1, FLEE:2, EAT:3};
const BOT_AI_LEVELS = {easy:{speed:1.5,reaction:0.02,scatter:0.3},medium:{speed:2.2,reaction:0.06,scatter:0.15},hard:{speed:2.9,reaction:0.14,scatter:0.05}};

function createBot(name, difficulty='medium'){
  const id='bot'+nextId++;
  const diff=BOT_AI_LEVELS[difficulty]||BOT_AI_LEVELS.medium;
  const uname=makeUnique(name||'Bot');
  const bot={
    id, isBot:true, difficulty, diff,
    ws:null,
    x:rand(300,WORLD_W-300), y:rand(300,WORLD_H-300),
    vx:0, vy:0, angle:0,
    hp:100, maxHp:100, score:0, level:0, tankType:0,
    name:uname, speed:diff.speed,
    fireRate:25, bulletDamage:18, bulletSpeed:8, bulletLife:88,
    statPoints:0,
    stats:{healthRegen:0,maxHealth:0,bodyDamage:0,bulletSpeed:0,bulletPen:0,bulletDamage:0,reload:0,movementSpeed:0},
    fireCooldown:0, kills:0, deaths:0,
    shieldActive:false, shieldTimer:0,
    inputs:{up:false,down:false,left:false,right:false,fire:false},
    alive:true, invincible:120, regenTimer:0,
    isOwner:false, frozen:false, rainbow:false, ghost:false, size:1,
    // AI state
    aiState:BOT_STATES.ROAM,
    aiTarget:null,
    aiWaypoint:{x:rand(200,WORLD_W-200),y:rand(200,WORLD_H-200)},
    aiTimer:0,
    aiUpgradeTimer:0,
  };
  players[id]=bot;
  broadcast({type:'playerJoin',player:serialize(bot)});
  logEv(`🤖 Bot "${uname}" spawned (${difficulty})`);
  return bot;
}

function updateBot(bot){
  if(!bot.alive) return;
  if(bot.invincible>0) bot.invincible--;
  if(bot.frozen) return;

  // Regen
  bot.regenTimer++;
  if(bot.regenTimer>=100&&bot.hp<bot.maxHp){bot.hp=Math.min(bot.maxHp,bot.hp+2);bot.regenTimer=0;}

  // Auto upgrade stats
  bot.aiUpgradeTimer++;
  if(bot.aiUpgradeTimer>120&&bot.statPoints>0){
    const stats=['bulletDamage','reload','movementSpeed','bulletSpeed','maxHealth','healthRegen','bulletPen'];
    const s=stats[randInt(0,stats.length-1)];
    if(bot.stats[s]<7){bot.stats[s]++;bot.statPoints--;applyStats(bot);}
    bot.aiUpgradeTimer=0;
  }

  // Auto tank upgrade
  if(bot.level>=13&&bot.tankType!==12) bot.tankType=randInt(1,14);
  else if(bot.level>=6&&bot.tankType<5) bot.tankType=randInt(1,5);

  bot.aiTimer++;
  const diff=bot.diff;

  // Find nearest food
  let nearFood=null,nearFoodDist=Infinity;
  for(const f of food){const d=dist(bot.x,bot.y,f.x,f.y);if(d<nearFoodDist){nearFoodDist=d;nearFood=f;}}

  // Find nearest enemy
  let nearEnemy=null,nearEnemyDist=Infinity;
  for(const pid in players){
    const p=players[pid];
    if(pid===bot.id||!p.alive||p.isOwner) continue;
    const d=dist(bot.x,bot.y,p.x,p.y);
    if(d<nearEnemyDist){nearEnemyDist=d;nearEnemy=p;}
  }

  // State machine
  const lowHp=bot.hp/bot.maxHp<0.3;
  if(lowHp&&nearFood&&nearFoodDist<300) bot.aiState=BOT_STATES.EAT;
  else if(nearEnemy&&nearEnemyDist<350&&!lowHp&&Math.random()<diff.reaction) bot.aiState=BOT_STATES.HUNT;
  else if(lowHp&&nearEnemy&&nearEnemyDist<300) bot.aiState=BOT_STATES.FLEE;
  else if(bot.aiTimer>60+randInt(0,80)){bot.aiState=BOT_STATES.ROAM;bot.aiTimer=0;bot.aiWaypoint={x:rand(200,WORLD_W-200),y:rand(200,WORLD_H-200)};}

  let tx=bot.aiWaypoint.x, ty=bot.aiWaypoint.y;
  bot.inputs.fire=false;

  if(bot.aiState===BOT_STATES.HUNT&&nearEnemy){
    tx=nearEnemy.x; ty=nearEnemy.y;
    bot.angle=angle(bot.x,bot.y,nearEnemy.x,nearEnemy.y)+(Math.random()-0.5)*diff.scatter;
    bot.inputs.fire=nearEnemyDist<350;
  } else if(bot.aiState===BOT_STATES.FLEE&&nearEnemy){
    tx=bot.x+(bot.x-nearEnemy.x); ty=bot.y+(bot.y-nearEnemy.y);
  } else if(bot.aiState===BOT_STATES.EAT&&nearFood){
    tx=nearFood.x; ty=nearFood.y;
    bot.angle=angle(bot.x,bot.y,nearFood.x,nearFood.y);
  } else {
    bot.angle=angle(bot.x,bot.y,tx,ty);
  }

  const dx=tx-bot.x, dy=ty-bot.y;
  const d=Math.sqrt(dx*dx+dy*dy);
  if(d>8){bot.x=clamp(bot.x+dx/d*bot.speed,22,WORLD_W-22);bot.y=clamp(bot.y+dy/d*bot.speed,22,WORLD_H-22);}

  // Fire at shapes too
  if(!bot.inputs.fire&&nearFood&&nearFoodDist<120){
    const cfg=TANK_CONFIGS[bot.tankType]||TANK_CONFIGS[0];
    bot.angle=angle(bot.x,bot.y,nearFood.x,nearFood.y);
    bot.inputs.fire=true;
  }

  if(--bot.fireCooldown<=0&&bot.inputs.fire){
    const cfg=TANK_CONFIGS[bot.tankType]||TANK_CONFIGS[0];
    bot.fireCooldown=bot.fireRate;
    for(const barrel of cfg.barrels){
      const sp=cfg.spread?(Math.random()-0.5)*cfg.spread*2:0;
      const ba=bot.angle+(barrel.a||0)+sp;
      const bid='bb'+nextId++;
      bullets[bid]={id:bid,owner:bot.id,x:bot.x+Math.cos(ba)*(barrel.l||30),y:bot.y+Math.sin(ba)*(barrel.l||30),vx:Math.cos(ba)*bot.bulletSpeed,vy:Math.sin(ba)*bot.bulletSpeed,r:(barrel.w||12)/2+2,damage:bot.bulletDamage,pen:1+Math.floor(bot.stats.bulletPen/2),life:bot.bulletLife};
    }
  }

  // Collect food
  for(let i=food.length-1;i>=0;i--){
    if(ccoll(bot.x,bot.y,22,food[i].x,food[i].y,food[i].r)){bot.score+=food[i].score;upgradeTank(bot);broadcast({type:'foodEat',id:food[i].id});food.splice(i,1);}
  }

  // Bot respawn logic
  if(!bot.alive&&Math.random()<0.01){
    bot.alive=true; bot.hp=bot.maxHp; bot.invincible=120;
    bot.x=rand(300,WORLD_W-300); bot.y=rand(300,WORLD_H-300);
    broadcast({type:'playerRespawn',id:bot.id,x:bot.x,y:bot.y,hp:bot.hp,maxHp:bot.maxHp,score:bot.score,level:bot.level});
  }
}

// ── CONNECTION ────────────────────────────────────────────────
wss.on('connection', (ws) => {
  const id = 'p' + nextId++;

  const player = {
    id, ws,
    x:rand(400,WORLD_W-400), y:rand(400,WORLD_H-400),
    vx:0, vy:0, angle:0,
    hp:100, maxHp:100, score:0, level:0, tankType:0,
    name:'Player', speed:3,
    fireRate:22, bulletDamage:20, bulletSpeed:8, bulletLife:90,
    statPoints:0,
    stats:{healthRegen:0,maxHealth:0,bodyDamage:0,bulletSpeed:0,bulletPen:0,bulletDamage:0,reload:0,movementSpeed:0},
    fireCooldown:0, kills:0, deaths:0,
    shieldActive:false, shieldTimer:0,
    inputs:{up:false,down:false,left:false,right:false,fire:false},
    alive:true, invincible:180, regenTimer:0, selectedTank:0,
    isOwner:false, isMod:false,
    frozen:false, rainbow:false, ghost:false, size:1, freezeTimer:0, magnetActive:false,
    isBot:false,
    sessionToken:'',
  };
  players[id] = player;

  send(ws, {
    type:'init', id, worldW:WORLD_W, worldH:WORLD_H,
    food, shapes,
    powerups:powerups.map(p=>({id:p.id,x:p.x,y:p.y,type:p.type})),
    bosses:bosses.map(b=>({id:b.id,x:b.x,y:b.y,hp:b.hp,maxHp:b.maxHp,angle:b.angle})),
    players:Object.values(players).filter(p=>p.id!==id).map(serialize),
    chatHistory: chatHistory.slice(0,30),
  });
  broadcast({type:'playerJoin',player:serialize(player)});
  logEv(`+ ${id} connected`);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (!players[id]) return;
      const p = players[id];

      // ── INPUT ─────────────────────────────────────────────
      if (msg.type === 'input') {
        if (!p.frozen) { p.inputs = msg.inputs; p.angle = msg.angle; }
        if (msg.name && msg.name !== p.name) {
          const requested = msg.name.trim().substring(0,20);

          // OWNER CHECK — requires password token
          if (requested === OWNER_NAME) {
            if (msg.adminPass === ADMIN_PASS && !ownerConnected) {
              // Release old name, claim owner name
              if (p.name) releaseName(p.name);
              p.name = OWNER_NAME;
              takenNames.add(OWNER_NAME);
              p.isOwner = true; p.isMod = true;
              p.sessionToken = ownerToken;
              ownerConnected = true;
              send(ws, {type:'modAccess', granted:true, token:ownerToken});
              logEv(`👑 OWNER logged in: ${OWNER_NAME}`);
            } else if (ownerConnected) {
              // Someone else tried to use owner name
              const unique = makeUnique(requested+'_');
              if (p.name && p.name !== unique) releaseName(p.name);
              p.name = unique;
              send(ws, {type:'nameTaken', suggested: unique});
            } else {
              // Tried without password — deny
              const unique = makeUnique(requested);
              if (p.name && p.name !== unique) releaseName(p.name);
              p.name = unique;
              send(ws, {type:'nameTaken', suggested: unique});
            }
          } else {
            const unique = makeUnique(requested);
            if (p.name && p.name !== unique) releaseName(p.name);
            p.name = unique;
            if (unique !== requested) send(ws, {type:'nameTaken', suggested: unique});
          }
          broadcast({type:'nameChange', id, name:p.name, isOwner:p.isOwner});
        }
      }

      // ── ADMIN LOGIN (sends password separately) ───────────
      else if (msg.type === 'adminLogin') {
        if (msg.name === OWNER_NAME && msg.pass === ADMIN_PASS) {
          if (ownerConnected && p.sessionToken !== ownerToken) {
            send(ws, {type:'modError', msg:'Owner already connected!'}); return;
          }
          p.isOwner = true; p.isMod = true; p.sessionToken = ownerToken;
          ownerConnected = true;
          send(ws, {type:'modAccess', granted:true, token:ownerToken});
          logEv(`👑 OWNER authenticated: ${p.name}`);
        } else {
          send(ws, {type:'modError', msg:'Wrong password or name'});
        }
      }

      // ── RESPAWN ───────────────────────────────────────────
      else if (msg.type === 'respawn') {
        if (p.alive) return;
        const ns = Math.floor(p.score*0.5);
        const lvl = getLevel(ns);
        Object.assign(p,{hp:calcMaxHp(p),maxHp:calcMaxHp(p),score:ns,x:rand(400,WORLD_W-400),y:rand(400,WORLD_H-400),alive:true,invincible:180,level:lvl,fireCooldown:0,shieldActive:false,shieldTimer:0,frozen:false,ghost:false});
        applyStats(p);
        broadcast({type:'playerRespawn',id,x:p.x,y:p.y,hp:p.hp,maxHp:p.maxHp,score:p.score,level:p.level});
      }

      // ── STAT UPGRADE ──────────────────────────────────────
      else if (msg.type === 'upgrade') {
        if (p.statPoints<=0) return;
        const valid=['healthRegen','maxHealth','bodyDamage','bulletSpeed','bulletPen','bulletDamage','reload','movementSpeed'];
        if (valid.includes(msg.stat)&&p.stats[msg.stat]<7){
          p.stats[msg.stat]++;p.statPoints--;applyStats(p);
          send(ws,{type:'statsUpdated',stats:p.stats,statPoints:p.statPoints,maxHp:p.maxHp});
        }
      }

      // ── SELECT TANK ───────────────────────────────────────
      else if (msg.type === 'selectTank') {
        if(typeof msg.tankType==='number'&&msg.tankType>=0&&msg.tankType<TANK_CONFIGS.length&&(p.level>=msg.tankType||p.isOwner)){
          p.selectedTank=msg.tankType;p.tankType=msg.tankType;applyStats(p);
          broadcast({type:'tankChanged',id,tankType:p.tankType});
        }
      }

      // ── CHAT ──────────────────────────────────────────────
      else if (msg.type === 'chat') {
        const text = (msg.text||'').substring(0,120).trim();
        if (!text) return;
        const entry = {name:p.name,text,isOwner:p.isOwner,ts:Date.now()};
        chatHistory.unshift(entry);
        if (chatHistory.length>50) chatHistory.pop();
        broadcast({type:'chat',entry});
        logEv(`💬 ${p.name}: ${text}`);
      }

      // ── MOD ACTIONS ───────────────────────────────────────
      else if (msg.type === 'mod') {
        // Token verification — CANNOT be faked from client
        if (!p.isOwner || p.sessionToken !== ownerToken) {
          send(ws,{type:'modError',msg:'Access denied — invalid session'}); return;
        }
        const act=msg.action, tid=msg.targetId;
        const tgt=players[tid];

        switch(act){
          // Info
          case 'getPlayerList':
            send(ws,{type:'modPlayerList',players:Object.values(players).map(pl=>({id:pl.id,name:pl.name,score:pl.score,kills:pl.kills,deaths:pl.deaths||0,alive:pl.alive,level:pl.level,isBot:pl.isBot||false,tankType:pl.tankType}))});
            break;
          case 'getLog':
            send(ws,{type:'modLog',log:serverLog});
            break;
          case 'getStats':
            send(ws,{type:'modStats',stats:{players:Object.keys(players).length,bots:Object.values(players).filter(p=>p.isBot).length,bosses:bosses.length,shapes:shapes.length,food:food.length,bullets:Object.keys(bullets).length,uptime:Math.floor(process.uptime())}});
            break;

          // World
          case 'spawnBoss': if(bosses.length<MAX_BOSSES){spawnBoss();logEv(`👑 Admin spawned boss`);}; break;
          case 'killBosses': bosses.forEach(b=>broadcast({type:'bossDestroy',id:b.id,x:b.x,y:b.y}));bosses=[];document.getElementById&&null;broadcast({type:'announce',msg:'👑 All bosses removed by Admin',color:'#ffdd44'});logEv(`👑 Admin killed all bosses`);break;
          case 'clearShapes': shapes.forEach(s=>broadcast({type:'shapeDestroy',id:s.id,scorer:null,x:s.x,y:s.y}));shapes=[];logEv(`👑 Admin cleared shapes`);break;
          case 'refillShapes': spawnShapes();broadcast({type:'shapeSpawn',shapes});logEv(`👑 Admin respawned shapes`);break;
          case 'clearBullets': for(const bid in bullets){broadcast({type:'bulletRemove',id:bid});}bullets={};break;
          case 'announce':
            broadcast({type:'announce',msg:msg.text||'Hello!',color:msg.color||'#ffdd44'});
            logEv(`👑 Announce: ${msg.text}`);
            break;
          case 'chat':
            const ce={name:'[ADMIN]',text:msg.text||'',isOwner:true,ts:Date.now()};
            chatHistory.unshift(ce);broadcast({type:'chat',entry:ce});break;
          case 'forceSpawnBoss': spawnBoss();spawnBoss();logEv(`👑 Admin double-spawned bosses`);break;
          case 'bossNow': bossTimer=BOT_SPAWN_INTERVAL+1;break;
          case 'setWorldSize': /* future */; break;

          // Bot management
          case 'spawnBot':
            createBot(msg.botName||'Bot',msg.difficulty||'medium');
            send(ws,{type:'modOk',msg:`Bot "${msg.botName||'Bot'}" spawned!`});
            break;
          case 'spawnBots':
            for(let i=0;i<Math.min(msg.count||3,10);i++) createBot((msg.botName||'Bot')+'_'+(i+1),msg.difficulty||'medium');
            send(ws,{type:'modOk',msg:`${Math.min(msg.count||3,10)} bots spawned!`});
            break;
          case 'removeAllBots':
            for(const pid in players){
              if(players[pid].isBot){releaseName(players[pid].name);broadcast({type:'playerLeave',id:pid});delete players[pid];}
            }
            logEv(`👑 Admin removed all bots`);
            send(ws,{type:'modOk',msg:'All bots removed!'});
            break;

          // God mode
          case 'godMode':
            p.invincible=99999;p.hp=999999;p.maxHp=999999;
            p.score=Math.max(p.score,100000);p.level=getLevel(p.score);p.statPoints=56;
            applyStats(p);
            send(ws,{type:'statsUpdated',stats:p.stats,statPoints:p.statPoints,maxHp:p.maxHp});
            send(ws,{type:'modOk',msg:'God Mode ON!'});
            logEv(`👑 Admin activated God Mode`);
            break;
          case 'allTanks': p.level=14;updateTankPanel&&null;send(ws,{type:'modOk',msg:'All tanks unlocked!'});break;
          case 'ownerRainbow': p.rainbow=!p.rainbow;broadcast({type:'playerRainbow',id,rainbow:p.rainbow});break;
          case 'teleportCenter': p.x=WORLD_W/2;p.y=WORLD_H/2;break;
          case 'maxStats':
            Object.keys(p.stats).forEach(s=>p.stats[s]=7);p.statPoints=0;applyStats(p);
            send(ws,{type:'statsUpdated',stats:p.stats,statPoints:0,maxHp:p.maxHp});
            send(ws,{type:'modOk',msg:'All stats maxed!'});
            break;

          // Target player actions
          default:
            if (!tgt) { send(ws,{type:'modError',msg:'Player not found'}); break; }
            switch(act){
              case 'kick': tgt.ws&&tgt.ws.close();logEv(`👑 Kicked ${tgt.name}`);break;
              case 'ban':
                tgt.ws&&tgt.ws.close();
                send(ws,{type:'modOk',msg:`${tgt.name} kicked. (Ban by IP requires server config)`});
                logEv(`👑 Banned ${tgt.name}`);
                break;
              case 'kill':
                tgt.hp=0;tgt.alive=false;tgt.deaths=(tgt.deaths||0)+1;
                broadcast({type:'playerDie',id:tid,killer:id,killerName:'[Admin]'});
                logEv(`👑 Admin killed ${tgt.name}`);
                break;
              case 'freeze':
                tgt.frozen=!tgt.frozen;tgt.freezeTimer=tgt.frozen?600:0;
                broadcast({type:'playerFrozen',id:tid,frozen:tgt.frozen});
                logEv(`👑 Admin ${tgt.frozen?'froze':'unfroze'} ${tgt.name}`);
                break;
              case 'tp': tgt.x=p.x+rand(-80,80);tgt.y=p.y+rand(-80,80);break;
              case 'tpToMe': tgt.x=p.x+rand(-80,80);tgt.y=p.y+rand(-80,80);break;
              case 'tpMeTo': p.x=tgt.x+rand(-80,80);p.y=tgt.y+rand(-80,80);break;
              case 'giveScore': tgt.score+=msg.amount||5000;upgradeTank(tgt);send(tgt.ws,{type:'announce',msg:`+${msg.amount||5000} score from Admin!`,color:'#ffdd44'});break;
              case 'setScore': tgt.score=Math.max(0,msg.amount||0);tgt.level=getLevel(tgt.score);applyStats(tgt);break;
              case 'heal': tgt.hp=tgt.maxHp;tgt.alive=true;broadcast({type:'playerHit',id:tid,hp:tgt.hp});break;
              case 'fullHeal': tgt.hp=tgt.maxHp;tgt.alive=true;tgt.invincible=120;broadcast({type:'playerHit',id:tid,hp:tgt.hp});break;
              case 'rainbow': tgt.rainbow=!tgt.rainbow;broadcast({type:'playerRainbow',id:tid,rainbow:tgt.rainbow});break;
              case 'setSize': tgt.size=clamp(msg.size||1,0.3,4);tgt.maxHp=calcMaxHp(tgt);tgt.hp=tgt.maxHp;applyStats(tgt);broadcast({type:'playerSize',id:tid,size:tgt.size});break;
              case 'setTank': if(msg.tankType>=0&&msg.tankType<TANK_CONFIGS.length){tgt.tankType=msg.tankType;applyStats(tgt);broadcast({type:'tankChanged',id:tid,tankType:tgt.tankType});}break;
              case 'sendMsg': if(tgt.ws) send(tgt.ws,{type:'announce',msg:msg.text||'',color:msg.color||'#ffdd44'});break;
              case 'giveGod': tgt.invincible=99999;send(tgt.ws,{type:'announce',msg:'👑 Admin gave you God Mode!',color:'#ffdd44'});break;
              case 'revealPos': send(ws,{type:'modOk',msg:`${tgt.name} is at (${Math.round(tgt.x)}, ${Math.round(tgt.y)}), score: ${tgt.score}`});break;
            }
        }
      }

    } catch(e) { console.error('MSG err:', e.message); }
  });

  ws.on('close', () => {
    const p = players[id];
    if (p) {
      if (p.isOwner) ownerConnected = false;
      releaseName(p.name);
      logEv(`- ${id} (${p.name}) disconnected`);
    }
    delete players[id];
    broadcast({type:'playerLeave',id});
  });
});

// ── BOSS ──────────────────────────────────────────────────────
function spawnBoss(){
  if(bosses.length>=MAX_BOSSES)return;
  const side=randInt(0,3);
  let x=rand(300,WORLD_W-300),y=rand(300,WORLD_H-300);
  if(side===0)x=120;else if(side===1)x=WORLD_W-120;else if(side===2)y=120;else y=WORLD_H-120;
  bosses.push({id:nextId++,x,y,hp:3500,maxHp:3500,score:7000,angle:0,rotSpeed:0.01,targetId:null,fireCooldown:0,speed:0.9,phase:0,pat:0,alive:true});
  broadcast({type:'bossSpawn',bosses:bosses.map(b=>({id:b.id,x:b.x,y:b.y,hp:b.hp,maxHp:b.maxHp,angle:b.angle}))});
  broadcast({type:'announce',msg:'⚠️ BOSS HAS APPEARED!',color:'#ff4444'});
  logEv(`Boss spawned`);
}
function updateBoss(boss){
  boss.angle+=boss.rotSpeed;
  boss.phase=boss.hp<boss.maxHp*0.25?2:boss.hp<boss.maxHp*0.6?1:0;
  const spd=boss.speed*[1,1.5,2.2][boss.phase];
  let nd=Infinity,ni=null;
  for(const id in players){const p=players[id];if(!p.alive||p.isBot)continue;const d=dist(boss.x,boss.y,p.x,p.y);if(d<nd){nd=d;ni=id;}}
  boss.targetId=ni;
  if(ni&&nd<900){const t=players[ni],a=Math.atan2(t.y-boss.y,t.x-boss.x);boss.x=clamp(boss.x+Math.cos(a)*spd,80,WORLD_W-80);boss.y=clamp(boss.y+Math.sin(a)*spd,80,WORLD_H-80);}
  boss.fireCooldown--;
  const fi=[32,20,9][boss.phase];
  if(boss.fireCooldown<=0&&ni){
    boss.fireCooldown=fi;
    const t=players[ni],shots=[5,7,10][boss.phase];
    const pat=boss.pat%4;boss.pat++;
    for(let i=0;i<shots;i++){
      let a;
      if(pat===0)a=Math.atan2(t.y-boss.y,t.x-boss.x)+(i-shots/2+.5)*0.3;
      else if(pat===1)a=(Math.PI*2/shots)*i+boss.angle;
      else if(pat===2)a=Math.atan2(t.y-boss.y,t.x-boss.x)+(Math.random()-.5)*0.7;
      else a=(Math.PI*2/shots)*i+boss.angle*1.8;
      const bid='bx'+nextId++;
      bullets[bid]={id:bid,owner:'boss_'+boss.id,x:boss.x+Math.cos(a)*65,y:boss.y+Math.sin(a)*65,vx:Math.cos(a)*8,vy:Math.sin(a)*8,r:11,damage:30+boss.phase*14,pen:1,life:135,isBoss:true};
    }
  }
  for(const pid in players){
    const p=players[pid];
    if(!p.alive||p.invincible>0||p.shieldActive||p.ghost)continue;
    if(ccoll(boss.x,boss.y,60,p.x,p.y,20*(p.size||1))){
      p.hp-=6;if(p.hp<=0){p.hp=0;p.alive=false;p.deaths=(p.deaths||0)+1;broadcast({type:'playerDie',id:pid,killer:'boss',killerName:'👹 Boss'});}
      broadcast({type:'playerHit',id:pid,hp:p.hp});
    }
  }
}

// ── GAME LOOP ─────────────────────────────────────────────────
let frameCount=0, bossTimer=0;
const BOT_SPAWN_INTERVAL=60*180; // 3 min

setInterval(()=>{
  frameCount++;bossTimer++;
  if(bossTimer>BOT_SPAWN_INTERVAL&&bosses.length===0&&Object.keys(players).length>0){bossTimer=0;spawnBoss();}

  for(const boss of bosses) updateBoss(boss);

  // Bot AI ticks
  for(const id in players){if(players[id].isBot) updateBot(players[id]);}

  // Shapes drift
  for(const s of shapes){
    s.angle+=s.rotSpeed;
    s.x=clamp(s.x+s.vx,60,WORLD_W-60);s.y=clamp(s.y+s.vy,60,WORLD_H-60);
    s.vx*=0.98;s.vy*=0.98;
  }

  // Powerup expiry
  for(let i=powerups.length-1;i>=0;i--){
    if(--powerups[i].life<=0){broadcast({type:'powerupRemove',id:powerups[i].id});powerups.splice(i,1);}
  }

  // Player ticks
  for(const id in players){
    const p=players[id];
    if(!p.alive||p.isBot) continue;
    if(p.invincible>0)p.invincible--;
    if(p.shieldActive&&--p.shieldTimer<=0){p.shieldActive=false;broadcast({type:'shieldOff',id});}
    p.regenTimer++;
    const rr=Math.max(45,200-p.stats.healthRegen*22);
    if(p.regenTimer>=rr&&p.hp<p.maxHp){p.hp=Math.min(p.maxHp,p.hp+1+Math.floor(p.stats.healthRegen/2));p.regenTimer=0;}
    if(p.frozen){if(--p.freezeTimer<=0){p.frozen=false;broadcast({type:'playerFrozen',id,frozen:false});}}

    const inp=p.inputs;
    let dx=(inp.right?1:0)-(inp.left?1:0),dy=(inp.down?1:0)-(inp.up?1:0);
    if(dx&&dy){dx*=0.707;dy*=0.707;}
    if(!p.frozen){p.x=clamp(p.x+dx*p.speed,22,WORLD_W-22);p.y=clamp(p.y+dy*p.speed,22,WORLD_H-22);}

    if(p.magnetActive){for(const f of food){const d=dist(p.x,p.y,f.x,f.y);if(d<220&&d>5){const a=Math.atan2(p.y-f.y,p.x-f.x);f.x+=Math.cos(a)*3.5;f.y+=Math.sin(a)*3.5;}}}

    if(--p.fireCooldown<=0&&inp.fire&&!p.frozen){
      const cfg=TANK_CONFIGS[p.tankType]||TANK_CONFIGS[0];
      p.fireCooldown=p.fireRate;
      for(const barrel of cfg.barrels){
        const sp=cfg.spread?(Math.random()-.5)*cfg.spread*2:0;
        const ba=p.angle+(barrel.a||0)+sp;
        const bid='b'+nextId++;
        bullets[bid]={id:bid,owner:id,x:p.x+Math.cos(ba)*(barrel.l||30),y:p.y+Math.sin(ba)*(barrel.l||30),vx:Math.cos(ba)*p.bulletSpeed,vy:Math.sin(ba)*p.bulletSpeed,r:(barrel.w||12)/2+2,damage:p.bulletDamage,pen:1+Math.floor(p.stats.bulletPen/2),life:p.bulletLife};
      }
    }
    for(let i=food.length-1;i>=0;i--){
      if(ccoll(p.x,p.y,22,food[i].x,food[i].y,food[i].r)){p.score+=food[i].score;upgradeTank(p);broadcast({type:'foodEat',id:food[i].id});food.splice(i,1);}
    }
    for(let i=powerups.length-1;i>=0;i--){
      const pu=powerups[i];
      if(ccoll(p.x,p.y,24,pu.x,pu.y,17)){
        if(pu.type==='health') p.hp=Math.min(p.maxHp,p.hp+p.maxHp*.5);
        else if(pu.type==='speed'){const b=p.speed;p.speed*=1.7;setTimeout(()=>{if(players[id])p.speed=3+p.stats.movementSpeed*.45;},5000);}
        else if(pu.type==='damage'){p.bulletDamage*=2.3;setTimeout(()=>{if(players[id])applyStats(p);},5000);}
        else if(pu.type==='shield'){p.shieldActive=true;p.shieldTimer=450;broadcast({type:'shieldOn',id});}
        else if(pu.type==='freeze'){for(const pid in players){if(pid===id)continue;const tp=players[pid];if(tp.alive&&dist(p.x,p.y,tp.x,tp.y)<320&&!tp.isOwner){tp.frozen=true;tp.freezeTimer=200;broadcast({type:'playerFrozen',id:pid,frozen:true});}}}
        else if(pu.type==='magnet'){p.magnetActive=true;setTimeout(()=>{if(players[id])p.magnetActive=false;},7000);}
        else if(pu.type==='ghost'){p.ghost=true;p.invincible=300;setTimeout(()=>{if(players[id]){p.ghost=false;p.invincible=0;}},5000);broadcast({type:'playerGhost',id,ghost:true});}
        else if(pu.type==='nuke'){
          const radius=350;
          for(const pid in players){
            if(pid===id)continue;
            const tp=players[pid];
            if(tp.alive&&dist(p.x,p.y,tp.x,tp.y)<radius&&!tp.isOwner&&!tp.shieldActive){
              tp.hp=Math.max(1,tp.hp-tp.maxHp*.7);
              broadcast({type:'playerHit',id:pid,hp:tp.hp});
            }
          }
          broadcast({type:'nuke',x:p.x,y:p.y,r:radius});
        }
        broadcast({type:'powerupCollect',id:pu.id,player:id,puType:pu.type});
        powerups.splice(i,1);
      }
    }
  }

  // Bullets
  for(const bid in bullets){
    const b=bullets[bid];
    b.x+=b.vx;b.y+=b.vy;
    if(--b.life<=0||b.x<0||b.x>WORLD_W||b.y<0||b.y>WORLD_H){delete bullets[bid];broadcast({type:'bulletRemove',id:bid});continue;}
    let hit=false;
    // vs shapes
    for(let i=shapes.length-1;i>=0;i--){
      const s=shapes[i];
      const sr=s.type==='alpha'?72:s.type==='pentagon'?37:s.type==='hexagon'?32:s.type==='triangle'?22:28;
      if(ccoll(b.x,b.y,b.r,s.x,s.y,sr)){
        const a=Math.atan2(s.y-b.y,s.x-b.x);s.vx+=Math.cos(a)*1.5;s.vy+=Math.sin(a)*1.5;
        s.hp-=b.damage;
        if(s.hp<=0){const own=players[b.owner];if(own&&own.alive){own.score+=s.score;upgradeTank(own);}broadcast({type:'shapeDestroy',id:s.id,scorer:b.owner,x:s.x,y:s.y});shapes.splice(i,1);}
        else broadcast({type:'shapeHit',id:s.id,hp:s.hp});
        if(--b.pen<=0){hit=true;break;}
      }
    }
    if(hit){delete bullets[bid];broadcast({type:'bulletRemove',id:bid});continue;}
    // vs bosses
    if(!b.isBoss){
      for(let i=bosses.length-1;i>=0;i--){
        if(ccoll(b.x,b.y,b.r,bosses[i].x,bosses[i].y,62)){
          bosses[i].hp-=b.damage;broadcast({type:'bossHit',id:bosses[i].id,hp:bosses[i].hp,maxHp:bosses[i].maxHp});
          if(bosses[i].hp<=0){
            for(const pid in players){const pp=players[pid];if(pp.alive&&dist(pp.x,pp.y,bosses[i].x,bosses[i].y)<900){pp.score+=bosses[i].score;upgradeTank(pp);}}
            broadcast({type:'bossDestroy',id:bosses[i].id,x:bosses[i].x,y:bosses[i].y});
            broadcast({type:'announce',msg:'🏆 BOSS KILLED! +7000 XP nearby!',color:'#44ff88'});
            logEv(`Boss killed by ${players[b.owner]?.name||'?'}`);
            bosses.splice(i,1);
          }
          hit=true;break;
        }
      }
    }
    if(hit){delete bullets[bid];broadcast({type:'bulletRemove',id:bid});continue;}
    // vs players
    for(const pid in players){
      if(pid===b.owner)continue;
      const p=players[pid];
      if(!p.alive||p.invincible>0||p.ghost)continue;
      if(ccoll(b.x,b.y,b.r,p.x,p.y,20*(p.size||1))){
        if(p.shieldActive){hit=true;broadcast({type:'shieldBlock',id:pid});break;}
        p.hp-=b.damage;
        if(p.hp<=0){
          p.hp=0;p.alive=false;p.deaths=(p.deaths||0)+1;
          const killer=players[b.owner];
          if(killer&&killer.alive){killer.score+=Math.floor(p.score*.15)+600;killer.kills++;upgradeTank(killer);}
          broadcast({type:'playerDie',id:pid,killer:b.owner,killerName:killer?.name||'?'});
          logEv(`${killer?.name||'?'} killed ${p.name}`);
        }
        hit=true;broadcast({type:'playerHit',id:pid,hp:p.hp});break;
      }
    }
    if(hit){delete bullets[bid];broadcast({type:'bulletRemove',id:bid});}
  }

  // World regen (every second)
  if(frameCount%60===0){
    const nf=[];while(food.length+nf.length<MAX_FOOD){const f={id:nextId++,x:rand(60,WORLD_W-60),y:rand(60,WORLD_H-60),r:10,score:10};nf.push(f);food.push(f);}
    if(nf.length)broadcast({type:'foodSpawn',food:nf});
    const ns=[];
    const pcnt=shapes.filter(s=>s.type==='pentagon').length,hasA=shapes.find(s=>s.type==='alpha'),hasH=shapes.filter(s=>s.type==='hexagon').length;
    while(shapes.length+ns.length<MAX_SHAPES+MAX_PENTAGONS+(!hasA?1:0)){
      const r=Math.random();let type,hp,score;
      if(!hasA&&!ns.find(s=>s.type==='alpha')&&r<0.015){type='alpha';hp=4000;score=4000;}
      else if(pcnt+ns.filter(s=>s.type==='pentagon').length<MAX_PENTAGONS&&r<0.09){type='pentagon';hp=250;score=300;}
      else if(hasH<25&&r<0.06){type='hexagon';hp=180;score=200;}
      else if(r<0.47){type='triangle';hp=30;score=25;}
      else{type='square';hp=100;score=100;}
      const s={id:nextId++,x:rand(120,WORLD_W-120),y:rand(120,WORLD_H-120),type,hp,maxHp:hp,score,angle:rand(0,Math.PI*2),rotSpeed:rand(-0.016,0.016),vx:0,vy:0};
      ns.push(s);shapes.push(s);
    }
    if(ns.length)broadcast({type:'shapeSpawn',shapes:ns});
    const newPu=[];while(powerups.length+newPu.length<MAX_POWERUPS&&Math.random()<0.5){const types=['health','speed','damage','shield','freeze','magnet','ghost','nuke'];const pu={id:nextId++,x:rand(100,WORLD_W-100),y:rand(100,WORLD_H-100),type:types[randInt(0,types.length-1)],life:1000};newPu.push(pu);powerups.push(pu);}
    if(newPu.length)broadcast({type:'powerupSpawn',powerups:newPu.map(p=>({id:p.id,x:p.x,y:p.y,type:p.type}))});
  }

  broadcast({
    type:'state',
    players:Object.values(players).map(serialize),
    bullets:Object.values(bullets).map(b=>({id:b.id,x:b.x,y:b.y,r:b.r,isBoss:!!b.isBoss})),
    shapes:shapes.map(s=>({id:s.id,x:s.x,y:s.y,type:s.type,hp:s.hp,maxHp:s.maxHp,angle:s.angle})),
    bosses:bosses.map(b=>({id:b.id,x:b.x,y:b.y,hp:b.hp,maxHp:b.maxHp,angle:b.angle,phase:b.phase}))
  });
},1000/TICK_RATE);

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>{
  console.log(`\n🎮 ═══════════════════════════════════════════════`);
  console.log(`🎮  DIEP.IO Clone v4.0`);
  console.log(`🎮  http://localhost:${PORT}`);
  console.log(`🎮  Owner ник: "${OWNER_NAME}"`);
  console.log(`🎮  Admin пароль: "${ADMIN_PASS}"`);
  console.log(`🎮  (Отредактируй эти строки в server.js)`);
  console.log(`🎮 ═══════════════════════════════════════════════\n`);
});
