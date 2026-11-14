/* v14.12 · Lote 2 de melhorias. Valida o CÓDIGO REAL do painel (public/index.html) e do servidor (netlify/lib) num contexto isolado do Node,
   sem navegador e sem banco, só com dados FICTÍCIOS (LGPD; CPF/CNPJ de exemplo gerados aqui pelos dígitos verificadores):
   1) recurso gestao_v1412 e Regra de Ouro (fcx.html, contabilidade.html e contabilidade_v1391.html idênticos aos da v14.08);
   2) Férias: estimativa (férias + 1/3 + abono pecuniário + 50% do 13º), calendário (clique, grade, marcação), regras da CLT (14 + 5 + 5, máx. 3 períodos) e a prévia só
      para quem vê o salário;
   3) Organograma: roteamento de Férias/Folgas para o gestor do topo do ramo mesmo sem "Gestor direto"; salários só da própria árvore (painel e servidor);
   4) Viagens: aprovação delegada (viagens.aprovar + Financeiro), autoaprovação bloqueada, Loja nunca aprova; recurso desligado = regra de antes;
   5) Notificações: resumo curto de WhatsApp e e-mail completo (painel = servidor), PDF anexado ou referenciado, ClickBus para Ônibus;
   6) Recibos por IA: leitura (foto e PDF), normalização, política/período/teto e duplicidade (hash, cupom, CNPJ + data + valor);
   7) Devolução × OFX: conferência do comprovante, cruzamento (±R$ 0,05 + data/nome), encerramento sem OFX com justificativa e Log de Auditoria.
   (A varredura de segredos do pacote é feita na entrega, fora deste arquivo: nenhum segredo é escrito aqui, nem como padrão de busca.)
   Fluxos de tela (modal de férias, câmera, cartões) e o banco real ficam no teste de navegador e no teste do servidor com banco, fora deste teste rápido.
   Uso: node tests/teste-lote2-1412.mjs (roda em segundos) */
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
const objeto = nome => corta(`const ${nome} = {`, '\n};') + '\n};';
const mk = (nomes, corpo, ret) => (...vals) => new Function(...nomes, `${corpo}\nreturn ${ret};`)(...vals);
const dobra = async f => { try { await f(); return null; } catch (e) { return e; } };

const srv = await import('../netlify/lib/arvore-rh.mjs'), sv = await import('../netlify/lib/viagem-1412.mjs'), nv = await import('../netlify/lib/notif-viagem-1412.mjs');

/* ---------- 1 · recurso e Regra de Ouro ---------- */
chk('recurso gestao_v1412 na lista de liberação (v14.12) e helper g12()', /gestao_v1412: \{ versao: 'v14\.12'/.test(html) && /function g12\(\) \{ return typeof Recursos !== 'undefined' && Recursos\.ativo\('gestao_v1412'\); \}/.test(html));
for (const [f, h] of [['fcx.html', '0c13655f'], ['contabilidade.html', 'a41642fb'], ['contabilidade_v1391.html', 'ea73d20b']]) {
  const p = path.join(raiz, 'public', f);
  chk(`Regra de Ouro: public/${f} idêntico ao da v14.08 (md5 ${h}…)`, fs.existsSync(p) && md5(fs.readFileSync(p)).startsWith(h));
}
chk('nenhuma peça deixou marcador de montagem no painel final', !/@@V1412_/.test(html));

/* ---------- 2 · Férias ---------- */
const Datas = mk([], objeto('Datas'), 'Datas')();
const fer = mk(['Datas', 'window'], `const Cal12 = ${corta('const Cal12 = {', 'window.Cal12 = Cal12;').slice('const Cal12 = '.length)}\nconst Ferias12 = { DIAS_ABONO: 10, NOTA: 'nota', ${corta('  estimar({ salario, periodos', '  NOTA:')} };`, '{ Cal12, Ferias12 }')(Datas, {});
{
  const estimar = a => fer.Ferias12.estimar(a), v = (x, y = 0.006) => Math.abs(x) < y;
  const a = estimar({ salario: 3000, periodos: [{ dias: 15 }, { dias: 15 }], abono: false, antecipa13: false });
  chk('estimativa sem abono e sem 13º: 30 dias de R$ 3.000,00 → férias R$ 3.000,00 + 1/3 R$ 1.000,00 = R$ 4.000,00', a.ok && a.ferias === 3000 && a.terco === 1000 && a.total === 4000 && a.dias === 30, a);
  const b = estimar({ salario: 3000, periodos: [{ dias: 20 }], abono: true, antecipa13: true });
  chk('estimativa com abono (10 dias vendidos) e 50% do 13º: férias 20 d R$ 2.000,00 + 1/3 R$ 666,67 + abono R$ 1.000,00 + 1/3 do abono R$ 333,33 + 13º R$ 1.500,00 = R$ 5.500,00', b.ok && b.ferias === 2000 && b.terco === 666.67 && b.abono === 1000 && b.abonoTerco === 333.33 && b.decimo === 1500 && b.total === 5500 && b.linhas.length === 5, b);
  const c = estimar({ salario: 2500, periodos: [{ inicio: '2026-12-01', fim: '2026-12-14' }, { inicio: '2027-01-10', fim: '2027-01-15' }], abono: false, antecipa13: true });
  chk('estimativa aceita períodos com início e fim (14 + 6 = 20 dias) e soma a 1ª parcela do 13º (R$ 1.250,00)', c.ok && c.dias === 20 && c.decimo === 1250 && c.total === Math.round((c.ferias + c.terco + c.decimo) * 100) / 100, c);
  chk('sem salário cadastrado a estimativa não inventa valor', estimar({ salario: 0, periodos: [{ dias: 10 }] }).ok === false && estimar({ salario: null, periodos: [] }).motivo === 'sem-salario');
  const d = estimar({ salario: 1234.56, periodos: [{ dias: 7 }, { dias: 7 }], abono: true, antecipa13: false });
  chk('arredondamento em centavos e total = soma das linhas', v(d.total - d.linhas.reduce((s, [, x]) => s + x, 0)) && Number.isInteger(Math.round(d.total * 100)), d);
}
{
  const { Cal12 } = fer;
  chk('calendário: 1º clique abre o período, 2º fecha; clicar antes do início recomeça; clicar com período fechado recomeça', JSON.stringify(Cal12.clicar({}, '2026-12-10')) === '{"inicio":"2026-12-10","fim":""}' && Cal12.clicar({ inicio: '2026-12-10', fim: '' }, '2026-12-24').fim === '2026-12-24' && Cal12.clicar({ inicio: '2026-12-10', fim: '' }, '2026-12-05').inicio === '2026-12-05' && Cal12.clicar({ inicio: '2026-12-10', fim: '2026-12-24' }, '2027-01-03').fim === '');
  const g = Cal12.grade(2026, 11), dias = g.filter(Boolean);
  chk('calendário: dezembro/2026 tem 31 dias, começa numa terça-feira (2 células vazias) e fecha semanas de 7', dias.length === 31 && g.length % 7 === 0 && g.slice(0, 2).every(x => x === null) && g[2] === '2026-12-01');
  const m = Cal12.marca('2026-12-12', [{ inicio: '2026-12-01', fim: '2026-12-14' }, { inicio: '2027-01-10', fim: '' }]);
  chk('calendário: marca o período, o início e o fim; período aberto marca só o dia', m.i === 0 && !m.ini && !m.fim && Cal12.marca('2026-12-01', [{ inicio: '2026-12-01', fim: '2026-12-14' }]).ini === true && Cal12.marca('2026-12-14', [{ inicio: '2026-12-01', fim: '2026-12-14' }]).fim === true && Cal12.marca('2027-01-10', [{ inicio: '2027-01-10', fim: '' }]).i === 0 && Cal12.marca('2026-11-01', []).i === -1);
}
{
  const Lib = new Function('Datas', `return { LIM_FERIAS: 30, ABONO_DIAS: 10, MIN_PRINCIPAL: 14, MIN_DEMAIS: 5, MAX_PERIODOS: 3, ${corta('  validarFerias(periodos', '\n  },')}\n } };`)(Datas), hoje = '2026-11-10';
  const val = (ps, ab = false) => Lib.validarFerias(ps.map(([i, f]) => ({ inicio: i, fim: f })), { abono: ab, hoje });
  chk('CLT: 15 + 15 passa; 14 + 8 + 8 passa; 20 + 10 passa; 3 períodos no máximo', val([['2026-12-01', '2026-12-15'], ['2027-02-01', '2027-02-15']]).ok && val([['2026-12-01', '2026-12-14'], ['2027-02-01', '2027-02-08'], ['2027-04-01', '2027-04-08']]).ok && val([['2026-12-01', '2026-12-20'], ['2027-02-01', '2027-02-10']]).ok && !val([['2026-12-01', '2026-12-08'], ['2027-02-01', '2027-02-08'], ['2027-04-01', '2027-04-08'], ['2027-06-01', '2027-06-08']]).ok);
  chk('CLT: nenhum período com 14 dias ou mais é recusado; demais períodos com menos de 5 dias também', !val([['2026-12-01', '2026-12-10'], ['2027-02-01', '2027-02-10']]).ok && !val([['2026-12-01', '2026-12-20'], ['2027-02-01', '2027-02-04']]).ok);
  chk('abono pecuniário: o gozo cai para 20 dias; 30 dias de gozo com abono é recusado', val([['2026-12-01', '2026-12-20']], true).ok && !val([['2026-12-01', '2026-12-15'], ['2027-02-01', '2027-02-15']], true).ok && val([['2026-12-01', '2026-12-20']], true).limite === 20);
}
{
  const est = mk(['esc', 'Org12', 'Repo', 'FolhaLoja', 'Liberacao', 'Fmt', 'ferias'], `const Ferias12 = { NOTA: 'NOTA-ESTIMATIVA', estimar: a => ferias.estimar(a),\n${corta('  estimativaHtml(f, ent, ab, a13) {', '  /** Quem pode abrir o pedido')} };`, 'Ferias12')
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])), Fmt = { brl: n => 'R$ ' + Number(n).toFixed(2).replace('.', ',') };
  const L = { validarFerias: ent => ({ ok: true, periodos: ent.map(p => ({ ...p, dias: p.dias })) }) }, F = { salario: () => ({ valor: 3000 }) };
  const com = est(esc, { salarioVisivel: () => true }, { prontas: new Set(['salarios']) }, F, L, Fmt, fer.Ferias12).estimativaHtml({ id: 'f1' }, [{ dias: 20 }], true, true);
  const sem = est(esc, { salarioVisivel: () => false }, { prontas: new Set(['salarios']) }, F, L, Fmt, fer.Ferias12).estimativaHtml({ id: 'f1' }, [{ dias: 20 }], true, true);
  chk('prévia no modal: quem vê o salário recebe a tabela com o total (R$ 5500,00) e a nota de estimativa bruta; datas e abono entram no cálculo', /R\$ 5500,00/.test(com) && /NOTA-ESTIMATIVA/.test(com) && /Abono pecuniário/.test(com) && /1ª parcela do 13º/.test(com), com);
  chk('prévia no modal: quem NÃO vê o salário não recebe nenhum valor (nem total, nem linhas), só o aviso', !/R\$/.test(sem) && /indisponível/.test(sem) && !/5500/.test(sem), sem);
}

