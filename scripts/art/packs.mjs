// Free art sets (#789): fetch the CC0 and LPC sets into assets/packs/<set>/ (gitignored, originals untouched, one
// folder per set so they also serve as style-LoRA material, #788) and print what the owner must drop in by hand.
//
//   node scripts/art/packs.mjs [--list] [--only a,b]
//
// Sets: kenney-tiny-town, kenney-tiny-dungeon, kenney-roguelike-rpg (CC0, kenney.nl: the page's own "Continue without
// donating" download flow, session cookie then /download-link, no browser needed), lpc-base (OpenGameArt, CC-BY-SA /
// GPL, see its credits), lpc-generator (github sanderfrenken/Universal-LPC-Spritesheet-Character-Generator: a blobless
// git clone, only the credits, the licences, sheet_definitions/ and the layer folders listed in LPC_PATHS; nothing in it
// is ever run or built), ninja-adventure (pixel-boy, CC0, itch: needs a browser click, so the owner drops the zip).
//
// Downloads are untrusted data: images, licence and credit files only, each archive extracted into its own new empty
// folder; nothing downloaded is executed.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {inflateRawSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
export const PACKS=path.join(ROOT,'assets','packs');
const UA='Mozilla/5.0 (Eldmoor art pipeline; owner-run)';

export const SETS={
  'kenney-tiny-town':{kind:'kenney',slug:'tiny-town',licence:'CC0 1.0',author:'Kenney (kenney.nl)',link:'https://kenney.nl/assets/tiny-town'},
  'kenney-tiny-dungeon':{kind:'kenney',slug:'tiny-dungeon',licence:'CC0 1.0',author:'Kenney (kenney.nl)',link:'https://kenney.nl/assets/tiny-dungeon'},
  'kenney-roguelike-rpg':{kind:'kenney',slug:'roguelike-rpg-pack',licence:'CC0 1.0',author:'Kenney (kenney.nl)',link:'https://kenney.nl/assets/roguelike-rpg-pack'},
  'lpc-base':{kind:'zip',url:'https://opengameart.org/sites/default/files/lpc_base_assets.zip',licence:'CC-BY-SA 3.0 / GPL 3.0 (per asset, see its credits)',author:'LPC contributors',link:'https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles'},
  'lpc-generator':{kind:'git',repo:'https://github.com/sanderfrenken/Universal-LPC-Spritesheet-Character-Generator.git',licence:'CC-BY-SA 3.0/4.0, GPL 3.0 or OGA-BY 3.0 (per asset, CREDITS.csv)',author:'LPC contributors (CREDITS.csv)',link:'https://github.com/sanderfrenken/Universal-LPC-Spritesheet-Character-Generator'},
  // LPC-compatible animals (epic #830): only sets offered under CC-BY-SA 3.0, OGA-BY 3.0 or CC0 (the licence each is used under is in scripts/art/lpc-critters.json).
  'lpc-cats-dogs':{kind:'files',urls:['cat_0.png','dog_2.png'],licence:'OGA-BY 3.0 / CC-BY-SA 3.0 / CC-BY 3.0 / GPL',author:'bluecarrot16',link:'https://opengameart.org/content/lpc-cats-and-dogs'},
  'lpc-rabbit':{kind:'files',urls:['rabbit_3.png'],licence:'OGA-BY 3.0 / CC-BY-SA 3.0 / CC-BY 3.0',author:'Stephen Challener (Redshrike), reorganised by Evert',link:'https://opengameart.org/content/reorganised-lpc-rabbit'},
  'lpc-birds':{kind:'files',urls:['bird_2_black.png','bird_2_white.png'],licence:'OGA-BY 3.0 / CC-BY-SA 3.0 / CC-BY / GPL',author:'bluecarrot16',link:'https://opengameart.org/content/lpc-birds'},
  'lpc-ram':{kind:'files',urls:['ram_walk.png'],licence:'CC-BY-SA 3.0 / GPL 3.0',author:'Evert',link:'https://opengameart.org/content/lpc-style-ram-male-sheep'},
  'chicken-sprites':{kind:'zip',url:'https://opengameart.org/sites/default/files/chicken.zip',licence:'CC0',author:'Shepardskin',link:'https://opengameart.org/content/chicken-sprites'},
  'wild-deer':{kind:'zip',url:'https://opengameart.org/sites/default/files/Deer_0.zip',licence:'CC0',author:'ScratchIO',link:'https://opengameart.org/content/animated-wild-animals'},
  'ninja-adventure':{kind:'hand',licence:'CC0 1.0',author:'pixel-boy (Pixel-boy and AAA)',link:'https://pixel-boy.itch.io/ninja-adventure-asset-pack',
    how:'Download "Ninja Adventure - Asset Pack" from the itch page (it needs a browser click) and drop the .zip into assets/packs/ninja-adventure/ ; run this script again to extract it.'}
};
// The only parts of the generator repo that are fetched (sparse, non-cone). Add a layer folder here to review more of it.
export const LPC_PATHS=['/CREDITS.csv','/LICENSE','/README.md','/cc-by-sa-3_0.txt','/gpl-3_0.txt','/sheet_definitions/',
  '/spritesheets/body/bodies/male/','/spritesheets/body/bodies/male.png','/spritesheets/body/bodies/female/','/spritesheets/body/bodies/female.png',
  '/spritesheets/head/heads/human/male/','/spritesheets/head/heads/human/female/','/spritesheets/head/heads/orc/','/spritesheets/hair/plain/','/spritesheets/hair/long/','/spritesheets/hair/ponytail/','/spritesheets/hair/long_messy/','/spritesheets/quiver/','/spritesheets/hair/braid/',
  '/spritesheets/torso/','/spritesheets/legs/pants/','/spritesheets/legs/armour/','/spritesheets/feet/boots/','/spritesheets/weapon/sword/','/spritesheets/weapon/blunt/','/spritesheets/weapon/ranged/','/spritesheets/weapon/magic/','/spritesheets/hat/','/spritesheets/weapon/polearm/'];

