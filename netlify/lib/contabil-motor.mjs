/* v13.86 · Motor do Módulo Contábil — funções puras (sem banco), testáveis isoladamente:
   plano de contas único (códigos, árvore, naturezas), classificação automática por IA (regras contábeis + aprendizado
   com o próprio plano), valores em centavos, plano padrão (comércio varejista) e os demonstrativos
   (Balancete, DRE com toggle Modelo Atual × Nova Reforma, Balanço, DMPL, DRA, DVA e apuração IRPJ/CSLL – LALUR/Presumido).
   Referências: Lei 6.404/76 (arts. 176-187), CPC 26 (R1) (DRE, DRA, DMPL), CPC 09 (DVA), CPC 47 (receita),
   ITG 2000, Decreto 9.580/2018 (RIR – LALUR, lucro presumido), EC 132/2023, LC 214/2025 (IBS/CBS/IS) e LC 224/2025. */

export const GRUPOS = {
  1: { nome: 'Ativo', natureza: 'D' }, 2: { nome: 'Passivo', natureza: 'C' }, 3: { nome: 'Patrimônio Líquido', natureza: 'C' },
  4: { nome: 'Receitas', natureza: 'C' }, 5: { nome: 'Custos e Despesas', natureza: 'D' },
};
export const DRE_LINHAS = { rb: 'Receita bruta', ded: 'Deduções da receita bruta', cmv: 'Custo das mercadorias/serviços vendidos', dv: 'Despesas com vendas', dga: 'Despesas gerais e administrativas', oro: 'Outras receitas operacionais', odo: 'Outras despesas operacionais', rf: 'Receitas financeiras', df: 'Despesas financeiras', ir: 'IRPJ e CSLL' };
export const DVA_LINHAS = { vendas: 'Vendas de mercadorias, produtos e serviços', outras_receitas: 'Outras receitas', pcld: 'Perdas estimadas em créditos (PCLD)', cmv: 'Custo das mercadorias e serviços vendidos', insumos: 'Materiais, energia, serviços de terceiros e outros', perda_ativos: 'Perda/recuperação de valores ativos', depreciacao: 'Depreciação, amortização e exaustão', transferencia: 'Receitas financeiras e outras recebidas em transferência', pessoal: 'Pessoal (remuneração, benefícios e FGTS)', imp_federais: 'Impostos, taxas e contribuições federais', imp_estaduais: 'Impostos, taxas e contribuições estaduais', imp_municipais: 'Impostos, taxas e contribuições municipais', juros: 'Juros e encargos financeiros', alugueis: 'Aluguéis', capital_proprio: 'Remuneração de capitais próprios (lucros retidos / prejuízo)' };
export const TRIBUTOS_ATUAIS = ['ICMS', 'PIS', 'COFINS', 'ISS', 'IPI'], TRIBUTOS_REFORMA = ['IBS', 'CBS', 'IS'];
const ESFERA = { ICMS: 'imp_estaduais', IBS: 'imp_estaduais', ISS: 'imp_municipais', PIS: 'imp_federais', COFINS: 'imp_federais', IPI: 'imp_federais', CBS: 'imp_federais', IS: 'imp_federais', IRPJ: 'imp_federais', CSLL: 'imp_federais', INSS: 'imp_federais' };

/* ---------------------------------------------------------------- utilitários */
export const normalizar = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9()\-+ ]/g, ' ').replace(/\s+/g, ' ').trim();
export class ErroContabil extends Error { constructor(msg, status = 422, extra) { super(msg); this.status = status; this.extra = extra; } }

/** Valor monetário → centavos (inteiro). Aceita 1234.56, "1234.56", "1.234,56", "R$ 1.234,56". Recusa zero, negativo e mais de 2 casas. */
export function centavos(v, { permitirZero = false } = {}) {
  let s = typeof v === 'number' ? (Number.isFinite(v) ? v.toFixed(10) : '') : String(v ?? '').replace(/R\$|\s/g, '');
  if (typeof v !== 'number') { if (/,\d{1,}$/.test(s) || (s.includes(',') && s.includes('.'))) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, ''); }
  const m = s.match(/^(-?)(\d+)(?:\.(\d+))?$/); if (!m) throw new ErroContabil(`Valor inválido: ${v}`);
  const dec = (m[3] || '').replace(/0+$/, ''); if (dec.length > 2) throw new ErroContabil(`Valor com mais de 2 casas decimais: ${v}`);
  const c = BigInt(m[2]) * 100n + BigInt((dec + '00').slice(0, 2)); if (m[1]) throw new ErroContabil(`Valor negativo não é aceito (use o lado D/C): ${v}`);
  if (c === 0n && !permitirZero) throw new ErroContabil('Valor zerado não é aceito.');
  if (c > 9_000_000_000_000_000n) throw new ErroContabil('Valor acima do limite.');
  return Number(c);
}
export const reais = c => Math.round(Number(c)) / 100;

export function partesCodigo(codigo) {
  const c = String(codigo ?? '').trim(); if (!/^[1-5](\.[0-9]{1,4}){0,7}$/.test(c)) throw new ErroContabil(`Código de conta inválido: "${codigo}" (ex.: 1.1.1.02.001)`);
  const s = c.split('.'); return { codigo: c, grupo: Number(s[0]), nivel: s.length, pai: s.length > 1 ? s.slice(0, -1).join('.') : null };
}
/** Próximo código livre debaixo de uma conta-mãe (segue a largura dos irmãos; 3 dígitos do 5º nível em diante, 2 no 4º, 1 no 2º/3º). */
export function proximoCodigo(pai, contas) {
  const nivel = pai.split('.').length + 1, irmaos = contas.filter(c => c.pai === pai).map(c => c.codigo.split('.').pop());
  const larg = irmaos.length ? Math.max(...irmaos.map(x => x.length)) : nivel >= 5 ? 3 : nivel === 4 ? 2 : 1;
  const n = (irmaos.length ? Math.max(...irmaos.map(Number)) : 0) + 1, lim = 10 ** Math.min(4, Math.max(larg, String(n).length)) - 1;
  if (n > lim) throw new ErroContabil(`Não há código livre debaixo de ${pai}.`);
  return pai + '.' + String(n).padStart(Math.max(larg, String(n).length), '0');
}
export const naturezaPadrao = (grupo, redutora) => { const n = GRUPOS[grupo].natureza; return redutora ? (n === 'D' ? 'C' : 'D') : n; };

