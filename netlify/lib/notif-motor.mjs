/* v14.00 · Motor da Central de Notificações: decide o que está na hora, monta as mensagens, envia por e-mail/WhatsApp e registra
   tudo no log. É usado por duas funções do Netlify:
     · notificacoes-agendadas.mjs (cron a cada 5 minutos)  → rodarAgendado()
     · notificar.mjs (/api/notificar, só Master)           → estado, salvar regra, testar disparo, logs, reenviar, publicar snapshot

   Garantias:
     · Horários são de Brasília. O cron roda a cada 5 min; um evento "pega o trem" por JANELA_HORAS_PADRAO (3 h) depois da hora marcada
       (se uma rodada falhar ou o deploy atrasar, a seguinte ainda envia) e, depois de avaliado no dia, não roda de novo (ultima_rodada_em).
     · Idempotente: cada fato (viagem, semana, dia, falta…) tem uma "referência"; o par evento + referência + canal + destinatário só é
       enviado uma vez. Erro transitório (rede, 429, 5xx) é repetido até MAX_TENTATIVAS vezes, com INTERVALO_TENTATIVA_MIN entre elas;
       erro de configuração/destino/recusa NÃO é repetido (aparece no log, e o Master pode "Reenviar").
     · A falta de chaves de API nunca derruba nada: o envio vira uma linha ERRO no log com o aviso amigável ("defina NOTIFICACAO_…").
     · Uma rodada por vez (advisory lock) e orçamento de tempo de ORCAMENTO_MS (a função agendada do Netlify tem 30 s): o que sobrar
       fica para a rodada seguinte.
     · Só roda onde o recurso gestao_v1400 está ativo (Homologação sempre; Produção e Falco depois de "Liberar Versão em Produção"). */
import { q, db } from './db.mjs';
import { ambienteAtual } from './ambiente.mjs';
import { ErroHttp } from './http.mjs';
import { EVENTOS, POR_CHAVE, padraoParametros, sanearParametros, sanearDestinatarios, sanearCanal, JANELA_HORAS_PADRAO, MAX_TENTATIVAS, INTERVALO_TENTATIVA_MIN, RETENCAO_LOG_DIAS, FUSO } from './notif-catalogo.mjs';
import { ErroEnvio, enviarEmail, enviarWhatsApp, estadoConfig, emailValido, normalizarTelefone, limpar, mascararEmail, mascararTelefone, ROTULO_PROVEDOR } from './notif-provedores.mjs';
import * as D from './notif-dados.mjs';
import * as M from './notif-mensagens.mjs';
import { IEO } from './notif-ieo.mjs';

export const RECURSO = 'gestao_v1400';
export const ORCAMENTO_MS = 24000;
export const MAX_ENVIOS_RODADA = 60;
const CHAVE_TRAVA = 'painel_notificacoes_motor';
const MAX_ANEXOS_BYTES = 450000;     // anexos (base64) maiores que isto não são guardados no log (o reenvio sai sem o PDF e avisa)
const MAX_TESTES_HORA = 20;

/* ----------------------------------------------------------------- recurso / ambiente */
export async function moduloAtivo() {
  if (ambienteAtual() === 'homolog') return true;
  const r = await D.documento('config/recursos');
  return !!r?.[RECURSO]?.ativo;
}
const prefixo = teste => { const p = [teste && '[TESTE]', ambienteAtual() === 'homolog' && '[Homologação]'].filter(Boolean).join(' '); return { assunto: p ? p + ' ' : '', wa: p ? `_${p}_\n` : '' }; };

/* ----------------------------------------------------------------- regras */
const projetarRegra = (ev, r) => ({
  chave: ev.chave, existe: !!r, ativo: !!r?.ativo, canal: sanearCanal(r?.canal, ev), frequencia: ev.frequencia,
  destinatarios: sanearDestinatarios(ev, r?.destinatarios_json), parametros: sanearParametros(ev, r?.parametros_json),
  ultimoEnvio: r?.ultimo_envio ? new Date(r.ultimo_envio).toISOString() : null, ultimaRodadaEm: r?.ultima_rodada_em ? new Date(r.ultima_rodada_em).toISOString() : null, ultimaRodadaResumo: r?.ultima_rodada_resumo || '',
  atualizadoEm: r?.atualizado_em ? new Date(r.atualizado_em).toISOString() : null, atualizadoPor: r?.atualizado_por || '',
});
/** Cria, uma vez, a linha de cada evento do catálogo — sempre DESLIGADA e sem destinatários: nada sai antes de o Master ligar. */
export async function garantirRegras() {
  const vals = [], params = [];
  EVENTOS.forEach((ev, i) => { const b = i * 4; vals.push(`($${b + 1}, $${b + 2}, false, '[]'::jsonb, $${b + 3}::jsonb, $${b + 4}, 'sistema')`); params.push(ev.chave, ev.canal, JSON.stringify(padraoParametros(ev)), ev.frequencia); });
  await q(`INSERT INTO painel_notificacoes_regras (evento_chave, canal, ativo, destinatarios_json, parametros_json, frequencia, atualizado_por) VALUES ${vals.join(', ')} ON CONFLICT (evento_chave) DO NOTHING`, params);
}
export async function lerRegras() {
  const rows = await q('SELECT * FROM painel_notificacoes_regras');
  return EVENTOS.map(ev => projetarRegra(ev, rows.find(r => r.evento_chave === ev.chave)));
}
const temDestino = (ev, regra) => regra.destinatarios.length > 0 || (ev.automaticos || []).some(a => regra.parametros[a.k]);

