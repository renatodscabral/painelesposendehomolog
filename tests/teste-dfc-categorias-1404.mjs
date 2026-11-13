/* v14.04 · DFC · Categorias personalizadas — criação, associação a uma regra de classificação e apuração isolada no demonstrativo.
   Valida o CÓDIGO REAL do painel (public/index.html, bloco DFC) num contexto isolado do Node, sem navegador e sem banco, com transações FICTÍCIAS (LGPD):
   1) as categorias padrão seguem pré-carregadas e o grupo "Atividades não operacionais" fica logo abaixo de Financiamento;
   2) criação de "Saídas não operacionais" (Saída · Não Operacional · Soma no fluxo líquido) com validações (nome, sentido, grupo, duplicidade);
   3) associação a uma regra de classificação (seletor filtrado pelo Sentido) e classificação automática de transações;
   4) apuração: o subtotal "Caixa Líquido das Atividades Operacionais" fica isolado, o bloco Não Operacional aparece e tudo soma na Variação Líquida de Caixa;
   5) impacto "Neutra / Transferência" fica fora do fluxo líquido; exclusão bloqueada para categoria em uso (regra, De-para, lançamento) e para as padrão;
   6) recurso desligado = comportamento anterior; registros quebrados são ignorados;
   7) permissões no SERVIDOR: gravar config/dfc só com fcx.dfc.regras (ou Master), sem abrir o resto da coleção config e sem permitir excluir o documento.
   Uso: node tests/teste-dfc-categorias-1404.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(raiz, 'public/index.html'), 'utf8');
const OK = [], FAIL = [];
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x !== '' ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 600) : '')); };

/* ---------- extrai o motor real da DFC (grupos, categorias padrão, regras padrão e o objeto DFC) ---------- */
const a = html.indexOf('const DFC_GRUPOS = {'), b = html.indexOf('/* ============================ IEO ============================ */');
if (a < 0 || b < 0 || b < a) throw new Error('bloco DFC não encontrado em public/index.html');
const codigo = html.slice(a, b);
/** `cfg` = o documento config/dfc simulado; `ligado` = recurso gestao_v1404 */
const montar = (cfg, ligado = true) => {
  const Repo = { get: (col, id) => (col === 'config' && id === 'dfc' ? cfg.doc : null) };
  return new Function('Repo', 'g04', codigo + '\nreturn { DFC, DFC_GRUPOS, DFC_CATEGORIAS, DFC_REGRAS_PADRAO };')(Repo, () => ligado);
};
const cfg = { doc: null };
const E = montar(cfg);
const { DFC, DFC_GRUPOS, DFC_CATEGORIAS, DFC_REGRAS_PADRAO } = E;
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

/* ---------- 1 · base pré-carregada ---------- */
chk('as 21 categorias padrão seguem pré-carregadas (e nenhuma é marcada como personalizada)', DFC_CATEGORIAS.length === 21 && DFC.categorias().length === 21 && !DFC.categorias().some(c => c.personalizada), DFC.categorias().length);
chk('ids padrão conhecidos continuam existindo (rec_outros e pag_outros são o destino quando nenhuma regra casa)', ['rec_cartoes', 'pag_fornecedores', 'pag_outros', 'rec_outros', 'inv_capex', 'fin_amortizacao', 'transf'].every(id => DFC.cat(id)));
const gk = Object.keys(DFC_GRUPOS);
chk('grupo "Atividades não operacionais" entra logo abaixo de Financiamento (antes das transferências)', gk.join() === 'OPERACIONAL,INVESTIMENTO,FINANCIAMENTO,NAO_OPERACIONAL,TRANSFERENCIA' && DFC_GRUPOS.NAO_OPERACIONAL === 'Atividades não operacionais', gk);
chk('os 4 grupos escolhíveis no cadastro são Operacional, Investimento, Financiamento e Não Operacional', DFC.GRUPOS_CAT.map(g => DFC.GRUPOS_CURTO[g]).join() === 'Operacional,Investimento,Financiamento,Não Operacional');
chk('impactos: "Soma no fluxo líquido" (padrão) e "Neutra / Transferência"', DFC.IMPACTOS.soma === 'Soma no fluxo líquido' && DFC.IMPACTOS.neutra === 'Neutra / Transferência');

