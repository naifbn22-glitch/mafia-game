import {io} from 'socket.io-client';
import {writeFile} from 'node:fs/promises';
const servers={A:'https://mafiagameplay.com',B:'https://mafia-game-production-5ac2.up.railway.app',C:'https://mafia-game-c-production.up.railway.app',D:'https://mafia-game-d-production.up.railway.app'};
const agent=undefined;
const sockets=new Set(), rooms=[], results=[];
let samples=[], failures=[], disconnected=0, broadcasts=0, stopping=false;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const percentile=(a,p)=>a.length?[...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*p))]:0;
async function connect(url){
 const s=io(url,{transports:['websocket'],agent,reconnection:false,timeout:25000,forceNew:true});sockets.add(s);s.testServer=Object.keys(servers).find(k=>servers[k]===url);
 s.on('room:snapshot',r=>{s.lastRoom=r;broadcasts++});s.on('disconnect',()=>{if(!stopping)disconnected++});
 await new Promise((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',e=>reject(Error('connect:'+e.message+':'+(e.description?.message||''))))});return s;
}
async function command(s,event,payload){
 const t=performance.now();
 const result=await new Promise((resolve,reject)=>s.timeout(8000).emit(event,payload,(error,data)=>error?reject(Error(event+':timeout')):resolve(data)));
 samples.push({server:s.testServer,event,ms:performance.now()-t});if(!result?.ok)throw Error(event+':'+result?.error);return result;
}
async function create(server,index){
 const url=servers[server];
 const h=await connect(url);const cr=await command(h,'room:create',{hostName:'LoadTest',roomName:'FULLTEST-'+server+'-'+index,maxPlayers:10,discussionDurationSeconds:30});
 const r={h,code:cr.room.code,token:cr.hostToken,players:[],state:cr.room,server,index,history:[]};rooms.push(r);
 await command(h,'room:subscribe',{code:r.code,mode:'host',token:r.token});
 await Promise.all(Array.from({length:10},async(_,i)=>{const s=await connect(url);const j=await command(s,'player:join',{code:r.code,name:'TestPlayer'+i,gender:'male'});const p={s,id:j.player.id,token:j.player.sessionToken};r.players.push(p);await command(s,'room:subscribe',{code:r.code,mode:'player',playerId:p.id,token:p.token})}));
 r.state=(await host(r,'start-game')).room;
 if(r.code[0]!==server)throw Error('wrong-server-prefix');
 if(r.state.players.length!==10)throw Error('incorrect-player-count');
 await Promise.all(r.players.map(p=>player(r,p,'role-known')));
 return r;
}
const host=(r,action,payload={})=>command(r.h,'host:command',{code:r.code,token:r.token,action,payload});
const player=(r,p,action,payload={})=>command(p.s,'player:command',{code:r.code,playerId:p.id,token:p.token,action,payload});
const started=new Date().toISOString();let stage=0;const stageMatches=[];
const pick=a=>a[Math.floor(Math.random()*a.length)];
async function sync(r){return (await command(r.h,'room:sync',{code:r.code,mode:'host',token:r.token})).room}
async function round(r){
 let current=await sync(r);if(current.winner)return;
 await host(r,current.phase==='voting-result'?'next-night':'eyes-closed');
 current=await sync(r);
 const n=current.roundNumber;
 const alive=current.players.filter(p=>p.alive);
 const kill=r.expected==='thieves'&&n>r.endRound-3;
 const candidates=alive.filter(p=>p.role!=='thief'&&p.role!=='nurse'&&p.id!==current.lastTargets?.thief&& (kill||p.id!==current.lastTargets?.nurse));
 const victim=pick(candidates.filter(p=>p.role==='citizen'))||pick(candidates);
 if(!victim)throw Error('no-legal-victim');
 for(const role of ['thief','nurse','king','investigator']){
  const actors=alive.filter(p=>p.role===role);if(!actors.length)continue;
  await host(r,'wake-role',{role});
  await Promise.all(actors.map(async a=>{const p=r.players.find(p=>p.id===a.id);if(role==='king')await player(r,p,'skip-king-pardon');else{
   let target=role==='thief'||(role==='nurse'&&!kill)?victim:pick(alive.filter(x=>role==='nurse'?x.id!==victim.id&&x.id!==current.lastTargets?.nurse:x.id!==a.id));
   await player(r,p,'select-night-target',{targetId:target.id});
  }await player(r,p,'confirm-night-action')}));
 }
 const day=(await host(r,'finish-night')).room;
 if(day.winner)throw Error('early-night-winner');
 await sleep(30000);
 const voting=(await host(r,'start-voting')).room;
 let target=null;
 if(r.expected==='citizens'&&n>=r.endRound-1)target=pick(voting.players.filter(p=>p.alive&&p.role==='thief'));
 if(kill)target=pick(voting.players.filter(p=>p.alive&&p.role==='citizen'))||pick(voting.players.filter(p=>p.alive&&p.role!=='thief'&&p.role!=='nurse'));
 await Promise.all(voting.players.filter(p=>p.alive).map(a=>player(r,r.players.find(p=>p.id===a.id),'cast-vote',{targetId:target&&a.id!==target.id?target.id:'abstain'})));
 const result=await sync(r);
 if(result.phase!=='voting-result')throw Error('voting-not-resolved');
 const deadline=Date.now()+5000;
 while([r.h,...r.players.map(p=>p.s)].some(s=>s.lastRoom?.version!==result.version)&&Date.now()<deadline)await sleep(50);
 for(const p of r.players){if(p.s.lastRoom?.code!==r.code||p.s.lastRoom?.version!==result.version)throw Error('snapshot-not-delivered');if(!result.winner&&p.s.lastRoom.players.some(x=>x.id!==p.id&&x.role&&!(result.players.find(a=>a.id===p.id).role==='thief'&&x.role==='thief')))throw Error('role-privacy-leak')}
 r.history.push({round:n,nightOutcome:day.daySummary?.outcome,voteOutcome:result.votingResult?.outcome,winner:result.winner,alive:result.players.filter(p=>p.alive).length});
 if(n<r.endRound&&result.winner)throw Error('premature-winner');
 if(n===r.endRound&&result.winner!==r.expected)throw Error('wrong-final-winner:'+result.winner);
 r.state=result;
}
async function safe(fn){try{return await fn()}catch(e){failures.push(e.message);console.log('ERROR '+e.message);return null}}
function snapshot(){return {started,updated:new Date().toISOString(),stage,results,stageMatches,failures,roomsCreated:rooms.length,connected:[...sockets].filter(s=>s.connected).length}}
async function save(){await writeFile('full-four-results.json',JSON.stringify(snapshot(),null,2))}
async function cleanup(){stopping=true;for(const s of sockets)s.disconnect();await save()}
process.on('SIGTERM',()=>cleanup().then(()=>process.exit()));process.on('SIGINT',()=>cleanup().then(()=>process.exit()));
try{
 for(const count of [10,20,30,35]){
  stage=count;samples=[];failures=[];broadcasts=0;disconnected=0;const begin=Date.now();
  for(let offset=0;offset<count;offset+=1){const jobs=[];for(const server of Object.keys(servers)){const have=rooms.filter(r=>r.server===server).length;for(let index=Math.max(have,offset);index<Math.min(offset+1,count);index++)jobs.push(()=>create(server,index))}await Promise.all(jobs.map(fn=>safe(fn)));if(failures.length)break;console.log('RAMP '+rooms.length+' rooms '+[...sockets].filter(s=>s.connected).length+' connections')}
  for(const r of rooms){if(r.state.winner){await host(r,'rematch');r.state=(await host(r,'start-game')).room;await Promise.all(r.players.map(p=>player(r,p,'role-known')))}r.history=[];r.expected=((r.index+Object.keys(servers).indexOf(r.server)+results.length)%2===0)?'citizens':'thieves';r.endRound=r.expected==='citizens'?[4,5,6][r.index%3]:[7,8][r.index%2]}
  let complete=failures.length===0;
  for(let cycle=1;cycle<=8&&!failures.length;cycle++){console.log('ROUND '+cycle+' stage '+stage);await Promise.all(rooms.filter(r=>!r.state.winner).map(r=>safe(()=>round(r))));await save();if(failures.length||disconnected){complete=false;break}}
  const byServer={};for(const server of Object.keys(servers)){const ms=samples.filter(x=>x.server===server).map(x=>x.ms);byServer[server]={rooms:rooms.filter(r=>r.server===server).length,connections:[...sockets].filter(s=>s.connected&&s.testServer===server).length,commands:ms.length,p50:Math.round(percentile(ms,.5)),p95:Math.round(percentile(ms,.95)),p99:Math.round(percentile(ms,.99)),max:Math.round(Math.max(0,...ms)),finished:rooms.filter(r=>r.server===server&&r.state.winner).length}}
  const ms=samples.map(x=>x.ms);const row={rooms:rooms.length,connections:[...sockets].filter(s=>s.connected).length,durationSeconds:(Date.now()-begin)/1000,commands:ms.length,p95:Math.round(percentile(ms,.95)),errors:failures.length,errorExamples:[...new Set(failures)],disconnected,snapshots:broadcasts,complete,byServer};results.push(row);
  stageMatches.push({stage,matches:rooms.map(r=>({server:r.server,index:r.index,code:r.code,winner:r.state.winner,endRound:r.state.roundNumber,expected:r.expected,history:r.history}))});console.log('STAGE_RESULT '+JSON.stringify(row));await save();
  if(failures.length||disconnected||Object.values(byServer).some(s=>s.p95>1500)){console.log('STOP_THRESHOLD');break}
 }
}finally{await cleanup();console.log('DISCONNECTED_ALL_TEST_CLIENTS');console.log('FINAL_SUMMARY '+JSON.stringify({started,results,roomsCreated:rooms.length}))}
