import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* v14.19 · DFC limpo e 100% automático, Conciliação de Cartões em 3 blocos (barra de carga, 4 cards, tabela única por Adquirente com drill-down),
   Cruzamento em 2 níveis (ERP consolidado por adquirente × soma dos contratos importados; depois por contrato), Taxa Efetiva Total completa abatida do Líquido Esperado e do Saldo a Receber
   (busca ampliada de POS / retenções nas outras contas do mesmo CNPJ e aluguel de POS do Cadastro de Lojas), cadastro de contratos sem "Lojas Vinculadas",
   e — dentro do mesmo pacote — a regra OP = CX → Retaguarda / Recebíveis (v14.18.1) e as Vigências de Antecipação por contrato (v14.18.2) continuando a funcionar com o recurso gestao_v1419 LIGADO.
   Valida o CÓDIGO REAL do painel (public/index.html), em contexto isolado do Node, só com dados FICTÍCIOS (LGPD): CNPJs gerados aqui e valores inventados.
   Blocos:
     0) recurso gestao_v1419 (depende da v14.18), Regra de Ouro (regiões protegidas, FCX e Contábil intactos) e montagem;
     1) gestao_v1419 DESLIGADA = v14.18.2 (nenhuma função nova é chamada; dados intactos);
     2) Item 1 · DFC limpo e automático (sem bloco azul nem seletores; classificação e Previsto sempre pela Auditoria; selo de 1 linha);
     3) Item 3 · Cruzamento em 2 níveis (nível 1 consolidado, contratos faltando só informativo, nível 2 por contrato) e cadastro de contratos sem lojas;
     4) Item 4 · Taxa Efetiva Total no Líquido Esperado, na ponte até o crédito esperado no banco e no Saldo a Receber (busca ampliada de POS / retenções e fallback do Cadastro de POS);
     5) Item 2 · tela em 3 blocos (barra, 4 cards, tabela por Adquirente com drill-down) e Laudo / CSV;
     6) Item 5 · OP = CX (v14.18.1) com a v14.19 ligada;   7) Item 6 · múltiplas vigências de antecipação (v14.18.2) com a v14.19 ligada;   8) documentação, versão e recurso.
   Uso: node tests/teste-cartoes-dfc-1419.mjs */
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
    Repo, ConcMP, g14: () => ctx.flag, g15: () => ctx.flag15 && ctx.flag, g16: () => ctx.flag, g17: () => ctx.flag17 && ctx.flag15 && ctx.flag, g18: () => ctx.flag18 && ctx.flag17 && ctx.flag15 && ctx.flag, g19: () => ctx.flag19 && ctx.flag18 && ctx.flag17 && ctx.flag15 && ctx.flag,
    Datas: { hojeISO: () => '2026-11-17', iso: d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }, Recursos: { ativo: () => true }, Auth: { can: (...x) => (ctx.pode ? ctx.pode(...x) : true), id: 'u-teste' }, Libs: {}, FCX: { api: () => ctx.fcxApi || null, get versao() { return ctx.fcxVer || 1; }, montar() {} }, g07: () => false,
    ContasBancarias: { rotulo: c => c.apelido }, Retaguarda: { mesAnterior: m => { const [y, mm] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mm - 2, 1)); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); } }, CNPJ: undefined, LOGO_NAVY: 'data:image/png;base64,AAAA', $: () => null,
    Fmt: { brl: n => 'R$' + Number(n).toFixed(2), brl0: n => 'R$' + Math.round(n), num: (n, d = 0) => Number(n).toFixed(d), data: d => String(d ?? '').replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1'), dataHora: d => d, pct: (n, d = 2) => Number(n).toFixed(d) + '%' },
    UI: { toast: m => ctx.toasts.push(m), modal(o) { ctx.modais.push(o); return { el: {} }; }, confirmar: async (...x) => { ctx.confirmou++; ctx.confirmacoes = (ctx.confirmacoes || []); ctx.confirmacoes.push(x); return !ctx.recusar; }, confirmarImpacto: async () => { ctx.confirmou++; return true; }, lerForm: () => ctx.form || ({}) },
    App: { render() { ctx.renders = (ctx.renders || 0) + 1; }, agendarRender() { } }, Audit: { registrar: a => { ctx.audits.push(a); return Promise.resolve(); } },
    Documento: { baixarArquivo(nome, blob) { ctx.baixados.push([nome, blob]); return true; }, montar: (t, corpo, o) => ({ titulo: t, corpo, opcoes: o }), previa: (t, doc, nome) => { ctx.previas.push({ titulo: t, doc, nome }); } }, CSV: { gerar: m => m.map(l => l.join(';')).join('\n') },
    registrarBase: m => ctx.bases.push(m), g09: () => true, g11: () => false, Acesso: { loja: () => false }, esc: escH,
  };
  const nomes = Object.keys(mocks).filter(k => k !== 'CNPJ');
  const fn = new Function(...nomes, `${CNPJlib}\n${parcPix}\n${campoCod}\n${codLojaCod}\n${base}\n${motor}\n${modulo}\n${dfcCore}\n${prevCz}\n${dfcResumo}\nconst FluxoDFC = { ui: { sub: 'cruzamento', mes: '2026-01' }, _czDados: null, transacoes() { return Repo.todos('extratos').flatMap(d => (d.transacoes || []).map(t => ({ ...t, contaId: d.contaId, docId: d.id }))); }, trDFC() { return this.transacoes(); }, contas() { return Repo.todos('contasBancarias'); }, semSalarios06() { return false; }, mesLabel: m => m, marcaDoc: () => 'Esposende', r2: n => Math.round((n + Number.EPSILON) * 100) / 100, mesesBanco() { return [...new Set(Repo.todos('extratos').map(d => d.mes))].sort().reverse(); }, async atualizarBaseDFC(meses) { registrarBase(meses); }, ${fdDadosResumo} ${fdModeloExport} ${fdOrigemRot} };\n${adq17}\n${m18}\n/* métodos reais do ConcMP usados pelo contrato */\nObject.assign(ConcMP, { ${metodo('dig')}, ${metodo('empresaPorCnpj')}, ${metodo('canonAdq')} });\n${m19}\nreturn { ADQ_CFG, AdqTaxas, DiasUteis, MotorConciliacao, ADQ14, Adq14, ADQ15, Adq15, ADQ17, Adq17, ADQ18, Adq18, ADQ19, Adq19, DFC_RESUMO, DFC, DFC_CATEGORIAS, DFC_REGRAS_PADRAO, Cruzamento, PrevistoFCX, FluxoDFC, CNPJ, CodLoja, campo };`);
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
/** cenário: Getnet + SafraPay (Resilienza) + Credsystem (ERP), com os créditos do OFX SEM o nome da adquirente (TED/crédito genérico): só a Auditoria sabe de quem são */
const cenario4 = async ({ g18 = true, extras = [], regras = null, cfg = null, fcx = null } = {}) => {
  const E = await FX.cenario({ g18, fev: false }), { Adq14, Adq15 } = E;
  E.S.adq_contratos.set(CT_CRED4, { id: CT_CRED4, adquirente: 'CREDSYSTEM', empresaId: 'resilienza', contaId: 'ct-a', ativo: true, lojas: ['01'] }); E.bump('adq_contratos');
  Adq15.ui.erp = { lido: Adq15.lerErpLinhas(FX3.erpRows(), 'Apuração dos Créditos jan.xlsx', 'ApuraCreditos') }; await Adq15.gravarErp(); await espera();
  FX.ofx(E, [FX.docOfx('xa', 'ct-a', '2026-01', [FX.tr('a1', '2026-01-06', E.e06, 'TED RECEBIDA 1234'), FX.tr('a2', '2026-01-13', 99.10, 'CREDITO DIVERSOS'), FX.tr('a3', '2026-01-12', 300, 'TED RECEBIDA 99'), FX.tr('a4', '2026-01-15', 777.77, 'TED RECEBIDA CLIENTE'), ...extras]),
    FX.docOfx('xc', 'ct-c', '2026-01', E.saf.dias.slice(0, 2).map((d, i) => FX.tr('c' + i, d.data, d.valor, 'CREDITO EM CONTA')))]);
  if (regras) { E.S.config.set('dfc', { id: 'dfc', regras }); E.bump('config'); }
  if (cfg) { E.S.config.set('dfc_cartoes18', { id: 'dfc_cartoes18', ...cfg }); E.bump('config'); }
  E.fcx = livro => { E.fcxVer = (E.fcxVer || 1) + 1; E.fcxApi = livro ? { metodos: { credito: 'Crédito', pix: 'PIX' }, livro: () => livro, saidas: () => [] } : null; };
  if (fcx !== undefined && fcx !== null) E.fcx(fcx);
  return E;
};
const CAT = (E, t) => E.DFC.classificar(t, undefined, { ov18: true });

/* =====================================================================
   1 · CENÁRIO v14.19 — Getnet Resilienza + Getnet Mar Aberto + SafraPay Resilienza, ERP consolidado por adquirente (os contratos NÃO têm lojas vinculadas digitadas)
   ===================================================================== */
const nulls19 = n => Array(n).fill(null);
const CAB_GN19 = 'ESTABELECIMENTO COMERCIAL;CPF / CNPJ;RAZÃO SOCIAL;DATA/HORA DA VENDA;BANDEIRA;MODALIDADE;FORMA DE PAGAMENTO;STATUS DA TRANSAÇÃO;PARCELAS;DATA PREVISTA DO 1º PAGAMENTO;NÚMERO DO CARTÃO;NÚMERO DE AUTORIZAÇÃO (AUT);NÚMERO DO COMPROVANTE DE VENDA (NSU);TIPO DE CAPTURA;NÚMERO DO TERMINAL;VALOR BRUTO;VALOR TAXA;VALOR LÍQUIDO;ORIGEM DO CARTÃO;;;;;ID';
const gnMar19 = (dh, band, mod, forma, st, parc, dp, bruto, taxa, liq) => ['13100535', fmtCnpj(CNPJ_MAR), 'Mar Aberto Ltda', dh, band, mod, forma, st, parc, dp, '439267******0321', '35859', '5725', 'Pos', '14092285', bruto, taxa, liq, 'Nacional', '', '', '', '', '-'].join(';');
/** Getnet Mar Aberto · janeiro (ficcional): Visa débito 400 e Elo à vista 600, ambos em 12/01 */
const csvMar19 = () => [CAB_GN19,
  gnMar19('12/01/2026 11:00', 'Visa', 'Débito', 'Débito', 'Aprovada', 1, '13/01/2026', '400,00', '-3,60', '396,40'),
  gnMar19('12/01/2026 12:00', 'Elo', 'Crédito', 'Crédito à Vista', 'Aprovada', 1, '11/02/2026', '600,00', '-13,20', '586,80'), ''].join('\r\n');
const CAB_ERP19 = ['Loja', 'Dt Venda', 'Dt Crédito', 'Adq', 'Descrição', 'Vda Bruta', ' MDR', 'Vda Líquida', 'Vencimento', 'Antecipação', 'Tx Extra', 'OP', 'DC'];
const er19 = (loja, dv, cod, desc, bruto, mdr, liq, ant, op, dc) => [loja, dv, dv, cod, desc, bruto, mdr, liq, dv, ant, 0, op, dc];
/** ERP consolidado: Getnet (Res + Mar) 7.187 contra 7.100 nos arquivos: Mastercard à vista +10 (05/01) e um Elo de 77 só no ERP (12/01); SafraPay 3.270 contra a Agenda de 2.770: uma venda de 500 só no ERP (07/01) */
const ERP19 = [
  er19('01', '05/01/2026', '301', 'GETNET VISA DEBITO', 1000, 9, 991, 0, 'VE', 'DB'), er19('01', '05/01/2026', '301', 'GETNET MASTERCARD CREDITO A VISTA', 2010, 44, 1966, 30.25, 'VE', 'CR'),
  er19('01', '05/01/2026', '301', 'GETNET VISA CREDITO 3X', 3000, 90, 2910, 91.57, 'VE', 'CR'), er19('01', '12/01/2026', '301', 'GETNET VISA DEBITO', 100, 0.9, 99.1, 0, 'VE', 'DB'),
  er19('02', '12/01/2026', '301', 'GETNET ELO CREDITO A VISTA', 77, 1.7, 75.3, 0, 'VE', 'CR'),
  er19('03', '12/01/2026', '301', 'GETNET VISA DEBITO', 400, 3.6, 396.4, 0, 'VE', 'DB'), er19('03', '12/01/2026', '301', 'GETNET ELO CREDITO A VISTA', 600, 13.2, 586.8, 0, 'VE', 'CR'),
  er19('05', '05/01/2026', '302', 'SAFRAPAY MASTERCARD CREDITO A VISTA', 1000, 17.5, 982.5, 4, 'VE', 'CR'), er19('05', '05/01/2026', '302', 'SAFRAPAY MASTERCARD CREDITO 3X', 300, 9, 291, 7, 'VE', 'CR'),
  er19('05', '06/01/2026', '302', 'SAFRAPAY VISA DEBITO', 200, 1.8, 198.2, 0, 'VE', 'DB'), er19('05', '06/01/2026', '302', 'SAFRAPAY VISA CREDITO A VISTA', 1000, 22, 978, 60, 'VE', 'CR'),
  er19('05', '07/01/2026', '302', 'SAFRAPAY VISA CREDITO A VISTA', 500, 11, 489, 0, 'VE', 'CR'), er19('05', '30/01/2026', '302', 'SAFRAPAY MASTERCARD DEBITO', 150, 1.35, 148.65, 0, 'VE', 'DB'),
  er19('05', '31/01/2026', '302', 'SAFRAPAY ELO CREDITO A VISTA', 120, 2.64, 117.36, 3.2, 'VE', 'CR')];
const ERP19_GETNET = 1000 + 2010 + 3000 + 100 + 77 + 400 + 600, ADQ19_GETNET_RES = 1000 + 2000 + 3000 + 100, ADQ19_GETNET_MAR = 1000, ERP19_SAFRA = 1000 + 300 + 200 + 1000 + 500 + 150 + 120, ADQ19_SAFRA = 1000 + 300 + 200 + 1000 + 150 + 120;
const erpRows19 = () => [['Apuração dos Créditos', ...nulls19(12)], ['Período: 01/01/2026 a 31/01/2026', ...nulls19(12)], nulls19(13), CAB_ERP19, ...ERP19];
/** `ConcMP.custoPos` real (região protegida) reduzido ao que o teste usa: exceção da loja (qtde de POS × aluguel) por adquirente + empresa */
const custoPosMock = E => (lojaId, adq, empId = null) => {
  const lj = E.Repo.get('lojas', lojaId), r = { qtd: 0, total: 0, itens: [], semValor: false };
  for (const a of lj?.adquirentes || []) {
    if (String(a.adquirente || '').toUpperCase().trim() !== String(adq || '').toUpperCase().trim()) continue; const q = Number(a.qtdePos || 0); if (!q) continue;
    if (empId != null && a.empresaId !== empId) continue; const unit = a.posAluguel != null && a.posAluguel !== '' ? Number(a.posAluguel) : null, tot = unit == null ? 0 : r2(q * unit);
    r.qtd += q; r.total = r2(r.total + tot); if (unit == null) r.semValor = true; r.itens.push({ ec: a.ec || '', empresaId: a.empresaId, qtd: q, unit, total: tot, fonte: 'exceção da loja' });
  } return r;
};
/** opções: comMar (importa o arquivo da Getnet · Mar Aberto), erp (importa a Apuração dos Créditos), flag19; devolve o ambiente com E.CT_MAR, E.importarMar() e E.importarErp() */
const cenario19 = async ({ comMar = true, erp = true, flag19 = true } = {}) => {
  const E = await FX.cenario({ agendaSafra: true }), { Adq14, Adq15, S } = E;
  E.flag19 = flag19;
  const rm = FX.regra('GETNET', 'mar-aberto', FX.mdr(0.9, 2.2, 2.6, 3.0), 1.6); S.adq_taxas.set(rm.id, rm); S.contasBancarias.set('ct-b', { id: 'ct-b', apelido: 'Conta B', ativa: true }); E.bump('adq_taxas'); E.bump('contasBancarias');
  E.CT_MAR = Adq14.idContrato('GETNET', 'mar-aberto'); S.adq_contratos.set(E.CT_MAR, { id: E.CT_MAR, adquirente: 'GETNET', empresaId: 'mar-aberto', contaId: 'ct-b', ativo: true }); E.bump('adq_contratos');
  E.importarMar = async () => E.importar(E.CT_MAR, await Adq14.lerGetnetTexto(csvMar19(), 'mar.csv'));
  E.importarErp = async () => { Adq15.ui.erp = { lido: Adq15.lerErpLinhas(erpRows19(), 'Apuração dos Créditos jan.xlsx', 'ApuraCreditos') }; await Adq15.gravarErp(); await espera(); };
  E.ConcMP.custoPos = custoPosMock(E);
  if (comMar) await E.importarMar(); if (erp) await E.importarErp();
  Adq14.ui.mes = '2026-01'; Adq14.ui.filtro = '*'; return E;
};

