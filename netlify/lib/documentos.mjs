/* Leitura e gravação de documentos com as regras de acesso aplicadas no servidor. */
import { q, tx } from './db.mjs';
import { ErroHttp } from './http.mjs';
import { NIVEL, exigido, validarCaminho, partes, ehUsuarios } from './regras.mjs';

export const LIMITE_DOC = 5.5 * 1024 * 1024;   // bytes de JSON por documento
export const LIMITE_PAGINA = 3.5 * 1024 * 1024; // bytes de JSON por página de listagem (resposta da função ≤ 6 MB)
const PROTEGIDOS_USUARIO = ['perfil', 'permissoes', 'ativo', 'funcionarioId', 'escopo', 'cpf', 'nome', 'criadoEm', 'criadoPor'];

export function podeLer(sess, caminho) {
  if (!sess) return false;
  if (sess.trocaPendente) return caminho === sess.caminho;
  return sess.nivel >= exigido(caminho, 'r', sess.uid);
}
export function podeGravar(sess, caminho) {
  if (!sess) return false;
  if (sess.trocaPendente || (ehUsuarios(caminho) && sess.nivel < NIVEL.admin)) return caminho === sess.caminho; // só o próprio login
  return sess.nivel >= exigido(caminho, 'w', sess.uid);
}

/** Documento como o painel espera: { id, ...dados } — sem a senha para quem não é Master. */
export function saida(sess, caminho, docId, dados) {
  const d = { id: docId, ...dados };
  if (ehUsuarios(caminho) && !(sess && sess.nivel >= NIVEL.admin && !sess.trocaPendente)) delete d.senha;
  return d;
}

export function checarDoc(caminho) { if (!validarCaminho(caminho, 'doc')) throw new ErroHttp(400, 'Caminho de documento inválido.'); }
export function checarColecao(c) { if (!validarCaminho(c, 'col')) throw new ErroHttp(400, 'Caminho de coleção inválido.'); }

export async function lerDoc(sess, caminho) {
  checarDoc(caminho); if (!podeLer(sess, caminho)) throw new ErroHttp(sess ? 403 : 401, sess ? 'Sem permissão para ler este registro.' : 'Faça login.');
  const [r] = await q('SELECT doc_id, dados FROM documentos WHERE caminho = $1', [caminho]);
  return r ? saida(sess, caminho, r.doc_id, r.dados) : null;
}

export async function listar(sess, colecao, { ordem, dir, limite, apos } = {}) {
  checarColecao(colecao); if (!podeLer(sess, colecao) || sess.trocaPendente) throw new ErroHttp(sess ? 403 : 401, sess ? 'Sem permissão para ler esta coleção.' : 'Faça login.');
  let linhas, proximo = null;
  if (ordem && limite) {
    const n = Math.min(Math.max(parseInt(limite, 10) || 1, 1), 1000), desc = String(dir).toLowerCase() === 'desc';
    linhas = await q(`SELECT doc_id, dados FROM documentos WHERE colecao = $1 ORDER BY dados -> $2 ${desc ? 'DESC NULLS LAST' : 'ASC NULLS FIRST'}, doc_id LIMIT $3`, [colecao, String(ordem), n]);
  } else {
    const brutas = await q(`SELECT doc_id, dados, octet_length(dados::text) AS tam FROM documentos WHERE colecao = $1 AND doc_id > $2 ORDER BY doc_id LIMIT 500`, [colecao, apos || '']);
    linhas = []; let soma = 0;
    for (const r of brutas) { if (linhas.length && soma + r.tam > LIMITE_PAGINA) { proximo = linhas[linhas.length - 1].doc_id; break; } soma += r.tam; linhas.push(r); }
    if (!proximo && brutas.length === 500) proximo = brutas[499].doc_id;
  }
  return { docs: linhas.map(r => saida(sess, colecao + '/' + r.doc_id, r.doc_id, r.dados)), proximo };
}