/* ---------- 2 · criação da categoria "Saídas não operacionais" ---------- */
const form = { nome: '  Saídas   não operacionais ', sentido: 'S', grupo: 'NAO_OPERACIONAL', impacto: 'soma' };
const p1 = DFC.prepararCategoria(form, { id: 'cus_nao_op' });
chk('criação: nome saneado (espaços extras), Saída, Não Operacional, Soma no fluxo líquido', p1.cat && p1.cat.nome === 'Saídas não operacionais' && p1.cat.sentido === 'S' && p1.cat.grupo === 'NAO_OPERACIONAL' && p1.cat.impacto === 'soma' && p1.cat.id === 'cus_nao_op', p1);
chk('criação: impacto omitido assume "soma" (padrão)', DFC.prepararCategoria({ nome: 'Distribuição de lucros', sentido: 'S', grupo: 'FINANCIAMENTO' }, { id: 'x' }).cat?.impacto === 'soma');
const bad = f => DFC.prepararCategoria({ ...form, ...f }, { id: 'novo' }).erro;
chk('validação: nome vazio ou curto demais', /nome/i.test(bad({ nome: '' })) && /mínimo/.test(bad({ nome: 'ab' })), [bad({ nome: '' }), bad({ nome: 'ab' })]);
chk('validação: nome acima de 60 caracteres', /60/.test(bad({ nome: 'x'.repeat(61) })), bad({ nome: 'x'.repeat(61) }));
chk('validação: sentido precisa ser Entrada ou Saída (nunca "Ambos")', /sentido/i.test(bad({ sentido: '*' })) && /sentido/i.test(bad({ sentido: '' })));
chk('validação: grupo precisa ser um dos 4 (não aceita Transferência nem texto livre)', /grupo/i.test(bad({ grupo: 'TRANSFERENCIA' })) && /grupo/i.test(bad({ grupo: 'XYZ' })));
chk('validação: nome repetido de categoria PADRÃO é recusado, sem diferenciar maiúsculas e acentos', /Já existe/.test(bad({ nome: 'PAGAMENTO a FORNECEDORES' })) && /Já existe/.test(bad({ nome: 'Pagamento à fornecedores' })) && !bad({ nome: 'Pagamento a fornecedores de ativos' }));

/* grava no "banco" (config/dfc.categorias) e confere a leitura */
cfg.doc = { regras: DFC_REGRAS_PADRAO.slice(), mapaFCX: {}, categorias: [p1.cat] };
const todas = DFC.categorias();
chk('persistência: a categoria gravada em config/dfc.categorias aparece junto das padrão (22) e vem marcada como personalizada', todas.length === 22 && DFC.cat('cus_nao_op')?.personalizada === true && DFC.cat('cus_nao_op').nome === 'Saídas não operacionais', todas.length);
chk('validação: nome repetido de categoria PERSONALIZADA é recusado (e a própria categoria pode ser editada com o mesmo nome)', /Já existe/.test(DFC.prepararCategoria(form, { id: 'outra' }).erro) && !!DFC.prepararCategoria(form, { id: 'cus_nao_op' }).cat);

