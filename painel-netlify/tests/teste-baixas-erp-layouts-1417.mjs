import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/* v14.17 (complemento) · TESTE DOS DOIS LAYOUTS REAIS DE CONTAS A PAGAR / BAIXAS DO ERP (FCX · Saídas e DFC · Desdobramento CNAB)
   Dados 100% fictícios. Código REAL do painel (fatiado de public/index.html) e do FCX (fatiado de public/fcx.html); o SheetJS real abre os arquivos de teste quando está instalado (XLSX_PATH ou `npm i xlsx`);
   sem ele, os testes que dependem de abrir arquivo são marcados como pulados e os demais rodam sobre as matrizes. */
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(process.env.PAINEL_HTML || path.join(raiz, 'public/index.html'), 'utf8');
const fcx = fs.readFileSync(process.env.FCX_HTML || path.join(raiz, 'public/fcx.html'), 'utf8');
const OK = [], FAIL = [], PULOU = [];
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x !== '' ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 1500) : '')); };
const pula = n => { PULOU.push(n); console.log('pulou ' + n + ' (SheetJS não instalado)'); };
const md5 = t => createHash('md5').update(t).digest('hex');
const corta = (src, ini, fim) => { const a = src.indexOf(ini), b = src.indexOf(fim, a + ini.length); if (a < 0 || b < 0) throw new Error('bloco não encontrado: ' + ini.slice(0, 60) + ' … ' + fim.slice(0, 60)); return src.slice(a, b); };
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const perto = (a, b, t = 0.0051) => Math.abs(a - b) <= t;
let XLSX = null; try { const req = createRequire(import.meta.url); XLSX = req(process.env.XLSX_PATH || 'xlsx'); } catch { XLSX = null; }

/* ---------- ambiente: o código REAL do painel (PAGTO17, Pagto17, CNAB17, DFC, PrevistoFCX, CP_OFX…) com Repo/UI/FCX de brincadeira ---------- */
const csvCod = corta(html, 'const CSV = {', '/**\n * WhatsApp (camada Util)');
const ofxCod = corta(html, 'const OFX = {', '/* ======================= CONTAS (de-para)');
const dfcCod = corta(html, 'const DFC_GRUPOS = {', '/* ============================ IEO ============================ */');
const prevCod = corta(html, '/** Conta contábil do FCX → categoria de saída da DFC, pelo prefixo do código', 'const Cruzamento = {');
const uiCod09 = corta(html, '/* v14.09 · Extratos OFX × Contas a Pagar do FCX (FCX → Saídas): cruzamento na importação', '/* v14.06 · DFC · Resumo Executivo Oficial');
const parcCod = corta(html, 'const Parc11 = {', 'const PartesContratuais11 = {');
const cnabMotor = corta(html, 'const CNAB17 = {', '/* =====================================================================\n   v14.17 · FRENTE 2 · DESDOBRAMENTO CNAB — TELA');
const cnabTela = corta(html, 'Object.assign(FluxoDFC, {\n  _c17:', '/* ---- fim v14.17 ---- */'); // inclui, depois da tela do CNAB, o PAGTO17 (motor), o Pagto17 e a tela das baixas
const pagtoMotor = corta(html, 'const PAGTO17 = {', '/* =====================================================================\n   v14.17 (complemento) · TELA DOS DOIS LAYOUTS');
const diasUteisCod = html.slice(html.indexOf('const DiasUteis = {'), html.indexOf('\n};\n', html.indexOf('const DiasUteis = {')) + 4);

function ambiente({ ext = [], saidas = [], g17 = true, contas = [{ id: 'ct-esp', apelido: 'ESPOSENDE -SANTANDER', ativa: true }, { id: 'ct-mar', apelido: 'MAR ABERTO - SANTANDER', ativa: true }], pode = () => true, itens = null } = {}) {
  const S = { extratos: new Map(ext.map(d => [d.id, d])), config: new Map(), contasBancarias: new Map(contas.map(c => [c.id, c])), parceiros: new Map() }, V = {}; let tic = 0; const bump = c => { V[c] = (V[c] || 0) + 1; };
  if (itens) S.config.set('dfc_item17', { id: 'dfc_item17', itens });
  const ctx = { g17, toasts: [], audits: [], bases: [], renders: 0, modais: [], cargas: [], sync: [], saidasFcx: saidas, apiOk: true, lidas: 0, salvos: [] };
  ctx.api = { saidas: () => { ctx.lidas++; return ctx.saidasFcx; }, contas: () => ctx.contasFcx || [], sincronizarSaidas: (up, rem) => { ctx.sync.push({ up, rem }); let n = 0; for (const s of up) { const i = ctx.saidasFcx.findIndex(x => x.id === s.id); if (i < 0) { ctx.saidasFcx.push({ ...s }); n++; } else { const nv = { ...ctx.saidasFcx[i], ...s }; if (JSON.stringify(nv) !== JSON.stringify(ctx.saidasFcx[i])) { ctx.saidasFcx[i] = nv; n++; } } } return n; } };
  const Repo = { prontas: new Set(Object.keys(S)), todos: c => [...(S[c] || new Map()).values()], get: (c, id) => (S[c] || new Map()).get(id) || null, versao: c => V[c] || 0,
    salvar: async (c, id, d) => { S[c].set(id, { id, ...JSON.parse(JSON.stringify(d)), atualizadoEm: 't' + (++tic) }); bump(c); ctx.salvos.push([c, id]); } };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const Fmt = { data: d => String(d).split('-').reverse().join('/'), brl: v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), brl0: v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) };
  const Auth = { can: k => pode(k) };
  const FluxoDFC = { ui: { mes: '2026-01' }, mesLabel: m => m, podeCruzar05: () => true, cruzarUma05: t => ({ t: { ...t }, ambigua: false }), atualizarBaseDFC: async m => { ctx.bases.push(m); },
    transacoes() { return [...S.extratos.values()].flatMap(d => (d.transacoes || []).map(t => ({ ...t, contaId: d.contaId, docId: d.id }))); },
    contas: () => [...S.contasBancarias.values()], norm: s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim(),
    esperarApi09: async () => (ctx.apiOk ? ctx.api : null) };
  const FCX = { api: () => (ctx.apiOk ? ctx.api : null), montar() { } };
  const MotorConciliacao = { somaDias: (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); } };
  const Libs = { xlsx: async () => { if (!XLSX) throw new Error('sem SheetJS'); return XLSX; } };
  const CargaFeedback = { mostrar: r => { ctx.cargas.push(r); return Promise.resolve(true); }, falha: (o, a, e) => { ctx.cargas.push({ origem: o, arquivo: a, erro: String(e && e.message || e) }); return Promise.resolve(true); } };
  const UI = { toast: m => ctx.toasts.push(m), modal(o) { ctx.modais.push(o); return { el: {}, fechar() { } }; } };
  const nomes = ['MotorConciliacao', 'Repo', 'g04', 'g05', 'g09', 'g11', 'g17', 'FluxoDFC', 'esc', 'Fmt', 'Auth', 'FCX', 'sleep', 'UI', 'Acesso', 'App', 'Audit', 'ContasBancarias', 'Libs', 'CargaFeedback'];
  const vals = [MotorConciliacao, Repo, () => true, () => true, () => true, () => false, () => ctx.g17, FluxoDFC, esc, Fmt, Auth, FCX, () => Promise.resolve(), UI, { loja: () => false }, { render() { ctx.renders++; } }, { registrar: a => { ctx.audits.push(a); return Promise.resolve(); } }, { rotulo: c => c.apelido }, Libs, CargaFeedback];
  const fn = new Function(...nomes, parcCod + '\n' + csvCod + '\n' + ofxCod + '\n' + diasUteisCod + '\n' + dfcCod + '\n' + prevCod + '\n' + uiCod09 + '\n' + cnabMotor + '\n' + cnabTela + '\nreturn { CSV, OFX, DFC, PARC_PIX, CP_OFX, PrevistoFCX, DiasUteis, CNAB17, PAGTO17, Pagto17 };');
  Object.assign(ctx, fn(...vals), { S, Repo, FluxoDFC, bump }); return ctx;
}
const arquivoDe = (nome, conteudo) => { const buf = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo, 'utf8'); return { name: nome, size: buf.length, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }; };
const E0 = ambiente(), P = E0.PAGTO17;

