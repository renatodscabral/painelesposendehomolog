/* v14.07 · Empresas (flag Matriz) × Contas bancárias da DFC × Resumo Executivo Oficial da DFC (padrão banco / PDF).
   Valida o CÓDIGO REAL do painel (public/index.html: objeto DFC, o motor DFC_RESUMO e o motor DFC_MATRIZ) num contexto isolado do Node, sem navegador
   e sem banco, com empresas, contas, extratos e lançamentos FICTÍCIOS (LGPD; os CNPJ de exemplo são gerados aqui pelos dígitos verificadores):
   1) cadastro de empresa Matriz: normalização, Matriz única e no topo, situação, validações (nome, CNPJ, CNPJ repetido), gravação e neutralidade white-label (Falco);
   2) associação de contas bancárias padrão da empresa (marcar/desmarcar, contas removidas) e selos de vínculo (padrão, titular, inativa);
   3) escopo do Resumo: seleção manual (1, 2 ou mais contas) × fallback automático "em branco = contas padrão da empresa", alertas e textos;
   4) isolamento de saldos: indicadores, saldo inicial/final, conciliação, cobertura da dívida e Quadro 2 calculados SÓ com as contas do escopo;
   5) documento: subtítulo com o escopo, Quadro 1 linha a linha só com as contas incluídas, total, escapes, máscara da folha e v14.06 intacta sem escopo.
   Uso: node tests/teste-dfc-matriz-contas-1407.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(raiz, 'public/index.html'), 'utf8');
const OK = [], FAIL = [];
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x !== '' ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 700) : '')); };

/* ---------- extrai o código real: CSV, leitor OFX e o bloco da DFC (PARC_PIX, PARC_IMP, DFC_RESUMO e DFC_MATRIZ) ---------- */
const corta = (ini, fim) => { const a = html.indexOf(ini), b = html.indexOf(fim, a); if (a < 0 || b < 0) throw new Error('bloco não encontrado: ' + ini); return html.slice(a, b); };
const csvCod = corta('const CSV = {', '/**\n * WhatsApp (camada Util)');
const ofxCod = corta('const OFX = {', '/* ======================= CONTAS (de-para)');
const dfcCod = corta('const DFC_GRUPOS = {', '/* ============================ IEO ============================ */');
const cfg = { doc: null };
const Repo = { get: (col, id) => col === 'config' && id === 'dfc' ? cfg.doc : null };
const { DFC, DFC_REGRAS_PADRAO, DFC_RESUMO: R, DFC_MATRIZ: M } = new Function('Repo', 'g04', 'g05', csvCod + '\n' + ofxCod + '\n' + dfcCod + '\nreturn { DFC, DFC_REGRAS_PADRAO, DFC_RESUMO, DFC_MATRIZ };')(Repo, () => true, () => true);

const dvCnpj = b => { const calc = (d, ps) => { const r = d.reduce((a, x, i) => a + x * ps[i], 0) % 11; return r < 2 ? 0 : 11 - r; }; const d = String(b).split('').map(Number); d.push(calc(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])); d.push(calc(d, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])); return d.join(''); };
const CNPJ_A = dvCnpj('123450000001'), CNPJ_FILIAL = dvCnpj('123450000002'), CNPJ_B = dvCnpj('987650000001'), CNPJ_C = dvCnpj('555550000001');
const r2 = n => Math.round(n * 100) / 100, brl = n => R.brl(n);

