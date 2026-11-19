/* v14.03 · Balanced Scorecard (BSC) & Farol Estratégico — motor de cálculo, Farol, Liquidez (FCX), filtros, permissões e laudo.
   Valida o CÓDIGO REAL do painel (public/index.html, bloco BSC_MOTOR) num contexto isolado do Node, sem navegador e sem banco:
   as fontes de dados (FCX, Auditoria de Adquirentes, Credsystem, IEO, PDI, folha…) são simuladas com números FICTÍCIOS (LGPD).
   Também confere a matriz de permissões do SERVIDOR (flag bsc_visualizar) com netlify/lib/permissoes.mjs e matriz-acessos.mjs.
   Uso: node tests/teste-bsc-1403.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(raiz, 'public/index.html'), 'utf8');
const OK = [], FAIL = [];
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x !== '' ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 600) : '')); };

/* ---------- extrai o motor real ---------- */
const a = html.indexOf('/* BSC_MOTOR:INI */'), b = html.indexOf('/* BSC_MOTOR:FIM */');
if (a < 0 || b < 0) throw new Error('bloco BSC_MOTOR não encontrado em public/index.html');
const M = new Function(html.slice(a, b) + '\nreturn BSC_MOTOR;')();

/* ---------- massa fictícia ---------- */
const LOJAS = [
  { id: 'loja-005', codigo: '05', nome: 'CAMARAGIBE', bandeira: 'ESPOSENDE', supervisor: 'ANA REGIONAL' },
  { id: 'loja-006', codigo: '06', nome: 'BOA VIAGEM', bandeira: 'ESPOSENDE', supervisor: 'ANA REGIONAL' },
  { id: 'loja-007', codigo: '07', nome: 'ES SPORTS ARCO', bandeira: 'ESPOSENDE SPORTS', supervisor: 'BRUNO REGIONAL' },
];
const FAT = { 'loja-005': 100000, 'loja-006': 90000, 'loja-007': 50000 }, META = { 'loja-005': 100000, 'loja-006': 100000, 'loja-007': 100000 };
const MES = '2026-11';
/** Fonte simulada. `chamadas` registra quem foi consultado (para provar que o que é restrito nem é lido). */
const fonte = (alt = {}, chamadas = []) => {
  const f = {
    liquidez: () => ({ saldo: 10000, entradas: 80000, saidas: 60000, saldoOrigem: 'informado' }),
    pe: (mes, ids) => ({ receita: [...ids].reduce((s, i) => s + (FAT[i] || 0), 0), meta: 300000, pe: 200000, mcValor: 90000, mcPct: 37.5, fixos: 70000, lojas: ids.size, lojasTotal: ids.size }),
    ocupacao: () => ({ minimo: 10000, final: 12000, vendas: 240000, acima: 1, contratos: 3 }),
    vazamento: () => ({ divergencia: 300, bruto: 100000 }),
    vendas: (mes, ids) => {
      const acc = { realizado: 0, meta: 0, lojasComDado: 0, lojasTotal: ids.size, porSegmento: { esposende: { real: 0, meta: 0 }, essports: { real: 0, meta: 0 } } };
      for (const l of LOJAS.filter(x => ids.has(x.id))) { const s = acc.porSegmento[M.segmentoDe(l)]; acc.realizado += FAT[l.id]; acc.meta += META[l.id]; acc.lojasComDado++; s.real += FAT[l.id]; s.meta += META[l.id]; }
      return acc;
    },
    credsystem: () => ({ emissao: 100, ativacao: 80, metaAtivacaoPct: 75, metaEmissao: 120 }),
    ticketMix: () => null,
    ieo: () => ({ itens: [{ pontos: 95, zona: 'verde' }, { pontos: 75, zona: 'amarela' }], fechado: false }),
    conciliacao: () => ({ lancadas: 3, divergencias: 3, tratadas: 1, valorAberto: 500 }),
    radar: () => ({ total: 4, verde: 3, amarela: 1, vermelha: 0 }),
    pdi: () => ({ avaliados: 2, nota: 3.5, meta: 4, candidatos: 2, aptos: 1 }),
    folha: () => ({ folha: 6000, pessoas: 3 }),
    ...alt,
  };
  return Object.fromEntries(Object.entries(f).map(([k, fn]) => [k, (...x) => { chamadas.push(k); return fn(...x); }]));
};
const ctxBase = (alt = {}) => ({ lojas: LOJAS, pode: () => true, verSalarios: true, ehLoja: false, alcanceParcial: false, rotSeg: s => s === 'essports' ? 'ES Sports' : s === 'esposende' ? 'Esposende Tradicional' : 'Todas', ...alt });
const F = (alt = {}) => ({ escopo: 'rede', regional: '', lojaId: '', seg: 'todas', mes: MES, ...alt });
const por = (res, id) => res.indicadores.find(x => x.id === id);

