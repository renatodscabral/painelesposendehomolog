/* v13.94 · Automação de migrações do banco (Netlify Database / Postgres).
 *
 * O Netlify já aplica sozinho, antes de publicar, tudo o que está em netlify/database/migrations/ (e a documentação deles diz:
 * "se quiser o seu próprio sistema, use outra pasta para não haver conflito"). Esta automação convive com isso e, por isso, tem
 * uma regra de segurança central:
 *
 *   NA PASTA DO NETLIFY, SÓ SE EXECUTA O QUE PODE RODAR DUAS VEZES SEM DANO ("migração aditiva"):
 *     CREATE TABLE IF NOT EXISTS …, CREATE [UNIQUE] INDEX IF NOT EXISTS …, ALTER TABLE … ADD COLUMN IF NOT EXISTS …,
 *     CREATE EXTENSION IF NOT EXISTS …
 *   Qualquer outra coisa (CREATE TABLE sem IF NOT EXISTS, INSERT, UPDATE, DELETE, funções, gatilhos, views, DROP…) — como o esquema
 *   inicial e a semente — continua sendo do Netlify: este código só lista essas migrações como "geridas pelo Netlify" e NUNCA as roda.
 *   Assim, quando o Netlify aplicar a mesma migração no deploy, ela é um "não faz nada" e a publicação nunca é bloqueada por duplicidade.
 *
 * Livro-razão próprio: tabela painel_migracoes (nome, sha256, origem, aplicada_em). Cada migração roda numa transação, com trava
 * consultiva (duas execuções ao mesmo tempo — build + botão — não se atropelam), e só é registrada se concluir.
 * Pré-requisito ausente (relação/coluna/esquema inexistente — por exemplo, banco novo que o Netlify ainda não montou) = "adiada":
 * não é erro, fica para o deploy do Netlify. Qualquer outro erro de SQL = "falhou" e interrompe (como o Netlify faz).
 * O que o banco guarda aqui não tem CPF, senha nem dado de cliente: só nome e hash do arquivo. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const LIVRO = 'painel_migracoes';
const CHAVE_TRAVA = `hashtext('painel_migracoes')`;
const LIVRO_SQL = `CREATE TABLE IF NOT EXISTS ${LIVRO} (
  nome        text        PRIMARY KEY,
  sha256      text        NOT NULL,
  origem      text        NOT NULL CHECK (origem IN ('build', 'botao')),
  aplicada_em timestamptz NOT NULL DEFAULT now()
)`;
const ADIAVEIS = new Set(['42P01', '42703', '3F000']); // relação, coluna ou esquema inexistente → depende de migração do Netlify ainda não aplicada

/* ----------------------------------------------------------------------------------------------- análise do SQL */
/** Divide o SQL em comandos (';' fora de aspas, comentários e $$…$$), sem os comentários. */
export function dividirComandos(sql) {
  const out = []; let atual = '', i = 0; const n = sql.length;
  const fecha = () => { const t = atual.trim(); if (t) out.push(t); atual = ''; };
  const ident = ch => /[A-Za-z0-9_$]/.test(ch || '');
  while (i < n) {
    const c = sql[i], c2 = sql[i + 1];
    if (c === '-' && c2 === '-') { while (i < n && sql[i] !== '\n') i++; atual += ' '; continue; }
    if (c === '/' && c2 === '*') {
      let d = 1; i += 2;
      while (i < n && d > 0) { if (sql[i] === '/' && sql[i + 1] === '*') { d++; i += 2; } else if (sql[i] === '*' && sql[i + 1] === '/') { d--; i += 2; } else i++; }
      atual += ' '; continue;
    }
    if (c === "'") {
      const esc = /[eE]$/.test(atual) && !ident(atual.slice(-2, -1)); // E'…\'…'
      let j = i + 1;
      while (j < n) { if (esc && sql[j] === '\\') { j += 2; continue; } if (sql[j] === "'") { if (sql[j + 1] === "'") { j += 2; continue; } break; } j++; }
      atual += sql.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < n) { if (sql[j] === '"') { if (sql[j + 1] === '"') { j += 2; continue; } break; } j++; }
      atual += sql.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '$' && !ident(atual.slice(-1))) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 80));
      if (m) { const fim = sql.indexOf(m[0], i + m[0].length); if (fim < 0) { atual += sql.slice(i); i = n; } else { atual += sql.slice(i, fim + m[0].length); i = fim + m[0].length; } continue; }
    }
    if (c === ';') { fecha(); i++; continue; }
    atual += c; i++;
  }
  fecha();
  return out;
}

