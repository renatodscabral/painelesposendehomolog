/* v14.09 · Extratos OFX (saídas) × Contas a Pagar do FCX (FCX → Saídas) × Conta Contábil × De-para FCX → DFC × Categoria DFC.
   Valida o CÓDIGO REAL do painel (public/index.html: leitor OFX, objeto DFC, motor CP_OFX, PrevistoFCX e os métodos novos de FluxoDFC) num contexto
   isolado do Node, sem navegador e sem banco, com fornecedores, títulos e extratos FICTÍCIOS (LGPD):
   1) favorecido do histórico bancário: prefixos (PIX ENVIADO, PIX TRANSF, TED ENVIADA, DOC, PAGTO, PAGAMENTO, BOLETO, DB AUTOM), acentos, caracteres especiais, datas e documentos;
   2) (a) casamento por nome EXATO ou PREFIXO (mínimo de 12 caracteres: nomes truncados pelo banco) + valor idêntico (tolerância de R$ 0,05) em ±5 dias úteis;
   3) desempate (Pago/Efetivo, depois Previsto mais próximo), consumo de títulos, ambiguidade e lançamentos manuais intocados;
   4) (b) Conta Contábil do título → De-para FCX → DFC (código da conta e ajuste conta a conta, inclusive categoria personalizada) → Categoria DFC;
   5) (c) hierarquia: manual > regra explícita > Contas a Pagar > categoria do cadastro de fornecedores > padrão (e recurso desligado = comportamento anterior);
   6) importação e reprocessamento em lote: consumo entre lotes, prévia (quantos via Contas a Pagar), idempotência, manual intocado, FCX indisponível não desfaz vínculos.
   Uso: node tests/teste-ofx-contas-pagar-dfc-1409.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(raiz, 'public/index.html'), 'utf8');
const OK = [], FAIL = [];
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x !== '' ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 700) : '')); };

/* ---------- extrai o código real ---------- */
const corta = (ini, fim) => { const a = html.indexOf(ini), b = html.indexOf(fim, a); if (a < 0 || b < 0) throw new Error('bloco não encontrado: ' + ini); return html.slice(a, b); };
const csvCod = corta('const CSV = {', '/**\n * WhatsApp (camada Util)');
const ofxCod = corta('const OFX = {', '/* ======================= CONTAS (de-para)');
const dfcCod = corta('const DFC_GRUPOS = {', '/* ============================ IEO ============================ */');
const prevCod = corta('/** Conta contábil do FCX → categoria de saída da DFC, pelo prefixo do código', 'const Cruzamento = {');
const uiCod = corta('/* v14.09 · Extratos OFX × Contas a Pagar do FCX (FCX → Saídas): cruzamento na importação', '/* v14.06 · DFC · Resumo Executivo Oficial');
const motorCod = corta('/* CP_OFX:INI */', '/* CP_OFX:FIM */');
const parcCod = corta('const Parc11 = {', 'const PartesContratuais11 = {'); /* v14.11: fachada do cadastro usada pelo cruzamento (com o recurso desligado = só Fornecedores e Clientes, como na v14.10) */

/** `cfg` = config/dfc simulado; `parc` = cadastros; `lig` = { g09 } (recurso gestao_v1409); `ext` = extratos (docs) */
const montar = (cfg, parc, lig = { g09: true }, ext = [], prontas = new Set(['parceiros', 'extratos']), acesso = { forn: true, importar: true }) => {
  const Repo = { get: (col, id) => col === 'config' && id === 'dfc' ? cfg.doc : col === 'parceiros' ? parc.get(id) || null : null, todos: col => col === 'extratos' ? ext : col === 'parceiros' ? [...parc.values()] : [], prontas };
  const FluxoDFC = { mesLabel: m => m, podeCruzar05: () => acesso.forn, cruzarUma05: t => ({ t: { ...t }, ambigua: false }), atualizarBaseDFC: async () => { } };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const Fmt = { data: d => String(d).split('-').reverse().join('/'), brl: v => 'R$ ' + Number(v).toFixed(2).replace('.', ',') };
  const Auth = { can: k => k === 'fcx.dfc.importar' ? acesso.importar : true };
  const g04 = () => true, g05 = () => true, g09 = () => lig.g09;
  const API = { api: null }, FCX = { api: () => API.api, montar() { } };
  const fn = new Function('Repo', 'g04', 'g05', 'g09', 'FluxoDFC', 'esc', 'Fmt', 'Auth', 'FCX', 'sleep', 'UI', 'g11', 'Acesso',
    parcCod + '\n' + csvCod + '\n' + ofxCod + '\n' + dfcCod + '\n' + prevCod + '\n' + uiCod + '\nreturn { CSV, OFX, DFC, PARC_PIX, CP_OFX, PrevistoFCX, FCX_CONTA_PARA_DFC };');
  const m = fn(Repo, g04, g05, g09, FluxoDFC, esc, Fmt, Auth, FCX, () => Promise.resolve(), { toast: () => { } }, () => false, { loja: () => false });
  return { ...m, FluxoDFC, API, Repo };
};
const cfg = { doc: null }, parc = new Map(), lig = { g09: true };
const M = montar(cfg, parc, lig);
const { DFC, CP_OFX: C, PrevistoFCX: PF, PARC_PIX: X, FluxoDFC: F } = M;

