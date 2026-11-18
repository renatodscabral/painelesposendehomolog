/* v14.15 / v14.15.1 · Triangulação ERP × Adquirentes (Getnet e SafraPay) × Banco (OFX) + blindagem da busca nos extratos DFC/OFX.
   Valida o CÓDIGO REAL do painel (public/index.html) e do servidor (netlify/lib/adq-1415.mjs) em contexto isolado do Node, só com dados FICTÍCIOS (LGPD): CNPJs gerados aqui, ERP no layout da
   "Apuração dos Créditos" (aba ApuraCreditos; cabeçalhos com espaços nas pontas, OP = VE/CX, DC = DB/CR), SafraPay nos dois layouts ("Agenda de Vendas" e "Recebíveis de antecipação", cabeçalho na linha 7).
   Blocos:
     0) recurso gestao_v1415, Regra de Ouro (regiões protegidas e FCX/Contábil intactos), roteador a15-, catálogo de backup e ACL iguais no painel e no servidor;
     1) leitor do ERP: cabeçalho com espaços nas pontas (" MDR"), linhas sem Loja ou sem Dt Venda descartadas, Credsystem (Adq 304) ENTRA com a Dt Crédito (v14.15.1), QR-LINX (303) e CREDNOSSO (372) só informativos, OP VE/CX e DC DB/CR, .csv, 30 mil linhas;
     2) gravação do ERP por competência em PEDAÇOS de JSON puro (adq_erp/<AAAA-MM>:meta + :p0, :p1…, cada um ≤ 250 KB): mesclagem por dia, limpeza de pedaços que sobraram, exclusão, formato antigo ainda legível; documentos do painel aceitos pelo servidor;
     3) SafraPay com dois layouts: detecção automática, CNPJ do Banco Safra na linha 2 (só avisa), EC registrado, armazenamento independente (Agenda × Recebíveis nunca se sobrescrevem);
     4) Agenda × Recebíveis por NSU + Autorização + Terminal: liquidada, liquidada em parte, pendente (prazo vencido) e aguardando; vendas de 30/31 liquidando no mês seguinte;
     5) ERP × Getnet (Dt Venda + Bandeira + Modalidade somando OP = VE + OP = CX, ± R$ 0,50/dia), antecipação do ERP × contrato, ERP × Agenda SafraPay por loja ligada ao contrato, cobertura parcial do ERP, KPIs da triangulação;
     6) blindagem da busca no DFC/OFX sob o recurso: leitura direta do servidor sem abrir o FCX, créditos fracionados no mesmo dia, virada de mês (30–31/01 liquidando em 02/02), aviso “sem OFX no período” (nunca furo);
     7) servidor: validarAgenda, validarErp, campos lojas/ecs do contrato, gancho com recurso desligado/ligado e ramo de ambiente; recurso desligado = v14.14.
     8) v14.15.1 · persistência: mês real (43.951 linhas → ~14,4 mil agregadas) gravado em pedaços ≤ 250 KB com um armazenamento de teste que recusa > 256 KiB e valor que não seja JSON puro (o erro do Artifact), relido igual; sanitização (NaN, Date, undefined, Loja com zeros); sobras, exclusão, mês incompleto;
     9) v14.15.1 · Credsystem (Adq 304) ERP × OFX direto: Dt Crédito (fim de semana/feriado → próximo dia útil), Vda Líquida − Antecipação − Tx Extra, estornos DB subtraem, D+0..D+2, fracionado, só valor, CNPJ no histórico, lojas do contrato, KPIs e tela; recurso desligado = v14.14;
    10) v14.15.1 · navegação: a Auditoria de Adquirentes abre em "Conciliação de Cartões (por Contrato / CNPJ)" e o motor legado mostra o aviso.
   (A integração ponta a ponta no NAVEGADOR, com o servidor real e o Postgres, é executada na entrega; arquivos reais do cliente não fazem parte do pacote.)
   Uso: node tests/teste-triangulacao-erp-safra-ofx-1415.mjs */
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

const a14 = await import('../netlify/lib/adq-1414.mjs');
const a15 = await import('../netlify/lib/adq-1415.mjs');
const escopo = await import('../netlify/lib/backup-escopo-1413.mjs');
const perm = await import('../netlify/lib/permissoes.mjs');
const regras = await import('../netlify/lib/regras.mjs');

