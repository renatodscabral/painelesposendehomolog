/* v14.00 · Catálogo de eventos da Central de Notificações: a lista fixa do que o painel sabe avisar, com o padrão de cada regra
   (canal, frequência, horário, parâmetros) e quem recebe. A tabela painel_notificacoes_regras guarda só o que o Master personaliza
   (ligado, canal, destinatários fixos e parâmetros); o resto vem daqui.
   Horários são SEMPRE de Brasília (America/Sao_Paulo). O cron do Netlify roda a cada 5 minutos e decide o que está na hora. */

export const CANAIS = ['EMAIL', 'WHATSAPP', 'AMBOS'];
export const FREQUENCIAS = ['IMEDIATA', 'DIARIA', 'SEMANAL'];
export const FUSO = 'America/Sao_Paulo';
export const JANELA_HORAS_PADRAO = 3;   // depois do horário marcado, o evento ainda "pega o trem" por 3 h (o cron ou um deploy pode ter falhado)
export const MAX_TENTATIVAS = 3;         // erro transitório (rede, 429, 5xx): no máximo 3 tentativas por destinatário, com 15 min entre elas
export const INTERVALO_TENTATIVA_MIN = 15;
export const RETENCAO_LOG_DIAS = 120;
export const DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

const horario = (h = '08:00') => ({ k: 'horario', tipo: 'hora', rot: 'Horário de envio (Brasília)', padrao: h });

