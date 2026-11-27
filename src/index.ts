// bunli CLI entry. Compiles to a standalone binary with:
//   bun build --compile src/index.ts --outfile blitch

import { accessSync, constants as fsConstants, statSync } from 'node:fs';
import { createCLI } from '@bunli/core';
import { version } from '../package.json' with { type: 'json' };
import { runView } from './runtime.ts';

interface FileCheck {
  readonly ok: boolean;
  readonly reason: string;
}

/** Startup validation (FAILURE-MODES A4.10/A7.2): the view target must exist,
 *  be a regular file, and be readable — anything else fails loudly instead of
 *  silently dumping '' with exit 0. */
function checkReadableFile(file: string): FileCheck {
  try {
    if (!statSync(file).isFile()) {
      return { ok: false, reason: 'not a regular file' };
    }
  } catch {
    return { ok: false, reason: 'no such file' };
  }
  try {
    accessSync(file, fsConstants.R_OK);
  } catch {
    return { ok: false, reason: 'not readable' };
  }
  return { ok: true, reason: '' };
}

const cli = await createCLI({
  name: 'blitch',
  version,
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
    const check = checkReadableFile(file);
    if (!check.ok) {
      throw new Error(`blitch: view: ${check.reason}: ${file}`);
    }
    const code = await runView(file);
    process.exit(code);
  },
});

await cli.run();
