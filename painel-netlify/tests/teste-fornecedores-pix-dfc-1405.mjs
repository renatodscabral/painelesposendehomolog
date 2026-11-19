/* v14.05 · Fornecedores e Clientes (Módulo 13) × chaves PIX × Extratos OFX × DFC.
   Valida o CÓDIGO REAL do painel (public/index.html: motor PARC_PIX/PARC_IMP, leitor OFX, objeto DFC e o CSV) num contexto isolado do Node,
   sem navegador e sem banco, com cadastros e lançamentos FICTÍCIOS (LGPD; CNPJ/CPF de exemplo gerados aqui pelos dígitos verificadores):
   1) normalização das chaves PIX: CNPJ e CPF (com/sem máscara), telefone (com e sem +55/55/0), e-mail (sem diferenciar maiúsculas) e chave aleatória;
   2) o CNPJ/CPF principal vale como chave; bloqueio de chave repetida entre dois cadastros (e a mesma chave no mesmo cadastro não é conflito);
   3) importação da planilha (.csv com ";" ou ","; leitura flexível de colunas): novos × existentes × inválidos × chaves duplicadas, mescla sem apagar, idempotência;
   4) cruzamento do histórico do extrato: chave PIX → documento → nome (≥ 6 caracteres, inequívoco), ambiguidade, e texto completo NAME/MEMO/PAYEE do OFX;
   5) classificação na DFC: manual > regra > categoria padrão do fornecedor > padrão automático do fornecedor (+ "Saídas não operacionais" isolada no demonstrativo);
   6) recurso desligado = comportamento anterior; categoria em uso por fornecedor não é excluída.
   Uso: node tests/teste-fornecedores-pix-dfc-1405.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(raiz, 'public/index.html'), 'utf8');
const OK = [], FAIL = [];
const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (!c && x !== '' ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 700) : '')); };

/* ---------- extrai o código real: CSV, leitor OFX e o bloco da DFC (que contém PARC_PIX e PARC_IMP) ---------- */
const corta = (ini, fim) => { const a = html.indexOf(ini), b = html.indexOf(fim, a); if (a < 0 || b < 0) throw new Error('bloco não encontrado: ' + ini); return html.slice(a, b); };
const csvCod = corta('const CSV = {', '/**\n * WhatsApp (camada Util)');
const ofxCod = corta('const OFX = {', '/* ======================= CONTAS (de-para)');
const dfcCod = corta('const DFC_GRUPOS = {', '/* ============================ IEO ============================ */');
/** `cfg` = config/dfc simulado; `parc` = Map id → cadastro (Repo.get('parceiros')); `ligado` = recurso gestao_v1405 */
const montar = (cfg, parc, ligado = true, prontas) => {
  const Repo = { get: (col, id) => col === 'config' && id === 'dfc' ? cfg.doc : col === 'parceiros' ? parc.get(id) || null : null };
  if (prontas) Repo.prontas = prontas; // como no painel: coleções já carregadas (quem não tem parceiros.ver nunca carrega 'parceiros')
  return new Function('Repo', 'g04', 'g05', csvCod + '\n' + ofxCod + '\n' + dfcCod + '\nreturn { CSV, OFX, DFC, DFC_CATEGORIAS, DFC_REGRAS_PADRAO, PARC_PIX, PARC_IMP };')(Repo, () => true, () => ligado);
};
const cfg = { doc: null }, parc = new Map();
const { CSV, OFX, DFC, DFC_CATEGORIAS, DFC_REGRAS_PADRAO, PARC_PIX: X, PARC_IMP: I } = montar(cfg, parc);

/* ---------- documentos de exemplo, gerados pelos dígitos verificadores (nenhum é de pessoa ou empresa real) ---------- */
const dvCnpj = b => { const calc = (d, ps) => { const r = d.reduce((a, x, i) => a + x * ps[i], 0) % 11; return r < 2 ? 0 : 11 - r; }; const d = String(b).split('').map(Number); d.push(calc(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])); d.push(calc(d, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])); return d.join(''); };
const dvCpf = b => { const calc = (d, n) => { const r = d.reduce((a, x, i) => a + x * (n - i), 0) * 10 % 11; return r === 10 ? 0 : r; }; const d = String(b).split('').map(Number); d.push(calc(d, 10)); d.push(calc(d, 11)); return d.join(''); };
const maskCnpj = d => d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5'), maskCpf = d => d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
const CNPJ_A = dvCnpj('112223330001'), CNPJ_C = dvCnpj('457231740001'), CNPJ_D = dvCnpj('334455660001'), CNPJ_N = dvCnpj('998877660001');
const CPF_B = dvCpf('529982247'), CPF_E = dvCpf('111444777'), CPF_F = dvCpf('935411347');
const invalido = CNPJ_A.slice(0, 13) + (CNPJ_A[13] === '0' ? '1' : '0');