const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][\w$]*)`;
const NOME = `${IDENT}(?:\\.${IDENT})?`;
const RE_TABELA = new RegExp(`^CREATE TABLE IF NOT EXISTS ${NOME} ?\\(`, 'i');
const RE_INDICE = /^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS /i;
const RE_EXT = /^CREATE EXTENSION IF NOT EXISTS /i;
const RE_ALTER = new RegExp(`^ALTER TABLE (?:IF EXISTS )?(?:ONLY )?${NOME} (.+)$`, 'i');
const RE_ACAO = /^ADD COLUMN IF NOT EXISTS /i;

/** Separa por vírgulas do nível de fora (ignora as de dentro de parênteses e de aspas). */
function virgulasDeFora(t) {
  const partes = []; let d = 0, ini = 0, q = '';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === q) q = ''; continue; }
    if (c === "'" || c === '"') q = c; else if (c === '(') d++; else if (c === ')') d--; else if (c === ',' && d === 0) { partes.push(t.slice(ini, i).trim()); ini = i + 1; }
  }
  partes.push(t.slice(ini).trim());
  return partes;
}

/** { aditiva, motivo, comandos } — aditiva = todos os comandos são dos tipos que podem rodar de novo sem alterar nada que já existe. */
export function classificar(sql) {
  const cmds = dividirComandos(String(sql || ''));
  if (!cmds.length) return { aditiva: false, motivo: 'arquivo sem comandos', comandos: 0 };
  for (const cmd of cmds) {
    const n = cmd.replace(/\s+/g, ' ').trim();
    if (RE_TABELA.test(n) || RE_INDICE.test(n) || RE_EXT.test(n)) continue;
    const a = RE_ALTER.exec(n);
    if (a && virgulasDeFora(a[1]).every(x => RE_ACAO.test(x))) continue;
    return { aditiva: false, motivo: 'não é aditiva: ' + n.split(' ').slice(0, 3).join(' '), comandos: cmds.length };
  }
  return { aditiva: true, motivo: null, comandos: cmds.length };
}

/* ----------------------------------------------------------------------------------------------- catálogo */
/** Lê a pasta (arquivos .sql soltos ou subpastas com migration.sql, como o Netlify), em ordem lexicográfica. */
export function catalogoDePasta(dir) {
  if (!fs.existsSync(dir)) return [];
  const itens = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.sql')) itens.push({ nome: e.name, arq: path.join(dir, e.name) });
    else if (e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'migration.sql'))) itens.push({ nome: e.name, arq: path.join(dir, e.name, 'migration.sql') });
  }
  itens.sort((a, b) => (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0));
  return itens.map(({ nome, arq }) => {
    const sql = fs.readFileSync(arq, 'utf8'), c = classificar(sql);
    return { nome, sha256: createHash('sha256').update(sql).digest('hex'), aditiva: c.aditiva, motivo: c.motivo, sql: c.aditiva ? sql : null };
  });
}

/** Código-fonte do módulo embutido nas Netlify Functions (só as migrações aditivas levam o SQL; as demais, só o nome). Determinístico. */
export function gerarEmbutidas(catalogo) {
  return `/* GERADO por scripts/run-migrations.mjs a partir de netlify/database/migrations/ — não edite (o build refaz este arquivo).
   Só as migrações aditivas (que podem rodar duas vezes sem dano) levam o SQL; as demais ficam só com o nome: são do deploy do Netlify. */
export const MIGRACOES = ${JSON.stringify(catalogo.map(({ nome, sha256, aditiva, motivo, sql }) => ({ nome, sha256, aditiva, motivo, sql })), null, 2)};
`;
}

/* ----------------------------------------------------------------------------------------------- verificação do esquema */
/** Objetos que esta versão do painel exige do banco (acrescente aqui quando uma migração nova passar a ser necessária). */
export const VERIFICACOES = [
  { rotulo: 'Dados dos módulos (documentos, sessões, log de mudanças, arquivos)', tabelas: ['documentos', 'sessoes', 'tentativas_login', 'mudancas', 'arquivos', 'arquivo_partes'] },
  { rotulo: 'Módulo Contábil (plano de contas, lançamentos e partidas)', tabelas: ['contab_contas', 'contab_lancamentos', 'contab_partidas', 'contab_parametros', 'contab_lalur'] },
  { rotulo: 'De-para do FCX para as contas', tabelas: ['contab_depara'] },
  { rotulo: 'Cadastro de empresas (multiempresas)', tabelas: ['contab_empresas'], colunas: [['contab_lancamentos', 'empresa_id']] },
  { rotulo: 'Empresas: dados da Receita Federal (v13.94)', colunas: [['contab_empresas', 'receita']] },
  { rotulo: 'Índice de documentos dos lançamentos', indices: ['contab_lanc_doc_ref_ix'] },
];

export async function verificarEsquema(c) {
  const existe = async rel => (await c.query('SELECT to_regclass($1) IS NOT NULL AS ok', ['public.' + rel])).rows[0].ok;
  const coluna = async (t, col) => (await c.query(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2) AS ok`, [t, col])).rows[0].ok;
  const out = [];
  for (const v of VERIFICACOES) {
    const falta = [];
    for (const t of v.tabelas || []) if (!(await existe(t))) falta.push(t);
    for (const [t, col] of v.colunas || []) if (!(await coluna(t, col))) falta.push(`${t}.${col}`);
    for (const i of v.indices || []) if (!(await existe(i))) falta.push(i);
    out.push({ rotulo: v.rotulo, ok: falta.length === 0, falta });
  }
  return out;
}

