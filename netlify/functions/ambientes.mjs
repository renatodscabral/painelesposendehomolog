/* v13.76 · /api/ambientes/<prod|homolog|rc>/docs[/lote] — a Gestão de Ambientes (Backup) do Master lê e grava no
   banco de OUTRO ambiente. O navegador fala só com o próprio site; este repassa ao site do ambiente pedido
   (/api/inter/…) com a chave compartilhada, e o site de destino aplica a política entre ambientes. */
import { erro, rota } from '../lib/http.mjs';
import { sessaoDe } from '../lib/sessao.mjs';
import { NIVEL } from '../lib/regras.mjs';
import { ambienteAtual, IDS } from '../lib/ambiente.mjs';
import { chamarAmbiente } from '../lib/inter.mjs';

export default rota(async req => {
  const sess = await sessaoDe(req);
  if (!sess || sess.trocaPendente) return erro(401, 'Sessão encerrada. Faça login de novo.');
  if (sess.nivel < NIVEL.admin) return erro(403, 'Só o Master usa a Gestão de Ambientes.');
  const url = new URL(req.url), [, , alvo, ...resto] = url.pathname.split('/').filter(Boolean); // api/ambientes/<alvo>/docs[/lote]
  if (!IDS.includes(alvo)) return erro(404, 'Ambiente desconhecido.');
  if (alvo === ambienteAtual()) return erro(400, 'Este já é o ambiente deste site: use /api/docs.');
  const destino = '/api/inter/' + resto.join('/');
  if (!['/api/inter/docs', '/api/inter/docs/lote'].includes(destino)) return erro(404, 'Rota não encontrada.');
  const r = await chamarAmbiente(alvo, destino + url.search, { metodo: req.method, corpo: req.method === 'GET' ? undefined : await req.text(), ator: sess.uid, tempo: 25000 });
  return new Response(await r.text(), { status: r.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
});
export const config = { path: '/api/ambientes/*' };
