/* v14.11 · Servidor: gravação EM MASSA de cadastros (POST /api/docs/massa) contra um Postgres de verdade, com dados FICTÍCIOS.
   1) 2.000 cadastros por requisição em UMA instrução SQL; 12 lotes seguidos (24.000 cadastros) gravam tudo, sem duplicar, em poucos segundos;
   2) idempotente: reenviar o mesmo lote não duplica nada (a versão do documento sobe); o campo id nunca vai para dentro dos dados;
   3) atômico: um lote com um registro inválido não grava nenhum dos outros;
   4) acesso: sem sessão 401; perfil Loja e Operacional só com leitura 403; Operacional com "Fornecedores e Clientes: modificar" e Master gravam;
   5) limites: mais de 2.000 registros, coleção fora da lista (usuarios, config, lojas), id inválido, repetido, dados que não são objeto, lote acima de 5 MB / 6 MB;
   6) um registro no log de mudanças por lote (os demais computadores consultam só a coleção) e a listagem paginada devolve os cadastros gravados.
   Uso: bash tests/preparar-banco.sh && NETLIFY_DB_URL=postgres://… node tests/servidor-local.mjs 8890 &  e depois  NETLIFY_DB_URL=… node tests/teste-massa-db-1411.mjs */
import pg from 'pg';
import { gerar } from '../netlify/lib/senha.mjs';

const U = process.env.PAINEL_URL || 'http://localhost:8890', OK = [], FAIL = [];
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x !== '' ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 900) : '')); };
const db = new pg.Pool({ connectionString: process.env.NETLIFY_DB_URL }), sql = (t, p) => db.query(t, p).then(r => r.rows);
const doc = async (caminho, dados) => { const i = caminho.lastIndexOf('/'); await sql(`INSERT INTO documentos (caminho, colecao, doc_id, dados) VALUES ($1, $2, $3, $4) ON CONFLICT (caminho) DO UPDATE SET dados = EXCLUDED.dados`, [caminho, caminho.slice(0, i), caminho.slice(i + 1), JSON.stringify(dados)]); };
const usuario = (id, perfil, cpf, permissoes = {}) => doc('usuarios/' + id, { perfil, nome: 'Teste ' + id, cpf, ativo: true, permissoes, trocarSenha: false, senha: gerar('Teste2026Ab', 'sal-' + id) });
const login = async cpf => { const r = await fetch(U + '/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json', 'x-painel': '1' }, body: JSON.stringify({ cpf, senha: 'Teste2026Ab' }) }); const c = r.headers.get('set-cookie'); if (!c) throw new Error('login falhou ' + r.status + ' ' + await r.text()); return c.split(';')[0]; };
const cli = ck => async (met, rota, corpo) => { const r = await fetch(U + rota, { method: met, headers: { ...(ck ? { cookie: ck } : {}), 'content-type': 'application/json', 'x-painel': '1' }, body: corpo === undefined ? undefined : typeof corpo === 'string' ? corpo : JSON.stringify(corpo) }); let j = {}; try { j = await r.json(); } catch { } return { s: r.status, j }; };
const lote = (ini, n, extra = {}) => Array.from({ length: n }, (_, i) => ({ id: 'par-m' + String(ini + i).padStart(6, '0'), dados: { tipo: 'PJ', papeis: ['fornecedor'], documento: '11.222.333/0001-81', nome: 'Fornecedor Exemplo ' + (ini + i) + ' Ltda', chavesPix: [{ tipo: 'email', chave: `f${ini + i}@exemplo.com.br` }], ativo: true, ...extra } }));

await sql(`DELETE FROM documentos WHERE colecao = 'parceiros' AND doc_id LIKE 'par-m%'`);
/* o módulo Fornecedores e Clientes só concede permissões do Operacional com o recurso gestao_v1394 liberado no ambiente (Produção lê config/recursos; Homologação libera tudo) */
const recAntes = (await sql(`SELECT dados FROM documentos WHERE caminho = 'config/recursos'`))[0]?.dados || null;
await doc('config/recursos', { ...(recAntes || {}), gestao_v1394: { ativo: true } });
await usuario('usr-m-master', 'MASTER', '12345678909');
await usuario('usr-m-edita', 'OPERACIONAL', '11144477735', { parceiros: 'modificar' });
await usuario('usr-m-le', 'OPERACIONAL', '39053344705', { parceiros: 'ler' });
await usuario('usr-m-loja', 'LOJA', '71428793860', {});
const [M, E, L, J, anon] = [cli(await login('12345678909')), cli(await login('11144477735')), cli(await login('39053344705')), cli(await login('71428793860')), cli(null)];
const seqAntes = Number((await sql('SELECT COALESCE(max(seq), 0)::bigint AS s FROM mudancas'))[0].s);

