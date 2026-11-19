/* v14.01 · Backup: o modal bloqueante "Backup diário obrigatório" NÃO abre com os pontos de restauração na nuvem ativos.
   Teste sem navegador e sem banco: lê o public/index.html, extrai o objeto BackupDiario (a trava) e o método BackupNuvem.primeiroAcesso e os roda
   numa caixa isolada (node:vm) com um DOM de mentira e relógio controlado. Dados fictícios.
   Uso: node tests/teste-backup-modal.mjs */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(raiz, 'public/index.html'), 'utf8');
const OK = [], FAIL = [];
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x !== '' ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 600) : '')); };
const fluxo = () => new Promise(r => setImmediate(r));

/* ---------- extrai o código do painel ---------- */
const a = html.indexOf('const BackupDiario = {'), b = html.indexOf('window.BackupDiario = BackupDiario;');
chk('o código do BackupDiario está no painel', a > 0 && b > a);
const srcDiario = html.slice(a, b);
const i1 = html.indexOf('  primeiroAcesso() {'), i2 = html.indexOf('\n  render() {', i1);
chk('o método BackupNuvem.primeiroAcesso está no painel', i1 > 0 && i2 > i1);
const srcPrimeiro = html.slice(i1, i2);

/* ---------- DOM de mentira ---------- */
function mundo({ nuvem, podeBackup = true, homolog = false, config = true }) {
  const est = { anexados: [], removidos: 0, ouvintes: 0, avisos: [], timers: [], toasts: [], reqs: [], encerrou: false };
  const mkEl = () => { const el = { className: '', dataset: {}, attrs: {}, _html: '', removed: false, classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } }, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() { }, contains() { return false; }, querySelector() { return { focus() { } }; }, remove() { this.removed = true; est.removidos++; } }; Object.defineProperty(el, 'innerHTML', { set(v) { el._html = v; }, get() { return el._html; } }); return el; };
  const body = { classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } }, appendChild(e) { est.anexados.push(e); } };
  const doc = { createElement: mkEl, body, addEventListener() { est.ouvintes++; }, removeEventListener() { est.ouvintes--; } };
  const ctx = {
    document: doc, window: {}, console: { warn: (...a) => est.avisos.push(a.join(' ')), info() { }, log() { }, error() { } }, localStorage: { setItem() { }, getItem() { return null; } },
    Ambiente: { producao: true, id: 'prod', homolog }, Datas: { hojeISO: () => '2026-11-12' }, Auth: { simulado: null, can: p => (p === 'backup.exportar' ? podeBackup : false), id: 'u1', nome: 'Usuário Fictício' },
    Sessao: { ativa: true, encerrar: async () => { est.encerrou = true; } }, UI: { toast: t => est.toasts.push(t) }, Bkp: { json: async () => true },
    Cloud: { adapter: { watchDoc: () => () => { }, set: async () => { } }, base: { netlify: true, _req: async (...a) => { est.reqs.push(a); return {}; } } },
    Repo: { prontas: new Set(config ? ['config'] : []) }, esc: s => String(s ?? ''), BackupNuvem: { nuvem: () => nuvem, carregar() { } }, App: { rota: 'menu' },
    setInterval: () => 1, clearInterval() { }, setTimeout: (fn, ms) => { est.timers.push({ fn, ms }); return est.timers.length; }, Date, String, Promise,
  };
  ctx.window = ctx; vm.createContext(ctx);
  return { ctx, est, diario: () => vm.runInContext(srcDiario + '\nBackupDiario;', ctx) };
}
const abertos = est => est.anexados.filter(e => !e.removed);

/* ---------- 1 · nuvem funcionando (recurso backup_nuvem_v1395 ativo + Postgres): nunca abre, para nenhum perfil ---------- */
for (const [rot, pode] of [['Master (pode fazer backup)', true], ['demais perfis (Operacional, Loja…)', false]]) {
  const { est, diario } = mundo({ nuvem: true, podeBackup: pode }), d = diario();
  d._visto = true; d._status = null; d._t0 = Date.now();
  d.avaliar(); d.abrir();
  chk(`nuvem ativa · ${rot}: nada de modal, o corpo da página não trava e nenhum bloqueio de clique/teclado é instalado`, d.dispensado?.() === true && abertos(est).length === 0 && d._el === null && !est.anexados.length && est.ouvintes === 0, est);
}

