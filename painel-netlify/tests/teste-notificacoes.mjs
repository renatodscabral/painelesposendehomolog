/* v14.00 · Teste da Central de Notificações (migração, catálogo, provedores, PDF, mensagens, IEO, cálculos, motor agendado e /api/notificar).
   Dados FICTÍCIOS (LGPD); os provedores de e-mail e WhatsApp são servidores falsos em 127.0.0.1. Uso, com um Postgres local:
     bash tests/preparar-banco.sh
     NETLIFY_DB_URL=postgres://postgres@127.0.0.1:54329/painel_teste node tests/teste-notificacoes.mjs
   (o teste sobe sozinho os servidores locais das portas 8891 — com chaves — e 8892 — sem chaves — e os derruba no fim.)
   Cobre: tabelas e restrições; saneamento; formatos de cada provedor e a tradução dos erros (CONFIG, DESTINO, RECUSADO, TRANSITORIO) sem vazar
   segredo; PDF A4 válido; e-mails escapados; paridade do IEO do servidor com o do painel (public/index.html); cada regra da matriz de eventos;
   janela de horário em Brasília, idempotência, repetição de erro transitório, orçamento de tempo, trava de concorrência; falta de chaves = aviso
   amigável no log e nada quebra; Testar Disparo, Reenviar e filtros da auditoria; e a API (401/403, CSRF, Master, recurso desligado). */
import pg from 'pg';
import http from 'node:http';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gerar } from '../netlify/lib/senha.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OK = [], FAIL = [];
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x !== '' ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 1600) : '')); };
const DBURL = process.env.NETLIFY_DB_URL; if (!DBURL) { console.error('Defina NETLIFY_DB_URL'); process.exit(2); }
const db = new pg.Pool({ connectionString: DBURL, max: 6 }), sql = (t, p) => db.query(t, p).then(r => r.rows);
const doc = (caminho, dados) => { const i = caminho.lastIndexOf('/'); return sql(`INSERT INTO documentos (caminho, colecao, doc_id, dados) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (caminho) DO UPDATE SET dados = EXCLUDED.dados, versao = documentos.versao + 1`, [caminho, caminho.slice(0, i), caminho.slice(i + 1), JSON.stringify(dados)]); };
const T = (dia, hhmm) => new Date(`${dia}T${hhmm}:00-03:00`);   // horário de Brasília
const CHAVE_EMAIL = 're_TESTE_chave_fake_123456', TOKEN_WA = 'tok_TESTE_wa_654321';

/* ----------------------------------------------------------------------------------------------- provedores falsos */
const mock = { email: [], wa: [], emailModo: 'ok', waModo: 'ok', atraso: 0 };
const servidor = (lista, modo, resposta) => http.createServer(async (req, res) => {
  const b = []; for await (const c of req) b.push(c); let corpo = null; try { corpo = JSON.parse(Buffer.concat(b).toString() || 'null'); } catch { /* texto */ }
  lista().push({ url: req.url, headers: req.headers, corpo });
  if (mock.atraso) await new Promise(r => setTimeout(r, mock.atraso));
  const m = modo();
  if (m === '401') { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ message: `API key inválida (${CHAVE_EMAIL}) token ${TOKEN_WA}` })); return; }
  if (m === '422') { res.writeHead(422, { 'content-type': 'application/json' }); res.end(JSON.stringify({ message: 'O campo "to" é inválido' })); return; }
  if (m === '429') { res.writeHead(429); res.end('{}'); return; }
  if (m === '503') { res.writeHead(503); res.end('indisponível'); return; }
  res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(resposta(lista().length)));
});
const srvEmail = servidor(() => mock.email, () => mock.emailModo, n => ({ id: 'mail_' + n })), srvWa = servidor(() => mock.wa, () => mock.waModo, n => ({ key: { id: 'wa_' + n } }));
await new Promise(r => srvEmail.listen(8861, '127.0.0.1', r)); await new Promise(r => srvWa.listen(8862, '127.0.0.1', r));
const configurar = (on = true) => {
  const k = { NOTIFICACAO_EMAIL_API_KEY: CHAVE_EMAIL, NOTIFICACAO_EMAIL_FROM: 'Painel <painel@exemplo.test>', NOTIFICACAO_EMAIL_ENDPOINT: 'http://127.0.0.1:8861/emails', NOTIFICACAO_WHATSAPP_ENDPOINT: 'http://127.0.0.1:8862/message/sendText/painel', NOTIFICACAO_WHATSAPP_TOKEN: TOKEN_WA };
  for (const [a, v] of Object.entries(k)) if (on) process.env[a] = v; else delete process.env[a];
};
configurar(true);
const zerar = () => { mock.email.length = 0; mock.wa.length = 0; mock.emailModo = 'ok'; mock.waModo = 'ok'; mock.atraso = 0; };

/* import dos módulos DEPOIS de configurar o ambiente */
const C = await import('../netlify/lib/notif-catalogo.mjs'), P = await import('../netlify/lib/notif-provedores.mjs'), D = await import('../netlify/lib/notif-dados.mjs'), M = await import('../netlify/lib/notif-mensagens.mjs'), PDF = await import('../netlify/lib/notif-pdf.mjs'), IEOS = await import('../netlify/lib/notif-ieo.mjs'), N = await import('../netlify/lib/notif-motor.mjs');
const agendada = await import('../netlify/functions/notificacoes-agendadas.mjs'), { db: dbLib } = await import('../netlify/lib/db.mjs');
const logs = (w = 'true', p = []) => sql(`SELECT id, canal, evento_chave, destinatario, titulo, status, detalhe_erro, referencia, teste, tentativa, reenvio_de, payload_mensagem FROM painel_notificacoes_log WHERE ${w} ORDER BY id`, p);
const limparLog = () => sql('DELETE FROM painel_notificacoes_log');
const desligarTudo = async () => { await sql(`UPDATE painel_notificacoes_regras SET ativo = false, destinatarios_json = '[]'::jsonb, parametros_json = '{}'::jsonb, ultima_rodada_em = NULL, ultima_rodada_resumo = NULL, ultimo_envio = NULL`); for (const e of C.EVENTOS) await sql('UPDATE painel_notificacoes_regras SET canal = $2 WHERE evento_chave = $1', [e.chave, e.canal]); };
const regra = (chave, o) => N.salvarRegra(chave, o, 'Teste');
const rodar = (dia, hhmm, extra = {}) => N.rodarAgendado({ agora: T(dia, hhmm), ...extra });
const semRodada = () => sql('UPDATE painel_notificacoes_regras SET ultima_rodada_em = NULL, ultima_rodada_resumo = NULL');
const pdfTexto = b64 => { const f = path.join(os.tmpdir(), 'notif_t_' + process.pid + '_' + Math.random().toString(36).slice(2) + '.pdf'); fs.writeFileSync(f, Buffer.from(b64, 'base64')); try { return execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }); } finally { fs.unlinkSync(f); } };

/* =========================================================================== 1 · esquema */
const cols = async t => (await sql(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [t])).map(r => r.column_name);
const cr = await cols('painel_notificacoes_regras'), cl = await cols('painel_notificacoes_log');
chk('painel_notificacoes_regras tem as colunas pedidas (id, evento_chave, canal, ativo, destinatarios_json, parametros_json, frequencia, ultimo_envio)', ['id', 'evento_chave', 'canal', 'ativo', 'destinatarios_json', 'parametros_json', 'frequencia', 'ultimo_envio'].every(c => cr.includes(c)), cr);
chk('painel_notificacoes_log tem as colunas pedidas (id, data_hora, canal, evento_chave, destinatario, titulo, payload_mensagem, status, detalhe_erro)', ['id', 'data_hora', 'canal', 'evento_chave', 'destinatario', 'titulo', 'payload_mensagem', 'status', 'detalhe_erro'].every(c => cl.includes(c)), cl);
const viola = async q => { try { await sql(q); return ''; } catch (e) { return e.code; } };
chk('o banco recusa canal fora de EMAIL/WHATSAPP/AMBOS, frequência inválida e chave de evento fora do padrão (CHECK 23514)', (await viola(`INSERT INTO painel_notificacoes_regras (evento_chave, canal) VALUES ('x_teste', 'SMS')`)) === '23514' && (await viola(`INSERT INTO painel_notificacoes_regras (evento_chave, frequencia) VALUES ('x_teste', 'ANUAL')`)) === '23514' && (await viola(`INSERT INTO painel_notificacoes_regras (evento_chave) VALUES ('Chave Ruim!')`)) === '23514');
chk('o log só aceita status SUCESSO/ERRO e canal EMAIL/WHATSAPP; payload tem de ser objeto', (await viola(`INSERT INTO painel_notificacoes_log (canal, evento_chave, destinatario, titulo, status) VALUES ('EMAIL', 'x_teste', 'a@b.cc', 't', 'TALVEZ')`)) === '23514' && (await viola(`INSERT INTO painel_notificacoes_log (canal, evento_chave, destinatario, titulo, status) VALUES ('SMS', 'x_teste', 'a@b.cc', 't', 'ERRO')`)) === '23514' && (await viola(`INSERT INTO painel_notificacoes_log (canal, evento_chave, destinatario, titulo, status, payload_mensagem) VALUES ('EMAIL', 'x_teste', 'a@b.cc', 't', 'ERRO', '[]')`)) === '23514');
chk('a evento_chave é única (uma regra por evento)', (await sql(`INSERT INTO painel_notificacoes_regras (evento_chave) VALUES ('x_unica')`), await viola(`INSERT INTO painel_notificacoes_regras (evento_chave) VALUES ('x_unica')`)) === '23505');
await sql(`DELETE FROM painel_notificacoes_regras WHERE evento_chave LIKE 'x_%'`);
const sqlMig = fs.readFileSync(path.join(raiz, 'netlify/database/migrations/20261112120000_esquema_notificacoes.sql'), 'utf8');
chk('a migração é repetível (CREATE … IF NOT EXISTS): rodar de novo não falha', (await viola(sqlMig)) === '');
const { classificar } = await import('../netlify/lib/migracoes.mjs');
chk('a migração é classificada como ADITIVA (o build e o botão podem aplicá-la com segurança)', classificar(sqlMig).aditiva === true, classificar(sqlMig));

/* =========================================================================== 2 · catálogo e saneamento */
chk('o catálogo tem os 10 eventos pedidos (viagens ×2, IEO regional, solicitações, executivo, RH ×2, falta de caixa, backup, saídas aprovadas — v14.02)', C.EVENTOS.length === 10 && ['viagem_lembrete_prestacao', 'viagem_prazo_excedido', 'ieo_regional_semanal', 'solicitacoes_sla_manha', 'relatorio_matinal_executivo', 'rh_dobra_ferias', 'rh_inicio_ferias', 'falta_caixa_tolerancia', 'backup_nuvem_status', 'saidas_aprovadas'].every(k => C.POR_CHAVE[k]));
const padrao = k => C.padraoParametros(C.POR_CHAVE[k]);
chk('horários padrão da matriz: IEO seg 08:00 · solicitações 08:30 · executivo 07:30 · backup diário · falta de caixa imediata (tolerância 10%)', padrao('ieo_regional_semanal').horario === '08:00' && padrao('ieo_regional_semanal').diaSemana === 1 && padrao('solicitacoes_sla_manha').horario === '08:30' && padrao('relatorio_matinal_executivo').horario === '07:30' && C.POR_CHAVE.falta_caixa_tolerancia.frequencia === 'IMEDIATA' && padrao('falta_caixa_tolerancia').toleranciaPct === 10 && C.POR_CHAVE.falta_caixa_tolerancia.canal === 'WHATSAPP' && padrao('rh_dobra_ferias').diasAntes.join() === '60,30' && padrao('rh_inicio_ferias').diasAntes === 5);
const sp = C.sanearParametros(C.POR_CHAVE.ieo_regional_semanal, { horario: '25:99', diaSemana: 9, lixo: 1 }), sp2 = C.sanearParametros(C.POR_CHAVE.rh_dobra_ferias, { diasAntes: '45; 15, 15, abc' }), sp3 = C.sanearParametros(C.POR_CHAVE.falta_caixa_tolerancia, { toleranciaPct: '250', valorSemBase: '-5' });
chk('saneamento: hora e dia inválidos voltam ao padrão, campo desconhecido some, lista vira números únicos em ordem, número é limitado ao mínimo/máximo', sp.horario === '08:00' && sp.diaSemana === 1 && !('lixo' in sp) && sp2.diasAntes.join() === '45,15' && sp3.toleranciaPct === 100 && sp3.valorSemBase === 0, [sp, sp2, sp3]);
const sd = C.sanearDestinatarios(C.POR_CHAVE.viagem_prazo_excedido, [{ papel: 'tesouraria', nome: ' Tesouraria ', email: ' TES@Exemplo.Test ', telefone: '(81) 99999-0001' }, { papel: 'inexistente', email: 'x@y.zz' }, { nome: 'sem contato' }, null, 'texto']);
const sp4 = C.sanearParametros(C.POR_CHAVE.rh_dobra_ferias, {}), sp5 = C.sanearParametros(C.POR_CHAVE.backup_nuvem_status, { horasMaximas: '' });
chk('saneamento: campo vazio ou ausente volta ao PADRÃO (não ao mínimo): lista vazia → 60,30; número em branco → 26', sp4.diasAntes.join() === '60,30' && sp5.horasMaximas === 26, [sp4, sp5]);
chk('saneamento dos destinatários: e-mail em minúsculas, papel desconhecido vira o primeiro papel do evento, sem e-mail/telefone é descartado', sd.length === 2 && sd[0].email === 'tes@exemplo.test' && sd[0].nome === 'Tesouraria' && sd[1].papel === 'tesouraria', sd);

