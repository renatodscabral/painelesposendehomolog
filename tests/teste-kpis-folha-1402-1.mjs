/* v14.02.1 · Gestão de Lojas › Indicadores & KPIs Operacionais: custo da folha por filial e a nova ordem das colunas.
   Valida, com o CÓDIGO REAL do painel (public/index.html: CodLoja, FolhaLoja e o bloco dos KPIs de Lojas), rodando num contexto isolado do Node
   (sem navegador e sem banco; Repo, Folha, permissões e formatação são simulados). Dados fictícios (LGPD).
   Cobre: caixa desmarcada × marcada (CTO + Folha = Custo operacional/mês por loja e na REDE), vínculo da lotação pelo número da loja
   ("05" = "5" = "05 - CAMARAGIBE" = "05 · CAMARAGIBE"), ordem das colunas (tela/PDF), subtítulo do card, permissões e o conserto do evento "change".
   Uso: node tests/teste-kpis-folha-1402-1.mjs */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(raiz, 'public/index.html'), 'utf8');
const OK = [], FAIL = [];
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x !== '' ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 500) : '')); };

/* ---------- extrai o código real do painel ---------- */
const fatia = (ini, fim, rotulo) => { const a = html.indexOf(ini); const b = html.indexOf(fim, a); if (a < 0 || b < 0) throw new Error('trecho não encontrado: ' + rotulo); return html.slice(a, b); };
const codLoja = fatia('const CodLoja = {', '\nconst Repo = {', 'CodLoja');
const folhaLoja = fatia('const FolhaLoja = {', '\nconst PontoEquilibrio = {', 'FolhaLoja');
const kpisLojas = fatia("  dadosKpi93({ tipo = '', regional = '', folha = false } = {}) {", '  async exportarV93(qual) {', 'KPIs de Lojas');
const exportarV93 = fatia('  async exportarV93(qual) {', '  imprimirV93(qual) {', 'exportarV93');
const imprimirV93 = fatia('  imprimirV93(qual) {', '  /* ---------------- eventos ---------------- */', 'imprimirV93');
const mudanca = fatia('  async mudanca(a, el) {\n    if (a === \'lj-filtro\')', '  entrada(a, el) {', 'Lojas.mudanca');
const grupar = fatia('  grupar(corpo) {', '  /** tipo de cada coluna', 'TabelaPro.grupar');

/* ---------- contexto isolado com o mínimo simulado ---------- */
const codigo = `
'use strict';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mm2 = m => String(m).padStart(2, '0');
const TIPOS_LOJA = ['Rua', 'Shopping'], ICON = { pdf: '' };
const Fmt = { brl: n => 'R$ ' + (Math.round(n * 100) / 100).toFixed(2).replace('.', ',').replace(/\\B(?=(\\d{3})+,)/g, '.'), num: (n, d = 0) => Number(n).toFixed(d).replace('.', ','), pct: (n, d = 1) => Number(n).toFixed(d).replace('.', ',') + '%' };
const Datas = { hoje: () => new Date(2026, 10, 12), iso: d => d.getFullYear() + '-' + mm2(d.getMonth() + 1) + '-' + mm2(d.getDate()) };
const cols = { lojas: new Map(), funcionarios: new Map(), salarios: new Map(), rh_folhas: new Map() };
const Repo = { prontas: new Set(['salarios', 'funcionarios', 'lojas']), todos: c => [...(cols[c] || new Map()).values()], get: (c, id) => (cols[c] || new Map()).get(id), versao: () => 1 };
const TAXA_ENCARGOS = 0.3111; // simulada: o cálculo real dos encargos tem teste próprio
const Folha = { calcular: (s) => { const te = Math.round(s * TAXA_ENCARGOS * 100) / 100; return { totalEncargos: te, custoTotal: s + te }; } };
let perms = new Set(['pessoal.salario.ver']), contratos = true, recurso = true;
const Auth = { can: p => perms.has(p) }, Contratos = { pode: () => contratos };
function g021() { return recurso; }
${codLoja}
${folhaLoja}
const Lojas = {
  ui: {},
  custos: l => ({ total: l.ocupTotal }),
  dadosPOS93: () => ({ grupos: [] }),
${kpisLojas}
${exportarV93}
${imprimirV93}
${mudanca}
  __fim: 0
};
({ Lojas, FolhaLoja, CodLoja, cols, Repo, TAXA_ENCARGOS, Fmt,
   set: o => { if ('perms' in o) perms = new Set(o.perms); if ('contratos' in o) contratos = o.contratos; if ('recurso' in o) recurso = o.recurso; } });
`;
const S = vm.runInNewContext(codigo, {}, { filename: 'painel-kpis.vm' });
const { Lojas, FolhaLoja, CodLoja, cols, Repo, TAXA_ENCARGOS, Fmt } = S;

