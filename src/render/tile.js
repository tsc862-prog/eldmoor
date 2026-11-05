// The renderer's tile size (#177, owner decision 2026-11-03: render at 32 px tiles now, a cheap path to 64 later).
// Pure numbers, no DOM, so Node tools (scripts/art) read the same values as the browser.
//
// Two sizes, kept apart on purpose:
//   TILE  art pixels per map tile: the terrain chunk canvases, the generated assets (assets/index.json `tier`) and the
//         sprite frames are drawn at this resolution. 32 now; flip it to 64 (and generate the 64 tier) to upgrade.
//   U     world units per map tile in the renderer's coordinate space: positions (x*U), the camera, label heights,
//         effects and the procedural pixel art (one procedural pixel = one unit). It never changes, so flipping TILE
//         moves nothing on screen but the art's detail. U equals world/tiles.js T (asserted below).
//   ART   art pixels per world unit (TILE/U): an asset of the current tier is drawn at its size / ART units.
// The sim, the map and its hash never see any of these.
import {T as WORLD_T} from '../world/tiles.js';

export const TIERS=[32,64];
export const TILE=32;
export const U=16;
export const ART=TILE/U;
if(WORLD_T!==U)throw new Error(`render/tile.js: world/tiles.js T is ${WORLD_T}, the renderer's unit U is ${U}`);
if(!TIERS.includes(TILE))throw new Error(`render/tile.js: TILE ${TILE} is not one of the tiers ${TIERS}`);

// Entities on the world map at the 32 tier are 32x48 art pixels (64x96 at 64): one tile wide, a tile and a half tall,
// whatever the tier. A sprite sheet is 3 frames (stand, step, other step) by 4 directions (down, left, right, up).
export const SPRITE_TILES=[1,1.5];
export const SHEET={cols:3,rows:4,dirs:['down','left','right','up']};
// The procedural pixel-string sprites (sprites.js, about 10x12 for a hero) are the fallback until generated sheets
// exist; on the world map they are drawn at this many units per pixel, so a hero stands as tall as a 32x48 frame.
export const PROC_SCALE=2;
// Height in units from an entity's feet to just above its head (procedural hero 12 px tall, scaled), for nameplates,
// bubbles, scene marks and the like.
export const HEAD=12*PROC_SCALE+5;

// Camera: the follow view shows about this many tiles across (re-base it when TILE goes to 64: the owner's note is
// that 64 px art reads best at about 53 tiles across a 3440 px screen).
export const FOLLOW_TILES=29;
// The follow view grows with the pane (#846): 29 tiles across up to FOLLOW_NARROW device px of canvas, FOLLOW_WIDE tiles
// from FOLLOW_FULL px (a 3440 screen's map pane is about 2350), eased between. The caller snaps the scale to whole art pixels.
export const FOLLOW_WIDE=40,FOLLOW_NARROW=1400,FOLLOW_FULL=2350;
export const followTiles=w=>FOLLOW_TILES+(FOLLOW_WIDE-FOLLOW_TILES)*Math.max(0,Math.min(1,(w-FOLLOW_NARROW)/(FOLLOW_FULL-FOLLOW_NARROW)));

// Pixel size of a manifest entry at a tier: entries give sizes per tier ({"32":[w,h],"64":[w,h]}).
export const sizeAt=(e,tier=TILE)=>(e&&e.sizes&&e.sizes[tier])||null;
