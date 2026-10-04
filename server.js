const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const seedrandom = require('seedrandom');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.static(path.join(__dirname, 'public')));
const PORT = process.env.PORT || 3000;
const rooms = new Map();

const ROLES = {
  Godfather:{emoji:'🎩',team:'mafia',night:true,desc:'Pilih target pembunuhan Mafia. Pilihan Godfather diprioritaskan.'},
  Mafioso:{emoji:'🔪',team:'mafia',night:true,desc:'Membantu melakukan pembunuhan Mafia.'},
  Forger:{emoji:'📝',team:'mafia',night:true,desc:'Memalsukan role yang tampil ketika target mati malam ini.'},
  Consigliere:{emoji:'🕵️‍♂️',team:'mafia',night:true,desc:'Mengetahui role asli satu pemain.'},
  Doctor:{emoji:'🩺',team:'town',night:true,desc:'Melindungi satu pemain dari serangan malam.'},
  Vigilante:{emoji:'🔫',team:'town',night:true,desc:'Menembak satu pemain. Peluru terbatas.'},
  Bodyguard:{emoji:'🛡️',team:'town',night:true,desc:'Menjaga satu pemain. Jika diserang, Bodyguard dan penyerang saling membunuh.'},
  Inspector:{emoji:'🔎',team:'town',night:true,desc:'Memeriksa apakah seorang pemain terlihat mencurigakan.'},
  Mayor:{emoji:'🎖️',team:'town',night:false,desc:'Buka identitas saat siang. Setelah reveal, suara bernilai 3.'},
  Hunter:{emoji:'🏹',team:'town',night:false,desc:'Jika dieksekusi lewat voting, pilih satu pemain untuk ikut mati.'},
  Veteran:{emoji:'⚔️',team:'town',night:true,desc:'Alert dan menyerang semua pengunjung. Alert terbatas.'},
  Lookout:{emoji:'👁️',team:'town',night:true,desc:'Melihat siapa saja yang mengunjungi target.'},
  Escort:{emoji:'💃',team:'town',night:true,desc:'Memblokir aksi malam satu pemain.'},
  Jailor:{emoji:'⛓️',team:'town',night:true,desc:'Menahan satu pemain, chat privat dengannya, dan dapat mengeksekusi tahanan.'},
  'Serial Killer':{emoji:'🩸',team:'neutral',night:true,desc:'Membunuh setiap malam. Menang jika menjadi ancaman terakhir.'},
  Citizen:{emoji:'🏠',team:'town',night:false,desc:'Tidak punya aksi malam. Cari penjahat lewat diskusi dan voting.'}
};

const DEFAULT_ORDER = Object.keys(ROLES);
const basePreset = ['Godfather','Doctor','Inspector','Citizen','Serial Killer','Mafioso','Jailor','Escort','Mayor','Consigliere','Lookout','Veteran','Forger','Hunter','Bodyguard','Vigilante'];
const clean = s => String(s || '').replace(/[<>]/g, '').trim().slice(0,18) || 'Player';
const makeCode = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const makeId = () => crypto.randomUUID();
const now = () => Date.now();
const living = room => [...room.players.values()].filter(p => p.alive);
const playerBySocket = (room, socketId) => [...room.players.values()].find(p => p.socketId === socketId);
const tell = (p, text) => p?.socketId && io.to(p.socketId).emit('chat:message',{scope:'system',from:'SISTEM',text,ts:now()});
const announce = (room,text) => io.to(room.code).emit('chat:message',{scope:'system',from:'SISTEM',text,ts:now()});
const teamName = team => team === 'town' ? 'Town' : team === 'mafia' ? 'Mafia' : 'Neutral';