/* ---------- 3 · associação a uma regra de classificação ---------- */
chk('seletor da regra: Sentido "Saída" mostra a nova categoria; "Entrada" não; "Ambos" mostra todas', DFC.porSentido('S').some(c => c.id === 'cus_nao_op') && !DFC.porSentido('E').some(c => c.id === 'cus_nao_op') && DFC.porSentido('*').some(c => c.id === 'cus_nao_op') && DFC.porSentido('*').length === 22);
chk('seletor da regra: o filtro por sentido não perde as padrão (Saída = só S e transferências; Entrada = só E e transferências)', DFC.porSentido('S').every(c => c.sentido !== 'E') && DFC.porSentido('E').every(c => c.sentido !== 'S') && DFC.porSentido('S').some(c => c.id === 'transf'));
chk('compatibilidade categoria × sentido da regra (a UI recusa o que não combina)', DFC.compativel('S', DFC.cat('cus_nao_op')) && !DFC.compativel('E', DFC.cat('cus_nao_op')) && DFC.compativel('*', DFC.cat('cus_nao_op')) && DFC.compativel('E', DFC.cat('transf')));
const regraNova = { id: 'r-nao-op', termos: ['INDENIZACAO', 'MULTA CONTRATUAL'], sentido: 'S', categoria: 'cus_nao_op' };
cfg.doc = { ...cfg.doc, regras: [regraNova, ...DFC_REGRAS_PADRAO] };
const t = (id, data, valor, hist, extra = {}) => ({ id, data, valor, hist, contaId: 'c1', ...extra });
const cl = DFC.classificar(t('x1', '2026-11-05', -1500, 'PAGTO INDENIZACAO TRABALHISTA - ACORDO'));
chk('regra nova classifica a transação na categoria personalizada (origem: regra)', cl.categoria === 'cus_nao_op' && cl.origem === 'regra' && cl.regra === 'r-nao-op', cl);
chk('a regra de Saída não pega entradas com o mesmo termo (cai no padrão)', DFC.classificar(t('x2', '2026-11-05', 900, 'INDENIZACAO SEGURO')).categoria === 'rec_outros');
chk('classificação manual (cat) continua prevalecendo sobre a regra, inclusive para a categoria personalizada', DFC.classificar(t('x3', '2026-11-05', -10, 'ALUGUEL LOJA', { cat: 'cus_nao_op' })).categoria === 'cus_nao_op' && DFC.classificar(t('x4', '2026-11-05', -10, 'INDENIZACAO', { cat: 'pag_marketing' })).categoria === 'pag_marketing');

