// Prompts for the brain relay (scripts/relay.mjs). Pure data and string builders, no
// network. Owned by brain-builder; voice notes agree with docs/LORE.md ("Minds").
// systemFor(kind, fac) returns the system prompt for one decision kind in the voice of
// a hero's faction. The relay sends it with a JSON schema (structured output), so the
// model only ever answers with a choice from the options the sim itself computed.

export const KINDS=['townPlan','cryptCall','fightOrFlee','say','persona','backstory','memory']; // closed set: the relay refuses any other kind
// Fellowship writing kinds (issue #68): one-time character work, not in-the-moment decisions.
// They use a writer's preamble instead of WORLD, a stronger model tier and a longer timeout (relay.mjs).
export const WRITE_KINDS=['persona','backstory','memory'];
// Kinds that answer from a closed list of options the sim sends (snapshot.options).
export const OPTION_KINDS=['townPlan','fightOrFlee'];

// One voice per faction index (data/factions.js FAC order). Unknown factions get DEFAULT_VOICE.
export const VOICE=[
  'Voice: Concord. Formal, dry, understated; a sentence that sounds like a ledger entry with a pulse. No slang, no exclamation marks.',
  'Voice: Warband. Blunt, short, rough; says it plain and moves on. Dark humour is fine, ornament is not.',
];
export const DEFAULT_VOICE='Voice: plain and brief.';

const WORLD=[
  'You are one hero in Eldmoor, a small fantasy world, deciding what your character does next. Stay in character.',
  'Hardcore rules: you have one life. If you die you are gone for good and a stranger takes your place. You know only what is in the snapshot: you cannot see other heroes beyond the ranges it lists.',
  'Never mention being an AI, a model, a prompt, a game, a player or a simulation.',
].join(' ');

// The "reason" field (issue #61): why, in the hero's own words, shown in the Mind tab.
const REASON='"reason" is one plain sentence in your own voice saying why (under 20 words, no quotes, no numbers from the snapshot).';

const KIND={
  townPlan:'Decision: you are in town about to set out. Pick "choice", exactly one string from snapshot.options (the hunting zones open to you). Prefer the zone matching your level; drop a zone lower only if you are hurt, poorly geared, grieving or cautious by nature. If snapshot.leadParty is true you lead a party and choose for all of you; the options already suit its weakest member. Set "crypt" true if you would answer a call to join a group for the Sunken Crypt (only worthwhile when snapshot.cryptOpen is true and you are strong or oath-bound), otherwise false. '+REASON,
  cryptCall:'Decision: you are in town about to set out with your party; your party leader (snapshot.leader) chooses where you hunt, so that is not yours to decide. Set "crypt" true if you would answer a call to join a group for the Sunken Crypt (worthwhile when you are strong or oath-bound), otherwise false. '+REASON,
  fightOrFlee:'Decision: you are mid-fight against a monster stronger than you and you are below half health. Pick "choice": "fight" to stand your ground or "flee" to break off and go home. Weigh your health, the monster\'s level, whether a priest or party stands with you, and your nature. Fleeing is not shameful; dying is final. "line" is a few words you shout as you decide (under 12 words, no quotes). '+REASON,
  say:'Task: write one short line your hero says aloud for the situation in snapshot.trigger (snapshot.ctx has details). Under 14 words, one sentence, no quotes, no emoji, no stage directions. Do not name specific people, monsters or items, so the line stays true if it is spoken a little later. Put it in "line".',
};

// ---- Fellowship writing kinds (issue #68) ----
// The snapshot is a fact sheet built by src/sim/persona.js or src/sim/memory.js from sim data
// only: the hero's people, home hamlet, trade, class, role, traits, oath, history, bonds,
// nemesis, real places and real living foes. The model may colour these facts but never invent
// a different world: no new towns, gods, kings or wars, and no names beyond the sheet.
const WRITER=[
  'You write character material for one hero of Eldmoor, a small, gritty fantasy world. Original setting: use only the places, peoples, monsters and people named in the fact sheet (the user message, JSON), plus plain common nouns (a mill, a ford, a pit, a shrine).',
  'Hardcore world: every hero has one life. Ground everything in the facts given; you may add small human detail (a smell, a habit, a debt) but never new named places, rulers, gods, wars or heroes.',
  'Write in plain modern English with a little period colour. Never mention being an AI, a model, a prompt, a game, a player or a simulation.',
].join(' ');
const WKIND={
  persona:'Task: a persona sheet the hero is played from. "voice": how they talk, one or two sentences (under 160 characters). "wants": what they want most, one sentence. "fears": what they fear most, one sentence. "quirk": one concrete habit or tic. "never_says": one short line, in quotes-free plain text, that this hero would never say aloud. "stances": for each companion in snapshot.companions, keyed by that companion’s id, one line (under 100 characters) on how this hero sees them, using the bond score, shared home, backstory link and history given. Every field is short; no lists, no line breaks.',
  backstory:'Task: a backstory in six short paragraphs (each 2-3 sentences, under 330 characters): "family" (family and home: the real hamlet, trade and people from the sheet), "arms" (how they came to arms and to their class), "defining" (one defining event tied to the living world: use snapshot.world.elite, snapshot.world.rival or snapshot.world.place by name), "flaw" (a flaw or a secret), "wants" (what they want and what they fear), "joined" (why they joined this Fellowship, snapshot.fellowship). Also one explicit tie to a companion: "link_hero" is the exact name of one hero in snapshot.companions (prefer snapshot.suggest_link if given), "link_kind" says what kind of tie, and "link" is one or two sentences naming them (an old debt, a shared hometown, a rivalry, kin, a rescue or an oath). "summary" is one sentence (under 200 characters) that sums the hero up for a stranger.',
  memory:'Task: compress the hero’s memories into one long-term summary, first person, in the hero’s own voice (snapshot.voice). Keep what matters for the future: deaths of companions, debts and grudges, who saved whom, oaths, big wins and losses, names of foes still living. Merge snapshot.long (older summary) with snapshot.items (newer memories, oldest first). "long" is at most six sentences, under 700 characters, no lists, no line breaks.',
};

