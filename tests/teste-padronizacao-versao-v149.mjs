/* v14.9 · PADRONIZAÇÃO DE VERSÃO + AUDITORIA DE ENTREGA (código interno v14.19.2, recurso gestao_v1419).
   O rótulo VISUAL da versão passa a ser "v14.9" (selo do cabeçalho, quadro "Versões dos Ambientes", alerta e telas de liberação), sem mexer no que o banco já tem:
   o id do recurso segue gestao_v1419 e a versão INTERNA ('v14.19') segue ordenando/comparando versões. Daqui para a frente: v15.1, v15.2, v15.3 …
   (sem zero à esquerda: "v15.01" e "v15.1" dariam o mesmo número na ordenação).
   Também confere, no HTML entregue, que as 6 funcionalidades da v14.19.2 estão no código e ligadas (a prova de uso é o roteiro de navegador e o teste de unidade da v14.19.2). */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(raiz, 'public/index.html'), 'utf8');
const md5 = b => crypto.createHash('md5').update(b).digest('hex');
const OK = [], FAIL = [];
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (x && !c ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 600) : '')); };
const corta = (a, b) => { const i = html.indexOf(a); if (i < 0) throw new Error('âncora não encontrada: ' + a); const j = html.indexOf(b, i); if (j < 0) throw new Error('fim não encontrado: ' + b); return html.slice(i, j + b.length); };

/* ------------- objetos reais do painel (Recursos, Versoes) montados em Node com dublês mínimos ------------- */
const mk = (homolog, amb = 'homolog', doc = null) => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const Ambiente = { homolog, rc: amb === 'rc', id: amb, producao: amb === 'prod', atual: { banco: 'DB_X' } };
  const Repo = { get: () => doc };
  const AMBIENTES = [{ id: 'prod', banco: 'DB_Esposende_Prod' }, { id: 'homolog', banco: 'DB_Esposende_Homolog' }, { id: 'rc', banco: 'DB_Falco' }];
  const Fmt = { dataHora: () => '01/01/2026 10:00' };
  const cod = corta('const Recursos = {', '\n};\n') + '\n' + corta('const Versoes = {', '\n};\n') + '\nreturn { Recursos, Versoes };';
  return new Function('Ambiente', 'Repo', 'AMBIENTES', 'esc', 'Fmt', 'Auth', 'Cloud', 'UI', cod)(Ambiente, Repo, AMBIENTES, esc, Fmt, {}, {}, {});
};

/* ================= 1 · rótulo exibido x versão interna ================= */
{
  const { Recursos: R } = mk(true);
  const f = R.LISTA.gestao_v1419;
  chk('o recurso segue com o id gestao_v1419 e a versão INTERNA "v14.19" (a ativação já gravada no banco é preservada)', !!f && f.versao === 'v14.19', f && f.versao);
  chk('nenhum recurso novo foi criado para o rótulo (nada de gestao_v149 / v14_9 na lista de liberação)', !Object.keys(R.LISTA).some(k => /v149|v14_9\b/.test(k)), Object.keys(R.LISTA).filter(k => /149|14_9/.test(k)));
  chk('rot("v14.19") = "v14.9" e as demais versões não mudam (v14.18, v14.15.1, v13.64 …)', R.rot('v14.19') === 'v14.9' && R.rot('v14.18') === 'v14.18' && R.rot('v14.15.1') === 'v14.15.1' && R.rot('v13.64') === 'v13.64' && R.rot('v14.09') === 'v14.09' && R.rot(null) === null && R.rot('') === '', [R.rot('v14.19'), R.rot('v14.09')]);
  chk('POR QUE o valor interno não foi trocado: "v14.9" e a antiga "v14.09" dão o MESMO número de ordenação (14009000) — a Homologação passaria a exibir uma versão menor que a v14.18', R.num('v14.9') === R.num('v14.09') && R.num('v14.9') < R.num('v14.18') && R.num('v14.19') > R.num('v14.18'), [R.num('v14.9'), R.num('v14.09'), R.num('v14.18'), R.num('v14.19')]);
  chk('padrão novo: v15.1 > v14.19 e v15.10 > v15.9 (ordem certa, sem zero à esquerda); "v15.01" e "v15.1" colidiriam — por isso o padrão é v15.1, v15.2 …', R.num('v15.1') > R.num('v14.19') && R.num('v15.10') > R.num('v15.9') && R.num('v15.2') > R.num('v15.1') && R.num('v15.01') === R.num('v15.1'), [R.num('v15.1'), R.num('v15.01'), R.num('v15.10'), R.num('v15.9')]);
  chk('a ordem das versões segue pela versão interna: Homologação (todos os recursos) = v14.19; documento sem a gestao_v1419 = v14.18; com ela = v14.19', R.versaoDoc(null, true) === 'v14.19' && R.versaoDoc({}) === 'v13.64'
    && R.versaoDoc(Object.fromEntries(Object.keys(R.LISTA).filter(k => k !== 'gestao_v1419').map(k => [k, { ativo: true }]))) === 'v14.18'
    && R.versaoDoc(Object.fromEntries(Object.keys(R.LISTA).map(k => [k, { ativo: true }]))) === 'v14.19');
  chk('pendências: com a gestao_v1419 desligada na Produção a versão pendente é "v14.19" (interna), exibida como "v14.9"', R.pendentesDoc(Object.fromEntries(Object.keys(R.LISTA).filter(k => k !== 'gestao_v1419').map(k => [k, { ativo: true }]))).join() === 'v14.19');
}

