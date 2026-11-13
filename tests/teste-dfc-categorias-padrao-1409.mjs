/* v14.09 (complemento) · DFC · Categorias PADRÃO com nome e grupo editáveis (ID interno e Sentido travados; exclusão bloqueada).
   Valida o CÓDIGO REAL do painel (public/index.html: objeto DFC, motor DFC_RESUMO, a tabela "Categorias da DFC" e o modal/gravação da categoria padrão) num contexto
   isolado do Node, sem navegador e sem banco, com transações FICTÍCIAS (LGPD):
   1) o ajuste é guardado em config/dfc.ajustesPadrao; DFC_CATEGORIAS (a constante) nunca é alterada e as 21 padrão seguem lá;
   2) renomear (nome saneado, 3 a 60 caracteres, sem repetir nome de outra categoria) e mudar o grupo (Operacional, Investimento, Financiamento, Não Operacional);
   3) ID interno e sentido travados; a transferência entre contas próprias só aceita mudar o nome (o grupo fica fixo e ela continua neutra);
   4) o novo nome/grupo vale em todos os pontos de leitura: categorias(), cat(), seletor por sentido, demonstrativo (tela, PDF, Excel, CSV), consolidação e Resumo Executivo (A4);
   5) as referências seguem pelo ID (regras, De-para FCX → DFC, classificação manual, cadastro de fornecedores) e a exclusão da padrão segue bloqueada;
   6) tabela "Categorias da DFC": lápis nas 21 padrão, lixeira desabilitada, selo "ajustada", personalizadas inalteradas, permissão e recurso desligado;
   7) modal: Nome e Grupo editáveis, ID e Sentido travados, validações, gravação só do que mudou, recálculo da base só quando o grupo muda, "Restaurar original";
   8) recurso gestao_v1409 desligado = nomes e grupos originais, com os ajustes gravados preservados; registros quebrados em ajustesPadrao são ignorados.
   Uso: node tests/teste-dfc-categorias-padrao-1409.mjs */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(raiz, 'public/index.html'), 'utf8');
const OK = [], FAIL = [];
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x !== '' ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 700) : '')); };

/* ---------- extrai o código real: CSV, leitor OFX e o bloco da DFC (que contém o objeto DFC e o DFC_RESUMO) ---------- */
const corta = (ini, fim) => { const a = html.indexOf(ini), b = html.indexOf(fim, a); if (a < 0 || b < 0) throw new Error('bloco não encontrado: ' + ini); return html.slice(a, b); };
const csvCod = corta('const CSV = {', '/**\n * WhatsApp (camada Util)');
const ofxCod = corta('const OFX = {', '/* ======================= CONTAS (de-para)');
const dfcCod = corta('const DFC_GRUPOS = {', '/* ============================ IEO ============================ */');
const tabCod = corta('  renderCategorias() {', '  /** grava a lista de categorias personalizadas'); // a tabela "Categorias da DFC"
const uiCod = corta('/* ---------- v14.09 (complemento) · categorias padrão da DFC com nome e grupo editáveis ---------- */', '/* v14.06 · DFC · Resumo Executivo Oficial'); // modal + gravação do ajuste
const flags = { g04: true, g09: true, regras: true };
const cfg = { doc: null };
const Repo = { get: (col, id) => col === 'config' && id === 'dfc' ? cfg.doc : null, prontas: new Set(), todos: () => [] };
const motor = new Function('Repo', 'g04', 'g05', 'g09', csvCod + '\n' + ofxCod + '\n' + dfcCod + '\nreturn { DFC, DFC_GRUPOS, DFC_CATEGORIAS, DFC_REGRAS_PADRAO, DFC_RESUMO };')(Repo, () => flags.g04, () => true, () => flags.g09);
const { DFC, DFC_GRUPOS, DFC_CATEGORIAS, DFC_REGRAS_PADRAO, DFC_RESUMO: R } = motor;
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const ORIG = JSON.stringify(DFC_CATEGORIAS);
const limpa = () => { cfg.doc = { regras: DFC_REGRAS_PADRAO.slice(), mapaFCX: {}, categorias: [] }; };
limpa();

/* ---------- 1 · base: nada muda sem ajuste ---------- */
chk('sem ajuste: as 21 padrão com os nomes e grupos originais, nenhuma marcada como ajustada', DFC.categorias().length === 21 && DFC_CATEGORIAS.length === 21 && DFC.categorias().every((c, i) => c.nome === DFC_CATEGORIAS[i].nome && c.grupo === DFC_CATEGORIAS[i].grupo && !c.ajustada), DFC.categorias().length);
chk('config/dfc sem a chave ajustesPadrao é válido (documento antigo)', Object.keys(DFC.ajustesPadrao()).length === 0);