export async function salvarRegra(chave, entrada = {}, por = '') {
  const ev = POR_CHAVE[chave]; if (!ev) throw new ErroHttp(404, 'Evento desconhecido.');
  await garantirRegras();
  const [row] = await q('SELECT * FROM painel_notificacoes_regras WHERE evento_chave = $1', [chave]), atual = projetarRegra(ev, row);
  const ativo = entrada.ativo === undefined ? atual.ativo : entrada.ativo === true;
  const canal = entrada.canal === undefined ? atual.canal : sanearCanal(entrada.canal, ev);
  const destinatarios = entrada.destinatarios === undefined ? atual.destinatarios : sanearDestinatarios(ev, entrada.destinatarios);
  for (const d of destinatarios) {
    if (d.email && !emailValido(d.email)) throw new ErroHttp(400, `E-mail inválido: ${d.email}`);
    if (d.telefone && !normalizarTelefone(d.telefone)) throw new ErroHttp(400, `Telefone inválido: ${d.telefone}. Use DDD + número (ex.: 11 99999-0000).`);
  }
  const parametros = entrada.parametros === undefined ? atual.parametros : sanearParametros(ev, { ...atual.parametros, ...entrada.parametros });
  await q(`UPDATE painel_notificacoes_regras SET ativo = $2, canal = $3, destinatarios_json = $4::jsonb, parametros_json = $5::jsonb, atualizado_em = now(), atualizado_por = $6 WHERE evento_chave = $1`,
    [chave, ativo, canal, JSON.stringify(destinatarios), JSON.stringify(parametros), String(por || '').slice(0, 80) || null]);
  const [nova] = await q('SELECT * FROM painel_notificacoes_regras WHERE evento_chave = $1', [chave]), regra = projetarRegra(ev, nova), avisos = [];
  const cfg = estadoConfig(), canais = canal === 'AMBOS' ? ['email', 'whatsapp'] : [canal === 'EMAIL' ? 'email' : 'whatsapp'];
  if (regra.ativo && !temDestino(ev, regra)) avisos.push('O evento está ligado, mas não há destinatários: cadastre ao menos um e-mail/telefone ou marque o destinatário automático.');
  for (const c of canais) if (regra.ativo && !cfg[c].configurado) avisos.push(`${c === 'email' ? 'E-mail' : 'WhatsApp'} ainda não configurado neste ambiente (faltam ${cfg[c].faltam.join(' e ')}): enquanto isso, os envios aparecem como aviso no log.`);
  return { regra, avisos };
}

/* ----------------------------------------------------------------- janelas de horário */
const minutos = h => { const [a, b] = String(h || '00:00').split(':').map(Number); return a * 60 + b; };
/** O evento está dentro da janela de envio de hoje? (IMEDIATA: sempre.) */
export function estaNaHora(ev, regra, brt, janelaHoras = JANELA_HORAS_PADRAO) {
  if (ev.frequencia === 'IMEDIATA') return true;
  const ini = minutos(regra.parametros.horario);
  if (brt.min < ini || brt.min >= ini + janelaHoras * 60) return false;
  if (ev.frequencia === 'SEMANAL' && brt.dow !== Number(regra.parametros.diaSemana)) return false;
  return true;
}
export const rodadaFeitaHoje = (ev, regra, brt) => ev.frequencia !== 'IMEDIATA' && !!regra.ultimaRodadaEm && D.agoraBRT(new Date(regra.ultimaRodadaEm)).iso === brt.iso;

/* ----------------------------------------------------------------- destinatários */
const fixos = (regra, papel) => regra.destinatarios.filter(d => d.papel === papel).map(d => ({ nome: d.nome || '', email: d.email || '', telefone: d.telefone || '', papel }));
const chaveContato = d => { const e = d.email ? 'e:' + String(d.email).toLowerCase() : '', t = normalizarTelefone(d.telefone) ? 't:' + normalizarTelefone(d.telefone) : ''; return e || t ? `${e}|${t}` : 'n:' + (d.nome || ''); };
const unir = (...ls) => { const vistos = new Set(), out = []; for (const d of ls.flat()) { if (!d) continue; const k = chaveContato(d); if (vistos.has(k)) continue; vistos.add(k); out.push(d); } return out; };
const semContato = d => !d.email && !normalizarTelefone(d.telefone);
const slug = t => D.chaveNome(t).toLowerCase().replace(/\s+/g, '-').slice(0, 40) || 'x';

/* ----------------------------------------------------------------- coletores: um por evento → [{ referencia, destinos, conteudo, conteudoCopia?, meta?, falhas? }] */
const viagens = async c => D.viagensAguardando({ pedidos: await c.col('funcionarios/_viagens/pedidos'), parametros: await c.doc('funcionarios/_viagens/parametros/diarias'), funcionarios: await c.col('funcionarios'), hoje: c.hoje });
const dadosViagem = (v, p) => ({ nome: p.nome, rota: v.rota, ida: v.ida, volta: v.volta, limite: v.limite, adiantado: v.adiantado });

async function idsJaAvisados(evento) {
  const rows = await q(`SELECT DISTINCT jsonb_array_elements_text(payload_mensagem->'meta'->'ids') AS id FROM painel_notificacoes_log WHERE evento_chave = $1 AND status = 'SUCESSO' AND NOT teste AND jsonb_typeof(payload_mensagem->'meta'->'ids') = 'array'`, [evento]);
  return new Set(rows.map(r => r.id));
}
const hash = t => { let h = 5381; for (const ch of String(t)) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0; return h.toString(36); };

