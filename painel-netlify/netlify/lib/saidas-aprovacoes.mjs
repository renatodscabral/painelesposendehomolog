/* v14.02 · Aprovação de pagamentos das Saídas do Dia (Tela Inicial › Resumo do Recebível do Dia).
   Quem tem "Autorizar Pagamentos nas Saídas do Dia" (recebiveis_aprovar_saidas) — ou o Master — marca os títulos a pagar do dia e
   clica em "Finalizar Aprovações": cada título fica APROVADO (marcado) ou RETIDO (não marcado), com o aprovador (nome e CPF) e a data/hora.

   Segurança e integridade:
     · O painel só envia { id, status, valor } de cada título. Fornecedor, conta, forma de pagamento, vencimento e valor são lidos AQUI,
       do FCX gravado no banco (esp2:saidas) — ninguém grava no lote um fornecedor ou valor que não esteja no FCX. Se o valor que a pessoa
       viu não for mais o do FCX (arquivo reimportado ou título editado), nada é gravado e a tela pede para atualizar.
     · Os totais e o selo de integridade (SHA-256 do conteúdo) são calculados no servidor; o selo vai no relatório como "assinatura digital".
       É uma assinatura eletrônica simples (identifica o usuário logado e sela o conteúdo); não é certificado ICP-Brasil.
     · Idempotente: a chave `idem` enviada pelo painel impede um segundo lote por duplo clique ou nova tentativa.
     · Nada é apagado: cada "Finalizar" cria um lote novo e a decisão mais recente de cada título é a que vale.
     · A mesma decisão vale para o mesmo título mesmo se o arquivo do FCX for reimportado no dia (a identidade do título é o conteúdo
       dele — data, conta, centro, fornecedor, valor, item, observação e forma — mais a ordem entre repetidos idênticos).
     · O CPF do aprovador é gravado inteiro (auditoria); só a máscara sai nas telas, no relatório e nos avisos. */
import { createHash } from 'node:crypto';
import { q, tx } from './db.mjs';
import { ErroHttp } from './http.mjs';
import { NIVEL } from './regras.mjs';
import { tem } from './permissoes.mjs';
import { soDigitos } from './senha.mjs';
import { funcionarioDe } from './usuarios.mjs';
import { agoraBRT, diasEntre } from './notif-dados.mjs';

export const RECURSO = 'gestao_v1402';
export const PERM_APROVAR = 'recebiveis_aprovar_saidas';
export const MAX_ITENS = 1500;
export const STATUS = ['APROVADO', 'RETIDO'];
const JANELA_PASSADO = 30, JANELA_FUTURO = 7;

/* ----------------------------------------------------------------- permissões */
const logado = sess => !!sess && !sess.trocaPendente;
/** Pode ver as decisões e os relatórios: Master, quem vê o FCX (de onde vêm os títulos) ou quem aprova. */
export const podeVer = sess => logado(sess) && (sess.nivel >= NIVEL.admin || tem(sess.perms, 'fcx.ver') || tem(sess.perms, PERM_APROVAR));
/** Pode finalizar aprovações: Master ou a permissão própria. O perfil Loja nunca aprova pagamentos. */
export const podeAprovar = sess => logado(sess) && sess.perfil !== 'LOJA' && (sess.nivel >= NIVEL.admin || tem(sess.perms, PERM_APROVAR));

/* ----------------------------------------------------------------- utilidades */
const texto = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const reais = v => { const n = Number(typeof v === 'string' ? v.replace(',', '.') : v); return Number.isFinite(n) && Math.abs(n) < 1e10 ? Math.round(n * 100) / 100 : null; };
const diaValido = v => { if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false; const d = new Date(v + 'T12:00:00Z'); return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === v; }; /* mês 13 / dia 45: a data inválida vira recusa 400/422, nunca erro 500 */
const sha = t => createHash('sha256').update(t, 'utf8').digest('hex');
export const mascararCpf = c => { const d = soDigitos(c); return d.length === 11 ? `***.***.***-${d.slice(9)}` : d ? '***' : ''; };
const num = v => Math.round((Number(v) || 0) * 100) / 100;
const iso = d => (d ? new Date(d).toISOString() : null);
/** O driver devolve "date" como Date (meia-noite local): as consultas pedem também o texto (dia::text) e esta função usa o texto; sem ele, os componentes locais da data. */
const diaTxt = (t, d) => { if (t) return String(t).slice(0, 10); if (d instanceof Date && !Number.isNaN(+d)) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; return d ? String(d).slice(0, 10) : ''; };