/* ---------- 1 · regras do Farol ---------- */
const g = v => M.farolGeral(v);
chk('Farol geral: ≥ 85% Verde · 70–84,9% Amarelo · < 70% Vermelho (limites exatos)', g(85) === 'verde' && g(100) === 'verde' && g(84.9) === 'amarelo' && g(70) === 'amarelo' && g(69.9) === 'vermelho' && g(0) === 'vermelho', [g(85), g(84.9), g(70), g(69.9)]);
chk('Farol geral: comparado com 1 casa (84,96% → 85,0 Verde; 69,96% → 70,0 Amarelo) e sem número = cinza', g(84.96) === 'verde' && g(69.96) === 'amarelo' && g(null) === 'semdados' && g(NaN) === 'semdados' && g(undefined) === 'semdados', '');
chk('Farol do IEO (base 100): ≥ 85 Verde · 60–84,9 Amarelo · < 60 Vermelho', M.farolIEO(85) === 'verde' && M.farolIEO(84.9) === 'amarelo' && M.farolIEO(60) === 'amarelo' && M.farolIEO(59.9) === 'vermelho' && M.farolIEO(null) === 'semdados', '');
const L = v => M.farolLiquidez(v);
chk('Farol da Liquidez: Verde ≥ 1,15 (folga de 15%) · Amarelo 1,00–1,14 · Vermelho < 1,00', L(1.15) === 'verde' && L(1.5) === 'verde' && L(1.14) === 'amarelo' && L(1.0) === 'amarelo' && L(0.99) === 'vermelho' && L(0) === 'vermelho', [L(1.15), L(1.14), L(1.0), L(0.99)]);
chk('Farol da Liquidez: o índice é TRUNCADO em 2 casas (1,149 → "1,14" Amarelo · 0,999 → "0,99" Vermelho/déficit) — nunca superestima a cobertura', L(1.149) === 'amarelo' && L(0.999) === 'vermelho' && M.fmt('indice', 1.149) === '1,14' && M.fmt('indice', 0.999) === '0,99', [M.fmt('indice', 1.149), M.fmt('indice', 0.999)]);
chk('Farol da Liquidez: sem saídas previstas (∞) é Verde; sem base é cinza', L(Infinity) === 'verde' && L(null) === 'semdados' && M.fmt('indice', Infinity) === '∞', '');
chk('atingimento: "maior é melhor" = realizado ÷ meta; "menor é melhor" (custo/perda) = meta ÷ realizado, e ≤ meta vale 100%', M.atingimento(80, 100) === 80 && M.atingimento(0.3, 0.5, 'menor') === 100 && M.atingimento(1, 0.5, 'menor') === 50 && M.atingimento(5, 0) === null && M.atingimento(null, 10) === null, '');
chk('variância: (realizado − meta) ÷ |meta|; sem meta = nulo; formato pt-BR com sinal', M.variancia(80, 100) === -20 && M.variancia(120, 100) === 20 && M.variancia(1, 0) === null && M.fmtVar(-20) === '−20,0%' && M.fmtVar(5.04) === '+5,0%', [M.fmtVar(-20), M.fmtVar(5.04)]);

/* ---------- 2 · Liquidez & Cobertura de Caixa (FCX) ---------- */
const q = M.liquidez({ saldo: 10000, entradas: 80000, saidas: 60000 });
chk('Liquidez: Saldo Líquido Projetado = Saldo + Entradas − Saídas (10.000 + 80.000 − 60.000 = 30.000) e Índice = (Saldo + Entradas) ÷ Saídas = 1,50 → Verde', q.saldoLiquido === 30000 && q.base === 90000 && q.indice === 1.5 && q.status === 'verde' && q.deficit === 0, q);
const q2 = M.liquidez({ saldo: 0, entradas: 40000, saidas: 50000 });
chk('Liquidez: déficit projetado (0 + 40.000 − 50.000): líquido −10.000, índice 0,80, Vermelho, déficit 10.000', q2.saldoLiquido === -10000 && q2.indice === 0.8 && q2.status === 'vermelho' && q2.deficit === 10000, q2);
chk('Liquidez: exatamente 1,15 (50.000 de saldo + entradas ÷ 43.478,26…) e o limite 1,00 (saldo + entradas = saídas) → Amarelo com líquido zero', M.liquidez({ saldo: 0, entradas: 57500, saidas: 50000 }).status === 'verde' && M.liquidez({ saldo: 0, entradas: 50000, saidas: 50000 }).status === 'amarelo' && M.liquidez({ saldo: 0, entradas: 50000, saidas: 50000 }).saldoLiquido === 0, '');
chk('Liquidez: sem saídas previstas e com base positiva → índice infinito (Verde); sem entradas nem saídas → sem base', M.liquidez({ saldo: 5000, entradas: 1000, saidas: 0 }).indice === Infinity && M.liquidez({ saldo: 5000, entradas: 1000, saidas: 0 }).status === 'verde' && M.liquidez({ saldo: 5000, entradas: 0, saidas: 0 }) === null && M.liquidez(null) === null, '');
const r0 = M.montar(F(), ctxBase(), fonte());
const liq = por(r0, 'liquidez');
chk('Liquidez no scorecard: meta 1,15, realizado 1,50, Verde; detalhe traz o Saldo Líquido Projetado em R$', liq.status === 'verde' && liq.meta === 1.15 && liq.real === 1.5 && liq.detalhe.some(d => /Saldo Líquido Projetado: R\$\s?30\.000,00/.test(d)), liq);
const rDef = M.montar(F(), ctxBase(), fonte({ liquidez: () => ({ saldo: 0, entradas: 40000, saidas: 50000 }) }));
chk('Liquidez em déficit: Vermelho no scorecard e o Laudo traz o ALERTA DE LIQUIDEZ com o déficit', por(rDef, 'liquidez').status === 'vermelho' && M.laudo(rDef).alertas.some(t => /ALERTA DE LIQUIDEZ/.test(t) && /10\.000,00/.test(t)) && M.laudo(rDef).gargalos.some(x => x.id === 'liquidez'), M.laudo(rDef).alertas);
const rAm = M.montar(F(), ctxBase(), fonte({ liquidez: () => ({ saldo: 0, entradas: 57000, saidas: 50000 }) }));
chk('Liquidez Amarela (1,14): o Laudo traz "ATENÇÃO À LIQUIDEZ" (folga abaixo de 15%)', por(rAm, 'liquidez').status === 'amarelo' && M.laudo(rAm).alertas.some(t => /ATENÇÃO À LIQUIDEZ/.test(t)), M.laudo(rAm).alertas);

