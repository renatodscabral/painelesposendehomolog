/* v14.06 · Resumo Executivo Oficial da DFC (padrão bancário / institucional, CPC 03).
   Valida o CÓDIGO REAL do painel (public/index.html: objeto DFC e o motor DFC_RESUMO) num contexto isolado do Node, sem navegador e sem banco,
   com empresa, extratos e lançamentos FICTÍCIOS (LGPD; o CNPJ de exemplo é gerado aqui pelos dígitos verificadores):
   1) período (mês, trimestre, acumulado do ano, intervalo) e formatação;
   2) indicadores: geração operacional e margem de caixa, investimento, financiamento, não operacional isolado, variação líquida e neutras;
   3) reconciliação do saldo inicial e final (por conta e consolidado): conciliado, divergente, parcial, sem extrato, saldo inicial manual;
   4) Índice de Cobertura do Serviço da Dívida (amortizações + juros identificados) e faixas;
   5) Quadro 2: realizado OFX × previsto FCX, variação R$ e %, subtotais e acumulado de vários meses;
   6) máscara da folha de pagamento para quem não vê salários;
   7) validação da pré-configuração e montagem do documento (cabeçalho, Quadros 1 a 3, assinaturas, sem tags internas).
   Uso: node tests/teste-dfc-resumo-bancario-1406.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(raiz, 'public/index.html'), 'utf8');
const OK = [], FAIL = [];
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x !== '' ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 700) : '')); };

/* ---------- extrai o código real: CSV, leitor OFX e o bloco da DFC (que contém PARC_PIX, PARC_IMP e DFC_RESUMO) ---------- */
const corta = (ini, fim) => { const a = html.indexOf(ini), b = html.indexOf(fim, a); if (a < 0 || b < 0) throw new Error('bloco não encontrado: ' + ini); return html.slice(a, b); };
const csvCod = corta('const CSV = {', '/**\n * WhatsApp (camada Util)');
const ofxCod = corta('const OFX = {', '/* ======================= CONTAS (de-para)');
const dfcCod = corta('const DFC_GRUPOS = {', '/* ============================ IEO ============================ */');
const montar = (cfg) => {
  const Repo = { get: (col, id) => col === 'config' && id === 'dfc' ? cfg.doc : null };
  return new Function('Repo', 'g04', 'g05', csvCod + '\n' + ofxCod + '\n' + dfcCod + '\nreturn { DFC, DFC_REGRAS_PADRAO, DFC_RESUMO, PARC_PIX };')(Repo, () => true, () => true);
};
const cfg = { doc: null };
const { DFC, DFC_REGRAS_PADRAO, DFC_RESUMO: R, PARC_PIX: X } = montar(cfg);

const dvCnpj = b => { const calc = (d, ps) => { const r = d.reduce((a, x, i) => a + x * ps[i], 0) % 11; return r < 2 ? 0 : 11 - r; }; const d = String(b).split('').map(Number); d.push(calc(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])); d.push(calc(d, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])); return d.join(''); };
const CNPJ = dvCnpj('123450000001'); // empresa fictícia
const brl = n => R.brl(n);