const empty=d=>!fs.existsSync(d)||fs.readdirSync(d).length===0;
const say=(...a)=>console.log('[packs]',...a);

// A small zip reader (stored and deflate entries only; no archive is ever executed). Entries that would land outside
// dir (zip-slip) are skipped.
function extract(zip,dir){
  if(!empty(dir))throw new Error(dir+' is not empty; extracting only into a new empty folder');
  fs.mkdirSync(dir,{recursive:true});
  const b=fs.readFileSync(zip);let e=b.length-22;while(e>=0&&b.readUInt32LE(e)!==0x06054b50)e--;
  if(e<0)throw new Error('not a zip: '+zip);
  const n=b.readUInt16LE(e+10);let p=b.readUInt32LE(e+16);const root=path.resolve(dir)+path.sep;let files=0;
  for(let i=0;i<n;i++){
    if(b.readUInt32LE(p)!==0x02014b50)throw new Error('bad zip directory');
    const method=b.readUInt16LE(p+10),csize=b.readUInt32LE(p+20),nl=b.readUInt16LE(p+28),xl=b.readUInt16LE(p+30),cl=b.readUInt16LE(p+32),off=b.readUInt32LE(p+42);
    const name=b.toString('utf8',p+46,p+46+nl);p+=46+nl+xl+cl;
    if(name.endsWith('/'))continue;
    const out=path.resolve(dir,name);if(!out.startsWith(root)){say('skipped unsafe entry',name);continue}
    const ln=b.readUInt16LE(off+26),lx=b.readUInt16LE(off+28),data=b.subarray(off+30+ln+lx,off+30+ln+lx+csize);
    fs.mkdirSync(path.dirname(out),{recursive:true});
    fs.writeFileSync(out,method===0?data:inflateRawSync(data));files++}
  say('extracted',files,'files into',path.relative(ROOT,dir))}

async function get(url,opts={}){const r=await fetch(url,{headers:{'user-agent':UA,...(opts.headers||{})},redirect:'follow'});if(!r.ok)throw new Error(url+' -> '+r.status);return r}