/* ---------- 3 · os 13 indicadores, em 4 perspectivas ---------- */
chk('estrutura: 13 indicadores distribuídos em 4 perspectivas (4 + 3 + 3 + 3)', r0.indicadores.length === 13 && ['fin', 'cli', 'proc', 'pes'].map(p => r0.porPerspectiva[p].indicadores.length).join() === '4,3,3,3', Object.values(r0.porPerspectiva).map(p => p.indicadores.length));
chk('Perspectiva Financeira: liquidez, margem/PE, ocupação e vazamento (nessa ordem)', r0.porPerspectiva.fin.indicadores.map(x => x.id).join() === 'liquidez,margem_pe,ocupacao,vazamento', '');
chk('Cada indicador entrega Meta/Previsto, Realizado, Variância (%) e Farol quando há base', ['liquidez', 'margem_pe', 'ocupacao', 'vazamento', 'meta_vendas', 'ativacao', 'ieo', 'conciliacao', 'radar', 'pdi_nota', 'pdi_prontidao', 'produtividade'].every(id => { const x = por(r0, id); return x.meta != null && x.real != null && x.variancia != null && ['verde', 'amarelo', 'vermelho'].includes(x.status); }), r0.indicadores.map(x => x.id + ':' + x.status));
chk('Vazamento financeiro: 300 ÷ 100.000 = 0,3% (meta ≤ 0,5%, menor é melhor) → Verde; 0,6% → Amarelo (atingimento 83,3%); 1,0% → Vermelho (50%)', por(r0, 'vazamento').real.toFixed(2) === '0.30' && por(r0, 'vazamento').status === 'verde'
  && por(M.montar(F(), ctxBase(), fonte({ vazamento: () => ({ divergencia: 600, bruto: 100000 }) })), 'vazamento').status === 'amarelo' && por(M.montar(F(), ctxBase(), fonte({ vazamento: () => ({ divergencia: 1000, bruto: 100000 }) })), 'vazamento').status === 'vermelho', '');
chk('Custo de Ocupação: meta = aluguel fixo (10.000), realizado = o maior entre fixo e % (12.000), menor é melhor → atingimento 83,3% → Amarelo', por(r0, 'ocupacao').meta === 10000 && por(r0, 'ocupacao').real === 12000 && Math.round(por(r0, 'ocupacao').atingimento * 10) / 10 === 83.3 && por(r0, 'ocupacao').status === 'amarelo', por(r0, 'ocupacao'));
const mv = por(r0, 'meta_vendas');
chk('Meta de Vendas: 240.000 ÷ 300.000 = 80% → Amarelo, variância −20,0% e linhas por segmento (Esposende 95% Verde · ES Sports 50% Vermelho)', mv.status === 'amarelo' && mv.atingimento === 80 && mv.variancia === -20 && mv.sub.length === 2 && mv.sub[0].status === 'verde' && mv.sub[0].rot === 'Esposende Tradicional' && mv.sub[1].status === 'vermelho' && mv.sub[1].rot === 'ES Sports', mv.sub);
chk('Ativação Credsystem: 80 ativados de 100 emitidos = 80% vs meta de 75% → Verde, com a penetração (100 de 120 = 83,3%)', por(r0, 'ativacao').real === 80 && por(r0, 'ativacao').meta === 75 && por(r0, 'ativacao').status === 'verde' && por(r0, 'ativacao').detalhe.some(d => /Penetração.*83,3%/.test(d)), por(r0, 'ativacao').detalhe);
chk('IEO: média simples dos pontos das lojas (95 e 75 = 85,0) → Verde (regra própria do IEO, base 100)', por(r0, 'ieo').real === 85 && por(r0, 'ieo').status === 'verde' && por(M.montar(F(), ctxBase(), fonte({ ieo: () => ({ itens: [{ pontos: 59, zona: 'vermelha' }] }) })), 'ieo').status === 'vermelho', '');
chk('Conciliação: 1 de 3 divergências tratadas = 33,3% → Vermelho; tudo tratado = 100% Verde; sem divergência = 100%', Math.round(por(r0, 'conciliacao').real * 10) / 10 === 33.3 && por(r0, 'conciliacao').status === 'vermelho'
  && por(M.montar(F(), ctxBase(), fonte({ conciliacao: () => ({ lancadas: 3, divergencias: 3, tratadas: 3 }) })), 'conciliacao').status === 'verde' && por(M.montar(F(), ctxBase(), fonte({ conciliacao: () => ({ lancadas: 5, divergencias: 0, tratadas: 0 }) })), 'conciliacao').real === 100, '');