/* =====================================================================
   (a) LAYOUT A · CONTAS A PAGAR ATUAL (CSV/XLSX)
   ===================================================================== */
const CAB_A = ['Status', 'Fornecedor', 'Valor Pago', 'Valor', 'Data de Pagamento', 'Vencimento', 'Conta Contábil', 'Centro de Custo', 'Conta Bancária', 'Banco de Pagamento', 'Forma de Pagamento', 'Descrição'];
const LINHAS_A = [
  ['Pago', 'IMOBILIARIA ALFA LTDA', 'R$101355.76', 'R$101355.76', '05/01/2026', '03/01/2026', '4.10.06 – (-) Aluguel de Loja de Rua', 'LOJA 01', '', 'ESPOSENDE -SANTANDER', 'Boleto', 'Aluguel jan'],
  ['Pago', 'GRAFICA BETA ME', '1.234,56', '1.234,56', '12/01/2026', '10/01/2026', '4.33.13 – (-) Publicidade e Material Gráfico', 'MARKETING', 'MAR ABERTO - SANTANDER', 'ESPOSENDE -SANTANDER', 'PIX', 'Material gráfico'],
  ['A Vencer', 'CONTABIL GAMA', 'R$800.00', 'R$800.00', '', '20/01/2026', '4.38.05 – (-) Assessoria Contábil', 'GESTÃO', '', 'ESPOSENDE -SANTANDER', 'Boleto', 'Honorários'],
  ['Pago', 'SEM DATA LTDA', 'R$10.00', 'R$10.00', '', '', '4.15.02 – (-) Material de Uso e Consumo', 'GESTÃO', '', '', 'Boleto', 'x'],
  ['Pago', 'VALOR PAGO VAZIO LTDA', '', 'R$250.10', '15/01/2026', '15/01/2026', '4.15.02 – (-) Material de Uso e Consumo', 'GESTÃO', '', 'ESPOSENDE -SANTANDER', 'Boleto', 'só Valor'],
];
const csvLinha = r => r.map(c => (/[",\n]/.test(c) ? '"' + String(c).replace(/"/g, '""') + '"' : c)).join(',');
const CSV_A = [CAB_A, ...LINHAS_A].map(csvLinha).join('\n') + '\n';
const aoa = (nome, rows) => ({ nome, rows });

{ // matrizes puras (sem SheetJS)
  const det = P.detectar([aoa('Contas a Pagar', [CAB_A, ...LINHAS_A])]);
  chk('A · detecção automática pelo cabeçalho (Status, Fornecedor, Valor Pago, Data de Pagamento, Conta Contábil, Centro de Custo…)', det.layout === 'A' && det.abas[0].nome === 'Contas a Pagar');
  const det2 = P.detectar([aoa('x', [['Relatório do ERP'], [], ['Data de Pagamento', 'Status', 'Centro de Custo', 'Conta Contábil', 'Fornecedor', 'Valor'], ['x']])]);
  chk('A · o cabeçalho é procurado dinamicamente (linhas de título antes; colunas em outra ordem; "Valor" no lugar de "Valor Pago")', det2.layout === 'A' && det2.abas[0].cab.i === 2);
  chk('A · o layout padrão antigo do FCX (sem Data de Pagamento) NÃO é reconhecido: segue pelo leitor de sempre', P.detectar([aoa('x', [['Status', 'Fornecedor', 'Descrição', 'Valor', 'Vencimento', 'Conta Contábil', 'Centro de Custo'], ['Pago', 'F', 'd', 10, '01/01/2026', '4.10.06', 'L']])]).layout === null);
  const r = P.interpretar([aoa('Contas a Pagar', [CAB_A, ...LINHAS_A])], { soBaixas: false }), s0 = r.linhas[0], s1 = r.linhas[1];
  chk('A · Conta Bancária VAZIA → fallback obrigatório para Banco de Pagamento (ESPOSENDE -SANTANDER)', s0.contaPagamento === 'ESPOSENDE -SANTANDER', s0);
  chk('A · Conta Bancária preenchida → é a conta usada (não o Banco de Pagamento)', s1.contaPagamento === 'MAR ABERTO - SANTANDER', s1);
  chk('A · "R$101355.76" (prefixo R$ e ponto decimal, sem vírgula) → 101355.76', s0.valor === 101355.76, s0.valor);
  chk('A · "1.234,56" (formato brasileiro) → 1234.56', s1.valor === 1234.56, s1.valor);
  chk('A · Data de Pagamento DD/MM/AAAA → dataPagamento AAAA-MM-DD (05/01 é 5 de janeiro, não 1º de maio)', s0.dataPagamento === '2026-01-05' && s1.dataPagamento === '2026-01-12', [s0.dataPagamento, s1.dataPagamento]);
  chk('A · `date` segue o Vencimento (cálculos do FCX inalterados); o pagamento vai em dataPagamento', s0.date === '2026-01-03' && s0.tipo === 'pago', s0);
  chk('A · sem Valor Pago, usa Valor (R$250.10)', r.linhas.find(x => x.fornecedor === 'VALOR PAGO VAZIO LTDA').valor === 250.1);
  chk('A · Status A Vencer entra como Efetivo, sem data de pagamento própria: dataPagamento cai no Vencimento', (x => x.tipo === 'efetivo' && x.dataPagamento === '2026-01-20')(r.linhas.find(x => x.fornecedor === 'CONTABIL GAMA')));
  chk('A · linha sem nenhuma data é ignorada com motivo (não entra)', r.contagem.semData === 1 && !r.linhas.some(x => x.fornecedor === 'SEM DATA LTDA') && r.ignoradas.some(x => /Data/.test(x.motivo)));
  chk('A · Conta Contábil, Centro de Custo, Forma de Pagamento e Descrição preservados', s0.conta.startsWith('4.10.06') && s0.centro === 'LOJA 01' && s0.formaPagamento === 'Boleto' && s0.obs === 'Aluguel jan');
  chk('A · contagem: 5 lidas, 4 importadas, total = soma exata em centavos', r.contagem.lidas === 5 && r.linhas.length === 4 && r.totalCents === 10135576 + 123456 + 80000 + 25010, r.contagem);
  chk('A · Banco de Pagamento usado no lugar da conta: contado para a crítica de carga', r.contagem.bancoNoLugarDaConta >= 2, r.contagem);
  const rb = P.interpretar([aoa('Contas a Pagar', [CAB_A, ...LINHAS_A])], { soBaixas: true });
  chk('A · no botão da DFC (só baixas) o A Vencer fica de fora com motivo "não é baixa"', rb.linhas.length === 3 && rb.contagem.naoBaixa === 1 && rb.linhas.every(x => x.tipo === 'pago'));
  const r2 = P.interpretar([aoa('Contas a Pagar', [CAB_A, ...LINHAS_A])], { soBaixas: false });
  chk('A · ids estáveis: ler o mesmo arquivo de novo gera os mesmos ids (reimportar não duplica)', igual(r.linhas.map(x => x.id), r2.linhas.map(x => x.id)) && new Set(r.linhas.map(x => x.id)).size === r.linhas.length);
  const dup = P.interpretar([aoa('x', [CAB_A, LINHAS_A[0], LINHAS_A[0]])], {});
  chk('A · duas linhas idênticas no mesmo arquivo são dois pagamentos (ids diferentes), não um', dup.linhas.length === 2 && dup.linhas[0].id !== dup.linhas[1].id);
  chk('P · números: R$ 1.234,56 · 1,234.56 · (10,5) · 12,5 · 1.234 (milhar) · lixo', P.num('R$ 1.234,56') === 1234.56 && P.num('1,234.56') === 1234.56 && P.num('(10,5)') === -10.5 && P.num('12,5') === 12.5 && P.num('1.234') === 1234 && P.num('abc') === null && P.num('') === null);
  chk('P · datas: Date, serial do Excel, DD/MM/AAAA com hora, ISO, 31/02 inválido', P.dataISO(new Date(2026, 0, 15)) === '2026-01-15' && P.dataISO(46037) === '2026-01-15' && P.dataISO('15/01/2026 10:30') === '2026-01-15' && P.dataISO('2026-01-15T00:00:00') === '2026-01-15' && P.dataISO('31/02/2026') === null);
}

// codificação real do Windows-1252 (o travessão '–' é o byte 0x96; 'latin1' do Node truncaria para 0x13)
const cp1252 = s => Buffer.from([...s].map(ch => { const c = ch.codePointAt(0); if (c < 256) return c; const m = { 0x2013: 0x96, 0x2014: 0x97, 0x20AC: 0x80 }; if (m[c]) return m[c]; throw new Error('sem cp1252: ' + ch); }));
if (XLSX) {
  const lerPeloPainel = async (file) => { const E = ambiente(); const a = await E.Pagto17.lerArquivo(file); return { E, a, r: E.Pagto17.interpretar(a.sheets, { soBaixas: false }) }; };
  const alvo = P.interpretar([aoa('x', [CAB_A, ...LINHAS_A])], { soBaixas: false });
  const mesmo = (r, n) => igual(r.linhas.map(x => [x.date, x.dataPagamento, x.valor, x.contaPagamento, x.conta, x.centro, x.tipo, x.fornecedor]), alvo.linhas.map(x => [x.date, x.dataPagamento, x.valor, x.contaPagamento, x.conta, x.centro, x.tipo, x.fornecedor]));
  for (const [rot, buf] of [['CSV UTF-8 (vírgula)', Buffer.from(CSV_A, 'utf8')], ['CSV UTF-8 com BOM', Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(CSV_A, 'utf8')])], ['CSV Windows-1252 (acentos em latin1)', cp1252(CSV_A)],
    ['CSV ponto e vírgula com valor brasileiro', Buffer.from([CAB_A, ...LINHAS_A.map(l => l.map(c => c.replace(/^R\$(\d+)\.(\d\d)$/, 'R$$$1,$2')))].map(l => l.join(';')).join('\n'), 'utf8')]]) {
    const { r } = await lerPeloPainel(arquivoDe('contas_a_pagar.csv', buf));
    chk(`A · ${rot}: layout reconhecido, 4 baixas, valores/datas/contas idênticos às matrizes`, r.layout === 'A' && r.linhas.length === 4 && mesmo(r), { layout: r.layout, n: r.linhas.length, av: r.avisos, l0: r.linhas[0] });
  }
  { // XLSX com células de data e de valor numérico
    const wb = XLSX.utils.book_new(); const L = LINHAS_A.map(l => l.slice()); const dt = (d, m, a) => new Date(a, m - 1, d, 12, 0, 0);
    L[0][2] = 101355.76; L[0][3] = 101355.76; L[0][4] = dt(5, 1, 2026); L[0][5] = dt(3, 1, 2026); L[1][2] = 1234.56; L[1][3] = 1234.56; L[1][4] = dt(12, 1, 2026); L[1][5] = dt(10, 1, 2026);
    L[2][2] = 800; L[2][3] = 800; L[2][5] = dt(20, 1, 2026); L[4][2] = null; L[4][3] = 250.1; L[4][4] = dt(15, 1, 2026); L[4][5] = dt(15, 1, 2026);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([CAB_A, ...L], { cellDates: true }), 'Contas a Pagar');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true });
    const { r } = await lerPeloPainel(arquivoDe('contas_a_pagar.xlsx', buf));
    chk('A · XLSX (datas e valores como células): mesma leitura do CSV, incluindo fallback de conta e R$101355.76', r.layout === 'A' && r.linhas.length === 4 && mesmo(r) && r.linhas[0].valor === 101355.76 && r.linhas[0].contaPagamento === 'ESPOSENDE -SANTANDER', r.linhas.map(x => [x.dataPagamento, x.valor]));
  }
} else for (const n of ['A · CSV UTF-8/BOM/Windows-1252/ponto e vírgula', 'A · XLSX']) pula(n);

