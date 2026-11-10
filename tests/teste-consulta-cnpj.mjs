/* v13.94 · Teste da consulta de CNPJ (GET /api/consulta-cnpj): BrasilAPI → fallback MinhaReceita, sessão obrigatória,
   validação do CNPJ, cache, tempo limite, 404/502 e limite de uso. As APIs públicas são SIMULADAS por um servidor local
   (nenhuma chamada à Receita; dados FICTÍCIOS). Uso:
     bash tests/preparar-banco.sh
     CNPJ_URL_BRASILAPI='http://127.0.0.1:8895/brasil/{cnpj}' CNPJ_URL_MINHARECEITA='http://127.0.0.1:8895/minha/{cnpj}' CNPJ_TIMEOUT_MS=700 \
       NETLIFY_DB_URL=postgres://… node tests/servidor-local.mjs 8890 &
     NETLIFY_DB_URL=postgres://… node tests/teste-consulta-cnpj.mjs */
import http from 'node:http';
import pg from 'pg';
import { gerar } from '../netlify/lib/senha.mjs';
import { cnpjValido, normalizar, limpar } from '../netlify/lib/consulta-cnpj.mjs';
const U = 'http://localhost:8890', OK = [], FAIL = [];
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 1200) : '')); };
const db = new pg.Pool({ connectionString: process.env.NETLIFY_DB_URL }), sql = (t, p) => db.query(t, p).then(r => r.rows);
const doc = async (caminho, dados) => { const i = caminho.lastIndexOf('/'); await sql(`INSERT INTO documentos (caminho, colecao, doc_id, dados) VALUES ($1, $2, $3, $4) ON CONFLICT (caminho) DO UPDATE SET dados = EXCLUDED.dados`, [caminho, caminho.slice(0, i), caminho.slice(i + 1), JSON.stringify(dados)]); };
const usuario = (id, perfil, cpf, extra = {}) => doc('usuarios/' + id, { perfil, nome: 'Teste ' + id, cpf, ativo: true, permissoes: {}, trocarSenha: false, senha: gerar('Teste2026Ab', 'sal-' + id), ...extra });
async function login(cpf) { const r = await fetch(U + '/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json', 'x-painel': '1' }, body: JSON.stringify({ cpf, senha: 'Teste2026Ab' }) }); const c = r.headers.get('set-cookie'); if (!c) throw new Error('login falhou ' + r.status + ' ' + await r.text()); return c.split(';')[0]; }
const get = async (rota, ck) => { const r = await fetch(U + rota, { headers: ck ? { cookie: ck } : {} }); let j = {}; try { j = await r.json(); } catch { /* sem corpo */ } return { s: r.status, j }; };

/* CNPJ fictício válido a partir de 12 dígitos-base (o 1º, 11.444.777/0001-61, é o de uso nos testes do painel) */
const gerarCnpj = base12 => { const c = base12.split('').map(Number); for (const n of [12, 13]) { let s = 0, p = n - 7; for (let i = 0; i < n; i++) { s += c[i] * p--; if (p < 2) p = 9; } const r = s % 11; c.push(r < 2 ? 0 : 11 - r); } return c.join(''); };
const C = { ok: '11444777000161', fb: gerarCnpj('123456780001'), t404: gerarCnpj('234567890001'), t502: gerarCnpj('345678900001'), lento: gerarCnpj('456789010001'), so2: gerarCnpj('567890120001'), vazio: gerarCnpj('678901230001') };

/* ---------- API pública simulada ---------- */
const modo = {}; const hits = { brasil: [], minha: [] };
const base = { razao_social: 'EMPRESA MODELO DE TESTE LTDA', nome_fantasia: 'MODELO TESTE', cep: 58000000, descricao_tipo_de_logradouro: 'RUA', logradouro: 'DAS FLORES', numero: '100', complemento: 'SALA 2', bairro: 'CENTRO', municipio: 'JOAO PESSOA', uf: 'pb', capital_social: 50000, descricao_situacao_cadastral: 'ATIVA', data_situacao_cadastral: '2020-01-10', cnae_fiscal: 4781400, cnae_fiscal_descricao: 'Comércio varejista de artigos do vestuário', data_inicio_atividade: '2015-03-20', natureza_juridica: 'Sociedade Empresária Limitada', porte: 'DEMAIS' };
const upstream = http.createServer((req, res) => {
  const [, prov, cnpj] = req.url.split('/'); hits[prov]?.push(cnpj);
  const m = modo[cnpj]?.[prov] ?? 200, fim = (st, corpo) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(corpo)); };
  if (m === 'lento') return setTimeout(() => fim(200, { ...base, razao_social: 'LENTA SA' }), 2500);
  if (m === 'vazio') return fim(200, {});
  if (m === 200) return fim(200, prov === 'minha' ? { ...base, razao_social: 'EMPRESA MODELO DE TESTE LTDA (MR)' } : base);
  fim(m, { message: 'simulado ' + m });
}).listen(8895);

