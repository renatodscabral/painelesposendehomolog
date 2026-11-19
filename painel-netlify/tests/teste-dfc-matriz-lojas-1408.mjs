/* v14.08 · Empresa Matriz no CADASTRO DE LOJAS × contas bancárias padrão da Matriz × Resumo Executivo Oficial da DFC (padrão banco / PDF A4).
   Valida o CÓDIGO REAL do painel (public/index.html: objeto DFC, os motores DFC_RESUMO e DFC_MATRIZ) num contexto isolado do Node, sem navegador e sem banco,
   com lojas, empresas, contas, extratos e lançamentos FICTÍCIOS (LGPD; os CNPJ de exemplo são gerados aqui pelos dígitos verificadores):
   1) a Matriz é a loja marcada na ficha (uma só, ativa), com Razão Social, CNPJ e "Contas Bancárias Padrão da Matriz" gravados na própria loja;
   2) retrocompatibilidade: a Matriz da v14.07 (config/empresas) é aproveitada sem perda — vínculo pelo CNPJ, contas padrão herdadas, apelidos de titular;
   3) ficha da loja: abertura (sugestão herdada), validações para ser Matriz, "só uma Matriz" (desmarca a anterior), desmarcar limpa as contas, não cancela a v14.07 por acaso;
   4) conta bancária × Matriz: onde gravar o checkbox "Conta padrão da Empresa Matriz" (loja, migração ou legado) e a conta excluída;
   5) emissor do Resumo = SÓ a Matriz do Cadastro de Lojas (cartão Razão Social + CNPJ, bloqueios) e abertura do modal em branco com as contas padrão aplicadas;
   6) documento A4: descrições internas das contas OCULTAS por padrão no Quadro 1, na identificação e nos avisos; EXIBIDAS (como na v14.07) quando marcado;
   7) neutralidade white-label (Falco sem lojas/empresas pré-cadastradas) e a v14.07 intacta (textos e saídas sem a opção).
   Uso: node tests/teste-dfc-matriz-lojas-1408.mjs */
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
const r2 = n => Math.round(n * 100) / 100, brl = n => R.brl(n), fmt = M.fmtCnpj.bind(M);
const ruim = c => c.slice(0, 13) + (c.endsWith('0') ? '1' : '0'); // mesmo prefixo, dígito verificador errado

/* ---------- contas e lojas fictícias ---------- */
const CONTAS = [
  { id: 'cb1', apelido: 'EMPRESA TESTE - CONTAS A PAGAR', banco: '033', bancoNome: 'Santander', agencia: '1111', conta: '2222222', digito: '3', ativa: true },
  { id: 'cb2', apelido: 'FILIAL TESTE - NÃO OPERACIONAL', banco: '341', bancoNome: 'Itaú', agencia: '4444', conta: '5555555', digito: '6', ativa: true, titularEmpresaId: 'emp-a' },
  { id: 'cb3', apelido: 'COBRANÇA (CONTAS A RECEBER)', banco: '237', bancoNome: 'Bradesco', agencia: '7777', conta: '8888888', digito: '9', ativa: true, titularCnpj: CNPJ_B },
  { id: 'cb4', apelido: 'Conta antiga <inativa>', banco: '104', bancoNome: 'Caixa', agencia: '0004', conta: '99999', digito: '', ativa: false },
];
const LJ = (o = {}) => ({ id: 'L01', codigo: '01', nome: 'Loja Centro Teste', cnpj: fmt(CNPJ_A), ativa: true, ...o });
const MATRIZ_L = LJ({ nomeFantasia: 'Teste Matriz', razaoSocial: 'Comércio Teste Ltda', matriz: true, contasPadraoMatriz: ['cb1', ' cb2 ', 'cb1', '', null] });
const FILIAL = LJ({ id: 'L02', codigo: '02', nome: 'Loja Filial Teste', cnpj: fmt(CNPJ_FILIAL) });
const LOJAS = [MATRIZ_L, FILIAL, LJ({ id: 'L03', codigo: '03', nome: 'Loja Inativa Teste', cnpj: fmt(CNPJ_C), ativa: false, matriz: true })];