/* ---------------------------------------------------------------- classificação automática (IA por regras + vizinhança no plano) */
const R = (re, d) => ({ re: new RegExp(re, 'i'), ...d });
/* Ordem importa pouco: cada regra soma pontos; vence a de maior peso. pai = conta-mãe sugerida no plano padrão. */
const REGRAS = [
  /* nomes de grupo (contas sintéticas): sobem para o nível de agrupamento */
  R('^(ativo circulante|ativo nao circulante)$', { grupo: 1, pai: '1', peso: 14, sint: true, m: 'grupo do Ativo' }),
  R('^(disponivel|disponibilidades|creditos|estoques|despesas antecipadas)$', { grupo: 1, pai: '1.1', peso: 14, sint: true, m: 'subgrupo do Ativo Circulante' }),
  R('^(realizavel a longo prazo|investimentos|imobilizado|intangivel)$', { grupo: 1, pai: '1.2', peso: 14, sint: true, m: 'subgrupo do Ativo Não Circulante' }),
  R('^(passivo circulante|passivo nao circulante)$', { grupo: 2, pai: '2', peso: 14, sint: true, m: 'grupo do Passivo' }),
  R('^(obrigacoes (trabalhistas|tributarias|fiscais|sociais)|emprestimos e financiamentos|fornecedores nacionais e estrangeiros)$', { grupo: 2, pai: '2.1', peso: 14, sint: true, m: 'subgrupo do Passivo Circulante' }),
  R('^(receita bruta|receitas operacionais|outras receitas operacionais|receitas financeiras)$', { grupo: 4, pai: '4', peso: 14, sint: true, m: 'grupo de receitas' }),
  R('^(\\(-\\) )?deducoes da receita( bruta)?$', { grupo: 4, pai: '4', peso: 14, sint: true, redutora: true, dre: 'ded', m: 'grupo de deduções da receita' }),
  R('^(despesas (administrativas|gerais e administrativas|com vendas|operacionais|financeiras|com pessoal)|custos? das vendas)$', { grupo: 5, pai: '5', peso: 14, sint: true, m: 'grupo de custos/despesas' }),
  /* ativo */
  R('\\b(caixa geral|caixa|fundo fixo|numerario)\\b(?! economica)', { grupo: 1, pai: '1.1.1.01', peso: 6, m: 'disponível em caixa' }),
  R('\\b(banco|bancos|conta corrente|conta movimento|itau|bradesco|santander|banco do brasil|caixa economica|nubank|sicredi|sicoob|safra|btg|inter|c6|mercado pago|pagbank|stone|cielo)\\b', { grupo: 1, pai: '1.1.1.02', peso: 7, m: 'banco / conta movimento (disponível)' }),
  R('\\b(aplicacao|aplicacoes|cdb|fundo de investimento|tesouro direto|poupanca)\\b', { grupo: 1, pai: '1.1.1.03', peso: 6, m: 'aplicação financeira de liquidez imediata' }),
  R('\\b(a receber|clientes|duplicatas|cartoes? a receber|recebiveis)\\b', { grupo: 1, pai: '1.1.2.01', peso: 10, m: 'direito a receber (crédito de clientes)' }),
  R('\\b(pcld|perdas estimadas|liquidacao duvidosa|provisao para (perdas|devedores))\\b', { grupo: 1, pai: '1.1.2.01', redutora: true, peso: 9, dva: 'pcld', m: 'retificadora do contas a receber (PECLD)' }),
  R('\\b(a recuperar|a compensar|credito de (icms|pis|cofins|ibs|cbs))\\b', { grupo: 1, pai: '1.1.2.02', peso: 9, m: 'tributo a recuperar (ativo)' }),
  R('\\badiantamentos? (a|de) (fornecedores|empregados|funcionarios|ferias)\\b', { grupo: 1, pai: '1.1.2.03', peso: 9, m: 'adiantamento concedido (ativo)' }),
  R('\\b(estoque|estoques|mercadorias para revenda)\\b', { grupo: 1, pai: '1.1.3.01', peso: 8, m: 'estoque' }),
  R('\\b(antecipad[ao]s?|a apropriar|seguros a vencer)\\b', { grupo: 1, pai: '1.1.4.01', peso: 9, m: 'despesa antecipada (competência futura)' }),
  R('\\b(deposito judicial|depositos judiciais)\\b', { grupo: 1, pai: '1.2.1.01', peso: 8, m: 'realizável a longo prazo' }),
  R('\\b(moveis|utensilios|maquinas|equipamentos|veiculos|computadores|informatica|benfeitorias|instalacoes|imovel|imoveis|terrenos|edificacoes)\\b', { grupo: 1, pai: '1.2.3.01', peso: 5, m: 'imobilizado (bem de uso)' }),
  R('\\b(depreciacao acumulada|amortizacao acumulada|exaustao acumulada)\\b', { grupo: 1, pai: '1.2.3.02', redutora: true, peso: 10, m: 'retificadora do imobilizado/intangível' }),
  R('\\b(software|licencas?|marcas|patentes|fundo de comercio|ponto comercial|luvas)\\b', { grupo: 1, pai: '1.2.4.01', peso: 6, m: 'intangível' }),
  R('\\b(participac(ao|oes) (societaria|em)|investimentos? em (controlada|coligada))\\b', { grupo: 1, pai: '1.2.2.01', peso: 8, m: 'investimento permanente' }),
  /* passivo */
  R('\\b(fornecedores?)\\b(?! adiant)', { grupo: 2, pai: '2.1.1.01', peso: 7, m: 'obrigação com fornecedores' }),
  R('\\b(salarios|ordenados|ferias|13o|decimo terceiro|rescisoes|pro labore)\\b.*\\ba pagar\\b|\\b(inss|fgts|irrf)\\b.*\\b(a recolher|a pagar)\\b', { grupo: 2, pai: '2.1.2.01', peso: 10, m: 'obrigação trabalhista' }),
  R('\\b(icms|pis|cofins|iss|ipi|ibs|cbs|imposto seletivo)\\b.*\\b(a recolher|a pagar)\\b', { grupo: 2, pai: '2.1.3.01', peso: 11, m: 'tributo sobre vendas a recolher' }),
  R('\\b(irpj|csll|imposto de renda|contribuicao social)\\b.*\\b(a recolher|a pagar)\\b', { grupo: 2, pai: '2.1.3.02', peso: 11, m: 'tributo sobre o lucro a recolher' }),
  R('\\b(emprestimos?|financiamentos?|capital de giro|antecipacao de recebiveis)\\b(?!.*juros)', { grupo: 2, pai: '2.1.4.01', peso: 6, m: 'empréstimos e financiamentos' }),
  R('\\b(longo prazo|lp)\\b.*\\b(emprestimos?|financiamentos?)\\b|\\b(emprestimos?|financiamentos?)\\b.*\\b(longo prazo|lp)\\b', { grupo: 2, pai: '2.2.1.01', peso: 9, m: 'exigível a longo prazo' }),
  R('\\bparcelamentos?\\b', { grupo: 2, pai: '2.2.1.02', peso: 7, m: 'parcelamento tributário' }),
  R('\\b(a pagar|a recolher|obrigacoes|dividendos a pagar|adiantamentos? de clientes)\\b', { grupo: 2, pai: '2.1.5.01', peso: 10, m: 'obrigação a pagar (passivo)' }),
  /* patrimônio líquido */
  R('\\bcapital (social|subscrito|integralizado)\\b', { grupo: 3, pai: '3.1', peso: 10, m: 'capital social' }),
  R('\\bcapital a integralizar\\b', { grupo: 3, pai: '3.1', redutora: true, peso: 11, m: 'retificadora do capital (a integralizar)' }),
  R('\\breservas? de capital\\b', { grupo: 3, pai: '3.2', peso: 10, m: 'reserva de capital' }),
  R('\\bajustes? de avaliacao patrimonial\\b', { grupo: 3, pai: '3.3', peso: 11, m: 'ajuste de avaliação patrimonial (ORA)' }),
  R('\\breserva (legal|de lucros|estatutaria|de retencao|de incentivos)\\b', { grupo: 3, pai: '3.4', peso: 10, m: 'reserva de lucros' }),
  R('\\b(lucros? (ou prejuizos? )?acumulados?|prejuizos? acumulados?)\\b', { grupo: 3, pai: '3.5', peso: 11, m: 'lucros ou prejuízos acumulados' }),
  R('\\b(acoes|quotas) em tesouraria\\b', { grupo: 3, pai: '3.6', redutora: true, peso: 11, m: 'retificadora do PL (tesouraria)' }),
  /* receitas */
  R('\\b(venda|vendas|faturamento|receita bruta)\\b(?!.*\\b(ativo|imobilizado)\\b)', { grupo: 4, pai: '4.1.1', peso: 7, dre: 'rb', dva: 'vendas', m: 'receita bruta de vendas', trib: 'mercadorias' }),
  R('\\b(servicos prestados|prestacao de servicos|receita de servicos)\\b', { grupo: 4, pai: '4.1.2', peso: 8, dre: 'rb', dva: 'vendas', m: 'receita bruta de serviços', trib: 'servicos' }),
  R('\\b(devolucao|devolucoes|abatimentos?|cancelamentos?) (de|sobre)? ?vendas\\b|\\(-\\) ?devolucoes', { grupo: 4, pai: '4.2.1', redutora: true, peso: 11, dre: 'ded', dva: 'vendas', m: 'dedução da receita (devoluções)' }),
  R('\\b(icms|pis|cofins|iss|ipi) (sobre|s/) ?(vendas|faturamento|servicos|receita)\\b', { grupo: 4, pai: '4.2.2', redutora: true, peso: 12, dre: 'ded', m: 'tributo sobre vendas — modelo atual (dedução)' }),
  R('\\b(ibs|cbs|imposto seletivo) (sobre|s/) ?(vendas|faturamento|servicos|receita)\\b', { grupo: 4, pai: '4.2.3', redutora: true, peso: 12, dre: 'ded', m: 'tributo sobre vendas — reforma (dedução)' }),
  R('\\b(rendimentos?|juros (recebidos|ativos)|descontos obtidos|receitas? financeiras?|variacao cambial ativa)\\b', { grupo: 4, pai: '4.4.1', peso: 9, dre: 'rf', dva: 'transferencia', m: 'receita financeira' }),
  R('\\b(recuperacao de despesas|receitas? diversas|outras receitas|receita de alugue|comissoes recebidas|ganho na venda)\\b', { grupo: 4, pai: '4.3.1', peso: 8, dre: 'oro', dva: 'outras_receitas', m: 'outra receita operacional' }),
  /* custos e despesas */
  R('\\b(cmv|custo das mercadorias|custo dos produtos|custo dos servicos)\\b', { grupo: 5, pai: '5.1.1', peso: 11, dre: 'cmv', dva: 'cmv', m: 'custo das vendas' }),
  R('\\bcomissoes (sobre vendas|de vendedores|a vendedores)\\b(?!.*a pagar)', { grupo: 5, pai: '5.2.1', peso: 9, dre: 'dv', dva: 'pessoal', m: 'comissão de vendedores (despesa com vendas · pessoal na DVA)' }),
  R('\\b(propaganda|publicidade|marketing|fretes sobre vendas|taxas? de cartao|mdr|brindes)\\b', { grupo: 5, pai: '5.2.1', peso: 8, dre: 'dv', dva: 'insumos', m: 'despesa com vendas' }),
  R('\\b(perdas com clientes|perdas em creditos|despesa com pcld|creditos incobraveis)\\b', { grupo: 5, pai: '5.2.1', peso: 10, dre: 'dv', dva: 'pcld', m: 'perda com créditos (despesa)' }),
  R('\\b(salarios|ordenados|ferias|13o|decimo terceiro|horas extras|pro labore|beneficios|vale (alimentacao|transporte|refeicao)|plano de saude|fgts|comissoes de vendedores|treinamento)\\b', { grupo: 5, pai: '5.3.1', peso: 8, dre: 'dga', dva: 'pessoal', m: 'despesa com pessoal' }),
  R('\\binss( patronal)?\\b|\\b(rat|sistema s|contribuicao previdenciaria)\\b', { grupo: 5, pai: '5.3.1', peso: 8, dre: 'dga', dva: 'imp_federais', m: 'encargo previdenciário (tributo federal na DVA)' }),
  R('\\b(aluguel|alugueis|aluguel de loja)\\b', { grupo: 5, pai: '5.3.2', peso: 8, dre: 'dga', dva: 'alugueis', m: 'despesa de aluguel (capital de terceiros na DVA)' }),
  R('\\b(condominio|fundo de promocao|energia|agua|esgoto|telefone|internet|gas)\\b', { grupo: 5, pai: '5.3.2', peso: 6, dre: 'dga', dva: 'insumos', m: 'despesa de ocupação/utilidades' }),
  R('\\b(depreciacao|amortizacao|exaustao)\\b(?!.*acumulad)', { grupo: 5, pai: '5.3.3', peso: 9, dre: 'dga', dva: 'depreciacao', m: 'despesa de depreciação/amortização' }),
  R('\\b(iptu|alvara|taxas municipais|tfe|tlf)\\b', { grupo: 5, pai: '5.3.3', peso: 9, dre: 'dga', dva: 'imp_municipais', m: 'taxa/imposto municipal (despesa)' }),
  R('\\b(ipva|taxas estaduais)\\b', { grupo: 5, pai: '5.3.3', peso: 9, dre: 'dga', dva: 'imp_estaduais', m: 'tributo estadual (despesa)' }),
  R('\\b(servicos de terceiros|honorarios|consultoria|assessoria|material de (uso|consumo|escritorio|limpeza)|manutencao|software as a service|sistemas|ti\\b|seguros|viagens|combustivel|despesas? (gerais|administrativas))\\b', { grupo: 5, pai: '5.3.3', peso: 5, dre: 'dga', dva: 'insumos', m: 'despesa administrativa' }),
  R('\\b(perdas? (na baixa|de ativos|com estoques)|baixa de imobilizado|multas)\\b', { grupo: 5, pai: '5.4.1', peso: 7, dre: 'odo', dva: 'perda_ativos', m: 'outra despesa operacional' }),
  R('\\b(juros (passivos|pagos|sobre)|despesas? (financeiras|bancarias)|tarifas bancarias|iof|encargos financeiros|desagio|antecipacao de recebiveis \\(juros\\)|variacao cambial passiva)\\b', { grupo: 5, pai: '5.5.1', peso: 9, dre: 'df', dva: 'juros', m: 'despesa financeira' }),
  R('\\b(irpj|csll|imposto de renda|contribuicao social sobre o lucro)\\b(?!.*(a recolher|a pagar|a compensar|a recuperar))', { grupo: 5, pai: '5.6.1', peso: 9, dre: 'ir', dva: 'imp_federais', m: 'tributo sobre o lucro (despesa)' }),
  R('\\b(despesa|despesas|gasto|gastos|custo|custos)\\b', { grupo: 5, pai: '5.3.3', peso: 3, dre: 'dga', dva: 'insumos', m: 'despesa (genérica)' }),
];
const SINTETICAS = /\b(ativo|ativo circulante|ativo nao circulante|disponivel|disponibilidades|creditos|estoques|imobilizado|intangivel|investimentos|passivo|passivo circulante|passivo nao circulante|obrigacoes (trabalhistas|tributarias|fiscais)|patrimonio liquido|reservas|receitas|receita bruta|deducoes|custos e despesas|despesas (administrativas|com vendas|com pessoal|operacionais|financeiras|gerais)|receitas financeiras|tributos (a recuperar|sobre)|grupo|subgrupo|total)\b/;
const PROPRIOS = /\b(itau|bradesco|santander|banco do brasil|caixa economica|nubank|sicredi|sicoob|safra|btg|inter|c6|stone|cielo|getnet|rede|loja \d+|filial|agencia|conta \d|n[ºo] ?\d)/;

