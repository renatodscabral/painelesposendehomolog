/* /api/contabil — Módulo Contábil (v13.86): plano de contas ÚNICO, lançamentos em partidas dobradas, estornos,
   parâmetros tributários, LALUR e relatórios. Regras também no banco (migração 20261106120000_esquema_contabil.sql).

   GET    /api/contabil                               → situação do módulo (plano criado?, parâmetros, o que o usuário pode)
   GET    /api/contabil/contas                        → plano de contas (árvore: sintéticas e analíticas)
   POST   /api/contabil/contas                        { nome, codigo?, pai?, tipo?, natureza?, redutora?, dre?, dva?, tributos?, modeloTributario? }
                                                        → cria; o que faltar é preenchido pela classificação automática (IA)
   PUT    /api/contabil/contas?codigo=…               { nome?, tipo?, dre?, dva?, tributos?, modeloTributario?, ativa? } → edita
   DELETE /api/contabil/contas?codigo=…               → só conta sem lançamentos e sem filhas (senão: inative)
   POST   /api/contabil/classificar                   { nome, pai? } → sugestão da IA (grupo, natureza, tipo, mãe, código, DRE/DVA, tributos)
   POST   /api/contabil/plano-padrao                  → cria o plano padrão (comércio varejista) num banco sem plano
   GET    /api/contabil/lancamentos?de=&ate=&conta=&limite=
   POST   /api/contabil/lancamentos                   { data, historico, itens: [{ conta, dc: 'D'|'C', valor, centro?, historico? }], origem?, docRef? }
   POST   /api/contabil/lancamentos/estorno           { id, data?, motivo } → estorno total ligado ao lançamento original
   DELETE /api/contabil/lancamentos…                  → 405: lançamentos são intangíveis (use o estorno)
   GET|PUT /api/contabil/parametros                   { regime: 'real'|'presumido', presumido{…}, lc224, reforma{ ano, cbs, ibs, is }, dreModelo, contaResultado, fechadoAte }
   GET|POST|DELETE /api/contabil/lalur                adições, exclusões e compensações (Parte A/B) por ano
   POST   /api/contabil/encerramento                  { ano } → zera as contas de resultado contra Lucros ou Prejuízos Acumulados
   GET    /api/contabil/relatorios/<tipo>?de=&ate=&modelo=atual|reforma&ano=&conta=
          tipo: diario | razao | balancete | dre | balanco | dmpl | dra | dva | lalur
   GET    /api/contabil/integridade                   → confere a cadeia de hashes e o equilíbrio de todos os lançamentos
   v13.86 · Parte 2 — o plano de contas do FCX passa a ser lido daqui (de-para FCX → plano único):
   POST   /api/contabil/importar-fcx                  { contas: [rótulos do FCX], usadas?: [rótulos com saídas/orçamento], remapear? }
                                                        → cria o plano padrão se o banco não tem plano, mapeia cada rótulo (regra do ERP + IA),
                                                          cria as poucas contas que faltam e acrescenta as contas da Reforma (IBS/CBS/IS) para o FCX
   GET    /api/contabil/depara                        → o de-para inteiro, com o resumo (automáticos, revisados, pendentes)
   POST   /api/contabil/depara                        { rotulo, conta? } → nova conta para o FCX, criada no Módulo Contábil
   PUT    /api/contabil/depara                        { itens: [{ chave, conta?, status?, ativa? }] } → revisão (conta escolhida = "revisado")
   GET    /api/contabil/fcx-contas                    → lista somente leitura para o FCX (quem lê o FCX lê esta lista)
   POST   /api/contabil/fcx-contas                    { contas: [rótulos] } → rótulos que o FCX usa e o plano ainda não conhece (ficam para revisão)
   v13.88 · Adiantamentos de viagem (Módulo 8) — acerto de contas final em partidas dobradas:
   POST   /api/contabil/adiantamentos/encerrar        { viagemId } → só o Master: trava a prestação, grava o acerto e os títulos
                                                        (devolução a receber / reembolso a pagar) e contabiliza o adiantamento e a liquidação
   POST   /api/contabil/adiantamentos/contabilizar    { viagemId } → contabiliza um acerto encerrado sem plano de contas (pendente)
   POST   /api/contabil/adiantamentos/baixar          { viagemId, funcionarioId?, data, forma? } → baixa do título (devolução recebida /
                                                        reembolso pago): Master ou "Viagens · Modificar" (financeiro) */
import { createHash, randomUUID } from 'node:crypto';
import { q, tx } from '../lib/db.mjs';
import { json, erro, rota, ErroHttp } from '../lib/http.mjs';
import { sessaoDe } from '../lib/sessao.mjs';
import { NIVEL } from '../lib/regras.mjs';
import * as M from '../lib/contabil-motor.mjs';
import { permissoesEfetivas, normalizarPermissoes, tem } from '../lib/permissoes.mjs';
import { gravar as gravarDoc } from '../lib/documentos.mjs';

/* ---------------------------------------------------------------- acesso */
/* Master: tudo. Operacional: linha "Contabilidade" da Gestão de Acessos (Ler = ver; Modificar = lançar e plano;
   Excluir = estornar, encerrar e parâmetros), com as sub-permissões de ações (permissoes.sub.contabil.acoes). Loja: nada. */
const ACOES = { ler: ['contabil.ver'], modificar: ['contabil.lancar', 'contabil.plano'], excluir: ['contabil.estornar', 'contabil.parametros'] };
export function permissoesContabil(sess) {
  if (!sess || sess.trocaPendente) return new Set();
  if (sess.nivel >= NIVEL.admin) return new Set(Object.values(ACOES).flat());
  if (sess.perfil !== 'OPERACIONAL') return new Set();
  /* v13.88: mesma matriz do painel (níveis normalizados, sub-permissões de ações) — permissões efetivas da sessão */
  const perms = sess.perms || permissoesEfetivas(sess.usuario); return new Set(Object.values(ACOES).flat().filter(a => tem(perms, a)));
}
const exigir = (perms, a) => { if (!perms.has(a)) throw new ErroHttp(403, 'Seu acesso não permite esta operação no Módulo Contábil (Gestão de Acessos › Contabilidade).'); };

/* ---------------------------------------------------------------- leitura */
const contaDb = r => ({ codigo: r.codigo, nome: r.nome, grupo: r.grupo, natureza: r.natureza, tipo: r.tipo, pai: r.pai, nivel: r.nivel, redutora: r.redutora, dre: r.dre, dva: r.dva, tributos: r.tributos || [], modeloTributario: r.modelo_tributario, ativa: r.ativa, ia: r.ia || null });
const lerContas = async (t = q) => (await t('SELECT * FROM contab_contas')).map(contaDb).sort((a, b) => M.cmpCodigo(a.codigo, b.codigo));
async function lerParametros(t = q) {
  const p = Object.fromEntries((await t('SELECT chave, valor FROM contab_parametros')).map(r => [r.chave, r.valor]));
  const g = p.geral || {};
  return { regime: g.regime || 'presumido', presumido: g.presumido || { irpjComercio: 0.08, csllComercio: 0.12, irpjServicos: 0.32, csllServicos: 0.32 }, lc224: g.lc224 !== false,
    reforma: { ano: 2033, cbs: 0.088, ibs: 0.177, is: 0, ...(g.reforma || {}) }, dreModelo: g.dreModelo || 'atual', contaResultado: g.contaResultado || '3.5.1', fechadoAte: p.fechamento?.fechadoAte || null };
}
const iso = d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
function periodo(url) {
  const ano = Number(url.searchParams.get('ano')) || new Date().getFullYear();
  const de = url.searchParams.get('de') || `${ano}-01-01`, ate = url.searchParams.get('ate') || `${ano}-12-31`;
  if (![de, ate].every(x => /^\d{4}-\d{2}-\d{2}$/.test(x)) || de > ate) throw new ErroHttp(400, 'Período inválido (de/ate em AAAA-MM-DD, de ≤ ate).');
  const meses = (Number(ate.slice(0, 4)) - Number(de.slice(0, 4))) * 12 + Number(ate.slice(5, 7)) - Number(de.slice(5, 7)) + 1;
  return { de, ate, ano: Number(ate.slice(0, 4)), meses };
}
/** Saldos por conta analítica: anterior ao período (D − C) e débitos/créditos do período. semEncerramento: fora os lançamentos de encerramento. */
async function saldos(de, ate, { semEncerramento = false } = {}) {
  const r = await q(`SELECT p.conta,
      coalesce(sum(CASE WHEN l.data < $1 THEN CASE p.dc WHEN 'D' THEN p.valor_centavos ELSE -p.valor_centavos END END), 0)::bigint AS ant,
      coalesce(sum(CASE WHEN l.data >= $1 AND p.dc = 'D' THEN p.valor_centavos END), 0)::bigint AS d,
      coalesce(sum(CASE WHEN l.data >= $1 AND p.dc = 'C' THEN p.valor_centavos END), 0)::bigint AS c
    FROM contab_partidas p JOIN contab_lancamentos l ON l.id = p.lancamento_id
    WHERE l.data <= $2 ${semEncerramento ? "AND l.origem <> 'encerramento'" : ''} GROUP BY p.conta`, [de, ate]);
  return new Map(r.map(x => [x.conta, { ant: Number(x.ant), d: Number(x.d), c: Number(x.c) }]));
}

