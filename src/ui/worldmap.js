// The world map screen (#1013 slice 6): a reference, not a place to walk. Key M (Esc closes), a View button and one in the cinema bar.
// The lands of the campaign are placed from src/data/worldmap.js and painted by render/atlasart.js; this file says what may be seen.
// A one-map world has nothing to show: the button hides and the key does nothing. A map is a chapter of a world, so a world with any road
// off its map, built or not, shows the whole outline with that map on it.
// What it shows, all read here and nothing written:
//   here     the map on screen (MAP_ID): its real ground, the company's marker, the towns and places the company knows
//   been     a map frozen in S.maps: its real ground, what the company knows of it, its levels
//   heard    a map a living member has a name of (a.lore.p): the name it has heard and no more. Never its ground, levels or other names.
//   unknown  everything else, built or planned: an outline and the word Uncharted. The owner sees the world's shape; nobody sees its names.
// A road's name is shown once it leaves a land walked, or a member has heard it. C.road marks the road the company is making for.
// Nothing here opens a frozen map's contents: only the keys of S.maps are read, so what the DM left there (and DM notes, hero minds) never show.
// The screen covers the window from body, over the cinema view too, without moving anything under it: closing puts focus back and the page is as it was.
import {S} from '../sim/index.js';
import {MAP_ID,ZONES,zoneAt,EXITS} from '../world/map.js';
import {W,H} from '../world/tiles.js';
import {MAPS,WORLD_ID} from '../world/spec.js';
import {ATLAS} from '../data/worldmap.js';
import {members,leaderOf} from '../sim/company.js';
import {heroSprite,outlined} from '../render/sprites.js';
import {paintAtlas} from '../render/atlasart.js';
import {followedCompany,companyLabel} from './companyview.js';
import {ctl} from './controls.js';
import {patch,keyed} from './stable.js';
import {onWorld} from '../sim/kept.js';

const $=id=>document.getElementById(id);
const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
const setText=(n,v)=>{v=v==null?'':String(v);if(n._v!==v){n._v=v;n.textContent=v}};
const list=L=>L.length<2?L.join(''):L.slice(0,-1).join(', ')+' and '+L[L.length-1];
export const WORD={here:'The company is here',been:'Been there',heard:'Heard of',unknown:'Unknown'};
const STUB=34; // tiles a road runs on past its land when no land stands at its far end

// ---- what may be seen ----
// Is there more than one thing to look at? (The table's row, a road off the starter map, or a map left behind.)
export const worldMapReady=()=>!!ATLAS[WORLD_ID]||!!(MAPS[WORLD_ID]&&MAPS[WORLD_ID].exits||[]).length||!!S.maps;
const walkedOn=l=>l.state==='here'||l.state==='been';
const namesOn=sp=>[sp.name,...(sp.towns||[]).map(t=>t.name),...(sp.regions||[]).map(r=>r.name),...(sp.landmarks||[]).map(l=>l.name)].filter(Boolean);
const bandOf=sp=>{const L=(sp.regions||[]).map(r=>r.band).filter(Boolean);return L.length?[Math.min(...L.map(b=>b[0])),Math.max(...L.map(b=>b[1]))]:null};
// The rows, with any map the campaign stands on that the table does not place yet, so the company is never off the picture.
function rowsOf(plan){const rows=[...plan.lands],right=()=>Math.max(...rows.map(r=>r.x+(MAPS[r.id]?MAPS[r.id].size.w:r.w||0)));
  for(const id of [MAP_ID,...Object.keys(S.maps||{})])if(MAPS[id]&&!rows.some(r=>r.id===id))rows.push({id,x:rows.length?right()+60:0,y:rows.length?rows[0].y:0});return rows}
function landOf(r,knows){const sp=MAPS[r.id]||null,size=sp?sp.size:r,heard=sp?namesOn(sp).filter(knows):[],state=r.id===MAP_ID?'here':sp&&S.maps&&S.maps[r.id]?'been':heard.length?'heard':'unknown',
    l={id:r.id,x:r.x,y:r.y,w:size.w,h:size.h,state,label:'Uncharted',known:[],spots:[]};
  if(state==='unknown')return l;
  l.label=state==='heard'&&!knows(sp.name)?heard[0]:sp.name;l.known=heard.filter(n=>n!==l.label);
  if(state==='heard')return l;
  l.blurb=sp.blurb||'';l.band=bandOf(sp);
  l.spots=[...(sp.towns||[]).map(t=>({name:t.name,kind:'town',x:r.x+t.x0+t.w/2,y:r.y+t.y0+t.h/2})),...(sp.landmarks||[]).map(m=>({name:m.name,kind:'place',x:r.x+m.x,y:r.y+m.y}))].filter(s=>knows(s.name));return l}

