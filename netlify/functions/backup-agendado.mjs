/* Rotina programada (Netlify Scheduled Function) — v13.95: um ponto de restauração AUTOMATICO por dia às 23:59 de Brasília.
   O cron do Netlify é sempre em UTC; o Brasil não tem horário de verão desde 2019, então 23:59 (UTC−3) = 02:59 UTC → "59 2 * * *".
   Regras do Netlify: só roda no deploy PUBLICADO (não em deploy preview nem branch deploy), não tem URL e tem limite de 30 s.
   Cada site (Produção, Homologação, Falco) roda a própria rotina no próprio banco. Idempotente: se já houve um ponto agendado nas últimas
   20 horas (nova tentativa do Netlify, por exemplo), não cria outro. Para testar sem esperar: Netlify › Functions › backup-agendado › Run now. */
import { agendado } from '../lib/backup-nuvem.mjs';

export default async () => {
  try {
    const r = await agendado();
    console.info('[painel][backup-agendado]', r.criado ? `ponto #${r.ponto.id} criado (${r.ponto.registros} registros, ${r.ponto.tamanho} bytes); ${r.podados} descartado(s) pela retenção` : `nada a fazer — ${r.motivo}`);
    return new Response(JSON.stringify({ ok: true, criado: !!r.criado }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (e) {
    console.error('[painel][backup-agendado] FALHOU —', String(e?.message || e).split('\n')[0].slice(0, 300));
    return new Response(JSON.stringify({ ok: false }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
};
export const config = { schedule: '59 2 * * *' };
