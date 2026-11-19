/* v14.02 · Aprovação de pagamentos das Saídas do Dia — camada do servidor com banco (netlify/lib/saidas-aprovacoes.mjs e o aviso do motor da Central de Notificações).
   Dados FICTÍCIOS (LGPD); os provedores de e-mail e WhatsApp são servidores falsos em 127.0.0.1 (8861/8862). Uso, com um Postgres local:
     bash tests/preparar-banco.sh
     NETLIFY_DB_URL=postgres://postgres@127.0.0.1:54329/painel_teste node tests/teste-aprovacoes-saidas.mjs
   Cobre: permissões (podeVer/podeAprovar; Loja nunca aprova); chave de conteúdo do título; CPF mascarado; todas as recusas do "Finalizar" (403, 409, 422);
   gravação do lote (totais no servidor, selo SHA-256, CPF inteiro só no banco); idempotência (inclusive duas chamadas ao mesmo tempo); nova aprovação do mesmo dia
   (a decisão mais recente vale; nada é apagado); nova importação do FCX (as decisões acompanham o conteúdo do título); gravação em fatias (400 títulos);
   o aviso (recurso/regra desligados, sem destinatários, envio com PDF anexo, sem repetir) e a rede de segurança do agendador (lote sem aviso entre 10 min e 6 h). */
import pg from 'pg';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OK = [], FAIL = [];
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x !== '' ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 1200) : '')); };
const DBURL = process.env.NETLIFY_DB_URL; if (!DBURL) { console.error('Defina NETLIFY_DB_URL'); process.exit(2); }
const db = new pg.Pool({ connectionString: DBURL, max: 6 }), sql = (t, p) => db.query(t, p).then(r => r.rows);
const doc = (caminho, dados) => { const i = caminho.lastIndexOf('/'); return sql(`INSERT INTO documentos (caminho, colecao, doc_id, dados) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (caminho) DO UPDATE SET dados = EXCLUDED.dados, versao = documentos.versao + 1`, [caminho, caminho.slice(0, i), caminho.slice(i + 1), JSON.stringify(dados)]); };
const CPF_APROV = '86288366757', CPF_MASTER = '39053344705';   // CPFs fictícios válidos

/* ----------------------------------------------------------------------------------------------- provedores falsos */
const mock = { email: [], wa: [] };
const servidor = (lista, resposta) => http.createServer(async (req, res) => { const b = []; for await (const c of req) b.push(c); let corpo = null; try { corpo = JSON.parse(Buffer.concat(b).toString() || 'null'); } catch { /* texto */ } lista().push({ url: req.url, corpo }); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(resposta(lista().length))); });
const srvEmail = servidor(() => mock.email, n => ({ id: 'mail_' + n })), srvWa = servidor(() => mock.wa, n => ({ key: { id: 'wa_' + n } }));
await new Promise(r => srvEmail.listen(8861, '127.0.0.1', r)); await new Promise(r => srvWa.listen(8862, '127.0.0.1', r));
Object.assign(process.env, { NOTIFICACAO_EMAIL_API_KEY: 're_TESTE_chave_fake_123456', NOTIFICACAO_EMAIL_FROM: 'Painel <painel@exemplo.test>', NOTIFICACAO_EMAIL_ENDPOINT: 'http://127.0.0.1:8861/emails', NOTIFICACAO_WHATSAPP_ENDPOINT: 'http://127.0.0.1:8862/message/sendText/painel', NOTIFICACAO_WHATSAPP_TOKEN: 'tok_TESTE_wa_654321' });
delete process.env.PAINEL_AMBIENTE;

const S = await import('../netlify/lib/saidas-aprovacoes.mjs'), N = await import('../netlify/lib/notif-motor.mjs'), D = await import('../netlify/lib/notif-dados.mjs'), { NIVEL } = await import('../netlify/lib/regras.mjs'), { db: dbLib } = await import('../netlify/lib/db.mjs');
const HOJE = D.agoraBRT().iso, antes = n => D.somarDias(HOJE, -n);
const erroDe = async fn => { try { await fn(); return null; } catch (e) { return { status: e.status ?? e.statusCode ?? null, codigo: e.codigo ?? e.extra?.codigo ?? null, msg: String(e.message || e) }; } };

