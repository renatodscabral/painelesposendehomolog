/* v14.00 · Modelos das mensagens da Central de Notificações. Funções puras: recebem os dados já calculados (notif-dados.mjs)
   e devolvem { assunto, html, texto, whatsapp, anexos }.
     · html     e-mail limpo, em tabelas com estilo inline (funciona em Gmail, Outlook e celular); TODO texto vindo dos dados é escapado;
     · texto    versão em texto puro do e-mail (clientes sem HTML);
     · whatsapp texto curto, no formato do WhatsApp (*negrito*);
     · anexos   [{ nome, tipo: 'application/pdf', base64 }] — só o IEO por regional e o relatório executivo levam PDF.
   Nada aqui conhece chaves, banco ou rede. O nome do ambiente (Homologação) e o aviso de teste entram no motor, não nos modelos. */
import { brl, dataBR, mesPorExtenso } from './notif-dados.mjs';
import { gerarPdf } from './notif-pdf.mjs';

export const MARCA = 'Painel de Gestão';
const TOM = { ok: '#067647', bad: '#b42318', warn: '#b54708', info: '#175cd3', neutro: '#344054' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const primeiro = nome => String(nome || '').trim().split(/\s+/)[0] || '';
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const quando = dias => (dias === 0 ? 'hoje' : dias === 1 ? 'amanhã' : `em ${dias} dias`);
const pct1 = v => (Math.round(v * 10) / 10).toFixed(1).replace('.', ',') + '%';
const num1 = v => (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');
const dh = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d).replace(',', ''); };

/* ----------------------------------------------------------------- peças do e-mail */
export const paragrafo = t => `<p style="margin:0 0 12px">${t}</p>`;
export function aviso(tom, html) { const c = TOM[tom] || TOM.neutro; return `<div style="margin:0 0 14px;padding:10px 12px;border-left:4px solid ${c};background:#f9fafb;color:${c};font-size:13px;line-height:1.5">${html}</div>`; }
export function fatos(linhas) { return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px;font-size:14px">${linhas.map(([r, v]) => `<tr><td style="padding:3px 14px 3px 0;color:#667085;vertical-align:top;white-space:nowrap">${esc(r)}</td><td style="padding:3px 0;font-weight:600">${esc(v)}</td></tr>`).join('')}</table>`; }
export function kpisHtml(itens) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin:0 0 14px"><tr>${itens.map(i => `<td style="background:#f9fafb;border:1px solid #e4e7ec;border-radius:8px;padding:10px 12px;vertical-align:top"><div style="font-size:11px;color:#667085;text-transform:uppercase;letter-spacing:.03em">${esc(i.rot)}</div><div style="font-size:18px;font-weight:700;color:${TOM[i.tom] || TOM.neutro};margin-top:2px">${esc(i.valor)}</div></td>`).join('')}</tr></table>`;
}
/** colunas [{ rot, alinhar:'d'|'e' }], linhas [[célula…]]; célula = texto ou { v, tom, negrito }. */
export function tabelaHtml(colunas, linhas, { vazio = 'Nada a listar.', total = null } = {}) {
  if (!linhas.length) return paragrafo(`<span style="color:#667085">${esc(vazio)}</span>`);
  const cel = (c, i, cab = false) => {
    const o = c && typeof c === 'object' ? c : { v: c }, al = colunas[i]?.alinhar === 'd' ? 'right' : 'left';
    return `<${cab ? 'th' : 'td'} style="padding:6px 8px;text-align:${al};border-bottom:1px solid #e4e7ec;font-size:13px;${cab ? 'background:#175cd3;color:#fff;font-weight:600' : `color:${TOM[o.tom] || TOM.neutro};${o.negrito ? 'font-weight:700' : ''}`}">${esc(o.v)}</${cab ? 'th' : 'td'}>`;
  };
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-collapse:collapse"><thead><tr>${colunas.map((c, i) => cel(c.rot, i, true)).join('')}</tr></thead><tbody>${linhas.map(l => `<tr>${l.map((c, i) => cel(c, i)).join('')}</tr>`).join('')}${total ? `<tr>${total.map((c, i) => cel(typeof c === 'object' ? { ...c, negrito: true } : { v: c, negrito: true }, i)).join('')}</tr>` : ''}</tbody></table>`;
}
export const titulo2 = t => `<h2 style="margin:18px 0 8px;font-size:15px;color:#101828">${esc(t)}</h2>`;