/* =========================================================================== 3 · provedores */
chk('normalizarTelefone: 10 e 11 dígitos ganham 55; com +55, espaços e traços; fixo curto e lixo viram vazio', P.normalizarTelefone('(81) 99999-0001') === '5581999990001' && P.normalizarTelefone('+55 11 3333-4444') === '551133334444' && P.normalizarTelefone('5581999990001') === '5581999990001' && P.normalizarTelefone('1234') === '' && P.normalizarTelefone('abc') === '');
chk('mascarar: telefone e e-mail aparecem parcialmente (+55 81 ••••0001; jo•••@exemplo.test)', P.mascararTelefone('81999990001') === '+55 81 ••••0001' && P.mascararEmail('joana@exemplo.test') === 'jo•••@exemplo.test');
const cfgOn = P.estadoConfig(); configurar(false); const cfgOff = P.estadoConfig(); configurar(true);
chk('estadoConfig: configurado com as 4 variáveis; sem elas lista SÓ os nomes que faltam (nunca valores)', cfgOn.email.configurado && cfgOn.whatsapp.configurado && !cfgOff.email.configurado && cfgOff.email.faltam.join() === 'NOTIFICACAO_EMAIL_API_KEY,NOTIFICACAO_EMAIL_FROM' && cfgOff.whatsapp.faltam.join() === 'NOTIFICACAO_WHATSAPP_ENDPOINT,NOTIFICACAO_WHATSAPP_TOKEN' && !JSON.stringify(cfgOn).includes(CHAVE_EMAIL) && !JSON.stringify(cfgOn).includes(TOKEN_WA), cfgOn);
const reqW = p => P.montarWhatsApp({ para: '81999990001', texto: 'oi' }, { endpoint: 'https://x.test/y', token: 'T', provedor: p });
chk('WhatsApp: cada provedor recebe o formato certo — Evolution {number,text}+apikey · Z-API {phone,message}+client-token · Meta {messaging_product,to,text.body}+Bearer · webhook genérico',
  reqW('evolution').corpo.number === '5581999990001' && reqW('evolution').headers.apikey === 'T' && reqW('zapi').corpo.phone === '5581999990001' && reqW('zapi').headers['client-token'] === 'T' && reqW('meta').corpo.messaging_product === 'whatsapp' && reqW('meta').corpo.text.body === 'oi' && reqW('meta').headers.authorization === 'Bearer T' && reqW('generico').corpo.text === 'oi');
chk('provedor de WhatsApp é reconhecido pela URL (graph.facebook.com → Meta; z-api.io → Z-API; /message/sendText/ → Evolution; outro → genérico)', P.provedorWhatsApp('https://graph.facebook.com/v20.0/123/messages') === 'meta' && P.provedorWhatsApp('https://api.z-api.io/instances/1/token/2/send-text') === 'zapi' && P.provedorWhatsApp('https://evo.exemplo.test/message/sendText/inst') === 'evolution' && P.provedorWhatsApp('https://hook.exemplo.test/x') === 'generico');
configurar(false);
const e1 = await P.enviarEmail({ para: 'a@exemplo.test', assunto: 'x', html: '<p>x</p>' }).catch(e => e), w1 = await P.enviarWhatsApp({ para: '81999990001', texto: 'x' }).catch(e => e);
chk('sem chaves: enviarEmail/enviarWhatsApp lançam erro CONFIG amigável com o NOME das variáveis (nada é chamado)', e1.tipo === 'CONFIG' && /NOTIFICACAO_EMAIL_API_KEY/.test(e1.amigavel) && w1.tipo === 'CONFIG' && /NOTIFICACAO_WHATSAPP_ENDPOINT/.test(w1.amigavel) && mock.email.length === 0 && mock.wa.length === 0, [e1.message, w1.message]);
configurar(true); zerar();
const ok1 = await P.enviarEmail({ para: 'a@exemplo.test', assunto: 'Assunto', html: '<b>oi</b>', texto: 'oi', anexos: [{ nome: 'r.pdf', tipo: 'application/pdf', base64: Buffer.from('%PDF-x').toString('base64') }] });
const rq = mock.email[0];
chk('e-mail (Resend): POST com Bearer, from, to[], subject, html, text e anexo em base64 (filename/content)', rq?.headers.authorization === 'Bearer ' + CHAVE_EMAIL && rq.corpo.from === 'Painel <painel@exemplo.test>' && rq.corpo.to[0] === 'a@exemplo.test' && rq.corpo.subject === 'Assunto' && rq.corpo.html === '<b>oi</b>' && rq.corpo.attachments[0].filename === 'r.pdf' && Buffer.from(rq.corpo.attachments[0].content, 'base64').toString() === '%PDF-x' && ok1.idExterno === 'mail_1', rq);
const okw = await P.enviarWhatsApp({ para: '(81) 99999-0001', texto: 'Olá' }), rw = mock.wa[0];
chk('WhatsApp (Evolution): número normalizado, texto e cabeçalho apikey', rw?.corpo.number === '5581999990001' && rw.corpo.text === 'Olá' && rw.headers.apikey === TOKEN_WA && okw.idExterno === 'wa_1', rw);
const tenta = async (modo, canal = 'email') => { zerar(); mock[canal === 'email' ? 'emailModo' : 'waModo'] = modo; return (canal === 'email' ? P.enviarEmail({ para: 'a@exemplo.test', assunto: 'x', html: 'x' }) : P.enviarWhatsApp({ para: '81999990001', texto: 'x' })).catch(e => e); };
const e401 = await tenta('401'), e422 = await tenta('422'), e429 = await tenta('429'), e503 = await tenta('503'), w401 = await tenta('401', 'wa');
chk('erros do provedor: 401 → CONFIG · 422 → RECUSADO (com o motivo) · 429 e 5xx → TRANSITORIO (vale repetir)', e401.tipo === 'CONFIG' && e422.tipo === 'RECUSADO' && /"to" é inválido/.test(e422.amigavel) && e429.tipo === 'TRANSITORIO' && e503.tipo === 'TRANSITORIO' && e503.transitorio && !e401.transitorio && w401.tipo === 'CONFIG');
chk('SEGREDO: a chave de e-mail e o token do WhatsApp devolvidos pelo provedor no texto do erro são mascarados (***) — nunca aparecem na mensagem', !e401.amigavel.includes(CHAVE_EMAIL) && !e401.amigavel.includes(TOKEN_WA) && !w401.amigavel.includes(TOKEN_WA) && !w401.amigavel.includes(CHAVE_EMAIL) && /\*\*\*/.test(e401.amigavel), [e401.amigavel, w401.amigavel]);
mock.atraso = 400; const eto = await P.enviarEmail({ para: 'a@exemplo.test', assunto: 'x', html: 'x' }, { timeoutMs: 100 }).catch(e => e); zerar();
chk('tempo esgotado do provedor → TRANSITORIO com texto amigável', eto.tipo === 'TRANSITORIO' && /demorou demais/.test(eto.amigavel), eto.message);
const ed = await P.enviarEmail({ para: 'sem-arroba', assunto: 'x', html: 'x' }).catch(e => e), wd = await P.enviarWhatsApp({ para: '12', texto: 'x' }).catch(e => e);
chk('destino ruim (e-mail sem @, telefone curto) → DESTINO, sem chamar o provedor', ed.tipo === 'DESTINO' && wd.tipo === 'DESTINO' && mock.email.length === 0 && mock.wa.length === 0);
process.env.NOTIFICACAO_EMAIL_ENDPOINT = 'http://evil.exemplo.test/emails'; const ee = await P.enviarEmail({ para: 'a@exemplo.test', assunto: 'x', html: 'x' }).catch(e => e); process.env.NOTIFICACAO_EMAIL_ENDPOINT = 'http://127.0.0.1:8861/emails';
chk('endpoint que não é https (nem localhost) é recusado: a chave nunca viaja em texto puro', ee.tipo === 'CONFIG' && /https/.test(ee.amigavel) && mock.email.length === 0);

/* =========================================================================== 4 · PDF e mensagens */
const pdf = PDF.gerarPdf({ titulo: 'Teste', blocos: [{ t: 'h', texto: 'Seção' }, { t: 'tabela', colunas: [{ rot: 'A' }, { rot: 'B', alinhar: 'd' }], linhas: Array.from({ length: 120 }, (_, i) => [`Linha ${i} ação`, String(i)]) }] });
const txtPdf = (() => { const f = path.join(os.tmpdir(), 'notif_pdf_' + process.pid + '.pdf'); fs.writeFileSync(f, pdf); const t = execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }); fs.unlinkSync(f); return t; })();
chk('PDF: começa com %PDF, termina com %%EOF, repete o cabeçalho da tabela em cada página (120 linhas ≥ 3 páginas) e mantém os acentos', pdf.slice(0, 5).toString() === '%PDF-' && pdf.slice(-6).toString().includes('%%EOF') && /Página 1 de [3-9]/.test(txtPdf) && (txtPdf.match(/Linha 0 ação/g) || []).length === 1 && (txtPdf.match(/^\s*A\s+B\s*$/gm) || []).length >= 3 && /Linha 119 ação/.test(txtPdf), txtPdf.slice(0, 300));
const hoje0 = '2026-11-09', agora0 = T(hoje0, '08:00').getTime();
const todas = C.EVENTOS.map(e => ({ e, m: M.amostra(e.chave, { hoje: hoje0, agora: agora0 }) }));
chk('todas as 10 mensagens de exemplo têm assunto, HTML, texto e WhatsApp; só o IEO, o executivo e as saídas aprovadas levam PDF anexo (application/pdf)', todas.every(({ m }) => m.assunto && m.html.startsWith('<!doctype html>') && m.texto && m.whatsapp) && todas.filter(({ m }) => m.anexos?.length).map(({ e }) => e.chave).join() === 'ieo_regional_semanal,relatorio_matinal_executivo,saidas_aprovadas' && todas.every(({ e, m }) => e.pdf === !!m.anexos?.length), todas.map(({ e, m }) => [e.chave, !!m.anexos]));
const xss = '<script>alert(1)</script><img src=x onerror=1>';
const mx = [M.msgViagemLembrete({ nome: xss, rota: xss, ida: hoje0, volta: hoje0, limite: hoje0, dias: 1 }), M.msgViagemExcedida({ nome: xss, rota: xss, ida: hoje0, volta: hoje0, limite: hoje0, atraso: 2 }), M.msgFeriasDobra({ nome: xss, loja: xss, limite: hoje0, dias: 30, pendentes: 1 }), M.msgFaltaCaixa({ loja: xss, data: hoje0, valor: 10, caixa: xss, temBase: false, valorSemBase: 1 }), M.msgSolicitacoes({ hoje: hoje0, slaDias: 3, itens: [{ loja: xss, regional: xss, itens: xss, dataSolicitacao: hoje0, dias: 4 }] })];
chk('e-mail: texto vindo dos dados (nome, loja, rota) é escapado — nenhum <script> nem <img> crus no HTML', mx.every(m => !/<script|<img/i.test(m.html) && m.html.includes('&lt;script&gt;')), mx.map(m => /<script|<img/i.test(m.html)));
const ieoTxt = pdfTexto(todas.find(t => t.e.chave === 'ieo_regional_semanal').m.anexos[0].base64), exTxt = pdfTexto(todas.find(t => t.e.chave === 'relatorio_matinal_executivo').m.anexos[0].base64);
chk('PDF do IEO traz a regional, as lojas e as zonas; PDF executivo traz entradas por meio e por adquirente, saldo, faltas e pendências', /Gerente Exemplo/.test(ieoTxt) && /Loja Norte/.test(ieoTxt) && /Vermelha/.test(ieoTxt) && /Entradas por adquirente/.test(exTxt) && /Saldo do dia/.test(exTxt) && /Faltas de caixa/.test(exTxt) && /Pendências da Retaguarda/.test(exTxt) && /48\.250,40/.test(exTxt));

