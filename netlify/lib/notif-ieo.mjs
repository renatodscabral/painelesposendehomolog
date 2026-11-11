/* v14.00 · Índice de Eficiência Operacional (IEO) no servidor — para o relatório semanal por Gerente Regional.
   O motor de pontuação (IEO_PADRAO e IEO.calcular) é a CÓPIA FIEL do painel (public/index.html, módulo Retaguarda Financeira);
   o teste tests/teste-notificacoes.mjs extrai o original do painel publicado e confere, com os mesmos dados, que a pontuação,
   as zonas e a posição de cada loja saem iguais (a Central nunca pode mostrar um IEO diferente do da tela).
   As entradas do motor (faltas, divergências da Credsystem, ocorrências manuais e as deduções automáticas da Retaguarda de Loja)
   são montadas abaixo a partir das coleções do banco, com as mesmas regras de statusLinha, statusCofre, statusCredito e sitDep. */
const IEO_PADRAO = {
  pontosIniciais: 100,
  faixas: { verde: 85, vermelha: 60 },   // ≥ 85 verde · 60 a 84,99 amarela · < 60 vermelha
  prazoJustificativaDias: 3,              // falta sem justificativa após N dias → "Atraso na justificativa"
  reincidenciaMinima: 3,                  // a partir da 3ª falta do mesmo caixa no mês, vale a dedução de reincidência
  prazoCofreDias: 2,                      // v13.39: Conta Cofre — dias para a loja retornar o valor informado
  prazoCreditoHoras: 24,                  // v13.39: crédito de cliente em aberto além deste prazo pontua negativo
  tipos: [
    { id: 'falta_isolada', nome: 'Falta de caixa (numerário) isolada', pontos: -10, origem: 'faltas', ativo: true },
    { id: 'quebra_reincidente', nome: 'Quebra de caixa reincidente (3x ou mais)', pontos: -20, origem: 'faltas_reincidencia', ativo: true },
    { id: 'div_recebimentos', nome: 'Divergência de recebimentos (Cartão/Credsystem)', pontos: -5, origem: 'credsystem', ativo: true },
    { id: 'erro_pix', nome: 'Erro de lançamento ou baixa de PIX', pontos: -5, origem: 'manual', ativo: true },
    { id: 'atraso_justificativa', nome: 'Atraso na justificativa processual', pontos: -2, origem: 'faltas_atraso', ativo: true },
    /* v13.39 · Retaguarda de Loja */
    { id: 'cofre_atraso', nome: 'Conta Cofre: retorno da loja fora do prazo', pontos: -5, origem: 'cofre_atraso', ativo: true },
    { id: 'credito_cliente', nome: 'Crédito de cliente não resolvido em 24h', pontos: -5, origem: 'credito_cliente', ativo: true },
    { id: 'dvc_erro', nome: 'Devolução de valores (DVC) por erro operacional', pontos: -5, origem: 'dvc_erro', ativo: true },
    /* v13.40 · refinamento: depósitos, divergências diversas e registro de vendas */
    { id: 'deposito_prazo', nome: 'Depósitos fora do prazo', pontos: -3, origem: 'deposito_prazo', ativo: true },
    { id: 'deposito_descricao', nome: 'Lançamentos de depósito sem descrição correta', pontos: -2, origem: 'deposito_descricao', ativo: true },
    { id: 'divergencia_diversa', nome: 'Divergências diversas (parcelas, bandeira, cobrança, arredondamento, dados da venda)', pontos: -2, origem: 'divergencia', ativo: true },
    { id: 'registro_vendas', nome: 'Registro de vendas: falta de envio ao shopping', pontos: -5, origem: 'registro_vendas', ativo: true },
  ],
};
const IEO = {
  /* v13.39: matrizes já salvas recebem os tipos novos da carga inicial que ainda não tinham (os existentes ficam como estão) */
  /** v14.00: no servidor a matriz salva (config/ieo) é passada por quem chama; sem ela vale a padrão. */
  matriz(s = null) { return s && s.tipos ? { ...IEO_PADRAO, ...s, tipos: [...s.tipos, ...IEO_PADRAO.tipos.filter(p => !s.tipos.some(t => t.id === p.id))], faixas: { ...IEO_PADRAO.faixas, ...(s.faixas || {}) } } : IEO_PADRAO; },
  zona(p, m = this.matriz()) { return p >= m.faixas.verde ? 'verde' : p < m.faixas.vermelha ? 'vermelha' : 'amarela'; },
  ZONAS: { verde: { rotulo: 'Zona Verde', desc: 'Excelência / Conformidade', cls: 'ok' }, amarela: { rotulo: 'Zona Amarela', desc: 'Atenção / Monitoramento', cls: 'warn' }, vermelha: { rotulo: 'Zona Vermelha', desc: 'Estado crítico', cls: 'bad' } },

  /**
   * Motor de pontuação (função pura).
   * @param mes        'AAAA-MM'
   * @param lojas      [{id, codigo, nome, ativa}]
   * @param faltas     itens de faltas [{lojaId, data, tipo, valor, status, justificativa, caixa}]
   * @param credsystem linhas conciliadas [{lojaId, data, st, dif}]
   * @param ocorrencias lançamentos manuais [{lojaId, data, tipoId, descricao}]
   * @param extras     v13.39 · deduções automáticas da Retaguarda de Loja [{lojaId, origem, data, detalhe, ref}]
   *                   (origem = 'cofre_atraso' | 'credito_cliente' | 'dvc_erro' | v13.40: 'deposito_prazo' |
   *                   'deposito_descricao' | 'divergencia' | 'registro_vendas'; o peso vem da matriz)
   * @returns ranking [{lojaId, pontos, zona, posicao, deducoes[], resumo{tipoId:{n,pontos}}}]
   */
  calcular({ mes, lojas, faltas = [], credsystem = [], ocorrencias = [], extras = [], matriz = this.matriz(), hoje = new Date().toISOString().slice(0, 10) }) {
    const tipos = Object.fromEntries(matriz.tipos.filter(t => t.ativo !== false).map(t => [t.id, t]));
    const porOrigem = o => matriz.tipos.find(t => t.ativo !== false && t.origem === o);
    const res = {};
    lojas.forEach(l => { res[l.id] = { lojaId: l.id, codigo: l.codigo, nome: l.nome, deducoes: [] }; });
    const add = (lojaId, tipo, data, detalhe, ref, fator = 1) => { if (tipo && res[lojaId]) { const base = Number(tipo.pontos) || 0; res[lojaId].deducoes.push({ tipoId: tipo.id, nome: tipo.nome, pontos: fator === 1 ? base : Math.round(base * fator * 100) / 100, data, detalhe, ref, origem: tipo.origem, ...(fator !== 1 ? { fator, unit: base } : {}) }); } }; /* v13.93: fator 0,5 = dedução de 50% */

    // 1) Faltas de caixa: 1ª e 2ª do caixa no mês = isolada; a partir da N-ésima = reincidente. Sobras e abonadas não pontuam.
    const tIsolada = porOrigem('faltas'), tReinc = porOrigem('faltas_reincidencia'), tAtraso = porOrigem('faltas_atraso');
    const doMes = faltas.filter(f => f.data && f.data.startsWith(mes) && f.tipo !== 'Sobra' && f.status !== 'Abonada').sort((a, b) => a.data.localeCompare(b.data));
    const contagem = {};
    for (const f of doMes) {
      const k = f.lojaId + '|' + (f.caixa?.id || String(f.caixa?.nome || '').toUpperCase());
      const n = (contagem[k] = (contagem[k] || 0) + 1);
      const reinc = n >= (matriz.reincidenciaMinima || 3);
      add(f.lojaId, reinc && tReinc ? tReinc : tIsolada, f.data, `${reinc ? `${n}ª quebra do caixa` : 'Falta'} ${f.caixa?.nome || ''} · R$ ${Number(f.valor).toFixed(2).replace('.', ',')}`, f.id);
      // 2) Atraso na justificativa
      if (tAtraso && !String(f.justificativa || '').trim()) {
        const dias = Math.floor((Date.parse(hoje) - Date.parse(f.data)) / 864e5);
        if (dias > (matriz.prazoJustificativaDias ?? 3)) add(f.lojaId, tAtraso, f.data, `Falta de ${f.caixa?.nome || 'caixa'} sem justificativa há ${dias} dias`, f.id);
      }
    }
    // 3) Divergências de recebimento (Credsystem)
    const tDiv = porOrigem('credsystem');
    credsystem.filter(l => l.data && l.data.startsWith(mes) && l.st === 'div').forEach(l => add(l.lojaId, tDiv, l.data, `Divergência Credsystem de R$ ${l.dif.toFixed(2).replace('.', ',')}`, l.data));
    // 4) Ocorrências manuais (qualquer tipo da matriz)
    ocorrencias.filter(o => o.data && o.data.startsWith(mes)).forEach(o => add(o.lojaId, tipos[o.tipoId], o.data, o.descricao || '', o.id));
    // 5) v13.39 · Retaguarda de Loja: Conta Cofre fora do prazo, crédito de cliente além de 24h, DVC por erro operacional
    extras.filter(e => e.data && e.data.startsWith(mes)).forEach(e => add(e.lojaId, porOrigem(e.origem), e.data, e.detalhe || '', e.ref, e.fator ?? 1));

    const lista = Object.values(res).map(r => {
      const total = r.deducoes.reduce((a, d) => a + d.pontos, 0);
      const pontos = Math.max(0, Math.round((matriz.pontosIniciais + total) * 100) / 100);
      const resumo = {}; r.deducoes.forEach(d => { const x = resumo[d.tipoId] ||= { nome: d.nome, n: 0, pontos: 0, unit: d.unit ?? d.pontos }; x.n++; x.pontos = Math.round((x.pontos + d.pontos) * 100) / 100; });
      return { ...r, deducoes: r.deducoes.sort((a, b) => a.data.localeCompare(b.data)), pontos, zona: this.zona(pontos, matriz), resumo };
    }).sort((a, b) => b.pontos - a.pontos || a.deducoes.length - b.deducoes.length || a.codigo.localeCompare(b.codigo));
    lista.forEach((r, i) => { r.posicao = i + 1; });
    return lista;
  },
};

