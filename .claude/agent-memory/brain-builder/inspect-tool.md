---
name: inspect-tool
description: #425 hero tool inspect {who} - resolution order (sight tiers, pack, worn, catalogue), what each kind shows and hides, channel rule; shop brief default + tradePrice
metadata:
  type: project
---

`inspect {who}` (src/sim/player.js `inspectView`, `inSight`, `heroLook`/`personLook`/`creatureLook`/`itemLook`; schema in
player-tools.js, `who` required; handler also takes `target`/`item` aliases). Read only.

- Resolution: me/self -> own hero view; an id ("5", "#5", "id 5") -> only things in sight; then names over `inSight(a)`
  (look's rule: sight radius, whole home town when state town; heroes, S.npcs + S.wanderers, mobs by `foeName`) in tiers
  exact > first word/role/title > startsWith > includes (3+ chars). Several *people* in one tier -> ambiguity refusal;
  creatures of one name -> nearest. Then `packFind(a,s,'Inspect')` (verb param added), worn by slot or name, then the
  catalogue (USES, GOODS, QUEST_ITEMS). Refusal always lists up to 8 things in sight.
- Shows: hero = race+class+level (look already shows level), side, guild, Fellowship role label, HURT word (unhurt,
  lightly hurt, hurt, badly hurt, near death), doing word, worn gear names (+quality), to_you (party, own blood debt
  a.nemesis, spoken with = talk.js metIds). Person = role, side, doing (post/walk/home/errand), mood only if hostile, or
  p.fmem.talks>0, or the other side; trade open. Never p.fmem.notes, want, warmth, attitude, att, lever.
  Creature = mobView + HURT + loreView(a,what) known lines. Items = itemText, SELL_VALUE, wearable, USES lines/flavour/price,
  GOODS `price()` now.
- channelcheck: inspect B beside A, the npc holding the planted npcRecord, every wanderer, the numbered beast.

#425 also: talk.js exports `tradePrice(p,base)` (npcBuy uses it; shop's traderPrice too - the old npcBuy-refusal parse
is gone). `shop` is brief by default (gear only better/mixed lines, buyable supplies, first `does` clause; ~1.4k vs
~3.1k chars); `shop {all:"yes"}` is the old full list. MCP zod has no boolean: use a yes/no string enum for flags.

Pitfalls: seeded sim (`npm run sim`) is not seeded, so compare `professioncheck --hash` (both 2890548967 / 1733832012 on
2026-11-02); bash sed with `\d`/`\b` in replacement eats backslashes, use Edit. Related: [[shop-tool]], [[give-by-name]].
