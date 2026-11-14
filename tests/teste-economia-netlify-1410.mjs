/* v14.10 · Economia silenciosa de consumo no Netlify: polling inteligente + compactação transparente de imagens.
   Valida o CÓDIGO REAL do painel (public/index.html: SyncEco, NetlifyAdapter, ImgEco, Arquivos.enviar/reduzirImagem) num contexto isolado do Node, SEM navegador,
   SEM banco e SEM esperar de verdade: o tempo é simulado (relógio e temporizadores falsos), então 24 horas de ociosidade rodam em milissegundos.
   1) recurso desligado (gestao_v1410): o ciclo da v14.09 fica como estava (5 s em uso, 30 s com a aba oculta, nunca pausa por ociosidade);
   2) recurso ligado: consulta a cada 30 s com a aba em uso, nenhuma consulta com a aba oculta, nenhuma após 10 min sem interação (mouse, clique, rolagem, toque, tecla);
   3) consulta imediata e silenciosa ao voltar à aba (visibilitychange e focus), ao voltar a mexer depois da ociosidade e ao terminar uma gravação (rajadas viram UMA consulta);
   4) recuo 60 s → 120 s se o servidor falhar e volta a 30 s ao responder; sessão encerrada (401) não fica insistindo;
   5) depois de 24 h parado relê tudo o que está sendo vigiado (o servidor só guarda 3 dias de mudanças); antes disso só o que mudou;
   6) imagens JPG/JPEG/PNG/WebP: 1600 px no maior lado só se passar disso, JPEG 82 %, só vale se ficar menor; PDF/GIF/demais intactos (o mesmo objeto); limites conferidos antes;
   7) menos peso = menos partes = menos chamadas ao servidor; nada visual mudou (botões, ações e CSS idênticos aos da v14.09) e o servidor não mudou.
   Uso: node tests/teste-economia-netlify-1410.mjs (roda em segundos) */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(process.env.PAINEL_HTML || path.join(raiz, 'public/index.html'), 'utf8');
const OK = [], FAIL = [];
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x !== '' ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 700) : '')); };
const md5 = t => createHash('md5').update(t).digest('hex');
const corta = (ini, fim) => { const a = html.indexOf(ini), b = html.indexOf(fim, a); if (a < 0 || b < 0) throw new Error('bloco não encontrado: ' + ini); return html.slice(a, b); };

const syncCod = corta('const SyncEco = {', '/* ------------------- v13.75 · Netlify Database (Postgres)');
const adaptCod = corta('class NetlifyAdapter {', '/* ------------------- v13.74.4 · Semente local');
const imgCod = corta('const ImgEco = {', 'window.ImgEco = ImgEco;');
const arqCod = corta('  validar(file) {', '  url(ref) {');
const redCod = corta('  async reduzirImagem(file) {', '  mimeDe(file)');

/* ---------- mundo simulado: relógio, temporizadores, documento, janela e servidor falsos ---------- */
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r)); };
function mundo({ g10 = true, visivel = true } = {}) {
  const w = { t: 1_700_000_000_000, timers: new Map(), id: 1, flag: g10, reqs: [], falha: 0, seqSrv: 10, mudou: [] };
  w.t0 = w.t;
  const doc = { visibilityState: visivel ? 'visible' : 'hidden', ls: {}, addEventListener(ev, fn) { (this.ls[ev] ||= []).push(fn); }, dispatch(ev, e = {}) { (this.ls[ev] || []).forEach(f => f({ target: doc, ...e })); }, querySelectorAll: () => [] };
  Object.defineProperty(doc, 'hidden', { get() { return doc.visibilityState === 'hidden'; } });
  const win = { ls: {}, addEventListener(ev, fn) { (this.ls[ev] ||= []).push(fn); }, dispatch(ev) { (this.ls[ev] || []).forEach(f => f({})); } };
  const setT = (fn, ms = 0) => { const id = w.id++; w.timers.set(id, { fn, at: w.t + Math.max(0, ms) }); return id; };
  const clrT = id => { w.timers.delete(id); };
  const { SyncEco, NetlifyAdapter } = new Function('document', 'window', 'Date', 'setTimeout', 'clearTimeout', 'sleep', 'g10',
    syncCod + '\n' + adaptCod + '\nreturn { SyncEco, NetlifyAdapter };')(doc, win, { now: () => w.t }, setT, clrT, () => Promise.resolve(), () => w.flag);
  const a = new NetlifyAdapter();
  a._req = async (m, url, corpo) => {
    w.reqs.push({ m, url, t: w.t, corpo });
    if (url.startsWith('/api/mudancas?desde=')) {
      if (url.endsWith('=-1')) return { seq: w.seqSrv, colecoes: [] };
      if (w.falha) { const e = new Error('falha ' + w.falha); e.status = w.falha; throw e; }
      return { seq: w.seqSrv, colecoes: w.mudou.splice(0) };
    }
    if (url.startsWith('/api/docs/lote')) return { resultados: corpo.ops.map(() => ({ ok: true })) };
    if (url.includes('?colecao=')) return { docs: [], proximo: null };
    if (url.includes('?caminho=')) return { doc: null };
    return {};
  };
  w.doc = doc; w.win = win; w.SyncEco = SyncEco; w.a = a;
  w.avancar = async ms => {
    const alvo = w.t + ms;
    for (;;) {
      const prox = [...w.timers.entries()].filter(([, x]) => x.at <= alvo).sort((x, y) => x[1].at - y[1].at || x[0] - y[0])[0];
      if (!prox) break;
      w.t = Math.max(w.t, prox[1].at); w.timers.delete(prox[0]); prox[1].fn(); await settle();
    }
    w.t = alvo; await settle();
  };
  w.polls = () => w.reqs.filter(r => r.url.startsWith('/api/mudancas?desde=') && !r.url.endsWith('=-1'));
  w.tempos = () => w.polls().map(r => r.t - w.t0);
  w.listas = () => w.reqs.filter(r => r.url.includes('?colecao='));
  w.oculta = async () => { doc.visibilityState = 'hidden'; doc.dispatch('visibilitychange'); await settle(); };
  w.visivel = async () => { doc.visibilityState = 'visible'; doc.dispatch('visibilitychange'); await settle(); };
  w.mexer = async (ev = 'mousemove') => { doc.dispatch(ev); await settle(); };
  /* gravar com o relógio falso: a fila de gravações usa setTimeout(0), então o tempo precisa andar 0 ms para ela sair */
  w.gravar = async (caminho, obj = { x: 1 }) => { const p = a.set(caminho, obj).then(() => null, e => e); await w.avancar(0); const erro = await p; await w.avancar(0); return erro; /* null = gravou; senão o erro */ };
  w.iniciar = async (cols = ['lojas']) => { cols.forEach(c => a.watch(c, () => { })); await settle(); };
  return w;
}
const difs = ts => ts.slice(1).map((t, i) => t - ts[i]);
const MIN = 60e3, H = 3600e3;

