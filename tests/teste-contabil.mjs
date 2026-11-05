/* v13.86 · Teste do Módulo Contábil (API /api/contabil + Postgres). Dados FICTÍCIOS.
   Uso: bash tests/preparar-banco.sh && NETLIFY_DB_URL=postgres://postgres@127.0.0.1:54329/painel_teste node tests/servidor-local.mjs 8890 &
        NETLIFY_DB_URL=postgres://postgres@127.0.0.1:54329/painel_teste node tests/teste-contabil.mjs */
import pg from 'pg';
import { gerar } from '../netlify/lib/senha.mjs';
const U = 'http://localhost:8890', OK = [], FAIL = [];
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 900) : '')); };
const db = new pg.Pool({ connectionString: process.env.NETLIFY_DB_URL }), sql = (t, p) => db.query(t, p).then(r => r.rows);
const usuario = async (id, perfil, cpf, permissoes = {}) => { const u = { perfil, nome: 'Teste ' + id, cpf, ativo: true, permissoes, trocarSenha: false, senha: gerar('Teste2026Ab', 'sal-' + id) };
  await sql(`INSERT INTO documentos (caminho, colecao, doc_id, dados) VALUES ($1, 'usuarios', $2, $3) ON CONFLICT (caminho) DO UPDATE SET dados = EXCLUDED.dados`, ['usuarios/' + id, id, JSON.stringify(u)]); };
async function login(cpf) { const r = await fetch(U + '/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json', 'x-painel': '1' }, body: JSON.stringify({ cpf, senha: 'Teste2026Ab' }) }); const c = r.headers.get('set-cookie'); if (!r.ok) throw new Error('login ' + r.status + ' ' + await r.text()); return c.split(';')[0]; }
const api = ck => async (met, rota, corpo) => { const r = await fetch(U + '/api/contabil' + rota, { method: met, headers: { cookie: ck, 'content-type': 'application/json', 'x-painel': '1' }, body: corpo ? JSON.stringify(corpo) : undefined }); let j = null; try { j = await r.json(); } catch { } return { s: r.status, j }; };

await usuario('usr-master-ct', 'MASTER', '52998224725');
await usuario('usr-op-ler', 'OPERACIONAL', '11144477735', { contabil: 'ler' });
await usuario('usr-op-sem', 'OPERACIONAL', '39053344705', {});
await usuario('usr-loja-ct', 'LOJA', '12345678909', { contabil: 'excluir' });
const M = api(await login('52998224725'));