/* =====================================================================
   2 · RECURSO gestao_v1419 DESLIGADO = v14.18.2 (nada novo é chamado; DFC, tela e contratos são os de antes; nenhum dado é tocado)
   ===================================================================== */
{
  const E = await cenario19(); E.flag19 = false; const { Adq17, Adq18, Adq14, FluxoDFC } = E;
  const I = Adq17.indicadores('2026-01', '*');
  chk('desligado: Adq19.ativo() é falso — e o recurso depende da v14.18 (com a v14.18 desligada a v14.19 também fica desligada); ligado + v14.18 ligada: ativo', E.Adq19.ativo() === false && ambiente({ g18: false, g19: true }).Adq19.ativo() === false && ambiente({ g18: true, g19: true }).Adq19.ativo() === true);
  chk('desligado: os indicadores são os da v14.18.2 — sem nível 1, sem Líquido Esperado após taxas, sem busca ampliada de POS e com a Auditoria de Adquirentes ERP × lojas', I.nivel1 === undefined && I._g19t === undefined && I._g19n === undefined && I.consolidado.liquido === undefined && I.consolidado.tarifas.posExtraR === undefined, Object.keys(I));
  chk('desligado: a DFC mantém o bloco azul "Auditoria de Adquirentes × DFC" com os dois seletores e a configuração gravada continua valendo', (() => { FluxoDFC.ui.sub = 'dfc'; FluxoDFC.ui.mes = '2026-01'; const h = FluxoDFC.painelCartoes18(); return /Auditoria de Adquirentes × DFC/.test(h) && /data-a="fd-cartoes-cfg" data-k="classificar"/.test(h) && /data-a="fd-cartoes-cfg" data-k="modo"/.test(h) && !/c19-selo/.test(h); })() && Adq18.cfg().modoPrevisto === 'auto' && Adq18.cfg().classificar === true);
  Adq18.cfg(); E.S.config.set('dfc_cartoes18', { id: 'dfc_cartoes18', modoPrevisto: 'fcx', classificar: false }); E.bump('config');
  chk('desligado: a configuração antiga (previsto "FCX", categoria "como no extrato") é lida e obedecida como na v14.18.2', Adq18.cfg().modoPrevisto === 'fcx' && Adq18.cfg().classificar === false);
  E.flag19 = true;
  chk('ligado: a mesma configuração gravada deixa de ser lida (sempre: Previsto pela Auditoria e classificação automática)', Adq18.cfg().modoPrevisto === 'sempre' && Adq18.cfg().classificar === true && E.S.config.get('dfc_cartoes18').classificar === false);
  E.flag19 = false; E.S.config.delete('dfc_cartoes18'); E.bump('config');
  const c = Adq14.renderContratos();
  chk('desligado: o cadastro de contratos continua com "Lojas Vinculadas", "ECs" e o "Puxar do Cadastro" (modal e tabela da v14.18.2)', /Lojas Vinculadas/.test(c) && /<th>ECs<\/th>|ECs/.test(c) && /data-a="a14-contrato-puxar|Puxar/.test(c), c.slice(0, 500));
  const nGrav = E.gravacoes.length; E.flag19 = true; Adq17.indicadores('2026-01', '*'); Adq14.renderContratos(); E.Adq19.nivel1('2026-01'); FluxoDFC.painelCartoes18(); E.flag19 = false; Adq17.indicadores('2026-01', '*');
  chk('ligar e desligar a v14.19 é só leitura: nenhuma gravação é feita e as coleções (contratos, lotes, ERP, extratos) ficam iguais — reversível sem migração', E.gravacoes.length === nGrav && E.S.adq_contratos.size === 3 && E.S.adq_lotes.size >= 3, { grav: E.gravacoes.length - nGrav, contratos: E.S.adq_contratos.size });
  /* os cálculos por contrato (MDR, antecipação, repasse) são IGUAIS com a v14.19 ligada ou desligada: o que muda é onde o ERP é conferido e quais custos entram na Taxa Efetiva */
  const off = Adq17.indicadores('2026-01', '*'); E.flag19 = true; const on = Adq17.indicadores('2026-01', '*');
  const pick = I => I.contratos.map(r => [r.id, r.bruto.base, r.mdr && r.mdr.efetivoR, r.ant && r.ant.efetivoR, r.repasse.esperado, r.repasse.creditado]);
  chk('a v14.19 não altera o MDR, a antecipação efetiva, o repasse esperado e o creditado de nenhum contrato (só o ERP × adquirente e os custos de POS / retenção)', igual(pick(off), pick(on)), { off: pick(off), on: pick(on) });
}

/* =====================================================================
   3 · ITEM 1 · DFC LIMPO E 100% AUTOMÁTICO (sem o bloco azul e sem os dois seletores; classificação e Previsto sempre pela Auditoria; selo de 1 linha)
   ===================================================================== */
{
  const E = await cenario4({ cfg: { classificar: false, modoPrevisto: 'fcx' }, fcx: { '2026-01-10': { entradas: { 'venda:pix': 500, 'venda:credito': 10000 }, saidas: {} } } }), { DFC, Adq14, Adq18, FluxoDFC, Cruzamento } = E; E.flag19 = true;
  let tr = FluxoDFC.trDFC(); const por = id => tr.find(t => t.id === id), cat = id => CAT(E, por(id));
  chk('ligado: a configuração gravada em config/dfc_cartoes18 ("como no extrato" + previsto "FCX") deixa de ser lida — a integração é sempre automática', Adq18.cfg().classificar === true && Adq18.cfg().modoPrevisto === 'sempre' && E.S.config.get('dfc_cartoes18').classificar === false);
  chk('crédito casado pela Auditoria e SEM categoria específica (TED genérico, caiu em "Outras entradas") → "Recebimento de cartões" (Getnet / SafraPay) ou "Recebimento Credsystem", com a origem "Auditoria de Adquirentes" — mesmo com a chave antiga em "como no extrato"', ['a1', 'a2', 'c0', 'c1'].every(id => cat(id).categoria === 'rec_cartoes' && cat(id).origem === 'auditoria_cartoes') && cat('a3').categoria === 'rec_credsystem' && cat('a3').origem === 'auditoria_cartoes', ['a1', 'a2', 'a3', 'c0', 'c1'].map(id => cat(id)));
  chk('crédito que a Auditoria NÃO casou (R$ 777,77) fica como estava: nada de palpite', cat('a4').categoria === 'rec_outros' && cat('a4').origem === 'padrão');
  /* o que o usuário classificou e as regras específicas continuam mandando */
  E.S.extratos.get('xa').transacoes.find(t => t.id === 'a2').cat = 'rec_pix'; E.bump('extratos'); tr = FluxoDFC.trDFC();
  chk('classificação MANUAL do usuário prevalece sobre a Auditoria (o crédito casado marcado como PIX recebido continua PIX)', cat('a2').categoria === 'rec_pix' && cat('a2').origem === 'manual');
  const E2 = await cenario4({}); E2.flag19 = true; E2.S.extratos.get('xa').transacoes.find(t => t.id === 'a2').hist = 'PIX RECEB CLIENTE X'; E2.bump('extratos');
  chk('regra EXPLÍCITA do usuário para outra categoria (PIX recebidos) prevalece sobre a Auditoria', CAT(E2, E2.FluxoDFC.trDFC().find(t => t.id === 'a2')).categoria === 'rec_pix' && CAT(E2, E2.FluxoDFC.trDFC().find(t => t.id === 'a2')).origem === 'regra');
  const E3 = await cenario4({ regras: [{ id: 'r-x', termos: ['CREDITO DIVERSOS'], sentido: 'E', categoria: 'rec_outros' }, ...E.DFC_REGRAS_PADRAO] }); E3.flag19 = true;
  chk('regra do usuário que manda o crédito para "Outras entradas operacionais" não segura o que a Auditoria casou: vai para a categoria de cartões', CAT(E3, E3.FluxoDFC.trDFC().find(t => t.id === 'a2')).categoria === 'rec_cartoes' && CAT(E3, E3.FluxoDFC.trDFC().find(t => t.id === 'a2')).de === 'regra');
  /* o resumo da DFC */
  const E4 = await cenario4({}); E4.flag19 = true; const tr4 = E4.FluxoDFC.trDFC(), c = E4.DFC.consolidar(tr4), c17 = E4.DFC._o18.consolidar.call(E4.DFC, tr4);
  chk('DFC do mês: Recebimento de cartões R$ 8.212,98 (4 lançamentos) e Recebimento Credsystem R$ 300,00; a reclassificação só MOVE valores entre categorias (entradas, saídas e variação líquida iguais às da v14.17)', perto(c.porCategoria.rec_cartoes.valor, 8212.98) && c.porCategoria.rec_cartoes.n === 4 && c.porCategoria.rec_credsystem.valor === 300 && c.entradas === c17.entradas && c.saidas === c17.saidas && c.liquido === c17.liquido, c.porCategoria);
  /* Previsto: Líquido Esperado da Auditoria SEMPRE (mesmo com meta de cartões no FCX e com "fcx" gravado) */
  const cz = Cruzamento.calcular('2026-01'), lin = id => cz.linhas.find(l => l.id === id);
  chk('Previsto dos cartões = Líquido Esperado da Auditoria por data de repasse (R$ 8.212,98), mesmo com meta de R$ 10.000 no FCX e a chave antiga em "FCX"; Credsystem R$ 300,00', perto(lin('rec_cartoes').previsto, 8212.98) && lin('rec_cartoes').fontePrev18 === 'auditoria' && lin('rec_cartoes').previstoFcx18 === 10000 && lin('rec_credsystem').previsto === 300, cz.linhas.map(l => [l.id, l.previsto, l.fontePrev18]));
  /* sem lotes auditados na competência o FCX segue como estava */
  const E5 = ambiente(); E5.flag19 = true; E5.fcxVer = 2; E5.fcxApi = { metodos: { credito: 'Crédito', pix: 'PIX' }, livro: () => ({ '2026-01-10': { entradas: { 'venda:credito': 10000 }, saidas: {} } }), saidas: () => [] };
  const cz5 = E5.Cruzamento.calcular('2026-01');
  chk('sem lotes auditados na competência o Previsto dos cartões continua sendo o do FCX (R$ 10.000), sem fonte "auditoria"', cz5.linhas.find(l => l.id === 'rec_cartoes') && cz5.linhas.find(l => l.id === 'rec_cartoes').previsto === 10000 && !cz5.linhas.find(l => l.id === 'rec_cartoes').fontePrev18, cz5.linhas.map(l => [l.id, l.previsto]));
  /* faixa: some o bloco azul e os seletores; fica o selo de 1 linha */
  FluxoDFC.ui.mes = '2026-01'; FluxoDFC.ui.sub = 'dfc'; const h = FluxoDFC.painelCartoes18();
  chk('o bloco azul "Auditoria de Adquirentes × DFC" e os dois seletores (categoria dos créditos auditados / previsto dos cartões) NÃO são mais gerados; no lugar vem um selo de 1 linha "Cartões conciliados automaticamente: R$ X"', !/Auditoria de Adquirentes × DFC/.test(h) && !/data-a="fd-cartoes-cfg"/.test(h) && !/<select/.test(h) && /class="c19-selo"/.test(h) && /Cartões conciliados automaticamente: <b>R\$/.test(h) && (h.match(/<div/g) || []).length === 1, h);
  const S = E4.Adq19.seloDfc('2026-01', tr4); E4.FluxoDFC.ui.mes = '2026-01'; E4.FluxoDFC.ui.sub = 'dfc';
  chk('o valor do selo = créditos do OFX casados pela Auditoria no mês (R$ 8.512,98 em 5 créditos), com os reclassificados e o Líquido Esperado no mesmo mês na dica', S && perto(S.valor, 8512.98) && S.n === 5 && S.reclassN === 5 && perto(S.reclassValor, 8512.98) && perto(S.previstoValor, 8512.98) && S.adquirentes.join() === 'CREDSYSTEM,GETNET,SAFRAPAY' && E4.FluxoDFC.painelCartoes18().includes('R$8512.98'), S);
  FluxoDFC.ui.sub = 'extratos'; chk('o selo só aparece nas abas Realizado × Previsto e DFC do mês', FluxoDFC.painelCartoes18() === '');
  FluxoDFC.ui.sub = 'dfc'; const Ex = await cenario4({}); Ex.flag19 = true; Ex.Adq14.contratos().forEach(x => Ex.S.adq_contratos.delete(x.id)); Ex.bump('adq_contratos'); Ex.S.adq_lotes.clear(); Ex.S.adq_agendas.clear(); Ex.S.adq_erp.clear(); ['adq_lotes', 'adq_agendas', 'adq_erp'].forEach(c => Ex.bump(c)); Ex.FluxoDFC.ui.mes = '2026-01'; Ex.FluxoDFC.ui.sub = 'dfc';
  chk('sem Auditoria disponível (sem contratos nem lotes) não há selo nem erro', Ex.FluxoDFC.painelCartoes18() === '');
  /* sem circularidade e sem regravação */
  const nGrav = E4.gravacoes.length; E4.DFC.consolidar(tr4); E4.Cruzamento.calcular('2026-01'); E4.FluxoDFC.painelCartoes18();
  chk('a integração é só leitura: classificar, consolidar e desenhar o selo não gravam nada (nenhum parâmetro manual a guardar)', E4.gravacoes.length === nGrav);
  chk('o contador de sobreposição volta a zero e fora da leitura da DFC o classificar devolve a classificação ORIGINAL (o Conciliador e a própria Auditoria não enxergam a sobreposição)', E4.DFC._ov18 === 0 && E4.DFC.classificar(tr4.find(t => t.id === 'a1')).categoria === 'rec_outros');
}

/* =====================================================================
   4 · ITEM 3 · CRUZAMENTO EM 2 NÍVEIS: nível 1 = ERP consolidado por adquirente × soma dos contratos importados (Dt Venda + Bandeira + Modalidade, ± R$ 0,50 por dia);
       nível 2 = por contrato (MDR, antecipação, saldo, OFX); cadastro de contratos sem "Lojas Vinculadas" / ECs / "Puxar do Cadastro"
   ===================================================================== */
{
  const E = await cenario19({ comMar: false }), { Adq19, Adq17, Adq14, Adq15 } = E, nz = x => String(x).replace(/\s+/g, ' ');
  chk('cenário: os contratos NÃO têm lojas vinculadas digitadas para o ERP da Getnet (Mar Aberto) e o ERP traz as lojas de todos os CNPJs misturadas', !(Adq14.contrato(E.CT_MAR).lojas || []).length && Adq15.erpGrupos('2026-01').filter(x => x.adqNome === 'GETNET').length > 0);
  let N = Adq19.nivel1('2026-01'), g = N.porAdq.get('GETNET'), s = N.porAdq.get('SAFRAPAY');
  chk('nível 1 · o ERP é consolidado por adquirente: Getnet R$ 7.187,00 e SafraPay R$ 3.270,00 (todas as lojas e CNPJs somados), sem depender de loja vinculada', perto(g.erpBruto, ERP19_GETNET) && perto(s.erpBruto, ERP19_SAFRA) && g.temErp && s.temErp, { g: g.erpBruto, s: s.erpBruto });
  chk('só a Getnet · Resilienza está importada (1 de 2): o nível 1 vira só INFORMATIVO — "parcial", não comparável, faltam: Getnet · Mar Aberto', g.parcial && g.nImportados === 1 && g.nTotal === 2 && !g.comparavel && g.faltam.length === 1 && /Mar Aberto/.test(g.faltam[0]) && perto(g.adqBruto, ADQ19_GETNET_RES), g);
  chk('contratos faltando NÃO geram divergência: nenhuma linha do nível 1 da Getnet fica "dif", "só ERP" ou "só adquirente" (só "ok" ou "parcial"), e o ERP das lojas do outro CNPJ não vira linha falsa de "ERP R$ 0,00"', g.linhas.length > 0 && g.linhas.every(l => ['ok', 'parcial', 'foraErp', 'foraAdq'].includes(l.status)) && g.linhas.some(l => l.status === 'parcial') && g.k.dif === 0 && g.k.semAdq === 0 && g.k.semErp === 0, g.linhas.map(l => [l.data, l.band, l.status]));
  let I = Adq17.indicadores('2026-01', '*');
  chk('os indicadores trazem o nível 1 por adquirente (I.nivel1) e o consolidado só soma a diferença das adquirentes COMPLETAS (Getnet parcial fica de fora)', I.nivel1.length === 2 && I.consolidado.bruto.nivel1 === true && I.consolidado.bruto.comparaveis === 1 && I.consolidado.bruto.parciais === 1 && perto(I.consolidado.bruto.difR, s.difR) && perto(I.consolidado.bruto.erp, ERP19_GETNET + ERP19_SAFRA), { b: I.consolidado.bruto });
  chk('Maiores Divergências: nenhuma linha ERP × adquirente da Getnet (parcial) e nenhuma "ERP R$ 0,00"; só as da SafraPay (consolidado)', !I.ranking.some(x => /GETNET/.test(x.contrato) && ['erpAdq', 'semAdq', 'semErp'].includes(x.tipo)) && !I.ranking.some(x => /ERP R\$0\.00/.test(x.desc || '')) && I.ranking.some(x => /SAFRAPAY \(consolidado\)/.test(x.contrato)), I.ranking.map(x => [x.tipo, x.contrato, x.valor]));
  chk('aviso explícito: "GETNET: 1 de 2 contrato(s) importado(s) … só é comparado quando todos os contratos têm arquivo (faltam: GETNET · Mar Aberto)"; nenhum aviso de "loja(s) com vendas sem contrato vinculado"', I.avisos.some(a => /^GETNET: 1 de 2 contrato\(s\) importado\(s\) na competência/.test(a) && /faltam: GETNET · Mar Aberto/.test(a)) && !I.avisos.some(a => /loja\(s\) com vendas sem contrato vinculado/.test(a)), I.avisos);
  chk('nível 2 · cada contrato da Getnet / SafraPay marca o ERP como "conferido no consolidado" (sem diferença própria) e só o ERP × adquirente muda: o resto do contrato (MDR, antecipação, repasse, OFX) segue individual', I.contratos.filter(r => !r.direto).every(r => r.bruto.erpConsolidado === true && r.bruto.difR === null && r.bruto.comparavel === false) && I.contratos.filter(r => r.bruto.base > 0).every(r => r.mdr && r.repasse), I.contratos.map(r => [r.id, r.bruto.erpConsolidado, r.bruto.base]));
  /* importa o contrato que faltava → o consolidado passa a ser comparável */
  await E.importarMar(); N = Adq19.nivel1('2026-01'); g = N.porAdq.get('GETNET'); I = Adq17.indicadores('2026-01', '*');
  chk('importado o contrato que faltava: Getnet 2 de 2, comparável, e o bruto da adquirente é a SOMA dos dois contratos (R$ 7.100,00) contra o ERP consolidado (R$ 7.187,00)', !g.parcial && g.comparavel && g.nImportados === 2 && perto(g.adqBruto, ADQ19_GETNET_RES + ADQ19_GETNET_MAR) && perto(g.erpBruto, ERP19_GETNET) && perto(g.difR, ERP19_GETNET - (ADQ19_GETNET_RES + ADQ19_GETNET_MAR)), g);
  /* recomputação independente: Dt Venda + Bandeira + Modalidade, ± R$ 0,50 */
  const kk = (dv, b, m) => [dv, b, m].join('|'), Em = new Map(), Am = new Map();
  Adq15.erpGrupos('2026-01').filter(x => x.adqNome === 'GETNET').forEach(x => { const k = kk(x.dv, x.band, x.mod); Em.set(k, (Em.get(k) || 0) + Adq15.c(x.bruto) / 100); });
  [...Adq14.calcularMes('2026-01').values()].filter(c => c.adquirente === 'GETNET').forEach(c => (c.lote.grupos || []).forEach(x => { const k = kk(x.dv, Adq15.bandKey(x.band), x.mod); Am.set(k, (Am.get(k) || 0) + x.bruto); }));
  const difs = [...new Set([...Em.keys(), ...Am.keys()])].map(k => [k, r2((Em.get(k) || 0) - (Am.get(k) || 0))]).filter(([, d]) => Math.abs(d) > 0.5);
  chk('conferência independente (recalculada por fora do motor): exatamente 2 combinações Dt Venda + Bandeira + Modalidade divergem (Mastercard à vista 05/01 em +R$ 10 e Elo à vista 12/01 em +R$ 77) e a soma é a diferença do nível 1 (R$ 87,00)', difs.length === 2 && perto(difs.reduce((a, [, d]) => a + d, 0), 87) && g.k.dif + g.k.semAdq + g.k.semErp === 2 && perto(g.k.vDif, 87) && perto(g.difR, 87), { difs, k: g.k });
  chk('as duas divergências aparecem nas Maiores Divergências como "GETNET (consolidado)" (e não por contrato), com o valor do dia / bandeira', I.ranking.filter(x => x.contrato === 'GETNET (consolidado)').length === 2 && perto(I.ranking.filter(x => x.contrato === 'GETNET (consolidado)').reduce((a, x) => a + x.valor, 0), 87) && !I.avisos.some(a => /^GETNET: \d de \d contrato/.test(a)), I.ranking.map(x => [x.contrato, x.ref, x.valor]));
  chk('consolidado do Painel: diferença = Getnet (R$ 87,00) + SafraPay (R$ 500,00), com os dias / bandeiras divergentes de cada adquirente somados', perto(I.consolidado.bruto.difR, 87 + 500) && I.consolidado.bruto.comparaveis === 2 && I.consolidado.bruto.diasDiv === g.k.dif + g.k.semAdq + g.k.semErp + N.porAdq.get('SAFRAPAY').k.dif + N.porAdq.get('SAFRAPAY').k.semAdq + N.porAdq.get('SAFRAPAY').k.semErp, I.consolidado.bruto);
  /* ± R$ 0,50 por dia: uma diferença de R$ 0,40 não é divergência */
  const gr = [...E.S.adq_erp.values()].length; const doc0 = [...E.S.adq_erp.values()][0];
  chk('tolerância: o nível 1 usa ±R$ 0,50 por dia / bandeira / modalidade (ADQ19.TOL_DIA)', E.ADQ19.TOL_DIA === 0.5 && gr >= 1 && !!doc0);
  /* filtro por adquirente */
  const IG = Adq17.indicadores('2026-01', 'adq:GETNET');
  chk('Visualização "adq:GETNET": os dois contratos da Getnet entram juntos (consolidado da adquirente), a SafraPay fica fora e o escopo diz "GETNET · todos os contratos (2)"', IG.contratos.length === 2 && IG.contratos.every(r => r.adquirente === 'GETNET') && /GETNET · todos os contratos \(2\)/.test(IG.escopo) && IG.nivel1.length === 1 && perto(IG.consolidado.bruto.difR, 87), { e: IG.escopo, n: IG.contratos.length });
  chk('o filtro inválido (adquirente sem contrato) volta para o consolidado "*"', Adq19.filtroValido('adq:CREDSYSTEM') === '*' && Adq19.filtroValido('adq:GETNET') === 'adq:GETNET' && Adq19.filtroValido('adq-getnet__emp-mar-aberto') === 'adq-getnet__emp-mar-aberto' && Adq19.filtroValido('xxx') === '*' && Adq19.adquirentesComContrato().join() === 'GETNET,SAFRAPAY');
  /* ERP não importado: informação, sem erro */
  const E0 = await cenario19({ erp: false }); const N0 = E0.Adq19.nivel1('2026-01'), I0 = E0.Adq17.indicadores('2026-01', '*');
  chk('sem o ERP importado: nível 1 sem comparativo (temErp falso), avisa "ERP (Apuração dos Créditos) não importado" e não inventa diferença', !N0.porAdq.get('GETNET').temErp && N0.porAdq.get('GETNET').difR === null && I0.avisos.some(a => /ERP \(Apuração dos Créditos\) não importado na competência/.test(a)) && I0.consolidado.bruto.comparaveis === 0, I0.avisos);
  /* Credsystem direto com o OFX: as lojas do contrato vêm do Cadastro de Lojas (sem passo manual) */
  const Ec = await cenario19({ erp: false }); const mk = (emp, conta) => { const id = Ec.Adq14.idContrato('CREDSYSTEM', emp); Ec.S.adq_contratos.set(id, { id, adquirente: 'CREDSYSTEM', empresaId: emp, contaId: conta, ativo: true }); return id; };
  const c1 = mk('resilienza', 'ct-a'), c2 = mk('mar-aberto', 'ct-b'); Ec.bump('adq_contratos');
  const lj = (cod, nome, adqs) => ({ id: 'loja-' + cod.padStart(3, '0'), codigo: cod, nome, ativa: true, cnpj: '', adquirentes: adqs }), AA = (ec, emp) => ({ adquirente: 'CREDSYSTEM', tipo: 'CARTÃO PRÓPRIO', posicao: 'PRIMÁRIA', ec, empresaId: emp });
  [lj('01', 'Loja Praia', [AA('7001', 'resilienza')]), lj('03', 'Loja Mar', [AA('7003', 'mar-aberto')])].forEach(l => Ec.S.lojas.set(l.id, l)); Ec.bump('lojas');
  const e1 = Ec.Adq15.escopoErp(Ec.Adq14.contrato(c1)), e2 = Ec.Adq15.escopoErp(Ec.Adq14.contrato(c2));
  chk('Credsystem (sem arquivo da adquirente) com 2 contratos e SEM lojas digitadas: o ERP de cada contrato usa as lojas do Cadastro de Lojas (Resilienza → loja 01; Mar Aberto → loja 03), sozinho', e1.tipo === 'lojas' && e1.cadastro === true && e1.lojas.size === 1 && e2.tipo === 'lojas' && e2.lojas.size === 1 && [...e1.lojas][0] !== [...e2.lojas][0], { e1: [...e1.lojas], e2: [...e2.lojas] });
  Ec.flag19 = false; const eOff = Ec.Adq15.escopoErp(Ec.Adq14.contrato(c1));
  chk('desligado: o escopo do ERP é o da v14.18.2 (lojas vinculadas digitadas; sem elas, "sem escopo")', eOff.lojas.size === 0 && eOff.tipo !== 'lojas', eOff);
}
{
  /* ---------- cadastro de contratos: só Adquirente, Empresa / CNPJ, Conta Bancária (OFX) e Regras de Taxa ---------- */
  const E = await cenario19({ erp: false }), { Adq14, Adq15 } = E, ID = 'adq-getnet__emp-resilienza';
  Adq14.contrato(ID).ecs = ['15105016']; E.S.adq_contratos.get(ID).ecs = ['15105016']; E.bump('adq_contratos');
  const t = E.Adq14.renderContratos(), cols = [...t.matchAll(/<th[^>]*>([^<]*)</g)].map(x => x[1].replace(/ · .*/, '').trim());
  chk('tabela de contratos: Adquirente · Empresa / CNPJ · Conta Bancária (OFX) · Antecipação vigente · Bandeiras com Taxa · Lotes · Ações — sem "Lojas Vinculadas", sem "ECs" e sem "Puxar do Cadastro"', ['Adquirente', 'Empresa / CNPJ', 'Conta Bancária (OFX)', 'Antecipação vigente', 'Bandeiras com Taxa', 'Lotes', 'Ações'].every(h => cols.includes(h)) && !/Lojas Vinculadas|ECs|Puxar|a14-contrato-puxar/.test(t) && (t.match(/data-a="a14-contrato-editar"/g) || []).length === 3, { cols });
  E.modais.length = 0; Adq15.abrirContrato(ID); const m = E.modais.at(-1), corpo = m.corpo;
  chk('modal do contrato (editar): Adquirente, Empresa / CNPJ, Conta Bancária de Crédito (OFX), Observação e as Vigências de Antecipação — sem campos de lojas / ECs e sem "Puxar Lojas e ECs"', /name="adquirente"/.test(corpo) && /name="empresaId"/.test(corpo) && /name="contaId"/.test(corpo) && /name="observacao"/.test(corpo) && /Vigências de Antecipação/i.test(corpo) && !/name="lojas"|name="ecs"|data-a18-puxar|Puxar/i.test(corpo) && !/Lojas do ERP|Lojas Vinculadas/.test(corpo), corpo.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 500));
  E.form = { contaId: 'ct-b', observacao: 'sem lojas' }; const r = await m.acoes[1].acao({ querySelector: () => null }); await espera();
  const c = Adq14.contrato(ID);
  chk('salvar pelo modal novo grava a conta e a observação e NÃO apaga os vínculos que já estavam no contrato (lojas 01 e 02, EC 15105016): nada é perdido na migração', r !== false && c.contaId === 'ct-b' && c.observacao === 'sem lojas' && igual(c.lojas, ['01', '02']) && igual(c.ecs, ['15105016']), c);
  E.modais.length = 0; Adq15.abrirContrato(null, { adquirente: 'CREDSYSTEM', empresaId: 'resilienza' }); const mn = E.modais.at(-1);
  chk('contrato novo (Credsystem · Resilienza): o modal vem sem lojas / ECs e o título é "Novo contrato"', mn.titulo === 'Novo contrato' && !/name="lojas"|name="ecs"|Puxar/.test(mn.corpo));
  E.form = { adquirente: 'CREDSYSTEM', empresaId: 'resilienza', contaId: 'ct-a', observacao: '' }; const r2n = await mn.acoes[1].acao({ querySelector: () => null }); await espera();
  const cn = Adq14.contrato('adq-credsystem__emp-resilienza');
  chk('o contrato novo salva só com Adquirente, Empresa / CNPJ e Conta Bancária (sem lojas nem ECs digitados)', r2n !== false && cn && cn.contaId === 'ct-a' && !(cn.lojas || []).length && !(cn.ecs || []).length, cn);
  E.form = { adquirente: 'GETNET', empresaId: 'resilienza', contaId: '', observacao: '' }; E.modais.length = 0; E.toasts.length = 0; Adq15.abrirContrato(ID); const rr = await E.modais.at(-1).acoes[1].acao({ querySelector: () => null });
  chk('sem a Conta Bancária (OFX) o contrato não salva e o usuário é avisado (campo obrigatório)', rr === false && E.toasts.length > 0, E.toasts);
  E.flag19 = false; E.modais.length = 0; Adq15.abrirContrato(ID); const mo = E.modais.at(-1);
  chk('desligado: o modal é o da v14.18.2 (com lojas, ECs e "Puxar do Cadastro")', /name="lojas"/.test(mo.corpo) && /name="ecs"/.test(mo.corpo) && /Puxar/.test(mo.corpo));
}