export function layoutEmail({ titulo, corpo, preheader = '' }) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title></head>
<body style="margin:0;background:#f2f4f7;font-family:Arial,Helvetica,sans-serif;color:#101828"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:660px;background:#ffffff;border:1px solid #e4e7ec;border-radius:10px">
<tr><td style="padding:18px 24px;border-bottom:3px solid #175cd3"><div style="font-size:11px;color:#667085;letter-spacing:.06em;text-transform:uppercase">${esc(MARCA)}</div><div style="font-size:20px;font-weight:700;margin-top:2px">${esc(titulo)}</div></td></tr>
<tr><td style="padding:20px 24px;font-size:14px;line-height:1.55">${corpo}</td></tr>
<tr><td style="padding:14px 24px;background:#f9fafb;border-top:1px solid #e4e7ec;font-size:12px;color:#667085;border-radius:0 0 10px 10px">Mensagem automática do ${esc(MARCA)}. Não responda este e-mail.</td></tr>
</table></td></tr></table></body></html>`;
}
const pdfB64 = opts => gerarPdf(opts).toString('base64');
const anexo = (nome, base64) => ({ nome, tipo: 'application/pdf', base64 });
const emitido = agora => `Emitido em ${dh(agora)} (horário de Brasília)`;

/* ----------------------------------------------------------------- 1 e 2 · Adiantamentos de Viagens */
/** Saudação: ao colaborador ("Olá, Fulano!") ou, na cópia para um terceiro, a identificação de quem foi avisado. */
const abre = (nome, copia) => (copia ? { h: paragrafo(`Cópia do aviso enviado ao colaborador <b>${esc(nome)}</b>.`), t: `Cópia do aviso enviado ao colaborador ${nome}.`, w: `_Cópia do aviso enviado a ${nome}_\n` } : { h: paragrafo(`Olá, ${esc(primeiro(nome))}!`), t: `Olá, ${primeiro(nome)}!`, w: `Olá, ${primeiro(nome)}! ` });
export function msgViagemLembrete({ nome, rota, ida, volta, limite, dias, adiantado, copia = false }) {
  const q = quando(dias), a = abre(nome, copia), dela = copia ? `da viagem de ${nome}` : 'da sua viagem', assunto = `${copia ? '[Cópia] ' : ''}Lembrete: a prestação de contas ${dela} vence ${q}`;
  const corpo = a.h + paragrafo(`A prestação de contas ${esc(dela)} ainda está <b>pendente</b> e o prazo termina <b>${esc(q)}</b> (${esc(dataBR(limite))}).`)
    + fatos([['Viagem', rota || '—'], ['Período', `${dataBR(ida)} a ${dataBR(volta)}`], ['Prazo final', dataBR(limite)], ...(adiantado ? [['Adiantamento', brl(adiantado)]] : [])])
    + paragrafo(copia ? 'O colaborador precisa reunir os comprovantes e concluir a prestação de contas dentro do prazo.' : 'Reúna os comprovantes e conclua a prestação de contas dentro do prazo para evitar a pendência.');
  return { assunto, html: layoutEmail({ titulo: 'Prestação de contas da viagem', corpo, preheader: `Prazo final em ${dataBR(limite)}` }),
    texto: `${a.t}\n\nA prestação de contas ${dela} (${rota || '—'}, ${dataBR(ida)} a ${dataBR(volta)}) ainda está pendente. O prazo termina ${q} (${dataBR(limite)}).\n${copia ? 'O colaborador precisa concluir a prestação de contas dentro do prazo.' : 'Reúna os comprovantes e conclua a prestação de contas dentro do prazo.'}`,
    whatsapp: `*Lembrete de prestação de contas*\n${a.w}A prestação de contas ${dela} (${rota || '—'}, ${dataBR(ida)} a ${dataBR(volta)}) vence *${q}* (${dataBR(limite)}). ${copia ? 'Ela ainda está pendente.' : 'Reúna os comprovantes e conclua dentro do prazo para evitar pendência.'}` };
}
export function msgViagemExcedida({ nome, rota, ida, volta, limite, atraso, adiantado, copia = false }) {
  const a = abre(nome, copia), dela = copia ? `da viagem de ${nome}` : 'da sua viagem', assunto = `${copia ? '[Cópia] ' : ''}URGENTE: prazo da prestação de contas excedido`;
  const corpo = aviso('bad', '<b>PRAZO EXCEDIDO - PRESTAÇÃO PENDENTE</b>') + a.h
    + paragrafo(`O prazo da prestação de contas ${esc(dela)} terminou em <b>${esc(dataBR(limite))}</b> (${esc(plural(atraso, 'dia', 'dias'))} de atraso) e ela segue pendente.`)
    + fatos([['Viagem', rota || '—'], ['Período', `${dataBR(ida)} a ${dataBR(volta)}`], ['Prazo final', dataBR(limite)], ['Atraso', plural(atraso, 'dia', 'dias')], ...(adiantado ? [['Adiantamento', brl(adiantado)]] : [])])
    + paragrafo(copia ? 'É preciso regularizar com a Tesouraria/Financeiro.' : 'Regularize hoje: conclua a prestação de contas e entregue os comprovantes à Tesouraria/Financeiro.');
  return { assunto, html: layoutEmail({ titulo: 'Prazo excedido · prestação pendente', corpo, preheader: `${plural(atraso, 'dia', 'dias')} de atraso` }),
    texto: `URGENTE — PRAZO EXCEDIDO - PRESTAÇÃO PENDENTE\n\n${a.t} O prazo da prestação de contas ${dela} (${rota || '—'}) terminou em ${dataBR(limite)} (${plural(atraso, 'dia', 'dias')} de atraso).\n${copia ? 'É preciso regularizar com a Tesouraria/Financeiro.' : 'Regularize hoje e entregue os comprovantes à Tesouraria/Financeiro.'}`,
    whatsapp: `🔴 *PRAZO EXCEDIDO - PRESTAÇÃO PENDENTE*\n${a.w}O prazo da prestação de contas ${dela} (${rota || '—'}, ${dataBR(ida)} a ${dataBR(volta)}) terminou em *${dataBR(limite)}* (${plural(atraso, 'dia', 'dias')} de atraso). ${copia ? 'Regularize com a Tesouraria/Financeiro.' : 'Regularize hoje com a Tesouraria/Financeiro.'}` };
}
export function msgViagemResumo({ novas, pendentes, valorTotal, hoje }) {
  const linhas = novas.map(v => [v.nomes, v.rota || '—', dataBR(v.volta), dataBR(v.limite), { v: String(v.atraso), tom: 'bad', negrito: true }, brl(v.adiantado)]);
  const assunto = `Prestação de contas: ${plural(novas.length, 'viagem passou', 'viagens passaram')} do prazo`;
  const corpo = aviso('bad', `<b>${esc(plural(novas.length, 'viagem nova', 'viagens novas'))} com prazo excedido.</b> No total, ${esc(plural(pendentes, 'prestação está', 'prestações estão'))} em atraso (adiantamentos de ${esc(brl(valorTotal))}).`)
    + tabelaHtml([{ rot: 'Colaborador(es)' }, { rot: 'Viagem' }, { rot: 'Volta' }, { rot: 'Prazo' }, { rot: 'Atraso (dias)', alinhar: 'd' }, { rot: 'Adiantado', alinhar: 'd' }], linhas)
    + paragrafo('Os colaboradores já foram avisados. Acompanhe a regularização no módulo de Adiantamentos de Viagens.');
  const topo = novas.slice(0, 8).map(v => `• ${v.nomes} — ${v.rota || '—'} (${plural(v.atraso, 'dia', 'dias')})`).join('\n') + (novas.length > 8 ? `\n… e mais ${novas.length - 8}` : '');
  return { assunto, html: layoutEmail({ titulo: 'Prestações de contas com prazo excedido', corpo, preheader: `${novas.length} nova(s) · ${pendentes} em atraso` }),
    texto: `${assunto}\n\n${novas.map(v => `- ${v.nomes} | ${v.rota || '—'} | prazo ${dataBR(v.limite)} | ${plural(v.atraso, 'dia', 'dias')} de atraso | ${brl(v.adiantado)}`).join('\n')}\n\nTotal em atraso: ${pendentes} (${brl(valorTotal)}).`,
    whatsapp: `🔴 *Prestações de contas com prazo excedido*\n${plural(novas.length, 'viagem nova', 'viagens novas')} hoje · ${pendentes} em atraso (${brl(valorTotal)})\n${topo}` };
}

/* ----------------------------------------------------------------- 3 · IEO por Gerente Regional */
const ZONA = { verde: { r: 'Verde', tom: 'ok', e: '🟢' }, amarela: { r: 'Amarela', tom: 'warn', e: '🟡' }, vermelha: { r: 'Vermelha', tom: 'bad', e: '🔴' } };
const topDeducoes = l => Object.values(l.resumo || {}).sort((a, b) => a.pontos - b.pontos).slice(0, 3).map(x => `${x.nome}${x.n > 1 ? ` (${x.n}×)` : ''}`).join('; ') || 'Sem deduções';
export function msgIeoRegional({ regional, secoes, mediaRede, agora }) {
  /* secoes = [{ mes, fechado, media, cont, linhas, rotulo }] — a primeira é o mês em andamento; a segunda (só no começo do mês) é o fechamento do anterior */
  const s0 = secoes[0], assunto = `IEO · ${regional} · ${mesPorExtenso(s0.mes)}`;
  const corpoSecao = s => titulo2(`${s.rotulo}`) + kpisHtml([{ rot: 'Média da regional', valor: num1(s.media), tom: s.media >= 85 ? 'ok' : s.media < 60 ? 'bad' : 'warn' }, { rot: 'Zona verde', valor: String(s.cont.verde), tom: 'ok' }, { rot: 'Zona amarela', valor: String(s.cont.amarela), tom: 'warn' }, { rot: 'Zona vermelha', valor: String(s.cont.vermelha), tom: 'bad' }])
    + tabelaHtml([{ rot: '#' }, { rot: 'Loja' }, { rot: 'Pontos', alinhar: 'd' }, { rot: 'Zona' }, { rot: 'Principais deduções' }], s.linhas.map((l, i) => [String(i + 1), `${l.codigo} · ${l.nome}`, { v: num1(l.pontos), negrito: true, tom: ZONA[l.zona].tom }, { v: ZONA[l.zona].r, tom: ZONA[l.zona].tom }, topDeducoes(l)]), { vazio: 'Nenhuma loja ativa nesta regional.' });
  const corpo = paragrafo(`Segue o IEO (Índice de Eficiência Operacional) das lojas da regional <b>${esc(regional)}</b>. Média da rede no mês: <b>${esc(num1(mediaRede))}</b>.`) + secoes.map(corpoSecao).join('')
    + paragrafo('O relatório completo, em PDF A4, está anexado a este e-mail. Os pontos seguem a matriz de deduções configurada no painel.');
  const blocos = [];
  for (const s of secoes) {
    blocos.push({ t: 'h', texto: s.rotulo }, { t: 'kpis', itens: [{ rot: 'Média da regional', valor: num1(s.media), tom: s.media >= 85 ? 'ok' : s.media < 60 ? 'bad' : 'warn' }, { rot: 'Média da rede', valor: num1(s.mediaRede), tom: 'neutro' }, { rot: 'Lojas verde / amarela / vermelha', valor: `${s.cont.verde} / ${s.cont.amarela} / ${s.cont.vermelha}`, tom: s.cont.vermelha ? 'bad' : 'ok' }] },
      { t: 'tabela', colunas: [{ rot: '#', alinhar: 'c', peso: 4 }, { rot: 'Loja', peso: 26 }, { rot: 'Pontos', alinhar: 'd', peso: 9 }, { rot: 'Zona', peso: 10 }, { rot: 'Principais deduções', peso: 51 }], vazio: 'Nenhuma loja ativa nesta regional.',
        linhas: s.linhas.map((l, i) => [String(i + 1), `${l.codigo} · ${l.nome}`, { v: num1(l.pontos), negrito: true, tom: ZONA[l.zona].tom }, { v: ZONA[l.zona].r, tom: ZONA[l.zona].tom }, topDeducoes(l)]) });
    const detalhe = s.linhas.filter(l => l.deducoes.length);
    if (detalhe.length) {
      blocos.push({ t: 'p', texto: `Deduções do período (${s.rotulo})`, negrito: true, tam: 10 });
      for (const l of detalhe) blocos.push({ t: 'tabela', colunas: [{ rot: `${l.codigo} · ${l.nome}`, peso: 62 }, { rot: 'Data', peso: 14 }, { rot: 'Pontos', alinhar: 'd', peso: 10 }], linhas: l.deducoes.slice(0, 12).map(d => [`${d.nome}${d.detalhe ? ' — ' + d.detalhe : ''}`, dataBR(d.data), { v: num1(d.pontos), tom: 'bad' }]), ...(l.deducoes.length > 12 ? { total: [`… e mais ${l.deducoes.length - 12} dedução(ões)`, '', ''] } : {}) });
    }
    blocos.push({ t: 'espaco', h: 6 });
  }
  const base64 = pdfB64({ titulo: `IEO · Regional ${regional}`, subtitulo: `Índice de Eficiência Operacional · ${mesPorExtenso(s0.mes)}${s0.fechado ? ' (fechado)' : ' (acumulado do mês)'}`, emitidoEm: emitido(agora), rodape: `Regional ${regional}`, blocos });
  const piores = s0.linhas.slice().reverse().filter(l => l.zona !== 'verde').slice(0, 3);
  const wa = `*IEO · ${regional}* (${mesPorExtenso(s0.mes)})\nMédia da regional: *${num1(s0.media)}* (rede ${num1(mediaRede)})\n🟢 ${s0.cont.verde} · 🟡 ${s0.cont.amarela} · 🔴 ${s0.cont.vermelha}`
    + (piores.length ? `\nAtenção: ${piores.map(l => `${l.codigo} ${l.nome} (${num1(l.pontos)})`).join('; ')}` : '\nTodas as lojas na zona verde.') + '\n_O PDF completo foi enviado por e-mail._';
  const nomePdf = `IEO_${regional.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_')}_${s0.mes}.pdf`;
  return { assunto, html: layoutEmail({ titulo: `IEO · ${regional}`, corpo, preheader: `Média da regional ${num1(s0.media)}` }), texto: `${assunto}\nMédia da regional: ${num1(s0.media)} (rede ${num1(mediaRede)}). Lojas: verde ${s0.cont.verde}, amarela ${s0.cont.amarela}, vermelha ${s0.cont.vermelha}.\n${s0.linhas.map((l, i) => `${i + 1}. ${l.codigo} ${l.nome}: ${num1(l.pontos)} (${ZONA[l.zona].r})`).join('\n')}\nPDF anexado.`, whatsapp: wa, anexos: [anexo(nomePdf, base64)] };
}