/* ---------- plano de contas ---------- */
let r = await M('GET', ''); chk('status inicial: sem plano de contas e com todas as permissões para o Master', r.s === 200 && !r.j.plano.criado && r.j.permissoes.length === 5, r);
r = await M('POST', '/plano-padrao'); const r2 = await M('POST', '/plano-padrao');
chk('plano padrão (comércio varejista) criado uma única vez: 184 contas; 2ª vez recusada', r.s === 201 && r.j.criadas === 184 && r2.s === 409, [r, r2]);
r = await M('GET', '/contas'); const contas = r.j.contas, por = new Map(contas.map(c => [c.codigo, c]));
chk('árvore: sintéticas/analíticas, naturezas pelo grupo e retificadoras com natureza oposta', por.get('1.1.1').tipo === 'S' && por.get('1.1.1.01.001').tipo === 'A' && por.get('2.1.1.01.001').natureza === 'C' && por.get('1.2.3.02.004').natureza === 'C' && por.get('1.2.3.02.004').redutora && por.get('4.2.2.01').natureza === 'D' && por.get('5.1.1.01').natureza === 'D', [por.get('1.2.3.02.004'), por.get('4.2.2.01')]);
const ia = {}; for (const n of ['Aluguel a Pagar', 'Venda de Mercadorias', 'Banco Itaú', '(-) ICMS sobre Vendas', 'IBS a Recolher', 'Despesas Administrativas']) ia[n] = (await M('POST', '/classificar', { nome: n })).j.sugestao;
chk('IA · "Aluguel a Pagar" → 2. Passivo, Credora, Analítica, em Contas a Pagar (2.1.5.01)', ia['Aluguel a Pagar'].grupo === 2 && ia['Aluguel a Pagar'].natureza === 'C' && ia['Aluguel a Pagar'].tipo === 'A' && ia['Aluguel a Pagar'].pai === '2.1.5.01', ia['Aluguel a Pagar']);
chk('IA · "Venda de Mercadorias" → 4. Receitas, Credora, DRE receita bruta; tributos ICMS/PIS/COFINS (atual) e IBS/CBS (reforma)', ia['Venda de Mercadorias'].grupo === 4 && ia['Venda de Mercadorias'].natureza === 'C' && ia['Venda de Mercadorias'].dre === 'rb' && ia['Venda de Mercadorias'].modeloTributario === 'ambos' && ['ICMS', 'PIS', 'COFINS', 'IBS', 'CBS'].every(t => ia['Venda de Mercadorias'].tributos.includes(t)), ia['Venda de Mercadorias']);
chk('IA · "Banco Itaú" → 1. Ativo, Devedora, Analítica, em Bancos Conta Movimento, com o próximo código (1.1.1.02.002)', ia['Banco Itaú'].grupo === 1 && ia['Banco Itaú'].natureza === 'D' && ia['Banco Itaú'].tipo === 'A' && ia['Banco Itaú'].pai === '1.1.1.02' && ia['Banco Itaú'].codigo === '1.1.1.02.002', ia['Banco Itaú']);
chk('IA · "(-) ICMS sobre Vendas" retificadora devedora (modelo atual) · "IBS a Recolher" passivo (reforma) · "Despesas Administrativas" sintética', ia['(-) ICMS sobre Vendas'].redutora && ia['(-) ICMS sobre Vendas'].natureza === 'D' && ia['(-) ICMS sobre Vendas'].modeloTributario === 'atual' && ia['IBS a Recolher'].grupo === 2 && ia['IBS a Recolher'].modeloTributario === 'reforma' && ia['Despesas Administrativas'].tipo === 'S', ia);
r = await M('POST', '/contas', { nome: 'Banco Itaú' });
chk('criar conta só com o nome: a IA preenche grupo, natureza, tipo, mãe e código, e guarda a confiança e os motivos', r.s === 201 && r.j.conta.codigo === '1.1.1.02.002' && r.j.conta.natureza === 'D' && r.j.conta.tipo === 'A' && r.j.conta.ia.confianca > 0.5 && r.j.conta.ia.motivos.length > 0, r);
const v1 = await M('POST', '/contas', { codigo: '1.1.1.02.003', nome: 'Conta Errada', natureza: 'C' }), v2 = await M('POST', '/contas', { codigo: '1.1.1.02.002.001', nome: 'Sub do Itaú' }), v3 = await M('POST', '/contas', { codigo: '1.1.1.02.004', nome: 'banco itaú' }), v4 = await M('POST', '/contas', { codigo: '6.1', nome: 'Grupo inexistente' });
chk('validador: natureza incoerente com o grupo (sem ser retificadora), mãe analítica, nome repetido na mesma mãe e grupo 6 são recusados', v1.s === 422 && /Natureza incoerente/.test(v1.j.erro) && v2.s === 422 && /analítica/.test(v2.j.erro) && v3.s === 409 && v4.s === 422, [v1, v2, v3, v4]);