/* ---------- 1 · normalização das chaves PIX ---------- */
chk('os dígitos verificadores gerados no teste batem com o motor (CNPJ e CPF)', X.cnpjOk(CNPJ_A) && X.cnpjOk(maskCnpj(CNPJ_A)) && X.cpfOk(CPF_B) && X.cpfOk(maskCpf(CPF_B)) && !X.cnpjOk(invalido) && !X.cpfOk('11111111111'));
chk('CNPJ: 14 dígitos com ou sem máscara viram a mesma chave; dígito errado é recusado', X.canon('cnpj', maskCnpj(CNPJ_A)) === CNPJ_A && X.canon('cnpj', CNPJ_A) === CNPJ_A && X.canon('cnpj', invalido) === null && X.canon('cnpj', '123') === null);
chk('CPF: 11 dígitos com ou sem máscara viram a mesma chave; sequência repetida é recusada', X.canon('cpf', maskCpf(CPF_B)) === CPF_B && X.canon('cpf', CPF_B) === CPF_B && X.canon('cpf', '000.000.000-00') === null);
const FONE = '81999990001';
const fones = ['+55 (81) 99999-0001', '5581999990001', '+5581999990001', '081999990001', '(81) 99999-0001', '81 99999 0001', '81999990001', '55 81 99999-0001', '0 81 99999.0001'];
chk('telefone: com e sem +55/55/0, com máscara e sem, todos normalizam para DDD + número', fones.every(f => X.telefone(f) === FONE), fones.map(f => [f, X.telefone(f)]).filter(([, r]) => r !== FONE));
chk('telefone fixo (10 dígitos) também normaliza; DDD inexistente, 11 dígitos sem 9 e números curtos são recusados', X.telefone('(81) 3333-4444') === '8133334444' && X.telefone('+55 81 3333-4444') === '8133334444' && X.telefone('+55 (20) 99999-0001') === null && X.telefone('81888880001') === null && X.telefone('9999-0001') === null);
chk('telefone com DDD 55 (RS) não é confundido com o prefixo do país', X.telefone('55999990001') === '55999990001' && X.telefone('+55 55 99999-0001') === '55999990001');
chk('e-mail: sem diferenciar maiúsculas; formato inválido é recusado', X.canon('email', '  Financeiro@Exemplo.COM.br ') === 'financeiro@exemplo.com.br' && X.canon('email', 'sem-arroba') === null && X.canon('email', 'a@b') === null);
const EVP = '123e4567-e89b-12d3-a456-426614174000';
chk('chave aleatória (EVP): com ou sem hifens, em qualquer caixa; tamanho errado é recusado', X.canon('evp', EVP.toUpperCase()) === EVP && X.canon('evp', EVP.replace(/-/g, '')) === EVP && X.canon('evp', EVP.slice(0, -1)) === null && X.canon('evp', 'zzze4567-e89b-12d3-a456-426614174000') === null);
chk('detecção automática do tipo pelo formato', X.detectar(maskCnpj(CNPJ_A)) === 'cnpj' && X.detectar(CPF_B) === 'cpf' && X.detectar('+55 81 99999-0001') === 'telefone' && X.detectar('(81) 99999-0001') === 'telefone' && X.detectar('A@b.com.br') === 'email' && X.detectar(EVP) === 'evp' && X.detectar('abc') === null,
  [X.detectar(maskCnpj(CNPJ_A)), X.detectar(CPF_B), X.detectar('+55 81 99999-0001'), X.detectar(EVP)]);
chk('11 dígitos que fecham como CPF são CPF; se não fecham e são um celular, são telefone', X.detectar('52998224725') === 'cpf' && X.detectar('81999990001') === 'telefone');
chk('exibição formatada das chaves', X.formatar('cnpj', CNPJ_A) === maskCnpj(CNPJ_A) && X.formatar('cpf', CPF_B) === maskCpf(CPF_B) && X.formatar('telefone', FONE) === '+55 (81) 99999-0001' && X.formatar('telefone', '8133334444') === '+55 (81) 3333-4444');

/* ---------- cadastro fictício (Módulo 13) ---------- */
const A = { id: 'par-a', tipo: 'PJ', papeis: ['fornecedor'], documento: maskCnpj(CNPJ_A), nome: 'Calçados Exemplo Indústria Ltda', nomeFantasia: 'Calçados Exemplo', ativo: true, chavesPix: [{ tipo: 'email', chave: 'financeiro@exemplo.com.br' }, { tipo: 'telefone', chave: FONE }], categoriaDfc: '' };
const B = { id: 'par-b', tipo: 'PF', papeis: ['fornecedor'], documento: maskCpf(CPF_B), nome: 'Maria Exemplo da Silva', ativo: true, chavesPix: [{ tipo: 'evp', chave: EVP }], categoriaDfc: 'pag_administrativas' };
const C = { id: 'par-c', tipo: 'PJ', papeis: ['fornecedor', 'cliente'], documento: maskCnpj(CNPJ_C), nome: 'Distribuidora Modelo Comércio S/A', nomeFantasia: 'Modelo', ativo: true, chavesPix: [], categoriaDfc: '' };
const todos = [A, B, C];
todos.forEach(p => parc.set(p.id, p));

