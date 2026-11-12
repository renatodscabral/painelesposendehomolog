/* v14.02 · Matriz de permissões no SERVIDOR: as duas novas flags (recebiveis_aprovar_saidas e liberacao_gerencial), a elevação gerencial,
   o que ela NÃO libera (salários, autorização de pagamentos, áreas técnicas) e as coleções que passaram a seguir as flags do perfil.
   Teste sem banco e sem navegador (só netlify/lib/permissoes.mjs e matriz-acessos.mjs). Dados fictícios.
   Uso: node tests/teste-permissoes-1402.mjs */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = await import(path.join(raiz, 'netlify/lib/permissoes.mjs'));
const MATRIZ = (await import(path.join(raiz, 'netlify/lib/matriz-acessos.mjs'))).default;
const OK = [], FAIL = [];
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x !== '' ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 600) : '')); };

const todos = () => true;
const sem = recursos => k => !recursos.includes(k);
const op = (permissoes, perfil = 'OPERACIONAL') => ({ perfil, permissoes });
const mods = Object.fromEntries(MATRIZ.modulos.map(m => [m.id, m]));
const extra = (modId, k) => mods[modId]?.extras.find(e => e[0] === k);

/* ---------- 1 · a matriz gerada tem as duas flags ---------- */
const eAprovar = extra('visao', 'recebiveis_aprovar_saidas'), eGer = extra('gerencial', 'liberacao_gerencial');
chk('matriz: "recebiveis_aprovar_saidas" está em Visão, depende do recurso gestao_v1402 e NÃO é livre (exige nível em Visão)', !!eAprovar && eAprovar[1] === false && eAprovar[2] === 'gestao_v1402', eAprovar);
chk('matriz: "liberacao_gerencial" é livre (não exige nível de módulo) e fica num módulo próprio, que exige a Gestão de Acessos v13.83 e o recurso gestao_v1402', !!eGer && eGer[1] === true && mods.gerencial?.v1383 === true && mods.gerencial?.rec === 'gestao_v1402', [eGer, mods.gerencial?.rec]);
chk('matriz: nenhum módulo de negócio libera banco de dados, backup, ambientes, notificações nem controle de acessos (áreas técnicas só do Master)', !MATRIZ.modulos.flatMap(m => [...m.ler, ...m.modificar, ...m.excluir, ...m.extras.map(e => e[0])]).some(p => /migra|backup|ambiente|notific|^acessos\./i.test(p)), '');

/* ---------- 2 · normalizarPermissoes aceita as opções sem ponto ---------- */
const n1 = P.normalizarPermissoes({ visao: 'ler', recebiveis_aprovar_saidas: true, liberacao_gerencial: 'sim', lixo: true });
chk('normalizarPermissoes: guarda as duas opções novas (também em texto "sim") e descarta o que não conhece', n1.visao === 'ler' && n1.recebiveis_aprovar_saidas === true && n1.liberacao_gerencial === true && !('lixo' in n1), n1);
const n2 = P.normalizarPermissoes(JSON.stringify({ liberacao_gerencial: false, recebiveis_aprovar_saidas: 'nao' }));
chk('normalizarPermissoes: JSON em texto e valores "não"/false viram false (nunca liberam por engano)', n2.liberacao_gerencial === false && n2.recebiveis_aprovar_saidas === false, n2);
chk('normalizarPermissoes: formato desconhecido = sem acesso (sem exceção)', JSON.stringify(P.normalizarPermissoes('{quebrado')) === '{}' && JSON.stringify(P.normalizarPermissoes(null)) === '{}' && JSON.stringify(P.normalizarPermissoes(42)) === '{}', '');

/* ---------- 3 · autorizar pagamentos: só com o nível em Visão e o recurso ligado ---------- */
const a1 = P.permissoesEfetivas(op({ visao: 'ler', recebiveis_aprovar_saidas: true }), todos);
chk('Visão (Ler) + "Autorizar Pagamentos": o perfil recebe a permissão e a leitura do painel', a1.has('recebiveis_aprovar_saidas') && a1.has('visao.dashboard') && !a1.has('liberacao_gerencial') && !a1.has('rh.ver_salarios'), [...a1]);
const a2 = P.permissoesEfetivas(op({ recebiveis_aprovar_saidas: true }), todos);
chk('"Autorizar Pagamentos" sem nível em Visão → não vale (a opção só existe dentro do módulo)', !a2.has('recebiveis_aprovar_saidas'), [...a2]);
const a3 = P.permissoesEfetivas(op({ visao: 'ler', recebiveis_aprovar_saidas: true }), sem(['gestao_v1402']));
chk('recurso gestao_v1402 desligado (Produção): a autorização não existe, mesmo marcada', !a3.has('recebiveis_aprovar_saidas'), [...a3]);
const a4 = P.permissoesEfetivas(op({ visao: 'ler' }), todos);
chk('Visão (Ler) sem a opção marcada → não autoriza', !a4.has('recebiveis_aprovar_saidas') && a4.has('visao.dashboard'), [...a4]);