/* =====================================================================
   (b) LAYOUT B · MODELO ANTIGO DO ERP (Relação dos Títulos Pagos · PGTO.JANEIRO26 / AgendaPagto)
   ===================================================================== */
const CAB_B = ['Item', 'Título', 'Fornecedor', 'Conta', 'Pagamento', 'Vlr Líquido', 'Forma Pagto', 'Instruções', 'Descrição do Título', 'Nome Loja'];
const dB = (d, m = 1, a = 2026) => new Date(a, m - 1, d, 12, 0, 0);
const LINHAS_B = [
  [468, '1001', 'IMOBILIARIA ALFA LTDA', '070-ESPOSENDE -SANTANDER', dB(5), 5000, '2-TED', '', 'Aluguel loja de rua jan', 'LOJA 01 RUA'],
  [187, '1002', 'FOLHA DE PAGAMENTO', '070-ESPOSENDE -SANTANDER', dB(5), 3000.5, '2-TED', '', 'Salários jan', ''],
  [475, '1003', 'CONSTRUTORA DELTA', '070-ESPOSENDE -SANTANDER', dB(6), 7000, '2-TED', '', 'Obra loja nova', 'LOJA 09'],
  [217, '1004', 'AGENCIA ECO', '070-ESPOSENDE -SANTANDER', '05/01/2026', 1500.25, '2-TED', '', 'Mídia jan', ''],
  [468, '1005', 'IMOBILIARIA OMEGA', '070-ESPOSENDE -SANTANDER', dB(7), 4000, '2-TED', 'Baixa Estornada em 08/01', 'Aluguel estornado', 'LOJA 02'],
  [210, '1006', 'ENERGIA S/A', 'CONCILIAÇÃO GETNET', dB(7), 900, '2-TED', '', 'Conciliação interna', 'LOJA 01 RUA'],
  [5, '1007', 'FORNECEDOR CAIXA', '001-CAIXA', dB(7), 450, '1-DINHEIRO', '', 'Pago em caixa', ''],
  [5, '1008', 'CLIENTE CREDIARIO', '070-ESPOSENDE -SANTANDER', dB(8), 320, '4-CR CREDIARIO', '', 'Crediário', ''],
  [468, '1009', 'IMOBILIARIA SIGMA', '091-MAR ABERTO - SANTANDER', dB(5), 2500, '2-TED', '', 'Aluguel loja mar aberto', 'LOJA 05 SHOPPING'],
  [999, '1010', 'FORNECEDOR NOVO', '080-CAIXA ECONÔMICA FEDERAL', dB(9), 300, '2-TED', '', 'Item fora da tabela', ''],
  [12, '1011', 'TRANSFERENCIA INTERNA', '070-ESPOSENDE -SANTANDER', dB(5), 600, '2-TED', '', 'Transferência', ''],
  ['Total', null, null, null, null, 99999, null, null, null, null],
];
// aba tratada (PGTO.*): título, período, linha em branco e o cabeçalho na linha 4
const abaTratada = (nome, linhas) => aoa(nome, [['Esposende Calçados — Relação dos Títulos Pagos'], ['Período: janeiro/2026'], [], CAB_B, ...linhas]);
// aba bruta (AgendaPagto): outra ordem de colunas, uma coluna vazia na frente e o cabeçalho na linha 6
const CAB_BRUTA = ['', 'Item', 'Fornecedor', 'Conta', 'Pagamento', 'Vlr Líquido', 'Instruções', 'Forma Pagto', 'Descrição do Título', 'Nome Loja'];
const abaBruta2 = linhas => aoa('AgendaPagto', [['Esposende Calçados — AgendaPagto'], ['Emitido em 02/02/2026'], [], [], [], CAB_BRUTA, ...linhas.map(l => ['', l[0], l[2], l[3], l[4], l[5], l[7], l[6], l[8], l[9]])]);

