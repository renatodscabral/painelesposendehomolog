/* /api/docs — leitura e gravação dos documentos do painel (com as regras de acesso).
   GET    ?caminho=col/id                                   → { doc }
   GET    ?colecao=col[&ordem=campo&dir=desc&limite=n][&apos=id] → { docs, proximo }
   PUT    ?caminho=col/id   { dados }                       → grava (substitui)
   DELETE ?caminho=col/id                                   → exclui
   POST   /api/docs/lote    { ops: [{ op: 'set'|'remove', caminho, dados }] } → grava em lote (uma transação) */
import { tx, faxina } from '../lib/db.mjs';
import { json, erro, rota, ErroHttp } from '../lib/http.mjs';
import { sessaoDe } from '../lib/sessao.mjs';
import { lerDoc, listar, gravar, remover, executarLote } from '../lib/documentos.mjs';

async function corpoJson(req, max = 6 * 1024 * 1024) {
  const t = await req.text(); if (t.length > max) throw new ErroHttp(413, 'Requisição grande demais.');
  try { return JSON.parse(t); } catch { throw new ErroHttp(400, 'Corpo inválido.'); }
}

export default rota(async req => {
  const url = new URL(req.url), sess = await sessaoDe(req);
  if (!sess) return erro(401, 'Sessão encerrada. Faça login de novo.');

  if (url.pathname.endsWith('/lote')) {
    if (req.method !== 'POST') return erro(405, 'Método não permitido.');
    const { ops } = await corpoJson(req);
    const resultados = await executarLote(sess, ops);
    faxina();
    return json(200, { resultados });
  }

  const caminho = url.searchParams.get('caminho');
  if (req.method === 'GET') {
    if (caminho) return json(200, { doc: await lerDoc(sess, caminho) });
    const colecao = url.searchParams.get('colecao'); if (!colecao) throw new ErroHttp(400, 'Informe caminho ou colecao.');
    return json(200, await listar(sess, colecao, { ordem: url.searchParams.get('ordem'), dir: url.searchParams.get('dir'), limite: url.searchParams.get('limite'), apos: url.searchParams.get('apos') }));
  }
  if (!caminho) throw new ErroHttp(400, 'Informe o caminho.');
  if (req.method === 'PUT') { const { dados } = await corpoJson(req); await tx(t => gravar(t, sess, caminho, dados)); faxina(); return json(200, { ok: true }); }
  if (req.method === 'DELETE') { await tx(t => remover(t, sess, caminho)); return json(200, { ok: true }); }
  return erro(405, 'Método não permitido.');
});
export const config = { path: ['/api/docs', '/api/docs/lote'] };
