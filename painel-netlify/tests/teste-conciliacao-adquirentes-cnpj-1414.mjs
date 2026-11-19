/* v14.14 · Conciliação de Cartões por CONTRATO (Adquirente + Empresa/CNPJ) × Conta Bancária de Crédito (OFX).
   Valida o CÓDIGO REAL do painel (public/index.html) e do servidor (netlify/lib/adq-1414.mjs) em contexto isolado do Node, só com dados FICTÍCIOS (LGPD; CNPJs gerados aqui,
   arquivos montados no layout exato do extrato detalhado da Getnet (.csv ";", ISO-8859-1) e da planilha "Recebíveis de antecipação" da SafraPay (cabeçalho na linha 7)).
   Blocos:
     0) recurso gestao_v1414, Regra de Ouro (regiões protegidas e FCX/Contábil intactos), nenhum marcador de montagem, ganchos de roteamento e desligado = v14.13;
     1) leitor da Getnet: linhas em branco/separadoras ignoradas, só "Aprovada" no financeiro (Negada/Estornada/Desfeita à parte), MDR (VALOR TAXA negativo), competência pelo mês da venda,
        decodificação ISO-8859-1, 30 mil linhas em segundos com totais iguais aos das linhas;
     2) leitor da SafraPay: cabeçalho achado sozinho, máscaras "R$ 110,08" / "- R$ 1,97", rodapé ignorado, CNPJ do cabeçalho (Banco Safra) só avisa, Estabelecimento Comercial registrado;
     3) travas de CNPJ no upload: CNPJ do arquivo ≠ CNPJ do contrato bloqueia antes de gravar (e sugere o contrato certo); nada é gravado;
     4) cálculo por contrato: MDR conferido por Empresa/CNPJ + Bandeira + Modalidade, custo de antecipação pro rata do contrato 100% antecipado → Líquido Esperado no Banco por data de repasse;
        SafraPay: taxa de administração e de antecipação contra o contrato, Σ Valor Recebido por Data do Pagamento; a taxa é POR CNPJ (editar uma regra não mexe nos outros contratos);
     5) armazenamento isolado: Getnet Resilienza + Getnet Mar Aberto + SafraPay importados juntos sem sobrescrita; reimportar um contrato regrava só a chave dele (inclusive por competência);
        cada lote leva a conta do seu contrato; excluir um lote não mexe nos outros;
     6) cruzamento com o OFX SOMENTE na Conta Bancária de Crédito do contrato (por contrato e consolidado): conciliado, Furo de Repasse, Liquidado a Menor, Sem OFX na data; isolamento entre contas;
        conta compartilhada entre contratos; "Recalcular" depois de editar a taxa;
     7) servidor: recurso desligado não valida nada; contrato sem conta / conta inexistente (422); lote com chave diferente do conteúdo, CNPJ inválido, adquirente fora de Getnet/SafraPay (422);
        funções de chave idênticas às do painel; ACL (retaguarda.adq.*) e catálogo de backup igual no painel e no servidor.
   (A integração ponta a ponta no NAVEGADOR, com o servidor real e o Postgres e com os arquivos reais do cliente — que não fazem parte do pacote —, é executada na entrega; a varredura de segredos também.)
   Uso: node tests/teste-conciliacao-adquirentes-cnpj-1414.mjs */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(process.env.PAINEL_HTML || path.join(raiz, 'public/index.html'), 'utf8');
const OK = [], FAIL = [];
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x !== '' ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 900) : '')); };
const md5 = t => createHash('md5').update(t).digest('hex');
const corta = (ini, fim) => { const a = html.indexOf(ini), b = html.indexOf(fim, a + ini.length); if (a < 0 || b < 0) throw new Error('bloco não encontrado: ' + ini.slice(0, 60) + ' … ' + fim.slice(0, 60)); return html.slice(a, b); };
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const perto = (a, b, t = 0.011) => Math.abs(a - b) <= t;
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const adq = await import('../netlify/lib/adq-1414.mjs');
const escopo = await import('../netlify/lib/backup-escopo-1413.mjs');
const perm = await import('../netlify/lib/permissoes.mjs');
const regras = await import('../netlify/lib/regras.mjs');

