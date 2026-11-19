/* v13.91 · Módulo Contábil multiempresas: empresas (CNPJ, QSA, contador/CRC), lançamentos por empresa, disponibilidades,
   Livro Caixa, fórmulas do Diário, DFC, DRE do CPC 51, Radar de Saúde e Motor de Crítica. Dados FICTÍCIOS.
   Uso: bash tests/preparar-banco.sh && NETLIFY_DB_URL=postgres://postgres@127.0.0.1:54329/painel_teste node tests/servidor-local.mjs 8890 &
        NETLIFY_DB_URL=postgres://postgres@127.0.0.1:54329/painel_teste node tests/teste-contabil-v1391.mjs */
import pg from 'pg';
import { gerar } from '../netlify/lib/senha.mjs';
const U = 'http://localhost:8890', OK = [], FAIL = [];
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 1200) : '')); };
const db = new pg.Pool({ connectionString: process.env.NETLIFY_DB_URL }), sql = (t, p) => db.query(t, p).then(r => r.rows);
const usuario = async (id, perfil, cpf, permissoes = {}) => { const u = { perfil, nome: 'Teste ' + id, cpf, ativo: true, permissoes, trocarSenha: false, senha: gerar('Teste2026Ab', 'sal-' + id) };
  await sql(`INSERT INTO documentos (caminho, colecao, doc_id, dados) VALUES ($1, 'usuarios', $2, $3) ON CONFLICT (caminho) DO UPDATE SET dados = EXCLUDED.dados`, ['usuarios/' + id, id, JSON.stringify(u)]); };
async function login(cpf) { const r = await fetch(U + '/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json', 'x-painel': '1' }, body: JSON.stringify({ cpf, senha: 'Teste2026Ab' }) }); return (r.headers.get('set-cookie') || '').split(';')[0]; }
const api = ck => async (met, rota, corpo) => { const r = await fetch(U + '/api/contabil' + rota, { method: met, headers: { cookie: ck, 'content-type': 'application/json', 'x-painel': '1' }, body: corpo ? JSON.stringify(corpo) : undefined }); let j = null; try { j = await r.json(); } catch { } return { s: r.status, j }; };

await usuario('usr-master-91', 'MASTER', '52998224725');
await sql(`INSERT INTO documentos (caminho, colecao, doc_id, dados) VALUES ('config/recursos', 'config', 'recursos', $1) ON CONFLICT (caminho) DO UPDATE SET dados = EXCLUDED.dados`, [JSON.stringify({ contabil_v1386: { ativo: true }, contabil_v1391: { ativo: true } })]);
await usuario('usr-op-ler-91', 'OPERACIONAL', '11144477735', { contabil: 'ler' });
const M = api(await login('52998224725')), O = api(await login('11144477735'));
await M('POST', '/plano-padrao');

/* ---------- empresas ---------- */
let r = await M('GET', '/empresas');
chk('migração: a "Empresa principal" existe e recebe os lançamentos anteriores', r.s === 200 && r.j.empresas.length === 1 && r.j.empresas[0].id === 'emp_principal' && r.j.empresas[0].principal, r);
const e1 = await M('POST', '/empresas', { cnpj: '11.222.333/0001-81', razaoSocial: 'COMERCIO FICTICIO ALFA LTDA', nomeFantasia: 'Alfa Fictícia', regime: 'presumido', capitalSocial: '100.000,00',
  socios: [{ nome: 'SOCIO FICTICIO UM', documento: '***.444.777-**', qualificacao: 'Sócio-Administrador', participacao: 60 }, { nome: 'SOCIA FICTICIA DOIS', qualificacao: 'Sócia', participacao: 40 }],
  contador: { nome: 'CONTADORA FICTICIA', crc: 'PE-012345/O', uf: 'PE', email: 'contabil@exemplo.com.br' } });