const exitsOf=id=>MAPS[id]&&MAPS[id].exits||[];
function exitPt(l,e){const sp=MAPS[l.id];if(e.at)return {x:l.x+e.at.x,y:l.y+e.at.y};const g=e.edge,m=(g.from+g.to)/2;
  return g.side==='N'?{x:l.x+m,y:l.y}:g.side==='S'?{x:l.x+m,y:l.y+sp.size.h}:g.side==='W'?{x:l.x,y:l.y+m}:{x:l.x+sp.size.w,y:l.y+m}}
// Where the line from a land's middle towards p leaves it.
function rim(l,p){const cx=l.x+l.w/2,cy=l.y+l.h/2,dx=p.x-cx,dy=p.y-cy,t=Math.min(dx?l.w/2/Math.abs(dx):1e9,dy?l.h/2/Math.abs(dy):1e9);return {x:cx+dx*t,y:cy+dy*t}}
const mid=l=>({x:l.x+l.w/2,y:l.y+l.h/2});
const OUT={N:[0,-1],S:[0,1],E:[1,0],W:[-1,0]};
function roadOf(A,B,e,knows,active){const fe=e&&B&&e.to&&e.to.exit?exitsOf(B.id).find(x=>x.id===e.to.exit):null,pa=e?exitPt(A,e):rim(A,mid(B)),dir=e&&e.edge?OUT[e.edge.side]:[1,0],
    pb=B?(fe?exitPt(B,fe):rim(B,pa)):{x:pa.x+dir[0]*STUB,y:pa.y+dir[1]*STUB},walked=[A,B].filter(l=>l&&walkedOn(l)).length,open=!!B&&!!MAPS[A.id]&&!!MAPS[B.id],
    name=e&&(walked||knows(e.name))?e.name:null,seen=walked||!!name;
  return {k:A.id+'>'+(B?B.id:e.id),a:A.id,b:B?B.id:null,pa,pb,name,back:name&&fe&&walkedOn(B)?fe.name:name,to:e&&e.to&&e.to.heard&&!open?e.to.heard:null,active:!!e&&A.id===MAP_ID&&active===e.id,state:walked>1?'walked':!seen?'faint':open?'known':'closed'}}
function roadsOf(plan,lands,knows,active){const at=id=>lands.find(l=>l.id===id),out=[],pair=new Set(),used=new Set(),seen=(a,b)=>{const k=[a,b].sort().join('+');if(pair.has(k))return true;pair.add(k);return false};
  for(const r of plan.roads||[]){const A=at(r.from),B=at(r.to);if(!A||!B||seen(A.id,B.id))continue;const e=r.exit?exitsOf(A.id).find(x=>x.id===r.exit):null;if(e)used.add(A.id+'/'+e.id);out.push(roadOf(A,B,e,knows,active))}
  for(const A of lands)for(const e of exitsOf(A.id)){if(used.has(A.id+'/'+e.id))continue;const B=e.to&&at(e.to.map);if(B?!seen(A.id,B.id):!(e.to&&e.to.map))out.push(roadOf(A,B||null,e,knows,active))}
  return out}
function boxOf(plan,lands,roads){const P=plan.pad==null?30:plan.pad,xs=[...lands.flatMap(l=>[l.x,l.x+l.w]),...roads.map(r=>r.pb.x)],ys=[...lands.flatMap(l=>[l.y,l.y+l.h]),...roads.map(r=>r.pb.y)],x=Math.floor(Math.min(...xs)-P),y=Math.floor(Math.min(...ys)-P);
  return {x,y,w:Math.ceil(Math.max(...xs)+P)-x,h:Math.ceil(Math.max(...ys)+P)-y}}