/* ---------- 1 · favorecido do histórico bancário ---------- */
const fav = h => C.favorecido(h);
chk('1.1 PIX ENVIADO: o prefixo sai e o nome truncado do banco fica ("SRC CONSTRUTORA E INCORPO")', fav('PIX ENVIADO SRC CONSTRUTORA E INCORPO') === 'SRC CONSTRUTORA E INCORPO', fav('PIX ENVIADO SRC CONSTRUTORA E INCORPO'));
chk('1.2 PIX TRANSF, TED ENVIADA e DOC saem do começo', fav('PIX TRANSF SECRETARIA MUNICIPAL DE F') === 'SECRETARIA MUNICIPAL DE F' && fav('TED ENVIADA ACME MATERIAIS LTDA') === 'ACME MATERIAIS LTDA' && fav('DOC ACME MATERIAIS LTDA') === 'ACME MATERIAIS LTDA');
chk('1.3 PAGTO, PAGAMENTO, BOLETO e DB AUTOM saem do começo (também em sequência)', fav('PAGTO ACME MATERIAIS LTDA') === 'ACME MATERIAIS LTDA' && fav('PAGAMENTO ACME MATERIAIS LTDA') === 'ACME MATERIAIS LTDA' && fav('BOLETO ACME MATERIAIS LTDA') === 'ACME MATERIAIS LTDA'
  && fav('DB AUTOM ACME MATERIAIS LTDA') === 'ACME MATERIAIS LTDA' && fav('PAGTO BOLETO ACME MATERIAIS LTDA') === 'ACME MATERIAIS LTDA' && fav('PAGAMENTO PIX ENVIADO ACME MATERIAIS LTDA') === 'ACME MATERIAIS LTDA');
chk('1.4 acentos e caracteres especiais saem; letras maiúsculas e minúsculas se igualam', fav('Pix Enviado - Ação Distribuição & Cia. Ltda.') === 'ACAO DISTRIBUICAO CIA LTDA' && fav('PIX_ENVIADO*ACME/MATERIAIS') === 'ACME MATERIAIS', fav('Pix Enviado - Ação Distribuição & Cia. Ltda.'));
chk('1.5 datas (dd/mm), CNPJ/CPF e números longos do histórico não entram no nome', fav('PIX ENVIADO 12/11 ACME MATERIAIS LTDA') === 'ACME MATERIAIS LTDA' && fav('PAGAMENTO 12.345.678/0001-90 ACME MATERIAIS LTDA') === 'ACME MATERIAIS LTDA' && fav('DB AUTOM COMPESA 123456789012') === 'COMPESA', fav('PIX ENVIADO 12/11 ACME MATERIAIS LTDA'));
chk('1.6 só tira prefixo no INÍCIO e só palavra inteira: "PAGSEGURO" e "DOCERIA DOCE" ficam; texto vazio ou só prefixo vira vazio', fav('PAGSEGURO INTERNET') === 'PAGSEGURO INTERNET' && fav('DOCERIA DOCE VIDA') === 'DOCERIA DOCE VIDA' && fav('PIX ENVIADO') === '' && fav('') === '' && fav(null) === '');
chk('1.7 nome do fornecedor do FCX é normalizado do mesmo jeito (sem acento, maiúsculo, sem pontuação)', C.nomeForn('Secretaria Municipal de Finanças') === 'SECRETARIA MUNICIPAL DE FINANCAS' && C.nomeForn('  SRC Construtora e Incorporadora Ltda. ') === 'SRC CONSTRUTORA E INCORPORADORA LTDA');

/* ---------- 2 · compatibilidade de nomes ---------- */
const SRC = 'SRC CONSTRUTORA E INCORPORADORA LTDA', SEC = 'SECRETARIA MUNICIPAL DE FINANCAS';
chk('2.1 nome exato (igual após normalizar) = "exato"', C.compat(SRC, SRC) === 'exato' && C.compat('ACME', 'ACME') === 'exato');
chk('2.2 prefixo com 12+ caracteres (nome truncado pelo banco) = "prefixo": "SRC CONSTRUTORA E INCORPO" e "SECRETARIA MUNICIPAL DE F"', C.compat('SRC CONSTRUTORA E INCORPO', SRC) === 'prefixo' && C.compat('SECRETARIA MUNICIPAL DE F', SEC) === 'prefixo');
chk('2.3 prefixo com menos de 12 caracteres NÃO vale ("SRC CONSTRU" tem 11); com 12 vale', C.compat('SRC CONSTRU', SRC) === null && C.compat('SRC CONSTRUT', SRC) === 'prefixo' && C.MIN_PREFIXO === 12);
chk('2.4 nome do extrato maior que o do cadastro, nome diferente, vazio e curtinho não casam', C.compat(SRC + ' FILIAL', SRC) === null && C.compat('OUTRA CONSTRUTORA E INCORPO', SRC) === null && C.compat('', SRC) === null && C.compat(SRC, '') === null && C.compat('AB', 'AB') === null);

/* ---------- títulos do Contas a Pagar (FCX → Saídas) fictícios ---------- */
const S = (id, date, valor, fornecedor, extra = {}) => ({ id, date, conta: '2.02.01 – Fornecedores de mercadorias', centro: 'ADM', tipo: 'previsto', valor, fornecedor, obs: '', ...extra });
const tx = (id, data, valor, hist, extra = {}) => ({ id, data, valor, hist, ...extra });
const casa = (t, saidas, opts) => C.casarUma(t, C.indice(saidas), opts);