const COLETORES = {
  async viagem_lembrete_prestacao(c, regra) {
    const lista = await viagens(c), dias = regra.parametros.diasAntes, copia = fixos(regra, 'copia'), out = [];
    for (const v of lista) {
      if (v.excedida || !dias.includes(v.dias)) continue;
      for (const p of v.pessoas) {
        const destinos = unir(regra.parametros.colaborador ? [p] : [], copia); if (!destinos.length) continue;
        const b = { ...dadosViagem(v, p), dias: v.dias };
        out.push({ referencia: `viagem:${v.id}:lembrete:${v.dias}:${p.funcionarioId || slug(p.nome)}`, destinos, conteudo: M.msgViagemLembrete(b), conteudoCopia: M.msgViagemLembrete({ ...b, copia: true }) });
      }
    }
    return out;
  },
  async viagem_prazo_excedido(c, regra) {
    const lista = (await viagens(c)).filter(v => v.excedida), n = Number(regra.parametros.repetirACadaDias) || 0, out = [];
    for (const v of lista) {
      /* uma vez só (n = 0): avisa quem passou do prazo há até 3 dias — o histórico antigo não dispara uma enxurrada quando o evento é ligado */
      if (n === 0 && v.atraso > 3) continue;
      const bucket = n > 0 ? Math.floor((v.atraso - 1) / n) : 0;
      for (const p of v.pessoas) {
        const destinos = regra.parametros.colaborador ? [p] : []; if (!destinos.length) continue;
        out.push({ referencia: `viagem:${v.id}:excedida:${p.funcionarioId || slug(p.nome)}:${bucket}`, destinos, conteudo: M.msgViagemExcedida({ ...dadosViagem(v, p), atraso: v.atraso }) });
      }
    }
    const tes = fixos(regra, 'tesouraria');
    if (tes.length && lista.length) {
      const ja = await idsJaAvisados('viagem_prazo_excedido'), novas = lista.filter(v => !ja.has(String(v.id))).sort((a, b) => b.atraso - a.atraso);
      if (novas.length) out.push({ referencia: `viagens:excedidas:${hash(novas.map(v => v.id).sort().join(','))}`, destinos: tes, meta: { ids: novas.map(v => String(v.id)) },
        conteudo: M.msgViagemResumo({ novas, pendentes: lista.length, valorTotal: lista.reduce((a, v) => a + v.adiantado, 0), hoje: c.hoje }) });
    }
    return out;
  },
  async ieo_regional_semanal(c, regra) {
    const base = await c.ieoBase(), mes = c.hoje.slice(0, 7), anterior = D.somarDias(mes + '-01', -1).slice(0, 7), comAnterior = Number(c.hoje.slice(8, 10)) <= 7;
    const agora = c.agora.ms, calc = async m => D.ieoPorRegional({ mes: m, dados: { ...base, fechamento: await D.lerFechamentoIeo(m) }, hoje: c.hoje });
    const atual = await calc(mes), ant = comAnterior ? await calc(anterior) : null, copia = fixos(regra, 'copia'), out = [];
    for (const r of atual.regionais) {
      const rAnt = ant?.regionais.find(x => x.regional === r.regional);
      const secao = (x, m, fechado, rot, mediaRede) => ({ mes: m, fechado, rotulo: rot, media: x.media, mediaRede, cont: x.cont, linhas: x.linhas });
      const secoes = [secao(r, mes, atual.fechado, `${D.mesPorExtenso(mes)} (${atual.fechado ? 'fechado' : 'acumulado até ontem'})`, atual.mediaRede)];
      if (rAnt) secoes.push(secao(rAnt, anterior, ant.fechado, `Fechamento de ${D.mesPorExtenso(anterior)}`, ant.mediaRede));
      const ref = `ieo:${c.hoje}:${slug(r.regional)}`, conteudo = M.msgIeoRegional({ regional: r.regional, secoes, mediaRede: atual.mediaRede, agora });
      const quem = regra.parametros.regional ? (r.contato && !semContato(r.contato) ? [r.contato] : []) : [];
      const falhas = regra.parametros.regional && !quem.length ? [{ quem: `Regional ${r.regional}`, detalhe: r.pessoa ? `O cadastro de ${r.pessoa.nome} (Supervisor regional das lojas ${r.lojas.map(l => l.codigo).join(', ')}) não tem e-mail nem telefone.` : `O Supervisor regional "${r.regional}" (lojas ${r.lojas.map(l => l.codigo).join(', ')}) não foi encontrado no cadastro de colaboradores. Cadastre o colaborador com o mesmo nome para receber o IEO.` }] : [];
      const destinos = unir(quem, copia); if (!destinos.length && !falhas.length) continue;
      out.push({ referencia: ref, destinos, conteudo, falhas });
    }
    return out;
  },
  async solicitacoes_sla_manha(c, regra) {
    const itens = D.solicitacoesAcimaSla({ solicitacoes: await c.col('solicitacoes'), lojas: await c.col('lojas'), hoje: c.hoje, slaDias: regra.parametros.slaDias }), destinos = fixos(regra, 'gestores');
    if (!itens.length || !destinos.length) return [];
    return [{ referencia: `sol:${c.hoje}`, destinos, conteudo: M.msgSolicitacoes({ itens, slaDias: regra.parametros.slaDias, hoje: c.hoje }) }];
  },
  async relatorio_matinal_executivo(c, regra) {
    const destinos = fixos(regra, 'diretoria'); if (!destinos.length) return [];
    const ontem = D.somarDias(c.hoje, -1), base = await c.ieoBase();
    const snapHoje = await D.lerInstantaneo('recebivel:' + c.hoje), snapRow = snapHoje || await D.ultimoInstantaneoRecebivel(), snap = snapRow ? { ...snapRow.dados, em: snapRow.dados.em || new Date(snapRow.gerado_em).toISOString() } : null;
    const matriz = IEO.matriz(base.configIeo);
    const conteudo = M.msgExecutivo({ dia: c.hoje, ontem, snap, snapAtual: !!snapHoje, agora: c.agora.ms,
      faltas: D.resumoFaltas({ faltasDocs: base.faltasDocs, lojas: base.lojas, ontem, mes: ontem.slice(0, 7) }),
      pend: D.pendenciasRetaguarda({ cofre: base.cofre, feed: base.feed, dep: base.dep, matriz, hoje: c.hoje, agora: c.agora.ms }),
      divCred: D.divergenciasCredsystem({ credsystemDocs: base.credsystemDocs, dia: ontem }) });
    return [{ referencia: `exec:${c.hoje}`, destinos, conteudo }];
  },
  async rh_dobra_ferias(c, regra) {
    const funcionarios = await c.col('funcionarios'), lojas = await c.col('lojas'), cargos = await c.cargos(), rh = fixos(regra, 'rh'), out = [];
    for (const x of D.feriasDobra({ funcionarios, hoje: c.hoje, diasAntes: regra.parametros.diasAntes })) {
      const loja = lojas.find(l => l.id === x.f.lotacao), ger = regra.parametros.loja ? D.gerenteDaLoja(x.f.lotacao, { lojas, funcionarios, cargos }) : null;
      const destinos = unir(rh, ger && ger.funcionarioId !== x.f.id ? [{ ...ger, papel: 'loja' }] : []); if (!destinos.length) continue;
      out.push({ referencia: `ferias:dobra:${x.f.id}:${x.limite}:${x.dias}`, destinos, conteudo: M.msgFeriasDobra({ nome: x.f.nome, loja: loja ? `${loja.codigo} · ${loja.nome}` : '', limite: x.limite, dias: x.dias, pendentes: x.pendentes }) });
    }
    return out;
  },
  async rh_inicio_ferias(c, regra) {
    const funcionarios = await c.col('funcionarios'), rh = fixos(regra, 'rh').map(d => ({ ...d, papel: 'copia' })), out = [];
    for (const x of D.feriasComecando({ funcionarios, hoje: c.hoje, diasAntes: regra.parametros.diasAntes })) {
      const destinos = unir(regra.parametros.colaborador ? [D.contatoDe(x.f, 'colaborador')] : [], rh); if (!destinos.length) continue;
      const b = { nome: x.f.nome, inicio: x.periodo.inicio, fim: x.periodo.fim, dias: regra.parametros.diasAntes };
      out.push({ referencia: `ferias:inicio:${x.f.id}:${x.periodo.inicio}`, destinos, conteudo: M.msgFeriasInicio(b), conteudoCopia: M.msgFeriasInicio({ ...b, copia: true }) });
    }
    return out;
  },
  async falta_caixa_tolerancia(c, regra) {
    const destinos = fixos(regra, 'tesouraria'); if (!destinos.length) return [];
    const faltasDocs = await c.col('faltas'), desde = D.somarDias(c.hoje, -3), dias = [...new Set(D.itensFaltas(faltasDocs).filter(i => i.data && i.data >= desde).map(i => i.data))];
    if (!dias.length) return [];
    const itens = D.faltasAcimaTolerancia({ faltasDocs, credsystemDocs: await D.colecaoPorIds('credsystem', dias), lojas: await c.col('lojas'), hoje: c.hoje, toleranciaPct: regra.parametros.toleranciaPct, valorSemBase: regra.parametros.valorSemBase, janelaDias: 3 });
    return itens.map(i => ({ referencia: `falta:${i.id}`, destinos, conteudo: M.msgFaltaCaixa({ ...i, toleranciaPct: regra.parametros.toleranciaPct, valorSemBase: regra.parametros.valorSemBase }) }));
  },
  async backup_nuvem_status(c, regra) {
    const destinos = fixos(regra, 'ti'); if (!destinos.length) return [];
    const ponto = await D.ultimoBackupAutomatico(), horas = ponto ? (c.agora.ms - new Date(ponto.data_hora).getTime()) / 36e5 : null, max = Number(regra.parametros.horasMaximas) || 26, ok = !!ponto && horas <= max;
    return [{ referencia: `backup:${c.hoje}`, destinos, conteudo: M.msgBackup({ ok, ponto, horas, horasMaximas: max, dia: c.hoje }) }];
  },
};

