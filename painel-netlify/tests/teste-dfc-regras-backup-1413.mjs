/* v14.13 · Regras da DFC "pétreas", aplicação automática a todos os meses do OFX e auditoria dos backups (nuvem × .json).
   Valida o CÓDIGO REAL do painel (public/index.html) e do servidor (netlify/lib) em contexto isolado do Node, só com dados FICTÍCIOS (LGPD; CPF/CNPJ gerados aqui).
   Dois blocos:
     A) sem banco (roda em segundos): catálogo de backup igual no painel e no servidor e cobrindo toda coleção que o painel usa; regras por id (criar/editar/mover/excluir) sem
        pisar no que outra pessoa fez; snapshot que nunca regride; reclassificação de VÁRIOS meses de OFX preservando a classificação manual; leitura que falhou não grava nada;
        recurso desligado = comportamento da v14.12.
     B) com Postgres local e o servidor de teste (NETLIFY_DB_URL e porta 8890, como os demais testes de servidor; sem eles este bloco é pulado e avisado):
        1. regras do usuário sobrevivem a recarga (F5), login, ciclo de sincronização e a "semente de fábrica" tardia; escrita velha/vazia/de fábrica é recusada (409) e o painel refaz sozinho;
        2. criar/editar regra reclassifica vários meses e preserva as classificações manuais (código real do painel falando com o servidor real);
        3. auditoria dos backups: registros simulados em TODAS as frentes recentes (DFC e regras, empresas/Matriz, parceiros/PIX, notificações, contratos/apólices/reajustes, férias e
           viagens, RH, lojas, metas, FCX, retaguarda, adquirentes, usuários), ponto na nuvem E arquivo .json, base apagada e restaurada: 100% volta íntegro (documentos e tabelas).
   (A varredura de segredos do pacote é feita na entrega, fora deste arquivo: nenhum segredo é escrito aqui, nem como padrão de busca.)
   O bloco B usa um banco NOVO a cada execução (ele cria o estado inicial e apaga a base de propósito).
   Uso: node tests/teste-dfc-regras-backup-1413.mjs   (bloco B: bash tests/preparar-banco.sh; NETLIFY_DB_URL=… node tests/servidor-local.mjs 8890 &) */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(process.env.PAINEL_HTML || path.join(raiz, 'public/index.html'), 'utf8');
const OK = [], FAIL = [];
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x !== '' ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 900) : '')); };
const md5 = t => createHash('md5').update(t).digest('hex');
const corta = (ini, fim) => { const a = html.indexOf(ini), b = html.indexOf(fim, a + ini.length); if (a < 0 || b < 0) throw new Error('bloco não encontrado: ' + ini.slice(0, 60) + ' … ' + fim.slice(0, 60)); return html.slice(a, b); };
const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
const igual = (a, b) => JSON.stringify(ordena(a)) === JSON.stringify(ordena(b));
function ordena(v) { return Array.isArray(v) ? v.map(ordena) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, ordena(v[k])])) : v; }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const escopo = await import('../netlify/lib/backup-escopo-1413.mjs');
const guardaSrv = await import('../netlify/lib/dfc-1413.mjs');