/* ---------- 4 · Liberação Gerencial ---------- */
const g = P.permissoesEfetivas(op({ liberacao_gerencial: true }), todos);
const permsMod = m => [...m.ler, ...m.modificar, ...m.excluir];
const faltam = MATRIZ.modulos.filter(m => !m.v1383 || true).flatMap(m => permsMod(m)).filter(p => !g.has(p));
chk('Liberação Gerencial: o Operacional passa a ter Ler, Modificar e Excluir de TODOS os módulos de negócio habilitados', g.has('liberacao_gerencial') && faltam.length === 0, faltam.slice(0, 12));
chk('Liberação Gerencial: abre as exclusões que exigem permissão própria (Fornecedores e Clientes) e o FCX completo', g.has('parceiros.excluir') && g.has('fcx.ver') && g.has('fcx.dfc.importar'), '');
chk('Liberação Gerencial NÃO dá salários (separação de funções) nem a autorização de pagamentos', !g.has('rh.ver_salarios') && !g.has('recebiveis_aprovar_saidas'), '');
chk('Liberação Gerencial não vira Master: sem "*" e sem nenhuma permissão técnica', !g.has('*') && ![...g].some(p => /migra|backup|ambiente|notific|^acessos\./i.test(p)), '');
chk('quem tem as duas (Gerencial + Autorizar Pagamentos + Visão) recebe a autorização pela flag própria, não pela elevação', P.permissoesEfetivas(op({ liberacao_gerencial: true, visao: 'ler', recebiveis_aprovar_saidas: true }), todos).has('recebiveis_aprovar_saidas'), '');
chk('Liberação Gerencial: salários continuam só com a permissão isolada "Pode ver salários"', P.permissoesEfetivas(op({ liberacao_gerencial: true, rh: 'ler', 'rh.ver_salarios': true }), todos).has('rh.ver_salarios'), '');
chk('Gerencial respeita os recursos do ambiente: módulo atrás de recurso desligado (Contábil/Fornecedores) não é elevado', (() => { const x = P.permissoesEfetivas(op({ liberacao_gerencial: true }), sem(['contabil_v1386', 'gestao_v1394'])); return !x.has('parceiros.excluir') && x.has('fcx.ver'); })(), '');
chk('Gerencial exige a Gestão de Acessos v13.83 (sem ela a opção não existe)', !P.permissoesEfetivas(op({ liberacao_gerencial: true }), sem(['acessos_v1383'])).has('liberacao_gerencial'), '');
chk('Gerencial com o recurso gestao_v1402 desligado: sem efeito', !P.permissoesEfetivas(op({ liberacao_gerencial: true }), sem(['gestao_v1402'])).has('liberacao_gerencial') && !P.permissoesEfetivas(op({ liberacao_gerencial: true }), sem(['gestao_v1402'])).has('fcx.dfc.importar'), '');
const lj = P.permissoesEfetivas(op({ liberacao_gerencial: true, fcx: 'excluir' }, 'LOJA'), todos);
chk('perfil LOJA nunca é elevado: só leitura, sem Modificar/Excluir mesmo com a flag marcada', !lj.has('fcx.dfc.importar') && !lj.has('parceiros.excluir') && !lj.has('*'), [...lj].filter(p => /importar|excluir/.test(p)));
chk('Master: "*" (qualquer grafia do perfil: Gestor/Admin) e perfil desconhecido: nada', P.permissoesEfetivas({ perfil: 'master' }).has('*') && P.permissoesEfetivas({ perfil: 'Gestor' }).has('*') && P.permissoesEfetivas({ perfil: 'admin' }).has('*') && P.permissoesEfetivas({ perfil: 'convidado', permissoes: { fcx: 'excluir' } }).size === 0, '');

/* ---------- 5 · sem Gerencial, o que o perfil marca é o que vale (nada de trava Master escondida) ---------- */
const f1 = P.permissoesEfetivas(op({ fcx: 'ler' }), todos);
chk('só Ler no FCX: lê o FCX, não importa extrato nem exclui (flags do perfil, nem a mais nem a menos)', f1.has('fcx.ver') && !f1.has('fcx.dfc.importar') && !f1.has('parceiros.excluir'), [...f1]);
const f2 = P.permissoesEfetivas(op({ fcx: 'modificar' }), todos);
chk('FCX em Modificar libera as gravações do FCX e continua sem as exclusões dos outros módulos', f2.has('fcx.dfc.importar') && !f2.has('parceiros.excluir'), '');

