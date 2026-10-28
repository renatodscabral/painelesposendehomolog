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

/** Envolve a função: CSRF, erros inesperados viram 500 sem vazar detalhes internos. */
export function rota(fn) {
  return async (req, context) => {
    if (!csrfOk(req)) return erro(403, 'Requisição recusada (cabeçalho x-painel ausente).');
    try { return await fn(req, context); }
    catch (e) {
      if (e && e.status) return erro(e.status, e.message, e.extra || {});
      console.error('[painel]', e);
      return erro(500, 'Erro interno no servidor do painel.');
    }
  };
}
export class ErroHttp extends Error { constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra; } }
