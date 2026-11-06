# Painel de Gestão Esposende · Netlify + Netlify Database (Postgres)

Versão v13.76. O painel roda no Netlify com um banco **Postgres gerenciado (Netlify Database)** e as rotas da API em
**Netlify Functions**. Os dados ficam no servidor: valem em qualquer computador e são sincronizados entre quem está usando.

## Como funciona

```
Navegador (public/index.html)
   │  fetch /api/...  (cookie de sessão HttpOnly)
   ▼
Netlify Functions (netlify/functions)            Netlify Database (Postgres)
   /api/saude      → banco no ar?                  documentos        (JSONB, 1 linha por registro)
   /api/sessao     → login por CPF no servidor     mudancas          (sincronização entre computadores)
   /api/docs       → ler / gravar / excluir        sessoes           (login, 12 h)
   /api/docs/lote  → gravações em lote             tentativas_login  (bloqueio após 5 erros)
   /api/mudancas   → o que mudou desde…            arquivos + arquivo_partes (PDF/imagens)
   /api/arquivos, /_blob/<id> → arquivos           views vw_* para consultas em SQL/BI
   /api/ambientes/<id>/docs → outro ambiente (Master) → /api/inter/* no site de destino (chave entre ambientes)
```

- **Detecção automática:** ao abrir, o painel chama `/api/saude`. No Netlify ele usa o Postgres; no claude.ai continua com o banco do claude.ai. O motor do FCX e a Auditoria de Adquirentes não mudaram: gravam pelo mesmo caminho de sempre.
- **Login no servidor:** o CPF e a senha são conferidos na função `/api/sessao`, com o mesmo hash do painel (sal + SHA-256 em 3.000 rodadas). Antes do login o navegador não recebe nenhum usuário nem senha. A sessão fica num cookie `HttpOnly; Secure; SameSite=Strict`.
- **Regras de acesso no servidor:** as mesmas 39 regras do banco do claude.ai (`netlify/lib/regras.mjs`). O **Master** tem o papel de editor (salários, contratos, DFC, adquirentes, auditoria, Homologação/RC). O **Operacional** tem acesso de uso.
  - Usuários não-Master nunca recebem os hashes de senha.
  - Só alteram o próprio login (senha e último acesso) e não conseguem mudar perfil, permissões ou situação.
- **Sincronização:** cada gravação entra na tabela `mudancas`. O painel consulta `/api/mudancas` a cada 5 s (30 s com a aba em segundo plano) e relê só as coleções que mudaram.
  - Exemplo: o desligamento de um funcionário encerra a sessão dele em outro computador.
- **Arquivos:** contratos, termos e comprovantes vão em partes de 1 MB para o Postgres e são servidos em `/_blob/<id>`, só para quem está logado.

## Estrutura

```
netlify.toml                         publish = public, funções em netlify/functions
package.json                         dependência @netlify/database (provisiona o banco no deploy)
public/                              index.html (painel), fcx.html (Fluxo de Caixa), logos
netlify/functions/                   saude, sessao, docs, mudancas, arquivos, ambientes, inter (rotas /api/*)
netlify/lib/                         db (getDatabase), ambiente (v13.76), inter, regras de acesso, sessão, senha, usuários, documentos
public/marca-rc/                     logos da RC Consultoria (aplicadas no build quando PAINEL_AMBIENTE=rc)
scripts/preparar-ambiente.mjs        etapa de build: logos do ambiente
netlify/database/migrations/
  20261027120000_esquema_inicial.sql tabelas, índices e views
  20261027120100_semente_inicial.sql Master padrão (senha temporária em hash) + 71 lojas, ECs e configurações
scripts/gerar-semente-sql.mjs        gera a migração de semente a partir de um JSON
tests/servidor-local.mjs             servidor de teste que imita o Netlify (opcional)
tests/tres-ambientes.sh              sobe 3 sites locais interligados (Produção, Homologação, RC)
```

## Três ambientes, três sites (v13.76)

Cada ambiente é um **site (projeto) próprio no Netlify**, com o **seu próprio Netlify Database**. O código é o mesmo nos três; o que muda são as variáveis de ambiente de cada site (*Site configuration › Environment variables*):