/* ---------- 1 · recurso desligado: o ciclo da v14.09 não muda ---------- */
{
  const w = mundo({ g10: false }); await w.iniciar();
  await w.avancar(60e3);
  chk('recurso desligado: consulta a cada 5 s com a aba em uso (12 consultas em 60 s)', w.polls().length === 12 && difs(w.tempos()).every(d => d === 5000), w.tempos());
  await w.oculta(); const n0 = w.polls().length; await w.avancar(10 * MIN);
  chk('recurso desligado: com a aba oculta segue a cada 30 s (ritmo da v14.09)', w.polls().length - n0 >= 19 && w.polls().length - n0 <= 21, w.polls().length - n0);
  await w.visivel(); const n1 = w.polls().length; await w.avancar(300);
  chk('recurso desligado: ao voltar à aba consulta em 200 ms (comportamento antigo)', w.polls().length === n1 + 1);
  const w2 = mundo({ g10: false }); await w2.iniciar(); await w2.avancar(15 * MIN);
  chk('recurso desligado: nunca pausa por ociosidade (15 min sem mexer = 180 consultas)', w2.polls().length === 180 && w2.timers.size > 0, w2.polls().length);
  const w3 = mundo({ g10: false }); await w3.iniciar(); await w3.avancar(20e3); const n3 = w3.polls().length; await w3.gravar('lojas/l1');
  chk('recurso desligado: gravar NÃO dispara consulta imediata', w3.polls().length === n3);
}

/* ---------- 2 · recurso ligado: 30 s em uso ---------- */
{
  const w = mundo(); await w.iniciar();
  for (let i = 0; i < 30; i++) { await w.avancar(4 * MIN); await w.mexer(); } // 2 h mexendo de vez em quando: nunca fica ocioso
  const t = w.tempos();
  chk('aba em uso: a primeira consulta sai em 5 s (como antes) e as seguintes a cada 30 s', t[0] === 5000 && difs(t).every(d => d === 30000), difs(t).filter(d => d !== 30000).slice(0, 5));
  chk('aba em uso: 2 horas = ~240 consultas (antes: ~1.440 a cada 5 s)', t.length >= 238 && t.length <= 242, t.length);
  chk('o ciclo mantém UM temporizador agendado (sem acúmulo de timers)', w.timers.size === 1, w.timers.size);
  const k = w.SyncEco;
  chk('constantes: 30 s, 10 min, backoff 60 s e 120 s, 24 h', k.INTERVALO === 30000 && k.OCIOSO_MS === 600000 && JSON.stringify(k.BACKOFF) === '[60000,120000]' && k.RESYNC_MS === 86400000);
  const t0 = k.agora(); k._acao = t0;
  chk('proximo(): 30 s sem falha; 60 s na 1ª falha; 120 s da 2ª em diante', k.proximo(0, t0) === 30000 && k.proximo(1, t0) === 60000 && k.proximo(2, t0) === 120000 && k.proximo(9, t0) === 120000);
  chk('proximo(): null (pausa) a partir de 10 min sem uso; antes do limite espera só o que falta (+50 ms)', k.proximo(0, t0 + 600000) === null && k.proximo(0, t0 + 700000) === null && k.proximo(2, t0 + 3 * H) === null && k.proximo(0, t0 + 575000) === 25050 && k.proximo(0, t0 + 599950) === 100 && k.proximo(2, t0 + 599000) === 1050, [k.proximo(0, t0 + 600000), k.proximo(0, t0 + 575000), k.proximo(0, t0 + 599950)]);
  w.doc.visibilityState = 'hidden';
  chk('proximo(): null com a aba oculta, mesmo em uso e sem falhas', k.proximo(0, t0) === null);
}

