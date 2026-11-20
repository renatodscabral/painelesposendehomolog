import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* v14.19.2 · SEIS MELHORIAS dentro do recurso gestao_v1419 (front-end; backend inalterado desde a v14.18).
   Valida o CÓDIGO REAL do painel (public/index.html), em contexto isolado do Node, só com dados FICTÍCIOS (LGPD): CNPJs gerados aqui e valores inventados.
   Blocos:
     0) Regra de Ouro e montagem (regiões protegidas, FCX e Contábil intactos) e recurso;
     1) contrato "Sem movimento no mês" (marcar, desfazer, Bloco 1 em 2/2, ERP × Adquirente liberado com R$ 0,00, importação real remove a marca — inclusive SafraPay entre coleções);
     2) DFC executiva só com o Realizado (Resumo Executivo, tela, exportações) — sem Previsto/Orçado e sem variação; Quadro de Reconciliação de Cartões mantido;
     3) Relatório DFC horizontal mês a mês (meses lado a lado + Total Acumulado; PDF A4 paisagem, Excel e CSV);
     4) exportação completa do Extrato OFX (sem corte de paginação, respeitando Conta, Mês, Tipo, Categoria e Busca);
     5) reclassificação em lote com as 3 travas invioláveis (1 conta por exportação; arquivo de outra conta recusado por inteiro; categoria inexistente mantida e listada);
     6) ModalProgressoCarga (cronômetro, barra, etapa, cancelamento seguro, resumo) e ligação às rotinas de carga;
     7) recurso desligado = v14.19.1 e documentação.
   Uso: node tests/teste-v14192-melhorias.mjs */
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(process.env.PAINEL_HTML || path.join(raiz, 'public/index.html'), 'utf8');
const OK = [], FAIL = [];
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x !== '' ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 1400) : '')); };
const md5 = t => createHash('md5').update(t).digest('hex');
const corta = (ini, fim) => { const a = html.indexOf(ini), b = html.indexOf(fim, a + ini.length); if (a < 0 || b < 0) throw new Error('bloco não encontrado: ' + ini.slice(0, 60) + ' … ' + fim.slice(0, 60)); return html.slice(a, b); };
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const perto = (a, b, t = 0.011) => Math.abs(a - b) <= t;
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const espera = () => new Promise(r => setTimeout(r, 0));

/* ---------- 0 · recurso, Regra de Ouro, montagem ---------- */
chk('recurso gestao_v1419 na lista de liberação (v14.19) e helper g19() que depende da v14.18 (g19 = recurso && g18)', /gestao_v1419: \{ versao: 'v14\.19'/.test(html) && /function g19\(\) \{ return typeof Recursos !== 'undefined' && Recursos\.ativo\('gestao_v1419'\) && g18\(\); \}/.test(html));
chk('nenhuma peça deixou marcador de montagem no painel final', !/@@V141[789]_/.test(html));
const MK_DFC = '/* ============================ DFC ============================ */', MK_PE = 'const PARTE_EXTRATO = 900;', MK_M6 = '/* =====================================================================\n   MÓDULO 6 · CREDSYSTEM';
const guardas = {
  'OFX/contas (OFX → início da DFC)': [md5(html.slice(html.indexOf('const OFX = {'), html.indexOf(MK_DFC))), 'f24c59ac5f7a2ec7544b3643a321f096'],
  'adquirentes e FCX (ADQ_CFG → PARTE_EXTRATO)': [md5(html.slice(html.indexOf('const ADQ_CFG'), html.indexOf(MK_PE))), '6a43dc199b96629c8c8af17b4016d126'],
  'Credsystem em diante (Módulo 6 → CS_INDICADORES)': [md5(html.slice(html.indexOf(MK_M6), html.indexOf('const CS_INDICADORES'))), '4738cb8f2d12cff23c6e385e573f9eae'],
  'motor CP_OFX (v14.09)': [md5(corta('/* CP_OFX:INI */', '/* CP_OFX:FIM */')), 'b1c09176c057b4e993ab5b3a3f98e9bc'],
  'regras padrão da DFC (DFC_REGRAS_PADRAO)': [md5(corta('const DFC_REGRAS_PADRAO = [', 'const DFC = {')), 'e27e858c728ca653b2d4261c567a5ba4'],
  'categorias padrão da DFC (DFC_CATEGORIAS)': [md5(corta('const DFC_CATEGORIAS = [', '/** Regras padrão')), 'c50a8dd959d6e32f7ef08ffb6a447436'],
};
for (const [k, [a, b]] of Object.entries(guardas)) chk(`Regra de Ouro: ${k} idêntico ao da v14.17 (md5 ${b.slice(0, 8)}…)`, a === b, a);
for (const [f, h] of [['fcx.html', '640800e0'], ['contabilidade.html', 'a41642fb'], ['contabilidade_v1391.html', 'ea73d20b']]) {
  const p = path.join(raiz, 'public', f);
  chk(`Regra de Ouro: public/${f} idêntico ao da v14.17 — a v14.19 NÃO toca no FCX nem no Contábil (md5 ${h}…)`, fs.existsSync(p) && md5(fs.readFileSync(p)).startsWith(h));
}

/* ---------- ambiente de teste: código REAL do painel (Adq14/Adq15/Adq17/Adq18) com Repo/UI de brincadeira ---------- */
const base = corta('const ADQ_CFG = {', '/* ============================ 6. SERVIÇOS ============================ */');
const motor = corta('const MotorConciliacao = {', '/* ============================ 7. UI (aba do Módulo 4) ============================ */');
const modulo = corta('const ADQ14 = {', '/* ---- fim v14.15 ---- */') + '/* ---- fim v14.15 ---- */';
const parcPix = corta('/* PARC_PIX:INI */', '/* PARC_PIX:FIM */');
const dfcResumo = corta('/* DFC_RESUMO:INI */', '/* DFC_RESUMO:FIM */');
const adq17 = corta('const ADQ17 = {', '/* =====================================================================\n   v14.17 · FRENTE 2 · DESDOBRAMENTO ANALÍTICO');
const m18 = corta('const ADQ18 = {', '/* ---- fim v14.18 ---- */');
const m19 = corta('const ADQ19 = {', '/* ---- fim v14.19 ---- */');
const dfcCore = corta('const DFC_GRUPOS = {', '/* =====================================================================\n   v14.05 · FORNECEDORES E CLIENTES');
const prevCz = corta('const FCX_METODO_PARA_DFC = {', '/* =====================================================================\n   UI — aba DFC do Módulo 3');
const fdDadosResumo = corta('  dadosResumo06(per, escopo, { descricoes = true } = {}) {', '  abrirResumo06() {');
const fdModeloExport = corta('  modeloExport(t) {', '  _auditExp(m, o)');
const fdOrigemRot = corta('  origemRot05(c) {', '  buscaForn05(t, q) {');
const CNPJlib = corta('const CNPJ = {', '/**\n * CSV — leitura e geração');
const codLojaCod = corta('const CodLoja = {', 'const Repo = {');
const campoCod = corta('function campo(rotulo', '\n/**\n * v13.41');
const metodo = nome => { const l = html.split('\n').find(x => x.startsWith('  ' + nome + '(')); if (!l) throw new Error('método não encontrado: ' + nome); return l.trim().replace(/,\s*$/, ''); };
const dvC = (d, n) => { let s = 0, p = n - 7; for (let i = 0; i < n; i++) { s += +d[i] * p--; if (p < 2) p = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
const gerarCnpj = (b8, fil = '0001') => { const d = b8 + fil; const d1 = dvC(d, 12); return d + d1 + dvC(d + d1, 13); };
const CNPJ_RES = gerarCnpj('11222333'), CNPJ_RES_FIL = gerarCnpj('11222333', '0002'), CNPJ_MAR = gerarCnpj('44555666'), CNPJ_BANCO = gerarCnpj('77888999');
const fmtCnpj = s => s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function ambiente({ g14 = true, g15 = true, g17 = true, g18 = true, g19 = true } = {}) {
  const S = { adq_taxas: new Map(), adq_contratos: new Map(), adq_lotes: new Map(), adq_agendas: new Map(), adq_erp: new Map(), contasBancarias: new Map(), extratos: new Map(), lojas: new Map(), config: new Map(), credsystem: new Map() };
  const V = {}; let tic = 0; const bump = c => { V[c] = (V[c] || 0) + 1; };
  const Repo = {
    cols: S, prontas: new Set(Object.keys(S)), todos: c => [...(S[c] || new Map()).values()], get: (c, id) => (S[c] || new Map()).get(id) || null, versao: c => V[c] || 0,
    salvar: async (c, id, d, aud) => { S[c].set(id, { id, ...JSON.parse(JSON.stringify(d)), atualizadoEm: 't' + (++tic) }); bump(c); ctx.gravacoes.push({ c, id, aud }); },
    excluir: async (c, id) => { S[c].delete(id); bump(c); }, assinar(c) { ctx.assinadas.push(c); }, semMeta: d => d,
    recarregar: async c => { Repo.prontas.add(c); bump(c); },
  };
  const emp = { resilienza: { id: 'resilienza', nome: 'Resilienza', cnpj: CNPJ_RES }, 'mar-aberto': { id: 'mar-aberto', nome: 'Mar Aberto', cnpj: CNPJ_MAR } };
  const ctx = { bases: [], fcxApi: null, flag: g14, flag15: g15, flag17: g17, flag18: g18, flag19: g19, toasts: [], audits: [], gravacoes: [], confirmou: 0, assinadas: [], modais: [], baixados: [], previas: [], form: null };
  const ConcMP = { SUBS72: [], ui: { sub: 'regras' }, v72: () => true, renderCredito() { return 'ORIGINAL-CREDITO'; }, renderRegras() { return 'ORIGINAL-REGRAS'; },
    empresa: id => emp[id] || null, nomeEmpresa: id => emp[id]?.nome || id || '—', empresas: () => Object.values(emp), ecInfo: () => null };
  const mocks = {
    g08: () => !!ctx.g08on, matrizAtual08: () => ctx.matrizRes || { matriz: null }, DFC_MATRIZ: { validarEmissor08: r => (r && r.matriz && r.matriz.razao && r.matriz.cnpj ? [] : ['A Empresa Matriz não está definida no Cadastro de Lojas.']), validarEscopo: () => [] },
    Repo, ConcMP, g14: () => ctx.flag, g15: () => ctx.flag15 && ctx.flag, g16: () => ctx.flag, g17: () => ctx.flag17 && ctx.flag15 && ctx.flag, g18: () => ctx.flag18 && ctx.flag17 && ctx.flag15 && ctx.flag, g19: () => ctx.flag19 && ctx.flag18 && ctx.flag17 && ctx.flag15 && ctx.flag,
    Datas: { hojeISO: () => '2026-11-17', iso: d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }, Recursos: { ativo: () => true }, Auth: { can: (...x) => (ctx.pode ? ctx.pode(...x) : true), id: 'u-teste' }, Libs: { xlsx: async () => ctx.xlsxFake }, FCX: { api: () => ctx.fcxApi || null, get versao() { return ctx.fcxVer || 1; }, montar() {} }, g07: () => false,
    ContasBancarias: { rotulo: c => c.apelido }, Retaguarda: { mesAnterior: m => { const [y, mm] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mm - 2, 1)); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); } }, CNPJ: undefined, LOGO_NAVY: 'data:image/png;base64,AAAA', $: () => null,
    Fmt: { brl: n => 'R$' + Number(n).toFixed(2), brl0: n => 'R$' + Math.round(n), num: (n, d = 0) => Number(n).toFixed(d), data: d => String(d ?? '').replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1'), dataHora: d => d, pct: (n, d = 2) => Number(n).toFixed(d) + '%' },
    UI: { toast: m => ctx.toasts.push(m), alerta: async (t, x) => { ctx.alertas = ctx.alertas || []; ctx.alertas.push([t, x]); }, modal(o) { ctx.modais.push(o); return { el: {} }; }, confirmar: async (...x) => { ctx.confirmou++; ctx.confirmacoes = (ctx.confirmacoes || []); ctx.confirmacoes.push(x); return !ctx.recusar; }, confirmarImpacto: async () => { ctx.confirmou++; return true; }, lerForm: () => ctx.form || ({}) },
    App: { render() { ctx.renders = (ctx.renders || 0) + 1; }, agendarRender() { ctx.agendados = (ctx.agendados || 0) + 1; } }, Audit: { registrar: a => { ctx.audits.push(a); return Promise.resolve(); } },
    Documento: { nomeArquivo: n => String(n || 'documento').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9-]+/g, '_').replace(/^_|_$/g, ''), baixarArquivo(nome, blob) { ctx.baixados.push([nome, blob]); return true; }, montar: (t, corpo, o) => ({ titulo: t, corpo, opcoes: o }), previa: (t, doc, nome) => { ctx.previas.push({ titulo: t, doc, nome }); } }, CSV: { gerar: m => m.map(l => l.join(';')).join('\n') },
    registrarBase: m => ctx.bases.push(m), g09: () => true, g11: () => false, Acesso: { loja: () => false }, esc: escH,
  };
  const nomes = Object.keys(mocks).filter(k => k !== 'CNPJ');
  const fn = new Function(...nomes, `${CNPJlib}\n${parcPix}\n${campoCod}\n${codLojaCod}\n${base}\n${motor}\n${modulo}\n${dfcCore}\n${prevCz}\n${dfcResumo}\nconst FluxoDFC = { ui: { sub: 'cruzamento', mes: '2026-01', conta: '', busca: '', filtro: 'todas', forn: '', limite: 200 }, _czDados: null, norm: s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(), buscaForn05: () => false, filtroForn05: () => true, podeResumo06: () => true, lembrar06() {}, textoEscopo07: () => ({}), escopo07: () => null, botoesExport: () => '', botaoResumo06: () => '<button>Resumo Executivo DFC: demonstrativo realizado × previsto</button>', transacoes() { return Repo.todos('extratos').flatMap(d => (d.transacoes || []).map(t => ({ ...t, contaId: d.contaId, docId: d.id }))); }, trDFC() { return this.transacoes(); }, contas() { return Repo.todos('contasBancarias'); }, semSalarios06() { return false; }, mesLabel: m => m, marcaDoc: () => 'Esposende', r2: n => Math.round((n + Number.EPSILON) * 100) / 100, mesesBanco() { return [...new Set(Repo.todos('extratos').map(d => d.mes))].sort().reverse(); }, async atualizarBaseDFC(meses) { registrarBase(meses); }, ${fdDadosResumo} ${fdModeloExport} ${fdOrigemRot} };\n${adq17}\n${m18}\n/* métodos reais do ConcMP usados pelo contrato */\nObject.assign(ConcMP, { ${metodo('dig')}, ${metodo('empresaPorCnpj')}, ${metodo('canonAdq')} });\n${m19}\nreturn { ADQ_CFG, AdqTaxas, DiasUteis, MotorConciliacao, ADQ14, Adq14, ADQ15, Adq15, ADQ17, Adq17, ADQ18, Adq18, ADQ19, Adq19, DFC_RESUMO, DFC, DFC_CATEGORIAS, DFC_REGRAS_PADRAO, DFC_GRUPOS, Cruzamento, PrevistoFCX, FluxoDFC, CNPJ, CodLoja, campo, ModalProgressoCarga, DFC_HORIZ, DFC_LOTE19 };`);
  const E = fn(...nomes.map(k => mocks[k]));
  ctx.S = S; ctx.Repo = Repo; ctx.ConcMP = ConcMP; ctx.bump = bump; Object.assign(ctx, E);
  return ctx;
}