| Variável | Esposende (Produção) | Esposende (Homologação) | RC Consultoria (White-Label) |
|---|---|---|---|
| `PAINEL_AMBIENTE` | `prod` | `homolog` | `rc` |
| `PAINEL_URL_PROD` | endereço da Produção | endereço da Produção | endereço da Produção |
| `PAINEL_URL_HOMOLOG` | endereço da Homologação | endereço da Homologação | endereço da Homologação |
| `PAINEL_URL_RC` | endereço da RC | endereço da RC | endereço da RC |
| `PAINEL_CHAVE_AMBIENTES` | **o mesmo segredo nos três** (mínimo 16 caracteres; recomendado 32+ aleatórios) | idem | idem |
| `PAINEL_MOSTRAR_AMBIENTES` | — | — | `0` para os clientes da RC não verem a Esposende no seletor (opcional) |
| `PAINEL_SO_MASTER` | — (padrão: todos) | — (padrão: só o Master) | — (padrão: todos) |

Os endereços são completos, com `https://` e sem barra no final, como `https://painel-esposende.netlify.app`.

Para gerar a chave, rode `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` uma vez e cole o mesmo valor nos três sites.

Depois de alterar variáveis, faça um novo deploy (*Deploys › Trigger deploy*).

**v13.83 · Perfil Loja (ponta).** O servidor trata o perfil `LOJA` como Operacional na leitura, mas só aceita gravar:

- a viagem nova "Aguardando Aprovação" feita pelo próprio usuário, quando ele tem "Pode solicitar viagem";
- o pedido dessa viagem na Liberação Remota;
- CPF, RG e nascimento do RH pedidos na viagem;
- as Solicitações Operacionais;
- o próprio login, a auditoria e a presença.

O perfil Loja não exclui nada (regras em `netlify/lib/regras.mjs`, função `lojaPodeGravar`).

Para testar um usuário Loja no site da Homologação, defina `PAINEL_SO_MASTER=0` nele, porque por padrão só o Master entra na Homologação.

**O que cada parte faz:**

- **Seletor de ambiente.** A tela de login e o menu interno (botão do ambiente, no topo: *Trocar ambiente*) mostram Esposende (Produção), Esposende (Homologação) e RC Consultoria (White-Label). Ao escolher outro ambiente, o navegador vai para o endereço daquele site. Cada site tem o seu login, e as sessões convivem no mesmo navegador.
- **RC Consultoria (white-label).** No site com `PAINEL_AMBIENTE=rc`:
  - o título é "RC Consultoria · Painel de Gestão";
  - o tema é AMOLED (preto) fixo;
  - a marca RC fica no lugar da logomarca da Esposende;
  - "Esposende" vira "RC Consultoria" nas telas e relatórios.
  - Na etapa de build, `scripts/preparar-ambiente.mjs` troca as logos estáticas (inclusive a do FCX) pelas de `public/marca-rc/`.
  - Na mesma etapa, o `fcx.html` da RC perde o bloco `const SEED`. Esse bloco traz os dados de exemplo da Esposende: vendas, plano de contas, centros de custo, fornecedores e saídas. No lugar fica a mesma estrutura vazia, e o FCX da RC começa zerado.
  - Essa remoção é uma exceção à Regra de Ouro, autorizada em 28/10/2026 e exclusiva do site da RC. Produção e Homologação usam o `fcx.html` original, sem nenhuma alteração.
  - Se o bloco não puder ser removido com segurança, o build falha e nada é publicado.
  - Também no build da RC, o FCX fica com marca neutra:
    - título "Fluxo de Caixa — RC Consultoria";
    - "Cartão Próprio / Private Label" no lugar de "Esposende Card";
    - arquivo de backup `backup-fluxo-caixa-rc-consultoria-<data>.json`;
    - catálogo oficial sem nomes de lojas: "002 - LOJA MATRIZ", "005 - LOJA 005", "ESCRITÓRIO CENTRAL", "CENTRO DE DISTRIBUIÇÃO";
    - empresas do grupo como "EMPRESA DO GRUPO A…H";
    - contas de reestruturação com nomes neutros.
  - O build confere que não sobrou nenhum nome interno; se sobrar, falha. Só textos mudam: a chave interna `esposende_card` continua, para não quebrar dados gravados.
- **Master.** Na Homologação e na RC, o Master que ainda não existe no banco local é **herdado do site da Produção** no primeiro login, com o mesmo CPF e senha.
- **Backup › Gestão de Ambientes.** Clonar Produção → Homologação, Liberar Versão em Produção, Resetar Banco da RC, versões dos ambientes e sincronização do Master continuam funcionando. O site em uso repassa a ação ao outro site (`/api/ambientes/<id>/docs` → `/api/inter/docs`), autenticado pela chave. Quem recebe aplica esta política:
  - **Produção → Homologação/RC:** acesso completo (clonar, resetar, Master).
  - **Homologação → Produção:** lê tudo e grava só os parâmetros da Liberação: `config`, `rh_cargos`, `rh_centros`, `rh_departamentos`, parâmetros de viagens, `adq_taxas`, metas e campanhas Credsystem e `pe_simulador`. Nunca apaga.
  - **RC → Esposende:** só lê a versão (`config/recursos`). A RC não enxerga dados da Esposende.
