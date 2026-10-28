/* Regras de acesso por coleção — as mesmas 39 regras do banco do painel no claude.ai.
   Níveis: view (1) < interact (2) < admin (3). No Netlify: perfil MASTER = admin; OPERACIONAL = interact.
   Coleções fora da lista: leitura e gravação para qualquer usuário logado (interact), como no claude.ai.
   {self}: o ramo da própria conta (auditoria/<id>, presenca/<id>) — a conta é o id do usuário logado. */
export const REGRAS = {
  salarios: ['admin', 'admin'], config: ['interact', 'admin'], auditoria: ['admin', 'admin'], 'auditoria/{self}': ['interact', 'interact'],
  presenca: ['admin', 'admin'], 'presenca/{self}': ['interact', 'interact'], contasBancarias: ['admin', 'admin'], extratos: ['admin', 'admin'],
  dfc: ['admin', 'admin'], ieo_ocorrencias: ['interact', 'admin'], ieo_fechamentos: ['interact', 'admin'], ieo_laudos: ['interact', 'admin'],
  alertas: ['interact', 'admin'], rh_cargos: ['interact', 'admin'], rh_centros: ['interact', 'admin'], contratos_locacao: ['admin', 'admin'],
  aluguel_projecoes: ['admin', 'admin'], adq_taxas: ['admin', 'admin'], adq_auditorias: ['admin', 'admin'], adq_excecoes: ['admin', 'admin'],
  seguros_vigencia: ['interact', 'admin'], credsystem_base: ['interact', 'interact'], credsystem_apuracoes: ['interact', 'interact'],
  funcionarios: ['interact', 'interact'], usuarios: ['interact', 'interact'], pdi: ['admin', 'admin'], faltas: ['interact', 'interact'],
  caixas: ['interact', 'interact'], credsystem_resultados: ['interact', 'interact'], sistema: ['view', 'interact'], ret_ocorrencias: ['admin', 'admin'],
  ieo_auto: ['interact', 'admin'], pe_simulador: ['admin', 'admin'], rh_folhas: ['admin', 'admin'], amb: ['admin', 'admin'],
  lojas_faturamento: ['interact', 'admin'], cred_pendencias: ['admin', 'admin'], ec_taxas: ['admin', 'admin'], conc_fechamento: ['admin', 'admin'],
};
export const NIVEL = { nenhum: 0, view: 1, interact: 2, admin: 3 };
export const nivelDoPerfil = perfil => (perfil === 'MASTER' ? NIVEL.admin : perfil === 'OPERACIONAL' ? NIVEL.interact : NIVEL.nenhum);

/** Nível exigido para ler ('r') ou gravar ('w') um caminho (documento ou coleção). */
export function exigido(caminho, op, uid) {
  const s = String(caminho).split('/'), raiz = s[0];
  let r = REGRAS[raiz + '/{self}'] && uid && s[1] === uid ? REGRAS[raiz + '/{self}'] : REGRAS[raiz];
  if (!r) r = ['interact', 'interact'];
  return NIVEL[op === 'r' ? r[0] : r[1]];
}

/* ---------- validação de caminhos ---------- */
const SEG = /^[^/\u0000-\u001f]{1,300}$/;
export function validarCaminho(c, tipo) {
  const t = String(c || '');
  if (!t || t.length > 1500 || t.startsWith('/') || t.endsWith('/')) return false;
  const s = t.split('/');
  if (!s.every(x => SEG.test(x) && x !== '.' && x !== '..')) return false;
  return tipo === 'doc' ? s.length % 2 === 0 : s.length % 2 === 1;
}
export const partes = caminho => { const i = caminho.lastIndexOf('/'); return { colecao: caminho.slice(0, i), docId: caminho.slice(i + 1) }; };

/** Prefixo do banco de cada ambiente (o mesmo do painel: Produção na raiz). */
export const PREFIXO = { prod: '', homolog: 'amb/homolog/', rc: 'amb/rc/' };
export const ehUsuarios = caminho => /^(amb\/[^/]+\/)?usuarios\/[^/]+$/.test(caminho);