/* ---------- 3 · aba oculta: nada de requisições; voltar à aba consulta na hora ---------- */
{
  const w = mundo(); await w.iniciar(); await w.avancar(70e3);
  let ciclos = 0; const cic = w.a._ciclo.bind(w.a); w.a._ciclo = (...x) => { ciclos++; return cic(...x); };
  const antes = w.polls().length;
  await w.oculta(); await w.avancar(3 * H); const c0 = ciclos; await w.mexer(); await w.avancar(10e3);
  chk('aba oculta: ZERO consultas durante 3 horas (mesmo com eventos de mouse)', w.polls().length <= antes + 0 && w.a._pausa === 'oculta' && w.timers.size === 0, { n: w.polls().length - antes, p: w.a._pausa, timers: w.timers.size });
  const n = w.polls().length; await w.gravar('lojas/l9'); await w.avancar(10e3);
  chk('aba oculta: nem a gravação dispara consulta (a volta à aba é quem sincroniza) — e nem agenda ciclo algum', w.polls().length === n && ciclos === c0, { n: w.polls().length - n, ciclos: ciclos - c0 });
  await w.visivel(); await w.avancar(0);
  chk('voltar à aba (visibilitychange): consulta imediata e silenciosa', w.polls().length === n + 1, w.polls().length - n);
  const ult = w.polls().at(-1).t; await w.avancar(30e3 + 10);
  chk('depois da volta o ritmo regular de 30 s retoma', w.polls().length === n + 2 && w.polls().at(-1).t - ult === 30000, w.polls().slice(-2).map(r => r.t - w.t0));
  const w2 = mundo({ visivel: false }); await w2.iniciar(); await w2.avancar(2 * H);
  chk('aberta já oculta (aba em segundo plano desde o início): nenhuma consulta', w2.polls().length === 0 && w2.a._pausa === 'oculta');
}

/* ---------- 4 · ociosidade de 10 minutos ---------- */
{
  const w = mundo(); await w.iniciar(); await w.avancar(15 * MIN);
  const t = w.tempos();
  chk('sem interação por 10 min: para exatamente no limite (20 consultas e nenhuma depois de 10:00)', t.length === 20 && t.at(-1) < 10 * MIN && w.a._pausa === 'ociosa', { n: t.length, ult: t.at(-1) });
  chk('pausa por ociosidade não deixa timer nenhum agendado (o banco pode suspender)', w.timers.size === 0, w.timers.size);
  await w.avancar(3 * H);
  chk('durante a madrugada (3 h parado) continua sem nenhuma consulta', w.polls().length === 20);
  const n = w.polls().length; await w.mexer('mousemove'); await w.avancar(0);
  chk('voltar a mexer o mouse depois da ociosidade: consulta imediata e silenciosa', w.polls().length === n + 1, w.polls().length - n);
  const u = w.polls().at(-1).t; await w.avancar(30e3 + 10);
  chk('e o ritmo de 30 s retoma depois dela', w.polls().length === n + 2 && w.polls().at(-1).t - u === 30000);
  for (const ev of ['mousedown', 'click', 'keydown', 'wheel', 'scroll', 'touchstart', 'pointerdown']) {
    const x = mundo(); await x.iniciar(); await x.avancar(11 * MIN); const c0 = x.polls().length; await x.mexer(ev); await x.avancar(0);
    chk(`ociosa + ${ev}: retoma na hora`, x.polls().length === c0 + 1, ev);
  }
  const y = mundo(); await y.iniciar(); for (let i = 0; i < 24; i++) { await y.avancar(5 * MIN); await y.mexer('keydown'); }
  chk('mexendo a cada 5 min durante 2 h NUNCA pausa (interação renova a ociosidade)', y.polls().length >= 238 && y.a._pausa == null, y.polls().length);
  const z = mundo(); await z.iniciar(); await z.avancar(9 * MIN); await z.mexer('click'); await z.avancar(9 * MIN);
  chk('uma interação aos 9 min adia a pausa em mais 10 min (aos 18 min ainda consulta)', z.a._pausa == null && z.polls().at(-1).t - z.t0 > 17 * MIN, z.polls().at(-1).t - z.t0);
  const q = mundo(); await q.iniciar(); await q.avancar(11 * MIN); const c1 = q.polls().length;
  q.doc.visibilityState = 'visible'; q.win.dispatch('focus'); await settle(); await q.avancar(0);
  chk('ociosa + window.focus (voltou para a janela): consulta imediata e renova a ociosidade', q.polls().length === c1 + 1 && !q.SyncEco.ocioso());
  q.win.dispatch('focus'); q.doc.dispatch('visibilitychange'); await q.avancar(2500);
  chk('focus + visibilitychange juntos viram UMA consulta só (e no máximo uma a cada 2 s)', q.polls().length === c1 + 2, q.polls().length - c1);
}