/* ---------- 2 · o CNPJ/CPF principal vale como chave; conflitos ---------- */
const ch = X.chavesDoParceiro(A).map(c => c.tipo + ':' + c.chave + ':' + c.origem);
chk('o CNPJ/CPF principal do cadastro entra automaticamente como chave PIX (origem "documento")', ch.includes('cnpj:' + CNPJ_A + ':documento') && ch.includes('email:financeiro@exemplo.com.br:cadastro') && ch.includes('telefone:' + FONE + ':cadastro') && ch.length === 3, ch);
chk('sem repetição entre cadastros, o índice não tem conflitos', X.indice(todos).conflitos.length === 0 && X.conflitos(todos).length === 0);
const novo = (extra = {}) => ({ id: 'par-n', documento: maskCnpj(CNPJ_N), chavesPix: [], ...extra });
const k1 = X.conflitosDoCadastro(novo({ chavesPix: [{ tipo: 'telefone', chave: X.telefone('+55 (81) 99999-0001') }] }), todos);
chk('bloqueio: a mesma chave (após normalizar) não vai para dois fornecedores diferentes — o aviso nomeia o dono', k1.length === 1 && k1[0].com.nome === A.nome && /99999-0001/.test(k1[0].rotulo), k1);
const k2 = X.conflitosDoCadastro(novo({ chavesPix: [{ tipo: 'email', chave: X.canon('email', 'FINANCEIRO@exemplo.com.br') }] }), todos);
chk('bloqueio: e-mail em outra caixa é a mesma chave', k2.length === 1 && k2[0].com.id === 'par-a');
const k3 = X.conflitosDoCadastro(novo({ chavesPix: [{ tipo: 'cnpj', chave: CNPJ_A }] }), todos);
chk('bloqueio: o CNPJ principal de um fornecedor não pode ser chave PIX de outro', k3.length === 1 && k3[0].origem === 'documento' && k3[0].com.id === 'par-a', k3);
const k4 = X.conflitosDoCadastro(novo({ documento: maskCnpj(CNPJ_C) }), todos);
chk('bloqueio: cadastrar o mesmo CNPJ de outro parceiro (documento principal) também é conflito', k4.length === 1 && k4[0].com.id === 'par-c');
const k5 = X.conflitosDoCadastro({ ...A, chavesPix: [...A.chavesPix, { tipo: 'email', chave: 'financeiro@exemplo.com.br' }, { tipo: 'cnpj', chave: CNPJ_A }] }, todos);
chk('editar o próprio cadastro: repetir a chave nele mesmo (ou o próprio CNPJ como chave) não é conflito', k5.length === 0, k5);
const dup = [A, { ...C, chavesPix: [{ tipo: 'email', chave: 'financeiro@exemplo.com.br' }] }];
chk('base legada com a mesma chave em dois cadastros: aparece em conflitos() e deixa de vincular (ambígua)', X.conflitos(dup).length === 1 && X.conflitos(dup)[0].ids.length === 2 && X.vincular({ hist: 'PIX FINANCEIRO@EXEMPLO.COM.BR' }, X.indice(dup))?.ambigua === true);

/* ---------- 3 · importação da planilha ---------- */
const cabecalho = 'Tipo;CNPJ_CPF;Razao_Social;Nome_Fantasia;Chave_PIX_CNPJ;Chave_PIX_CPF;Chave_PIX_Telefone;Chave_PIX_Email;Chave_PIX_Aleatoria;Chaves_PIX;Categoria_DFC_Padrao;Telefone;Email;CEP;Logradouro;Numero;Bairro;Cidade;UF;Situacao';
const linhas = [
  `Fornecedor;${maskCnpj(CNPJ_D)};Embalagens Teste Ltda;Embalagens Teste;;;(81) 98888-0002;compras@teste.com.br;;;Marketing e publicidade;(81) 3333-0002;contato@teste.com.br;50000000;Rua das Flores;100;Centro;Recife;pe;ATIVA`,
  `Cliente;${CPF_E};João Exemplo Souza;;;${maskCpf(CPF_E)};;;;;;;;;;;;;;`,
  `Ambos;${maskCnpj(CNPJ_A)};;;;;;novo.financeiro@exemplo.com.br;;"+55 81 97777-0003; ${EVP.replace('4000', '4999')}";Pagamento a fornecedores;;;;;;;;;`,
  `Fornecedor;${invalido};Empresa Inválida Ltda;;;;;;;;;;;;;;;;;`,
  `Fornecedor;${maskCnpj(CNPJ_N)};Fornecedor Chave Repetida Ltda;;;;;financeiro@exemplo.com.br;;;;;;;;;;;;`,
  `;${CPF_F};Pessoa Sem Tipo;;;;;;;;Categoria que não existe;;;;;;;;;`,
  `Terceiro;${maskCnpj(CNPJ_N)};Tipo Errado Ltda;;;;;;;;;;;;;;;;;`,
];
const csv = [cabecalho, ...linhas].join('\r\n');
const lido = CSV.ler(csv);
chk('CSV com ";" é lido (separador detectado) e as 20 colunas do modelo são reconhecidas', lido.separador === ';' && lido.cabecalho.length === 20 && Object.keys(I.mapear(lido.cabecalho).col).length === 20 && I.mapear(lido.cabecalho).ignoradas.length === 0, [lido.separador, Object.keys(I.mapear(lido.cabecalho).col).length]);
const csvVirgula = [cabecalho.replace(/;/g, ','), linhas[1].replace(/;/g, ',')].join('\n');
const lv = CSV.ler(csvVirgula), rv = I.registros(lv.cabecalho, lv.linhas);
chk('CSV com "," também é lido', lv.separador === ',' && rv.registros?.length === 1 && rv.registros[0].documento?.limpo === CPF_E, rv);
const flex = I.mapear(['tipo', 'CNPJ/CPF', 'Razão Social', 'NOME FANTASIA', 'chave pix e-mail', 'Chave PIX — Telefone', 'Chaves PIX', 'Categoria DFC', 'Endereço', 'Município', 'Estado', 'Status', 'Coluna Qualquer']);
chk('leitura flexível de cabeçalhos: sem diferenciar maiúsculas/acentos/pontuação; coluna desconhecida é só ignorada', flex.col.documento === 'CNPJ/CPF' && flex.col.nome === 'Razão Social' && flex.col.fantasia === 'NOME FANTASIA' && flex.col.pix_email === 'chave pix e-mail' && flex.col.pix_telefone === 'Chave PIX — Telefone' && flex.col.pix_lista === 'Chaves PIX' && flex.col.categoria === 'Categoria DFC' && flex.col.logradouro === 'Endereço' && flex.col.cidade === 'Município' && flex.col.uf === 'Estado' && flex.col.situacao === 'Status' && flex.ignoradas.join() === 'Coluna Qualquer', flex);
chk('planilha sem a coluna CNPJ_CPF é recusada com mensagem clara', /CNPJ_CPF/.test(I.registros(['Nome', 'Email'], [{ Nome: 'x' }]).erro || ''));
const reg = I.registros(lido.cabecalho, lido.linhas);
const cats = DFC.categorias();
let n = 0; const plano = I.planejar(reg.registros, { parceiros: todos, categorias: cats, novoId: () => 'par-imp' + (++n) });
const it = plano.itens, res = plano.resumo;
chk('prévia: 4 novos (D, E, a linha com chave duplicada e a sem Tipo), 1 existente com chaves mescladas, 2 inválidos (CNPJ e Tipo), 1 linha com chave duplicada', res.novos === 4 && res.atualizar === 1 && res.invalidos === 2 && res.linhasComConflito === 1, res);
chk('prévia: o CNPJ inválido e o Tipo desconhecido ficam de fora com o motivo', it[3].acao === 'invalido' && /CNPJ inválido/.test(it[3].erros[0]) && it[6].acao === 'invalido' && /Tipo inválido/.test(it[6].erros[0]), [it[3], it[6]]);
const d1 = plano.gravar.find(g => g.dados.documento === maskCnpj(CNPJ_D));
chk('novo cadastro: dados completos, UF em maiúsculas, CEP formatado, endereço, categoria pelo NOME e chaves PIX normalizadas', d1 && d1.novo && d1.dados.uf === 'PE' && d1.dados.cep === '50000-000' && d1.dados.endereco === 'Rua das Flores, 100' && d1.dados.categoriaDfc === 'pag_marketing' && d1.dados.situacaoCadastral === 'ATIVA' && d1.dados.ativo === true
  && d1.dados.chavesPix.map(c => c.tipo + ':' + c.chave).sort().join() === 'email:compras@teste.com.br,telefone:81988880002' && d1.dados.papeis.join() === 'fornecedor', d1);
