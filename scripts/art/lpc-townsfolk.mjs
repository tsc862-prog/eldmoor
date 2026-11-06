// Townsfolk sheets from the Universal LPC Spritesheet Character Generator's layers (#832, epic #830), on the #809 pipeline.
//
//   node scripts/art/lpc-townsfolk.mjs [--out DIR] [--only innkeeper,smith] [--credits] [--index] [--credits-md FILE]
//
// One 96x192 sheet (32x48 frames, 3 columns, rows down, left, right, up) for every role of data/npcs.js (NPC_ROLES and WANDER_ROLES) and every people of
// data/races.js: `sprite:npc-<role>-<people>`, so the roles are read from the sim's tables and never listed here, and a Warband town's
// folk have their heroes' green skin and orc heads. The choices (clothes per role) are in scripts/art/lpc-townsfolk.json; the people's
// head, skin and hair come from lpc-heroes.json (the same looks as the heroes of that people). Layers, licence gate (CC-BY-SA 3.0, OGA-BY
// 3.0 or CC0, else refused), tint and credits are scripts/art/lpc-heroes.mjs. Set ELDMOOR_PACKS to a packs folder outside the checkout.
// Licence of the result: CC-BY-SA 3.0. The index entries carry source, license, role, people, look and the layer folders used.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {encodePng} from './png.mjs';
import {sha256,fileOf} from './lib.mjs';
import {RACES} from '../../src/data/races.js';
import {NPC_ROLES,WANDER_ROLES} from '../../src/data/npcs.js';
import {CONFIG as HEROES,buildClass,sheetOf,peopleLook,creditLines} from './lpc-heroes.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
export const CONFIG=path.join(ROOT,'scripts','art','lpc-townsfolk.json');
const SIM_ROLES=[...NPC_ROLES,...WANDER_ROLES]; // the town roles and the DM-placed wanderers
const LICENCE='CC-BY-SA 3.0';

// A role's layers for one faction: a `fac` layer only for its faction, a variant object {fac: variant} resolved.
export function roleLayers(rc,fac){return rc.layers.filter(L=>L.fac===undefined||L.fac===fac).map(L=>({...L,variant:L.variant&&typeof L.variant==='object'?L.variant[fac]:L.variant}))}

export function main(argv=process.argv.slice(2)){
  const o={};for(let i=0;i<argv.length;i++){const a=argv[i];if(a==='--out')o.out=argv[++i];else if(a==='--only')o.only=argv[++i].split(',');else if(a==='--credits')o.credits=true;else if(a==='--index')o.index=true;else if(a==='--credits-md')o.md=argv[++i]}
  const cfg=JSON.parse(fs.readFileSync(CONFIG,'utf8')),hero=JSON.parse(fs.readFileSync(HEROES,'utf8')),out=o.out||path.join(ROOT,'assets','sprite','32'),all=[],made=[];
  const ROLES=[...SIM_ROLES,...(cfg.renderOnly||[]).map(id=>({id}))]; // renderOnly: figures the renderer draws that the sim never staffs (the town guards of townlife.js)
  for(const R of ROLES)if(!cfg.roles[R.id])throw new Error('lpc-townsfolk.json: role '+R.id+' (data/npcs.js) has no look');
  for(const id of Object.keys(cfg.roles))if(!ROLES.some(R=>R.id===id))throw new Error('lpc-townsfolk.json: '+id+' is not a role of data/npcs.js');
  for(const R of ROLES){if(o.only&&!o.only.includes(R.id))continue;
    for(const race of RACES){
      const look=peopleLook(hero,race.id),rc=cfg.roles[R.id],built=buildClass(R.id,{body:rc.body,skin:look.skin,layers:roleLayers(rc,race.fac)},look);all.push(built.credits);
      const sh=sheetOf(built,rc.frame?{...hero,frames:{...hero.frames,...rc.frame}}:hero),buf=encodePng(sh),id='sprite:npc-'+R.id+'-'+race.id,file='npc-'+R.id+'-'+race.id+'.png';
      fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,file),buf);made.push({id,role:R.id,race:race.id,file,sh,buf,credits:built.credits,look});console.log('[lpc]',id,'->',file)}}
  if(o.credits)console.log(creditLines(all).join('\n'));
  if(o.md&&made.length){const B='<!-- lpc-townsfolk:begin -->',E='<!-- lpc-townsfolk:end -->',t=fs.readFileSync(o.md,'utf8'),a=t.indexOf(B),z=t.indexOf(E);
    if(a<0||z<0)throw new Error('markers missing in '+o.md);fs.writeFileSync(o.md,t.slice(0,a+B.length)+'\n'+creditLines(all).join('\n')+'\n'+t.slice(z))}
  if(o.index&&made.length){const ip=path.join(ROOT,'assets','index.json'),idx=JSON.parse(fs.readFileSync(ip,'utf8'));
    for(const m of made){const key=m.id+'@32';
      idx.assets[key]={id:m.id,kind:'sprite',people:m.race,role:m.role,look:m.look,file:fileOf(m.id,32),w:m.sh.w,h:m.sh.h,sha256:sha256(m.buf),tier:32,source:'lpc-generator',license:LICENCE,credits:'docs/CREDITS.md#lpc-townsfolk-sheets',layers:m.credits.map(c=>c.file).sort(),accepted:new Date().toISOString().slice(0,10)}}
    idx.assets=Object.fromEntries(Object.keys(idx.assets).sort().map(k=>[k,idx.assets[k]]));fs.writeFileSync(ip,JSON.stringify(idx,null,2)+'\n')}
  return made}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
