/* v13.91 · Radar de Saúde Empresarial e Motor de Crítica Contábil (funções puras, valores em centavos).
   Recebe o plano, os saldos e os lançamentos que o servidor já leu do banco e devolve: fórmulas de lançamento, contas com saldo
   invertido (e a correção sugerida), variações desproporcionais, conciliação com o FCX, recomendações tributárias
   (modelo atual × Reforma Tributária, LC 214/2025), indicadores financeiros, DFC (método direto), DRE no formato do CPC 51
   e o score de 0 a 100. Nada aqui grava: as correções voltam como propostas (o usuário confere e grava). */
import { balancete, balanco, dre, transicao, cmpCodigo, fmt } from './contabil-motor.mjs';

/* ---------------------------------------------------------------- disponibilidades (cards do topo) */
export const DISPONIBILIDADES = [
  { id: 'caixa', rotulo: 'Caixa Geral', conta: '1.1.1.01', entra: 'Entradas', sai: 'Saídas' },
  { id: 'bancos', rotulo: 'Bancos c/ Movimento', conta: '1.1.1.02', entra: 'Depósitos', sai: 'Pagamentos' },
  { id: 'estoque', rotulo: 'Estoque de Mercadorias', conta: '1.1.3', entra: 'Entradas', sai: 'Baixas (CMV)' },
];
/** soma (ant, d, c) de uma conta e de todas as filhas analíticas */
export function somaGrupo(saldos, prefixo) {
  let ant = 0, d = 0, c = 0;
  for (const [k, v] of saldos) if (k === prefixo || k.startsWith(prefixo + '.')) { ant += v.ant; d += v.d; c += v.c; }
  return { ant, d, c, saldo: ant + d - c };
}
export function disponibilidades(saldos) {
  const cards = DISPONIBILIDADES.map(x => ({ ...x, ...somaGrupo(saldos, x.conta) }));
  const disp = somaGrupo(saldos, '1.1.1'), est = somaGrupo(saldos, '1.1.3');
  return { cards, disponivel: disp.saldo, estoques: est.saldo, consolidado: disp.saldo + est.saldo, aplicacoes: somaGrupo(saldos, '1.1.1.03').saldo };
}

/* ---------------------------------------------------------------- fórmulas de lançamento */
/** 1ª fórmula: 1 débito e 1 crédito · 2ª: 1 débito e n créditos · 3ª: n débitos e 1 crédito · 4ª: n débitos e n créditos. */
export function formula(itens) {
  const d = itens.filter(i => i.dc === 'D').length, c = itens.filter(i => i.dc === 'C').length;
  return d <= 1 && c <= 1 ? 1 : d <= 1 ? 2 : c <= 1 ? 3 : 4;
}
export function resumoDiario(lancamentos) {
  const f = { 1: 0, 2: 0, 3: 0, 4: 0 }; let d = 0, c = 0, deseq = 0;
  for (const l of lancamentos) {
    f[formula(l.itens)]++; const dd = l.itens.filter(i => i.dc === 'D').reduce((a, i) => a + i.valor, 0), cc = l.itens.filter(i => i.dc === 'C').reduce((a, i) => a + i.valor, 0);
    d += dd; c += cc; if (dd !== cc) deseq++;
  }
  return { lancamentos: lancamentos.length, debitos: d, creditos: c, diferenca: d - c, equilibrado: d === c && !deseq, desequilibrados: deseq, formulas: f };
}

