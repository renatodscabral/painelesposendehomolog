/* v14.11 · Lote 1 de melhorias. Valida o CÓDIGO REAL do painel (public/index.html) e do servidor (netlify/lib) num contexto isolado do Node,
   sem navegador e sem banco, só com dados FICTÍCIOS (LGPD; CNPJ/CPF de exemplo gerados aqui pelos dígitos verificadores):
   1) recurso gestao_v1411 e Regra de Ouro (fcx.html, contabilidade.html e contabilidade_v1391.html idênticos aos da v14.08);
   2) Tela Inicial: o agrupador de pagamentos e o menu com rolagem só existem acima de 768 px (CSS) e o celular (<= 768 px) segue com o desenho de antes;
   3) Reajuste IPCA/IGP-M/INPC: janela de 12 meses, acumulado (produto dos fatores), API do Banco Central (séries 433/189/188) com cache e fallback manual,
      "Recalcular" regravando valor_atual + histórico + próxima data-base, sem reajustar o mesmo ciclo duas vezes;
   4) Locatários/Locadores × Extratos OFX × DFC: CPF/CNPJ, chave PIX, razão social, nome fantasia e prefixo truncado (>= 12 caracteres) → Aluguel/ocupação; precedência
      sobre Fornecedores; ambiguidade não vincula; recurso desligado = comportamento da v14.10;
   5) Importação de Fornecedores e Clientes: parser de 25.000 linhas em fatias (a tela respira), idêntico ao síncrono; lotes de 2.000 (e de ~4,5 MB); gravação em massa
      com nova tentativa, divisão em 413, parada em perda de acesso e UM resumo na Auditoria; limite 30.000 só com o banco do Netlify e o recurso ligado;
   6) servidor: POST /api/docs/massa (limites, coleção permitida, perfil Loja, permissão do Master/Operacional, regras de partes_contratuais).
   (A varredura de segredos do pacote é feita na entrega, fora deste arquivo: nenhum segredo é escrito aqui, nem como padrão de busca.)
   Fluxos de tela (modal Recalcular, agrupador, importação com arquivo) são conferidos no navegador, fora deste teste rápido.
   Uso: node tests/teste-lote1-1411.mjs (roda em segundos) */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(process.env.PAINEL_HTML || path.join(raiz, 'public/index.html'), 'utf8');
const OK = [], FAIL = [];
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x !== '' ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 700) : '')); };
const md5 = t => createHash('md5').update(t).digest('hex');
const corta = (ini, fim) => { const a = html.indexOf(ini), b = html.indexOf(fim, a); if (a < 0 || b < 0) throw new Error('bloco não encontrado: ' + ini); return html.slice(a, b); };
const dobra = async f => { try { await f(); return null; } catch (e) { return e; } };