/* ----------------------------------------------------------------- contexto de uma rodada (com cache dos documentos lidos) */
function criarContexto({ agora = new Date(), opcoes = {}, orcamentoMs = ORCAMENTO_MS } = {}) {
  const brt = D.agoraBRT(agora), cache = new Map(), memo = (k, fn) => { if (!cache.has(k)) cache.set(k, fn()); return cache.get(k); };
  const inicio = Date.now();
  return { agora: brt, hoje: brt.iso, opcoes, fim: inicio + orcamentoMs, cortado: false, enviosFeitos: 0,
    col: nome => memo('c:' + nome, () => D.colecao(nome)), doc: caminho => memo('d:' + caminho, () => D.documento(caminho)), cargos: () => memo('cargos', () => D.lerCargos()), ieoBase: () => memo('ieo', () => D.lerBaseIeo()) };
}

/* ----------------------------------------------------------------- log + envio */
const primeiraLinha = t => String(t || '').split('\n').map(l => l.replace(/[*_]/g, '').trim()).find(Boolean) || '(mensagem)';
async function gravarLog({ canal, evento, destinatario, titulo, payload, status, erro = null, referencia = null, reenvioDe = null, teste = false, tentativa = 1, idExterno = null }) {
  const [r] = await q(`INSERT INTO painel_notificacoes_log (canal, evento_chave, destinatario, titulo, payload_mensagem, status, detalhe_erro, referencia, reenvio_de, teste, tentativa, id_externo)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12) RETURNING id, data_hora`,
    [canal, evento, String(destinatario).slice(0, 200), String(titulo).slice(0, 300), JSON.stringify(payload), status, erro ? String(erro).slice(0, 600) : null, referencia, reenvioDe, teste, tentativa, idExterno]);
  return r;
}
const guardarAnexos = anexos => { const l = (anexos || []).map(a => ({ nome: a.nome, tipo: a.tipo, base64: a.base64 })), total = l.reduce((s, a) => s + a.base64.length, 0); return total <= MAX_ANEXOS_BYTES ? { anexos: l } : { anexos: [], anexoOmitido: l.map(a => a.nome) }; };

