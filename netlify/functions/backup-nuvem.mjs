/* /api/backup-nuvem — Pontos de Restauração na Nuvem (v13.95). A lógica está em netlify/lib/backup-nuvem.mjs.
   GET                                  → o mesmo que { acao: 'listar' }
   POST { acao: 'criar', nota? }                        → ponto MANUAL agora             (Master ou quem tem backup.exportar)
   POST { acao: 'listar' }                              → os 30 últimos pontos, sem o conteúdo (Master ou quem tem backup.exportar)
   POST { acao: 'restaurar', id, confirmacao: 'RESTAURAR', incluirUsuarios? }
                                                        → aplica o ponto (SÓ Master), com backup preventivo automático antes
   POST { acao: 'verificar-primeiro-acesso' }           → qualquer perfil logado: se ainda não há ponto hoje, cria um PRIMEIRO_ACESSO
   401 sem sessão (ou com troca de senha pendente) · 403 sem permissão · 405 outro método. O conteúdo dos pontos nunca sai por esta rota. */
import { json, erro, rota, ErroHttp } from '../lib/http.mjs';
import { sessaoDe } from '../lib/sessao.mjs';
import { NIVEL } from '../lib/regras.mjs';
import { tem } from '../lib/permissoes.mjs';
import { criarManual, listar, restaurar, verificarPrimeiroAcesso } from '../lib/backup-nuvem.mjs';

const podeVer = s => s.nivel >= NIVEL.admin || tem(s.perms, 'backup.exportar');

export default rota(async req => {
  const sess = await sessaoDe(req);
  if (!sess || sess.trocaPendente) return erro(401, 'Sessão encerrada. Faça login de novo.');
  let acao;
  if (req.method === 'GET') acao = 'listar';
  else if (req.method === 'POST') {
    const t = await req.text(); let corpo; if (t.length > 20000) throw new ErroHttp(413, 'Requisição grande demais.');
    try { corpo = t ? JSON.parse(t) : {}; } catch { throw new ErroHttp(400, 'Corpo inválido.'); }
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new ErroHttp(400, 'Corpo inválido.');
    acao = String(corpo.acao || '');
    if (acao === 'verificar-primeiro-acesso') return json(200, await verificarPrimeiroAcesso(sess)); // qualquer perfil (inclusive Loja)
    if (acao === 'listar') { if (!podeVer(sess)) return erro(403, 'Sem permissão para ver os pontos de restauração.'); return json(200, await listar()); }
    if (acao === 'criar') { if (!podeVer(sess)) return erro(403, 'Sem permissão para criar pontos de restauração.'); return json(200, { ok: true, ...(await criarManual(sess, corpo.nota)) }); }
    if (acao === 'restaurar') {
      if (sess.nivel < NIVEL.admin) return erro(403, 'Só o Master restaura um ponto de restauração.');
      return json(200, await restaurar(sess, { id: corpo.id, confirmacao: corpo.confirmacao, incluirUsuarios: corpo.incluirUsuarios === true }));
    }
    return erro(400, 'Ação desconhecida. Use criar, listar, restaurar ou verificar-primeiro-acesso.');
  } else return erro(405, 'Método não permitido.');
  if (!podeVer(sess)) return erro(403, 'Sem permissão para ver os pontos de restauração.');
  return json(200, await listar());
});
export const config = { path: '/api/backup-nuvem' };
