import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(process.env.PAINEL_HTML || path.join(raiz, 'public/index.html'), 'utf8');
const OK = [], FAIL = [];
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x !== '' ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 1200) : '')); };
const md5 = t => createHash('md5').update(t).digest('hex');
const corta = (ini, fim) => { const a = html.indexOf(ini), b = html.indexOf(fim, a + ini.length); if (a < 0 || b < 0) throw new Error('bloco não encontrado: ' + ini.slice(0, 60) + ' … ' + fim.slice(0, 60)); return html.slice(a, b); };
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const perto = (a, b, t = 0.011) => Math.abs(a - b) <= t;
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const espera = () => new Promise(r => setTimeout(r, 0));

const regras = await import('../netlify/lib/regras.mjs');
const perm = await import('../netlify/lib/permissoes.mjs');
const escopo = await import('../netlify/lib/backup-escopo-1413.mjs');

/* ---------- ambiente de teste: código REAL do painel com Repo/UI de brincadeira ---------- */
const base = corta('const ADQ_CFG = {', '/* ============================ 6. SERVIÇOS ============================ */');
const motor = corta('const MotorConciliacao = {', '/* ============================ 7. UI (aba do Módulo 4) ============================ */');
const modulo = corta('const ADQ14 = {', '/* ---- fim v14.15 ---- */') + '/* ---- fim v14.15 ---- */';
const parcPix = corta('/* PARC_PIX:INI */', '/* PARC_PIX:FIM */');
const dfcResumo = corta('/* DFC_RESUMO:INI */', '/* DFC_RESUMO:FIM */');
const adq17 = corta('const ADQ17 = {', '/* =====================================================================\n   v14.17 · FRENTE 2 · DESDOBRAMENTO ANALÍTICO');
const CNPJlib = corta('const CNPJ = {', '/**\n * CSV — leitura e geração');
const dvC = (d, n) => { let s = 0, p = n - 7; for (let i = 0; i < n; i++) { s += +d[i] * p--; if (p < 2) p = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
const gerarCnpj = b8 => { const d = b8 + '0001'; const d1 = dvC(d, 12); return d + d1 + dvC(d + d1, 13); };
const CNPJ_RES = gerarCnpj('11222333'), CNPJ_MAR = gerarCnpj('44555666'), CNPJ_BANCO = gerarCnpj('77888999');
const fmtCnpj = s => s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

function ambiente({ g14 = true, g15 = true, g17 = true } = {}) {
  const S = { adq_taxas: new Map(), adq_contratos: new Map(), adq_lotes: new Map(), adq_agendas: new Map(), adq_erp: new Map(), contasBancarias: new Map(), extratos: new Map(), lojas: new Map(), config: new Map() };
  const V = {}; let tic = 0; const bump = c => { V[c] = (V[c] || 0) + 1; };
  const Repo = {
    cols: S, prontas: new Set(Object.keys(S)), todos: c => [...(S[c] || new Map()).values()], get: (c, id) => (S[c] || new Map()).get(id) || null, versao: c => V[c] || 0,
    salvar: async (c, id, d) => { S[c].set(id, { id, ...JSON.parse(JSON.stringify(d)), atualizadoEm: 't' + (++tic) }); bump(c); },
    excluir: async (c, id) => { S[c].delete(id); bump(c); }, assinar(c) { ctx.assinadas.push(c); }, semMeta: d => d,
    recarregar: async c => { ctx.recargas.push(c); if (ctx.negar && ctx.negar.has(c)) throw Object.assign(new Error('HTTP 403 · sem permissão para ' + c), { status: 403 });
      if (ctx.servidor && ctx.servidor[c]) { S[c].clear(); ctx.servidor[c].forEach(d => S[c].set(d.id, JSON.parse(JSON.stringify(d)))); } Repo.prontas.add(c); bump(c); },
  };
  const emp = { resilienza: { id: 'resilienza', nome: 'Resilienza', cnpj: CNPJ_RES }, 'mar-aberto': { id: 'mar-aberto', nome: 'Mar Aberto', cnpj: CNPJ_MAR } };
  const ctx = { flag: g14, flag15: g15, flag17: g17, toasts: [], audits: [], confirmou: 0, recargas: [], assinadas: [], servidor: null, negar: null, modais: [], baixados: [], previas: [] };
  const ConcMP = { SUBS72: [['cruzamento', 'Conciliação e Cruzamento'], ['regras', 'Regras de Taxa Contratuais'], ['resumo', 'Resumo do Fechamento']], ui: { sub: 'regras' }, v72: () => true,
    renderCredito() { return 'ORIGINAL-CREDITO'; }, renderRegras() { return 'ORIGINAL-REGRAS'; }, empresa: id => emp[id] || null, nomeEmpresa: id => emp[id]?.nome || id || '—', empresas: () => Object.values(emp), ecInfo: () => null };
  const mocks = {
    Repo, ConcMP, g14: () => ctx.flag, g15: () => ctx.flag15 && ctx.flag, g16: () => ctx.flag, g17: () => ctx.flag17 && ctx.flag15 && ctx.flag, Datas: { hojeISO: () => '2026-11-17' }, Recursos: { ativo: () => true }, Auth: { can: (...x) => (ctx.pode ? ctx.pode(...x) : true), id: 'u-teste' }, Libs: {}, DFC: { classificar: () => ({}) },
    ContasBancarias: { rotulo: c => c.apelido }, Retaguarda: {}, CNPJ: undefined, LOGO_NAVY: 'data:image/png;base64,AAAA', $: () => null,
    Fmt: { brl: n => 'R$' + Number(n).toFixed(2), brl0: n => 'R$' + Math.round(n), num: (n, d = 0) => Number(n).toFixed(d), data: d => String(d ?? '').replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1'), dataHora: d => d, pct: (n, d = 2) => Number(n).toFixed(d) + '%' },
    UI: { toast: m => ctx.toasts.push(m), modal(o) { ctx.modais.push(o); return { el: {} }; }, confirmar: async () => { ctx.confirmou++; return true; }, confirmarImpacto: async () => true, lerForm: () => ctx.form || ({}) },
    App: { render() { }, agendarRender() { } }, Audit: { registrar: a => { ctx.audits.push(a); return Promise.resolve(); } },
    Documento: { baixarArquivo(nome, blob) { ctx.baixados.push([nome, blob]); return true; }, montar: (t, corpo, o) => ({ titulo: t, corpo, opcoes: o }), previa: (t, doc, nome) => { ctx.previas.push({ titulo: t, doc, nome }); } }, CSV: { gerar: m => m.map(l => l.join(';')).join('\n') },
    g09: () => true, g11: () => false, Acesso: { loja: () => false }, campo: () => '', esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  };
  const nomes = Object.keys(mocks).filter(k => k !== 'CNPJ');
  const fn = new Function(...nomes, `${CNPJlib}\n${parcPix}\n${base}\n${motor}\n${modulo}\n${dfcResumo}\n${adq17}\nreturn { ADQ_CFG, AdqTaxas, DiasUteis, MotorConciliacao, ADQ14, Adq14, ADQ15, Adq15, ADQ17, Adq17, DFC_RESUMO, CNPJ };`);
  const E = fn(...nomes.map(k => mocks[k]));
  ctx.S = S; ctx.Repo = Repo; ctx.ConcMP = ConcMP; ctx.bump = bump; Object.assign(ctx, E);
  return ctx;
}

/* ---------- fixtures fictícias nos formatos reais (as mesmas da v14.15) ---------- */
const mdr = (d, c1, c26, c712) => [{ modalidade: 'debito', de: 1, ate: 1, taxa: d }, { modalidade: 'credito', de: 1, ate: 1, taxa: c1 }, { modalidade: 'credito', de: 2, ate: 6, taxa: c26 }, { modalidade: 'credito', de: 7, ate: 12, taxa: c712 }];
const regra = (a, e, m, am) => ({ id: `adq-${a.toLowerCase()}__todas__emp-${e}`, adquirente: a, bandeira: '*', empresaId: e, ativo: true, antecipado: true, prazoRepasse: 1, mdr: m, antecipacao: { taxa: am, unidade: 'am', metodo: 'simples' } });
const CAB_GN = 'ESTABELECIMENTO COMERCIAL;CPF / CNPJ;RAZÃO SOCIAL;DATA/HORA DA VENDA;BANDEIRA;MODALIDADE;FORMA DE PAGAMENTO;STATUS DA TRANSAÇÃO;PARCELAS;DATA PREVISTA DO 1º PAGAMENTO;NÚMERO DO CARTÃO;NÚMERO DE AUTORIZAÇÃO (AUT);NÚMERO DO COMPROVANTE DE VENDA (NSU);TIPO DE CAPTURA;NÚMERO DO TERMINAL;VALOR BRUTO;VALOR TAXA;VALOR LÍQUIDO;CARTÃO ESTRANGEIRO;;;;;';
const SEP = ';'.repeat(22) + '-';
const gn = (cnpj, razao, ec) => (dh, band, mod, forma, st, parc, dp, bruto, taxa, liq) => [ec, fmtCnpj(cnpj), razao, dh, band, mod, forma, st, parc, dp, '439267******0321', '35859', '5725', 'Pos', '14092285', bruto, taxa, liq, 'Nacional', '', '', '', '', '-'].join(';');
const gnRes = gn(CNPJ_RES, 'Resilienza Negocios Ltda', '15105016'), gnMar = gn(CNPJ_MAR, 'Mar Aberto Comercio Atacadista Ltda', '13100535');
/* Getnet Resilienza · janeiro: Visa débito 1.000 (05/01), Mastercard crédito 2.000 (05/01), Visa crédito 3x 3.000 (05/01), Visa débito 100 (12/01) + estorno/negada/desfeita à parte; fevereiro: Visa débito 300 (02/02) */
const csvRes = [CAB_GN,
  gnRes('05/01/2026 14:20', 'Visa', 'Débito', 'Débito', 'Aprovada', 1, '06/01/2026', '1.000,00', '-9,00', '991,00'),
  gnRes('05/01/2026 15:00', 'Mastercard', 'Crédito', 'Crédito à Vista', 'Aprovada', 1, '04/02/2026', '2.000,00', '-44,00', '1.956,00'),
  SEP, gnRes('05/01/2026 16:30', 'Visa', 'Crédito', 'Crédito Parcelado Lojista', 'Aprovada', 3, '04/02/2026', '3.000,00', '-90,00', '2.910,00'),
  gnRes('05/01/2026 17:00', 'Elo', 'Crédito', 'Crédito à Vista', 'Negada', 1, '04/02/2026', '500,00', '-0,00', '500,00'),
  gnRes('12/01/2026 10:00', 'Visa', 'Débito', 'Débito', 'Aprovada', 1, '13/01/2026', '100,00', '-0,90', '99,10'),
  gnRes('02/02/2026 10:00', 'Visa', 'Débito', 'Débito', 'Aprovada', 1, '03/02/2026', '300,00', '-2,70', '297,30'), ''].join('\r\n');
const csvMar = [CAB_GN, SEP,
  gnMar('12/01/2026 11:00', 'Visa', 'Débito', 'Débito', 'Aprovada', 1, '13/01/2026', '400,00', '-3,60', '396,40'),
  gnMar('12/01/2026 12:00', 'Elo', 'Crédito', 'Crédito à Vista', 'Aprovada', 1, '11/02/2026', '600,00', '-13,20', '586,80'), SEP, ''].join('\n');
/* virada de mês: vendas no débito de 30/01 (sex) e 31/01 (sáb) pagam juntas em 02/02 (seg) */
const csvVirada = [CAB_GN,
  gnRes('30/01/2026 10:00', 'Visa', 'Débito', 'Débito', 'Aprovada', 1, '02/02/2026', '500,00', '-4,50', '495,50'),
  gnRes('31/01/2026 10:00', 'Mastercard', 'Débito', 'Débito', 'Aprovada', 1, '02/02/2026', '300,00', '-2,70', '297,30'), ''].join('\n');

const nulls = n => Array(n).fill(null);
const topoSafra = (titulo, periodo) => [[null, 'Banco Safra S/A', 'Emitido em: 17/11/2026 09:56', ...nulls(10)], [null, 'CNPJ: ' + fmtCnpj(CNPJ_BANCO), periodo, ...nulls(10)], nulls(13), [titulo, ...nulls(12)], nulls(13), nulls(13)];
const CAB_REC = ['Data do Pagamento', 'Bandeira', 'Número do Cartão', 'Modalidade', 'Número Sequencial Único', 'Número de Autorização', 'Número do Terminal', 'Estabelecimento Comercial', 'Valor da Parcela', 'Taxa de Administração', 'Taxa de Antecipação', 'Valor Recebido', 'Cartão Estrangeiro'];
const rec = (dp, band, mod, nsu, aut, parcela, adm, ant, recb) => [dp, band, '************0804', mod, nsu, aut, 10848325, 1454475, parcela, adm, ant, recb, 'Não'];
const recebiveis = (linhas, periodo = 'Período de 01/01/2026 até 31/01/2026') => [...topoSafra('Recebiveis de antecipação', periodo), CAB_REC, ...linhas, ['Total', ...nulls(12)], nulls(13)];
/* Recebíveis · janeiro: 06/01 → NSU 1001 (1.000) + NSU 1002 (3 parcelas de 100, antecipadas no mesmo dia); 07/01 → NSU 1003 (débito 200) + NSU 1004 (crédito 1.000) */
const REC_JAN = [
  rec('06/01/2026', 'MASTERCARD', 'Crédito à vista', 1001, 11, 'R$ 1.000,00', '- R$ 17,50', '- R$ 4,00', 'R$ 978,50'),
  rec('06/01/2026', 'MASTERCARD', 'Crédito de 2 a 6 parcelas', 1002, 12, 'R$ 100,00', '- R$ 3,00', '- R$ 0,50', 'R$ 96,50'),
  rec('06/01/2026', 'MASTERCARD', 'Crédito de 2 a 6 parcelas', 1002, 12, 'R$ 100,00', '- R$ 3,00', '- R$ 1,60', 'R$ 95,40'),
  rec('06/01/2026', 'MASTERCARD', 'Crédito de 2 a 6 parcelas', 1002, 12, 'R$ 100,00', '- R$ 3,00', '- R$ 4,90', 'R$ 92,10'),
  rec('07/01/2026', 'VISA', 'Débito', 1003, 13, 'R$ 200,00', '- R$ 1,80', '- R$ 0,00', 'R$ 198,20'),
  rec('07/01/2026', 'VISA', 'Crédito à vista', 1004, 14, 'R$ 1.000,00', '- R$ 22,00', '- R$ 60,00', 'R$ 918,00')];
/* Recebíveis · fevereiro: as vendas de 30/01 e 31/01 liquidam em 02/02 (+ uma venda sem par na Agenda) */
const REC_FEV = [
  rec('02/02/2026', 'MASTERCARD', 'Débito', 2001, 21, 'R$ 150,00', '- R$ 1,35', '- R$ 0,00', 'R$ 148,65'),
  rec('02/02/2026', 'ELO', 'Crédito à vista', 2002, 22, 'R$ 120,00', '- R$ 2,64', '- R$ 3,20', 'R$ 114,16'),
  rec('02/02/2026', 'VISA', 'Débito', 9999, 99, 'R$ 40,00', '- R$ 0,36', '- R$ 0,00', 'R$ 39,64')];
const CAB_AG = ['Data da Venda', 'Horário', 'Bandeira / Arranjo', 'Número do Cartão', 'Modalidade', 'Tipo de Captura', 'Número do Terminal', 'Estabelecimento Comercial', 'Valor Bruto da Venda', 'Valor Líquido da Venda', 'Número Sequencial Único', 'Número de Autorização', 'Parcela'];
const ag = (dv, band, mod, nsu, aut, parcela, bruto, liq) => [dv, '10:15:00', band, '************0804', mod, 'POS', 10848325, 1454475, bruto, liq, nsu, aut, parcela];
const agenda = (linhas, periodo = 'Período de 01/01/2026 até 31/01/2026') => [...topoSafra('Agenda de Vendas', periodo), CAB_AG, ...linhas, ['Total', ...nulls(12)], nulls(13)];
/* Agenda · janeiro (venda): 8 vendas únicas, a NSU 1002 aparece em 3 linhas (uma por parcela, mesmo Valor Bruto da Venda) */
const AG_JAN = [
  ['05/01/2026', 'MASTERCARD', 'Crédito à vista', 1001, 11, '1/1', 'R$ 1.000,00', 'R$ 978,50'],
  ['05/01/2026', 'MASTERCARD', 'Crédito de 2 a 6 parcelas', 1002, 12, '1/3', 'R$ 300,00', 'R$ 284,00'],
  ['05/01/2026', 'MASTERCARD', 'Crédito de 2 a 6 parcelas', 1002, 12, '2/3', 'R$ 300,00', 'R$ 284,00'],
  ['05/01/2026', 'MASTERCARD', 'Crédito de 2 a 6 parcelas', 1002, 12, '3/3', 'R$ 300,00', 'R$ 284,00'],
  ['05/01/2026', 'ELO', 'Débito', 3001, 31, '1/1', 'R$ 80,00', 'R$ 79,28'],
  ['06/01/2026', 'VISA', 'Débito', 1003, 13, '1/1', 'R$ 200,00', 'R$ 198,20'],
  ['06/01/2026', 'VISA', 'Crédito à vista', 1004, 14, '1/1', 'R$ 1.000,00', 'R$ 918,00'],
  ['20/01/2026', 'AMEX', 'Crédito à vista', 4001, 41, '1/1', 'R$ 90,00', 'R$ 87,30'],
  ['30/01/2026', 'MASTERCARD', 'Débito', 2001, 21, '1/1', 'R$ 150,00', 'R$ 148,65'],
  ['31/01/2026', 'ELO', 'Crédito à vista', 2002, 22, '1/1', 'R$ 120,00', 'R$ 114,16']];
const AG_JAN_BRUTO = 1000 + 300 + 80 + 200 + 1000 + 90 + 150 + 120; // 2.940 — a NSU 1002 conta uma vez (300), não três
const agJan = (lista = AG_JAN) => agenda(lista.map(l => ag(...l)));

const CAB_ERP = ['Loja', 'Dt Venda', 'Dt Crédito', 'Adq', 'Descrição', 'Vda Bruta', ' MDR', 'Vda Líquida', 'Vencimento', 'Antecipação', 'Tx Extra', 'OP', 'DC'];
const er = (loja, dv, adqCod, desc, bruto, mdrV, liq, ant, op, dc) => [loja, dv, dv, adqCod, desc, bruto, mdrV, liq, dv, ant, 0, op, dc];
const ERP_LINHAS = [
  /* Getnet · Resilienza (loja 01) */
  er('01', '05/01/2026', '301', 'GETNET VISA DEBITO', 1000, 9, 991, 0, 'VE', 'DB'),
  er('01', '05/01/2026', '301', 'GETNET MASTERCARD CREDITO A VISTA', 2010, 44, 1966, 30.25, 'VE', 'CR'), // R$ 10 acima da Getnet
  er('01', '05/01/2026', '301', 'GETNET VISA CREDITO 3X', 2950, 88.5, 2861.5, 91.57, 'VE', 'CR'),
  er('01', '05/01/2026', '301', 'GETNET VISA CREDITO 3X', 50, 1.5, 48.5, 0, 'CX', 'CR'), // prestação no POS: soma com a venda
  er('01', '12/01/2026', '301', 'GETNET VISA DEBITO', 100, 0.9, 99.1, 0, 'VE', 'DB'),
  er('01', '12/01/2026', '301', 'GETNET ELO CREDITO A VISTA', 77, 1.7, 75.3, 0, 'VE', 'CR'), // só no ERP
  /* Getnet · Mar Aberto (loja 03) */
  er('03', '12/01/2026', '301', 'GETNET VISA DEBITO', 400, 3.6, 396.4, 0, 'VE', 'DB'),
  er('03', '12/01/2026', '301', 'GETNET ELO CREDITO A VISTA', 600, 13.2, 586.8, 0, 'VE', 'CR'),
  /* SafraPay (lojas 05, 28 e 31 · EC 1454475) */
  er('05', '05/01/2026', '302', 'SAFRAPAY MASTERCARD CREDITO A VISTA', 1000, 17.5, 982.5, 4, 'VE', 'CR'),
  er('28', '05/01/2026', '302', 'SAFRAPAY MASTERCARD CREDITO 3X', 300, 9, 291, 7, 'VE', 'CR'),
  er('05', '05/01/2026', '302', 'SAFRAPAY ELO CREDITO A VISTA', 80, 1.76, 78.24, 0, 'VE', 'CR'), // a Agenda diz Débito: valor fecha, modalidade não
  er('05', '06/01/2026', '302', 'SAFRAPAY VISA DEBITO', 200, 1.8, 198.2, 0, 'VE', 'DB'),
  er('31', '06/01/2026', '302', 'SAFRAPAY VISA CREDITO A VISTA', 1000, 22, 978, 60, 'VE', 'CR'),
  er('05', '07/01/2026', '302', 'SAFRAPAY VISA CREDITO A VISTA', 500, 11, 489, 0, 'VE', 'CR'), // só no ERP
  er('05', '30/01/2026', '302', 'SAFRAPAY MASTERCARD DEBITO', 150, 1.35, 148.65, 0, 'VE', 'DB'),
  er('31', '31/01/2026', '302', 'SAFRAPAY ELO CREDITO A VISTA', 120, 2.64, 117.36, 3.2, 'VE', 'CR'),
  /* fora da conciliação */
  er('01', '12/01/2026', '304', 'CREDSYSTEM CARTAO PROPRIO', 999, 0, 999, 0, 'VE', 'CR'), er('02', '13/01/2026', '304', 'CREDSYSTEM CARTAO PROPRIO', 111, 0, 111, 0, 'VE', 'CR'),
  er('01', '12/01/2026', '303', 'QR LINX PIX', 150, 0.75, 149.25, 0, 'VE', 'CR'), er('02', '12/01/2026', '372', 'CREDNOSSO CARTAO', 80, 0, 80, 0, 'VE', 'CR'),
  /* lixo que o ERP exporta: sem Loja, sem Dt Venda e o total */
  er('', '12/01/2026', '301', 'GETNET VISA DEBITO', 55, 0, 55, 0, 'VE', 'DB'), er('01', '', '301', 'GETNET VISA DEBITO', 66, 0, 66, 0, 'VE', 'DB'), ['Total', null, null, null, null, 99999, null, null, null, null, null, null, null]];
const erpRows = (linhas = ERP_LINHAS) => [['Apuração dos Créditos', ...nulls(12)], ['Período: 01/01/2026 a 31/01/2026', ...nulls(12)], nulls(13), CAB_ERP, ...linhas];
const ERP_BRUTO_GETNET_RES = 1000 + 2010 + 2950 + 50 + 100 + 77, ERP_BRUTO_GETNET_MAR = 1000, ERP_BRUTO_SAFRA = 1000 + 300 + 80 + 200 + 1000 + 500 + 150 + 120;
const ERP_BRUTO_TRI = ERP_BRUTO_GETNET_RES + ERP_BRUTO_GETNET_MAR + ERP_BRUTO_SAFRA; // 10.537: Getnet + SafraPay (os contratos do cenário)
const ERP_BRUTO_CRED = 999 + 111; // Credsystem (Adq 304): 2 linhas, 1.110 — entra no ERP gravado (v14.15.1)
const ERP_BRUTO = ERP_BRUTO_TRI + ERP_BRUTO_CRED; // 11.647, sem QR-LINX e CREDNOSSO (só informativos)

const semear = E => {
  const S = E.S;
  [regra('GETNET', 'resilienza', mdr(0.9, 2.2, 2.6, 3.0), 1.6), regra('GETNET', 'mar-aberto', mdr(0.9, 2.5, 2.6, 3.0), 2.0), regra('SAFRAPAY', 'resilienza', mdr(0.9, 2.2, 2.6, 3.0), 1.6)].forEach(r => { S.adq_taxas.set(r.id, r); });
  for (const [id, ap] of [['ct-a', 'Conta A'], ['ct-b', 'Conta B'], ['ct-c', 'Conta C']]) S.contasBancarias.set(id, { id, apelido: ap, ativa: true });
  E.bump('adq_taxas'); E.bump('contasBancarias');
};
const CT = { res: 'adq-getnet__emp-resilienza', mar: 'adq-getnet__emp-mar-aberto', saf: 'adq-safrapay__emp-resilienza' };
const cenario = async (opts = {}) => {
  const E = ambiente(opts), { Adq14, Adq15 } = E; semear(E);
  E.S.adq_contratos.set(CT.res, { id: CT.res, adquirente: 'GETNET', empresaId: 'resilienza', contaId: 'ct-a', ativo: true, lojas: ['01', '02'] });
  E.S.adq_contratos.set(CT.mar, { id: CT.mar, adquirente: 'GETNET', empresaId: 'mar-aberto', contaId: 'ct-b', ativo: true, lojas: ['03'] });
  E.S.adq_contratos.set(CT.saf, { id: CT.saf, adquirente: 'SAFRAPAY', empresaId: 'resilienza', contaId: 'ct-c', ativo: true, lojas: ['05', '28', '31'], ecs: ['1454475'] }); E.bump('adq_contratos');
  E.lido = { res: await Adq14.lerGetnetTexto(csvRes, 'res.csv'), mar: await Adq14.lerGetnetTexto(csvMar, 'mar.csv'), virada: await Adq14.lerGetnetTexto(csvVirada, 'virada.csv'),
    recJan: Adq15.lerSafraLinhasAuto(recebiveis(REC_JAN), 'Recebiveis de antecipação (jan).xlsx'), recFev: Adq15.lerSafraLinhasAuto(recebiveis(REC_FEV, 'Período de 01/02/2026 até 28/02/2026'), 'Recebiveis de antecipação (fev).xlsx'),
    agJan: Adq15.lerSafraLinhasAuto(agJan(), 'Agenda de Vendas (jan).xlsx'), erp: Adq15.lerErpLinhas(erpRows(), 'Apuração dos Créditos jan.xlsx', 'ApuraCreditos') };
  /** passa pelo mesmo caminho da tela: o botão "Gravar" decide pelo layout lido (Agenda → adq_agendas; demais → adq_lotes) */
  E.importar = async (contratoId, lido, fixo = '') => { Adq14.ui.contrato = contratoId; Adq14.ui.fixo = fixo; Adq14._ler = { contratoId, lido, val: Adq14.validarCnpj(lido, Adq14.contrato(contratoId)) }; await Adq14.gravarLote(); await espera(); };
  E.gravarErp = async (lido = E.lido.erp) => { Adq15.ui.erp = { lido }; await Adq15.gravarErp(); await espera(); };
  return E;
};
const ofx = (E, docs) => { E.S.extratos.clear(); docs.forEach(d => E.S.extratos.set(d.id, d)); E.bump('extratos'); };
const tr = (id, data, valor, hist) => ({ id, data, valor, hist });
const docOfx = (id, contaId, mes, transacoes) => ({ id, contaId, mes, transacoes });
const linhaDe = (A, id, d) => A.cruz.linhas.find(l => l.contratos.includes(id) && l.data === d);
const strip = d => { const { id, atualizadoEm, ...x } = d; return x; };
const comLotes = async (opts = {}) => {
  const E = await cenario(opts), { Adq14 } = E;
  await E.importar(CT.res, E.lido.res); await E.importar(CT.mar, E.lido.mar); await E.importar(CT.saf, E.lido.recJan);
  const cm = Adq14.calcularMes('2026-01'), res = cm.get(Adq14.idLote('GETNET', CNPJ_RES, '2026-01')), saf = cm.get(Adq14.idLote('SAFRAPAY', CNPJ_RES, '2026-01'));
  E.e06 = res.dias[0].valor; E.e13r = res.dias[1].valor; E.s06 = saf.dias[0].valor; E.s07 = saf.dias[1].valor; Adq14.ui.mes = '2026-01'; Adq14.ui.filtro = '*'; Adq14.ui.soDiv = true;
  return E;
};
const CT_CRED = 'adq-credsystem__emp-resilienza';
const erc = (loja, dv, dcr, bruto, liq, ant, tx, op, dc, cod = '304', desc = 'CREDSYSTEM CARTAO PROPRIO') => [loja, dv, dcr, cod, desc, bruto, 0, liq, dcr, ant, tx, op, dc];
/* Credsystem · janeiro/2026 (contrato da Resilienza, lojas 01 e 02, conta D):
     05/01 (seg)  400            ← Dt Crédito 05/01 · sem crédito no OFX (furo)
     12/01 (seg)  300 + 200      ← Dt Crédito sábado 10/01 passa para segunda 12/01 e soma com a Dt Crédito 12/01 · OFX: "CREDSYSTEM" 300 + "CRED SYSTEM" 200
     13/01 (ter)  1.000 + (500 − 20 − 5) − 100 (estorno DB) = 1.375 · OFX: "PIX RECEBIDO 04670195000138" 1.375
     16/01 (sex)  250            ← OFX sem nome nenhum ("TRANSFERENCIA RECEBIDA 000999"): fecha só por valor + data
     20/01 (ter)  600            ← OFX 580 (liquidado a menor)
     21/01        só estorno DB 50: líquido ≤ 0 não gera repasse esperado
     22/01 (qui)  700            ← OFX só em 26/01 (seg) = D+2 útil */
const ERP_CRED = [
  erc('01', '02/01/2026', '05/01/2026', 400, 400, 0, 0, 'VE', 'CR'),
  erc('01', '09/01/2026', '10/01/2026', 300, 300, 0, 0, 'VE', 'CR'), erc('01', '09/01/2026', '12/01/2026', 200, 200, 0, 0, 'VE', 'CR'),
  erc('01', '12/01/2026', '13/01/2026', 1000, 1000, 0, 0, 'VE', 'CR'), erc('02', '12/01/2026', '13/01/2026', 500, 500, 20, 5, 'VE', 'CR'), erc('01', '12/01/2026', '13/01/2026', 100, 100, 0, 0, 'VE', 'DB'),
  erc('02', '15/01/2026', '16/01/2026', 250, 250, 0, 0, 'VE', 'CR'),
  erc('01', '19/01/2026', '20/01/2026', 600, 600, 0, 0, 'VE', 'CR'),
  erc('01', '21/01/2026', '21/01/2026', 50, 50, 0, 0, 'VE', 'DB'),
  erc('01', '21/01/2026', '22/01/2026', 700, 700, 0, 0, 'VE', 'CR'),
  /* fora do escopo do contrato: loja 03 da Credsystem e Getnet da loja 01 */
  erc('03', '12/01/2026', '13/01/2026', 9999, 9999, 0, 0, 'VE', 'CR'), erc('01', '12/01/2026', '13/01/2026', 777, 777, 0, 0, 'VE', 'DB', '301', 'GETNET VISA DEBITO'),
  /* sem Dt Crédito (nem Vencimento): não há dia de repasse para esperar */
  ['01', '14/01/2026', '', '304', 'CREDSYSTEM CARTAO PROPRIO', 80, 0, 80, '', 0, 0, 'VE', 'CR']];
const ESP_CRED = { '2026-01-05': 400, '2026-01-12': 500, '2026-01-13': 1375, '2026-01-16': 250, '2026-01-20': 600, '2026-01-22': 700 };
const cenarioCred = async (opts = {}) => {
  const E = await cenario(opts), { Adq14, Adq15 } = E;
  E.S.contasBancarias.set('ct-d', { id: 'ct-d', apelido: 'Conta D', ativa: true }); E.bump('contasBancarias');
  E.S.adq_contratos.set(CT_CRED, { id: CT_CRED, adquirente: 'CREDSYSTEM', empresaId: 'resilienza', contaId: 'ct-d', ativo: true, lojas: ['01', '02'] }); E.bump('adq_contratos');
  E.lidoCred = Adq15.lerErpLinhas(erpRows(ERP_CRED), 'Apuração dos Créditos jan.xlsx', 'ApuraCreditos'); await E.gravarErp(E.lidoCred);
  Adq14.ui.mes = '2026-01'; Adq14.ui.filtro = '*'; Adq14.ui.soDiv = false;
  return E;
};
const OFX_CRED = [tr('c1', '2026-01-12', 300, 'CREDSYSTEM'), tr('c2', '2026-01-12', 200, 'CRED SYSTEM'), tr('c3', '2026-01-13', 1375, 'PIX RECEBIDO 04670195000138'), tr('c4', '2026-01-16', 250, 'TRANSFERENCIA RECEBIDA 000999'),
  tr('c5', '2026-01-20', 580, 'CREDSYSTEM'), tr('c6', '2026-01-26', 700, 'PIX RECEBIDO 04670195000138'), tr('c7', '2026-01-02', -15, 'TARIFA MANUTENCAO')];

/* =====================================================================
   0 · RECURSO gestao_v1417, REGRA DE OURO, ROTEADOR, MONTAGEM
   ===================================================================== */
chk('recurso gestao_v1417 (v14.17) na lista de liberação e helper g17() que depende da v14.16', /gestao_v1417: \{ versao: 'v14\.17'/.test(html) && /function g17\(\) \{ return typeof Recursos !== 'undefined' && Recursos\.ativo\('gestao_v1417'\) && g16\(\); \}/.test(html));
chk('nenhuma peça deixou marcador de montagem no painel final', !/@@V141[567]_/.test(html));
const MK_DFC = '/* ============================ DFC ============================ */', MK_PE = 'const PARTE_EXTRATO = 900;', MK_M6 = '/* =====================================================================\n   MÓDULO 6 · CREDSYSTEM';
const guardas = {
  'OFX/contas (OFX → início da DFC)': [md5(html.slice(html.indexOf('const OFX = {'), html.indexOf(MK_DFC))), 'f24c59ac5f7a2ec7544b3643a321f096'],
  'adquirentes e FCX (ADQ_CFG → PARTE_EXTRATO)': [md5(html.slice(html.indexOf('const ADQ_CFG'), html.indexOf(MK_PE))), '6a43dc199b96629c8c8af17b4016d126'],
  'Credsystem em diante (Módulo 6 → CS_INDICADORES)': [md5(html.slice(html.indexOf(MK_M6), html.indexOf('const CS_INDICADORES'))), '4738cb8f2d12cff23c6e385e573f9eae'],
};
for (const [k, [a, b]] of Object.entries(guardas)) chk(`Regra de Ouro: ${k} idêntico ao da v14.16 (md5 ${b.slice(0, 8)}…)`, a === b, a);
for (const [f, h] of [['contabilidade.html', 'a41642fb'], ['contabilidade_v1391.html', 'ea73d20b']]) {
  const p = path.join(raiz, 'public', f);
  chk(`Regra de Ouro: public/${f} idêntico ao da v14.08 (md5 ${h}…)`, fs.existsSync(p) && md5(fs.readFileSync(p)).startsWith(h));
}
/* fcx.html: ÚNICA exceção autorizada (complemento dos dois layouts do Contas a Pagar do ERP: só a importação de Saídas, atrás de gestao_v1417). O arquivo anterior tinha md5 0c13655f…; o novo é conferido aqui e,
   em detalhe, no teste-baixas-erp-layouts-1417 (cálculos, relatórios, storage e FCXAPI idênticos por região). */
chk('Regra de Ouro: public/fcx.html = v14.08 + a exceção autorizada do complemento (md5 640800e0…)', fs.existsSync(path.join(raiz, 'public', 'fcx.html')) && md5(fs.readFileSync(path.join(raiz, 'public', 'fcx.html'))).startsWith('640800e0'));
chk('roteador: as ações a17-* vão para o módulo novo, antes das a15-* e a14-*', html.indexOf('[/^a17-/, () => Adq17]') > 0 && html.indexOf('[/^a17-/, () => Adq17]') < html.indexOf('[/^a15-/, () => Adq15]') && html.indexOf('[/^a15-/, () => Adq15]') < html.indexOf('[/^a14-/, () => Adq14]'));
chk('o motor da v14.15 (Adq15.triangular) segue sendo a fonte única: o módulo novo não reimplementa o cruzamento (nenhum "calcularMes(" nem "lerErpLinhas(" dentro de ADQ17/Adq17)', !/calcularMes\(|lerErpLinhas\(|lerGetnetTexto\(/.test(adq17));

/* =====================================================================
   1 · FRENTE 1 · KPIs DE CUSTOS E TAXAS DE CARTÕES (competência 2026-01, Getnet por CNPJ + SafraPay + Credsystem)
   ===================================================================== */
const cen = async (opts = {}) => { const E = await comLotes(opts); await E.gravarErp(); await E.importar(CT.saf, E.lido.agJan); return E; };
/** OFX do cenário: Getnet/Resilienza (conta A) credita 06/01, NÃO credita 13/01 (furo de 99,10), tem aluguel de POS (30), retenção (45), tarifa de manutenção (12, não é POS) e um aluguel de POS lançado em 03/02 (fora da competência);
    SafraPay (conta C) credita 06/01 com 50 a menos e 07/01 com 20 a mais; Getnet/Mar Aberto (conta B) não tem OFX. */
const ofxPrincipal = E => ofx(E, [
  docOfx('xa', 'ct-a', '2026-01', [tr('a1', '2026-01-06', E.e06, 'CREDITO GETNET LIQUIDACAO'), tr('a3', '2026-01-20', -30, 'DEBITO ALUGUEL POS GETNET'), tr('a4', '2026-01-22', -45, 'RETENCAO ADQUIRENTE GETNET'), tr('a5', '2026-01-25', -12, 'TARIFA MANUTENCAO CONTA')]),
  docOfx('xa2', 'ct-a', '2026-02', [tr('a6', '2026-02-03', -25, 'ALUGUEL POS GETNET')]),
  docOfx('xc', 'ct-c', '2026-01', [tr('c1', '2026-01-06', r2(E.s06 - 50), 'CREDITO SAFRAPAY'), tr('c2', '2026-01-07', r2(E.s07 + 20), 'CREDITO SAFRAPAY')])]);
const PR = r => r?.repasse;
{
  const E = await cen(); ofxPrincipal(E); const { Adq14, Adq15, Adq17 } = E; Adq14.ui.mes = '2026-01'; Adq14.ui.filtro = '*';
  const I = Adq17.indicadores('2026-01', '*'), c = I.consolidado, T = Adq15.triangular('2026-01', '*'), rowOf = id => I.contratos.find(r => r.id === id);
  const R = rowOf(CT.res), M = rowOf(CT.mar), S = rowOf(CT.saf);
  chk('escopo consolidado: 3 contratos (Getnet por CNPJ × 2 e SafraPay), sem informativos de ERP além do que veio no arquivo; competência e escopo no resultado', I.contratos.length === 3 && I.mes === '2026-01' && I.filtro === '*' && /Consolidado/.test(I.escopo) && !!R && !!M && !!S);
  // --- Faturamento bruto conciliado (ERP × Adquirente)
  chk('bruto conciliado: base R$ 9.600 (Getnet Resilienza 6.100 + Mar Aberto 1.000 + SafraPay 2.500); ERP R$ 10.537 × adquirente R$ 10.040 (Getnet + Agenda SafraPay), todos os 3 contratos comparáveis', c.bruto.base === 9600 && R.bruto.base === 6100 && M.bruto.base === 1000 && S.bruto.base === 2500 && c.bruto.erp === 10537 && c.bruto.adq === 10040 && c.bruto.cmpErp === 10537 && c.bruto.cmpAdq === 10040 && c.bruto.comparaveis === 3, c.bruto);
  chk('diferença não conciliada: R$ 497,00 = 87 (Getnet Resilienza: 77 só no ERP + 10 de diferença) + 410 (SafraPay: 500 só no ERP − 90 só na Agenda) = 4,72% do bruto do ERP; divergência bruta R$ 677 em 4 dia(s)/bandeira(s)', c.bruto.difR === 497 && R.bruto.difR === 87 && S.bruto.difR === 410 && M.bruto.difR === 0 && c.bruto.difPct === 4.72 && c.bruto.vDiv === 677 && c.bruto.diasDiv === 4, [c.bruto, R.bruto.difR, S.bruto.difR]);
  // --- MDR cobrado × contratado (mesma base)
  chk('MDR Getnet Resilienza: cobrado R$ 143,90 (2,36%) × contratado R$ 131,90 (2,16%) sobre a mesma base de R$ 6.100 → R$ 12,00 a maior (+0,20 p.p.; Visa 3x a 3,00% contra 2,60% do contrato)', R.mdr.efetivoR === 143.9 && R.mdr.contratadoR === 131.9 && R.mdr.difR === 12 && R.mdr.efetivoPct === 2.36 && R.mdr.contratadoPct === 2.16 && R.mdr.difPp === 0.2 && R.mdr.aMaiorR === 12 && R.mdr.aMenorR === 0 && R.mdr.base === 6100, R.mdr);
  chk('MDR Mar Aberto: cobrado R$ 16,80 × contratado R$ 18,60 → R$ 1,80 a MENOR (Elo crédito a 2,20% contra 2,50% do contrato): a diferença a menor não é somada à a maior', M.mdr.efetivoR === 16.8 && M.mdr.contratadoR === 18.6 && M.mdr.difR === -1.8 && M.mdr.aMaiorR === 0 && M.mdr.aMenorR === -1.8, M.mdr);
  chk('MDR SafraPay: cobrado R$ 50,30 × contratado R$ 53,60 → líquido R$ 3,30 a menor, mas com R$ 1,20 a maior (Mastercard 2–6x) e R$ 4,50 a menor (Mastercard à vista) mostrados separados', S.mdr.efetivoR === 50.3 && S.mdr.contratadoR === 53.6 && S.mdr.difR === -3.3 && S.mdr.aMaiorR === 1.2 && S.mdr.aMenorR === -4.5, S.mdr);
  chk('MDR consolidado: efetivo R$ 211,00 = 2,20% do bruto; contratado R$ 204,10 (2,13%); diferença +R$ 6,90 (+0,07 p.p.); a maior R$ 13,20 e a menor −R$ 6,30; soma dos contratos = consolidado', c.mdr.efetivoR === 211 && c.mdr.efetivoPct === 2.2 && c.mdr.contratadoR === 204.1 && c.mdr.contratadoPct === 2.13 && c.mdr.difR === 6.9 && c.mdr.difPp === 0.07 && c.mdr.aMaiorR === 13.2 && c.mdr.aMenorR === -6.3 && perto(R.mdr.efetivoR + M.mdr.efetivoR + S.mdr.efetivoR, c.mdr.efetivoR), c.mdr);
  // --- Antecipação
  chk('antecipação: SafraPay R$ 71,00 (arquivo de Recebíveis, 2,84% do bruto); Getnet Resilienza R$ 121,82 (ERP: 30,25 + 91,57); Mar Aberto sem antecipação no ERP; consolidado R$ 192,82 (2,01% do bruto)', S.ant.efetivoR === 71 && S.ant.efetivoPct === 2.84 && R.ant.efetivoR === 121.82 && M.ant.efetivoR === 0 && c.ant.efetivoR === 192.82 && c.ant.efetivoPct === 2.01, [S.ant, R.ant, M.ant]);
  chk('antecipação: prazo médio antecipado em dias por contrato (Getnet Resilienza 47 · Mar Aberto 29 · SafraPay 33) e consolidado ponderado pela base antecipada (42); taxa a.m. efetiva × contratada informadas', R.ant.prazoMedio === 47 && M.ant.prazoMedio === 29 && S.ant.prazoMedio === 33 && c.ant.prazoMedio === 42 && c.ant.efetivoAm > 0 && c.ant.contratadoAm > 0, [R.ant.prazoMedio, M.ant.prazoMedio, S.ant.prazoMedio, c.ant]);
  chk('antecipação: prazo médio consolidado = média dos prazos dos contratos ponderada pela base antecipada de cada um', (() => { const L = I.contratos.filter(r => r.ant?.prazoMedio != null), b = L.reduce((s, r) => s + r.ant.baseAntecipada, 0); return Math.round(L.reduce((s, r) => s + r.ant.prazoMedio * r.ant.baseAntecipada, 0) / b) === c.ant.prazoMedio; })());
  chk('antecipação: excesso sobre o teto contratual da SafraPay (R$ 71,00 cobrados contra R$ 47,77 do contrato → R$ 42,79 de excesso somando as faixas acima); o excesso entra no ranking', S.ant.excessoR === 42.79 && S.ant.tetoR === 47.77 && c.ant.excessoR === 42.79 && I.ranking.some(x => x.tipo === 'ant' && x.valor === 42.79 && /SAFRAPAY/.test(x.contrato)), [S.ant, c.ant]);
  // --- tarifas e retenções do OFX
  chk('OFX: aluguel de POS de R$ 30,00 (20/01) é tarifa de POS; "RETENCAO ADQUIRENTE GETNET" de R$ 45,00 (22/01) é retenção bancária; "TARIFA MANUTENCAO CONTA" de R$ 12,00 NÃO é POS e fica de fora', c.tarifas.posR === 30 && c.tarifas.retencaoR === 45 && c.tarifas.itens.length === 2 && c.tarifas.itens.map(x => x.tipo + ':' + x.valor).join() === 'tarifa:30,retencao:45', c.tarifas);
  chk('OFX: tarifas e retenções entram em R$ e em % sobre o bruto (0,31% e 0,47%) e só no contrato da conta onde foram debitadas (Getnet Resilienza, conta A)', c.tarifas.posPct === 0.31 && c.tarifas.retencaoPct === 0.47 && R.tarifaR === 30 && R.retencaoR === 45 && M.tarifaR === 0 && S.tarifaR === 0 && S.retencaoR === 0, [R.tarifaR, R.retencaoR]);
  chk('OFX: o aluguel de POS lançado em 03/02 (outro mês) NÃO entra nesta competência e vira aviso (R$ 25,00 fora do mês)', c.tarifas.foraMesR === 25 && I.avisos.some(a => /25[.,]00/.test(a) && /mês seguinte/.test(a)), [c.tarifas.foraMesR, I.avisos]);
  chk('taxa efetiva total = MDR + antecipação + tarifas de POS + retenções = R$ 478,82 (4,99% do bruto), e a soma dos contratos fecha com o consolidado', c.taxa.r === 478.82 && c.taxa.pct === 4.99 && perto(c.taxa.mdrR + c.taxa.antR + c.taxa.tarifaR + c.taxa.retencaoR, c.taxa.r) && perto(I.contratos.reduce((s, r) => s + r.taxa.r, 0), c.taxa.r) && c.taxa.mdrPct === 2.2 && c.taxa.antPct === 2.01, c.taxa);
  // --- saúde do repasse bancário (OFX)
  chk('repasse: líquido esperado R$ 9.184,84 × creditado R$ 8.083,88; dias sem OFX (Mar Aberto, R$ 971,86) ficam FORA da realização: 8.083,88 ÷ 8.212,98 = 98,43%', PR(c) === c.repasse && c.repasse.esperado === 9184.84 && c.repasse.creditado === 8083.88 && c.repasse.auditavel === 8212.98 && c.repasse.realizacaoPct === 98.43 && c.repasse.semOfxR === 971.86 && c.repasse.diasSemOfx === 1, c.repasse);
  chk('repasse: furo de R$ 99,10 em 1 dia (Getnet Resilienza 13/01, sem crédito no OFX); liquidado a menor R$ 50,00 (SafraPay 06/01); a maior R$ 20,00 (SafraPay 07/01)', c.repasse.furoR === 99.1 && c.repasse.furoDias === 1 && c.repasse.menorR === 50 && c.repasse.menorDias === 1 && c.repasse.maiorR === 20 && c.repasse.maiorDias === 1 && R.repasse.furoR === 99.1 && S.repasse.menorR === 50 && S.repasse.maiorR === 20, [c.repasse, R.repasse, S.repasse]);
  chk('repasse por contrato: realização Getnet Resilienza 98,30% (5.735,18 ÷ 5.834,28) · SafraPay 98,74% (2.348,70 ÷ 2.378,70) · Mar Aberto sem OFX → realização "—" (null), 971,86 sem OFX', R.repasse.realizacaoPct === 98.3 && S.repasse.realizacaoPct === 98.74 && M.repasse.realizacaoPct === null && M.repasse.semOfxR === 971.86 && R.repasse.esperado === 5834.28 && R.repasse.creditado === 5735.18, [R.repasse, S.repasse, M.repasse]);
  chk('os números do painel são os do conciliador: esperado, creditado, furos, a menor e a maior do consolidado = Adq15.triangular(...).kpis (fonte única)', c.repasse.esperado === T.kpis.esperado && c.repasse.creditado === T.kpis.creditado && c.repasse.furoR === T.kpis.vFuro && c.repasse.menorR === T.kpis.vMenor && c.repasse.maiorR === T.kpis.vMaior && c.bruto.erp === T.kpis.brutoErp && c.bruto.adq === T.kpis.brutoAdq && c.bruto.difR === T.kpis.dif, [T.kpis]);
  chk('situação por contrato: furo/divergência de bruto/MDR a maior = crítico; só sem OFX = atenção; consolidado indica 1 dia conciliado de 5', R.situacao === 'critico' && S.situacao === 'critico' && M.situacao === 'atencao' && c.repasse.ok === 1 && c.repasse.dias === 5, [R.situacao, S.situacao, M.situacao, c.repasse.ok, c.repasse.dias]);
  // --- ranking das maiores divergências
  const rk = I.ranking;
  chk('ranking de Maiores Divergências do Mês: ordenado do maior valor para o menor (500 SafraPay só no ERP, 99,10 furo, 90, 77, 50, 42,79, 20, 12, 10, 1,20) com os 8 tipos tratados (furo, a menor, a maior, ERP × adquirente, sem adquirente, sem ERP, MDR, antecipação)', rk.map(x => x.valor).join() === '500,99.1,90,77,50,42.79,20,12,10,1.2' && ['furo', 'menor', 'maior', 'erpAdq', 'semAdq', 'semErp', 'mdr', 'ant'].every(t => rk.some(x => x.tipo === t)), rk.map(x => x.tipo + ':' + x.valor));
  chk('ranking: cada item traz tipo legível, contrato, referência (data/bandeira) e detalhe com os dois lados', rk.every(x => x.contrato && x.ref && x.desc && Adq17.ROT(x.tipo) !== x.tipo), rk[0]);
  // --- escopo por contrato: os mesmos números do contrato no consolidado
  const I1 = Adq17.indicadores('2026-01', CT.res), c1 = I1.consolidado;
  chk('escopo por contrato (Getnet Resilienza): consolidado do escopo = números do contrato (bruto 6.100, MDR 143,90, antecipação 121,82, tarifas 30 + retenção 45, repasse esperado 5.834,28)', I1.contratos.length === 1 && I1.escopo === R.rotulo && c1.bruto.base === 6100 && c1.mdr.efetivoR === 143.9 && c1.ant.efetivoR === 121.82 && c1.tarifas.posR === 30 && c1.tarifas.retencaoR === 45 && c1.repasse.esperado === 5834.28 && c1.taxa.r === r2(143.9 + 121.82 + 30 + 45), [I1.escopo, c1]);
  chk('informativos QR-LINX (R$ 150, MDR R$ 0,75 = 0,50%) e Crednosso (R$ 80) aparecem à parte, sem entrar nos totais do consolidado (bruto base R$ 9.600)', I.informativos.length === 2 && I.informativos.find(x => x.nome === 'QR-LINX')?.bruto === 150 && I.informativos.find(x => x.nome === 'QR-LINX')?.mdr === 0.75 && I.informativos.find(x => x.nome === 'QR-LINX')?.mdrPct === 0.5 && I.informativos.find(x => x.nome === 'CREDNOSSO')?.bruto === 80 && c.bruto.base === 9600, I.informativos);
  // --- memória do cálculo
  chk('o resultado é memorizado pelas versões dos dados e recalculado quando o OFX muda', (() => { const a = Adq17.indicadores('2026-01', '*'), b = Adq17.indicadores('2026-01', '*'); E.bump('extratos'); const d = Adq17.indicadores('2026-01', '*'); return a === b && d !== a && igual(d.consolidado, a.consolidado); })());
  // --- painel na tela
  E.Adq14._bancoCarga = { em: Date.now(), erros: [], nDocs: 4, nContas: 3, nTx: 9 };
  const P = Adq17.renderPainel();
  chk('tela: painel executivo com bruto conciliado, diferença, taxa efetiva, MDR efetivo × contratado, composição da taxa, saúde do repasse, comparativo por contrato e ranking', ['Painel Executivo', 'Faturamento bruto conciliado', 'Diferença não conciliada', 'Taxa efetiva total', 'MDR efetivo × contratado', 'Composição da taxa efetiva', 'Saúde do repasse bancário (OFX)', 'Furos de repasse', 'Liquidado a menor / a maior', 'Virada de mês / trânsito', 'Comparativo por contrato / adquirente', 'Maiores divergências do mês'].every(t => P.includes(t)), P.slice(0, 300));
  chk('tela: seletor de escopo (consolidado ou por contrato) e botões "Imprimir Laudo Operacional (PDF)" e exportar KPIs', P.includes('data-a="a17-filtro"') && P.includes('Todos os contratos (consolidado)') && P.includes(`value="${CT.res}"`) && P.includes('data-a="a17-laudo"') && P.includes('Imprimir Laudo Operacional (PDF)') && P.includes('data-a="a17-csv"'));
  chk('tela: o painel aparece acima da Triangulação quando o recurso está ligado (Adq15.renderTriangulo) e some quando desligado — recurso desligado = tela da v14.16', (() => { const on = E.Adq15.renderTriangulo(); const off = ambiente({ g17: false }); return on.includes('id="a17-painel"') && on.indexOf('a17-painel') < on.indexOf('Triangula') && !off.Adq15.renderTriangulo().includes('a17-painel') && off.Adq15.renderTriangulo() === off.Adq15._o17.renderTriangulo.call(off.Adq15); })());
  await E.Adq17.mudanca('a17-filtro', { value: CT.mar }); chk('mudança de escopo no seletor: o filtro da tela passa a ser o contrato escolhido', Adq14.ui.filtro === CT.mar); Adq14.ui.filtro = '*';
  Adq17.exportarCsv(); const [nomeCsv, blobCsv] = E.baixados.at(-1) || [], txtCsv = blobCsv ? await blobCsv.text() : '', bomCsv = blobCsv ? [...new Uint8Array(await blobCsv.arrayBuffer()).slice(0, 3)].join() : '';
  chk('exportar KPIs em .csv com BOM, ";" e vírgula decimal (taxa efetiva total, MDR, antecipação, repasse, ranking)', nomeCsv === 'kpis_cartoes_2026-01.csv' && bomCsv === '239,187,191' && /;Taxa efetiva total;478,82;4,99;/.test(txtCsv) && /;MDR efetivo;211;2,2;contratado 204,1 \(2,13%\)/.test(txtCsv) && /Divergência 1;/.test(txtCsv), txtCsv.slice(0, 400));
  await Adq17.acao('a17-laudo'); chk('botão "Imprimir Laudo Operacional (PDF)" abre a janela do laudo (empresa, parecer da controladoria, assinaturas) com o parecer sugerido preenchido', E.modais.at(-1)?.titulo === 'Laudo Operacional Mensal · Conciliação de Cartões' && /<textarea[^>]*name="notas"[^>]*>[^<]*Faturamento bruto R\$/.test(E.modais.at(-1).corpo) && E.modais.at(-1).acoes.some(a => a.rotulo === 'Gerar pré-visualização A4'), E.modais.at(-1)?.corpo.slice(0, 200));
}
{
  // virada de mês / trânsito: vendas de 30/01 e 31/01 liquidam juntas em 02/02 (R$ 792,80)
  const E = await cenario(); await E.importar(CT.res, E.lido.virada); await E.gravarErp(); const { Adq14, Adq17 } = E; Adq14.ui.mes = '2026-01'; Adq14.ui.filtro = '*';
  ofx(E, [docOfx('xa', 'ct-a', '2026-02', [tr('v1', '2026-02-02', 792.8, 'CREDITO GETNET LIQUIDACAO')])]);
  const I = Adq17.indicadores('2026-01', CT.res), c = I.consolidado, r = I.contratos[0];
  chk('virada de mês: R$ 792,80 (495,50 + 297,30) das vendas de 30–31/01 ficam em trânsito para 02/02 (1 dia), creditados no OFX de fevereiro; a realização de janeiro ignora o dia do mês seguinte', c.repasse.transitoR === 792.8 && c.repasse.diasTransito === 1 && r.repasse.transitoR === 792.8 && I.transito.length === 1 && I.transito[0].data === '2026-02-02' && I.transito[0].creditado === 792.8, [c.repasse, I.transito]);
  const sem = await cenario(); await sem.importar(CT.res, sem.lido.res); sem.Adq14.ui.mes = '2026-01'; sem.Adq14.ui.filtro = '*';
  chk('sem vendas de fim de mês liquidando em fevereiro o trânsito é zero', sem.Adq17.indicadores('2026-01', '*').consolidado.repasse.transitoR === 0);
}
{
  // Credsystem (ERP × OFX direto) e informativos (QR-LINX / Crednosso) no comparativo
  const E = await cenarioCred(); const { Adq14, Adq17 } = E; ofx(E, [docOfx('xd', 'ct-d', '2026-01', OFX_CRED)]); Adq14.ui.mes = '2026-01'; Adq14.ui.filtro = '*';
  const I = Adq17.indicadores('2026-01', '*'), r = I.contratos.find(x => x.id === CT_CRED), c = I.consolidado;
  chk('Credsystem entra na tabela por contrato como "ERP × OFX direto" (sem arquivo da adquirente): bruto R$ 4.100, antecipação R$ 20,00 do ERP, sem MDR', !!r && r.direto === true && r.bruto.base === 4100 && r.ant.efetivoR === 20 && r.mdr.efetivoR === 0 && r.bruto.comparavel === false, r);
  chk('Credsystem: o repasse vem do OFX pela Dt Crédito (furo de R$ 400 em 05/01; liquidado a menor de R$ 20 em 20/01) e o contrato não vira "atenção" só por não ter arquivo de adquirente', r.repasse.furoR === 400 && r.repasse.menorR === 20 && r.situacao === 'critico' && !I.avisos.some(a => /Sem arquivo da adquirente/.test(a) && /CREDSYSTEM/.test(a)), [r.repasse, I.avisos]);
}

/* =====================================================================
   2 · LAUDO OPERACIONAL MENSAL (HTML do A4) — estrutura, código de verificação, parecer editável, assinaturas, pré-visualização padrão
   ===================================================================== */
const fonteDocumento = html.slice(html.indexOf('const Documento = {'), html.indexOf('\n};\n', html.indexOf('const Documento = {')));
{
  const E = await cen(); ofxPrincipal(E); const { Adq14, Adq17 } = E; Adq14.ui.mes = '2026-01'; Adq14.ui.filtro = '*';
  const I = Adq17.indicadores('2026-01', '*'), cod = Adq17.codigoLaudo(I);
  const o = { razao: 'Resilienza Negócios Ltda', cnpj: CNPJ_RES, logo: 'data:image/png;base64,AAAA', marca: 'Esposende', emitidoEm: '17/11/2026 10:30:00', notas: 'Parecer da controladoria: MDR a maior na Getnet.\nProvidenciar contestação.', signatarios: [{ nome: 'Ana Souza', cargo: 'Gestor Financeiro' }, { nome: 'Bruno Lima', cargo: 'Controladoria', registro: 'CRC 0000' }] };
  const H = Adq17.htmlLaudo(I, o), N = s => s.replace(/\u00a0/g, ' '), Hn = N(H);
  chk('laudo — cabeçalho institucional: Empresa/Matriz, CNPJ formatado, Competência, Escopo, data/hora de emissão e Código de Verificação', ['Empresa / Matriz', 'Resilienza Negócios Ltda', fmtCnpj(CNPJ_RES), 'Competência', 'Escopo', 'Consolidado (todos os contratos / CNPJs)', '17/11/2026 10:30:00', 'Código de verificação', cod].every(t => H.includes(t)), H.slice(0, 600));
  chk('laudo — os quatro quadros e o parecer, nesta ordem: Quadro 1 (custos, taxas efetivas e antecipação), 2 (resumo por contrato/adquirente), 3 (reconciliação de repasses no OFX e furos/pendências), 4 (divergências críticas) e Parecer / Notas da Controladoria', (() => { const ps = ['Quadro 1 — Indicadores de Custos, Taxas Efetivas e Antecipação', 'Quadro 2 — Resumo Comparativo por Contrato / Adquirente', 'Quadro 3 — Reconciliação de Repasses no Extrato Bancário (OFX) e Furos / Pendências', 'Quadro 4 — Detalhamento das Divergências Críticas do Período', 'Parecer / Notas da Controladoria'].map(t => H.indexOf(t)); return ps.every(x => x > 0) && ps.every((x, i) => !i || x > ps[i - 1]); })());
  chk('laudo — Quadro 1 traz bruto conciliado, diferença não conciliada, MDR (efetivo × contratado, a maior/a menor), antecipação (prazo médio, teto e excesso), tarifas de POS, retenções e taxa efetiva total', ['R$ 9.600,00', 'R$ 497,00', '4,72%', 'R$ 211,00', 'R$ 204,10', '+0,07 p.p.', 'prazo médio 42 dia(s)', 'excesso R$ 42,79', 'R$ 30,00', 'R$ 45,00', 'R$ 478,82', '4,99%'].every(t => Hn.includes(t)), ['R$ 9.600,00', 'R$ 497,00', '4,72%', 'R$ 211,00', 'R$ 204,10', '+0,07 p.p.', 'prazo médio 42 dia(s)', 'excesso R$ 42,79', 'R$ 30,00', 'R$ 45,00', 'R$ 478,82', '4,99%'].filter(t => !Hn.includes(t)));
  chk('laudo — Quadro 2 lista cada contrato com CNPJ (Getnet Resilienza, Getnet Mar Aberto, SafraPay) e situação; Quadro 3 traz esperado × creditado, furos, a menor, a maior, sem OFX e virada de mês', ['GETNET · Resilienza', 'GETNET · Mar Aberto', 'SAFRAPAY · Resilienza', fmtCnpj(CNPJ_RES), fmtCnpj(CNPJ_MAR), 'Crítico', 'Atenção', 'Líquido esperado', 'R$ 9.184,84', 'R$ 8.083,88', 'Furos de repasse', 'R$ 99,10', 'Liquidado a menor', 'R$ 50,00', 'Liquidado a maior', 'R$ 20,00', 'Sem OFX importado na data', 'R$ 971,86', 'Valores em virada de mês / trânsito'].every(t => Hn.includes(t)));
  chk('laudo — Quadro 4: tabela numerada com tipo, contrato, referência, valor e detalhe; a 1ª linha é a maior divergência do ranking (R$ 500,00, SafraPay, 07/01/2026)', (() => { const q4 = Hn.slice(Hn.indexOf('Quadro 4 —'), Hn.indexOf('Parecer / Notas')); const m = /<tbody><tr><td>1<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><td class="n">([^<]*)<\/td>/.exec(q4); return !!m && m[1] === 'ERP sem venda na adquirente' && /SAFRAPAY/.test(m[2]) && /07\/01\/2026/.test(m[3]) && m[4] === 'R$ 500,00' && (q4.match(/<tr><td>\d+<\/td>/g) || []).length === Math.min(I.ranking.length, E.ADQ17.TOP_LAUDO); })());
  chk('laudo — parecer editável: o texto digitado entra antes das assinaturas, com quebra e escape (nada de HTML do usuário no PDF); sem texto, aparece o aviso padrão', H.includes('Parecer da controladoria: MDR a maior na Getnet.') && !Adq17.htmlLaudo(I, { ...o, notas: '<script>alert(1)</script> & "x"' }).includes('<script>') && Adq17.htmlLaudo(I, { ...o, notas: '<b>x</b>' }).includes('&lt;b&gt;x&lt;/b&gt;') && Adq17.htmlLaudo(I, { ...o, notas: '   ' }).includes('Sem notas adicionais da controladoria') && H.indexOf('Parecer da controladoria') < H.indexOf('Ana Souza'));
  chk('laudo — assinaturas: Gestor Financeiro e Controladoria com nome (e registro), em linha própria; sem nome informado aparece a linha para assinar', H.includes('Ana Souza') && H.includes('Gestor Financeiro') && H.includes('Bruno Lima') && H.includes('Controladoria · CRC 0000') && Adq17.htmlLaudo(I, { ...o, signatarios: [] }).includes('______________________________'));
  chk('laudo — código de verificação: LOP-AAAAMM-<10 caracteres>, estável (mesmos números ⇒ mesmo código), igual com outra data de emissão e outras notas, e diferente se um número muda', /^LOP-202601-[0-9A-Z]{10}$/.test(cod) && Adq17.codigoLaudo(Adq17.indicadores('2026-01', '*')) === cod && Adq17.htmlLaudo(I, { ...o, emitidoEm: 'outra', notas: 'outra' }).includes(cod) && (() => { const I2 = JSON.parse(JSON.stringify(I)); I2.consolidado.repasse.furoR += 0.01; return Adq17.codigoLaudo(I2) !== cod; })() && Adq17.codigoLaudo(Adq17.indicadores('2026-01', CT.res)) !== cod, cod);
  chk('laudo — A4 sem cortar tabelas: linhas e quadros curtos não quebram (break-inside: avoid), cabeçalho da tabela repete (table-header-group), margem de 12 mm e @page A4 no documento padrão', /table\.lop-t tr\{break-inside:avoid;\}/.test(Adq17.CSS_LAUDO) && /table\.lop-t thead\{display:table-header-group;\}/.test(Adq17.CSS_LAUDO) && /\.lop-q\.nq\{break-inside:avoid;\}/.test(Adq17.CSS_LAUDO) && /@page\{size:A4/.test(fonteDocumento) , '');
  chk('laudo — tabelas com mais de 12 linhas deixam de ser "nq" (podem quebrar entre linhas) e as menores ficam inteiras', (() => { const I2 = JSON.parse(JSON.stringify(I)); I2.contratos = Array.from({ length: 14 }, (_, i) => ({ ...I.contratos[0], id: 'c' + i, rotulo: 'Contrato ' + i })); const h = Adq17.htmlLaudo(I2, o), q2 = h.slice(h.indexOf('Quadro 2'), h.indexOf('Quadro 3')); return /<table class="lop-t"><thead>/.test(q2) && /<table class="lop-t nq"><thead>/.test(H.slice(H.indexOf('Quadro 2'), H.indexOf('Quadro 3'))); })());
  chk('laudo — rodapé identifica o painel, a competência e o código; os valores acompanham a tela', H.includes('Painel de Gestão Esposende') && H.includes('Laudo Operacional Mensal da Conciliação de Cartões') && (H.match(new RegExp(cod, 'g')) || []).length >= 2);
  // ---- gerar: validação e pré-visualização padrão (Fechar · Imprimir / Salvar PDF · Baixar PDF)
  E.form = { empresaId: 'resilienza', razao: 'R', cnpj: fmtCnpj(CNPJ_RES), notas: 'x', s1nome: '', s1cargo: '', s2nome: '', s2cargo: '' }; E.previas.length = 0; Adq17.gerarLaudo({});
  chk('gerar: Razão Social curta demais é recusada (aviso) e nada é emitido', E.previas.length === 0 && /Razão Social/.test(E.toasts.at(-1) || ''), E.toasts);
  E.form = { ...E.form, razao: 'Resilienza Negócios Ltda', cnpj: '12.345.678/0001-00' }; Adq17.gerarLaudo({});
  chk('gerar: CNPJ inválido é recusado e nada é emitido', E.previas.length === 0 && /CNPJ/.test(E.toasts.at(-1) || ''), E.toasts);
  E.form = { ...E.form, cnpj: fmtCnpj(CNPJ_RES), notas: 'a'.repeat(E.ADQ17.MAX_NOTAS + 1) }; Adq17.gerarLaudo({});
  chk(`gerar: parecer acima de ${E.ADQ17.MAX_NOTAS} caracteres é recusado`, E.previas.length === 0 && /caracteres/.test(E.toasts.at(-1) || ''), E.toasts);
  E.form = { empresaId: 'resilienza', razao: 'Resilienza Negócios Ltda', cnpj: fmtCnpj(CNPJ_RES), notas: 'Parecer final X', s1nome: 'Ana Souza', s1cargo: 'Gestor Financeiro', s2nome: 'Bruno Lima', s2cargo: 'Controladoria' }; E.audits.length = 0; Adq17.gerarLaudo({});
  const pv = E.previas.at(-1);
  chk('gerar: abre a pré-visualização padrão do painel (Documento.previa) com título da competência, corpo do laudo, CSS do A4 e nome de arquivo Laudo_Operacional_Cartoes_<marca>_<mês>', E.previas.length === 1 && /^Laudo Operacional · Conciliação de Cartões · /.test(pv.titulo) && pv.doc.corpo.includes('Quadro 4 —') && pv.doc.corpo.includes('Parecer final X') && pv.doc.corpo.includes('Ana Souza') && pv.doc.opcoes.margem === '12mm 12mm' && pv.doc.opcoes.css.includes('.lop-t') && pv.doc.opcoes.css.includes('rx-head') && /^Laudo_Operacional_Cartoes_[A-Za-z]+_2026-01$/.test(pv.nome), pv);
  chk('gerar: o laudo emitido tem o mesmo código de verificação do painel e registra a emissão na auditoria', pv.doc.corpo.includes(Adq17.codigoLaudo(Adq17.indicadores('2026-01', '*'))) && E.audits.some(a => a.acao === 'emitiu' && a.entidade === 'documento' && /Laudo Operacional/.test(a.rotulo) && a.detalhe.includes(Adq17.codigoLaudo(Adq17.indicadores('2026-01', '*')))), E.audits);
  chk('escopo por contrato: o laudo do contrato leva o rótulo do contrato como Escopo, o código muda e o nome do arquivo ganha o contrato', (() => { Adq14.ui.filtro = CT.res; E.previas.length = 0; Adq17.gerarLaudo({}); const p = E.previas.at(-1); Adq14.ui.filtro = '*'; return p && p.doc.corpo.includes('GETNET · Resilienza') && !p.doc.corpo.includes(cod) && p.nome.includes(CT.res.replace(/[^A-Za-z0-9_-]/g, '')); })());
  chk('a pré-visualização padrão do painel (Documento.previa) oferece Fechar, Imprimir / Salvar PDF e Baixar PDF — é ela que o laudo usa', /\bprevia\(/.test(fonteDocumento) && /data-prev="imprimir"/.test(fonteDocumento) && /Salvar como PDF/.test(fonteDocumento) && /data-prev="pdf">Baixar PDF/.test(fonteDocumento) && /data-x>Fechar/.test(fonteDocumento) && /Documento\.previa\(titulo, Documento\.montar\(titulo, corpo, \{ css: DFC_RESUMO\.css\(\) \+ this\.CSS_LAUDO/.test(adq17));
  chk('sem permissão (perfil sem acesso à conciliação) ou recurso desligado, o laudo não é emitido', (() => { E.previas.length = 0; E.pode = () => false; Adq17.gerarLaudo({}); E.pode = null; const off = ambiente({ g17: false }); off.Adq14.ui.mes = '2026-01'; off.Adq17.gerarLaudo({}); return E.previas.length === 0 && off.previas.length === 0; })());
}

/* =====================================================================
   AMBIENTE DO CNAB: o código REAL de OFX/DFC/PARC_PIX/CP_OFX/PrevistoFCX/CNAB17 e do bloco FluxoDFC da v14.17, com Repo/FCX de brincadeira
   ===================================================================== */
const csvCod = corta('const CSV = {', '/**\n * WhatsApp (camada Util)');
const ofxCod = corta('const OFX = {', '/* ======================= CONTAS (de-para)');
const dfcCod = corta('const DFC_GRUPOS = {', '/* ============================ IEO ============================ */');
const prevCod = corta('/** Conta contábil do FCX → categoria de saída da DFC, pelo prefixo do código', 'const Cruzamento = {');
const uiCod09 = corta('/* v14.09 · Extratos OFX × Contas a Pagar do FCX (FCX → Saídas): cruzamento na importação', '/* v14.06 · DFC · Resumo Executivo Oficial');
const motorCp = corta('/* CP_OFX:INI */', '/* CP_OFX:FIM */');
const parcCod = corta('const Parc11 = {', 'const PartesContratuais11 = {');
const cnabMotor = corta('const CNAB17 = {', '/* =====================================================================\n   v14.17 · FRENTE 2 · DESDOBRAMENTO CNAB — TELA');
const cnabTela = corta('Object.assign(FluxoDFC, {\n  _c17:', '/* ---- fim v14.17 ---- */');
const diasUteisCod = html.slice(html.indexOf('const DiasUteis = {'), html.indexOf('\n};\n', html.indexOf('const DiasUteis = {')) + 4);

/** `ext` = documentos de extrato; `saidas` = FCX → Saídas (ou null = FCX indisponível); `cfg` = config/dfc_cnab17 */
function ambienteCnab({ ext = [], saidas = [], g17 = true, cfg = null, regrasDfc = null, contas = [{ id: 'ct-a', apelido: 'Conta A', ativa: true }, { id: 'ct-b', apelido: 'Conta B', ativa: true }], pode = () => true } = {}) {
  const S = { extratos: new Map(ext.map(d => [d.id, d])), config: new Map(), contasBancarias: new Map(contas.map(c => [c.id, c])), parceiros: new Map() }, V = {}; let tic = 0; const bump = c => { V[c] = (V[c] || 0) + 1; };
  if (cfg) S.config.set('dfc_cnab17', { id: 'dfc_cnab17', ...cfg });
  if (regrasDfc) S.config.set('dfc', { id: 'dfc', regras: regrasDfc });
  const ctx = { g17, toasts: [], audits: [], bases: [], renders: 0, saidasFcx: saidas, api: { saidas: () => { ctx.lidas++; return ctx.saidasFcx; } }, apiOk: saidas !== null, lidas: 0 };
  const Repo = { prontas: new Set(Object.keys(S)), todos: c => [...(S[c] || new Map()).values()], get: (c, id) => (S[c] || new Map()).get(id) || null, versao: c => V[c] || 0,
    salvar: async (c, id, d) => { S[c].set(id, { id, ...JSON.parse(JSON.stringify(d)), atualizadoEm: 't' + (++tic) }); bump(c); ctx.salvos = (ctx.salvos || []).concat([[c, id]]); } };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const Fmt = { data: d => String(d).split('-').reverse().join('/'), brl: v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), brl0: v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) };
  const Auth = { can: k => pode(k) };
  const FluxoDFC = { ui: { mes: '2026-03' }, mesLabel: m => m, podeCruzar05: () => true, cruzarUma05: t => ({ t: { ...t }, ambigua: false }), atualizarBaseDFC: async m => { ctx.bases.push(m); },
    transacoes() { return [...S.extratos.values()].flatMap(d => (d.transacoes || []).map(t => ({ ...t, contaId: d.contaId, docId: d.id }))); },
    contas: () => [...S.contasBancarias.values()], norm: s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim(),
    esperarApi09: async () => (ctx.apiOk ? ctx.api : null) };
  const FCX = { api: () => (ctx.apiOk ? ctx.api : null), montar() { } };
  const MotorConciliacao = { somaDias: (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); } };
  const nomes = ['MotorConciliacao', 'Repo', 'g04', 'g05', 'g09', 'g11', 'g17', 'FluxoDFC', 'esc', 'Fmt', 'Auth', 'FCX', 'sleep', 'UI', 'Acesso', 'App', 'Audit', 'ContasBancarias'];
  const vals = [MotorConciliacao, Repo, () => true, () => true, () => true, () => false, () => ctx.g17, FluxoDFC, esc, Fmt, Auth, FCX, () => Promise.resolve(), { toast: m => ctx.toasts.push(m) }, { loja: () => false }, { render() { ctx.renders++; } }, { registrar: a => { ctx.audits.push(a); return Promise.resolve(); } }, { rotulo: c => c.apelido }];
  const fn = new Function(...nomes, parcCod + '\n' + csvCod + '\n' + ofxCod + '\n' + diasUteisCod + '\n' + dfcCod + '\n' + prevCod + '\n' + uiCod09 + '\n' + cnabMotor + '\n' + cnabTela + '\nreturn { CSV, OFX, DFC, PARC_PIX, CP_OFX, PrevistoFCX, DiasUteis, CNAB17, DFC_REGRAS_PADRAO };');
  const M = fn(...vals);
  Object.assign(ctx, M, { S, Repo, FluxoDFC, bump }); return ctx;
}

/* =====================================================================
   3 · FRENTE 2 · DESDOBRAMENTO SINTÉTICO DE LOTE CNAB (FCX · Fluxo de Caixa › DFC) — motor puro com o De-para real (Conta Contábil → DFC)
   ===================================================================== */
const REGRAS_CNAB = termos => [{ id: 'r-cnab', termos, sentido: 'S', categoria: 'pag_fornecedores' }];
const TERMOS_LOTE = ['PAGTO FORNECEDORES', 'REMESSA', 'CNAB', 'ARQUIVO PAG'];
const sd = (id, date, valor, fornecedor, conta, tipo = 'pago', extra = {}) => ({ id, date, valor, valorLiquido: valor, fornecedor, conta, tipo, ...extra });
const tx = (id, data, valor, hist, extra = {}) => ({ id, data, valor, hist, ...extra });
/** mês 2026-03 (Conta A): lotes CNAB em 10/03 (R$ 10.000) e 16/03 (R$ 3.000), saídas detalhadas que já consumiram os títulos s5 (casada em memória) e s6 (vínculo gravado) e uma saída de 24/03 que o usuário marca como lote */
const docCnab = (extra = []) => ({ id: 'xa', contaId: 'ct-a', mes: '2026-03', transacoes: [
  tx('e1', '2026-03-02', 50000, 'CREDITO GETNET LIQUIDACAO'),
  tx('L1', '2026-03-10', -10000, 'PAGTO FORNECEDORES ARQUIVO CNAB 001'),
  tx('d1', '2026-03-10', -1500, 'PIX ENVIADO ACME MATERIAIS LTDA'),
  tx('d2', '2026-03-11', -800, 'PIX ENVIADO XYZ SERVICOS LTDA', { cp: { id: 's6', conta: '4.09.01 – Sistemas', forn: 'XYZ Servicos Ltda', tipo: 'pago', data: '2026-03-11', via: 'exato' } }),
  tx('L2', '2026-03-16', -3000, 'REMESSA CNAB 002'),
  tx('m1', '2026-03-24', -5000, 'TRANSF DIVERSOS 0324'), ...extra], saldo: { data: '2026-03-31', valor: 123456.78 } });
const SAIDAS = [
  sd('s1', '2026-03-10', 4000, 'Imobiliaria Beira Mar Ltda', '4.10.01 – Aluguel'), sd('s2', '2026-03-10', 2500, 'Agencia Alfa Marketing', '4.33.02 – Publicidade'), sd('s3', '2026-03-10', 1800, 'Calcados Sul Ltda', '2.02.01 – Fornecedores'),
  sd('s4', '2026-03-11', 700, 'Construtora Delta', '7.20.01 – Obras'), sd('s5', '2026-03-10', 1500, 'Acme Materiais Ltda', '2.02.01 – Fornecedores'), sd('s6', '2026-03-11', 800, 'XYZ Servicos Ltda', '4.09.01 – Sistemas'),
  sd('s7', '2026-03-10', 3000, 'Fornecedor Previsto Ltda', '2.02.01 – Fornecedores', 'previsto'), sd('s8', '2026-03-20', 999, 'Fora de Prazo Ltda', '4.10.01 – Aluguel'),
  sd('t1', '2026-03-16', 2000, 'Imobiliaria Beira Mar Ltda', '4.10.01 – Aluguel'), sd('t2', '2026-03-16', 1500, 'Agencia Alfa Marketing', '4.33.02 – Publicidade'), sd('t3', '2026-03-16', 900, 'Construtora Delta', '7.20.01 – Obras'),
  sd('u1', '2026-03-24', 3500, 'Imobiliaria Beira Mar Ltda', '4.10.01 – Aluguel'), sd('u2', '2026-03-24', 1200, 'Agencia Alfa Marketing', '4.33.02 – Publicidade')];
const cnabCents = v => Math.round(v * 100);
const montaPlano = (E, o = {}) => {
  const raw = o.raw || E.FluxoDFC.transacoes(), regras = E.DFC.regras();
  return E.CNAB17.planejar({ transacoes: raw, saidas: o.saidas ?? SAIDAS, tolDias: o.tol ?? 1, modoTeto: o.modo || 'prioridade', util: iso => E.DiasUteis.util(iso), categoriaDe: conta => E.PrevistoFCX.categoriaDaConta(conta),
    categoriaValida: id => { const k = E.DFC.cat(id); return !!k && E.DFC.compativel('S', k) && !E.DFC.neutra(k); }, classificar: t => E.DFC.classificar(t, regras), dica: o.dica || null });
};
{
  const E = ambienteCnab({ ext: [docCnab()], regrasDfc: REGRAS_CNAB(TERMOS_LOTE) }), { CNAB17, DFC, FluxoDFC } = E, raw = FluxoDFC.transacoes();
  chk('motor: lote CNAB detectado pelo histórico (CNAB / PAGTO FORNECEDORES / REMESSA / ARQUIVO PAG) só quando a saída já cai em "Pagamento a fornecedores" e não tem vínculo 1 para 1; entradas, saídas comuns e saída sem texto de lote ficam de fora', (() => {
    const cls = t => DFC.classificar(t, DFC.regras()), d = t => CNAB17.detectar(t, cls);
    return d(raw.find(t => t.id === 'L1')) === 'auto' && d(raw.find(t => t.id === 'L2')) === 'auto' && d(raw.find(t => t.id === 'd1')) === '' && d(raw.find(t => t.id === 'm1')) === '' && d(raw.find(t => t.id === 'e1')) === ''
      && d({ ...raw.find(t => t.id === 'L2'), cp: { id: 's9' } }) === '' && d(tx('z', '2026-03-10', -10, 'PAGAMENTO A FORNECEDORES DIVERSOS')) === '' && CNAB17.pareceLote(tx('z', '2026-03-10', -10, 'PAGAMENTO A FORNECEDORES DIVERSOS')) === true && CNAB17.pareceLote(tx('z', '2026-03-10', 10, 'REMESSA CNAB')) === false; })());
  chk('motor: marca do usuário vale mais que o texto — isLoteCnab: true força o lote (manual); isLoteCnab: false desmarca a detecção automática; entrada nunca é lote', (() => { const cls = t => DFC.classificar(t, DFC.regras()); return CNAB17.detectar({ ...raw.find(t => t.id === 'm1'), isLoteCnab: true }, cls) === 'manual' && CNAB17.detectar({ ...raw.find(t => t.id === 'L1'), isLoteCnab: false }, cls) === '' && CNAB17.detectar({ ...raw.find(t => t.id === 'e1'), isLoteCnab: true }, cls) === ''; })());
  const P = montaPlano(E), l1 = P.porTx.get('ct-a|L1'), l2 = P.porTx.get('ct-a|L2');
  // ---- (a) consumo 1 para 1 prévio, sem duplicidade
  chk('(a) consumo 1 para 1 ANTES do lote: s6 (vínculo gravado cp da v14.09 na saída detalhada) e s5 (casada em memória com "PIX ENVIADO ACME MATERIAIS LTDA", mesmo valor e fornecedor) saem do jogo — 1 gravado + 1 em memória', P.resumo.titulosConsumidosGravados === 1 && P.resumo.titulosConsumidosMemoria === 1 && !l1.alocs.some(a => ['s5', 's6'].includes(a.x.id)) && !l2.alocs.some(a => ['s5', 's6'].includes(a.x.id)), P.resumo);
  chk('(a) sem as saídas detalhadas (s5 e s6 ainda "livres"), o mesmo lote os consumiria — a prova de que o consumo prévio evita contar o título duas vezes', (() => { const semDet = montaPlano(E, { raw: raw.filter(t => !['d1', 'd2'].includes(t.id)) }), L = semDet.porTx.get('ct-a|L1'); return L.alocs.some(a => a.x.id === 's5') && semDet.resumo.titulosConsumidosGravados === 0 && semDet.resumo.titulosConsumidosMemoria === 0; })());
  chk('(a) nenhum título é contado duas vezes: somando os lotes, cada título recebe no máximo o próprio valor (também com dois lotes no mesmo dia dividindo os mesmos títulos)', (() => {
    const dois = [...raw, tx('LB', '2026-03-10', -6000, 'REMESSA CNAB 003', { contaId: 'ct-b' })].map(t => ({ ...t, contaId: t.contaId || 'ct-a' })), Q = montaPlano(E, { raw: dois }), usado = new Map();
    Q.lotes.forEach(l => l.alocs.forEach(a => usado.set(a.x.id, (usado.get(a.x.id) || 0) + a.cents)));
    return Q.lotes.length === 3 && [...usado].every(([id, c]) => c <= cnabCents(SAIDAS.find(s => s.id === id).valor)) && Q.lotes.every(l => l.aloc <= l.cap); })());
  chk('só títulos "Pago" entram (o Previsto de R$ 3.000 e o Pago fora da tolerância, de 20/03, ficam de fora) e o dia exato vem antes do dia seguinte', !l1.alocs.some(a => ['s7', 's8'].includes(a.x.id)) && l1.alocs.map(a => a.x.id).join() === 's1,s2,s3,s4', l1.alocs.map(a => a.x.id));
  // ---- (b) realocação para Aluguel / Marketing abatendo Pagamento a fornecedores
  const porCat = l => Object.fromEntries(l.cats.map(g => [g.cat, g.cents / 100]));
  chk('(b) realocação por Categoria DFC pelo De-para (Conta Contábil → FCX → DFC): Aluguel R$ 4.000 (pag_ocupacao), Marketing R$ 2.500 (pag_marketing) e Obras R$ 700 (inv_capex); o título de fornecedor (R$ 1.800) fica em Pagamento a fornecedores', igual(porCat(l1), { pag_ocupacao: 4000, pag_marketing: 2500, inv_capex: 700 }) && l1.forn.cents === 180000 && l1.forn.n === 1 && l1.realocado === 720000 && l1.titulosN === 4, [porCat(l1), l1.forn, l1.realocado]);
  chk('(b) o lote de R$ 10.000 vira: Aluguel 4.000 + Marketing 2.500 + Obras 700 + o RESTO de R$ 2.800 em Pagamento a fornecedores (fornecedores 1.800 + não explicado 1.000) — abatido exatamente do que foi realocado (R$ 7.200)', l1.resto === 280000 && l1.cap === 1000000 && l1.cap - l1.realocado === l1.resto, [l1.resto, l1.cap]);
  const exp = CNAB17.expandir(raw, P), filhosL1 = exp.filter(t => String(t.id).startsWith('L1#c17:'));
  chk('(b) a lista virtual troca L1 por 4 filhos (um por categoria + o resto) com a soma EXATA do lote (−R$ 10.000,00); o resto não leva categoria manual (a regra o classifica em Pagamento a fornecedores)', filhosL1.length === 4 && cnabCents(filhosL1.reduce((s, t) => s + t.valor, 0)) === -1000000 && igual(filhosL1.filter(t => t.cat).map(t => [t.cat, t.valor]).sort(), [['inv_capex', -700], ['pag_marketing', -2500], ['pag_ocupacao', -4000]].sort()) && filhosL1.some(t => String(t.id).endsWith('#c17:resto') && t.valor === -2800 && !t.cat) && !exp.some(t => t.id === 'L1'), filhosL1);
  chk('(b) na DFC: Pagamento a fornecedores cai exatamente R$ 10.100 (7.200 do lote de 10/03 + 2.900 do de 16/03), Aluguel (6.000), Marketing (2.500) e Obras (1.600) aparecem com os valores dos títulos; o total de saídas do mês é o mesmo', (() => {
        const A = DFC.consolidar(raw, DFC.regras()), B = DFC.consolidar(exp, DFC.regras()), v = (c, k) => c.porCategoria[k]?.valor ?? 0;
    // L1 realoca 7.200 e L2 realoca 2.900 (2.000 aluguel + 900 obras): ao todo 10.100 saem de fornecedores
    return perto(v(B, 'pag_ocupacao'), -(4000 + 2000)) && perto(v(B, 'pag_marketing'), -2500) && perto(v(B, 'inv_capex'), -(700 + 900)) && perto(v(B, 'pag_fornecedores') - v(A, 'pag_fornecedores'), 7200 + 2900) && perto(A.saidas, B.saidas); })(), '');
  // ---- (c) preservação exata das saídas do OFX e trava de teto
  chk('(c) o extrato é preservado: total das saídas e total geral da lista virtual idênticos ao do banco, em centavos, também por conta e por dia (prova de integridade do plano)', P.integridade.ok === true && P.integridade.dif === 0 && P.integridade.difs.length === 0 && P.integridade.totalExtrato === P.integridade.totalDfc && cnabCents(exp.reduce((s, t) => s + t.valor, 0)) === cnabCents(raw.reduce((s, t) => s + t.valor, 0)) && cnabCents(exp.filter(t => t.valor < 0).reduce((s, t) => s + t.valor, 0)) === cnabCents(raw.filter(t => t.valor < 0).reduce((s, t) => s + t.valor, 0)), P.integridade);
  chk('(c) a prova detecta qualquer diferença (centavo a menos num filho, dia trocado ou lançamento sumido) e então o painel desliga o desdobramento daquele cálculo', (() => { const e2 = exp.map(t => String(t.id) === 'L1#c17:resto' ? { ...t, valor: t.valor + 0.01 } : t), e3 = exp.map(t => String(t.id) === 'L2#c17:resto' ? { ...t, data: '2026-03-17' } : t), e4 = exp.filter(t => t.id !== 'e1'); return !CNAB17.verificar(raw, e2).ok && !CNAB17.verificar(raw, e3).ok && !CNAB17.verificar(raw, e4).ok && CNAB17.verificar(raw, exp).ok; })());
  chk('(c) trava de teto: L2 (R$ 3.000) com títulos de R$ 2.000 + 1.500 + 900 = 4.400 no dia — por prioridade (maior valor primeiro) leva 2.000 e 900 (R$ 2.900 ≤ 3.000); o de 1.500 não cabe inteiro e fica de fora', l2.aloc === 290000 && l2.alocs.map(a => a.x.id).join() === 't1,t3' && l2.aloc <= l2.cap && igual(porCat(l2), { pag_ocupacao: 2000, inv_capex: 900 }) && l2.resto === 10000 && l2.excedente.cents === 150000 && l2.excedente.n === 1 && l2.excedente.titulos[0].id === 't2', [l2.aloc, l2.alocs.map(a => a.x.id), l2.excedente]);
  chk('(c) alerta de auditoria "Excedente Contas a Pagar sem cobertura CNAB no dia" com o lote, a data, o valor (R$ 1.500) e o título que ficou de fora; lote sem nenhum título gera o alerta próprio', (() => { const a = P.alertas.find(x => x.tipo === 'excedente'); return !!a && a.msg === 'Excedente Contas a Pagar sem cobertura CNAB no dia' && a.msg === CNAB17.ROT_EXCEDENTE && a.id === 'L2' && a.data === '2026-03-16' && a.valor === 1500 && a.lote === 3000 && a.titulos[0].id === 't2' && P.alertas.filter(x => x.tipo === 'excedente').length === 1 && P.resumo.excedente === 1500 && P.resumo.nExcedente === 1; })());
  chk('(c) total desdobrado de cada lote nunca passa do valor do lote, e o realocado + resto reconstitui exatamente o lote (em centavos)', P.lotes.every(l => l.aloc <= l.cap && l.realocado + l.resto === l.cap));
  chk('resumo do plano: 2 lotes (auto), 2 desdobrados, 6 títulos (4 + 2), R$ 10.100 realocados, R$ 11.900 explicados, R$ 13.000 em lotes', P.resumo.nLotes === 2 && P.resumo.auto === 2 && P.resumo.manual === 0 && P.resumo.nDesdobrados === 2 && P.resumo.titulosDesdobrados === 6 && P.resumo.valorRealocado === 10100 && P.resumo.valorExplicado === 11900 && P.resumo.valorLotes === 13000, P.resumo);
  // ---- modo proporcional, tolerância e prioridade do dia exato
  const Pp = montaPlano(E, { tol: 0, modo: 'proporcional' }), q2 = Pp.porTx.get('ct-a|L2');
  chk('trava de teto no modo proporcional: o lote de R$ 3.000 é rateado em proporção aos três títulos (soma exatamente R$ 3.000, sem sobra de centavo) e a parte dos títulos acima do lote vira excedente (R$ 1.400)', q2.aloc === 300000 && q2.alocs.length === 3 && q2.alocs.every(a => a.cents <= cnabCents(SAIDAS.find(s => s.id === a.x.id).valor)) && q2.realocado === 300000 && q2.resto === 0 && q2.excedente.cents === 140000 && Pp.integridade.ok, [q2.aloc, q2.alocs.map(a => [a.x.id, a.cents]), q2.excedente]);
  chk('tolerância configurável: ±0 dia só usa o mesmo dia (o título de 11/03 e o de 20/03 não entram em L1: R$ 8.300 explicados); ±1 dia útil inclui 11/03; ±3 é o máximo', (() => { const P0 = montaPlano(E, { tol: 0 }), P1 = montaPlano(E, { tol: 1 }), P9 = montaPlano(E, { tol: 9 }); return P0.porTx.get('ct-a|L1').aloc === 830000 && P0.tolDias === 0 && P1.porTx.get('ct-a|L1').aloc === 900000 && P1.tolDias === 1 && P9.tolDias === 3; })());
  chk('o título de dia útil seguinte conta como ±1 dia útil, inclusive sábado para sexta (o banco paga na segunda): lote de sexta 13/03 puxa o título de sábado 14/03 e não o de terça 17/03', (() => { const L = [tx('LF', '2026-03-13', -2000, 'REMESSA CNAB 009')], S = [sd('w1', '2026-03-14', 800, 'Imobiliaria Beira Mar Ltda', '4.10.01 – Aluguel'), sd('w2', '2026-03-17', 600, 'Agencia Alfa Marketing', '4.33.02 – Publicidade')], Pw = montaPlano(E, { raw: L.map(t => ({ ...t, contaId: 'ct-a' })), saidas: S }); return Pw.porTx.get('ct-a|LF').alocs.map(a => a.x.id).join() === 'w1'; })());
  chk('dia exato tem prioridade sobre ±1 dia (modo por prioridade): com teto de R$ 2.600, o título do mesmo dia (R$ 1.000) é atendido antes do de R$ 2.500 do dia seguinte, que fica como excedente', (() => { const Pw = montaPlano(E, { raw: [{ ...tx('LP', '2026-03-10', -2600, 'REMESSA CNAB 010'), contaId: 'ct-a' }], saidas: [sd('p1', '2026-03-10', 1000, 'Imobiliaria Beira Mar Ltda', '4.10.01 – Aluguel'), sd('p2', '2026-03-11', 2500, 'Agencia Alfa Marketing', '4.33.02 – Publicidade')] }), l = Pw.porTx.get('ct-a|LP'); return l.alocs.map(a => a.x.id).join() === 'p1' && l.excedente.titulos.map(x => x.id).join() === 'p2' && l.excedente.cents === 250000; })());
  chk('dica pelo texto do título/forma de pagamento: com dois lotes no mesmo dia (contas A e B) e dois títulos iguais, cada lote leva o título cujo texto cita a própria conta', (() => { const raw2 = [{ ...tx('La', '2026-03-10', -2000, 'REMESSA CNAB 011'), contaId: 'ct-a' }, { ...tx('Lb', '2026-03-10', -2000, 'REMESSA CNAB 012'), contaId: 'ct-b' }], S = [sd('x1', '2026-03-10', 2000, 'Imobiliaria Beira Mar Ltda', '4.10.01 – Aluguel', 'pago', { obs: 'pago pela Conta B' }), sd('x2', '2026-03-10', 2000, 'Agencia Alfa Marketing', '4.33.02 – Publicidade', 'pago', { obs: 'pago pela Conta A' })];
    const dica = (s, t) => E.FluxoDFC.norm(s.obs).includes(E.FluxoDFC.norm(t.contaId === 'ct-a' ? 'Conta A' : 'Conta B')), com = montaPlano(E, { raw: raw2, saidas: S, dica }), sem = montaPlano(E, { raw: raw2, saidas: S });
    return com.porTx.get('ct-a|La').alocs[0].x.id === 'x2' && com.porTx.get('ct-b|Lb').alocs[0].x.id === 'x1' && sem.porTx.get('ct-a|La').alocs[0].x.id === 'x1'; })());
  chk('lote sem nenhum título Pago no dia: nada é desdobrado (valor segue inteiro em Pagamento a fornecedores) e sai o alerta "sem títulos"; sem as saídas do FCX (lista vazia) não há alerta', (() => { const raw3 = [{ ...tx('LZ', '2026-03-05', -700, 'REMESSA CNAB 013'), contaId: 'ct-a' }], a = montaPlano(E, { raw: raw3, saidas: SAIDAS }), b = montaPlano(E, { raw: raw3, saidas: [] }); return a.aplicaveis.length === 0 && CNAB17.expandir(raw3, a).length === 1 && a.alertas.some(x => x.tipo === 'sem_titulos' && x.id === 'LZ') && b.alertas.length === 0 && b.resumo.saidasFcx === 0; })());
  chk('valor líquido do título (valorLiquido) é o que sai do caixa; centavos quebrados e títulos com valor zero não geram filhos com resto negativo', (() => { const Pw = montaPlano(E, { raw: [{ ...tx('LC', '2026-03-10', -1000.1, 'REMESSA CNAB 014'), contaId: 'ct-a' }], saidas: [sd('c1', '2026-03-10', 500.05, 'Imobiliaria Beira Mar Ltda', '4.10.01 – Aluguel', 'pago', { valorLiquido: 400.03 }), sd('c2', '2026-03-10', 0, 'Agencia Alfa Marketing', '4.33.02 – Publicidade')] }), l = Pw.porTx.get('ct-a|LC'), e = CNAB17.expandir([{ ...tx('LC', '2026-03-10', -1000.1, 'REMESSA CNAB 014'), contaId: 'ct-a' }], Pw); return l.aloc === 40003 && l.resto === 100010 - 40003 && Pw.integridade.ok && e.every(t => t.valor < 0); })());
}
{
  // marca do usuário: saída de 24/03 (R$ 5.000, sem texto de lote) vira lote CNAB manual; desmarcar L1 devolve o valor a Pagamento a fornecedores
  const E = ambienteCnab({ ext: [docCnab([])], regrasDfc: REGRAS_CNAB(TERMOS_LOTE) }), { CNAB17, DFC } = E;
  const comMarca = (id, v) => { const d = docCnab(); d.transacoes = d.transacoes.map(t => t.id === id ? (v === null ? (({ isLoteCnab, ...r }) => r)(t) : { ...t, isLoteCnab: v }) : t); return d; };
  const rawM = (id, v) => comMarca(id, v).transacoes.map(t => ({ ...t, contaId: 'ct-a', docId: 'xa' }));
  const P = montaPlano(E, { raw: rawM('m1', true) }), m1 = P.porTx.get('ct-a|m1');
  chk('marcar uma saída como Lote CNAB (isLoteCnab: true): vira lote "manual" e é desdobrada pelos títulos Pago de 24/03 (Aluguel R$ 3.500 + Marketing R$ 1.200 = R$ 4.700); o resto de R$ 300 volta para Pagamento a fornecedores', m1 && m1.como === 'manual' && m1.aloc === 470000 && m1.resto === 30000 && P.resumo.manual === 1 && igual(Object.fromEntries(m1.cats.map(g => [g.cat, g.cents / 100])), { pag_ocupacao: 3500, pag_marketing: 1200 }), [m1?.como, m1?.aloc, m1?.resto]);
  chk('o resto do lote manual leva a categoria Pagamento a fornecedores explícita (a saída sem texto de lote cairia em "Outras saídas"); o total do extrato segue idêntico', (() => { const exp = CNAB17.expandir(rawM('m1', true), P), r = exp.find(t => t.id === 'm1#c17:resto'); return r && r.cat === 'pag_fornecedores' && r.valor === -300 && P.integridade.ok; })());
  const Pd = montaPlano(E, { raw: rawM('L1', false) });
  chk('desmarcar (isLoteCnab: false) um lote detectado automaticamente: L1 deixa de ser lote, volta inteiro como pagamento comum e os títulos livres de 10/03 podem ser usados por outro lote', !Pd.porTx.has('ct-a|L1') && Pd.resumo.nLotes === 1 && CNAB17.expandir(rawM('L1', false), Pd).some(t => t.id === 'L1' && t.valor === -10000) && Pd.integridade.ok);
  chk('voltar à detecção automática (propriedade removida) restaura o lote L1', montaPlano(E, { raw: rawM('L1', null) }).porTx.has('ct-a|L1') && montaPlano(E, { raw: rawM('L1', true) }).porTx.get('ct-a|L1').como === 'manual');
}

/* =====================================================================
   4 · FluxoDFC (código REAL da v14.17): Extratos OFX, DFC do mês, base mensal — leitura do Contas a Pagar, plano memorizado, marcar/desmarcar, Recalcular, configuração
   ===================================================================== */
const baseCnab = (o = {}) => ({ ext: [docCnab()], saidas: SAIDAS, regrasDfc: REGRAS_CNAB(TERMOS_LOTE), ...o });
const docsJson = E => JSON.stringify([...E.S.extratos.values()].map(d => ({ ...d, atualizadoEm: undefined })));
const N$ = s => String(s).replace(/ /g, ' ');
{
  const E = ambienteCnab(baseCnab()), F = E.FluxoDFC, { DFC } = E, antes = docsJson(E), rawAntes = JSON.stringify(F.transacoes());
  chk('antes de ler o Contas a Pagar do FCX a DFC usa o extrato como está (plano nulo) e a leitura dispara sozinha, uma só vez', F.planoCnab17() === null && F.trDFC().length === F.transacoes().length && (await F.garantirCnab17(), E.lidas === 1) && (F.planoCnab17(), F.planoCnab17(), E.lidas === 1));
  const p = F.planoCnab17(), raw = F.transacoes(), vir = F.trDFC();
  chk('com as saídas do FCX lidas: a DFC passa a ler a lista virtual — L1 vira 4 filhos e L2 vira 3 (Aluguel 2.000, Obras 900 e o resto de R$ 100): 6 lançamentos viram 11, e o extrato bruto continua com os 6', !!p && raw.length === 6 && vir.length === 11 && vir.filter(t => /^L1#c17:/.test(t.id)).length === 4 && vir.filter(t => /^L2#c17:/.test(t.id)).length === 3 && raw.some(t => t.id === 'L1') && !vir.some(t => t.id === 'L1' || t.id === 'L2'), [raw.length, vir.length]);
  chk('o extrato fica exatamente como o banco mandou: documentos gravados, lançamentos e saldo final idênticos antes e depois (a aba Extratos OFX lê o bruto)', docsJson(E) === antes && JSON.stringify(F.transacoes()) === rawAntes && E.S.extratos.get('xa').saldo.valor === 123456.78 && !('cnab17' in raw.find(t => t.id === 'L1')));
  const A = DFC.consolidar(raw), B = DFC.consolidar(vir);
  chk('DFC do mês: total de saídas, total de entradas, resultado, saídas por conta e por dia IDÊNTICOS ao do extrato; só a distribuição por categoria muda (Aluguel R$ 6.000, Marketing R$ 2.500, Obras R$ 1.600)', perto(A.saidas, B.saidas) && perto(A.entradas, B.entradas) && perto(A.liquido, B.liquido) && igual(A.porConta, B.porConta) && igual(A.porDia, B.porDia) && perto(B.porCategoria.pag_ocupacao.valor, -6000) && perto(B.porCategoria.pag_marketing.valor, -2500) && perto(B.porCategoria.inv_capex.valor, -1600) && !A.porCategoria.pag_ocupacao, [A.saidas, B.saidas]);
  chk('o plano é memorizado pelas versões dos dados (mesma referência) e refeito quando o extrato ou a configuração mudam', F.planoCnab17() === p && (E.bump('extratos'), F.planoCnab17() !== p));
  chk('integridade do plano na tela: conferência com total do extrato = total da DFC, e a lista virtual só é usada quando a prova fecha', F.planoCnab17().integridade.ok && F.transacoesDFC().length === 11);
  // ---- linha do extrato: selo, detalhe expansível e botão
  const L1 = raw.find(t => t.id === 'L1'), L2 = raw.find(t => t.id === 'L2'), M1 = raw.find(t => t.id === 'm1'), D1 = raw.find(t => t.id === 'd1'), E1 = raw.find(t => t.id === 'e1');
  const h1 = N$(F.linhaCnab17(L1)), h2 = N$(F.linhaCnab17(L2)), hm = F.linhaCnab17(M1);
  chk('Extratos OFX: o lote traz o selo "Desdobrado via Contas a Pagar: 4 títulos · R$ 7.200,00 realocados de Fornecedores", o detalhe expansível por categoria e título (fornecedor, conta, data), o resto em Fornecedores e o total do lote no extrato', h1.includes('Desdobrado via Contas a Pagar: 4 títulos · R$ 7.200,00 realocados de Fornecedores') && h1.includes('<details') && h1.includes('Aluguel, condomínio e ocupação') && h1.includes('Marketing e publicidade') && h1.includes('Obras, equipamentos e imobilizado') && h1.includes('Imobiliaria Beira Mar Ltda') && h1.includes('Permanece em Pagamento a fornecedores') && h1.includes('R$ 2.800,00') && h1.includes('Lote no extrato') && h1.includes('R$ 10.000,00') && h1.includes('detectado pelo histórico'), h1.slice(0, 400));
  chk('Extratos OFX: botão "Não é lote CNAB" no lote detectado (data-v=0), "Marcar como Lote CNAB" nas outras saídas (data-v=1) e nada em entradas; o lote com excedente mostra o alerta com o valor', h1.includes('data-a="fd-cnab-marcar" data-doc="xa" data-id="L1" data-v="0"') && h1.includes('Não é lote CNAB') && hm.includes('Marcar como Lote CNAB') && hm.includes('data-id="m1" data-v="1"') && F.linhaCnab17(D1).includes('Marcar como Lote CNAB') && F.linhaCnab17(E1) === '' && h2.includes('Excedente Contas a Pagar sem cobertura CNAB no dia: R$ 1.500,00 (1 título)'), h2.slice(0, 500));
  chk('sem permissão para importar extratos (fcx.dfc.importar) a linha mostra o selo mas não oferece os botões', (() => { const S = ambienteCnab(baseCnab({ pode: k => k !== 'fcx.dfc.importar' })); return S.FluxoDFC.garantirCnab17().then(() => { const t = S.FluxoDFC.transacoes().find(x => x.id === 'L1'), h = S.FluxoDFC.linhaCnab17(t); return h.includes('Desdobrado via Contas a Pagar') && !h.includes('data-a="fd-cnab-marcar"') && !S.FluxoDFC.linhaCnab17(S.FluxoDFC.transacoes().find(x => x.id === 'm1')).includes('data-a'); }); })() instanceof Promise);
  // ---- painel do mês e botão de recálculo
  F.ui.mes = '2026-03'; const ph = N$(F.painelCnab17());
  chk('painel do mês: "Desdobramento de lotes CNAB" com 2 lotes, 2 desdobrados, R$ 10.100,00 realocados, alerta de excedente, conferência extrato = DFC e os controles de tolerância e de teto', ph.includes('Desdobramento de lotes CNAB') && ph.includes('2 lote(s)') && ph.includes('2 desdobrado(s)') && ph.includes('R$ 10.100,00') && ph.includes('excedente sem cobertura') && ph.includes('Excedente Contas a Pagar sem cobertura CNAB no dia') && ph.includes('Conferência: total do extrato') && ph.includes('data-a="fd-cnab-cfg" data-k="tol"') && ph.includes('data-a="fd-cnab-cfg" data-k="modo"') && ph.includes('Abater proporcionalmente'), ph.slice(0, 500));
  chk('painel: mês sem lote CNAB não mostra o painel; o botão "Recalcular Desdobramento CNAB" fica ao lado do filtro de mês, só com o recurso ligado', (() => { F.ui.mes = '2026-04'; const vazio = F.painelCnab17(); F.ui.mes = '2026-03'; return vazio === '' && F.botaoCnab17().includes('Recalcular Desdobramento CNAB') && F.botaoCnab17().includes('data-a="fd-cnab-recalcular"') && ambienteCnab(baseCnab({ g17: false })).FluxoDFC.botaoCnab17() === ''; })());
  chk('o botão está na barra do filtro de Mês (logo depois do seletor), o painel entra acima das abas e a aba Extratos OFX continua lendo o extrato bruto (this.transacoes()) com o selo por linha', /<\/select><\/div>\$\{g17\(\) \? this\.botaoCnab17\(\) : ''\}<\/div>/.test(html) && /return topo \+ \(comMes && g17\(\) \? this\.painelCnab17\(\) : ''\) \+ corpo\(\);/.test(html) && (() => { const ex = corta('  renderExtratos() {', "${g17() ? this.linhaCnab17(t) : ''}"); return ex.includes('this.transacoes()') && !ex.includes('trDFC'); })());
  chk('os seis consumidores da DFC (base mensal dfc/AAAA-MM, DFC do mês, Realizado × Previsto, Resumo Executivo Oficial e as duas leituras da v14.06/v14.17) leem trDFC(); só o bruto fica em transacoes()', (html.match(/(?:FluxoDFC|this)\.trDFC\(\)/g) || []).length === 6 && /async atualizarBaseDFC\(meses\) \{[\s\S]{0,400}this\.trDFC\(\)/.test(html) && /if \(g17\(\)\) await this\.garantirCnab17\(\);/.test(html));
}
{
  // recurso desligado ≡ v14.16
  const E = ambienteCnab(baseCnab({ g17: false })), F = E.FluxoDFC;
  chk('recurso desligado: a DFC lê o extrato como está, sem plano, sem painel, sem botão, sem linha por lançamento e sem ler o Contas a Pagar (= v14.16)', F.trDFC().length === 6 && JSON.stringify(F.trDFC()) === JSON.stringify(F.transacoes()) && F.planoCnab17() === null && F.painelCnab17() === '' && F.botaoCnab17() === '' && F.linhaCnab17(F.transacoes()[1]) === '' && (await F.garantirCnab17()) === null && E.lidas === 0 && F.podeCnab17() === false);
}
{
  // Contas a Pagar do FCX indisponível: nada é desfeito, a DFC segue com os lotes inteiros e a tela explica
  const E = ambienteCnab(baseCnab({ saidas: null })), F = E.FluxoDFC, antes = docsJson(E); F.ui.mes = '2026-03';
  await F.garantirCnab17();
  chk('FCX indisponível: a DFC segue com os lotes inteiros em Pagamento a fornecedores (lista idêntica ao extrato), o extrato não muda e o painel explica o motivo e oferece Recalcular', F.planoCnab17() === null && F.trDFC().length === 6 && docsJson(E) === antes && /Contas a Pagar do FCX não está disponível/.test(F.painelCnab17()) && /Recalcular Desdobramento CNAB/.test(F.painelCnab17()), F.painelCnab17());
  E.apiOk = true; E.saidasFcx = SAIDAS; await F.recalcularCnab17();
  chk('quando o FCX volta, "Recalcular Desdobramento CNAB" relê o Contas a Pagar, refaz o plano, regrava a base do mês e avisa quantos lotes foram desdobrados', !!F.planoCnab17() && F.trDFC().length === 11 && E.bases.some(m => m.includes('2026-03')) && E.toasts.some(m => /Desdobramento recalculado: 2 de 2 lote\(s\) desdobrado\(s\)/.test(m)) && E.audits.some(a => a.rotulo === 'Recalcular Desdobramento CNAB' && /2 lote\(s\)/.test(a.detalhe)), [E.toasts, E.audits]);
}
{
  // marcar / desmarcar no extrato, com reflexo imediato na DFC
  const E = ambienteCnab(baseCnab()), F = E.FluxoDFC; await F.garantirCnab17(); F.ui.mes = '2026-03';
  const m1 = () => E.S.extratos.get('xa').transacoes.find(t => t.id === 'm1'), l1 = () => E.S.extratos.get('xa').transacoes.find(t => t.id === 'L1');
  const virtual = () => F.trDFC().map(t => t.id).join();
  chk('marcar como Lote CNAB (m1, R$ 5.000 sem texto de lote): grava isLoteCnab no lançamento do extrato, regrava a base do mês e a DFC já mostra Aluguel R$ 3.500 e Marketing R$ 1.200 do dia 24/03', await (async () => { E.bases.length = 0; await F.marcarLote17('xa', 'm1', true); const B = DFC => DFC.consolidar(F.trDFC()); return m1().isLoteCnab === true && E.bases.length === 1 && E.bases[0].join() === '2026-03' && /m1#c17:resto/.test(virtual()) && perto(B(E.DFC).porCategoria.pag_ocupacao.valor, -(4000 + 2000 + 3500)) && perto(B(E.DFC).porCategoria.pag_marketing.valor, -(2500 + 1200)) && F.planoCnab17().resumo.manual === 1 && E.renders > 0; })());
  chk('o saldo e as saídas do banco seguem idênticos depois de marcar (prova do plano) e o selo da linha passa a dizer "marcado"', F.planoCnab17().integridade.ok && N$(F.linhaCnab17(F.transacoes().find(t => t.id === 'm1'))).includes('marcado') && N$(F.linhaCnab17(F.transacoes().find(t => t.id === 'm1'))).includes('Desmarcar Lote CNAB') && E.S.extratos.get('xa').saldo.valor === 123456.78);
  chk('desmarcar (valor nulo) remove a marca e a DFC volta ao que era; "não é lote CNAB" (false) desfaz o lote L1 detectado e o valor volta inteiro para Pagamento a fornecedores', await (async () => { await F.marcarLote17('xa', 'm1', null); const sem = !('isLoteCnab' in m1()) && !/m1#c17/.test(virtual()); await F.marcarLote17('xa', 'L1', false); return sem && l1().isLoteCnab === false && !/L1#c17/.test(virtual()) && F.trDFC().some(t => t.id === 'L1' && t.valor === -10000) && F.planoCnab17().integridade.ok; })());
  chk('lançamento inexistente é recusado com aviso e sem gravar; perfil sem permissão de importar não marca nada', await (async () => { const n = E.bases.length; await F.marcarLote17('xa', 'nao-existe', true); const aviso = E.toasts.at(-1); const S = ambienteCnab(baseCnab({ pode: k => k !== 'fcx.dfc.importar' })); await S.FluxoDFC.garantirCnab17(); const j = docsJson(S); await S.FluxoDFC.marcarLote17('xa', 'm1', true); return E.bases.length === n && /não encontrado/.test(aviso) && docsJson(S) === j && /não pode marcar/.test(S.toasts.at(-1)); })());
}
{
  // configuração: tolerância e modo da trava de teto (config/dfc_cnab17)
  const E = ambienteCnab(baseCnab()), F = E.FluxoDFC; await F.garantirCnab17(); F.ui.mes = '2026-03';
  chk('configuração padrão: ±1 dia útil e teto por prioridade; valores fora da faixa são corrigidos (±3 no máximo; modo inválido = prioridade)', igual(F.cfg17(), { tolDias: 1, modoTeto: 'prioridade' }) && igual(ambienteCnab(baseCnab({ cfg: { tolDias: 9, modoTeto: 'xyz' } })).FluxoDFC.cfg17(), { tolDias: 3, modoTeto: 'prioridade' }) && igual(ambienteCnab(baseCnab({ cfg: { tolDias: -2, modoTeto: 'proporcional' } })).FluxoDFC.cfg17(), { tolDias: 0, modoTeto: 'proporcional' }));
  chk('alterar a tolerância para "só o mesmo dia": grava config/dfc_cnab17, refaz o plano (L1 explica R$ 8.300 em vez de 9.000) e regrava a base dos meses com lote', await (async () => { E.bases.length = 0; await F.salvarCfg17('tol', 0); return E.S.config.get('dfc_cnab17').tolDias === 0 && F.cfg17().tolDias === 0 && F.planoCnab17().porTx.get('ct-a|L1').aloc === 830000 && E.bases.at(-1).includes('2026-03'); })());
  chk('alterar o modo para proporcional: o lote L2 passa a ser rateado em proporção (R$ 3.000 explicados) e o total do extrato segue igual', await (async () => { await F.salvarCfg17('modo', 'proporcional'); const l2 = F.planoCnab17().porTx.get('ct-a|L2'); return F.cfg17().modoTeto === 'proporcional' && l2.aloc === 300000 && F.planoCnab17().integridade.ok; })());
  chk('só quem pode editar as regras da DFC (fcx.dfc.regras) altera a configuração; os demais recebem aviso', await (async () => { const S = ambienteCnab(baseCnab({ pode: k => k !== 'fcx.dfc.regras' })); await S.FluxoDFC.salvarCfg17('tol', 3); return !S.S.config.has('dfc_cnab17') && /não pode alterar a configuração/.test(S.toasts.at(-1)) && S.FluxoDFC.podeCfg17() === false; })());
}
{
  // recalcular relê o Contas a Pagar (títulos novos pagos depois entram) sem tocar no extrato
  const E = ambienteCnab(baseCnab()), F = E.FluxoDFC; await F.garantirCnab17(); F.ui.mes = '2026-03';
  const p0 = F.planoCnab17(), a0 = p0.porTx.get('ct-a|L1').aloc;
  E.saidasFcx = [...SAIDAS, sd('s9', '2026-03-10', 100, 'Novo Fornecedor Ltda', '4.10.01 – Aluguel')];
  chk('o plano não muda sozinho quando o Contas a Pagar muda; só "Recalcular" relê', F.planoCnab17() === p0 && F.planoCnab17().porTx.get('ct-a|L1').aloc === a0);
  const antes = docsJson(E); await F.recalcularCnab17();
  chk('Recalcular: o título novo de R$ 100 entra no lote de 10/03 (R$ 9.100 explicados), o extrato continua igual e a prova de integridade fecha', F.planoCnab17().porTx.get('ct-a|L1').aloc === 910000 && docsJson(E) === antes && F.planoCnab17().integridade.ok);
}
{
  // roteamento das ações da tela
  const E = ambienteCnab(baseCnab()); 
  chk('as ações da tela chegam ao FluxoDFC: fd-cnab-marcar (v=1/0/null), fd-cnab-recalcular e fd-cnab-cfg (tol, modo), só com o recurso ligado', /case 'fd-cnab-marcar': return g17\(\) \? this\.marcarLote17\(el\.dataset\.doc, el\.dataset\.id, el\.dataset\.v === 'null' \? null : el\.dataset\.v === '1'\) : undefined;/.test(html) && /case 'fd-cnab-recalcular': return g17\(\) \? this\.recalcularCnab17\(\) : undefined;/.test(html) && /if \(a === 'fd-cnab-cfg'\) return g17\(\) \? this\.salvarCfg17\(el\.dataset\.k, el\.value\) : undefined;/.test(html));
  chk('Regra de Ouro: o motor da v14.09 (CP_OFX), as regras padrão da DFC (DFC_REGRAS_PADRAO) e as categorias padrão (DFC_CATEGORIAS) seguem byte a byte como na v14.16 — o CNAB não altera a classificação de quem não usa o recurso', md5(corta('/* CP_OFX:INI */', '/* CP_OFX:FIM */')) === 'b1c09176c057b4e993ab5b3a3f98e9bc' && md5(corta('const DFC_REGRAS_PADRAO = [', 'const DFC = {')) === 'e27e858c728ca653b2d4261c567a5ba4' && md5(corta('const DFC_CATEGORIAS = [', '/** Regras padrão')) === 'c50a8dd959d6e32f7ef08ffb6a447436');
}

{
  /* documentação, versão e texto do KPI de bruto */
  const readme = fs.readFileSync(path.join(raiz, 'README.md'), 'utf8'), i17 = readme.indexOf('## v14.17'), i16 = readme.indexOf('## v14.16');
  chk('README: "Versão v14.17." na abertura e a seção "## v14.17" vem antes da v14.16, com o recurso gestao_v1417, as duas frentes e os limites (Contas a Pagar sem conta bancária nem data de pagamento)', /Versão v14\.17\./.test(readme) && i17 > 0 && i17 < i16 && /gestao_v1417/.test(readme.slice(i17, i16)) && /Frente 1/.test(readme.slice(i17, i16)) && /Frente 2/.test(readme.slice(i17, i16)) && /não tem conta bancária nem data de pagamento/.test(readme.slice(i17, i16)));
  chk('o KPI "Faturamento bruto conciliado" (tela e laudo) diz que o valor é a base de cálculo das taxas, ao lado de ERP × adquirente', (html.match(/base de cálculo das taxas · /g) || []).length >= 3 && /Base de cálculo das taxas \(bruto conciliado\)/.test(html));
  chk('o pacote não leva segredos nem arquivo real: o teste e o README só citam dados fictícios', !/BEGIN (RSA |EC )?PRIVATE KEY|AKIA[0-9A-Z]{16}/.test(readme + fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')));
}

console.log('\n' + OK.length + ' ok, ' + FAIL.length + ' falhas'); if (FAIL.length) process.exit(1);
