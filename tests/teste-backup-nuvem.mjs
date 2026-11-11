/* v13.95 · Teste dos Pontos de Restauração na Nuvem (netlify/lib/backup-nuvem.mjs + /api/backup-nuvem + função agendada).
   Dados FICTÍCIOS (LGPD). Uso, com um Postgres local:
     bash tests/preparar-banco.sh
     NETLIFY_DB_URL=postgres://… node tests/servidor-local.mjs 8890 &
     NETLIFY_DB_URL=postgres://… node tests/teste-backup-nuvem.mjs
   Cobre: tabela e restrições, fotografia (escopo, contagens, SHA-256), primeiro acesso (qualquer perfil, sem duplicar, fuso de Brasília,
   concorrência, trava ocupada, esquema ausente), ponto manual (permissão, intervalo, limite diário), listagem (30, sem conteúdo, CPF mascarado),
   rotina agendada (idempotente, cron 23:59 BRT), retenção e a RESTAURAÇÃO (só Master, confirmação, preventivo, usuários preservados por padrão,
   auditoria/presença/sistema/arquivos/livro contábil intocados, sincronização entre computadores, e as travas: integridade, ambiente, ponto vazio,
   sem Master ativo, autoexclusão do Master, concorrência — tudo desfeito por inteiro quando uma trava recusa). */
import pg from 'pg';
import { gerar } from '../netlify/lib/senha.mjs';
import * as B from '../netlify/lib/backup-nuvem.mjs';
import agendadoFn, { config as cfgAgendado } from '../netlify/functions/backup-agendado.mjs';
import { db as dbLib } from '../netlify/lib/db.mjs';

const U = 'http://localhost:8890', OK = [], FAIL = [];
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 1400) : '')); };
const db = new pg.Pool({ connectionString: process.env.NETLIFY_DB_URL, max: 8 }), sql = (t, p) => db.query(t, p).then(r => r.rows);
const doc = (caminho, dados) => { const i = caminho.lastIndexOf('/'); return sql(`INSERT INTO documentos (caminho, colecao, doc_id, dados) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (caminho) DO UPDATE SET dados = EXCLUDED.dados, versao = documentos.versao + 1`, [caminho, caminho.slice(0, i), caminho.slice(i + 1), JSON.stringify(dados)]); };
const ler = async caminho => (await sql('SELECT dados, versao FROM documentos WHERE caminho = $1', [caminho]))[0];
const SENHA = 'Teste2026Ab', CPF = { m1: '39053344705', m2: '11144477735', op: '86288366757', loja: '24971563792', troca: '71428793860' };
const usuario = (id, perfil, cpf, extra = {}) => doc('usuarios/' + id, { perfil, nome: 'Teste ' + id, cpf, ativo: true, permissoes: {}, trocarSenha: false, senha: gerar(SENHA, 'sal-' + id), ...extra });
async function entrar(cpf) { const r = await fetch(U + '/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json', 'x-painel': '1' }, body: JSON.stringify({ cpf, senha: SENHA }) }); const c = r.headers.get('set-cookie'); if (!c) throw new Error('login falhou ' + r.status + ' ' + (await r.text())); return c.split(';')[0]; }
const chamar = async (metodo, corpo, ck) => { const r = await fetch(U + '/api/backup-nuvem', { method: metodo, headers: { ...(ck ? { cookie: ck } : {}), 'x-painel': '1', 'content-type': 'application/json' }, body: metodo === 'GET' ? undefined : JSON.stringify(corpo ?? {}) }); let j = {}; try { j = await r.json(); } catch { /* sem corpo */ } return { s: r.status, j }; };
const post = (acao, extra, ck) => chamar('POST', { acao, ...extra }, ck);
const total = async () => (await sql('SELECT count(*)::int n FROM painel_backups_historico'))[0].n;
const pontos = () => sql('SELECT * FROM painel_backups_historico ORDER BY id');
const contagemEscopo = async () => (await sql(`SELECT count(*)::int n FROM documentos WHERE split_part(colecao, '/', 1) NOT IN ('auditoria', 'presenca', 'sistema', 'amb')`))[0].n;
const fakeSess = (uid, cpf, nome) => ({ uid, usuario: { cpf, nome } });
const velho = (id, horas) => sql(`UPDATE painel_backups_historico SET data_hora = now() - ($2 || ' hours')::interval WHERE id = $1`, [id, String(horas)]);
const limpar = () => sql('DELETE FROM painel_backups_historico');
const afrouxar = () => sql(`UPDATE painel_backups_historico SET data_hora = data_hora - interval '2 minutes' WHERE tipo_backup = 'MANUAL' AND NOT preventivo`); // contorna o intervalo entre pontos manuais

