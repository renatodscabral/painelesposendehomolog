/* v14.00 · Dados e regras de cada evento da Central de Notificações.
   Duas camadas: (1) funções PURAS que recebem os documentos já lidos e devolvem o que deve ser avisado (testáveis sem banco);
   (2) leitores do Postgres (tabela documentos, uma linha por registro do painel). As regras repetem as do painel:
     · prazo da prestação de contas = N dias úteis (seg.–sex.) depois da volta (Viagens.prazoData / atrasoPrestacao);
     · férias: período aquisitivo de 12 meses + concessivo de 12 meses (RH.ferias, CLT art. 137: depois do limite paga em dobro);
     · solicitação em aberto = sem data de atendimento; SLA em dias corridos (Solicitacoes.diasAberto);
     · IEO: cópia fiel do motor do painel (notif-ieo.mjs). */
import { q } from './db.mjs';
import { rankingDoMes, sitDep } from './notif-ieo.mjs';
import { FUSO } from './notif-catalogo.mjs';

/* ----------------------------------------------------------------- datas (sempre em Brasília) */
const SEM = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "Agora" em Brasília: { iso: 'AAAA-MM-DD', hora: 'HH:MM', min: minutos desde 00:00, dow: 0 (dom) a 6 (sáb), ms }. */
export function agoraBRT(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
  return { iso: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}`, min: Number(p.hour) * 60 + Number(p.minute), dow: SEM.indexOf(p.weekday), ms: d.getTime() };
}
const utc = iso => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, (m || 1) - 1, d || 1)); };
const isoDe = d => d.toISOString().slice(0, 10);
export const somarDias = (iso, n) => { const d = utc(iso); d.setUTCDate(d.getUTCDate() + Number(n || 0)); return isoDe(d); };
export const diasEntre = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
export const dataBR = iso => (/^\d{4}-\d{2}-\d{2}/.test(String(iso || '')) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
export const brl = v => 'R$ ' + (Math.round((Number(v) || 0) * 100) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
export const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const mesPorExtenso = mes => `${MESES[Number(mes.slice(5, 7)) - 1]} de ${mes.slice(0, 4)}`;
/** N dias úteis (seg.–sex.; feriados não contam) depois de uma data — igual a Viagens.prazoData. */
export function prazoData(volta, dias) {
  const d = volta ? utc(volta) : null; if (!d || isNaN(d) || !(dias >= 1)) return '';
  let n = 0; while (n < dias) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return isoDe(d);
}
/** Mesmas contas de Datas.addMeses/addAnos do painel (setMonth: 29/02 + 1 ano vira 01/03). */
const addMeses = (d, n) => { const r = new Date(d); r.setUTCMonth(r.getUTCMonth() + n); return r; };
const mesesEntre = (a, b) => (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) - (b.getUTCDate() < a.getUTCDate() ? 1 : 0);

/* ----------------------------------------------------------------- pessoas */
export const chaveNome = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
export const nomeConfere = (curto, completo) => { const a = chaveNome(curto).split(' ').filter(Boolean), b = new Set(chaveNome(completo).split(' ')); return a.length > 0 && a.every(t => b.has(t)) && (a.length >= 2 || chaveNome(curto) === chaveNome(completo)); };
export const contatoDe = (f, papel = '') => ({ nome: String(f?.nome || '').trim(), email: String(f?.email || '').trim().toLowerCase(), telefone: String(f?.telefone || '').trim(), papel, funcionarioId: f?.id || '' });
const ativo = f => (f.status || 'Ativo') !== 'Desligado';
const cargoDe = (f, cargos = []) => (cargos.find(c => c.id === f.cargoId)?.nome) || f.cargo || '';

/** Regional (nome no campo "Supervisor regional" da loja) → colaborador do cadastro. Prefere quem tem cargo de supervisão/regional. */
export function regionaisComContato({ lojas, funcionarios, cargos = [] }) {
  const nomes = [...new Set(lojas.filter(l => l.ativa && String(l.supervisor || '').trim()).map(l => String(l.supervisor).trim()))].sort();
  const pessoas = funcionarios.filter(ativo);
  return nomes.map(nome => {
    const cands = pessoas.filter(f => nomeConfere(nome, f.nome)), ger = cands.find(f => /SUPERVISOR|REGIONAL|COORDENADOR/.test(chaveNome(cargoDe(f, cargos)))) || cands[0] || null;
    return { regional: nome, lojas: lojas.filter(l => l.ativa !== false && String(l.supervisor || '').trim() === nome), pessoa: ger, contato: ger ? contatoDe(ger, 'regional') : null };
  });
}
/** Gerente da loja de um colaborador: o colaborador da mesma lotação com cargo "Gerente" (sem "Sub"); senão o nome gravado na loja. */
export function gerenteDaLoja(lojaId, { lojas, funcionarios, cargos = [] }) {
  if (!lojaId) return null;
  const loja = lojas.find(l => l.id === lojaId), da = funcionarios.filter(f => ativo(f) && f.lotacao === lojaId);
  const g = da.find(f => /GERENTE/.test(chaveNome(cargoDe(f, cargos))) && !/SUB/.test(chaveNome(cargoDe(f, cargos)))) || (loja?.gerente ? funcionarios.find(f => ativo(f) && nomeConfere(loja.gerente, f.nome)) : null);
  return g ? contatoDe(g, 'loja') : null;
}

/* ----------------------------------------------------------------- Adiantamentos de Viagens */
export const participantesDe = v => (v.participantes?.length ? v.participantes : [{ funcionarioId: v.funcionarioId, nome: v.nome }]);
/** Viagens "Aguardando prestação de contas" com o prazo calculado: { limite, dias (faltam; negativo = atraso), excedida, atraso }. */
export function viagensAguardando({ pedidos, parametros, funcionarios, hoje }) {
  const prazoPadrao = Number(parametros?.prazoPrestacao), pf = Number.isInteger(prazoPadrao) && prazoPadrao >= 1 ? prazoPadrao : 0;
  const porId = new Map(funcionarios.map(f => [f.id, f]));
  const out = [];
  for (const v of pedidos) {
    if (v.status !== 'aguardando_prestacao') continue;
    const pol = v.politica?.prazoDiasUteis ? v.politica : pf ? { prazoDiasUteis: pf } : null; if (!pol) continue;
    const limite = pol.prazoData || prazoData(v.volta, Number(pol.prazoDiasUteis)); if (!limite) continue;
    const dias = diasEntre(hoje, limite), pessoas = participantesDe(v).map(p => ({ ...contatoDe(porId.get(p.funcionarioId) || { nome: p.nome }, 'colaborador'), nome: porId.get(p.funcionarioId)?.nome || p.nome || '', funcionarioId: p.funcionarioId || '' }));
    out.push({ id: v.id, pessoas, nomes: pessoas.map(p => p.nome).filter(Boolean).join(', ') || v.nome || '—', rota: v.origem ? `${v.origem} ➔ ${v.destino || ''}` : (v.destino || ''), ida: v.ida || '', volta: v.volta || '', limite, dias, excedida: dias < 0, atraso: dias < 0 ? -dias : 0, adiantado: Number(v.valorPago ?? v.valor) || 0, prazoDiasUteis: Number(pol.prazoDiasUteis) });
  }
  return out;
}

/* ----------------------------------------------------------------- RH · férias */
/** Situação de férias (RH.ferias): { limite (fim do período concessivo), dias (até o limite) } — null se não há período vencendo. */
export function limiteFerias(f, hoje) {
  const a = f.admissao ? utc(f.admissao) : null; if (!a || isNaN(a)) return null;
  const h = utc(hoje), completos = Math.floor(mesesEntre(a, h) / 12), gozados = Number(f.ferias?.periodosGozados || 0), pend = Math.max(0, completos - gozados);
  if (pend === 0) return null;
  const lim = new Date(addMeses(a, (gozados + 2) * 12).getTime() - 864e5), limite = isoDe(lim);
  return { limite, dias: diasEntre(hoje, limite), pendentes: pend, gozados };
}
export function periodosFerias(f) {
  const fe = f?.ferias || {}, l = Array.isArray(fe.periodos) ? fe.periodos.filter(p => p && p.inicio && p.fim) : [];
  if (l.length) return l.map(p => ({ inicio: p.inicio, fim: p.fim })).sort((a, b) => a.inicio.localeCompare(b.inicio));
  return fe.programadaInicio && fe.programadaFim ? [{ inicio: fe.programadaInicio, fim: fe.programadaFim }] : [];
}
export function feriasDobra({ funcionarios, hoje, diasAntes = [60, 30] }) {
  const out = [];
  for (const f of funcionarios.filter(ativo)) { const l = limiteFerias(f, hoje); if (l && diasAntes.includes(l.dias)) out.push({ f, ...l }); }
  return out;
}
export function feriasComecando({ funcionarios, hoje, diasAntes = 5 }) {
  const alvo = somarDias(hoje, diasAntes), out = [];
  for (const f of funcionarios.filter(ativo)) { const p = periodosFerias(f).find(x => x.inicio === alvo); if (p) out.push({ f, periodo: p }); }
  return out;
}

/* ----------------------------------------------------------------- Solicitações */
export const SOL_ITENS = { canetas: 'Canetas Detectoras', cameras: 'Câmeras', pinpad: 'Pinpad', pos: 'POS', bobinas: 'Bobinas de Impressão', maquinas: 'Máquinas Detectoras de Notas Falsas', cartoes: 'Cartões' };
export function solicitacoesAcimaSla({ solicitacoes, lojas, hoje, slaDias = 3 }) {
  const lj = new Map(lojas.map(l => [l.id, l]));
  return solicitacoes.filter(s => !s.dataAtendimento && s.dataSolicitacao).map(s => {
    const dias = Math.max(0, diasEntre(String(s.dataSolicitacao).slice(0, 10), hoje)), l = lj.get(s.lojaId);
    const itens = Object.entries(s.itens || {}).filter(([, n]) => n).map(([k, n]) => `${SOL_ITENS[k] || k}${Number(n) > 1 ? ' (' + n + ')' : ''}`);
    return { id: s.id, lojaId: s.lojaId, loja: l ? `${l.codigo} · ${l.nome}` : (s.lojaId || '—'), regional: l?.supervisor || '', dataSolicitacao: String(s.dataSolicitacao).slice(0, 10), dias, andamento: !!s.emAndamento, itens: itens.join(', ') || (s.tipo || 'Solicitação'), solicitante: s.solicitante?.nome || '', tipo: s.tipo || '' };
  }).filter(s => s.dias > slaDias).sort((a, b) => b.dias - a.dias || a.loja.localeCompare(b.loja));
}

/* ----------------------------------------------------------------- Faltas de caixa */
export const itensFaltas = faltasDocs => faltasDocs.flatMap(d => (d.itens || []).map(i => ({ ...i, lojaId: d.lojaId, docId: d.id })));
/** Faltas (não sobras) recentes acima da tolerância: % do dinheiro do dia da loja na Conciliação Credsystem; sem base, valor mínimo. */
export function faltasAcimaTolerancia({ faltasDocs, credsystemDocs, lojas, hoje, toleranciaPct = 10, valorSemBase = 100, janelaDias = 7 }) {
  const lj = new Map(lojas.map(l => [l.id, l])), cs = new Map(credsystemDocs.map(d => [d.id, d]));
  const desde = somarDias(hoje, -janelaDias), out = [];
  for (const i of itensFaltas(faltasDocs)) {
    if (!i.data || i.data < desde || i.tipo === 'Sobra' || i.status === 'Abonada') continue;
    const valor = Math.abs(Number(i.valor) || 0); if (!(valor > 0)) continue;
    const linha = (cs.get(i.data)?.linhas || []).find(l => l.lojaId === i.lojaId), din = Number(linha?.din) || 0, temBase = din > 0, pct = temBase ? valor / din * 100 : null;
    const acima = temBase ? pct > toleranciaPct : valor >= valorSemBase;
    if (!acima) continue;
    const l = lj.get(i.lojaId);
    out.push({ id: i.id, lojaId: i.lojaId, loja: l ? `${l.codigo} · ${l.nome}` : i.lojaId, data: i.data, valor, dinheiroDia: temBase ? din : null, pct, temBase, caixa: i.caixa?.nome || '', status: i.status || 'Em análise' });
  }
  return out.sort((a, b) => b.data.localeCompare(a.data) || b.valor - a.valor);
}

/* ----------------------------------------------------------------- IEO por regional */
export function ieoPorRegional({ mes, dados, hoje }) {
  const { ranking, fechado } = rankingDoMes(mes, dados, { hoje });
  const media = ranking.reduce((a, r) => a + r.pontos, 0) / (ranking.length || 1);
  const regionais = regionaisComContato({ lojas: dados.lojas, funcionarios: dados.funcionarios, cargos: dados.cargos });
  const lojaPor = new Map(dados.lojas.map(l => [l.id, l]));
  return {
    mes, fechado, mediaRede: Math.round(media * 10) / 10, totalLojas: ranking.length,
    regionais: regionais.map(r => {
      const ids = new Set(r.lojas.map(l => l.id)), linhas = ranking.filter(x => ids.has(x.lojaId));
      const cont = { verde: 0, amarela: 0, vermelha: 0 }; linhas.forEach(x => { cont[x.zona]++; });
      const mediaR = linhas.reduce((a, x) => a + x.pontos, 0) / (linhas.length || 1);
      return { ...r, linhas: linhas.map(x => ({ ...x, loja: lojaPor.get(x.lojaId) })), cont, media: Math.round(mediaR * 10) / 10 };
    }),
  };
}

/* ----------------------------------------------------------------- Retaguarda: faltas e pendências (relatório executivo) */
export function resumoFaltas({ faltasDocs, lojas = [], ontem, mes }) {
  const lj = new Map(lojas.map(l => [l.id, l]));
  const todas = itensFaltas(faltasDocs).filter(i => i.tipo !== 'Sobra' && i.status !== 'Abonada' && i.data);
  const soma = l => Math.round(l.reduce((a, i) => a + Math.abs(Number(i.valor) || 0), 0) * 100) / 100;
  const dia = todas.filter(i => i.data === ontem), doMes = todas.filter(i => i.data.startsWith(mes));
  const itensOntem = dia.map(i => ({ loja: lj.get(i.lojaId) ? `${lj.get(i.lojaId).codigo} · ${lj.get(i.lojaId).nome}` : String(i.lojaId || '—'), caixa: i.caixa?.nome || '', valor: Math.abs(Number(i.valor) || 0), status: i.status || 'Em análise' })).sort((a, b) => b.valor - a.valor).slice(0, 10);
  return { ontem: { n: dia.length, total: soma(dia) }, mes: { n: doMes.length, total: soma(doMes) }, semJustificativa: doMes.filter(i => !String(i.justificativa || '').trim()).length, itensOntem };
}
export function pendenciasRetaguarda({ cofre = [], feed = [], dep = [], matriz, hoje, agora = Date.now() }) {
  const r = { cofreSemRetorno: 0, cofreAtrasadaDivergente: 0, creditosAbertos: 0, creditosVencidos: 0, vendasPendentes: 0, depositosNao: 0, dvcSemTermo: 0 };
  const addDias = (iso, n) => somarDias(iso, n);
  for (const c of cofre) {
    if (c.origem === 'falta') continue;
    const limite = c.dataSolicitacao ? addDias(c.dataSolicitacao, matriz.prazoCofreDias ?? 2) : '', retornou = !!c.dataRetorno;
    if (!retornou && limite && hoje > limite) r.cofreSemRetorno++;
    const temValor = c.valorInformado != null && c.valorInformado !== '';
    if (retornou && temValor && Math.abs(Number(c.valorInformado) - Number(c.valorSistema || 0)) >= 0.01) r.cofreAtrasadaDivergente++;
  }
  for (const o of feed) {
    if (o.tipo === 'dvc' && o.dataDevolucao && !o.termoAnexado) r.dvcSemTermo++;
    if (o.tipo === 'credito' && !o.resolvidoEm) { r.creditosAbertos++; const ini = Date.parse(o.aberturaEm || o.data); if (!isNaN(ini) && (agora - ini) / 36e5 > Number(matriz.prazoCreditoHoras ?? 24)) r.creditosVencidos++; }
    if (o.tipo === 'registro_vendas' && !o.regularizadoEm) r.vendasPendentes++;
  }
  r.depositosNao = dep.filter(d => ['nao', 'parcial'].includes(sitDep(d))).length;
  r.total = r.cofreSemRetorno + r.cofreAtrasadaDivergente + r.creditosAbertos + r.vendasPendentes + r.depositosNao + r.dvcSemTermo;
  return r;
}
export function divergenciasCredsystem({ credsystemDocs, dia }) {
  const d = credsystemDocs.find(x => x.id === dia); if (!d) return { temDia: false, n: 0, abs: 0 };
  let n = 0, abs = 0; for (const l of d.linhas || []) { const interno = Math.round(((l.din || 0) + (l.cart || 0) + (l.pix || 0) + (l.cartLote || 0) + (l.pixLote || 0)) * 100) / 100, dif = Math.round(((l.web || 0) - interno) * 100) / 100, tem = [l.din, l.cart, l.pix, l.cartLote, l.pixLote].some(v => v != null); if (tem && Math.abs(dif) > 0.05) { n++; abs += Math.abs(dif); } }
  return { temDia: true, n, abs: Math.round(abs * 100) / 100 };
}

/* ----------------------------------------------------------------- leitores do banco */
export async function colecao(nome) { return (await q('SELECT doc_id, dados FROM documentos WHERE colecao = $1', [nome])).map(r => ({ id: r.doc_id, ...r.dados })); }
export async function colecaoPorIds(nome, ids) { return (await q('SELECT doc_id, dados FROM documentos WHERE colecao = $1 AND doc_id = ANY($2::text[])', [nome, ids])).map(r => ({ id: r.doc_id, ...r.dados })); }
export async function documento(caminho) { const [r] = await q('SELECT doc_id, dados FROM documentos WHERE caminho = $1', [caminho]); return r ? { id: r.doc_id, ...r.dados } : null; }
export async function lerFuncionarios() { return colecao('funcionarios'); }
export async function lerLojas() { return colecao('lojas'); }
export async function lerCargos() { try { return await colecao('rh_cargos'); } catch { return []; } }
/** Tudo o que o IEO precisa, menos o fechamento do mês (lido à parte por mês com lerFechamentoIeo). */
export async function lerBaseIeo() {
  const [lojas, funcionarios, cargos, faltasDocs, credsystemDocs, ieoOcorrencias, cofre, feed, dep, cfg] = await Promise.all([
    lerLojas(), lerFuncionarios(), lerCargos(), colecao('faltas'), colecao('credsystem'), colecao('ieo_ocorrencias'), colecao('ret_cofre'), colecao('ieo_auto'), colecao('ret_depositos'), documento('config/ieo'),
  ]);
  const { id: _i, ...configIeo } = cfg || {};
  return { lojas, funcionarios, cargos, faltasDocs, credsystemDocs, ieoOcorrencias, cofre, feed, dep, configIeo: cfg ? configIeo : null };
}
export const lerFechamentoIeo = mes => documento('ieo_fechamentos/' + mes);
export async function ultimoBackupAutomatico() {
  const [r] = await q(`SELECT id, data_hora, total_registros, tamanho_bytes, tipo_backup FROM painel_backups_historico WHERE tipo_backup = 'AUTOMATICO' AND NOT preventivo ORDER BY data_hora DESC, id DESC LIMIT 1`);
  return r || null;
}
export async function lerInstantaneo(chave) { const [r] = await q('SELECT chave, dados, gerado_em, gerado_por FROM painel_notificacoes_instantaneo WHERE chave = $1', [chave]); return r || null; }
export async function ultimoInstantaneoRecebivel() { const [r] = await q(`SELECT chave, dados, gerado_em FROM painel_notificacoes_instantaneo WHERE chave LIKE 'recebivel:%' ORDER BY chave DESC LIMIT 1`); return r || null; }

/* ----------------------------------------------------------------- snapshot do Resumo do Recebível (publicado pelo painel) */
const numero = v => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.round(Number(v) * 100) / 100 : null);
const texto = (v, n = 80) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const dia = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
/** O que o painel publica → o que o relatório executivo aceita (só números e textos curtos; qualquer outra coisa é descartada). */
export function sanearSnapshotRecebivel(e) {
  if (!e || typeof e !== 'object' || !dia(e.d)) return null;
  const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
  return {
    d: e.d, ant: dia(e.ant), em: /^\d{4}-\d{2}-\d{2}T/.test(String(e.em || '')) ? String(e.em).slice(0, 30) : new Date().toISOString(), informado: !!e.informado,
    entradas: numero(e.entradas) ?? 0, saidas: numero(e.saidas), saldo: numero(e.saldo), nSaidas: Math.max(0, Math.trunc(Number(e.nSaidas) || 0)),
    meios: arr(e.meios, 6).map(m => ({ rot: texto(m?.rot, 40), vendas: numero(m?.vendas), prestacao: numero(m?.prestacao), total: numero(m?.total) ?? 0 })),
    adquirentes: arr(e.adquirentes, 24).map(m => ({ rot: texto(m?.rot, 40), deb: numero(m?.deb), cre: numero(m?.cre), total: numero(m?.total) ?? 0 })),
    porConta: arr(e.porConta, 8).map(m => ({ rot: texto(Array.isArray(m) ? m[0] : m?.rot, 60), valor: numero(Array.isArray(m) ? m[1] : m?.valor) ?? 0, n: Math.max(0, Math.trunc(Number(Array.isArray(m) ? m[2] : m?.n) || 0)) })),
    carga: e.carga && typeof e.carga === 'object' ? { ok: !!e.carga.ok, dia: dia(e.carga.dia), arquivo: texto(e.carga.arquivo, 80) } : null,
    avisos: arr(e.avisos, 8).map(a => texto(a, 220)).filter(Boolean),
  };
}
export async function gravarInstantaneo(chave, dados, por = '') {
  const [r] = await q(`INSERT INTO painel_notificacoes_instantaneo (chave, dados, gerado_em, gerado_por) VALUES ($1, $2::jsonb, now(), $3)
    ON CONFLICT (chave) DO UPDATE SET dados = EXCLUDED.dados, gerado_em = now(), gerado_por = EXCLUDED.gerado_por RETURNING chave, gerado_em`, [chave, JSON.stringify(dados), String(por || '').slice(0, 80) || null]);
  await q(`DELETE FROM painel_notificacoes_instantaneo WHERE chave LIKE 'recebivel:%' AND chave < $1`, ['recebivel:' + somarDias(dia(dados.d) || agoraBRT().iso, -30)]);
  return r;
}
