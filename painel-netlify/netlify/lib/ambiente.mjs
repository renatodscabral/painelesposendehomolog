/* v13.76 · Identidade do site e interligação dos ambientes.
   Cada ambiente é um site (projeto) próprio no Netlify, com o seu Netlify Database:
     PAINEL_AMBIENTE          prod | homolog | falco         (padrão: prod; 'rc' continua aceito — v13.90)
     PAINEL_URL_PROD          https://<site da Esposende Produção>
     PAINEL_URL_HOMOLOG       https://<site da Esposende Homologação>
     PAINEL_URL_FALCO         https://<site da Falco Controladoria e Gestão>   (v13.90; PAINEL_URL_RC continua aceita)
     PAINEL_CHAVE_AMBIENTES   segredo igual nos 3 sites (mín. 16 caracteres; recomendado 32+) — liga a Gestão de Ambientes
     PAINEL_MOSTRAR_AMBIENTES 0 esconde os outros ambientes no seletor (ex.: no site da Falco, para os clientes)
     PAINEL_SO_MASTER         1 só o Master entra neste site (padrão: 1 na Homologação, 0 nos demais) */
import { createHash, timingSafeEqual } from 'node:crypto';

const env = k => (globalThis.Netlify?.env?.get?.(k) ?? process.env[k] ?? '').trim();
/* v13.90 · a RC Consultoria passou a se chamar Falco Controladoria e Gestão. O identificador gravado no banco continua 'rc'
   (coluna sessoes.ambiente, prefixo amb/rc/, cookie painel_sessao_rc, cabeçalho x-painel-origem dos sites antigos): assim nenhuma
   sessão aberta nem registro existente quebra. 'falco' é aceito em toda entrada (variável PAINEL_AMBIENTE, ?amb=, rotas
   /api/ambientes/falco/…, x-painel-origem) e convertido para 'rc' por normalizarAmbiente(). */
export const IDS = ['prod', 'homolog', 'rc'];
export const APELIDOS = { falco: 'rc', rc: 'rc', esposende: 'prod', producao: 'prod', 'produção': 'prod', homologacao: 'homolog', 'homologação': 'homolog' };
export const normalizarAmbiente = v => { const k = String(v ?? '').trim().toLowerCase(); return IDS.includes(k) ? k : APELIDOS[k] || ''; };
export const ehFalco = id => normalizarAmbiente(id) === 'rc';
export const ROTULO = { prod: 'Esposende (Produção)', homolog: 'Esposende (Homologação)', rc: 'Falco Controladoria e Gestão' };
export const ambienteAtual = () => normalizarAmbiente(env('PAINEL_AMBIENTE')) || 'prod';
export function urlDe(id) {
  id = normalizarAmbiente(id);
  const v = (id === 'rc' ? env('PAINEL_URL_FALCO') || env('PAINEL_URL_RC') : env('PAINEL_URL_' + { prod: 'PROD', homolog: 'HOMOLOG' }[id] || '')).replace(/\/+$/, '');
  return /^https:\/\/[^\s/]+$/i.test(v) || /^http:\/\/(localhost|127\.0\.0\.\d+)(:\d+)?$/i.test(v) ? v : '';
}
/** v13.76.1: chave tolerante — sem espaços nas pontas e sem aspas coladas por engano ("…" ou '…'). */
export const normalizarChave = v => String(v ?? '').trim().replace(/^(["'])(.*)\1$/s, '$2').trim();
export const MIN_CHAVE = 16;
export const chave = () => { const c = normalizarChave(env('PAINEL_CHAVE_AMBIENTES')); return c.length >= MIN_CHAVE ? c : ''; };
/** Situação da chave deste site (sem revelar o valor): ausente | curta | ok (fraca = menos de 32 caracteres). */
export function estadoChave() {
  const c = normalizarChave(env('PAINEL_CHAVE_AMBIENTES'));
  return { estado: !c ? 'ausente' : c.length < MIN_CHAVE ? 'curta' : 'ok', tamanho: c.length, fraca: c.length > 0 && c.length < 32 };
}
export const mostrarOutros = () => env('PAINEL_MOSTRAR_AMBIENTES') !== '0';
export const soMaster = () => { const v = env('PAINEL_SO_MASTER'); return v ? v === '1' : ambienteAtual() === 'homolog'; };
export const COOKIE = () => 'painel_sessao_' + ambienteAtual();

/** Mapa público para a tela de login (sem segredos). */
export function mapaPublico() {
  const atual = ambienteAtual(), mostrar = mostrarOutros();
  return Object.fromEntries(IDS.filter(id => id === atual || mostrar).map(id => [id, { rotulo: ROTULO[id], url: id === atual ? '' : urlDe(id) }]));
}

const h = s => createHash('sha256').update(String(s)).digest();
export function chaveConfere(recebida) { const c = chave(), r = normalizarChave(recebida); return !!c && !!r && timingSafeEqual(h(c), h(r)); }
/** Impressão curta da chave (para o Master comparar os 3 sites no diagnóstico) — nunca exposta sem login. */
export const impressaoChave = () => { const c = chave(); return c ? createHash('sha256').update('painel-impressao:' + c).digest('hex').slice(0, 10) : ''; };

/** Política de quem (origem) pode fazer o quê (op) em qual caminho deste site (alvo). */
export const PROMOCAO = ['config', 'rh_cargos', 'rh_centros', 'rh_departamentos', 'funcionarios/_viagens/parametros', 'adq_taxas', 'credsystem_metas', 'credsystem_campanhas', 'pe_simulador'];
const LEITURA_LIVRE = ['config/recursos', 'sistema/status', 'sistema/ambientes'];
export function interPermitido(origem, alvo, op, caminho) {
  origem = normalizarAmbiente(origem); alvo = normalizarAmbiente(alvo);
  if (!IDS.includes(origem) || origem === alvo) return false;
  if (origem === 'rc') return op === 'get' && LEITURA_LIVRE.includes(caminho); // a Falco (white-label) não lê dados da Esposende
  if (origem === 'homolog' && alvo === 'prod') {                                // Homologação → Produção: lê tudo; grava só a "Liberação"
    if (op === 'get' || op === 'list') return true;
    if (op === 'set') return PROMOCAO.some(c => caminho.startsWith(c + '/') && caminho.split('/').length === c.split('/').length + 1) || caminho === 'sistema/ambientes';
    return false;
  }
  return true; // Produção → Homologação/Falco e Homologação → Falco: Gestão de Ambientes completa (clonar, resetar, liberar versão, Master)
}