/* =========================================================================== 5 · paridade do IEO com o painel */
const html = fs.readFileSync(path.join(raiz, 'public/index.html'), 'utf8').split('\n'), i0 = html.findIndex(l => l.startsWith('const IEO_PADRAO = {')), i1 = html.findIndex((l, i) => i > i0 && l.startsWith('const IEO = {')), i2 = html.findIndex((l, i) => i > i1 && l === '};');
const salvoMatriz = { pontosIniciais: 100, faixas: { verde: 90, vermelha: 70 }, tipos: [{ id: 'falta_isolada', nome: 'Falta de caixa (numerário) isolada', pontos: -12, origem: 'faltas', ativo: true }, { id: 'customizado', nome: 'Tipo novo', pontos: -1, origem: 'manual', ativo: true }] };
const ctxVm = vm.createContext({ Repo: { get: (c, k) => (globalThis.__salvo ? salvoMatriz : null) } }); vm.runInContext(html.slice(i0, i2 + 1).join('\n') + '\nthis.IEO_PAINEL = IEO; this.IEO_PADRAO_PAINEL = IEO_PADRAO;', ctxVm);
const IP = ctxVm.IEO_PAINEL;
chk('IEO_PADRAO do servidor é idêntico ao do painel (public/index.html)', JSON.stringify(IEOS.IEO_PADRAO) === JSON.stringify(ctxVm.IEO_PADRAO_PAINEL));
let semente = 7; const rnd = () => (semente = (semente * 1664525 + 1013904223) % 4294967296) / 4294967296;
const lojasP = Array.from({ length: 9 }, (_, i) => ({ id: 'l' + i, codigo: '' + (100 + i), nome: 'LOJA ' + i, ativa: i !== 8 }));
const gerarCaso = () => {
  const dia = () => '2026-11-' + String(1 + Math.floor(rnd() * 9)).padStart(2, '0'), pick = a => a[Math.floor(rnd() * a.length)], tipos = IEOS.IEO_PADRAO.tipos;
  const faltas = Array.from({ length: 25 }, () => ({ lojaId: pick(lojasP).id, data: dia(), tipo: pick(['Falta', 'Falta', 'Sobra']), status: pick(['Em análise', 'Abonada', 'Em análise']), valor: Math.round(rnd() * 20000) / 100, justificativa: pick(['', 'ok']), caixa: { id: pick(['c1', 'c2', 'c3']), nome: 'CAIXA' } }));
  const credsystem = Array.from({ length: 14 }, () => ({ lojaId: pick(lojasP).id, data: dia(), st: pick(['ok', 'div', 'pend']), dif: Math.round(rnd() * 5000) / 100 }));
  const ocorrencias = Array.from({ length: 6 }, () => ({ lojaId: pick(lojasP).id, data: dia(), tipoId: pick(['erro_pix', 'falta_isolada']), descricao: 'x' }));
  const extras = Array.from({ length: 8 }, () => ({ lojaId: pick(lojasP).id, origem: pick(tipos.map(t => t.origem)), data: dia(), detalhe: 'x', ref: 'r' + Math.floor(rnd() * 99), ...(rnd() > 0.7 ? { fator: 0.5 } : {}) }));
  return { mes: '2026-11', lojas: lojasP.filter(l => l.ativa), faltas, credsystem, ocorrencias, extras, hoje: '2026-11-10' };
};
let iguais = 0; for (let k = 0; k < 40; k++) { const c = gerarCaso(); if (JSON.stringify(IEOS.IEO.calcular({ ...c, matriz: IEOS.IEO.matriz() })) === JSON.stringify(IP.calcular({ ...c, matriz: IP.matriz() }))) iguais++; }
chk('IEO.calcular do servidor = do painel em 40 casos aleatórios (pontuação, zona, posição, deduções, resumo — JSON idêntico)', iguais === 40, iguais);
globalThis.__salvo = true; const mS = IEOS.IEO.matriz(salvoMatriz), mP = IP.matriz();
chk('matriz salva (config/ieo): tipos novos do padrão são acrescentados e os salvos prevalecem — servidor = painel', JSON.stringify(mS) === JSON.stringify(mP) && mS.tipos.some(t => t.id === 'customizado') && mS.tipos.find(t => t.id === 'falta_isolada').pontos === -12 && mS.tipos.some(t => t.id === 'registro_vendas') && IEOS.IEO.zona(80, mS) === IP.zona(80, mP)); globalThis.__salvo = false;

/* =========================================================================== 6 · dados e regras de cada evento (funções puras) */
const brt1 = D.agoraBRT(new Date('2026-11-09T11:00:00Z')), brt2 = D.agoraBRT(new Date('2026-11-10T02:30:00Z')), brt3 = D.agoraBRT(new Date('2026-11-09T02:59:00Z'));
chk('agoraBRT: 11:00Z = segunda 08:00 em Brasília; 02:30Z = 23:30 do dia anterior (domingo→segunda não vaza para UTC)', brt1.iso === '2026-11-09' && brt1.hora === '08:00' && brt1.dow === 1 && brt2.iso === '2026-11-09' && brt2.hora === '23:30' && brt3.iso === '2026-11-08' && brt3.dow === 0 && brt3.hora === '23:59', [brt1, brt2, brt3]);
chk('prazoData: dias úteis (seg–sex) depois da volta — sexta+1 = segunda; quinta+3 = terça', D.prazoData('2026-11-06', 1) === '2026-11-09' && D.prazoData('2026-11-05', 3) === '2026-11-10' && D.somarDias('2026-12-31', 1) === '2027-01-01' && D.diasEntre('2026-11-09', '2026-12-09') === 30);
chk('nomeConfere = regra do painel: "ANA SOUZA" confere com "ANA PAULA SOUZA"; um nome só só confere se for idêntico; acentos e caixa não importam', D.nomeConfere('Ana Souza', 'ANA PAULA SOUZA') && !D.nomeConfere('ANA', 'ANA PAULA SOUZA') && D.nomeConfere('JOSÉ', 'jose') && !D.nomeConfere('ANA LIMA', 'ANA PAULA SOUZA'));
const F = (extra = {}) => ({ id: 'x', nome: 'N', status: 'Ativo', ...extra });
chk('limiteFerias (CLT): admissão 2025-01-09 → limite 2027-01-08 (60 dias em 09/11/2026); admissão 2024-12-10 → 2026-12-09 (30 dias); com 1 período gozado o limite avança 1 ano (2023-12-10 → 30 dias); sem período vencido ou sem admissão = null', D.limiteFerias(F({ admissao: '2025-01-09' }), hoje0).dias === 60 && D.limiteFerias(F({ admissao: '2024-12-10' }), hoje0).dias === 30 && D.limiteFerias(F({ admissao: '2024-12-10', ferias: { periodosGozados: 1 } }), hoje0) === null && D.limiteFerias(F({ admissao: '2023-12-10', ferias: { periodosGozados: 1 } }), hoje0).dias === 30 && D.limiteFerias(F({ admissao: '2026-03-01' }), hoje0) === null && D.limiteFerias(F({}), hoje0) === null);
chk('feriasDobra só pega EXATAMENTE 60 e 30 dias antes e ignora desligados; feriasComecando = programadas que começam em 5 dias (período múltiplo ou o principal)', D.feriasDobra({ funcionarios: [F({ id: 'a', admissao: '2025-01-09' }), F({ id: 'b', admissao: '2024-12-10' }), F({ id: 'c', admissao: '2025-01-10' }), F({ id: 'd', admissao: '2025-01-09', status: 'Desligado' })], hoje: hoje0 }).map(x => x.f.id).join() === 'a,b'
  && D.feriasComecando({ funcionarios: [F({ id: 'a', ferias: { periodos: [{ inicio: '2026-11-14', fim: '2026-11-28' }] } }), F({ id: 'b', ferias: { programadaInicio: '2026-11-14', programadaFim: '2026-11-20' } }), F({ id: 'c', ferias: { programadaInicio: '2026-11-15', programadaFim: '2026-11-20' } })], hoje: hoje0 }).map(x => x.f.id).join() === 'a,b');
const loj = [{ id: 'loja-t1', codigo: '101', nome: 'LOJA UM', ativa: true, supervisor: 'ANA SOUZA' }, { id: 'loja-t2', codigo: '102', nome: 'LOJA DOIS', ativa: true, supervisor: 'ANA SOUZA' }];
const sol = D.solicitacoesAcimaSla({ hoje: hoje0, lojas: loj, slaDias: 3, solicitacoes: [{ id: 'a', lojaId: 'loja-t1', dataSolicitacao: '2026-11-02', itens: { bobinas: 4 } }, { id: 'b', lojaId: 'loja-t1', dataSolicitacao: '2026-11-06', itens: { pos: 1 } }, { id: 'c', lojaId: 'loja-t2', dataSolicitacao: '2026-11-01', dataAtendimento: '2026-11-03', itens: { pos: 1 } }, { id: 'd', lojaId: 'loja-t2', dataSolicitacao: '2026-11-04', emAndamento: true, itens: { pinpad: 2 } }] });
chk('solicitações acima do SLA: só pendentes (sem atendimento) com MAIS de 3 dias; 3 dias exatos não entra; ordenadas da mais antiga; itens com nome e quantidade', sol.map(s => s.id).join() === 'a,d' && sol[0].dias === 7 && sol[0].itens === 'Bobinas de Impressão (4)' && sol[1].andamento && sol[1].regional === 'ANA SOUZA', sol);
const fcx = (valor, extra = {}) => ({ id: 'i' + valor + (extra.data || ''), data: '2026-11-08', tipo: 'Falta', valor, caixa: { nome: 'C1' }, status: 'Em análise', ...extra });
const flt = D.faltasAcimaTolerancia({ hoje: hoje0, lojas: loj, toleranciaPct: 10, valorSemBase: 100, janelaDias: 7,
  credsystemDocs: [{ id: '2026-11-08', linhas: [{ lojaId: 'loja-t1', din: 1000 }] }],
  faltasDocs: [{ id: 'loja-t1', lojaId: 'loja-t1', itens: [fcx(150), fcx(100), fcx(100.01), fcx(500, { tipo: 'Sobra' }), fcx(500, { status: 'Abonada' }), fcx(500, { data: '2026-10-20' })] }, { id: 'loja-t2', lojaId: 'loja-t2', itens: [fcx(120), fcx(90)] }] });
chk('falta acima da tolerância: > 10% do dinheiro do dia (10% exato NÃO alerta; 10,001% alerta); sem venda do dia compara com o valor mínimo; sobra, abonada e falta antiga ficam de fora', flt.map(f => f.valor).sort((a, b) => a - b).join() === '100.01,120,150' && flt.find(f => f.valor === 150).pct === 15 && flt.find(f => f.valor === 120).temBase === false, flt);
const rf = D.resumoFaltas({ lojas: loj, ontem: '2026-11-08', mes: '2026-11', faltasDocs: [{ lojaId: 'loja-t1', itens: [fcx(150), fcx(50, { justificativa: 'ok' }), fcx(30, { data: '2026-11-03' }), fcx(500, { tipo: 'Sobra' })] }] });
chk('resumo de faltas: ontem e mês (sem sobras/abonadas), faltas sem justificativa e a lista de ontem com o nome da loja', rf.ontem.n === 2 && rf.ontem.total === 200 && rf.mes.n === 3 && rf.mes.total === 230 && rf.semJustificativa === 2 && rf.itensOntem[0].loja === '101 · LOJA UM' && rf.itensOntem[0].valor === 150, rf);
const mz = IEOS.IEO.matriz(), pr = D.pendenciasRetaguarda({ hoje: hoje0, agora: T(hoje0, '08:00').getTime(), matriz: mz,
  cofre: [{ id: 'c1', dataSolicitacao: '2026-11-05' }, { id: 'c2', dataSolicitacao: '2026-11-08' }, { id: 'c3', dataSolicitacao: '2026-11-01', dataRetorno: '2026-11-02', valorInformado: 100, valorSistema: 90 }, { id: 'c4', origem: 'falta', dataSolicitacao: '2026-11-01' }],
  feed: [{ id: 'o1', tipo: 'credito', aberturaEm: '2026-11-07T10:00:00-03:00' }, { id: 'o2', tipo: 'credito', aberturaEm: '2026-11-09T07:00:00-03:00' }, { id: 'o3', tipo: 'credito', aberturaEm: '2026-11-01T10:00:00-03:00', resolvidoEm: '2026-11-02T10:00:00-03:00' }, { id: 'o4', tipo: 'registro_vendas' }, { id: 'o5', tipo: 'registro_vendas', regularizadoEm: '2026-11-08' }, { id: 'o6', tipo: 'dvc', dataDevolucao: '2026-11-08' }, { id: 'o7', tipo: 'dvc', dataDevolucao: '2026-11-08', termoAnexado: true }],
  dep: [{ id: 'd1', situacao: 'nao' }, { id: 'd2', situacao: 'parcial' }, { id: 'd3', situacao: 'sim' }, { id: 'd4', conforme: false }] });
chk('pendências da Retaguarda: Conta Cofre sem retorno no prazo (2 dias) e devolvida com divergência; créditos abertos e além de 24 h; registro de vendas e DVC sem termo; depósitos não/parcial — e o total sem contar duas vezes', pr.cofreSemRetorno === 1 && pr.cofreAtrasadaDivergente === 1 && pr.creditosAbertos === 2 && pr.creditosVencidos === 1 && pr.vendasPendentes === 1 && pr.dvcSemTermo === 1 && pr.depositosNao === 3 && pr.total === 1 + 1 + 2 + 1 + 3 + 1, pr);
const dv = D.divergenciasCredsystem({ dia: '2026-11-08', credsystemDocs: [{ id: '2026-11-08', linhas: [{ lojaId: 'a', web: 100, din: 100 }, { lojaId: 'b', web: 100, din: 90 }, { lojaId: 'c', web: 50, din: 49.97 }, { lojaId: 'd', web: 30 }] }] });
chk('divergências da Credsystem do dia: diferença > R$ 0,05 conta; sem lançamento interno não é divergência; dia não importado → temDia = false', dv.temDia && dv.n === 1 && dv.abs === 10 && D.divergenciasCredsystem({ dia: '2026-11-07', credsystemDocs: [] }).temDia === false, dv);
const snapOk = D.sanearSnapshotRecebivel({ d: '2026-11-09', em: '2026-11-09T10:00:00Z', entradas: '1234.567', saldo: null, meios: [{ rot: 'Dinheiro', vendas: 10, prestacao: 'x', total: 10, lixo: 1 }], adquirentes: Array.from({ length: 40 }, (_, i) => ({ rot: 'A' + i, total: i })), porConta: [['Forn', 100, 2]], avisos: ['<b>x</b>'], carga: { ok: 1, dia: 'ruim', arquivo: 'a.csv' }, extra: 'drop' });
chk('snapshot do recebível: números arredondados, campos desconhecidos descartados, listas limitadas, datas inválidas viram vazio; objeto sem data é recusado', snapOk.entradas === 1234.57 && snapOk.saldo === null && snapOk.meios[0].prestacao === null && !('lixo' in snapOk.meios[0]) && snapOk.adquirentes.length === 24 && snapOk.porConta[0].rot === 'Forn' && snapOk.carga.dia === '' && !('extra' in snapOk) && D.sanearSnapshotRecebivel({ entradas: 1 }) === null && D.sanearSnapshotRecebivel('x') === null, snapOk);

