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
   GET    /api/contabil/integridade                   → confere a cadeia de hashes e o equilíbrio de todos os lançamentos */
import { createHash, randomUUID } from 'node:crypto';
import { q, tx } from '../lib/db.mjs';
import { json, erro, rota, ErroHttp } from '../lib/http.mjs';
import { sessaoDe } from '../lib/sessao.mjs';
import { NIVEL } from '../lib/regras.mjs';
import * as M from '../lib/contabil-motor.mjs';

/* ---------------------------------------------------------------- acesso */
/* Master: tudo. Operacional: linha "Contabilidade" da Gestão de Acessos (Ler = ver; Modificar = lançar e plano;
   Excluir = estornar, encerrar e parâmetros), com as sub-permissões de ações (permissoes.sub.contabil.acoes). Loja: nada. */
const ACOES = { ler: ['contabil.ver'], modificar: ['contabil.lancar', 'contabil.plano'], excluir: ['contabil.estornar', 'contabil.parametros'] };
export function permissoesContabil(sess) {
  if (!sess || sess.trocaPendente) return new Set();
  if (sess.nivel >= NIVEL.admin) return new Set(Object.values(ACOES).flat());
  if (sess.perfil !== 'OPERACIONAL') return new Set();
  const p = sess.usuario?.permissoes || {}, n = ['', 'ler', 'modificar', 'excluir'].indexOf(p.contabil || ''), sub = p.sub?.contabil?.acoes, out = new Set();
  ['ler', 'modificar', 'excluir'].forEach((k, i) => { if (n > i) ACOES[k].forEach(a => { if (k === 'ler' || !sub || sub.includes(a)) out.add(a); }); });
  return out;
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

/* ---------------------------------------------------------------- rota */
async function corpo(req) { const t = await req.text(); if (t.length > 2 * 1024 * 1024) throw new ErroHttp(413, 'Requisição grande demais.'); try { return t ? JSON.parse(t) : {}; } catch { throw new ErroHttp(400, 'Corpo inválido.'); } }
const pgErro = e => { const m = String(e?.message || ''); if (e?.code === 'P0001' || m.startsWith('CONTAB:')) return new ErroHttp(422, m.replace(/^CONTAB:\s*/, '')); if (e?.code === '23505') return new ErroHttp(409, /estorno_de/.test(m + (e.constraint || '')) ? 'Este lançamento já foi estornado.' : 'Registro duplicado (código ou nome já existe nesta conta-mãe).'); if (e?.code === '23503') return new ErroHttp(409, 'A conta está em uso (lançamentos ou contas filhas) — inative em vez de excluir.'); if (e?.code === '23514') return new ErroHttp(422, 'Dados fora das regras do plano de contas (' + (e.constraint || 'verificação') + ').'); return e; };

export default rota(async req => {
  const url = new URL(req.url), sess = await sessaoDe(req); if (!sess) return erro(401, 'Sessão encerrada. Faça login de novo.');
  const perms = permissoesContabil(sess); exigir(perms, 'contabil.ver');
  const partes = url.pathname.replace(/\/+$/, '').split('/').slice(3), [r0, r1] = partes, met = req.method;
  try {
    if (!r0 && met === 'GET') { const [n] = await q('SELECT count(*)::int AS n, count(*) FILTER (WHERE tipo = \'A\')::int AS a FROM contab_contas'), [l] = await q('SELECT count(*)::int AS n, max(data)::text AS ultima FROM contab_lancamentos'); return json(200, { plano: { contas: n.n, analiticas: n.a, criado: n.n > 0 }, lancamentos: { total: l.n, ultimaData: l.ultima || null }, parametros: await lerParametros(), permissoes: [...perms] }); }

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
