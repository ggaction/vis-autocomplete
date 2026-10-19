import { execFileSync } from 'node:child_process';

// Record the exact source revision alongside the npm base version.
export function ggactionSource() {
  const cwd = new URL('../vendor/ggaction/', import.meta.url);
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  return { repository: 'https://github.com/ggaction/ggaction', directory: 'vendor/ggaction',
    branch: git(['branch', '--show-current']), commit: git(['rev-parse', 'HEAD']),
    modified: Boolean(git(['status', '--porcelain', '--', 'src', 'types'])) };
}