export const EVENTOS = [
  {
    chave: 'viagem_lembrete_prestacao', grupo: 'Adiantamentos de Viagens', nome: 'Lembrete de prestação de contas',
    descricao: 'Antes do prazo, lembra o colaborador de que a prestação de contas da viagem ainda está pendente.',
    gatilho: 'Todo dia no horário marcado, para viagens "Aguardando prestação de contas" que chegam perto do prazo.',
    frequencia: 'DIARIA', canal: 'AMBOS', pdf: false,
    campos: [horario('09:00'), { k: 'diasAntes', tipo: 'lista', rot: 'Avisar quantos dias antes do prazo', padrao: [3, 1], min: 0, max: 30, ajuda: 'Ex.: 3, 1 = três dias e um dia antes do prazo. Use 0 para avisar também no dia do prazo.' }],
    automaticos: [{ k: 'colaborador', rot: 'O colaborador da viagem (e-mail e telefone do cadastro)', padrao: true }],
    papeis: [{ k: 'copia', rot: 'Cópia para (opcional)' }],
  },
  {
    chave: 'viagem_prazo_excedido', grupo: 'Adiantamentos de Viagens', nome: 'Prazo excedido · prestação pendente',
    descricao: 'Alerta urgente quando a viagem vira "PRAZO EXCEDIDO - PRESTAÇÃO PENDENTE": avisa o colaborador e manda o resumo para a Tesouraria/Financeiro.',
    gatilho: 'Todo dia no horário marcado, para viagens que passaram do prazo desde a última rodada (cada viagem é avisada uma vez).',
    frequencia: 'DIARIA', canal: 'AMBOS', pdf: false,
    campos: [horario('08:00'), { k: 'repetirACadaDias', tipo: 'numero', rot: 'Repetir o alerta ao colaborador a cada (dias)', padrao: 0, min: 0, max: 30, ajuda: '0 = avisa uma vez só.' }],
    automaticos: [{ k: 'colaborador', rot: 'O colaborador da viagem (e-mail e telefone do cadastro)', padrao: true }],
    papeis: [{ k: 'tesouraria', rot: 'Tesouraria / Financeiro (resumo)' }],
  },
  {
    chave: 'ieo_regional_semanal', grupo: 'Retaguarda Financeira', nome: 'Relatório IEO por Gerente Regional',
    descricao: 'Toda segunda-feira, cada Gerente Regional recebe só os indicadores IEO das lojas da sua regional, com PDF A4 anexado no e-mail (e um resumo no WhatsApp).',
    gatilho: 'Semanal, na segunda-feira, no horário marcado.',
    frequencia: 'SEMANAL', canal: 'AMBOS', pdf: true,
    campos: [horario('08:00'), { k: 'diaSemana', tipo: 'dia', rot: 'Dia da semana', padrao: 1, ajuda: '1 = segunda-feira.' }],
    automaticos: [{ k: 'regional', rot: 'O Gerente Regional de cada regional (cadastro do colaborador cujo nome está no campo "Supervisor regional" das lojas)', padrao: true }],
    papeis: [{ k: 'copia', rot: 'Cópia de todos os relatórios para (opcional)' }],
  },
  {
    chave: 'solicitacoes_sla_manha', grupo: 'Solicitações Operacionais', nome: 'Resumo matinal de solicitações acima do SLA',
    descricao: 'Resumo para os gestores de controle de loja com as solicitações ainda pendentes além do prazo (SLA).',
    gatilho: 'Todo dia no horário marcado; só envia se houver solicitação acima do SLA.',
    frequencia: 'DIARIA', canal: 'AMBOS', pdf: false,
    campos: [horario('08:30'), { k: 'slaDias', tipo: 'numero', rot: 'SLA (dias corridos em aberto)', padrao: 3, min: 1, max: 60, ajuda: 'O painel já marca em vermelho o que passa de 3 dias.' }],
    automaticos: [],
    papeis: [{ k: 'gestores', rot: 'Gestores de controle de loja' }],
  },
  {
    chave: 'relatorio_matinal_executivo', grupo: 'Diretoria', nome: 'Relatório matinal executivo',
    descricao: 'Texto resumido no WhatsApp e PDF consolidado no e-mail: entradas do dia anterior (vendas e prestações por adquirente), saldo de caixa, faltas de caixa e pendências da Retaguarda.',
    gatilho: 'Todo dia no horário marcado.',
    frequencia: 'DIARIA', canal: 'AMBOS', pdf: true,
    campos: [horario('07:30')],
    automaticos: [],
    papeis: [{ k: 'diretoria', rot: 'Diretoria / Master' }],
  },
  {
    chave: 'rh_dobra_ferias', grupo: 'RH', nome: 'Risco de dobra de férias',
    descricao: 'Avisa o RH e a loja quando faltam 60 e 30 dias para vencer o período concessivo das férias (depois disso, a empresa paga em dobro).',
    gatilho: 'Todo dia no horário marcado, para colaboradores com férias vencendo em exatamente 60 e 30 dias.',
    frequencia: 'DIARIA', canal: 'AMBOS', pdf: false,
    campos: [horario('08:00'), { k: 'diasAntes', tipo: 'lista', rot: 'Avisar quantos dias antes do vencimento', padrao: [60, 30], min: 1, max: 365 }],
    automaticos: [{ k: 'loja', rot: 'O gerente da loja do colaborador (cadastro do gerente)', padrao: true }],
    papeis: [{ k: 'rh', rot: 'RH' }],
  },
  {
    chave: 'rh_inicio_ferias', grupo: 'RH', nome: 'Aviso de início de férias',
    descricao: 'Avisa o colaborador, 5 dias antes, que as férias programadas vão começar.',
    gatilho: 'Todo dia no horário marcado, para férias programadas que começam em 5 dias.',
    frequencia: 'DIARIA', canal: 'AMBOS', pdf: false,
    campos: [horario('08:00'), { k: 'diasAntes', tipo: 'numero', rot: 'Avisar quantos dias antes', padrao: 5, min: 1, max: 30 }],
    automaticos: [{ k: 'colaborador', rot: 'O colaborador (e-mail e telefone do cadastro)', padrao: true }],
    papeis: [{ k: 'rh', rot: 'Cópia para o RH (opcional)' }],
  },
  {
    chave: 'falta_caixa_tolerancia', grupo: 'Tesouraria', nome: 'Falta de caixa acima da tolerância',
    descricao: 'Alerta imediato no WhatsApp quando uma loja registra falta de caixa acima da tolerância (por padrão, mais de 10% das vendas em dinheiro do dia da loja).',
    gatilho: 'Verificado a cada 5 minutos; cada falta é avisada uma vez.',
    frequencia: 'IMEDIATA', canal: 'WHATSAPP', pdf: false,
    campos: [
      { k: 'toleranciaPct', tipo: 'numero', rot: 'Tolerância (% das vendas em dinheiro do dia da loja)', padrao: 10, min: 0, max: 100, passo: 0.5, ajuda: 'Base: o dinheiro do dia da loja na Conciliação Credsystem.' },
      { k: 'valorSemBase', tipo: 'numero', rot: 'Valor mínimo (R$) quando não há venda do dia para comparar', padrao: 100, min: 0, max: 1000000, passo: 1, ajuda: 'Se a loja ainda não tem o dinheiro do dia na conciliação, avisa a falta a partir deste valor.' },
    ],
    automaticos: [],
    papeis: [{ k: 'tesouraria', rot: 'Tesouraria' }],
  },
  {
    chave: 'backup_nuvem_status', grupo: 'TI / Master', nome: 'Confirmação diária do Backup na Nuvem',
    descricao: 'Todo dia de manhã confirma se o ponto de restauração automático da noite (23:59) foi criado — ou avisa que não foi.',
    gatilho: 'Todo dia no horário marcado.',
    frequencia: 'DIARIA', canal: 'EMAIL', pdf: false,
    campos: [horario('07:00'), { k: 'horasMaximas', tipo: 'numero', rot: 'Alertar se o último ponto automático tiver mais de (horas)', padrao: 26, min: 1, max: 72 }],
    automaticos: [],
    papeis: [{ k: 'ti', rot: 'TI / Master' }],
  },
];