/* ---------- lançamentos ---------- */
const L = (data, historico, itens, extra = {}) => M('POST', '/lancamentos', { data, historico, itens: itens.map(([conta, dc, valor]) => ({ conta, dc, valor })), ...extra });
const ls = [
  await L('2026-03-02', 'Integralização de capital', [['1.1.1.02.002', 'D', 5000], ['3.1.1', 'C', 5000]], { origem: 'aumento_capital' }),
  await L('2026-03-03', 'Compra de mercadorias NF 101', [['1.1.3.01.001', 'D', '1.000,00'], ['2.1.1.01.001', 'C', '1.000,00']]),
  await L('2026-03-10', 'Venda à vista do dia', [['1.1.1.01.001', 'D', 1000], ['4.1.1.01', 'C', 1000]]),
  await L('2026-03-10', 'Tributos sobre as vendas do dia', [['4.2.2.01', 'D', 180], ['4.2.2.02', 'D', 16.5], ['4.2.2.03', 'D', 76], ['2.1.3.01.001', 'C', 180], ['2.1.3.01.002', 'C', 16.5], ['2.1.3.01.003', 'C', 76]]),
  await L('2026-03-10', 'Baixa do custo das mercadorias vendidas', [['5.1.1.01', 'D', 400], ['1.1.3.01.001', 'C', 400]]),
  await L('2026-03-31', 'Aluguel de março', [['5.3.2.01', 'D', 200], ['2.1.5.01.001', 'C', 200]]),
  await L('2026-03-31', 'Rendimento de aplicação', [['1.1.1.03.001', 'D', 10], ['4.4.1.01', 'C', 10]]),
];
chk('7 lançamentos equilibrados gravados, numerados e com hash encadeado', ls.every(x => x.s === 201) && ls.map(x => x.j.lancamento.numero).join() === '1,2,3,4,5,6,7' && ls[1].j.lancamento.total === 1000 && ls.every(x => /^[0-9a-f]{64}$/.test(x.j.lancamento.hash)), ls.find(x => x.s !== 201));
const d1 = await L('2026-03-10', 'Venda desequilibrada', [['1.1.1.01.001', 'D', 100], ['4.1.1.01', 'C', 99.99]]), d2 = await L('2026-03-10', 'Só débito', [['1.1.1.01.001', 'D', 100], ['5.3.2.01', 'D', 100]]);
const d3 = await L('2026-03-10', 'Em conta sintética', [['1.1.1', 'D', 10], ['4.1.1.01', 'C', 10]]), d4 = await L('2026-03-10', 'Três casas', [['1.1.1.01.001', 'D', 10.005], ['4.1.1.01', 'C', 10.005]]);
chk('API bloqueia: débitos ≠ créditos (mostra a diferença), sem crédito, conta sintética e valor com 3 casas', d1.s === 422 && /débitos \(R\$\s100,00\) diferentes dos créditos \(R\$\s99,99\)/.test(d1.j.erro) && d1.j.debitos === 100 && d2.s === 422 && d3.s === 422 && /sintética/.test(d3.j.erro) && d4.s === 422, [d1, d2, d3, d4]);
/* direto no banco (sem passar pela API) */
const tenta = async t => { try { await t(); return 'gravou'; } catch (e) { return e.message; } };
const cli = await db.connect();
const b1 = await tenta(async () => { await cli.query('BEGIN'); try { await cli.query(`INSERT INTO contab_lancamentos (id, data, historico, total_centavos, hash, criado_por) VALUES ('x1', '2026-03-15', 'direto no banco', 1000, 'h-x1', 't')`); await cli.query(`INSERT INTO contab_partidas VALUES ('x1', 1, '1.1.1.01.001', 'D', 1000, null, null), ('x1', 2, '4.1.1.01', 'C', 900, null, null)`); await cli.query('COMMIT'); } catch (e) { await cli.query('ROLLBACK'); throw e; } });
cli.release();
const b2 = await tenta(() => sql(`UPDATE contab_partidas SET valor_centavos = 1 WHERE lancamento_id = $1`, [ls[2].j.lancamento.id])), b3 = await tenta(() => sql(`DELETE FROM contab_lancamentos WHERE numero = 7`)), b4 = await tenta(() => sql(`TRUNCATE contab_partidas`));
const b5 = await tenta(() => sql(`INSERT INTO contab_partidas VALUES ($1, 9, '1.1.1.01.001', 'D', 5, null, null)`, [ls[2].j.lancamento.id]));
chk('banco (Postgres) também bloqueia: partida dobrada no COMMIT, UPDATE, DELETE, TRUNCATE e partida nova num lançamento já gravado', /débitos \(1000\) diferentes dos créditos \(900\)/.test(b1) && /intangíveis/.test(b2) && /intangíveis/.test(b3) && /intangíveis/.test(b4) && /já foi gravado/.test(b5), [b1, b2, b3, b4, b5]);
const del = await M('DELETE', '/lancamentos?id=' + ls[2].j.lancamento.id); chk('DELETE de lançamento pela API: 405 "intangíveis — faça um estorno"', del.s === 405 && /intangíveis/.test(del.j.erro), del);
/* estorno */
const err = await L('2026-03-12', 'Venda lançada em duplicidade', [['1.1.1.01.001', 'D', 300], ['4.1.1.01', 'C', 300]]);
const e1 = await M('POST', '/lancamentos/estorno', { id: err.j.lancamento.id, data: '2026-03-12', motivo: 'duplicidade do lançamento' }), e2 = await M('POST', '/lancamentos/estorno', { id: err.j.lancamento.id, motivo: 'de novo' }), e3 = await M('POST', '/lancamentos/estorno', { id: e1.j.estorno?.id, motivo: 'estorno do estorno' });
const orig = (await M('GET', '/lancamentos?de=2026-03-12&ate=2026-03-12')).j.lancamentos.find(x => x.id === err.j.lancamento.id);
chk('estorno: partidas invertidas e ligadas ao ID original (estornoDe/estornadoPor); 2º estorno e estorno de estorno recusados', e1.s === 201 && e1.j.estorno.estornoDe === err.j.lancamento.id && e1.j.estorno.itens.map(i => i.dc).join() === 'C,D' && orig.estornadoPor === e1.j.estorno.id && e2.s === 409 && e3.s === 422, [e1, e2, e3]);

