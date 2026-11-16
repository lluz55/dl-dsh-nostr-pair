# dl-dsh-nostr-pair

Página pública de pareamento do acesso remoto do dsh. O celular lê o QR que o
dsh mostra no Settings, abre esta página com a oferta no fragmento da URL
(`#p=<base64url>`) e, se tudo der certo, é redirecionado para a URL do túnel já
com o token — daí em diante a GUI do dsh carrega ali.

O fluxo inteiro é descrito em
`docs/superpowers/specs/2026-11-16-dsh-nostr-remote-design.md` (repo do dsh).

## O que a página faz

- **Com `#p=`** (parear): gera e guarda a chave do dispositivo em
  `localStorage` (`dnr.device`), assina a subscription dos relays **antes** de
  publicar, manda a DM NIP-17 `pair` a cada 3 s (até 2 min) e espera
  `pair.ok` + `tunnel.ready`.
- **Sem `#p` e com `dnr.device`/`dnr.host`** (reusar): publica `session.hello`
  a cada 3 s; sem resposta em 15 s mostra “dsh offline”. Este é o caminho de
  volta quando o túnel troca de URL.
- `pair.ok` mostra “pareado ✓”, mas a página **só fica verde em `tunnel.ready`**:
  é essa mensagem que carrega a `entry` com o token. Aí ela faz
  `location.replace(entry)` depois de ~1 s, com “abrir manualmente” de fallback.
- Trata `tunnel.pending` (mostra o `retryAfterMs`) e `tunnel.down`.
- Botão discreto “esquecer este dispositivo” limpa `dnr.device` e `dnr.host`.

Nada de service worker, analytics, cookie ou CDN. A chave privada do
dispositivo nunca sai do `localStorage`; só as DMs NIP-17 vão para os relays.

## Desenvolvimento

```sh
npm install
node build/pack.mjs     # gera index.html (vendor + app + CSS inline)
node --test test/       # pack.test.js verifica o HTML gerado
```

`index.html` é **gerado e commitado**: é ele que o GitHub Pages publica. Rode
`node build/pack.mjs` sempre que mexer em `src/` e commite o resultado junto.

Para espiar localmente, sirva a pasta com qualquer servidor estático
(`npx serve -l 8099 .`) e abra `http://127.0.0.1:8099/` — sem `#p` deve mostrar
“Escaneie um QR”.

### Por que não há CDN

A página é o único ponto público do fluxo e precisa funcionar em rede ruim, sem
dependência de terceiros e sem risco de um `src=` externo sumir ou mudar. Por
isso `build/pack.mjs` roda o esbuild duas vezes (IIFE do vendor com
`globalName: 'Nostr'`, IIFE do app) e inlina os dois num arquivo só, com CSS
inline e uma CSP que só libera `wss:`/`ws:` para os relays.

### Dependências do bundle

- `nostr-tools@2.26.1`: `nip17` (gift wrap), `nip44`, `nip19`, `pure`.
- `@noble/curves@2.0.1`: `schnorr`, usado só para assinar a string de
  `session.hello`. O nostr-tools só expõe assinatura de eventos
  (`finalizeEvent` assina o hash do evento, não uma mensagem crua), então a
  assinatura do hello é BIP340 sobre os bytes UTF-8 de
  `dsh-nostr-remote:session:<npubHost>:<npubDevice>:<ts>:<nonce>`.

Quem verifica (host) deve fazer o mesmo: `schnorr.verify(hexToBytes(sig),
new TextEncoder().encode(string), hexToBytes(devicePubkey))` — a versão 2 do
`@noble/curves` não aceita string hex onde espera bytes.

## Estrutura

```
src/vendor.mjs    reexports mínimos do nostr-tools (+ schnorr)
src/app.js        estados, relays, localStorage, mensagens, redirect
build/pack.mjs    esbuild → inlina vendor + app num único HTML
index.html        GERADO por build/pack.mjs, commitado
test/pack.test.js testes do artefato gerado (sem rede)
```