/* ---------- 5 · gravação concluída: consulta imediata (rajadas viram uma) ---------- */
{
  const w = mundo(); await w.iniciar(); await w.avancar(20e3); await w.mexer();
  const n = w.polls().length; await w.gravar('lojas/l1');
  chk('salvar: uma consulta imediata e silenciosa logo após concluir a gravação', w.polls().length === n + 1 && w.reqs.some(r => r.url.startsWith('/api/docs/lote')), w.polls().length - n);
  const ult = w.polls().at(-1).t; await w.avancar(30e3 + 10);
  chk('depois da consulta por gravação o ciclo regular recomeça (30 s dali)', w.polls().at(-1).t - ult === 30000);
  const w2 = mundo(); await w2.iniciar(); await w2.avancar(20e3); await w2.mexer(); const m = w2.polls().length;
  for (let i = 0; i < 10; i++) { await w2.gravar('lojas/r' + i, { i }); await w2.avancar(300); }
  await w2.avancar(6e3);
  chk('rajada de 10 gravações em 3 s: no máximo 2 consultas (uma imediata + uma depois, nunca uma por gravação)', w2.polls().length - m >= 1 && w2.polls().length - m <= 2, w2.polls().length - m);
  const w3 = mundo(); await w3.iniciar(); await w3.avancar(11 * MIN);
  const c = w3.polls().length; await w3.gravar('lojas/n'); await w3.avancar(2 * H);
  chk('gravação com a tela ociosa: UMA consulta e volta a ficar parada (sem timers, sem ciclo)', w3.polls().length === c + 1 && w3.timers.size === 0 && w3.a._pausa === 'ociosa', { n: w3.polls().length - c, t: w3.timers.size });
  const w4 = mundo(); await w4.iniciar(); await w4.avancar(40e3); await w4.mexer(); const d = w4.polls().length;
  await w4.gravar('lojas/z', { z: 1 });
  chk('a gravação do próprio usuário continua refletida na hora na tela (cache local)', w4.a.cols.get('lojas').mapa?.has('z') === true);
  chk('uma gravação sem sucesso (recusada pelo servidor) não pede consulta', await (async () => {
    const w5 = mundo(); await w5.iniciar(); await w5.avancar(20e3); await w5.mexer(); const k = w5.polls().length;
    const orig = w5.a._req; w5.a._req = async (m, u, c) => u.startsWith('/api/docs/lote') ? { resultados: c.ops.map(() => ({ ok: false, status: 403, erro: 'x' })) } : orig(m, u, c);
    await w5.gravar('lojas/x', {}); await w5.avancar(10); return w5.polls().length === k;
  })());
}

/* ---------- 6 · falhas: recuo 60 s → 120 s e volta a 30 s; sessão encerrada ---------- */
{
  const w = mundo(); await w.iniciar(); w.falha = 503;
  for (let i = 0; i < 6; i++) { await w.avancar(4 * MIN); await w.mexer(); }
  const t = w.tempos();
  chk('falha do servidor: 5 s, depois +60 s, depois +120 s e segue a cada 120 s', t[0] === 5000 && difs(t).slice(0, 4).join() === '60000,120000,120000,120000', difs(t).slice(0, 5));
  w.falha = 0; await w.avancar(130e3); await w.mexer(); await w.avancar(70e3);
  const t2 = w.tempos();
  chk('servidor voltou: a consulta seguinte dá certo e o ritmo volta a 30 s', difs(t2).slice(-2).every(d => d === 30000) && w.a._falhas === 0, difs(t2).slice(-4));
  const x = mundo(); await x.iniciar(); x.falha = 503; await x.avancar(5e3 + 1); await x.avancar(59e3); const n1 = x.polls().length; await x.avancar(1e3);
  chk('na primeira falha o recuo é de 60 s (não 30 s): nada aos 64 s, nova tentativa aos 65 s', n1 === 1 && x.polls().length === 2 && difs(x.tempos())[0] === 60000, { n1, n2: x.polls().length });
  const y = mundo(); await y.iniciar(); y.falha = 401; await y.avancar(10e3); await y.mexer(); await y.avancar(H);
  chk('sessão encerrada (401): uma tentativa e para (sem insistir a cada ciclo; nada de timers)', y.polls().length === 1 && y.a._pausa === 'sessao' && y.timers.size === 0, { n: y.polls().length, p: y.a._pausa });
  y.falha = 0; await y.mexer(); await y.visivel(); await y.avancar(0);
  chk('depois do 401: ao voltar à aba tenta de novo e, respondendo, volta ao ritmo normal', y.polls().length === 2 && y.a._pausa == null && y.timers.size >= 1, { n: y.polls().length, p: y.a._pausa });
  const z = mundo(); await z.iniciar(); z.falha = 401; await z.avancar(10e3); z.falha = 0; z.a.watch('funcionarios', () => { }); await settle(); await z.avancar(0);
  chk('depois de um novo login (nova assinatura) a sincronização é retomada sozinha', z.polls().length === 2 && z.a._pausa == null, z.polls().length);
}

/* ---------- 7 · parado por 24 h ou mais: relê tudo (o servidor só guarda 3 dias de mudanças) ---------- */
{
  const w = mundo(); await w.iniciar(['lojas', 'funcionarios']); await w.avancar(30e3);
  const l0 = w.listas().length; await w.avancar(2 * H); await w.mexer(); await w.avancar(0);
  chk('parado 2 h (noite): a volta só consulta mudanças; nenhuma coleção é relida à toa', w.listas().length === l0, { l: w.listas().length - l0 });
  const x = mundo(); await x.iniciar(['lojas', 'funcionarios']); await x.avancar(30e3);
  const l1 = x.listas().length; await x.avancar(25 * H); await x.mexer(); await x.avancar(0);
  const novas = x.listas().slice(l1).map(r => r.url);
  chk('parado 25 h (fim de semana): a volta relê TODAS as coleções vigiadas, mesmo sem mudança informada', novas.some(u => u.includes('colecao=lojas')) && novas.some(u => u.includes('colecao=funcionarios')), novas);
  const l2 = x.listas().length; await x.avancar(10 * MIN); await x.mexer();
  chk('e logo depois volta ao normal (sem releitura geral a cada ciclo)', x.listas().length === l2, x.listas().length - l2);
  const y = mundo(); await y.iniciar(['lojas', 'funcionarios']); await y.avancar(30e3); await y.avancar(2 * H); y.mudou.push('lojas'); const l3 = y.listas().length;
  await y.mexer(); await y.avancar(0);
  const novas2 = y.listas().slice(l3).map(r => r.url);
  chk('mudança feita por outro computador durante a noite: só a coleção alterada é relida', novas2.length === 1 && novas2[0].includes('colecao=lojas'), novas2);
  const k = mundo(); await k.iniciar(); await k.avancar(30e3); const s0 = k.polls().at(-1).url; await k.avancar(25 * H); k.seqSrv = 77; await k.mexer(); await k.avancar(0);
  const volta = k.polls().at(-1).url; await k.avancar(30e3 + 10);
  chk('a consulta da volta parte do último seq conhecido (nada se perde) e a seguinte já usa o seq novo', volta === s0 && k.polls().at(-1).url.endsWith('desde=77'), [s0, volta, k.polls().at(-1).url]);
}