/* ----------------------------------------------------------------- 4 · Solicitações acima do SLA */
export function msgSolicitacoes({ itens, slaDias, hoje }) {
  const assunto = `Solicitações pendentes acima do SLA: ${itens.length}`;
  const linhas = itens.map(s => [s.loja, s.regional || '—', s.itens, dataBR(s.dataSolicitacao), { v: String(s.dias), tom: 'bad', negrito: true }, s.andamento ? 'Em andamento' : 'Pendente']);
  const corpo = aviso('warn', `<b>${esc(plural(itens.length, 'solicitação está', 'solicitações estão'))} há mais de ${esc(plural(slaDias, 'dia', 'dias'))} em aberto</b> (SLA de ${esc(plural(slaDias, 'dia', 'dias'))}) em ${esc(dataBR(hoje))}.`)
    + tabelaHtml([{ rot: 'Loja' }, { rot: 'Regional' }, { rot: 'Pedido' }, { rot: 'Aberta em' }, { rot: 'Dias', alinhar: 'd' }, { rot: 'Situação' }], linhas)
    + paragrafo('Priorize as mais antigas. A lista completa está em Solicitações Operacionais, no painel.');
  const topo = itens.slice(0, 10).map(s => `• ${s.loja} — ${s.itens} (${s.dias} dias)`).join('\n') + (itens.length > 10 ? `\n… e mais ${itens.length - 10}` : '');
  return { assunto, html: layoutEmail({ titulo: 'Solicitações acima do SLA', corpo, preheader: `${itens.length} pendente(s) além de ${slaDias} dias` }),
    texto: `${assunto} (SLA ${slaDias} dias)\n\n${itens.map(s => `- ${s.loja} | ${s.itens} | aberta em ${dataBR(s.dataSolicitacao)} | ${s.dias} dias`).join('\n')}`,
    whatsapp: `⚠️ *Solicitações acima do SLA* (${slaDias} dias)\n${plural(itens.length, 'pendente', 'pendentes')} em ${dataBR(hoje)}\n${topo}` };
}

