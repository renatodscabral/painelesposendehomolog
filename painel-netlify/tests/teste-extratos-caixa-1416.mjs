/* v14.16 · DFC · Extratos da Caixa: OFX sem perda de lançamentos + extrato em Excel (.xls/.xlsx).
   Valida o CÓDIGO REAL do painel (public/index.html: OFX, ContasBancarias, DFC, PARC_PIX, FluxoDFC e o módulo OFX16/importar16) num contexto isolado do Node, só com dados FICTÍCIOS (LGPD):
   a conta, os CNPJ (gerados aqui pelos dígitos verificadores) e os nomes não são de pessoa ou empresa real; o padrão reproduz o defeito diagnosticado nos extratos reais de jan/2026
   (BANKID 0104): o mesmo <FITID>/<CHECKNUM> (código do terminal) repetido em centenas de depósitos de R$ 2.000,00 e entre "DEB PIX CHAVE" (-R$ 157.941,00) e "TAR PIX" (-R$ 8,50).
   Blocos:
     0) recurso gestao_v1416 e Regra de Ouro (regiões protegidas, OFX.ler intacto, FCX/Contábil intactos);
     1) o DEFEITO reproduzido com o recurso DESLIGADO (o caminho da v14.15.1 perde lançamentos) e a correção com o recurso LIGADO: 869 depósitos = R$ 1.245.035,50, 20 TAR PIX = -R$ 170,00, DEB PIX CHAVE;
     2) reimportar o MESMO arquivo é bloqueado (também em dois arquivos que se sobrepõem, e quando o banco só muda o texto do histórico); mesmo FITID com conteúdo diferente em outro arquivo/mês NÃO é duplicata;
     3) dados gravados pelo caminho antigo (um lançamento por FITID) são completados sem duplicar os que já existiam;
     4) extrato em Excel: leitor da Caixa (cabeçalho em qualquer linha, ignora SALDO DIA e valor zero com documento 000000, NBSP e sinal antes do número, CPF/CNPJ, Nome/Razão Social, saldo final), .xlsx E .xls,
        conta obrigatória, reimportação bloqueada, Excel × OFX do mesmo período (completa com CPF/CNPJ e nome, sem duplicar), ordem decrescente;
     5) cruzamento: o CNPJ do Excel (fora do histórico) chega ao cruzamento com Fornecedores e Clientes; o nome entra no histórico e as regras de transferência entre contas próprias o enxergam;
     6) limpar/reimportar a conta no mês (sem apagar linha por linha), partição por tamanho (cada documento < 200 KB), recurso desligado ≡ v14.15.1.
   O leitor de planilhas é o SheetJS (`xlsx`): fora do pacote para não levar node_modules; instale com `npm i --no-save xlsx@0.18.5` ou aponte XLSX_PATH. Sem ele, só os blocos de arquivo .xlsx/.xls são PULADOS.
   Uso: node tests/teste-extratos-caixa-1416.mjs */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(process.env.PAINEL_HTML || path.join(raiz, 'public/index.html'), 'utf8');
const OK = [], FAIL = [], PULADOS = [];
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x !== '' ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 1200) : '')); };
const pula = n => { PULADOS.push(n); console.log('PULADO ' + n + ' (biblioteca xlsx não encontrada)'); };
const md5 = t => createHash('md5').update(t).digest('hex');
const corta = (ini, fim) => { const a = html.indexOf(ini), b = html.indexOf(fim, a + ini.length); if (a < 0 || b < 0) throw new Error('bloco não encontrado: ' + ini.slice(0, 70) + ' … ' + fim.slice(0, 70)); return html.slice(a, b); };
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const req = createRequire(import.meta.url);
let XLSX = null;
for (const p of [process.env.XLSX_PATH, 'xlsx', path.join(raiz, 'node_modules/xlsx'), '/home/claude/w/node_modules/xlsx'].filter(Boolean)) { try { XLSX = req(p); break; } catch { /* tenta o próximo */ } }