/* ---------- 3 · (a) casamento: nome truncado do PIX + valor exato ---------- */
const saidasA = [
  S('s1', '2026-10-14', 12500.5, SRC, { conta: '2.02.05 – Obras e reformas' }),
  S('s2', '2026-10-15', 3150.99, SEC, { conta: '7.11.03 – ISS a recolher' }),
  S('s3', '2026-10-16', 980, 'ACME MATERIAIS DE ESCRITORIO LTDA', { conta: '4.09.01 – Material de escritório' }),
];
const a1 = casa(tx('t1', '2026-10-14', -12500.5, 'PIX ENVIADO SRC CONSTRUTORA E INCORPO'), saidasA);
chk('3.1 (a) "PIX ENVIADO SRC CONSTRUTORA E INCORPO" + valor exato casa com o título "SRC CONSTRUTORA E INCORPORADORA LTDA" (via prefixo)', a1 && a1.id === 's1' && a1.via === 'prefixo' && a1.conta === '2.02.05 – Obras e reformas' && a1.forn === SRC, a1);
const a2 = casa(tx('t2', '2026-10-15', -3150.99, 'PIX TRANSF SECRETARIA MUNICIPAL DE F'), saidasA);
chk('3.2 (a) "PIX TRANSF SECRETARIA MUNICIPAL DE F" + valor exato casa com "SECRETARIA MUNICIPAL DE FINANCAS"', a2 && a2.id === 's2' && a2.via === 'prefixo' && a2.conta === '7.11.03 – ISS a recolher', a2);
const a3 = casa(tx('t3', '2026-10-16', -980, 'TED ENVIADA ACME MATERIAIS DE ESCRITORIO LTDA'), saidasA);
chk('3.3 nome completo = via "exato"', a3 && a3.id === 's3' && a3.via === 'exato', a3);
chk('3.4 valor diferente não casa (nem por R$ 0,06), e o nome certo com o valor errado também não', casa(tx('t', '2026-10-14', -12500.56, 'PIX ENVIADO SRC CONSTRUTORA E INCORPO'), saidasA) === null && casa(tx('t', '2026-10-14', -12400, 'PIX ENVIADO SRC CONSTRUTORA E INCORPO'), saidasA) === null);
chk('3.5 tolerância de até R$ 0,05 (arredondamento): R$ 0,05 de diferença casa, para mais ou para menos', !!casa(tx('t', '2026-10-14', -12500.55, 'PIX ENVIADO SRC CONSTRUTORA E INCORPO'), saidasA) && !!casa(tx('t', '2026-10-14', -12500.45, 'PIX ENVIADO SRC CONSTRUTORA E INCORPO'), saidasA) && !!casa(tx('t', '2026-10-14', -12500.51, 'PIX ENVIADO SRC CONSTRUTORA E INCORPO'), saidasA));
chk('3.6 vale também o valor líquido do título (v13.78: valorLiquido), e título sem valor ou sem fornecedor é ignorado', casa(tx('t', '2026-10-14', -900, 'PIX ENVIADO ACME MATERIAIS DE ESCRITORIO LTDA'), [S('x', '2026-10-14', 1000, 'ACME MATERIAIS DE ESCRITORIO LTDA', { valorLiquido: 900 })])?.id === 'x'
  && casa(tx('t', '2026-10-14', -50, 'PIX ENVIADO ACME MATERIAIS DE ESCRITORIO LTDA'), [S('x', '2026-10-14', 50, ''), S('y', '2026-10-14', 50, '(sem fornecedor)'), S('z', '2026-10-14', 0, 'ACME MATERIAIS DE ESCRITORIO LTDA')]) === null);
chk('3.7 nome truncado com menos de 12 caracteres não casa: "PIX ENVIADO SRC CONSTRU" + valor igual → sem vínculo', casa(tx('t', '2026-10-14', -12500.5, 'PIX ENVIADO SRC CONSTRU'), saidasA) === null);
chk('3.8 entrada (valor positivo) não cruza com o Contas a Pagar', casa(tx('t', '2026-10-14', 12500.5, 'PIX RECEBIDO SRC CONSTRUTORA E INCORPO'), saidasA) === null);

/* janela de ±5 dias úteis (2026-10-14 é quarta-feira) */
const um = [S('j', '2026-10-14', 100, 'ACME MATERIAIS DE ESCRITORIO LTDA')];
const J = d => casa(tx('t', d, -100, 'PIX ENVIADO ACME MATERIAIS DE ESCRITORIO LTDA'), um)?.id === 'j';
chk('3.9 janela: mesmo dia, +5 e -5 dias úteis casam (qua 14/10 → qua 21/10 e qua 07/10)', J('2026-10-14') && J('2026-10-21') && J('2026-10-07'));
chk('3.10 janela: 6 dias úteis (qui 22/10 e ter 06/10) já estão fora', !J('2026-10-22') && !J('2026-10-06'));
chk('3.11 a janela conta dias ÚTEIS: o fim de semana não pesa (sex 09/10, sáb 10/10 e dom 11/10 estão todos a 3 dias úteis de qua 14/10; de sex 16/10 a seg 19/10 é 1)', J('2026-10-09') && J('2026-10-10') && J('2026-10-11') && C.diasUteis('2026-10-09', '2026-10-14') === 3 && C.diasUteis('2026-10-10', '2026-10-14') === 3 && C.diasUteis('2026-10-11', '2026-10-14') === 3 && C.diasUteis('2026-10-16', '2026-10-19') === 1);
chk('3.12 a janela atravessa a virada do mês (título de 30/10 pago em 05/11)', casa(tx('t', '2026-11-05', -100, 'PIX ENVIADO ACME MATERIAIS DE ESCRITORIO LTDA'), [S('v', '2026-10-30', 100, 'ACME MATERIAIS DE ESCRITORIO LTDA')])?.id === 'v');
chk('3.13 dias úteis aceita a função de feriado do chamador (um feriado no meio encurta a distância)', C.diasUteis('2026-10-09', '2026-10-14', d => ![0, 6].includes(d.getUTCDay()) && d.getUTCDate() !== 12) === 2);
chk('3.14 datas muito distantes e datas inválidas dão distância infinita', C.diasUteis('2026-01-01', '2026-10-14') === Infinity && C.diasUteis('', '2026-10-14') === Infinity);

