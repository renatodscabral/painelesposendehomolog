/* v13.95 · Pontos de Restauração na Nuvem (Cloud Snapshots & Versioning).
   Cada ponto é uma fotografia dos documentos do painel DESTE ambiente (cada ambiente é um site com o seu banco), gravada na tabela
   painel_backups_historico. A fotografia é montada e gravada DENTRO do Postgres (INSERT … SELECT com jsonb_agg): os megabytes dos
   dados não passam pela função, então não esbarram no limite de resposta nem na memória.

   O que entra:   toda coleção de documentos, menos as raízes de RAIZES_FORA (log de auditoria, presença e marcadores do sistema).
   O que fica fora de propósito:
     · os arquivos anexos (tabelas arquivos/arquivo_partes: PDFs e imagens de até 15 MB) — a restauração não os apaga nem os troca;
     · o livro contábil (contab_*): os lançamentos são intangíveis por desenho (triggers bloqueiam UPDATE/DELETE; correção só por estorno),
       então uma restauração não pode — nem deve — reescrevê-los.
   Restauração (só Master): backup preventivo automático → trava de escrita na tabela de documentos → substitui os documentos do escopo
   (apaga o que não existe no ponto, grava o que existe) → registra a mudança por coleção para os outros computadores se atualizarem.
   Usuários e senhas NÃO voltam por padrão (uma senha trocada depois do ponto voltaria à antiga); só com incluirUsuarios = true.
   Travas: confirmação "RESTAURAR", Master real, SHA-256 do ponto conferido, ambiente do ponto = ambiente do site, uma operação por vez
   (advisory lock), e a restauração é desfeita por inteiro se o Master que a pediu (ou qualquer Master ativo) deixasse de existir. */
import { db } from './db.mjs';
import { ErroHttp } from './http.mjs';
import { ambienteAtual } from './ambiente.mjs';

export const VERSAO_PAINEL = 'v13.95';
export const FORMATO = 1;
export const TIPOS = ['AUTOMATICO', 'MANUAL', 'PRIMEIRO_ACESSO'];
export const LIMITE_LISTA = 30;                         // a tela mostra os 30 pontos mais recentes
export const RAIZES_FORA = ['auditoria', 'presenca', 'sistema', 'amb'];
export const FUSO = 'America/Sao_Paulo';                // "hoje" e "23:59" são sempre o horário de Brasília
export const CONFIRMACAO = 'RESTAURAR';
export const MAX_MANUAIS_DIA = 20;                      // contra rajadas que empurrariam os pontos antigos para fora da retenção
export const INTERVALO_MANUAL_S = 20;
const CHAVE_TRAVA = 'painel_backup_nuvem';
const FORA_SQL = RAIZES_FORA.map(r => `'${r}'`).join(', '); // constantes do código: nunca vem texto do usuário para dentro do SQL
const noEscopo = a => `split_part(${a}.colecao, '/', 1) NOT IN (${FORA_SQL})`;
const env = k => (globalThis.Netlify?.env?.get?.(k) ?? process.env[k] ?? '').trim();

/** Quantos pontos o banco guarda (padrão 60; mínimo 30 = o que a tela lista; máximo 365). Variável opcional BACKUP_NUVEM_RETENCAO. */
export function retencao() { const n = parseInt(env('BACKUP_NUVEM_RETENCAO'), 10); return Number.isFinite(n) ? Math.min(Math.max(n, LIMITE_LISTA), 365) : 60; }

const mascaraCpf = d => (/^\d{11}$/.test(d || '') ? `•••.•••.•••-${d.slice(9)}` : '');
const dig = v => String(v ?? '').replace(/\D/g, '');
const ms = (v, min, max) => Math.min(Math.max(Math.trunc(Number(v)) || min, min), max);

/** Quem está pedindo (da sessão): CPF só com dígitos e nome para exibir. Mesmo critério do login: o CPF do colaborador vinculado
    (Módulo 1) vale antes do CPF gravado no usuário (Master avulso). */
export async function autorDe(sess) {
  const u = sess?.usuario || {}; let cpf = dig(u.cpf), nome = String(u.nome || '').trim();
  if (u.funcionarioId) {
    try {
      const { rows: [f] } = await db().pool.query(`SELECT dados->>'cpf' AS cpf, dados->>'nome' AS nome FROM documentos WHERE caminho = $1`, ['funcionarios/' + u.funcionarioId]);
      if (f) { if (dig(f.cpf).length === 11) cpf = dig(f.cpf); if (!nome) nome = String(f.nome || '').trim(); }
    } catch { /* sem o colaborador: usa o que o usuário tem */ }
  }
  return { cpf: cpf.length === 11 ? cpf : null, nome: nome.slice(0, 120) || null, uid: sess?.uid || null };
}