/* ---------- 1 · 2.000 por requisição e 24.000 em 12 lotes ---------- */
let t0 = Date.now(); const r1 = await M('POST', '/api/docs/massa', { colecao: 'parceiros', docs: lote(0, 2000) }), ms1 = Date.now() - t0;
chk('POST /api/docs/massa com 2.000 cadastros: 200 e { gravados: 2000 }, em poucos segundos', r1.s === 200 && r1.j.gravados === 2000 && ms1 < 8000, [r1.s, r1.j, ms1]);
console.log(`     (2.000 cadastros em ${ms1} ms)`);
chk('2.000 linhas no banco, coleção parceiros, caminho = coleção/id, sem o campo id dentro dos dados', Number((await sql(`SELECT count(*) AS n FROM documentos WHERE colecao = 'parceiros' AND doc_id LIKE 'par-m%'`))[0].n) === 2000 && (await sql(`SELECT count(*) AS n FROM documentos WHERE caminho LIKE 'parceiros/par-m%' AND dados ? 'id'`))[0].n === '0');
const um = (await sql(`SELECT dados, versao, atualizado_por FROM documentos WHERE caminho = 'parceiros/par-m000007'`))[0];
chk('conteúdo preservado (aninhados, acentos) e auditoria de quem gravou', um.dados.nome === 'Fornecedor Exemplo 7 Ltda' && um.dados.chavesPix[0].chave === 'f7@exemplo.com.br' && um.versao === 1 && um.atualizado_por, um);
t0 = Date.now(); let okTodos = true; for (let k = 1; k < 12; k++) { const r = await M('POST', '/api/docs/massa', { colecao: 'parceiros', docs: lote(k * 2000, 2000) }); okTodos = okTodos && r.s === 200 && r.j.gravados === 2000; }
const ms12 = Date.now() - t0 + ms1;
chk(`12 lotes seguidos de 2.000 (24.000 cadastros) gravam tudo (${(ms12 / 1000).toFixed(1)} s no total)`, okTodos && Number((await sql(`SELECT count(*) AS n FROM documentos WHERE colecao = 'parceiros' AND doc_id LIKE 'par-m%'`))[0].n) === 24000 && ms12 < 90000, ms12);
console.log(`     (24.000 cadastros em ${ms12} ms)`);

/* ---------- 2 · idempotência ---------- */
const r2 = await M('POST', '/api/docs/massa', { colecao: 'parceiros', docs: lote(0, 2000, { ativo: false }) });
const dois = (await sql(`SELECT dados, versao FROM documentos WHERE caminho = 'parceiros/par-m000007'`))[0];
chk('reenviar o mesmo lote não duplica (continuam 24.000), atualiza o conteúdo e sobe a versão do documento', r2.s === 200 && Number((await sql(`SELECT count(*) AS n FROM documentos WHERE colecao = 'parceiros' AND doc_id LIKE 'par-m%'`))[0].n) === 24000 && dois.dados.ativo === false && dois.versao === 2, dois);

/* ---------- 3 · atomicidade ---------- */
const ruim = lote(900000, 5); ruim[3].id = 'a/b';
const r3 = await M('POST', '/api/docs/massa', { colecao: 'parceiros', docs: ruim });
chk('lote com um registro inválido: 400 e NENHUM dos outros 4 é gravado', r3.s === 400 && Number((await sql(`SELECT count(*) AS n FROM documentos WHERE doc_id LIKE 'par-m9%'`))[0].n) === 0, r3);

/* ---------- 4 · acesso ---------- */
chk('sem sessão: 401', (await anon('POST', '/api/docs/massa', { colecao: 'parceiros', docs: lote(0, 1) })).s === 401);
chk('perfil Loja: 403', (await J('POST', '/api/docs/massa', { colecao: 'parceiros', docs: lote(0, 1) })).s === 403);
chk('Operacional só com leitura em Fornecedores e Clientes: 403', (await L('POST', '/api/docs/massa', { colecao: 'parceiros', docs: lote(0, 1) })).s === 403);
const re = await E('POST', '/api/docs/massa', { colecao: 'parceiros', docs: lote(950000, 3) });
chk('Operacional com "Fornecedores e Clientes: modificar" grava (o mesmo que a matriz já libera no envio comum)', re.s === 200 && re.j.gravados === 3, re);

