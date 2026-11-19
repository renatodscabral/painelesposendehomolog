/* v13.88 · Teste do servidor: (1) correção da Gestão de Acessos — permissões em qualquer formato, coleções "do Master" liberadas
   pela matriz e revalidação a cada requisição; (2) acerto de adiantamentos — encerrar, contabilizar em partidas dobradas e baixar.
   Dados FICTÍCIOS. Uso: bash tests/preparar-banco.sh && NETLIFY_DB_URL=… node tests/servidor-local.mjs 8890 & … node tests/teste-adiantamentos.mjs */
import pg from 'pg';
import { gerar } from '../netlify/lib/senha.mjs';
import { normalizarPermissoes, permissoesEfetivas, nivelDe } from '../netlify/lib/permissoes.mjs';
const U = 'http://localhost:8890', OK = [], FAIL = [];
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 1200) : '')); };
const db = new pg.Pool({ connectionString: process.env.NETLIFY_DB_URL }), sql = (t, p) => db.query(t, p).then(r => r.rows);
const doc = async (caminho, dados) => { const i = caminho.lastIndexOf('/'); await sql(`INSERT INTO documentos (caminho, colecao, doc_id, dados) VALUES ($1, $2, $3, $4) ON CONFLICT (caminho) DO UPDATE SET dados = EXCLUDED.dados`, [caminho, caminho.slice(0, i), caminho.slice(i + 1), JSON.stringify(dados)]); };
const usuario = (id, perfil, cpf, permissoes = {}) => doc('usuarios/' + id, { perfil, nome: 'Teste ' + id, cpf, ativo: true, permissoes, trocarSenha: false, senha: gerar('Teste2026Ab', 'sal-' + id) });
async function login(cpf) { const r = await fetch(U + '/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json', 'x-painel': '1' }, body: JSON.stringify({ cpf, senha: 'Teste2026Ab' }) }); const c = r.headers.get('set-cookie'); if (!c) throw new Error('login falhou ' + r.status + ' ' + await r.text()); return c.split(';')[0]; }
const cli = ck => async (met, rota, corpo) => { const r = await fetch(U + rota, { method: met, headers: { cookie: ck, 'content-type': 'application/json', 'x-painel': '1' }, body: corpo ? JSON.stringify(corpo) : undefined }); let j = {}; try { j = await r.json(); } catch { } return { s: r.status, j }; };

/* ---------- 1 · normalização (unidade) ---------- */
const formatos = [{ contratos: 'ler' }, { contratos: 'Ler' }, { contratos: 'LEITURA' }, { contratos: true }, { contratos: 1 }, { contratos: '1' }, { contratos: { nivel: 'ler' } }, { contratos: { ler: true } }, { modulos: { contratos: 'ler' } }, JSON.stringify({ contratos: 'ler' }), ['contratos:ler'], [{ modulo: 'contratos', nivel: 'ler' }]];
chk('normalização: 12 formatos de "Contratos · Ler" (string, maiúsculas, booleano, número, objeto, aninhado, JSON em texto, lista) viram { contratos: "ler" }', formatos.every(f => normalizarPermissoes(f).contratos === 'ler'), formatos.map(f => normalizarPermissoes(f).contratos));
chk('normalização: níveis "editar"→modificar, "total"→excluir, { ler, modificar }→modificar, false/"nenhum"/lixo→sem acesso; opção extra "sim"→true; perfil "operacional" aceito',
  nivelDe('editar') === 'modificar' && nivelDe('Total') === 'excluir' && nivelDe({ ler: true, modificar: true }) === 'modificar' && nivelDe(false) === '' && nivelDe('nenhum') === '' && nivelDe('xyz') === '' && normalizarPermissoes({ 'viagens.solicitar': 'sim' })['viagens.solicitar'] === true
  && permissoesEfetivas({ perfil: 'operacional', permissoes: { fcx: 'Ler' } }).has('fcx.ver'));
chk('matriz do servidor = do painel: Contratos·Ler → lojas.contratos.ver; Retaguarda·Modificar com Auditoria → retaguarda.adq.*; Loja só lê', (() => { const a = permissoesEfetivas({ perfil: 'OPERACIONAL', permissoes: { contratos: 'ler', retaguarda: 'modificar' } }), l = permissoesEfetivas({ perfil: 'LOJA', permissoes: { contratos: 'excluir' } }); return a.has('lojas.contratos.ver') && !a.has('lojas.contratos.editar') && a.has('retaguarda.adq.ver') && a.has('retaguarda.adq.importar') && l.has('lojas.contratos.ver') && !l.has('lojas.contratos.editar'); })());