chk('Radar de Contratos: 3 de 4 na Zona Verde (> 12 meses) = 75% → Amarelo', por(r0, 'radar').real === 75 && por(r0, 'radar').status === 'amarelo', por(r0, 'radar'));
chk('PDI: nota média 3,50 ÷ 4,00 = 87,5% → Verde; prontidão 1 de 2 = 50% vs 70% → atingimento 71,4% → Amarelo', por(r0, 'pdi_nota').status === 'verde' && por(r0, 'pdi_nota').real === 3.5 && por(r0, 'pdi_prontidao').real === 50 && por(r0, 'pdi_prontidao').status === 'amarelo', '');
chk('Produtividade da Folha (com "Pode ver salários"): vendas ÷ folha = 240.000 ÷ 6.000 = R$ 40,00 vs meta 300.000 ÷ 6.000 = R$ 50,00 → 80% Amarelo, com os valores de folha', por(r0, 'produtividade').real === 40 && por(r0, 'produtividade').meta === 50 && por(r0, 'produtividade').status === 'amarelo' && por(r0, 'produtividade').detalhe.some(d => /Folha R\$\s?6\.000,00/.test(d)), por(r0, 'produtividade'));
chk('Margem/PE: realizado 240.000 ÷ meta 300.000 → 80% Amarelo', por(r0, 'margem_pe').status === 'amarelo' && Math.round(por(r0, 'margem_pe').atingimento) === 80, por(r0, 'margem_pe'));
chk('resumo do scorecard: as contagens por farol batem com os 13 indicadores (verde + amarelo + vermelho + cinza + sem acesso + consolidado = 13)', (() => { const k = r0.resumo, c = s => r0.indicadores.filter(x => x.status === s).length; return k.total === 13 && k.verde === c('verde') && k.amarelo === c('amarelo') && k.vermelho === c('vermelho') && k.semdados === c('semdados') && k.verde + k.amarelo + k.vermelho + k.semdados + k.restrito + k.consolidado === 13; })(), r0.resumo);

/* ---------- 4 · "Sem dados no período" sem quebrar o cálculo dos demais ---------- */
chk('Ticket Médio/Mix sem carga do ERP: "Sem dados no período" (cinza) com o motivo e os demais indicadores seguem calculados', por(r0, 'ticket_mix').status === 'semdados' && /ERP/.test(por(r0, 'ticket_mix').motivo) && M.STATUS.semdados.rot === 'Sem dados no período' && por(r0, 'liquidez').status === 'verde', por(r0, 'ticket_mix'));
const rSem = M.montar(F(), ctxBase(), fonte({ liquidez: () => null, vazamento: () => ({ vazio: true, motivo: 'Auditoria não processada' }), credsystem: () => ({ vazio: true }), radar: () => ({ vazio: true }), pdi: () => ({ vazio: true }), conciliacao: () => null }));
chk('vários indicadores sem base: ficam cinza e NENHUM dos demais muda (meta de vendas, IEO e produtividade iguais ao cenário completo)', ['liquidez', 'vazamento', 'ativacao', 'radar', 'pdi_nota', 'pdi_prontidao', 'conciliacao'].every(id => por(rSem, id).status === 'semdados')
  && ['meta_vendas', 'ieo', 'produtividade', 'ocupacao'].every(id => por(rSem, id).status === por(r0, id).status && por(rSem, id).real === por(r0, id).real), rSem.indicadores.map(x => x.id + ':' + x.status));
