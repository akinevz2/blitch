// blitch lint — procedural-style purity lint.
//
// Rules enforced over src/**/*.ts (comments and strings are stripped first):
//   LINT001 no-untyped-function   every function declaration or const-bound
//                                 arrow must annotate its return type and
//                                 every parameter
//   LINT002 no-any-unknown        the types `any` and `unknown` are forbidden
//   LINT003 no-impure-module      functions must be pure. Effectful functions
//                                 are only allowed via the event design: IO
//                                 tokens (fs, process, Bun, console, timers,
//                                 async, randomness, time) may appear only in
//                                 the allowlisted runtime/CLI modules whose
//                                 sole job is interpreting published events
//   LINT004 procedural-style      no classes; data + functions only
//
// The linter is itself procedural: loops over files and lines, no classes,
// fully typed. Exits 1 when any finding is reported.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

interface Finding {
  readonly rule: string;
  readonly file: string;
  readonly line: number;
  readonly detail: string;
}

interface FunctionScan {
  readonly findings: Finding[];
}

/** Modules whose job is interpreting events: the only impurity allowlist. */
const IMPURE_ALLOWLIST: readonly string[] = ['runtime.ts', 'index.ts', 'lint.ts'];

const IMPURE_TOKENS: readonly RegExp[] = [
  /\bawait\b/,
  /\basync\b/,
  /\bprocess\./,
  /\bBun\./,
  /\bconsole\./,
  /\bfetch\(/,
  /\brequire\(/,
  /\bfs\./,
  /\breadFileSync\b/,
  /\bwriteFileSync\b/,
  /\bDate\.now\b/,
  /\bMath\.random\b/,
  /\bsetTimeout\b/,
  /\bsetInterval\b/,
  /\bsetImmediate\b/,
];

function stripCommentsAndStrings(source: string): string {
  let out = '';
  let mode = 'code';
  let i = 0;
  while (i < source.length) {
    const ch = source[i] ?? '';
    const next = source[i + 1] ?? '';
    if (mode === 'code') {
      if (ch === '/' && next === '/') {
        mode = 'line';
        i += 2;
        continue;
      }
      if (ch === '/' && next === '*') {
        mode = 'block';
        i += 2;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        mode = ch;
        i += 1;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }
    if (mode === 'line') {
      if (ch === '\n') {
        mode = 'code';
        out += '\n';
      }
      i += 1;
      continue;
    }
    if (mode === 'block') {
      if (ch === '*' && next === '/') {
        mode = 'code';
        i += 2;
        continue;
      }
      if (ch === '\n') out += '\n';
      i += 1;
      continue;
    }
    // inside a string literal: keep newlines, drop content
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === mode) {
      mode = 'code';
    }
    i += 1;
  }
  return out;
}

function scanUntypedParams(params: string, rule: string, file: string, line: number, findings: Finding[]): void {
  const trimmed = params.trim();
  if (trimmed.length === 0) return;
  let depth = 0;
  let part = '';
  const parts: string[] = [];
  for (const ch of trimmed) {
    if (ch === '(' || ch === '<' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === '>' || ch === ']' || ch === '}') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(part);
      part = '';
      continue;
    }
    part += ch;
  }
  parts.push(part);
  for (const rawPart of parts) {
    const param = rawPart.trim();
    if (param.length === 0 || param.startsWith('...')) {
      findings.push({ rule, file, line, detail: `untyped parameter: ${param}` });
      continue;
    }
    const name = param.split(':')[0] ?? param;
    if (param.indexOf(':') < 0) {
      findings.push({ rule, file, line, detail: `untyped parameter: ${name}` });
    }
  }
}

function scanFunctions(source: string, file: string, findings: Finding[]): FunctionScan {
  const lines = source.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const lineNo = i + 1;

    // function declarations: require a return type
    const fnDecl = /function\s+\w+\s*\(([^)]*)\)\s*(:\s*[^{]+)?\s*\{/.exec(line);
    if (fnDecl) {
      if (!fnDecl[2]) {
        findings.push({ rule: 'LINT001', file, line: lineNo, detail: `function without return type: ${line.trim()}` });
      }
      scanUntypedParams(fnDecl[1] ?? '', 'LINT001', file, lineNo, findings);
      i += 1;
      continue;
    }

    // const-bound arrows: require explicit return type
    const arrow = /const\s+\w+\s*=\s*(?:async\s+)?\(([^)]*)\)\s*:\s*([^{=;]+)=>/.exec(line);
    const arrowUntyped = /const\s+\w+\s*=\s*(?:async\s+)?\(([^)]*)\)\s*=>/.exec(line);
    const arrowSingle = /const\s+\w+\s*=\s*(?:async\s+)?([A-Za-z_]\w*)\s*=>/.exec(line);
    if (arrow) {
      scanUntypedParams(arrow[1] ?? '', 'LINT001', file, lineNo, findings);
    } else if (arrowUntyped) {
      findings.push({ rule: 'LINT001', file, line: lineNo, detail: `arrow without return type: ${line.trim()}` });
      scanUntypedParams(arrowUntyped[1] ?? '', 'LINT001', file, lineNo, findings);
    } else if (arrowSingle) {
      findings.push({ rule: 'LINT001', file, line: lineNo, detail: `untyped single-param arrow: ${line.trim()}` });
    }
    i += 1;
  }
  return { findings };
}

function scanRules(name: string, source: string, findings: Finding[]): void {
  const lines = source.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const lineNo = i + 1;

    if (/\bclass\s+[A-Z]/.test(line)) {
      findings.push({ rule: 'LINT004', file: name, line: lineNo, detail: 'class declaration (procedural style forbids classes)' });
    }
    if (/\bany\b|\bunknown\b/.test(line)) {
      findings.push({ rule: 'LINT002', file: name, line: lineNo, detail: `any/unknown type usage: ${line.trim()}` });
    }
    if (!IMPURE_ALLOWLIST.includes(name)) {
      for (const token of IMPURE_TOKENS) {
        if (token.test(line)) {
          findings.push({ rule: 'LINT003', file: name, line: lineNo, detail: `impure module token ${token}: ${line.trim()}` });
          break;
        }
      }
    }
    i += 1;
  }
}

function listSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      for (const nested of listSources(full)) out.push(nested);
      continue;
    }
    if (entry.endsWith('.ts')) out.push(full);
  }
  return out.sort();
}

function main(): number {
  const srcDir = join(import.meta.dir, '..'); // the project root; src lives under it
  const files = listSources(join(srcDir, 'src'));
  const findings: Finding[] = [];
  for (const file of files) {
    const name = file.split('/').pop() ?? file;
    const stripped = stripCommentsAndStrings(readFileSync(file, 'utf8'));
    scanFunctions(stripped, name, findings);
    scanRules(name, stripped, findings);
  }
  if (findings.length === 0) {
    process.stdout.write(`blitch lint: clean (${files.length} files)\n`);
    return 0;
  }
  for (const f of findings) {
    process.stdout.write(`${f.file}:${f.line}: ${f.rule} ${f.detail}\n`);
  }
  process.stdout.write(`blitch lint: ${findings.length} finding(s)\n`);
  return 1;
}

process.exit(main());
