---
name: crawl-view
description: #742 crawl as played in the dungeon view (render/crawlview.js): named spots, act->spot table, beats from sc.beats plus HP drops, close-up framing, staging a beat shot
metadata:
  type: project
---
- render/crawlview.js owns the live crawl room: crawlSpots(m,i,spec) (stair, back, front, flankL/R, cover, den in u/v along
  the way-in->den axis; the boss room is squared to its dais), ACT_SPOT, a beat queue fed by sc.beats and by members' HP
  falling (crawl foe blows are NOT beats in sim/crawl.js), the pops, and foeAt for hover. interior.js frames the room close
  up while it is live (frameOf, eased) and clips to the box; drawFoes/party line remain for non-crawl states.
- **Why:** owner (2026-11-03) could not see the Crypt fight: whole-map fit made a room ~200 px at 3440. Spots are the
  ids #744 will put in the crawl state; #745 gives them rules. Room spec `spots:{id:{u,v}}` is optional (none in spec.js yet).
- **How to apply:** stage a beat shot with a fake S.table {kind:'crawl', company, ids, acts, beats, ctx:{room}} plus
  CRYPT.group.crawl with co and foes, ctl.speed=0; set acts, draw frames by calling dungeonview.drawDungeon(performance.now()/1000)
  in a loop (the view needs continuous frames: a gap > .75 s is a cold open that skips beats), then push beats, lower foe
  and hero hp, set sc.phase='outcome'. Scratch driver pattern: [[previews]]. Run vite with cacheDir in the scratchpad
  (the default node_modules/.vite sits behind the junction in E:/eldmoor). See [[dungeon-view]].