/**
 * Envia UMA mensagem por UM canal para UM destinatário e grava a linha do log (SUCESSO ou ERRO). Nunca lança: o resultado vem no log.
 * `pronto`: o conteúdo já carrega os prefixos [TESTE]/[Homologação] (reenvio e nova tentativa reaproveitam o que foi guardado).
 */
export async function enviarUm(c, { evento, referencia = null, canal, destino, conteudo, teste = false, reenvioDe = null, tentativa = 1, pronto = false, meta = {} }) {
  const email = canal === 'EMAIL', dest = email ? String(destino.email || '').trim().toLowerCase() : normalizarTelefone(destino.telefone), pref = pronto ? { assunto: '', wa: '' } : prefixo(teste);
  const guardados = email ? guardarAnexos(conteudo.anexos) : {};
  const payload = email ? { nome: destino.nome || '', papel: destino.papel || '', assunto: pref.assunto + conteudo.assunto, html: conteudo.html, texto: conteudo.texto, ...guardados, meta: { ...meta } }
    : { nome: destino.nome || '', papel: destino.papel || '', texto: pref.wa + conteudo.whatsapp, meta: { ...meta } };
  const titulo = email ? payload.assunto : primeiraLinha(payload.texto);
  const aGravar = dest || `(sem ${email ? 'e-mail' : 'telefone'}) ${destino.nome || ''}`.trim();
  let status = 'SUCESSO', erro = null, idExterno = null;
  try {
    if (!dest) throw new ErroEnvio('DESTINO', email ? `${destino.nome ? destino.nome + ' não tem' : 'Este destinatário não tem'} e-mail cadastrado.` : `${destino.nome ? destino.nome + ' não tem' : 'Este destinatário não tem'} telefone cadastrado.`);
    const r = email ? await enviarEmail({ para: dest, assunto: payload.assunto, html: payload.html, texto: payload.texto, anexos: conteudo.anexos || [] }, c.opcoes)
      : await enviarWhatsApp({ para: dest, texto: payload.texto }, c.opcoes);
    idExterno = r.idExterno || null;
  } catch (e) {
    status = 'ERRO';
    const conhecido = e instanceof ErroEnvio;
    erro = conhecido ? e.amigavel : 'Falha inesperada ao enviar: ' + limpar(e?.message || e);
    payload.meta.erroTipo = conhecido ? e.tipo : 'INTERNO'; payload.meta.transitorio = !!(conhecido && e.transitorio);
  }
  const r = await gravarLog({ canal, evento, destinatario: aGravar, titulo, payload, status, erro, referencia, reenvioDe, teste, tentativa, idExterno });
  if (status === 'SUCESSO' && !teste) await q('UPDATE painel_notificacoes_regras SET ultimo_envio = now() WHERE evento_chave = $1', [evento]);
  c.enviosFeitos++;
  return { id: Number(r.id), canal, destinatario: aGravar, nome: destino.nome || '', status, erro, tipoErro: payload.meta.erroTipo || null };
}

async function chavesFeitas(evento, refs) {
  if (!refs.length) return new Set();
  const rows = await q(`SELECT referencia, canal, destinatario FROM painel_notificacoes_log WHERE evento_chave = $1 AND NOT teste AND referencia = ANY($2::text[])`, [evento, refs]);
  return new Set(rows.map(r => `${r.referencia}|${r.canal}|${r.destinatario}`));
}
/** Para cada destinatário usa os canais da regra em que ele tem contato (AMBOS: o que tiver); sem nenhum contato, vira um aviso no log. */
function canaisDe(regra, destino) {
  const base = regra.canal === 'AMBOS' ? ['EMAIL', 'WHATSAPP'] : [regra.canal], com = base.filter(ch => (ch === 'EMAIL' ? !!destino.email : !!normalizarTelefone(destino.telefone)));
  return com.length ? com : [base[0]];
}
const destDe = (canal, d) => (canal === 'EMAIL' ? String(d.email || '').trim().toLowerCase() : normalizarTelefone(d.telefone)) || `(sem ${canal === 'EMAIL' ? 'e-mail' : 'telefone'}) ${d.nome || ''}`.trim();

async function despachar(c, ev, regra, envios) {
  const refs = envios.flatMap(e => [e.referencia, ...(e.falhas || []).map(f => `${e.referencia}:cadastro:${slug(f.quem)}`)]), feitos = await chavesFeitas(ev.chave, refs), r = { enviados: 0, erros: 0, pulados: 0, completo: true };
  const cabe = () => { if (Date.now() > c.fim || c.enviosFeitos >= MAX_ENVIOS_RODADA) { c.cortado = true; return false; } return true; };
  for (const e of envios) {
    for (const f of e.falhas || []) {
      const ref = `${e.referencia}:cadastro:${slug(f.quem)}`, canal = regra.canal === 'AMBOS' ? 'EMAIL' : regra.canal;
      if (feitos.has(`${ref}|${canal}|${f.quem}`)) { r.pulados++; continue; }
      if (!cabe()) { r.completo = false; break; }
      await gravarLog({ canal, evento: ev.chave, destinatario: f.quem, titulo: `Sem destinatário: ${f.quem}`, payload: { nome: f.quem, papel: 'regional', meta: { erroTipo: 'DESTINO', transitorio: false } }, status: 'ERRO', erro: f.detalhe, referencia: ref }); c.enviosFeitos++; r.erros++;
    }
    for (const d of e.destinos) {
      for (const canal of canaisDe(regra, d)) {
        if (feitos.has(`${e.referencia}|${canal}|${destDe(canal, d)}`)) { r.pulados++; continue; }
        if (!cabe()) { r.completo = false; break; }
        const conteudo = d.papel === 'copia' && e.conteudoCopia ? e.conteudoCopia : e.conteudo;
        const x = await enviarUm(c, { evento: ev.chave, referencia: e.referencia, canal, destino: d, conteudo, meta: e.meta || {} });
        if (x.status === 'SUCESSO') r.enviados++; else r.erros++;
      }
      if (!r.completo) break;
    }
    if (!r.completo) break;
  }
  return r;
}