/* ---------------------------------------------------------------- lançamentos */
const hashDe = (anterior, l) => createHash('sha256').update(JSON.stringify([anterior || '', l.id, l.data, l.historico, l.origem, l.docRef || '', l.estornoDe || '', l.total, l.itens.map(i => [i.seq, i.conta, i.dc, i.valor, i.centro || '', i.historico || ''])])).digest('hex');
async function gravarLancamento(t, sess, l) {
  await t('SELECT pg_advisory_xact_lock(86001)'); // numeração e cadeia de hashes em série
  const [ult] = await t('SELECT hash FROM contab_lancamentos ORDER BY numero DESC LIMIT 1'), anterior = ult?.hash || null, id = 'lc_' + randomUUID();
  const reg = { ...l, id }, hash = hashDe(anterior, reg);
  const [ins] = await t(`INSERT INTO contab_lancamentos (id, data, historico, origem, doc_ref, estorno_de, total_centavos, hash_anterior, hash, criado_por)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING numero`, [id, l.data, l.historico, l.origem, l.docRef || null, l.estornoDe || null, l.total, anterior, hash, sess.uid]);
  for (const i of l.itens) await t('INSERT INTO contab_partidas (lancamento_id, seq, conta, dc, valor_centavos, centro, historico) VALUES ($1, $2, $3, $4, $5, $6, $7)', [id, i.seq, i.conta, i.dc, i.valor, i.centro, i.historico]);
  return { id, numero: Number(ins.numero), hash };
}
async function lerLancamentos({ de, ate, conta, limite = 2000, ids } = {}) {
  const cond = [], p = []; if (de) { p.push(de); cond.push(`l.data >= $${p.length}`); } if (ate) { p.push(ate); cond.push(`l.data <= $${p.length}`); }
  if (ids) { p.push(ids); cond.push(`l.id = ANY($${p.length})`); }
  if (conta) { p.push(conta); cond.push(`EXISTS (SELECT 1 FROM contab_partidas x WHERE x.lancamento_id = l.id AND (x.conta = $${p.length} OR x.conta LIKE $${p.length} || '.%'))`); }
  p.push(Math.min(Math.max(Number(limite) || 2000, 1), 20000));
  const ls = await q(`SELECT l.*, l.data::text AS data_txt, e.id AS estornado_por FROM contab_lancamentos l LEFT JOIN contab_lancamentos e ON e.estorno_de = l.id ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY l.data, l.numero LIMIT $${p.length}`, p);
  if (!ls.length) return [];
  const ps = await q(`SELECT p.*, c.nome FROM contab_partidas p JOIN contab_contas c ON c.codigo = p.conta WHERE p.lancamento_id = ANY($1) ORDER BY p.lancamento_id, p.seq`, [ls.map(l => l.id)]), por = new Map();
  ps.forEach(x => (por.get(x.lancamento_id) || por.set(x.lancamento_id, []).get(x.lancamento_id)).push({ seq: x.seq, conta: x.conta, contaNome: x.nome, dc: x.dc, valor: M.reais(x.valor_centavos), centro: x.centro, historico: x.historico }));
  return ls.map(l => ({ id: l.id, numero: Number(l.numero), data: l.data_txt, historico: l.historico, origem: l.origem, docRef: l.doc_ref, estornoDe: l.estorno_de, estornadoPor: l.estornado_por, total: M.reais(l.total_centavos), hash: l.hash, criadoEm: l.criado_em, criadoPor: l.criado_por, itens: por.get(l.id) || [] }));
}

/* ---------------------------------------------------------------- relatórios */
async function relatorio(tipo, url, params) {
  const { de, ate, ano, meses } = periodo(url), contas = await lerContas(), modelo = url.searchParams.get('modelo') === 'reforma' ? 'reforma' : url.searchParams.get('modelo') === 'atual' ? 'atual' : params.dreModelo;
  const reforma = { ...params.reforma, ...(url.searchParams.get('anoReforma') ? { ano: Number(url.searchParams.get('anoReforma')) } : {}) };
  const cab = { tipo, de, ate, geradoEm: new Date().toISOString() };
  const resultado = async () => { const mov = await saldos(de, ate, { semEncerramento: true }); return { mov, d: M.dre(contas, mov, { modelo, reforma }) }; };
  if (tipo === 'diario') { const ls = await lerLancamentos({ de, ate, limite: url.searchParams.get('limite') || 20000 }); return { ...cab, lancamentos: ls, totais: { lancamentos: ls.length, valor: Math.round(ls.reduce((a, l) => a + l.total * 100, 0)) / 100 } }; }
  if (tipo === 'razao') {
    const conta = url.searchParams.get('conta'); if (!conta) throw new ErroHttp(400, 'Informe a conta (?conta=1.1.1.01.001).'); const c = contas.find(x => x.codigo === conta); if (!c) throw new ErroHttp(404, 'Conta não encontrada.');
    const pref = r => r.conta === conta || r.conta.startsWith(conta + '.');
    const [a] = await q(`SELECT coalesce(sum(CASE p.dc WHEN 'D' THEN p.valor_centavos ELSE -p.valor_centavos END), 0)::bigint AS s FROM contab_partidas p JOIN contab_lancamentos l ON l.id = p.lancamento_id WHERE l.data < $1 AND (p.conta = $2 OR p.conta LIKE $2 || '.%')`, [de, conta]);
    let saldo = Number(a.s); const linhas = [];
    for (const l of await lerLancamentos({ de, ate, conta })) for (const i of l.itens.filter(pref)) { const v = Math.round(i.valor * 100); saldo += i.dc === 'D' ? v : -v; linhas.push({ data: l.data, numero: l.numero, lancamentoId: l.id, historico: i.historico || l.historico, conta: i.conta, contrapartidas: l.itens.filter(x => x.dc !== i.dc).map(x => x.conta), debito: i.dc === 'D' ? i.valor : 0, credito: i.dc === 'C' ? i.valor : 0, saldo: M.reais(saldo), dc: saldo >= 0 ? 'D' : 'C' }); }
    return { ...cab, conta: { codigo: c.codigo, nome: c.nome, natureza: c.natureza }, saldoAnterior: M.reais(Number(a.s)), linhas, saldoFinal: M.reais(saldo) };
  }
  if (tipo === 'balancete') { const b = M.balancete(contas, await saldos(de, ate)); return { ...cab, ...b, linhas: b.linhas.map(l => ({ ...l, saldoAnterior: M.reais(l.saldoAnterior), debitos: M.reais(l.debitos), creditos: M.reais(l.creditos), saldoFinal: M.reais(Math.abs(l.saldoFinal)), dc: l.saldoFinal > 0 ? 'D' : l.saldoFinal < 0 ? 'C' : '' })), totais: Object.fromEntries(Object.entries(b.totais).map(([k, v]) => [k, M.reais(v)])) }; }
  if (tipo === 'dre') { const { d } = await resultado(); return { ...cab, modelo, ...emReais(d) }; }
  if (tipo === 'balanco') return { ...cab, ...emReais(M.balanco(contas, await saldos(ate, ate))) };
  if (tipo === 'dmpl' || tipo === 'dra') {
    const { d } = await resultado(), atual = d.modelo === 'atual' ? d : M.dre(contas, await saldos(de, ate, { semEncerramento: true }), { modelo: 'atual' });
    const encerrado = (await q(`SELECT 1 FROM contab_lancamentos WHERE origem = 'encerramento' AND data BETWEEN $1 AND $2 LIMIT 1`, [de, ate])).length > 0;
    const mov = await q(`SELECT p.conta, l.origem, coalesce(sum(CASE p.dc WHEN 'D' THEN p.valor_centavos END), 0)::bigint AS d, coalesce(sum(CASE p.dc WHEN 'C' THEN p.valor_centavos END), 0)::bigint AS c
        FROM contab_partidas p JOIN contab_lancamentos l ON l.id = p.lancamento_id WHERE l.data BETWEEN $1 AND $2 AND p.conta LIKE '3%' GROUP BY p.conta, l.origem`, [de, ate]);
    const movs = mov.map(m => ({ conta: m.conta, origem: m.origem, d: Number(m.d), c: Number(m.c) }));
    if (tipo === 'dra') { const ora = movs.filter(m => m.conta.startsWith('3.3')).reduce((a, m) => a + m.c - m.d, 0); return { ...cab, ...emReais(M.dra(atual.ll, ora)) }; }
    const ini = [...(await saldos(de, de)).entries()].filter(([k]) => k.startsWith('3')).map(([k, v]) => [k, v.ant]);
    return { ...cab, ...emReais(M.dmpl(contas, ini, movs, encerrado ? 0 : atual.ll)) };
  }
  if (tipo === 'dva') { const mov = await saldos(de, ate, { semEncerramento: true }), d = M.dre(contas, mov, { modelo: 'atual' }); return { ...cab, ...emReais(M.dva(contas, mov, d.ll)) }; }
  if (tipo === 'lalur') {
    const regime = ['real', 'presumido'].includes(url.searchParams.get('regime')) ? url.searchParams.get('regime') : params.regime;
    const mov = await saldos(de, ate, { semEncerramento: true }), d = M.dre(contas, mov, { modelo: 'atual' }), soma = f => contas.filter(c => c.tipo === 'A' && f(c)).reduce((a, c) => { const m = mov.get(c.codigo) || { d: 0, c: 0 }; return a + m.c - m.d; }, 0);
    const rbS = soma(c => c.dre === 'rb' && c.tributos.includes('ISS')), rbC = soma(c => c.dre === 'rb') - rbS, outras = soma(c => ['rf', 'oro'].includes(c.dre));
    const ajustes = (await q('SELECT tipo, base, valor_centavos FROM contab_lalur WHERE ano = $1', [ano])).map(a => ({ tipo: a.tipo, base: a.base, valor: Number(a.valor_centavos) }));
    const ap = M.apuracaoLucro(regime, { lair: d.lair, receitaBrutaComercio: rbC, receitaBrutaServicos: rbS, outrasReceitas: outras, ajustes, meses, params, ano });
    return { ...cab, ano, ...emReais(ap), irpjCsllEscriturados: M.reais(contas.filter(c => c.tipo === 'A' && c.dre === 'ir').reduce((a, c) => { const m = mov.get(c.codigo) || { d: 0, c: 0 }; return a + m.d - m.c; }, 0)) };
  }
  throw new ErroHttp(404, 'Relatório desconhecido: use diario, razao, balancete, dre, balanco, dmpl, dra, dva ou lalur.');
}
/* centavos → reais em todo campo numérico (exceto aliquotas, percentuais, contagens e anos) */
const NAO_MOEDA = new Set(['nivel', 'ano', 'meses', 'cbs', 'ibs', 'is', 'pisCofins', 'icmsIss', 'irpjC', 'csllC', 'irpjS', 'csllS', 'grupo', 'numero', 'ok', 'confere', 'teste']);
function emReais(o, k) { if (typeof o === 'number') return NAO_MOEDA.has(k) ? o : M.reais(o); if (Array.isArray(o)) return o.map(x => emReais(x, k)); if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).map(([kk, v]) => [kk, emReais(v, kk)])); return o; }

