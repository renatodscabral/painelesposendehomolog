#!/usr/bin/env node
/* v13.92 · seed-contabil-falco.mjs — carga de dados de TESTE do Módulo Contábil no site da FALCO (e só nele).

   O que faz: lê a planilha LançamentosIniciais.xlsx (60 lançamentos de jan–fev/2025), entra no site da Falco como Master e
   chama POST /api/contabil/carga-teste. O servidor da Falco cria o plano de contas da planilha (árvore Ativo, Passivo, PL,
   Receitas, Custos e Despesas), uma empresa fictícia de teste, os 60 lançamentos e mais 10 de março/2025 (empréstimo de longo
   prazo, 1ª parcela com juros, IRPJ/CSLL do trimestre e distribuição de lucros), tudo numa transação só.

   Travas (nesta ordem — qualquer uma falha e nada é enviado):
     1. a variável PAINEL_AMBIENTE deste terminal tem de ser exatamente "falco";
     2. o site informado (--url) tem de responder, em /api/saude, que é o ambiente da Falco;
     3. o servidor confere de novo: o site é o da Falco (PAINEL_AMBIENTE=falco no Netlify), quem pede é o Master e veio a frase
        "CARREGAR DADOS DE TESTE NA FALCO". Num site da Esposende (Produção ou Homologação) a rota recusa (403).
   Idempotente: cada lançamento leva o documento CARGA-…; rodar de novo não duplica nada.
   ATENÇÃO: lançamentos contábeis são intangíveis (não se apagam; só estorno). A carga fica numa empresa própria
   ("INDÚSTRIA FICTÍCIA DE TESTES FALCO LTDA", CNPJ 11.444.777/0001-61): a empresa principal não é tocada.

   Uso:
     PAINEL_AMBIENTE=falco node scripts/seed-contabil-falco.mjs --url https://SEU-SITE-FALCO.netlify.app --planilha "LançamentosIniciais.xlsx"
     opções: --simular            confere tudo no servidor e desfaz (nada é gravado)
             --sim                não pergunta a frase de confirmação (use só em teste automatizado)
             PAINEL_CPF / PAINEL_SENHA   credenciais do Master (senão, o script pergunta)
     sem --planilha, o servidor usa a cópia da planilha que já vem no código (netlify/lib/carga-falco-dados.mjs).
     manutenção: node scripts/seed-contabil-falco.mjs --gerar-dados planilha.xlsx   (regrava netlify/lib/carga-falco-dados.mjs) */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
const ESTE = fileURLToPath(import.meta.url);

const FRASE = 'CARREGAR DADOS DE TESTE NA FALCO';
const sair = (cod, msg) => { console.error((cod ? '✖ ' : '') + msg); process.exit(cod); };

