/* v13.94 · Teste da automação de migrações (netlify/lib/migracoes.mjs, scripts/run-migrations.mjs e /api/migracoes).
   Só dados FICTÍCIOS. Cria e apaga bancos temporários (painel_mig_*) no mesmo Postgres do teste; a parte da API usa o servidor local.
   Uso:
     bash tests/preparar-banco.sh
     NETLIFY_DB_URL=postgres://postgres@127.0.0.1:54329/painel_teste node tests/servidor-local.mjs 8890 &
     NETLIFY_DB_URL=postgres://postgres@127.0.0.1:54329/painel_teste node tests/teste-migracoes.mjs */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { gerar } from '../netlify/lib/senha.mjs';
import { dividirComandos, classificar, catalogoDePasta, gerarEmbutidas, executar, situacao, VERIFICACOES } from '../netlify/lib/migracoes.mjs';
import { MIGRACOES } from '../netlify/lib/migracoes-embutidas.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), PASTA = path.join(raiz, 'netlify/database/migrations');
const U = 'http://localhost:8890', OK = [], FAIL = [];
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 1500) : '')); };
const URL_BASE = new URL(process.env.NETLIFY_DB_URL), urlDe = nome => { const u = new URL(URL_BASE); u.pathname = '/' + nome; return u.toString(); };
const admin = new pg.Pool({ connectionString: urlDe('postgres') }), principal = new pg.Pool({ connectionString: process.env.NETLIFY_DB_URL });
const sql = (t, p) => principal.query(t, p).then(r => r.rows);