/* ---------- 1 · a Matriz mora na ficha da loja ---------- */
const mv = M.matrizDeLojas08(LOJAS);
chk('Matriz = a loja marcada e ATIVA; uma loja inativa marcada como Matriz não vale', mv && mv.id === 'L01' && M.matrizDeLojas08([LOJAS[2]]) === null && M.matrizDeLojas08([FILIAL]) === null && M.matrizDeLojas08(null) === null && M.matrizDeLojas08([]) === null);
const dupl = [LJ({ id: 'L09', codigo: '09', matriz: true, nome: 'Nove' }), LJ({ id: 'L05', codigo: '05', matriz: true, nome: 'Cinco' }), LJ({ id: 'L10', codigo: '10', matriz: true, nome: 'Dez' })];
chk('com duas ou mais marcadas (dado inconsistente) vale a de menor código e as outras são apontadas como duplicadas', M.matrizDeLojas08(dupl).id === 'L05' && M.problemasMatriz08(dupl).duplicadas.join() === 'L09,L10' && M.problemasMatriz08(LOJAS).inativas.join() === 'L03' && M.problemasMatriz08(LOJAS).duplicadas.length === 0, M.problemasMatriz08(dupl));
const eL = M.entidadeDeLoja08(MATRIZ_L);
chk('loja → empresa: nome fantasia, razão social, CNPJ só dígitos, contas padrão únicas e sem vazios, origem "loja"', eL.nome === 'Teste Matriz' && eL.razao === 'Comércio Teste Ltda' && eL.cnpj === CNPJ_A && eL.contasPadrao.join() === 'cb1,cb2' && eL.origem === 'loja' && eL.matriz === true && eL.id === 'loja:L01' && eL.lojaId === 'L01' && eL.contasHerdadas === false, eL);
chk('loja sem nome fantasia usa o nome da loja; sem razão social própria usa a da consulta à Receita; sem nada, razão vazia (nunca inventa)', M.entidadeDeLoja08(LJ({ matriz: true })).nome === 'Loja Centro Teste' && M.entidadeDeLoja08(LJ({ matriz: true, receita: { razaoSocial: 'Razão da Receita SA' } })).razao === 'Razão da Receita SA' && M.entidadeDeLoja08(LJ({ matriz: true })).razao === '' && M.entidadeDeLoja08(null) === null && M.entidadeDeLoja08({ nome: 'sem id' }) === null);
const R1 = M.resolverMatriz({ lojas: LOJAS, empresas: [] });
chk('resolverMatriz: com a loja marcada a Matriz vem do Cadastro de Lojas (origem "loja") com as contas padrão da própria loja', R1.origem === 'loja' && R1.loja.id === 'L01' && R1.matriz.contasPadrao.join() === 'cb1,cb2' && R1.legado === null, R1);
chk('sem loja marcada e sem cadastro de empresas: nenhuma Matriz (nada pré-cadastrado)', M.resolverMatriz({ lojas: [FILIAL], empresas: [] }).origem === 'nenhuma' && M.resolverMatriz({}).origem === 'nenhuma' && M.resolverMatriz({ lojas: null, empresas: null }).matriz === null);