/* ---------- massa fictícia ---------- */
const L = (id, codigo, nome, area, fat, ocupTotal, ativa = true) => cols.lojas.set(id, { id, codigo, nome, ativa, tipo: 'Rua', areaM2: area, faturamentoMedio: fat, ocupTotal, supervisor: 'REG A' });
L('loja-005', '05', 'CAMARAGIBE', 100, 100000, 14000); L('loja-006', '06', 'BOA VIAGEM', 50, 40000, 5000); L('loja-007', '07', 'SEM EQUIPE', 80, 60000, 4000); L('loja-008', '08', 'FECHADA', 60, 30000, 3000, false);
const F = (id, lotacao, salario, extra = {}) => { cols.funcionarios.set(id, { id, nome: 'COLAB ' + id, status: 'Ativo', admissao: '2024-01-01', lotacao, ...extra }); cols.salarios.set(id, { id, valor: salario, desde: '2024-01-01', historico: [] }); };
F('f1', '05', 2000); F('f2', '5', 2000); F('f3', '05 - CAMARAGIBE', 2000); F('f4', '05 · CAMARAGIBE', 2000); F('f5', 'loja-005', 2000);
F('f6', '06 - BOA VIAGEM', 3000); F('f7', '05', 2000, { status: 'Desligado' }); F('f8', '08', 2500); F('f9', 'Matriz', 4000);