async function kenney(name,set){
  const dir=path.join(PACKS,name);
  if(!empty(dir)){say(name,'already there');return}
  // The page's own flow: load the asset page for its cookie, then /download-link/<hex of assets/slug> answers a signed URL.
  const page=await get(set.link);const cookie=(page.headers.getSetCookie?.()||[]).map(c=>c.split(';')[0]).join('; ');
  const id=Buffer.from('assets/'+set.slug).toString('hex');
  const j=await (await get('https://kenney.nl/download-link/'+id,{headers:{cookie,referer:set.link}})).json();
  if(!j.url)throw new Error('kenney gave no link for '+set.slug);
  const buf=Buffer.from(await (await get(j.url)).arrayBuffer());
  const tmp=path.join(PACKS,'_dl');fs.mkdirSync(tmp,{recursive:true});const zip=path.join(tmp,name+'.zip');fs.writeFileSync(zip,buf);
  extract(zip,dir);say(name,'fetched',buf.length,'bytes')}

async function plainZip(name,set){
  const dir=path.join(PACKS,name);
  if(!empty(dir)){say(name,'already there');return}
  const buf=Buffer.from(await (await get(set.url)).arrayBuffer());
  const tmp=path.join(PACKS,'_dl');fs.mkdirSync(tmp,{recursive:true});const zip=path.join(tmp,name+'.zip');fs.writeFileSync(zip,buf);
  extract(zip,dir);say(name,'fetched',buf.length,'bytes')}

// Single images off a set's page (OpenGameArt files), each into the set's own new folder.
async function plainFiles(name,set){
  const dir=path.join(PACKS,name);
  if(!empty(dir)){say(name,'already there');return}
  fs.mkdirSync(dir,{recursive:true});
  for(const f of set.urls){const buf=Buffer.from(await (await get('https://opengameart.org/sites/default/files/'+f)).arrayBuffer());fs.writeFileSync(path.join(dir,decodeURIComponent(f).replace(/[^\w.-]/g,'_')),buf);say(name,f,buf.length,'bytes')}}

function lpcGenerator(name,set){
  const dir=path.join(PACKS,name),repo=path.join(dir,'repo');
  fs.mkdirSync(dir,{recursive:true});
  const git=(args,cwd)=>execFileSync('git',args,{cwd,stdio:'inherit',env:{...process.env,MSYS_NO_PATHCONV:'1',GIT_TERMINAL_PROMPT:'0'}});
  if(fs.existsSync(path.join(repo,'.git'))){git(['sparse-checkout','set',...LPC_PATHS],repo);git(['checkout'],repo);say(name,'sparse paths refreshed');return}
  git(['clone','--filter=blob:none','--no-checkout','--depth','1',set.repo,repo],dir);
  git(['sparse-checkout','init','--no-cone'],repo);git(['sparse-checkout','set',...LPC_PATHS],repo);git(['checkout'],repo);
  say(name,'fetched (sparse)')}

function ninja(name,set){
  const dir=path.join(PACKS,name);fs.mkdirSync(dir,{recursive:true});
  const zips=fs.readdirSync(dir).filter(f=>/\.zip$/i.test(f));
  const out=path.join(dir,'pack');
  if(!empty(out)){say(name,'already there');return}
  if(!zips.length){say(name,'NEEDS YOU:',set.how,'\n  '+set.link);return 'hand'}
  extract(path.join(dir,zips[0]),out);say(name,'extracted',zips[0])}

export async function fetchSets(only){
  const miss=[];
  for(const [name,set] of Object.entries(SETS)){
    if(only&&!only.includes(name))continue;
    try{
      if(set.kind==='kenney')await kenney(name,set);
      else if(set.kind==='zip')await plainZip(name,set);
      else if(set.kind==='files')await plainFiles(name,set);
      else if(set.kind==='git')lpcGenerator(name,set);
      else if(ninja(name,set)==='hand')miss.push(name);
    }catch(e){say(name,'FAILED:',e.message);miss.push(name)}}
  return miss}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const a=process.argv.slice(2);
  if(a.includes('--list')){for(const [n,s] of Object.entries(SETS))console.log(n.padEnd(22),s.licence.padEnd(40),s.link);process.exit(0)}
  const oi=a.indexOf('--only'),only=oi>=0?a[oi+1].split(','):null;
  const miss=await fetchSets(only);
  if(miss.length){console.log('\n[packs] not fetched:',miss.join(', '));process.exitCode=1}}