/* ---------- 4 · apuração isolada no demonstrativo ---------- */
const MES = '2026-11';
const base = [
  t('a1', '2026-11-03', 100000, 'CREDITO GETNET LIQUIDACAO'),
  t('a2', '2026-11-04', -30000, 'PAG TIT ALPARGATAS'),
  t('a3', '2026-11-05', -8000, 'ALUGUEL SHOPPING'),
  t('a4', '2026-11-06', -5000, 'DARF IMPOSTO'),
  t('a5', '2026-11-10', -20000, 'APLICACAO CDB'),
  t('a6', '2026-11-12', 50000, 'CREDITO EMPRESTIMO CAPITAL DE GIRO'),
  t('a7', '2026-11-14', -10000, 'TRANSF ENTRE CONTAS MESMA TITULARIDADE'),
  t('a8', '2026-11-14', 10000, 'TRANSF ENTRE CONTAS MESMA TITULARIDADE', { contaId: 'c2' }),
];
const naoOp = [
  t('n1', '2026-11-18', -1500, 'PAGTO INDENIZACAO TRABALHISTA - ACORDO'),
  t('n2', '2026-11-20', -700, 'MULTA CONTRATUAL RESCISAO'),
];
const regrasCom = cfg.doc.regras, regrasSem = DFC_REGRAS_PADRAO;
const sem = DFC.consolidar(base, regrasSem), com = DFC.consolidar([...base, ...naoOp], regrasCom);
const demo = DFC.demonstrativo(com);
const bl = g => demo.blocos.find(x => x.grupo === g);
chk('Caixa Líquido das Atividades Operacionais isolado: 100.000 − 30.000 − 8.000 − 5.000 = 57.000, igual com ou sem a categoria nova', bl('OPERACIONAL').subtotal === 57000 && sem.porGrupo.OPERACIONAL.liquido === 57000 && demo.operacional === 57000, [bl('OPERACIONAL').subtotal, sem.porGrupo.OPERACIONAL.liquido]);
chk('bloco "Atividades Não Operacionais": 1 linha (Saídas não operacionais) com 2 lançamentos e subtotal de −2.200', bl('NAO_OPERACIONAL').visivel && bl('NAO_OPERACIONAL').linhas.length === 1 && bl('NAO_OPERACIONAL').linhas[0].nome === 'Saídas não operacionais' && bl('NAO_OPERACIONAL').linhas[0].n === 2 && bl('NAO_OPERACIONAL').subtotal === -2200 && bl('NAO_OPERACIONAL').saidas === 2200, bl('NAO_OPERACIONAL'));
chk('sem a regra, os mesmos lançamentos cairiam em "Outras saídas operacionais" e reduziriam o caixa operacional (prova do isolamento)', DFC.consolidar([...base, ...naoOp], regrasSem).porGrupo.OPERACIONAL.liquido === 54800);
chk('subtotais de Investimento (−20.000) e Financiamento (+50.000) intactos', bl('INVESTIMENTO').subtotal === -20000 && bl('FINANCIAMENTO').subtotal === 50000);
chk('o bloco Não Operacional vem logo abaixo de Financiamento (ordem dos blocos)', demo.blocos.map(x => x.grupo).join() === 'OPERACIONAL,INVESTIMENTO,FINANCIAMENTO,NAO_OPERACIONAL');
chk('rótulo do subtotal operacional: "Caixa Líquido das Atividades Operacionais"', bl('OPERACIONAL').rotuloSubtotal === 'Caixa Líquido das Atividades Operacionais' && bl('NAO_OPERACIONAL').rotuloSubtotal === 'Caixa Líquido das Atividades Não Operacionais');
const somaBlocos = r2(demo.blocos.reduce((s, x) => s + x.subtotal, 0));
chk('Variação Líquida de Caixa soma TODOS os blocos: 57.000 − 20.000 + 50.000 − 2.200 = 84.800', demo.variacao === 84800 && somaBlocos === 84800 && com.liquido === 84800, [demo.variacao, somaBlocos]);
chk('transferências entre contas próprias ficam fora da variação líquida (20.000 de volume, listadas como neutras)', demo.neutrasTotal === 20000 && demo.neutras.length === 1 && demo.neutras[0].id === 'transf' && com.transferencias === 20000);
chk('entradas e saídas totais não incluem as transferências (150.000 / 65.200)', com.entradas === 150000 && com.saidas === 65200, [com.entradas, com.saidas]);
chk('consolidação inclui o grupo NAO_OPERACIONAL em porGrupo e a categoria em porCategoria', com.porGrupo.NAO_OPERACIONAL.liquido === -2200 && com.porCategoria.cus_nao_op.valor === -2200 && com.porCategoria.cus_nao_op.n === 2);
const vazio = DFC.consolidar([], regrasSem);
cfg.doc = { regras: regrasSem };
chk('sem categoria/valores no grupo, o bloco Não Operacional NÃO aparece (DFC como antes)', DFC.demonstrativo(DFC.consolidar(base, regrasSem)).blocos.find(x => x.grupo === 'NAO_OPERACIONAL').visivel === false);
cfg.doc = { regras: regrasSem, categorias: [p1.cat] };
chk('categoria cadastrada no grupo (mesmo sem valores no mês) faz o bloco aparecer, com subtotal zero', (() => { const d = DFC.demonstrativo(vazio).blocos.find(x => x.grupo === 'NAO_OPERACIONAL'); return d.visivel && d.linhas.length === 0 && d.subtotal === 0; })());
const rEnt = DFC.prepararCategoria({ nome: 'Receitas não operacionais', sentido: 'E', grupo: 'NAO_OPERACIONAL' }, { id: 'cus_rec_nop' }).cat;
cfg.doc = { regras: [{ id: 'r-venda', termos: ['VENDA DE IMOBILIZADO'], sentido: 'E', categoria: 'cus_rec_nop' }, regraNova, ...regrasSem], categorias: [p1.cat, rEnt] };
const comEnt = DFC.consolidar([...base, ...naoOp, t('e1', '2026-11-22', 4000, 'VENDA DE IMOBILIZADO - VEICULO')], cfg.doc.regras);
chk('categoria de Entrada no grupo Não Operacional soma no mesmo bloco: −2.200 + 4.000 = +1.800; variação 84.800 + 4.000 = 88.800', comEnt.porGrupo.NAO_OPERACIONAL.liquido === 1800 && comEnt.porGrupo.NAO_OPERACIONAL.entradas === 4000 && comEnt.liquido === 88800 && DFC.demonstrativo(comEnt).blocos.find(x => x.grupo === 'NAO_OPERACIONAL').linhas.length === 2, comEnt.porGrupo.NAO_OPERACIONAL);

