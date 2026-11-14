/* GET /api/mudancas?desde=<seq> — coleções alteradas desde a última consulta (sincroniza os computadores).
   desde=-1 devolve só o número atual. O painel consulta a cada poucos segundos e relê só o que mudou. */
import { q } from '../lib/db.mjs';
import { json, erro, rota } from '../lib/http.mjs';
import { sessaoDe } from '../lib/sessao.mjs';
import { podeLer } from '../lib/documentos.mjs';
import { salariosLiberados, ehColecaoSalarios } from '../lib/arvore-rh.mjs';

export default rota(async req => {
  const sess = await sessaoDe(req); if (!sess) return erro(401, 'Sessão encerrada. Faça login de novo.');
  const desde = Number(new URL(req.url).searchParams.get('desde'));
  if (!Number.isFinite(desde) || desde < 0) { const [r] = await q('SELECT COALESCE(max(seq), 0)::bigint AS seq FROM mudancas'); return json(200, { seq: Number(r.seq), colecoes: [] }); }
  const rs = await q('SELECT colecao, max(seq)::bigint AS s FROM mudancas WHERE seq > $1 GROUP BY colecao ORDER BY s LIMIT 5000', [desde]);
  const seq = rs.reduce((m, r) => Math.max(m, Number(r.s)), desde);
  const cols = rs.map(r => r.colecao), arv = cols.some(ehColecaoSalarios) && !sess.trocaPendente ? await salariosLiberados(sess) : null; /* v14.12: o gestor de topo também é avisado das mudanças de salário (só leem os da própria árvore) */
  return json(200, { seq, colecoes: cols.filter(c => podeLer(sess, c) || (arv && ehColecaoSalarios(c))) });
});
export const config = { path: '/api/mudancas' };
