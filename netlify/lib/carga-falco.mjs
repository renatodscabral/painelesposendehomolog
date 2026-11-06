/* v13.92 · Carga de dados de TESTE do Módulo Contábil — exclusiva do site da Falco Controladoria e Gestão.
   Monta, numa empresa fictícia própria (CNPJ de teste), o plano de contas da planilha LançamentosIniciais.xlsx (árvore Ativo,
   Passivo, PL, Receitas, Custos e Despesas), os 60 lançamentos de jan–fev/2025 e 10 lançamentos de março/2025 (empréstimo de
   longo prazo, 1ª parcela com juros, produção e venda, folha, depreciação, IRPJ/CSLL do trimestre e distribuição de lucros).
   Funções puras: quem grava é a rota POST /api/contabil/carga-teste (contabil.mjs), dentro de uma transação. */
import { centavos, reais, dre, normalizar, partesCodigo } from './contabil-motor.mjs';
import { LINHAS_PLANILHA } from './carga-falco-dados.mjs';

export const FRASE_CONFIRMACAO = 'CARREGAR DADOS DE TESTE NA FALCO';
export const PREFIXO_DOC = 'CARGA-';
export { LINHAS_PLANILHA };

/* empresa fictícia (CNPJ de teste com dígitos válidos; CRC "TS" = fictício, não é UF) */
export const EMPRESA_TESTE = {
  cnpj: '11444777000161', razaoSocial: 'INDÚSTRIA FICTÍCIA DE TESTES FALCO LTDA', nomeFantasia: 'Indústria de Testes (fictícia)', regime: 'real', capitalSocial: 2400000,
  socios: ['João Alves', 'Marta Souza', 'Pedro Lins', 'Carla Nóbrega', 'Renato Farias'].map((nome, i) => ({ nome: nome + ' (fictício)', documento: '', qualificacao: i === 0 ? 'Sócio-Administrador' : 'Sócio', participacao: 20 })),
  contador: { nome: 'CONTADORA DE TESTES (FICTÍCIA)', crc: 'TS-000001/O', uf: '', email: '' }, endereco: 'Endereço fictício para testes',
};

/* contas sintéticas da árvore (só são criadas se faltarem; nomes de contas que já existem não são alterados) */
export const SINTETICAS = {
  1: 'ATIVO', '1.1': 'ATIVO CIRCULANTE', '1.2': 'ATIVO NÃO CIRCULANTE',
  2: 'PASSIVO', '2.1': 'PASSIVO CIRCULANTE', '2.2': 'PASSIVO NÃO CIRCULANTE',
  3: 'PATRIMÔNIO LÍQUIDO', '3.1': 'CAPITAL SOCIAL', '3.5': 'LUCROS OU PREJUÍZOS ACUMULADOS',
  4: 'RECEITAS', '4.1': 'RECEITA OPERACIONAL',
  5: 'CUSTOS E DESPESAS', '5.1': 'CUSTO DOS PRODUTOS VENDIDOS', '5.2': 'DESPESAS COM PESSOAL', '5.3': 'DESPESAS ADMINISTRATIVAS', '5.4': 'DESPESAS COM SEGUROS',
  '5.5': 'DEPRECIAÇÃO E AMORTIZAÇÃO', '5.6': 'DESPESAS COM VENDAS', '5.7': 'DESPESAS FINANCEIRAS', '5.8': 'TRIBUTOS SOBRE O LUCRO',
};

/* contas analíticas que os lançamentos de março precisam (além das da planilha) */
export const CONTAS_MARCO = [
  ['2.1.06', 'IRPJ a Recolher'], ['2.1.07', 'CSLL a Recolher'], ['2.1.09', 'Empréstimos e Financiamentos de Curto Prazo'],
  ['2.2.01', 'Empréstimos e Financiamentos de Longo Prazo'], ['3.5.01', 'Lucros Distribuídos aos Sócios no Exercício'],
  ['5.7.02', 'Juros Passivos sobre Empréstimos'], ['5.8.01', 'IRPJ sobre o Lucro Real'], ['5.8.02', 'CSLL sobre o Lucro Real'],
];