const rErr = M.montar(F(), ctxBase(), fonte({ ocupacao: () => { throw new Error('falha de leitura'); } }));
chk('uma fonte que dá erro vira "Sem dados" daquele indicador, sem derrubar o scorecard', por(rErr, 'ocupacao').status === 'semdados' && /falha de leitura/.test(por(rErr, 'ocupacao').motivo) && por(rErr, 'liquidez').status === 'verde', por(rErr, 'ocupacao'));
const rSemMes = M.montar(F({ mes: '' }), ctxBase(), fonte());
chk('sem mês de referência válido: todos "Sem dados" (nenhuma exceção)', rSemMes.indicadores.every(x => x.status === 'semdados') && M.montar(F({ mes: '2026-13' }), ctxBase(), fonte()).indicadores.every(x => x.status === 'semdados'), '');
const rVazioTudo = M.montar(F(), ctxBase(), Object.fromEntries(['liquidez', 'pe', 'ocupacao', 'vazamento', 'vendas', 'credsystem', 'ticketMix', 'ieo', 'conciliacao', 'radar', 'pdi', 'folha'].map(k => [k, () => null])));
chk('nenhuma base lançada: 13 indicadores cinza, laudo "SEM BASE SUFICIENTE" e cartão da Home neutro', rVazioTudo.resumo.semdados === 13 && M.laudo(rVazioTudo).geral === 'SEM BASE SUFICIENTE' && M.cartaoHome(rVazioTudo).estado === 'info', M.laudo(rVazioTudo).geral);

/* ---------- 5 · filtros: escopo, regional, loja e segmento ---------- */
const reg = M.montar(F({ escopo: 'regional', regional: 'ana regional' }), ctxBase(), fonte());
chk('Regional (Supervisor): só as lojas da regional (05 e 06 → 190.000 de 200.000 = 95% Verde); a liquidez vira "consolidado da Tesouraria"', por(reg, 'meta_vendas').real === 190000 && por(reg, 'meta_vendas').status === 'verde' && por(reg, 'liquidez').status === 'consolidado' && /Tesouraria/.test(por(reg, 'liquidez').motivo) && reg.escopo.nLojas === 2 && /Regional · ana regional/.test(reg.escopo.rotulo), reg.escopo);
const lj = M.montar(F({ escopo: 'loja', lojaId: 'loja-006' }), ctxBase(), fonte());
chk('Loja individual: 90.000 ÷ 100.000 = 90% Verde; liquidez sinalizada como consolidado da Tesouraria (não mistura saldo da rede com a filial)', por(lj, 'meta_vendas').real === 90000 && por(lj, 'meta_vendas').status === 'verde' && por(lj, 'liquidez').status === 'consolidado' && /Loja 06 · BOA VIAGEM/.test(lj.escopo.rotulo), lj.escopo);
const sp = M.montar(F({ seg: 'essports' }), ctxBase(), fonte());
chk('Segmento ES Sports: 50.000 ÷ 100.000 = 50% Vermelho, sem linhas de segmento e liquidez consolidada; o laudo cita o segmento', por(sp, 'meta_vendas').real === 50000 && por(sp, 'meta_vendas').status === 'vermelho' && por(sp, 'meta_vendas').sub.length === 0 && por(sp, 'liquidez').status === 'consolidado' && sp.escopo.segRotulo === 'ES Sports' && /ES Sports/.test(M.laudo(sp).abertura), sp.escopo);
const es = M.montar(F({ seg: 'esposende' }), ctxBase(), fonte());
chk('Segmento Esposende Tradicional: 190.000 ÷ 200.000 = 95% Verde', por(es, 'meta_vendas').real === 190000 && por(es, 'meta_vendas').status === 'verde', '');
const semSports = M.montar(F({ seg: 'essports' }), ctxBase({ lojas: LOJAS.slice(0, 2) }), fonte());
chk('empresa sem loja do segmento Sports (ou sem segmentação): o filtro de segmento é ignorado ("Todas") e a liquidez da rede continua calculada', semSports.escopo.seg === 'todas' && semSports.escopo.nLojas === 2 && por(semSports, 'liquidez').status === 'verde', semSports.escopo);
const vz = M.montar(F({ escopo: 'regional', regional: 'INEXISTENTE' }), ctxBase(), fonte());
chk('recorte sem lojas (regional inexistente): indicadores "Sem dados" com o motivo, sem erro', por(vz, 'meta_vendas').status === 'semdados' && /Nenhuma loja/.test(por(vz, 'meta_vendas').motivo), por(vz, 'meta_vendas'));
const parc = M.montar(F(), ctxBase({ alcanceParcial: true, lojas: LOJAS.slice(0, 2) }), fonte());
chk('gerente de regional/área (alcance parcial) na "rede": a liquidez NÃO é mostrada como se fosse da rede toda e o rótulo diz "suas lojas"', por(parc, 'liquidez').status === 'consolidado' && /suas lojas/.test(parc.escopo.rotulo), parc.escopo);