function roleCountsFor(n){
  const list=[];
  for(let i=0;i<n;i++) list.push(basePreset[i] || 'Citizen');
  const c={}; DEFAULT_ORDER.forEach(r=>c[r]=0); list.forEach(r=>c[r]++); return c;
}
function countsToList(counts){
  const out=[];
  for(const r of DEFAULT_ORDER){
    const n=Math.max(0,Math.min(20,Number(counts?.[r]||0)));
    for(let i=0;i<n;i++) out.push(r);
  }
  return out;
}
function shuffle(arr, seed){
  const rng=seedrandom(String(seed)), a=[...arr];
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(rng()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
function publicState(room){
  return {
    code:room.code, phase:room.phase, day:room.day, hostId:room.hostId, started:room.started,
    seed:room.seed, timerEndsAt:room.timerEndsAt, roleCounts:room.roleCounts, hunterId:room.hunterId,
    players:[...room.players.values()].map(p=>({id:p.id,name:p.name,alive:p.alive,ready:p.ready,connected:p.connected,revealedMayor:p.revealedMayor}))
  };
}
function emit(room){ io.to(room.code).emit('room:update', publicState(room)); }
function sendRole(p){ if(p?.socketId && p.role) io.to(p.socketId).emit('role:assigned',{role:p.role,...ROLES[p.role],bullets:p.bullets,alerts:p.alerts}); }
function sendSession(socket, room, p){
  socket.data.room=room.code; socket.data.playerId=p.id; socket.join(room.code);
  socket.emit('session',{roomCode:room.code,token:p.token,playerId:p.id});
  if(p.role) sendRole(p);
}
function checkWin(room){
  if(!room.started || room.phase==='hunter_revenge') return null;
  const a=living(room), m=a.filter(p=>ROLES[p.role]?.team==='mafia'), t=a.filter(p=>ROLES[p.role]?.team==='town'), sk=a.filter(p=>p.role==='Serial Killer');
  if(sk.length===1 && a.length===1) return 'Serial Killer';
  if(!m.length && !sk.length) return 'Town';
  if(m.length >= t.length + sk.length) return 'Mafia';
  return null;
}
function endIfNeeded(room){
  const w=checkWin(room); if(!w) return false;
  room.started=false; room.phase='ended'; room.timerEndsAt=null;
  announce(room,`🏆 ${w} MENANG!`); emit(room); return true;
}
function day(room){
  if(endIfNeeded(room)) return;
  const oldJail=room.jail||{}; for(const id of [oldJail.jailorId,oldJail.prisonerId]){const x=room.players.get(id);if(x?.socketId)io.to(x.socketId).emit('jail:update',{});}
  room.phase='day'; room.day++; room.votes=new Map(); room.hunterId=null; room.jail={jailorId:null,prisonerId:null,execute:false};
  room.timerEndsAt=now()+180000; announce(room,`☀️ HARI ${room.day} DIMULAI.`); emit(room);
}
function night(room){
  if(endIfNeeded(room)) return;
  io.to(room.code).emit('jail:update',{});
  room.phase='night'; room.actions=new Map(); room.forged=new Map(); room.jail={jailorId:null,prisonerId:null,execute:false};
  room.timerEndsAt=now()+90000; announce(room,`🌙 MALAM ${room.day} DIMULAI.`); emit(room);
}
function recordKill(deaths,id,cause,attackerId=null,unprotectable=false){ if(id) deaths.set(id,{cause,attackerId,unprotectable}); }

function resolveNight(room){
  if(room.phase!=='night') return;
  const alive=living(room), blocked=new Set(), protectedIds=new Set(), guards=new Map(), visitors=new Map(), deaths=new Map();
  const jail=room.jail || {};
  if(jail.prisonerId) blocked.add(jail.prisonerId);

  for(const p of alive){ const a=room.actions.get(p.id); if(p.role==='Escort' && a?.target && p.id!==jail.prisonerId) blocked.add(a.target); }
  const visit=(from,to)=>{ if(!to)return; if(!visitors.has(to))visitors.set(to,[]); visitors.get(to).push(from); };
  for(const p of alive){ const a=room.actions.get(p.id); if(a?.target && !blocked.has(p.id)) visit(p.id,a.target); }
  for(const p of alive){
    if(blocked.has(p.id)) continue; const a=room.actions.get(p.id); if(!a)continue;
    if(p.role==='Doctor' && a.target) protectedIds.add(a.target);
    if(p.role==='Bodyguard' && a.target) guards.set(a.target,p.id);
  }

  function attack(targetId,cause,attackerId,unprotectable=false){
    const target=room.players.get(targetId); if(!target?.alive)return;
    if(!unprotectable && protectedIds.has(targetId)){ tell(target, '🩺 Kamu diserang, tetapi diselamatkan Doctor.'); return; }
    const guardId=!unprotectable ? guards.get(targetId) : null;
    if(guardId && room.players.get(guardId)?.alive && guardId!==attackerId){
      recordKill(deaths,guardId,'mati saat melindungi target sebagai Bodyguard',attackerId,true);
      if(attackerId) recordKill(deaths,attackerId,'tewas dalam duel melawan Bodyguard',guardId,true);
      tell(target,'🛡️ Bodyguard menyelamatkanmu dari serangan!');
      return;
    }
    recordKill(deaths,targetId,cause,attackerId,unprotectable);
  }

  for(const p of alive){
    if(blocked.has(p.id)){ tell(p, p.id===jail.prisonerId ? '⛓️ Kamu ditahan Jailor. Aksi malammu diblokir.' : '🚫 Aksi malammu diblokir.'); continue; }
    const a=room.actions.get(p.id); if(!a)continue;
    if(p.role==='Veteran' && a.type==='alert' && p.alerts>0){ p.alerts--; for(const v of visitors.get(p.id)||[]) attack(v,'tewas saat mengunjungi Veteran yang sedang Alert',p.id,true); }
    if(p.role==='Serial Killer' && a.target) attack(a.target,'dibunuh Serial Killer',p.id);
    if(p.role==='Vigilante' && a.target && p.bullets>0){ p.bullets--; attack(a.target,'ditembak Vigilante',p.id); }
    if(p.role==='Inspector' && a.target){ const t=room.players.get(a.target); if(t) tell(p,['Godfather','Mafioso','Forger','Consigliere','Serial Killer'].includes(t.role)?`🔎 ${t.name} terlihat MENCURIGAKAN.`:`🔎 ${t.name} tidak terlihat mencurigakan.`); }
    if(p.role==='Consigliere' && a.target){ const t=room.players.get(a.target); if(t) tell(p,`🕵️ ${t.name} adalah ${ROLES[t.role].emoji} ${t.role}.`); }
    if(p.role==='Lookout' && a.target){ const names=(visitors.get(a.target)||[]).map(id=>room.players.get(id)?.name).filter(Boolean); tell(p,`👁️ Pengunjung ${room.players.get(a.target)?.name}: ${names.length?names.join(', '):'Tidak ada'}.`); }
    if(p.role==='Forger' && a.target && ROLES[a.forgeRole]) room.forged.set(a.target,a.forgeRole);
  }

  if(jail.jailorId && jail.prisonerId && jail.execute){ const jp=room.players.get(jail.jailorId); if(jp?.alive) attack(jail.prisonerId,'dieksekusi Jailor',jail.jailorId,true); }

  const killers=alive.filter(p=>['Godfather','Mafioso'].includes(p.role) && !blocked.has(p.id));
  let mafiaActor=null, mafiaTarget=null;
  for(const p of killers){ const a=room.actions.get(p.id); if(a?.type==='kill'&&a.target){ mafiaActor=p; mafiaTarget=a.target; if(p.role==='Godfather')break; } }
  if(mafiaTarget) attack(mafiaTarget,'dibunuh Mafia',mafiaActor?.id);

  for(const [id,info] of deaths){
    const p=room.players.get(id); if(!p?.alive)continue; p.alive=false;
    const shown=room.forged.get(id)||p.role;
    announce(room,`☠️ ${p.name} ${info.cause}. Role: ${ROLES[shown]?.emoji||''} ${shown}.`);
  }
  room.jail={jailorId:null,prisonerId:null,execute:false};
  day(room);
}

function beginHunterRevenge(room,hunter){
  room.phase='hunter_revenge'; room.hunterId=hunter.id; room.timerEndsAt=now()+20000;
  announce(room,`🏹 ${hunter.name} adalah Hunter! Ia punya 20 detik untuk memilih satu pemain yang ikut mati.`); emit(room);
}
function finishExecution(room){ room.hunterId=null; room.phase='transition'; room.timerEndsAt=null; if(!endIfNeeded(room)){ emit(room); setTimeout(()=>{if(room.started&&room.phase==='transition')night(room)},700); } }
function execute(room,id){
  const p=room.players.get(id); if(!p?.alive)return; p.alive=false;
  announce(room,`⚖️ ${p.name} dieksekusi lewat voting. Role: ${ROLES[p.role].emoji} ${p.role}.`);
  if(p.role==='Hunter') beginHunterRevenge(room,p); else finishExecution(room);
}
function removePlayer(room,p){
  room.players.delete(p.id);
  if(room.hostId===p.id) room.hostId=[...room.players.values()].find(x=>x.connected)?.id || [...room.players.keys()][0] || null;
  if(room.players.size===0) rooms.delete(room.code); else emit(room);
}

io.on('connection',socket=>{
  socket.on('room:create',({name,seed})=>{
    let code=makeCode(); while(rooms.has(code))code=makeCode();
    const p={id:makeId(),socketId:socket.id,token:crypto.randomBytes(24).toString('hex'),name:clean(name),alive:true,ready:false,role:null,revealedMayor:false,bullets:3,alerts:3,connected:true,disconnectedAt:null};
    const room={code,hostId:p.id,players:new Map([[p.id,p]]),started:false,phase:'lobby',day:0,seed:String(seed||Math.floor(Math.random()*1e9)).slice(0,40),timerEndsAt:null,roleCounts:roleCountsFor(1),actions:new Map(),votes:new Map(),forged:new Map(),jail:{},hunterId:null};
    rooms.set(code,room); sendSession(socket,room,p); emit(room);
  });

  socket.on('room:join',({name,roomCode})=>{
    const code=String(roomCode||'').toUpperCase(), room=rooms.get(code);
    if(!room)return socket.emit('error:msg','Room tidak ditemukan.');
    if(room.started)return socket.emit('error:msg','Game sudah dimulai. Gunakan reconnect jika kamu pemain lama.');
    const p={id:makeId(),socketId:socket.id,token:crypto.randomBytes(24).toString('hex'),name:clean(name),alive:true,ready:false,role:null,revealedMayor:false,bullets:3,alerts:3,connected:true,disconnectedAt:null};
    room.players.set(p.id,p); room.roleCounts=roleCountsFor(room.players.size); sendSession(socket,room,p); announce(room,`👋 ${p.name} masuk ke room.`); emit(room);
  });

  socket.on('room:reconnect',({roomCode,token})=>{
    const room=rooms.get(String(roomCode||'').toUpperCase()); if(!room)return socket.emit('reconnect:failed');
    const p=[...room.players.values()].find(x=>x.token===token); if(!p)return socket.emit('reconnect:failed');
    p.socketId=socket.id; p.connected=true; p.disconnectedAt=null; sendSession(socket,room,p); if(room.phase==='night'&&[room.jail?.jailorId,room.jail?.prisonerId].includes(p.id))socket.emit('jail:update',{jailorId:room.jail.jailorId,prisonerId:room.jail.prisonerId}); socket.emit('reconnect:ok'); tell(p,'🔄 Kamu berhasil terhubung kembali.'); emit(room);
  });

  socket.on('player:ready',ready=>{ const room=rooms.get(socket.data.room),p=room?.players.get(socket.data.playerId); if(p&&!room.started){p.ready=!!ready;emit(room);} });
  socket.on('player:kick',id=>{ const room=rooms.get(socket.data.room),host=room?.players.get(socket.data.playerId),target=room?.players.get(id); if(!room||host?.id!==room.hostId||room.started||!target||target.id===host.id)return; if(target.socketId)io.to(target.socketId).emit('kicked'); announce(room,`🚪 ${target.name} dikeluarkan oleh host.`); room.roleCounts=roleCountsFor(Math.max(0,room.players.size-1)); removePlayer(room,target); });
  socket.on('game:auto-config',()=>{ const room=rooms.get(socket.data.room); if(!room||room.hostId!==socket.data.playerId||room.started)return; room.roleCounts=roleCountsFor(room.players.size); emit(room); });
  socket.on('game:config',cfg=>{
    const room=rooms.get(socket.data.room); if(!room||room.hostId!==socket.data.playerId||room.started)return;
    if(cfg?.seed!==undefined) room.seed=String(cfg.seed||Math.floor(Math.random()*1e9)).slice(0,40);
    if(cfg?.roleCounts && typeof cfg.roleCounts==='object'){
      const cleanCounts={}; for(const r of DEFAULT_ORDER)cleanCounts[r]=Math.max(0,Math.min(20,Number(cfg.roleCounts[r]||0)|0)); room.roleCounts=cleanCounts;
    }
    emit(room);
  });

  socket.on('game:reset',()=>{
    const room=rooms.get(socket.data.room); if(!room||room.hostId!==socket.data.playerId||room.phase!=='ended')return;
    room.started=false;room.phase='lobby';room.day=0;room.timerEndsAt=null;room.actions=new Map();room.votes=new Map();room.forged=new Map();room.jail={};room.hunterId=null;
    for(const p of room.players.values()){p.alive=true;p.ready=false;p.role=null;p.revealedMayor=false;p.bullets=3;p.alerts=3;if(p.socketId)io.to(p.socketId).emit('game:reset');}
    room.roleCounts=roleCountsFor(room.players.size);announce(room,'🔁 Room di-reset untuk rematch. Semua pemain kembali ke lobby.');emit(room);
  });

  socket.on('game:start',()=>{
    const room=rooms.get(socket.data.room); if(!room||room.hostId!==socket.data.playerId||room.started)return;
    const ps=[...room.players.values()]; if(ps.length<4)return socket.emit('error:msg','Minimal 4 pemain.');
    const list=countsToList(room.roleCounts); if(list.length!==ps.length)return socket.emit('error:msg',`Total role harus sama dengan jumlah pemain (${ps.length}). Sekarang: ${list.length}.`);
    const roles=shuffle(list,room.seed), order=shuffle(ps,room.seed+'-players');
    order.forEach((p,i)=>{p.role=roles[i];p.alive=true;p.ready=false;p.revealedMayor=false;p.bullets=3;p.alerts=3;sendRole(p);});
    room.started=true;room.day=0; announce(room,`🎲 Game dimulai. Seed: ${room.seed}`); day(room);
  });

  socket.on('mayor:reveal',()=>{ const room=rooms.get(socket.data.room),p=room?.players.get(socket.data.playerId); if(room?.phase==='day'&&p?.alive&&p.role==='Mayor'&&!p.revealedMayor){p.revealedMayor=true;announce(room,`🎖️ ${p.name} membuka identitas sebagai Mayor! Suaranya sekarang bernilai 3.`);emit(room);} });
  socket.on('vote:cast',id=>{
    const room=rooms.get(socket.data.room),v=room?.players.get(socket.data.playerId),t=room?.players.get(id); if(!room||room.phase!=='day'||!v?.alive||!t?.alive||id===v.id)return;
    room.votes.set(v.id,id); const tally={}; for(const [vid,tid] of room.votes){const vp=room.players.get(vid);tally[tid]=(tally[tid]||0)+(vp?.revealedMayor?3:1);} io.to(room.code).emit('vote:update',tally);
    const need=Math.floor(living(room).length/2)+1; if((tally[id]||0)>=need) execute(room,id);
  });

  socket.on('hunter:revenge',targetId=>{
    const room=rooms.get(socket.data.room),hunter=room?.players.get(socket.data.playerId),target=room?.players.get(targetId); if(!room||room.phase!=='hunter_revenge'||room.hunterId!==hunter?.id||!target?.alive)return;
    target.alive=false; announce(room,`🏹 Hunter memilih ${target.name}. ${target.name} ikut mati! Role: ${ROLES[target.role].emoji} ${target.role}.`); finishExecution(room); emit(room);
  });

  socket.on('night:action',a=>{
    const room=rooms.get(socket.data.room),p=room?.players.get(socket.data.playerId); if(!room||room.phase!=='night'||!p?.alive||!ROLES[p.role]?.night)return;
    const target=String(a?.target||''); if(target && (!room.players.get(target)?.alive || target===p.id))return;
    if(p.role==='Jailor'){
      if(room.jail?.prisonerId && room.jail.jailorId===p.id && room.jail.prisonerId!==target)return tell(p,'⛓️ Kamu sudah memilih tahanan malam ini.');
      room.jail={jailorId:p.id,prisonerId:target,execute:!!a?.execute}; room.actions.set(p.id,{type:'jail',target,execute:!!a?.execute});
      const prisoner=room.players.get(target); tell(p,`⛓️ ${prisoner?.name} sekarang ditahan. Gunakan tab JAIL untuk bicara.`); tell(prisoner,`⛓️ Kamu ditahan Jailor malam ini. Gunakan tab JAIL untuk bicara.`); for(const x of [p,prisoner])if(x?.socketId)io.to(x.socketId).emit('jail:update',{jailorId:p.id,prisonerId:target}); return;
    }
    room.actions.set(p.id,{type:String(a?.type||''),target,forgeRole:String(a?.forgeRole||''),execute:!!a?.execute}); tell(p,'✅ Aksi malam dikunci.');
  });

  socket.on('phase:advance',()=>{ const room=rooms.get(socket.data.room); if(!room||room.hostId!==socket.data.playerId||!room.started)return; if(room.phase==='day')night(room); else if(room.phase==='night')resolveNight(room); });

  socket.on('chat:send',({scope,targetId,text})=>{
    const room=rooms.get(socket.data.room),p=room?.players.get(socket.data.playerId); text=String(text||'').trim().slice(0,400); if(!room||!p||!text)return;
    const msg={scope,from:p.name,fromId:p.id,text,ts:now()};
    if(scope==='all'){
      if(room.phase!=='day'||!p.alive)return; io.to(room.code).emit('chat:message',msg);
    } else if(scope==='mafia'){
      if(room.phase!=='night'||!p.alive||ROLES[p.role]?.team!=='mafia')return; for(const m of living(room).filter(x=>ROLES[x.role]?.team==='mafia')) if(m.socketId)io.to(m.socketId).emit('chat:message',msg);
    } else if(scope==='dead'){
      if(p.alive)return; for(const d of [...room.players.values()].filter(x=>!x.alive)) if(d.socketId)io.to(d.socketId).emit('chat:message',msg);
    } else if(scope==='private'){
      const t=room.players.get(targetId); if(!t||!p.alive||!t.alive||room.phase!=='day')return; if(t.socketId)io.to(t.socketId).emit('chat:message',msg); if(p.socketId)io.to(p.socketId).emit('chat:message',msg);
    } else if(scope==='jail'){
      if(room.phase!=='night')return; const j=room.jail||{}; if(!j.prisonerId||![j.jailorId,j.prisonerId].includes(p.id))return; for(const id of [j.jailorId,j.prisonerId]){const x=room.players.get(id);if(x?.socketId)io.to(x.socketId).emit('chat:message',msg);}
    }
  });

  socket.on('disconnect',()=>{
    const room=rooms.get(socket.data.room),p=room?.players.get(socket.data.playerId); if(!room||!p)return; p.connected=false;p.socketId=null;p.disconnectedAt=now(); announce(room,`📡 ${p.name} terputus. Menunggu reconnect…`);emit(room);
  });
});

setInterval(()=>{
  for(const room of rooms.values()){
    if(room.started && room.timerEndsAt && now()>=room.timerEndsAt){ if(room.phase==='day')night(room); else if(room.phase==='night')resolveNight(room); else if(room.phase==='hunter_revenge')finishExecution(room); }
    for(const p of [...room.players.values()]){
      if(!p.connected && p.disconnectedAt && now()-p.disconnectedAt>10*60*1000 && !room.started) removePlayer(room,p);
    }
  }
},1000);

server.listen(PORT,()=>console.log(`Nightfall v2 aktif di port ${PORT}`));
