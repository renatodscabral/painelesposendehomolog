/* v14.13 · Escopo dos backups (ponto de restauração na nuvem E arquivo .json de contingência) — uma lista só, por "frente" (módulo do painel).

   Regra: o ponto na nuvem guarda TODA coleção da tabela `documentos` (menos RAIZES_FORA) mais as tabelas de CONFIGURAÇÃO listadas em TABELAS; o .json guarda o mesmo
   conjunto, coleção a coleção (lista Bkp.COLECOES do painel, que o teste confere contra este arquivo). Uma coleção nova do painel que ainda não esteja numa frente cai
   em "Outras coleções" no resumo — e o teste automatizado falha até ela ser classificada aqui e em Bkp.FRENTES (public/index.html).

   Fica de fora de propósito (não deve ser sobrescrito por uma restauração):
     · auditoria, presenca, sistema, amb (log de auditoria, presença, marcadores do sistema, ramos de ambiente do claude.ai);
     · os arquivos enviados ao armazenamento do painel (tabelas arquivos / arquivo_partes: PDFs e imagens de até 15 MB);
     · o livro contábil (contab_lancamentos, contab_partidas, contab_lalur): intangível por desenho; o plano de contas e os parâmetros (contab_contas,
       contab_parametros, com a data de fechamento do período) também ficam fora, para uma restauração nunca reabrir período fechado nem reescrever o que o livro cita;
     · as decisões de aprovação de pagamentos (painel_saidas_lotes / painel_saidas_decisoes) e o log de envios da Central de Notificações
       (painel_notificacoes_log) e os números instantâneos (painel_notificacoes_instantaneo): são registros históricos/derivados, não configuração. */

export const RAIZES_FORA = ['auditoria', 'presenca', 'sistema', 'amb'];

/** Tabelas relacionais de configuração que entram nos dois backups (além da tabela `documentos`). */
export const TABELAS = [
  { nome: 'painel_notificacoes_regras', rotulo: 'Central de Notificações · regras e disparos', chave: ['evento_chave'], ordem: 'evento_chave' },
  { nome: 'contab_empresas', rotulo: 'Cadastro contábil de empresas', chave: ['id'], ordem: 'id' },
  { nome: 'contab_depara', rotulo: 'De-para FCX → plano de contas', chave: ['origem', 'chave'], ordem: 'origem, chave' },
];
export const NOMES_TABELAS = TABELAS.map(t => t.nome);