/* ---------- sessões de mentira ---------- */
const sessao = (o = {}) => ({ uid: 'usr-aprov', perfil: 'OPERACIONAL', nivel: NIVEL.view, trocaPendente: false, usuario: { cpf: CPF_APROV, nome: 'Diretor Teste' }, perms: new Set([S.PERM_APROVAR]), ambiente: null, recursoAtivo: () => true, ...o });
const master = sessao({ uid: 'usr-master', perfil: 'MASTER', nivel: NIVEL.admin, perms: new Set(['*']), usuario: { cpf: CPF_MASTER, nome: 'Master Teste' } });

/* ---------- FCX fictício no banco (esp2:saidas em fatias, como o painel grava) ---------- */
const titulo = (id, extra = {}) => ({ id, tipo: 'efetivo', date: HOJE, conta: 'ENERGIA', centro: 'ADM', fornecedor: 'FORNECEDOR ' + id.toUpperCase(), valorLiquido: 100, formaPagamento: 'PIX', item: 'Item ' + id, obs: '', ...extra });
async function gravarFcx(lista) {
  const json = JSON.stringify(lista), tam = Math.ceil(json.length / 2) || 1, fatias = [json.slice(0, tam), json.slice(tam)];
  await sql(`DELETE FROM documentos WHERE caminho LIKE 'fcx/esp2:saidas%'`);
  await doc('fcx/esp2:saidas', { partes: fatias.length });
  for (let i = 0; i < fatias.length; i++) await doc(`fcx/esp2:saidas~${i}`, { v: fatias[i] });
}
const base = [titulo('s1', { valorLiquido: 1000.5 }), titulo('s2', { valorLiquido: 250 }), titulo('s3', { valorLiquido: 99.99, forma: 'BOLETO' }), titulo('s4', { tipo: 'previsto', valorLiquido: 5000 }), titulo('s5', { date: antes(25), valorLiquido: 10 }), titulo('s6', { date: 'lixo' })];
await gravarFcx(base);
const limpar = async () => { await sql('DELETE FROM painel_saidas_decisoes'); await sql('DELETE FROM painel_saidas_lotes'); await sql('DELETE FROM painel_notificacoes_log'); };
await limpar();

/* =========================================================================== 1 · puras */
chk('mascararCpf: só os 2 últimos dígitos; vazio continua vazio; curto vira ***', S.mascararCpf(CPF_APROV) === '***.***.***-57' && S.mascararCpf('862.883.667-57') === '***.***.***-57' && S.mascararCpf('') === '' && S.mascararCpf(null) === '' && S.mascararCpf('123') === '***');
const k1 = S.chavesDosTitulos([titulo('a'), titulo('b', { fornecedor: 'FORNECEDOR A', item: 'Item a' }), titulo('c', { valorLiquido: 101 })]);
chk('chave do título: o conteúdo manda (não o id); repetidos idênticos ganham chaves diferentes pela ordem; valor diferente = chave diferente', k1.get('a') !== k1.get('b') && k1.get('a') !== k1.get('c') && /^[0-9a-f]{64}$/.test(k1.get('a'))
  && S.chavesDosTitulos([titulo('z', { fornecedor: 'FORNECEDOR A', item: 'Item a' }), titulo('y')]).get('z') === k1.get('a'), [...k1.values()].map(v => v.slice(0, 8)));
chk('permissões: Master e quem tem a flag aprovam; quem só vê o FCX apenas vê; sem nada, nem vê; Loja NUNCA aprova (nem com a flag); troca de senha pendente = nada',
  S.podeAprovar(master) && S.podeAprovar(sessao()) && !S.podeAprovar(sessao({ perms: new Set(['fcx.ver']) })) && S.podeVer(sessao({ perms: new Set(['fcx.ver']) })) && !S.podeVer(sessao({ perms: new Set() }))
  && !S.podeAprovar(sessao({ perfil: 'LOJA' })) && !S.podeAprovar(sessao({ trocaPendente: true })) && !S.podeVer(sessao({ trocaPendente: true })) && !S.podeAprovar(null) && !S.podeVer(null));

