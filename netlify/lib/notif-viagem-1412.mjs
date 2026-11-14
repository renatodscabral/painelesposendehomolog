/* v14.12 · Notificações de eventos de Viagens e Adiantamentos — gerador padronizado com DOIS formatos prontos:
     (a) whatsapp  resumo CURTO (status, viajante, destino, período, valor e link direto para o painel; avisa que o documento oficial segue por e-mail);
     (b) assunto/html/texto  resumo COMPLETO para e-mail, preparado para anexar (anexos[]) ou referenciar (pdfNome) o PDF oficial da viagem.
   Funções puras (sem rede, banco ou chaves). O painel (client) tem um espelho idêntico em Viagem12.notificacao — tests/teste-lote2-1412.mjs confere os dois.
   Ainda não há disparo automático pelo motor da Central: este módulo é o gerador que o motor (ou o botão "Resumo para WhatsApp e e-mail" da viagem) usa. */
import { esc, paragrafo, aviso, fatos, titulo2, layoutEmail } from './notif-mensagens.mjs';
import { brl, dataBR } from './notif-dados.mjs';
import { gerarPdf } from './notif-pdf.mjs';

export const EVENTOS_VIAGEM = {
  solicitada: ['🧳', 'Nova solicitação de viagem', 'info'],
  aprovada: ['✅', 'Viagem aprovada para pagamento', 'ok'],
  recusada: ['⛔', 'Viagem recusada', 'bad'],
  paga: ['💸', 'Adiantamento pago · aguardando prestação de contas', 'info'],
  prestacao_enviada: ['🧾', 'Prestação de contas enviada', 'info'],
  aguardando_ofx: ['🏦', 'Devolução informada · aguardando confirmação bancária (OFX)', 'warn'],
  credito_localizado: ['🔎', 'Devolução localizada no extrato bancário', 'ok'],
  encerrada: ['🏁', 'Adiantamento encerrado', 'ok'],
  encerrada_sem_ofx: ['⚠️', 'Adiantamento encerrado antes da confirmação no extrato', 'warn'],
};
const ev = e => EVENTOS_VIAGEM[e] ? e : 'solicitada';
const slug = s => String(s || 'viagem').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'viagem';
export const nomePdfViagem = ({ viajante, ida }) => `Viagem_${slug(viajante)}_${String(ida || '').slice(0, 10) || 'sem-data'}.pdf`;

/** Resumo curto para WhatsApp. `link` = endereço direto do painel (Viagens). */
export function whatsappViagem(d) {
  const [em, tit] = EVENTOS_VIAGEM[ev(d.evento)];
  return `${em} *${tit}*\nViajante: ${d.viajante}\nDestino: ${d.destino}\nPeríodo: ${dataBR(d.ida)} a ${dataBR(d.volta)}\nValor: *${brl(d.valor)}*\nStatus: ${d.status || tit}\nPainel: ${d.link || ''}\n_O documento oficial segue por e-mail._`;
}
export const assuntoViagem = d => `Viagem · ${d.viajante} · ${d.destino} · ${EVENTOS_VIAGEM[ev(d.evento)][1]}`;
/** Versão em texto puro do e-mail completo. */
export function textoViagem(d) {
  const [, tit] = EVENTOS_VIAGEM[ev(d.evento)], pdf = d.pdfNome || nomePdfViagem(d);
  return [assuntoViagem(d), '', `Evento: ${tit}`, `Viajante(s): ${d.viajante}`, `Trajeto: ${d.rota || d.destino}`, `Período: ${dataBR(d.ida)} a ${dataBR(d.volta)}`, `Valor: ${brl(d.valor)}`, `Status: ${d.status || tit}`,
    ...(d.responsavel ? [`Registrado por: ${d.responsavel}`] : []), ...(d.observacao ? [`Observação: ${d.observacao}`] : []), `Painel: ${d.link || ''}`,
    `Documento oficial: ${pdf} ${d.comPdf ? '(anexado a este e-mail)' : '(PDF oficial da viagem: Viagens › Imprimir Resumo; anexe-o a este e-mail)'}`].join('\n');
}
const blocosPdf = d => [{ t: 'kpis', itens: [{ rot: 'Valor', valor: brl(d.valor), tom: 'neutro' }, { rot: 'Status', valor: d.status || EVENTOS_VIAGEM[ev(d.evento)][1], tom: EVENTOS_VIAGEM[ev(d.evento)][2] === 'bad' ? 'bad' : 'neutro' }] },
  { t: 'h', texto: 'Dados da viagem' }, { t: 'tabela', colunas: [{ rot: 'Item', peso: 28 }, { rot: 'Informação', peso: 72 }], linhas: [['Viajante(s)', d.viajante], ['Trajeto', d.rota || d.destino], ['Período', `${dataBR(d.ida)} a ${dataBR(d.volta)}`], ['Evento', EVENTOS_VIAGEM[ev(d.evento)][1]], ...(d.responsavel ? [['Registrado por', d.responsavel]] : [])] },
  { t: 'p', texto: 'Resumo gerado pelo Painel de Gestão. O espelho completo da viagem (com cálculo, dados de pagamento e vouchers) é o PDF emitido em Viagens › Imprimir Resumo.', tam: 9, tom: 'neutro' }];
/** E-mail completo: { assunto, html, texto, whatsapp, anexos }. `comPdf` gera um PDF-resumo e o anexa; sem ele, `anexos` fica vazio e o PDF oficial é só referenciado (pdfNome). */
export function msgViagemEvento(d, { agora = new Date().toISOString() } = {}) {
  const [, tit, tom] = EVENTOS_VIAGEM[ev(d.evento)], pdfNome = d.pdfNome || nomePdfViagem(d), assunto = assuntoViagem(d);
  const corpo = aviso(tom, `<b>${esc(tit)}.</b> ${esc(d.viajante)} · ${esc(d.destino)}.`)
    + fatos([['Viajante(s)', d.viajante], ['Trajeto', d.rota || d.destino], ['Período', `${dataBR(d.ida)} a ${dataBR(d.volta)}`], ['Valor', brl(d.valor)], ['Status', d.status || tit], ...(d.responsavel ? [['Registrado por', d.responsavel]] : [])])
    + (d.observacao ? titulo2('Observação') + paragrafo(esc(d.observacao)) : '')
    + paragrafo(d.link ? `Acompanhe no painel: <a href="${esc(d.link)}">${esc(d.link)}</a>` : 'Acompanhe no painel, módulo Viagens.')
    + paragrafo(d.comPdf ? `O documento oficial da viagem (PDF) está anexado: <b>${esc(pdfNome)}</b>.` : `O documento oficial da viagem (PDF <b>${esc(pdfNome)}</b>) é emitido em Viagens › Imprimir Resumo e deve acompanhar este e-mail.`);
  const anexos = d.comPdf ? [{ nome: pdfNome, tipo: 'application/pdf', base64: gerarPdf({ titulo: 'Resumo da Viagem', subtitulo: `${d.viajante} · ${d.destino}`, emitidoEm: `Gerado em ${agora.slice(0, 10).split('-').reverse().join('/')}`, rodape: 'Uso interno', blocos: blocosPdf(d) }).toString('base64') }] : [];
  return { assunto, html: layoutEmail({ titulo: tit, corpo, preheader: `${d.viajante} · ${d.destino} · ${brl(d.valor)}` }), texto: textoViagem({ ...d, pdfNome }), whatsapp: whatsappViagem(d), anexos };
}
