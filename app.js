'use strict';
// Japan Explorer: roteiro, locais, notas e mapa offline. Dados vêm de data/dados.enc (AES-GCM, gerado pelo build.py).

const BASE = new URL('.', location.href).href;
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
const ALIAS = { TOKYO: 'TOQUIO', KYOTO: 'QUIOTO' };
const cidadeNorm = s => ALIAS[norm(s)] || norm(s);
const hojeJST = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
const ddmm = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '';
const mb = b => Math.round(b / 1048576) + ' MB';
const http = u => /^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '';
// Planilha vem em maiúsculas: palavra toda em caixa alta com 4+ letras vira Title Case; siglas (JR, HND) e tokens com dígito ficam.
const MINUS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'O', 'A', 'OS', 'AS', 'EM', 'NO', 'NA', 'NOS', 'NAS', 'PRA', 'COM', 'POR', 'AO', 'OU']);
const tc = s => String(s ?? '').replace(/(https?:\/\/\S+)|[\p{L}\d]+/gu, (w, u, i, all) => {
  if (u || /\d/.test(w) || w !== w.toUpperCase()) return w;
  if (w.length >= 4) return w[0] + w.slice(1).toLowerCase();
  if (MINUS.has(w) && i > 0 && /^\s+\p{Lu}{2}/u.test(all.slice(i + w.length))) return w.toLowerCase();
  if (/\p{L}{4}-$/u.test(all.slice(0, i))) return w.toLowerCase();   // KINKAKU-JI -> Kinkaku-ji
  return w;
});
const fdata = c => /^\d{4}-\d{2}-\d{2}/.test(c || '') ? ddmm(c) + c.slice(10) : (c || '');   // "2026-10-27 11:20" -> "27/10 11:20"
const CATS = { comida: '#e4572e', 'café': '#a0522d', bar: '#8e44ad', templo: '#bc002d', museu: '#2e86de', natureza: '#27ae60', compras: '#f39c12', mirante: '#16a085', 'experiência': '#d35400', bairro: '#e84393', outro: '#7f8c8d' };
const catDe = c => Object.keys(CATS).find(k => norm(k) === norm(c)) || 'outro';

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { alert('Não foi possível salvar no aparelho: ' + e.message); } },
};

let D = null;   // dados decifrados
let CHAVE = null;  // chave AES derivada no login; também abre as páginas dos documentos
let mapa = null;
const notas = store.get('notas', {});

// ---------- cripto ----------
async function decifrar(senha) {
  const r = await fetch('data/dados.enc');
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const enc = await r.json();
  const b = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b(enc.salt), iterations: enc.iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b(enc.iv) }, key, b(enc.ct));
  CHAVE = key;
  return JSON.parse(new TextDecoder().decode(pt));
}

async function entrar(senha) {
  try { D = await decifrar(senha); }
  catch (e) { return e.name === 'OperationError' ? 'Senha errada.' : `Não consegui carregar os dados (${e.message}). Abra uma vez com internet.`; }
  store.set('senha', senha);
  return null;
}

// ---------- locais ----------
function coordsDeUrl(u) {
  try { u = decodeURIComponent(u || ''); } catch { u = u || ''; }
  const m = u.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || u.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)
    || u.match(/[?&](?:q|query|ll|destination|center)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  return m ? [+m[1], +m[2]] : null;
}

function normalizar(r, importado = false) {
  const g = k => String(r[k] ?? '').trim();
  const nome = g('nome');
  if (!nome) return null;
  let lat = parseFloat(g('lat').replace(',', '.')), lng = parseFloat(g('lng').replace(',', '.'));
  if (!(isFinite(lat) && isFinite(lng))) [lat, lng] = coordsDeUrl(g('maps_url')) || [NaN, NaN];
  const noJapao = lat > 20 && lat < 46 && lng > 122 && lng < 154;
  return {
    id: norm(nome) + '|' + cidadeNorm(g('cidade')),
    nome, cidade: g('cidade'), bairro: g('bairro'), categoria: catDe(g('categoria')),
    lat: noJapao ? lat : null, lng: noJapao ? lng : null,
    maps_url: http(g('maps_url')), nota: g('nota'), fonte_url: http(g('fonte_url')),
    o_que: g('o_que'), por_que: g('por_que'), dicas: g('dicas'), fontes: (Array.isArray(r.fontes) ? r.fontes : []).map(http).filter(Boolean),
    data: /^\d{4}-\d{2}-\d{2}$/.test(g('data')) ? g('data') : '', importado,
  };
}

function locais() {
  const m = new Map();
  for (const l of [...D.locais, ...store.get('locais_importados', [])]) m.set(l.id, l);
  return [...m.values()];
}

function parseCSV(t) {
  t = t.replace(/^﻿/, '');
  const l1 = t.split('\n')[0];
  const sep = (l1.match(/;/g) || []).length > (l1.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [h, ...rest] = rows.filter(r => r.some(x => x.trim()));
  if (!h) return [];
  const keys = h.map(k => k.trim().toLowerCase());
  return rest.map(r => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ''])));
}

// Aceita lista JSON de locais, CSV com cabeçalho, ou o backup exportado por este app.
function importarTexto(txt) {
  const t = txt.trim();
  let regs, extra = '';
  if (t.startsWith('[') || t.startsWith('{')) {
    const obj = JSON.parse(t);
    if (obj && obj.tipo === 'japan-explorer-backup') {
      Object.assign(notas, obj.notas || {}); salvarNotas();
      extra = `\n${Object.keys(obj.notas || {}).length} notas restauradas.`;
      regs = obj.locais_importados || [];
    } else regs = Array.isArray(obj) ? obj : (obj.locais || []);
  } else regs = parseCSV(t);
  const ok = [], ruins = [];
  regs.forEach((r, i) => { const n = normalizar(r, true); n ? ok.push(n) : ruins.push(i + 1); });
  const m = new Map(store.get('locais_importados', []).map(l => [l.id, l]));
  ok.forEach(l => m.set(l.id, l));
  store.set('locais_importados', [...m.values()]);
  const semPin = ok.filter(l => l.lat == null).length;
  return `${ok.length} de ${regs.length} locais importados.` + (semPin ? `\n${semPin} sem coordenada (aparecem na lista, sem pin no mapa).` : '')
    + (ruins.length ? `\nIgnorados (sem nome): itens ${ruins.join(', ')}.` : '') + extra;
}