/** Chave de conteúdo do título (a identidade que sobrevive a uma nova importação do FCX). Repetidos idênticos ganham #2, #3… pela ordem do arquivo. */
export function chavesDosTitulos(saidas) {
  const n = new Map(), out = new Map();
  for (const s of saidas) {
    const base = [s.date, s.conta, s.centro, s.fornecedor, reais(s.valorLiquido != null ? s.valorLiquido : s.valor), s.formaPagamento, s.item, s.obs].map(v => String(v ?? '').trim().toLowerCase()).join('|');
    const k = (n.get(base) || 0) + 1; n.set(base, k); out.set(s.id, sha(base + '#' + k));
  }
  return out;
}

/* ----------------------------------------------------------------- FCX no banco (esp2:saidas) */
async function lerChaveFcx(chave) {
  const [m] = await q('SELECT dados FROM documentos WHERE caminho = $1', ['fcx/' + chave]);
  if (!m) return null;
  const partes = Math.max(0, Math.trunc(Number(m.dados?.partes) || 0)); if (!partes || partes > 400) return null;
  const rows = await q('SELECT doc_id, dados FROM documentos WHERE caminho = ANY($1::text[])', [Array.from({ length: partes }, (_, i) => `fcx/${chave}~${i}`)]);
  const por = new Map(rows.map(r => [r.doc_id, r.dados?.v]));
  const fatias = Array.from({ length: partes }, (_, i) => por.get(`${chave}~${i}`));
  if (fatias.some(f => typeof f !== 'string')) throw new ErroHttp(503, 'O FCX está sendo gravado agora (fatia ausente). Tente de novo em instantes.');
  try { return JSON.parse(fatias.join('')); } catch { return null; }
}
/** Saídas do FCX que valem para pagamento (efetivas/pagas), com id, chave de conteúdo e o valor líquido, indexadas pelo id do FCX. */
export async function saidasDoFcx() {
  const lista = await lerChaveFcx('esp2:saidas');
  if (!Array.isArray(lista)) return null;
  const todas = lista.filter(s => s && typeof s === 'object' && s.id != null && s.tipo !== 'previsto' && diaValido(String(s.date || '').slice(0, 10)));
  const chaves = chavesDosTitulos(todas);
  return new Map(todas.map(s => [String(s.id), { id: String(s.id), chave: chaves.get(s.id), vencimento: String(s.date).slice(0, 10), fornecedor: texto(s.fornecedor, 120), conta: texto(s.conta, 120), centro: texto(s.centro, 120), forma: texto(s.formaPagamento, 80),
    descricao: texto([s.item, s.obs].filter(Boolean).join(' · '), 240), valor: reais(s.valorLiquido != null ? s.valorLiquido : s.valor) ?? 0 }]));
}

/* ----------------------------------------------------------------- aprovador */
async function aprovadorDe(sess) {
  const u = sess.usuario || {}, f = await funcionarioDe(u), cpf = soDigitos(f?.cpf || u.cpf), nome = texto(f?.nome || u.nome, 120);
  if (cpf.length !== 11) throw new ErroHttp(422, 'O seu usuário não tem CPF cadastrado: peça ao Master para completar o cadastro antes de aprovar pagamentos.');
  return { id: String(sess.uid), nome: nome || 'Usuário', cpf };
}

/* ----------------------------------------------------------------- consultas */
const projetarLote = r => ({ id: Number(r.id), dia: diaTxt(r.dia_t, r.dia), criadoEm: iso(r.criado_em), aprovadorId: r.aprovador_id, aprovadorNome: r.aprovador_nome, aprovadorCpf: mascararCpf(r.aprovador_cpf),
  totalPrevisto: num(r.total_previsto), totalAutorizado: num(r.total_autorizado), totalRetido: num(r.total_retido), qtdTotal: r.qtd_total, qtdAprovados: r.qtd_aprovados, qtdRetidos: r.qtd_retidos,
  selo: r.selo, ambiente: r.ambiente || '', notificadoEm: iso(r.notificado_em), notificacao: r.notificacao || '' });