/* desempate */
const emp = (tipo, id, date, extra = {}) => S(id, date, 777, SRC, { tipo, ...extra });
const E = (saidas, data = '2026-10-14') => casa(tx('t', data, -777, 'PIX ENVIADO SRC CONSTRUTORA E INCORPO'), saidas)?.id;
chk('3.15 desempate: Pago ou Efetivo vence o Previsto, mesmo que o Previsto esteja na própria data', E([emp('previsto', 'p', '2026-10-14'), emp('pago', 'g', '2026-10-16')]) === 'g' && E([emp('previsto', 'p', '2026-10-14'), emp('efetivo', 'e', '2026-10-15')]) === 'e');
chk('3.16 desempate: entre Previstos vence o mais próximo da data do extrato; entre Pagos também', E([emp('previsto', 'p1', '2026-10-12'), emp('previsto', 'p2', '2026-10-15'), emp('previsto', 'p3', '2026-10-09')]) === 'p2' && E([emp('pago', 'g1', '2026-10-09'), emp('pago', 'g2', '2026-10-13')]) === 'g2');
chk('3.17 desempate total (mesmo status e mesma data) é determinístico, qualquer que seja a ordem das saídas', E([emp('pago', 'b', '2026-10-14'), emp('pago', 'a', '2026-10-14')]) === 'a' && E([emp('pago', 'a', '2026-10-14'), emp('pago', 'b', '2026-10-14')]) === 'a');
chk('3.18 nome exato vence o prefixo; dois fornecedores diferentes casando só por prefixo = ambíguo (não vincula)', casa(tx('t', '2026-10-14', -50, 'PIX ENVIADO SRC CONSTRUTORA E INCORPORADORA'), [S('x', '2026-10-14', 50, 'SRC CONSTRUTORA E INCORPORADORA'), S('y', '2026-10-14', 50, SRC)])?.id === 'x'
  && casa(tx('t', '2026-10-14', -50, 'PIX ENVIADO SRC CONSTRUTORA E INCORPO'), [S('x', '2026-10-14', 50, 'SRC CONSTRUTORA E INCORPORADORA'), S('y', '2026-10-14', 50, 'SRC CONSTRUTORA E INCORPO SUL LTDA')])?.ambigua === true);

/* consumo de títulos e ordem do lote */
const dois = [S('d1', '2026-10-14', 777, SRC, { tipo: 'pago', conta: '4.10.01 – Aluguel' }), S('d2', '2026-10-14', 777, SRC, { tipo: 'previsto', conta: '2.02.01 – Fornecedores' })];
const lote = [tx('x3', '2026-10-16', -777, 'PIX ENVIADO SRC CONSTRUTORA E INCORPO'), tx('x1', '2026-10-14', -777, 'PIX ENVIADO SRC CONSTRUTORA E INCORPO'), tx('x2', '2026-10-15', -777, 'PIX ENVIADO SRC CONSTRUTORA E INCORPO')];
const r3 = C.casarLote(lote, C.indice(dois));
chk('3.19 cada título casa com UMA saída: em ordem cronológica a 1ª pega o Pago, a 2ª o Previsto e a 3ª fica sem vínculo (a ordem da lista não importa)', r3[1]?.id === 'd1' && r3[2]?.id === 'd2' && r3[0] === null, r3);
chk('3.20 títulos já usados em outros extratos (usadas) não são reaproveitados; usadasDe lê os vínculos gravados', C.casarUma(lote[1], C.indice(dois), { usadas: new Set(['d1']) })?.id === 'd2' && C.usadasDe([{ cp: { id: 'd1' } }, { cp: { id: 7 } }, {}, null]).size === 2 && C.usadasDe([{ cp: { id: 7 } }]).has('7'));

/* manual nunca é tocado; aplicar grava/remove o vínculo */
const man = tx('m', '2026-10-14', -12500.5, 'PIX ENVIADO SRC CONSTRUTORA E INCORPO', { cat: 'pag_marketing' });
chk('3.21 lançamento com classificação manual não entra no cruzamento e aplicar() não mexe nele (nem apaga um vínculo gravado)', C.casarUma(man, C.indice(saidasA)) === null && C.aplicar(man, a1).cp === undefined && C.aplicar({ ...man, cp: { id: 'z', conta: 'c' } }, null).cp.id === 'z' && C.aplicar(man, a1).cat === 'pag_marketing');
const comCp = C.aplicar(tx('t1', '2026-10-14', -12500.5, 'PIX ENVIADO SRC CONSTRUTORA E INCORPO'), a1);
chk('3.22 aplicar() grava o vínculo (id do título, conta contábil, fornecedor, status, vencimento, via) e remove quando não há mais correspondência', comCp.cp && comCp.cp.id === 's1' && comCp.cp.conta === '2.02.05 – Obras e reformas' && comCp.cp.forn === SRC && comCp.cp.tipo === 'previsto' && comCp.cp.data === '2026-10-14' && comCp.cp.via === 'prefixo' && C.aplicar(comCp, null).cp === undefined && C.aplicar(comCp, { ambigua: true }).cp === undefined);
chk('3.23 rótulo e detalhe: "Contas a Pagar · Conta [código – nome]" e o texto da dica', C.rotulo(comCp.cp) === 'Contas a Pagar · Conta 2.02.05 – Obras e reformas' && /SRC CONSTRUTORA E INCORPORADORA LTDA · vencimento 14\/10\/2026 · status Previsto · fornecedor reconhecido por prefixo/.test(C.detalhe(comCp.cp)) && C.rotulo({}) === 'Contas a Pagar · Conta (sem conta contábil)');

