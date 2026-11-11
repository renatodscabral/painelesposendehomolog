/* v14.00 · Provedores de envio da Central de Notificações: e-mail (Resend ou compatível, por REST) e WhatsApp (Evolution API,
   Z-API, Meta Cloud API ou qualquer webhook REST). Tudo configurado por variáveis de ambiente do Netlify:

     NOTIFICACAO_EMAIL_API_KEY       chave da API de e-mail (Resend: "re_…")                       [obrigatória para e-mail]
     NOTIFICACAO_EMAIL_FROM          remetente verificado no provedor ("Painel <painel@seudominio.com.br>")  [obrigatória para e-mail]
     NOTIFICACAO_EMAIL_ENDPOINT      (opcional) URL da API; padrão https://api.resend.com/emails (aceita provedor com o mesmo formato)
     NOTIFICACAO_WHATSAPP_ENDPOINT   URL completa de envio de texto do seu provedor                [obrigatória para WhatsApp]
     NOTIFICACAO_WHATSAPP_TOKEN      token/chave do provedor                                       [obrigatória para WhatsApp]
     NOTIFICACAO_WHATSAPP_PROVEDOR   (opcional) evolution | zapi | meta | generico — por padrão é reconhecido pela URL

   Falta de chave NUNCA derruba o painel: o envio devolve um erro "de configuração" com texto amigável (vira um aviso no log da
   Central) e nada é enviado. Chaves e tokens nunca aparecem em mensagens, logs ou respostas. As funções aceitam um `fetch`
   injetável (os testes usam um provedor falso local). */

const env = k => (globalThis.Netlify?.env?.get?.(k) ?? process.env[k] ?? '').trim();
export const TIMEOUT_MS = 12000;

/** Erro de envio com classificação: CONFIG (falta configurar) · DESTINO (e-mail/telefone ruim) · RECUSADO (o provedor não aceitou) · TRANSITORIO (rede/limite/5xx: vale tentar de novo) */
export class ErroEnvio extends Error {
  constructor(tipo, amigavel, extra = {}) { super(amigavel); this.tipo = tipo; this.amigavel = amigavel; this.transitorio = tipo === 'TRANSITORIO'; Object.assign(this, extra); }
}