// ---------- notas ----------
function salvarNotas() { clearTimeout(salvarNotas.t); store.set('notas', notas); }
const campoNota = (chave, ph) => `<textarea class="nota" data-nota="${esc(chave)}" placeholder="${esc(ph)}">${esc(notas[chave] || '')}</textarea>`;
document.addEventListener('input', e => {
  const k = e.target.dataset && e.target.dataset.nota;
  if (!k) return;
  const v = e.target.value;
  if (v) notas[k] = v; else delete notas[k];
  document.querySelectorAll('textarea[data-nota]').forEach(t => { if (t !== e.target && t.dataset.nota === k) t.value = v; });
  clearTimeout(salvarNotas.t); salvarNotas.t = setTimeout(salvarNotas, 400);
});
document.addEventListener('visibilitychange', () => { if (document.hidden) salvarNotas(); });

// ---------- render ----------
const hostDe = u => { try { return new URL(u.replace(/&amp;/g, '&')).hostname.replace(/^www\./, ''); } catch { return 'link'; } };
const fmt = t => esc(t).replace(/\[([^\]]+)\]/g, '<span class="tag">$1</span>')
  .replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener">${hostDe(u)}</a>`);
const badge = s => s ? `<span class="badge ${esc(s)}">${esc(s)}</span>` : '';
const linkMaps = l => http(l.maps_url) || 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([l.nome, l.bairro, l.cidade].filter(Boolean).join(', '));
const linkMapsHotel = h => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(h.nome + ' ' + (h.endereco_en || h.cidade || ''));

function hotelDe(data) {
  const dur = h => Date.parse(h.checkout) - Date.parse(h.checkin);
  return [...D.hoteis].sort((a, b) => dur(a) - dur(b)).find(h => h.checkin <= data && data < h.checkout);
}

// Voo aparece em todos os dias entre a partida e a chegada; nesses dias (menos o da chegada) não há locais da cidade.
const diaChegada = v => String(v.chegada || '').slice(0, 10) || v.data;
const voosDoDia = data => (D.voos || []).filter(v => v.data <= data && data <= diaChegada(v));
const emVoo = data => (D.voos || []).some(v => v.data <= data && data < diaChegada(v));

// Cidade com centenas de locais (Tóquio) vira um botão por cidade que abre a aba Locais já filtrada.
const botoesCidade = ls => `<div class="botoes">${[...Map.groupBy(ls, l => l.cidade)].map(([c, g]) =>
  `<button class="btn" data-cidade="${esc(c)}">Ver ${g.length} em ${esc(c)}</button>`).join('')}</div>`;

function locaisDoDia(d) {
  const onde = norm(d.local + ' ' + d.dormir);
  return locais().filter(l => l.data === d.data || (!l.data && l.cidade && !emVoo(d.data) && onde.includes(cidadeNorm(l.cidade))));
}

function blocoHotel(h, nomePlanilha) {
  if (!h) return `<p>${esc(tc(nomePlanilha))}</p>`;
  const tel = h.telefone || privado().telefones?.[h.nome];  // celular de anfitrião só vem do arquivo de documentos
  return `<div class="hotel"><p><b>${esc(h.nome)}</b><br><span class="mute">check-in ${esc(h.checkin_hora || '?')} · check-out ${esc(h.checkout_hora || '?')}</span></p>
    ${h.endereco_jp ? `<p class="jp">${esc(h.endereco_jp)}</p>` : ''}
    ${h.endereco_en ? `<p class="mute">${esc(h.endereco_en)}</p>` : ''}
    <div class="botoes">${botoesDocs(docsDe(h.nome))}<a class="btn" href="${esc(linkMapsHotel(h))}" target="_blank" rel="noopener">Google Maps</a>
    ${h.lat != null ? `<button class="btn" data-mapa-hotel="${esc(h.nome)}">Ver no mapa</button>` : ''}
    ${tel ? `<a class="btn" href="tel:${esc(tel.replace(/[^\d+]/g, ''))}">Ligar</a>` : ''}</div>
    ${h.obs ? `<p class="mute">${fmt(h.obs)}</p>` : ''}</div>`;
}

const pendente = d => d.passeio_status === 'aberto' || ['aberto', 'validar'].includes(d.transporte_status);