/** Tributos ligados à conta (modelo atual × reforma) a partir do nome e da classificação. */
function tributosDe(n, r) {
  const t = new Set(); for (const x of [...TRIBUTOS_ATUAIS, 'IBS', 'CBS', 'IRPJ', 'CSLL', 'INSS']) if (new RegExp('\\b' + x.toLowerCase() + '\\b').test(n)) t.add(x);
  if (/\bimposto seletivo\b|\b(is)\b sobre/.test(n)) t.add('IS');
  if (r?.trib === 'mercadorias' && !t.size) ['ICMS', 'PIS', 'COFINS', 'IBS', 'CBS'].forEach(x => t.add(x));
  if (r?.trib === 'servicos' && !t.size) ['ISS', 'PIS', 'COFINS', 'IBS', 'CBS'].forEach(x => t.add(x));
  if (/\b(compras?|cmv|custo das mercadorias)\b/.test(n) && !t.size) ['ICMS', 'PIS', 'COFINS', 'IBS', 'CBS'].forEach(x => t.add(x));
  if (/\b(bebidas|cigarros|tabaco|combustiveis|veiculos novos|apostas|minerais)\b/.test(n) && r?.grupo === 4) t.add('IS');
  const l = [...t], at = l.some(x => TRIBUTOS_ATUAIS.includes(x)), rf = l.some(x => TRIBUTOS_REFORMA.includes(x)), lucro = l.some(x => ['IRPJ', 'CSLL', 'INSS'].includes(x));
  return { tributos: l, modelo: at && rf ? 'ambos' : at ? 'atual' : rf ? 'reforma' : lucro ? 'ambos' : 'nenhum' };
}
const tokens = s => new Set(normalizar(s).split(' ').filter(w => w.length > 2 && !['de', 'da', 'do', 'das', 'dos', 'sobre', 'com', 'para', 'por'].includes(w)));
function jaccard(a, b) { const A = tokens(a), B = tokens(b); if (!A.size || !B.size) return 0; let i = 0; A.forEach(x => { if (B.has(x)) i++; }); return i / (A.size + B.size - i); }

/**
 * Classifica uma conta pelo nome: grupo, natureza, tipo, conta-mãe e código sugeridos, linhas da DRE/DVA e vínculo tributário.
 * "IA" = regras contábeis com pesos + aprendizado pelo próprio plano (contas parecidas já cadastradas puxam a mesma mãe).
 */
export function classificar(nome, contas = [], { pai: paiInformado } = {}) {
  const n = normalizar(nome); if (n.length < 2) throw new ErroContabil('Informe o nome da conta.');
  const achadas = REGRAS.map(r => ({ r, ok: r.re.test(n) })).filter(x => x.ok).map(x => x.r).sort((a, b) => b.peso - a.peso);
  let r = achadas[0] || null; const motivos = [];
  const porCodigo = new Map(contas.map(c => [c.codigo, c]));
  /* vizinhança: a conta analítica mais parecida já existente */
  let viz = null; for (const c of contas) { if (c.tipo !== 'A') continue; const s = jaccard(nome, c.nome); if (s > (viz?.s || 0)) viz = { c, s }; }
  let pai = paiInformado && porCodigo.get(paiInformado)?.tipo === 'S' ? paiInformado : null, grupo, conf;
  if (pai) { grupo = Number(pai[0]); conf = 0.95; motivos.push('conta-mãe informada'); }
  else if (r && (!viz || viz.s < 0.6 || r.peso >= 9)) { grupo = r.grupo; pai = r.pai; conf = Math.min(0.97, 0.55 + r.peso * 0.035); motivos.push('regra: ' + r.m); }
  else if (viz && viz.s >= 0.34) { grupo = viz.c.grupo; pai = viz.c.pai; conf = Math.min(0.9, 0.45 + viz.s / 2); motivos.push(`parecida com "${viz.c.nome}" (${viz.c.codigo})`); r = r && r.grupo === grupo ? r : null; }
  else { grupo = 5; pai = '5.3.3'; conf = 0.3; motivos.push('sem regra específica: sugerida como despesa administrativa — revise'); }
  if (pai && !porCodigo.has(pai) && contas.length) { // a mãe sugerida não existe neste plano: sobe até achar uma sintética
    let p = pai; while (p && !porCodigo.has(p)) p = p.includes('.') ? p.slice(0, p.lastIndexOf('.')) : null; pai = p || String(grupo); if (!porCodigo.has(pai)) pai = null;
  }
  const mae = pai ? porCodigo.get(pai) : null;
  const redutora = !!(r?.redutora || /^\(-\)|\bretificadora\b/.test(String(nome).trim().toLowerCase()) || (mae?.redutora));
  const tipo = r?.sint || (SINTETICAS.test(n) && !PROPRIOS.test(n) && !/\b(a pagar|a receber|a recolher|a recuperar)\b/.test(n)) ? 'S' : 'A';
  if (tipo === 'S') motivos.push('nome de grupo → sintética (agrupa outras contas)'); else motivos.push(PROPRIOS.test(n) ? 'conta específica (banco/estabelecimento) → analítica' : 'conta de movimento → analítica');
  const natureza = naturezaPadrao(grupo, redutora); if (redutora) motivos.push(`retificadora: natureza ${natureza === 'D' ? 'devedora' : 'credora'}, oposta à do grupo ${GRUPOS[grupo].nome}`);
  const tr = tributosDe(n, { ...r, grupo });
  let dre = grupo >= 4 ? (r?.dre || mae?.dre || (grupo === 4 ? 'oro' : 'dga')) : null, dva = grupo >= 4 ? (r?.dva || mae?.dva || null) : null;
  if (dre === 'ded' && !dva) { const t = tr.tributos.find(x => ESFERA[x]); dva = t ? ESFERA[t] : 'vendas'; }
  if (grupo >= 4 && !dva) dva = { rb: 'vendas', oro: 'outras_receitas', rf: 'transferencia', cmv: 'cmv', df: 'juros', ir: 'imp_federais' }[dre] || 'insumos';
  let codigo = null; try { if (pai) codigo = proximoCodigo(pai, contas); } catch { /* sem código livre */ }
  return { nome: String(nome).trim(), grupo, grupoNome: GRUPOS[grupo].nome, natureza, tipo, redutora, pai, codigo, dre, dva, tributos: tr.tributos, modeloTributario: tr.modelo, confianca: Math.round(conf * 100) / 100, motivos };
}

/** Valida a conta antes de gravar (coerência de grupo, natureza, mãe sintética, retificadora). Devolve a conta normalizada. */
export function validarConta(d, contas) {
  const { codigo, grupo, nivel, pai } = partesCodigo(d.codigo), porCodigo = new Map(contas.map(c => [c.codigo, c]));
  const nome = String(d.nome ?? '').trim().replace(/\s+/g, ' '); if (nome.length < 2 || nome.length > 160) throw new ErroContabil('O nome da conta deve ter de 2 a 160 caracteres.');
  if (pai) { const m = porCodigo.get(pai); if (!m) throw new ErroContabil(`A conta-mãe ${pai} não existe — crie a sintética antes.`); if (m.tipo !== 'S') throw new ErroContabil(`A conta-mãe ${pai} é analítica: só contas sintéticas agrupam outras.`); }
  const tipo = d.tipo === 'S' ? 'S' : 'A', redutora = !!d.redutora || !!(pai && porCodigo.get(pai)?.redutora && d.redutora !== false), natureza = d.natureza || naturezaPadrao(grupo, redutora);
  if (!['D', 'C'].includes(natureza)) throw new ErroContabil('Natureza deve ser D (devedora) ou C (credora).');
  if (natureza !== naturezaPadrao(grupo, redutora)) throw new ErroContabil(`Natureza incoerente: contas do grupo ${grupo} · ${GRUPOS[grupo].nome} são ${GRUPOS[grupo].natureza === 'D' ? 'devedoras' : 'credoras'}${redutora ? ' (retificadoras, o oposto)' : ' — marque como retificadora se for uma conta redutora'}.`);
  const tributos = [...new Set((d.tributos || []).map(x => String(x).toUpperCase()))]; const bad = tributos.filter(x => ![...TRIBUTOS_ATUAIS, ...TRIBUTOS_REFORMA, 'IRPJ', 'CSLL', 'INSS'].includes(x)); if (bad.length) throw new ErroContabil('Tributo desconhecido: ' + bad.join(', '));
  const at_ = tributos.some(x => TRIBUTOS_ATUAIS.includes(x)), rf_ = tributos.some(x => TRIBUTOS_REFORMA.includes(x)), modelo = d.modeloTributario || (at_ && rf_ ? 'ambos' : at_ ? 'atual' : rf_ ? 'reforma' : tributos.length ? 'ambos' : 'nenhum'); if (!['nenhum', 'atual', 'reforma', 'ambos'].includes(modelo)) throw new ErroContabil('Modelo tributário inválido.');
  if (d.dre && !DRE_LINHAS[d.dre]) throw new ErroContabil('Linha da DRE inválida.'); if (d.dva && !DVA_LINHAS[d.dva]) throw new ErroContabil('Linha da DVA inválida.');
  if (grupo < 4 && (d.dre || d.dva)) throw new ErroContabil('DRE e DVA só se aplicam às contas de resultado (grupos 4 e 5).');
  return { codigo, nome, grupo, nivel, pai, tipo, natureza, redutora, dre: d.dre || null, dva: d.dva || null, tributos, modeloTributario: modelo };
}