/* ---------- 2 · validação do ajuste (renomear e mudar o grupo) ---------- */
const mk = DFC.cat('pag_marketing');
const v1 = DFC.prepararAjustePadrao('pag_marketing', { nome: '  Publicidade   e  propaganda ', grupo: 'OPERACIONAL' });
chk('renomear: nome saneado (espaços extras), grupo preservado, ajuste = { nome, grupo }', v1.cat && v1.cat.nome === 'Publicidade e propaganda' && v1.cat.grupo === 'OPERACIONAL' && v1.ajuste && v1.ajuste.nome === 'Publicidade e propaganda' && !v1.igual, v1);
chk('o ID interno e o sentido nunca mudam no ajuste (mesmo se o formulário os enviar)', v1.cat.id === 'pag_marketing' && v1.cat.sentido === 'S' && DFC.prepararAjustePadrao('pag_marketing', { nome: 'Publicidade', grupo: 'OPERACIONAL', id: 'outro', sentido: 'E' }).cat.sentido === 'S');
const v2 = DFC.prepararAjustePadrao('pag_marketing', { nome: 'Marketing e publicidade', grupo: 'NAO_OPERACIONAL' });
chk('mudar só o grupo (Operacional → Não Operacional) é válido e mantém o nome original', v2.cat && v2.cat.grupo === 'NAO_OPERACIONAL' && v2.cat.nome === 'Marketing e publicidade' && v2.ajuste && v2.ajuste.grupo === 'NAO_OPERACIONAL', v2);
chk('os 4 grupos são aceitos (Operacional, Investimento, Financiamento, Não Operacional)', DFC.GRUPOS_CAT.every(g => DFC.prepararAjustePadrao('pag_marketing', { nome: 'Marketing e publicidade', grupo: g }).cat?.grupo === g));
const v3 = DFC.prepararAjustePadrao('pag_marketing', { nome: 'Marketing e publicidade', grupo: 'OPERACIONAL' });
chk('nome e grupo iguais aos originais: ajuste nulo (remove o ajuste) e "igual"', v3.igual === true && v3.ajuste === null, v3);
const bad = (id, f) => DFC.prepararAjustePadrao(id, { nome: 'Nome válido', grupo: 'OPERACIONAL', ...f }).erro;
chk('validação: nome vazio, curto (mínimo 3) e longo (máximo 60)', /nome/i.test(bad('pag_marketing', { nome: '' })) && /mínimo/.test(bad('pag_marketing', { nome: 'ab' })) && /60/.test(bad('pag_marketing', { nome: 'x'.repeat(61) })));
chk('validação: grupo precisa ser um dos 4 (não aceita Transferência nem texto livre) nas categorias comuns', /grupo/i.test(bad('pag_marketing', { grupo: 'TRANSFERENCIA' })) && /grupo/i.test(bad('pag_marketing', { grupo: 'XYZ' })) && /grupo/i.test(bad('pag_marketing', { grupo: '' })));
chk('validação: nome já usado por OUTRA categoria padrão é recusado, sem diferenciar maiúsculas e acentos', /Já existe/.test(bad('pag_marketing', { nome: 'PAGAMENTO a FORNECEDORES' })) && /Já existe/.test(bad('pag_marketing', { nome: 'Folha de pagamento e beneficios' })));
chk('validação: o próprio nome (ou só maiúsculas/minúsculas dele) não conta como repetido', !bad('pag_marketing', { nome: 'marketing e PUBLICIDADE' }));
chk('validação: id que não é padrão (ou inexistente) é recusado', /padrão/.test(bad('cus_qualquer', {})) && /padrão/.test(bad('', {})));

/* ---------- 3 · transferência entre contas próprias: só o nome muda ---------- */
const vt = DFC.prepararAjustePadrao('transf', { nome: 'Transferências internas', grupo: 'OPERACIONAL' });
chk('transferência: o grupo enviado é ignorado (fica Transferência) e só o nome muda; sentido segue "ambos"', vt.cat && vt.cat.grupo === 'TRANSFERENCIA' && vt.cat.nome === 'Transferências internas' && vt.cat.sentido === '*' && vt.ajuste.grupo === 'TRANSFERENCIA', vt);
chk('transferência: não exige grupo válido no formulário (ele é travado)', !!DFC.prepararAjustePadrao('transf', { nome: 'Transferências internas' }).cat);