const d2 = plano.gravar.find(g => g.dados.documento === maskCpf(CPF_E));
chk('novo cadastro PF: Tipo "Cliente", o CPF do cadastro não vira chave duplicada (já vale como chave) e a chave PIX CPF igual ao documento é ignorada', d2 && d2.dados.tipo === 'PF' && d2.dados.papeis.join() === 'cliente' && d2.dados.chavesPix.length === 0, d2);
const d3 = plano.gravar.find(g => g.id === 'par-a');
chk('existente (pelo CNPJ): as chaves PIX são MESCLADAS e nada é apagado (nome, fantasia e chaves antigas ficam)', d3 && !d3.novo && d3.dados.nome === A.nome && d3.dados.nomeFantasia === A.nomeFantasia && d3.dados.chavesPix.length === 5 && d3.dados.chavesPix.some(c => c.tipo === 'evp' && c.chave === EVP.replace('4000', '4999'))
  && d3.dados.chavesPix.some(c => c.chave === 'financeiro@exemplo.com.br') && d3.dados.chavesPix.some(c => c.chave === FONE) && d3.dados.chavesPix.some(c => c.chave === 'novo.financeiro@exemplo.com.br') && d3.dados.chavesPix.some(c => c.chave === '81977770003'), d3);
chk('existente: "Ambos" une os papéis (Fornecedor + Cliente) e a categoria vazia recebe a da planilha', d3.dados.papeis.join() === 'fornecedor,cliente' && d3.dados.categoriaDfc === 'pag_fornecedores', d3.dados);
chk('a chave "financeiro@exemplo.com.br" já é do fornecedor A: a linha do outro CNPJ é gravada SEM essa chave e o aviso diz com quem ela está', it[4].conflitos.length === 1 && it[4].conflitos[0].com === A.nome && /duplicada/.test(it[4].avisos.join(' ')) && plano.gravar.find(g => g.dados.documento === maskCnpj(CNPJ_N)).dados.chavesPix.length === 0, it[4]);
chk('categoria que não existe: aviso e campo ignorado (o cadastro entra mesmo assim); Tipo vazio em cadastro novo vira Fornecedor', /não encontrada/.test(it[5].avisos.join(' ')) && plano.gravar.find(g => g.dados.documento === maskCpf(CPF_F)).dados.papeis.join() === 'fornecedor' && plano.gravar.find(g => g.dados.documento === maskCpf(CPF_F)).dados.categoriaDfc === '', it[5]);
chk('a prévia não grava nada: os cadastros de origem seguem intactos', A.chavesPix.length === 2 && A.categoriaDfc === '' && A.papeis.join() === 'fornecedor' && todos.length === 3);
/* idempotência: reimportar o resultado não muda nada */
const aposPrimeira = [...todos.map(p => JSON.parse(JSON.stringify(p)))];
plano.gravar.forEach(g => { const i = aposPrimeira.findIndex(p => p.id === g.id); const doc = { id: g.id, ...g.dados }; if (i >= 0) aposPrimeira[i] = doc; else aposPrimeira.push(doc); });
const plano2 = I.planejar(reg.registros.filter(r => !r.erros.length), { parceiros: aposPrimeira, categorias: cats });
chk('idempotência: importar a mesma planilha de novo não cria nem altera nada (só avisos de chave duplicada)', plano2.resumo.novos === 0 && plano2.resumo.atualizar === 0 && plano2.gravar.length === 0 && plano2.resumo.semAlteracao >= 4, plano2.resumo);
/* sobrescrever */
const rSobre = I.registros(['CNPJ_CPF', 'Razao_Social', 'Categoria_DFC_Padrao', 'Situacao'], [{ CNPJ_CPF: maskCnpj(CNPJ_A), Razao_Social: 'Calçados Exemplo Novo Nome Ltda', Categoria_DFC_Padrao: 'Marketing e publicidade', Situacao: 'Inativo' }]);
const pSem = I.planejar(rSobre.registros, { parceiros: aposPrimeira, categorias: cats }), pCom = I.planejar(rSobre.registros, { parceiros: aposPrimeira, categorias: cats, sobrescrever: true });
chk('sem "atualizar preenchidos": nome, categoria e situação já preenchidos são mantidos (aviso da categoria)', pSem.gravar.length === 0 && pSem.itens[0].acao === 'sem_alteracao' && /mantida/.test(pSem.itens[0].avisos.join(' ')), pSem);
chk('com "atualizar preenchidos": nome, categoria e inativação da planilha valem', pCom.gravar.length === 1 && pCom.gravar[0].dados.nome === 'Calçados Exemplo Novo Nome Ltda' && pCom.gravar[0].dados.categoriaDfc === 'pag_marketing' && pCom.gravar[0].dados.ativo === false, pCom.gravar[0]);
/* CNPJ numérico do Excel (zeros à esquerda perdidos) e linhas repetidas */
const cnpjZero = dvCnpj('012345670001'), semZero = Number(cnpjZero);
const rNum = I.registros(['CNPJ_CPF', 'Razao_Social', 'Chaves_PIX'], [{ CNPJ_CPF: semZero, Razao_Social: 'Zero À Esquerda Ltda', Chaves_PIX: '' }, { CNPJ_CPF: maskCnpj(cnpjZero), Razao_Social: 'Zero À Esquerda Ltda', Chaves_PIX: `zero@teste.com.br; ${maskCnpj(CNPJ_C)}` }, { CNPJ_CPF: '', Razao_Social: '', Chaves_PIX: '' }]);
const pNum = I.planejar(rNum.registros, { parceiros: todos, categorias: cats, novoId: () => 'par-zz' });
chk('CNPJ numérico sem o zero à esquerda é refeito; linha repetida é mesclada no mesmo cadastro; linha vazia é ignorada', rNum.registros.length === 2 && pNum.resumo.novos === 1 && pNum.resumo.repetidas === 1 && pNum.gravar[0].dados.documento === maskCnpj(cnpjZero), pNum.resumo);
chk('chave PIX que é o CNPJ de outro cadastro (aqui o da C, que já vale como chave) é duplicada e fica de fora; a outra chave da lista entra', pNum.gravar[0].dados.chavesPix.map(c => c.chave).join() === 'zero@teste.com.br' && pNum.resumo.chavesEmConflito === 1, pNum);
/* CNPJ novo cujo documento já é chave PIX de outro cadastro: recusado */
const rClash = I.registros(['CNPJ_CPF', 'Razao_Social'], [{ CNPJ_CPF: '', Razao_Social: 'x' }]);
const clash = I.planejar(I.registros(['CNPJ_CPF', 'Razao_Social'], [{ CNPJ_CPF: maskCnpj(CNPJ_N), Razao_Social: 'Dono do CNPJ Chave Ltda' }]).registros, { parceiros: [{ ...C, chavesPix: [{ tipo: 'cnpj', chave: CNPJ_N }] }], categorias: cats });
chk('cadastro NOVO cujo CNPJ já é chave PIX de outro cadastro é recusado com aviso claro', clash.resumo.invalidos === 1 && /já é chave PIX/.test(clash.itens[0].erros[0]) && clash.gravar.length === 0, clash);

