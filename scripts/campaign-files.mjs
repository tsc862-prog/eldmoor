// Node hosts read the campaign seeds from disk and hand the text to the sim (src/sim/campaign.js stays fs-free).
import {readdirSync, readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {provideCampaigns, campaignIdOf} from '../src/sim/index.js';
export const CAMPAIGN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'campaigns');
// Every docs/campaigns/<world>.md except the _test fixture, keyed by world id. A missing folder or file means no campaign.
export function loadCampaigns(dir = CAMPAIGN_DIR, {all = false} = {}) {
  const map = {};
  try {if (existsSync(dir)) for (const f of readdirSync(dir)) if (/\.md$/i.test(f) && (all || !f.startsWith('_'))) map[campaignIdOf(f)] = readFileSync(join(dir, f), 'utf8')} catch {}
  provideCampaigns(map); return map;
}