/* ---------- 2 · API: coleções "do Master" liberadas pela matriz ---------- */
await usuario('usr-master-ad', 'MASTER', '52998224725');
await usuario('usr-anderson', 'Operacional', '11144477735', { contratos: true, fcx: { nivel: 'Ler' }, retaguarda: 'LEITURA' }); /* fictício: o formato "estranho" que escondia os menus */
await usuario('usr-sem', 'OPERACIONAL', '39053344705', { fcx: 'ler' });
await doc('contratos_locacao/ct-ficticio', { loja: 'loja-901', valor: 1000 }); await doc('conc_fechamento/2026-10_credito', { linhas: [] });
const M = cli(await login('52998224725')), A = cli(await login('11144477735')), S = cli(await login('39053344705'));
const a1 = await A('GET', '/api/docs?caminho=contratos_locacao/ct-ficticio'), a2 = await A('GET', '/api/docs?colecao=contratos_locacao'), a3 = await A('PUT', '/api/docs?caminho=contratos_locacao/ct-ficticio', { dados: { x: 1 } }), a4 = await A('GET', '/api/docs?caminho=conc_fechamento/2026-10_credito');
const s1 = await S('GET', '/api/docs?caminho=contratos_locacao/ct-ficticio'), s2 = await S('GET', '/api/docs?caminho=salarios/x');
chk('Operacional com Contratos marcado (gravado como true) lê os contratos — antes só o Master; não grava (só Ler); Retaguarda·Ler gravado como "LEITURA" lê a Auditoria de Adquirentes',
  a1.s === 200 && a1.j.doc?.valor === 1000 && a2.s === 200 && a2.j.docs.length === 1 && a3.s === 403 && a4.s === 200, [a1.s, a2.s, a3.s, a4.s]);
chk('sem a permissão na matriz continua 403; salários seguem exclusivos do Master', s1.s === 403 && s2.s === 403, [s1.s, s2.s]);
await usuario('usr-anderson', 'Operacional', '11144477735', { contratos: { ler: true, modificar: true } });
const a5 = await A('PUT', '/api/docs?caminho=contratos_locacao/ct-ficticio', { dados: { loja: 'loja-901', valor: 1100 } });
await usuario('usr-anderson', 'Operacional', '11144477735', {});
const a6 = await A('GET', '/api/docs?caminho=contratos_locacao/ct-ficticio');
chk('revalidação imediata: a conta alterada vale na requisição seguinte (Modificar → grava; permissão retirada → 403), sem novo login', a5.s === 200 && a6.s === 403, [a5, a6.s]);

/* ---------- 3 · acerto de adiantamentos ---------- */
await usuario('usr-fin', 'OPERACIONAL', '86288366757', { viagens: 'modificar' });
const F = cli(await login('86288366757'));
const viagem = (id, x = {}) => doc('funcionarios/_viagens/pedidos/' + id, { nome: 'VIAJANTE FICTICIO', funcionarioId: 'func-v1', destino: 'Cidade Fictícia/PE', ida: '2026-10-05', volta: '2026-10-07', status: 'prestacao_enviada', valor: 1000, valorPago: 1000, pagoData: '2026-10-01', pagamento: { modo: 'unico', contas: [{ funcionarioId: 'func-v1', nome: 'VIAJANTE FICTICIO', valor: 1000, valorPago: 1000 }] },
  despesas: [{ id: 'd1', data: '2026-10-05', categoria: 'Alimentação', valor: 300, aprovacao: { valor: 300 } }, { id: 'd2', data: '2026-10-06', categoria: 'Hospedagem', valor: 450, aprovacao: { valor: 450 } }, { id: 'd3', data: '2026-10-06', categoria: 'Outros', descricao: 'Cerveja', valor: 50, aprovacao: { valor: 0 } }], historico: [], ...x });
await viagem('vg-dev'); await viagem('vg-reemb', { despesas: [{ id: 'd1', data: '2026-10-05', categoria: 'Alimentação', valor: 700, aprovacao: { valor: 700 } }, { id: 'd2', data: '2026-10-06', categoria: 'Hospedagem', valor: 500, aprovacao: { valor: 500 } }] });
await viagem('vg-sem-analise', { despesas: [{ id: 'd1', data: '2026-10-05', categoria: 'Alimentação', valor: 100 }] });
const e0 = await M('POST', '/api/contabil/adiantamentos/encerrar', { viagemId: 'vg-dev' });
chk('encerrar sem plano de contas: prestação encerrada e travada, título de devolução de R$ 250,00 gerado, contabilização PENDENTE', e0.s === 200 && e0.j.acerto.aprovado === 750 && e0.j.acerto.saldo === 250 && e0.j.acerto.titulos[0].tipo === 'devolver' && e0.j.acerto.titulos[0].valor === 250 && e0.j.acerto.contabil.pendente === true, e0);
await M('POST', '/api/contabil/plano-padrao');
const c0 = await M('POST', '/api/contabil/adiantamentos/contabilizar', { viagemId: 'vg-dev' }), ls0 = (await M('GET', '/api/contabil/lancamentos')).j.lancamentos;
const adt = ls0.find(l => l.docRef === 'ADT-vg-dev'), acerto = ls0.find(l => l.docRef === 'ADT-vg-dev-ACERTO');
const contasN = (await M('GET', '/api/contabil/contas')).j.contas, nomeDe = c => contasN.find(x => x.codigo === c)?.nome || '';
chk('contabilizar depois: (1) adiantamento pago D 1.1.2.03.002 / C Banco R$ 1.000 na data do pagamento; (2) acerto D Viagens e Estadias 750 + D Devoluções a Receber 250 / C Adiantamentos 1.000',
  c0.s === 200 && adt && adt.data === '2026-10-01' && adt.itens.map(i => i.dc + i.conta + ':' + i.valor).join() === 'D1.1.2.03.002:1000,C1.1.1.02.001:1000' && acerto && acerto.total === 1000
  && acerto.itens.filter(i => i.dc === 'D').map(i => nomeDe(i.conta) + ':' + i.valor).sort().join() === ['Devoluções de Adiantamentos de Viagem a Receber:250', 'Viagens e Estadias:300', 'Viagens e Estadias:450'].sort().join() && acerto.itens.filter(i => i.dc === 'C').map(i => i.conta + ':' + i.valor).join() === '1.1.2.03.002:1000', [c0.s, adt, acerto]);