// noRoteiro: o resumo do <details> já mostra data e local, então o card não repete o título.
function cardDia(d, noRoteiro = false) {
  const h = hotelDe(d.data), ls = locaisDoDia(d), ds = docsDoDia(d.data);
  const prog = d.programa.flatMap(t => t.split(/;|\s\/\s/)).map(s => s.trim()).filter(Boolean);
  const horas = [d.saida && 'Saída ' + d.saida, d.chegada && 'Chegada ' + d.chegada].filter(Boolean).join(' · ');
  return `<div class="dia">
    ${noRoteiro ? '' : `<div class="dia-top"><b>${esc(tc(d.dia))}</b> · ${esc(tc(d.semana))} ${ddmm(d.data)}</div><h2>${esc(tc(d.local))}</h2>`}
    ${horas ? `<p class="mute">${esc(horas)}</p>` : ''}
    ${voosDoDia(d.data).map(v => `<h3>Voo ${esc(v.de)} → ${esc(v.para)}</h3><p>Sai ${esc(ddmm(v.data))} ${esc(v.partida)} · chega ${esc(fdata(v.chegada))}<br><span class="mute">${esc(v.voos)}. ${fmt(v.obs || '')}</span></p>`).join('')}
    ${ds.length ? `<h3>Documentos</h3><div class="botoes">${botoesDocs(ds)}${noRoteiro || !ds.some(x => x.pontos.length) ? '' : '<button data-acao="gps">Estou perto? (GPS)</button>'}</div>` : ''}
    ${prog.length ? `<h3>Programa ${badge(d.passeio_status)}</h3><ul>${prog.map(p => `<li>${fmt(tc(p))}</li>`).join('')}</ul>` : ''}
    ${d.transporte ? `<h3>Transporte ${badge(d.transporte_status)}</h3><p>${fmt(tc(d.transporte))}</p>` : ''}
    ${d.hotel || h ? `<h3>Dormir · ${esc(tc(d.dormir))}</h3>${blocoHotel(h, d.hotel)}` : ''}
    ${d.links.length ? `<h3>Links</h3><div class="botoes">${d.links.map(u => `<a class="btn" href="${esc(u)}" target="_blank" rel="noopener">${esc(hostDe(u))}</a>`).join('')}</div>` : ''}
    ${ls.length ? `<h3>Locais salvos aqui (${ls.length})</h3>${ls.length > 12 ? botoesCidade(ls)
      : `<div class="chips">${ls.map(l => `<button class="chip" data-ver="${esc(l.id)}">${esc(l.nome)}</button>`).join('')}</div>`}` : ''}
    <h3>Nota do dia</h3>${campoNota('dia:' + d.data, 'Anotações deste dia…')}
  </div>`;
}

function renderHoje() {
  const hoje = hojeJST(), R = D.roteiro;
  let i = R.findIndex(x => x.data === hoje), aviso = '';
  if (i < 0) {
    if (hoje < R[0].data) { i = 0; aviso = `Faltam ${Math.round((Date.parse(R[0].data) - Date.parse(hoje)) / 864e5)} dia(s) para o embarque.`; }
    else { i = R.length - 1; aviso = 'Viagem encerrada.'; }
  }
  const prox = R[i + 1];
  $('#hoje').innerHTML = (aviso ? `<p class="aviso">${aviso}</p>` : '') + cardDia(R[i])
    + (prox ? `<h3>Amanhã · ${ddmm(prox.data)}</h3><div class="info-item"><b>${esc(tc(prox.local))}</b><br><span class="mute">${esc(tc(prox.hotel || prox.dormir))}</span>${prox.transporte ? `<br>${fmt(tc(prox.transporte))}` : ''}</div>` : '');
  const dn = R[i].dia ? ' · ' + R[i].dia.toLowerCase() : '';
  $('#sub').textContent = new Date().toLocaleDateString('pt-BR', { timeZone: 'Asia/Tokyo', weekday: 'short', day: '2-digit', month: '2-digit' }) + ' JST' + (aviso ? '' : dn);
}

function renderRoteiro() {
  const hoje = hojeJST();
  $('#roteiro').innerHTML = D.roteiro.map(d => `<details class="linha" id="d-${d.data}"${d.data === hoje ? ' open' : ''}>
    <summary><span class="data${d.data === hoje ? ' hoje-marca' : ''}">${ddmm(d.data)}<small>${esc(d.semana.slice(0, 3).toLowerCase())}</small></span>
    <span class="onde">${esc(tc(d.local))}${pendente(d) ? '<span class="pend">pendente</span>' : ''}<small>${esc(tc(d.hotel || d.dormir || ''))}</small></span></summary>${cardDia(d, true)}</details>`).join('');
}

// ---------- documentos (PDFs renderizados em JPEG e cifrados pelo build.py) ----------
const docsDe = ref => (D.docs || []).filter(d => d.ref === ref);
const docsDoDia = data => (D.docs || []).filter(d => d.janelas.some(([a, b]) => a <= data && data <= b));
// Link de verdade para o PDF no Google Drive: sem cópia offline e com internet, o toque abre o Drive (o clique não intercepta).
const botoesDocs = ds => ds.map(d => `<a class="btn doc" data-doc="${esc(d.id)}" href="${esc(d.drive || '#')}" target="_blank" rel="noopener">${esc(d.rotulo)}</a>`).join('');

// Cópia offline opcional: páginas cifradas no arquivo documentos-japao.bin (Google Drive), importado em Info → App.
const abrirAes = async b => new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, CHAVE, b.slice(12)));
const b64bytes = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const privado = () => store.get('privado', {});

async function paginaDoc(u) {
  const r = await (await caches.open('docs')).match(BASE + u);
  if (!r) throw new Error('documento não importado neste aparelho');
  return new Blob([await abrirAes(new Uint8Array(await r.arrayBuffer()))], { type: 'image/jpeg' });
}

async function importarDocs(texto) {
  const p = JSON.parse(texto), c = await caches.open('docs');
  const priv = JSON.parse(new TextDecoder().decode(await abrirAes(b64bytes(p.privado))));  // senha errada falha aqui
  for (const [nome, b64] of Object.entries(p.paginas)) await c.put(BASE + 'docs/' + nome, new Response(b64bytes(b64)));
  store.set('privado', priv);
  await contarDocs();
}

// Só chega aqui com cópia offline completa ou sem internet (ver o clique em [data-doc]).
async function abrirDoc(id) {
  const d = (D.docs || []).find(x => x.id === id);
  if (!d) return;
  abrirDoc.atual = d; abrirDoc.blobs = [];
  $('#doctit').textContent = d.titulo;
  $('#doc').hidden = false; $('#doc').scrollTop = 0;
  if (!docsAqui.has(d.id)) return semCopia(d);
  $('#docpags').innerHTML = '<p class="mute" style="padding:12px">Abrindo…</p>';
  try {
    abrirDoc.blobs = await Promise.all(d.paginas.map(paginaDoc));
    if (abrirDoc.atual === d) $('#docpags').innerHTML = abrirDoc.blobs.map(b => `<img src="${URL.createObjectURL(b)}" alt="">`).join('');
  } catch { semCopia(d); }
}

