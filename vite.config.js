// Dev-server settings. The .claude folder holds agent worktrees whose edits must
// not reload the watcher's game; dist is the build output.
export default {
  server: { watch: { ignored: ['**/.claude/**', '**/dist/**', '**/node_modules/**'] } },
};