/* ---------- 6 · perfil Loja: só o farol da própria filial ---------- */
const ch6 = [], ctxLoja = ctxBase({ ehLoja: true, lojas: [LOJAS[0]] });
const rl = M.montar(F({ escopo: 'rede', lojaId: 'loja-006' }), ctxLoja, fonte({}, ch6));
chk('perfil Loja: mesmo pedindo "Rede" ou outra loja, o escopo é forçado à própria filial (05)', rl.filtros.escopo === 'loja' && rl.filtros.lojaId === 'loja-005' && rl.escopo.nLojas === 1 && /Loja 05/.test(rl.escopo.rotulo), rl.filtros);
chk('perfil Loja: a liquidez e o consolidado financeiro da rede ficam "Sem acesso" e o FCX nem é consultado', por(rl, 'liquidez').status === 'restrito' && !ch6.includes('liquidez') && por(rl, 'liquidez').real == null && por(rl, 'liquidez').detalhe.length === 0, ch6);
chk('perfil Loja: as demais bases só recebem a própria filial (nunca a rede)', (() => { const chamadas = []; const f = fonte({ vendas: (m, ids) => { chamadas.push([...ids].join()); return { realizado: 100000, meta: 100000, lojasComDado: 1, lojasTotal: 1, porSegmento: {} }; } }); M.montar(F({ escopo: 'rede' }), ctxLoja, f); return chamadas.length > 0 && chamadas.every(c => c === 'loja-005'); })(), '');
chk('perfil Loja com 1 loja e filtro de segmento Sports: o segmento não amplia o escopo da filial', M.montar(F({ seg: 'essports' }), ctxLoja, fonte()).escopo.nLojas === 1, '');

/* ---------- 7 · permissões por indicador (mesma matriz da v14.02) ---------- */
const exigencias = M.DEF.filter(d => (d.requer || []).length);
chk('toda base exige a permissão do módulo de origem (FCX, PE, Contratos, Adquirentes, Credsystem, IEO, Retaguarda, PDI; a Produtividade exige o faturamento do PE); só o Ticket/Mix não tem exigência de módulo', exigencias.length === 12 && M.DEF.find(d => d.id === 'produtividade').requer.join() === 'pe.ver' && M.DEF.find(d => d.id === 'ticket_mix').requer.length === 0 && M.DEF.find(d => d.id === 'liquidez').requer.join() === 'fcx.ver' && M.DEF.find(d => d.id === 'vazamento').requer.join() === 'retaguarda.adq.ver' && M.DEF.find(d => d.id === 'produtividade').salario === true, exigencias.map(d => d.id + ':' + d.requer));
let tudoRestrito = true, nuncaLeu = true;
for (const d of exigencias) {
  const ch = [], r = M.montar(F(), ctxBase({ pode: p => !d.requer.includes(p) }), fonte({}, ch)), x = por(r, d.id);
  if (x.status !== 'restrito' || x.real != null || !new RegExp(d.requer[0].replace('.', '\\.')).test(x.motivo)) tudoRestrito = false;
  const fn = { liquidez: 'liquidez', margem_pe: 'pe', ocupacao: 'ocupacao', vazamento: 'vazamento', meta_vendas: 'vendas', ativacao: 'credsystem', ieo: 'ieo', conciliacao: 'conciliacao', radar: 'radar', pdi_nota: 'pdi', pdi_prontidao: 'pdi' }[d.id];
  if (fn && fn !== 'vendas' && fn !== 'pdi' && ch.includes(fn)) nuncaLeu = false; // vendas/pdi são lidas por outros indicadores
  const demais = r.indicadores.filter(i => i.id !== d.id && !exigencias.find(e => e.id === i.id && e.requer.some(p => d.requer.includes(p))));
  if (!demais.every(i => { const base = por(r0, i.id); return i.status === base.status; })) tudoRestrito = false;
}
chk('sem a permissão da base, o indicador fica "Sem acesso" (com a permissão citada), sem valores — e os outros indicadores não mudam', tudoRestrito, '');
chk('o indicador restrito nem lê a fonte de dados (a base não é consultada sem permissão)', nuncaLeu, '');
const semPerm = M.montar(F(), ctxBase({ pode: () => false }), fonte());
chk('usuário sem nenhuma permissão de base: só o que não exige módulo é calculado; nada vaza nos indicadores restritos (meta/realizado nulos) e o laudo lista as lacunas', semPerm.indicadores.filter(x => x.status === 'restrito').every(x => x.real == null && x.meta == null && !x.detalhe.length) && M.laudo(semPerm).lacunas.length >= 11, semPerm.resumo);