/* ---------- bancos temporários ---------- */
const criados = [], pools = [];
async function novoBanco(sufixo, { esquema = false, exceto = [] } = {}) {
  const nome = `painel_mig_${sufixo}_${process.pid}`; await admin.query(`DROP DATABASE IF EXISTS ${nome} WITH (FORCE)`); await admin.query(`CREATE DATABASE ${nome}`); criados.push(nome);
  const pool = new pg.Pool({ connectionString: urlDe(nome) }); pool.on('error', () => { /* conexão encerrada ao apagar o banco temporário */ }); pools.push(pool);
  if (esquema) for (const f of fs.readdirSync(PASTA).filter(f => f.includes('_esquema_') && !exceto.includes(f)).sort()) await pool.query(fs.readFileSync(path.join(PASTA, f), 'utf8'));
  return { nome, pool, url: urlDe(nome) };
}
const col = async (pool, t, c) => (await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`, [t, c])).rowCount === 1;
const existe = async (pool, rel) => (await pool.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, ['public.' + rel])).rows[0].ok;
const estado = (rel, nome) => rel.migracoes.find(m => m.nome === nome)?.estado;
const RECEITA = '20261110120000_esquema_empresas_receita.sql', ADIANT = '20261107120000_esquema_adiantamentos.sql', BACKUPS = '20261111120000_esquema_backups_nuvem.sql'; /* v13.95: tabela dos pontos de restauração */
const ADITIVAS = [ADIANT, RECEITA, BACKUPS], NETLIFY = ['20261027120000_esquema_inicial.sql', '20261027120100_semente_inicial.sql', '20261106120000_esquema_contabil.sql', '20261106130000_esquema_contabil_depara.sql', '20261108120000_esquema_empresas.sql'];
const cat = catalogoDePasta(PASTA);
const sintetica = (nome, sqlTxt) => { const c = classificar(sqlTxt); return { nome, sha256: nome, aditiva: c.aditiva, motivo: c.motivo, sql: c.aditiva ? sqlTxt : null }; };
const roda = (args, env = {}, cwd = raiz) => { const e = { ...process.env, ...env }; for (const k of ['NETLIFY_DB_URL', 'DATABASE_URL', 'NETLIFY_DATABASE_URL', 'MIGRACOES_ESTRITO', 'MIGRACOES_DESLIGADAS']) if (!(k in env)) delete e[k]; const r = spawnSync('node', ['scripts/run-migrations.mjs', ...args], { cwd, env: e, encoding: 'utf8', timeout: 60000 }); return { cod: r.status, out: (r.stdout || '') + (r.stderr || '') }; };

try {
/* =========================================================================== 1 · análise do SQL (sem banco) */
const d1 = dividirComandos(`-- comentário; com ponto e vírgula
CREATE TABLE IF NOT EXISTS a (x text DEFAULT 'a;b', y text); /* bloco; /* aninhado; */ ainda comentário */
CREATE FUNCTION f() RETURNS int LANGUAGE sql AS $$ SELECT 1; SELECT 2; $$;
CREATE FUNCTION g() RETURNS text LANGUAGE sql AS $corpo$ SELECT ';' $corpo$;
SELECT E'it\\'s; ok', "col;umn", 'dobra''da;'`);
chk('dividirComandos: ignora ; em comentário (simples e aninhado), em texto entre aspas (inclusive E\'…\' e aspas dobradas), em identificador entre aspas e em $$…$$ / $tag$…$tag$', d1.length === 4 && /^CREATE TABLE IF NOT EXISTS a/.test(d1[0]) && !/comentário/.test(d1[0]) && /SELECT 1; SELECT 2;/.test(d1[1]) && /\$corpo\$ SELECT ';' \$corpo\$$/.test(d1[2]) && /col;umn/.test(d1[3]), d1);
const adit = [
  'CREATE TABLE IF NOT EXISTS t (id text PRIMARY KEY, v numeric(10, 2) DEFAULT 0, j jsonb NOT NULL DEFAULT \'[]\'::jsonb, CHECK (v >= 0))',
  'CREATE INDEX IF NOT EXISTS i1 ON t (id)', 'create unique index if not exists i2 on t (v) where v is not null',
  'CREATE EXTENSION IF NOT EXISTS pgcrypto',
  'ALTER TABLE t ADD COLUMN IF NOT EXISTS c text',
  'ALTER TABLE public.t ADD COLUMN IF NOT EXISTS c text NOT NULL DEFAULT \'x\', ADD COLUMN IF NOT EXISTS d numeric(10, 2) DEFAULT 1, ADD COLUMN IF NOT EXISTS e text CHECK (e IN (\'a\', \'b\'))',
  'ALTER TABLE IF EXISTS ONLY "t" ADD COLUMN IF NOT EXISTS c text',
  '-- INSERT INTO t VALUES (1);\nCREATE INDEX IF NOT EXISTS i3 ON t (id); /* DELETE FROM t */',
  "CREATE TABLE IF NOT EXISTS t2 (a text DEFAULT 'INSERT INTO x; DROP TABLE y')",
];
const nao = {
  'CREATE TABLE sem IF NOT EXISTS': 'CREATE TABLE t (id int)', 'CREATE TABLE IF NOT EXISTS … AS SELECT': 'CREATE TABLE IF NOT EXISTS t AS SELECT 1', 'INSERT': 'INSERT INTO t VALUES (1)', 'UPDATE': 'UPDATE t SET a = 1', 'DELETE': 'DELETE FROM t',
  'TRUNCATE': 'TRUNCATE t', 'DROP TABLE IF EXISTS': 'DROP TABLE IF EXISTS t', 'DROP COLUMN': 'ALTER TABLE t DROP COLUMN IF EXISTS c', 'ADD COLUMN sem IF NOT EXISTS': 'ALTER TABLE t ADD COLUMN c text',
  'ALTER misto (uma ação sem IF NOT EXISTS)': 'ALTER TABLE t ADD COLUMN IF NOT EXISTS c text, ADD COLUMN d text', 'ALTER TYPE': 'ALTER TABLE t ALTER COLUMN c TYPE int', 'RENAME': 'ALTER TABLE t RENAME COLUMN a TO b',
  'CREATE OR REPLACE FUNCTION': 'CREATE OR REPLACE FUNCTION f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$', 'CREATE VIEW': 'CREATE VIEW v AS SELECT 1', 'CREATE TRIGGER': 'CREATE TRIGGER x BEFORE INSERT ON t FOR EACH ROW EXECUTE FUNCTION f()',
  'CREATE INDEX sem IF NOT EXISTS': 'CREATE INDEX i ON t (a)', 'CREATE INDEX CONCURRENTLY': 'CREATE INDEX CONCURRENTLY IF NOT EXISTS i ON t (a)', 'DO $$': 'DO $$ BEGIN DELETE FROM t; END $$',
  'transação explícita': 'BEGIN; CREATE INDEX IF NOT EXISTS i ON t (a); COMMIT', 'aditivo + INSERT escondido depois do ;': 'CREATE INDEX IF NOT EXISTS i ON t (a); INSERT INTO t VALUES (1)', 'só comentário': '-- nada aqui', 'vazio': '',
};
chk(`classificar: ${adit.length} formas aditivas (tabela/índice/extensão com IF NOT EXISTS, ALTER só com ADD COLUMN IF NOT EXISTS — vírgulas dentro de numeric(10,2) e CHECK não enganam; INSERT em comentário ou em texto não conta) são aceitas`, adit.every(x => classificar(x).aditiva), adit.filter(x => !classificar(x).aditiva));
chk(`classificar: ${Object.keys(nao).length} formas NÃO aditivas são recusadas (CREATE sem IF NOT EXISTS, CTAS, INSERT/UPDATE/DELETE/TRUNCATE, DROP, ALTER misto/TYPE/RENAME, função, view, gatilho, CONCURRENTLY, DO, BEGIN/COMMIT, INSERT escondido depois de ';', vazio)`,
  Object.entries(nao).every(([, x]) => !classificar(x).aditiva), Object.entries(nao).filter(([, x]) => classificar(x).aditiva).map(([k]) => k));
chk('catálogo real (8 arquivos): só as 3 migrações repetíveis (adiantamentos, Receita e pontos de restauração) são aditivas; esquema inicial, semente, contábil, de-para e empresas ficam com o Netlify', cat.length === 8 && cat.filter(m => m.aditiva).map(m => m.nome).join() === ADITIVAS.join() && NETLIFY.every(n => cat.find(m => m.nome === n && !m.aditiva)), cat.map(m => [m.nome, m.aditiva]));
chk('catálogo em ordem lexicográfica (a mesma do Netlify) e o SQL só vai junto das aditivas (a semente nunca é embutida)', cat.map(m => m.nome).join() === [...cat.map(m => m.nome)].sort().join() && cat.every(m => m.aditiva ? typeof m.sql === 'string' : m.sql === null));
chk('módulo embutido (netlify/lib/migracoes-embutidas.mjs) em dia com a pasta de migrações e idêntico ao que o build geraria', gerarEmbutidas(cat) === fs.readFileSync(path.join(raiz, 'netlify/lib/migracoes-embutidas.mjs'), 'utf8') && MIGRACOES.length === 8
  && MIGRACOES.every((m, i) => m.nome === cat[i].nome && m.sha256 === cat[i].sha256 && m.aditiva === cat[i].aditiva) && fs.statSync(path.join(raiz, 'netlify/lib/migracoes-embutidas.mjs')).size < 20000 /* a semente tem ~90 KB: se estivesse embutida, passaria disso */);
const tmpLeg = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-sub-')); fs.mkdirSync(path.join(tmpLeg, '20270101000000_sub')); fs.writeFileSync(path.join(tmpLeg, '20270101000000_sub/migration.sql'), 'CREATE INDEX IF NOT EXISTS i ON t (a);'); fs.writeFileSync(path.join(tmpLeg, 'leiame.txt'), 'x');
chk('subpasta <nome>/migration.sql (formato aceito pelo Netlify) também é lida; outros arquivos são ignorados', JSON.stringify(catalogoDePasta(tmpLeg).map(m => [m.nome, m.aditiva])) === '[["20270101000000_sub",true]]' && catalogoDePasta('/nao/existe').length === 0);

/* =========================================================================== 2 · banco NOVO (o Netlify ainda não montou nada) */
const novo = await novoBanco('novo');
const rN = await executar(novo.pool, cat, { origem: 'build' });
chk('banco novo: nada é executado ("adiada" para as aditivas, "geridas pelo Netlify" para as outras) e o banco continua vazio — o esquema inicial é do deploy do Netlify',
  rN.base === false && rN.executadas.length === 0 && !rN.falhou && ADITIVAS.every(n => estado(rN, n) === 'adiada') && NETLIFY.every(n => estado(rN, n) === 'netlify')
  && !(await existe(novo.pool, 'painel_migracoes')) && !(await existe(novo.pool, 'documentos')), rN);
const sN = await situacao(novo.pool, cat);
chk('banco novo: a situação (só leitura) mostra o mesmo e não cria nada', sN.base === false && sN.livro === false && sN.esquema.length === 0 && !(await existe(novo.pool, 'painel_migracoes')), sN);

/* =========================================================================== 3 · banco EXISTENTE com a migração da v13.94 pendente */
const ex = await novoBanco('ex', { esquema: true, exceto: [RECEITA, BACKUPS] }); // o que o Netlify já tinha aplicado até a v13.93
await ex.pool.query(`INSERT INTO documentos (caminho, colecao, doc_id, dados) VALUES ('lojas/loja-ficticia-1', 'lojas', 'loja-ficticia-1', '{"nome":"Loja Fictícia 1"}')`);
await ex.pool.query(`INSERT INTO contab_empresas (id, razao_social) VALUES ('emp_ficticia', 'Empresa Fictícia LTDA') ON CONFLICT (id) DO NOTHING`);
const antes = { docs: (await ex.pool.query('SELECT count(*)::int n FROM documentos')).rows[0].n, emp: (await ex.pool.query('SELECT count(*)::int n FROM contab_empresas')).rows[0].n };
const s1 = await situacao(ex.pool, cat);
chk('banco existente: a situação mostra a migração da Receita "pendente", o esquema incompleto (coluna contab_empresas.receita) e não altera nada', s1.base && !s1.livro && estado(s1, RECEITA) === 'pendente' && estado(s1, ADIANT) === 'pendente' && estado(s1, BACKUPS) === 'pendente'
  && s1.esquema.filter(e => !e.ok).length === 2 && s1.esquema.flatMap(e => e.falta).sort().join() === 'contab_empresas.receita,painel_backups_hist_data_ix,painel_backups_historico' && !(await col(ex.pool, 'contab_empresas', 'receita')) && !(await existe(ex.pool, 'painel_migracoes')), s1);
const r1 = await executar(ex.pool, cat, { origem: 'build' });
chk('executar: aplica as 3 aditivas (a coluna receita passa a existir, jsonb com padrão {}), registra no livro-razão e não toca nas migrações do Netlify', r1.base && r1.executadas.join() === ADITIVAS.join() && !r1.falhou && ADITIVAS.every(n => estado(r1, n) === 'aplicada')
  && NETLIFY.every(n => estado(r1, n) === 'netlify') && await col(ex.pool, 'contab_empresas', 'receita') && (await ex.pool.query(`SELECT data_type, column_default FROM information_schema.columns WHERE table_name='contab_empresas' AND column_name='receita'`)).rows[0].data_type === 'jsonb'
  && (await ex.pool.query(`SELECT receita FROM contab_empresas WHERE id='emp_ficticia'`)).rows[0].receita && Object.keys((await ex.pool.query(`SELECT receita FROM contab_empresas WHERE id='emp_ficticia'`)).rows[0].receita).length === 0, r1);
const livro = (await ex.pool.query('SELECT nome, sha256, origem FROM painel_migracoes ORDER BY nome')).rows;
chk('livro-razão: uma linha por migração aplicada, com o hash do arquivo e a origem "build" (nenhum dado pessoal)', livro.length === 3 && livro.every(l => l.origem === 'build' && cat.find(m => m.nome === l.nome)?.sha256 === l.sha256) && Object.keys((await ex.pool.query('SELECT * FROM painel_migracoes LIMIT 1')).rows[0]).sort().join() === 'aplicada_em,nome,origem,sha256');
const depois = { docs: (await ex.pool.query('SELECT count(*)::int n FROM documentos')).rows[0].n, emp: (await ex.pool.query('SELECT count(*)::int n FROM contab_empresas')).rows[0].n };
chk('os dados ficam como estavam: a semente e o INSERT da migração de empresas NÃO rodaram de novo (mesma contagem de documentos e de empresas)', depois.docs === antes.docs && depois.emp === antes.emp, [antes, depois]);
const r2 = await executar(ex.pool, cat, { origem: 'botao' });
chk('segunda execução: nada a fazer (idempotente) — as três aparecem "aplicadas" com a origem original e o livro não muda', r2.executadas.length === 0 && ADITIVAS.every(n => estado(r2, n) === 'aplicada' && r2.migracoes.find(m => m.nome === n).origem === 'build' && !r2.migracoes.find(m => m.nome === n).agora)
  && (await ex.pool.query('SELECT count(*)::int n FROM painel_migracoes')).rows[0].n === 3, r2);
const s2 = await situacao(ex.pool, cat);
chk('depois de executar: esquema completo (todas as verificações ok) e resumo = 3 aplicadas, 0 pendentes, 5 do Netlify', s2.esquema.length === VERIFICACOES.length && s2.esquema.every(e => e.ok) && JSON.stringify(s2.resumo) === JSON.stringify({ aplicadas: 3, pendentes: 0, adiadas: 0, netlify: 5, falhas: 0 }), s2);

/* ---- arquivo alterado depois de aplicado: avisa, não roda de novo */
const alterada = cat.map(m => (m.nome === RECEITA ? { ...m, sha256: 'outro-hash', sql: 'ALTER TABLE contab_empresas ADD COLUMN IF NOT EXISTS nova_col text' } : m));
const rA = await executar(ex.pool, alterada, { origem: 'build' });
chk('arquivo alterado depois de aplicado → aviso "alterado depois de aplicado" e o SQL novo NÃO roda (migrações aplicadas são imutáveis)', rA.executadas.length === 0 && /alterado depois/.test(rA.migracoes.find(m => m.nome === RECEITA).aviso || '') && !(await col(ex.pool, 'contab_empresas', 'nova_col')), rA);

/* =========================================================================== 4 · pré-requisito ausente = adiada (não é erro) */
const parcial = await novoBanco('parcial'); await parcial.pool.query(fs.readFileSync(path.join(PASTA, '20261027120000_esquema_inicial.sql'), 'utf8')); // só o esquema inicial: sem contab_*
const rP = await executar(parcial.pool, cat, { origem: 'build' });
chk('banco só com o esquema inicial (sem as tabelas contábeis): as que dependem delas ficam "adiadas" (relação inexistente → o Netlify aplica antes), sem falha; a dos pontos de restauração (não depende de nada) é aplicada e é a única linha do livro', rP.base && !rP.falhou && [ADIANT, RECEITA].every(n => estado(rP, n) === 'adiada' && rP.migracoes.find(m => m.nome === n).codigo === '42P01') && estado(rP, BACKUPS) === 'aplicada'
  && (await parcial.pool.query('SELECT nome FROM painel_migracoes')).rows.map(r => r.nome).join() === BACKUPS, rP);

/* =========================================================================== 5 · falha real, desfazer e parada */
const f = await novoBanco('falha', { esquema: true }); await f.pool.query(`INSERT INTO documentos (caminho, colecao, doc_id, dados) VALUES ('lojas/x', 'lojas', 'x', '{}')`);
const catF = [sintetica('20270101000000_ok.sql', 'CREATE TABLE IF NOT EXISTS mig_ok (id text PRIMARY KEY);'),
  sintetica('20270102000000_ruim.sql', 'CREATE TABLE IF NOT EXISTS mig_meio (id text);\nALTER TABLE documentos ADD COLUMN IF NOT EXISTS obrigatoria text NOT NULL;'), // 2º comando falha (há linhas)
  sintetica('20270103000000_depois.sql', 'CREATE TABLE IF NOT EXISTS mig_depois (id text);'), sintetica('20270104000000_netlify.sql', 'INSERT INTO documentos (caminho, colecao, doc_id, dados) VALUES (\'a\', \'b\', \'c\', \'{}\')')];
const rF = await executar(f.pool, catF, { origem: 'build' });
chk('falha de SQL (coluna NOT NULL sem padrão numa tabela com dados): a migração é desfeita por inteiro (o 1º comando dela também), a anterior continua aplicada, a seguinte espera ("pendente") e o relatório traz código e 1ª linha da mensagem',
  rF.falhou?.nome === '20270102000000_ruim.sql' && rF.falhou.codigo === '23502' && !/\n/.test(rF.falhou.mensagem) && estado(rF, '20270101000000_ok.sql') === 'aplicada' && estado(rF, '20270102000000_ruim.sql') === 'falhou' && estado(rF, '20270103000000_depois.sql') === 'pendente'
  && estado(rF, '20270104000000_netlify.sql') === 'netlify' && await existe(f.pool, 'mig_ok') && !(await existe(f.pool, 'mig_meio')) && !(await existe(f.pool, 'mig_depois')) && !(await col(f.pool, 'documentos', 'obrigatoria'))
  && (await f.pool.query('SELECT nome FROM painel_migracoes')).rows.map(r => r.nome).join() === '20270101000000_ok.sql', rF);
const catF2 = catF.map(m => (m.nome === '20270102000000_ruim.sql' ? sintetica(m.nome, 'CREATE TABLE IF NOT EXISTS mig_meio (id text);\nALTER TABLE documentos ADD COLUMN IF NOT EXISTS obrigatoria text DEFAULT \'x\';') : m));
const rF2 = await executar(f.pool, catF2, { origem: 'botao' });
chk('corrigida a migração, a execução seguinte continua de onde parou (a aplicada antes não repete; a corrigida e a seguinte rodam)', !rF2.falhou && rF2.executadas.join() === '20270102000000_ruim.sql,20270103000000_depois.sql' && await existe(f.pool, 'mig_meio') && await existe(f.pool, 'mig_depois'), rF2);

/* ---- livro-razão impossível de criar (nome ocupado por outro objeto) → nada roda, sem exceção */
const lv = await novoBanco('livro', { esquema: true, exceto: [RECEITA, BACKUPS] }); await lv.pool.query('CREATE SEQUENCE painel_migracoes');
const rL = await executar(lv.pool, cat, { origem: 'build' });
chk('livro-razão que não pode ser criado (nome ocupado): nada é aplicado, o motivo vem no relatório (erroLivro) e nenhuma exceção escapa', typeof rL.erroLivro === 'string' && rL.erroLivro.length > 0 && rL.executadas.length === 0 && !rL.falhou && ADITIVAS.every(n => estado(rL, n) === 'adiada') && !(await col(lv.pool, 'contab_empresas', 'receita')), rL);

/* =========================================================================== 6 · concorrência e trava */
const cc = await novoBanco('conc', { esquema: true, exceto: [RECEITA, BACKUPS] });
const [ra, rb, rc2] = await Promise.all([executar(cc.pool, cat, { origem: 'build' }), executar(cc.pool, cat, { origem: 'botao' }), executar(cc.pool, cat, { origem: 'build' })]);
const todas = [...ra.executadas, ...rb.executadas, ...rc2.executadas];
chk('três execuções ao mesmo tempo (build + botão): cada migração roda UMA vez no total, ninguém falha e o livro fica com 1 linha por migração', !ra.falhou && !rb.falhou && !rc2.falhou && todas.length === 3 && new Set(todas).size === 3 && (await cc.pool.query('SELECT count(*)::int n FROM painel_migracoes')).rows[0].n === 3, [ra.executadas, rb.executadas, rc2.executadas]);
const tr = await novoBanco('trava', { esquema: true, exceto: [RECEITA, BACKUPS] });
const seg = await tr.pool.connect(); await seg.query('BEGIN'); await seg.query('LOCK TABLE contab_empresas IN ACCESS EXCLUSIVE MODE');
const t0 = Date.now(); const rT = await executar(tr.pool, cat, { origem: 'build', lockMs: 600 }), ms = Date.now() - t0;
chk('tabela travada por outra transação: a migração espera só o tempo limite (lock_timeout) e falha com 55P03 — o build nunca fica pendurado — e nada fica pela metade', rT.falhou?.codigo === '55P03' && ms < 8000 && !(await col(tr.pool, 'contab_empresas', 'receita')) && estado(rT, RECEITA) === 'falhou', [rT.falhou, ms]);
await seg.query('ROLLBACK'); seg.release();
const rT2 = await executar(tr.pool, cat, { origem: 'build', lockMs: 600 });
chk('liberada a trava, a execução seguinte conclui', !rT2.falhou && estado(rT2, RECEITA) === 'aplicada' && await col(tr.pool, 'contab_empresas', 'receita'), rT2);

/* =========================================================================== 7 · script de build (scripts/run-migrations.mjs) */
const sb = await novoBanco('script', { esquema: true, exceto: [RECEITA, BACKUPS] }), sb2 = await novoBanco('script2', { esquema: true, exceto: [RECEITA, BACKUPS] });
const e0 = roda([]);
chk('sem NETLIFY_DB_URL/DATABASE_URL: avisa e sai com 0 (as migrações ficam para o deploy do Netlify); com MIGRACOES_ESTRITO=1 o build falha (1)', e0.cod === 0 && /sem NETLIFY_DB_URL nem DATABASE_URL/.test(e0.out) && roda([], { MIGRACOES_ESTRITO: '1' }).cod === 1, e0);
const e1 = roda([], { MIGRACOES_DESLIGADAS: '1', NETLIFY_DB_URL: sb.url });
chk('MIGRACOES_DESLIGADAS=1 pula tudo (nada é alterado no banco)', e1.cod === 0 && /desligado/.test(e1.out) && !(await existe(sb.pool, 'painel_migracoes')), e1);
const e2 = roda(['--status'], { NETLIFY_DB_URL: sb.url });
chk('--status só lista (pendentes à vista) e não altera o banco: sem livro-razão, sem coluna nova', e2.cod === 0 && /esquema_empresas_receita\.sql: pendente/.test(e2.out) && /esquema incompleto/.test(e2.out) && !(await existe(sb.pool, 'painel_migracoes')) && !(await col(sb.pool, 'contab_empresas', 'receita')), e2);
const e3 = roda([], { NETLIFY_DB_URL: sb.url });
chk('build com NETLIFY_DB_URL: aplica as pendentes ("aplicada agora"), lista as do Netlify, sai com 0', e3.cod === 0 && /esquema_empresas_receita\.sql: aplicada agora/.test(e3.out) && /esquema_inicial\.sql: gerida pelo Netlify/.test(e3.out) && /variável NETLIFY_DB_URL/.test(e3.out) && await col(sb.pool, 'contab_empresas', 'receita'), e3);
chk('a saída do build nunca mostra a URL do banco, o host, a porta, o usuário nem o nome do banco', !/postgres(ql)?:\/\//i.test(e3.out) && !e3.out.includes(URL_BASE.hostname) && !e3.out.includes(URL_BASE.port) && !e3.out.includes(sb.nome) && !/password|senha/i.test(e3.out), e3.out.slice(0, 600));
const e4 = roda([], { NETLIFY_DB_URL: sb.url });
chk('build de novo (próximo deploy): nada a aplicar, "aplicada em <data>", sai com 0', e4.cod === 0 && !/aplicada agora/.test(e4.out) && /esquema_empresas_receita\.sql: aplicada em \d{4}-\d{2}-\d{2}/.test(e4.out), e4);
const e5 = roda([], { DATABASE_URL: sb2.url });
chk('só DATABASE_URL definida: usa DATABASE_URL (variável citada no log)', e5.cod === 0 && /variável DATABASE_URL/.test(e5.out) && await col(sb2.pool, 'contab_empresas', 'receita'), e5);
const sb3 = await novoBanco('script3', { esquema: true, exceto: [RECEITA, BACKUPS] }), sb4 = await novoBanco('script4', { esquema: true, exceto: [RECEITA, BACKUPS] });
const e6 = roda([], { NETLIFY_DB_URL: sb3.url, DATABASE_URL: sb4.url });
chk('as duas definidas e diferentes: vale a NETLIFY_DB_URL (o mesmo banco que as Netlify Functions usam); a outra não é tocada', e6.cod === 0 && /variável NETLIFY_DB_URL/.test(e6.out) && await col(sb3.pool, 'contab_empresas', 'receita') && !(await col(sb4.pool, 'contab_empresas', 'receita')) && !(await existe(sb4.pool, 'painel_migracoes')), e6);
const tmpRuim = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-ruim-')); fs.writeFileSync(path.join(tmpRuim, '20270201000000_ruim.sql'), 'ALTER TABLE documentos ADD COLUMN IF NOT EXISTS obrigatoria text NOT NULL;');
await sb4.pool.query(`INSERT INTO documentos (caminho, colecao, doc_id, dados) VALUES ('lojas/y', 'lojas', 'y', '{}')`);
const e7 = roda(['--dir', tmpRuim, '--sem-embutir'], { NETLIFY_DB_URL: sb4.url });
chk('migração aditiva que falha: o build SAI COM 1 (não publica código que depende dela), mostra o arquivo, o código e a mensagem — e o banco fica como estava', e7.cod === 1 && /20270201000000_ruim\.sql/.test(e7.out) && /23502/.test(e7.out) && /interrompido/.test(e7.out) && !(await col(sb4.pool, 'documentos', 'obrigatoria')), e7);
const e8 = roda([], { NETLIFY_DB_URL: 'postgres://postgres@127.0.0.1:1/inexistente' });
chk('banco inalcançável: aviso e saída 0 (o deploy do Netlify aplica as migrações); com MIGRACOES_ESTRITO=1 a saída é 1', e8.cod === 0 && /não consegui falar com o banco/.test(e8.out) && roda([], { NETLIFY_DB_URL: 'postgres://postgres@127.0.0.1:1/inexistente', MIGRACOES_ESTRITO: '1' }).cod === 1, e8);
const e9 = roda([], { NETLIFY_DB_URL: novo.url });
chk('banco novo no build: avisa que o esquema inicial é do Netlify e não altera nada (saída 0)', e9.cod === 0 && /ainda sem o esquema inicial/.test(e9.out) && !(await existe(novo.pool, 'documentos')), e9);
const git = fs.readFileSync(path.join(raiz, 'netlify/lib/migracoes-embutidas.mjs'), 'utf8'); const e10 = roda(['--embutir']);
chk('--embutir só regenera o módulo embutido (sem banco) e o resultado é o mesmo que está no pacote', e10.cod === 0 && fs.readFileSync(path.join(raiz, 'netlify/lib/migracoes-embutidas.mjs'), 'utf8') === git, e10);
const toml = fs.readFileSync(path.join(raiz, 'netlify.toml'), 'utf8'), pk = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8'));
chk('netlify.toml: o comando de build roda run-migrations.mjs ANTES de preparar-ambiente.mjs; package.json tem "migrar" e "migrar:status"', /command\s*=\s*"node scripts\/run-migrations\.mjs && node scripts\/preparar-ambiente\.mjs"/.test(toml) && pk.scripts.migrar && pk.scripts['migrar:status'], toml.slice(0, 200));

/* =========================================================================== 8 · API /api/migracoes (servidor local sobre o painel_teste) */
const doc = async (caminho, dados) => { const i = caminho.lastIndexOf('/'); await sql(`INSERT INTO documentos (caminho, colecao, doc_id, dados) VALUES ($1, $2, $3, $4) ON CONFLICT (caminho) DO UPDATE SET dados = EXCLUDED.dados`, [caminho, caminho.slice(0, i), caminho.slice(i + 1), JSON.stringify(dados)]); };
const usuario = (id, perfil, cpf, extra = {}) => doc('usuarios/' + id, { perfil, nome: 'Teste ' + id, cpf, ativo: true, permissoes: {}, trocarSenha: false, senha: gerar('Teste2026Ab', 'sal-' + id), ...extra });
async function login(cpf) { const r = await fetch(U + '/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json', 'x-painel': '1' }, body: JSON.stringify({ cpf, senha: 'Teste2026Ab' }) }); const c = r.headers.get('set-cookie'); if (!c) throw new Error('login falhou ' + r.status + ' ' + await r.text()); return c.split(';')[0]; }
const api = async (metodo, ck, { csrf = true } = {}) => { const r = await fetch(U + '/api/migracoes', { method: metodo, headers: { ...(ck ? { cookie: ck } : {}), ...(csrf ? { 'x-painel': '1' } : {}) } }); let j = {}; const t = await r.text(); try { j = JSON.parse(t); } catch { /* sem corpo */ } return { s: r.status, j, t }; };
await usuario('usr-master-mg', 'MASTER', '52998224725'); await usuario('usr-op-mg', 'OPERACIONAL', '11144477735'); await usuario('usr-troca-mg', 'OPERACIONAL', '39053344705', { trocarSenha: true });
const M = await login('52998224725'), O = await login('11144477735');
await sql('ALTER TABLE contab_empresas DROP COLUMN IF EXISTS receita'); await sql('DROP TABLE IF EXISTS painel_backups_historico'); await sql('DELETE FROM painel_migracoes WHERE nome = ANY($1)', [[RECEITA, BACKUPS]]).catch(() => {});
const g0 = await api('GET', null), g1 = await api('GET', O), p0 = await api('POST', null), p1 = await api('POST', O);
chk('sem sessão → 401; Operacional → 403 (GET e POST); e o POST recusado não executa nada (a coluna da Receita continua ausente)', g0.s === 401 && g1.s === 403 && p0.s === 401 && p1.s === 403 && /Master/.test(g1.j.erro) && !(await col(principal, 'contab_empresas', 'receita')), [g0.s, g1.s, p0.s, p1.s]);
let TK; try { TK = await login('39053344705'); } catch { TK = null; }
chk('sessão com troca de senha pendente → 401', !TK || (await api('GET', TK)).s === 401);
const p2 = await api('POST', M, { csrf: false }), p3 = await api('PUT', M);
chk('POST sem o cabeçalho x-painel → 403 (proteção contra CSRF) e nada executa; outro método (PUT) → 405', p2.s === 403 && p3.s === 405 && !(await col(principal, 'contab_empresas', 'receita')), [p2.s, p3.s]);
const g2 = await api('GET', M);
chk('Master: GET → 200 com a situação (8 migrações, 3 aditivas, 5 do Netlify), o esquema incompleto (receita e tabela dos pontos de restauração ausentes) e sem alterar o banco', g2.s === 200 && g2.j.migracoes?.length === 8 && g2.j.migracoes.filter(m => m.tipo === 'aditiva').length === 3 && g2.j.esquema.filter(e => !e.ok).length === 2
  && !(await col(principal, 'contab_empresas', 'receita')) && typeof g2.j.ambiente === 'string', g2.t.slice(0, 600));