const semCopia = d => {
  $('#docpags').innerHTML = `<div class="aviso" style="margin:12px"><p>Sem cópia offline deste documento${navigator.onLine ? '' : ' e sem internet'}.</p>
    <div class="botoes">${d.drive ? `<a class="btn" href="${esc(d.drive)}" target="_blank" rel="noopener">Abrir no Google Drive</a>` : ''}
    <label class="btn pri">Importar cópia offline<input type="file" data-arqdocs hidden></label></div><p class="mute" id="semcopiamsg"></p></div>`;
};

function fecharDoc() {
  $('#docpags').querySelectorAll('img').forEach(i => URL.revokeObjectURL(i.src));
  $('#docpags').innerHTML = ''; $('#doc').hidden = true; abrirDoc.atual = null;
}

async function compartilharDoc() {
  const d = abrirDoc.atual;
  const files = (abrirDoc.blobs || []).map((b, i) => new File([b], `${d.id}-${i + 1}.jpg`, { type: 'image/jpeg' }));
  if (files.length && navigator.canShare?.({ files })) { try { await navigator.share({ files, title: d.titulo }); } catch { } }
  else alert('Compartilhar não está disponível neste navegador.');
}

// Cache 'docs' persiste entre versões (nome = hash do conteúdo); página que saiu do build é apagada.
let estadoDocs = '', docsAqui = new Set();   // ids com todas as páginas no cache 'docs'
async function contarDocs() {
  const c = await caches.open('docs'), todas = (D.docs || []).flatMap(d => d.paginas.map(u => BASE + u));
  const tem = new Set();
  for (const k of await c.keys()) todas.includes(k.url) ? tem.add(k.url) : await c.delete(k);
  docsAqui = new Set((D.docs || []).filter(d => d.paginas.every(u => tem.has(BASE + u))).map(d => d.id));
  estadoDocs = `Documentos neste aparelho: ${tem.size} de ${todas.length} páginas.`
    + (tem.size < todas.length ? ' Sem cópia offline, os botões dos documentos abrem o PDF no Google Drive (precisa de internet). Para ter offline, importe documentos-japao.bin (Google Drive, Japan Explorer/dashboard).' : '');
  if ($('#armazdocs')) $('#armazdocs').textContent = estadoDocs;
}

// ---------- aviso por GPS ----------
const distM = (a, b, c, d) => { const r = Math.PI / 180; return Math.hypot((d - b) * r * Math.cos((a + c) / 2 * r), (c - a) * r) * 6371e3; };
// Documentos válidos na data com algum ponto (lat, lng, raio, nome) dentro do raio.
const docsPerto = (lat, lng, data) => docsDoDia(data).flatMap(d => {
  const p = d.pontos.find(([a, b, raio]) => distM(lat, lng, a, b) <= raio);
  return p ? [{ doc: d, onde: p[3] }] : [];
});

function avisoPerto(pos, data = hojeJST()) {
  const fechado = store.get('perto_fechado', {});
  const vis = docsPerto(pos.coords.latitude, pos.coords.longitude, data).filter(x => fechado[x.doc.id] !== data);
  avisoPerto.ultimo = vis;
  $('#perto').hidden = !vis.length;
  if (vis.length) $('#perto').innerHTML = `<b>Perto de ${esc([...new Set(vis.map(x => x.onde))].join(', '))}</b>
    <div class="botoes">${botoesDocs(vis.map(x => x.doc))}<button data-acao="fechar-perto">Fechar</button></div>`;
  return vis.length;
}

// Sem pedir permissão: só consulta o GPS se o usuário já autorizou (pelo botão do mapa ou "Estou perto?").
function checarGPS() {
  if (document.hidden || !navigator.geolocation || !navigator.permissions) return;
  navigator.permissions.query({ name: 'geolocation' }).then(p => {
    if (p.state === 'granted') navigator.geolocation.getCurrentPosition(p => avisoPerto(p), () => { }, { maximumAge: 120000, timeout: 10000 });
  }).catch(() => { });
}

// Comentário do local: nome em japonês, o que é, por que ir e dicas (triagem do Instagram).
const comentario = l => [['', l.nota], ['O que', l.o_que], ['Por que ir', l.por_que], ['Dica', l.dicas]].filter(([, t]) => t)
  .map(([r, t]) => `<p>${r ? `<b>${r}:</b> ` : ''}${fmt(t)}</p>`).join('');
const linksPost = l => { const fs = l.fontes?.length ? l.fontes : [l.fonte_url].filter(Boolean);
  return fs.map((u, i) => `<a class="btn" href="${esc(u)}" target="_blank" rel="noopener">Post${fs.length > 1 ? ' ' + (i + 1) : ''}</a>`).join(''); };

function itemLocal(l) {
  return `<details class="local" id="l-${esc(l.id)}"><summary><i style="background:${CATS[l.categoria]}"></i>
    <span>${esc(l.nome)}<small>${esc([l.categoria, l.bairro, l.data && ddmm(l.data)].filter(Boolean).join(' · '))}${l.lat == null ? ' · sem pin' : ''}</small></span></summary>
    <div class="corpo">${comentario(l)}
    <div class="botoes"><a class="btn" href="${esc(linkMaps(l))}" target="_blank" rel="noopener">Abrir no Google Maps</a>
    ${l.lat != null ? `<button class="btn" data-mapa="${esc(l.id)}">Ver no mapa</button>` : ''}
    ${linksPost(l)}
    ${l.importado ? `<button class="btn" data-remover="${esc(l.id)}">Remover</button>` : ''}</div>
    ${campoNota('local:' + l.id, 'Minha nota…')}</div></details>`;
}

