/* v13.76 · Identidade do site e interligação dos ambientes.
   Cada ambiente é um site (projeto) próprio no Netlify, com o seu Netlify Database:
     PAINEL_AMBIENTE          prod | homolog | rc            (padrão: prod)
     PAINEL_URL_PROD          https://<site da Esposende Produção>
     PAINEL_URL_HOMOLOG       https://<site da Esposende Homologação>
     PAINEL_URL_RC            https://<site da RC Consultoria>
     PAINEL_CHAVE_AMBIENTES   segredo igual nos 3 sites (32+ caracteres) — liga a Gestão de Ambientes entre eles
     PAINEL_MOSTRAR_AMBIENTES 0 esconde os outros ambientes no seletor (ex.: no site da RC, para os clientes)
     PAINEL_SO_MASTER         1 só o Master entra neste site (padrão: 1 na Homologação, 0 nos demais) */
import { createHash, timingSafeEqual } from 'node:crypto';

const env = k => (globalThis.Netlify?.env?.get?.(k) ?? process.env[k] ?? '').trim();
export const IDS = ['prod', 'homolog', 'rc'];
export const ROTULO = { prod: 'Esposende (Produção)', homolog: 'Esposende (Homologação)', rc: 'RC Consultoria (White-Label)' };
export const ambienteAtual = () => (IDS.includes(env('PAINEL_AMBIENTE')) ? env('PAINEL_AMBIENTE') : 'prod');
export function urlDe(id) {
  const v = env('PAINEL_URL_' + { prod: 'PROD', homolog: 'HOMOLOG', rc: 'RC' }[id]).replace(/\/+$/, '');
  return /^https:\/\/[^\s/]+$/i.test(v) || /^http:\/\/(localhost|127\.0\.0\.\d+)(:\d+)?$/i.test(v) ? v : '';
}
export const chave = () => (env('PAINEL_CHAVE_AMBIENTES').length >= 32 ? env('PAINEL_CHAVE_AMBIENTES') : '');
export const mostrarOutros = () => env('PAINEL_MOSTRAR_AMBIENTES') !== '0';
export const soMaster = () => { const v = env('PAINEL_SO_MASTER'); return v ? v === '1' : ambienteAtual() === 'homolog'; };
export const COOKIE = () => 'painel_sessao_' + ambienteAtual();

/** Mapa público para a tela de login (sem segredos). */
export function mapaPublico() {
  const atual = ambienteAtual(), mostrar = mostrarOutros();
  return Object.fromEntries(IDS.filter(id => id === atual || mostrar).map(id => [id, { rotulo: ROTULO[id], url: id === atual ? '' : urlDe(id) }]));
}

const h = s => createHash('sha256').update(String(s)).digest();
export function chaveConfere(recebida) { const c = chave(); return !!c && !!recebida && timingSafeEqual(h(c), h(recebida)); }

/** Política de quem (origem) pode fazer o quê (op) em qual caminho deste site (alvo). */
export const PROMOCAO = ['config', 'rh_cargos', 'rh_centros', 'rh_departamentos', 'funcionarios/_viagens/parametros', 'adq_taxas', 'credsystem_metas', 'credsystem_campanhas', 'pe_simulador'];
const LEITURA_LIVRE = ['config/recursos', 'sistema/status', 'sistema/ambientes'];
export function interPermitido(origem, alvo, op, caminho) {
  if (!IDS.includes(origem) || origem === alvo) return false;
  if (origem === 'rc') return op === 'get' && LEITURA_LIVRE.includes(caminho); // a RC (white-label) não lê dados da Esposende
  if (origem === 'homolog' && alvo === 'prod') {                                // Homologação → Produção: lê tudo; grava só a "Liberação"
    if (op === 'get' || op === 'list') return true;
    if (op === 'set') return PROMOCAO.some(c => caminho.startsWith(c + '/') && caminho.split('/').length === c.split('/').length + 1) || caminho === 'sistema/ambientes';
    return false;
  }
  return true; // Produção → Homologação/RC e Homologação → RC: Gestão de Ambientes completa (clonar, resetar, liberar versão, Master)
}