/* ---------- dados de partida ---------- */
for (const [id, perfil, cpf] of [['m1', 'MASTER', CPF.m1], ['op', 'OPERACIONAL', CPF.op], ['loja', 'LOJA', CPF.loja]]) await usuario('usr-' + id, perfil, cpf);
await usuario('usr-troca', 'OPERACIONAL', CPF.troca, { trocarSenha: true });
await doc('lojas/loja-t1', { codigo: 'T1', nome: 'LOJA TESTE UM', cidade: 'Recife', ativa: true });
await doc('lojas/loja-t2', { codigo: 'T2', nome: 'LOJA TESTE DOIS', cidade: 'Olinda', ativa: true });
await doc('config/param-t', { valor: 10 });
await doc('funcionarios/f-t1', { nome: 'COLABORADOR FICTICIO', cpf: '00000000191' });
await doc('auditoria/usr-m1/dias/2026-11-10', { n: 1 }); await doc('presenca/usr-m1', { em: 'x' }); await doc('sistema/backup_diario', { data: '2026-11-10' });
const M = await entrar(CPF.m1), OP = await entrar(CPF.op), LJ = await entrar(CPF.loja), TR = await entrar(CPF.troca);

/* ---------- 1 · tabela e restrições ---------- */
chk('a tabela painel_backups_historico existe com as colunas pedidas (id, data_hora, usuario_cpf, tipo_backup, payload_json, total_registros, versao_painel)',
  (await sql(`SELECT column_name FROM information_schema.columns WHERE table_name = 'painel_backups_historico'`)).map(r => r.column_name).filter(c => ['id', 'data_hora', 'usuario_cpf', 'tipo_backup', 'payload_json', 'total_registros', 'versao_painel'].includes(c)).length === 7);
let e1 = '', e2 = '', e3 = '';
try { await sql(`INSERT INTO painel_backups_historico (tipo_backup, payload_json, total_registros, versao_painel) VALUES ('OUTRO', '{}', 0, 'v')`); } catch (e) { e1 = e.code; }
try { await sql(`INSERT INTO painel_backups_historico (usuario_cpf, tipo_backup, payload_json, total_registros, versao_painel) VALUES ('123', 'MANUAL', '{}', 0, 'v')`); } catch (e) { e2 = e.code; }
try { await sql(`INSERT INTO painel_backups_historico (tipo_backup, payload_json, total_registros, versao_painel) VALUES ('MANUAL', '[]', 0, 'v')`); } catch (e) { e3 = e.code; }
chk('o banco recusa tipo fora de AUTOMATICO/MANUAL/PRIMEIRO_ACESSO, CPF que não tem 11 dígitos e payload que não é objeto (CHECK 23514)', e1 === '23514' && e2 === '23514' && e3 === '23514', [e1, e2, e3]);
chk('a migração é repetível: rodar o arquivo de novo não falha nem altera nada (CREATE … IF NOT EXISTS)', await (async () => { const fs = await import('node:fs'); const t = fs.readFileSync(new URL('../netlify/database/migrations/20261111120000_esquema_backups_nuvem.sql', import.meta.url), 'utf8'); await db.query(t); return true; })().catch(() => false));

/* ---------- 2 · autenticação e permissões ---------- */
chk('sem sessão: GET e POST → 401', (await chamar('GET', null, '')).s === 401 && (await post('listar', {}, '')).s === 401);
chk('sessão com troca de senha pendente → 401 (nada é criado)', (await post('verificar-primeiro-acesso', {}, TR)).s === 401 && (await total()) === 0);
const semCsrf = await fetch(U + '/api/backup-nuvem', { method: 'POST', headers: { cookie: M, 'content-type': 'application/json' }, body: JSON.stringify({ acao: 'criar' }) });
chk('POST sem o cabeçalho x-painel → 403 (proteção CSRF)', semCsrf.status === 403 && (await total()) === 0);
chk('ação desconhecida → 400; método DELETE → 405', (await post('apagar-tudo', {}, M)).s === 400 && (await chamar('DELETE', {}, M)).s === 405);
chk('Operacional (sem backup.exportar) não lista nem cria: 403', (await post('listar', {}, OP)).s === 403 && (await post('criar', {}, OP)).s === 403 && (await chamar('GET', null, OP)).s === 403 && (await total()) === 0);