/* ---------- relatórios ---------- */
const rel = (t, qs = '') => M('GET', `/relatorios/${t}?de=2026-01-01&ate=2026-12-31${qs}`);
const bal = (await rel('balancete')).j, lin = c => bal.linhas.find(l => l.codigo === c);
chk('Balancete: débitos = créditos (R$ 8.482,50), saldos D/C por conta e sintéticas somadas', bal.confere && bal.totais.debitos === 8482.5 && bal.totais.creditos === 8482.5 && lin('1.1.1.01.001').saldoFinal === 1000 && lin('1.1.1.01.001').dc === 'D' && lin('2.1.3.01').saldoFinal === 272.5 && lin('2.1.3.01').dc === 'C' && lin('1').saldoFinal === 6610, [bal.totais, lin('1'), lin('2.1.3.01')]);
const dA = (await rel('dre', '&modelo=atual')).j, dR = (await rel('dre', '&modelo=reforma&anoReforma=2033')).j, V = (d, k) => d.linhas.find(l => l.chave === k)?.valor;
chk('DRE · Modelo Atual: RB 1.000 − ICMS 180 − PIS 16,50 − COFINS 76 = RL 727,50; CMV 400; DGA 200; RF 10; lucro líquido 137,50', V(dA, 'rb') === 1000 && V(dA, 'ded:ICMS') === -180 && V(dA, 'ded:PIS') === -16.5 && V(dA, 'ded:COFINS') === -76 && V(dA, 'rl') === 727.5 && V(dA, 'lb') === 327.5 && V(dA, 'lair') === 137.5 && V(dA, 'll') === 137.5, dA.linhas);
chk('DRE · Modelo Nova Reforma (2033): ICMS/PIS/COFINS saem; mesmo preço ao consumidor, CBS 8,8% e IBS 17,7% "por fora" (valor da operação R$ 790,51) → RL 790,51 e comparativo com o atual', V(dR, 'ded:CBS') === -69.57 && V(dR, 'ded:IBS') === -139.92 && V(dR, 'ded:ICMS (residual da transição)') === undefined && V(dR, 'rl') === 790.51 && dR.comparativo.atual.lucroLiquido === 137.5 && dR.comparativo.reforma.lucroLiquido === 200.51 && dR.notas.some(n => /Simulação gerencial/.test(n)), dR);
const d30 = (await rel('dre', '&modelo=reforma&anoReforma=2030')).j, d26 = (await rel('dre', '&modelo=reforma&anoReforma=2026')).j;
chk('Reforma na transição: 2030 com ICMS a 80% e IBS a 20%; 2026 (teste) sem custo adicional', V(d30, 'ded:ICMS (residual da transição)') === -144 && V(d30, 'ded:IBS') === -31.51 && V(d30, 'ded:PIS (residual da transição)') === undefined && V(d26, 'll') === 137.5, [d30.linhas.filter(l => l.nivel === 2), V(d26, 'll')]);
const bp = (await rel('balanco')).j;
chk('Balanço: Ativo 6.610,00 = Passivo 1.472,50 + PL 5.137,50 (resultado não encerrado no PL)', bp.ativo.total === 6610 && bp.passivo.total === 1472.5 && bp.patrimonioLiquido.total === 5137.5 && bp.confere && bp.patrimonioLiquido.contas.some(c => /não encerrado/.test(c.nome) && c.valor === 137.5), bp);
const dv = (await rel('dva')).j, DV = t => dv.linhas.find(l => l.rotulo.startsWith(t))?.valor;
chk('DVA: receitas 1.000, insumos 400, VA bruto 600, transferências 10, distribuído a governos 272,50 e aluguéis 200; capital próprio = lucro líquido', DV('1. Receitas') === 1000 && DV('2. Insumos') === -400 && DV('3. Valor adicionado bruto') === 600 && DV('6. Valor adicionado recebido') === 10 && DV('7. Valor adicionado total') === 610 && DV('8.2 Impostos') === 272.5 && DV('Aluguéis') === 200 && dv.conferencia.ok, dv);
const dm = (await rel('dmpl')).j, ra = (await rel('dra')).j, fim = dm.linhas.find(l => l.rotulo === 'Saldo final');
chk('DMPL: aumento de capital 5.000 e resultado do período 137,50 → saldo final 5.137,50 · DRA: resultado abrangente 137,50', dm.linhas.some(l => /Aumento/.test(l.rotulo) && l.valores['3.1'] === 5000) && fim.total === 5137.5 && ra.linhas[2].valor === 137.5, [dm, ra]);
const rz = (await rel('razao', '&conta=1.1.1.01.001')).j, dia = (await rel('diario')).j;
chk('Razão do Caixa (saldo corrente, com o lançamento e o estorno) e Diário (9 lançamentos)', rz.linhas.length === 3 && rz.saldoFinal === 1000 && rz.linhas[1].saldo === 1300 && dia.lancamentos.length === 9, [rz, dia.totais]);
/* tributos sobre o lucro */
const pr = (await rel('lalur', '&regime=presumido')).j;
await M('POST', '/lalur', { ano: 2026, tipo: 'adicao', descricao: 'Multas não dedutíveis', valor: 50 });
const re = (await rel('lalur', '&regime=real')).j;
chk('Lucro Presumido (comércio): IRPJ sobre 8% + receitas financeiras, CSLL sobre 12% + financeiras (com a nota da LC 224/2025)', pr.baseIRPJ === 90 && pr.irpj === 13.5 && pr.baseCSLL === 130 && pr.csll === 11.7 && pr.notas.some(n => /LC 224\/2025/.test(n)), pr);
chk('Lucro Real (LALUR): LAIR 137,50 + adição 50 = 187,50 → IRPJ 28,13 e CSLL 16,88', re.lair === 137.5 && re.lucroReal === 187.5 && re.irpj === 28.13 && re.csll === 16.88, re);
/* parâmetros */
const p1 = await M('PUT', '/parametros', { regime: 'real', dreModelo: 'reforma', reforma: { ano: 2033, cbs: 0.09, ibs: 0.18 } }), p2 = await M('PUT', '/parametros', { regime: 'simples' }), dPadrao = (await rel('dre')).j;
chk('parâmetros: regime Lucro Real e toggle da DRE em "reforma" gravados (a DRE passa a sair no modelo novo); regime inválido recusado', p1.s === 200 && p1.j.parametros.regime === 'real' && p1.j.parametros.dreModelo === 'reforma' && p2.s === 422 && dPadrao.modelo === 'reforma' && V(dPadrao, 'ded:CBS') === -70.87, [p1, p2, dPadrao.modelo]);
/* encerramento e período fechado */
const enc = await M('POST', '/encerramento', { ano: 2026 }), enc2 = await M('POST', '/encerramento', { ano: 2026 }), bp2 = (await rel('balanco')).j, dApos = (await rel('dre', '&modelo=atual')).j;
chk('encerramento 2026: resultado 137,50 vai para Lucros Acumulados; DRE do período continua com 137,50; 2º encerramento recusado', enc.s === 201 && enc.j.resultado === 137.5 && enc2.s === 409 && bp2.patrimonioLiquido.contas.some(c => c.codigo === '3.5' && c.valor === 137.5) && !bp2.patrimonioLiquido.contas.some(c => /não encerrado/.test(c.nome)) && bp2.confere && V(dApos, 'll') === 137.5, [enc, bp2.patrimonioLiquido]);
await M('PUT', '/parametros', { fechadoAte: '2026-03-31' }); const fch = await L('2026-03-20', 'Lançamento retroativo', [['1.1.1.01.001', 'D', 1], ['4.1.1.01', 'C', 1]]);
chk('período fechado até 31/03/2026: lançamento retroativo recusado', fch.s === 422 && /fechado/.test(fch.j.erro), fch);
/* integridade */
const i1 = (await M('GET', '/integridade')).j;
await sql('ALTER TABLE contab_lancamentos DISABLE TRIGGER contab_lanc_intangivel'); await sql(`UPDATE contab_lancamentos SET historico = 'adulterado' WHERE numero = 3`); await sql('ALTER TABLE contab_lancamentos ENABLE TRIGGER contab_lanc_intangivel');
const i2 = (await M('GET', '/integridade')).j;
chk('integridade: cadeia de hashes íntegra; se alguém adulterar o banco por fora (desligando a trava), a quebra aparece no nº 3', i1.cadeiaIntegra && i1.equilibrados && i1.lancamentos === 10 && !i2.cadeiaIntegra && i2.quebras[0] === 3, [i1, i2]);
/* acesso */
const OL = api(await login('11144477735')), OS = api(await login('39053344705'));
const a1 = await OL('GET', '/relatorios/balancete?de=2026-01-01&ate=2026-12-31'), a2 = await OL('POST', '/lancamentos', { data: '2026-04-01', historico: 'x', itens: [] }), a3 = await OS('GET', '/contas');
let a4; try { a4 = (await api(await login('12345678909'))('GET', '/contas')).s; } catch (e) { a4 = e.message; }
chk('acesso: Operacional com "Contabilidade · Ler" consulta mas não lança (403); sem a permissão, 403; perfil Loja, 403', a1.s === 200 && a2.s === 403 && a3.s === 403 && a4 === 403, [a1.s, a2, a3, a4]);
/* ---------- v13.86 · Parte 2: de-para FCX → plano de contas (rótulos FICTÍCIOS no padrão do ERP) ---------- */
const FCX = ['4 – (-) Despesas Fixas', '4.10 – (-) Custo Total de Ocupação', '4.10.09 – (-) Energia Elétrica', '4.10.08 – (-) Água e Esgoto', '4.10.11 – (-) IPTU', '2.05 – (-) Impostos sobre Vendas', '2.05.02 – (-) ICMS sobre Vendas', '2.05.01 – (-) COFINS sobre Vendas de Mercadorias',
  '4.18 – (-) Viagens', '4.18.01 – (-) Hospedagem', '4.18.05 – (-) Combustível', '7.20.03 – (-) Aquisição de Móveis e Utensílios', '7.01.05 – Credsystem a Pagar (Repasse)', '99.04.01 – (-) Depreciação de Máquinas e Equipamentos', '7.30.01 – (-) Despesa Fictícia Sem Regra', 'Fornecedor Avulso Fictício'];