function renderLocais() {
  const L = locais(), q = norm($('#busca').value), cat = $('#fcat').value, cid = $('#fcid').value;
  const cids = [...new Set(L.map(l => l.cidade).filter(Boolean))].sort();
  $('#fcid').innerHTML = '<option value="">Cidade</option>' + cids.map(c => `<option${c === cid ? ' selected' : ''}>${esc(c)}</option>`).join('');
  const vis = L.filter(l => (!cat || l.categoria === cat) && (!cid || l.cidade === cid)
    && (!q || norm([l.nome, l.bairro, l.cidade, l.nota, l.o_que, l.por_que, l.dicas].join(' ')).includes(q)));
  if (!L.length) { $('#lista').innerHTML = '<p class="aviso">Nenhum local ainda. Importe um arquivo JSON ou CSV em Info → Importar locais.</p>'; return; }
  const grupos = new Map();
  vis.forEach(l => { const g = l.cidade || 'Sem cidade'; grupos.has(g) ? grupos.get(g).push(l) : grupos.set(g, [l]); });
  const lista = D.links?.lista_maps ? `<div class="botoes"><a class="btn" href="${esc(D.links.lista_maps)}" target="_blank" rel="noopener">Lista "Japão by Theus" no Google Maps</a></div>` : '';
  $('#lista').innerHTML = lista + ([...grupos].map(([g, ls]) => `<h3 class="grupo">${esc(g)} <small>${ls.length}</small></h3>` + ls.map(itemLocal).join('')).join('')
    || '<p class="mute">Nada encontrado.</p>');
}

function renderInfo() {
  const item = (titulo, corpo) => `<div class="info-item"><b>${titulo}</b>${corpo}</div>`;
  const secao = (titulo, corpo, aberta = false) => corpo ? `<details class="secao"${aberta ? ' open' : ''}><summary>${titulo}</summary>${corpo}</details>` : '';
  const docs = ref => { const b = botoesDocs(docsDe(ref)); return b ? `<div class="botoes">${b}</div>` : ''; };
  const voos = (D.voos || []).map(v => item(`${ddmm(v.data)} · ${esc(v.de)} → ${esc(v.para)}`,
    `<p>${esc([v.partida && 'sai ' + v.partida, v.chegada && 'chega ' + fdata(v.chegada)].filter(Boolean).join(' · '))}</p><p class="mute">${esc(v.voos)} ${fmt(v.obs || '')}</p>`)).join('');
  const passes = docsDe('passe').map(d => item(esc(d.titulo), `<div class="botoes">${botoesDocs([d])}</div>`)).join('');
  const hoteis = (D.hoteis || []).map(h => item(`${ddmm(h.checkin)}–${ddmm(h.checkout)} · ${esc(h.cidade)}`,
    blocoHotel(h) + (h.cancelamento ? `<p class="mute">Cancelamento: ${fmt(h.cancelamento)}</p>` : ''))).join('');
  const reservas = (D.reservas || []).map(r => item(`${ddmm(r.data)} ${esc(r.hora || '')} · ${esc(r.nome)}`,
    `<p>${fmt(r.local || '')}</p><p class="mute">${fmt(r.obs || '')}</p>${docs(r.nome)}`)).join('');
  const pend = (D.pendencias || []).map(s => `<h3>${esc(s.titulo)}</h3>` + s.linhas.map(l => item(fmt(l[0]),
    `<p class="mute">${l.slice(1).filter(Boolean).map(fmt).join(' · ')}</p>`)).join('')).join('');
  const seg = D.seguro ? item(esc(D.seguro.seguradora || 'Seguro viagem'),
    `<div class="botoes">${(D.seguro.telefones || []).map(t => `<a class="btn" href="tel:${esc(String(t).replace(/[^\d+]/g, ''))}">${esc(t)}</a>`).join('')}</div><p class="mute">${fmt(D.seguro.obs || '')}</p>${docs('seguro')}`) : '';
  $('#info').innerHTML = secao('Emergência e seguro viagem', seg, true)
    + secao('Voos', voos && docs('voo') + voos)
    + secao('Passes de trem', passes)
    + secao('Hospedagens', hoteis)
    + secao('Reservas e ingressos', reservas)
    + secao('Outros documentos', docs('outros'))
    + secao('Pendências', pend)
    + secao('Locais e backup', `<div class="info-item"><p>Importar locais (JSON ou CSV: nome, cidade, bairro, categoria, lat, lng, maps_url, nota, fonte_url, data) ou restaurar um backup.</p>
      <div class="botoes"><label class="btn pri">Importar arquivo<input type="file" id="arquivo" hidden></label>
      <button data-acao="exemplo">Importar exemplo</button><button data-acao="exportar">Exportar backup</button></div>
      <p id="importmsg" class="mute"></p></div>`)
    + secao('App', `<div class="info-item"><p id="armaz" class="mute"></p><p id="armazdocs" class="mute">${esc(estadoDocs)}</p>
      <div class="botoes"><label class="btn pri">Importar documentos<input type="file" id="arqdocs" data-arqdocs hidden></label></div>
      <p class="mute">Dados gerados em ${esc(D.gerado)}.</p>
      <div class="botoes"><button data-acao="gps">Ativar aviso por GPS</button><button data-acao="atualizar">Procurar atualização</button><button data-acao="sair">Esquecer senha</button></div></div>`);
  navigator.storage?.estimate?.().then(({ usage, quota }) => { $('#armaz').textContent = `Armazenamento usado: ${mb(usage)} de ${mb(quota)}.`; });
}

function mostrarLocal(id) {
  aba('locais');
  $('#busca').value = ''; $('#fcat').value = ''; $('#fcid').value = ''; renderLocais();
  const el = document.getElementById('l-' + id);
  if (el) { el.open = true; el.scrollIntoView({ block: 'center' }); }
}