/* ---------- 2 · sem a nuvem a trava continua como na v13.64 ---------- */
{
  const { est, diario } = mundo({ nuvem: false, podeBackup: true }), d = diario(); d._visto = true; d._status = null; d._t0 = Date.now();
  d.avaliar();
  chk('sem a nuvem (claude.ai ou recurso desligado): o Master vê "Backup diário obrigatório" com o botão do backup', d.dispensado?.() !== true && abertos(est).length === 1 && /Backup diário obrigatório/.test(abertos(est)[0].innerHTML) && /Realizar Backup Obrigatório do Dia/.test(abertos(est)[0].innerHTML), est.anexados.map(e => e.innerHTML.slice(0, 80)));
  const o = mundo({ nuvem: false, podeBackup: false }), d2 = o.diario(); d2._visto = true; d2._status = null; d2._t0 = Date.now(); d2.avaliar();
  chk('sem a nuvem: os demais perfis veem "Painel bloqueado" (sem botão de backup)', abertos(o.est).length === 1 && /Painel bloqueado/.test(abertos(o.est)[0].innerHTML) && !/Realizar Backup/.test(abertos(o.est)[0].innerHTML));
}

/* ---------- 3 · liberar o recurso com o modal aberto fecha; o backup do dia feito também fecha ---------- */
{
  let nuvem = false; const w = mundo({ nuvem: false }); w.ctx.BackupNuvem.nuvem = () => nuvem; const d = w.diario(); d._visto = true; d._status = null; d._t0 = Date.now();
  d.avaliar(); const abriu = abertos(w.est).length === 1;
  nuvem = true; d.avaliar();
  chk('recurso liberado com o modal aberto: fecha na hora (e o corpo destrava)', abriu && d._el === null && abertos(w.est).length === 0 && !w.ctx.document.body.classList.contains('bkd-on'));
  nuvem = false; d.avaliar();
  chk('recurso desligado de novo: a trava antiga volta (reversível)', abertos(w.est).length === 1);
  d._status = { data: '2026-11-12' }; d.avaliar();
  chk('com o backup do dia já feito (.json da Contingência conta) a trava antiga fecha', d._el === null && abertos(w.est).length === 0);
}

/* ---------- 4 · enquanto a lista de recursos / o estado do dia não chegaram, não se decide (o modal não "pisca") ---------- */
{
  const w = mundo({ nuvem: false, config: false }), d = w.diario(); d._t0 = Date.now(); d._status = null;
  d._visto = true; d.avaliar();
  chk('lista de recursos ainda não chegou (Produção/Falco): não abre nada', d.decidivel?.() === false && abertos(w.est).length === 0);
  w.ctx.Repo.prontas.add('config'); d.avaliar();
  chk('chegou a lista e o recurso não está ativo: aí sim a trava antiga abre', d.decidivel?.() === true && abertos(w.est).length === 1);
  const x = mundo({ nuvem: false, config: false }), e = x.diario(); e._t0 = Date.now() - 25000; e._status = null; e._visto = true; e.avaliar();
  chk('se a lista não vier em ~20 s, vale a regra antiga (a proteção não depende da rede de recursos)', e.decidivel?.() === true && abertos(x.est).length === 1);
  const y = mundo({ nuvem: false, homolog: true, config: false }), h = y.diario(); h._t0 = Date.now(); h._status = null; h._visto = true; h.avaliar();
  chk('Homologação (recurso sempre ativo) decide de imediato, sem esperar a lista', h.decidivel?.() === true && abertos(y.est).length === 1);
  const z = mundo({ nuvem: false }), n = z.diario(); n._t0 = Date.now(); n._status = null; n._visto = false; n.avaliar();
  chk('sem saber ainda o estado do dia (primeira leitura não chegou), não abre', abertos(z.est).length === 0);
}