/* ---------- 1 · cadastro de empresa Matriz ---------- */
const E = (o = {}) => ({ id: 'emp-a', nome: 'Empresa Teste Comércio', razao: 'Empresa Teste Comércio Ltda', cnpj: CNPJ_A, ...o });
const bruta = [
  { id: 'emp-a', nome: ' Empresa Teste Comércio ', razao: 'Empresa Teste Comércio Ltda', cnpj: R.cnpjFmt(CNPJ_A), situacao: 'ATIVA', matriz: true, contasPadrao: ['cb1', ' cb2 ', 'cb1', '', null], receita: { situacao: 'ATIVA' } },
  { id: 'emp-b', nome: 'Empresa Teste Serviços', razao: 'Empresa Teste Serviços Ltda', cnpj: CNPJ_B, matriz: 'sim', contasPadrao: ['cb3'] },
  { id: 'emp-c', nome: 'Empresa Sem Contas', cnpj: '', matriz: true },
  { id: 'emp-a', nome: 'Duplicada pelo id' }, { id: '', nome: 'Sem id' }, { id: 'emp-x' }, null, 'texto', 42,
];
const L = M.normalizar(bruta);
chk('normalização: descarta nulos, sem id, sem nome e id repetido; mantém as 3 empresas válidas', L.length === 3 && L.map(e => e.id).join() === 'emp-a,emp-b,emp-c', L.map(e => e.id));
chk('normalização: nome sem espaços, CNPJ só dígitos, situação "ATIVA" → "Ativa", contas padrão únicas e sem vazios', L[0].nome === 'Empresa Teste Comércio' && L[0].cnpj === CNPJ_A && L[0].situacao === 'Ativa' && L[0].contasPadrao.join() === 'cb1,cb2', L[0]);
chk('normalização preserva campos desconhecidos do cadastro (ex.: dados da Receita)', L[0].receita && L[0].receita.situacao === 'ATIVA');
chk('só UMA Matriz: a primeira marcada vale; "sim" (texto) não conta como verdadeiro; as outras viram não-matriz', L[0].matriz === true && L[1].matriz === false && L[2].matriz === false && L.filter(e => e.matriz).length === 1, L.map(e => e.matriz));
chk('lista vazia, nula ou de tipo errado não quebra', M.normalizar(null).length === 0 && M.normalizar(undefined).length === 0 && M.normalizar('x').length === 0 && M.normalizar({}).length === 0);
const O = M.ordenar([E({ id: 'z', nome: 'Zeta' }), E({ id: 'm', nome: 'Matriz Teste', cnpj: CNPJ_B, matriz: true }), E({ id: 'a', nome: 'Alfa', cnpj: CNPJ_C })]);
chk('ordem: a Matriz no topo e, depois dela, as demais na ordem do cadastro', O.map(e => e.id).join() === 'm,z,a', O.map(e => e.id));
chk('matriz(): devolve a Matriz ou null quando não há', M.matriz(bruta).id === 'emp-a' && M.matriz([E()]) === null && M.matriz([]) === null);
chk('situação aceita as variações da Receita e do cadastro ("baixada", "Ativo", "INAPTA") e recusa o resto', M.situacao('baixada') === 'Baixada' && M.situacao('Ativo') === 'Ativa' && M.situacao('INAPTA') === 'Inapta' && M.situacao('inativo') === 'Inativa' && M.situacao('xyz') === '' && M.situacao(null) === '');
const lista0 = M.normalizar([E({ matriz: true }), E({ id: 'emp-b', nome: 'Empresa Teste Serviços', cnpj: CNPJ_B })]);
chk('validar: empresa correta não tem erro', M.validar(E({ id: 'emp-c', nome: 'Nova', cnpj: CNPJ_C }), lista0).length === 0);
chk('validar: nome obrigatório', M.validar(E({ nome: '  ' }), lista0).some(x => /nome da empresa/.test(x)));
chk('validar: CNPJ com dígito errado é recusado; CNPJ em branco é aceito (cadastro sem CNPJ)', M.validar(E({ id: 'n', cnpj: CNPJ_A.slice(0, 13) + (CNPJ_A.endsWith('0') ? '1' : '0') }), lista0).some(x => /CNPJ inválido/.test(x)) && M.validar(E({ id: 'n', cnpj: '' }), lista0).length === 0);
chk('validar: CNPJ já usado por outra empresa é recusado; a própria empresa pode manter o seu', M.validar(E({ id: 'n', nome: 'Outra', cnpj: CNPJ_B }), lista0).some(x => /outra empresa cadastrada/.test(x)) && M.validar(E({ id: 'emp-b', nome: 'Empresa Teste Serviços', cnpj: CNPJ_B }), lista0).length === 0 && M.validar(E({ id: 'novo-id', cnpj: CNPJ_B }), lista0, 'emp-b').length === 0);
chk('validar: situação desconhecida é recusada', M.validar(E({ id: 'n', cnpj: '', situacao: 'Talvez' }), lista0).some(x => /Situação inválida/.test(x)));
const s1 = M.salvarEmpresa(lista0, E({ id: 'emp-b', nome: 'Empresa Teste Serviços', cnpj: CNPJ_B, matriz: true }));
chk('marcar outra empresa como Matriz desmarca a anterior e informa o nome dela (só uma Matriz por vez)', s1.lista.filter(e => e.matriz).map(e => e.id).join() === 'emp-b' && s1.desmarcou === 'Empresa Teste Comércio', [s1.lista.map(e => [e.id, e.matriz]), s1.desmarcou]);
const s2 = M.salvarEmpresa(s1.lista, E({ id: 'emp-n', nome: 'Empresa Nova', cnpj: CNPJ_C }));
chk('incluir empresa nova mantém as outras e a Matriz atual; editar mantém a posição', s2.lista.length === 3 && s2.lista[2].id === 'emp-n' && s2.desmarcou === null && M.matriz(s2.lista).id === 'emp-b' && M.salvarEmpresa(s2.lista, { ...s2.lista[1], nome: 'Serviços Renomeada', matriz: true }).lista[1].nome === 'Serviços Renomeada');
chk('desmarcar a Matriz deixa o grupo sem Matriz (permitido)', M.matriz(M.salvarEmpresa(s1.lista, { ...s1.lista[1], matriz: false }).lista) === null);
chk('empresa de exemplo só aparece fora do Falco; no Falco sem cadastro a lista é vazia (white-label)', M.base(null, { falco: false, padrao: [{ id: 'ex1', nome: 'Exemplo Um' }] }).length === 1 && M.base(null, { falco: true, padrao: [{ id: 'ex1', nome: 'Exemplo Um' }] }).length === 0 && M.base([E()], { falco: true, padrao: [{ id: 'ex1', nome: 'Exemplo Um' }] }).length === 1 && !/esposende/i.test(JSON.stringify(M.base(null, { falco: true, padrao: [{ id: 'ex1', nome: 'Exemplo Um' }] }))));