/* ---------- 8 · sem interferência: recurso religado/desligado em pleno uso e várias assinaturas ---------- */
{
  const w = mundo({ g10: false }); await w.iniciar(); await w.avancar(10e3);
  w.flag = true; await w.avancar(40e3);
  const d = difs(w.tempos());
  chk('recurso ligado no meio do uso (Produção lê config/recursos depois): passa para os 30 s sem reiniciar', d.at(-1) === 30000 && w.timers.size === 1, d.slice(-3));
  w.flag = false; await w.avancar(40e3); const d2 = difs(w.tempos());
  chk('recurso desligado de novo: volta para o ciclo da v14.09 (5 s)', d2.at(-1) === 5000, d2.slice(-3));
  const x = mundo(); for (let i = 0; i < 20; i++) x.a.watch('c' + i, () => { }); x.a.watchDoc('usuarios/u1', () => { }); await settle(); await x.avancar(65e3);
  chk('20 coleções + 1 documento vigiados: continua UMA consulta de mudanças por ciclo', x.polls().length === 3 && x.timers.size === 1, x.polls().length);
  chk('SyncEco só registra os ouvintes uma vez (várias assinaturas não duplicam eventos)', Object.values(x.doc.ls).every(l => l.length <= 3) && x.doc.ls.mousemove.length === 1, Object.fromEntries(Object.entries(x.doc.ls).map(([k, v]) => [k, v.length])));
}

/* ---------- 9 · interação dentro do iframe do FCX conta como uso ---------- */
{
  const w = mundo(); const iframeDoc = { ls: {}, addEventListener(ev, fn) { (this.ls[ev] ||= []).push(fn); } };
  await w.iniciar(); w.SyncEco.vigiar(iframeDoc); await w.avancar(9 * MIN);
  (iframeDoc.ls.mousemove || []).forEach(f => f({})); await w.avancar(9 * MIN);
  chk('mexer DENTRO do iframe do FCX renova a ociosidade (quem trabalha só no FCX não fica sem sincronizar)', w.a._pausa == null && w.polls().at(-1).t - w.t0 > 17 * MIN);
  chk('os 8 eventos de uso são vigiados no iframe: mouse, clique, rolagem, toque e tecla', ['mousemove', 'mousedown', 'click', 'keydown', 'wheel', 'scroll', 'touchstart', 'pointerdown'].every(e => iframeDoc.ls[e]?.length === 1));
  const p = { addEventListener() { throw new Error('outra origem'); } }; let quebrou = false; try { w.SyncEco.vigiar(p); w.SyncEco.vigiar(null); } catch { quebrou = true; }
  chk('iframe de outra origem (sem acesso) é ignorado sem erro', !quebrou);
  const ld = w.doc.ls.load?.[0]; const fr = { ls: {}, addEventListener(ev, fn) { (this.ls[ev] ||= []).push(fn); } };
  ld && ld({ target: { tagName: 'IFRAME', contentDocument: fr } });
  chk('iframe que carrega depois (FCX aberto mais tarde) passa a ser vigiado', !!ld && fr.ls.mousemove?.length === 1);
}

/* ---------- 10 · temporizadores de fundo seguem a mesma pausa ---------- */
{
  const w = mundo(); await w.iniciar(); const k = w.SyncEco;
  chk('pausado(): falso em uso, verdadeiro com a aba oculta e verdadeiro depois de 10 min sem uso', !k.pausado() && (await w.oculta(), k.pausado()) && (await w.visivel(), !k.pausado()) && (await w.avancar(10 * MIN + 1), k.pausado()));
  chk('revalidação da sessão (60 s) não consulta com a tela ociosa e volta com a aba', /Sessao\.ativa && document\.visibilityState === 'visible' && !\(g10\(\) && SyncEco\.ocioso\(\)\)\) Sessao\.revalidar\(\)/.test(html));
  chk('Resumo do Recebível (20 min) adia com a aba oculta/ociosa e publica ao retomar', /if \(g10\(\) && SyncEco\.pausado\(\)\) \{ this\._adiado = true; return; \} this\._adiado = false;/.test(html) && /SyncEco\.aoRetomar\.push\(\(\) => \{ if \(this\._adiado\) setTimeout\(rodar, 3000\); \}\)/.test(html));
  let rodou = 0; k.aoRetomar.push(m => { rodou++; }); await w.mexer(); await w.avancar(0);
  chk('ao retomar, os ganchos de fundo são avisados', rodou >= 1, rodou);
}