function roadLine(C){const R=C&&C.road,e=R&&EXITS.find(x=>x.id===R.exit);if(!e)return '';
  return (R.phase==='table'?'At '+e.name+', deciding':R.phase==='go'?'Taking '+e.name:'Making for '+e.name)+(R.bound?', bound for '+R.bound:'')+(R.hold?', held up at the road':'')}
// All the screen shows, as plain data: nothing is read past this function.
export function atlasView(){const plan=ATLAS[WORLD_ID]||{lands:[{id:WORLD_ID,x:0,y:0}]},C=followedCompany(),who=C?members(C):[],knows=n=>who.some(a=>a.town===n||a.lore&&a.lore.p&&a.lore.p[n]);
  const lands=rowsOf(plan).map(r=>landOf(r,knows)),roads=roadsOf(plan,lands,knows,C&&C.road&&C.road.exit),here=lands.find(l=>l.id===MAP_ID),ld=C?leaderOf(C)||who[0]:null;
  for(const l of lands)if(l.state==='heard')l.who=who.filter(a=>[l.label,...l.known].some(n=>a.lore&&a.lore.p&&a.lore.p[n])).map(a=>a.name);
  return {lands,roads,box:boxOf(plan,lands,roads),company:C?{name:companyLabel(C),region:ld?ZONES[zoneAt(ld.x,ld.y)]||'':'',road:roadLine(C)}:null,
    marker:ld&&here?{id:ld.id,hero:ld,x:here.x+ld.x/W*here.w,y:here.y+ld.y/H*here.h}:null}}

// ---- the screen ----
let root=null,stage=null,board=null,art=null,marks=null,side=null,clock=null,note=null,marker=null,face=null,tag=null,on=false,backTo=null,sel=null,sigMarks='',sigSide='',sigArt='',faceOf=null,box=null;
export const worldMapOn=()=>on;
// Another map (#1013 slice 4). atlasView reads the live bindings; what this screen keeps is the land picked and its signatures. Cleared only: the hook runs mid-crossing, with the far map not yet unpacked, and the next tick draws.
onWorld(()=>{if(on)sel=MAP_ID;sigMarks=sigSide=sigArt='';box=null;faceOf=null});
const pct=(v,b0,b1)=>((v-b0)/b1*100).toFixed(3)+'%';
const at=(n,x,y)=>{n.style.left=pct(x,box.x,box.w);n.style.top=pct(y,box.y,box.h);return n};
function landEl(l){const b=keyed(el('button','wmland s-'+l.state+(l.id===sel?' sel':'')),l.id);b.type='button';b.dataset.land=l.id;b.setAttribute('aria-label',l.label+': '+WORD[l.state]);b.setAttribute('aria-pressed',String(l.id===sel));
  at(b,l.x,l.y);b.style.width=(l.w/box.w*100).toFixed(3)+'%';b.style.height=(l.h/box.h*100).toFixed(3)+'%';
  const n=el('span','wmname',l.label);if(l.band)n.append(el('span','wmband',' '+l.band.join('-')));b.append(n);return b}
function fillMarks(host,v){for(const l of v.lands)host.append(landEl(l));
  for(const l of v.lands)for(const s of l.spots)host.append(at(keyed(el('span','wmspot '+s.kind,s.name),l.id+'/'+s.name),s.x,s.y));
  for(const r of v.roads)if(r.name)host.append(at(keyed(el('span','wmroad'+(r.active?' active':''),r.name),r.k),(r.pa.x+r.pb.x)/2,(r.pa.y+r.pb.y)/2))}