- **Banco inicial por site:**
  - **Produção e Homologação:** usam as duas migrações (esquema + semente).
  - **RC:** **apague `netlify/database/migrations/20261027120100_semente_inicial.sql` do repositório da RC antes do primeiro deploy.** Ela tem as lojas da Esposende. A RC começa vazia, e o Master vem herdado da Produção.

### Se a Produção mostrar "não interligado" ou "sem acesso a este banco"

Entre como Master em **Backup › Gestão de Ambientes** e clique em **Testar conexão entre ambientes** (v13.76.1). O teste mostra, para cada ambiente:

- o endereço chamado;
- o código HTTP;
- a causa exata, que pode ser uma destas:
  - endereço vazio ou inválido;
  - falha de rede ou tempo esgotado;
  - redirecionamento (endereço diferente do real);
  - rota `/api/inter` inexistente (site de destino numa versão antiga);
  - chave diferente;
  - chave curta demais (menos de 16 caracteres);
  - chave não configurada no destino.

A **impressão da chave**, um código curto que não revela o valor, precisa ser igual nos três sites. Rode o teste em cada um para comparar.

O mesmo detalhe vai para o console do navegador (`[painel][ambientes]`) e para **Netlify › Logs › Functions** (`[painel][inter]`), dos dois lados da chamada.

A chave é conferida sem espaços nas pontas e sem aspas coladas por engano. Depois de mudar uma variável, faça **um novo deploy** em cada site: o Netlify só aplica a variável nova às funções publicadas depois.

As rotas `/api/saude`, `/api/inter/*` e `/api/ambientes/*` respondem com CORS (`*`) e aceitam o pre-flight `OPTIONS`. A comunicação entre os sites é de servidor para servidor e não depende de CORS. O cookie de login (HttpOnly, SameSite=Strict) nunca é enviado a outro domínio.

## Publicar

> Requisitos do Netlify Database: plano com créditos (Credit-based), Node 20.12.2+ e, para uso local, Netlify CLI 26+.

1. Crie um repositório **privado** no GitHub com esta pasta. A migração de semente tem o CPF do Master e o cadastro das lojas.
2. No Netlify, escolha **Add new project → Import an existing project** e selecione o repositório. As configurações já vêm do `netlify.toml`.
3. No deploy, o Netlify vê o `@netlify/database` no `package.json` e **cria o banco sozinho**. Antes de publicar, ele aplica as migrações de `netlify/database/migrations/`; se alguma falhar, a publicação é bloqueada. A variável `NETLIFY_DB_URL` é criada automaticamente.
4. Abra o site e entre com o **CPF do Master** e a **senha temporária** (informada à parte). O painel obriga a trocar a senha no primeiro acesso.

Pelo terminal, a alternativa é `npm i -g netlify-cli`, depois `netlify login`, `netlify init` e `netlify deploy --prod`.

O "arrastar a pasta" do Netlify Drop **não** serve aqui: ele não instala dependências nem cria o banco.

## Trazer os dados do painel do claude.ai

1. No painel do **claude.ai**, entre como Master e abra **Backup**. Baixe o backup completo (.json).
2. No painel do **Netlify**, entre como Master e abra **Backup › Restaurar backup**. Escolha o arquivo, marque as coleções e grave:
   - "Substituir" deixa tudo igual ao claude.ai.
   - "Só o que falta" mantém o que já existe.
3. Usuários e funcionários vêm com as senhas atuais (só em hash), e cada pessoa entra com a senha que já usava.
4. **Arquivos anexados** no claude.ai (PDFs de contratos, por exemplo) não vêm no backup. Eles precisam ser enviados de novo no Netlify.

## Desenvolvimento local

```bash
npm install
netlify dev                                   # sobe o site, as funções e um banco local
netlify database migrations apply             # aplica as migrações no banco local
```

`netlify database connect` abre o `psql` do banco. Exemplos de consulta:

```sql
SELECT * FROM vw_lojas ORDER BY codigo;
SELECT * FROM vw_lojas_ecs WHERE adquirente = 'GETNET';
SELECT data, loja_id, websystem, dinheiro, cartao, cartao_lote, pix FROM vw_credsystem_recebimentos WHERE data >= '2026-09-01';
SELECT * FROM vw_conc_fechamento WHERE modalidade = 'credito';
```

## Mudanças no banco