const r2 = n => Math.round(n * 100) / 100;
const linha = (d, cod) => d.linhas.find(x => x.codigo === cod);
const cabecalho = h => [...h.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map(m => m[1]);
const COL_SEM = ['Loja', 'Tipo', 'm²', 'Faturamento médio/mês', 'Venda por m²', 'CTO (ocupação)', 'Custo operacional/mês', 'Custo por m²', 'Resultado/mês', 'Resultado por m²', 'Margem'];
const COL_COM = ['Loja', 'Tipo', 'm²', 'Faturamento médio/mês', 'Venda por m²', 'CTO (ocupação)', 'Custo da folha', 'Custo operacional/mês', 'Custo por m²', 'Resultado/mês', 'Resultado por m²', 'Margem'];

/* ---------- 1 · vínculo da lotação pelo número da loja ---------- */
const formatos = ['05', '5', '05 - CAMARAGIBE', '05 · CAMARAGIBE', 'loja-005', ' 5 ', '0005', 'Filial 05'];
chk('1.1 "05" = "5" = "05 - CAMARAGIBE" = "05 · CAMARAGIBE" = "loja-005": mesmo código oficial', formatos.every(v => CodLoja.oficial(v) === '05'), formatos.map(v => CodLoja.oficial(v)));
chk('1.2 lotação sem número (ex.: "Matriz") não vira loja', CodLoja.oficial('Matriz') === '');
const f05 = FolhaLoja.mes(cols.lojas.get('loja-005'), 2026, 11), f06 = FolhaLoja.mes(cols.lojas.get('loja-006'), 2026, 11);
chk('1.3 loja 05: 5 colaboradores ativos (5 formatos de lotação); o desligado fica fora', f05.pessoas === 5 && f05.salarios === 10000, f05);
chk('1.4 loja 05: custo real = salários + encargos patronais', f05.encargos === r2(5 * r2(2000 * TAXA_ENCARGOS)) && r2(f05.total) === r2(f05.salarios + f05.encargos), f05);
chk('1.5 loja 06: 1 colaborador; a lotação "Matriz" (sem número de loja) não entra em nenhuma filial', f06.pessoas === 1 && FolhaLoja.mes(cols.lojas.get('loja-007'), 2026, 11).pessoas === 0);

/* ---------- 2 · folha DESMARCADA ---------- */
const off = Lojas.dadosKpi93({ folha: false });
chk('2.1 desmarcada: sem folha no cálculo (verFolha falso, folha nula)', off.verFolha === false && off.linhas.every(x => x.folha === null));
chk('2.2 desmarcada: Custo operacional/mês = CTO (todas as lojas)', off.linhas.every(x => x.custo === x.cto), off.linhas.map(x => [x.codigo, x.cto, x.custo]));
chk('2.3 loja 05: CTO 14.000 e Custo por m² = 140,00', linha(off, '05').cto === 14000 && linha(off, '05').custoM2 === 140);
chk('2.4 lojas inativas não entram', !linha(off, '08') && off.rede.lojas === 3);
chk('2.5 colunas sem a folha, na ordem pedida', JSON.stringify(cabecalho(Lojas.htmlTabelaKpi93(off))) === JSON.stringify(COL_SEM), cabecalho(Lojas.htmlTabelaKpi93(off)));

/* ---------- 3 · folha MARCADA ---------- */
const on = Lojas.dadosKpi93({ folha: true });
chk('3.1 marcada: folha entra (verFolha verdadeiro)', on.verFolha === true && on.folhaPendente === false);
for (const cod of ['05', '06', '07']) {
  const x = linha(on, cod), area = { '05': 100, '06': 50, '07': 80 }[cod], fat = { '05': 100000, '06': 40000, '07': 60000 }[cod];
  chk(`3.2 loja ${cod}: CTO + Folha = Custo operacional/mês`, Math.abs(r2(x.cto + x.folha) - x.custo) < 0.005, [x.cto, x.folha, x.custo]);
  chk(`3.3 loja ${cod}: Custo por m², Resultado/mês, Resultado por m² e Margem recalculados sobre o custo operacional`, Math.abs(x.custoM2 - r2(x.custo / area)) < 0.006 && Math.abs(x.resultado - r2(fat - x.custo)) < 0.006
    && Math.abs(x.resultadoM2 - r2((fat - x.custo) / area)) < 0.006 && Math.abs(x.margem - (fat - x.custo) / fat * 100) < 1e-9, x);
}
chk('3.4 loja 05: folha = salários + encargos do cadastro (5 pessoas) e CTO continua 14.000', linha(on, '05').folha === r2(f05.total) && linha(on, '05').cto === 14000 && linha(on, '05').folhaPessoas === 5, linha(on, '05'));
chk('3.5 loja 07 (sem equipe): folha 0,00 e custo = CTO', linha(on, '07').folha === 0 && linha(on, '07').custo === linha(on, '07').cto);
chk('3.6 a folha aumenta o custo por m² da rede em relação à caixa desmarcada', on.rede.custoM2 > off.rede.custoM2 && on.rede.resultadoM2 < off.rede.resultadoM2, [off.rede.custoM2, on.rede.custoM2]);
chk('3.7 REDE: CTO + Folha = Custo operacional/mês (totais mensais)', Math.abs(r2(on.rede.ctoTotal + on.rede.folhaTotal) - on.rede.custoTotal) < 0.005, on.rede);
chk('3.8 REDE: custo por m² = soma dos custos ÷ soma das áreas (razão das somas)', Math.abs(on.rede.custoM2 - r2(on.rede.custoTotal / (100 + 50 + 80))) < 0.006, on.rede);
chk('3.9 resumo da folha (colaboradores e valores) para o aviso da tela', on.folhaInfo.pessoas === 6 && on.folhaInfo.lojas === 2 && Math.abs(on.folhaInfo.total - r2(on.folhaInfo.salarios + on.folhaInfo.encargos)) < 0.005 && on.folhaInfo.ref === '11/2026', on.folhaInfo);
chk('3.10 colunas com a folha, na ordem exata pedida', JSON.stringify(cabecalho(Lojas.htmlTabelaKpi93(on))) === JSON.stringify(COL_COM), cabecalho(Lojas.htmlTabelaKpi93(on)));
chk('3.11 impressão/PDF usa a mesma tabela e a mesma ordem', JSON.stringify(cabecalho(Lojas.htmlTabelaKpi93(on, true))) === JSON.stringify(COL_COM));

/* ---------- 4 · linhas da tabela: células nas colunas certas e REDE fixa ---------- */
const tabela = Lojas.htmlTabelaKpi93(on), trs = [...tabela.matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)].slice(1);
const celulas = tr => [...tr[1].matchAll(/<td([^>]*)>(.*?)<\/td>/gs)].map(m => ({ attr: m[1], txt: m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() }));
const t05 = celulas(trs.find(t => /CAMARAGIBE/.test(t[1])));
chk('4.1 linha da loja: 12 células e a folha na 7ª coluna (logo após o CTO)', t05.length === 12 && t05[5].txt === Fmt.brl(14000) && t05[6].txt === Fmt.brl(r2(f05.total)) && t05[7].txt === Fmt.brl(r2(14000 + f05.total)), t05.map(c => c.txt));
const trRede = trs.at(-1), cR = celulas(trRede);
chk('4.2 linha REDE por último, marcada como fixa (data-tp-fixa) para a ordenação por cabeçalho', /class="tot"/.test(trRede[0]) && /data-tp-fixa="1"/.test(trRede[0]));
chk('4.3 REDE: rótulo ocupa Loja+Tipo e as colunas seguintes ficam alinhadas (CTO, Folha, Custo operacional)', /colspan="2"/.test(cR[0].attr) && cR.length === 11 && cR[4].txt === Fmt.brl(on.rede.ctoTotal) && cR[5].txt === Fmt.brl(on.rede.folhaTotal) && cR[6].txt === Fmt.brl(on.rede.custoTotal), cR.map(c => c.txt));
const tOff = [...Lojas.htmlTabelaKpi93(off).matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)].slice(1);
chk('4.4 desmarcada: linha da loja com 11 células e REDE alinhada', celulas(tOff.find(t => /CAMARAGIBE/.test(t[1]))).length === 11 && celulas(tOff.at(-1)).length === 10);

