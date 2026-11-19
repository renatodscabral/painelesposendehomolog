/* v14.15 / v14.15.1 · Triangulação ERP × Adquirentes (Getnet, SafraPay e Credsystem) × Banco (OFX) — trava no SERVIDOR, atrás do recurso gestao_v1415 (que depende da gestao_v1414).

   Duas coleções novas, aditivas (a v14.14 e as taxas não mudam); desde a v14.15.1 a Credsystem (Adq 304) ENTRA no ERP (é conciliada direto com o OFX pela Dt Crédito):

     adq_agendas/<adq>__<cnpj14>__<AAAA-MM>   { formato:'safra-agenda', adquirente:'SAFRAPAY', empresaId, cnpj, competencia, contaId, vcols, vendas, … }
        "Agenda de Vendas" da SafraPay (visão Venda), um documento por (Adquirente + CNPJ + Competência da DATA DA VENDA). Fica ao lado do lote de "Recebíveis de
        antecipação" (adq_lotes, visão Pagamento): um nunca sobrescreve o outro, porque são coleções diferentes. A chave é a mesma do lote e é conferida contra o conteúdo.

     adq_erp/<AAAA-MM>:meta                   { formato:'erp-apuracao', tipo:'meta', v:2, competencia, rev, partes, cols, info, arquivos, codigos, resumo }
     adq_erp/<AAAA-MM>:p0, :p1, …             { formato:'erp-apuracao', tipo:'parte', v:2, competencia, rev, i, n, descs:[…], grupos:[[loja, dtVenda, dtCrédito, adq, descIdx, DC, OP, bruto, MDR, líquido, antecipação, txExtra, nº]…] }
        "Apuração dos Créditos" (aba ApuraCreditos) do ERP agregada por Loja × Dt Venda × Dt Crédito × Adq × Descrição × DC × OP, um mês lógico por competência da Dt Venda gravado em PEDAÇOS:
        cada documento tem NO MÁXIMO 256 KiB de JSON puro (o limite do banco do Artifact; o servidor confere igual para o painel nunca depender do ambiente), o `meta` é gravado por último e só vale
        com as partes da mesma `rev`. O identificador é conferido contra a competência (e a posição `i`) do conteúdo. Os identificadores antigos da v14.15 (<AAAA-MM> e <AAAA-MM>__2…) seguem aceitos.

   O contrato (adq_contratos, v14.14) ganha campos OPCIONAIS: `lojas` (códigos de Loja do ERP vinculados ao contrato) e `ecs` (Estabelecimentos Comerciais) — validados aqui.

   Com o recurso desligado nada disto roda: o comportamento é o da v14.14.
   Funções puras (idAgenda, validarAgenda, validarErp…) são exportadas para o teste automatizado. */
import { ErroHttp } from './http.mjs';
import { partes } from './regras.mjs';
import { chaveAdq, digitos, idLote, cnpjValido } from './adq-1414.mjs';

export const RECURSO = 'gestao_v1415';
export const COL_AGENDAS = 'adq_agendas';
export const COL_ERP = 'adq_erp';
export const COL_CONTRATOS = 'adq_contratos';
export const MAX_GRUPOS_ERP = 40000;       // formato antigo (um documento por parte)
export const MAX_GRUPOS_PARTE = 20000;     // v14.15.1: tuplas por parte
export const MAX_PARTES_ERP = 400;
export const MAX_BYTES_ERP = 256 * 1024;   // limite do documento do banco do Artifact (256 KiB)
export const MAX_LOJAS_CONTRATO = 300;

export const ativoNaSessao = sess => typeof sess?.recursoAtivo === 'function' && !!sess.recursoAtivo(RECURSO);

const RE_COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;
const RE_ID_ERP = /^(\d{4}-(?:0[1-9]|1[0-2]))(?:__([2-9]|\d{2}))?$/;                 // v14.15 (antigo)
const RE_ID_ERP2 = /^(\d{4}-(?:0[1-9]|1[0-2])):(meta|p(\d{1,3}))$/;                       // v14.15.1
export const idAgenda = (cnpj, competencia) => idLote('SAFRAPAY', cnpj, competencia);
export const idErp = (competencia, parte = 1) => (parte > 1 ? `${competencia}__${parte}` : competencia);
export const idErpMeta = competencia => `${competencia}:meta`;
export const idErpParte = (competencia, i) => `${competencia}:p${i}`;