/* ---------- 2 · contas bancárias associadas como padrão ---------- */
const CONTAS = [
  { id: 'cb1', apelido: 'Conta A', banco: '001', bancoNome: 'Banco Teste', agencia: '0001', conta: '12345', digito: '6', ativa: true },
  { id: 'cb2', apelido: 'Conta B', banco: '341', bancoNome: 'Banco Teste 2', agencia: '0002', conta: '77777', digito: '8', ativa: true, titularCnpj: CNPJ_A },
  { id: 'cb3', apelido: 'Conta C', banco: '237', bancoNome: 'Banco Teste 3', agencia: '0003', conta: '55555', digito: '1', ativa: true, titularEmpresaId: 'emp-b' },
  { id: 'cb4', apelido: 'Conta D <inativa>', banco: '104', bancoNome: 'Banco Teste 4', agencia: '0004', conta: '99999', digito: '', ativa: false },
];
const EMPS = M.normalizar([
  E({ matriz: true, situacao: 'Ativa', contasPadrao: ['cb1', 'cb2'] }),
  E({ id: 'emp-b', nome: 'Empresa Teste Serviços', razao: 'Empresa Teste Serviços Ltda', cnpj: CNPJ_B, contasPadrao: ['cb3'] }),
  E({ id: 'emp-c', nome: 'Empresa Sem Contas', razao: 'Empresa Sem Contas Ltda', cnpj: CNPJ_C }),
]);
const a1 = M.definirContasPadrao(EMPS, 'emp-c', ['cb4', ' cb4 ', 'cb1', '']);
chk('definir contas padrão: remove repetidas e vazias e só mexe na empresa escolhida', a1.find(e => e.id === 'emp-c').contasPadrao.join() === 'cb4,cb1' && a1.find(e => e.id === 'emp-a').contasPadrao.join() === 'cb1,cb2');
const a2 = M.alternarContaPadrao(EMPS, 'emp-a', 'cb3', true), a3 = M.alternarContaPadrao(a2, 'emp-a', 'cb1', false);
chk('marcar / desmarcar uma conta como padrão da Matriz (o que o checkbox da conta faz) e não duplicar ao marcar de novo', a2.find(e => e.id === 'emp-a').contasPadrao.join() === 'cb1,cb2,cb3' && a3.find(e => e.id === 'emp-a').contasPadrao.join() === 'cb2,cb3' && M.alternarContaPadrao(a2, 'emp-a', 'cb3', true).find(e => e.id === 'emp-a').contasPadrao.length === 3);
chk('conta excluída sai dos padrões de todas as empresas', M.removerContaDosPadroes(M.alternarContaPadrao(EMPS, 'emp-b', 'cb1', true), 'cb1').every(e => !e.contasPadrao.includes('cb1')));
const i1 = M.infoConta(CONTAS[0]), i4 = M.infoConta(CONTAS[3]);
chk('dados da conta para exibir: Banco, Agência/Conta (com dígito) e Descrição; conta sem dígito e inativa', i1.banco === '001 · Banco Teste' && i1.agConta === 'Ag 0001 · CC 12345-6' && i1.descricao === 'Conta A' && i1.ativa === true && i4.agConta === 'Ag 0004 · CC 99999' && i4.ativa === false, [i1, i4]);
chk('titular: empresa escolhida (nome e CNPJ do cadastro), só o CNPJ informado, ou nenhum', M.titularRotulo(CONTAS[2], EMPS) === 'Empresa Teste Serviços · ' + R.cnpjFmt(CNPJ_B) && M.titularRotulo(CONTAS[1], EMPS) === R.cnpjFmt(CNPJ_A) && M.titularRotulo(CONTAS[0], EMPS) === '', M.titularRotulo(CONTAS[2], EMPS));
const v = (k, emp) => M.vinculos(k, emp, EMPS).map(x => x.txt).join(' | ');
chk('selos: conta padrão da Matriz (empresa = Matriz), padrão de outra empresa, só titular, inativa e sem vínculo', v(CONTAS[0], EMPS[0]) === 'Padrão da Matriz' && v(CONTAS[2], EMPS[1]) === 'Padrão de Empresa Teste Serviços | Titular: Empresa Teste Serviços · ' + R.cnpjFmt(CNPJ_B) && v(CONTAS[3], EMPS[0]) === 'Inativa' && v(CONTAS[1], EMPS[1]) === 'Padrão da Matriz | Titular: ' + R.cnpjFmt(CNPJ_A), [v(CONTAS[0], EMPS[0]), v(CONTAS[2], EMPS[1]), v(CONTAS[3], EMPS[0]), v(CONTAS[1], EMPS[1])]);
chk('aviso de titular: raiz de CNPJ diferente é apontada; a filial (mesma raiz) e a conta sem titular não', M.titularesDivergentes(['cb1', 'cb2', 'cb3'], CONTAS, CNPJ_A, EMPS).join() === 'cb3' && M.titularesDivergentes(['cb2'], [{ ...CONTAS[1], titularCnpj: CNPJ_FILIAL }], CNPJ_A, EMPS).length === 0 && M.titularesDivergentes(['cb1'], CONTAS, CNPJ_A, EMPS).length === 0 && M.titularesDivergentes(['cb3'], CONTAS, '', EMPS).length === 0);