/* ================= 2 · telas: selo do cabeçalho, quadro de versões, alerta ================= */
{
  const H = mk(true, 'homolog'), full = Object.fromEntries(Object.keys(H.Recursos.LISTA).map(k => [k, { ativo: true }])), semNova = Object.fromEntries(Object.keys(H.Recursos.LISTA).filter(k => k !== 'gestao_v1419').map(k => [k, { ativo: true }]));
  const txt = h => h.replace(/<[^>]+>/g, '').trim();
  chk('selo do cabeçalho na Homologação: "v14.9 · Homologação" (texto e aria-label)', txt(H.Versoes.badge()) === 'v14.9 · Homologação' && /aria-label="Versão v14\.9 · Homologação\./.test(H.Versoes.badge()), H.Versoes.badge());
  const P1 = mk(false, 'prod', full), P0 = mk(false, 'prod', semNova), F1 = mk(false, 'rc', full);
  chk('selo na Produção: com a gestao_v1419 liberada mostra "v14.9 · Produção"; sem ela continua "v14.18 · Produção"; na Falco liberada mostra "v14.9 · Falco"', txt(P1.Versoes.badge()) === 'v14.9 · Produção' && txt(P0.Versoes.badge()) === 'v14.18 · Produção' && txt(F1.Versoes.badge()) === 'v14.9 · Falco', [txt(P1.Versoes.badge()), txt(P0.Versoes.badge()), txt(F1.Versoes.badge())]);
  const quadro = H.Versoes.html({ prod: { versao: 'v14.18', pend: ['v14.19'] }, homolog: { versao: 'v14.19', pend: [] }, rc: { versao: 'v14.18', pend: ['v14.19'] } });
  chk('quadro "Versões dos Ambientes": Homologação "v14.9", Produção "v14.18"; o alerta de liberação lista "v14.9" (nunca "v14.19") com a descrição do recurso', /ver-tag homolog">v14\.9</.test(quadro) && /ver-tag prod">v14\.18</.test(quadro) && /<b>v14\.9<\/b> · /.test(quadro) && !/>v14\.19</.test(quadro) && /atualiza/i.test(quadro), quadro.slice(0, 600));
  const cod = html;
  chk('a tela "Liberar Versão em Produção" (nota, confirmação, aviso, auditoria) usa o rótulo: Recursos.rot() em vProd/vHom/vRc e em ver.de/ver.para; o valor gravado (_versao) continua o interno', cod.includes('Produção <b>${esc(Recursos.rot(vProd))}</b> → <b>${esc(Recursos.rot(vHom))}</b>') && cod.includes('esc(Recursos.rot(ver.de))') && cod.includes('`Versão ${Recursos.rot(ver.para)} liberada em Produção') && cod.includes('_versao: ver.para'));
  const flag = (/gestao_v1419: \{ versao: 'v14\.19', titulo: '([^']*)'/.exec(html) || [])[1] || '';
  chk('o texto do recurso (tela de liberação) não carrega mais números longos tipo "v14.19.1" / "v14.19.2" e continua descrevendo os 6 itens', !/v14\.19\.\d/.test(flag) && /Sem movimento/i.test(flag) && /Realizado/.test(flag) && /horizontal/i.test(flag) && /lote/i.test(flag) && /progresso/i.test(flag), flag.slice(-400));
}

/* ================= 3 · auditoria estática do HTML ENTREGUE: as 6 funcionalidades estão no código e atrás da flag ================= */
{
  const has = (t, n) => (html.split(t).length - 1) >= (n || 1);
  chk('flag: g19() = recurso gestao_v1419 && g18() (depende da v14.18) — a ativação existente continua valendo', html.includes("function g19() { return typeof Recursos !== 'undefined' && Recursos.ativo('gestao_v1419') && g18(); }"));
  chk('1 · Sem movimento no mês: botão a19-semmov / desfazer, documento com semMovimento: true, bruto e líquido 0 e contagem no Nível 1 (nImportados / semMov)', has('data-a="a19-semmov"') && has('data-a="a19-semmov-desfazer"') && /semMovimento: true/.test(html) && /Sem movimento no mês/.test(html) && /nImportados/.test(html) && /limparConflitos/.test(html));
  chk('2 · DFC só com o Realizado: quem estava na sub-aba "cruzamento" cai em "dfc", o botão da sub-aba é removido com g19(), o Quadro 2 do Resumo tem temPrevisto = false e a exportação da DFC do mês tem só Grupo / Linha / Lançamentos / Valor', html.includes("if (u && u.sub === 'cruzamento') u.sub = 'dfc';") && html.includes('data-a="fd-sub" data-v="cruzamento">[^<]*<\\/button>/, \'\')') && /temPrevisto/.test(html) && html.includes("cab: ['Grupo', 'Linha', 'Lançamentos', 'Valor (R$)']"));
  chk('3 · Relatório DFC Horizontal — Mês a Mês: formato no Resumo Executivo, montagem, gerarResumo08 com Matriz, A4 paisagem, Excel e CSV', has('Horizontal — Mês a Mês') && /gerarHorizontal19/.test(html) && /montarHorizontal19/.test(html) && /gerarResumo08: FluxoDFC\.gerarResumo08/.test(html) && /landscape/.test(html) && /DFC_Horizontal/.test(html));
  chk('4 · exportação completa do Extrato OFX: tabela marcada com data-tp-fonte19="extratos", dados completos (dadosExtratosCompleto19) e o texto "todas as páginas"', has('data-tp-fonte19') && /dadosExtratosCompleto19/.test(html) && /todas as páginas/.test(html));
  chk('5 · Ajuste em Lote: motor DFC_LOTE19, as 3 travas (uma conta, arquivo inteiro recusado, categoria inexistente mantida) e a mensagem exata da trava 1', /const DFC_LOTE19 = \{/.test(html) && html.includes('Selecione uma única conta bancária antes de exportar para ajuste em lote.') && /alertaTravaLote19/.test(html) && /relatorioLote19/.test(html) && /naoExiste|não existe no plano da DFC/.test(html));
  const cargas = corta('(function ligarCargas19() {', '/* ---- fim das ligações do ModalProgressoCarga v14.19.2 · Item 6 ---- */');
  chk('6 · ModalProgressoCarga: componente global + ligado a OFX (importarOFX), ERP (lerErpUpload / gravarErp), Adquirentes (lerUpload / gravarLote), Agenda SafraPay (gravarAgenda), Baixas CNAB (lerPagto17 / gravarPagto17) e Ajuste em Lote (importarLote19)', /const ModalProgressoCarga = \{/.test(html) && /FluxoDFC\.importarOFX = function/.test(cargas) && /envolverLeitura\(Adq15, 'lerErpUpload'/.test(cargas) && /envolverLeitura\(Adq14, 'lerUpload'/.test(cargas) && /M\.envolver\(Adq15, 'gravarErp'/.test(cargas) && /M\.envolver\(Adq14, 'gravarLote'/.test(cargas) && /M\.envolver\(Adq15, 'gravarAgenda'/.test(cargas) && /FluxoDFC\.lerPagto17 = function/.test(cargas) && /M\.envolver\(FluxoDFC, 'gravarPagto17'/.test(cargas) && /M\.executar\('Importando ajuste em lote…'/.test(html));
  chk('6 · o modal é central e bloqueante (fundo fixo, alertdialog), tem cronômetro e botão Cancelar (desabilitado, com explicação, nas gravações que não podem parar no meio)', /\.mpc19-fundo\{[^}]*position:fixed/.test(html) && /role="alertdialog"/.test(html) && /mpc19-tempo/.test(html) && /data-mpc19="cancelar"/.test(html) && /Esta etapa não pode ser interrompida com segurança/.test(html));
  chk('Agenda SafraPay (lacuna achada na auditoria): o botão "Gravar agenda" chama Adq15.gravarAgenda direto e agora essa função roda no modal ("Gravando a Agenda de Vendas (SafraPay)…", não cancelável)', /data-a="a15-agenda-gravar"/.test(html) && /if \(a === 'a15-agenda-gravar'\) return this\.gravarAgenda\(\)/.test(html) && /titulo: 'Gravando a Agenda de Vendas \(SafraPay\)…', cancelavel: false/.test(cargas));
}

/* ================= 4 · Regra de Ouro, backend inalterado, documentação ================= */
{
  for (const [f, h] of [['fcx.html', '640800e0'], ['contabilidade.html', 'a41642fb'], ['contabilidade_v1391.html', 'ea73d20b']]) { const p = path.join(raiz, 'public', f); chk(`Regra de Ouro: public/${f} idêntico (md5 ${h}…)`, fs.existsSync(p) && md5(fs.readFileSync(p)).startsWith(h)); }
  const dir = path.join(raiz, 'netlify'), arquivos = []; const anda = d => { for (const n of fs.readdirSync(d).sort()) { const p = path.join(d, n); fs.statSync(p).isDirectory() ? anda(p) : arquivos.push(p); } }; anda(dir);
  const arv = md5(arquivos.sort().map(p => `${md5(fs.readFileSync(p))}  ${path.relative(raiz, p)}\n`).join(''));
  chk('backend: a pasta netlify/ continua idêntica (hash da árvore cb32b8fe…) — a v14.9 é só front-end e documentação', arv === 'cb32b8fe3fe06942204154125efa039d', arv);
  for (const [f, h] of [['netlify.toml', '3b1eff0f'], ['package.json', '83f1e078']]) chk(`${f} idêntico (md5 ${h}…)`, md5(fs.readFileSync(path.join(raiz, f))).startsWith(h));
  const rd = fs.readFileSync(path.join(raiz, 'README.md'), 'utf8');
  chk('README: abre com "Versão v14.9" e traz a seção "## v14.9" com a correspondência (código v14.19.2, flag gestao_v1419), o motivo do valor interno, o novo padrão (v15.1, v15.2…) e a lacuna da Agenda SafraPay', /^Versão v14\.9 /m.test(rd) && /## v14\.9 ·/.test(rd) && /v14\.19\.2/.test(rd) && /gestao_v1419/.test(rd) && /v15\.1/.test(rd) && /v15\.2/.test(rd) && /v14\.09/.test(rd) && /Agenda/.test(rd) && /Regra de Ouro/.test(rd), rd.length);
}

console.log(`\n${OK.length} ok · ${FAIL.length} falha(s)`);
if (FAIL.length) { console.log('\nFALHAS:\n - ' + FAIL.join('\n - ')); process.exit(1); }