Nunca edite uma migração já aplicada. Crie uma nova em `netlify/database/migrations/`, com prefixo de data e hora (`AAAAMMDDHHMMSS_descricao.sql`).

## Segurança e LGPD

- O repositório precisa ser **privado**: a migração de semente tem o CPF e o nome do Master e o cadastro das lojas.
- **Previews de deploy** recebem uma cópia dos dados da Produção, e o link de preview é público. Não compartilhe previews.
- Depois de 5 senhas erradas, o CPF fica bloqueado por 5 minutos. Há também um limite de 30 tentativas por IP em 10 minutos.
- Toda gravação exige o cabeçalho `x-painel: 1`, que protege contra CSRF, e o cookie é `SameSite=Strict`.
- A matriz de permissões por módulo (Ler/Modificar/Excluir) continua sendo aplicada pela tela, como no claude.ai. O servidor garante as regras por coleção.

## Limites

- Os arquivos anexados (PDF/imagens) ficam no banco de cada site. A Clonagem copia os registros, mas não os arquivos.

- Até 5,5 MB por registro e 15 MB por arquivo.
- Listagens vêm em páginas de até 3,5 MB.
- A leitura por IA de documentos não existe fora do claude.ai.

## Módulo Contábil (v13.86 · Parte 1: backend)

A API fica em `netlify/functions/contabil.mjs`, com o caminho `/api/contabil`. O motor está em `netlify/lib/contabil-motor.mjs` e o esquema em `netlify/database/migrations/20261106120000_esquema_contabil.sql`, que o Netlify DB aplica sozinho no deploy.

**Plano de contas único.** As contas ficam numa árvore sintética/analítica, com códigos como `1.1.1.02.001`. Os grupos são 1 Ativo, 2 Passivo, 3 PL, 4 Receitas e 5 Custos/Despesas.
- A natureza da conta vem do grupo, e as retificadoras têm a natureza oposta.
- A conta-mãe precisa ser sintética, e só contas analíticas recebem lançamentos.
- `POST /api/contabil/plano-padrao` cria o plano padrão do comércio varejista, com 184 contas.

**Classificação automática.** `POST /api/contabil/classificar { nome }` sugere, a partir do nome:
- grupo, natureza, tipo, conta-mãe e próximo código;
- linhas da DRE e da DVA;
- tributos: ICMS/PIS/COFINS/ISS no modelo atual e IBS/CBS/IS na reforma.

As sugestões vêm de regras contábeis com pesos e de contas parecidas que já estão no plano. Quem cria uma conta pode mandar só o nome: o que faltar é preenchido pela classificação.

**Partidas dobradas e intangibilidade.** As travas valem na API e no próprio Postgres:
- o débito precisa ser igual ao crédito (conferido no COMMIT);
- `UPDATE`, `DELETE` e `TRUNCATE` de lançamentos e partidas são bloqueados;
- nenhuma partida pode ser incluída num lançamento já gravado;
- não se lança em período fechado.

A correção é feita por `POST /api/contabil/lancamentos/estorno`, ligada ao ID do lançamento original, com um único estorno por lançamento. Cada lançamento guarda o hash do anterior, e `GET /api/contabil/integridade` confere a cadeia.

**Relatórios.** `GET /api/contabil/relatorios/<tipo>?de=&ate=` gera diario, razao (`&conta=`), balancete, dre (`&modelo=atual|reforma&anoReforma=`), balanco, dmpl, dra, dva e lalur (`&regime=real|presumido`).

**Parâmetros.** `PUT /api/contabil/parametros` guarda:
- o regime (`real` com LALUR, ou `presumido`, com a majoração da LC 224/2025 opcional);
- o toggle da DRE (`dreModelo`) e as alíquotas e o ano da simulação da reforma;
- a conta do encerramento e a data de fechamento.

`POST /api/contabil/encerramento { ano }` apura o resultado e o leva para Lucros ou Prejuízos Acumulados.

**Acesso.** O Master tem tudo. O Operacional segue a linha `contabil` da Gestão de Acessos:
- Ler: consultar;
- Modificar: lançar e mexer no plano;
- Excluir: estornar, encerrar e alterar os parâmetros.

O perfil Loja não tem acesso.

**Teste.** Com o servidor local rodando sobre o `painel_teste`, rode `node tests/teste-contabil.mjs`. Ele usa dados fictícios e cobre 29 verificações.

## Módulo Contábil (v13.86 · Parte 2: tela, menu e plano de contas do FCX)