/* ---------- 1 · recurso e Regra de Ouro ---------- */
chk('recurso gestao_v1411 na lista de liberação (v14.11) e helper g11()', /gestao_v1411: \{ versao: 'v14\.11'/.test(html) && /function g11\(\) \{ return typeof Recursos !== 'undefined' && Recursos\.ativo\('gestao_v1411'\); \}/.test(html));
for (const [f, h] of [['fcx.html', '0c13655f'], ['contabilidade.html', 'a41642fb'], ['contabilidade_v1391.html', 'ea73d20b']]) {
  const p = path.join(raiz, 'public', f);
  chk(`Regra de Ouro: public/${f} idêntico ao da v14.08 (md5 ${h}…)`, fs.existsSync(p) && md5(fs.readFileSync(p)).startsWith(h));
}

/* ---------- 2 · Tela Inicial e menu lateral ---------- */
{
  const css = corta('/* v14.11 · menu lateral com rolagem própria', '/* v14.11 · lista de Fornecedores e Clientes paginada');
  const semMedia = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '').trim();
  const medias = [...css.matchAll(/@media\s*([^{]*)\{/g)].map(m => m[1].replace(/\s+/g, ' ').trim());
  const cssLista = corta('/* v14.11 · lista de Fornecedores e Clientes paginada', html.includes('/* v14.12 · Solicitação de Férias') ? '/* v14.12 · Solicitação de Férias' : '/* ===== v13.19 · Início: resumo diário ===== */').replace(/\/\*[\s\S]*?\*\//g, '');
  chk('CSS da lista paginada de Fornecedores: só seletores .par-pag (elementos que só existem com a v14.11 ligada na tela de Fornecedores e Clientes; nada da Tela Inicial nem do menu)', [...cssLista.matchAll(/([^{}]+)\{/g)].every(m => m[1].split(',').every(x => /^\s*\.par-pag(-bt)?(\s+\.hint)?\s*$/.test(x))), cssLista);
  chk('CSS do Lote 1: nenhuma regra solta — tudo está dentro de @media (a partir de 769 px) e o único bloco de celular só esconde o que o agrupador cria', semMedia === '' && medias.filter(m => /max-width:768px/.test(m) && !/min-width/.test(m)).length === 1 && medias.every(m => /min-width:(769|901)px/.test(m) || m === '(max-width:768px)'), { semMedia: semMedia.slice(0, 200), medias });
  chk('celular: o único bloco (max-width:768px) apenas esconde o cabeçalho/botão do agrupador e mostra todas as linhas (não toca em nenhuma regra existente da Tela Inicial)', css.includes('@media (max-width:768px){.aprv-acc-cab,.aprv-acc-mais{display:none !important;} .aprv-lin[data-acc]{display:list-item !important;}}'));
  chk('menu lateral: a lista de módulos rola sozinha (overflow-y:auto, barra fina e discreta), o topo e o usuário não rolam', /\.mainnav\.nav-rol \.nav-lista\{[^}]*overflow-y:auto[^}]*scrollbar-width:thin/.test(css) && /::-webkit-scrollbar\{width:5px;\}/.test(css) && /\.mainnav\.nav-rol \.nav-user\{flex:none;\}/.test(css) && /\.mainnav\.nav-rol\{display:flex;flex-direction:column;overflow:hidden/.test(css));
  chk('menu lateral: a classe nav-rol e a memória da posição da rolagem só existem com g11() (desligado, o menu é o da v14.10)', /\$\{g11\(\) \? ' nav-rol' : ''\}/.test(html) && /const sy = g11\(\) \? NavRol\.posicao\(\) : 0/.test(html));
}
{
  const cod = corta('  VISIVEIS11: 3, ac11', '  /** abre/fecha sem refazer a tela');
  const mk = (on, mobile) => new Function('g11', 'ResumoRecebivel', 'Fmt', `return { R: v => Math.round((Number(v) || 0) * 100) / 100, ${cod} };`)(() => on, { mobile: () => mobile }, { brl: v => 'R$ ' + v.toFixed(2) });
  const venc = ['2026-11-20', '2026-11-12', '2026-11-18', '2026-11-12', '2026-11-30', '2026-11-14', '2026-11-16'], tit = venc.map((v, i) => ({ id: 't' + i, vencimento: v, valor: 100 + i }));
  const lin = (x, oc) => `<li data-id="${x.id}"${oc ? ' data-acc hidden' : ''}></li>`, legado = lista => `<ul class="aprv-lista" data-aprv-lista>${lista.map(x => lin(x)).join('')}</ul>`;
  const d = mk(true, false), h = d.ul11({ titulos: tit }, lin), ocultos = [...h.matchAll(/data-id="(t\d)"[^>]* hidden/g)].map(m => m[1]), ordem = [...h.matchAll(/data-id="(t\d)"/g)].map(m => m[1]);
  chk('agrupador (notebook/iPad): cabeçalho com a quantidade (7) e o valor total, e botão "Ver todos os 7 pagamentos ▾"', /<b>7<\/b> lançamentos · total <b>R\$ 721\.00<\/b>/.test(h) && /Ver todos os 7 pagamentos ▾/.test(h) && /aria-expanded="false"/.test(h) && /data-a="ini-rec-ver"/.test(h), h.slice(0, 400));
  chk('agrupador: ficam à vista só os 3 mais próximos do vencimento (12/11, 12/11, 14/11); os outros 4 saem ocultos mas continuam na lista (Selecionar todos e totais valem para todos)', ordem.join() === 't1,t3,t5,t6,t2,t0,t4' && ocultos.join() === 't6,t2,t0,t4' && (h.match(/<li /g) || []).length === 7, { ordem, ocultos });
  d.ac11.aberto = true; const ab = d.ul11({ titulos: tit }, lin);
  chk('expandido: nenhum item oculto, botão "Recolher ▴"', !/ hidden/.test(ab.replace(/aria-expanded/g, '')) && /Recolher ▴/.test(ab) && /aria-expanded="true"/.test(ab));
  const tres = mk(true, false).ul11({ titulos: tit.slice(0, 3) }, lin);
  chk('com 3 pagamentos ou menos não há botão e nada fica oculto (só o resumo no cabeçalho)', /<b>3<\/b> lançamentos/.test(tres) && !/ini-rec-ver/.test(tres) && !/ hidden/.test(tres) && /<b>1<\/b> lançamento ·/.test(mk(true, false).ul11({ titulos: tit.slice(0, 1) }, lin)));
  chk('celular (<= 768 px): a lista é EXATAMENTE a de antes (mesma ordem, sem cabeçalho, sem botão, sem itens ocultos)', mk(true, true).ul11({ titulos: tit }, lin) === legado(tit));
  chk('recurso desligado (ou lista vazia): a lista é exatamente a de antes', mk(false, false).ul11({ titulos: tit }, lin) === legado(tit) && mk(true, false).ul11({ titulos: [] }, lin) === legado([]));
}

/* ---------- 3 · reajuste IPCA / IGP-M / INPC (motor + API do Banco Central) ---------- */
const reajCod = corta('const REAJ = {', '/* BCB_API:FIM */');
const { REAJ, IndicesBCB } = new Function(reajCod + '\nreturn { REAJ, IndicesBCB };')();
const exp12 = pcts => Math.round((pcts.reduce((a, p) => a + Math.log1p(p / 100), 0) && (Math.exp(pcts.reduce((a, p) => a + Math.log1p(p / 100), 0)) - 1) * 100 + Number.EPSILON) * 100) / 100; // outra fórmula (soma de logaritmos) para conferir o produto dos fatores
const IPCA = [0.56, 0.43, 0.26, 0.24, -0.11, 0.44, 0.48, 0.09, 0.40, 0.51, 0.33, 0.70];   // mar/2025 … fev/2026 (valores de exemplo)
const IGPM = [0.64, -0.34, 0.15, 0.25, -0.77, 0.36, 0.42, 0.27, 0.01, 0.30, -0.18, 0.52];
const INPC = [0.51, 0.48, 0.35, 0.21, -0.14, 0.46, 0.52, 0.10, 0.39, 0.55, 0.30, 0.66];
chk('janela: data-base 01/03/2026 → os 12 meses que terminam no mês anterior (mar/2025 … fev/2026)', JSON.stringify(REAJ.janela('2026-03-01')) === JSON.stringify(['2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02']));
chk('janela atravessa o ano (data-base 15/01/2027 → jan/2026 … dez/2026)', REAJ.janela('2027-01-15')[0] === '2026-01' && REAJ.janela('2027-01-15')[11] === '2026-12');
chk('séries do Banco Central: IPCA 433, IGP-M 189, INPC 188 (nomes com variações: IGP-M/FGV, igpm, ipca)', REAJ.serie('IPCA') === 433 && REAJ.serie('IGP-M') === 189 && REAJ.serie('INPC') === 188 && REAJ.serie('IGP-M/FGV') === 189 && REAJ.serie('igpm') === 189 && REAJ.serie('ipca') === 433 && REAJ.serie('IVAR') === null && REAJ.serie('% Manual') === null);
const mapaDe = (lista, base = '2025-03') => new Map(lista.map((v, i) => [REAJ.somaMes(base, i), v]));
const calc = (indice, lista, valor = 10000, extra = {}) => REAJ.calcular({ indice, valor, dataBase: '2026-03-01', mensal: mapaDe(lista), ...extra });
for (const [nome, lista] of [['IPCA', IPCA], ['IGP-M', IGPM], ['INPC', INPC]]) {
  const r = calc(nome, lista), esp = exp12(lista), novo = Math.round(10000 * (1 + esp / 100) * 100) / 100;
  chk(`${nome}: acumulado de 12 meses = produto dos fatores (${esp.toFixed(2)}%) e Novo Valor = R$ ${novo.toFixed(2)}`, r.ok && r.pct === esp && r.valorNovo === novo && r.delta === Math.round((novo - 10000) * 100) / 100 && r.fonte === 'BCB' && r.meses.length === 12, r);
}
{
  const r = calc('IPCA', IPCA); // conferência “à mão”: 1,0056·1,0043·…
  let f = 1; for (const p of IPCA) f *= 1 + p / 100;
  chk('o acumulado NÃO é a soma simples dos meses (soma ≠ produto)', Math.abs(IPCA.reduce((a, b) => a + b, 0) - r.pct) > 0.001 && r.pct === Math.round((f - 1) * 10000) / 100);
}
chk('índice negativo no acumulado: piso de 0% (padrão da tela) mantém o valor; sem o piso, reduz', (() => { const neg = [-0.2, -0.1, -0.3, 0.05, -0.2, -0.1, 0.1, -0.4, -0.2, -0.1, -0.15, -0.05]; const a = calc('IGP-M', neg, 5000, { piso0: true }), b = calc('IGP-M', neg, 5000, { piso0: false }); return a.ok && a.negativo && a.pctAplicado === 0 && a.valorNovo === 5000 && a.pisoAplicado && b.ok && b.pctAplicado === b.pct && b.valorNovo < 5000; })());
chk('mês ainda não divulgado: não inventa número — pede o percentual manual (motivo faltam-meses, com os meses que faltam)', (() => { const m = mapaDe(IPCA); m.delete('2026-02'); const r = REAJ.calcular({ indice: 'IPCA', valor: 1000, dataBase: '2026-03-01', mensal: m }); return !r.ok && r.motivo === 'faltam-meses' && JSON.stringify(r.faltam) === '["2026-02"]'; })());
chk('fallback manual: com o percentual digitado (vírgula ou ponto) o cálculo fecha sem a API; % Manual e índice sem série também', (() => {
  const a = REAJ.calcular({ indice: 'IPCA', valor: 2000, dataBase: '2026-03-01', manualPct: '4,5' }), b = REAJ.calcular({ indice: '% Manual', valor: 2000, dataBase: '2026-03-01', manualPct: 3 }), c = REAJ.calcular({ indice: 'IVAR', valor: 2000, dataBase: '2026-03-01' }), d = REAJ.calcular({ indice: 'IPCA', valor: 2000, dataBase: '2026-03-01', manualPct: 'abc' });
  return a.ok && a.fonte === 'manual' && a.valorNovo === 2090 && b.ok && b.valorNovo === 2060 && !c.ok && c.motivo === 'sem-serie' && !d.ok && d.motivo === 'manual-invalido';
})());
chk('entradas inválidas: valor zero/negativo e data-base inválida são recusados; percentual absurdo (> 300%) também', REAJ.calcular({ indice: 'IPCA', valor: 0, dataBase: '2026-03-01' }).motivo === 'valor' && REAJ.calcular({ indice: 'IPCA', valor: 100, dataBase: '2026-13-45' }).motivo === 'data-base' && REAJ.calcular({ indice: 'IPCA', valor: 100, dataBase: '2026-03-01', manualPct: 900 }).motivo === 'fora-da-faixa');
chk('quais contratos o botão Recalcular atende: locação/outro ativo, com valor e índice (≠ Fixo, ≠ sem índice)', REAJ.elegivel({ tipo: 'locacao', status: 'Ativo', valor_atual: 100, indice_reajuste: 'IPCA' }) && REAJ.elegivel({ tipo: 'outro', valor_atual: 100, indice_reajuste: 'IGP-M' }) && REAJ.elegivel({ valor_atual: 100, indice_reajuste: '% Manual' })
  && !REAJ.elegivel({ tipo: 'locacao', valor_atual: 100, indice_reajuste: 'Fixo (sem índice)' }) && !REAJ.elegivel({ tipo: 'locacao', valor_atual: 100, indice_reajuste: '' }) && !REAJ.elegivel({ tipo: 'locacao', valor_atual: 0, indice_reajuste: 'IPCA' }) && !REAJ.elegivel({ tipo: 'locacao', status: 'Inativo', valor_atual: 9, indice_reajuste: 'IPCA' }) && !REAJ.elegivel({ tipo: 'seguro', valor_atual: 9, indice_reajuste: 'IPCA' }));
chk('data-base efetiva: a gravada; senão +1 ano do último reajuste; senão o aniversário do início', REAJ.dataBase({ data_base_reajuste: '2026-03-01' }, '2026-06-01') === '2026-03-01' && REAJ.dataBase({ historico_reajustes: [{ base: '2025-03-01' }] }, '2026-06-01') === '2026-03-01' && REAJ.dataBase({ data_inicio: '2024-03-10' }, '2026-06-01') === '2026-03-10' && REAJ.addAnos('2024-02-29', 1) === '2025-02-28');

/* API do Banco Central com servidor falso (nenhuma chamada de rede) */
const linhasBCB = (lista, base = '2025-03', virgula = false) => lista.map((v, i) => { const ym = REAJ.somaMes(base, i); return { data: '01/' + ym.slice(5) + '/' + ym.slice(0, 4), valor: virgula ? String(v).replace('.', ',') : String(v) }; });
const bcbFalso = (porSerie, regs = []) => async (url) => { regs.push(url); const s = /sgs\.(\d+)\//.exec(url)?.[1], v = porSerie[s]; if (v instanceof Error) throw v; if (typeof v === 'number') return { ok: false, status: v, json: async () => ({}) }; return { ok: true, status: 200, json: async () => v }; };
{
  const regs = []; IndicesBCB.limpar(); IndicesBCB.fetcher = bcbFalso({ 433: linhasBCB(IPCA), 189: linhasBCB(IGPM, '2025-03', true), 188: linhasBCB(INPC) }, regs);
  const j = REAJ.janela('2026-03-01'), [r433, r189, r188] = await Promise.all([IndicesBCB.buscar(433, j[0], j[11]), IndicesBCB.buscar(189, j[0], j[11]), IndicesBCB.buscar(188, j[0], j[11])]);
  chk('API BCB: URL oficial SGS (JSON, dataInicial 01/03/2025 e dataFinal 28/02/2026), uma por série (433, 189, 188), sem chave', regs.length === 3 && regs.includes('https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados?formato=json&dataInicial=01/03/2025&dataFinal=28/02/2026') && regs.some(u => u.includes('sgs.189/')) && regs.some(u => u.includes('sgs.188/')) && regs.every(u => !/key|token|senha/i.test(u)), regs);
  chk('API BCB: valores com vírgula decimal e datas dd/mm/aaaa viram o mapa AAAA-MM → %, e o cálculo fecha com eles', r433.ok && r189.ok && r188.ok && r189.mapa.get('2025-04') === -0.34 && calc('IGP-M', IGPM).pct === REAJ.calcular({ indice: 'IGP-M', valor: 10000, dataBase: '2026-03-01', mensal: r189.mapa }).pct && REAJ.calcular({ indice: 'IPCA', valor: 10000, dataBase: '2026-03-01', mensal: r433.mapa }).pct === exp12(IPCA));
  await IndicesBCB.buscar(433, j[0], j[11]);
  chk('API BCB: a 2ª consulta da mesma janela sai do cache (nenhuma requisição nova)', regs.length === 3);
  const falhas = [['HTTP 503', { 433: 503 }], ['sem conexão', { 433: new Error('Failed to fetch') }], ['JSON inesperado', { 433: { erro: 'x' } }]];
  for (const [rot, srv] of falhas) { IndicesBCB.limpar(); IndicesBCB.fetcher = bcbFalso(srv); const r = await IndicesBCB.buscar(433, j[0], j[11]); chk(`API BCB indisponível (${rot}): devolve ok:false com o erro (a tela cai no % manual), sem lançar exceção`, r.ok === false && typeof r.erro === 'string' && r.erro.length > 0, r); }
  IndicesBCB.limpar(); IndicesBCB.fetcher = async (url, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('abort'), { name: 'AbortError' })))); IndicesBCB.TIMEOUT = 20;
  const t = await IndicesBCB.buscar(433, j[0], j[11]); chk('API BCB lenta demais: tempo esgotado vira ok:false (fallback manual), não trava a tela', t.ok === false && /tempo/.test(t.erro), t); IndicesBCB.TIMEOUT = 9000;
}

/* "Recalcular": o mesmo caminho da tela (consulta → cálculo → ContratosLocacao.salvar(REAJ.aplicar)) com um repositório falso */
{
  const store = new Map(), audit = [];
  const salvar = (id, doc, det) => { store.set(id, { id, ...doc }); audit.push(det); };
  const recalcular = async (id, { manual = null, piso0 = true, hoje = '2026-03-15', forcar = false } = {}) => {
    const c = store.get(id), db = REAJ.dataBase(c, hoje), serie = REAJ.serie(c.indice_reajuste), j = REAJ.janela(db);
    let mensal = null, api = null; if (serie && !String(manual || '').trim()) { const res = await IndicesBCB.buscar(serie, j[0], j[11]); if (res.ok) mensal = res.mapa; else api = res.erro; }
    const r = REAJ.calcular({ indice: c.indice_reajuste, valor: c.valor_atual, dataBase: db, mensal, manualPct: manual, piso0 });
    if (!r.ok) return { r, api };
    const ja = REAJ.jaAplicado(c, db); if (ja && !forcar) return { r, ja };
    salvar(id, REAJ.aplicar(c, r, { por: 'u-teste' }), `Reajuste ${r.canon} ${r.pctAplicado}%`);
    return { r };
  };
  const base = { tipo: 'locacao', status: 'Ativo', indice_reajuste: 'IPCA', valor_atual: 10000, data_inicio: '2024-03-01', data_base_reajuste: '2026-03-01', historico_reajustes: [] };
  store.set('c1', { id: 'c1', ...base }); store.set('c2', { id: 'c2', ...base, indice_reajuste: 'IGP-M', valor_atual: 4321.55 }); store.set('c3', { id: 'c3', ...base, indice_reajuste: 'INPC', valor_atual: 800 });
  IndicesBCB.limpar(); IndicesBCB.fetcher = bcbFalso({ 433: linhasBCB(IPCA), 189: linhasBCB(IGPM), 188: linhasBCB(INPC) });
  const r1 = await recalcular('c1'), c1 = store.get('c1'), novo1 = Math.round(10000 * (1 + exp12(IPCA) / 100) * 100) / 100;
  chk('Recalcular IPCA: valor_atual regravado com o Novo Valor, histórico registrado e próxima data-base +1 ano', r1.r.ok && c1.valor_atual === novo1 && c1.valor_atual !== 10000 && c1.historico_reajustes.length === 1 && c1.data_base_reajuste === '2027-03-01', c1);
  const h = c1.historico_reajustes[0];
  chk('histórico: vigência, índice, % aplicado e acumulado, de → para, fonte BCB, janela, série 433, quem e quando', h.data === '2026-03-01' && h.base === '2026-03-01' && h.indice === 'IPCA' && h.percentual === exp12(IPCA) && h.acumulado === exp12(IPCA) && h.de === 10000 && h.para === novo1 && h.fonte === 'BCB' && h.janela === '2025-03/2026-02' && h.serie === 433 && h.por === 'u-teste' && !!h.em, h);
  const r1b = await recalcular('c1', { hoje: '2026-03-20' });
  chk('o mesmo ciclo não é reajustado duas vezes (a data-base já avançou; e, forçando a data antiga, o histórico acusa o ciclo)', store.get('c1').valor_atual === novo1 && store.get('c1').historico_reajustes.length === 1 || !!r1b.ja);
  store.set('c1', { ...store.get('c1'), data_base_reajuste: '2026-03-01' });
  const r1c = await recalcular('c1'); chk('data-base reaberta manualmente para o ciclo já aplicado: acusa "já reajustado" e não regrava', !!r1c.ja && store.get('c1').valor_atual === novo1 && store.get('c1').historico_reajustes.length === 1);
  await recalcular('c2'); await recalcular('c3');
  chk('IGP-M (série 189) e INPC (série 188): cada contrato recebe o acumulado do próprio índice', store.get('c2').valor_atual === Math.round(4321.55 * (1 + exp12(IGPM) / 100) * 100) / 100 && store.get('c3').valor_atual === Math.round(800 * (1 + exp12(INPC) / 100) * 100) / 100);
  store.set('c4', { id: 'c4', ...base, valor_atual: 1500 }); IndicesBCB.limpar(); IndicesBCB.fetcher = bcbFalso({ 433: 500 });
  const f = await recalcular('c4');
  chk('API fora do ar: nada é regravado e a tela recebe o motivo; com o % manual o reajuste fecha e grava (fonte manual, sem janela/série)', !f.r.ok && f.r.motivo === 'faltam-meses' && !!f.api && store.get('c4').valor_atual === 1500 && (await recalcular('c4', { manual: '3,25' })).r.ok && store.get('c4').valor_atual === 1548.75 && store.get('c4').historico_reajustes[0].fonte === 'manual' && store.get('c4').historico_reajustes[0].janela === '' && audit.length === 4);
  IndicesBCB.fetcher = null;
}

/* ---------- 4 · Locatários / Locadores × Extratos OFX × DFC ---------- */
const parcCod = corta('const Parc11 = {', 'const PartesContratuais11 = {');
const csvCod = corta('const CSV = {', '/**\n * WhatsApp (camada Util)');
const ofxCod = corta('const OFX = {', '/* ======================= CONTAS (de-para)');
const dfcCod = corta('const DFC_GRUPOS = {', '/* ============================ IEO ============================ */');
const dvCnpj = b => { const calc = (d, ps) => { const r = d.reduce((a, x, i) => a + x * ps[i], 0) % 11; return r < 2 ? 0 : 11 - r; }; const d = String(b).split('').map(Number); d.push(calc(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])); d.push(calc(d, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])); return d.join(''); };
const dvCpf = b => { const calc = (d, n) => { const r = d.reduce((a, x, i) => a + x * (n - i), 0) * 10 % 11; return r === 10 ? 0 : r; }; const d = String(b).split('').map(Number); d.push(calc(d, 10)); d.push(calc(d, 11)); return d.join(''); };
const maskCnpj = d => d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5'), maskCpf = d => d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
function mundo({ ligado = true, forn = [], partes = [] } = {}) {
  let ver = 1; const parc = new Map(forn.map(p => [p.id, p])), pcs = new Map(partes.map(p => [p.id, p]));
  const Repo = { prontas: new Set(['parceiros', 'partes_contratuais']), versao: () => ver, get: (col, id) => col === 'parceiros' ? parc.get(id) || null : col === 'partes_contratuais' ? pcs.get(id) || null : null,
    todos: col => col === 'parceiros' ? [...parc.values()] : col === 'partes_contratuais' ? [...pcs.values()] : [] };
  const m = new Function('Repo', 'Auth', 'Acesso', 'g04', 'g05', 'g11', parcCod + '\n' + csvCod + '\n' + ofxCod + '\n' + dfcCod + '\nreturn { Parc11, DFC, PARC_PIX, PARC_IMP, DFC_CATEGORIAS };')(Repo, { can: () => true }, { loja: () => false }, () => true, () => true, () => ligado);
  return { ...m, mexeu: () => { ver++; }, parc, pcs };
}
const CNPJ_L = dvCnpj('445566770001'), CPF_L = dvCpf('529982247'), CPF_T = dvCpf('111444777'), CNPJ_F = dvCnpj('998877660001'), CNPJ_T = dvCnpj('123123120001');
const L1 = { id: 'pc-l1', papel: 'locador', tipo: 'PJ', documento: maskCnpj(CNPJ_L), nome: 'Imobiliaria Horizonte Exemplo Ltda', nomeFantasia: 'Shopping Horizonte Norte', chavesPix: [{ tipo: 'email', chave: 'aluguel@horizonte-exemplo.com.br' }, { tipo: 'telefone', chave: '81988880001' }], ativo: true };
const L2 = { id: 'pc-l2', papel: 'locador', tipo: 'PF', documento: maskCpf(CPF_L), nome: 'Maria das Gracas Exemplo', chavesPix: [], categoriaDfc: 'pag_utilidades', ativo: true };
const T1 = { id: 'pc-t1', papel: 'locatario', tipo: 'PF', documento: maskCpf(CPF_T), nome: 'Joao Inquilino Fficticio', categoriaDfcEntrada: 'rec_outros', chavesPix: [], ativo: true };
const F1 = { id: 'par-f1', tipo: 'PJ', papeis: ['fornecedor'], documento: maskCnpj(CNPJ_F), nome: 'Calcados Exemplo Industria Ltda', categoriaDfc: 'pag_fornecedores', chavesPix: [], ativo: true };
const F_L = { id: 'par-fl', tipo: 'PJ', papeis: ['fornecedor'], documento: maskCnpj(CNPJ_L), nome: 'Imobiliaria Horizonte Exemplo Ltda', categoriaDfc: 'pag_fornecedores', chavesPix: [], ativo: true }; // o locador também é fornecedor (mesmo CNPJ e nome)
const W = mundo({ forn: [F1], partes: [L1, L2, T1] });
const via = (hist, valor = -100, w = W, extra = {}) => { const idx = w.Parc11.indice(), r = w.PARC_PIX.aplicar({ id: 't', hist, valor, ...extra }, idx); const cl = w.DFC.classificar(r.t, [], undefined); return { par: r.t.par, via: r.t.via, vch: r.t.vch, ambigua: r.ambigua, cat: cl.categoria, origem: cl.origem }; };
chk('os documentos de exemplo são válidos para o motor (CNPJ/CPF gerados pelos dígitos verificadores)', W.PARC_PIX.cnpjOk(CNPJ_L) && W.PARC_PIX.cpfOk(CPF_L) && W.PARC_PIX.cpfOk(CPF_T) && W.PARC_PIX.cnpjOk(CNPJ_F));
chk('as partes entram no índice do cruzamento como cadastros virtuais (ids pc-…), junto dos fornecedores', W.Parc11.todos().length === 4 && W.Parc11.get('pc-l1')._parte === true && W.Parc11.get('par-f1')._parte === undefined && W.Parc11.partes().length === 3);
{
  const a = via(`PIX ENVIADO ${maskCnpj(CNPJ_L)} ALUGUEL NOV`), b = via(`TED ENVIADA CNPJ ${CNPJ_L} REF NOV`);
  chk('CNPJ do locador no histórico: vincula e classifica em Aluguel, condomínio e ocupação (origem parte_contratual); em PIX conta como chave, em TED como documento', a.par === 'pc-l1' && a.cat === 'pag_ocupacao' && a.origem === 'parte_contratual' && a.via === 'pix' && b.par === 'pc-l1' && b.via === 'documento' && b.cat === 'pag_ocupacao', [a, b]);
  const c = via(`PIX ENVIADO ${maskCpf(CPF_L)}`), d = via(`TED ${CPF_L} MARIA`);
  chk('CPF do locador (com ou sem máscara) vincula; a categoria é a do cadastro (aqui Energia, água e telecom), não a padrão', c.par === 'pc-l2' && d.par === 'pc-l2' && c.cat === 'pag_utilidades' && c.origem === 'parte_contratual', [c, d]);
}
{
  const a = via('PIX ENVIADO aluguel@horizonte-exemplo.com.br REF 11'), b = via('PIX ENVIADO +55 (81) 98888-0001 JOAO'), c = via('PIX ENVIADO ALUGUEL@HORIZONTE-EXEMPLO.COM.BR');
  chk('chave PIX cadastrada (e-mail em qualquer caixa, telefone com +55 e máscara) vincula ao locador', a.par === 'pc-l1' && a.via === 'pix' && a.vch === 'email' && b.par === 'pc-l1' && b.vch === 'telefone' && c.par === 'pc-l1', [a, b, c]);
}
{
  const a = via('PIX ENVIADO IMOBILIARIA HORIZONTE EXEMPLO LTDA'), b = via('PAGTO SHOPPING HORIZONTE NORTE'), c = via('PIX ENVIADO MARIA DAS GRACAS EXEMPLO');
  chk('razão social, nome fantasia e nome do locador (sem acentos, caixa alta) vinculam pelo nome', a.par === 'pc-l1' && a.via === 'nome' && b.par === 'pc-l1' && c.par === 'pc-l2' && a.cat === 'pag_ocupacao', [a, b, c]);
}
{
  const a = via('PIX ENVIADO IMOBILIARIA HORIZONTE EX'), b = via('PIX ENVIADO IMOBILIARIA HO'), c = via('DB AUTOM SHOPPING HORIZONTE'), d = via('PIX ENVIADO SHOPPING HO'), e = via('PIX ENVIADO IMOBILIARIA'), f = via('PIX ENVIADO IMOBILIARIA HORIZONTE EX PAGTO ABRIL');
  chk('nome truncado pelo banco: prefixo >= 12 caracteres, no fim do histórico, vincula (via nome · prefixo)', a.par === 'pc-l1' && a.vch === 'prefixo' && b.par === 'pc-l1' && c.par === 'pc-l1', [a, b, c]);
  chk('prefixo com menos de 12 caracteres, ou seguido de outro texto, NÃO vincula (evita falso positivo)', !d.par && !e.par && !f.par, [d, e, f]);
}
{
  const ent = via(`PIX RECEBIDO ${maskCpf(CPF_T)} ALUGUEL`, 3500), sai = via(`PIX ENVIADO ${maskCpf(CPF_T)}`, -80);
  chk('entrada do locatário: categoria própria de entrada; saída para a mesma pessoa cai em Aluguel/ocupação (padrão)', ent.par === 'pc-t1' && ent.cat === 'rec_outros' && ent.origem === 'parte_contratual' && sai.par === 'pc-t1' && sai.cat === 'pag_ocupacao', [ent, sai]);
  const sem = mundo({ partes: [{ ...T1, categoriaDfcEntrada: undefined }] });
  chk('locatário sem categoria de entrada: Outras entradas operacionais', via(`PIX RECEBIDO ${maskCpf(CPF_T)}`, 10, sem).cat === 'rec_outros');
  const inv = mundo({ partes: [{ ...L1, categoriaDfc: 'rec_outros' }] });
  chk('categoria do cadastro incompatível com o sentido (entrada usada numa saída) é ignorada: volta a Aluguel/ocupação', via(`PIX ENVIADO ${maskCnpj(CNPJ_L)}`, -50, inv).cat === 'pag_ocupacao');
}
{
  const w = mundo({ forn: [F1, F_L], partes: [L1] });
  const a = via(`PIX ENVIADO ${maskCnpj(CNPJ_L)}`, -100, w), b = via('PIX ENVIADO IMOBILIARIA HORIZONTE EXEMPLO LTDA', -100, w), c = via(`PIX ENVIADO ${maskCnpj(CNPJ_F)}`, -100, w);
  chk('locador que também é fornecedor (mesmo CNPJ e mesmo nome): o cadastro do Módulo 3 prevalece (Aluguel/ocupação), sem ficar ambíguo', a.par === 'pc-l1' && a.cat === 'pag_ocupacao' && !a.ambigua && b.par === 'pc-l1' && !b.ambigua, [a, b]);
  chk('o fornecedor comum continua sendo identificado normalmente (categoria do fornecedor)', c.par === 'par-f1' && c.cat === 'pag_fornecedores' && c.origem === 'fornecedor', c);
  const dois = mundo({ partes: [L1, { ...L1, id: 'pc-l9' }] });
  const amb = via(`PIX ENVIADO ${maskCnpj(CNPJ_L)}`, -1, dois), amb2 = via('PIX ENVIADO IMOBILIARIA HORIZONTE EX', -1, dois);
  chk('dois locadores com a mesma chave ou o mesmo prefixo = ambíguo: nenhum vínculo (cai no padrão)', !amb.par && amb.ambigua && !amb2.par && amb2.ambigua && amb.origem === 'padrão', [amb, amb2]);
}
chk('classificação manual do usuário continua mandando (t.cat), e regra explícita vem antes do cadastro', (() => { const idx = W.Parc11.indice(), t = W.PARC_PIX.aplicar({ id: 't', hist: `PIX ENVIADO ${maskCnpj(CNPJ_L)}`, valor: -9, cat: 'pag_outros' }, idx).t; return W.DFC.classificar(t, []).origem === 'manual' && W.DFC.classificar({ ...t, cat: undefined }, [{ id: 'r1', termos: ['ALUGUEL'], sentido: 'S', categoria: 'pag_ocupacao' }].map(r => ({ ...r, termos: ['PIX ENVIADO'] }))).origem === 'regra'; })());
{
  const off = mundo({ ligado: false, forn: [F1], partes: [L1, L2, T1] }), idx = off.Parc11.indice();
  const r = off.PARC_PIX.aplicar({ id: 't', hist: `PIX ENVIADO ${maskCnpj(CNPJ_L)} ALUGUEL`, valor: -100 }, idx);
  chk('recurso desligado: as partes não entram no cruzamento (comportamento da v14.10: só Fornecedores e Clientes)', off.Parc11.todos().length === 1 && off.Parc11.partes().length === 0 && !r.t.par && off.Parc11.get('pc-l1') === null && off.Parc11.paraVinculos().length === 1);
  const ref = off.PARC_PIX.indice([F1]);
  chk('recurso desligado: o índice é exatamente o PARC_PIX.indice(fornecedores) da v14.10 (mesmas chaves, nomes e conflitos; sem prefixos)', JSON.stringify([...idx.chaves.keys()]) === JSON.stringify([...ref.chaves.keys()]) && idx.prefixos === undefined && JSON.stringify(idx.conflitos) === JSON.stringify(ref.conflitos));
}
{
  const idx = W.Parc11.indice(), antigas = [{ id: 'a', hist: `PIX ENVIADO ${maskCnpj(CNPJ_L)}`, valor: -10, par: 'par-velho', via: 'nome' }, { id: 'b', hist: 'COMPRA CARTAO MERCADO', valor: -5, par: 'par-velho', via: 'nome' }];
  const r = antigas.map(t => W.PARC_PIX.aplicar(t, idx).t);
  chk('reprocessar extratos já importados (Cruzar Fornecedores, PIX e Contas a Pagar): vínculo antigo é trocado pelo do locador; sem correspondência o vínculo some', r[0].par === 'pc-l1' && r[0].via === 'pix' && !r[1].par && !r[1].via);
  chk('vínculos para a exclusão de categorias: as partes entram na lista de cadastros que usam uma categoria', W.Parc11.paraVinculos().some(p => p.id === 'pc-l2' && p.categoriaDfc === 'pag_utilidades') && W.Parc11.paraVinculos().some(p => p.id === 'pc-t1' && p.categoriaDfc === 'rec_outros'));
}