/* ---------- 4 · o ajuste vale em todos os pontos de leitura ---------- */
cfg.doc = { ...cfg.doc, ajustesPadrao: { pag_marketing: { nome: 'Publicidade e propaganda', grupo: 'NAO_OPERACIONAL' }, rec_pix: { nome: 'PIX de clientes', grupo: 'OPERACIONAL' }, transf: { nome: 'Transferências internas', grupo: 'OPERACIONAL' } } };
const mk2 = DFC.cat('pag_marketing');
chk('cat(): devolve o nome e o grupo ajustados, com ajustada, nomeOriginal e grupoOriginal; o ID e o sentido são os mesmos', mk2.nome === 'Publicidade e propaganda' && mk2.grupo === 'NAO_OPERACIONAL' && mk2.id === 'pag_marketing' && mk2.sentido === 'S' && mk2.ajustada === true && mk2.nomeOriginal === 'Marketing e publicidade' && mk2.grupoOriginal === 'OPERACIONAL', mk2);
chk('categorias(): continuam 21 padrão (nenhuma some nem duplica) e as não ajustadas ficam intactas', DFC.categorias().length === 21 && DFC.cat('pag_fornecedores').nome === 'Pagamento a fornecedores' && !DFC.cat('pag_fornecedores').ajustada);
chk('transferência: o ajuste de grupo gravado é IGNORADO (continua Transferência e neutra); o nome ajustado vale', DFC.cat('transf').grupo === 'TRANSFERENCIA' && DFC.neutra(DFC.cat('transf')) && DFC.cat('transf').nome === 'Transferências internas');
chk('DFC_CATEGORIAS (constante) nunca é alterada', JSON.stringify(DFC_CATEGORIAS) === ORIG && DFC_CATEGORIAS.find(c => c.id === 'pag_marketing').nome === 'Marketing e publicidade');
chk('seletor por sentido (regras, Extratos OFX): o nome novo aparece em Saídas e o antigo some; PIX de clientes aparece em Entradas', DFC.porSentido('S').some(c => c.nome === 'Publicidade e propaganda') && !DFC.porSentido('S').some(c => c.nome === 'Marketing e publicidade') && DFC.porSentido('E').some(c => c.nome === 'PIX de clientes'));
const tx = (id, data, valor, hist) => ({ id, data, valor, hist, contaId: 'cb1', tipo: valor >= 0 ? 'CREDIT' : 'DEBIT' });
const T = [tx('a', '2026-10-02', 10000, 'GETNET LIQUIDACAO'), tx('b', '2026-10-03', 2000, 'PIX RECEB CLIENTE'), tx('c', '2026-10-05', -900, 'GOOGLE ADS CAMPANHA'), tx('d', '2026-10-06', -3000, 'PAG TIT ALPARGATAS'), tx('e', '2026-10-07', -500, 'TRANSF ENTRE CONTAS'), tx('f', '2026-10-08', -100, 'MARKETING LOCAL', ), { ...tx('g', '2026-10-09', -250, 'PAGTO DIVERSOS'), cat: 'pag_marketing' }];
const c1 = DFC.consolidar(T), dm = DFC.demonstrativo(c1), blk = g => dm.blocos.find(b => b.grupo === g);
chk('consolidação segue pelo ID: a categoria de marketing recebe as saídas pela regra (GOOGLE ADS, MARKETING) e pela classificação manual', c1.porCategoria.pag_marketing.valor === -1250 && c1.porCategoria.pag_marketing.n === 3, c1.porCategoria.pag_marketing);
chk('grupos: o valor de marketing (-1.250) saiu do Operacional e entrou no Não Operacional; PIX de clientes segue no Operacional', c1.porGrupo.NAO_OPERACIONAL.saidas === 1250 && c1.porGrupo.NAO_OPERACIONAL.liquido === -1250 && c1.porGrupo.OPERACIONAL.liquido === 10000 + 2000 - 3000, c1.porGrupo);
chk('demonstrativo (tela, PDF, Excel e CSV): a linha aparece com o NOME novo dentro do bloco Não Operacional (que passa a ficar visível); o nome antigo não aparece', blk('NAO_OPERACIONAL').visivel && blk('NAO_OPERACIONAL').linhas.some(l => l.id === 'pag_marketing' && l.nome === 'Publicidade e propaganda' && l.valor === -1250) && !dm.blocos.some(b => b.linhas.some(l => l.nome === 'Marketing e publicidade')) && blk('OPERACIONAL').linhas.some(l => l.nome === 'PIX de clientes'), blk('NAO_OPERACIONAL'));
chk('demonstrativo: subtotal do Não Operacional (-1.250) e do Operacional (9.000) separados; a variação líquida (7.750) não inclui a transferência (-500, fora do fluxo)', blk('NAO_OPERACIONAL').subtotal === -1250 && blk('OPERACIONAL').subtotal === 9000 && dm.variacao === 7750 && c1.liquido === 7750, [dm.variacao, c1.liquido, blk('OPERACIONAL').subtotal]);
chk('a transferência segue neutra (fora do fluxo) mesmo com o nome ajustado', dm.neutras.length === 1 && dm.neutras[0].nome === 'Transferências internas' && dm.neutrasTotal === 500, dm.neutras);