/* ---------- 5 · limites e entradas inválidas ---------- */
const rej = async (corpo, st) => { const r = await M('POST', '/api/docs/massa', corpo); return r.s === st ? '' : `${r.s}:${JSON.stringify(r.j).slice(0, 80)}`; };
const falhas = (await Promise.all([
  rej({ colecao: 'parceiros', docs: lote(0, 2001) }, 400), rej({ colecao: 'parceiros', docs: [] }, 400), rej({ colecao: 'usuarios', docs: lote(0, 1) }, 400), rej({ colecao: 'config', docs: lote(0, 1) }, 400), rej({ colecao: 'lojas', docs: lote(0, 1) }, 400),
  rej({ colecao: 'parceiros', docs: [{ id: 'x', dados: [1] }] }, 400), rej({ colecao: 'parceiros', docs: [{ id: '', dados: {} }] }, 400), rej({ colecao: 'parceiros', docs: [{ id: 'd', dados: {} }, { id: 'd', dados: {} }] }, 400),
  rej({ colecao: 'parceiros' }, 400), rej({ docs: lote(0, 1) }, 400),
  rej({ colecao: 'parceiros', docs: Array.from({ length: 6 }, (_, i) => ({ id: 'grande' + i, dados: { x: 'y'.repeat(1.2 * 1048576) } })) }, 413),
])).filter(Boolean);
chk('limites: >2.000, vazio, coleção fora da lista (usuarios, config, lojas), dados que não são objeto, id vazio, id repetido, corpo incompleto e lote de 7 MB são recusados', !falhas.length, falhas);
const inv = await M('POST', '/api/docs/massa', '{ isso não é json');
chk('corpo que não é JSON: 400', inv.s === 400);
chk('nada de colecao "usuarios" gravado pela via de massa (a regra de usuários continua só no envio comum)', Number((await sql(`SELECT count(*) AS n FROM documentos WHERE colecao = 'usuarios' AND doc_id LIKE 'par-m%'`))[0].n) === 0);
chk('GET no endpoint de massa: 405', (await M('GET', '/api/docs/massa')).s === 405);

/* ---------- 6 · log de mudanças e leitura ---------- */
const mud = await sql(`SELECT caminho, colecao, op FROM mudancas WHERE seq > $1 AND colecao = 'parceiros'`, [seqAntes]);
chk('log de mudanças: UMA linha por lote (14 requisições aceitas = 14 linhas), todas da coleção parceiros', mud.length === 12 + 1 + 1 /* 12 lotes + reenvio + operacional */ && mud.every(m => m.caminho === 'parceiros/_massa' && m.op === 'set'), [mud.length, mud[0]]);
const sinc = await M('GET', '/api/mudancas?desde=' + seqAntes);
chk('o consultor de mudanças dos outros computadores enxerga a coleção parceiros alterada', sinc.s === 200 && sinc.j.colecoes.includes('parceiros'), sinc.j);
let apos = '', total = 0, pags = 0; for (let i = 0; i < 200; i++) { const p = await M('GET', '/api/docs?colecao=parceiros' + (apos ? '&apos=' + encodeURIComponent(apos) : '')); total += p.j.docs.filter(d => d.id.startsWith('par-m')).length; pags++; if (!p.j.proximo) break; apos = p.j.proximo; }
chk('a listagem paginada devolve todos os cadastros gravados em massa (24.000 + 3), cada um com o id', total === 24003 && pags >= 2, [total, pags]);
const get = await M('GET', '/api/docs?caminho=' + encodeURIComponent('parceiros/par-m000007'));
chk('leitura de um cadastro: { id, ...dados }', get.j.doc && get.j.doc.id === 'par-m000007' && get.j.doc.nome === 'Fornecedor Exemplo 7 Ltda');

await sql(`DELETE FROM documentos WHERE colecao = 'parceiros' AND doc_id LIKE 'par-m%'`);
if (recAntes) await doc('config/recursos', recAntes); else await sql(`DELETE FROM documentos WHERE caminho = 'config/recursos'`);
await db.end();
console.log(`\n${OK.length} ok, ${FAIL.length} falha(s)`);
if (FAIL.length) { console.log('FALHAS:\n - ' + FAIL.join('\n - ')); process.exit(1); }