/** Lançamento: valida as partidas e a partida dobrada (soma dos débitos = soma dos créditos). Devolve itens em centavos. */
export function validarLancamento(d, contasPorCodigo) {
  const data = String(d.data || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || isNaN(Date.parse(data + 'T12:00:00Z'))) throw new ErroContabil('Data do lançamento inválida (AAAA-MM-DD).');
  const historico = String(d.historico || '').trim(); if (historico.length < 3) throw new ErroContabil('Informe o histórico do lançamento.');
  const itens = Array.isArray(d.itens) ? d.itens : []; if (itens.length < 2) throw new ErroContabil('Partidas dobradas: informe ao menos um débito e um crédito.'); if (itens.length > 500) throw new ErroContabil('Máximo de 500 partidas por lançamento.');
  let deb = 0, cred = 0; const out = itens.map((it, i) => {
    const dc = String(it.dc || it.tipo || '').toUpperCase()[0], c = contasPorCodigo.get(String(it.conta || '').trim()), v = centavos(it.valor);
    if (!['D', 'C'].includes(dc)) throw new ErroContabil(`Partida ${i + 1}: informe D (débito) ou C (crédito).`);
    if (!c) throw new ErroContabil(`Partida ${i + 1}: conta ${it.conta} não existe no plano de contas.`);
    if (c.tipo !== 'A') throw new ErroContabil(`Partida ${i + 1}: a conta ${c.codigo} · ${c.nome} é sintética — lance numa conta analítica.`);
    if (!c.ativa) throw new ErroContabil(`Partida ${i + 1}: a conta ${c.codigo} · ${c.nome} está inativa.`);
    if (dc === 'D') deb += v; else cred += v;
    return { seq: i + 1, conta: c.codigo, dc, valor: v, centro: it.centro ? String(it.centro).slice(0, 120) : null, historico: it.historico ? String(it.historico).slice(0, 300) : null };
  });
  if (!deb || !cred) throw new ErroContabil('Partidas dobradas: o lançamento precisa de ao menos um débito e um crédito.');
  if (deb !== cred) throw new ErroContabil(`Partidas dobradas: débitos (${fmt(deb)}) diferentes dos créditos (${fmt(cred)}) — diferença de ${fmt(Math.abs(deb - cred))}.`, 422, { debitos: reais(deb), creditos: reais(cred) });
  return { data, historico, itens: out, total: deb };
}
export const fmt = c => (Number(c) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/* ---------------------------------------------------------------- plano padrão (comércio varejista) */
/* [código, nome, tipo, extras] — natureza pelo grupo (retificadoras: o oposto). Pode ser estendido pela tela do Módulo Contábil. */
const A = 'A', S = 'S', at = ['ICMS', 'PIS', 'COFINS'], merc = { tributos: ['ICMS', 'PIS', 'COFINS', 'IBS', 'CBS'], modeloTributario: 'ambos' };
const red = { redutora: true };
export const PLANO_PADRAO = [
  ['1', 'ATIVO', S], ['1.1', 'ATIVO CIRCULANTE', S], ['1.1.1', 'DISPONÍVEL', S],
  ['1.1.1.01', 'Caixa', S], ['1.1.1.01.001', 'Caixa Geral', A], ['1.1.1.01.002', 'Fundo Fixo de Caixa das Lojas', A],
  ['1.1.1.02', 'Bancos Conta Movimento', S], ['1.1.1.02.001', 'Banco Conta Movimento Principal', A],
  ['1.1.1.03', 'Aplicações Financeiras de Liquidez Imediata', S], ['1.1.1.03.001', 'Aplicações Automáticas', A],
  ['1.1.2', 'CRÉDITOS', S], ['1.1.2.01', 'Clientes', S], ['1.1.2.01.001', 'Duplicatas a Receber', A], ['1.1.2.01.002', 'Cartões de Crédito e Débito a Receber', A], ['1.1.2.01.003', 'Cartão Próprio (Private Label) a Receber', A], ['1.1.2.01.009', '(-) Perdas Estimadas em Créditos de Liquidação Duvidosa', A, red],
  ['1.1.2.02', 'Tributos a Recuperar', S], ['1.1.2.02.001', 'ICMS a Recuperar', A, { tributos: ['ICMS'], modeloTributario: 'atual' }], ['1.1.2.02.002', 'PIS a Recuperar', A, { tributos: ['PIS'], modeloTributario: 'atual' }], ['1.1.2.02.003', 'COFINS a Recuperar', A, { tributos: ['COFINS'], modeloTributario: 'atual' }],
  ['1.1.2.02.004', 'IBS a Recuperar', A, { tributos: ['IBS'], modeloTributario: 'reforma' }], ['1.1.2.02.005', 'CBS a Recuperar', A, { tributos: ['CBS'], modeloTributario: 'reforma' }], ['1.1.2.02.006', 'IRPJ e CSLL a Compensar', A, { tributos: ['IRPJ', 'CSLL'], modeloTributario: 'ambos' }],
  ['1.1.2.03', 'Outros Créditos', S], ['1.1.2.03.001', 'Adiantamentos a Fornecedores', A], ['1.1.2.03.002', 'Adiantamentos a Empregados', A],
  ['1.1.3', 'ESTOQUES', S], ['1.1.3.01', 'Mercadorias para Revenda', S], ['1.1.3.01.001', 'Estoque de Mercadorias', A],
  ['1.1.4', 'DESPESAS ANTECIPADAS', S], ['1.1.4.01', 'Despesas do Exercício Seguinte', S], ['1.1.4.01.001', 'Seguros a Apropriar', A], ['1.1.4.01.002', 'Aluguéis Antecipados', A],
  ['1.2', 'ATIVO NÃO CIRCULANTE', S], ['1.2.1', 'REALIZÁVEL A LONGO PRAZO', S], ['1.2.1.01', 'Créditos de Longo Prazo', S], ['1.2.1.01.001', 'Depósitos Judiciais', A], ['1.2.1.01.002', 'IRPJ e CSLL Diferidos (Ativo)', A, { tributos: ['IRPJ', 'CSLL'], modeloTributario: 'ambos' }],
  ['1.2.2', 'INVESTIMENTOS', S], ['1.2.2.01', 'Participações Societárias', S], ['1.2.2.01.001', 'Participações em Outras Sociedades', A],
  ['1.2.3', 'IMOBILIZADO', S], ['1.2.3.01', 'Bens em Operação', S], ['1.2.3.01.001', 'Móveis e Utensílios', A], ['1.2.3.01.002', 'Máquinas e Equipamentos', A], ['1.2.3.01.003', 'Equipamentos de Informática', A], ['1.2.3.01.004', 'Veículos', A], ['1.2.3.01.005', 'Benfeitorias em Imóveis de Terceiros', A],
  ['1.2.3.02', '(-) Depreciação e Amortização Acumuladas', S, red], ['1.2.3.02.001', '(-) Depreciação Acumulada de Móveis e Utensílios', A, red], ['1.2.3.02.002', '(-) Depreciação Acumulada de Máquinas e Equipamentos', A, red], ['1.2.3.02.003', '(-) Depreciação Acumulada de Equipamentos de Informática', A, red], ['1.2.3.02.004', '(-) Depreciação Acumulada de Veículos', A, red], ['1.2.3.02.005', '(-) Amortização Acumulada de Benfeitorias', A, red],
  ['1.2.4', 'INTANGÍVEL', S], ['1.2.4.01', 'Ativos Intangíveis', S], ['1.2.4.01.001', 'Softwares e Licenças de Uso', A], ['1.2.4.01.002', 'Marcas e Patentes', A], ['1.2.4.01.003', 'Fundo de Comércio (Pontos Comerciais)', A],
  ['1.2.4.02', '(-) Amortização Acumulada do Intangível', S, red], ['1.2.4.02.001', '(-) Amortização Acumulada de Softwares', A, red],
  ['2', 'PASSIVO', S], ['2.1', 'PASSIVO CIRCULANTE', S], ['2.1.1', 'OBRIGAÇÕES COM FORNECEDORES', S], ['2.1.1.01', 'Fornecedores', S], ['2.1.1.01.001', 'Fornecedores Nacionais', A],
  ['2.1.2', 'OBRIGAÇÕES TRABALHISTAS E PREVIDENCIÁRIAS', S], ['2.1.2.01', 'Salários e Encargos a Pagar', S], ['2.1.2.01.001', 'Salários a Pagar', A], ['2.1.2.01.002', 'INSS a Recolher', A, { tributos: ['INSS'], modeloTributario: 'ambos' }], ['2.1.2.01.003', 'FGTS a Recolher', A], ['2.1.2.01.004', 'Férias e 13º Salário a Pagar', A],
  ['2.1.3', 'OBRIGAÇÕES TRIBUTÁRIAS', S], ['2.1.3.01', 'Tributos sobre Vendas a Recolher', S], ['2.1.3.01.001', 'ICMS a Recolher', A, { tributos: ['ICMS'], modeloTributario: 'atual' }], ['2.1.3.01.002', 'PIS a Recolher', A, { tributos: ['PIS'], modeloTributario: 'atual' }], ['2.1.3.01.003', 'COFINS a Recolher', A, { tributos: ['COFINS'], modeloTributario: 'atual' }], ['2.1.3.01.004', 'ISS a Recolher', A, { tributos: ['ISS'], modeloTributario: 'atual' }],
  ['2.1.3.01.005', 'IBS a Recolher', A, { tributos: ['IBS'], modeloTributario: 'reforma' }], ['2.1.3.01.006', 'CBS a Recolher', A, { tributos: ['CBS'], modeloTributario: 'reforma' }], ['2.1.3.01.007', 'Imposto Seletivo a Recolher', A, { tributos: ['IS'], modeloTributario: 'reforma' }],
  ['2.1.3.02', 'Tributos sobre o Lucro a Recolher', S], ['2.1.3.02.001', 'IRPJ a Recolher', A, { tributos: ['IRPJ'], modeloTributario: 'ambos' }], ['2.1.3.02.002', 'CSLL a Recolher', A, { tributos: ['CSLL'], modeloTributario: 'ambos' }],
  ['2.1.4', 'EMPRÉSTIMOS E FINANCIAMENTOS', S], ['2.1.4.01', 'Empréstimos de Curto Prazo', S], ['2.1.4.01.001', 'Empréstimos Bancários', A], ['2.1.4.01.002', 'Antecipação de Recebíveis de Cartão', A],
  ['2.1.5', 'OUTRAS OBRIGAÇÕES', S], ['2.1.5.01', 'Contas a Pagar', S], ['2.1.5.01.001', 'Aluguéis a Pagar', A], ['2.1.5.01.002', 'Energia e Utilidades a Pagar', A], ['2.1.5.01.003', 'Dividendos e Lucros a Distribuir', A], ['2.1.5.01.004', 'Repasses do Cartão Próprio a Pagar', A],
  ['2.2', 'PASSIVO NÃO CIRCULANTE', S], ['2.2.1', 'EXIGÍVEL A LONGO PRAZO', S], ['2.2.1.01', 'Empréstimos e Financiamentos de Longo Prazo', S], ['2.2.1.01.001', 'Financiamentos Bancários de Longo Prazo', A], ['2.2.1.02', 'Parcelamentos Tributários', S], ['2.2.1.02.001', 'Parcelamentos de Tributos de Longo Prazo', A],
  ['3', 'PATRIMÔNIO LÍQUIDO', S], ['3.1', 'CAPITAL SOCIAL', S], ['3.1.1', 'Capital Social Subscrito', A], ['3.1.2', '(-) Capital a Integralizar', A, red],
  ['3.2', 'RESERVAS DE CAPITAL', S], ['3.2.1', 'Reservas de Capital', A], ['3.3', 'AJUSTES DE AVALIAÇÃO PATRIMONIAL', S], ['3.3.1', 'Ajustes de Avaliação Patrimonial', A],
  ['3.4', 'RESERVAS DE LUCROS', S], ['3.4.1', 'Reserva Legal', A], ['3.4.2', 'Reserva de Retenção de Lucros', A], ['3.5', 'LUCROS OU PREJUÍZOS ACUMULADOS', S], ['3.5.1', 'Lucros ou Prejuízos Acumulados', A],
  ['3.6', '(-) QUOTAS EM TESOURARIA', S, red], ['3.6.1', '(-) Quotas em Tesouraria', A, red],
  ['4', 'RECEITAS', S], ['4.1', 'RECEITA BRUTA', S, { dre: 'rb', dva: 'vendas' }], ['4.1.1', 'Vendas de Mercadorias', S, { dre: 'rb', dva: 'vendas' }], ['4.1.1.01', 'Vendas de Mercadorias à Vista', A, { dre: 'rb', dva: 'vendas', ...merc }], ['4.1.1.02', 'Vendas de Mercadorias a Prazo', A, { dre: 'rb', dva: 'vendas', ...merc }],
  ['4.1.2', 'Prestação de Serviços', S, { dre: 'rb', dva: 'vendas' }], ['4.1.2.01', 'Receita de Serviços', A, { dre: 'rb', dva: 'vendas', tributos: ['ISS', 'PIS', 'COFINS', 'IBS', 'CBS'], modeloTributario: 'ambos' }],
  ['4.2', '(-) DEDUÇÕES DA RECEITA BRUTA', S, { ...red, dre: 'ded' }], ['4.2.1', '(-) Devoluções e Abatimentos', S, { ...red, dre: 'ded', dva: 'vendas' }], ['4.2.1.01', '(-) Devoluções de Vendas', A, { ...red, dre: 'ded', dva: 'vendas' }],
  ['4.2.2', '(-) Tributos sobre Vendas — Modelo Atual', S, { ...red, dre: 'ded' }], ['4.2.2.01', '(-) ICMS sobre Vendas', A, { ...red, dre: 'ded', dva: 'imp_estaduais', tributos: ['ICMS'], modeloTributario: 'atual' }], ['4.2.2.02', '(-) PIS sobre Vendas', A, { ...red, dre: 'ded', dva: 'imp_federais', tributos: ['PIS'], modeloTributario: 'atual' }], ['4.2.2.03', '(-) COFINS sobre Vendas', A, { ...red, dre: 'ded', dva: 'imp_federais', tributos: ['COFINS'], modeloTributario: 'atual' }], ['4.2.2.04', '(-) ISS sobre Serviços', A, { ...red, dre: 'ded', dva: 'imp_municipais', tributos: ['ISS'], modeloTributario: 'atual' }],
  ['4.2.3', '(-) Tributos sobre Vendas — Reforma Tributária', S, { ...red, dre: 'ded' }], ['4.2.3.01', '(-) IBS sobre Vendas', A, { ...red, dre: 'ded', dva: 'imp_estaduais', tributos: ['IBS'], modeloTributario: 'reforma' }], ['4.2.3.02', '(-) CBS sobre Vendas', A, { ...red, dre: 'ded', dva: 'imp_federais', tributos: ['CBS'], modeloTributario: 'reforma' }], ['4.2.3.03', '(-) Imposto Seletivo', A, { ...red, dre: 'ded', dva: 'imp_federais', tributos: ['IS'], modeloTributario: 'reforma' }],
  ['4.3', 'OUTRAS RECEITAS OPERACIONAIS', S, { dre: 'oro', dva: 'outras_receitas' }], ['4.3.1', 'Receitas Diversas', S, { dre: 'oro', dva: 'outras_receitas' }], ['4.3.1.01', 'Recuperação de Despesas', A, { dre: 'oro', dva: 'outras_receitas' }], ['4.3.1.02', 'Receitas de Aluguéis e Comissões', A, { dre: 'oro', dva: 'transferencia' }],
  ['4.4', 'RECEITAS FINANCEIRAS', S, { dre: 'rf', dva: 'transferencia' }], ['4.4.1', 'Receitas Financeiras', S, { dre: 'rf', dva: 'transferencia' }], ['4.4.1.01', 'Rendimentos de Aplicações Financeiras', A, { dre: 'rf', dva: 'transferencia' }], ['4.4.1.02', 'Juros Recebidos e Descontos Obtidos', A, { dre: 'rf', dva: 'transferencia' }],
  ['5', 'CUSTOS E DESPESAS', S], ['5.1', 'CUSTO DAS MERCADORIAS VENDIDAS', S, { dre: 'cmv', dva: 'cmv' }], ['5.1.1', 'Custo das Vendas', S, { dre: 'cmv', dva: 'cmv' }], ['5.1.1.01', 'Custo das Mercadorias Vendidas', A, { dre: 'cmv', dva: 'cmv', ...merc }],
  ['5.2', 'DESPESAS COM VENDAS', S, { dre: 'dv', dva: 'insumos' }], ['5.2.1', 'Despesas Comerciais', S, { dre: 'dv', dva: 'insumos' }], ['5.2.1.01', 'Comissões sobre Vendas', A, { dre: 'dv', dva: 'pessoal' }], ['5.2.1.02', 'Propaganda e Publicidade', A, { dre: 'dv', dva: 'insumos' }], ['5.2.1.03', 'Taxas de Administração de Cartões (MDR)', A, { dre: 'dv', dva: 'insumos' }], ['5.2.1.04', 'Perdas com Créditos de Clientes', A, { dre: 'dv', dva: 'pcld' }],
  ['5.3', 'DESPESAS GERAIS E ADMINISTRATIVAS', S, { dre: 'dga', dva: 'insumos' }], ['5.3.1', 'Despesas com Pessoal', S, { dre: 'dga', dva: 'pessoal' }], ['5.3.1.01', 'Salários e Ordenados', A, { dre: 'dga', dva: 'pessoal' }], ['5.3.1.02', 'Férias e 13º Salário', A, { dre: 'dga', dva: 'pessoal' }], ['5.3.1.03', 'INSS Patronal', A, { dre: 'dga', dva: 'imp_federais', tributos: ['INSS'], modeloTributario: 'ambos' }], ['5.3.1.04', 'FGTS', A, { dre: 'dga', dva: 'pessoal' }], ['5.3.1.05', 'Benefícios (Alimentação, Transporte e Saúde)', A, { dre: 'dga', dva: 'pessoal' }],
  ['5.3.2', 'Despesas com Ocupação', S, { dre: 'dga', dva: 'insumos' }], ['5.3.2.01', 'Aluguéis de Lojas', A, { dre: 'dga', dva: 'alugueis' }], ['5.3.2.02', 'Condomínio e Fundo de Promoção', A, { dre: 'dga', dva: 'insumos' }], ['5.3.2.03', 'Energia Elétrica', A, { dre: 'dga', dva: 'insumos' }], ['5.3.2.04', 'Água e Esgoto', A, { dre: 'dga', dva: 'insumos' }],
  ['5.3.3', 'Despesas Gerais', S, { dre: 'dga', dva: 'insumos' }], ['5.3.3.01', 'Serviços de Terceiros', A, { dre: 'dga', dva: 'insumos' }], ['5.3.3.02', 'Material de Uso e Consumo', A, { dre: 'dga', dva: 'insumos' }], ['5.3.3.03', 'Tecnologia da Informação', A, { dre: 'dga', dva: 'insumos' }], ['5.3.3.04', 'Depreciação e Amortização', A, { dre: 'dga', dva: 'depreciacao' }], ['5.3.3.05', 'Taxas e Impostos Municipais (IPTU, Alvarás)', A, { dre: 'dga', dva: 'imp_municipais' }],
  ['5.4', 'OUTRAS DESPESAS OPERACIONAIS', S, { dre: 'odo', dva: 'perda_ativos' }], ['5.4.1', 'Outras Despesas', S, { dre: 'odo', dva: 'perda_ativos' }], ['5.4.1.01', 'Perdas na Baixa de Ativos', A, { dre: 'odo', dva: 'perda_ativos' }], ['5.4.1.02', 'Multas e Penalidades', A, { dre: 'odo', dva: 'insumos' }],
  ['5.5', 'DESPESAS FINANCEIRAS', S, { dre: 'df', dva: 'juros' }], ['5.5.1', 'Despesas Financeiras', S, { dre: 'df', dva: 'juros' }], ['5.5.1.01', 'Juros sobre Empréstimos', A, { dre: 'df', dva: 'juros' }], ['5.5.1.02', 'Juros de Antecipação de Recebíveis', A, { dre: 'df', dva: 'juros' }], ['5.5.1.03', 'Tarifas Bancárias e IOF', A, { dre: 'df', dva: 'juros' }],
  ['5.6', 'TRIBUTOS SOBRE O LUCRO', S, { dre: 'ir', dva: 'imp_federais' }], ['5.6.1', 'IRPJ e CSLL', S, { dre: 'ir', dva: 'imp_federais' }], ['5.6.1.01', 'IRPJ Corrente', A, { dre: 'ir', dva: 'imp_federais', tributos: ['IRPJ'], modeloTributario: 'ambos' }], ['5.6.1.02', 'CSLL Corrente', A, { dre: 'ir', dva: 'imp_federais', tributos: ['CSLL'], modeloTributario: 'ambos' }], ['5.6.1.03', 'IRPJ e CSLL Diferidos', A, { dre: 'ir', dva: 'imp_federais', tributos: ['IRPJ', 'CSLL'], modeloTributario: 'ambos' }],
].map(([codigo, nome, tipo, x = {}]) => { const { grupo, nivel, pai } = partesCodigo(codigo); return { codigo, nome, tipo, grupo, nivel, pai, redutora: !!x.redutora, natureza: naturezaPadrao(grupo, !!x.redutora), dre: x.dre || null, dva: x.dva || null, tributos: x.tributos || [], modeloTributario: x.modeloTributario || 'nenhum' }; });
void at;

/* ---------------------------------------------------------------- saldos e demonstrativos */
/** saldos: Map(conta → { ant, d, c }) em centavos (ant = D − C antes do período). Devolve linhas por conta (com as sintéticas somadas). */
export function balancete(contas, saldos) {
  const filhas = new Map(); contas.forEach(c => { if (c.pai) (filhas.get(c.pai) || filhas.set(c.pai, []).get(c.pai)).push(c.codigo); });
  const memo = new Map(), soma = cod => { if (memo.has(cod)) return memo.get(cod); const s = { ...(saldos.get(cod) || { ant: 0, d: 0, c: 0 }) }; for (const f of filhas.get(cod) || []) { const x = soma(f); s.ant += x.ant; s.d += x.d; s.c += x.c; } memo.set(cod, s); return s; };
  const linhas = [...contas].sort((a, b) => cmpCodigo(a.codigo, b.codigo)).map(c => { const s = soma(c.codigo), fim = s.ant + s.d - s.c; return { codigo: c.codigo, nome: c.nome, tipo: c.tipo, nivel: c.nivel, grupo: c.grupo, natureza: c.natureza, saldoAnterior: s.ant, debitos: s.d, creditos: s.c, saldoFinal: fim }; })
    .filter(l => l.saldoAnterior || l.debitos || l.creditos || l.saldoFinal);
  const raiz = linhas.filter(l => l.nivel === 1), tot = k => raiz.reduce((a, l) => a + l[k], 0);
  return { linhas, totais: { debitos: tot('debitos'), creditos: tot('creditos'), saldoDevedor: raiz.filter(l => l.saldoFinal > 0).reduce((a, l) => a + l.saldoFinal, 0), saldoCredor: -raiz.filter(l => l.saldoFinal < 0).reduce((a, l) => a + l.saldoFinal, 0) }, confere: tot('debitos') === tot('creditos') && tot('saldoFinal') === 0 };
}
export const cmpCodigo = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { if (x[i] === undefined) return -1; if (y[i] === undefined) return 1; if (x[i] !== y[i]) return x[i] - y[i]; } return 0; };