/** Classificação contábil de uma conta analítica da planilha (natureza pelo grupo; DRE/DVA pelo subgrupo; tributos pelo nome). */
export function classificarConta(codigo, nome) {
  const { grupo } = partesCodigo(codigo), n = normalizar(nome), sub = codigo.split('.').slice(0, 2).join('.'), redutora = /^\(-\)/.test(nome.trim());
  const trib = ['IBS', 'CBS', 'IRPJ', 'CSLL'].filter(t => new RegExp('\\b' + t.toLowerCase() + '\\b').test(n));
  const r = { codigo, nome: nome.trim(), tipo: 'A', redutora, dre: null, dva: null, tributos: trib, modeloTributario: trib.some(t => t === 'IBS' || t === 'CBS') ? 'reforma' : trib.length ? 'ambos' : undefined };
  if (grupo === 4) {
    if (redutora || /deduc/.test(n)) Object.assign(r, { redutora: true, dre: 'ded', dva: 'imp_estaduais' }); /* IBS (estados/municípios) é a maior parte da dedução IBS/CBS */
    else Object.assign(r, { dre: 'rb', dva: 'vendas', tributos: ['IBS', 'CBS'], modeloTributario: 'reforma' });
  }
  if (grupo === 5) Object.assign(r, ({ '5.1': { dre: 'cmv', dva: 'cmv' }, '5.2': { dre: 'dga', dva: 'pessoal' }, '5.3': { dre: 'dga', dva: /aluguel/.test(n) ? 'alugueis' : 'insumos' }, '5.4': { dre: 'dga', dva: 'insumos' },
    '5.5': { dre: 'dga', dva: 'depreciacao' }, '5.6': { dre: 'dv', dva: 'insumos' }, '5.7': { dre: 'df', dva: 'juros' }, '5.8': { dre: 'ir', dva: 'imp_federais' } })[sub] || { dre: 'dga', dva: 'insumos' });
  if (r.modeloTributario === undefined) delete r.modeloTributario;
  return r;
}

/** Valida e normaliza as linhas da planilha: [nº, data, histórico, cód. débito, conta débito, cód. crédito, conta crédito, valor]. */
export function validarLinhas(linhas) {
  if (!Array.isArray(linhas) || !linhas.length || linhas.length > 2000) throw new Error('Envie de 1 a 2000 linhas da planilha.');
  return linhas.map((l, i) => {
    const [n, data, historico, cd, nd, cc, nc, valor] = Array.isArray(l) ? l : [l.n, l.data, l.historico, l.codDebito, l.contaDebito, l.codCredito, l.contaCredito, l.valor];
    const err = m => { throw new Error(`Linha ${n ?? i + 1}: ${m}`); };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data))) err('data inválida (use AAAA-MM-DD).');
    if (String(historico || '').trim().length < 3) err('histórico vazio.');
    for (const c of [cd, cc]) { try { partesCodigo(c); } catch { err(`código de conta inválido "${c}".`); } }
    if (cd === cc) err('débito e crédito na mesma conta.');
    const v = centavos(valor); if (!(v > 0)) err('valor deve ser positivo.');
    return { n: Number(n) || i + 1, data: String(data), historico: String(historico).trim().slice(0, 480), debito: { codigo: String(cd), nome: String(nd || '').trim() || String(cd) }, credito: { codigo: String(cc), nome: String(nc || '').trim() || String(cc) }, valor: v };
  });
}

