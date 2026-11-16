// dl-dsh-nostr-pair/test/pack.test.js — roda com `node --test` depois de `node build/pack.mjs`
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('a página é um arquivo só, sem CDN nem import remoto', () => {
  assert.match(html, /<html/i);
  assert.doesNotMatch(html, /<script[^>]+src=/i, 'nenhum script externo');
  assert.doesNotMatch(html, /https?:\/\/[^"']+\.(js|css)/i, 'nada puxado de fora');
  assert.doesNotMatch(html, /\bimport\b\s*\(/, 'sem import dinâmico residual');
});

test('trata o fragmento do QR e os estados do fluxo', () => {
  for (const marca of ['#p=', 'dnr.device', 'pair.ok', 'tunnel.ready', 'tunnel.pending', 'tunnel.down']) {
    assert.ok(html.includes(marca), 'faltou ' + marca);
  }
  assert.ok(html.length > 60_000, 'o vendor do nostr-tools está embutido');
});