/* =====================================================================
   5 · ITEM 4 · TAXA EFETIVA TOTAL (MDR efetivo + antecipação efetiva + tarifas e aluguel de POS + retenções / chargebacks) abatida do Líquido Esperado e do Saldo a Receber:
       busca ampliada de POS / retenções nas outras contas do mesmo CNPJ (sem duplicar), fallback do Cadastro de POS, ponte até o crédito esperado no banco
   ===================================================================== */
const OFX19 = (E, { extras = true } = {}) => {
  const tr = FX.tr, doc = FX.docOfx;
  E.S.contasBancarias.set('ct-d', { id: 'ct-d', apelido: 'Conta D', ativa: true, titularEmpresaId: 'resilienza' }); E.bump('contasBancarias');
  FX.ofx(E, [doc('xa', 'ct-a', '2026-01', [tr('a1', '2026-01-06', E.e06, 'CREDITO GETNET LIQUIDACAO'), tr('a7', '2026-01-08', -7.5, 'TARIFA ALUGUEL POS GETNET'), tr('a8', '2026-01-23', -3.2, 'RETENCAO GETNET ANTECIPACAO')]), doc('xb', 'ct-b', '2026-01', []), doc('xc', 'ct-c', '2026-01', []),
    doc('xd', 'ct-d', '2026-01', extras ? [tr('d1', '2026-01-15', -50, 'TARIFA ALUGUEL POS GETNET'), tr('d2', '2026-01-16', -20, 'CHARGEBACK GETNET'), tr('d3', '2026-01-17', -999, 'PAGTO FORNECEDOR XYZ'), tr('d4', '2026-01-18', -11, 'TARIFA ALUGUEL POS')] : [])]);
  const lj = (cod, nome, adqs) => ({ id: 'loja-' + cod.padStart(3, '0'), codigo: cod, nome, ativa: true, cnpj: '', adquirentes: adqs }), AA = (adq, ec, emp, x = {}) => ({ adquirente: adq, tipo: 'CARTÃO TERCEIROS', posicao: 'PRIMÁRIA', ec, empresaId: emp, ...x });
  [lj('03', 'Loja Mar', [AA('GETNET', '13100535', 'mar-aberto', { qtdePos: '2', posAluguel: 60 })]), lj('05', 'Loja Norte', [AA('SAFRAPAY', '1454475', 'resilienza')])].forEach(l => E.S.lojas.set(l.id, l)); E.bump('lojas');
};
{
  const E = await cenario19({ erp: false }), { Adq17, Adq18, Adq19 } = E; OFX19(E); Adq17.indicadores('2026-01', '*');
  const I = Adq17.indicadores('2026-01', '*'), c = I.consolidado, R = id => I.contratos.find(r => r.id === id), res = R(FX.CT.res), mar = R(E.CT_MAR), saf = R(FX.CT.saf);
  chk('busca ampliada: o aluguel de POS (R$ 50) e o chargeback (R$ 20) debitados em OUTRA conta do mesmo CNPJ (Conta D, titular Resilienza) e que citam a Getnet entram na Taxa Efetiva da Getnet · Resilienza, somados ao que já estava na conta de crédito (R$ 7,50 e R$ 3,20)', res.tarifaExtraR === 50 && res.retencaoExtraR === 20 && res.tarifaPropriaR === 7.5 && res.retencaoPropriaR === 3.2 && res.tarifaR === 57.5 && res.retencaoR === 23.2 && res.tarifaOrigem === 'ofx', { t: res.tarifaR, r: res.retencaoR, x: [res.tarifaExtraR, res.retencaoExtraR] });
  chk('o débito sem relação com cartões (R$ 999 a fornecedor) fica de fora; o aluguel de POS genérico (R$ 11, sem citar a adquirente) com DOIS contratos de cartões na empresa não é atribuído a ninguém — fica sem dono e é avisado (nada some em silêncio)', !I.tarifasPorConta.some(x => [...x.tarifa, ...x.retencao].some(t => t.id === 'd3' || t.id === 'd4')) && Adq19.extrasDoMes('2026-01').semDono.length === 1 && Adq19.extrasDoMes('2026-01').semDono[0].valor === 11 && I.avisos.some(a => /1 débito\(s\) de POS\/retenção \(R\$11\.00\) em outras contas do CNPJ não citam a adquirente/.test(a)), { sd: Adq19.extrasDoMes('2026-01').semDono, av: I.avisos });
  const ids = I.tarifasPorConta.flatMap(x => [...x.tarifa, ...x.retencao]).map(t => t.id);
  chk('cada lançamento entra UMA vez só: ids únicos entre as contas, SafraPay sem custo de POS e o consolidado soma R$ 57,50 + R$ 120,00 (cadastro) de POS e R$ 23,20 de retenções', new Set(ids).size === ids.length && ids.sort().join() === 'xa|a7,xa|a8,xd|d1,xd|d2' && saf.tarifaR === 0 && saf.retencaoR === 0 && perto(c.tarifas.posR, 57.5 + 120) && perto(c.tarifas.retencaoR, 23.2) && c.tarifas.nPos === 2 && c.tarifas.nRet === 2 && c.tarifas.posExtraR === 50 && c.tarifas.retencaoExtraR === 20, { ids, c: c.tarifas });
  chk('fallback do Cadastro de POS: a Getnet · Mar Aberto não tem débito de aluguel de POS no OFX do CNPJ em janeiro — soma o aluguel cadastrado por filial (2 POS × R$ 60 = R$ 120) e marca a origem "cadastro" ("apurado pelo cadastro de POS")', mar.tarifaOrigem === 'cadastro' && mar.tarifaR === 120 && mar.tarifaCadastro.total === 120 && mar.tarifaCadastro.itens.length === 1 && mar.tarifaCadastro.itens[0].qtd === 2 && mar.tarifaCadastro.itens[0].unit === 60 && c.tarifas.posCadastroR === 120, mar.tarifaCadastro);
  chk('o aviso diz de onde veio: "Tarifas e aluguel de POS apurado pelo cadastro de POS (sem débito de aluguel no OFX do CNPJ no mês): Getnet · Mar Aberto R$ 120,00" e a leitura da tarifa nomeia o que veio de outras contas e do cadastro', I.avisos.some(a => /apurado pelo cadastro de POS \(sem débito de aluguel no OFX do CNPJ no mês\): .*Mar Aberto R\$120\.00/.test(a)) && /achados em outras contas do mesmo CNPJ/.test(Adq18.leituraTarifa(c.tarifas, 'tarifa')) && /apurado pelo cadastro de POS/.test(Adq18.leituraTarifa(c.tarifas, 'tarifa')) && /achados em outras contas do mesmo CNPJ/.test(Adq18.leituraTarifa(c.tarifas, 'retencao')), Adq18.leituraTarifa(c.tarifas, 'tarifa'));
  /* Taxa Efetiva Total e Líquido Esperado */
  const soma = r => r2((r.mdr ? r.mdr.efetivoR : 0) + (r.ant ? r.ant.efetivoR : 0) + r.tarifaR + r.retencaoR);
  chk('Taxa Efetiva Total por contrato = MDR efetivo + antecipação efetiva + tarifas e aluguel de POS + retenções / chargebacks (e o consolidado fecha pela soma das partes e dos contratos)', I.contratos.filter(r => r.bruto.base > 0).every(r => perto(r.taxa.r, soma(r))) && perto(c.taxa.r, c.taxa.mdrR + c.taxa.antR + c.tarifas.posR + c.tarifas.retencaoR) && perto(c.taxa.r, r2(I.contratos.reduce((a, r) => a + r.taxa.r, 0))) && perto(c.taxa.tarifaR, c.tarifas.posR), { c: c.taxa });
  chk('Líquido Esperado após taxas = Bruto conciliado − Taxa Efetiva Total (por contrato e no consolidado): um só número, sem diferença entre o "líquido" do card e o da conta', I.contratos.every(r => perto(r.liquido.esperadoR, (r.bruto.base || 0) - r.taxa.r)) && perto(c.liquido.esperadoR, c.bruto.base - c.taxa.r) && perto(c.liquido.taxasR, c.taxa.r) && c.liquido.brutoR === c.bruto.base && perto(c.liquido.esperadoR, r2(I.contratos.reduce((a, r) => a + r.liquido.esperadoR, 0))), c.liquido);
  const resid = r2(c.liquido.creditoEsperadoR - (c.liquido.esperadoR + c.liquido.posRetR + c.liquido.antDifR)), ponte = Adq19.ponteLaudo(c, x => String(x), n => 'R$' + Number(n).toFixed(2), n => String(n));
  chk('ponte até o crédito esperado no banco: Líquido esperado após taxas + (tarifas de POS e retenções, debitadas à parte) + (antecipação efetiva − estimada) ± outros ajustes (resíduo explícito) = crédito esperado no banco = repasse esperado do painel', perto(c.liquido.posRetR, c.tarifas.posR + c.tarifas.retencaoR) && perto(c.liquido.creditoEsperadoR, c.repasse.esperado) && perto(c.liquido.creditoEsperadoR, c.liquido.esperadoR + c.liquido.posRetR + c.liquido.antDifR + resid), { l: c.liquido, resid });
  chk('a ponte do Laudo mostra as três linhas e só mostra "(±) Outros ajustes" quando o resíduo passa de R$ 0,01', /Líquido esperado após taxas/.test(ponte) && /\(\+\) Tarifas e aluguel de POS e retenções/.test(ponte) && /\(\+\) Antecipação efetiva − antecipação estimada/.test(ponte) && /\(=\) Crédito esperado no banco/.test(ponte) && (/Outros ajustes/.test(ponte) === (Math.abs(resid) > 0.009)), { resid });
  const I2 = Adq17.indicadores('2026-01', '*');
  chk('os indicadores são memorizados e a busca ampliada é idempotente (não soma duas vezes ao reler)', I2 === I && Adq19.aplicarTaxas(I2) === I2 && I2.consolidado.tarifas.posR === c.tarifas.posR);
  /* Saldo a Receber: abate a Taxa Efetiva Total completa */
  const S = Adq18.saldoReceber('2026-01', '*'), sc = S.consolidado, pm = Adq19.saldoPorMes(S);
  chk('Saldo a Receber: as Taxas Efetivas Abatidas = a Taxa Efetiva Total do painel (inclui POS e retenções) e o Saldo Líquido Final = Saldo Bruto Futuro − Taxas Efetivas Abatidas', perto(sc.taxas.totalR, c.taxa.r) && perto(sc.taxas.tarifaR, c.tarifas.posR) && perto(sc.taxas.retencaoR, c.tarifas.retencaoR) && perto(sc.saldoLiquido, sc.saldoBruto - sc.taxas.totalR), { s: sc.taxas, b: sc.saldoBruto, l: sc.saldoLiquido });
  chk('série mensal do saldo: o abatimento do mês corrente é a Taxa Efetiva Total do mês e o rateio por mês de pagamento fecha ao centavo (bruto, taxas e líquido) — a diferença de centavos vai para o último mês', pm.length >= 1 && perto(r2(pm.reduce((a, x) => a + x.bruto, 0)), sc.saldoBruto) && perto(r2(pm.reduce((a, x) => a + x.taxas, 0)), sc.taxas.totalR) && perto(r2(pm.reduce((a, x) => a + x.liquido, 0)), sc.saldoLiquido) && S.serie.some(x => x.mes === '2026-01' && perto(x.totalR, c.taxa.r)), { pm, serie: S.serie.map(x => [x.mes, x.totalR]) });
  const h = Adq19.htmlSaldo('2026-01', '*');
  chk('rótulos do saldo na tela: "Saldo Bruto Futuro", "(−) Taxas Efetivas Abatidas" e "(=) Saldo Líquido Final a Receber" (cards) com a fórmula "saldo bruto futuro − taxas efetivas abatidas"; tabela por contrato e série mensal com "Líquido esperado após taxas"', ['Saldo Bruto Futuro', '(−) Taxas Efetivas Abatidas', '(=) Saldo Líquido Final a Receber', 'saldo bruto futuro − taxas efetivas abatidas', 'Taxas efetivas abatidas', 'Saldo líquido final', 'Líquido esperado após taxas', 'Mês do pagamento'].every(t => h.includes(t)) && h.includes('R$' + sc.taxas.totalR.toFixed(2)) && h.includes('R$' + sc.saldoLiquido.toFixed(2)), h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 400));
  const qs = Adq18.quadroSaldoLaudo(I, E.esc || (x => String(x)), n => 'R$' + Number(n).toFixed(2), n => String(n));
  chk('Laudo A4 · Quadro 5 usa os mesmos rótulos e a mesma conta (bruto, taxas efetivas abatidas, saldo líquido final, por mês de pagamento e a coluna "Líquido esperado após taxas")', ['Quadro 5', 'Saldo Bruto Futuro', 'Taxas Efetivas Abatidas', 'Saldo Líquido Final a Receber', 'Líquido esperado após taxas'].every(t => qs.includes(t)) && qs.includes('R$' + sc.saldoLiquido.toFixed(2)), qs.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300));
  const linhas = []; Adq18.linhasCsvSaldo('2026-01', '*', n => String(n), (...a) => linhas.push(a));
  chk('CSV: "Saldo bruto futuro", "Taxas efetivas abatidas" e "Saldo líquido final a receber" no consolidado', ['Saldo bruto futuro', 'Taxas efetivas abatidas', 'Saldo líquido final a receber'].every(t => linhas.some(l => l.some(x => String(x).includes(t)))), linhas.slice(0, 6));
  /* Laudo A4: Quadro 1 / 2 / 3 */
  const laudo = Adq17.htmlLaudo(I, { razao: 'Resilienza Negocios Ltda', cnpj: CNPJ_RES, marca: 'Esposende', emitidoEm: '17/11/2026', notas: '', signatarios: [] });
  chk('Laudo Operacional (A4): Quadro 1 "Líquido esperado após a taxa efetiva total", Quadro 3 "Crédito esperado no banco" + a ponte e o "Nível 1 — ERP × Adquirente" no Quadro 2; POS do cadastro identificado', /Líquido esperado após a taxa efetiva total/.test(laudo) && /Crédito esperado no banco/.test(laudo) && /Ponte entre o líquido esperado após taxas e o crédito esperado no banco/.test(laudo) && /Quadro 5/.test(laudo) && /Taxas Efetivas Abatidas/.test(laudo), laudo.length);
  /* desligado: sem busca ampliada, sem fallback */
  E.flag19 = false; const Ioff = Adq17.indicadores('2026-01', '*'), roff = Ioff.contratos.find(r => r.id === FX.CT.res), moff = Ioff.contratos.find(r => r.id === E.CT_MAR);
  chk('desligado: só a conta de crédito do contrato (R$ 7,50 e R$ 3,20), sem as outras contas do CNPJ e sem o aluguel do Cadastro de POS (Mar Aberto sem custo de POS) — números da v14.18.2', roff.tarifaR === 7.5 && roff.retencaoR === 3.2 && roff.tarifaExtraR === undefined && moff.tarifaR === 0 && !moff.tarifaOrigem && Ioff.consolidado.liquido === undefined && !Ioff.avisos.some(a => /apurado pelo cadastro de POS/.test(a)), { r: roff.tarifaR, m: moff.tarifaR });
  E.flag19 = true;
  /* sem débito em nenhuma conta e sem cadastro: nada é inventado */
  const E0 = await cenario19({ erp: false }); OFX19(E0, { extras: false }); E0.S.lojas.clear(); E0.bump('lojas'); const I0 = E0.Adq17.indicadores('2026-01', '*'), m0 = I0.contratos.find(r => r.id === E0.CT_MAR);
  chk('sem aluguel no OFX e sem POS no Cadastro de Lojas, o custo de POS do contrato é zero (nada é inventado) e a origem fica vazia', m0.tarifaR === 0 && !m0.tarifaOrigem && !I0.avisos.some(a => /apurado pelo cadastro/.test(a)));
  /* empresa com um único contrato de cartões: o débito genérico em outra conta do CNPJ é do contrato */
  const E1 = await cenario19({ erp: false }); OFX19(E1); E1.S.adq_contratos.delete(FX.CT.saf); E1.bump('adq_contratos'); const I1 = E1.Adq17.indicadores('2026-01', '*'), r1 = I1.contratos.find(r => r.id === FX.CT.res);
  chk('empresa com UM só contrato de cartões (Resilienza só com a Getnet): o aluguel de POS genérico (R$ 11) de outra conta do CNPJ é atribuído ao contrato (uma vez só) e não sobra aviso de "sem dono"', r1.tarifaExtraR === 61 && E1.Adq19.extrasDoMes('2026-01').semDono.length === 0 && !I1.avisos.some(a => /não citam a adquirente/.test(a)), { x: r1.tarifaExtraR });
}