/* ----------------------------------------------------------------- 5 · Relatório matinal executivo */
export function msgExecutivo({ dia, ontem = dia, snap, snapAtual, faltas, pend, divCred, agora }) {
  const assunto = `Relatório matinal executivo · ${dataBR(dia)}`, B = v => (v == null ? '—' : brl(v));
  const temSnap = !!snap, saldoTom = snap?.saldo == null ? 'neutro' : snap.saldo >= 0 ? 'ok' : 'bad';
  const avisos = [];
  if (!temSnap) avisos.push('O Resumo do Recebível ainda não foi publicado pelo painel: as entradas e o saldo aparecem vazios. Abra o painel (Tela Inicial › Resumo do Recebível do Dia) com o gate da versão ligado para publicá-lo.');
  else if (!snapAtual) avisos.push(`Os valores de entradas e saldo vêm do Resumo do Recebível calculado em ${dh(snap.em)}${snap.ant ? ` (vendas de ${dataBR(snap.ant)})` : ''}; o resumo de hoje ainda não foi aberto no painel.`);
  if (temSnap && !snap.informado) avisos.push('O dinheiro/PIX do dia anterior ainda não foi digitado no FCX (entra como R$ 0,00 nas entradas).');
  if (temSnap && snap.carga && !snap.carga.ok) avisos.push(`Saídas: o último arquivo de Entradas e Saídas do FCX é de ${dataBR(snap.carga.dia)}; o saldo do dia fica indisponível até importar o de hoje.`);
  for (const a of snap?.avisos || []) if (!avisos.includes(a)) avisos.push(a);
  if (!divCred.temDia) avisos.push(`A Conciliação Credsystem de ${dataBR(ontem)} ainda não foi importada.`);
  const refEnt = snap?.ant ? `vendas de ${dataBR(snap.ant)}` : 'do dia anterior';
  const kp = [{ rot: 'Entradas do dia anterior', valor: temSnap ? B(snap.entradas) : '—', tom: 'info' }, { rot: 'Saldo do dia', valor: B(snap?.saldo), tom: saldoTom }, { rot: 'Faltas de caixa (ontem)', valor: faltas.ontem.n ? `${faltas.ontem.n} · ${brl(faltas.ontem.total)}` : 'Nenhuma', tom: faltas.ontem.n ? 'bad' : 'ok' }, { rot: 'Pendências da Retaguarda', valor: String(pend.total), tom: pend.total ? 'warn' : 'ok' }];
  const meiosL = (snap?.meios || []).map(m => [m.rot, B(m.vendas), B(m.prestacao), { v: B(m.total), negrito: true }]);
  const adqL = (snap?.adquirentes || []).map(a => [a.rot, B(a.deb), B(a.cre), { v: B(a.total), negrito: true }]);
  const pendL = [['Conta Cofre sem retorno no prazo', pend.cofreSemRetorno], ['Conta Cofre devolvida com divergência', pend.cofreAtrasadaDivergente], ['Créditos de cliente em aberto', pend.creditosAbertos + (pend.creditosVencidos ? ` (${pend.creditosVencidos} além do prazo)` : '')], ['Registro de vendas pendente de envio', pend.vendasPendentes], ['Depósitos fora do padrão', pend.depositosNao], ['DVC sem termo anexado', pend.dvcSemTermo], [`Divergências na Conciliação Credsystem de ${dataBR(ontem)}`, divCred.temDia ? `${divCred.n}${divCred.n ? ' · ' + brl(divCred.abs) : ''}` : 'sem importação']].map(([r, v]) => [r, { v: String(v), tom: (typeof v === 'number' ? v > 0 : v !== '0' && !/sem importação/.test(String(v))) ? 'warn' : 'neutro', negrito: true }]);
  const corpo = (avisos.length ? aviso('warn', avisos.map(esc).join('<br>')) : '') + kpisHtml(kp.slice(0, 2)) + kpisHtml(kp.slice(2))
    + titulo2('Entradas por meio de pagamento') + tabelaHtml([{ rot: 'Meio' }, { rot: 'Vendas', alinhar: 'd' }, { rot: 'Prestações', alinhar: 'd' }, { rot: 'Total', alinhar: 'd' }], meiosL, { vazio: 'Sem dados do Resumo do Recebível.' })
    + titulo2('Faltas de caixa') + paragrafo(`Ontem: <b>${esc(faltas.ontem.n ? `${plural(faltas.ontem.n, 'falta', 'faltas')} · ${brl(faltas.ontem.total)}` : 'nenhuma falta')}</b>. No mês: <b>${esc(plural(faltas.mes.n, 'falta', 'faltas'))} · ${esc(brl(faltas.mes.total))}</b>${faltas.semJustificativa ? ` (${esc(plural(faltas.semJustificativa, 'sem justificativa', 'sem justificativa'))})` : ''}.`)
    + titulo2('Pendências da Retaguarda') + tabelaHtml([{ rot: 'Pendência' }, { rot: 'Situação', alinhar: 'd' }], pendL)
    + paragrafo('O PDF consolidado, com as entradas por adquirente, o saldo e as pendências, está anexado.');
  const blocos = [{ t: 'kpis', itens: kp }];
  if (avisos.length) avisos.forEach(a => blocos.push({ t: 'p', texto: 'Atenção: ' + a, tom: 'warn', tam: 9 }));
  blocos.push({ t: 'h', texto: 'Entradas por meio de pagamento (vendas + prestações)' }, { t: 'tabela', colunas: [{ rot: 'Meio', peso: 40 }, { rot: 'Vendas', alinhar: 'd', peso: 20 }, { rot: 'Prestações', alinhar: 'd', peso: 20 }, { rot: 'Total', alinhar: 'd', peso: 20 }], linhas: meiosL, total: temSnap ? ['Total geral de entradas', '', '', { v: B(snap.entradas), negrito: true }] : undefined, vazio: 'Sem dados do Resumo do Recebível.' });
  blocos.push({ t: 'h', texto: 'Entradas por adquirente (cartões)' }, { t: 'tabela', colunas: [{ rot: 'Adquirente', peso: 37 }, { rot: 'Débito', alinhar: 'd', peso: 21 }, { rot: 'Crédito', alinhar: 'd', peso: 21 }, { rot: 'Total', alinhar: 'd', peso: 21 }], linhas: adqL, vazio: 'Sem detalhamento por adquirente.' });
  blocos.push({ t: 'h', texto: 'Saldo de caixa do dia' }, { t: 'tabela', colunas: [{ rot: 'Item', peso: 60 }, { rot: 'Valor', alinhar: 'd', peso: 40 }], linhas: [['Entradas', B(temSnap ? snap.entradas : null)], ['Saídas (contas a pagar do dia)', B(snap?.saidas)], [{ v: 'Saldo do dia', negrito: true }, { v: B(snap?.saldo), negrito: true, tom: saldoTom }]] });
  if (snap?.porConta?.length) blocos.push({ t: 'tabela', colunas: [{ rot: 'Saídas por conta contábil', peso: 56 }, { rot: 'Qtd.', alinhar: 'd', peso: 14 }, { rot: 'Valor', alinhar: 'd', peso: 30 }], linhas: snap.porConta.map(c => [c.rot, String(c.n), B(c.valor)]) });
  blocos.push({ t: 'h', texto: 'Faltas de caixa' }, { t: 'tabela', colunas: [{ rot: 'Período', peso: 40 }, { rot: 'Qtd.', alinhar: 'd', peso: 20 }, { rot: 'Valor', alinhar: 'd', peso: 40 }], linhas: [[`Ontem (${dataBR(ontem)})`, String(faltas.ontem.n), brl(faltas.ontem.total)], [`Mês de ${mesPorExtenso(ontem.slice(0, 7))}`, String(faltas.mes.n), brl(faltas.mes.total)]] });
  if (faltas.itensOntem.length) blocos.push({ t: 'tabela', colunas: [{ rot: 'Loja', peso: 44 }, { rot: 'Caixa', peso: 26 }, { rot: 'Situação', peso: 14 }, { rot: 'Valor', alinhar: 'd', peso: 16 }], linhas: faltas.itensOntem.map(i => [i.loja, i.caixa || '—', i.status, { v: brl(i.valor), tom: 'bad' }]) });
  blocos.push({ t: 'h', texto: 'Pendências da Retaguarda' }, { t: 'tabela', colunas: [{ rot: 'Pendência', peso: 75 }, { rot: 'Situação', alinhar: 'd', peso: 25 }], linhas: pendL });
  if (temSnap) blocos.splice(1, 0, { t: 'p', texto: `Entradas: ${refEnt}${snap.em ? ` · Resumo do Recebível calculado em ${dh(snap.em)}` : ''}.`, tom: 'neutro', tam: 9 });
  const base64 = pdfB64({ titulo: 'Relatório Matinal Executivo', subtitulo: `Posição de ${dataBR(dia)} · entradas, saldo de caixa, faltas e pendências da Retaguarda`, emitidoEm: emitido(agora), rodape: 'Uso interno · Diretoria', blocos });
  const wa = `*Relatório matinal · ${dataBR(dia)}*\n💰 Entradas (${refEnt}): *${temSnap ? brl(snap.entradas) : '—'}*\n🏦 Saldo do dia: *${B(snap?.saldo)}*\n⚠️ Faltas de caixa ontem: *${faltas.ontem.n ? `${faltas.ontem.n} · ${brl(faltas.ontem.total)}` : 'nenhuma'}* (mês: ${brl(faltas.mes.total)})\n📌 Pendências da Retaguarda: *${pend.total}*`
    + (avisos.length ? `\n_${avisos[0]}_` : '') + '\n_PDF consolidado enviado por e-mail._';
  return { assunto, html: layoutEmail({ titulo: 'Relatório matinal executivo', corpo, preheader: `Entradas ${temSnap ? brl(snap.entradas) : '—'} · saldo ${B(snap?.saldo)}` }),
    texto: `${assunto}\nEntradas (${refEnt}): ${temSnap ? brl(snap.entradas) : '—'}\nSaldo do dia: ${B(snap?.saldo)}\nFaltas de caixa ontem: ${faltas.ontem.n} (${brl(faltas.ontem.total)}); mês: ${brl(faltas.mes.total)}\nPendências da Retaguarda: ${pend.total}\n${avisos.map(a => 'Atenção: ' + a).join('\n')}\nPDF consolidado anexado.`, whatsapp: wa, anexos: [anexo(`Relatorio_Executivo_${dia}.pdf`, base64)] };
}