export function systemFor(kind,fac){
  if(WKIND[kind])return WRITER+'\n'+(VOICE[fac]||DEFAULT_VOICE)+' (This is the hero’s faction voice; let it colour their speech and outlook.)\n'+WKIND[kind]+'\nAnswer only with the JSON object the schema asks for.';
  if(!KIND[kind])throw new Error('unknown brain kind '+kind);
  return WORLD+'\n'+(VOICE[fac]||DEFAULT_VOICE)+'\n'+KIND[kind]+'\nAnswer only with the JSON object the schema asks for.'+(OPTION_KINDS.includes(kind)?' Choose only from the options given.':'')}

// Prompt version: bump when any system text or schema changes, so a logged prompt can be
// matched to the code that built it (the relay echoes it as sent.id, e.g. "townPlan@2").
export const PROMPT_VERSION=4; // 3: leadParty note in townPlan, cryptCall kind for party followers; 4: persona, backstory, memory kinds (#68)
export const promptId=kind=>kind+'@'+PROMPT_VERSION;

// Output token caps per kind (the relay passes them as max_tokens). townPlan and
// fightOrFlee have room for the reason sentence (about 30 tokens) on top of the choice.
export const MAX_TOKENS={townPlan:110,cryptCall:90,fightOrFlee:130,say:60,persona:1200,backstory:2400,memory:500};
export const REASON_MAX=120; // characters kept after validation
// A reason is optional: one line of plain text, at most REASON_MAX characters, or null.
// Shared by the relay and the sim so both apply the same rule.
export const cleanReason=v=>{if(typeof v!=='string')return null;
  const t=v.replace(/[\u0000-\u001f<>]/g,' ').replace(/\s+/g,' ').trim();return t?t.slice(0,REASON_MAX).trim():null};

// Fellowship writing kinds: field names and the character cap each is cut to after validation
// (the relay and the sim both apply cleanText, so a long answer is trimmed, never rejected).
export const PERSONA_FIELDS={voice:200,wants:200,fears:200,quirk:160,never_says:140};
export const STANCE_MAX=120;
export const BACKSTORY_FIELDS={family:420,arms:420,defining:420,flaw:420,wants:420,joined:420,link:300,summary:220};
export const LINK_KINDS=['debt','hometown','rivalry','kin','rescue','oath'];
export const MEMORY_LONG_MAX=800;
export const cleanText=(v,n)=>{if(typeof v!=='string')return null;
  const t=v.replace(/[\u0000-\u001f<>]/g,' ').replace(/\s+/g,' ').trim();return t?t.slice(0,n).trim():null};

// JSON schema for one kind; options is the closed set the sim offered (snapshot.options);
// snap is the whole snapshot (the writing kinds key stances and links by its companions).
export function schemaFor(kind,options,snap={}){
  const str=d=>({type:'string',description:d});
  const comps=Array.isArray(snap.companions)?snap.companions.filter(c=>c&&c.id!=null&&typeof c.name==='string'):[];
  if(kind==='persona'){const props={};for(const k in PERSONA_FIELDS)props[k]=str('Under '+PERSONA_FIELDS[k]+' characters.');const req=Object.keys(PERSONA_FIELDS);
    if(comps.length){const sp={};for(const c of comps)sp[String(c.id)]=str('How this hero sees '+c.name+', one line.');
      props.stances={type:'object',properties:sp,required:comps.map(c=>String(c.id)),additionalProperties:false};req.push('stances')}
    return{type:'object',properties:props,required:req,additionalProperties:false}}
  if(kind==='backstory'){const props={};for(const k in BACKSTORY_FIELDS)props[k]=str('Under '+BACKSTORY_FIELDS[k]+' characters.');const req=Object.keys(BACKSTORY_FIELDS);
    if(comps.length){props.link_hero={type:'string',enum:comps.map(c=>c.name)};props.link_kind={type:'string',enum:LINK_KINDS};req.push('link_hero','link_kind')}
    return{type:'object',properties:props,required:req,additionalProperties:false}}
  if(kind==='memory')return{type:'object',properties:{long:str('First person, under '+MEMORY_LONG_MAX+' characters.')},required:['long'],additionalProperties:false};
  const enumOf=o=>({type:'string',enum:o});
  // String length limits are not supported in structured-output schemas, so the length lives
  // in the description and the prompt, and both relay and sim truncate to REASON_MAX.
  const reason={type:'string',description:"Why, in one plain sentence in the hero's voice, under 120 characters."};
  if(kind==='townPlan')return{type:'object',properties:{choice:enumOf(options),crypt:{type:'boolean'},reason},required:['choice','crypt','reason'],additionalProperties:false};
  if(kind==='cryptCall')return{type:'object',properties:{crypt:{type:'boolean'},reason},required:['crypt','reason'],additionalProperties:false};
  if(kind==='fightOrFlee')return{type:'object',properties:{choice:enumOf(options),line:{type:'string'},reason},required:['choice','line','reason'],additionalProperties:false};
  if(kind==='say')return{type:'object',properties:{line:{type:'string'}},required:['line'],additionalProperties:false};
  throw new Error('unknown brain kind '+kind)}