/* ---------------------------------------------------------------- saldo invertido e correção sugerida */
/* contrapartida da reclassificação, pela conta com o saldo invertido (o usuário confere antes de gravar) */
const RECLASSIFICA = [
  ['1.1.1.02', '2.1.4.01.001', 'Saldo bancário negativo é obrigação (cheque especial / conta garantida): reclassifique para Empréstimos Bancários.'],
  ['1.1.1.01', null, 'Caixa com saldo credor ("estouro de caixa") indica receita não lançada, pagamento lançado em dobro ou entrada lançada em outra conta. Localize o lançamento no Razão; não se reclassifica caixa negativo.'],
  ['1.1.2.01', '2.1.5.01', 'Clientes com saldo credor costumam ser adiantamentos recebidos: reclassifique para uma conta de obrigação (Contas a Pagar / Adiantamentos de Clientes).'],
  ['1.1.2.02', '2.1.3.01', 'Tributo a recuperar com saldo credor: o valor é devido — reclassifique para o tributo a recolher correspondente.'],
  ['1.1.3', '5.1.1.01', 'Estoque credor: baixa de CMV maior que as entradas. Revise o custo das vendas ou registre a entrada de mercadorias que faltou.'],
  ['2.1.1', '1.1.2.03.001', 'Fornecedores com saldo devedor são adiantamentos a fornecedores (pagamento antes da nota): reclassifique para o Ativo.'],
  ['2.1.2', '1.1.2.03.002', 'Obrigação trabalhista com saldo devedor: pagamento a maior ou adiantamento — reclassifique para Adiantamentos a Empregados ou corrija a provisão.'],
  ['2.1.3', '1.1.2.02', 'Tributo a recolher com saldo devedor: recolhimento a maior — reclassifique para tributos a recuperar/compensar.'],
  ['2.1.4', '1.1.2.03', 'Empréstimo com saldo devedor: amortização a maior ou juros lançados no principal — revise os pagamentos.'],
  ['2.1.5', '1.1.2.03', 'Conta a pagar com saldo devedor: pagamento antecipado — reclassifique para Outros Créditos.'],
];
export function contasInvertidas(contas, saldos) {
  const out = [];
  for (const c of contas) {
    if (c.tipo !== 'A' || c.grupo > 2 || c.redutora) continue;
    const s = saldos.get(c.codigo); if (!s) continue; const fim = s.ant + s.d - s.c;
    const invertido = c.grupo === 1 ? fim < 0 : fim > 0; if (!invertido || !fim) continue;
    const r = RECLASSIFICA.find(([p]) => c.codigo === p || c.codigo.startsWith(p + '.')) || [null, null, c.grupo === 1 ? 'Conta do Ativo com saldo credor: confira no Razão se houve lançamento invertido (D↔C).' : 'Conta do Passivo com saldo devedor: confira no Razão se houve lançamento invertido (D↔C).'];
    const destino = r[1] ? (contas.find(x => x.codigo === r[1] && x.tipo === 'A' && x.ativa) || contas.filter(x => x.tipo === 'A' && x.ativa && x.codigo.startsWith(r[1] + '.')).sort((a, b) => cmpCodigo(a.codigo, b.codigo))[0]) : null;
    const valor = Math.abs(fim);
    /* proposta: zerar o saldo invertido contra a conta de destino (Ativo credor → D conta / C destino; Passivo devedor → C conta / D destino) */
    const proposta = destino ? { historico: `Reclassificação do saldo ${c.grupo === 1 ? 'credor' : 'devedor'} de ${c.codigo} · ${c.nome}`, itens: c.grupo === 1 ? [{ conta: c.codigo, dc: 'D', valor }, { conta: destino.codigo, dc: 'C', valor }] : [{ conta: destino.codigo, dc: 'D', valor }, { conta: c.codigo, dc: 'C', valor }] } : null;
    out.push({ conta: c.codigo, nome: c.nome, grupo: c.grupo, saldo: fim, valor, natureza: c.grupo === 1 ? 'credor' : 'devedor', motivo: r[2], destino: destino ? { codigo: destino.codigo, nome: destino.nome } : null, proposta });
  }
  return out.sort((a, b) => b.valor - a.valor);
}

/* ---------------------------------------------------------------- variação desproporcional (mês × mês anterior) */
export function variacoes(contas, movAtual, movAnterior, { limiar = 0.5, minimo = 100000 } = {}) {
  const out = [];
  for (const c of contas) {
    if (c.tipo !== 'A' || c.grupo < 4) continue;
    const a = movAtual.get(c.codigo), b = movAnterior.get(c.codigo), va = a ? (c.grupo === 4 ? a.c - a.d : a.d - a.c) : 0, vb = b ? (c.grupo === 4 ? b.c - b.d : b.d - b.c) : 0;
    if (Math.abs(va - vb) < minimo) continue;
    const var_ = vb ? (va - vb) / Math.abs(vb) : null;
    if (var_ !== null && Math.abs(var_) < limiar) continue;
    out.push({ conta: c.codigo, nome: c.nome, grupo: c.grupo, atual: va, anterior: vb, variacao: var_, diferenca: va - vb });
  }
  return out.sort((x, y) => Math.abs(y.diferenca) - Math.abs(x.diferenca)).slice(0, 20);
}