/* ---------- 0 · recurso, Regra de Ouro, montagem ---------- */
chk('recurso gestao_v1416 na lista de liberação (v14.16) e helper g16() independente dos anteriores', /gestao_v1416: \{ versao: 'v14\.16'/.test(html) && /function g16\(\) \{ return typeof Recursos !== 'undefined' && Recursos\.ativo\('gestao_v1416'\); \}/.test(html));
chk('nenhuma peça deixou marcador de montagem no painel final', !/@@V1416_/.test(html));
const MK_DFC = '/* ============================ DFC ============================ */', MK_PE = 'const PARTE_EXTRATO = 900;', MK_M6 = '/* =====================================================================\n   MÓDULO 6 · CREDSYSTEM';
const guardas = {
  'OFX/contas (OFX → início da DFC)': [md5(html.slice(html.indexOf('const OFX = {'), html.indexOf(MK_DFC))), 'f24c59ac5f7a2ec7544b3643a321f096'],
  'adquirentes e FCX (ADQ_CFG → PARTE_EXTRATO)': [md5(html.slice(html.indexOf('const ADQ_CFG'), html.indexOf(MK_PE))), '6a43dc199b96629c8c8af17b4016d126'],
  'Credsystem em diante (Módulo 6 → CS_INDICADORES)': [md5(html.slice(html.indexOf(MK_M6), html.indexOf('const CS_INDICADORES'))), '4738cb8f2d12cff23c6e385e573f9eae'],
};
for (const [k, [a, b]] of Object.entries(guardas)) chk(`Regra de Ouro: ${k} idêntico ao da v14.15.1 (md5 ${b.slice(0, 8)}…)`, a === b, a);
for (const [f, h] of [['fcx.html', '640800e0'], ['contabilidade.html', 'a41642fb'], ['contabilidade_v1391.html', 'ea73d20b']]) {
  const p = path.join(raiz, 'public', f);
  chk(`Regra de Ouro: public/${f} ${f === 'fcx.html' ? 'idêntico ao da v14.17: v14.08 + a única exceção autorizada (importação de Saídas com os dois layouts do ERP, atrás de gestao_v1417)' : 'idêntico ao da v14.08'} (md5 ${h}…)`, fs.existsSync(p) && md5(fs.readFileSync(p)).startsWith(h));
}
chk('OFX.ler (leitor original, dentro da região protegida) continua devolvendo o FITID como id — a correção é feita fora dele (OFX16.ler)', /let id = this\.tag\(t, 'FITID'\);/.test(html) && html.includes('/* OFX16:INI */') && html.indexOf('/* OFX16:INI */') > html.indexOf(MK_M6));

/* ---------- ambiente: código REAL do painel, com Repo/UI de brincadeira ---------- */
const ofxContasDfc = corta('const OFX = {', '/* ============================ IEO ============================ */'); // OFX, BANCOS, ContasBancarias, DFC e PARC_PIX
const fluxo = corta('const FluxoDFC = {', '/* v14.05 · DFC × Fornecedores e Clientes (recurso gestao_v1405) */');
const forn05 = corta('/* v14.05 · DFC × Fornecedores e Clientes (recurso gestao_v1405) */', '/* v14.09 · Extratos OFX × Contas a Pagar do FCX');
const modA = corta('/* OFX16:INI */', '/* OFX16:FIM */') + '/* OFX16:FIM */';
const modB = corta('/* v14.16 · EXTRATOS DA CAIXA · tela e gravação', '/* ---- fim v14.16 ---- */');
const dvC = (d, n) => { let s = 0, p = n - 7; for (let i = 0; i < n; i++) { s += +d[i] * p--; if (p < 2) p = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
const gerarCnpj = b8 => { const d = b8 + '0001'; const d1 = dvC(d, 12); return d + d1 + dvC(d + d1, 13); };
const CNPJ_FORN = gerarCnpj('11222333'), CNPJ_PROPRIA = gerarCnpj('44555666');
const fmtCnpj = s => s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const NBSP = ' ';

function ambiente({ g16 = true, fornecedores = false } = {}) {
  const S = { extratos: new Map(), contasBancarias: new Map(), dfc: new Map() }; let tic = 0;
  const ctx = { flag16: g16, toasts: [], modais: [], confirmou: [], baseDFC: [], conta: null, dataCol: 'lancamento', escolhaConta: true, maiorDoc: 0, bytesMax: 0 };
  const sanea = d => { const t = JSON.stringify(d); const b = Buffer.byteLength(t); ctx.maiorDoc = Math.max(ctx.maiorDoc, b); if (b > 256 * 1024) throw new Error('documento acima de 256 KiB (' + b + ')'); return JSON.parse(t); };
  const Repo = {
    prontas: new Set(['extratos', 'contasBancarias']), todos: c => [...(S[c] || new Map()).values()], get: (c, id) => (c === 'config' ? null : (S[c] || new Map()).get(id) || null),
    salvar: async (c, id, d) => { (S[c] ||= new Map()).set(id, { id, ...sanea(d), atualizadoEm: 't' + (++tic) }); },
    excluir: async (c, id) => { S[c].delete(id); },
  };
  const parceiros = []; // fornecedores/clientes fictícios p/ o cruzamento (bloco 5)
  const cadastro = { pronto: () => true, todos: () => parceiros, get: id => parceiros.find(p => p.id === id) || null, catPadrao: () => '',
    indice: () => ({ chaves: new Map(parceiros.map(p => ['cnpj:' + p.cnpj, { donos: new Map([[p.id, 'cadastro']]) }])), nomesPorPalavra: new Map(), prefixos: [] }) };
  const mocks = {
    Repo, g04: () => true, g05: () => fornecedores, g07: () => false, g09: () => false, g11: () => false, g16: () => ctx.flag16, g94: () => true, g99: () => false,
    Auth: { can: () => true, id: 'u-teste', perfilReal: 'GESTOR', podeEditarNuvem: true }, Acesso: { loja: () => false },
    UI: { toast: m => ctx.toasts.push(m), modal(o) { ctx.modais.push(o); return { el: {}, fechar() { } }; }, confirmar: async (t, x) => { ctx.confirmou.push([t, x]); return true; }, lerForm: () => ({}) },
    Fmt: { brl: n => 'R$' + Number(n).toFixed(2), brl0: n => 'R$' + Math.round(n), data: d => String(d ?? '').replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1') },
    esc: s => String(s ?? ''), campo: () => '', sleep: async () => { }, App: { render() { } }, Libs: { xlsx: async () => { if (!XLSX) throw new Error('sem xlsx'); return XLSX; } }, $: () => null,
    Retaguarda: { mesLabel: m => m, norm: s => String(s || '').toUpperCase(), nomeLoja: () => '', cor: () => '', bloqueado: () => '' }, Datas: { hojeISO: () => '2026-11-17' },
    Parc11: cadastro, Recursos: { ativo: () => true }, Documento: {}, FCX: {}, Cloud: {}, document: { body: { contains: () => false } },
  };
  const nomes = Object.keys(mocks);
  const fn = new Function(...nomes, `${ofxContasDfc}\nconst PARTE_EXTRATO = 900;\n${fluxo}\n${forn05}\n${modA}\n${modB}\nreturn { OFX, DFC, PARC_PIX, ContasBancarias, FluxoDFC, OFX16 };`);
  const E = fn(...nomes.map(k => mocks[k]));
  Object.assign(ctx, E, { S, Repo, parceiros });
  E.FluxoDFC.ui.mes = '2026-01';
  Object.assign(E.FluxoDFC, { // trechos de outros recursos que a importação chama (v14.09 e a base mensal da DFC) — aqui sem Contas a Pagar e sem Fornecedores como padrão
    avisoCP09: () => '', cruzarCP09: l => l, prepararCP09: async () => null, txtCP09: () => '', sufCP09: () => '', perguntarConta: async () => null,
    atualizarBaseDFC: async meses => { ctx.baseDFC.push(...meses); }, esperarForn05: async () => { },
  });
  if (!fornecedores) Object.assign(E.FluxoDFC, { prontoForn05: () => true, leForn05: () => false });
  E.FluxoDFC.pedirContaExcel16 = async () => (ctx.escolhaConta ? { conta: ctx.conta, dataCol: ctx.dataCol } : null); // o modal real é HTML; aqui responde a escolha da pessoa
  const conta = { id: 'cx1', apelido: 'Caixa Movimento', banco: '104', bancoNome: 'Caixa Econômica Federal', agencia: '0123', conta: '30000123', digito: '45', ativa: true };
  S.contasBancarias.set(conta.id, conta); ctx.conta = conta;
  return ctx;
}
const arquivoDe = (nome, buf) => { const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'utf8'); return { name: nome, size: b.length, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };
const totalGravado = E => E.FluxoDFC.transacoes(); // com contaId e docId, como o painel lê

/* ---------- fixture: extrato OFX da Caixa (fictício) no padrão do defeito ---------- */
const dia = d => `202601${String(d).padStart(2, '0')}`;
function lancamentosCaixa() {
  const L = [];
  const dep = (d, fitid, valor, memo = 'CRED TED DEP DIN') => L.push({ d, fitid, valor, tipo: 'CREDIT', nome: '', memo, checknum: fitid });
  for (let d = 2; d <= 21; d++) for (let i = 0; i < 15; i++) dep(d, '324200', 2000); // 300 depósitos de R$ 2.000,00, MESMO terminal, MESMO dia
  for (let d = 5; d <= 14; d++) for (let i = 0; i < 25; i++) dep(d, '064800', 2000); // 250
  for (let d = 20; d <= 24; d++) for (let i = 0; i < 10; i++) dep(d, '094300', 2000); // 50 — o mesmo código dos débitos PIX
  for (let i = 0; i < 268; i++) dep(1 + (i % 28), '55' + (i % 7), 167.5, 'CRED DEP CHEQUE'); // 268 × 167,50 em 7 códigos repetidos (também em dias diferentes)
  dep(30, '777001', 145.5, 'CRED DOC');
  L.push({ d: 6, fitid: '094300', valor: -157941, tipo: 'DEBIT', nome: 'DEB PIX CHAVE', memo: 'FORNECEDOR EXEMPLO LTDA', checknum: '094300' });
  for (let d = 6; d <= 25; d++) L.push({ d, fitid: '094300', valor: -8.5, tipo: 'DEBIT', nome: 'TAR PIX', memo: 'TARIFA PIX ENVIADO', checknum: '094300' }); // 20 × R$ 8,50 = R$ 170,00
  [['880001', 'TARIFA PACOTE', -60], ['880002', 'IMPOSTO IOF', -12.34], ['880003', 'DEB AUT ENERGIA', -980.1]].forEach(([f, n, v], i) => L.push({ d: 8 + i, fitid: f, valor: v, tipo: 'DEBIT', nome: n, memo: n, checknum: f }));
  L.push({ d: 12, fitid: '', valor: -33.3, tipo: 'DEBIT', nome: 'DEB CESTA', memo: 'CESTA SERVICOS', checknum: '' }, { d: 12, fitid: '', valor: -33.3, tipo: 'DEBIT', nome: 'DEB CESTA', memo: 'CESTA SERVICOS', checknum: '' }); // sem FITID, idênticos
  return L;
}
function ofxDe(lancs, { saldo = 12345.67, dtfim = 31, acct = '003000012345' } = {}) {
  const trn = l => `<STMTTRN><TRNTYPE>${l.tipo}<DTPOSTED>${dia(l.d)}120000[-3:BRT]<TRNAMT>${l.valor.toFixed(2)}${l.fitid ? `<FITID>${l.fitid}` : ''}${l.checknum ? `<CHECKNUM>${l.checknum}` : ''}${l.nome ? `<NAME>${l.nome}` : ''}<MEMO>${l.memo}</STMTTRN>`;
  return `OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nCHARSET:1252\n\n<OFX><SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20260201</SONRS></SIGNONMSGSRSV1><BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS><STMTRS><CURDEF>BRL<BANKACCTFROM><BANKID>0104<BRANCHID>0123<ACCTID>${acct}<ACCTTYPE>CHECKING</BANKACCTFROM><BANKTRANLIST><DTSTART>20260101<DTEND>${dia(dtfim)}${lancs.map(trn).join('\n')}</BANKTRANLIST><LEDGERBAL><BALAMT>${saldo.toFixed(2)}<DTASOF>${dia(dtfim)}</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
}
const L = lancamentosCaixa(), OFX_JAN = ofxDe(L);
const credito = l => l.filter(t => t.valor > 0), nTar = l => l.filter(t => /TAR PIX/.test(t.hist)), soma = l => r2(l.reduce((a, t) => a + t.valor, 0));
const ESPERADO = { total: L.length, depositos: 869, valorDepositos: 1245035.5, tar: 20, valorTar: -170 };
chk('a fixture reproduz o diagnóstico: 869 depósitos somando R$ 1.245.035,50, 20 TAR PIX de R$ 8,50 e o DEB PIX CHAVE de R$ 157.941,00 com o mesmo FITID',
  L.filter(l => l.valor > 0).length === 869 && r2(L.filter(l => l.valor > 0).reduce((a, l) => a + l.valor, 0)) === 1245035.5 && L.filter(l => l.nome === 'TAR PIX').length === 20 && L.some(l => l.valor === -157941 && l.fitid === '094300'));

/* ---------- 1 · o defeito (recurso DESLIGADO) × a correção (LIGADO) ---------- */
{
  const A = ambiente({ g16: false });
  await A.FluxoDFC.importarOFX([arquivoDe('caixa_jan.ofx', OFX_JAN)]);
  const g = totalGravado(A), dep = credito(g);
  console.log(`      (recurso desligado, como na v14.15.1: ${g.length} de ${L.length} lançamentos; depósitos ${dep.length} = ${soma(dep)}; TAR PIX ${nTar(g).length})`);
  chk('DEFEITO reproduzido com o recurso desligado: o FITID repetido faz o caminho antigo perder lançamentos (depósitos e tarifas PIX)', g.length < L.length / 5 && dep.length < 40 && nTar(g).length < ESPERADO.tar, [g.length, dep.length, nTar(g).length]);
}
const B = ambiente();
await B.FluxoDFC.importarOFX([arquivoDe('caixa_jan.ofx', OFX_JAN)]);
let gB = totalGravado(B), depB = credito(gB);
chk(`CORREÇÃO: os ${L.length} lançamentos do arquivo foram todos gravados (nenhum descartado pelo FITID/data/valor repetidos)`, gB.length === ESPERADO.total, [gB.length, ESPERADO.total]);
chk('os 869 depósitos somam exatamente R$ 1.245.035,50 (centavo a centavo)', depB.length === 869 && soma(depB) === 1245035.5, [depB.length, soma(depB)]);
chk('os 20 TAR PIX (-R$ 170,00) e o DEB PIX CHAVE (-R$ 157.941,00) que dividem o FITID 094300 estão todos lá', nTar(gB).length === 20 && soma(nTar(gB)) === -170 && gB.filter(t => /DEB PIX CHAVE/.test(t.hist) && t.valor === -157941).length === 1);
chk('as 300 + 250 + 50 ocorrências idênticas de R$ 2.000,00 (mesmo FITID, data e valor) continuam todas distintas', gB.filter(t => t.valor === 2000).length === 600);
chk('os dois lançamentos idênticos SEM FITID (hash do conteúdo + ocorrência) também foram gravados', gB.filter(t => /DEB CESTA/.test(t.hist)).length === 2);
chk('cada lançamento tem id único na conta, o 1º de cada FITID mantém o FITID puro (compatível com o que já estava gravado) e os demais ganham FITID~hash[#n] com o FITID original em fid',
  new Set(gB.map(t => t.id)).size === gB.length && gB.some(t => t.id === '324200' && !t.fid) && gB.filter(t => t.id.startsWith('324200~')).length === 299 && gB.filter(t => t.fid === '324200').length === 299);
chk('saldo e meta do arquivo gravados (saldo final do OFX no mês, arquivo com formato)', B.Repo.get('extratos', 'cx1_2026-01_0').saldo?.valor === 12345.67 && B.Repo.get('extratos', 'cx1_2026-01_0').arquivos?.[0]?.formato === 'ofx');
chk('nenhum documento gravado passa de 256 KiB, é JSON puro, e a base da DFC do mês foi recalculada', B.maiorDoc < 256 * 1024 && B.baseDFC.includes('2026-01'), B.maiorDoc);
const antesJSON = JSON.stringify([...B.S.extratos.values()].map(d => [d.id, d.transacoes.map(t => t.id)]));

/* ---------- 2 · reimportação bloqueada; conteúdo diferente com o mesmo FITID não é duplicata ---------- */
await B.FluxoDFC.importarOFX([arquivoDe('caixa_jan.ofx', OFX_JAN)]);
chk('reimportar o MESMO arquivo não grava nada (multiconjunto): mesmos documentos, mesmos ids, mesma contagem', JSON.stringify([...B.S.extratos.values()].map(d => [d.id, d.transacoes.map(t => t.id)])) === antesJSON && totalGravado(B).length === L.length);
chk('o resumo da confirmação diz quantos já estavam gravados', new RegExp(L.length + ' já gravado').test(B.confirmou.at(-1)[1]), B.confirmou.at(-1)[1].slice(0, 400));
{ // dois arquivos que se SOBREPÕEM (1–15 e 10–31): a união sem repetir o que é igual
  const C = ambiente(), a = L.filter(l => l.d <= 15), b = L.filter(l => l.d >= 10);
  await C.FluxoDFC.importarOFX([arquivoDe('a.ofx', ofxDe(a, { dtfim: 15 }))]); await C.FluxoDFC.importarOFX([arquivoDe('b.ofx', ofxDe(b))]);
  const uniao = L.length; // todo lançamento de L está em a ou em b; os do dia 10–15 estão nos dois
  chk('arquivos sobrepostos: a união fica com todos os lançamentos, sem duplicar o trecho 10–15', totalGravado(C).length === uniao && soma(credito(totalGravado(C))) === 1245035.5, [totalGravado(C).length, uniao]);
}
{ // o banco muda só o texto do histórico entre duas exportações: continua sendo o mesmo lançamento (FITID + data + valor)
  const C = ambiente(), pouco = L.filter(l => l.d <= 3);
  await C.FluxoDFC.importarOFX([arquivoDe('a.ofx', ofxDe(pouco, { dtfim: 3 }))]);
  const n0 = totalGravado(C).length;
  await C.FluxoDFC.importarOFX([arquivoDe('a2.ofx', ofxDe(pouco.map(l => ({ ...l, memo: l.memo + ' (REEXPORTADO)' })), { dtfim: 3 }))]);
  chk('histórico reescrito pelo banco na reexportação: nada é duplicado', totalGravado(C).length === n0 && n0 === pouco.length, [totalGravado(C).length, n0]);
}
{ // o mesmo código de terminal em OUTRO mês, com outro valor/data, é lançamento novo (o caminho antigo o descartava)
  const C = ambiente();
  await C.FluxoDFC.importarOFX([arquivoDe('jan.ofx', ofxDe([{ d: 5, fitid: '324200', valor: 2000, tipo: 'CREDIT', nome: '', memo: 'CRED DEP', checknum: '324200' }], { dtfim: 31 }))]);
  const fev = ofxDe([{ d: 3, fitid: '324200', valor: 2000, tipo: 'CREDIT', nome: '', memo: 'CRED DEP', checknum: '324200' }, { d: 5, fitid: '324200', valor: 750, tipo: 'CREDIT', nome: '', memo: 'CRED DEP', checknum: '324200' }], { dtfim: 28 }).replace(/202601/g, '202602');
  await C.FluxoDFC.importarOFX([arquivoDe('fev.ofx', fev)]);
  const g = totalGravado(C);
  chk('mesmo FITID em outro mês (data e valor diferentes) é lançamento novo; o de janeiro segue com o id puro', g.length === 3 && g.filter(t => t.data.startsWith('2026-02')).length === 2 && g.filter(t => t.id === '324200').length === 1 && new Set(g.map(t => t.id)).size === 3);
}

/* ---------- 3 · dados gravados pelo caminho ANTIGO são completados, sem duplicar ---------- */
{
  const A = ambiente({ g16: false });
  await A.FluxoDFC.importarOFX([arquivoDe('caixa_jan.ofx', OFX_JAN)]); // grava pouco: um por FITID
  const antigos = totalGravado(A).map(t => t.id).sort(), n0 = antigos.length;
  A.ctx = null; A.flag16 = true;
  await A.FluxoDFC.importarOFX([arquivoDe('caixa_jan.ofx', OFX_JAN)]);
  const g = totalGravado(A);
  chk(`dados antigos (${n0} lançamentos, um por FITID) + o mesmo arquivo com a correção ligada: completa os ${L.length} sem duplicar os ${n0} que já estavam`, g.length === L.length && soma(credito(g)) === 1245035.5 && antigos.every(id => g.some(t => t.id === id)) && new Set(g.map(t => t.id)).size === g.length, [g.length, n0]);
  chk('os lançamentos antigos mantêm o id (referências e classificações manuais intactas)', antigos.every(id => g.filter(t => t.id === id).length === 1));
}

/* ---------- 4 · extrato em Excel ---------- */
const CAB = ['Data Lancamento', 'Data Movimento', 'Histórico', 'Documento', 'Valor Lançamento', 'Saldo', 'CPF/CNPJ', 'Nome/Razão Social'];
const linhasExcel = ({ cabAt = 3 } = {}) => {
  const topo = [['EXTRATO DE CONTA CORRENTE · PESSOA JURÍDICA'], ['Conta: 0123 / 003 / 30000123-45'], ['Período: 01/01/2026 a 31/01/2026']].slice(0, cabAt).concat(Array.from({ length: Math.max(0, cabAt - 3) }, () => []));
  return [...topo, CAB,
    ['02/01/2026', '02/01/2026', 'SALDO DIA', '000000', '0,00', `10.000,00${NBSP}C`, '', ''],
    ['02/01/2026', '02/01/2026', 'CRED DEP DIN', '324200', `${NBSP}2.000,00`, `12.000,00${NBSP}C`, '', ''],
    ['02/01/2026', '02/01/2026', 'CRED DEP DIN', '324200', `${NBSP}2.000,00`, `14.000,00${NBSP}C`, '', ''],
    ['02/01/2026', '02/01/2026', 'CRED DEP DIN', '324200', `${NBSP}2.000,00`, `16.000,00${NBSP}C`, '', ''],
    ['03/01/2026', '03/01/2026', 'DEB PIX CHAVE', '094300', `-${NBSP}157.941,00`, `-141.941,00${NBSP}D`, fmtCnpj(CNPJ_FORN), 'FORNECEDOR EXEMPLO LTDA'],
    ['03/01/2026', '03/01/2026', 'TAR PIX', '094300', '- 8,50', `-141.949,50${NBSP}D`, '', ''],
    ['04/01/2026', '04/01/2026', 'SALDO ANTERIOR', '000000', '0,00', '', '', ''],
    ['04/01/2026', '04/01/2026', 'LANC ZERADO', '000000', '0,00', '', '', ''],
    ['05/01/2026', '05/01/2026', 'TRANSF ENTRE CONTAS', '777001', `-${NBSP}5.000,00`, `-146.949,50${NBSP}D`, fmtCnpj(CNPJ_PROPRIA), 'ESPOSENDE CALCADOS LTDA'],
    [46028, 46028, 'CRED TED RECEBIDA', '555100', 3500.25, `-143.449,25${NBSP}D`, '*** 123.456 **', 'CLIENTE MASCARADO'], // data como número de série do Excel (06/01/2026) e valor numérico; CPF mascarado é ignorado
    ['31/01/2026', '30/01/2026', 'CRED DEP CHEQUE', '', `${NBSP}167,50`, `-143.281,75${NBSP}D`, '', ''],
    ['31/01/2026', '31/01/2026', 'SALDO DIA', '000000', '0,00', `-143.281,75${NBSP}D`, '', ''],
  ];
};
chk('o número de série do Excel 46028 é 06/01/2026 (verificação da fixture)', new Date(Date.UTC(1899, 11, 30) + 46028 * 864e5).toISOString().slice(0, 10) === '2026-01-06');
{
  const A = ambiente(); const { OFX16: X } = A;
  chk('valor brasileiro: sinal antes do número com espaço/NBSP, separador de milhar, D/C, parênteses, número do Excel e valor com R$',
    X.valorBR(`-${NBSP}136.200,00`) === -136200 && X.valorBR('- 136.200,00') === -136200 && X.valorBR(`${NBSP}2.000,00`) === 2000 && X.valorBR('1.234,56 D') === -1234.56 && X.valorBR('1.234,56 C') === 1234.56 && X.valorBR('(1.234,56)') === -1234.56
      && X.valorBR('136.200,00-') === -136200 && X.valorBR(2000) === 2000 && X.valorBR('R$ 10,50') === 10.5 && X.valorBR('1234.56') === 1234.56 && X.valorBR('') === null && X.valorBR('abc') === null && X.valorBR('0,00') === 0);
  chk('data do Excel: dd/mm/aaaa (com hora), aaaa-mm-dd, AAAAMMDD, número de série e inválidas', X.dataExcel('02/01/2026') === '2026-01-02' && X.dataExcel('02/01/2026 14:30') === '2026-01-02' && X.dataExcel('2026-01-02') === '2026-01-02' && X.dataExcel(20260102) === '2026-01-02' && X.dataExcel(46028) === '2026-01-06' && X.dataExcel('31/02/2026') === null && X.dataExcel('') === null && X.dataExcel('texto') === null);
  const e = X.lerExcelLinhas(linhasExcel(), 'extrato.xlsx');
  chk('leitor (linhas): cabeçalho achado na 4ª linha; SALDO DIA / SALDO ANTERIOR e o valor zero com documento 000000 ficam de fora; 8 lançamentos válidos', e.cabLinha === 4 && e.transacoes.length === 8 && e.ignoradas.saldo === 3 && e.ignoradas.zero === 1 && !e.transacoes.some(t => /SALDO/.test(t.hist)), [e.cabLinha, e.transacoes.length, e.ignoradas]);
  chk('valores: - 136.200,00 (NBSP) vira -136200,00; "- 8,50" vira -8,50; célula numérica e data em número de série funcionam', e.transacoes.find(t => /DEB PIX/.test(t.hist)).valor === -157941 && e.transacoes.find(t => /TAR PIX/.test(t.hist)).valor === -8.5 && e.transacoes.find(t => /CRED TED/.test(t.hist)).valor === 3500.25 && e.transacoes.find(t => /CRED TED/.test(t.hist)).data === '2026-01-06');
  const pix = e.transacoes.find(t => /DEB PIX/.test(t.hist));
  chk('CPF/CNPJ e Nome/Razão Social extraídos para cd e nm e levados ao histórico (≤ 140 caracteres); CPF mascarado é ignorado', pix.cd === CNPJ_FORN && pix.nm === 'FORNECEDOR EXEMPLO LTDA' && pix.hist.includes('FORNECEDOR EXEMPLO LTDA') && pix.hist.includes(fmtCnpj(CNPJ_FORN)) && pix.hist.length <= 140 && !e.transacoes.find(t => /CRED TED/.test(t.hist)).cd, pix);
  chk('saldo final = o saldo da última linha válida do período (cronológica): -R$ 143.281,75 em 31/01/2026', e.saldo && e.saldo.valor === -143281.75 && e.saldo.data === '2026-01-31' && e.saldo.origem === 'ultima-linha', e.saldo);
  const desc = [...linhasExcel().slice(0, 4), ...linhasExcel().slice(4).reverse()];
  const ed = X.lerExcelLinhas(desc, 'desc.xlsx');
  chk('arquivo em ordem decrescente (mais novo primeiro): o saldo final continua sendo o do dia mais recente', ed.saldo.valor === -143281.75 && ed.saldo.data === '2026-01-31' && ed.transacoes.length === 8);
  chk('"Data Movimento" opcional: com ela, o lançamento de 31/01 com movimento em 30/01 cai em 30/01', X.lerExcelLinhas(linhasExcel(), 'x.xlsx', { dataCol: 'movimento' }).transacoes.find(t => /CHEQUE/.test(t.hist)).data === '2026-01-30' && e.transacoes.find(t => /CHEQUE/.test(t.hist)).data === '2026-01-31');
  const erros = []; for (const rows of [[], [['a', 'b']], [['Data', 'Valor']], [CAB]]) { try { X.lerExcelLinhas(rows, 'x'); erros.push('leu'); } catch (er) { erros.push(er.message.slice(0, 40)); } }
  chk('arquivo que não é o extrato da Caixa (sem cabeçalho / sem lançamentos) é recusado com mensagem clara', erros.every(m => m !== 'leu') && /cabeçalho/.test(erros[0]) && /Nenhum lançamento/.test(erros[3]), erros);
  const ids = e.transacoes.map(t => t.id);
  chk('lançamentos do Excel têm origem marcada (o:x) e id x+documento (sem documento: x+hash do conteúdo)', e.transacoes.every(t => t.o === 'x' && t.id.startsWith('x')) && e.transacoes.find(t => /CHEQUE/.test(t.hist)).id.startsWith('xh') && ids.filter(i => i === 'x324200').length === 3);
}
if (!XLSX) { ['importação .xlsx de ponta a ponta', 'importação .xls (BIFF8)'].forEach(pula); }
else {
  const wbBuf = (linhas, tipo = 'xlsx', aba = 'Extrato') => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), aba); return XLSX.write(wb, { type: 'buffer', bookType: tipo }); };
  for (const [tipo, ext] of [['xlsx', 'xlsx'], ['biff8', 'xls']]) {
    const E = ambiente();
    E.escolhaConta = false;
    await E.FluxoDFC.importarOFX([arquivoDe(`extrato.${ext}`, wbBuf(linhasExcel(), tipo))]);
    chk(`.${ext}: sem escolher a Conta Bancária (campo obrigatório) nada é importado`, totalGravado(E).length === 0);
    E.escolhaConta = true;
    await E.FluxoDFC.importarOFX([arquivoDe(`extrato.${ext}`, wbBuf(linhasExcel(), tipo))]);
    const g = totalGravado(E), jan = E.Repo.get('extratos', 'cx1_2026-01_0');
    chk(`.${ext}: importação de ponta a ponta — 8 lançamentos na conta escolhida, SALDO DIA e zero ignorados, créditos R$ ${(3 * 2000 + 3500.25 + 167.5)}`, g.length === 8 && g.every(t => t.contaId === 'cx1') && soma(credito(g)) === r2(3 * 2000 + 3500.25 + 167.5) && !g.some(t => /SALDO/.test(t.hist)), [g.length, soma(credito(g))]);
    chk(`.${ext}: CPF/CNPJ e Nome/Razão Social gravados, saldo final do extrato (-143.281,75 em 31/01) e formato xlsx no registro do arquivo`, g.find(t => /DEB PIX/.test(t.hist)).cd === CNPJ_FORN && jan.saldo?.valor === -143281.75 && jan.saldo?.data === '2026-01-31' && jan.arquivos[0].formato === 'xlsx', jan.saldo);
    const antes = JSON.stringify([...E.S.extratos.values()].map(d => d.transacoes.map(t => t.id)));
    await E.FluxoDFC.importarOFX([arquivoDe(`extrato.${ext}`, wbBuf(linhasExcel(), tipo))]);
    chk(`.${ext}: reimportar o mesmo arquivo é bloqueado (nenhum lançamento novo)`, JSON.stringify([...E.S.extratos.values()].map(d => d.transacoes.map(t => t.id))) === antes && totalGravado(E).length === 8);
    chk(`.${ext}: os 3 depósitos idênticos de R$ 2.000,00 (mesmo documento 324200, mesmo dia) foram gravados com ids distintos`, g.filter(t => t.valor === 2000).length === 3 && new Set(g.map(t => t.id)).size === 8);
  }
  { // aba chamada "Extrato" não é a primeira; arquivo sem a aba certa
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['capa']]), 'Capa'); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhasExcel()), 'Extrato');
    const E = ambiente(); await E.FluxoDFC.importarOFX([arquivoDe('duas_abas.xlsx', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))]);
    chk('planilha com várias abas: usa a aba com o cabeçalho do extrato (Extrato), mesmo não sendo a primeira', totalGravado(E).length === 8);
    const E2 = ambiente(); await E2.FluxoDFC.importarOFX([arquivoDe('lixo.xlsx', wbBuf([['a', 'b'], [1, 2]]))]);
    chk('planilha que não é o extrato: nada gravado e o usuário é avisado (modal com o motivo)', totalGravado(E2).length === 0 && E2.modais.some(m => /Nenhum extrato importado/.test(m.titulo) && /cabeçalho/.test(m.corpo)));
  }
  { // Excel × OFX do mesmo período
    const pequeno = [
      { d: 2, fitid: '324200', valor: 2000, tipo: 'CREDIT', nome: '', memo: 'CRED DEP DIN', checknum: '324200' }, { d: 2, fitid: '324200', valor: 2000, tipo: 'CREDIT', nome: '', memo: 'CRED DEP DIN', checknum: '324200' },
      { d: 3, fitid: '094300', valor: -157941, tipo: 'DEBIT', nome: 'DEB PIX CHAVE', memo: 'FORN', checknum: '094300' }, { d: 3, fitid: '094300', valor: -8.5, tipo: 'DEBIT', nome: 'TAR PIX', memo: 'TARIFA', checknum: '094300' }];
    const E = ambiente();
    await E.FluxoDFC.importarOFX([arquivoDe('jan.ofx', ofxDe(pequeno, { dtfim: 3, saldo: 1 }))]);
    const antesIds = totalGravado(E).map(t => t.id).sort();
    await E.FluxoDFC.importarOFX([arquivoDe('extrato.xlsx', wbBuf(linhasExcel()))]);
    const g = totalGravado(E), pix = g.find(t => /DEB PIX/.test(t.hist));
    chk('Excel depois do OFX do mesmo período: os 4 lançamentos que o OFX já tinha NÃO são duplicados (documento + data + valor) e os 4 que faltavam entram; total 8', g.length === 8 && antesIds.every(id => g.some(t => t.id === id)), [g.length, antesIds]);
    chk('os lançamentos do OFX são completados com CPF/CNPJ e nome do Excel (sem mudar histórico nem id)', pix.cd === CNPJ_FORN && pix.nm === 'FORNECEDOR EXEMPLO LTDA' && pix.id === '094300' && pix.hist === 'DEB PIX CHAVE · FORN', pix);
    const n0 = g.length; await E.FluxoDFC.importarOFX([arquivoDe('jan.ofx', ofxDe(pequeno, { dtfim: 3, saldo: 1 }))]);
    chk('o OFX reimportado depois do Excel também não duplica (as linhas do Excel cobrem as do OFX)', totalGravado(E).length === n0);
  }
}

/* ---------- 5 · cruzamento com Fornecedores/Clientes e regras de transferência ---------- */
{
  const E = ambiente({ fornecedores: true }), { OFX16: X, PARC_PIX: P, DFC } = E;
  E.parceiros.push({ id: 'par-forn', cnpj: CNPJ_FORN, nome: 'Fornecedor Exemplo Ltda' });
  Object.assign(E.FluxoDFC, { prontoForn05: () => true, leForn05: () => true });
  const e = X.lerExcelLinhas(linhasExcel(), 'x.xlsx'), pixTx = e.transacoes.find(t => /DEB PIX/.test(t.hist));
  chk('o CPF/CNPJ da coluna do Excel está no texto do cruzamento e o motor PIX o reconhece como CNPJ (mesmo fora do histórico)', P.extrairChaves(pixTx._txt).some(c => c.tipo === 'cnpj' && c.chave === CNPJ_FORN));
  const plano = X.planejar(e.transacoes, [], { origem: 'xls' });
  const cruzadas = E.FluxoDFC.cruzar05(plano.novas, plano.textos);
  chk('na importação, o lançamento do Excel é vinculado ao fornecedor pelo CNPJ (par = cadastro)', cruzadas.find(t => /DEB PIX/.test(t.hist))?.par === 'par-forn' && cruzadas.filter(t => t.par).length === 1, cruzadas.filter(t => t.par).map(t => t.hist));
  const transf = plano.novas.find(t => /TRANSF ENTRE CONTAS/.test(t.hist)), semNome = plano.novas.find(t => /CHEQUE/.test(t.hist));
  chk('regra de transferência entre contas próprias: o nome do Excel no histórico faz a regra “ESPOSENDE CALCADOS” classificar a transferência como neutra', DFC.classificar(transf, DFC.regras()).categoria === 'transf' && DFC.classificar(semNome, DFC.regras()).categoria !== 'transf', DFC.classificar(transf, DFC.regras()));
  // enriquecimento de um lançamento já gravado pelo OFX refaz o cruzamento
  const E2 = ambiente({ fornecedores: true }); E2.parceiros.push({ id: 'par-forn', cnpj: CNPJ_FORN, nome: 'Fornecedor Exemplo Ltda' }); Object.assign(E2.FluxoDFC, { prontoForn05: () => true, leForn05: () => true });
  await E2.FluxoDFC.importarOFX([arquivoDe('jan.ofx', ofxDe([{ d: 3, fitid: '094300', valor: -157941, tipo: 'DEBIT', nome: 'DEB PIX CHAVE', memo: 'PAGAMENTO', checknum: '094300' }], { dtfim: 3 }))]);
  chk('(OFX antigo sem CNPJ no texto) o lançamento ainda não tem fornecedor', !totalGravado(E2)[0].par);
  const plano2 = X.planejar(e.transacoes, totalGravado(E2).map(t => ({ ...t, docId: 'cx1_2026-01_0' })), { origem: 'xls' });
  await E2.FluxoDFC.aplicarEnriquecimento16(plano2.enriquecer);
  chk('depois do Excel completar o lançamento, o cruzamento é refeito e o fornecedor aparece', totalGravado(E2).find(t => t.id === '094300')?.par === 'par-forn' && totalGravado(E2).find(t => t.id === '094300').cd === CNPJ_FORN);
}

/* ---------- 6 · limpar/reimportar, partição por tamanho, recurso desligado ---------- */
{
  const E = ambiente(); await E.FluxoDFC.importarOFX([arquivoDe('caixa_jan.ofx', OFX_JAN)]);
  const docs0 = E.Repo.todos('extratos').length;
  const outro = { ...E.S.contasBancarias.get('cx1'), id: 'cx2', apelido: 'Outra conta', conta: '99999', digito: '1' }; E.S.contasBancarias.set('cx2', outro);
  await E.Repo.salvar('extratos', 'cx2_2026-01_0', { contaId: 'cx2', mes: '2026-01', parte: 0, transacoes: [{ id: 'z1', data: '2026-01-05', valor: 10, hist: 'OUTRA' }] });
  E.baseDFC.length = 0;
  const n = await E.FluxoDFC.limparExtratos16('cx1', '2026-01');
  chk('limpar os extratos da conta no mês: remove todos os lançamentos do mês de uma vez (todas as partes) e recalcula a DFC do mês', n === L.length && !E.Repo.todos('extratos').some(d => d.contaId === 'cx1') && E.baseDFC.includes('2026-01'), [n, E.Repo.todos('extratos').map(d => d.id)]);
  chk('a limpeza não toca em outra conta nem em outros meses', E.Repo.get('extratos', 'cx2_2026-01_0')?.transacoes?.length === 1);
  await E.FluxoDFC.importarOFX([arquivoDe('caixa_jan.ofx', OFX_JAN)]);
  chk('reimportar depois de limpar traz de volta todos os lançamentos, sem sobras nem duplicatas', totalGravado(E).filter(t => t.contaId === 'cx1').length === L.length && docs0 === E.Repo.todos('extratos').filter(d => d.contaId === 'cx1').length);
  // fluxo do botão: o modal pede a conta (obrigatória), confirma e limpa; "Limpar e reimportar" abre o seletor de arquivos
  E.FluxoDFC.abrirLimpar16(); const mdl = E.modais.at(-1);
  chk('o modal de limpeza lista só contas que têm extrato no mês, com a contagem de lançamentos, e oferece "Limpar o mês" e "Limpar e reimportar…"', /Limpar extratos de 2026-01/.test(mdl.titulo) && mdl.acoes.some(a => a.rotulo === 'Limpar o mês') && mdl.acoes.some(a => /reimportar/.test(a.rotulo)));
  const lim = mdl.acoes.find(a => a.rotulo === 'Limpar o mês'); const r = await lim.acao({}); // UI.lerForm de brincadeira devolve {}: conta não escolhida
  chk('sem escolher a conta, a limpeza não acontece (a janela fica aberta: retorna false)', r === false && totalGravado(E).filter(t => t.contaId === 'cx1').length === L.length);
}
{ // partição por tamanho: 3.000 lançamentos de Excel com histórico longo (nome + CNPJ) → cada documento < 200 KB e ≤ 900 lançamentos
  const E = ambiente(), X = E.OFX16, tx = [];
  for (let i = 0; i < 3000; i++) tx.push({ id: 'x' + (100000 + i), data: '2026-01-' + String(1 + (i % 28)).padStart(2, '0'), valor: 100 + i, tipo: 'CREDIT', hist: 'PIX RECEBIDO ' + 'ÁÉÍÓÚ '.repeat(10) + ' · CLIENTE ' + i + ' · ' + fmtCnpj(CNPJ_FORN), doc: String(i), cd: CNPJ_FORN, nm: 'CLIENTE EXEMPLO ' + i, o: 'x' });
  const partes = X.partes(tx);
  chk('partição por bytes: 3.000 lançamentos viram vários documentos, cada um < 200 KB e ≤ 900 lançamentos, sem perder nem reordenar nenhum', partes.length >= 4 && partes.every(p => X.bytes(JSON.stringify({ transacoes: p })) < 200000 && p.length <= 900) && igual(partes.flat().map(t => t.id), tx.map(t => t.id)), partes.map(p => p.length));
  await E.FluxoDFC.gravarExtrato16('cx1', '2026-01', tx, {});
  chk('gravar os 3.000 no repositório de teste (que recusa documento > 256 KiB) funciona e relê igual', E.Repo.todos('extratos').flatMap(d => d.transacoes).length === 3000 && E.maiorDoc < 256 * 1024, E.maiorDoc);
  const dup = await E.FluxoDFC.gravarExtrato16('cx1', '2026-01', [{ ...tx[0] }], {});
  chk('segurança da gravação: um id repetido que escapasse do planejamento ganha sufixo em vez de ser descartado', dup === 1 && E.Repo.todos('extratos').flatMap(d => d.transacoes).length === 3001);
}
{ // recurso desligado ≡ v14.15.1: o hook só delega ao importador novo com g16() ligado; botão, accept e rótulo originais no ramo desligado
  chk('gancho: importarOFX delega ao importar16 só com g16() ligado (a leitura e a gravação antigas seguem no ramo desligado)', /\/\/ v14\.05: o cruzamento precisa dos cadastros\n    if \(g16\(\)\) return this\.importar16\(arquivos\);[^\n]*\n    const lidos = \[\];/.test(html));
  chk('botão de importar: rótulo e accept do ramo desligado são os da v14.15.1; ligado aceita .ofx, .xlsx e .xls', html.includes(`\${g16() ? 'Importar Extrato (OFX / Excel)' : 'Importar OFX'}<input type="file" accept="\${g16() ? FluxoDFC.ACEITA16 : '.ofx,.OFX,application/x-ofx'}" multiple hidden data-a="fd-bc-upload">`) && /ACEITA16: '\.ofx,\.OFX,\.xlsx,\.xls,/.test(html));
  chk('botão "Limpar / reimportar extratos do mês…" só aparece com g16() e para quem pode importar; a ação é protegida pelas mesmas permissões', /g16\(\) && podeCls \? '<div class="field"><span class="lbl">&nbsp;<\/span><button class="btn sec" data-a="fd-bc-limpar16"/.test(html) && /case 'fd-bc-limpar16': return g16\(\) && Auth\.can\('fcx\.dfc\.importar'\) \? this\.abrirLimpar16\(\) : undefined;/.test(html));
  chk('o relatório de carga (v13.99) usa a leitura nova e deixa o Excel para o importador novo (que mostra o próprio resumo)', /g16\(\) && OFX16\.temExcel\(arquivos\)/.test(html) && /\(g16\(\) \? OFX16 : OFX\)\.ler\(OFX\.decodificar/.test(html) && /OFX16\.contarDuplicadas\(e\.transacoes/.test(html));
  const A = ambiente({ g16: false }); const resp = await A.FluxoDFC.importarOFX([arquivoDe('pequeno.ofx', ofxDe(L.filter(l => l.d === 8 && l.valor !== 2000 && l.fitid !== '094300').slice(0, 3), { dtfim: 8 }))]);
  chk('recurso desligado: o importador antigo continua funcionando para OFX comum (id = FITID, sem campos novos)', totalGravado(A).length >= 1 && totalGravado(A).every(t => !('fid' in t) && !('o' in t)) && resp === undefined);
}

console.log(`\n${OK.length} verificações ok, ${FAIL.length} falha(s)${PULADOS.length ? `, ${PULADOS.length} pulada(s)` : ''}.`);
if (FAIL.length) { console.log('FALHAS:\n - ' + FAIL.join('\n - ')); process.exit(1); }