{
  const sheets = [abaTratada('PGTO.JANEIRO26', LINHAS_B), abaBruta2(LINHAS_B)];
  const det = P.detectar(sheets);
  chk('B · detecção: cabeçalho (Vlr Líquido, Pagamento, Item, Fornecedor, Conta) achado dinamicamente (linha 4 da aba tratada, linha 6 da aba bruta)', det.layout === 'B' && det.abas.length === 1 && det.abas[0].nome === 'PGTO.JANEIRO26' && det.abas[0].cab.i === 3 && P.detectar([abaBruta2(LINHAS_B)]).abas[0].cab.i === 5);
  chk('B · com aba tratada PGTO.* e aba bruta AgendaPagto no mesmo arquivo, lê só a tratada (a bruta repetiria os mesmos pagamentos)', igual(det.puladas, ['AgendaPagto']));
  const r = P.interpretar(sheets, {}), por = f => r.linhas.find(x => x.fornecedor === f);
  chk('B · "Baixa Estornada" (Instruções) é ignorada', r.contagem.estornadas === 1 && !por('IMOBILIARIA OMEGA'), r.contagem);
  chk('B · contas internas não bancárias ignoradas (CONCILIAÇÃO GETNET e 001-CAIXA)', r.contagem.internas === 2 && !por('ENERGIA S/A') && !por('FORNECEDOR CAIXA'), r.contagem);
  chk('B · Forma Pagto 4-CR (Crediário) ignorada', r.contagem.crediario === 1 && !por('CLIENTE CREDIARIO'));
  chk('B · só contas bancárias reais ficam: 7 baixas válidas (rodapé "Total" não conta)', r.contagem.lidas === 11 && r.linhas.length === 7 && r.contagem.importadas === 7, r.contagem);
  chk('B · prefixo numérico da conta removido: 070-ESPOSENDE -SANTANDER → ESPOSENDE -SANTANDER; 091-MAR ABERTO - SANTANDER → MAR ABERTO - SANTANDER; 080-CAIXA ECONÔMICA FEDERAL → CAIXA ECONÔMICA FEDERAL',
    por('IMOBILIARIA ALFA LTDA').contaPagamento === 'ESPOSENDE -SANTANDER' && por('IMOBILIARIA SIGMA').contaPagamento === 'MAR ABERTO - SANTANDER' && por('FORNECEDOR NOVO').contaPagamento === 'CAIXA ECONÔMICA FEDERAL', r.linhas.map(x => x.contaPagamento));
  chk('B · campos: status pago, dataPagamento = Pagamento, valor = Vlr Líquido, fornecedor, obs = Descrição do Título, centro = Nome Loja (ou Gestão), formaPagamento = Forma Pagto',
    (x => x.tipo === 'pago' && x.date === '2026-01-05' && x.dataPagamento === '2026-01-05' && x.valor === 5000 && x.obs === 'Aluguel loja de rua jan' && x.centro === 'LOJA 01 RUA' && x.formaPagamento === '2-TED' && x.erp17 === 'B')(por('IMOBILIARIA ALFA LTDA')) && por('FOLHA DE PAGAMENTO').centro === 'Gestão', por('IMOBILIARIA ALFA LTDA'));
  chk('B · Pagamento escrito como texto DD/MM/AAAA também funciona (Item 217)', por('AGENCIA ECO').dataPagamento === '2026-01-05');
  chk('B · Item → Conta Contábil do FCX: 468 → 4.10.06, 187 → 4.01.01, 475 → 7.20.05, 217 → 4.33.15',
    por('IMOBILIARIA ALFA LTDA').conta.startsWith('4.10.06 ') && por('FOLHA DE PAGAMENTO').conta.startsWith('4.01.01 ') && por('CONSTRUTORA DELTA').conta.startsWith('7.20.05 ') && por('AGENCIA ECO').conta.startsWith('4.33.15 '), r.linhas.map(x => x.conta));
  const tab = r.tabela, cat = c => tab.get(c).cat;
  chk('B · Item → Categoria DFC: 468 → Aluguel/ocupação · 187 → Pessoal · 475 → Obras/Investimentos · 217 → Marketing', cat('468') === 'pag_ocupacao' && cat('187') === 'pag_folha' && cat('475') === 'inv_capex' && cat('217') === 'pag_marketing');
  chk('B · Item sem vínculo (999) entra com conta "(sem conta)", é avisado e listado para revisão', por('FORNECEDOR NOVO').conta === '(sem conta)' && igual(r.itensSemVinculo, ['999']) && r.avisos.some(t => /999/.test(t)), [r.itensSemVinculo, r.avisos]);
  chk('B · Item 012 (Transferências) fica marcado "conferir contra o OFX / Transferências entre contas"', r.itensRevisar.some(x => x.cod === '012' && /OFX/.test(x.motivo)) && tab.get('012').cat === 'transf');
  chk('B · Item 415 (Partes Relacionadas) → Outras saídas operacionais, também para conferir', tab.get('415').cat === 'pag_outros' && tab.get('415').revisar === true);
  chk('B · Itens genéricos (ERP não deu o nome) marcados para revisão: marketing 215–485', ['215', '216', '217', '221', '222', '224', '226', '227', '248', '250', '485'].every(c => tab.get(c).generico === true && tab.get(c).cat === 'pag_marketing'));
  const grupos = c => P.ITENS_PADRAO.filter(x => x.cat === c).map(x => x.cod).sort().join(',');
  chk('B · tabela cobre os Itens do ERP por grupo (fornecedores, Credsystem, pessoal, ocupação, utilidades, impostos, tarifas, administrativas, investimento)',
    grupos('pag_fornecedores') === '005,008,158,350,351,389,477' && grupos('pag_repasse_credsystem') === '388' && grupos('pag_folha') === '187,188,189,191,192,195,196,197,205,209,325,384,445,446,509,510' && grupos('pag_ocupacao') === '337,419,468,469' &&
    grupos('pag_utilidades') === '119,210,290,444,474' && grupos('pag_impostos') === '125,318,397,433,436,439' && grupos('pag_tarifas') === '010,013,319,368,369' && grupos('inv_capex') === '320,375,376,377,475,483' &&
    grupos('pag_administrativas') === '115,130,152,314,324,328,331,333,339,356,358,359,361,365,405,421,422,424,430,431,443,459,460,464,476,535', grupos('pag_administrativas'));
  chk('B · todo Item da tabela aponta para uma Conta Contábil do catálogo oficial do FCX e para uma Categoria DFC que existe', (() => { const cats = new Set(['pag_fornecedores', 'pag_repasse_credsystem', 'pag_folha', 'pag_impostos', 'pag_ocupacao', 'pag_utilidades', 'pag_tarifas', 'pag_administrativas', 'pag_marketing', 'pag_outros', 'inv_capex', 'transf']);
    const cat = JSON.parse(corta(fcx, 'const CATALOGO_OFICIAL = ', '\n').replace('const CATALOGO_OFICIAL = ', '').replace(/;\s*$/, '')); const set = new Set(cat.contas); return P.ITENS_PADRAO.every(x => cats.has(x.cat) && set.has(x.conta)); })());
  chk('B · só a aba bruta (AgendaPagto), sem PGTO.*: lê a bruta, achando o cabeçalho na linha 6 e as colunas em outra ordem', (x => x.layout === 'B' && x.abas[0] === 'AgendaPagto' && x.linhas.length === 7 && x.contagem.estornadas === 1)(P.interpretar([abaBruta2(LINHAS_B)], {})));
  const r2 = P.interpretar(sheets, {});
  chk('B · ids estáveis entre leituras e únicos', igual(r.linhas.map(x => x.id), r2.linhas.map(x => x.id)) && new Set(r.linhas.map(x => x.id)).size === 7);
  chk('B · total das baixas importadas = 19.900,75 em centavos exatos', r.totalCents === 1990075 && r.periodo.ini === '2026-01-05' && r.periodo.fim === '2026-01-09', [r.totalCents, r.periodo]);
  const r3 = P.interpretar([abaTratada('PGTO.JANEIRO26', [[468, 'x', 'ALFA', '070-ESPOSENDE -SANTANDER', dB(5), 100, '2-TED', '', 'a', '']])], { itens: { 468: { cat: 'pag_administrativas', conta: '4.38.07 – (-) Assessoria Empresarial' }, 999: { nome: 'Item novo', cat: 'pag_marketing', conta: '4.33.15 – (-) Ações de Marketing' } } });
  chk('B · o usuário pode editar o vínculo de qualquer Item (468 passa a Administrativas/Assessoria) e acrescentar Item novo', r3.tabela.get('468').cat === 'pag_administrativas' && r3.linhas[0].conta.startsWith('4.38.07') && r3.tabela.get('999').personalizado === true && r3.tabela.get('999').cat === 'pag_marketing');
  chk('B · Item marcado para ignorar não entra', P.interpretar([abaTratada('PGTO.JANEIRO26', [[468, 'x', 'ALFA', '070-ESPOSENDE -SANTANDER', dB(5), 100, '2-TED', '', 'a', '']])], { itens: { 468: { ignorar: true } } }).contagem.itemIgnorado === 1);
  chk('B · categoriaDaSaida só vale para saídas do layout antigo (erp17 B) e acompanha a tabela vigente', P.categoriaDaSaida({ erp17: 'B', item: '468' }, r.tabela) === 'pag_ocupacao' && P.categoriaDaSaida({ erp17: 'A', item: '468' }, r.tabela) === '' && P.categoriaDaSaida({ item: '468' }, r.tabela) === '' && P.categoriaDaSaida({ erp17: 'B', item: '351' }, r.tabela) === 'pag_fornecedores');
  chk('B · layout desconhecido: nada é lido e o aviso explica', (x => x.layout === null && x.linhas.length === 0 && x.avisos.length === 1)(P.interpretar([aoa('x', [['a', 'b'], [1, 2]])], {})));

  if (XLSX) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(abaTratada('PGTO.JANEIRO26', LINHAS_B).rows, { cellDates: true }), 'PGTO.JANEIRO26');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(abaBruta2(LINHAS_B).rows, { cellDates: true }), 'AgendaPagto');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true }), E = ambiente(), arq = await E.Pagto17.lerArquivo(arquivoDe('Relacao_Titulos_Pagos_Jan-Mai26.xlsx', buf)), rx = E.Pagto17.interpretar(arq.sheets, { soBaixas: true });
    chk('B · Excel de verdade (.xlsx com PGTO.JANEIRO26 e AgendaPagto) aberto pelo caminho do painel: 7 baixas, 070- removido, estorno e conciliações fora', rx.layout === 'B' && rx.linhas.length === 7 && rx.contagem.estornadas === 1 && rx.contagem.internas === 2 && rx.linhas.every(x => !/^\d{3}-/.test(x.contaPagamento)) && rx.totalCents === 1990075 && rx.linhas[0].dataPagamento === '2026-01-05', { l: rx.linhas.length, c: rx.contagem, t: rx.totalCents });
    chk('B · o mesmo arquivo gravado em .xls (OLE) também é reconhecido', await (async () => { const b = XLSX.write(wb, { type: 'buffer', bookType: 'biff8', cellDates: true }); const a = await ambiente().Pagto17.lerArquivo(arquivoDe('antigo.xls', b)); return ambiente().Pagto17.interpretar(a.sheets, {}).linhas.length === 7; })());
  } else pula('B · Excel real (.xlsx/.xls)');
}

