/**
 * Página pública de pareamento do dsh remoto.
 *
 * Roda como arquivo único (o `build/pack.mjs` inlina vendor + este app num só
 * HTML). Fluxos:
 *
 *  - com `#p=<base64url>`: parear. Assina a subscription nos relays ANTES de
 *    publicar, gera/guarda a chave do dispositivo em `dnr.device`, publica
 *    `pair` a cada 3 s (até 2 min) e espera `pair.ok` + `tunnel.ready`.
 *  - sem `#p` e com `dnr.device`/`dnr.host`: reusar. Publica `session.hello` a
 *    cada 3 s; sem resposta em 15 s mostra "dsh offline".
 *
 * Verde SÓ com `tunnel.ready` (a mensagem carrega a `entry` com o token); aí
 * redireciona com `location.replace(entry)` após ~1 s, com link manual de
 * fallback. `pair.ok` mostra "pareado ✓", mas não fica verde.
 */

/* global Nostr */

(function () {
  'use strict';

  var PROTOCOL = 1;
  var RESEND_MS = 3000;
  var LINK_TIMEOUT_MS = 120000;
  var OFFLINE_MS = 15000;
  var RELAY_RETRY_MS = 5000;
  var MAX_SEEN = 512;
  var LS_DEVICE = 'dnr.device';
  var LS_HOST = 'dnr.host';

  var N = window.Nostr || null;

  var els = {
    body: document.body,
    icon: document.getElementById('icon'),
    title: document.getElementById('title'),
    detail: document.getElementById('detail'),
    hint: document.getElementById('hint'),
    actions: document.getElementById('actions'),
    manual: document.getElementById('manual'),
    restart: document.getElementById('restart'),
    forget: document.getElementById('forget')
  };

  var ICONS = {
    'sem-oferta': '<svg class="glyph" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><rect x="7" y="7" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.4"/><rect x="30" y="7" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.4"/><rect x="7" y="30" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M27 27h5v5h-5zM35 27h6M27 35h5M34 34h7v6h-7z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/></svg>',
    'pareando': '<span class="spinner" aria-hidden="true"></span>',
    'reconectando': '<span class="spinner" aria-hidden="true"></span>',
    'pareado': '<svg class="glyph" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" stroke-width="2.4" opacity=".35"/><path d="M14.5 25.5 21 32l13-15" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    'ok': '<svg class="glyph" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" stroke-width="2.4" opacity=".45"/><path d="M14.5 25.5 21 32l13-15" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    'offline': '<svg class="glyph" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" stroke-width="2.4" opacity=".35"/><path d="M24 14v13" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/><circle cx="24" cy="33.5" r="2.3" fill="currentColor"/></svg>',
    'expirado': '<svg class="glyph" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" stroke-width="2.4" opacity=".35"/><path d="M24 14v13" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/><circle cx="24" cy="33.5" r="2.3" fill="currentColor"/></svg>'
  };

  var memoryStore = {};
  var device = null;
  var host = null;
  var offer = null;
  var pool = null;
  var mode = 'none';
  var expectedHostHex = null;
  var paired = false;
  var finished = false;
  var timers = {};

  var hashLooksLikePair = (window.location.hash || '').indexOf('#p=') === 0;

  /* ---------------------------------------------------------------- storage */

  function lsGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return memoryStore[key] || null; }
  }
  function lsSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { memoryStore[key] = value; }
  }
  function lsDel(key) {
    try { window.localStorage.removeItem(key); } catch (e) { delete memoryStore[key]; }
  }

  /* ------------------------------------------------------------------ bytes */

  function bytesToHex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      var part = bytes[i].toString(16);
      out += part.length === 1 ? '0' + part : part;
    }
    return out;
  }

  function hexToBytes(hex) {
    if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
      throw new Error('hex inválido');
    }
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  function b64urlToBytes(text) {
    var b64 = String(text).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var bin = window.atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bytesToB64url(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return window.btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function randomB64url(size) {
    var bytes = new Uint8Array(size);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < size; i++) bytes[i] = Math.floor(Math.random() * 256);
    return bytesToB64url(bytes);
  }

  /* ------------------------------------------------------------- identidade */

  function npubToHex(npub) {
    if (!N) return null;
    try {
      var decoded = N.decode(npub);
      if (!decoded || decoded.type !== 'npub' || typeof decoded.data !== 'string') return null;
      return decoded.data;
    } catch (e) {
      return null;
    }
  }

  function loadDevice() {
    var raw = lsGet(LS_DEVICE);
    if (!raw) return null;
    try {
      var saved = JSON.parse(raw);
      if (!saved || typeof saved.sk !== 'string' || !/^[0-9a-f]{64}$/i.test(saved.sk)) return null;
      var secretKey = hexToBytes(saved.sk);
      var pubkey = N.getPublicKey(secretKey);
      if (saved.pk && saved.pk !== pubkey) return null;
      return { sk: saved.sk, pk: pubkey, npub: N.npubEncode(pubkey) };
    } catch (e) {
      return null;
    }
  }

  function newDevice() {
    var secretKey = N.generateSecretKey();
    var pubkey = N.getPublicKey(secretKey);
    var saved = { sk: bytesToHex(secretKey), pk: pubkey, npub: N.npubEncode(pubkey) };
    lsSet(LS_DEVICE, JSON.stringify(saved));
    return { sk: saved.sk, pk: pubkey, npub: saved.npub };
  }

  function loadHost() {
    var raw = lsGet(LS_HOST);
    if (!raw) return null;
    try {
      var saved = JSON.parse(raw);
      if (!saved || !Array.isArray(saved.relays) || typeof saved.npub !== 'string') return null;
      var relays = saved.relays.filter(function (url) {
        return typeof url === 'string' && /^wss?:\/\//i.test(url);
      });
      if (!relays.length) return null;
      return {
        relays: relays.slice(0, 6),
        npub: saved.npub,
        label: typeof saved.label === 'string' && saved.label ? saved.label : 'dsh'
      };
    } catch (e) {
      return null;
    }
  }

  function deviceLabel() {
    var ua = window.navigator.userAgent || '';
    if (/iPhone|iPad|Android/i.test(ua)) return 'celular';
    if (/Macintosh|Windows|Linux/i.test(ua)) return 'navegador';
    return 'dispositivo';
  }

  /* ----------------------------------------------------------------- oferta */

  function readOffer() {
    var hash = window.location.hash || '';
    if (hash.indexOf('#p=') !== 0) return null;
    var payload;
    try {
      payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(hash.slice(3))));
    } catch (e) {
      return null;
    }
    if (!payload || payload.v !== 1) return null;
    if (typeof payload.n !== 'string' || typeof payload.s !== 'string' || !Array.isArray(payload.r)) return null;
    var relays = payload.r.filter(function (url) {
      return typeof url === 'string' && /^wss?:\/\//i.test(url);
    });
    if (!relays.length) return null;
    var hostHex = npubToHex(payload.n);
    if (!hostHex) return null;
    return {
      relays: relays.slice(0, 6),
      npub: payload.n,
      hostHex: hostHex,
      secret: payload.s,
      expiresAt: Number(payload.e) || 0
    };
  }

  /* -------------------------------------------------------------------- UI */

  function syncActions() {
    var visible = [els.manual, els.restart, els.forget].some(function (el) {
      return el && !el.hidden;
    });
    els.actions.hidden = !visible;
  }

  function setState(state, title, detail) {
    els.body.dataset.state = state;
    els.icon.innerHTML = ICONS[state] || ICONS.pareando;
    els.title.textContent = title;
    els.detail.textContent = detail || '';
    syncActions();
  }

  function setHint(text) {
    els.hint.textContent = text || '';
  }

  function revealForget() {
    if (device) els.forget.hidden = false;
    syncActions();
  }

  /* -------------------------------------------------------------- timers */

  function clearTimer(name) {
    if (!timers[name]) return;
    window.clearTimeout(timers[name]);
    window.clearInterval(timers[name]);
    timers[name] = null;
  }

  function clearAllTimers() {
    ['resend', 'expire', 'offline', 'redirect'].forEach(clearTimer);
  }

  /* --------------------------------------------------------------- relays */

  function createRelayPool(options) {
    var sockets = [];
    var closed = false;
    var seen = new Set();
    var filter = { kinds: [1059], '#p': [options.pubkey], since: options.since };
    var subId = 'dnr-' + Math.random().toString(36).slice(2, 10);

    function handleEvent(event) {
      if (closed || !event || event.kind !== 1059) return;
      var addressedToUs = false;
      for (var i = 0; i < (event.tags || []).length; i++) {
        var tag = event.tags[i];
        if (tag && tag[0] === 'p' && tag[1] === options.pubkey) { addressedToUs = true; break; }
      }
      if (!addressedToUs) return;
      if (seen.has(event.id)) return;
      seen.add(event.id);
      if (seen.size > MAX_SEEN) {
        seen.delete(seen.values().next().value);
      }
      var rumor;
      try {
        rumor = N.nip17.unwrapEvent(event, options.secretKey);
      } catch (e) {
        return;
      }
      if (!rumor) return;
      try {
        options.onRumor(rumor);
      } catch (e) {
        /* um evento ruim não derruba a página */
      }
    }

    function flush(socket) {
      if (!socket.ws) return;
      while (socket.outbox.length) {
        try {
          socket.ws.send(JSON.stringify(['EVENT', socket.outbox.shift()]));
        } catch (e) {
          break;
        }
      }
    }

    function schedule(socket) {
      if (closed || socket.timer) return;
      socket.timer = window.setTimeout(function () {
        socket.timer = null;
        open(socket);
      }, RELAY_RETRY_MS);
    }

    function open(socket) {
      if (closed) return;
      var ws;
      try {
        ws = new WebSocket(socket.url);
      } catch (e) {
        schedule(socket);
        return;
      }
      socket.ws = ws;
      ws.onopen = function () {
        if (closed) {
          try { ws.close(); } catch (e) { /* ignore */ }
          return;
        }
        socket.ready = true;
        try { ws.send(JSON.stringify(['REQ', subId, filter])); } catch (e) { /* ignore */ }
        flush(socket);
      };
      ws.onmessage = function (message) {
        var data;
        try {
          data = JSON.parse(message.data);
        } catch (e) {
          return;
        }
        if (Array.isArray(data) && data[0] === 'EVENT') handleEvent(data[2]);
      };
      ws.onclose = function () {
        socket.ready = false;
        socket.ws = null;
        schedule(socket);
      };
      ws.onerror = function () {
        try { ws.close(); } catch (e) { /* ignore */ }
      };
    }

    function publish(event) {
      if (closed) return;
      for (var i = 0; i < sockets.length; i++) {
        var socket = sockets[i];
        if (socket.ws && socket.ready && socket.ws.readyState === 1) {
          try { socket.ws.send(JSON.stringify(['EVENT', event])); } catch (e) { /* ignore */ }
        } else {
          socket.outbox.push(event);
          if (socket.outbox.length > 4) socket.outbox.shift();
        }
      }
    }

    function close() {
      closed = true;
      for (var i = 0; i < sockets.length; i++) {
        var socket = sockets[i];
        if (socket.timer) window.clearTimeout(socket.timer);
        if (socket.ws) {
          try { socket.ws.close(); } catch (e) { /* ignore */ }
        }
      }
      sockets = [];
    }

    options.relays.forEach(function (url) {
      var socket = { url: url, ws: null, ready: false, timer: null, outbox: [] };
      sockets.push(socket);
      open(socket);
    });

    return { publish: publish, close: close };
  }

  function openPool(relays) {
    pool = createRelayPool({
      relays: relays,
      pubkey: device.pk,
      secretKey: hexToBytes(device.sk),
      since: Math.floor(Date.now() / 1000) - 120,
      onRumor: handleRumor
    });
  }

  /* -------------------------------------------------------------- mensagens */

  function send(hostHex, payload) {
    if (!pool || finished) return;
    var wrapped;
    try {
      wrapped = N.nip17.wrapEvent(hexToBytes(device.sk), { publicKey: hostHex }, JSON.stringify(payload));
    } catch (e) {
      return;
    }
    pool.publish(wrapped);
  }

  function publishPair() {
    if (finished || paired || mode !== 'pair' || !offer) return;
    send(offer.hostHex, { v: PROTOCOL, t: 'pair', s: offer.secret, dpk: device.pk, label: deviceLabel() });
  }

  function publishHello() {
    if (finished || mode !== 'hello' || !host || !expectedHostHex) return;
    var ts = Date.now();
    var nonce = randomB64url(12);
    var string = 'dsh-nostr-remote:session:' + host.npub + ':' + device.npub + ':' + ts + ':' + nonce;
    var sig;
    try {
      sig = bytesToHex(N.schnorr.sign(new TextEncoder().encode(string), hexToBytes(device.sk)));
    } catch (e) {
      return;
    }
    send(expectedHostHex, { v: PROTOCOL, t: 'session.hello', ts: ts, nonce: nonce, sig: sig });
  }

  function handleRumor(rumor) {
    if (!rumor || typeof rumor.content !== 'string') return;
    if (!expectedHostHex || rumor.pubkey !== expectedHostHex) return;
    var payload;
    try {
      payload = JSON.parse(rumor.content);
    } catch (e) {
      return;
    }
    if (!payload || payload.v !== PROTOCOL) return;
    if (payload.t === 'pair.ok') onPairOk(payload);
    else if (payload.t === 'tunnel.pending') onTunnelPending(payload);
    else if (payload.t === 'tunnel.ready') onTunnelReady(payload);
    else if (payload.t === 'tunnel.down') onTunnelDown(payload);
  }

  function reasonSuffix(payload) {
    return typeof payload.reason === 'string' && payload.reason ? ' — ' + payload.reason : '';
  }

  function onPairOk(payload) {
    if (mode !== 'pair' || paired || finished) return;
    paired = true;
    clearTimer('resend');
    clearTimer('offline');
    var label = typeof payload.label === 'string' && payload.label ? payload.label : 'dsh';
    lsSet(LS_HOST, JSON.stringify({ relays: offer.relays, npub: offer.npub, label: label }));
    setState('pareado', 'Pareado ✓', 'aguardando o link do túnel…');
    setHint('Este navegador já está reconhecido: da próxima vez, basta abrir esta página.');
  }

  function onTunnelPending(payload) {
    if (finished) return;
    clearTimer('offline');
    var retry = Number(payload.retryAfterMs);
    var seconds = retry > 0 ? Math.max(1, Math.round(retry / 1000)) : 2;
    var detail = 'subindo o túnel… nova tentativa em ~' + seconds + ' s' + reasonSuffix(payload);
    if (mode === 'hello') setState('reconectando', 'Reconectando…', detail);
    else if (paired) setState('pareado', 'Pareado ✓', detail);
    else setState('pareando', 'Pareando…', detail);
  }

  function onTunnelDown(payload) {
    if (finished) return;
    clearTimer('offline');
    var detail = 'dsh caiu, tentando de novo' + reasonSuffix(payload);
    if (mode === 'hello') setState('reconectando', 'Reconectando…', detail);
    else if (paired) setState('pareado', 'Pareado ✓', detail);
    else setState('pareando', 'Pareando…', detail);
  }

  function safeEntry(entry) {
    return typeof entry === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(entry);
  }

  function onTunnelReady(payload) {
    if (finished || !safeEntry(payload.entry)) return;
    // `exp` é a validade do token daquela entrega; um ready antigo (relay
    // entregando fora de ordem) não pode levar a uma URL já vencida.
    if (typeof payload.exp === 'number' && payload.exp <= Date.now()) return;
    var entry = payload.entry;
    finished = true;
    clearAllTimers();
    if (pool) {
      pool.close();
      pool = null;
    }
    setState('ok', 'Pronto!', 'abrindo o dsh…');
    els.manual.href = entry;
    els.manual.hidden = false;
    syncActions();
    timers.redirect = window.setTimeout(function () {
      timers.redirect = null;
      try {
        window.location.replace(entry);
      } catch (e) {
        setState('ok', 'Quase lá', 'não foi possível abrir sozinho. use "abrir manualmente".');
        els.manual.hidden = false;
        syncActions();
      }
    }, 1000);
  }

  /* ---------------------------------------------------------------- fluxos */

  function showExpired() {
    if (finished) return;
    finished = true;
    clearAllTimers();
    if (pool) {
      pool.close();
      pool = null;
    }
    var detail = mode === 'pair'
      ? 'o QR vale só 2 minutos. escaneie um QR novo no dsh.'
      : 'não conseguimos um link desta vez. tente de novo.';
    setState('expirado', 'Oferta expirada', detail);
    setHint(mode === 'pair'
      ? 'Abra Configurações → Acesso remoto e gere um QR novo.'
      : 'Se o computador estiver ligado, recarregar a página costuma resolver.');
    els.restart.hidden = false;
    els.manual.hidden = true;
    syncActions();
  }

  function startPair() {
    expectedHostHex = offer.hostHex;
    setState('pareando', 'Pareando…', 'conectando aos relays…');
    setHint('O QR vale por 2 minutos e só pode ser usado uma vez.');
    openPool(offer.relays);
    publishPair();
    timers.resend = window.setInterval(publishPair, RESEND_MS);
    var left = offer.expiresAt && offer.expiresAt > Date.now() ? offer.expiresAt - Date.now() : 0;
    timers.expire = window.setTimeout(showExpired, left > 0 ? Math.min(LINK_TIMEOUT_MS, left) : LINK_TIMEOUT_MS);
  }

  function startHello() {
    var hostHex = npubToHex(host.npub);
    if (!hostHex) {
      mode = 'none';
      setState('sem-oferta', 'Endereço inválido', 'a configuração guardada não tem um npub válido. escaneie um QR novo.');
      revealForget();
      return;
    }
    expectedHostHex = hostHex;
    setState('reconectando', 'Reconectando…', 'pedindo um link novo ao dsh…');
    setHint('Se o túnel trocou de URL, reabrir esta página é o caminho de volta.');
    openPool(host.relays);
    publishHello();
    timers.resend = window.setInterval(publishHello, RESEND_MS);
    timers.offline = window.setTimeout(function () {
      timers.offline = null;
      if (finished) return;
      setState('offline', 'dsh offline', 'abra este link de novo em alguns minutos.');
    }, OFFLINE_MS);
    timers.expire = window.setTimeout(showExpired, LINK_TIMEOUT_MS);
  }

  /* ------------------------------------------------------------------ boot */

  function boot() {
    if (!N) {
      setState('offline', 'Não carregou', 'recarregue a página. o suporte a Nostr não veio embutido.');
      return;
    }

    device = loadDevice();
    host = loadHost();
    offer = readOffer();

    if (offer) {
      mode = offer.expiresAt && offer.expiresAt <= Date.now() ? 'expired' : 'pair';
    } else {
      mode = devicesReady() ? 'hello' : 'none';
    }

    if (mode === 'pair' && !device) device = newDevice();

    if (mode === 'expired') {
      showExpired();
      revealForget();
      return;
    }

    if (mode === 'none') {
      var detail = hashLooksLikePair
        ? 'o link de pareamento está incompleto. escaneie o QR de novo.'
        : 'no dsh, abra Configurações → Acesso remoto e aponte a câmera para o código.';
      setState('sem-oferta', 'Escaneie um QR', detail);
      setHint('A chave deste navegador fica guardada só aqui. nada é enviado a servidor nenhum.');
      revealForget();
      return;
    }

    revealForget();
    if (mode === 'pair') startPair();
    else startHello();
  }

  function devicesReady() {
    return Boolean(device && host);
  }

  /* --------------------------------------------------------------- eventos */

  els.restart.addEventListener('click', function () {
    els.restart.hidden = true;
    syncActions();
    if (mode === 'pair' && (!offer || !offer.expiresAt || offer.expiresAt <= Date.now())) {
      window.location.replace(window.location.pathname + window.location.search);
    } else {
      window.location.reload();
    }
  });

  els.forget.addEventListener('click', function () {
    lsDel(LS_DEVICE);
    lsDel(LS_HOST);
    window.location.replace(window.location.pathname + window.location.search);
  });

  window.addEventListener('pagehide', function () {
    clearAllTimers();
    if (pool) {
      pool.close();
      pool = null;
    }
  });

  try {
    boot();
  } catch (e) {
    setState('offline', 'Algo deu errado', 'recarregue a página e escaneie o QR de novo.');
  }
})();