const bad = await M('POST', '/empresas', { cnpj: '11.222.333/0001-82', razaoSocial: 'X LTDA' }), bad2 = await M('POST', '/empresas', { cnpj: '45.997.418/0001-53', razaoSocial: 'Y LTDA', socios: [{ nome: 'A', participacao: 70 }, { nome: 'B', participacao: 40 }] }), dup = await M('POST', '/empresas', { cnpj: '11222333000181', razaoSocial: 'DUPLICADA' });
const ro = await O('POST', '/empresas', { cnpj: '45.997.418/0001-53', razaoSocial: 'Z LTDA' });
chk('cadastro de empresa: CNPJ validado (dígitos), QSA com participação ≤ 100%, CRC, CNPJ único; só quem gere os parâmetros cadastra', e1.s === 201 && e1.j.empresa.cnpj === '11222333000181' && e1.j.empresa.capitalSocial === 100000 && e1.j.empresa.socios.length === 2 && e1.j.empresa.contador.crc === 'PE-012345/O'
  && bad.s === 422 && /CNPJ/.test(bad.j.erro) && bad2.s === 422 && /participa/.test(bad2.j.erro) && dup.s === 409 && ro.s === 403, [e1, bad, bad2, dup, ro]);
const A = e1.j.empresa.id;

/* ---------- lançamentos por empresa ---------- */
const L = (emp, data, historico, itens, extra = {}) => M('POST', '/lancamentos', { empresa: emp, data, historico, itens: itens.map(([conta, dc, valor]) => ({ conta, dc, valor })), ...extra });
const ls = [
  await L(A, '2026-09-01', 'Integralização de capital (fictícia)', [['1.1.1.02.001', 'D', 100000], ['3.1.1', 'C', 100000]], { origem: 'aumento_capital', docRef: 'CONTRATO-1' }),
  await L(A, '2026-09-05', 'Compra de mercadorias', [['1.1.3.01.001', 'D', 40000], ['2.1.1.01.001', 'C', 40000]], { docRef: 'NF-100' }),
  await L(A, '2026-09-20', 'Venda de mercadorias à vista com custo', [['1.1.1.01.001', 'D', 30000], ['4.1.1.01', 'C', 30000]], { docRef: 'FCX-0920' }),
  await L(A, '2026-09-20', 'Baixa do CMV', [['5.1.1.01', 'D', 12000], ['1.1.3.01.001', 'C', 12000]], { docRef: 'FCX-0920' }),
  await L(A, '2026-10-02', 'Pagamento ao fornecedor com juros (2ª fórmula: 1D:nC)', [['2.1.1.01.001', 'D', 41000], ['1.1.1.02.001', 'C', 40000], ['1.1.1.01.001', 'C', 1000]]),
  await L(A, '2026-10-10', 'Venda à vista com ICMS (3ª fórmula: nD:1C)', [['1.1.1.01.001', 'D', 50000], ['1.1.2.01.002', 'D', 20000], ['4.1.1.01', 'C', 70000]], { docRef: 'FCX-1010' }),
  await L(A, '2026-10-12', 'Rateio de despesas (4ª fórmula: nD:nC)', [['5.3.2.03', 'D', 3000], ['5.3.3.01', 'D', 9000], ['1.1.1.02.001', 'C', 7000], ['1.1.1.01.001', 'C', 5000]]),
  await L(A, '2026-10-15', 'Saque lançado no banco a maior (deixa o banco credor)', [['1.1.1.01.001', 'D', 70000], ['1.1.1.02.001', 'C', 70000]]),
  await L(A, '2026-10-20', 'Baixa do CMV de outubro', [['5.1.1.01', 'D', 30000], ['1.1.3.01.001', 'C', 30000]], { docRef: 'FCX-1020' }),
  await L('emp_principal', '2026-10-05', 'Venda da empresa principal (não aparece na Alfa)', [['1.1.1.01.001', 'D', 999], ['4.1.1.01', 'C', 999]]),
];
chk('lançamentos gravados em cada empresa (o servidor confere partidas dobradas)', ls.every(x => x.s === 201), ls.filter(x => x.s !== 201));
r = await M('GET', `/lancamentos?empresa=${A}&de=2026-01-01&ate=2026-12-31`); const r0 = await M('GET', '/lancamentos?de=2026-01-01&ate=2026-12-31');
chk('lançamentos separados por empresa: a Alfa vê os 9 dela; a principal só o dela', r.j.lancamentos.length === 9 && r.j.lancamentos.every(l => l.empresa === A) && r0.j.lancamentos.length === 1 && r0.j.lancamentos[0].empresa === 'emp_principal', [r.j.lancamentos.length, r0.j.lancamentos.map(l => l.empresa)]);