/* ----------------------------------------------------------------- 6 e 7 · RH */
export function msgFeriasDobra({ nome, loja, limite, dias, pendentes }) {
  const assunto = `Atenção: risco de dobra de férias · ${nome} (${dias} dias)`, tom = dias <= 30 ? 'bad' : 'warn';
  const corpo = aviso(tom, `<b>Faltam ${esc(plural(dias, 'dia', 'dias'))}</b> para vencer o período concessivo das férias de <b>${esc(nome)}</b>. Depois dele, a empresa paga as férias em dobro.`)
    + fatos([['Colaborador', nome], ...(loja ? [['Lotação', loja]] : []), ['Períodos a gozar', String(pendentes)], ['Limite para conceder', dataBR(limite)], ['Faltam', plural(dias, 'dia', 'dias')]])
    + paragrafo('Programe as férias para que o colaborador as inicie antes do limite.');
  return { assunto, html: layoutEmail({ titulo: 'Risco de dobra de férias', corpo, preheader: `Limite em ${dataBR(limite)}` }),
    texto: `${assunto}\nO período concessivo das férias de ${nome}${loja ? ' (' + loja + ')' : ''} vence em ${dataBR(limite)} (${plural(dias, 'dia', 'dias')}). Depois disso, as férias são pagas em dobro. Programe as férias antes do limite.`,
    whatsapp: `${dias <= 30 ? '🔴' : '🟡'} *Risco de dobra de férias*\n${nome}${loja ? ' (' + loja + ')' : ''}: o prazo para conceder as férias vence em *${dataBR(limite)}* (faltam ${plural(dias, 'dia', 'dias')}). Depois disso, a empresa paga em dobro. Programe as férias antes do limite.` };
}
export function msgFeriasInicio({ nome, inicio, fim, dias, copia = false }) {
  const a = abre(nome, copia), assunto = copia ? `[Cópia] Férias de ${nome} começam ${quando(dias)}` : `Suas férias começam ${quando(dias)}`, de = copia ? `As férias de ${nome}` : 'Suas férias';
  const corpo = a.h + paragrafo(`${esc(de)} estão programadas para começar em <b>${esc(dataBR(inicio))}</b> (${esc(quando(dias))}) e vão até <b>${esc(dataBR(fim))}</b>.`)
    + fatos([['Início', dataBR(inicio)], ['Fim', dataBR(fim)]]) + paragrafo(copia ? 'Confira a cobertura da escala no período.' : 'Deixe suas pendências organizadas com a equipe antes de sair. Boas férias!');
  return { assunto, html: layoutEmail({ titulo: 'Aviso de início de férias', corpo, preheader: `De ${dataBR(inicio)} a ${dataBR(fim)}` }),
    texto: `${a.t} ${de} começam em ${dataBR(inicio)} (${quando(dias)}) e vão até ${dataBR(fim)}. ${copia ? 'Confira a cobertura da escala.' : 'Deixe suas pendências organizadas. Boas férias!'}`,
    whatsapp: `*Aviso de férias*\n${a.w}${de} começam em *${dataBR(inicio)}* (${quando(dias)}) e vão até ${dataBR(fim)}. ${copia ? 'Confira a cobertura da escala.' : 'Deixe suas pendências organizadas com a equipe. Boas férias!'}` };
}