/* =========================================================================== 2 · recusas do Finalizar */
const mapa = await S.saidasDoFcx(), ids = [...mapa.keys()];
chk('saidasDoFcx: só títulos efetivos com data válida (o "previsto" e a data inválida ficam de fora); o valor líquido manda', mapa.size === 4 && ids.join() === 's1,s2,s3,s5' && mapa.get('s1').valor === 1000.5, ids);
const IT = (st = {}) => ['s1', 's2', 's3'].map(id => ({ id, status: st[id] || 'APROVADO', valor: mapa.get(id).valor }));
const idem = (() => { let n = 0; return () => 'idem-teste-' + String(++n).padStart(6, '0'); })();
const tenta = (s, e) => erroDe(() => S.finalizar(s, { dia: HOJE, idem: idem(), itens: IT(), ...e }));
const e403 = await tenta(sessao({ perms: new Set(['fcx.ver']) })), e403b = await tenta(sessao({ perfil: 'LOJA' }));
chk('sem a permissão (ou Loja) → 403 e nada é gravado', e403?.status === 403 && e403b?.status === 403 && (await sql('SELECT count(*)::int n FROM painel_saidas_lotes'))[0].n === 0, [e403, e403b]);
const rec = [
  ['dia inválido', await tenta(master, { dia: '2026-13-45' }), 422], ['dia 60 dias no passado', await tenta(master, { dia: antes(60) }), 422], ['dia 20 dias à frente', await tenta(master, { dia: D.somarDias(HOJE, 20) }), 422],
  ['chave de idempotência curta', await tenta(master, { idem: 'curta' }), 422], ['chave com caractere proibido', await tenta(master, { idem: 'tem espaço e ; ponto' }), 422],
  ['lista vazia', await tenta(master, { itens: [] }), 422], ['mais de 1500 títulos', await tenta(master, { itens: Array.from({ length: S.MAX_ITENS + 1 }, (_, i) => ({ id: 'x' + i, status: 'APROVADO', valor: 1 })) }), 422],
  ['título repetido na lista', await tenta(master, { itens: [...IT(), IT()[0]] }), 422], ['status inventado', await tenta(master, { itens: [{ id: 's1', status: 'PAGO', valor: 1000.5 }] }), 422],
  ['título que não existe no FCX', await tenta(master, { itens: [{ id: 'nao-existe', status: 'APROVADO', valor: 1 }] }), 409], ['valor diferente do FCX', await tenta(master, { itens: [{ id: 's2', status: 'APROVADO', valor: 249 }] }), 409],
  ['título de outro dia de pagamento (vencido há 25 dias)', await tenta(master, { itens: [{ id: 's5', status: 'APROVADO', valor: 10 }] }), 422], ['valor ausente', await tenta(master, { itens: [{ id: 's2', status: 'APROVADO' }] }), 409],
];
for (const [nome, r, st] of rec) chk(`recusa: ${nome} → ${st}`, r?.status === st, r);
chk('o 409 traz o código fcx_mudou (o painel manda atualizar a tela)', rec[9][1]?.codigo === 'fcx_mudou' && rec[10][1]?.codigo === 'fcx_mudou', [rec[9][1], rec[10][1]]);
const semCpf = await tenta(sessao({ usuario: { cpf: '', nome: 'Sem CPF' } }));
chk('aprovador sem CPF cadastrado → 422 amigável e nada gravado', semCpf?.status === 422 && /CPF/.test(semCpf.msg) && (await sql('SELECT count(*)::int n FROM painel_saidas_lotes'))[0].n === 0, semCpf);