- **Tela:** `public/contabilidade.html` (Módulo 12 · Contabilidade no menu Financeiro & Caixa, ao lado do FCX). Abas: Plano de contas
  (árvore sintética/analítica, nova conta com classificação automática, edição/inativação), De-para do FCX, Lançamentos (partidas
  dobradas com totalizador D × C e estorno), Relatórios (Diário, Razão, Balancete, DRE com botão Modelo Atual × Nova Reforma, Balanço,
  DMPL, DRA, DVA, LALUR) e Parâmetros (regime, presunção, LC 224, Reforma, fechamento, LALUR, encerramento, integridade).
- **Recurso:** `contabil_v1386` (Homologação sempre; Produção só depois de "Liberar Versão em Produção"). Sem ele, painel e FCX ficam
  exatamente como na v13.85.
- **Acesso:** linha "Contabilidade" na Gestão de Acessos — Ler = consultar · Modificar = lançar e plano/de-para · Excluir = estornar,
  encerrar e parâmetros. Perfil Loja: só leitura.
- **FCX (exceção à Regra de Ouro autorizada só para o plano de contas):** a aba "Contas & Centros de Custo" mostra o plano em
  **modo consulta** (conta do FCX → conta contábil → situação). Não se cadastra, renomeia nem remove conta no FCX. Centros de custo
  continuam no FCX. O motor (buildCashBook, buildAggregated, drawChart) não mudou.
- **Migração** `20261106130000_esquema_contabil_depara.sql`: tabela `contab_depara` (rótulo do FCX → conta do plano; status
  automático/revisado/pendente). Uma trava no banco impede que um rótulo de movimento aponte para uma sintética.
- **Ponto de partida:** em Contabilidade › De-para do FCX › **Importar contas do FCX**. Se o banco não tem plano, cria o padrão (184).
  Depois mapeia as contas do FCX pela faixa do código do ERP + nome (o mais longo vence) e cria só as 6 analíticas que faltam
  (Viagens, Seguros, Manutenção, Fretes, Brindes/Doações, Partes Relacionadas). Acrescenta ao FCX as contas da Reforma:
  2.05.10/11/12 IBS/CBS/IS sobre vendas e 2.06.06/07 IBS/CBS sobre compras. O que não tem regra fica **Pendente** para revisão.
- **Limpeza do cadastro antigo:** na abertura do FCX, a lista local passa a ser a do Contábil mais as contas com saídas ou orçamento
  lançados. O catálogo embutido não volta a ser mesclado. Conta nova que chega por planilha entra na lista e vai para o de-para
  (pendente/automática).
- **Testes:** `tests/teste-contabil.mjs` (38 verificações, inclui o de-para).

## v13.87 · Recebível Diário (FCX): cartão por operação e bandeira

- **Recurso:** `rd_cartao_v1387` (Homologação sempre; Produção depois da liberação). Sem ele, o relatório fica como na v13.86.
- **Prestação no cartão de débito (antes "Débito (LOTE)"):** aparece como "Débito Visa", "Débito Mastercard"… (sem o texto LOTE),
  pelo líquido do MDR do ERP. Se o ERP não traz a taxa, usa o MDR % das vendas no débito da mesma adquirente e bandeira no dia (marcado com *).
- **Cartão:** a tabela ganha a coluna Operação (Débito × Crédito). O novo **Resumo de Fechamento por Adquirente** mostra Débito (bruto,
  MDR, líquido), Crédito (bruto, MDR, antecipação, líquido), aluguel de POS, subtotal por adquirente e Total Geral.
- **Credsystem:** sai a tabela analítica (as linhas "OUTRAS"). Ficam o bruto, o MDR com o % médio, o líquido futuro e a agenda
  (vencimento D+30/1º dia útil e valor total).
- **Dados:** o Cruzamento da Auditoria de Adquirentes passa a gravar `bandeiras[].modalidade` e `loteBandeiras` no
  `conc_fechamento`. Dias gravados antes da v13.87 mostram um aviso para regravar o Cruzamento; até lá, a prestação entra bruta.
- Nenhuma mudança no servidor, no banco nem no `contabilidade.html`.

## v13.88 · Correção da Gestão de Acessos + Prestação de Contas de Adiantamentos

### Correção: "permissão marcada, mas o menu não aparece"
- **Causa:** no Netlify, os dados de Contratos, Auditoria de Adquirentes/Conciliação, DFC e IEO eram entregues só ao Master
  (regra `admin` do banco), e o painel escondia esses menus de quem não é Master, mesmo com a matriz liberando. Permissões
  gravadas em formatos antigos (`true`, `"LEITURA"`, `{ nivel: 'Ler' }`…) também eram lidas como "sem acesso".
