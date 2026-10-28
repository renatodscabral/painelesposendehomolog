/* Sessão do login por CPF: token aleatório no cookie HttpOnly; no banco só o SHA-256 do token. */
import { createHash, randomBytes } from 'node:crypto';
import { q } from './db.mjs';
import { lerCookie, SESSAO_HORAS } from './http.mjs';
import { nivelDoPerfil } from './regras.mjs';

export const hashToken = t => createHash('sha256').update(String(t)).digest('hex');

export async function criarSessao({ usuarioCaminho, ambiente, trocaPendente, ip, agente }) {
  const token = randomBytes(32).toString('base64url');
  await q(`INSERT INTO sessoes (token_hash, usuario_caminho, ambiente, troca_pendente, expira_em, ip, agente)
           VALUES ($1, $2, $3, $4, now() + ($5 || ' hours')::interval, $6, $7)`,
    [hashToken(token), usuarioCaminho, ambiente, !!trocaPendente, String(SESSAO_HORAS), ip || null, String(agente || '').slice(0, 300)]);
  return token;
}

/** Sessão válida do cookie, com o usuário atual do banco (perfil e situação relidos a cada requisição). */
export async function sessaoDe(req) {
  const token = lerCookie(req); if (!token) return null;
  const th = hashToken(token);
  const [s] = await q(`SELECT s.token_hash, s.usuario_caminho, s.ambiente, s.troca_pendente, d.doc_id AS uid, d.dados AS usuario
                       FROM sessoes s LEFT JOIN documentos d ON d.caminho = s.usuario_caminho
                       WHERE s.token_hash = $1 AND s.expira_em > now()`, [th]);
  if (!s) return null;
  if (!s.usuario || s.usuario.ativo === false) { await q('DELETE FROM sessoes WHERE token_hash = $1', [th]); return null; }
  return { tokenHash: th, uid: s.uid, caminho: s.usuario_caminho, ambiente: s.ambiente, trocaPendente: s.troca_pendente,
           perfil: s.usuario.perfil, nivel: nivelDoPerfil(s.usuario.perfil), usuario: s.usuario };
}