/* =========================================================================== 3 · gravação, idempotência, decisão mais recente */
const I1 = idem();
const r1 = await S.finalizar(sessao(), { dia: HOJE, idem: I1, itens: IT({ s3: 'RETIDO' }) });
chk('Finalizar grava o lote: totais calculados no servidor (previsto 1.250,50 + 99,99; autorizado 1.250,50; retido 99,99), 2 aprovados e 1 retido', r1.repetido === false && r1.lote.dia === HOJE && r1.lote.totalPrevisto === 1350.49 && r1.lote.totalAutorizado === 1250.5 && r1.lote.totalRetido === 99.99 && r1.lote.qtdAprovados === 2 && r1.lote.qtdRetidos === 1 && r1.lote.qtdTotal === 3, r1.lote);
chk('o relatório lista os APROVADOS primeiro e depois os RETIDOS, com fornecedor/conta/forma lidos do FCX (não do navegador)', r1.itens.map(i => i.status).join() === 'APROVADO,APROVADO,RETIDO' && r1.itens[0].fornecedor === 'FORNECEDOR S1' && r1.itens[2].conta === 'ENERGIA' && r1.itens.every(i => /^\d{4}-\d{2}-\d{2}$/.test(i.vencimento)), r1.itens);
chk('o CPF só sai mascarado (lote e relatório); o selo é um SHA-256; o dia e o vencimento são texto AAAA-MM-DD (não "Thu Nov 12")', r1.lote.aprovadorCpf === '***.***.***-57' && !JSON.stringify(r1).includes(CPF_APROV) && /^[0-9a-f]{64}$/.test(r1.lote.selo) && r1.lote.aprovadorNome === 'Diretor Teste' && r1.itens[0].vencimento === HOJE, r1);
const [cru] = await sql('SELECT aprovador_cpf, aprovador_id, aprovador_nome FROM painel_saidas_lotes WHERE id = $1', [r1.lote.id]), decs = await sql('SELECT aprovador_cpf, status FROM painel_saidas_decisoes WHERE lote_id = $1', [r1.lote.id]);
chk('no banco o CPF fica inteiro (auditoria) em cada decisão e no lote, com o id do usuário', cru.aprovador_cpf === CPF_APROV && cru.aprovador_id === 'usr-aprov' && decs.length === 3 && decs.every(d => d.aprovador_cpf === CPF_APROV), cru);
const r1b = await S.finalizar(sessao(), { dia: HOJE, idem: I1, itens: IT({ s3: 'RETIDO' }) });
chk('mesma chave de idempotência (duplo clique / nova tentativa): devolve o MESMO lote, repetido: true, e nada novo é gravado', r1b.repetido === true && r1b.lote.id === r1.lote.id && (await sql('SELECT count(*)::int n FROM painel_saidas_lotes'))[0].n === 1 && (await sql('SELECT count(*)::int n FROM painel_saidas_decisoes'))[0].n === 3, r1b.lote);
const I2 = idem(), [c1, c2] = await Promise.all([S.finalizar(master, { dia: HOJE, idem: I2, itens: IT() }), S.finalizar(master, { dia: HOJE, idem: I2, itens: IT() })]);
chk('duas chamadas AO MESMO TEMPO com a mesma chave: um único lote novo (a outra recebe o mesmo, repetido)', c1.lote.id === c2.lote.id && [c1.repetido, c2.repetido].filter(Boolean).length === 1 && (await sql('SELECT count(*)::int n FROM painel_saidas_lotes WHERE idem = $1', [I2]))[0].n === 1, [c1.repetido, c2.repetido]);
const est = await S.estadoDia(HOJE);
chk('estadoDia: a decisão MAIS RECENTE de cada título vale (a segunda aprovação, do Master, tudo APROVADO) e os 2 lotes do dia aparecem (nada foi apagado)', est.lotes.length === 2 && est.decisoes.s3.status === 'APROVADO' && est.decisoes.s3.por === 'Master Teste' && est.decisoes.s1.loteId === c1.lote.id, est);
const r3 = await S.finalizar(sessao(), { dia: HOJE, idem: idem(), itens: IT({ s1: 'RETIDO', s2: 'RETIDO', s3: 'RETIDO' }) });
const est2 = await S.estadoDia(HOJE);
chk('uma terceira aprovação (tudo RETIDO) vira a decisão vigente; os lotes anteriores continuam gravados', r3.lote.totalAutorizado === 0 && r3.lote.totalRetido === 1350.49 && ['s1', 's2', 's3'].every(id => est2.decisoes[id].status === 'RETIDO') && est2.lotes.length === 3 && (await sql('SELECT count(*)::int n FROM painel_saidas_decisoes'))[0].n === 9, est2.decisoes);
chk('estadoDia: dia inválido → 400; dia sem lotes → vazio', (await erroDe(() => S.estadoDia('ontem')))?.status === 400 && (await S.estadoDia(antes(3))).lotes.length === 0);
const lote = await S.lerLote(r1.lote.id);
chk('lerLote: reabre o relatório do lote; id inexistente → 404; id inválido → 400', lote.itens.length === 3 && (await erroDe(() => S.lerLote(99999999)))?.status === 404 && (await erroDe(() => S.lerLote('abc')))?.status === 400);

/* ---------- nova importação do FCX: os ids mudam, o conteúdo não ---------- */
await gravarFcx(base.map(t => ({ ...t, id: 'novo-' + t.id })));
const est3 = await S.estadoDia(HOJE);
chk('FCX importado de novo (todos os ids mudaram): as decisões acompanham o CONTEÚDO do título e aparecem nos ids novos', ['novo-s1', 'novo-s2', 'novo-s3'].every(id => est3.decisoes[id]?.status === 'RETIDO') && !est3.decisoes.s1, est3.decisoes);
const velho = await erroDe(() => S.finalizar(sessao(), { dia: HOJE, idem: idem(), itens: IT() }));
chk('com os ids antigos (tela desatualizada) → 409: nada é gravado e a tela manda atualizar', velho?.status === 409 && velho.codigo === 'fcx_mudou', velho);