/** movimento do período por conta analítica, no sentido "natural" do resultado: receita (C − D), despesa (D − C). */
function movimentos(contas, mov) { return contas.filter(c => c.tipo === 'A' && c.grupo >= 4).map(c => { const m = mov.get(c.codigo) || { d: 0, c: 0 }; return { c, cred: m.c - m.d, deb: m.d - m.c }; }); }

/* Reforma Tributária (EC 132/2023, LC 214/2025): cronograma de transição. fatorAtual = parcela que ainda vale do ICMS/ISS;
   PIS/COFINS deixam de existir em 2027 (CBS plena); em 2026 CBS 0,9% e IBS 0,1% são de teste (compensáveis → custo zero). */
export function transicao(ano, aliq = {}) {
  const cbs = aliq.cbs ?? 0.088, ibs = aliq.ibs ?? 0.177, y = Number(ano) || 2033;
  if (y <= 2026) return { ano: y, teste: true, cbs: 0.009, ibs: 0.001, pisCofins: 1, icmsIss: 1, nota: '2026: ano de teste — CBS 0,9% e IBS 0,1% destacados e compensáveis com PIS/COFINS (sem custo adicional).' };
  if (y <= 2028) return { ano: y, cbs: Math.max(0, cbs - 0.001), ibs: 0.001, pisCofins: 0, icmsIss: 1, nota: `${y}: CBS plena (PIS/COFINS extintos) reduzida em 0,1 p.p.; IBS de 0,1%; ICMS/ISS integrais; Imposto Seletivo em vigor.` };
  const f = { 2029: 0.9, 2030: 0.8, 2031: 0.7, 2032: 0.6 }[y] ?? 0;
  return { ano: y, cbs, ibs: ibs * (1 - f), pisCofins: 0, icmsIss: f, nota: f ? `${y}: ICMS/ISS a ${Math.round(f * 100)}% e IBS a ${Math.round((1 - f) * 100)}% da alíquota de referência.` : `${y >= 2033 ? y : 2033}: regime pleno — ICMS, ISS, PIS e COFINS extintos; IBS e CBS integrais.` };
}

/**
 * DRE (Lei 6.404 art. 187 · CPC 26). modelo 'atual' = como escriturado (ICMS/PIS/COFINS/ISS); 'reforma' = simulação gerencial
 * com o mesmo preço de venda, trocando os tributos sobre vendas atuais por IBS/CBS/IS (alíquotas e ano parametrizáveis).
 */