/* ---------- 5 · impacto neutro, exclusão bloqueada ---------- */
const neu = DFC.prepararCategoria({ nome: 'Reclassificação interna', sentido: 'S', grupo: 'OPERACIONAL', impacto: 'neutra' }, { id: 'cus_neutra' }).cat;
cfg.doc = { regras: [{ id: 'r-neu', termos: ['AJUSTE INTERNO'], sentido: '*', categoria: 'cus_neutra' }, ...regrasSem], categorias: [p1.cat, neu] };
const cn = DFC.consolidar([...base, t('z1', '2026-11-25', -900, 'AJUSTE INTERNO CONTAS'), t('z2', '2026-11-25', 900, 'AJUSTE INTERNO CONTAS', { contaId: 'c2' })], cfg.doc.regras), dn = DFC.demonstrativo(cn);
chk('impacto "Neutra / Transferência": fora de entradas, saídas e do fluxo líquido, mesmo no grupo Operacional', cn.entradas === 150000 - 50000 + 50000 && cn.liquido === 57000 - 20000 + 50000 && cn.porGrupo.OPERACIONAL.liquido === 57000 && DFC.neutra(DFC.cat('cus_neutra')) && cn.transferencias === 20000 + 1800, [cn.entradas, cn.liquido, cn.transferencias]);
chk('categoria neutra aparece só nas movimentações neutras (nunca como linha do bloco Operacional) e conta no volume neutro', dn.neutras.some(x => x.id === 'cus_neutra' && x.n === 2) && !dn.blocos.find(x => x.grupo === 'OPERACIONAL').linhas.some(x => x.id === 'cus_neutra'));
chk('categoria neutra não gera o bloco Não Operacional por si só', (() => { cfg.doc = { regras: regrasSem, categorias: [neu] }; return DFC.demonstrativo(DFC.consolidar(base, regrasSem)).blocos.find(x => x.grupo === 'NAO_OPERACIONAL').visivel === false; })());
cfg.doc = { regras: regrasCom, mapaFCX: {}, categorias: [p1.cat] };
const ctx = (alt = {}) => ({ regras: regrasCom, mapaFCX: {}, transacoes: base, ...alt });
const e1 = DFC.podeExcluir('cus_nao_op', ctx());
chk('exclusão bloqueada: categoria vinculada a uma regra → aviso amigável com a contagem', !e1.ok && e1.vinculos.regras === 1 && /Saídas não operacionais/.test(e1.motivo) && /1 regra de classificação/.test(e1.motivo), e1);
const e2 = DFC.podeExcluir('cus_nao_op', ctx({ regras: regrasSem, transacoes: [...base, t('m1', '2026-11-01', -5, 'X', { cat: 'cus_nao_op' }), t('m2', '2026-11-02', -5, 'Y', { cat: 'cus_nao_op' })] }));
chk('exclusão bloqueada: categoria com lançamentos reclassificados manualmente', !e2.ok && e2.vinculos.lancamentos === 2 && /2 lançamentos reclassificados manualmente/.test(e2.motivo), e2);
const e3 = DFC.podeExcluir('cus_nao_op', ctx({ regras: regrasSem, mapaFCX: { '4.10.01 – ALUGUEL': 'cus_nao_op' } }));
chk('exclusão bloqueada: categoria usada no De-para FCX → DFC', !e3.ok && e3.vinculos.mapa === 1 && /De-para/.test(e3.motivo), e3);
const e4 = DFC.podeExcluir('cus_nao_op', ctx({ regras: regrasSem }));
chk('exclusão liberada: personalizada sem nenhum vínculo', e4.ok === true && e4.vinculos.total === 0, e4);
const e5 = DFC.podeExcluir('pag_fornecedores', ctx({ regras: [], transacoes: [] }));
chk('categoria padrão nunca é excluída (nem sem vínculos): fica como base do sistema', !e5.ok && e5.padrao === true && /padrão do sistema/.test(e5.motivo), e5);
chk('categoria inexistente: recusa com mensagem', DFC.podeExcluir('nao_existe', ctx()).ok === false);
chk('vínculos contam regras, De-para e lançamentos de forma independente', JSON.stringify(DFC.vinculos('cus_nao_op', { regras: regrasCom, mapaFCX: { a: 'cus_nao_op', b: 'cus_nao_op', c: 'x' }, transacoes: [{ cat: 'cus_nao_op' }, { cat: 'outra' }] })) === JSON.stringify({ regras: 1, mapa: 2, lancamentos: 1, total: 4 }));