/** Grava (substitui) um documento. `t` = função de consulta (dentro ou fora de transação). */
export async function gravar(t, sess, caminho, dados) {
  checarDoc(caminho);
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) throw new ErroHttp(400, 'O documento precisa ser um objeto.');
  if (!podeGravar(sess, caminho)) throw new ErroHttp(sess ? 403 : 401, sess ? 'Sem permissão para gravar este registro.' : 'Faça login.');
  let d = { ...dados }; delete d.id;
  if (ehUsuarios(caminho)) {
    const [ex] = await t('SELECT dados FROM documentos WHERE caminho = $1', [caminho]), atual = ex?.dados || null;
    if (!('senha' in d) && atual?.senha) d.senha = atual.senha; // leituras sem a senha não a apagam ao regravar
    if (sess.nivel < NIVEL.admin || sess.trocaPendente) {
      if (!atual) throw new ErroHttp(403, 'Sem permissão para criar usuários.');
      for (const k of PROTEGIDOS_USUARIO) { if (k in atual) d[k] = atual[k]; else delete d[k]; }
      const trocou = !!d.senha?.hash && d.senha.hash !== atual.senha?.hash;
      if (atual.trocarSenha && !trocou) d.trocarSenha = true; // a troca obrigatória só sai com uma senha nova
      if (sess.trocaPendente && trocou && d.trocarSenha === false) await t('UPDATE sessoes SET troca_pendente = false WHERE token_hash = $1', [sess.tokenHash]);
    }
  }
  const texto = JSON.stringify(d);
  if (Buffer.byteLength(texto) > LIMITE_DOC) throw new ErroHttp(413, 'Registro grande demais (limite de 5,5 MB por documento).');
  const { colecao, docId } = partes(caminho);
  await t(`INSERT INTO documentos (caminho, colecao, doc_id, dados, atualizado_por) VALUES ($1, $2, $3, $4::jsonb, $5)
           ON CONFLICT (caminho) DO UPDATE SET dados = EXCLUDED.dados, versao = documentos.versao + 1, atualizado_em = now(), atualizado_por = EXCLUDED.atualizado_por`,
    [caminho, colecao, docId, texto, sess.uid]);
  await t('INSERT INTO mudancas (caminho, colecao, op, por) VALUES ($1, $2, $3, $4)', [caminho, colecao, 'set', sess.uid]);
}

export async function remover(t, sess, caminho) {
  checarDoc(caminho);
  if (!sess || (ehUsuarios(caminho) && sess.nivel < NIVEL.admin) || !podeGravar(sess, caminho)) throw new ErroHttp(sess ? 403 : 401, sess ? 'Sem permissão para excluir este registro.' : 'Faça login.');
  const r = await t('DELETE FROM documentos WHERE caminho = $1 RETURNING colecao', [caminho]);
  if (r.length) await t('INSERT INTO mudancas (caminho, colecao, op, por) VALUES ($1, $2, $3, $4)', [caminho, r[0].colecao, 'remove', sess.uid]);
}

/** Lote de gravações numa transação, com SAVEPOINT por operação (uma recusa não derruba as demais).
    `permitido(op, caminho)` é uma checagem extra (ex.: política entre ambientes). */
export const MAX_OPS = 200;
export async function executarLote(sess, ops, permitido = () => true) {
  if (!Array.isArray(ops) || !ops.length || ops.length > MAX_OPS) throw new ErroHttp(400, `Envie de 1 a ${MAX_OPS} operações.`);
  return tx(async t => {
    const out = [];
    for (const o of ops) {
      await t('SAVEPOINT op');
      try {
        const caminho = String(o?.caminho || '');
        if (!['set', 'remove'].includes(o?.op)) throw new ErroHttp(400, 'Operação inválida.');
        if (!permitido(o.op, caminho)) throw new ErroHttp(403, 'Operação não permitida entre estes ambientes.');
        if (o.op === 'remove') await remover(t, sess, caminho); else await gravar(t, sess, caminho, o.dados);
        await t('RELEASE SAVEPOINT op'); out.push({ ok: true });
      } catch (e) { await t('ROLLBACK TO SAVEPOINT op'); if (!e.status) throw e; out.push({ ok: false, status: e.status, erro: e.message }); }
    }
    return out;
  });
}