/* ---------- cenários fictícios compartilhados (Getnet + SafraPay + Credsystem da Resilienza; OFX genérico) ---------- */
const FX = (() => {
  const mdr = (d, c1, c26, c712) => [{ modalidade: 'debito', de: 1, ate: 1, taxa: d }, { modalidade: 'credito', de: 1, ate: 1, taxa: c1 }, { modalidade: 'credito', de: 2, ate: 6, taxa: c26 }, { modalidade: 'credito', de: 7, ate: 12, taxa: c712 }];
  const regra = (a, e, m, am, x = {}) => ({ id: `adq-${a.toLowerCase()}__todas__emp-${e}`, adquirente: a, bandeira: '*', empresaId: e, ativo: true, antecipado: true, prazoRepasse: 1, mdr: m, antecipacao: { taxa: am, unidade: 'am', metodo: 'simples' }, ...x });
  const CAB_GN = 'ESTABELECIMENTO COMERCIAL;CPF / CNPJ;RAZÃO SOCIAL;DATA/HORA DA VENDA;BANDEIRA;MODALIDADE;FORMA DE PAGAMENTO;STATUS DA TRANSAÇÃO;PARCELAS;DATA PREVISTA DO 1º PAGAMENTO;NÚMERO DO CARTÃO;NÚMERO DE AUTORIZAÇÃO (AUT);NÚMERO DO COMPROVANTE DE VENDA (NSU);TIPO DE CAPTURA;NÚMERO DO TERMINAL;VALOR BRUTO;VALOR TAXA;VALOR LÍQUIDO;ORIGEM DO CARTÃO;;;;;ID';
  const SEP = ';'.repeat(22) + '-';
  const gn = (cnpj, razao, ec) => (dh, band, mod, forma, st, parc, dp, bruto, taxa, liq) => [ec, fmtCnpj(cnpj), razao, dh, band, mod, forma, st, parc, dp, '439267******0321', '35859', '5725', 'Pos', '14092285', bruto, taxa, liq, 'Nacional', '', '', '', '', '-'].join(';');
  const gnRes = gn(CNPJ_RES, 'Resilienza Negocios Ltda', '15105016');
  /** Getnet Resilienza · janeiro (ficcional): débito 1.000 (05/01), Mastercard à vista 2.000, Visa 3x 3.000 (todos em 05/01), débito 100 (12/01); `fimMes`: + Visa à vista 1.000 vendido em 30/01 (repasse em 02/02, virada de mês) */
  const csvRes = (fimMes = false) => [CAB_GN,
    gnRes('05/01/2026 14:20', 'Visa', 'Débito', 'Débito', 'Aprovada', 1, '06/01/2026', '1.000,00', '-9,00', '991,00'),
    gnRes('05/01/2026 15:00', 'Mastercard', 'Crédito', 'Crédito à Vista', 'Aprovada', 1, '04/02/2026', '2.000,00', '-44,00', '1.956,00'), SEP,
    gnRes('05/01/2026 16:30', 'Visa', 'Crédito', 'Crédito Parcelado Lojista', 'Aprovada', 3, '04/02/2026', '3.000,00', '-90,00', '2.910,00'),
    gnRes('12/01/2026 10:00', 'Visa', 'Débito', 'Débito', 'Aprovada', 1, '13/01/2026', '100,00', '-0,90', '99,10'),
    ...(fimMes ? [gnRes('30/01/2026 10:00', 'Visa', 'Crédito', 'Crédito à Vista', 'Aprovada', 1, '27/02/2026', '1.000,00', '-22,00', '978,00')] : []), ''].join('\r\n');
  const nulls = n => Array(n).fill(null);
  const topoSafra = (titulo, periodo) => [[null, 'Banco Safra S/A', 'Emitido em: 17/11/2026 09:56', ...nulls(10)], [null, 'CNPJ: ' + fmtCnpj(CNPJ_BANCO), periodo, ...nulls(10)], nulls(13), [titulo, ...nulls(12)], nulls(13), nulls(13)];
  const CAB_REC = ['Data do Pagamento', 'Bandeira', 'Número do Cartão', 'Modalidade', 'Número Sequencial Único', 'Número de Autorização', 'Número do Terminal', 'Estabelecimento Comercial', 'Valor da Parcela', 'Taxa de Administração', 'Taxa de Antecipação', 'Valor Recebido', 'Cartão Estrangeiro'];
  const rec = (dp, band, mod, nsu, aut, parcela, adm, ant, recb) => [dp, band, '************0804', mod, nsu, aut, 10848325, 1454475, parcela, adm, ant, recb, 'Não'];
  const recebiveis = (linhas, periodo = 'Período de 01/01/2026 até 31/01/2026') => [...topoSafra('Recebiveis de antecipação', periodo), CAB_REC, ...linhas, ['Total', ...nulls(12)], nulls(13)];
  const REC_JAN = [
    rec('06/01/2026', 'MASTERCARD', 'Crédito à vista', 1001, 11, 'R$ 1.000,00', '- R$ 17,50', '- R$ 4,00', 'R$ 978,50'),
    rec('06/01/2026', 'MASTERCARD', 'Crédito de 2 a 6 parcelas', 1002, 12, 'R$ 100,00', '- R$ 3,00', '- R$ 0,50', 'R$ 96,50'),
    rec('06/01/2026', 'MASTERCARD', 'Crédito de 2 a 6 parcelas', 1002, 12, 'R$ 100,00', '- R$ 3,00', '- R$ 1,60', 'R$ 95,40'),
    rec('06/01/2026', 'MASTERCARD', 'Crédito de 2 a 6 parcelas', 1002, 12, 'R$ 100,00', '- R$ 3,00', '- R$ 4,90', 'R$ 92,10'),
    rec('07/01/2026', 'VISA', 'Débito', 1003, 13, 'R$ 200,00', '- R$ 1,80', '- R$ 0,00', 'R$ 198,20'),
    rec('07/01/2026', 'VISA', 'Crédito à vista', 1004, 14, 'R$ 1.000,00', '- R$ 22,00', '- R$ 60,00', 'R$ 918,00')];
  /** fevereiro: pagamentos de 02/02 (vendas de 30 e 31/01 da Agenda) + uma venda sem par na Agenda (NSU 9999) */
  const REC_FEV = [
    rec('02/02/2026', 'MASTERCARD', 'Débito', 2001, 21, 'R$ 150,00', '- R$ 1,35', '- R$ 0,00', 'R$ 148,65'),
    rec('02/02/2026', 'ELO', 'Crédito à vista', 2002, 22, 'R$ 120,00', '- R$ 2,64', '- R$ 3,20', 'R$ 114,16'),
    rec('02/02/2026', 'VISA', 'Débito', 9999, 99, 'R$ 40,00', '- R$ 0,36', '- R$ 0,00', 'R$ 39,64')];
  const CAB_AG = ['Data da Venda', 'Horário', 'Bandeira / Arranjo', 'Número do Cartão', 'Modalidade', 'Tipo de Captura', 'Número do Terminal', 'Estabelecimento Comercial', 'Valor Bruto da Venda', 'Valor Líquido da Venda', 'Número Sequencial Único', 'Número de Autorização', 'Parcela'];
  const ag = (dv, band, mod, nsu, aut, parcela, bruto, liq) => [dv, '10:15:00', band, '************0804', mod, 'POS', 10848325, 1454475, bruto, liq, nsu, aut, parcela];
  const agenda = (linhas, periodo = 'Período de 01/01/2026 até 31/01/2026') => [...topoSafra('Agenda de Vendas', periodo), CAB_AG, ...linhas, ['Total', ...nulls(12)], nulls(13)];
  const AG_JAN = [
    ['05/01/2026', 'MASTERCARD', 'Crédito à vista', 1001, 11, '1/1', 'R$ 1.000,00', 'R$ 978,50'],
    ['05/01/2026', 'MASTERCARD', 'Crédito de 2 a 6 parcelas', 1002, 12, '1/3', 'R$ 300,00', 'R$ 284,00'], ['05/01/2026', 'MASTERCARD', 'Crédito de 2 a 6 parcelas', 1002, 12, '2/3', 'R$ 300,00', 'R$ 284,00'], ['05/01/2026', 'MASTERCARD', 'Crédito de 2 a 6 parcelas', 1002, 12, '3/3', 'R$ 300,00', 'R$ 284,00'],
    ['06/01/2026', 'VISA', 'Débito', 1003, 13, '1/1', 'R$ 200,00', 'R$ 198,20'], ['06/01/2026', 'VISA', 'Crédito à vista', 1004, 14, '1/1', 'R$ 1.000,00', 'R$ 918,00'],
    ['30/01/2026', 'MASTERCARD', 'Débito', 2001, 21, '1/1', 'R$ 150,00', 'R$ 148,65'], ['31/01/2026', 'ELO', 'Crédito à vista', 2002, 22, '1/1', 'R$ 120,00', 'R$ 114,16']];
  const CT = { res: 'adq-getnet__emp-resilienza', saf: 'adq-safrapay__emp-resilienza' };
  const tr = (id, data, valor, hist) => ({ id, data, valor, hist }), docOfx = (id, contaId, mes, transacoes) => ({ id, contaId, mes, transacoes });
  const ofx = (E, docs) => { E.S.extratos.clear(); docs.forEach(d => E.S.extratos.set(d.id, d)); E.bump('extratos'); };
  /** cenário Getnet Resilienza (conta A) + SafraPay Resilienza (conta C); opções: g18, fimMes (venda de 30/01 com repasse em 02/02), mcSemAnt (Mastercard sem antecipação), agenda (grava a Agenda da SafraPay), fev (Recebíveis de fevereiro) */
  const cenario = async ({ g18 = true, fimMes = false, mcSemAnt = false, agendaSafra = false, fev = false } = {}) => {
    const E = ambiente({ g18 }), { Adq14, Adq15 } = E, S = E.S;
    [regra('GETNET', 'resilienza', mdr(0.9, 2.2, 2.6, 3.0), 1.6), regra('SAFRAPAY', 'resilienza', mdr(0.9, 2.2, 2.6, 3.0), 1.6), ...(mcSemAnt ? [regra('GETNET', 'resilienza', mdr(0.9, 2.2, 2.6, 3.0), 1.6, { id: 'adq-getnet__master__emp-resilienza', bandeira: 'MASTER', antecipado: false })] : [])].forEach(r => S.adq_taxas.set(r.id, r));
    [['ct-a', 'Conta A'], ['ct-c', 'Conta C']].forEach(([id, apelido]) => S.contasBancarias.set(id, { id, apelido, ativa: true })); E.bump('adq_taxas'); E.bump('contasBancarias');
    S.adq_contratos.set(CT.res, { id: CT.res, adquirente: 'GETNET', empresaId: 'resilienza', contaId: 'ct-a', ativo: true, lojas: ['01', '02'] });
    S.adq_contratos.set(CT.saf, { id: CT.saf, adquirente: 'SAFRAPAY', empresaId: 'resilienza', contaId: 'ct-c', ativo: true, lojas: ['05'], ecs: ['1454475'] }); E.bump('adq_contratos');
    E.importar = async (contratoId, lido) => { Adq14.ui.contrato = contratoId; Adq14.ui.fixo = ''; Adq14._ler = { contratoId, lido, val: Adq14.validarCnpj(lido, Adq14.contrato(contratoId)) }; await Adq14.gravarLote(); await espera(); };
    await E.importar(CT.res, await Adq14.lerGetnetTexto(csvRes(fimMes), 'res.csv')); await E.importar(CT.saf, Adq15.lerSafraLinhasAuto(recebiveis(REC_JAN), 'Recebiveis (jan).xlsx'));
    if (fev) await E.importar(CT.saf, Adq15.lerSafraLinhasAuto(recebiveis(REC_FEV, 'Período de 01/02/2026 até 28/02/2026'), 'Recebiveis (fev).xlsx'));
    if (agendaSafra) await E.importar(CT.saf, Adq15.lerSafraLinhasAuto(agenda(AG_JAN.map(l => ag(...l))), 'Agenda (jan).xlsx'));
    const cm = Adq14.calcularMes('2026-01'), res = cm.get(Adq14.idLote('GETNET', CNPJ_RES, '2026-01')), saf = cm.get(Adq14.idLote('SAFRAPAY', CNPJ_RES, '2026-01'));
    E.res = res; E.saf = saf; E.e06 = res.dias[0].valor; Adq14.ui.mes = '2026-01'; Adq14.ui.filtro = '*'; return E;
  };
  return { mdr, regra, CT, tr, docOfx, ofx, cenario, REC_FEV, AG_JAN, csvRes };
})();
const OFX_JAN = (E, { credito = E.e06, extras = [] } = {}) => FX.ofx(E, [FX.docOfx('xa', 'ct-a', '2026-01', [FX.tr('a1', '2026-01-06', credito, 'CREDITO GETNET LIQUIDACAO'), FX.tr('a9', '2026-01-20', -12, 'TARIFA MANUTENCAO CONTA'), ...extras]),
  FX.docOfx('xc', 'ct-c', '2026-01', [])]);
const rowIdx = (I, id) => I.contratos.find(r => r.id === id);
const FX3 = (() => {
  const CAB_ERP = ['Loja', 'Dt Venda', 'Dt Crédito', 'Adq', 'Descrição', 'Vda Bruta', ' MDR', 'Vda Líquida', 'Vencimento', 'Antecipação', 'Tx Extra', 'OP', 'DC'];
  const erc = (loja, dv, dcr, bruto, liq, ant, tx, op, dc, cod = '304', desc = 'CREDSYSTEM CARTAO PROPRIO') => [loja, dv, dcr, cod, desc, bruto, 0, liq, dcr, ant, tx, op, dc];
  const nulls = n => Array(n).fill(null);
  /** Credsystem (ERP, loja 01): 05/02 → 500 (a receber) · 06/02 → estorno DB 100 (subtrai) · 12/01 → 300 (já recebido em janeiro: fora) · 03/02 → venda de 20/02?? não: fora do corte de vendas */
  const ERP = [erc('01', '02/01/2026', '05/02/2026', 500, 500, 0, 0, 'VE', 'CR'), erc('01', '10/01/2026', '06/02/2026', 100, 100, 0, 0, 'VE', 'DB'), erc('01', '09/01/2026', '12/01/2026', 300, 300, 0, 0, 'VE', 'CR'),
    erc('02', '15/01/2026', '03/02/2026', 700, 700, 0, 0, 'VE', 'CR')]; // loja 02 não pertence ao contrato (lojas: 01)
  const erpRows = () => [['Apuração dos Créditos', ...nulls(12)], ['Período: 01/01/2026 a 31/01/2026', ...nulls(12)], nulls(13), CAB_ERP, ...ERP];
  return { erpRows };
})();
const CT_CRED4 = 'adq-credsystem__emp-resilienza';

const ModalProgressoCarga_AUTO = E => { E.ModalProgressoCarga.AUTO_FECHAR_MS = 0; };
const MES = '2026-01', pill = (h, texto) => new RegExp(`<span class="pill (ok|warn|neutral|bad)"[^>]*>${texto.replace(/[()/]/g, '\\$&')}</span>`).exec(h);
const CAB_GN2 = 'ESTABELECIMENTO COMERCIAL;CPF / CNPJ;RAZÃO SOCIAL;DATA/HORA DA VENDA;BANDEIRA;MODALIDADE;FORMA DE PAGAMENTO;STATUS DA TRANSAÇÃO;PARCELAS;DATA PREVISTA DO 1º PAGAMENTO;NÚMERO DO CARTÃO;NÚMERO DE AUTORIZAÇÃO (AUT);NÚMERO DO COMPROVANTE DE VENDA (NSU);TIPO DE CAPTURA;NÚMERO DO TERMINAL;VALOR BRUTO;VALOR TAXA;VALOR LÍQUIDO;ORIGEM DO CARTÃO;;;;;ID';
const csvGetnetMar = () => [CAB_GN2, ['15105099', fmtCnpj(CNPJ_MAR), 'Mar Aberto Ltda', '08/01/2026 11:00', 'Visa', 'Débito', 'Débito', 'Aprovada', 1, '09/01/2026', '439267******0321', '35860', '5726', 'Pos', '14092286', '400,00', '-3,60', '396,40', 'Nacional', '', '', '', '', '-'].join(';'), ''].join('\r\n');
const ID_MAR = 'adq-getnet__emp-mar-aberto', ID_MAR_SAF = 'adq-safrapay__emp-mar-aberto';
/** ERP com linhas da Getnet (Adq 301) só da loja 01 (Resilienza) — o Mar Aberto não vendeu nada em janeiro */
const erpGetnetRows = () => { const nulls = n => Array(n).fill(null), L = (loja, dv, dcr, bruto, liq) => [loja, dv, dcr, '301', 'GETNET', bruto, 0, liq, dcr, 0, 0, 'VE', 'CR']; return [['Apuração dos Créditos', ...nulls(12)], ['Período: 01/01/2026 a 31/01/2026', ...nulls(12)], nulls(13), ['Loja', 'Dt Venda', 'Dt Crédito', 'Adq', 'Descrição', 'Vda Bruta', ' MDR', 'Vda Líquida', 'Vencimento', 'Antecipação', 'Tx Extra', 'OP', 'DC'], L('01', '05/01/2026', '06/01/2026', 1000, 991), L('01', '12/01/2026', '13/01/2026', 100, 99.1)]; };
const comMar = async (opts = {}) => {
  const E = await FX.cenario({ agendaSafra: true, ...opts }), { S, Adq14 } = E;
  S.adq_contratos.set(ID_MAR, { id: ID_MAR, adquirente: 'GETNET', empresaId: 'mar-aberto', contaId: 'ct-a', ativo: true, lojas: ['03'] });
  S.adq_contratos.set(ID_MAR_SAF, { id: ID_MAR_SAF, adquirente: 'SAFRAPAY', empresaId: 'mar-aberto', contaId: 'ct-c', ativo: true, lojas: ['04'], ecs: ['9990001'] }); E.bump('adq_contratos');
  Adq14.ui.mes = MES; Adq14.ui.filtro = '*'; return E;
};

/* ================================================================================================================
   1 · CONTRATO "SEM MOVIMENTO NO MÊS"
   ================================================================================================================ */
