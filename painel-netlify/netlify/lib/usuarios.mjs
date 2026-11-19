/* Usuários do login por CPF: localizar pelo CPF e conferir a situação (mesmas regras do painel). */
import { q } from './db.mjs';
import { soDigitos } from './senha.mjs';

const desligado = f => !!f && ['DESLIGADO', 'INATIVO'].includes(String(f.status || 'Ativo').trim().toUpperCase());
export function situacao(u, f) {
  if (!u) return 'revogado';
  if (u.ativo === false) return 'desativado';
  if (u.funcionarioId && !f) return 'sem_funcionario';
  if (desligado(f)) return 'desligado';
  return 'ok';
}
export async function funcionarioDe(u) {
  if (!u?.funcionarioId) return null;
  const [r] = await q('SELECT doc_id, dados FROM documentos WHERE caminho = $1', ['funcionarios/' + u.funcionarioId]);
  return r ? { id: r.doc_id, ...r.dados } : null;
}
/** Mesmo critério do painel: CPF do funcionário vinculado (Módulo 1) ou o do Master avulso. */
export async function localizar(cpf) {
  const us = await q(`SELECT caminho, doc_id, dados FROM documentos WHERE colecao = 'usuarios' ORDER BY doc_id`);
  const ids = [...new Set(us.map(u => u.dados.funcionarioId).filter(Boolean))].map(id => 'funcionarios/' + id);
  const fs = ids.length ? await q('SELECT doc_id, dados FROM documentos WHERE caminho = ANY($1)', [ids]) : [];
  const fm = new Map(fs.map(f => [f.doc_id, { id: f.doc_id, ...f.dados }]));
  for (const u of us) { const f = u.dados.funcionarioId ? fm.get(u.dados.funcionarioId) || null : null; if (soDigitos(f?.cpf || u.dados.cpf) === cpf) return { caminho: u.caminho, id: u.doc_id, u: u.dados, f }; }
  return null;
}