/* ---------- 5 · importação de Fornecedores e Clientes até 30.000 linhas ---------- */
const I = mundo().PARC_IMP, X = mundo().PARC_PIX, CATS = mundo().DFC_CATEGORIAS;
const COLS = ['Tipo', 'CNPJ_CPF', 'Razao_Social', 'Nome_Fantasia', 'Chave_PIX_Email', 'Categoria_DFC_Padrao', 'Cidade', 'UF', 'Situacao'];
const N = 25000, linhas = [];
let validosPJ = 0, validosPF = 0, invalidos = 0, repetidas = 0;
for (let i = 0; i < N; i++) {
  const k = i % 50; let doc, nome = 'Empresa Exemplo ' + i + ' Ltda', tipo = i % 3 === 0 ? 'Cliente' : 'Fornecedor';
  if (k === 7) { const certo = dvCnpj(String(10000000 + i).padStart(8, '0') + '0001'); doc = maskCnpj(certo.slice(0, 13) + String((Number(certo[13]) + 1) % 10)); invalidos++; if (X.cnpjOk(doc)) throw new Error('gerador'); } // CNPJ com dígito errado (a cada 50 linhas)
  else if (k === 11) { doc = maskCnpj(dvCnpj(String(10000000 + i - 11).padStart(8, '0') + '0001')); repetidas++; } // repete o CNPJ da linha i-11 (que é válida e anterior)
  else if (i % 5 === 1) { doc = maskCpf(dvCpf(String(100000000 + i).padStart(9, '0'))); nome = 'Pessoa Exemplo ' + i; validosPF++; }
  else { doc = maskCnpj(dvCnpj(String(10000000 + i).padStart(8, '0') + '0001')); validosPJ++; }
  linhas.push({ Tipo: tipo, CNPJ_CPF: doc, Razao_Social: nome, Nome_Fantasia: i % 7 === 0 ? 'Fantasia ' + i : '', Chave_PIX_Email: i % 10 === 4 ? `pix${i}@exemplo.com.br` : '', Categoria_DFC_Padrao: i % 9 === 0 ? 'Pagamento a fornecedores' : '', Cidade: 'Recife', UF: 'PE', Situacao: '' });
}
// as "repetidas" só valem se o CNPJ de origem (linha i-11) também foi gerado como válido: confere contando no próprio resultado
{
  const t0 = Date.now(); let gens = 0; const g = I._regGen(COLS, linhas, { linhaInicial: 2 }); let x; while (!(x = g.next()).done) gens++;
  chk(`parser de ${N.toLocaleString('pt-BR')} linhas: o gerador cede a tela ${gens} vezes (uma a cada 256 linhas) em vez de rodar tudo de uma vez`, gens >= Math.floor(N / 256) - 1, gens);
  const reg = x.value; chk('validação lê todas as linhas preenchidas e mantém o número da linha da planilha (cabeçalho = linha 1)', reg.registros.length === N && reg.registros[0].linha === 2 && reg.registros[N - 1].linha === N + 1, reg.registros.length);
  console.log(`     (validação síncrona: ${Date.now() - t0} ms)`);
}
let ticks = 0; const relogio = setInterval(() => ticks++, 1);
const prog = []; const t1 = Date.now();
const regA = await I.registrosAsync(COLS, linhas, { linhaInicial: 2 }, i => prog.push(i));
const regS = I.registros(COLS, linhas, { linhaInicial: 2 });
chk('registrosAsync devolve exatamente o mesmo que registros (síncrono) e a tela respirou durante o trabalho (timers rodaram, progresso reportado)', JSON.stringify(regA) === JSON.stringify(regS) && (ticks > 0 || prog.length > 0), { ticks, prog: prog.length });
let seq = 0; const novoId = () => 'par-t' + (++seq).toString(36);
const optsVazio = () => { seq = 0; return { parceiros: [], categorias: CATS, novoId }; };
const prog2 = []; const t2 = Date.now();
const plA = await I.planejarAsync(regA.registros, optsVazio(), (v, t) => prog2.push([v, t]));
const plS = I.planejar(regA.registros, optsVazio());
console.log(`     (validação assíncrona + planejamento assíncrono: ${Date.now() - t1} ms · planejamento: ${Date.now() - t2} ms · ${ticks} batimentos do relógio · ${prog.length + prog2.length} avisos de progresso)`);
clearInterval(relogio);
chk('planejarAsync devolve exatamente o mesmo plano que planejar (mesmos itens, mesma gravação, mesmo resumo)', JSON.stringify(plA) === JSON.stringify(plS));
const r = plA.resumo, unicos = validosPJ + validosPF;
chk(`plano de ${N.toLocaleString('pt-BR')} linhas: ${unicos} cadastros novos, ${invalidos} recusados (CNPJ inválido) e ${repetidas} repetidas mescladas`, r.linhas === N && r.novos === plA.gravar.length && r.novos === unicos && r.invalidos === invalidos && r.repetidas === repetidas && r.atualizar === 0, r);
chk('cada cadastro novo sai pronto para gravar: id único, papéis, CNPJ/CPF formatado, categoria DFC do nome da planilha e chave PIX normalizada', (() => { const ids = new Set(plA.gravar.map(g => g.id)); const comCat = plA.gravar.find(g => g.dados.categoriaDfc), comPix = plA.gravar.find(g => g.dados.chavesPix.length); return ids.size === plA.gravar.length && plA.gravar.every(g => g.novo && !('id' in g.dados) && g.dados.papeis.length && /^\d/.test(g.dados.documento)) && comCat.dados.categoriaDfc === 'pag_fornecedores' && /@/.test(comPix.dados.chavesPix[0].chave) && comPix.dados.chavesPix[0].tipo === 'email'; })());
{
  const existentes = plA.gravar.map(g => ({ id: g.id, ...g.dados })); seq = 0;
  const segunda = await I.planejarAsync(regA.registros, { parceiros: existentes, categorias: CATS, novoId }), nova = segunda.resumo;
  chk('reimportar a mesma planilha é idempotente: nenhum cadastro novo e nada a gravar (o que já foi gravado não duplica)', nova.novos === 0 && nova.atualizar === 0 && segunda.gravar.length === 0 && nova.semAlteracao + nova.repetidas === unicos + repetidas, nova);
  const meio = existentes.slice(0, 12000); seq = 0; const parcial = await I.planejarAsync(regA.registros, { parceiros: meio, categorias: CATS, novoId });
  chk('retomar uma importação interrompida (12.000 já gravados): só o restante é novo, ninguém é duplicado', parcial.resumo.novos === unicos - 12000 && parcial.gravar.every(g => g.novo), parcial.resumo);
}
{
  const cabs = ['CNPJ_CPF', 'Razao_Social', 'Categoria_DFC_Padrao'], cats = [{ id: 'x1', nome: 'Pagamento a Fornecedores' }, { id: 'pag_fornecedores', nome: 'Outro nome' }, { id: 'x3', nome: 'Água e Luz' }];
  const linhasC = ['Pagamento a fornecedores', 'pag_fornecedores', 'AGUA E LUZ', 'inexistente'].map((c, i) => ({ CNPJ_CPF: maskCnpj(dvCnpj(String(20000000 + i).padStart(8, '0') + '0001')), Razao_Social: 'Cat ' + i, Categoria_DFC_Padrao: c }));
  const p = I.planejar(I.registros(cabs, linhasC).registros, { categorias: cats, novoId: (() => { let n = 0; return () => 'c' + ++n; })() });
  chk('categoria da planilha: casa por nome (sem acento/caixa) ou id, a primeira da lista vence e a inexistente vira aviso (índice de categorias = mesma regra de antes)', p.gravar[0].dados.categoriaDfc === 'x1' && p.gravar[1].dados.categoriaDfc === 'pag_fornecedores' && p.gravar[2].dados.categoriaDfc === 'x3' && p.gravar[3].dados.categoriaDfc === '' && p.itens[3].avisos.some(a => /não encontrada/.test(a)));
}
if (process.env.PAINEL_BASE_1410 && fs.existsSync(process.env.PAINEL_BASE_1410)) { /* opcional: paridade byte a byte com a v14.10 (o arquivo-base não faz parte do pacote) */
  const ant = fs.readFileSync(process.env.PAINEL_BASE_1410, 'utf8'), a = ant.indexOf('const PARC_IMP = {'), b = ant.indexOf('/* PARC_IMP:FIM */', a);
  const IA = new Function('PARC_PIX', ant.slice(a, b) + '\nreturn PARC_IMP;')(X); seq = 0; const regOld = IA.registros(COLS, linhas, { linhaInicial: 2 }); const planOld = IA.planejar(regOld.registros, optsVazio());
  chk('paridade com a v14.10: o parser e o planejamento (sem o recurso) produzem EXATAMENTE o mesmo resultado do código anterior em 25.000 linhas', JSON.stringify(regOld) === JSON.stringify(regS) && JSON.stringify(planOld) === JSON.stringify(plS));
}