/* ---------- 3 · escopo do Resumo: manual × fallback automático ---------- */
const esc = (empresa, sel, contas = CONTAS) => M.resolverEscopo({ empresa, selecionadas: sel, contas });
const m1 = esc(EMPS[0], ['cb2']), m2 = esc(EMPS[0], ['cb3', 'cb1']), mx = esc(EMPS[0], ['cb9', 'cb2', 'cb2']);
chk('1 conta marcada: considera estritamente essa conta (a Matriz tem padrão, mas a marcação manual vence)', m1.modo === 'manual' && m1.ids.join() === 'cb2' && m1.n === 1 && /1 conta marcada manualmente: o demonstrativo considera estritamente essa conta\./.test(m1.texto) && m1.alerta === '', m1);
chk('2 contas marcadas: só elas, na ordem do cadastro (não na ordem do clique)', m2.modo === 'manual' && m2.ids.join() === 'cb1,cb3' && /2 contas marcadas manualmente: o demonstrativo considera estritamente essas contas\./.test(m2.texto), m2);
chk('ids repetidos ou inexistentes na marcação são ignorados', mx.modo === 'manual' && mx.ids.join() === 'cb2', mx);
const f1 = esc(EMPS[0], []), f2 = esc(EMPS[1], null), f3 = esc(EMPS[0], undefined);
chk('em branco + Matriz com 2 contas padrão: usa as 2 automaticamente, com o texto exato do modal', f1.modo === 'padrao' && f1.ids.join() === 'cb1,cb2' && f1.n === 2 && f1.texto === 'Nenhuma conta marcada manualmente — serão consideradas automaticamente as 2 contas padrão vinculadas à Empresa Teste Comércio.' && f1.alerta === '', f1.texto);
chk('em branco + empresa com 1 conta padrão: singular correto ("a 1 conta padrão vinculada")', f2.modo === 'padrao' && f2.ids.join() === 'cb3' && f2.texto === 'Nenhuma conta marcada manualmente — serão consideradas automaticamente a 1 conta padrão vinculada à Empresa Teste Serviços.', f2.texto);
chk('seleção ausente (undefined) é o mesmo que em branco', f3.modo === 'padrao' && f3.ids.join() === 'cb1,cb2');
const sp = esc(EMPS[2], []);
chk('em branco + empresa SEM contas padrão: alerta pedindo marcar ao menos uma conta ou configurar o vínculo; não gera nada', sp.modo === 'sem_padrao' && sp.ids.length === 0 && /Nenhuma conta marcada e a empresa Empresa Sem Contas ainda não possui contas padrão vinculadas/.test(sp.alerta) && /marque ao menos uma conta ou configure o vínculo no cadastro da empresa/.test(sp.alerta) && /Gerenciar Empresas \/ Matriz/.test(sp.alerta), sp.alerta);
chk('validar escopo: bloqueia quando não há contas; libera quando há', M.validarEscopo(sp).length === 1 && M.validarEscopo(f1).length === 0 && M.validarEscopo(m1).length === 0 && M.validarEscopo(null).length === 1);
const so = esc(null, []), so2 = esc(null, ['cb1']);
chk('"Outra empresa" (sem cadastro) em branco: alerta; marcando contas: vale a marcação', so.modo === 'sem_padrao' && /não está no cadastro/.test(so.alerta) && M.validarEscopo(so).length === 1 && so2.modo === 'manual' && so2.ids.join() === 'cb1');
const orf = esc(E({ id: 'emp-o', contasPadrao: ['cbX', 'cbY'] }), []);
chk('padrões que apontam para contas removidas não contam: alerta menciona as contas removidas', orf.modo === 'sem_padrao' && /contas que foram removidas/.test(orf.alerta) && orf.orfas.join() === 'cbX,cbY', orf);
chk('padrão parcialmente órfão: usa as contas que ainda existem e registra as removidas', (() => { const r = esc(E({ id: 'emp-p', contasPadrao: ['cb1', 'cbX'] }), []); return r.modo === 'padrao' && r.ids.join() === 'cb1' && r.orfas.join() === 'cbX'; })());
const sc = esc(EMPS[0], [], []);
chk('sem nenhuma conta cadastrada na DFC: alerta próprio', sc.modo === 'sem_contas' && /Não há contas bancárias cadastradas/.test(sc.alerta) && M.validarEscopo(sc).length === 1);
chk('"todas": verdadeiro só quando o escopo cobre todas as contas cadastradas', esc(EMPS[0], CONTAS.map(k => k.id)).todas === true && m2.todas === false && f1.todas === false);
const INF = CONTAS.map(k => M.infoConta(k));
const d1 = M.descreverEscopo(m2, INF, EMPS[0]), d2 = M.descreverEscopo(f1, INF, EMPS[0]), d3 = M.descreverEscopo(f2, INF, EMPS[1]), d4 = M.descreverEscopo(esc(EMPS[0], CONTAS.map(k => k.id)), INF, EMPS[0]);
chk('texto do escopo no documento: selecionadas manualmente / padrão da Matriz / padrão de outra empresa / todas as contas', d1.curto === 'Contas consideradas: 2 contas bancárias (contas selecionadas manualmente)' && d2.curto === 'Contas consideradas: 2 contas bancárias (contas padrão da Matriz)' && d3.curto === 'Contas consideradas: 1 conta bancária (contas padrão de Empresa Teste Serviços)' && d4.curto === 'Contas consideradas: 4 contas bancárias (todas as contas bancárias cadastradas)', [d1.curto, d2.curto, d3.curto, d4.curto]);
chk('lista longa do escopo: Banco · Agência/Conta (Descrição), separadas por ponto e vírgula', d2.longo === '001 · Banco Teste · Ag 0001 · CC 12345-6 (Conta A); 341 · Banco Teste 2 · Ag 0002 · CC 77777-8 (Conta B)', d2.longo);
const muitas = Array.from({ length: 11 }, (_, i) => ({ id: 'x' + i, apelido: 'C' + i, banco: '001', bancoNome: 'Banco', agencia: '1', conta: String(i) }));
const dm = M.descreverEscopo(esc(null, muitas.map(k => k.id), muitas), muitas.map(k => M.infoConta(k)), null);
chk('mais de 8 contas: lista as 8 primeiras e "e mais N"', /; e mais 3$/.test(dm.longo) && dm.longo.split('; ').length === 9 && /11 contas bancárias/.test(dm.curto), dm.longo.slice(-40));