const projetarItem = r => ({ tituloId: r.titulo_id, status: r.status, fornecedor: r.fornecedor || '', conta: r.conta || '', centro: r.centro || '', forma: r.forma_pagamento || '', descricao: r.descricao || '', vencimento: diaTxt(r.venc_t, r.vencimento), valor: num(r.valor) });

/** O relatório de um lote: cabeçalho + itens (APROVADOS primeiro, depois os RETIDOS; cada grupo por vencimento e fornecedor). */
export async function lerLote(id) {
  const n = Number(id); if (!Number.isInteger(n) || n <= 0) throw new ErroHttp(400, 'Lote inválido.');
  const [l] = await q('SELECT *, dia::text AS dia_t FROM painel_saidas_lotes WHERE id = $1', [n]); if (!l) throw new ErroHttp(404, 'Lote de aprovação não encontrado.');
  const itens = await q(`SELECT *, vencimento::text AS venc_t FROM painel_saidas_decisoes WHERE lote_id = $1 ORDER BY (status = 'APROVADO') DESC, vencimento NULLS LAST, fornecedor, id`, [n]);
  return { lote: projetarLote(l), itens: itens.map(projetarItem) };
}
/** Lote cru (com o CPF inteiro) para o aviso — uso interno do servidor, nunca devolvido ao navegador. */
export async function lerLoteInterno(id) { const [l] = await q('SELECT * FROM painel_saidas_lotes WHERE id = $1', [Number(id) || 0]); return l || null; }

/** O que já foi decidido no dia: a decisão mais recente de cada título (indexada pelo id ATUAL do título no FCX) e os lotes do dia. */
export async function estadoDia(dia) {
  if (!diaValido(dia)) throw new ErroHttp(400, 'Informe o dia (AAAA-MM-DD).');
  const [saidas, lotes, rows] = await Promise.all([saidasDoFcx().catch(() => null),
    q('SELECT *, dia::text AS dia_t FROM painel_saidas_lotes WHERE dia = $1 ORDER BY id DESC LIMIT 20', [dia]),
    q(`SELECT DISTINCT ON (titulo_chave) titulo_chave, status, aprovador_nome, decidido_em, lote_id FROM painel_saidas_decisoes WHERE dia = $1 AND titulo_chave IS NOT NULL ORDER BY titulo_chave, decidido_em DESC, id DESC`, [dia]).catch(() => null)]);
  const decisoes = {};
  if (saidas && rows) { const porChave = new Map(rows.map(r => [r.titulo_chave, r])); for (const s of saidas.values()) { const r = porChave.get(s.chave); if (r) decisoes[s.id] = { status: r.status, por: r.aprovador_nome, em: iso(r.decidido_em), loteId: Number(r.lote_id) }; } }
  return { dia, decisoes, lotes: lotes.map(projetarLote) };
}

/* ----------------------------------------------------------------- finalizar */
/**
 * Grava um lote: `entrada` = { dia, idem, itens: [{ id, status, valor }] } (id = id do título no FCX). Devolve { repetido, lote, itens }.
 * Levanta ErroHttp 403 (sem permissão), 409 (o FCX mudou), 422 (dados inválidos).
 */
