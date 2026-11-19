/* /api/aprovacoes-saidas — Aprovação de pagamentos das Saídas do Dia (v14.02). A lógica está em netlify/lib/saidas-aprovacoes.mjs.
   GET ?dia=AAAA-MM-DD                      → o mesmo que { acao: 'estado', dia }
   POST { acao: 'estado', dia }             → { podeAprovar, decisoes: { <idDoTítuloNoFCX>: { status, por, em, loteId } }, lotes: [...] }   (quem vê a Tela Inicial/FCX ou aprova)
   POST { acao: 'finalizar', dia, idem, itens: [{ id, status: 'APROVADO'|'RETIDO', valor }] }
                                            → grava o lote e devolve { repetido, lote, itens }                                              (Master ou "Autorizar Pagamentos nas Saídas do Dia")
   POST { acao: 'lote', id }                → { lote, itens } de um lote já gravado (reabrir o relatório)                                    (quem vê)
   401 sem sessão · 403 sem permissão ou recurso desligado · 409 o FCX mudou · 422 dados inválidos · 503 sem tabelas (rode as migrações).
   O CPF do aprovador só sai mascarado. Nada é apagado: cada "Finalizar" cria um lote novo. */
import { json, erro, rota, ErroHttp } from '../lib/http.mjs';
import { sessaoDe } from '../lib/sessao.mjs';
import { RECURSO, podeVer, podeAprovar, estadoDia, finalizar, lerLote } from '../lib/saidas-aprovacoes.mjs';

const traduzir = e => (e?.code === '42P01' ? new ErroHttp(503, 'As tabelas da aprovação de pagamentos ainda não existem neste banco. Em Backup e dados › Banco de dados · Migrações, execute as migrações (ou publique de novo no Netlify).', { codigo: 'sem_esquema' }) : e);

export default rota(async req => {
  const sess = await sessaoDe(req);
  if (!sess || sess.trocaPendente) return erro(401, 'Sessão encerrada. Faça login de novo.');
  let corpo = {};
  if (req.method === 'POST') {
    const t = await req.text(); if (t.length > 600000) throw new ErroHttp(413, 'Requisição grande demais.');
    try { corpo = t ? JSON.parse(t) : {}; } catch { throw new ErroHttp(400, 'Corpo inválido.'); }
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new ErroHttp(400, 'Corpo inválido.');
  } else if (req.method === 'GET') corpo = { dia: new URL(req.url).searchParams.get('dia') || '' };
  else return erro(405, 'Método não permitido.');
  const acao = req.method === 'GET' ? 'estado' : String(corpo.acao || '');
  if (!sess.recursoAtivo(RECURSO)) return erro(403, 'A aprovação de pagamentos das Saídas do Dia (v14.02) ainda não foi liberada neste ambiente.', { codigo: 'recurso_desligado' });
  try {
    switch (acao) {
      case 'estado':
        if (!podeVer(sess)) return erro(403, 'Sem permissão para ver as aprovações de pagamentos.');
        return json(200, { ok: true, podeAprovar: podeAprovar(sess), ...(await estadoDia(String(corpo.dia || ''))) });
      case 'lote':
        if (!podeVer(sess)) return erro(403, 'Sem permissão para ver as aprovações de pagamentos.');
        return json(200, { ok: true, ...(await lerLote(corpo.id)) });
      case 'finalizar': {
        if (!podeAprovar(sess)) return erro(403, 'Seu acesso não autoriza pagamentos nas Saídas do Dia (Gestão de Acessos › Visão › "Autorizar Pagamentos nas Saídas do Dia").');
        const r = await finalizar(sess, { dia: corpo.dia, idem: corpo.idem, itens: corpo.itens });
        return json(r.repetido ? 200 : 201, { ok: true, ...r });
      }
      default: return erro(400, 'Ação desconhecida. Use estado, finalizar ou lote.');
    }
  } catch (e) { throw traduzir(e); }
});
export const config = { path: '/api/aprovacoes-saidas' };
