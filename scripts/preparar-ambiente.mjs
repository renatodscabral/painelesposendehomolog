/* Etapa de build do Netlify: prepara os arquivos estáticos do ambiente deste site.
   PAINEL_AMBIENTE=rc (RC Consultoria, white-label):
     • v13.76: troca as logomarcas (painel e FCX) pelas da RC (public/marca-rc/);
     • v13.76: remove do fcx.html os dados de exemplo da Esposende (const SEED: vendas, plano de contas, centros de custo,
       fornecedores e saídas reais), deixando a mesma estrutura vazia — exceção à Regra de Ouro autorizada em 28/10/2026,
       exclusiva do site da RC. Se o bloco não puder ser removido com segurança, o build FALHA (nada é publicado);
     • v13.76: marca neutra no FCX da RC (exceção estendida em 28/10/2026): título, rótulos, nome do arquivo de backup
       e o CATALOGO_OFICIAL (centros de custo e plano de contas) sem nomes de lojas, empresas do grupo ou da Esposende.
       Só textos mudam; identificadores internos (ex.: a chave esposende_card) ficam, para não quebrar dados gravados. */
import fs from 'node:fs';
const amb = (process.env.PAINEL_AMBIENTE || 'prod').trim();

export function fcxSemSeed(html) {
  const ini = html.indexOf('const SEED = '); if (ini < 0) throw new Error('fcx.html: bloco const SEED não encontrado');
  const fim = html.indexOf(';\n', ini); if (fim < 0) throw new Error('fcx.html: fim do bloco SEED não encontrado');
  const seed = JSON.parse(html.slice(ini + 'const SEED = '.length, fim)); // se não for o JSON esperado, falha aqui
  const vazio = { methodKeys: seed.methodKeys, salesHistory: [], accounts: [], costCenters: [], fornecedores: [], saidas: [] };
  const novo = html.slice(0, ini) + 'const SEED = ' + JSON.stringify(vazio) + '; /* RC Consultoria: dados de exemplo da Esposende removidos no build (exceção à Regra de Ouro autorizada em 28/10/2026) */' + html.slice(fim + 1);
  if (/Shopping Mana[ií]ra/.test(novo.slice(ini, ini + 2000)) || novo.length > html.length - 100000) throw new Error('fcx.html: remoção do SEED não conferiu');
  return novo;
}

/* ---------- marca neutra no FCX da RC ---------- */
const TROCAS_FCX = [ // [texto exato, novo texto, ocorrências esperadas]
  ['<title>Fluxo de Caixa — Esposende LTDA</title>', '<title>Fluxo de Caixa — RC Consultoria</title>', 1],
  ['ESPOSENDE — SIMULADOR DE FLUXO DE CAIXA (v2)', 'RC CONSULTORIA — SIMULADOR DE FLUXO DE CAIXA (v2)', 1],
  ['ESPOSENDE — PAINEL ANALÍTICO', 'RC CONSULTORIA — PAINEL ANALÍTICO', 1],
  ["esposende_card:'Esposende Card (Credsystem)'", "esposende_card:'Cartão Próprio / Private Label'", 1],
  ['<img src="${LOGO_SRC}" alt="Esposende">', '<img src="${LOGO_SRC}" alt="RC Consultoria">', 1],
  ["a.download = 'backup-fluxo-caixa-esposende-'", "a.download = 'backup-fluxo-caixa-rc-consultoria-'", 1],
];
const GRUPO = { 'DOK': 'EMPRESA DO GRUPO A', 'PAQUETÁ': 'EMPRESA DO GRUPO B', 'MAR ABERTO': 'EMPRESA DO GRUPO C', 'HIPERFOCO': 'EMPRESA DO GRUPO D',
  'BRA BENEFÍCIOS': 'EMPRESA DO GRUPO E', 'SETE MARES': 'EMPRESA DO GRUPO F', 'SRC CONSTRUTORA': 'EMPRESA DO GRUPO G', 'FLORIDA RENT A CAR': 'EMPRESA DO GRUPO H',
  'DOK PARTICIPAÇÕES': 'PARTICIPAÇÕES', 'RECUPERAÇÃO JUDICIAL': 'REESTRUTURAÇÃO' };