const imp = await M('POST', '/importar-fcx', { contas: FCX, usadas: ['4.18 – (-) Viagens'] }), dp = (await M('GET', '/depara')).j, D = new Map(dp.itens.map(x => [x.chave, x]));
const viag = (await M('GET', '/contas')).j.contas.find(c => c.nome === 'Viagens e Estadias');
chk('importar FCX: 16 rótulos + 5 contas da Reforma (IBS/CBS/IS) para o FCX; cria só a conta que falta (Viagens e Estadias, 5.3.3.06)', imp.s === 200 && imp.j.novos === 16 && imp.j.complemento === 5 && imp.j.planoCriado === 0 && viag?.codigo === '5.3.3.06' && imp.j.criadas.join() === '5.3.3.06' && dp.resumo.total === 21 && dp.resumo.doContabil === 5, imp);
chk('de-para: Energia Elétrica → 5.3.2.03 · ICMS sobre Vendas → 4.2.2.01 · COFINS → 4.2.2.03 · Móveis → 1.2.3.01.001 · repasse a pagar → 2.1.5.01.004 · depreciação → 5.3.3.04 (automáticos)',
  D.get('4.10.09 – (-) Energia Elétrica').conta === '5.3.2.03' && D.get('2.05.02 – (-) ICMS sobre Vendas').conta === '4.2.2.01' && D.get('2.05.01 – (-) COFINS sobre Vendas de Mercadorias').conta === '4.2.2.03' && D.get('7.20.03 – (-) Aquisição de Móveis e Utensílios').conta === '1.2.3.01.001' && D.get('7.01.05 – Credsystem a Pagar (Repasse)').conta === '2.1.5.01.004' && D.get('99.04.01 – (-) Depreciação de Máquinas e Equipamentos').conta === '5.3.3.04' && ['4.10.09 – (-) Energia Elétrica', '2.05.02 – (-) ICMS sobre Vendas'].every(k => D.get(k).status === 'automatico'), dp.itens);