// ---------- dicas (posts salvos que não são lugar: etiqueta, frases, golpes, apps…) ----------
function renderDicas() {
  const X = D.dicas || { categorias: [], tipos: [], itens: [] };
  const q = norm($('#dbusca').value), cat = $('#dcat').value, cid = $('#dcid').value, tipo = $('#dtipo').value;
  const opc = (sel, rot, vals, atual) => { $(sel).innerHTML = `<option value="">${rot}</option>`
    + vals.map(([v, n]) => `<option value="${esc(v)}"${v === atual ? ' selected' : ''}>${esc(n)}</option>`).join(''); };
  opc('#dcat', 'Categoria', X.categorias.map(c => [c.id, c.nome]), cat);
  opc('#dtipo', 'Tipo', X.tipos.map(t => [t.id, t.nome]), tipo);
  opc('#dcid', 'Cidade', [...new Set(X.itens.flatMap(i => i.cidades || []))].sort().map(c => [c, c]), cid);
  const T = Object.fromEntries(X.tipos.map(t => [t.id, t.nome]));
  const vis = X.itens.filter(i => (!cat || i.categoria === cat) && (!tipo || i.tipo === tipo) && (!cid || (i.cidades || []).includes(cid))
    && (!q || norm([i.titulo, i.texto, ...(i.locais || []), ...(i.frases || []).flatMap(f => [f.jp, f.romaji, f.pt])].join(' ')).includes(q)));
  const item = (i, cor) => `<details class="local"><summary><i style="background:${esc(cor)}"></i>
    <span>${esc(i.titulo)}<small>${esc([T[i.tipo], (i.cidades || []).join(', ')].filter(Boolean).join(' · '))}</small></span></summary>
    <div class="corpo"><p>${fmt(i.texto)}</p>
    ${(i.frases || []).length ? `<ul>${i.frases.map(f => `<li><span class="jp">${esc(f.jp)}</span> <em>${esc(f.romaji)}</em> · ${esc(f.pt)}${f.quando ? `<br><span class="mute">${esc(f.quando)}</span>` : ''}</li>`).join('')}</ul>` : ''}
    ${(i.locais || []).length ? `<p class="mute">Lugares citados: ${esc(i.locais.join(', '))}</p>` : ''}
    <div class="botoes">${(i.fontes || []).filter(f => http(f.url)).map((f, n, fs) => `<a class="btn" href="${esc(f.url)}" target="_blank" rel="noopener">Post${fs.length > 1 ? ' ' + (n + 1) : ''}</a>`).join('')}</div></div></details>`;
  const corpo = X.categorias.map(c => { const g = vis.filter(i => i.categoria === c.id);
    return g.length ? `<h3 class="grupo">${esc(c.nome)} <small>${g.length}</small></h3>` + g.map(i => item(i, c.cor)).join('') : ''; }).join('');
  $('#dlista').innerHTML = (D.links?.kokoroe ? `<div class="botoes"><a class="btn" href="${esc(D.links.kokoroe)}" target="_blank" rel="noopener">Abrir Kokoroe (artefato de dicas)</a></div>` : '')
    + (corpo || '<p class="mute">Nada encontrado.</p>');
}

// ---------- mapa ----------
const carregar = src => new Promise((ok, erro) => {
  if (document.querySelector(`script[src="${src}"]`)) return ok();
  const s = Object.assign(document.createElement('script'), { src, onload: ok, onerror: () => erro(new Error('falha ao carregar ' + src)) });
  document.head.appendChild(s);
});
const urlMapa = m => BASE + 'mapas/' + m.arquivo + '.pmtiles';
let protocolo;

const msgMapa = t => { $('#mapamsg').textContent = t; $('#mapamsg').hidden = !t; };

async function estadoMapas() {
  const c = await caches.open('mapas');
  const ok = [];
  for (const m of D.mapas) if (await c.match(urlMapa(m))) ok.push(m);
  const total = D.mapas.reduce((s, m) => s + m.bytes, 0);
  msgMapa(ok.length === D.mapas.length ? '' : `Offline: ${ok.length}/${D.mapas.length} (${mb(total)} no total)`);
  $('#baixar').hidden = ok.length === D.mapas.length;
  return ok.length;
}

async function baixarMapas() {
  const btn = $('#baixar');
  btn.disabled = true;
  try {
    await navigator.storage?.persist?.();
    const c = await caches.open('mapas');
    for (const [i, m] of D.mapas.entries()) {
      const url = urlMapa(m);
      if (await c.match(url)) continue;
      msgMapa(`Baixando ${i + 1}/${D.mapas.length}: ${m.arquivo} (${mb(m.bytes)})…`);
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(`${m.arquivo}: HTTP ${r.status}`);
      await c.put(url, r);
      const salvo = await (await c.match(url)).blob();
      if (salvo.size !== m.bytes) { await c.delete(url); throw new Error(`${m.arquivo}: download incompleto`); }
    }
    mapa.remove(); mapa = null;
    await abrirMapa();
  } catch (e) {
    alert('Falha ao baixar mapas: ' + e.message + '\nTente de novo com Wi-Fi.');
  } finally { btn.disabled = false; estadoMapas(); }
}

function geoPontos() {
  const f = [], pt = (lng, lat, p) => f.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: p });
  for (const h of D.hoteis) if (h.lat != null) pt(h.lng, h.lat, { id: 'h:' + h.nome, nome: h.nome, cor: '#111', hotel: 1 });
  for (const l of locais()) if (l.lat != null) pt(l.lng, l.lat, { id: l.id, nome: l.nome, cor: CATS[l.categoria], hotel: 0 });
  return { type: 'FeatureCollection', features: f };
}

