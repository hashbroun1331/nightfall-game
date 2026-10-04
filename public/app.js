const socket=io({autoConnect:true}),$=id=>document.getElementById(id);
let state=null,myRole=null,myId=null,scope='all',voteTally={},jailInfo={};
const icons={Godfather:'🎩',Mafioso:'🔪',Forger:'📝',Consigliere:'🕵️‍♂️',Doctor:'🩺',Vigilante:'🔫',Bodyguard:'🛡️',Inspector:'🔎',Mayor:'🎖️',Hunter:'🏹',Veteran:'⚔️',Lookout:'👁️',Escort:'💃',Jailor:'⛓️','Serial Killer':'🩸',Citizen:'🏠'},roles=Object.keys(icons);
const teamLabel={town:'TOWN',mafia:'MAFIA',neutral:'NETRAL'};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const me=()=>state?.players.find(p=>p.id===myId);
const enter=()=>{$('home').classList.add('hidden');$('game').classList.remove('hidden')};
const leaveToHome=()=>{$('game').classList.add('hidden');$('home').classList.remove('hidden')};
const saved=()=>{try{return JSON.parse(localStorage.getItem('nightfallSession')||'null')}catch{return null}};
function saveSession(s){localStorage.setItem('nightfallSession',JSON.stringify({roomCode:s.roomCode,token:s.token,playerId:s.playerId}));}
if(saved())$('reconnect').classList.remove('hidden');
$('create').onclick=()=>socket.emit('room:create',{name:$('name').value});
$('join').onclick=()=>socket.emit('room:join',{name:$('name').value,roomCode:$('roomCode').value});
$('reconnect').onclick=()=>{const s=saved();if(s)socket.emit('room:reconnect',s)};
socket.on('connect',()=>{const s=saved();if(s)socket.emit('room:reconnect',s)});
socket.on('session',s=>{myId=s.playerId;saveSession(s);enter()});
socket.on('reconnect:failed',()=>{$('homeErr').textContent='Session lama tidak ditemukan. Join room lagi.';localStorage.removeItem('nightfallSession');$('reconnect').classList.add('hidden')});
socket.on('kicked',()=>{localStorage.removeItem('nightfallSession');state=null;myRole=null;leaveToHome();$('homeErr').textContent='Kamu dikeluarkan oleh host.'});
socket.on('error:msg',m=>{if($('home').classList.contains('hidden'))alert(m);else $('homeErr').textContent=m});
socket.on('role:assigned',r=>{myRole=r;renderRole();renderActions();renderTabs()});
socket.on('game:reset',()=>{myRole=null;voteTally={};jailInfo={};renderRole()});
socket.on('room:update',s=>{state=s;enter();render()});
socket.on('vote:update',t=>{voteTally=t;renderPlayers()});
socket.on('jail:update',j=>{jailInfo=j||{};renderTabs();renderActions()});
socket.on('chat:message',m=>{const d=document.createElement('div');d.className='msg '+(m.scope==='system'?'system':'');d.innerHTML=`<div><b>${esc(m.from)}</b> <small>${labelScope(m.scope)}</small></div><div>${esc(m.text)}</div>`;$('chat').appendChild(d);$('chat').scrollTop=$('chat').scrollHeight});
function labelScope(x){return({system:'SISTEM',all:'SEMUA',private:'PRIVAT',mafia:'MAFIA',dead:'MATI',jail:'JAIL'})[x]||String(x).toUpperCase()}
function render(){
  $('roomTitle').textContent=`ROOM ${state.code}`;
  const ph={lobby:'LOBBY',day:'SIANG',night:'MALAM',hunter_revenge:'HUNTER REVENGE',transition:'TRANSISI',ended:'SELESAI'}[state.phase]||state.phase.toUpperCase();
  $('phase').textContent=`${ph}${state.day?` • HARI ${state.day}`:''}`;
  $('aliveCount').textContent=state.started?`${state.players.filter(p=>p.alive).length}/${state.players.length} hidup`:`${state.players.length} pemain`;
  renderRole();renderPlayers();renderLobby();renderActions();renderPm();renderTabs();
}
function renderRole(){if(!myRole){$('roleCard').classList.add('hidden');return}$('roleCard').classList.remove('hidden');$('roleCard').innerHTML=`<div class="role-main"><div class="big">${myRole.emoji}</div><div><b>${esc(myRole.role)}</b><div class="team ${myRole.team}">${teamLabel[myRole.team]}</div></div></div><p>${esc(myRole.desc)}</p>${myRole.role==='Vigilante'?`<div class="resource">🔫 Peluru awal: 3</div>`:''}${myRole.role==='Veteran'?`<div class="resource">⚔️ Alert awal: 3</div>`:''}`}
function renderPlayers(){
  $('players').innerHTML='';if(!state)return;
  state.players.forEach(p=>{const d=document.createElement('div');d.className='player '+(!p.alive?'dead':'');let right='';
    if(!p.connected)right+='📡 ';
    if(!state.started)right+=p.ready?'✅':'';
    if(state.phase==='day'&&state.started&&me()?.alive&&p.alive&&p.id!==myId)right+=` <button class="voteBtn" onclick="vote('${p.id}')">Vote ${voteTally[p.id]||0}</button>`;
    if(!state.started&&state.hostId===myId&&p.id!==myId)right+=` <button class="kickBtn" onclick="kick('${p.id}')">✕</button>`;
    d.innerHTML=`<span><b>${p.id===myId?'👉 ':''}${esc(p.name)}</b> ${p.id===state.hostId?'👑':''} ${p.revealedMayor?'🎖️':''}</span><span>${right}</span>`;$('players').appendChild(d);
  });
}
function roleCountEditor(){return `<div class="role-config"><div class="config-head"><b>Komposisi Role</b><button class="miniBtn" onclick="autoRoles()">✨ Auto</button></div>${roles.map(r=>`<label><span>${icons[r]} ${r}</span><input class="roleCount" data-role="${esc(r)}" type="number" min="0" max="20" value="${Number(state.roleCounts?.[r]||0)}"></label>`).join('')}<div id="roleTotal" class="role-total">Total harus = ${state.players.length}</div></div>`}
function renderLobby(){
  const c=$('lobbyControls');if(!state||state.started){c.innerHTML='';return}
  let h=`<button onclick="ready()">${me()?.ready?'BATAL READY':'✅ READY'}</button>`;
  if(state.hostId===myId)h+=`<hr>${roleCountEditor()}<button onclick="applyCfg()">💾 SIMPAN SETTING</button><button class="startBtn" onclick="startGame()">▶ MULAI GAME</button>`;
  c.innerHTML=h;
  document.querySelectorAll('.roleCount').forEach(i=>i.oninput=updateRoleTotal);updateRoleTotal();
}
function updateRoleTotal(){const els=[...document.querySelectorAll('.roleCount')];if(!els.length)return;const n=els.reduce((s,x)=>s+(Number(x.value)||0),0),e=$('roleTotal');e.textContent=`Total role: ${n} / ${state.players.length}`;e.classList.toggle('bad',n!==state.players.length)}
window.ready=()=>socket.emit('player:ready',!me()?.ready);window.startGame=()=>socket.emit('game:start');window.autoRoles=()=>socket.emit('game:auto-config');window.kick=id=>socket.emit('player:kick',id);
window.applyCfg=()=>{const counts={};document.querySelectorAll('.roleCount').forEach(x=>counts[x.dataset.role]=Number(x.value)||0);socket.emit('game:config',{roleCounts:counts})};window.vote=id=>socket.emit('vote:cast',id);
function targetSelect(includeSelf=false){return `<select id="targetSel"><option value="">— pilih pemain —</option>${state.players.filter(p=>p.alive&&(includeSelf||p.id!==myId)).map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>`}
function renderActions(){
  const a=$('actions');if(!state){return}if(!state.started&&state.phase==='lobby'){a.innerHTML='Host mengatur role. Setelah siap, tekan <b>READY</b>.';return}
  const p=me();if(state.phase==='hunter_revenge'){
    if(state.hunterId===myId)a.innerHTML=`<div class="dangerBox">🏹 Kamu dieksekusi sebagai Hunter. Pilih satu pemain untuk ikut mati!</div>${targetSelect()}<button class="danger" onclick="hunterRevenge()">🏹 TEMBAK TARGET</button>`;else a.innerHTML='🏹 Hunter sedang memilih target balas dendam…';return;
  }
  if(!p?.alive){a.innerHTML='☠️ Kamu sudah mati. Gunakan <b>Chat Mati</b>.';return}
  if(state.phase==='day'){
    a.innerHTML=myRole?.role==='Mayor'&&!p.revealedMayor?`<button onclick="socket.emit('mayor:reveal')">🎖️ REVEAL SEBAGAI MAYOR</button>`:'💬 Diskusikan siapa yang mencurigakan, lalu vote.';
    if(state.hostId===myId)a.innerHTML+=`<button class="secondary" onclick="socket.emit('phase:advance')">Host: Mulai Malam</button>`;return;
  }
  if(state.phase==='ended'){a.innerHTML='🏁 Game selesai.'+(state.hostId===myId?'<button onclick="socket.emit(\'game:reset\')">🔁 REMATCH / KEMBALI KE LOBBY</button>':'');return}
  if(state.phase!=='night'){a.innerHTML='Menunggu…';return}
  if(!myRole?.night){a.innerHTML='😴 Role kamu tidak punya aksi malam.';if(state.hostId===myId)a.innerHTML+=`<button class="secondary" onclick="socket.emit('phase:advance')">Host: Selesaikan Malam</button>`;return}
  let h='';
  if(myRole.role==='Veteran')h=`<button onclick="nightAction('alert')">⚔️ AKTIFKAN ALERT</button>`;
  else if(myRole.role==='Forger')h=`${targetSelect()}<select id="forgeRole">${roles.map(r=>`<option value="${r}">${icons[r]} ${r}</option>`).join('')}</select><button onclick="nightAction('forge')">📝 PALSU ROLE</button>`;
  else if(myRole.role==='Jailor')h=`${targetSelect()}<label class="check"><input id="execute" type="checkbox"> Eksekusi tahanan malam ini</label><button onclick="nightAction('jail')">⛓️ TAHAN TARGET</button><p class="hint">Setelah menahan target, gunakan tab <b>Jail</b> untuk bicara privat.</p>`;
  else h=`${targetSelect()}<button onclick="nightAction('${['Godfather','Mafioso','Serial Killer','Vigilante'].includes(myRole.role)?'kill':'target'}')">✅ KUNCI AKSI</button>`;
  if(state.hostId===myId)h+=`<button class="secondary" onclick="socket.emit('phase:advance')">Host: Selesaikan Malam</button>`;a.innerHTML=h;
}
window.nightAction=t=>{const target=$('targetSel')?.value;if(t!=='alert'&&!target)return alert('Pilih target dulu.');socket.emit('night:action',{type:t,target,forgeRole:$('forgeRole')?.value,execute:$('execute')?.checked})};
window.hunterRevenge=()=>{const t=$('targetSel')?.value;if(t)socket.emit('hunter:revenge',t)};
function renderPm(){if(!state)return;$('pmTarget').innerHTML=state.players.filter(p=>p.id!==myId&&p.alive).map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}
function renderTabs(){if(!state)return;const p=me();document.querySelectorAll('.tab').forEach(b=>{const s=b.dataset.scope;let show=true;if(s==='mafia')show=!!(myRole?.team==='mafia'&&state.phase==='night'&&p?.alive);if(s==='dead')show=!!p&&!p.alive;if(s==='jail')show=state.phase==='night'&&[jailInfo.jailorId,jailInfo.prisonerId].includes(myId);if(s==='private')show=state.phase==='day'&&p?.alive;b.classList.toggle('hidden',!show);if(!show&&scope===s){scope='all';document.querySelector('[data-scope="all"]').classList.add('active')}});$('pmTarget').classList.toggle('hidden',scope!=='private')}
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{scope=b.dataset.scope;document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===b));$('pmTarget').classList.toggle('hidden',scope!=='private')});
$('send').onclick=send;$('chatInput').onkeydown=e=>{if(e.key==='Enter')send()};function send(){const text=$('chatInput').value.trim();if(!text)return;socket.emit('chat:send',{scope,targetId:$('pmTarget').value,text});$('chatInput').value=''}
setInterval(()=>{if(!state?.timerEndsAt){$('timer').textContent='';return}const s=Math.max(0,Math.ceil((state.timerEndsAt-Date.now())/1000));$('timer').textContent=`⏱ ${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`},500);