/* ---------- 5 · Resumo Executivo Oficial (A4) ---------- */
const pm = R.periodo('mes', '2026-10'), contas = [{ id: 'cb1', rotulo: 'Conta A · Banco Teste 001' }];
const m = R.montar({ periodo: pm, transacoes: T, contas, extratos: [{ contaId: 'cb1', mes: '2026-09', saldo: { valor: 1000, data: '2026-09-30' } }, { contaId: 'cb1', mes: '2026-10', saldo: { valor: 1000 + r2(T.reduce((a, t) => a + t.valor, 0)), data: '2026-10-31' } }], saldoManualInicial: null, previstoPorMes: null, mascarar: false });
const emissor = { razao: 'Empresa Teste Comércio Ltda', cnpj: '12.345.000/0001-95', logo: '', marca: 'Teste', emitidoEm: '13/11/2026 10:30', notas: '', signatarios: [{ nome: 'Fulana de Tal', cargo: 'Gestora Financeira' }] };
const h = R.html(m, emissor);
chk('Resumo Executivo (A4): mostra o NOME ajustado e não o antigo; o bloco Não Operacional aparece com a linha de marketing', /Publicidade e propaganda/.test(h) && !/Marketing e publicidade/.test(h) && /PIX de clientes/.test(h), h.length);
chk('Resumo Executivo: o indicador "não operacional" isolado passa a refletir o grupo ajustado (-1.250), o operacional não o inclui (9.000) e a variação líquida é 7.750', m.indicadores.naoOperacional.liquido === -1250 && m.indicadores.naoOperacional.visivel === true && m.indicadores.operacional.liquido === 9000 && m.indicadores.variacao === 7750, m.indicadores);
chk('Resumo Executivo: sem NaN, Infinity nem undefined no documento', !/NaN|Infinity|undefined/.test(h));

/* ---------- 6 · as referências seguem pelo ID; a exclusão da padrão segue bloqueada ---------- */
cfg.doc = { ...cfg.doc, mapaFCX: { '4.33.01 – Marketing': 'pag_marketing' }, regras: [{ id: 'r-x', termos: ['TESTE'], sentido: 'S', categoria: 'pag_marketing' }] };
chk('De-para FCX → DFC e regras continuam apontando para o ID: a categoria da conta contábil vem com o nome/grupo ajustados', DFC.cat(cfg.doc.mapaFCX['4.33.01 – Marketing']).nome === 'Publicidade e propaganda' && DFC.cat(cfg.doc.regras[0].categoria).grupo === 'NAO_OPERACIONAL');
const vinc = DFC.vinculos('pag_marketing', { regras: cfg.doc.regras, mapaFCX: cfg.doc.mapaFCX, transacoes: T });
chk('"Em uso" segue contando pelo ID (1 regra, 1 conta do De-para, 1 lançamento manual)', vinc.regras === 1 && vinc.mapa === 1 && vinc.lancamentos === 1, vinc);
const pe = DFC.podeExcluir('pag_marketing', { regras: [], mapaFCX: {}, transacoes: [] });
chk('excluir categoria padrão continua bloqueado (mesmo sem uso), citando o nome ajustado', pe.ok === false && pe.padrao === true && /Publicidade e propaganda/.test(pe.motivo), pe);
chk('classificar(): a regra devolve o ID e a categoria resolvida traz o nome ajustado', DFC.cat(DFC.classificar(tx('r', '2026-10-10', -10, 'TESTE X')).categoria).nome === 'Publicidade e propaganda');
chk('criar categoria PERSONALIZADA com o nome ajustado de uma padrão é recusado; com o nome ORIGINAL (agora livre) é aceito', /Já existe/.test(DFC.prepararCategoria({ nome: 'publicidade e propaganda', sentido: 'S', grupo: 'OPERACIONAL' }, { id: 'cus_novo' }).erro || '') && !!DFC.prepararCategoria({ nome: 'Marketing e publicidade', sentido: 'S', grupo: 'OPERACIONAL' }, { id: 'cus_novo' }).cat);
chk('personalizada com o MESMO id de uma padrão continua ignorada (a padrão manda)', (() => { const c0 = cfg.doc; cfg.doc = { ...c0, categorias: [{ id: 'pag_marketing', nome: 'Intrusa', sentido: 'S', grupo: 'OPERACIONAL', impacto: 'soma' }] }; const r = DFC.categorias().length === 21 && DFC.cat('pag_marketing').nome === 'Publicidade e propaganda'; cfg.doc = c0; return r; })());