console.log('\n── 1 · contrato "Sem movimento no mês" ──');
{
  const E = await comMar(), { S, Adq14, Adq15, Adq19 } = E;
  Adq15.ui.erp = { lido: Adq15.lerErpLinhas(erpGetnetRows(), 'Apuração dos Créditos jan.xlsx', 'ApuraCreditos') }; await Adq15.gravarErp(); await espera();
  const n0 = Adq19.nivel1(MES).porAdq.get('GETNET');
  chk('situação de partida: GETNET tem 2 contratos e só 1 com arquivo (Resilienza); o Mar Aberto está sem arquivo e o consolidado é só informativo', n0.nTotal === 2 && n0.nImportados === 1 && n0.parcial === true && n0.faltam.includes('GETNET · Mar Aberto') && n0.comparavel === false, [n0.nTotal, n0.nImportados, n0.faltam]);
  const adq0 = n0.adqBruto, h0 = Adq19.render();
  chk('Bloco 1: a pílula da Getnet mostra "GETNET: 1/2 contrato(s)" em alerta (amarela)', pill(h0, 'GETNET: 1/2 contrato(s)')?.[1] === 'warn', h0.match(/GETNET: \d\/\d contrato/g));
  chk('Bloco 3: o contrato sem lote ganha o botão discreto "Sem movimento no mês" (a19-semmov) — e só ele: contratos com arquivo e a Credsystem não têm botão', (h0.match(/data-a="a19-semmov"/g) || []).length === 2 && h0.includes(`data-id="${ID_MAR}"`) && h0.includes(`data-id="${ID_MAR_SAF}"`), (h0.match(/data-a="a19-semmov"[^>]*>/g) || []));
  chk('sem marca ainda: nenhum "Desfazer" e o texto "sem arquivo na competência" continua nas linhas sem lote', !/a19-semmov-desfazer/.test(h0) && /sem arquivo na competência/.test(h0));
  chk('estado do contrato: "vazio" sem arquivo; "real" com arquivo (Resilienza)', Adq19.semMov.estado(Adq14.contrato(ID_MAR), MES) === 'vazio' && Adq19.semMov.estado(Adq14.contrato(FX.CT.res), MES) === 'real');
  // desistir na confirmação não grava nada
  const antesL = S.adq_lotes.size, antesA = S.adq_agendas.size; E.recusar = true; const rec = await Adq19.semMov.marcar(ID_MAR, MES); E.recusar = false;
  chk('se a pessoa desiste na confirmação, nada é gravado', rec === false && S.adq_lotes.size === antesL && S.adq_agendas.size === antesA);
  // marcar
  E.toasts.length = 0; E.audits.length = 0; const idMar = Adq14.idLote('GETNET', CNPJ_MAR, MES);
  const ok = await Adq19.semMov.marcar(ID_MAR, MES); await espera();
  const d = S.adq_lotes.get(idMar);
  chk('confirmado: grava UM documento de lote com semMovimento:true, bruto 0 e líquido 0 na chave do lote real (adquirente + CNPJ + competência)', ok === true && !!d && d.semMovimento === true && d.bruto === 0 && d.liquido === 0 && d.competencia === MES && d.adquirente === 'GETNET' && d.cnpj === CNPJ_MAR && d.empresaId === 'mar-aberto' && S.adq_lotes.size === antesL + 1 && S.adq_agendas.size === antesA, d);
  chk('o documento de marca respeita o formato do lote (grupos vazios, resumo zerado, arquivo "sem-movimento") para passar na mesma validação de servidor', Array.isArray(d.grupos) && d.grupos.length === 0 && d.resumo.qtd === 0 && d.resumo.bruto === 0 && d.resumo.esperado === 0 && d.arquivo.layout === 'sem-movimento' && d.formato === E.ADQ14.FORMATO, d);
  chk('a marcação fica na auditoria e avisa por toast', E.audits.some(a => /sem movimento/i.test(a.rotulo + ' ' + (a.detalhe || ''))) && E.toasts.some(t => /sem movimento/i.test(t)), [E.audits.map(a => a.rotulo), E.toasts]);
  const n1 = Adq19.nivel1(MES).porAdq.get('GETNET');
  chk('depois de marcar: a Getnet conta 2/2 contratos (nenhum faltando) e a marca aparece na lista de contratos sem movimento', n1.nImportados === 2 && n1.nTotal === 2 && n1.parcial === false && n1.faltam.length === 0 && n1.semMov.includes('GETNET · Mar Aberto'), [n1.nImportados, n1.faltam, n1.semMov]);
  chk('o ERP × Adquirente consolidado (Nível 1) é liberado: passa a ser comparável e o bruto da adquirente segue igual (o Mar Aberto soma R$ 0,00)', n1.comparavel === true && perto(n1.adqBruto, adq0), [n1.comparavel, n1.adqBruto, adq0]);
  const h1 = Adq19.render();
  chk('Bloco 1: a pílula passa a "GETNET: 2/2 contrato(s)" em verde', pill(h1, 'GETNET: 2/2 contrato(s)')?.[1] === 'ok', h1.match(/GETNET: \d\/\d contrato/g));
  chk('Bloco 3: a linha do contrato mostra o selo neutro "Sem movimento no mês" e o botão "Desfazer"; o botão de marcar some só dele', /Sem movimento no mês/.test(h1) && h1.includes(`data-a="a19-semmov-desfazer"`) && !h1.includes(`data-a="a19-semmov" data-id="${ID_MAR}"`) && h1.includes(`data-id="${ID_MAR_SAF}"`), (h1.match(/data-a="a19-semmov[^>]*>/g) || []));
  // a competência não pode ser marcada duas vezes nem sobre arquivo real
  E.toasts.length = 0; const dup = await Adq19.semMov.marcar(ID_MAR, MES), real = await Adq19.semMov.marcar(FX.CT.res, MES);
  chk('não marca duas vezes nem por cima de um contrato que já tem arquivo real (avisa e não grava)', dup === false && real === false && E.toasts.length === 2 && S.adq_lotes.size === antesL + 1, E.toasts);
  // permissões
  E.pode = () => false; E.toasts.length = 0; const semPerm = await Adq19.semMov.marcar(ID_MAR_SAF, MES); E.pode = null;
  chk('sem a permissão de importação da Conciliação não marca nada', semPerm === false && E.toasts.some(t => /permiss/i.test(t)) && S.adq_lotes.size === antesL + 1, E.toasts);
  // Desfazer
  const desf = await Adq19.semMov.desfazer(ID_MAR, MES); await espera();
  chk('"Desfazer" remove só a marca: o contrato volta a "sem arquivo", o Bloco 1 volta a 1/2 e o consolidado volta a informativo', desf !== false && !S.adq_lotes.has(idMar) && Adq19.semMov.estado(Adq14.contrato(ID_MAR), MES) === 'vazio' && Adq19.nivel1(MES).porAdq.get('GETNET').nImportados === 1 && Adq19.nivel1(MES).porAdq.get('GETNET').comparavel === false);
  chk('"Desfazer" nunca apaga um arquivo real (o lote da Resilienza segue lá)', (await Adq19.semMov.desfazer(FX.CT.res, MES)) === false && S.adq_lotes.has(Adq14.idLote('GETNET', CNPJ_RES, MES)));
  // importar arquivo real depois remove a marca (mesma chave)
  await Adq19.semMov.marcar(ID_MAR, MES); await espera();
  Adq14.ui.contrato = ID_MAR; Adq14.ui.fixo = ''; const lido = await Adq14.lerGetnetTexto(csvGetnetMar(), 'mar.csv'); Adq14._ler = { contratoId: ID_MAR, lido, val: Adq14.validarCnpj(lido, Adq14.contrato(ID_MAR)) }; await Adq14.gravarLote(); await espera();
  const dr = S.adq_lotes.get(idMar);
  chk('IMPORTAR um arquivo real depois remove a marca automaticamente (substitui o documento na mesma chave): sai o "Sem movimento", entram as vendas', !!dr && !dr.semMovimento && dr.resumo.qtd === 1 && Adq19.semMov.estado(Adq14.contrato(ID_MAR), MES) === 'real' && Adq19.nivel1(MES).porAdq.get('GETNET').semMov.length === 0, dr && { sm: dr.semMovimento, q: dr.resumo.qtd });
  chk('e o Mar Aberto deixa de ter o botão e passa a ter o arquivo real (sem selo de sem movimento nessa linha)', !Adq19.render().includes(`data-a="a19-semmov" data-id="${ID_MAR}"`));

  // SafraPay: duas fontes (Recebíveis em adq_lotes + Agenda em adq_agendas)
  const idSaf = Adq14.idLote('SAFRAPAY', CNPJ_MAR, MES);
  await Adq19.semMov.marcar(ID_MAR_SAF, MES); await espera();
  const lSaf = S.adq_lotes.get(idSaf), aSaf = S.adq_agendas.get(idSaf);
  chk('SafraPay: a marca grava os DOIS documentos (Recebíveis em adq_lotes e Agenda em adq_agendas), cada um no formato da sua coleção, para as duas fontes enxergarem o contrato', !!lSaf && !!aSaf && lSaf.semMovimento && aSaf.semMovimento && aSaf.formato === 'safra-agenda' && Array.isArray(lSaf.vendas) && Array.isArray(lSaf.parcelas) && Array.isArray(aSaf.vendas), [!!lSaf, !!aSaf]);
  chk('SafraPay marcada: o contrato conta como presente (2/2) no Bloco 1', Adq19.nivel1(MES).porAdq.get('SAFRAPAY').parcial === false && pill(Adq19.render(), 'SAFRAPAY: 2/2 contrato(s)')?.[1] === 'ok');
  // importar só o lado dos Recebíveis → o resíduo na Agenda é limpo (e vice-versa)
  Adq14.ui.contrato = ID_MAR_SAF; Adq14.ui.fixo = '';
  const recMar = FX.REC_FEV.length && Adq15.lerSafraLinhasAuto((() => { const nulls = n => Array(n).fill(null); const top = [[null, 'Banco Safra S/A', 'Emitido em: 17/11/2026 09:56', ...nulls(10)], [null, 'CNPJ: ' + fmtCnpj(CNPJ_BANCO), 'Período de 01/01/2026 até 31/01/2026', ...nulls(10)], nulls(13), ['Recebiveis de antecipação', ...nulls(12)], nulls(13), nulls(13)]; const CAB = ['Data do Pagamento', 'Bandeira', 'Número do Cartão', 'Modalidade', 'Número Sequencial Único', 'Número de Autorização', 'Número do Terminal', 'Estabelecimento Comercial', 'Valor da Parcela', 'Taxa de Administração', 'Taxa de Antecipação', 'Valor Recebido', 'Cartão Estrangeiro']; return [...top, CAB, ['06/01/2026', 'VISA', '************0804', 'Débito', 7001, 71, 10848325, 9990001, 'R$ 100,00', '- R$ 0,90', '- R$ 0,00', 'R$ 99,10', 'Não'], ['Total', ...nulls(12)], nulls(13)]; })(), 'Recebiveis mar (jan).xlsx');
  Adq14._ler = { contratoId: ID_MAR_SAF, lido: recMar, val: Adq14.validarCnpj(recMar, Adq14.contrato(ID_MAR_SAF)) };
  chk('(pré-condição) o arquivo de Recebíveis do Mar Aberto lê sem bloqueio de CNPJ', recMar && !Adq14._ler.val.bloqueios.length, Adq14._ler.val.bloqueios);
  await Adq14.gravarLote(); await espera();
  chk('SafraPay: importar os Recebíveis reais substitui o lote da marca e LIMPA o resíduo "sem movimento" da Agenda (nenhuma marca sobra ao lado de um arquivo real)', !S.adq_lotes.get(idSaf).semMovimento && !S.adq_agendas.has(idSaf) && Adq19.semMov.estado(Adq14.contrato(ID_MAR_SAF), MES) === 'real', [S.adq_lotes.get(idSaf)?.semMovimento, S.adq_agendas.has(idSaf)]);
  // fora da v14.19.2: nada disso roda
  E.flag19 = false; E.toasts.length = 0; const off = await Adq19.semMov.marcar(ID_MAR_SAF, '2026-02'); E.flag19 = true;
  chk('com o recurso desligado "marcar" não faz nada', off === false && !S.adq_lotes.has(Adq14.idLote('SAFRAPAY', CNPJ_MAR, '2026-02')));
  // competência inválida e contrato inexistente
  E.toasts.length = 0; const inv = await Adq19.semMov.marcar(ID_MAR, '2026-13'), ine = await Adq19.semMov.marcar('adq-inexistente', MES);
  chk('competência inválida e contrato inexistente são recusados com aviso', inv === false && ine === false && E.toasts.length === 2, E.toasts);
}

/* ================================================================================================================
   massa compartilhada dos itens 2 a 5: 3 meses de extrato (jan–mar/2026) da Conta A, categorias já definidas (cat manual) e FCX com previsto
   jan: +5000 PIX, +3000 cartões, −2000 folha, −500 outras saídas, +1000 transferência (neutra) · saldo extrato 6.500
   fev: +4000 PIX, −1500 folha, −300 outras · saldo 8.700 · mar: +6000 cartões, −2500 folha, −400 outras · saldo 11.800
   ================================================================================================================ */
const trx = (id, data, valor, hist, cat) => ({ id, data, valor, hist, ...(cat ? { cat } : {}) });
const semear = E => {
  [['ct-a', 'Conta A'], ['ct-c', 'Conta C']].forEach(([id, apelido]) => E.S.contasBancarias.set(id, { id, apelido, ativa: true })); E.bump('contasBancarias');
  const docs = [
    { id: 'ct-a_2026-01_0', contaId: 'ct-a', mes: '2026-01', parte: 0, saldo: { valor: 6500, data: '2026-01-31' }, transacoes: [trx('j1', '2026-01-05', 5000, 'PIX RECEBIDO', 'rec_pix'), trx('j2', '2026-01-10', 3000, 'CARTOES', 'rec_cartoes'), trx('j3', '2026-01-15', -2000, 'FOLHA', 'pag_folha'), trx('j4', '2026-01-20', -500, 'DIVERSOS', 'pag_outros'), trx('j5', '2026-01-25', 1000, 'TRANSFERENCIA ENTRE CONTAS', 'transf')] },
    { id: 'ct-a_2026-02_0', contaId: 'ct-a', mes: '2026-02', parte: 0, saldo: { valor: 8700, data: '2026-02-28' }, transacoes: [trx('f1', '2026-02-05', 4000, 'PIX RECEBIDO', 'rec_pix'), trx('f2', '2026-02-15', -1500, 'FOLHA', 'pag_folha'), trx('f3', '2026-02-20', -300, 'DIVERSOS', 'pag_outros')] },
    { id: 'ct-a_2026-03_0', contaId: 'ct-a', mes: '2026-03', parte: 0, saldo: { valor: 11800, data: '2026-03-31' }, transacoes: [trx('m1', '2026-03-05', 6000, 'CARTOES', 'rec_cartoes'), trx('m2', '2026-03-15', -2500, 'FOLHA', 'pag_folha'), trx('m3', '2026-03-20', -400, 'DIVERSOS', 'pag_outros')] }];
  docs.forEach(d => E.S.extratos.set(d.id, d)); E.bump('extratos');
  E.fcx = livro => { E.fcxVer = (E.fcxVer || 1) + 1; E.fcxApi = livro ? { metodos: { credito: 'Crédito', pix: 'PIX' }, livro: () => livro, saidas: () => [] } : null; };
  E.fcx({ '2026-01-10': { entradas: { 'venda:pix': 7000 }, saidas: {} }, '2026-02-10': { entradas: { 'venda:pix': 4500 }, saidas: {} }, '2026-03-10': { entradas: { 'venda:pix': 6500 }, saidas: {} } });
  return E;
};
const perTri = () => E_DFC.DFC_RESUMO.periodo('personalizado', '2026-03', '2026-01');
const E_DFC = semear(ambiente({ g18: true }));
const { DFC_RESUMO, DFC_HORIZ, FluxoDFC: FD } = E_DFC;
const modeloMes = (mes, E = E_DFC) => E.DFC_RESUMO.montar(E.FluxoDFC.dadosResumo06(E.DFC_RESUMO.periodo('mes', mes, mes), null));
const htmlResumo = (m, E = E_DFC) => E.DFC_RESUMO.html(m, { razao: 'Resilienza Negocios Ltda', cnpj: CNPJ_RES, logo: '', marca: 'Esposende', emitidoEm: '19/11/2026', notas: 'Nota da controladoria.', signatarios: [{ nome: 'Ana', cargo: 'Diretora' }, { nome: 'Bia', cargo: 'Contadora', registro: 'CRC 123' }] });
const TEXTO_PREV = /Previsto|previsto|Orçado|orçado|Variação \((R\$|%)\)|premissas do FCX|Dif\./;

/* ================================================================================================================
   2 · DFC EXECUTIVA SÓ COM O REALIZADO
   ================================================================================================================ */
console.log('\n── 2 · DFC executiva só com o Realizado ──');
{
  const E = E_DFC; E.flag19 = false;
  const m0 = modeloMes('2026-01'), h0 = htmlResumo(m0);
  chk('referência (recurso DESLIGADO = v14.19.1): o Quadro 2 traz Previsto (FCX), Variação (R$) e Variação (%) quando o FCX informa premissas', m0.quadro2.temPrevisto === true && /Previsto \(FCX\)/.test(h0) && /Variação \(R\$\)/.test(h0) && /Variação \(%\)/.test(h0), [m0.quadro2.temPrevisto, h0.match(/Previsto \(FCX\)|Variação \([R$%]+\)/g)]);
  E.flag19 = true;
  const m = modeloMes('2026-01'), h = htmlResumo(m);
  chk('com a v14.19.2 o Quadro 2 sai só com o Realizado, mesmo com premissas no FCX: sem previsto em nenhuma linha, sem variação e sem o aviso de "premissas indisponíveis"', m.quadro2.temPrevisto === false && m.quadro2.grupos.every(g => g.linhas.every(l => l.previsto == null && l.variacao == null) && g.subtotal.previsto == null) && m.quadro2.total.previsto == null && !m.avisos.some(a => /premissas/i.test(a)), [m.quadro2.temPrevisto, m.avisos]);
  chk('o Resumo Executivo em PDF A4 não tem colunas, quadros, legenda ou rodapé de Previsto/Orçado/Variação (Dif.)', !TEXTO_PREV.test(h), h.match(TEXTO_PREV));
  chk('mantém o essencial: Entradas, Saídas, Geração líquida de caixa e a coluna "Realizado (OFX)" do demonstrativo', /Realizado \(OFX\)/.test(h) && m.indicadores.operacional.entradas === 8000 && m.indicadores.operacional.saidas === 2500 && m.indicadores.operacional.liquido === 5500, [m.indicadores.operacional]);
  chk('mantém Saldo inicial e Saldo final (conciliado e pelo extrato) do período', /Saldo inicial/i.test(h) && /Saldo final/i.test(h) && m.saldos.inicial.valor === 0 && m.saldos.final.calculado === 6500 && m.saldos.final.extrato === 6500, [m.saldos.inicial, m.saldos.final]);
  chk('a legenda do demonstrativo fica só com a definição do Realizado e o rodapé não cita as premissas do FCX', /Realizado = lançamentos dos extratos bancários \(OFX\) classificados por categoria\./.test(h) && !/premissas do FCX/.test(h));
  // reconciliação de cartões segue no Resumo
  const Ec = await FX.cenario({ g18: true }); OFX_JAN(Ec); semear(Ec); Ec.S.extratos.set('xa', { id: 'xa', contaId: 'ct-a', mes: '2026-01', transacoes: [FX.tr('a1', '2026-01-06', Ec.e06, 'CREDITO GETNET LIQUIDACAO')] }); Ec.bump('extratos');
  const mc = modeloMes('2026-01', Ec), hc = htmlResumo(mc, Ec);
  chk('o Quadro de Reconciliação de Recebíveis de Cartões (Auditoria × Caixa OFX) continua no Resumo, e continua sem Previsto', !!mc.cartoes18 && /Reconciliação de Recebíveis de Cartões \(Auditoria × Caixa OFX\)/.test(hc) && !/Previsto \(FCX\)|Variação \((R\$|%)\)/.test(hc), [!!mc.cartoes18, hc.match(/Reconcilia[^<]{0,60}/)]);
  // modelo de exportação da DFC do mês: saldos entram (Excel/CSV/PDF)
  E.FluxoDFC.ui.mes = '2026-02'; E.FluxoDFC.ui.conta = ''; E.FluxoDFC.mesLabel = m => m;
  const s = E.FluxoDFC.saldosMes19('2026-02', ''), s2 = E.FluxoDFC.saldosMes19('2026-02', '');
  chk('saldosMes19: Saldo inicial, variação, Saldo final conciliado e pelo extrato do mês (fev: 6.500 + 2.200 = 8.700) — memorizado entre chamadas', s && s.inicial === 6500 && s.variacao === 2200 && s.final === 8700 && s.extrato === 8700 && s === s2, s);
  E.FluxoDFC.ui.conta = 'ct-a'; const sA = E.FluxoDFC.saldosMes19('2026-02', 'ct-a'); E.FluxoDFC.ui.conta = '';
  chk('saldosMes19 respeita a conta escolhida (Conta A = mesma movimentação) e não confunde com a chave da consulta "todas"', sA && sA.final === 8700 && sA !== s);
  const m2 = E.FluxoDFC.modeloExport('cruzamento');
  chk('exportação: a antiga aba "Realizado × Previsto" exporta a DFC do mês (sem previsto/orçado) e acrescenta as linhas de Saldo inicial e Saldo final', m2 && m2.t === 'dfc' && m2.linhas.some(l => /Saldo inicial/.test(l[1]) && l[3] === 6500) && m2.linhas.some(l => /Saldo final do mês \(conciliado\)/.test(l[1]) && l[3] === 8700) && m2.linhas.some(l => /extrato \(OFX\)/.test(l[1]) && l[3] === 8700) && !m2.linhas.some(l => TEXTO_PREV.test(l.join(' '))), m2 && m2.linhas.slice(-5));
  E.flag19 = false; const m3 = E.FluxoDFC.modeloExport('dfc'); E.flag19 = true;
  chk('recurso desligado: a exportação da DFC do mês é a da v14.19.1 (sem as linhas de Saldo)', m3 && !m3.linhas.some(l => /Saldo inicial/.test(l[1])));
  E.FluxoDFC.ui.sub = 'cruzamento'; const hr = E.FluxoDFC.render ? (E.FluxoDFC.render.toString().length > 0) : false;
}

/* ================================================================================================================
   3 · RELATÓRIO DFC HORIZONTAL (MÊS A MÊS)
   ================================================================================================================ */
console.log('\n── 3 · relatório DFC horizontal ──');
{
  const E = E_DFC, per = perTri();
  const mods = per.meses.map(mes => ({ mes, modelo: modeloMes(mes) })), acum = DFC_RESUMO.montar(E.FluxoDFC.dadosResumo06(per, null)), h = DFC_HORIZ.montar(mods, acum);
  const lin = rot => h.linhas.find(l => l.rotulo === rot), cat = id => h.linhas.find(l => l.id === id);
  chk('o formato Horizontal tem uma coluna por mês (jan/fev/mar de 2026) e a coluna final "Total Acumulado"', h.meses.length === 3 && h.meses.map(x => x.mes).join() === '2026-01,2026-02,2026-03' && h.rotuloTotal === 'Total Acumulado' && h.linhas.every(l => l.v.length === 3 || l.tipo === 'titulo'), [h.meses, h.rotuloTotal]);
  chk('as linhas trazem a estrutura inteira da DFC: síntese operacional, grupos (operacional, investimento, financiamento) com as categorias, subtotais, variação líquida e saldos', ['Síntese operacional', 'Atividades operacionais', 'Atividades de investimento', 'Atividades de financiamento', 'Saldos de caixa'].every(t => lin(t)?.tipo === 'titulo') && !!cat('rec_pix') && !!cat('rec_cartoes') && !!cat('pag_folha') && !!cat('pag_outros') && !!lin('Variação líquida de caixa') && !!lin('Saldo inicial') && !!lin('Saldo final (conciliado)'), h.linhas.map(l => l.rotulo));
  chk('categoria mês a mês: PIX jan 5.000 · fev 4.000 · mar 0 · Total 9.000; cartões jan 3.000 · fev 0 · mar 6.000 · Total 9.000; folha −2.000 · −1.500 · −2.500 · Total −6.000', igual(cat('rec_pix').v, [5000, 4000, 0]) && cat('rec_pix').t === 9000 && igual(cat('rec_cartoes').v, [3000, 0, 6000]) && cat('rec_cartoes').t === 9000 && igual(cat('pag_folha').v, [-2000, -1500, -2500]) && cat('pag_folha').t === -6000, [cat('rec_pix'), cat('rec_cartoes'), cat('pag_folha')]);
  chk('"Variação líquida de caixa": jan 5.500 · fev 2.200 · mar 3.100 · Total Acumulado 10.800 (a soma dos meses fecha com o total)', igual(lin('Variação líquida de caixa').v, [5500, 2200, 3100]) && lin('Variação líquida de caixa').t === 10800 && r2(lin('Variação líquida de caixa').v.reduce((a, b) => a + b, 0)) === lin('Variação líquida de caixa').t, lin('Variação líquida de caixa'));
  const somaOk = h.linhas.filter(l => ['item', 'subtotal', 'total'].includes(l.tipo) && !l.neutra && l.v.length && l.rotulo !== 'Saldo inicial' && !/^\(\+\/−\)/.test(l.rotulo) && !/^Saldo/.test(l.rotulo));
  chk('em TODAS as linhas de valor (categorias, subtotais, síntese, variação) a soma dos meses é igual ao Total Acumulado', somaOk.length >= 10 && somaOk.every(l => l.v.every(x => x != null) && Math.abs(r2(l.v.reduce((a, b) => a + b, 0)) - l.t) < 0.011), somaOk.filter(l => Math.abs(r2(l.v.reduce((a, b) => a + b, 0)) - l.t) >= 0.011).map(l => [l.rotulo, l.v, l.t]));
  chk('movimentação neutra (transferência entre contas próprias de jan) aparece à parte, fora da variação líquida: jan 1.000 · Total 1.000', (() => { const n = h.linhas.find(l => l.neutra); return !!n && igual(n.v, [1000, 0, 0]) && n.t === 1000; })());
  chk('saldos: inicial 0 · 6.500 · 8.700 (cada mês começa onde o anterior terminou); final conciliado 6.500 · 8.700 · 11.800; no Total Acumulado, inicial do período 0 e final 11.800; extrato OFX confere', igual(lin('Saldo inicial').v, [0, 6500, 8700]) && lin('Saldo inicial').t === 0 && igual(lin('Saldo final (conciliado)').v, [6500, 8700, 11800]) && lin('Saldo final (conciliado)').t === 11800 && igual(lin('Saldo final segundo o extrato bancário (OFX)').v, [6500, 8700, 11800]), [lin('Saldo inicial'), lin('Saldo final (conciliado)')]);
  chk('sem previsto: o modelo horizontal não tem coluna nem linha de Previsto/Orçado/Variação percentual', !h.linhas.some(l => TEXTO_PREV.test(l.rotulo)) && !TEXTO_PREV.test(h.meses.map(x => x.rotulo).join()), h.linhas.map(l => l.rotulo));
  const hp = DFC_HORIZ.html(h, { razao: 'Resilienza Negocios Ltda', cnpj: CNPJ_RES, logo: '', marca: 'Esposende', emitidoEm: '19/11/2026', notas: 'Nota.', signatarios: [{ nome: 'Ana', cargo: 'Diretora' }, { nome: 'Bia', cargo: 'Contadora' }] });
  chk('PDF: o documento traz "Horizontal — Mês a Mês", os 3 meses lado a lado em colunas, o Total Acumulado, os dados do emissor, as notas e as assinaturas — e nada de Previsto', /Horizontal — Mês a Mês/.test(hp) && ['jan/2026', 'fev/2026', 'mar/2026'].every(r => new RegExp(`<th class="n">${r}</th>`).test(hp)) && /<th class="n tt">Total Acumulado<\/th>/.test(hp) && /Resilienza Negocios Ltda/.test(hp) && /Quadro 2 — Notas Explicativas/.test(hp) && /rx-ass/.test(hp) && !TEXTO_PREV.test(hp), hp.match(TEXTO_PREV));
  chk('o CSS do horizontal reduz a fonte conforme o número de meses (até 4 · 6 · 9 · 12 · mais)', [3, 6, 9, 12, 20].map(n => +/font-size:([\d.]+)px/.exec(DFC_HORIZ.css(n))[1]).every((v, i, a) => i === 0 || v < a[i - 1]), [3, 6, 9, 12, 20].map(n => DFC_HORIZ.css(n).match(/font-size:[\d.]+px/)[0]));
  const M = DFC_HORIZ.matriz(h), csv = DFC_HORIZ.csv(h);
  chk('matriz (Excel): cabeçalho "Atividade / categoria · jan/2026 · fev/2026 · mar/2026 · Total Acumulado", números como número e títulos de grupo sem valores', igual(M.cab, ['Atividade / categoria', 'jan/2026', 'fev/2026', 'mar/2026', 'Total Acumulado']) && M.linhas.every(l => l.length === 5) && M.linhas.find(l => l[0] === 'PIX recebidos' || /PIX/.test(l[0]))[4] === 9000 && igual(M.linhas.find(l => l[0] === 'Atividades operacionais').slice(1), [null, null, null, null]), M.linhas.slice(0, 6));
  chk('CSV: separador decimal vírgula, valores negativos com sinal e sem "R$"', csv[0].length === 5 && csv.some(l => l[0] === 'Folha de pagamento e benefícios' && l[1] === '-2000,00' && l[4] === '-6000,00') && !csv.flat().some(c => /R\$/.test(String(c))), csv.slice(0, 8));
  chk('fmt: milhar com ponto, decimal com vírgula, negativo com sinal; vazio vira travessão', DFC_HORIZ.fmt(1234.5) === '1.234,50' && DFC_HORIZ.fmt(-6000) === '-6.000,00' && DFC_HORIZ.fmt(null) === '—' && DFC_HORIZ.fmt(0) === '0,00');

  // fluxo completo do botão (formulário → pré-visualização A4 paisagem) com o modal de progresso
  ModalProgressoCarga_AUTO(E);
  const form = { tipo: 'personalizado', mes: '2026-03', de: '2026-01', formato: 'horizontal', razao: 'Resilienza Negocios Ltda', cnpj: CNPJ_RES, s1nome: 'Ana', s1cargo: 'Diretora', s2nome: 'Bia', s2cargo: 'Contadora', s2crc: 'CRC 123', notas: '', empresaId: 'resilienza' };
  E.form = form; E.previas.length = 0; E.audits.length = 0; E.toasts.length = 0;
  await FD.gerarResumo06({});
  const pv = E.previas[0];
  chk('"Gerar pré-visualização A4" com formato Horizontal e 3 meses abre o documento em A4 PAISAGEM com os 3 meses e o Total Acumulado, e registra a emissão na auditoria', E.previas.length === 1 && pv.doc.opcoes.paisagem === true && /Total Acumulado/.test(pv.doc.corpo) && /jan\/2026/.test(pv.doc.corpo) && /Horizontal_Esposende_2026-01_a_2026-03/.test(pv.nome) && E.audits.some(a => /Horizontal mês a mês/.test(a.rotulo)), [E.previas.length, pv && pv.nome, E.audits.map(a => a.rotulo)]);
  E.form = { ...form, tipo: 'mes', de: '' }; E.previas.length = 0; E.toasts.length = 0; await FD.gerarResumo06({});
  chk('Horizontal exige 2 ou mais meses: com "Mês de referência" (1 mês) o painel avisa e não gera nada', E.previas.length === 0 && E.toasts.some(t => /2 ou mais meses/.test(t)), E.toasts);
  E.form = { ...form, formato: 'acumulado' }; E.previas.length = 0;
  let caiu = false; const orig = FD._o192.gerarResumo06; FD._o192.gerarResumo06 = function () { caiu = true; }; await FD.gerarResumo06({}); FD._o192.gerarResumo06 = orig;
  chk('formato Acumulado (e Mês único) segue pelo caminho de sempre (gerarResumo06 original), sem tocar no horizontal', caiu === true && E.previas.length === 0);
  // v14.08 em diante o modal é o "Padrão Banco / Institucional": o botão chama gerarResumo08 (emitente = Matriz do Cadastro de Lojas) — o Horizontal tem de valer nele também
  E.g08on = true; E.matrizRes = { origem: 'loja', matriz: { id: 'loja:00', razao: 'Matriz QA Ltda', cnpj: CNPJ_RES } };
  const form08 = { ...form, razao: '', cnpj: '', empresaId: '' };
  E.form = form08; E.previas.length = 0; E.audits.length = 0; E.toasts.length = 0; await FD.gerarResumo08({});
  const pv8 = E.previas[0];
  chk('v14.08 · "Gerar pré-visualização A4" do modal da Matriz (gerarResumo08) com formato Horizontal e 3 meses abre o A4 PAISAGEM com os 3 meses, o Total Acumulado e a Razão Social da MATRIZ (não a do formulário)', E.previas.length === 1 && pv8.doc.opcoes.paisagem === true && /Total Acumulado/.test(pv8.doc.corpo) && /jan\/2026/.test(pv8.doc.corpo) && /Matriz QA Ltda/.test(pv8.doc.corpo) && E.audits.some(a => /Horizontal mês a mês/.test(a.rotulo || '')), [E.previas.length, pv8 && pv8.doc.opcoes, E.toasts]);
  let caiu8 = 0; const orig8 = FD._o192.gerarResumo08; FD._o192.gerarResumo08 = function () { caiu8++; };
  E.form = { ...form08, formato: 'acumulado' }; E.previas.length = 0; await FD.gerarResumo08({}); const mesUnico8 = caiu8; E.form = { ...form08, tipo: 'mes', de: '' }; E.previas.length = 0; E.toasts.length = 0; await FD.gerarResumo08({}); FD._o192.gerarResumo08 = orig8;
  chk('v14.08 · formato Acumulado segue pelo gerarResumo08 original; Horizontal com 1 mês só avisa ("2 ou mais meses") e nada é gerado', mesUnico8 === 1 && caiu8 === 1 && E.previas.length === 0 && E.toasts.some(t => /2 ou mais meses/.test(t)), [mesUnico8, caiu8, E.toasts]);
  E.matrizRes = { matriz: null }; E.form = form08; E.previas.length = 0; E.toasts.length = 0; E.baixados.length = 0; await FD.gerarResumo08({}); await FD.exportarResumo19({}, 'csv');
  chk('v14.08 · sem Empresa Matriz no Cadastro de Lojas o Horizontal (A4 e exportações) não gera nada e explica o motivo, como o Resumo de sempre', E.previas.length === 0 && E.baixados.length === 0 && E.toasts.length >= 2 && E.toasts.every(t => /Matriz/.test(t)), E.toasts);
  E.g08on = false; E.matrizRes = null;
  // Excel / CSV
  const guardado = []; E.xlsxFake = { utils: { aoa_to_sheet: aoa => ({ aoa }), encode_cell: ({ r, c }) => `C${r}_${c}`, book_new: () => ({ abas: [] }), book_append_sheet: (wb, ws, nome) => wb.abas.push([nome, ws.aoa]) }, write: wb => { guardado.push(wb); return new Uint8Array([1, 2, 3]); } };
  E.form = form; E.baixados.length = 0; await FD.exportarResumo19({}, 'xlsx');
  const wb = guardado[0], aba = wb && wb.abas[0];
  chk('Excel (.xlsx): uma aba "DFC Horizontal" com título, período, a linha de cabeçalho (meses + Total Acumulado) e todas as linhas da DFC; arquivo DFC_Horizontal_…xlsx', !!aba && aba[0] === 'DFC Horizontal' && aba[1].some(l => igual(l, ['Atividade / categoria', 'jan/2026', 'fev/2026', 'mar/2026', 'Total Acumulado'])) && /^DFC_Horizontal_Esposende_2026-01_a_2026-03\.xlsx$/.test(E.baixados.at(-1)[0]), [aba && aba[1].slice(0, 6), E.baixados.map(b => b[0])]);
  E.baixados.length = 0; await FD.exportarResumo19({}, 'csv');
  const [nomeCsv, blobCsv] = E.baixados[0] || [];
  const bytesCsv = blobCsv ? new Uint8Array(await blobCsv.arrayBuffer()) : [], txtCsv = blobCsv ? await blobCsv.text() : '';
  chk('CSV: arquivo DFC_Horizontal_…csv com BOM UTF-8 (EF BB BF), separador ";" e a linha de cabeçalho dos meses', /^DFC_Horizontal_Esposende_2026-01_a_2026-03\.csv$/.test(nomeCsv) && bytesCsv[0] === 0xEF && bytesCsv[1] === 0xBB && bytesCsv[2] === 0xBF && txtCsv.startsWith('Atividade / categoria;jan/2026;fev/2026;mar/2026;Total Acumulado'), [nomeCsv, [...bytesCsv.slice(0, 4)], txtCsv.slice(0, 80)]);
  E.form = { ...form, formato: 'acumulado', tipo: 'mes', mes: '2026-02', de: '' }; E.baixados.length = 0; guardado.length = 0; await FD.exportarResumo19({}, 'xlsx');
  chk('Excel/CSV também existem para o Mês único (uma coluna "Realizado (OFX)", só com o Realizado)', E.baixados.length === 1 && /^DFC_Esposende_2026-02\.xlsx$/.test(E.baixados[0][0]) && guardado[0].abas[0][1].some(l => l[0] === 'Atividade / categoria' && l.length === 2 && l[1] === 'Realizado (OFX)'), guardado[0] && guardado[0].abas[0][1].slice(3, 6));
  const pr = FD.podeResumo06; FD.podeResumo06 = () => false; E.toasts.length = 0; E.previas.length = 0; E.baixados.length = 0; E.form = form; await FD.exportarResumo19({}, 'csv'); await FD.gerarResumo06({}); FD.podeResumo06 = pr;
  chk('as exportações e o horizontal respeitam o mesmo perfil do Resumo (podeResumo06): sem permissão não gera nem baixa nada e avisa', E.baixados.length === 0 && E.previas.length === 0 && E.toasts.filter(t => /permiss/i.test(t)).length === 2, E.toasts);
}

/* ================================================================================================================
   4 · EXPORTAÇÃO COMPLETA DO EXTRATO OFX (todas as páginas, respeitando Conta, Mês, Tipo, Categoria e Busca)
   ================================================================================================================ */
console.log('\n── 4 · exportação completa do Extrato OFX ──');
/** massa: Conta A · jan com +450 lançamentos (além dos 5 semeados) e Conta C · jan com 30 — bem mais que a página de 200 da tela */
const CATS_G = ['rec_pix', 'rec_cartoes', 'pag_folha', 'pag_outros'];
const massaExtrato = E => {
  const A = [], C = [];
  for (let i = 1; i <= 450; i++) { const k = i % 4, dia = String(1 + (i % 28)).padStart(2, '0'); A.push(trx('g' + i, `2026-01-${dia}`, k < 2 ? 100 + i : -(50 + i), (i % 10 === 0 ? 'ALUGUEL LOJA ' : 'LANCAMENTO ') + i, CATS_G[k])); }
  for (let i = 1; i <= 30; i++) C.push(trx('c' + i, `2026-01-${String(1 + (i % 28)).padStart(2, '0')}`, i % 2 ? 70 + i : -(30 + i), 'CONTA C ' + i, i % 2 ? 'rec_pix' : 'pag_outros'));
  E.S.extratos.set('ct-a_2026-01_1', { id: 'ct-a_2026-01_1', contaId: 'ct-a', mes: '2026-01', parte: 1, transacoes: A });
  E.S.extratos.set('ct-c_2026-01_0', { id: 'ct-c_2026-01_0', contaId: 'ct-c', mes: '2026-01', parte: 0, transacoes: C });
  E.bump('extratos'); return { A, C };
};
const rawJan = E => [...E.S.extratos.values()].filter(d => d.mes === '2026-01').flatMap(d => d.transacoes.map(t => ({ ...t, contaId: d.contaId })));
const zerarUi = E => Object.assign(E.FluxoDFC.ui, { mes: '2026-01', conta: '', busca: '', filtro: 'todas', forn: '', limite: 200, cat19: '' });
{
  const E = semear(ambiente({ g18: true })), FDx = E.FluxoDFC; massaExtrato(E);
  const lista = () => FDx.listaFiltrada19(FDx.todas19()), raw = rawJan(E), nomeCat = id => (E.DFC.cat(id) || {}).nome;
  zerarUi(E);
  const L0 = lista();
  chk('(massa) 485 lançamentos em janeiro (455 da Conta A + 30 da Conta C) — muito mais que a página de 200 linhas da tela', raw.length === 485 && raw.filter(t => t.contaId === 'ct-a').length === 455 && raw.filter(t => t.contaId === 'ct-c').length === 30);
  chk('sem filtros a lista do relatório traz TODOS os 485 lançamentos: o limite de página da tela (200) não corta nada', L0.length === 485 && FDx.ui.limite === 200, [L0.length, FDx.ui.limite]);
  chk('e a ordem é a da tela: data mais recente primeiro e, no mesmo dia, o maior valor absoluto primeiro', L0.every((t, i) => i === 0 || L0[i - 1].data > t.data || (L0[i - 1].data === t.data && Math.abs(L0[i - 1].valor) >= Math.abs(t.valor))));
  chk('limite menor ou maior não muda a lista completa (a página só limita o que a TELA desenha)', (() => { FDx.ui.limite = 50; const a = lista().length; FDx.ui.limite = 5000; const b = lista().length; FDx.ui.limite = 200; return a === 485 && b === 485; })());

  FDx.ui.conta = 'ct-a'; const nA = lista().length; FDx.ui.conta = 'ct-c'; const nC = lista().length; FDx.ui.conta = '';
  chk('filtro CONTA: Conta A = 455 e Conta C = 30 (todos, sem corte)', nA === 455 && nC === 30, [nA, nC]);
  FDx.ui.mes = '2026-02'; const nFev = lista().length; FDx.ui.mes = '2026-03'; const nMar = lista().length; FDx.ui.mes = '2026-01';
  chk('filtro MÊS: fevereiro (3) e março (3) trazem só os lançamentos do mês escolhido', nFev === 3 && nMar === 3, [nFev, nMar]);
  FDx.ui.filtro = 'e'; const ent = lista(); FDx.ui.filtro = 's'; const sai = lista(); FDx.ui.filtro = 'sem'; const sem = lista(); FDx.ui.filtro = 'todas';
  chk('filtro TIPO: Entradas só com valor positivo, Saídas só com valor negativo — as contagens fecham com o arquivo bruto', ent.length === raw.filter(t => t.valor > 0).length && sai.length === raw.filter(t => t.valor < 0).length && ent.every(t => t.valor > 0) && sai.every(t => t.valor < 0), [ent.length, sai.length]);
  chk('filtro TIPO "Sem regra": só o que caiu na classificação padrão (nenhuma das linhas da massa, todas já classificadas à mão)', sem.length === raw.filter(t => !t.cat).length && sem.every(t => t.cls.origem === 'padrão'), sem.length);
  FDx.ui.busca = 'aluguel'; const bus = lista(); FDx.ui.busca = 'ALUGUEL LOJA 450'; const bus2 = lista(); FDx.ui.busca = 'inexistente zzz'; const bus3 = lista(); FDx.ui.busca = '';
  chk('filtro BUSCA: "aluguel" (sem diferenciar caixa) acha as 45 linhas do histórico; busca exata acha 1; texto inexistente acha 0', bus.length === 45 && bus.every(t => /ALUGUEL/.test(t.hist)) && bus2.length === 1 && bus3.length === 0, [bus.length, bus2.length, bus3.length]);
  FDx.ui.cat19 = 'pag_folha'; const cf = lista(); FDx.ui.cat19 = 'rec_pix'; const cp = lista(); FDx.ui.cat19 = '';
  chk('filtro CATEGORIA (novo): "Folha" traz as 114 linhas (113 da massa + 1 semeada) e só elas; "PIX" idem com a Conta C', cf.length === raw.filter(t => t.cat === 'pag_folha').length && cf.every(t => t.cls.categoria === 'pag_folha') && cp.length === raw.filter(t => t.cat === 'rec_pix').length && cp.some(t => t.contaId === 'ct-c'), [cf.length, cp.length]);
  FDx.ui.conta = 'ct-a'; FDx.ui.filtro = 's'; FDx.ui.cat19 = 'pag_folha'; FDx.ui.busca = 'lancamento';
  const comb = lista(), combEsp = raw.filter(t => t.contaId === 'ct-a' && t.valor < 0 && t.cat === 'pag_folha' && /lancamento/i.test(t.hist));
  chk('filtros COMBINADOS (Conta A + Saídas + categoria Folha + busca "lancamento") continuam valendo juntos e sem corte de página', comb.length === combEsp.length && comb.length >= 90, [comb.length, combEsp.length]);
  zerarUi(E);
  chk('com o recurso DESLIGADO o filtro de categoria não age (a v14.19.1 não tinha esse campo): filtroCat19 libera tudo', (() => { E.flag19 = false; FDx.ui.cat19 = 'pag_folha'; const r = FDx.filtroCat19({ cls: { categoria: 'rec_pix' } }); E.flag19 = true; FDx.ui.cat19 = ''; return r === true; })());

  // barra de ferramentas: filtro de Categoria + botões do ajuste em lote
  const todas = FDx.todas19(), tb = FDx.toolbarCat19(todas, true), tbSem = FDx.toolbarCat19(todas, false);
  chk('barra do Extrato: campo "Categoria DFC" (id bcCat19, data-k="cat19" para o handler fd-bc existente) com a contagem por categoria só do que existe no mês', /id="bcCat19"/.test(tb) && /data-a="fd-bc" data-k="cat19"/.test(tb) && tb.includes(`${escH(nomeCat('pag_folha'))} (${raw.filter(t => t.cat === 'pag_folha').length})</option>`) && tb.includes(`${escH(nomeCat('rec_pix'))} (${raw.filter(t => t.cat === 'rec_pix').length})</option>`) && !tb.includes('value="pag_impostos"'), tb.slice(0, 500));
  chk('com permissão de classificar aparecem "Exportar p/ Ajuste em Lote" e "Importar Ajuste em Lote" (+ seletor de arquivo oculto); sem permissão só o filtro', /data-a="fd-lote-exportar"[^>]*>Exportar p\/ Ajuste em Lote</.test(tb) && /data-a="fd-lote-importar"[^>]*>Importar Ajuste em Lote</.test(tb) && /id="bcLoteArq" data-a="fd-lote-arq"[^>]*hidden/.test(tb) && !/fd-lote-/.test(tbSem) && /bcCat19/.test(tbSem));
  FDx.ui.cat19 = 'categoria_que_nao_existe_no_mes'; FDx.toolbarCat19(todas, true); const resetou = FDx.ui.cat19 === ''; FDx.ui.cat19 = '';
  chk('uma categoria escolhida que não existe no mês/conta é descartada (não deixa a lista vazia sem explicação)', resetou);
  E.flag19 = false; const tbOff = FDx.toolbarCat19(todas, true); E.flag19 = true;
  chk('recurso desligado: a barra não ganha nada (string vazia)', tbOff === '');

  /* ---- relatório completo: dadosExtratosCompleto19 com a renderização REAL trocada por um stub e DOM mínimo ---- */
  const lin = t => [Fmt_data(t.data), 'Conta', t.hist, t.valor.toFixed(2), 'cat'];
  function Fmt_data(d) { return d.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1'); }
  let renderChamadas = 0, limiteVisto = null; const dom0 = globalThis.DOMParser;
  // a renderização do stub guarda as linhas e devolve um texto; o DOMParser do stub devolve a "tabela" com essas linhas (o DOM real é conferido no E2E do navegador)
  FDx.renderExtratos = function () { renderChamadas++; limiteVisto = this.ui.limite; globalThis.__ULTIMO = { __rows: this.listaFiltrada19(this.todas19()).slice(0, this.ui.limite).map(t => ({ cells: lin(t) })) }; return '<table data-tp-fonte19="extratos"></table>'; };
  globalThis.DOMParser = class { parseFromString() { const r = globalThis.__ULTIMO; return { querySelector: () => (r && r.__rows ? { tBodies: [{ rows: r.__rows }] } : null) }; } };
  const TP = { _est: {}, _col: new Intl.Collator('pt-BR'), txt: c => String(c), cel: (tr, i) => tr.cells[i], chave: (k, s) => (k === 'num' ? parseFloat(s) : s) };
  const tab = () => ({ dataset: { tpFonte19: 'extratos' }, _tp: { chave: 'extratos', cols: [{ exporta: true, i: 0, kind: 'txt' }, { exporta: true, i: 1, kind: 'txt' }, { exporta: true, i: 2, kind: 'txt' }, { exporta: true, i: 3, kind: 'num' }, { exporta: false, i: 4, kind: 'txt' }] } });
  const base = { filtros: ['Busca: —'], linhas: new Array(200).fill(['x']), total: 200 };
  FDx.ui.filtro = 'e'; FDx.ui.limite = 200;
  const R = FDx.dadosExtratosCompleto19(TP, tab(), base);
  chk('relatório completo: reabre o limite de página só durante a renderização (viu MAX_SAFE_INTEGER) e devolve o limite da tela (200) depois', limiteVisto === Number.MAX_SAFE_INTEGER && FDx.ui.limite === 200 && renderChamadas === 1, [limiteVisto, FDx.ui.limite]);
  chk('devolve TODAS as linhas do filtro (Entradas = ' + raw.filter(t => t.valor > 0).length + '), não as 200 da tela; as colunas não exportáveis ficam de fora; marca completo19', R.total === raw.filter(t => t.valor > 0).length && R.linhas.length === R.total && R.total > 200 && R.linhas[0].length === 4 && R.completo19 === true, [R.total, R.linhas[0]]);
  chk('os filtros do cabeçalho do relatório incluem o Mês e o Tipo ativos (Entradas), sem duplicar o que já havia', R.filtros.includes('Mês: 2026-01') && R.filtros.includes('Tipo: Entradas') && R.filtros.includes('Busca: —') && R.filtros.filter(x => /^Tipo:/.test(x)).length === 1, R.filtros);
  TP._est.extratos = { col: 3, dir: 'asc' };
  const Ra = FDx.dadosExtratosCompleto19(TP, tab(), base), vals = Ra.linhas.map(l => parseFloat(l[3]));
  chk('respeita a ordenação escolhida na barra da tabela: valor crescente em TODAS as linhas (não só nas 200 primeiras)', Ra.total === R.total && vals.every((v, i) => i === 0 || vals[i - 1] <= v), vals.slice(0, 5));
  TP._est.extratos = { col: 3, dir: 'desc' }; const Rd = FDx.dadosExtratosCompleto19(TP, tab(), base), vd = Rd.linhas.map(l => parseFloat(l[3]));
  chk('e a decrescente também', vd.every((v, i) => i === 0 || vd[i - 1] >= v) && vd[0] >= vd.at(-1));
  TP._est.extratos = undefined; FDx.ui.filtro = 'todas';
  const RT = FDx.dadosExtratosCompleto19(TP, tab(), { ...base, filtros: [] });
  chk('sem filtro de Tipo, o cabeçalho não ganha linha "Tipo:" e o relatório sai com os 485 lançamentos', RT.total === 485 && !RT.filtros.some(x => /^Tipo:/.test(x)) && RT.filtros[0] === 'Mês: 2026-01', [RT.total, RT.filtros]);
  FDx.renderExtratos = function () { throw new Error('falha de renderização'); };
  let caiu = null; try { FDx.dadosExtratosCompleto19(TP, tab(), base); } catch (e) { caiu = e.message; }
  chk('se a renderização falha o limite da tela é restaurado mesmo assim (finally) — a tela não fica "sem página"', caiu === 'falha de renderização' && FDx.ui.limite === 200);
  FDx.renderExtratos = function () { return '<nada>'; }; globalThis.__ULTIMO = null;
  chk('sem tabela na renderização (extrato vazio) devolve o relatório original sem erro', FDx.dadosExtratosCompleto19(TP, tab(), base) === base);
  globalThis.DOMParser = dom0; delete globalThis.__ULTIMO;

  /* ---- ganchos reais no TabelaPro (código do painel, com TabelaPro/FluxoDFC de brincadeira) ---- */
  const trecho = corta('/* o "Gerar Relatório / Exportar" da tabela do Extrato leva todas as páginas', '/* ---- fim do Extrato OFX v14.19.2');
  const mkTP = (flag, falha = false) => {
    const log = { completo: 0, modal: [] }, UIx = { modal(o) { log.modal.push(o); } };
    const TabelaPro = { dados(t) { return { base: true }; }, abrirExportar(t) { UIx.modal({ corpo: 'Serão exportados 200 registro(s), exatamente como estão na tela.' }); } };
    const FluxoDFCx = { dadosExtratosCompleto19(tp, t, r) { log.completo++; if (falha) throw new Error('x'); return { completo: true }; } };
    new Function('TabelaPro', 'FluxoDFC', 'g19', 'UI', trecho)(TabelaPro, FluxoDFCx, () => flag, UIx);
    return { TabelaPro, log, UIx };
  };
  const tExtr = { dataset: { tpFonte19: 'extratos' }, _tp: {} }, tOutra = { dataset: {}, _tp: {} };
  { const { TabelaPro, log } = mkTP(true);
    chk('TabelaPro.dados: tabela do Extrato (data-tp-fonte19) vai pelo relatório completo; qualquer outra tabela segue pelo caminho original', igual(TabelaPro.dados(tExtr), { completo: true }) && igual(TabelaPro.dados(tOutra), { base: true }) && log.completo === 1); }
  { const { TabelaPro } = mkTP(false); chk('recurso desligado: a tabela do Extrato segue pelo caminho original (v14.19.1)', igual(TabelaPro.dados(tExtr), { base: true })); }
  { const { TabelaPro } = mkTP(true, true); const w = console.warn; console.warn = () => {}; const r = TabelaPro.dados(tExtr); console.warn = w; chk('se o relatório completo falhar, cai no relatório original em vez de quebrar a exportação', igual(r, { base: true })); }
  { const { TabelaPro, log, UIx } = mkTP(true), m0 = UIx.modal; TabelaPro.abrirExportar(tExtr);
    chk('o diálogo de exportação do Extrato troca "exatamente como estão na tela" por "todas as páginas" e devolve UI.modal ao normal', /todas as páginas/.test(log.modal[0].corpo) && !/exatamente como estão na tela/.test(log.modal[0].corpo) && UIx.modal === m0);
    TabelaPro.abrirExportar(tOutra); chk('em outras tabelas o texto continua o original', /exatamente como estão na tela/.test(log.modal[1].corpo)); }

  // ganchos no renderExtratos (texto real do painel)
  const re = corta('  renderExtratos() {', '  async classificarManual(docId, id, cat) {');
  chk('renderExtratos: com a v14.19.2 a lista vem de listaFiltrada19 (Categoria + sem limite); desligada, é a expressão da v14.19.1', re.includes('const lista = g19() ? this.listaFiltrada19(todas) : todas.filter(t => (u.filtro === \'todas\'') && re.includes('this.filtroForn05(t))\n      .sort((a, b) => b.data.localeCompare(a.data) || Math.abs(b.valor) - Math.abs(a.valor));'));
  chk('renderExtratos: a tabela é marcada data-tp-fonte19="extratos" só com o recurso ligado e a barra recebe toolbarCat19(todas, podeCls)', re.includes('<table${g19() ? \' data-tp-fonte19="extratos"\' : \'\'}>') && re.includes('${this.toolbarCat19(todas, podeCls)}'));
  chk('a tela continua paginando de 200 em 200 (Mostrar mais) — só a exportação é que leva tudo', re.includes('lista.slice(0, u.limite)') && re.includes('fd-bc-mais') && /case 'fd-bc-mais': u\.limite \+= 400/.test(html));
}

/* ================================================================================================================
   5 · RECLASSIFICAÇÃO EM LOTE NO EXTRATO OFX — as 3 travas invioláveis
   ================================================================================================================ */
console.log('\n── 5 · reclassificação em lote (3 travas invioláveis) ──');
const nmc = (E, id) => (E.DFC.cat(id) || {}).nome, semAcento = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const classif = (E, t, contaId) => E.DFC.classificar({ ...t, contaId }, E.DFC.regras(), { ov18: true }).categoria;
/** massa do ajuste em lote: Conta A (jan: j1–j5 semeados + k1,k2 em 2º documento; fev: f1–f3) e Conta C (jan: j1 com o MESMO FITID da Conta A, c1, c2) */
const massaLote = () => {
  const E = semear(ambiente({ g18: true })); ModalProgressoCarga_AUTO(E);
  E.S.extratos.set('ct-a_2026-01_1', { id: 'ct-a_2026-01_1', contaId: 'ct-a', mes: '2026-01', parte: 1, transacoes: [trx('k1', '2026-01-28', 750, 'PIX RECEBIDO CLIENTE K1'), trx('k2', '2026-01-29', -80, 'TARIFA K2'), trx('k3', '2026-01-30', 60, 'PIX RECEBIDO DIFERENTE K3', 'pag_outros')] });
  E.S.extratos.set('ct-c_2026-01_0', { id: 'ct-c_2026-01_0', contaId: 'ct-c', mes: '2026-01', parte: 0, transacoes: [trx('j1', '2026-01-05', 123, 'PIX OUTRA CONTA', 'rec_pix'), trx('c1', '2026-01-07', 50, 'PIX C1', 'rec_pix'), trx('c2', '2026-01-09', -20, 'DIVERSOS C2', 'pag_outros')] });
  E.bump('extratos'); Object.assign(E.FluxoDFC.ui, { mes: '2026-01', conta: 'ct-a', busca: '', filtro: 'todas', forn: '', limite: 200, cat19: '' });
  return E;
};
const linha = ({ conta = 'ct-a', nome = 'Conta A', fitid, data = '05/01/2026', hist = '', valor = 0, atual = '', sug = '', nova = '' }) => [conta, nome, fitid, data, hist, valor, atual, sug, nova];
const snapDocs = E => JSON.stringify([...E.S.extratos.values()]);
const catDe = (E, docId, id) => (E.S.extratos.get(docId).transacoes.find(t => String(t.id) === id) || {}).cat;
/** importa uma matriz (como se viesse da planilha) e devolve o que mudou: gravações, recálculos da base, auditorias, diálogos, alertas e se os extratos ficaram idênticos */
const importar = async (E, matriz, conta) => {
  const FDx = E.FluxoDFC; if (conta !== undefined) FDx.ui.conta = conta;
  let lidas = 0; FDx.lerMatrizLote19 = async () => { lidas++; return matriz; };
  const antes = { g: E.gravacoes.length, b: E.bases.length, a: E.audits.length, m: E.modais.length, al: (E.alertas || []).length, t: E.toasts.length, snap: snapDocs(E) };
  await FDx.importarLote19({ name: 'ajuste.xlsx' });
  return { lidas, g: E.gravacoes.length - antes.g, b: E.bases.length - antes.b, a: E.audits.length - antes.a, modais: E.modais.slice(antes.m), alertas: (E.alertas || []).slice(antes.al), toasts: E.toasts.slice(antes.t), inalterado: snapDocs(E) === antes.snap };
};

/* ---------- TRAVA 1 · exportação: uma única conta bancária ---------- */
{
  const E = massaLote(), FDx = E.FluxoDFC, L = E.DFC_LOTE19, nm = id => nmc(E, id);
  chk('as mensagens das travas são exatamente as pedidas (exportar) e a da importação cita o filtro CONTA', L.MSG_EXPORTAR === 'Selecione uma única conta bancária antes de exportar para ajuste em lote.' && /filtro CONTA/.test(L.MSG_IMPORTAR));
  FDx.ui.conta = '';
  const ex0 = FDx.prepararExportLote19();
  chk('TRAVA 1 · com o filtro CONTA em "Todas" (janeiro tem 2 contas) a exportação é BLOQUEADA com a mensagem pedida e nenhuma linha é preparada', ex0.bloqueio === L.MSG_EXPORTAR && !ex0.linhas && !ex0.cab, ex0);
  E.modais.length = 0; E.baixados.length = 0; await FDx.exportarLote19();
  chk('… o painel avisa com alerta (UI.alerta) e NÃO abre o diálogo de exportação nem baixa arquivo', E.alertas.at(-1)[0] === 'Ajuste em lote' && E.alertas.at(-1)[1] === L.MSG_EXPORTAR && E.modais.length === 0 && E.baixados.length === 0, E.alertas);
  FDx.ui.mes = '2026-02'; const exFev = FDx.prepararExportLote19(); FDx.ui.mes = '2026-01';
  chk('mesmo num mês em que só há UMA conta com lançamentos (fevereiro), "Todas" continua bloqueado: a trava é sobre o filtro, não sobre o que por acaso existe', exFev.bloqueio === L.MSG_EXPORTAR, exFev);
  const lMisto = [{ contaId: 'ct-a', id: 'a1', data: '2026-01-05', valor: 1, hist: 'x', cls: { categoria: 'rec_pix' } }, { contaId: 'ct-c', id: 'c1', data: '2026-01-05', valor: 1, hist: 'y', cls: { categoria: 'rec_pix' } }];
  const base = { rotuloConta: id => id, nomeCat: id => id, sugerida: () => 'rec_pix' };
  chk('defesa em profundidade: mesmo com uma conta escolhida, uma lista com mais de uma conta nos filtros também é recusada; e conta escolhida sem lançamentos devolve "vazio" (não é trava)', !!L.exportar({ contaSel: 'ct-a', lista: lMisto, ...base }).bloqueio && !!L.exportar({ contaSel: '', lista: [lMisto[0]], ...base }).bloqueio && L.exportar({ contaSel: 'ct-a', lista: [], ...base }).vazio === true);

  FDx.ui.conta = 'ct-a'; const ex = FDx.prepararExportLote19(), porId = id => ex.linhas.find(l => l[2] === id);
  const tj1 = E.S.extratos.get('ct-a_2026-01_0').transacoes[0];
  chk('com a Conta A selecionada a exportação sai: 8 lançamentos de janeiro (5 do 1º documento + 3 do 2º) — só da Conta A —, com os 9 títulos pedidos', ex.contaId === 'ct-a' && ex.contaRotulo === 'Conta A' && ex.n === 8 && ex.linhas.length === 8 && ex.linhas.every(l => l[0] === 'ct-a' && l[1] === 'Conta A') && igual(ex.cab, ['Conta (ID)', 'Conta', 'FITID (ID único)', 'Data', 'Histórico', 'Valor', 'Categoria Atual', 'Categoria Sugerida', 'Nova Categoria']), [ex.n, ex.cab]);
  chk('cada linha leva id e nome da conta, FITID (texto), Data dd/mm/aaaa, Histórico, Valor numérico, Categoria Atual, Categoria Sugerida e "Nova Categoria" em branco', igual(porId('j1'), ['ct-a', 'Conta A', 'j1', '05/01/2026', 'PIX RECEBIDO', 5000, nm('rec_pix'), nm(classif(E, { ...tj1, cat: null }, 'ct-a')), '']) && ex.linhas.every(l => l[8] === '' && typeof l[5] === 'number' && typeof l[2] === 'string'), porId('j1'));
  const k3 = porId('k3');
  chk('"Categoria Atual" é a classificação vigente (manual ou regra) e "Categoria Sugerida" é a que a regra daria sem o ajuste manual — k3 foi ajustado à mão para "' + nm('pag_outros') + '" e a sugestão da regra é outra', k3[6] === nm('pag_outros') && k3[7] !== k3[6] && k3[7] === nm(classif(E, { ...E.S.extratos.get('ct-a_2026-01_1').transacoes[2], cat: null }, 'ct-a')), k3);
  chk('o arquivo sai na ordem da tela (mais recente primeiro) e não leva a Conta C nem fevereiro', ex.linhas[0][2] === 'k3' && !ex.linhas.some(l => ['c1', 'c2', 'f1'].includes(l[2])) && ex.linhas.filter(l => l[2] === 'j1').length === 1);

  // diálogo e arquivos (CSV e Excel)
  E.modais.length = 0; E.audits.length = 0; E.baixados.length = 0; E.toasts.length = 0; await FDx.exportarLote19();
  const dlg = E.modais.at(-1);
  chk('com a conta escolhida abre o diálogo "Exportar p/ Ajuste em Lote" com a conta, o mês, a contagem e as ações Cancelar · CSV · Excel (.xlsx)', dlg && dlg.titulo === 'Exportar p/ Ajuste em Lote' && /Conta A/.test(dlg.corpo) && /todas as páginas/.test(dlg.corpo) && igual(dlg.acoes.map(a => a.rotulo), ['Cancelar', 'CSV', 'Excel (.xlsx)']), dlg && dlg.acoes);
  dlg.acoes[1].acao(); await new Promise(r => setTimeout(r, 120));
  const [nCsv, bCsv] = E.baixados.at(-1) || [], byt = bCsv ? new Uint8Array(await bCsv.arrayBuffer()) : [], txt = bCsv ? await bCsv.text() : '', ln = txt.split('\n');
  chk('CSV: Ajuste_em_Lote_Conta_A_2026-01.csv, BOM UTF-8, ";" , cabeçalho com os 9 títulos, 8 linhas de dados, valor com vírgula decimal', nCsv === 'Ajuste_em_Lote_Conta_A_2026-01.csv' && byt[0] === 0xEF && byt[1] === 0xBB && byt[2] === 0xBF && ln[0] === L.CAB.join(';') && ln.length === 9 && ln.some(x => x.startsWith('ct-a;Conta A;j1;05/01/2026;PIX RECEBIDO;5000,00;')), [nCsv, ln.slice(0, 3)]);
  chk('a exportação fica na auditoria ("Exportação para ajuste em lote · Conta A")', E.audits.some(a => /Exportação para ajuste em lote · Conta A/.test(a.rotulo) && /8 lançamento/.test(a.detalhe)) && E.toasts.some(t => /pronto/.test(t)), E.audits.map(a => a.rotulo));
  const abas = []; E.xlsxFake = { utils: { aoa_to_sheet: aoa => { const ws = { aoa }; aoa.forEach((l, r) => l.forEach((v, c) => { ws[`C${r}_${c}`] = { t: typeof v === 'number' ? 'n' : 's', v }; })); return ws; }, encode_cell: ({ r, c }) => `C${r}_${c}`, book_new: () => ({ abas }), book_append_sheet: (wb, ws, nome) => wb.abas.push([nome, ws.aoa, ws]) }, write: () => new Uint8Array([9]) };
  E.baixados.length = 0; dlg.acoes[2].acao(); await new Promise(r => setTimeout(r, 120));
  const a1 = abas[0], ws1 = a1 && a1[2];
  chk('Excel: arquivo .xlsx com 3 abas — "Ajuste em lote", "Categorias válidas" e "Instruções" —, FITID e ID da conta gravados como TEXTO (o Excel não vira número/notação científica) e a coluna Valor com formato numérico', E.baixados.at(-1)[0] === 'Ajuste_em_Lote_Conta_A_2026-01.xlsx' && igual(abas.map(a => a[0]), ['Ajuste em lote', 'Categorias válidas', 'Instruções']) && igual(a1[1][0], L.CAB) && a1[1].length === 9 && ws1['C1_2'].t === 's' && ws1['C1_0'].t === 's' && /#,##0\.00/.test(ws1['C1_5'].z) && ws1['!cols'].length === 9, [abas.map(a => a[0]), ws1 && ws1['C1_5']]);
  chk('a aba "Categorias válidas" lista TODAS as categorias do plano (ID, nome, grupo, sentido) e a aba "Instruções" explica as 3 travas', abas[1][1].length === E.DFC.categorias().length + 1 && igual(abas[1][1][0], ['ID', 'Nome da categoria', 'Grupo no demonstrativo', 'Sentido']) && abas[1][1].some(l => l[0] === 'rec_pix' && l[1] === nm('rec_pix')) && abas[2][1].flat().some(t => /ARQUIVO INTEIRO/.test(t)) && abas[2][1].flat().some(t => /em branco não é alterada/.test(t)) && abas[2][1].flat().some(t => /UMA conta bancária/.test(t)));

  // sem corte de página e respeitando os filtros (massa grande)
  const E2 = semear(ambiente({ g18: true })); massaExtrato(E2); zerarUi(E2); const F2 = E2.FluxoDFC; F2.ui.conta = 'ct-a';
  const n0 = F2.prepararExportLote19().n; F2.ui.filtro = 's'; const nS = F2.prepararExportLote19().n; F2.ui.filtro = 'todas'; F2.ui.busca = 'aluguel'; const nB = F2.prepararExportLote19().n; F2.ui.busca = ''; F2.ui.cat19 = 'pag_folha'; const nC = F2.prepararExportLote19().n; F2.ui.cat19 = ''; F2.ui.busca = 'inexistente'; const nV = F2.prepararExportLote19();
  chk('a exportação para ajuste em lote também leva TODAS as páginas (455 lançamentos da Conta A, bem acima das 200 linhas da tela) e respeita Tipo, Busca e Categoria; filtro sem resultado avisa e não é trava', n0 === 455 && nS === rawJan(E2).filter(t => t.contaId === 'ct-a' && t.valor < 0).length && nB === 45 && nC === 114 && nV.vazio === true, [n0, nS, nB, nC, nV]);
  F2.ui.busca = ''; E2.toasts.length = 0; E2.modais.length = 0; F2.ui.busca = 'inexistente'; await F2.exportarLote19();
  chk('… e, sem lançamentos nos filtros, só um aviso ("Nenhum lançamento nos filtros atuais para exportar.")', E2.toasts.includes('Nenhum lançamento nos filtros atuais para exportar.') && E2.modais.length === 0);

  // permissões, carga e recurso
  E.pode = () => false; E.toasts.length = 0; E.modais.length = 0; await FDx.exportarLote19(); const tEx = E.toasts.slice(); const rImp = await importar(E, [L.CAB, linha({ fitid: 'j1', nova: 'rec_cartoes' })]); E.pode = null;
  chk('sem a permissão de classificar (fcx.dfc.importar) nem exporta nem importa: avisa e não toca nos extratos', tEx.some(t => /permiss/i.test(t)) && E.modais.length === 0 && rImp.lidas === 0 && rImp.g === 0 && rImp.inalterado && rImp.toasts.some(t => /permiss/i.test(t)), [tEx, rImp.toasts]);
  const nAl0 = (E.alertas || []).length; E.flag19 = false; E.toasts.length = 0; E.modais.length = 0; FDx.ui.conta = ''; await FDx.exportarLote19(); const rOff = await importar(E, [L.CAB, linha({ fitid: 'j1', nova: 'rec_cartoes' })], 'ct-a'); E.flag19 = true;
  chk('com o recurso desligado exportar e importar não fazem nada (a v14.19.1 não tem ajuste em lote)', E.modais.length === 0 && (E.alertas || []).length === nAl0 && rOff.alertas.length === 0 && rOff.lidas === 0 && rOff.g === 0 && rOff.inalterado);
}

/* ---------- TRAVA 2 · importação: só linhas da conta selecionada, senão recusa o ARQUIVO INTEIRO ---------- */
{
  const E = massaLote(), FDx = E.FluxoDFC, L = E.DFC_LOTE19, nm = id => nmc(E, id);
  const rSemConta = await importar(E, [L.CAB, linha({ fitid: 'j1', nova: 'rec_cartoes' })], '');
  chk('TRAVA 2 · sem conta selecionada (filtro CONTA em "Todas") o arquivo nem é lido: alerta bloqueante e nada gravado', rSemConta.lidas === 0 && rSemConta.alertas.length === 1 && rSemConta.alertas[0][1] === L.MSG_IMPORTAR && rSemConta.g === 0 && rSemConta.inalterado, rSemConta.alertas);
  chk('(o botão "Importar" também confere a conta ANTES de abrir o seletor de arquivo)', await (async () => { const cliques = []; globalThis.document = { getElementById: id => ({ click() { cliques.push(id); } }) }; try { FDx.ui.conta = ''; E.alertas.length = 0; FDx.escolherArquivoLote19(); const a = cliques.length === 0 && E.alertas.length === 1 && E.alertas[0][1] === L.MSG_IMPORTAR; FDx.ui.conta = 'ct-a'; FDx.escolherArquivoLote19(); return a && igual(cliques, ['bcLoteArq']); } finally { delete globalThis.document; } })());

  // arquivo com uma linha de OUTRA conta no meio de linhas boas: nada é gravado (nem as boas)
  const mOutra = [L.CAB, linha({ fitid: 'j1', hist: 'PIX RECEBIDO', valor: 5000, nova: 'rec_cartoes' }), linha({ fitid: 'j3', nova: 'pag_outros' }), linha({ conta: 'ct-c', nome: 'Conta C', fitid: 'c1', hist: 'PIX C1', valor: 50, nova: 'rec_cartoes' })];
  const r1 = await importar(E, mOutra, 'ct-a'), al = r1.alertas[0];
  chk('linha de OUTRA conta no arquivo → o arquivo INTEIRO é recusado: nenhuma gravação, nenhuma auditoria, nenhum recálculo; as linhas boas (j1, j3) também ficam como estavam', r1.lidas === 1 && r1.g === 0 && r1.b === 0 && r1.a === 0 && r1.inalterado && catDe(E, 'ct-a_2026-01_0', 'j1') === 'rec_pix' && catDe(E, 'ct-a_2026-01_0', 'j3') === 'pag_folha', [r1.g, r1.b, r1.a]);
  chk('… com alerta bloqueante "Ajuste em lote recusado" que diz a regra, quantas linhas e quais (linha, FITID, conta informada e motivo)', r1.alertas.length === 1 && al[0] === 'Ajuste em lote recusado' && /Importação recusada: 1 linha do arquivo não pertence à conta selecionada\./.test(al[1]) && /Nenhuma alteração foi gravada\./.test(al[1]) && /<td class="num">4<\/td>/.test(al[1]) && /c1/.test(al[1]) && /Conta C/.test(al[1]) && /conta da linha diferente da conta selecionada/.test(al[1]), al[1].slice(0, 400));
  chk('… e o modal de progresso mostra a importação como RECUSADA (não "concluída") e some quando o alerta abre', r1.modais.length === 0 && E.ModalProgressoCarga.ativo() === null);

  const rSemId = await importar(E, [L.CAB, linha({ fitid: 'j1', nova: 'rec_cartoes' }), linha({ conta: '', nome: '', fitid: 'j3', nova: 'pag_outros' })], 'ct-a');
  chk('linha SEM identificador de conta → arquivo recusado por inteiro ("linha sem identificador de conta")', rSemId.g === 0 && rSemId.inalterado && /sem identificador de conta/.test(rSemId.alertas[0][1]) && /\(em branco\)/.test(rSemId.alertas[0][1]), rSemId.alertas);
  const rFit = await importar(E, [L.CAB, linha({ fitid: 'j1', nova: 'rec_cartoes' }), linha({ fitid: 'c1', nova: 'rec_cartoes' })], 'ct-a');
  chk('linha com o ID da conta certo mas FITID que só existe em OUTRA conta (planilha adulterada) → arquivo recusado ("o FITID pertence a outra conta bancária")', rFit.g === 0 && rFit.inalterado && /o FITID pertence a outra conta bancária/.test(rFit.alertas[0][1]) && /c1/.test(rFit.alertas[0][1]), rFit.alertas);
  const rInv = await importar(E, [L.CAB, linha({ fitid: 'j1', nova: 'rec_cartoes' }), linha({ fitid: 'j2', nova: 'rec_pix' }), linha({ fitid: 'j3', nova: 'pag_outros' })], 'ct-c');
  chk('arquivo da Conta A importado com a Conta C selecionada → recusado por inteiro e a mensagem conta as 3 linhas (plural)', rInv.g === 0 && rInv.inalterado && /3 linhas do arquivo não pertencem à conta selecionada/.test(rInv.alertas[0][1]), rInv.alertas[0] && rInv.alertas[0][1].slice(0, 200));
  const muitas = [L.CAB, ...Array.from({ length: 35 }, (_, i) => linha({ conta: 'ct-c', nome: 'Conta C', fitid: 'z' + i, nova: 'rec_pix' }))];
  const rMuitas = await importar(E, muitas, 'ct-a');
  chk('com muitas linhas divergentes o alerta lista as 30 primeiras e informa "… e mais 5 linha(s)" — sem perder a contagem total (35)', /35 linhas do arquivo não pertencem/.test(rMuitas.alertas[0][1]) && (rMuitas.alertas[0][1].match(/<tr><td class="num">/g) || []).length === 30 && /e mais 5 linha\(s\)/.test(rMuitas.alertas[0][1]) && rMuitas.g === 0);

  // arquivos que não são o modelo
  const rSemCol = await importar(E, [['FITID (ID único)', 'Data', 'Nova Categoria'], ['j1', '05/01/2026', 'rec_cartoes']], 'ct-a');
  chk('arquivo sem a coluna "Conta (ID)" é recusado (sem ela não há como garantir uma única conta) e nada é gravado', rSemCol.g === 0 && rSemCol.inalterado && /falta a coluna “Conta \(ID\)”/.test(rSemCol.alertas[0][1]), rSemCol.alertas);
  const rOutro = await importar(E, [['a', 'b'], ['1', '2']], 'ct-a'), rVazio = await importar(E, [L.CAB], 'ct-a');
  chk('arquivo que não é o modelo ("não reconhecido") e arquivo só com títulos são recusados com explicação; nada é gravado', rOutro.g === 0 && /Arquivo não reconhecido/.test(rOutro.alertas[0][1]) && rVazio.g === 0 && /nenhuma linha de lançamento/.test(rVazio.alertas[0][1]) && rOutro.inalterado && rVazio.inalterado);

  // caminho feliz: tudo da conta selecionada
  const tk1 = E.S.extratos.get('ct-a_2026-01_1').transacoes[0], atK1 = classif(E, tk1, 'ct-a'), alvoK1 = atK1 === 'rec_cartoes' ? 'rec_pix' : 'rec_cartoes', antesJ1 = E.S.extratos.get('ct-a_2026-01_0').transacoes[0], antesJ2 = E.S.extratos.get('ct-a_2026-01_0').transacoes[1];
  const mOk = [L.CAB, linha({ fitid: 'j1', hist: 'PIX RECEBIDO', valor: 5000, atual: nm('rec_pix'), nova: 'rec_cartoes' }), linha({ fitid: 'j2', hist: 'CARTOES', valor: 3000, nova: '' }), linha({ fitid: 'j3', hist: 'FOLHA', valor: -2000, nova: semAcento(nm('pag_outros')).toUpperCase() }),
    linha({ fitid: 'k1', data: '28/01/2026', hist: 'PIX RECEBIDO CLIENTE K1', valor: 750, nova: nm(alvoK1) }), linha({ fitid: 'f1', data: '05/02/2026', hist: 'PIX RECEBIDO', valor: 4000, nova: 'rec_cartoes' })];
  E.gravacoes.length = 0; E.bases.length = 0; E.audits.length = 0;
  const r2 = await importar(E, mOk, 'ct-a');
  chk('TODAS as linhas da Conta A, sem divergência: a importação segue — j1 por ID, j3 por nome sem acento/caixa, k1 (2º documento) e f1 (outro mês) reclassificados; j2 em branco e Conta C intactas', catDe(E, 'ct-a_2026-01_0', 'j1') === 'rec_cartoes' && catDe(E, 'ct-a_2026-01_0', 'j3') === 'pag_outros' && catDe(E, 'ct-a_2026-01_1', 'k1') === alvoK1 && catDe(E, 'ct-a_2026-02_0', 'f1') === 'rec_cartoes' && catDe(E, 'ct-a_2026-01_0', 'j2') === 'rec_cartoes' && catDe(E, 'ct-c_2026-01_0', 'j1') === 'rec_pix' && catDe(E, 'ct-c_2026-01_0', 'c1') === 'rec_pix', [catDe(E, 'ct-a_2026-01_0', 'j1'), catDe(E, 'ct-c_2026-01_0', 'j1')]);
  chk('o FITID repetido em duas contas (j1) só mexe na linha da conta selecionada — a j1 da Conta C continua "rec_pix"', catDe(E, 'ct-c_2026-01_0', 'j1') === 'rec_pix' && r2.alertas.length === 0);
  const docJ = E.S.extratos.get('ct-a_2026-01_0').transacoes;
  chk('a gravação muda só o campo `cat` das linhas pedidas: o resto do lançamento e as demais linhas do documento ficam exatamente como estavam', igual({ ...docJ[0], cat: antesJ1.cat }, { ...antesJ1 }) && igual(docJ[1], antesJ2) && docJ.length === 5 && docJ.slice(3).every((t, i) => igual(t, E.S.extratos.get('ct-a_2026-01_0').transacoes[3 + i])));
  chk('uma gravação por documento de extrato afetado (3: jan parte 0, jan parte 1, fev) com a auditoria individual desligada (semAudit) — e UM único recálculo da base da DFC com os meses afetados (jan e fev)', r2.g === 3 && E.gravacoes.every(x => x.c === 'extratos' && x.aud.semAudit === true) && r2.b === 1 && igual(E.bases.at(-1), ['2026-01', '2026-02']), [r2.g, r2.b, E.bases]);
  chk('um único registro de auditoria resume o lote (conta, lançamentos e meses)', r2.a === 1 && /Reclassificação em lote · Conta A/.test(E.audits[0].rotulo) && /4 lançamento\(s\) reclassificado\(s\) em 2026-01, 2026-02/.test(E.audits[0].detalhe) && E.audits[0].acao === 'alterou', E.audits);
  const hh = E.ModalProgressoCarga.ativo();
  chk('sem pendências o modal de progresso conclui com o resumo rápido (4 reclassificados; 2 sem alteração) e nenhum diálogo extra abre', hh && hh.e.fase === 'concluido' && hh.e.resumo.titulo === 'Reclassificação em lote concluída' && /4 lançamento\(s\) reclassificado\(s\)/.test(hh.e.resumo.linhas[0]) && /1 linha\(s\) sem alteração/.test(hh.e.resumo.linhas[1]) && !(hh.e.resumo.avisos || []).length && r2.modais.length === 0, hh && hh.e.resumo);
  // reimportar o mesmo arquivo não muda nada: tudo já está na categoria pedida
  E.gravacoes.length = 0; E.bases.length = 0; const r2b = await importar(E, mOk, 'ct-a');
  chk('reimportar o mesmo arquivo é inofensivo: tudo já está na categoria pedida (nenhuma gravação nem recálculo)', r2b.g === 0 && r2b.b === 0 && r2b.inalterado, [r2b.g, r2b.b]);
}

/* ---------- TRAVA 3 · categoria inexistente: não derruba, não sobrescreve, lista no fim ---------- */
{
  const E = massaLote(), FDx = E.FluxoDFC, L = E.DFC_LOTE19, nm = id => nmc(E, id);
  const tk1 = E.S.extratos.get('ct-a_2026-01_1').transacoes[0], atK1 = classif(E, tk1, 'ct-a'), alvoK1 = atK1 === 'rec_cartoes' ? 'rec_pix' : 'rec_cartoes';
  const m = [L.CAB,
    linha({ fitid: 'j1', hist: 'PIX RECEBIDO', valor: 5000, atual: nm('rec_pix'), nova: 'Categoria Inventada XYZ' }),
    linha({ fitid: 'j2', hist: 'CARTOES', valor: 3000, nova: 'rec_pix' }),
    linha({ fitid: 'j3', hist: 'FOLHA', valor: -2000, nova: semAcento(nm('pag_outros')).toUpperCase() }),
    linha({ fitid: 'j4', hist: 'DIVERSOS', valor: -500, nova: '' }),
    linha({ fitid: 'j5', hist: 'TRANSFERENCIA ENTRE CONTAS', valor: 1000, nova: nm('transf') }),
    linha({ fitid: 'k1', data: '28/01/2026', hist: 'PIX RECEBIDO CLIENTE K1', valor: 750, nova: '★ ' + nm(alvoK1) + ' (neutra)' }),
    linha({ fitid: 'zzz9', hist: 'NAO EXISTE', valor: 1, nova: 'rec_pix' }),
    linha({ fitid: 'j2', hist: 'CARTOES (repetida)', valor: 3000, nova: 'pag_folha' }),
    linha({ fitid: 'k2', data: '29/01/2026', hist: 'TARIFA K2', valor: -80, nova: 'Outra Categoria Que Nao Existe' })];
  E.gravacoes.length = 0; E.bases.length = 0; E.audits.length = 0;
  const r = await importar(E, m, 'ct-a'), rel = r.modais.find(x => x.titulo === 'Ajuste em lote · resultado');
  chk('TRAVA 3 · categoria inexistente NÃO rejeita a importação: as linhas válidas são aplicadas (j2 por ID, j3 por nome sem acento/caixa, k1 pelo rótulo da tela com ★ e "(neutra)")', catDe(E, 'ct-a_2026-01_0', 'j2') === 'rec_pix' && catDe(E, 'ct-a_2026-01_0', 'j3') === 'pag_outros' && catDe(E, 'ct-a_2026-01_1', 'k1') === alvoK1 && r.alertas.length === 0 && r.g === 2, [catDe(E, 'ct-a_2026-01_0', 'j2'), catDe(E, 'ct-a_2026-01_0', 'j3'), r.g]);
  chk('… e as linhas com categoria inexistente NÃO são sobrescritas: j1 segue "rec_pix" e k2 mantém a classificação anterior (sem `cat` gravada)', catDe(E, 'ct-a_2026-01_0', 'j1') === 'rec_pix' && catDe(E, 'ct-a_2026-01_1', 'k2') === undefined, [catDe(E, 'ct-a_2026-01_0', 'j1'), catDe(E, 'ct-a_2026-01_1', 'k2')]);
  chk('em branco = sem alteração (j4); igual à categoria atual = sem alteração (j5); FITID inexistente (zzz9) não derruba nada; FITID repetido vale a primeira ocorrência (j2 ficou "rec_pix", não "pag_folha")', catDe(E, 'ct-a_2026-01_0', 'j4') === 'pag_outros' && catDe(E, 'ct-a_2026-01_0', 'j5') === 'transf' && catDe(E, 'ct-a_2026-01_0', 'j2') !== 'pag_folha');
  chk('a base da DFC é recalculada UMA vez e a auditoria resume "3 reclassificado(s)" e "2 mantido(s) por categoria inexistente"', r.b === 1 && igual(E.bases.at(-1), ['2026-01']) && r.a === 1 && /3 lançamento\(s\) reclassificado\(s\)/.test(E.audits[0].detalhe) && /2 mantido\(s\) por categoria inexistente/.test(E.audits[0].detalhe), E.audits[0]);
  chk('ao final abre o resultado ("Ajuste em lote · resultado") com a tabela das linhas MANTIDAS: linha da planilha, FITID, histórico, valor, categoria informada e categoria mantida', !!rel && rel.largo === true && /2 linha\(s\) mantida\(s\) com a categoria anterior/.test(rel.corpo) && /Categoria Inventada XYZ/.test(rel.corpo) && /Outra Categoria Que Nao Existe/.test(rel.corpo) && /<td class="num">2<\/td><td class="mono">j1<\/td>/.test(rel.corpo) && /<td class="num">10<\/td><td class="mono">k2<\/td>/.test(rel.corpo) && rel.corpo.includes(nm('rec_pix')) && /não existe no plano da DFC/.test(rel.corpo) && /Categoria informada/.test(rel.corpo) && /Categoria mantida/.test(rel.corpo), rel && rel.corpo.slice(0, 600));
  chk('o resultado também traz: total de linhas, quantas foram reclassificadas, sem “Nova Categoria”, a linha NÃO localizada (zzz9, com motivo) e o aviso da linha repetida', /<b>9<\/b> linha\(s\) no arquivo/.test(rel.corpo) && /<b[^>]*>3<\/b> reclassificada\(s\) em 2026-01/.test(rel.corpo) && /<b>1<\/b> sem “Nova Categoria”/.test(rel.corpo) && /1 linha\(s\) não localizada\(s\)/.test(rel.corpo) && /zzz9/.test(rel.corpo) && /FITID não encontrado nos extratos desta conta/.test(rel.corpo) && /1 linha\(s\) repetida\(s\) no arquivo foram ignoradas/.test(rel.corpo), rel.corpo.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 700));
  chk('o resultado oferece "Baixar linhas mantidas (CSV)" (sem fechar o diálogo) e "Fechar"', igual(rel.acoes.map(a => a.rotulo), ['Baixar linhas mantidas (CSV)', 'Fechar']) && rel.acoes[0].fechar === false);
  E.baixados.length = 0; await rel.acoes[0].acao();
  const [nMant, bMant] = E.baixados[0] || [], bm = bMant ? new Uint8Array(await bMant.arrayBuffer()) : [], tm = bMant ? await bMant.text() : '';
  chk('o CSV das linhas mantidas (BOM, ";") traz linha, FITID, data, histórico, valor, categoria informada, categoria mantida e o motivo de cada uma', nMant === 'Ajuste_em_Lote_linhas_mantidas.csv' && bm[0] === 0xEF && tm.startsWith('Linha;FITID;Data;Histórico;Valor;Categoria informada;Categoria mantida;Motivo') && tm.includes(`2;j1;05/01/2026;PIX RECEBIDO;5000;Categoria Inventada XYZ;${nm('rec_pix')};categoria “Categoria Inventada XYZ” não existe no plano da DFC`), tm.split('\n').slice(0, 3));
  chk('o modal de progresso do lote é dispensado quando o resultado abre (não ficam dois avisos sobrepostos)', E.ModalProgressoCarga.ativo() === null);

  // todas inválidas: nada a gravar, mas a tabela aparece
  const E2 = massaLote(), r3 = await importar(E2, [L.CAB, linha({ fitid: 'j1', nova: 'Inventada 1' }), linha({ fitid: 'j3', nova: 'Inventada 2' })], 'ct-a'), rel3 = r3.modais.find(x => x.titulo === 'Ajuste em lote · resultado');
  chk('arquivo em que TODAS as categorias são inválidas: nada é gravado e a base da DFC nem é recalculada, mas a tabela das 2 linhas mantidas aparece (a importação não é "derrubada")', r3.g === 0 && r3.b === 0 && r3.a === 0 && r3.inalterado && !!rel3 && /2 linha\(s\) mantida\(s\)/.test(rel3.corpo) && r3.alertas.length === 0, [r3.g, r3.b, !!rel3]);
  const E3 = massaLote(), r4 = await importar(E3, [L.CAB, linha({ fitid: 'j1', nova: '' }), linha({ fitid: 'j3', nova: nmc(E3, 'pag_folha') })], 'ct-a');
  chk('arquivo sem nada a mudar (em branco / já na categoria): conclui sem tabela e sem gravar', r4.g === 0 && r4.modais.length === 0 && r4.alertas.length === 0 && r4.inalterado);
}

/* ---------- peças puras, plano de gravação, cancelamento e roteamento ---------- */
{
  const E = massaLote(), FDx = E.FluxoDFC, L = E.DFC_LOTE19, nm = id => nmc(E, id);
  chk('norm: sem acento/caixa, tira ★ e "(neutra)" dos rótulos da tela e junta espaços', L.norm('  ★ Folha  de Pagamento (neutra) ') === 'folha de pagamento' && L.norm('Crédito à Vista') === 'credito a vista' && L.norm(null) === '');
  const idx = L.indexarCategorias([{ id: 'rec_pix', nome: 'PIX recebidos' }, { id: 'ab', nome: 'Outras' }, { id: 'cd', nome: 'outras' }]);
  chk('resolver: por ID (sem diferenciar caixa) ou por nome; nome repetido entre categorias é AMBÍGUO e não vale (só o ID resolve); categoria inexistente → null', L.resolver('REC_PIX', idx)?.id === 'rec_pix' && L.resolver('pix RECEBIDOS', idx)?.id === 'rec_pix' && L.resolver('Outras', idx) === null && L.resolver('ab', idx)?.id === 'ab' && L.resolver('nada', idx) === null && L.resolver('', idx) === null);
  const mat = [['Relatório X'], [], ['Conta (ID)', 'Conta', 'FITID (ID único)', 'Data', 'Histórico', 'Valor', 'Categoria Atual', 'Categoria Sugerida', 'Nova categoria'], ['ct-a', 'Conta A', 'j1', new Date('2026-01-05T00:00:00Z'), 'PIX', 5000, 'x', 'y', 'rec_pix'], ['', '', '', '', '', '', '', '', ''], ['ct-a', 'Conta A', 1.2e15, '06/01/2026', 'Z', 1, '', '', 'rec_pix']];
  const lm = L.lerMatriz(mat);
  chk('lerMatriz: acha a linha de títulos mesmo abaixo de um título/linha em branco, ignora linhas vazias, guarda o número da linha da planilha (para o relatório) e aceita a data como Date', lm.linhas.length === 2 && lm.linhas[0].linha === 4 && lm.linhas[1].linha === 6 && lm.linhas[0].nova === 'rec_pix' && lm.linhas[0].data instanceof Date && L.paraISO(lm.linhas[0].data) === '2026-01-05' && L.paraISO('06/01/2026') === '2026-01-06' && L.paraISO('2026-02-03') === '2026-02-03' && L.paraISO('x') === '', lm);
  const indice = L.indexar(E.S.extratos.values()), cat = [{ id: 'rec_pix', nome: 'PIX recebidos' }, { id: 'rec_cartoes', nome: 'Cartões' }];
  const A = L.analisar({ linhas: [{ linha: 2, contaId: 'ct-a', fitid: '1.2E+15', data: '', hist: 'x', valor: 1, nova: 'rec_pix' }, { linha: 3, contaId: 'ct-a', fitid: 'j1', data: '05/01/2026', hist: 'p', valor: 1, nova: 'Cartões' }, { linha: 4, contaId: 'ct-a', fitid: 'j1', data: '05/01/2026', hist: 'p', valor: 1, nova: 'rec_pix' }], contaSel: 'ct-a', indice, categorias: cat, atualId: e => e.cat });
  chk('analisar: FITID que o Excel transformou em notação científica vai para "não localizadas" com o motivo explicado; linha repetida entra em "repetidas"; a boa entra em "aplicar" com de → para', A.naoLocalizadas.length === 1 && /notação científica/.test(A.naoLocalizadas[0].motivo) && A.repetidas.length === 1 && A.aplicar.length === 1 && A.aplicar[0].de === 'rec_pix' && A.aplicar[0].para === 'rec_cartoes' && A.aplicar[0].docId === 'ct-a_2026-01_0' && A.aplicar[0].mes === '2026-01', A);
  const P = L.plano([{ docId: 'd1', mes: '2026-02', fitid: 'a', para: 'x' }, { docId: 'd2', mes: '2026-01', fitid: 'b', para: 'y' }, { docId: 'd1', mes: '2026-02', fitid: 'c', para: 'z' }]);
  chk('plano: agrupa por documento de extrato (uma gravação por documento) e devolve os meses afetados sem repetir, em ordem', P.docs.length === 2 && P.docs.find(d => d.docId === 'd1').itens.size === 2 && igual(P.meses, ['2026-01', '2026-02']));
  const t0 = [{ id: 'a', cat: 'k' }, { id: 7, valor: 1 }, { id: 'b' }], t1 = L.aplicarNoDoc(t0, new Map([['7', 'rec_pix']]));
  chk('aplicarNoDoc: muda só a linha pedida (o FITID numérico casa pelo texto); as outras ficam com a MESMA referência do objeto original', t1[1].cat === 'rec_pix' && t1[1].valor === 1 && t1[0] === t0[0] && t1[2] === t0[2] && t0[1].cat === undefined);

  // cancelar durante a leitura: nada é gravado; durante a gravação não dá para cancelar
  const nova = L.CAB.concat([]); const mOk = [nova, linha({ fitid: 'j1', hist: 'PIX RECEBIDO', valor: 5000, nova: 'rec_cartoes' })];
  FDx.ui.conta = 'ct-a'; E.toasts.length = 0; E.gravacoes.length = 0; const snap0 = snapDocs(E);
  FDx.lerMatrizLote19 = async () => { E.ModalProgressoCarga.ativo().cancelar(); return mOk; };
  await FDx.importarLote19({ name: 'a.xlsx' });
  chk('cancelar durante a leitura interrompe no ponto seguro: nada é gravado, nada é recalculado e o aviso diz que foi cancelado', E.gravacoes.length === 0 && snapDocs(E) === snap0 && E.toasts.some(t => /cancelada/.test(t)) && E.ModalProgressoCarga.ativo() === null, E.toasts);
  let deuCancelar = null; const baseOrig = FDx.atualizarBaseDFC;
  FDx.lerMatrizLote19 = async () => mOk; FDx.atualizarBaseDFC = async function (m) { deuCancelar = E.ModalProgressoCarga.ativo().cancelar(); return baseOrig.call(this, m); };
  await FDx.importarLote19({ name: 'a.xlsx' }); FDx.atualizarBaseDFC = baseOrig;
  chk('na fase de GRAVAÇÃO o botão Cancelar não vale (cancelar() devolve false): ou grava tudo ou avisa o erro — nunca um lote pela metade', deuCancelar === false && catDe(E, 'ct-a_2026-01_0', 'j1') === 'rec_cartoes', deuCancelar);

  // falhas inesperadas viram aviso, sem derrubar o painel
  E.toasts.length = 0; FDx.lerMatrizLote19 = async () => { throw new Error('arquivo corrompido'); }; await FDx.importarLote19({ name: 'x.xlsx' });
  chk('arquivo ilegível (erro ao ler) vira aviso "Falha ao importar o ajuste em lote: …" e o modal mostra o erro', E.toasts.some(t => /Falha ao importar o ajuste em lote: arquivo corrompido/.test(t)));
  E.ModalProgressoCarga.ativo()?.fechar(); const ps = E.Repo.prontas; ps.delete('extratos'); E.toasts.length = 0; await FDx.importarLote19({ name: 'x.xlsx' }); ps.add('extratos');
  chk('com os extratos ainda carregando a importação espera (aviso) e não lê o arquivo', E.toasts.some(t => /Aguarde/.test(t)));

  // roteamento das ações (data-a) do Extrato
  const log = []; FDx._o192.acao = function (a) { log.push(['acao-orig', a]); return 'orig'; }; FDx._o192.mudanca = function (a) { log.push(['mudanca-orig', a]); return 'orig'; };
  const eo = FDx.exportarLote19, es = FDx.escolherArquivoLote19, il = FDx.importarLote19; FDx.exportarLote19 = () => { log.push('exportar'); }; FDx.escolherArquivoLote19 = () => { log.push('escolher'); }; FDx.importarLote19 = f => { log.push(['importar', f.name]); };
  FDx.acao('fd-lote-exportar', {}); FDx.acao('fd-lote-importar', {}); FDx.acao('fd-bc-filtro', {});
  const el = { files: [{ name: 'p.xlsx' }], value: 'C:\\fakepath\\p.xlsx' }; await FDx.mudanca('fd-lote-arq', el); await FDx.mudanca('fd-bc', { dataset: {} });
  chk('ações: fd-lote-exportar / fd-lote-importar / fd-lote-arq vão para o ajuste em lote; todas as outras seguem para o tratamento original; o campo de arquivo é zerado (permite escolher o mesmo arquivo de novo)', igual(log, ['exportar', 'escolher', ['acao-orig', 'fd-bc-filtro'], ['importar', 'p.xlsx'], ['mudanca-orig', 'fd-bc']]) && el.value === '', log);
  log.length = 0; E.flag19 = false; FDx.acao('fd-lote-exportar', {}); await FDx.mudanca('fd-lote-arq', { files: [{ name: 'p.xlsx' }], value: 'x' }); E.flag19 = true;
  chk('com o recurso desligado essas ações nunca chegam ao ajuste em lote (vão para o tratamento original)', igual(log, [['acao-orig', 'fd-lote-exportar'], ['mudanca-orig', 'fd-lote-arq']]), log);
  FDx.exportarLote19 = eo; FDx.escolherArquivoLote19 = es; FDx.importarLote19 = il;
}

/* ================================================================================================================
   6 · ModalProgressoCarga — modal central de progresso (cronômetro, barra, etapa, cancelamento seguro, resumo)
   ================================================================================================================ */
console.log('\n── 6 · ModalProgressoCarga ──');
const SRC_MPC = corta('const ModalProgressoCarga = {', '/* ---- fim do ModalProgressoCarga v14.19.2 · Item 6 ---- */');
/** uma instância isolada do componente REAL, com UI de brincadeira, relógio e temporizadores controlados */
const novoMPC = (ligado = true) => {
  const logs = { toasts: [], modais: [], timeouts: [], intervals: [] }, flag = { on: ligado }, relogio = { t: 1000 };
  const UIx = { toast: m => { logs.toasts.push(m); }, modal(o) { logs.modais.push(o); return { el: {} }; } };
  const M = new Function('UI', 'g19', SRC_MPC + '\nreturn ModalProgressoCarga;')(UIx, () => flag.on);
  M.AUTO_FECHAR_MS = 0; M.agora = () => relogio.t; M._setInterval = f => { logs.intervals.push(f); return logs.intervals.length; }; M._clearInterval = () => {}; M._setTimeout = (f, ms) => { logs.timeouts.push([f, ms]); return logs.timeouts.length; }; M._clearTimeout = () => {};
  return { M, UIx, logs, flag, relogio };
};
{
  const { M, logs, relogio } = novoMPC();
  chk('cronômetro: 00:00 · 01:15 · 1:02:05 (com hora só quando passa de 60 min); valores negativos ou inválidos viram 00:00', M.cronometro(0) === '00:00' && M.cronometro(75000) === '01:15' && M.cronometro(3725000) === '1:02:05' && M.cronometro(-5) === '00:00' && M.cronometro('x') === '00:00' && M.cronometro(59999) === '00:59');
  chk('pct: usa o percentual informado, ou feito ÷ total; limita entre 0 e 100; sem dados devolve null (barra "indeterminada")', M.pct({ pct: 42 }) === 42 && M.pct({ feito: 25, total: 100 }) === 25 && M.pct({ feito: 500, total: 100 }) === 100 && M.pct({ pct: -3 }) === 0 && M.pct({}) === null && M.pct({ feito: 3, total: 0 }) === null);
  const h = M.abrir({ titulo: 'Importando Extrato OFX…', unidade: 'lançamentos' });
  h.atualizar({ etapa: 'Gravando Conta A · jan/2026…', feito: 30, total: 120 });
  const h1 = M.html(h.e);
  chk('o cartão traz título da operação, etapa atual, barra com valor (25%), "30 de 120 lançamentos · 25%" e o cronômetro 00:00, no formato de diálogo modal (role alertdialog + aria-modal)', /<h2 id="mpc19-t">Importando Extrato OFX…<\/h2>/.test(h1) && /Gravando Conta A · jan\/2026…/.test(h1) && /role="progressbar"[^>]*aria-valuenow="25"/.test(h1) && /30 de 120 lançamentos · 25%/.test(h1) && /<span class="mpc19-tempo" role="timer"[^>]*>00:00<\/span>/.test(h1) && /role="alertdialog" aria-modal="true"/.test(h1), h1);
  chk('o fundo bloqueia a página inteira e o cartão fica no CENTRO (position:fixed; inset:0; flex centralizado; z-index altíssimo; cursor de progresso)', /\.mpc19-fundo\{position:fixed;inset:0;z-index:1000000;[^}]*display:flex;align-items:center;justify-content:center/.test(M._css()) && /cursor:progress/.test(M._css()) && h1.includes('data-mpc19-fundo'));
  relogio.t += 75000; chk('o cronômetro acompanha o relógio (75 s depois mostra 01:15)', /role="timer"[^>]*>01:15</.test(M.html(h.e)));
  chk('enquanto roda: botão "Cancelar" habilitado; sem % conhecido a barra é indeterminada', !/data-mpc19="cancelar"[^>]*disabled/.test(h1) && /class="mpc19-barra ind /.test(M.html({ ...h.e, feito: null, total: null, pct: null })));
  chk('o texto da operação é escapado (nada de HTML injetado a partir de nome de arquivo/conta)', !/<img/.test(M.html({ ...h.e, titulo: '<img src=x onerror=alert(1)>', etapa: '<b>x</b>' })) && /&lt;img/.test(M.html({ ...h.e, titulo: '<img src=x onerror=alert(1)>' })));
  h.fechar();
  const nc = M.abrir({ titulo: 'Gravando…', cancelavel: false });
  chk('etapa que não pode ser interrompida: "Cancelar" desabilitado com a explicação (title), e cancelar() devolve false', /data-mpc19="cancelar"[^>]*disabled/.test(M.html(nc.e)) && /não pode ser interrompida com segurança/.test(M.html(nc.e)) && nc.cancelar() === false && nc.cancelado === false); nc.fechar();
}
{
  const { M, logs, relogio } = novoMPC();
  const h = M.abrir({ titulo: 'A' }), h2 = M.abrir({ titulo: 'B' });
  chk('operações aninhadas dividem UMA janela (abrir de novo devolve o mesmo handle)', h === h2 && M.ativo() === h);
  h.concluir({ linhas: ['ok'] });
  const h3 = M.abrir({ titulo: 'C' });
  chk('um resumo anterior ainda na tela é dispensado quando uma nova operação começa', h3 !== h && h.fechado === true && M.ativo() === h3); h3.fechar();
  const c = M.abrir({ titulo: 'Cancelável' }); c.atualizar({ etapa: 'x…' });
  let sinal = null; c.signal.addEventListener && c.signal.addEventListener('abort', () => { sinal = true; });
  chk('verificar() não faz nada enquanto ninguém cancelou', (() => { try { c.verificar(); return true; } catch { return false; } })());
  const ok = c.cancelar();
  chk('cancelar(): marca "cancelando", dispara o AbortController (signal) e a etapa passa a avisar que nada é interrompido no meio de uma gravação; o 2º cancelar() não faz nada', ok === true && c.cancelado === true && c.e.fase === 'cancelando' && c.signal.aborted === true && c.cancelar() === false && /nada é interrompido no meio de uma gravação/.test(M.html(c.e)), M.html(c.e));
  let erro = null; try { c.verificar(); } catch (e) { erro = e; }
  chk('verificar() depois do cancelamento lança o erro de cancelamento reconhecível (ehCancelamento) — só deve ser chamado em pontos seguros', !!erro && M.ehCancelamento(erro) && !M.ehCancelamento(new Error('x')) && !M.ehCancelamento(null) && /cancelada/.test(erro.message)); c.fechar();
  const m = M.abrir({ titulo: 'M' }); m.mensagem('Lendo o arquivo…'); m.mensagem('Gravando 3 extratos… 40%'); m.mensagem('Gravando 3 extratos… 40%');
  chk('mensagem(): "… NN%" vira percentual da barra e a frase vira a etapa; o aviso de leitura genérico não entra no resumo; mensagens repetidas contam uma vez', m.e.pct === 40 && m.e.etapa === 'Gravando 3 extratos…' && m.mensagens.length === 1, [m.e.pct, m.e.etapa, m.mensagens]); m.fechar();
  // pausa do cronômetro quando um diálogo precisa da tela
  relogio.t = 0; const p = M.abrir({ titulo: 'P' });
  relogio.t = 10000; p.ocultar(); relogio.t = 15000; p.ocultar(); relogio.t = 40000; p.mostrar(); const aindaOculto = p.oculto; relogio.t = 40000; p.mostrar(); relogio.t = 50000;
  chk('diálogo aberto por cima do progresso: o modal some (oculto) e volta só quando TODOS os diálogos fecharam; os 30 s que a pessoa levou para responder NÃO contam no cronômetro (50 s de relógio = 00:20)', aindaOculto === true && p.oculto === false && p.e.ini === 30000 && M.cronometro(M.agora() - p.e.ini) === '00:20', [p.e.ini, aindaOculto, p.oculto]); p.fechar();
}
{
  /* executar(): resumo, falha, aviso, cancelamento, confirmação desistida, aninhamento */
  const { M, UIx, logs } = novoMPC();
  const toast = m => UIx.toast(m);
  let r = await M.executar('Importando…', async h => { h.atualizar({ etapa: 'a' }); toast('3 lançamento(s) importado(s).'); return 'x'; });
  let h = M.ativo();
  chk('executar: sucesso → "Concluído" com o resumo montado a partir dos avisos (toasts) da rotina, que continuam aparecendo normalmente; toast original restaurado', r === 'x' && h.e.fase === 'concluido' && h.e.resumo.linhas.includes('3 lançamento(s) importado(s).') && logs.toasts.includes('3 lançamento(s) importado(s).') && UIx.toast !== undefined && /Concluído/.test(M.html(h.e)) && !/Concluído com avisos/.test(M.html(h.e)), h && h.e.resumo);
  chk('… e o botão vira "Concluir" (data-mpc19="fechar"), sem "Cancelar"', /data-mpc19="fechar"/.test(M.html(h.e)) && !/data-mpc19="cancelar"/.test(M.html(h.e))); h.fechar();
  await M.executar('Importando…', async () => { toast('Aguarde: 2 arquivo(s) recusado(s) por divergência.'); });
  h = M.ativo(); chk('executar: mensagem de aviso (recusado/divergência/ignorado…) vira "Concluído com avisos" e o resumo NÃO some sozinho', h.e.resumo.avisos.length === 1 && /Concluído com avisos/.test(M.html(h.e))); h.fechar();
  await M.executar('Importando…', async () => { toast('Não foi possível ler o arquivo.'); toast('Abrindo…'); });
  h = M.ativo(); chk('executar: mensagem de falha (não foi possível…, sem permissão…) vira "Não foi concluído" em tom de erro', h.e.tom === 'erro' && /Não foi concluído/.test(M.html(h.e)) && h.e.resumo.avisos[0] === 'Não foi possível ler o arquivo.' && h.e.resumo.titulo === 'Atenção', h.e); h.fechar();
  await M.executar('Importando…', async () => 1, { resumo: false });
  chk('resumo:false (a pessoa desistiu na confirmação) fecha o modal sem resumo e sem aviso', M.ativo() === null);
  await M.executar('Importando…', async () => 1, { resumo: () => ({ titulo: 'Tudo certo', linhas: ['1 item'], tom: 'erro' }) });
  h = M.ativo(); chk('resumo próprio (função) com tom explícito prevalece sobre a análise dos toasts', h.e.resumo.titulo === 'Tudo certo' && h.e.tom === 'erro' && /mpc19-resumo erro/.test(M.html(h.e))); h.fechar();
  let caiu = null; try { await M.executar('Gravando…', async () => { throw new Error('banco indisponível'); }); } catch (e) { caiu = e; }
  h = M.ativo(); chk('executar: se a rotina lança erro, o erro sobe (a rotina trata como sempre) e o modal mostra "Não foi possível concluir" com a causa, sem fechar sozinho', caiu && caiu.message === 'banco indisponível' && h.e.fase === 'erro' && /Não foi possível concluir/.test(M.html(h.e)) && /banco indisponível/.test(M.html(h.e)) && logs.timeouts.length === 0, h && h.e.fase); h.fechar();
  // cancelamento
  logs.toasts.length = 0; let gravouDepois = false;
  r = await M.executar('Importando Extrato OFX…', async h => { h.cancelar(); h.verificar(); gravouDepois = true; });
  chk('cancelar durante a rotina (ponto seguro): executar devolve {cancelado:true}, o código depois do ponto seguro NÃO roda, o modal fecha e o aviso diz "O que já foi gravado foi mantido"', r && r.cancelado === true && gravouDepois === false && M.ativo() === null && logs.toasts.some(t => /Importando Extrato OFX: operação cancelada\. O que já foi gravado foi mantido\./.test(t)), logs.toasts);
  logs.toasts.length = 0; let leu = 0;
  r = await M.executar('Lendo o arquivo…', async h => { h.cancelar(); leu++; return 'resultado'; }, { cancelaNoFim: true });
  chk('leitura que não dá para parar no meio (cancelaNoFim): termina, descarta o resultado e avisa "Nada foi gravado"', leu === 1 && r.cancelado === true && M.ativo() === null && logs.toasts.some(t => /operação cancelada\. Nada foi gravado\./.test(t)), logs.toasts);
  r = await M.executar('Lendo…', async h => ({ cancelado: true }));
  chk('a rotina também pode devolver {cancelado:true} (ex.: a pessoa recusou o diálogo) → o modal fecha', r.cancelado === true && M.ativo() === null);
  // aninhamento: a rotina interna usa a janela da externa (não abre outra)
  let interno = null; await M.executar('Externa', async hE => { await M.executar('Interna', async hI => { interno = hI; return 1; }); h = hE; });
  chk('executar aninhado reaproveita a janela já aberta (um único modal; a externa decide o fim)', interno === h && M.ativo() === h && h.e.titulo === 'Externa' && h.e.fase === 'concluido'); h.fechar();
}
{
  /* fechamento automático: só sem avisos e sem erro */
  const { M, logs } = novoMPC(); M.AUTO_FECHAR_MS = 6000;
  await M.executar('X', async () => 1, { resumo: { linhas: ['ok'] } }); const t1 = logs.timeouts.length, h1 = M.ativo();
  chk('resumo sem avisos: agenda o fechamento automático (6 s) e o timer fecha o modal', t1 === 1 && logs.timeouts[0][1] === 6000 && (logs.timeouts[0][0](), h1.fechado === true));
  await M.executar('X', async () => 1, { resumo: { linhas: ['ok'], avisos: ['atenção'] } }); const t2 = logs.timeouts.length; M.ativo().fechar();
  await M.executar('X', async () => 1, { resumo: { linhas: ['ok'], tom: 'erro' } }); const t3 = logs.timeouts.length; M.ativo().fechar();
  chk('resumo COM aviso ou em tom de erro não some sozinho (a pessoa precisa ler e clicar em Concluir)', t2 === t1 && t3 === t1, [t1, t2, t3]);
}
{
  /* UI.modal por cima do progresso e envolver() */
  const { M, UIx, logs, flag } = novoMPC();
  const h = M.abrir({ titulo: 'P' }); let fechou = 0;
  UIx.modal({ titulo: 'Confirmar importação', corpo: 'x', aoFechar: () => { fechou++; } });
  const op = logs.modais.at(-1);
  chk('um diálogo (confirmar, escolher conta…) aberto durante a operação passa à frente: o progresso é ocultado', h.oculto === true && typeof op.aoFechar === 'function');
  op.aoFechar(); chk('… e quando o diálogo fecha o progresso volta sozinho (e o aoFechar original ainda roda)', h.oculto === false && fechou === 1);
  h.concluir({ linhas: ['ok'] }); logs.modais.length = 0; UIx.modal({ titulo: 'Depois', corpo: 'x' });
  chk('com a operação já concluída (resumo na tela) o diálogo abre normal, sem mexer no progresso', logs.modais.length === 1 && logs.modais[0].aoFechar === undefined); h.fechar();
  const h4 = M.abrir({ titulo: 'Q' }); flag.on = false; logs.modais.length = 0; UIx.modal({ titulo: 'Desligado', corpo: 'x' });
  chk('recurso desligado: UI.modal passa direto (não oculta nada)', h4.oculto !== true && logs.modais[0].aoFechar === undefined); flag.on = true; h4.fechar();
  /* envolver */
  const obj = { vezes: 0, async rodar(a) { this.vezes++; obj.viuModal = !!M.ativo(); return a * 2; } };
  M.envolver(obj, 'rodar', { titulo: a => 'Rodando ' + a + '…', unidade: 'itens', resumo: false });
  chk('envolver marca a função (não envolve duas vezes) e, ligado, executa dentro do modal com o título calculado a partir dos argumentos e devolve o resultado original', obj.rodar._mpc19 === true && M.envolver(obj, 'rodar') === false && (await obj.rodar(21)) === 42 && obj.viuModal === true && obj.vezes === 1);
  flag.on = false; obj.viuModal = null; const rOff = await obj.rodar(5); flag.on = true;
  chk('envolver com o recurso desligado chama a original sem abrir modal (v14.19.1)', rOff === 10 && obj.viuModal === false && M.ativo() === null);
  chk('envolver ignora o que não é função', M.envolver({ x: 1 }, 'x') === false && M.envolver({}, 'y') === false);
}

/* ---------- ligação às rotinas de carga (código REAL de adq1419_m, com as rotinas de brincadeira) ---------- */
{
  const SRC_LIG = corta('(function ligarCargas19() {', '/* ---- fim das ligações do ModalProgressoCarga v14.19.2 · Item 6 ---- */');
  const montar = (ligado = true) => {
    const k = novoMPC(ligado), { M, UIx, logs } = k, est = { gravados: [], bases: [], renders: 0, desfeitos: 0, previas: 0, viuModal: {}, tit: {} };
    const Repo = { get: () => ({ apelido: 'Conta A' }) }, App = { render() { est.renders++; } };
    const FluxoDFC = {
      ui: {}, mesLabel: m => m,
      async importarOFX(arquivos) { for (const [mes, n] of this._plano || []) await this.gravarExtrato16('ct-a', mes, new Array(n).fill(0)); UIx.toast('Extratos importados.'); return 'fim'; },
      async gravarExtrato16(contaId, mes, novas) { est.gravados.push([contaId, mes, novas.length]); if (this._aoGravar) await this._aoGravar(est.gravados.length); return novas.length; },
      async atualizarBaseDFC(m) { est.bases.push(m); },
      async gravarPagto17() { est.viuModal.pagto = !!M.ativo(); est.tit.pagto = M.ativo() && M.ativo().e.titulo; est.cancelavelPagto = M.ativo() ? M.ativo().cancelar() : null; UIx.toast('Baixas gravadas.'); },
      async lerPagto17(f) { if (this._aoLer) this._aoLer(); this.previaPagto17(); },
      previaPagto17() { est.previas++; },
    };
    const Adq15 = { ui: { erp: { x: 1 } }, async lerErpUpload(f) { if (this._aoLer) this._aoLer(); this.ui.erp = { lido: true }; }, async gravarErp() { est.viuModal.erp = !!M.ativo(); est.tit.erp = M.ativo() && M.ativo().e.titulo; est.cancelavelErp = M.ativo() ? M.ativo().cancelar() : null; } };
    const Adq14 = { _ler: { y: 1 }, async lerUpload(f) { if (this._aoLer) this._aoLer(); this._ler = { lido: true }; if (this._avisar) UIx.modal({ titulo: 'Arquivo não lido', corpo: 'x' }); }, async gravarLote() { est.viuModal.lote = !!M.ativo(); est.tit.lote = M.ativo() && M.ativo().e.titulo; est.cancelavelLote = M.ativo() ? M.ativo().cancelar() : null; } };
    new Function('ModalProgressoCarga', 'g19', 'UI', 'FluxoDFC', 'Adq14', 'Adq15', 'Repo', 'App', SRC_LIG)(M, () => k.flag.on, UIx, FluxoDFC, Adq14, Adq15, Repo, App);
    return { ...k, est, FluxoDFC, Adq14, Adq15 };
  };
  const arqs = [{ name: 'a.ofx' }, { name: 'b.ofx' }];
  { // extratos OFX / Excel
    const t = montar(); t.FluxoDFC._plano = [['2026-01', 40], ['2026-02', 25], ['2026-03', 5]];
    const r = await t.FluxoDFC.importarOFX(arqs); const h = t.M.ativo();
    chk('OFX/Excel: roda dentro do modal "Importando extratos (OFX / Excel)…", conta os lançamentos gravados (70), e o resumo traz o aviso da própria rotina; o retorno original é preservado', r === 'fim' && h && h.e.titulo === 'Importando extratos (OFX / Excel)…' && h.e.feito === 70 && h.e.unidade === 'lançamentos gravados' && h.e.resumo.linhas.includes('Extratos importados.') && t.est.gravados.length === 3, h && h.e);
    const h2 = h; h2.fechar();
    // cancelar entre o 1º e o 2º extrato
    const c = montar(); c.FluxoDFC._plano = [['2026-01', 40], ['2026-02', 25], ['2026-03', 5]]; c.FluxoDFC._aoGravar = n => { if (n === 1) c.M.ativo().cancelar(); };
    const rc = await c.FluxoDFC.importarOFX(arqs);
    chk('OFX: cancelar durante a importação para ENTRE extratos — o 1º (jan, 40) fica gravado, o 2º e o 3º não começam, a base da DFC dos meses gravados é recalculada e o aviso diz que foi mantido o que já estava gravado', rc && rc.cancelado === true && c.est.gravados.length === 1 && igual(c.est.gravados[0], ['ct-a', '2026-01', 40]) && c.est.bases.length === 1 && igual(c.est.bases[0], ['2026-01']) && c.logs.toasts.some(t => /operação cancelada\. O que já foi gravado foi mantido\./.test(t)) && c.M.ativo() === null, [c.est.gravados, c.est.bases, c.logs.toasts]);
    // desligado
    const d = montar(false); d.FluxoDFC._plano = [['2026-01', 4]]; let viu = null; const gOrig = d.FluxoDFC.gravarExtrato16; d.FluxoDFC.gravarExtrato16 = async function () { viu = !!d.M.ativo(); return gOrig.apply(this, arguments); };
    const rd = await d.FluxoDFC.importarOFX(arqs);
    chk('OFX com o recurso desligado: roda como na v14.19.1 — sem modal, sem contagem, mesmo retorno', rd === 'fim' && viu === false && d.M.ativo() === null && d.est.gravados.length === 1);
    const u = montar(); chk('o gancho do OFX é marcado (_mpc19) e o da gravação de cada extrato também não é aplicado duas vezes', u.FluxoDFC.importarOFX._mpc19 === true);
  }
  { // sem toast = a pessoa desistiu: modal fecha sem resumo
    const k2 = novoMPC(), FD2 = { async importarOFX() { return 'desistiu'; }, async gravarExtrato16() { return 0; }, mesLabel: m => m, atualizarBaseDFC: async () => {} };
    new Function('ModalProgressoCarga', 'g19', 'UI', 'FluxoDFC', 'Adq14', 'Adq15', 'Repo', 'App', SRC_LIG)(k2.M, () => true, k2.UIx, FD2, {}, {}, { get: () => null }, { render() {} });
    const rr = await FD2.importarOFX(arqs);
    chk('OFX: se a rotina não avisou nada (a pessoa desistiu na confirmação), o modal fecha sem mostrar "Concluído" vazio', rr === 'desistiu' && k2.M.ativo() === null);
  }
  { // leituras: ERP e adquirentes — cancelamento descarta o resultado
    const t = montar(); t.Adq15._aoLer = () => { t.M.ativo().cancelar(); }; t.Adq14._aoLer = () => { t.M.ativo().cancelar(); };
    const r15 = await t.Adq15.lerErpUpload({ name: 'erp.xlsx' }), r14 = await t.Adq14.lerUpload({ name: 'getnet.csv' });
    chk('ERP: cancelar durante a leitura descarta o resultado (a pré-visualização some e a tela é redesenhada) e avisa "Nada foi gravado"', r15.cancelado === true && t.Adq15.ui.erp === null && t.est.renders >= 1 && t.logs.toasts.some(m => /Lendo o arquivo do ERP: operação cancelada\. Nada foi gravado\./.test(m)), [t.Adq15.ui, t.logs.toasts]);
    chk('Adquirentes: idem — a leitura cancelada é descartada (t._ler = null) e avisa', r14.cancelado === true && t.Adq14._ler === null && t.logs.toasts.some(m => /Lendo o arquivo da adquirente: operação cancelada\. Nada foi gravado\./.test(m)), [t.Adq14._ler, t.logs.toasts]);
    const t2 = montar(); t2.Adq14._avisar = true; t2.Adq14._aoLer = () => { t2.M.ativo().cancelar(); }; const modalOrig = t2.UIx.modal;
    await t2.Adq14.lerUpload({ name: 'x.csv' });
    chk('na leitura cancelada o aviso "Arquivo não lido" não aparece e UI.modal volta ao normal', !t2.logs.modais.some(m => /não lido/i.test(m.titulo)) && t2.UIx.modal === modalOrig);
    const t3 = montar(); t3.Adq14._avisar = true; await t3.Adq14.lerUpload({ name: 'x.csv' });
    chk('na leitura NÃO cancelada o aviso "Arquivo não lido" continua aparecendo (e o modal de progresso sai da frente dele)', t3.logs.modais.some(m => /não lido/i.test(m.titulo)));
    const t4 = montar(false); t4.Adq14._aoLer = () => {}; const antes = t4.Adq14.lerUpload; const r4 = await t4.Adq14.lerUpload({ name: 'x' });
    chk('leitura com o recurso desligado: sem modal e sem alterar nada (v14.19.1)', r4 === undefined && t4.M.ativo() === null && t4.Adq14._ler.lido === true);
  }
  { // gravações não canceláveis e Baixas do ERP / CNAB
    const t = montar(); await t.Adq15.gravarErp(); await t.Adq14.gravarLote(); await t.FluxoDFC.gravarPagto17();
    chk('gravações (ERP, lote da adquirente, baixas CNAB) rodam dentro do modal e NÃO são canceláveis: cancelar() devolve false e nada fica pela metade', t.est.viuModal.erp && t.est.viuModal.lote && t.est.viuModal.pagto && t.est.cancelavelErp === false && t.est.cancelavelLote === false && t.est.cancelavelPagto === false, t.est);
    chk('os títulos do modal identificam a rotina (ERP · lote da adquirente · baixas do ERP/CNAB)', t.est.tit.erp === 'Gravando o ERP (Apuração dos Créditos)…' && t.est.tit.lote === 'Gravando o lote da adquirente…' && t.est.tit.pagto === 'Gravando as baixas do ERP (CNAB)…', t.est.tit);
    const t2 = montar(); t2.FluxoDFC._aoLer = () => { t2.M.ativo().cancelar(); }; await t2.FluxoDFC.lerPagto17({ name: 'baixas.xlsx' });
    chk('Baixas do ERP: cancelar durante a leitura impede que a tela de conferência (pré-visualização) abra, e a função original da conferência é restaurada depois', t2.est.previas === 0 && t2.FluxoDFC.previaPagto17.toString().includes('est.previas++') && t2.M.ativo() === null);
    const t3 = montar(); await t3.FluxoDFC.lerPagto17({ name: 'baixas.xlsx' });
    chk('Baixas do ERP sem cancelar: a conferência abre normalmente (1 vez)', t3.est.previas === 1);
    const t4 = montar(false); await t4.FluxoDFC.gravarPagto17(); await t4.Adq14.gravarLote();
    chk('gravações com o recurso desligado: sem modal (v14.19.1)', t4.est.viuModal.pagto === false && t4.est.viuModal.lote === false);
  }
  const tit = (n, re) => new RegExp(re).test(SRC_LIG);
  chk('as 5 rotinas pedidas estão ligadas ao modal: OFX, ERP, adquirentes, baixas CNAB (leitura e gravação) — e o ajuste em lote, o relatório horizontal e as exportações já o usam', ['importarOFX', 'gravarExtrato16', 'lerErpUpload', 'lerUpload', 'gravarErp', 'gravarLote', 'gravarPagto17', 'lerPagto17'].every(n => SRC_LIG.includes(n)) && /M\.executar\('Importando ajuste em lote…'/.test(html) && /executar\('Gerando o arquivo de ajuste em lote…'/.test(html) && /gerarHorizontal19/.test(html) && /ModalProgressoCarga\.executar\(/.test(corta('async gerarHorizontal19', '  async exportarResumo19')));
}

/* ================================================================================================================
   7 · RECURSO DESLIGADO = v14.19.1, BACKEND INALTERADO E DOCUMENTAÇÃO
   ================================================================================================================ */
console.log('\n── 7 · recurso desligado, backend e documentação ──');
{
  const E = await comMar(), { S, Adq14, Adq19 } = E;
  let hOff = null, erroOff = null; E.flag19 = false; try { hOff = E.Adq14.render(); } catch (e) { erroOff = e; } finally { E.flag19 = true; }
  const roteador = /Object\.assign\(Adq14, \{ render\(\) \{ return g19\(\) \? Adq19\.render\(\) : Adq14\._o19r\.render\.apply\(this, arguments\); \} \}\);/.test(html);
  chk('com gestao_v1419 desligada a Auditoria de Adquirentes é a da versão anterior: o roteador só chama Adq19.render() com g19() e a tela não mostra o botão nem o selo de "Sem movimento no mês"', roteador && (hOff === null || (!/a19-semmov/.test(hOff) && !/Sem movimento no mês/.test(hOff))), [erroOff && erroOff.message, hOff && hOff.slice(0, 80)]);
  const h0 = E.ModalProgressoCarga.ativo(); E.flag19 = false; Adq14.ui.contrato = FX.CT.res; Adq14._ler = null; const antes = S.adq_lotes.size; await Adq14.gravarLote(); E.flag19 = true;
  chk('gravarLote desligado sem arquivo lido continua só avisando (nenhum modal novo, nenhuma gravação)', E.ModalProgressoCarga.ativo() === h0 && S.adq_lotes.size === antes);
  const { FluxoDFC: FD7, DFC_RESUMO: DR7 } = E_DFC; E_DFC.flag19 = false; let orig7 = 0; const go = FD7._o192.gerarResumo06; FD7._o192.gerarResumo06 = function () { orig7++; };
  E_DFC.form = { tipo: 'personalizado', mes: '2026-03', de: '2026-01', formato: 'horizontal' }; E_DFC.baixados.length = 0; E_DFC.previas.length = 0; await FD7.gerarResumo06({}); await FD7.exportarResumo19({}, 'csv');
  FD7._o192.gerarResumo06 = go; E_DFC.flag19 = true;
  chk('com o recurso desligado o formato Horizontal não existe: "Gerar" segue para o caminho da v14.19.1 e as exportações Excel/CSV do Resumo não baixam nada', orig7 === 1 && E_DFC.previas.length === 0 && E_DFC.baixados.length === 0);
}
{
  const dir = path.join(raiz, 'netlify'), arquivos = []; const anda = d => { for (const n of fs.readdirSync(d).sort()) { const p = path.join(d, n); fs.statSync(p).isDirectory() ? anda(p) : arquivos.push(p); } }; anda(dir);
  const arv = md5(arquivos.sort().map(p => `${md5(fs.readFileSync(p))}  ${path.relative(raiz, p)}\n`).join(''));
  chk('backend: a pasta netlify/ (functions, lib, database) é idêntica à da v14.19.1 — a v14.19.2 é só front-end (hash da árvore cb32b8fe…)', arv === 'cb32b8fe3fe06942204154125efa039d', arv);
  for (const [f, h] of [['netlify.toml', '3b1eff0f'], ['package.json', '83f1e078']]) chk(`${f} idêntico ao da v14.19.1 (md5 ${h}…)`, md5(fs.readFileSync(path.join(raiz, f))).startsWith(h));
  const rd = fs.existsSync(path.join(raiz, 'README.md')) ? fs.readFileSync(path.join(raiz, 'README.md'), 'utf8') : '';
  chk('README: seção "## v14.19.2" com os 6 itens, as 3 travas do ajuste em lote, a Regra de Ouro e as suposições', /## v14\.19\.2/.test(rd) && /Sem movimento no mês/.test(rd) && /Horizontal/.test(rd) && /Ajuste em Lote/i.test(rd) && /ModalProgressoCarga/.test(rd) && /Selecione uma única conta bancária antes de exportar para ajuste em lote\./.test(rd) && /Regra de Ouro/.test(rd), rd.length);
  const tituloFlag = (/gestao_v1419: \{ versao: 'v14\.19', titulo: '([^']*)'/.exec(html) || [])[1] || '';
  chk('o texto do recurso gestao_v1419 na tela de liberação descreve os 6 itens dos refinamentos (v14.9 = código v14.19.2) e continua dizendo que fica desligado até "Liberar Versão em Produção"', /refinamentos \(6 melhorias\)/.test(tituloFlag) && /Sem movimento/i.test(tituloFlag) && /Realizado/.test(tituloFlag) && /horizontal/i.test(tituloFlag) && /lote/i.test(tituloFlag) && /progresso/i.test(tituloFlag), tituloFlag.slice(0, 200));
}

console.log(`\n${OK.length} ok · ${FAIL.length} falha(s)`);
if (FAIL.length) { console.log('\nFALHAS:\n - ' + FAIL.join('\n - ')); process.exit(1); }
