/* v13.88 · Permissões da Gestão de Acessos no SERVIDOR — a mesma leitura do painel (public/index.html):
   1) normalizarPermissoes: aceita o JSON gravado em qualquer formato antigo ou novo — strings ('ler', 'Modificar', 'EXCLUIR',
      'editar', 'total'…), números (0–3), booleanos (true = Ler), listas e aninhamentos ({ fcx: { nivel: 'ler' } },
      { fcx: { ler: true, modificar: true } }, { modulos: { … } }, JSON em texto) — e devolve a forma canônica
      { <módulo>: ''|'ler'|'modificar'|'excluir', '<opção.extra>': true, sub: { … } }.
   2) permissoesEfetivas: a lista de permissões do usuário pela matriz (níveis, opções extras, sub-permissões de telas e
      ações, perfil Loja), igual a permissoesDaMatriz() do painel.
   3) acessoPorMatriz: coleções que o banco reserva ao Master (regra 'admin') passam a ser entregues a quem a matriz
      libera o módulo correspondente — era o defeito "permissão marcada, mas o menu não aparece" no Netlify. */
import MATRIZ from './matriz-acessos.mjs';

export const NIVEIS = ['', 'ler', 'modificar', 'excluir'];
const IDS = new Set(MATRIZ.modulos.map(m => m.id));
const CONHECIDAS = new Set(MATRIZ.modulos.flatMap(m => [...m.ler, ...m.modificar, ...m.excluir, ...m.extras.map(e => e[0])]));
const sem = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const PAL = {
  ler: ['ler', 'leitura', 'ver', 'visualizar', 'visualizacao', 'consulta', 'consultar', 'r', 'read', 'view', 'sim', 's', 'true', 'acesso'],
  modificar: ['modificar', 'editar', 'edicao', 'escrever', 'gravar', 'alterar', 'lancar', 'w', 'write', 'edit', 'interact'],
  excluir: ['excluir', 'exclusao', 'apagar', 'remover', 'total', 'completo', 'tudo', 'admin', 'd', 'delete', 'full'],
};
/** Nível canônico ('' | 'ler' | 'modificar' | 'excluir') de qualquer valor gravado. */
export function nivelDe(v) {
  if (v == null || v === false) return '';
  if (v === true) return 'ler';
  if (typeof v === 'number') return NIVEIS[Math.max(0, Math.min(3, Math.round(v)))] || '';
  if (Array.isArray(v)) return v.map(nivelDe).reduce((a, x) => (NIVEIS.indexOf(x) > NIVEIS.indexOf(a) ? x : a), '');
  if (typeof v === 'object') {
    for (const k of ['nivel', 'nível', 'acesso', 'level', 'valor', 'value', 'permissao']) if (k in v) return nivelDe(v[k]);
    let n = 0; for (const [k, x] of Object.entries(v)) { if (!x) continue; const t = sem(k); NIVEIS.forEach((nv, i) => { if (i && (PAL[nv].includes(t) || t === nv)) n = Math.max(n, i); }); }
    return NIVEIS[n];
  }
  const t = sem(v); if (!t || ['nenhum', 'nao', 'n', 'sem', '-', 'false', 'none', '0'].includes(t)) return '';
  if (/^[0-3]$/.test(t)) return NIVEIS[Number(t)];
  for (const nv of ['excluir', 'modificar', 'ler']) if (PAL[nv].includes(t)) return nv;
  return '';
}
const sim = v => v === true || v === 1 || ['true', 'sim', 's', '1', 'yes', 'on'].includes(sem(v)) || (typeof v === 'string' && nivelDe(v) !== '');
/** Forma canônica do JSON de permissões (ver o cabeçalho). Nunca lança erro: formato desconhecido = sem acesso. */
export function normalizarPermissoes(p) {
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch { return {}; } }
  if (!p || typeof p !== 'object') return {};
  const out = {};
  const aplicar = (obj, prefixo = '') => {
    if (Array.isArray(obj)) { obj.forEach(x => { if (typeof x === 'string') { const t = x.trim(); if (CONHECIDAS.has(t)) out[t] = true; else { const [m, n] = t.split(/[:=]/); if (IDS.has(sem(m))) out[sem(m)] = nivelDe(n ?? true); } } else if (x && typeof x === 'object' && (x.modulo || x.id)) { const id = sem(x.modulo || x.id); if (IDS.has(id)) out[id] = nivelDe(x); } }); return; }
    for (const [k0, v] of Object.entries(obj)) {
      const k = String(k0).trim(), kk = sem(k);
      if (kk === 'sub') { if (v && typeof v === 'object') out.sub = v; continue; }
      if (['modulos', 'matriz', 'niveis', 'permissoes', 'acessos'].includes(kk) && v && typeof v === 'object' && !prefixo) { aplicar(v, k); continue; }
      if (IDS.has(kk)) { out[kk] = nivelDe(v); continue; }
      if (CONHECIDAS.has(k)) { out[k] = sim(v); continue; } /* v14.02: também as opções sem ponto (recebiveis_aprovar_saidas, liberacao_gerencial) */
    }
  };
  aplicar(p);
  return out;
}
export const normalizarPerfil = p => { const t = sem(p).toUpperCase(); return t === 'MASTER' || t === 'GESTOR' || t === 'ADMIN' ? 'MASTER' : t === 'LOJA' ? 'LOJA' : t === 'OPERACIONAL' || t === 'OPERADOR' ? 'OPERACIONAL' : t; };