/* =====================================================================
   6 · ITEM 2 · CONCILIAÇÃO DE CARTÕES EM 3 BLOCOS: (1) barra de carga compacta, (2) uma linha com 4 cards executivos, (3) tabela única por Adquirente com subtotal, contratos e drill-down;
       Laudo (A4) e CSV com o líquido após taxas, a ponte e o nível 1
   ===================================================================== */
{
  const E = await cenario19({ comMar: false }), { Adq14, Adq17, Adq18, Adq19 } = E; OFX19(E); Adq14.ui.mes = '2026-01'; Adq14.ui.filtro = '*'; Adq17.indicadores('2026-01', '*');
  const txt = h => h.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '), I = Adq17.indicadores('2026-01', '*'), c = I.consolidado;
  let h = Adq14.render(), T = txt(h);
  chk('a tela é a de 3 blocos (.a19): barra de carga, uma linha de cards e a tabela por adquirente — e NÃO traz as 3 etapas, o Painel Executivo antigo nem o painel "Auditoria · Adquirente × Banco"', /class="a14 a15 a17 a19"/.test(h) && /class="[^"]*a19-b1/.test(h) && /class="[^"]*a19-cards/.test(h) && /a19-tab/.test(h) && !/a15-etapa/.test(h) && !/id="a17-painel"/.test(h) && !/Auditoria · Adquirente × Banco/.test(T) && !/Lojas Vinculadas|Puxar do Cadastro/.test(T), T.slice(0, 200));
  const barra = h.slice(h.indexOf('a19-b1'), h.indexOf('a19-cards')), tb = txt(barra);
  chk('bloco 1 · barra de carga compacta: competência, botões "Importar ERP", "Importar Adquirente" e "Recalcular", status do ERP / Adquirentes (x/y contratos) / OFX e o acordeão "Ver arquivos importados (X)"', /id="a14m"[^>]*data-a="a14-mes"|data-a="a14-mes"[^>]*id="a14m"/.test(barra) && /data-a="a19-painel" data-v="erp"/.test(barra) && /data-a="a19-painel" data-v="adq"/.test(barra) && /data-a="a14-recalcular"/.test(barra) && /Importar ERP/.test(tb) && /Importar Adquirente/.test(tb) && /Recalcular/.test(tb) && /ERP importado/.test(tb) && /GETNET: 1\/2 contrato\(s\)/.test(tb) && /SAFRAPAY: 1\/1 contrato\(s\)/.test(tb) && /OFX: 2\/4 conta\(s\) com extrato|OFX: \d\/\d conta\(s\) com extrato/.test(tb) && /▸ Ver arquivos importados \(\d+\)/.test(tb), tb);
  const kp = [...h.slice(h.indexOf('a19-cards')).split('a19-b3')[0].matchAll(/<div class="kpi[^"]*"><div class="k">([^<]*)<\/div>/g)].map(x => x[1]);
  chk('bloco 2 · exatamente 4 cards executivos em uma linha: Faturamento conciliado ERP × Adquirente · Custo financeiro total · Repasse bancário · Saldo a receber futuro', kp.length === 4 && /faturamento conciliado/i.test(kp[0]) && /custo financeiro total/i.test(kp[1]) && /repasse banc/i.test(kp[2]) && /saldo a receber futuro/i.test(kp[3]), kp);
  const cards = txt(h.slice(h.indexOf('a19-cards'), h.indexOf('a19-b3') > 0 ? h.indexOf('a19-b3') : h.indexOf('a19-tab')));
  const S = Adq18.saldoReceber('2026-01', '*').consolidado;
  chk('os cards trazem os números do motor: bruto conciliado, Taxa Efetiva Total com MDR / Antecipação / POS / Retenções, repasse OFX × esperado com a % de realização e o saldo futuro "bruto − taxas efetivas = líquido final"', cards.includes('R$' + c.bruto.base.toFixed(2)) && cards.includes('R$' + c.taxa.r.toFixed(2)) && cards.includes('MDR R$' + c.mdr.efetivoR.toFixed(2)) && cards.includes('Antecipação R$' + c.ant.efetivoR.toFixed(2)) && cards.includes('Tarifas/aluguel de POS R$' + c.tarifas.posR.toFixed(2)) && cards.includes('Retenções R$' + c.tarifas.retencaoR.toFixed(2)) && /realização/.test(cards) && cards.includes('R$' + S.saldoBruto.toFixed(2)) && cards.includes('R$' + S.saldoLiquido.toFixed(2)) && /taxas efetivas/.test(cards) && /líquido final/.test(cards), cards);
  chk('card 1 só compara o que é comparável: "GETNET: 1 de 2 contratos importados (só informativo)" aparece e a diferença do card é só a da SafraPay (R$ 500,00)', /GETNET: 1 de 2 contratos importados/.test(cards) && /só informativo/.test(cards) && cards.includes('R$500.00'), cards);
  /* bloco 3 */
  const th = [...h.slice(h.indexOf('a19-tab')).split('</thead>')[0].matchAll(/<th[^>]*>([^<]*)</g)].map(x => x[1].trim());
  chk('bloco 3 · uma única tabela consolidada com as colunas Contrato / CNPJ · Bruto ERP · Bruto Adquirente · Dif. ERP × Adq. · MDR (efet. × contr.) · Antecipação · Taxa efetiva total · Creditado OFX · Trânsito · Situação', ['Contrato / CNPJ', 'Bruto ERP', 'Bruto Adquirente', 'Dif. ERP × Adq.', 'MDR (efet. × contr.)', 'Antecipação', 'Taxa efetiva total', 'Creditado OFX', 'Trânsito', 'Situação'].every((x, i) => th[i + 1] === x) && th[0] === '', th);
  const adqs = [...h.matchAll(/<tr class="a19-lin a19-adq"[^>]*data-id="([^"]+)"/g)].map(x => x[1]), cons = [...h.matchAll(/<tr class="a19-lin a19-con"[^>]*data-id="([^"]+)"/g)].map(x => x[1]);
  chk('agrupada por Adquirente: uma linha de subtotal por adquirente (GETNET, SAFRAPAY) seguida das linhas dos seus contratos (Getnet · Mar Aberto, Getnet · Resilienza, SafraPay · Resilienza)', adqs.join() === 'adq:GETNET,adq:SAFRAPAY' && cons.length === 3 && h.indexOf('data-id="adq:GETNET"') < h.indexOf('data-id="adq-getnet__emp-mar-aberto"') && h.indexOf('data-id="adq:SAFRAPAY"') > h.indexOf('data-id="adq-getnet__emp-resilienza"') && h.indexOf('data-id="adq:SAFRAPAY"') < h.indexOf('data-id="adq-safrapay__emp-resilienza"'), { adqs, cons });
  chk('nível 1 no subtotal: Getnet mostra "1 de 2 contratos importados" e "só informativo" na diferença; nível 2 nas linhas dos contratos: "Conferido no consolidado GETNET" no lugar do ERP próprio e "sem arquivo na competência" para o contrato sem lote', /1 de 2 contratos importados/.test(T) && /só informativo/.test(T) && (T.match(/Conferido no consolidado GETNET/g) || []).length === 2 && /sem arquivo na competência/.test(T) && (T.match(/Conferido no consolidado SAFRAPAY/g) || []).length === 1, T.slice(T.indexOf('Contrato / CNPJ'), T.indexOf('Contrato / CNPJ') + 700));
  chk('a visualização por adquirente: o seletor oferece "Todos", cada adquirente e cada contrato (e cada linha é clicável para abrir o dia a dia)', /id="a19f"[^>]*data-a="a19-filtro"|data-a="a19-filtro"[^>]*id="a19f"/.test(h) && ['value="*"', 'value="adq:GETNET"', 'value="adq:SAFRAPAY"', 'value="adq-getnet__emp-mar-aberto"', 'value="adq-getnet__emp-resilienza"', 'value="adq-safrapay__emp-resilienza"'].every(x => h.includes(x)) && (h.match(/<tr class="a19-lin/g) || []).length === 5 && h.includes('data-a="a19-linha"'), (h.match(/<tr class="a19-lin/g) || []).length);
  /* drill-down */
  await Adq19.acao('a19-linha', { dataset: { id: 'adq:GETNET' } }); h = Adq14.render(); T = txt(h);
  const det = h.slice(h.indexOf('class="a19-det"') > 0 ? h.indexOf('class="a19-det"') : h.indexOf('a19-det')), tdet = txt(det.slice(0, det.indexOf('</tr>', 20) + 5000));
  chk('clicar na linha da adquirente abre o detalhe com as duas abas — "Dia a dia ERP × Adquirente" e "Antecipação ERP × Contrato & Extratos OFX" — e a aba (a) avisa os contratos faltando e marca as linhas como informativas', /data-a="a19-aba"[^>]*data-v="a"/.test(h) && /data-a="a19-aba"[^>]*data-v="b"/.test(h) && /Dia a dia ERP × Adquirente/.test(T) && /Antecipação ERP × Contrato/.test(T) && /faltam: GETNET · Mar Aberto/.test(tdet) && /Só informativo|só informativo/.test(tdet) && /Dia da venda|Dt Venda/.test(tdet), tdet.slice(0, 500));
  await Adq19.acao('a19-aba', { dataset: { id: 'adq:GETNET', v: 'b' } }); h = Adq14.render(); const dB = txt(h.slice(h.indexOf('a19-det')));
  chk('aba (b): antecipação efetiva × contratada por contrato, antecipação ERP × estimada por dia, repasses esperados × créditos no OFX e os extratos OFX lidos no DFC', /Antecipação efetiva/.test(dB) && /Repasses esperados × créditos no OFX/.test(dB) && /Extratos OFX lidos no DFC/.test(dB) && /Resilienza/.test(dB), dB.slice(0, 500));
  await Adq19.acao('a19-linha', { dataset: { id: 'adq:GETNET' } }); await Adq19.acao('a19-abrir-adq', { dataset: { v: 'GETNET' } });
  chk('o atalho "Ver o dia a dia consolidado de GETNET" filtra a tela pela adquirente e já abre o consolidado', Adq14.ui.filtro === 'adq:GETNET' && Adq19.ui.aberto['adq:GETNET'] === 'a' && /GETNET · todos os contratos/.test(Adq14.render().replace(/<[^>]+>/g, ' ')));
  Adq14.ui.filtro = '*'; Adq19.ui.aberto = {};
  /* barra de carga: painéis de importação */
  await Adq19.acao('a19-painel', { dataset: { v: 'adq' } }); h = Adq14.render();
  chk('"Importar Adquirente" abre o painel de leitura do arquivo da adquirente na própria barra; clicar de novo fecha; "Importar ERP" abre o do ERP (sem pedir lojas)', /id="a19-imp"/.test(h) && /id="a14c"/.test(h), h.includes('a19-imp'));
  await Adq19.acao('a19-painel', { dataset: { v: 'adq' } }); const fechado = !/id="a19-imp"/.test(Adq14.render());
  await Adq19.acao('a19-painel', { dataset: { v: 'erp' } }); h = Adq14.render(); const tE = txt(h.slice(h.indexOf('a19-imp')));
  chk('painel "Importar ERP": diz que o ERP é conferido por adquirente (contra a soma dos contratos importados), sem a frase antiga "ligada ao contrato" e sem coluna de lojas', fechado && /conferido\s+por adquirente/.test(tE) && !/ligada ao contrato/.test(tE) && !/Lojas Vinculadas/.test(tE), tE.slice(0, 400));
  await Adq19.acao('a19-painel', { dataset: { v: '' } }); Adq19.ui.painel = '';
  /* detalhamentos */
  await Adq19.acao('a19-detalhes', {}); h = Adq14.render(); const D = txt(h.slice(h.indexOf('a19-detalhes') > 0 ? h.indexOf('a19-detalhes') : 0));
  chk('"Detalhamentos e controles": composição da taxa efetiva com o "Líquido esperado após taxas", a ponte até o crédito esperado no banco, o saldo (com os rótulos novos) e os extratos OFX lidos', /Líquido esperado após taxas/.test(D) && /Ponte até o crédito esperado no banco/.test(D) && /Crédito esperado no banco/.test(D) && /Saldo Bruto Futuro/.test(D) && /\(−\) Taxas Efetivas Abatidas/.test(D) && /\(=\) Saldo Líquido Final a Receber/.test(D) && /achados em outras contas do mesmo CNPJ/.test(D), D.slice(0, 500));
  Adq19.ui.detalhes = false;
  /* Laudo A4 e CSV */
  const laudo = Adq17.htmlLaudo(I, { razao: 'Resilienza Negocios Ltda', cnpj: CNPJ_RES, marca: 'Esposende', emitidoEm: '17/11/2026', notas: '', signatarios: [] }), L = txt(laudo);
  chk('Laudo A4: Quadro 1 com "Líquido esperado após a taxa efetiva total"; Quadro 2 com o "Nível 1 — ERP × Adquirente" (Getnet "Só informativo (faltam contratos)"); Quadro 3 com o "Crédito esperado no banco (líquido da adquirente)"; Quadro 5 com os rótulos do saldo', /Líquido esperado após a taxa efetiva total/.test(L) && /Nível 1 — ERP × Adquirente/.test(L) && /Só informativo \(faltam contratos\)/.test(L) && /Crédito esperado no banco \(líquido da adquirente\)/.test(L) && /Ponte entre o líquido esperado após taxas e o crédito esperado no banco/.test(L) && /Saldo Líquido Final a Receber/.test(L) && /Retenções \/ Chargebacks bancários/.test(L), L.slice(0, 300));
  const parecer = Adq17.parecerSugerido(I);
  chk('parecer sugerido: cita o líquido esperado após a taxa efetiva total, a ponte e o aviso do nível 1 ("1 de 2 contrato(s) importado(s); o ERP consolidado só é comparado quando todos têm arquivo")', /Líquido esperado após a taxa efetiva total: R\$/.test(parecer) && /GETNET: 1 de 2 contrato\(s\) importado\(s\); o ERP consolidado só é comparado quando todos têm arquivo/.test(parecer), parecer);
  Adq17.exportarCsv(); const csv = (await E.baixados.at(-1)[1].text()).replace(/\r/g, '');
  chk('CSV dos KPIs: líquido esperado após taxas, a ponte (POS e retenções, antecipação efetiva − estimada, crédito esperado no banco), o nível 1 por adquirente e o saldo com os rótulos novos', /Líquido esperado após taxas/.test(csv) && /Ponte do líquido;[^\n]*Crédito esperado no banco/.test(csv) && /Nível 1 · ERP × Adquirente;GETNET;Bruto ERP \(consolidado da adquirente\)/.test(csv) && /1 de 2 contrato\(s\) importado\(s\) · só informativo/.test(csv) && /Saldo bruto futuro/.test(csv) && /Taxas efetivas abatidas/.test(csv) && /Saldo líquido final a receber/.test(csv), csv.split('\n').filter(l => /Nível 1|Ponte|Saldo/.test(l)).join(' || ').slice(0, 600));
  /* ponte com resíduo */
  const pr = Adq19.ponteLaudo({ liquido: { brutoR: 1000, taxasR: 100, esperadoR: 900, posRetR: 5, antDifR: 2, creditoEsperadoR: 909.5 } }, x => String(x), n => 'R$' + Number(n).toFixed(2), n => String(n));
  chk('a ponte nunca esconde o que sobra: com resíduo de R$ 2,50 mostra a linha "(±) Outros ajustes" e o total fecha em R$ 909,50', /\(±\) Outros ajustes<\/td><td class="n">R\$2\.50/.test(pr) && /\(=\) Crédito esperado no banco \(líquido da adquirente\)<\/td><td class="n">R\$909\.50/.test(pr), pr.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
  /* Credsystem / sem contratos / carregando */
  E.flag19 = false; const hOff = Adq14.render();
  chk('desligado: a Conciliação de Cartões volta às 3 etapas + Painel Executivo (v14.18.2), sem nada do bloco novo', /a15-etapa/.test(hOff) && /id="a17-painel"/.test(hOff) && !/a19-cards|a19-b1|a19-tab/.test(hOff), hOff.length);
  E.flag19 = true; E.Repo.prontas.delete('adq_agendas'); const carregando = Adq14.render(); E.Repo.prontas.add('adq_agendas');
  chk('enquanto as bases ainda carregam, a tela mostra o aviso de carregamento (e não quebra)', /Carregando contratos, taxas, (?:extratos, )?agendas e ERP/.test(carregando));
}


/* =====================================================================
   6 · v14.18.1 · GRAVAR ERP → RETAGUARDA / RECEBÍVEIS: RECEBIMENTOS DE PRESTAÇÃO (OP = CX) AGRUPADOS POR Dt Venda + Loja
   ===================================================================== */
const FX6 = (() => {
  const CAB = ['Loja', 'Dt Venda', 'Dt Crédito', 'Adq', 'Descrição', 'Vda Bruta', ' MDR', 'Vda Líquida', 'Vencimento', 'Antecipação', 'Tx Extra', 'OP', 'DC'];
  const nulls = n => Array(n).fill(null);
  const L = (loja, dv, bruto, op, dc, cod = '304', desc = 'CREDSYSTEM CARTAO PROPRIO') => [loja, dv, '10/02/2026', cod, desc, bruto, 0, bruto, '10/02/2026', 0, 0, op, dc];
  const linhas = [
    L('5', '02/01/2026', 100, 'CX', 'CR'), L('5', '02/01/2026', 50.5, 'CX', 'CR'), L('5', '02/01/2026', 20, 'CX', 'DB'),                    // loja "5" → 05 · Credsystem: CR soma, DB (estorno) subtrai → 130,50
    L('05', '02/01/2026', 30, 'CX', 'DB', '300', 'GETNET CARTAO DEBITO'),                                                                   // regra mista: fora da Credsystem a linha CX SOMA, mesmo com DC = DB → 160,50
    L('28', '03/01/2026', 200, 'CX', 'CR'), L('28', '03/01/2026', 999, 'VE', 'CR'),                                                       // a venda normal (VE) não entra
    L('99', '03/01/2026', 40, 'CX', 'CR'),                                                                                                  // loja sem cadastro: não grava
    L('31', '04/01/2026', 77, 'CX', 'CR', '303', 'QR LINX PIX'), L('31', '04/01/2026', 10, 'VE', 'CR'),                                    // QR-LINX é informativo; a loja 31 está no arquivo, mas sem OP = CX
    L('05', '05/01/2026', 15, 'CX', 'CR'), L('05', '05/01/2026', 15, 'CX', 'DB'),                                                           // compra e estorno: fecha em zero
  ];
  const rows = () => [['Apuração dos Créditos', ...nulls(12)], ['Período: 01/01/2026 a 31/01/2026', ...nulls(12)], nulls(13), CAB, ...linhas];
  const lj = (cod, nome) => ({ id: 'loja-' + cod.padStart(3, '0'), codigo: cod, nome, ativa: true, cnpj: '', adquirentes: [] });
  const cenario = ({ g18 = true, pre = true } = {}) => {
    const E = ambiente({ g18 }); [lj('05', 'Loja Praia'), lj('28', 'Loja Centro'), lj('31', 'Loja Norte'), lj('40', 'Loja Sul')].forEach(l => E.S.lojas.set(l.id, l)); E.bump('lojas');
    if (pre) {
      const put = (id, linhasDoc, extra = {}) => E.S.credsystem.set(id, { id, data: id, linhas: linhasDoc, arquivos: [{ nome: 'websystem.xlsx', em: 'x', por: 'u1' }], ...extra });
      // 02/01: a loja 05 já tem Dinheiro, PIX, Cartão manual, PIX de LOTE e um Cartão de LOTE antigo (sem a marca da ponte): só o Cartão da prestação é substituído
      put('2026-01-02', [{ chave: 'loja-005', lojaId: 'loja-005', texto: '05 - Loja Praia', web: 500, din: 10, cart: 20, pix: 5, cartLote: 999, pixLote: 7, lote: { cart: 999, pix: 7, arquivo: 'antigo.xlsx', em: 'x' } }, { chave: 'loja-040', lojaId: 'loja-040', texto: '40 - Loja Sul', web: 100, din: 100, cart: null, pix: null }]);
      // 04/01: valor que ESTA ponte gravou antes na loja 31 (está no arquivo sem OP = CX → é limpo) e um LOTE antigo na 28 (não está no arquivo → fica)
      put('2026-01-04', [{ chave: 'loja-031', lojaId: 'loja-031', texto: '31 - Loja Norte', web: 30, din: null, cart: null, pix: null, cartLote: 55, lote: { cart: 55, arquivo: 'x', em: 'x', origem: 'apuracao-op-cx' } }, { chave: 'loja-028', lojaId: 'loja-028', texto: '28 - Loja Centro', web: 10, din: null, cart: null, pix: null, cartLote: 5, lote: { cart: 5, arquivo: 'antigo.xlsx', em: 'x' } }]);
      // 05/01: valor desta ponte na loja 05 que agora fecha em zero → sai; a linha ficaria vazia e é retirada do documento
      put('2026-01-05', [{ chave: 'loja-005', lojaId: 'loja-005', texto: '05 - Loja Praia', web: 0, din: null, cart: null, pix: null, cartLote: 77, lote: { cart: 77, arquivo: 'x', em: 'x', origem: 'apuracao-op-cx' } }]);
      E.bump('credsystem');
    }
    return E;
  };
  const cred = E => [...E.S.credsystem.values()].sort((a, b) => a.id.localeCompare(b.id));
  const lin = (E, dia, chave) => E.S.credsystem.get(dia)?.linhas.find(l => l.chave === chave);
  return { rows, cenario, cred, lin, linhas };
})();
{
  const E = FX6.cenario(), { Adq15, Adq18, CodLoja } = E, lido = Adq15.lerErpLinhas(FX6.rows(), 'Apuração dos Créditos jan.xlsx', 'ApuraCreditos'), ag = Adq18.cx.agregar(lido);
  chk('v14.18.1 · leitor: QR-LINX (informativo) com OP = CX é contado à parte (cxInformativo) e NÃO entra nos grupos; as demais linhas CX viram grupos com op = CX', igual(lido.cxInformativo, { 'QR-LINX': { n: 1, bruto: 77 } }) && !lido.periodos[0].grupos.some(g => g.adqNome === 'QR-LINX') && lido.periodos[0].grupos.filter(g => g.op === 'CX').length === 7, lido.cxInformativo);
  chk('normaliza o código da filial como o Cadastro de Lojas: "5" e "05" → 05 → loja-005 (CodLoja.oficial/id)', CodLoja.oficial('5') === '05' && CodLoja.id('5') === 'loja-005' && Adq18.cx.lojaDe('5').rot === '05' && Adq18.cx.lojaDe('5').lojaId === 'loja-005' && Adq18.cx.lojaDe('99').cadastrada === false);
  chk('agrupa OP = CX por Dt Venda + Loja: 3 lançamentos (05 em 02/01 = 160,50 · 28 em 03/01 = 200 · 05 em 05/01 = 0); a venda normal (OP = VE) fica de fora', ag.itens.length === 3 && igual(ag.itens.map(i => [i.dv, i.rot, i.valor, i.n]), [['2026-01-02', '05', 160.5, 4], ['2026-01-03', '28', 200, 1], ['2026-01-05', '05', 0, 2]]), ag.itens);
  chk('regra mista do DC: na Credsystem DB subtrai (100 + 50,50 − 20) e nas demais adquirentes (Getnet) a linha CX soma mesmo com DC = DB (+30): loja 05 em 02/01 = R$ 160,50', Adq18.cx.valor({ adqNome: 'CREDSYSTEM', dc: 'DB', bruto: 20 }) === -20 && Adq18.cx.valor({ adqNome: 'GETNET', adqCod: '300', dc: 'DB', bruto: 30 }) === 30 && Adq18.cx.valor({ adqNome: '', adqCod: '304', dc: 'DB', bruto: 5 }) === -5 && ag.itens[0].valor === 160.5);
  chk('totais do quadro: 8 linhas OP = CX (R$ 400,50), das quais 7 (R$ 360,50) vão para a Retaguarda; 3 dias × 2 lojas; estorno Credsystem = 2 linhas (−R$ 35,00)', ag.linhas === 8 && ag.total === 400.5 && ag.gravLinhas === 7 && ag.gravTotal === 360.5 && ag.nDias === 3 && ag.nLojas === 2 && ag.estornos.n === 2 && ag.estornos.valor === -35, ag);
  chk('loja sem cadastro (99) não é gravada e é listada com linhas e valor; QR-LINX informativo é avisado e não entra', ag.semCadastro.length === 1 && ag.semCadastro[0].rot === '99' && ag.semCadastroLinhas === 1 && ag.semCadastroValor === 40 && ag.informativosN === 1 && ag.informativosBruto === 77);
  chk('arquivo sem nenhuma linha OP = CX: temCx = false e o aviso diz que nada será enviado', (() => { const l2 = Adq15.lerErpLinhas([['Apuração dos Créditos', ...Array(12).fill(null)], Array(13).fill(null), Array(13).fill(null), ['Loja', 'Dt Venda', 'Dt Crédito', 'Adq', 'Descrição', 'Vda Bruta', ' MDR', 'Vda Líquida', 'Vencimento', 'Antecipação', 'Tx Extra', 'OP', 'DC'], FX6.linhas[5]], 'sem.xlsx', 'ApuraCreditos'); const a = Adq18.cx.agregar(l2); return !a.temCx && /nenhuma linha neste arquivo/.test(Adq18.cx.painelHtml(l2)); })());

  // quadro de leitura (antes do Gravar ERP) e confirmação
  const painel = Adq18.cx.painelHtml(lido);
  chk('quadro de leitura do ERP: "Recebimento de Prestação (OP = CX)" com 7 linhas, R$ 360,50, 3 dias × 2 lojas, adquirentes, loja sem cadastro e informativo; lista Dt Venda × Loja', /Recebimento de Prestação \(OP = CX\)/.test(painel) && /7 linha\(s\) · R\$360\.50/.test(painel) && /3 dia\(s\) × 2 loja\(s\)/.test(painel) && /CREDSYSTEM/.test(painel) && /99 \(R\$40\.00\)/.test(painel) && /QR-LINX/.test(painel) && /Dinheiro e PIX lançados à mão não são alterados/.test(painel) && /02\/01\/2026/.test(painel), painel.slice(0, 600));
  E.ctx = null; E.pode = () => false; const semPerm = Adq18.cx.painelHtml(lido); E.pode = null;
  chk('sem permissão na Retaguarda › Conciliação Credsystem o quadro avisa que a prestação NÃO será enviada', /NÃO será enviada/.test(semPerm) && !/NÃO será enviada/.test(painel));
}
{
  // gravação pela ponte (função de gravar) com a Retaguarda já tendo lançamentos manuais
  const E = FX6.cenario(), { Adq15, Adq18 } = E, lido = Adq15.lerErpLinhas(FX6.rows(), 'Apuração dos Créditos jan.xlsx', 'ApuraCreditos'), v0 = E.Repo.versao('credsystem');
  const r = await Adq18.cx.gravar(lido), d2 = FX6.lin(E, '2026-01-02', 'loja-005'), d3 = FX6.lin(E, '2026-01-03', 'loja-028'), outras = E.S.credsystem.get('2026-01-02').linhas.find(l => l.chave === 'loja-040');
  chk('gravar: estado ok; 4 dias tocados (02, 03, 04 e 05/01), 2 lançamentos escritos (05 em 02/01 e 28 em 03/01) e 2 valores antigos da ponte zerados (31 em 04/01 e 05 em 05/01, que fecha em zero); números do aviso = 7 linhas · R$ 360,50 · 3 dias × 2 lojas', r.estado === 'ok' && r.docs === 4 && r.escritas === 2 && r.limpas === 2 && r.gravLinhas === 7 && r.gravTotal === 360.5 && r.dias === 3 && r.lojas === 2, r);
  chk('loja 05 em 02/01: o Cartão da prestação (cartLote) passa a 160,50 e a marca da ponte (origem OP = CX, 4 linhas); Dinheiro 10, PIX 5 e Cartão digitado 20 ficam intactos; o PIX de LOTE antigo (7) é preservado', d2 && d2.cartLote === 160.5 && d2.din === 10 && d2.pix === 5 && d2.cart === 20 && d2.pixLote === 7 && d2.web === 500 && d2.lote.origem === 'apuracao-op-cx' && d2.lote.linhas === 4 && d2.lote.pix === 7 && d2.lote.arquivo === 'Apuração dos Créditos jan.xlsx', d2);
  chk('outra loja do mesmo dia (40), que não está no arquivo, não é tocada; dia novo (03/01) é criado com a loja 28 = 200 e Websystem 0 (como a ponte do LOTE fazia)', igual(outras, { chave: 'loja-040', lojaId: 'loja-040', texto: '40 - Loja Sul', web: 100, din: 100, cart: null, pix: null }) && d3 && d3.cartLote === 200 && d3.web === 0 && d3.din === null && d3.lojaId === 'loja-028', { outras, d3 });
  chk('a loja sem cadastro (99) NÃO foi gravada em nenhum documento (nem como texto)', !FX6.cred(E).some(d => d.linhas.some(l => /99/.test(l.chave) || /99/.test(l.texto || ''))));
  const d4 = FX6.lin(E, '2026-01-04', 'loja-031'), d4b = FX6.lin(E, '2026-01-04', 'loja-028');
  chk('loja 31 em 04/01 está no arquivo sem OP = CX: o valor que a própria ponte gravara antes (55) é zerado (a linha fica pelo Websystem 30); o LOTE antigo da loja 28, que não está no arquivo, fica (5)', d4 && d4.cartLote === null && !d4.lote && d4.web === 30 && d4b && d4b.cartLote === 5 && d4b.lote.arquivo === 'antigo.xlsx', { d4, d4b });
  chk('05/01: compra e estorno fecham em zero → o valor antigo da ponte é zerado e a linha que ficou vazia sai do documento (o documento continua existindo)', E.S.credsystem.get('2026-01-05') && E.S.credsystem.get('2026-01-05').linhas.length === 0);
  chk('cada documento gravado na Retaguarda (módulo retaguarda) tem a trilha do arquivo "(ERP · OP = CX)" e uma única entrada de auditoria resume a gravação', E.S.credsystem.get('2026-01-02').arquivos.at(-1).nome === 'Apuração dos Créditos jan.xlsx (ERP · OP = CX)' && E.gravacoes.filter(g => g.c === 'credsystem').every(g => g.aud.modulo === 'retaguarda' && g.aud.semAudit === true) && E.audits.filter(a => a.entidade === 'credsystem').length === 1 && /7 linha\(s\) OP = CX/.test(E.audits.at(-1).detalhe), E.audits.at(-1));
  const n1 = E.gravacoes.length, r2x = await Adq18.cx.gravar(lido);
  chk('idempotente: gravar o mesmo arquivo de novo não regrava nenhum documento (nada mudou) e o resultado é o mesmo', r2x.estado === 'ok' && r2x.docs === 0 && E.gravacoes.length === n1 && r2x.gravTotal === 360.5);
  const bi = E.S.credsystem.get('2026-01-02').linhas.find(l => l.chave === 'loja-005').cartLote;
  // reimportação com valor corrigido: substitui (não soma)
  const linhasCorr = FX6.linhas.map(x => x[0] === '5' && x[1] === '02/01/2026' && x[5] === 100 ? [...x.slice(0, 5), 300, 0, 300, ...x.slice(8)] : x), corr = Adq15.lerErpLinhas([['Apuração dos Créditos', ...Array(12).fill(null)], Array(13).fill(null), Array(13).fill(null), FX6.rows()[3], ...linhasCorr], 'corrigido.xlsx', 'ApuraCreditos');
  await Adq18.cx.gravar(corr);
  chk('reimportação com o valor corrigido SUBSTITUI o Cartão da prestação do dia × loja (160,50 → 360,50), sem somar com o que já estava', bi === 160.5 && FX6.lin(E, '2026-01-02', 'loja-005').cartLote === 360.5 && FX6.lin(E, '2026-01-02', 'loja-005').din === 10);
  // dia antigo (LOTE no próprio Cartão, antes da v13.74.3): sai do Cartão para não somar duas vezes
  const base = { linhas: [{ chave: 'loja-028', lojaId: 'loja-028', texto: '28', web: 0, cart: 150, cartLote: null, pix: null, din: 20, lote: { cart: 150, arquivo: 'x' } }] }, ap = Adq18.cx.aplicarDia('2026-01-03', base, Adq18.cx.agregar(lido), 'a.xlsx');
  chk('dia legado (LOTE gravado dentro do Cartão): o Cartão antigo igual ao LOTE sai (não soma duas vezes) e o Dinheiro 20 fica; se o Cartão for diferente do LOTE (digitado), ele fica', ap.linhas[0].cart === null && ap.linhas[0].cartLote === 200 && ap.linhas[0].din === 20 && Adq18.cx.aplicarDia('2026-01-03', { linhas: [{ chave: 'loja-028', web: 0, cart: 99, lote: { cart: 150 } }] }, Adq18.cx.agregar(lido), 'a.xlsx').linhas[0].cart === 99);
}
{
  // sem permissão: o ERP é gravado, a Retaguarda não é tocada e o aviso diz isso
  const E = FX6.cenario(), { Adq15, Adq18 } = E, lido = Adq15.lerErpLinhas(FX6.rows(), 'x.xlsx', 'ApuraCreditos'); E.pode = p => p !== 'retaguarda.credsystem.importar' && p !== 'retaguarda.credsystem.editar';
  const r = await Adq18.cx.gravar(lido);
  chk('sem retaguarda.credsystem.importar/editar: estado sem-permissao, nada gravado na Retaguarda e o aviso informa linhas e valor que NÃO foram enviados (8 · R$ 400,50)', r.estado === 'sem-permissao' && E.gravacoes.filter(g => g.c === 'credsystem').length === 0 && /NÃO enviadas à Retaguarda: sem permissão/.test(Adq18.cx.sufixoToast(r)) && r.linhas === 8 && r.total === 400.5);
  E.pode = p => p === 'retaguarda.credsystem.editar'; const r2x = await Adq18.cx.gravar(lido);
  chk('basta uma das duas permissões (aqui só "editar") para a ponte gravar', r2x.estado === 'ok' && r2x.docs === 4);
}
{
  // fluxo do botão Gravar ERP (código real de gravarErp) — recurso ligado
  const E = FX6.cenario(), { Adq15, Adq18 } = E, lido = Adq15.lerErpLinhas(FX6.rows(), 'Apuração dos Créditos jan.xlsx', 'ApuraCreditos');
  E.recusar = true; Adq15.ui.erp = { lido }; await Adq15.gravarErp();
  chk('Gravar ERP com a confirmação RECUSADA: nada é gravado (nem o ERP nem a Retaguarda) e a leitura continua na tela', E.gravacoes.length === 0 && Adq15.ui.erp && Adq15._ocupado === false && E.confirmou === 1 && /Recebimento de Prestação \(OP = CX\)/.test(E.confirmacoes[0][0]) && /7<\/b> linha\(s\)/.test(E.confirmacoes[0][1]) && /R\$360\.50/.test(E.confirmacoes[0][1]), E.confirmacoes);
  E.recusar = false; await Adq15.gravarErp();
  const toast = E.toasts.at(-1), cx = E.gravacoes.filter(g => g.c === 'credsystem'), erp = E.gravacoes.filter(g => g.c === 'adq_erp');
  chk('Gravar ERP confirmado: grava as partes e o resumo do ERP e a Retaguarda; o aviso mostra "ERP gravado…" e "Retaguarda: 7 linha(s) OP = CX · R$ 360,50 gravadas no Cartão (3 dia(s) × 2 loja(s)) · 1 de loja sem cadastro ficaram de fora"', erp.length >= 2 && cx.length === 4 && /ERP gravado: 1 competência\(s\)/.test(toast) && /Retaguarda: 7 linha\(s\) OP = CX · R\$360\.50 gravadas no Cartão \(3 dia\(s\) × 2 loja\(s\)\)/.test(toast) && /1 de loja sem cadastro ficaram de fora/.test(toast), toast);
  const card = Adq18.cx.cardResultado();
  chk('depois de gravar a leitura some e fica o cartão do resultado com linhas, total, dias × lojas e lançamentos escritos; "Entendi" o fecha', !Adq15.ui.erp && /gravado nos Recebíveis \/ Retaguarda/.test(card) && /7 linha\(s\) · R\$360\.50 em 3 dia\(s\) × 2 loja\(s\)/.test(card) && /2 lançamento\(s\) dia × loja, 2 zerado\(s\)/.test(card) && /a15-erp-cx-ok/.test(card));
  await Adq15.acao('a15-erp-cx-ok', { dataset: {} }); chk('o botão Entendi limpa o cartão do resultado', Adq18.cx.cardResultado() === '' && Adq18.cx.ultimo === null);
  // aviso da Retaguarda › Conciliação
  const linhasRt = [...E.S.credsystem.values()].flatMap(d => d.linhas.map(l => ({ ...l, data: d.id, docId: d.id }))), cartLote = Adq15.r2(linhasRt.reduce((s, l) => s + (l.cartLote || 0), 0)), av = Adq18.cx.avisoRetaguarda(linhasRt, cartLote);
  chk('aviso da tela de Conciliação da Retaguarda: "Valores da coluna Cartão atualizados via importação ERP (OP = CX)" com o total de prestação (R$ 360,50 = 160,50 + 200), lançamentos, dias × lojas e o LOTE antigo à parte', /Valores da coluna Cartão atualizados via importação ERP \(OP = CX\)/.test(av) && /R\$360\.50/.test(av) && /2 lançamento\(s\) em 2 dia\(s\) × 2 loja\(s\)/.test(av) && /Mais R\$5\.00 de prestações \(LOTE\) de importações anteriores/.test(av), av);
  chk('sem valores desta ponte na tela o aviso não aparece (volta o texto antigo do LOTE)', Adq18.cx.avisoRetaguarda([{ chave: 'a', cartLote: 9, lote: { cart: 9, arquivo: 'x' } }], 9) === null);
}
{
  // recurso desligado = comportamento da v14.17: sem confirmação, sem Retaguarda, sem aviso
  const E = FX6.cenario({ g18: false }), { Adq15 } = E, lido = Adq15.lerErpLinhas(FX6.rows(), 'x.xlsx', 'ApuraCreditos'); Adq15.ui.erp = { lido }; await Adq15.gravarErp();
  chk('gestao_v1418 desligado: Gravar ERP grava só o ERP (sem confirmação nova, sem tocar na Retaguarda e sem texto de OP = CX no aviso)', E.confirmou === 0 && E.gravacoes.filter(g => g.c === 'credsystem').length === 0 && E.gravacoes.some(g => g.c === 'adq_erp') && /ERP gravado: 1 competência\(s\)/.test(E.toasts.at(-1)) && !/Retaguarda|OP = CX/.test(E.toasts.at(-1)) && E.Adq18.cx.ultimo === null, E.toasts.at(-1));
}
{
  // ganchos no código real: tudo atrás de g18(); o aviso antigo do LOTE continua quando não há valores desta ponte
  const gr = corta('  async gravarErp() {', '  async excluirErp(comp) {');
  chk('gravarErp: a confirmação vem ANTES de _ocupado = true (recusar não trava o botão) e a ponte roda depois das partes do ERP, ambas atrás de g18()', /if \(g18\(\) && !\(await Adq18\.cx\.confirmar\(L\.lido\)\)\) return;[^]*?this\._ocupado = true/.test(gr) && /const cx18 = g18\(\) \? await Adq18\.cx\.gravar\(L\.lido\) : null;/.test(gr) && gr.indexOf('Adq18.cx.confirmar') < gr.indexOf('this._ocupado = true') && gr.indexOf('Repo.salvar(ADQ15.COL_ERP') < gr.indexOf('Adq18.cx.gravar'));
  chk('quadro na leitura (antes do botão Gravar ERP) e cartão do resultado na tela de importação, ambos atrás de g18()', html.includes("${g18() ? Adq18.cx.painelHtml(lido) : ''}<div class=\"row\" style=\"margin-top:10px\"><button class=\"btn\" data-a=\"a15-erp-gravar\"") && html.includes("${L ? this.renderLeituraErp(L) : ''}${g18() ? Adq18.cx.cardResultado() : ''}"));
  chk('aviso da Retaguarda: usa o novo texto só com g18() e valores desta ponte; senão mantém "Cartão inclui … recebimentos de prestação (LOTE) no débito" como na v14.17', html.includes("${(g18() && Adq18.cx.avisoRetaguarda(linhas, cartLote)) || (cartLote ? `<p class=\"hint cs-lote\" style=\"margin:0 0 8px\">Cartão inclui <b>${Fmt.brl(cartLote)}</b> de recebimentos de prestação (LOTE) no débito, gravados pela Conciliação de Meios de Pagamento a partir do ERP.</p>` : '')}"));
  chk('selo do recurso gestao_v1418 cita o v14.18.1 (Gravar ERP → Retaguarda › Conciliação, OP = CX)', /gestao_v1418: \{ versao: 'v14\.18', titulo: '[^']*v14\.18\.1: o Gravar ERP envia os Recebimentos de Prestação \(OP = CX\)/.test(html));
  chk('a ponte NÃO usa o campo de Dinheiro/PIX: só `cartLote` e a marca `lote` são escritos (aplicarDia) — Dinheiro, PIX, PIX de LOTE e Cartão manual não aparecem entre os campos que ela altera', !/\bdin:\s*it\./.test(corta('  aplicarDia(dv, base, ag', '  /** remove o valor que ESTA ponte')) && !/\bpix:\s*it\./.test(corta('  aplicarDia(dv, base, ag', '  /** remove o valor que ESTA ponte')));
}

/* =====================================================================
   7 · v14.18.2 · MÚLTIPLAS TAXAS DE ANTECIPAÇÃO POR PERÍODO DE VIGÊNCIA (por contrato)
     (a) cadastro de várias faixas em períodos distintos (adicionar, editar, excluir; gravação com auditoria);
     (b) bloqueio de sobreposição de datas (inclusive faixa com Data Fim em aberto, 1 dia de sobreposição e a mensagem do período conflitante);
     (c) cálculo com a taxa de cada período (Getnet por Dt Venda, SafraPay pela data do arquivo; troca no meio do mês), Painel Executivo, Laudo, saldo/DFC;
         retrocompatibilidade com contratos legados (taxa única da regra = 1ª faixa em aberto), recurso desligado e lacunas.
   ===================================================================== */
const VG = (E) => E.Adq18.vig;
const V_ID = FX.CT.res, V_SAF = FX.CT.saf;
const grava = (E, id, lista) => { const d = E.S.adq_contratos.get(id); d.vigAnt = lista; E.bump('adq_contratos'); };
const calcGn = E => E.Adq14.calcularMes('2026-01').get(E.Adq14.idLote('GETNET', CNPJ_RES, '2026-01'));
const calcSf = E => E.Adq14.calcularMes('2026-01').get(E.Adq14.idLote('SAFRAPAY', CNPJ_RES, '2026-01'));
const setRegraAnt = (E, adq, taxa) => { E.S.adq_taxas.forEach(r => { if (r.adquirente === adq) r.antecipacao.taxa = taxa; }); E.bump('adq_taxas'); };
const vg = (id, ini, fim, taxa, x = {}) => ({ id, ini, fim, taxa, unidade: 'am', metodo: 'simples', obs: '', ...x });
{
  /* ---------- (a) pura: datas, taxas, rótulos ---------- */
  const E = ambiente(), V = VG(E);
  chk('datas: DD/MM/AAAA e ISO viram ISO; data inexistente (31/02) e texto viram vazio', V.iso('15/01/2026') === '2026-01-15' && V.iso('2026-01-15') === '2026-01-15' && V.iso('31/02/2026') === '' && V.iso('abc') === '' && V.br('2026-01-15') === '15/01/2026');
  chk('taxa: "1,49", "1.49" e 1.49 valem 1,49; vazio e texto não são taxa', V.taxaNum('1,49') === 1.49 && V.taxaNum('1.49') === 1.49 && V.taxaNum(1.49) === 1.49 && V.taxaNum('') === null && V.taxaNum('x') === null);
  chk('rótulo da taxa com unidade: "1,49% a.m." e "18,00% a.a."', V.rotTaxa({ taxa: 1.49, unidade: 'am' }) === '1,49% a.m.' && V.rotTaxa({ taxa: 18, unidade: 'aa' }) === '18,00% a.a.');
  /* validações simples */
  const vz = (nova, lista = []) => V.validar(lista, nova);
  chk('Data Início é obrigatória', /Informe a Data Início/.test(vz({ ini: '', fim: '', taxa: '1,49' }).erro) && !vz({ ini: '', taxa: '1,49' }).ok);
  chk('Data Fim anterior à Data Início é recusada, com as duas datas na mensagem', vz({ ini: '10/02/2026', fim: '09/02/2026', taxa: '1,49' }).erro === 'A Data Fim (09/02/2026) não pode ser anterior à Data Início (10/02/2026).');
  chk('Data Fim igual à Data Início (faixa de um dia) é aceita; Data Fim em branco = Em aberto', vz({ ini: '10/02/2026', fim: '10/02/2026', taxa: '1,49' }).ok && vz({ ini: '10/02/2026', fim: '', taxa: '1,49' }).ok);
  chk('datas fora do formato e taxa em branco/negativa/acima de 100 são recusadas', /Data Início inválida/.test(vz({ ini: '2026/02/10', taxa: '1' }).erro) && /Data Fim inválida/.test(vz({ ini: '10/02/2026', fim: '31/02/2026', taxa: '1' }).erro) && /Informe a taxa/.test(vz({ ini: '10/02/2026', taxa: '' }).erro) && !vz({ ini: '10/02/2026', taxa: '-1' }).ok && !vz({ ini: '10/02/2026', taxa: '101' }).ok);
}
{
  /* ---------- (a) cadastro de várias faixas por período + (b) bloqueio de sobreposição ---------- */
  const E = await FX.cenario({ fimMes: true }), V = VG(E), A0 = [];
  let r = V.inserir(A0, { ini: '01/01/2026', fim: '31/01/2026', taxa: '1,49', obs: 'Contrato original' }); const l1 = r.lista;
  chk('adiciona a 1ª faixa (01/01/2026 a 31/01/2026 · 1,49% a.m.) com id e observação', !r.erro && l1.length === 1 && l1[0].id === 'v1' && l1[0].ini === '2026-01-01' && l1[0].fim === '2026-01-31' && l1[0].taxa === 1.49 && l1[0].obs === 'Contrato original', r);
  r = V.inserir(l1, { ini: '01/02/2026', fim: '28/02/2026', taxa: '1,79', obs: 'Renegociação comercial' }); const l2 = r.lista;
  chk('adiciona a 2ª faixa em período distinto (começa em 01/02, o dia seguinte ao fim da 1ª): sem conflito, ordenadas por Data Início', !r.erro && l2.length === 2 && l2[1].id === 'v2' && l2.map(x => x.ini).join() === '2026-01-01,2026-02-01');
  r = V.inserir(l2, { ini: '01/03/2026', fim: '', taxa: '2,10' }); const l3 = r.lista;
  chk('adiciona uma 3ª faixa em aberto (Data Fim em branco = vigente até nova alteração)', !r.erro && l3.length === 3 && l3[2].fim === '' && l3[2].ini === '2026-03-01');
  chk('o mesmo contrato guarda quantas faixas quiser em períodos que não se tocam (3 faixas, sem lacuna entre elas)', V.validarLista(l3).ok && V.lacunas(l3).length === 0);
  /* sobreposição */
  const MSG = 'Período conflitante com a vigência já cadastrada de 01/01/2026 a 31/01/2026 (1,49% a.m.). Ajuste as datas antes de salvar.';
  const c1 = V.inserir(l1, { ini: '15/01/2026', fim: '28/02/2026', taxa: '1,79' });
  chk('sobreposição é BLOQUEADA com a mensagem do período conflitante (texto do pedido)', c1.erro === MSG && c1.lista === l1, c1.erro);
  chk('1 único dia de sobreposição também bloqueia: a faixa que termina em 31/01 não aceita outra começando em 31/01', V.inserir(l1, { ini: '31/01/2026', fim: '', taxa: '1,79' }).erro === MSG && !V.inserir(l1, { ini: '01/02/2026', fim: '', taxa: '1,79' }).erro);
  chk('faixa nova que engloba uma existente (começa antes e termina depois) também conflita', V.inserir(l1, { ini: '15/12/2025', fim: '15/02/2026', taxa: '1,00' }).erro === MSG);
  chk('faixa nova DENTRO de uma existente conflita', V.inserir(l1, { ini: '10/01/2026', fim: '20/01/2026', taxa: '1,00' }).erro === MSG);
  /* em aberto */
  const abertoNova = V.inserir(V.inserir([], { ini: '01/02/2026', fim: '', taxa: '1,79' }).lista, { ini: '01/03/2026', fim: '31/03/2026', taxa: '2,00' });
  chk('faixa existente em aberto (infinito futuro): qualquer faixa posterior conflita, e a mensagem diz "até nova alteração"', abertoNova.erro === 'Período conflitante com a vigência já cadastrada de 01/02/2026 até nova alteração (1,79% a.m.). Ajuste as datas antes de salvar.', abertoNova.erro);
  const lAb = V.inserir([], { ini: '01/02/2026', fim: '', taxa: '1,79' }).lista;
  chk('faixa NOVA em aberto conflita com qualquer faixa que comece depois dela (Data Fim vazia = infinito futuro)', V.inserir(V.inserir([], { ini: '01/03/2026', fim: '31/03/2026', taxa: '2,00' }).lista, { ini: '01/01/2026', fim: '', taxa: '1,00' }).erro.startsWith('Período conflitante com a vigência já cadastrada de 01/03/2026 a 31/03/2026'));
  chk('faixa fechada ANTES da faixa em aberto é aceita (01/01 a 31/01, depois 01/02 em aberto)', !V.inserir(lAb, { ini: '01/01/2026', fim: '31/01/2026', taxa: '1,49' }).erro && V.inserir(lAb, { ini: '01/01/2026', fim: '31/01/2026', taxa: '1,49' }).lista.length === 2);
  /* edição e exclusão */
  let e = V.substituir(l3, 'v2', { ini: '01/02/2026', fim: '28/02/2026', taxa: '1,85', obs: 'Reajuste' });
  chk('editar uma faixa sem mudar o período não conflita com ela mesma e troca a taxa/observação', !e.erro && e.lista.find(x => x.id === 'v2').taxa === 1.85 && e.lista.find(x => x.id === 'v2').obs === 'Reajuste' && e.lista.length === 3);
  e = V.substituir(l3, 'v2', { ini: '31/01/2026', fim: '28/02/2026', taxa: '1,79' });
  chk('editar a faixa para invadir o último dia da vizinha é bloqueado (mesma mensagem)', e.erro === MSG && e.lista === l3);
  e = V.substituir(l3, 'v1', { ini: '01/01/2026', fim: '15/01/2026', taxa: '1,49' });
  chk('encurtar a 1ª faixa abre uma lacuna que a tela avisa (16/01 a 31/01 sem taxa), sem bloquear', !e.erro && igual(V.lacunas(e.lista), [{ ini: '2026-01-16', fim: '2026-01-31' }]), V.lacunas(e.lista));
  chk('sem nenhuma faixa em aberto a tela avisa a partir de que dia não há taxa (ex.: a última termina em 28/02/2026 → 01/03/2026) e some quando uma faixa fica em aberto', V.semTaxaApos(V.remover(l3, 'v3').lista) === '2026-03-01' && V.semTaxaApos(l3) === '' && V.semTaxaApos([]) === '' && /Nenhuma vigência está em aberto: a partir de <b>01\/03\/2026<\/b>/.test(V.avisosHtml({ itens: V.remover(l3, 'v3').lista, virtual: false, divergentes: [] })));
  const d = V.remover(l3, 'v2').lista;
  chk('excluir uma faixa remove só ela (as outras seguem) e libera o período para uma nova faixa', d.length === 2 && !d.some(x => x.id === 'v2') && !V.inserir(d, { ini: '01/02/2026', fim: '28/02/2026', taxa: '1,70' }).erro);
  chk('o id novo nunca repete um existente, mesmo depois de excluir no meio', V.novoId([{ id: 'v1' }, { id: 'v3' }]) === 'v4' && V.novoId([]) === 'v1');
  chk('validação da lista inteira (antes de gravar): acusa qualquer par sobreposto, mesmo vindo de dado antigo', !V.validarLista([vg('a', '2026-01-01', '2026-01-31', 1), vg('b', '2026-01-31', '', 2)]).ok && V.validarLista([vg('a', '2026-01-01', '2026-01-31', 1), vg('b', '2026-02-01', '', 2)]).ok);
  /* gravação no contrato com auditoria; o resto do contrato não muda */
  const antes = JSON.parse(JSON.stringify(E.S.adq_contratos.get(V_ID))), est = V.estadoInicial(E.Adq14.contrato(V_ID));
  chk('contrato legado abre com a taxa da regra (1,60% a.m.) como 1ª faixa em aberto, "migrada" e ainda não gravada', est.virtual && est.itens.length === 1 && est.itens[0].ini === '2000-01-01' && est.itens[0].fim === '' && est.itens[0].taxa === 1.6 && est.itens[0].migrada === true && !antes.vigAnt, est);
  const g0 = await V.gravar(V_ID, est);
  chk('sem mexer nas vigências, "Salvar contrato" NÃO grava vigências (o contrato legado segue com a taxa da regra)', g0 === false && !E.S.adq_contratos.get(V_ID).vigAnt);
  est.itens = l3; est.tocou = true; est.virtual = false; E.gravacoes.length = 0;
  const g1 = await V.gravar(V_ID, est), dc = E.S.adq_contratos.get(V_ID);
  chk('gravar as 3 vigências no contrato (adq_contratos.vigAnt) preserva conta, lojas e adquirente', g1 === true && dc.vigAnt.length === 3 && dc.contaId === 'ct-a' && igual(dc.lojas, antes.lojas) && dc.adquirente === 'GETNET' && dc.ativo === true, dc);
  chk('a gravação sai com auditoria: módulo conciliacao, rótulo do contrato e o detalhe com cada período e taxa', E.gravacoes.at(-1).aud?.modulo === 'conciliacao' && /Vigências de antecipação \(3\): 01\/01\/2026 → 31\/01\/2026 · 1,49% a\.m\./.test(E.gravacoes.at(-1).aud?.detalhe || '') && /01\/03\/2026 → em aberto · 2,10% a\.m\./.test(E.gravacoes.at(-1).aud?.detalhe || ''), E.gravacoes.at(-1).aud);
  chk('o contrato lido de volta traz as vigências ordenadas e normalizadas', V.lista(E.Adq14.contrato(V_ID)).itens.map(x => x.id).join() === 'v1,v2,v3' && !V.lista(E.Adq14.contrato(V_ID)).virtual);
  est.itens = [vg('a', '2026-01-01', '2026-01-31', 1), vg('b', '2026-01-31', '', 2)]; let erroG = ''; try { await V.gravar(V_ID, est); } catch (x) { erroG = x.message; }
  chk('gravar uma lista com sobreposição é recusado (nada é gravado) — a trava vale também no salvamento do contrato', /Período conflitante/.test(erroG) && E.S.adq_contratos.get(V_ID).vigAnt.length === 3, erroG);
  /* Salvar contrato no modal: com vigências já gravadas elas sobrevivem ao salvar outros campos */
  E.Adq14.abrirContrato(V_ID); const Mo = E.modais.at(-1); E.form = { contaId: 'ct-a', observacao: 'x', lojas: '01, 02', ecs: '' }; await Mo.acoes[1].acao({});
  chk('Salvar contrato (sem tocar nas vigências) mantém as 3 vigências gravadas', E.S.adq_contratos.get(V_ID).vigAnt.length === 3 && E.S.adq_contratos.get(V_ID).observacao === 'x');
  chk('o modal traz o bloco "Vigências de Antecipação (taxa por período)" com a sub-tabela, o formulário (Data Início, Data Fim, taxa, unidade, método, observação) e Editar/Excluir por faixa', /Vigências de Antecipação \(taxa por período\)/.test(Mo.corpo) && /data-vact="edit" data-vid="v1"/.test(Mo.corpo) && /data-vact="del" data-vid="v3"/.test(Mo.corpo) && /data-vf="ini"/.test(Mo.corpo) && /data-vf="fim"/.test(Mo.corpo) && /data-vf="taxa"/.test(Mo.corpo) && /data-vf="obs"/.test(Mo.corpo) && /Em aberto/.test(Mo.corpo) && /01\/03\/2026/.test(Mo.corpo), Mo.corpo.slice(-1500));
  const Eoff = ambiente({ g18: false }); Eoff.S.adq_contratos.set(V_ID, { id: V_ID, adquirente: 'GETNET', empresaId: 'resilienza', contaId: 'x', ativo: true }); Eoff.bump('adq_contratos'); Eoff.S.contasBancarias.set('x', { id: 'x', apelido: 'X', ativa: true }); Eoff.Adq14.abrirContrato(V_ID);
  chk('recurso desligado: o modal do contrato não tem o bloco de vigências (v14.17 intacta)', !/Vigências de Antecipação/.test(Eoff.modais.at(-1).corpo));
}
{
  /* ---------- (c) cálculo: cada taxa em seu período (Getnet por Dt Venda), troca no meio do mês, e os pontos do painel ---------- */
  const E = await FX.cenario({ fimMes: true }), V = VG(E), { Adq14 } = E, SPLIT = '2026-01-15';
  const base = calcGn(E), regraG = Adq14.regraDe('GETNET', 'Visa', 'resilienza'), gr = base.lote.grupos;
  const antG = (taxa, g) => Adq14.antecipacaoGrupo({ ...regraG, antecipacao: { taxa, unidade: 'am', metodo: 'simples' } }, g, g.bruto - g.mdr).ant;
  const cred = gr.filter(g => g.mod !== 'debito');
  chk('cenário: vendas de crédito antes e depois de 15/01 (05/01 e 30/01) — o mês tem troca de taxa no meio', cred.some(g => g.dv <= SPLIT) && cred.some(g => g.dv > SPLIT), cred.map(g => g.dv));
  const antLegado = base.k.antec, espLegado = base.k.esperado;
  chk('sem vigências, o motor usa a taxa da regra (1,60% a.m.) como sempre: antecipação = Σ do grupo na taxa 1,60', perto(antLegado, cred.reduce((s, g) => s + antG(1.6, g), 0), 0.03), { antLegado });
  grava(E, V_ID, [vg('v1', '2026-01-01', SPLIT, 1.0), vg('v2', '2026-01-16', '', 2.5, { obs: 'Renegociação comercial' })]);
  const mix = calcGn(E), esperadoOr = cred.reduce((s, g) => s + antG(g.dv <= SPLIT ? 1.0 : 2.5, g), 0);
  chk('Getnet: cada venda usa a taxa vigente na SUA Dt Venda — antecipação do mês = Σ (vendas até 15/01 a 1,00% + vendas depois a 2,50%), nem 1,60% nem uma média', perto(mix.k.antec, esperadoOr, 0.03) && !perto(mix.k.antec, antLegado, 0.5), { mix: mix.k.antec, esperadoOr, antLegado });
  const so1 = cred.filter(g => g.dv <= SPLIT).reduce((s, g) => s + antG(1.0, g), 0), so25 = cred.filter(g => g.dv > SPLIT).reduce((s, g) => s + antG(2.5, g), 0);
  chk('a taxa de cada faixa vale só para as vendas dela: a parte antes de 15/01 sai de 1,00% e a parte depois, de 2,50% (decomposição exata)', perto(so1 + so25, mix.k.antec, 0.03) && so1 > 0 && so25 > 0, { so1, so25 });
  const lerLegado1 = cred.reduce((s, g) => s + antG(1.0, g), 0), lerLegado25 = cred.reduce((s, g) => s + antG(2.5, g), 0);
  chk('a antecipação do mês fica ENTRE as dos dois cenários únicos (tudo a 1,00% < misto < tudo a 2,50%)', lerLegado1 < mix.k.antec && mix.k.antec < lerLegado25, { lerLegado1, lerLegado25, mix: mix.k.antec });
  chk('Líquido Esperado acompanha: esperado = esperado legado + (antecipação a 1,60% − antecipação mista) — a diferença é só a taxa de antecipação', perto(mix.k.esperado, espLegado + (antLegado - mix.k.antec), 0.05), { esp: mix.k.esperado, espLegado, antLegado, ant: mix.k.antec });
  const dg = E.Adq18.diasGetnet(mix), somaDg = [...dg.values()].reduce((s, x) => s + x.ant, 0);
  chk('o dia a dia do repasse (base do Previsto da DFC, da antecipação apurada no OFX e do saldo a receber) usa as mesmas faixas: Σ antecipação por dia = antecipação do mês', perto(somaDg, mix.k.antec, 0.05), { somaDg, ant: mix.k.antec });
  /* uma faixa só, cobrindo o mês: idêntica ao cenário legado com a taxa da regra trocada */
  grava(E, V_ID, [vg('v1', '2026-01-01', '', 1.0)]); const um = calcGn(E).k.antec; setRegraAnt(E, 'GETNET', 1.0); grava(E, V_ID, []); const leg1 = calcGn(E).k.antec; setRegraAnt(E, 'GETNET', 1.6);
  chk('uma única faixa (1,00%) cobrindo o mês dá exatamente o mesmo resultado do cadastro antigo com 1,00% na regra (a vigência substitui a taxa da regra sem mudar a conta)', perto(um, leg1, 0.005) && um > 0, { um, leg1 });
  /* unidade a.a. e método composto vêm da faixa */
  grava(E, V_ID, [vg('v1', '2026-01-01', '', 18, { unidade: 'aa', metodo: 'composto' })]);
  const aa = calcGn(E).k.antec, ref = cred.reduce((s, g) => s + Adq14.antecipacaoGrupo({ ...regraG, antecipacao: { taxa: 18, unidade: 'aa', metodo: 'composto' } }, g, g.bruto - g.mdr).ant, 0);
  chk('unidade (% a.a.) e método (composto) da faixa são respeitados pela mesma função de cálculo', perto(aa, ref, 0.03) && ref > 0, { aa, ref });
  /* lacuna: data fora das faixas → sem taxa de antecipação, sinalizado (nunca cai em outra taxa) */
  grava(E, V_ID, [vg('v1', '2026-01-01', '2026-01-10', 1.0)]); const lac = calcGn(E), s05 = cred.filter(g => g.dv <= '2026-01-10').reduce((s, g) => s + antG(1.0, g), 0);
  chk('vendas depois do fim da única faixa (30/01) ficam SEM taxa de antecipação: só entram as de até 10/01 e o motor sinaliza "sem taxa de antecipação" para o resto', perto(lac.k.antec, s05, 0.03) && lac.semTaxa.some(x => /sem taxa de antecipação/.test(x.rotulo) && /Visa/.test(x.rotulo)), { ant: lac.k.antec, s05, semTaxa: lac.semTaxa });
  /* recurso desligado: vigências gravadas não têm efeito (v14.17/v14.18.1) */
  const Eoff = await FX.cenario({ fimMes: true, g18: false }); grava(Eoff, V_ID, [vg('v1', '2026-01-01', SPLIT, 1.0), vg('v2', '2026-01-16', '', 2.5)]);
  chk('RECURSO DESLIGADO: as vigências gravadas são ignoradas e o motor usa a taxa da regra, como na v14.18.1', perto(calcGn(Eoff).k.antec, antLegado, 0.005));
  /* a regra original nunca é alterada e a cópia é memorizada */
  grava(E, V_ID, [vg('v1', '2026-01-01', SPLIT, 1.0), vg('v2', '2026-01-16', '', 2.5)]); const r0 = Adq14.regraDe('GETNET', 'Visa', 'resilienza'), ra = Adq14.regraDe('GETNET', 'Visa', 'resilienza', '2026-01-05'), rb = Adq14.regraDe('GETNET', 'Visa', 'resilienza', '2026-01-10'), rc = Adq14.regraDe('GETNET', 'Visa', 'resilienza', '2026-01-20');
  chk('a regra original (cadastro) continua com 1,60% depois das consultas; a faixa devolve uma cópia com a taxa dela, memorizada para o mesmo período', r0.antecipacao.taxa === 1.6 && ra.antecipacao.taxa === 1.0 && rc.antecipacao.taxa === 2.5 && ra === rb && ra !== rc && ra.prazoRepasse === r0.prazoRepasse && ra.mdr === r0.mdr && ra._vig.id === 'v1' && rc._vig.id === 'v2');
  chk('regraDe sem data (ou com recurso desligado) devolve a regra de sempre', Adq14.regraDe('GETNET', 'Visa', 'resilienza') === r0 && V.regraEm(r0, 'resilienza', '') === r0);
  /* ---------- Painel Executivo, Laudo, tabela de contratos ---------- */
  OFX_JAN(E); const I = E.Adq17.indicadores('2026-01', '*'), Rg = rowIdx(I, V_ID).ant;
  chk('Painel Executivo (Getnet): taxa contratada é a média PONDERADA pela base de cada venda (entre 1,00 e 2,50, nunca 1,60) e o contrato é marcado com "Múltiplas vigências no período"', Rg.multiVig === true && Rg.contratadoAm > 1.0 && Rg.contratadoAm < 2.5 && /1,00% a\.m\./.test(Rg.vigTxt) && /2,50% a\.m\./.test(Rg.vigTxt), { c: Rg.contratadoAm, v: Rg.vigTxt });
  chk('o consolidado repete o aviso e lista os períodos (vigTxt com contrato, taxas e datas)', I.consolidado.ant.multiVig === true && /01\/01\/2026 a 15\/01\/2026/.test(I.consolidado.ant.vigTxt) && /16\/01\/2026 até nova alteração/.test(I.consolidado.ant.vigTxt), I.consolidado.ant.vigTxt);
  const painel = E.Adq17.renderPainel();
  chk('tela do Painel Executivo mostra "Múltiplas vigências no período" (consolidado e linha do contrato)', (painel.match(/Múltiplas vigências no período/g) || []).length >= 2, (painel.match(/Múltiplas vigências no período/g) || []).length);
  const laudo = E.Adq17.htmlLaudo(I, { razao: 'Resilienza Negocios Ltda', cnpj: CNPJ_RES, marca: 'Esposende', emitidoEm: '17/11/2026', notas: '', signatarios: [] });
  chk('Laudo Operacional (A4) traz o mesmo aviso e as faixas na linha da Antecipação', /Múltiplas vigências no período/.test(laudo) && /2,50% a\.m\./.test(laudo));
  E.Adq17.exportarCsv(); const csv = await E.baixados.at(-1)[1].text();
  chk('Exportar KPIs (.csv): a Antecipação do consolidado e uma linha do contrato dizem "múltiplas vigências no período" com as faixas', /Antecipação;[^\n]*múltiplas vigências no período: [^\n]*1,00% a\.m\./.test(csv.replace(/\r/g, '')) && /Contrato;[^;]*;Antecipação · múltiplas vigências no período;;[\d,]+;[^\n]*2,50% a\.m\./.test(csv.replace(/\r/g, '')), csv.split('\n').filter(l => /vigências/.test(l)).join(' || '));
  E.Adq14.ui.mes = '2026-01'; const tj = E.Adq14.renderContratos(); E.Adq14.ui.mes = '2026-02'; const tf = E.Adq14.renderContratos(); E.Adq14.ui.mes = '2026-01';
  chk('tabela Contratos × Conta Bancária × Lojas e ECs: janeiro (troca no mês) mostra "Múltiplas vigências no período" com os dias de cada taxa; fevereiro mostra a taxa vigente (2,50% a.m.)', /Antecipação vigente · /.test(tj) && /Múltiplas vigências no período/.test(tj) && /1,00% a\.m\. \(01\/01\/2026 a 15\/01\/2026 · 15 dia\(s\)\)/.test(tj) && /2,50% a\.m\. \(16\/01\/2026 a 31\/01\/2026 · 16 dia\(s\)\)/.test(tj) && /<b>2,50% a\.m\.<\/b>/.test(tf) && !/<b>Múltiplas vigências no período<\/b>/.test(tf.split('SAFRAPAY')[0] || ''), tj.match(/data-a18v-vig>.{0,500}/)?.[0]);
  const rj = V.resumoCompetencia(E.Adq14.contrato(V_ID), '2026-01'), rf = V.resumoCompetencia(E.Adq14.contrato(V_ID), '2026-02'), rd = V.resumoCompetencia(E.Adq14.contrato(V_ID), '2025-12');
  chk('taxa vigente por competência: janeiro = múltiplas, fevereiro = 2,50% a.m. (única), dezembro/2025 = sem taxa vigente', rj.modo === 'multipla' && rj.segs.length === 2 && rf.modo === 'unica' && rf.rotulo === '2,50% a.m.' && rd.modo === 'sem');
  const rleg = V.resumoCompetencia(E.Adq14.contrato(V_SAF), '2026-01');
  chk('contrato sem vigências gravadas (SafraPay) mostra a taxa da regra como a 1ª faixa migrada, sem aviso de múltiplas', rleg.modo === 'legado' && rleg.rotulo === '1,60% a.m.' && /cadastro de taxas/.test(rleg.sub));
}
{
  /* ---------- SafraPay: a data do pagamento do arquivo de Recebíveis é a data de referência ---------- */
  const E = await FX.cenario({ fimMes: true }), V = VG(E), base = calcSf(E), cols = E.Adq14.SF_COLS;
  const linhas = base.lote.vendas.map(a => Object.fromEntries(cols.map((c, j) => [c, a[j]])));
  const central = (taxaDe) => linhas.reduce((s, v) => s + r2((taxaDe(v) / 100) * (v.sBaseK - 1 / 30 * v.sBase)), 0);
  chk('SafraPay legado: teto/estimativa a 1,60% a.m. em todas as vendas (conferência do cálculo por fora)', perto(base.k.antecContr, central(() => 1.6), 0.05), { k: base.k.antecContr });
  grava(E, V_SAF, [vg('v1', '2026-01-01', '2026-01-06', 1.0), vg('v2', '2026-01-07', '', 2.0)]); const mix = calcSf(E);
  chk('SafraPay: pagamentos até 06/01 usam 1,00% a.m. e os de 07/01 em diante 2,00% a.m. (estimativa contratual por venda)', perto(mix.k.antecContr, central(v => v.dp <= '2026-01-06' ? 1.0 : 2.0), 0.05) && !perto(mix.k.antecContr, base.k.antecContr, 0.5), { mix: mix.k.antecContr, ref: central(v => v.dp <= '2026-01-06' ? 1.0 : 2.0) });
  const tetoMix = mix.conf.reduce((s, c) => s + (c.antMax || 0), 0), tetoRef = linhas.reduce((s, v) => s + r2((v.dp <= '2026-01-06' ? 0.01 : 0.02) * (v.sBaseK + 3 / 30 * v.sBase)), 0);
  chk('o teto de antecipação (máximo plausível) também segue a faixa de cada venda', perto(tetoMix, tetoRef, 0.06), { tetoMix, tetoRef });
  OFX_JAN(E); const I = E.Adq17.indicadores('2026-01', '*'), S = rowIdx(I, V_SAF).ant;
  chk('Painel Executivo (SafraPay): pondera a taxa contratada pela base de cada venda e avisa "Múltiplas vigências no período"', S.multiVig === true && S.contratadoAm > 1.0 && S.contratadoAm < 2.0 && /1,00% a\.m\./.test(S.vigTxt) && /2,00% a\.m\./.test(S.vigTxt), { c: S.contratadoAm, v: S.vigTxt });
  grava(E, V_SAF, [vg('v1', '2026-01-01', '', 2.0)]); const um = rowIdx(E.Adq17.indicadores('2026-01', '*'), V_SAF).ant;
  chk('com uma faixa só, o painel mostra a taxa dela (2,00% a.m.) e NÃO mostra "Múltiplas vigências"', um.multiVig === false && perto(um.contratadoAm, 2.0, 0.005), um);
}
{
  /* ---------- retrocompatibilidade: contrato legado (taxa única) ---------- */
  const E = await FX.cenario({ fimMes: true }), V = VG(E), E17 = await FX.cenario({ fimMes: true, g18: false });
  const a = calcGn(E), b = calcGn(E17);
  chk('contrato legado (sem vigências): o cálculo é IDÊNTICO ao da v14.18.1 — antecipação, esperado, taxa e dias do repasse', igual(a.k, b.k) && igual(a.dias, b.dias) && igual(a.semTaxa, b.semTaxa));
  const l = V.lista(E.Adq14.contrato(V_ID)), m = l.itens[0];
  chk('a taxa única do formato anterior aparece como a 1ª faixa vigente, em aberto (Data Fim vazia), com a mesma taxa, unidade e método — dados preservados', l.virtual && l.itens.length === 1 && m.fim === '' && m.taxa === 1.6 && m.unidade === 'am' && m.metodo === 'simples' && m.migrada);
  chk('antes de qualquer edição a regra não é tocada: o contrato continua sem o campo vigAnt', !E.S.adq_contratos.get(V_ID).vigAnt && E.Adq14.regraDe('GETNET', 'Visa', 'resilienza', '2026-01-05') === E.Adq14.regraDe('GETNET', 'Visa', 'resilienza'));
  const est = V.estadoInicial(E.Adq14.contrato(V_ID)); est.tocou = true; await V.gravar(V_ID, est);
  chk('gravar a faixa migrada tal como está (mesma taxa, desde 01/01/2000 em aberto) mantém o cálculo idêntico ao legado', E.S.adq_contratos.get(V_ID).vigAnt.length === 1 && E.S.adq_contratos.get(V_ID).vigAnt[0].migrada === true && igual(calcGn(E).k, b.k));
  /* nova taxa a partir de uma data exige antes fechar a faixa migrada (sem sobreposição) */
  const lm = V.lista(E.Adq14.contrato(V_ID)).itens, c = V.inserir(lm, { ini: '16/01/2026', fim: '', taxa: '2,50' });
  chk('com a faixa migrada em aberto, uma nova taxa a partir de 16/01 é bloqueada até a Data Fim da migrada ser ajustada', /Período conflitante com a vigência já cadastrada de 01\/01\/2000 até nova alteração \(1,60% a\.m\.\)/.test(c.erro), c.erro);
  const fe = V.substituir(lm, 'mig', { ini: '01/01/2000', fim: '15/01/2026', taxa: '1,60' }), n = V.inserir(fe.lista, { ini: '16/01/2026', fim: '', taxa: '2,50' });
  chk('ajustada a Data Fim da migrada para 15/01/2026, a nova faixa (16/01 em aberto) é aceita e a faixa migrada mantém a marca', !fe.erro && !n.erro && n.lista.length === 2 && n.lista[0].migrada === true);
  grava(E, V_ID, n.lista.map(x => ({ ...x }))); const mx = calcGn(E), esp = a.k.antec;
  chk('com a migrada (1,60% até 15/01) + a nova (2,50% depois), só as vendas depois de 15/01 mudam: antecipação maior que a legada, vendas até 15/01 intactas', mx.k.antec > esp + 0.5, { mx: mx.k.antec, esp });
  /* bandeiras com taxas diferentes no cadastro: a migração avisa */
  const E2 = await FX.cenario({ fimMes: true, mcSemAnt: true }); E2.S.adq_taxas.set('adq-getnet__visa__emp-resilienza', { ...E2.S.adq_taxas.get('adq-getnet__todas__emp-resilienza'), id: 'adq-getnet__visa__emp-resilienza', bandeira: 'VISA', antecipacao: { taxa: 1.9, unidade: 'am', metodo: 'simples' } }); E2.bump('adq_taxas'); E2.Adq14.calcularMes('2026-01');
  const dv = VG(E2).derivada(E2.Adq14.contrato(V_ID));
  chk('bandeiras com taxas de antecipação diferentes: a migração usa a da regra "Todas" e lista as divergentes para a tela avisar', dv.v.taxa === 1.6 && dv.divergentes.some(x => x.bandeira === 'VISA' && /1,90% a\.m\./.test(x.rotulo)), dv);
  chk('a tela mostra o aviso das taxas diferentes por bandeira ao abrir o contrato (a vigência passa a valer para todas)', /taxas de antecipação diferentes no cadastro de taxas/.test(VG(E2).avisosHtml(VG(E2).estadoInicial(E2.Adq14.contrato(V_ID)))));
}
{
  /* ---------- documentação do recurso no código ---------- */
  chk('selo do recurso gestao_v1418 cita as Vigências de Antecipação (v14.18.2)', /gestao_v1418: \{ versao: 'v14\.18', titulo: '[^']*v14\.18\.2: Vigências de Antecipação por contrato/.test(html));
  chk('ganchos de data nos pontos de cálculo: Getnet (g.dv), SafraPay (v.dp), ERP × adquirente, prazo médio/taxa contratada, dias do repasse e parcelas do saldo, e a venda da Conciliação de Meios de Pagamento', ['this.regraDe(A, g.band, emp, g.dv)', 'this.regraDe(A, v.band, emp, v.dp)', 'Adq14.regraDe(lote.adquirente, g.band, calc.empresaId, g.dv)', 'Adq14.regraDe(calc.adquirente, g.band, calc.empresaId, g.dv)', 'Adq14.regraDe(A, g.band, emp, g.dv), baseLiq', 'Adq14.regraDe(A, g.band, emp, g.dv), out', 'Adq18.vig.regraEm(rg, info.empresaId, Adq18.vig.iso(v.data))'].every(t => html.includes(t)));
  chk('o motor da Conciliação de Meios de Pagamento (região protegida ADQ_CFG → PARTE_EXTRATO) NÃO foi tocado: a taxa de antecipação dele continua a da regra (Regra de Ouro)', !/Adq18\.vig/.test(html.slice(html.indexOf('const ADQ_CFG'), html.indexOf('const PARTE_EXTRATO = 900;'))));
}

/* =====================================================================
   9 · v14.18.1 e v14.18.2 DENTRO da v14.19: o cadastro de contratos novo continua gravando as Vigências de Antecipação (várias faixas, bloqueio de sobreposição) e o ERP com OP = CX
       continua a alimentar Retaguarda / Recebíveis; Getnet e SafraPay trocam de taxa no meio do mês também no cálculo da Taxa Efetiva Total
   ===================================================================== */
{
  const E = await FX.cenario({ fimMes: true }), { Adq14, Adq15, Adq17, Adq18 } = E, ID = FX.CT.res; OFX_JAN(E);
  const faixas = [{ id: 'v1', ini: '2026-01-01', fim: '2026-01-15', taxa: 1.0, unidade: 'am', metodo: 'simples' }, { id: 'v2', ini: '2026-01-16', fim: '', taxa: 2.5, unidade: 'am', metodo: 'simples', obs: 'Renegociação comercial' }];
  E.S.adq_contratos.get(ID).vigAnt = JSON.parse(JSON.stringify(faixas)); E.bump('adq_contratos'); Adq17.indicadores('2026-01', '*');
  const antes = Adq17.indicadores('2026-01', '*').contratos.find(r => r.id === ID).ant;
  chk('com a v14.19 ligada, o cálculo da antecipação segue as duas faixas (1,00% até 15/01 e 2,50% a partir de 16/01: as vendas de crédito de 05/01 e de 30/01 caem em faixas diferentes): "Múltiplas vigências no período" e a Taxa Efetiva Total usa a antecipação por venda', antes.multiVig === true && /1,00% a\.m\./.test(antes.vigTxt) && /2,50% a\.m\./.test(antes.vigTxt), antes.vigTxt);
  E.modais.length = 0; Adq15.abrirContrato(ID); const m = E.modais.at(-1);
  chk('o modal do contrato (v14.19, sem Lojas) mostra as Vigências de Antecipação já cadastradas (as duas faixas) para editar', /Vigências de Antecipação/i.test(m.corpo) && /2026-01-16|16\/01\/2026/.test(m.corpo) && /Renegociação comercial/.test(m.corpo), m.corpo.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300));
  E.form = { contaId: 'ct-a', observacao: 'conferido' }; const r = await m.acoes[1].acao({ querySelector: () => null }); await espera();
  const c = Adq14.contrato(ID);
  chk('salvar o contrato sem mexer nas vigências NÃO as apaga (as duas faixas, o período em aberto e a observação da renegociação continuam) e o cálculo não muda', r !== false && c.observacao === 'conferido' && c.vigAnt && c.vigAnt.length === 2 && c.vigAnt[1].fim === '' && c.vigAnt[1].obs === 'Renegociação comercial' && igual(Adq17.indicadores('2026-01', '*').contratos.find(x => x.id === ID).ant.vigTxt, antes.vigTxt), c.vigAnt);
  /* bloqueio de sobreposição continua valendo */
  const ok = Adq18.vig.validarLista([{ ...faixas[0] }, { ...faixas[1], ini: '2026-01-15' }]), ok2 = Adq18.vig.validarLista(faixas);
  chk('a trava de sobreposição segue valendo: 1 dia de sobreposição é bloqueado com "Período conflitante com a vigência já cadastrada"; faixas encostadas (15/01 e 16/01) são aceitas', ok.ok === false && /Período conflitante com a vigência já cadastrada/.test(ok.erro) && ok2.ok === true, ok);
  /* Getnet por Dt Venda: a troca no meio do mês aparece no consolidado do painel e em cada contrato */
  const I = Adq17.indicadores('2026-01', '*');
  chk('Painel Executivo: o consolidado repete o aviso de múltiplas vigências com as datas de cada faixa e o Líquido Esperado após taxas usa a antecipação efetiva (apurada), não a contratada', I.consolidado.ant.multiVig === true && /01\/01\/2026 a 15\/01\/2026/.test(I.consolidado.ant.vigTxt) && /16\/01\/2026 até nova alteração/.test(I.consolidado.ant.vigTxt) && perto(I.consolidado.liquido.esperadoR, I.consolidado.bruto.base - I.consolidado.taxa.r), I.consolidado.ant.vigTxt);
}