export function dre(contas, mov, { modelo = 'atual', reforma = {} } = {}) {
  const ms = movimentos(contas, mov), soma = (f, k = 'cred') => ms.filter(f).reduce((a, x) => a + x[k], 0);
  const rb = soma(x => x.c.dre === 'rb'), ded = ms.filter(x => x.c.dre === 'ded');
  const porTrib = t => ded.filter(x => x.c.tributos.includes(t)).reduce((a, x) => a + x.deb, 0), devol = ded.filter(x => !x.c.tributos.length).reduce((a, x) => a + x.deb, 0);
  const atuais = Object.fromEntries(TRIBUTOS_ATUAIS.map(t => [t, porTrib(t)])), reformaEsc = Object.fromEntries(TRIBUTOS_REFORMA.map(t => [t, porTrib(t)]));
  const cmv = soma(x => x.c.dre === 'cmv', 'deb'), dv = soma(x => x.c.dre === 'dv', 'deb'), dga = soma(x => x.c.dre === 'dga', 'deb'), oro = soma(x => x.c.dre === 'oro'), odo = soma(x => x.c.dre === 'odo', 'deb');
  const rf = soma(x => x.c.dre === 'rf'), df = soma(x => x.c.dre === 'df', 'deb'), ir = soma(x => x.c.dre === 'ir', 'deb');
  const montar = deducoes => {
    const totDed = deducoes.reduce((a, [, v]) => a + v, 0), rl = rb - totDed, lb = rl - cmv, rop = lb - dv - dga + oro - odo, lair = rop + rf - df, ll = lair - ir;
    const L = (chave, rotulo, valor, tipo = 'linha', nivel = 1) => ({ chave, rotulo, valor: Math.round(valor), tipo, nivel });
    return { rl, ll, lair, linhas: [L('rb', 'Receita bruta de vendas e serviços', rb, 'total', 0), L('ded', '(-) Deduções da receita bruta', -totDed, 'subtotal'), ...deducoes.map(([r, v]) => L('ded:' + r, '(-) ' + r, -v, 'linha', 2)),
      L('rl', 'Receita líquida', rl, 'total', 0), L('cmv', '(-) Custo das mercadorias e serviços vendidos', -cmv), L('lb', 'Lucro bruto', lb, 'total', 0),
      L('dv', '(-) Despesas com vendas', -dv), L('dga', '(-) Despesas gerais e administrativas', -dga), L('oro', '(+) Outras receitas operacionais', oro), L('odo', '(-) Outras despesas operacionais', -odo),
      L('rop', 'Resultado antes do resultado financeiro', rop, 'total', 0), L('rf', '(+) Receitas financeiras', rf), L('df', '(-) Despesas financeiras', -df),
      L('lair', 'Resultado antes do IRPJ e da CSLL (LAIR)', lair, 'total', 0), L('ir', '(-) IRPJ e CSLL', -ir), L('ll', ll >= 0 ? 'Lucro líquido do período' : 'Prejuízo do período', ll, 'total', 0)] };
  };
  const dedAtual = [['Devoluções, cancelamentos e abatimentos', devol], ...TRIBUTOS_ATUAIS.filter(t => atuais[t]).map(t => [t, atuais[t]]), ...TRIBUTOS_REFORMA.filter(t => reformaEsc[t]).map(t => [t === 'IS' ? 'Imposto Seletivo (escriturado)' : t + ' (escriturado)', reformaEsc[t]])].filter(([, v]) => v);
  const atual = montar(dedAtual);
  const tr = transicao(reforma.ano, reforma), aliqIS = Number(reforma.is ?? 0);
  const div = tr.teste ? 1 : 1 + tr.cbs + tr.ibs, baseOp = (rb - devol) / div; // mesmo preço ao consumidor: IBS/CBS "por fora" → valor da operação = receita bruta ÷ (1 + CBS + IBS)
  const baseIS = ms.filter(x => x.c.dre === 'rb' && x.c.tributos.includes('IS')).reduce((a, x) => a + x.cred, 0) / div;
  const sim = { ICMS: Math.round(atuais.ICMS * tr.icmsIss), ISS: Math.round(atuais.ISS * tr.icmsIss), PIS: Math.round(atuais.PIS * tr.pisCofins), COFINS: Math.round(atuais.COFINS * tr.pisCofins), CBS: tr.teste ? 0 : Math.round(baseOp * tr.cbs), IBS: tr.teste ? 0 : Math.round(baseOp * tr.ibs), IS: Math.round(baseIS * aliqIS) };
  const dedRef = [['Devoluções, cancelamentos e abatimentos', devol], ...['ICMS', 'ISS', 'PIS', 'COFINS'].filter(t => sim[t]).map(t => [t + ' (residual da transição)', sim[t]]), ['CBS', sim.CBS], ['IBS', sim.IBS], ['Imposto Seletivo (IS)', sim.IS]].filter(([r, v]) => v || /^(CBS|IBS)$/.test(r));
  const ref = montar(dedRef);
  const notas = modelo === 'reforma'
    ? [`Simulação gerencial (não substitui a apuração): mesmo preço ao consumidor; IBS e CBS "por fora" — valor da operação = receita bruta ÷ (1 + CBS + IBS) = ${fmt(Math.round(baseOp))}; ICMS/ISS residuais da transição seguem "por dentro".`, `Alíquotas: CBS ${(tr.cbs * 100).toFixed(2)}%, IBS ${(tr.ibs * 100).toFixed(2)}%, IS ${(aliqIS * 100).toFixed(2)}% — parametrize conforme a LC 214/2025 e as resoluções do Comitê Gestor/Receita (as alíquotas de referência ainda serão fixadas).`, tr.nota, 'Créditos de IBS/CBS sobre compras (não cumulatividade plena) e IRPJ/CSLL mantidos como escriturados.']
    : ['Como escriturado: tributos sobre vendas do modelo atual (ICMS, PIS, COFINS, ISS) como deduções da receita bruta (CPC 47: valores arrecadados para terceiros não são receita).'];
  return { modelo, ...(modelo === 'reforma' ? ref : atual), transicao: tr, comparativo: { atual: { receitaLiquida: atual.rl, lucroLiquido: atual.ll }, reforma: { receitaLiquida: ref.rl, lucroLiquido: ref.ll }, diferencaLucro: ref.ll - atual.ll }, notas };
}

/** Balanço Patrimonial (Lei 6.404 arts. 178-182): resultado ainda não encerrado entra no PL. */
export function balanco(contas, saldosAte) {
  const bal = balancete(contas, saldosAte), por = new Map(bal.linhas.map(l => [l.codigo, l])), s = cod => por.get(cod)?.saldoFinal || 0;
  const grupo = (cod, sinal) => contas.filter(c => c.pai === cod).sort((a, b) => cmpCodigo(a.codigo, b.codigo)).map(c => ({ codigo: c.codigo, nome: c.nome, valor: sinal * s(c.codigo) })).filter(x => x.valor);
  const resultadoAberto = -(s('4') + s('5')); // receitas (C) − despesas (D) ainda nas contas de resultado
  const ativo = s('1'), passivo = -s('2'), pl = -s('3') + resultadoAberto;
  return { ativo: { total: ativo, circulante: { total: s('1.1'), contas: grupo('1.1', 1) }, naoCirculante: { total: s('1.2'), contas: grupo('1.2', 1) } },
    passivo: { total: passivo, circulante: { total: -s('2.1'), contas: grupo('2.1', -1) }, naoCirculante: { total: -s('2.2'), contas: grupo('2.2', -1) } },
    patrimonioLiquido: { total: pl, contas: [...grupo('3', -1), ...(resultadoAberto ? [{ codigo: '—', nome: 'Resultado do período (ainda não encerrado)', valor: resultadoAberto }] : [])] },
    passivoMaisPL: passivo + pl, confere: ativo === passivo + pl, diferenca: ativo - passivo - pl };
}

/** DMPL (CPC 26 / art. 186 da Lei 6.404): colunas = subgrupos do PL (nível 2); linhas = saldo inicial, movimentos por origem, resultado do período e saldo final. */
export function dmpl(contas, saldosPL, movPorOrigem, resultadoPeriodo) {
  const cols = contas.filter(c => c.grupo === 3 && c.nivel === 2).sort((a, b) => cmpCodigo(a.codigo, b.codigo)), daCol = cod => cols.find(c => cod === c.codigo || cod.startsWith(c.codigo + '.'))?.codigo;
  const ini = Object.fromEntries(cols.map(c => [c.codigo, 0])), ROT = { aumento_capital: 'Aumento / integralização de capital', reserva: 'Constituição e reversão de reservas', dividendos: 'Dividendos e lucros distribuídos', ajuste_avaliacao: 'Ajustes de avaliação patrimonial (ORA)', encerramento: 'Resultado do exercício (encerramento)', estorno: 'Estornos', manual: 'Outras mutações', integracao: 'Outras mutações' };
  for (const [cod, v] of saldosPL) { const k = daCol(cod); if (k) ini[k] += -v; }
  const linhas = [{ rotulo: 'Saldo inicial', valores: { ...ini } }], grupos = new Map();
  for (const m of movPorOrigem) { const k = daCol(m.conta); if (!k) continue; const r = ROT[m.origem] || 'Outras mutações'; const g = grupos.get(r) || grupos.set(r, Object.fromEntries(cols.map(c => [c.codigo, 0]))).get(r); g[k] += m.c - m.d; }
  grupos.forEach((v, r) => linhas.push({ rotulo: r, valores: v }));
  const lpa = cols.find(c => /lucros|prejuizos/i.test(normalizar(c.nome)))?.codigo || cols[cols.length - 1]?.codigo;
  if (resultadoPeriodo) linhas.push({ rotulo: 'Resultado do período (ainda não encerrado)', valores: Object.fromEntries(cols.map(c => [c.codigo, c.codigo === lpa ? resultadoPeriodo : 0])) });
  const fim = Object.fromEntries(cols.map(c => [c.codigo, linhas.reduce((a, l) => a + (l.valores[c.codigo] || 0), 0)]));
  linhas.push({ rotulo: 'Saldo final', valores: fim });
  linhas.forEach(l => { l.total = Object.values(l.valores).reduce((a, v) => a + v, 0); });
  return { colunas: cols.map(c => ({ codigo: c.codigo, nome: c.nome })), linhas };
}

/** DRA (CPC 26 §§ 81A-82A): lucro líquido + outros resultados abrangentes (movimento de Ajustes de Avaliação Patrimonial). */
export function dra(lucroLiquido, movORA) { return { linhas: [{ rotulo: 'Lucro líquido (prejuízo) do período', valor: lucroLiquido }, { rotulo: 'Outros resultados abrangentes (ajustes de avaliação patrimonial)', valor: movORA }, { rotulo: 'Resultado abrangente total do período', valor: lucroLiquido + movORA, total: true }] }; }

