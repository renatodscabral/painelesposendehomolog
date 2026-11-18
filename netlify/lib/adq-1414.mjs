/* v14.14 · Conciliação de cartões por CONTRATO (Adquirente + Empresa/CNPJ) × Conta Bancária de Crédito (OFX) — trava no SERVIDOR, atrás do recurso gestao_v1414.

   Duas coleções novas (as taxas continuam em adq_taxas; o motor da Auditoria de Adquirentes e o cruzamento com o ERP não foram tocados):

     adq_contratos/<adq>__emp-<empresa>   { adquirente, empresaId, contaId, ativo, observacao? }
        O contrato liga (Adquirente + Empresa/CNPJ) à conta corrente que RECEBE o repasse. A Conta Bancária de Crédito é OBRIGATÓRIA e tem de ser uma conta já
        cadastrada no painel (contasBancarias, a mesma do FCX / Extratos OFX): o painel só oferece essas, e o servidor confere de novo (422).

     adq_lotes/<adq>__<cnpj14>__<AAAA-MM>  { adquirente, empresaId, cnpj, competencia, contaId, formato, … (fatos agregados do arquivo da adquirente) }
        Um lote por (Adquirente + CNPJ + Competência). O identificador é a própria chave: importar GETNET · Mar Aberto só regrava os documentos de GETNET · Mar Aberto
        daquele mês — os de GETNET · Resilienza, SAFRAPAY ou qualquer outro CNPJ ficam intactos por construção. O servidor recusa (422) um lote cujo identificador não
        bata com adquirente + CNPJ + competência do próprio conteúdo, para que um cliente defeituoso nunca grave por cima do lote de outra empresa.

   Com o recurso desligado (Produção/Falco antes de "Liberar Versão em Produção") nada disto roda: o comportamento é o da v14.13.
   Funções puras (chaveAdq, idLote, validarLote…) são exportadas para o teste automatizado e conferidas contra o painel (public/index.html). */
import { ErroHttp } from './http.mjs';
import { partes } from './regras.mjs';

export const RECURSO = 'gestao_v1414';
export const COL_CONTRATOS = 'adq_contratos';
export const COL_LOTES = 'adq_lotes';
/** Adquirentes com leitor de arquivo nesta versão (a Credsystem segue fora, em aberto). */
export const ADQUIRENTES_LOTE = ['GETNET', 'SAFRAPAY'];

export const ativoNaSessao = sess => typeof sess?.recursoAtivo === 'function' && !!sess.recursoAtivo(RECURSO);

/** Mesma normalização do AdqTaxas.chave do painel: sem acento, maiúsculas, só A–Z, 0–9 e espaço. */
export const chaveAdq = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
export const slugAdq = s => chaveAdq(s).toLowerCase().replace(/\s+/g, '-') || 'x';
export const adqId = nome => 'adq-' + slugAdq(nome);
export const digitos = s => String(s ?? '').replace(/\D/g, '');
export const idContrato = (adquirente, empresaId) => `${adqId(adquirente)}__emp-${slugAdq(empresaId)}`;
export const idLote = (adquirente, cnpj, competencia) => `${adqId(adquirente)}__${digitos(cnpj)}__${competencia}`;

const RE_COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;
const RE_ID_LOTE = /^(adq-[a-z0-9-]+)__(\d{14})__(\d{4}-(?:0[1-9]|1[0-2]))$/;
const RE_ID_CONTRATO = /^(adq-[a-z0-9-]+)__emp-([a-z0-9-]+)$/;

/** CNPJ com dígitos verificadores corretos (a segunda trava: o painel já valida). */
export function cnpjValido(v) {
  const d = digitos(v); if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const dv = n => { let s = 0, p = n - 7; for (let i = 0; i < n; i++) { s += +d[i] * p--; if (p < 2) p = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return dv(12) === +d[12] && dv(13) === +d[13];
}

/** Contrato: a conta de crédito é obrigatória. Devolve o documento normalizado. `contaExiste(id)` confere a conta no banco (opcional nos testes puros). */
export function validarContrato(docId, d) {
  const m = RE_ID_CONTRATO.exec(String(docId || ''));
  if (!m) throw new ErroHttp(422, 'Identificador de contrato inválido (esperado adquirente + empresa).');
  if (!d || typeof d.adquirente !== 'string' || !chaveAdq(d.adquirente)) throw new ErroHttp(422, 'Contrato sem adquirente.');
  if (typeof d.empresaId !== 'string' || !d.empresaId.trim()) throw new ErroHttp(422, 'Contrato sem Empresa / CNPJ.');
  if (idContrato(d.adquirente, d.empresaId) !== docId) throw new ErroHttp(422, 'O identificador do contrato não confere com a adquirente e a empresa informadas.');
  if (typeof d.contaId !== 'string' || !d.contaId.trim() || d.contaId.length > 120) throw new ErroHttp(422, 'A Conta Bancária de Crédito (OFX) é obrigatória no contrato.');
  return d;
}

/** Lote: o identificador TEM de ser adquirente + CNPJ + competência do próprio conteúdo. */
export function validarLote(docId, d) {
  const m = RE_ID_LOTE.exec(String(docId || ''));
  if (!m) throw new ErroHttp(422, 'Identificador de lote inválido (esperado adquirente + CNPJ + competência).');
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new ErroHttp(422, 'O lote precisa ser um objeto.');
  if (typeof d.adquirente !== 'string' || !ADQUIRENTES_LOTE.includes(chaveAdq(d.adquirente))) throw new ErroHttp(422, `Adquirente do lote inválida (aceitas: ${ADQUIRENTES_LOTE.join(', ')}).`);
  if (!cnpjValido(d.cnpj)) throw new ErroHttp(422, 'CNPJ do lote inválido.');
  if (typeof d.competencia !== 'string' || !RE_COMPETENCIA.test(d.competencia)) throw new ErroHttp(422, 'Competência do lote inválida (AAAA-MM).');
  if (typeof d.contaId !== 'string' || !d.contaId.trim()) throw new ErroHttp(422, 'O lote precisa da Conta Bancária de Crédito do contrato.');
  if (typeof d.empresaId !== 'string' || !d.empresaId.trim()) throw new ErroHttp(422, 'O lote precisa da empresa do contrato.');
  if (idLote(d.adquirente, d.cnpj, d.competencia) !== docId) throw new ErroHttp(422, 'O lote não pode ser gravado nesta chave: o identificador não confere com a adquirente, o CNPJ e a competência do conteúdo (outro lote não é sobrescrito).');
  return d;
}

/** Gancho de documentos.gravar: valida contratos e lotes quando o recurso está ligado. Devolve os dados a gravar. */
export async function protegerAdq1414(t, sess, caminho, dados) {
  if (!ativoNaSessao(sess)) return dados;
  const { colecao: col0, docId } = partes(caminho), pref = (/^amb\/[^/]+\//.exec(col0) || [''])[0], colecao = col0.slice(pref.length); // ramo de ambiente (amb/<x>/) não muda a regra
  if (colecao === COL_CONTRATOS) {
    validarContrato(docId, dados);
    const [c] = await t('SELECT 1 AS ok FROM documentos WHERE colecao = $1 AND doc_id = $2', [pref + 'contasBancarias', dados.contaId]);
    if (!c) throw new ErroHttp(422, 'A Conta Bancária de Crédito (OFX) precisa ser uma conta já cadastrada no painel (FCX / Extratos OFX).');
  } else if (colecao === COL_LOTES) {
    validarLote(docId, dados);
  }
  return dados;
}