/* ----------------------------------------------------------------- nova tentativa dos erros transitórios */
export async function repetirTransitorios(c, regras) {
  const ativos = new Set(regras.filter(r => r.ativo).map(r => r.chave));
  const rows = await q(`SELECT e.id, e.canal, e.evento_chave, e.destinatario, e.referencia, e.tentativa, e.payload_mensagem FROM painel_notificacoes_log e
    WHERE e.status = 'ERRO' AND NOT e.teste AND e.referencia IS NOT NULL AND e.payload_mensagem->'meta'->>'transitorio' = 'true' AND e.tentativa < $1
      AND e.data_hora <= now() - make_interval(mins => $2) AND e.data_hora > now() - interval '6 hours'
      AND NOT EXISTS (SELECT 1 FROM painel_notificacoes_log n WHERE n.evento_chave = e.evento_chave AND n.referencia = e.referencia AND n.canal = e.canal AND n.destinatario = e.destinatario AND n.id > e.id AND NOT n.teste)
    ORDER BY e.id LIMIT 20`, [MAX_TENTATIVAS, INTERVALO_TENTATIVA_MIN]);
  let n = 0;
  for (const r of rows) {
    if (!ativos.has(r.evento_chave) || Date.now() > c.fim || c.enviosFeitos >= MAX_ENVIOS_RODADA) continue;
    const p = r.payload_mensagem || {}, destino = r.canal === 'EMAIL' ? { nome: p.nome, papel: p.papel, email: r.destinatario } : { nome: p.nome, papel: p.papel, telefone: r.destinatario };
    const conteudo = r.canal === 'EMAIL' ? { assunto: p.assunto, html: p.html, texto: p.texto, anexos: p.anexos || [] } : { whatsapp: p.texto };
    await enviarUm(c, { evento: r.evento_chave, referencia: r.referencia, canal: r.canal, destino, conteudo, tentativa: r.tentativa + 1, pronto: true, meta: { ...(p.meta || {}), erroTipo: undefined, transitorio: undefined } }); n++;
  }
  return n;
}

/* ----------------------------------------------------------------- trava e rodada agendada */
async function comTrava(fn) {
  const cli = await db().pool.connect(); let travou = false;
  try {
    const { rows: [r] } = await cli.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [CHAVE_TRAVA]); travou = !!r.ok;
    if (!travou) return { ok: true, ocupado: true, motivo: 'outra rodada está em andamento' };
    return await fn();
  } finally { if (travou) { try { await cli.query('SELECT pg_advisory_unlock(hashtext($1))', [CHAVE_TRAVA]); } catch { /* a conexão volta ao pool */ } } cli.release(); }
}
async function falhaDoEvento(c, ev, regra, e) {
  const ref = `falha:${c.hoje}:${ev.chave}`, canal = regra.canal === 'AMBOS' ? 'EMAIL' : regra.canal;
  if ((await chavesFeitas(ev.chave, [ref])).size) return;
  await gravarLog({ canal, evento: ev.chave, destinatario: '(sistema)', titulo: `Não consegui preparar "${ev.nome}"`, payload: { nome: 'Sistema', papel: 'sistema', meta: { erroTipo: 'INTERNO', transitorio: false } }, status: 'ERRO', erro: 'Falha ao preparar os dados deste evento: ' + limpar(e?.message || e, 300) + ' A rotina tenta de novo na próxima rodada.', referencia: ref });
}

/**
 * Uma rodada do cron. `agora` e `opcoes` existem para os testes (relógio e provedor falsos); em produção são os padrões.
 * Devolve um resumo (também é o que a função agendada escreve no log do Netlify — sem dados pessoais).
 */
