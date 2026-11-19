#!/usr/bin/env node
/* v13.94 · Aplica automaticamente, no build do Netlify (antes de compilar o site), as migrações SQL pendentes — usando a conexão do
   banco que o Netlify já injeta (NETLIFY_DB_URL; se não houver, DATABASE_URL).

   Uso:
     node scripts/run-migrations.mjs             (o comando do build: gera o módulo embutido e aplica as pendentes)
     node scripts/run-migrations.mjs --status    (só mostra a situação; não altera o banco)
     node scripts/run-migrations.mjs --embutir   (só regenera netlify/lib/migracoes-embutidas.mjs, sem tocar no banco)
     node scripts/run-migrations.mjs --dir <pasta>   (outra pasta de migrações; padrão netlify/database/migrations; --sem-embutir não mexe no módulo embutido)

   Variáveis (todas opcionais): MIGRACOES_DESLIGADAS=1 (pula tudo) · MIGRACOES_ESTRITO=1 (falha o build também quando não há
   conexão com o banco) · MIGRACOES_LOCK_MS / MIGRACOES_STMT_MS (esperas máximas, em ms).

   Regra de segurança (leia netlify/lib/migracoes.mjs): o Netlify também aplica essa pasta no deploy, então aqui só rodam as migrações
   aditivas (IF NOT EXISTS), que podem repetir sem dano; esquema inicial, semente e o resto continuam sendo do Netlify.
   Saída: nunca imprime a URL do banco nem dados — só o nome da variável usada e o nome dos arquivos. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogoDePasta, gerarEmbutidas, executar, situacao } from '../netlify/lib/migracoes.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), tem = f => args.includes(f);
const iDir = args.indexOf('--dir'), dir = path.resolve(raiz, iDir >= 0 && args[iDir + 1] ? args[iDir + 1] : 'netlify/database/migrations');
const log = (...a) => console.log('[migracoes]', ...a);
const AVISO = (...a) => console.warn('[migracoes] AVISO:', ...a);

const catalogo = catalogoDePasta(dir);
/* módulo embutido nas Netlify Functions (o botão "Executar Migrações do Banco" do Master usa o mesmo catálogo) */
const destino = path.join(raiz, 'netlify/lib/migracoes-embutidas.mjs'), fonte = gerarEmbutidas(catalogo);
if (!tem('--sem-embutir') && (!fs.existsSync(destino) || fs.readFileSync(destino, 'utf8') !== fonte)) { fs.writeFileSync(destino, fonte); log(`módulo embutido atualizado (${catalogo.length} arquivo(s) em ${path.relative(raiz, dir) || '.'})`); }
if (tem('--embutir')) process.exit(0);

if (/^(1|true|sim)$/i.test(process.env.MIGRACOES_DESLIGADAS || '')) { log('desligado por MIGRACOES_DESLIGADAS: nada a fazer'); process.exit(0); }
const estrito = /^(1|true|sim)$/i.test(process.env.MIGRACOES_ESTRITO || '');
const variavel = ['NETLIFY_DB_URL', 'DATABASE_URL', 'NETLIFY_DATABASE_URL'].find(v => (process.env[v] || '').trim());
if (!variavel) {
  const msg = 'sem NETLIFY_DB_URL nem DATABASE_URL neste build: as migrações ficam por conta do deploy do Netlify (nada foi alterado no banco)';
  if (estrito) { console.error('[migracoes] ERRO:', msg); process.exit(1); }
  AVISO(msg); process.exit(0);
}

const rotulo = { aplicada: 'aplicada', pendente: 'pendente', adiada: 'adiada', netlify: 'gerida pelo Netlify', falhou: 'FALHOU' };
function imprimir(rel) {
  for (const m of rel.migracoes) {
    const det = m.estado === 'aplicada' ? (m.agora ? ' agora' : ` em ${String(m.em || '').slice(0, 10)}`) : m.motivo ? ` — ${m.motivo}` : '';
    log(`${m.nome}: ${rotulo[m.estado] || m.estado}${det}${m.aviso ? ` (${m.aviso})` : ''}`);
  }
  const r = rel.resumo; log(`resumo: ${r.aplicadas} aplicada(s), ${r.pendentes} pendente(s), ${r.adiadas} adiada(s), ${r.netlify} do Netlify, ${r.falhas} falha(s)`);
  for (const e of rel.esquema || []) if (!e.ok) AVISO(`esquema incompleto: ${e.rotulo} (faltam ${e.falta.join(', ')}) — o deploy do Netlify aplica o que falta`);
}

let dbc;
try {
  const { getDatabase } = await import('@netlify/database');
  dbc = getDatabase({ connectionString: process.env[variavel].trim() });
  log(`conexão com o banco pela variável ${variavel}`);
  if (tem('--status')) { imprimir(await situacao(dbc.pool, catalogo)); process.exit(0); }
  const rel = await executar(dbc.pool, catalogo, { origem: 'build', lockMs: Number(process.env.MIGRACOES_LOCK_MS) || 10000, stmtMs: Number(process.env.MIGRACOES_STMT_MS) || 120000 });
  if (!rel.base) log('banco ainda sem o esquema inicial: o deploy do Netlify monta tudo; nada foi alterado aqui');
  if (rel.erroLivro) AVISO('não consegui criar o livro-razão (painel_migracoes):', rel.erroLivro, '— nada foi aplicado por aqui; o deploy do Netlify segue normalmente');
  imprimir({ ...rel, esquema: [] });
  if (rel.falhou) { console.error(`[migracoes] ERRO: ${rel.falhou.nome} falhou (${rel.falhou.codigo || 'sem código'}): ${rel.falhou.mensagem}\n[migracoes] O build foi interrompido para não publicar código que depende dessa migração. Corrija e envie de novo.`); process.exitCode = 1; }
} catch (e) {
  const msg = String(e?.message || e).split('\n')[0].slice(0, 300);
  if (estrito) { console.error('[migracoes] ERRO ao falar com o banco:', msg); process.exitCode = 1; }
  else AVISO('não consegui falar com o banco neste build (' + msg + '): as migrações ficam por conta do deploy do Netlify');
} finally { try { await dbc?.pool?.end?.(); } catch { /* já fechado */ } }