/** Sub-permissões (v13.83): telas desmarcadas tiram as permissões que levam; ações marcadas filtram Modificar/Excluir. */
function recorte(modId, s = {}) {
  const ts = Object.entries(MATRIZ.telas).filter(([, c]) => c.mod === modId).flatMap(([rota, c]) => c.telas.map(([k, perms]) => ({ id: rota + ':' + k, perms })));
  const on = Array.isArray(s.telas) ? new Set(s.telas) : null, fora = new Set();
  if (on) { const ficam = new Set(ts.filter(t => on.has(t.id)).flatMap(t => t.perms)); ts.filter(t => !on.has(t.id)).forEach(t => t.perms.forEach(p => { if (!ficam.has(p)) fora.add(p); })); }
  return { fora, acoes: Array.isArray(s.acoes) ? new Set(s.acoes) : null };
}
/**
 * Permissões efetivas pela matriz (Set). recursoAtivo(k): recursos liberados no ambiente (Homologação: todos).
 * Master: '*'. Perfil Loja: só leitura (Solicitações até Modificar), como no painel.
 */
export const GERENCIAL_FORA = ['rh.ver_salarios', 'recebiveis_aprovar_saidas'];
export function permissoesEfetivas(usuario, recursoAtivo = () => true) {
  const perfil = normalizarPerfil(usuario?.perfil); if (perfil === 'MASTER') return new Set(['*']);
  if (perfil !== 'OPERACIONAL' && perfil !== 'LOJA') return new Set();
  const m = normalizarPermissoes(usuario?.permissoes), v83 = recursoAtivo('acessos_v1383'), loja = perfil === 'LOJA', sub = (v83 && m.sub) || {}, out = new Set();
  for (const mod of MATRIZ.modulos) {
    if ((mod.v1383 && !v83) || (mod.rec && !recursoAtivo(mod.rec))) continue;
    let n = NIVEIS.indexOf(m[mod.id] ?? (mod.id === 'solicitacoes' ? 'modificar' : '')); if (n < 0) n = 0;
    mod.extras.forEach(([k, livre, rec]) => { if (rec && !recursoAtivo(rec)) return; if (m[k] === true && (n > 0 || (livre && v83))) out.add(k); }); /* v13.93: extra também pode depender de um recurso liberado */
    if (n <= 0) continue;
    if (loja) n = mod.id === 'solicitacoes' ? Math.min(n, 2) : 1;
    const { fora, acoes } = recorte(mod.id, sub[mod.id] || {}), pode = (p, acao) => !fora.has(p) && (!acao || !acoes || acoes.has(p));
    mod.ler.forEach(p => pode(p) && out.add(p)); if (n >= 2) mod.modificar.forEach(p => pode(p, 1) && out.add(p)); if (n >= 3) mod.excluir.forEach(p => pode(p, 1) && out.add(p));
  }
  /* v14.02 · Liberação Gerencial: eleva o Operacional (nunca a Loja) a todos os módulos de negócio habilitados, com Ler, Modificar e Excluir. Fora da elevação: salários e
     a autorização de pagamentos (separação de funções); o PDI é só do Master (nenhuma permissão da matriz o libera). Banco de dados, Backup, Ambientes, Notificações e Acessos seguem só do Master (não estão na matriz). */
  if (out.has('liberacao_gerencial') && !loja) {
    for (const mod of MATRIZ.modulos) {
      if ((mod.v1383 && !v83) || (mod.rec && !recursoAtivo(mod.rec))) continue;
      [...mod.ler, ...mod.modificar, ...mod.excluir].forEach(p => out.add(p));
      mod.extras.forEach(([k, , rec]) => { if ((!rec || recursoAtivo(rec)) && !GERENCIAL_FORA.includes(k)) out.add(k); });
    }
  }
  return out;
}
export const tem = (perms, p) => !!perms && (perms.has('*') || perms.has(p));

