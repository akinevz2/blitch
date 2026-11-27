// bunli CLI entry. Compiles to a standalone binary with:
//   bun build --compile src/index.ts --outfile blitch

import { createCLI } from '@bunli/core';
import { runView } from './runtime.ts';

const cli = await createCLI({
  name: 'blitch',
  version: '0.2.0',
  description: 'a diff for each stitch — live file viewer with colour-coded diff',
});

cli.command({
  name: 'view' as const,
  description:
    'Live-view FILE: livereload with green added bytes, red deleted tokens/ghost ropes, yellow replaced ropes. ' +
    'Keys: Esc/Ctrl-C/Ctrl-D exit, hjkl+arrows scroll, Ctrl-E/Y vertical scroll, gg/G motions, / ? search, n/N repeat.',
  handler: async ({ positional }) => {
    const file = positional[0];
    if (!file || file.length === 0) {
      throw new Error('usage: blitch view <file>');
    }
    const code = await runView(file);
    process.exit(code);
  },
});

await cli.run();