/* ---------------------------------------------------------------- v13.86 · de-para FCX → plano de contas */
const deparaDb = r => ({ chave: r.chave, erpCodigo: r.erp_codigo, erpNome: r.erp_nome, agrupador: r.agrupador, conta: r.conta, contaNome: r.conta_nome || null, status: r.status, confianca: r.confianca == null ? null : Number(r.confianca), motivo: r.motivo, fonte: r.fonte, ativa: r.ativa, atualizadoEm: r.atualizado_em, atualizadoPor: r.atualizado_por });
async function lerDepara(t = q) { return (await t(`SELECT d.*, c.nome AS conta_nome FROM contab_depara d LEFT JOIN contab_contas c ON c.codigo = d.conta WHERE d.origem = 'fcx'`)).map(deparaDb).sort((a, b) => M.cmpRotuloFCX(a.chave, b.chave)); }
const resumoDepara = l => ({ total: l.length, automatico: l.filter(x => x.status === 'automatico').length, revisado: l.filter(x => x.status === 'revisado').length, pendente: l.filter(x => x.status === 'pendente').length, agrupadores: l.filter(x => x.agrupador).length, doContabil: l.filter(x => x.fonte === 'contabil').length, inativas: l.filter(x => !x.ativa).length });
/** Nível do usuário no FCX (0 nenhum · 1 ler · 2 modificar · 3 excluir); o Master tem tudo. */
function nivelFcx(sess) { if (!sess || sess.trocaPendente) return 0; if (sess.nivel >= NIVEL.admin) return 3; const n = ['', 'ler', 'modificar', 'excluir'].indexOf(normalizarPermissoes(sess.usuario?.permissoes).fcx || ''); /* v13.88: normalizado */ return sess.perfil === 'OPERACIONAL' ? Math.max(1, n) : Math.max(0, n); }
/** 'novo:<k>' → conta analítica do complemento (criada uma vez, pelo nome, debaixo da mãe). podeCriar=false: só procura. */
async function contaNova(t, k, contas, uid, podeCriar) {
  const n = M.NOVAS_CONTAS_FCX[k]; if (!n) return null;
  const ja = contas.find(c => c.pai === n.pai && M.normalizar(c.nome) === M.normalizar(n.nome)); if (ja) return { codigo: ja.codigo, criada: false };
  if (!podeCriar || !contas.some(c => c.codigo === n.pai && c.tipo === 'S')) return null;
  const codigo = M.proximoCodigo(n.pai, contas), c = M.validarConta({ codigo, nome: n.nome, tipo: 'A', dre: n.dre, dva: n.dva }, contas);
  await t(`INSERT INTO contab_contas (codigo, nome, grupo, natureza, tipo, pai, nivel, redutora, dre, dva, tributos, modelo_tributario, ia, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [c.codigo, c.nome, c.grupo, c.natureza, c.tipo, c.pai, c.nivel, c.redutora, c.dre, c.dva, c.tributos, c.modeloTributario, JSON.stringify({ origem: 'de-para FCX', motivos: ['complemento do plano padrão para contas que o FCX já usava'] }), uid]);
  contas.push({ ...c, ativa: true }); return { codigo, criada: true };
}
/** Mapeia e grava rótulos do FCX. Revisados nunca mudam; já mapeados só mudam com remapear. */
async function gravarDepara(t, rotulos, { usadas = [], uid, podeCriar = false, remapear = false, fonte = 'fcx', conta: contaFixa } = {}) {
  const contas = await lerContas(t), existentes = new Map((await t(`SELECT chave, status FROM contab_depara WHERE origem = 'fcx'`)).map(r => [r.chave, r.status]));
  const alvo = new Set(rotulos.map(x => String(x ?? '').trim()).filter(x => x && x.length <= 200)), mapa = M.mapearFCX([...new Set([...existentes.keys(), ...alvo])], contas, { usadas });
  let novos = 0, atualizados = 0; const criadas = [];
  for (const m of mapa) {
    if (!alvo.has(m.chave)) continue;
    const st = existentes.get(m.chave); if (st && (st === 'revisado' || !remapear)) continue;
    let conta = contaFixa || m.destino, status = contaFixa ? 'revisado' : m.status, motivo = contaFixa ? 'conta escolhida no Módulo Contábil' : m.motivo;
    if (conta?.startsWith('novo:')) { const r = await contaNova(t, conta.slice(5), contas, uid, podeCriar); if (r?.criada) criadas.push(r.codigo); conta = r?.codigo || null; if (!conta) { status = 'pendente'; motivo += ' (a conta nova é criada por quem gerencia o plano de contas)'; } }
    const c = conta && contas.find(x => x.codigo === conta); if (conta && (!c || (c.tipo === 'S') !== m.agrupador)) { conta = null; status = 'pendente'; }
    await t(`INSERT INTO contab_depara (origem, chave, erp_codigo, erp_nome, agrupador, conta, status, confianca, motivo, fonte, criado_por, atualizado_por) VALUES ('fcx',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
      ON CONFLICT (origem, chave) DO UPDATE SET erp_codigo = EXCLUDED.erp_codigo, erp_nome = EXCLUDED.erp_nome, agrupador = EXCLUDED.agrupador, conta = EXCLUDED.conta, status = EXCLUDED.status, confianca = EXCLUDED.confianca, motivo = EXCLUDED.motivo, atualizado_por = EXCLUDED.atualizado_por`,
      [m.chave, m.erpCodigo, m.erpNome, m.agrupador, conta, status, contaFixa ? 1 : m.conf, motivo.slice(0, 400), fonte, uid]);
    if (st) atualizados++; else novos++;
  }
  return { novos, atualizados, criadas };
}

/* ---------------------------------------------------------------- v13.88 · adiantamentos de viagem: acerto, contabilização e baixa */
const CAM_VIAGEM = id => 'funcionarios/_viagens/pedidos/' + id;
const cts = v => Math.round((Number(v) || 0) * 100);
/** Acerto da prestação (em centavos): por pessoa no repasse individual; senão, um grupo só. Exige a análise gravada em cada despesa
    (despesas[].aprovacao.valor = valor aprovado depois da crítica: glosas e excedentes de teto fora). */
export function acertoDaViagem(v) {
  const ind = v?.pagamento?.modo === 'individual', contas = v?.pagamento?.contas || [], desp = v?.despesas || [];
  const aprov = d => Math.max(0, Math.min(cts(d.valor), cts(d.aprovacao?.valor)));
  const grupos = (ind && contas.length ? contas.map(c => ({ funcionarioId: c.funcionarioId, nome: c.nome, adiantado: cts(c.valorPago ?? c.valor) }))
    : [{ funcionarioId: v.funcionarioId, nome: v.nome, adiantado: cts(v.valorPago ?? v.valor) }]).map(g => {
    const ds = ind && contas.length ? desp.filter(d => d.funcionarioId === g.funcionarioId) : desp, comprovado = ds.reduce((a, d) => a + cts(d.valor), 0), aprovado = ds.reduce((a, d) => a + aprov(d), 0), saldo = g.adiantado - aprovado;
    return { ...g, comprovado, aprovado, glosado: comprovado - aprovado, saldo, tipo: saldo > 0 ? 'devolver' : saldo < 0 ? 'reembolsar' : 'quitado' };
  });
  const porCategoria = {}; desp.forEach(d => { const x = aprov(d); if (x) porCategoria[d.categoria || 'Outros'] = (porCategoria[d.categoria || 'Outros'] || 0) + x; });
  const soma = f => grupos.reduce((a, g) => a + f(g), 0);
  return { semAnalise: desp.filter(d => !d.aprovacao || !Number.isFinite(Number(d.aprovacao.valor))).length, grupos, porCategoria,
    adiantado: soma(g => g.adiantado), comprovado: soma(g => g.comprovado), aprovado: soma(g => g.aprovado), devolver: soma(g => Math.max(0, g.saldo)), reembolsar: soma(g => Math.max(0, -g.saldo)) };
}
const CONTAS_ADT = { adiantamento: '1.1.2.03.002', banco: '1.1.1.02.001' };
const NOVAS_ADT = { devolver: { pai: '1.1.2.03', nome: 'Devoluções de Adiantamentos de Viagem a Receber' }, reembolsar: { pai: '2.1.5.01', nome: 'Reembolsos de Despesas de Viagem a Pagar' } };
/** Contas do acerto: parâmetros 'adiantamentos' do Módulo Contábil (opcional) ou as do plano padrão; as que faltam são criadas uma vez. */
async function contasAdt(t, sess) {
  const contas = await lerContas(t), cfg = (await t(`SELECT valor FROM contab_parametros WHERE chave = 'adiantamentos'`))[0]?.valor || {}, por = c => contas.find(x => x.codigo === c);
  const analitica = (cod, rot) => { const c = por(cod); if (!c || c.tipo !== 'A' || !c.ativa) throw new ErroHttp(422, `Conta de ${rot} (${cod}) não existe ou não é analítica ativa no plano de contas — ajuste no Módulo Contábil.`); return c.codigo; };
  const nova = async k => { if (cfg['conta' + k[0].toUpperCase() + k.slice(1)]) return analitica(cfg['conta' + k[0].toUpperCase() + k.slice(1)], k);
    const n = NOVAS_ADT[k], ja = contas.find(c => c.pai === n.pai && M.normalizar(c.nome) === M.normalizar(n.nome)); if (ja) return ja.codigo;
    if (!por(n.pai) || por(n.pai).tipo !== 'S') throw new ErroHttp(422, `A conta-mãe ${n.pai} não existe no plano de contas.`);
    const codigo = M.proximoCodigo(n.pai, contas), c = M.validarConta({ codigo, nome: n.nome, tipo: 'A' }, contas);
    await t(`INSERT INTO contab_contas (codigo, nome, grupo, natureza, tipo, pai, nivel, redutora, dre, dva, tributos, modelo_tributario, ia, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [c.codigo, c.nome, c.grupo, c.natureza, c.tipo, c.pai, c.nivel, c.redutora, c.dre, c.dva, c.tributos, c.modeloTributario, JSON.stringify({ origem: 'acerto de adiantamentos (v13.88)' }), sess.uid]); contas.push({ ...c, ativa: true }); return c.codigo; };
  const despesa = cfg.contaDespesa ? analitica(cfg.contaDespesa, 'despesa de viagem') : (await contaNova(t, 'viagens', contas, sess.uid, true))?.codigo;
  if (!despesa) throw new ErroHttp(422, 'Não encontrei a conta de despesas de viagem (5.3.3 · Viagens e Estadias).');
  return { adiantamento: analitica(cfg.contaAdiantamento || CONTAS_ADT.adiantamento, 'adiantamento a empregados'), banco: analitica(cfg.contaBanco || CONTAS_ADT.banco, 'banco'), despesa, devolver: await nova('devolver'), reembolsar: await nova('reembolsar') };
}
const hojeISO = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); /* dia em Brasília */
const itensLanc = xs => xs.filter(x => x.valor > 0).map((x, i) => ({ seq: i + 1, conta: x.conta, dc: x.dc, valor: x.valor, centro: x.centro || null, historico: x.historico || null }));
/** Lançamentos do adiantamento (pagamento) e da liquidação; idempotente pelo documento (ADT-<id> e ADT-<id>-ACERTO, sem estorno). */
async function contabilizarViagem(t, sess, v, ac) {
  const [n] = await t('SELECT count(*)::int AS n FROM contab_contas'); if (!n.n) return { pendente: true, motivo: 'O plano de contas do Módulo Contábil ainda não foi criado.' };
  const params = await lerParametros(t), hoje = hojeISO(); if (params.fechadoAte && hoje <= params.fechadoAte) throw new ErroHttp(422, `O período contábil está fechado até ${params.fechadoAte.split('-').reverse().join('/')}.`);
  const c = await contasAdt(t, sess), A = `ADT-${v.id}`, B = `ADT-${v.id}-ACERTO`;
  const feitos = new Map((await t(`SELECT doc_ref, numero FROM contab_lancamentos l WHERE doc_ref = ANY($1) AND origem <> 'estorno' AND NOT EXISTS (SELECT 1 FROM contab_lancamentos e WHERE e.estorno_de = l.id)`, [[A, B]])).map(r => [r.doc_ref, Number(r.numero)]));
  const quem = (v.pagamento?.modo === 'individual' ? (v.pagamento.contas || []).map(x => x.nome) : [v.nome]).filter(Boolean).join(', '), destino = v.destino || v.destinoCidade || '', centro = v.centroCusto || null, out = [];
  if (feitos.has(A)) out.push({ tipo: 'adiantamento', numero: feitos.get(A), existente: true });
  else if (ac.adiantado > 0) { const pago = String(v.pagoData || hoje).slice(0, 10), data = params.fechadoAte && pago <= params.fechadoAte ? hoje : pago;
    const r = await gravarLancamento(t, sess, { data, historico: `Adiantamento de viagem pago · ${quem}${destino ? ' · ' + destino : ''}${data !== pago ? ` (pago em ${pago.split('-').reverse().join('/')}; período fechado)` : ''}`.slice(0, 500), origem: 'adiantamento', docRef: A, total: ac.adiantado,
      itens: itensLanc([{ conta: c.adiantamento, dc: 'D', valor: ac.adiantado, centro }, { conta: c.banco, dc: 'C', valor: ac.adiantado, centro }]) }); out.push({ tipo: 'adiantamento', numero: r.numero, id: r.id }); }
  if (feitos.has(B)) out.push({ tipo: 'acerto', numero: feitos.get(B), existente: true });
  else if (ac.adiantado > 0 || ac.aprovado > 0) {
    const ds = Object.entries(ac.porCategoria).map(([cat, val]) => ({ conta: c.despesa, dc: 'D', valor: val, centro, historico: cat }));
    const itens = itensLanc([...ds, { conta: c.devolver, dc: 'D', valor: ac.devolver, historico: 'Saldo a devolver pelo viajante ao caixa' }, { conta: c.adiantamento, dc: 'C', valor: ac.adiantado, centro }, { conta: c.reembolsar, dc: 'C', valor: ac.reembolsar, historico: 'Saldo a reembolsar ao viajante' }]);
    const tot = itens.filter(i => i.dc === 'D').reduce((a, i) => a + i.valor, 0);
    const r = await gravarLancamento(t, sess, { data: hoje, historico: `Acerto de contas da prestação · ${quem}${destino ? ' · ' + destino : ''}: despesas aprovadas ${M.fmt(ac.aprovado)}${ac.devolver ? ` · a devolver ${M.fmt(ac.devolver)}` : ''}${ac.reembolsar ? ` · a reembolsar ${M.fmt(ac.reembolsar)}` : ''}`.slice(0, 500), origem: 'adiantamento', docRef: B, total: tot, itens });
    out.push({ tipo: 'acerto', numero: r.numero, id: r.id });
  }
  return { pendente: false, lancamentos: out, contas: c, em: new Date().toISOString() };
}
async function lerViagem(t, id) { const [d] = await t('SELECT doc_id, dados FROM documentos WHERE caminho = $1 FOR UPDATE', [CAM_VIAGEM(String(id || ''))]); if (!d) throw new ErroHttp(404, 'Viagem não encontrada.'); return { id: d.doc_id, ...d.dados }; }
const histV = (v, sess, txt, de, para) => [...(v.historico || []), { em: new Date().toISOString(), por: sess.uid, porNome: sess.usuario?.nome || 'Master', txt, ...(de ? { de, para } : {}) }].slice(-40);
const reais = c => M.reais(c);
async function rotaAdiantamentos(req, sess, perms, acao) {
  const d = await corpo(req), master = sess.nivel >= NIVEL.admin;
  if (acao === 'encerrar') {
    if (!master) throw new ErroHttp(403, 'Só o Master encerra a prestação de contas (dinheiro de viagem é decisão do Master).');
    return tx(async t => {
      const v = await lerViagem(t, d.viagemId); if (v.acerto?.encerradoEm || v.status === 'concluido') throw new ErroHttp(409, 'Esta prestação de contas já foi encerrada.');
      if (!['aguardando_prestacao', 'prestacao_enviada'].includes(v.status)) throw new ErroHttp(422, 'A prestação só é encerrada depois do pagamento do adiantamento.');
      const ac = acertoDaViagem(v); if (ac.semAnalise) throw new ErroHttp(422, `${ac.semAnalise} despesa(s) sem análise gravada: abra o Acerto de Contas, confira a crítica e salve antes de encerrar.`);
      const venc = v.politica?.prazoData && v.politica.prazoData >= hojeISO() ? v.politica.prazoData : hojeISO();
      const titulos = ac.grupos.filter(g => g.saldo).map(g => ({ funcionarioId: g.funcionarioId, nome: g.nome, tipo: g.tipo, valor: reais(Math.abs(g.saldo)), status: 'aberto', vencimento: venc }));
      /* sem SAVEPOINT: as partidas só entram na transação do próprio lançamento (trava do banco). Erro contábil (período
         fechado, conta faltando) desfaz o encerramento inteiro e volta para a tela; sem plano de contas, fica "pendente". */
      const contabil = await contabilizarViagem(t, sess, v, ac);
      const acerto = { encerradoEm: new Date().toISOString(), encerradoPor: sess.uid, encerradoPorNome: sess.usuario?.nome || 'Master', adiantado: reais(ac.adiantado), comprovado: reais(ac.comprovado), aprovado: reais(ac.aprovado), glosado: reais(ac.comprovado - ac.aprovado),
        saldo: reais(ac.adiantado - ac.aprovado), devolver: reais(ac.devolver), reembolsar: reais(ac.reembolsar), grupos: ac.grupos.map(g => ({ funcionarioId: g.funcionarioId, nome: g.nome, adiantado: reais(g.adiantado), aprovado: reais(g.aprovado), glosado: reais(g.glosado), saldo: reais(g.saldo), tipo: g.tipo })), titulos, contabil };
      const txt = `Prestação encerrada (acerto final) · despesas aprovadas ${M.fmt(ac.aprovado)} de ${M.fmt(ac.adiantado)} adiantados${ac.devolver ? ` · a devolver ${M.fmt(ac.devolver)}` : ''}${ac.reembolsar ? ` · a reembolsar ${M.fmt(ac.reembolsar)}` : ''}${contabil.pendente ? ' · contabilização pendente' : ` · lançamentos nº ${contabil.lancamentos.map(l => l.numero).join(', ')}`}`;
      const { id, ...dados } = v; await gravarDoc(t, sess, CAM_VIAGEM(id), { ...dados, status: 'concluido', concluidoEm: acerto.encerradoEm, concluidoPor: sess.uid, concluidoPorNome: acerto.encerradoPorNome, acerto, historico: histV(v, sess, txt, v.status, 'concluido') });
      return json(200, { acerto });
    });
  }
  if (acao === 'contabilizar') {
    if (!master && !perms.has('contabil.lancar')) throw new ErroHttp(403, 'Contabilizar o acerto: Master ou "Contabilidade · Modificar".');
    return tx(async t => {
      const v = await lerViagem(t, d.viagemId); if (!v.acerto?.encerradoEm) throw new ErroHttp(422, 'Encerre a prestação de contas antes de contabilizar.');
      if (v.acerto.contabil && !v.acerto.contabil.pendente) return json(200, { acerto: v.acerto });
      const contabil = await contabilizarViagem(t, sess, v, acertoDaViagem(v)); if (contabil.pendente) throw new ErroHttp(409, contabil.motivo);
      const acerto = { ...v.acerto, contabil }, { id, ...dados } = v;
      await gravarDoc(t, sess, CAM_VIAGEM(id), { ...dados, acerto, historico: histV(v, sess, `Acerto contabilizado · lançamentos nº ${contabil.lancamentos.map(l => l.numero).join(', ')}`) });
      return json(200, { acerto });
    });
  }
  if (acao === 'baixar') {
    if (!master && !tem(sess.perms, 'viagens.pagar')) throw new ErroHttp(403, 'Baixar o título: Master ou o financeiro ("Viagens · Modificar").');
    const data = String(d.data || hojeISO()); if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new ErroHttp(422, 'Data da baixa inválida (AAAA-MM-DD).');
    return tx(async t => {
      const v = await lerViagem(t, d.viagemId), ts = v.acerto?.titulos || [], i = ts.findIndex(x => x.status === 'aberto' && (!d.funcionarioId || x.funcionarioId === d.funcionarioId)); if (i < 0) throw new ErroHttp(404, 'Nenhum título em aberto nesta viagem.');
      const ti = ts[i], val = cts(ti.valor); let lanc = null;
      if (v.acerto.contabil && !v.acerto.contabil.pendente) {
        const params = await lerParametros(t); if (params.fechadoAte && data <= params.fechadoAte) throw new ErroHttp(422, 'Data da baixa em período contábil fechado.');
        const c = await contasAdt(t, sess), ref = `ADT-${v.id}-BAIXA-${ti.funcionarioId || 'unico'}`;
        const [ja] = await t(`SELECT numero FROM contab_lancamentos l WHERE doc_ref = $1 AND NOT EXISTS (SELECT 1 FROM contab_lancamentos e WHERE e.estorno_de = l.id)`, [ref]);
        if (ja) lanc = { numero: Number(ja.numero), existente: true };
        else { const dev = ti.tipo === 'devolver', r = await gravarLancamento(t, sess, { data, historico: `${dev ? 'Devolução de saldo de adiantamento recebida' : 'Reembolso de despesas de viagem pago'} · ${ti.nome}${d.forma ? ' · ' + String(d.forma).slice(0, 40) : ''}`, origem: 'adiantamento', docRef: ref, total: val,
            itens: itensLanc(dev ? [{ conta: c.banco, dc: 'D', valor: val }, { conta: c.devolver, dc: 'C', valor: val }] : [{ conta: c.reembolsar, dc: 'D', valor: val }, { conta: c.banco, dc: 'C', valor: val }]) }); lanc = { numero: r.numero, id: r.id }; }
      }
      const titulos = ts.map((x, k) => k === i ? { ...x, status: 'baixado', baixa: { data, forma: d.forma ? String(d.forma).slice(0, 40) : '', por: sess.uid, porNome: sess.usuario?.nome || '', em: new Date().toISOString(), lancamento: lanc } } : x);
      const acerto = { ...v.acerto, titulos }, { id, ...dados } = v;
      await gravarDoc(t, sess, CAM_VIAGEM(id), { ...dados, acerto, historico: histV(v, sess, `${ti.tipo === 'devolver' ? 'Devolução recebida' : 'Reembolso pago'} · ${ti.nome} · ${M.fmt(val)}${lanc ? ` · lançamento nº ${lanc.numero}` : ''}`) });
      return json(200, { acerto });
    });
  }
  throw new ErroHttp(404, 'Ação de adiantamentos desconhecida.');
}

