// Dev-server settings. The .claude folder holds agent worktrees whose edits must
// not reload the watcher's game; dist is the build output.
// __COMMIT__ (#664): the commit this build or dev server started from, kept with the read patch notes on the title screen.
import {execFileSync} from 'node:child_process';
let commit = '';
try { commit = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(); } catch (e) { commit = ''; }
export default {
  server: { watch: { ignored: ['**/.claude/**', '**/dist/**', '**/node_modules/**'] } },
  define: { __COMMIT__: JSON.stringify(commit) },
};