const r2 = v => Math.round((Number(v) || 0) * 100) / 100;
const TOLERANCIA_CREDSYSTEM = 0.05; // RETAGUARDA_CFG.toleranciaCredsystem do painel
const dataBR = iso => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '');
const brl = v => 'R$ ' + (Math.round((Number(v) || 0) * 100) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); if (isNaN(d)) return ''; d.setUTCDate(d.getUTCDate() + Number(n || 0)); return d.toISOString().slice(0, 10); };

/** Linha da conciliação Credsystem → situação (igual a Retaguarda.statusLinha). */
export function statusLinha(l) {
  const temInterno = [l.din, l.cart, l.pix, l.cartLote, l.pixLote].some(v => v != null);
  const interno = r2((l.din || 0) + (l.cart || 0) + (l.pix || 0) + (l.cartLote || 0) + (l.pixLote || 0));
  const dif = r2((l.web || 0) - interno);
  if (!temInterno && (l.web || 0) > 0) return { interno, dif, st: 'pend' };
  return { interno, dif, st: Math.abs(dif) <= TOLERANCIA_CREDSYSTEM ? 'ok' : 'div' };
}
/** Conta Cofre (igual a Retaguarda.statusCofre; para o IEO só importa "atrasado"). */
export function statusCofre(c, m, hoje) {
  if (c.origem === 'falta') return { limite: c.dataSolicitacao, retornou: !!c.baixadoEm, atrasado: false, baixada: !!c.baixadoEm };
  const limite = addDias(c.dataSolicitacao, m.prazoCofreDias ?? 2), retornou = !!c.dataRetorno;
  const atrasado = !!c.dataSolicitacao && (retornou ? c.dataRetorno > limite : hoje > limite);
  return { limite, retornou, atrasado };
}
export function statusCredito(o, m, agora) {
  const ini = Date.parse(o.aberturaEm || o.data), fim = o.resolvidoEm ? Date.parse(o.resolvidoEm) : agora;
  const horas = isNaN(ini) ? 0 : Math.max(0, (fim - ini) / 36e5), prazo = Number(m.prazoCreditoHoras ?? 24), vencido = horas > prazo;
  return { horas, prazo, vencido, resolvido: !!o.resolvidoEm };
}
export const sitDep = d => { const s = d?.situacao; if (s === 'sim' || s === 'parcial' || s === 'nao') return s; return d?.conforme === true ? 'sim' : d?.conforme === false ? 'nao' : null; };
export const FATOR_DEP = { sim: 0, parcial: 0.5, nao: 1 };