export async function finalizar(sess, entrada = {}) {
  if (!podeAprovar(sess)) throw new ErroHttp(403, 'Seu acesso não autoriza pagamentos nas Saídas do Dia (Gestão de Acessos › Visão › "Autorizar Pagamentos nas Saídas do Dia").');
  const dia = String(entrada.dia || ''), idem = String(entrada.idem || '');
  if (!diaValido(dia)) throw new ErroHttp(422, 'Informe o dia das saídas (AAAA-MM-DD).');
  const hoje = agoraBRT().iso, d = diasEntre(hoje, dia);
  if (d < -JANELA_PASSADO || d > JANELA_FUTURO) throw new ErroHttp(422, `O dia das saídas precisa estar entre ${JANELA_PASSADO} dias atrás e ${JANELA_FUTURO} dias à frente.`);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(idem)) throw new ErroHttp(422, 'Chave de idempotência inválida (atualize a tela e tente de novo).');
  const itens = Array.isArray(entrada.itens) ? entrada.itens : [];
  if (!itens.length) throw new ErroHttp(422, 'Não há títulos para aprovar neste dia.');
  if (itens.length > MAX_ITENS) throw new ErroHttp(422, `No máximo ${MAX_ITENS} títulos por aprovação.`);
  const repetido = (await q('SELECT id FROM painel_saidas_lotes WHERE idem = $1', [idem]))[0];
  if (repetido) return { repetido: true, ...(await lerLote(repetido.id)) };

  const fcx = await saidasDoFcx(); if (!fcx) throw new ErroHttp(422, 'O FCX ainda não tem saídas gravadas neste ambiente.');
  const vistos = new Set(), final = [];
  for (const it of itens) {
    const id = String(it?.id ?? ''), st = String(it?.status || '').toUpperCase();
    if (!id || vistos.has(id)) throw new ErroHttp(422, 'Há título repetido ou sem identificação na lista.');
    vistos.add(id);
    if (!STATUS.includes(st)) throw new ErroHttp(422, 'Cada título precisa estar APROVADO ou RETIDO.');
    const t = fcx.get(id); if (!t) throw new ErroHttp(409, 'Um dos títulos não existe mais no FCX (o arquivo foi importado de novo?). Atualize a tela e refaça a seleção.', { codigo: 'fcx_mudou' });
    const visto = reais(it?.valor); if (visto == null || Math.abs(visto - t.valor) > 0.005) throw new ErroHttp(409, `O valor de um dos títulos mudou no FCX (${t.fornecedor || t.conta || 'título'}). Atualize a tela e refaça a seleção.`, { codigo: 'fcx_mudou' });
    const atraso = diasEntre(t.vencimento, dia); // o dia de pagamento é o próximo dia útil do vencimento: nunca antes dele e, no máximo, alguns dias depois
    if (atraso < 0 || atraso > 10) throw new ErroHttp(422, 'Um dos títulos não pertence a este dia de pagamento. Atualize a tela e refaça a seleção.');
    final.push({ ...t, status: st });
  }
  const ap = await aprovadorDe(sess), agora = new Date().toISOString();
  const total = lista => Math.round(lista.reduce((a, x) => a + Math.round(x.valor * 100), 0)) / 100;
  const aprovados = final.filter(x => x.status === 'APROVADO'), retidos = final.filter(x => x.status === 'RETIDO');
  const selo = sha([dia, ap.id, agora, idem, ...final.map(x => `${x.chave}:${x.status}:${Math.round(x.valor * 100)}`).sort()].join('|'));
  try {
    const id = await tx(async t => {
      const [l] = await t(`INSERT INTO painel_saidas_lotes (idem, dia, criado_em, aprovador_id, aprovador_nome, aprovador_cpf, total_previsto, total_autorizado, total_retido, qtd_total, qtd_aprovados, qtd_retidos, selo, ambiente)
        VALUES ($1, $2::date, $3::timestamptz, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
        [idem, dia, agora, ap.id, ap.nome, ap.cpf, total(final), total(aprovados), total(retidos), final.length, aprovados.length, retidos.length, selo, sess.ambiente || null]);
      for (let i = 0; i < final.length; i += 150) {
        const parte = final.slice(i, i + 150), params = [], vals = parte.map((x, k) => {
          const b = k * 16; params.push(l.id, dia, x.id, x.chave, x.fornecedor, x.conta, x.centro, x.forma, x.descricao, x.vencimento, x.valor, x.status, ap.id, ap.nome, ap.cpf, agora);
          return `($${b + 1}, $${b + 2}::date, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}::date, $${b + 11}, $${b + 12}, $${b + 13}, $${b + 14}, $${b + 15}, $${b + 16}::timestamptz)`;
        });
        await t(`INSERT INTO painel_saidas_decisoes (lote_id, dia, titulo_id, titulo_chave, fornecedor, conta, centro, forma_pagamento, descricao, vencimento, valor, status, aprovador_id, aprovador_nome, aprovador_cpf, decidido_em) VALUES ${vals.join(', ')}`, params);
      }
      return l.id;
    });
    return { repetido: false, ...(await lerLote(id)) };
  } catch (e) {
    if (e?.code === '23505') { const [r] = await q('SELECT id FROM painel_saidas_lotes WHERE idem = $1', [idem]); if (r) return { repetido: true, ...(await lerLote(r.id)) }; } // duas chamadas ao mesmo tempo com a mesma chave
    throw e;
  }
}
