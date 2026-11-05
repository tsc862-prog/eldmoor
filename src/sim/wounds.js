// Wounds, the numbers (#656, epic #626). A leaf module (no imports) so sim/stats.js and moveTo can read them without an import
// cycle; what makes and mends a wound is sim/tend.js. a.wounds = [{cause, day, days, at}]: who or what did it, the game day it
// was taken, the days it lasts (a tending takes one off) and the game minute it was taken, so it closes at at + days game days.
export const WOUND={
  DAYS:3,         // game days a wound lasts untended
  HP:.15,         // max HP lost per wound
  SPEED:.1,       // speed lost per wound: the swing timer (Speed) and the walk
  CAP:.3,         // no stack of wounds costs more than this share of either
  MIN_DAY:1440,   // game minutes in a day
  FEE:6,FEE_LVL:2,// the chapel priest's fee for a day off: FEE + FEE_LVL x the hero's level, in gold
  CHAPEL_R:3,     // tiles from the chapel a hero may ask the priest
  NEAR:4,         // tiles: whom a hero at the chapel may pay for
  MEND_AT:2,      // wounds at which a background hero stays in town to mend (state 'mend')
};
export const wounded=a=>!!(a&&a.wounds&&a.wounds.length);
export const woundHp=a=>wounded(a)?Math.min(WOUND.CAP,a.wounds.length*WOUND.HP):0;
export const woundSpeed=a=>wounded(a)?Math.min(WOUND.CAP,a.wounds.length*WOUND.SPEED):0;
export const woundEnd=w=>w.at+w.days*WOUND.MIN_DAY; // the game minute a wound closes