/* ---------- 3 · primeiro acesso do dia (qualquer perfil) ---------- */
const pa1 = await post('verificar-primeiro-acesso', {}, LJ);
let [p1] = await pontos();
chk('primeiro acesso de um perfil LOJA (sem permissão de backup) cria um ponto PRIMEIRO_ACESSO em segundo plano', pa1.s === 200 && pa1.j.criado === true && pa1.j.existe === false && p1?.tipo_backup === 'PRIMEIRO_ACESSO' && p1.preventivo === false && p1.usuario_cpf === CPF.loja, [pa1, p1 && p1.tipo_backup]);
const noEscopo = await contagemEscopo(), pl = p1.payload_json;
chk('a fotografia traz formato 1, ambiente do site, versão do painel e as contagens por coleção; total_registros = documentos = escopo do banco', pl.formato === 1 && pl.ambiente === 'prod' && pl.versaoPainel === B.VERSAO_PAINEL && p1.versao_painel === 'v13.95' && p1.total_registros === pl.documentos.length && pl.documentos.length === noEscopo
  && Object.values(pl.colecoes).reduce((a, b) => a + b, 0) === noEscopo && pl.colecoes.lojas >= 2, [p1.total_registros, pl.documentos.length, noEscopo]);
const colsNoPonto = new Set(pl.documentos.map(d => d.caminho.split('/')[0]));
chk('ficam de fora a auditoria, a presença e os marcadores do sistema (e entram lojas, funcionários, config e usuários)', !['auditoria', 'presenca', 'sistema', 'amb'].some(c => colsNoPonto.has(c)) && ['lojas', 'funcionarios', 'config', 'usuarios'].every(c => colsNoPonto.has(c)), [...colsNoPonto]);
const [h] = await sql(`SELECT payload_json::text AS t, sha256, tamanho_bytes, encode(sha256(convert_to(payload_json::text, 'UTF8')), 'hex') AS calc FROM painel_backups_historico WHERE id = $1`, [p1.id]);
const { createHash } = await import('node:crypto');
chk('o SHA-256 gravado confere com o conteúdo (também recalculado aqui, fora do Postgres) e tamanho_bytes é o tamanho do payload em bytes', h.sha256 === h.calc && h.sha256 === createHash('sha256').update(h.t, 'utf8').digest('hex') && h.tamanho_bytes === Buffer.byteLength(h.t, 'utf8'), [h.sha256, h.calc]);
const pa2 = await post('verificar-primeiro-acesso', {}, M), pa3 = await post('verificar-primeiro-acesso', {}, OP);
chk('os acessos seguintes do dia (Master, Operacional) só confirmam que já existe ponto hoje: nenhum ponto novo', pa2.j.existe === true && pa2.j.criado === false && pa3.j.existe === true && (await total()) === 1, [pa2.j, pa3.j]);
await limpar();
await doc('funcionarios/f-t2', { nome: 'COLABORADORA VINCULADA', cpf: '98765432100' }); await usuario('usr-vinc', 'OPERACIONAL', undefined, { cpf: undefined, funcionarioId: 'f-t2', nome: undefined });
const VC = await entrar('98765432100'), pvc = await post('verificar-primeiro-acesso', {}, VC), [rvc] = await pontos();
chk('usuário vinculado a um colaborador (sem CPF no próprio cadastro): o criador do ponto leva o CPF e o nome do colaborador, como no login', pvc.j.criado === true && rvc.usuario_cpf === '98765432100' && rvc.usuario_nome === 'COLABORADORA VINCULADA', [pvc.j, rvc && rvc.usuario_cpf]);
await limpar();
const rajada = await Promise.all([M, OP, LJ, M, OP, LJ].map(ck => post('verificar-primeiro-acesso', {}, ck)));
chk('seis logins ao mesmo tempo no primeiro acesso do dia geram UM ponto só (trava + conferência dentro da trava)', (await total()) === 1 && rajada.filter(r => r.j.criado).length === 1 && rajada.every(r => r.s === 200 && r.j.ok), rajada.map(r => JSON.stringify(r.j)));
await limpar();
await sql(`INSERT INTO painel_backups_historico (tipo_backup, payload_json, total_registros, versao_painel, preventivo, data_hora) VALUES ('AUTOMATICO', '{}', 0, 'v', true, now())`);
const pv = await post('verificar-primeiro-acesso', {}, M);
chk('o ponto preventivo de uma restauração NÃO conta como o backup do dia: o primeiro acesso ainda cria o ponto limpo', pv.j.criado === true && (await total()) === 2, pv.j);
await limpar();
const [br] = await sql(`SELECT (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo') AS zero`);
await sql(`INSERT INTO painel_backups_historico (tipo_backup, payload_json, total_registros, versao_painel, data_hora) VALUES ('MANUAL', '{}', 0, 'v', $1)`, [new Date(br.zero.getTime() - 60e3)]); // 23:59 de ONTEM em Brasília
const ontem = await post('verificar-primeiro-acesso', {}, M);
chk('"hoje" é o dia de Brasília: um ponto de 23:59 de ontem (BRT) não conta, o primeiro acesso de hoje cria o seu', ontem.j.criado === true && (await total()) === 2, ontem.j);
await limpar();
await sql(`INSERT INTO painel_backups_historico (tipo_backup, payload_json, total_registros, versao_painel, data_hora) VALUES ('MANUAL', '{}', 0, 'v', $1)`, [new Date(br.zero.getTime() + 60e3)]); // 00:01 de HOJE em Brasília
const hoje0 = await post('verificar-primeiro-acesso', {}, M);
chk('… e um ponto de 00:01 de hoje (BRT) conta como o de hoje (qualquer tipo, inclusive MANUAL)', hoje0.j.existe === true && hoje0.j.criado === false && (await total()) === 1, hoje0.j);
await limpar();
const trava = await db.connect(); await trava.query('BEGIN'); await trava.query(`SELECT pg_advisory_xact_lock(hashtext('painel_backup_nuvem'))`);
const t0 = Date.now(), ocupado = await post('verificar-primeiro-acesso', {}, M), seg = (Date.now() - t0) / 1000;
await trava.query('ROLLBACK'); trava.release();
chk('com outra criação/restauração em andamento (trava ocupada) o primeiro acesso desiste em poucos segundos, em silêncio (200, adiado) e nada é criado', ocupado.s === 200 && ocupado.j.adiado === true && ocupado.j.motivo === 'ocupado' && (await total()) === 0 && seg < 9, [ocupado, seg]);
await sql('ALTER TABLE painel_backups_historico RENAME TO painel_backups_historico_x');
const semTab = await post('verificar-primeiro-acesso', {}, M), semTabL = await post('listar', {}, M);
await sql('ALTER TABLE painel_backups_historico_x RENAME TO painel_backups_historico');
chk('banco sem a tabela (migração ainda não aplicada): o primeiro acesso não quebra o painel (200, adiado) e a listagem explica (503 sem_esquema)', semTab.s === 200 && semTab.j.adiado === true && semTab.j.motivo === 'sem_esquema' && semTabL.s === 503 && semTabL.j.codigo === 'sem_esquema' && /migrações/i.test(semTabL.j.erro), [semTab, semTabL]);