/* ---------- 1 · unidade ---------- */
chk('CNPJ: dígitos verificadores — 11.444.777/0001-61 e CNPJs gerados passam; dígito trocado, sequência repetida, tamanho errado e vazio não', cnpjValido('11.444.777/0001-61') && Object.values(C).every(cnpjValido) && !cnpjValido('11444777000162') && !cnpjValido('00000000000000') && !cnpjValido('1144477700016') && !cnpjValido('') && !cnpjValido(null));
const n = normalizar(base, C.ok), n2 = normalizar({ ...base, descricao_tipo_de_logradouro: 'RUA', logradouro: 'RUA DAS FLORES', cep: '1234', capital_social: '1.5' }, C.ok);
chk('normalização: tipo + logradouro, CEP em 8 dígitos, UF em maiúsculas, capital numérico, sem duplicar o tipo ("RUA RUA")',
  n.logradouro === 'RUA DAS FLORES' && n.cep === '58000000' && n.uf === 'PB' && n.capitalSocial === 50000 && n.situacao === 'ATIVA' && n.razaoSocial === 'EMPRESA MODELO DE TESTE LTDA' && n.nomeFantasia === 'MODELO TESTE' && n.municipio === 'JOAO PESSOA' && n.bairro === 'CENTRO'
  && n2.logradouro === 'RUA DAS FLORES' && n2.cep === '00001234' && n2.capitalSocial === 1.5 && normalizar({ capital_social: 'x' }, C.ok).capitalSocial === 0 && limpar('11.444.777/0001-61') === '11444777000161', [n, n2]);

/* ---------- 2 · API ---------- */
await usuario('usr-master-cn', 'MASTER', '52998224725'); await usuario('usr-op-cn', 'OPERACIONAL', '11144477735'); await usuario('usr-troca-cn', 'OPERACIONAL', '39053344705', { trocarSenha: true });
const M = await login('52998224725'), O = await login('11144477735');
const a0 = await get('/api/consulta-cnpj?cnpj=' + C.ok);
chk('sem sessão → 401 (a consulta não é pública) e nenhuma chamada sai para a Receita', a0.s === 401 && hits.brasil.length === 0, [a0.s, hits]);
let TK; try { TK = await login('39053344705'); } catch { TK = null; }
const at = TK ? await get('/api/consulta-cnpj?cnpj=' + C.ok, TK) : { s: 401 };
chk('sessão com troca de senha pendente → 401', at.s === 401, at.s);
const a1 = await get('/api/consulta-cnpj?cnpj=11.444.777/0001-62', M), a1b = await get('/api/consulta-cnpj', M), a1c = await get('/api/consulta-cnpj?cnpj=abc', M);
chk('CNPJ com dígito errado, ausente ou com letras → 400 e sem chamada externa', a1.s === 400 && a1b.s === 400 && a1c.s === 400 && /inválido/i.test(a1.j.erro) && hits.brasil.length === 0, [a1.s, a1b.s, a1c.s, hits]);
const a2 = await get('/api/consulta-cnpj?cnpj=' + encodeURIComponent('11.444.777/0001-61'), M);
chk('CNPJ válido (com máscara) → 200 pela BrasilAPI, com os 9 campos do cadastro normalizados', a2.s === 200 && a2.j.ok && a2.j.fonte === 'brasilapi' && !a2.j.cache && a2.j.dados.cnpj === C.ok && a2.j.dados.razaoSocial === 'EMPRESA MODELO DE TESTE LTDA' && a2.j.dados.nomeFantasia === 'MODELO TESTE'
  && a2.j.dados.cep === '58000000' && a2.j.dados.logradouro === 'RUA DAS FLORES' && a2.j.dados.numero === '100' && a2.j.dados.bairro === 'CENTRO' && a2.j.dados.municipio === 'JOAO PESSOA' && a2.j.dados.uf === 'PB' && a2.j.dados.capitalSocial === 50000 && a2.j.dados.situacao === 'ATIVA', a2);