- **Servidor:** `netlify/lib/permissoes.mjs` normaliza o JSON de permissões (strings, booleanos, números, aninhamentos, JSON em
  texto) e calcula as permissões efetivas pela matriz. `sessaoDe` relê a conta a cada requisição. `documentos.mjs` entrega as
  coleções da tabela `COLECOES_MATRIZ` a quem a matriz libera. A matriz do servidor (`netlify/lib/matriz-acessos.mjs`) é
  **gerada do index.html** no build, então servidor e painel usam a mesma regra.
- **Painel:** leitura padronizada (`PermNorm`), `temAcesso(modulo, acao)` global (menu, roteador e telas). Ao salvar, as linhas da
  matriz que estão fora da tela não se perdem. As permissões da sessão são revalidadas na hora: conta alterada, volta para a
  aba e a cada 60 s. Quem perde a tela aberta volta ao Início.
- Salários, PDI, Ponto de Equilíbrio, Ocorrências/Pendências Credsystem, Auditoria, Backup e Gestão de Acessos continuam só do Master.

### Prestação de Contas de Adiantamentos (recurso `adiant_v1388`)
- **Importação** do arquivo de prestação (CSV, Excel ou JSON) no detalhe da viagem. Só o Master ou quem tem a nova opção
  **"Pode importar arquivo de prestação de contas"** (`viagens.importar`, linha de Viagens na Gestão de Acessos).
- **Motor de Crítica:** sinaliza despesa fora do período da viagem/solicitação, comprovante duplicado (na viagem e em outras
  viagens), gasto não reembolsável (bebida alcoólica, multas, gastos pessoais) e teto por categoria (alimentação e transporte =
  diárias; hospedagem = teto da política). A crítica sugere o valor aprovado; o Master/financeiro ajusta.
- **Acerto de Contas Final** (tela + impressão A4): (+) adiantamento, (−) despesas comprovadas e aprovadas, (=) saldo a devolver ao
  caixa ou a reembolsar ao viajante.
- **Encerrar Prestação de Contas** (só o Master, ou aprovando na Liberação Remota) chama `POST /api/contabil/adiantamentos/encerrar`.
  Isso trava a prestação, gera o título (devolução a receber / reembolso a pagar) e grava em partidas dobradas: o adiantamento pago
  (D 1.1.2.03.002 / C Banco) e a liquidação (D Viagens e Estadias [+ D Devoluções a Receber] / C Adiantamentos [+ C Reembolsos a Pagar]).
  Sem plano de contas, a contabilização fica pendente (`/contabilizar` depois). A baixa do título é feita em `/baixar`.
  Tudo é idempotente pelo documento do lançamento.
- **Migração** `20261107120000_esquema_adiantamentos.sql`: índice por documento nos lançamentos (checagem de duplicidade).
- **Testes:** `tests/teste-adiantamentos.mjs` (13) e `tests/teste-contabil.mjs` (38).

## v13.89 · Relatórios operacionais e pré-visualização de impressão padronizada (recurso `rel_v1389`)
Só tela (painel e Módulo Contábil). Nenhuma função, tabela ou migração nova no backend.
- **Solicitações Operacionais → aba "Relatório por período":** filtro de/até (data da solicitação) e loja. Mostra a contagem e os
  valores por **status** (Atendida/Concluída, Em Andamento, Pendente), por **loja/filial** e por **tipo** (Manutenção, Insumos, TI,
  Serviços, Equipamentos de Segurança, Outros), com a linha de total, o % de conclusão e o prazo médio de atendimento. No pedido
  entram os campos **Tipo** (se vazio, vem do 1º item marcado), **Valor** (opcional) e **Situação** (Pendente / Em Andamento).
  Na lista há o botão **"Em andamento"**.
- **Adiantamento de Viagens → aba "Resumo Operacional":** filtro de/até (data de ida). Considera as viagens pagas. Cards no topo
  (total adiantado, despesas comprovadas, deslocamento, saldo). Custos por tipo: adiantamentos, hotelaria/hospedagem,
  alimentação, deslocamento/passagens e outros. Despesa = valor aprovado no Acerto de Contas, senão o comprovado. A tabela por
  **setor/centro de custo** é expansível e abre as viagens de cada setor. Pode ser impressa.
- **Pessoas → Imprimir relatório da equipe:** antes de imprimir abre as opções (período de/até e Férias).
  - Folgas: saem só as **folgas agendadas no período** (aprovadas na Liberação Remota). As folgas fixas da escala não saem.
  - Férias: o padrão é **"Imprimir apenas Períodos de Férias Programados/Agendados"**. A opção **"Incluir Períodos Aquisitivos
    A Vencer"** acrescenta a situação do período aquisitivo.