/* ---------- 1 · período e formatação ---------- */
const pm = R.periodo('mes', '2026-10'), pt = R.periodo('trimestre', '2026-10'), pa = R.periodo('ano', '2026-10'), pp = R.periodo('personalizado', '2026-10', '2026-07');
chk('período "mês": só o mês de referência, rótulo out/2026', pm && pm.meses.join() === '2026-10' && pm.de === '2026-10' && pm.ate === '2026-10' && pm.rotulo === 'out/2026', pm);
chk('período "trimestre": 3 meses terminando no mês (ago a out/2026), rótulo com intervalo', pt && pt.meses.join() === '2026-08,2026-09,2026-10' && pt.rotulo === 'ago/2026 a out/2026', pt);
chk('trimestre atravessa a virada do ano (jan/2026 → nov/2025 a jan/2026)', R.periodo('trimestre', '2026-01').meses.join() === '2025-11,2025-12,2026-01' && R.somaMes('2026-01', -1) === '2025-12' && R.somaMes('2025-12', 1) === '2026-01');
chk('período "acumulado do ano": janeiro até o mês (10 meses em out/2026)', pa && pa.de === '2026-01' && pa.meses.length === 10 && pa.rotulo === 'jan/2026 a out/2026', pa);
chk('período personalizado: de jul a out/2026 = 4 meses', pp && pp.meses.length === 4 && pp.de === '2026-07', pp);
chk('período inválido: mês mal formado, "de" depois de "até", intervalo maior que 36 meses, sem "de" no personalizado', R.periodo('mes', '2026-13') === null && R.periodo('mes', '') === null && R.periodo('personalizado', '2026-03', '2026-05') === null && R.periodo('personalizado', '2026-10', '2022-01') === null && R.periodo('personalizado', '2026-10', '') === null);
chk('R$ no padrão brasileiro, negativo com sinal na frente e zero sem sinal', brl(1234.5) === 'R$ 1.234,50' && brl(-1234567.891) === '-R$ 1.234.567,89' && brl(0) === 'R$ 0,00' && brl(-0.001) === 'R$ 0,00' && brl(999.999) === 'R$ 1.000,00', [brl(1234.5), brl(-1234567.891), brl(-0.001), brl(999.999)]);
chk('percentual, vezes e CNPJ formatados', R.pct(0.43442) === '43,4%' && R.pct(null) === '—' && R.vezes(4.8392) === '4,84x' && R.vezes(null) === '—' && R.cnpjFmt(CNPJ) === CNPJ.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5'));

/* ---------- cenário fictício de outubro/2026 (duas contas) ---------- */
const MES = '2026-10', ANT = '2026-09';
cfg.doc = { regras: [{ id: 'r-nop', termos: ['RESCISAO'], sentido: 'S', categoria: 'cus_nao_op' }, ...DFC_REGRAS_PADRAO], categorias: [{ id: 'cus_nao_op', nome: 'Saídas não operacionais', sentido: 'S', grupo: 'NAO_OPERACIONAL', impacto: 'soma' }] };
let seq = 0;
const tx = (data, valor, hist, contaId) => ({ id: 't' + (++seq), data, valor, hist, contaId, tipo: valor >= 0 ? 'CREDIT' : 'DEBIT' });
const T1 = [
  tx('2026-10-02', 50000, 'GETNET LIQUIDACAO', 'cb1'), tx('2026-10-05', 3000, 'DEPOSITO EM DINHEIRO', 'cb1'), tx('2026-10-06', -20000, 'PAG TIT ALPARGATAS', 'cb1'),
  tx('2026-10-07', -8137.45, 'FOLHA PAGAMENTO SALARIO', 'cb1'), tx('2026-10-08', -2500, 'ALUGUEL LOJA 01', 'cb1'), tx('2026-10-09', -400, 'TARIFA BANCARIA CESTA', 'cb1'),
  tx('2026-10-10', -600, 'JUROS CHEQUE ESPECIAL', 'cb1'), tx('2026-10-12', -5000, 'PARC EMPREST BANCO', 'cb1'), tx('2026-10-15', 30000, 'CREDITO LIBERADO CAPITAL DE GIRO', 'cb1'),
  tx('2026-10-18', -12000, 'APLICACAO CDB', 'cb1'), tx('2026-10-19', 2000, 'RESGATE CDB', 'cb1'), tx('2026-10-20', -4000, 'TRANSF ENTRE CONTAS', 'cb1'),
  tx('2026-10-21', -1500, 'MULTA CONTRATUAL RESCISAO', 'cb1'),
  tx('2026-10-03', 8000, 'PIX RECEB VENDA', 'cb2'), tx('2026-10-11', -3000, 'NEOENERGIA PE', 'cb2'), tx('2026-10-20', 4000, 'TRANSF ENTRE CONTAS', 'cb2'),
];
const FOLHA = 8137.45;
const contas = [{ id: 'cb1', rotulo: 'Conta A · Banco Teste 001' }, { id: 'cb2', rotulo: 'Conta B · Banco Teste 341' }];
const ext = (contaId, mes, valor, data) => ({ contaId, mes, saldo: { valor, data } });
const EXT_OK = [ext('cb1', ANT, 10000, '2026-09-30'), ext('cb2', ANT, 5000, '2026-09-30'), ext('cb1', MES, 0, '2026-10-31'), ext('cb2', MES, 0, '2026-10-31')]; // finais ajustados abaixo
const base = (o = {}) => ({ periodo: pm, transacoes: T1, contas, extratos: EXT_OK, saldoManualInicial: null, previstoPorMes: null, mascarar: false, ...o });
const movA = T1.filter(t => t.contaId === 'cb1').reduce((a, t) => a + t.valor, 0), movB = T1.filter(t => t.contaId === 'cb2').reduce((a, t) => a + t.valor, 0);
EXT_OK[2].saldo.valor = Math.round((10000 + movA) * 100) / 100; EXT_OK[3].saldo.valor = Math.round((5000 + movB) * 100) / 100;

/* ---------- 2 · indicadores ---------- */
const m = R.montar(base()), I = m.indicadores;
const opEnt = 50000 + 3000 + 8000, opSai = 20000 + FOLHA + 2500 + 400 + 600 + 3000, opLiq = Math.round((opEnt - opSai) * 100) / 100;
chk('lançamentos do período e contas consideradas', m.nTransacoes === 16 && m.nContas === 2, [m.nTransacoes, m.nContas]);
chk('geração operacional = entradas − saídas operacionais; margem de caixa = líquido ÷ entradas operacionais', I.operacional.entradas === opEnt && I.operacional.saidas === Math.round(opSai * 100) / 100 && I.operacional.liquido === opLiq && Math.abs(I.operacional.margem - opLiq / opEnt) < 1e-9, I.operacional);
chk('fluxo líquido de investimento (−12.000 + 2.000) e de financiamento (+30.000 − 5.000)', I.investimento === -10000 && I.financiamento === 25000, [I.investimento, I.financiamento]);
chk('movimentações não operacionais isoladas (−1.500) e visíveis', I.naoOperacional.liquido === -1500 && I.naoOperacional.visivel === true, I.naoOperacional);
chk('variação líquida = soma dos quatro grupos; transferência entre contas próprias fica de fora', I.variacao === Math.round((opLiq - 10000 + 25000 - 1500) * 100) / 100 && I.neutras === 0, [I.variacao, I.neutras]);
const dm0 = DFC.demonstrativo(DFC.consolidar(T1.map(t => ({ ...t })), DFC.regras()));
chk('os números do resumo são os mesmos da DFC do mês (DFC.consolidar/demonstrativo)', dm0.variacao === I.variacao && dm0.operacional === I.operacional.liquido, [dm0.variacao, I.variacao]);

/* ---------- 3 · reconciliação de saldos ---------- */
const S = m.saldos;
chk('saldo inicial consolidado = soma dos saldos dos extratos do mês anterior (15.000), origem "extratos" com a data', S.inicial.valor === 15000 && S.inicial.origem === 'extratos' && S.inicial.data === '2026-09-30' && !S.inicial.parcial, S.inicial);
chk('saldo final conciliado = saldo inicial + variação líquida + movimentações neutras', S.final.calculado === Math.round((15000 + I.variacao + I.neutras) * 100) / 100, S.final);
chk('saldo final do extrato bate com o conciliado: status "conciliado" e diferença zero', S.final.status === 'conciliado' && S.final.diferenca === 0 && S.final.completo && S.final.extrato === S.final.calculado, S.final);
chk('detalhe por conta: inicial, movimento, final calculado, final do extrato e situação', S.porConta.length === 2 && S.porConta[0].id === 'cb1' && S.porConta[0].inicial === 10000 && S.porConta[0].movimento === Math.round(movA * 100) / 100 && S.porConta[0].finalCalculado === S.porConta[0].finalExtrato && S.porConta.every(k => k.status === 'conciliado' && k.diferenca === 0), S.porConta);
const exDiv = EXT_OK.map(e => e.contaId === 'cb2' && e.mes === MES ? { ...e, saldo: { ...e.saldo, valor: e.saldo.valor + 100 } } : e);
const mDiv = R.montar(base({ extratos: exDiv }));
chk('saldo do extrato 100,00 acima do calculado: conta B "divergente" (−100,00) e o consolidado também', mDiv.saldos.porConta[1].status === 'divergente' && mDiv.saldos.porConta[1].diferenca === -100 && mDiv.saldos.final.status === 'divergente' && mDiv.saldos.final.diferenca === -100 && mDiv.saldos.porConta[0].status === 'conciliado', mDiv.saldos);
const mSemFimB = R.montar(base({ extratos: EXT_OK.filter(e => !(e.contaId === 'cb2' && e.mes === MES)) }));
chk('conta B sem saldo no extrato do mês: conta "sem_extrato", consolidado "parcial" (sem diferença inventada) e aviso nomeando a conta', mSemFimB.saldos.porConta[1].status === 'sem_extrato' && mSemFimB.saldos.final.status === 'parcial' && mSemFimB.saldos.final.diferenca === null && mSemFimB.avisos.some(a => a.includes('Conta B')), mSemFimB.avisos);
const mSemIniB = R.montar(base({ extratos: EXT_OK.filter(e => !(e.contaId === 'cb2' && e.mes === ANT)) }));
chk('conta B sem saldo do mês anterior: "sem_inicial", saldo inicial parcial (10.000) e consolidado "parcial"', mSemIniB.saldos.porConta[1].status === 'sem_inicial' && mSemIniB.saldos.inicial.valor === 10000 && mSemIniB.saldos.inicial.parcial && mSemIniB.saldos.final.status === 'parcial', mSemIniB.saldos.inicial);
const mManOk = R.montar(base({ saldoManualInicial: 15000 })), mManBad = R.montar(base({ saldoManualInicial: 16000 }));
chk('saldo inicial informado manualmente (15.000) prevalece e concilia; 16.000 gera diferença de +1.000,00', mManOk.saldos.inicial.origem === 'manual' && mManOk.saldos.final.status === 'conciliado' && mManBad.saldos.final.status === 'divergente' && mManBad.saldos.final.diferenca === 1000, [mManOk.saldos.final, mManBad.saldos.final]);
const mSemExt = R.montar(base({ extratos: [] }));
chk('sem nenhum saldo nos extratos: saldo inicial "ausente" (zero, com aviso), final do extrato nulo e status "sem_extrato"', mSemExt.saldos.inicial.origem === 'ausente' && mSemExt.saldos.inicial.valor === 0 && mSemExt.saldos.final.extrato === null && mSemExt.saldos.final.status === 'sem_extrato' && mSemExt.avisos.some(a => /Saldo inicial não localizado/.test(a)), mSemExt.avisos);
const T1b = T1.filter(t => !(t.contaId === 'cb2' && /TRANSF/.test(t.hist))); // transferência sem a contrapartida na outra conta (ela não foi importada)
const extB = EXT_OK.map(e => e.contaId === 'cb1' && e.mes === MES ? e : e.contaId === 'cb2' && e.mes === MES ? { ...e, saldo: { ...e.saldo, valor: 5000 + movB - 4000 } } : e);
const mNeu = R.montar(base({ transacoes: T1b, extratos: extB }));
chk('transferência sem contrapartida: a variação líquida não muda, as neutras (−4.000) entram no saldo conciliado, a conta A e o consolidado conciliam', mNeu.indicadores.variacao === I.variacao && mNeu.indicadores.neutras === -4000 && mNeu.saldos.final.calculado === Math.round((S.final.calculado - 4000) * 100) / 100 && mNeu.saldos.porConta[0].status === 'conciliado' && mNeu.saldos.final.status === 'conciliado', [mNeu.indicadores.neutras, mNeu.saldos.final, S.final.calculado]);
chk('identidade: saldo inicial + variação + neutras = saldo final calculado (todos os cenários)', [m, mDiv, mNeu, mManBad, mSemExt].every(x => Math.abs(x.saldos.inicial.valor + x.indicadores.variacao + x.indicadores.neutras - x.saldos.final.calculado) < 0.005));
const mVazio = R.montar(base({ transacoes: [], extratos: [] }));
chk('período sem lançamentos: não quebra, zera os indicadores e avisa', mVazio.nTransacoes === 0 && mVazio.indicadores.variacao === 0 && mVazio.indicadores.operacional.margem === null && mVazio.avisos.some(a => /Não há lançamentos/.test(a)), mVazio.avisos);
chk('lançamentos fora do período são ignorados (setembro e novembro não entram em outubro)', R.montar(base({ transacoes: [...T1, tx('2026-09-30', -999, 'PAG TIT ALPARGATAS', 'cb1'), tx('2026-11-01', 777, 'GETNET', 'cb1')] })).indicadores.variacao === I.variacao);

/* ---------- 4 · cobertura do serviço da dívida ---------- */
const D = I.dscr;
chk('amortizações (5.000) e juros identificados em "Tarifas e juros bancários" (600; a tarifa de 400 não conta)', D.amortizacoes === 5000 && D.juros === 600 && D.servico === 5600, D);
chk('caixa operacional antes dos juros = geração operacional + juros já deduzidos nela', D.caixaAntesJuros === Math.round((opLiq + 600) * 100) / 100, D);
chk('índice de cobertura = caixa antes dos juros ÷ (amortizações + juros), faixa "confortável"', Math.abs(D.valor - (opLiq + 600) / 5600) < 1e-9 && D.faixa === 'confortavel', D);
chk('faixas do índice: ≥1,20x confortável, 1,00x a 1,20x atenção, abaixo de 1,00x insuficiente, sem serviço = n/d', R.faixa(1.2) === 'confortavel' && R.faixa(1.19) === 'atencao' && R.faixa(1) === 'atencao' && R.faixa(0.99) === 'insuficiente' && R.faixa(-0.3) === 'insuficiente' && R.faixa(null) === 'nd');
const mSemDiv = R.montar(base({ transacoes: T1.filter(t => !/PARC EMPREST|JUROS CHEQUE/.test(t.hist)) }));
chk('sem amortizações nem juros no período: índice nulo, faixa "nd", e o documento diz isso (sem "NaN" nem "Infinity")', mSemDiv.indicadores.dscr.valor === null && mSemDiv.indicadores.dscr.faixa === 'nd' && !/NaN|Infinity/.test(R.html(mSemDiv, { razao: 'Empresa Teste Ltda', cnpj: CNPJ, signatarios: [{ nome: 'A', cargo: 'B' }, { nome: 'C', cargo: 'D' }] })));
const mIOF = R.montar(base({ transacoes: [tx('2026-10-02', 10000, 'GETNET', 'cb1'), tx('2026-10-03', -50, 'IOF OPERACAO', 'cb1'), tx('2026-10-04', -70, 'JUROS MORA ATRASO', 'cb1'), tx('2026-10-05', 90, 'JUROS RENDIMENTO', 'cb1'), tx('2026-10-06', -30, 'TARIFA PIX', 'cb1')] }));
chk('IOF e juros/mora (saídas) entram no serviço da dívida; juros recebidos (entrada) e tarifas não', mIOF.indicadores.dscr.juros === 120, mIOF.indicadores.dscr);
cfg.doc = { ...cfg.doc, categorias: [...cfg.doc.categorias, { id: 'cus_fin', nome: 'Parcelas de arrendamento', sentido: 'S', grupo: 'FINANCIAMENTO', impacto: 'soma' }], regras: [{ id: 'r-arr', termos: ['ARRENDAMENTO'], sentido: 'S', categoria: 'cus_fin' }, ...cfg.doc.regras] };
const mCus = R.montar(base({ transacoes: [tx('2026-10-02', 10000, 'GETNET', 'cb1'), tx('2026-10-03', -1000, 'PARCELA ARRENDAMENTO', 'cb1')] }));
chk('saída de categoria personalizada do grupo Financiamento conta como amortização', mCus.indicadores.dscr.amortizacoes === 1000, mCus.indicadores.dscr);
cfg.doc = { regras: cfg.doc.regras.filter(r => r.id !== 'r-arr'), categorias: cfg.doc.categorias.filter(c => c.id !== 'cus_fin') };

/* ---------- 5 · Quadro 2: realizado × previsto ---------- */
const prev1 = { [MES]: { rec_cartoes: 55000, rec_depositos: 2000, rec_pix: 8000, pag_fornecedores: 25000, pag_folha: 7000, pag_administrativas: 1000, pag_ocupacao: 2500, pag_marketing: 1500, pag_utilidades: 3000, fin_amortizacao: 5000, inv_aplicacao: 10000 } };
const mp = R.montar(base({ previstoPorMes: prev1 })), Q = mp.quadro2, lin = (q, id) => q.grupos.flatMap(g => g.linhas).find(l => l.id === id), grp = (q, g) => q.grupos.find(x => x.grupo === g);
chk('Quadro 2 com previsto: realizado com sinal (entrada +, saída −) e previsto no mesmo sinal', Q.temPrevisto && lin(Q, 'rec_cartoes').realizado === 50000 && lin(Q, 'rec_cartoes').previsto === 55000 && lin(Q, 'pag_fornecedores').realizado === -20000 && lin(Q, 'pag_fornecedores').previsto === -25000, [lin(Q, 'rec_cartoes'), lin(Q, 'pag_fornecedores')]);
chk('variação = realizado − previsto (positivo é favorável nas entradas e nas saídas) e variação % sobre o previsto', lin(Q, 'rec_cartoes').variacao === -5000 && Math.abs(lin(Q, 'rec_cartoes').pct - (-5000 / 55000)) < 1e-9 && lin(Q, 'pag_fornecedores').variacao === 5000 && Math.abs(lin(Q, 'pag_fornecedores').pct - 0.2) < 1e-9, [lin(Q, 'rec_cartoes'), lin(Q, 'pag_fornecedores')]);
chk('categoria só com previsto (marketing) aparece com realizado zero; categoria sem nada some; neutra não vira linha de grupo', lin(Q, 'pag_marketing').realizado === 0 && lin(Q, 'pag_marketing').previsto === -1500 && !lin(Q, 'pag_outros') && !lin(Q, 'transf') && Q.neutras.some(x => /Transfer/i.test(x.nome)), Q.neutras);
const gOp = grp(Q, 'OPERACIONAL');
chk('subtotal por atividade: realizado do DFC e previsto somado; total = variação líquida', gOp.subtotal.realizado === I.operacional.liquido && gOp.subtotal.previsto === Math.round((55000 + 2000 + 8000 - 25000 - 7000 - 1000 - 2500 - 1500 - 3000) * 100) / 100 && Q.total.realizado === I.variacao && Q.total.previsto === Math.round(grupos(Q).reduce((a, g) => a + g.subtotal.previsto, 0) * 100) / 100, [gOp.subtotal, Q.total]);
function grupos(q) { return q.grupos; }
chk('subtotal do bloco = soma das linhas (sem máscara)', Math.abs(gOp.linhas.reduce((a, l) => a + l.realizado, 0) - gOp.subtotal.realizado) < 0.005 && Math.abs(gOp.linhas.reduce((a, l) => a + l.previsto, 0) - gOp.subtotal.previsto) < 0.005);
chk('"Atividades não operacionais" isolada no Quadro 2 (−1.500), separada do operacional', grp(Q, 'NAO_OPERACIONAL').visivel && grp(Q, 'NAO_OPERACIONAL').subtotal.realizado === -1500 && lin(Q, 'cus_nao_op').realizado === -1500 && gOp.linhas.every(l => l.id !== 'cus_nao_op'));
const mSemPrev = R.montar(base());
chk('sem previsto do FCX: Quadro 2 só com realizado, variações nulas e aviso', !mSemPrev.quadro2.temPrevisto && mSemPrev.quadro2.total.previsto === null && mSemPrev.quadro2.total.variacao === null && lin(mSemPrev.quadro2, 'rec_cartoes').previsto === null && mSemPrev.avisos.some(a => /FCX indisponíveis/.test(a)));
// acumulado de 3 meses
const T3 = [...T1, tx('2026-08-10', 20000, 'GETNET', 'cb1'), tx('2026-08-12', -9000, 'PAG TIT ALPARGATAS', 'cb1'), tx('2026-09-10', 10000, 'GETNET', 'cb1'), tx('2026-09-12', -4000, 'PAG TIT ALPARGATAS', 'cb1')];
const m3 = R.montar(base({ periodo: pt, transacoes: T3, previstoPorMes: { '2026-08': { rec_cartoes: 18000, pag_fornecedores: 10000 }, '2026-09': { rec_cartoes: 12000 }, ...prev1 }, extratos: [ext('cb1', '2026-07', 1000, '2026-07-31'), ext('cb1', MES, 1000 + 20000 - 9000 + 10000 - 4000 + movA, '2026-10-31')] }));
chk('acumulado (ago a out): realizado e previsto somados mês a mês; saldo inicial do mês anterior ao primeiro (jul)', lin(m3.quadro2, 'rec_cartoes').realizado === 50000 + 20000 + 10000 && lin(m3.quadro2, 'rec_cartoes').previsto === 55000 + 18000 + 12000 && lin(m3.quadro2, 'pag_fornecedores').realizado === -(20000 + 9000 + 4000) && lin(m3.quadro2, 'pag_fornecedores').previsto === -(25000 + 10000) && m3.saldos.inicial.valor === 1000 && m3.periodo.meses.length === 3, [lin(m3.quadro2, 'rec_cartoes'), m3.saldos.inicial]);
chk('acumulado: conta A concilia com o saldo final de outubro (saldo de julho + movimento dos três meses)', m3.saldos.porConta.find(k => k.id === 'cb1').status === 'conciliado', m3.saldos.porConta);

/* ---------- 6 · máscara da folha de pagamento ---------- */
const emissor = { razao: 'Empresa Teste Comércio Ltda', cnpj: CNPJ, logo: 'data:image/png;base64,AAAA', marca: 'Teste', emitidoEm: '13/11/2026 10:30', notas: '', signatarios: [{ nome: 'Fulana de Tal', cargo: 'Gestora Financeira / Diretoria' }, { nome: 'Beltrano de Tal', cargo: 'Contador Responsável', registro: 'CRC-PE 000000/O-0' }] };
// (a) vizinhas da folha (administrativas e outras) sem realizado: o agregado igual à folha entregaria o valor → junta todas as saídas operacionais
const mk = R.montar(base({ previstoPorMes: prev1, mascarar: true })), Qk = mk.quadro2, gOpk = grp(Qk, 'OPERACIONAL');
const saidasOp = gOp.linhas.filter(l => l.sentido === 'S');
chk('(a) vizinhas zeradas: a máscara junta TODAS as saídas operacionais numa linha só (a folha não fica sozinha) e some o nome da folha', !lin(Qk, 'pag_folha') && gOpk.linhas.filter(l => l.sentido === 'S').length === 1 && lin(Qk, 'pessoal_outros').nome === R.MASCARA_NOME_AMPLA && lin(Qk, 'pessoal_outros').restrito === true && !lin(Qk, 'pag_fornecedores'), gOpk.linhas.map(l => l.id));
chk('(a) a linha agregada soma o realizado e o previsto de todas as saídas operacionais; as entradas continuam abertas', lin(Qk, 'pessoal_outros').realizado === Math.round(saidasOp.reduce((a, l) => a + l.realizado, 0) * 100) / 100 && lin(Qk, 'pessoal_outros').previsto === Math.round(saidasOp.reduce((a, l) => a + l.previsto, 0) * 100) / 100 && lin(Qk, 'rec_cartoes').realizado === 50000 && lin(Qk, 'pessoal_outros').realizado !== -FOLHA && lin(Qk, 'pessoal_outros').exposta === false, lin(Qk, 'pessoal_outros'));
chk('(a) subtotais, total e indicadores NÃO mudam com a máscara; o subtotal continua igual à soma das linhas', gOpk.subtotal.realizado === gOp.subtotal.realizado && gOpk.subtotal.previsto === gOp.subtotal.previsto && Qk.total.realizado === Q.total.realizado && mk.indicadores.operacional.liquido === I.operacional.liquido && Math.abs(gOpk.linhas.reduce((a, l) => a + l.realizado, 0) - gOpk.subtotal.realizado) < 0.005 && Math.abs(gOpk.linhas.reduce((a, l) => a + l.previsto, 0) - gOpk.subtotal.previsto) < 0.005);
// (b) com administrativas e outras saídas realizadas, junta só a folha com elas e deixa as demais linhas abertas
const T1c = [...T1, tx('2026-10-13', -1200, 'HONORARIO CONTABIL', 'cb1'), tx('2026-10-14', -300, 'PAGAMENTO DIVERSOS XYZ', 'cb1')];
const mk2 = R.montar(base({ transacoes: T1c, previstoPorMes: { [MES]: { ...prev1[MES], pag_outros: 200 } }, mascarar: true })), Qk2 = mk2.quadro2;
chk('(b) com vizinhas movimentadas: junta só folha + administrativas + outras (nome específico); fornecedores, ocupação e utilidades seguem abertos', !lin(Qk2, 'pag_folha') && !lin(Qk2, 'pag_administrativas') && !lin(Qk2, 'pag_outros') && lin(Qk2, 'pessoal_outros').nome === R.MASCARA_NOME && lin(Qk2, 'pag_fornecedores') && lin(Qk2, 'pag_ocupacao') && lin(Qk2, 'pag_utilidades') && lin(Qk2, 'pessoal_outros').realizado === -(FOLHA + 1200 + 300) && lin(Qk2, 'pessoal_outros').previsto === -(7000 + 1000 + 200) && lin(Qk2, 'pessoal_outros').exposta === false, lin(Qk2, 'pessoal_outros'));
// (c) previsto das vizinhas zerado (só o realizado delas existe): o previsto agregado seria igual ao da folha → também amplia
const mk3 = R.montar(base({ transacoes: T1c, previstoPorMes: { [MES]: { pag_folha: 7000, pag_fornecedores: 25000 } }, mascarar: true }));
chk('(c) vizinhas sem previsto: amplia para todas as saídas (o previsto da folha não aparece sozinho)', lin(mk3.quadro2, 'pessoal_outros').nome === R.MASCARA_NOME_AMPLA && lin(mk3.quadro2, 'pessoal_outros').previsto === -(7000 + 25000));
// (d) a folha é a única saída operacional: o valor não tem como ser ocultado (o subtotal entrega) — o motor sinaliza
const mk4 = R.montar(base({ transacoes: [tx('2026-10-02', 50000, 'GETNET', 'cb1'), tx('2026-10-07', -8137.45, 'FOLHA PAGAMENTO SALARIO', 'cb1')], mascarar: true }));
chk('(d) folha como única saída operacional: sinaliza "mascaraExposta" (não há como esconder o valor sem esconder o subtotal)', mk4.mascaraExposta === true && lin(mk4.quadro2, 'pessoal_outros').exposta === true);
chk('(e) sem lançamento de folha no período a máscara não altera nada', JSON.stringify(R.montar(base({ transacoes: T1.filter(t => !/FOLHA/.test(t.hist)), mascarar: true })).quadro2.grupos) === JSON.stringify(R.montar(base({ transacoes: T1.filter(t => !/FOLHA/.test(t.hist)), mascarar: false })).quadro2.grupos));
const hMask = R.html(mk, emissor), hLivre = R.html(mp, emissor), hMask2 = R.html(mk2, emissor);
chk('documento mascarado não mostra o valor da folha nem o nome da linha; sem máscara mostra ambos', !hMask.includes('8.137,45') && !hMask.includes('Folha de pagamento') && !hMask2.includes('8.137,45') && !hMask2.includes('Folha de pagamento') && hLivre.includes('Folha de pagamento e benefícios') && hLivre.includes('8.137,45'), [hMask.includes('8.137,45'), hMask2.includes('8.137,45'), hLivre.includes('8.137,45')]);
chk('o documento mascarado traz a linha agregada e a nota de restrição de acesso; o liberado não', hMask.includes(R.MASCARA_NOME_AMPLA) && hMask2.includes(R.MASCARA_NOME) && /detalhes da folha de pagamento estão reunidos/.test(hMask) && !/detalhes da folha de pagamento estão reunidos/.test(hLivre));

/* ---------- 7 · validação e montagem do documento ---------- */
const ok = { razao: 'Empresa Teste Comércio Ltda', cnpj: CNPJ, periodo: pm, notas: '', signatarios: [{ nome: 'A', cargo: 'B' }, { nome: 'C', cargo: 'D' }] };
chk('pré-configuração completa é válida', R.validar(ok).length === 0, R.validar(ok));
chk('validação: razão social curta, CNPJ inválido, período nulo, notas longas e signatários incompletos geram um erro cada', R.validar({ ...ok, razao: 'ab' }).length === 1 && R.validar({ ...ok, cnpj: CNPJ.slice(0, 13) + (CNPJ[13] === '0' ? '1' : '0') }).length === 1 && R.validar({ ...ok, cnpj: '' }).length === 1 && R.validar({ ...ok, periodo: null }).length === 1 && R.validar({ ...ok, notas: 'x'.repeat(4001) }).length === 1 && R.validar({ ...ok, signatarios: [{ nome: '', cargo: 'B' }, { nome: 'C', cargo: '' }] }).length === 2 && R.validar({ ...ok, signatarios: [] }).length === 4);
chk('as notas aceitam exatamente 4.000 caracteres', R.validar({ ...ok, notas: 'x'.repeat(4000) }).length === 0);
const cnpjMask = R.cnpjFmt(CNPJ), h = R.html(mp, emissor);
chk('cabeçalho: logo do ambiente, razão social, CNPJ formatado, período, critério CPC 03 e data/hora de emissão', h.includes('<img src="data:image/png;base64,AAAA"') && h.includes('Empresa Teste Comércio Ltda') && h.includes(cnpjMask) && h.includes('out/2026') && h.includes('Demonstração dos Fluxos de Caixa — Método Direto / CPC 03') && h.includes('13/11/2026 10:30'));
chk('sem logo informado, não gera <img> quebrado', !R.html(mp, { ...emissor, logo: '' }).includes('<img'));
const ordem = ['Quadro 1 — Síntese Executiva e Indicadores de Liquidez', 'Quadro 2 — Demonstrativo Detalhado por Grupo e Categoria', 'class="rx-ass"'].map(s => h.indexOf(s));
chk('Quadros 1 e 2 e as assinaturas, nessa ordem; Quadro 3 omitido quando não há notas', ordem.every(i => i > 0) && ordem[0] < ordem[1] && ordem[1] < ordem[2] && !h.includes('Quadro 3'), ordem);
const h3 = R.html(mp, { ...emissor, notas: 'Sazonalidade do Dia das Mães e obra da loja 01.\n<script>alert(1)</script> & "aspas"' });
chk('Quadro 3 aparece só com notas, entre o Quadro 2 e as assinaturas, com HTML escapado e quebras de linha preservadas', h3.includes('Quadro 3 — Notas Explicativas da Controladoria') && h3.indexOf('Quadro 3') > h3.indexOf('Quadro 2') && h3.indexOf('Quadro 3') < h3.indexOf('class="rx-ass"') && !h3.includes('<script>') && h3.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;aspas&quot;') && h3.includes('Sazonalidade do Dia das Mães e obra da loja 01.\n'));
chk('notas só com espaços não geram o Quadro 3', !R.html(mp, { ...emissor, notas: '   \n  ' }).includes('Quadro 3'));
chk('assinaturas: Diretoria/Gestão Financeira e Contabilidade com nome, cargo e CRC, mais local e data', h.includes('Fulana de Tal') && h.includes('Gestora Financeira / Diretoria') && h.includes('Beltrano de Tal') && h.includes('Contador Responsável') && h.includes('CRC-PE 000000/O-0') && h.includes('Local e data:'));
chk('Quadro 1: saldo inicial, geração operacional com margem, investimento, financiamento, não operacional, variação, saldo final conciliado e cobertura da dívida', ['Saldo inicial consolidado', 'Geração líquida das atividades operacionais', 'margem de caixa operacional', 'Fluxo líquido das atividades de investimento', 'Fluxo líquido das atividades de financiamento', 'Movimentações não operacionais', 'Variação líquida do período', 'Saldo final conciliado', 'Índice de Cobertura do Serviço da Dívida', 'Saldos por conta bancária'].every(s => h.includes(s)));
chk('Quadro 1 traz os valores: saldo inicial 15.000,00, variação líquida e o índice de cobertura formatado', h.includes('R$ 15.000,00') && h.includes(brl(I.variacao)) && h.includes(R.vezes(D.valor)) && h.includes(R.pct(I.operacional.margem, 1)));
chk('contas bancárias do OFX detalhadas por nome, com situação "Conciliado"', h.includes('Conta A · Banco Teste 001') && h.includes('Conta B · Banco Teste 341') && (h.match(/Conciliado/g) || []).length >= 3);
chk('divergência aparece no documento: "Diferença de -R$ 100,00" no consolidado e a conta B como Divergente', R.html(mDiv, emissor).includes('Diferença de -R$\u00a0100,00') && R.html(mDiv, emissor).includes('Divergente'));
chk('Quadro 2: colunas Realizado, Previsto, Variação (R$) e Variação (%) quando há previsto; só Realizado quando não há', /Previsto \(FCX\)/.test(h) && /Variação \(%\)/.test(h) && !/Previsto \(FCX\)/.test(R.html(mSemPrev, emissor)) && /Realizado \(OFX\)/.test(R.html(mSemPrev, emissor)));
const bloqueados = ['★', 'pag_', 'rec_', 'inv_', 'fin_', 'cus_', 'por regra', 'categoria padrão', 'fornecedor_padrao', 'origem', 'undefined', 'NaN', 'null', '[object', '${'];
chk('sem tags internas operacionais: nada de ★, ids de categoria, origem da classificação, "undefined", "NaN" ou "null" no documento', bloqueados.every(s => !h.includes(s) && !hMask.includes(s)), bloqueados.filter(s => h.includes(s) || hMask.includes(s)));
chk('sem contagem de lançamentos nas linhas do Quadro 2 (nada de "(5)")', !/<td class="i">[^<]*\(\d+\)/.test(h));
chk('HTML equilibrado: mesmas aberturas e fechamentos de tabela e div', (h.match(/<table/g) || []).length === (h.match(/<\/table>/g) || []).length && (h.match(/<div/g) || []).length === (h.match(/<\/div>/g) || []).length && (h3.match(/<div/g) || []).length === (h3.match(/<\/div>/g) || []).length);
chk('documento de período vazio também monta, com os avisos', (() => { try { const x = R.html(mVazio, emissor); return x.includes('Não há lançamentos') && x.includes('Quadro 1') && !/NaN|undefined/.test(x); } catch (e) { return String(e); } })());
chk('o CSS do documento é fornecido pelo motor (classes rx-*) e não usa cores de marca da empresa', /\.rx-head/.test(R.css()) && !/esposende|falco/i.test(R.css()) && !/esposende|falco/i.test(h));
chk('sem nome de empresa fixo no motor (neutro para o white-label)', (() => { const ini = html.indexOf('/* DFC_RESUMO:INI */'), fim = html.indexOf('/* DFC_RESUMO:FIM */'); return ini > 0 && fim > ini && !/esposende|falco|resilienza|mar aberto/i.test(html.slice(ini, fim)); })());

console.log('\n' + (FAIL.length ? 'FALHAS: ' + FAIL.length : 'OK') + ' (' + OK.length + ' verificações)');
process.exit(FAIL.length ? 1 : 0);