/* ---------- 4 · ponto manual ---------- */
const m1 = await post('criar', { nota: '  antes   da   importação  ' }, M);
chk('Master cria um ponto MANUAL: id, tipo, registros, tamanho, criador com nome e CPF mascarado (o CPF inteiro nunca sai) e a nota higienizada', m1.s === 200 && m1.j.ok && m1.j.ponto.tipo === 'MANUAL' && m1.j.ponto.registros === await contagemEscopo() && m1.j.ponto.tamanho > 100 && m1.j.ponto.criador.nome === 'Teste usr-m1'
  && m1.j.ponto.criador.cpf === '•••.•••.•••-05' && !JSON.stringify(m1.j).includes(CPF.m1) && m1.j.ponto.nota === 'antes da importação', m1.j);
chk('o CPF do criador fica gravado (11 dígitos) na tabela, como pedido', (await sql(`SELECT usuario_cpf FROM painel_backups_historico WHERE id = $1`, [m1.j.ponto.id]))[0].usuario_cpf === CPF.m1);
const m2 = await post('criar', {}, M);
chk('outro ponto manual logo em seguida é recusado (429, intervalo de segurança)', m2.s === 429 && /Aguarde/.test(m2.j.erro) && (await total()) === 1, m2.j);
await velho(m1.j.ponto.id, 1);
const m3 = await post('criar', {}, M);
chk('passado o intervalo, o Master cria outro ponto manual', m3.s === 200 && (await total()) === 2, m3.j);
await sql(`INSERT INTO painel_backups_historico (tipo_backup, payload_json, total_registros, versao_painel, data_hora) SELECT 'MANUAL', '{}', 0, 'v', now() - interval '1 minute' FROM generate_series(1, ${B.MAX_MANUAIS_DIA})`);
await afrouxar();
const m4 = await post('criar', {}, M);
chk(`o limite diário de ${B.MAX_MANUAIS_DIA} pontos manuais protege a retenção: 429 com mensagem clara`, m4.s === 429 && /Limite/.test(m4.j.erro), m4.j);