const CONTAS = [ // [regex sobre o nome da conta (depois do código), substituição]
  [/^\(-\) MDR - Cartão Esposende$/, '(-) MDR - Cartão Próprio / Private Label'],
  [/Esposende Card$/, 'Cartão Próprio / Private Label'],
  [/^\(-\) Recuperação Judicial$/, '(-) Reestruturação e Acordos'],
  [/^\(-\) Acordo de Rescisoes Paqueta$/, '(-) Acordo de Rescisões (Grupo)'],
  [/^\(-\) Fornecedores - R\.J\.$/, '(-) Fornecedores - Reestruturação'],
  [/^\(-\) Operacional DOK$/, '(-) Operacional (Grupo)'],
  [/^\(-\) Assessoria Judicial - R\.J\.$/, '(-) Assessoria Judicial'],
  [/^\(-\) Acordo de Recisoes Esposende$/, '(-) Acordo de Rescisões'],
  [/ICMS RJ - /, 'ICMS Especial - '],
];
export function catalogoNeutro(cat) {
  const sep = ' – ', parte = x => { const i = x.indexOf(sep); return i < 0 ? ['', x] : [x.slice(0, i), x.slice(i + sep.length)]; };
  const centros = cat.centros.map(x => {
    const [cod, nome] = parte(x), limpo = nome.trim();
    if (/^2\.05\.\d{3}$/.test(cod) && limpo !== 'GESTÃO') {             // lojas da Gerência Regional
      const n = (limpo.match(/^(\d{3})/) || [])[1];
      if (!n) return x;
      const rot = /ESPOSENDE RJ/i.test(limpo) ? 'LOJA MATRIZ' : /ESCRIT/i.test(limpo) ? 'ESCRITÓRIO CENTRAL' : /\bCD\b/.test(limpo) ? 'CENTRO DE DISTRIBUIÇÃO' : 'LOJA ' + n;
      return `${cod}${sep}${n} - ${rot}`;
    }
    return GRUPO[limpo] ? `${cod}${sep}${GRUPO[limpo]}` : x;
  });
  const contas = cat.contas.map(x => { const [cod, nome] = parte(x); for (const [re, novo] of CONTAS) if (re.test(nome)) return `${cod}${sep}${nome.replace(re, novo)}`; return x; });
  return { centros, contas };
}
export function fcxMarcaRc(html) {
  let h = html;
  for (const [de, para, n] of TROCAS_FCX) { const c = h.split(de).length - 1; if (c !== n) throw new Error(`fcx.html: esperado ${n}× "${de}", achado ${c}×`); h = h.split(de).join(para); }
  const marca = 'const CATALOGO_OFICIAL = ', ini = h.indexOf(marca), fim = h.indexOf(';\n', ini);
  if (ini < 0 || fim < 0) throw new Error('fcx.html: CATALOGO_OFICIAL não encontrado');
  const cat = catalogoNeutro(JSON.parse(h.slice(ini + marca.length, fim)));
  h = h.slice(0, ini) + marca + JSON.stringify(cat) + h.slice(fim);
  const resto = h.replace(/esposende_card|isEC|const SEED = [^\n]*/g, '');
  const sobra = resto.match(/esposende|paquet|\bDOK\b|mar aberto|hiperfoco|sete mares|src construtora|florida rent|bra benef|mana[ií]ra|recupera[cç][aã]o judicial|R\.J\./gi);
  if (sobra) throw new Error('fcx.html da RC ainda cita: ' + [...new Set(sobra)].join(', '));
  return h;
}

if (amb === 'rc') {
  for (const f of ['logo_branco.png', 'logo_navy.png', 'logo_fcx.png']) fs.copyFileSync('public/marca-rc/' + f, 'public/' + f);
  fs.writeFileSync('public/fcx.html', fcxMarcaRc(fcxSemSeed(fs.readFileSync('public/fcx.html', 'utf8'))));
  console.log('[painel] RC Consultoria: logomarcas white-label, FCX sem dados de exemplo da Esposende e com marca neutra');
} else console.log(`[painel] ambiente ${amb}: arquivos da Esposende (sem alteração)`);