/* ---------- 11 · imagens: regras da compactação (motor puro) ---------- */
const novaImg = (nome, tipo, bytes, dim) => { const f = new File([new Uint8Array(bytes)], nome, { type: tipo }); f.dim = dim; return f; };
const mkIo = (k = 0.05, log = []) => ({
  log, async ler(arq) { log.push('ler'); if (arq.falhaLer) throw new Error('imagem'); return arq.semDim ? null : { w: arq.dim[0], h: arq.dim[1], arq }; },
  async gerar(img, w, h, q) { log.push(['gerar', w, h, q]); return img.arq.retorno === undefined ? new Blob([new Uint8Array(Math.round(w * h * k))]) : img.arq.retorno; }, liberar() { log.push('liberar'); },
});
let f; // arquivo da vez
const E = new Function('File', 'Blob', 'Date', imgCod + '\nreturn ImgEco;')(File, Blob, Date);
const MB = 1048576;
chk('ImgEco: 1600 px, qualidade 0,82', E.MAX_LADO === 1600 && E.QUALIDADE === 0.82);
chk('compactável: JPG, JPEG, PNG e WebP (pelo tipo)', ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'IMAGE/PNG'].every(t => E.compactavel(novaImg('a', t, 10))));
chk('NÃO compactável: PDF, GIF, SVG, texto e arquivo vazio', ['application/pdf', 'image/gif', 'image/svg+xml', 'text/plain'].every(t => !E.compactavel(novaImg('a', t, 10))) && !E.compactavel(novaImg('a.png', 'image/png', 0)) && !E.compactavel(null));
chk('sem tipo (ou genérico) decide pela extensão: .jpg/.JPEG/.png/.webp sim; .pdf/.gif/.bin não', ['a.jpg', 'a.JPEG', 'a.png', 'a.WEBP'].every(n => E.compactavel(novaImg(n, '', 10)) && E.compactavel(novaImg(n, 'application/octet-stream', 10))) && ['a.pdf', 'a.gif', 'a.bin'].every(n => !E.compactavel(novaImg(n, '', 10)) && !E.compactavel(novaImg(n, 'application/octet-stream', 10))));
const dm = (w, h) => JSON.stringify(E.dimensoes(w, h));
chk('dimensões: 4000×3000 → 1600×1200 e 3000×4000 → 1200×1600 (proporcional, só reduz o maior lado)', dm(4000, 3000) === '{"w":1600,"h":1200,"reduziu":true}' && dm(3000, 4000) === '{"w":1200,"h":1600,"reduziu":true}');
chk('dimensões: até 1600 px NÃO redimensiona (1600×1600, 1600×900, 800×600 ficam iguais)', dm(1600, 1600) === '{"w":1600,"h":1600,"reduziu":false}' && dm(1600, 900) === '{"w":1600,"h":900,"reduziu":false}' && dm(800, 600) === '{"w":800,"h":600,"reduziu":false}');
chk('dimensões: panorama 8000×100 → 1600×20 e nunca zera um lado (1601×1 → 1600×1)', dm(8000, 100) === '{"w":1600,"h":20,"reduziu":true}' && dm(1601, 1) === '{"w":1600,"h":1,"reduziu":true}');
chk('nome: .png/.webp/.jpeg viram .jpg e só a extensão final muda', E.nomeJpg('foto.PNG') === 'foto.jpg' && E.nomeJpg('comprovante.webp') === 'comprovante.jpg' && E.nomeJpg('a.b.jpeg') === 'a.b.jpg' && E.nomeJpg('sem_ext') === 'sem_ext.jpg');
{
  f = novaImg('Foto Cupom.PNG', 'image/png', 4.2 * MB, [4000, 3000]); const io = mkIo();
  const r = await E.comprimir(f, io);
  chk('foto 4000×3000 de 4,2 MB: vira um File JPEG novo, bem menor', r !== f && r.type === 'image/jpeg' && r.name === 'Foto Cupom.jpg' && r.size < f.size / 10, { nome: r.name, tam: r.size });
  chk('foi redimensionada para 1600×1200 e regravada com qualidade 0,82', JSON.stringify(io.log.find(x => Array.isArray(x))) === '["gerar",1600,1200,0.82]', io.log);
  chk('os recursos da imagem são sempre liberados (URL temporária)', io.log.at(-1) === 'liberar');
  f = novaImg('scan.jpg', 'image/jpeg', 2 * MB, [1200, 1600]); const io2 = mkIo(0.1);
  const r2 = await E.comprimir(f, io2);
  chk('imagem que NÃO passa de 1600 px: não é redimensionada, só regravada em JPEG 82 %', JSON.stringify(io2.log.find(x => Array.isArray(x))) === '["gerar",1200,1600,0.82]' && r2.size < f.size, io2.log);
  f = novaImg('ja_pequena.jpg', 'image/jpeg', 50e3, [800, 600]); const io3 = mkIo(2); // regravar ficaria MAIOR (960 KB)
  chk('se a versão comprimida NÃO fica menor, vale o original (o mesmo objeto, sem tocar)', await E.comprimir(f, io3) === f);
  f = novaImg('igual.jpg', 'image/jpeg', 960, [800, 600]); f.retorno = new Blob([new Uint8Array(960)]);
  chk('tamanho igual também fica com o original (só vale se for estritamente menor)', await E.comprimir(f, mkIo()) === f);
  const pdf = novaImg('contrato.pdf', 'application/pdf', 3 * MB); const io4 = mkIo();
  chk('PDF: devolve o MESMO objeto, sem sequer abrir o arquivo (binário e qualidade intactos)', await E.comprimir(pdf, io4) === pdf && io4.log.length === 0);
  const gif = novaImg('anim.gif', 'image/gif', 3 * MB, [100, 100]); const io5 = mkIo();
  chk('GIF (e demais tipos) passam intactos', await E.comprimir(gif, io5) === gif && io5.log.length === 0);
  f = novaImg('quebrada.png', 'image/png', 2 * MB, [100, 100]); f.falhaLer = true; const io6 = mkIo();
  chk('imagem que o navegador não decodifica: segue com o original (sem erro e sem aviso)', await E.comprimir(f, io6) === f);
  f = novaImg('semdim.png', 'image/png', 2 * MB, [0, 0]); f.semDim = true;
  chk('leitura sem dimensões: segue com o original', await E.comprimir(f, mkIo()) === f);
  f = novaImg('nulo.png', 'image/png', 2 * MB, [3000, 3000]); f.retorno = null;
  chk('canvas que não gera o JPEG (blob nulo): segue com o original', await E.comprimir(f, mkIo()) === f);
  f = novaImg('vazio.png', 'image/png', 2 * MB, [3000, 3000]); f.retorno = new Blob([]);
  chk('JPEG vazio: segue com o original', await E.comprimir(f, mkIo()) === f);
  const web = novaImg('print.webp', 'image/webp', 1.5 * MB, [2400, 1200]); f = web;
  const r3 = await E.comprimir(web, mkIo());
  chk('WebP também é compactado (e vira .jpg)', r3 !== web && r3.type === 'image/jpeg' && r3.name === 'print.jpg');
}