/* =====================================================================
   (c) DESDOBRAMENTO CNAB com as baixas do ERP antigo: Itens 468, 187, 475 e 217 viram categorias; data e conta do pagamento filtram os lotes
   ===================================================================== */
const LOTE = { id: 't1', data: '2026-01-06', valor: -16500.75, hist: 'PAGTO FORNECEDORES CNAB 0601', isLoteCnab: true };
const docs = () => [{ id: 'd-esp', contaId: 'ct-esp', mes: '2026-01', transacoes: [{ ...LOTE }, { id: 't2', data: '2026-01-07', valor: -100, hist: 'TARIFA' }] }, { id: 'd-mar', contaId: 'ct-mar', mes: '2026-01', transacoes: [{ id: 't3', data: '2026-01-06', valor: -2500, hist: 'REMESSA PAGTO', isLoteCnab: true }] }];
const baixasB = () => P.interpretar([abaTratada('PGTO.JANEIRO26', LINHAS_B)], {}).linhas;
const catsDe = l => Object.fromEntries(l.cats.map(g => [g.cat, g.cents / 100]));
{
  const E = ambiente({ ext: docs(), saidas: baixasB() }); await E.FluxoDFC.garantirCnab17(); const p = E.FluxoDFC.planoCnab17(), l = p.porTx.get('ct-esp|t1'), lm = p.porTx.get('ct-mar|t3');
  chk('CNAB · lote da Esposende desdobrado pelos Itens: 475 → Obras/Investimentos, 468 → Aluguel/ocupação, 187 → Pessoal, 217 → Marketing', igual(catsDe(l), { inv_capex: 7000, pag_ocupacao: 5000, pag_folha: 3000.5, pag_marketing: 1500.25 }), catsDe(l));
  chk('CNAB · a soma dos filhos é exatamente o valor do lote (sem resto) e o extrato/saldo não mudam (prova em centavos)', l.cap === 1650075 && l.realocado === 1650075 && l.resto === 0 && p.integridade.ok && perto(p.integridade.dif, 0), [l.cap, l.realocado, p.integridade]);
  chk('CNAB · conta de pagamento filtra: o título de 2.500 pago por MAR ABERTO - SANTANDER não entra no lote da ESPOSENDE -SANTANDER…', !l.alocs.some(a => a.x.contaPag === 'MAR ABERTO - SANTANDER'));
  chk('CNAB · …e entra no lote da MAR ABERTO - SANTANDER (Item 468 → Aluguel/ocupação)', igual(catsDe(lm), { pag_ocupacao: 2500 }) && lm.titulosN === 1, catsDe(lm));
  chk('CNAB · o título que sobrou na conta (Item 012 Transferências, 600) vira excedente com o Item no detalhe — nunca passa do teto do lote', l.excedente.cents === 60000 && l.excedente.titulos[0].item === '012' && p.alertas.some(a => a.tipo === 'excedente' && a.valor === 600), l.excedente);
  chk('CNAB · conta de pagamento sem Conta Bancária de mesmo nome no cadastro (CAIXA ECONÔMICA FEDERAL) é avisada e fica fora de todos os lotes', p.contasSemCadastro.length === 1 && p.contasSemCadastro[0].nome === 'CAIXA ECONÔMICA FEDERAL' && p.contasSemCadastro[0].n === 1, p.contasSemCadastro);
  chk('CNAB · o detalhe do título mostra o Item e a conta pela qual foi pago', l.cats.flatMap(g => g.titulos).every(x => x.item && x.contaPag === 'ESPOSENDE -SANTANDER') && l.cats.find(g => g.cat === 'pag_ocupacao').titulos[0].item === '468');
  const filhos = E.FluxoDFC.transacoesDFC().filter(t => t.cnab17 && String(t.id).startsWith('t1#'));
  chk('CNAB · lista virtual da DFC: 4 filhos por categoria somando o lote; o resto das transações idêntico', filhos.length === 4 && perto(filhos.reduce((s, t) => s + t.valor, 0), -16500.75) && E.FluxoDFC.transacoesDFC().some(t => t.id === 't2'), filhos.map(t => [t.cat, t.valor]));
  chk('CNAB · painel e linha do extrato mostram o Item (sem erro de renderização)', (() => { const h = E.FluxoDFC.painelCnab17() + E.FluxoDFC.linhaCnab17({ ...E.FluxoDFC.transacoes().find(t => t.id === 't1') }); return /Item 468/.test(h) && /pago por ESPOSENDE -SANTANDER/.test(h); })());
}
{ // a tabela de Itens vigente (editada pelo usuário) vale na hora do plano, sem reimportar
  const E = ambiente({ ext: docs(), saidas: baixasB(), itens: { 468: { cat: 'pag_administrativas' }, 217: { cat: 'pag_outros' } } }); await E.FluxoDFC.garantirCnab17(); const l = E.FluxoDFC.planoCnab17().porTx.get('ct-esp|t1');
  chk('CNAB · o usuário muda o vínculo do Item 468 e do 217 e o desdobramento acompanha (Administrativas e Outras saídas)', igual(catsDe(l), { inv_capex: 7000, pag_administrativas: 5000, pag_folha: 3000.5, pag_outros: 1500.25 }), catsDe(l));
}
{ // a Categoria do Item vale mesmo quando o De-para FCX → DFC da conta diria outra coisa
  const E = ambiente({ ext: [{ id: 'd', contaId: 'ct-esp', mes: '2026-01', transacoes: [{ id: 'a', data: '2026-01-06', valor: -300, hist: 'CNAB', isLoteCnab: true }] }], saidas: P.interpretar([abaTratada('PGTO.JANEIRO26', [[351, 'x', 'PAPELARIA', '070-ESPOSENDE -SANTANDER', dB(6), 300, '2-TED', '', 'material', '']])], {}).linhas });
  await E.FluxoDFC.garantirCnab17(); const l = E.FluxoDFC.planoCnab17().porTx.get('ct-esp|a');
  chk('CNAB · Item 351 (Material Uso/Consumo): o De-para da conta 4.15.02 daria Administrativas, mas a tabela de Itens manda em Pagamento a fornecedores', E.PrevistoFCX.categoriaDaConta('4.15.02 – (-) Material de Uso e Consumo') === 'pag_administrativas' && l.forn.cents === 30000 && l.cats.length === 0, [catsDe(l), l.forn]);
}
{ // data do pagamento (dataPagamento) e compatibilidade com cargas antigas (sem conta de pagamento)
  const t = (id, o) => ({ id, date: '2026-03-02', tipo: 'pago', valor: 100, conta: '4.10.06 – (-) Aluguel de Loja de Rua', fornecedor: 'F ' + id, contaPagamento: 'ESPOSENDE -SANTANDER', ...o });
  const E = ambiente({ ext: [{ id: 'd', contaId: 'ct-esp', mes: '2026-01', transacoes: [{ id: 'a', data: '2026-01-06', valor: -190, hist: 'CNAB', isLoteCnab: true }] }],
    saidas: [t('x1', { dataPagamento: '2026-01-06' }), t('y1', { date: '2026-01-06', dataPagamento: '2026-02-20', valor: 50 }), t('old1', { date: '2026-01-06', contaPagamento: undefined, valor: 40, fornecedor: 'ANTIGO SEM CONTA' }), t('mar1', { dataPagamento: '2026-01-06', contaPagamento: 'MAR ABERTO - SANTANDER', valor: 30 })] });
  await E.FluxoDFC.garantirCnab17(); const l = E.FluxoDFC.planoCnab17().porTx.get('ct-esp|a'), ids = l.alocs.map(a => a.x.id).sort();
  chk('CNAB · usa a data do PAGAMENTO (x1: vencimento em março, pago em 06/01 → entra) e ignora quem foi pago em outra data (y1: vencimento 06/01, pago em 20/02 → fora)', ids.includes('x1') && !ids.includes('y1'), ids);
  chk('CNAB · título de carga antiga, sem conta de pagamento, continua valendo para qualquer lote (compatibilidade); o de outra conta (mar1) não', ids.includes('old1') && !ids.includes('mar1') && igual(ids, ['old1', 'x1']), ids);
}
{ // casamento de nomes de conta
  const C = E0.CNAB17;
  chk('CNAB · casamento do nome da conta: igual, mesmas palavras em outra ordem, subconjunto de 2+ palavras; nomes diferentes não casam', C.mesmaConta('ESPOSENDE -SANTANDER', 'Esposende - Santander') && C.mesmaConta('SANTANDER ESPOSENDE', 'ESPOSENDE -SANTANDER') && C.mesmaConta('ESPOSENDE SANTANDER', 'ESPOSENDE SANTANDER MATRIZ') && !C.mesmaConta('ESPOSENDE -SANTANDER', 'MAR ABERTO - SANTANDER') && !C.mesmaConta('SANTANDER', 'ESPOSENDE SANTANDER') && !C.mesmaConta('', 'X'));
}
{ // desempenho: milhares de títulos e dezenas de lotes (o histórico Jan–Mai/2026 inteiro)
  const sai = [], tx = []; let k = 0;
  for (let m = 1; m <= 6; m++) for (let d = 1; d <= 28; d++) { for (let i = 0; i < 40; i++) sai.push({ id: 'p' + (k++), date: `2026-0${m}-${String(d).padStart(2, '0')}`, dataPagamento: `2026-0${m}-${String(d).padStart(2, '0')}`, tipo: 'pago', valor: 10 + (i % 7), conta: '4.10.06 – (-) Aluguel de Loja de Rua', fornecedor: 'F' + k, contaPagamento: i % 2 ? 'ESPOSENDE -SANTANDER' : 'MAR ABERTO - SANTANDER', erp17: 'B', item: i % 2 ? '468' : '187' });
    if (d % 3 === 0) tx.push({ id: `L${m}${d}`, data: `2026-0${m}-${String(d).padStart(2, '0')}`, valor: -500, hist: 'CNAB', isLoteCnab: true, contaId: 'ct-esp' }); }
  const t0 = Date.now(), pl = E0.CNAB17.planejar({ transacoes: tx, saidas: sai, tolDias: 1, categoriaDeItem: s => (s.item === '468' ? 'pag_ocupacao' : 'pag_folha'), nomesConta: id => (id === 'ct-esp' ? ['ESPOSENDE -SANTANDER'] : []), todasContas: ['ESPOSENDE -SANTANDER', 'MAR ABERTO - SANTANDER'] }), ms = Date.now() - t0;
  chk(`CNAB · desempenho: ${sai.length} títulos × ${tx.length} lotes planejados em ${ms} ms (limite 4000 ms) com integridade preservada`, ms < 4000 && pl.integridade.ok && pl.resumo.nDesdobrados === tx.length, { ms, d: pl.resumo.nDesdobrados });
}