/* ---------- 2 · retrocompatibilidade com a Matriz da v14.07 (config/empresas) ---------- */
const LEG = [{ id: 'emp-a', nome: 'Empresa Teste', razao: 'Comércio Teste Ltda', cnpj: fmt(CNPJ_A), matriz: true, contasPadrao: ['cb1', 'cb3'] }, { id: 'emp-b', nome: 'Empresa Outra', razao: 'Outra Ltda', cnpj: CNPJ_B }];
const SEM = [LJ({ nome: 'Loja Centro Teste' }), FILIAL];
const Rl = M.resolverMatriz({ lojas: SEM, empresas: LEG });
chk('v14.07: a Matriz gravada em config/empresas continua valendo (origem "legado") com Razão Social, CNPJ e contas padrão — sem perda, sem nenhuma ação', Rl.origem === 'legado' && Rl.matriz.nome === 'Empresa Teste' && Rl.matriz.razao === 'Comércio Teste Ltda' && Rl.matriz.cnpj === CNPJ_A && Rl.matriz.contasPadrao.join() === 'cb1,cb3', Rl);
chk('…e a loja de mesmo CNPJ é apontada como candidata a receber a Matriz (atalho da ficha); sem loja de mesmo CNPJ não há candidata', Rl.candidata && Rl.candidata.id === 'L01' && M.resolverMatriz({ lojas: [FILIAL], empresas: LEG }).candidata === null && M.resolverMatriz({ lojas: [FILIAL], empresas: LEG }).origem === 'legado');
chk('v14.07: as empresas de exemplo (não gravadas) nunca contam como Matriz', M.resolverMatriz({ lojas: SEM, empresas: M.base([], { padrao: [{ id: 'resilienza', nome: 'Resilienza' }, { id: 'mar-aberto', nome: 'Mar Aberto' }] }) }).origem === 'nenhuma');
const pf = M.prefillMatrizLoja08(SEM[0], { lojas: SEM, empresas: LEG });
chk('ficha da loja de mesmo CNPJ abre MARCADA como Matriz, com as contas padrão da v14.07 já marcadas e sugerida/herdada (para consolidar ao salvar)', pf.matriz === true && pf.sugerida === true && pf.herdada === true && pf.contas.join() === 'cb1,cb3', pf);
chk('…a razão social vem sugerida da v14.07 só quando a ficha está sem razão; a filial (CNPJ diferente) abre sem Matriz', pf.razaoSugerida === 'Comércio Teste Ltda' && M.prefillMatrizLoja08(LJ({ razaoSocial: 'Já preenchida' }), { lojas: SEM, empresas: LEG }).razaoSugerida === '' && M.prefillMatrizLoja08(FILIAL, { lojas: SEM, empresas: LEG }).matriz === false);
const flag = LJ({ matriz: true }), Rf = M.resolverMatriz({ lojas: [flag, FILIAL], empresas: LEG });
chk('loja marcada SEM contasPadraoMatriz próprias herda as contas da Matriz da v14.07 (mesmo CNPJ), marcadas como herdadas', Rf.origem === 'loja' && Rf.matriz.contasPadrao.join() === 'cb1,cb3' && Rf.matriz.contasHerdadas === true && Rf.matriz.aliases.join() === 'emp-a', Rf.matriz);
chk('…com contasPadraoMatriz gravadas (mesmo vazias) a loja manda: as da v14.07 deixam de valer', M.resolverMatriz({ lojas: [LJ({ matriz: true, contasPadraoMatriz: ['cb2'] })], empresas: LEG }).matriz.contasPadrao.join() === 'cb2' && M.resolverMatriz({ lojas: [LJ({ matriz: true, contasPadraoMatriz: [] })], empresas: LEG }).matriz.contasPadrao.length === 0);
chk('editar uma loja comum (sem decisão sobre a Matriz) não cancela a Matriz da v14.07; desmarcar DE PROPÓSITO a loja da Matriz (matriz:false) cancela', M.resolverMatriz({ lojas: [SEM[0], LJ({ id: 'L02', codigo: '02', cnpj: fmt(CNPJ_FILIAL), matriz: false })], empresas: LEG }).origem === 'legado' && M.resolverMatriz({ lojas: [LJ({ matriz: false }), FILIAL], empresas: LEG }).origem === 'nenhuma');
const ET = M.ordenar(M.entidadesTitular08({ lojas: [flag, FILIAL], empresas: LEG }));
chk('titulares de conta: a Matriz do Cadastro de Lojas no topo UMA vez (a empresa de mesmo CNPJ vira apelido) + as demais empresas do cadastro, sem Matriz duplicada', ET.length === 2 && ET[0].id === 'loja:L01' && ET[0].matriz === true && ET[0].aliases.includes('emp-a') && ET[1].id === 'emp-b' && ET.filter(e => e.matriz).length === 1, ET);
const kAlias = { id: 'cbX', banco: '001', agencia: '1', conta: '1', titularEmpresaId: 'emp-a' };
chk('conta cujo titular foi salvo com o id antigo da empresa (emp-a) continua mostrando a Matriz e o CNPJ dela (apelido de id), e a divergência de raiz de CNPJ também enxerga o apelido', M.titularRotulo(kAlias, ET) === `Loja Centro Teste · ${fmt(CNPJ_A)}` && M.titularesDivergentes(['cbX'], [kAlias], CNPJ_B, ET).join() === 'cbX' && M.titularesDivergentes(['cbX'], [kAlias], CNPJ_FILIAL, ET).length === 0, M.titularRotulo(kAlias, ET));
chk('sem Matriz no Cadastro de Lojas as empresas titulares são exatamente as da v14.07 (cadastro de empresas) e a Matriz legada segue no topo', JSON.stringify(M.entidadesTitular08({ lojas: SEM, empresas: LEG }).map(e => [e.id, e.matriz])) === JSON.stringify([['emp-a', true], ['emp-b', false]]));

