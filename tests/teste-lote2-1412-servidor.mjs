/* v14.12 · Lote 2 · Teste do SERVIDOR com banco (Postgres) e HTTP real (Netlify Functions emuladas por tests/servidor-local.mjs), dados FICTÍCIOS (LGPD):
   A) Salários por árvore do organograma: o gestor de topo lê os salários da PRÓPRIA árvore (e é avisado das mudanças deles) e recebe 403 nos outros setores;
      Master e quem tem "rh.ver_salarios" seguem lendo tudo; recurso gestao_v1412 desligado = regra de antes (403); gravar continua negado.
   B) Aprovação delegada do Financeiro (viagens.aprovar) em /api/contabil/adiantamentos/encerrar: Master e delegado encerram; sem a permissão, fora do
      Financeiro, autoaprovação (viajante ou quem abriu o pedido) e recurso desligado → 403.
   C) Devolução × OFX: encerrar sem o crédito no extrato exige justificativa (422) e grava o evento encerramento_viagem_sem_ofx no Log de Auditoria na mesma
      transação; com o crédito localizado, não pede nada; recurso desligado = comportamento de antes.
   Uso: bash tests/preparar-banco.sh && NETLIFY_DB_URL=… node tests/servidor-local.mjs 8890 & … node tests/teste-lote2-1412-servidor.mjs
   (nenhum segredo aqui: as senhas são as de teste e só existem neste banco descartável) */