/* ---------- disponibilidades ---------- */
r = await M('GET', `/disponibilidades?empresa=${A}&de=2026-10-01&ate=2026-10-31`); const card = id => r.j.cards.find(c => c.id === id);
chk('disponibilidades (outubro): Caixa 1.1.1.01 entradas 120.000 / saídas 6.000; Bancos 1.1.1.02 saldo anterior 100.000, pagamentos 117.000, saldo −17.000; Estoque baixas de CMV 30.000',
  card('caixa').saldoAnterior === 30000 && card('caixa').entradas === 120000 && card('caixa').saidas === 6000 && card('caixa').saldo === 144000 && card('bancos').saldoAnterior === 100000 && card('bancos').saidas === 117000 && card('bancos').saldo === -17000
  && card('estoque').saldoAnterior === 28000 && card('estoque').saidas === 30000 && card('estoque').saldo === -2000 && r.j.consolidado === 144000 - 17000 - 2000 && r.j.escrituracao.debitos === r.j.escrituracao.creditos && r.j.escrituracao.confere && r.j.escrituracao.lancamentos === 5, r.j);

/* ---------- Diário (fórmulas), Livro Caixa, DFC, DRE CPC 51 ---------- */
r = await M('GET', `/relatorios/diario?empresa=${A}&de=2026-01-01&ate=2026-12-31`);
chk('Livro Diário: Σ D = Σ C, equilíbrio e as 4 fórmulas (6 de 1ª, 1 de 2ª, 1 de 3ª, 1 de 4ª)', r.j.resumo.equilibrado && r.j.resumo.debitos === r.j.resumo.creditos && JSON.stringify(r.j.resumo.formulas) === '{"1":6,"2":1,"3":1,"4":1}' && r.j.lancamentos[4].formula === 2, r.j.resumo);
r = await M('GET', `/relatorios/caixa?empresa=${A}&de=2026-10-01&ate=2026-10-31`);
chk('Livro Caixa (1.1.1.01): saldo inicial, entradas, saídas, saldo final e o responsável técnico (CRC) da empresa', r.s === 200 && r.j.saldoAnterior === 30000 && r.j.entradas === 120000 && r.j.saidas === 6000 && r.j.saldoFinal === 144000 && r.j.responsavel.crc === 'PE-012345/O', r.j);
r = await M('GET', `/relatorios/dfc?empresa=${A}&de=2026-01-01&ate=2026-12-31`); const bl = id => r.j.blocos.find(b => b.id === id);
chk('DFC (método direto): financiamento = capital 100.000; operacional = vendas − fornecedor − despesas; transferência caixa↔banco não entra; caixa final = disponível', r.s === 200 && bl('financiamento').total === 100000 && bl('operacional').total === 30000 + 50000 - 41000 - 12000 && r.j.caixaInicial === 0 && r.j.caixaFinal === 127000, r.j);
r = await M('GET', `/relatorios/dre51?empresa=${A}&de=2026-01-01&ate=2026-12-31`); const lin = k => r.j.linhas.find(l => l.chave === k)?.valor;
chk('DRE no formato do CPC 51 (IFRS 18): categorias e subtotais "Resultado operacional" e "Resultado antes do financiamento e dos tributos"', r.s === 200 && lin('rl') === 100000 && lin('cmv') === -42000 && lin('rop') === 100000 - 42000 - 12000 && lin('rafi') === lin('rop') && r.j.linhas.some(l => l.chave === 'cat-fin') && r.j.ll === 46000, r.j.linhas);
r = await M('GET', `/relatorios/balancete?empresa=emp_principal&de=2026-01-01&ate=2026-12-31`);
chk('relatórios por empresa: o balancete da principal só tem a venda dela (999)', r.j.totais.debitos === 999 && r.j.confere, r.j.totais);