/* ---------- 4 · (b) Conta Contábil → De-para FCX → DFC → Categoria DFC ---------- */
cfg.doc = null;
const catDe = conta => DFC.classificar(tx('c', '2026-10-14', -10, 'PIX ENVIADO X', { cp: { id: 's', conta } }), []).categoria;
chk('4.1 (b) o código da conta contábil define a categoria (De-para padrão): 2.02 → fornecedores; 4.10.01 → ocupação; 4.10.08 → utilidades; 4.33 → marketing; 7.11 → impostos; 7.20 → obras', catDe('2.02.01 – Fornecedores') === 'pag_fornecedores' && catDe('4.10.01 – Aluguel') === 'pag_ocupacao' && catDe('4.10.08 – Energia elétrica') === 'pag_utilidades'
  && catDe('4.33.02 – Publicidade') === 'pag_marketing' && catDe('7.11.03 – ISS') === 'pag_impostos' && catDe('7.20.01 – Obras') === 'inv_capex', [catDe('2.02.01 – Fornecedores'), catDe('4.10.01 – Aluguel'), catDe('4.33.02 – Publicidade')]);
chk('4.2 conta fora do De-para padrão cai em "Outras saídas operacionais"', catDe('9.99.99 – Conta sem regra') === 'pag_outros' && catDe('') === 'pag_outros');
const cl = DFC.classificar(comCp, []);
chk('4.3 a transação classificada traz origem "contas_pagar", a conta contábil e o título', cl.origem === 'contas_pagar' && cl.conta === '2.02.05 – Obras e reformas' && cl.titulo === 's1' && cl.categoria === 'pag_fornecedores', cl);
cfg.doc = { mapaFCX: { '2.02.05 – Obras e reformas': 'inv_capex' } };
chk('4.4 o ajuste do De-para (conta a conta) vale na hora, para os lançamentos já vinculados: 2.02.05 passa a "Obras, equipamentos e imobilizado"', DFC.classificar(comCp, []).categoria === 'inv_capex' && DFC.classificar(comCp, []).origem === 'contas_pagar' && PF.categoriaDaConta('2.02.05 – Obras e reformas') === 'inv_capex');
cfg.doc = { categorias: [{ id: 'c-obras-leves', nome: 'Reformas leves', sentido: 'S', grupo: 'OPERACIONAL' }], mapaFCX: { '2.02.05 – Obras e reformas': 'c-obras-leves' } };
chk('4.5 categoria PERSONALIZADA de saída escolhida no De-para também é usada', DFC.classificar(comCp, []).categoria === 'c-obras-leves' && DFC.cat('c-obras-leves')?.nome === 'Reformas leves');
cfg.doc = { mapaFCX: { '2.02.05 – Obras e reformas': 'cat-que-nao-existe-mais' } };
chk('4.6 categoria do De-para que não existe mais volta ao padrão do código da conta', DFC.classificar(comCp, []).categoria === 'pag_fornecedores');
cfg.doc = null;
chk('4.7 o motor usa a função do De-para do painel (PrevistoFCX.categoriaDaConta) e aceita a conta de qualquer formato "código – nome"', /PrevistoFCX\.categoriaDaConta\(conta\)/.test(html) && PF.categoriaPadrao('4.10.01 – Aluguel') === 'pag_ocupacao' && PF.categoriaPadrao('4.10.01') === 'pag_ocupacao');