export async function rodarAgendado({ agora = new Date(), opcoes = {}, orcamentoMs = ORCAMENTO_MS } = {}) {
  if (!(await moduloAtivo())) return { ok: true, inativo: true, motivo: `recurso ${RECURSO} desligado neste ambiente` };
  return comTrava(async () => {
    const c = criarContexto({ agora, opcoes, orcamentoMs });
    await garantirRegras();
    const regras = await lerRegras(), eventos = [];
    for (const ev of EVENTOS) {
      const regra = regras.find(r => r.chave === ev.chave);
      if (!regra.ativo) continue;
      if (!estaNaHora(ev, regra, c.agora) || rodadaFeitaHoje(ev, regra, c.agora)) continue;
      if (Date.now() > c.fim || c.enviosFeitos >= MAX_ENVIOS_RODADA) { eventos.push({ chave: ev.chave, adiado: true }); continue; }
      try {
        const envios = await COLETORES[ev.chave](c, regra), r = await despachar(c, ev, regra, envios);
        eventos.push({ chave: ev.chave, ...r, envios: envios.length });
        if (r.completo) {
          const resumo = r.enviados || r.erros ? `${r.enviados} enviada(s)${r.erros ? `, ${r.erros} com erro` : ''}` : envios.length ? 'Tudo já enviado' : 'Nada a avisar';
          await q('UPDATE painel_notificacoes_regras SET ultima_rodada_em = now(), ultima_rodada_resumo = $2 WHERE evento_chave = $1', [ev.chave, resumo]);
        }
      } catch (e) { console.error('[painel][notificacoes]', ev.chave, String(e?.message || e).split('\n')[0].slice(0, 300)); eventos.push({ chave: ev.chave, falhou: true }); try { await falhaDoEvento(c, ev, regra, e); } catch { /* o log em si falhou: nada mais a fazer */ } }
    }
    const repetidos = await repetirTransitorios(c, regras);
    if (c.agora.min < 5) await q(`DELETE FROM painel_notificacoes_log WHERE data_hora < now() - make_interval(days => $1)`, [RETENCAO_LOG_DIAS]);
    return { ok: true, hoje: c.hoje, hora: c.agora.hora, eventos, repetidos, enviosFeitos: c.enviosFeitos, cortado: c.cortado };
  });
}

/* ----------------------------------------------------------------- API da Central */
const iso = d => (d ? new Date(d).toISOString() : null);
export function estadoConfigRotulado() {
  const cfg = estadoConfig();
  return { email: { ...cfg.email }, whatsapp: { ...cfg.whatsapp, provedorRotulo: ROTULO_PROVEDOR[cfg.whatsapp.provedor] || '—' } };
}
export async function estadoCentral() {
  await garantirRegras();
  const regras = await lerRegras();
  const tot = await q(`SELECT status, count(*)::int AS n FROM painel_notificacoes_log WHERE data_hora > now() - interval '7 days' AND NOT teste GROUP BY status`);
  const agora = D.agoraBRT();
  return {
    recurso: RECURSO, ambiente: ambienteAtual(), fuso: FUSO, agora: { iso: agora.iso, hora: agora.hora }, janelaHoras: JANELA_HORAS_PADRAO, maxTentativas: MAX_TENTATIVAS, retencaoDias: RETENCAO_LOG_DIAS,
    config: estadoConfigRotulado(),
    eventos: EVENTOS.map(ev => ({ chave: ev.chave, grupo: ev.grupo, nome: ev.nome, descricao: ev.descricao, gatilho: ev.gatilho, frequencia: ev.frequencia, canalPadrao: ev.canal, pdf: ev.pdf, campos: ev.campos, automaticos: ev.automaticos, papeis: ev.papeis, regra: regras.find(r => r.chave === ev.chave) })),
    ultimos7dias: { sucesso: tot.find(t => t.status === 'SUCESSO')?.n || 0, erro: tot.find(t => t.status === 'ERRO')?.n || 0 },
  };
}

const rotuloDest = (canal, d) => (canal === 'EMAIL' ? mascararEmail(d) : /^\d{10,15}$/.test(d) ? mascararTelefone(d) : d);
const projetarLog = r => ({ id: Number(r.id), dataHora: iso(r.data_hora), canal: r.canal, evento: r.evento_chave, eventoNome: POR_CHAVE[r.evento_chave]?.nome || r.evento_chave, destinatario: rotuloDest(r.canal, r.destinatario), destinatarioNome: r.nome || '',
  titulo: r.titulo, status: r.status, detalheErro: r.detalhe_erro || '', teste: !!r.teste, tentativa: r.tentativa, reenvioDe: r.reenvio_de ? Number(r.reenvio_de) : null, temAnexo: !!r.tem_anexo, anexoOmitido: !!r.anexo_omitido, tipoErro: r.erro_tipo || '' });
const COLUNAS_LOG = `id, data_hora, canal, evento_chave, destinatario, titulo, status, detalhe_erro, reenvio_de, teste, tentativa, payload_mensagem->>'nome' AS nome, payload_mensagem->'meta'->>'erroTipo' AS erro_tipo,
  (jsonb_typeof(payload_mensagem->'anexos') = 'array' AND jsonb_array_length(payload_mensagem->'anexos') > 0) AS tem_anexo, (payload_mensagem ? 'anexoOmitido') AS anexo_omitido`;

/** Auditoria: últimos envios com filtros (status, canal, evento, teste, período) e paginação por id (antes). */
export async function listarLogs(f = {}) {
  const w = ['true'], p = [];
  const add = (sql, v) => { p.push(v); w.push(sql.replace(/\?/g, () => '$' + p.length)); };
  if (['SUCESSO', 'ERRO'].includes(f.status)) add('status = ?', f.status);
  if (['EMAIL', 'WHATSAPP'].includes(f.canal)) add('canal = ?', f.canal);
  if (f.evento && POR_CHAVE[f.evento]) add('evento_chave = ?', f.evento);
  if (f.teste === 'sim') w.push('teste'); else if (f.teste === 'nao') w.push('NOT teste');
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.de || '')) add(`(data_hora AT TIME ZONE '${FUSO}')::date >= ?::date`, f.de);
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.ate || '')) add(`(data_hora AT TIME ZONE '${FUSO}')::date <= ?::date`, f.ate);
  const busca = String(f.busca || '').trim().slice(0, 60);
  if (busca) add(`(titulo ILIKE ? OR payload_mensagem->>'nome' ILIKE ? OR destinatario ILIKE ?)`, '%' + busca.replace(/[%_\\]/g, m => '\\' + m) + '%');
  const filtro = w.join(' AND '), limite = Math.min(Math.max(parseInt(f.limite, 10) || 50, 1), 100);
  const [{ n }] = await q(`SELECT count(*)::int AS n FROM painel_notificacoes_log WHERE ${filtro}`, p);
  const p2 = [...p]; let cursor = ''; if (Number.isFinite(Number(f.antes)) && Number(f.antes) > 0) { p2.push(Number(f.antes)); cursor = ` AND id < $${p2.length}`; }
  p2.push(limite + 1);
  const rows = await q(`SELECT ${COLUNAS_LOG} FROM painel_notificacoes_log WHERE ${filtro}${cursor} ORDER BY id DESC LIMIT $${p2.length}`, p2);
  return { total: n, logs: rows.slice(0, limite).map(projetarLog), proximo: rows.length > limite ? Number(rows[limite - 1].id) : null };
}
export async function lerLog(id) {
  const [r] = await q(`SELECT ${COLUNAS_LOG}, payload_mensagem FROM painel_notificacoes_log WHERE id = $1`, [Number(id) || 0]);
  if (!r) throw new ErroHttp(404, 'Registro não encontrado.');
  const pl = r.payload_mensagem || {};
  return { ...projetarLog(r), texto: pl.texto || '', anexos: (pl.anexos || []).map(a => ({ nome: a.nome, bytes: Math.round(a.base64.length * 0.75) })), anexoOmitidoNomes: pl.anexoOmitido || [] };
}

