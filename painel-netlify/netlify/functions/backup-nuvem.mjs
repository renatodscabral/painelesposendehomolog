/* /api/backup-nuvem — Pontos de Restauração na Nuvem (v13.95). A lógica está em netlify/lib/backup-nuvem.mjs.
   GET                                  → o mesmo que { acao: 'listar' }
   POST { acao: 'criar', nota? }                        → ponto MANUAL agora             (Master ou quem tem backup.exportar)
   POST { acao: 'listar' }                              → os 30 últimos pontos, sem o conteúdo (Master ou quem tem backup.exportar)
   POST { acao: 'restaurar', id, confirmacao: 'RESTAURAR', incluirUsuarios? }
                                                        → aplica o ponto (SÓ Master), com backup preventivo automático antes
   POST { acao: 'verificar-primeiro-acesso' }           → qualquer perfil logado: se ainda não há ponto hoje, cria um PRIMEIRO_ACESSO
   v14.13 (recurso gestao_v1413; 404 'recurso_indisponivel' com ele desligado):
   POST { acao: 'conteudo', id }                        → resumo por frente (módulo) do que o ponto guarda: coleções, tabelas, total e destaques da DFC (Master ou backup.exportar)
   POST { acao: 'tabelas' }                             → o conteúdo atual das tabelas de configuração (Central de Notificações, empresas e de-para contábeis), para o .json de contingência (Master ou backup.exportar)
   POST { acao: 'restaurar-tabelas', tabelas }          → grava essas tabelas a partir de um arquivo .json (SÓ Master), com ponto preventivo antes; corpo até 2 MB
   401 sem sessão (ou com troca de senha pendente) · 403 sem permissão · 405 outro método. O conteúdo dos pontos nunca sai por esta rota. */
import { json, erro, rota, ErroHttp } from '../lib/http.mjs';
import { sessaoDe } from '../lib/sessao.mjs';
import { NIVEL } from '../lib/regras.mjs';
import { tem } from '../lib/permissoes.mjs';
import { criarManual, listar, restaurar, verificarPrimeiroAcesso, conteudo, exportarTabelas, restaurarTabelas } from '../lib/backup-nuvem.mjs';
import { RECURSO } from '../lib/dfc-1413.mjs';

const LIMITE_PADRAO = 20000, LIMITE_TABELAS = 2 * 1024 * 1024;

const podeVer = s => s.nivel >= NIVEL.admin || tem(s.perms, 'backup.exportar');

export default rota(async req => {
  const sess = await sessaoDe(req);
  if (!sess || sess.trocaPendente) return erro(401, 'Sessão encerrada. Faça login de novo.');
  let acao;
  if (req.method === 'GET') acao = 'listar';
  else if (req.method === 'POST') {
    const t = await req.text(); let corpo; if (t.length > LIMITE_TABELAS) throw new ErroHttp(413, 'Requisição grande demais.');
    try { corpo = t ? JSON.parse(t) : {}; } catch { throw new ErroHttp(400, 'Corpo inválido.'); }
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new ErroHttp(400, 'Corpo inválido.');
    acao = String(corpo.acao || '');
    if (acao !== 'restaurar-tabelas' && t.length > LIMITE_PADRAO) throw new ErroHttp(413, 'Requisição grande demais.');
    if (acao === 'verificar-primeiro-acesso') return json(200, await verificarPrimeiroAcesso(sess)); // qualquer perfil (inclusive Loja)
    if (acao === 'listar') { if (!podeVer(sess)) return erro(403, 'Sem permissão para ver os pontos de restauração.'); return json(200, await listar()); }
    if (acao === 'criar') { if (!podeVer(sess)) return erro(403, 'Sem permissão para criar pontos de restauração.'); return json(200, { ok: true, ...(await criarManual(sess, corpo.nota)) }); }
    if (acao === 'restaurar') {
      if (sess.nivel < NIVEL.admin) return erro(403, 'Só o Master restaura um ponto de restauração.');
      return json(200, await restaurar(sess, { id: corpo.id, confirmacao: corpo.confirmacao, incluirUsuarios: corpo.incluirUsuarios === true }));
    }
    if (acao === 'conteudo' || acao === 'tabelas' || acao === 'restaurar-tabelas') {
      if (!sess.recursoAtivo(RECURSO)) return erro(404, 'Recurso ainda não liberado neste ambiente.', { codigo: 'recurso_indisponivel' });
      if (acao === 'restaurar-tabelas') { if (sess.nivel < NIVEL.admin) return erro(403, 'Só o Master restaura as tabelas de um arquivo de backup.'); return json(200, await restaurarTabelas(sess, corpo.tabelas)); }
      if (!podeVer(sess)) return erro(403, 'Sem permissão para ver o conteúdo dos backups.');
      return json(200, acao === 'conteudo' ? await conteudo(corpo.id) : await exportarTabelas());
    }
    return erro(400, 'Ação desconhecida. Use criar, listar, restaurar, conteudo, tabelas, restaurar-tabelas ou verificar-primeiro-acesso.');
  } else return erro(405, 'Método não permitido.');
  if (!podeVer(sess)) return erro(403, 'Sem permissão para ver os pontos de restauração.');
  return json(200, await listar());
});
export const config = { path: '/api/backup-nuvem' };
