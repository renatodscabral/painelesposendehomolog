/* v13.92 · Teste da carga de dados de teste da Falco (servidor local + Postgres, dados FICTÍCIOS).
   Sobe o servidor local em três modos (prod, homolog e falco) sobre o mesmo banco de teste e confere:
   travas (rota e script), plano de contas criado a partir da planilha, 60 + 10 lançamentos, idempotência, simulação,
   Diário/Razão/Balancete/DRE/Balanço, disponibilidades com o plano próprio, Radar e o script de linha de comando.
   Uso: bash tests/preparar-banco.sh && NETLIFY_DB_URL=postgres://postgres@127.0.0.1:54329/painel_teste node tests/teste-carga-falco.mjs [planilha.xlsx] */
import pg from 'pg';
import { spawn, spawnSync } from 'node:child_process';
import { gerar } from '../netlify/lib/senha.mjs';
const OK = [], FAIL = [];
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 1500) : '')); };
const DB = process.env.NETLIFY_DB_URL, db = new pg.Pool({ connectionString: DB }), sql = (t, p) => db.query(t, p).then(r => r.rows);
const PLANILHA = process.argv[2] || '';
const servidores = [];
async function subir(amb, porta) {
  const p = spawn(process.execPath, ['tests/servidor-local.mjs', String(porta)], { env: { ...process.env, PAINEL_AMBIENTE: amb, NETLIFY_DB_URL: DB }, stdio: 'ignore' }); servidores.push(p);
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${porta}/api/saude`)).ok) return `http://localhost:${porta}`; } catch { } await new Promise(r => setTimeout(r, 150)); }
  throw new Error('servidor não subiu: ' + amb);
}
const usuario = async (id, perfil, cpf) => { const u = { perfil, nome: 'Teste ' + id, cpf, ativo: true, permissoes: perfil === 'OPERACIONAL' ? { contabil: 'excluir' } : {}, trocarSenha: false, senha: gerar('Teste2026Ab', 'sal-' + id) };
  await sql(`INSERT INTO documentos (caminho, colecao, doc_id, dados) VALUES ($1, 'usuarios', $2, $3) ON CONFLICT (caminho) DO UPDATE SET dados = EXCLUDED.dados`, ['usuarios/' + id, id, JSON.stringify(u)]); };