/* =========================================================================== 7 · motor agendado (banco) */
const S = { usr: 'usr-n1' };
const funcs = {
  'f-ana': { nome: 'ANA PAULA SOUZA', email: 'ana@exemplo.test', telefone: '81 99999-0001', status: 'Ativo', cargoId: 'cg-sup', lotacao: 'loja-sede' },
  'f-carlos': { nome: 'CARLOS ALBERTO LIMA', email: 'carlos@exemplo.test', telefone: '', status: 'Ativo', cargoId: 'cg-sup', lotacao: 'loja-sede' },
  'f-dora': { nome: 'DORA GERENTE DA SILVA', email: 'dora@exemplo.test', telefone: '81 99999-0003', status: 'Ativo', cargoId: 'cg-ger', lotacao: 'loja-t1', admissao: '2020-02-01' },
  'f-beto': { nome: 'BETO COLABORADOR SILVA', email: 'beto@exemplo.test', telefone: '81 99999-0002', status: 'Ativo', cargoId: 'cg-vend', lotacao: 'loja-t1', admissao: '2025-01-09' },
  'f-caio': { nome: 'CAIO SEM CONTATO', email: '', telefone: '', status: 'Ativo', cargoId: 'cg-vend', lotacao: 'loja-t2', admissao: '2024-12-10' },
  'f-eva': { nome: 'EVA EM FERIAS', email: 'eva@exemplo.test', telefone: '81 99999-0004', status: 'Ativo', cargoId: 'cg-vend', lotacao: 'loja-t1', admissao: '2023-03-01', ferias: { periodosGozados: 2, periodos: [{ inicio: '2026-11-14', fim: '2026-11-28' }] } },
  'f-xss': { nome: '<b>NOME XSS</b>', email: 'xss@exemplo.test', telefone: '', status: 'Ativo', cargoId: 'cg-vend', lotacao: 'loja-t2' },
};
const preparar = async () => {
  for (const t of ['documentos']) await sql(`DELETE FROM ${t} WHERE colecao IN ('funcionarios','funcionarios/_viagens/pedidos','funcionarios/_viagens/parametros','lojas','solicitacoes','faltas','credsystem','rh_cargos','ieo_ocorrencias','ieo_fechamentos','ret_cofre','ieo_auto','ret_depositos','config')`);
  await sql('DELETE FROM painel_backups_historico'); await sql('DELETE FROM painel_notificacoes_instantaneo');
  for (const [id, d] of Object.entries(funcs)) await doc('funcionarios/' + id, d);
  for (const [id, nome] of [['cg-sup', 'Supervisor Regional'], ['cg-ger', 'Gerente de Loja'], ['cg-vend', 'Vendedor']]) await doc('rh_cargos/' + id, { nome });
  await doc('lojas/loja-t1', { codigo: '101', nome: 'LOJA UM', ativa: true, supervisor: 'ANA SOUZA', cidade: 'Recife' });
  await doc('lojas/loja-t2', { codigo: '102', nome: 'LOJA DOIS', ativa: true, supervisor: 'ANA SOUZA', cidade: 'Olinda' });
  await doc('lojas/loja-t3', { codigo: '103', nome: 'LOJA TRES', ativa: true, supervisor: 'CARLOS LIMA', cidade: 'Caruaru' });
  await doc('lojas/loja-t4', { codigo: '104', nome: 'LOJA QUATRO', ativa: true, supervisor: 'DIANA INEXISTENTE', cidade: 'Garanhuns' });
  await doc('lojas/loja-t5', { codigo: '105', nome: 'LOJA INATIVA', ativa: false, supervisor: 'ANA SOUZA' });
  await doc('config/recursos', { gestao_v1400: { ativo: true } });
  await doc('funcionarios/_viagens/parametros/diarias', { prazoPrestacao: 3, alimentacao: 80, deslocamento: 30, hospedagemMedia: 200, tolTipo: '%', tolValor: 10 });
  const v = (id, volta, extra = {}) => doc('funcionarios/_viagens/pedidos/' + id, { status: 'aguardando_prestacao', funcionarioId: 'f-beto', nome: 'BETO COLABORADOR SILVA', origem: 'Recife', destino: 'Caruaru', ida: D.somarDias(volta, -2), volta, valorPago: 350, ...extra });
  await v('v1', '2026-11-05');                                   // prazo 10/11 → falta 1 dia (lembrete)
  await v('v2', '2026-11-03', { funcionarioId: 'f-caio', nome: 'CAIO SEM CONTATO' });  // prazo 06/11 → 3 dias de atraso (alerta)
  await v('v3', '2026-10-20', { funcionarioId: 'f-ana', nome: 'ANA PAULA SOUZA' });    // 17 dias de atraso (histórico: sem alerta ao colaborador; entra no resumo da Tesouraria)
  await v('v4', '2026-11-06', { politica: { prazoDiasUteis: 3 } });                   // prazo 11/11 → falta 2 (fora de 3,1)
  await v('v5', '2026-10-20', { status: 'concluido' });                                // concluída: ignorada
  await doc('solicitacoes/s1', { lojaId: 'loja-t1', dataSolicitacao: '2026-11-02', itens: { bobinas: 4 }, solicitante: { nome: 'Fulano' } });
  await doc('solicitacoes/s2', { lojaId: 'loja-t2', dataSolicitacao: '2026-11-04', itens: { pinpad: 1 }, emAndamento: true });
  await doc('solicitacoes/s3', { lojaId: 'loja-t2', dataSolicitacao: '2026-11-06', itens: { pos: 1 } });
  await doc('faltas/loja-t1', { lojaId: 'loja-t1', itens: [fcx(150, { id: 'ft1' }), fcx(100, { id: 'ft2' }), fcx(500, { id: 'ft3', tipo: 'Sobra' })] });
  await doc('faltas/loja-t2', { lojaId: 'loja-t2', itens: [fcx(120, { id: 'ft5' }), fcx(90, { id: 'ft6' }), fcx(75, { id: 'ft7', data: '2026-11-07' })] });
  await doc('credsystem/2026-11-08', { linhas: [{ lojaId: 'loja-t1', din: 1000, web: 1000 }] });
  await sql(`INSERT INTO painel_backups_historico (tipo_backup, payload_json, total_registros, versao_painel, tamanho_bytes, data_hora) VALUES ('AUTOMATICO', '{}'::jsonb, 4321, 'v14.00', 204800, $1)`, [T('2026-11-08', '23:59')]);
  await limparLog(); await N.garantirRegras(); await desligarTudo();
};
await preparar();

let r0 = await N.estadoCentral();
chk('primeira abertura: as 10 regras nascem DESLIGADAS, sem destinatários, com os padrões do catálogo; chamar de novo não duplica', r0.eventos.length === 10 && r0.eventos.every(e => e.regra.ativo === false && e.regra.destinatarios.length === 0) && (await sql('SELECT count(*)::int n FROM painel_notificacoes_regras'))[0].n === 10 && (await N.garantirRegras(), (await sql('SELECT count(*)::int n FROM painel_notificacoes_regras'))[0].n === 10));
let r1 = await rodar('2026-11-09', '08:05');
chk('com tudo desligado a rodada não envia nada nem grava log (mesmo dentro da janela de vários eventos)', r1.eventos.length === 0 && mock.email.length === 0 && mock.wa.length === 0 && (await logs()).length === 0, r1);
await sql(`UPDATE documentos SET dados = '{"gestao_v1400":{"ativo":false}}'::jsonb WHERE caminho = 'config/recursos'`);
await regra('relatorio_matinal_executivo', { ativo: true, destinatarios: [{ papel: 'diretoria', nome: 'Diretoria', email: 'dir@exemplo.test' }] });
let rg = await rodar('2026-11-09', '07:40');
chk('recurso gestao_v1400 DESLIGADO (Produção/Falco antes da liberação): a rotina não faz nada — nem com o evento ligado', rg.inativo === true && mock.email.length === 0 && (await logs()).length === 0, rg);
process.env.PAINEL_AMBIENTE = 'homolog'; rg = await rodar('2026-11-09', '07:40'); const lgH = await logs();
chk('em Homologação o recurso é sempre ativo; os envios levam o prefixo [Homologação] no assunto e no WhatsApp', !rg.inativo && lgH.length >= 1 && lgH.every(l => l.status === 'SUCESSO') && /^\[Homologação\] Relatório matinal/.test(lgH[0].titulo) && mock.email[0].corpo.subject.startsWith('[Homologação] '), [rg, lgH.map(l => l.titulo)]);
delete process.env.PAINEL_AMBIENTE; await sql(`UPDATE documentos SET dados = '{"gestao_v1400":{"ativo":true}}'::jsonb WHERE caminho = 'config/recursos'`); await limparLog(); await desligarTudo(); zerar();

/* ---- 7.1 · lembrete de prestação de contas (09:00) ---- */
await regra('viagem_lembrete_prestacao', { ativo: true, canal: 'AMBOS', destinatarios: [{ papel: 'copia', nome: 'Gerente Copia', email: 'copia@exemplo.test', telefone: '81 98888-0000' }] });
chk('antes do horário (08:59 para 09:00) e depois da janela de 3 h (12:00) o evento não roda', (await rodar('2026-11-09', '08:59')).eventos.length === 0 && (await rodar('2026-11-09', '12:00')).eventos.length === 0 && mock.email.length === 0);
let t1 = await rodar('2026-11-09', '09:05'), lg1 = await logs();
const doBeto = lg1.filter(l => l.referencia?.startsWith('viagem:v1:lembrete:1:f-beto'));
chk('dentro da janela: o colaborador da viagem a 1 dia do prazo recebe e-mail E WhatsApp; a de 2 dias (v4) e a já vencida (v2) não recebem lembrete; concluída é ignorada', doBeto.filter(l => l.destinatario === 'beto@exemplo.test').length === 1 && doBeto.filter(l => l.destinatario === '5581999990002').length === 1 && !lg1.some(l => /^viagem:v[245]:lembrete/.test(l.referencia)), lg1.map(l => [l.referencia, l.destinatario]));
chk('a cópia (Gerente Copia) recebe a versão "Cópia do aviso enviado ao colaborador…" por e-mail e WhatsApp; o colaborador recebe o texto pessoal ("Olá, BETO!")', lg1.filter(l => l.destinatario === 'copia@exemplo.test').length === 1 && /Cópia do aviso enviado ao colaborador/.test(lg1.find(l => l.destinatario === 'copia@exemplo.test').payload_mensagem.html) && /Olá, BETO!/.test(doBeto.find(l => l.destinatario === 'beto@exemplo.test').payload_mensagem.html) && /\[Cópia\]/.test(lg1.find(l => l.destinatario === 'copia@exemplo.test').titulo));
chk('resultado: 4 envios com sucesso (2 do colaborador + 2 da cópia) e a rodada fica registrada como concluída ("4 enviada(s)")', lg1.length === 4 && lg1.every(l => l.status === 'SUCESSO') && mock.email.length === 2 && mock.wa.length === 2 && (await N.lerRegras()).find(r => r.chave === 'viagem_lembrete_prestacao').ultimaRodadaResumo === '4 enviada(s)');
const antes = lg1.length; await rodar('2026-11-09', '09:10'); await rodar('2026-11-09', '10:30');
chk('idempotente: nas rodadas seguintes da mesma janela nada é reenviado', (await logs()).length === antes && mock.email.length === 2);
await semRodada(); await rodar('2026-11-09', '09:15');
chk('idempotente também sem o marcador de rodada (o log de referências impede o duplo envio)', (await logs()).length === antes && mock.email.length === 2);
await rodar('2026-11-10', '09:00'); const lgDia2 = await logs();
chk('no dia seguinte a viagem v1 (agora no dia do prazo, dias = 0) NÃO dispara lembrete (só 3 e 1 dia antes) e só a v4 (a 1 dia do prazo) é avisada', !lgDia2.some(l => /^viagem:v1:lembrete:0/.test(l.referencia)) && lgDia2.slice(antes).length === 4 && lgDia2.slice(antes).every(l => /^viagem:v4:lembrete:1:f-beto/.test(l.referencia)), lgDia2.slice(antes).map(l => l.referencia));
await regra('viagem_lembrete_prestacao', { parametros: { diasAntes: '3, 1, 0' } }); await rodar('2026-11-10', '09:05'); const lgDia2b = await logs();
chk('parâmetro editável: com "3, 1, 0" o aviso do próprio dia do prazo sai (v1: uma vez por canal, para o colaborador e para a cópia)', lgDia2b.filter(l => /^viagem:v1:lembrete:0:/.test(l.referencia)).length === 4, lgDia2b.map(l => l.referencia));
await limparLog(); await desligarTudo(); zerar();