- **Pré-visualização de impressão universal:** todo documento abre numa folha A4 (retrato ou paisagem) com a barra
  **[Imprimir] [Baixar PDF] [Fechar]** no topo. No celular, a folha aparece em escala reduzida.
  - Os botões que baixavam o PDF direto agora passam pela prévia: Falta de Caixa, Histórico de Infrações, Termo de DVC, Ponto
    de Equilíbrio e Resumo de Adiantamentos.
  - No resumo de viagem, "Baixar PDF" continua gerando o PDF completo com os vouchers.
  - O "Imprimir" do Módulo Contábil usa a mesma prévia.
- Com o recurso desligado, tudo funciona como na v13.88.

## v13.90 · RC Consultoria → Falco Controladoria e Gestão
- **Nome:** todas as telas, documentos, nomes de arquivo e o FCX do site white-label passam a exibir **Falco Controladoria e Gestão**.
  Nas versões reduzidas aparece só **Falco**: cabeçalho ("Falco · Painel de Gestão"), chip do ambiente e rodapé ("ERP Falco").
- **Compatibilidade (backend):** o identificador gravado continua `rc`. Isso vale para a coluna `sessoes.ambiente`, o cookie
  `painel_sessao_rc`, o prefixo `amb/rc/` e os registros existentes, então nenhuma sessão aberta cai.
  - `netlify/lib/ambiente.mjs` → `normalizarAmbiente()` aceita `falco` e `rc` em todas as entradas: `PAINEL_AMBIENTE`,
    `?amb=`, `/api/ambientes/falco/…` e o cabeçalho `x-painel-origem`.
  - `lib/sessao.mjs` grava e lê sempre o id normalizado.
  - Endereço do site: `PAINEL_URL_FALCO`. A antiga `PAINEL_URL_RC` continua valendo se a nova não existir.
  - **No Netlify, nada precisa mudar.** Opcional: no site da Falco, trocar `PAINEL_AMBIENTE=rc` por `falco`; nos três sites,
    criar `PAINEL_URL_FALCO`.
- **Logomarca oficial (a imagem enviada pela Falco, usada como está):** pasta `public/marca-falco/`. Nenhum vetor ou ícone novo foi criado.
  - `logo_falco.png`: a imagem original, cópia byte a byte.
  - `logo_falco_transparente.png`: o mesmo desenho sem o fundo azul, para os temas Midnight e Slate e para a tela de entrada.
  - `emblema_falco.png` e `emblema_falco_transparente.png`: recorte do círculo com o falcão, usado no topo e no ícone da aba.
  - `logo_branco.png`, `logo_navy.png` e `logo_fcx.png`: a imagem inteira centrada no próprio azul do fundo, nos tamanhos que o
    build do site usa.
  - O build (`scripts/preparar-ambiente.mjs`) usa essa pasta. A pasta antiga `public/marca-rc/` pode ser apagada.
- **Cores extraídas da logomarca:**
  - azul do fundo `#19283f`: fundo da plataforma, topo e menu (a logomarca se funde nele);
  - dourado do traço `#d5af66`: botões, bordas e destaques; `#c19a55` no hover;
  - títulos em ouro suave `#f0d8a8` e texto em branco;
  - bordas `rgba(213,175,102,.2)`.
- **Temas exclusivos da Falco:** seletor na barra superior com **Falco Imperial** (padrão), **Falco Midnight Gold** e
  **Falco Slate & Gold**. A escolha fica lembrada no navegador, separada dos temas da Esposende.
- **Tela Inicial:** na Falco, sem o Resumo do Recebível do Dia; aparecem só os cards padrão e os indicadores operacionais. Na
  Esposende (Produção e Homologação), nada muda.
- **Sem recurso de liberação:** a identidade vale no site da Falco assim que publicar, inclusive na tela de entrada.
  A v13.90 fica registrada na lista de versões.
- **Testes:** `tests/teste-ambiente-falco.mjs` (7). O `tests/tres-ambientes.sh` sobe o 3º site com `PAINEL_AMBIENTE=falco`.