/* ---------- 5 · listagem ---------- */
await limpar();
await sql(`INSERT INTO painel_backups_historico (tipo_backup, payload_json, total_registros, versao_painel, usuario_cpf, usuario_nome, data_hora, tamanho_bytes)
           SELECT (ARRAY['AUTOMATICO', 'MANUAL', 'PRIMEIRO_ACESSO'])[1 + g % 3], '{"documentos":[{"caminho":"x/y","dados":{"segredo":"SEGREDO-NAO-VAZAR"}}]}', g, 'v13.94', CASE WHEN g % 2 = 0 THEN $1 END, CASE WHEN g % 2 = 0 THEN 'Fulana de Teste' END, now() - (g || ' hours')::interval, g * 1000
             FROM generate_series(1, 35) g`, [CPF.m1]);
const L = await post('listar', {}, M), Lg = await chamar('GET', null, M);
chk('listar devolve os 30 mais recentes, do mais novo ao mais antigo, e o total guardado (35)', L.s === 200 && L.j.pontos.length === 30 && L.j.guardados === 35 && L.j.pontos[0].registros === 1 && L.j.pontos[29].registros === 30
  && L.j.pontos.every((p, i, a) => !i || new Date(p.dataHora) < new Date(a[i - 1].dataHora)) && Lg.s === 200 && Lg.j.pontos.length === 30, [L.j.pontos.length, L.j.guardados]);
chk('a listagem nunca traz o conteúdo dos pontos nem o CPF inteiro de ninguém', !JSON.stringify(L.j).includes('SEGREDO-NAO-VAZAR') && !/payload|documentos|"dados"/.test(JSON.stringify(L.j)) && !JSON.stringify(L.j).includes(CPF.m1), JSON.stringify(L.j).slice(0, 300));
await limpar();