const a3 = await get('/api/consulta-cnpj/' + C.ok, O);
chk('mesmo CNPJ por outro usuário (rota /api/consulta-cnpj/<cnpj>) → vem do cache, sem nova chamada à BrasilAPI', a3.s === 200 && a3.j.cache === true && hits.brasil.filter(x => x === C.ok).length === 1, [a3.s, a3.j.cache, hits.brasil]);
modo[C.fb] = { brasil: 500 };
const b1 = await get('/api/consulta-cnpj?cnpj=' + C.fb, M);
chk('BrasilAPI fora do ar (500) → fallback automático para a MinhaReceita (200, fonte "minhareceita")', b1.s === 200 && b1.j.fonte === 'minhareceita' && /\(MR\)/.test(b1.j.dados.razaoSocial) && hits.brasil.includes(C.fb) && hits.minha.includes(C.fb), [b1.s, b1.j.fonte, hits]);
modo[C.so2] = { brasil: 404 };
const b2 = await get('/api/consulta-cnpj?cnpj=' + C.so2, M);
chk('BrasilAPI não conhece o CNPJ (404) mas a MinhaReceita conhece → 200 pela reserva', b2.s === 200 && b2.j.fonte === 'minhareceita', b2);
modo[C.lento] = { brasil: 'lento' };
const t0 = Date.now(), b3 = await get('/api/consulta-cnpj?cnpj=' + C.lento, M), dt = Date.now() - t0;
chk('BrasilAPI lenta (2,5 s) → tempo limite de 0,7 s e fallback para a MinhaReceita, sem prender o painel', b3.s === 200 && b3.j.fonte === 'minhareceita' && dt < 2000, [b3.s, b3.j.fonte, dt]);
modo[C.vazio] = { brasil: 'vazio' };
const b4 = await get('/api/consulta-cnpj?cnpj=' + C.vazio, M);
chk('resposta vazia/sem razão social da 1ª fonte é tratada como falha → usa a 2ª', b4.s === 200 && b4.j.fonte === 'minhareceita', b4);
modo[C.t404] = { brasil: 404, minha: 404 };
const c1 = await get('/api/consulta-cnpj?cnpj=' + C.t404, M);
chk('CNPJ inexistente nas duas fontes → 404 com mensagem clara', c1.s === 404 && /não encontrado/i.test(c1.j.erro), c1);
modo[C.t502] = { brasil: 503, minha: 502 };
const c2 = await get('/api/consulta-cnpj?cnpj=' + C.t502, M);
chk('as duas fontes fora do ar → 502 (o painel pede para preencher à mão) e informa o status de cada uma', c2.s === 502 && /indisponíveis/i.test(c2.j.erro) && c2.j.fontes?.length === 2, c2);
const p1 = await fetch(U + '/api/consulta-cnpj?cnpj=' + C.ok, { method: 'POST', headers: { cookie: M, 'x-painel': '1', 'content-type': 'application/json' }, body: '{}' });
chk('POST → 405 (só consulta)', p1.status === 405, p1.status);
/* limite de uso: sessão nova, 41 chamadas com CNPJ inválido (sem custo externo) — a 41ª é barrada */
let ultimo = 0, primeiro429 = 0; for (let i = 1; i <= 45; i++) { const r = await get('/api/consulta-cnpj?cnpj=1', M); ultimo = r.s; if (r.s === 429 && !primeiro429) primeiro429 = i; }
chk('limite de 40 consultas por minuto por sessão → 429 a partir da 41ª; outro usuário não é afetado', ultimo === 429 && primeiro429 >= 30 && primeiro429 <= 41 && (await get('/api/consulta-cnpj?cnpj=' + C.ok, O)).s === 200, [ultimo, primeiro429]);
console.log('\nOK (' + OK.length + ')  FALHAS (' + FAIL.length + ')'); await db.end(); upstream.close(); process.exit(FAIL.length ? 1 : 0);