/* ---------- 4 · isolamento de saldos no Resumo ---------- */
const MES = '2026-10', ANT = '2026-09', pm = R.periodo('mes', MES);
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
  tx('2026-10-04', 20000, 'PIX RECEB VENDA', 'cb3'), tx('2026-10-13', -1200, 'ALUGUEL LOJA 02', 'cb3'), tx('2026-10-14', -300, 'TARIFA BANCARIA', 'cb3'),
];
const soma = (id, ts = T1) => r2(ts.filter(t => t.contaId === id).reduce((a, t) => a + t.valor, 0));
const mov = { cb1: soma('cb1'), cb2: soma('cb2'), cb3: soma('cb3') }, ini = { cb1: 10000, cb2: 5000, cb3: 2000 };
const ext = (contaId, mes, valor, data) => ({ contaId, mes, saldo: { valor, data } });
const EXT = [...['cb1', 'cb2', 'cb3'].map(id => ext(id, ANT, ini[id], '2026-09-30')), ...['cb1', 'cb2', 'cb3'].map(id => ext(id, MES, r2(ini[id] + mov[id]), '2026-10-31'))];
const CAD = CONTAS.map(k => ({ id: k.id, rotulo: `${k.apelido} · ${M.infoConta(k).agConta}`, ...M.infoConta(k) }));
const base = (o = {}) => ({ periodo: pm, transacoes: T1, contas: CAD, extratos: EXT, saldoManualInicial: null, previstoPorMes: null, mascarar: false, ...o });
const liqEsperado = ids => DFC.consolidar(T1.filter(t => ids.includes(t.contaId)), DFC.regras()).liquido;