/* lotes de 2.000 (e de ~4,5 MB) e limites */
const lotesCod = corta('  LIMITE_LINHAS_11:', '  planejar11(');
const P11 = new Function('g11', 'Cloud', `return { LIMITE_LINHAS: 2000, LIMITE_BYTES: 8 * 1024 * 1024, ${lotesCod} };`);
const Pon = P11(() => true, { adapter: { setMassa() { } } });
chk('limites: 30.000 linhas e 30 MB com o recurso ligado e o banco do Netlify; lotes de 2.000 registros', Pon.limiteLinhas() === 30000 && Pon.limiteBytes() === 30 * 1048576 && Pon.LOTE_11 === 2000 && Pon.massa11() && Pon.LIMITE_LINHAS === 2000);
chk('limite continua 2.000 (e 8 MB) sem o recurso, sem setMassa (banco do claude.ai/local) e em ambiente remoto', P11(() => false, { adapter: { setMassa() { } } }).limiteLinhas() === 2000 && P11(() => true, { adapter: {} }).limiteLinhas() === 2000 && P11(() => true, { adapter: null }).limiteLinhas() === 2000 && P11(() => true, { adapter: { setMassa() { }, remoto: 'homolog' } }).limiteLinhas() === 2000 && P11(() => true, { adapter: {} }).limiteBytes() === 8 * 1048576);
{
  const lotes = Pon.fatiar11(plA.gravar), soma = lotes.reduce((a, l) => a + l.length, 0), ids = new Set(lotes.flat().map(x => x.id));
  chk(`${unicos.toLocaleString('pt-BR')} cadastros → ${Math.ceil(unicos / 2000)} lotes de no máximo 2.000, sem perder nem repetir ninguém, na mesma ordem`, lotes.length === Math.ceil(unicos / 2000) && lotes.every(l => l.length <= 2000) && soma === unicos && ids.size === unicos && lotes.flat().every((x, i) => x === plA.gravar[i]), [lotes.length, soma]);
  chk('cada lote cabe numa requisição das Functions (JSON < 4,5 MB) e o último leva o resto', lotes.every(l => Buffer.byteLength(JSON.stringify(l.map(x => ({ id: x.id, dados: x.dados })))) < 4.5e6) && lotes.at(-1).length === unicos % 2000 || lotes.at(-1).length === 2000);
  const gordos = Array.from({ length: 300 }, (_, i) => ({ id: 'g' + i, dados: { nome: 'x', observacoes: 'á'.repeat(20000) + i } })), lg = Pon.fatiar11(gordos);
  chk('cadastros pesados: o lote fecha pelo TAMANHO antes dos 2.000 registros (limite de ~4,5 MB em UTF-8, contando acentos em 2 bytes)', lg.length >= 2 && lg.every(l => Buffer.byteLength(JSON.stringify(l.map(x => x.dados))) < 4.5e6) && lg.flat().length === 300, lg.map(l => l.length));
  chk('lista vazia e um único registro: sem lote fantasma', Pon.fatiar11([]).length === 0 && Pon.fatiar11([plA.gravar[0]]).length === 1);
}

