/* Respostas JSON, cookie de sessão e proteção contra CSRF. */
import { COOKIE as nomeCookie } from './ambiente.mjs';
/* v13.76: um cookie por ambiente (painel_sessao_prod, _homolog, _rc) */
export const SESSAO_HORAS = 12;

export function json(status, corpo, headers = {}) {
  return new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}
export const erro = (status, mensagem, extra = {}) => json(status, { erro: mensagem, ...extra });

export function lerCookie(req, nome = nomeCookie()) {
  const c = req.headers.get('cookie') || '';
  for (const parte of c.split(';')) { const i = parte.indexOf('='); if (i > 0 && parte.slice(0, i).trim() === nome) return decodeURIComponent(parte.slice(i + 1).trim()); }
  return null;
}
export function cookieSessao(token, maxAge = SESSAO_HORAS * 3600) {
  return `${nomeCookie()}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
export const cookieApagar = () => `${nomeCookie()}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

/** Toda requisição que grava precisa do cabeçalho x-painel (um site de terceiros não consegue enviá-lo sem CORS). */
export const csrfOk = req => req.method === 'GET' || req.method === 'HEAD' || req.headers.get('x-painel') === '1';

export function ipDe(req, context) { return context?.ip || req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || ''; }

/* v13.76.1 · CORS nas rotas entre ambientes (saude, inter, ambientes). Sem Allow-Credentials: o cookie de sessão
   (HttpOnly, SameSite=Strict) nunca vai numa chamada de outro domínio, então o CORS aberto não expõe dados logados. */
export const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-max-age': '86400' };
function comCors(r) { const h = new Headers(r.headers); for (const [k, v] of Object.entries(CORS)) h.set(k, v); return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h }); }

/** Envolve a função: CSRF, erros inesperados viram 500 sem vazar detalhes internos; { cors: true } liga o CORS e o pre-flight. */
export function rota(fn, { cors = false } = {}) {
  return async (req, context) => {
    const fim = r => (cors ? comCors(r) : r);
    if (cors && req.method === 'OPTIONS') return fim(new Response(null, { status: 204 }));
    if (!csrfOk(req)) return fim(erro(403, 'Requisição recusada (cabeçalho x-painel ausente).'));
    try { return fim(await fn(req, context)); }
    catch (e) {
      if (e && e.status) return fim(erro(e.status, e.message, e.extra || {}));
      console.error('[painel]', e);
      return fim(erro(500, 'Erro interno no servidor do painel.'));
    }
  };
}
export class ErroHttp extends Error { constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra; } }