/* ---------- 4 · cruzamento do histórico do extrato ---------- */
const idx = X.indice([...aposPrimeira]);
const v = hist => X.vincular({ hist }, idx);
const quem = (r) => r && r.id;
chk('1) chave PIX CNPJ com máscara, em lançamento PIX → vínculo "pix" (chave cnpj)', (r => quem(r) === 'par-a' && r.via === 'pix' && r.chave === 'cnpj')(v(`PIX ENVIADO ${maskCnpj(CNPJ_A)} CALCADOS EXEMPLO`)));
chk('1) o mesmo CNPJ sem máscara também casa', quem(v(`PIX ENVIADO ${CNPJ_A}`)) === 'par-a');
chk('1) chave PIX CPF (com e sem máscara) casa com o cadastro PF', quem(v(`PIX RECEBIDO ${maskCpf(CPF_B)}`)) === 'par-b' && quem(v(`PIX RECEBIDO ${CPF_B}`)) === 'par-b');
chk('1) e-mail cadastrado casa sem diferenciar maiúsculas', (r => quem(r) === 'par-a' && r.via === 'pix' && r.chave === 'email')(v('PIX ENVIADO FINANCEIRO@EXEMPLO.COM.BR REF 123')));
const histFone = ['PIX ENVIADO +5581999990001', 'PIX ENVIADO 5581999990001', 'PIX ENVIADO 081999990001', 'PIX ENVIADO (81) 99999-0001', 'PIX ENVIADO 81999990001 JOAO', 'PIX ENVIADO +55 81 99999-0001 FULANO'];
chk('1) telefone casa com e sem +55 / 55 / 0, com e sem máscara', histFone.every(h => { const r = v(h); return quem(r) === 'par-a' && r.via === 'pix' && r.chave === 'telefone'; }), histFone.map(h => [h, v(h)]).filter(([, r]) => quem(r) !== 'par-a'));
chk('1) chave aleatória (EVP) casa em qualquer caixa', quem(v(`PIX ENVIADO ${EVP.toUpperCase()}`)) === 'par-b');
chk('2) o CNPJ do cadastro em TED/DOC/boleto vira vínculo por "documento" (em PIX continua "pix")', (r => quem(r) === 'par-a' && r.via === 'documento')(v(`TED ENVIADA ${CNPJ_A} PAGAMENTO`)) && v(`PAG BOLETO CNPJ ${maskCnpj(CNPJ_A)}`)?.via === 'documento' && v(`PIX ENVIADO ${CNPJ_A}`)?.via === 'pix');
chk('3) razão social exata (sem acento, caixa e pontuação) → vínculo por "nome"', (r => quem(r) === 'par-a' && r.via === 'nome')(v('PAGTO FORNECEDOR CALCADOS EXEMPLO INDUSTRIA LTDA REF NF 123')));
chk('3) nome fantasia exato (≥ 6 caracteres) também vincula', quem(v('PIX ENVIADO DISTRIBUIDORA MODELO COMERCIO S A')) === 'par-c' && quem(v('PIX ENVIADO CALCADOS EXEMPLO')) === 'par-a');
chk('3) nome com menos de 6 caracteres não vincula (fantasia "Modelo" tem 6 e vale; "Exemplo" sozinho NÃO é nome de ninguém)', quem(v('COMPRA LOJA MODELO')) === 'par-c' && v('PIX ENVIADO EXEMPLO') === null);
chk('3) a correspondência é por palavras inteiras (nada de pedaços de outras palavras)', v('PIX ENVIADO CALCADOS EXEMPLOS GERAIS') === null);
const dois = [...aposPrimeira, { id: 'par-x', tipo: 'PJ', papeis: ['fornecedor'], documento: maskCnpj(dvCnpj('555566670001')), nome: 'Outra Empresa Ltda', nomeFantasia: 'Calçados Exemplo', chavesPix: [] }];
chk('3) nome que pertence a dois cadastros é ambíguo: não vincula ninguém', X.vincular({ hist: 'PIX ENVIADO CALCADOS EXEMPLO' }, X.indice(dois))?.ambigua === true);
chk('prioridade: a chave PIX vale mais que o nome (texto com o e-mail do A e o nome do C → A)', quem(v('PIX ENVIADO DISTRIBUIDORA MODELO COMERCIO S A financeiro@exemplo.com.br')) === 'par-a');
chk('números parecidos dentro de códigos longos não geram vínculo (boleto, NSU)', v(`PAG TITULO 0001${CNPJ_A}99 LIQUIDACAO`) === null && v('PIX 12345678901234567890123456789012345') === null);
chk('sem correspondência: null', v('TARIFA BANCARIA MANUTENCAO') === null && v('') === null && X.vincular({ hist: 'x' }, null) === null);
chk('chaves extras: a chave que só aparece no texto completo (histórico cortado em 120 caracteres) é guardada em chv e o reprocessamento a usa', (() => {
  const completo = 'x'.repeat(130) + ` PIX ${maskCnpj(CNPJ_A)}`, hist = completo.slice(0, 120), ex = X.chavesExtras(completo, hist);
  const t = { id: 'a', data: '2026-10-05', valor: -100, hist }, a1 = X.aplicar(t, idx, completo), a2 = X.aplicar({ ...a1.t }, idx);
  return ex.join() === CNPJ_A && a1.t.par === 'par-a' && a1.t.chv === CNPJ_A && a2.t.par === 'par-a' && X.aplicar(t, idx).t.par === undefined;
})());
chk('aplicar(): vínculo manual da classificação (cat) nunca é tocado e, sem correspondência, os campos do vínculo são removidos', (() => {
  const t = { id: 'a', data: '2026-10-05', valor: -10, hist: 'TARIFA', cat: 'pag_tarifas', par: 'par-a', via: 'nome', vch: 'x' }, r = X.aplicar(t, idx).t;
  return r.cat === 'pag_tarifas' && !('par' in r) && !('via' in r) && !('vch' in r);
})());