/* ---------- 3 · Organograma: roteamento e salários ---------- */
const funcs = [{ id: 'D', nome: 'Diretor' }, { id: 'G', nome: 'Gerente Financeiro', departamentoId: 'dfin' }, { id: 'X', nome: 'Analista Contas a Pagar', departamentoId: 'dcp' }, { id: 'Z', nome: 'Analista Contas a Receber', departamentoId: 'dcr' },
  { id: 'Y', nome: 'Vendedor Comercial', departamentoId: 'dcom' }, { id: 'M', nome: 'Gerente Comercial', departamentoId: 'dcom' }, { id: 'S', nome: 'Sem Gestor (outro ramo)', departamentoId: 'dcom', gestorId: '' }];
const deps = [{ id: 'dfin', nome: 'Gestão Financeira', responsavelId: 'G', paiId: '' }, { id: 'dcp', nome: 'Contas a Pagar', paiId: 'dfin' }, { id: 'dcr', nome: 'Contas a Receber', paiId: 'dfin' }, { id: 'dcom', nome: 'Comercial', responsavelId: 'M', paiId: '' }];
const nos = new Map(), pai = new Map(), no = (id, fid, filhos = []) => { nos.set(id, { id, fid, filhos }); filhos.forEach(f => pai.set(f, id)); };
no('root', null, ['f:D', 'f:M']); no('f:D', 'D', ['f:G']); no('f:G', 'G', ['d:dcp', 'd:dcr']); no('d:dcp', null, ['f:X']); no('d:dcr', null, ['f:Z']); no('f:X', 'X'); no('f:Z', 'Z'); no('f:M', 'M', ['f:Y', 'f:S']); no('f:Y', 'Y'); no('f:S', 'S');
const ctx = { me: 'G', globalSal: false, loja: false };
const arvoreDe = id => srv.arvoreDe(funcs, deps, id);
const org = mk(['Repo', 'Organograma', 'Auth', 'Pessoal', 'g12', 'Acesso', 'window'], `${corta('const Org12 = {', 'window.Org12 = Org12;')}`, 'Org12')(
  { versao: () => 1, get: (c, id) => funcs.find(f => f.id === id) }, { pronto: () => true, montar: () => ({ pai, nos }) },
  { get usuario() { return { funcionarioId: ctx.me }; }, get id() { return 'u1'; }, can: p => p === 'pessoal.salario.ver' && ctx.globalSal }, { arvoreDe }, () => true, { loja: () => ctx.loja }, {});
chk('roteamento: o analista de Contas a Pagar SEM gestor direto sobe para o Gerente Financeiro (imediato) e para o Diretor (topo do ramo)', JSON.stringify(org.rota('X')) === '{"cadeia":["G","D"],"imediato":"G","topo":"D"}' && JSON.stringify(org.rota('Z').cadeia) === '["G","D"]', org.rota('X'));
chk('roteamento: o Gerente Financeiro e o Diretor decidem Férias e Folgas de TODOS os subordinados (Contas a Pagar e a Receber); ninguém decide o próprio pedido', org.ehAprovadorDe('G', 'X') && org.ehAprovadorDe('G', 'Z') && org.ehAprovadorDe('D', 'X') && !org.ehAprovadorDe('X', 'X') && !org.ehAprovadorDe('G', 'G'));
chk('roteamento: colegas e outros ramos NÃO decidem (analista × analista; Gerente Comercial × Financeiro; Gerente Financeiro × Comercial)', !org.ehAprovadorDe('Z', 'X') && !org.ehAprovadorDe('M', 'X') && !org.ehAprovadorDe('G', 'Y') && !org.ehAprovadorDe('X', 'G'));
chk('roteamento: o ramo comercial vai para o Gerente Comercial; quem não tem superior no organograma volta para o Master (rota vazia)', org.rota('Y').imediato === 'M' && org.rota('D').imediato === '' && org.rotulo('D') === 'Sem superior no organograma: decide o Master.' && org.rota('Y').cadeia.every(x => typeof x === 'string'));
chk('roteamento: descendentes do Gerente Financeiro = analistas das duas áreas (e só eles)', [...org.descendentes('G')].sort().join() === 'X,Z' && [...org.descendentes('D')].sort().join() === 'G,X,Z');
ctx.me = 'G';
chk('salários (painel): o gestor de topo vê o salário de quem está na sua árvore (Contas a Pagar e a Receber) e NÃO vê o de outro setor nem o do próprio superior', org.salarioVisivel('X') && org.salarioVisivel('Z') && !org.salarioVisivel('Y') && !org.salarioVisivel('D') && org.eGestorDeTopo());
ctx.me = 'X'; chk('salários (painel): quem não tem subordinados não vê salário por árvore', !org.salarioVisivel('Z') && !org.eGestorDeTopo());
ctx.me = 'G'; ctx.loja = true; chk('salários (painel): perfil Loja nunca vê salário por árvore', !org.salarioVisivel('X'));
ctx.loja = false; ctx.globalSal = true; ctx.me = 'X'; chk('salários (painel): quem tem a permissão global (Master / "Pode ver salários") continua vendo todos', org.salarioVisivel('Y') && org.salarioVisivel('G'));
chk('salários (servidor): a árvore do Gerente Financeiro (Gestor direto, responsável, sub-departamentos e lotados) = a do painel; não alcança o Comercial', [...srv.arvoreDe(funcs, deps, 'G')].sort().join() === 'X,Z' && ![...srv.arvoreDe(funcs, deps, 'G')].includes('Y') && [...srv.arvoreDe(funcs, deps, 'M')].sort().join() === 'S,Y');
chk('salários (servidor): idSalario/ehColecaoSalarios reconhecem salarios/<id> (inclusive com prefixo de ambiente) e nada além disso', srv.idSalario('salarios/X') === 'X' && srv.idSalario('amb/prod/salarios/X') === 'X' && srv.idSalario('salarios') === null && srv.idSalario('funcionarios/X') === null && srv.ehColecaoSalarios('amb/homolog/salarios') && !srv.ehColecaoSalarios('rh_folhas'));
{
  const a = srv.arvoreDe(funcs, deps, 'G'), podeLer = (me, alvo) => srv.arvoreDe(funcs, deps, me).has(alvo);
  chk('salários (servidor): 200 para o subordinado e 403 para outro setor — mesma regra do podeLerSalarioDoc (árvore do solicitante)', a.has('X') && !a.has('Y') && podeLer('G', 'Z') && !podeLer('G', 'Y') && !podeLer('X', 'Z'));
}