/* ---------- 0 · recurso, Regra de Ouro, montagem ---------- */
chk('recurso gestao_v1415 na lista de liberação (v14.15.1) e helper g15() que depende da v14.14', /gestao_v1415: \{ versao: 'v14\.15\.1'/.test(html) && /function g15\(\) \{ return typeof Recursos !== 'undefined' && Recursos\.ativo\('gestao_v1415'\) && g14\(\); \}/.test(html));
chk('o servidor tem o recurso e o painel usa o mesmo nome', a15.RECURSO === 'gestao_v1415');
chk('nenhuma peça deixou marcador de montagem no painel final', !/@@V141[45]_/.test(html));
const MK_DFC = '/* ============================ DFC ============================ */', MK_PE = 'const PARTE_EXTRATO = 900;', MK_M6 = '/* =====================================================================\n   MÓDULO 6 · CREDSYSTEM';
const guardas = {
  'OFX/contas (OFX → início da DFC)': [md5(html.slice(html.indexOf('const OFX = {'), html.indexOf(MK_DFC))), 'f24c59ac5f7a2ec7544b3643a321f096'],
  'adquirentes e FCX (ADQ_CFG → PARTE_EXTRATO)': [md5(html.slice(html.indexOf('const ADQ_CFG'), html.indexOf(MK_PE))), '6a43dc199b96629c8c8af17b4016d126'],
  'Credsystem em diante (Módulo 6 → CS_INDICADORES)': [md5(html.slice(html.indexOf(MK_M6), html.indexOf('const CS_INDICADORES'))), '4738cb8f2d12cff23c6e385e573f9eae'],
};
for (const [k, [a, b]] of Object.entries(guardas)) chk(`Regra de Ouro: ${k} idêntico ao da v14.14 (md5 ${b.slice(0, 8)}…)`, a === b, a);
for (const [f, h] of [['fcx.html', '640800e0'], ['contabilidade.html', 'a41642fb'], ['contabilidade_v1391.html', 'ea73d20b']]) {
  const p = path.join(raiz, 'public', f);
  chk(`Regra de Ouro: public/${f} ${f === 'fcx.html' ? 'idêntico ao da v14.17: v14.08 + a única exceção autorizada (importação de Saídas com os dois layouts do ERP, atrás de gestao_v1417)' : 'idêntico ao da v14.08'} (md5 ${h}…)`, fs.existsSync(p) && md5(fs.readFileSync(p)).startsWith(h));
}
chk('roteador: as ações a15-* vão para o módulo novo, antes das a14-*', html.indexOf('[/^a15-/, () => Adq15]') > 0 && html.indexOf('[/^a15-/, () => Adq15]') < html.indexOf('[/^a14-/, () => Adq14]'));
chk('o botão de arquivo do ERP consta na lista declarativa de importações do painel (varredura de cobertura)', /\['Conciliação de Cartões · ERP Apuração dos Créditos \(v14\.15\)', 'a15-erp-arq'\]/.test(html));
chk('o leitor e o cruzamento ANTIGOS do ERP (lerErpApuracao, MAPA_ERP) continuam no painel e não foram duplicados', (html.match(/lerErpApuracao/g) || []).length >= 1 && (html.match(/MAPA_ERP: \{/g) || []).length === 1);

/* ---------- ambiente de teste: código REAL do painel com Repo/UI de brincadeira ---------- */
const base = corta('const ADQ_CFG = {', '/* ============================ 6. SERVIÇOS ============================ */');
const motor = corta('const MotorConciliacao = {', '/* ============================ 7. UI (aba do Módulo 4) ============================ */');
const modulo = corta('const ADQ14 = {', '/* ---- fim v14.15 ---- */') + '/* ---- fim v14.15 ---- */';
const CNPJlib = corta('const CNPJ = {', '/**\n * CSV — leitura e geração');
const dvC = (d, n) => { let s = 0, p = n - 7; for (let i = 0; i < n; i++) { s += +d[i] * p--; if (p < 2) p = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
const gerarCnpj = b8 => { const d = b8 + '0001'; const d1 = dvC(d, 12); return d + d1 + dvC(d + d1, 13); };
const CNPJ_RES = gerarCnpj('11222333'), CNPJ_MAR = gerarCnpj('44555666'), CNPJ_BANCO = gerarCnpj('77888999');
const fmtCnpj = s => s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

function ambiente({ g14 = true, g15 = true } = {}) {
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
  const ctx = { flag: g14, flag15: g15, toasts: [], audits: [], confirmou: 0, recargas: [], assinadas: [], servidor: null, negar: null, modais: [], baixados: [] };
  const ConcMP = { SUBS72: [['cruzamento', 'Conciliação e Cruzamento'], ['regras', 'Regras de Taxa Contratuais'], ['resumo', 'Resumo do Fechamento']], ui: { sub: 'regras' }, v72: () => true,
    renderCredito() { return 'ORIGINAL-CREDITO'; }, renderRegras() { return 'ORIGINAL-REGRAS'; }, empresa: id => emp[id] || null, nomeEmpresa: id => emp[id]?.nome || id || '—', empresas: () => Object.values(emp), ecInfo: () => null };
  const mocks = {
    Repo, ConcMP, g14: () => ctx.flag, g15: () => ctx.flag15 && ctx.flag, Datas: { hojeISO: () => '2026-11-17' }, Recursos: { ativo: () => true }, Auth: { can: (...x) => (ctx.pode ? ctx.pode(...x) : true), id: 'u-teste' }, Libs: {}, DFC: { classificar: () => ({}) },
    ContasBancarias: { rotulo: c => c.apelido }, Retaguarda: {}, CNPJ: undefined,
    Fmt: { brl: n => 'R$' + Number(n).toFixed(2), brl0: n => 'R$' + Math.round(n), num: n => String(n), data: d => String(d ?? '').replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1'), dataHora: d => d, pct: n => Number(n).toFixed(2) + '%' },
    UI: { toast: m => ctx.toasts.push(m), modal(o) { ctx.modais.push(o); return { el: {} }; }, confirmar: async () => { ctx.confirmou++; return true; }, confirmarImpacto: async () => true, lerForm: () => ({}) },
    App: { render() { }, agendarRender() { } }, Audit: { registrar: a => { ctx.audits.push(a); return Promise.resolve(); } }, Documento: { baixarArquivo(nome, blob) { ctx.baixados.push([nome, blob]); return true; } }, CSV: { gerar: m => m.map(l => l.join(';')).join('\n') },
    campo: () => '', esc: s => String(s ?? ''),
  };
  const nomes = Object.keys(mocks).filter(k => k !== 'CNPJ');
  const fn = new Function(...nomes, `${CNPJlib}\n${base}\n${motor}\n${modulo}\nreturn { ADQ_CFG, AdqTaxas, DiasUteis, MotorConciliacao, ADQ14, Adq14, ADQ15, Adq15, CNPJ };`);
  const E = fn(...nomes.map(k => mocks[k]));
  ctx.S = S; ctx.Repo = Repo; ctx.ConcMP = ConcMP; ctx.bump = bump; Object.assign(ctx, E);
  return ctx;
}

/* ---------- fixtures fictícias nos formatos reais ---------- */
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

/* =====================================================================
   1 · LEITOR DO ERP · Apuração dos Créditos (aba ApuraCreditos)
   ===================================================================== */
{
  const E = ambiente(), { Adq15 } = E;
  const L = Adq15.lerErpLinhas(erpRows(), 'Apuração dos Créditos jan.xlsx', 'ApuraCreditos'), P = L.periodos[0], G = P.grupos; // v14.15.1: cada grupo é um objeto de JSON puro { loja, dv, dcr, adqCod, desc, adqNome, band, mod, dc, op, n, bruto, mdr, liq, ant, tx }
  chk('ERP: cabeçalho achado depois de 3 linhas de título, mesmo com espaços nas pontas (" MDR"); competência única 2026-01 pela Dt Venda', L.linhaCab === 4 && L.periodos.length === 1 && P.competencia === '2026-01', [L.linhaCab, L.periodos.map(p => p.competencia)]);
  chk('ERP: linhas sem Loja (1) ou sem Dt Venda (1) são descartadas e a linha de total não vira venda', L.semLoja === 1 && L.semData === 1 && L.rodape === 1 && L.linhas === 20, [L.semLoja, L.semData, L.rodape, L.linhas]);
  const GC = G.filter(g => g.adqNome === 'CREDSYSTEM');
  chk('ERP: Credsystem (Adq 304) ENTRA (v14.15.1) — 2 linhas / R$ 1.110 nos grupos, cada uma com a Dt Crédito; nada é descartado por adquirente', Object.keys(L.excluidas).length === 0 && L.porAdq.CREDSYSTEM.n === 2 && perto(L.porAdq.CREDSYSTEM.bruto, ERP_BRUTO_CRED) && GC.length === 2 && GC.every(g => g.adqCod === '304' && /^2026-01-\d\d$/.test(g.dcr) && g.op === 'VE' && g.dc === 'CR'), [L.excluidas, L.porAdq, GC]);
  chk('ERP: QR-LINX (303) e CREDNOSSO (372) vão para o resumo informativo à parte (não entram nos grupos da conciliação)', L.informativo['QR-LINX'].n === 1 && perto(L.informativo['QR-LINX'].bruto, 150) && L.informativo.CREDNOSSO.n === 1 && perto(L.informativo.CREDNOSSO.bruto, 80) && !G.some(g => /QR|CREDNOSSO/.test(g.adqNome)), L.informativo);
  chk('ERP: OP = CX (Prestação no POS) e OP = VE (Venda) ficam em grupos separados; DC = DB é débito e CR é crédito', G.filter(g => g.loja === '1' && g.dv === '2026-01-05' && g.band === 'VISA' && g.mod === 'credito').map(g => g.op + g.bruto).sort().join() === 'CX50,VE2950' && G.find(g => g.loja === '1' && g.band === 'VISA' && g.dv === '2026-01-05' && g.mod === 'debito').bruto === 1000, G.filter(g => g.loja === '1'));
  chk('ERP: código da Adq aprendido pela descrição (301 → GETNET, 302 → SAFRAPAY) e 304 / 303 / 372 fixos (CREDSYSTEM / QR-LINX / CREDNOSSO); lojas normalizadas (05 = 5)', L.aprendido['301'] === 'GETNET' && L.aprendido['302'] === 'SAFRAPAY' && E.ADQ15.COD_ERP['304'] === 'CREDSYSTEM' && E.ADQ15.COD_ERP['303'] === 'QR-LINX' && E.ADQ15.COD_ERP['372'] === 'CREDNOSSO' && L.lojas.join() === '1,2,3,5,28,31' && Adq15.lojaKey('05') === Adq15.lojaKey('5') && Adq15.lojaKey('005') === '5', [L.aprendido, L.lojas]);
  chk(`ERP: Vda Bruta sem QR-LINX e CREDNOSSO = ${ERP_BRUTO} (Getnet ${ERP_BRUTO_GETNET_RES + ERP_BRUTO_GETNET_MAR} + SafraPay ${ERP_BRUTO_SAFRA} + Credsystem ${ERP_BRUTO_CRED}); 18 vendas; MDR, líquido e antecipação somados por grupo`, perto(P.bruto, ERP_BRUTO) && P.qtd === 18 && perto(G.reduce((s, g) => s + g.bruto, 0), ERP_BRUTO) && perto(G.reduce((s, g) => s + g.ant, 0), 30.25 + 91.57 + 4 + 7 + 60 + 3.2), [P.bruto, P.qtd]);
  // .csv (";" e vírgula decimal) pelo mesmo caminho do botão
  const csv = erpRows().map(l => l.map(c => c == null ? '' : typeof c === 'number' ? String(c).replace('.', ',') : c).join(';')).join('\r\n');
  const Lc = await Adq15.lerErp({ name: 'apuracao.csv', arrayBuffer: async () => new TextEncoder().encode(csv).buffer });
  chk('ERP em .csv (";" e vírgula decimal): mesmas competências, mesmo bruto (Credsystem incluída) e mesmos descartes', Lc.periodos.length === 1 && perto(Lc.periodos[0].bruto, ERP_BRUTO) && Lc.semLoja === 1 && Lc.porAdq.CREDSYSTEM.n === 2 && Lc.periodos[0].grupos.some(g => g.adqNome === 'CREDSYSTEM' && g.dcr), [Lc.periodos.map(p => p.bruto), Lc.semLoja]);
  const erros = []; for (const rows of [[], [['a', 'b']], [CAB_ERP.map(c => c.trim() === 'Adq' || c === 'Descrição' ? 'X' : c), ['01', '05/01/2026', 1]]]) { try { Adq15.lerErpLinhas(rows, 'x.xlsx'); erros.push('leu'); } catch (e) { erros.push(e.message.slice(0, 70)); } }
  chk('ERP: planilha sem cabeçalho (Loja, Dt Venda, Vda Bruta) ou sem Adq / Descrição é recusada com mensagem clara', erros.every(m => m !== 'leu') && /Não encontrei o cabeçalho/.test(erros[0] + erros[1]) && /não tem as colunas Adq nem Descrição/.test(erros[2]), erros);
  // Excel entrega Loja e Adq como NÚMERO e a data como número de série: o mesmo resultado
  const serial = d => Math.round((Date.UTC(+d.slice(6), +d.slice(3, 5) - 1, +d.slice(0, 2)) - Date.UTC(1899, 11, 30)) / 86400000);
  const numerico = ERP_LINHAS.slice(0, 20).map(l => [/^\d+$/.test(l[0]) ? +l[0] : l[0], l[1] ? serial(l[1]) : l[1], l[2] ? serial(l[2]) : l[2], /^\d+$/.test(l[3]) ? +l[3] : l[3], ...l.slice(4)]);
  const Ln = Adq15.lerErpLinhas(erpRows(numerico), 'numerico.xlsx', 'ApuraCreditos');
  chk('ERP com Loja e Adq numéricas e datas em número de série (como o Excel entrega): mesma competência, mesmo bruto, mesmas lojas e Credsystem dentro, com a Dt Crédito também lida do número de série', Ln.periodos.length === 1 && Ln.periodos[0].competencia === '2026-01' && Ln.porAdq.CREDSYSTEM.n === 2 && Ln.periodos[0].grupos.filter(g => g.adqNome === 'CREDSYSTEM').every(g => /^2026-01-1[23]$/.test(g.dcr)) && perto(Ln.periodos[0].bruto, ERP_BRUTO) && Ln.lojas.join() === '1,2,3,5,28,31', [Ln.periodos.map(x => [x.competencia, x.bruto]), Ln.porAdq, Ln.lojas]);
  // desempenho: 30 mil linhas
  const rnd = (() => { let x = 777; return () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  const big = []; let soma = 0; for (let i = 0; i < 30000; i++) { const v = Math.round((10 + rnd() * 990) * 100) / 100, dia = String(1 + Math.floor(rnd() * 27)).padStart(2, '0'); soma += v;
    big.push(er(['01', '03', '05'][i % 3], `${dia}/03/2026`, '301', i % 2 ? 'GETNET VISA DEBITO' : 'GETNET ELO CREDITO A VISTA', v, r2(v * 0.02), r2(v * 0.98), 0, i % 5 ? 'VE' : 'CX', i % 2 ? 'DB' : 'CR')); }
  const t0 = Date.now(), B = Adq15.lerErpLinhas(erpRows(big), 'grande.xlsx'), ms = Date.now() - t0;
  chk(`ERP: 30.000 linhas lidas em ${ms} ms, Σ bruto dos grupos = Σ das linhas e os grupos são poucos (agregado por Loja × dia × bandeira × D/C × OP)`, B.linhas === 30000 && perto(B.periodos[0].bruto, soma, 0.05) && B.periodos[0].grupos.length < 3000 && ms < 8000, [B.linhas, B.periodos[0].bruto, soma, B.periodos[0].grupos.length, ms]);
}

/* =====================================================================
   2 · GRAVAÇÃO DO ERP (por competência, mesclando por dia)
   ===================================================================== */
{
  const E = await cenario(), { Adq15 } = E;
  await E.gravarErp();
  const ids0 = [...E.S.adq_erp.keys()].sort(), meta = E.S.adq_erp.get('2026-01:meta'), p0 = E.S.adq_erp.get('2026-01:p0'), nG = E.lido.erp.periodos[0].grupos.length;
  chk('ERP gravado em adq_erp como 2026-01:meta (resumo) + 2026-01:p0 (grupos): formato erp-apuracao v2, mesma marca (rev) nos dois, resumo calculado no ato', igual(ids0, ['2026-01:meta', '2026-01:p0']) && meta.tipo === 'meta' && p0.tipo === 'parte' && meta.v === 2 && p0.v === 2 && meta.rev === p0.rev && meta.partes === 1 && p0.n === 1 && p0.i === 0 && meta.cols.length === 13 && p0.grupos.length === nG && perto(meta.resumo.bruto, ERP_BRUTO) && meta.resumo.dias === 7 && meta.resumo.partes === 1, [ids0, meta.resumo]);
  chk('a leitura reassembla o mês (loadERP / erpGrupos): mesmos grupos, mesmos valores e a mesma descrição; Credsystem junto, QR-LINX e CREDNOSSO só no resumo informativo', (() => { const M = Adq15.loadERP('2026-01'), orig = E.lido.erp.periodos[0].grupos; const ch = g => JSON.stringify([g.loja, g.dv, g.dcr, g.adqCod, g.desc, g.dc, g.op, g.n, g.bruto, g.mdr, g.liq, g.ant, g.tx]); return M && !M.incompleto && M.partes === 1 && M.grupos.length === nG && igual(M.grupos.map(ch).sort(), orig.map(ch).sort()) && M.grupos.filter(g => g.adqNome === 'CREDSYSTEM').length === 2 && !M.grupos.some(g => /QR|CREDNOSSO/.test(g.adqNome)); })());
  const I0 = Adq15.resumoInformativo('2026-01');
  chk('Credsystem é gravada com a Dt Crédito (tupla Loja, Dt Venda, Dt Crédito, Adq…); o resumo informativo traz só QR-LINX e CREDNOSSO; sem contrato dela, aparece em "outras"', p0.grupos.filter(t => t[3] === '304').length === 2 && p0.grupos.filter(t => t[3] === '304').every(t => /^2026-01-1[23]$/.test(t[2])) && !JSON.stringify(meta.info).includes('CREDSYSTEM') && meta.info.length === 2 && perto(I0.info['QR-LINX'].bruto, 150) && perto(I0.info.CREDNOSSO.bruto, 80) && !I0.info.CREDSYSTEM && Object.keys(I0.excl).length === 0 && I0.outras.CREDSYSTEM.n === 2, [I0, meta.info]);
  chk('os documentos gravados pelo painel passam na validação do SERVIDOR (validarErp): meta e parte — painel e servidor falam o mesmo formato', (() => { try { a15.validarErp('2026-01:meta', strip(meta)); a15.validarErp('2026-01:p0', strip(p0)); return true; } catch (e) { return e.message; } })() === true);
  const cobre = Adq15.coberturaErp('2026-01'); chk('cobertura do ERP importado = dias do arquivo (05/01 a 31/01)', !!cobre && cobre('2026-01-05') && cobre('2026-01-31') && !cobre('2026-01-04') && !cobre('2026-02-01'));
  // reimportar só substitui os dias do arquivo novo
  const novo = Adq15.lerErpLinhas(erpRows([er('03', '12/01/2026', '301', 'GETNET VISA DEBITO', 410, 3.7, 406.3, 0, 'VE', 'DB'), er('03', '12/01/2026', '301', 'GETNET ELO CREDITO A VISTA', 600, 13.2, 586.8, 0, 'VE', 'CR')]), 'Apuração dos Créditos 12-01.xlsx', 'ApuraCreditos');
  const revAntes = meta.rev; await E.gravarErp(novo);
  const g = Adq15.erpGrupos('2026-01'), mar12 = g.filter(x => x.loja === '3' && x.dv === '2026-01-12'), res05 = g.filter(x => x.loja === '1' && x.dv === '2026-01-05');
  chk('reimportar um arquivo que só traz o dia 12/01 substitui SÓ o dia 12/01 (Mar Aberto 410 + 600; a Credsystem do dia 12 sai junto) e preserva os outros dias do mês (05/01 da Resilienza e a Credsystem do dia 13 seguem lá)', mar12.reduce((s, x) => s + x.bruto, 0) === 1010 && res05.length === 4 && !g.some(x => x.dv === '2026-01-12' && x.loja === '1') && g.some(x => x.dv === '2026-01-06' || x.dv === '2026-01-30') && g.some(x => x.adqNome === 'CREDSYSTEM' && x.dv === '2026-01-13'), [mar12, res05.length]);
  const d2 = E.S.adq_erp.get('2026-01:meta'); chk('os arquivos importados ficam registrados no resumo (nome, aba e dias), com nova marca de gravação, e a cobertura soma as faixas', d2.arquivos.length === 2 && d2.arquivos[1].nome === 'Apuração dos Créditos 12-01.xlsx' && igual(d2.arquivos[1].dias, ['2026-01-12', '2026-01-12']) && d2.rev !== revAntes && E.S.adq_erp.get('2026-01:p0').rev === d2.rev, d2.arquivos);
  // pedaços (mês grande demais para um documento): CHUNK_ALVO pequeno para forçar a divisão
  const E2 = await cenario(); E2.ADQ15.CHUNK_ALVO = 1500; E2.ADQ15.CHUNK_MAX = 2500; await E2.gravarErp();
  const ids = [...E2.S.adq_erp.keys()].sort(), n = E2.lido.erp.periodos[0].grupos.length, pts = ids.filter(x => /:p\d+$/.test(x));
  chk('mês grande: o ERP se divide em pedaços (2026-01:p0, :p1, …) + 2026-01:meta, nenhum maior que o limite, e a leitura junta todos na ordem', pts.length > 1 && ids.includes('2026-01:meta') && ids.length === pts.length + 1 && E2.Adq15.erpGrupos('2026-01').length === n && E2.S.adq_erp.get('2026-01:meta').partes === pts.length && pts.every((id, k) => E2.S.adq_erp.get(id).i === k && E2.S.adq_erp.get(id).n === pts.length && Buffer.byteLength(JSON.stringify(E2.S.adq_erp.get(id))) <= 2500 + 200) && igual(E2.Adq15.erpGrupos('2026-01').map(x => x.bruto).sort((a, b) => a - b), E2.lido.erp.periodos[0].grupos.map(x => x.bruto).sort((a, b) => a - b)), [ids, n, pts.map(id => Buffer.byteLength(JSON.stringify(E2.S.adq_erp.get(id))))]);
  chk('cada pedaço e o resumo também passam no servidor (id :meta / :p<n>, competência igual, ≤ 256 KiB)', ids.every(id => { try { a15.validarErp(id, strip(E2.S.adq_erp.get(id))); return true; } catch { return false; } }));
  E2.ADQ15.CHUNK_ALVO = 236000; E2.ADQ15.CHUNK_MAX = 250000; await E2.gravarErp(); chk('reimportar com o limite normal remove os pedaços que sobraram (só meta + p0)', igual([...E2.S.adq_erp.keys()].sort(), ['2026-01:meta', '2026-01:p0']) && E2.Adq15.erpGrupos('2026-01').length === n, [...E2.S.adq_erp.keys()]);
  // mês gravado pela v14.15 (um documento por competência, tuplas antigas): continua legível e a reimportação migra para o formato novo, sem deixar resto
  const E4 = await cenario(), og = E4.lido.erp.periodos[0].grupos.filter(x => x.adqNome !== 'CREDSYSTEM');
  E4.S.adq_erp.set('2026-01', { id: '2026-01', formato: 'erp-apuracao', competencia: '2026-01', partes: 1, parte: 1, cols: E4.ADQ15.ERP_COLS, grupos: og.map(x => [x.loja, x.dv, x.adqCod, x.adqNome, x.band, x.mod, x.op, x.n, x.bruto, x.mdr, x.liq, x.ant, x.tx]), info: [], arquivos: [{ nome: 'antigo.xlsx', dias: ['2026-01-05', '2026-01-31'] }], resumo: {} }); E4.bump('adq_erp');
  const ML = E4.Adq15.loadERP('2026-01');
  chk('documento do formato antigo (v14.15: adq_erp/2026-01 com tuplas) segue legível: mesmos grupos, adquirente e bandeira reconstituídos', ML.legado === true && ML.grupos.length === og.length && perto(ML.grupos.reduce((s, x) => s + x.bruto, 0), ERP_BRUTO_TRI) && ML.grupos.every(x => x.adqNome && x.band) && E4.Adq15.erpGrupos('2026-01').length === og.length);
  await E4.gravarErp(); chk('reimportar sobre o formato antigo migra para meta + p0 e remove o documento antigo (nenhum resto)', igual([...E4.S.adq_erp.keys()].sort(), ['2026-01:meta', '2026-01:p0']) && E4.Adq15.loadERP('2026-01').legado === false && E4.Adq15.erpGrupos('2026-01').length === E4.lido.erp.periodos[0].grupos.length + 0);
  // mês incompleto (faltou um pedaço): avisa e NUNCA calcula com pedaço do mês
  const E5 = await cenario(); E5.ADQ15.CHUNK_ALVO = 1500; E5.ADQ15.CHUNK_MAX = 2500; await E5.gravarErp(); E5.S.adq_erp.delete('2026-01:p1'); E5.bump('adq_erp');
  chk('mês com pedaço faltando é marcado como incompleto, não entra nos grupos (nada de cálculo pela metade) e a cobertura ignora', E5.Adq15.loadERP('2026-01').incompleto === true && E5.Adq15.loadERP('2026-01').faltam.join() === '1' && E5.Adq15.erpGrupos('2026-01').length === 0 && E5.Adq15.coberturaErp('2026-01') === null);
  // pedaço de uma gravação anterior (outra marca) é ignorado: o `meta` é gravado por último e só ele "vale" os pedaços da própria marca
  const E6 = await cenario(); await E6.gravarErp(); const dp = E6.S.adq_erp.get('2026-01:p0'); E6.S.adq_erp.set('2026-01:p1', { ...JSON.parse(JSON.stringify(dp)), id: '2026-01:p1', i: 1, rev: 'outra-marca', grupos: dp.grupos.slice(0, 3) }); E6.bump('adq_erp');
  chk('pedaço com marca (rev) diferente da do resumo é ignorado na leitura (não duplica nem mistura gravações)', E6.Adq15.loadERP('2026-01').grupos.length === nG && E6.Adq15.loadERP('2026-01').lidas === 1);
  await E2.Adq15.excluirErp('2026-01'); chk('excluir o ERP da competência remove todos os documentos dela (meta e pedaços) e só dela', E2.S.adq_erp.size === 0);
  const E3 = await cenario(); E3.Adq15.podeImportar = () => false; E3.Adq15.ui.erp = { lido: E3.lido.erp }; await E3.Adq15.gravarErp(); chk('perfil sem a permissão de importação não grava o ERP', E3.S.adq_erp.size === 0);
}

/* =====================================================================
   3 · SAFRAPAY · DOIS LAYOUTS (Agenda de Vendas × Recebíveis de antecipação)
   ===================================================================== */
{
  const E = await cenario(), { Adq14, Adq15 } = E;
  chk('detecção automática pelo cabeçalho: Agenda de Vendas (Data da Venda … Valor Bruto da Venda) × Recebíveis de antecipação (Data do Pagamento … Valor Recebido)', Adq15.detectarSafra(agJan()) === 'agenda' && Adq15.detectarSafra(recebiveis(REC_JAN)) === 'recebiveis' && Adq15.detectarSafra([['a', 'b']]) === '');
  chk('os dois layouts têm cabeçalho na linha 7 e o CNPJ do Banco Safra na linha 2; o formato lido identifica cada um (safra-agenda × safra-xlsx)', E.lido.agJan.formato === 'safra-agenda' && E.lido.recJan.formato === 'safra-xlsx' && E.lido.agJan.linhaCab === 7 && E.lido.recJan.linhaCab === 7 && E.lido.agJan.cnpjCabecalho === CNPJ_BANCO && E.lido.recJan.cnpjCabecalho === CNPJ_BANCO && /Safra/.test(E.lido.agJan.bancoCabecalho));
  let msg = ''; try { Adq15.lerSafraLinhasAuto([['x']], 'x.xlsx'); } catch (e) { msg = e.message; } chk('planilha que não é nenhum dos dois layouts: mensagem diz os dois formatos esperados', /Agenda de Vendas/.test(msg) && /Recebíveis de antecipação/.test(msg), msg);
  const A = E.lido.agJan, p = A.periodos[0];
  chk(`Agenda: 10 linhas → 8 vendas únicas por NSU + Autorização + Terminal (a NSU 1002 em 3 linhas conta UMA vez); bruto ${AG_JAN_BRUTO}; 2 repetidas; rodapé/total ignorado`, A.linhas === 10 && p.qtd === 8 && A.repetidas === 2 && perto(p.bruto, AG_JAN_BRUTO) && A.semData >= 1, [A.linhas, p.qtd, A.repetidas, p.bruto]);
  chk('Agenda: competência = mês da DATA DA VENDA; Estabelecimento Comercial 1454475 registrado; parcelas lidas de "1/3" (NSU 1002 = 3 parcelas)', A.periodos.length === 1 && p.competencia === '2026-01' && A.ecs.some(e => e.ec === '1454475' && e.qtd === 10) && E.Adq15.vendasAgenda({ vendas: p.vendas }).find(v => v.nsu === '1002' || v.nsu === 1002).np === 3, [A.ecs]);
  const meio = Adq15.lerSafraLinhasAuto(agenda([ag('31/01/2026', 'VISA', 'Débito', 1, 1, '1/1', 'R$ 10,00', 'R$ 9,91'), ag('01/02/2026', 'VISA', 'Débito', 2, 2, '1/1', 'R$ 20,00', 'R$ 19,82')]), 'virada.xlsx');
  chk('Agenda com vendas de dois meses vira uma agenda por competência da venda', meio.periodos.map(x => x.competencia).join() === '2026-01,2026-02');
  // armazenamento independente no MESMO contrato SafraPay
  await E.importar(CT.saf, E.lido.recJan); await E.importar(CT.saf, E.lido.agJan);
  const idSaf = `adq-safrapay__${CNPJ_RES}__2026-01`;
  chk('SafraPay: Recebíveis vão para adq_lotes e a Agenda para adq_agendas — mesma chave (Adquirente + CNPJ + Competência), coleções diferentes, uma não sobrescreve a outra', E.S.adq_lotes.size === 1 && E.S.adq_agendas.size === 1 && E.S.adq_lotes.has(idSaf) && E.S.adq_agendas.has(idSaf) && E.S.adq_lotes.get(idSaf).formato === 1 && E.S.adq_agendas.get(idSaf).formato === 'safra-agenda', [...E.S.adq_lotes.keys(), ...E.S.adq_agendas.keys()]);
  const ag0 = JSON.stringify(E.S.adq_agendas.get(idSaf)), lt0 = JSON.stringify(E.S.adq_lotes.get(idSaf));
  const agV2 = Adq15.lerSafraLinhasAuto(agJan([...AG_JAN, ['25/01/2026', 'VISA', 'Débito', 5001, 51, '1/1', 'R$ 15,00', 'R$ 14,87']]), 'agenda v2.xlsx'); await E.importar(CT.saf, agV2);
  chk('reimportar a Agenda regrava só adq_agendas; o lote de Recebíveis fica byte a byte igual', JSON.stringify(E.S.adq_lotes.get(idSaf)) === lt0 && JSON.stringify(E.S.adq_agendas.get(idSaf)) !== ag0 && E.S.adq_agendas.get(idSaf).resumo.qtd === 9 && E.S.adq_agendas.size === 1);
  const ag1 = JSON.stringify(E.S.adq_agendas.get(idSaf)); await E.importar(CT.saf, Adq15.lerSafraLinhasAuto(recebiveis(REC_JAN.slice(0, 5)), 'rec v2.xlsx'));
  chk('reimportar os Recebíveis regrava só adq_lotes; a Agenda fica byte a byte igual', JSON.stringify(E.S.adq_agendas.get(idSaf)) === ag1 && E.S.adq_lotes.size === 1);
  const doc = E.S.adq_agendas.get(idSaf);
  chk('a Agenda gravada leva a empresa e o CNPJ do CONTRATO (não o do Banco Safra), a conta do contrato, os ECs e o layout de origem; o CNPJ do banco só gera aviso', doc.cnpj === CNPJ_RES && doc.empresaId === 'resilienza' && doc.contaId === 'ct-c' && doc.ecs['1454475'] === 9 && doc.arquivo.layout === 'safra-agenda' && doc.cnpjCabecalho === CNPJ_BANCO && E.toasts.length > 0 && Adq14.validarCnpj(E.lido.agJan, Adq14.contrato(CT.saf)).avisos.some(t => t.includes(fmtCnpj(CNPJ_BANCO))) && !Adq14.validarCnpj(E.lido.agJan, Adq14.contrato(CT.saf)).bloqueios.length, doc.ecs);
  chk('a Agenda gravada passa na validação do SERVIDOR (validarAgenda) e a chave idAgenda do servidor é igual à do painel', (() => { try { a15.validarAgenda(idSaf, strip(doc)); return true; } catch (e) { return e.message; } })() === true && a15.idAgenda(CNPJ_RES, '2026-01') === idSaf && E.Adq14.idLote('SAFRAPAY', CNPJ_RES, '2026-01') === idSaf);
  chk('auditoria: gravar a Agenda deixa registro (contrato, vendas, bruto, EC) na entidade adq_agendas', E.audits.some(a => a.entidade === 'adq_agendas' && /Agenda de Vendas/.test(a.rotulo) && /EC 1454475/.test(a.detalhe)));
  await Adq15.excluirAgenda(idSaf); chk('excluir a Agenda não mexe nos Recebíveis (adq_lotes)', E.S.adq_agendas.size === 0 && E.S.adq_lotes.has(idSaf));
  // contrato sem CNPJ no cadastro bloqueia (mesma trava dos lotes)
  const sem = ambiente(); semear(sem); sem.S.adq_contratos.set(CT.saf, { id: CT.saf, adquirente: 'SAFRAPAY', empresaId: 'sem-cnpj', contaId: 'ct-c', ativo: true }); sem.bump('adq_contratos');
  chk('a leitura de Agenda segue a trava de CNPJ do contrato: empresa sem CNPJ no cadastro bloqueia a gravação', sem.Adq14.validarCnpj(E.lido.agJan, { ...sem.S.adq_contratos.get(CT.saf) }).bloqueios.length === 1);
}

/* =====================================================================
   4 · AGENDA × RECEBÍVEIS por NSU + Autorização + Terminal
   ===================================================================== */
{
  const E = await cenario(), { Adq14, Adq15 } = E, C = () => Adq14.contrato(CT.saf);
  await E.importar(CT.saf, E.lido.recJan); await E.importar(CT.saf, E.lido.agJan);
  let G = Adq15.cruzarAgendaRecebiveis(C(), '2026-01'), t = G.tot;
  chk('só com os Recebíveis de janeiro: 4 vendas liquidadas (NSU 1001–1004; a 1002 com as 3 parcelas) = R$ 2.500,00', t.n === 8 && t.liquidada === 4 && perto(t.vLiquidada, 2500) && t.parcial === 0, t);
  chk('venda de débito de 05/01 sem recebível e prazo (D+1 = 06/01) já vencido nos Recebíveis importados (até 07/01) = Pendente (prazo vencido), R$ 80,00', t.vencida === 1 && perto(t.vVencida, 80) && G.res.vencida[0].nsu.toString() === '3001' && G.maxDp === '2026-01-07', [t, G.maxDp]);
  chk('vendas de 30/01 e 31/01 (liquidam só em 02/02) e a de 20/01 (ainda sem Recebíveis de depois de 07/01) = Aguardando pagamento, R$ 360,00', t.aguardando === 3 && perto(t.vAguardando, 360) && G.res.aguardando.map(v => v.dv).sort().join() === '2026-01-20,2026-01-30,2026-01-31', t);
  chk('a soma fecha: liquidada + em parte + vencida + aguardando = bruto da Agenda (2.940) e nenhum Recebível ficou sem par', perto(t.vLiquidada + t.vParcial + t.vVencida + t.vAguardando, AG_JAN_BRUTO) && t.recSemAgenda === 0);
  // virada de mês: importa os Recebíveis de fevereiro
  await E.importar(CT.saf, E.lido.recFev); G = Adq15.cruzarAgendaRecebiveis(C(), '2026-01'); t = G.tot;
  const d30 = G.dias.find(d => d.data === '2026-01-30'), d31 = G.dias.find(d => d.data === '2026-01-31');
  chk('importados os Recebíveis de fevereiro (02/02): as vendas de 30/01 e 31/01 passam a Liquidadas, pagas em 02/02, e o dia é marcado como "liquida no mês seguinte"', t.liquidada === 6 && perto(t.vLiquidada, 2500 + 150 + 120) && d30.liquidada === 1 && d31.liquidada === 1 && d30.virouMes && d31.virouMes && d30.dpMin === '2026-02-02' && d31.dpMax === '2026-02-02', [t, d30, d31]);
  chk('com os Recebíveis até 02/02, a venda de 20/01 (prazo D+1 = 21/01) deixa de ser "aguardando" e vira Pendente (prazo vencido); a NSU 9999 dos Recebíveis, sem venda na Agenda, é contada à parte', t.vencida === 2 && t.aguardando === 0 && perto(t.vVencida, 80 + 90) && t.recSemAgenda === 1, t);
  // liquidada em parte: só 2 das 3 parcelas da NSU 1002 chegaram
  const E2 = await cenario(); await E2.importar(CT.saf, Adq15.lerSafraLinhasAuto(recebiveis(REC_JAN.filter((_, i) => i !== 3)), 'rec parcial.xlsx')); await E2.importar(CT.saf, E2.lido.agJan);
  const G2 = E2.Adq15.cruzarAgendaRecebiveis(E2.Adq14.contrato(CT.saf), '2026-01'), v1002 = G2.res.parcial[0];
  chk('NSU 1002 com 2 das 3 parcelas pagas = Liquidada em parte (parcelas pagas 2 de 3), fora das liquidadas', G2.tot.parcial === 1 && String(v1002.nsu) === '1002' && v1002.parcelasPagas === 2 && v1002.np === 3 && G2.tot.liquidada === 3, [G2.tot, v1002]);
  // a chave é NSU + Autorização + Terminal: mesma NSU em outro terminal NÃO casa
  const E3 = await cenario(); const outro = recebiveis(REC_JAN).map(l => l[4] === 1001 ? [...l.slice(0, 6), 99999999, ...l.slice(7)] : l);
  await E3.importar(CT.saf, E3.Adq15.lerSafraLinhasAuto(outro, 'rec outro terminal.xlsx')); await E3.importar(CT.saf, E3.lido.agJan);
  const G3 = E3.Adq15.cruzarAgendaRecebiveis(E3.Adq14.contrato(CT.saf), '2026-01');
  chk('a NSU 1001 recebida em OUTRO terminal não casa com a venda da Agenda (chave = NSU + Autorização + Terminal): a venda fica pendente e o recebível sem par', G3.tot.liquidada === 3 && G3.res.vencida.some(v => String(v.nsu) === '1001') && G3.tot.recSemAgenda === 1, [G3.tot]);
  chk('sem Agenda do mês o cruzamento não inventa nada (devolve nulo)', Adq15.cruzarAgendaRecebiveis(C(), '2025-12') === null);
  chk('chave de venda: zeros à esquerda, traços e caixa não atrapalham (0001001 = 1001; ab-12 = AB12)', Adq15.keyVenda('0001001', '011', '10848325') === Adq15.keyVenda(1001, 11, 10848325) && Adq15.keyVenda('ab-12', 'x', 't') === Adq15.keyVenda('AB12', 'X', 'T'));
}

/* =====================================================================
   5 · ERP × ADQUIRENTES (Getnet e SafraPay) e KPIs DA TRIANGULAÇÃO
   ===================================================================== */
{
  const E = await cenario(), { Adq14, Adq15 } = E;
  await E.importar(CT.res, E.lido.res); await E.importar(CT.mar, E.lido.mar); await E.importar(CT.saf, E.lido.recJan); await E.importar(CT.saf, E.lido.agJan); await E.importar(CT.saf, E.lido.recFev); await E.gravarErp();
  Adq14.ui.mes = '2026-01'; Adq14.ui.filtro = '*';
  const dg = Adq15.erpDoContrato(Adq14.contrato(CT.res), '2026-01'), dm = Adq15.erpDoContrato(Adq14.contrato(CT.mar), '2026-01'), ds = Adq15.erpDoContrato(Adq14.contrato(CT.saf), '2026-01');
  chk('ERP filtrado por contrato: Getnet Resilienza = só lojas 01/02 da Getnet; Mar Aberto = só loja 03; SafraPay = só lojas 05, 28 e 31 da SafraPay (nunca a Getnet nem outra loja)', dg.grupos.every(g => g.adqNome === 'GETNET' && g.loja === '1') && dg.grupos.reduce((s, g) => s + g.bruto, 0) === ERP_BRUTO_GETNET_RES && dm.grupos.every(g => g.loja === '3') && dm.grupos.reduce((s, g) => s + g.bruto, 0) === ERP_BRUTO_GETNET_MAR && ds.grupos.every(g => g.adqNome === 'SAFRAPAY' && ['5', '28', '31'].includes(g.loja)) && ds.grupos.reduce((s, g) => s + g.bruto, 0) === ERP_BRUTO_SAFRA, [dg.esc.tipo, dm.esc.tipo, ds.esc.tipo]);
  const T = Adq15.triangular('2026-01', '*'), oR = T.contratos.find(o => o.contrato.id === CT.res), oM = T.contratos.find(o => o.contrato.id === CT.mar), oS = T.contratos.find(o => o.contrato.id === CT.saf);
  const sit = (o, d, b, m = 'credito') => o.linhas.find(l => l.data === d && l.band === b && (m === null || l.mod === m));
  // ---- Getnet: Dt Venda + Bandeira + Modalidade, somando OP = VE + OP = CX
  chk('ERP × Getnet: Visa crédito 3x de 05/01 = ERP VE 2.950 + CX 50 = 3.000 contra 3.000 da Getnet → Conciliado; débito e Mar Aberto também fecham', sit(oR, '2026-01-05', 'VISA').status === 'ok' && sit(oR, '2026-01-05', 'VISA').erp === 3000 && sit(oR, '2026-01-05', 'VISA').ve === 2950 && sit(oR, '2026-01-05', 'VISA').cx === 50 && sit(oR, '2026-01-05', 'VISA', 'debito').status === 'ok' && sit(oR, '2026-01-12', 'VISA', 'debito').status === 'ok' && oM.k.ok === 2 && oM.k.dif + oM.k.semAdq + oM.k.semErp === 0, oR.linhas);
  chk('ERP × Getnet: Mastercard crédito de 05/01 com R$ 10,00 a mais no ERP (2.010 × 2.000) = Diferença ERP × Getnet; Elo de 12/01 só no ERP (77) = ERP sem venda na Getnet', sit(oR, '2026-01-05', 'MASTER').status === 'dif' && perto(sit(oR, '2026-01-05', 'MASTER').dif, 10) && sit(oR, '2026-01-12', 'ELO').status === 'semAdq' && perto(sit(oR, '2026-01-12', 'ELO').erp, 77) && oR.k.ok === 3 && oR.k.dif === 1 && oR.k.semAdq === 1, oR.k);
  const cel = (e, a) => Adq15.compararCelulas(new Map([['2026-01-05|VISA|debito', { bruto: e, n: 1 }]]), new Map([['2026-01-05|VISA|debito', { bruto: a, n: 1 }]]))[0].status;
  chk('tolerância de ± R$ 0,50 por dia: 0,40 e −0,50 conciliam (centavos exatos); 0,60 é diferença', cel(100040, 100000) === 'ok' && cel(99950, 100000) === 'ok' && cel(100060, 100000) === 'dif' && E.ADQ15.TOL_ERP === 0.5);
  chk('antecipação do ERP × estimada pelo contrato (Getnet 100% antecipado): 30,25 + 91,57 do ERP = 30,25 + 91,57 do contrato → dentro da tolerância', oR.ant && perto(oR.ant.erp, 121.82) && perto(oR.ant.est, 121.82, 0.05) && oR.ant.nDif === 0, oR.ant);
  const E5 = await cenario(); await E5.importar(CT.res, E5.lido.res); await E5.gravarErp(E5.Adq15.lerErpLinhas(erpRows(ERP_LINHAS.map(l => l[4] === 'GETNET MASTERCARD CREDITO A VISTA' ? [...l.slice(0, 9), 45, ...l.slice(10)] : l)), 'ant.xlsx'));
  const oR5 = E5.Adq15.triangular('2026-01', CT.res).contratos[0];
  chk('antecipação do ERP muito diferente da estimada (45,00 × 30,25) é sinalizada: 1 dia fora da tolerância (a maior entre R$ 1,00 e 1%)', oR5.ant.nDif === 1 && oR5.ant.dias.find(d => !d.ok).data === '2026-01-05' && perto(oR5.ant.dias.find(d => !d.ok).dif, 45 + 91.57 - 121.82, 0.05), oR5.ant);
  // ---- SafraPay: ERP × Agenda de Vendas (Dt Venda + Bandeira) por loja ligada ao contrato
  chk('ERP × Agenda SafraPay: 05/01 Mastercard (lojas 05 + 28 = 1.300), 06/01 Visa (1.200), 30/01 e 31/01 conferem; o dia sem Agenda (07/01, 500) e a venda sem ERP (20/01 Amex, 90) são sinalizados', sit(oS, '2026-01-05', 'MASTER', '').status === 'ok' && sit(oS, '2026-01-05', 'MASTER', '').erp === 1300 && sit(oS, '2026-01-06', 'VISA', '').status === 'ok' && sit(oS, '2026-01-30', 'MASTER', '').status === 'ok' && sit(oS, '2026-01-31', 'ELO', '').status === 'ok' && sit(oS, '2026-01-07', 'VISA', '').status === 'semAdq' && sit(oS, '2026-01-20', 'AMEX', '').status === 'semErp' && oS.k.ok === 5 && oS.k.semAdq === 1 && oS.k.semErp === 1, oS.k);
  chk('modalidade diferente: 05/01 Elo fecha o valor (80 × 80) mas o ERP diz Crédito e a Agenda diz Débito → sinalizada (modDif), sem virar diferença de valor', sit(oS, '2026-01-05', 'ELO', '').status === 'ok' && sit(oS, '2026-01-05', 'ELO', '').modDif === true && sit(oS, '2026-01-05', 'ELO', '').erpCre === 80 && sit(oS, '2026-01-05', 'ELO', '').agDeb === 80 && oS.k.modDif === 1);
  chk('Agenda × Recebíveis acompanha o contrato SafraPay no painel de triangulação (liquidadas, vencidas) e o líquido esperado vem dos Recebíveis', oS.agCruz && oS.agCruz.tot.liquidada === 6 && oS.calc && perto(oS.calc.k.esperado, 2378.7), oS.agCruz?.tot);
  // ---- KPIs
  const K = T.kpis, A = T.A;
  const difEsperada = (ERP_BRUTO_GETNET_RES - 6100) + 0 + (ERP_BRUTO_SAFRA - AG_JAN_BRUTO);
  chk(`KPIs: Bruto ERP ${ERP_BRUTO_TRI} (Getnet + SafraPay; sem contrato da Credsystem no cenário) | Bruto Adquirente 10.040 (Getnet 6.100 + 1.000, Agenda SafraPay 2.940) | Diferença ERP × Adquirente ${difEsperada} (10 + 77 da Getnet; 500 − 90 da SafraPay)`, perto(K.brutoErp, ERP_BRUTO_TRI) && perto(K.brutoAdq, 6100 + 1000 + AG_JAN_BRUTO) && perto(K.dif, difEsperada) && K.comparaveis === 3 && K.contratos === 3, K);
  chk('KPIs: Líquido Esperado e Crédito Confirmado no OFX vêm da auditoria de repasse (A.k.esperado e A.cruz.kpis); Furo / Divergência = furo + a menor + a maior', perto(K.esperado, A.k.esperado) && perto(K.creditado, A.cruz.kpis.creditado) && perto(K.divergencia, A.cruz.kpis.vFuro + A.cruz.kpis.vMenor + A.cruz.kpis.vMaior) && K.furo === A.cruz.kpis.furo, K);
  const Tm = Adq15.triangular('2026-01', CT.mar); chk('filtro por contrato: só Mar Aberto (ERP 1.000 × Getnet 1.000, diferença 0)', Tm.contratos.length === 1 && perto(Tm.kpis.brutoErp, 1000) && perto(Tm.kpis.brutoAdq, 1000) && perto(Tm.kpis.dif, 0) && Tm.kpis.comparaveis === 1);
  const I = T.info; chk('resumo informativo do mês: QR-LINX R$ 150 e CREDNOSSO R$ 80 só informativos; sem contrato da Credsystem ela aparece em "outras" (2 linhas, R$ 1.110) e nada é descartado', perto(I.info['QR-LINX'].bruto, 150) && perto(I.info.CREDNOSSO.bruto, 80) && Object.keys(I.excl).length === 0 && !('CREDSYSTEM' in I.info) && I.outras.CREDSYSTEM.n === 2 && perto(I.outras.CREDSYSTEM.bruto, ERP_BRUTO_CRED), I);
  // ---- vínculo de lojas: tirar as lojas 28 e 31 do contrato SafraPay
  const E6 = await cenario(); await E6.importar(CT.saf, E6.lido.recJan); await E6.importar(CT.saf, E6.lido.agJan); await E6.gravarErp();
  await E6.Adq15.salvarVinculos(CT.saf, { lojas: '5', ecs: '1454475, 1454475' });
  const c6 = E6.S.adq_contratos.get(CT.saf), T6 = E6.Adq15.triangular('2026-01', '*'), s6 = T6.contratos.find(o => o.contrato.id === CT.saf);
  chk('vínculo de lojas editado (só a loja 05): o ERP das lojas 28 e 31 sai do contrato (05/01 Mastercard passa a dar diferença: ERP 1.000 × Agenda 1.300) e as lojas ficam listadas como "sem contrato"; ECs repetidos são unificados e lojas gravadas como 05', igual(c6.lojas, ['05']) && igual(c6.ecs, ['1454475']) && s6.linhas.find(l => l.data === '2026-01-05' && l.band === 'MASTER').status === 'dif' && T6.semContrato.filter(x => x.adq === 'SAFRAPAY').map(x => x.loja).sort().join() === '28,31' && perto(T6.semContrato.find(x => x.loja === '28').bruto, 300) && perto(T6.semContrato.find(x => x.loja === '31').bruto, 1120), [c6.lojas, T6.semContrato]);
  const E7 = await cenario(); await E7.importar(CT.res, E7.lido.res); await E7.importar(CT.mar, E7.lido.mar); await E7.gravarErp();
  await E7.Adq15.salvarVinculos(CT.mar, { lojas: '', ecs: '' }); const T7 = E7.Adq15.triangular('2026-01', '*'), m7 = T7.contratos.find(o => o.contrato.id === CT.mar);
  chk('dois contratos Getnet e um sem lojas ligadas: o ERP dele NÃO é adivinhado — fica "sem lojas ligadas" (não comparável) e a loja 03 aparece como sem contrato', m7.esc.tipo === 'sem' && !m7.comparavel && T7.semContrato.some(x => x.adq === 'GETNET' && x.loja === '3') && T7.contratos.find(o => o.contrato.id === CT.res).comparavel);
  const E8 = await cenario(); E8.S.adq_contratos.delete(CT.mar); E8.S.adq_contratos.set(CT.res, { ...E8.S.adq_contratos.get(CT.res), lojas: [] }); E8.bump('adq_contratos'); await E8.importar(CT.res, E8.lido.res); await E8.gravarErp();
  chk('contrato único da adquirente sem lojas informadas recebe o ERP inteiro dela (Getnet: lojas 01 e 03 juntas, sem Safra)', E8.Adq15.erpDoContrato(E8.Adq14.contrato(CT.res), '2026-01').esc.tipo === 'todas' && E8.Adq15.erpDoContrato(E8.Adq14.contrato(CT.res), '2026-01').grupos.reduce((s, g) => s + g.bruto, 0) === ERP_BRUTO_GETNET_RES + ERP_BRUTO_GETNET_MAR);
  const E9 = await cenario(); E9.S.adq_contratos.set('adq-getnet__emp-mar-aberto', { ...E9.S.adq_contratos.get(CT.mar), lojas: ['01', '03'] }); E9.bump('adq_contratos');
  chk('loja ligada a dois contratos da mesma adquirente é apontada como conflito (o ERP seria contado duas vezes)', E9.Adq15.conflitosLojas().length === 1 && E9.Adq15.conflitosLojas()[0].loja === '1' && E9.Adq15.conflitosLojas()[0].contratos.length === 2);
  // ---- cobertura parcial do ERP: o dia que o arquivo não cobre não vira divergência
  const E10 = await cenario(); await E10.importar(CT.res, E10.lido.res); await E10.gravarErp(E10.Adq15.lerErpLinhas(erpRows(ERP_LINHAS.filter(l => l[1] === '05/01/2026' && l[0] === '01')), 'só 05-01.xlsx'));
  const o10 = E10.Adq15.triangular('2026-01', CT.res).contratos[0], l12 = o10.linhas.find(l => l.data === '2026-01-12');
  chk('ERP que cobre só 05/01: o dia 12/01 da Getnet vira "dia fora da cobertura do ERP importado" (informativo), NÃO "Getnet sem venda no ERP"; a diferença do KPI só conta o que está dentro da cobertura', l12.status === 'foraErp' && o10.k.semErp === 0 && o10.k.foraErp >= 1 && perto(o10.k.cmpErp - o10.k.cmpAdq, 10), [o10.k, l12]);
  const E11 = await cenario(); await E11.importar(CT.res, E11.lido.res);
  chk('sem o ERP do mês: nada quebra — contrato "ERP não importado", KPIs de ERP zerados e a conferência com o banco segue', (() => { const t = E11.Adq15.triangular('2026-01', '*'); return t.kpis.brutoErp === 0 && t.kpis.comparaveis === 0 && t.kpis.brutoAdq === 6100 && t.contratos.every(o => !o.comparavel); })());
  // ---- tela
  Adq14.ui.mes = '2026-01'; Adq14.ui.filtro = '*'; Adq14.ui.soDiv = true; await Adq14.carregarBanco(true); await espera();
  const h = Adq14.render();
  chk('tela (recurso ligado): importar ERP, agendas e painel "Triangulação · ERP × Adquirente × Banco (OFX)" com os 6 KPIs, antes da auditoria de taxas e repasse', /ERP · Apuração dos Créditos/.test(h) && /Agenda de Vendas da SafraPay/.test(h) && /Triangulação · ERP × Adquirente × Banco \(OFX\)/.test(h) && ['Bruto ERP', 'Bruto Adquirente', 'Diferença ERP × Adquirente', 'Líquido Esperado \\(após MDR e Antecipação\\)', 'Crédito Confirmado no OFX', 'Furo / Divergência de Repasse'].every(k => new RegExp(k).test(h)) && h.indexOf('Triangulação') < h.indexOf('Auditoria · Adquirente × Banco (OFX)'), h.length);
  chk('tela: mostra Conciliado/Diferença ERP × Getnet, modalidade diferente, Agenda × Recebíveis (liquida no mês seguinte) e o aviso de loja sem contrato', /Diferença ERP × Adquirente/.test(h) && /modalidade diferente/.test(h) && /liquida no mês seguinte/.test(h) && /Pendente \(prazo vencido\)/.test(h) && /enquanto não houver contrato dela/.test(h), '');
  chk('tela: a importação do ERP cita a Credsystem (conciliada direto com o OFX pela Dt Crédito) e a SafraPay oferece escolher "planilha da SafraPay" (Agenda ou Recebíveis)', Adq14.renderImportar().includes('Escolher planilha da SafraPay (.xlsx)') && /Agenda de Vendas/.test(Adq14.renderImportar()));
  Adq14.ui.contrato = CT.saf; chk('tela: seletor de mês inclui meses só com ERP/Agenda (venda) além dos lotes', Adq14.mesesComLote().includes('2026-01') && Adq14.mesesComLote().includes('2026-02'));
  Adq15.exportarCsv(); const [nomeCsv, blobCsv] = E.baixados.at(-1) || [], txtCsv = blobCsv ? await blobCsv.text() : '', bomCsv = blobCsv ? [...new Uint8Array(await blobCsv.arrayBuffer()).slice(0, 3)].join() : '';
  chk('exportar .csv da triangulação (KPIs, divergências ERP × adquirente, modalidade, antecipação, Agenda pendente), com BOM, ";" e vírgula decimal', nomeCsv === 'triangulacao_erp_adquirente_ofx_2026-01.csv' && bomCsv === '239,187,191' && /KPI;Consolidado;2026-01;;;10537;10040;497;/.test(txtCsv) && /ERP × Getnet;.*;2026-01-05;/.test(txtCsv) && /Modalidade diferente/.test(txtCsv) && /Agenda × Recebíveis;.*Pendente \(prazo vencido\) · NSU 3001/.test(txtCsv) && /Antecipação ERP × contrato|ERP × Agenda SafraPay/.test(txtCsv), txtCsv.slice(0, 900));
  // leitura de arquivo: SafraPay auto-detecta o layout (flag ligada) · CSV continua recusado
  chk('lerArquivo: com o recurso ligado a SafraPay aceita .xlsx (qualquer dos 2 layouts) e continua recusando .csv', await Adq14.lerArquivo({ name: 'a.csv', arrayBuffer: async () => new ArrayBuffer(0) }, 'SAFRAPAY').then(() => false, e => /\.xlsx/.test(e.message) && /Agenda de Vendas/.test(e.message)));
  chk('editor de contrato (recurso ligado) abre com campos de Lojas do ERP e ECs', (() => { Adq14.abrirContrato(CT.saf); return E.modais.length >= 1; })());
}

/* =====================================================================
   6 · BLINDAGEM DA BUSCA NO DFC/OFX (consolidada sob o recurso)
   ===================================================================== */
const comLotes = async (opts = {}) => {
  const E = await cenario(opts), { Adq14 } = E;
  await E.importar(CT.res, E.lido.res); await E.importar(CT.mar, E.lido.mar); await E.importar(CT.saf, E.lido.recJan);
  const cm = Adq14.calcularMes('2026-01'), res = cm.get(Adq14.idLote('GETNET', CNPJ_RES, '2026-01')), saf = cm.get(Adq14.idLote('SAFRAPAY', CNPJ_RES, '2026-01'));
  E.e06 = res.dias[0].valor; E.e13r = res.dias[1].valor; E.s06 = saf.dias[0].valor; E.s07 = saf.dias[1].valor; Adq14.ui.mes = '2026-01'; Adq14.ui.filtro = '*'; Adq14.ui.soDiv = true;
  return E;
};
{
  const E = await comLotes(), { Adq14 } = E;
  E.servidor = { contasBancarias: [...E.S.contasBancarias.values()].map(c => ({ ...c })), extratos: [docOfx('xa', 'ct-a', '2026-01', [tr('a1', '2026-01-06', E.e06, 'CREDITO GETNET LIQUIDACAO'), tr('a2', '2026-01-13', E.e13r, 'CREDITO GETNET LIQUIDACAO'), tr('a3', '2026-01-16', -1, 'TARIFA MANUTENCAO')])] };
  E.S.extratos.clear(); E.S.contasBancarias.clear(); E.bump('extratos'); E.bump('contasBancarias'); Adq14._bancoCarga = null; E.recargas.length = 0; E.assinadas.length = 0;
  const antes = Adq14.auditar('2026-01', '*');
  chk('(Bloco 1) navegador recém-aberto, FCX nunca aberta: o painel sabe que precisa ler do servidor e NÃO acusa furo (tudo "Sem OFX na data")', Adq14.precisaBanco() && antes.cruz.kpis.furo === 0 && antes.cruz.kpis.semofx === antes.cruz.kpis.dias, antes.cruz.kpis);
  const h0 = Adq14.render(); await Adq14._carga; await espera();
  chk('(Bloco 1) abrir a Conciliação dispara a leitura direta do DFC/OFX (contas e extratos) no servidor sozinha, sem abrir o FCX', E.recargas.includes('contasBancarias') && E.recargas.includes('extratos') && E.assinadas.includes('extratos') && E.S.extratos.size === 1, [E.recargas, h0.slice(0, 80)]);
  const A = Adq14.auditar('2026-01', '*'), bA = A.banco.find(b => b.contaId === 'ct-a');
  chk('(Bloco 1) depois da leitura: Resilienza 06/01 e 13/01 conciliadas e o painel "Extratos OFX lidos" lista os 2 créditos como "Casado com Lote" (+ o débito de tarifa lido)', linhaDe(A, CT.res, '2026-01-06').status === 'ok' && linhaDe(A, CT.res, '2026-01-13').status === 'ok' && bA.nTx === 3 && bA.nCred === 2 && bA.nCasados === 2 && bA.creditos.every(c => c.status === 'casado'), bA.creditos);
  let n = E.recargas.length; await Adq14.recalcular(); const rec = E.recargas.slice(n);
  chk('(Bloco 1) Recalcular relê DFC/OFX, contas, a Agenda e o ERP do servidor e refaz o cruzamento', rec.includes('extratos') && rec.includes('contasBancarias') && rec.includes('adq_agendas') && rec.includes('adq_erp') && linhaDe(Adq14.auditar('2026-01', '*'), CT.res, '2026-01-06').status === 'ok', rec);
  n = E.recargas.length; await E.importar(CT.saf, E.lido.agJan); chk('(Bloco 1) importar a Agenda (ou um lote) dispara a releitura dos extratos', E.recargas.slice(n).includes('extratos'), E.recargas.slice(n));
  E.negar = new Set(['extratos']); E.S.extratos.clear(); E.bump('extratos'); Adq14._bancoCarga = null; await Adq14.carregarBanco(); await espera();
  const est = Adq14.bancoEstado(), Ae = Adq14.auditar('2026-01', '*');
  chk('(Bloco 1) servidor recusou os extratos (HTTP 403): erro explícito na tela e os repasses ficam "Sem OFX na data" — nunca "Furo de repasse"', est.erros.length === 1 && /403/.test(est.erros[0].msg) && Ae.cruz.kpis.furo === 0 && /Não foi possível ler do servidor/.test(Adq14.renderAuditoria()));
}
{
  // aviso de conta sem OFX: redação do Bloco 1 sob o recurso; a da v14.14 quando desligado
  const on = await comLotes(), off = await comLotes({ g15: false });
  for (const E of [on, off]) { E.S.extratos.clear(); E.bump('extratos'); E.Adq14._bancoCarga = { em: Date.now(), erros: [], nDocs: 0, nContas: 3, nTx: 0 }; }
  const bOn = on.Adq14.auditar('2026-01', '*').banco.find(b => b.contaId === 'ct-b'), bOff = off.Adq14.auditar('2026-01', '*').banco.find(b => b.contaId === 'ct-b');
  chk('(Bloco 1) conta sem nenhum OFX no período: "Nenhum lançamento OFX encontrado no DFC para a conta Conta B no período (…)" em vez de falso "Furo de repasse"', /^Nenhum lançamento OFX encontrado no DFC para a conta Conta B no período \(01\/01\/2026 a 06\/02\/2026\)\.$/.test(bOn.alerta) && on.Adq14.auditar('2026-01', '*').cruz.kpis.furo === 0, bOn.alerta);
  chk('recurso DESLIGADO: a redação do aviso é a da v14.14 ("… entre 01/01/2026 e 06/02/2026.")', /entre 01\/01\/2026 e 06\/02\/2026\.$/.test(bOff.alerta) && !/no período/.test(bOff.alerta), bOff.alerta);
}
{
  // créditos fracionados do mesmo dia + padrões do histórico (Getnet e SafraPay) + janela D+0..D+2 + virada de mês
  const E = await comLotes(), { Adq14 } = E;
  const f1 = r2(E.e06 * 0.4), f2 = r2(E.e06 * 0.35), f3 = r2(E.e06 - f1 - f2), s1 = r2(E.s06 * 0.6), s2 = r2(E.s06 - s1);
  ofx(E, [docOfx('xa', 'ct-a', '2026-01', [tr('f1', '2026-01-06', f1, 'PAGAMENTO CARTAO DE DEBITO GETNET'), tr('f2', '2026-01-06', f2, 'LIQ GETNET CREDITO'), tr('f3', '2026-01-06', f3, 'ANTECIPACAO GETNET'), tr('f4', '2026-01-13', E.e13r, 'VISA ELECTRON'), tr('f5', '2026-01-16', -1, 'TARIFA MANUTENCAO')]),
    docOfx('xc', 'ct-c', '2026-01', [tr('s1', '2026-01-06', s1, 'CREDITO CARTAO SAFRA'), tr('s2', '2026-01-06', s2, 'LIQ RECEBIVEIS SAFRAPAY'), tr('s3', '2026-01-08', E.s07, 'TED 422 BANCO SAFRA'), tr('s4', '2026-01-12', -1, 'TARIFA')])]);
  const A = Adq14.auditar('2026-01', '*'), a06 = linhaDe(A, CT.res, '2026-01-06'), s06 = linhaDe(A, CT.saf, '2026-01-06'), s07 = linhaDe(A, CT.saf, '2026-01-07');
  chk('(Bloco 1) 3 créditos fracionados da Getnet no mesmo dia (memos PAGAMENTO CARTAO DE DEBITO, LIQ GETNET e ANTECIPACAO GETNET) somam o repasse esperado: Conciliado em D+0', a06.status === 'ok' && a06.dx === 0 && a06.creditos.length === 3 && perto(a06.creditado, E.e06), a06);
  chk('(Bloco 1) 2 créditos fracionados da SafraPay (CREDITO CARTAO e LIQ RECEBIVEIS) somam os Recebíveis do dia 06/01; "TED 422" em D+2 concilia o de 07/01', s06.status === 'ok' && s06.creditos.length === 2 && s07.status === 'ok' && s07.dx === 1, [s06.status, s07.status, s07.dx]);
  const bA = A.banco.find(b => b.contaId === 'ct-a'); chk('(Bloco 1) painel de transparência: todos os créditos da conta (qualquer categoria no DFC) com Data, Conta, Histórico/MEMO, Valor e Status', bA.nCred === 4 && bA.creditos.every(c => c.status === 'casado' && c.hist && c.conta) && /Casado com Lote/.test(Adq14.renderOfxLidos(A)) && /Histórico \/ MEMO/.test(Adq14.renderOfxLidos(A)));
  // histórico sem nenhum padrão conhecido: fecha por valor + data (Getnet) e por valor + data (SafraPay)
  ofx(E, [docOfx('xa', 'ct-a', '2026-01', [tr('n1', '2026-01-06', E.e06, 'TRANSFERENCIA RECEBIDA 000123'), tr('n2', '2026-01-13', E.e13r, 'MAESTRO'), tr('n3', '2026-01-16', -1, 'TARIFA')]),
    docOfx('xc', 'ct-c', '2026-01', [tr('n4', '2026-01-06', E.s06, 'CRED OP 8891'), tr('n5', '2026-01-07', E.s07, 'SAFRAPAY')])]);
  const An = Adq14.auditar('2026-01', '*');
  chk('(Bloco 1) histórico sem padrão conhecido (TRANSFERENCIA RECEBIDA / CRED OP) fecha pelo valor + data nas duas adquirentes; MAESTRO e SAFRAPAY também', linhaDe(An, CT.res, '2026-01-06').status === 'ok' && linhaDe(An, CT.res, '2026-01-13').status === 'ok' && linhaDe(An, CT.saf, '2026-01-06').status === 'ok' && linhaDe(An, CT.saf, '2026-01-07').status === 'ok', An.cruz.linhas.map(l => [l.contratos.join(), l.data, l.status]));
  // débito de POS na mesma data explica o a menor
  ofx(E, [docOfx('xa', 'ct-a', '2026-01', [tr('g1', '2026-01-06', r2(E.e06 - 30), 'CREDITO GETNET LIQUIDACAO'), tr('g2', '2026-01-06', -30, 'DEBITO ALUGUEL POS GETNET'), tr('g3', '2026-01-13', E.e13r, 'CREDITO GETNET LIQUIDACAO')])]);
  const lm = linhaDe(Adq14.auditar('2026-01', '*'), CT.res, '2026-01-06'); chk('(Bloco 1) débito de aluguel de POS na mesma data explica o líquido a menor (Liquidado a Menor explicado pelo POS)', lm.status === 'menor' && lm.explicaPos === 'total' && perto(lm.dif, 30), lm);
  // virada de mês: vendas de 30/01 (sex) e 31/01 (sáb) pagam juntas em 02/02 (seg) — o OFX está em fevereiro
  const V = await cenario(); await V.importar(CT.res, V.lido.virada); await V.Adq14.carregarBanco(true); V.Adq14.ui.mes = '2026-01'; V.Adq14.ui.filtro = '*';
  const lote = V.Adq14.calcularMes('2026-01').get(V.Adq14.idLote('GETNET', CNPJ_RES, '2026-01'));
  chk('(Bloco 1) virada de mês: as vendas de 30/01 e 31/01 geram UM repasse esperado em 02/02 (R$ 792,80 = 495,50 + 297,30)', lote.dias.length === 1 && lote.dias[0].data === '2026-02-02' && perto(lote.dias[0].valor, 792.8), lote.dias);
  ofx(V, [docOfx('xf', 'ct-a', '2026-02', [tr('v1', '2026-02-02', 495.5, 'PAGAMENTO CARTAO DE DEBITO'), tr('v2', '2026-02-02', 297.3, 'PAGAMENTO CARTAO DE DEBITO'), tr('v3', '2026-02-02', 12.34, 'CREDITO SAFRAPAY')])]);
  const Av = V.Adq14.auditar('2026-01', '*'), lv = linhaDe(Av, CT.res, '2026-02-02'), bv = Av.banco.find(b => b.contaId === 'ct-a');
  chk('(Bloco 1) virada de mês: o OFX de fevereiro é lido na auditoria de janeiro (até o 5º dia útil de fevereiro) e os 2 créditos fracionados de 02/02 conciliam o repasse', lv && lv.status === 'ok' && lv.creditos.length === 2 && perto(lv.creditado, 792.8) && bv.ate === '2026-02-06', [lv, bv.ate]);
  chk('(Bloco 1) crédito do OFX que não casa com nenhum lote aparece como "Crédito OFX sem Lote correspondente"', bv.creditos.filter(c => c.status === 'sem_lote').length === 1 && bv.creditos.find(c => c.status === 'sem_lote').valor === 12.34 && /sem Lote correspondente/.test(V.Adq14.renderOfxLidos(Av)));
  // a mesma conta cadastrada duas vezes (Banco + Agência + Conta sem zeros e traços) é lida junto
  const mk = (id, o) => ({ id, ativa: true, ...o }); V.S.contasBancarias.set('ct-a', mk('ct-a', { apelido: 'Conta A', banco: '033', agencia: '0123-4', conta: '0001234', digito: '5' })); V.S.contasBancarias.set('ct-a2', mk('ct-a2', { apelido: 'Conta A (duplicada)', banco: '33', agencia: '123', conta: '1234-5' })); V.bump('contasBancarias');
  ofx(V, [docOfx('xg', 'ct-a2', '2026-02', [tr('w1', '2026-02-02', 495.5, 'PAGAMENTO CARTAO DE DEBITO'), tr('w2', '2026-02-02', 297.3, 'PAGAMENTO CARTAO DE DEBITO')])]);
  const lw = linhaDe(V.Adq14.auditar('2026-01', '*'), CT.res, '2026-02-02'); chk('(Bloco 1) extrato importado na conta "duplicada" (Banco 033 = 33, Agência 0123-4 = 123, Conta 0001234-5 = 1234-5) é lido junto com a conta do contrato', lw && lw.status === 'ok', lw);
}

/* =====================================================================
   7 · SERVIDOR + recurso desligado = v14.14
   ===================================================================== */
{
  const E = await cenario(); await E.importar(CT.saf, E.lido.recJan); await E.importar(CT.saf, E.lido.agJan); await E.gravarErp();
  const agd = strip(E.S.adq_agendas.get(`adq-safrapay__${CNPJ_RES}__2026-01`)), erpM = strip(E.S.adq_erp.get('2026-01:meta')), erpP = strip(E.S.adq_erp.get('2026-01:p0')), erpL = { formato: 'erp-apuracao', competencia: '2026-01', partes: 1, parte: 1, cols: E.ADQ15.ERP_COLS, grupos: [['1', '2026-01-05', '301', 'GETNET', 'VISA', 'debito', 'VE', 1, 1000, 9, 991, 0, 0]], info: [], arquivos: [], resumo: {} }, idA = `adq-safrapay__${CNPJ_RES}__2026-01`;
  const tenta = (f, ...a) => { try { f(...a); return 'ok'; } catch (e) { return e.status || e.message; } };
  chk('validarAgenda: documento do painel aceito; chave de outra competência, outro CNPJ ou outra adquirente (422) — uma agenda não sobrescreve a alheia', tenta(a15.validarAgenda, idA, agd) === 'ok' && tenta(a15.validarAgenda, `adq-safrapay__${CNPJ_RES}__2026-02`, agd) === 422 && tenta(a15.validarAgenda, `adq-safrapay__${CNPJ_MAR}__2026-01`, agd) === 422 && tenta(a15.validarAgenda, `adq-getnet__${CNPJ_RES}__2026-01`, agd) === 422);
  chk('validarAgenda: só SafraPay, formato safra-agenda, CNPJ válido, competência, empresa, conta e lista de vendas obrigatórios (422)', tenta(a15.validarAgenda, idA, { ...agd, adquirente: 'GETNET' }) === 422 && tenta(a15.validarAgenda, idA, { ...agd, formato: 'x' }) === 422 && tenta(a15.validarAgenda, idA, { ...agd, cnpj: '11111111111111' }) === 422 && tenta(a15.validarAgenda, idA, { ...agd, competencia: '2026-13' }) === 422 && tenta(a15.validarAgenda, idA, { ...agd, empresaId: '' }) === 422 && tenta(a15.validarAgenda, idA, { ...agd, contaId: '' }) === 422 && tenta(a15.validarAgenda, idA, { ...agd, vendas: null }) === 422 && tenta(a15.validarAgenda, idA, []) === 422);
  const P2 = (o = {}) => ({ ...erpP, ...o }), G0 = erpP.grupos[0], G1 = (i, v) => G0.map((x, j) => j === i ? v : x), tam = d => Buffer.byteLength(JSON.stringify(d));
  chk('validarErp (formato novo): meta e parte do painel aceitos; id que não confere com a competência ou com o tipo/posição (422); formato, competência, rev e tipo inválidos (422)', tenta(a15.validarErp, '2026-01:meta', erpM) === 'ok' && tenta(a15.validarErp, '2026-01:p0', erpP) === 'ok' && tenta(a15.validarErp, '2026-02:meta', erpM) === 422 && tenta(a15.validarErp, '2026-02:p0', erpP) === 422 && tenta(a15.validarErp, '2026-01:p1', erpP) === 422 && tenta(a15.validarErp, '2026-01:meta', erpP) === 422 && tenta(a15.validarErp, '2026-01:p0', erpM) === 422 && tenta(a15.validarErp, 'lixo', erpM) === 422 && tenta(a15.validarErp, '2026-01:meta', { ...erpM, formato: 'x' }) === 422 && tenta(a15.validarErp, '2026-01:meta', { ...erpM, competencia: '2026-1' }) === 422 && tenta(a15.validarErp, '2026-01:meta', { ...erpM, rev: '' }) === 422 && tenta(a15.validarErp, '2026-01:p0', P2({ grupos: null })) === 422);
  chk('validarErp (formato novo): cada documento ≤ 256 KiB — acima, 413 (limite do banco do Artifact); abaixo, aceito', (() => { const gr = Array.from({ length: 6000 }, (_, k) => G1(7, k + 0.5)); const grande = P2({ grupos: gr.map((g, k) => G1(0, 'L' + String(k).padStart(3, '0')).map((x, j) => j === 7 ? k + 0.55 : x)) }); return tam(grande) > 262144 && tenta(a15.validarErp, '2026-01:p0', grande) === 413 && tam(erpP) < 262144; })());
  chk('validarErp (parte): grupo fora da competência, Loja vazia, Dt Venda/Dt Crédito inválida, DC/OP inválidos, valor que não é número finito, nº de linhas ou índice da descrição inválidos (422); Dt Crédito vazia vale', tenta(a15.validarErp, '2026-01:p0', P2({ grupos: [G1(1, '2026-02-03')] })) === 422 && tenta(a15.validarErp, '2026-01:p0', P2({ grupos: [G1(0, '')] })) === 422 && tenta(a15.validarErp, '2026-01:p0', P2({ grupos: [G1(1, '05/01/2026')] })) === 422 && tenta(a15.validarErp, '2026-01:p0', P2({ grupos: [G1(2, '05/01/2026')] })) === 422 && tenta(a15.validarErp, '2026-01:p0', P2({ grupos: [G1(2, '')] })) === 'ok' && tenta(a15.validarErp, '2026-01:p0', P2({ grupos: [G1(5, 'XX')] })) === 422 && tenta(a15.validarErp, '2026-01:p0', P2({ grupos: [G1(6, 'ZZ')] })) === 422 && tenta(a15.validarErp, '2026-01:p0', P2({ grupos: [G1(7, null)] })) === 422 && tenta(a15.validarErp, '2026-01:p0', P2({ grupos: [G1(9, '1,5')] })) === 422 && tenta(a15.validarErp, '2026-01:p0', P2({ grupos: [G1(12, 0)] })) === 422 && tenta(a15.validarErp, '2026-01:p0', P2({ grupos: [G1(4, 999)] })) === 422 && tenta(a15.validarErp, '2026-01:p0', P2({ grupos: [G0.slice(0, 12)] })) === 422);
  chk('validarErp: a Credsystem (Adq 304) é ACEITA (v14.15.1) — tupla com código 304 e Dt Crédito; resumo com Credsystem no formato antigo também; só o formato e os tamanhos são exigidos', erpP.grupos.some(t => t[3] === '304') && tenta(a15.validarErp, '2026-01:p0', erpP) === 'ok' && tenta(a15.validarErp, '2026-01:p0', P2({ grupos: [G1(3, '304'), G1(3, '304')] })) === 'ok' && tenta(a15.validarErp, '2026-01', { ...erpL, grupos: [[...erpL.grupos[0].slice(0, 2), '304', 'CREDSYSTEM', ...erpL.grupos[0].slice(4)]] }) === 'ok');
  chk('validarErp (formato antigo, v14.15): documento aceito; id diferente da competência do conteúdo (422); grupo fora da competência (422); mais de 40.000 grupos (422); partes __2 a __99 aceitas e __1 recusado', tenta(a15.validarErp, '2026-01', erpL) === 'ok' && tenta(a15.validarErp, '2026-02', erpL) === 422 && tenta(a15.validarErp, '2026-01', { ...erpL, grupos: [[erpL.grupos[0][0], '2026-02-03', ...erpL.grupos[0].slice(2)]] }) === 422 && tenta(a15.validarErp, '2026-01', { ...erpL, grupos: Array(40001).fill(erpL.grupos[0]) }) === 422 && tenta(a15.validarErp, '2026-01__2', erpL) === 'ok' && tenta(a15.validarErp, '2026-01__1', erpL) === 422 && tenta(a15.validarErp, '2026-01', { ...erpL, grupos: null }) === 422);
  chk('validarContratoExtras: lojas e ECs são listas de texto sem repetição e com limite (422); ausentes valem', tenta(a15.validarContratoExtras, {}) === 'ok' && tenta(a15.validarContratoExtras, { lojas: ['05', '28'], ecs: ['1454475'] }) === 'ok' && tenta(a15.validarContratoExtras, { lojas: '05' }) === 422 && tenta(a15.validarContratoExtras, { lojas: ['05', '05'] }) === 422 && tenta(a15.validarContratoExtras, { lojas: ['5', ' '] }) === 422 && tenta(a15.validarContratoExtras, { lojas: Array.from({ length: 301 }, (_, i) => 'L' + i) }) === 422 && tenta(a15.validarContratoExtras, { ecs: ['x'.repeat(31)] }) === 422);
  chk('o contrato com lojas e ECs gravado pelo painel passa no servidor', tenta(a15.validarContratoExtras, strip(E.S.adq_contratos.get(CT.saf))) === 'ok');
  // gancho de documentos.gravar
  const lig = { recursoAtivo: k => k === a15.RECURSO }, desl = { recursoAtivo: () => false }, t = async () => [];
  const gancho = async (s, c, d) => { try { await a15.protegerAdq1415(t, s, c, d); return 'ok'; } catch (e) { return e.status || e.message; } };
  chk('gancho com o recurso DESLIGADO não valida nada (v14.14)', await gancho(desl, 'adq_agendas/lixo', {}) === 'ok' && await gancho(desl, 'adq_erp/lixo', {}) === 'ok' && await gancho(desl, 'adq_contratos/x', { lojas: 'x' }) === 'ok');
  chk('gancho LIGADO valida adq_agendas, adq_erp e os campos novos de adq_contratos; outras coleções passam; ramo de ambiente (amb/homolog/) também', await gancho(lig, 'adq_agendas/lixo', agd) === 422 && await gancho(lig, 'adq_agendas/' + idA, agd) === 'ok' && await gancho(lig, 'adq_erp/2026-01:meta', erpM) === 'ok' && await gancho(lig, 'adq_erp/2026-01:p0', erpP) === 'ok' && await gancho(lig, 'adq_erp/2026-02:p0', erpP) === 422 && await gancho(lig, 'adq_erp/2026-01', erpL) === 'ok' && await gancho(lig, 'adq_contratos/x', { lojas: 'x' }) === 422 && await gancho(lig, 'adq_taxas/x', { a: 1 }) === 'ok' && await gancho(lig, 'config/recursos', {}) === 'ok' && await gancho(lig, 'amb/homolog/adq_erp/2026-02:p0', erpP) === 422 && await gancho(lig, 'amb/homolog/adq_erp/2026-01:p0', erpP) === 'ok');
  chk('chaves idênticas no painel e no servidor: idAgenda = idLote(SAFRAPAY…), idErpMeta (AAAA-MM:meta), idErpParte (AAAA-MM:p<n>) e o formato antigo idErp (competência e partes)', a15.idAgenda(CNPJ_RES, '2026-03') === a14.idLote('SAFRAPAY', CNPJ_RES, '2026-03') && a15.idErpMeta('2026-03') === E.Adq15.idErpMeta('2026-03') && a15.idErpMeta('2026-03') === '2026-03:meta' && a15.idErpParte('2026-03', 4) === E.Adq15.idErpParte('2026-03', 4) && a15.idErpParte('2026-03', 4) === '2026-03:p4' && a15.idErp('2026-03') === E.Adq15.idErp('2026-03') && a15.idErp('2026-03', 2) === E.Adq15.idErp('2026-03', 2) && a15.idErp('2026-03', 2) === '2026-03__2');
  // ACL e backup
  const sess = perms => ({ perms: new Set(perms), perfil: 'OPERACIONAL', nivel: 2 }), can = (p, c, op) => perm.acessoPorMatriz(sess(p), c, op);
  chk('ACL: adq_agendas e adq_erp — ler com retaguarda.adq.ver, gravar só com retaguarda.adq.importar; sem permissão nada; nível admin por padrão', ['adq_agendas', 'adq_erp'].every(c => can(['retaguarda.adq.ver'], c + '/x', 'r') && !can(['retaguarda.adq.ver'], c + '/x', 'w') && can(['retaguarda.adq.importar'], c + '/x', 'w') && !can([], c + '/x', 'r')) && regras.REGRAS.adq_agendas[1] === 'admin' && regras.REGRAS.adq_erp[1] === 'admin', '');
  const bkp = corta('FRENTES: [', '\n  ],').match(/"id": "adquirentes".*"colecoes": (\[[^\]]*\])/), cli = JSON.parse(bkp[1]), srv = escopo.FRENTES.find(f => f.id === 'adquirentes').colecoes;
  chk('backup: a frente "adquirentes" inclui adq_agendas e adq_erp, igual no painel e no servidor (nuvem × .json); o painel só lê/grava as duas com retaguarda.adq.ver', igual(cli, srv) && srv.includes('adq_agendas') && srv.includes('adq_erp') && escopo.frenteDe('adq_agendas') === 'adquirentes' && escopo.frenteDe('adq_erp') === 'adquirentes' && /'conc_fechamento', 'adq_contratos', 'adq_lotes', 'adq_agendas', 'adq_erp'\]/.test(html) && /c === 'adq_agendas' \|\| c === 'adq_erp'\) && !Auth\.can\('retaguarda\.adq\.ver'\)\) continue/.test(html) && /c === 'adq_agendas' \|\| c === 'adq_erp'\) && !Auth\.can\('retaguarda\.adq\.ver'\)\) return false/.test(html), [cli, srv]);
  chk('promoção para Produção: agendas e ERP não são promovidos (dados do ambiente, como contratos e lotes)', !/adq_(agendas|erp)/.test(fs.existsSync(path.join(raiz, 'netlify/lib/ambiente.mjs')) ? fs.readFileSync(path.join(raiz, 'netlify/lib/ambiente.mjs'), 'utf8') : ''));
}
{
  // recurso DESLIGADO (gestao_v1415 off, v14.14 on) = tela e lógica da v14.14
  const off = await cenario({ g15: false }), { Adq14 } = off; await off.importar(CT.res, off.lido.res); await off.importar(CT.saf, off.lido.recJan); Adq14.ui.mes = '2026-01';
  await Adq14.carregarBanco(true);
  const hOff = Adq14.render(), hOrig = Adq14._o15.render.call(Adq14);
  chk('recurso DESLIGADO: a tela da Conciliação é exatamente a da v14.14 (sem ERP, agenda nem triangulação) e as telas auxiliares não mudam', hOff === hOrig && !/Triangulação|ERP · Apuração|Agenda de Vendas da SafraPay/.test(hOff) && Adq14.renderImportar() === Adq14._o15.renderImportar.call(Adq14) && !/Escolher planilha da SafraPay/.test(Adq14.renderImportar()));
  chk('recurso DESLIGADO: a SafraPay lê só "Recebíveis de antecipação" (a Agenda é recusada como na v14.14), o seletor de mês só mostra meses com lote e não relê Agenda/ERP no Recalcular', (() => { let m = ''; try { Adq14.lerSafraLinhas(agJan(), 'agenda.xlsx'); } catch (e) { m = e.message; } return /Não encontrei o cabeçalho da SafraPay/.test(m); })() && igual(Adq14.mesesComLote(), Adq14._o15.mesesComLote.call(Adq14)));
  const n0 = off.recargas.length; await Adq14.recalcular(); chk('recurso DESLIGADO: Recalcular não toca em adq_agendas nem em adq_erp', !off.recargas.slice(n0).some(c => c === 'adq_agendas' || c === 'adq_erp'));
  const gOff = off.ConcMP; chk('recurso DESLIGADO: os ganchos de Contratos/Regras e o editor de contrato são os da v14.14', (() => { const n = off.modais.length; Adq14.abrirContrato(CT.res); return off.modais.length === n + 1 && !/Lojas do ERP/.test(JSON.stringify(off.modais.at(-1))); })() && !/Lojas do ERP e Estabelecimentos/.test(Adq14.renderContratos()));
  const semV14 = ambiente({ g14: false, g15: true }); chk('g15 depende da g14: com a v14.14 desligada, a v14.15 também fica desligada', semV14.Adq15.ativo() === false && !semV14.ConcMP.SUBS72.some(([k]) => k === 'c14'));
}

/* =====================================================================
   8 · v14.15.1 — MÊS REAL (~44 mil linhas → ~14,5 mil agregadas) EM PEDAÇOS DE JSON PURO
       Reproduz o erro "arguments must be plain JSON data within the store's limits" do Artifact: o banco recusa documento > 256 KiB e valor que não seja JSON puro.
   ===================================================================== */
{
  const LIM = 262144; // 256 KiB, o teto do documento no banco do Artifact
  const plano = (v, caminho = '$') => { // JSON puro: só objeto simples, lista, texto, booleano, null e número FINITO (nada de undefined, Date, NaN, Infinity, função)
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return null; if (typeof v === 'number') return Number.isFinite(v) ? null : caminho + ' = ' + v;
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) { const e = plano(v[i], caminho + '[' + i + ']'); if (e) return e; } return null; }
    if (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) { for (const [k, x] of Object.entries(v)) { if (x === undefined) return caminho + '.' + k + ' = undefined'; const e = plano(x, caminho + '.' + k); if (e) return e; } return null; }
    return caminho + ' (' + Object.prototype.toString.call(v) + ')';
  };
  const limitado = E => { const orig = E.Repo.salvar; E.recusados = []; E.Repo.salvar = async (c, id, d, o) => { const ruim = plano(d), tam = Buffer.byteLength(JSON.stringify(d)); if (ruim || tam + 200 > LIM) { E.recusados.push([id, ruim || tam]); throw new Error("arguments must be plain JSON data within the store's limits"); } return orig(c, id, d, o); }; return E; };
  // gerador determinístico de um mês parecido com o real: lojas 1..24 (texto com zero à esquerda e número), 31 dias, 6 descrições, DC × OP → ~14,4 mil combinações distintas
  const rnd = (() => { let a = 20260101; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })(); // mulberry32 (determinístico e bem distribuído)
  const DESCS = [['301', 'GETNET VISA DEBITO'], ['301', 'GETNET MASTERCARD CRÉDITO A VISTA'], ['302', 'SAFRAPAY ELO CREDITO 3X'], ['304', 'CREDSYSTEM CARTAO PROPRIO'], ['301', 'GETNET AMEX CRÉDITO 6X'], ['301', 'GETNET VISA CREDITO A VISTA']];
  const N = 43951, linhas = []; let somaBruto = 0;
  for (let i = 0; i < N; i++) {
    const loja = 1 + Math.floor(rnd() * 24), dia = 1 + Math.floor(rnd() * 31), [cod, desc] = DESCS[Math.floor(rnd() * DESCS.length)], dc = rnd() < 0.55 ? 'DB' : 'CR', op = rnd() < 0.8 ? 'VE' : 'CX', v = Math.round((5 + rnd() * 995) * 100) / 100;
    const dd = String(dia).padStart(2, '0'); somaBruto += v;
    const l = er(i % 3 === 0 ? String(loja).padStart(3, '0') : i % 3 === 1 ? loja : String(loja), `${dd}/01/2026`, cod, desc, v, Math.round(v * 2) / 100, Math.round(v * 98) / 100, i % 7 === 0 ? Math.round(v) / 10 : 0, op, dc);
    if (i % 997 === 0) { l[1] = new Date(Date.UTC(2026, 0, dia, 12)); l[2] = new Date(Date.UTC(2026, 0, dia, 12)); }           // data como Date (o que algumas leituras do Excel entregam)
    if (i % 991 === 0) l[6] = NaN; if (i % 1009 === 0) l[9] = undefined; if (i % 1013 === 0) l[10] = null; if (i % 1019 === 0) l[6] = '#REF!'; // MDR NaN/texto de erro, Antecipação ausente, Tx Extra nula
    linhas.push(l);
  }
  const E = limitado(await cenario()), { Adq15 } = E;
  const t0 = Date.now(), lido = Adq15.lerErpLinhas(erpRows(linhas), 'Apuração dos Créditos jan26.xlsx', 'ApuraCreditos'), msLer = Date.now() - t0, P = lido.periodos[0], nG = P.grupos.length;
  chk(`ERP do mês cheio: ${N} linhas válidas agregadas em ${nG} linhas (Loja × Dt Venda × Dt Crédito × Adq × Descrição × DC × OP) em ${msLer} ms — a ordem de grandeza do arquivo real (~14,2 mil)`, lido.linhas === N && nG >= 13500 && nG <= 15500 && P.qtd === N - (lido.informativo ? Object.values(lido.informativo).reduce((a, x) => a + x.n, 0) : 0) && msLer < 15000, [lido.linhas, nG, msLer]);
  chk('leitura sanitizada: nenhum NaN, undefined, Date ou texto onde se espera número; datas como "AAAA-MM-DD"; Loja sem zeros à esquerda ("005" = 5 = "5")', plano(P.grupos) === null && P.grupos.every(g => /^\d{4}-\d{2}-\d{2}$/.test(g.dv) && /^\d{4}-\d{2}-\d{2}$/.test(g.dcr) && /^[1-9]\d*$/.test(g.loja) && ['bruto', 'mdr', 'liq', 'ant', 'tx'].every(k => typeof g[k] === 'number' && Number.isFinite(g[k]))) && new Set(P.grupos.map(g => g.loja)).size === 24 && P.grupos.length >= 13500, plano(P.grupos));
  chk('Σ Vda Bruta dos grupos = Σ das linhas lidas (nada se perde na agregação)', perto(P.bruto, somaBruto, 0.5) && perto(P.grupos.reduce((s, g) => s + g.bruto, 0), P.bruto, 0.5), [P.bruto, somaBruto]);
  // o problema original: UM documento só com o mês inteiro passa do teto de 256 KiB e é recusado pelo banco
  const umDoc = { formato: 'erp-apuracao', competencia: '2026-01', grupos: P.grupos.map(g => [g.loja, g.dv, g.adqCod, g.adqNome, g.band, g.mod, g.op, g.n, g.bruto, g.mdr, g.liq, g.ant, g.tx]) };
  let recusou = ''; try { await E.Repo.salvar('adq_erp', '2026-01', umDoc); } catch (e) { recusou = e.message; }
  chk(`reprodução do erro: o mês em UM documento (${Math.round(Buffer.byteLength(JSON.stringify(umDoc)) / 1024)} KiB) é recusado pelo armazenamento — "arguments must be plain JSON data within the store's limits"`, /plain JSON data within the store's limits/.test(recusou) && E.S.adq_erp.size === 0, recusou);
  E.recusados.length = 0; // a recusa acima foi provocada de propósito
  const t1 = Date.now(); await E.gravarErp(lido); const msGrav = Date.now() - t1;
  const ids = [...E.S.adq_erp.keys()].sort((a, b) => a.localeCompare(b, 'pt', { numeric: true })), pts = ids.filter(x => /:p\d+$/.test(x)), docs = ids.map(id => E.S.adq_erp.get(id)), tams = docs.map(d => Buffer.byteLength(JSON.stringify(d)));
  chk(`Gravar ERP funciona: ${pts.length} pedaços (2026-01:p0 … :p${pts.length - 1}) + 2026-01:meta em ${msGrav} ms, sem nenhuma recusa do armazenamento e sem aviso de erro`, pts.length >= 4 && ids.includes('2026-01:meta') && ids.length === pts.length + 1 && E.recusados.length === 0 && !E.toasts.some(t => /Não foi possível gravar/.test(t)) && E.toasts.some(t => /ERP gravado: 1 competência/.test(t)), [ids, E.recusados, E.toasts.slice(-3)]);
  chk(`cada documento gravado tem no máximo 250 KB (maior: ${Math.round(Math.max(...tams) / 1024)} KiB; teto do banco 256 KiB) — o resumo (meta) e todos os pedaços`, tams.every(t => t <= 250000 && t + 200 <= LIM) && docs.every(d => plano(d) === null), tams);
  chk('JSON puro de ponta a ponta: JSON.parse(JSON.stringify(doc)) é idêntico ao documento gravado; tuplas [Loja, Dt Venda, Dt Crédito, Adq, descrição, DC, OP, Vda Bruta, MDR, Líquido, Antecipação, Tx Extra, nº]', docs.every(d => igual(JSON.parse(JSON.stringify(d)), d)) && E.S.adq_erp.get('2026-01:p0').grupos.every(t => t.length === 13 && typeof t[0] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t[1]) && /^\d{4}-\d{2}-\d{2}$/.test(t[2]) && typeof t[3] === 'string' && Number.isInteger(t[4]) && ['CR', 'DB'].includes(t[5]) && ['VE', 'CX'].includes(t[6]) && t.slice(7, 12).every(Number.isFinite)));
  chk('o dicionário de descrições mantém a tupla pequena: cada parte guarda cada texto uma vez só (até 6 textos distintos, não 1 por linha)', pts.every(id => E.S.adq_erp.get(id).descs.length <= 6 && E.S.adq_erp.get(id).descs.length >= 1 && E.S.adq_erp.get(id).descs.length === new Set(E.S.adq_erp.get(id).descs).size) && E.S.adq_erp.get('2026-01:p0').grupos.every(t => t[4] < E.S.adq_erp.get('2026-01:p0').descs.length));
  const M = Adq15.loadERP('2026-01');
  chk(`a leitura reassembla os ${pts.length} pedaços (loadERP): mesmo nº de linhas, mesmo bruto, mesmas chaves e valores; mês completo; resumo no meta confere`, M && !M.incompleto && M.partes === pts.length && M.lidas === pts.length && M.grupos.length === nG && perto(M.grupos.reduce((s, g) => s + g.bruto, 0), P.bruto, 0.05) && M.resumo.grupos === nG && M.resumo.partes === pts.length && M.resumo.bytes.length === pts.length && perto(M.resumo.bruto, P.bruto, 0.05), [M?.partes, M?.grupos.length, nG]);
  const ch = g => [g.loja, g.dv, g.dcr, g.adqCod, g.desc, g.dc, g.op].join('|') + '=' + [g.n, g.bruto, g.mdr, g.liq, g.ant, g.tx].join(','), mA = new Map(P.grupos.map(g => [ch(g).split('=')[0], ch(g)])), difs = M.grupos.filter(g => mA.get(ch(g).split('=')[0]) !== ch(g));
  chk('grupo a grupo: o que foi lido do banco é exatamente o que foi gravado (valor, quantidade, descrição, adquirente, bandeira e DC)', difs.length === 0 && M.grupos.every(g => g.adqNome && g.band && ['debito', 'credito'].includes(g.mod)), difs.slice(0, 2));
  chk('o servidor aceita todos os pedaços e o resumo (validarErp: id :meta / :p<n>, ≤ 256 KiB, 13 campos por linha, datas e números válidos)', ids.every(id => { try { a15.validarErp(id, strip(E.S.adq_erp.get(id))); return true; } catch (e) { console.log(id, e.message); return false; } }));
  // defesa em profundidade: o que escapar do leitor é limpo na hora de gravar
  const suja = Adq15.tuplaErp({ loja: '007', dv: new Date('2026-01-05T12:00:00Z'), dcr: undefined, adqCod: 301, dc: 'CR', op: 'VE', bruto: NaN, mdr: Infinity, liq: '12.5', ant: undefined, tx: null, n: 0 }, 0);
  chk('tuplaErp sanitiza: Date → "AAAA-MM-DD"; Loja "007" → "7"; undefined/NaN/Infinity/null → 0; texto numérico → número; Dt Crédito ausente → ""; nº de linhas ≥ 1', igual(suja, ['7', '2026-01-05', '', '301', 0, 'CR', 'VE', 0, 0, 12.5, 0, 0, 1]) && plano(suja) === null, suja);
  chk('dataJ / lojaJ / numJ: número de série do Excel, dd/mm/aaaa, Date inválida, "000" e arredondamento a 2 casas', Adq15.dataJ(46027) === '2026-01-05' && Adq15.dataJ('05/01/2026') === '2026-01-05' && Adq15.dataJ(new Date('x')) === '' && Adq15.dataJ(undefined) === '' && Adq15.lojaJ('000') === '0' && Adq15.lojaJ(' 05 ') === '5' && Adq15.lojaJ('es1') === 'ES1' && Adq15.numJ(1.005 + 1e-9) === 1.01 && Adq15.numJ('abc') === 0 && Adq15.numJ(-0.004) === -0, [Adq15.dataJ(46027), Adq15.numJ(1.005 + 1e-9)]);
  // reimportar um mês menor remove os pedaços que sobraram; reimportar o mesmo dia substitui só o dia
  const antes = new Set(ids), pequeno = Adq15.lerErpLinhas(erpRows(linhas.slice(0, 2500).map(l => { const c = l.slice(); const d = c[1] instanceof Date ? '01/01/2026' : c[1]; c[1] = c[2] = d.replace(/^\d\d/, '01'); return c; })), 'Apuração dos Créditos 01-01.xlsx', 'ApuraCreditos');
  await E.gravarErp(pequeno); const ids2 = [...E.S.adq_erp.keys()], M2 = Adq15.loadERP('2026-01');
  chk('reimportar só o dia 01/01 (arquivo menor) substitui o dia 01 e preserva o resto: o mês continua completo e o nº de pedaços acompanha o conteúdo; nenhum pedaço velho de outra gravação sobra', !M2.incompleto && M2.grupos.some(g => g.dv === '2026-01-31') && M2.lidas === M2.partes && ids2.every(id => id === '2026-01:meta' || (E.S.adq_erp.get(id).rev === E.S.adq_erp.get('2026-01:meta').rev)) && ids2.length === M2.partes + 1, [ids2.length, M2.partes]);
  // sem sobra de pedaços quando o mês encolhe de verdade
  const E2 = limitado(await cenario()); await E2.gravarErp(lido); const nAntes = E2.S.adq_erp.size;
  const so1 = Adq15.lerErpLinhas(erpRows(linhas.slice(0, 600)), 'pouco.xlsx', 'ApuraCreditos'); E2.Adq15.ui.erp = { lido: so1 }; await E2.Adq15.gravarErp();
  const resto = [...E2.S.adq_erp.keys()].sort();
  chk(`mês reimportado muito menor: os pedaços antigos são apagados (${nAntes} documentos → ${resto.length}); só o dia/dias do arquivo novo mudam e o restante do mês antigo permanece completo e legível`, E2.Adq15.loadERP('2026-01').lidas === E2.Adq15.loadERP('2026-01').partes && !E2.Adq15.loadERP('2026-01').incompleto && resto.length <= nAntes && resto.includes('2026-01:meta') && E2.recusados.length === 0, [nAntes, resto]);
  const E3 = limitado(await cenario()); await E3.gravarErp(lido); await E3.Adq15.excluirErp('2026-01'); chk('excluir o mês remove meta e todos os pedaços de uma vez', E3.S.adq_erp.size === 0);
  // mês incompleto (pedaço perdido): a tela e os cálculos NÃO usam o mês pela metade
  const E4 = limitado(await cenario()); await E4.gravarErp(lido); E4.S.adq_erp.delete('2026-01:p2'); E4.bump('adq_erp'); const I4 = E4.Adq15.loadERP('2026-01');
  chk('pedaço perdido: o mês fica marcado como incompleto (faltam: p2), erpGrupos devolve vazio e os cálculos não usam dados parciais', I4.incompleto === true && I4.faltam.join() === '2' && E4.Adq15.erpGrupos('2026-01').length === 0);
}