/* ----------------------------------------------------------------- 8 · Falta de caixa */
export function msgFaltaCaixa({ loja, data, valor, caixa, dinheiroDia, pct, temBase, toleranciaPct, valorSemBase }) {
  const base = temBase ? `${pct1(pct)} do dinheiro do dia (${brl(dinheiroDia)}); tolerância de ${pct1(toleranciaPct)}` : `sem venda em dinheiro do dia para comparar; valor mínimo de alerta ${brl(valorSemBase)}`;
  const assunto = `Falta de caixa acima da tolerância · ${loja} · ${brl(valor)}`;
  const corpo = aviso('bad', `<b>Falta de caixa acima da tolerância</b> registrada em ${esc(loja)}.`) + fatos([['Loja', loja], ['Data', dataBR(data)], ['Valor da falta', brl(valor)], ...(caixa ? [['Caixa', caixa]] : []), ['Comparação', base]]) + paragrafo('Acompanhe a justificativa no módulo de Faltas de Caixa.');
  return { assunto, html: layoutEmail({ titulo: 'Falta de caixa acima da tolerância', corpo, preheader: `${loja} · ${brl(valor)}` }),
    texto: `${assunto}\nData: ${dataBR(data)}${caixa ? ' · Caixa: ' + caixa : ''}\n${base}.`,
    whatsapp: `🔴 *Falta de caixa acima da tolerância*\n${loja} · ${dataBR(data)}${caixa ? ' · ' + caixa : ''}\nValor: *${brl(valor)}*\n${temBase ? `${pct1(pct)} do dinheiro do dia (tolerância ${pct1(toleranciaPct)})` : `Sem venda do dia para comparar (alerta a partir de ${brl(valorSemBase)})`}` };
}

/* ----------------------------------------------------------------- 9 · Backup na Nuvem */
export function msgBackup({ ok, ponto, horas, horasMaximas, dia }) {
  const qd = ponto ? dh(ponto.data_hora) : '';
  const assunto = ok ? `Backup na Nuvem confirmado · ${dataBR(dia)}` : `ALERTA: o backup automático não foi confirmado · ${dataBR(dia)}`;
  const corpo = ok ? aviso('ok', `<b>Backup confirmado.</b> O último ponto de restauração automático foi criado em ${esc(qd)}.`) + fatos([['Ponto', `#${ponto.id}`], ['Criado em', qd], ['Registros', String(ponto.total_registros)], ['Tamanho', `${Math.round(ponto.tamanho_bytes / 1024).toLocaleString('pt-BR')} KB`]])
    : aviso('bad', `<b>Nenhum ponto automático nas últimas ${esc(String(horasMaximas))} horas.</b> ${ponto ? `O último foi criado em ${esc(qd)} (há ${esc(num1(horas))} h).` : 'Não há nenhum ponto automático guardado.'}`) + paragrafo('Em Sistema & Segurança › Backup e dados, crie um ponto manual agora e confira, no Netlify (Functions › backup-agendado), se a rotina agendada está ativa e sem erros.');
  return { assunto, html: layoutEmail({ titulo: 'Backup na Nuvem', corpo, preheader: ok ? 'Ponto de restauração automático criado' : 'Verifique a rotina agendada' }),
    texto: ok ? `${assunto}\nPonto #${ponto.id} criado em ${qd} (${ponto.total_registros} registros).` : `${assunto}\n${ponto ? `Último ponto automático: ${qd} (há ${num1(horas)} h).` : 'Não há ponto automático guardado.'} Crie um ponto manual e confira a rotina agendada no Netlify.`,
    whatsapp: ok ? `✅ *Backup na Nuvem confirmado*\nPonto #${ponto.id} criado em ${qd}.` : `🔴 *Backup NÃO confirmado*\n${ponto ? `Último ponto automático: ${qd} (há ${num1(horas)} h).` : 'Nenhum ponto automático guardado.'} Confira a rotina agendada.` };
}