/* =====================================================================
   (d) PAINEL · botão "Importar Baixas do ERP (CNAB)", conferência, gravação no FCX e tabela de Itens
   ===================================================================== */
const espera = (ms = 30) => new Promise(r => setTimeout(r, ms));
{
  const E = ambiente({ ext: docs(), saidas: [] }), F = E.FluxoDFC;
  const bt = F.botaoCnab17();
  chk('painel · os botões "Importar Baixas do ERP (CNAB)" e "Itens do ERP" aparecem ao lado de "Recalcular Desdobramento CNAB"', /fd-pagto-importar/.test(bt) && /Importar Baixas do ERP \(CNAB\)/.test(bt) && /fd-pagto-itens/.test(bt) && /fd-cnab-recalcular/.test(bt));
  chk('painel · com o recurso desligado não há botão nenhum (≡ v14.16)', ambiente({ g17: false }).FluxoDFC.botaoCnab17() === '');
  chk('painel · sem permissão de importar/editar FCX o botão de importar some', !/fd-pagto-importar/.test(ambiente({ pode: k => k !== 'fcx.editar' }).FluxoDFC.botaoCnab17()));
  if (XLSX) {
    await F.lerPagto17(arquivoDe('contas_a_pagar.csv', CSV_A));
    const m = E.modais.at(-1);
    chk('painel · lê o CSV atual, reconhece o layout e abre a conferência ANTES de gravar (nada no FCX ainda)', m && /Modelo atual/.test(m.corpo) && /Importar 3 baixa/.test(m.acoes.map(a => a.rotulo).join('|')) && E.saidasFcx.length === 0 && /ESPOSENDE -SANTANDER/.test(m.corpo), m && m.corpo.slice(0, 600));
    m.acoes.find(a => /^Importar/.test(a.rotulo)).acao(); await espera(60);
    chk('painel · confirmar grava as 3 baixas (só Status Pago) no FCX → Saídas, com data e conta do pagamento', E.sync.length === 1 && E.sync[0].up.length === 3 && E.saidasFcx.length === 3 && E.saidasFcx.every(s => s.tipo === 'pago' && s.dataPagamento && s.contaPagamento), E.saidasFcx.map(s => [s.dataPagamento, s.contaPagamento]));
    chk('painel · registra na auditoria, abre o popup de crítica de carga e recalcula o desdobramento CNAB', E.audits.some(a => a.rotulo === 'Importar Baixas do ERP (CNAB)' && /3 baixa/.test(a.detalhe)) && E.cargas.some(c => c.origem === 'DFC · Baixas do ERP (CNAB)' && c.processadas === 3 && c.campos.some(x => x[0] === 'Layout' && /Modelo atual/.test(x[1]))) && E.bases.length >= 1, [E.audits.length, E.cargas.length]);
    await F.lerPagto17(arquivoDe('contas_a_pagar.csv', CSV_A)); E.modais.at(-1).acoes.find(a => /^Importar/.test(a.rotulo)).acao(); await espera(60);
    chk('painel · importar o MESMO arquivo de novo não duplica (ids estáveis): continuam 3 saídas e nada alterado', E.saidasFcx.length === 3 && E.sync.at(-1).up.length === 3 && E.toasts.some(t => /0 gravada/.test(t)), E.toasts.slice(-3));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(abaTratada('PGTO.JANEIRO26', LINHAS_B).rows, { cellDates: true }), 'PGTO.JANEIRO26');
    await F.lerPagto17(arquivoDe('Relacao_Titulos_Pagos.xlsx', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true })));
    const m2 = E.modais.at(-1);
    chk('painel · Excel legado: conferência mostra o layout, os filtros aplicados, os Itens → Categoria DFC e o aviso do Item sem vínculo (999) e do 012 a conferir', /Modelo antigo/.test(m2.corpo) && /1 Baixa Estornada/.test(m2.corpo) && /2 conta interna/.test(m2.corpo) && /1 crediário/.test(m2.corpo) && /Aluguel, condomínio e ocupação/.test(m2.corpo) && /999/.test(m2.corpo) && /Item 012/.test(m2.corpo), m2.corpo.slice(0, 900));
    m2.acoes.find(a => /^Importar/.test(a.rotulo)).acao(); await espera(60);
    const dfc = E.saidasFcx.filter(s => s.erp17 === 'B');
    chk('painel · as 7 baixas do Excel legado entram no FCX como Pago, com Item, conta de pagamento sem prefixo e conta contábil do vínculo', dfc.length === 7 && dfc.every(s => s.tipo === 'pago' && !/^\d{3}-/.test(s.contaPagamento)) && dfc.find(s => s.item === '468' && s.fornecedor === 'IMOBILIARIA ALFA LTDA').conta.startsWith('4.10.06'), dfc.length);
    await F.lerPagto17(arquivoDe('lixo.csv', 'a,b\n1,2\n'));
    chk('painel · arquivo de layout desconhecido: avisa e abre o popup de erro, sem gravar nada', E.toasts.at(-1).startsWith('Layout não reconhecido') && E.cargas.at(-1).status === 'erro' && E.saidasFcx.length === 3 + 7);
  } else pula('painel · importação de baixas pelo botão da DFC');
  const Ex = ambiente({ saidas: [{ id: 'b1', erp17: 'B', item: '468', conta: '(sem conta)', itemNome: '' }, { id: 'b2', erp17: 'B', item: '187', conta: '4.01.01 – (-) Salários e Ordenados', itemNome: 'Salários' }, { id: 'a1', erp17: 'A', conta: 'X' }] });
  await Ex.FluxoDFC.salvarItens17(null, { 468: { conta: '4.10.06 – (-) Aluguel de Loja de Rua', cat: 'pag_ocupacao' } }, true);
  chk('painel · "Salvar e reaplicar": grava config/dfc_item17 e atualiza só a conta das Saídas do layout antigo que mudou (b1), sem tocar nas outras', igual(Ex.Pagto17.over(), { 468: { conta: '4.10.06 – (-) Aluguel de Loja de Rua', cat: 'pag_ocupacao' } }) && Ex.saidasFcx.find(s => s.id === 'b1').conta.startsWith('4.10.06') && Ex.saidasFcx.find(s => s.id === 'a1').conta === 'X' && Ex.salvos.some(x => x[0] === 'config' && x[1] === 'dfc_item17'), Ex.saidasFcx);
  await Ex.FluxoDFC.salvarItens17(null, {}, false);
  chk('painel · "Restaurar a tabela padrão" zera as alterações', igual(Ex.Pagto17.over(), {}) && Ex.Pagto17.tabela().get('468').conta.startsWith('4.10.06'));
  chk('painel · sem permissão de regras o vínculo dos Itens não é gravado', await (async () => { const E3 = ambiente({ pode: k => k !== 'fcx.dfc.regras' }); const r = await E3.FluxoDFC.salvarItens17(null, { 468: { cat: 'pag_outros' } }, false); return r === false && !E3.salvos.length; })());
  chk('painel · a tela de Itens lista toda a tabela (89 Itens), com conta, categoria e o aviso de divergência com o De-para', (() => { const E4 = ambiente(); E4.FluxoDFC.abrirItens17(); const h = E4.modais.at(-1).corpo; return (h.match(/data-cod=/g) || []).length === 89 && /Itens do ERP antigo/.test(E4.modais.at(-1).titulo) && /≠/.test(h); })());
}