/** Deduções automáticas da Retaguarda de Loja (igual a Retaguarda.deducoesLoja). cofre/feed/dep = documentos das coleções ret_cofre, ieo_auto e ret_depositos. */
export function deducoesLoja({ cofre = [], feed = [], dep = [], matriz, hoje, agora = Date.now() }) {
  const out = [];
  for (const c of cofre) {
    const s = statusCofre(c, matriz, hoje); if (!s.atrasado) continue;
    out.push({ lojaId: c.lojaId, origem: 'cofre_atraso', data: c.dataSolicitacao, ref: c.id, detalhe: `Conta Cofre de ${dataBR(c.dataSolicitacao)}: ${s.retornou ? 'retorno em ' + dataBR(c.dataRetorno) : 'sem retorno'} (prazo ${dataBR(s.limite)})` });
  }
  for (const o of feed) {
    if (o.tipo === 'credito') { const s = statusCredito(o, matriz, agora); if (s.vencido) out.push({ lojaId: o.lojaId, origem: 'credito_cliente', data: String(o.aberturaEm || '').slice(0, 10), ref: o.id, detalhe: `Crédito de cliente de ${brl(o.valor)} ${s.resolvido ? 'resolvido após ' + Math.floor(s.horas) + 'h' : 'em aberto há ' + Math.floor(s.horas) + 'h'}` }); }
    if (o.tipo === 'dvc' && o.erroOperacional) out.push({ lojaId: o.lojaId, origem: 'dvc_erro', data: o.dataDevolucao || o.dataVenda || String(o.criadoEm || '').slice(0, 10), ref: o.id, detalhe: `DVC ${o.forma || ''} de ${brl(o.valor)} por erro operacional${o.operador ? ' · ' + (o.operador.nome || o.operador) : ''}` });
    if (o.tipo === 'divergencia') out.push({ lojaId: o.lojaId, origem: 'divergencia', data: o.data, ref: o.id, detalhe: `Divergência (${o.subtipo || '—'}) de ${brl(o.valor)}` });
    if (o.tipo === 'registro_vendas') out.push({ lojaId: o.lojaId, origem: 'registro_vendas', data: o.dataFalta, ref: o.id, detalhe: `Registro de vendas não enviado ao shopping em ${dataBR(o.dataFalta)}${o.regularizadoEm ? ' (regularizado em ' + dataBR(o.regularizadoEm) + ')' : ''}` });
  }
  for (const d of dep) {
    const sit = sitDep(d); if ((sit !== 'nao' && sit !== 'parcial') || !d.lojaId) continue;
    out.push({ lojaId: d.lojaId, origem: d.check === 'prazo' ? 'deposito_prazo' : 'deposito_descricao', data: d.periodoFim || d.periodoIni, ref: d.id, ...(sit === 'parcial' ? { fator: FATOR_DEP.parcial } : {}), detalhe: `${d.check === 'prazo' ? (sit === 'parcial' ? 'Depósitos parcialmente no prazo (50% da dedução)' : 'Depósitos fora do prazo') : 'Lançamentos de depósito sem descrição correta'} · ${dataBR(d.periodoIni)} a ${dataBR(d.periodoFim)}` });
  }
  return out;
}