/* ---------- 5 · primeiro acesso na nuvem: falha só vai ao console, com uma nova tentativa em 1 minuto ---------- */
{
  const w = mundo({ nuvem: true }); w.ctx.Cloud.base._req = async (...a) => { w.est.reqs.push(a); throw new Error('Failed to fetch'); };
  const obj = vm.runInContext(`({ ui: {}, _pa: false, nuvem() { return true; }, carregar() { }, ${srcPrimeiro} })`, w.ctx);
  obj.primeiroAcesso();
  chk('primeiro acesso: espera ~1,2 s e a chamada é uma só (POST verificar-primeiro-acesso), em segundo plano', w.est.timers.length === 1 && w.est.timers[0].ms === 1200 && w.est.reqs.length === 0);
  w.est.timers.shift().fn(); await fluxo(); await fluxo();
  chk('a chamada vai com { acao: "verificar-primeiro-acesso" } em POST /api/backup-nuvem', w.est.reqs.length === 1 && w.est.reqs[0][0] === 'POST' && w.est.reqs[0][1] === '/api/backup-nuvem' && w.est.reqs[0][2].acao === 'verificar-primeiro-acesso', w.est.reqs);
  chk('rede instável: só registra no console (aviso), sem toast, sem modal, sem travar; _pa volta a false e uma nova tentativa fica marcada para 60 s', w.est.avisos.length === 1 && /ponto de restauração do primeiro acesso não criado agora/.test(w.est.avisos[0]) && /Failed to fetch/.test(w.est.avisos[0]) && w.est.toasts.length === 0 && w.est.anexados.length === 0 && obj._pa === false && obj._nova === true && w.est.timers.some(t => t.ms === 60000), [w.est.avisos, w.est.timers.map(t => t.ms)]);
  w.est.timers.splice(0).filter(t => t.ms === 60000).forEach(t => t.fn()); await fluxo();
  chk('a nova tentativa (60 s depois) chama o servidor de novo', w.est.timers.length === 1 && w.est.timers[0].ms === 1200);
  w.est.timers.shift().fn(); await fluxo(); await fluxo();
  chk('se falhar outra vez: só mais um aviso no console e nenhuma terceira tentativa agendada (a próxima é na próxima inicialização do painel)', w.est.reqs.length === 2 && w.est.avisos.length === 2 && !w.est.timers.some(t => t.ms === 60000) && w.est.toasts.length === 0);
}
{
  const w = mundo({ nuvem: true }); w.ctx.Cloud.base._req = async (...a) => { w.est.reqs.push(a); return { criado: true, ponto: { id: 1 } }; };
  const obj = vm.runInContext(`({ ui: {}, _pa: false, nuvem() { return true; }, carregar() { }, ${srcPrimeiro} })`, w.ctx);
  obj.primeiroAcesso(); w.est.timers.shift().fn(); await fluxo(); await fluxo();
  chk('primeiro acesso com sucesso: sem avisos, sem modal, e não repete (_pa continua true)', w.est.avisos.length === 0 && obj._pa === true && obj.ui.primeiro?.criado === true && w.est.anexados.length === 0 && w.est.timers.length === 0);
}
{
  const w = mundo({ nuvem: false }); const obj = vm.runInContext(`({ ui: {}, _pa: false, nuvem() { return false; }, carregar() { }, ${srcPrimeiro} })`, w.ctx);
  obj.primeiroAcesso(); w.est.timers.shift().fn(); await fluxo();
  chk('recurso desligado/sem nuvem: nenhuma chamada ao servidor (nada muda)', w.est.reqs.length === 0 && obj._pa === false);
}

/* ---------- 6 · o .json diário só na "Contingência" de Backup e dados (quando a nuvem está ativa) ---------- */
{
  const t0 = html.indexOf('${BackupNuvem.pode() ? `${BackupNuvem.render()}'), t1 = html.indexOf(': `<div class="grid g2">', t0);
  const ramoNuvem = html.slice(t0, t1), ct = ramoNuvem.indexOf('id="bknConting"'), jsons = [...ramoNuvem.matchAll(/data-a="bkp-json"/g)].map(m => m.index);
  chk('Backup e dados com a nuvem ativa: o único botão "Baixar backup completo" (.json) fica dentro do <details> "Contingência" (recolhido, sem "open")', t0 > 0 && t1 > t0 && ct > 0 && jsons.length === 1 && jsons[0] > ct && !/<details[^>]*id="bknConting"[^>]*\bopen\b/.test(ramoNuvem) && /Contingência/.test(ramoNuvem));
}

/* ---------- 7 · a versão e a ausência do defeito antigo ---------- */
chk('a versão v14.01 está na lista de versões do painel (marcador backup_corr_v1401) e a trava não depende dela', /backup_corr_v1401: \{ versao: 'v14\.01'/.test(html) && !/backup_corr_v1401/.test(srcDiario));
chk('o defeito antigo sumiu: nenhum .catch(() => { this._pa = false; }) silencioso e o BackupDiario consulta a nuvem (BackupNuvem.nuvem) antes de abrir', !/\.catch\(\(\) => \{ this\._pa = false; \}\)/.test(html) && /dispensado\(\) \{ try \{ return BackupNuvem\.nuvem\(\); \}/.test(srcDiario) && /abrir\(\) \{\s*\n\s*if \(this\.dispensado\(\)/.test(srcDiario));

console.log('\nOK (' + OK.length + ')  FALHAS (' + FAIL.length + ')');
process.exit(FAIL.length ? 1 : 0);