/* ---------- 5 · (c) hierarquia de prioridades ---------- */
const REGRAS = [{ id: 'r-src', termos: ['SRC CONSTRUTORA'], sentido: 'S', categoria: 'pag_marketing' }];
const base = () => tx('h', '2026-10-14', -12500.5, 'PIX ENVIADO SRC CONSTRUTORA E INCORPO', { cp: { id: 's1', conta: '4.10.01 – Aluguel' } });
const forn1 = { id: 'par1', categoriaDfc: 'pag_administrativas' }, ctxP = { parceiro: id => (id === 'par1' ? forn1 : null) };
const o = (t, r = []) => DFC.classificar(t, r, ctxP);
chk('5.1 (c) 1º classificação MANUAL vence tudo: regra, Contas a Pagar e fornecedor', (() => { const c = o({ ...base(), cat: 'pag_tarifas', par: 'par1' }, REGRAS); return c.categoria === 'pag_tarifas' && c.origem === 'manual'; })());
chk('5.2 2º regra EXPLÍCITA vence o Contas a Pagar e o fornecedor', (() => { const c = o({ ...base(), par: 'par1' }, REGRAS); return c.categoria === 'pag_marketing' && c.origem === 'regra'; })());
chk('5.3 3º Contas a Pagar vence a categoria do cadastro de fornecedores (sem regra que case)', (() => { const c = o({ ...base(), par: 'par1' }); return c.categoria === 'pag_ocupacao' && c.origem === 'contas_pagar'; })());
chk('5.4 4º sem título do Contas a Pagar, vale a categoria padrão do fornecedor', (() => { const t = { ...base(), par: 'par1' }; delete t.cp; const c = o(t); return c.categoria === 'pag_administrativas' && c.origem === 'fornecedor'; })());
chk('5.5 5º fallback: fornecedor sem categoria padrão = "Pagamento a fornecedores"; sem nada = "Outras saídas operacionais"', (() => { const t = { ...base(), par: 'par2' }; delete t.cp; const c1 = DFC.classificar(t, [], { parceiro: id => (id === 'par2' ? { id: 'par2' } : null) }), t2 = base(); delete t2.cp; const c2 = DFC.classificar(t2, []); return c1.categoria === 'pag_fornecedores' && c1.origem === 'fornecedor_padrao' && c2.categoria === 'pag_outros' && c2.origem === 'padrão'; })());
chk('5.6 só vale em SAÍDAS: vínculo gravado numa entrada é ignorado', DFC.classificar({ ...base(), valor: 100 }, [], ctxP).origem === 'padrão' || DFC.classificar({ ...base(), valor: 100 }, [], ctxP).categoria === 'rec_outros');
lig.g09 = false;
chk('5.7 recurso desligado (gestao_v1409): o vínculo é ignorado e a cadeia volta à da v14.05', (() => { const c = o({ ...base(), par: 'par1' }); return c.categoria === 'pag_administrativas' && c.origem === 'fornecedor'; })() && DFC.classificar(base(), []).origem === 'padrão');
lig.g09 = true;
chk('5.8 a categoria vinda do Contas a Pagar entra na consolidação da DFC (valor na linha certa, sem cair em "sem regra")', (() => {
  const c = DFC.consolidar([{ ...base(), contaId: 'k', valor: -300 }, tx('o', '2026-10-15', -50, 'TARIFA QUALQUER', { contaId: 'k' })], []);
  return c.porCategoria.pag_ocupacao?.valor === -300 && c.semRegra === 1 && c.saidas === 350;
})());

/* ---------- 6 · importação e reprocessamento em lote ---------- */
const FORN = 'ACME MATERIAIS DE ESCRITORIO LTDA';
const titulos = [S('a1', '2026-10-05', 1000, FORN, { conta: '4.09.01 – Material de escritório', tipo: 'pago' }), S('a2', '2026-10-20', 1000, FORN, { conta: '4.10.01 – Aluguel', tipo: 'previsto' }), S('b1', '2026-10-12', 450.25, SEC, { conta: '7.11.03 – ISS' })];
const cpCtx = () => ({ idx: C.indice(titulos), n: titulos.length, usadas: new Set() });
const novas1 = [tx('i1', '2026-10-05', -1000, 'PIX ENVIADO ACME MATERIAIS DE ESCRITORIO'), tx('i2', '2026-10-12', -450.25, 'TED ENVIADA SECRETARIA MUNICIPAL DE F'), tx('i3', '2026-10-13', 5000, 'PIX RECEBIDO CLIENTE')];
const cp1 = cpCtx(), lt1 = F.cruzarCP09(novas1, cp1);
chk('6.1 importação: as saídas novas ganham o vínculo (i1 → a1, i2 → b1) e a entrada fica de fora', lt1[0].cp?.id === 'a1' && lt1[1].cp?.id === 'b1' && lt1[2].cp === undefined && lt1.length === 3, lt1.map(t => t.cp?.id));
const lt2 = F.cruzarCP09([tx('j1', '2026-10-19', -1000, 'PIX ENVIADO ACME MATERIAIS DE ESCRITORIO'), tx('j2', '2026-10-07', -1000, 'PIX ENVIADO ACME MATERIAIS DE ESCRITORIO')], cp1);
chk('6.2 importação em dois arquivos: o título já consumido no 1º não é reaproveitado no 2º (j1 em 19/10 → a2; j2 em 07/10 só alcançaria o a1, já usado → sem título)', lt2[0].cp?.id === 'a2' && lt2[1].cp === undefined, lt2.map(t => t.cp?.id));
chk('6.3 sem o FCX disponível (cp nulo) ou com o recurso desligado, a lista volta exatamente como veio', F.cruzarCP09(novas1, null) === novas1 && (() => { lig.g09 = false; const r = F.cruzarCP09(novas1, cpCtx()); lig.g09 = true; return r === novas1; })());
chk('6.4 textos da importação: contagem de saídas com título do Contas a Pagar', /<b>2<\/b> saídas com título do Contas a Pagar identificado/.test(F.txtCP09(lt1)) && F.txtCP09([tx('z', 'd', -1, 'x')]) === '' && /2 saídas cruzadas com o Contas a Pagar/.test(F.sufCP09([{ novas: lt1 }])) && /não está disponível agora/.test(F.avisoCP09(null)) && F.avisoCP09(cpCtx()) === '');