/* ---------- 4 · Viagens: aprovação delegada ---------- */
const sessao = { master: false, perm: true, fin: true, loja: false, me: 'FIN1', uid: 'uFIN1', on: true };
const viagem = { id: 'v1', funcionarioId: 'T1', participantes: [{ funcionarioId: 'T1', nome: 'Viajante Um' }, { funcionarioId: 'T2', nome: 'Viajante Dois' }], solicitadoPor: 'uT1' };
const V12P = mk(['window'], corta('const Viagem12P = {', '/* fim Viagem12P */'), 'Viagem12P')({});
const V12 = mk(['Viagem12P', 'Org12', 'Auth', 'Viagens', 'Acesso', 'g12', 'Repo', 'Devolucao12', 'esc', 'UI', 'Fmt', 'Trajeto', 'VIAGEM_ST', 'window', 'navigator', 'document', 'location'], corta('const Viagem12 = {', '/* fim Viagem12 */'), 'Viagem12')(
  V12P, { meuId: () => sessao.me }, { get id() { return sessao.uid; }, can: p => p === 'viagens.aprovar' && sessao.perm, nome: 'Fulano Aprovador' },
  { COL: 'v', master: () => sessao.master, doFinanceiro: () => sessao.fin, participantes: v => v.participantes?.length ? v.participantes : [{ funcionarioId: v.funcionarioId, nome: v.nome }] }, { loja: () => sessao.loja }, () => sessao.on,
  { get: () => viagem }, {}, s => s, {}, {}, { rota: v => v.origem + ' ➔ ' + v.destino }, {}, {}, {}, {}, { origin: 'https://painel.exemplo', pathname: '/' });