/* ---------- 7 · registros quebrados, recurso desligado, restauração ---------- */
const bruto = { regras: DFC_REGRAS_PADRAO.slice(), mapaFCX: {}, categorias: [] };
cfg.doc = { ...bruto, ajustesPadrao: { pag_marketing: { nome: 'ab', grupo: 'XYZ' }, inexistente: { nome: 'Fantasma', grupo: 'OPERACIONAL' }, pag_folha: 'texto', rec_pix: null, pag_tarifas: { nome: 'Tarifas e juros bancários', grupo: 'OPERACIONAL' }, inv_capex: { nome: '  Obras e   imobilizado ', grupo: 'FINANCIAMENTO' } } };
chk('registros quebrados são ignorados: nome curto/grupo inválido caem no original, id inexistente, valor não objeto, nulo e ajuste igual ao original não viram ajuste', JSON.stringify(Object.keys(DFC.ajustesPadrao())) === '["inv_capex"]' && DFC.cat('pag_marketing').nome === 'Marketing e publicidade' && !DFC.cat('pag_marketing').ajustada && !DFC.cat('pag_tarifas').ajustada && !DFC.cat('inexistente'), DFC.ajustesPadrao());
chk('o ajuste válido é saneado (espaços) e mantém o resto', DFC.cat('inv_capex').nome === 'Obras e imobilizado' && DFC.cat('inv_capex').grupo === 'FINANCIAMENTO');
cfg.doc = { ...bruto, ajustesPadrao: [] }; chk('ajustesPadrao em formato inválido (lista) é ignorado', Object.keys(DFC.ajustesPadrao()).length === 0);
cfg.doc = { ...bruto, ajustesPadrao: { pag_marketing: { nome: 'Publicidade e propaganda', grupo: 'NAO_OPERACIONAL' } } };
const dm9 = flags.g09; flags.g09 = false;
chk('recurso gestao_v1409 DESLIGADO: nomes e grupos voltam aos originais (nada ajustado), mesmo com ajustes gravados', DFC.cat('pag_marketing').nome === 'Marketing e publicidade' && DFC.cat('pag_marketing').grupo === 'OPERACIONAL' && !DFC.cat('pag_marketing').ajustada && Object.keys(DFC.ajustesPadrao()).length === 0);
flags.g09 = dm9;
chk('religando o recurso, os ajustes gravados voltam a valer (nada foi apagado)', DFC.cat('pag_marketing').nome === 'Publicidade e propaganda' && cfg.doc.ajustesPadrao.pag_marketing.grupo === 'NAO_OPERACIONAL');
const g4 = flags.g04; flags.g04 = false;
chk('recurso gestao_v1404 desligado (categorias personalizadas): sem ajustes também', DFC.cat('pag_marketing').nome === 'Marketing e publicidade'); flags.g04 = g4;
const refA = DFC.cat('pag_marketing'); cfg.doc = { ...cfg.doc, ajustesPadrao: { pag_marketing: { nome: 'Publicidade 2', grupo: 'NAO_OPERACIONAL' } } };
chk('memo: trocar o documento de ajustes atualiza a lista na hora (sem ficar com o nome em cache)', DFC.cat('pag_marketing').nome === 'Publicidade 2' && refA.nome === 'Publicidade e propaganda');

