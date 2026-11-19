/* v14.13 · Regras de classificação da DFC "pétreas" no SERVIDOR (documento config/dfc), atrás do recurso gestao_v1413.

   Por que existe: config/dfc guarda, no mesmo documento, as regras de classificação, as categorias da DFC, os ajustes das categorias padrão e o De-para FCX → DFC.
   O painel regrava o documento INTEIRO a cada alteração; se o navegador estiver com uma cópia vazia, antiga ou "de fábrica" (a leitura falhou, a aba ficou aberta há
   horas, outro computador já alterou), a gravação apagava o que o servidor tinha. A trava abaixo roda dentro da própria transação de gravação (documentos.gravar):

     · regras_inicializadas — marca "estas regras já foram semeadas/gravadas". É permanente: uma vez true, nunca volta a false e a semente de fábrica não roda mais
       (a semente chega com regras_semente: true e é recusada com 409 quando o documento já foi inicializado). Um documento antigo que já tem a lista `regras` (gravado
       antes da v14.13) conta como inicializado, sem precisar de migração.
     · regras_rev — contador da lista de regras. Quem altera a lista precisa mandar regras_rev = (valor do servidor) + 1; se outra pessoa/aba alterou antes, a
       gravação é recusada (409 regras_desatualizadas) e o painel relê o servidor e refaz a alteração sobre a versão nova. Gravações que NÃO mudam a lista (categorias,
       De-para, ajustes) passam, mas a lista do servidor é sempre mantida: um cliente que mande as regras de fábrica, antigas ou vazias por engano não as troca.
     · um cliente antigo (aba aberta antes da v14.13, sem regras_rev) que tente mudar a lista recebe o mesmo 409, com a orientação de atualizar a página (F5).

   Com o recurso desligado (Produção/Falco antes de "Liberar Versão em Produção") nada disto roda: o comportamento é o da v14.12. Funções puras (guardar,
   regrasIguais, validarRegras…) são exportadas para o teste automatizado. */
import { ErroHttp } from './http.mjs';

export const RECURSO = 'gestao_v1413';
export const CAMINHO = 'config/dfc';
export const MAX_REGRAS = 500;
export const SENTIDOS = new Set(['E', 'S', '*']);

export const ativoNaSessao = sess => typeof sess?.recursoAtivo === 'function' && !!sess.recursoAtivo(RECURSO);

/** O documento já foi inicializado? (marcador explícito OU já tem a lista de regras, gravada por uma versão anterior) */
export const iniciado = doc => !!doc && (doc.regras_inicializadas === true || Array.isArray(doc.regras));
export const revDe = doc => { const n = Number(doc?.regras_rev); return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0; };

const chave = r => JSON.stringify([String(r?.id ?? ''), (Array.isArray(r?.termos) ? r.termos : []).map(String), String(r?.sentido ?? ''), String(r?.categoria ?? '')]);
/** Mesma lista (id, termos, sentido e categoria, na mesma ordem)? */
export function regrasIguais(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (chave(a[i]) !== chave(b[i])) return false;
  return true;
}

/** Valida a lista (o editor do painel já valida; aqui é a segunda trava, contra cliente defeituoso). 422 com o motivo em linguagem simples. */
export function validarRegras(regras) {
  if (!Array.isArray(regras)) throw new ErroHttp(422, 'A lista de regras da DFC precisa ser uma lista.');
  if (regras.length > MAX_REGRAS) throw new ErroHttp(422, `Regras demais (limite de ${MAX_REGRAS}).`);
  const ids = new Set();
  regras.forEach((r, i) => {
    const n = i + 1;
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new ErroHttp(422, `Regra ${n}: formato inválido.`);
    if (typeof r.id !== 'string' || !r.id || r.id.length > 80) throw new ErroHttp(422, `Regra ${n}: identificador ausente ou longo demais.`);
    if (ids.has(r.id)) throw new ErroHttp(422, `Regra ${n}: identificador repetido (${r.id}).`);
    ids.add(r.id);
    if (!Array.isArray(r.termos) || !r.termos.length || r.termos.length > 100 || r.termos.some(t => typeof t !== 'string' || !t.trim() || t.length > 120)) throw new ErroHttp(422, `Regra ${n}: informe de 1 a 100 termos de até 120 caracteres.`);
    if (!SENTIDOS.has(r.sentido)) throw new ErroHttp(422, `Regra ${n}: sentido inválido.`);
    if (typeof r.categoria !== 'string' || !r.categoria || r.categoria.length > 80) throw new ErroHttp(422, `Regra ${n}: categoria ausente.`);
  });
}

const MSG_DESATUALIZADAS = 'As regras da DFC foram alteradas em outro computador, outra aba ou por outra pessoa depois que esta tela carregou. Nada foi gravado: o painel vai reler as regras do servidor para você refazer a alteração sobre a versão mais nova (se a tela for antiga, atualize a página com F5).';
const MSG_JA_INICIALIZADAS = 'As regras da DFC já foram inicializadas neste ambiente: a semente de fábrica não roda de novo e as suas regras foram mantidas.';

/**
 * Aplica a trava: recebe o documento atual do servidor (ou null) e o que o cliente quer gravar; devolve o que DEVE ser gravado ou levanta ErroHttp.
 * Não altera os objetos recebidos.
 */
export function guardar(atual, novo) {
  const d = { ...novo };
  const semente = d.regras_semente === true; delete d.regras_semente;       // marcador transitório: nunca é gravado
  if ('regras' in d && d.regras !== undefined) validarRegras(d.regras);
  if ('regras_rev' in d && !(Number.isInteger(d.regras_rev) && d.regras_rev >= 0)) throw new ErroHttp(422, 'Contador das regras inválido.');
  if (d.regras === undefined) delete d.regras;
  const rAtual = revDe(atual);

  if (!iniciado(atual)) {                                                    // 1ª gravação das regras (ou semente): vale; a partir daqui o documento é "inicializado"
    if (Array.isArray(d.regras)) { d.regras_inicializadas = true; d.regras_rev = rAtual + 1; }
    else { delete d.regras_inicializadas; if (rAtual) d.regras_rev = rAtual; else delete d.regras_rev; }
    return d;
  }

  if (semente) throw new ErroHttp(409, MSG_JA_INICIALIZADAS, { codigo: 'regras_ja_inicializadas' });
  const regrasAtuais = Array.isArray(atual.regras) ? atual.regras : [];
  if (!Array.isArray(d.regras)) { d.regras = regrasAtuais; d.regras_rev = rAtual; }                   // cliente sem a lista (parcial/antigo): preserva a do servidor
  else if (regrasIguais(d.regras, regrasAtuais)) d.regras_rev = rAtual;                               // só mudou outro campo (categorias, De-para, ajustes)
  else if (d.regras_rev !== rAtual + 1) throw new ErroHttp(409, MSG_DESATUALIZADAS, { codigo: 'regras_desatualizadas', regras_rev: rAtual }); // a lista mudou sobre uma base velha
  d.regras_inicializadas = true;
  return d;
}

/** Dentro da transação de gravação (documentos.gravar): só para config/dfc e só com o recurso ligado. Serializa as gravações do documento (inclusive quando ele ainda não existe). */
export async function protegerConfigDfc(t, sess, caminho, dados) {
  if (caminho !== CAMINHO || !ativoNaSessao(sess)) return dados;
  await t('SELECT pg_advisory_xact_lock(hashtext($1))', ['painel_config_dfc']);
  const [ex] = await t('SELECT dados FROM documentos WHERE caminho = $1', [caminho]);
  return guardar(ex?.dados || null, dados);
}