/* ---------- 8 · LGPD: sem "Pode ver salários", nada de folha na Produtividade ---------- */
const ch8 = [], rs = M.montar(F(), ctxBase({ verSalarios: false }), fonte({}, ch8)), ps = por(rs, 'produtividade');
chk('sem "Pode ver salários": a Produtividade mostra só o farol/atingimento (80%) e oculta meta e realizado — a relação vendas ÷ folha × vendas revelaria a folha', ps.oculto === true && ps.meta == null && ps.real == null && ps.atingimento === 80 && ps.status === 'amarelo', ps);
chk('sem "Pode ver salários": nenhum texto do indicador (detalhe, motivo, laudo, CSV/Excel) traz folha, relação R$ por R$ 1,00 ou o valor da folha', (() => {
  const txt = JSON.stringify([ps.detalhe, ps.motivo, M.laudo(rs).paragrafos, M.laudo(rs).fortes.concat(M.laudo(rs).atencao, M.laudo(rs).gargalos).filter(x => x.id === 'produtividade'), M.linhasExport(rs).filter(l => /Produtividade/.test(l[1]))]);
  return !/6\.000|6000|R\$\s?40,00|R\$\s?50,00|\b40,00\b|\b50,00\b/.test(txt) && /ocultos/.test(txt);
})(), JSON.stringify(M.linhasExport(rs).filter(l => /Produtividade/.test(l[1]))));
chk('Produtividade sem a permissão do PE (faturamento): "Sem acesso", mesmo com "Pode ver salários"', por(M.montar(F(), ctxBase({ pode: p => p !== 'pe.ver' }), fonte()), 'produtividade').status === 'restrito', '');
const rs2 = M.montar(F(), ctxBase({ verSalarios: false }), fonte({ folha: () => null }));
chk('sem "Pode ver salários" e folha não lançada: aparece "Sem acesso" (não "Sem dados"), para não revelar se há folha', por(rs2, 'produtividade').status === 'restrito', por(rs2, 'produtividade'));
chk('com "Pode ver salários" e folha não lançada: "Sem dados no período"', por(M.montar(F(), ctxBase(), fonte({ folha: () => null })), 'produtividade').status === 'semdados', '');

/* ---------- 9 · Laudo Executivo ---------- */
const lz = M.laudo(r0);
chk('Laudo: parecer estruturado (abertura, alertas de liquidez, pontos fortes da zona verde, gargalos da zona vermelha, atenção, lacunas, encaminhamentos)', lz.titulo === 'Laudo Estratégico BSC' && lz.geral === 'CRÍTICO' && lz.fortes.length === r0.resumo.verde && lz.gargalos.length === r0.resumo.vermelho && lz.atencao.length === r0.resumo.amarelo && lz.lacunas.length === r0.resumo.semdados + r0.resumo.restrito && lz.encaminhamentos.length > 0, lz.geral);
chk('Laudo: a zona verde aparece como ponto forte e a vermelha como gargalo crítico, com a ação recomendada', lz.fortes.some(f => f.id === 'liquidez') && lz.gargalos.some(g => g.id === 'conciliacao' && g.acao) && lz.paragrafos.some(p => /^Pontos fortes \(zona verde\)/.test(p)) && lz.paragrafos.some(p => /^Principais gargalos críticos \(zona vermelha\)/.test(p)), lz.paragrafos);
chk('Laudo: a abertura cita período, escopo, quantos indicadores têm base e a contagem por farol', /nov\/2026/.test(lz.abertura) && /Rede consolidada/.test(lz.abertura) && /13 indicadores/.test(lz.abertura) && new RegExp(`${r0.resumo.verde} em zona verde`).test(lz.abertura), lz.abertura);
chk('Laudo: liquidez confortável gera apenas um registro positivo (sem alarme) e o status geral é SAUDÁVEL quando tudo é verde', lz.alertas.some(t => /Liquidez confortável/.test(t)) && (() => { const tudoVerde = M.montar(F(), ctxBase(), fonte({ conciliacao: () => ({ lancadas: 3, divergencias: 3, tratadas: 3 }), vendas: ids => ({ realizado: 300000, meta: 300000, lojasComDado: 3, lojasTotal: 3, porSegmento: {} }), pe: () => ({ receita: 300000, meta: 300000, pe: 200000, mcValor: 1, mcPct: 1, fixos: 1, lojas: 3, lojasTotal: 3 }), ocupacao: () => ({ minimo: 10000, final: 10000, vendas: 300000, acima: 0, contratos: 3 }), radar: () => ({ total: 4, verde: 4, amarela: 0, vermelha: 0 }), pdi: () => ({ avaliados: 2, nota: 4, meta: 4, candidatos: 2, aptos: 2 }), ticketMix: () => ({ vendas: 1000, faturamento: 300000, metaTicket: 300 }) })); return M.laudo(tudoVerde).geral === 'SAUDÁVEL' && tudoVerde.resumo.vermelho === 0 && tudoVerde.resumo.amarelo === 0; })(), '');
chk('Laudo no recorte consolidado (regional/loja/segmento): avisa que a liquidez não foi avaliada (indicador da Tesouraria)', M.laudo(reg).alertas.some(t => /não avaliada neste recorte/.test(t)) && M.laudo(lj).alertas.some(t => /Tesouraria/.test(t)), M.laudo(reg).alertas);