const segredos = () => [env('NOTIFICACAO_EMAIL_API_KEY'), env('NOTIFICACAO_WHATSAPP_TOKEN')].filter(s => s.length >= 6);
/** Tira qualquer segredo (e restos de URL com token) de um texto que veio do provedor. */
export function limpar(txt, max = 220) {
  let t = String(txt ?? '').replace(/\s+/g, ' ').trim();
  for (const s of segredos()) t = t.split(s).join('***');
  t = t.replace(/(token|apikey|api_key|authorization|bearer)\s*[:=]?\s*[A-Za-z0-9._\-]{8,}/gi, '$1 ***');
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

export const emailValido = e => /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]{2,}$/.test(String(e || '').trim());
/** Telefone brasileiro só com dígitos e DDI: 11 99999-0000 → 5511999990000. Devolve '' se não parecer um celular/telefone válido. */
export function normalizarTelefone(t) {
  let d = String(t ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return /^55\d{10,11}$/.test(d) ? d : (/^\d{11,15}$/.test(d) && !d.startsWith('55') ? d : '');
}
export const mascararTelefone = t => { const d = normalizarTelefone(t); return d ? `+${d.slice(0, 2)} ${d.slice(2, 4)} ••••${d.slice(-4)}` : String(t || ''); };
export const mascararEmail = e => { const [u, h] = String(e || '').split('@'); return h ? `${u.slice(0, 2)}${u.length > 2 ? '•••' : ''}@${h}` : String(e || ''); };

/** Situação da configuração (sem revelar nenhum valor). */
export function estadoConfig() {
  const k = env('NOTIFICACAO_EMAIL_API_KEY'), f = env('NOTIFICACAO_EMAIL_FROM'), ee = env('NOTIFICACAO_EMAIL_ENDPOINT'), we = env('NOTIFICACAO_WHATSAPP_ENDPOINT'), wt = env('NOTIFICACAO_WHATSAPP_TOKEN');
  const faltaE = [!k && 'NOTIFICACAO_EMAIL_API_KEY', !f && 'NOTIFICACAO_EMAIL_FROM'].filter(Boolean), faltaW = [!we && 'NOTIFICACAO_WHATSAPP_ENDPOINT', !wt && 'NOTIFICACAO_WHATSAPP_TOKEN'].filter(Boolean);
  return {
    email: { configurado: !faltaE.length, faltam: faltaE, provedor: ee && !/resend\.com/i.test(ee) ? 'Personalizado (REST)' : 'Resend' },
    whatsapp: { configurado: !faltaW.length, faltam: faltaW, provedor: provedorWhatsApp(we) },
  };
}

export function provedorWhatsApp(endpoint = env('NOTIFICACAO_WHATSAPP_ENDPOINT')) {
  const forcado = env('NOTIFICACAO_WHATSAPP_PROVEDOR').toLowerCase();
  if (['evolution', 'zapi', 'meta', 'generico'].includes(forcado)) return forcado;
  const e = String(endpoint || '').toLowerCase();
  if (/graph\.facebook\.com/.test(e) || /\/messages\/?$/.test(e) && /\/v\d+\.\d+\//.test(e)) return 'meta';
  if (/z-api\.io|zapi/.test(e) || /\/send-text\/?$/.test(e)) return 'zapi';
  if (/\/message\/sendtext\//.test(e)) return 'evolution';
  return endpoint ? 'generico' : '';
}
export const ROTULO_PROVEDOR = { evolution: 'Evolution API', zapi: 'Z-API', meta: 'Meta WhatsApp Cloud API', generico: 'Webhook REST', '': '—' };

async function chamar(url, opcoes, { fetchFn = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeoutMs);
  try { return await fetchFn(url, { ...opcoes, signal: ctl.signal }); }
  catch (e) { throw new ErroEnvio('TRANSITORIO', e?.name === 'AbortError' ? 'O provedor demorou demais para responder (tempo esgotado). Vou tentar de novo mais tarde.' : 'Não consegui falar com o provedor (falha de rede). Vou tentar de novo mais tarde.'); }
  finally { clearTimeout(t); }
}
const lerCorpo = async r => { const t = await r.text().catch(() => ''); let j = null; try { j = t ? JSON.parse(t) : null; } catch { /* texto puro */ } return { texto: t, json: j }; };
const msgDoProvedor = ({ texto, json }) => limpar(json?.message || json?.error?.message || (typeof json?.error === 'string' ? json.error : '') || json?.response?.message || json?.name || texto || '');

/** Traduz o status HTTP numa classe de erro com texto amigável. */
function erroHttp(r, corpo, canal, chaveVar) {
  const st = r.status, det = msgDoProvedor(corpo), ro = canal === 'EMAIL' ? 'e-mail' : 'WhatsApp';
  if (st === 401 || st === 403) return new ErroEnvio('CONFIG', `O provedor de ${ro} recusou a credencial (${st}). Confira ${chaveVar} nas variáveis de ambiente do Netlify${canal === 'EMAIL' ? ' e se o domínio do remetente está verificado no provedor' : ''}.${det ? ' Resposta: ' + det : ''}`, { http: st });
  if (st === 429) return new ErroEnvio('TRANSITORIO', `O provedor de ${ro} limitou os envios (429). Vou tentar de novo mais tarde.`, { http: st });
  if (st >= 500) return new ErroEnvio('TRANSITORIO', `O provedor de ${ro} está indisponível no momento (${st}). Vou tentar de novo mais tarde.`, { http: st });
  return new ErroEnvio('RECUSADO', `O provedor de ${ro} recusou a mensagem (${st})${det ? ': ' + det : ''}.`, { http: st });
}

/**
 * enviarEmail({ para, assunto, html, texto, anexos:[{ nome, tipo, base64 }] }) → { idExterno }
 * Formato Resend: POST { from, to:[…], subject, html, text, attachments:[{ filename, content(base64) }] } com Authorization: Bearer.
 */
export async function enviarEmail({ para, assunto, html, texto, anexos = [] }, opcoes = {}) {
  const k = env('NOTIFICACAO_EMAIL_API_KEY'), from = env('NOTIFICACAO_EMAIL_FROM'), url = env('NOTIFICACAO_EMAIL_ENDPOINT') || 'https://api.resend.com/emails';
  const faltam = [!k && 'NOTIFICACAO_EMAIL_API_KEY', !from && 'NOTIFICACAO_EMAIL_FROM'].filter(Boolean);
  if (faltam.length) throw new ErroEnvio('CONFIG', `E-mail ainda não configurado: defina ${faltam.join(' e ')} nas variáveis de ambiente do Netlify (Site configuration › Environment variables). Nada foi enviado.`);
  if (!emailValido(para)) throw new ErroEnvio('DESTINO', 'O destinatário não tem um e-mail válido no cadastro.');
  if (!/^https:\/\//i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(url)) throw new ErroEnvio('CONFIG', 'NOTIFICACAO_EMAIL_ENDPOINT precisa ser uma URL https.');
  const corpo = { from, to: [String(para).trim()], subject: String(assunto || '(sem assunto)').slice(0, 200), html: html || undefined, text: texto || undefined };
  if (anexos.length) corpo.attachments = anexos.map(a => ({ filename: a.nome, content: a.base64, ...(a.tipo ? { content_type: a.tipo } : {}) }));
  const r = await chamar(url, { method: 'POST', headers: { authorization: 'Bearer ' + k, 'content-type': 'application/json', 'user-agent': 'painel-gestao-notificacoes/1' }, body: JSON.stringify(corpo) }, opcoes);
  const c = await lerCorpo(r);
  if (!r.ok) throw erroHttp(r, c, 'EMAIL', 'NOTIFICACAO_EMAIL_API_KEY');
  return { idExterno: limpar(c.json?.id || c.json?.messageId || '', 80) };
}

/** Monta a requisição do provedor de WhatsApp (sem enviar): útil para testar o formato de cada um. */
export function montarWhatsApp({ para, texto }, { endpoint = env('NOTIFICACAO_WHATSAPP_ENDPOINT'), token = env('NOTIFICACAO_WHATSAPP_TOKEN'), provedor = provedorWhatsApp(endpoint) } = {}) {
  const fone = normalizarTelefone(para), h = { 'content-type': 'application/json' };
  if (provedor === 'meta') return { url: endpoint, headers: { ...h, authorization: 'Bearer ' + token }, corpo: { messaging_product: 'whatsapp', recipient_type: 'individual', to: fone, type: 'text', text: { preview_url: false, body: texto } } };
  if (provedor === 'zapi') return { url: endpoint, headers: { ...h, 'client-token': token }, corpo: { phone: fone, message: texto } };
  if (provedor === 'evolution') return { url: endpoint, headers: { ...h, apikey: token }, corpo: { number: fone, text: texto } };
  return { url: endpoint, headers: { ...h, authorization: 'Bearer ' + token, apikey: token }, corpo: { number: fone, phone: fone, to: fone, text: texto, message: texto } };
}

/** enviarWhatsApp({ para, texto }) → { idExterno } — só texto (o PDF segue por e-mail). */
export async function enviarWhatsApp({ para, texto }, opcoes = {}) {
  const endpoint = env('NOTIFICACAO_WHATSAPP_ENDPOINT'), token = env('NOTIFICACAO_WHATSAPP_TOKEN');
  const faltam = [!endpoint && 'NOTIFICACAO_WHATSAPP_ENDPOINT', !token && 'NOTIFICACAO_WHATSAPP_TOKEN'].filter(Boolean);
  if (faltam.length) throw new ErroEnvio('CONFIG', `WhatsApp ainda não configurado: defina ${faltam.join(' e ')} nas variáveis de ambiente do Netlify (Site configuration › Environment variables). Nada foi enviado.`);
  if (!/^https:\/\//i.test(endpoint) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(endpoint)) throw new ErroEnvio('CONFIG', 'NOTIFICACAO_WHATSAPP_ENDPOINT precisa ser uma URL https.');
  if (!normalizarTelefone(para)) throw new ErroEnvio('DESTINO', 'O destinatário não tem um telefone válido (DDD + número) no cadastro.');
  const req = montarWhatsApp({ para, texto: String(texto || '').slice(0, 3800) });
  const r = await chamar(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.corpo) }, opcoes);
  const c = await lerCorpo(r);
  if (!r.ok) throw erroHttp(r, c, 'WHATSAPP', 'NOTIFICACAO_WHATSAPP_TOKEN');
  const id = c.json?.messages?.[0]?.id || c.json?.key?.id || c.json?.messageId || c.json?.zaapId || c.json?.id || '';
  return { idExterno: limpar(id, 80) };
}
