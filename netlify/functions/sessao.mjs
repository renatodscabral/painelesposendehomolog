/* /api/sessao — login por CPF conferido no servidor.
   GET    ?amb=prod|homolog|rc  → sessão atual (cookie) e se o banco já tem Master
   POST   { cpf, senha, amb }   → confere senha (hash) e situação; abre a sessão (cookie HttpOnly, 12 h)
   DELETE                        → encerra a sessão
   v13.76: cada ambiente é um site com banco próprio (sem prefixo amb/…). Na Homologação e na RC, o Master que ainda
   não existe no banco local é herdado do site da Produção (mesmo CPF e senha), pela chave entre ambientes. */
import { q, tx, faxina } from '../lib/db.mjs';
import { json, erro, rota, cookieSessao, cookieApagar, ipDe, ErroHttp } from '../lib/http.mjs';
import { confere, soDigitos } from '../lib/senha.mjs';
import { criarSessao, sessaoDe } from '../lib/sessao.mjs';
import { ambienteAtual, soMaster, ROTULO } from '../lib/ambiente.mjs';
import { chamarAmbiente } from '../lib/inter.mjs';
import { situacao, funcionarioDe, localizar } from '../lib/usuarios.mjs';

const MAX_CPF = 5, JANELA_CPF = '5 minutes', MAX_IP = 30, JANELA_IP = '10 minutes';
const semSenha = (id, d) => { const { senha, ...r } = d || {}; return { id, ...r }; };
/** Homologação/RC: herda o Master do site da Produção (mesmo CPF e senha) — só quando ele ainda não existe aqui. */
async function herdarMaster(cpf) {
  const r = await chamarAmbiente('prod', '/api/inter/master', { metodo: 'POST', corpo: JSON.stringify({ cpf }) }).catch(() => null);
  if (!r || !r.ok) return null;
  const m = await r.json().catch(() => null); if (!m?.id || !m.dados?.senha) return null;
  const alvoF = m.dados.funcionarioId ? await funcionarioDe(m.dados) : null, novo = { ...m.dados };
  if (!(alvoF && soDigitos(alvoF.cpf) === cpf)) { delete novo.funcionarioId; novo.nome = m.nome || novo.nome || 'Master'; novo.cpf = cpf; }
  const caminho = 'usuarios/' + m.id;
  await tx(async t => {
    await t(`INSERT INTO documentos (caminho, colecao, doc_id, dados, atualizado_por) VALUES ($1, 'usuarios', $2, $3::jsonb, 'ambiente:prod')
             ON CONFLICT (caminho) DO UPDATE SET dados = EXCLUDED.dados, versao = documentos.versao + 1, atualizado_em = now()`, [caminho, m.id, JSON.stringify(novo)]);
    await t(`INSERT INTO mudancas (caminho, colecao, op, por) VALUES ($1, 'usuarios', 'set', 'ambiente:prod')`, [caminho]);
  });
  return { caminho, id: m.id, u: novo, f: novo.funcionarioId ? alvoF : null };
}
const existeMaster = async () => (await q(`SELECT 1 FROM documentos WHERE colecao = 'usuarios' AND dados->>'perfil' = 'MASTER' AND dados->'ativo' IS DISTINCT FROM 'false'::jsonb LIMIT 1`)).length > 0;
async function contar(chave, janela) { const [r] = await q(`SELECT count(*)::int AS n FROM tentativas_login WHERE chave = $1 AND em > now() - $2::interval`, [chave, janela]); return r.n; }

export default rota(async (req, context) => {
  const url = new URL(req.url), AMB = ambienteAtual();
  if (req.method === 'GET') {
    const pedido = url.searchParams.get('amb') || AMB, configurado = AMB !== 'prod' || await existeMaster(); // Homologação/RC herdam o Master no 1º login
    const sess = await sessaoDe(req);
    if (!sess || pedido !== AMB) return json(200, { logado: false, configurado, ambiente: AMB });
    const f = await funcionarioDe(sess.usuario), sit = situacao(sess.usuario, f);
    if (sit !== 'ok') { await q('DELETE FROM sessoes WHERE token_hash = $1', [sess.tokenHash]); return json(200, { logado: false, configurado, ambiente: AMB, motivo: sit }, { 'set-cookie': cookieApagar() }); }
    return json(200, { logado: true, configurado, ambiente: AMB, trocar: sess.trocaPendente, usuario: semSenha(sess.uid, sess.usuario), funcionario: f });
  }
  if (req.method === 'DELETE') {
    const sess = await sessaoDe(req); if (sess) await q('DELETE FROM sessoes WHERE token_hash = $1', [sess.tokenHash]);
    return json(200, { ok: true }, { 'set-cookie': cookieApagar() });
  }
  if (req.method !== 'POST') return erro(405, 'Método não permitido.');

  let corpo; try { corpo = await req.json(); } catch { throw new ErroHttp(400, 'Corpo inválido.'); }
  if (corpo?.amb && corpo.amb !== AMB) return erro(409, `Este endereço é o ambiente ${ROTULO[AMB]}.`, { ambiente: AMB });
  const cpf = soDigitos(corpo?.cpf), senha = String(corpo?.senha ?? ''), ip = ipDe(req, context);
  if (cpf.length !== 11 || !senha || senha.length > 200) return erro(401, 'CPF ou senha incorretos.');
  if (await contar('cpf:' + cpf, JANELA_CPF) >= MAX_CPF || (ip && await contar('ip:' + ip, JANELA_IP) >= MAX_IP)) return erro(429, 'Muitas tentativas. Aguarde alguns minutos e tente de novo.');

  let achado = await localizar(cpf);
  if (!achado && AMB !== 'prod') achado = await herdarMaster(cpf).catch(() => null);
  if (!achado || !confere(senha, achado.u.senha)) {
    await q(`INSERT INTO tentativas_login (chave) VALUES ($1)${ip ? ', ($2)' : ''}`, ip ? ['cpf:' + cpf, 'ip:' + ip] : ['cpf:' + cpf]);
    return erro(401, 'CPF ou senha incorretos.'); // mensagem única: não revela quais CPFs têm acesso
  }
  await q('DELETE FROM tentativas_login WHERE chave = $1', ['cpf:' + cpf]);
  const sit = situacao(achado.u, achado.f); if (sit !== 'ok') return erro(403, 'Acesso bloqueado.', { motivo: sit });
  if (soMaster() && achado.u.perfil !== 'MASTER') return erro(403, `${ROTULO[AMB]}: acesso restrito ao Master.`, { motivo: 'restrito' });
  const trocar = !!achado.u.trocarSenha || soDigitos(senha) === cpf; // 1º acesso, senha redefinida ou senha ainda igual ao CPF
  const token = await criarSessao({ usuarioCaminho: achado.caminho, ambiente: AMB, trocaPendente: trocar, ip, agente: req.headers.get('user-agent') });
  faxina();
  return json(200, { ok: true, trocar, ambiente: AMB, usuario: semSenha(achado.id, achado.u), funcionario: achado.f }, { 'set-cookie': cookieSessao(token) });
});
export const config = { path: '/api/sessao' };
