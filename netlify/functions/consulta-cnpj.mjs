/* GET /api/consulta-cnpj?cnpj=<14 dígitos, com ou sem máscara>   (v13.94)
   Consulta o CNPJ na Receita Federal pelo servidor: BrasilAPI e, se ela falhar, MinhaReceita (fallback automático).
   Exige sessão aberta (quem não entrou no painel não usa a consulta); o navegador nunca chama as APIs públicas.
   200 → { ok: true, fonte, cache?, dados: { cnpj, razaoSocial, nomeFantasia, situacao, cep, logradouro, numero, complemento,
                                              bairro, municipio, uf, capitalSocial, cnae, cnaeDescricao, abertura, naturezaJuridica, porte } }
   400 CNPJ inválido · 401 sem sessão · 404 CNPJ não existe na base · 429 limite de consultas · 502 as duas fontes fora do ar */
import { json, erro, rota } from '../lib/http.mjs';
import { sessaoDe } from '../lib/sessao.mjs';
import { consultar, limiteExcedido } from '../lib/consulta-cnpj.mjs';

export default rota(async req => {
  if (req.method !== 'GET') return erro(405, 'Método não permitido.');
  const sess = await sessaoDe(req);
  if (!sess || sess.trocaPendente) return erro(401, 'Sessão encerrada. Faça login de novo.');
  if (limiteExcedido(sess.tokenHash)) return erro(429, 'Muitas consultas de CNPJ em pouco tempo. Aguarde um minuto.');
  const url = new URL(req.url), cnpj = url.searchParams.get('cnpj') || url.pathname.split('/').pop();
  const r = await consultar(cnpj);
  if (!r.ok) return erro(r.status, r.erro, { fontes: r.tentativas.map(t => ({ fonte: t.fonte, status: t.status })) });
  return json(200, { ok: true, fonte: r.fonte, cache: !!r.cache, dados: r.dados });
});
export const config = { path: ['/api/consulta-cnpj', '/api/consulta-cnpj/*'] };