/* ---------- OFX de ponta a ponta (leitor real + cruzamento + DFC) ---------- */
const ofx = `OFXHEADER:100\nDATA:OFXSGML\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL<BANKACCTFROM><BANKID>341<BRANCHID>0001<ACCTID>12345-6<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261001<DTEND>20261031
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261005<TRNAMT>-1500.00<FITID>T1<NAME>PIX ENVIADO<MEMO>${'Pagamento '.repeat(12)}PIX ${maskCnpj(CNPJ_A)}</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261006<TRNAMT>-300.00<FITID>T2<NAME>PIX ENVIADO<MEMO>MARIA EXEMPLO DA SILVA</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261007<TRNAMT>-800.00<FITID>T3<NAME>TED<MEMO>ALUGUEL SALA 10 ${maskCnpj(CNPJ_A)}</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261008<TRNAMT>420.00<FITID>T4<NAME>CREDITO EM CONTA<PAYEE><NAME>DISTRIBUIDORA MODELO COMERCIO S A</PAYEE></STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261009<TRNAMT>-95.50<FITID>T5<NAME>TARIFA BANCARIA<MEMO>CESTA</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261010<TRNAMT>-60.00<FITID>T6<NAME>PIX ENVIADO<MEMO>FULANO DE TAL SEM CADASTRO</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261011<TRNAMT>-200.00<FITID>T7<NAME>PIX ENVIADO<MEMO>${EVP}</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>10000.00<DTASOF>20261031</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
const ex = OFX.ler(ofx)[0], textos = X.textosOFX(ofx);
chk('texto completo do OFX: NAME + MEMO + PAYEE (inclusive PAYEE aninhado) por FITID', textos.size === 7 && /DISTRIBUIDORA MODELO/.test(textos.get('T4')) && textos.get('T1').length > 150, [...textos.entries()].map(([k, x]) => k + ':' + x.length));
const base = aposPrimeira.map(p => p.id === 'par-b' ? { ...p, categoriaDfc: '' } : p);
base.forEach(p => parc.set(p.id, p));
const idx2 = X.indice(base);
const cruzadas = ex.transacoes.map(t => ({ ...X.aplicar(t, idx2, textos.get(t.id)).t, contaId: 'cb-1' }));
const por = id => cruzadas.find(t => t.id === id);
chk('OFX: a chave que ficou além dos 120 caracteres do histórico (T1) foi achada pelo texto completo e guardada em chv', por('T1').par === 'par-a' && por('T1').via === 'pix' && por('T1').chv === CNPJ_A && por('T1').hist.length <= 120, por('T1'));
chk('OFX: T2 por nome (PF), T3 por documento (TED), T4 por nome no PAYEE, T7 por chave aleatória; T5/T6 sem fornecedor', por('T2').par === 'par-b' && por('T2').via === 'nome' && por('T3').par === 'par-a' && por('T3').via === 'documento' && por('T4').par === 'par-c' && por('T4').via === 'nome' && por('T7').par === 'par-b' && por('T7').via === 'pix' && !por('T5').par && !por('T6').par, cruzadas.map(t => [t.id, t.par, t.via]));
cfg.doc = { regras: DFC_REGRAS_PADRAO.slice(), mapaFCX: {}, categorias: [{ id: 'cus_nao_op', nome: 'Saídas não operacionais', sentido: 'S', grupo: 'NAO_OPERACIONAL', impacto: 'soma' }] };
cfg.doc.regras = DFC_REGRAS_PADRAO.slice();

/* ---------- 5 · classificação na DFC: manual > regra > padrão do fornecedor > padrão automático ---------- */
const cl = (t) => DFC.classificar(t);
const r2 = x => Math.round(x * 100) / 100;
parc.set('par-a', { ...A, chavesPix: A.chavesPix, categoriaDfc: 'cus_nao_op' }); // A usa a categoria personalizada
chk('4º padrão automático: fornecedor vinculado SEM categoria e SEM regra → "Pagamento a fornecedores" nas saídas (T2, e T7 com B sem categoria)', cl(por('T2')).categoria === 'pag_fornecedores' && cl(por('T2')).origem === 'fornecedor_padrao' && cl(por('T7')).categoria === 'pag_fornecedores' && cl(por('T2')).parceiro === 'par-b', cl(por('T2')));
chk('4º padrão automático: entrada de fornecedor/cliente vinculado SEM categoria e SEM regra → "Outras entradas operacionais" (T4)', cl(por('T4')).categoria === 'rec_outros' && cl(por('T4')).origem === 'fornecedor_padrao', cl(por('T4')));
chk('2º a regra "PIX recebido" (já cadastrada nas Regras de classificação) também vence o padrão do fornecedor nas entradas', (r => r.categoria === 'rec_pix' && r.origem === 'regra')(cl({ ...por('T4'), hist: 'PIX RECEBIDO ' + por('T4').hist })));
chk('3º categoria padrão do fornecedor (aqui a personalizada "Saídas não operacionais") vale quando nenhuma regra casa (T1)', cl(por('T1')).categoria === 'cus_nao_op' && cl(por('T1')).origem === 'fornecedor', cl(por('T1')));
chk('2º a REGRA de classificação vence a categoria padrão do fornecedor (T3 tem "ALUGUEL" → Aluguel, condomínio e ocupação, mesmo vinculado ao A)', cl(por('T3')).categoria === 'pag_ocupacao' && cl(por('T3')).origem === 'regra', cl(por('T3')));
chk('1º a classificação MANUAL vence tudo (T1 reclassificado à mão para Marketing)', cl({ ...por('T1'), cat: 'pag_marketing' }).categoria === 'pag_marketing' && cl({ ...por('T1'), cat: 'pag_marketing' }).origem === 'manual');
chk('sem vínculo, nada muda: sem regra cai em "Outras saídas operacionais" (padrão de antes) e T5 casa a regra de tarifas', cl(por('T6')).categoria === 'pag_outros' && cl(por('T6')).origem === 'padrão' && cl(por('T5')).categoria === 'pag_tarifas' && cl(por('T5')).origem === 'regra');
chk('cadastro apagado ou categoria desconhecida: cai no padrão do fornecedor sem quebrar', (() => { parc.set('par-q', { id: 'par-q', categoriaDfc: 'nao_existe' }); const a = cl({ id: 'q', data: '2026-10-01', valor: -5, hist: 'X', par: 'par-q' }), b = cl({ id: 'q', data: '2026-10-01', valor: -5, hist: 'X', par: 'par-fantasma' }); return a.categoria === 'pag_fornecedores' && b.categoria === 'pag_outros' && b.origem === 'padrão'; })());
chk('a injeção de cadastro por contexto (ctx.parceiro) também funciona', DFC.classificar({ id: 'q', valor: 10, hist: 'X', par: 'k' }, [], { parceiro: () => ({ id: 'k', categoriaDfc: 'rec_pix' }) }).categoria === 'rec_pix');
/* apuração isolada */
const trs = cruzadas.map(t => ({ ...t }));
const c = DFC.consolidar(trs), dm = DFC.demonstrativo(c);
const bNao = dm.blocos.find(b => b.grupo === 'NAO_OPERACIONAL'), bOp = dm.blocos.find(b => b.grupo === 'OPERACIONAL');
chk('apuração: "Saídas não operacionais" (T1 = −1.500,00) aparece SÓ no bloco Não Operacional, com subtotal isolado', bNao.visivel && bNao.linhas.length === 1 && bNao.linhas[0].nome === 'Saídas não operacionais' && bNao.linhas[0].valor === -1500 && bNao.subtotal === -1500 && !bOp.linhas.some(l => l.id === 'cus_nao_op'), bNao);
chk('apuração: o subtotal operacional não inclui o não operacional; a Variação Líquida soma tudo', r2(bOp.subtotal) === r2(-300 - 800 + 420 - 95.5 - 60 - 200) && r2(dm.variacao) === r2(bOp.subtotal + bNao.subtotal) && r2(dm.variacao) === r2(trs.reduce((a, t) => a + t.valor, 0)), [bOp.subtotal, dm.variacao]);
chk('apuração: lançamentos vinculados a fornecedor não contam como "sem regra" (só o T6, sem cadastro, e o T5 por regra não)', c.semRegra === 1, c.semRegra);
const ref = (cat) => (c.porCategoria[cat] || { valor: 0 }).valor;
chk('apuração: T2 e T7 (padrão automático) somam em Pagamento a fornecedores; T4 em Outras entradas operacionais', ref('pag_fornecedores') === -500 && ref('rec_outros') === 420 && ref('pag_ocupacao') === -800, c.porCategoria);

/* ---------- 6 · recurso desligado e categoria em uso ---------- */
const off = montar(cfg, parc, false);
chk('recurso desligado: o vínculo é ignorado e a DFC volta ao comportamento anterior (T1 e T2 caem em "outras saídas")', off.DFC.classificar(por('T1')).categoria === 'pag_outros' && off.DFC.classificar(por('T2')).origem === 'padrão');
const v1 = DFC.vinculos('cus_nao_op', { regras: [], mapaFCX: {}, transacoes: [], parceiros: [...parc.values()] });
chk('uso: categoria padrão de um fornecedor conta como vínculo e BLOQUEIA a exclusão, com aviso amigável', v1.parceiros === 1 && v1.total === 1 && DFC.podeExcluir('cus_nao_op', { regras: [], mapaFCX: {}, transacoes: [], parceiros: [...parc.values()] }).ok === false && /1 fornecedor\/cliente com esta categoria padrão/.test(DFC.podeExcluir('cus_nao_op', { regras: [], mapaFCX: {}, transacoes: [], parceiros: [...parc.values()] }).motivo));
chk('uso: sem fornecedor usando, a categoria personalizada pode ser excluída (formato antigo de vinculos() sem "parceiros" continua igual)', DFC.podeExcluir('cus_nao_op', { regras: [], mapaFCX: {}, transacoes: [], parceiros: [] }).ok === true && JSON.stringify(DFC.vinculos('cus_nao_op', { regras: [], mapaFCX: {}, transacoes: [] })) === JSON.stringify({ regras: 0, mapa: 0, lancamentos: 0, total: 0 }));

/* ---------- 7 · quem não lê o cadastro (sem parceiros.ver) usa a categoria gravada no lançamento ---------- */
const semAcesso = montar(cfg, new Map(), true, new Set(['config', 'extratos'])), comAcesso = montar(cfg, parc, true, new Set(['config', 'extratos', 'parceiros']));
const tPcat = { id: 'z', data: '2026-10-01', valor: -50, hist: 'PIX ENVIADO SEM REGRA', par: 'par-a', pcat: 'cus_nao_op' };
chk('sem acesso ao cadastro: o lançamento vinculado usa a categoria padrão gravada (pcat), igual à de quem lê o cadastro', semAcesso.DFC.classificar(tPcat).categoria === 'cus_nao_op' && semAcesso.DFC.classificar(tPcat).origem === 'fornecedor' && comAcesso.DFC.classificar(tPcat).categoria === 'cus_nao_op', [semAcesso.DFC.classificar(tPcat), comAcesso.DFC.classificar(tPcat)]);
chk('sem acesso ao cadastro e sem pcat: padrão automático do fornecedor (saída → Pagamento a fornecedores; entrada → Outras entradas operacionais)', semAcesso.DFC.classificar({ ...tPcat, pcat: '' }).categoria === 'pag_fornecedores' && semAcesso.DFC.classificar({ ...tPcat, pcat: undefined, valor: 50, hist: 'CREDITO EM CONTA' }).categoria === 'rec_outros');
chk('com acesso e cadastro excluído (coleção carregada): volta ao padrão de antes, sem usar o pcat gravado', comAcesso.DFC.classificar({ ...tPcat, par: 'par-fantasma' }).origem === 'padrão');
chk('quem lê o cadastro usa o valor ATUAL (categoria trocada no cadastro vale mesmo com pcat antigo gravado)', (() => { const q = new Map([['par-a', { ...A, categoriaDfc: 'pag_marketing' }]]); return montar(cfg, q, true, new Set(['config', 'extratos', 'parceiros'])).DFC.classificar(tPcat).categoria === 'pag_marketing'; })());

console.log(`\n${OK.length} ok, ${FAIL.length} falha(s)`);
if (FAIL.length) { console.log('FALHAS:\n - ' + FAIL.join('\n - ')); process.exit(1); }
