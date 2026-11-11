/* Rotina programada (Netlify Scheduled Function) — v14.00: Central de Notificações. Roda a cada 5 minutos e decide, pelo horário de
   Brasília de cada evento (UTC−3, sem horário de verão), o que está na hora de enviar: lembretes de prestação de contas, IEO semanal por
   regional (segunda, 08:00), solicitações acima do SLA (08:30), relatório matinal executivo (07:30), férias, falta de caixa acima da
   tolerância (a cada rodada, ≤ 5 min) e a confirmação do Backup na Nuvem. Cada evento só envia se estiver LIGADO na Central de Notificações.
   Regras do Netlify: só roda no deploy PUBLICADO, não tem URL e tem limite de 30 s (o motor para em 24 s e a rodada seguinte continua).
   Só age onde o recurso gestao_v1400 está ativo; sem as chaves de API (NOTIFICACAO_*) nada é enviado e o aviso aparece no log da Central.
   Para testar sem esperar: Netlify › Functions › notificacoes-agendadas › Run now. O log do Netlify traz só contagens (nenhum dado pessoal). */
import { rodarAgendado } from '../lib/notif-motor.mjs';

export default async () => {
  try {
    const r = await rodarAgendado();
    const linha = r.inativo || r.ocupado ? r.motivo : `${r.hora} · ${(r.eventos || []).map(e => `${e.chave}:${e.adiado ? 'adiado' : e.falhou ? 'falhou' : `${e.enviados || 0}ok/${e.erros || 0}erro`}`).join(' ') || 'nenhum evento na hora'}${r.repetidos ? ` · ${r.repetidos} nova(s) tentativa(s)` : ''}`;
    console.info('[painel][notificacoes-agendadas]', linha);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (e) {
    console.error('[painel][notificacoes-agendadas] FALHOU —', String(e?.message || e).split('\n')[0].slice(0, 300));
    return new Response(JSON.stringify({ ok: false }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
};
export const config = { schedule: '*/5 * * * *' };