/** DVA (CPC 09): geração e distribuição da riqueza; "capital próprio" fecha com o lucro líquido (diferença = contas sem linha DVA). */
export function dva(contas, mov, lucroLiquido) {
  const ms = movimentos(contas, mov), padrao = c => c.dva || (c.grupo === 4 ? { rb: 'vendas', oro: 'outras_receitas', rf: 'transferencia' }[c.dre] || 'outras_receitas' : { cmv: 'cmv', df: 'juros', ir: 'imp_federais' }[c.dre] || 'insumos');
  const v = {}; for (const x of ms) { let k = padrao(x.c); if (x.c.dre === 'ded' && x.c.tributos.length) k = ESFERA[x.c.tributos[0]] || 'imp_federais'; const val = x.c.grupo === 4 ? x.cred : x.deb;
    /* receitas: aumentam a riqueza; deduções de tributos (grupo 4, natureza D) e despesas: valores positivos na distribuição */
    v[k] = (v[k] || 0) + (x.c.grupo === 4 && ESFERA_K.has(k) ? -val : val); }
  const g = k => v[k] || 0;
  const receitas = g('vendas') + g('outras_receitas') - g('pcld'), insumos = g('cmv') + g('insumos') + g('perda_ativos'), vab = receitas - insumos, ret = g('depreciacao'), val = vab - ret, transf = g('transferencia'), total = val + transf;
  const pessoal = g('pessoal'), impostos = g('imp_federais') + g('imp_estaduais') + g('imp_municipais'), terceiros = g('juros') + g('alugueis'), proprio = total - pessoal - impostos - terceiros;
  const L = (rotulo, valor, nivel = 1, total) => ({ rotulo, valor: Math.round(valor), nivel, total: !!total });
  return { linhas: [L('1. Receitas', receitas, 0, 1), L(DVA_LINHAS.vendas, g('vendas')), L(DVA_LINHAS.outras_receitas, g('outras_receitas')), L(DVA_LINHAS.pcld, -g('pcld')),
    L('2. Insumos adquiridos de terceiros', -insumos, 0, 1), L(DVA_LINHAS.cmv, -g('cmv')), L(DVA_LINHAS.insumos, -g('insumos')), L(DVA_LINHAS.perda_ativos, -g('perda_ativos')),
    L('3. Valor adicionado bruto (1 − 2)', vab, 0, 1), L('4. Retenções · ' + DVA_LINHAS.depreciacao, -ret), L('5. Valor adicionado líquido produzido (3 − 4)', val, 0, 1),
    L('6. Valor adicionado recebido em transferência', transf, 0, 1), L('7. Valor adicionado total a distribuir (5 + 6)', total, 0, 1),
    L('8. Distribuição do valor adicionado', total, 0, 1), L('8.1 ' + DVA_LINHAS.pessoal, pessoal), L('8.2 Impostos, taxas e contribuições', impostos), L('Federais', g('imp_federais'), 2), L('Estaduais', g('imp_estaduais'), 2), L('Municipais', g('imp_municipais'), 2),
    L('8.3 Remuneração de capitais de terceiros', terceiros), L(DVA_LINHAS.juros, g('juros'), 2), L(DVA_LINHAS.alugueis, g('alugueis'), 2), L('8.4 ' + DVA_LINHAS.capital_proprio, proprio)],
    conferencia: { lucroLiquidoDRE: lucroLiquido, capitalProprioDVA: Math.round(proprio), diferenca: Math.round(proprio - lucroLiquido), ok: Math.round(proprio) === Math.round(lucroLiquido) },
    notas: ['Tributos sobre vendas: na DVA entram na receita (vendas brutas) e na distribuição aos governos.', 'IBS classificado como estadual/municipal (tributo subnacional compartilhado); CBS e IS federais.'] };
}
const ESFERA_K = new Set(['imp_federais', 'imp_estaduais', 'imp_municipais']);

/**
 * Apuração IRPJ/CSLL do período: Lucro Real (LALUR: LAIR + adições − exclusões − compensação até 30%) ou Lucro Presumido
 * (presunção sobre a receita bruta + demais receitas integrais; LC 224/2025: +10% nos percentuais sobre a parcela da receita
 * acima de R$ 5 milhões/ano, proporcional aos meses). Adicional de IRPJ de 10% sobre a base que exceder R$ 20 mil por mês.
 */
export function apuracaoLucro(regime, { lair, receitaBrutaComercio = 0, receitaBrutaServicos = 0, outrasReceitas = 0, ajustes = [], meses = 12, params = {}, ano }) {
  const adicional = base => Math.max(0, base - 2_000_000 * meses) * 0.10, sum = (t, b) => ajustes.filter(a => a.tipo === t && (a.base === 'ambos' || a.base === b)).reduce((s, a) => s + a.valor, 0);
  if (regime === 'presumido') {
    const pc = params.presumido || {}, p = { irpjC: pc.irpjComercio ?? 0.08, csllC: pc.csllComercio ?? 0.12, irpjS: pc.irpjServicos ?? 0.32, csllS: pc.csllServicos ?? 0.32 }, lc224 = params.lc224 !== false;
    const limite = 500_000_000 * meses / 12, rb = receitaBrutaComercio + receitaBrutaServicos, exc = lc224 ? Math.max(0, rb - limite) : 0, frac = rb ? exc / rb : 0;
    const fatorCsll = lc224 && Number(ano) === 2026 ? Math.max(0, Math.min(1, (meses - 3) / meses)) : 1; // CSLL majorada a partir de abr/2026 (noventena)
    const pres = (c, s, maj) => receitaBrutaComercio * c * (1 + 0.1 * frac * maj) + receitaBrutaServicos * s * (1 + 0.1 * frac * maj);
    const baseIR = Math.round(pres(p.irpjC, p.irpjS, 1) + outrasReceitas + sum('adicao', 'irpj')), baseCS = Math.round(pres(p.csllC, p.csllS, fatorCsll) + outrasReceitas + sum('adicao', 'csll'));
    const irpj = Math.round(baseIR * 0.15 + adicional(baseIR)), csll = Math.round(baseCS * 0.09);
    return { regime, baseIRPJ: baseIR, baseCSLL: baseCS, irpj, csll, total: irpj + csll, receitaBruta: rb, excedenteLC224: Math.round(exc), percentuais: p,
      notas: [`Presunção: comércio IRPJ ${p.irpjC * 100}% / CSLL ${p.csllC * 100}%; serviços IRPJ ${p.irpjS * 100}% / CSLL ${p.csllS * 100}%. Receitas financeiras e outras: integrais na base.`,
        lc224 ? 'LC 224/2025: percentuais acrescidos de 10% sobre a parcela da receita bruta acima de R$ 5 milhões no ano (IRPJ desde jan/2026; CSLL desde abr/2026). Há liminares questionando a majoração — confirme com o jurídico/tributário.' : 'Majoração da LC 224/2025 desligada nos parâmetros.',
        'IRPJ 15% + adicional de 10% sobre a base acima de R$ 20.000/mês; CSLL 9%.'] };
  }
  const adIR = sum('adicao', 'irpj'), exIR = sum('exclusao', 'irpj'), adCS = sum('adicao', 'csll'), exCS = sum('exclusao', 'csll');
  const ajIR = lair + adIR - exIR, ajCS = lair + adCS - exCS, compIR = Math.min(sum('compensacao', 'irpj'), Math.max(0, ajIR) * 0.3), compCS = Math.min(sum('compensacao', 'csll'), Math.max(0, ajCS) * 0.3);
  const lr = Math.max(0, ajIR - compIR), bcs = Math.max(0, ajCS - compCS), irpj = Math.round(lr * 0.15 + adicional(lr)), csll = Math.round(bcs * 0.09);
  return { regime: 'real', lair, adicoesIRPJ: adIR, exclusoesIRPJ: exIR, lucroAjustado: ajIR, compensacaoIRPJ: Math.round(compIR), lucroReal: Math.round(lr), baseCSLL: Math.round(bcs), compensacaoCSLL: Math.round(compCS), irpj, csll, total: irpj + csll,
    prejuizoFiscal: ajIR < 0 ? -ajIR : 0, notas: ['LALUR Parte A: LAIR + adições − exclusões = lucro ajustado; compensação de prejuízos fiscais limitada a 30% do lucro ajustado (Parte B).', 'IRPJ 15% + adicional de 10% sobre o lucro real acima de R$ 20.000/mês; CSLL 9%.'] };
}

/* ---------------------------------------------------------------- v13.86 · Parte 2: de-para FCX → plano de contas
   O FCX usa os rótulos do ERP ("4.10.09 – (-) Energia Elétrica"): o painel analítico e a DFC agrupam por esses códigos,
   então o rótulo continua o mesmo no FCX — o que muda é que a LISTA vem do Módulo Contábil (somente leitura no FCX) e cada
   rótulo aponta para uma conta do plano único. Regra: prefixo do código do ERP (o mais longo vence) + nome; sem regra,
   classificação automática pelo nome e vizinhança no plano (fica "pendente" para revisão). */