/* ----------------------------------------------------------------------------------------------- situação e execução */
const msgDe = e => String(e?.message || e).split('\n')[0].slice(0, 300); // só a 1ª linha (sem DETAIL, que pode trazer dados)
const resumir = migracoes => {
  const r = { aplicadas: 0, pendentes: 0, adiadas: 0, netlify: 0, falhas: 0 };
  for (const m of migracoes) { if (m.estado === 'aplicada') r.aplicadas++; else if (m.estado === 'pendente') r.pendentes++; else if (m.estado === 'adiada') r.adiadas++; else if (m.estado === 'netlify') r.netlify++; else if (m.estado === 'falhou') r.falhas++; }
  return r;
};
const iso = d => (d instanceof Date ? d.toISOString() : d ? String(d) : null);
const linhaNetlify = m => ({ nome: m.nome, tipo: 'netlify', estado: 'netlify', motivo: m.motivo });

/** Só leitura: o que está aplicado, o que está pendente e se o esquema que o painel exige está completo. Nunca altera o banco. */
export async function situacao(pool, catalogo) {
  const c = await pool.connect();
  try {
    const base = (await c.query(`SELECT to_regclass('public.documentos') IS NOT NULL AS ok`)).rows[0].ok;
    const temLivro = (await c.query(`SELECT to_regclass('public.${LIVRO}') IS NOT NULL AS ok`)).rows[0].ok;
    const livro = new Map(temLivro ? (await c.query(`SELECT nome, sha256, origem, aplicada_em FROM ${LIVRO}`)).rows.map(r => [r.nome, r]) : []);
    const migracoes = catalogo.map(m => {
      if (!m.aditiva) return linhaNetlify(m);
      const r = livro.get(m.nome);
      return r ? { nome: m.nome, tipo: 'aditiva', estado: 'aplicada', origem: r.origem, em: iso(r.aplicada_em), ...(r.sha256 !== m.sha256 ? { aviso: 'arquivo alterado depois de aplicado (não é rodado de novo)' } : {}) }
               : { nome: m.nome, tipo: 'aditiva', estado: base ? 'pendente' : 'adiada', ...(base ? {} : { motivo: 'banco ainda sem o esquema inicial (o deploy do Netlify aplica)' }) };
    });
    return { base, livro: temLivro, resumo: resumir(migracoes), migracoes, esquema: base ? await verificarEsquema(c) : [] };
  } finally { c.release(); }
}