function popup(id) {
  const h = id.startsWith('h:') && D.hoteis.find(x => 'h:' + x.nome === id);
  const l = !h && locais().find(x => x.id === id);
  const p = h || l;
  if (!p || p.lat == null) return;
  const html = h
    ? `<b>${esc(h.nome)}</b><br>${ddmm(h.checkin)}–${ddmm(h.checkout)}${h.endereco_jp ? `<br>${esc(h.endereco_jp)}` : ''}<div class="botoes">${botoesDocs(docsDe(h.nome))}<a class="btn" href="${esc(linkMapsHotel(h))}" target="_blank" rel="noopener">Google Maps</a></div>`
    : `<b>${esc(l.nome)}</b><br><small>${esc([l.categoria, l.bairro, l.cidade].filter(Boolean).join(' · '))}</small>${comentario(l)}${notas['local:' + l.id] ? `<p><i>${esc(notas['local:' + l.id])}</i></p>` : ''}
       <div class="botoes"><a class="btn" href="${esc(linkMaps(l))}" target="_blank" rel="noopener">Abrir no Google Maps</a><button class="btn" data-ver="${esc(l.id)}">Detalhes</button></div>`;
  new maplibregl.Popup({ maxWidth: '270px' }).setLngLat([p.lng, p.lat]).setHTML(html).addTo(mapa);
}

async function criarMapa() {
  await carregar('vendor/maplibre-gl.js'); await carregar('vendor/pmtiles.js'); await carregar('vendor/basemaps.js');
  if (!protocolo) {
    protocolo = new pmtiles.Protocol(); maplibregl.addProtocol('pmtiles', protocolo.tile);
    // ponytail: faixa de glifo ausente derruba o tile inteiro; devolve vazio e só o caractere some
    maplibregl.addProtocol('glifos', async p => {
      const r = await fetch(BASE + 'vendor/fonts/' + decodeURIComponent(p.url.slice(9)) + '.pbf').catch(() => null);
      return { data: r && r.ok ? await r.arrayBuffer() : new ArrayBuffer(0) };
    });
  }
  const c = await caches.open('mapas'), sources = {}, layers = [];
  for (const m of D.mapas) {
    const r = await c.match(urlMapa(m));
    // ponytail: arquivo inteiro como Blob (lido sob demanda pelo FileSource); sem cache, lê por range direto da rede
    const p = new pmtiles.PMTiles(r ? new pmtiles.FileSource(new File([await r.blob()], m.arquivo + '.pmtiles')) : urlMapa(m));
    protocolo.add(p);
    sources[m.arquivo] = { type: 'vector', url: 'pmtiles://' + p.source.getKey(),
      attribution: '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a> · <a href="https://protomaps.com">Protomaps</a>' };
    const ls = basemaps.layers(m.arquivo, basemaps.namedFlavor('light'), { lang: 'en' });
    layers.push(...ls.filter(l => l.type !== 'background' || !layers.length).map(l => ({ ...l, id: m.arquivo + ':' + l.id })));
  }
  const h = hotelDe(hojeJST()) || D.hoteis.find(x => x.lat != null);
  mapa = new maplibregl.Map({
    container: 'map', center: h ? [h.lng, h.lat] : [139.77, 35.68], zoom: 13, attributionControl: { compact: true },
    style: { version: 8, glyphs: 'glifos://{fontstack}/{range}', sprite: BASE + 'vendor/sprites/light', sources, layers },
  });
  mapa.addControl(new maplibregl.NavigationControl({ showCompass: false }));
  const geo = new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true });
  geo.on('geolocate', p => avisoPerto(p));
  mapa.addControl(geo);
  await new Promise(ok => mapa.once('load', ok));
  mapa.addSource('pontos', { type: 'geojson', data: geoPontos() });
  mapa.addLayer({ id: 'pontos', type: 'circle', source: 'pontos', paint: {
    'circle-radius': ['case', ['==', ['get', 'hotel'], 1], 9, 7], 'circle-color': ['get', 'cor'],
    'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });
  mapa.addLayer({ id: 'pontos-nome', type: 'symbol', source: 'pontos', minzoom: 12, layout: {
    'text-field': ['get', 'nome'], 'text-font': ['Noto Sans Medium'], 'text-size': 12, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true },
    paint: { 'text-color': '#222', 'text-halo-color': '#fff', 'text-halo-width': 1.5 } });
  mapa.on('click', 'pontos', e => popup(e.features[0].properties.id));
}

async function abrirMapa(foco) {
  try {
    if (!mapa) {
      msgMapa('Carregando mapa…');
      await criarMapa();
      $('#irpara').innerHTML = '<option value="">Ir para…</option>' + D.mapas.flatMap(m => Object.keys(m.regioes))
        .map(n => `<option>${esc(n)}</option>`).join('');
    }
    mapa.resize();
    estadoMapas();
    if (foco) { mapa.jumpTo({ center: [foco.lng, foco.lat], zoom: 15 }); popup(foco.id); }
  } catch (e) { msgMapa('Mapa indisponível: ' + e.message); }
}

// ---------- navegação ----------
function aba(nome) {
  document.querySelectorAll('main > section').forEach(s => { s.hidden = s.id !== nome; });
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === nome));
  if (nome === 'mapa') abrirMapa();
  if (nome === 'locais') renderLocais();
  if (nome === 'info') renderInfo();
  if (nome === 'dicas') renderDicas();
  if (nome !== 'mapa') window.scrollTo(0, 0);
  store.set('aba', nome);
}

