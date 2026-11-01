// Prompts for the brain relay (scripts/relay.mjs). Pure data and string builders, no
// network. Owned by brain-builder; voice notes agree with docs/LORE.md ("Minds").
// systemFor(kind, fac) returns the system prompt for one decision kind in the voice of
// a hero's faction. The relay sends it with a JSON schema (structured output), so the
// model only ever answers with a choice from the options the sim itself computed.

export const KINDS=['townPlan','fightOrFlee','say'];

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
  townPlan:'Decision: you are in town about to set out. Pick "choice", exactly one string from snapshot.options (the hunting zones open to you). Prefer the zone matching your level; drop a zone lower only if you are hurt, poorly geared, grieving or cautious by nature. Set "crypt" true if you would answer a call to join a group for the Sunken Crypt (only worthwhile when snapshot.cryptOpen is true and you are strong or oath-bound), otherwise false. '+REASON,
  fightOrFlee:'Decision: you are mid-fight against a monster stronger than you and you are below half health. Pick "choice": "fight" to stand your ground or "flee" to break off and go home. Weigh your health, the monster\'s level, whether a priest or party stands with you, and your nature. Fleeing is not shameful; dying is final. "line" is a few words you shout as you decide (under 12 words, no quotes). '+REASON,
  say:'Task: write one short line your hero says aloud for the situation in snapshot.trigger (snapshot.ctx has details). Under 14 words, one sentence, no quotes, no emoji, no stage directions. Do not name specific people, monsters or items, so the line stays true if it is spoken a little later. Put it in "line".',
};

export function systemFor(kind,fac){
  if(!KIND[kind])throw new Error('unknown brain kind '+kind);
  return WORLD+'\n'+(VOICE[fac]||DEFAULT_VOICE)+'\n'+KIND[kind]+'\nAnswer only with the JSON object the schema asks for. Choose only from the options given.'}

// Prompt version: bump when any system text or schema changes, so a logged prompt can be
// matched to the code that built it (the relay echoes it as sent.id, e.g. "townPlan@2").
export const PROMPT_VERSION=2;
export const promptId=kind=>kind+'@'+PROMPT_VERSION;

// Output token caps per kind (the relay passes them as max_tokens). townPlan and
// fightOrFlee have room for the reason sentence (about 30 tokens) on top of the choice.
export const MAX_TOKENS={townPlan:110,fightOrFlee:130,say:60};
export const REASON_MAX=120; // characters kept after validation
// A reason is optional: one line of plain text, at most REASON_MAX characters, or null.
// Shared by the relay and the sim so both apply the same rule.
export const cleanReason=v=>{if(typeof v!=='string')return null;
  const t=v.replace(/[\u0000-\u001f<>]/g,' ').replace(/\s+/g,' ').trim();return t?t.slice(0,REASON_MAX).trim():null};

// JSON schema for one kind; options is the closed set the sim offered (snapshot.options).
export function schemaFor(kind,options){
  const enumOf=o=>({type:'string',enum:o});
  // String length limits are not supported in structured-output schemas, so the length lives
  // in the description and the prompt, and both relay and sim truncate to REASON_MAX.
  const reason={type:'string',description:"Why, in one plain sentence in the hero's voice, under 120 characters."};
  if(kind==='townPlan')return{type:'object',properties:{choice:enumOf(options),crypt:{type:'boolean'},reason},required:['choice','crypt','reason'],additionalProperties:false};
  if(kind==='fightOrFlee')return{type:'object',properties:{choice:enumOf(options),line:{type:'string'},reason},required:['choice','line','reason'],additionalProperties:false};
  if(kind==='say')return{type:'object',properties:{line:{type:'string'}},required:['line'],additionalProperties:false};
  throw new Error('unknown brain kind '+kind)}
