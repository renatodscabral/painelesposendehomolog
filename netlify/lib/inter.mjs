/* v13.76 · Chamada de um site do painel para outro (servidor → servidor), com a chave compartilhada.
   v13.76.1: log claro de falha de rede / resposta não-OK (aparece em Netlify › Logs › Functions) e o mesmo detalhe
   volta para o navegador do Master, para saber a causa exata (endereço, HTTP, motivo). */
import { ambienteAtual, urlDe, chave, estadoChave, ROTULO } from './ambiente.mjs';
import { ErroHttp } from './http.mjs';

const VAR = { prod: 'PAINEL_URL_PROD', homolog: 'PAINEL_URL_HOMOLOG', rc: 'PAINEL_URL_RC' };

export async function chamarAmbiente(alvo, caminho, { metodo = 'GET', corpo, ator = '', tempo = 20000 } = {}) {
  const base = urlDe(alvo), k = chave(), ec = estadoChave(), origem = ambienteAtual();
  if (!base || !k) {
    const motivo = !base ? `${VAR[alvo]} vazia ou inválida neste site (use https://…, sem barra no final)` : ec.estado === 'curta' ? `PAINEL_CHAVE_AMBIENTES curta demais neste site (${ec.tamanho} caracteres; mínimo 16)` : 'PAINEL_CHAVE_AMBIENTES não configurada neste site';
    console.error(`[painel][inter] ${origem} → ${alvo}: não interligado — ${motivo}`);
    throw new ErroHttp(503, `${ROTULO[alvo] || alvo} não está interligado a este site: ${motivo}.`, { detalhe: { origem, alvo, url: base || null, motivo } });
  }
  const url = base + caminho, t0 = Date.now(), ac = new AbortController(), to = setTimeout(() => ac.abort(), tempo);
  let r;
  try { r = await fetch(url, { method: metodo, signal: ac.signal, redirect: 'manual', headers: { 'x-painel': '1', 'x-painel-chave': k, 'x-painel-origem': origem, 'x-painel-ator': String(ator).slice(0, 80), ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}) }, body: corpo === undefined ? undefined : corpo }); }
  catch (e) {
    const motivo = e.name === 'AbortError' ? `tempo esgotado (${tempo / 1000} s)` : `falha de rede: ${e.cause?.code || e.code || ''} ${e.message}`.trim();
    console.error(`[painel][inter] ${origem} → ${alvo} ${metodo} ${url}: ${motivo}`);
    throw new ErroHttp(502, `Sem resposta de ${ROTULO[alvo] || alvo} (${url}): ${motivo}.`, { detalhe: { origem, alvo, url, motivo } });
  } finally { clearTimeout(to); }
  const texto = await r.text(), ms = Date.now() - t0;
  if (!r.ok) {
    let j = null; try { j = JSON.parse(texto); } catch { /* resposta não-JSON (ex.: página 404 do Netlify) */ }
    const motivo = j?.erro || (r.status >= 300 && r.status < 400 ? `redirecionado para ${r.headers.get('location')} (confira o endereço exato do site)` : r.status === 404 ? 'rota /api/inter não encontrada no destino (o site de destino está na v13.76?)' : texto.slice(0, 160).replace(/\s+/g, ' '));
    console.error(`[painel][inter] ${origem} → ${alvo} ${metodo} ${url}: HTTP ${r.status} em ${ms} ms — ${motivo}${j?.motivo ? ` (${j.motivo})` : ''}`);
    return new Response(JSON.stringify({ ...(j || {}), erro: `${ROTULO[alvo] || alvo} respondeu HTTP ${r.status}: ${motivo}`, detalhe: { origem, alvo, url, status: r.status, motivo: j?.motivo || null, ms } }), { status: r.status >= 300 && r.status < 400 ? 502 : r.status, headers: { 'content-type': 'application/json; charset=utf-8' } });
  }
  return new Response(texto, { status: r.status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}