/* gravação em massa (gravarLote11 real, com adaptador, Repo, Audit e tela falsos) */
const gravCod = corta('  async gravarLote11(', '  /** grava o plano em lotes de 4');
function bancada({ falha = null } = {}) {
  const cache = new Map(), st = { chamadas: [], audits: [], toasts: [], alertas: [], barras: [], bump: 0, resets: 0, rendeu: 0, sync: 0 };
  const ad = { async setMassa(col, docs) { st.chamadas.push({ col, n: docs.length, docs }); const f = falha && falha(st.chamadas.length, docs); if (f) throw f; return { gravados: docs.length }; } };
  const Repo = { cols: { parceiros: cache }, get: (c, id) => cache.get(id) || null, norm: (c, d) => d, _bump: () => st.bump++ };
  const Audit = { registrar: async ev => { st.audits.push(ev); } }, Sync = { ocupado() { }, reset: () => st.resets++ };
  const UI = { toast: m => st.toasts.push(m), alerta: async (t, m) => st.alertas.push([t, m]) }, App = { render: () => st.rendeu++ };
  const fab = new Function('ST', 'F', 'Repo', 'Audit', 'Sync', 'UI', 'App', 'Acesso', 'Cloud', 'Auth', 'Datas', 'SyncEco', 'g09', 'g10', 'clone', 'esc', 'sleep',
    `return { COL: 'parceiros', LOTE_11: 2000, LOTE_BYTES_11: 4.5e6, progresso05(t, p) { ST.barras.push([t, p]); }, fatiar11(...a) { return F.fatiar11(...a); }, ${gravCod} };`);
  const obj = fab(st, Pon, Repo, Audit, Sync, UI, App, { checarGravacao() { } }, { adapter: ad }, { id: 'u-teste' }, { hojeISO: () => '2026-11-13' }, { gravou: () => st.sync++ }, () => true, () => true, o => JSON.parse(JSON.stringify(o)), s => String(s), () => Promise.resolve());
  return { obj, st, cache };
}
const fila = n => plA.gravar.slice(0, n), plano = n => ({ gravar: fila(n), resumo: { ...plA.resumo, linhas: n, novos: n, atualizar: 0 } });
{
  const { obj, st, cache } = bancada(), t0 = Date.now(); await obj.gravarLote11({ gravar: plA.gravar, resumo: plA.resumo }, { name: 'forn-25mil.csv' }, { formato: 'CSV (separador “;”)' });
  const tot = st.chamadas.reduce((a, c) => a + c.n, 0), ids = new Set(st.chamadas.flatMap(c => c.docs.map(d => d.id)));
  chk(`gravação de ${unicos.toLocaleString('pt-BR')} cadastros: ${st.chamadas.length} requisições (uma por lote de até 2.000) à coleção parceiros, cada cadastro enviado uma única vez`, st.chamadas.length === Math.ceil(unicos / 2000) && st.chamadas.every(c => c.col === 'parceiros' && c.n <= 2000) && tot === unicos && ids.size === unicos, [st.chamadas.length, tot]);
  const d0 = st.chamadas[0].docs[0];
  chk('carimbos do Repo.salvar em cada registro (criadoEm/Por, atualizadoEm/Por), sem o campo id dentro dos dados; o cache local recebe todos', !!d0.dados.criadoEm && d0.dados.criadoPor === 'u-teste' && d0.dados.atualizadoPor === 'u-teste' && !('id' in d0.dados) && cache.size === unicos && st.bump === st.chamadas.length);
  chk('UM único evento de Auditoria com o resumo consolidado (linhas, novos, atualizados, chaves PIX, recusadas, duplicadas, lotes) — nenhum log por cadastro', st.audits.length === 1 && st.audits[0].acao === 'importou' && st.audits[0].entidade === 'parceiros' && /25\.000 linha\(s\) lida\(s\): 24\.000 novo\(s\), 0 atualizado\(s\), 2\.500 chave\(s\) PIX vinculada\(s\), 500 linha\(s\) recusada\(s\)/.test(st.audits[0].detalhe) && new RegExp(`gravação em ${Math.ceil(unicos / 2000)} lote\\(s\\) de até 2\\.000`).test(st.audits[0].detalhe) && st.audits[0].mudancas.some(m => m.campo === 'lotes' && m.para === String(Math.ceil(unicos / 2000))) && !/NÃO gravado/.test(st.audits[0].detalhe), st.audits[0]);
  const pct = st.barras.map(b => b[1]);
  chk('barra de progresso em tempo real: sobe a cada lote ("lote k de n", cadastros gravados) e termina em 100%', st.barras.length >= Math.ceil(unicos / 2000) && pct.every((p, i) => i === 0 || p >= pct[i - 1]) && new RegExp(`lote 1 de ${Math.ceil(unicos / 2000)}`).test(st.barras.find(b => /lote 1 de/.test(b[0]))[0]) && /24\.000 de 24\.000 · lote 12 de 12/.test(st.barras.at(-2)[0]) && st.barras.at(-1)[1] === 100 && /Cadastros gravados/.test(st.barras.at(-1)[0]), st.barras.slice(-2));
  chk('ao final: indicador "salvando" liberado, consulta imediata aos demais computadores, aviso de conclusão e tela redesenhada', st.resets === 1 && st.sync === 1 && st.rendeu === 1 && st.toasts.length === 1 && /Importação concluída/.test(st.toasts[0]) && st.alertas.length === 0 && !obj._grav11);
  console.log(`     (gravação simulada de ${unicos} cadastros: ${Date.now() - t0} ms)`);
}
{
  const alvo = fila(6000)[2000].id; let cont = 0;
  const { obj, st } = bancada({ falha: (n, docs) => docs[0].id === alvo && ++cont <= 2 ? Object.assign(new Error('Erro 503 no servidor'), { status: 503, code: 'unavailable' }) : null });
  await obj.gravarLote11(plano(6000), { name: 'a.csv' }, { formato: 'CSV' });
  chk('falha transitória (503 duas vezes) no 2º lote: o mesmo lote é reenviado (idempotente) e tudo é gravado sem duplicar', st.chamadas.length === 5 && new Set(st.chamadas.flatMap(c => c.docs.map(d => d.id))).size === 6000 && st.audits.length === 1 && !/NÃO gravado/.test(st.audits[0].detalhe) && st.alertas.length === 0, st.chamadas.map(c => c.n));
}
{
  let primeira = true; const { obj, st, cache } = bancada({ falha: (n, docs) => { if (primeira && docs.length > 1) { primeira = false; return Object.assign(new Error('Requisição grande demais.'), { status: 413, code: 'unavailable' }); } return null; } });
  await obj.gravarLote11(plano(2000), { name: 'b.csv' }, { formato: 'CSV' });
  chk('413 (lote grande demais): o lote é dividido ao meio e as duas metades são gravadas, sem perder nem repetir cadastro', st.chamadas.length === 3 && st.chamadas[1].n === 1000 && st.chamadas[2].n === 1000 && cache.size === 2000 && st.audits.length === 1 && !/NÃO gravado/.test(st.audits[0].detalhe), st.chamadas.map(c => c.n));
}
{
  const { obj, st, cache } = bancada({ falha: n => n === 2 ? Object.assign(new Error('Sem permissão.'), { status: 403, code: 'permission-denied' }) : null });
  await obj.gravarLote11(plano(8000), { name: 'c.csv' }, { formato: 'CSV' });
  chk('perda de acesso (403) no 2º lote: para de enviar, não insiste, informa quantos ficaram de fora e registra isso na Auditoria', st.chamadas.length === 2 && cache.size === 2000 && st.audits.length === 1 && /6\.000 cadastro\(s\) NÃO gravado\(s\)/.test(st.audits[0].detalhe) && st.alertas.length === 1 && /2\.000 de 8\.000/.test(st.alertas[0][1]) && st.audits[0].mudancas.some(m => m.campo === 'naoGravados' && m.para === '6000'), st.audits[0]);
}
{
  const { obj, st, cache } = bancada({ falha: n => n === 2 ? Object.assign(new Error('Identificador de registro inválido.'), { status: 400, code: 'unavailable' }) : null });
  await obj.gravarLote11(plano(6000), { name: 'd.csv' }, { formato: 'CSV' });
  chk('erro permanente (400) num lote: não é repetido; os demais lotes seguem e o relatório mostra o que faltou', st.chamadas.length === 3 && cache.size === 4000 && /2\.000 cadastro\(s\) NÃO gravado\(s\)/.test(st.audits[0].detalhe) && st.alertas.length === 1);
}
{
  const { obj, st } = bancada(); const a = obj.gravarLote11(plano(4000), { name: 'e.csv' }, { formato: 'CSV' }); const b = await obj.gravarLote11(plano(4000), { name: 'e.csv' }, { formato: 'CSV' }); await a;
  chk('duas gravações ao mesmo tempo: a segunda é recusada com aviso (nada é enviado em dobro)', st.chamadas.length === 2 && st.toasts.some(t => /em andamento/.test(t)) && st.audits.length === 1);
}

