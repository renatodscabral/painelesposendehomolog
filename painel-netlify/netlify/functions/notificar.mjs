/* /api/notificar — Central de Notificações (v14.00). A lógica está em netlify/lib/notif-motor.mjs.
   GET                                            → o mesmo que { acao: 'estado' }
   POST { acao: 'estado' }                        → configuração (só os NOMES das variáveis que faltam), regras, parâmetros e totais   (Master)
   POST { acao: 'salvar-regra', evento, ativo?, canal?, destinatarios?, parametros? }                                                  (Master)
   POST { acao: 'testar', evento, canal?, para: { email?, telefone? } }   → envia a mensagem de exemplo, marcada [TESTE]             (Master)
   POST { acao: 'logs', status?, canal?, evento?, teste?, de?, ate?, busca?, limite?, antes? }  → auditoria dos envios              (Master)
   POST { acao: 'log', id }                       → o conteúdo guardado de um envio                                                    (Master)
   POST { acao: 'reenviar', id }                  → manda de novo o que foi guardado                                                   (Master)
   POST { acao: 'instantaneo', dados }            → o painel publica o Resumo do Recebível (Master ou quem vê o FCX)
   POST { acao: 'saidas-aprovadas', loteId }      → v14.02: avisa o Financeiro e os Masters (e-mail com PDF + WhatsApp) que as aprovações das Saídas do Dia foram finalizadas   (Master ou "Autorizar Pagamentos nas Saídas do Dia")
   401 sem sessão · 403 sem permissão ou recurso desligado · 405 outro método. Chaves e tokens dos provedores nunca saem por esta rota. */
import { json, erro, rota, ErroHttp } from '../lib/http.mjs';
import { sessaoDe } from '../lib/sessao.mjs';
import { NIVEL } from '../lib/regras.mjs';
import { tem } from '../lib/permissoes.mjs';
import { RECURSO, estadoCentral, salvarRegra, testar, listarLogs, lerLog, reenviar, publicarSnapshotRecebivel, notificarLote } from '../lib/notif-motor.mjs';
import { RECURSO as RECURSO_SAIDAS, PERM_APROVAR } from '../lib/saidas-aprovacoes.mjs';

const traduzir = e => (e?.code === '42P01' ? new ErroHttp(503, 'As tabelas da Central de Notificações ainda não existem neste banco. Em Backup e dados › Banco de dados · Migrações, execute as migrações (ou publique de novo no Netlify).', { codigo: 'sem_esquema' }) : e);

export default rota(async req => {
  const sess = await sessaoDe(req);
  if (!sess || sess.trocaPendente) return erro(401, 'Sessão encerrada. Faça login de novo.');
  let corpo = {};
  if (req.method === 'POST') {
    const t = await req.text(); if (t.length > 80000) throw new ErroHttp(413, 'Requisição grande demais.');
    try { corpo = t ? JSON.parse(t) : {}; } catch { throw new ErroHttp(400, 'Corpo inválido.'); }
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new ErroHttp(400, 'Corpo inválido.');
  } else if (req.method !== 'GET') return erro(405, 'Método não permitido.');
  const acao = req.method === 'GET' ? 'estado' : String(corpo.acao || '');
  const por = String(sess.usuario?.nome || '').slice(0, 80);
  try {
    if (acao === 'instantaneo') {
      if (!sess.recursoAtivo(RECURSO)) return json(200, { ok: true, ignorado: 'recurso desligado neste ambiente' });
      if (!(sess.nivel >= NIVEL.admin || tem(sess.perms, 'fcx.ver'))) return erro(403, 'Sem permissão para publicar o Resumo do Recebível.');
      return json(200, await publicarSnapshotRecebivel(corpo.dados, por));
    }
    if (acao === 'saidas-aprovadas') {
      if (!sess.recursoAtivo(RECURSO_SAIDAS)) return erro(403, 'A aprovação de pagamentos (v14.02) ainda não foi liberada neste ambiente.', { codigo: 'recurso_desligado' });
      if (!(sess.nivel >= NIVEL.admin || tem(sess.perms, PERM_APROVAR))) return erro(403, 'Sem permissão para avisar sobre as aprovações de pagamentos.');
      return json(200, { ok: true, ...(await notificarLote(corpo.loteId)) });
    }
    if (sess.nivel < NIVEL.admin) return erro(403, 'Só o Master gerencia a Central de Notificações.');
    if (!sess.recursoAtivo(RECURSO)) return erro(403, 'A Central de Notificações (v14.00) ainda não foi liberada neste ambiente.', { codigo: 'recurso_desligado' });
    switch (acao) {
      case 'estado': return json(200, await estadoCentral());
      case 'salvar-regra': return json(200, { ok: true, ...(await salvarRegra(String(corpo.evento || ''), { ativo: corpo.ativo, canal: corpo.canal, destinatarios: corpo.destinatarios, parametros: corpo.parametros }, por)) });
      case 'testar': return json(200, { ok: true, ...(await testar(String(corpo.evento || ''), { canal: corpo.canal, para: corpo.para && typeof corpo.para === 'object' ? corpo.para : {} })) });
      case 'logs': return json(200, await listarLogs(corpo));
      case 'log': return json(200, await lerLog(corpo.id));
      case 'reenviar': return json(200, { ok: true, ...(await reenviar(corpo.id, { por })) });
      default: return erro(400, 'Ação desconhecida. Use estado, salvar-regra, testar, logs, log, reenviar, instantaneo ou saidas-aprovadas.');
    }
  } catch (e) { throw traduzir(e); }
});
export const config = { path: '/api/notificar' };
