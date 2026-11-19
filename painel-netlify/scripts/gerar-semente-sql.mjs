/* Gera a migração com a carga inicial (Master padrão + cadastros base) a partir de um JSON de semente:
     { "versao": "...", "docs": { "lojas/loja-005": {...}, "config/empresas": {...} },
       "masters": [{ "id": "usr-...", "nome": "...", "cpf": "00000000000", "senha": { "alg", "sal", "hash" } }] }
   uso: node scripts/gerar-semente-sql.mjs semente.json [netlify/database/migrations/20261027120100_semente_inicial.sql]
   ON CONFLICT DO NOTHING: nunca sobrescreve o que já estiver no banco. A senha vai só em hash (troca obrigatória no 1º login). */
import fs from 'node:fs';

const [, , origem, destino = 'netlify/database/migrations/20261027120100_semente_inicial.sql'] = process.argv;
if (!origem) { console.error('uso: node scripts/gerar-semente-sql.mjs semente.json [saida.sql]'); process.exit(1); }
const s = JSON.parse(fs.readFileSync(origem, 'utf8')), agora = new Date().toISOString();
const docs = { ...(s.docs || {}) };
for (const m of s.masters || []) {
  const cpf = String(m.cpf).replace(/\D/g, ''); if (cpf.length !== 11 || !m.senha?.hash) throw new Error('Master sem CPF ou senha válida: ' + m.id);
  docs['usuarios/' + m.id] = { perfil: 'MASTER', nome: m.nome, cpf, permissoes: {}, ativo: true, senha: m.senha, trocarSenha: true, origem: 'semente', criadoEm: agora };
}
docs['sistema/status'] = { configurado: true, desde: agora };
const tag = '$semente$', linhas = [];
for (const [caminho, dados] of Object.entries(docs)) {
  const i = caminho.lastIndexOf('/'), j = JSON.stringify(dados);
  if (j.includes(tag) || caminho.includes("'")) throw new Error('Conteúdo incompatível com a migração: ' + caminho);
  linhas.push(`('${caminho}', '${caminho.slice(0, i)}', '${caminho.slice(i + 1)}', ${tag}${j}${tag}::jsonb, 'semente')`);
}
const sql = `-- Carga inicial do Painel (semente ${s.versao || ''}) · gerada por scripts/gerar-semente-sql.mjs em ${agora}
-- ${Object.keys(docs).length} documento(s). Não sobrescreve nada que já exista (ON CONFLICT DO NOTHING).
INSERT INTO documentos (caminho, colecao, doc_id, dados, atualizado_por) VALUES
${linhas.join(',\n')}
ON CONFLICT (caminho) DO NOTHING;
`;
fs.writeFileSync(destino, sql); console.log('ok', destino, Object.keys(docs).length, 'documentos');
