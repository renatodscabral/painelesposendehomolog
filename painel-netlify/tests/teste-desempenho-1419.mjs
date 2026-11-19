import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* v14.19.1 · DESEMPENHO da Conciliação de Cartões e da DFC (hotfix dentro do recurso gestao_v1419): a tela não trava mais com ERP, adquirentes e OFX grandes.
   Valida o CÓDIGO REAL do painel (public/index.html), em contexto isolado do Node, só com dados FICTÍCIOS (LGPD): CNPJs gerados aqui e valores inventados.
   MASSA GRANDE: 15.000 linhas de ERP (11.610 grupos), 50.000 transações de adquirente (36.000 Getnet em 2 contratos + 14.000 SafraPay) e ~5.100 lançamentos de OFX em 4 contas.
   Blocos:
     0) Regra de Ouro e montagem (herdado da v14.19: regiões protegidas, FCX e Contábil intactos);
     A) 1 · tela sem bloqueio: primeira pintura < 200 ms com o OFX ainda pendente, 4 cards em "calculando", cálculo frio fatiado em etapas, OFX em segundo plano;
     B) 2 · cache por competência + dirty check: render com cache < 50 ms, snapshot idêntico não recalcula, mudança real recalcula, Recalcular invalida, trocar filtro e abrir a DFC leem do cache;
     C) OFX do servidor: sem baixar duas vezes, limite de tempo de 10 s (configurável), erro explícito, nunca fica em "OFX: carregando…";
     D) 3 · consulta enxuta de OFX: o pré-filtro de débitos é SUPERCONJUNTO do critério do motor (resultado idêntico) e os créditos são indexados por conta + data;
     E) 4 · drill-down sob demanda: linha recolhida não monta tabela, 50 linhas e "Ver todas";
     F) equivalência (com × sem a otimização), recurso desligado = v14.18.2 e documentação.
   Uso: node tests/teste-desempenho-1419.mjs */
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
    App: { render() { ctx.renders = (ctx.renders || 0) + 1; }, agendarRender() { ctx.agendados = (ctx.agendados || 0) + 1; } }, Audit: { registrar: a => { ctx.audits.push(a); return Promise.resolve(); } },
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

/* ===================================================================================================================
   MASSA GRANDE (dados FICTÍCIOS) — v14.19.1 · teste de carga
   =================================================================================================================== */