/* ---------- 6 · coleções que só o Master abria e agora seguem as flags ---------- */
const sess = (perms, extras = {}) => ({ perfil: 'OPERACIONAL', trocaPendente: false, perms: new Set(perms), ...extras });
chk('conc_fechamento (Resumo do Recebível): lê quem vê o FCX, o painel ou a Retaguarda de adquirentes; grava só quem importa', P.acessoPorMatriz(sess(['fcx.ver']), 'conc_fechamento', 'r') && P.acessoPorMatriz(sess(['visao.dashboard']), 'conc_fechamento', 'r') && P.acessoPorMatriz(sess(['retaguarda.adq.ver']), 'conc_fechamento', 'r')
  && !P.acessoPorMatriz(sess(['fcx.ver']), 'conc_fechamento', 'w') && P.acessoPorMatriz(sess(['retaguarda.adq.importar']), 'conc_fechamento', 'w'), '');
chk('ret_ocorrencias / cred_pendencias: seguem as permissões de Ocorrências e Faltas (não mais só o Master)', P.acessoPorMatriz(sess(['retaguarda.ocorrencias.lancar']), 'ret_ocorrencias', 'w') && P.acessoPorMatriz(sess(['retaguarda.faltas.status']), 'cred_pendencias', 'r') && !P.acessoPorMatriz(sess(['retaguarda.faltas.status']), 'ret_ocorrencias', 'w'), '');
chk('alertas e seguros_vigencia: gravação pelas permissões do IEO e dos Contratos', P.acessoPorMatriz(sess(['retaguarda.ieo.lancar']), 'alertas', 'w') && P.acessoPorMatriz(sess(['lojas.contratos.editar']), 'seguros_vigencia', 'w') && !P.acessoPorMatriz(sess([]), 'alertas', 'w'), '');
chk('prefixo de ambiente (amb/<nome>/...) é ignorado na decisão; coleção desconhecida nunca é liberada por aqui', P.acessoPorMatriz(sess(['fcx.ver']), 'amb/homolog/conc_fechamento', 'r') && !P.acessoPorMatriz(sess(['fcx.ver']), 'configuracao', 'r') && !P.acessoPorMatriz(sess(['fcx.ver']), 'usuarios/x', 'r'), '');
chk('Loja nunca grava por esta via e sessão com troca de senha pendente não lê nada', !P.acessoPorMatriz(sess(['retaguarda.ocorrencias.lancar'], { perfil: 'LOJA' }), 'ret_ocorrencias', 'w') && !P.acessoPorMatriz(sess(['fcx.ver'], { trocaPendente: true }), 'conc_fechamento', 'r') && !P.acessoPorMatriz(null, 'conc_fechamento', 'r'), '');
chk('Master ("*") passa em todas as coleções da lista', Object.keys(P.COLECOES_MATRIZ).every(c => P.acessoPorMatriz(sess(['*']), c, 'r') || P.COLECOES_MATRIZ[c][0].length === 0) && Object.keys(P.COLECOES_MATRIZ).every(c => P.acessoPorMatriz(sess(['*']), c, 'w') || P.COLECOES_MATRIZ[c][1].length === 0), '');
chk('salários: leitura só com "Pode ver salários" e NUNCA gravação por esta via (nem com Gerencial)', P.acessoPorMatriz(sess(['rh.ver_salarios']), 'salarios', 'r') && !P.acessoPorMatriz(sess(['rh.ver_salarios']), 'salarios', 'w') && !P.acessoPorMatriz({ ...sess([...g]) }, 'salarios', 'r') && !P.acessoPorMatriz(sess([...g]), 'salarios', 'w'), '');

/* ---------- 7 · exclusões ---------- */
chk('exclusão em Fornecedores e Clientes exige "parceiros.excluir" (editar não basta); a elevação Gerencial inclui essa exclusão; Master sempre pode', P.exclusaoPermitida(sess(['parceiros.editar']), 'parceiros/x') === false && P.exclusaoPermitida(sess(['parceiros.excluir']), 'parceiros/x') && P.exclusaoPermitida(sess([...g]), 'parceiros/x') && P.exclusaoPermitida({ nivel: 3, perms: new Set(['*']) }, 'parceiros/x') && P.exclusaoPermitida(sess([]), 'fcx/qualquer'), '');

console.log('\nOK (' + OK.length + ')  FALHAS (' + FAIL.length + ')'); process.exit(FAIL.length ? 1 : 0);