/* ---------- 5b · lista de Fornecedores e Clientes paginada + ordenação em cache (achado do teste de navegador: 24.000 linhas derrubaram o Chromium) ---------- */
{
  const todosCod = corta("  todos() {\n    const ordenar = () =>", "  stat() { if (!Repo.prontas.has(this.COL)) return '…';"), pagCod = corta('  PAG_11: 200,', '  /* ---------- v14.11 · importação em massa');
  const nomes = n => Array.from({ length: n }, (_, i) => ({ id: 'p' + String(i).padStart(4, '0'), nome: (i % 3 === 0 ? 'Água ' : i % 3 === 1 ? 'Ágata ' : 'Zé ') + String((i * 7919) % n).padStart(4, '0'), ativo: true }));
  const mk = (ligado, docs) => {
    let ver = 1, chamadas = 0; const Repo = { cols: { parceiros: new Map(docs.map(d => [d.id, d])) }, versao: () => ver, todos: () => { chamadas++; return [...Repo.cols.parceiros.values()]; } }, App = { renders: 0, render() { this.renders++; } };
    const P = new Function('g11', 'Repo', 'App', '$', 'requestAnimationFrame', `return { COL: 'parceiros', ui: { q: '', papel: '', tipo: '', situacao: 'ativos' }, ${todosCod} ${pagCod} };`)(() => ligado, Repo, App, () => null, f => f());
    return { P, Repo, App, subir: () => { ver++; }, chamadas: () => chamadas };
  };
  const D450 = nomes(450);
  const off = mk(false, D450), lOff = off.P.todos();
  chk('v14.11 desligada: a lista não é paginada (devolve a mesma lista, sem rodapé) e a ordenação roda a cada uso (como na v14.10)', off.P.pag11(lOff) === lOff && off.P.pager11(lOff) === '' && (off.P.todos(), off.P.todos(), off.chamadas()) === 3);
  const on = mk(true, D450), lista = on.P.todos();
  const pg = () => { const l = on.P.pag11(lista); return { n: l.length, ini: l[0] && l[0].id, fim: l.at(-1) && l.at(-1).id, rod: on.P.pager11(lista) }; };
  const a = pg();
  chk('ligada, 450 cadastros: página 1 tem 200 linhas e o rodapé diz "Mostrando 1–200 de 450 · página 1 de 3", com "Anterior" desabilitado e "Próxima" ativa', a.n === 200 && a.ini === lista[0].id && a.fim === lista[199].id && /1–200<\/b> de <b>450<\/b> · página 1 de 3/.test(a.rod) && /data-d="-1" disabled/.test(a.rod) && !/data-d="1" disabled/.test(a.rod), a);
  on.P.mudarPag11(1); const b = pg(); on.P.mudarPag11(1); const c = pg(); on.P.mudarPag11(1); const d = pg(); on.P.mudarPag11(-9); const e = pg();
  chk('"Próxima" mostra 201–400 e depois 401–450 (50 linhas, "Próxima" desabilitada); passar do fim não ultrapassa a última página; voltar muito volta à primeira', b.ini === lista[200].id && b.n === 200 && c.n === 50 && c.ini === lista[400].id && c.fim === lista[449].id && /data-d="1" disabled/.test(c.rod) && d.ini === c.ini && e.ini === lista[0].id && on.App.renders === 4, { b, c, d, e });
  on.P.mudarPag11(1); on.P.ui.q = 'zé'; const f = pg(); chk('busca ou filtro novo volta para a página 1', f.ini === lista[0].id && /página 1 de/.test(f.rod));
  chk('com 200 cadastros ou menos não há paginação nem rodapé (a lista é a de sempre)', on.P.pag11(lista.slice(0, 200)).length === 200 && on.P.pager11(lista.slice(0, 200)) === '' && on.P.pager11([]) === '');
  const m1 = mk(true, D450); m1.P.todos(); m1.P.todos(); m1.P.todos(); const n1 = m1.chamadas(); m1.subir(); m1.P.todos(); const n2 = m1.chamadas(); m1.Repo.cols.parceiros = new Map(D450.slice(0, 10).map(x => [x.id, x])); const t3 = m1.P.todos();
  chk('ordenação em cache: 3 usos = 1 ordenação; mudou a versão da coleção = reordena; trocou o mapa da coleção = reordena (10 cadastros)', n1 === 1 && n2 === 2 && m1.chamadas() === 3 && t3.length === 10, { n1, n2, n3: m1.chamadas(), t3: t3.length });
  const m2 = mk(true, D450), x1 = m2.P.todos(); x1.length = 0; x1.push({ id: 'lixo' });
  chk('quem usa a lista pode ordenar/alterar o array devolvido sem estragar o cache (cada uso recebe uma cópia)', m2.P.todos().length === 450 && m2.P.todos()[0].id !== 'lixo');
  const ord = (w) => w.P.todos().map(x => x.id).join(',');
  chk('a ordem (pt-BR, com acentos) é exatamente a mesma com e sem o cache', ord(mk(true, D450)) === ord(mk(false, D450)));
}