/* ---------- 10 · exportação (CSV / Excel) e cartão da Home ---------- */
const rows = M.linhasExport(r0);
chk('CSV/Excel: cabeçalho pedido (11 colunas) e uma linha por indicador mais as sub-linhas de segmento (13 + 2)', M.CSV_CAB.join('|') === 'Perspectiva|Indicador|Escopo|Segmento|Mês de referência|Meta / Previsto|Realizado|Variância (%)|Atingimento (%)|Status|Observação' && rows.length === 15 && rows.every(r => r.length === 11), rows.length);
chk('CSV/Excel: valores formatados em pt-BR, status por extenso ("Verde", "Sem dados no período") e liquidez sem coluna de atingimento', rows.some(r => /Liquidez/.test(r[1]) && r[5] === '1,15' && r[6] === '1,50' && r[9] === 'Verde' && r[8] === '') && rows.some(r => /Ticket/.test(r[1]) && r[9] === 'Sem dados no período' && r[6] === '') && rows.some(r => /↳ ES Sports/.test(r[1]) && r[9] === 'Vermelho'), rows.slice(0, 2));
const hc = M.cartaoHome(r0);
chk('mini-card da Home: nº de indicadores em zona vermelha, estado do pior farol e resumo verde/amarelo/sem leitura', hc.valor === r0.resumo.vermelho && hc.estado === 'bad' && /zona vermelha no BSC de nov\/2026/.test(hc.texto) && new RegExp(`${r0.resumo.verde} verde\\(s\\)`).test(hc.sub), hc);

/* ---------- 11 · servidor: flag bsc_visualizar na matriz de permissões ---------- */
const P = await import(path.join(raiz, 'netlify/lib/permissoes.mjs'));
const MATRIZ = (await import(path.join(raiz, 'netlify/lib/matriz-acessos.mjs'))).default;
const mod = MATRIZ.modulos.find(m => m.id === 'bsc');
const todos = () => true, sem = recursos => k => !recursos.includes(k);
chk('matriz do servidor: módulo "bsc" com Ler → bsc_visualizar, sem Modificar/Excluir, atrelado ao recurso gestao_v1403 e à Gestão de Acessos v13.83', !!mod && mod.ler.join() === 'bsc_visualizar' && !mod.modificar.length && !mod.excluir.length && mod.rec === 'gestao_v1403' && mod.v1383 === true, mod);
chk('Operacional com "Balanced Scorecard: Ler" recebe bsc_visualizar (e nada mais além do que os outros módulos dão)', P.permissoesEfetivas({ perfil: 'OPERACIONAL', permissoes: { bsc: 'ler' } }, todos).has('bsc_visualizar') && !P.permissoesEfetivas({ perfil: 'OPERACIONAL', permissoes: {} }, todos).has('bsc_visualizar'), '');
chk('perfil Loja com o módulo marcado: só leitura (bsc_visualizar) e nenhuma permissão de escrita nova', (() => { const x = P.permissoesEfetivas({ perfil: 'LOJA', permissoes: { bsc: 'excluir' } }, todos); return x.has('bsc_visualizar') && ![...x].some(p => /bsc.*(editar|excluir|modificar)/.test(p)); })(), '');
chk('recurso gestao_v1403 desligado (Produção/Falco até a liberação): a flag não existe, mesmo marcada', !P.permissoesEfetivas({ perfil: 'OPERACIONAL', permissoes: { bsc: 'ler' } }, sem(['gestao_v1403'])).has('bsc_visualizar'), '');
chk('Master e Liberação Gerencial recebem a flag automaticamente; "Pode ver salários" continua isolada (a Gerencial não a concede)', P.permissoesEfetivas({ perfil: 'MASTER' }, todos).has('*') && P.permissoesEfetivas({ perfil: 'OPERACIONAL', permissoes: { liberacao_gerencial: true } }, todos).has('bsc_visualizar') && !P.permissoesEfetivas({ perfil: 'OPERACIONAL', permissoes: { liberacao_gerencial: true } }, todos).has('rh.ver_salarios'), '');

/* ---------- 12 · neutralidade white-label (Falco) no motor ---------- */
const falco = M.montar(F(), ctxBase({ rotSeg: s => s === 'essports' ? 'Sports' : s === 'esposende' ? 'Tradicional' : 'Todas' }), fonte());
const txtFalco = JSON.stringify([por(falco, 'meta_vendas').sub, M.laudo(falco), M.linhasExport(falco)]);
chk('white-label: os rótulos de segmento vêm do contexto (Falco: "Tradicional"/"Sports") e o motor não escreve "Esposende"/"ES Sports" por conta própria', !/Esposende|ES Sports/i.test(txtFalco.replace(/ESPOSENDE SPORTS|ES SPORTS ARCO/g, '')) && /Tradicional/.test(txtFalco), (txtFalco.match(/.{20}(Esposende|ES Sports).{20}/i) || [''])[0]);
chk('white-label: o bloco do motor no painel não tem a marca da empresa escrita (só nomes de segmento padrão, usados quando o contexto não informa)', (() => { const fonteMotor = html.slice(a, b); return !/Falco|Controladoria/.test(fonteMotor); })(), '');

console.log(`\nOK (${OK.length})  FALHAS (${FAIL.length})`);
if (FAIL.length) { console.log(FAIL.map(f => ' - ' + f).join('\n')); process.exit(1); }