const p4 = await api('POST', M);
chk('Master: POST → 200 ok:true, executa a migração pendente (coluna receita criada, origem "botao" no livro-razão) e devolve a situação atualizada com o esquema completo', p4.s === 200 && p4.j.ok === true && p4.j.executadas?.includes(RECEITA) && await col(principal, 'contab_empresas', 'receita')
  && (await sql('SELECT origem FROM painel_migracoes WHERE nome = $1', [RECEITA]))[0]?.origem === 'botao' && p4.j.esquema.every(e => e.ok) && p4.j.migracoes.find(m => m.nome === RECEITA).estado === 'aplicada' && p4.j.migracoes.find(m => m.nome === RECEITA).agora === true && p4.j.migracoes.length === 8 && p4.j.resumo.pendentes === 0, p4.t.slice(0, 800));
const p5 = await api('POST', M);
chk('Master: segundo clique → 200 ok:true e nada executado (idempotente)', p5.s === 200 && p5.j.ok === true && p5.j.executadas.length === 0 && p5.j.resumo.pendentes === 0 && !p5.j.migracoes.some(m => m.agora), p5.t.slice(0, 500));
chk('a resposta nunca traz o texto SQL das migrações, a URL do banco, o host nem a porta (só nomes, estados e mensagens curtas)', ![g2.t, p4.t, p5.t].some(t => /postgres(ql)?:\/\//i.test(t) || /"sql"|PRIMARY KEY|REFERENCES|NOT NULL|DEFAULT/.test(t) || t.includes(URL_BASE.hostname) || t.includes(URL_BASE.port)), '');
} finally {
  for (const p of pools) await p.end().catch(() => {});
  for (const n of criados) await admin.query(`DROP DATABASE IF EXISTS ${n} WITH (FORCE)`).catch(e => console.log("aviso: não apaguei " + n + ": " + e.message));
}
console.log('\nOK (' + OK.length + ')  FALHAS (' + FAIL.length + ')'); await principal.end(); await admin.end(); process.exit(FAIL.length ? 1 : 0);