/* ---------- 6 · servidor: POST /api/docs/massa, regras de partes_contratuais ---------- */
{
  const D = await import(path.join(raiz, 'netlify/lib/documentos.mjs')), P = await import(path.join(raiz, 'netlify/lib/permissoes.mjs')), { NIVEL } = await import(path.join(raiz, 'netlify/lib/regras.mjs'));
  const tudo = () => true, sess = (u, alt = {}) => { const perfil = P.normalizarPerfil(u.perfil); return { uid: 'u1', perfil, nivel: perfil === 'MASTER' ? NIVEL.admin : NIVEL.interact, perms: P.permissoesEfetivas(u, tudo), trocaPendente: false, ...alt }; };
  const master = sess({ perfil: 'MASTER' }), semPerm = sess({ perfil: 'OPERACIONAL', permissoes: { pessoal: 'modificar' } }), loja = sess({ perfil: 'LOJA', permissoes: {} });
  const docs = n => Array.from({ length: n }, (_, i) => ({ id: 'par-' + i, dados: { nome: 'X' + i } }));
  const rej = async (s, col, d) => { const e = await dobra(() => D.gravarMassa(s, col, d)); return e ? e.status + ' ' + e.message : 'aceitou'; };
  chk('massa: limite de 2.000 registros por requisição e coleção permitida só parceiros', D.MAX_MASSA === 2000 && [...D.COLECOES_MASSA].join() === 'parceiros' && (await rej(master, 'parceiros', docs(2001))).startsWith('400') && (await rej(master, 'parceiros', [])).startsWith('400') && (await rej(master, 'usuarios', docs(1))).startsWith('400') && (await rej(master, 'config', docs(1))).startsWith('400') && (await rej(master, 'lojas', docs(1))).startsWith('400'));
  chk('massa: sem sessão = 401; perfil Loja = 403; Operacional sem a permissão de editar fornecedores = 403', (await rej(null, 'parceiros', docs(1))).startsWith('401') && (await rej(loja, 'parceiros', docs(1))).startsWith('403') && (await rej(semPerm, 'parceiros', docs(1))).startsWith('403'));
  chk('massa: identificador inválido (barra, vazio, controle), registro repetido, dados que não são objeto e documento de mais de 5,5 MB são recusados antes de tocar no banco', (await rej(master, 'parceiros', [{ id: 'a/b', dados: {} }])).startsWith('400') && (await rej(master, 'parceiros', [{ id: '', dados: {} }])).startsWith('400') && (await rej(master, 'parceiros', [{ id: 'a\u0001b', dados: {} }])).startsWith('400') && (await rej(master, 'parceiros', [{ id: 'a', dados: {} }, { id: 'a', dados: {} }])).startsWith('400') && (await rej(master, 'parceiros', [{ id: 'a', dados: [1] }])).startsWith('400') && (await rej(master, 'parceiros', [{ id: 'a', dados: 'x' }])).startsWith('400') && (await rej(master, 'parceiros', [{ id: 'a', dados: { x: 'y'.repeat(5.6 * 1048576) } }])).startsWith('413'));
  chk('massa: o lote inteiro acima de 5 MB (vários documentos médios) é recusado com 413', (await rej(master, 'parceiros', Array.from({ length: 6 }, (_, i) => ({ id: 'g' + i, dados: { x: 'y'.repeat(1 * 1048576) } })))).startsWith('413'));
  const comEd = sess({ perfil: 'OPERACIONAL', permissoes: { parceiros: 'modificar' } });
  chk('regras do servidor: parceiros liberados pela matriz (parceiros.editar) e partes_contratuais só com lojas.contratos.* (ver/editar/excluir separados); Loja nunca', comEd.perms.has('parceiros.editar') && D.podeGravar(comEd, 'parceiros/p1') && !D.podeGravar(loja, 'partes_contratuais/pc-1') && !D.podeLer(loja, 'partes_contratuais/pc-1') && D.podeGravar(master, 'partes_contratuais/pc-1') && !D.podeGravar(semPerm, 'partes_contratuais/pc-1') && !D.podeLer(semPerm, 'partes_contratuais/pc-1'));
  const contr = sess({ perfil: 'OPERACIONAL', permissoes: { lojas: 'modificar', contratos: 'modificar' } }), soVer = sess({ perfil: 'OPERACIONAL', permissoes: { lojas: 'ler' } });
  chk('partes_contratuais: excluir exige lojas.contratos.excluir (ou Master); quem só edita não exclui', P.exclusaoPermitida(master, 'partes_contratuais/pc-1') === true && P.exclusaoPermitida(sess({ perfil: 'OPERACIONAL', permissoes: {} }), 'partes_contratuais/pc-1') === false && P.exclusaoPermitida(sess({ perfil: 'OPERACIONAL', permissoes: {} }, { perms: new Set(['lojas.contratos.editar']) }), 'partes_contratuais/pc-1') === false && P.exclusaoPermitida(sess({ perfil: 'OPERACIONAL', permissoes: {} }, { perms: new Set(['lojas.contratos.excluir']) }), 'partes_contratuais/pc-1') === true);
  const fnDocs = fs.readFileSync(path.join(raiz, 'netlify/functions/docs.mjs'), 'utf8');
  chk('rota registrada: /api/docs/massa em config.path e tratamento só de POST', /config = \{ path: \[[^\]]*'\/api\/docs\/massa'/.test(fnDocs) && /endsWith\('\/massa'\)[\s\S]{0,200}req\.method !== 'POST'/.test(fnDocs));
  const srcDoc = fs.readFileSync(path.join(raiz, 'netlify/lib/documentos.mjs'), 'utf8');
  chk('massa: uma única instrução INSERT … SELECT … unnest … ON CONFLICT (idempotente) numa transação, mais UMA linha no log de mudanças por lote', /FROM unnest\(\$2::text\[\], \$3::text\[\], \$4::text\[\]\)/.test(srcDoc) && /ON CONFLICT \(caminho\) DO UPDATE/.test(srcDoc.slice(srcDoc.indexOf('export async function gravarMassa'))) && (srcDoc.slice(srcDoc.indexOf('export async function gravarMassa')).match(/INSERT INTO mudancas/g) || []).length === 1 && /await tx\(/.test(srcDoc.slice(srcDoc.indexOf('export async function gravarMassa'))));
}

console.log(`\n${OK.length} ok, ${FAIL.length} falha(s)`);
if (FAIL.length) { console.log('FALHAS:\n - ' + FAIL.join('\n - ')); process.exit(1); }
