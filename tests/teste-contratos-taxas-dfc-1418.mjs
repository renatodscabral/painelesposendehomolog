import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* v14.18 · Contratos × Conta Bancária × Lojas e ECs (puxada do Cadastro de Lojas), taxa efetiva (Antecipação Efetiva apurada, tarifas de POS e retenções),
   abatimento mensal no saldo a receber de antecipações e Auditoria de Adquirentes na DFC (categoria automática, Previsto por toggle, Reconciliação de Recebíveis de Cartões no Resumo Executivo A4).
   Valida o CÓDIGO REAL do painel (public/index.html), em contexto isolado do Node, só com dados FICTÍCIOS (LGPD): CNPJs gerados aqui e valores inventados.
   Blocos:
     0) recurso gestao_v1418 (depende da v14.17), Regra de Ouro (regiões protegidas, FCX e Contábil intactos) e montagem;
     1) Item 1 · Cadastro de Lojas → contrato: lojas e ECs por adquirente + empresa/CNPJ, filiais inativas fora, empresa pelo EC/CNPJ do TEF/CNPJ da loja, sem empresa só com contrato único, união sem perder o digitado, puxar e gravar, tabela única sem a tabela duplicada, modal pré-preenchido;
     2) Item 2 · Antecipação Efetiva (coluna da adquirente × apurada contra o OFX), leitor ampliado de tarifas de POS e retenções/chargebacks, taxa efetiva total;
     3) Item 3 · abatimento mensal das taxas no Saldo a Receber de Antecipações (Bruto − Taxas = Líquido disponível);
     4) Item 4 · Auditoria × DFC: categoria de cartões nos créditos auditados, Previsto pelo Líquido Esperado (toggle) e quadro "Reconciliação de Recebíveis de Cartões" do Resumo Executivo A4.
   Uso: node tests/teste-contratos-taxas-dfc-1418.mjs */
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
chk('recurso gestao_v1418 na lista de liberação (v14.18) e helper g18() que depende da v14.17', /gestao_v1418: \{ versao: 'v14\.18'/.test(html) && /function g18\(\) \{ return typeof Recursos !== 'undefined' && Recursos\.ativo\('gestao_v1418'\) && g17\(\); \}/.test(html));
chk('nenhuma peça deixou marcador de montagem no painel final', !/@@V141[78]_/.test(html));
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
  chk(`Regra de Ouro: public/${f} idêntico ao da v14.17 — a v14.18 NÃO toca no FCX nem no Contábil (md5 ${h}…)`, fs.existsSync(p) && md5(fs.readFileSync(p)).startsWith(h));
}

/* ---------- ambiente de teste: código REAL do painel (Adq14/Adq15/Adq17/Adq18) com Repo/UI de brincadeira ---------- */
const base = corta('const ADQ_CFG = {', '/* ============================ 6. SERVIÇOS ============================ */');
const motor = corta('const MotorConciliacao = {', '/* ============================ 7. UI (aba do Módulo 4) ============================ */');
const modulo = corta('const ADQ14 = {', '/* ---- fim v14.15 ---- */') + '/* ---- fim v14.15 ---- */';
const parcPix = corta('/* PARC_PIX:INI */', '/* PARC_PIX:FIM */');
const dfcResumo = corta('/* DFC_RESUMO:INI */', '/* DFC_RESUMO:FIM */');
const adq17 = corta('const ADQ17 = {', '/* =====================================================================\n   v14.17 · FRENTE 2 · DESDOBRAMENTO ANALÍTICO');
const m18 = corta('const ADQ18 = {', '/* ---- fim v14.18 ---- */');
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

function ambiente({ g14 = true, g15 = true, g17 = true, g18 = true } = {}) {
  const S = { adq_taxas: new Map(), adq_contratos: new Map(), adq_lotes: new Map(), adq_agendas: new Map(), adq_erp: new Map(), contasBancarias: new Map(), extratos: new Map(), lojas: new Map(), config: new Map() };
  const V = {}; let tic = 0; const bump = c => { V[c] = (V[c] || 0) + 1; };
  const Repo = {
    cols: S, prontas: new Set(Object.keys(S)), todos: c => [...(S[c] || new Map()).values()], get: (c, id) => (S[c] || new Map()).get(id) || null, versao: c => V[c] || 0,
    salvar: async (c, id, d, aud) => { S[c].set(id, { id, ...JSON.parse(JSON.stringify(d)), atualizadoEm: 't' + (++tic) }); bump(c); ctx.gravacoes.push({ c, id, aud }); },
    excluir: async (c, id) => { S[c].delete(id); bump(c); }, assinar(c) { ctx.assinadas.push(c); }, semMeta: d => d,
    recarregar: async c => { Repo.prontas.add(c); bump(c); },
  };
  const emp = { resilienza: { id: 'resilienza', nome: 'Resilienza', cnpj: CNPJ_RES }, 'mar-aberto': { id: 'mar-aberto', nome: 'Mar Aberto', cnpj: CNPJ_MAR } };
  const ctx = { bases: [], fcxApi: null, flag: g14, flag15: g15, flag17: g17, flag18: g18, toasts: [], audits: [], gravacoes: [], confirmou: 0, assinadas: [], modais: [], baixados: [], previas: [], form: null };
  const ConcMP = { SUBS72: [], ui: { sub: 'regras' }, v72: () => true, renderCredito() { return 'ORIGINAL-CREDITO'; }, renderRegras() { return 'ORIGINAL-REGRAS'; },
    empresa: id => emp[id] || null, nomeEmpresa: id => emp[id]?.nome || id || '—', empresas: () => Object.values(emp), ecInfo: () => null };
  const mocks = {
    Repo, ConcMP, g14: () => ctx.flag, g15: () => ctx.flag15 && ctx.flag, g16: () => ctx.flag, g17: () => ctx.flag17 && ctx.flag15 && ctx.flag, g18: () => ctx.flag18 && ctx.flag17 && ctx.flag15 && ctx.flag,
    Datas: { hojeISO: () => '2026-11-17', iso: d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }, Recursos: { ativo: () => true }, Auth: { can: (...x) => (ctx.pode ? ctx.pode(...x) : true), id: 'u-teste' }, Libs: {}, FCX: { api: () => ctx.fcxApi || null, get versao() { return ctx.fcxVer || 1; }, montar() {} }, g07: () => false,
    ContasBancarias: { rotulo: c => c.apelido }, Retaguarda: { mesAnterior: m => { const [y, mm] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mm - 2, 1)); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); } }, CNPJ: undefined, LOGO_NAVY: 'data:image/png;base64,AAAA', $: () => null,
    Fmt: { brl: n => 'R$' + Number(n).toFixed(2), brl0: n => 'R$' + Math.round(n), num: (n, d = 0) => Number(n).toFixed(d), data: d => String(d ?? '').replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1'), dataHora: d => d, pct: (n, d = 2) => Number(n).toFixed(d) + '%' },
    UI: { toast: m => ctx.toasts.push(m), modal(o) { ctx.modais.push(o); return { el: {} }; }, confirmar: async () => { ctx.confirmou++; return true; }, confirmarImpacto: async () => { ctx.confirmou++; return true; }, lerForm: () => ctx.form || ({}) },
    App: { render() { ctx.renders = (ctx.renders || 0) + 1; }, agendarRender() { } }, Audit: { registrar: a => { ctx.audits.push(a); return Promise.resolve(); } },
    Documento: { baixarArquivo(nome, blob) { ctx.baixados.push([nome, blob]); return true; }, montar: (t, corpo, o) => ({ titulo: t, corpo, opcoes: o }), previa: (t, doc, nome) => { ctx.previas.push({ titulo: t, doc, nome }); } }, CSV: { gerar: m => m.map(l => l.join(';')).join('\n') },
    registrarBase: m => ctx.bases.push(m), g09: () => true, g11: () => false, Acesso: { loja: () => false }, esc: escH,
  };
  const nomes = Object.keys(mocks).filter(k => k !== 'CNPJ');
  const fn = new Function(...nomes, `${CNPJlib}\n${parcPix}\n${campoCod}\n${codLojaCod}\n${base}\n${motor}\n${modulo}\n${dfcCore}\n${prevCz}\n${dfcResumo}\nconst FluxoDFC = { ui: { sub: 'cruzamento', mes: '2026-01' }, _czDados: null, transacoes() { return Repo.todos('extratos').flatMap(d => (d.transacoes || []).map(t => ({ ...t, contaId: d.contaId, docId: d.id }))); }, trDFC() { return this.transacoes(); }, contas() { return Repo.todos('contasBancarias'); }, semSalarios06() { return false; }, mesLabel: m => m, marcaDoc: () => 'Esposende', r2: n => Math.round((n + Number.EPSILON) * 100) / 100, mesesBanco() { return [...new Set(Repo.todos('extratos').map(d => d.mes))].sort().reverse(); }, async atualizarBaseDFC(meses) { registrarBase(meses); }, ${fdDadosResumo} ${fdModeloExport} ${fdOrigemRot} };\n${adq17}\n${m18}\n/* métodos reais do ConcMP usados pelo contrato */\nObject.assign(ConcMP, { ${metodo('dig')}, ${metodo('empresaPorCnpj')}, ${metodo('canonAdq')} });\nreturn { ADQ_CFG, AdqTaxas, DiasUteis, MotorConciliacao, ADQ14, Adq14, ADQ15, Adq15, ADQ17, Adq17, ADQ18, Adq18, DFC_RESUMO, DFC, DFC_CATEGORIAS, DFC_REGRAS_PADRAO, Cruzamento, PrevistoFCX, FluxoDFC, CNPJ, CodLoja, campo };`);
  const E = fn(...nomes.map(k => mocks[k]));
  ctx.S = S; ctx.Repo = Repo; ctx.ConcMP = ConcMP; ctx.bump = bump; Object.assign(ctx, E);
  return ctx;
}

/* =====================================================================
   1 · ITEM 1 · CADASTRO DE LOJAS → CONTRATO (lojas e ECs) + TABELA ÚNICA
   ===================================================================== */