/* ----------------------------------------------------------------- 10 · Pagamentos aprovados nas Saídas do Dia (v14.02) */
const NOME_ARQ = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'x';
/** Blocos do PDF A4 do "Relatório de Pagamentos Aprovados" (o mesmo conteúdo que o painel monta no navegador): cabeçalho, aprovados, retidos e assinatura. */
export function blocosPagamentosAprovados({ lote, itens }) {
  const aprov = itens.filter(i => i.status === 'APROVADO'), ret = itens.filter(i => i.status === 'RETIDO');
  const linhas = l => l.map(i => [dataBR(i.vencimento), i.fornecedor || '—', i.conta || '—', i.forma || '—', { v: brl(i.valor), negrito: true }]);
  const cols = [{ rot: 'Venc.', peso: 11 }, { rot: 'Fornecedor / favorecido', peso: 31 }, { rot: 'Conta', peso: 24 }, { rot: 'Forma de pgto.', peso: 16 }, { rot: 'Valor', alinhar: 'd', peso: 18 }];
  const blocos = [
    { t: 'kpis', itens: [{ rot: 'Total previsto', valor: brl(lote.totalPrevisto), tom: 'neutro' }, { rot: 'Total autorizado', valor: brl(lote.totalAutorizado), tom: 'ok' }, { rot: 'Total retido', valor: brl(lote.totalRetido), tom: lote.totalRetido ? 'warn' : 'neutro' }] },
    { t: 'h', texto: `Pagamentos aprovados (${aprov.length})` },
    { t: 'tabela', colunas: cols, linhas: linhas(aprov), total: aprov.length ? ['Total autorizado', '', '', '', { v: brl(lote.totalAutorizado), negrito: true }] : undefined, vazio: 'Nenhum pagamento foi aprovado neste lote.' },
    { t: 'h', texto: `Resumo dos retidos (${ret.length})` },
  ];
  if (ret.length) {
    const grupo = new Map(); for (const i of ret) { const k = i.conta || '(sem conta)', g = grupo.get(k) || { n: 0, v: 0 }; g.n++; g.v += i.valor; grupo.set(k, g); }
    blocos.push({ t: 'p', texto: 'Estes títulos NÃO foram autorizados para pagamento neste dia e ficam retidos até nova decisão.', tom: 'warn', tam: 9 },
      { t: 'tabela', colunas: [{ rot: 'Conta', peso: 60 }, { rot: 'Qtd.', alinhar: 'd', peso: 12 }, { rot: 'Valor retido', alinhar: 'd', peso: 28 }], linhas: [...grupo].sort((a, b) => b[1].v - a[1].v).map(([k, g]) => [k, String(g.n), brl(g.v)]), total: ['Total retido', String(ret.length), { v: brl(lote.totalRetido), negrito: true }] },
      { t: 'tabela', colunas: cols, linhas: linhas(ret) });
  } else blocos.push({ t: 'p', texto: 'Nenhum título foi retido: tudo o que estava previsto para o dia foi autorizado.', tom: 'ok', tam: 9 });
  blocos.push({ t: 'espaco', h: 10 }, { t: 'h', texto: 'Assinatura digital do aprovador' },
    { t: 'p', texto: `${lote.aprovadorNome} · CPF ${lote.aprovadorCpf}`, negrito: true, tam: 11 },
    { t: 'p', texto: `Aprovado em ${dh(lote.criadoEm)} (horário de Brasília), pelo usuário autenticado no Painel de Gestão${lote.ambiente ? ` (ambiente ${lote.ambiente})` : ''}.`, tam: 9 },
    { t: 'p', texto: `Selo de integridade (SHA-256): ${lote.selo.slice(0, 32)}`, tam: 8, tom: 'neutro' }, { t: 'p', texto: lote.selo.slice(32), tam: 8, tom: 'neutro' },
    { t: 'p', texto: `Lote nº ${lote.id}. Assinatura eletrônica simples: identifica o usuário que aprovou e sela o conteúdo deste relatório; não é certificado digital ICP-Brasil.`, tam: 8, tom: 'neutro' });
  return blocos;
}
export function msgSaidasAprovadas({ lote, itens, agora, copia = false }) {
  const aprov = itens.filter(i => i.status === 'APROVADO'), ret = itens.filter(i => i.status === 'RETIDO'), dia = dataBR(lote.dia), quem = `${lote.aprovadorNome} (CPF ${lote.aprovadorCpf})`;
  const assunto = `${copia ? '[Cópia] ' : ''}Pagamentos aprovados · ${dia} · ${brl(lote.totalAutorizado)} liberados`;
  const topo = aprov.slice().sort((a, b) => b.valor - a.valor).slice(0, 12);
  const corpo = aviso(lote.totalAutorizado > 0 ? 'ok' : 'warn', `<b>${esc(brl(lote.totalAutorizado))} liberados para pagamento em ${esc(dia)}.</b> ${esc(plural(lote.qtdAprovados, 'título aprovado', 'títulos aprovados'))}${lote.qtdRetidos ? ` e ${esc(plural(lote.qtdRetidos, 'título retido', 'títulos retidos'))} (${esc(brl(lote.totalRetido))})` : ''}.`)
    + kpisHtml([{ rot: 'Total previsto', valor: brl(lote.totalPrevisto), tom: 'neutro' }, { rot: 'Total autorizado', valor: brl(lote.totalAutorizado), tom: 'ok' }, { rot: 'Total retido', valor: brl(lote.totalRetido), tom: lote.totalRetido ? 'warn' : 'neutro' }])
    + fatos([['Aprovado por', quem], ['Data e hora', dh(lote.criadoEm)], ['Lote', `nº ${lote.id}`]])
    + titulo2(aprov.length > topo.length ? `Maiores pagamentos aprovados (${topo.length} de ${aprov.length})` : 'Pagamentos aprovados')
    + tabelaHtml([{ rot: 'Venc.' }, { rot: 'Fornecedor' }, { rot: 'Conta' }, { rot: 'Valor', alinhar: 'd' }], topo.map(i => [dataBR(i.vencimento), i.fornecedor || '—', i.conta || '—', { v: brl(i.valor), negrito: true }]), { vazio: 'Nenhum pagamento foi aprovado.' })
    + paragrafo(`O relatório completo (aprovados, resumo dos retidos e a assinatura digital do aprovador), em PDF A4, está anexado.${copia ? '' : ' Libere os pagamentos aprovados e mantenha retidos os demais.'}`);
  const base64 = pdfB64({ titulo: 'Relatório de Pagamentos Aprovados', subtitulo: `Saídas do dia ${dia} · aprovadas por ${lote.aprovadorNome}`, emitidoEm: emitido(agora), rodape: `Lote nº ${lote.id} · Uso interno`, blocos: blocosPagamentosAprovados({ lote, itens }) });
  const wa = `✅ *Pagamentos aprovados · ${dia}*\nValor liberado: *${brl(lote.totalAutorizado)}* (${plural(lote.qtdAprovados, 'título', 'títulos')})\n` + (lote.qtdRetidos ? `Retido: ${brl(lote.totalRetido)} (${plural(lote.qtdRetidos, 'título', 'títulos')})\n` : 'Nenhum título retido.\n')
    + `Aprovado por ${lote.aprovadorNome} em ${dh(lote.criadoEm)}.\n_O relatório em PDF foi enviado por e-mail._`;
  return { assunto, html: layoutEmail({ titulo: 'Pagamentos aprovados nas Saídas do Dia', corpo, preheader: `${brl(lote.totalAutorizado)} liberados · ${brl(lote.totalRetido)} retidos` }),
    texto: `${assunto}\nPrevisto: ${brl(lote.totalPrevisto)} · Autorizado: ${brl(lote.totalAutorizado)} (${lote.qtdAprovados}) · Retido: ${brl(lote.totalRetido)} (${lote.qtdRetidos})\nAprovado por ${quem} em ${dh(lote.criadoEm)}. Lote nº ${lote.id}.\nPDF do relatório anexado.`, whatsapp: wa,
    anexos: [anexo(`Pagamentos_Aprovados_${lote.dia}_lote${lote.id}_${NOME_ARQ(lote.aprovadorNome)}.pdf`, base64)] };
}