/** Agenda de Vendas da SafraPay: o identificador TEM de ser SAFRAPAY + CNPJ + competência da venda do próprio conteúdo. */
export function validarAgenda(docId, d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new ErroHttp(422, 'A Agenda de Vendas precisa ser um objeto.');
  if (chaveAdq(d.adquirente) !== 'SAFRAPAY') throw new ErroHttp(422, 'A Agenda de Vendas é só da SafraPay.');
  if (d.formato !== 'safra-agenda') throw new ErroHttp(422, 'Formato da Agenda de Vendas inválido (esperado safra-agenda).');
  if (!cnpjValido(d.cnpj)) throw new ErroHttp(422, 'CNPJ da Agenda de Vendas inválido.');
  if (typeof d.competencia !== 'string' || !RE_COMPETENCIA.test(d.competencia)) throw new ErroHttp(422, 'Competência da Agenda de Vendas inválida (AAAA-MM).');
  if (typeof d.empresaId !== 'string' || !d.empresaId.trim()) throw new ErroHttp(422, 'A Agenda de Vendas precisa da empresa do contrato.');
  if (typeof d.contaId !== 'string' || !d.contaId.trim()) throw new ErroHttp(422, 'A Agenda de Vendas precisa da Conta Bancária de Crédito do contrato.');
  if (!Array.isArray(d.vendas)) throw new ErroHttp(422, 'A Agenda de Vendas precisa da lista de vendas.');
  if (idAgenda(d.cnpj, d.competencia) !== docId) throw new ErroHttp(422, 'A Agenda de Vendas não pode ser gravada nesta chave: o identificador não confere com a SafraPay, o CNPJ e a competência do conteúdo (outra agenda não é sobrescrita).');
  return d;
}

const ehObj = d => !!d && typeof d === 'object' && !Array.isArray(d);
const ehData = t => typeof t === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t);
const finito = v => typeof v === 'number' && Number.isFinite(v);
const fora = (n, a, b) => !Number.isInteger(n) || n < a || n > b;

/** ERP (Apuração dos Créditos): o identificador TEM de ser a competência do conteúdo (e, no formato novo, o tipo e a posição da parte). Aceita os dois formatos. */
export function validarErp(docId, d) {
  const id = String(docId || ''), m2 = RE_ID_ERP2.exec(id), m = m2 ? null : RE_ID_ERP.exec(id);
  if (!m && !m2) throw new ErroHttp(422, 'Identificador do ERP inválido (esperado AAAA-MM:meta, AAAA-MM:p0, AAAA-MM:p1… ou, no formato antigo, AAAA-MM ou AAAA-MM__parte).');
  if (!ehObj(d)) throw new ErroHttp(422, 'O documento do ERP precisa ser um objeto.');
  if (d.formato !== 'erp-apuracao') throw new ErroHttp(422, 'Formato do ERP inválido (esperado erp-apuracao).');
  if (typeof d.competencia !== 'string' || !RE_COMPETENCIA.test(d.competencia)) throw new ErroHttp(422, 'Competência do ERP inválida (AAAA-MM).');
  if (d.competencia !== (m2 ? m2[1] : m[1])) throw new ErroHttp(422, 'O identificador do ERP não confere com a competência do conteúdo.');
  if (m2) return validarErp2(m2, d);
  /* formato antigo (v14.15): um documento por competência/parte; a Credsystem deixou de ser rejeitada na v14.15.1 */
  if (!Array.isArray(d.grupos) || d.grupos.length > MAX_GRUPOS_ERP) throw new ErroHttp(422, `O ERP precisa de uma lista de grupos com até ${MAX_GRUPOS_ERP} itens por documento (divida o mês em partes).`);
  for (let i = 0; i < d.grupos.length; i++) { const g = d.grupos[i]; if (!Array.isArray(g) || typeof g[1] !== 'string' || !g[1].startsWith(d.competencia)) throw new ErroHttp(422, 'Há grupo do ERP fora da competência do documento.'); }
  return d;
}