/* ---------------------------------------------------------------- leitor mínimo de .xlsx (zip + XML, sem dependências) */
export function lerZip(buf) {
  let eocd = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('arquivo não é um .xlsx (zip) válido');
  const n = buf.readUInt16LE(eocd + 10), arquivos = new Map(); let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('diretório do zip corrompido');
    const metodo = buf.readUInt16LE(p + 10), tam = buf.readUInt32LE(p + 20), ln = buf.readUInt16LE(p + 28), le = buf.readUInt16LE(p + 30), lc = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const nome = buf.toString('utf8', p + 46, p + 46 + ln), ini = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28), dados = buf.subarray(ini, ini + tam);
    arquivos.set(nome, () => (metodo === 0 ? dados : metodo === 8 ? zlib.inflateRawSync(dados) : (() => { throw new Error('compressão não suportada: ' + metodo); })()).toString('utf8'));
    p += 46 + ln + le + lc;
  }
  return arquivos;
}
const ent = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
const textos = xml => [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => ent(m[1])).join('');
const col = ref => [...ref.replace(/\d+/g, '')].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export function lerPlanilha(arquivo) {
  const z = lerZip(fs.readFileSync(arquivo)), get = n => z.has(n) ? z.get(n)() : null;
  const ss = (get('xl/sharedStrings.xml') || '').match(/<si>[\s\S]*?<\/si>/g)?.map(textos) || [];
  const folha = get('xl/worksheets/sheet1.xml') || [...z.keys()].filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort().map(get)[0];
  if (!folha) throw new Error('a planilha não tem aba de dados');
  const linhas = [...folha.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map(r => { const o = []; for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const at = c[1], ref = (at.match(/\br="([A-Z]+\d+)"/) || [])[1], t = (at.match(/\bt="([^"]+)"/) || [])[1], v = ((c[2] || '').match(/<v>([\s\S]*?)<\/v>/) || [])[1];
    if (!ref) continue; o[col(ref)] = t === 's' ? ss[Number(v)] : t === 'inlineStr' ? textos(c[2] || '') : t === 'str' || t === 'e' ? ent(v || '') : t === 'b' ? v === '1' : v == null ? null : Number(v); } return o; });
  return linhas;
}
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const dataISO = v => { if (typeof v === 'number') return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10); const s = String(v || '').trim(), m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : s.slice(0, 10); };
/** linhas da planilha → [nº, data, histórico, cód. débito, conta débito, cód. crédito, conta crédito, valor] */
export function linhasDaPlanilha(arquivo) {
  const ls = lerPlanilha(arquivo), h = ls.findIndex(l => l.some(x => /^data$/.test(norm(x))) && l.some(x => /hist/.test(norm(x))));
  if (h < 0) throw new Error('cabeçalho não encontrado (precisa das colunas Data, Histórico, Cód. Débito, Conta Débito, Cód. Crédito, Conta Crédito e Valor)');
  const cab = ls[h].map(norm), ix = f => cab.findIndex(f), I = { n: ix(x => /^n[ºo°.]*$|^num/.test(x)), data: ix(x => x === 'data'), hist: ix(x => /hist/.test(x)), cd: ix(x => /cod/.test(x) && /deb/.test(x)), nd: ix(x => /conta/.test(x) && /deb/.test(x)), cc: ix(x => /cod/.test(x) && /cred/.test(x)), nc: ix(x => /conta/.test(x) && /cred/.test(x)), v: ix(x => /valor/.test(x)) };
  for (const [k, i] of Object.entries(I)) if (i < 0 && k !== 'n') throw new Error('coluna não encontrada na planilha: ' + k);
  const tira = (cod, nome) => { const s = String(nome || '').trim(); return s.startsWith(cod + ' - ') ? s.slice(cod.length + 3).trim() : s; };
  return ls.slice(h + 1).filter(l => l && l[I.data] != null && l[I.v] != null).map((l, k) => { const cd = String(l[I.cd]).trim(), cc = String(l[I.cc]).trim(); return [I.n >= 0 ? Number(l[I.n]) || k + 1 : k + 1, dataISO(l[I.data]), String(l[I.hist] || '').trim(), cd, tira(cd, l[I.nd]), cc, tira(cc, l[I.nc]), Math.round(Number(l[I.v]) * 100) / 100]; });
}