const rnd = (() => { let s = 20261110; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
const pick = a => a[Math.floor(rnd() * a.length)];
const brn = n => n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const brR = n => 'R$ ' + brn(n);
const dd = n => String(n).padStart(2, '0');
const BANDS = ['Visa', 'Mastercard', 'Elo', 'Hipercard', 'Amex'];
const CAB_GN = 'ESTABELECIMENTO COMERCIAL;CPF / CNPJ;RAZÃO SOCIAL;DATA/HORA DA VENDA;BANDEIRA;MODALIDADE;FORMA DE PAGAMENTO;STATUS DA TRANSAÇÃO;PARCELAS;DATA PREVISTA DO 1º PAGAMENTO;NÚMERO DO CARTÃO;NÚMERO DE AUTORIZAÇÃO (AUT);NÚMERO DO COMPROVANTE DE VENDA (NSU);TIPO DE CAPTURA;NÚMERO DO TERMINAL;VALOR BRUTO;VALOR TAXA;VALOR LÍQUIDO;ORIGEM DO CARTÃO;;;;;ID';
const somaDia = (dia, n) => { const d = new Date(Date.UTC(2026, 0, dia + n)); return `${dd(d.getUTCDate())}/${dd(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`; };
function csvGetnetGrande(n, cnpj, razao, ec) {
  const L = [CAB_GN];
  for (let i = 0; i < n; i++) {
    const dia = 1 + Math.floor(rnd() * 30), t = rnd(), band = pick(BANDS); let mod, forma, parc = 1; const bruto = Math.round((20 + rnd() * 480) * 100) / 100;
    if (t < 0.45) { mod = 'Débito'; forma = 'Débito'; } else if (t < 0.75) { mod = 'Crédito'; forma = 'Crédito à Vista'; } else { mod = 'Crédito'; forma = 'Crédito Parcelado Lojista'; parc = 2 + Math.floor(rnd() * 5); }
    const taxa = Math.round(bruto * (mod === 'Débito' ? 0.009 : parc > 1 ? 0.026 : 0.022) * 100) / 100, dp = mod === 'Débito' ? somaDia(dia, 1) : somaDia(dia, 30);
    L.push([ec, fmtCnpj(cnpj), razao, `${dd(dia)}/01/2026 ${dd(8 + Math.floor(rnd() * 12))}:${dd(Math.floor(rnd() * 60))}`, band, mod, forma, 'Aprovada', parc, dp, '439267******0321', String(100000 + i), String(900000 + i), 'Pos', '14092285', brn(bruto), '-' + brn(taxa), brn(bruto - taxa), 'Nacional', '', '', '', '', '-'].join(';'));
  }
  return L.join('\r\n');
}
const nulls13 = Array(13).fill(null);
const topoSafraG = periodo => [[null, 'Banco Safra S/A', 'Emitido em: 17/11/2026 09:56', ...Array(10).fill(null)], [null, 'CNPJ: ' + fmtCnpj(CNPJ_BANCO), periodo, ...Array(10).fill(null)], nulls13, ['Recebiveis de antecipação', ...Array(12).fill(null)], nulls13, nulls13];
const CAB_REC = ['Data do Pagamento', 'Bandeira', 'Número do Cartão', 'Modalidade', 'Número Sequencial Único', 'Número de Autorização', 'Número do Terminal', 'Estabelecimento Comercial', 'Valor da Parcela', 'Taxa de Administração', 'Taxa de Antecipação', 'Valor Recebido', 'Cartão Estrangeiro'];
function recebiveisGrande(n) {
  const L = [];
  for (let i = 0; i < n; i++) {
    const dia = 2 + Math.floor(rnd() * 28), t = rnd(), band = pick(BANDS).toUpperCase(), mod = t < 0.4 ? 'Débito' : t < 0.7 ? 'Crédito à vista' : 'Crédito de 2 a 6 parcelas', v = Math.round((15 + rnd() * 300) * 100) / 100;
    const adm = Math.round(v * (mod === 'Débito' ? 0.009 : 0.022) * 100) / 100, ant = mod === 'Débito' ? 0 : Math.round(v * 0.012 * 100) / 100;
    L.push([`${dd(dia)}/01/2026`, band, '************0804', mod, 5000000 + i, 40 + (i % 900), 10848325, 1454475, brR(v), '- ' + brR(adm), '- ' + brR(ant), brR(v - adm - ant), 'Não']);
  }
  return [...topoSafraG('Período de 01/01/2026 até 31/01/2026'), CAB_REC, ...L, ['Total', ...Array(12).fill(null)], nulls13];
}
const CAB_ERP = ['Loja', 'Dt Venda', 'Dt Crédito', 'Adq', 'Descrição', 'Vda Bruta', ' MDR', 'Vda Líquida', 'Vencimento', 'Antecipação', 'Tx Extra', 'OP', 'DC'];
function erpGrande(n) {
  const L = [];
  for (let i = 0; i < n; i++) {
    const loja = dd(1 + Math.floor(rnd() * 40)), dia = 1 + Math.floor(rnd() * 30), t = rnd(), band = pick(['VISA', 'MASTERCARD', 'ELO', 'HIPERCARD']);
    const [cod, nome] = t < 0.45 ? ['301', 'GETNET'] : t < 0.85 ? ['302', 'SAFRAPAY'] : ['304', 'CREDSYSTEM'], mod = rnd() < 0.4 ? 'DEBITO' : 'CREDITO', bruto = Math.round((20 + rnd() * 480) * 100) / 100;
    const dv = `${dd(dia)}/01/2026`, dcr = somaDia(dia, mod === 'DEBITO' ? 1 : 30);
    L.push([loja, dv, dcr, cod, `${nome} ${band} ${mod}`, bruto, Math.round(bruto * 0.02 * 100) / 100, bruto, dcr, 0, 0, rnd() < 0.05 ? 'CX' : 'VE', mod === 'DEBITO' ? 'DB' : 'CR']);
  }
  return [['Apuração dos Créditos', ...Array(12).fill(null)], ['Período: 01/01/2026 a 31/01/2026', ...Array(12).fill(null)], nulls13, CAB_ERP, ...L];
}
const HIST_RUIDO = ['PIX RECEBIDO', 'PIX ENVIADO FORNECEDOR', 'TED RECEBIDA', 'PAGAMENTO BOLETO', 'DEPOSITO DINHEIRO LOJA', 'TARIFA MANUTENCAO CONTA', 'PAGAMENTO FOLHA', 'COMPRA DEBITO', 'TRANSFERENCIA ENTRE CONTAS', 'PAGTO TRIBUTO'];
function docsOfx(contaId, mes, n, creditosAdq) {
  const docs = [], PARTE = 900; let k = 0, txs = [];
  const dias = mes === '2026-01' ? 31 : 28;
  for (let i = 0; i < n; i++) {
    const dia = 1 + Math.floor(rnd() * dias), v = Math.round((10 + rnd() * 3000) * 100) / 100, neg = rnd() < 0.55;
    txs.push({ id: `${contaId}-${mes}-${i}`, data: `${mes}-${dd(dia)}`, valor: neg ? -v : v, hist: pick(HIST_RUIDO) + ' ' + (i % 97) });
  }
  (creditosAdq || []).forEach((c, j) => txs.push({ id: `${contaId}-${mes}-c${j}`, data: c.data, valor: c.valor, hist: c.hist }));
  for (let i = 0; i < txs.length; i += PARTE) docs.push({ id: `${contaId}:${mes}:p${k++}`, contaId, mes, transacoes: txs.slice(i, i + PARTE) });
  return docs;
}

async function cenarioGrande({ nGetnet = 18000, nSafra = 14000, nErp = 15000, nOfx = 5000, ofxCarregado = true, quiet = false } = {}) {
  const E = ambiente({}), { Adq14, Adq15, S } = E;
  const { regra, mdr, CT } = FX;
  [regra('GETNET', 'resilienza', mdr(0.9, 2.2, 2.6, 3.0), 1.6), regra('GETNET', 'mar-aberto', mdr(0.9, 2.2, 2.6, 3.0), 1.6), regra('SAFRAPAY', 'resilienza', mdr(0.9, 2.2, 2.6, 3.0), 1.6)].forEach(r => S.adq_taxas.set(r.id, r));
  [['ct-a', 'Conta A'], ['ct-b', 'Conta B'], ['ct-c', 'Conta C'], ['ct-d', 'Conta D']].forEach(([id, apelido]) => S.contasBancarias.set(id, { id, apelido, ativa: true, banco: '033', agencia: '0001', conta: id.slice(-1).charCodeAt(0) + '000', titularCnpj: id === 'ct-b' ? CNPJ_MAR : CNPJ_RES }));
  const CTB = 'adq-getnet__emp-mar-aberto';
  S.adq_contratos.set(CT.res, { id: CT.res, adquirente: 'GETNET', empresaId: 'resilienza', contaId: 'ct-a', ativo: true, lojas: ['01', '02'] });
  S.adq_contratos.set(CTB, { id: CTB, adquirente: 'GETNET', empresaId: 'mar-aberto', contaId: 'ct-b', ativo: true, lojas: ['03'] });
  S.adq_contratos.set(CT.saf, { id: CT.saf, adquirente: 'SAFRAPAY', empresaId: 'resilienza', contaId: 'ct-c', ativo: true, lojas: ['05'], ecs: ['1454475'] });
  ['adq_taxas', 'contasBancarias', 'adq_contratos'].forEach(c => E.bump(c));
  const t0 = performance.now(), marca = (n, t) => { if (!quiet) console.log(`   · ${n}: ${(performance.now() - t).toFixed(0)} ms`); };
  const importar = async (contratoId, lido) => { Adq14.ui.contrato = contratoId; Adq14.ui.fixo = ''; Adq14._ler = { contratoId, lido, val: Adq14.validarCnpj(lido, Adq14.contrato(contratoId)) }; await Adq14.gravarLote(); await espera(); };
  let t = performance.now(); const gA = await Adq14.lerGetnetTexto(csvGetnetGrande(nGetnet, CNPJ_RES, 'Resilienza Negocios Ltda', '15105016'), 'res.csv'); marca(`ler Getnet Resilienza (${nGetnet} vendas)`, t);
  t = performance.now(); await importar(CT.res, gA); marca('gravar lote Getnet Resilienza', t);
  t = performance.now(); const gB = await Adq14.lerGetnetTexto(csvGetnetGrande(nGetnet, CNPJ_MAR, 'Mar Aberto Ltda', '15105099'), 'mar.csv'); await importar(CTB, gB); marca(`ler+gravar Getnet Mar Aberto (${nGetnet})`, t);
  t = performance.now(); const sf = Adq15.lerSafraLinhasAuto(recebiveisGrande(nSafra), 'Recebiveis (jan).xlsx'); await importar(CT.saf, sf); marca(`ler+gravar SafraPay (${nSafra})`, t);
  t = performance.now(); const lidoErp = Adq15.lerErpLinhas(erpGrande(nErp), 'Apuração dos Créditos jan.xlsx', 'ApuraCreditos'); Adq15.ui.erp = { lido: lidoErp }; await Adq15.gravarErp(); marca(`ler+gravar ERP (${nErp} linhas)`, t);
  // OFX: ruído + créditos de adquirente por dia
  const cr = (adq, n) => Array.from({ length: n }, (_, i) => ({ data: `2026-01-${dd(2 + (i % 28))}`, valor: Math.round((800 + rnd() * 6000) * 100) / 100, hist: `CREDITO ${adq} LIQUIDACAO` }));
  const deb = (adq, n) => Array.from({ length: n }, (_, i) => ({ data: `2026-01-${dd(5 + (i % 20))}`, valor: -Math.round((20 + rnd() * 300) * 100) / 100, hist: i % 2 ? `TARIFA ALUGUEL POS ${adq}` : `ESTORNO CHARGEBACK ${adq}` }));
  const docs = [...docsOfx('ct-a', '2026-01', Math.round(nOfx * 0.3), [...cr('GETNET', 40), ...deb('GETNET', 6)]), ...docsOfx('ct-b', '2026-01', Math.round(nOfx * 0.25), [...cr('GETNET', 40)]), ...docsOfx('ct-c', '2026-01', Math.round(nOfx * 0.2), [...cr('SAFRA', 40), ...deb('SAFRA', 4)]),
    ...docsOfx('ct-d', '2026-01', Math.round(nOfx * 0.15), deb('GETNET', 4)), ...docsOfx('ct-a', '2025-12', Math.round(nOfx * 0.1), [])];
  S.extratos.clear(); docs.forEach(d => S.extratos.set(d.id, d)); E.bump('extratos');
  if (ofxCarregado) { Adq14._bancoCarga = { em: Date.now(), erros: [], nDocs: docs.length, nContas: 4, nTx: docs.reduce((s, d) => s + d.transacoes.length, 0) }; }
  Adq14.ui.mes = '2026-01'; Adq14.ui.filtro = '*';
  E.massa = { nGetnet: nGetnet * 2, nSafra, nErp, nOfx: docs.reduce((s, d) => s + d.transacoes.length, 0), gruposErp: lidoErp.periodos.reduce((s, p) => s + p.grupos.length, 0), docsOfx: docs.length, preparoMs: performance.now() - t0, CTB };
  return E;
}



/* ---------- utilidades de medição ---------- */
const agora = () => performance.now();
const ate = async (cond, ms = 30000) => { const t0 = agora(); while (!cond() && agora() - t0 < ms) await new Promise(r => setTimeout(r, 0)); return !!cond(); };
const dorme = ms => new Promise(r => setTimeout(r, ms));
const mediana = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
const medir = (fn, n = 5) => { const t = []; let r; for (let i = 0; i < n; i++) { const t0 = agora(); r = fn(); t.push(agora() - t0); } return { ms: mediana(t), max: Math.max(...t), r }; };
const ser = x => JSON.stringify(x, (k, v) => v instanceof Map ? [...v] : v instanceof Set ? [...v] : v);
const linhasHtml = h => (h.match(/<tr/g) || []).length;
// o mock de App.agendarRender só conta; no painel real ele redesenha. Aqui a espera redesenha a tela (render) a cada volta, como o painel faz
let _P_ESP = null;
const espQuente = (filtro = '*', ms = 90000) => ate(() => { Adq19.render(); return _P_ESP.quente(Adq14.ui.mes, filtro) && !_P_ESP._aq; }, ms);

/* ================================================================================================================
   A · TELA SEM BLOQUEIO (massa grande, OFX ainda em voo)
   ================================================================================================================ */
console.log('\n── A · tela sem bloqueio (massa grande) ──');
const G = await cenarioGrande({ quiet: true, ofxCarregado: false });
const { Adq14, Adq15, Adq17, Adq18, Adq19, ADQ15, ADQ19, FluxoDFC, DFC } = G; const P = Adq19.perf, MES = '2026-01'; _P_ESP = P;
chk('massa: 15.000 linhas de ERP (11.610 grupos), 50.000 transações de adquirente (36.000 Getnet + 14.000 SafraPay) e mais de 5.000 lançamentos de OFX', G.massa.nErp === 15000 && G.massa.nGetnet + G.massa.nSafra === 50000 && G.massa.nOfx >= 5000 && G.massa.gruposErp > 10000, G.massa);
console.log(`   · massa pronta (${Math.round(G.massa.preparoMs)} ms): peso do mês = ${P.peso(MES)} registros (fatiar a partir de ${ADQ19.PERF_PESO_FATIAR})`);
Adq14._bancoCarga = null; Adq14.ui.mes = MES; Adq14.ui.filtro = '*';
// a assinatura dos extratos já abriu, mas o 1º snapshot ainda não chegou (é a maior coleção): no painel real, Adq14.pronto() ficava em "false" e a tela esperava
G.Repo.prontas.delete('extratos'); G.Repo._un = { extratos: () => { }, contasBancarias: () => { } };
chk('situação real reproduzida: o Adq14.pronto() da v14.19 ESPERA os extratos (era o "Carregando…" que travava a tela) e o pronto() da v14.19.1 só espera o que a tela usa', Adq14.pronto() === false && P.pronto() === true);
chk('com a v14.19.1 o peso da massa pede cálculo fatiado, e o modo da tela é "fatiado" (esqueleto na hora)', P.pesado(MES) && P.modo(MES, '*') === 'fatiado' && P.peso(MES) > 50000);

const t0A = agora(); const h1 = Adq19.render(); const msA = agora() - t0A;
console.log(`   · 1ª pintura (fria, OFX pendente): ${msA.toFixed(1)} ms`);
chk('PRIMEIRA PINTURA em menos de 200 ms com 15 mil linhas de ERP + 50 mil transações de adquirente + 5 mil lançamentos de OFX (e o OFX ainda pendente)', msA < 200, msA);
chk('a tela NÃO fica presa em "Carregando os extratos OFX do DFC no servidor…": sai o bloco 1 (barra com "OFX: carregando…"), os 4 cards em "calculando…" e o andamento', !/Carregando os extratos OFX do DFC/.test(h1) && /OFX: carregando…/.test(h1) && /Conciliação em cálculo/.test(h1) && (h1.match(/a19-sk/g) || []).length === 4 && /Calculando a conciliação de/.test(h1) && /a14-recalcular/.test(h1), h1.slice(0, 500));
chk('o OFX do servidor é pedido em segundo plano: carregarBanco ficou pendente (esperando o 1º snapshot da assinatura, sem baixar de novo) e o estado é "carregando"', !!Adq14._carga && P.estadoOfx().estado === 'carregando');
await ate(() => P._aq && P._aq.espera, 30000);
const passosFrios = P._aq ? JSON.stringify(P._aq.passos) : '';
chk('o cálculo fatiado avança até a etapa que depende do OFX e ESPERA por ele (as etapas 1 e 2, ERP × Adquirente, já saem sem o OFX)', P._aq && P._aq.i === 2 && P._aq.espera === true && P.tem(Adq14, 'calcularMes', MES) && P.tem(Adq19, 'nivel1', MES) && !P.tem(Adq14, 'auditar', MES, '*'), P._aq && { i: P._aq.i, espera: P._aq.espera });
const hMeio = Adq19.render();
chk('no meio do cálculo a tela já mostra a conferência ERP × Adquirente consolidada (tabela "Contratos por Adquirente" com GETNET e SAFRAPAY) e o andamento "etapa 3 de 5"', /Contratos por Adquirente/.test(hMeio) && /GETNET/.test(hMeio) && /SAFRAPAY/.test(hMeio) && /etapa 3 de 5/.test(hMeio) && /aguardando os extratos OFX/.test(hMeio), hMeio.slice(0, 300));
// o snapshot dos extratos chega
const agendadosAntes = G.agendados || 0; G.Repo.prontas.add('extratos'); G.bump('extratos');
const okQuente = await espQuente('*');
chk('o OFX chega em segundo plano (snapshot) e o cálculo termina sozinho: as 5 etapas ficam em memória', okQuente && P.estadoOfx().estado === 'ok' && !!Adq14.bancoEstado().carregou);
chk('a tela foi avisada a cada etapa (agendarRender) para se redesenhar', (G.agendados || 0) - agendadosAntes >= 5, G.agendados);
const U = P.ultimo; console.log('   · etapas frias antes do OFX (ms):', passosFrios, '· etapas que dependem do OFX (ms):', JSON.stringify(U && U.passos), '· total', U && Math.round(U.total), 'ms');
chk('o cálculo frio foi fatiado em 5 etapas e nenhuma etapa passa de 600 ms (cede a thread entre elas)', U && U.passos.length === 5 && Math.max(...U.passos.map(x => x[1]), ...JSON.parse(passosFrios || '[]').map(x => x[1])) < 600, [passosFrios, U && U.passos]);

/* ================================================================================================================
   B · CACHE POR COMPETÊNCIA + DIRTY CHECK
   ================================================================================================================ */
console.log('\n── B · cache por competência + dirty check ──');
Adq14.ui.filtro = '*';
const w = medir(() => Adq19.render(), 7); const hQ = w.r;
console.log(`   · render com cache: mediana ${w.ms.toFixed(1)} ms · máx ${w.max.toFixed(1)} ms`);
chk('render com o resultado da competência em cache: menos de 50 ms (mediana de 7) e a tela completa (4 cards + tabela + OFX lido)', w.ms < 50 && w.max < 200 && !/a19-sk/.test(hQ) && /Faturamento conciliado/.test(hQ) && /Repasse bancário/.test(hQ) && /Creditado OFX/.test(hQ) && !/carregando OFX/.test(hQ), w.ms);
chk('o cache é por competência: uma memória por mês (YYYY-MM) para cada etapa (calcularMes, nivel1, auditar, indicadores, saldoReceber)', ['calcularMes', 'nivel1', 'auditar', 'indicadores', 'saldoReceber'].every(n => P._m[n] && P._m[n].porMes.has(MES)), Object.keys(P._m));
const I0 = Adq17.indicadores(MES, '*'), S0 = ser(I0), bruto0 = I0.consolidado.bruto.base, taxa0 = I0.consolidado.taxa.r;
const st0 = { ...P.stats };
// snapshots idênticos (carga dupla, releitura por TTL, polling): contador sobe, conteúdo é o mesmo
for (const c of ['extratos', 'contasBancarias', 'adq_lotes', 'adq_contratos', 'adq_taxas', 'adq_erp', 'adq_agendas', 'lojas', 'config']) G.bump(c);
Adq14._rev++; G.bump('extratos');
const wDirty = medir(() => Adq19.render(), 3);
chk('SNAPSHOT IDÊNTICO não recalcula: 9 coleções "mudaram" (contador) e o _rev subiu, mas o conteúdo é o mesmo → nenhuma etapa recalculada, render < 50 ms', P.stats.miss === st0.miss && wDirty.ms < 50 && ser(Adq17.indicadores(MES, '*')) === S0, { miss: P.stats.miss - st0.miss, ms: wDirty.ms });
chk('o hash do conteúdo é refeito só quando a versão da coleção muda (fp calculado de novo nas 9 coleções, uma vez cada), não a cada render', P.stats.fpCalc - st0.fpCalc >= 9 && P.stats.fpCalc - st0.fpCalc <= 12, P.stats.fpCalc - st0.fpCalc);
// mudança real em coleção que não é o OFX (taxa de antecipação do contrato): só ela invalida o que depende dela
const regra = [...G.S.adq_taxas.values()].find(r => r.adquirente === 'GETNET'); const antes = JSON.parse(JSON.stringify(regra.antecipacao));
regra.antecipacao = { ...regra.antecipacao, taxa: 3.1 }; G.bump('adq_taxas');
chk('EDIÇÃO DE TAXA invalida o cálculo (conteúdo mudou) e o OFX lido continua em memória: calcularMes/auditar/indicadores ficam velhos e o bancoConta (só OFX) segue válido', !P.tem(Adq14, 'calcularMes', MES) && !P.tem(Adq17, 'indicadores', MES, '*') && P.tem(Adq14, 'bancoConta', 'ct-a'), 'bancoConta' in P._m);
await espQuente('*');
const I1 = Adq17.indicadores(MES, '*');
chk('depois da edição a tela recalcula sozinha e o resultado reflete a nova taxa (antecipação efetiva diferente)', I1.consolidado.taxa.antR !== I0.consolidado.taxa.antR || I1.consolidado.taxa.r !== taxa0, { antes: I0.consolidado.taxa.antR, depois: I1.consolidado.taxa.antR });
regra.antecipacao = antes; G.bump('adq_taxas'); await espQuente('*');
chk('desfazer a edição volta ao resultado original (o cálculo é determinístico: os mesmos números de antes)', ser(Adq17.indicadores(MES, '*')) === S0 && Adq17.indicadores(MES, '*').consolidado.bruto.base === bruto0);
// importação de novo OFX: só o que depende dele
const stImp = { ...P.stats };
G.S.extratos.set('x-novo', { id: 'x-novo', contaId: 'ct-a', mes: MES, transacoes: [{ id: 'novo1', data: '2026-01-20', valor: 1234.56, hist: 'CREDITO GETNET LIQUIDACAO' }] }); G.bump('extratos');
chk('IMPORTAÇÃO DE NOVO OFX invalida só o que depende do extrato: calcularMes e nivel1 (ERP × adquirente) seguem em memória; auditar, indicadores e saldo recalculam', P.tem(Adq14, 'calcularMes', MES) && P.tem(Adq19, 'nivel1', MES) && !P.tem(Adq14, 'auditar', MES, '*') && !P.tem(Adq17, 'indicadores', MES, '*'));
await espQuente('*');
G.S.extratos.delete('x-novo'); G.bump('extratos'); await espQuente('*');
// Recalcular
const verAntes = P.ver, m0 = P.stats.miss;
await Adq14.recalcular();
chk('RECALCULAR descarta todas as memórias (versão sobe), recalcula do zero o que o botão usa (ERP × adquirente + repasses × OFX: ao menos 2 recálculos) e relê os extratos com limite de tempo; os indicadores e o saldo ficam para a tela refazer', P.ver === verAntes + 1 && P.stats.miss - m0 >= 2 && !P.tem(Adq17, 'indicadores', MES, '*') && !P.tem(Adq18, 'saldoReceber', MES, '*'), { ver: P.ver - verAntes, miss: P.stats.miss - m0 });
await espQuente('*');
chk('depois do Recalcular a tela volta a ficar pronta e com os mesmos números (nada mudou nos dados)', ser(Adq17.indicadores(MES, '*')) === S0);
// filtros e DFC: pré-aquecimento em segundo plano
await ate(() => P._fd && P._fd.pronto, 30000);
console.log('   · pré-aquecimento em segundo plano (ms):', JSON.stringify(P._fd && P._fd.ms));
chk('pré-aquecimento em segundo plano: depois da tela pronta os demais filtros (adquirentes e contratos) são calculados um por vez, cedendo a thread', P._fd && P._fd.pronto && P._fd.ms.length >= 5 && !P._fd.erro, P._fd);
const filtros = ['adq:GETNET', 'adq:SAFRAPAY', ...Adq14.contratos().filter(c => ADQ15.ADQS_TRI.includes(c.adquirente)).map(c => c.id)], tf = [];
for (const f of filtros) { Adq14.ui.filtro = f; const t = agora(); const h = Adq19.render(); tf.push(agora() - t); if (/a19-sk/.test(h)) tf.push(9999); }
Adq14.ui.filtro = '*';
console.log(`   · trocar a Visualização (${filtros.length} filtros): máx ${Math.max(...tf).toFixed(1)} ms`);
chk('TROCAR O FILTRO da Visualização (cada adquirente e cada contrato) lê o resultado pronto: menos de 50 ms em todos, sem esqueleto', Math.max(...tf) < 50, tf);
const dfc = { c1: medir(() => Adq18._cx18(MES), 3), c2: medir(() => Adq19.seloDfc(MES, FluxoDFC.trDFC()), 3), c3: medir(() => FluxoDFC.painelCartoes18(), 3) };
console.log(`   · DFC: _cx18 ${dfc.c1.ms.toFixed(1)} ms · selo ${dfc.c2.ms.toFixed(1)} ms · painel ${dfc.c3.ms.toFixed(1)} ms`);
chk('ABRIR A DFC lê a memória da Auditoria pronta: _cx18, o selo e o painel de cartões em menos de 50 ms cada', dfc.c1.ms < 50 && dfc.c2.ms < 50 && dfc.c3.ms < 50 && /Cartões conciliados automaticamente/.test(dfc.c3.r), { ...Object.fromEntries(Object.entries(dfc).map(([k, v]) => [k, v.ms])) });
const trs = FluxoDFC.trDFC(); const cl = medir(() => { DFC._ov18++; try { trs.forEach(t => DFC.classificar(t)); } finally { DFC._ov18--; } }, 3);
console.log(`   · DFC: classificar ${trs.length} lançamentos com sobreposição ${cl.ms.toFixed(1)} ms`);
chk('a DFC classifica os 5 mil lançamentos do OFX com a sobreposição da Auditoria sem recalcular (menos de 200 ms)', cl.ms < 200, cl.ms);
const stDfc = { ...P.stats }; G.bump('extratos'); G.bump('contasBancarias'); Adq18._cx18(MES);
chk('snapshot idêntico do OFX NÃO refaz a Auditoria da DFC (a memória _cx vale pelo conteúdo, não pelo contador de snapshots)', P.stats.miss === stDfc.miss && Adq18._cx && Adq18._cx.feitos.has(MES));

/* ================================================================================================================
   C · OFX DO SERVIDOR: sem baixar duas vezes, com limite de tempo, erro explícito
   ================================================================================================================ */
console.log('\n── C · carga do OFX com limite de tempo ──');
{
  const cena = async (opts = {}) => { const E = await FX.cenario({ g18: true }); OFX_JAN(E); E.Adq14._bancoCarga = null; E.baixou = []; const rc = E.Repo.recarregar; E.Repo.recarregar = async c => { E.baixou.push(c); return opts.recarregar ? opts.recarregar(c) : rc(c); }; return E; };
  // 1ª leitura com as coleções já assinadas e com snapshot: não baixa nada
  { const E = await cena(); await E.Adq14.carregarBanco(); const e = E.Adq14.bancoEstado(); chk('1ª leitura com as coleções já em memória (snapshot da assinatura): NÃO baixa de novo (0 downloads) e o estado é "lido"', E.baixou.length === 0 && e.carregou && !e.erros.length && e.nTx === 2, { baixou: E.baixou, e }); }
  { const E = await cena(); E.ADQ19.PERF = false; await E.Adq14.carregarBanco(); chk('mesma situação sem a otimização (v14.19): baixava as 2 coleções de novo — a v14.19.1 evita o download duplicado', E.baixou.length === 2, E.baixou); }
  // assinatura em voo: espera o snapshot (sem baixar), em paralelo para as 2 coleções
  { const E = await cena(); E.Repo.prontas.delete('extratos'); E.Repo._un = { extratos: 1 }; const t = agora(); const p = E.Adq14.carregarBanco(); await dorme(60); const pend = E.Adq14.bancoEstado().carregando && !E.Adq14.bancoEstado().carregou;
    E.Repo.prontas.add('extratos'); E.bump('extratos'); const r = await p; chk('assinatura em voo: a leitura ESPERA o 1º snapshot em vez de baixar de novo (0 downloads) e termina assim que ele chega', pend && E.baixou.length === 0 && r.erros.length === 0 && agora() - t < 1000, { pend, baixou: E.baixou }); }
  // timeout
  { const E = await cena({ recarregar: () => new Promise(() => { }) }); E.ADQ19.PERF_TIMEOUT_MS = 150; const t = agora(); const r = await E.Adq14.carregarBanco(true), ms = agora() - t;
    chk('LIMITE DE TEMPO: se o servidor não responde, a leitura termina no limite (150 ms no teste; 10 s em produção) com erro explícito por coleção', ms >= 140 && ms < 1500 && r.erros.length === 2 && r.erros.every(x => /tempo esgotado/.test(x.msg)) && ['contasBancarias', 'extratos'].every(c => r.erros.some(x => x.col === c)), { ms, erros: r.erros });
    const e = E.Adq14.bancoEstado(); const ox = E.Adq19.perf.estadoOfx(); E.Adq14.ui.mes = '2026-01'; E.Adq14.ui.filtro = '*'; const h = E.Adq19.render();
    chk('depois do limite o estado vira "erro" (carregou = true com erros) e a tela mostra "OFX: não foi possível ler — use Recalcular", NUNCA fica em "OFX: carregando…"', e.carregou && e.erros.length === 2 && ox.estado === 'erro' && /OFX: não foi possível ler/.test(h) && !/OFX: carregando…/.test(h) && !/Carregando os extratos OFX/.test(h) && /tempo esgotado/.test(h), ox);
    chk('o limite padrão é de 10 segundos por coleção', /PERF_TIMEOUT_MS: 10000/.test(html) && ADQ19.PERF_TIMEOUT_MS === 10000); }
  // leitura que falha (rejeita): erro registrado, a outra coleção segue
  { const E = await cena({ recarregar: async c => { if (c === 'extratos') throw new Error('HTTP 503'); } }); const r = await E.Adq14.carregarBanco(true);
    chk('uma coleção que falha (HTTP 503) vira erro explícito e a outra é lida normalmente (as duas em paralelo)', r.erros.length === 1 && r.erros[0].col === 'extratos' && /503/.test(r.erros[0].msg) && E.baixou.length === 2, r); }
  // resposta que chega DEPOIS do limite ainda atualiza a tela
  { let solta; const E = await cena({ recarregar: c => new Promise(res => { if (c === 'extratos') solta = res; else res(); }) }); E.ADQ19.PERF_TIMEOUT_MS = 100; await E.Adq14.carregarBanco(true); const a0 = E.agendados || 0; solta(); await dorme(20);
    chk('resposta que chega depois do limite ainda atualiza a memória e redesenha a tela (agendarRender)', (E.agendados || 0) > a0); }
  // TTL: releitura em segundo plano, sem esconder o que já está na tela
  { const E = await cena(); await E.Adq14.carregarBanco(); E.Adq14._bancoCarga.em -= 11 * 60 * 1000; chk('passado o TTL (10 min) o painel pede a releitura, mas o OFX já lido continua valendo (a tela não volta para "carregando")', E.Adq14.precisaBanco() === true && E.Adq14.bancoEstado().carregou === true);
    const p = E.Adq14.carregarBanco(); chk('durante a releitura por TTL o estado continua "ok" (releitura em segundo plano)', E.Adq19.perf.estadoOfx().estado === 'ok'); await p; chk('a releitura por TTL baixa as 2 coleções uma vez cada', E.baixou.length === 2, E.baixou); }
}

/* ================================================================================================================
   D · CONSULTA ENXUTA DE OFX (débitos de POS e retenções; créditos por conta + data)
   ================================================================================================================ */
console.log('\n── D · consulta enxuta de OFX ──');
{
  const E = await FX.cenario({ g18: true }); const { Adq14: A14, Adq18: A18, Adq19: A19, ADQ18: Q18 } = E; const PP = A19.perf, Pad = A14.padroes(), re = PP.reDebitos();
  const V = ['ALUGUEL', 'TARIFA', 'MENSALIDADE', 'POS', 'MAQUININHA', 'MAQUINETA', 'MAQUINA', 'TERMINAL', 'EQUIPAMENTO', 'GETNET', 'SAFRA', 'SAFRAPAY', 'CREDSYSTEM', 'ADQUIRENTE', 'CARTAO', 'CARTOES', 'COMISSAO', 'RETENCAO', 'RETIDO', 'BLOQUEIO', 'CHARGEBACK', 'CONTESTACAO', 'CANCELAMENTO', 'ESTORNO', 'AJUSTE', 'DEBITO ADQ', 'DEB ADQ', 'PIX', 'TED', 'DOC', 'TRANSFERENCIA', 'PAGTO', 'PAGAMENTO', 'BOLETO', 'TRIBUTO', 'IMPOSTO', 'FORNECEDOR', 'LOJA', 'FOLHA', 'ENERGIA', 'AGUA', 'DE', 'DO', 'DA', 'CIELO', 'REDE', 'STONE', 'PAGSEGURO', 'ALUGUEL DE POS', 'TARIFA DE CARTAO', 'MENSALIDADE DE TERMINAL', 'COMPRA', 'SAQUE', 'JUROS', 'IOF'];
  let s = 20261110; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  let nulos = 0, naoNulos = 0, vioPre = 0, difMesmo = 0; const exemplos = [];
  for (let i = 0; i < 40000; i++) {
    const n = 1 + Math.floor(rnd() * 5), ws = Array.from({ length: n }, () => V[Math.floor(rnd() * V.length)]); const h = ' ' + E.AdqTaxas.chave(ws.join(' ')) + ' ', t = { id: 't' + i, h, valor: -(10 + Math.floor(rnd() * 900)) / 3 };
    const k = A18.classificarDebito(t, Pad); if (k) { naoNulos++; if (!re.test(h)) { vioPre++; if (exemplos.length < 5) exemplos.push(h); } } else nulos++;
  }
  chk(`PRÉ-FILTRO É SUPERCONJUNTO do critério do motor: em 40 mil históricos aleatórios (${naoNulos} classificados como tarifa/retenção, ${nulos} não), nenhum classificado foi descartado pelo pré-filtro`, vioPre === 0 && naoNulos > 3000 && nulos > 3000, { vioPre, exemplos });
  // débitos do OFX grandes: com × sem pré-filtro, resultado idêntico e bem menos chamadas ao classificador
  E.S.contasBancarias.get('ct-a').titularEmpresaId = 'resilienza'; E.S.contasBancarias.set('ct-d', { id: 'ct-d', apelido: 'Conta D', ativa: true, titularEmpresaId: 'resilienza', banco: '033', agencia: '0001', conta: '9000' }); E.bump('contasBancarias');
  const ruido = ['PIX ENVIADO FORNECEDOR', 'PAGAMENTO BOLETO', 'TED RECEBIDA', 'COMPRA DEBITO', 'PAGAMENTO FOLHA', 'DEPOSITO DINHEIRO LOJA', 'PAGTO TRIBUTO'], alvos = ['TARIFA ALUGUEL POS GETNET', 'ESTORNO CHARGEBACK GETNET', 'MENSALIDADE MAQUININHA', 'DEBITO ADQ RETENCAO SAFRAPAY', 'COMISSAO CARTAO GETNET', 'TARIFA CARTAO'];
  const tx = []; for (let i = 0; i < 12000; i++) tx.push({ id: 'd' + i, data: `2026-01-${String(1 + (i % 28)).padStart(2, '0')}`, valor: -(10 + (i % 300)), hist: i % 40 === 0 ? alvos[i % alvos.length] + ' ' + i : ruido[i % ruido.length] + ' ' + (i % 97) });
  E.S.extratos.set('xd', { id: 'xd', contaId: 'ct-d', mes: '2026-01', transacoes: tx }); E.S.extratos.set('xa2', { id: 'xa2', contaId: 'ct-a', mes: '2026-01', transacoes: tx.slice(0, 6000).map(t => ({ ...t, id: 'a' + t.id })) }); E.bump('extratos');
  let chamadas = 0; const cd0 = A18.classificarDebito; A18.classificarDebito = function () { chamadas++; return cd0.apply(this, arguments); };
  const rodar = on => { E.ADQ19.PERF = on; A19.perf.invalidar(); A14._memoA = null; A14._bancos = null; A19._ex = null; chamadas = 0; const t = agora(); const ex = A19.extrasDoMes('2026-01'), dc = A18.debitosOfx('ct-a', '2026-01'); return { ms: agora() - t, ch: chamadas, ex: ser({ p: [...ex.porContrato], s: ex.semDono, c: ex.contasLidas }), dc: ser(dc), nEx: [...ex.porContrato.values()].reduce((x, o) => x + o.tarifa.length + o.retencao.length, 0) + ex.semDono.length, nDc: dc.tarifa.length + dc.retencao.length }; };
  const off = rodar(false), on = rodar(true); E.ADQ19.PERF = true; A18.classificarDebito = cd0;
  console.log(`   · débitos: sem pré-filtro ${off.ch} chamadas / ${off.ms.toFixed(0)} ms · com pré-filtro ${on.ch} chamadas / ${on.ms.toFixed(0)} ms`);
  chk('com o pré-filtro, tarifas de POS e retenções (conta do contrato e demais contas do CNPJ) saem IDÊNTICAS ao critério completo — e há lançamentos de verdade nos dois lados', on.ex === off.ex && on.dc === off.dc && on.nEx > 100 && on.nDc > 50, { nEx: on.nEx, nDc: on.nDc });
  chk('o classificador vê só uma fração dos débitos (menos de 15% das chamadas da leitura completa)', on.ch > 0 && on.ch < off.ch * 0.15, { on: on.ch, off: off.ch });
  // créditos indexados por conta + data
  const b = G.Adq14.bancoConta('ct-a'); let okIdx = b.credDia instanceof Map && b.debDia instanceof Map; const datas = new Set(b.cred.map(c => c.data));
  for (const d of datas) { const a = b.cred.filter(c => c.data === d).map(c => c.id).sort(), x = (b.credDia.get(d) || []).map(c => c.id).sort(); if (ser(a) !== ser(x)) okIdx = false; }
  chk('os créditos do OFX são indexados por conta + data (Map data → lançamentos), o que torna a busca D+0…D+2 O(1) por dia; o índice reproduz exatamente o filtro linear', okIdx && datas.size > 20, datas.size);
  chk('o resultado de bancoConta fica em memória (mesmo objeto nas chamadas seguintes, mesmo com o contador de snapshots subindo)', (() => { const x = G.Adq14.bancoConta('ct-a'); G.bump('extratos'); G.bump('contasBancarias'); return G.Adq14.bancoConta('ct-a') === x; })());
}

/* ================================================================================================================
   E · DRILL-DOWN SOB DEMANDA
   ================================================================================================================ */
console.log('\n── E · drill-down sob demanda ──');
{
  Adq19.ui.aberto = {}; Adq19.ui.todas = {}; Adq14.ui.filtro = '*'; Adq14.ui.mes = MES; Adq19.render();
  const calls = { a: 0, b: 0, c: 0, d: 0 }, o = { a: Adq19.abaDiaAdq, b: Adq19.abaAntOfx, c: Adq19.abaDiaContrato, d: Adq19.abaDiaCred };
  Adq19.abaDiaAdq = function () { calls.a++; return o.a.apply(this, arguments); }; Adq19.abaAntOfx = function () { calls.b++; return o.b.apply(this, arguments); }; Adq19.abaDiaContrato = function () { calls.c++; return o.c.apply(this, arguments); }; Adq19.abaDiaCred = function () { calls.d++; return o.d.apply(this, arguments); };
  const hFechado = Adq19.render();
  chk('com as linhas recolhidas NENHUMA tabela diária é montada (Dia a dia ERP × Adquirente e Antecipação & Extratos OFX: 0 chamadas) e o HTML é pequeno', calls.a + calls.b + calls.c + calls.d === 0 && hFechado.length < 30000 && linhasHtml(hFechado) < 40, { calls, bytes: hFechado.length, linhas: linhasHtml(hFechado) });
  Adq19.ui.aberto['adq:GETNET'] = 'a'; const t = agora(); const hA = Adq19.render(), msA2 = agora() - t;
  chk('ao expandir a adquirente só a aba aberta é montada (Dia a dia: 1 chamada; Antecipação & OFX: 0)', calls.a === 1 && calls.b === 0, calls);
  const dados = (hA.match(/<tr><td>\d\d\/\d\d\/\d{4}<\/td>/g) || []).length;
  chk('o Dia a dia mostra só as 50 primeiras linhas e o botão "Ver todas" com o total', dados === 50 && /Mostrando 50 de \d+ linha\(s\)/.test(hA) && /data-a="a19-vertodas"[^>]*>Ver todas \(\d+\)/.test(hA), { dados });
  const total = Number((hA.match(/Mostrando 50 de (\d+) linha/) || [])[1]);
  chk('o render com o drill-down aberto em 50 linhas leva menos de 200 ms', msA2 < 200 && total > 50, msA2);
  await Adq19.acao('a19-vertodas', { dataset: { k: 'a:GETNET' } }); const t2 = agora(); const hT = Adq19.render(), ms2 = agora() - t2, dTodas = (hT.match(/<tr><td>\d\d\/\d\d\/\d{4}<\/td>/g) || []).length;
  chk('"Ver todas" mostra o resto (até o teto de 1.000 linhas) com o botão "Mostrar só 50" para voltar', dTodas === Math.min(total, ADQ19.PERF_LINHAS_MAX) && /data-v="0"[^>]*>Mostrar só 50/.test(hT) && ms2 < 400, { dTodas, total, ms2 });
  await Adq19.acao('a19-vertodas', { dataset: { k: 'a:GETNET', v: '0' } }); chk('"Mostrar só 50" volta ao limite inicial', (Adq19.render().match(/<tr><td>\d\d\/\d\d\/\d{4}<\/td>/g) || []).length === 50);
  Adq19.ui.aberto['adq:GETNET'] = 'b'; const hB = Adq19.render();
  chk('a aba "Antecipação ERP × Contrato & Extratos OFX" só é montada ao ser aberta (1 chamada) e também respeita as 50 linhas', calls.b === 1 && /Repasses esperados × créditos no OFX/.test(hB) && /Extratos OFX lidos no DFC/.test(hB));
  const idc = Adq19.grupos(Adq17.indicadores(MES, '*'), MES)[0].contratos[0].id; Adq19.ui.aberto['adq:GETNET'] = undefined; delete Adq19.ui.aberto['adq:GETNET']; Adq19.ui.aberto[idc] = 'a'; const hC = Adq19.render();
  chk('abrir a linha de um contrato monta só o detalhe dele (abaDiaContrato: 1 chamada) e a tabela diária limita em 50 linhas', calls.c === 1 && (hC.match(/<tr><td>\d\d\/\d\d\/\d{4}<\/td>/g) || []).length <= 50, calls);
  Object.assign(Adq19, { abaDiaAdq: o.a, abaAntOfx: o.b, abaDiaContrato: o.c, abaDiaCred: o.d }); Adq19.ui.aberto = {}; Adq19.ui.todas = {};
}

/* ================================================================================================================
   F · EQUIVALÊNCIA, RECURSO DESLIGADO E CHAVE DA OTIMIZAÇÃO
   ================================================================================================================ */
console.log('\n── F · equivalência e recurso desligado ──');
{
  // mesma massa, resultado COM cache × SEM a otimização (cálculo original do motor)
  Adq14.ui.filtro = '*'; P.invalidar(); const resComCache = () => { const I = Adq17.indicadores(MES, '*'); return { I: ser(I), S: ser(Adq18.saldoReceber(MES, '*')), N: ser(Adq19.nivel1(MES)), A: ser(Adq14.auditar(MES, '*').cruz.linhas.map(l => [l.data, l.contaId, l.status, l.esperado, l.creditado])) }; };
  const com = resComCache(); const com2 = resComCache();
  ADQ19.PERF = false; Adq14._rev++; Adq14._memoA = null; Adq17._memo = null; Adq15._memo = null; Adq19._memo = null; Adq18._sg = null; Adq14._bancos = null; Adq19._ex = null;
  const sem = resComCache(); ADQ19.PERF = true;
  chk('EQUIVALÊNCIA com a massa grande: indicadores, saldo a receber, nível 1 e as linhas de repasse da Auditoria são IDÊNTICOS com e sem a otimização (cache + pré-filtro)', com.I === sem.I && com.S === sem.S && com.N === sem.N && com.A === sem.A, ['I', 'S', 'N', 'A'].filter(k => com[k] !== sem[k]));
  chk('o resultado em cache é o mesmo objeto/valores nas leituras seguintes', com.I === com2.I && com.S === com2.S);
  // chave geral desligada: tela da v14.19 (volta a esperar o OFX), nada é guardado
  const E1 = await FX.cenario({ g18: true }); E1.ADQ19.PERF = false; E1.Adq14._bancoCarga = null; E1.Adq19.perf._m = {}; E1.Adq14.ui.mes = '2026-01'; E1.Adq14.ui.filtro = '*'; E1.Repo.prontas.add('extratos');
  const hOff = E1.Adq19.render(); chk('com a chave PERF desligada a tela volta ao comportamento da v14.19 ("Carregando os extratos OFX do DFC…" até o OFX chegar) e não guarda nada em memória', /Carregando os extratos OFX do DFC/.test(hOff) && Object.keys(E1.Adq19.perf._m).length === 0, Object.keys(E1.Adq19.perf._m));
  // recurso gestao_v1419 desligado = v14.18.2
  // recurso gestao_v1419 desligado = v14.18.2: nada da v14.19.1 roda
  const E3 = ambiente({ g19: false }); const antes = { ...E3.Adq19.perf.stats }; E3.Adq14.calcularMes('2026-01'); E3.Adq14.calcularMes('2026-01'); try { E3.Adq14.auditar('2026-01', '*'); } catch (e) { /* sem dados */ }
  chk('com gestao_v1419 DESLIGADA nada da v14.19.1 roda: as funções do motor passam direto (sem memória, sem hash, sem esqueleto) e a tela é a da v14.18.2', E3.Adq19.perf.ligado() === false && ser(E3.Adq19.perf.stats) === ser(antes) && Object.keys(E3.Adq19.perf._m).length === 0, E3.Adq19.perf.stats);
  chk('e as funções de carga/Recalcular também passam direto quando o recurso está desligado (carregarBanco original)', (() => { const f = E3.Adq14.carregarBanco; return typeof f === 'function' && f !== E3.Adq14._o19p.carregarBanco && E3.Adq14._o19p.carregarBanco.toString().includes('_carga'); })());
  const rd = fs.readFileSync(path.join(raiz, 'README.md'), 'utf8'), iNovo = rd.indexOf('## v14.19.1 ·'), iAnt = rd.indexOf('## v14.19 ·');
  chk('documentação: o README abre com "Versão v14.19.1." e traz a seção v14.19.1 antes da v14.19, com as 4 otimizações, o limite de 10 s, a chave PERF, as medidas e este teste', /^Versão v14\.19\.1\./m.test(rd) && iNovo > 0 && iNovo < iAnt && ['Otimização 1', 'Otimização 2', 'Otimização 3', 'Otimização 4', '10 s por coleção', 'ADQ19.PERF = false', 'tests/teste-desempenho-1419.mjs', 'Ver todas'].every(x => rd.slice(iNovo, iAnt).includes(x)));
  chk('o recurso gestao_v1419 segue com a versão v14.19 e o título cita o hotfix v14.19.1 (o rótulo da Liberação não muda)', /gestao_v1419: \{ versao: 'v14\.19',[^}]*v14\.19\.1/.test(html));
  chk('a chave PERF e os limites estão nas constantes do módulo (PERF, PERF_TIMEOUT_MS = 10000, PERF_PESO_FATIAR, PERF_LINHAS = 50, PERF_LINHAS_MAX = 1000)', ADQ19.PERF === true && ADQ19.PERF_TIMEOUT_MS === 10000 && ADQ19.PERF_LINHAS === 50 && ADQ19.PERF_LINHAS_MAX === 1000 && ADQ19.PERF_PESO_FATIAR > 0);
}

console.log(`\n${OK.length} ok · ${FAIL.length} falha(s)`);
if (FAIL.length) { console.log('\nFALHAS:\n - ' + FAIL.join('\n - ')); process.exit(1); }
