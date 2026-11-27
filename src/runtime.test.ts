// Unit tests for the incremental key decoder: partial escape sequences must
// never leak a premature Escape, SS3 arrows decode, SGR mouse wheel scrolls.

import { describe, expect, test } from 'bun:test';
import { createKeyDecoder } from './runtime.ts';
import type { InputEvent } from './types.ts';

describe('key decoder', () => {
  test('plain char decodes immediately', () => {
    const d = createKeyDecoder();
    expect(d.feed('j')).toEqual([{ t: 'key', key: { t: 'ch', c: 'j' } }]);
    expect(d.hasPending()).toBe(false);
  });

  test('complete CSI sequence decodes to an arrow', () => {
    const d = createKeyDecoder();
    expect(d.feed('\u001b[B')).toEqual([{ t: 'key', key: { t: 'named', k: 'down' } }]);
    expect(d.hasPending()).toBe(false);
  });

  test('a lone ESC in a chunk is HELD, not emitted (no premature exit)', () => {
    const d = createKeyDecoder();
    expect(d.feed('\u001b')).toEqual([]);
    expect(d.hasPending()).toBe(true);
  });

  test('ESC followed by more of the sequence across chunks decodes as an arrow', () => {
    const d = createKeyDecoder();
    expect(d.feed('\u001b')).toEqual([]);
    expect(d.feed('[')).toEqual([]);
    expect(d.feed('A')).toEqual([{ t: 'key', key: { t: 'named', k: 'up' } }]);
    expect(d.hasPending()).toBe(false);
  });

  test('ESC held across chunks flushes as Escape when nothing follows', () => {
    const d = createKeyDecoder();
    d.feed('\u001b');
    expect(d.flush()).toEqual([{ t: 'key', key: { t: 'named', k: 'escape' } }]);
    expect(d.hasPending()).toBe(false);
    expect(d.flush()).toEqual([]);
  });

  test('SS3 arrows decode (application cursor key mode)', () => {
    const d = createKeyDecoder();
    expect(d.feed('\u001bOA')).toEqual([{ t: 'key', key: { t: 'named', k: 'up' } }]);
    expect(d.feed('\u001bOB')).toEqual([{ t: 'key', key: { t: 'named', k: 'down' } }]);
    expect(d.feed('\u001bOC')).toEqual([{ t: 'key', key: { t: 'named', k: 'right' } }]);
    expect(d.feed('\u001bOD')).toEqual([{ t: 'key', key: { t: 'named', k: 'left' } }]);
  });

  test('SGR mouse wheel decodes to vertical scroll', () => {
    const d = createKeyDecoder();
    expect(d.feed('\u001b[<64;10;5M')).toEqual([{ t: 'key', key: { t: 'named', k: 'up' } }]);
    expect(d.feed('\u001b[<65;10;5M')).toEqual([{ t: 'key', key: { t: 'named', k: 'down' } }]);
  });

  test('partial SGR mouse report held until the M terminator arrives', () => {
    const d = createKeyDecoder();
    expect(d.feed('\u001b[<64;1')).toEqual([]);
    expect(d.feed('0;5M')).toEqual([{ t: 'key', key: { t: 'named', k: 'up' } }]);
  });

  test('X10 mouse report decodes to wheel scroll without leaking chars', () => {
    const d = createKeyDecoder();
    // cb=64+32=96 (`=wheel up), coords 33,33 — none may leak as keys
    expect(d.feed('\u001b[M\u0060\u0021\u0021')).toEqual([{ t: 'key', key: { t: 'named', k: 'up' } }]);
    expect(d.hasPending()).toBe(false);
    // cb=65+32=97 (a=wheel down)
    expect(d.feed('\u001b[M\u0061\u0021\u0021')).toEqual([{ t: 'key', key: { t: 'named', k: 'down' } }]);
  });

  test('wheel click (button press) produces no event and does not exit', () => {
    const d = createKeyDecoder();
    expect(d.feed('\u001b[<0;5;3M')).toEqual([]);
    expect(d.hasPending()).toBe(false);
  });

  test('mixed keys in one chunk preserve order', () => {
    const d = createKeyDecoder();
    const out = d.feed('j\u001b[Bk');
    const names = out.filter((e): e is InputEvent & { t: 'key' } => e.t === 'key').map((e) => (e.key.t === 'ch' ? e.key.c : e.key.k));
    expect(names).toEqual(['j', 'down', 'k']);
  });

  test('multiple trailing ESC bytes eventually flush as escapes', () => {
    const d = createKeyDecoder();
    expect(d.feed('\u001b\u001b')).toEqual([{ t: 'key', key: { t: 'named', k: 'escape' } }]);
    expect(d.hasPending()).toBe(true); // second ESC still held
    expect(d.flush()).toEqual([{ t: 'key', key: { t: 'named', k: 'escape' } }]);
  });
});