/* =====================================================================
   9 · v14.15.1 — CREDSYSTEM (Adq 304): ERP × OFX direto, pela Dt Crédito (sem arquivo da adquirente)
   ===================================================================== */
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
{
  const E = await cenarioCred(), { Adq14, Adq15 } = E, c = Adq14.contrato(CT_CRED);
  chk('contrato com Adquirente = Credsystem (Empresa/CNPJ, Conta Bancária do OFX, Lojas do ERP) é aceito pela leitura de contratos; o escopo vem das Lojas do ERP vinculadas', !!c && c.adquirente === 'CREDSYSTEM' && c.contaId === 'ct-d' && Adq15.escopoErp(c).tipo === 'lojas' && Adq15.lojasDe(c).has('1') && Adq15.lojasDe(c).has('2'), c);
  const calc = Adq15.calcCredsystem(c, '2026-01'), dias = Object.fromEntries(calc.dias.map(d => [d.data, d.valor]));
  chk('repasse esperado por Dt Crédito = Σ (Vda Líquida − Antecipação − Tx Extra) das linhas DC = CR menos o mesmo das linhas DC = DB (estorno): 05/01 = 400 · 12/01 = 500 · 13/01 = 1.375 (1.000 + 475 − 100) · 16/01 = 250 · 20/01 = 600 · 22/01 = 700', igual(dias, ESP_CRED), dias);
  chk('Dt Crédito em fim de semana passa para o próximo dia útil (sáb 10/01 → seg 12/01) e soma com a Dt Crédito do próprio dia 12/01; as duas datas ficam no detalhe', calc.erpCred.dias.find(d => d.data === '2026-01-12').dcr.join() === '2026-01-10,2026-01-12' && !('2026-01-10' in dias));
  chk('dia só com estorno (líquido ≤ 0) não gera repasse esperado (21/01 listado à parte); estornos DC = DB: 2 lançamentos e R$ 150 subtraídos', !('2026-01-21' in dias) && calc.erpCred.naoPositivos.join() === '2026-01-21' && calc.erpCred.estornos.n === 2 && perto(calc.erpCred.estornos.valor, 150), calc.erpCred);
  chk('só as lojas ligadas ao contrato e só a Credsystem entram: a loja 03 (R$ 9.999) e a Getnet da loja 01 (R$ 777) ficam de fora; linha sem Dt Crédito é contada à parte (1 linha, R$ 80) e não vira dia esperado', calc.erpCred.lojas.join() === '1,2' && perto(calc.k.bruto, 400 + 300 + 200 + 1000 + 500 + 100 + 250 + 600 + 50 + 700) && calc.erpCred.semDtCredito.n === 1 && perto(calc.erpCred.semDtCredito.bruto, 80), [calc.erpCred.lojas, calc.k.bruto, calc.erpCred.semDtCredito]);
  chk('composição do dia 13/01: Vda Bruta 1.600, Antecipação 20, Tx Extra 5, Estornos 100 → esperado 1.375', (d => d && perto(d.bruto, 1600) && perto(d.ant, 20) && perto(d.tx, 5) && perto(d.estorno, -100) && perto(d.esperado, 1375) && d.n === 3 && d.nEstorno === 1)(calc.erpCred.dias.find(x => x.data === '2026-01-13')), calc.erpCred.dias.find(x => x.data === '2026-01-13'));
  chk('o cálculo é um "lote" do ERP no formato do motor da v14.14 (id <contrato>__erp__<mês>, origem erp, resumo igual ao k) — o Recalcular da v14.14 não o regrava', calc.id === `${CT_CRED}__erp__2026-01` && calc.lote.origem === 'erp' && calc.lote.adquirente === 'CREDSYSTEM' && calc.lote.contaId === 'ct-d' && perto(calc.lote.resumo.esperado, calc.k.esperado) && perto(calc.k.esperado, 3825), [calc.id, calc.lote.resumo, calc.k.esperado]);
  chk('calcularMes do painel (v14.15.1) inclui o cálculo da Credsystem; sem ERP da Credsystem nas lojas do contrato não há cálculo', Adq14.calcularMes('2026-01').has(calc.id) && Adq15.calcCredsystem(c, '2026-02') === null && Adq14.calcularMes('2026-02').size === 0);
  // ---- OFX
  ofx(E, [docOfx('xd', 'ct-d', '2026-01', OFX_CRED)]);
  const A = Adq14.auditar('2026-01', '*'), ln = d => linhaDe(A, CT_CRED, d);
  chk('ERP × OFX: 12/01 = 2 créditos fracionados (CREDSYSTEM 300 + CRED SYSTEM 200) somam o esperado de 500 → Conciliado em D+0', ln('2026-01-12')?.status === 'ok' && ln('2026-01-12').dx === 0 && ln('2026-01-12').creditos.length === 2 && perto(ln('2026-01-12').creditado, 500), ln('2026-01-12'));
  chk('ERP × OFX: 13/01 = "PIX RECEBIDO 04670195000138" (CNPJ da Credsystem no histórico) = 1.375 → Conciliado; a identificação aponta a Credsystem', ln('2026-01-13')?.status === 'ok' && ln('2026-01-13').dx === 0 && perto(ln('2026-01-13').creditado, 1375) && /CREDSYSTEM|PIX|04670195000138/i.test(ln('2026-01-13').ident + JSON.stringify(ln('2026-01-13').creditos)), ln('2026-01-13'));
  chk('ERP × OFX: crédito sem nome ("TRANSFERENCIA RECEBIDA 000999") fecha pelo valor + data (250 em 16/01)', ln('2026-01-16')?.status === 'ok' && perto(ln('2026-01-16').creditado, 250), ln('2026-01-16'));
  chk('ERP × OFX: 20/01 esperado 600 × OFX 580 → Liquidado a menor (dif R$ 20)', ln('2026-01-20')?.status === 'menor' && perto(ln('2026-01-20').dif, 20) && perto(ln('2026-01-20').creditado, 580), ln('2026-01-20'));
  chk('ERP × OFX: 22/01 (qui) com crédito só em 26/01 (seg) = D+2 útil → Conciliado (dx = 2); 05/01 sem nenhum crédito na janela D+0..D+2 → Furo de repasse', ln('2026-01-22')?.status === 'ok' && ln('2026-01-22').dx === 2 && ln('2026-01-05')?.status === 'furo' && perto(ln('2026-01-05').esperado, 400), [ln('2026-01-22'), ln('2026-01-05')]);
  chk('o dia 21/01 (só estorno) não aparece no cruzamento; o tarifa (débito) do OFX não é crédito', !ln('2026-01-21') && A.banco.find(b => b.contaId === 'ct-d').nCred === 6, A.banco.find(b => b.contaId === 'ct-d'));
  // ---- KPIs e tabela
  const T = Adq15.triangular('2026-01', '*'), oc = T.contratos.find(o => o.contrato.id === CT_CRED), kc = A.cruz.porContrato[CT_CRED];
  chk('KPIs do contrato Credsystem: 6 repasses esperados (R$ 3.825), 4 conciliados, 1 a menor, 1 furo; creditado R$ 3.405 (500 + 1.375 + 250 + 580 + 700)', !!oc && !!oc.cred && perto(T.kpis.esperado, 3825) && perto(T.kpis.creditado, 3405) && T.kpis.menor === 1 && T.kpis.furo === 1 && T.kpis.contratos === 4, [T.kpis, kc]);
  chk('a Credsystem aparece no cálculo da triangulação com a fonte "ERP · Dt Crédito" e sem comparação ERP × adquirente (não há arquivo da adquirente): comparavel = false', oc.fonte.startsWith('ERP · Dt Crédito') && oc.comparavel === false && oc.adqBruto === null && oc.erpBruto > 0, [oc.fonte, oc.comparavel]);
  await Adq14.carregarBanco(true); await espera(); const h = Adq14.render();
  chk('tela: bloco "ERP × OFX direto (Dt Crédito)" da Credsystem com Repasse esperado em, Antecipação, Tx Extra, Estornos (DB), o dia 13/01 e o status de cada repasse; o botão de reimportar/excluir some (o ERP é a fonte)', /ERP × OFX direto \(Dt Crédito\)/.test(h) && /Repasse esperado em/.test(h) && /Estornos \(DB\)/.test(h) && /13\/01\/2026/.test(h) && /vem do ERP \(Dt Crédito\)/.test(h) && !new RegExp('data-id="' + CT_CRED.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '__erp__2026-01"').test(h), [/ERP × OFX direto \(Dt Crédito\)/.test(h), /Repasse esperado em/.test(h), /Estornos \(DB\)/.test(h), /13\/01\/2026/.test(h), /vem do ERP \(Dt Crédito\)/.test(h), h.length]);
  chk('tabela "Por contrato": a linha da Credsystem entra normalmente (repasse esperado, creditado, divergência)', /CREDSYSTEM/.test(h) && /Resilienza/.test(h));
  // padrões do OFX
  const pad = Adq14.padroes().get('adq-credsystem');
  chk('padrões de OFX da Credsystem: CREDSYSTEM, CRED SYSTEM e o CNPJ 04670195000138 (também em "PIX RECEBIDO 04670195000138")', !!pad && ['CREDSYSTEM', 'CRED SYSTEM', '04670195000138'].every(x => pad.pre.includes(x)) && (t => Adq14.bate(' ' + E.AdqTaxas.chave(t), pad))('PIX RECEBIDO 04670195000138') && Adq14.bate(' ' + E.AdqTaxas.chave('CRED SYSTEM LTDA'), pad) && !Adq14.bate(' ' + E.AdqTaxas.chave('PIX RECEBIDO 12345678000199'), pad), pad);
  // ---- Dt Crédito em feriado e fim de semana (abril: Tiradentes 21/04 e Sexta-feira Santa 03/04)
  const abr = Adq15.lerErpLinhas(erpRows([erc('01', '02/04/2026', '03/04/2026', 100, 100, 0, 0, 'VE', 'CR'), erc('01', '20/04/2026', '21/04/2026', 200, 200, 0, 0, 'VE', 'CR'), erc('02', '17/04/2026', '18/04/2026', 300, 300, 0, 0, 'VE', 'CR')]), 'abril.xlsx', 'ApuraCreditos'); await E.gravarErp(abr);
  const cA = Adq15.calcCredsystem(Adq14.contrato(CT_CRED), '2026-04'), dA = Object.fromEntries(cA.dias.map(d => [d.data, d.valor]));
  chk('Dt Crédito em feriado ou fim de semana vai para o próximo dia útil: sexta-feira santa 03/04 → seg 06/04; Tiradentes 21/04 → qua 22/04; sábado 18/04 → seg 20/04', igual(dA, { '2026-04-06': 100, '2026-04-20': 300, '2026-04-22': 200 }), dA);
  // ---- sem Dt Crédito no arquivo: usa o Vencimento; sem as duas, nada a esperar
  const semCol = Adq15.lerErpLinhas([['Loja', 'Dt Venda', 'Adq', 'Descrição', 'Vda Bruta', 'MDR', 'Vda Líquida', 'Vencimento', 'Antecipação', 'Tx Extra', 'OP', 'DC'], ['01', '12/01/2026', '304', 'CREDSYSTEM', 90, 0, 90, '14/01/2026', 0, 0, 'VE', 'CR']], 'sem-dtcred.xlsx');
  chk('arquivo sem a coluna Dt Crédito: o Vencimento faz o papel dela (Dt Crédito = 14/01)', semCol.periodos[0].grupos[0].dcr === '2026-01-14');
  // ---- contrato sem lojas e único da Credsystem: recebe o ERP inteiro dela
  const E2 = await cenarioCred(); E2.S.adq_contratos.set(CT_CRED, { ...E2.S.adq_contratos.get(CT_CRED), lojas: [] }); E2.bump('adq_contratos');
  const c2 = E2.Adq14.contrato(CT_CRED), calc2 = E2.Adq15.calcCredsystem(c2, '2026-01');
  chk('contrato único da Credsystem sem lojas informadas recebe o ERP inteiro dela (inclui a loja 03: R$ 9.999 → 13/01 passa a 11.374), sem a Getnet', E2.Adq15.escopoErp(c2).tipo === 'todas' && perto(calc2.dias.find(d => d.data === '2026-01-13').valor, 1375 + 9999), calc2.dias.map(d => [d.data, d.valor]));
  // ---- dois contratos Credsystem: lojas diferentes → cada um com as suas; sem lojas → "sem escopo" (nada calculado)
  const E3 = await cenarioCred(); E3.S.adq_contratos.set('adq-credsystem__emp-mar-aberto', { id: 'adq-credsystem__emp-mar-aberto', adquirente: 'CREDSYSTEM', empresaId: 'mar-aberto', contaId: 'ct-b', ativo: true, lojas: ['03'] }); E3.bump('adq_contratos');
  const m3 = E3.Adq14.calcularMes('2026-01'), cm = m3.get('adq-credsystem__emp-mar-aberto__erp__2026-01');
  chk('dois contratos da Credsystem com lojas diferentes: cada um recebe só as suas (Mar Aberto = loja 03, R$ 9.999 em 13/01); o da Resilienza segue igual', cm && cm.dias.length === 1 && cm.dias[0].data === '2026-01-13' && perto(cm.dias[0].valor, 9999) && perto(m3.get(`${CT_CRED}__erp__2026-01`).dias.find(d => d.data === '2026-01-13').valor, 1375));
  E3.S.adq_contratos.set(CT_CRED, { ...E3.S.adq_contratos.get(CT_CRED), lojas: [] }); E3.bump('adq_contratos');
  chk('com dois contratos da Credsystem e um deles sem lojas, o ERP não é contado duas vezes: o sem lojas não calcula nada (escopo "sem")', E3.Adq15.escopoErp(E3.Adq14.contrato(CT_CRED)).tipo === 'sem' && !E3.Adq14.calcularMes('2026-01').has(`${CT_CRED}__erp__2026-01`));
  // ---- resumo informativo
  const I = Adq15.resumoInformativo('2026-01'); chk('com contrato da Credsystem, ela sai de "outras adquirentes" do resumo informativo (QR-LINX e CREDNOSSO seguem informativos)', !I.outras.CREDSYSTEM);
  // ---- recurso desligado = v14.14 (a Credsystem não entra nos cálculos; padrões iguais aos da v14.14)
  const off = await cenarioCred({ g15: false }); ofx(off, [docOfx('xd', 'ct-d', '2026-01', OFX_CRED)]);
  await off.Adq14.carregarBanco(true); await espera();
  const pOff = off.Adq14.padroes().get('adq-credsystem'), pOrig = off.Adq14._o15.padroes.call(off.Adq14).get('adq-credsystem');
  chk('recurso DESLIGADO: o cálculo do mês não traz a Credsystem, os padrões de OFX são os da v14.14 (sem o CNPJ nem as variações da v14.15.1) e a tela é a da v14.14', off.Adq14.calcularMes('2026-01').size === 0 && igual(pOff, pOrig) && !(pOff?.pre || []).includes('04670195000138') && off.Adq14.render() === off.Adq14._o15.render.call(off.Adq14), [off.Adq14.calcularMes('2026-01').size, pOff, pOrig]);
}