/* ---------- 0 · recurso, Regra de Ouro, montagem ---------- */
chk('recurso gestao_v1414 na lista de liberação (v14.14) e helper g14()', /gestao_v1414: \{ versao: 'v14\.14'/.test(html) && /function g14\(\) \{ return typeof Recursos !== 'undefined' && Recursos\.ativo\('gestao_v1414'\); \}/.test(html));
chk('o servidor tem o recurso e o painel usa o mesmo nome', adq.RECURSO === 'gestao_v1414');
chk('nenhuma peça deixou marcador de montagem no painel final', !/@@V1414_/.test(html));
const MK_DFC = '/* ============================ DFC ============================ */', MK_PE = 'const PARTE_EXTRATO = 900;', MK_M6 = '/* =====================================================================\n   MÓDULO 6 · CREDSYSTEM';
const guardas = {
  'OFX/contas (OFX → início da DFC)': [md5(html.slice(html.indexOf('const OFX = {'), html.indexOf(MK_DFC))), 'f24c59ac5f7a2ec7544b3643a321f096'],
  'adquirentes e FCX (ADQ_CFG → PARTE_EXTRATO)': [md5(html.slice(html.indexOf('const ADQ_CFG'), html.indexOf(MK_PE))), '6a43dc199b96629c8c8af17b4016d126'],
  'Credsystem em diante (Módulo 6 → CS_INDICADORES)': [md5(html.slice(html.indexOf(MK_M6), html.indexOf('const CS_INDICADORES'))), '4738cb8f2d12cff23c6e385e573f9eae'],
};
for (const [k, [a, b]] of Object.entries(guardas)) chk(`Regra de Ouro: ${k} idêntico ao da v14.13 (md5 ${b.slice(0, 8)}…)`, a === b, a);
for (const [f, h] of [['fcx.html', '640800e0'], ['contabilidade.html', 'a41642fb'], ['contabilidade_v1391.html', 'ea73d20b']]) {
  const p = path.join(raiz, 'public', f);
  chk(`Regra de Ouro: public/${f} ${f === 'fcx.html' ? 'idêntico ao da v14.17: v14.08 + a única exceção autorizada (importação de Saídas com os dois layouts do ERP, atrás de gestao_v1417)' : 'idêntico ao da v14.08'} (md5 ${h}…)`, fs.existsSync(p) && md5(fs.readFileSync(p)).startsWith(h));
}
chk('roteador: as ações a14-* vão para o módulo novo, antes do prefixo cmp- (e fora do prefixo adq- das lojas)', html.indexOf('[/^a14-/, () => Adq14]') > 0 && html.indexOf('[/^a14-/, () => Adq14]') < html.indexOf('[/^cmp-/, () => ConcMP]') && !/^adq-/.test('a14-arq'));

/* ---------- ambiente de teste: código REAL do painel com Repo/UI de brincadeira ---------- */
const base = corta('const ADQ_CFG = {', '/* ============================ 6. SERVIÇOS ============================ */');
const motor = corta('const MotorConciliacao = {', '/* ============================ 7. UI (aba do Módulo 4) ============================ */');
const modulo = corta('const ADQ14 = {', '/* ---- fim v14.14 ---- */') + '/* ---- fim v14.14 ---- */';
const CNPJlib = corta('const CNPJ = {', '/**\n * CSV — leitura e geração');
const dvC = (d, n) => { let s = 0, p = n - 7; for (let i = 0; i < n; i++) { s += +d[i] * p--; if (p < 2) p = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
const gerarCnpj = b8 => { const d = b8 + '0001'; const d1 = dvC(d, 12); return d + d1 + dvC(d + d1, 13); };
const CNPJ_RES = gerarCnpj('11222333'), CNPJ_MAR = gerarCnpj('44555666'), CNPJ_BANCO = gerarCnpj('77888999');
const fmtCnpj = s => s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

function ambiente({ g14 = true } = {}) {
  const S = { adq_taxas: new Map(), adq_contratos: new Map(), adq_lotes: new Map(), contasBancarias: new Map(), extratos: new Map(), lojas: new Map(), config: new Map() };
  const V = {}; let tic = 0; const bump = c => { V[c] = (V[c] || 0) + 1; };
  const Repo = {
    cols: S, prontas: new Set(Object.keys(S)), todos: c => [...(S[c] || new Map()).values()], get: (c, id) => (S[c] || new Map()).get(id) || null, versao: c => V[c] || 0,
    salvar: async (c, id, d) => { S[c].set(id, { id, ...JSON.parse(JSON.stringify(d)), atualizadoEm: 't' + (++tic) }); bump(c); },
    excluir: async (c, id) => { S[c].delete(id); bump(c); }, assinar(c) { ctx.assinadas.push(c); }, semMeta: d => d,
    /** Servidor de brincadeira: relê a coleção de `ctx.servidor[c]` (lista de documentos); `ctx.negar` simula perfil sem acesso (HTTP 403). */
    recarregar: async c => { ctx.recargas.push(c); if (ctx.negar && ctx.negar.has(c)) throw Object.assign(new Error('HTTP 403 · sem permissão para ' + c), { status: 403 });
      if (ctx.servidor && ctx.servidor[c]) { S[c].clear(); ctx.servidor[c].forEach(d => S[c].set(d.id, JSON.parse(JSON.stringify(d)))); } Repo.prontas.add(c); bump(c); },
  };
  const emp = { resilienza: { id: 'resilienza', nome: 'Resilienza', cnpj: CNPJ_RES }, 'mar-aberto': { id: 'mar-aberto', nome: 'Mar Aberto', cnpj: CNPJ_MAR } };
  const ctx = { flag: g14, toasts: [], audits: [], confirmou: 0, recargas: [], assinadas: [], servidor: null, negar: null };
  const ConcMP = { SUBS72: [['cruzamento', 'Conciliação e Cruzamento'], ['regras', 'Regras de Taxa Contratuais'], ['resumo', 'Resumo do Fechamento']], ui: { sub: 'regras' }, v72: () => true,
    renderCredito() { return 'ORIGINAL-CREDITO'; }, renderRegras() { return 'ORIGINAL-REGRAS'; }, empresa: id => emp[id] || null, nomeEmpresa: id => emp[id]?.nome || id || '—', empresas: () => Object.values(emp), ecInfo: () => null };
  const mocks = {
    Repo, ConcMP, g14: () => ctx.flag, Datas: { hojeISO: () => '2026-11-17' }, Recursos: { ativo: () => true }, Auth: { can: () => true, id: 'u-teste' }, Libs: {}, DFC: { classificar: () => ({}) },
    ContasBancarias: { rotulo: c => c.apelido }, Retaguarda: {}, CNPJ: undefined,
    Fmt: { brl: n => 'R$' + Number(n).toFixed(2), brl0: n => 'R$' + Math.round(n), num: n => String(n), data: d => d, dataHora: d => d, pct: n => Number(n).toFixed(2) + '%' },
    UI: { toast: m => ctx.toasts.push(m), modal() { return { el: {} }; }, confirmar: async () => { ctx.confirmou++; return true; }, confirmarImpacto: async () => true, lerForm: () => ({}) },
    App: { render() { }, agendarRender() { } }, Audit: { registrar: a => { ctx.audits.push(a); return Promise.resolve(); } }, Documento: { baixarArquivo() { return true; } }, CSV: { gerar: m => m.map(l => l.join(';')).join('\n') },
    campo: () => '', esc: s => String(s ?? ''),
  };
  const nomes = Object.keys(mocks).filter(k => k !== 'CNPJ');
  const fn = new Function(...nomes, `${CNPJlib}\n${base}\n${motor}\n${modulo}\nreturn { ADQ_CFG, AdqTaxas, DiasUteis, MotorConciliacao, ADQ14, Adq14, CNPJ };`);
  const E = fn(...nomes.map(k => mocks[k]));
  ctx.S = S; ctx.Repo = Repo; ctx.ConcMP = ConcMP; ctx.bump = bump; ctx.Documento = mocks.Documento; Object.assign(ctx, E);
  return ctx;
}

/* ---------- arquivos fictícios nos formatos reais ---------- */
const CAB_GN = 'ESTABELECIMENTO COMERCIAL;CPF / CNPJ;RAZÃO SOCIAL;DATA/HORA DA VENDA;BANDEIRA;MODALIDADE;FORMA DE PAGAMENTO;STATUS DA TRANSAÇÃO;PARCELAS;DATA PREVISTA DO 1º PAGAMENTO;NÚMERO DO CARTÃO;NÚMERO DE AUTORIZAÇÃO (AUT);NÚMERO DO COMPROVANTE DE VENDAS (CV);MEIO DE CAPTURA;NÚMERO DO TERMINAL;VALOR BRUTO;VALOR TAXA;VALOR LÍQUIDO;EMISSOR CARTÃO;CARACTERISTICA DA VENDA;CASHBACK (R$) VENDAS CONVERSOR DE MOEDAS;CASHBACK (%) CONVERSOR DE MOEDAS;DATA DA AUTORIZAÇÃO;PRAZO DE RECEBIMENTO RECEBA JÁ';
const SEP = ';'.repeat(22) + '-';
const gn = (cnpj, razao, ec) => (dh, band, mod, forma, st, parc, dp, bruto, taxa, liq) => [ec, fmtCnpj(cnpj), razao, dh, band, mod, forma, st, parc, dp, '439267******0321', '35859', '5725', 'Pos', '14092285', bruto, taxa, liq, 'Nacional', '', '', '', '', '-'].join(';');
const gnRes = gn(CNPJ_RES, 'Resilienza Negocios Ltda', '15105016'), gnMar = gn(CNPJ_MAR, 'Mar Aberto Comercio Atacadista Ltda', '13100535');
const csvRes = [CAB_GN,
  gnRes('05/01/2026 14:20', 'Visa', 'Débito', 'Débito', 'Aprovada', 1, '06/01/2026', '1.000,00', '-9,00', '991,00'),
  gnRes('05/01/2026 15:00', 'Mastercard', 'Crédito', 'Crédito à Vista', 'Aprovada', 1, '04/02/2026', '2.000,00', '-44,00', '1.956,00'),
  SEP, '', gnRes('05/01/2026 16:30', 'Visa', 'Crédito', 'Crédito Parcelado Lojista', 'Aprovada', 3, '04/02/2026', '3.000,00', '-90,00', '2.910,00'),
  gnRes('05/01/2026 17:00', 'Elo', 'Crédito', 'Crédito à Vista', 'Negada', 1, '04/02/2026', '500,00', '-0,00', '500,00'),
  gnRes('05/01/2026 17:10', 'Mastercard', 'Crédito', 'Crédito à Vista', 'Estornada', 1, '04/02/2026', '700,00', '-15,40', '684,60'),
  gnRes('05/01/2026 17:20', 'Visa', 'Débito', 'Débito', 'Desfeita', 1, '06/01/2026', '50,00', '-0,45', '49,55'),
  SEP, gnRes('12/01/2026 10:00', 'Visa', 'Débito', 'Débito', 'Aprovada', 1, '13/01/2026', '100,00', '-0,90', '99,10'),
  gnRes('02/02/2026 10:00', 'Visa', 'Débito', 'Débito', 'Aprovada', 1, '03/02/2026', '300,00', '-2,70', '297,30'), ''].join('\r\n');
const csvMar = [CAB_GN, SEP,
  gnMar('12/01/2026 11:00', 'Visa', 'Débito', 'Débito', 'Aprovada', 1, '13/01/2026', '400,00', '-3,60', '396,40'),
  gnMar('12/01/2026 12:00', 'Elo', 'Crédito', 'Crédito à Vista', 'Aprovada', 1, '11/02/2026', '600,00', '-13,20', '586,80'), SEP, ''].join('\n');
const CABS = ['Data do Pagamento', 'Bandeira', 'Número do Cartão', 'Modalidade', 'Número Sequencial Único', 'Número de Autorização', 'Número do Terminal', 'Estabelecimento Comercial', 'Valor da Parcela', 'Taxa de Administração', 'Taxa de Antecipação', 'Valor Recebido', 'Cartão Estrangeiro'];
const sf = (dp, band, mod, nsu, aut, parcela, adm, ant, rec) => [dp, band, '************0804', mod, nsu, aut, 10848325, 1454475, parcela, adm, ant, rec, 'Não'];
const linhasSafra = [[null, 'Banco Safra S/A', 'Emitido em: 17/11/2026 09:56', null, null, null, null, null, null, null, null, null, null], [null, 'CNPJ: ' + fmtCnpj(CNPJ_BANCO), 'Período de 01/01/2026 até 31/01/2026', null, null, null, null, null, null, null, null, null, null],
  ['', '', '', '', '', '', '', '', '', '', '', '', ''], ['Recebiveis de antecipação', null, null, null, null, null, null, null, null, null, null, null, null], ['', '', '', '', '', '', '', '', '', '', '', '', ''], ['', null, null, null, null, null, null, null, null, null, null, null, null], CABS,
  sf('06/01/2026', 'MASTERCARD', 'Crédito à vista', 1001, 11, 'R$ 1.000,00', '- R$ 17,50', '- R$ 4,00', 'R$ 978,50'),
  sf('06/01/2026', 'MASTERCARD', 'Crédito de 2 a 6 parcelas', 1002, 12, 'R$ 100,00', '- R$ 3,00', '- R$ 0,50', 'R$ 96,50'),
  sf('06/01/2026', 'MASTERCARD', 'Crédito de 2 a 6 parcelas', 1002, 12, 'R$ 100,00', '- R$ 3,00', '- R$ 1,60', 'R$ 95,40'),
  sf('06/01/2026', 'MASTERCARD', 'Crédito de 2 a 6 parcelas', 1002, 12, 'R$ 100,00', '- R$ 3,00', '- R$ 4,90', 'R$ 92,10'),
  sf('07/01/2026', 'VISA', 'Débito', 1003, 13, 'R$ 200,00', '- R$ 1,80', '- R$ 0,00', 'R$ 198,20'),
  sf('07/01/2026', 'VISA', 'Crédito à vista', 1004, 14, 'R$ 1.000,00', '- R$ 22,00', '- R$ 60,00', 'R$ 918,00'),
  ['Total', null, null, null, null, null, null, null, 'R$ 2.500,00', '- R$ 50,30', '- R$ 71,00', 'R$ 2.378,70', null], [null, null, null, null, null, null, null, null, null, null, null, null, null]];

/* ---------- regras de taxa (por Empresa/CNPJ) ---------- */
const mdr = (d, c1, c26, c712) => [{ modalidade: 'debito', de: 1, ate: 1, taxa: d }, { modalidade: 'credito', de: 1, ate: 1, taxa: c1 }, { modalidade: 'credito', de: 2, ate: 6, taxa: c26 }, { modalidade: 'credito', de: 7, ate: 12, taxa: c712 }];
const regra = (a, e, m, am) => ({ id: `adq-${a.toLowerCase()}__todas__emp-${e}`, adquirente: a, bandeira: '*', empresaId: e, ativo: true, antecipado: true, prazoRepasse: 1, mdr: m, antecipacao: { taxa: am, unidade: 'am', metodo: 'simples' } });
const semear = E => {
  const S = E.S;
  [regra('GETNET', 'resilienza', mdr(0.9, 2.2, 2.6, 3.0), 1.6), regra('GETNET', 'mar-aberto', mdr(0.9, 2.5, 2.6, 3.0), 2.0), regra('SAFRAPAY', 'resilienza', mdr(0.9, 2.2, 2.6, 3.0), 1.6)].forEach(r => { S.adq_taxas.set(r.id, r); });
  for (const [id, ap] of [['ct-a', 'Conta A'], ['ct-b', 'Conta B'], ['ct-c', 'Conta C']]) S.contasBancarias.set(id, { id, apelido: ap, ativa: true });
  E.bump('adq_taxas'); E.bump('contasBancarias');
};
const antPR = (base, im, dias) => base * im / 30 * dias; // simples pro rata, calculado aqui de forma independente do painel

/* =====================================================================
   1 · LEITOR DA GETNET
   ===================================================================== */
{
  const E = ambiente(); const { Adq14 } = E; semear(E);
  const buf = Buffer.from(csvRes, 'latin1');
  chk('decodificação: bytes ISO-8859-1 viram texto correto (RAZÃO SOCIAL, Crédito à Vista) sem lixo', Adq14.decodificarTexto(new Uint8Array(buf)).includes('RAZÃO SOCIAL') && Adq14.decodificarTexto(new Uint8Array(buf)).includes('Crédito à Vista'));
  const L = await Adq14.lerGetnetTexto(Adq14.decodificarTexto(new Uint8Array(buf)), 'extrato_detalhado_cartao_15105016_20260101_20260630_x.csv');
  const jan = L.periodos.find(p => p.competencia === '2026-01'), fev = L.periodos.find(p => p.competencia === '2026-02');
  chk('Getnet: linhas em branco e separadoras (;;;…;-) são ignoradas e contadas', L.separadoras === 3 && L.cnpjs.length === 1 && L.cnpjs[0].cnpj === CNPJ_RES && L.linhas >= 11, [L.separadoras, L.cnpjs]);
  chk('Getnet: competência = mês da venda (jan e fev)', L.periodos.map(p => p.competencia).join() === '2026-01,2026-02');
  chk('Getnet: só "Aprovada" entra no financeiro (4 em janeiro: 3 do dia 05 + 1 do dia 12; bruto 6.100)', jan.qtd === 4 && perto(jan.bruto, 6100) && fev.qtd === 1, [jan.qtd, jan.bruto]);
  chk('Getnet: Negada, Estornada e Desfeita ficam à parte, só como informativo (com quantidade e valor)', jan.outros.Negada.qtd === 1 && perto(jan.outros.Negada.bruto, 500) && jan.outros.Estornada.qtd === 1 && perto(jan.outros.Estornada.bruto, 700) && jan.outros.Desfeita.qtd === 1 && perto(jan.outros.Desfeita.bruto, 50), jan.outros);
  chk('Getnet: VALOR TAXA (negativo) vira o MDR cobrado em módulo: 9,00 + 44,00 + 90,00 + 0,90 = 143,90 em janeiro', perto(jan.mdr, 143.9), jan.mdr);
  chk('Getnet: resumo por (venda, 1º pagamento, bandeira, forma, parcelas): 4 grupos em janeiro; ECs contados', jan.grupos.length === 4 && jan.ecs['15105016'].qtd === 4, jan.grupos.length);
  // desempenho e fechamento de totais com 30 mil linhas sintéticas
  const rnd = (() => { let x = 12345; return () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  const bands = ['Visa', 'Mastercard', 'Elo'], linhas = [CAB_GN]; let somaB = 0;
  for (let i = 0; i < 30000; i++) { const dia = 1 + Math.floor(rnd() * 27), b = bands[i % 3], v = Math.round((10 + rnd() * 990) * 100) / 100, deb = i % 2 === 0, mdrV = r2(v * (deb ? 0.009 : 0.022)); somaB += v;
    linhas.push(gnMar(`${String(dia).padStart(2, '0')}/03/2026 10:00`, b, deb ? 'Débito' : 'Crédito', deb ? 'Débito' : 'Crédito à Vista', 'Aprovada', 1, `${String(Math.min(28, dia + (deb ? 1 : 30 - 2))).padStart(2, '0')}/${deb ? '03' : '04'}/2026`, v.toFixed(2).replace('.', ','), '-' + mdrV.toFixed(2).replace('.', ','), r2(v - mdrV).toFixed(2).replace('.', ','))); if (i % 997 === 0) linhas.push(SEP, ''); }
  const t0 = Date.now(), G = await Adq14.lerGetnetTexto(linhas.join('\n'), 'grande.csv'), ms = Date.now() - t0;
  chk(`Getnet: 30.000 linhas lidas em ${ms} ms, Σ bruto dos grupos = Σ das linhas (centavos exatos) e os grupos são poucos`, G.periodos[0].qtd === 30000 && perto(G.periodos[0].bruto, somaB, 0.02) && G.periodos[0].grupos.length < 3000 && ms < 8000, [G.periodos[0].qtd, G.periodos[0].bruto, somaB, ms]);
  const erros = []; for (const t of ['', 'a;b;c\n1;2;3', CAB_GN.replace('VALOR TAXA', 'XPTO')]) { try { await Adq14.lerGetnetTexto(t, 'x.csv'); erros.push('leu'); } catch (e) { erros.push(e.message.slice(0, 60)); } }
  chk('Getnet: arquivo que não é o extrato detalhado (ou sem colunas obrigatórias) é recusado com mensagem clara', erros.every(m => m !== 'leu' && /Não (encontrei|reconheci)|nenhuma transação/.test(m)), erros);
  chk('lerArquivo: Getnet recusa planilha .xlsx e SafraPay recusa .csv (cada adquirente tem o seu arquivo)', await Adq14.lerArquivo({ name: 'a.xlsx', arrayBuffer: async () => new ArrayBuffer(0) }, 'GETNET').then(() => false, e => /\.csv/.test(e.message)) && await Adq14.lerArquivo({ name: 'a.csv', arrayBuffer: async () => new ArrayBuffer(0) }, 'SAFRAPAY').then(() => false, e => /xlsx/.test(e.message)));
}

/* =====================================================================
   2 · LEITOR DA SAFRAPAY
   ===================================================================== */
{
  const E = ambiente(); const { Adq14 } = E; semear(E);
  chk('numBR: "R$ 110,08", "- R$ 1,97", "1.234,56", "(12,30)", 64, "-" e vazio', Adq14.numBR('R$ 110,08') === 110.08 && Adq14.numBR('- R$ 1,97') === -1.97 && Adq14.numBR('1.234,56') === 1234.56 && Adq14.numBR('(12,30)') === -12.3 && Adq14.numBR(64) === 64 && Adq14.numBR('-') === null && Adq14.numBR('') === null);
  const S = Adq14.lerSafraLinhas(linhasSafra, 'Recebiveis de antecipação.xlsx');
  chk('SafraPay: cabeçalho achado sozinho na linha 7; total/rodapé/linhas em branco ignorados; 6 parcelas, 4 vendas', S.linhaCab === 7 && S.parcelas === 6 && S.periodos.length === 1 && S.periodos[0].qtd === 4 && S.semData >= 1, [S.linhaCab, S.parcelas, S.periodos.map(p => p.qtd)]);
  chk('SafraPay: o CNPJ do cabeçalho é o do banco (lido, mas não é o do estabelecimento) e o Estabelecimento Comercial 1454475 é registrado', S.cnpjCabecalho === CNPJ_BANCO && /Safra/.test(S.bancoCabecalho) && S.ecs.some(e => e.ec === '1454475' && e.qtd === 6) && igual(S.periodoArquivo, { de: '2026-01-01', ate: '2026-01-31' }), [S.cnpjCabecalho, S.ecs, S.periodoArquivo]);
  const p = S.periodos[0];
  chk('SafraPay: competência = mês da Data do Pagamento; bruto 2.500,00; taxa de administração 50,30; antecipação 71,00; valor recebido 2.378,70', p.competencia === '2026-01' && perto(p.bruto, 2500) && perto(p.mdr, 50.3) && perto(p.antecArq, 71) && perto(p.liquidoArq, 2378.7), p);
  const falta = linhasSafra.map((l, i) => i === 6 ? l.map(c => c === 'Valor Recebido' ? 'Valor X' : c) : l); let msg = ''; try { Adq14.lerSafraLinhas(falta); } catch (e) { msg = e.message; }
  chk('SafraPay: planilha sem a coluna Valor Recebido / cabeçalho é recusada com mensagem clara', /Não encontrei o cabeçalho/.test(msg), msg);
}

/* =====================================================================
   3 · TRAVAS DE CNPJ NO UPLOAD
   ===================================================================== */
{
  const E = ambiente(); const { Adq14 } = E; semear(E);
  const cRes = { id: 'adq-getnet__emp-resilienza', adquirente: 'GETNET', empresaId: 'resilienza', contaId: 'ct-a' }, cMar = { id: 'adq-getnet__emp-mar-aberto', adquirente: 'GETNET', empresaId: 'mar-aberto', contaId: 'ct-b' }, cSaf = { id: 'adq-safrapay__emp-resilienza', adquirente: 'SAFRAPAY', empresaId: 'resilienza', contaId: 'ct-c' };
  [cRes, cMar, cSaf].forEach(c => { const { id, ...d } = c; E.S.adq_contratos.set(id, { id, ...d, ativo: true }); }); E.bump('adq_contratos');
  const lRes = await Adq14.lerGetnetTexto(csvRes, 'res.csv'), lMar = await Adq14.lerGetnetTexto(csvMar, 'mar.csv'), lSaf = Adq14.lerSafraLinhas(linhasSafra, 'safra.xlsx');
  const v1 = Adq14.validarCnpj(lRes, cMar), v2 = Adq14.validarCnpj(lRes, cRes), v3 = Adq14.validarCnpj(lMar, cRes), v4 = Adq14.validarCnpj(lSaf, cSaf);
  chk('arquivo da Resilienza no contrato Mar Aberto: BLOQUEIA (CNPJ do arquivo ≠ CNPJ do contrato), cita os dois CNPJs e sugere o contrato Getnet · Resilienza', v1.bloqueios.length === 1 && v1.sugestao?.id === cRes.id, v1);
  chk('o bloqueio fala dos dois CNPJs (do arquivo e do contrato)', v1.bloqueios[0].includes(fmtCnpj(CNPJ_RES)) && v1.bloqueios[0].includes(fmtCnpj(CNPJ_MAR)) && v1.sugestao?.id === cRes.id, v1.bloqueios[0]);
  chk('arquivo certo no contrato certo passa sem bloqueio; o inverso (Mar Aberto no contrato Resilienza) bloqueia', v2.bloqueios.length === 0 && v3.bloqueios.length === 1 && v3.sugestao?.id === cMar.id);
  chk('SafraPay: CNPJ do cabeçalho (Banco Safra) NÃO bloqueia — vira aviso de que o lote será vinculado ao CNPJ do contrato escolhido', v4.bloqueios.length === 0 && v4.avisos.some(a => a.includes(fmtCnpj(CNPJ_BANCO)) && a.includes(fmtCnpj(CNPJ_RES))), v4);
  const empOrig = E.ConcMP.empresa; E.ConcMP.empresa = id => id === 'sem-cnpj' ? { id, nome: 'Sem CNPJ', cnpj: '' } : ({ resilienza: { id: 'resilienza', nome: 'Resilienza', cnpj: CNPJ_RES }, 'mar-aberto': { id: 'mar-aberto', nome: 'Mar Aberto', cnpj: CNPJ_MAR } })[id] || null;
  chk('empresa sem CNPJ no cadastro: não dá para importar (bloqueio pede o CNPJ antes)', Adq14.validarCnpj(lMar, { ...cMar, empresaId: 'sem-cnpj' }).bloqueios.length === 1); E.ConcMP.empresa = empOrig;
  // gravarLote com arquivo bloqueado não grava nada
  Adq14.ui.contrato = cMar.id; Adq14._ler = { contratoId: cMar.id, lido: lRes, val: v1 }; await Adq14.gravarLote();
  chk('gravar com o arquivo bloqueado: NADA é gravado (nenhum lote, nenhuma alteração)', E.S.adq_lotes.size === 0);
  const forte = JSON.parse(JSON.stringify(lSaf)); forte.periodos[0].qtd = adq.ADQUIRENTES_LOTE.length ? 15001 : 0;
  chk('SafraPay com mais vendas que o limite do lote é bloqueada (divida a planilha)', Adq14.validarCnpj(forte, cSaf).bloqueios.length === 1);
}

/* =====================================================================
   4 · CÁLCULO POR CONTRATO
   ===================================================================== */
const cenario = async (opts = {}) => {
  const E = ambiente(opts), { Adq14 } = E; semear(E);
  const C = [['adq-getnet__emp-resilienza', 'GETNET', 'resilienza', 'ct-a'], ['adq-getnet__emp-mar-aberto', 'GETNET', 'mar-aberto', 'ct-b'], ['adq-safrapay__emp-resilienza', 'SAFRAPAY', 'resilienza', 'ct-c']];
  for (const [id, a, e, c] of C) E.S.adq_contratos.set(id, { id, adquirente: a, empresaId: e, contaId: c, ativo: true }); E.bump('adq_contratos');
  E.lido = { res: await Adq14.lerGetnetTexto(csvRes, 'res.csv'), mar: await Adq14.lerGetnetTexto(csvMar, 'mar.csv'), saf: Adq14.lerSafraLinhas(linhasSafra, 'safra.xlsx') };
  E.importar = async (contratoId, lido, fixo = '') => { Adq14.ui.contrato = contratoId; Adq14.ui.fixo = fixo; Adq14._ler = { contratoId, lido, val: Adq14.validarCnpj(lido, Adq14.contrato(contratoId)) }; await Adq14.gravarLote(); };
  return E;
};
{
  const E = await cenario(), { Adq14 } = E;
  await E.importar('adq-getnet__emp-resilienza', E.lido.res); await E.importar('adq-getnet__emp-mar-aberto', E.lido.mar); await E.importar('adq-safrapay__emp-resilienza', E.lido.saf);
  const cm = Adq14.calcularMes('2026-01'), res = cm.get(Adq14.idLote('GETNET', CNPJ_RES, '2026-01')), mar = cm.get(Adq14.idLote('GETNET', CNPJ_MAR, '2026-01')), saf = cm.get(Adq14.idLote('SAFRAPAY', CNPJ_RES, '2026-01'));
  // esperado da Resilienza, calculado aqui de forma independente: dia 06/01 (D+1 útil da venda de 05/01)
  const a2 = antPR(2000 - 44, 0.016, 29), a3 = antPR(3000 - 90, 0.016 / 3 * 1, 29) + antPR(3000 - 90, 0.016 / 3, 59) + antPR(3000 - 90, 0.016 / 3, 89);
  const d0601 = 991 + r2(1956 - r2(a2)) + r2(2910 - r2(a3));
  chk('Getnet Resilienza: MDR cobrado 143,90 × MDR do contrato (0,9% débito · 2,2% crédito 1x · 2,6% crédito 2–6x) 131,90, pela regra Empresa/CNPJ + Bandeira + Modalidade', perto(res.k.mdrArq, 143.9) && perto(res.k.mdrContr, 9 + 44 + 78 + 0.9), res.k);
  chk('Getnet Resilienza: só o crédito 3x da Visa (3,00% × 2,60%) é "MDR acima do contrato" (diferença 12,00); débito e crédito 1x conferem', res.conf.filter(x => x.acima).length === 1 && res.conf.find(x => x.acima).bandeira === 'Visa' && /2–6x/.test(res.conf.find(x => x.acima).faixa) && perto(res.conf.find(x => x.acima).dif, 12), res.conf.map(x => [x.bandeira, x.faixa, x.dif, x.acima]));
  chk('Getnet Resilienza (100% antecipado): custo de antecipação pro rata (1,6% a.m. × dias de cada parcela até o repasse em D+1 útil) sai do líquido', perto(res.k.antec, r2(a2) + r2(a3)) && perto(res.k.antec, 30.25 + 91.57), [res.k.antec, a2, a3]);
  chk('Getnet Resilienza: Líquido Esperado no Banco por data de repasse = 06/01 (D+1 útil de 05/01) e 13/01', res.dias.length === 2 && res.dias[0].data === '2026-01-06' && perto(res.dias[0].valor, d0601) && res.dias[1].data === '2026-01-13' && perto(res.dias[1].valor, 99.1), res.dias);
  chk('Getnet: Σ líquido esperado por dia = líquido esperado do lote (nada se perde na distribuição)', perto(res.dias.reduce((s, d) => s + d.valor, 0), res.k.esperado, 0.02) && perto(mar.dias.reduce((s, d) => s + d.valor, 0), mar.k.esperado, 0.02));
  // Mar Aberto tem regra PRÓPRIA (crédito 1x 2,5% · antecipação 2,0% a.m.)
  const aM = r2(antPR(586.8, 0.02, 29));
  chk('Getnet Mar Aberto usa a regra do CNPJ dele (2,5% crédito 1x; 2,0% a.m.): MDR contrato 3,60 + 15,00 e líquido esperado 13/01 = 396,40 + (586,80 − antecipação)', perto(mar.k.mdrContr, 3.6 + 15) && perto(mar.k.antec, aM) && mar.dias.length === 1 && mar.dias[0].data === '2026-01-13' && perto(mar.dias[0].valor, r2(396.4 + 586.8 - aM)), [mar.k, mar.dias]);
  // SafraPay
  chk('SafraPay: líquido esperado = Σ Valor Recebido por Data do Pagamento (06/01 = 1.262,50 · 07/01 = 1.116,20; total 2.378,70)', saf.dias.length === 2 && saf.dias[0].data === '2026-01-06' && perto(saf.dias[0].valor, 1262.5) && saf.dias[1].data === '2026-01-07' && perto(saf.dias[1].valor, 1116.2) && perto(saf.k.esperado, 2378.7), saf.dias);
  chk('SafraPay: Taxa de Administração (MDR) conferida venda a venda: só a venda 2–6x (3,00% × 2,60%) passa do contrato (+1,20)', saf.excecoes.filter(x => x.t === 'mdr').length === 1 && perto(saf.excecoes.find(x => x.t === 'mdr').dif, 1.2) && saf.excecoes.find(x => x.t === 'mdr').aut === '12', saf.excecoes);
  chk('SafraPay: Taxa de Antecipação conferida contra o contrato (1,6% a.m.): só a venda de R$ 1.000 com R$ 60,00 estoura o máximo plausível', saf.excecoes.filter(x => x.t === 'ant').length === 1 && saf.excecoes.find(x => x.t === 'ant').aut === '14' && saf.excecoes.find(x => x.t === 'ant').dif > 40 && perto(saf.k.difMdr, 1.2), saf.excecoes);
  chk('cada cálculo carrega a conta do SEU contrato (Resilienza→A, Mar Aberto→B, SafraPay→C)', res.contaId === 'ct-a' && mar.contaId === 'ct-b' && saf.contaId === 'ct-c');
  // a taxa é por CNPJ: editar a regra da Resilienza não muda o contrato da Mar Aberto
  const marAntes = JSON.stringify(mar.k), resAntes = res.k.esperado;
  const rr = E.S.adq_taxas.get('adq-getnet__todas__emp-resilienza'); E.S.adq_taxas.set(rr.id, { ...rr, antecipacao: { ...rr.antecipacao, taxa: 3.9 }, mdr: rr.mdr.map(x => ({ ...x, taxa: x.taxa + 0.5 })) }); E.bump('adq_taxas');
  const cm2 = Adq14.calcularMes('2026-01'), res2 = cm2.get(res.id), mar2 = cm2.get(mar.id);
  chk('a regra é POR CNPJ: subir a taxa da Resilienza muda só o contrato da Resilienza (MDR e antecipação sobem, líquido esperado cai); Mar Aberto não muda', res2.k.mdrContr > res.k.mdrContr && res2.k.antec > res.k.antec && res2.k.esperado < resAntes && JSON.stringify(mar2.k) === marAntes, [res.k, res2.k]);
  const semRegra = await cenario(); { semRegra.S.adq_taxas.clear(); semRegra.bump('adq_taxas'); await semRegra.importar('adq-getnet__emp-mar-aberto', semRegra.lido.mar); const m0 = [...semRegra.Adq14.calcularMes('2026-01').values()][0];
    chk('sem regra de taxa cadastrada: usa o líquido do arquivo, sem antecipação, e sinaliza "sem taxa" (não inventa taxa)', m0.semTaxa.length >= 1 && perto(m0.k.esperado, 396.4 + 586.8) && m0.k.antec === 0, m0.semTaxa); }
}

/* =====================================================================
   5 · ARMAZENAMENTO ISOLADO POR (ADQUIRENTE + CNPJ + COMPETÊNCIA)
   ===================================================================== */
{
  const E = await cenario(), { Adq14 } = E, snap = () => Object.fromEntries([...E.S.adq_lotes].map(([k, v]) => [k, JSON.stringify(v)]));
  await E.importar('adq-getnet__emp-resilienza', E.lido.res); await E.importar('adq-getnet__emp-mar-aberto', E.lido.mar); await E.importar('adq-safrapay__emp-resilienza', E.lido.saf);
  const ids = [...E.S.adq_lotes.keys()].sort();
  chk('importação simultânea sem sobrescrita: Getnet Resilienza (jan e fev) + Getnet Mar Aberto (jan) + SafraPay Resilienza (jan) = 4 lotes, cada um na sua chave Adquirente + CNPJ + Competência', igual(ids, [`adq-getnet__${CNPJ_MAR}__2026-01`, `adq-getnet__${CNPJ_RES}__2026-01`, `adq-getnet__${CNPJ_RES}__2026-02`, `adq-safrapay__${CNPJ_RES}__2026-01`].sort()), ids);
  const lotes = Object.fromEntries(E.Adq14.lotes().map(l => [l.id, l]));
  chk('cada lote guarda a empresa, o CNPJ do CONTRATO e a conta do contrato (Mar Aberto→B, Resilienza→A, SafraPay→C); a SafraPay leva o EC e não o CNPJ do banco', lotes[`adq-getnet__${CNPJ_MAR}__2026-01`].contaId === 'ct-b' && lotes[`adq-getnet__${CNPJ_RES}__2026-01`].contaId === 'ct-a' && lotes[`adq-safrapay__${CNPJ_RES}__2026-01`].contaId === 'ct-c' && lotes[`adq-safrapay__${CNPJ_RES}__2026-01`].cnpj === CNPJ_RES && lotes[`adq-safrapay__${CNPJ_RES}__2026-01`].cnpjCabecalho === CNPJ_BANCO && lotes[`adq-safrapay__${CNPJ_RES}__2026-01`].ecs['1454475'] === 6);
  chk('o documento do lote é compacto (fatos agregados): Getnet em grupos, SafraPay em vendas, resumo calculado no ato (qtd, bruto, líquido esperado)', Array.isArray(lotes[`adq-getnet__${CNPJ_RES}__2026-01`].grupos) && Array.isArray(lotes[`adq-safrapay__${CNPJ_RES}__2026-01`].vendas) && lotes[`adq-getnet__${CNPJ_MAR}__2026-01`].resumo.qtd === 2 && perto(lotes[`adq-safrapay__${CNPJ_RES}__2026-01`].resumo.esperado, 2378.7));
  const antes = snap();
  E.lido.marV2 = await Adq14.lerGetnetTexto(csvMar.replace('3,60', '4,00').replace('396,40', '396,00'), 'mar2.csv');
  await E.importar('adq-getnet__emp-mar-aberto', E.lido.marV2); const dep = snap();
  chk('reimportar GETNET · Mar Aberto regrava SÓ o lote dele: os outros 3 lotes ficam byte a byte iguais (inclusive a data de gravação)', Object.keys(antes).every(k => k.includes(CNPJ_MAR) ? antes[k] !== dep[k] : antes[k] === dep[k]) && Object.keys(dep).length === 4, Object.keys(antes).map(k => [k.slice(0, 30), antes[k] === dep[k]]));
  // reimportação do mesmo arquivo da Resilienza com o filtro de competência (modo "Reimportar só este lote")
  const a2 = snap(); await E.importar('adq-getnet__emp-resilienza', E.lido.res, '2026-02'); const d2 = snap();
  chk('reimportação restrita a UMA competência (botão Reimportar do lote de fevereiro): janeiro da Resilienza não é tocado, só fevereiro', Object.keys(a2).every(k => k.endsWith('2026-02') && k.includes(CNPJ_RES) && k.startsWith('adq-getnet') ? a2[k] !== d2[k] : a2[k] === d2[k]), Object.keys(a2).map(k => [k.slice(0, 40), a2[k] === d2[k]]));
  // excluir um lote
  const alvo = `adq-getnet__${CNPJ_RES}__2026-02`; await E.Repo.excluir('adq_lotes', alvo); const d3 = snap();
  chk('excluir um lote remove só ele; os outros 3 seguem iguais', Object.keys(d3).length === 3 && !(alvo in d3) && Object.keys(d3).every(k => d3[k] === d2[k]));
  chk('auditoria: cada gravação de lote deixa um registro com contrato, competência, quantidade, valores e conta; o aviso da SafraPay pediu confirmação', E.audits.filter(a => a.entidade === 'adq_lotes' && /Lote ·/.test(a.rotulo)).length >= 5 && E.audits.some(a => /conta Conta B/.test(a.detalhe)) && E.confirmou >= 1);
  // idempotência: mesma chave, mesmo conteúdo → mesmo número de documentos
  await E.importar('adq-safrapay__emp-resilienza', E.lido.saf); chk('importar o mesmo arquivo de novo não duplica nada (a chave é a competência)', E.S.adq_lotes.size === 3);
  // contrato removido: lote guardado, mas contrato some da lista
  await Adq14.removerContrato('adq-getnet__emp-mar-aberto'); chk('remover o contrato não apaga os lotes importados (só deixa de aceitar novas importações)', E.S.adq_lotes.has(`adq-getnet__${CNPJ_MAR}__2026-01`) && !Adq14.contrato('adq-getnet__emp-mar-aberto'));
}

/* =====================================================================
   6 · CRUZAMENTO COM O OFX (SÓ NA CONTA DO CONTRATO)
   ===================================================================== */
const ofx = (E, docs) => { E.S.extratos.clear(); docs.forEach(d => E.S.extratos.set(d.id, d)); E.bump('extratos'); };
const tr = (id, data, valor, hist) => ({ id, data, valor, hist });
{
  const E = await cenario(), { Adq14 } = E;
  await E.importar('adq-getnet__emp-resilienza', E.lido.res, ''); await E.importar('adq-getnet__emp-mar-aberto', E.lido.mar); await E.importar('adq-safrapay__emp-resilienza', E.lido.saf);
  const cm = Adq14.calcularMes('2026-01'), res = cm.get(Adq14.idLote('GETNET', CNPJ_RES, '2026-01')), mar = cm.get(Adq14.idLote('GETNET', CNPJ_MAR, '2026-01')), saf = cm.get(Adq14.idLote('SAFRAPAY', CNPJ_RES, '2026-01'));
  const e06 = res.dias[0].valor, e13r = res.dias[1].valor, e13m = mar.dias[0].valor;
  // cenário 1: cada repasse na conta certa
  ofx(E, [{ id: 'xa', contaId: 'ct-a', mes: '2026-01', transacoes: [tr('a1', '2026-01-06', e06, 'CREDITO GETNET LIQUIDACAO'), tr('a2', '2026-01-13', e13r, 'CREDITO GETNET LIQUIDACAO')] },
    { id: 'xb', contaId: 'ct-b', mes: '2026-01', transacoes: [tr('b1', '2026-01-14', e13m, 'CREDITO GETNET LIQUIDACAO'), tr('b2', '2026-01-05', -1, 'TARIFA')] },
    { id: 'xc', contaId: 'ct-c', mes: '2026-01', transacoes: [tr('c1', '2026-01-06', 1262.5, 'CRED SAFRAPAY'), tr('c2', '2026-01-08', -10, 'TARIFA'), tr('c3', '2026-01-12', -1, 'TARIFA MANUTENCAO')] }]);
  const A1 = Adq14.auditar('2026-01', '*'), st = (A, id, d) => A.cruz.linhas.find(l => l.contratos.includes(id) && l.data === d)?.status;
  chk('consolidado: Resilienza 06/01 e 13/01, Mar Aberto 13/01 (crédito no D+1 útil) e SafraPay 06/01 conciliados; SafraPay 07/01 sem crédito = Furo de Repasse', st(A1, 'adq-getnet__emp-resilienza', '2026-01-06') === 'ok' && st(A1, 'adq-getnet__emp-resilienza', '2026-01-13') === 'ok' && st(A1, 'adq-getnet__emp-mar-aberto', '2026-01-13') === 'ok' && st(A1, 'adq-safrapay__emp-resilienza', '2026-01-06') === 'ok' && st(A1, 'adq-safrapay__emp-resilienza', '2026-01-07') === 'furo', A1.cruz.linhas.map(l => [l.contratos[0], l.data, l.status]));
  chk('consolidado: KPIs somam os contratos (5 dias; 4 conciliados; 1 furo de R$ 1.116,20) e o detalhamento por contrato fecha com o total', A1.cruz.kpis.dias === 5 && A1.cruz.kpis.ok === 4 && A1.cruz.kpis.furo === 1 && perto(A1.cruz.kpis.vFuro, 1116.2) && Object.keys(A1.cruz.porContrato).length === 3 && perto(Object.values(A1.cruz.porContrato).reduce((s, o) => s + o.esperado, 0), A1.cruz.kpis.esperado, 0.02), A1.cruz.kpis);
  const Am = Adq14.auditar('2026-01', 'adq-getnet__emp-mar-aberto');
  chk('filtro por contrato: só Mar Aberto (1 lote, 1 repasse) e o total é o dele', Am.calcs.length === 1 && Am.cruz.linhas.length === 1 && Am.cruz.linhas[0].contaId === 'ct-b' && perto(Am.k.esperado, mar.k.esperado));
  // cenário 2: isolamento — o dinheiro da Mar Aberto cai na conta A (da Resilienza): o contrato Mar Aberto procura SÓ na conta B
  ofx(E, [{ id: 'xa', contaId: 'ct-a', mes: '2026-01', transacoes: [tr('a1', '2026-01-06', e06, 'CREDITO GETNET LIQUIDACAO'), tr('a2', '2026-01-13', e13r, 'CREDITO GETNET LIQUIDACAO'), tr('a3', '2026-01-14', e13m, 'CREDITO GETNET LIQUIDACAO')] },
    { id: 'xb', contaId: 'ct-b', mes: '2026-01', transacoes: [tr('b2', '2026-01-13', -1, 'TARIFA'), tr('b3', '2026-01-16', -1, 'TARIFA MANUTENCAO')] }, { id: 'xc', contaId: 'ct-c', mes: '2026-01', transacoes: [tr('c1', '2026-01-06', 1262.5, 'CRED SAFRAPAY'), tr('c2', '2026-01-08', -10, 'TARIFA'), tr('c3', '2026-01-12', -1, 'TARIFA MANUTENCAO')] }]);
  const A2 = Adq14.auditar('2026-01', '*');
  chk('ISOLAMENTO: o valor da Mar Aberto que está só no OFX da Conta A NÃO concilia o contrato dela (procura só na Conta B): Furo de Repasse; a Resilienza segue conciliada na A', st(A2, 'adq-getnet__emp-mar-aberto', '2026-01-13') === 'furo' && st(A2, 'adq-getnet__emp-resilienza', '2026-01-13') === 'ok', A2.cruz.linhas.map(l => [l.contratos[0], l.data, l.status]));
  // cenário 3: Liquidado a Menor / a Maior / Sem OFX na data
  ofx(E, [{ id: 'xa', contaId: 'ct-a', mes: '2026-01', transacoes: [tr('a1', '2026-01-06', r2(e06 - 25), 'CREDITO GETNET LIQUIDACAO'), tr('a2', '2026-01-13', r2(e13r + 40), 'CREDITO GETNET LIQUIDACAO')] },
    { id: 'xb', contaId: 'ct-b', mes: '2026-02', transacoes: [tr('b1', '2026-02-03', 10, 'CREDITO GETNET')] }, { id: 'xc', contaId: 'ct-c', mes: '2026-01', transacoes: [tr('c1', '2026-01-06', 1262.5, 'CRED SAFRAPAY'), tr('c2', '2026-01-08', -10, 'TARIFA'), tr('c3', '2026-01-12', -1, 'TARIFA MANUTENCAO')] }]);
  const A3 = Adq14.auditar('2026-01', '*'), l06 = A3.cruz.linhas.find(l => l.contratos[0] === 'adq-getnet__emp-resilienza' && l.data === '2026-01-06'), l13 = A3.cruz.linhas.find(l => l.contratos[0] === 'adq-getnet__emp-resilienza' && l.data === '2026-01-13');
  chk('Liquidado a Menor (crédito 25,00 abaixo do esperado) e Liquidado a Maior (40,00 acima), com os valores creditados e as diferenças', l06.status === 'menor' && perto(l06.dif, 25) && perto(l06.creditado, r2(e06 - 25)) && l13.status === 'maior' && perto(l13.creditado - l13.esperado, 40), [l06, l13]);
  chk('Sem OFX na data: conta B só tem OFX de fevereiro, então o repasse de 13/01 da Mar Aberto não é furo — é "Sem OFX na data" (falta o extrato do período)', st(A3, 'adq-getnet__emp-mar-aberto', '2026-01-13') === 'semofx');
  chk('KPIs do consolidado contam cada situação (menor 1, maior 1, sem OFX 1, furo 1, conciliados 1)', A3.cruz.kpis.menor === 1 && A3.cruz.kpis.maior === 1 && A3.cruz.kpis.semofx === 1 && A3.cruz.kpis.furo === 1 && A3.cruz.kpis.ok === 1, A3.cruz.kpis);
  // cenário 4: conta compartilhada — Mar Aberto e Resilienza na MESMA conta, no mesmo dia 13/01: o crédito é a soma
  const ctMar = E.S.adq_contratos.get('adq-getnet__emp-mar-aberto'); E.S.adq_contratos.set(ctMar.id, { ...ctMar, contaId: 'ct-a' }); E.bump('adq_contratos');
  ofx(E, [{ id: 'xa', contaId: 'ct-a', mes: '2026-01', transacoes: [tr('a1', '2026-01-06', e06, 'CREDITO GETNET LIQUIDACAO'), tr('a2', '2026-01-13', r2(e13r + e13m), 'CREDITO GETNET LIQUIDACAO')] }, { id: 'xc', contaId: 'ct-c', mes: '2026-01', transacoes: [tr('c1', '2026-01-06', 1262.5, 'CRED SAFRAPAY'), tr('c2', '2026-01-08', -10, 'TARIFA'), tr('c3', '2026-01-12', -1, 'TARIFA MANUTENCAO')] }]);
  const A4 = Adq14.auditar('2026-01', '*'), l13c = A4.cruz.linhas.find(l => l.data === '2026-01-13' && l.contaId === 'ct-a');
  chk('conta compartilhada entre contratos da mesma adquirente: um crédito único (soma dos dois contratos) concilia os dois e a linha cita os 2 contratos', l13c.status === 'ok' && l13c.contratos.length === 2 && perto(l13c.esperado, e13r + e13m), l13c);
  // "Recalcular": ajuste de taxa muda o esperado sem reimportar; o resumo gravado acompanha
  const antes = Adq14.auditar('2026-01', '*').k.esperado, loteRes = E.S.adq_lotes.get(Adq14.idLote('GETNET', CNPJ_RES, '2026-01')), esperadoGravado = loteRes.resumo.esperado;
  const rr = E.S.adq_taxas.get('adq-getnet__todas__emp-resilienza'); E.S.adq_taxas.set(rr.id, { ...rr, antecipacao: { ...rr.antecipacao, taxa: 3.2 } }); E.bump('adq_taxas');
  await Adq14.recalcular(); const dep = Adq14.auditar('2026-01', '*').k.esperado, novo = E.S.adq_lotes.get(loteRes.id).resumo.esperado;
  chk('"Recalcular" depois de editar a taxa: o líquido esperado cai sem reimportar o arquivo e o resumo gravado do lote é atualizado', dep < antes && novo < esperadoGravado && perto(novo, Adq14.auditar('2026-01', 'adq-getnet__emp-resilienza').k.esperado, 0.02) && E.toasts.some(t => /Recalculado/.test(t)), [antes, dep, esperadoGravado, novo]);
  // exportação .csv só das divergências
  let nome = null; E.Documento.baixarArquivo = (n, b) => { nome = [n, b.size]; return true; }; Adq14.ui.mes = '2026-01'; Adq14.ui.filtro = '*'; Adq14.exportarCsv();
  chk('exportação .csv das divergências (taxa e repasse) do período filtrado é gerada com o nome conciliacao_cartoes_AAAA-MM.csv', !!nome && nome[0] === 'conciliacao_cartoes_2026-01.csv' && nome[1] > 40, nome);
}


/* =====================================================================
   6b · LEITURA DIRETA DO DFC/OFX, JANELA D+0..D+2, FRACIONADOS, VIRADA DE MÊS
   ===================================================================== */
const docOfx = (id, contaId, mes, transacoes, saldoData) => ({ id, contaId, mes, transacoes, ...(saldoData ? { saldo: { data: saldoData, valor: 0 } } : {}) });
const espera = () => new Promise(r => setTimeout(r, 0));
const linhaDe = (A, id, d) => A.cruz.linhas.find(l => l.contratos.includes(id) && l.data === d);
const comLotes = async () => {
  const E = await cenario(), { Adq14 } = E;
  await E.importar('adq-getnet__emp-resilienza', E.lido.res, ''); await E.importar('adq-getnet__emp-mar-aberto', E.lido.mar); await E.importar('adq-safrapay__emp-resilienza', E.lido.saf); await espera();
  const cm = Adq14.calcularMes('2026-01'), res = cm.get(Adq14.idLote('GETNET', CNPJ_RES, '2026-01'));
  E.e06 = res.dias[0].valor; E.e13r = res.dias[1].valor; E.RES = 'adq-getnet__emp-resilienza'; Adq14.ui.mes = '2026-01'; Adq14.ui.filtro = '*'; Adq14.ui.soDiv = true;
  return E;
};
const bateMemo = (E, memo, adq) => E.Adq14.bate(' ' + E.AdqTaxas.chave(memo) + ' ', E.Adq14.padroes().get(E.AdqTaxas.adqId(adq)));

/* (a) leitura direta do DFC/OFX no servidor, sem abrir a aba FCX antes */
{
  const E = await comLotes(), { Adq14 } = E;
  E.servidor = { contasBancarias: [...E.S.contasBancarias.values()].map(c => ({ ...c })), extratos: [docOfx('xa', 'ct-a', '2026-01', [tr('a1', '2026-01-06', E.e06, 'CREDITO GETNET LIQUIDACAO'), tr('a2', '2026-01-13', E.e13r, 'CREDITO GETNET LIQUIDACAO'), tr('a3', '2026-01-16', -1, 'TARIFA MANUTENCAO')])] };
  // estado do navegador recém-aberto: nada em memória, a aba FCX nunca foi aberta (nenhuma assinatura de extratos)
  E.S.extratos.clear(); E.S.contasBancarias.clear(); E.Repo.prontas.delete('extratos'); E.Repo.prontas.delete('contasBancarias'); E.bump('extratos'); E.bump('contasBancarias'); Adq14._bancoCarga = null; E.recargas.length = 0; E.assinadas.length = 0;
  const antes = Adq14.auditar('2026-01', '*');
  chk('(a) extratos vazios na memória e FCX nunca aberta: o painel sabe que precisa ler do servidor e NÃO acusa furo (os 5 dias ficam "Sem OFX na data")', Adq14.precisaBanco() && antes.cruz.kpis.furo === 0 && antes.cruz.kpis.semofx === 5, antes.cruz.kpis);
  const html0 = Adq14.renderAuditoria();
  await Adq14._carga;
  chk('(a) a tela de auditoria dispara a leitura sozinha e mostra "Carregando os extratos OFX do DFC" até ela terminar', /Carregando os extratos OFX do DFC/.test(html0) && E.recargas.includes('contasBancarias') && E.recargas.includes('extratos'), [html0.slice(0, 200), E.recargas]);
  E.S.extratos.clear(); E.S.contasBancarias.clear(); E.Repo.prontas.delete('extratos'); E.Repo.prontas.delete('contasBancarias'); E.bump('extratos'); E.bump('contasBancarias'); Adq14._bancoCarga = null; E.recargas.length = 0; E.assinadas.length = 0;
  const r = await Adq14.carregarBanco(); await espera();
  chk('(a) carregarBanco() lê contas bancárias e extratos direto do servidor (Repo.recarregar) e assina as coleções, sem depender da aba FCX/DFC', E.recargas.includes('extratos') && E.recargas.includes('contasBancarias') && E.assinadas.includes('extratos') && r.erros.length === 0 && r.nDocs === 1 && r.nTx === 3 && r.nContas === 3 && !Adq14.precisaBanco() && E.S.extratos.size === 1, [E.recargas, r]);
  const A = Adq14.auditar('2026-01', '*'), bA = A.banco.find(b => b.contaId === 'ct-a');
  chk('(a) depois da leitura direta: Resilienza 06/01 e 13/01 conciliadas (D+0) e o painel de transparência lista os 2 créditos como "Casado com Lote"', linhaDe(A, E.RES, '2026-01-06').status === 'ok' && linhaDe(A, E.RES, '2026-01-13').status === 'ok' && bA.nTx === 3 && bA.nCred === 2 && bA.nCasados === 2 && bA.creditos.every(c => c.status === 'casado'), [A.cruz.kpis, bA.creditos]);
  const html = Adq14.renderAuditoria();
  chk('(a) a tela mostra "Extratos OFX lidos", os créditos "Casado com Lote" e o alerta da conta sem OFX (Conta B) — não "furo"', /Extratos OFX lidos no DFC para esta conta/.test(html) && /Casado com Lote/.test(html) && /Nenhum lançamento OFX encontrado no DFC para a conta Conta B entre 01\/01\/2026 e 06\/02\/2026\./.test(html) && A.cruz.kpis.furo === 0);
  // cache: leitura recente e coleções cheias não vão ao servidor de novo; Recalcular, sim; memória esvaziada, sim
  let n = E.recargas.length; await Adq14.carregarBanco(); chk('(a) 2ª abertura da aba com os extratos já em memória e recentes não repete a leitura', E.recargas.length === n);
  E.S.extratos.clear(); E.bump('extratos'); n = E.recargas.length; await Adq14.carregarBanco(); const novas = E.recargas.slice(n);
  chk('(a) memória de extratos esvaziada (ex.: sessão renovada): relê do servidor só a coleção vazia', novas.includes('extratos') && !novas.includes('contasBancarias') && E.S.extratos.size === 1, novas);
  n = E.recargas.length; await Adq14.recalcular(); const rec = E.recargas.slice(n);
  chk('(a) botão Recalcular força a releitura dos extratos e das contas no servidor e refaz o cruzamento', rec.includes('extratos') && rec.includes('contasBancarias') && linhaDe(Adq14.auditar('2026-01', '*'), E.RES, '2026-01-06').status === 'ok', rec);
  n = E.recargas.length; await E.importar(E.RES, E.lido.res, ''); await espera();
  chk('(a) importar um lote dispara a releitura dos extratos (o cruzamento do lote novo já vê o OFX)', E.recargas.slice(n).includes('extratos'), E.recargas.slice(n));
  // perfil sem acesso ao DFC: erro explícito e nada de furo
  E.negar = new Set(['extratos']); E.S.extratos.clear(); E.bump('extratos'); Adq14._bancoCarga = null; await Adq14.carregarBanco(); await espera();
  const est = Adq14.bancoEstado(), Ae = Adq14.auditar('2026-01', '*'), htmlE = Adq14.renderAuditoria();
  chk('(a) servidor recusou os extratos (HTTP 403): o erro aparece na tela com a causa, e os repasses ficam "Sem OFX na data" — nunca "Furo de repasse"', est.erros.length === 1 && est.erros[0].col === 'extratos' && /403/.test(est.erros[0].msg) && /Não foi possível ler do servidor/.test(htmlE) && /exige acesso ao DFC/.test(htmlE) && Ae.cruz.kpis.furo === 0 && Ae.cruz.kpis.semofx === 5, [est, Ae.cruz.kpis]);
}

/* (b) vários créditos fracionados do mesmo dia no OFX */
{
  const E = await comLotes(), { Adq14 } = E, e06 = E.e06;
  const p1 = 991, p2 = 1500, p3 = 2000, p4 = r2(e06 - p1 - p2 - p3);
  ofx(E, [docOfx('xa', 'ct-a', '2026-01', [tr('f1', '2026-01-06', p1, 'PAGAMENTO CARTAO DE DEBITO GETNET'), tr('f2', '2026-01-06', p2, 'LIQ GETNET CREDITO'), tr('f3', '2026-01-06', p3, 'ANTECIPACAO GETNET'), tr('f4', '2026-01-06', p4, 'GETNET CREDITO PARCELADO'),
    tr('f5', '2026-01-06', 150, 'PIX RECEBIDO JOAO DA SILVA'), tr('f6', '2026-01-13', E.e13r, 'CREDITO GETNET LIQUIDACAO'), tr('f7', '2026-01-16', -1, 'TARIFA MANUTENCAO')])]);
  const A = Adq14.auditar('2026-01', '*'), l = linhaDe(A, E.RES, '2026-01-06'), b = A.banco.find(x => x.contaId === 'ct-a');
  chk('(b) 4 créditos do mesmo dia (débito, crédito, antecipação, parcelado) somam o Líquido Esperado: conciliado em D+0 pela soma, com os 4 créditos listados', p4 > 0 && l.status === 'ok' && l.forma === 'soma' && l.dx === 0 && l.creditos.length === 4 && perto(l.creditado, e06, 0.02), l);
  chk('(b) painel de transparência: os 4 créditos ficam "Casado com Lote" e o PIX do mesmo dia (sem relação com a adquirente) fica "Crédito OFX sem Lote correspondente"', b.nCasados === 5 && b.creditos.filter(c => c.status === 'casado').length === 5 && b.creditos.find(c => /PIX/.test(c.hist)).status === 'sem_lote' && b.creditos.filter(c => c.status === 'casado' && c.data === '2026-01-06').length === 4, b.creditos.map(c => [c.hist, c.status]));
  // o banco trouxe também créditos Getnet de OUTRA venda no mesmo dia: a soma do dia não fecha, mas um subconjunto (e, com muitos créditos, a modalidade) fecha
  ofx(E, [docOfx('xa', 'ct-a', '2026-01', [tr('g1', '2026-01-06', 991, 'PAGAMENTO CARTAO DE DEBITO GETNET'), tr('g2', '2026-01-06', r2(e06 - 991), 'PAGAMENTO CARTAO DE CREDITO GETNET'), tr('g3', '2026-01-06', 333.33, 'GETNET CREDITO OUTRA LOJA'), tr('g4', '2026-01-13', E.e13r, 'CREDITO GETNET LIQUIDACAO'), tr('g5', '2026-01-16', -1, 'TARIFA MANUTENCAO')])]);
  const l2 = linhaDe(Adq14.auditar('2026-01', '*'), E.RES, '2026-01-06');
  chk('(b) crédito extra do mesmo dia que não pertence ao lote: a soma total não fecha, mas o subconjunto que fecha o Líquido Esperado concilia (e o extra fica sem lote)', l2.status === 'ok' && l2.forma === 'subconjunto' && l2.creditos.length === 2 && Adq14.auditar('2026-01', '*').banco.find(x => x.contaId === 'ct-a').creditos.find(c => c.valor === 333.33).status === 'sem_lote', l2);
  const ruido = Array.from({ length: 13 }, (_, i) => tr('r' + i, '2026-01-06', r2(1.01 + i * 0.37), 'CREDITO GETNET AJUSTE'));
  ofx(E, [docOfx('xa', 'ct-a', '2026-01', [tr('h1', '2026-01-06', 991, 'PAGAMENTO CARTAO DE DEBITO GETNET'), tr('h2', '2026-01-06', r2(e06 - 991), 'PAGAMENTO CARTAO DE CREDITO GETNET'), ...ruido, tr('h4', '2026-01-13', E.e13r, 'CREDITO GETNET LIQUIDACAO'), tr('h5', '2026-01-16', -1, 'TARIFA MANUTENCAO')])]);
  const l3 = linhaDe(Adq14.auditar('2026-01', '*'), E.RES, '2026-01-06');
  chk('(b) 15 créditos no dia (muitos para testar subconjuntos): casa por MODALIDADE — o crédito de débito e o de crédito que batem com o esperado de cada modalidade — e os 13 avulsos ficam sem lote', l3.status === 'ok' && l3.forma === 'modalidade' && l3.creditos.length === 2 && Adq14.auditar('2026-01', '*').banco.find(x => x.contaId === 'ct-a').creditos.filter(c => c.status === 'sem_lote' && c.data === '2026-01-06').length === 13, l3);
}

/* (c) virada de mês: venda de 30/01 com repasse previsto para o sábado 31/01 e crédito no banco na segunda 02/02 (e D+1, D+2) */
{
  const csvVirada = [CAB_GN, SEP, gnRes('30/01/2026 10:00', 'Visa', 'Débito', 'Débito', 'Aprovada', 1, '31/01/2026', '1.000,00', '-9,00', '991,00'), ''].join('\r\n');
  const mont = async (docs) => { const E = await cenario(), { Adq14 } = E; await E.importar('adq-getnet__emp-resilienza', await Adq14.lerGetnetTexto(csvVirada, 'virada.csv'), ''); await espera(); Adq14.ui.mes = '2026-01'; Adq14.ui.filtro = '*'; ofx(E, docs); return { E, A: Adq14.auditar('2026-01', '*') }; };
  const jan = docOfx('xj', 'ct-a', '2026-01', [tr('j1', '2026-01-30', -5, 'TARIFA MANUTENCAO')], '2026-01-31');
  const fev = (dia, val = 991) => docOfx('xf', 'ct-a', '2026-02', [tr('f0', '2026-02-02', -3, 'TARIFA MANUTENCAO'), tr('f1', dia, val, 'CREDITO GETNET LIQUIDACAO'), tr('f2', '2026-02-06', -1, 'TARIFA MANUTENCAO')]);
  const { E, A } = await mont([jan, fev('2026-02-02')]), l = A.cruz.linhas[0], bA = A.banco.find(b => b.contaId === 'ct-a');
  chk('(c) repasse previsto para o sábado 31/01 vira o dia útil 02/02 (outro mês); crédito em 02/02 no extrato de fevereiro: Conciliado D+0 — a janela atravessa a virada do mês', A.cruz.linhas.length === 1 && l.data === '2026-02-02' && l.janela.join() === '2026-02-02,2026-02-03,2026-02-04' && l.status === 'ok' && l.dx === 0 && perto(l.esperado, 991) && A.cruz.kpis.okD[0] === 1, l);
  chk('(c) o painel de transparência lê o crédito de 02/02 (extrato de fevereiro) para a competência de janeiro e o marca "Casado com Lote"; período lido 01/01 a 06/02', bA.de === '2026-01-01' && bA.ate === '2026-02-06' && bA.nCasados === 1 && bA.creditos[0].data === '2026-02-02' && bA.creditos[0].status === 'casado' && bA.creditos[0].uso.dx === 0, bA);
  E.Adq14.ui.soDiv = false; const htmlC = E.Adq14.renderAuditoria();
  chk('(c) o rótulo da tela é "Conciliado (D+0)"', /Conciliado \(D\+0\)/.test(htmlC), htmlC.length);
  // repasse previsto numa sexta-feira útil (30/01) e creditado só na segunda (02/02): D+1 útil, já no mês seguinte
  const csvSexta = [CAB_GN, SEP, gnRes('29/01/2026 10:00', 'Visa', 'Débito', 'Débito', 'Aprovada', 1, '30/01/2026', '1.000,00', '-9,00', '991,00'), ''].join('\r\n');
  { const E2 = await cenario(), { Adq14: A14 } = E2; await E2.importar('adq-getnet__emp-resilienza', await A14.lerGetnetTexto(csvSexta, 'sexta.csv'), ''); await espera(); A14.ui.mes = '2026-01'; A14.ui.filtro = '*'; ofx(E2, [jan, fev('2026-02-02')]);
    const AS = A14.auditar('2026-01', '*'), ls = AS.cruz.linhas[0];
    chk('(c) repasse previsto para sexta 30/01 e creditado na segunda 02/02 (31/01 e 01/02 são fim de semana): Conciliado D+1 já no mês seguinte', ls.data === '2026-01-30' && ls.janela.join() === '2026-01-30,2026-02-02,2026-02-03' && ls.status === 'ok' && ls.dx === 1 && AS.cruz.kpis.okD[1] === 1, ls); }
  const d2 = await mont([jan, fev('2026-02-04')]), d2l = d2.A.cruz.linhas[0];
  chk('(c) crédito em 04/02 (D+2 útil): Conciliado (D+2)', d2l.status === 'ok' && d2l.dx === 2 && d2.A.cruz.kpis.okD[2] === 1, d2l);
  const d3 = await mont([jan, fev('2026-02-05')]), d3l = d3.A.cruz.linhas[0];
  chk('(c) crédito só em 05/02 (D+3, fora da janela) com o extrato de fevereiro importado: Furo de Repasse (o crédito de 05/02 aparece sem lote no painel)', d3l.status === 'furo' && d3.A.cruz.kpis.furo === 1 && d3.A.banco.find(b => b.contaId === 'ct-a').creditos[0].status === 'sem_lote', d3l);
  const d4 = await mont([jan]), d4l = d4.A.cruz.linhas[0];
  chk('(c) só o extrato de janeiro importado (fevereiro ainda não): "Sem OFX na data" e aviso de falta de extrato — nunca furo', d4l.status === 'semofx' && d4.A.cruz.kpis.furo === 0 && /Sem extrato OFX importado/.test(d4.A.banco.find(b => b.contaId === 'ct-a').aviso), d4l);
  chk('(c) janelas de dias úteis: sábado 31/01 → 02/02, 03/02, 04/02; feriado nacional 20/11 → 23/11…; carnaval (16 e 17/02) é pulado', E.Adq14.janelaDu('2026-01-31').join() === '2026-02-02,2026-02-03,2026-02-04' && E.Adq14.janelaDu('2026-11-20').join() === '2026-11-23,2026-11-24,2026-11-25' && E.Adq14.janelaDu('2026-02-13').join() === '2026-02-13,2026-02-18,2026-02-19', [E.Adq14.janelaDu('2026-11-20'), E.Adq14.janelaDu('2026-02-13')]);
}

/* (d) conta sem nenhum OFX importado: alerta explícito, nunca "furo" */
{
  const E = await comLotes(), { Adq14 } = E;
  ofx(E, [docOfx('xa', 'ct-a', '2026-01', [tr('a1', '2026-01-06', E.e06, 'CREDITO GETNET LIQUIDACAO'), tr('a2', '2026-01-13', E.e13r, 'CREDITO GETNET LIQUIDACAO')]), docOfx('xb', 'ct-b', '2026-03', [tr('b1', '2026-03-10', 99, 'PIX')])]);
  const A = Adq14.auditar('2026-01', '*'), bC = A.banco.find(b => b.contaId === 'ct-c'), bB = A.banco.find(b => b.contaId === 'ct-b');
  chk('(d) conta C sem nenhum OFX: alerta exato "Nenhum lançamento OFX encontrado no DFC para a conta Conta C entre 01/01/2026 e 06/02/2026."', bC.semOfx && bC.alerta === 'Nenhum lançamento OFX encontrado no DFC para a conta Conta C entre 01/01/2026 e 06/02/2026.' && bC.nTx === 0, bC.alerta);
  chk('(d) conta B só com OFX de março (fora do período): também é "sem OFX no período"', bB.semOfx && /Conta B/.test(bB.alerta));
  chk('(d) os repasses da SafraPay (conta C) e da Mar Aberto (conta B) ficam "Sem OFX na data", sem nenhum "Furo de repasse"; a Resilienza (conta A) concilia', A.cruz.kpis.furo === 0 && A.cruz.kpis.semofx === 3 && A.cruz.kpis.ok === 2 && linhaDe(A, 'adq-safrapay__emp-resilienza', '2026-01-06').status === 'semofx' && linhaDe(A, 'adq-getnet__emp-mar-aberto', '2026-01-13').status === 'semofx', A.cruz.kpis);
  const html = Adq14.renderAuditoria();
  chk('(d) a tela exibe o alerta em destaque para cada conta sem OFX e a explicação "não como furo"', (html.match(/Nenhum lançamento OFX encontrado no DFC para a conta/g) || []).length >= 2 && /não como furo/.test(html) && /sem OFX no período/.test(html), html.length);
  const csvOk = (() => { let corpo = ''; E.Documento.baixarArquivo = (n, b) => { corpo = b; return true; }; Adq14.exportarCsv(); return corpo; })();
  chk('(d) exportação .csv é gerada mesmo com contas sem OFX', !!csvOk);
}

/* (e) conta bancária: mesmo ID OU mesmo Banco + Agência + Conta normalizados */
{
  const E = await comLotes(), { Adq14 } = E, mk = (id, o) => ({ id, apelido: id, ativa: true, ...o });
  const ig = (a, b) => Adq14.mesmaConta(mk('x1', a), mk('x2', b));
  chk('(e) mesma conta com zeros à esquerda, traço e DV em campo separado/junto: iguais', ig({ banco: '033', agencia: '0123-4', conta: '0001234', digito: '5' }, { banco: '33', agencia: '123', conta: '1234-5', digito: '' }) && ig({ banco: '422', agencia: '0001', conta: '000123456', digito: '7' }, { banco: '0422', agencia: '1', conta: '1234567', digito: '' }) && ig({ banco: '033', agencia: '1234', conta: '12345-6' }, { banco: '033', agencia: '1234', conta: '123456' }));
  chk('(e) ofxAcctId do OFX também identifica a conta (ex.: 0012345-6 = 123456)', ig({ banco: '033', agencia: '1234', conta: '99', ofxAcctId: '0012345-6' }, { banco: '033', agencia: '1234', conta: '123456' }));
  chk('(e) contas diferentes NÃO se confundem: outro banco, outra agência, outro número, ou sem banco informado', !ig({ banco: '033', agencia: '1234', conta: '12345' }, { banco: '237', agencia: '1234', conta: '12345' }) && !ig({ banco: '033', agencia: '1234', conta: '12345' }, { banco: '033', agencia: '4321', conta: '12345' }) && !ig({ banco: '033', agencia: '1234', conta: '12345' }, { banco: '033', agencia: '1234', conta: '98765' }) && !ig({ conta: '12345' }, { conta: '12345' }) && Adq14.mesmaConta(mk('mesmo', {}), mk('mesmo', {})));
  // integração: OFX importado numa duplicata do cadastro da conta A
  E.S.contasBancarias.set('ct-a', mk('ct-a', { apelido: 'Conta A', banco: '033', agencia: '0123-4', conta: '0001234', digito: '5' })); E.S.contasBancarias.set('ct-a2', mk('ct-a2', { apelido: 'Conta A (cadastro duplicado)', banco: '33', agencia: '123', conta: '1234-5' })); E.bump('contasBancarias');
  ofx(E, [docOfx('xa2', 'ct-a2', '2026-01', [tr('a1', '2026-01-06', E.e06, 'CREDITO GETNET LIQUIDACAO'), tr('a2', '2026-01-13', E.e13r, 'CREDITO GETNET LIQUIDACAO'), tr('a3', '2026-01-16', -1, 'TARIFA MANUTENCAO')])]);
  const A = Adq14.auditar('2026-01', '*'), bA = A.banco.find(b => b.contaId === 'ct-a');
  chk('(e) contrato vinculado à Conta A concilia com o OFX gravado na duplicata (Conta A cadastro duplicado) e o painel informa a conta equivalente lida', linhaDe(A, E.RES, '2026-01-06').status === 'ok' && linhaDe(A, E.RES, '2026-01-13').status === 'ok' && bA.nCred === 2 && bA.equivalentes.join() === 'Conta A (cadastro duplicado)' && bA.creditos[0].conta === 'Conta A (cadastro duplicado)', [bA.equivalentes, bA.creditos.map(c => c.conta)]);
  E.S.contasBancarias.set('ct-a2', mk('ct-a2', { apelido: 'Conta A2', banco: '33', agencia: '123', conta: '777777' })); E.bump('contasBancarias');
  const B = Adq14.auditar('2026-01', '*');
  chk('(e) se a "duplicata" for outra conta de verdade (número diferente), o OFX dela NÃO concilia o contrato da Conta A', linhaDe(B, E.RES, '2026-01-06').status !== 'ok' && B.banco.find(b => b.contaId === 'ct-a').nCred === 0);
}

/* (f) varredura de todos os créditos da conta: padrões de histórico, crédito genérico e crédito de outra adquirente */
{
  const E = await comLotes(), { Adq14 } = E;
  const gOk = ['GETNET S.A. LIQUIDACAO', 'PAGAMENTO CARTAO DE DEBITO', 'PAGAMENTO CARTAO DE CREDITO', 'ANTECIPACAO GETNET', 'LIQ GETNET 0601', 'CRED VISA ELECTRON', 'CREDITO MAESTRO', 'ELO DEBITO LIQUIDACAO', 'SANTANDER GETNET'],
    gNao = ['TED RECEBIDA', 'PIX RECEBIDO', 'CRED SAFRAPAY', 'TARIFA MANUTENCAO'],
    sOk = ['SAFRAPAY LIQUIDACAO', 'BANCO SAFRA S A', 'CREDITO CARTAO', 'LIQ RECEBIVEIS CARTAO', 'TED 422 BANCO SAFRA', 'SAFRA PAY'], sNao = ['GETNET', 'TED 341', 'PIX RECEBIDO'];
  chk('(f) padrões Getnet reconhecem GETNET, PAGAMENTO CARTAO DE DEBITO/CREDITO, ANTECIPACAO/LIQ GETNET, VISA ELECTRON, MAESTRO, ELO DEBITO (e não reconhecem TED/PIX genéricos)', gOk.every(m => bateMemo(E, m, 'GETNET')) && gNao.every(m => !bateMemo(E, m, 'GETNET')), [gOk.filter(m => !bateMemo(E, m, 'GETNET')), gNao.filter(m => bateMemo(E, m, 'GETNET'))]);
  chk('(f) padrões SafraPay reconhecem SAFRA, SAFRAPAY, BANCO SAFRA, CREDITO CARTAO, LIQ RECEBIVEIS, TED 422 (e não reconhecem Getnet, TED de outro banco, PIX)', sOk.every(m => bateMemo(E, m, 'SAFRAPAY')) && sNao.every(m => !bateMemo(E, m, 'SAFRAPAY')), [sOk.filter(m => !bateMemo(E, m, 'SAFRAPAY')), sNao.filter(m => bateMemo(E, m, 'SAFRAPAY'))]);
  const doc = (...t) => [docOfx('xa', 'ct-a', '2026-01', [...t, tr('z9', '2026-01-16', -1, 'TARIFA MANUTENCAO')])];
  ofx(E, doc(tr('v1', '2026-01-06', E.e06, 'TED RECEBIDA 0601'), tr('v2', '2026-01-13', E.e13r, 'CREDITO EM CONTA')));
  const A = Adq14.auditar('2026-01', '*'), l = linhaDe(A, E.RES, '2026-01-06'), l13 = linhaDe(A, E.RES, '2026-01-13');
  chk('(f) o banco trouxe só "TED"/"CRÉDITO" genérico (sem categoria no DFC): casa só pelo valor e pela data, e a tela diz que foi só pelo valor', l.status === 'ok' && l.ident === 'valor' && l13.status === 'ok' && l13.ident === 'valor' && /só pelo valor e pela data|casado só pelo valor/.test(Adq14.renderAuditoria().replace(/<[^>]+>/g, ' ') + (E.Adq14.ui.soDiv = false, Adq14.renderAuditoria())), [l.ident, l13.ident]);
  ofx(E, doc(tr('v1', '2026-01-06', E.e06, 'CRED SAFRAPAY LIQUIDACAO'), tr('v2', '2026-01-13', E.e13r, 'CREDITO GETNET LIQUIDACAO')));
  const B = Adq14.auditar('2026-01', '*');
  chk('(f) crédito do MESMO valor mas que cita OUTRA adquirente (SafraPay) não concilia o lote da Getnet: Furo de Repasse', linhaDe(B, E.RES, '2026-01-06').status === 'furo', linhaDe(B, E.RES, '2026-01-06'));
  ofx(E, doc(tr('v1', '2026-01-06', r2(E.e06 / 2), 'TED RECEBIDA 0601'), tr('v2', '2026-01-06', r2(E.e06 - r2(E.e06 / 2)), 'TED RECEBIDA 0601'), tr('v3', '2026-01-13', E.e13r, 'CREDITO GETNET LIQUIDACAO')));
  const C = Adq14.auditar('2026-01', '*');
  chk('(f) dois créditos genéricos (sem citar a adquirente) cuja soma fecha o líquido NÃO são somados às cegas: só crédito único casa só pelo valor → Furo de Repasse com os 2 créditos sem lote', linhaDe(C, E.RES, '2026-01-06').status === 'furo' && C.banco.find(b => b.contaId === 'ct-a').creditos.filter(c => c.status === 'sem_lote').length === 2, linhaDe(C, E.RES, '2026-01-06'));
}

/* (g) crédito a menor explicado por aluguel/tarifa de POS debitado no mesmo dia */
{
  const E = await comLotes(), { Adq14 } = E;
  const doc = deb => [docOfx('xa', 'ct-a', '2026-01', [tr('m1', '2026-01-06', r2(E.e06 - 80), 'CREDITO GETNET LIQUIDACAO'), tr('m2', '2026-01-13', E.e13r, 'CREDITO GETNET LIQUIDACAO'), ...deb, tr('z9', '2026-01-16', -1, 'TARIFA MANUTENCAO')])];
  ofx(E, doc([tr('d1', '2026-01-06', -80, 'TARIFA ALUGUEL POS GETNET')]));
  const A = Adq14.auditar('2026-01', '*'), l = linhaDe(A, E.RES, '2026-01-06');
  chk('(g) repasse R$ 80,00 abaixo do esperado + débito de R$ 80,00 "ALUGUEL POS GETNET" no mesmo dia: Liquidado a Menor explicado pelo aluguel do POS (total)', l.status === 'menor' && perto(l.dif, 80) && l.explicaPos === 'total' && l.tarifas.length === 1 && perto(l.somaTarifas, 80) && A.cruz.kpis.menorPos === 1, l);
  ofx(E, doc([tr('d1', '2026-01-06', -30, 'MENSALIDADE POS SANTANDER GETNET')]));
  const B = Adq14.auditar('2026-01', '*'), lb = linhaDe(B, E.RES, '2026-01-06');
  chk('(g) débito de POS menor que a diferença: explicação parcial (não marca como explicado) e o débito aparece nas tarifas da conta', lb.status === 'menor' && lb.explicaPos === 'parcial' && B.cruz.kpis.menorPos === 0 && B.banco.find(b => b.contaId === 'ct-a').tarifas.length === 1, lb);
  ofx(E, doc([tr('d1', '2026-01-06', -80, 'TARIFA BANCARIA CESTA')]));
  const C = Adq14.auditar('2026-01', '*'), lc = linhaDe(C, E.RES, '2026-01-06');
  chk('(g) débito de tarifa qualquer (sem POS nem adquirente) NÃO explica a diferença: Liquidado a Menor sem explicação', lc.status === 'menor' && !lc.explicaPos && !lc.tarifas, lc);
}

/* (h) janela D+0, D+1 e D+2 úteis e tolerância de R$ 0,10 */
{
  const E = await comLotes(), { Adq14 } = E;
  const cenarioD = (dia, delta = 0, valor = E.e06) => { ofx(E, [docOfx('xa', 'ct-a', '2026-01', [tr('w0', '2026-01-06', -1, 'TARIFA MANUTENCAO'), tr('w1', dia, r2(valor + delta), 'CREDITO GETNET LIQUIDACAO'), tr('w2', '2026-01-13', E.e13r, 'CREDITO GETNET LIQUIDACAO'), tr('w3', '2026-01-16', -1, 'TARIFA MANUTENCAO')])]); return linhaDe(Adq14.auditar('2026-01', '*'), E.RES, '2026-01-06'); };
  const d0 = cenarioD('2026-01-06'), d1 = cenarioD('2026-01-07'), d2 = cenarioD('2026-01-08'), d3 = cenarioD('2026-01-09');
  chk('(h) crédito em D+0, D+1 e D+2 (06, 07 e 08/01): Conciliado D+0 / D+1 / D+2; em D+3 (09/01): Furo de Repasse', d0.status === 'ok' && d0.dx === 0 && d1.status === 'ok' && d1.dx === 1 && d2.status === 'ok' && d2.dx === 2 && d3.status === 'furo', [d0, d1, d2, d3].map(x => [x.status, x.dx]));
  const t1 = cenarioD('2026-01-06', 0.08), t2 = cenarioD('2026-01-06', -0.08);
  chk('(h) diferença de R$ 0,08 para mais ou para menos (arredondamento do banco) ainda concilia; a tolerância do valor exato é ± R$ 0,10 e a do estimado (Getnet) ± R$ 1,00', t1.status === 'ok' && t2.status === 'ok' && E.ADQ14.TOL.exatoAbs === 0.10 && E.ADQ14.TOL.estAbs === 1.00, [t1.status, t2.status]);
  const t3 = cenarioD('2026-01-06', -5);
  chk('(h) diferença de R$ 5,00 acima da tolerância do estimado: Liquidado a Menor (não concilia à força)', t3.status === 'menor' && perto(t3.dif, 5), t3);
}

/* ---------- ganchos: desligado = v14.13 ---------- */
{
  const off = ambiente({ g14: false }), on = ambiente({ g14: true });
  chk('recurso DESLIGADO: sub-aba nova ausente e as telas de Regras e de Crédito são exatamente as da v14.13', !off.ConcMP.SUBS72.some(([k]) => k === 'c14') && off.ConcMP.renderRegras() === 'ORIGINAL-REGRAS' && (off.ConcMP.ui.sub = 'c14', off.ConcMP.renderCredito()) === 'ORIGINAL-CREDITO');
  chk('recurso LIGADO: "Conciliação de Cartões" é a 2ª sub-aba e o painel de contratos entra antes das regras de taxa', on.ConcMP.SUBS72.map(x => x[0]).join() === 'cruzamento,c14,regras,resumo' && /Contratos × Conta Bancária de Crédito/.test(on.ConcMP.renderRegras()) && /ORIGINAL-REGRAS/.test(on.ConcMP.renderRegras()) && on.ConcMP.renderRegras().indexOf('Contratos') < on.ConcMP.renderRegras().indexOf('ORIGINAL-REGRAS'));
  semear(on); on.ConcMP.ui.sub = 'cruzamento'; chk('recurso ligado: as demais sub-abas seguem com o desenho original', on.ConcMP.renderCredito() === 'ORIGINAL-CREDITO');
}

/* =====================================================================
   7 · SERVIDOR
   ===================================================================== */
{
  const contas = new Set(['contasBancarias|ct-a', 'amb/homolog/contasBancarias|ct-h']), t = async (sql, p) => contas.has(`${p[0]}|${p[1]}`) ? [{ ok: 1 }] : [];
  const lig = { recursoAtivo: k => k === adq.RECURSO }, desl = { recursoAtivo: () => false }, tenta = async (s, c, d) => { try { await adq.protegerAdq1414(t, s, c, d); return 'ok'; } catch (e) { return e.status || e.message; } };
  const contrato = (o = {}) => ({ adquirente: 'GETNET', empresaId: 'resilienza', contaId: 'ct-a', ativo: true, ...o }), idC = 'adq-getnet__emp-resilienza';
  chk('recurso desligado: o servidor não valida nada (comportamento da v14.13)', await tenta(desl, 'adq_contratos/' + idC, { adquirente: 'x' }) === 'ok' && await tenta(desl, 'adq_lotes/lixo', {}) === 'ok');
  chk('contrato válido grava; sem a conta (422), com conta que não existe no painel (422), em branco (422)', await tenta(lig, 'adq_contratos/' + idC, contrato()) === 'ok' && await tenta(lig, 'adq_contratos/' + idC, contrato({ contaId: undefined })) === 422 && await tenta(lig, 'adq_contratos/' + idC, contrato({ contaId: 'nao-existe' })) === 422 && await tenta(lig, 'adq_contratos/' + idC, contrato({ contaId: '  ' })) === 422);
  chk('contrato: identificador tem de bater com adquirente + empresa do conteúdo (outra empresa no mesmo id = 422); empresa e adquirente obrigatórias', await tenta(lig, 'adq_contratos/adq-getnet__emp-mar-aberto', contrato()) === 422 && await tenta(lig, 'adq_contratos/' + idC, contrato({ empresaId: '' })) === 422 && await tenta(lig, 'adq_contratos/' + idC, contrato({ adquirente: '' })) === 422 && await tenta(lig, 'adq_contratos/lixo', contrato()) === 422);
  chk('ramo de ambiente (amb/homolog/): a conta é conferida no mesmo ramo', await tenta(lig, 'amb/homolog/adq_contratos/' + idC, contrato({ contaId: 'ct-h' })) === 'ok' && await tenta(lig, 'amb/homolog/adq_contratos/' + idC, contrato({ contaId: 'ct-a' })) === 422);
  const lote = (o = {}) => ({ formato: 1, adquirente: 'GETNET', empresaId: 'resilienza', cnpj: CNPJ_RES, competencia: '2026-01', contaId: 'ct-a', grupos: [], ...o }), idL = `adq-getnet__${CNPJ_RES}__2026-01`;
  chk('lote válido grava; id fora do formato (422)', await tenta(lig, 'adq_lotes/' + idL, lote()) === 'ok' && await tenta(lig, 'adq_lotes/lixo', lote()) === 422);
  chk('lote NUNCA grava na chave de outro CNPJ, outra competência ou outra adquirente (422): um cliente defeituoso não sobrescreve o lote alheio', await tenta(lig, `adq_lotes/adq-getnet__${CNPJ_MAR}__2026-01`, lote()) === 422 && await tenta(lig, `adq_lotes/adq-getnet__${CNPJ_RES}__2026-02`, lote()) === 422 && await tenta(lig, `adq_lotes/adq-safrapay__${CNPJ_RES}__2026-01`, lote()) === 422);
  chk('lote: CNPJ inválido, competência inválida, adquirente fora de Getnet/SafraPay, sem conta e sem empresa (422)', await tenta(lig, 'adq_lotes/adq-getnet__11111111111111__2026-01', lote({ cnpj: '11111111111111' })) === 422 && await tenta(lig, `adq_lotes/adq-getnet__${CNPJ_RES}__2026-13`, lote({ competencia: '2026-13' })) === 422 && await tenta(lig, `adq_lotes/adq-cielo__${CNPJ_RES}__2026-01`, lote({ adquirente: 'CIELO' })) === 422 && await tenta(lig, 'adq_lotes/' + idL, lote({ contaId: '' })) === 422 && await tenta(lig, 'adq_lotes/' + idL, lote({ empresaId: '' })) === 422);
  chk('outras coleções passam intactas pelo gancho (adq_taxas, config…)', await tenta(lig, 'adq_taxas/qualquer', { a: 1 }) === 'ok' && await tenta(lig, 'config/recursos', {}) === 'ok');
  // paridade das funções de chave com o painel
  const E = ambiente(), P = E.AdqTaxas;
  const nomes = ['GETNET', 'SafraPay', 'Safra Pay', 'Santander Getnet', 'Cartões Ção ñ', 'Esposende Card', '  Rede   Itaú '];
  chk('funções de chave do servidor (chaveAdq, slugAdq, idContrato, idLote) idênticas às do painel (AdqTaxas e Adq14)', nomes.every(n => adq.chaveAdq(n) === P.chave(n) && adq.slugAdq(n) === P.slug(n) && adq.adqId(n) === P.adqId(n) && adq.idContrato(n, 'mar-aberto') === E.Adq14.idContrato(n, 'mar-aberto') && adq.idLote(n, CNPJ_MAR, '2026-03') === E.Adq14.idLote(n, fmtCnpj(CNPJ_MAR), '2026-03')));
  chk('cnpjValido do servidor aceita os CNPJs gerados aqui e recusa dígito errado e sequência repetida', adq.cnpjValido(CNPJ_RES) && adq.cnpjValido(fmtCnpj(CNPJ_MAR)) && !adq.cnpjValido(CNPJ_RES.slice(0, 13) + '0') && !adq.cnpjValido('00000000000000') && !adq.cnpjValido('123'));
  // ACL
  const sess = perms => ({ perms: new Set(perms), perfil: 'OPERACIONAL', nivel: 2 }), can = (p, c, op) => perm.acessoPorMatriz(sess(p), c, op);
  chk('ACL: contratos — ler com retaguarda.adq.ver, gravar só com retaguarda.adq.taxas; lotes — gravar só com retaguarda.adq.importar; sem permissão nada', can(['retaguarda.adq.ver'], 'adq_contratos/x', 'r') && !can(['retaguarda.adq.ver'], 'adq_contratos/x', 'w') && can(['retaguarda.adq.taxas'], 'adq_contratos/x', 'w') && can(['retaguarda.adq.ver'], 'adq_lotes/x', 'r') && !can(['retaguarda.adq.ver'], 'adq_lotes/x', 'w') && can(['retaguarda.adq.importar'], 'adq_lotes/x', 'w') && !can([], 'adq_lotes/x', 'r'));
  chk('ACL: sem o perfil Loja gravando; regras de acesso por coleção exigem nível admin (Master) por padrão', !perm.acessoPorMatriz({ perms: new Set(['retaguarda.adq.taxas', 'retaguarda.adq.importar']), perfil: 'LOJA', nivel: 1 }, 'adq_lotes/x', 'w') && regras.REGRAS.adq_contratos[1] === 'admin' && regras.REGRAS.adq_lotes[1] === 'admin');
  // catálogo de backup igual no painel e no servidor
  const bkp = corta('FRENTES: [', '\n  ],').match(/"id": "adquirentes".*"colecoes": (\[[^\]]*\])/);
  const cli = JSON.parse(bkp[1]), srv = escopo.FRENTES.find(f => f.id === 'adquirentes').colecoes;
  chk('backup: a frente "adquirentes" tem adq_contratos e adq_lotes, igual no painel e no servidor (nuvem × .json), e o .json do painel lista as duas coleções', igual(cli, srv) && srv.includes('adq_contratos') && srv.includes('adq_lotes') && /'conc_fechamento', 'adq_contratos', 'adq_lotes'(, 'adq_agendas', 'adq_erp')?\]/.test(html) && escopo.frenteDe('adq_lotes') === 'adquirentes' && escopo.frenteDe('adq_contratos') === 'adquirentes');
  chk('backup: o painel só lê/grava as duas coleções com a permissão da Auditoria de Adquirentes (retaguarda.adq.ver)', /c === 'adq_contratos' \|\| c === 'adq_lotes'( \|\| c === 'adq_agendas' \|\| c === 'adq_erp')?\) && !Auth\.can\('retaguarda\.adq\.ver'\)\) continue/.test(html) && /c === 'adq_contratos' \|\| c === 'adq_lotes'( \|\| c === 'adq_agendas' \|\| c === 'adq_erp')?\) && !Auth\.can\('retaguarda\.adq\.ver'\)\) return false/.test(html));
  chk('promoção para Produção: contratos NÃO são promovidos (a conta bancária é de cada ambiente) — só as taxas', !/adq_contratos/.test((fs.existsSync(path.join(raiz, 'netlify/lib/ambiente.mjs')) ? fs.readFileSync(path.join(raiz, 'netlify/lib/ambiente.mjs'), 'utf8') : '')));
}

console.log(`\n${OK.length} ok · ${FAIL.length} falha(s)`);
process.exit(FAIL.length ? 1 : 0);