/* ----------------------------------------------------------------- amostras (Testar Disparo) — dados fictícios */
export function amostra(chave, { hoje, agora }) {
  const L = [{ lojaId: 'a', codigo: '101', nome: 'Loja Centro', pontos: 96, zona: 'verde', resumo: {}, deducoes: [] }, { lojaId: 'b', codigo: '102', nome: 'Loja Norte', pontos: 78, zona: 'amarela', resumo: { x: { nome: 'Falta de caixa (numerário) isolada', n: 2, pontos: -20 } }, deducoes: [{ nome: 'Falta de caixa (numerário) isolada', pontos: -10, data: hoje, detalhe: 'Falta Caixa 1 · R$ 85,00' }] }, { lojaId: 'c', codigo: '103', nome: 'Loja Sul', pontos: 52, zona: 'vermelha', resumo: { x: { nome: 'Depósitos fora do prazo', n: 1, pontos: -3 } }, deducoes: [] }];
  switch (chave) {
    case 'viagem_lembrete_prestacao': return msgViagemLembrete({ nome: 'Colaborador Exemplo', rota: 'Matriz → Loja Norte', ida: hoje, volta: hoje, limite: hoje, dias: 1, adiantado: 350 });
    case 'viagem_prazo_excedido': return msgViagemExcedida({ nome: 'Colaborador Exemplo', rota: 'Matriz → Loja Norte', ida: hoje, volta: hoje, limite: hoje, atraso: 2, adiantado: 350 });
    case 'ieo_regional_semanal': return msgIeoRegional({ regional: 'Gerente Exemplo', mediaRede: 81.3, agora, secoes: [{ mes: hoje.slice(0, 7), fechado: false, rotulo: mesPorExtenso(hoje.slice(0, 7)) + ' (acumulado)', media: 75.3, mediaRede: 81.3, cont: { verde: 1, amarela: 1, vermelha: 1 }, linhas: L }] });
    case 'solicitacoes_sla_manha': return msgSolicitacoes({ hoje, slaDias: 3, itens: [{ loja: '102 · Loja Norte', regional: 'Gerente Exemplo', itens: 'Bobinas de Impressão (4)', dataSolicitacao: hoje, dias: 5, andamento: false }, { loja: '103 · Loja Sul', regional: 'Gerente Exemplo', itens: 'Pinpad', dataSolicitacao: hoje, dias: 4, andamento: true }] });
    case 'relatorio_matinal_executivo': return msgExecutivo({ dia: hoje, ontem: hoje, agora, snapAtual: true, divCred: { temDia: true, n: 1, abs: 12.5 }, pend: { total: 4, cofreSemRetorno: 1, cofreAtrasadaDivergente: 0, creditosAbertos: 2, creditosVencidos: 1, vendasPendentes: 0, depositosNao: 1, dvcSemTermo: 0 },
      faltas: { ontem: { n: 1, total: 85 }, mes: { n: 6, total: 510 }, semJustificativa: 2, itensOntem: [{ loja: '102 · Loja Norte', caixa: 'Caixa 1', valor: 85, status: 'Em análise' }] },
      snap: { d: hoje, ant: hoje, em: new Date(agora).toISOString(), informado: true, entradas: 48250.4, saidas: 21300, saldo: 26950.4, nSaidas: 7, avisos: [], carga: { ok: true, dia: hoje, arquivo: '' }, porConta: [{ rot: 'Fornecedores', valor: 15000, n: 3 }, { rot: 'Folha', valor: 6300, n: 4 }],
        meios: [{ rot: 'Dinheiro', vendas: 9000, prestacao: 1200, total: 10200 }, { rot: 'PIX', vendas: 7000, prestacao: 800, total: 7800 }, { rot: 'Cartão', vendas: 28000, prestacao: 2250.4, total: 30250.4 }], adquirentes: [{ rot: 'Adquirente A', deb: 6000, cre: 14000, total: 20000 }, { rot: 'Adquirente B', deb: 3000, cre: 7250.4, total: 10250.4 }] } });
    case 'rh_dobra_ferias': return msgFeriasDobra({ nome: 'Colaborador Exemplo', loja: '102 · Loja Norte', limite: hoje, dias: 30, pendentes: 1 });
    case 'rh_inicio_ferias': return msgFeriasInicio({ nome: 'Colaborador Exemplo', inicio: hoje, fim: hoje, dias: 5 });
    case 'falta_caixa_tolerancia': return msgFaltaCaixa({ loja: '102 · Loja Norte', data: hoje, valor: 185.4, caixa: 'Caixa 1', dinheiroDia: 1200, pct: 15.4, temBase: true, toleranciaPct: 10, valorSemBase: 100 });
    case 'backup_nuvem_status': return msgBackup({ ok: true, dia: hoje, horasMaximas: 26, horas: 8, ponto: { id: 0, data_hora: new Date(agora).toISOString(), total_registros: 1234, tamanho_bytes: 512000 } });
    case 'saidas_aprovadas': return msgSaidasAprovadas({ agora, lote: { id: 0, dia: hoje, criadoEm: new Date(agora).toISOString(), aprovadorNome: 'Diretor Exemplo', aprovadorCpf: '***.***.***-00', totalPrevisto: 38500, totalAutorizado: 31200, totalRetido: 7300, qtdTotal: 6, qtdAprovados: 4, qtdRetidos: 2, selo: 'a'.repeat(64), ambiente: '' },
      itens: [{ status: 'APROVADO', fornecedor: 'Fornecedor A', conta: 'Fornecedores', forma: 'Boleto', vencimento: hoje, valor: 15000 }, { status: 'APROVADO', fornecedor: 'Fornecedor B', conta: 'Fornecedores', forma: 'PIX', vencimento: hoje, valor: 9200 }, { status: 'APROVADO', fornecedor: 'Folha de pagamento', conta: 'Folha', forma: 'Transferência', vencimento: hoje, valor: 5000 }, { status: 'APROVADO', fornecedor: 'Locador', conta: 'Aluguel', forma: 'Boleto', vencimento: hoje, valor: 2000 },
        { status: 'RETIDO', fornecedor: 'Fornecedor C', conta: 'Fornecedores', forma: 'Boleto', vencimento: hoje, valor: 4800 }, { status: 'RETIDO', fornecedor: 'Prestador D', conta: 'Serviços', forma: 'PIX', vencimento: hoje, valor: 2500 }] });
    default: return null;
  }
}