/* =====================================================================
   10 · v14.15.1 — TELA ÚNICA: com a v14.14 ativa a Auditoria de Adquirentes tem só 3 sub-abas e abre na Conciliação de Cartões (por Contrato / CNPJ);
        a sub-aba legada "Conciliação e Cruzamento" e o link do motor original ficam ocultos; com a v14.14 desligada tudo continua como era
   ===================================================================== */
{
  const E = ambiente(), { ConcMP } = E, orig = ConcMP._o1415.renderCredito;
  /* o "original" desenha a barra de sub-abas a partir de SUBS72, como o painel real, e o link do motor original quando a sub-aba legada está aberta */
  ConcMP._o1415.renderCredito = function () { return `<div class="seg cmp-subs">${this.SUBS72.map(([k, r]) => `<button data-a="cmp-sub" data-v="${k}">${r}</button>`).join('')}</div><p>ORIGINAL ${this.ui.sub}${this.ui.motorOriginal ? ' motorOriginal' : ''}</p>${this.ui.sub === 'cruzamento' ? '<button data-a="cmp-cz-original" data-v="1">Abrir o motor original ERP × adquirente × banco</button>' : ''}`; };
  const NOMES = ['Conciliação de Cartões (por Contrato / CNPJ)', 'Regras de Taxa Contratuais', 'Resumo do Fechamento'];
  chk('com a v14.14 ativa, a Auditoria de Adquirentes tem exatamente 3 sub-abas, nesta ordem: Conciliação de Cartões (por Contrato / CNPJ) · Regras de Taxa Contratuais · Resumo do Fechamento', igual(ConcMP.SUBS72.map(x => x[0]), ['c14', 'regras', 'resumo']) && igual(ConcMP.SUBS72.map(x => x[1]), NOMES), ConcMP.SUBS72);
  ConcMP.ui.sub = 'motor'; const h1 = ConcMP.renderCredito();
  chk('quem ainda não escolheu aba (valor de fábrica "motor") abre direto na primeira: Conciliação de Cartões (por Contrato / CNPJ), sub-aba c14', ConcMP.ui.sub === 'c14' && /ORIGINAL c14/.test(h1), [ConcMP.ui.sub, h1]);
  chk('a barra mostra só as 3 sub-abas: nenhuma "Conciliação e Cruzamento", nenhum botão data-v="cruzamento" e nenhum link "Abrir o motor original ERP × adquirente × banco"', NOMES.every(n => h1.includes(n)) && (h1.match(/data-a="cmp-sub"/g) || []).length === 3 && !/Conciliação e Cruzamento|data-v="cruzamento"|cmp-cz-original|Abrir o motor original/.test(h1), h1);
  ConcMP.ui.sub = 'cruzamento'; ConcMP.ui.motorOriginal = true; const h2 = ConcMP.renderCredito();
  chk('estado antigo (sub-aba "cruzamento", inclusive com o motor original aberto) cai na Conciliação por Contrato / CNPJ: o motor legado não é desenhado e o link do motor original não existe', ConcMP.ui.sub === 'c14' && ConcMP.ui.motorOriginal === false && /ORIGINAL c14/.test(h2) && !/ORIGINAL cruzamento|motorOriginal|cmp-cz-original|Conciliação e Cruzamento/.test(h2), [ConcMP.ui.sub, h2]);
  ConcMP.ui.sub = 'regras'; ConcMP.renderCredito(); chk('a escolha do usuário é respeitada: Regras de Taxa Contratuais e Resumo do Fechamento não são trocadas', ConcMP.ui.sub === 'regras' && (ConcMP.ui.sub = 'resumo', ConcMP.renderCredito(), ConcMP.ui.sub === 'resumo'));
  for (const v of ['ecs', 'auditoria']) { ConcMP.ui.sub = v; ConcMP.renderCredito(); chk(`sub-aba antiga "${v}" continua indo para as Regras de Taxa Contratuais`, ConcMP.ui.sub === 'regras'); }
  ConcMP.ui.sub = 'qualquer-coisa'; ConcMP.renderCredito(); chk('valor desconhecido abre a Conciliação por Contrato / CNPJ', ConcMP.ui.sub === 'c14');
  // sem permissão de ver a Auditoria de Adquirentes (retaguarda.adq.ver) o perfil não enxerga a tela nova: nada é escondido nem trocado
  E.pode = k => k !== 'retaguarda.adq.ver'; ConcMP.ui.sub = 'cruzamento'; const hp = ConcMP.renderCredito();
  chk('perfil sem retaguarda.adq.ver não perde a sub-aba de fábrica: a lista, a sub-aba e o desenho seguem os da v14.13', ConcMP.SUBS72.map(x => x[0]).join() === 'cruzamento,regras,resumo' && ConcMP.ui.sub === 'cruzamento' && /ORIGINAL cruzamento/.test(hp)); E.pode = null;
  ConcMP.v72 = () => false; ConcMP.ui.sub = 'cruzamento'; const h3 = ConcMP.renderCredito(); chk('fora do Módulo 7.2 (v72 desligado) nada muda: sem troca de aba', ConcMP.ui.sub === 'cruzamento' && /ORIGINAL cruzamento/.test(h3));
  ConcMP.v72 = () => true; E.flag = false; ConcMP.ui.sub = 'motor'; ConcMP.ui.motorOriginal = false; const h4 = ConcMP.renderCredito();
  chk('com a v14.14 DESLIGADA a Auditoria de Adquirentes é a de sempre: 3 sub-abas com "Conciliação e Cruzamento" à mostra e a sub-aba de fábrica continua "motor" (nada é ocultado nem trocado)', ConcMP.ui.sub === 'motor' && ConcMP.SUBS72.map(x => x[0]).join() === 'cruzamento,regras,resumo' && /Conciliação e Cruzamento/.test(h4) && /ORIGINAL motor/.test(h4), [ConcMP.ui.sub, ConcMP.SUBS72]);
  ConcMP.ui.sub = 'cruzamento'; const h5 = ConcMP.renderCredito(); chk('com a v14.14 desligada o legado segue acessível, inclusive o link "Abrir o motor original ERP × adquirente × banco"', ConcMP.ui.sub === 'cruzamento' && /cmp-cz-original/.test(h5));
  ConcMP._o1415.renderCredito = orig;
  // o código legado continua no arquivo (Regra de Ouro): só deixa de ser exibido quando a v14.14 está ativa
  chk('o código legado segue intacto no painel (renderCruzamento, renderMotorOriginal, o botão cmp-cz-original e a sub-aba "Conciliação e Cruzamento" na lista de fábrica), só oculto com a v14.14 ativa', /renderCruzamento\(\) \{/.test(html) && /renderMotorOriginal\(\) \{/.test(html) && /data-a="cmp-cz-original" data-v="1">Abrir o motor original ERP × adquirente × banco/.test(html) && /SUBS72: \[\['cruzamento', 'Conciliação e Cruzamento'\]/.test(html));
  chk('a ocultação é do v14.15.1 e só vale com a v14.14 ativa e com a permissão retaguarda.adq.ver; o aviso provisório "Motor legado (v13.74)…" foi retirado, pois a sub-aba deixou de ser alcançável', /Object\.defineProperty\(ConcMP, 'SUBS72'[^\n]*filter\(\(\[k\]\) => k !== 'cruzamento'\)/.test(html) && !/cmp-aviso-legado/.test(html) && /g14\(\) && Auth\.can\('retaguarda\.adq\.ver'\) \? l\.filter/.test(html));
  chk('a sub-aba "Conciliação de Cartões (por Contrato / CNPJ)" (c14) segue definida pela v14.14: o ganho da v14.15.1 é só tirar a legada da lista', /Object\.defineProperty\(ConcMP, 'SUBS72'[^\n]*\[SUBS72_V13\[0\], ADQ14_SUB, \.\.\.SUBS72_V13\.slice\(1\)\]/.test(html) && /\['c14', 'Conciliação de Cartões \(por Contrato \/ CNPJ\)'\]/.test(html));
}

/* =====================================================================
   11 · v14.15.1 — FLUXO ÚNICO EM 3 ETAPAS dentro da Conciliação de Cartões (por Contrato / CNPJ), sem upload de OFX; Credsystem sem arquivo da adquirente
   ===================================================================== */
{
  const E = await cenarioCred(), { Adq14 } = E; ofx(E, [docOfx('xd', 'ct-d', '2026-01', OFX_CRED)]); await Adq14.carregarBanco(true); await espera();
  Adq14.ui.contrato = CT.res; const h = Adq14.render(), at = k => h.indexOf(k);
  const e1 = at('id="a15-etapa1"'), e2 = at('id="a15-etapa2"'), e3 = at('id="a15-etapa3"');
  chk('a tela tem 3 etapas, em ordem: 1 ERP unificado (Apuração dos Créditos) · 2 Adquirente por contrato (com validação de CNPJ) · 3 Extrato bancário (OFX) automático via DFC', e1 >= 0 && e1 < e2 && e2 < e3 && (h.match(/class="a15-etapa"/g) || []).length === 3 && /Etapa 1 — ERP unificado \(Apuração dos Créditos\)/.test(h) && /Etapa 2 — Adquirente por contrato \(com validação de CNPJ\)/.test(h) && /Etapa 3 — Extrato bancário \(OFX\) automático via DFC/.test(h));
  const pErp = at('ERP · Apuração dos Créditos'), pSel = at('id="a14c"'), pTri = at('Triangulação · ERP × Adquirente × Banco (OFX)'), pAud = at('Auditoria · Adquirente × Banco (OFX)'), pOfx = at('Extratos OFX lidos no DFC para esta conta');
  chk('Etapa 1 traz o upload do ERP (uma só planilha, todas as operadoras); Etapa 2 traz a escolha do contrato e o arquivo da adquirente; Etapa 3 traz a triangulação e a auditoria com o quadro "Extratos OFX lidos no DFC"', e1 < pErp && pErp < e2 && e2 < pSel && pSel < e3 && e3 < pTri && pTri < pAud && pAud < pOfx && pOfx > 0, [e1, pErp, e2, pSel, e3, pTri, pAud, pOfx]);
  const files = (h.match(/<input[^>]*type="file"[^>]*>/g) || []), nome = f => (/data-a="([^"]+)"/.exec(f) || [])[1];
  chk('só há dois campos de arquivo na tela: o do ERP (Etapa 1) e o da adquirente (Etapa 2); nenhum campo de upload de OFX (o OFX vem do DFC)', igual(files.map(nome).sort(), ['a14-arq', 'a15-erp-arq']) && !files.some(f => /ofx/i.test(f)) && !/data-a="[^"]*ofx[^"]*"[^>]*type="file"|type="file"[^>]*data-a="[^"]*ofx/i.test(h) && at('data-a="a15-erp-arq"') < e2 && at('data-a="a14-arq"') > e2 && at('data-a="a14-arq"') < e3, files);
  chk('a Etapa 3 diz que não há upload e que o painel lê sozinho os extratos já importados no DFC pela Conta Bancária de cada contrato (D+0 a D+2 dias úteis)', /Não há upload de OFX aqui: o painel lê sozinho os extratos já importados no DFC \(FCX › Extratos OFX\) pela Conta Bancária de Crédito de cada contrato[^<]*D\+0 a D\+2 dias úteis/.test(h));
  chk('a Etapa 2 explica a validação do CNPJ (Getnet divergente é bloqueada; SafraPay registra o aviso do CNPJ do Banco Safra e vincula ao contrato) e que a Credsystem não precisa de arquivo', /Getnet divergente é bloqueada; na SafraPay o CNPJ do cabeçalho é o do Banco Safra, então registra-se o aviso e o lote é vinculado ao contrato\. <b>Credsystem não precisa de arquivo<\/b>: usa direto o ERP\./.test(h));
  // validação do CNPJ antes de gravar (Etapa 2) segue valendo
  const vG = Adq14.validarCnpj(E.lido.res, Adq14.contrato(CT.mar)), vS = Adq14.validarCnpj(E.lido.recJan, Adq14.contrato(CT.saf));
  chk('validação de CNPJ (Etapa 2): arquivo da Getnet de outro CNPJ é BLOQUEADO para o contrato escolhido ("Nada foi gravado"); na SafraPay o CNPJ do cabeçalho é do Banco Safra: só aviso, sem bloqueio, e o lote é vinculado ao contrato', vG.bloqueios.length === 1 && /Nada foi gravado/.test(vG.bloqueios[0]) && vS.bloqueios.length === 0 && vS.avisos.some(a => /não é o do estabelecimento: o lote será vinculado ao CNPJ do contrato/.test(a)), [vG, vS]);
  // Credsystem: aparece na lista de contratos, mas sem arquivo
  chk('o contrato da Credsystem aparece na escolha de contratos como "sem arquivo (usa o ERP)" e num quadro próprio com Conta Bancária (OFX) e Lojas do ERP', /<option value="adq-credsystem__emp-resilienza"[^>]*>CREDSYSTEM · Resilienza[^<]*sem arquivo \(usa o ERP\)<\/option>/.test(h) && /id="a15-cred-sem-arquivo"/.test(h) && /Credsystem · sem arquivo da adquirente/.test(h) && /Conta D/.test(h.slice(at('id="a15-cred-sem-arquivo"'))) && /sem arquivo: ERP \(Adq 304\) × OFX/.test(h) && at('id="a15-cred-sem-arquivo"') < e3, h.slice(at('id="a15-cred-sem-arquivo"'), at('id="a15-cred-sem-arquivo"') + 300));
  Adq14.ui.contrato = CT_CRED; const hc = Adq14.render();
  chk('escolhido o contrato da Credsystem, nenhum arquivo é pedido na Etapa 2 (sem campo da adquirente) e a tela diz que não há nada a enviar; o campo do ERP segue na Etapa 1', !/data-a="a14-arq"/.test(hc) && /data-a="a15-erp-arq"/.test(hc) && /O contrato escolhido acima é da Credsystem: nada a enviar nesta etapa\./.test(hc) && /<option value="adq-credsystem__emp-resilienza" selected>/.test(hc));
  Adq14.ui.contrato = '';
  // sem contrato da Credsystem o quadro não aparece
  const E2 = await cenario(); ofx(E2, []); await E2.Adq14.carregarBanco(true); await espera(); const hs = E2.Adq14.render();
  chk('sem contrato da Credsystem não há quadro "sem arquivo" nem opção extra na escolha de contratos; as 3 etapas continuam', !/a15-cred-sem-arquivo|sem arquivo \(usa o ERP\)/.test(hs) && (hs.match(/class="a15-etapa"/g) || []).length === 3);
  // recurso da v14.15 desligado = tela da v14.14, sem etapas
  const off = await cenarioCred({ g15: false }); const ho = off.Adq14.render();
  chk('recurso gestao_v1415 DESLIGADO: a tela é a da v14.14 (sem etapas, sem quadro da Credsystem, sem campo do ERP)', !/a15-etapa|a15-cred-sem-arquivo|a15-erp-arq/.test(ho) && ho === off.Adq14._o15.render.call(off.Adq14));
}

console.log(`\n${OK.length} ok · ${FAIL.length} falha(s)`);
process.exit(FAIL.length ? 1 : 0);