/* ---------- 12 · imagens: o envio de anexos (Arquivos.enviar real) e menos chamadas ao servidor ---------- */
{
  const mem = { g10: true, subidos: [], cache: [] };
  const mont = () => new Function('g10', 'ImgEco', 'Cloud', 'Auth', 'ArquivosCache', 'Fmt', 'return {' + 'LIMITE: 5 * 1024 * 1024, TIPOS: /^(application\\/pdf|image\\/(png|jpe?g|webp|gif))$/,' + arqCod.replace(/\n  \/\*\* Envia o arquivo[^\n]*\n/, '\n') + ' };')
    (() => mem.g10, E, { caps: { assets: { upload: async file => { mem.subidos.push(file); return { id: 'a' + mem.subidos.length, url: '/_blob/x', contentType: file.type }; } } } }, { id: 'u1' }, { put: (id, f, m) => mem.cache.push([id, f, m]) }, { num: n => String(n) });
  const A = mont();
  const foto = novaImg('recibo.png', 'image/png', 3.8 * MB, [3000, 4000]); const ioReal = mkIo(); E.io = ioReal;
  const ref = await A.enviar(foto);
  chk('Arquivos.enviar (recurso ligado): o servidor recebe a imagem COMPACTADA (JPEG, bem menor)', mem.subidos[0] !== foto && mem.subidos[0].type === 'image/jpeg' && mem.subidos[0].size < foto.size / 10, mem.subidos[0]?.size);
  chk('a referência gravada traz o nome, o tamanho e o tipo do arquivo FINAL (consistentes com o upload)', ref.nome === 'recibo.jpg' && ref.tamanho === mem.subidos[0].size && ref.assetId === 'a1' && ref.enviadoPor === 'u1');
  chk('o cache local guarda o arquivo compactado (abre na hora, igual ao que está no servidor)', mem.cache[0][1] === mem.subidos[0] && mem.cache[0][2].nome === 'recibo.jpg');
  const pdf = novaImg('termo.pdf', 'application/pdf', 4 * MB); const refP = await A.enviar(pdf);
  chk('Arquivos.enviar com PDF: sobe o MESMO objeto (binário e qualidade intactos) e o tamanho gravado é o original', mem.subidos[1] === pdf && refP.tamanho === 4 * MB && refP.nome === 'termo.pdf');
  mem.g10 = false; const foto2 = novaImg('r2.png', 'image/png', 3 * MB, [3000, 3000]); await A.enviar(foto2);
  chk('Arquivos.enviar com o recurso DESLIGADO: nada é compactado (comportamento da v14.09)', mem.subidos[2] === foto2);
  mem.g10 = true; E.io = mkIo(); const antes = mem.subidos.length;
  const grande = novaImg('gigante.jpg', 'image/jpeg', 5 * MB + 1, [4000, 3000]); let e1 = ''; try { await A.enviar(grande); } catch (e) { e1 = e.message; }
  chk('limite de 5 MB preservado: imagem acima do limite continua recusada ANTES de compactar (nada é enviado)', /limite é de 5 MB/.test(e1) && mem.subidos.length === antes, e1);
  const exato = novaImg('limite.png', 'image/png', 5 * MB, [3000, 3000]); await A.enviar(exato);
  chk('exatamente 5 MB ainda é aceito (e sobe compactado)', mem.subidos.length === antes + 1 && mem.subidos.at(-1).size < 5 * MB);
  let e2 = ''; try { await A.enviar(novaImg('x.exe', 'application/x-msdownload', 10)); } catch (e) { e2 = e.message; }
  chk('tipo não aceito continua recusado como antes', /PDF ou uma imagem/.test(e2), e2);
  /* menos peso = menos partes = menos chamadas (Netlify Functions) */
  const reqs = []; const ad = new (new Function('sleep', adaptCod + '\nreturn NetlifyAdapter;')(() => { }))(); ad._req = async (m, u) => { reqs.push(m + ' ' + u.replace(/[0-9a-f]{32}/, 'ID')); return u === '/api/arquivos' ? { id: 'ID' } : { url: '/_blob/ID', contentType: 'x' }; };
  const grandeOrig = novaImg('o.png', 'image/png', 4.2 * MB, [4000, 3000]); E.io = mkIo();
  await ad.assets().upload(grandeOrig); const nOrig = reqs.length; reqs.length = 0;
  await ad.assets().upload(await E.comprimir(grandeOrig));
  chk('foto de 4,2 MB: o envio ocupava 7 chamadas (criar + 5 partes + concluir); compactada ocupa 3', nOrig === 7 && reqs.length === 3, { antes: nOrig, depois: reqs.length });
  const gerado = await E.comprimir(grandeOrig);
  chk('o número de partes declarado ao servidor bate com o tamanho do arquivo final (validação do servidor)', Math.ceil(gerado.size / MB) === 1 && gerado.size > 0);
}