/* ---------- 3 · ficha da loja: validações e gravação ---------- */
chk('ficha: loja comum não tem erro de Matriz; loja Matriz correta também não', M.validarMatrizLoja08(FILIAL).length === 0 && M.validarMatrizLoja08(MATRIZ_L).length === 0 && M.validarMatrizLoja08(null).length === 0);
chk('ficha: Matriz INATIVA é recusada', M.validarMatrizLoja08({ ...MATRIZ_L, ativa: false }).some(x => /inativa/.test(x)));
chk('ficha: Matriz sem CNPJ ou com dígito errado é recusada (é o CNPJ oficial do documento)', M.validarMatrizLoja08({ ...MATRIZ_L, cnpj: '' }).some(x => /CNPJ válido/.test(x)) && M.validarMatrizLoja08({ ...MATRIZ_L, cnpj: ruim(CNPJ_A) }).some(x => /CNPJ válido/.test(x)));
chk('ficha: Matriz sem Razão Social é recusada; a razão consultada na Receita vale', M.validarMatrizLoja08({ ...MATRIZ_L, razaoSocial: ' ' }).some(x => /Razão Social/.test(x)) && M.validarMatrizLoja08({ ...MATRIZ_L, razaoSocial: '', receita: { razaoSocial: 'Da Receita' } }).length === 0);
const sv1 = M.aplicarMatrizLoja08([MATRIZ_L, FILIAL], { ...FILIAL, matriz: true, contasPadraoMatriz: ['cb3', 'cb3', '', 'cb4'] }, FILIAL);
chk('marcar outra unidade como Matriz desmarca a anterior (só UMA Matriz por ambiente), limpa as contas dela e informa o nome', sv1.loja.matriz === true && sv1.loja.contasPadraoMatriz.join() === 'cb3,cb4' && sv1.outras.length === 1 && sv1.outras[0].id === 'L01' && sv1.outras[0].matriz === false && sv1.outras[0].contasPadraoMatriz.length === 0 && sv1.desmarcou === 'Teste Matriz', sv1);
const sv2 = M.aplicarMatrizLoja08([MATRIZ_L, FILIAL], { ...MATRIZ_L, contasPadraoMatriz: ['cb1'] }, MATRIZ_L);
chk('regravar a mesma Matriz não desmarca ninguém e troca as contas padrão', sv2.outras.length === 0 && sv2.desmarcou === null && sv2.loja.contasPadraoMatriz.join() === 'cb1');
const sv3 = M.aplicarMatrizLoja08([MATRIZ_L, FILIAL], { ...MATRIZ_L, matriz: false, contasPadraoMatriz: ['cb1', 'cb2'] }, MATRIZ_L);
chk('desmarcar a Matriz grava a decisão (matriz:false), LIMPA as contas padrão e não mexe nas outras lojas', sv3.loja.matriz === false && sv3.loja.contasPadraoMatriz.length === 0 && sv3.outras.length === 0);
const sv4 = M.aplicarMatrizLoja08([MATRIZ_L, FILIAL], { ...FILIAL, matriz: false, observacao: 'x' }, FILIAL);
chk('salvar uma loja comum NÃO deixa marca nenhuma (nem matriz:false nem contasPadraoMatriz): não cancela a Matriz da v14.07 por acaso', !('matriz' in sv4.loja) && !('contasPadraoMatriz' in sv4.loja) && sv4.loja.observacao === 'x' && sv4.outras.length === 0);
chk('loja que já tinha decisão explícita (matriz:false) mantém matriz:false ao ser regravada desmarcada', M.aplicarMatrizLoja08([], { ...FILIAL, matriz: false }, { ...FILIAL, matriz: false }).loja.matriz === false);
const pfo = M.prefillMatrizLoja08(FILIAL, { lojas: LOJAS, empresas: [] });
chk('ficha de outra unidade avisa quem é a Matriz hoje (marcar esta a desmarca); a própria Matriz abre marcada com as contas padrão', pfo.matriz === false && pfo.outraMatriz && pfo.outraMatriz.id === 'L01' && pfo.outraMatriz.nome === 'Teste Matriz' && M.prefillMatrizLoja08(MATRIZ_L, { lojas: LOJAS, empresas: [] }).matriz === true && M.prefillMatrizLoja08(MATRIZ_L, { lojas: LOJAS, empresas: [] }).contas.join() === 'cb1,cb2' && M.prefillMatrizLoja08(MATRIZ_L, { lojas: LOJAS, empresas: [] }).outraMatriz === null);

/* ---------- 4 · conta bancária × Matriz ---------- */
chk('checkbox "Conta padrão da Empresa Matriz" com a Matriz na loja: grava nas contas padrão da LOJA (sem migração)', JSON.stringify(M.planoPadrao08(R1, 'cb3', true)) === JSON.stringify({ alvo: 'loja', lojaId: 'L01', contas: ['cb1', 'cb2', 'cb3'], migrar: false }) && JSON.stringify(M.planoPadrao08(R1, 'cb1', false)) === JSON.stringify({ alvo: 'loja', lojaId: 'L01', contas: ['cb2'], migrar: false }));
chk('…sem mudança (já era padrão / já não era) não grava nada; sem Matriz também não', M.planoPadrao08(R1, 'cb1', true).alvo === 'nenhum' && M.planoPadrao08(R1, 'cb9', false).alvo === 'nenhum' && M.planoPadrao08(M.resolverMatriz({}), 'cb1', true).alvo === 'nenhum' && M.planoPadrao08(R1, '', true).alvo === 'nenhum');
const pl = M.planoPadrao08(Rl, 'cb2', true);
chk('Matriz ainda só na v14.07 com loja de mesmo CNPJ: o vínculo MIGRA para a loja (marca a Matriz e leva as contas da v14.07 + a nova)', pl.alvo === 'loja' && pl.lojaId === 'L01' && pl.migrar === true && pl.contas.join() === 'cb1,cb3,cb2', pl);
chk('Matriz da v14.07 sem loja de mesmo CNPJ: segue gravando em config/empresas (nada se perde)', M.planoPadrao08(M.resolverMatriz({ lojas: [FILIAL], empresas: LEG }), 'cb2', true).alvo === 'legado');
const mg = M.migrarLegado08(SEM[0], Rl.matriz), mg2 = M.migrarLegado08({ ...SEM[0], razaoSocial: 'Própria Ltda' }, Rl.matriz, ['cb1', 'cb2', 'cb1', '']);
chk('migração da Matriz da v14.07 para a loja: marca a loja, leva as contas padrão e a razão social (só se a ficha não tiver a sua) — e a loja passa a valer sozinha', mg.matriz === true && mg.contasPadraoMatriz.join() === 'cb1,cb3' && mg.razaoSocial === 'Comércio Teste Ltda' && mg2.razaoSocial === 'Própria Ltda' && mg2.contasPadraoMatriz.join() === 'cb1,cb2' && M.resolverMatriz({ lojas: [mg, FILIAL], empresas: LEG }).origem === 'loja' && M.resolverMatriz({ lojas: [mg, FILIAL], empresas: LEG }).matriz.contasPadrao.join() === 'cb1,cb3' && M.validarEmissor08(M.resolverMatriz({ lojas: [mg, FILIAL], empresas: LEG })).length === 0 && !('matriz' in SEM[0]));
chk('conta excluída: sai das contas padrão da Matriz (só das lojas que a tinham)', JSON.stringify(M.lojasSemConta08([LJ({ matriz: true, contasPadraoMatriz: ['cb1', 'cb2'] }), FILIAL], 'cb1')) === JSON.stringify([{ id: 'L01', contasPadraoMatriz: ['cb2'] }]), M.lojasSemConta08([MATRIZ_L, FILIAL], 'cb1'));
chk('…lojas sem a conta e sem contasPadraoMatriz não são regravadas', M.lojasSemConta08([FILIAL], 'cb1').length === 0 && M.lojasSemConta08([MATRIZ_L], 'cb9').length === 0 && M.lojasSemConta08(null, 'cb1').length === 0);