/* ---------- 6 · recurso desligado e dados quebrados ---------- */
const off = montar({ doc: { regras: regrasCom, categorias: [p1.cat] } }, false);
chk('recurso gestao_v1404 desligado: só as 21 padrão (a categoria personalizada some) e a DFC volta ao comportamento anterior', off.DFC.categorias().length === 21 && !off.DFC.cat('cus_nao_op') && off.DFC.consolidar([...base, ...naoOp], regrasCom).porGrupo.OPERACIONAL.liquido === 54800);
cfg.doc = { categorias: [null, 42, {}, { id: 'rec_pix', nome: 'Duplicada da padrão', sentido: 'E', grupo: 'OPERACIONAL' }, { id: 'cus_a', nome: '   ', sentido: 'S' }, { id: 'cus_b', nome: 'Grupo torto', sentido: 'Q', grupo: 'XYZ', impacto: 'qualquer' }, { id: 'cus_b', nome: 'Id repetido', sentido: 'E', grupo: 'INVESTIMENTO' }] };
const lixo = DFC.categorias();
chk('registros quebrados em config/dfc.categorias são ignorados sem erro (id das padrão, nome vazio, id repetido); grupo/sentido/impacto inválidos viram Operacional/Saída/Soma', lixo.length === 22 && DFC.cat('cus_b').grupo === 'OPERACIONAL' && DFC.cat('cus_b').sentido === 'S' && DFC.cat('cus_b').impacto === 'soma' && DFC.cat('cus_b').nome === 'Grupo torto' && DFC.cat('rec_pix').nome === 'PIX recebidos', lixo.map(c => c.id).slice(20));
cfg.doc = { regras: [{ id: 'r-x', termos: ['QUALQUER'], sentido: 'S', categoria: 'cus_apagada' }] };
chk('regra apontando para categoria que não existe mais não quebra a consolidação (cai em "Outras saídas operacionais")', DFC.consolidar([t('q1', '2026-11-01', -100, 'QUALQUER COISA')], cfg.doc.regras).porCategoria.pag_outros?.valor === -100);
cfg.doc = null;
chk('sem documento config/dfc: padrão puro (21 categorias e regras padrão)', DFC.categorias().length === 21 && DFC.regras() === DFC_REGRAS_PADRAO);