/** "Reenviar Notificação": manda de novo exatamente o que foi guardado (mesmo canal e destinatário) e grava uma linha nova. */
export async function reenviar(id, { opcoes = {}, por = '' } = {}) {
  const [r] = await q('SELECT * FROM painel_notificacoes_log WHERE id = $1', [Number(id) || 0]);
  if (!r) throw new ErroHttp(404, 'Registro não encontrado.');
  const p = r.payload_mensagem || {};
  if (r.canal === 'EMAIL' ? !p.html && !p.texto : !p.texto) throw new ErroHttp(409, 'Este registro não guardou o conteúdo da mensagem; não dá para reenviar.');
  if (/^\(/.test(r.destinatario)) throw new ErroHttp(409, 'Este registro não tem um destinatário com contato cadastrado. Corrija o cadastro; o envio automático seguinte tenta de novo.');
  const c = criarContexto({ opcoes }), destino = r.canal === 'EMAIL' ? { nome: p.nome, papel: p.papel, email: r.destinatario } : { nome: p.nome, papel: p.papel, telefone: r.destinatario };
  const conteudo = r.canal === 'EMAIL' ? { assunto: p.assunto, html: p.html, texto: p.texto, anexos: p.anexos || [] } : { whatsapp: p.texto };
  const meta = { ...(p.meta || {}), reenviadoPor: String(por || '').slice(0, 60) || undefined }; delete meta.erroTipo; delete meta.transitorio;
  const x = await enviarUm(c, { evento: r.evento_chave, referencia: r.referencia, canal: r.canal, destino, conteudo, teste: r.teste, reenvioDe: Number(r.id), pronto: true, meta });
  return { ...x, anexoOmitido: (p.anexoOmitido || []).length > 0 };
}

/** "Testar Disparo": manda a mensagem de exemplo do evento (dados fictícios, marcada [TESTE]) para o e-mail/telefone informado. */
export async function testar(chave, { canal, para = {}, opcoes = {} } = {}) {
  const ev = POR_CHAVE[chave]; if (!ev) throw new ErroHttp(404, 'Evento desconhecido.');
  const [{ n }] = await q(`SELECT count(*)::int AS n FROM painel_notificacoes_log WHERE teste AND data_hora > now() - interval '1 hour'`);
  if (n >= MAX_TESTES_HORA) throw new ErroHttp(429, `Limite de ${MAX_TESTES_HORA} testes por hora atingido. Aguarde um pouco.`);
  const email = String(para.email || '').trim().toLowerCase(), telefone = String(para.telefone || '').trim();
  if (email && !emailValido(email)) throw new ErroHttp(400, 'E-mail de teste inválido.');
  if (telefone && !normalizarTelefone(telefone)) throw new ErroHttp(400, 'Telefone de teste inválido. Use DDD + número (ex.: 11 99999-0000).');
  const regra = (await lerRegras()).find(r => r.chave === chave), usar = ['EMAIL', 'WHATSAPP', 'AMBOS'].includes(canal) ? canal : regra.canal;
  let destinos = email || telefone ? [{ nome: 'Teste', email, telefone, papel: 'teste' }] : regra.destinatarios.map(d => ({ ...d, papel: d.papel }));
  if (!destinos.length) throw new ErroHttp(400, 'Informe um e-mail ou telefone para receber o teste (ou cadastre destinatários no evento).');
  const c = criarContexto({ opcoes }), cont = M.amostra(chave, { hoje: c.hoje, agora: c.agora.ms }), resultados = [];
  const canais = usar === 'AMBOS' ? ['EMAIL', 'WHATSAPP'] : [usar];
  for (const d of destinos) for (const ch of canais) {
    if (usar === 'AMBOS' && (ch === 'EMAIL' ? !d.email : !normalizarTelefone(d.telefone)) && (d.email || normalizarTelefone(d.telefone))) continue;
    resultados.push(await enviarUm(c, { evento: chave, referencia: null, canal: ch, destino: d, conteudo: cont, teste: true }));
  }
  return { resultados, config: estadoConfigRotulado() };
}

/** O painel (navegador) publica aqui o Resumo do Recebível — o relatório executivo usa esses números. */
export async function publicarSnapshotRecebivel(dados, por = '') {
  const s = D.sanearSnapshotRecebivel(dados); if (!s) throw new ErroHttp(400, 'Resumo do Recebível inválido.');
  await D.gravarInstantaneo('recebivel:' + s.d, s, por);
  return { ok: true, chave: 'recebivel:' + s.d };
}