function fillSide(host,v){const l=v.lands.find(x=>x.id===sel)||v.lands.find(x=>x.id===MAP_ID);
  const co=keyed(el('section','wmsec'),'co');co.append(el('h3',null,'The company'));
  if(v.company){co.append(el('div','wmbig',v.company.name),el('div','dm',[v.lands.find(x=>x.id===MAP_ID).label,v.company.region].filter(Boolean).join(' · ')));if(v.company.road)co.append(el('div','wmgo',v.company.road))}else co.append(el('div','dm','No company in this world.'));
  const d=keyed(el('section','wmsec'),'land');d.append(el('h3',null,'This land'),el('div','wmbig',l.label),el('div','wmstate s-'+l.state,WORD[l.state]));
  if(l.band)d.append(el('div','dm','Levels '+l.band.join(' to ')));
  if(l.blurb)d.append(el('p','wmtext',l.blurb));
  if(l.state==='unknown')d.append(el('p','wmtext','Nobody in the company has heard of this land.'));
  if(l.state==='heard'){d.append(el('p','wmtext','A name and no more: nobody in the company has walked it.'));if(l.who&&l.who.length)d.append(el('div','dm','Heard by '+list(l.who)))}
  const spots=l.spots.map(s=>s.name);if(spots.length)d.append(el('div','dm','Known here: '+list(spots)));if(l.state==='heard'&&l.known.length)d.append(el('div','dm','Also heard of: '+list(l.known)));
  const name=id=>{const x=v.lands.find(y=>y.id===id);return x&&x.state!=='unknown'?x.label:null},rs=v.roads.filter(r=>r.name&&(r.a===l.id||r.b===l.id));
  if(rs.length){const ul=el('ul','wmroads');for(const r of rs){const far=name(r.a===l.id?r.b:r.a);ul.append(keyed(el('li',null,(r.a===l.id?r.name:r.back)+', to '+(r.to||far||'lands unknown')),r.k))}d.append(ul)}
  host.append(co,d)}
const KEY=[['here','The company is here'],['been','Been there'],['heard','Heard of'],['unknown','Unknown']],ROADKEY=[['walked','Road walked'],['known','Road known'],['closed','Road, far end not reached'],['faint','Road not known']];
function keyEl(){const s=el('section','wmsec');s.append(el('h3',null,'Key'));const ul=el('ul','wmkey');for(const [c,t] of KEY){const li=el('li');li.append(el('i','wsw s-'+c),t);ul.append(li)}
  for(const [c,t] of ROADKEY){const li=el('li');li.append(el('i','wsr r-'+c),t);ul.append(li)}s.append(ul);return s}
function build(){root=el('div','wmap');root.id='worldmap';root.hidden=true;root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-labelledby','wmTitle');
  const head=el('div','wmhead'),h=el('h2',null,'World map');h.id='wmTitle';clock=el('span','wmclock');note=el('span','wmnote');note.setAttribute('aria-live','polite');const x=el('button',null,'Close · Esc');x.type='button';x.id='wmClose';x.addEventListener('click',closeWorldMap);
  head.append(h,el('span','dm','What the company has walked and heard of. The world goes on behind this.'),clock,note,x);
  stage=el('div','wmstage');board=el('div','wmboard');art=el('canvas','wmart');art.setAttribute('aria-hidden','true');marks=el('div','wmmarks');
  marker=el('div','wmco');marker.setAttribute('aria-hidden','true');face=el('canvas','wmface');tag=el('span','wmtag');marker.append(face,tag);board.append(art,marks,marker);stage.append(board);
  const col=el('div','wmcol');side=el('div','wminfo');col.append(side,keyEl());const body=el('div','wmbody');body.append(stage,col);root.append(head,body);document.body.append(root);
  const pick=e=>{const t=e.target&&e.target.closest?e.target.closest('[data-land]'):null;if(t&&t.dataset.land!==sel){sel=t.dataset.land;refresh()}};
  marks.addEventListener('click',pick);marks.addEventListener('focusin',pick);
  root.addEventListener('keydown',trapKeys);if(window.addEventListener)window.addEventListener('resize',()=>{if(on)fit()});return true}
// Whole-number scaling keeps every tile square; a window too small for double size takes what it can get.
function fit(){if(!box)return;const w=stage.clientWidth||box.w,h=stage.clientHeight||box.h,f=Math.min(w/box.w,h/box.h),k=f>=2?Math.floor(f):f;board.style.width=Math.floor(box.w*k)+'px';board.style.height=Math.floor(box.h*k)+'px'}
function moveMarker(v){const m=v.marker;marker.hidden=!m;if(!m)return;at(marker,m.x,m.y);setText(tag,v.company.name);
  if(faceOf!==m.id){faceOf=m.id;try{const sp=outlined(heroSprite(m.hero,false,0)),x=face.getContext('2d');face.width=sp.width;face.height=sp.height;x.imageSmoothingEnabled=false;x.drawImage(sp,0,0)}catch(e){}}}