const ap = v => V12.podeAprovar(v);
chk('delegação: o aprovador do Financeiro com viagens.aprovar aprova e encerra viagem de terceiros', ap(viagem) === true);
sessao.perm = false; chk('delegação: sem a permissão explícita não aprova (mesmo sendo do Financeiro)', ap(viagem) === false && V12.motivoNegado(viagem) === ''); sessao.perm = true;
sessao.fin = false; chk('delegação: com a permissão, mas FORA do setor Financeiro, não aprova — e o painel explica o motivo', ap(viagem) === false && /só vale para usuários lotados no setor Financeiro/.test(V12.motivoNegado(viagem))); sessao.fin = true;
sessao.me = 'T2'; chk('delegação: autoaprovação bloqueada — o aprovador é um dos viajantes (inclusive em viagem em grupo)', ap(viagem) === false && /Autoaprovação/.test(V12.motivoNegado(viagem))); sessao.me = 'FIN1';
sessao.uid = 'uT1'; chk('delegação: autoaprovação bloqueada — o aprovador abriu o pedido', ap(viagem) === false); sessao.uid = 'uFIN1';
sessao.loja = true; chk('delegação: perfil Loja nunca aprova', ap(viagem) === false); sessao.loja = false;
sessao.on = false; chk('recurso desligado (Produção e Falco antes da liberação): só o Master aprova', ap(viagem) === false && V12.delegadoDecide({ tipo: 'viagem-prestacao', dados: { viagemId: 'v1' } }) === false); sessao.on = true;
chk('Liberação Remota: o delegado decide solicitação (viagem) e prestação, mas NÃO a exclusão de adiantamento pago (segue do Master)', V12.delegadoDecide({ tipo: 'viagem', dados: { viagemId: 'v1' } }) && V12.delegadoDecide({ tipo: 'viagem-prestacao', dados: { viagemId: 'v1' } }) && !V12.delegadoDecide({ tipo: 'viagem-exclusao', dados: { viagemId: 'v1' } }) && !V12.delegadoDecide({ tipo: 'ferias', funcionarioId: 'T1', dados: {} }));
sessao.master = true; chk('o Master não depende da delegação (podeAprovar sempre verdadeiro; delegadoDecide fica de fora para não duplicar a alçada)', ap(viagem) === true && V12.delegadoDecide({ tipo: 'viagem', dados: { viagemId: 'v1' } }) === false); sessao.master = false;
{
  const casos = [['master-like ok', { perms: new Set(['viagens.aprovar']), perfil: 'OPERACIONAL', uid: 'a', funcionarioId: 'F', financeiro: true, viagem, recursoAtivo: () => true }, true],
    ['sem permissão', { perms: new Set(), perfil: 'OPERACIONAL', uid: 'a', funcionarioId: 'F', financeiro: true, viagem }, false], ['fora do Financeiro', { perms: new Set(['viagens.aprovar']), perfil: 'OPERACIONAL', uid: 'a', funcionarioId: 'F', financeiro: false, viagem }, false],
    ['é viajante', { perms: new Set(['viagens.aprovar']), perfil: 'OPERACIONAL', uid: 'a', funcionarioId: 'T2', financeiro: true, viagem }, false], ['abriu o pedido', { perms: new Set(['viagens.aprovar']), perfil: 'OPERACIONAL', uid: 'uT1', funcionarioId: 'F', financeiro: true, viagem }, false],
    ['perfil Loja', { perms: new Set(['viagens.aprovar']), perfil: 'LOJA', uid: 'a', funcionarioId: 'F', financeiro: true, viagem }, false], ['recurso desligado', { perms: new Set(['viagens.aprovar']), perfil: 'OPERACIONAL', uid: 'a', funcionarioId: 'F', financeiro: true, viagem, recursoAtivo: () => false }, false]];
  const res = casos.map(([n, a, esperado]) => [n, srv.aprovadorDelegado(a).ok === esperado]);
  chk('servidor (aprovadorDelegado): mesma matriz do painel — ' + casos.map(c => c[0]).join(', '), res.every(r => r[1]), res.filter(r => !r[1]));
  chk('servidor: a autoaprovação devolve motivo que começa com "autoaprovação" (o endpoint traduz em 403)', /^autoaprovação/.test(srv.aprovadorDelegado(casos[3][1]).motivo) && /^autoaprovação/.test(srv.aprovadorDelegado(casos[4][1]).motivo));
}
chk('Gestão de Acessos: viagens.aprovar existe na tabela do painel (recurso gestao_v1412, só com a flag) e na matriz do servidor (netlify/lib/matriz-acessos.mjs)', /\['viagens\.aprovar', 'Pode aprovar viagens e encerrar prestações \(Financeiro\)'/.test(html) && /"viagens\.aprovar"/.test(fs.readFileSync(path.join(raiz, 'netlify/lib/matriz-acessos.mjs'), 'utf8')) && /'viagens\.aprovar': 'Financeiro: aprovar viagens e encerrar prestações'/.test(html));
chk('recurso desligado: Adiantamentos.podeEncerrar() continua só do Master e os estados novos não existem (editavel sem aguardando_ofx)', /podeEncerrar\(v\) \{ return Viagens\.master\(\) \|\| \(g12\(\) && !!v && Viagem12\.podeAprovar\(v\)\); \}/.test(html) && /\['aguardando_prestacao', 'prestacao_enviada', \.\.\.\(g12\(\) \? \['aguardando_ofx'\] : \[\]\)\]/.test(html) && /podeDecidir\(r\) \{ return this\.statusDe\(r\) === 'pendente' && \(\(this\.daMinhaAlcada\(r\) && \(!this\.soMaster\(r\.tipo\) \|\| this\.master\(\)\)\) \|\| \(g12\(\) && Viagem12\.delegadoDecide\(r\)\)\); \}/.test(html));

/* ---------- 5 · Notificações e ClickBus ---------- */
{
  const d = { evento: 'aprovada', viajante: 'Viajante Um, Viajante Dois', destino: 'Caruaru/PE', rota: 'Recife/PE ➔ Caruaru/PE', ida: '2026-12-01', volta: '2026-12-03', valor: 1234.5, status: 'Aprovado para Pagamento', link: 'https://painel.exemplo/#viagens', responsavel: 'Fulano Aprovador' };
  const wa = V12P.whatsapp(d), wsv = nv.whatsappViagem(d);
  chk('WhatsApp (resumo curto): status, viajante, destino, período, valor e link do painel, avisando que o documento oficial segue por e-mail', ['Aprovado para Pagamento', 'Viajante Um, Viajante Dois', 'Caruaru/PE', '01/12/2026 a 03/12/2026', 'R$ 1.234,50', 'https://painel.exemplo/#viagens', 'O documento oficial segue por e-mail'].every(t => wa.includes(t)) && wa.split('\n').length <= 9, wa);
  chk('WhatsApp e e-mail: o painel (copiar e colar) e o servidor (disparo) geram EXATAMENTE o mesmo texto, assunto e resumo', wa === wsv && V12P.assunto(d) === nv.assuntoViagem(d) && V12P.texto(d) === nv.textoViagem(d) && V12P.texto({ ...d, comPdf: true }) === nv.textoViagem({ ...d, comPdf: true }));
  const m = nv.msgViagemEvento(d), mp = nv.msgViagemEvento({ ...d, comPdf: true });
  chk('e-mail completo (servidor): assunto, HTML com os fatos e o link, texto puro e WhatsApp; sem PDF fica só a referência (nome do arquivo), nada anexado', m.assunto === nv.assuntoViagem(d) && /Viagens › Imprimir Resumo/.test(m.html) && /Viagem_Viajante_Um_Viajante_Dois_2026-12-01\.pdf/.test(m.html) && m.anexos.length === 0 && m.whatsapp === wsv && /R\$ 1\.234,50/.test(m.html) && /href="https:\/\/painel\.exemplo\/#viagens"/.test(m.html));
  chk('e-mail completo: com comPdf o PDF-resumo vai anexado (cabeçalho %PDF) e o texto diz "anexado a este e-mail"', mp.anexos.length === 1 && mp.anexos[0].tipo === 'application/pdf' && Buffer.from(mp.anexos[0].base64, 'base64').subarray(0, 5).toString() === '%PDF-' && /anexado a este e-mail/.test(mp.texto) && /está anexado/.test(mp.html));
  const xss = nv.msgViagemEvento({ ...d, viajante: '<script>x</script>', destino: '"><img src=x>', observacao: '<b>obs</b>' });
  chk('e-mail: texto vindo dos dados é escapado (sem <script> nem tag solta no HTML)', !/<script>x/.test(xss.html) && !/<img src=x>/.test(xss.html) && /&lt;script&gt;/.test(xss.html));
  chk('os 9 eventos têm título e emoji; evento desconhecido cai em "solicitada"', Object.keys(nv.EVENTOS_VIAGEM).length === 9 && Object.keys(V12P.EVENTOS).join() === Object.keys(nv.EVENTOS_VIAGEM).join() && V12P.whatsapp({ ...d, evento: 'zzz' }).includes('Nova solicitação de viagem'));
  const ev = V12P.eventoDe.bind(V12P);
  chk('evento pelo estado da viagem: pago → paga; aguardando OFX → aguardando_ofx; crédito localizado → credito_localizado; concluído sem OFX → encerrada_sem_ofx', ev({ status: 'aguardando_prestacao' }) === 'paga' && ev({ status: 'aguardando_ofx', devolucao12: {} }) === 'aguardando_ofx' && ev({ status: 'aguardando_ofx', devolucao12: { ofx: { encontrado: true } } }) === 'credito_localizado' && ev({ status: 'concluido', acerto: { semOfx: { justificativa: 'x' } } }) === 'encerrada_sem_ofx' && ev({ status: 'concluido' }) === 'encerrada');
  const cb = V12P.clickbusUrl;
  chk('ClickBus (Ônibus): rota /onibus/<origem-uf>/<destino-uf> com acentos tratados e a data da ida', cb.call(V12P, { origemCidade: 'Recife', origemUF: 'PE', destinoCidade: 'Caruaru', destinoUF: 'PE', ida: '2026-12-01' }) === 'https://www.clickbus.com.br/onibus/recife-pe/caruaru-pe?departureDate=2026-12-01' && cb.call(V12P, { origemCidade: 'São Paulo', origemUF: 'SP', destinoCidade: 'Brasília', destinoUF: 'DF', ida: '2026-12-05' }) === 'https://www.clickbus.com.br/onibus/sao-paulo-sp/brasilia-df?departureDate=2026-12-05');
  chk('ClickBus: sem cidade/UF não monta endereço; sem data válida omite o parâmetro; cidade do aeroporto "(Guarulhos)" perde o parêntese', cb.call(V12P, { origemCidade: 'Recife', destinoCidade: 'Caruaru', destinoUF: 'PE' }) === null && !/departureDate/.test(cb.call(V12P, { origemCidade: 'Recife', origemUF: 'PE', destinoCidade: 'Caruaru', destinoUF: 'PE', ida: '' })) && /sao-paulo-guarulhos|sao-paulo-sp/.test(cb.call(V12P, { origemCidade: 'São Paulo (Guarulhos)', origemUF: 'SP', destinoCidade: 'Recife', destinoUF: 'PE' })) && !/\(/.test(cb.call(V12P, { origemCidade: 'São Paulo (Guarulhos)', origemUF: 'SP', destinoCidade: 'Recife', destinoUF: 'PE' })));
  const pc = V12.podeClickBus.bind(V12);
  chk('ClickBus: botão só para Ônibus aprovado/aguardando prestação; avião, carro, pedido em análise ou concluído não mostram', pc({ transporte: 'onibus', status: 'aprovado_pagamento' }) && pc({ transporte: 'onibus', status: 'aguardando_prestacao' }) && !pc({ transporte: 'aviao', status: 'aprovado_pagamento' }) && !pc({ transporte: 'carro_empresa', status: 'aprovado_pagamento' }) && !pc({ transporte: 'onibus', status: 'aguardando_aprovacao' }) && !pc({ transporte: 'onibus', status: 'concluido' }));
}

/* ---------- 6 · Recibos por IA: leitura, política/período e duplicidade ---------- */
const R12P = mk(['window'], corta('const Recibo12P = {', '/* fim Recibo12P */'), 'Recibo12P')({});
const cats = ['Alimentação', 'Transporte (táxi, aplicativo, ônibus)', 'Hospedagem', 'Passagem', 'Combustível', 'Pedágio e estacionamento', 'Outros'];
const cnpjOk = '11222333000181', cnpjOutro = '45997418000153'; /* CNPJs de exemplo com dígitos verificadores válidos */
{
  chk('CNPJ de exemplo: dígitos verificadores válidos (os usados nos testes)', R12P.cnpjOk(cnpjOk) && R12P.cnpjOk(cnpjOutro) && !R12P.cnpjOk('11222333000180') && !R12P.cnpjOk('11111111111111'));
  const n = R12P.normalizar({ data: '2026-12-02', cnpj: '11.222.333/0001-81', estabelecimento: '  Restaurante   Sabor  ', valorTotal: '1.234,56', categoria: 'Alimentação', numeroDocumento: 'Nº 004512', tipoDocumento: 'cupom fiscal', confianca: 1.4, observacao: 'ok' }, { categorias: cats, catDe: () => 'Outros' });
  chk('IA → campos: data, CNPJ (14 dígitos, válido), estabelecimento, valor total, categoria, nº do cupom (sem "Nº") e confiança limitada a 0–1', n.data === '2026-12-02' && n.cnpj === cnpjOk && n.cnpjValido && n.estabelecimento === 'Restaurante Sabor' && n.valor === 1234.56 && n.categoria === 'Alimentação' && n.doc === '004512' && n.confianca === 1, n);
  const v = R12P.normalizar({ data: '31/02/2026', cnpj: '123', valorTotal: null, categoria: 'comida de rua', estabelecimento: 'Padaria Pão Quente' }, { categorias: cats, catDe: x => (/padaria|comida/i.test(x) ? 'Alimentação' : 'Outros') });
  chk('IA ilegível: data inexistente, CNPJ curto e valor nulo ficam vazios (nada inventado); categoria fora da lista cai na heurística do painel', v.data === '' && v.cnpj === '' && v.valor === null && v.categoria === 'Alimentação', v);
  chk('número e data: "R$ 1.234,56", "12,5", 12.3 e "02/12/2026" são entendidos', R12P.num('R$ 1.234,56') === 1234.56 && R12P.num('12,5') === 12.5 && R12P.num(12.3) === 12.3 && R12P.num('abc') === null && R12P.dataISO('02/12/2026') === '2026-12-02' && R12P.dataISO('2026-12-02T10:00:00') === '2026-12-02');
}
const viagemR = { id: 'v1', ida: '2026-12-01', volta: '2026-12-03', solicitadoEm: '2026-11-20', origem: 'Recife/PE', destino: 'Caruaru/PE', calculo: { diariaAlimentacao: 70, diariaDeslocamento: 30 }, despesas: [{ id: 'd1', data: '2026-12-01', categoria: 'Alimentação', descricao: 'Almoço', valor: 40, doc: '000123', fornecedor: 'Restaurante Sabor', cnpj: cnpjOk, hash: 'h-arquivo-1' }] };
const outraViagem = { id: 'v0', ida: '2026-10-01', volta: '2026-10-02', origem: 'Recife/PE', destino: 'Gravatá/PE', despesas: [{ id: 'o1', data: '2026-10-01', categoria: 'Alimentação', descricao: 'Jantar', valor: 55.9, doc: '777', fornecedor: 'Casa do Norte', cnpj: cnpjOutro, hash: 'h-outra' }] };
const critSrc = corta('const CriticaPrestacao = {', 'window.CriticaPrestacao = CriticaPrestacao;');
const todasV = [viagemR, outraViagem];
const R12 = mk(['Recibo12P', 'CriticaPrestacao', 'Repo', 'Viagens', 'Trajeto', 'Fmt', 'Cloud', 'IA', 'campo', 'window', 'document', 'g12', 'VIAGEM_CATEGORIAS', 'Adiantamentos', 'Arquivos', 'esc', 'UI', 'Auth', 'CNPJ', '$'], corta('const Recibo12 = {', '/* fim Recibo12 */'), 'Recibo12')(
  R12P, mk(['Viagens', 'Repo', 'Fmt', 'Trajeto', 'window'], critSrc, 'CriticaPrestacao')({ params: () => ({ alimentacao: 70, deslocamento: 30, hospedagemMedia: 300 }), tetoHosp: () => 330, modo: () => 'unico', participantes: () => [{ funcionarioId: 'T1', nome: 'Viajante Um' }], COL: 'v' }, { todos: () => todasV }, { brl: n => 'R$ ' + Number(n).toFixed(2), data: s => s }, { rota: v => v.origem + ' ➔ ' + v.destino }, {}),
  { todos: () => todasV }, { COL: 'v', financeiro: () => false }, { rota: v => v.origem + ' ➔ ' + v.destino }, { brl: n => 'R$ ' + Number(n).toFixed(2), data: s => s, num: n => String(n) }, { caps: {} }, {}, () => '', {}, { addEventListener() { } }, () => true, cats, {}, {}, s => s, {}, { id: 'u' }, { formatar: x => x }, () => null);
{
  const ok = R12.avaliar(viagemR, { id: 'n', data: '2026-12-02', categoria: 'Alimentação', descricao: 'Almoço Padaria', valor: 25, doc: '9001', fornecedor: 'Padaria Pão Quente', cnpj: '', funcionarioId: 'T1' }, 'h-novo');
  chk('conferência: despesa dentro do período, da política e do teto (R$ 70/dia: 40 + 25) não gera bloqueio nem alerta', ok.bloqueios.length === 0 && ok.alertas.length === 0, ok);
  const fora = R12.avaliar(viagemR, { id: 'n', data: '2026-12-10', categoria: 'Alimentação', descricao: 'Almoço', valor: 20, funcionarioId: 'T1' }, 'h2');
  chk('conferência: data FORA do período da viagem gera alerta de período (glosa sugerida)', fora.alertas.some(f => f.tipo === 'periodo' && f.nivel === 'glosa'), fora);
  const bebida = R12.avaliar(viagemR, { id: 'n', data: '2026-12-02', categoria: 'Alimentação', descricao: 'Cerveja long neck', valor: 12, funcionarioId: 'T1' }, 'h3');
  chk('conferência: política interna (bebida alcoólica) gera alerta de política (glosa sugerida)', bebida.alertas.some(f => f.tipo === 'politica'), bebida);
  const teto = R12.avaliar(viagemR, { id: 'n', data: '2026-12-02', categoria: 'Alimentação', descricao: 'Jantar de grupo', valor: 120, funcionarioId: 'T1' }, 'h4');
  chk('conferência: valor acima do teto diário de alimentação (R$ 70) gera alerta de teto com o excedente do dia (R$ 40 já lançados em 01/12 não entram: R$ 120 − R$ 70 = R$ 50)', teto.alertas.some(f => f.tipo === 'teto' && /excedente R\$ 50\.00/.test(f.msg)), teto);
  const dupHash = R12.avaliar(viagemR, { id: 'n', data: '2026-12-02', categoria: 'Alimentação', valor: 10, funcionarioId: 'T1' }, 'h-arquivo-1');
  chk('duplicidade 1 · mesmo ARQUIVO (hash SHA-256) já lançado nesta prestação → bloqueia', dupHash.bloqueios[0]?.tipo === 'hash' && /esta prestação/.test(dupHash.bloqueios[0].msg), dupHash);
  const dupHashOutra = R12.avaliar(viagemR, { id: 'n', data: '2026-12-02', categoria: 'Alimentação', valor: 10, funcionarioId: 'T1' }, 'h-outra');
  chk('duplicidade 1b · o mesmo arquivo já lançado em OUTRA viagem também bloqueia, dizendo onde', dupHashOutra.bloqueios[0]?.tipo === 'hash' && /a viagem Recife\/PE ➔ Gravatá\/PE/.test(dupHashOutra.bloqueios[0].msg), dupHashOutra);
  const dupCupom = R12.avaliar(viagemR, { id: 'n', data: '2026-12-02', categoria: 'Alimentação', valor: 33, doc: '000123', fornecedor: 'Restaurante Sabor', cnpj: '11.222.333/0001-81', funcionarioId: 'T1' }, 'h-novo');
  chk('duplicidade 2 · mesmo CUPOM (nº normalizado) do mesmo emitente (CNPJ) → bloqueia, mesmo com valor e data diferentes', dupCupom.bloqueios[0]?.tipo === 'cupom', dupCupom);
  const cupomOutroEmitente = R12.avaliar(viagemR, { id: 'n', data: '2026-12-02', categoria: 'Alimentação', valor: 33, doc: '000123', fornecedor: 'Outro Lugar', cnpj: cnpjOutro, funcionarioId: 'T1' }, 'h-novo');
  chk('duplicidade 2b · o mesmo número de cupom em OUTRO emitente (CNPJ diferente) NÃO é duplicidade', cupomOutroEmitente.bloqueios.length === 0, cupomOutroEmitente);
  const combo = R12.avaliar(viagemR, { id: 'n', data: '2026-12-01', categoria: 'Alimentação', valor: 40, doc: '', fornecedor: 'Restaurante Sabor', cnpj: cnpjOk, funcionarioId: 'T1' }, null);
  chk('duplicidade 3 · sem nº de cupom, a combinação CNPJ + data + valor já lançada → bloqueia', combo.bloqueios[0]?.tipo === 'combo', combo);
  const comboOutroValor = R12.avaliar(viagemR, { id: 'n', data: '2026-12-01', categoria: 'Alimentação', valor: 41, doc: '', fornecedor: 'Restaurante Sabor', cnpj: cnpjOk, funcionarioId: 'T1' }, null);
  chk('duplicidade 3b · mesmo CNPJ e data com valor diferente (R$ 41 × R$ 40) NÃO bloqueia', comboOutroValor.bloqueios.length === 0, comboOutroValor);
  chk('duplicidade em OUTRA viagem por cupom + CNPJ → bloqueia com o local da primeira ocorrência', R12.avaliar(viagemR, { id: 'n', data: '2026-12-02', categoria: 'Alimentação', valor: 55.9, doc: '777', fornecedor: 'Casa do Norte', cnpj: cnpjOutro, funcionarioId: 'T1' }, null).bloqueios[0]?.tipo === 'cupom');
}
{
  const chamadas = [];
  const amostra = { limits: async () => ({ images: { maxCount: 4 } }), json: async (inp, o) => { chamadas.push({ inp, o }); return { data: '2026-12-02', valorTotal: 25 }; } };
  const exec = [], iaStub = { executar: async (p, f) => { exec.push(f.name); return { json: { data: '2026-12-02', valorTotal: 99 } }; } };
  const R = mk(['Recibo12P', 'Cloud', 'IA', 'window', 'document', 'g12', 'Auth', 'CNPJ', 'campo', 'VIAGEM_CATEGORIAS', 'Adiantamentos', 'Arquivos', 'esc', 'UI', 'Viagens', 'CriticaPrestacao', 'Repo', 'Trajeto', 'Fmt', '$'], corta('const Recibo12 = {', '/* fim Recibo12 */'), 'Recibo12')(R12P, { caps: { sample: amostra } }, iaStub, {}, { addEventListener() { } }, () => true, {}, {}, (n, nome) => nome, cats, {}, {}, s => s, {}, {}, {}, {}, {}, {}, () => null);
  const foto = { type: 'image/jpeg', name: 'cupom.jpg', size: 1000 }, pdf = { type: 'application/pdf', name: 'nota.pdf', size: 1000 };
  const rf = await R.lerIA(foto, 'PROMPT'), rp = await R.lerIA(pdf, 'PROMPT');
  chk('IA: a FOTO vai como imagem (sample.json com images e prompt), o PDF pelo motor de leitura de PDF do painel; o resultado volta como JSON', chamadas.length === 1 && chamadas[0].o.images[0] === foto && /PROMPT/.test(chamadas[0].inp) && rf.valorTotal === 25 && exec[0] === 'nota.pdf' && rp.valorTotal === 99);
  const semIA = mk(['Recibo12P', 'Cloud', 'IA', 'window', 'document', 'g12', 'Auth', 'CNPJ', 'campo', 'VIAGEM_CATEGORIAS', 'Adiantamentos', 'Arquivos', 'esc', 'UI', 'Viagens', 'CriticaPrestacao', 'Repo', 'Trajeto', 'Fmt', '$'], corta('const Recibo12 = {', '/* fim Recibo12 */'), 'Recibo12')(R12P, { caps: { sample: null } }, iaStub, {}, { addEventListener() { } }, () => true, {}, {}, () => '', cats, {}, {}, s => s, {}, {}, {}, {}, {}, {}, () => null);
  const e1 = await dobra(() => semIA.lerIA(foto, 'P'));
  const semImg = mk(['Recibo12P', 'Cloud', 'IA', 'window', 'document', 'g12', 'Auth', 'CNPJ', 'campo', 'VIAGEM_CATEGORIAS', 'Adiantamentos', 'Arquivos', 'esc', 'UI', 'Viagens', 'CriticaPrestacao', 'Repo', 'Trajeto', 'Fmt', '$'], corta('const Recibo12 = {', '/* fim Recibo12 */'), 'Recibo12')(R12P, { caps: { sample: { limits: async () => ({}), json: async () => ({}) } } }, iaStub, {}, { addEventListener() { } }, () => true, {}, {}, () => '', cats, {}, {}, s => s, {}, {}, {}, {}, {}, {}, () => null);
  const e2 = await dobra(() => semImg.lerIA(foto, 'P'));
  chk('sem IA (fora do claude.ai) a leitura sinaliza SEM_IA para o formulário seguir manual; sem envio de imagens avisa e não quebra', e1?.message === 'SEM_IA' && /não envia imagens/.test(e2?.message || ''), [e1?.message, e2?.message]);
  const bloco = R.bloco();
  chk('câmera: o campo da foto usa accept="image/*,application/pdf" capture="environment" (abre a câmera traseira no celular) e há o botão da galeria/arquivo', /accept="image\/\*,application\/pdf" capture="environment" data-r12-arq/.test(bloco) && /accept="image\/\*,application\/pdf" data-r12-arq/.test(bloco.replace(/capture="environment" /, '')) && /Fotografar comprovante/.test(bloco));
  chk('prestação: o formulário mobile-first lê o cupom, o estabelecimento e o CNPJ (campos extras) e grava hash, IA e duplicidade aceita na despesa', /dDoc/.test(R.camposExtras()) && /dForn/.test(R.camposExtras()) && /dCnpj/.test(R.camposExtras()) && /campos\.hash = hash/.test(corta('const Recibo12 = {', '/* fim Recibo12 */')) && /\.\.\.\(r12 \? r12\.campos : \{\}\)/.test(html));
}

/* ---------- 7 · Devolução × OFX ---------- */
const D12P = mk(['Viagem12P', 'window'], corta('const Devolucao12P = {', '/* fim Devolucao12P */'), 'Devolucao12P')(V12P, {});
const pend = (id, valor, data, nomes = ['Viajante Um'], extra = {}) => ({ id, nome: nomes[0], participantes: nomes.map((n, i) => ({ funcionarioId: 'T' + i, nome: n })), status: 'aguardando_ofx', devolucao12: { status: 'aguardando_ofx', valor, data, ...extra } });
const cr = (id, data, valor, hist, contaId = 'c1') => ({ id, data, valor, hist, contaId });
{
  const V = D12P.validar.bind(D12P), base = { saldo: 150, hoje: '2026-12-10', minData: '2026-11-25' };
  chk('comprovante: valor igual ao saldo (±R$ 0,05) e data válida passam; R$ 0,05 de diferença passa, R$ 0,06 não', V({ valor: 150, data: '2026-12-04' }, base).ok && V({ valor: 149.95, data: '2026-12-04' }, base).ok && V({ valor: 150.05, data: '2026-12-04' }, base).ok && !V({ valor: 149.94, data: '2026-12-04' }, base).ok && !V({ valor: 150.06, data: '2026-12-04' }, base).ok);
  chk('comprovante: valor menor (devolução incompleta), valor maior, sem valor, data no futuro, data anterior ao pagamento do adiantamento e sem data são recusados com mensagem', /incompleta/.test(V({ valor: 100, data: '2026-12-04' }, base).erros[0]) && /acima do saldo/.test(V({ valor: 200, data: '2026-12-04' }, base).erros[0]) && !V({ valor: 0, data: '2026-12-04' }, base).ok && /futuro/.test(V({ valor: 150, data: '2026-12-20' }, base).erros[0]) && /anterior ao pagamento/.test(V({ valor: 150, data: '2026-11-01' }, base).erros[0]) && !V({ valor: 150, data: '' }, base).ok);
  const um = D12P.cruzar([cr('t1', '2026-12-05', 150, 'PIX RECEBIDO VIAJANTE UM')], [pend('v1', 150, '2026-12-04')]);
  chk('OFX: valor + data (1 dia depois) + nome do viajante no histórico → crédito localizado com força "forte"', um.length === 1 && um[0].viagemId === 'v1' && um[0].forca === 'forte' && um[0].dias === 1 && um[0].nomeOk && um[0].naJanela, um);
  const tol = [0.05, 0.06, -0.05, -0.06].map(d => D12P.cruzar([cr('t1', '2026-12-04', 150 + d, 'PIX')], [pend('v1', 150, '2026-12-04')]).length);
  chk('OFX: tolerância de ±R$ 0,05 (0,05 casa; 0,06 não casa), nos dois sentidos', tol.join() === '1,0,1,0', tol);
  chk('OFX: só ENTRADAS (créditos): débito de mesmo valor e valor zero nunca casam', D12P.cruzar([cr('d1', '2026-12-04', -150, 'PIX ENVIADO VIAJANTE UM'), cr('d2', '2026-12-04', 0, 'x')], [pend('v1', 150, '2026-12-04')]).length === 0);
  const jan = ['2026-12-02', '2026-12-03', '2026-12-04', '2026-12-09', '2026-12-10'].map(d => D12P.cruzar([cr('t1', d, 150, 'TED SEM IDENTIFICACAO')], [pend('v1', 150, '2026-12-04')]).length);
  chk('OFX: sem nome no histórico, a data tem de estar na janela de −1 a +5 dias do comprovante (03 a 09/12 casa; 02 e 10 não)', jan.join() === '0,1,1,1,0', jan);
  const soNome = D12P.cruzar([cr('t1', '2026-12-30', 150, 'PIX VIAJANTE U UM')], [pend('v1', 150, '2026-12-04')]);
  chk('OFX: fora da janela de data, só o NOME (histórico truncado pelo banco) com o valor ainda casa, como "provável"', soNome.length === 1 && soNome[0].forca === 'provavel' && soNome[0].nomeOk && !soNome[0].naJanela, soNome);
  const homonimo = D12P.cruzar([cr('t1', '2026-12-30', 150, 'PIX JOSE ALVES')], [pend('v1', 150, '2026-12-04', ['José Silva'])]);
  chk('OFX: nome parcial (só 1 parte do nome, sobrenome diferente) fora da janela NÃO casa', homonimo.length === 0, homonimo);
  const dois = D12P.cruzar([cr('t1', '2026-12-05', 150, 'PIX VIAJANTE UM'), cr('t2', '2026-12-05', 150, 'PIX OUTRO REMETENTE')], [pend('v1', 150, '2026-12-04'), pend('v2', 150, '2026-12-04', ['Maria Souza'])]);
  chk('OFX: um crédito para uma viagem e uma viagem para um crédito (a mais forte primeiro); a segunda viagem sem crédito próprio fica sem vínculo', dois.length === 2 && dois.find(c => c.viagemId === 'v1').entrada.id === 't1' && dois.find(c => c.viagemId === 'v2').entrada.id === 't2' && dois.find(c => c.viagemId === 'v2').forca === 'provavel');
  const reuso = D12P.cruzar([cr('t1', '2026-12-05', 150, 'PIX VIAJANTE UM')], [pend('v1', 150, '2026-12-04'), { ...pend('v0', 150, '2026-12-04'), devolucao12: { status: 'aguardando_ofx', valor: 150, data: '2026-12-04', ofx: { encontrado: true, contaId: 'c1', txId: 't1' } } }]);
  chk('OFX: o crédito já vinculado a outra viagem (devolucao12.ofx) não é reutilizado; viagens já confirmadas ou com outro status não entram', reuso.length === 0 && D12P.cruzar([cr('t1', '2026-12-05', 150, 'PIX VIAJANTE UM')], [{ ...pend('v1', 150, '2026-12-04'), devolucao12: { status: 'confirmada_ofx', valor: 150, data: '2026-12-04' } }, { id: 'v9', nome: 'X' }]).length === 0);
  const contas = D12P.cruzar([cr('t1', '2026-12-05', 150, 'PIX VIAJANTE UM', 'c1'), cr('t1', '2026-12-05', 150, 'PIX VIAJANTE UM', 'c2')], [pend('v1', 150, '2026-12-04'), pend('v2', 150, '2026-12-04')]);
  chk('OFX: o mesmo FITID em duas contas bancárias são créditos diferentes (a chave é conta + id)', contas.length === 2 && new Set(contas.map(c => c.entrada.contaId)).size === 2);
}
{
  const casos = [['sem devolução', {}, 'x'], ['aguardando sem OFX, sem justificativa', { devolucao12: { status: 'aguardando_ofx' } }, ''], ['aguardando sem OFX, justificativa curta', { devolucao12: { status: 'aguardando_ofx' } }, 'curta'],
    ['aguardando sem OFX, justificativa boa', { devolucao12: { status: 'aguardando_ofx' } }, '  comprovante conferido com o banco  '], ['crédito localizado', { devolucao12: { status: 'aguardando_ofx', ofx: { encontrado: true } } }, ''], ['já confirmada', { devolucao12: { status: 'confirmada_ofx' } }, ''],
    ['já encerrada sem OFX', { devolucao12: { status: 'encerrada_sem_ofx' } }, ''], ['devolvida ao viajante, sem OFX', { devolucao12: { status: 'devolvida_ao_viajante' } }, '']];
  const r = casos.map(([n, v, j]) => { const a = D12P.decisaoEncerramento(v, j, true), b = sv.decisaoEncerramento(v, j, true); return [n, a.exige === b.exige && a.semOfx === b.semOfx && !!a.erro === !!b.erro && (a.justificativa || '') === (b.justificativa || ''), a]; });
  chk('encerramento: painel e servidor decidem igual (sem devolução, crédito localizado, já confirmada → sem trava; sem OFX → exige justificativa de 10+ caracteres)', r.every(x => x[1]), r.filter(x => !x[1]));
  chk('encerramento: sem OFX e sem justificativa → erro; com justificativa → semOfx verdadeiro e texto aparado; recurso desligado → sem trava', r[1][2].erro && r[2][2].erro && r[3][2].semOfx === true && r[3][2].justificativa === 'comprovante conferido com o banco' && !sv.decisaoEncerramento(casos[1][1], '', false).exige);
}
{
  const gravados = [], t = async (sql, p) => { gravados.push({ sql, p }); return /^SELECT/.test(sql) ? [] : []; };
  const ev = await sv.registrarAuditoria(t, { uid: 'uFIN1', perfil: 'OPERACIONAL' }, { modulo: 'viagens', acao: sv.EVENTO_SEM_OFX, entidade: 'viagem', entidadeId: 'v1', rotulo: 'Viagem · Teste', mudancas: [], detalhe: 'Justificativa: comprovante conferido com o banco' });
  const ins = gravados.find(g => /^INSERT INTO documentos/.test(g.sql)), doc = JSON.parse(ins.p[3]), mud = gravados.find(g => /INSERT INTO mudancas/.test(g.sql));
  chk('Log de Auditoria (servidor): encerramento_viagem_sem_ofx grava o evento no ramo do usuário (auditoria/<uid>/dias/<dia>), com a justificativa, e registra a mudança', sv.EVENTO_SEM_OFX === 'encerramento_viagem_sem_ofx' && ev.acao === 'encerramento_viagem_sem_ofx' && /^auditoria\/uFIN1\/dias\/\d{4}-\d{2}-\d{2}$/.test(ins.p[0]) && doc.eventos.length === 1 && doc.eventos[0].acao === 'encerramento_viagem_sem_ofx' && /Justificativa/.test(doc.eventos[0].detalhe) && doc.eventos[0].uid === 'uFIN1' && !!mud, [ins?.p?.[0], doc]);
}
{
  const decl = corta('const Devolucao12 = {', '/* fim Devolucao12 */');
  const ctxD = { fin: true, aprova: true, viagens: [], toasts: [], gravadas: [], extratos: [] };
  const Viagens = { COL: 'v', financeiro: () => ctxD.fin, modo: () => 'unico', totais: v => ({ saldo: v.saldoTeste ?? 0 }), porPessoa: () => [], participantes: v => v.participantes || [], podeEditarPrestacao: () => true,
    async gravar(v, m, extra) { ctxD.gravadas.push({ id: v.id, txt: m.txt, extra }); Object.assign(v, extra); } };
  const auditoria = [], Audit = { registrar: async e => { auditoria.push(e); } };
  const FluxoDFC = { chamadas: 0, transacoes: () => ctxD.extratos, importarOFX: async function () { this.chamadas++; return 'importado'; } };
  const modais = [];
  const UI = { toast: m => ctxD.toasts.push(m), modal: o => { modais.push(o); setTimeout(() => { const m = { v: ctxD.texto }; o.acoes[1].acao(m); o.aoFechar?.(); }, 0); } };
  const D = mk(['Devolucao12P', 'Viagem12P', 'Viagem12', 'Recibo12P', 'Recibo12', 'Viagens', 'Repo', 'Fmt', 'UI', 'Audit', 'Auth', 'Trajeto', 'esc', 'campo', 'Arquivos', 'Datas', 'FluxoDFC', 'g12', 'window', 'document', 'Cloud', '$'], decl, 'Devolucao12')(
    D12P, V12P, { podeAprovar: () => ctxD.aprova }, R12P, {}, Viagens, { todos: () => ctxD.viagens, get: (c, id) => ctxD.viagens.find(v => v.id === id) }, { brl: n => 'R$ ' + Number(n).toFixed(2), data: s => s, dataHora: s => s }, UI, Audit, { id: 'uFIN1', nome: 'Fulano Aprovador' }, { rota: () => 'Recife ➔ Caruaru' }, s => s, (n, nome) => nome, { botao: () => '[arq]', ehImagem: () => true, validar: () => '', enviar: async () => ({}), remover: async () => {}, reduzirImagem: async f => f }, { hojeISO: () => '2026-12-10' }, FluxoDFC, () => true, {}, { addEventListener() { } }, {}, n => ({ value: ctxD.texto }));
  /* bloqueio de envio e status */
  const v1 = { id: 'v1', nome: 'Viajante Um', status: 'aguardando_prestacao', saldoTeste: 150, participantes: [{ funcionarioId: 'T0', nome: 'Viajante Um' }] }; ctxD.viagens = [v1];
  chk('prestação: com saldo a devolver e SEM comprovante o envio é barrado; com comprovante do valor certo segue e a viagem vai para "Aguardando Confirmação Bancária (OFX)"', /anexe o comprovante da devolução/.test(D.bloqueioEnvio(v1)) && D.statusEnvio(v1) === 'prestacao_enviada'
    && (() => { v1.devolucao12 = { status: 'informada', valor: 150, data: '2026-12-04', comprovante: { assetId: 'a' } }; return D.bloqueioEnvio(v1) === '' && D.statusEnvio(v1) === 'aguardando_ofx' && D.extraEnvio(v1).devolucao12.status === 'aguardando_ofx'; })());
  v1.devolucao12.valor = 100; chk('prestação: comprovante de valor diferente do saldo atual é barrado (registrar de novo)', /não corresponde ao saldo/.test(D.bloqueioEnvio(v1))); v1.devolucao12.valor = 150;
  const v2 = { id: 'v2', status: 'aguardando_prestacao', saldoTeste: 0 }; chk('prestação: sem saldo a devolver nada muda (status prestacao_enviada como antes, sem exigência)', D.bloqueioEnvio(v2) === '' && D.statusEnvio(v2) === 'prestacao_enviada' && Object.keys(D.extraEnvio(v2)).length === 0);
  /* importação do OFX: cruzamento e vínculo */
  v1.status = 'aguardando_ofx'; v1.devolucao12.status = 'aguardando_ofx'; ctxD.extratos = [cr('t1', '2026-12-05', 150, 'PIX RECEBIDO VIAJANTE UM'), cr('t9', '2026-12-05', 80, 'OUTRO')];
  await FluxoDFC.importarOFX();
  chk('invólucro do OFX: a importação original roda primeiro e devolve o seu resultado (o cruzamento é depois e FORA da região protegida)', FluxoDFC.chamadas === 1 && /FluxoDFC\.importarOFX = async function \(\) \{ const r = await oImp12\.apply\(this, arguments\); if \(g12\(\)\)/.test(decl));
  await D.aposImportarOFX();
  chk('após importar o OFX: o crédito é vinculado à viagem (devolucao12.ofx com valor, data, histórico, conta e força) e destacado no card (“Crédito localizado no banco”)', v1.devolucao12.ofx?.encontrado === true && v1.devolucao12.ofx.txId === 't1' && v1.devolucao12.ofx.forca === 'forte' && /localizado no extrato OFX/.test(ctxD.gravadas.at(-1).txt) && /Crédito localizado no banco/.test(D.pillOfx(v1)) && /Crédito localizado no banco/.test(D.bloco(v1, false)) && D.stRot(v1)[1] === 'Crédito localizado no banco', ctxD.gravadas);
  const n0 = ctxD.gravadas.length; await D.aposImportarOFX(); chk('importar de novo não duplica o vínculo nem grava outra vez', ctxD.gravadas.length === n0);
  ctxD.fin = false; const v3 = { id: 'v3', nome: 'Viajante Três', status: 'aguardando_ofx', participantes: [{ nome: 'Viajante Três' }], devolucao12: { status: 'aguardando_ofx', valor: 80, data: '2026-12-05' } }; ctxD.viagens = [v1, v3]; await D.aposImportarOFX();
  chk('quem não é do Financeiro não grava o vínculo (o cruzamento fica só como sugestão no card)', !v3.devolucao12.ofx); ctxD.fin = true;
  /* encerramento */
  v3.devolucao12.ofx = undefined; ctxD.extratos = [];
  ctxD.texto = ''; const curto = await D.antesDeEncerrar(v3); ctxD.texto = 'curta'; const curto2 = await D.antesDeEncerrar(v3); ctxD.texto = 'Comprovante conferido por telefone com o banco'; const longo = await D.antesDeEncerrar(v3);
  chk('encerrar ANTES do crédito no OFX: o painel pede justificativa (10+ caracteres); vazia ou curta cancela o encerramento (false); válida devolve o texto para gravar e auditar', curto === false && curto2 === false && longo === 'Comprovante conferido por telefone com o banco' && /Encerrar antes da confirmação no extrato/.test(modais[0].titulo) && /encerramento_viagem_sem_ofx/.test(modais[0].corpo), [curto, curto2, longo]);
  chk('encerrar com o crédito já localizado (ou já gravado): sem justificativa e sem modal', await D.antesDeEncerrar(v1) === '' && await D.antesDeEncerrar({ id: 'v8' }) === '');
  const nm = modais.length; ctxD.viagens = [v1, v3]; ctxD.extratos = [cr('t3', '2026-12-06', 80, 'PIX VIAJANTE TRES')]; const achado = await D.antesDeEncerrar(v3);
  chk('encerrar com o crédito ACHADO no extrato mas ainda não gravado: grava o vínculo e segue sem justificativa', achado === '' && v3.devolucao12.ofx?.txId === 't3' && modais.length === nm);
  await D.auditarSemOfx({ id: 'v3', nome: 'Viajante Três', devolucao12: { valor: 80 } }, 'Comprovante conferido por telefone com o banco');
  chk('Log de Auditoria (painel fora do Netlify): encerramento_viagem_sem_ofx com viagem, rótulo e justificativa; estado final da devolução = encerrada_sem_ofx (ou confirmada_ofx quando o crédito apareceu)', auditoria.at(-1).acao === 'encerramento_viagem_sem_ofx' && auditoria.at(-1).modulo === 'viagens' && /Justificativa: Comprovante conferido/.test(auditoria.at(-1).detalhe) && D.aoEncerrarLocal({ devolucao12: { valor: 1 } }, 'x').devolucao12.status === 'encerrada_sem_ofx' && D.aoEncerrarLocal({ devolucao12: { valor: 1 } }, '').devolucao12.status === 'confirmada_ofx' && Object.keys(D.aoEncerrarLocal({}, 'x')).length === 0);
  const lib = D.chipLiberacao({ id: 'v5', devolucao12: { status: 'aguardando_ofx', valor: 80, data: '2026-12-05' } });
  chk('Liberação Remota: o cartão da prestação mostra a situação da devolução e avisa que encerrar sem o crédito exige justificativa e fica no Log de Auditoria', /Aguardando Confirmação Bancária \(OFX\)/.test(lib) && /exige justificativa e fica no Log de Auditoria/.test(lib));
}
{
  const fonte = html;
  chk('encerramento no painel: a justificativa vai ao servidor (justificativa), o rótulo vira "Encerrar Adiantamento" e a auditoria local só roda fora do Netlify', /\{ viagemId: id, \.\.\.\(justificativa \? \{ justificativa \} : \{\}\) \}/.test(fonte) && /rotulo: g12\(\) \? 'Encerrar Adiantamento' : 'Encerrar Prestação de Contas'/.test(fonte) && /if \(g12\(\) && justificativa\) await Devolucao12\.auditarSemOfx\(v, justificativa\);\n        UI\.toast\('Prestação encerrada\. Contabilização pendente/.test(fonte));
  const cont = fs.readFileSync(path.join(raiz, 'netlify/functions/contabil.mjs'), 'utf8');
  chk('servidor (encerrar): aprovador delegado + devolução sem OFX → 422 sem justificativa; evento encerramento_viagem_sem_ofx na MESMA transação; acerto.semOfx e devolucao12.status finais', /decisaoEncerramento\(/.test(cont) && /codigo: 'justificativa_ofx'|justificativa_ofx/.test(cont) && /registrarAuditoria\(/.test(cont) && /EVENTO_SEM_OFX/.test(cont) && /semOfx/.test(cont) && /encerrada_sem_ofx/.test(cont) && /confirmada_ofx/.test(cont) && /aprovadorDelegado\(/.test(cont) && /aguardando_ofx/.test(cont));
}

console.log(`\n${OK.length} ok · ${FAIL.length} falha(s)`);
if (FAIL.length) { console.log('FALHAS:\n - ' + FAIL.join('\n - ')); process.exit(1); }