/* reprocessamento: extratos já gravados */
const mkDoc = (id, mes, trans) => ({ id, contaId: 'k1', mes, parte: 0, transacoes: trans });
const gravados = () => [mkDoc('k1_2026-10_0', '2026-10', [
  tx('r1', '2026-10-05', -1000, 'PIX ENVIADO ACME MATERIAIS DE ESCRITORIO'), tx('r2', '2026-10-12', -450.25, 'TED ENVIADA SECRETARIA MUNICIPAL DE F'), tx('r3', '2026-10-13', 5000, 'PIX RECEBIDO CLIENTE'),
  tx('r4', '2026-10-14', -1000, 'PIX ENVIADO ACME MATERIAIS DE ESCRITORIO', { cat: 'pag_tarifas' }), tx('r5', '2026-10-20', -1000, 'PIX ENVIADO ACME MATERIAIS DE ESCRITORIO')]),
  mkDoc('k1_2026-09_0', '2026-09', [tx('o1', '2026-09-30', -1000, 'PIX ENVIADO ACME MATERIAIS DE ESCRITORIO', { cp: { id: 'a1', conta: '4.09.01 – Material de escritório', forn: FORN, tipo: 'pago', data: '2026-10-05', via: 'prefixo' } })])];
const parc2 = new Map(), extA = gravados(), cfg2 = { doc: null };
const M2 = montar(cfg2, parc2, { g09: true }, extA);
const F2 = M2.FluxoDFC; M2.API.api = { saidas: () => titulos };
const cpA = { idx: M2.CP_OFX.indice(titulos), n: titulos.length, usadas: new Set() };
const pl = F2.planoCruzar09('2026-10', cpA);
const por = new Map(pl.docs.flatMap(d => d.novas.map(t => [t.id, t])));
chk('6.5 reprocessar o mês: vínculos novos (r2 → b1, r5 → a2); o título a1 já pertence a um lançamento de OUTRO mês, então r1 não o reaproveita', por.get('r2')?.cp?.id === 'b1' && por.get('r5')?.cp?.id === 'a2' && !por.get('r1')?.cp, [...por].map(([k, t]) => [k, t.cp?.id]));
chk('6.6 o lançamento manual (r4) não é tocado (sem vínculo, categoria intacta) e a entrada (r3) também não; só o extrato de outubro é regravado', por.get('r4').cp === undefined && por.get('r4').cat === 'pag_tarifas' && por.get('r3').cp === undefined && pl.docs.length === 1 && pl.docs[0].doc.mes === '2026-10' && pl.meses.size === 1 && pl.nAlt === 2);
chk('6.7 a prévia conta: lidos 5, casados com Contas a Pagar 2, novos 2, classificados via Contas a Pagar 2 e mudam de categoria 2', pl.total === 5 && pl.cpTotal === 2 && pl.cpNovos === 2 && pl.cpViaCP === 2 && pl.mudaCategoria === 2 && pl.nAlt === 2 && pl.cpOk && pl.cpTitulos === 3, { total: pl.total, cpTotal: pl.cpTotal, cpNovos: pl.cpNovos, cpViaCP: pl.cpViaCP, muda: pl.mudaCategoria, nAlt: pl.nAlt });
chk('6.8 as categorias resultantes vêm da conta contábil: r2 (ISS, 7.11) → Impostos e r5 (Aluguel, 4.10.01) → Ocupação', DFC.classificar(por.get('r2'), []).categoria === 'pag_impostos' && DFC.classificar(por.get('r5'), []).categoria === 'pag_ocupacao');
// grava o resultado e reprocessa de novo: idempotente
const extB = gravados(); pl.docs.forEach(x => { const i = extB.findIndex(d => d.id === x.doc.id); extB[i] = { ...extB[i], transacoes: x.novas }; });
const M3 = montar(cfg2, parc2, { g09: true }, extB), F3 = M3.FluxoDFC;
const cpB = { idx: M3.CP_OFX.indice(titulos), n: titulos.length, usadas: new Set() };
const pl2 = F3.planoCruzar09('2026-10', cpB);
chk('6.9 reprocessar de novo é idempotente: nada a atualizar e os mesmos vínculos', pl2.docs.length === 0 && pl2.nAlt === 0 && pl2.cpNovos === 0 && pl2.cpTrocados === 0 && pl2.cpRemovidos === 0 && pl2.cpTotal === 2 && pl2.cpViaCP === 2);
const pl3 = F3.planoCruzar09(null, cpB);
chk('6.10 todos os meses: o resultado é o mesmo (o vínculo de setembro com a1 continua dele e o cruzamento não o rouba)', pl3.docs.length === 0 && pl3.total === 6 && pl3.cpTotal === 3 && extB.flatMap(d => d.transacoes).find(t => t.id === 'o1').cp.id === 'a1');
// título removido/editado no FCX
const titulos2 = titulos.filter(t => t.id !== 'a2').map(t => t.id === 'b1' ? { ...t, conta: '7.11.09 – Outros tributos' } : t);
const pl4 = F3.planoCruzar09('2026-10', { idx: M3.CP_OFX.indice(titulos2), n: titulos2.length, usadas: new Set() });
const por4 = new Map(pl4.docs.flatMap(d => d.novas.map(t => [t.id, t])));
chk('6.11 título excluído do FCX desfaz o vínculo (r5) e título com a conta contábil editada atualiza o vínculo (r2); a prévia conta as duas coisas', !por4.get('r5')?.cp && por4.get('r2')?.cp?.conta === '7.11.09 – Outros tributos' && pl4.cpRemovidos === 1 && pl4.cpAtualizados === 1 && pl4.nAlt === 2);
const pl5 = F3.planoCruzar09('2026-10', null);
chk('6.12 FCX indisponível (cp nulo): nada é desfeito — os vínculos gravados ficam como estão, e a prévia avisa', pl5.docs.length === 0 && pl5.cpOk === false && pl5.cpTotal === 2 && /não está disponível agora/.test(F3.htmlCruzar09(pl5)));
// regra e manual prevalecem, mas o vínculo é registrado
const cfg6 = { doc: { regras: [{ id: 'r-acme', termos: ['SECRETARIA MUNICIPAL'], sentido: 'S', categoria: 'pag_administrativas' }] } };
const M6 = montar(cfg6, new Map(), { g09: true }, gravados()), F6 = M6.FluxoDFC;
const pl6 = F6.planoCruzar09('2026-10', { idx: M6.CP_OFX.indice(titulos), n: 3, usadas: new Set() });
chk('6.13 regra explícita prevalece sobre o título: o vínculo é gravado (r2) mas a categoria segue a regra, e a prévia mostra "casadas, mas a regra prevalece"', pl6.cpRegra === 1 && pl6.cpViaCP === 1 && DFC.classificar(pl6.docs[0].novas.find(t => t.id === 'r2'), cfg6.doc.regras).categoria === 'pag_administrativas');
// html da prévia
const h = F3.htmlCruzar09(pl);
chk('6.14 a prévia mostra a contagem "classificadas via Contas a Pagar / Conta Contábil" e o rótulo do botão/tela usa "Cruzar Fornecedores, PIX e Contas a Pagar"', /<b[^>]*>2<\/b><span>classificadas via Contas a Pagar \/ Conta Contábil<\/span>/.test(h) && /Contas a Pagar<\/span><span class="cp-conta">7\.11\.03 – ISS/.test(h) && F3.rotCruzar09() === 'Cruzar Fornecedores, PIX e Contas a Pagar' && /Cruzar Fornecedores, PIX e Contas a Pagar/.test(html));
chk('6.15 permissões: sem importar extratos o botão some; sem acesso ao cadastro de fornecedores ainda cruza com o Contas a Pagar (e mantém os vínculos de fornecedores)', (() => {
  const ac = { forn: false, importar: false }, Mx = montar({ doc: null }, new Map(), { g09: true }, gravados(), new Set(['extratos']), ac);
  const a = Mx.FluxoDFC.podeBotao09(); ac.importar = true; const b = Mx.FluxoDFC.podeBotao09(); Mx.API.api = { saidas: () => titulos };
  const p = Mx.FluxoDFC.planoCruzar09('2026-10', { idx: Mx.CP_OFX.indice(titulos), n: 3, usadas: new Set() });
  return a === false && b === true && p.podeForn === false && p.cpNovos === 2;
})());
chk('6.16 recurso desligado: o botão volta ao rótulo e à regra da v14.05', (() => { lig.g09 = false; const ok = M.FluxoDFC.rotCruzar09() === 'Cruzar Fornecedores / Reprocessar PIX'; lig.g09 = true; return ok; })());