/* ---------------------------------------------------------------- recomendações tributárias */
export const CONTAS_RETENCOES = [
  ['2.1.3.03', 'Tributos Retidos de Terceiros a Recolher', 'S', [], null],
  ['2.1.3.03.001', 'IRRF Retido de Terceiros a Recolher', 'A', [], null],
  ['2.1.3.03.002', 'PIS/COFINS/CSLL Retidos a Recolher (Lei 10.833/2003, art. 30)', 'A', ['PIS', 'COFINS', 'CSLL'], 'atual'],
  ['2.1.3.03.003', 'INSS Retido de Cessão de Mão de Obra a Recolher (Lei 8.212/1991, art. 31)', 'A', ['INSS'], 'ambos'],
  ['2.1.3.03.004', 'ISS Retido na Fonte a Recolher', 'A', ['ISS'], 'atual'],
];
export function tributario({ contas, mov, params, ano, regime }) {
  const out = [], tem = cod => contas.some(c => c.codigo === cod || c.codigo.startsWith(cod + '.')), soma = (pref, k) => { let v = 0; for (const [cod, m] of mov) if (cod === pref || cod.startsWith(pref + '.')) v += k === 'd' ? m.d - m.c : m.c - m.d; return v; };
  const servicos = soma('5.3.3.01', 'd');
  if (servicos > 0 && !tem('2.1.3.03')) out.push({ id: 'retencoes', severidade: 'media', titulo: 'Retenções na fonte sem contas próprias',
    texto: `Há ${fmt(servicos)} em Serviços de Terceiros no período e o plano não tem contas para os tributos retidos. Ao contratar serviços de pessoa jurídica, a empresa pode ter de reter IRRF, PIS/COFINS/CSLL (4,65%, Lei 10.833/2003), INSS (11% na cessão de mão de obra) e ISS (conforme o município). Sem as contas, o valor retido fica misturado com Fornecedores.`,
    acao: { tipo: 'retencoes', rotulo: 'Criar as contas de retenções' } });
  const tr = transicao(ano, params.reforma || {}), recIBS = soma('2.1.3.01.005', 'c') + soma('4.2.3.01', 'd'), recCBS = soma('2.1.3.01.006', 'c') + soma('4.2.3.02', 'd'), rb = soma('4.1', 'c');
  if (ano === 2026 && rb > 0 && !recIBS && !recCBS) out.push({ id: 'reforma-teste', severidade: 'media', titulo: '2026: ano-teste da Reforma Tributária sem IBS/CBS escriturados',
    texto: `Em 2026 a LC 214/2025 exige o destaque de CBS (0,9%) e IBS (0,1%) nos documentos fiscais, com compensação contra PIS/COFINS. A receita bruta do período é ${fmt(rb)} e não há IBS/CBS nas contas 2.1.3.01.005/006 nem 4.2.3. Confira a parametrização do emissor de notas e o registro contábil (sem custo adicional quando as obrigações acessórias são cumpridas).`,
    acao: { tipo: 'relatorio', rel: 'dre26', rotulo: 'Ver a DRE (Modelo Atual × Reforma)' } });
  if (rb > 0) {
    const atual = dre(contas, mov, { modelo: 'atual', reforma: params.reforma }), ref = dre(contas, mov, { modelo: 'reforma', reforma: { ...params.reforma, ano: Math.max(ano, 2027) } });
    const dif = ref.ll - atual.ll;
    out.push({ id: 'reforma-impacto', severidade: Math.abs(dif) > Math.abs(atual.ll) * 0.1 && Math.abs(dif) > 100000 ? 'media' : 'baixa', titulo: `Simulação da Reforma (${ref.transicao.ano}) × Modelo Atual`,
      texto: `Com o mesmo preço de venda, o lucro líquido passaria de ${fmt(atual.ll)} (modelo atual) para ${fmt(ref.ll)} na simulação de ${ref.transicao.ano} (diferença de ${fmt(dif)}). ${ref.transicao.nota} Revise preços, créditos de IBS/CBS nas compras e contratos de longo prazo.`,
      acao: { tipo: 'relatorio', rel: 'dre26', modelo: 'reforma', rotulo: 'Abrir a DRE da Reforma' } });
  }
  const aRecolher = ['2.1.3.01', '2.1.3.02'].reduce((a, p) => { for (const [cod, m] of mov) if (cod.startsWith(p + '.')) a += -(m.ant + m.d - m.c); return a; }, 0), pagos = [...mov].reduce((x, [cod, m]) => x + (cod.startsWith('2.1.3.') ? m.d : 0), 0);
  if (aRecolher > 0 && pagos <= 0) out.push({ id: 'recolhimento', severidade: 'alta', titulo: 'Tributos a recolher sem pagamento no período',
    texto: `Há ${fmt(aRecolher)} em tributos a recolher (sobre vendas e sobre o lucro) e nenhum débito de recolhimento nessas contas no período. Confira as guias pagas (DARF, GNRE/ICMS, ISS) e se os pagamentos foram lançados contra o passivo.`, acao: { tipo: 'razao', conta: '2.1.3', rotulo: 'Ver o Razão dos tributos' } });
  if ((regime || params.regime) === 'presumido' && rb > 0) {
    const anual = rb / Math.max(1, Number(params.meses || 12)) * 12;
    if (anual > 7800000000) out.push({ id: 'limite-presumido', severidade: 'alta', titulo: 'Receita projetada acima do limite do Lucro Presumido', texto: `A receita bruta projetada para 12 meses (${fmt(Math.round(anual))}) passa de R$ 78 milhões (Lei 9.718/1998, art. 13): a empresa fica obrigada ao Lucro Real no ano seguinte.`, acao: null });
    else if (anual > 500000000 && params.lc224) out.push({ id: 'lc224', severidade: 'baixa', titulo: 'Acréscimo da LC 224/2025 no Lucro Presumido', texto: `A receita projetada (${fmt(Math.round(anual))}) supera R$ 5 milhões/ano: sobre o excedente, a presunção do IRPJ e da CSLL tem acréscimo de 10% (LC 224/2025). Há discussões judiciais: confirme com o tributário.`, acao: { tipo: 'relatorio', rel: 'lalur', rotulo: 'Ver a apuração' } });
  }
  return out;
}