export const POR_CHAVE = Object.fromEntries(EVENTOS.map(e => [e.chave, e]));
export const padraoParametros = ev => Object.fromEntries([...(ev.campos || []).map(c => [c.k, c.padrao]), ...(ev.automaticos || []).map(a => [a.k, a.padrao !== false])]);

const hhmm = v => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? '').trim()); if (!m || +m[1] > 23 || +m[2] > 59) return null; return String(+m[1]).padStart(2, '0') + ':' + m[2]; };
const num = (v, c) => { const t = String(v ?? '').trim().replace(',', '.'); if (t === '') return null; const n = Number(t); if (!Number.isFinite(n)) return null; return Math.min(Math.max(n, c.min ?? -Infinity), c.max ?? Infinity); };

/** Parâmetros do usuário → parâmetros válidos (campos desconhecidos somem; valor ruim volta ao padrão). */
export function sanearParametros(ev, entrada = {}) {
  const base = padraoParametros(ev), out = {};
  for (const c of ev.campos || []) {
    const v = entrada?.[c.k];
    if (c.tipo === 'hora') out[c.k] = hhmm(v) || base[c.k];
    else if (c.tipo === 'dia') { const n = Math.trunc(Number(v)); out[c.k] = n >= 0 && n <= 6 ? n : base[c.k]; }
    else if (c.tipo === 'numero') { const n = num(v, c); out[c.k] = n == null ? base[c.k] : n; }
    else if (c.tipo === 'lista') { const l = (Array.isArray(v) ? v : String(v ?? '').split(/[;,\s]+/)).map(x => num(x, c)).filter(x => x != null).map(x => Math.trunc(x)); out[c.k] = [...new Set(l)].sort((a, b) => b - a).slice(0, 8); if (!out[c.k].length) out[c.k] = base[c.k]; }
  }
  for (const a of ev.automaticos || []) out[a.k] = entrada?.[a.k] === undefined ? a.padrao !== false : !!entrada[a.k];
  return out;
}

/** Destinatários fixos → lista limpa { papel, nome, email, telefone }. */
export function sanearDestinatarios(ev, lista) {
  const papeis = new Set((ev.papeis || []).map(p => p.k)), out = [];
  for (const d of Array.isArray(lista) ? lista : []) {
    if (!d || typeof d !== 'object') continue;
    const papel = papeis.has(d.papel) ? d.papel : (ev.papeis?.[0]?.k || 'copia'), nome = String(d.nome || '').trim().slice(0, 80), email = String(d.email || '').trim().toLowerCase().slice(0, 120), telefone = String(d.telefone || '').replace(/[^\d+()\s-]/g, '').trim().slice(0, 25);
    if (!email && !telefone) continue;
    out.push({ papel, nome, email, telefone });
    if (out.length >= 40) break;
  }
  return out;
}

export const sanearCanal = (v, ev) => (CANAIS.includes(String(v)) ? String(v) : ev.canal);
