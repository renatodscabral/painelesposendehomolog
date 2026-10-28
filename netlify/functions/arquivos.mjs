/* Arquivos do painel (contratos, termos, comprovantes) guardados no Postgres, em partes de até 1 MB.
   POST   /api/arquivos                 { nome, tipo, tamanho, partes } → { id }
   PUT    /api/arquivos/<id>/<n>        corpo binário da parte n
   POST   /api/arquivos/<id>/concluir   → { id, url, contentType }
   GET    /api/arquivos/<id>  ou  /_blob/<id>   → o arquivo (precisa estar logado)
   DELETE /api/arquivos/<id>            → Master ou quem enviou */
import { randomBytes } from 'node:crypto';
import { q } from '../lib/db.mjs';
import { json, erro, rota, ErroHttp } from '../lib/http.mjs';
import { sessaoDe } from '../lib/sessao.mjs';
import { NIVEL } from '../lib/regras.mjs';

const TIPOS = /^(application\/pdf|image\/(png|jpeg|jpg|webp|gif))$/, MAX = 15 * 1024 * 1024, PARTE = 1024 * 1024 + 1024;
const ID = /^[0-9a-f]{32}$/;

export default rota(async req => {
  const sess = await sessaoDe(req); if (!sess || sess.trocaPendente) return erro(401, 'Faça login para acessar arquivos.');
  const seg = new URL(req.url).pathname.split('/').filter(Boolean); // ['api','arquivos',id,n] ou ['_blob',id]
  const id = seg[0] === '_blob' ? seg[1] : seg[2], extra = seg[0] === '_blob' ? seg[2] : seg[3];

  if (!id) {
    if (req.method !== 'POST') return erro(405, 'Método não permitido.');
    const c = await req.json().catch(() => null), tipo = String(c?.tipo || '').toLowerCase(), tamanho = Number(c?.tamanho), partes = Number(c?.partes);
    if (!TIPOS.test(tipo)) throw new ErroHttp(415, 'Envie um PDF ou uma imagem (PNG, JPG, WebP, GIF).');
    if (!(tamanho > 0 && tamanho <= MAX) || !(partes >= 1 && partes <= 32) || partes !== Math.ceil(tamanho / (1024 * 1024))) throw new ErroHttp(400, 'Tamanho ou número de partes inválido (limite de 15 MB).');
    const novo = randomBytes(16).toString('hex');
    await q('INSERT INTO arquivos (id, nome, tipo, tamanho, partes, criado_por) VALUES ($1, $2, $3, $4, $5, $6)', [novo, String(c?.nome || 'arquivo').slice(0, 250), tipo, tamanho, partes, sess.uid]);
    return json(201, { id: novo });
  }
  if (!ID.test(id)) return erro(404, 'Arquivo não encontrado.');
  const [a] = await q('SELECT id, nome, tipo, tamanho, partes, concluido, criado_por FROM arquivos WHERE id = $1', [id]);
  if (!a) return erro(404, 'Arquivo não encontrado.');

  if (req.method === 'GET') {
    if (!a.concluido) return erro(404, 'Arquivo ainda não foi concluído.');
    let n = 0;
    const corpo = new ReadableStream({ async pull(ctrl) {
      if (n >= a.partes) return ctrl.close();
      const [p] = await q('SELECT dados FROM arquivo_partes WHERE arquivo_id = $1 AND n = $2', [id, n++]);
      if (!p) return ctrl.error(new Error('parte ausente'));
      ctrl.enqueue(new Uint8Array(p.dados));
    } });
    return new Response(corpo, { status: 200, headers: { 'content-type': a.tipo, 'content-length': String(a.tamanho), 'cache-control': 'private, max-age=3600',
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(a.nome)}`, 'x-content-type-options': 'nosniff' } });
  }
  if (req.method === 'DELETE') {
    if (!(sess.nivel >= NIVEL.admin || a.criado_por === sess.uid)) return erro(403, 'Só o Master ou quem enviou pode excluir o arquivo.');
    await q('DELETE FROM arquivos WHERE id = $1', [id]); return json(200, { ok: true });
  }
  if (a.criado_por !== sess.uid) return erro(403, 'Este envio é de outro usuário.');
  if (a.concluido) return erro(409, 'Arquivo já concluído.');
  if (req.method === 'PUT' && /^\d+$/.test(extra || '')) {
    const n = Number(extra); if (n >= a.partes) throw new ErroHttp(400, 'Parte inválida.');
    const buf = Buffer.from(await req.arrayBuffer()); if (!buf.length || buf.length > PARTE) throw new ErroHttp(413, 'Parte grande demais (até 1 MB).');
    await q(`INSERT INTO arquivo_partes (arquivo_id, n, dados) VALUES ($1, $2, $3) ON CONFLICT (arquivo_id, n) DO UPDATE SET dados = EXCLUDED.dados`, [id, n, buf]);
    return json(200, { ok: true });
  }
  if (req.method === 'POST' && extra === 'concluir') {
    const [r] = await q('SELECT count(*)::int AS n, COALESCE(sum(octet_length(dados)), 0)::int AS bytes FROM arquivo_partes WHERE arquivo_id = $1', [id]);
    if (r.n !== a.partes || r.bytes !== a.tamanho) throw new ErroHttp(400, `Envio incompleto (${r.n}/${a.partes} partes).`);
    await q('UPDATE arquivos SET concluido = true WHERE id = $1', [id]);
    return json(200, { id, url: '/_blob/' + id, contentType: a.tipo });
  }
  return erro(405, 'Método não permitido.');
});
export const config = { path: ['/api/arquivos', '/api/arquivos/*', '/_blob/*'] };