/* ---------------------------------------------------------------- indicadores */
const div = (a, b) => (b ? a / b : null);
export function indicadores(bp, dr) {
  const ac = bp.ativo.circulante.total, pc = bp.passivo.circulante.total, disp = bp.ativo.circulante.contas.filter(c => c.codigo === '1.1.1').reduce((a, c) => a + c.valor, 0);
  const estq = bp.ativo.circulante.contas.filter(c => c.codigo === '1.1.3').reduce((a, c) => a + c.valor, 0), pass = bp.passivo.total, pl = bp.patrimonioLiquido.total;
  return { liquidezCorrente: div(ac, pc), liquidezSeca: div(ac - estq, pc), liquidezImediata: div(disp, pc), liquidezGeral: div(ac + bp.ativo.naoCirculante.contas.filter(c => c.codigo === '1.2.1').reduce((a, c) => a + c.valor, 0), pass),
    endividamento: div(pass, bp.ativo.total), composicaoEndividamento: div(pc, pass), margemLiquida: div(dr.ll, dr.rl), margemBruta: div(dr.linhas.find(l => l.chave === 'lb')?.valor || 0, dr.rl), roe: div(dr.ll, pl), patrimonioLiquido: pl, capitalCirculante: ac - pc };
}

/* ---------------------------------------------------------------- score 0-100 */
export function score({ integridade, balancete: b, balanco: bp, invertidas, conciliacao, variacoes: vs, ind, tributos }) {
  const r = (v, a, z) => Math.max(0, Math.min(1, (v - z) / (a - z))); /* 0 em z, 1 em a */
  const integ = [
    ['Cadeia de conferência dos lançamentos', integridade.cadeiaIntegra ? 1 : 0, 12],
    ['Partidas dobradas (D = C em todos)', integridade.equilibrados ? 1 : 0, 10],
    ['Balancete fecha (Σ D = Σ C)', b.confere ? 1 : 0, 8],
    ['Balanço fecha (Ativo = Passivo + PL)', bp.confere ? 1 : 0, 8],
    ['Contas sem saldo invertido', Math.max(0, 1 - invertidas.length * 0.25), 12],
    ['Conciliação com o FCX', conciliacao.total ? Math.max(0, 1 - conciliacao.pendentes / conciliacao.total) : 1, 10],
  ];
  const saude = [
    ['Liquidez corrente', ind.liquidezCorrente == null ? 0.5 : r(ind.liquidezCorrente, 1.5, 0.5), 12],
    ['Endividamento geral', ind.endividamento == null ? 0.5 : 1 - r(ind.endividamento, 0.9, 0.4), 10],
    ['Margem líquida', ind.margemLiquida == null ? 0.5 : r(ind.margemLiquida, 0.08, -0.05), 8],
    ['Patrimônio líquido positivo', ind.patrimonioLiquido > 0 ? 1 : 0, 5],
    ['Estabilidade (variações mês a mês)', Math.max(0, 1 - vs.length * 0.15), 3],
    ['Conformidade tributária', Math.max(0, 1 - tributos.filter(t => t.severidade !== 'baixa').length * 0.35), 2],
  ];
  const nota = l => Math.round(l.reduce((a, [, v, p]) => a + v * p, 0) / l.reduce((a, [, , p]) => a + p, 0) * 100);
  const todos = [...integ, ...saude], total = Math.round(todos.reduce((a, [, v, p]) => a + v * p, 0));
  return { total, integridade: nota(integ), saude: nota(saude), faixa: total >= 80 ? 'saudavel' : total >= 60 ? 'atencao' : 'critico', fatores: todos.map(([rotulo, v, peso]) => ({ rotulo, nota: Math.round(v * 100), peso })) };
}