/** Lançamentos de março/2025 (valores em centavos). Os dois últimos dependem do lucro: veja impostoEDividendos(). */
export function lancamentosMarco() {
  const L = (seq, data, historico, itens, origem = 'manual') => ({ docRef: `${PREFIXO_DOC}MAR-${String(seq).padStart(2, '0')}`, data, historico, origem, itens: itens.map(([conta, dc, v]) => ({ conta, dc, valor: centavos(v) })) });
  return [
    L(1, '2025-03-03', 'Captação de empréstimo bancário de longo prazo — contrato fictício CCB 001/2025, 24 parcelas mensais de R$ 25.000,00 (as 12 próximas no circulante)', [['1.1.02', 'D', 600000], ['2.1.09', 'C', 300000], ['2.2.01', 'C', 300000]]),
    L(2, '2025-03-04', 'Compra de matéria-prima a prazo - NF 1021, com IBS e CBS a recuperar', [['1.1.04', 'D', 170000], ['1.1.07', 'D', 30090], ['1.1.08', 'D', 14960], ['2.1.01', 'C', 215050]]),
    L(3, '2025-03-06', 'Requisição de matéria-prima e conclusão da produção do período (produtos acabados)', [['1.1.05', 'D', 180000], ['1.1.06', 'D', 180000], ['1.1.04', 'C', 180000], ['1.1.05', 'C', 180000]]),
    L(4, '2025-03-10', 'Venda de produtos acabados a prazo - NF 2021, com IBS (17,7%) e CBS (8,8%) destacados', [['1.1.03', 'D', 320000], ['4.1.02', 'D', 84800], ['4.1.01', 'C', 320000], ['2.1.04', 'C', 56640], ['2.1.05', 'C', 28160]]),
    L(5, '2025-03-10', 'Baixa do custo dos produtos vendidos - NF 2021', [['5.1.01', 'D', 134400], ['1.1.06', 'C', 134400]]),
    L(6, '2025-03-20', 'Provisão da folha de pagamento e dos encargos sociais (INSS/FGTS) de março', [['5.2.01', 'D', 45000], ['5.2.02', 'D', 13500], ['2.1.02', 'C', 45000], ['2.1.03', 'C', 13500]]),
    L(7, '2025-03-31', 'Depreciação mensal e apropriação do seguro (1/12 da apólice anual)', [['5.5.01', 'D', 12833.34], ['5.4.01', 'D', 2000], ['1.2.04', 'C', 12833.34], ['1.1.09', 'C', 2000]]),
    L(8, '2025-03-31', 'Pagamento da 1ª parcela do empréstimo: amortização de R$ 25.000,00 e juros passivos de 1,5% a.m. sobre o saldo', [['2.1.09', 'D', 25000], ['5.7.02', 'D', 9000], ['1.1.02', 'C', 34000]]),
  ];
}
/** IRPJ (15% + adicional de 10% sobre o que passar de R$ 60.000 no trimestre) e CSLL (9%) do Lucro Real trimestral, e a
    distribuição de 50% do lucro líquido aos sócios. lair em centavos. Sem adições/exclusões do LALUR (simplificação de teste). */
export function impostoEDividendos(lair) {
  if (!(lair > 0)) return { irpj: 0, csll: 0, dividendos: 0, lancamentos: [] };
  const irpj = Math.round(lair * 0.15) + Math.round(Math.max(0, lair - 6000000) * 0.10), csll = Math.round(lair * 0.09), ll = lair - irpj - csll, dividendos = Math.round(ll * 0.5);
  return { irpj, csll, ll, dividendos, lancamentos: [
    { docRef: `${PREFIXO_DOC}MAR-09`, data: '2025-03-31', origem: 'manual', historico: `Apuração e provisão do IRPJ e da CSLL do 1º trimestre/2025 (Lucro Real trimestral) sobre o lucro de ${fmtR(lair)}: IRPJ 15%${lair > 6000000 ? ' + adicional 10%' : ''} e CSLL 9%`,
      itens: [{ conta: '5.8.01', dc: 'D', valor: irpj }, { conta: '5.8.02', dc: 'D', valor: csll }, { conta: '2.1.06', dc: 'C', valor: irpj }, { conta: '2.1.07', dc: 'C', valor: csll }] },
    { docRef: `${PREFIXO_DOC}MAR-10`, data: '2025-03-31', origem: 'dividendos', historico: `Distribuição de lucros aos sócios: 50% do lucro líquido do 1º trimestre/2025 (${fmtR(ll)}), em partes iguais (20% cada)`,
      itens: [{ conta: '3.5.01', dc: 'D', valor: dividendos }, { conta: '1.1.02', dc: 'C', valor: dividendos }] },
  ] };
}
const fmtR = c => reais(c).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Lucro antes do IR (centavos) do conjunto de lançamentos, pelas linhas da DRE do plano (sem ler o banco). */
export function lairDe(contas, lancamentos) {
  const mov = new Map(); for (const l of lancamentos) for (const i of l.itens) { const m = mov.get(i.conta) || mov.set(i.conta, { ant: 0, d: 0, c: 0 }).get(i.conta); m[i.dc === 'D' ? 'd' : 'c'] += i.valor; }
  const d = dre(contas, mov, { modelo: 'atual' }); return { lair: d.lair, receitaLiquida: d.rl, lucroLiquido: d.ll };
}