/* ---------------------------------------------------------------- rota */
async function corpo(req) { const t = await req.text(); if (t.length > 2 * 1024 * 1024) throw new ErroHttp(413, 'Requisição grande demais.'); try { return t ? JSON.parse(t) : {}; } catch { throw new ErroHttp(400, 'Corpo inválido.'); } }
const pgErro = e => { const m = String(e?.message || ''); if (e?.code === 'P0001' || m.startsWith('CONTAB:')) return new ErroHttp(422, m.replace(/^CONTAB:\s*/, '')); if (e?.code === '23505') return new ErroHttp(409, /estorno_de/.test(m + (e.constraint || '')) ? 'Este lançamento já foi estornado.' : 'Registro duplicado (código ou nome já existe nesta conta-mãe).'); if (e?.code === '23503') return new ErroHttp(409, 'A conta está em uso (lançamentos ou contas filhas) — inative em vez de excluir.'); if (e?.code === '23514') return new ErroHttp(422, 'Dados fora das regras do plano de contas (' + (e.constraint || 'verificação') + ').'); return e; };

export default rota(async req => {
  const url = new URL(req.url), sess = await sessaoDe(req); if (!sess) return erro(401, 'Sessão encerrada. Faça login de novo.');
  const perms = permissoesContabil(sess), partes = url.pathname.replace(/\/+$/, '').split('/').slice(3), [r0, r1] = partes, met = req.method;
  try {
    /* ---- v13.86 · lista do FCX (somente leitura no FCX): quem lê o FCX lê a lista; quem grava no FCX registra contas novas para revisão ---- */
    if (r0 === 'fcx-contas') {
      const nf = nivelFcx(sess); if (!nf && !perms.has('contabil.ver')) throw new ErroHttp(403, 'Seu acesso não lê o FCX.');
      if (met === 'GET') { const l = await lerDepara(); return json(200, { contas: l.filter(x => x.ativa).map(x => ({ rotulo: x.chave, conta: x.conta, contaNome: x.contaNome, status: x.status, agrupador: x.agrupador, fonte: x.fonte })), inativas: l.filter(x => !x.ativa).map(x => x.chave), resumo: resumoDepara(l), podeGerir: perms.has('contabil.plano') }); }
      if (met === 'POST') {
        if (!perms.has('contabil.plano') && !(nf >= 2 && sess.perfil !== 'LOJA')) throw new ErroHttp(403, 'Seu acesso ao FCX é somente leitura.');
        const d = await corpo(req), rot = (Array.isArray(d.contas) ? d.contas : []).slice(0, 2000);
        const [n] = await q('SELECT count(*)::int AS n FROM contab_contas'); if (!n.n) return json(200, { registradas: 0, semPlano: true });
        const r = await tx(t => gravarDepara(t, rot, { usadas: rot, uid: sess.uid, podeCriar: perms.has('contabil.plano') }));
        return json(200, { registradas: r.novos, criadas: r.criadas });
      }
    }
    if (r0 === 'adiantamentos' && met === 'POST') return await rotaAdiantamentos(req, sess, perms, r1); /* v13.88: Master/financeiro (não exige o Módulo Contábil aberto) */
    exigir(perms, 'contabil.ver');
    if (!r0 && met === 'GET') { const [n] = await q('SELECT count(*)::int AS n, count(*) FILTER (WHERE tipo = \'A\')::int AS a FROM contab_contas'), [l] = await q('SELECT count(*)::int AS n, max(data)::text AS ultima FROM contab_lancamentos'); return json(200, { plano: { contas: n.n, analiticas: n.a, criado: n.n > 0 }, lancamentos: { total: l.n, ultimaData: l.ultima || null }, parametros: await lerParametros(), permissoes: [...perms], depara: resumoDepara(await lerDepara()), catalogo: { grupos: M.GRUPOS, dre: M.DRE_LINHAS, dva: M.DVA_LINHAS, tributosAtuais: M.TRIBUTOS_ATUAIS, tributosReforma: M.TRIBUTOS_REFORMA, outrosTributos: ['IRPJ', 'CSLL', 'INSS'] } }); }

    /* ---- plano de contas ---- */
    if (r0 === 'contas') {
      if (met === 'GET') return json(200, { contas: await lerContas() });
      exigir(perms, 'contabil.plano');
      if (met === 'POST') {
        const d = await corpo(req), contas = await lerContas(), ia = M.classificar(d.nome, contas, { pai: d.pai || (d.codigo ? M.partesCodigo(d.codigo).pai : null) });
        const codigo = d.codigo || (d.pai ? M.proximoCodigo(d.pai, contas) : ia.codigo); if (!codigo) throw new ErroHttp(422, 'Não foi possível sugerir o código: informe a conta-mãe.');
        if (contas.some(c => c.codigo === codigo)) throw new ErroHttp(409, `Já existe a conta ${codigo}.`);
        const c = M.validarConta({ codigo, nome: d.nome, tipo: d.tipo || ia.tipo, redutora: d.redutora ?? ia.redutora, natureza: d.natureza, dre: d.dre !== undefined ? d.dre : (M.partesCodigo(codigo).grupo >= 4 ? ia.dre : null), dva: d.dva !== undefined ? d.dva : (M.partesCodigo(codigo).grupo >= 4 ? ia.dva : null), tributos: d.tributos ?? ia.tributos, modeloTributario: d.modeloTributario ?? ia.modeloTributario }, contas);
        await q(`INSERT INTO contab_contas (codigo, nome, grupo, natureza, tipo, pai, nivel, redutora, dre, dva, tributos, modelo_tributario, ia, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [c.codigo, c.nome, c.grupo, c.natureza, c.tipo, c.pai, c.nivel, c.redutora, c.dre, c.dva, c.tributos, c.modeloTributario, JSON.stringify({ confianca: ia.confianca, motivos: ia.motivos, sugerido: { grupo: ia.grupo, natureza: ia.natureza, tipo: ia.tipo, pai: ia.pai } }), sess.uid]);
        return json(201, { conta: (await lerContas()).find(x => x.codigo === c.codigo), ia });
      }
      const codigo = url.searchParams.get('codigo'), contas = await lerContas(), atual = contas.find(c => c.codigo === codigo); if (!atual) throw new ErroHttp(404, 'Conta não encontrada.');
      if (met === 'PUT') {
        const d = await corpo(req), c = M.validarConta({ ...atual, ...d, codigo: atual.codigo, natureza: d.natureza ?? (d.redutora !== undefined ? undefined : atual.natureza), tributos: d.tributos ?? atual.tributos, modeloTributario: d.modeloTributario ?? (d.tributos ? undefined : atual.modeloTributario) }, contas.filter(x => x.codigo !== codigo));
        if (d.ativa === false && contas.some(x => x.pai === codigo && x.ativa)) throw new ErroHttp(409, 'Inative antes as contas filhas.');
        await q(`UPDATE contab_contas SET nome=$2, tipo=$3, natureza=$4, redutora=$5, dre=$6, dva=$7, tributos=$8, modelo_tributario=$9, ativa=$10, atualizado_em=now(), atualizado_por=$11 WHERE codigo=$1`,
          [codigo, c.nome, c.tipo, c.natureza, c.redutora, c.dre, c.dva, c.tributos, c.modeloTributario, d.ativa === undefined ? atual.ativa : !!d.ativa, sess.uid]);
        return json(200, { conta: (await lerContas()).find(x => x.codigo === codigo) });
      }
      if (met === 'DELETE') { const [u] = await q('SELECT EXISTS (SELECT 1 FROM contab_partidas WHERE conta = $1) AS mov, EXISTS (SELECT 1 FROM contab_contas WHERE pai = $1) AS fil', [codigo]); if (u.mov || u.fil) throw new ErroHttp(409, u.mov ? 'A conta já tem lançamentos: não pode ser excluída (inative-a).' : 'A conta tem contas filhas: exclua ou mova as filhas antes.'); await q('DELETE FROM contab_contas WHERE codigo = $1', [codigo]); return json(200, { ok: true }); }
    }
    /* ---- v13.86 · importação do FCX e revisão do de-para ---- */
    if (r0 === 'importar-fcx' && met === 'POST') {
      exigir(perms, 'contabil.plano');
      const d = await corpo(req), rot = (Array.isArray(d.contas) ? d.contas : []).slice(0, 5000), usadas = (Array.isArray(d.usadas) ? d.usadas : []).slice(0, 5000);
      if (!rot.length && !usadas.length) throw new ErroHttp(422, 'Nenhuma conta do FCX recebida: abra o FCX ao menos uma vez e tente de novo.');
      const r = await tx(async t => {
        const [n] = await t('SELECT count(*)::int AS n FROM contab_contas'); let planoCriado = 0;
        if (!n.n) { for (const c of M.PLANO_PADRAO) await t(`INSERT INTO contab_contas (codigo, nome, grupo, natureza, tipo, pai, nivel, redutora, dre, dva, tributos, modelo_tributario, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [c.codigo, c.nome, c.grupo, c.natureza, c.tipo, c.pai, c.nivel, c.redutora, c.dre, c.dva, c.tributos, c.modeloTributario, sess.uid]); planoCriado = M.PLANO_PADRAO.length; }
        const g = await gravarDepara(t, [...rot, ...usadas], { usadas, uid: sess.uid, podeCriar: true, remapear: !!d.remapear });
        const contas = new Map((await lerContas(t)).map(c => [c.codigo, c])); let complemento = 0;
        for (const [rotulo, conta] of M.COMPLEMENTO_FCX) { if (contas.get(conta)?.tipo !== 'A') continue; const p = M.rotuloFCX(rotulo);
          const ins = await t(`INSERT INTO contab_depara (origem, chave, erp_codigo, erp_nome, agrupador, conta, status, confianca, motivo, fonte, criado_por, atualizado_por) VALUES ('fcx',$1,$2,$3,false,$4,'automatico',1,$5,'contabil',$6,$6) ON CONFLICT (origem, chave) DO NOTHING RETURNING chave`,
            [rotulo, p.codigo, p.nome, conta, 'Reforma Tributária (LC 214/2025): conta oferecida ao FCX pelo Módulo Contábil', sess.uid]); complemento += ins.length; }
        return { planoCriado, ...g, complemento };
      });
      const l = await lerDepara(); return json(200, { ...r, resumo: resumoDepara(l) });
    }
    if (r0 === 'depara') {
      if (met === 'GET') { const l = await lerDepara(); return json(200, { itens: l, resumo: resumoDepara(l) }); }
      exigir(perms, 'contabil.plano');
      if (met === 'POST') {
        const d = await corpo(req), rotulo = String(d.rotulo || '').trim().replace(/\s+/g, ' '); if (rotulo.length < 3 || rotulo.length > 200) throw new ErroHttp(422, 'Informe o nome da conta do FCX (de 3 a 200 caracteres), de preferência com o código do ERP: "4.10.17 – (-) Nova despesa".');
        if ((await q(`SELECT 1 FROM contab_depara WHERE origem = 'fcx' AND chave = $1`, [rotulo])).length) throw new ErroHttp(409, 'Esta conta já está na lista do FCX.');
        if (d.conta) { const c = (await lerContas()).find(x => x.codigo === d.conta); if (!c || c.tipo !== 'A' || !c.ativa) throw new ErroHttp(422, 'Escolha uma conta analítica ativa do plano.'); }
        await tx(t => gravarDepara(t, [rotulo], { usadas: [rotulo], uid: sess.uid, podeCriar: true, fonte: 'contabil', conta: d.conta || undefined }));
        return json(201, { item: (await lerDepara()).find(x => x.chave === rotulo) });
      }
      if (met === 'PUT') {
        const d = await corpo(req), itens = Array.isArray(d.itens) ? d.itens : [d], contas = new Map((await lerContas()).map(c => [c.codigo, c])), atual = new Map((await lerDepara()).map(x => [x.chave, x]));
        if (!itens.length || itens.length > 2000) throw new ErroHttp(422, 'Informe de 1 a 2000 itens.');
        await tx(async t => { for (const it of itens) {
          const a = atual.get(String(it.chave || '')); if (!a) throw new ErroHttp(404, `Conta do FCX não encontrada: ${it.chave}`);
          const conta = it.conta === undefined ? a.conta : it.conta || null, c = conta ? contas.get(conta) : null;
          if (conta && (!c || !c.ativa)) throw new ErroHttp(422, `Conta ${conta} não existe ou está inativa.`);
          if (c && (c.tipo === 'S') !== a.agrupador) throw new ErroHttp(422, a.agrupador ? `"${a.chave}" é um agrupador do ERP: aponte para uma conta sintética.` : `"${a.chave}" recebe lançamentos: aponte para uma conta analítica (${conta} é sintética).`);
          const status = it.status === 'pendente' ? 'pendente' : conta ? 'revisado' : 'pendente';
          await t(`UPDATE contab_depara SET conta = $2, status = $3, ativa = $4, confianca = CASE WHEN $3 = 'revisado' THEN 1 ELSE confianca END, motivo = CASE WHEN $3 = 'revisado' AND (conta IS DISTINCT FROM $2 OR status <> 'revisado') THEN 'revisado no Módulo Contábil' ELSE motivo END, atualizado_por = $5 WHERE origem = 'fcx' AND chave = $1`,
            [a.chave, conta, status, it.ativa === undefined ? a.ativa : !!it.ativa, sess.uid]);
        } });
        const l = await lerDepara(), ch = new Set(itens.map(i => String(i.chave))); return json(200, { itens: l.filter(x => ch.has(x.chave)), resumo: resumoDepara(l) });
      }
    }
    if (r0 === 'classificar' && met === 'POST') { const d = await corpo(req); return json(200, { sugestao: M.classificar(d.nome, await lerContas(), { pai: d.pai }) }); }
    if (r0 === 'plano-padrao' && met === 'POST') {
      exigir(perms, 'contabil.parametros');
      return json(201, await tx(async t => { const [n] = await t('SELECT count(*)::int AS n FROM contab_contas'); if (n.n) throw new ErroHttp(409, 'O plano de contas já existe: ajuste-o pela tela do Módulo Contábil.');
        for (const c of M.PLANO_PADRAO) await t(`INSERT INTO contab_contas (codigo, nome, grupo, natureza, tipo, pai, nivel, redutora, dre, dva, tributos, modelo_tributario, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [c.codigo, c.nome, c.grupo, c.natureza, c.tipo, c.pai, c.nivel, c.redutora, c.dre, c.dva, c.tributos, c.modeloTributario, sess.uid]);
        return { criadas: M.PLANO_PADRAO.length }; }));
    }

    /* ---- lançamentos ---- */
    if (r0 === 'lancamentos') {
      if (met === 'DELETE' || met === 'PUT' || met === 'PATCH') throw new ErroHttp(405, 'Lançamentos contábeis são intangíveis: não podem ser alterados nem excluídos. Faça um estorno (POST /api/contabil/lancamentos/estorno).');
      if (met === 'GET') return json(200, { lancamentos: await lerLancamentos({ de: url.searchParams.get('de'), ate: url.searchParams.get('ate'), conta: url.searchParams.get('conta'), limite: url.searchParams.get('limite') }) });
      if (met === 'POST' && !r1) {
        exigir(perms, 'contabil.lancar');
        const d = await corpo(req), params = await lerParametros(), contas = new Map((await lerContas()).map(c => [c.codigo, c])), l = M.validarLancamento(d, contas);
        if (params.fechadoAte && l.data <= params.fechadoAte) throw new ErroHttp(422, `O período até ${params.fechadoAte.split('-').reverse().join('/')} está fechado.`);
        const origem = ['manual', 'aumento_capital', 'dividendos', 'reserva', 'ajuste_avaliacao', 'integracao'].includes(d.origem) ? d.origem : 'manual';
        const r = await tx(t => gravarLancamento(t, sess, { ...l, origem, docRef: d.docRef ? String(d.docRef).slice(0, 120) : null }));
        return json(201, { lancamento: (await lerLancamentos({ ids: [r.id] }))[0] });
      }
      if (met === 'POST' && r1 === 'estorno') {
        exigir(perms, 'contabil.estornar');
        const d = await corpo(req), [orig] = await lerLancamentos({ ids: [String(d.id || '')] }); if (!orig) throw new ErroHttp(404, 'Lançamento original não encontrado.');
        if (orig.estornoDe) throw new ErroHttp(422, 'Este lançamento já é um estorno: não se estorna um estorno (faça um novo lançamento).');
        if (orig.estornadoPor) throw new ErroHttp(409, 'Este lançamento já foi estornado.');
        const motivo = String(d.motivo || '').trim(); if (motivo.length < 5) throw new ErroHttp(422, 'Informe o motivo do estorno.');
        const params = await lerParametros(), data = d.data || new Date().toISOString().slice(0, 10); if (params.fechadoAte && data <= params.fechadoAte) throw new ErroHttp(422, 'Data do estorno em período fechado.');
        const itens = orig.itens.map(i => ({ seq: i.seq, conta: i.conta, dc: i.dc === 'D' ? 'C' : 'D', valor: Math.round(i.valor * 100), centro: i.centro, historico: i.historico }));
        const r = await tx(t => gravarLancamento(t, sess, { data, historico: `Estorno do lançamento nº ${orig.numero} — ${motivo}`.slice(0, 500), origem: 'estorno', estornoDe: orig.id, docRef: orig.docRef, itens, total: Math.round(orig.total * 100) }));
        return json(201, { estorno: (await lerLancamentos({ ids: [r.id] }))[0], original: orig.id });
      }
    }

    /* ---- parâmetros ---- */
    if (r0 === 'parametros') {
      if (met === 'GET') return json(200, { parametros: await lerParametros() });
      if (met === 'PUT') {
        exigir(perms, 'contabil.parametros');
        const d = await corpo(req), atual = await lerParametros(), g = { regime: d.regime ?? atual.regime, presumido: { ...atual.presumido, ...(d.presumido || {}) }, lc224: d.lc224 ?? atual.lc224, reforma: { ...atual.reforma, ...(d.reforma || {}) }, dreModelo: d.dreModelo ?? atual.dreModelo, contaResultado: d.contaResultado ?? atual.contaResultado };
        if (!['real', 'presumido'].includes(g.regime)) throw new ErroHttp(422, 'Regime: "real" (Lucro Real, com LALUR) ou "presumido" (Lucro Presumido).');
        if (!['atual', 'reforma'].includes(g.dreModelo)) throw new ErroHttp(422, 'Modelo da DRE: "atual" (ICMS/PIS/COFINS) ou "reforma" (IBS/CBS/IS).');
        for (const k of ['cbs', 'ibs', 'is']) if (!(Number(g.reforma[k]) >= 0 && Number(g.reforma[k]) < 0.5)) throw new ErroHttp(422, `Alíquota de ${k.toUpperCase()} inválida (fração: 0,088 = 8,8%).`);
        if (!(Number(g.reforma.ano) >= 2026 && Number(g.reforma.ano) <= 2040)) throw new ErroHttp(422, 'Ano da simulação da reforma entre 2026 e 2040.');
        for (const [k, v] of Object.entries(g.presumido)) if (!(Number(v) > 0 && Number(v) <= 1)) throw new ErroHttp(422, `Percentual de presunção inválido: ${k}.`);
        const resultado = (await lerContas()).find(c => c.codigo === g.contaResultado); if (resultado && (resultado.grupo !== 3 || resultado.tipo !== 'A')) throw new ErroHttp(422, 'A conta de resultado do encerramento deve ser analítica do Patrimônio Líquido.');
        await tx(async t => {
          await t(`INSERT INTO contab_parametros (chave, valor, atualizado_por) VALUES ('geral', $1, $2) ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now(), atualizado_por = EXCLUDED.atualizado_por`, [JSON.stringify(g), sess.uid]);
          if (d.fechadoAte !== undefined) { if (d.fechadoAte !== null && !/^\d{4}-\d{2}-\d{2}$/.test(d.fechadoAte)) throw new ErroHttp(422, 'Data de fechamento inválida.'); if (atual.fechadoAte && (!d.fechadoAte || d.fechadoAte < atual.fechadoAte) && sess.nivel < NIVEL.admin) throw new ErroHttp(403, 'Só o Master reabre período fechado.');
            await t(`INSERT INTO contab_parametros (chave, valor, atualizado_por) VALUES ('fechamento', $1, $2) ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now(), atualizado_por = EXCLUDED.atualizado_por`, [JSON.stringify({ fechadoAte: d.fechadoAte }), sess.uid]); }
        });
        return json(200, { parametros: await lerParametros() });
      }
    }
    /* ---- LALUR ---- */
    if (r0 === 'lalur') {
      if (met === 'GET') { const ano = Number(url.searchParams.get('ano')) || new Date().getFullYear(); return json(200, { ano, ajustes: (await q('SELECT * FROM contab_lalur WHERE ano = $1 ORDER BY id', [ano])).map(a => ({ id: Number(a.id), ano: a.ano, parte: a.parte, tipo: a.tipo, base: a.base, descricao: a.descricao, valor: M.reais(a.valor_centavos), conta: a.conta, criadoEm: a.criado_em })) }); }
      exigir(perms, 'contabil.parametros');
      if (met === 'POST') { const d = await corpo(req); if (!['adicao', 'exclusao', 'compensacao'].includes(d.tipo)) throw new ErroHttp(422, 'Tipo: adicao, exclusao ou compensacao.'); const v = M.centavos(d.valor);
        const [r] = await q(`INSERT INTO contab_lalur (ano, parte, tipo, base, descricao, valor_centavos, conta, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [Number(d.ano), d.tipo === 'compensacao' ? 'B' : (d.parte === 'B' ? 'B' : 'A'), d.tipo, ['irpj', 'csll'].includes(d.base) ? d.base : 'ambos', String(d.descricao || '').trim(), v, d.conta || null, sess.uid]); return json(201, { id: Number(r.id) }); }
      if (met === 'DELETE') { await q('DELETE FROM contab_lalur WHERE id = $1', [Number(url.searchParams.get('id'))]); return json(200, { ok: true }); }
    }
    /* ---- encerramento do exercício ---- */
    if (r0 === 'encerramento' && met === 'POST') {
      exigir(perms, 'contabil.estornar');
      const d = await corpo(req), ano = Number(d.ano); if (!(ano >= 2000 && ano <= 2100)) throw new ErroHttp(422, 'Informe o ano.');
      if ((await q(`SELECT 1 FROM contab_lancamentos WHERE origem = 'encerramento' AND doc_ref = $1 AND NOT EXISTS (SELECT 1 FROM contab_lancamentos e WHERE e.estorno_de = contab_lancamentos.id)`, ['ENC-' + ano])).length) throw new ErroHttp(409, `O exercício de ${ano} já foi encerrado.`);
      const params = await lerParametros(), contas = await lerContas(), dest = contas.find(c => c.codigo === params.contaResultado); if (!dest || dest.tipo !== 'A' || dest.grupo !== 3) throw new ErroHttp(422, 'Configure a conta de Lucros ou Prejuízos Acumulados (analítica do PL) nos parâmetros.');
      const sal = await saldos(`${ano}-12-31`, `${ano}-12-31`), itens = []; let liq = 0;
      for (const c of contas.filter(c => c.tipo === 'A' && c.grupo >= 4)) { const s = sal.get(c.codigo); const v = s ? s.ant + s.d - s.c : 0; if (!v) continue; itens.push({ conta: c.codigo, dc: v > 0 ? 'C' : 'D', valor: Math.abs(v) }); liq += v; }
      if (!itens.length) throw new ErroHttp(422, `Não há saldo nas contas de resultado em 31/12/${ano}.`);
      if (liq) itens.push({ conta: dest.codigo, dc: liq > 0 ? 'D' : 'C', valor: Math.abs(liq) });
      const tot = itens.filter(i => i.dc === 'D').reduce((a, i) => a + i.valor, 0), r = await tx(t => gravarLancamento(t, sess, { data: `${ano}-12-31`, historico: `Encerramento do exercício de ${ano}: apuração do resultado (${liq < 0 ? 'lucro' : 'prejuízo'} ${M.fmt(Math.abs(liq))}) transferida para ${dest.codigo} · ${dest.nome}`, origem: 'encerramento', docRef: 'ENC-' + ano, total: tot, itens: itens.map((i, k) => ({ ...i, seq: k + 1, centro: null, historico: null })) }));
      return json(201, { lancamento: (await lerLancamentos({ ids: [r.id] }))[0], resultado: M.reais(-liq) });
    }
    /* ---- relatórios e integridade ---- */
    if (r0 === 'relatorios' && met === 'GET') return json(200, await relatorio(r1, url, await lerParametros()));
    if (r0 === 'integridade' && met === 'GET') {
      const ls = await q('SELECT *, data::text AS data_txt FROM contab_lancamentos ORDER BY numero'), ps = await q('SELECT * FROM contab_partidas ORDER BY lancamento_id, seq'), por = new Map(); ps.forEach(p => (por.get(p.lancamento_id) || por.set(p.lancamento_id, []).get(p.lancamento_id)).push(p));
      let anterior = null, quebras = [], desequilibrados = []; for (const l of ls) { const it = (por.get(l.id) || []).map(p => ({ seq: p.seq, conta: p.conta, dc: p.dc, valor: Number(p.valor_centavos), centro: p.centro, historico: p.historico }));
        const h = hashDe(anterior, { id: l.id, data: l.data_txt, historico: l.historico, origem: l.origem, docRef: l.doc_ref, estornoDe: l.estorno_de, total: Number(l.total_centavos), itens: it });
        if (h !== l.hash || (l.hash_anterior || null) !== anterior) quebras.push(Number(l.numero)); const dd = it.filter(i => i.dc === 'D').reduce((a, i) => a + i.valor, 0), cc = it.filter(i => i.dc === 'C').reduce((a, i) => a + i.valor, 0); if (dd !== cc) desequilibrados.push(Number(l.numero)); anterior = l.hash; }
      return json(200, { lancamentos: ls.length, cadeiaIntegra: !quebras.length, quebras, equilibrados: !desequilibrados.length, desequilibrados });
    }
    return erro(404, 'Rota do Módulo Contábil não encontrada.');
  } catch (e) { if (e instanceof M.ErroContabil) throw new ErroHttp(e.status, e.message, e.extra); throw pgErro(e); }
});
export const config = { path: ['/api/contabil', '/api/contabil/*'] };