/* ---------- gravação em fatias ---------- */
await gravarFcx(Array.from({ length: 400 }, (_, i) => titulo('g' + i, { valorLiquido: 10 + (i % 7), fornecedor: 'FORNECEDOR ' + (i % 40), item: 'Item ' + i })));
const grande = await S.saidasDoFcx(), itG = [...grande.values()].map((t, i) => ({ id: t.id, status: i % 4 === 0 ? 'RETIDO' : 'APROVADO', valor: t.valor }));
const rG = await S.finalizar(master, { dia: HOJE, idem: idem(), itens: itG });
const somaG = Math.round(itG.reduce((a, x) => a + x.valor * 100, 0)) / 100;
chk('400 títulos num único "Finalizar" (gravação em fatias de 150): todas as decisões gravadas, totais certos, 100 retidos', rG.lote.qtdTotal === 400 && rG.lote.qtdRetidos === 100 && rG.lote.qtdAprovados === 300 && rG.lote.totalPrevisto === somaG && (await sql('SELECT count(*)::int n FROM painel_saidas_decisoes WHERE lote_id = $1', [rG.lote.id]))[0].n === 400 && rG.itens.length === 400, rG.lote);
await gravarFcx(base);

/* =========================================================================== 4 · aviso (Central de Notificações) */
await limpar(); await N.garantirRegras();
const regra = (o) => N.salvarRegra('saidas_aprovadas', o, 'Teste');
const desligar = () => sql(`UPDATE painel_notificacoes_regras SET ativo = false, destinatarios_json = '[]'::jsonb`);
const novoLote = async () => (await S.finalizar(sessao(), { dia: HOJE, idem: idem(), itens: IT({ s3: 'RETIDO' }) })).lote.id;
const estadoLote = async id => (await sql('SELECT notificacao, notificado_em FROM painel_saidas_lotes WHERE id = $1', [id]))[0];
await sql(`DELETE FROM documentos WHERE caminho = 'config/recursos'`); await doc('config/recursos', { gestao_v1400: { ativo: false }, gestao_v1402: { ativo: true } });
await desligar();
let L = await novoLote();
chk('aviso com a Central desligada neste ambiente (recurso gestao_v1400) → { enviado:false, motivo:"modulo_desligado" }, sem erro e sem enviar nada', JSON.stringify(await N.notificarLote(L)) === JSON.stringify({ enviado: false, motivo: 'modulo_desligado' }) && mock.email.length === 0 && (await estadoLote(L)).notificacao === null);
await doc('config/recursos', { gestao_v1400: { ativo: true }, gestao_v1402: { ativo: true } });
const rd = await N.notificarLote(L);
chk('regra do evento desligada (nasce desligada) → motivo "regra_desligada", o lote é marcado e nada é enviado', rd.enviado === false && rd.motivo === 'regra_desligada' && (await estadoLote(L)).notificacao === 'regra_desligada' && mock.email.length === 0, rd);
L = await novoLote();
await regra({ ativo: true, canal: 'EMAIL', destinatarios: [], parametros: { masters: false } });
const sd = await N.notificarLote(L);
chk('regra ligada mas sem destinatário (nenhum papel preenchido e os Masters automáticos desligados) → motivo "sem_destinatarios"', sd.enviado === false && sd.motivo === 'sem_destinatarios' && mock.email.length === 0, sd);
await sql(`UPDATE documentos SET dados = dados || '{"email":"semente@exemplo.test"}'::jsonb WHERE colecao = 'usuarios' AND upper(dados->>'perfil') = 'MASTER' AND coalesce(dados->>'email', '') = ''`); /* a semente tem um Master sem e-mail: o motor registra ERRO para ele (de propósito); aqui todos têm contato */
await doc('funcionarios/f-master-teste', { nome: 'Master Teste', cpf: CPF_MASTER, email: 'master@exemplo.test', telefone: '81 98888-0001' });
await doc('usuarios/usr-master-aviso', { perfil: 'MASTER', nome: 'Master Teste', cpf: CPF_MASTER, funcionarioId: 'f-master-teste', ativo: true, permissoes: {}, trocarSenha: false });
await regra({ ativo: true, canal: 'EMAIL', destinatarios: [{ papel: 'financeiro', nome: 'Financeiro', email: 'financeiro@exemplo.test' }], parametros: { masters: true } });
const nMasters = (await D.contatosMasters()).length, ok = await N.notificarLote(L);
const para = mock.email.map(m => JSON.stringify(m.corpo?.to)).join(' '), corpo0 = JSON.stringify(mock.email[0]?.corpo || {});
chk('regra ligada com Financeiro + Masters automáticos: envia 1 e-mail para cada (Financeiro + todos os Masters ativos), registra no log e marca o lote como "enviado"', nMasters >= 1 && ok.enviado === true && ok.enviados === 1 + nMasters && ok.erros === 0 && ok.destinatarios === 1 + nMasters && mock.email.length === 1 + nMasters && /financeiro@exemplo\.test/.test(para) && /master@exemplo\.test/.test(para) && (await estadoLote(L)).notificacao === 'enviado' && !!(await estadoLote(L)).notificado_em, [ok, para]);
chk('o e-mail leva o PDF "Pagamentos Aprovados" em anexo, o valor liberado e NUNCA o CPF inteiro', /pdf/i.test(corpo0) && /1\.250,50/.test(corpo0) && !corpo0.includes(CPF_APROV) && (await sql(`SELECT count(*)::int n FROM painel_notificacoes_log WHERE evento_chave = 'saidas_aprovadas' AND status = 'SUCESSO'`))[0].n === 1 + nMasters, corpo0.slice(0, 400));
const rep = await N.notificarLote(L);
chk('avisar o mesmo lote de novo → repetido (nenhum e-mail a mais)', rep.repetido === true && rep.enviado === true && mock.email.length === 1 + nMasters, rep);
chk('lote que não existe → 404', (await erroDe(() => N.notificarLote(99999999)))?.status === 404);