/* =====================================================================
   (e) FCX · Saídas aceita os dois layouts (exceção autorizada à Regra de Ouro) — código REAL do fcx.html
   ===================================================================== */
{
  chk('FCX · exceção autorizada: só a importação de Saídas mudou; cálculos e relatórios (isVencido, Orçamento, buildCashBook, buildAggregated, gráficos) idênticos à v14.08 por hash', md5(fcx.slice(0, fcx.indexOf('function fcxV1417(){'))) === '3985ab534ef3693b270094d21634df98');
  chk('FCX · bloco central (Recebível Diário, popups de carga, leitura de planilhas) idêntico por hash', md5(fcx.slice(fcx.indexOf('function fcxV1387(){'), fcx.indexOf('/* ---------- SAÍDAS ---------- */'))) === '381ac647c8a7ff4e22e71a8e3089b34c');
  chk('FCX · FCXAPI, storage e inicialização (de window.FCXAPI ao fim) idênticos por hash', md5(fcx.slice(fcx.indexOf('window.FCXAPI = {'))) === '94e9fbe03ca401633c6e0a6c5ad67077');
  chk('FCX · a mudança fica atrás do recurso: sem o painel/flag, importSaidasFile vai direto para o leitor de sempre (importSaidasLegado)', /if\(!fcxV1417\(\)\) return importSaidasLegado\(file\);/.test(fcx) && /function fcxV1417\(\)\{[^\n]*P\.Pagto17\.ativo\(\)/.test(fcx));
  const corpoLegado = corta(fcx, 'function importSaidasLegado(file){', 'window.importSaidasFile = importSaidasFile;');
  chk('FCX · o leitor de sempre ficou com o corpo original: mesmas colunas, Status → tipo, contas/centros novos, modo substituir/acrescentar, e nenhuma referência ao leitor novo', /SAIDA_COL_MAP\[nk\]/.test(corpoLegado) && /statusToTipo\(norm\.status\)/.test(corpoLegado) && /fcx1386Nova\(conta\)/.test(corpoLegado) && /mode==='replace'/.test(corpoLegado) && !/Pagto17|dataPagamento|contaPagamento/.test(corpoLegado));
  const fonte = [['function fcxV1417(){', 'function fcxV1387(){'], ['function importSaidasFile(input){', 'window.importSaidasFile = importSaidasFile;']].map(([a, b]) => corta(fcx, a, b)).join('\n');
  const amb = (E, { flag = true, modo = 'append', saidas = [] } = {}) => {
    const st = { saidas, config: { accounts: ['4.10.06 – (-) Aluguel de Loja de Rua'], costCenters: ['LOJA 01'] }, _saidasImportMode: modo, cargaSaidas: null }, log = { toasts: [], cargas: [], salvou: 0, render: 0, novas: [], legado: 0 };
    const win = { __embed: true, parent: flag ? { Pagto17: E.Pagto17 } : {}, XLSX, storage: { set: async () => { } } };
    const fn = new Function('state', 'window', 'showToast', 'fcxCarga99', 'fcxArq99', 'saveSaidas', 'saveConfig', 'fcx1386Nova', 'render', 'fcxV1378', 'readWorkbookFile', 'normKey', 'excelDateToISO', 'statusToTipo', 'uid', 'SAIDA_COL_MAP', 'SAIDA_COL_MAP_RD',
      fonte + '\nreturn { importSaidasFile, fcxV1417 };');
    const api = fn(st, win, m => log.toasts.push(m), r => log.cargas.push(r), f => [{ nome: f.name, tamanho: f.size }], async () => { log.salvou++; }, async () => { log.salvou++; }, c => log.novas.push(c), () => { log.render++; }, () => false,
      (f, cb) => { log.legado++; cb([]); }, s => String(s || '').toUpperCase(), () => null, () => 'previsto', () => 'u', {}, {});
    return { st, log, api };
  };
  if (XLSX) {
    const E = ambiente({ contas: [{ id: 'ct-esp', apelido: 'ESPOSENDE -SANTANDER' }] }); E.contasFcx = ['4.10.06 – (-) Aluguel de Loja de Rua'];
    const A = amb(E), arqA = arquivoDe('contas_a_pagar.csv', CSV_A);
    await new Promise(ok => { A.api.importSaidasFile({ files: [arqA] }); setTimeout(ok, 60); });
    chk('FCX · CSV atual (Contas a Pagar): a tela de Saídas reconhece o layout e grava as 4 linhas com dataPagamento e contaPagamento (fallback Banco de Pagamento e R$101355.76)', A.st.saidas.length === 4 && A.st.saidas[0].valor === 101355.76 && A.st.saidas[0].contaPagamento === 'ESPOSENDE -SANTANDER' && A.st.saidas[0].dataPagamento === '2026-01-05' && A.st.saidas[0].date === '2026-01-03' && A.log.salvou === 2 && A.log.legado === 0, { n: A.st.saidas.length, l: A.log });
    chk('FCX · cria contas e centros de custo novos como o leitor de sempre e relata no popup de carga (layout, abas, contas novas)', A.st.config.accounts.length > 1 && A.st.config.costCenters.includes('MARKETING') && A.log.cargas.length === 1 && A.log.cargas[0].campos.some(c => c[0] === 'Layout' && /Modelo atual/.test(c[1])) && A.log.cargas[0].processadas === 4, A.log.cargas[0]);
    chk('FCX · tipo por Status do arquivo (Pago → pago; A Vencer → efetivo) — nos dois lugares o cálculo do FCX é o de sempre', A.st.saidas.filter(s => s.tipo === 'pago').length === 3 && A.st.saidas.filter(s => s.tipo === 'efetivo').length === 1);
    await new Promise(ok => { A.api.importSaidasFile({ files: [arqA] }); setTimeout(ok, 60); });
    chk('FCX · reimportar o mesmo arquivo (acrescentar) não duplica: 4 saídas, e o popup informa quantas já existiam', A.st.saidas.length === 4 && A.log.cargas[1].campos.some(c => c[0] === 'Já existiam (atualizadas)' && c[1] === '4'), A.log.cargas[1].campos);
    const R = amb(E, { modo: 'replace', saidas: [{ id: 'velha', valor: 1 }] }); await new Promise(ok => { R.api.importSaidasFile({ files: [arqA] }); setTimeout(ok, 60); });
    chk('FCX · modo "substituir todos os lançamentos" troca tudo pelas linhas do arquivo', R.st.saidas.length === 4 && !R.st.saidas.some(s => s.id === 'velha'));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(abaTratada('PGTO.JANEIRO26', LINHAS_B).rows, { cellDates: true }), 'PGTO.JANEIRO26'); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(abaBruta2(LINHAS_B).rows, { cellDates: true }), 'AgendaPagto');
    const B = amb(E); await new Promise(ok => { B.api.importSaidasFile({ files: [arquivoDe('Relacao.xlsx', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true }))] }); setTimeout(ok, 80); });
    chk('FCX · Excel legado (PGTO.JANEIRO26 + AgendaPagto): 7 baixas Pago, estorno e contas internas fora, 070- removido, Item → conta contábil', B.st.saidas.length === 7 && B.st.saidas.every(s => s.tipo === 'pago' && s.erp17 === 'B' && !/^\d{3}-/.test(s.contaPagamento)) && B.st.saidas.find(s => s.item === '187').conta.startsWith('4.01.01') && B.log.cargas[0].campos.some(c => c[0] === 'Estornadas' && c[1] === '1'), B.log.cargas[0]);
    const L = amb(E); const padrao = 'Status,Fornecedor,Descrição,Valor,Vencimento,Conta Contábil,Centro de Custo\nPago,F,d,10,2026-01-05,4.10.06,L\n';
    await new Promise(ok => { L.api.importSaidasFile({ files: [arquivoDe('padrao.csv', padrao)] }); setTimeout(ok, 60); });
    chk('FCX · layout padrão antigo do FCX (sem Data de Pagamento) não é reconhecido aqui e cai no leitor de sempre', L.log.legado === 1 && L.st.saidas.length === 0);
    const O = amb(E, { flag: false }); await new Promise(ok => { O.api.importSaidasFile({ files: [arqA] }); setTimeout(ok, 40); });
    chk('FCX · recurso desligado (painel sem Pagto17 ativo): vai direto para o leitor de sempre, nada do novo é usado', O.log.legado === 1 && O.st.saidas.length === 0 && O.api.fcxV1417() === false);
    chk('FCX · recurso desligado no painel (g17 falso): Pagto17.ativo() é falso e o FCX também volta ao leitor de sempre', (() => { const E2 = ambiente({ g17: false }); return E2.Pagto17.ativo() === false && amb(E2).api.fcxV1417() === false; })());
  } else pula('FCX · importação de Saídas com os dois layouts');
}

/* ---------- README e fim ---------- */
{
  const readme = fs.readFileSync(path.join(raiz, 'README.md'), 'utf8');
  chk('README descreve o complemento (dois layouts, Itens do ERP, exceção do fcx.html)', /dois layouts/i.test(readme) && /Itens do ERP/.test(readme) && /Importar Baixas do ERP/.test(readme) && /exceção/i.test(readme));
  const seg = /(postgres:\/\/[^\s'"]+:[^\s'"@]+@|BEGIN (RSA )?PRIVATE KEY|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,})/;
  chk('nenhum segredo nos arquivos novos (leitor, tela, teste)', !seg.test(pagtoMotor) && !seg.test(cnabTela) && !seg.test(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')));
}
console.log('\n' + OK.length + ' ok, ' + FAIL.length + ' falhas' + (PULOU.length ? ', ' + PULOU.length + ' pulados (sem SheetJS)' : '')); if (FAIL.length) process.exit(1);
