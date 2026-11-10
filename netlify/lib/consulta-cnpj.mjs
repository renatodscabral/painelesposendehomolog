/* v13.94 · Consulta de CNPJ na Receita Federal, pelo servidor (o navegador não chama as APIs públicas: sem CORS, sem
   limite por IP do usuário, com cache e com a segunda fonte de reserva).
     1ª fonte: BrasilAPI     https://brasilapi.com.br/api/cnpj/v1/{cnpj}
     2ª fonte: MinhaReceita  https://minhareceita.org/{cnpj}
   Variáveis opcionais (só para testes ou para trocar de provedor): CNPJ_URL_BRASILAPI, CNPJ_URL_MINHARECEITA (use {cnpj}),
   CNPJ_TIMEOUT_MS (padrão 6000). */
const env = k => (globalThis.Netlify?.env?.get?.(k) ?? process.env[k] ?? '').trim();

export const limpar = v => String(v ?? '').replace(/\D/g, '');
/** Dígitos verificadores do CNPJ (módulo 11, pesos 5-4-3-2-9-8-7-6-5-4-3-2 e 6-5-4-3-2-9-8-7-6-5-4-3-2). */
export function cnpjValido(v) {
  const c = limpar(v); if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const dv = n => { let s = 0, p = n - 7; for (let i = 0; i < n; i++) { s += Number(c[i]) * p--; if (p < 2) p = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return dv(12) === Number(c[12]) && dv(13) === Number(c[13]);
}

export const fontes = () => [
  { id: 'brasilapi', nome: 'BrasilAPI', url: env('CNPJ_URL_BRASILAPI') || 'https://brasilapi.com.br/api/cnpj/v1/{cnpj}' },
  { id: 'minhareceita', nome: 'MinhaReceita', url: env('CNPJ_URL_MINHARECEITA') || 'https://minhareceita.org/{cnpj}' },
];

const txt = v => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
/** As duas fontes devolvem os mesmos nomes de campo da base da Receita; aqui saem no formato único do painel. */
export function normalizar(d, cnpj) {
  d = d && typeof d === 'object' ? d : {};
  const tipo = txt(d.descricao_tipo_de_logradouro), log = txt(d.logradouro);
  const cep = limpar(d.cep).padStart(8, '0').slice(-8);
  return {
    cnpj, razaoSocial: txt(d.razao_social), nomeFantasia: txt(d.nome_fantasia),
    situacao: txt(d.descricao_situacao_cadastral), situacaoData: txt(d.data_situacao_cadastral),
    cep: limpar(d.cep) ? cep : '',
    logradouro: tipo && log && !log.toUpperCase().startsWith(tipo.toUpperCase()) ? `${tipo} ${log}` : log,
    numero: txt(d.numero), complemento: txt(d.complemento), bairro: txt(d.bairro), municipio: txt(d.municipio), uf: txt(d.uf).toUpperCase().slice(0, 2),
    capitalSocial: num(d.capital_social),
    cnae: txt(d.cnae_fiscal), cnaeDescricao: txt(d.cnae_fiscal_descricao), abertura: txt(d.data_inicio_atividade),
    naturezaJuridica: txt(d.natureza_juridica), porte: txt(d.porte || d.descricao_porte),
  };
}

async function buscar(fonte, cnpj, { fetchImpl, timeoutMs }) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(fonte.url.replace('{cnpj}', cnpj), { signal: ctl.signal, headers: { accept: 'application/json', 'user-agent': 'painel-gestao/13.94' } });
    if (r.status === 404) return { status: 404 };
    if (!r.ok) return { status: r.status, falha: `HTTP ${r.status}` };
    const dados = await r.json();
    if (!dados || typeof dados !== 'object' || !txt(dados.razao_social)) return { status: 502, falha: 'resposta sem razão social' };
    return { status: 200, dados };
  } catch (e) { return { status: 0, falha: e?.name === 'AbortError' ? 'tempo esgotado' : String(e?.message || e).slice(0, 120) }; }
  finally { clearTimeout(t); }
}

/* cache em memória da instância (10 min): o mesmo CNPJ digitado de novo (ou por outro usuário) não vai de novo à Receita */
const CACHE = new Map(), TTL = 10 * 60 * 1000, MAX = 500;
export const limparCache = () => CACHE.clear();

/** → { ok: true, fonte, dados, cache? } | { ok: false, status, erro, tentativas }  (status HTTP sugerido para a resposta) */
export async function consultar(cnpjBruto, { fetchImpl = globalThis.fetch, timeoutMs = Number(env('CNPJ_TIMEOUT_MS')) || 6000 } = {}) {
  const cnpj = limpar(cnpjBruto);
  if (!cnpjValido(cnpj)) return { ok: false, status: 400, erro: 'CNPJ inválido (confira os dígitos).', tentativas: [] };
  const hit = CACHE.get(cnpj); if (hit && Date.now() - hit.t < TTL) return { ok: true, fonte: hit.fonte, dados: hit.dados, cache: true };
  const tentativas = []; let todas404 = true;
  for (const f of fontes()) {
    const r = await buscar(f, cnpj, { fetchImpl, timeoutMs });
    tentativas.push({ fonte: f.id, status: r.status, falha: r.falha || '' });
    if (r.status === 200) {
      const dados = normalizar(r.dados, cnpj);
      if (CACHE.size >= MAX) CACHE.delete(CACHE.keys().next().value);
      CACHE.set(cnpj, { t: Date.now(), fonte: f.id, dados });
      return { ok: true, fonte: f.id, dados, tentativas };
    }
    if (r.status !== 404) todas404 = false;
  }
  return todas404
    ? { ok: false, status: 404, erro: 'CNPJ não encontrado na base da Receita Federal.', tentativas }
    : { ok: false, status: 502, erro: 'Não foi possível consultar a Receita agora (BrasilAPI e MinhaReceita indisponíveis). Preencha os dados manualmente ou tente em instantes.', tentativas };
}

/* limite de uso por sessão (por instância): 40 consultas por minuto — o preenchimento automático é por digitação,
   então o limite só barra laço de script; o cache cobre o uso normal */
const JANELA = new Map();
export function limiteExcedido(chave, max = 40, ms = 60000) {
  const agora = Date.now(), a = (JANELA.get(chave) || []).filter(t => agora - t < ms);
  a.push(agora); JANELA.set(chave, a);
  if (JANELA.size > 2000) for (const [k, v] of JANELA) if (!v.some(t => agora - t < ms)) JANELA.delete(k);
  return a.length > max;
}