/* ---------------------------------------------------------------- DFC (CPC 03) — método direto pela contrapartida do Disponível */
const CLASSE = cod => (cod.startsWith('1.2.') ? 'investimento' : cod.startsWith('2.2.') || cod.startsWith('2.1.4.') || cod.startsWith('3.') || cod.startsWith('2.1.5.01.003') ? 'financiamento' : 'operacional');
const ROT_DFC = { operacional: 'Atividades operacionais', investimento: 'Atividades de investimento', financiamento: 'Atividades de financiamento' };
export function dfc(contas, lancamentos, caixaInicial) {
  const nome = new Map(contas.map(c => [c.codigo, c.nome])), pai = cod => { const c = contas.find(x => x.codigo === cod); return c?.pai || cod; };
  const grupos = { operacional: new Map(), investimento: new Map(), financiamento: new Map() };
  for (const l of lancamentos) {
    const disp = l.itens.filter(i => i.conta.startsWith('1.1.1.')), outros = l.itens.filter(i => !i.conta.startsWith('1.1.1.'));
    const liq = disp.reduce((a, i) => a + (i.dc === 'D' ? i.valor : -i.valor), 0); if (!liq || !outros.length) continue; /* transferência entre caixa e bancos não é fluxo */
    const base = outros.reduce((a, i) => a + i.valor, 0);
    for (const i of outros) { const parte = Math.round(liq * i.valor / base), k = CLASSE(i.conta), chave = pai(i.conta), g = grupos[k]; g.set(chave, (g.get(chave) || 0) + parte); }
  }
  const blocos = Object.entries(grupos).map(([k, m]) => ({ id: k, rotulo: ROT_DFC[k], linhas: [...m.entries()].sort((a, b) => cmpCodigo(a[0], b[0])).map(([cod, v]) => ({ codigo: cod, nome: nome.get(cod) || cod, valor: v })).filter(x => x.valor), total: [...m.values()].reduce((a, v) => a + v, 0) }));
  const variacao = blocos.reduce((a, b) => a + b.total, 0);
  return { metodo: 'direto', caixaInicial, blocos, variacao, caixaFinal: caixaInicial + variacao, notas: ['Método direto (CPC 03 · Lei 6.404 art. 188): cada movimento do Disponível (1.1.1) é classificado pela contrapartida — Ativo não circulante = investimento; empréstimos, PL e dividendos = financiamento; o restante = operacional. Transferências entre caixa e bancos não são fluxo.'] };
}

/* ---------------------------------------------------------------- DRE no formato do CPC 51 (IFRS 18) */
/* CPC 51 / IFRS 18 (vigência 2027): categorias operacional, investimento e financiamento, com os subtotais obrigatórios
   "Resultado operacional" e "Resultado antes do financiamento e dos tributos sobre o lucro". Aproximação gerencial a partir
   das linhas do plano: receitas financeiras = categoria de investimento; despesas financeiras = categoria de financiamento. */
