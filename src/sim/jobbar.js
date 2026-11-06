// The level a posted job asks of a company (#1016): one reader for the gate (player.js jobFit), the opening's first move (arrival.js),
// the council's proposal check and the DM's post_hook note. Pure; no state, no dice.
import * as D from '../data/adventures.js';
import {K} from './dm.js';
export const jobBar=h=>{const T=D.ADVENTURES[h&&h.tpl];return Math.max(K.MIN_LVL,T&&T.lvl||0)};
// null when a company whose lowest member is level lo can take the job by level, else the level it needs.
export const jobShort=(h,lo)=>{const n=jobBar(h);return lo<n?n:null};
