/**
 * Gera o `index.html` publicado: um arquivo só, com CSS inline, vendor do
 * nostr-tools e app, sem nenhum `src=` externo e sem CDN em runtime.
 *
 * Uso: `node build/pack.mjs` (depois de `npm install`). Rode sempre que mexer
 * em `src/`; o HTML gerado é commitado.
 */

import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);

const common = {
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  platform: 'browser',
  write: false,
  legalComments: 'none',
  charset: 'utf8',
  absWorkingDir: root,
  logLevel: 'warning',
};

const vendorBuild = await build({
  ...common,
  entryPoints: ['src/vendor.mjs'],
  globalName: 'Nostr',
});

const appBuild = await build({
  ...common,
  entryPoints: ['src/app.js'],
});

function clean(code) {
  // `</script` dentro de string fecharia a tag antes da hora.
  const escaped = code.replace(/<\/script/gi, '<\\/script');
  if (/\bimport\s*\(/.test(escaped)) {
    throw new Error('bundle com import dinâmico residual: a página não pode depender de rede');
  }
  return escaped;
}

const vendorCode = clean(vendorBuild.outputFiles[0].text);
const appCode = clean(appBuild.outputFiles[0].text);

const template = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#0a0c10" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#eef1f5" media="(prefers-color-scheme: light)">
<meta name="description" content="Pareamento do acesso remoto do dsh: escaneie o QR no computador.">
<meta name="robots" content="noindex">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src wss: ws:; base-uri 'none'; form-action 'none'">
<title>dsh · acesso remoto</title>
<style>
:root{
  color-scheme:light dark;
  --bg:#eef1f5;
  --card:#ffffff;
  --ink:#12151a;
  --muted:#5d6674;
  --line:#e2e7ee;
  --accent:#3569d6;
  --ok:#128a53;
  --warn:#a96700;
  --shadow:0 24px 60px -24px rgba(15,23,42,.28);
  --radius:22px;
}
@media (prefers-color-scheme: dark){
  :root{
    --bg:#0a0c10;
    --card:#121620;
    --ink:#f3f5f9;
    --muted:#98a2b3;
    --line:#232a36;
    --accent:#86a9ff;
    --ok:#4bd68c;
    --warn:#ffc46b;
    --shadow:0 30px 80px -30px rgba(0,0,0,.8);
  }
}
*{box-sizing:border-box}
html,body{height:100%}
body{
  margin:0;
  min-height:100%;
  display:grid;
  place-items:center;
  padding:1.25rem;
  background:radial-gradient(120% 80% at 50% -10%,rgba(53,105,214,.12),transparent 60%),var(--bg);
  color:var(--ink);
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  font-size:16px;
  line-height:1.5;
  -webkit-font-smoothing:antialiased;
  text-rendering:optimizeLegibility;
}
.card{
  width:min(100%,27rem);
  background:var(--card);
  border:1px solid var(--line);
  border-radius:var(--radius);
  box-shadow:var(--shadow);
  padding:2.25rem 1.75rem 1.5rem;
  text-align:center;
  display:flex;
  flex-direction:column;
  gap:1.4rem;
}
.eyebrow{
  margin:0;
  font-size:.72rem;
  letter-spacing:.16em;
  text-transform:uppercase;
  color:var(--muted);
  font-weight:600;
}
.eyebrow span{opacity:.5;margin:0 .2rem}
.status{
  display:flex;
  flex-direction:column;
  align-items:center;
  gap:.65rem;
  min-height:9.5rem;
  justify-content:center;
}
.icon{
  display:grid;
  place-items:center;
  width:3rem;
  height:3rem;
  color:var(--accent);
  transition:color .3s ease;
}
h1{
  margin:0;
  font-size:clamp(1.35rem,5vw,1.6rem);
  line-height:1.2;
  letter-spacing:-.015em;
  font-weight:650;
}
.detail{
  margin:0;
  color:var(--muted);
  font-size:.95rem;
  max-width:22rem;
  min-height:2.7rem;
}
.actions{display:flex;flex-direction:column;gap:.55rem}
.button{
  appearance:none;
  border:1px solid var(--line);
  background:transparent;
  color:var(--ink);
  font:inherit;
  font-size:.92rem;
  font-weight:600;
  padding:.72rem 1rem;
  border-radius:.85rem;
  cursor:pointer;
  text-decoration:none;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:.45rem;
  transition:background .15s ease,border-color .15s ease,transform .15s ease;
}
.button:hover{border-color:var(--muted)}
.button:active{transform:translateY(1px)}
.button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.button-strong{background:var(--accent);border-color:var(--accent);color:#fff}
@media (prefers-color-scheme: dark){.button-strong{color:#0a0c10}}
.button-quiet{
  border-color:transparent;
  background:transparent;
  color:var(--muted);
  font-weight:500;
  font-size:.85rem;
  padding:.4rem;
}
.button-quiet:hover{color:var(--ink)}
.hint{
  margin:0;
  font-size:.75rem;
  line-height:1.45;
  color:var(--muted);
  opacity:.9;
  min-height:1.1rem;
}
[hidden]{display:none !important}
.spinner{
  width:2.4rem;
  height:2.4rem;
  border-radius:50%;
  border:3px solid var(--line);
  border-top-color:var(--accent);
  animation:dnr-spin .9s linear infinite;
}
@keyframes dnr-spin{to{transform:rotate(1turn)}}
.glyph{width:3rem;height:3rem}
body[data-state="ok"] .icon{color:var(--ok)}
body[data-state="offline"] .icon,
body[data-state="expirado"] .icon{color:var(--warn)}
@media (prefers-reduced-motion: reduce){
  .spinner{animation-duration:2.4s}
  .button{transition:none}
}
@media (max-width:360px){
  .card{padding:1.75rem 1.25rem 1.25rem}
}
</style>
</head>
<body data-state="sem-oferta">
<main class="card">
  <p class="eyebrow">dsh <span aria-hidden="true">·</span> acesso remoto</p>
  <div id="status" class="status" role="status" aria-live="polite" aria-atomic="true">
    <div id="icon" class="icon"></div>
    <h1 id="title">Escaneie um QR</h1>
    <p id="detail" class="detail"></p>
  </div>
  <div id="actions" class="actions" hidden>
    <a id="manual" class="button button-strong" href="#" hidden>abrir manualmente</a>
    <button id="restart" class="button" type="button" hidden>recomeçar</button>
    <button id="forget" class="button button-quiet" type="button" hidden>esquecer este dispositivo</button>
  </div>
  <p id="hint" class="hint"></p>
</main>
<script>__VENDOR__</script>
<script>__APP__</script>
</body>
</html>
`;

const html = template.split('__VENDOR__').join(vendorCode).split('__APP__').join(appCode);

await writeFile(path.join(root, 'index.html'), html, 'utf8');

console.log('index.html gerado: ' + Buffer.byteLength(html, 'utf8').toLocaleString('pt-BR') + ' bytes');
console.log('  vendor: ' + Buffer.byteLength(vendorCode, 'utf8').toLocaleString('pt-BR') + ' bytes');
console.log('  app:    ' + Buffer.byteLength(appCode, 'utf8').toLocaleString('pt-BR') + ' bytes');