chk('agrupadores do ERP → sintéticas (4.10 → 5.3.2; 2.05 → 4.2.2); cabeçalho com saídas lançadas (4.18) vira conta de movimento → Viagens e Estadias', D.get('4.10 – (-) Custo Total de Ocupação').agrupador && D.get('4.10 – (-) Custo Total de Ocupação').conta === '5.3.2' && D.get('2.05 – (-) Impostos sobre Vendas').conta === '4.2.2' && !D.get('4.18 – (-) Viagens').agrupador && D.get('4.18 – (-) Viagens').conta === '5.3.3.06' && D.get('4.18.01 – (-) Hospedagem').conta === '5.3.3.06', [D.get('4.18 – (-) Viagens'), D.get('4.10 – (-) Custo Total de Ocupação')]);
chk('sem regra do ERP: classificação pelo nome com conta sugerida, mas PENDENTE de revisão', ['7.30.01 – (-) Despesa Fictícia Sem Regra', 'Fornecedor Avulso Fictício'].every(k => D.get(k).status === 'pendente' && D.get(k).conta && D.get(k).confianca < 0.75), [D.get('7.30.01 – (-) Despesa Fictícia Sem Regra'), D.get('Fornecedor Avulso Fictício')]);
chk('Reforma: "2.05.10 – (-) IBS sobre Vendas" → 4.2.3.01 e "2.06.07 – (+) CBS sobre Compra" → 1.1.2.02.005 (fonte: Módulo Contábil)', D.get('2.05.10 – (-) IBS sobre Vendas')?.conta === '4.2.3.01' && D.get('2.06.07 – (+) CBS sobre Compra de Mercadorias')?.conta === '1.1.2.02.005' && D.get('2.05.10 – (-) IBS sobre Vendas').fonte === 'contabil');
const rv = await M('PUT', '/depara', { itens: [{ chave: 'Fornecedor Avulso Fictício', conta: '5.3.3.01' }] }), rv2 = await M('PUT', '/depara', { itens: [{ chave: 'Fornecedor Avulso Fictício', conta: '5.3.3' }] }), rv3 = await M('PUT', '/depara', { itens: [{ chave: '4.10 – (-) Custo Total de Ocupação', conta: '5.3.2.01' }] });
const imp2 = await M('POST', '/importar-fcx', { contas: FCX, remapear: true }), dp2 = new Map((await M('GET', '/depara')).j.itens.map(x => [x.chave, x]));
chk('revisão: escolher a conta marca "revisado" e sobrevive a uma nova importação (mesmo com remapear); sintética numa conta de movimento e analítica num agrupador são recusadas', rv.s === 200 && rv.j.itens[0].status === 'revisado' && rv2.s === 422 && rv3.s === 422 && imp2.j.novos === 0 && dp2.get('Fornecedor Avulso Fictício').conta === '5.3.3.01' && dp2.get('Fornecedor Avulso Fictício').status === 'revisado', [rv, rv2, rv3, imp2.j]);
const nv = await M('POST', '/depara', { rotulo: '4.10.17 – (-) Energia Solar Fictícia' }), nv2 = await M('POST', '/depara', { rotulo: '4.10.17 – (-) Energia Solar Fictícia' });
chk('nova conta para o FCX criada no Módulo Contábil (o FCX não cadastra mais): mapeada pela faixa do ERP (→ 5.3.2.03); repetida → 409', nv.s === 201 && nv.j.item.conta === '5.3.2.03' && nv.j.item.fonte === 'contabil' && nv2.s === 409, [nv, nv2]);
await M('PUT', '/depara', { itens: [{ chave: '4.10.11 – (-) IPTU', ativa: false }] });
await usuario('usr-op-sem', 'OPERACIONAL', '39053344705', { fcx: 'ler' }); const OF = api(await login('39053344705'));
const f1 = await OF('GET', '/fcx-contas'), f2 = await OF('POST', '/fcx-contas', { contas: ['4.10.18 – (-) Gás Fictício'] }), f3 = await OF('GET', '/depara');
await usuario('usr-op-sem', 'OPERACIONAL', '39053344705', { fcx: 'modificar' }); const OF2 = api(await login('39053344705'));
const f4 = await OF2('POST', '/fcx-contas', { contas: ['4.10.18 – (-) Gás Fictício', '4.18.01 – (-) Hospedagem'] }), f5 = (await OF2('GET', '/fcx-contas')).j;
let f6; try { f6 = (await api(await login('12345678909'))('GET', '/fcx-contas')).s; } catch (e) { f6 = e.message; }
chk('FCX: quem lê o FCX lê a lista (sem a inativa); só lê → não registra (403) e não vê o de-para do Contábil; quem grava no FCX registra a conta nova p/ revisão; Loja sem FCX → 403',
  f1.s === 200 && f1.j.contas.length === 21 && !f1.j.contas.some(c => c.rotulo === '4.10.11 – (-) IPTU') && f1.j.inativas.includes('4.10.11 – (-) IPTU') && f1.j.podeGerir === false && f2.s === 403 && f3.s === 403 && f4.s === 200 && f4.j.registradas === 1 && f5.contas.find(c => c.rotulo === '4.10.18 – (-) Gás Fictício')?.conta === '5.3.2.01' && f6 === 403, [f1.s, f1.j.contas?.length, f2.s, f3.s, f4, f6]);
const tr = await sql(`SELECT conta FROM contab_depara WHERE chave = '4.10.09 – (-) Energia Elétrica'`); let bloq = null; try { await sql(`UPDATE contab_depara SET conta = '5.3' WHERE chave = '4.10.09 – (-) Energia Elétrica'`); } catch (e) { bloq = e.message; }
chk('banco: o de-para não aceita conta sintética para rótulo de movimento nem por fora da API', tr[0].conta === '5.3.2.03' && /analítica/.test(bloq || ''), bloq);
console.log('\nOK (' + OK.length + ')  FALHAS (' + FAIL.length + ')'); await db.end();