chk('cenário fictício confere à mão: movimento por conta (cb1 30.862,55 · cb2 9.000,00 · cb3 18.500,00)', mov.cb1 === 30862.55 && mov.cb2 === 9000 && mov.cb3 === 18500, mov);
const all = R.montar(base()), tres = R.montar(base({ escopo: ['cb1', 'cb2', 'cb3'], escopoCompleto: false }));
chk('SEM escopo (v14.06): considera todas as contas com movimento, sem o bloco "escopo"', all.escopo === null && all.nContas === 3 && all.nTransacoes === T1.length, [all.escopo, all.nContas]);
chk('escopo = todas as contas com movimento dá EXATAMENTE os mesmos indicadores, saldos e Quadro 2 que o Resumo sem escopo', JSON.stringify(tres.indicadores) === JSON.stringify(all.indicadores) && JSON.stringify(tres.saldos.final) === JSON.stringify(all.saldos.final) && JSON.stringify(tres.saldos.inicial) === JSON.stringify(all.saldos.inicial) && JSON.stringify(tres.quadro2) === JSON.stringify(all.quadro2));
const c1 = R.montar(base({ escopo: ['cb1'] })), c2 = R.montar(base({ escopo: ['cb2'] })), c12 = R.montar(base({ escopo: ['cb1', 'cb2'] })), c3 = R.montar(base({ escopo: ['cb3'] }));
chk('conta 1 sozinha: só os lançamentos dela (13); saldo inicial 10.000,00; variação líquida igual à da DFC filtrada na conta', c1.nTransacoes === 13 && c1.nContas === 1 && c1.saldos.inicial.valor === 10000 && c1.indicadores.variacao === r2(liqEsperado(['cb1'])) && c1.indicadores.variacao === 34862.55, [c1.nTransacoes, c1.saldos.inicial.valor, c1.indicadores.variacao]);
chk('conta 1 sozinha: transferência entre contas (−4.000) fica nas neutras e o saldo final conciliado fecha com o extrato dela (conciliado)', c1.indicadores.neutras === -4000 && c1.saldos.final.calculado === r2(10000 + mov.cb1) && c1.saldos.final.extrato === r2(10000 + mov.cb1) && c1.saldos.final.status === 'conciliado', c1.saldos.final);
chk('conta 2 sozinha: variação 5.000,00, neutras +4.000,00, saldo inicial 5.000,00 e final 14.000,00 conciliado', c2.indicadores.variacao === 5000 && c2.indicadores.neutras === 4000 && c2.saldos.inicial.valor === 5000 && c2.saldos.final.extrato === 14000 && c2.saldos.final.status === 'conciliado', [c2.indicadores, c2.saldos.final]);
chk('contas 1 + 2: variações somam (34.862,55 + 5.000,00), as transferências entre elas se anulam (neutras 0) e o saldo inicial soma 15.000,00', c12.indicadores.variacao === r2(c1.indicadores.variacao + c2.indicadores.variacao) && c12.indicadores.neutras === 0 && c12.saldos.inicial.valor === 15000 && c12.saldos.final.status === 'conciliado', [c12.indicadores.variacao, c12.indicadores.neutras]);
chk('cada escopo conciliado: Σ movimento das contas = variação líquida + neutras; saldo final = soma dos extratos', [c1, c2, c12, c3, all].every(x => r2(x.saldos.porConta.reduce((a, k) => a + k.movimento, 0)) === r2(x.indicadores.variacao + x.indicadores.neutras) && x.saldos.final.status === 'conciliado'));
chk('conta 3 sozinha: só ela entra (20.000 de entrada operacional; saldo inicial 2.000,00; final 20.500,00); as outras contas ficam de fora', c3.nTransacoes === 3 && c3.indicadores.operacional.entradas === 20000 && c3.saldos.inicial.valor === 2000 && c3.saldos.final.extrato === 20500 && c3.saldos.porConta.map(k => k.id).join() === 'cb3', [c3.indicadores.operacional, c3.saldos.final]);
chk('geração operacional, investimento, financiamento e não operacionais do escopo = apurados só com as contas dele', c1.indicadores.investimento === -10000 && c1.indicadores.financiamento === 25000 && c1.indicadores.naoOperacional.liquido === -1500 && c2.indicadores.investimento === 0 && c2.indicadores.financiamento === 0 && c2.indicadores.naoOperacional.liquido === 0 && c2.indicadores.operacional.liquido === 5000, [c1.indicadores, c2.indicadores]);
chk('cobertura do serviço da dívida isolada: a conta 1 tem as amortizações e juros (caixa antes dos juros ÷ 5.600); a conta 2 não tem dívida (n/d)', c1.indicadores.dscr.servico === 5600 && c1.indicadores.dscr.juros === 600 && c1.indicadores.dscr.amortizacoes === 5000 && Math.abs(c1.indicadores.dscr.valor - (c1.indicadores.operacional.liquido + 600) / 5600) < 1e-9 && c2.indicadores.dscr.valor === null && c2.indicadores.dscr.faixa === 'nd' && c12.indicadores.dscr.servico === 5600, [c1.indicadores.dscr, c2.indicadores.dscr]);
chk('isolamento: mexer nos lançamentos e extratos da conta 2 não altera nada do escopo da conta 1', (() => { const T = T1.map(t => t.contaId === 'cb2' ? { ...t, valor: t.valor * 7 } : t), X = EXT.map(x => x.contaId === 'cb2' ? { ...x, saldo: { ...x.saldo, valor: 999999 } } : x); const o = R.montar(base({ escopo: ['cb1'], transacoes: T, extratos: X })); return JSON.stringify(o.indicadores) === JSON.stringify(c1.indicadores) && JSON.stringify(o.saldos) === JSON.stringify(c1.saldos); })());
chk('lançamento sem conta e de conta desconhecida nunca entram quando há escopo', (() => { const T = [...T1, tx('2026-10-22', 777, 'PIX RECEB VENDA', undefined), tx('2026-10-23', 555, 'PIX RECEB VENDA', 'cbZ')]; const o = R.montar(base({ escopo: ['cb1'], transacoes: T })); return o.nTransacoes === 13 && o.indicadores.variacao === c1.indicadores.variacao; })());
chk('o saldo por conta traz Banco, Agência/Conta e Descrição para o documento', c1.saldos.porConta[0].banco === '001 · Banco Teste' && c1.saldos.porConta[0].agConta === 'Ag 0001 · CC 12345-6' && c1.saldos.porConta[0].descricao === 'Conta A', c1.saldos.porConta[0]);
const c14 = R.montar(base({ escopo: ['cb1', 'cb4'] })), k4 = c14.saldos.porConta.find(k => k.id === 'cb4');
chk('conta do escopo SEM extrato nem lançamento aparece na lista, como "sem saldo no extrato"; a conciliação vira parcial e o aviso cita a conta', c14.nContas === 2 && k4 && k4.status === 'sem_extrato' && k4.inicial === null && c14.saldos.final.status === 'parcial' && c14.saldos.inicial.parcial === true && c14.avisos.some(a => /Conta D/.test(a)), [k4, c14.avisos]);
const vz = R.montar(base({ escopo: [] }));
chk('escopo vazio (a tela nunca deixa chegar aqui) não quebra: zero contas e zero lançamentos', vz.nContas === 0 && vz.nTransacoes === 0 && vz.indicadores.variacao === 0 && vz.escopo && vz.escopo.n === 0);
const pm1 = R.montar(base({ escopo: ['cb1'], saldoManualInicial: 123456 })), pm2 = R.montar(base({ escopo: ['cb1', 'cb2', 'cb3', 'cb4'], escopoCompleto: true, saldoManualInicial: 123456 })), pm0 = R.montar(base({ saldoManualInicial: 123456 }));
chk('saldo inicial manual da DFC (vale para o consolidado): ignorado com contas parciais (com aviso) e mantido quando o escopo cobre todas as contas ou não há escopo', pm1.saldos.inicial.origem === 'extratos' && pm1.saldos.inicial.valor === 10000 && pm1.avisos.some(a => /saldo inicial informado manualmente/.test(a)) && pm2.saldos.inicial.origem === 'manual' && pm2.saldos.inicial.valor === 123456 && pm0.saldos.inicial.origem === 'manual', [pm1.saldos.inicial, pm2.saldos.inicial]);
const PREV = { [MES]: { rec_cartoes: 55000, pag_fornecedores: 25000 } };
const q1 = R.montar(base({ escopo: ['cb1'], previstoPorMes: PREV })), q0 = R.montar(base({ previstoPorMes: PREV }));
chk('Quadro 2 com previsto: o REALIZADO é o da conta do escopo e o previsto do FCX segue o mesmo (não é por conta); sem escopo nada muda', (() => { const g = o => o.quadro2.grupos.find(x => x.grupo === 'OPERACIONAL').linhas.find(l => l.id === 'rec_cartoes'); return g(q1).realizado === 50000 && g(q1).previsto === 55000 && g(q0).realizado === 50000; })(), q1.quadro2.total);
chk('acumulado de 3 meses com escopo: lançamentos e saldos só das contas escolhidas (extratos de ago, set e out)', (() => { const p = R.periodo('trimestre', MES), T = [...T1, tx('2026-08-10', 1000, 'PIX RECEB VENDA', 'cb1'), tx('2026-08-11', 9999, 'PIX RECEB VENDA', 'cb2')], X = [...EXT, ext('cb1', '2026-07', 400, '2026-07-31'), ext('cb2', '2026-07', 800, '2026-07-31')]; const o = R.montar(base({ periodo: p, escopo: ['cb1'], transacoes: T, extratos: X })); return o.nTransacoes === 14 && o.saldos.inicial.valor === 400 && o.saldos.porConta.length === 1; })());