/* ---------- 5 · emissor do Resumo = a Matriz do Cadastro de Lojas ---------- */
const card = M.cartaoEmissor08(R1);
chk('cartão do emissor: Razão Social e CNPJ oficial formatado da Matriz, código da unidade e atalho "Editar Matriz no Cadastro de Lojas"', card.estado === 'ok' && card.razao === 'Comércio Teste Ltda' && card.cnpj === fmt(CNPJ_A) && card.codigo === '01' && card.lojaId === 'L01' && card.atalho === 'Editar Matriz no Cadastro de Lojas' && card.erros.length === 0 && card.nota === '', card);
const cardL = M.cartaoEmissor08(Rl);
chk('Matriz herdada da v14.07: cartão válido com a nota para consolidar na ficha e o atalho abre a loja candidata', cardL.estado === 'ok' && cardL.lojaId === 'L01' && /consolidá-la no Cadastro de Lojas/.test(cardL.nota) && cardL.origem === 'legado');
const cardV = M.cartaoEmissor08(M.resolverMatriz({ lojas: [FILIAL], empresas: [] }));
chk('sem Matriz: cartão vazio com o bloqueio claro apontando o Cadastro de Lojas (não há emissor livre) e o atalho para defini-la', cardV.estado === 'vazio' && cardV.erros.length === 1 && /Cadastro de Lojas/.test(cardV.erros[0]) && /Esta unidade é a Empresa Matriz/.test(cardV.erros[0]) && /Definir a Matriz/.test(cardV.atalho));
const rSemRazao = M.resolverMatriz({ lojas: [LJ({ matriz: true })], empresas: [] }), rCnpj = M.resolverMatriz({ lojas: [LJ({ matriz: true, razaoSocial: 'X Ltda', cnpj: fmt(ruim(CNPJ_A)) })], empresas: [] });
chk('Matriz sem Razão Social ou com CNPJ inválido: emissão bloqueada com a causa certa (cartão "incompleto")', M.validarEmissor08(rSemRazao).join().includes('Razão Social') && M.cartaoEmissor08(rSemRazao).estado === 'incompleto' && M.validarEmissor08(rCnpj).join().includes('CNPJ') && M.validarEmissor08(R1).length === 0 && M.validarEmissor08(M.resolverMatriz({})).length === 1);
const e0 = M.resolverEscopo08({ matriz: R1.matriz, selecionadas: [], contas: CONTAS });
chk('em branco + Matriz com contas padrão: escopo "padrão" com as contas da Matriz na ordem do cadastro, texto citando a Empresa Matriz e o Cadastro de Lojas, sem alerta', e0.modo === 'padrao' && e0.ids.join() === 'cb1,cb2' && e0.n === 2 && !e0.alerta && /2 contas padrão da Empresa Matriz \(Teste Matriz\), definidas no Cadastro de Lojas/.test(e0.texto) && e0.marcadas.length === 0, e0);
chk('conta marcada à mão: vale estritamente a seleção (a Matriz não interfere) e fica registrada como marcada', (() => { const e = M.resolverEscopo08({ matriz: R1.matriz, selecionadas: ['cb3'], contas: CONTAS }); return e.modo === 'manual' && e.ids.join() === 'cb3' && e.marcadas.join() === 'cb3'; })());
const eSP = M.resolverEscopo08({ matriz: M.entidadeDeLoja08(LJ({ matriz: true, razaoSocial: 'X Ltda', contasPadraoMatriz: [] })), selecionadas: [], contas: CONTAS }), eSM = M.resolverEscopo08({ matriz: null, selecionadas: [], contas: CONTAS });
chk('Matriz sem contas padrão: alerta pedindo marcar contas ou vincular na ficha da Matriz (Gestão de Lojas); sem Matriz: alerta de Matriz não definida; ambos bloqueiam a emissão', eSP.modo === 'sem_padrao' && /ficha da Matriz \(Gestão de Lojas\)/.test(eSP.alerta) && M.validarEscopo(eSP).length === 1 && eSM.modo === 'sem_padrao' && eSM.alerta === M.MSG08.SEM_MATRIZ && M.validarEscopo(eSM).length === 1);
chk('vínculos vazios apontando para contas removidas: o alerta informa e as órfãs aparecem', (() => { const e = M.resolverEscopo08({ matriz: M.entidadeDeLoja08(LJ({ matriz: true, razaoSocial: 'X', contasPadraoMatriz: ['cbX', 'cbY'] })), selecionadas: [], contas: CONTAS }); return e.modo === 'sem_padrao' && e.orfas.length === 2 && /removidas/.test(e.alerta); })());
const ab = M.modeloAbertura08({ matriz: R1.matriz, contas: CONTAS });
chk('abertura do modal: seletor EM BRANCO (nenhuma conta marcada) e as contas padrão da Matriz já aplicadas automaticamente (cb1 e cb2), em ordem de cadastro', ab.marcadas.length === 0 && ab.padrao.join() === 'cb1,cb2' && ab.modo === 'padrao' && ab.n === 2 && !ab.alerta, ab);
chk('abertura sem Matriz ou sem contas padrão: também em branco, com o alerta (nunca marca contas por conta própria)', M.modeloAbertura08({ matriz: null, contas: CONTAS }).marcadas.length === 0 && M.modeloAbertura08({ matriz: null, contas: CONTAS }).padrao.length === 0 && M.modeloAbertura08({ matriz: null, contas: CONTAS }).alerta === M.MSG08.SEM_MATRIZ && M.modeloAbertura08({ matriz: eSP && M.entidadeDeLoja08(LJ({ matriz: true, contasPadraoMatriz: [] })), contas: CONTAS }).modo === 'sem_padrao');
chk('abertura sem contas cadastradas na DFC: alerta de cadastrar ao menos uma conta', M.modeloAbertura08({ matriz: R1.matriz, contas: [] }).modo === 'sem_contas' && /cadastre ao menos uma conta/.test(M.modeloAbertura08({ matriz: R1.matriz, contas: [] }).alerta));
const ET2 = M.ordenar(M.entidadesTitular08({ lojas: LOJAS, empresas: LEG }));
chk('selos do modal: a conta padrão da Matriz aparece como "Padrão da Matriz"; o titular salvo com o id antigo da empresa resolve pela Matriz; conta fora do padrão não tem o selo', (() => { const v = (k, emp) => M.vinculos(k, emp, ET2).map(x => x.txt).join(' | '); return ET2[0].id === 'loja:L01' && v(CONTAS[0], R1.matriz).includes('Padrão da Matriz') && v(CONTAS[1], R1.matriz).includes('Titular: Teste Matriz') && !v(CONTAS[2], R1.matriz).includes('Padrão da Matriz') && v(CONTAS[3], R1.matriz).includes('Inativa'); })());