/* ---------- Radar de Saúde e Motor de Crítica ---------- */
r = await M('GET', `/radar?empresa=${A}&de=2026-01-01&ate=2026-10-31`); const R = r.j, sug = id => R.sugestoes.find(s => s.id === id);
chk('Radar: score de 0 a 100 com notas de integridade e de saúde financeira, indicadores e parecer', r.s === 200 && R.score.total >= 0 && R.score.total <= 100 && R.score.integridade >= 0 && R.score.saude >= 0 && R.score.fatores.length === 12 && R.indicadores.liquidezCorrente != null && R.parecer.conclusao.length > 40 && R.integridade.cadeiaIntegra && R.integridade.equilibrados, R);
const inv = sug('inv:1.1.1.02.001'), est = sug('inv:1.1.3.01.001');
chk('Motor de Crítica: banco com saldo credor → correção proposta (reclassificar 17.000 para Empréstimos Bancários), estoque credor sinalizado', inv && inv.acao.tipo === 'lancamento' && inv.acao.proposta.itens[0].conta === '1.1.1.02.001' && inv.acao.proposta.itens[0].dc === 'D' && inv.acao.proposta.itens[1].conta === '2.1.4.01.001' && inv.acao.proposta.itens[0].valor === 17000 && est, R.sugestoes.map(s => s.id));
const fcx = sug('fcx');
chk('Motor de Crítica: movimentos do Disponível sem documento de origem = pendentes de conciliação com o FCX (3 de 6)', fcx && R.conciliacao.total === 6 && R.conciliacao.pendentes === 3 && fcx.lista.length === 3, R.conciliacao);
const vr = R.sugestoes.filter(s => s.id.startsWith('var:')).map(s => s.conta);
chk('Motor de Crítica: variação desproporcional em relação ao mês anterior (receita +133%, CMV +150%, despesas novas no mês)', vr.includes('4.1.1.01') && vr.includes('5.1.1.01') && vr.includes('5.3.3.01'), vr);
chk('Motor de Crítica: recomendações tributárias — retenções na fonte (Serviços de Terceiros sem contas próprias), ano-teste 2026 do IBS/CBS e simulação Atual × Reforma', sug('retencoes') && sug('reforma-teste') && sug('reforma-impacto') && /LC 214\/2025/.test(sug('reforma-teste').texto), R.sugestoes.map(s => s.id));
const c1 = await M('POST', '/radar/corrigir', { tipo: 'retencoes' }), c2 = await M('POST', '/radar/corrigir', { tipo: 'retencoes' }), cO = await O('POST', '/radar/corrigir', { tipo: 'retencoes' });
r = await M('GET', `/radar?empresa=${A}&de=2026-01-01&ate=2026-10-31`);
chk('botão de correção "Criar as contas de retenções": cria 2.1.3.03 e as 4 analíticas uma vez só; quem só lê não corrige; o alerta some', c1.s === 201 && c1.j.criadas.length === 5 && c2.s === 201 && c2.j.criadas.length === 0 && cO.s === 403 && !r.j.sugestoes.some(s => s.id === 'retencoes'), [c1.j, c2.j, cO.s]);
const p = inv.acao.proposta, gr = await M('POST', '/lancamentos', { empresa: A, data: '2026-10-31', historico: p.historico, itens: p.itens });
r = await M('GET', `/radar?empresa=${A}&de=2026-01-01&ate=2026-10-31`);
chk('aplicar a correção proposta (o usuário confere e grava) zera o saldo invertido do banco e o score sobe', gr.s === 201 && !r.j.sugestoes.some(s => s.id === 'inv:1.1.1.02.001') && r.j.score.total > R.score.total, [gr.s, R.score.total, r.j.score.total]);
r = await O('GET', `/radar?empresa=${A}&de=2026-01-01&ate=2026-10-31`);
chk('quem lê o Módulo Contábil vê o Radar', r.s === 200 && r.j.score, r.s);

/* ---------- integridade ---------- */
r = await M('GET', '/integridade');
chk('cadeia de conferência íntegra com lançamentos de várias empresas (a empresa entra no hash dos novos)', r.j.cadeiaIntegra && r.j.equilibrados, r.j);
await sql(`ALTER TABLE contab_lancamentos DISABLE TRIGGER contab_lanc_intangivel`); await sql(`UPDATE contab_lancamentos SET empresa_id = 'emp_principal' WHERE numero = (SELECT max(numero) FROM contab_lancamentos WHERE empresa_id <> 'emp_principal')`); await sql(`ALTER TABLE contab_lancamentos ENABLE TRIGGER contab_lanc_intangivel`);
r = await M('GET', '/integridade');
chk('mover um lançamento de empresa por fora do sistema quebra a cadeia (detectado)', !r.j.cadeiaIntegra && r.j.quebras.length >= 1, r.j);
console.log(`\nOK (${OK.length})  FALHAS (${FAIL.length})`); await db.end(); process.exit(FAIL.length ? 1 : 0);