/* ---- 7.2 · prazo excedido (08:00): colaborador + resumo da Tesouraria ---- */
await regra('viagem_prazo_excedido', { ativo: true, canal: 'AMBOS', destinatarios: [{ papel: 'tesouraria', nome: 'Tesouraria', email: 'tesouraria@exemplo.test', telefone: '81 97777-0000' }] });
await rodar('2026-11-09', '08:00'); let lg2 = await logs();
const cai = lg2.filter(l => /^viagem:v2:excedida/.test(l.referencia)), tes = lg2.filter(l => /^viagens:excedidas/.test(l.referencia));
chk('"PRAZO EXCEDIDO - PRESTAÇÃO PENDENTE": quem passou há até 3 dias é avisado (v2); o histórico antigo (v3, 17 dias) NÃO recebe alerta ao ligar o evento', cai.length >= 1 && !lg2.some(l => /^viagem:v3:excedida/.test(l.referencia)) && cai.every(l => /URGENTE|PRAZO EXCEDIDO/.test(l.titulo + JSON.stringify(l.payload_mensagem))), lg2.map(l => [l.referencia, l.destinatario, l.status]));
chk('o colaborador SEM e-mail nem telefone (Caio) vira um ERRO amigável de destino no log — nada trava', cai.length === 1 && cai[0].status === 'ERRO' && /não tem e-mail cadastrado/.test(cai[0].detalhe_erro) && cai[0].payload_mensagem.meta.erroTipo === 'DESTINO' && cai[0].payload_mensagem.meta.transitorio === false, cai);
const resumoRows = tes.filter(l => l.canal === 'EMAIL'), idsMeta = resumoRows[0]?.payload_mensagem.meta.ids || [];
chk('resumo para a Tesouraria (e-mail e WhatsApp): lista as duas viagens em atraso (v2 e v3) e guarda os ids avisados', tes.length === 2 && tes.every(l => l.status === 'SUCESSO') && idsMeta.sort().join() === 'v2,v3' && /Prestações de contas com prazo excedido/.test(resumoRows[0].titulo + resumoRows[0].payload_mensagem.html) && mock.wa.some(w => /2 viagens novas/.test(w.corpo.text)), tes.map(l => [l.canal, l.status]));
const n2 = (await logs()).length; await semRodada(); await rodar('2026-11-10', '08:00'); const lg2b = await logs();
chk('no dia seguinte (v2 já avisada e v3 já resumida) nenhum e-mail novo: o resumo só sai quando há viagem NOVA em atraso', lg2b.length === n2, lg2b.slice(n2).map(l => l.referencia));
await doc('funcionarios/_viagens/pedidos/v6', { status: 'aguardando_prestacao', funcionarioId: 'f-beto', nome: 'BETO COLABORADOR SILVA', origem: 'Recife', destino: 'Natal', ida: '2026-11-03', volta: '2026-11-05', valorPago: 500, politica: { prazoDiasUteis: 2 } });   // prazo 09/11 → vence hoje (dia 10: 1 dia de atraso)
await semRodada(); await rodar('2026-11-11', '08:00'); const lg2c = await logs();
const tes3 = lg2c.slice(n2).filter(l => /^viagens:excedidas/.test(l.referencia));
chk('viagens que passaram a estar em atraso (v1 venceu em 10/11; v6 em 09/11) → novo resumo SÓ com elas e novo alerta ao colaborador; as antigas (v2, v3) não repetem', tes3.length === 2 && tes3[0].payload_mensagem.meta.ids.slice().sort().join() === 'v1,v6' && lg2c.slice(n2).some(l => /^viagem:v6:excedida:f-beto:0/.test(l.referencia)) && lg2c.slice(n2).some(l => /^viagem:v1:excedida:f-beto:0/.test(l.referencia)) && !lg2c.slice(n2).some(l => /^viagem:v[23]:/.test(l.referencia)), lg2c.slice(n2).map(l => l.referencia));
await regra('viagem_prazo_excedido', { parametros: { repetirACadaDias: 2 } }); await semRodada(); const n3 = (await logs()).length; await rodar('2026-11-12', '08:00'); const lg2d = (await logs()).slice(n3);
chk('"repetir a cada 2 dias": a v2 (atraso 6 dias) e a v3 voltam a ser avisadas com referência nova; sem repetir no mesmo balde', lg2d.some(l => /^viagem:v2:excedida:f-caio:2$/.test(l.referencia)) && lg2d.some(l => /^viagem:v3:excedida:f-ana:\d+$/.test(l.referencia)), lg2d.map(l => l.referencia));
await limparLog(); await desligarTudo(); zerar();

/* ---- 7.3 · IEO semanal por Gerente Regional (segunda 08:00) ---- */
await doc('faltas/loja-t2', { lojaId: 'loja-t2', itens: [fcx(120, { id: 'ft5' }), fcx(90, { id: 'ft6', data: '2026-11-03' }), fcx(75, { id: 'ft7', data: '2026-11-04' })] });
await regra('ieo_regional_semanal', { ativo: true, canal: 'AMBOS', destinatarios: [{ papel: 'copia', nome: 'Diretoria Copia', email: 'diretoria@exemplo.test' }] });
chk('o IEO não roda fora da segunda-feira (terça 08:00) nem antes da hora (segunda 07:59)', (await rodar('2026-11-10', '08:00')).eventos.length === 0 && (await rodar('2026-11-09', '07:59')).eventos.length === 0 && mock.email.length === 0);
await rodar('2026-11-09', '08:00'); const lg3 = await logs(), emIeo = lg3.filter(l => l.canal === 'EMAIL'), pdfs = mock.email.map(m => ({ para: m.corpo.to[0], anexo: m.corpo.attachments?.[0] }));
const dest = e => pdfs.find(p => p.para === e);
chk('cada regional recebe o SEU relatório: Ana (lojas 101 e 102) e Carlos (loja 103) por e-mail com PDF A4 em anexo; a cópia recebe os três (inclusive o da regional sem cadastro, para as lojas dela não ficarem sem relatório)', dest('ana@exemplo.test') && dest('carlos@exemplo.test') && pdfs.filter(p => p.para === 'diretoria@exemplo.test').length === 3 && pdfs.every(p => p.anexo && /^IEO_.+_2026-11\.pdf$/.test(p.anexo.filename) && Buffer.from(p.anexo.content, 'base64').slice(0, 5).toString() === '%PDF-'), pdfs.map(p => [p.para, p.anexo?.filename]));
const txA = pdfTexto(dest('ana@exemplo.test').anexo.content), txC = pdfTexto(dest('carlos@exemplo.test').anexo.content);
chk('EXCLUSIVAMENTE as lojas da regional: o PDF da Ana traz 101 e 102 e NÃO traz 103/104/105; o do Carlos traz só a 103', /LOJA UM/.test(txA) && /LOJA DOIS/.test(txA) && !/LOJA TRES|LOJA QUATRO|LOJA INATIVA/.test(txA) && /LOJA TRES/.test(txC) && !/LOJA UM|LOJA DOIS/.test(txC), [txA.slice(0, 400)]);
const htmlA = mock.email.find(m => m.corpo.to[0] === 'ana@exemplo.test').corpo.html;
chk('o corpo do e-mail e o texto do WhatsApp da Ana também só citam as lojas dela', /LOJA UM/.test(htmlA) && !/LOJA TRES/.test(htmlA) && mock.wa.length === 1 && /IEO · ANA SOUZA/.test(mock.wa[0].corpo.text) && !/103|LOJA TRES/.test(mock.wa[0].corpo.text), mock.wa.map(w => w.corpo.text));
chk('Carlos só tem e-mail cadastrado: com o canal AMBOS ele recebe o e-mail e NÃO gera erro de WhatsApp; Ana (com telefone) recebe os dois', !lg3.some(l => l.destinatario.includes('Carlos') || (l.canal === 'WHATSAPP' && l.payload_mensagem.nome === 'CARLOS ALBERTO LIMA')) && lg3.filter(l => l.payload_mensagem.nome === 'ANA PAULA SOUZA').length === 2);
const falhaDiana = lg3.filter(l => l.status === 'ERRO');
chk('regional sem cadastro de colaborador ("DIANA INEXISTENTE") vira UM aviso amigável no log (não some em silêncio) e nada mais falha', falhaDiana.length === 1 && /DIANA INEXISTENTE.*não foi encontrado no cadastro/.test(falhaDiana[0].detalhe_erro) && falhaDiana[0].payload_mensagem.meta.erroTipo === 'DESTINO', falhaDiana);
chk('o ranking respeita a pontuação do IEO: a loja 102 (3 faltas no mês) aparece com menos pontos que a 101 na tabela da Ana', (() => { const a = txA.indexOf('LOJA UM'), b = txA.indexOf('LOJA DOIS'); return a > -1 && b > a; })(), txA.slice(0, 600));
const nIeo = (await logs()).length, nMailIeo = mock.email.length; await semRodada(); await rodar('2026-11-09', '08:30'); chk('segunda rodada na mesma segunda-feira: nada duplicado (idempotente)', (await logs()).length === nIeo && mock.email.length === nMailIeo && nMailIeo === 5);
await limparLog(); await desligarTudo(); zerar(); await semRodada();
await doc('ieo_fechamentos/2026-11', { ranking: [{ lojaId: 'loja-t1', codigo: '101', nome: 'LOJA UM', pontos: 91, zona: 'verde', posicao: 1, deducoes: [], resumo: {} }, { lojaId: 'loja-t2', codigo: '102', nome: 'LOJA DOIS', pontos: 40, zona: 'vermelha', posicao: 2, deducoes: [], resumo: {} }, { lojaId: 'loja-t3', codigo: '103', nome: 'LOJA TRES', pontos: 70, zona: 'amarela', posicao: 3, deducoes: [], resumo: {} }] });
await regra('ieo_regional_semanal', { ativo: true, canal: 'EMAIL' }); await rodar('2026-12-07', '08:10');
const txD = pdfTexto(mock.email.find(m => m.corpo.to[0] === 'ana@exemplo.test').corpo.attachments[0].content);
chk('no começo do mês (até o dia 7) o relatório também traz o FECHAMENTO do mês anterior, usando o fechamento congelado (ieo_fechamentos) — a loja 102 aparece com 40 pontos / zona vermelha', /Fechamento de novembro de 2026/.test(txD) && /40,0\s+Vermelha/.test(txD) && /dezembro de 2026/.test(txD), txD.slice(0, 700));
await limparLog(); await desligarTudo(); zerar(); await sql(`DELETE FROM documentos WHERE colecao = 'ieo_fechamentos'`);

/* ---- 7.4 · solicitações acima do SLA (08:30) ---- */
await regra('solicitacoes_sla_manha', { ativo: true, canal: 'AMBOS', destinatarios: [{ papel: 'gestores', nome: 'Gestor de Controle', email: 'gestor@exemplo.test', telefone: '81 96666-0000' }] });
await rodar('2026-11-09', '08:30'); const lg4 = await logs(), h4 = mock.email[0]?.corpo.html || '';
chk('resumo matinal das solicitações pendentes acima do SLA (3 dias): s1 (7 dias) e s2 (5 dias, em andamento) entram; s3 (3 dias exatos) não; e-mail e WhatsApp para o gestor', lg4.length === 2 && lg4.every(l => l.status === 'SUCESSO') && /Bobinas de Impressão \(4\)/.test(h4) && /Pinpad/.test(h4) && !/POS/.test(h4.replace(/Pinpad/g, '')) && /Em andamento/.test(h4) && /2 pendentes/.test(mock.wa[0].corpo.text), [h4.slice(0, 200), mock.wa[0]?.corpo.text]);
await limparLog(); zerar(); await semRodada(); await sql(`UPDATE documentos SET dados = dados || '{"dataAtendimento":"2026-11-08"}'::jsonb WHERE colecao = 'solicitacoes'`); await rodar('2026-11-10', '08:30');
chk('sem solicitação acima do SLA não envia nada e a rodada fica como "Nada a avisar"', mock.email.length === 0 && (await N.lerRegras()).find(r => r.chave === 'solicitacoes_sla_manha').ultimaRodadaResumo === 'Nada a avisar');
await sql(`UPDATE documentos SET dados = dados - 'dataAtendimento' WHERE colecao = 'solicitacoes'`); await desligarTudo(); zerar();

/* ---- 7.5 · relatório matinal executivo (07:30) ---- */
await regra('relatorio_matinal_executivo', { ativo: true, canal: 'AMBOS', destinatarios: [{ papel: 'diretoria', nome: 'Diretoria', email: 'dir@exemplo.test', telefone: '81 95555-0000' }] });
await rodar('2026-11-09', '07:30'); const wa5a = mock.wa[0]?.corpo.text || '', ex5a = pdfTexto(mock.email[0].corpo.attachments[0].content);
chk('sem Resumo do Recebível publicado o relatório AINDA sai (WhatsApp + e-mail com PDF), mas avisa que as entradas/saldo ainda não foram publicadas pelo painel', mock.email.length === 1 && mock.wa.length === 1 && /ainda não foi publicado/.test(mock.email[0].corpo.html) && /Entradas do dia anterior/i.test(ex5a) && /ainda não foi publicado/.test(ex5a.replace(/\s+/g, ' ')) && /Pendências da Retaguarda/.test(wa5a), [wa5a, ex5a.slice(0, 500)]);
await limparLog(); zerar(); await semRodada();
await N.publicarSnapshotRecebivel({ d: '2026-11-09', ant: '2026-11-08', em: '2026-11-09T10:00:00.000Z', informado: true, entradas: 48250.4, saidas: 21300, saldo: 26950.4, nSaidas: 7, meios: [{ rot: 'Dinheiro', vendas: 9000, prestacao: 1200, total: 10200 }, { rot: 'PIX', vendas: 7000, prestacao: 800, total: 7800 }, { rot: 'Cartão', vendas: 28000, prestacao: 2250.4, total: 30250.4 }], adquirentes: [{ rot: 'Adquirente A', deb: 6000, cre: 14000, total: 20000 }, { rot: 'Adquirente B', deb: 3000, cre: 7250.4, total: 10250.4 }], porConta: [['Fornecedores', 15000, 3]], carga: { ok: true, dia: '2026-11-09', arquivo: 'x.csv' }, avisos: [] }, 'Teste');
await rodar('2026-11-09', '07:45'); const ex5b = pdfTexto(mock.email[0].corpo.attachments[0].content).replace(/[ \t]+/g, ' '), wa5b = mock.wa[0].corpo.text;
chk('com o snapshot do dia publicado: PDF e WhatsApp trazem entradas (R$ 48.250,40), saldo (R$ 26.950,40), as adquirentes, as faltas de ontem (3 · R$ 370,00) e as pendências; nenhum aviso de defasagem', /48\.250,40/.test(ex5b) && /26\.950,40/.test(ex5b) && /Adquirente A/.test(ex5b) && /20\.000,00/.test(ex5b) && /48\.250,40/.test(wa5b) && /26\.950,40/.test(wa5b) && /3 · R\$ 370,00/.test(wa5b) && !/ainda não foi publicado/.test(ex5b) && !/ainda não foi aberto/.test(mock.email[0].corpo.html), [wa5b, ex5b.slice(0, 900)]);
await limparLog(); zerar(); await semRodada(); await sql(`DELETE FROM painel_notificacoes_instantaneo`); await N.publicarSnapshotRecebivel({ d: '2026-11-06', ant: '2026-11-05', entradas: 100, saldo: 50, em: '2026-11-06T10:00:00Z', informado: true, meios: [], adquirentes: [] }, 'Teste'); await rodar('2026-11-09', '07:50');
chk('snapshot defasado (de 06/11): o relatório usa o mais recente e DIZ que o resumo de hoje ainda não foi aberto no painel', /ainda não foi aberto no painel/.test(mock.email[0].corpo.html) && /vendas de 05\/11\/2026/.test(mock.email[0].corpo.html), mock.email[0].corpo.html.slice(0, 600));
await limparLog(); await desligarTudo(); zerar();