export function dreCpc51(d) {
  const v = k => d.linhas.find(l => l.chave === k)?.valor || 0, rl = v('rl'), cmv = v('cmv'), dv = v('dv'), dga = v('dga'), oro = v('oro'), odo = v('odo'), rf = v('rf'), df = v('df'), ir = v('ir');
  const rop = rl + cmv + dv + dga + oro + odo, rafi = rop + rf, lair = rafi + df, ll = lair + ir;
  const L = (chave, rotulo, valor, tipo = 'linha', nivel = 1) => ({ chave, rotulo, valor, tipo, nivel });
  return { modelo: 'cpc51', ll, linhas: [
    L('cat-op', 'Categoria operacional', null, 'titulo', 0), L('rl', 'Receita líquida', rl, 'linha'), L('cmv', '(-) Custo das mercadorias e serviços vendidos', cmv), L('lb', 'Lucro bruto', rl + cmv, 'subtotal'),
    L('dv', '(-) Despesas com vendas', dv), L('dga', '(-) Despesas gerais e administrativas', dga), L('oro', '(+) Outras receitas operacionais', oro), L('odo', '(-) Outras despesas operacionais', odo),
    L('rop', 'Resultado operacional', rop, 'total', 0),
    L('cat-inv', 'Categoria de investimento', null, 'titulo', 0), L('rf', '(+) Receitas de aplicações financeiras e juros recebidos', rf),
    L('rafi', 'Resultado antes do financiamento e dos tributos sobre o lucro', rafi, 'total', 0),
    L('cat-fin', 'Categoria de financiamento', null, 'titulo', 0), L('df', '(-) Despesas de juros e encargos financeiros', df),
    L('lair', 'Resultado antes dos tributos sobre o lucro', lair, 'total', 0), L('ir', '(-) IRPJ e CSLL', ir),
    L('ll', ll >= 0 ? 'Lucro líquido do período' : 'Prejuízo do período', ll, 'total', 0)],
    notas: ['CPC 51 (correlato à IFRS 18, vigente a partir de 2027): resultado em categorias operacional, de investimento e de financiamento, com os subtotais "Resultado operacional" e "Resultado antes do financiamento e dos tributos sobre o lucro".',
      'Aproximação gerencial pelo plano de contas: receitas financeiras na categoria de investimento e despesas financeiras na de financiamento. Tarifas bancárias e juros de antecipação de recebíveis ligados à operação podem pertencer à categoria operacional: revise com o contador.'] };
}

/* ---------------------------------------------------------------- parecer (texto da Inteligência de Auditoria) */
export function parecer({ sc, invertidas, conciliacao, variacoes: vs, tributos, ind, bp }) {
  const frases = [], ajustes = [];
  frases.push(sc.faixa === 'saudavel' ? 'A escrituração do período apresenta-se íntegra e a situação econômico-financeira é saudável.' : sc.faixa === 'atencao' ? 'A escrituração do período é consistente, mas há pontos de atenção que devem ser regularizados antes do fechamento.' : 'Foram encontradas inconsistências relevantes: recomenda-se regularizá-las antes de emitir as demonstrações definitivas.');
  if (!bp.confere) frases.push(`O Balanço Patrimonial não fecha (diferença de ${fmt(bp.diferenca)}).`);
  if (ind.liquidezCorrente != null) frases.push(`Liquidez corrente de ${ind.liquidezCorrente.toFixed(2).replace('.', ',')} ${ind.liquidezCorrente >= 1 ? '(o ativo circulante cobre as obrigações de curto prazo)' : '(o ativo circulante não cobre as obrigações de curto prazo)'}.`);
  if (ind.endividamento != null) frases.push(`Endividamento geral de ${Math.round(ind.endividamento * 100)}% do ativo.`);
  invertidas.forEach(x => ajustes.push(`Regularizar o saldo ${x.natureza} de ${x.conta} · ${x.nome} (${fmt(x.valor)})${x.destino ? ` contra ${x.destino.codigo} · ${x.destino.nome}` : ''}.`));
  if (conciliacao.pendentes) ajustes.push(`Conciliar com o FCX ${conciliacao.pendentes} movimento(s) do Disponível sem documento de origem${conciliacao.deparaPendente ? ` e revisar ${conciliacao.deparaPendente} conta(s) pendentes no de-para` : ''}.`);
  vs.slice(0, 3).forEach(x => ajustes.push(`Justificar a variação de ${x.variacao == null ? 'conta nova no mês' : Math.round(x.variacao * 100) + '%'} em ${x.conta} · ${x.nome} (${fmt(x.anterior)} → ${fmt(x.atual)}).`));
  tributos.filter(t => t.severidade !== 'baixa').forEach(t => ajustes.push(t.titulo + '.'));
  return { conclusao: frases.join(' '), ajustes, opiniao: sc.faixa === 'saudavel' && !ajustes.length ? 'sem ressalvas' : sc.faixa === 'critico' ? 'com ressalvas relevantes' : 'com ressalvas' };
}
export { balancete, balanco, dre };