## v13.91 · Módulo Contábil executivo multiempresas (recurso `contabil_v1391`)
A tela nova é `public/contabilidade_v1391.html`. Com o recurso ligado, o painel abre essa tela; desligado, abre a da v13.86
(`contabilidade.html`). O backend novo é compatível com as duas.
- **Multiempresas:** migração `20261108120000_esquema_empresas.sql`.
  - Tabela `contab_empresas`: CNPJ validado, razão social, nome fantasia, regime tributário, capital social, QSA (sócios e
    participações) e contador responsável (nome, CRC, UF).
  - Coluna `contab_lancamentos.empresa_id`. O plano de contas, o de-para do FCX e os parâmetros continuam únicos.
  - Os lançamentos que já existiam ficam na "Empresa principal". Os hashes antigos não mudam; a empresa entra no hash dos
    lançamentos novos (mover um lançamento de empresa por fora quebra a cadeia).
  - Todas as rotas de lançamento e de relatório aceitam `?empresa=`; o encerramento é feito por empresa.
- **Barra de Disponibilidades em tempo real:**
  - cards: Caixa Geral (1.1.1.01) com entradas e saídas; Bancos c/ Movimento (1.1.1.02) com depósitos e pagamentos;
    Estoque de Mercadorias (1.1.3) com entradas e baixas de CMV; Total consolidado circulante;
  - card expansível da Empresa Ativa com os atalhos Efetuar lançamentos, Ver lançamentos, Quadro de sócios e Resumo da
    escrituração (Σ Débitos × Σ Créditos e integridade).
  - Rota `GET /api/contabil/disponibilidades`.
  - Os códigos são os do plano padrão do painel (1.1.1.01, 1.1.1.02 e 1.1.3), que correspondem às contas 1.1.01, 1.1.02 e 1.1.05
    pedidas.
- **Relatórios em abas horizontais, sem caixas de seleção:** Livro Diário | Livro Caixa | Livro Razão | Balancete Geral |
  DRE CPC 26 | DRE CPC 51 | Balanço Patrimonial | DRA | DMPL | DFC, mais DVA e LALUR. Cada aba tem os seus KPIs:
  - Livro Diário: Total de Débitos, Total de Créditos, integridade das partidas dobradas e a divisão em 1ª, 2ª, 3ª e 4ª fórmula.
  - Livro Caixa: saldo inicial, entradas, saídas e saldo final, com o selo do responsável técnico (CRC).
  - DRE e Balanço: comparativo lado a lado com o exercício anterior e seletor de exercício.
  - DFC: caixa inicial, fluxos operacional, de investimento e de financiamento, e caixa final.
- **Novos relatórios no servidor:**
  - `caixa` (Livro Caixa);
  - `dfc` (DFC pelo método direto, classificada pela contrapartida do Disponível);
  - `dre51` (DRE no formato do CPC 51 / IFRS 18, com as categorias operacional, de investimento e de financiamento; é uma
    aproximação gerencial pelo plano de contas).
- **Radar de Saúde Empresarial:** `GET /api/contabil/radar`, com a lógica em `netlify/lib/contabil-radar.mjs`.
  - Score de 0 a 100, dividido em integridade da escrituração e saúde financeira (12 fatores), mais os indicadores de liquidez,
    endividamento, margem e retorno sobre o PL.
  - **Motor de Crítica, bloco "Sugestões de Ação e Correção":**
    - contas do Ativo com saldo credor e do Passivo com saldo devedor, com a reclassificação proposta;
    - movimentos do Disponível sem documento de origem (pendentes de conciliação com o FCX) e contas pendentes no de-para;
    - variação desproporcional em relação ao mês anterior;
    - recomendações tributárias: retenções na fonte, ano-teste 2026 do IBS/CBS, simulação Modelo Atual × Reforma
      (LC 214/2025), tributos sem recolhimento e limites do Lucro Presumido.
  - As correções de saldo voltam como proposta de lançamento: o formulário abre preenchido, o usuário confere e grava.
    `POST /api/contabil/radar/corrigir {tipo:'retencoes'}` cria as contas de tributos retidos (2.1.3.03).
- **Laudo Técnico & Parecer Contábil:** prévia em A4 com o cabeçalho da empresa e do responsável técnico, o resumo da DRE, do
  BP e da DFC, o Radar e os riscos, o parecer conclusivo com os ajustes sugeridos e as assinaturas do contador e da diretoria.
  O laudo é um relatório de apoio à gestão: não substitui o relatório do auditor independente.
- **"Exportar para PDF Relatório Selecionado":** gera o PDF em A4 direto pelo painel, com a empresa e o CRC no cabeçalho.
- **Cores do ambiente:** a tela segue os tokens do painel (paleta institucional ou a da Falco: azul-marinho e dourado, com
  títulos em ouro suave). Também foi corrigida a detecção de tema escuro quando as cores vêm em hexadecimal.
- **Testes:**
  - `tests/teste-contabil-v1391.mjs` (20 verificações);
  - `test1391n` (16 verificações, ponta a ponta dentro do painel).