/* ---- 7.6 · RH: dobra de férias e início de férias (08:00) ---- */
await regra('rh_dobra_ferias', { ativo: true, canal: 'AMBOS', destinatarios: [{ papel: 'rh', nome: 'RH', email: 'rh@exemplo.test', telefone: '81 94444-0000' }] });
await rodar('2026-11-09', '08:00'); const lg6 = await logs();
chk('risco de dobra: Beto (limite em 60 dias) e Caio (30 dias) geram aviso ao RH; Beto é da loja 101 → o gerente da loja (Dora) também recebe; Caio é da loja 102 (sem gerente) → só o RH', lg6.some(l => l.referencia === 'ferias:dobra:f-beto:2027-01-08:60' && l.destinatario === 'dora@exemplo.test') && lg6.filter(l => l.referencia?.startsWith('ferias:dobra:f-beto')).length === 4 && lg6.filter(l => l.referencia?.startsWith('ferias:dobra:f-caio')).length === 2 && !lg6.some(l => /f-eva|f-ana|f-dora/.test(l.referencia)), lg6.map(l => [l.referencia, l.destinatario]));
chk('a mensagem de 30 dias é a urgente (vermelha) e diz o limite e a dobra; a de 60 é de atenção', /dobra/i.test(lg6.find(l => /f-caio/.test(l.referencia)).payload_mensagem.texto || lg6.find(l => /f-caio/.test(l.referencia)).payload_mensagem.assunto) && lg6.find(l => /f-caio/.test(l.referencia) && l.canal === 'WHATSAPP').payload_mensagem.texto.startsWith('🔴') && lg6.find(l => /f-beto/.test(l.referencia) && l.canal === 'WHATSAPP').payload_mensagem.texto.startsWith('🟡'));
await limparLog(); await desligarTudo(); zerar();
await regra('rh_inicio_ferias', { ativo: true, canal: 'AMBOS', destinatarios: [{ papel: 'rh', nome: 'RH', email: 'rh@exemplo.test' }] });
await rodar('2026-11-09', '08:00'); const lg7 = await logs();
chk('início de férias (5 dias antes): a Eva recebe e-mail e WhatsApp pessoais ("Suas férias começam em 5 dias"); o RH recebe só a cópia ("[Cópia] Férias de EVA…")', lg7.filter(l => l.destinatario === 'eva@exemplo.test' || l.destinatario === '5581999990004').length === 2 && /^Suas férias começam em 5 dias/.test(lg7.find(l => l.destinatario === 'eva@exemplo.test').titulo) && lg7.some(l => l.destinatario === 'rh@exemplo.test' && /^\[Cópia\] Férias de EVA/.test(l.titulo)) && lg7.length === 3, lg7.map(l => [l.destinatario, l.titulo]));
await limparLog(); await desligarTudo(); zerar();

/* ---- 7.7 · falta de caixa acima da tolerância (imediata, WhatsApp) ---- */
await regra('falta_caixa_tolerancia', { ativo: true, destinatarios: [{ papel: 'tesouraria', nome: 'Tesouraria', email: 'tes@exemplo.test', telefone: '81 93333-0000' }] });
await rodar('2026-11-09', '14:10'); const lg8 = await logs(), tx8 = mock.wa.map(w => w.corpo.text);
chk('falta de caixa: padrão é só WhatsApp; 150 sobre R$ 1.000 (15%) alerta; 100 (10% exato) NÃO; 120 sem venda do dia (≥ R$ 100) alerta; 90 não; sobra e falta de 7 dias atrás ficam de fora', lg8.length === 2 && lg8.every(l => l.canal === 'WHATSAPP' && l.status === 'SUCESSO') && mock.email.length === 0 && lg8.map(l => l.referencia).sort().join() === 'falta:ft1,falta:ft5' && tx8.some(t => /15,0%/.test(t) && /150,00/.test(t) && /LOJA UM/.test(t)) && tx8.some(t => /120,00/.test(t) && /Sem venda do dia/.test(t)), [lg8.map(l => l.referencia), tx8]);
await rodar('2026-11-09', '14:15'); await rodar('2026-11-09', '14:20');
chk('"imediato" = a cada rodada de 5 min, sem repetir: depois de avisada, a mesma falta nunca é reenviada', (await logs()).length === 2 && mock.wa.length === 2);
await doc('faltas/loja-t3', { lojaId: 'loja-t3', itens: [fcx(300, { id: 'ft9', data: '2026-11-09' })] }); await rodar('2026-11-09', '14:25');
chk('falta nova registrada depois → alerta na rodada seguinte (≤ 5 minutos), qualquer horário do dia', (await logs()).length === 3 && mock.wa.length === 3 && /300,00/.test(mock.wa[2].corpo.text));
await regra('falta_caixa_tolerancia', { parametros: { toleranciaPct: 5 } }); await doc('faltas/loja-t1', { lojaId: 'loja-t1', itens: [fcx(150, { id: 'ft1' }), fcx(100, { id: 'ft2' })] }); await rodar('2026-11-09', '14:30');
chk('tolerância editável: com 5% a falta de 100 sobre 1.000 (10%) passa a alertar', (await logs()).some(l => l.referencia === 'falta:ft2'));
await limparLog(); await desligarTudo(); zerar();

/* ---- 7.8 · confirmação do Backup na Nuvem (07:00) ---- */
await regra('backup_nuvem_status', { ativo: true, destinatarios: [{ papel: 'ti', nome: 'TI', email: 'ti@exemplo.test', telefone: '81 92222-0000' }] });
await rodar('2026-11-09', '07:00'); const lg9 = await logs();
chk('backup confirmado: o ponto automático das 23:59 (08/11) tem 7 h → e-mail "Backup na Nuvem confirmado" (padrão só e-mail); o ponto #, registros e tamanho aparecem', lg9.length === 1 && lg9[0].canal === 'EMAIL' && /confirmado/.test(lg9[0].titulo) && /4321/.test(lg9[0].payload_mensagem.html) && /200 KB/.test(lg9[0].payload_mensagem.html), lg9.map(l => l.titulo));
await limparLog(); await desligarTudo(); zerar(); await sql(`DELETE FROM painel_backups_historico`); await regra('backup_nuvem_status', { ativo: true, canal: 'AMBOS', destinatarios: [{ papel: 'ti', nome: 'TI', email: 'ti@exemplo.test', telefone: '81 92222-0000' }] }); await rodar('2026-11-09', '07:10');
chk('sem ponto automático (ou com mais de 26 h) → ALERTA "o backup automático não foi confirmado", por e-mail e WhatsApp', mock.email.length === 1 && /ALERTA/.test(mock.email[0].corpo.subject) && mock.wa.length === 1 && /NÃO confirmado/.test(mock.wa[0].corpo.text));
await limparLog(); await desligarTudo(); zerar();
await sql(`INSERT INTO painel_backups_historico (tipo_backup, payload_json, total_registros, versao_painel, tamanho_bytes, data_hora) VALUES ('AUTOMATICO', '{}'::jsonb, 10, 'v14.00', 100, $1), ('MANUAL', '{}'::jsonb, 10, 'v14.00', 100, $2)`, [T('2026-11-07', '23:59'), T('2026-11-08', '23:59')]);
await regra('backup_nuvem_status', { ativo: true, destinatarios: [{ papel: 'ti', nome: 'TI', email: 'ti@exemplo.test' }] }); await rodar('2026-11-09', '07:20');
chk('só conta ponto AUTOMÁTICO: um ponto manual recente não esconde que o automático está com 31 h', mock.email.length === 1 && /ALERTA/.test(mock.email[0].corpo.subject) && /31,\d h/.test(mock.email[0].corpo.html), mock.email[0]?.corpo.html.slice(0, 800));
await limparLog(); await desligarTudo(); zerar();
await sql(`DELETE FROM painel_backups_historico`); await sql(`INSERT INTO painel_backups_historico (tipo_backup, payload_json, total_registros, versao_painel, tamanho_bytes, data_hora) VALUES ('AUTOMATICO', '{}'::jsonb, 4321, 'v14.00', 204800, $1)`, [T('2026-11-08', '23:59')]);

/* =========================================================================== 8 · chaves ausentes, repetição, trava e orçamento */
configurar(false);
await regra('viagem_lembrete_prestacao', { ativo: true, canal: 'AMBOS', destinatarios: [] });
const rSem = await rodar('2026-11-09', '09:00').catch(e => e); const lgS = await logs();
chk('SEM as chaves de API a rodada NÃO quebra: cada envio vira uma linha ERRO com aviso amigável citando as variáveis NOTIFICACAO_… (e-mail e WhatsApp), nada é chamado', !(rSem instanceof Error) && lgS.length === 2 && lgS.every(l => l.status === 'ERRO' && l.payload_mensagem.meta.erroTipo === 'CONFIG') && lgS.some(l => /NOTIFICACAO_EMAIL_API_KEY/.test(l.detalhe_erro)) && lgS.some(l => /NOTIFICACAO_WHATSAPP_ENDPOINT/.test(l.detalhe_erro)) && mock.email.length === 0 && mock.wa.length === 0, lgS.map(l => l.detalhe_erro));
await rodar('2026-11-09', '09:10'); await semRodada(); await rodar('2026-11-09', '09:20');
chk('erro de configuração NÃO é repetido a cada 5 minutos (nada de enxurrada de avisos no log); o Master corrige e usa "Reenviar"', (await logs()).length === 2);
configurar(true);
const reenv = await N.reenviar(lgS.find(l => l.canal === 'EMAIL').id, { por: 'Teste' });
chk('depois de configurar as chaves, "Reenviar Notificação" manda de verdade (SUCESSO) e grava uma linha nova ligada à original (reenvio_de)', reenv.status === 'SUCESSO' && mock.email.length === 1 && mock.email[0].corpo.to[0] === 'beto@exemplo.test' && (await logs('reenvio_de = $1', [lgS.find(l => l.canal === 'EMAIL').id])).length === 1);
await limparLog(); await desligarTudo(); zerar();

/* erros transitórios: 3 tentativas, 15 min entre elas */
await regra('viagem_lembrete_prestacao', { ativo: true, canal: 'EMAIL' }); mock.emailModo = '503';
await rodar('2026-11-09', '09:00'); let lgT = await logs();
chk('erro transitório (503): grava ERRO com tentativa 1 marcado como repetível', lgT.length === 1 && lgT[0].status === 'ERRO' && lgT[0].tentativa === 1 && lgT[0].payload_mensagem.meta.transitorio === true && /indisponível/.test(lgT[0].detalhe_erro));
await rodar('2026-11-09', '09:10');
chk('antes de 15 minutos não tenta de novo', (await logs()).length === 1 && mock.email.length === 1);
await sql(`UPDATE painel_notificacoes_log SET data_hora = now() - interval '16 minutes'`); await rodar('2026-11-09', '09:20'); lgT = await logs();
chk('depois de 15 minutos tenta de novo (tentativa 2, ainda 503)', lgT.length === 2 && lgT[1].tentativa === 2 && lgT[1].status === 'ERRO' && mock.email.length === 2);
mock.emailModo = 'ok'; await sql(`UPDATE painel_notificacoes_log SET data_hora = now() - interval '16 minutes'`); await rodar('2026-11-09', '09:40'); lgT = await logs();
chk('a terceira tentativa funciona (SUCESSO, tentativa 3) e a repetição para; sem mais tentativas depois do sucesso', lgT.length === 3 && lgT[2].status === 'SUCESSO' && lgT[2].tentativa === 3 && (await rodar('2026-11-09', '10:00'), (await logs()).length === 3));
await limparLog(); await desligarTudo(); zerar(); mock.emailModo = '503'; await regra('viagem_lembrete_prestacao', { ativo: true, canal: 'EMAIL' });
for (let i = 0; i < 5; i++) { await sql(`UPDATE painel_notificacoes_log SET data_hora = now() - interval '16 minutes'`); await rodar('2026-11-09', '09:' + String(i * 5).padStart(2, '0')); }
chk('no máximo 3 tentativas por destinatário (MAX_TENTATIVAS) mesmo se o provedor continuar fora do ar', (await logs()).length === 3 && (await logs()).at(-1).tentativa === 3, (await logs()).map(l => l.tentativa));
await limparLog(); await desligarTudo(); zerar(); mock.emailModo = '401'; await regra('viagem_lembrete_prestacao', { ativo: true, canal: 'EMAIL' }); await rodar('2026-11-09', '09:00'); await sql(`UPDATE painel_notificacoes_log SET data_hora = now() - interval '1 hour'`); await rodar('2026-11-09', '09:30');
chk('credencial recusada (401 → CONFIG) e recusa do provedor (422) NÃO são repetidas', (await logs()).length === 1 && (await logs())[0].payload_mensagem.meta.erroTipo === 'CONFIG' && !(await logs())[0].detalhe_erro.includes(CHAVE_EMAIL));
await limparLog(); await desligarTudo(); zerar();

