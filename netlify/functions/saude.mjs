/* GET /api/saude — o painel usa esta rota para descobrir que está no Netlify com banco Postgres,
   qual ambiente este site é (v13.76) e os endereços dos outros ambientes para o seletor da tela de login. */
import { q } from '../lib/db.mjs';
import { json, rota } from '../lib/http.mjs';
import { ambienteAtual, mapaPublico, chave, estadoChave } from '../lib/ambiente.mjs';

export default rota(async () => {
  let banco = false, configurado = false;
  try { await q('SELECT 1'); banco = true; configurado = (await q(`SELECT 1 FROM documentos WHERE colecao = 'usuarios' AND dados->>'perfil' = 'MASTER' AND dados->'ativo' IS DISTINCT FROM 'false'::jsonb LIMIT 1`)).length > 0; }
  catch (e) { console.error('[painel] banco indisponível', e?.message); }
  return json(banco ? 200 : 503, { ok: banco, app: 'painel-gestao-esposende', api: 2, banco, configurado, ambiente: ambienteAtual(), ambientes: mapaPublico(), interligado: !!chave(), chave: estadoChave().estado });
}, { cors: true });
export const config = { path: '/api/saude' };