export const LIMIAR_AUTOMATICO = 0.75;
/** Contas analíticas que completam o plano padrão para o que o FCX usa (criadas uma vez, pelo nome, debaixo da mãe). */
export const NOVAS_CONTAS_FCX = {
  viagens: { pai: '5.3.3', nome: 'Viagens e Estadias', dre: 'dga', dva: 'insumos' },
  seguros: { pai: '5.3.3', nome: 'Seguros', dre: 'dga', dva: 'insumos' },
  manutencao: { pai: '5.3.3', nome: 'Manutenção e Reparos', dre: 'dga', dva: 'insumos' },
  fretes: { pai: '5.2.1', nome: 'Fretes sobre Vendas', dre: 'dv', dva: 'insumos' },
  brindes: { pai: '5.4.1', nome: 'Brindes, Doações e Bonificações', dre: 'odo', dva: 'insumos' },
  partes: { pai: '1.2.1.01', nome: 'Créditos com Partes Relacionadas', dre: null, dva: null },
};
/** [prefixo do código do ERP, regra no nome (ou null), conta de destino (ou 'novo:<chave>'), confiança]. Mesma faixa: as com regra primeiro. */
const DE_PARA_ERP = [
  ['1.01.07', null, '4.2.1.01', 0.8], ['1.01', null, '4.1.1.01', 0.9], ['1.02', null, '4.1.1.02', 0.9], ['1.03', null, '4.2.1.01', 0.92], ['1.04', null, '4.1.1.01', 0.88], ['1', null, '4.1.1.01', 0.6],
  ['2.01', null, '1.1.3.01.001', 0.85], ['2.02', null, '1.1.3.01.001', 0.85], ['2.04', null, '1.1.3.01.001', 0.8],
  ['2.03', /icms/, '1.1.2.02.001', 0.8], ['2.03', null, '5.1.1.01', 0.88],
  ['2.05', /\bibs\b/, '4.2.3.01', 0.95], ['2.05', /\bcbs\b/, '4.2.3.02', 0.95], ['2.05', /seletivo/, '4.2.3.03', 0.95],
  ['2.05', /\bpis a pagar/, '2.1.3.01.002', 0.82], ['2.05', /cofins a pagar/, '2.1.3.01.003', 0.82], ['2.05', /icms (normal|fronteira)/, '2.1.3.01.001', 0.8], ['2.05', /simples/, '4.2.2.01', 0.5],
  ['2.05', /cofins/, '4.2.2.03', 0.95], ['2.05', /\bpis\b/, '4.2.2.02', 0.95], ['2.05', /icms|difal/, '4.2.2.01', 0.93], ['2.05', null, '4.2.2.01', 0.6],
  ['2.06', /\bibs\b/, '1.1.2.02.004', 0.95], ['2.06', /\bcbs\b/, '1.1.2.02.005', 0.95], ['2.06', /icms.?st\b/, '5.1.1.01', 0.75], ['2.06', /\bpis\b/, '1.1.2.02.002', 0.9], ['2.06', /cofins/, '1.1.2.02.003', 0.9], ['2.06', /icms|difal/, '1.1.2.02.001', 0.85],
  ['2.07', null, '5.2.1.03', 0.93],
  ['2.10', /\bpis\b/, '4.2.2.02', 0.85], ['2.10', /cofins/, '4.2.2.03', 0.85], ['2.10', /icms/, '4.2.2.01', 0.85],
  ['2.11', null, '4.2.1.01', 0.85], ['2.12', null, '5.3.1.01', 0.78], ['2.14.01', null, '1.1.2.03.001', 0.9], ['2.14', null, '1.1.2.03.001', 0.6],
  ['2.18.01', null, '5.2.1.04', 0.85], ['2.18', null, '5.4.1.01', 0.78], ['2.19', null, '5.2.1.01', 0.92], ['2', null, '5.1.1.01', 0.45],
  ['4.01', /ferias|13/, '5.3.1.02', 0.9], ['4.01', /saude/, '5.3.1.05', 0.8], ['4.01', null, '5.3.1.01', 0.9],
  ['4.02', /reparcelamento/, '2.2.1.02.001', 0.8], ['4.02', /fgts/, '5.3.1.04', 0.93], ['4.02', /inss|sistema s|\brat\b/, '5.3.1.03', 0.9], ['4.02', /irrf/, '5.3.1.01', 0.6], ['4.02', /icms/, '5.3.3.05', 0.55], ['4.02', null, '5.3.1.05', 0.7],
  ['4.03', /deposito judicial/, '1.2.1.01.001', 0.9], ['4.03', null, '5.3.1.01', 0.78], ['4.04', null, '5.3.1.05', 0.8], ['4.05', null, '5.3.1.05', 0.8],
  ['4.06', /uniforme|seguranca/, '5.3.3.02', 0.82], ['4.06', null, '5.3.1.05', 0.92], ['4.07', null, '5.3.1.01', 0.8], ['4.08', null, '5.3.3.05', 0.85], ['4.09', null, '5.3.3.03', 0.93],
  ['4.10', /energia/, '5.3.2.03', 0.96], ['4.10', /agua/, '5.3.2.04', 0.95], ['4.10', /condominio|fundo de promocao/, '5.3.2.02', 0.93], ['4.10', /iptu|alvara|bombeiros|tpei|\bcim\b/, '5.3.3.05', 0.88], ['4.10', /outras receitas/, '4.3.1.01', 0.55], ['4.10', null, '5.3.2.01', 0.9],
  ['4.11', null, '5.3.3.01', 0.8], ['4.12', null, '5.3.3.01', 0.82], ['4.13', null, '5.3.3.02', 0.85], ['4.15', null, '5.3.3.02', 0.88],
  ['4.18', null, 'novo:viagens', 0.9], ['4.22', null, '5.3.3.01', 0.82], ['4.23', null, 'novo:seguros', 0.92], ['4.26', /obras|reforma/, '1.2.3.01.005', 0.75], ['4.26', null, 'novo:manutencao', 0.9],
  ['4.33', /confraterniza/, '5.3.1.05', 0.7], ['4.33', null, '5.2.1.02', 0.92], ['4.38', /informatica/, '5.3.3.03', 0.85], ['4.38', null, '5.3.3.01', 0.9],
  ['4.39', /multa/, '5.4.1.02', 0.9], ['4.39', /brinde|doac|bonifica/, 'novo:brindes', 0.88], ['4.39', /desconto/, '4.2.1.01', 0.75], ['4.39', null, '5.4.1.01', 0.6],
  ['4.40', null, '4.4.1.02', 0.85], ['4.46', null, '5.4.1.02', 0.92], ['4.47', null, 'novo:fretes', 0.85], ['4', null, '5.3.3.01', 0.45],
  ['6.01', null, '4.4.1.01', 0.85], ['6.02', null, '4.4.1.01', 0.92], ['6.03', null, '4.3.1.01', 0.6], ['6.06', null, '4.4.1.02', 0.78], ['6.07', null, '4.3.1.02', 0.82], ['6.08', null, '1.1.2.01.003', 0.85],
  ['6.09', null, '1.1.1.02.001', 0.5], ['6.10', null, '1.1.2.03.001', 0.82], ['6.11', null, '4.3.1.01', 0.85], ['6', null, '4.3.1.01', 0.45],
  ['7.01.02', null, '5.2.1.02', 0.65], ['7.01.03', null, '5.4.1.02', 0.88], ['7.01.04', null, '5.5.1.02', 0.93], ['7.01.05', null, '2.1.5.01.004', 0.9], ['7.01.06', null, '1.1.1.01.001', 0.7], ['7.01.07', null, 'novo:partes', 0.7], ['7.01', null, '5.5.1.03', 0.88],
  ['7.11', null, '2.2.1.02.001', 0.88],
  ['7.19', /irpj/, '2.1.3.02.001', 0.85], ['7.19', /csll/, '2.1.3.02.002', 0.85], ['7.19', /irrf/, '5.3.2.01', 0.6], ['7.19', /\biss\b/, '2.1.3.01.004', 0.85], ['7.19', /\bpis\b/, '2.1.3.01.002', 0.82], ['7.19', /cofins/, '2.1.3.01.003', 0.82], ['7.19', /juros/, '5.5.1.01', 0.9], ['7.19', null, '5.5.1.03', 0.85],
  ['7.20', /aluguel/, '5.3.2.01', 0.75], ['7.20', /instala|obra/, '1.2.3.01.005', 0.85], ['7.20', /maq/, '1.2.3.01.002', 0.9], ['7.20', /moveis/, '1.2.3.01.001', 0.92], ['7.20', /veiculo/, '1.2.3.01.004', 0.92], ['7.20', null, '1.2.3.01.002', 0.55],
  ['7', null, '5.4.1.01', 0.4], ['99', null, '5.3.3.04', 0.92],
].map(([p, re, destino, conf], ordem) => ({ p, re, destino, conf, ordem, n: p.split('.').length })).sort((a, b) => b.n - a.n || a.ordem - b.ordem);
/** Agrupadores (cabeçalhos) do ERP → conta sintética correspondente. */
const AGRUPADOR_ERP = [['1.01', '4.1.1'], ['1.02', '4.1.1'], ['1.03', '4.2.1'], ['1', '4.1'], ['2.03', '5.1.1'], ['2.05', '4.2.2'], ['2.06', '1.1.2.02'], ['2.07', '5.2.1'], ['2.10', '4.2.2'], ['2.11', '4.2.1'], ['2.14', '1.1.2.03'],
  ['2.18', '5.4.1'], ['2.19', '5.2.1'], ['2', '5.1'], ['4.01', '5.3.1'], ['4.02', '5.3.1'], ['4.03', '5.3.1'], ['4.06', '5.3.1'], ['4.10', '5.3.2'], ['4.33', '5.2.1'], ['4.39', '5.4.1'], ['4.46', '5.4.1'], ['4', '5.3'],
  ['6.07', '4.3.1'], ['6', '4.3'], ['7.01', '5.5.1'], ['7.11', '2.2.1.02'], ['7.19', '5.5.1'], ['7.20', '1.2.3.01'], ['7', '5.4'], ['99', '5.3.3']].sort((a, b) => b[0].split('.').length - a[0].split('.').length);
/** Contas que o Módulo Contábil oferece ao FCX além das que ele já usava: Reforma Tributária (IBS, CBS e Imposto Seletivo). */
export const COMPLEMENTO_FCX = [
  ['2.05.10 – (-) IBS sobre Vendas', '4.2.3.01'], ['2.05.11 – (-) CBS sobre Vendas', '4.2.3.02'], ['2.05.12 – (-) Imposto Seletivo sobre Vendas', '4.2.3.03'],
  ['2.06.06 – (+) IBS sobre Compra de Mercadorias', '1.1.2.02.004'], ['2.06.07 – (+) CBS sobre Compra de Mercadorias', '1.1.2.02.005'],
];
const casa = (cod, p) => cod === p || cod.startsWith(p + '.');
/** "4.10.09 – (-) Energia Elétrica" → { codigo: '4.10.09', nome: 'Energia Elétrica' } (sem código: codigo null). */
export function rotuloFCX(r) {
  const s = String(r ?? '').trim(), m = s.match(/^(\d{1,3}(?:\.\d{1,4})*)\s*[–—-]\s*(.+)$/);
  const limpar = x => x.replace(/^\(\s*[+-]\s*\)\s*/, '').trim();
  return m ? { rotulo: s, codigo: m[1], nome: limpar(m[2]) } : { rotulo: s, codigo: null, nome: limpar(s) };
}
/**
 * Mapeia rótulos do FCX para o plano: devolve [{ chave, erpCodigo, erpNome, agrupador, destino, conf, motivo, status }].
 * destino = código de conta existente ou 'novo:<chave de NOVAS_CONTAS_FCX>'. usadas: rótulos com lançamentos no FCX
 * (um cabeçalho do ERP com saídas lançadas nele é tratado como conta de movimento).
 */
export function mapearFCX(rotulos, contas, { usadas = [] } = {}) {
  const lista = [...new Set(rotulos.map(x => String(x ?? '').trim()).filter(Boolean))], usa = new Set(usadas), partes = lista.map(rotuloFCX);
  const codigos = partes.map(p => p.codigo).filter(Boolean), porCodigo = new Map(contas.map(c => [c.codigo, c]));
  const analiticas = contas.filter(c => c.tipo === 'A' && c.ativa !== false);
  const viz = (nome, pai) => { let best = null; for (const c of analiticas) { if (pai && !casa(c.codigo, pai)) continue; const s = jaccard(nome, c.nome); if (!best || s > best.s) best = { c, s }; } return best; };
  return partes.map(p => {
    const agrupador = !!p.codigo && !usa.has(p.rotulo) && codigos.some(c => c !== p.codigo && c.startsWith(p.codigo + '.'));
    const base = { chave: p.rotulo, erpCodigo: p.codigo, erpNome: p.nome, agrupador };
    let destino = null, conf = 0, motivo = '';
    if (agrupador) {
      const a = AGRUPADOR_ERP.find(([px]) => casa(p.codigo, px)); destino = a ? a[1] : null; conf = a ? 0.9 : 0;
      motivo = a ? `agrupador do ERP ${p.codigo} → sintética ${a[1]}` : 'agrupador do ERP sem correspondência';
    } else {
      const n = normalizar(p.nome), r = p.codigo ? DE_PARA_ERP.find(e => casa(p.codigo, e.p) && (!e.re || e.re.test(n))) : null;
      if (r && (r.destino.startsWith('novo:') || porCodigo.get(r.destino)?.tipo === 'A')) { destino = r.destino; conf = r.conf; motivo = `faixa ${r.p} do ERP${r.re ? ' + nome' : ''} → ${r.destino.startsWith('novo:') ? 'nova conta "' + NOVAS_CONTAS_FCX[r.destino.slice(5)].nome + '"' : r.destino + ' · ' + porCodigo.get(r.destino).nome}`; }
      else {
        let ia = null; try { ia = classificar(p.nome, contas); } catch { /* nome curto */ }
        const v = (ia?.pai && viz(p.nome, ia.pai)) || viz(p.nome);
        if (v?.c) { destino = v.c.codigo; conf = Math.min(0.6, Math.max(0.3, (ia?.confianca || 0.3) * 0.6 + v.s * 0.4)); motivo = `sem faixa do ERP: classificação pelo nome${ia ? ` (${ia.grupoNome})` : ''} → ${v.c.codigo} · ${v.c.nome} — revise`; }
        else motivo = 'sem correspondência — escolha a conta';
      }
    }
    return { ...base, destino, conf: Math.round(conf * 100) / 100, motivo, status: destino && conf >= LIMIAR_AUTOMATICO ? 'automatico' : 'pendente' };
  });
}
export const cmpRotuloFCX = (a, b) => { const x = rotuloFCX(a).codigo, y = rotuloFCX(b).codigo; if (x && y) return cmpCodigoErp(x, y) || a.localeCompare(b, 'pt-BR'); if (x) return -1; if (y) return 1; return a.localeCompare(b, 'pt-BR'); };
function cmpCodigoErp(a, b) { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { if (x[i] === undefined) return -1; if (y[i] === undefined) return 1; if (x[i] !== y[i]) return x[i] - y[i]; } return 0; }