/* ---------- 7 · tabela do extrato: linhas do Contas a Pagar ---------- */
const clsCP = DFC.classificar(comCp, []);
chk('7.1 na tabela a origem mostra "Contas a Pagar · Conta [código – nome]" e o fornecedor do FCX com o status', /Contas a Pagar/.test(F.linhaCP09({ ...comCp, cls: clsCP })) && /SRC CONSTRUTORA E INCORPORADORA LTDA/.test(F.linhaCP09({ ...comCp, cls: clsCP })) && /Previsto/.test(F.linhaCP09({ ...comCp, cls: clsCP })));
chk('7.2 se a regra ou a classificação manual prevalece, a linha diz que o vínculo ficou em segundo plano', /a classificação manual prevalece/.test(F.linhaCP09({ ...comCp, cls: { origem: 'manual' } })) && /a regra de classificação prevalece/.test(F.linhaCP09({ ...comCp, cls: { origem: 'regra' } })) && F.linhaCP09({ id: 'z', cls: { origem: 'padrão' } }) === '');
chk('7.3 origemRot05 (tabela) trata a origem nova e o texto da conta é escapado', /c\.origem === 'contas_pagar'/.test(html) && /CP_OFX\.contaRot\(c\.conta\)/.test(html));

/* ---------- 8 · neutralidade (white-label) e escopo do código ---------- */
chk('8.1 o motor CP_OFX é neutro: nenhum nome de empresa escrito (white-label)', !/esposende|falco|resilienza|mar aberto/i.test(motorCod));
chk('8.2 o recurso gestao_v1409 está registrado (v14.09) e g09() depende de gestao_v1405', /gestao_v1409: \{ versao: 'v14\.09'/.test(html) && /function g09\(\) \{ return g05\(\) && typeof Recursos !== 'undefined' && Recursos\.ativo\('gestao_v1409'\); \}/.test(html));
chk('8.3 a importação e o reprocessamento chamam o cruzamento (cruzarCP09 / abrirCruzar09 / planoCruzar09) e o De-para recalcula a base da DFC', /cruzarCP09\(this\.cruzar05\(/.test(html) && /case 'fd-cruzar': return g09\(\) \? this\.abrirCruzar09\(\)/.test(html) && /UI\.toast\('De-para salvo'\);\n\s+if \(g09\(\)\) \{ await this\.atualizarBaseDFC\(this\.mesesBanco\(\)\)/.test(html));

console.log(`\n${FAIL.length ? 'FALHAS (' + FAIL.length + '):\n - ' + FAIL.join('\n - ') : 'OK (' + OK.length + ' verificações)'}`);
process.exit(FAIL.length ? 1 : 0);