/* ---------- 13 · termos assinados (Base64 no banco): a mesma regra ---------- */
{
  let ligado = true, usou = 0; const sp = { comprimir: async x => { usou++; return x; } };
  const R = new Function('g10', 'ImgEco', 'return {' + redCod + '};')(() => ligado, sp);
  const pequena = novaImg('t.jpg', 'image/jpeg', 300e3, [3000, 2000]);
  await R.reduzirImagem(pequena);
  chk('termo com o recurso ligado: usa a compactação nova (1600 px, 82 %), mesmo abaixo de 700 KB', usou === 1);
  ligado = false; usou = 0; const r = await R.reduzirImagem(pequena);
  chk('termo com o recurso desligado: segue a regra antiga (≤ 700 KB passa direto) e não usa a nova', usou === 0 && r === pequena);
}

/* ---------- 14 · nada visual mudou, servidor intacto, Regra de Ouro, ligações no código ---------- */
const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('');
/* v14.11 acrescentou quatro blocos de CSS próprios (reajuste, menu lateral, agrupador, lista paginada de Fornecedores), contíguos e só ativos com gestao_v1411: tirando-os, o CSS continua o da v14.09 */
const css11 = css.replace(/\/\* v14\.11 · Recalcular reajuste[\s\S]*?(?=\/\* ===== v13\.19 · Início: resumo diário ===== \*\/)/, '');
chk('nenhuma tela mudou: CSS idêntico ao da v14.09 (a v14.11 só soma os blocos próprios do Lote 1)', md5(css11) === '9a84f97bcefadbe8128ac3198ca2f1c9', md5(css11));
const nBtn = [(html.match(/<button/g) || []).length, (html.match(/data-a="/g) || []).length, (html.match(/class="btn/g) || []).length];
chk('nenhum botão ou ação nova na v14.10: 461 <button>, 545 data-a e 341 class="btn" da v14.09 (v14.11: 472, 558 e 351 — só os do Lote 1; v14.12: 484, 558 e 366 — só os do Lote 2)', [nBtn.join() === '461,545,341', nBtn.join() === '472,558,351', nBtn.join() === '484,558,366'].some(Boolean), nBtn);
chk('sem botão manual de sincronizar: a única ação de sincronia continua sendo a antiga "Sincronizar com o FCX" (outro assunto)', [...html.matchAll(/data-a="([^"]*sync[^"]*)"/gi)].map(m => m[1]).join() === 'alg-sync' && (html.match(/Sincronizar/g) || []).length === 1);
const lerSrv = f => fs.readFileSync(path.join(raiz, 'netlify/functions', f), 'utf8');
chk('servidor intacto: arquivos.mjs idêntico ao da v14.09; mudancas.mjs idêntico ao da v14.09 ou ao da v14.12 (só ganhou a trava de salário por árvore do organograma, atrás do recurso gestao_v1412)', md5(lerSrv('arquivos.mjs')) === 'f209181f6e495406ada1c3356b947562' && ['9a725039eab4f93289c092a9340cc138', '175277d45a9f5a64db6471533da6ca03'].includes(md5(lerSrv('mudancas.mjs'))));
chk('Regra de Ouro: fcx.html, contabilidade.html e contabilidade_v1391.html intactos', ['fcx.html:0c13655f', 'contabilidade.html:a41642fb', 'contabilidade_v1391.html:ea73d20b'].every(x => { const [n, h] = x.split(':'); return md5(fs.readFileSync(path.join(raiz, 'public', n), 'utf8')).startsWith(h); }));
chk('recurso gestao_v1410 registrado (versão v14.10) e helper g10()', /gestao_v1410: \{ versao: 'v14\.10'/.test(html) && /function g10\(\) \{ return typeof Recursos !== 'undefined' && Recursos\.ativo\('gestao_v1410'\); \}/.test(html));
chk('o ciclo antigo continua no código (recurso desligado) e o novo só vale com g10()', /setTimeout\(tick, document\.hidden \? 30000 : 5000\)/.test(html) && /if \(g10\(\)\) return this\._ciclo\('tempo'\)/.test(html) && /if \(!g10\(\)\) return this\._tick\(\)/.test(html));
chk('gravação concluída pede a consulta imediata só com o recurso ligado', /else if \(this\._gravou\) \{ this\._gravou = false; if \(g10\(\)\) SyncEco\.gravou\(this\); \}/.test(html));
chk('o envio de anexos e os termos usam a compactação só com o recurso ligado', /const f = g10\(\) \? await ImgEco\.comprimir\(file\) : file;/.test(html) && /if \(g10\(\)\) return ImgEco\.comprimir\(file\);/.test(html));
chk('os limites de tamanho não mudaram (5 MB por arquivo, 15 MB por imagem de termo)', /LIMITE: 5 \* 1024 \* 1024,/.test(html) && /LIMITE_IMG: 15 \* 1024 \* 1024/.test(html));
chk('PDF nunca entra na compactação (tipo e extensão)', /MIMES: \/\^image\\\/\(jpeg\|jpg\|png\|webp\)\$\/i/.test(html) && !/MIMES[^\n]*pdf/.test(html));

console.log(`\n${OK.length} ok, ${FAIL.length} falha(s)`);
process.exit(FAIL.length ? 1 : 0);
