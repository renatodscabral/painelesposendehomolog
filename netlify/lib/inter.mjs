/* v13.76 · Chamada de um site do painel para outro (servidor → servidor), com a chave compartilhada. */
import { ambienteAtual, urlDe, chave, ROTULO } from './ambiente.mjs';
import { ErroHttp } from './http.mjs';

export async function chamarAmbiente(alvo, caminho, { metodo = 'GET', corpo, ator = '', tempo = 20000 } = {}) {
  const base = urlDe(alvo), k = chave();
  if (!base || !k) throw new ErroHttp(503, `${ROTULO[alvo] || alvo} não está interligado a este site: configure PAINEL_URL_${{ prod: 'PROD', homolog: 'HOMOLOG', rc: 'RC' }[alvo]} e PAINEL_CHAVE_AMBIENTES (a mesma nos três sites).`);
  const ac = new AbortController(), to = setTimeout(() => ac.abort(), tempo);
  try {
    const r = await fetch(base + caminho, { method: metodo, signal: ac.signal, headers: { 'x-painel': '1', 'x-painel-chave': k, 'x-painel-origem': ambienteAtual(), 'x-painel-ator': String(ator).slice(0, 80), ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}) }, body: corpo === undefined ? undefined : corpo });
    return r;
  } catch (e) { throw new ErroHttp(502, `Sem resposta de ${ROTULO[alvo] || alvo}: ${e.name === 'AbortError' ? 'tempo esgotado' : e.message}.`); }
  finally { clearTimeout(to); }
}
