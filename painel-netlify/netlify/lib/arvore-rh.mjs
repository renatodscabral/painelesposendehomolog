/* v14.12 · Árvore hierárquica do RH no SERVIDOR (Lote 2).
   O painel (Pessoal.arvoreDe, v13.93) decide, na tela, quem é liderado de quem. A partir da v14.12 o SERVIDOR aplica a mesma regra:
     · salários (coleção `salarios`, um documento por colaborador): além do Master e de quem tem "Pode ver salários" (rh.ver_salarios), o gestor do TOPO
       de um ramo do organograma lê o salário de quem está na sua própria árvore (Gestor direto, responsável de departamento, sub-departamentos e lotados).
       Qualquer outro documento de salário segue 403. A gravação continua só do Master; `rh_folhas` (folhas do mês, todos os colaboradores) segue sem exceção.
     · viagens: aprovar a solicitação e encerrar o adiantamento com a permissão delegável `viagens.aprovar` (Financeiro), nunca o próprio pedido.
   Regra pura (sem banco) em arvoreDe(); a leitura do banco é leve (só gestorId e departamentoId) e fica 20 s em memória.
   Tudo só vale com o recurso `gestao_v1412` (Homologação sempre; Produção e Falco depois de "Liberar Versão em Produção"). */
import { q } from './db.mjs';
import { tem } from './permissoes.mjs';

export const RECURSO = 'gestao_v1412';
export const PERM_APROVAR_VIAGEM = 'viagens.aprovar';

/** Todos os colaboradores abaixo de `meId`, em qualquer nível (Gestor direto, responsável de departamento, sub-departamentos e lotados). Nunca inclui o próprio. Igual ao painel. */
export function arvoreDe(funcs, deps, meId) {
  if (!meId) return new Set();
  const add = (m, k, v) => { if (k) (m.get(k) || m.set(k, []).get(k)).push(v); };
  const porGestor = new Map(), porDep = new Map(), depsDe = new Map(), filhos = new Map();
  (funcs || []).forEach(x => { add(porGestor, x.gestorId, x); add(porDep, x.departamentoId, x); });
  (deps || []).forEach(d => { add(depsDe, d.responsavelId, d); add(filhos, d.paiId, d); });
  const vf = new Set([meId]), vd = new Set(), pf = [meId], pd = [];
  const novoF = id => { if (id && !vf.has(id)) { vf.add(id); pf.push(id); } }, novoD = d => { if (d && !vd.has(d.id)) { vd.add(d.id); pd.push(d); } };
  while (pf.length || pd.length) {
    while (pf.length) { const id = pf.pop(); (porGestor.get(id) || []).forEach(x => novoF(x.id)); (depsDe.get(id) || []).forEach(novoD); }
    while (pd.length) { const d = pd.pop(); (porDep.get(d.id) || []).forEach(x => novoF(x.id)); novoF(d.responsavelId); (filhos.get(d.id) || []).forEach(novoD); }
  }
  vf.delete(meId); return vf;
}

/** Departamento "Financeiro" (ou abaixo de um): o colaborador está lotado nele ou é responsável por um. Igual a Viagens.doFinanceiro() do painel. */
export function doFinanceiro(funcs, deps, meId) {
  const f = (funcs || []).find(x => x.id === meId); if (!f) return false;
  const porId = new Map((deps || []).map(d => [d.id, d])), chave = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const fin = d => { let x = d, n = 0; while (x && n++ < 20) { if (/FINANC/.test(chave(x.nome))) return true; x = porId.get(x.paiId); } return false; };
  return fin(porId.get(f.departamentoId)) || (deps || []).some(d => d.responsavelId === meId && fin(d));
}

/** Quem viaja (a viagem pode ser em grupo). */
export const participantesDe = v => (Array.isArray(v?.participantes) && v.participantes.length ? v.participantes : [{ funcionarioId: v?.funcionarioId }]).map(p => p.funcionarioId).filter(Boolean);

/** Decide se a sessão é aprovadora DELEGADA (Financeiro com `viagens.aprovar`) desta viagem. Master não passa por aqui. Pura. */
export function aprovadorDelegado({ perms, perfil, uid, funcionarioId, financeiro, viagem, recursoAtivo = () => true }) {
  if (!recursoAtivo(RECURSO)) return { ok: false, motivo: 'recurso desligado' };
  if (perfil === 'LOJA') return { ok: false, motivo: 'perfil Loja nunca aprova' };
  if (!tem(perms, PERM_APROVAR_VIAGEM)) return { ok: false, motivo: 'sem a permissão viagens.aprovar' };
  if (!financeiro) return { ok: false, motivo: 'fora do setor Financeiro' };
  if (funcionarioId && participantesDe(viagem).includes(funcionarioId)) return { ok: false, motivo: 'autoaprovação: o aprovador está entre os viajantes' };
  if (viagem?.solicitadoPor && uid && viagem.solicitadoPor === uid) return { ok: false, motivo: 'autoaprovação: o aprovador abriu o pedido' };
  return { ok: true };
}

/* ---------------------------------------------------------------- leitura do banco (cache de 20 s) */
const TTL = 20000; let cache = null;
export const limparCache = () => { cache = null; };
async function carregar() {
  if (cache && Date.now() - cache.t < TTL) return cache;
  const funcs = await q(`SELECT doc_id AS id, dados->>'gestorId' AS "gestorId", dados->>'departamentoId' AS "departamentoId" FROM documentos WHERE colecao = 'funcionarios'`);
  const deps = await q(`SELECT doc_id AS id, dados->>'nome' AS nome, dados->>'paiId' AS "paiId", dados->>'responsavelId' AS "responsavelId" FROM documentos WHERE colecao = 'rh_departamentos'`);
  cache = { t: Date.now(), funcs, deps, arv: new Map() }; return cache;
}
const meuId = sess => String(sess?.usuario?.funcionarioId || '');
const elegivel = sess => !!sess && !sess.trocaPendente && sess.perfil === 'OPERACIONAL' && !!meuId(sess) && typeof sess.recursoAtivo === 'function' && sess.recursoAtivo(RECURSO);

/** Árvore do colaborador vinculado à sessão (ou null se a sessão não pode usar a regra). */
export async function arvoreDaSessao(sess) {
  if (!elegivel(sess)) return null;
  const c = await carregar(), me = meuId(sess); let a = c.arv.get(me);
  if (!a) { a = arvoreDe(c.funcs, c.deps, me); c.arv.set(me, a); }
  return a;
}
/** Ids de salário liberados por esta regra (vazio/null = nenhum). */
export async function salariosLiberados(sess) { const a = await arvoreDaSessao(sess); return a && a.size ? a : null; }
/** `salarios/<id>` (com ou sem prefixo de ambiente) → id; senão null. */
export const idSalario = caminho => { const m = String(caminho).replace(/^amb\/[^/]+\//, '').match(/^salarios\/([^/]+)$/); return m ? m[1] : null; };
export const ehColecaoSalarios = c => String(c).replace(/^amb\/[^/]+\//, '') === 'salarios';
/** A sessão pode LER este documento de salário pela árvore? */
export async function podeLerSalarioDoc(sess, caminho) { const id = idSalario(caminho); if (!id) return false; const l = await salariosLiberados(sess); return !!l && l.has(id); }
/** A sessão é do Financeiro? (para a aprovação delegada de viagens) */
export async function financeiroDaSessao(sess) { if (!sess || !meuId(sess)) return false; const c = await carregar(); return doFinanceiro(c.funcs, c.deps, meuId(sess)); }