/* ---------- 5 · cards do topo ---------- */
const card = (h, titulo) => { const m = h.match(new RegExp('<div class="k">' + titulo + '</div><div class="v[^"]*"[^>]*>([^<]*)</div><div class="d">([^<]*)</div>')); return m ? { v: m[1], d: m[2] } : null; };
Lojas.ui = { v93Folha: false }; const rOff = Lojas.renderKpi93();
Lojas.ui = { v93Folha: true }; const rOn = Lojas.renderKpi93();
chk('5.1 card "Custo operacional por m²" com a folha: subtítulo "CTO + folha de pagamento"', card(rOn, 'Custo operacional por m²')?.d === 'CTO + folha de pagamento', card(rOn, 'Custo operacional por m²'));
chk('5.2 card sem a folha: subtítulo sem "folha"', !!card(rOff, 'Custo operacional por m²') && !/folha/i.test(card(rOff, 'Custo operacional por m²').d), card(rOff, 'Custo operacional por m²'));
chk('5.3 cards recalculados: custo e resultado por m² mudam com a folha e batem com a rede', card(rOn, 'Custo operacional por m²').v === Fmt.brl(on.rede.custoM2) && card(rOff, 'Custo operacional por m²').v === Fmt.brl(off.rede.custoM2) && card(rOn, 'Resultado por m²').v !== card(rOff, 'Resultado por m²').v);
chk('5.4 caixa da folha marcada na tela e aviso "Folha incluída" com os totais', /data-a="lj-v93-folha" checked/.test(rOn) && /Folha incluída/.test(rOn) && !/Folha incluída/.test(rOff) && !/data-a="lj-v93-folha" checked/.test(rOff));