/* ---------- 6 · documento A4: descrições das contas ---------- */
const MES = '2026-10', ANT = '2026-09', pm = R.periodo('mes', MES);
cfg.doc = { regras: [...DFC_REGRAS_PADRAO], categorias: [] };
let seq = 0;
const tx = (data, valor, hist, contaId) => ({ id: 't' + (++seq), data, valor, hist, contaId, tipo: valor >= 0 ? 'CREDIT' : 'DEBIT' });
const T1 = [tx('2026-10-02', 50000, 'GETNET LIQUIDACAO', 'cb1'), tx('2026-10-06', -20000, 'PAG TIT ALPARGATAS', 'cb1'), tx('2026-10-08', -2500, 'ALUGUEL LOJA 01', 'cb1'), tx('2026-10-03', 8000, 'PIX RECEB VENDA', 'cb2'), tx('2026-10-11', -3000, 'NEOENERGIA PE', 'cb2'), tx('2026-10-04', 20000, 'PIX RECEB VENDA', 'cb3')];
const soma = id => r2(T1.filter(t => t.contaId === id).reduce((a, t) => a + t.valor, 0));
const ini = { cb1: 10000, cb2: 5000, cb3: 2000 };
const ext = (contaId, mes, valor, data) => ({ contaId, mes, saldo: { valor, data } });
const EXT = [...['cb1', 'cb2', 'cb3'].map(id => ext(id, ANT, ini[id], '2026-09-30')), ...['cb1', 'cb2'].map(id => ext(id, MES, r2(ini[id] + soma(id)), '2026-10-31'))]; // cb3 sem saldo final: gera aviso com o rótulo da conta
const INF = CONTAS.map(k => M.infoConta(k));
const rotuloComDesc = k => `${k.apelido} · ${M.infoConta(k).agConta}`, rotuloSemDesc = k => `${M.infoConta(k).banco} · ${M.infoConta(k).agConta}`;
const cad = f => CONTAS.map(k => ({ id: k.id, rotulo: f(k), ...M.infoConta(k) }));
const base = (o = {}) => ({ periodo: pm, transacoes: T1, contas: cad(rotuloComDesc), extratos: EXT, saldoManualInicial: null, previstoPorMes: null, mascarar: false, ...o });
const sig = [{ nome: 'Fulana de Tal', cargo: 'Gestor Financeiro / Diretoria' }, { nome: 'Beltrano de Tal', cargo: 'Contador Responsável', registro: 'CRC-PE 000000/O-0' }];
const doc = (mod, extra = {}) => R.html(mod, { razao: 'Comércio Teste Ltda', cnpj: CNPJ_A, logo: '', marca: 'Teste', emitidoEm: '13/11/2026, 10:00:00', notas: '', signatarios: sig, ...extra });
const ESC3 = ['cb1', 'cb2', 'cb3'];
const dMatriz = (descricoes, sel = ESC3, mod = null) => { const sc = M.resolverEscopo08({ matriz: R1.matriz, selecionadas: sel, contas: CONTAS }), ds = M.descreverEscopo(sc, INF, R1.matriz, { descricoes }); return doc(mod || R.montar(base({ escopo: sc.ids, contas: cad(descricoes ? rotuloComDesc : rotuloSemDesc) })), { escopoCurto: ds.curto, escopoLongo: ds.longo, descricoes }); };
const DESC = /CONTAS A PAGAR|NÃO OPERACIONAL|CONTAS A RECEBER/;
const hOff = dMatriz(false), hOn = dMatriz(true);
chk('DESMARCADO (padrão): o Quadro 1 mostra na coluna BANCO só código e nome do banco ("033 · Santander") e em AGÊNCIA / CONTA só agência e conta ("Ag 1111 · CC 2222222-3")', hOff.includes('<td>033 · Santander</td><td>Ag 1111 · CC 2222222-3</td>') && hOff.includes('<td>341 · Itaú</td><td>Ag 4444 · CC 5555555-6</td>') && hOff.includes('<td>237 · Bradesco</td><td>Ag 7777 · CC 8888888-9</td>'));
chk('DESMARCADO: nenhuma descrição interna ("CONTAS A PAGAR", "NÃO OPERACIONAL", "CONTAS A RECEBER") em lugar nenhum do documento — Quadro 1, identificação (contas consideradas) e avisos', !DESC.test(hOff) && hOff.includes('Contas bancárias incluídas nesta emissão (3)') && hOff.includes('033 · Santander · Ag 1111 · CC 2222222-3; 341 · Itaú · Ag 4444 · CC 5555555-6; 237 · Bradesco · Ag 7777 · CC 8888888-9'), (hOff.match(DESC) || [])[0]);
chk('DESMARCADO: o aviso de conciliação parcial (conta sem saldo final) cita só banco, agência e conta', /sem saldo final no extrato de: 237 · Bradesco · Ag 7777 · CC 8888888-9/.test(hOff));
chk('MARCADO: a descrição aparece logo abaixo do nome do banco, como na v14.07, e também nas contas consideradas e no aviso', hOn.includes('033 · Santander<div class="sub">EMPRESA TESTE - CONTAS A PAGAR</div>') && hOn.includes('341 · Itaú<div class="sub">FILIAL TESTE - NÃO OPERACIONAL</div>') && hOn.includes('237 · Bradesco<div class="sub">COBRANÇA (CONTAS A RECEBER)</div>') && hOn.includes('033 · Santander · Ag 1111 · CC 2222222-3 (EMPRESA TESTE - CONTAS A PAGAR)') && /sem saldo final no extrato de: COBRANÇA \(CONTAS A RECEBER\)/.test(hOn));
chk('os NÚMEROS não mudam com a opção: mesmos saldos, variação líquida, totais e situação com e sem descrições (só o texto das contas muda)', (() => { const tira = h => h.replace(/<div class="sub">[^<]*<\/div>/g, '').replace(/\(EMPRESA TESTE - CONTAS A PAGAR\)|\(FILIAL TESTE - NÃO OPERACIONAL\)|\(COBRANÇA \(CONTAS A RECEBER\)\)/g, '').replace(/<td>(\d{3} · [^<]+)<\/td>/g, '<td>$1</td>'); const num = h => (h.match(/R\$\s?-?[\d.]+,\d\d/g) || []).join('|'); return num(hOff) === num(hOn) && num(hOff).length > 100 && tira(hOff).length > 0; })());
const hDef = (() => { const sc = M.resolverEscopo08({ matriz: R1.matriz, selecionadas: ESC3, contas: CONTAS }), ds = M.descreverEscopo(sc, INF, R1.matriz); return doc(R.montar(base({ escopo: sc.ids })), { escopoCurto: ds.curto, escopoLongo: ds.longo }); })();
chk('sem informar a opção (v14.07 e quem chama o motor sem ela) o comportamento é o de antes: descrições exibidas', hDef.includes('033 · Santander<div class="sub">EMPRESA TESTE - CONTAS A PAGAR</div>') && hDef.includes('(EMPRESA TESTE - CONTAS A PAGAR)') && M.descreverEscopo(M.resolverEscopo({ empresa: null, selecionadas: ['cb1'], contas: CONTAS }), INF, null).longo === '033 · Santander · Ag 1111 · CC 2222222-3 (EMPRESA TESTE - CONTAS A PAGAR)');
chk('conta SEM descrição: nada a ocultar nem linha vazia nos dois modos', (() => { const sem = [{ ...CONTAS[0], apelido: '' }], i = sem.map(k => M.infoConta(k)); const sc = M.resolverEscopo({ empresa: null, selecionadas: ['cb1'], contas: sem }); return !M.descreverEscopo(sc, i, null).longo.includes('()') && !M.descreverEscopo(sc, i, null, { descricoes: false }).longo.includes('(') && !doc(R.montar(base({ escopo: ['cb1'], contas: sem.map(k => ({ id: k.id, rotulo: 'x', ...M.infoConta(k) })) }))).includes('<div class="sub"></div>'); })());
const xss = [{ id: 'cb1', rotulo: 'x', ...M.infoConta(CONTAS[0]), descricao: '<img src=x onerror=alert(1)>', banco: '033 · <b>Santander</b>', agConta: 'Ag 1 · CC "2"' }];
const hx = doc(R.montar(base({ escopo: ['cb1'], contas: xss })), { descricoes: true });
chk('com a descrição exibida ela é escapada (sem HTML injetado pelo cadastro)', !/<img src=x|<b>Santander<\/b>/.test(hx) && hx.includes('&lt;img src=x onerror=alert(1)&gt;') && hx.includes('CC &quot;2&quot;'));
chk('estrutura do documento intacta com a opção desmarcada: Quadro 1, Quadro 2, assinaturas; sem "undefined"/"NaN"; HTML equilibrado; neutro (sem Esposende)', (() => { const i = ['Quadro 1 —', 'Quadro 2 —', 'class="rx-ass"'].map(s => hOff.indexOf(s)); return i.every(x => x > 0) && i[0] < i[1] && i[1] < i[2] && !/undefined|NaN|\[object/.test(hOff) && (hOff.match(/<table/g) || []).length === (hOff.match(/<\/table>/g) || []).length && (hOff.match(/<tr/g) || []).length === (hOff.match(/<\/tr>/g) || []).length && !/esposende/i.test(hOff); })());
chk('máscara da folha (sem rh.ver_salarios) mantida com a opção desmarcada: sem a linha da folha e sem o valor 8.137,45; com acesso ela aparece', (() => { const T = [...T1, tx('2026-10-07', -8137.45, 'FOLHA PAGAMENTO SALARIO', 'cb1')], EF = EXT.map(x => x.contaId === 'cb1' && x.mes === MES ? ext('cb1', MES, r2(ini.cb1 + soma('cb1') - 8137.45), '2026-10-31') : x); const sc = M.resolverEscopo08({ matriz: R1.matriz, selecionadas: ['cb1'], contas: CONTAS }); const h = mascarar => doc(R.montar(base({ transacoes: T, extratos: EF, escopo: sc.ids, mascarar })), { descricoes: false }); return !h(true).includes('Folha de pagamento') && !h(true).includes('8.137,45') && /detalhe restrito/.test(h(true)) && h(false).includes('8.137,45'); })());
chk('documento SEM escopo (v14.06) continua igual: "Saldos por conta bancária (extratos OFX)" e nenhuma opção de descrições aplicada', (() => { const h = doc(R.montar(base()), { descricoes: false }); return h.includes('Saldos por conta bancária (extratos OFX)') && !h.includes('Contas bancárias incluídas nesta emissão'); })());

/* ---------- 7 · neutralidade white-label e v14.07 intacta ---------- */
const padraoEx = [{ id: 'resilienza', nome: 'Resilienza' }, { id: 'mar-aberto', nome: 'Mar Aberto' }];
chk('Falco: sem lojas e sem empresas gravadas não há Matriz, titulares nem exemplos (nada da Esposende pré-cadastrado)', M.entidadesTitular08({ lojas: [], empresas: [], falco: true, padrao: padraoEx }).length === 0 && M.resolverMatriz({ lojas: [], empresas: [] }).origem === 'nenhuma' && M.cartaoEmissor08(M.resolverMatriz({})).razao === '');
chk('o motor da v14.08 não traz nome, CNPJ nem razão social de nenhuma empresa fixos no código', (() => { const a = html.indexOf('v14.08 · Empresa Matriz no Cadastro de Lojas (Gestão de Lojas)'), b = html.indexOf('/* DFC_MATRIZ:FIM */'); const cod = html.slice(a, b); return a > 0 && b > a && !/esposende|resilienza|mar aberto|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/i.test(cod); })());
chk('v14.07 intacta: resolverEscopo (texto de contas padrão da empresa), vínculos e normalização com apelidos continuam como antes', (() => { const e = M.resolverEscopo({ empresa: { id: 'e', nome: 'Empresa X', matriz: true, contasPadrao: ['cb1'] }, selecionadas: [], contas: CONTAS }); return e.modo === 'padrao' && /1 conta padrão vinculada à Empresa X\./.test(e.texto) && M.normalizar([{ id: 'a', nome: 'A', aliases: ['x'] }])[0].aliases.join() === 'x' && M.base([], { falco: true, padrao: padraoEx }).length === 0 && M.base([], { falco: false, padrao: padraoEx }).length === 2; })());

console.log(`\n${FAIL.length ? 'FALHAS (' + FAIL.length + '):\n - ' + FAIL.join('\n - ') : 'OK (' + OK.length + ' verificações)'}`);
process.exit(FAIL.length ? 1 : 0);