function refresh(){if(!on)return;const v=atlasView(),b=JSON.stringify(v.box);if(!box||JSON.stringify(box)!==b){box=v.box;sigMarks='';fit()}
  const sa=JSON.stringify([v.box,v.lands.map(l=>[l.id,l.state]),v.roads.map(r=>[r.k,r.state,r.active])]);if(sa!==sigArt){sigArt=sa;paintAtlas(art,v)}
  const sm=JSON.stringify([sel,v.lands.map(l=>[l.id,l.state,l.label,l.band,l.spots]),v.roads.map(r=>[r.k,r.name,r.active])]);if(sm!==sigMarks&&patch(marks,h=>fillMarks(h,v),{anchor:false}))sigMarks=sm;
  const ss=JSON.stringify([sel,v.company,v.lands,v.roads.map(r=>[r.k,r.name,r.to])]);if(ss!==sigSide&&patch(side,h=>fillSide(h,v),{anchor:false}))sigSide=ss;
  moveMarker(v);const t=$('clock');setText(clock,t?t.textContent:'');setText(note,ctl.held?'The world is held: close this to answer.':ctl.speed===0?'Paused':'')}
const syncBtns=()=>{const r=worldMapReady();for(const id of ['vAtlas','cinAtlas']){const b=$(id);if(b&&b.hidden===r)b.hidden=!r}const b=$('vAtlas');if(b)b.setAttribute('aria-pressed',String(on))};

export function openWorldMap(){if(on||!worldMapReady()||(!root&&!build()))return false;backTo=document.activeElement;on=true;sel=MAP_ID;root.hidden=false;document.body.classList.add('wmopen');sigMarks=sigSide='';refresh();fit();syncBtns();const x=$('wmClose');if(x&&x.focus)x.focus();return true}
export function closeWorldMap(){if(!on)return false;on=false;root.hidden=true;document.body.classList.remove('wmopen');syncBtns();if(backTo&&backTo.focus)backTo.focus();backTo=null;return true}
export const toggleWorldMap=()=>on?closeWorldMap():openWorldMap();
// The 1 s tick: only while open, and only what changed. The button follows the world (a map left behind, a new campaign).
export function renderWorldMap(){syncBtns();refresh()}

// Tab stays on the screen; the arrows walk the lands.
function trapKeys(e){const all=[...root.querySelectorAll('button')].filter(b=>!b.hidden);if(e.key==='Tab'&&all.length){const i=all.indexOf(document.activeElement),n=(i+(e.shiftKey?all.length-1:1))%all.length;e.preventDefault();all[i<0?0:n].focus();return}
  if(!/^Arrow/.test(e.key||''))return;const L=[...marks.querySelectorAll('[data-land]')],i=L.indexOf(document.activeElement),n=(i+(/Right|Down/.test(e.key)?1:L.length-1))%L.length;if(L.length){e.preventDefault();L[i<0?0:n].focus()}}
// M anywhere but in a form control or behind the title and setup pages. While the screen is open it has the keys: Esc shuts it and nothing else,
// so the cinema view underneath stays, and the keys of the view under it do not act unseen.
export function worldMapKey(e){if(e.ctrlKey||e.altKey||e.metaKey)return false;const k=e.key;if(on&&k==='Escape')return closeWorldMap();
  if(on&&(k==='c'||k==='C'||/^[1-9]$/.test(k||'')))return true;if(e.repeat||(k!=='m'&&k!=='M'))return false;
  const t=e.target,tn=t&&t.tagName?String(t.tagName).toUpperCase():'';if(tn==='INPUT'||tn==='TEXTAREA'||tn==='SELECT'||(t&&(t.isContentEditable||t.contentEditable==='true')))return false;
  for(const id of ['title','setup']){const o=$(id);if(o&&!o.hidden)return false}
  return toggleWorldMap()||on}
// Call before initCinema: both listen in the capture phase, and Esc here must not reach the cinema view.
export function initWorldMap(){const b=$('vAtlas');if(b)b.addEventListener('click',()=>toggleWorldMap());syncBtns();
  document.addEventListener('keydown',e=>{if(worldMapKey(e)){e.preventDefault();e.stopPropagation();if(e.stopImmediatePropagation)e.stopImmediatePropagation()}},true)}