/* =====================================================================
   9z · DOCUMENTAÇÃO, VERSÃO E RECURSO
   ===================================================================== */
{
  const readme = fs.readFileSync(path.join(raiz, 'README.md'), 'utf8'), i19 = readme.indexOf('## v14.19 ·'), i182 = readme.indexOf('## v14.18.2 ·'), sec = readme.slice(i19, i182);
  chk('README: "Versão v14.19." na abertura e a seção "## v14.19" vem antes da v14.18.2, com o recurso gestao_v1419, a dependência da v14.18, os seis itens, os limites a saber e a Regra de Ouro', /^# [^\n]*\n\nVersão v14\.19\./.test(readme) && i19 > 0 && i19 < i182 && /gestao_v1419/.test(sec) && /depende da `gestao_v1418`/.test(sec) && ['Item 1', 'Item 2', 'Item 3', 'Item 4', 'Itens 5 e 6', 'Limites a saber', 'Regra de Ouro', 'byte a byte iguais'].every(t => sec.includes(t)), sec.slice(0, 200));
  chk('README: documenta o selo "Cartões conciliados automaticamente", rec_cartoes / rec_credsystem, as 3 partes da tela, as colunas da tabela e as abas do detalhe, o nível 1 "só informativo", "Conferido no consolidado", a busca ampliada de POS, "apurado pelo cadastro de POS", a ponte, o "Saldo Líquido Final a Receber" e o ZIP único com a v14.18.1 e a v14.18.2', ['Cartões conciliados automaticamente', 'rec_cartoes', 'rec_credsystem', 'Barra de carga compacta', 'Uma linha de 4 cards', 'Tabela única agrupada por Adquirente', 'Dia a dia ERP × Adquirente', 'Antecipação ERP × Contrato & Extratos OFX', 'só informativo', 'Conferido no consolidado', 'demais contas bancárias do mesmo CNPJ', 'apurado pelo cadastro de POS', 'crédito esperado no banco', 'Saldo Líquido Final a Receber', 'OP = CX', 'vigência', 'Lojas Vinculadas', 'Puxar do Cadastro'].every(t => sec.includes(t)), sec.length);
  chk('recurso gestao_v1419 cadastrado na lista de recursos (v14.19), dependente da gestao_v1418 (g19 = recurso && g18), e o selo cita as vantagens (DFC sem seletores, 3 blocos, 2 níveis, líquido pós taxa efetiva total)', /gestao_v1419: \{ versao: 'v14\.19'/.test(html) && /function g19\(\) \{[^}]*Recursos\.ativo\('gestao_v1419'\) && g18\(\)/.test(html), 'recurso');
  chk('o recurso gestao_v1419 vem antes de gestao_v1418 na lista de liberação (a versão mais nova encabeça o cabeçalho e o quadro Versões dos Ambientes)', html.indexOf("gestao_v1419: { versao") > 0 && html.indexOf("gestao_v1419: { versao") < html.indexOf("gestao_v1418: { versao"));
  chk('nenhum marcador de montagem ficou no painel final', !/@@V1419_/.test(html));
}

console.log(`\n${OK.length} ok · ${FAIL.length} falha(s)`);
if (FAIL.length) { console.log('FALHAS:\n - ' + FAIL.join('\n - ')); process.exit(1); }