import pg from 'pg';
import { gerar } from '../netlify/lib/senha.mjs';
const U = 'http://localhost:8890', OK = [], FAIL = [], SENHA = 'Teste2026Ab';
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x !== '' ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 1000) : '')); };
const db = new pg.Pool({ connectionString: process.env.NETLIFY_DB_URL }), sql = (t, p) => db.query(t, p).then(r => r.rows);
const doc = async (caminho, dados) => { const i = caminho.lastIndexOf('/'); await sql(`INSERT INTO documentos (caminho, colecao, doc_id, dados) VALUES ($1, $2, $3, $4) ON CONFLICT (caminho) DO UPDATE SET dados = EXCLUDED.dados`, [caminho, caminho.slice(0, i), caminho.slice(i + 1), JSON.stringify(dados)]); };
const dv = d => { let s = 0; d.forEach((x, i) => { s += x * (d.length + 1 - i); }); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
const cpf = b9 => { const d = b9.split('').map(Number); d.push(dv(d)); d.push(dv(d)); return d.join(''); }; /* CPFs de teste gerados pelos dígitos verificadores */
const usuario = (id, perfil, c, permissoes = {}, funcionarioId) => doc('usuarios/' + id, { perfil, nome: 'Teste ' + id, cpf: c, ativo: true, permissoes, trocarSenha: false, senha: gerar(SENHA, 'sal-' + id), ...(funcionarioId ? { funcionarioId } : {}) });
async function login(c) { const r = await fetch(U + '/api/sessao', { method: 'POST', headers: { 'content-type': 'application/json', 'x-painel': '1' }, body: JSON.stringify({ cpf: c, senha: SENHA }) }); const k = r.headers.get('set-cookie'); if (!k) throw new Error('login falhou ' + r.status + ' ' + await r.text()); return k.split(';')[0]; }
const cli = ck => async (met, rota, corpo) => { const r = await fetch(U + rota, { method: met, headers: { cookie: ck, 'content-type': 'application/json', 'x-painel': '1' }, body: corpo ? JSON.stringify(corpo) : undefined }); let j = {}; try { j = await r.json(); } catch { } return { s: r.status, j }; };
const recursos = on => doc('config/recursos', on ? { gestao_v1412: { ativo: true }, gestao_v1393: { ativo: true }, gestao_v1394: { ativo: true } } : {});

/* ---------- dados: organograma, salários e usuários ---------- */
const func = (id, nome, departamentoId, x = {}) => doc('funcionarios/' + id, { nome, departamentoId, status: 'Ativo', ...x });
await func('f-g', 'Gerente Financeiro Teste', 'd-fin'); await func('f-x', 'Analista Contas a Pagar Teste', 'd-cp'); await func('f-z', 'Analista Contas a Receber Teste', 'd-cr');
await func('f-fin', 'Aprovador Financeiro Teste', 'd-fin'); await func('f-fin2', 'Outro Aprovador Teste', 'd-fin'); await func('f-y', 'Vendedor Comercial Teste', 'd-com'); await func('f-m', 'Gerente Comercial Teste', 'd-com');
await doc('rh_departamentos/d-fin', { nome: 'Financeiro', responsavelId: 'f-g' }); await doc('rh_departamentos/d-cp', { nome: 'Contas a Pagar', paiId: 'd-fin' }); await doc('rh_departamentos/d-cr', { nome: 'Contas a Receber', paiId: 'd-fin' }); await doc('rh_departamentos/d-com', { nome: 'Comercial', responsavelId: 'f-m' });
for (const [id, v] of [['f-g', 9000], ['f-x', 3000], ['f-z', 3100], ['f-y', 2800], ['f-m', 7000], ['f-fin', 4500]]) await doc('salarios/' + id, { valor: v });
const C = { master: cpf('246813579'), g: cpf('135792468'), fin: cpf('112233445'), fin2: cpf('998877665'), semperm: cpf('314159265'), naofin: cpf('271828182'), global: cpf('161803398'), semfunc: cpf('141421356') };
await usuario('usr-master-12', 'MASTER', C.master);
await usuario('usr-g-12', 'OPERACIONAL', C.g, {}, 'f-g');                                                    /* gestor de topo: sem nenhuma permissão de salário */
await usuario('usr-fin-12', 'OPERACIONAL', C.fin, { viagens: 'modificar', 'viagens.aprovar': true }, 'f-fin'); /* Financeiro com a permissão delegada */
await usuario('usr-fin2-12', 'OPERACIONAL', C.fin2, { viagens: 'modificar', 'viagens.aprovar': true }, 'f-fin2');
await usuario('usr-semperm-12', 'OPERACIONAL', C.semperm, { viagens: 'modificar' }, 'f-x');                  /* Financeiro, mas sem viagens.aprovar (e sem subordinados) */
await usuario('usr-naofin-12', 'OPERACIONAL', C.naofin, { viagens: 'modificar', 'viagens.aprovar': true }, 'f-y'); /* tem a permissão, mas é do Comercial */
await usuario('usr-global-12', 'OPERACIONAL', C.global, { rh: 'ler', 'rh.ver_salarios': true }, 'f-y');      /* permissão global de salários */
await usuario('usr-semfunc-12', 'OPERACIONAL', C.semfunc, { rh: 'ler' });                                    /* sem colaborador vinculado */
const M = cli(await login(C.master)), G = cli(await login(C.g)), F = cli(await login(C.fin)), F2 = cli(await login(C.fin2)), SP = cli(await login(C.semperm)), NF = cli(await login(C.naofin)), GL = cli(await login(C.global)), SF = cli(await login(C.semfunc));

/* ---------- A · salários por árvore ---------- */
await recursos(false);
const a0 = await G('GET', '/api/docs?caminho=salarios/f-x'), a0l = await G('GET', '/api/docs?colecao=salarios');
chk('A1 recurso desligado (Produção/Falco antes da liberação): o gestor de topo continua com 403 no salário do subordinado e na coleção, como na v14.11', a0.s === 403 && a0l.s === 403, [a0.s, a0l.s]);
await recursos(true);
const a1 = await G('GET', '/api/docs?caminho=salarios/f-x'), a2 = await G('GET', '/api/docs?caminho=salarios/f-z'), a3 = await G('GET', '/api/docs?caminho=salarios/f-y'), a4 = await G('GET', '/api/docs?caminho=salarios/f-m');
chk('A2 gestor de topo (Gerente Financeiro) lê o salário de quem está na sua árvore (Contas a Pagar e Contas a Receber) — 200 com o valor', a1.s === 200 && a1.j.doc?.valor === 3000 && a2.s === 200 && a2.j.doc?.valor === 3100, [a1, a2.s]);
chk('A3 …e recebe 403 nos salários de outro setor (Comercial), inclusive o do gestor de lá', a3.s === 403 && a4.s === 403, [a3.s, a4.s]);
const l1 = await G('GET', '/api/docs?colecao=salarios'), ids = (l1.j.docs || []).map(d => d.id).sort();
chk('A4 a listagem da coleção devolve SÓ os salários da árvore do gestor (nada do Comercial nem o do próprio superior/gestor)', l1.s === 200 && ids.includes('f-x') && ids.includes('f-z') && !ids.includes('f-y') && !ids.includes('f-m') && !ids.includes('f-g'), ids);
const gr = await G('PUT', '/api/docs?caminho=salarios/f-x', { dados: { valor: 1 } }), gr2 = await G('DELETE', '/api/docs?caminho=salarios/f-x');
chk('A5 ler pela árvore não dá direito de gravar nem excluir salário: 403', gr.s === 403 && gr2.s === 403, [gr.s, gr2.s]);
const sp = await SP('GET', '/api/docs?caminho=salarios/f-z'), sf = await SF('GET', '/api/docs?caminho=salarios/f-x'), sfl = await SF('GET', '/api/docs?colecao=salarios');
chk('A6 colaborador sem subordinados (ou sem vínculo com um colaborador) não lê nenhum salário: 403', sp.s === 403 && sf.s === 403 && sfl.s === 403, [sp.s, sf.s, sfl.s]);
const gl = await GL('GET', '/api/docs?colecao=salarios'), gl1 = await GL('GET', '/api/docs?caminho=salarios/f-m'), m1 = await M('GET', '/api/docs?colecao=salarios');
chk('A7 permissão global ("Pode ver salários") e Master seguem lendo todos os salários (6) — a regra nova só ACRESCENTA a árvore', gl.s === 200 && gl.j.docs.length === 6 && gl1.s === 200 && m1.s === 200 && m1.j.docs.length === 6, [gl.s, gl.j.docs?.length, m1.j.docs?.length]);
const [{ seq: seq0 }] = await sql(`SELECT COALESCE(max(seq), 0)::bigint AS seq FROM mudancas`);
await M('PUT', '/api/docs?caminho=salarios/f-x', { dados: { valor: 3300 } });
const ch = await G('GET', '/api/mudancas?desde=' + seq0), chSP = await SP('GET', '/api/mudancas?desde=' + seq0), chSF = await SF('GET', '/api/mudancas?desde=' + seq0);
chk('A8 aviso de mudanças: o gestor de topo é avisado da mudança de salário (para atualizar a tela); quem não tem acesso a salário não recebe esse aviso', ch.s === 200 && ch.j.colecoes.includes('salarios') && !chSP.j.colecoes.includes('salarios') && !chSF.j.colecoes.includes('salarios'), [ch.j, chSP.j, chSF.j]);
const l2 = await G('GET', '/api/docs?caminho=salarios/f-x');
chk('A9 o gestor vê o valor novo (R$ 3.300) depois da alteração feita pelo Master', l2.s === 200 && l2.j.doc.valor === 3300);

/* ---------- B · aprovação delegada ao encerrar ---------- */
const viag = (id, quem = 'func-v1', x = {}) => doc('funcionarios/_viagens/pedidos/' + id, { nome: 'VIAJANTE FICTICIO', funcionarioId: quem, destino: 'Cidade Fictícia/PE', ida: '2026-10-05', volta: '2026-10-07', status: 'prestacao_enviada', valor: 1000, valorPago: 1000, pagoData: '2026-10-01',
  pagamento: { modo: 'unico', contas: [{ funcionarioId: quem, nome: 'VIAJANTE FICTICIO', valor: 1000, valorPago: 1000 }] },
  despesas: [{ id: 'd1', data: '2026-10-05', categoria: 'Alimentação', valor: 300, aprovacao: { valor: 300 } }, { id: 'd2', data: '2026-10-06', categoria: 'Hospedagem', valor: 450, aprovacao: { valor: 450 } }], historico: [], ...x });
const lerV = async id => (await M('GET', '/api/docs?caminho=funcionarios/_viagens/pedidos/' + id)).j.doc;
await recursos(true);
for (const id of ['vg-ok', 'vg-self', 'vg-req', 'vg-sp', 'vg-nf', 'vg-off']) await viag(id);
await viag('vg-self', 'f-fin'); await viag('vg-req', 'func-v1', { solicitadoPor: 'usr-fin-12' }); await viag('vg-grupo', 'func-v1', { participantes: [{ funcionarioId: 'func-v1', nome: 'A' }, { funcionarioId: 'f-fin', nome: 'B' }] });
const b1 = await F('POST', '/api/contabil/adiantamentos/encerrar', { viagemId: 'vg-ok' }), vok = await lerV('vg-ok');
chk('B1 o aprovador do Financeiro com viagens.aprovar encerra a prestação de OUTRA pessoa: 200, viagem Concluída, acerto gravado em nome dele', b1.s === 200 && vok.status === 'concluido' && vok.acerto.encerradoPor === 'usr-fin-12' && vok.acerto.aprovado === 750 && !vok.acerto.semOfx, [b1.s, vok?.status, vok?.acerto?.encerradoPor]);
const b2 = await F('POST', '/api/contabil/adiantamentos/encerrar', { viagemId: 'vg-self' }), b2g = await F('POST', '/api/contabil/adiantamentos/encerrar', { viagemId: 'vg-grupo' }), b2r = await F('POST', '/api/contabil/adiantamentos/encerrar', { viagemId: 'vg-req' });
chk('B2 autoaprovação bloqueada no servidor: o aprovador é o viajante, está entre os viajantes de uma viagem em grupo, ou abriu o pedido → 403 e a viagem NÃO é encerrada', [b2, b2g, b2r].every(r => r.s === 403 && /Autoaprovação/.test(r.j.erro || '')) && (await lerV('vg-self')).status === 'prestacao_enviada' && !(await lerV('vg-req')).acerto, [b2.s, b2g.s, b2r.s, b2.j]);
const b2b = await F2('POST', '/api/contabil/adiantamentos/encerrar', { viagemId: 'vg-self' });
chk('B3 outro aprovador do Financeiro (que não é o viajante) encerra a mesma viagem: 200', b2b.s === 200 && (await lerV('vg-self')).status === 'concluido', [b2b.s, b2b.j]);
const b3 = await SP('POST', '/api/contabil/adiantamentos/encerrar', { viagemId: 'vg-sp' }), b4 = await NF('POST', '/api/contabil/adiantamentos/encerrar', { viagemId: 'vg-nf' });
chk('B4 sem viagens.aprovar → 403 ("só o Master"); com a permissão mas fora do setor Financeiro → 403 (mensagem do Financeiro); nenhuma das duas encerra', b3.s === 403 && /Master/.test(b3.j.erro) && b4.s === 403 && /setor Financeiro/.test(b4.j.erro) && (await lerV('vg-sp')).status === 'prestacao_enviada' && (await lerV('vg-nf')).status === 'prestacao_enviada', [b3, b4]);
await recursos(false);
const b5 = await F('POST', '/api/contabil/adiantamentos/encerrar', { viagemId: 'vg-off' }), b5m = await M('POST', '/api/contabil/adiantamentos/encerrar', { viagemId: 'vg-off' });
chk('B5 recurso desligado: o delegado volta a ser barrado (só o Master encerra, como na v14.11); o Master encerra normalmente', b5.s === 403 && /Master/.test(b5.j.erro) && b5m.s === 200, [b5, b5m.s]);
await recursos(true);
const b6 = await F('POST', '/api/contabil/adiantamentos/encerrar', { viagemId: 'vg-ok' });
chk('B6 encerrar de novo → 409 (idempotente também para o delegado)', b6.s === 409, b6);

/* ---------- C · devolução × OFX e Log de Auditoria ---------- */
const dev = (st, x = {}) => ({ devolucao12: { status: st, valor: 250, data: '2026-10-02', ...x } });
await viag('vg-ofx1', 'func-v1', { status: 'aguardando_ofx', ...dev('aguardando_ofx') }); await viag('vg-ofx2', 'func-v1', { status: 'aguardando_ofx', ...dev('aguardando_ofx', { ofx: { encontrado: true, contaId: 'c1', txId: 't1', forca: 'forte' } }) });
await viag('vg-ofx3', 'func-v1', { status: 'aguardando_ofx', ...dev('aguardando_ofx') }); await viag('vg-ofx4', 'func-v1', { status: 'aguardando_ofx', ...dev('aguardando_ofx') }); await viag('vg-leg', 'func-v1', { status: 'prestacao_enviada', ...dev('aguardando_ofx') }); await viag('vg-np', 'func-v1', { status: 'aprovado_pagamento' });
const eventos = async (uid, id) => (await sql(`SELECT dados FROM documentos WHERE caminho LIKE $1`, [`auditoria/${uid}/dias/%`])).flatMap(r => r.dados.eventos || []).filter(e => e.acao === 'encerramento_viagem_sem_ofx' && (!id || e.entidadeId === id));
const c1 = await F('POST', '/api/contabil/adiantamentos/encerrar', { viagemId: 'vg-ofx1' }), c1b = await F('POST', '/api/contabil/adiantamentos/encerrar', { viagemId: 'vg-ofx1', justificativa: 'curta' });
chk('C1 devolução ainda sem o crédito no OFX: encerrar sem justificativa → 422; justificativa curta (menos de 10 caracteres) → 422; nada é encerrado nem auditado', c1.s === 422 && /justifica/i.test(c1.j.erro) && c1b.s === 422 && (await lerV('vg-ofx1')).status === 'aguardando_ofx' && (await eventos('usr-fin-12', 'vg-ofx1')).length === 0, [c1, c1b.s]);
const TXT = 'Comprovante conferido por telefone com o banco do viajante';
const c2 = await F('POST', '/api/contabil/adiantamentos/encerrar', { viagemId: 'vg-ofx1', justificativa: '  ' + TXT + '  ' }), v1 = await lerV('vg-ofx1'), ev1 = await eventos('usr-fin-12', 'vg-ofx1');
chk('C2 com justificativa válida o delegado encerra (200); o acerto guarda a justificativa (aparada), quem e quando; devolução vira "encerrada_sem_ofx"; histórico cita o encerramento antes do crédito', c2.s === 200 && v1.status === 'concluido' && v1.acerto.semOfx?.justificativa === TXT && v1.acerto.semOfx.por === 'usr-fin-12' && !!v1.acerto.semOfx.em && v1.devolucao12.status === 'encerrada_sem_ofx' && v1.historico.some(h => /ANTES do crédito no extrato OFX/.test(h.txt)), [c2.s, v1?.acerto?.semOfx, v1?.devolucao12]);
chk('C3 Log de Auditoria: UM evento encerramento_viagem_sem_ofx no ramo do usuário (auditoria/<uid>/dias/<dia>), com a viagem, a justificativa e o valor esperado', ev1.length === 1 && ev1[0].modulo === 'viagens' && ev1[0].entidadeId === 'vg-ofx1' && ev1[0].uid === 'usr-fin-12' && ev1[0].mudancas.some(m => m.campo === 'justificativa' && m.para === TXT) && ev1[0].mudancas.some(m => m.campo === 'devolução esperada' && m.para === '250'), ev1);
const mud = await sql(`SELECT count(*)::int AS n FROM mudancas WHERE caminho LIKE 'auditoria/usr-fin-12/dias/%'`);
chk('C4 a auditoria avisa os painéis abertos (mudancas) e foi gravada na mesma transação do encerramento (a viagem já está Concluída)', mud[0].n >= 1 && v1.status === 'concluido', mud);
const c5 = await F('POST', '/api/contabil/adiantamentos/encerrar', { viagemId: 'vg-ofx2' }), v2 = await lerV('vg-ofx2');
chk('C5 crédito já localizado no extrato (devolucao12.ofx.encontrado): encerra sem justificativa (200), devolução "confirmada_ofx" e NENHUM evento sem OFX é gravado', c5.s === 200 && v2.devolucao12.status === 'confirmada_ofx' && !v2.acerto.semOfx && (await eventos('usr-fin-12', 'vg-ofx2')).length === 0, [c5.s, v2?.devolucao12?.status]);
const c6 = await M('POST', '/api/contabil/adiantamentos/encerrar', { viagemId: 'vg-ofx3' }), c6b = await M('POST', '/api/contabil/adiantamentos/encerrar', { viagemId: 'vg-ofx3', justificativa: 'Master confirmou o recebimento no app do banco' }), evM = await eventos('usr-master-12', 'vg-ofx3');
chk('C6 a regra vale para o Master também: sem justificativa → 422; com justificativa → 200 e evento no ramo da auditoria dele', c6.s === 422 && c6b.s === 200 && evM.length === 1 && evM[0].perfil === 'GESTOR', [c6.s, c6b.s, evM.length]);
const c7 = await M('POST', '/api/contabil/adiantamentos/encerrar', { viagemId: 'vg-np' });
chk('C7 adiantamento ainda não pago (Aprovado para Pagamento) não é encerrado: 422', c7.s === 422 && /depois do pagamento/.test(c7.j.erro), c7);
await recursos(false);
const c8 = await M('POST', '/api/contabil/adiantamentos/encerrar', { viagemId: 'vg-leg' }), v8 = await lerV('vg-leg');
chk('C8 recurso desligado: encerrar com devolução "aguardando OFX" funciona como na v14.11 — sem exigir justificativa, sem evento de auditoria e sem marcar semOfx', c8.s === 200 && !v8.acerto.semOfx && v8.status === 'concluido' && (await eventos('usr-master-12', 'vg-leg')).length === 0 && v8.devolucao12.status === 'confirmada_ofx', [c8.s, v8?.devolucao12]);
await recursos(true);
const c9 = await F('POST', '/api/contabil/adiantamentos/encerrar', { viagemId: 'vg-ofx4', justificativa: 'x'.repeat(900) }), v9 = await lerV('vg-ofx4');
chk('C9 justificativa enorme é limitada a 500 caracteres antes de gravar (acerto e auditoria)', c9.s === 200 && v9.acerto.semOfx.justificativa.length === 500, v9?.acerto?.semOfx?.justificativa?.length);

console.log('\nOK (' + OK.length + ')  FALHAS (' + FAIL.length + ')'); await db.end(); process.exit(FAIL.length ? 1 : 0);
