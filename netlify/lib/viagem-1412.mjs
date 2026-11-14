/* v14.12 · Viagens e Adiantamentos (Lote 2) — regras puras e a escrita de auditoria no servidor.
   · devolucao12: devolução de saldo informada pelo viajante, conciliada com o extrato OFX (status aguardando_ofx → confirmada_ofx | encerrada_sem_ofx).
   · encerrar antes de o crédito aparecer no OFX exige JUSTIFICATIVA e grava obrigatoriamente o evento de auditoria `encerramento_viagem_sem_ofx`. */
import { randomUUID } from 'node:crypto';
import { RECURSO } from './arvore-rh.mjs';
import { ErroHttp } from './http.mjs';

export const EVENTO_SEM_OFX = 'encerramento_viagem_sem_ofx';
export const MIN_JUSTIFICATIVA = 10;
const MAX_EVENTOS = 350; /* o painel guarda até 350 eventos por documento de dia (Audit.MAX) */

/** Pura: o que fazer ao encerrar uma viagem que tem devolução de saldo. */
export function decisaoEncerramento(v, justificativa, ativo = true) {
  const dev = v?.devolucao12;
  if (!ativo || !dev || dev.status === 'confirmada_ofx' || dev.status === 'encerrada_sem_ofx') return { exige: false, semOfx: false };
  if (dev.ofx?.encontrado) return { exige: false, semOfx: false };
  const j = String(justificativa || '').trim();
  if (j.length < MIN_JUSTIFICATIVA) return { exige: true, semOfx: true, erro: `O crédito da devolução ainda não foi localizado no extrato OFX: informe a justificativa (mínimo de ${MIN_JUSTIFICATIVA} caracteres) para encerrar antes da confirmação bancária.` };
  return { exige: true, semOfx: true, justificativa: j.slice(0, 500) };
}

/** Escreve o evento no ramo de auditoria da própria conta (auditoria/<uid>/dias/<dia>[_n]), dentro da transação do encerramento. */
export async function registrarAuditoria(t, sess, ev) {
  const ts = new Date().toISOString(), dia = ts.slice(0, 10), base = `auditoria/${sess.uid}/dias/`, evento = { ts, uid: sess.uid, conta: sess.uid, perfil: sess.perfil === 'MASTER' ? 'GESTOR' : sess.perfil, id: 'ev-' + randomUUID().slice(0, 8), ...ev };
  let parte = 0, doc = null;
  for (; ; parte++) {
    const caminho = base + dia + (parte ? '_' + parte : ''), [r] = await t('SELECT dados FROM documentos WHERE caminho = $1', [caminho]);
    if (!r) { doc = { dia, eventos: [] }; break; }
    if ((r.dados.eventos || []).length < MAX_EVENTOS) { doc = r.dados; break; }
  }
  const novo = { dia, parte, uid: sess.uid, eventos: [...(doc.eventos || []), evento] }, caminho = base + dia + (parte ? '_' + parte : ''), colecao = `auditoria/${sess.uid}/dias`, docId = dia + (parte ? '_' + parte : '');
  await t(`INSERT INTO documentos (caminho, colecao, doc_id, dados, atualizado_por) VALUES ($1, $2, $3, $4::jsonb, $5)
           ON CONFLICT (caminho) DO UPDATE SET dados = EXCLUDED.dados, versao = documentos.versao + 1, atualizado_em = now(), atualizado_por = EXCLUDED.atualizado_por`, [caminho, colecao, docId, JSON.stringify(novo), sess.uid]);
  await t('INSERT INTO mudancas (caminho, colecao, op, por) VALUES ($1, $2, $3, $4)', [caminho, colecao, 'set', sess.uid]);
  return evento;
}

export const ativoNaSessao = sess => typeof sess?.recursoAtivo === 'function' && !!sess.recursoAtivo(RECURSO);
export { ErroHttp };