/* ---------- 0 · recurso, Regra de Ouro, nada de marcador de montagem ---------- */
chk('recurso gestao_v1413 na lista de liberação (v14.13) e helper g13()', /gestao_v1413: \{ versao: 'v14\.13'/.test(html) && /function g13\(\) \{ return typeof Recursos !== 'undefined' && Recursos\.ativo\('gestao_v1413'\); \}/.test(html));
for (const [f, h] of [['fcx.html', '640800e0'], ['contabilidade.html', 'a41642fb'], ['contabilidade_v1391.html', 'ea73d20b']]) {
  const p = path.join(raiz, 'public', f);
  chk(`Regra de Ouro: public/${f} ${f === 'fcx.html' ? 'idêntico ao da v14.17: v14.08 + a única exceção autorizada (importação de Saídas com os dois layouts do ERP, atrás de gestao_v1417)' : 'idêntico ao da v14.08'} (md5 ${h}…)`, fs.existsSync(p) && md5(fs.readFileSync(p)).startsWith(h));
}
chk('nenhuma peça deixou marcador de montagem no painel final', !/@@V1413_/.test(html));
chk('o servidor tem o recurso (dfc-1413) e o painel usa o mesmo nome', guardaSrv.RECURSO === 'gestao_v1413' && guardaSrv.CAMINHO === 'config/dfc');

/* ---------- 1 · catálogo dos backups: igual no painel e no servidor, e cobrindo TODA coleção que o painel usa ---------- */
const codBkp13 = corta('const Bkp13 = {', '\nObject.assign(Bkp, {\n  _o13:') + '\nreturn Bkp13;';
const novoBkp13 = (Dfc13 = null, Cloud = {}) => new Function('Auth', 'Retaguarda', 'Parc11', 'g13', 'UI', 'esc', 'Fmt', 'Cloud', 'Dfc13', codBkp13)(
  { can: () => true }, { podeVerOc: () => true }, { le: () => true }, () => true, {}, s => String(s), { num: n => String(n) }, Cloud, Dfc13);
const Bkp13 = novoBkp13();
chk('o catálogo de frentes do painel é IDÊNTICO ao do servidor (backup-escopo-1413.mjs)', igual(Bkp13.FRENTES, escopo.FRENTES) && igual(Bkp13.OUTRAS, escopo.OUTRAS) && igual(Bkp13.RAIZES_FORA, escopo.RAIZES_FORA)
  && igual(Bkp13.TABELAS.map(t => [t.nome, t.rotulo]), escopo.TABELAS.map(t => [t.nome, t.rotulo])));
const legado = [...corta('const Bkp = {', "\n  render() {").matchAll(/'([A-Za-z_/]+)'/g)].map(m => m[1]).filter(c => !/^v1|^backup/.test(c));
const noCatalogo = new Set(Bkp13.colecoes());
chk('todas as coleções do .json de antes (v14.12) continuam no .json novo', legado.length > 40 && legado.every(c => noCatalogo.has(c)), legado.filter(c => !noCatalogo.has(c)));
chk('o .json novo inclui Fornecedores e Clientes (parceiros, com PIX e categoria DFC) e os anexos dos termos assinados em partes', ['parceiros', 'faltas/_anexos/partes', 'ret_ocorrencias/_anexos/partes'].every(c => noCatalogo.has(c)) && !legado.includes('parceiros'));
chk('toda coleção das frentes do servidor está na lista do .json (paridade nuvem × arquivo)', escopo.FRENTES.flatMap(f => f.colecoes).every(c => noCatalogo.has(c)));
chk('o .json nunca inclui o que não deve ser sobrescrito (auditoria, presença, sistema, ramos de ambiente)', Bkp13.colecoes().every(c => !escopo.RAIZES_FORA.includes(c.split('/')[0])));
const usadas = new Set([...html.matchAll(/Repo\.(?:salvar|assinar|todos|get|excluir|recarregar)\('([A-Za-z_]+)'/g)].map(m => m[1]));
const semFrente = [...usadas].filter(c => Bkp13.frenteDe(c) === 'outras' && !escopo.RAIZES_FORA.includes(c));
chk('AUDITORIA: toda coleção que o código do painel lê/grava (Repo.*) pertence a uma frente do backup (coleção nova sem frente reprova)', usadas.size > 25 && !semFrente.length, semFrente);
const usadasAd = new Set([...html.matchAll(/Cloud\.adapter\.(?:set|get|list|remove|watch)\('([A-Za-z_]+)[/']/g)].map(m => m[1]));
chk('AUDITORIA: as coleções acessadas direto pelo adaptador também têm frente (ou estão fora de propósito)', [...usadasAd].every(c => Bkp13.frenteDe(c) !== 'outras' || escopo.RAIZES_FORA.includes(c) || c === 'presenca'), [...usadasAd].filter(c => Bkp13.frenteDe(c) === 'outras'));
const exemplos = ['lojas', 'funcionarios/_viagens/pedidos', 'funcionarios/_liberacoes/pedidos', 'faltas/_anexos/partes', 'ret_ocorrencias/_anexos/partes', 'config', 'dfc', 'parceiros', 'partes_contratuais', 'coisa_nova', 'credsystem_base'];
chk('frenteDe: painel e servidor classificam igual (sub-coleções pela raiz mais longa; desconhecida → outras)', exemplos.every(c => Bkp13.frenteDe(c) === escopo.frenteDe(c)) && Bkp13.frenteDe('coisa_nova') === 'outras' && Bkp13.frenteDe('funcionarios/_viagens/pedidos') === 'viagens' && Bkp13.frenteDe('faltas/_anexos/partes') === 'retaguarda');
const amostra = { colecoes: { lojas: 3, funcionarios: 5, 'funcionarios/_viagens/pedidos': 2, config: 4, parceiros: 7, 'faltas/_anexos/partes': 1, extratos: 9, novidade: 2 }, tabelas: { painel_notificacoes_regras: 4, contab_depara: 2 }, destaques: { dfc: { regras: 3, categorias: 1, ajustesPadrao: 0, mapaFCX: 2, inicializada: true }, configDocs: ['dfc', 'empresas'] } };
chk('resumir: o resumo por frente do painel é idêntico ao do servidor (totais, itens, tabelas, coleção sem frente)', igual(Bkp13.resumir(amostra), escopo.resumir(amostra)) && Bkp13.resumir(amostra).total === 3 + 5 + 2 + 4 + 7 + 1 + 9 + 2 + 4 + 2 && igual(Bkp13.resumir(amostra).semFrente, ['novidade']));
chk('resumir: cada módulo aparece (mesmo vazio) e as tabelas ficam na frente certa (Central de Notificações, Contábil)', Bkp13.resumir({}).frentes.length === escopo.FRENTES.length && Bkp13.resumir(amostra).frentes.find(f => f.id === 'notificacoes').itens[0].nome === 'painel_notificacoes_regras' && Bkp13.resumir(amostra).frentes.find(f => f.id === 'contabil').registros === 2);

/* ---------- 2 · motor da DFC real + módulo Dfc13 real, com um servidor de brincadeira que usa a TRAVA REAL (netlify/lib/dfc-1413.mjs) ---------- */
const csvCod = corta('const CSV = {', '/**\n * WhatsApp (camada Util)'), ofxCod = corta('const OFX = {', '/* ======================= CONTAS (de-para)'), dfcCod = corta('const DFC_GRUPOS = {', '/* ============================ IEO ============================ */');
const dfcFn = new Function('Repo', 'g04', 'g05', 'g09', csvCod + '\n' + ofxCod + '\n' + dfcCod + '\nreturn { DFC, DFC_REGRAS_PADRAO, DFC_CATEGORIAS };');
const dfcCodigo = corta('const Dfc13 = {', '\n};\n/* ---- ganchos no FluxoDFC') + '\n};';
const ganchosCod = corta('Object.assign(FluxoDFC, {\n  _o13: {', '/* =====================================================================\n   v14.13 · AUDITORIA DOS BACKUPS');

function banco(adapterImpl) {                       // memória do navegador (Repo) + motor da DFC + Dfc13, todos reais; só a rede e a tela são de mentira
  const msgs = [], alertas = [], audits = [], perms = new Set(['fcx.dfc.ver', 'fcx.dfc.regras', 'fcx.dfc.importar']);
  const Repo = { cols: { config: new Map(), extratos: new Map(), dfc: new Map() }, prontas: new Set(['config', 'extratos', 'dfc']), falhas: {}, flag: true, escritas: [], bumps: 0,
    get: (c, id) => (Repo.cols[c] && Repo.cols[c].get(id)) || null, todos: c => [...(Repo.cols[c] || new Map()).values()], _bump() { Repo.bumps++; },
    semMeta: d => { if (!d) return d; const { id, atualizadoEm, atualizadoPor, criadoEm, criadoPor, ...r } = d; return r; },
    async salvar(col, id, dados, meta = {}) {
      const doc = { ...clone(dados), atualizadoEm: new Date().toISOString(), atualizadoPor: 'teste' }; delete doc.id;
      try { await adapterImpl.set(col + '/' + id, doc); } catch (e) { msgs.push('Não foi possível salvar: ' + e.message); throw e; }
      (Repo.cols[col] ||= new Map()).set(id, { id, ...doc }); Repo.escritas.push(col + '/' + id);
    } };
  const UI = { toast: m => msgs.push(m), alerta: async (t, h) => { alertas.push({ t, h }); }, carregando: () => ({ etapa() { }, fechar() { } }), confirmar: async () => true };
  const Auth = { can: p => perms.has(p) }, Audit = { registrar: async e => { audits.push(e); } }, Fmt = { dataHora: v => String(v).replace('T', ' ').slice(0, 16), num: n => String(n) };
  const flags = { g13: true };
  let M; const FluxoDFC = {
    ui: { mes: '2026-08', sub: 'dfc' }, mesLabel: m => m, esperarForn05: async () => { },
    transacoes: () => Repo.todos('extratos').flatMap(d => (d.transacoes || []).map(t => ({ ...t, contaId: d.contaId, docId: d.id }))),
    mesesBanco: () => [...new Set(Repo.todos('extratos').map(d => d.mes))].sort().reverse(),
    esperarForn05_: 0, trDFC() { return this.transacoes(); }, // v14.17: com o recurso desligado a DFC lê o extrato como está
  };
  const { DFC, DFC_REGRAS_PADRAO } = dfcFn(Repo, () => true, () => true, () => true);
  M = new Function('Repo', 'Cloud', 'UI', 'App', 'Audit', 'Auth', 'DFC', 'FluxoDFC', 'Fmt', 'esc', 'clone', 'sleep', 'DFC_REGRAS_PADRAO', 'g13', 'g17', dfcCodigo + '\nreturn Dfc13;')(
    Repo, { adapter: adapterImpl }, UI, { agendarRender() { } }, Audit, Auth, DFC, FluxoDFC, Fmt, s => String(s ?? ''), clone, () => Promise.resolve(), DFC_REGRAS_PADRAO, () => flags.g13, () => false);
  return { Repo, UI, Auth, Audit, Fmt, perms, flags, msgs, alertas, audits, FluxoDFC, DFC, DFC_REGRAS_PADRAO, Dfc13: M };
}
/** servidor de brincadeira: guarda config/dfc com a MESMA função de trava do servidor real (guardar) e devolve o código do erro como o adaptador devolve */
function servidorFake() {
  const docs = new Map(), a = { docs, falhaLeitura: false, falhaEscrita: null, leituras: 0, gravacoes: 0,
    async get(p) { a.leituras++; if (a.falhaLeitura) throw new Error('Sem conexão com o servidor do painel.'); const d = docs.get(p); return d ? { id: p.split('/').pop(), ...clone(d) } : null; },
    async set(p, doc) {
      if (a.falhaEscrita) { const e = new Error(a.falhaEscrita.msg); e.status = a.falhaEscrita.status; e.codigo = a.falhaEscrita.codigo || ''; throw e; }
      a.gravacoes++; let d = clone(doc);
      if (p === 'config/dfc') { try { d = guardaSrv.guardar(docs.get(p) || null, d); } catch (e) { const x = new Error(e.message); x.status = e.status; x.codigo = (e.extra && e.extra.codigo) || ''; throw x; } }
      docs.set(p, d);
    } };
  return a;
}
const tx = (id, data, valor, hist, extra = {}) => ({ id, data, valor, hist, ...extra });
function extratos(b) {                                // três meses de OFX, com uma classificação manual (cat) no meio
  const mk = (mes, trs) => b.Repo.cols.extratos.set('cb1_' + mes + '_0', { id: 'cb1_' + mes + '_0', contaId: 'cb1', mes, parte: 0, transacoes: trs });
  mk('2026-08', [tx('a1', '2026-08-03', 10000, 'GETNET LIQUIDACAO'), tx('a2', '2026-08-05', -900, 'PAGTO LOJA DO JOAO ME'), tx('a3', '2026-08-09', -400, 'PAGTO LOJA DO JOAO ME', { cat: 'pag_folha', manual: true })]);
  mk('2026-09', [tx('b1', '2026-09-02', 8000, 'GETNET LIQUIDACAO'), tx('b2', '2026-09-07', -700, 'PAGTO LOJA DO JOAO ME')]);
  mk('2026-10', [tx('c1', '2026-10-04', 9000, 'GETNET LIQUIDACAO'), tx('c2', '2026-10-06', -300, 'COMPRA AVULSA XYZ')]);
}
const cats = b => m => (b.Repo.get('dfc', m) || {}).porCategoria || {};

{
  const S = servidorFake(), b = banco(S), D = b.Dfc13, R = b.Repo;
  const ini = clone(b.DFC_REGRAS_PADRAO);

  /* funções puras */
  chk('mesclar: criar põe a regra no topo e NÃO mexe no que outra pessoa fez na lista do servidor', (() => {
    const base = ini, servidor = [{ id: 'r-outro', termos: ['OUTRO'], sentido: 'S', categoria: 'pag_outros' }, ...ini], nova = { id: 'r-nova', termos: ['X'], sentido: 'S', categoria: 'pag_marketing' };
    const out = D.mesclar(servidor, base, [nova, ...base]); return out[0].id === 'r-nova' && out[1].id === 'r-outro' && out.length === servidor.length + 1;
  })());
  chk('mesclar: editar troca só a regra de mesmo id; excluir tira só a escolhida (já excluída por outra pessoa: nada a fazer)', (() => {
    const e = D.mesclar(ini, ini, ini.map(r => r.id === 'r-folha' ? { ...r, termos: ['FOLHA', 'X'] } : r)), x = D.mesclar(ini, ini, ini.filter(r => r.id !== 'r-folha')), y = D.mesclar(x, ini, ini.filter(r => r.id !== 'r-folha'));
    return e.find(r => r.id === 'r-folha').termos.length === 2 && e.length === ini.length && x.length === ini.length - 1 && !x.some(r => r.id === 'r-folha') && y.length === x.length;
  })());
  chk('mesclar: editar uma regra que sumiu do servidor → erro "sumiu" (nunca recria sem querer)', (() => { try { D.mesclar(ini.filter(r => r.id !== 'r-folha'), ini, ini.map(r => r.id === 'r-folha' ? { ...r, termos: ['Z'] } : r)); return false; } catch (e) { return e.codigo === 'sumiu'; } })());
  chk('mover: troca com a vizinha, respeita os limites e erra se a regra sumiu', D.mover(ini, 'r-cartoes', -1)[0].id === 'r-cartoes' && D.mover(ini, 'r-transf', -1)[0].id === 'r-transf' && D.mover(ini, ini[ini.length - 1].id, 1).length === ini.length && (() => { try { D.mover(ini, 'nao-existe', 1); return false; } catch (e) { return e.codigo === 'sumiu'; } })());
  chk('escolher: snapshot com contador MENOR, ou sem o documento, nunca troca a cópia local já inicializada; igual ou maior vale', (() => {
    const local = { id: 'dfc', regras: [{ id: 'a', termos: ['A'], sentido: 'S', categoria: 'pag_outros' }], regras_rev: 5, regras_inicializadas: true };
    return D.escolher(local, { id: 'dfc', regras: ini, regras_rev: 4 }) === local && D.escolher(local, null) === local && D.escolher(local, { id: 'dfc', regras: [], regras_rev: 5 }).regras.length === 0
      && D.escolher(local, { id: 'dfc', regras: ini, regras_rev: 6 }).regras.length === ini.length && D.escolher(null, { id: 'dfc' }).id === 'dfc' && D.escolher({ id: 'dfc' }, null) === null;
  })());
  chk('escolher: snapshot do servidor SEM a lista de regras não apaga a lista que a aba já tem (mantém a local)', (() => {
    const local = { id: 'dfc', regras: ini, regras_rev: 3, regras_inicializadas: true }, r = D.escolher(local, { id: 'dfc', categorias: [] , regras_rev: 3 });
    return Array.isArray(r.regras) && r.regras.length === ini.length && Array.isArray(r.categorias);
  })());
  chk('filtrarSnapshot: o polling (snapshot da coleção config) nunca regride config/dfc; as outras configurações passam normalmente', (() => {
    const local = { id: 'dfc', regras: [{ id: 'a', termos: ['A'], sentido: 'S', categoria: 'pag_outros' }], regras_rev: 9, regras_inicializadas: true };
    const f = D.filtrarSnapshot([{ id: 'dfc', regras: ini, regras_rev: 2 }, { id: 'empresas', x: 1 }], local), sem = D.filtrarSnapshot([{ id: 'empresas', x: 1 }], local);
    return f.find(d => d.id === 'dfc') === local && f.find(d => d.id === 'empresas').x === 1 && sem.find(d => d.id === 'dfc') === local && sem.length === 2;
  })());
  chk('sig: muda com regras, ordem, categorias, ajustes e De-para; igual para o mesmo conteúdo; documento nunca inicializado = regras de fábrica', (() => {
    const a = D.sig({ regras: ini }), mover = D.sig({ regras: D.mover(ini, 'r-cartoes', -1) }), cat = D.sig({ regras: ini, categorias: [{ id: 'cus_1', nome: 'X' }] }), aj = D.sig({ regras: ini, ajustesPadrao: { pag_marketing: { nome: 'Y', grupo: 'OPERACIONAL' } } }), mp = D.sig({ regras: ini, mapaFCX: { '5.1.01': 'pag_outros' } });
    return a === D.sig({ regras: clone(ini) }) && new Set([a, mover, cat, aj, mp]).size === 5 && D.sig(null) === a && D.sig({}) === a && /^[0-9a-f]{8}$/.test(a);
  })());
  chk('ehManual: transação com categoria própria (cat) é manual; sem cat não é', D.ehManual({ cat: 'pag_folha' }) && !D.ehManual({ hist: 'X' }) && !D.ehManual({ cat: '' }));

  /* semente, 1ª alteração e o servidor */
  R.cols.config.set('dfc', { id: 'dfc', mapaFCX: {} }); R.prontas.add('config'); extratos(b);
  b.flags.g13 = true;
  chk('antes de qualquer alteração o painel mostra as regras de fábrica (só leitura) e NADA é gravado em config/dfc ao abrir, recarregar ou sincronizar', b.DFC.regras().length === ini.length && !R.get('config', 'dfc').regras);
  await D.sincronizar(true); await D.sincronizar(true);
  chk('abrir/recarregar/sincronizar não grava config/dfc (o servidor continua sem o documento)', S.gravacoes === 0 && !S.docs.has('config/dfc'));

  const novaRegra = { id: 'r-joao', termos: ['LOJA DO JOAO'], sentido: 'S', categoria: 'pag_marketing' };
  D._baseRegras = clone(ini);                                  // o editor abriu com a lista de fábrica (nunca inicializada)
  const r1 = await D.salvarRegras([novaRegra, ...ini], 'Regra criada');
  const sv1 = S.docs.get('config/dfc');
  chk('1ª alteração: o servidor confirmou, a lista própria foi salva (regra nova no topo + as de fábrica), marcada como inicializada e com contador 1', r1.alterado && sv1.regras.length === ini.length + 1 && sv1.regras[0].id === 'r-joao' && sv1.regras_inicializadas === true && sv1.regras_rev === 1 && !('regras_semente' in sv1), sv1 && { rev: sv1.regras_rev, n: sv1.regras.length });
  chk('feedback: "Regras salvas no servidor" aparece e nenhum alerta de erro foi mostrado', b.msgs.some(m => /^Regras salvas no servidor/.test(m)) && b.alertas.length === 0, b.msgs);
  chk('REAPLICAÇÃO AUTOMÁTICA: os 3 meses do OFX foram reclassificados sem clicar em "Recalcular DFC"; cada base mensal ganhou a assinatura das regras vigentes', ['2026-08', '2026-09', '2026-10'].every(m => R.get('dfc', m) && R.get('dfc', m).regrasSig === D.sigAtual()) && R.escritas.filter(e => e.startsWith('dfc/')).length === 3);
  chk('a regra nova vale em todos os meses (ago e set: LOJA DO JOAO → Marketing), e o mês sem a expressão fica como estava', (cats(b)('2026-09').pag_marketing || {}).valor === -700 && (cats(b)('2026-08').pag_marketing || {}).valor === -900 && !(cats(b)('2026-10').pag_marketing) && (cats(b)('2026-10').pag_outros || {}).valor === -300, [cats(b)('2026-08'), cats(b)('2026-09')]);
  chk('classificação MANUAL preservada: a transação a3 (cat: pag_folha) casa com a regra nova mas continua em Folha; a extrato não foi tocado', (cats(b)('2026-08').pag_folha || {}).valor === -400 && R.escritas.every(e => !e.startsWith('extratos/')) && R.get('extratos', 'cb1_2026-08_0').transacoes[2].cat === 'pag_folha');
  const antesEsc = R.escritas.length; await D.reaplicar('teste');
  chk('reaplicar de novo sem mudança grava 0 bases (idempotente: só regrava o que mudou)', R.escritas.length === antesEsc);
  const viaForcar = await D.atualizarBases(['2026-08', '2026-09', '2026-10'], { forcar: true });
  chk('"Recalcular DFC" (atalho opcional) força a regravação das 3 bases', viaForcar.gravados === 3);

  /* editar, mover, excluir por id */
  D._baseRegras = clone(D.regrasDe(S.docs.get('config/dfc')));
  const base2 = clone(D._baseRegras), r2 = await D.salvarRegras(base2.map(r => r.id === 'r-joao' ? { ...r, categoria: 'pag_utilidades' } : r), 'Regra editada');
  chk('editar: a regra muda no servidor e os meses são reclassificados (Marketing some, Utilidades aparece)', r2.alterado && S.docs.get('config/dfc').regras_rev === 2 && !(cats(b)('2026-09').pag_marketing) && (cats(b)('2026-09').pag_utilidades || {}).valor === -700);
  const r3 = await D.moverRegra('r-cartoes', -1);
  chk('mover (seta ↑): troca de prioridade com a vizinha, contador sobe, persiste e reaplica', r3.alterado && S.docs.get('config/dfc').regras[0].id === 'r-joao' && S.docs.get('config/dfc').regras[1].id === 'r-cartoes' && S.docs.get('config/dfc').regras_rev === 3 && S.docs.get('config/dfc').regras.length === ini.length + 1, S.docs.get('config/dfc').regras.slice(0, 4).map(x => x.id));
  const r3b = await D.moverRegra('r-joao', -1);
  chk('mover além do topo não grava nada (sem alteração)', r3b.alterado === false && S.docs.get('config/dfc').regras_rev === 3);
  const r4 = await D.excluirRegra('r-joao');
  chk('excluir: some do servidor, contador sobe e os meses voltam a "outros"', r4.alterado && !S.docs.get('config/dfc').regras.some(r => r.id === 'r-joao') && S.docs.get('config/dfc').regras_rev === 4 && (cats(b)('2026-09').pag_outros || {}).valor === -700);

  /* concorrência: outra pessoa mexeu depois de a tela carregar */
  const outra = clone(S.docs.get('config/dfc')); outra.regras = [{ id: 'r-dela', termos: ['DELA'], sentido: 'S', categoria: 'pag_tarifas' }, ...outra.regras]; outra.regras_rev = 5; S.docs.set('config/dfc', outra);
  R.cols.config.set('dfc', { id: 'dfc', ...clone(S.docs.get('config/dfc')), regras_rev: 4, regras: outra.regras.slice(1) }); // a aba ficou com a versão 4
  D._baseRegras = clone(outra.regras.slice(1));
  const rc = await D.salvarRegras([{ id: 'r-meu', termos: ['MEU'], sentido: 'S', categoria: 'pag_marketing' }, ...outra.regras.slice(1)], 'Regra criada');
  const svc = S.docs.get('config/dfc');
  chk('base velha: a aba tinha a versão 4 e o servidor já estava na 5 → o painel leu o servidor, refez a alteração por id e a regra da OUTRA pessoa foi preservada', rc.alterado && svc.regras.some(r => r.id === 'r-dela') && svc.regras.some(r => r.id === 'r-meu') && svc.regras_rev === 6, svc.regras.map(r => r.id).slice(0, 4));
  const sob = clone(S.docs.get('config/dfc')); const emVoo = S.set; let tentou = 0;
  S.set = async function (p, doc) { if (p === 'config/dfc' && tentou++ < 5) { const e = new Error('As regras foram alteradas…'); e.status = 409; e.codigo = 'regras_desatualizadas'; throw e; } return emVoo.call(this, p, doc); };
  b.alertas.length = 0; let falhou = null; try { await D.excluirRegra('r-meu'); } catch (e) { falhou = e; }
  chk('conflito que não se resolve (3 tentativas): erro EXPLÍCITO com alerta em linguagem simples, nada gravado e as regras salvas continuam valendo', falhou && falhou.codigo === 'regras_desatualizadas' && b.alertas.length === 1 && /NÃO foram salvas/.test(b.alertas[0].t) && /Nada foi alterado/.test(b.alertas[0].h) && igual(S.docs.get('config/dfc'), sob), b.alertas);
  S.set = emVoo;

  /* leitura que falhou, permissão, erro do servidor */
  b.alertas.length = 0; S.falhaLeitura = true; let semLer = null; try { await D.excluirRegra('r-meu'); } catch (e) { semLer = e; }
  chk('servidor fora do ar na leitura: NADA é gravado (nunca regrava por cima sem ler) e o aviso é explícito', semLer && semLer.leitura === true && b.alertas.length === 1 && /NÃO foram salvas/.test(b.alertas[0].t) && /Não consegui ler/.test(b.alertas[0].h));
  S.falhaLeitura = false;
  b.alertas.length = 0; S.falhaEscrita = { status: 500, msg: 'Erro interno no servidor do painel.' }; let semGravar = null; const antesF = clone(S.docs.get('config/dfc'));
  try { await D.moverRegra('r-cartoes', 1); } catch (e) { semGravar = e; }
  chk('o servidor recusa a gravação (500): erro explícito, nada fica pela metade e a tela NÃO anuncia "salvo"', semGravar && b.alertas.length === 1 && igual(S.docs.get('config/dfc'), antesF) && !b.msgs.slice(-3).some(m => /^Regras salvas/.test(m)));
  S.falhaEscrita = null;
  b.alertas.length = 0; b.perms.delete('fcx.dfc.regras'); let semPerm = null; try { await D.excluirRegra('r-meu'); } catch (e) { semPerm = e; } b.perms.add('fcx.dfc.regras');
  chk('sem a permissão "Regras de classificação" nada é lido nem gravado e o aviso aparece', semPerm && b.alertas.length === 1 && /permissão/.test(b.alertas[0].h));

  /* leitura que falhou nunca vira "regras de fábrica gravadas nas bases" */
  R.falhas.config = 'Sem conexão'; const antesB = R.escritas.length; let semBase = null; try { await D.atualizarBases(['2026-08']); } catch (e) { semBase = e; }
  chk('a leitura de config falhou: a base mensal NÃO é recalculada (não grava dfc/ com regras que o painel não conseguiu ler)', semBase && /ainda não foram lidas/.test(semBase.message) && R.escritas.length === antesB);
  delete R.falhas.config;

  /* categorias, ajustes e De-para: sobre o servidor, com reaplicação */
  const catBase = []; D._baseCat = catBase;
  const rcat = await D.salvarCategorias([{ id: 'cus_a', nome: 'Distribuição de lucros', sentido: 'S', grupo: 'FINANCIAMENTO', impacto: 'soma' }], 'Categoria criada');
  chk('categoria nova: gravada sobre o servidor sem tocar nas regras (contador das regras intacto), com reaplicação automática', rcat.alterado && S.docs.get('config/dfc').categorias.length === 1 && S.docs.get('config/dfc').regras_rev === 6 && ['2026-08', '2026-09', '2026-10'].every(m => R.get('dfc', m).regrasSig === D.sigAtual()));
  const outraCat = clone(S.docs.get('config/dfc')); outraCat.categorias.push({ id: 'cus_b', nome: 'Outra pessoa', sentido: 'S', grupo: 'OPERACIONAL', impacto: 'soma' }); S.docs.set('config/dfc', outraCat);
  D._baseCat = clone(R.get('config', 'dfc').categorias);
  await D.salvarCategorias([...D._baseCat.map(c => c.id === 'cus_a' ? { ...c, nome: 'Distribuição de lucros e JCP' } : c)], 'Categoria editada');
  chk('categoria editada: a categoria criada por outra pessoa no meio do caminho foi preservada', S.docs.get('config/dfc').categorias.length === 2 && S.docs.get('config/dfc').categorias.find(c => c.id === 'cus_a').nome === 'Distribuição de lucros e JCP' && S.docs.get('config/dfc').categorias.some(c => c.id === 'cus_b'));
  await D.salvarAjuste('pag_marketing', { nome: 'Publicidade e propaganda', grupo: 'OPERACIONAL' }, 'Ajuste');
  chk('ajuste de categoria padrão: gravado sobre o servidor e removido com null', S.docs.get('config/dfc').ajustesPadrao.pag_marketing.nome === 'Publicidade e propaganda' && ((await D.salvarAjuste('pag_marketing', null, 'Restaurada')).alterado) && !S.docs.get('config/dfc').ajustesPadrao);
  await D.salvarMapa({}, { '5.1.01': 'pag_utilidades' });
  chk('De-para FCX → DFC: grava só a conta alterada sobre o mapa do servidor', S.docs.get('config/dfc').mapaFCX['5.1.01'] === 'pag_utilidades' && (await D.salvarMapa({ '5.1.01': 'pag_utilidades' }, { '5.1.01': 'pag_utilidades', '5.2.01': 'pag_tarifas' })).alterado && Object.keys(S.docs.get('config/dfc').mapaFCX).length === 2);

  /* garantir meses: regras vigentes lidas e aplicadas antes de exibir */
  R.cols.dfc.get('2026-09').regrasSig = 'velho'; const antesG = R.escritas.length;
  await D.garantirMeses(['2026-09', '2026-10']);
  chk('trocar de mês: a base obsoleta (assinatura antiga) é reclassificada antes de exibir; a atualizada não é regravada', R.get('dfc', '2026-09').regrasSig === D.sigAtual() && R.escritas.length === antesG + 1);
  D._ultLeitura = 0;   // a leitura do servidor é espaçada em 4 s (não relê a cada tela); aqui a zeramos de propósito
  R.cols.dfc.get('2026-09').regrasSig = 'velho'; b.perms.delete('fcx.dfc.importar'); b.perms.delete('fcx.dfc.regras'); const antesP = R.escritas.length; await D.garantirMeses(['2026-09']); b.perms.add('fcx.dfc.importar'); b.perms.add('fcx.dfc.regras');
  chk('quem só lê (sem permissão de gravar) vê o cálculo ao vivo e NÃO regrava a base', R.escritas.length === antesP);
  const outra2 = clone(S.docs.get('config/dfc')); outra2.regras_rev += 1; outra2.regras = [{ id: 'r-nuvem', termos: ['LOJA DO JOAO'], sentido: 'S', categoria: 'pag_tarifas' }, ...outra2.regras]; S.docs.set('config/dfc', outra2);
  D._ultLeitura = 0; await D.garantirMeses(['2026-09']);
  chk('trocar de mês traz as regras NOVAS do servidor (alteradas em outro computador) para a memória e reclassifica o mês com elas', R.get('config', 'dfc').regras[0].id === 'r-nuvem' && (cats(b)('2026-09').pag_tarifas || {}).valor === -700 && R.get('dfc', '2026-09').regrasSig === D.sigAtual());

  /* recurso desligado: o encaminhamento volta à v14.12 */
  const ganchos = new Function('FluxoDFC', 'Dfc13', 'DFC', 'Repo', 'UI', 'Auth', 'esc', 'DFC_RESUMO', 'g13', ganchosCod + '\nreturn FluxoDFC;');
  const chamadas = []; const F = { ui: {}, salvarRegras: (...a) => { chamadas.push(['antigo', a[1]]); }, salvarCategorias: (...a) => { chamadas.push(['antigoCat']); }, salvarAjustePadrao09() { chamadas.push(['antigoAj']); }, abrirRegra() { }, abrirCategoria() { }, excluirCategoria() { },
    acao: async a => { chamadas.push(['acaoAntiga', a]); }, mudanca: async a => { chamadas.push(['mudancaAntiga', a]); }, afterRender() { chamadas.push(['render']); }, renderRegras: () => '<x>', classificarManual: async () => { chamadas.push(['manualAntigo']); }, atualizarBaseDFC: async () => { chamadas.push(['baseAntiga']); }, gerarResumo06() { }, gerarResumo08() { } };
  let on = false; const nov = []; const Df = { salvarRegras: (...a) => { nov.push(a); return Promise.resolve(); }, salvarCategorias() { nov.push('cat'); }, salvarAjuste() { nov.push('aj'); }, atualizarBases() { nov.push('bases'); }, aoRenderizar() { nov.push('ren'); }, garantirMeses: async () => { nov.push('garantir'); }, reaplicarManual() { nov.push('manual'); } };
  const FF = ganchos(F, Df, {}, {}, {}, { can: () => true }, s => s, {}, () => on);
  await FF.salvarRegras([1], 'x'); await FF.salvarCategorias([]); await FF.acao('fd-dfc-reaplicar', {}); await FF.mudanca('fd-f', { dataset: { k: 'mes' }, value: '2026-08' }); FF.afterRender(); await FF.classificarManual('d', 'i', 'c'); await FF.atualizarBaseDFC(['2026-08']);
  chk('recurso DESLIGADO: regras, categorias, atalho, troca de mês, classificação manual e base seguem o caminho da v14.12 (nenhum código novo roda)', nov.length === 0 && chamadas.map(c => c[0]).join() === 'antigo,antigoCat,acaoAntiga,mudancaAntiga,render,manualAntigo,baseAntiga', chamadas);
  on = true; await FF.salvarRegras([1], 'x'); await FF.acao('fd-dfc-reaplicar', {}); await FF.mudanca('fd-f', { dataset: { k: 'mes' }, value: '2026-08' }); FF.afterRender();
  chk('recurso LIGADO: as mesmas entradas passam a usar o módulo novo', nov.includes('manual') && nov.includes('garantir') && nov.includes('ren') && nov.some(a => Array.isArray(a)), nov);
  /* a classificação manual nova marca manual: true (e o motor segue reconhecendo pela categoria) */
  const F2 = { ui: {}, salvarRegras() { }, salvarCategorias() { }, salvarAjustePadrao09() { }, abrirRegra() { }, abrirCategoria() { }, excluirCategoria() { }, acao() { }, mudanca() { }, afterRender() { }, renderRegras: () => '', classificarManual() { }, atualizarBaseDFC: async () => { }, gerarResumo06() { }, gerarResumo08() { } };
  const gravados = []; const R2 = { get: () => ({ id: 'd1', mes: '2026-08', transacoes: [tx('t1', '2026-08-01', -10, 'X'), tx('t2', '2026-08-02', -20, 'Y')] }), salvar: async (c, i, d) => { gravados.push(d); } };
  const FM = new Function('FluxoDFC', 'Dfc13', 'DFC', 'Repo', 'UI', 'Auth', 'esc', 'DFC_RESUMO', 'g13', ganchosCod + '\nreturn FluxoDFC;')(F2, { atualizarBases: async () => { } }, { cat: () => ({ nome: 'Folha' }) }, R2, {}, {}, s => s, {}, () => true);
  await FM.classificarManual('d1', 't2', 'pag_folha');
  chk('classificarManual (v14.13): grava cat + manual: true só na transação escolhida e não toca nas outras', gravados.length === 1 && gravados[0].transacoes[1].cat === 'pag_folha' && gravados[0].transacoes[1].manual === true && !gravados[0].transacoes[0].cat);
}

/* ---------- B · com banco (servidor real) ---------- */
if (!process.env.NETLIFY_DB_URL) {
  console.log('\n(bloco B pulado: defina NETLIFY_DB_URL e suba tests/servidor-local.mjs na porta 8890 para provar a trava no servidor real e a restauração dos backups)');
} else {
  const pg = (await import('pg')).default, { gerar } = await import('../netlify/lib/senha.mjs'), B = await import('../netlify/lib/backup-nuvem.mjs');
  const U = 'http://localhost:8890', pool = new pg.Pool({ connectionString: process.env.NETLIFY_DB_URL, max: 6 }), sql = (t, p) => pool.query(t, p).then(r => r.rows);
  const doc = (caminho, dados) => { const i = caminho.lastIndexOf('/'); return sql(`INSERT INTO documentos (caminho, colecao, doc_id, dados) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (caminho) DO UPDATE SET dados = EXCLUDED.dados, versao = documentos.versao + 1`, [caminho, caminho.slice(0, i), caminho.slice(i + 1), JSON.stringify(dados)]); };
  const ler = async caminho => (await sql('SELECT dados, versao FROM documentos WHERE caminho = $1', [caminho]))[0];
  const SENHA = 'Teste2026Ab', CPF = { m1: '39053344705' };
  await doc('usuarios/usr-m1', { perfil: 'MASTER', nome: 'Master Teste', cpf: CPF.m1, ativo: true, permissoes: {}, trocarSenha: false, senha: gerar(SENHA, 'sal-m1') });
  const login = async () => { const r = await fetch(U + '/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json', 'x-painel': '1' }, body: JSON.stringify({ cpf: CPF.m1, senha: SENHA }) }); const c = r.headers.get('set-cookie'); if (!c) throw new Error('login falhou ' + r.status); return c.split(';')[0]; };
  let M = await login();
  const http = async (metodo, url, corpo, ck = M) => { const r = await fetch(U + url, { method: metodo, headers: { cookie: ck, 'x-painel': '1', 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) }); let j = {}; try { j = await r.json(); } catch { } return { s: r.status, j }; };
  const lote = (ops, ck) => http('POST', '/api/docs/lote', { ops }, ck);
  const setRec = on => doc('config/recursos', on ? { gestao_v1413: { ativo: true } } : {});
  const R0 = [{ id: 'r-a', termos: ['ALFA'], sentido: 'S', categoria: 'pag_outros' }, { id: 'r-b', termos: ['BETA'], sentido: 'E', categoria: 'rec_outros' }];
  const cfgDfc = async () => (await ler('config/dfc'))?.dados;

  /* 1 · trava no servidor */
  await setRec(true);
  let r = await lote([{ op: 'set', caminho: 'config/dfc', dados: { mapaFCX: { '5.1': 'pag_outros' } } }]);
  chk('B1 · gravar categorias/De-para num documento ainda sem regras não inicializa as regras (servidor continua sem lista)', r.s === 200 && r.j.resultados[0].ok && !Array.isArray((await cfgDfc()).regras) && !(await cfgDfc()).regras_inicializadas);
  r = await lote([{ op: 'set', caminho: 'config/dfc', dados: { mapaFCX: { '5.1': 'pag_outros' }, regras: R0, regras_semente: true } }]);
  let d = await cfgDfc();
  chk('B1 · a semente de fábrica só entra porque o documento nunca foi inicializado: fica marcado, contador 1, e o marcador transitório não é gravado', r.j.resultados[0].ok && d.regras.length === 2 && d.regras_inicializadas === true && d.regras_rev === 1 && !('regras_semente' in d), d);
  r = await lote([{ op: 'set', caminho: 'config/dfc', dados: { regras: [{ id: 'r-fab', termos: ['FABRICA'], sentido: 'S', categoria: 'pag_outros' }], regras_semente: true } }]);
  chk('B1 · semente tardia (documento já inicializado) é recusada com 409 "regras_ja_inicializadas" e as regras do usuário ficam intactas', r.j.resultados[0].status === 409 && r.j.resultados[0].codigo === 'regras_ja_inicializadas' && igual((await cfgDfc()).regras, R0));
  const v0 = (await ler('config/dfc')).versao;
  for (let i = 0; i < 3; i++) { await http('GET', '/api/sessao?amb=prod'); await http('GET', '/api/mudancas?desde=-1'); await http('GET', '/api/docs?colecao=config'); await http('GET', '/api/docs?caminho=config/dfc'); }
  M = await login();
  chk('B1 · F5, login, consulta de mudanças e leituras repetidas NÃO recriam nem alteram config/dfc (mesma versão do documento, mesmas regras)', (await ler('config/dfc')).versao === v0 && igual((await cfgDfc()).regras, R0));
  r = await lote([{ op: 'set', caminho: 'config/dfc', dados: { regras: [], regras_rev: 1 } }]);
  chk('B1 · cópia vazia de uma aba velha (contador 1, o servidor já está na frente) tentando apagar as regras é recusada (409) e as regras ficam', r.j.resultados[0].status === 409 && igual((await cfgDfc()).regras, R0));
  r = await lote([{ op: 'set', caminho: 'config/dfc', dados: { regras: [{ id: 'r-fab', termos: ['FABRICA'], sentido: 'S', categoria: 'pag_outros' }] } }]);
  chk('B1 · cliente antigo (sem contador) que tenta trocar a lista por outra é recusado (409 "regras_desatualizadas") e nada muda', r.j.resultados[0].status === 409 && r.j.resultados[0].codigo === 'regras_desatualizadas' && igual((await cfgDfc()).regras, R0));
  r = await lote([{ op: 'set', caminho: 'config/dfc', dados: { categorias: [{ id: 'cus_1', nome: 'Teste', sentido: 'S', grupo: 'OPERACIONAL', impacto: 'soma' }] } }]);
  d = await cfgDfc();
  chk('B1 · gravação de categorias SEM a lista de regras passa e mantém as regras e o contador do servidor', r.j.resultados[0].ok && igual(d.regras, R0) && d.regras_rev === 1 && d.categorias.length === 1);
  r = await lote([{ op: 'set', caminho: 'config/dfc', dados: { regras: R0, regras_rev: 1, categorias: [] } }]);
  chk('B1 · mesma lista com outro campo (categorias) passa sem mexer no contador', r.j.resultados[0].ok && (await cfgDfc()).regras_rev === 1);
  r = await lote([{ op: 'set', caminho: 'config/dfc', dados: { regras: [R0[1], R0[0]], regras_rev: 2 } }]);
  chk('B1 · alterar a lista com o contador certo (servidor + 1) é aceito e o contador sobe', r.j.resultados[0].ok && (await cfgDfc()).regras_rev === 2 && (await cfgDfc()).regras[0].id === 'r-b');
  r = await lote([{ op: 'set', caminho: 'config/dfc', dados: { regras: [{ id: 'x', termos: [], sentido: 'S', categoria: 'pag_outros' }], regras_rev: 3 } }]);
  chk('B1 · regra inválida (sem termos) é recusada com 422 e nada muda', r.j.resultados[0].status === 422 && (await cfgDfc()).regras_rev === 2);
  r = await lote([{ op: 'set', caminho: 'config/dfc', dados: { regras: R0, regras_rev: 3 } }, { op: 'set', caminho: 'config/dfc', dados: { regras: R0, regras_rev: 3 } }]);
  chk('B1 · duas gravações da mesma alteração no mesmo lote: só a primeira vale (a outra encontra a lista igual e passa sem subir o contador)', r.j.resultados[0].ok && r.j.resultados[1].ok && (await cfgDfc()).regras_rev === 3);
  await setRec(false);
  r = await lote([{ op: 'set', caminho: 'config/dfc', dados: { regras: [{ id: 'legado', termos: ['LEGADO'], sentido: 'S', categoria: 'pag_outros' }] } }]);
  chk('B1 · recurso DESLIGADO (Produção antes de "Liberar Versão"): nenhuma trava — comportamento da v14.12 (a gravação passa como antes)', r.j.resultados[0].ok && (await cfgDfc()).regras[0].id === 'legado');
  await setRec(true); await doc('config/dfc', { regras: R0, regras_rev: 3, regras_inicializadas: true });

  /* 2 · o código REAL do painel (adaptador de rede + Dfc13) falando com o servidor real */
  const adaptCod = corta('class NetlifyAdapter {', '/* ------------------- v13.74.4 · Semente local');
  const cook = () => M;
  const fetchTeste = (u, o = {}) => fetch(U + u, { ...o, headers: { ...(o.headers || {}), cookie: cook() } });
  const NA = new Function('fetch', 'sleep', 'g10', 'g13', 'AMBIENTES', 'SyncEco', 'window', 'document', 'location', adaptCod + '\nreturn NetlifyAdapter;')(fetchTeste, () => Promise.resolve(), () => false, () => true, [], {}, {}, {}, { protocol: 'http:' });
  const ad = new NA();
  const b = banco(ad), D = b.Dfc13, R = b.Repo; extratos(b);
  const ini2 = (await ad.get('config/dfc')); R.cols.config.set('dfc', { id: 'dfc', ...clone(ini2) });
  D._baseRegras = clone(R.get('config', 'dfc').regras);
  const rr = await D.salvarRegras([{ id: 'r-joao', termos: ['LOJA DO JOAO'], sentido: 'S', categoria: 'pag_marketing' }, ...D._baseRegras], 'Regra criada');
  d = await cfgDfc();
  chk('B2 · (painel real × servidor real) criar regra: servidor confirmou, contador 4, regra no topo, "Regras salvas no servidor" na tela', rr.alterado && d.regras_rev === 4 && d.regras[0].id === 'r-joao' && b.msgs.some(m => /^Regras salvas no servidor/.test(m)), [d.regras_rev, b.msgs]);
  chk('B2 · os 3 meses de OFX foram reclassificados e gravados no banco (dfc/AAAA-MM) automaticamente, com a assinatura das regras', (await Promise.all(['2026-08', '2026-09', '2026-10'].map(m => ler('dfc/' + m)))).every(x => x && x.dados.regrasSig === D.sigAtual()));
  const d09 = (await ler('dfc/2026-09')).dados, d08 = (await ler('dfc/2026-08')).dados;
  chk('B2 · valores no banco: set → Marketing −700; ago → Marketing −900 e a manual (a3) segue em Folha −400', d09.porCategoria.pag_marketing.valor === -700 && d08.porCategoria.pag_marketing.valor === -900 && d08.porCategoria.pag_folha.valor === -400);
  /* aba velha: ficou com a versão 3 e o servidor já está na 4 */
  R.cols.config.set('dfc', { id: 'dfc', ...clone(d), regras_rev: 3, regras: d.regras.slice(1) }); D._baseRegras = clone(d.regras.slice(1));
  const rv = await D.salvarRegras([{ id: 'r-novo2', termos: ['XPTO'], sentido: 'S', categoria: 'pag_tarifas' }, ...D._baseRegras], 'Regra criada');
  d = await cfgDfc();
  chk('B2 · aba com versão velha: o servidor recusou (409), o painel releu e refez por id — a regra da outra versão (r-joao) e a nova convivem', rv.alterado && d.regras_rev === 5 && d.regras.some(x => x.id === 'r-joao') && d.regras.some(x => x.id === 'r-novo2'), d.regras.map(x => x.id).slice(0, 3));
  const ed = await D.salvarRegras(clone(D.regrasDe(await cfgDfc())).map(x => x.id === 'r-novo2' ? { ...x, termos: ['XPTO', 'ZZZ'] } : x), 'Regra editada');
  chk('B2 · editar regra no servidor real: termos novos persistem e o contador sobe', ed.alterado && (await cfgDfc()).regras.find(x => x.id === 'r-novo2').termos.length === 2 && (await cfgDfc()).regras_rev === 6);
  await D.moverRegra('r-novo2', 1); await D.excluirRegra('r-novo2');
  chk('B2 · mover e excluir persistem no servidor real, nessa ordem, e nenhuma regra extra some', (await cfgDfc()).regras_rev === 8 && !(await cfgDfc()).regras.some(x => x.id === 'r-novo2') && (await cfgDfc()).regras.some(x => x.id === 'r-joao') && (await cfgDfc()).regras.length === 3);
  /* polling: o snapshot da coleção config chega ANTES da gravação confirmada e depois dela */
  const snapVelho = (await ad.list('config')); const regrasHoje = (await cfgDfc()).regras.length;
  const antigo = snapVelho.map(x => x.id === 'dfc' ? { ...x, regras_rev: 1, regras: R0 } : x);
  const filtrado = D.filtrarSnapshot(antigo, R.get('config', 'dfc') && { ...R.get('config', 'dfc'), regras_rev: (await cfgDfc()).regras_rev, regras: (await cfgDfc()).regras });
  chk('B2 · polling com snapshot mais velho (contador 1) não troca as regras que a aba já tem (contador 8)', filtrado.find(x => x.id === 'dfc').regras.length === regrasHoje && filtrado.find(x => x.id === 'dfc').regras_rev === 8);
  /* o adaptador real: leitura que atravessa uma gravação confirmada é descartada */
  const w = { cbs: new Set([() => { }]), errs: new Set(), mapa: new Map(), carregando: null, sujo: false, escrita: 0 }; ad.cols.set('config', w);
  const listaOrig = ad.list.bind(ad); let chamadas = 0; ad.list = async (c, o) => { chamadas++; const r = await listaOrig(c, o); if (chamadas === 1) w.escrita++; return r; };
  ad._recarregar('config'); await sleep(900);
  chk('B2 · adaptador real: uma leitura que viajou enquanto uma gravação era confirmada é DESCARTADA e refeita (nunca regride o que o usuário acabou de salvar)', chamadas >= 2 && w.mapa instanceof Map && w.mapa.has('dfc'), chamadas);
  ad.cols.delete('config'); ad.list = listaOrig;
  /* o motivo da recusa chega à tela */
  let e409 = null; try { await ad.set('config/dfc', { regras: [] }); } catch (e) { e409 = e; }
  chk('B2 · adaptador real: a recusa do servidor chega com status 409 e o código "regras_desatualizadas"', e409 && e409.status === 409 && e409.codigo === 'regras_desatualizadas', e409 && [e409.status, e409.codigo]);

  /* 3 · auditoria dos backups: registros em todas as frentes recentes → ponto na nuvem E .json → apaga → restaura → 100% íntegro */
  await sql('DELETE FROM painel_backups_historico');
  const ambiente = { empresas: { empresas: [{ id: 'emp_principal', razao: 'EMPRESA FICTICIA SA', matriz: true }], contasPadrao: { cb1: 'emp_principal' } } };
  const semente = {
    'config/empresas': ambiente.empresas, 'config/folha': { teto: 1 }, 'config/retaguarda_param': { x: 1 }, 'config/permissoes': { GESTOR: { a: true } },
    'lojas/l1': { codigo: '01', nome: 'LOJA FICTICIA' }, 'lojas/l2': { codigo: '02', nome: 'OUTRA FICTICIA' }, 'lojas_faturamento/l1_2026-10': { v: 10 }, 'pe_simulador/l1': { v: 1 },
    'funcionarios/f1': { nome: 'COLABORADORA FICTICIA', cpf: '52998224725', ferias: [{ de: '2026-12-01', ate: '2026-12-15' }], folgas: ['2026-11-20'] }, 'funcionarios/f2': { nome: 'SEGUNDO FICTICIO' },
    'funcionarios/_viagens/pedidos/v1': { funcionarioId: 'f1', status: 'aguardando_ofx', devolucao12: { ofx: { encontrado: false } }, valor: 1500 }, 'funcionarios/_viagens/parametros/p': { diaria: 200 },
    'funcionarios/_liberacoes/pedidos/p1': { tipo: 'ferias', funcionarioId: 'f1' }, 'pdi/f1': { avaliacoes: [{ nota: 5 }] }, 'salarios/f1': { salario: 3000 }, 'rh_cargos/c1': { nome: 'Gerente' }, 'rh_centros/cc1': { nome: 'Centro 1' }, 'rh_departamentos/d1': { nome: 'Financeiro' },
    'contratos_locacao/ct1': { lojaId: 'l1', valor: 5000, indice: 'IPCA', reajustes: [{ data: '2026-06-01', pct: 4.1 }] }, 'partes_contratuais/pc1': { nome: 'LOCADOR FICTICIO', categoriaDfc: 'pag_ocupacao' }, 'seguros_vigencia/s1': { fim: '2027-01-01' }, 'aluguel_projecoes/a1': { v: 1 },
    'parceiros/p1': { nome: 'FORNECEDOR FICTICIO LTDA', cnpj: '11222333000181', chavesPix: [{ tipo: 'email', valor: 'forn@exemplo.com' }], categoriaDfc: 'pag_marketing' }, 'parceiros/p2': { nome: 'CLIENTE FICTICIO', categoriaDfcEntrada: 'rec_outros' },
    'contasBancarias/cb1': { apelido: 'CONTA 1', ofxAcctId: '1234' }, 'extratos/cb1_2026-08_0': { contaId: 'cb1', mes: '2026-08', parte: 0, transacoes: [tx('z1', '2026-08-03', 1000, 'GETNET', { cat: 'rec_cartoes', manual: true })] }, 'dfc/2026-08': { mes: '2026-08', entradas: 1000 },
    'fcx/cfg': { y: 1 }, 'caixas/cx1': { v: 1 }, 'faltas/ft1': { valor: 20 }, 'faltas/_anexos/partes/anx_0': { anexoId: 'anx', parte: 0, de: 1, dados: 'data:image/png;base64,AAAA' }, 'ret_ocorrencias/oc1': { v: 1 }, 'ret_ocorrencias/_anexos/partes/anx2_0': { anexoId: 'anx2', parte: 0, de: 1, dados: 'data:application/pdf;base64,BBBB' },
    'ret_cofre/cf1': { v: 1 }, 'ret_depositos/dp1': { v: 1 }, 'ret_consumidor/rc1': { v: 1 }, 'cred_pendencias/cp1': { v: 1 }, 'ieo_ocorrencias/io1': { v: 1 }, 'ieo_fechamentos/if1': { v: 1 }, 'ieo_laudos/il1': { v: 1 }, 'ieo_auto/ia1': { v: 1 }, 'ieo_log/ig1': { v: 1 }, 'alertas/al1': { v: 1 }, 'solicitacoes/so1': { v: 1 },
    'credsystem/cs1': { v: 1 }, 'credsystem_metas/m1': { meta: 100 }, 'credsystem_campanhas/cm1': { v: 1 }, 'credsystem_apuracoes/ap1': { v: 1 }, 'credsystem_base/b1': { v: 1 }, 'credsystem_resultados/r1': { v: 1 },
    'adq_taxas/t1': { v: 1 }, 'adq_auditorias/au1': { v: 1 }, 'adq_excecoes/ex1': { v: 1 }, 'ec_taxas/ec1': { v: 1 }, 'conc_fechamento/cf1': { v: 1 },
    'rh_folhas/fl1': { v: 1 }, 'rh_importacoes/im1': { v: 1 },
  };
  for (const [c, dd] of Object.entries(semente)) await doc(c, dd);
  /* a DFC: regras próprias, categorias, ajustes e De-para (via a trava, como o painel faria) */
  await doc('config/dfc', { regras: [{ id: 'r-joao', termos: ['LOJA DO JOAO'], sentido: 'S', categoria: 'pag_marketing' }, ...R0], regras_rev: 11, regras_inicializadas: true, categorias: [{ id: 'cus_1', nome: 'Categoria própria', sentido: 'S', grupo: 'OPERACIONAL', impacto: 'soma' }], ajustesPadrao: { pag_marketing: { nome: 'Publicidade', grupo: 'OPERACIONAL' } }, mapaFCX: { '5.1.01': 'pag_utilidades' } });
  await sql(`INSERT INTO contab_contas (codigo, nome, grupo, natureza, tipo, pai, nivel) VALUES ('5', 'DESPESAS', 5, 'D', 'S', NULL, 1), ('5.1', 'ADMINISTRATIVAS', 5, 'D', 'A', '5', 2) ON CONFLICT DO NOTHING`);
  await sql(`INSERT INTO contab_empresas (id, cnpj, razao_social, nome_fantasia, regime, capital_social_centavos, socios, contador, endereco, receita) VALUES ('emp_b', '11222333000181', 'EMPRESA B FICTICIA', 'B', 'real', 150000, '[{"nome":"SOCIO FICTICIO"}]', '{"nome":"CONTADOR FICTICIO"}', 'Rua Teste, 1', '{"a":1}') ON CONFLICT (id) DO NOTHING`);
  await sql(`INSERT INTO contab_depara (origem, chave, erp_codigo, erp_nome, agrupador, conta, status, confianca, motivo, fonte) VALUES ('fcx', '5.1.01', '5.1', 'ADMINISTRATIVAS', false, '5.1', 'revisado', 0.9, 'teste', 'fcx'), ('fcx', 'GRUPO X', null, null, true, '5', 'revisado', null, null, 'fcx')`);
  await sql(`INSERT INTO painel_notificacoes_regras (evento_chave, canal, ativo, destinatarios_json, parametros_json, frequencia) VALUES ('ferias_vencendo', 'AMBOS', true, '[{"nome":"Fulana","email":"f@exemplo.com"}]', '{"dias":30}', 'SEMANAL'), ('aprovacao_pendente', 'EMAIL', false, '[]', '{}', 'DIARIA')`);
  await doc('auditoria/usr-m1/dias/2026-11-10', { n: 1 }); await doc('presenca/usr-m1', { em: 'x' }); await doc('sistema/backup_diario', { data: '2026-11-10' });
  const foraAntes = { a: await ler('auditoria/usr-m1/dias/2026-11-10'), p: await ler('presenca/usr-m1'), s: await ler('sistema/backup_diario') };

  const retrato = async () => {                       // tudo o que está no escopo do backup, sem metadados (versão e datas mudam numa restauração)
    const docs = Object.fromEntries((await sql(`SELECT caminho, dados FROM documentos WHERE split_part(colecao, '/', 1) NOT IN ('auditoria', 'presenca', 'sistema', 'amb') ORDER BY caminho`)).map(x => [x.caminho, x.dados]));
    const notif = (await sql(`SELECT evento_chave, canal, ativo, destinatarios_json, parametros_json, frequencia FROM painel_notificacoes_regras ORDER BY evento_chave`));
    const emp = (await sql(`SELECT id, cnpj, razao_social, nome_fantasia, regime, capital_social_centavos, socios, contador, endereco, ativa, receita FROM contab_empresas ORDER BY id`));
    const dep = (await sql(`SELECT origem, chave, erp_codigo, erp_nome, agrupador, conta, status, confianca::float AS confianca, motivo, fonte, ativa FROM contab_depara ORDER BY origem, chave`));
    return { docs, notif, emp, dep };
  };
  const semVolateis = x => { const c = clone(x); const d = c.docs['config/dfc']; if (d) { delete d.regras_rev; } return c; };
  const antes = await retrato(), revAntes = antes.docs['config/dfc'].regras_rev;
  const fakeM = { uid: 'usr-m1', nivel: 5, perms: new Set(), usuario: { cpf: CPF.m1, nome: 'Master Teste' }, recursoAtivo: k => k === 'gestao_v1413' };
  const nuvem = await B.criarManual(fakeM, 'teste v14.13');
  const pl = (await sql('SELECT payload_json, total_registros FROM painel_backups_historico WHERE id = $1', [nuvem.ponto.id]))[0].payload_json;
  chk('B3 · ponto na nuvem (formato 2): documentos de todas as frentes + as 3 tabelas de configuração, contagens por tabela e destaques da DFC', pl.formato === 2 && Object.keys(pl.tabelas).sort().join() === 'contab_depara,contab_empresas,painel_notificacoes_regras' && pl.tabelas_n.painel_notificacoes_regras === 2 && pl.tabelas_n.contab_empresas === 2 && pl.tabelas_n.contab_depara === 2
    && pl.destaques.dfc.regras === 3 && pl.destaques.dfc.categorias === 1 && pl.destaques.dfc.ajustesPadrao === 1 && pl.destaques.dfc.mapaFCX === 1 && pl.destaques.dfc.inicializada === true && pl.destaques.configDocs.includes('empresas') && pl.destaques.configDocs.includes('dfc'), pl.destaques);
  chk('B3 · o resumo devolvido na criação lista TODAS as frentes e nenhuma coleção ficou "sem frente"', nuvem.resumo.frentes.length === escopo.FRENTES.length && nuvem.resumo.semFrente.length === 0 && nuvem.resumo.total === Object.values(pl.colecoes).reduce((a, n) => a + n, 0) + 6 && nuvem.resumo.frentes.every(f => f.id === 'viagens' ? f.registros >= 2 : true), nuvem.resumo.semFrente);
  chk('B3 · cada frente de dados recentes tem registros no ponto (DFC, config, parceiros, contratos, RH, viagens, notificações, contábil, retaguarda, adquirentes, Credsystem, lojas, FCX, usuários)', ['dfc', 'config', 'parceiros', 'contratos', 'rh', 'viagens', 'notificacoes', 'contabil', 'retaguarda', 'adquirentes', 'credsystem', 'lojas', 'fcx', 'usuarios'].every(id => nuvem.resumo.frentes.find(f => f.id === id).registros > 0), nuvem.resumo.frentes.map(f => [f.id, f.registros]));
  const cont = (await http('POST', '/api/backup-nuvem', { acao: 'conteudo', id: nuvem.ponto.id })).j;
  chk('B3 · "Ver conteúdo" (acao conteudo) devolve o mesmo resumo do ponto', cont.ok && cont.resumo.total === nuvem.resumo.total && cont.resumo.formato === 2);
  /* o .json: o código REAL do painel (coletar) lendo pelo adaptador real + as tabelas pela rota real */
  const tabResp = (await http('POST', '/api/backup-nuvem', { acao: 'tabelas' })).j;
  const adJson = new NA(); const col = await Bkp13.coletar(c => adJson.list(c), { pode: () => true, incluirAnexos: true });
  const contagem = Object.fromEntries(Object.entries(col.colecoes).map(([k, v]) => [k, v.length])), tabN = Object.fromEntries(Object.entries(tabResp.tabelas).map(([k, v]) => [k, v.length]));
  const resJson = Bkp13.resumir({ colecoes: contagem, tabelas: tabN, destaques: Bkp13.destaquesDe(col.colecoes) });
  chk('B3 · .json: nenhuma coleção falhou nem foi omitida e o total de registros e as tabelas batem com o ponto na nuvem (paridade)', col.falhas.length === 0 && col.ocultas.length === 0 && resJson.total === nuvem.resumo.total && resJson.tabelas === 3 && igual(resJson.destaques.dfc, pl.destaques.dfc), [col.falhas, col.ocultas, resJson.total, nuvem.resumo.total]);
  chk('B3 · .json: por frente, os mesmos totais do ponto na nuvem (14 módulos)', resJson.frentes.every(f => f.registros === nuvem.resumo.frentes.find(x => x.id === f.id).registros), resJson.frentes.map(f => [f.id, f.registros, nuvem.resumo.frentes.find(x => x.id === f.id).registros]));
  const arquivoJson = JSON.stringify({ app: 'painel-gestao-esposende', versao: 2, colecoes: col.colecoes, tabelas: tabResp.tabelas });

  const apagarTudo = async () => {                    // "limpa a base": tudo do escopo, menos os usuários (o Master precisa existir) e o que o backup nunca toca
    await sql(`DELETE FROM documentos WHERE split_part(colecao, '/', 1) NOT IN ('auditoria', 'presenca', 'sistema', 'amb', 'usuarios')`);
    await sql('DELETE FROM painel_notificacoes_regras'); await sql('DELETE FROM contab_depara'); await sql(`DELETE FROM contab_empresas WHERE id <> 'emp_principal'`);
  };
  /* restaurar o PONTO da nuvem */
  await apagarTudo(); await setRec(true);            // o ambiente continua "ligado" (config/recursos é do ambiente, não dos dados): a restauração roda com a sessão do Master
  const vazia = await retrato();
  chk('B3 · a base foi apagada de verdade antes de restaurar (documentos e tabelas)', Object.keys(vazia.docs).filter(c => !c.startsWith('usuarios/') && c !== 'config/recursos').length === 0 && vazia.notif.length === 0 && vazia.dep.length === 0 && vazia.emp.length === 1);
  const rest = await http('POST', '/api/backup-nuvem', { acao: 'restaurar', id: nuvem.ponto.id, confirmacao: 'RESTAURAR' });
  const depois = await retrato();
  chk('B3 · RESTAURAÇÃO DO PONTO NA NUVEM: 100% dos documentos voltam íntegros (conteúdo idêntico, coleção a coleção)', rest.s === 200 && Object.keys(antes.docs).length > 60 && igual(semVolateis(depois).docs, semVolateis(antes).docs), [rest.s, rest.j.erro, Object.keys(antes.docs).filter(c => !igual(antes.docs[c], depois.docs[c])).slice(0, 5)]);
  chk('B3 · RESTAURAÇÃO DO PONTO: as tabelas de configuração (Central de Notificações, empresas e de-para) voltam íntegras', igual(depois.notif, antes.notif) && igual(depois.emp, antes.emp) && igual(depois.dep, antes.dep) && rest.j.resumo.tabelas.length === 3 && !(rest.j.resumo.avisos || []).length, [rest.j.resumo.tabelas, rest.j.resumo.avisos]);
  const prevPl = (await sql(`SELECT payload_json->>'formato' AS f, payload_json->'tabelas_n' AS n, preventivo FROM painel_backups_historico WHERE id = $1`, [rest.j.preventivo.id]))[0];
  chk('B3 · o ponto PREVENTIVO criado antes da restauração já nasce no formato 2 (com as 3 tabelas de configuração)', prevPl && prevPl.f === '2' && prevPl.preventivo === true && Object.keys(prevPl.n || {}).length === 3, prevPl);
  const dfcDepois = await cfgDfc();
  chk('B3 · as regras da DFC restauradas seguem pétreas: contador andou PARA A FRENTE (outros computadores aceitam) e continua inicializado', dfcDepois.regras_rev > revAntes && dfcDepois.regras_inicializadas === true && igual(dfcDepois.regras, antes.docs['config/dfc'].regras), [revAntes, dfcDepois.regras_rev]);
  const foraDepois = { a: await ler('auditoria/usr-m1/dias/2026-11-10'), p: await ler('presenca/usr-m1'), s: await ler('sistema/backup_diario') };
  chk('B3 · auditoria, presença e sistema não foram tocados pela restauração', igual(foraAntes.a.dados, foraDepois.a.dados) && igual(foraAntes.p.dados, foraDepois.p.dados) && igual(foraAntes.s.dados, foraDepois.s.dados) && foraAntes.a.versao === foraDepois.a.versao);
  /* restaurar o .json (código real do painel: Bkp13.gravar com o adaptador real; tabelas pela rota real) */
  await apagarTudo(); await setRec(true);
  const aj = JSON.parse(arquivoJson); let gravadosJson = 0;
  const adR = new NA(), bR = banco(adR), BK = novoBkp13(bR.Dfc13, { adapter: adR, base: { netlify: true } });   // o código real do painel (Bkp13.gravar → prepararDfc → adaptador de rede)
  for (const [c, lista] of Object.entries(aj.colecoes)) for (const dd of lista) { const { id, ...resto } = dd; if (!id) continue; await BK.gravar(c, id, resto); gravadosJson++; }
  const rt = await http('POST', '/api/backup-nuvem', { acao: 'restaurar-tabelas', tabelas: aj.tabelas });
  const depois2 = await retrato();
  chk('B3 · RESTAURAÇÃO DO .JSON: 100% dos documentos voltam íntegros (inclui parceiros, anexos dos termos, empresas/Matriz, viagens, férias, contratos)', gravadosJson > 60 && igual(semVolateis(depois2).docs, semVolateis(antes).docs), [gravadosJson, Object.keys(antes.docs).filter(c => !igual(antes.docs[c], depois2.docs[c])).slice(0, 5)]);
  chk('B3 · RESTAURAÇÃO DO .JSON: as tabelas voltam íntegras e a rota cria antes um ponto preventivo', rt.s === 200 && igual(depois2.notif, antes.notif) && igual(depois2.emp, antes.emp) && igual(depois2.dep, antes.dep) && rt.j.preventivo.id > 0 && !(rt.j.avisos || []).length, [rt.s, rt.j]);
  const dfc2 = await cfgDfc();
  chk('B3 · config/dfc restaurada do .json: a trava aceitou (contador do servidor + 1) e as regras próprias voltaram', dfc2.regras_rev > 0 && igual(dfc2.regras, antes.docs['config/dfc'].regras) && igual(dfc2.mapaFCX, antes.docs['config/dfc'].mapaFCX) && igual(dfc2.categorias, antes.docs['config/dfc'].categorias));
  /* paridade: o arquivo e o ponto guardam exatamente os mesmos documentos */
  const caminhosJson = new Set(Object.entries(aj.colecoes).flatMap(([c, l]) => l.map(x => c + '/' + x.id))), caminhosNuvem = new Set(pl.documentos.map(x => x.caminho));
  chk('B3 · PARIDADE: o .json e o ponto na nuvem guardam exatamente o mesmo conjunto de documentos', caminhosJson.size === caminhosNuvem.size && [...caminhosNuvem].every(c => caminhosJson.has(c)), [[...caminhosNuvem].filter(c => !caminhosJson.has(c)).slice(0, 5), [...caminhosJson].filter(c => !caminhosNuvem.has(c)).slice(0, 5)]);

  /* tabelas: robustez da restauração */
  await sql('DELETE FROM contab_depara'); await sql(`DELETE FROM contab_contas WHERE codigo = '5.1'`);
  const rt2 = await http('POST', '/api/backup-nuvem', { acao: 'restaurar-tabelas', tabelas: aj.tabelas });
  const dep2 = await sql(`SELECT chave, conta, status FROM contab_depara ORDER BY chave`);
  chk('B3 · de-para cuja conta do plano não existe mais volta como "pendente" e sem conta (nunca viola a chave estrangeira nem derruba as outras tabelas)', rt2.s === 200 && dep2.find(x => x.chave === '5.1.01').conta === null && dep2.find(x => x.chave === '5.1.01').status === 'pendente' && dep2.find(x => x.chave === 'GRUPO X').conta === '5' && !(rt2.j.avisos || []).length, [rt2.s, dep2]);
  await sql(`DROP TABLE IF EXISTS _teste_x`);
  const rt3 = await http('POST', '/api/backup-nuvem', { acao: 'restaurar-tabelas', tabelas: { painel_notificacoes_regras: 'não é lista', contab_empresas: aj.tabelas.contab_empresas } });
  chk('B3 · tabela inválida no arquivo gera AVISO explícito e as demais tabelas seguem restauradas', rt3.s === 200 && rt3.j.avisos.some(a => /inválido/.test(a)) && rt3.j.tabelas.some(t => t.tabela === 'contab_empresas'), rt3.j);

  /* permissões, recurso desligado, limites */
  const sem = await http('POST', '/api/backup-nuvem', { acao: 'restaurar-tabelas', tabelas: {} }, '');
  chk('B3 · sem sessão: restaurar-tabelas, tabelas e conteudo → 401', sem.s === 401 && (await http('POST', '/api/backup-nuvem', { acao: 'tabelas' }, '')).s === 401 && (await http('POST', '/api/backup-nuvem', { acao: 'conteudo', id: 1 }, '')).s === 401);
  await setRec(false);
  const off = await http('POST', '/api/backup-nuvem', { acao: 'tabelas' });
  await sql('DELETE FROM painel_backups_historico');   // zera o limitador de 1 ponto manual a cada 30 s
  const offC = await B.criarManual({ ...fakeM, recursoAtivo: () => false }, 'sem recurso'); const plOff = (await sql('SELECT payload_json FROM painel_backups_historico WHERE id = $1', [offC.ponto.id]))[0].payload_json;
  chk('B3 · recurso DESLIGADO: as ações novas respondem 404 "recurso_indisponivel" e o ponto continua no formato 1 (v14.12), sem tabelas e sem resumo', off.s === 404 && off.j.codigo === 'recurso_indisponivel' && plOff.formato === 1 && !plOff.tabelas && !offC.resumo, [off.s, plOff.formato]);
  await setRec(true);
  await sql('DELETE FROM painel_backups_historico');
  const pa = await B.verificarPrimeiroAcesso(fakeM), plPa = (await sql(`SELECT payload_json->>'formato' AS f, tipo_backup, jsonb_object_keys(payload_json->'tabelas') AS t FROM painel_backups_historico WHERE id = $1`, [pa.ponto.id]));
  chk('B3 · PARIDADE dos tipos de ponto: o PRIMEIRO_ACESSO do dia sai no formato 2, com as 3 tabelas de configuração, como o manual', pa.criado === true && plPa.length === 3 && plPa[0].f === '2' && plPa[0].tipo_backup === 'PRIMEIRO_ACESSO', plPa);
  await sql(`DELETE FROM painel_backups_historico`);
  const ag = await B.agendado(), plAg = (await sql(`SELECT payload_json->>'formato' AS f, tipo_backup, jsonb_object_keys(payload_json->'tabelas') AS t FROM painel_backups_historico WHERE id = $1`, [ag.ponto.id]));
  chk('B3 · PARIDADE dos tipos de ponto: o AUTOMATICO das 23:59 (rotina agendada, sem sessão: lê o recurso em config/recursos) também sai no formato 2 com as 3 tabelas', ag.criado === true && plAg.length === 3 && plAg[0].f === '2' && plAg[0].tipo_backup === 'AUTOMATICO', plAg);
  await setRec(false); await sql(`DELETE FROM painel_backups_historico`);
  const agOff = await B.agendado(), plAgOff = (await sql(`SELECT payload_json->>'formato' AS f, payload_json ? 'tabelas' AS tem FROM painel_backups_historico WHERE id = $1`, [agOff.ponto.id]))[0];
  chk('B3 · com o recurso desligado a rotina agendada segue no formato 1 (sem tabelas): comportamento da v14.12', agOff.criado === true && plAgOff.f === '1' && plAgOff.tem === false, plAgOff);
  await setRec(true);
  const grande = await fetch(U + '/api/backup-nuvem', { method: 'POST', headers: { cookie: M, 'x-painel': '1', 'content-type': 'application/json' }, body: JSON.stringify({ acao: 'criar', nota: 'x'.repeat(30000) }) });
  chk('B3 · corpo grande (>20 KB) continua recusado nas ações comuns (413); só restaurar-tabelas aceita até 2 MB', grande.status === 413);
  const medio = await http('POST', '/api/backup-nuvem', { acao: 'restaurar-tabelas', tabelas: { contab_empresas: aj.tabelas.contab_empresas, extra: 'x'.repeat(100000) } });
  chk('B3 · restaurar-tabelas aceita corpo de 100 KB (limite 2 MB) e ignora nomes de tabela fora do catálogo', medio.s === 200);
  await sql('DELETE FROM painel_backups_historico'); await pool.end();
}

console.log(`\n${OK.length} ok · ${FAIL.length} falha(s)`);
if (FAIL.length) { console.log('FALHARAM:\n - ' + FAIL.join('\n - ')); process.exit(1); }
