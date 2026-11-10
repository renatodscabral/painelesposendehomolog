/* /api/migracoes — "Executar Migrações do Banco" (v13.94). SÓ O MASTER.
   GET  → situação: o que está aplicado, o que está pendente e se o esquema que o painel exige está completo (não altera nada).
   POST → roda as migrações aditivas pendentes (as mesmas que o script de build roda; netlify/lib/migracoes.mjs explica a regra:
          o esquema inicial, a semente e tudo que não pode repetir continuam sendo do deploy do Netlify) e devolve o relatório.
   O catálogo vem de netlify/lib/migracoes-embutidas.mjs (gerado no build a partir de netlify/database/migrations/).
   401 sem sessão · 403 não é Master · 405 outro método. Erros de SQL vão no relatório (primeira linha, sem DETAIL). */
import { json, erro, rota } from '../lib/http.mjs';
import { sessaoDe } from '../lib/sessao.mjs';
import { NIVEL } from '../lib/regras.mjs';
import { db } from '../lib/db.mjs';
import { ambienteAtual } from '../lib/ambiente.mjs';
import { MIGRACOES } from '../lib/migracoes-embutidas.mjs';
import { situacao, executar } from '../lib/migracoes.mjs';

export default rota(async req => {
  const sess = await sessaoDe(req);
  if (!sess || sess.trocaPendente) return erro(401, 'Sessão encerrada. Faça login de novo.');
  if (sess.nivel < NIVEL.admin) return erro(403, 'Só o Master executa as migrações do banco.');
  if (req.method === 'GET') return json(200, { ambiente: ambienteAtual(), ...(await situacao(db().pool, MIGRACOES)) });
  if (req.method !== 'POST') return erro(405, 'Método não permitido.');
  /* esperas curtas: a função do Netlify tem poucos segundos; se o banco estiver travado, melhor falhar logo e tentar de novo */
  const rel = await executar(db().pool, MIGRACOES, { origem: 'botao', lockMs: 4000, stmtMs: 8000 });
  console.info(`[painel][migracoes] executadas pelo Master (${ambienteAtual()}): ${rel.executadas.length} aplicada(s)${rel.falhou ? `, FALHOU ${rel.falhou.nome}` : ''}`);
  const depois = await situacao(db().pool, MIGRACOES); // o esquema é relido DEPOIS da execução; a lista de migrações é a do relatório (traz o "agora" do que acabou de rodar)
  return json(200, { ambiente: ambienteAtual(), ok: !rel.falhou && !rel.erroLivro, executadas: rel.executadas, falhou: rel.falhou, erroLivro: rel.erroLivro, base: rel.base, livro: rel.livro, resumo: rel.resumo, migracoes: rel.migracoes, esquema: depois.esquema });
});
export const config = { path: '/api/migracoes' };
