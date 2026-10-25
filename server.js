const express=require('express');
const http=require('http');
const {Server}=require('socket.io');
const app=express(),server=http.createServer(app),io=new Server(server);
app.use(express.static('public'));
const rooms=new Map();
const suits=['C','D','H','S'];
const rank=c=>c.joker?(c.joker==='BIG'?17:16):c.n;
const strength=c=>rank(c)*4+(c.joker?0:suits.indexOf(c.s));
const deck=()=>{let d=[];for(let n=3;n<=15;n++)for(const s of suits)d.push({id:`${n}${s}`,n,s});d.push({id:'SJ',joker:'SMALL'},{id:'BJ',joker:'BIG'});return d;};
const shuffle=a=>{for(let i=a.length-1;i>0;i--){let j=require('crypto').randomInt(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;};
function evaluate(cards){
 if(cards.some(c=>c.joker)&&cards.length!==1)return null;
 const n=cards.length,sorted=[...cards].sort((a,b)=>strength(a)-strength(b));
 if(n===1)return {size:1,kind:0,score:[strength(sorted[0])]};
 const counts=new Map();for(const c of cards)counts.set(c.n,(counts.get(c.n)||0)+1);
 const entries=[...counts.entries()].sort((a,b)=>b[1]-a[1]||b[0]-a[0]);
 if(n===2&&entries[0][1]===2)return {size:2,kind:0,score:[cards[0].n,Math.max(...cards.map(strength))]};
 if(n===3&&entries[0][1]===3)return {size:3,kind:0,score:[cards[0].n]};
 if(n!==5)return null;
 const flush=cards.every(c=>c.s===cards[0].s);
 const ns=[...new Set(cards.map(c=>c.n))];
 // 2 is high; allowed straight 3-4-5-6-7 through 10-J-Q-K-A. No wraparound.
 const straight=ns.length===5&&ns.every((x,i)=>i===0||x===ns[i-1]+1)&&Math.max(...ns)<=14;
 const high=Math.max(...cards.map(strength));
 if(straight&&flush)return {size:5,kind:5,score:[Math.max(...ns),high]};
 if(entries[0][1]===4)return {size:5,kind:4,score:[entries[0][0],high]};
 if(entries[0][1]===3&&entries[1][1]===2)return {size:5,kind:3,score:[entries[0][0],entries[1][0]]};
 if(flush)return {size:5,kind:2,score:[...sorted.map(strength).reverse()]};
 if(straight)return {size:5,kind:1,score:[Math.max(...ns),high]};
 return null;
}
function beats(a,b){if(!b)return true;if(a.size!==b.size)return false;if(a.kind!==b.kind)return a.kind>b.kind;for(let i=0;i<Math.max(a.score.length,b.score.length);i++){if((a.score[i]||0)!==(b.score[i]||0))return (a.score[i]||0)>(b.score[i]||0);}return false;}
function publish(r){r.players.forEach((p,i)=>{if(!p.sid)return;io.to(p.sid).emit('state',{code:r.code,started:r.started,players:r.players.map((x,j)=>({name:x.name,count:x.hand.length,online:!!x.sid,seat:j})),seat:i,hand:p.hand,turn:r.turn,table:r.table,leader:r.leader,passes:r.passes,winner:r.winner,log:r.log.slice(-8)});});}
function createCode(){let c;do{c=String(require('crypto').randomInt(100000,1000000));}while(rooms.has(c));return c;}
io.on('connection',socket=>{
 socket.on('join',(payload,reply)=>{let {code,name,token}=payload||{};name=String(name||'').trim().slice(0,16);if(!name)return reply({error:'請輸入暱稱'});let r;if(!code){code=createCode();r={code,players:[],started:false,log:[]};rooms.set(code,r);}else r=rooms.get(String(code));if(!r)return reply({error:'找不到房間'});
 let p=token&&r.players.find(x=>x.token===token);if(!p){if(r.started||r.players.length>=3)return reply({error:'遊戲已開始或房間已滿'});token=require('crypto').randomBytes(16).toString('hex');p={name,token,hand:[],sid:null};r.players.push(p);}if(p.sid&&p.sid!==socket.id)io.to(p.sid).emit('notice','你的帳號已從另一裝置連線');p.sid=socket.id;socket.data={code,token};socket.join(code);reply({code,token});publish(r);
 });
 socket.on('start',reply=>{const r=rooms.get(socket.data.code);if(!r||r.players[0]?.token!==socket.data.token)return reply({error:'只有房主可以開始'});if(r.players.length!==3||r.players.some(p=>!p.sid))return reply({error:'需要三位玩家在線'});const d=shuffle(deck());r.players.forEach((p,i)=>p.hand=d.slice(i*18,i*18+18).sort((a,b)=>strength(a)-strength(b)));r.started=true;r.table=null;r.passes=0;r.leader=null;r.winner=null;r.turn=r.players.findIndex(p=>p.hand.some(c=>c.id==='3C'));r.first=true;r.log=['遊戲開始，梅花3持有者先出'];publish(r);reply({ok:true});});
 socket.on('play',(ids,reply)=>{const r=rooms.get(socket.data.code);if(!r?.started||r.winner!==null)return reply({error:'目前沒有進行中的牌局'});const i=r.players.findIndex(p=>p.token===socket.data.token);if(i!==r.turn)return reply({error:'還沒輪到你'});if(!Array.isArray(ids)||new Set(ids).size!==ids.length)return reply({error:'選牌錯誤'});const p=r.players[i],cards=ids.map(id=>p.hand.find(c=>c.id===id));if(!cards.length||cards.some(c=>!c))return reply({error:'手牌不存在'});if(r.first&&!ids.includes('3C'))return reply({error:'第一手必須包含梅花3'});const v=evaluate(cards);if(!v)return reply({error:'不合法的牌型（鬼牌僅能單張）'});if(!beats(v,r.table?.value))return reply({error:'必須出相同張數且更大的牌型'});p.hand=p.hand.filter(c=>!ids.includes(c.id));r.table={cards,value:v,by:i};r.leader=i;r.passes=0;r.first=false;r.log.push(`${p.name} 出 ${cards.length} 張`);if(!p.hand.length){r.winner=i;r.log.push(`${p.name} 獲勝！`);}else r.turn=(i+1)%3;publish(r);reply({ok:true});});
 socket.on('pass',reply=>{const r=rooms.get(socket.data.code);if(!r?.started||r.winner!==null)return reply({error:'遊戲尚未開始'});const i=r.players.findIndex(p=>p.token===socket.data.token);if(i!==r.turn)return reply({error:'還沒輪到你'});if(!r.table)return reply({error:'新一輪必須出牌'});r.passes++;r.log.push(`${r.players[i].name} Pass`);if(r.passes===2){r.table=null;r.passes=0;r.turn=r.leader;r.log.push('新一輪開始');}else r.turn=(i+1)%3;publish(r);reply({ok:true});});
 socket.on('disconnect',()=>{const r=rooms.get(socket.data.code);if(!r)return;const p=r.players.find(x=>x.token===socket.data.token);if(p&&p.sid===socket.id)p.sid=null;publish(r);});
});
server.listen(process.env.PORT||3000,()=>console.log('大老二遊戲：http://localhost:'+(process.env.PORT||3000)));
