/* v13.76 · /api/inter/* — chamadas de OUTRO site do painel (servidor → servidor), autenticadas pela chave
   PAINEL_CHAVE_AMBIENTES. É o que mantém a "Backup › Gestão de Ambientes" funcionando com um banco por site.
   GET  /api/inter/docs?caminho=… | ?colecao=…     ler
   POST /api/inter/docs/lote { ops }                gravar / excluir (política por origem em lib/ambiente.mjs)
   POST /api/inter/master { cpf }                   Master da Produção para herança na Homologação/RC */
import { json, erro, rota, ErroHttp } from '../lib/http.mjs';
import { ambienteAtual, chaveConfere, interPermitido, IDS } from '../lib/ambiente.mjs';
import { NIVEL } from '../lib/regras.mjs';
import { lerDoc, listar, executarLote } from '../lib/documentos.mjs';
import { localizar } from '../lib/usuarios.mjs';
import { soDigitos } from '../lib/senha.mjs';
import { faxina } from '../lib/db.mjs';

export default rota(async req => {
  const AMB = ambienteAtual();
  if (!chaveConfere(req.headers.get('x-painel-chave'))) return erro(403, 'Chave entre ambientes ausente ou inválida.');
  const origem = req.headers.get('x-painel-origem') || '', ator = String(req.headers.get('x-painel-ator') || '').replace(/[^\w.:-]/g, '').slice(0, 60);
  if (!IDS.includes(origem) || origem === AMB) return erro(403, 'Origem inválida.');
  const sess = { uid: `ambiente:${origem}${ator ? ':' + ator : ''}`, nivel: NIVEL.admin, trocaPendente: false, caminho: '', tokenHash: '' };
  const url = new URL(req.url), rotaInter = url.pathname.replace(/^\/api\/inter\//, '');

  if (rotaInter === 'master') {
    if (req.method !== 'POST' || AMB !== 'prod') return erro(404, 'Disponível só no site da Produção.');
    const cpf = soDigitos((await req.json().catch(() => ({})))?.cpf); if (cpf.length !== 11) return erro(400, 'CPF inválido.');
    const m = await localizar(cpf);
    if (!m || m.u.perfil !== 'MASTER' || m.u.ativo === false) return erro(404, 'Master não encontrado.');
    return json(200, { id: m.id, nome: m.f?.nome || m.u.nome || 'Master', dados: m.u });
  }
  if (rotaInter === 'docs/lote') {
    if (req.method !== 'POST') return erro(405, 'Método não permitido.');
    let corpo; try { corpo = JSON.parse(await req.text()); } catch { throw new ErroHttp(400, 'Corpo inválido.'); }
    const resultados = await executarLote(sess, corpo?.ops, (op, caminho) => interPermitido(origem, AMB, op, caminho));
    faxina(); return json(200, { resultados });
  }
  if (rotaInter === 'docs' && req.method === 'GET') {
    const caminho = url.searchParams.get('caminho'), colecao = url.searchParams.get('colecao');
    if (caminho) { if (!interPermitido(origem, AMB, 'get', caminho)) return erro(403, 'Leitura não permitida entre estes ambientes.'); return json(200, { doc: await lerDoc(sess, caminho) }); }
    if (!colecao) throw new ErroHttp(400, 'Informe caminho ou colecao.');
    if (!interPermitido(origem, AMB, 'list', colecao)) return erro(403, 'Leitura não permitida entre estes ambientes.');
    return json(200, await listar(sess, colecao, { ordem: url.searchParams.get('ordem'), dir: url.searchParams.get('dir'), limite: url.searchParams.get('limite'), apos: url.searchParams.get('apos') }));
  }
  return erro(404, 'Rota não encontrada.');
});
export const config = { path: ['/api/inter/docs', '/api/inter/docs/lote', '/api/inter/master'] };