function gpsAgora() {
  if (!navigator.geolocation) return alert('GPS indisponível neste navegador.');
  navigator.geolocation.getCurrentPosition(p => { if (!avisoPerto(p)) alert('Nenhum documento de hoje para este lugar.'); },
    e => alert('Sem GPS: ' + e.message), { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 });
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-tab],[data-mapa],[data-mapa-hotel],[data-ver],[data-remover],[data-acao],[data-doc],[data-cidade]');
  if (!t) return;
  const ds = t.dataset;
  if (ds.doc) {
    // Com cópia offline abre aqui; sem cópia e com internet o link segue para o Drive; sem os dois, aviso com atalho.
    const d = (D.docs || []).find(x => x.id === ds.doc);
    if (docsAqui.has(ds.doc) || !navigator.onLine || !d?.drive) { e.preventDefault(); abrirDoc(ds.doc); }
  }
  else if (ds.acao === 'fechar-doc') fecharDoc();
  else if (ds.acao === 'compartilhar') compartilharDoc();
  else if (ds.acao === 'gps') gpsAgora();
  else if (ds.acao === 'fechar-perto') {
    const f = store.get('perto_fechado', {}), hoje = hojeJST();
    (avisoPerto.ultimo || []).forEach(x => { f[x.doc.id] = hoje; });
    store.set('perto_fechado', f); $('#perto').hidden = true;
  } else if (ds.cidade) {
    aba('locais'); $('#busca').value = ''; $('#fcat').value = ''; $('#fcid').value = ds.cidade; renderLocais(); scrollTo(0, 0);
  } else if (ds.tab) aba(ds.tab);
  else if (ds.ver) mostrarLocal(ds.ver);
  else if (ds.mapa) { const l = locais().find(x => x.id === ds.mapa); aba('mapa'); abrirMapa(l); }
  else if (ds.mapaHotel) { const h = D.hoteis.find(x => x.nome === ds.mapaHotel); aba('mapa'); abrirMapa({ ...h, id: 'h:' + h.nome }); }
  else if (ds.remover) {
    store.set('locais_importados', store.get('locais_importados', []).filter(l => l.id !== ds.remover));
    renderLocais(); atualizarPontos();
  } else if (ds.acao === 'exportar') exportar();
  else if (ds.acao === 'exemplo') fetch('exemplo-locais.csv').then(r => r.text()).then(t => mostrarImport(importarTexto(t)))
    .catch(e => mostrarImport('Falha: ' + e.message));
  else if (ds.acao === 'atualizar') navigator.serviceWorker?.getRegistration().then(r => r && r.update()).then(() => alert('Se houver versão nova, o app recarrega sozinho.'));
  else if (ds.acao === 'sair' && confirm('Esquecer a senha neste aparelho? Notas e locais continuam salvos.')) { localStorage.removeItem('senha'); location.reload(); }
});

document.addEventListener('change', async e => {
  if (e.target.id === 'arquivo' && e.target.files[0]) {
    try { mostrarImport(importarTexto(await e.target.files[0].text())); }
    catch (err) { mostrarImport('Arquivo inválido: ' + err.message); }
    e.target.value = '';
  }
  if (e.target.matches('[data-arqdocs]') && e.target.files[0]) {
    const msg = t => ['#armazdocs', '#semcopiamsg'].forEach(s => { if ($(s)) $(s).textContent = t; });
    msg('Importando documentos…');
    try {
      await importarDocs(await e.target.files[0].text()); renderHoje(); renderRoteiro(); renderInfo();
      if (abrirDoc.atual) abrirDoc(abrirDoc.atual.id);   // importou pelo aviso do documento: já mostra
    } catch (err) { msg('Arquivo de documentos inválido ou de outra senha (' + err.message + ').'); }
    e.target.value = '';
  }
  if (['dcat', 'dcid', 'dtipo'].includes(e.target.id)) renderDicas();
  if (e.target.id === 'irpara' && e.target.value) {
    // Centro da cidade em zoom de rua: hotel da região se houver (o de hoje primeiro), senão o centro do recorte.
    const b = D.mapas.map(m => m.regioes[e.target.value]).find(Boolean);
    if (b) {
      const dentro = h => h && h.lat != null && h.lng >= b[0] && h.lng <= b[2] && h.lat >= b[1] && h.lat <= b[3];
      const h = [hotelDe(hojeJST()), ...D.hoteis].find(dentro);
      mapa.jumpTo({ center: h ? [h.lng, h.lat] : [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], zoom: 13 });
    }
    e.target.value = '';
  }
  if (e.target.id === 'fcat' || e.target.id === 'fcid') renderLocais();
});
document.addEventListener('input', e => { if (e.target.id === 'busca') renderLocais(); if (e.target.id === 'dbusca') renderDicas(); });

function mostrarImport(msg) {
  const el = $('#importmsg');
  if (el) el.textContent = msg;
  renderHoje(); renderRoteiro(); atualizarPontos();
}
function atualizarPontos() { if (mapa && mapa.getSource('pontos')) mapa.getSource('pontos').setData(geoPontos()); }

async function exportar() {
  salvarNotas();
  const txt = JSON.stringify({ tipo: 'japan-explorer-backup', exportado: new Date().toISOString(), notas, locais_importados: store.get('locais_importados', []) }, null, 2);
  const file = new File([txt], `japan-explorer-backup-${hojeJST()}.json`, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Backup Japan Explorer' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: file.name });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- início ----------
function montar() {
  D.locais = (D.locais || []).map(r => normalizar(r)).filter(Boolean);
  D.hoteis = D.hoteis || [];
  $('#login').hidden = true; $('#app').hidden = false; $('#nav').hidden = false;
  document.documentElement.style.setProperty('--top', $('header').offsetHeight + 'px');
  $('#fcat').innerHTML = '<option value="">Categoria</option>' + Object.keys(CATS).map(c => `<option>${c}</option>`).join('');
  $('#legitens').innerHTML = `<span><i style="background:#111"></i>hospedagem</span>` + Object.entries(CATS).map(([c, cor]) => `<span><i style="background:${cor}"></i>${c}</span>`).join('');
  $('#baixar').onclick = baixarMapas;
  renderHoje(); renderRoteiro();
  aba(store.get('aba', 'hoje'));
  contarDocs();
  checarGPS(); setInterval(checarGPS, 120000);
  document.addEventListener('visibilitychange', checarGPS);
}

if ('serviceWorker' in navigator) {
  const tinhaControle = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js');
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (tinhaControle && !window.recarregando) { window.recarregando = true; salvarNotas(); location.reload(); }
  });
}

(async () => {
  const s = store.get('senha');
  if (s && !(await entrar(s))) return montar();
  $('#login').hidden = false;
  $('#login').onsubmit = async e => {
    e.preventDefault();
    $('#loginmsg').textContent = 'Abrindo…';
    const msg = await entrar($('#senha').value.trim());
    if (msg) $('#loginmsg').textContent = msg; else montar();
  };
})();
