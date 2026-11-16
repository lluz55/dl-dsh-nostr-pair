/**
 * Reexports mínimos do nostr-tools usados pela página de pareamento.
 *
 * O `build/pack.mjs` empacota este módulo num IIFE com `globalName: 'Nostr'`;
 * o app lê tudo de `window.Nostr`. Reexportar só o necessário mantém o HTML
 * final pequeno — a página não carrega o pacote inteiro.
 *
 * `schnorr` vem de `@noble/curves` (dependência do próprio nostr-tools) porque
 * `session.hello` assina uma string crua, e o nostr-tools só expõe assinatura
 * de eventos (`finalizeEvent` assina o hash do evento, não uma mensagem).
 */

export { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
export { npubEncode, decode } from 'nostr-tools/nip19';
export * as nip17 from 'nostr-tools/nip17';
export * as nip44 from 'nostr-tools/nip44';
export { schnorr } from '@noble/curves/secp256k1.js';