const e1 = await M('POST', '/api/contabil/adiantamentos/encerrar', { viagemId: 'vg-dev' }), c1 = await M('POST', '/api/contabil/adiantamentos/contabilizar', { viagemId: 'vg-dev' }), n1 = (await M('GET', '/api/contabil/lancamentos')).j.lancamentos.length;
chk('idempotente: encerrar de novo → 409; contabilizar de novo não duplica lançamentos', e1.s === 409 && c1.s === 200 && n1 === ls0.length, [e1.s, c1.s, n1, ls0.length]);
const e2 = await M('POST', '/api/contabil/adiantamentos/encerrar', { viagemId: 'vg-reemb' }), l2 = (await M('GET', '/api/contabil/lancamentos')).j.lancamentos.find(l => l.docRef === 'ADT-vg-reemb-ACERTO');
chk('despesas maiores que o adiantamento: "saldo a reembolsar" R$ 200,00 → D despesas 1.200 / C Adiantamentos 1.000 + C Reembolsos a Pagar 200 (partidas dobradas)', e2.s === 200 && e2.j.acerto.reembolsar === 200 && e2.j.acerto.contabil.pendente === false && l2.itens.filter(i => i.dc === 'C').map(i => nomeDe(i.conta) + ':' + i.valor).sort().join() === ['Adiantamentos a Empregados:1000', 'Reembolsos de Despesas de Viagem a Pagar:200'].sort().join(), [e2, l2]);
const e3 = await M('POST', '/api/contabil/adiantamentos/encerrar', { viagemId: 'vg-sem-analise' }), e4 = await F('POST', '/api/contabil/adiantamentos/encerrar', { viagemId: 'vg-sem-analise' });
chk('sem análise gravada nas despesas → 422; financeiro não encerra (só o Master) → 403', e3.s === 422 && /sem análise/.test(e3.j.erro) && e4.s === 403, [e3, e4]);
const b1 = await F('POST', '/api/contabil/adiantamentos/baixar', { viagemId: 'vg-dev', data: '2026-11-04', forma: 'PIX' }), b2 = await F('POST', '/api/contabil/adiantamentos/baixar', { viagemId: 'vg-dev', data: '2026-11-04' }), b3 = await S('POST', '/api/contabil/adiantamentos/baixar', { viagemId: 'vg-reemb', data: '2026-11-04' });
const lb = (await M('GET', '/api/contabil/lancamentos')).j.lancamentos.find(l => /^ADT-vg-dev-BAIXA/.test(l.docRef || ''));
chk('baixa do título pelo financeiro: devolução recebida → D Banco / C Devoluções a Receber R$ 250; 2ª baixa → 404; sem Viagens·Modificar → 403', b1.s === 200 && b1.j.acerto.titulos[0].status === 'baixado' && lb && lb.itens.map(i => i.dc + ':' + nomeDe(i.conta)).join() === 'D:Banco Conta Movimento Principal,C:Devoluções de Adiantamentos de Viagem a Receber' && b2.s === 404 && b3.s === 403, [b1, b2.s, b3.s, lb]);
const vd = (await M('GET', '/api/docs?caminho=funcionarios/_viagens/pedidos/vg-dev')).j.doc, mud = await sql(`SELECT count(*)::int AS n FROM mudancas WHERE caminho = 'funcionarios/_viagens/pedidos/vg-dev'`), integ = (await M('GET', '/api/contabil/integridade')).j;
chk('documento da viagem: status Concluído, acerto com títulos e lançamentos, linha do tempo e aviso de mudança para os painéis abertos; cadeia contábil íntegra',
  vd.status === 'concluido' && vd.acerto.contabil.lancamentos.length === 2 && vd.historico.some(h => /Prestação encerrada/.test(h.txt)) && vd.historico.some(h => /Devolução recebida/.test(h.txt)) && mud[0].n >= 3 && integ.cadeiaIntegra && integ.equilibrados, [vd.status, mud[0].n, integ]);
console.log('\nOK (' + OK.length + ')  FALHAS (' + FAIL.length + ')'); await db.end();
