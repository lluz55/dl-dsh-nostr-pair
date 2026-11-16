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

test('a subscription do dispositivo não corta as respostas do host', () => {
  // NIP-59 randomiza created_at em até 2 dias para trás (nip59 randomNow):
  // um `since` curto (120 s) descartava pair.ok/tunnel.ready e o pareamento
  // nunca concluía no celular. A janela tem de cobrir o pior caso.
  const m = html.match(/since:\s*Math\.floor\(Date\.now\(\)\s*\/\s*1e3\)\s*-\s*([0-9*\s]+)/);
  assert.ok(m, 'não achei a expressão do since no artefato');
  const janela = Number(eval(m[1]));
  assert.ok(janela >= 86_400, `janela de ${janela}s é curta demais para o NIP-59`);
});