/* ---------- 8 · tabela "Categorias da DFC" ---------- */
const ICON = { editar: '<i>E</i>', lixo: '<i>L</i>' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const Auth = { perm: new Set(['fcx.dfc.regras']), can(k) { return this.perm.has(k); } };
const tabela = new Function('g04', 'g09', 'Auth', 'DFC', 'ICON', 'esc', 'return {' + tabCod + ' ctxVinculos() { return { regras: DFC.regras(), mapaFCX: {}, transacoes: [] }; } }')(() => flags.g04, () => flags.g09, Auth, DFC, ICON, esc);
const linhas = h2 => [...h2.matchAll(/<tr class="[^"]*">(.*?)<\/tr>/gs)].map(x => x[1]);
cfg.doc = { ...bruto, categorias: [{ id: 'cus_nao_op', nome: 'Saídas não operacionais', sentido: 'S', grupo: 'NAO_OPERACIONAL', impacto: 'soma' }], ajustesPadrao: { pag_marketing: { nome: 'Publicidade e propaganda', grupo: 'NAO_OPERACIONAL' } } };
let t1 = tabela.renderCategorias(), L = linhas(t1);
const padrao = L.filter(x => /pill neutral">padrão</.test(x)), pers = L.filter(x => /pill info">personalizada</.test(x));
chk('tabela: 21 padrão + 1 personalizada, na ordem dos grupos', padrao.length === 21 && pers.length === 1 && L.length === 22, [padrao.length, pers.length]);
chk('tabela: TODAS as 21 padrão têm o lápis de Editar (fd-cat-editar) com o ID da categoria', padrao.every(x => /data-a="fd-cat-editar" data-id="[a-z_]+"/.test(x)) && (t1.match(/data-a="fd-cat-editar"/g) || []).length === 22);
chk('tabela: nas padrão a lixeira existe mas DESABILITADA (sem data-a de exclusão); só a personalizada tem Excluir ativo', padrao.every(x => /iconbtn" disabled aria-disabled="true"/.test(x) && !/fd-cat-del/.test(x)) && pers.every(x => /data-a="fd-cat-del"/.test(x)) && (t1.match(/data-a="fd-cat-del"/g) || []).length === 1);
const lm = L.find(x => /Publicidade e propaganda/.test(x));
chk('tabela: a padrão ajustada mostra o nome novo, o grupo novo (Não Operacional) e o selo "ajustada" com o original no title', lm && /pill warn" title="Original: “Marketing e publicidade” · Operacional">ajustada</.test(lm) && /<td>Não Operacional<\/td>/.test(lm) && !/Marketing e publicidade<\/td>/.test(lm), lm);
chk('tabela: o selo "ajustada" aparece só na ajustada (1) e o texto do painel explica o lápis (ID e sentido travados; excluir bloqueado)', (t1.match(/>ajustada</g) || []).length === 1 && /o lápis ajusta o nome exibido e o grupo no demonstrativo \(o ID interno e o sentido ficam travados; excluir segue bloqueado\)/.test(t1));
Auth.perm.clear(); t1 = tabela.renderCategorias();
chk('tabela sem a permissão fcx.dfc.regras: sem coluna de ações, sem lápis nem lixeira', !/fd-cat-editar/.test(t1) && !/iconbtn/.test(t1) && !/<th><\/th>/.test(t1)); Auth.perm.add('fcx.dfc.regras');
flags.g09 = false; t1 = tabela.renderCategorias(); L = linhas(t1);
chk('recurso desligado: padrão sem lápis nem lixeira (como na v14.08) e personalizada com os dois; sem selo "ajustada"', L.filter(x => /pill neutral">padrão</.test(x)).every(x => !/iconbtn/.test(x)) && (t1.match(/data-a="fd-cat-editar"/g) || []).length === 1 && !/>ajustada</.test(t1) && !/o lápis ajusta/.test(t1) && /<td class="cell-main">Marketing e publicidade /.test(t1)); flags.g09 = true;

/* ---------- 9 · modal e gravação (a interface real, com UI/Repo simulados) ---------- */
const chamadas = { modal: null, toasts: [], salvos: [], base: [] };
const UI = { modal: o => { chamadas.modal = o; }, toast: t => chamadas.toasts.push(t), lerForm: m => m.__d };
const campos = [];
const campo = (rotulo, nome, valor, o = {}) => { campos.push({ rotulo, nome, valor, ...o }); return `<campo:${nome}>`; };
const Repo2 = { get: (c, i) => Repo.get(c, i), salvar: async (c, i, doc, meta) => { chamadas.salvos.push({ c, i, doc, meta }); if (c === 'config' && i === 'dfc') cfg.doc = doc; } };
const FluxoDFC = { ctxVinculos: () => ({ regras: DFC.regras(), mapaFCX: {}, transacoes: [] }), atualizarBaseDFC: async m => { chamadas.base.push(m); }, mesesBanco: () => ['2026-09', '2026-10'] };
new Function('FluxoDFC', 'g09', 'Auth', 'DFC', 'DFC_CATEGORIAS', 'UI', 'campo', 'Repo', uiCod)(FluxoDFC, () => flags.g09, Auth, DFC, DFC_CATEGORIAS, UI, campo, Repo2);
const abre = id => { campos.length = 0; chamadas.modal = null; chamadas.toasts.length = 0; FluxoDFC.abrirCategoriaPadrao09(DFC.cat(id)); return chamadas.modal; };
const fc = n => campos.find(c => c.nome === n);
const clica = async (mo, rot, d) => { const a = mo.acoes.find(x => x.rotulo === rot); return a.acao ? a.acao({ __d: d }) : undefined; };

cfg.doc = { ...bruto };
let mo = abre('pag_marketing');
chk('modal da padrão: título e aviso (nome e grupo editáveis; ID e sentido travados; exclusão bloqueada)', mo.titulo === 'Editar categoria padrão da DFC' && /padrão do sistema/.test(mo.corpo) && /ID interno/.test(mo.corpo) && /exclusão também é bloqueada/.test(mo.corpo), mo.corpo.slice(0, 200));
chk('modal: Nome exibido e Grupo editáveis (sem disabled), com os valores atuais', fc('nome').valor === 'Marketing e publicidade' && !/disabled/.test(fc('nome').attrs || '') && fc('grupo').valor === 'OPERACIONAL' && !/disabled/.test(fc('grupo').attrs || '') && fc('grupo').opcoes.map(o => o[1]).join() === 'Operacional,Investimento,Financiamento,Não Operacional');
chk('modal: ID interno e Sentido TRAVADOS (disabled), mostrando pag_marketing e Saída', /disabled/.test(fc('id_interno').attrs) && fc('id_interno').valor === 'pag_marketing' && /disabled/.test(fc('sentido_travado').attrs) && fc('sentido_travado').valor === 'S');
chk('modal: sem o botão "Restaurar original" quando a categoria não está ajustada', !mo.acoes.some(a => a.rotulo === 'Restaurar original') && mo.acoes.map(a => a.rotulo).join() === 'Cancelar,Salvar');
// salvar: renomear e mudar o grupo
let ret = await clica(mo, 'Salvar', { nome: '  Publicidade   e propaganda ', grupo: 'NAO_OPERACIONAL' });
let sv = chamadas.salvos.at(-1);
chk('salvar: grava em config/dfc.ajustesPadrao só o par { nome, grupo } da categoria, preservando regras, De-para e personalizadas', ret !== false && sv.c === 'config' && sv.i === 'dfc' && JSON.stringify(sv.doc.ajustesPadrao) === JSON.stringify({ pag_marketing: { nome: 'Publicidade e propaganda', grupo: 'NAO_OPERACIONAL' } }) && Array.isArray(sv.doc.regras) && sv.doc.regras.length === DFC_REGRAS_PADRAO.length && Array.isArray(sv.doc.categorias), sv);
chk('salvar: o log registra o nome e o grupo antigos e novos', /Publicidade e propaganda/.test(sv.meta.detalhe) && /Marketing e publicidade/.test(sv.meta.detalhe) && /Operacional → Não Operacional/.test(sv.meta.detalhe) && sv.meta.rotulo === 'Categorias DFC' && sv.meta.modulo === 'fcx', sv.meta);
chk('salvar: o grupo mudou, então a base mensal da DFC é regravada para todos os meses do banco', JSON.stringify(chamadas.base.at(-1)) === '["2026-09","2026-10"]', chamadas.base);
chk('salvar: imediatamente, DFC.cat() e o seletor já mostram o nome e o grupo novos', DFC.cat('pag_marketing').nome === 'Publicidade e propaganda' && DFC.cat('pag_marketing').grupo === 'NAO_OPERACIONAL' && DFC.porSentido('S').some(c => c.nome === 'Publicidade e propaganda'));
// renomear sem mudar o grupo: não recalcula a base
chamadas.base.length = 0; mo = abre('pag_folha');
await clica(mo, 'Salvar', { nome: 'Folha e encargos', grupo: 'OPERACIONAL' });
chk('renomear sem mudar o grupo: grava o ajuste e NÃO regrava a base mensal (nada muda nos valores)', DFC.cat('pag_folha').nome === 'Folha e encargos' && chamadas.base.length === 0 && Object.keys(cfg.doc.ajustesPadrao).sort().join() === 'pag_folha,pag_marketing');
// reabrir a ajustada: botão restaurar
mo = abre('pag_marketing');
chk('modal da ajustada: valores atuais (nome e grupo ajustados), dica com o original e o botão "Restaurar original"', fc('nome').valor === 'Publicidade e propaganda' && fc('grupo').valor === 'NAO_OPERACIONAL' && /Nome original: “Marketing e publicidade”/.test(fc('nome').dica) && /Grupo original: Operacional/.test(fc('grupo').dica) && mo.acoes.map(a => a.rotulo).join() === 'Cancelar,Restaurar original,Salvar');
// nada mudou
chamadas.salvos.length = 0; ret = await clica(mo, 'Salvar', { nome: 'Publicidade e propaganda', grupo: 'NAO_OPERACIONAL' });
chk('salvar sem mudar nada: avisa "Nada foi alterado" e não grava', chamadas.salvos.length === 0 && /Nada foi alterado/.test(chamadas.toasts.at(-1)));
// validações no modal
const falha = async (id, d) => { mo = abre(id); chamadas.salvos.length = 0; const r = await clica(mo, 'Salvar', d); return { r, n: chamadas.salvos.length, t: chamadas.toasts.at(-1) }; };
let f1 = await falha('pag_marketing', { nome: 'ab', grupo: 'OPERACIONAL' });
chk('modal: nome curto é recusado, o modal fica aberto (retorna false) e nada é gravado', f1.r === false && f1.n === 0 && /mínimo/.test(f1.t), f1);
f1 = await falha('pag_marketing', { nome: 'Pagamento a fornecedores', grupo: 'OPERACIONAL' });
chk('modal: nome de outra categoria é recusado', f1.r === false && f1.n === 0 && /Já existe/.test(f1.t), f1);
f1 = await falha('pag_marketing', { nome: 'Publicidade', grupo: 'TRANSFERENCIA' });
chk('modal: grupo Transferência não é aceito em categoria comum', f1.r === false && f1.n === 0 && /grupo/i.test(f1.t), f1);
// restaurar
mo = abre('pag_marketing'); chamadas.base.length = 0; chamadas.salvos.length = 0;
await clica(mo, 'Restaurar original');
sv = chamadas.salvos.at(-1);
chk('restaurar: remove só o ajuste dessa categoria (a de Folha continua), o nome e o grupo voltam e a base é regravada (grupo mudou)', DFC.cat('pag_marketing').nome === 'Marketing e publicidade' && DFC.cat('pag_marketing').grupo === 'OPERACIONAL' && !DFC.cat('pag_marketing').ajustada && !('pag_marketing' in sv.doc.ajustesPadrao) && sv.doc.ajustesPadrao.pag_folha.nome === 'Folha e encargos' && chamadas.base.length === 1 && /restaurada/.test(sv.meta.detalhe), sv);
mo = abre('pag_folha'); chamadas.salvos.length = 0; await clica(mo, 'Restaurar original');
chk('restaurar o último ajuste: a chave ajustesPadrao é REMOVIDA do documento (sem lixo)', !('ajustesPadrao' in chamadas.salvos.at(-1).doc) && !DFC.cat('pag_folha').ajustada);
// voltar ao original digitando os valores originais remove o ajuste
await clica(abre('pag_folha'), 'Salvar', { nome: 'Folha e encargos', grupo: 'OPERACIONAL' });
chamadas.salvos.length = 0; await clica(abre('pag_folha'), 'Salvar', { nome: 'Folha de pagamento e benefícios', grupo: 'OPERACIONAL' });
chk('digitar de volta o nome/grupo originais remove o ajuste em vez de gravar um igual', !('ajustesPadrao' in chamadas.salvos.at(-1).doc) && !DFC.cat('pag_folha').ajustada);
// transferência
mo = abre('transf');
chk('modal da transferência: grupo TRAVADO (só "Transferência") com a explicação; o nome é editável', /disabled/.test(fc('grupo').attrs) && fc('grupo').valor === 'TRANSFERENCIA' && fc('grupo').opcoes.length === 1 && /fora do fluxo líquido/.test(fc('grupo').dica) && !/disabled/.test(fc('nome').attrs || ''));
await clica(mo, 'Salvar', { nome: 'Transferências internas', grupo: 'OPERACIONAL' });
chk('transferência: salvar grava só o nome; o grupo enviado é ignorado e a categoria segue neutra', cfg.doc.ajustesPadrao.transf.grupo === 'TRANSFERENCIA' && DFC.neutra(DFC.cat('transf')) && DFC.cat('transf').nome === 'Transferências internas');
// permissão e recurso
Auth.perm.clear(); chamadas.toasts.length = 0; campos.length = 0; chamadas.modal = null; FluxoDFC.abrirCategoriaPadrao09(DFC.cat('pag_marketing'));
chk('sem a permissão fcx.dfc.regras: o modal não abre e avisa', chamadas.modal === null && /permissão/.test(chamadas.toasts.at(-1))); Auth.perm.add('fcx.dfc.regras');
flags.g09 = false; chamadas.toasts.length = 0; chamadas.modal = null; FluxoDFC.abrirCategoriaPadrao09(DFC.cat('pag_marketing')); flags.g09 = true;
chk('recurso desligado: o modal da padrão não abre', chamadas.modal === null);

/* ---------- 10 · ligação no código (sem tocar nos trechos protegidos) ---------- */
chk('abrirCategoria() encaminha a categoria padrão ao modal novo só com o recurso ligado; senão mantém o aviso antigo', /if \(id && atual && !atual\.personalizada && g09\(\)\) return this\.abrirCategoriaPadrao09\(atual, \{ aoSalvar \}\);/.test(html) && /Esta categoria é padrão do sistema e não pode ser editada\./.test(html));
chk('os textos de destino (fornecedores/entradas) acompanham o nome ajustado nas Regras e no cadastro de Fornecedores e Clientes', /esc\(DFC\.cat\('pag_fornecedores'\)\?\.nome/.test(html) && /esc\(DFC\.cat\('rec_outros'\)\?\.nome/.test(html));
chk('o recurso gestao_v1409 descreve a novidade no marcador', /categorias padrão da DFC com nome e grupo editáveis/.test(html));
chk('DFC_CATEGORIAS no painel continua IDÊNTICA à da v14.08 (21 linhas; md5 do trecho conferido), então o ajuste nunca altera a constante', (corta('const DFC_CATEGORIAS = [', '];').match(/\{ id: '/g) || []).length === 21 && createHash('md5').update(corta('const DFC_CATEGORIAS = [', '];')).digest('hex') === 'd885bfbd02639924ba3e9b47fb383e17');

console.log(`\n${OK.length} ok, ${FAIL.length} falha(s)`);
if (FAIL.length) { console.log('\nFALHAS:\n - ' + FAIL.join('\n - ')); process.exit(1); }