/** Frentes (módulos). `colecoes`: raízes exatas ou sub-coleções (a mais longa que casar vence); `tabelas`: nomes de TABELAS. */
export const FRENTES = [
  { id: 'lojas', rotulo: 'Lojas e Ponto de Equilíbrio', colecoes: ['lojas', 'lojas_faturamento', 'pe_simulador'] },
  { id: 'rh', rotulo: 'RH e Organograma (equipe, salários, férias e folgas)', colecoes: ['funcionarios', 'pdi', 'salarios', 'rh_folhas', 'rh_cargos', 'rh_centros', 'rh_departamentos', 'rh_importacoes', 'funcionarios/_liberacoes/pedidos'] },
  { id: 'viagens', rotulo: 'Viagens e Adiantamentos', colecoes: ['funcionarios/_viagens/pedidos', 'funcionarios/_viagens/parametros'] },
  { id: 'contratos', rotulo: 'Contratos, apólices e reajustes', colecoes: ['contratos_locacao', 'partes_contratuais', 'seguros_vigencia', 'aluguel_projecoes'] },
  { id: 'parceiros', rotulo: 'Fornecedores e Clientes (chaves PIX e categoria DFC)', colecoes: ['parceiros'] },
  { id: 'dfc', rotulo: 'DFC · contas bancárias, extratos OFX e bases mensais', colecoes: ['contasBancarias', 'extratos', 'dfc'] },
  { id: 'fcx', rotulo: 'FCX · fluxo de caixa, orçamentos e saídas', colecoes: ['fcx'] },
  { id: 'retaguarda', rotulo: 'Retaguarda de Loja (faltas, caixas, cofre, IEO, alertas, solicitações)', colecoes: ['faltas', 'caixas', 'ret_cofre', 'ret_depositos', 'ret_ocorrencias', 'ret_consumidor', 'cred_pendencias', 'ieo_ocorrencias', 'ieo_fechamentos', 'ieo_laudos', 'ieo_auto', 'ieo_log', 'alertas', 'solicitacoes'] },
  { id: 'credsystem', rotulo: 'Credsystem (metas, campanhas, apurações)', colecoes: ['credsystem', 'credsystem_metas', 'credsystem_campanhas', 'credsystem_apuracoes', 'credsystem_base', 'credsystem_resultados'] },
  { id: 'adquirentes', rotulo: 'Auditoria de Adquirentes e conciliação', colecoes: ['adq_taxas', 'adq_auditorias', 'adq_excecoes', 'ec_taxas', 'conc_fechamento', 'adq_contratos', 'adq_lotes', 'adq_agendas', 'adq_erp'] },
  { id: 'config', rotulo: 'Configurações (regras e categorias da DFC, empresas e Matriz, parâmetros, versões liberadas)', colecoes: ['config'] },
  { id: 'usuarios', rotulo: 'Usuários e permissões', colecoes: ['usuarios'] },
  { id: 'notificacoes', rotulo: 'Central de Notificações (regras e disparos)', colecoes: [], tabelas: ['painel_notificacoes_regras'] },
  { id: 'contabil', rotulo: 'Contábil · empresas e de-para', colecoes: [], tabelas: ['contab_empresas', 'contab_depara'] },
];
export const OUTRAS = { id: 'outras', rotulo: 'Outras coleções (ainda sem frente definida)' };

/** Coleção → id da frente (ou 'outras'). `faltas/_anexos/partes` pertence à frente de `faltas`. */
export function frenteDe(colecao) {
  const c = String(colecao || ''); let melhor = null, tam = -1;
  for (const f of FRENTES) for (const x of f.colecoes) {
    if ((c === x || c.startsWith(x + '/')) && x.length > tam) { melhor = f.id; tam = x.length; }
  }
  return melhor || 'outras';
}

/**
 * Resumo para o Master conferir: por frente, as coleções/tabelas com o total de registros.
 * colecoes: { nome → n } · tabelas: { nome → n } · destaques: { dfc: { regras, categorias, ajustesPadrao, mapaFCX, inicializada }, configDocs: [ids] }
 */
export function resumir({ colecoes = {}, tabelas = {}, destaques = null } = {}) {
  const por = new Map([...FRENTES, OUTRAS].map(f => [f.id, { id: f.id, rotulo: f.rotulo, itens: [], registros: 0 }]));
  for (const [c, n] of Object.entries(colecoes)) { const f = por.get(frenteDe(c)); const k = Number(n) || 0; f.itens.push({ nome: c, tipo: 'colecao', registros: k }); f.registros += k; }
  for (const t of TABELAS) {
    if (!(t.nome in tabelas)) continue;
    const dono = FRENTES.find(f => (f.tabelas || []).includes(t.nome)), f = por.get(dono ? dono.id : 'outras'), k = Number(tabelas[t.nome]) || 0;
    f.itens.push({ nome: t.nome, tipo: 'tabela', registros: k }); f.registros += k;
  }
  const frentes = [...por.values()].filter(f => f.itens.length || f.id !== 'outras').map(f => ({ ...f, itens: f.itens.sort((a, b) => a.nome.localeCompare(b.nome)) }));
  const total = frentes.reduce((a, f) => a + f.registros, 0), semFrente = (frentes.find(f => f.id === 'outras')?.itens || []).map(i => i.nome);
  return { frentes, total, semFrente, destaques: destaques || null, tabelas: Object.keys(tabelas).length };
}