const lj = (cod, nome, adqs, extra = {}) => ({ id: 'loja-' + cod.padStart(3, '0'), codigo: cod, nome, ativa: true, cnpj: '', adquirentes: adqs, ...extra });
const A = (adquirente, ec, extra = {}) => ({ adquirente, tipo: 'CARTÃO TERCEIROS', posicao: 'PRIMÁRIA', ec, ...extra });
function cenario1({ g18 = true, comMar = true } = {}) {
  const E = ambiente({ g18 });
  [['ct-a', 'Conta A'], ['ct-b', 'Conta B'], ['ct-c', 'Conta C']].forEach(([id, apelido]) => E.S.contasBancarias.set(id, { id, apelido, ativa: true }));
  const mk = (adq, emp, conta, extra = {}) => E.S.adq_contratos.set(E.Adq14.idContrato(adq, emp), { id: E.Adq14.idContrato(adq, emp), adquirente: adq, empresaId: emp, contaId: conta, ativo: true, ...extra });
  mk('GETNET', 'resilienza', 'ct-a'); if (comMar) mk('GETNET', 'mar-aberto', 'ct-b'); mk('SAFRAPAY', 'resilienza', 'ct-c');
  [lj('05', 'Loja Praia', [A('GETNET', '15105016', { empresaId: 'resilienza' }), A('SAFRAPAY', '1454475', { empresaId: 'resilienza' })]),
   lj('28', 'Loja Centro', [A('SAFRAPAY', '1454475', { cnpjTef: fmtCnpj(CNPJ_RES) })]),                                   // empresa pelo CNPJ do EC/TEF
   lj('31', 'Loja Norte', [A('SAFRAPAY', '1454476')], { cnpj: fmtCnpj(CNPJ_RES_FIL) }),                                    // empresa pelo CNPJ da loja (mesma raiz da matriz)
   lj('40', 'Loja Sul', [A('GETNET', '13100535', { empresaId: 'mar-aberto' })]),
   lj('41', 'Loja Fechada', [A('GETNET', '999', { empresaId: 'resilienza' })], { ativa: false }),                           // inativa: fora
   lj('50', 'Loja Sem EC', [A('GETNET', '', { empresaId: 'resilienza' })]),
   lj('60', 'Loja Sem Empresa', [A('GETNET', '777')]),
   lj('70', 'Loja Outra Adq', [A('CREDSYSTEM', '3030', { empresaId: 'resilienza' })])].forEach(l => E.S.lojas.set(l.id, l));
  E.bump('lojas'); E.bump('adq_contratos'); return E;
}
{
  const E = cenario1(), G = E.Adq14.contrato(E.Adq14.idContrato('GETNET', 'resilienza')), M = E.Adq14.contrato(E.Adq14.idContrato('GETNET', 'mar-aberto')), SF = E.Adq14.contrato(E.Adq14.idContrato('SAFRAPAY', 'resilienza'));
  const g = E.Adq18.doCadastro(G), m = E.Adq18.doCadastro(M), s = E.Adq18.doCadastro(SF);
  chk('Getnet · Resilienza: lê só as filiais ATIVAS com Getnet e a empresa do contrato (05 e 50); EC 15105016', igual(g.lojas, ['05', '50']) && igual(g.ecs, ['15105016']), g);
  chk('filial inativa (41) e linha de outra adquirente (70, Credsystem) não entram', !g.lojas.includes('41') && !g.lojas.includes('70') && !g.ecs.includes('999') && !g.ecs.includes('3030'));
  chk('Getnet · Mar Aberto: só a loja 40 (EC 13100535) — a loja de outra empresa não entra e fica listada em "outra empresa"', igual(m.lojas, ['40']) && igual(m.ecs, ['13100535']) && m.outraEmpresa.some(i => i.codigo === '05'), m);
  chk('com dois contratos Getnet, a loja 60 (sem empresa definida) NÃO é atribuída a nenhum: vai para "sem empresa definida" para o usuário decidir', !g.lojas.includes('60') && !m.lojas.includes('60') && g.semEmpresa.some(i => i.codigo === '60') && m.semEmpresa.some(i => i.codigo === '60'));
  chk('loja 50 entra (a empresa é a do contrato), mas sem EC preenchido: aparece no aviso "sem EC" e não gera EC vazio', g.semEc.some(i => i.codigo === '50') && !g.ecs.includes(''));
  chk('SafraPay · Resilienza: lojas 05 (empresa escolhida), 28 (CNPJ do EC/TEF) e 31 (CNPJ da loja, mesma raiz do CNPJ da matriz); ECs 1454475 e 1454476', igual(s.lojas, ['05', '28', '31']) && igual(s.ecs, ['1454475', '1454476']), s);
  chk('a origem do vínculo é informada por linha (empresa escolhida, CNPJ do EC/TEF, CNPJ da loja)', s.itens.find(i => i.codigo === '05').via === 'manual' && s.itens.find(i => i.codigo === '28').via === 'cnpj' && s.itens.find(i => i.codigo === '31').via === 'cnpj-loja', s.itens.map(i => [i.codigo, i.via]));
  /* contrato único da adquirente: a loja sem empresa definida entra */
  const E2 = cenario1({ comMar: false }), G2 = E2.Adq14.contrato(E2.Adq14.idContrato('GETNET', 'resilienza')), g2 = E2.Adq18.doCadastro(G2);
  chk('com UM só contrato Getnet, a loja 60 sem empresa definida entra (vínculo "contrato único da adquirente") e o EC 777 vem junto', igual(g2.lojas, ['05', '50', '60']) && g2.ecs.includes('777') && g2.itens.find(i => i.codigo === '60').via === 'sem-empresa', g2);
  /* união: nada digitado à mão se perde */
  const u = E.Adq18.unir('5, 99', 'X-1', s);
  chk('união: o que já estava no contrato (loja 99 e EC X-1, digitados à mão) é mantido; "5" e "05" são a mesma loja; só entra o que é novo', igual(u.lojas, ['05', '28', '31', '99']) && igual(u.novasLojas, ['28', '31']) && igual(u.ecs, ['1454475', '1454476', 'X-1']) && igual(u.novosEcs, ['1454475', '1454476']), u);
  const u0 = E.Adq18.unir('', '', g); chk('contrato sem nada pré-preenche com tudo do Cadastro', igual(u0.lojas, ['05', '50']) && igual(u0.ecs, ['15105016']));
  /* sugestão memorizada e invalidada quando o cadastro muda */
  const sg1 = E.Adq18.sugestao(G); chk('sugestão do contrato salvo: o que ainda falta nele', igual(sg1.novasLojas, ['05', '50']));
  E.S.lojas.set('loja-080', lj('80', 'Loja Nova', [A('GETNET', '8080', { empresaId: 'resilienza' })])); E.bump('lojas');
  const sg2 = E.Adq18.sugestao(G); chk('cadastrar uma filial nova no Módulo 2 muda a sugestão na hora (cache pelas versões das lojas)', sg2.novasLojas.includes('80') && sg2.novosEcs.includes('8080'), sg2);
  /* puxar e gravar */
  const r = await E.Adq18.puxar(G.id), G3 = E.Repo.get('adq_contratos', G.id);
  chk('Puxar grava lojas e ECs no contrato (união) e carimba a data da puxada; adquirente, empresa e conta não mudam', igual(G3.lojas, ['05', '50', '80']) && igual(G3.ecs, ['8080', '15105016']) && !!G3.sincCadastroEm && G3.contaId === 'ct-a' && G3.empresaId === 'resilienza', G3);
  chk('a gravação sai com rótulo e detalhe de auditoria ("Puxado do Cadastro de Lojas: +3 loja(s)")', E.gravacoes.at(-1).aud?.modulo === 'conciliacao' && /Puxado do Cadastro de Lojas: \+3 loja\(s\)/.test(E.gravacoes.at(-1).aud?.detalhe || ''), E.gravacoes.at(-1));
  const r2x = await E.Adq18.puxar(G.id); chk('puxar de novo não muda nada (idempotente: nada novo)', r2x.novasLojas.length === 0 && r2x.novosEcs.length === 0);
  /* digitado à mão sobrevive a uma nova puxada */
  await E.Adq15.salvarVinculos(G.id, { lojas: '05, 50, 80, 99', ecs: '15105016, 8080, 55555' }); await E.Adq18.puxar(G.id);
  chk('loja 99 e EC 55555 digitados à mão permanecem depois de puxar do Cadastro', E.Repo.get('adq_contratos', G.id).lojas.includes('99') && E.Repo.get('adq_contratos', G.id).ecs.includes('55555'));
  E.pode = k => k !== 'retaguarda.adq.taxas'; let erro = ''; try { await E.Adq18.puxar(G.id); } catch (e) { erro = e.message; }
  chk('sem a permissão de alterar taxas/contratos, não puxa nem grava', /não pode alterar/.test(erro));
}
{
  /* tabela única */
  const E = cenario1({ g18: true }), off = cenario1({ g18: false });
  const h = E.Adq14.renderContratos(), ho = off.Adq14.renderContratos();
  chk('v14.18 ligada: título "Contratos × Conta Bancária × Lojas e ECs" e as 8 colunas pedidas, nesta ordem', /<h2>Contratos × Conta Bancária × Lojas e ECs<\/h2>/.test(h) && /<th>Adquirente<\/th><th>Empresa \/ CNPJ<\/th><th>Conta Bancária \(OFX\)<\/th><th>Lojas Vinculadas<\/th><th>ECs<\/th><th class="num">Bandeiras com Taxa<\/th><th class="num">Lotes<\/th><th class="num">Ações<\/th>/.test(h), h.slice(0, 600));
  chk('a tabela duplicada "Lojas do ERP e Estabelecimentos (EC) por contrato" some (uma só tabela de contratos na tela)', !/Lojas do ERP e Estabelecimentos \(EC\) por contrato/.test(h) && (h.match(/<table/g) || []).length === 1, (h.match(/<table/g) || []).length);
  chk('desligada (v14.17): continuam as duas tabelas antigas (contratos + "Lojas do ERP e Estabelecimentos (EC) por contrato") — nada muda para quem não usa o recurso', /Contratos × Conta Bancária de Crédito \(OFX\)/.test(ho) && /Lojas do ERP e Estabelecimentos \(EC\) por contrato/.test(ho) && (ho.match(/<table/g) || []).length === 2 && !/Lojas e ECs<\/h2>/.test(ho));
  chk('cada contrato mostra suas lojas e ECs em chips; "+N no Cadastro" avisa o que o Cadastro de Lojas tem a mais; botão Puxar do Cadastro na linha e para todos', /<span class="a15-chip">EC /.test(h) === false && /\+2 no Cadastro/.test(h) && /data-a="a14-contrato-puxar"/.test(h) && /data-a="a14-contratos-puxar-todos"/.test(h), h);
  await E.Adq18.puxar(E.Adq14.idContrato('GETNET', 'resilienza'));
  const h2 = E.Adq14.renderContratos(); const linhaG = h2.split('<tr data-id=').find(x => x.includes('getnet__emp-resilienza')) || '';
  chk('depois de puxar: chips "05", "50" e "EC 15105016" aparecem na linha do contrato e some o aviso "+ no Cadastro" dessa linha', /a15-chip">05</.test(linhaG) && /a15-chip">50</.test(linhaG) && /a15-chip">EC 15105016</.test(linhaG) && !/no Cadastro/.test(linhaG.split('</tr>')[0]), linhaG.slice(0, 900));
  chk('perfil só de leitura: a tabela aparece, sem os botões de Editar/Puxar/Remover', (E.pode = k => k !== 'retaguarda.adq.taxas', !/data-a="a14-contrato-puxar"/.test(E.Adq14.renderContratos())));
  E.pode = null;
  /* modal */
  E.ctx = null; const E3 = cenario1({ g18: true }); const id = E3.Adq14.idContrato('SAFRAPAY', 'resilienza');
  E3.Adq14.abrirContrato(id); const M = E3.modais.at(-1);
  chk('modal "Contrato · editar": lojas e ECs já vêm pré-preenchidos do Cadastro (05, 28, 31 · 1454475, 1454476), editáveis, com o botão "Puxar Lojas e ECs do Cadastro de Lojas"', M.titulo === 'Contrato · editar' && /name="lojas" value="05, 28, 31"/.test(M.corpo) && /name="ecs" value="1454475, 1454476"/.test(M.corpo) && /data-a18-puxar>Puxar Lojas e ECs do Cadastro de Lojas<\/button>/.test(M.corpo) && typeof M.aoAbrir === 'function', M.corpo.slice(0, 400));
  chk('o modal explica o que veio do Cadastro e lista as linhas usadas (Loja, Nome, EC, Empresa · vínculo)', /Pré-preenchido do Cadastro de Lojas: \+3 loja\(s\) e \+2 EC\(s\)/.test(M.corpo) && /Ver as 3 linha\(s\) do Cadastro de Lojas usadas/.test(M.corpo) && /CNPJ da loja/.test(M.corpo), M.corpo.slice(-1800));
  E3.form = { contaId: 'ct-c', observacao: '', lojas: '05, 28, 31, 77', ecs: '1454475, 1454476' };
  await M.acoes[1].acao({}); const gravado = E3.Repo.get('adq_contratos', id);
  chk('salvar o contrato grava as lojas e ECs do formulário (inclusive o que o usuário acrescentou à mão: loja 77)', igual(gravado.lojas, ['05', '28', '31', '77']) && igual(gravado.ecs, ['1454475', '1454476']) && gravado.contaId === 'ct-c', gravado);
  const E4 = cenario1({ g18: false }); E4.Adq14.abrirContrato(E4.Adq14.idContrato('SAFRAPAY', 'resilienza')); const M4 = E4.modais.at(-1);
  chk('recurso desligado: o modal é o da v14.17 (sem o botão Puxar e sem pré-preenchimento do Cadastro)', !/data-a18-puxar/.test(M4.corpo) && /name="lojas" value=""/.test(M4.corpo));
  /* novo contrato: pré-preenche pela adquirente + empresa informadas */
  const E5 = cenario1({ g18: true }); E5.Adq14.abrirContrato(null, { adquirente: 'GETNET', empresaId: 'mar-aberto' }); const M5 = E5.modais.at(-1);
  chk('novo contrato com Adquirente + Empresa já escolhidas (atalho "Vincular conta") nasce com as lojas e ECs do Cadastro', M5.titulo === 'Novo contrato' && /name="lojas" value="40"/.test(M5.corpo) && /name="ecs" value="13100535"/.test(M5.corpo), M5.corpo.slice(0, 500));
  /* "Puxar do Cadastro (todos)" */
  const E6 = cenario1({ g18: true }); await E6.Adq14.acao('a14-contratos-puxar-todos', { dataset: {} });
  const todos = E6.Adq14.contratos().map(c => [c.adquirente + '·' + c.empresaId, c.lojas, c.ecs]);
  chk('Puxar Lojas e ECs do Cadastro (todos): pede confirmação do impacto e atualiza todos os contratos de uma vez', E6.confirmou === 1 && igual(todos.find(x => x[0] === 'GETNET·mar-aberto')[1], ['40']) && igual(todos.find(x => x[0] === 'SAFRAPAY·resilienza')[1], ['05', '28', '31']), todos);
  const E7 = cenario1({ g18: true }); await E7.Adq14.acao('a14-contratos-puxar-todos', { dataset: {} }); const c1 = E7.confirmou; await E7.Adq14.acao('a14-contratos-puxar-todos', { dataset: {} });
  chk('rodar de novo, sem nada novo no Cadastro, só avisa que já está igual (não pede confirmação nem regrava)', E7.confirmou === c1 && E7.toasts.at(-1) === 'Todos os contratos já estão iguais ao Cadastro de Lojas', E7.toasts.at(-1));
}

/* =====================================================================
   2 · ITEM 2 · TAXA EFETIVA: Antecipação Efetiva (coluna da adquirente × apurada contra o OFX), tarifas de POS e retenções/chargebacks
   ===================================================================== */
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
{
  /* ---------- antecipação da Getnet: o extrato traz só Bruto e MDR → apurada no OFX ---------- */
  const E = await FX.cenario(), { Adq17, Adq14 } = E, est = E.res.k.antec;
  const dg = E.Adq18.diasGetnet(E.res);
  chk('dia a dia do repasse da Getnet reconstruído (bruto − MDR e antecipação estimada) fecha com o líquido esperado do motor em cada dia: base − antecipação = valor do dia', E.res.dias.length === dg.size && E.res.dias.every(d => dg.has(d.data) && perto(dg.get(d.data).base - dg.get(d.data).ant, d.valor, 0.02)), [...dg]);
  chk('cenário: lote Getnet com antecipação estimada pelo contrato > 0 (Visa 3x e Mastercard à vista antecipados) e líquido esperado do dia 06/01 menor que o bruto − MDR', est > 10 && E.e06 > 0, { est, e06: E.e06 });
  OFX_JAN(E); const I = Adq17.indicadores('2026-01', '*'), R = rowIdx(I, FX.CT.res), a = R.ant;
  chk('Getnet · OFX credita exatamente o líquido esperado em 06/01: Antecipação Efetiva APURADA = (bruto − MDR) − líquido creditado = estimativa do contrato, e nunca R$ 0,00', a.origem === 'apuracao-ofx' && perto(a.efetivoR, est, 0.02) && a.efetivoR > 0, a);
  chk('a linha diz de onde veio o número: "apurada no OFX", com o dia conferido e a ressalva de que o extrato da Getnet traz só Bruto e MDR', /apurada no OFX/.test(a.fonte) && /1 dia\(s\) de repasse conferido/.test(a.fonte) && /só Bruto e MDR/.test(a.fonte), a.fonte);
  chk('o dia 13/01 (débito, furo no OFX) fica fora da apuração e não infla a antecipação (não é dia de antecipação)', a.diasApurados === 1 && a.diasPendentes === 1 && perto(a.estimadaPendenteR, 0), a);
  const E17 = await FX.cenario({ g18: false }); OFX_JAN(E17); const a17 = rowIdx(E17.Adq17.indicadores('2026-01', '*'), FX.CT.res).ant;
  chk('RECURSO DESLIGADO (v14.17): a mesma situação mostra Antecipação R$ 0,00 sem origem — o defeito que a v14.18 corrige', a17.efetivoR === 0 && a17.origem === undefined && a17.fonte === 'ERP (Antecipação) × estimativa pelo contrato', a17);
  const S = rowIdx(I, FX.CT.saf).ant;
  chk('SafraPay: Antecipação Efetiva = coluna "Taxa de Antecipação" do arquivo de Recebíveis (R$ 71,00 exatos), origem "coluna da adquirente"', S.origem === 'coluna' && S.efetivoR === 71 && /coluna "Taxa de Antecipação"/.test(S.fonte), S);
  const cr = Adq17._o18.antDe.call(Adq17, { contrato: { adquirente: 'CREDSYSTEM' }, calc: { k: { antec: 12.5, bruto: 1000 } } }), cc = E.Adq18.antEfetiva({ contrato: { adquirente: 'CREDSYSTEM' }, calc: { k: { antec: 12.5, bruto: 1000 } } }, null);
  chk('Credsystem: Antecipação Efetiva = coluna "Antecipação" do ERP (Adq 304), origem "coluna"', cc.origem === 'coluna' && cc.efetivoR === 12.5 && /coluna "Antecipação" do ERP/.test(cc.fonte) && cr.efetivoR === 12.5, cc);
  chk('consolidado: fontes da antecipação por contrato (Getnet apurada no OFX + SafraPay coluna da adquirente) para o painel, o laudo e o CSV', I.consolidado.ant.fontes.length === 2 && I.consolidado.ant.fontes.some(f => f.origem === 'apuracao-ofx') && I.consolidado.ant.fontes.some(f => f.origem === 'coluna'), I.consolidado.ant.fontes);
  chk('Antecipação do consolidado = Getnet apurada + SafraPay do arquivo', perto(I.consolidado.ant.efetivoR, a.efetivoR + 71), { c: I.consolidado.ant.efetivoR });
}
{
  /* ---------- crédito a menor: o que o OFX mostra além da estimativa; tarifas/retenções do OFX explicam a diferença; virada de mês; sem OFX ---------- */
  const E = await FX.cenario(), { Adq17 } = E, est = E.res.k.antec;
  OFX_JAN(E, { credito: E.e06 - 40 }); let I = Adq17.indicadores('2026-01', '*'), a = rowIdx(I, FX.CT.res).ant;
  chk('OFX credita R$ 40,00 a menos que o esperado em 06/01 (sem tarifa que explique): Antecipação Efetiva Apurada = estimativa + R$ 40,00, com excesso sobre o contrato sinalizado', perto(a.efetivoR, est + 40, 0.03) && a.excessoR > 30 && a.origem === 'apuracao-ofx', { a, est });
  chk('o excesso aparece no ranking como "Antecipação acima do contrato" e como aviso do painel', I.ranking.some(x => x.tipo === 'ant'), I.ranking.map(x => x.tipo));
  OFX_JAN(E, { credito: E.e06 - 30, extras: [FX.tr('a2', '2026-01-07', -30, 'DEBITO ALUGUEL POS GETNET')] }); I = Adq17.indicadores('2026-01', '*'); a = rowIdx(I, FX.CT.res).ant;
  chk('crédito a menor de R$ 30,00 COM aluguel de POS de R$ 30,00 debitado na janela do repasse: a diferença é explicada pela tarifa e NÃO vira antecipação (sem dupla contagem)', perto(a.efetivoR, est, 0.03) && a.excessoR === 0 && /30\.00 de tarifas\/retenções do OFX descontados/.test(a.fonte), a);
  const c = I.consolidado;
  chk('o aluguel de POS entra uma vez, em "Tarifas e aluguel de POS", e a Taxa Efetiva Total soma MDR + antecipação + tarifas de POS + retenções', c.tarifas.posR === 30 && c.tarifas.nPos === 1 && perto(c.taxa.r, c.mdr.efetivoR + c.ant.efetivoR + c.tarifas.posR + c.tarifas.retencaoR, 0.02), { taxa: c.taxa, tarifas: c.tarifas });
  /* sem OFX algum e sem ERP: nunca R$ 0,00 */
  E.S.extratos.clear(); E.bump('extratos'); I = Adq17.indicadores('2026-01', '*'); a = rowIdx(I, FX.CT.res).ant;
  chk('sem OFX importado e sem ERP: a antecipação NÃO fica em R$ 0,00 — usa a estimativa pelo contrato e diz que é estimativa', a.origem === 'estimativa' && perto(a.efetivoR, est, 0.02) && /estimativa pelo contrato/.test(a.fonte), a);
  chk('há aviso no painel de que a antecipação da Getnet é estimada (sem repasse conferido no OFX)', I.avisos.some(t => /antecipação estimada pelo contrato/.test(t)), I.avisos);
}
{
  /* ---------- virada de mês: venda de 30/01 repassa em 02/02 ---------- */
  const E = await FX.cenario({ fimMes: true }), { Adq17 } = E, est = E.res.k.antec, dias = E.res.dias.map(d => d.data);
  chk('cenário de virada: o lote tem repasse antecipado em 02/02 (dia útil seguinte ao sábado 31/01 + D+1)', dias.includes('2026-02-02'), dias);
  const e0206 = E.res.dias.find(d => d.data === '2026-01-06').valor, e0202 = E.res.dias.find(d => d.data === '2026-02-02').valor;
  FX.ofx(E, [FX.docOfx('xa', 'ct-a', '2026-01', [FX.tr('a1', '2026-01-06', e0206, 'CREDITO GETNET LIQUIDACAO'), FX.tr('a9', '2026-01-20', -12, 'TARIFA MANUTENCAO CONTA')]), FX.docOfx('xc', 'ct-c', '2026-01', [])]);
  let I = Adq17.indicadores('2026-01', '*'), a = rowIdx(I, FX.CT.res).ant;
  chk('OFX de fevereiro ainda não importado: o repasse de 02/02 está em trânsito → entra pela estimativa do contrato, a origem diz "apurada no OFX + estimativa" e o aviso conta os dias', a.origem === 'apuracao-parcial' && a.estimadaPendenteR > 5 && a.diasPendentes >= 1 && perto(a.efetivoR, est, 0.03) && /trânsito\/virada de mês/.test(a.fonte), a);
  FX.ofx(E, [FX.docOfx('xa', 'ct-a', '2026-01', [FX.tr('a1', '2026-01-06', e0206, 'CREDITO GETNET LIQUIDACAO'), FX.tr('a9', '2026-01-20', -12, 'TARIFA MANUTENCAO CONTA')]), FX.docOfx('xa2', 'ct-a', '2026-02', [FX.tr('b1', '2026-02-02', e0202, 'CREDITO GETNET LIQUIDACAO')]), FX.docOfx('xc', 'ct-c', '2026-01', [])]);
  I = Adq17.indicadores('2026-01', '*'); a = rowIdx(I, FX.CT.res).ant;
  chk('com o OFX de fevereiro importado, o repasse da virada é conferido e passa a ser APURADO (nada fica estimado)', a.origem === 'apuracao-ofx' && a.diasApurados === 2 && a.estimadaPendenteR === 0 && perto(a.efetivoR, est, 0.03), a);
}
{
  /* ---------- leitor ampliado de débitos do OFX ---------- */
  const E = await FX.cenario(); const { Adq18, Adq14, AdqTaxas } = E, P = Adq14.padroes();
  const k = h => { const x = Adq18.classificarDebito({ h: ' ' + AdqTaxas.chave(h) + ' ', valor: -10 }, P); return x ? x.tipo : null; };
  const casos = [['DEBITO ALUGUEL POS GETNET', 'tarifa'], ['ALUGUEL MAQ SAFRA', 'tarifa'], ['TARIFA CARTAO MAQUINETA', 'tarifa'], ['MAQUINETA GETNET MENSAL', 'tarifa'], ['COMISSAO GETNET', 'tarifa'], ['MENSALIDADE POS CREDSYSTEM', 'tarifa'],
    ['CHARGEBACK GETNET', 'retencao'], ['ESTORNO CARTAO VENDA', 'retencao'], ['AJUSTE DEBITO ADQ', 'retencao'], ['RETENCAO CREDSYSTEM', 'retencao'], ['DEBITO GETNET', 'retencao'], ['CONTESTACAO CARTAO', 'retencao'],
    ['COMISSAO SERVICOS CONTABEIS', null], ['TARIFA MANUTENCAO CONTA', null], ['PIX ENVIADO FORNECEDOR', null], ['AJUSTE SALDO', null], ['ESTORNO PIX FORNECEDOR', null], ['PIX ENVIADO MAQUINETA JOAO', null], ['PIX ENVIADO GETNET SERVICOS', null]];
  const falhas = casos.filter(([h, t]) => k(h) !== t).map(([h, t]) => `${h}: esperado ${t}, veio ${k(h)}`);
  chk(`leitor de débitos do OFX: ${casos.length} históricos classificados (aluguel POS/MAQ, MAQUINETA, TARIFA CARTAO, COMISSAO com adquirente → tarifas de POS; RETENCAO, CHARGEBACK, ESTORNO, AJUSTE, DEBITO ADQ, débito que cita a adquirente → retenções; tarifa de conta, PIX e transferências ficam de fora)`, !falhas.length, falhas);
  chk('cada lançamento guarda o termo que o classificou (motivo), para o usuário conferir', Adq18.classificarDebito({ h: ' CHARGEBACK GETNET ', valor: -5 }, P).motivo === 'CHARGEBACK' && Adq18.classificarDebito({ h: ' ALUGUEL POS GETNET ', valor: -5 }, P).motivo === 'ALUGUEL POS');
}
{
  /* ---------- OFX do mês: as duas linhas separadas e somadas na taxa efetiva; painel, laudo e CSV mostram origem e leitura ---------- */
  const E = await FX.cenario(), { Adq17 } = E;
  OFX_JAN(E, { extras: [FX.tr('d1', '2026-01-08', -30, 'ALUGUEL MAQ GETNET'), FX.tr('d2', '2026-01-09', -8, 'COMISSAO GETNET'), FX.tr('d3', '2026-01-15', -20, 'CHARGEBACK GETNET'), FX.tr('d4', '2026-01-16', -15, 'ESTORNO CARTAO'), FX.tr('d5', '2026-01-17', -500, 'PIX ENVIADO FORNECEDOR'), FX.tr('d6', '2026-01-18', -25, 'ALUGUEL POS GETNET FEV'), FX.tr('d7', '2026-02-03', -99, 'ALUGUEL POS GETNET')] });
  const I = Adq17.indicadores('2026-01', '*'), c = I.consolidado, R = rowIdx(I, FX.CT.res);
  chk('OFX do mês: "Tarifas e aluguel de POS" = 30 + 8 + 25 = R$ 63,00 (3 lançamentos) e "Retenções / Chargebacks bancários" = 20 + 15 = R$ 35,00 (2 lançamentos); PIX a fornecedor e tarifa de conta ficam de fora; o aluguel de 03/02 não entra em janeiro', c.tarifas.posR === 63 && c.tarifas.nPos === 3 && c.tarifas.retencaoR === 35 && c.tarifas.nRet === 2 && c.tarifas.foraMesR === 99, c.tarifas);
  chk('Taxa Efetiva Total = MDR + Antecipação + Tarifas de POS + Retenções (as duas linhas do OFX somam)', perto(c.taxa.r, c.mdr.efetivoR + c.ant.efetivoR + 63 + 35, 0.02) && R.tarifaR === 63 && R.retencaoR === 35, { taxa: c.taxa });
  chk('os termos lidos aparecem na tela (ALUGUEL MAQ, COMISSAO, ALUGUEL POS; CHARGEBACK, ESTORNO)', c.tarifas.termosPos.includes('COMISSAO') && c.tarifas.termosPos.includes('ALUGUEL POS') && c.tarifas.termosRet.includes('CHARGEBACK') && c.tarifas.termosRet.includes('ESTORNO'), { p: c.tarifas.termosPos, r: c.tarifas.termosRet });
  const html18 = E.Adq17.renderPainel();
  chk('Painel: linhas "Tarifas e aluguel de POS" e "Retenções / Chargebacks bancários", com a origem da antecipação (apurada no OFX × coluna da adquirente) e a leitura dos lançamentos do OFX', /Retenções \/ Chargebacks bancários/.test(html18) && /Tarifas e aluguel de POS/.test(html18) && /apuração OFX|apurada no OFX/.test(html18) && /coluna da adquirente/.test(html18) && /3 lançamento\(s\) no OFX da conta do contrato/.test(html18), html18.length);
  const laudo = E.Adq17.htmlLaudo(I, { razao: 'Resilienza Negocios Ltda', cnpj: CNPJ_RES, marca: 'Esposende', emitidoEm: '17/11/2026', notas: '', signatarios: [] });
  chk('Laudo (Quadro 1): "Retenções / Chargebacks bancários (OFX)", origem da antecipação e termos lidos; o parecer sugerido cita a origem da antecipação', /Retenções \/ Chargebacks bancários \(OFX\)/.test(laudo) && /apurada no OFX/.test(laudo) && /3 lançamento\(s\) no OFX/.test(laudo) && /Origem da antecipação:/.test(E.Adq17.parecerSugerido(I)), laudo.length);
  E.Adq17.exportarCsv(); const csv = await E.baixados.at(-1)[1].text();
  chk('CSV: traz as linhas novas — origem da antecipação, "Tarifas e aluguel de POS", "Retenções / Chargebacks bancários" e a antecipação efetiva por contrato com a fonte', /origem: apurada no OFX · coluna da adquirente/.test(csv) && /Tarifas e aluguel de POS;63/.test(csv) && /Retenções \/ Chargebacks bancários;35/.test(csv) && /Contrato;GETNET · Resilienza;Antecipação efetiva;/.test(csv), csv.slice(0, 600));
  const E17 = await FX.cenario({ g18: false }); OFX_JAN(E17, { extras: [FX.tr('d3', '2026-01-15', -20, 'CHARGEBACK GETNET'), FX.tr('d1', '2026-01-08', -30, 'ALUGUEL MAQ GETNET')] });
  const h17 = E17.Adq17.renderPainel(), c17 = E17.Adq17.indicadores('2026-01', '*').consolidado;
  chk('RECURSO DESLIGADO: painel idêntico ao da v14.17 (sem "Chargebacks", sem "Saldo a Receber", sem origem) e sem os campos novos nos indicadores', !/Chargebacks|Saldo a Receber|apurada no OFX/.test(h17) && /Retenções bancárias/.test(h17) && c17.ant.fontes === undefined && c17.tarifas.nPos === undefined, { len: h17.length });
}

/* =====================================================================
   3 · ITEM 3 · SALDO A RECEBER DE ANTECIPAÇÕES / RECEBÍVEIS FUTUROS COM O ABATIMENTO MENSAL DAS TAXAS
   ===================================================================== */
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
{
  const E = await FX.cenario({ mcSemAnt: true, agendaSafra: true, fev: true }), { Adq17, Adq18, Adq14, Adq15 } = E, CT_CRED = 'adq-credsystem__emp-resilienza';
  E.S.adq_contratos.set(CT_CRED, { id: CT_CRED, adquirente: 'CREDSYSTEM', empresaId: 'resilienza', contaId: 'ct-a', ativo: true, lojas: ['01'] }); E.bump('adq_contratos');
  Adq15.ui.erp = { lido: Adq15.lerErpLinhas(FX3.erpRows(), 'Apuração dos Créditos jan.xlsx', 'ApuraCreditos') }; await Adq15.gravarErp(); await espera();
  OFX_JAN(E, { extras: [FX.tr('d1', '2026-01-08', -30, 'ALUGUEL MAQ GETNET'), FX.tr('d3', '2026-01-15', -20, 'CHARGEBACK GETNET')] });
  chk('corte do saldo: último dia do mês; no mês corrente (ainda em curso), hoje', Adq18.corteDe('2026-01') === '2026-01-31' && Adq18.corteDe('2026-11') === '2026-11-17');
  Adq17.indicadores('2026-01', '*'); const I = Adq17.indicadores('2026-01', '*'), S = Adq18.saldoReceber('2026-01', '*'); // a 1ª chamada estabiliza a revisão do motor (a v14.15 sobe _rev ao ver o ERP novo)
  const G = S.porContrato.find(x => x.id === FX.CT.res), SF = S.porContrato.find(x => x.id === FX.CT.saf), CS = S.porContrato.find(x => x.id === CT_CRED);
  chk('Getnet: saldo bruto = valor de FACE das parcelas depois do corte — a venda Mastercard à vista de R$ 2.000 (sem antecipação, paga em 04/02) entra inteira; o que já foi pago ou antecipado até o corte não entra', G && G.bruto === 2000 && G.parcelas === 1 && G.porMes['2026-02'] === 2000, G);
  chk('SafraPay: Recebíveis com pagamento depois do corte (150 + 120 + 40) a valor de face; a venda sem par na Agenda (NSU 9999) é assumida como vendida até o corte e avisada', SF && SF.bruto === 310 && SF.parcelas === 3 && SF.avisos.some(a => /sem a venda na Agenda/.test(a)), SF);
  chk('Credsystem: ERP com Dt Crédito depois do corte — 500 (crédito) − 100 (estorno DB) = 400; o já recebido em janeiro e a loja fora do contrato não entram', CS && CS.bruto === 400 && CS.parcelas === 2, CS);
  const c = S.consolidado, t = I.consolidado.taxa;
  chk('Saldo Bruto a Receber consolidado = Getnet 2.000 + SafraPay 310 + Credsystem 400 = R$ 2.710,00 (4 parcelas + 2 do ERP)', c.saldoBruto === 2710 && c.parcelas === 6, c);
  chk('(−) Taxas / Antecipação Cobradas no Mês = a Taxa Efetiva Total do Painel Executivo (MDR + antecipação efetiva + tarifas de POS + retenções), sem recálculo à parte', c.taxas.totalR === t.r && c.taxas.mdrR === t.mdrR && c.taxas.antR === t.antR && c.taxas.tarifaR === t.tarifaR && c.taxas.retencaoR === t.retencaoR && t.tarifaR === 30 && t.retencaoR === 20, { c: c.taxas, t });
  chk('(=) Saldo Líquido Disponível a Receber = Saldo Bruto − Taxas do mês, com a % abatida sobre o saldo', perto(c.saldoLiquido, 2710 - t.r) && perto(c.abatidoPct, t.r / 2710 * 100, 0.01), { c });
  chk('por contrato: saldo líquido = bruto − (MDR + antecipação + tarifas + retenções) do próprio contrato; a soma dos contratos fecha com o consolidado', S.porContrato.every(x => perto(x.liquido, x.bruto - x.taxas.mdrR - x.taxas.antR - x.taxas.tarifaR - x.taxas.retencaoR)) && perto(S.porContrato.reduce((s, x) => s + x.taxas.totalR, 0), t.r, 0.03), S.porContrato.map(x => [x.rotulo, x.bruto, x.taxas.totalR, x.liquido]));
  chk('recebíveis futuros por mês de pagamento: fevereiro R$ 2.710,00 (tudo vence depois de janeiro)', S.porMes['2026-02'] === 2710 && Object.keys(S.porMes).length === 1, S.porMes);
  chk('abatimento mensal: a série traz a competência com MDR, antecipação, tarifas, retenções, total e % do bruto — o mesmo total do Painel', S.serie.length >= 1 && S.serie[0].mes === '2026-01' && S.serie[0].totalR === t.r && S.serie[0].pct === t.pct, S.serie);
  chk('a memória do painel (indicadores) não é estragada pelo cálculo da série de meses: a chamada seguinte devolve o mesmo objeto, sem recalcular', Adq17.indicadores('2026-01', '*') === I, Adq17._memo?.v);
  const S2 = Adq18.saldoReceber('2026-02', '*');
  chk('em fevereiro a série mostra as duas competências (fev e jan) e o abatimento de janeiro permanece o mesmo', S2.serie.length === 2 && S2.serie[1].mes === '2026-01' && S2.serie[1].totalR === t.r, S2.serie.map(x => [x.mes, x.totalR]));
  const SG = Adq18.saldoReceber('2026-01', FX.CT.res);
  chk('filtro por contrato (Getnet Resilienza): só o saldo e as taxas desse contrato', SG.porContrato.length === 1 && SG.consolidado.saldoBruto === 2000 && SG.consolidado.taxas.totalR === Adq17.indicadores('2026-01', FX.CT.res).consolidado.taxa.r, SG.consolidado);
  const calcG = E.res, face = calcG.lote.grupos.filter(g => g.mod !== 'debito').every(g => perto(Adq18.parcelasGetnet(g, 'GETNET', 'resilienza').reduce((s, [, v]) => s + v, 0), g.bruto, 0.02));
  chk('as parcelas que o saldo projeta somam o valor de face de cada venda (nenhum centavo perdido na divisão em parcelas)', face);
  const html = Adq17.renderPainel();
  chk('Painel: controle "Saldo a Receber de Antecipações / Recebíveis Futuros" com o card Saldo Bruto (−) Taxas/Antecipação Cobradas no Mês (=) Saldo Líquido Disponível a Receber, a tabela por contrato e a série do abatimento mensal', /Saldo a Receber de Antecipações \/ Recebíveis Futuros/.test(html) && /Saldo Bruto a Receber/.test(html) && /\(−\) Taxas \/ Antecipação Cobradas no Mês/.test(html) && /\(=\) Saldo Líquido Disponível a Receber/.test(html) && /Abatimento mensal das taxas/.test(html) && /Recebíveis futuros por mês de pagamento/.test(html), html.length);
  const laudo = Adq17.htmlLaudo(I, { razao: 'Resilienza Negocios Ltda', cnpj: CNPJ_RES, marca: 'Esposende', emitidoEm: '17/11/2026', notas: '', signatarios: [] });
  chk('Laudo A4: Quadro 5 — Saldo a Receber e Abatimento Mensal das Taxas, com os mesmos números do painel', /Quadro 5 — Saldo a Receber/.test(laudo) && laudo.includes(E.DFC_RESUMO.brl(c.saldoLiquido)) && laudo.includes(E.DFC_RESUMO.brl(c.saldoBruto)), laudo.length);
  Adq17.exportarCsv(); const csv = await E.baixados.at(-1)[1].text();
  chk('CSV: blocos "Saldo a receber" e "Abatimento mensal" com bruto, taxas e líquido', /Saldo a receber;[^;]*;Saldo bruto a receber;2710/.test(csv) && /\(=\) Saldo líquido disponível a receber/.test(csv) && /Abatimento mensal;/.test(csv), csv.split('\n').filter(l => /receber|Abatimento/.test(l)).join('\n'));
  /* recurso desligado: nada disso aparece */
  const E17 = await FX.cenario({ g18: false, mcSemAnt: true }); OFX_JAN(E17);
  chk('RECURSO DESLIGADO: sem o controle de saldo a receber no painel e no laudo (v14.17)', !/Saldo a Receber de Antecipações/.test(E17.Adq17.renderPainel()) && !/Quadro 5/.test(E17.Adq17.htmlLaudo(E17.Adq17.indicadores('2026-01', '*'), { razao: 'X', cnpj: CNPJ_RES, marca: 'E', emitidoEm: '', notas: '', signatarios: [] })));
}

/* =====================================================================
   4 · ITEM 4 · AUDITORIA × DFC (categoria dos créditos auditados, Previsto pelo Líquido Esperado, Reconciliação de Recebíveis de Cartões no Resumo Executivo A4)
   ===================================================================== */
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
{
  const E = await cenario4(), { DFC, Adq14, Adq17, Adq18, FluxoDFC } = E, tr = FluxoDFC.trDFC(), por = id => tr.find(t => t.id === id), cat = id => CAT(E, por(id));
  const A = Adq14.auditar('2026-01', '*');
  chk('cenário: a Auditoria casa, só pelo valor, os créditos genéricos do OFX com os repasses da Getnet (06/01 e 13/01), da SafraPay (06 e 07/01) e da Credsystem (12/01)', A.cruz.linhas.filter(l => l.status === 'ok').length === 5 && ['xa|a1', 'xa|a2', 'xa|a3', 'xc|c0', 'xc|c1'].every(id => A.cruz.usados.has(id)), A.cruz.linhas.map(l => [l.adq, l.data, l.status]));
  chk('SEM a v14.18 o extrato não diz de quem são: o crédito de TED genérico cai em "Outras entradas operacionais" (padrão)', ['a1', 'a2', 'a3', 'c0', 'c1', 'a4'].every(id => { const r = DFC._o18.classificar.call(DFC, por(id)); return r.categoria === 'rec_outros' && r.origem === 'padrão'; }));
  chk('crédito casado pela Auditoria com Getnet / SafraPay → "Recebimento de cartões (adquirentes)", com a origem "Auditoria de Adquirentes" e o nome da adquirente', ['a1', 'a2', 'c0', 'c1'].every(id => cat(id).categoria === 'rec_cartoes' && cat(id).origem === 'auditoria_cartoes') && cat('a1').adquirente === 'GETNET' && cat('c0').adquirente === 'SAFRAPAY', ['a1', 'a2', 'c0', 'c1'].map(id => cat(id)));
  chk('crédito casado com o repasse da Credsystem → "Recebimento Credsystem" (categoria própria)', cat('a3').categoria === 'rec_credsystem' && cat('a3').origem === 'auditoria_cartoes' && cat('a3').adquirente === 'CREDSYSTEM', cat('a3'));
  chk('crédito que a Auditoria NÃO casou (777,77) continua em "Outras entradas operacionais" — a categoria só vem do casamento, nunca de palpite', cat('a4').categoria === 'rec_outros' && cat('a4').origem === 'padrão');
  const c = DFC.consolidar(tr), c17 = DFC._o18.consolidar.call(DFC, tr);
  chk('DFC do mês (consolidar): Recebimento de cartões R$ 8.212,98 (4 lançamentos) e Recebimento Credsystem R$ 300,00; sobra R$ 777,77 em Outras entradas', perto(c.porCategoria.rec_cartoes.valor, 8212.98) && c.porCategoria.rec_cartoes.n === 4 && c.porCategoria.rec_credsystem.valor === 300 && c.porCategoria.rec_outros.valor === 777.77, c.porCategoria);
  chk('a reclassificação só MOVE valores entre categorias: entradas, saídas e variação líquida são IGUAIS às da v14.17 (nada some, nada duplica)', c.entradas === c17.entradas && c.saidas === c17.saidas && c.liquido === c17.liquido && c.n === c17.n && perto(c17.porCategoria.rec_outros.valor, c.porCategoria.rec_outros.valor + 8212.98 + 300), { c: c.liquido, c17: c17.liquido });
  chk('"sem regra": os créditos reclassificados deixam de contar como lançamentos sem regra (só o de R$ 777,77 e as saídas sem regra permanecem)', c17.semRegra - c.semRegra === 5, { c: c.semRegra, c17: c17.semRegra });
  chk('o contador de sobreposição volta a zero e fora da leitura da DFC o classificar devolve a classificação ORIGINAL (o Conciliador de Meios de Pagamento e a própria Auditoria não enxergam a sobreposição)', DFC._ov18 === 0 && DFC.classificar(por('a1')).categoria === 'rec_outros' && DFC.classificar(por('a1')).origem === 'padrão');
  /* nada de circularidade: a Auditoria lê a classificação original; rodar a DFC antes ou depois não muda o casamento */
  const sig = () => JSON.stringify(Adq14.auditar('2026-01', '*').cruz.linhas.map(l => [l.adq, l.data, l.esperado, l.creditado, l.status, l.creditos.map(x => x.id)]));
  const antes = sig(); E.Adq14._memoA = null; DFC.consolidar(tr); E.Adq14._memoA = null; const depois = sig();
  chk('sem circularidade: o casamento da Auditoria é idêntico antes e depois de a DFC ser consolidada com a sobreposição', antes === depois);
  const I = Adq17.indicadores('2026-01', '*'); DFC.consolidar(tr);
  chk('a DFC não estraga a memória do Painel Executivo de Cartões (indicadores devolve o mesmo objeto, sem recalcular)', Adq17.indicadores('2026-01', '*') === I);
  let nAud = 0; const aud0 = Adq14.auditar; Adq14.auditar = function () { nAud++; return aud0.apply(this, arguments); };
  DFC.consolidar(tr); DFC.consolidar(tr); Adq14.auditar = aud0;
  chk('as competências são auditadas uma única vez: consolidar de novo não refaz a Auditoria (memória própria, reconstruída só quando uma base muda)', nAud === 0, nAud);
  E.S.extratos.get('xa').transacoes.push({ id: 'a5', data: '2026-01-20', valor: 10, hist: 'TED RECEBIDA 5' }); E.bump('extratos');
  nAud = 0; Adq14.auditar = function () { nAud++; return aud0.apply(this, arguments); }; DFC.consolidar(FluxoDFC.trDFC()); Adq14.auditar = aud0;
  chk('mudou o extrato (novo OFX): a memória é reconstruída e a Auditoria é refeita', nAud >= 1, nAud);
}
{
  /* exceções: a classificação do usuário e a regra específica sempre prevalecem */
  const E = await cenario4({ extras: [FX.tr('m1', '2026-01-16', 50, 'CREDITO MANUAL')] }), { DFC, Adq14, FluxoDFC } = E;
  E.S.extratos.get('xa').transacoes.find(t => t.id === 'a2').cat = 'rec_pix'; E.bump('extratos');
  let tr = FluxoDFC.trDFC(), por = id => tr.find(t => t.id === id);
  chk('classificação MANUAL do usuário prevalece sobre a Auditoria (crédito casado com a Getnet marcado como PIX recebido fica em PIX)', CAT(E, por('a2')).categoria === 'rec_pix' && CAT(E, por('a2')).origem === 'manual' && Adq14.auditar('2026-01', '*').cruz.usados.has('xa|a2'), CAT(E, por('a2')));
  const E2 = await cenario4(); E2.S.extratos.get('xa').transacoes.find(t => t.id === 'a2').hist = 'PIX RECEB CLIENTE X'; E2.bump('extratos'); tr = E2.FluxoDFC.trDFC();
  chk('regra EXPLÍCITA para uma categoria específica (PIX recebidos) prevalece: o crédito casado pela Auditoria continua em PIX', CAT(E2, tr.find(t => t.id === 'a2')).categoria === 'rec_pix' && CAT(E2, tr.find(t => t.id === 'a2')).origem === 'regra' && E2.Adq14.auditar('2026-01', '*').cruz.usados.has('xa|a2'), CAT(E2, tr.find(t => t.id === 'a2')));
  const E3 = await cenario4({ regras: [{ id: 'r-x', termos: ['CREDITO DIVERSOS'], sentido: 'E', categoria: 'rec_outros' }, ...E.DFC_REGRAS_PADRAO] }); tr = E3.FluxoDFC.trDFC();
  chk('regra que manda o crédito para "Outras entradas operacionais" não segura: o que a Auditoria casou vai para a categoria dos cartões', CAT(E3, tr.find(t => t.id === 'a2')).categoria === 'rec_cartoes' && CAT(E3, tr.find(t => t.id === 'a2')).de === 'regra');
  tr = E.FluxoDFC.trDFC();
  chk('o crédito que já era "Recebimento de cartões" por regra (histórico com GETNET) segue com a origem da regra, sem a marca da Auditoria', (() => { const e = E.S.extratos.get('xa').transacoes; e.find(t => t.id === 'a1').hist = 'CREDITO GETNET LIQUIDACAO'; E.bump('extratos'); const t = E.FluxoDFC.trDFC().find(x => x.id === 'a1'); return CAT(E, t).categoria === 'rec_cartoes' && CAT(E, t).origem === 'regra'; })());
  const E4 = await cenario4({ cfg: { classificar: false } }); tr = E4.FluxoDFC.trDFC();
  chk('chave "Categoria dos créditos auditados: como no extrato": nenhum crédito é reclassificado (comportamento da v14.17 nas categorias)', tr.every(t => CAT(E4, t).origem !== 'auditoria_cartoes') && E4.DFC.consolidar(tr).porCategoria.rec_cartoes === undefined);
  const E5 = await cenario4({ g18: false }); tr = E5.FluxoDFC.trDFC();
  chk('RECURSO DESLIGADO: DFC idêntica à da v14.17 (nenhuma sobreposição, mesma consolidação e mesma lista de Extratos)', tr.every(t => CAT(E5, t).origem !== 'auditoria_cartoes') && igual(E5.DFC.consolidar(tr), E5.DFC._o18.consolidar.call(E5.DFC, tr)) && E5.DFC.consolidar(tr).porCategoria.rec_cartoes === undefined);
  chk('Extratos OFX: o crédito reclassificado mostra "Auditoria" + adquirente na coluna de origem, em vez de "sem regra"', /Auditoria<\/span> GETNET/.test(E.FluxoDFC.origemRot05({ origem: 'auditoria_cartoes', adquirente: 'GETNET' })) && !/Auditoria/.test(E5.FluxoDFC.origemRot05({ origem: 'padrão' })) && /sem regra/.test(E5.FluxoDFC.origemRot05({ origem: 'padrão' })));
}
{
  /* ---------- PREVISTO: Líquido Esperado da Auditoria por data de repasse, com a chave do FCX ---------- */
  const SEM_CARTAO = { '2026-01-10': { entradas: { 'venda:pix': 500 }, saidas: {} } }, COM_CARTAO = { '2026-01-10': { entradas: { 'venda:pix': 500, 'venda:credito': 10000 }, saidas: {} } };
  const E = await cenario4({ fcx: SEM_CARTAO }), { Cruzamento, Adq18 } = E, lin = (c, id) => c.linhas.find(l => l.id === id);
  const P = Adq18.previstoCartoes('2026-01');
  chk('Líquido Esperado da Auditoria em janeiro, por data de repasse: cartões R$ 8.212,98 (Getnet 5.735,18 + 99,10 · SafraPay 1.262,50 + 1.116,20) e Credsystem R$ 300,00 (os R$ 500 de 05/02 ficam para fevereiro)', perto(P.rec_cartoes.valor, 8212.98) && P.rec_credsystem.valor === 300 && P.rec_cartoes.itens.some(([k]) => /GETNET · vendas de/.test(k)) && P.rec_cartoes.itens.some(([k]) => /SAFRAPAY · vendas de/.test(k)), P);
  let c = Cruzamento.calcular('2026-01');
  chk('FCX sem meta específica de cartões, modo padrão ("auto"): as linhas de cartões mostram o Líquido Esperado da Auditoria como PREVISTO, com o realizado da DFC e a diferença', perto(lin(c, 'rec_cartoes').previsto, 8212.98) && lin(c, 'rec_cartoes').fontePrev18 === 'auditoria' && perto(lin(c, 'rec_cartoes').realizado, 8212.98) && lin(c, 'rec_cartoes').dif === 0 && lin(c, 'rec_cartoes').favoravel && lin(c, 'rec_credsystem').previsto === 300 && lin(c, 'rec_credsystem').realizado === 300, c.linhas.map(l => [l.id, l.previsto, l.realizado]));
  chk('a composição do previsto lista as vendas de origem (adquirente · vendas de janeiro); PIX do FCX segue como o FCX entregou', lin(c, 'rec_cartoes').itens.length >= 2 && lin(c, 'rec_pix').previsto === 500 && !lin(c, 'rec_pix').fontePrev18, lin(c, 'rec_cartoes').itens);
  chk('o total de receitas previstas passa a incluir o previsto dos cartões e a taxa de realização é recalculada', perto(c.receitas.previsto, 500 + 8212.98 + 300) && c.receitas.taxa != null && c.previstoAud18.length === 2, c.receitas);
  chk('as linhas continuam na ordem das categorias da DFC (cartões, Credsystem, PIX…)', c.linhas.map(l => l.id).join() === ['rec_cartoes', 'rec_credsystem', 'rec_pix', 'rec_outros'].filter(id => lin(c, id)).join(), c.linhas.map(l => l.id));
  E.fcx(COM_CARTAO); c = Cruzamento.calcular('2026-01');
  chk('FCX COM meta específica de cartões (R$ 10.000): modo "auto" mantém o previsto do FCX — a Auditoria só entra onde o FCX não tem meta', lin(c, 'rec_cartoes').previsto === 10000 && !lin(c, 'rec_cartoes').fontePrev18 && lin(c, 'rec_credsystem').fontePrev18 === 'auditoria', c.linhas.map(l => [l.id, l.previsto, l.fontePrev18]));
  E.S.config.set('dfc_cartoes18', { id: 'dfc_cartoes18', modoPrevisto: 'sempre' }); E.bump('config'); c = Cruzamento.calcular('2026-01');
  chk('modo "sempre": o Líquido Esperado da Auditoria substitui até a meta do FCX (cartões R$ 8.212,98 no lugar de R$ 10.000) e o total de receitas acompanha', perto(lin(c, 'rec_cartoes').previsto, 8212.98) && lin(c, 'rec_cartoes').previstoFcx18 === 10000 && perto(c.receitas.previsto, 500 + 10000 + 8212.98 - 10000 + 300), c.receitas);
  E.S.config.set('dfc_cartoes18', { id: 'dfc_cartoes18', modoPrevisto: 'fcx' }); E.bump('config'); const cF = Cruzamento.calcular('2026-01');
  chk('modo "fcx": só o FCX (v14.17) — nenhuma linha usa a Auditoria', cF.linhas.every(l => !l.fontePrev18) && !cF.previstoAud18 && lin(cF, 'rec_cartoes').previsto === 10000, cF.linhas.map(l => [l.id, l.previsto]));
  const E17 = await cenario4({ g18: false, fcx: SEM_CARTAO }), c17 = E17.Cruzamento.calcular('2026-01');
  chk('RECURSO DESLIGADO: Realizado × Previsto idêntico ao da v14.17 (cartões sem previsto, realizado em Outras entradas)', c17.linhas.every(l => !l.fontePrev18) && !lin(c17, 'rec_cartoes') && perto(lin(c17, 'rec_outros').realizado, 8212.98 + 300 + 777.77) && igual(c17, E17.Cruzamento._o18.calcular.call(E17.Cruzamento, '2026-01')), c17.linhas.map(l => [l.id, l.previsto, l.realizado]));
  /* virada de mês: o repasse de 05/02 da Credsystem vem de vendas de janeiro */
  E.S.config.delete('dfc_cartoes18'); E.bump('config'); E.fcx(SEM_CARTAO); const P2 = Adq18.previstoCartoes('2026-02');
  chk('fevereiro: o Líquido Esperado inclui o repasse de 05/02 (R$ 500) que nasceu de vendas de janeiro — as parcelas de competências anteriores entram no previsto do mês em que caem', P2.rec_credsystem && P2.rec_credsystem.valor === 500 && /vendas de/.test(P2.rec_credsystem.itens[0][0]), P2);
  /* exportações dizem de onde veio */
  E.fcx(SEM_CARTAO); E.FluxoDFC.ui.mes = '2026-01'; E.FluxoDFC._czDados = null; const m = E.FluxoDFC.modeloExport('cruzamento');
  chk('Excel/CSV/PDF do Realizado × Previsto: o cabeçalho diz "Previsto FCX / Auditoria" e as linhas de cartões saem com "previsto pela Auditoria" na Leitura', m.cab[3] === 'Previsto FCX / Auditoria (R$)' && m.linhas.some(r => /Recebimento de cartões/.test(r[1]) && /previsto pela Auditoria/i.test(r[7])) && m.blocos.some(b => b.ls.some(l => l.fontePrev18 && /previsto pela Auditoria/.test(b.leit(l)))), m.linhas.filter(r => /cartões|Credsystem/.test(r[1])));
  const m17 = E17.FluxoDFC.modeloExport('cruzamento');
  chk('com o recurso desligado as exportações são as da v14.17 (sem menção à Auditoria)', m17.cab[3] === 'Previsto FCX (R$)' && !m17.linhas.some(r => /Auditoria/i.test(String(r[7]))));
}
{
  /* ---------- faixa da DFC (painel) e chave de configuração ---------- */
  const E = await cenario4({ fcx: { '2026-01-10': { entradas: { 'venda:pix': 500 }, saidas: {} } } }), { FluxoDFC } = E; FluxoDFC.ui.mes = '2026-01'; FluxoDFC.ui.sub = 'cruzamento';
  const h = FluxoDFC.painelCartoes18();
  chk('faixa "Auditoria de Adquirentes × DFC": diz quantos lançamentos e quanto foi para cada categoria, o Líquido Esperado do mês e traz as duas chaves (categoria dos créditos × fonte do previsto)', /Auditoria de Adquirentes × DFC/.test(h) && /4 lançamento\(s\) → Recebimento de cartões/.test(h) && /1 lançamento\(s\) → Recebimento Credsystem/.test(h) && /Líquido Esperado da Auditoria por data de repasse/.test(h) && /data-a="fd-cartoes-cfg" data-k="classificar"/.test(h) && /data-a="fd-cartoes-cfg" data-k="modo"/.test(h), h.slice(0, 600));
  E.pode = k => k !== 'fcx.dfc.regras';
  const hv = FluxoDFC.painelCartoes18();
  chk('quem não pode editar as regras da DFC vê o estado atual, sem as chaves', /Previsto dos cartões: /.test(hv) && !/data-a="fd-cartoes-cfg"/.test(hv), hv.slice(0, 300));
  FluxoDFC.ui.sub = 'extratos'; chk('a faixa só aparece nas abas Realizado × Previsto e DFC do mês', FluxoDFC.painelCartoes18() === ''); FluxoDFC.ui.sub = 'dfc';
  E.pode = null; const hd = FluxoDFC.painelCartoes18(); chk('aba "DFC do mês" também mostra a faixa', /Auditoria de Adquirentes × DFC/.test(hd));
  const E17 = await cenario4({ g18: false }); E17.FluxoDFC.ui.mes = '2026-01'; chk('RECURSO DESLIGADO: nenhuma faixa', E17.FluxoDFC.painelCartoes18() === '');
  E.gravacoes.length = 0; E.bases.length = 0; E.toasts.length = 0; E.pode = null;
  await FluxoDFC.salvarCfg18('modo', 'sempre');
  chk('trocar a fonte do previsto grava config/dfc_cartoes18 (auditado) e regrava a base mensal da DFC (dfc/AAAA-MM) com a classificação vigente', E.S.config.get('dfc_cartoes18')?.modoPrevisto === 'sempre' && E.gravacoes.some(g => g.c === 'config' && g.id === 'dfc_cartoes18' && /DFC × Auditoria/.test(g.aud.rotulo)) && E.bases.length === 1 && E.bases[0].includes('2026-01'), { cfg: E.S.config.get('dfc_cartoes18'), bases: E.bases });
  await FluxoDFC.salvarCfg18('classificar', '0');
  chk('desligar a categoria dos créditos auditados também grava e preserva a outra chave', E.S.config.get('dfc_cartoes18')?.classificar === false && E.S.config.get('dfc_cartoes18')?.modoPrevisto === 'sempre');
  E.pode = k => k !== 'fcx.dfc.regras'; E.gravacoes.length = 0; E.toasts.length = 0; await FluxoDFC.salvarCfg18('modo', 'fcx');
  chk('sem a permissão fcx.dfc.regras nada é gravado e o usuário é avisado', E.gravacoes.length === 0 && E.toasts.some(t => /não pode alterar/.test(t)) && E.S.config.get('dfc_cartoes18').modoPrevisto === 'sempre');
}
{
  /* ---------- RESUMO EXECUTIVO OFICIAL A4 · Quadro 3 — Reconciliação de Recebíveis de Cartões (Auditoria × Caixa OFX) ---------- */
  const E = await cenario4({ fcx: { '2026-01-10': { entradas: { 'venda:pix': 500 }, saidas: {} } } }), { DFC_RESUMO, FluxoDFC, Adq17, Adq18 } = E, per = DFC_RESUMO.periodo('mes', '2026-01');
  const I = Adq17.indicadores('2026-01', '*'), C = I.consolidado, e = FluxoDFC.dadosResumo06(per, null), q = e.cartoes18;
  const creditosCasados = 5735.18 + 99.10 + 300 + 1262.5 + 1116.2;
  chk('Resumo: os dados do emissor trazem a reconciliação da Auditoria (bruto, taxas efetivas, líquido esperado, ponte e total creditado)', !!q && q.nContratos === 3 && q.adquirentes.join() === 'CREDSYSTEM,GETNET,SAFRAPAY', q);
  chk('competência = os MESMOS números do Painel Executivo de Cartões: bruto, MDR efetivo, antecipação efetiva, tarifas de POS e retenções; Líquido Esperado = bruto − taxas', q.bruto === C.bruto.base && q.mdrR === C.mdr.efetivoR && q.antR === C.ant.efetivoR && q.tarifaR === C.tarifas.posR && q.retencaoR === C.tarifas.retencaoR && perto(q.liquido, C.bruto.base - C.taxa.r, 0.02), { q, c: C.taxa });
  chk('caixa = o que a Auditoria casou no OFX com data no período: R$ 8.512,98 em 5 créditos (o de R$ 777,77 sem par não entra)', perto(q.creditado, creditosCasados) && q.nCreditos === 5, { cr: q.creditado, n: q.nCreditos });
  const p = q.ponte;
  chk('a ponte FECHA ao centavo: Líquido Esperado + virada − trânsito − dias sem OFX ± divergências ± outras = Total Creditado no OFX', perto(q.liquido + p.viradaR - p.transitoR - p.semOfxR + p.divergenciaR + p.outrasR, q.creditado, 0.011) && perto(p.totalR, q.creditado - q.liquido, 0.011), p);
  chk('trânsito: o repasse da Credsystem de 05/02 (R$ 500) é esperado para depois do período e aparece como a receber; não há virada (sem competência anterior) nem dia sem OFX', p.transitoR === 500 && p.viradaR === 0 && p.semOfxR === 0 && p.divergenciaR === 0, p);
  chk('"outras diferenças" = Líquido Esperado da Auditoria − (bruto − taxas efetivas): o resíduo é explicado, não escondido', perto(p.outrasR, p.teoricaOutrasR, 0.02), p);
  const m = DFC_RESUMO.montar(e), nota = 'Nota da controladoria.', corpo = DFC_RESUMO.html(m, { razao: 'Resilienza Negocios Ltda', cnpj: CNPJ_RES, logo: '', marca: 'Esposende', emitidoEm: '17/11/2026', notas: nota, signatarios: [{ nome: 'A', cargo: 'B' }, { nome: 'C', cargo: 'D' }] });
  chk('A4: novo "Quadro 3 — Reconciliação de Recebíveis de Cartões (Auditoria × Caixa OFX)" entre o Quadro 2 e as notas, que passam a ser o Quadro 4', m.cartoes18 === q && corpo.indexOf('Quadro 2 —') < corpo.indexOf('Quadro 3 — Reconciliação de Recebíveis de Cartões (Auditoria × Caixa OFX)') && corpo.indexOf('Quadro 3 — Reconciliação') < corpo.indexOf('Quadro 4 — Notas Explicativas') && !/Quadro 3 — Notas/.test(corpo), corpo.match(/Quadro \d — [^<]*/g));
  const L = ['Faturamento bruto de cartões na competência', '(−) MDR efetivo', '(−) Antecipação efetiva', '(−) Tarifas e aluguel de POS / retenções e chargebacks', '(=) Líquido esperado na competência', '(+/−) Virada de mês / trânsito e divergências', '(=) Total creditado no OFX (casado pela Auditoria)'];
  chk('A4: as linhas do quadro na ordem pedida (Faturamento Bruto → MDR → Antecipação → Tarifas POS/Retenções → Líquido Esperado → Virada de Mês/Trânsito e Divergências → Total Creditado no OFX)', L.every(t => corpo.includes(t)) && L.map(t => corpo.indexOf(t)).every((x, i, a) => i === 0 || x > a[i - 1]), L.map(t => corpo.indexOf(t)));
  chk('A4: os valores do quadro são os do cálculo (bruto, líquido esperado e total creditado formatados em R$) e há a explicação do trânsito', corpo.includes(DFC_RESUMO.brl(q.bruto)) && corpo.includes(DFC_RESUMO.brl(q.liquido)) && corpo.includes(DFC_RESUMO.brl(q.creditado)) && /A receber depois do período \(trânsito\)/.test(corpo) && corpo.includes(DFC_RESUMO.brl(-500)), corpo.length);
  const g = m.quadro2.grupos.find(x => x.grupo === 'OPERACIONAL'), lc = g.linhas.find(l => l.id === 'rec_cartoes'), ls = g.linhas.find(l => l.id === 'rec_credsystem');
  chk('Quadro 2 do A4: Recebimento de cartões e Credsystem com REALIZADO (OFX) e PREVISTO (Auditoria, FCX sem meta para eles) lado a lado; sem diferença', lc && perto(lc.realizado, 8212.98) && perto(lc.previsto, 8212.98) && ls && ls.realizado === 300 && ls.previsto === 300, g.linhas.map(l => [l.id, l.realizado, l.previsto]));
  const eS = FluxoDFC.dadosResumo06(per, { ids: ['ct-c'], todas: false }), qs = eS.cartoes18;
  chk('escopo de contas (só a conta C da SafraPay): a reconciliação considera só o contrato e os créditos dessa conta', qs.nContratos === 1 && qs.adquirentes.join() === 'SAFRAPAY' && perto(qs.creditado, 1262.5 + 1116.2) && qs.nCreditos === 2 && qs.bruto === I.contratos.find(r => r.id === FX.CT.saf).bruto.base, qs);
  chk('o escopo "todas as contas" equivale a sem escopo', igual(FluxoDFC.dadosResumo06(per, { ids: ['ct-a', 'ct-c'], todas: true }).cartoes18, q));
  const per2 = DFC_RESUMO.periodo('mes', '2026-02'); E.S.extratos.set('xa2', FX.docOfx('xa2', 'ct-a', '2026-02', [FX.tr('f1', '2026-02-05', 500, 'TED RECEBIDA 77')])); E.bump('extratos');
  const q2 = FluxoDFC.dadosResumo06(per2, null).cartoes18;
  chk('fevereiro (sem vendas de cartões no mês, só o repasse de 05/02 de janeiro): o crédito de R$ 500 entra como virada de mês e o total creditado do período é R$ 500', q2 && q2.ponte.viradaR === 500 && perto(q2.creditado, 500) && perto(q2.liquido + q2.ponte.viradaR - q2.ponte.transitoR - q2.ponte.semOfxR + q2.ponte.divergenciaR + q2.ponte.outrasR, q2.creditado, 0.011), q2 && q2.ponte);
  const perT = DFC_RESUMO.periodo('trimestre', '2026-03'), qt = FluxoDFC.dadosResumo06(perT, null).cartoes18;
  chk('trimestre (jan a mar): o repasse de 05/02 deixa de ser "a receber" e "virada": já está dentro do período; a ponte continua fechando', qt && qt.ponte.transitoR === 0 && qt.ponte.viradaR === 0 && perto(qt.creditado, creditosCasados + 500) && perto(qt.liquido + qt.ponte.viradaR - qt.ponte.transitoR - qt.ponte.semOfxR + qt.ponte.divergenciaR + qt.ponte.outrasR, qt.creditado, 0.011), qt && { p: qt.ponte, c: qt.creditado });
  E.S.extratos.get('xc').transacoes.length = 0; E.bump('extratos'); const qx = FluxoDFC.dadosResumo06(per, null).cartoes18;
  chk('sem OFX da conta da SafraPay: os repasses esperados ficam em "dias de repasse sem OFX" (não são furo), com aviso, e a ponte segue fechando', qx.ponte.semOfxR + qx.ponte.divergenciaR !== 0 && qx.avisos.some(a => /sem OFX importado/.test(a)) && perto(qx.liquido + qx.ponte.viradaR - qx.ponte.transitoR - qx.ponte.semOfxR + qx.ponte.divergenciaR + qx.ponte.outrasR, qx.creditado, 0.011), qx.ponte);
  const E17 = await cenario4({ g18: false, fcx: { '2026-01-10': { entradas: { 'venda:pix': 500 }, saidas: {} } } }), e17 = E17.FluxoDFC.dadosResumo06(DFC_RESUMO.periodo('mes', '2026-01'), null), m17 = E17.DFC_RESUMO.montar(e17);
  const corpo17 = E17.DFC_RESUMO.html(m17, { razao: 'X', cnpj: CNPJ_RES, logo: '', marca: 'E', emitidoEm: '', notas: nota, signatarios: [{ nome: 'A', cargo: 'B' }, { nome: 'C', cargo: 'D' }] });
  chk('RECURSO DESLIGADO: o Resumo Executivo é o da v14.17 (sem cartoes18, sem o quadro novo, notas ainda no Quadro 3, previsto só do FCX)', e17.cartoes18 === undefined && m17.cartoes18 === undefined && !/Reconciliação de Recebíveis/.test(corpo17) && /Quadro 3 — Notas Explicativas/.test(corpo17) && !m17.quadro2.grupos.find(x => x.grupo === 'OPERACIONAL').linhas.some(l => l.id === 'rec_cartoes'), m17.quadro2.grupos.find(x => x.grupo === 'OPERACIONAL').linhas.map(l => l.id));
  const E0 = await cenario4({}); E0.Adq14.contratos().forEach(c => E0.S.adq_contratos.delete(c.id)); E0.bump('adq_contratos');
  chk('sem contratos de cartões (ou sem Auditoria) o Resumo não ganha quadro vazio e não quebra', E0.FluxoDFC.dadosResumo06(DFC_RESUMO.periodo('mes', '2026-01'), null).cartoes18 == null);
}

/* =====================================================================
   5 · DOCUMENTAÇÃO, VERSÃO E RECURSO
   ===================================================================== */
{
  const readme = fs.readFileSync(path.join(raiz, 'README.md'), 'utf8'), i18 = readme.indexOf('## v14.18'), i17 = readme.indexOf('## v14.17'), sec = readme.slice(i18, i17);
  chk('README: "Versão v14.18." na abertura e a seção "## v14.18" vem antes da v14.17, com o recurso gestao_v1418, os quatro itens, o aviso dos nomes de categoria e os limites', /Versão v14\.18\./.test(readme) && i18 > 0 && i18 < i17 && /gestao_v1418/.test(sec) && ['Item 1', 'Item 2', 'Item 3', 'Item 4', 'rec_cartoes', 'rec_credsystem', 'Limites a saber'].every(t => sec.includes(t)), sec.slice(0, 200));
  chk('README: a seção documenta o Quadro 3 do A4, o Quadro 5 do Laudo, o seletor do Previsto (auto / sempre / FCX) e que o fcx.html não foi alterado', /Quadro 3 — Reconciliação de Recebíveis de Cartões/.test(sec) && /Quadro 5/.test(sec) && /dfc_cartoes18/.test(sec) && /fcx\.html[^.]*não foram alterados|não foram alterados/.test(sec));
  chk('recurso gestao_v1418 cadastrado na lista de recursos (v14.18) e dependente da gestao_v1417 (g18 = recurso && g17)', /gestao_v1418: \{ versao: 'v14\.18'/.test(html) && /function g18\(\) \{[^}]*Recursos\.ativo\('gestao_v1418'\) && g17\(\)/.test(html));
  chk('o painel anuncia a versão v14.18 no cabeçalho', /v14\.18/.test(html.match(/id="versao"[^>]*>[^<]*/)?.[0] || '') || /VERSAO\s*=\s*'v14\.18'|versao:\s*'v14\.18'/.test(html) || /v14\.18 · /.test(html));
}

console.log(`\n${OK.length} ok · ${FAIL.length} falha(s)`);
if (FAIL.length) { console.log('FALHAS:\n - ' + FAIL.join('\n - ')); process.exit(1); }