/** Traduz os erros do Postgres para respostas que o usuário entende (nunca devolve SQL nem detalhes internos). */
function traduzir(e) {
  if (e?.status) return e;
  const cod = e?.code;
  if (cod === '55P03') return new ErroHttp(409, 'Outro ponto de restauração está sendo criado ou restaurado agora. Aguarde alguns segundos e tente de novo.');
  if (cod === '57014') return new ErroHttp(504, 'A operação demorou mais do que o permitido e foi cancelada. Nada foi alterado; tente de novo.');
  if (cod === '42P01') return new ErroHttp(503, 'A tabela dos pontos de restauração ainda não existe neste banco. Em Backup e dados › Banco de dados · Migrações, execute as migrações (ou publique de novo no Netlify).', { codigo: 'sem_esquema' });
  return e;
}

/** Transação com trava: uma criação/restauração por vez, esperas curtas (a função do Netlify tem poucos segundos). */
async function comTrava(fn, { lockMs = 8000, stmtMs = 25000 } = {}) {
  const c = await db().pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL lock_timeout = ${ms(lockMs, 100, 60000)}`);
    await c.query(`SET LOCAL statement_timeout = ${ms(stmtMs, 1000, 120000)}`);
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [CHAVE_TRAVA]);
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) { try { await c.query('ROLLBACK'); } catch { /* conexão perdida */ } throw traduzir(e); }
  finally { c.release(); }
}

const projetar = r => r && ({ id: Number(r.id), dataHora: r.data_hora instanceof Date ? r.data_hora.toISOString() : r.data_hora, tipo: r.tipo_backup, registros: r.total_registros,
  tamanho: r.tamanho_bytes, versaoPainel: r.versao_painel, preventivo: !!r.preventivo, nota: r.nota || '',
  criador: r.usuario_cpf || r.usuario_nome ? { nome: r.usuario_nome || '', cpf: mascaraCpf(r.usuario_cpf) } : null });

/** Grava um ponto (dentro de uma transação já travada) e devolve a linha. A fotografia nasce no próprio SQL. */
async function inserirPonto(c, { tipo, autor, preventivo = false, nota = null }) {
  if (!TIPOS.includes(tipo)) throw new ErroHttp(400, 'Tipo de ponto inválido.');
  const { rows: [r] } = await c.query(
    `WITH d AS (
       SELECT caminho, colecao, doc_id, dados, versao, criado_em, atualizado_em, atualizado_por FROM documentos x WHERE ${noEscopo('x')}
     ), p AS (
       SELECT jsonb_build_object(
                'formato', ${FORMATO}, 'app', 'painel-gestao-esposende', 'ambiente', $1::text, 'versaoPainel', $2::text,
                'geradoEm', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                'colecoes', (SELECT coalesce(jsonb_object_agg(colecao, n), '{}'::jsonb) FROM (SELECT colecao, count(*) AS n FROM d GROUP BY colecao) k),
                'documentos', coalesce(jsonb_agg(jsonb_build_object('caminho', caminho, 'colecao', colecao, 'doc_id', doc_id, 'dados', dados, 'versao', versao,
                                       'criado_em', criado_em, 'atualizado_em', atualizado_em, 'atualizado_por', atualizado_por) ORDER BY caminho), '[]'::jsonb)) AS j,
              count(*)::int AS n
         FROM d
     )
     INSERT INTO painel_backups_historico (usuario_cpf, usuario_nome, tipo_backup, payload_json, total_registros, versao_painel, tamanho_bytes, sha256, preventivo, nota)
     SELECT $3, $4, $5, j, n, $2, octet_length(j::text), encode(sha256(convert_to(j::text, 'UTF8')), 'hex'), $6, $7 FROM p
     RETURNING id, data_hora, tipo_backup, usuario_cpf, usuario_nome, total_registros, tamanho_bytes, versao_painel, preventivo, nota`,
    [ambienteAtual(), VERSAO_PAINEL, autor?.cpf || null, autor?.nome || null, tipo, preventivo, nota]);
  return r;
}

/** Retenção: guarda os N pontos mais recentes (e nunca apaga os ids protegidos, como o ponto que acabou de ser restaurado). */
async function podar(c, protegidos = []) {
  const { rowCount } = await c.query(
    `DELETE FROM painel_backups_historico WHERE id <> ALL($2::bigint[]) AND id NOT IN (SELECT id FROM painel_backups_historico ORDER BY data_hora DESC, id DESC LIMIT $1)`,
    [retencao(), protegidos.map(Number).filter(Number.isFinite)]);
  return rowCount;
}

/* ---------------------------------------------------------------------------------------------------------- ações */

/** 'criar' — ponto MANUAL (botão). Limites: um a cada INTERVALO_MANUAL_S segundos e no máximo MAX_MANUAIS_DIA por dia. */
export async function criarManual(sess, nota = '') {
  const autor = await autorDe(sess), obs = String(nota ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || null;
  return comTrava(async c => {
    const { rows: [lim] } = await c.query(
      `SELECT count(*) FILTER (WHERE (data_hora AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date)::int AS hoje,
              extract(epoch FROM now() - max(data_hora))::int AS desde FROM painel_backups_historico WHERE tipo_backup = 'MANUAL' AND NOT preventivo`, [FUSO]);
    if (lim.desde !== null && lim.desde < INTERVALO_MANUAL_S) throw new ErroHttp(429, `Um ponto manual acabou de ser criado. Aguarde ${INTERVALO_MANUAL_S - lim.desde} s para criar outro.`);
    if (lim.hoje >= MAX_MANUAIS_DIA) throw new ErroHttp(429, `Limite de ${MAX_MANUAIS_DIA} pontos manuais por dia atingido (evita que pontos antigos sejam descartados). Os pontos automáticos continuam sendo criados.`);
    const r = await inserirPonto(c, { tipo: 'MANUAL', autor, nota: obs });
    const podados = await podar(c, [r.id]);
    return { ponto: projetar(r), podados };
  });
}

/** 'listar' — os últimos 30 pontos (sem o conteúdo) e o total guardado. */
export async function listar() {
  try {
    const { rows } = await db().pool.query(
      `SELECT id, data_hora, tipo_backup, usuario_cpf, usuario_nome, total_registros, tamanho_bytes, versao_painel, preventivo, nota
         FROM painel_backups_historico ORDER BY data_hora DESC, id DESC LIMIT $1`, [LIMITE_LISTA]);
    const { rows: [t] } = await db().pool.query('SELECT count(*)::int AS n, coalesce(sum(tamanho_bytes), 0)::bigint AS bytes FROM painel_backups_historico');
    return { pontos: rows.map(projetar), guardados: t.n, bytes: Number(t.bytes), retencao: retencao(), escopo: { fora: RAIZES_FORA } };
  } catch (e) { throw traduzir(e); }
}

/** Já existe ponto de hoje (horário de Brasília)? O preventivo da restauração não conta: o dia continua pedindo um ponto "limpo". */
const pontoDeHoje = async c => (await c.query(
  `SELECT id, data_hora, tipo_backup, total_registros, tamanho_bytes, versao_painel, preventivo, nota, usuario_cpf, usuario_nome FROM painel_backups_historico
    WHERE NOT preventivo AND (data_hora AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date ORDER BY data_hora DESC, id DESC LIMIT 1`, [FUSO])).rows[0];

/** 'verificar-primeiro-acesso' — qualquer perfil. Sem ponto hoje → cria um PRIMEIRO_ACESSO. Nunca devolve erro ao usuário (é em segundo plano). */
export async function verificarPrimeiroAcesso(sess) {
  try {
    let autor = null;
    const existente = await pontoDeHoje(db().pool);                          // caminho rápido: quase todas as chamadas terminam aqui
    if (existente) return { ok: true, existe: true, criado: false, ponto: { id: Number(existente.id), tipo: existente.tipo_backup, dataHora: existente.data_hora.toISOString() } };
    autor = await autorDe(sess);
    return await comTrava(async c => {
      const de_novo = await pontoDeHoje(c);                                  // conferido de novo com a trava: dois logins ao mesmo tempo geram UM ponto só
      if (de_novo) return { ok: true, existe: true, criado: false, ponto: { id: Number(de_novo.id), tipo: de_novo.tipo_backup, dataHora: de_novo.data_hora.toISOString() } };
      const r = await inserirPonto(c, { tipo: 'PRIMEIRO_ACESSO', autor, nota: 'Primeiro acesso do dia' });
      await podar(c, [r.id]);
      return { ok: true, existe: false, criado: true, ponto: { id: Number(r.id), tipo: r.tipo_backup, dataHora: r.data_hora.toISOString() } };
    }, { lockMs: 4000 });
  } catch (e) {
    const t = traduzir(e);
    console.warn('[painel][backup-nuvem] primeiro acesso: não gerou o ponto —', t.status || '', String(t.message || t).split('\n')[0].slice(0, 200));
    return { ok: false, existe: false, criado: false, adiado: true, motivo: t.extra?.codigo || (t.status === 409 ? 'ocupado' : 'indisponivel') };
  }
}

/** Rotina diária (função agendada, 23:59 de Brasília = 02:59 UTC). Idempotente: se já houve um AUTOMATICO nas últimas 20 h, não cria outro. */
export async function agendado() {
  return comTrava(async c => {
    const { rows: [j] } = await c.query(`SELECT id FROM painel_backups_historico WHERE tipo_backup = 'AUTOMATICO' AND NOT preventivo AND data_hora > now() - interval '20 hours' LIMIT 1`);
    if (j) return { criado: false, motivo: 'já existe ponto agendado nas últimas 20 horas', id: Number(j.id) };
    const r = await inserirPonto(c, { tipo: 'AUTOMATICO', autor: null, nota: 'Rotina diária 23:59' });
    const podados = await podar(c, [r.id]);
    return { criado: true, ponto: projetar(r), podados };
  }, { lockMs: 15000, stmtMs: 25000 });
}

/** 'restaurar' — só o Master. Ver o cabeçalho deste arquivo. Devolve o resumo; levanta ErroHttp se qualquer trava recusar. */
export async function restaurar(sess, { id, confirmacao, incluirUsuarios = false } = {}) {
  const pid = Number(id);
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new ErroHttp(400, 'Informe o ponto de restauração (id).');
  if (String(confirmacao ?? '').trim() !== CONFIRMACAO) throw new ErroHttp(400, `Para restaurar, digite a palavra ${CONFIRMACAO} (em maiúsculas).`);
  const autor = await autorDe(sess), usuarios = incluirUsuarios === true;
  let meta;
  try { [meta] = (await db().pool.query('SELECT id, data_hora, tipo_backup, total_registros FROM painel_backups_historico WHERE id = $1', [pid])).rows; } catch (e) { throw traduzir(e); }
  if (!meta) throw new ErroHttp(404, 'Ponto de restauração não encontrado (pode ter sido descartado pela retenção).');

  /* 1 · backup preventivo — gravado e confirmado (COMMIT) ANTES de qualquer documento ser tocado */
  const prev = await comTrava(async c => {
    const r = await inserirPonto(c, { tipo: 'AUTOMATICO', autor, preventivo: true, nota: `Preventivo automático antes de restaurar o ponto #${pid}` });
    return r;
  }, { lockMs: 8000 });

  /* 2 · restauração numa transação só (tudo ou nada) */
  const resumo = await comTrava(async c => {
    const { rows: [p] } = await c.query(
      `SELECT id, payload_json->>'ambiente' AS ambiente, (payload_json->>'formato')::int AS formato, jsonb_typeof(payload_json->'documentos') AS tipo_docs,
              jsonb_array_length(CASE WHEN jsonb_typeof(payload_json->'documentos') = 'array' THEN payload_json->'documentos' ELSE '[]'::jsonb END) AS n,
              (sha256 IS NOT DISTINCT FROM encode(sha256(convert_to(payload_json::text, 'UTF8')), 'hex')) AS integro
         FROM painel_backups_historico WHERE id = $1`, [pid]);
    if (!p) throw new ErroHttp(404, 'Ponto de restauração não encontrado.');
    if (!p.integro) throw new ErroHttp(409, 'O conteúdo deste ponto não confere com a impressão (SHA-256) gravada na criação: ele foi alterado ou corrompido e não será aplicado.');
    if (p.formato !== FORMATO || p.tipo_docs !== 'array') throw new ErroHttp(409, 'Formato de ponto não reconhecido por esta versão do painel.');
    if (p.ambiente !== ambienteAtual()) throw new ErroHttp(409, `Este ponto é do ambiente "${p.ambiente}" e este site é "${ambienteAtual()}": a restauração entre ambientes não é permitida.`);
    if (!p.n) throw new ErroHttp(409, 'O ponto está vazio (0 documentos): restaurá-lo apagaria os dados atuais. Operação recusada.');

    await c.query('LOCK TABLE documentos IN SHARE ROW EXCLUSIVE MODE');       // bloqueia gravações por instantes (leituras continuam)
    await c.query(
      `CREATE TEMP TABLE _ponto ON COMMIT DROP AS
         SELECT s.caminho, s.colecao, s.doc_id, s.dados, s.versao, s.criado_em, s.atualizado_em, s.atualizado_por
           FROM painel_backups_historico h, jsonb_to_recordset(h.payload_json->'documentos')
                AS s(caminho text, colecao text, doc_id text, dados jsonb, versao int, criado_em timestamptz, atualizado_em timestamptz, atualizado_por text)
          WHERE h.id = $1 AND ${noEscopo('s')} AND ($2::boolean OR split_part(s.colecao, '/', 1) <> 'usuarios')`, [pid, usuarios]);
    await c.query('ALTER TABLE _ponto ADD PRIMARY KEY (caminho)');
    const { rows: [r] } = await c.query(
      `WITH rem AS (
         DELETE FROM documentos d WHERE ${noEscopo('d')} AND ($1::boolean OR split_part(d.colecao, '/', 1) <> 'usuarios')
            AND NOT EXISTS (SELECT 1 FROM _ponto s WHERE s.caminho = d.caminho) RETURNING d.colecao
       ), ups AS (
         INSERT INTO documentos (caminho, colecao, doc_id, dados, versao, criado_em, atualizado_em, atualizado_por)
           SELECT caminho, colecao, doc_id, dados, coalesce(versao, 1), coalesce(criado_em, now()), now(), $2 FROM _ponto
         ON CONFLICT (caminho) DO UPDATE SET dados = EXCLUDED.dados, versao = documentos.versao + 1, atualizado_em = now(), atualizado_por = EXCLUDED.atualizado_por
           WHERE documentos.dados IS DISTINCT FROM EXCLUDED.dados
         RETURNING colecao, (xmax = 0) AS novo
       ), mud AS (
         INSERT INTO mudancas (caminho, colecao, op, por)
           SELECT DISTINCT colecao || '/_restauracao', colecao, 'set', $3 FROM (SELECT colecao FROM rem UNION ALL SELECT colecao FROM ups) x
         RETURNING 1
       )
       SELECT (SELECT count(*) FROM rem)::int AS removidos, (SELECT count(*) FROM ups WHERE novo)::int AS criados,
              (SELECT count(*) FROM ups WHERE NOT novo)::int AS atualizados, (SELECT count(*) FROM mud)::int AS colecoes`,
      [usuarios, 'restauracao:' + pid, autor.uid || 'restauracao']);
    /* travas de segurança do resultado: o Master que pediu (e ao menos um Master ativo) tem que continuar existindo — senão tudo é desfeito */
    const { rows: [m] } = await c.query(
      `SELECT count(*)::int AS ativos, bool_or(caminho = $1) AS eu FROM documentos
        WHERE colecao = 'usuarios' AND upper(btrim(dados->>'perfil')) IN ('MASTER', 'GESTOR', 'ADMIN') AND dados->'ativo' IS DISTINCT FROM 'false'::jsonb`, ['usuarios/' + (autor.uid || '')]);
    if (!m.ativos) throw new ErroHttp(409, 'Restauração desfeita: o ponto deixaria o sistema sem nenhum usuário Master ativo. Nada foi alterado.');
    if (!m.eu) throw new ErroHttp(409, 'Restauração desfeita: o ponto não contém o seu usuário Master e você perderia o acesso. Restaure sem “usuários e acessos” ou peça a outro Master. Nada foi alterado.');
    return { ...r, aplicados: p.n };
  }, { lockMs: 10000, stmtMs: 40000 });

  /* 3 · retenção (sem descartar o ponto restaurado nem o preventivo recém-criado) */
  let podados = 0;
  try { await comTrava(async c => { podados = await podar(c, [pid, prev.id]); }, { lockMs: 3000 }); } catch { /* a retenção roda de novo na próxima criação */ }
  console.info(`[painel][backup-nuvem] ponto #${pid} restaurado por ${autor.uid || '?'} (${ambienteAtual()}): ${resumo.criados} criado(s), ${resumo.atualizados} atualizado(s), ${resumo.removidos} removido(s); preventivo #${prev.id}${usuarios ? '; incluiu usuários' : ''}`);
  return { ok: true, restaurado: projetar({ ...meta, versao_painel: null, tamanho_bytes: null, preventivo: false }), preventivo: { id: Number(prev.id), dataHora: prev.data_hora.toISOString() },
    resumo: { criados: resumo.criados, atualizados: resumo.atualizados, removidos: resumo.removidos, colecoes: resumo.colecoes, documentosNoPonto: resumo.aplicados }, incluiuUsuarios: usuarios, podados };
}
