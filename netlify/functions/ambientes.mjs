/* v13.76 · /api/ambientes/<prod|homolog|rc>/docs[/lote] — a Gestão de Ambientes (Backup) do Master lê e grava no
   banco de OUTRO ambiente. O navegador fala só com o próprio site; este repassa ao site do ambiente pedido
   (/api/inter/…) com a chave compartilhada, e o site de destino aplica a política entre ambientes.
   v13.76.1: GET /api/ambientes/diagnostico (Master) — testa a ligação com cada ambiente e diz a causa exata. */
import { json, erro, rota } from '../lib/http.mjs';
import { sessaoDe } from '../lib/sessao.mjs';
import { NIVEL } from '../lib/regras.mjs';
import { ambienteAtual, IDS, urlDe, estadoChave, impressaoChave, ROTULO } from '../lib/ambiente.mjs';
import { chamarAmbiente } from '../lib/inter.mjs';

async function diagnostico() {
  const atual = ambienteAtual(), ec = estadoChave();
  const ambientes = [];
  for (const id of IDS.filter(x => x !== atual)) {
    const t0 = Date.now(), linha = { id, rotulo: ROTULO[id], url: urlDe(id) || null };
    try {
      const r = await chamarAmbiente(id, '/api/inter/ping', { tempo: 10000 }), j = await r.json().catch(() => ({}));
      Object.assign(linha, { ok: r.ok && j.ambiente === id, http: r.status, ms: Date.now() - t0, respondeu: j.ambiente || null, motivo: r.ok ? (j.ambiente === id ? null : `o endereço respondeu como "${j.ambiente}" — confira PAINEL_AMBIENTE daquele site`) : (j.detalhe?.motivo || j.motivo || j.erro || null), erro: r.ok ? null : j.erro || null });
    } catch (e) { Object.assign(linha, { ok: false, http: e.status || null, ms: Date.now() - t0, motivo: e.extra?.detalhe?.motivo || e.message, erro: e.message }); }
    if (!linha.ok) console.error(`[painel][diagnostico] ${atual} → ${id}: ${linha.http || 'sem HTTP'} ${linha.motivo || ''}`);
    ambientes.push(linha);
  }
  return { ambiente: atual, chave: { ...ec, impressao: impressaoChave() }, ambientes };
}

export default rota(async req => {
  const sess = await sessaoDe(req);
  if (!sess || sess.trocaPendente) return erro(401, 'Sessão encerrada. Faça login de novo.');
  if (sess.nivel < NIVEL.admin) return erro(403, 'Só o Master usa a Gestão de Ambientes.');
  const url = new URL(req.url), [, , alvo, ...resto] = url.pathname.split('/').filter(Boolean); // api/ambientes/<alvo>/docs[/lote]
  if (alvo === 'diagnostico' && req.method === 'GET') return json(200, await diagnostico());
  if (!IDS.includes(alvo)) return erro(404, 'Ambiente desconhecido.');
  if (alvo === ambienteAtual()) return erro(400, 'Este já é o ambiente deste site: use /api/docs.');
  const destino = '/api/inter/' + resto.join('/');
  if (!['/api/inter/docs', '/api/inter/docs/lote'].includes(destino)) return erro(404, 'Rota não encontrada.');
  const r = await chamarAmbiente(alvo, destino + url.search, { metodo: req.method, corpo: req.method === 'GET' ? undefined : await req.text(), ator: sess.uid, tempo: 25000 });
  return new Response(await r.text(), { status: r.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}, { cors: true });
export const config = { path: '/api/ambientes/*' };