/* orçamento de tempo e concorrência */
await regra('viagem_lembrete_prestacao', { ativo: true, canal: 'EMAIL' });
const rOrc = await rodar('2026-11-09', '09:00', { orcamentoMs: -1 });
chk('sem tempo (orçamento esgotado) o evento é ADIADO: nada enviado e a rodada NÃO é marcada como feita', rOrc.eventos.some(e => e.adiado) && mock.email.length === 0 && (await N.lerRegras()).find(r => r.chave === 'viagem_lembrete_prestacao').ultimaRodadaEm === null);
await rodar('2026-11-09', '09:05'); chk('a rodada seguinte (com tempo) conclui o que foi adiado', mock.email.length === 1);
await limparLog(); await semRodada(); zerar();
const [pa, pb] = await Promise.all([rodar('2026-11-09', '09:10'), rodar('2026-11-09', '09:10')]);
chk('duas rodadas ao mesmo tempo: a trava consultiva deixa uma só trabalhar (a outra devolve "ocupado") e o e-mail sai UMA vez', [pa, pb].filter(r => r.ocupado).length === 1 && mock.email.length === 1 && (await logs()).length === 1, [pa.ocupado, pb.ocupado, mock.email.length]);
await desligarTudo(); await limparLog(); zerar();

/* =========================================================================== 9 · Testar Disparo, log, filtros e reenvio */
await regra('relatorio_matinal_executivo', { ativo: false, destinatarios: [{ papel: 'diretoria', nome: 'Diretoria', email: 'dir@exemplo.test' }] });
const tst = await N.testar('relatorio_matinal_executivo', { canal: 'AMBOS', para: { email: 'teste@exemplo.test', telefone: '(81) 91111-0000' } }); const lgTst = await logs('teste');
chk('Testar Disparo: manda a mensagem de EXEMPLO (dados fictícios) por e-mail com PDF e por WhatsApp, marcada [TESTE]; grava teste = true, sem referência', tst.resultados.length === 2 && tst.resultados.every(r => r.status === 'SUCESSO') && lgTst.length === 2 && lgTst.every(l => l.teste && l.referencia === null) && /^\[TESTE\] /.test(mock.email[0].corpo.subject) && mock.email[0].corpo.attachments[0].filename.endsWith('.pdf') && /^_\[TESTE\]_/.test(mock.wa[0].corpo.text), tst);
chk('o teste não consome a idempotência nem marca "último envio" da regra', (await N.lerRegras()).find(r => r.chave === 'relatorio_matinal_executivo').ultimoEnvio === null);
configurar(false); const tstSem = await N.testar('backup_nuvem_status', { canal: 'EMAIL', para: { email: 'teste@exemplo.test' } }); configurar(true);
chk('Testar Disparo sem chaves: resposta traz o aviso amigável (CONFIG) em vez de erro 500, e o config diz o que falta', tstSem.resultados[0].status === 'ERRO' && tstSem.resultados[0].tipoErro === 'CONFIG' && /NOTIFICACAO_EMAIL_API_KEY/.test(tstSem.resultados[0].erro));
chk('Testar Disparo valida: e-mail ruim → 400; telefone ruim → 400; sem destino algum → 400; evento desconhecido → 404', (await N.testar('backup_nuvem_status', { para: { email: 'x' } }).catch(e => e.status)) === 400 && (await N.testar('backup_nuvem_status', { para: { telefone: '12' } }).catch(e => e.status)) === 400 && (await N.testar('rh_inicio_ferias', {}).catch(e => e.status)) === 400 && (await N.testar('nao_existe', { para: { email: 'a@b.cc' } }).catch(e => e.status)) === 404);
const tstD = await N.testar('relatorio_matinal_executivo', { canal: 'EMAIL', para: {} });
chk('sem informar o destino, o teste usa os destinatários cadastrados da regra', tstD.resultados.length === 1 && tstD.resultados[0].destinatario === 'dir@exemplo.test');
for (const k of C.EVENTOS.map(e => e.chave)) await N.testar(k, { canal: 'EMAIL', para: { email: 'teste@exemplo.test' } }).catch(() => { });
chk('Testar Disparo funciona para os 10 eventos', (await logs(`teste AND canal = 'EMAIL' AND destinatario = 'teste@exemplo.test'`)).map(l => l.evento_chave).filter((v, i, a) => a.indexOf(v) === i).length === 10);
await sql(`DELETE FROM painel_notificacoes_log WHERE teste AND id > 0`);
for (let i = 0; i < 20; i++) await sql(`INSERT INTO painel_notificacoes_log (canal, evento_chave, destinatario, titulo, status, teste) VALUES ('EMAIL', 'rh_inicio_ferias', 'lim@exemplo.test', 't', 'SUCESSO', true)`);
chk('limite de 20 testes por hora → 429', (await N.testar('rh_inicio_ferias', { para: { email: 'a@b.cc' } }).catch(e => e.status)) === 429); await limparLog(); zerar();

/* auditoria: filtros */
const ins = (o) => sql(`INSERT INTO painel_notificacoes_log (data_hora, canal, evento_chave, destinatario, titulo, status, detalhe_erro, teste, payload_mensagem) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`, [o.d, o.canal, o.ev, o.dest, o.tit, o.st, o.er || null, !!o.teste, JSON.stringify({ nome: o.nome || '', html: '<p>x</p>', texto: 'corpo ' + o.tit, meta: {} })]);
await ins({ d: T('2026-11-05', '10:00'), canal: 'EMAIL', ev: 'viagem_prazo_excedido', dest: 'joana@exemplo.test', tit: 'Aviso A', st: 'SUCESSO', nome: 'JOANA' });
await ins({ d: T('2026-11-06', '10:00'), canal: 'WHATSAPP', ev: 'viagem_prazo_excedido', dest: '5581999990001', tit: 'Aviso B', st: 'ERRO', er: 'falhou B', nome: 'JOANA' });
await ins({ d: T('2026-11-07', '10:00'), canal: 'EMAIL', ev: 'rh_dobra_ferias', dest: 'rh@exemplo.test', tit: 'Aviso C', st: 'ERRO', er: 'falhou C', nome: 'RH' });
await ins({ d: T('2026-11-08', '10:00'), canal: 'EMAIL', ev: 'rh_dobra_ferias', dest: 'rh@exemplo.test', tit: 'Aviso D [TESTE]', st: 'SUCESSO', teste: true, nome: 'RH' });
for (let i = 0; i < 130; i++) await ins({ d: T('2026-11-09', '10:00'), canal: 'EMAIL', ev: 'backup_nuvem_status', dest: 'ti@exemplo.test', tit: 'Backup ' + i, st: 'SUCESSO', nome: 'TI' });
const L = f => N.listarLogs(f);
chk('auditoria: filtro por status, canal e evento (combináveis); total correto', (await L({ status: 'ERRO' })).total === 2 && (await L({ status: 'ERRO', canal: 'WHATSAPP' })).logs.map(l => l.titulo).join() === 'Aviso B' && (await L({ evento: 'rh_dobra_ferias' })).total === 2 && (await L({ canal: 'WHATSAPP', evento: 'rh_dobra_ferias' })).total === 0);
chk('auditoria: filtro de período em dias de Brasília e filtro "teste" (só testes / sem testes)', (await L({ de: '2026-11-06', ate: '2026-11-07' })).total === 2 && (await L({ teste: 'sim' })).total === 1 && (await L({ teste: 'nao', evento: 'rh_dobra_ferias' })).total === 1);
chk('auditoria: busca por texto no título/nome/destinatário (sem tratar % como curinga)', (await L({ busca: 'joana' })).total === 2 && (await L({ busca: 'Aviso C' })).total === 1 && (await L({ busca: '%' })).total === 0);
const p1 = await L({ limite: 50 }), p2 = await L({ limite: 50, antes: p1.proximo }), p3 = await L({ limite: 50, antes: p2.proximo });
chk('auditoria: paginação por id (134 registros em páginas de 50, mais recentes primeiro, sem repetir nem pular)', p1.total === 134 && p1.logs.length === 50 && p2.logs.length === 50 && p3.logs.length === 34 && p3.proximo === null && new Set([...p1.logs, ...p2.logs, ...p3.logs].map(l => l.id)).size === 134 && p1.logs[0].id > p1.logs[49].id);
chk('auditoria: destinatário mascarado na lista (jo•••@exemplo.test; +55 81 ••••0001), sem o conteúdo da mensagem; limite máximo de 100 por página', (await L({ busca: 'Aviso A' })).logs[0].destinatario === 'jo•••@exemplo.test' && (await L({ busca: 'Aviso B' })).logs[0].destinatario === '+55 81 ••••0001' && !('payload' in p1.logs[0]) && (await L({ limite: 5000 })).logs.length === 100);
const det = await N.lerLog((await L({ busca: 'Aviso C' })).logs[0].id);
chk('detalhe do envio: título, status, erro e o texto guardado', det.status === 'ERRO' && det.detalheErro === 'falhou C' && /corpo Aviso C/.test(det.texto) && (await N.lerLog(999999999).catch(e => e.status)) === 404);
const lgR = (await L({ busca: 'Aviso A' })).logs[0]; zerar(); const rr = await N.reenviar(lgR.id, { por: 'Teste' });
chk('Reenviar Notificação: reenvia o conteúdo guardado ao mesmo destinatário e grava linha nova ligada à original', rr.status === 'SUCESSO' && mock.email[0].corpo.to[0] === 'joana@exemplo.test' && mock.email[0].corpo.html === '<p>x</p>' && (await sql(`SELECT count(*)::int n FROM painel_notificacoes_log WHERE reenvio_de = $1`, [lgR.id]))[0].n === 1);
await sql(`INSERT INTO painel_notificacoes_log (canal, evento_chave, destinatario, titulo, status, payload_mensagem) VALUES ('EMAIL', 'rh_dobra_ferias', '(sem e-mail) CAIO', 't', 'ERRO', '{"texto":"x","html":"x"}')`);
chk('reenviar uma linha sem contato ("(sem e-mail) CAIO") → 409 explicando; id inexistente → 404', (await N.reenviar((await sql(`SELECT max(id)::int i FROM painel_notificacoes_log`))[0].i).catch(e => e.status)) === 409 && (await N.reenviar(999999999).catch(e => e.status)) === 404);
await limparLog(); zerar();
await ins({ d: new Date(Date.now() - 130 * 864e5), canal: 'EMAIL', ev: 'backup_nuvem_status', dest: 'velho@exemplo.test', tit: 'Muito antigo', st: 'SUCESSO' }); await ins({ d: new Date(Date.now() - 10 * 864e5), canal: 'EMAIL', ev: 'backup_nuvem_status', dest: 'recente@exemplo.test', tit: 'Recente', st: 'SUCESSO' });
await rodar('2026-11-09', '00:02'); chk('retenção: na rodada da madrugada o log com mais de 120 dias é apagado (o recente fica)', (await logs()).map(l => l.titulo).join() === 'Recente');
await limparLog(); await desligarTudo();

/* =========================================================================== 10 · função agendada */
chk('notificacoes-agendadas: cron a cada 5 minutos (*/5 * * * *) e resposta 200 sem expor dados', agendada.config.schedule === '*/5 * * * *' && typeof agendada.default === 'function');
const ra = await agendada.default(); const ja = await ra.json();
chk('executar a função agendada devolve 200 {ok:true} (nada ligado = nada a fazer) e não lança', ra.status === 200 && ja.ok === true && Object.keys(ja).length === 1);
const hojeReal = D.agoraBRT(new Date()).iso, rotuloAnt = console.info; let logou = '';
await doc('faltas/loja-t1', { lojaId: 'loja-t1', itens: [] }); await doc('faltas/loja-t2', { lojaId: 'loja-t2', itens: [] });
await doc('faltas/loja-t3', { lojaId: 'loja-t3', itens: [fcx(900, { id: 'ftreal', data: hojeReal })] });
await regra('falta_caixa_tolerancia', { ativo: true, destinatarios: [{ papel: 'tesouraria', nome: 'Segredo Pessoa', email: 'segredo.pessoa@exemplo.test', telefone: '81 90000-1234' }] });
console.info = (...a) => { logou += a.join(' '); }; zerar(); await agendada.default(); console.info = rotuloAnt;
chk('o log do Netlify (console) só tem contagens e nomes de evento (falta_caixa_tolerancia:1ok/0erro): nenhum e-mail, nome ou telefone', /falta_caixa_tolerancia:1ok\/0erro/.test(logou) && !/segredo|exemplo\.test|90000/i.test(logou) && mock.wa.length === 1, [logou, mock.wa.length]);
await limparLog(); await desligarTudo(); zerar();