/** Formato novo (v14.15.1): `meta` e `parte`, cada um ≤ 256 KiB de JSON puro. */
function validarErp2(m, d) {
  const meta = m[2] === 'meta', tam = Buffer.byteLength(JSON.stringify(d));
  if (tam > MAX_BYTES_ERP) throw new ErroHttp(413, `O documento do ERP passou de ${MAX_BYTES_ERP / 1024} KiB (${tam} bytes): divida em partes menores.`);
  if (d.tipo !== (meta ? 'meta' : 'parte')) throw new ErroHttp(422, `O identificador ${meta ? ':meta' : ':p<n>'} exige um documento do tipo ${meta ? 'meta' : 'parte'}.`);
  if (typeof d.rev !== 'string' || d.rev.length < 4 || d.rev.length > 64) throw new ErroHttp(422, 'O documento do ERP precisa da marca de gravação (rev).');
  if (meta) {
    if (fora(d.partes, 0, MAX_PARTES_ERP)) throw new ErroHttp(422, `O resumo do ERP precisa informar o número de partes (0 a ${MAX_PARTES_ERP}).`);
    for (const [campo, max] of [['info', 2000], ['arquivos', 60]]) if (d[campo] != null && (!Array.isArray(d[campo]) || d[campo].length > max)) throw new ErroHttp(422, `O campo ${campo} do resumo do ERP é inválido.`);
    if (d.codigos != null && !ehObj(d.codigos)) throw new ErroHttp(422, 'O campo codigos do resumo do ERP é inválido.');
    if (d.resumo != null && !ehObj(d.resumo)) throw new ErroHttp(422, 'O campo resumo do ERP é inválido.');
    return d;
  }
  const i = Number(m[3]);
  if (d.i !== i) throw new ErroHttp(422, 'A posição da parte do ERP não confere com o identificador.');
  if (fora(d.n, 1, MAX_PARTES_ERP) || i >= d.n) throw new ErroHttp(422, 'O total de partes do ERP é inválido.');
  if (!Array.isArray(d.descs) || d.descs.length > 5000 || d.descs.some(x => typeof x !== 'string' || x.length > 300)) throw new ErroHttp(422, 'O dicionário de descrições da parte do ERP é inválido.');
  if (!Array.isArray(d.grupos) || d.grupos.length > MAX_GRUPOS_PARTE) throw new ErroHttp(422, `Cada parte do ERP aceita até ${MAX_GRUPOS_PARTE} linhas agregadas.`);
  for (let k = 0; k < d.grupos.length; k++) {
    const g = d.grupos[k];
    if (!Array.isArray(g) || g.length !== 13) throw new ErroHttp(422, 'Linha do ERP fora do formato (13 campos: Loja, Dt Venda, Dt Crédito, Adq, descrição, DC, OP, bruto, MDR, líquido, antecipação, Tx Extra e nº de linhas).');
    if (typeof g[0] !== 'string' || !g[0] || g[0].length > 20 || !ehData(g[1]) || !g[1].startsWith(d.competencia)) throw new ErroHttp(422, 'Há linha do ERP com Loja ou Dt Venda inválida (ou fora da competência do documento).');
    if (g[2] !== '' && !ehData(g[2])) throw new ErroHttp(422, 'Há linha do ERP com Dt Crédito inválida (esperado AAAA-MM-DD ou vazio).');
    if (typeof g[3] !== 'string' || g[3].length > 20 || fora(g[4], 0, Math.max(0, d.descs.length - 1)) || !d.descs.length) throw new ErroHttp(422, 'Há linha do ERP com código de adquirente ou descrição inválidos.');
    if (!['CR', 'DB'].includes(g[5]) || !['VE', 'CX'].includes(g[6])) throw new ErroHttp(422, 'Há linha do ERP com DC ou OP inválidos (DC = CR ou DB; OP = VE ou CX).');
    for (let c = 7; c <= 11; c++) if (!finito(g[c])) throw new ErroHttp(422, 'Há valor do ERP que não é um número finito.');
    if (fora(g[12], 1, 10000000)) throw new ErroHttp(422, 'Há linha do ERP com quantidade de lançamentos inválida.');
  }
  return d;
}

/** Campos opcionais do contrato: lojas do ERP e Estabelecimentos Comerciais. */
export function validarContratoExtras(d) {
  for (const [campo, max, tam] of [['lojas', MAX_LOJAS_CONTRATO, 20], ['ecs', 40, 30]]) {
    if (d[campo] == null) continue;
    if (!Array.isArray(d[campo]) || d[campo].length > max) throw new ErroHttp(422, `O campo ${campo} do contrato precisa ser uma lista com até ${max} itens.`);
    for (const x of d[campo]) if (typeof x !== 'string' || !x.trim() || x.length > tam) throw new ErroHttp(422, `Item inválido em ${campo} do contrato.`);
    if (new Set(d[campo].map(x => x.trim().toUpperCase())).size !== d[campo].length) throw new ErroHttp(422, `Há itens repetidos em ${campo} do contrato.`);
  }
  return d;
}

/** Gancho de documentos.gravar (depois do protegerAdq1414): valida agendas, ERP e os campos novos do contrato quando o recurso está ligado. */
export async function protegerAdq1415(t, sess, caminho, dados) {
  if (!ativoNaSessao(sess)) return dados;
  const { colecao: col0, docId } = partes(caminho), pref = (/^amb\/[^/]+\//.exec(col0) || [''])[0], colecao = col0.slice(pref.length);
  if (colecao === COL_AGENDAS) validarAgenda(docId, dados);
  else if (colecao === COL_ERP) validarErp(docId, dados);
  else if (colecao === COL_CONTRATOS) validarContratoExtras(dados);
  return dados;
}