/* ---------- 5 · documento ---------- */
const sig = [{ nome: 'Fulana de Tal', cargo: 'Gestor Financeiro / Diretoria' }, { nome: 'Beltrano de Tal', cargo: 'Contador Responsável', registro: 'CRC-PE 000000/O-0' }];
const doc = (mod, extra = {}) => R.html(mod, { razao: 'Empresa Teste Comércio Ltda', cnpj: CNPJ_A, logo: '', marca: 'Teste', emitidoEm: '13/11/2026, 10:00:00', notas: '', signatarios: sig, ...extra });
const dEsc = (esc, mod) => { const ds = M.descreverEscopo(esc, INF, EMPS[0]); return doc(mod, { escopoCurto: ds.curto, escopoLongo: ds.longo }); };
const h12 = dEsc(f1, R.montar(base({ escopo: f1.ids, previstoPorMes: PREV })));
chk('documento com escopo: subtítulo "Contas consideradas: 2 contas bancárias (contas padrão da Matriz)" no cabeçalho e as contas por extenso na identificação', h12.includes('Contas consideradas: 2 contas bancárias (contas padrão da Matriz)') && h12.includes('Contas bancárias consideradas') && h12.includes('001 · Banco Teste · Ag 0001 · CC 12345-6 (Conta A)'));
chk('Quadro 1 lista linha a linha só as contas incluídas (Banco, Agência/Conta, saldo inicial, variação líquida, saldo final) e a linha de total', h12.includes('Contas bancárias incluídas nesta emissão (2)') && h12.includes('Banco Teste</td>') === false && h12.includes('001 · Banco Teste<div class="sub">Conta A</div>') && h12.includes('341 · Banco Teste 2<div class="sub">Conta B</div>') && h12.includes('Ag 0001 · CC 12345-6') && h12.includes('Ag 0002 · CC 77777-8') && h12.includes('Total das contas incluídas') && /Saldo final \(conciliado\)/.test(h12) && /Variação líquida<\/th>/.test(h12));
chk('as contas FORA do escopo (C e D) não aparecem em lugar nenhum do documento', !/Conta C|Conta D|Banco Teste 3|Banco Teste 4|CC 55555|CC 99999/.test(h12));
chk('valores do documento = os do escopo das 2 contas: saldo inicial 15.000,00, variação líquida e saldo final conciliado (inicial + movimento das duas contas)', (() => { const o = R.montar(base({ escopo: f1.ids })); return h12.includes(brl(o.saldos.inicial.valor)) && h12.includes(brl(o.indicadores.variacao)) && h12.includes(brl(o.saldos.final.calculado)) && o.saldos.inicial.valor === 15000 && o.saldos.final.calculado === r2(15000 + mov.cb1 + mov.cb2); })());
chk('linha de total = soma das contas (saldo inicial, variação das contas e saldo final)', (() => { const o = R.montar(base({ escopo: f1.ids })), tot = h12.slice(h12.indexOf('Total das contas incluídas')); return tot.includes(brl(15000)) && tot.includes(brl(r2(mov.cb1 + mov.cb2))) && tot.includes(brl(r2(15000 + mov.cb1 + mov.cb2))) && o.saldos.porConta.length === 2; })());
chk('nota sobre as transferências entre contas próprias: aparece quando o escopo tem neutras (conta 1 sozinha) e não aparece quando elas se anulam (contas 1 + 2)', !h12.includes('A variação líquida por conta inclui as transferências') && dEsc(m1, R.montar(base({ escopo: ['cb1'] }))).includes('A variação líquida por conta inclui as transferências entre contas próprias'));
chk('previsto do FCX com escopo parcial: o Quadro 2 avisa que o previsto é da empresa toda; com todas as contas, o aviso não aparece', h12.includes('O previsto do FCX é apurado para a empresa como um todo, não por conta bancária') && !dEsc(esc(EMPS[0], CONTAS.map(k => k.id)), R.montar(base({ escopo: CONTAS.map(k => k.id), escopoCompleto: true, previstoPorMes: PREV }))).includes('O previsto do FCX é apurado para a empresa como um todo') && !dEsc(f1, R.montar(base({ escopo: f1.ids }))).includes('O previsto do FCX é apurado'));
const hSem = doc(all);
chk('SEM escopo (recurso desligado ou v14.06): o documento é o da v14.06 — "Saldos por conta bancária (extratos OFX)", sem escopo e sem a tabela nova', hSem.includes('Saldos por conta bancária (extratos OFX)') && !hSem.includes('Contas bancárias incluídas nesta emissão') && !hSem.includes('Contas consideradas') && !hSem.includes('Contas bancárias consideradas'));
chk('estrutura do documento intacta: Quadro 1, Quadro 2, Quadro 3 (quando há notas) e assinaturas, nessa ordem', (() => { const h = doc(R.montar(base({ escopo: ['cb1'] })), { notas: 'Nota de teste.', escopoCurto: 'x', escopoLongo: 'y' }); const i = ['Quadro 1 —', 'Quadro 2 —', 'Quadro 3 —', 'class="rx-ass"'].map(s => h.indexOf(s)); return i.every(x => x > 0) && i[0] < i[1] && i[1] < i[2] && i[2] < i[3] && h.includes('Fulana de Tal') && h.includes('CRC-PE 000000/O-0'); })());
const xss = [{ ...CAD[0], descricao: '<img src=x onerror=alert(1)>', banco: '001 · <b>Banco</b>', agConta: 'Ag 1 · CC "2"' }];
const hx = doc(R.montar(base({ escopo: ['cb1'], contas: xss })), { escopoCurto: 'Contas <i>x</i>', escopoLongo: '<script>alert(1)</script>' });
chk('textos de conta e de escopo são escapados (sem HTML injetado pelo cadastro)', !/<img src=x|<script>|<b>Banco<\/b>|<i>x<\/i>/.test(hx) && hx.includes('&lt;img src=x onerror=alert(1)&gt;') && hx.includes('&lt;script&gt;') && hx.includes('CC &quot;2&quot;'));
const hm = dEsc(m1, R.montar(base({ escopo: ['cb1'], mascarar: true })));
chk('máscara de salários mantida com escopo: sem a linha da folha e sem o valor 8.137,45', !hm.includes('Folha de pagamento') && !hm.includes('8.137,45') && /detalhe restrito/.test(hm));
chk('com acesso a salários a folha aparece normalmente no escopo da conta 1', dEsc(m1, R.montar(base({ escopo: ['cb1'] }))).includes('8.137,45') && !dEsc(m1, R.montar(base({ escopo: ['cb2'] }))).includes('8.137,45'));
chk('sem tags internas (★, ids de categoria) nem "undefined"/"NaN" no documento com escopo', !/★|pag_|rec_|inv_|fin_|cus_|undefined|NaN|\[object|null/.test(h12.replace(/Empresa Teste Comércio Ltda/g, '')), (h12.match(/★|pag_\w+|rec_\w+|undefined|NaN|\[object|null/) || [])[0]);
chk('HTML equilibrado (tabelas, linhas e blocos) e neutro (nenhuma menção à Esposende: white-label)', (h12.match(/<table/g) || []).length === (h12.match(/<\/table>/g) || []).length && (h12.match(/<tr/g) || []).length === (h12.match(/<\/tr>/g) || []).length && (h12.match(/<div/g) || []).length === (h12.match(/<\/div>/g) || []).length && !/esposende/i.test(h12));

console.log(`\n${FAIL.length ? 'FALHAS (' + FAIL.length + '):\n - ' + FAIL.join('\n - ') : 'OK (' + OK.length + ' verificações)'}`);
process.exit(FAIL.length ? 1 : 0);
