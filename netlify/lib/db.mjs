/* Conexão com o Netlify Database (Postgres). getDatabase() lê NETLIFY_DB_URL, que o Netlify injeta sozinho. */
import { getDatabase } from '@netlify/database';

let _db = null;
export const db = () => (_db ||= getDatabase());

/** Consulta parametrizada ($1, $2…) — devolve as linhas. */
export async function q(texto, params = []) { return (await db().pool.query(texto, params)).rows; }

/** Transação: BEGIN … COMMIT na mesma conexão (ROLLBACK em erro). */
export async function tx(fn) {
  const c = await db().pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(async (texto, params = []) => (await c.query(texto, params)).rows);
    await c.query('COMMIT'); return r;
  } catch (e) { try { await c.query('ROLLBACK'); } catch { /* conexão perdida */ } throw e; }
  finally { c.release(); }
}

/** Limpeza ocasional (≈2% das gravações): log de mudanças com mais de 3 dias, sessões vencidas e tentativas antigas. */
export async function faxina() {
  if (Math.random() > 0.02) return;
  try {
    await q(`DELETE FROM mudancas WHERE em < now() - interval '3 days'`);
    await q(`DELETE FROM sessoes WHERE expira_em < now()`);
    await q(`DELETE FROM tentativas_login WHERE em < now() - interval '1 day'`);
    await q(`DELETE FROM arquivos WHERE NOT concluido AND criado_em < now() - interval '1 day'`);
  } catch { /* não bloqueia a gravação */ }
}