/* ---------- 6 · permissões ---------- */
S.set({ perms: [] }); const semSal = Lojas.dadosKpi93({ folha: true }); const rSem = Lojas.renderKpi93();
chk('6.1 sem "Pode ver salários": sem caixa, sem coluna de folha e custo = CTO (folha nunca é lida)', semSal.verFolha === false && !/lj-v93-folha/.test(rSem) && semSal.linhas.every(x => x.folha === null && x.custo === x.cto));
S.set({ perms: ['pessoal.salario.ver'], contratos: false }); const semCont = Lojas.dadosKpi93({ folha: true }); const rCont = Lojas.renderKpi93();
chk('6.2 com salário e sem Contratos (Módulo 3): caixa desabilitada, sem colunas de custo', semCont.verFolha === false && semCont.verCustos === false && /lj-v93-folha[^>]*disabled/.test(rCont) && JSON.stringify(cabecalho(Lojas.htmlTabelaKpi93(semCont))) === JSON.stringify(COL_SEM.slice(0, 5)));
S.set({ contratos: true }); Repo.prontas.delete('salarios'); const pend = Lojas.dadosKpi93({ folha: true });
chk('6.3 dados do RH ainda carregando: sinaliza pendência em vez de calcular a folha com zero', pend.folhaPendente === true && pend.verFolha === false && /Carregando os dados de funcionários e salários/.test(Lojas.renderKpi93()));
Repo.prontas.add('salarios');

/* ---------- 7 · recurso gestao_v14021 desligado (Produção sem "Liberar Versão"): layout de antes, mas a caixa funciona ---------- */
S.set({ recurso: false }); const leg = Lojas.dadosKpi93({ folha: true }), legOff = Lojas.dadosKpi93({ folha: false });
chk('7.1 sem o recurso: colunas antigas (sem CTO e sem Custo da folha)', JSON.stringify(cabecalho(Lojas.htmlTabelaKpi93(leg))) === JSON.stringify(COL_SEM.filter(c => c !== 'CTO (ocupação)')), cabecalho(Lojas.htmlTabelaKpi93(leg)));
chk('7.2 sem o recurso, a caixa marcada ainda soma a folha no Custo operacional/mês', linha(leg, '05').custo === r2(14000 + f05.total) && linha(legOff, '05').custo === 14000);
S.set({ recurso: true });

/* ---------- 8 · o conserto do evento e as exportações (código-fonte) ---------- */
chk('8.1 Lojas.mudanca trata "lj-v93-folha" (a caixa é um INPUT: o clique é ignorado pelo despachante global e chega por "change")', /if \(a === 'lj-v93-folha'\) \{ this\.ui\.v93Folha = !!el\.checked; return App\.render\(\); \}/.test(mudanca));
chk('8.2 Excel usa a MESMA definição de colunas (colunasKpi93) e grava a aba Parâmetros com o estado da folha', /this\.colunasKpi93\(d\)/.test(exportarV93) && /'Parâmetros'/.test(exportarV93) && /'Folha de pagamento \(salário \+ encargos\)'/.test(exportarV93));
chk('8.3 PDF usa a mesma tabela (htmlTabelaKpi93) e informa se a folha foi incluída', /htmlTabelaKpi93\(d, true\)/.test(imprimirV93) && /folha de pagamento \$\{d\.verFolha \? 'incluída/.test(imprimirV93));
chk('8.4 ordenação por cabeçalho: a linha marcada com data-tp-fixa fica fixa no fim (como as linhas "Total…")', /hasAttribute\('data-tp-fixa'\)/.test(grupar));

console.log(`\n${OK.length} ok · ${FAIL.length} falha(s)`); if (FAIL.length) { console.log('FALHAS:\n - ' + FAIL.join('\n - ')); process.exit(1); }