/* Coleções de regra 'admin' liberadas pela matriz: [permissões que liberam a leitura, permissões que liberam a gravação]. */
export const COLECOES_MATRIZ = {
  contratos_locacao: [['lojas.contratos.ver'], ['lojas.contratos.editar', 'lojas.contrato.editar', 'lojas.contratos.excluir']],
  aluguel_projecoes: [['lojas.contratos.ver'], ['lojas.contratos.editar', 'lojas.contrato.editar']],
  adq_taxas: [['retaguarda.adq.ver'], ['retaguarda.adq.taxas']],
  adq_auditorias: [['retaguarda.adq.ver'], ['retaguarda.adq.importar']],
  adq_excecoes: [['retaguarda.adq.ver'], ['retaguarda.adq.importar', 'retaguarda.adq.taxas']],
  ec_taxas: [['retaguarda.adq.ver'], ['retaguarda.adq.taxas']],
  conc_fechamento: [['retaguarda.adq.ver', 'visao.dashboard', 'fcx.ver'], ['retaguarda.adq.importar']], /* v14.02: o Resumo do Recebível (Tela Inicial) lê o fechamento; antes só o Master/Retaguarda chegavam a ele */
  contasBancarias: [['fcx.dfc.ver'], ['fcx.dfc.contas']],
  extratos: [['fcx.dfc.ver'], ['fcx.dfc.importar']],
  dfc: [['fcx.dfc.ver'], ['fcx.dfc.importar', 'fcx.dfc.regras']],
  ieo_ocorrencias: [[], ['retaguarda.ieo.lancar']],
  ieo_fechamentos: [[], ['retaguarda.ieo.fechar']],
  ieo_laudos: [[], ['retaguarda.ieo.laudo']],
  ieo_auto: [[], ['retaguarda.ieo.lancar', 'retaguarda.ieo.fechar']],
  /* v14.02 (revisão estrita de permissões): coleções que só o Master abria passam a seguir as flags do perfil. Banco, backup, ambientes, notificações, acessos, auditoria e configuração seguem só do Master. */
  ret_ocorrencias: [['retaguarda.faltas.status', 'retaguarda.ocorrencias.lancar', 'retaguarda.ocorrencias.excluir'], ['retaguarda.ocorrencias.lancar', 'retaguarda.ocorrencias.excluir']],
  cred_pendencias: [['retaguarda.faltas.status', 'retaguarda.ocorrencias.lancar', 'retaguarda.ocorrencias.excluir'], ['retaguarda.ocorrencias.lancar', 'retaguarda.ocorrencias.excluir']],
  alertas: [[], ['retaguarda.ieo.lancar', 'retaguarda.ieo.fechar']],
  seguros_vigencia: [[], ['lojas.contratos.editar']],
  /* v13.93: salários só para quem tem a permissão isolada "Pode ver salários" (rh.ver_salarios) — leitura apenas; gravação segue só do Master */
  salarios: [['rh.ver_salarios'], []],
  rh_folhas: [['rh.ver_salarios'], []],
  /* v13.94: Fornecedores e Clientes (Módulo 13) — contêm CPF de pessoa física: leitura só com a permissão; Loja nunca acessa */
  parceiros: [['parceiros.ver', 'parceiros.editar', 'parceiros.excluir'], ['parceiros.editar', 'parceiros.excluir']],
  /* v14.11: Locatários / Locadores (Módulo 3) — mesma matriz dos contratos; contêm CPF/CNPJ e chaves PIX: Loja nunca acessa */
  partes_contratuais: [['lojas.contratos.ver'], ['lojas.contratos.editar', 'lojas.contrato.editar', 'lojas.contratos.excluir']],
};
/* v14.04 · DOCUMENTOS avulsos de coleções reservadas ao Master que a matriz libera (caminho sem o prefixo do ambiente → [leitura, gravação]).
   config/dfc guarda as regras de classificação, o De-para FCX → DFC e as categorias personalizadas da DFC: quem tem "Regras de classificação" (fcx.dfc.regras) grava este documento
   e só ele — o resto da coleção config (parâmetros do sistema, IEO, saldos…) segue só do Master. Excluir o documento continua só com o Master. */
export const DOCS_MATRIZ = {
  'config/dfc': [['fcx.dfc.ver'], ['fcx.dfc.regras']],
};
const semAmb = c => String(c).replace(/^amb\/[^/]+\//, '');
/** A matriz libera esta leitura ('r') ou gravação ('w')? (só para as coleções e documentos da lista acima; Loja nunca grava por aqui) */
export function acessoPorMatriz(sess, caminho, op) {
  if (!sess || sess.trocaPendente || !sess.perms) return false;
  const r = DOCS_MATRIZ[semAmb(caminho)] || COLECOES_MATRIZ[semAmb(caminho).split('/')[0]]; if (!r) return false;
  if ((op === 'w' || semAmb(caminho).startsWith('parceiros') || semAmb(caminho).startsWith('partes_contratuais')) && sess.perfil === 'LOJA') return false;
  return (op === 'r' ? r[0] : r[1]).some(p => tem(sess.perms, p));
}
/** v13.94: excluir exige a permissão própria de exclusão nas coleções liberadas pela matriz (editar não basta). Master sempre pode. */
export function exclusaoPermitida(sess, caminho) {
  if (DOCS_MATRIZ[semAmb(caminho)]) return !!sess && sess.nivel >= 3 && !sess.trocaPendente; /* v14.04: o documento liberado pela matriz só é excluído pelo Master */
  const colEx = semAmb(caminho).split('/')[0];
  if (colEx === 'partes_contratuais') return !!sess && sess.nivel >= 3 || tem(sess?.perms, 'lojas.contratos.excluir'); /* v14.11: excluir locador/locatário exige a permissão própria de exclusão de contratos */
  if (colEx !== 'parceiros') return true;
  return !!sess && sess.nivel >= 3 || tem(sess?.perms, 'parceiros.excluir');
}