const login = async (U, cpf) => { const r = await fetch(U + '/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json', 'x-painel': '1' }, body: JSON.stringify({ cpf, senha: 'Teste2026Ab' }) }); return (r.headers.get('set-cookie') || '').split(';')[0]; };
const api = (U, ck) => async (met, rota, corpo) => { const r = await fetch(U + '/api/contabil' + rota, { method: met, headers: { cookie: ck, 'content-type': 'application/json', 'x-painel': '1' }, body: corpo ? JSON.stringify(corpo) : undefined }); let j = null; try { j = await r.json(); } catch { } return { s: r.status, j }; };
const FRASE = 'CARREGAR DADOS DE TESTE NA FALCO';
try {
  await usuario('usr-master-cg', 'MASTER', '52998224725'); await usuario('usr-op-cg', 'OPERACIONAL', '11144477735');
  await sql(`INSERT INTO documentos (caminho, colecao, doc_id, dados) VALUES ('config/recursos', 'config', 'recursos', $1) ON CONFLICT (caminho) DO UPDATE SET dados = EXCLUDED.dados`, [JSON.stringify({ contabil_v1386: { ativo: true }, contabil_v1391: { ativo: true } })]);
  const P = await subir('prod', 8894), H = await subir('homolog', 8895), F = await subir('falco', 8896);
  const nL = async () => (await sql('SELECT count(*)::int AS n FROM contab_lancamentos'))[0].n;

  /* ---------- 1 · travas ---------- */
  const rp = await api(P, await login(P, '52998224725'))('POST', '/carga-teste', { confirmar: FRASE }), rh = await api(H, await login(H, '52998224725'))('POST', '/carga-teste', { confirmar: FRASE });
  const MF = api(F, await login(F, '52998224725')), sp = await api(P, await login(P, '52998224725'))('GET', ''), sf = await MF('GET', '');
  chk('trava: na Esposende (Produção) e na Homologação a rota recusa (403) e nada é gravado', rp.s === 403 && /esposende/.test(rp.j.erro) && rh.s === 403 && /homologa/.test(rh.j.erro) && await nL() === 0, [rp, rh]);
  chk('o botão oculto só aparece no site da Falco, para o Master', sp.j.cargaTeste.disponivel === false && sf.j.cargaTeste.disponivel === true, [sp.j.cargaTeste, sf.j.cargaTeste]);
  const op = await api(F, await login(F, '11144477735'))('POST', '/carga-teste', { confirmar: FRASE }), semFrase = await MF('POST', '/carga-teste', {});
  chk('trava: na Falco, quem não é Master não carrega; sem a frase de confirmação também não', op.s === 403 && /Master/.test(op.j.erro) && semFrase.s === 422 && /CARREGAR DADOS DE TESTE NA FALCO/.test(semFrase.j.erro) && await nL() === 0, [op, semFrase]);

  /* ---------- 2 · simulação e carga ---------- */
  const sim = await MF('POST', '/carga-teste', { confirmar: FRASE, simular: true });
  chk('simulação: confere tudo no servidor e desfaz (0 lançamentos, nenhuma conta criada)', sim.s === 201 && sim.j.simulacao && sim.j.lancamentos.inseridos === 70 && await nL() === 0 && (await sql('SELECT count(*)::int AS n FROM contab_contas'))[0].n === 0, sim.j);
  const c1 = await MF('POST', '/carga-teste', { confirmar: FRASE }), R = c1.j;
  chk('carga: empresa fictícia de teste, plano de contas da planilha e 60 + 10 lançamentos (jan–mar/2025)', c1.s === 201 && R.empresa.criada && R.empresa.cnpj === '11444777000161' && R.lancamentos.planilha === 60 && R.lancamentos.marco === 10 && R.lancamentos.inseridos === 70 && await nL() === 70, R);
  const contas = new Map((await MF('GET', '/contas')).j.contas.map(c => [c.codigo, c]));
  const arvore = ['1', '1.1', '1.2', '2', '2.1', '2.2', '3', '3.1', '3.5', '4', '4.1', '5', '5.1', '5.2', '5.3', '5.4', '5.5', '5.6', '5.7', '5.8'].every(k => contas.get(k)?.tipo === 'S');
  chk('plano de contas em árvore (Ativo, Passivo, PL, Receitas, Custos e Despesas) com as contas da planilha e as de março', arvore && contas.get('1.1.02').nome === 'Bancos Conta Movimento' && contas.get('1.1.02').pai === '1.1' && contas.get('1.2.04').redutora && contas.get('1.2.04').natureza === 'C'
    && contas.get('4.1.02').redutora && contas.get('4.1.02').dre === 'ded' && contas.get('5.7.01').dre === 'df' && contas.get('5.6.01').dre === 'dv' && contas.get('5.8.01').dre === 'ir' && contas.get('2.2.01').tipo === 'A' && contas.get('3.5.01').natureza === 'C' && R.contasCriadas.length === contas.size, [...contas.keys()]);
  const E = `empresa=${R.empresa.id}&de=2025-01-01&ate=2025-03-31`;
  const di = (await MF('GET', '/relatorios/diario?' + E)).j, d60 = (await MF('GET', `/relatorios/diario?empresa=${R.empresa.id}&de=2025-01-01&ate=2025-02-28`)).j;
  chk('Livro Diário: 70 lançamentos equilibrados (Σ D = Σ C = R$ 8.195.161,46); jan–fev = os 60 da planilha (R$ 6.347.827,66), datas respeitadas', di.resumo.lancamentos === 70 && di.resumo.equilibrado && di.resumo.debitos === 8195161.46 && d60.resumo.lancamentos === 60 && d60.resumo.debitos === 6347827.66 && d60.lancamentos[0].data === '2025-01-02' && d60.lancamentos[59].data === '2025-02-28' && di.resumo.formulas[1] === 62, di.resumo);
  const rz = (await MF('GET', '/relatorios/razao?conta=1.1.02&' + E)).j;
  chk('Livro Razão de Bancos (1.1.02): saldo final R$ 2.279.197,46', rz.saldoFinal === 2279197.46 && rz.linhas.length === 23, [rz.saldoFinal, rz.linhas.length]);
  const bl = (await MF('GET', '/relatorios/balancete?' + E)).j;
  chk('Balancete: confere (Σ D = Σ C e saldo zero)', bl.confere && bl.totais.debitos === 8195161.46, bl.totais);
  const dr = (await MF('GET', '/relatorios/dre?modelo=atual&' + E)).j, v = k => dr.linhas.find(l => l.chave === k)?.valor;
  chk('DRE do 1º trimestre: receita bruta 974.200,00; deduções IBS/CBS 258.163,00 (uma vez só, linha "IBS/CBS"); CMV 409.164,00; LAIR 41.533,00; IRPJ+CSLL 9.967,92; lucro líquido 31.565,08',
    v('rb') === 974200 && v('ded') === -258163 && dr.linhas.some(l => /IBS\/CBS/.test(l.rotulo) && l.valor === -258163) && v('cmv') === -409164 && v('lair') === 41533 && v('ir') === -9967.92 && v('ll') === 31565.08 && R.trimestre.dividendos === 15782.54, dr.linhas);
  const bp = (await MF('GET', '/relatorios/balanco?' + E)).j;
  chk('Balanço em 31/03/2025: fecha; empréstimo no circulante (275.000) e no não circulante (300.000); PL = capital 2.400.000 + lucro 31.565,08 − distribuição 15.782,54', bp.confere && bp.passivo.naoCirculante.total === 300000 && bp.passivo.circulante.contas.some(c => c.codigo === '2.1.09' && c.valor === 275000) && Math.round(bp.patrimonioLiquido.total * 100) === Math.round((2400000 + 31565.08 - 15782.54) * 100), [bp.confere, bp.passivo, bp.patrimonioLiquido]);
  const dm = (await MF('GET', '/relatorios/dmpl?' + E)).j;
  chk('DMPL: integralização de capital (2.400.000) e distribuição de lucros (−15.782,54) nas suas linhas', dm.linhas.some(l => /capital/i.test(l.rotulo) && l.total === 2400000) && dm.linhas.some(l => /Dividendos/i.test(l.rotulo) && l.total === -15782.54), dm.linhas.map(l => [l.rotulo, l.total]));
  const dp = (await MF('GET', '/disponibilidades?' + E)).j, cd = id => dp.cards.find(c => c.id === id);
  chk('disponibilidades com o plano próprio: Caixa 1.1.01 (6.880,00), Bancos 1.1.02 (2.279.197,46), Estoques 1.1.04/05/06 (107.836,00)', cd('caixa').conta === '1.1.01' && cd('caixa').saldo === 6880 && cd('bancos').conta === '1.1.02' && cd('bancos').saldo === 2279197.46 && cd('estoque').conta === '1.1.04 · 1.1.05 · 1.1.06' && cd('estoque').saldo === 107836 && dp.consolidado === 2393913.46, dp.cards);
  const lc = (await MF('GET', '/relatorios/caixa?' + E)).j, df = (await MF('GET', '/relatorios/dfc?' + E)).j, rd = (await MF('GET', '/radar?' + E)).j;
  chk('Livro Caixa usa a conta de caixa do plano (1.1.01); DFC fecha com o disponível; Radar calcula sobre a empresa de teste', lc.conta.codigo === '1.1.01' && lc.saldoFinal === 6880 && df.caixaFinal === 2286077.46 && df.blocos.find(b => b.id === 'financiamento').total === 2400000 + 600000 - 25000 - 15782.54 && rd.score.total > 0 && rd.integridade.cadeiaIntegra && rd.resumo.balancoConfere, [lc.conta, lc.saldoFinal, df.caixaFinal, df.blocos.map(b => [b.id, b.total]), rd.score]);
  const jan = (await MF('GET', `/radar?empresa=${R.empresa.id}&de=2025-01-01&ate=2025-01-31`)).j;
  chk('Radar de janeiro aponta o "estouro de caixa" da planilha (Caixa 1.1.01 credor em 31/01)', jan.sugestoes.some(s => s.id === 'inv:1.1.01'), jan.sugestoes.map(s => s.id));

  /* ---------- 3 · idempotência e a empresa principal intacta ---------- */
  const c2 = await MF('POST', '/carga-teste', { confirmar: FRASE });
  chk('rodar de novo não duplica: 0 gravados, 70 já existiam', c2.s === 201 && c2.j.lancamentos.inseridos === 0 && c2.j.lancamentos.ignorados === 70 && !c2.j.empresa.criada && c2.j.contasCriadas.length === 0 && await nL() === 70, c2.j.lancamentos);
  chk('a empresa principal não recebe nada', (await sql(`SELECT count(*)::int AS n FROM contab_lancamentos WHERE empresa_id = 'emp_principal'`))[0].n === 0);

  /* ---------- 4 · script de linha de comando ---------- */
  const cli = (env, args) => spawnSync(process.execPath, ['scripts/seed-contabil-falco.mjs', ...args], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 60000 });
  const x1 = cli({ PAINEL_AMBIENTE: 'esposende' }, ['--url', F]), x2 = cli({ PAINEL_AMBIENTE: 'falco' }, ['--url', P, '--sim']), x3 = cli({ PAINEL_AMBIENTE: 'homologacao' }, ['--url', H]);
  chk('script: PAINEL_AMBIENTE diferente de "falco" para antes de qualquer chamada; apontado para o site da Produção, recusa pelo /api/saude', x1.status === 2 && /só roda com PAINEL_AMBIENTE=falco/.test(x1.stderr) && x3.status === 2 && x2.status === 2 && /não o da Falco/.test(x2.stderr), [x1.stderr, x2.stderr, x3.stderr]);
  if (PLANILHA) {
    const x4 = cli({ PAINEL_AMBIENTE: 'falco', PAINEL_CPF: '52998224725', PAINEL_SENHA: 'Teste2026Ab' }, ['--url', F, '--planilha', PLANILHA, '--sim']);
    chk('script com a planilha .xlsx: lê os 60 lançamentos, entra como Master e chama a carga (idempotente: 0 gravados, 70 já existiam) e confere balancete, balanço e cadeia', x4.status === 0 && /Planilha: 60 lançamentos \(2025-01-02 a 2025-02-28\)/.test(x4.stdout) && /0 gravados, 70 já existiam/.test(x4.stdout) && /balancete fecha/.test(x4.stdout) && /balanço fecha/.test(x4.stdout) && /cadeia de lançamentos íntegra/.test(x4.stdout), x4.stdout + x4.stderr);
    console.log('\n--- saída do script ---\n' + x4.stdout);
  }
} finally { servidores.forEach(p => p.kill()); }
console.log(`\nOK (${OK.length})  FALHAS (${FAIL.length})`); await db.end(); process.exit(FAIL.length ? 1 : 0);