/* ---------------------------------------------------------------- linha de comando */
const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : null; };
async function perguntar(texto, oculto = false) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (oculto) rl._writeToOutput = s => { if (/\r|\n/.test(s)) process.stdout.write('\n'); else if (!s.startsWith(texto)) process.stdout.write('*'); else process.stdout.write(s); };
  return new Promise(r => rl.question(texto, a => { rl.close(); r(a.trim()); }));
}
async function principal() {
  const gerar = opt('--gerar-dados');
  if (gerar) {
    const linhas = linhasDaPlanilha(gerar), destino = path.join(path.dirname(ESTE), '..', 'netlify', 'lib', 'carga-falco-dados.mjs');
    fs.writeFileSync(destino, `/* v13.92 · os ${linhas.length} lançamentos de ${path.basename(gerar)}, convertidos pelo leitor de scripts/seed-contabil-falco.mjs.\n   [nº, data, histórico, cód. débito, conta débito, cód. crédito, conta crédito, valor em R$]. Dados FICTÍCIOS de teste. */\nexport const LINHAS_PLANILHA = [\n${linhas.map(l => '  ' + JSON.stringify(l)).join(',\n')}\n];\n`);
    return sair(0, `ok: ${linhas.length} linhas gravadas em ${destino}`);
  }
  /* trava 1 — o terminal tem de estar no contexto da Falco */
  const amb = process.env.PAINEL_AMBIENTE;
  if (amb !== 'falco') return sair(2, `Trava de segurança: PAINEL_AMBIENTE=${amb === undefined ? '(vazio)' : `"${amb}"`}. A carga de teste só roda com PAINEL_AMBIENTE=falco (exatamente). Nada foi enviado.`);
  const url = String(opt('--url') || process.env.PAINEL_URL_FALCO || '').replace(/\/+$/, ''); if (!/^https?:\/\//.test(url)) return sair(2, 'Informe o endereço do site da Falco: --url https://SEU-SITE-FALCO.netlify.app');
  const plan = opt('--planilha'), simular = !!opt('--simular');
  let linhas = null;
  if (plan) { linhas = linhasDaPlanilha(plan); const tot = linhas.reduce((a, l) => a + l[7], 0); console.log(`Planilha: ${linhas.length} lançamentos (${linhas[0][1]} a ${linhas[linhas.length - 1][1]}) · total R$ ${tot.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`); }
  /* trava 2 — o site tem de ser o da Falco */
  const sa = await fetch(url + '/api/saude').then(r => r.json()).catch(e => sair(3, `Sem resposta de ${url}/api/saude: ${e.message}`));
  if (sa.ambiente !== 'rc' && sa.ambiente !== 'falco') return sair(2, `Trava de segurança: ${url} é o ambiente "${sa.ambiente}" (${sa.ambientes?.[sa.ambiente]?.rotulo || '?'}), não o da Falco. Nada foi enviado.`);
  console.log(`Site: ${url} · ${sa.ambientes?.[sa.ambiente]?.rotulo || 'Falco'} ✓`);
  const cpf = process.env.PAINEL_CPF || await perguntar('CPF do Master: '), senha = process.env.PAINEL_SENHA || await perguntar('Senha: ', true);
  const lg = await fetch(url + '/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json', 'x-painel': '1' }, body: JSON.stringify({ cpf, senha }) });
  const lj = await lg.json().catch(() => ({})), ck = (lg.headers.get('set-cookie') || '').split(';')[0];
  if (!lg.ok || !ck) return sair(4, `Login recusado: ${lj.erro || lg.status}`);
  if (lj.trocar) return sair(4, 'Este usuário precisa trocar a senha: entre no site, troque a senha e rode de novo.');
  if (!process.argv.includes('--sim') && !simular) { const f = await perguntar(`Digite a frase para confirmar (${FRASE}): `); if (f !== FRASE) return sair(5, 'Frase diferente: cancelado, nada foi enviado.'); }
  const api = (met, rota, corpo) => fetch(url + '/api/contabil' + rota, { method: met, headers: { cookie: ck, 'content-type': 'application/json', 'x-painel': '1' }, body: corpo ? JSON.stringify(corpo) : undefined }).then(async r => ({ s: r.status, j: await r.json().catch(() => ({})) }));
  console.log(simular ? 'Simulando a carga no servidor (nada será gravado)…' : 'Enviando a carga…');
  const r = await api('POST', '/carga-teste', { confirmar: FRASE, simular, ...(linhas ? { linhas } : {}) });
  if (r.s !== 201) return sair(6, `O servidor recusou (${r.s}): ${r.j.erro || JSON.stringify(r.j)}`);
  const R = r.j, brl = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  console.log(`\nEmpresa: ${R.empresa.razaoSocial} (${R.empresa.criada ? 'criada agora' : 'já existia'}) · id ${R.empresa.id}`);
  console.log(`Contas criadas no plano: ${R.contasCriadas.length}${R.contasCriadas.length ? ' — ' + R.contasCriadas.map(c => c.codigo).join(', ') : ''}`);
  R.avisos.forEach(a => console.log('  aviso: ' + a));
  console.log(`Lançamentos: ${R.lancamentos.planilha} da planilha + ${R.lancamentos.marco} de março · ${R.lancamentos.inseridos} ${simular ? 'seriam gravados' : 'gravados'}, ${R.lancamentos.ignorados} já existiam · Σ débitos ${brl(R.lancamentos.totalDebitos)}`);
  console.log(`1º trimestre/2025: receita líquida ${brl(R.trimestre.receitaLiquida)} · LAIR ${brl(R.trimestre.lair)} · IRPJ ${brl(R.trimestre.irpj)} · CSLL ${brl(R.trimestre.csll)} · lucro líquido ${brl(R.trimestre.lucroLiquido)} · lucros distribuídos ${brl(R.trimestre.dividendos)}`);
  if (!simular) {
    const q = `empresa=${encodeURIComponent(R.empresa.id)}&de=2025-01-01&ate=2025-03-31`, bal = await api('GET', '/relatorios/balancete?' + q), bp = await api('GET', '/relatorios/balanco?' + q), ig = await api('GET', '/integridade');
    console.log(`Conferência: balancete ${bal.j.confere ? 'fecha (Σ D = Σ C)' : 'NÃO fecha'} · balanço ${bp.j.confere ? 'fecha (Ativo = Passivo + PL)' : 'NÃO fecha'} · cadeia de lançamentos ${ig.j.cadeiaIntegra && ig.j.equilibrados ? 'íntegra' : 'COM PROBLEMA'}`);
    console.log('\nPronto. No painel da Falco: Contabilidade › card da Empresa Ativa › "Indústria de Testes (fictícia)" › período 01/01/2025 a 31/03/2025.');
  }
  process.exit(0);
}
if (process.argv[1] && path.resolve(process.argv[1]) === ESTE) principal().catch(e => sair(1, e.stack || e.message));