/**
 * Ranking do mês: usa o fechamento congelado (ieo_fechamentos/<mês>) quando existe; senão calcula ao vivo.
 * `c` = { lojas, faltasDocs, credsystemDocs, ieoOcorrencias, cofre, feed, dep, fechamento, configIeo } — documentos já lidos do banco ({ id, ...dados }).
 */
export function rankingDoMes(mes, c, { hoje, agora = Date.now() } = {}) {
  if (c.fechamento?.ranking) return { ranking: c.fechamento.ranking, fechado: true };
  const matriz = IEO.matriz(c.configIeo);
  const lojas = (c.lojas || []).filter(l => l.ativa);
  const faltas = (c.faltasDocs || []).flatMap(d => (d.itens || []).map(i => ({ ...i, lojaId: d.lojaId, docId: d.id })));
  const credsystem = (c.credsystemDocs || []).flatMap(d => (d.linhas || []).map(l => ({ ...l, data: d.id, docId: d.id, ...statusLinha(l) })));
  const ocorrencias = (c.ieoOcorrencias || []).filter(d => d.mes === mes).flatMap(d => (d.itens || []).map(i => ({ ...i, lojaId: d.lojaId })));
  const extras = deducoesLoja({ cofre: c.cofre, feed: c.feed, dep: c.dep, matriz, hoje, agora });
  return { ranking: IEO.calcular({ mes, lojas, faltas, credsystem, ocorrencias, extras, matriz, hoje }), fechado: false };
}
export { IEO_PADRAO, IEO };