/* =========================================================================== 11 · API /api/notificar */
const SENHA = 'Teste2026Ab', CPF = { m: '39053344705', op: '86288366757', fcx: '11144477735', troca: '71428793860' };
for (const [id, perfil, cpf, extra] of [['m', 'MASTER', CPF.m, {}], ['op', 'OPERACIONAL', CPF.op, {}], ['fcx', 'OPERACIONAL', CPF.fcx, { permissoes: { fcx: 'Ler' } }], ['troca', 'OPERACIONAL', CPF.troca, { trocarSenha: true }]]) await doc('usuarios/usr-n-' + id, { perfil, nome: 'Teste ' + id, cpf, ativo: true, permissoes: {}, trocarSenha: false, senha: gerar(SENHA, 'sal-n-' + id), ...extra });
const subir = (porta, env) => new Promise((ok, ko) => {
  const p = spawn(process.execPath, [path.join(raiz, 'tests/servidor-local.mjs'), String(porta)], { env: { ...process.env, NETLIFY_DB_URL: DBURL, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', d => { if (/painel local/.test(String(d))) ok(p); }); p.stderr.on('data', d => { if (/Error/.test(String(d))) ko(new Error(String(d))); }); setTimeout(() => ko(new Error('timeout do servidor ' + porta)), 15000);
});
const ENV_ON = { NOTIFICACAO_EMAIL_API_KEY: CHAVE_EMAIL, NOTIFICACAO_EMAIL_FROM: 'Painel <painel@exemplo.test>', NOTIFICACAO_EMAIL_ENDPOINT: 'http://127.0.0.1:8861/emails', NOTIFICACAO_WHATSAPP_ENDPOINT: 'http://127.0.0.1:8862/message/sendText/painel', NOTIFICACAO_WHATSAPP_TOKEN: TOKEN_WA };
const ENV_OFF = Object.fromEntries(Object.keys(ENV_ON).map(k => [k, '']));
const sv1 = await subir(8891, ENV_ON), sv2 = await subir(8892, ENV_OFF);
const U1 = 'http://localhost:8891', U2 = 'http://localhost:8892';
async function entrar(U, cpf) { const r = await fetch(U + '/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json', 'x-painel': '1' }, body: JSON.stringify({ cpf, senha: SENHA }) }); const c = r.headers.get('set-cookie'); if (!c) throw new Error('login falhou ' + r.status + ' ' + (await r.text())); return c.split(';')[0]; }
const api = async (U, ck, corpo, metodo = 'POST', csrf = true) => { const r = await fetch(U + '/api/notificar', { method: metodo, headers: { ...(ck ? { cookie: ck } : {}), ...(csrf ? { 'x-painel': '1' } : {}), 'content-type': 'application/json' }, body: metodo === 'GET' ? undefined : JSON.stringify(corpo) }); let j = null; try { j = await r.json(); } catch { /* sem corpo */ } return { s: r.status, j }; };
try {
  const [M1, OP1, FX1, TR1] = await Promise.all([entrar(U1, CPF.m), entrar(U1, CPF.op), entrar(U1, CPF.fcx), entrar(U1, CPF.troca)]);
  chk('API: sem sessão → 401; troca de senha pendente → 401; sem x-painel (CSRF) → 403; método DELETE → 405', (await api(U1, '', { acao: 'estado' })).s === 401 && (await api(U1, TR1, { acao: 'estado' })).s === 401 && (await api(U1, M1, { acao: 'estado' }, 'POST', false)).s === 403 && (await api(U1, M1, {}, 'DELETE')).s === 405);
  chk('API: só o Master vê e altera a Central — Operacional → 403 em estado, regra, teste, logs, log e reenviar', (await Promise.all(['estado', 'salvar-regra', 'testar', 'logs', 'log', 'reenviar'].map(a => api(U1, OP1, { acao: a, evento: 'backup_nuvem_status', id: 1 })))).every(r => r.s === 403));
  await sql(`UPDATE documentos SET dados = '{"gestao_v1400":{"ativo":false}}'::jsonb WHERE caminho = 'config/recursos'`);
  const off = await api(U1, M1, { acao: 'estado' });
  chk('API: recurso gestao_v1400 desligado (Produção/Falco) → 403 com código recurso_desligado, mesmo para o Master', off.s === 403 && off.j.codigo === 'recurso_desligado');
  await sql(`UPDATE documentos SET dados = '{"gestao_v1400":{"ativo":true}}'::jsonb WHERE caminho = 'config/recursos'`);
  const est = await api(U1, M1, null, 'GET');
  chk('API: GET/estado devolve configuração (provedor reconhecido), os 10 eventos com regra/parâmetros/campos e totais — sem NENHUM valor de chave', est.s === 200 && est.j.eventos.length === 10 && est.j.config.email.configurado && est.j.config.whatsapp.provedorRotulo === 'Evolution API' && est.j.fuso === 'America/Sao_Paulo' && !JSON.stringify(est.j).includes(CHAVE_EMAIL) && !JSON.stringify(est.j).includes(TOKEN_WA), est.j.config);
  const sv = await api(U1, M1, { acao: 'salvar-regra', evento: 'relatorio_matinal_executivo', ativo: true, canal: 'AMBOS', destinatarios: [{ papel: 'diretoria', nome: 'Dir', email: 'dir@exemplo.test', telefone: '81 95555-0000' }], parametros: { horario: '07:45' } });
  chk('API: salvar regra liga o evento, grava canal, destinatários e horário (07:45) e persiste no banco', sv.s === 200 && sv.j.regra.ativo && sv.j.regra.parametros.horario === '07:45' && sv.j.regra.destinatarios.length === 1 && sv.j.avisos.length === 0 && (await sql(`SELECT ativo, canal, parametros_json->>'horario' h FROM painel_notificacoes_regras WHERE evento_chave = 'relatorio_matinal_executivo'`))[0].h === '07:45');
  chk('API: salvar valida — e-mail inválido → 400; telefone inválido → 400; evento desconhecido → 404; ação desconhecida → 400', (await api(U1, M1, { acao: 'salvar-regra', evento: 'rh_dobra_ferias', destinatarios: [{ papel: 'rh', email: 'xxx' }] })).s === 400 && (await api(U1, M1, { acao: 'salvar-regra', evento: 'rh_dobra_ferias', destinatarios: [{ papel: 'rh', telefone: '1' }] })).s === 400 && (await api(U1, M1, { acao: 'salvar-regra', evento: 'nada' })).s === 404 && (await api(U1, M1, { acao: 'apagar-tudo' })).s === 400);
  const sv2r = await api(U1, M1, { acao: 'salvar-regra', evento: 'backup_nuvem_status', ativo: true, canal: 'EMAIL', destinatarios: [] });
  chk('API: ligar um evento sem destinatários devolve AVISO amigável (cadastre destinatários) — salva mesmo assim', sv2r.s === 200 && sv2r.j.avisos.some(a => /sem destinat|não há destinat/i.test(a)), sv2r.j.avisos);
  zerar(); const ts = await api(U1, M1, { acao: 'testar', evento: 'backup_nuvem_status', canal: 'AMBOS', para: { email: 'teste@exemplo.test', telefone: '81 91111-0000' } });
  chk('API: Testar Disparo dispara de verdade pelo servidor com chaves (e-mail e WhatsApp, [TESTE]) e responde o resultado por canal', ts.s === 200 && ts.j.resultados.length === 2 && ts.j.resultados.every(r => r.status === 'SUCESSO') && mock.email.length === 1 && mock.wa.length === 1 && /^\[TESTE\]/.test(mock.email[0].corpo.subject), ts.j);
  const lgs = await api(U1, M1, { acao: 'logs', teste: 'sim' }), um = lgs.j?.logs?.[0];
  chk('API: logs devolve a auditoria (com total e filtros), destinatário mascarado e sem o conteúdo', lgs.s === 200 && lgs.j.total === 2 && um && !JSON.stringify(lgs.j).includes('<!doctype') && /•/.test(um.destinatario), lgs.j);
  const dl = await api(U1, M1, { acao: 'log', id: um.id });
  chk('API: log (detalhe) devolve o texto guardado e os anexos (nome/tamanho)', dl.s === 200 && dl.j.texto.length > 10 && Array.isArray(dl.j.anexos), dl.j);
  const rv = await api(U1, M1, { acao: 'reenviar', id: um.id });
  chk('API: reenviar devolve SUCESSO e cria o registro novo', rv.s === 200 && rv.j.status === 'SUCESSO' && (await sql(`SELECT count(*)::int n FROM painel_notificacoes_log WHERE reenvio_de = $1`, [um.id]))[0].n === 1, rv.j);
  /* snapshot do recebível */
  const snap = { d: '2026-11-09', ant: '2026-11-08', entradas: 10, saldo: 5, informado: true, meios: [], adquirentes: [] };
  chk('API: instantaneo — Master e quem vê o FCX publicam o Resumo do Recebível; Operacional sem FCX → 403; objeto inválido → 400', (await api(U1, M1, { acao: 'instantaneo', dados: snap })).j?.chave === 'recebivel:2026-11-09' && (await api(U1, FX1, { acao: 'instantaneo', dados: snap })).s === 200 && (await api(U1, OP1, { acao: 'instantaneo', dados: snap })).s === 403 && (await api(U1, M1, { acao: 'instantaneo', dados: { entradas: 1 } })).s === 400);
  await sql(`UPDATE documentos SET dados = '{"gestao_v1400":{"ativo":false}}'::jsonb WHERE caminho = 'config/recursos'`);
  chk('API: com o recurso desligado, instantaneo é ignorado sem erro (o painel antigo nunca quebra)', (await api(U1, FX1, { acao: 'instantaneo', dados: snap })).j?.ignorado !== undefined);
  await sql(`UPDATE documentos SET dados = '{"gestao_v1400":{"ativo":true}}'::jsonb WHERE caminho = 'config/recursos'`);
  /* servidor SEM chaves */
  const M2 = await entrar(U2, CPF.m), e2 = await api(U2, M2, null, 'GET');
  chk('API sem chaves: o estado diz o que falta (só os NOMES das 4 variáveis) e a Central continua funcionando', e2.s === 200 && e2.j.config.email.faltam.join() === 'NOTIFICACAO_EMAIL_API_KEY,NOTIFICACAO_EMAIL_FROM' && e2.j.config.whatsapp.faltam.join() === 'NOTIFICACAO_WHATSAPP_ENDPOINT,NOTIFICACAO_WHATSAPP_TOKEN' && !e2.j.config.email.configurado, e2.j.config);
  const t2 = await api(U2, M2, { acao: 'testar', evento: 'backup_nuvem_status', canal: 'EMAIL', para: { email: 'teste@exemplo.test' } });
  chk('API sem chaves: Testar Disparo responde 200 com o aviso amigável (não 500) e grava a linha ERRO no log da Central', t2.s === 200 && t2.j.resultados[0].status === 'ERRO' && /NOTIFICACAO_EMAIL_API_KEY/.test(t2.j.resultados[0].erro) && (await api(U2, M2, { acao: 'logs', status: 'ERRO', teste: 'sim' })).j.logs.some(l => /NOTIFICACAO_EMAIL_API_KEY/.test(l.detalheErro)), t2.j);
  /* tabelas ausentes */
  await sql('ALTER TABLE painel_notificacoes_regras RENAME TO painel_notificacoes_regras_x'); const ts2 = await api(U1, M1, { acao: 'estado' }); await sql('ALTER TABLE painel_notificacoes_regras_x RENAME TO painel_notificacoes_regras');
  chk('API: banco sem as tabelas da Central → 503 com código sem_esquema e a instrução de executar as migrações (sem SQL no texto)', ts2.s === 503 && ts2.j.codigo === 'sem_esquema' && /migra/i.test(ts2.j.erro) && !/relation|SELECT|INSERT/i.test(ts2.j.erro), ts2);
} finally { sv1.kill(); sv2.kill(); }

/* =========================================================================== 12 · segredos e fechamento */
const todoLog = JSON.stringify(await sql('SELECT * FROM painel_notificacoes_log')) + JSON.stringify(await sql('SELECT * FROM painel_notificacoes_regras')) + JSON.stringify(await sql('SELECT * FROM painel_notificacoes_instantaneo'));
chk('nenhum segredo (chave de e-mail, token do WhatsApp) em nenhuma tabela da Central', !todoLog.includes(CHAVE_EMAIL) && !todoLog.includes(TOKEN_WA));
chk('fonte: nenhum arquivo novo do backend traz chave de API, token ou senha escrita no código (só variáveis de ambiente)', (() => { const sem = t => !/(?:Secret20\d\d|\b(?:re|tok|sk|key)_[A-Za-z0-9]{12,}|\b(?:senha|password|token|api_?key)\s*[:=]\s*['"`][A-Za-z0-9#@!._-]{8,}['"`])/i.test(t); return ['notif-catalogo', 'notif-dados', 'notif-ieo', 'notif-mensagens', 'notif-motor', 'notif-pdf', 'notif-provedores'].every(f => sem(fs.readFileSync(path.join(raiz, 'netlify/lib', f + '.mjs'), 'utf8'))) && ['notificar', 'notificacoes-agendadas'].every(f => sem(fs.readFileSync(path.join(raiz, 'netlify/functions', f + '.mjs'), 'utf8'))); })());
await limparLog(); await desligarTudo();
console.log('\nOK (' + OK.length + ')  FALHAS (' + FAIL.length + ')');
srvEmail.close(); srvWa.close(); await db.end(); await dbLib().pool.end(); process.exit(FAIL.length ? 1 : 0);