/* ---------- 7 · permissões no servidor (config/dfc) ---------- */
const P = await import(path.join(raiz, 'netlify/lib/permissoes.mjs'));
const D = await import(path.join(raiz, 'netlify/lib/documentos.mjs'));
const { NIVEL } = await import(path.join(raiz, 'netlify/lib/regras.mjs'));
const tudo = () => true;
const sess = (usuario, alt = {}) => { const perfil = P.normalizarPerfil(usuario.perfil); return { uid: 'u1', perfil, nivel: perfil === 'MASTER' ? NIVEL.admin : NIVEL.interact, perms: P.permissoesEfetivas(usuario, tudo), trocaPendente: false, ...alt }; };
const master = sess({ perfil: 'MASTER' });
const comRegras = sess({ perfil: 'OPERACIONAL', permissoes: { fcx: 'modificar' } });
const soLer = sess({ perfil: 'OPERACIONAL', permissoes: { fcx: 'ler' } });
const semFcx = sess({ perfil: 'OPERACIONAL', permissoes: { pessoal: 'modificar' } });
const loja = sess({ perfil: 'LOJA', permissoes: { fcx: 'modificar' } });
chk('servidor: Master grava config/dfc (com e sem prefixo de ambiente)', D.podeGravar(master, 'config/dfc') && D.podeGravar(master, 'amb/homolog/config/dfc'));
chk('servidor: perfil Operacional com "Regras de classificação" (fcx.dfc.regras) grava config/dfc — onde ficam as categorias, as regras e o De-para', comRegras.perms.has('fcx.dfc.regras') && D.podeGravar(comRegras, 'config/dfc') && D.podeGravar(comRegras, 'amb/homolog/config/dfc'), [...comRegras.perms].filter(x => x.startsWith('fcx')));
chk('servidor: o mesmo perfil continua gravando a base mensal dfc/AAAA-MM (recalculada após criar/editar categoria)', D.podeGravar(comRegras, 'dfc/2026-11'));
chk('servidor: com permissão só de leitura do FCX, não grava config/dfc (e lê normalmente)', !soLer.perms.has('fcx.dfc.regras') && !D.podeGravar(soLer, 'config/dfc') && D.podeLer(soLer, 'config/dfc'), [...soLer.perms].filter(x => x.startsWith('fcx')));
chk('servidor: sem permissões do módulo FCX/DFC, não grava config/dfc', !D.podeGravar(semFcx, 'config/dfc'));
chk('servidor: a exceção vale só para o documento config/dfc — o resto da coleção config segue só do Master', !D.podeGravar(comRegras, 'config/fcx_saldos') && !D.podeGravar(comRegras, 'config/ieo') && !D.podeGravar(comRegras, 'config/sistema_parametros') && !D.podeGravar(comRegras, 'amb/homolog/config/ieo') && D.podeGravar(master, 'config/ieo'));
chk('servidor: um documento de nome parecido não herda a exceção (config/dfc2, config/dfc/extra)', !D.podeGravar(comRegras, 'config/dfc2') && !P.acessoPorMatriz(comRegras, 'config/dfc2', 'w'));
chk('servidor: excluir config/dfc só o Master (quem tem Regras de classificação não apaga o documento)', P.exclusaoPermitida(master, 'config/dfc') === true && P.exclusaoPermitida(comRegras, 'config/dfc') === false && P.exclusaoPermitida(comRegras, 'amb/homolog/config/dfc') === false);
chk('servidor: perfil Loja nunca grava config/dfc, mesmo com a flag', !D.podeGravar(loja, 'config/dfc'));
chk('servidor: troca de senha pendente bloqueia (só o próprio login)', !D.podeGravar({ ...comRegras, trocaPendente: true }, 'config/dfc'));
chk('servidor: sem sessão não grava', !D.podeGravar(null, 'config/dfc'));

console.log(`\n${OK.length} ok, ${FAIL.length} falha(s)`);
if (FAIL.length) { console.log('FALHAS:\n - ' + FAIL.join('\n - ')); process.exit(1); }
