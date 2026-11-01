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

const KIND={
  townPlan:'Decision: you are in town about to set out. Pick "choice", exactly one string from snapshot.options (the hunting zones open to you). Prefer the zone matching your level; drop a zone lower only if you are hurt, poorly geared, grieving or cautious by nature. Set "crypt" true if you would answer a call to join a group for the Sunken Crypt (only worthwhile when snapshot.cryptOpen is true and you are strong or oath-bound), otherwise false.',
  fightOrFlee:'Decision: you are mid-fight against a monster stronger than you and you are below half health. Pick "choice": "fight" to stand your ground or "flee" to break off and go home. Weigh your health, the monster\'s level, whether a priest or party stands with you, and your nature. Fleeing is not shameful; dying is final. "line" is a few words you shout as you decide (under 12 words, no quotes).',
  say:'Task: write one short line your hero says aloud for the situation in snapshot.trigger (snapshot.ctx has details). Under 14 words, one sentence, no quotes, no emoji, no stage directions. Do not name specific people, monsters or items, so the line stays true if it is spoken a little later. Put it in "line".',
};

export function systemFor(kind,fac){
  if(!KIND[kind])throw new Error('unknown brain kind '+kind);
  return WORLD+'\n'+(VOICE[fac]||DEFAULT_VOICE)+'\n'+KIND[kind]+'\nAnswer only with the JSON object the schema asks for. Choose only from the options given.'}

// Output token caps per kind (the relay passes them as max_tokens).
export const MAX_TOKENS={townPlan:60,fightOrFlee:80,say:60};

// JSON schema for one kind; options is the closed set the sim offered (snapshot.options).
export function schemaFor(kind,options){
  const enumOf=o=>({type:'string',enum:o});
  if(kind==='townPlan')return{type:'object',properties:{choice:enumOf(options),crypt:{type:'boolean'}},required:['choice','crypt'],additionalProperties:false};
  if(kind==='fightOrFlee')return{type:'object',properties:{choice:enumOf(options),line:{type:'string'}},required:['choice','line'],additionalProperties:false};
  if(kind==='say')return{type:'object',properties:{line:{type:'string'}},required:['line'],additionalProperties:false};
  throw new Error('unknown brain kind '+kind)}