/** Roda as migrações aditivas pendentes (uma transação por arquivo) e devolve o relatório. Não lança erro de SQL: ele vai no relatório. */
export async function executar(pool, catalogo, { origem = 'build', lockMs = 10000, stmtMs = 120000 } = {}) {
  const c = await pool.connect();
  const rel = { base: false, livro: false, migracoes: [], executadas: [], falhou: null, erroLivro: null };
  try {
    rel.base = (await c.query(`SELECT to_regclass('public.documentos') IS NOT NULL AS ok`)).rows[0].ok;
    if (!rel.base) { // banco novo: o esquema inicial é do deploy do Netlify; nada é tocado aqui
      rel.migracoes = catalogo.map(m => (m.aditiva ? { nome: m.nome, tipo: 'aditiva', estado: 'adiada', motivo: 'banco ainda sem o esquema inicial (o deploy do Netlify aplica)' } : linhaNetlify(m)));
      return { ...rel, resumo: resumir(rel.migracoes) };
    }
    let livro = new Map();
    try {
      await c.query('BEGIN'); await c.query(`SELECT pg_advisory_xact_lock(${CHAVE_TRAVA})`); await c.query(LIVRO_SQL); await c.query('COMMIT'); rel.livro = true;
      livro = new Map((await c.query(`SELECT nome, sha256, origem, aplicada_em FROM ${LIVRO}`)).rows.map(r => [r.nome, r]));
    } catch (e) { try { await c.query('ROLLBACK'); } catch { /* conexão perdida */ } rel.erroLivro = msgDe(e); }
    if (rel.erroLivro) {
      rel.migracoes = catalogo.map(m => (m.aditiva ? { nome: m.nome, tipo: 'aditiva', estado: 'adiada', motivo: 'não consegui criar o livro-razão painel_migracoes: ' + rel.erroLivro } : linhaNetlify(m)));
      return { ...rel, resumo: resumir(rel.migracoes) };
    }
    for (const m of catalogo) {
      if (!m.aditiva) { rel.migracoes.push(linhaNetlify(m)); continue; }
      const feita = livro.get(m.nome), jaFeita = r => ({ nome: m.nome, tipo: 'aditiva', estado: 'aplicada', origem: r.origem, em: iso(r.aplicada_em), ...(r.sha256 !== m.sha256 ? { aviso: 'arquivo alterado depois de aplicado (não é rodado de novo)' } : {}) });
      if (feita) { rel.migracoes.push(jaFeita(feita)); continue; }
      if (rel.falhou) { rel.migracoes.push({ nome: m.nome, tipo: 'aditiva', estado: 'pendente', motivo: `aguardando a correção de ${rel.falhou.nome}` }); continue; }
      try {
        await c.query('BEGIN');
        await c.query(`SET LOCAL lock_timeout = ${Math.max(1, Math.floor(lockMs))}`);
        await c.query(`SET LOCAL statement_timeout = ${Math.max(1, Math.floor(stmtMs))}`);
        await c.query(`SELECT pg_advisory_xact_lock(${CHAVE_TRAVA})`);
        const outra = (await c.query(`SELECT nome, sha256, origem, aplicada_em FROM ${LIVRO} WHERE nome = $1`, [m.nome])).rows[0];
        if (outra) { await c.query('COMMIT'); rel.migracoes.push(jaFeita(outra)); continue; } // outra execução acabou de aplicar
        for (const cmd of dividirComandos(m.sql)) await c.query(cmd);
        await c.query(`INSERT INTO ${LIVRO} (nome, sha256, origem) VALUES ($1, $2, $3)`, [m.nome, m.sha256, origem]);
        await c.query('COMMIT');
        rel.executadas.push(m.nome);
        rel.migracoes.push({ nome: m.nome, tipo: 'aditiva', estado: 'aplicada', origem, em: new Date().toISOString(), agora: true });
      } catch (e) {
        try { await c.query('ROLLBACK'); } catch { /* conexão perdida */ }
        if (ADIAVEIS.has(e?.code)) rel.migracoes.push({ nome: m.nome, tipo: 'aditiva', estado: 'adiada', codigo: e.code, motivo: 'depende de uma migração que o Netlify ainda não aplicou: ' + msgDe(e) });
        else { rel.falhou = { nome: m.nome, codigo: e?.code || null, mensagem: msgDe(e) }; rel.migracoes.push({ nome: m.nome, tipo: 'aditiva', estado: 'falhou', codigo: e?.code || null, motivo: msgDe(e) }); }
      }
    }
    return { ...rel, resumo: resumir(rel.migracoes) };
  } finally { c.release(); }
}