/* ---------- rede de segurança do agendador ---------- */
mock.email.length = 0; await limpar(); await desligar();
await regra({ ativo: true, canal: 'EMAIL', destinatarios: [{ papel: 'financeiro', nome: 'Financeiro', email: 'financeiro@exemplo.test' }], parametros: { masters: false } });
const [Lnovo, Lmeio, Lvelho] = [await novoLote(), await novoLote(), await novoLote()];
await sql(`UPDATE painel_saidas_lotes SET criado_em = now() - interval '2 minutes' WHERE id = $1`, [Lnovo]);
await sql(`UPDATE painel_saidas_lotes SET criado_em = now() - interval '20 minutes' WHERE id = $1`, [Lmeio]);
await sql(`UPDATE painel_saidas_lotes SET criado_em = now() - interval '7 hours' WHERE id = $1`, [Lvelho]);
const ag = await N.rodarAgendado({ agora: new Date() }), evento = ag.eventos.find(e => e.chave === 'saidas_aprovadas');
chk('agendador: só o lote sem aviso entre 10 minutos e 6 horas é reenviado (o de 2 min espera o painel; o de 7 h não é mais enviado) e fica "enviado"', evento && evento.envios === 1 && mock.email.length === 1 && (await estadoLote(Lmeio)).notificacao === 'enviado' && (await estadoLote(Lnovo)).notificacao === null && (await estadoLote(Lvelho)).notificacao === null, [evento, mock.email.length]);
const ag2 = await N.rodarAgendado({ agora: new Date() });
chk('agendador de novo: nada é reenviado (idempotente) — o lote já avisado não volta e o de 2 minutos continua esperando', mock.email.length === 1 && (ag2.eventos.find(e => e.chave === 'saidas_aprovadas')?.envios ?? 0) <= 1, ag2.eventos.find(e => e.chave === 'saidas_aprovadas'));

/* ---------- LGPD: nenhuma tabela da aprovação guarda segredo ---------- */
chk('nenhum segredo (chave de e-mail, token do WhatsApp) nas tabelas da aprovação nem no log da Central', (await sql(`SELECT count(*)::int n FROM painel_saidas_lotes WHERE to_jsonb(painel_saidas_lotes)::text ~ 're_TESTE|tok_TESTE'`))[0].n === 0 && (await sql(`SELECT count(*)::int n FROM painel_notificacoes_log WHERE payload_mensagem::text ~ 're_TESTE|tok_TESTE'`))[0].n === 0);

await limpar(); await sql(`DELETE FROM documentos WHERE caminho LIKE 'fcx/esp2:saidas%' OR caminho IN ('config/recursos', 'funcionarios/f-master-teste', 'usuarios/usr-master-aviso')`);
srvEmail.close(); srvWa.close(); await dbLib?.end?.().catch(() => {}); await db.end();
console.log('\nOK (' + OK.length + ')  FALHAS (' + FAIL.length + ')'); process.exit(FAIL.length ? 1 : 0);