/* ---------- 6 · rotina agendada (23:59 BRT) ---------- */
const a1 = await (await agendadoFn()).json();
let [pa] = await pontos();
chk('a rotina agendada cria um ponto AUTOMATICO sem usuário (rotina do sistema)', a1.ok && a1.criado && pa.tipo_backup === 'AUTOMATICO' && pa.usuario_cpf === null && pa.usuario_nome === null && pa.preventivo === false);
const a2 = await (await agendadoFn()).json();
chk('rodar de novo (nova tentativa do Netlify) não duplica: idempotente por 20 horas', a2.ok && a2.criado === false && (await total()) === 1);
await velho(pa.id, 21);
const a3 = await (await agendadoFn()).json();
chk('na noite seguinte (>20 h) cria o próximo ponto', a3.criado === true && (await total()) === 2);
const brt = new Intl.DateTimeFormat('pt-BR', { timeZone: B.FUSO, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(Date.UTC(2026, 10, 12, 2, 59)));
chk('a função agendada é só de agenda (sem rota) e o cron "59 2 * * *" (UTC) é 23:59 em Brasília', cfgAgendado.schedule === '59 2 * * *' && !('path' in cfgAgendado) && brt === '23:59', [cfgAgendado, brt]);
chk('o primeiro acesso do dia usa o ponto agendado quando ele já existe (hoje)', (await post('verificar-primeiro-acesso', {}, M)).j.existe === true);
await limpar();

/* ---------- 7 · retenção ---------- */
process.env.BACKUP_NUVEM_RETENCAO = '30';
await sql(`INSERT INTO painel_backups_historico (tipo_backup, payload_json, total_registros, versao_painel, data_hora) SELECT 'AUTOMATICO', '{}', g, 'v', now() - (g + 30 || ' hours')::interval FROM generate_series(1, 45) g`);
const novo = await B.criarManual(fakeSess('usr-m1', CPF.m1, 'Teste usr-m1'));
const resto = await sql('SELECT count(*)::int n, max(total_registros) AS pior FROM painel_backups_historico');
chk('retenção: com o limite em 30 (mínimo; padrão 60, máximo 365) criar um ponto descarta os mais antigos e mantém o novo', novo.podados === 16 && resto[0].n === 30 && (await sql('SELECT 1 FROM painel_backups_historico WHERE id = $1', [novo.ponto.id])).length === 1 && resto[0].pior === Math.max(29, novo.ponto.registros), [novo.podados, resto]);
chk('retencao(): padrão 60, piso 30 e teto 365', (() => { const k = process.env.BACKUP_NUVEM_RETENCAO; delete process.env.BACKUP_NUVEM_RETENCAO; const a = B.retencao(); process.env.BACKUP_NUVEM_RETENCAO = '5'; const b = B.retencao(); process.env.BACKUP_NUVEM_RETENCAO = '9999'; const c = B.retencao(); process.env.BACKUP_NUVEM_RETENCAO = k; return a === 60 && b === 30 && c === 365; })());
delete process.env.BACKUP_NUVEM_RETENCAO; await limpar();

/* ---------- 8 · RESTAURAR ---------- */
const antes = { lojas: await ler('lojas/loja-t1'), t2: await ler('lojas/loja-t2') };
const contabAntes = (await sql('SELECT (SELECT count(*) FROM contab_contas)::int c, (SELECT count(*) FROM contab_lancamentos)::int l, (SELECT count(*) FROM arquivos)::int a'))[0];
await afrouxar();
const P1 = (await post('criar', { nota: 'estado A' }, M)).j.ponto;
/* o estado muda depois do ponto */
await doc('lojas/loja-t1', { codigo: 'T1', nome: 'LOJA TESTE UM (ALTERADA)', cidade: 'Caruaru', ativa: false });
await sql(`DELETE FROM documentos WHERE caminho = 'lojas/loja-t2'`);
await doc('lojas/loja-t3', { codigo: 'T3', nome: 'LOJA NOVA DEPOIS DO PONTO' }); await doc('funcionarios/f-novo', { nome: 'ENTROU DEPOIS' });
const senhaNova = gerar('OutraSenha7Z', 'sal-novo'); await usuario('usr-op', 'OPERACIONAL', CPF.op, { senha: senhaNova }); await usuario('usr-novo', 'OPERACIONAL', '45123987600');
await doc('auditoria/usr-m1/dias/2026-11-10', { n: 99 }); await doc('presenca/usr-m1', { em: 'depois' }); await doc('sistema/backup_diario', { data: '2026-11-11' });
const seq0 = (await (await fetch(U + '/api/mudancas?desde=-1', { headers: { cookie: M } })).json()).seq;
const ver1 = (await ler('lojas/loja-t1')).versao;

chk('restaurar exige a palavra RESTAURAR (maiúsculas): sem ela, minúscula ou outra palavra → 400 e nada muda', (await post('restaurar', { id: P1.id }, M)).s === 400 && (await post('restaurar', { id: P1.id, confirmacao: 'restaurar' }, M)).s === 400 && (await post('restaurar', { id: P1.id, confirmacao: 'SIM' }, M)).s === 400
  && (await ler('lojas/loja-t1')).dados.cidade === 'Caruaru' && (await total()) === 1);
chk('só o Master restaura: Operacional e Loja → 403, sem sessão → 401 (mesmo com a palavra certa)', (await post('restaurar', { id: P1.id, confirmacao: 'RESTAURAR' }, OP)).s === 403 && (await post('restaurar', { id: P1.id, confirmacao: 'RESTAURAR' }, LJ)).s === 403 && (await post('restaurar', { id: P1.id, confirmacao: 'RESTAURAR' }, '')).s === 401 && (await total()) === 1);
chk('id inválido → 400; ponto que não existe → 404', (await post('restaurar', { id: 'abc', confirmacao: 'RESTAURAR' }, M)).s === 400 && (await post('restaurar', { id: 999999, confirmacao: 'RESTAURAR' }, M)).s === 404);

const R1 = await post('restaurar', { id: P1.id, confirmacao: 'RESTAURAR' }, M);
const l1 = await ler('lojas/loja-t1'), l2 = await ler('lojas/loja-t2');
chk('Master restaura o ponto: a loja alterada volta ao que era, a apagada volta, a criada depois do ponto some', R1.s === 200 && R1.j.ok && l1.dados.cidade === 'Recife' && l1.dados.ativa === true && !!l2 && l2.dados.nome === 'LOJA TESTE DOIS' && !(await ler('lojas/loja-t3')) && !(await ler('funcionarios/f-novo')), [R1.s, R1.j]);
chk('o resumo diz o que mudou: 1 criado (loja-t2), ao menos 1 atualizado (loja-t1), 2 removidos (loja-t3 e f-novo), e a versão do documento sobe', R1.j.resumo.criados === 1 && R1.j.resumo.atualizados >= 1 && R1.j.resumo.removidos === 2 && R1.j.resumo.colecoes >= 2 && l1.versao > ver1, R1.j.resumo);
const [pvv] = await sql(`SELECT id, tipo_backup, preventivo, nota, payload_json FROM painel_backups_historico WHERE preventivo ORDER BY id DESC LIMIT 1`);
chk('antes de sobrescrever, o servidor gravou um ponto PREVENTIVO (AUTOMATICO) com o estado de antes da restauração (loja alterada, loja-t3 e f-novo) e a nota aponta o ponto restaurado',
  R1.j.preventivo.id === Number(pvv.id) && pvv.tipo_backup === 'AUTOMATICO' && /Preventivo/.test(pvv.nota) && pvv.nota.includes('#' + P1.id) && pvv.payload_json.documentos.some(d => d.caminho === 'lojas/loja-t3') && pvv.payload_json.documentos.some(d => d.caminho === 'funcionarios/f-novo')
  && pvv.payload_json.documentos.find(d => d.caminho === 'lojas/loja-t1').dados.cidade === 'Caruaru' && Number(pvv.id) > P1.id, [pvv.nota]);
const opAgora = await ler('usuarios/usr-op');
chk('usuários e senhas NÃO voltam por padrão: a senha trocada depois do ponto continua valendo e o usuário criado depois continua existindo', opAgora.dados.senha.hash === senhaNova.hash && !!(await ler('usuarios/usr-novo')) && (await post('listar', {}, M)).s === 200);
chk('auditoria, presença e marcadores do sistema (fora do escopo) ficam como estavam; o livro contábil e os arquivos anexos não são tocados', (await ler('auditoria/usr-m1/dias/2026-11-10')).dados.n === 99 && (await ler('presenca/usr-m1')).dados.em === 'depois' && (await ler('sistema/backup_diario')).dados.data === '2026-11-11'
  && JSON.stringify((await sql('SELECT (SELECT count(*) FROM contab_contas)::int c, (SELECT count(*) FROM contab_lancamentos)::int l, (SELECT count(*) FROM arquivos)::int a'))[0]) === JSON.stringify(contabAntes));
const mud = await (await fetch(U + '/api/mudancas?desde=' + seq0, { headers: { cookie: M } })).json();
chk('os outros computadores são avisados: o log de mudanças registra as coleções alteradas (lojas, funcionarios) e nenhuma fora do escopo', mud.colecoes.includes('lojas') && mud.colecoes.includes('funcionarios') && !mud.colecoes.some(c => ['auditoria', 'presenca', 'sistema'].includes(c.split('/')[0])), mud);
chk('a sessão do Master continua válida depois de restaurar (as sessões não fazem parte do ponto)', (await (await fetch(U + '/api/sessao', { headers: { cookie: M } })).json()).logado === true);
const R1b = await post('restaurar', { id: P1.id, confirmacao: 'RESTAURAR' }, M);
chk('restaurar o mesmo ponto de novo é idempotente: nada a criar, atualizar ou remover (e ganha mais um preventivo)', R1b.s === 200 && R1b.j.resumo.criados === 0 && R1b.j.resumo.atualizados === 0 && R1b.j.resumo.removidos === 0 && R1b.j.resumo.colecoes === 0, R1b.j);

/* com "usuários e acessos" */
const R2 = await post('restaurar', { id: P1.id, confirmacao: 'RESTAURAR', incluirUsuarios: true }, M);
const opVolta = await ler('usuarios/usr-op');
chk('com incluirUsuarios = true os acessos voltam como estavam no ponto (a senha antiga volta; o usuário criado depois some) e o Master que pediu continua entrando', R2.s === 200 && R2.j.incluiuUsuarios === true && opVolta.dados.senha.hash !== senhaNova.hash && !(await ler('usuarios/usr-novo')) && (await entrar(CPF.m1)).includes('painel_sessao'), [R2.s, R2.j]);
await usuario('usr-op', 'OPERACIONAL', CPF.op); // volta ao estado de teste

/* travas de segurança: tudo é desfeito */
await usuario('usr-m2', 'MASTER', CPF.m2); const M2 = await entrar(CPF.m2);
const snapDoc = async () => JSON.stringify((await sql(`SELECT caminho, dados, versao FROM documentos WHERE split_part(colecao, '/', 1) NOT IN ('auditoria','presenca','sistema','amb') ORDER BY caminho`)));
const ant = await snapDoc(), nPrev = (await sql('SELECT count(*)::int n FROM painel_backups_historico WHERE preventivo'))[0].n;
const T1 = await post('restaurar', { id: P1.id, confirmacao: 'RESTAURAR', incluirUsuarios: true }, M2);
chk('autoexclusão: um Master que não existe no ponto não pode restaurá-lo com os usuários (perderia o acesso) → 409 e TUDO desfeito', T1.s === 409 && /perderia o acesso|não contém o seu usuário/.test(T1.j.erro) && (await snapDoc()) === ant, [T1.s, T1.j]);
const T1b = await post('restaurar', { id: P1.id, confirmacao: 'RESTAURAR' }, M2);
chk('… mas o mesmo Master restaura o ponto normalmente quando não inclui os usuários', T1b.s === 200);
const masters = ativo => sql(`UPDATE documentos SET dados = jsonb_set(dados, '{ativo}', $1::jsonb) WHERE colecao = 'usuarios' AND dados->>'perfil' = 'MASTER'`, [String(ativo)]);
await masters(false);                                                              // (inclui o Master da semente)
await afrouxar(); const PX = (await B.criarManual(fakeSess('usr-m1', CPF.m1, 'x'))).ponto; // ponto em que NENHUM Master está ativo
await masters(true);
await velho(PX.id, 1); const ant2 = await snapDoc();
const T2 = await post('restaurar', { id: PX.id, confirmacao: 'RESTAURAR', incluirUsuarios: true }, M);
chk('um ponto que deixaria o sistema sem nenhum Master ativo é recusado (409) e nada é alterado', T2.s === 409 && /nenhum usuário Master ativo/.test(T2.j.erro) && (await snapDoc()) === ant2, [T2.s, T2.j]);

await afrouxar(); const P3 = (await post('criar', {}, M2)).j.ponto; await velho(P3.id, 1);
await sql(`UPDATE painel_backups_historico SET payload_json = payload_json || '{"adulterado": true}'::jsonb WHERE id = $1`, [P3.id]); const ant3 = await snapDoc();
const T3 = await post('restaurar', { id: P3.id, confirmacao: 'RESTAURAR' }, M);
chk('ponto adulterado/corrompido (SHA-256 diferente) é recusado (409) e nada é alterado', T3.s === 409 && /SHA-256|corrompido/.test(T3.j.erro) && (await snapDoc()) === ant3, [T3.s, T3.j]);
await afrouxar(); const P4 = (await B.criarManual(fakeSess('usr-m1', CPF.m1, 'x'))).ponto;
await sql(`UPDATE painel_backups_historico t SET payload_json = x.j, sha256 = encode(sha256(convert_to(x.j::text, 'UTF8')), 'hex') FROM (SELECT id, jsonb_set(payload_json, '{ambiente}', '"homolog"') AS j FROM painel_backups_historico WHERE id = $1) x WHERE t.id = x.id`, [P4.id]);
const T4 = await post('restaurar', { id: P4.id, confirmacao: 'RESTAURAR' }, M);
chk('ponto de outro ambiente (mesmo com SHA-256 certo) é recusado (409): não se restaura Homologação em Produção', T4.s === 409 && /ambiente/.test(T4.j.erro) && (await snapDoc()) === ant3, [T4.s, T4.j]);
await velho(P4.id, 2);
await afrouxar(); const P5 = (await B.criarManual(fakeSess('usr-m1', CPF.m1, 'x'))).ponto;
await sql(`UPDATE painel_backups_historico t SET payload_json = x.j, sha256 = encode(sha256(convert_to(x.j::text, 'UTF8')), 'hex'), total_registros = 0 FROM (SELECT id, jsonb_set(payload_json, '{documentos}', '[]'::jsonb) AS j FROM painel_backups_historico WHERE id = $1) x WHERE t.id = x.id`, [P5.id]);
const T5 = await post('restaurar', { id: P5.id, confirmacao: 'RESTAURAR' }, M);
chk('ponto vazio (0 documentos) é recusado (409): restaurá-lo apagaria tudo', T5.s === 409 && /vazio/.test(T5.j.erro) && (await snapDoc()) === ant3, [T5.s, T5.j]);

/* concorrência */
await doc('lojas/loja-t1', { codigo: 'T1', nome: 'ALTERADA DE NOVO' });
await afrouxar(); const P6 = (await B.criarManual(fakeSess('usr-m1', CPF.m1, 'x'))).ponto; await doc('lojas/loja-t1', { codigo: 'T1', nome: 'ALTERADA POR ÚLTIMO' });
const par = await Promise.all([post('restaurar', { id: P6.id, confirmacao: 'RESTAURAR' }, M), post('restaurar', { id: P6.id, confirmacao: 'RESTAURAR' }, M2)]);
chk('duas restaurações ao mesmo tempo são serializadas pela trava: o estado final é exatamente o do ponto (e nenhuma resposta é 500)', par.every(r => r.s === 200 || r.s === 409) && par.some(r => r.s === 200) && (await ler('lojas/loja-t1')).dados.nome === 'ALTERADA DE NOVO', par.map(r => [r.s, r.j.erro]));

/* ---------- 9 · o servidor nunca vaza SQL nem detalhes em erro ---------- */
const lixo = await post('restaurar', { id: "1; DROP TABLE documentos", confirmacao: 'RESTAURAR' }, M);
chk('entrada maliciosa no id é recusada (400) sem tocar no banco', lixo.s === 400 && (await sql(`SELECT to_regclass('documentos') IS NOT NULL AS ok`))[0].ok);

console.log('\nOK (' + OK.length + ')  FALHAS (' + FAIL.length + ')');
await db.end(); await dbLib().pool.end(); process.exit(FAIL.length ? 1 : 0);
