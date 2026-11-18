# Painel de Gestão Esposende · Netlify + Netlify Database (Postgres)

Versão v14.18. O painel roda no Netlify com um banco **Postgres gerenciado (Netlify Database)** e as rotas da API em
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
   /api/docs/massa → importação em massa (v14.11)
   /api/mudancas   → o que mudou desde…            arquivos + arquivo_partes (PDF/imagens)
   /api/arquivos, /_blob/<id> → arquivos           views vw_* para consultas em SQL/BI
   /api/ambientes/<id>/docs → outro ambiente (Master) → /api/inter/* no site de destino (chave entre ambientes)
```

- **Detecção automática:** ao abrir, o painel chama `/api/saude`. No Netlify ele usa o Postgres; no claude.ai continua com o banco do claude.ai. O motor do FCX e a Auditoria de Adquirentes não mudaram: gravam pelo mesmo caminho de sempre.
- **Login no servidor:** o CPF e a senha são conferidos na função `/api/sessao`, com o mesmo hash do painel (sal + SHA-256 em 3.000 rodadas). Antes do login o navegador não recebe nenhum usuário nem senha. A sessão fica num cookie `HttpOnly; Secure; SameSite=Strict`.
- **Regras de acesso no servidor:** as mesmas 39 regras do banco do claude.ai (`netlify/lib/regras.mjs`). O **Master** tem o papel de editor (salários, contratos, DFC, adquirentes, auditoria, Homologação/RC). O **Operacional** tem acesso de uso.
  - Usuários não-Master nunca recebem os hashes de senha.
  - Só alteram o próprio login (senha e último acesso) e não conseguem mudar perfil, permissões ou situação.
- **Sincronização:** cada gravação entra na tabela `mudancas`. O painel consulta `/api/mudancas` e relê só as coleções que mudaram: a cada 5 s (30 s com a aba em segundo plano) até a v14.09 e, **desde a v14.10 (recurso `gestao_v1410`)**, a cada 30 s com a aba em uso, nenhuma consulta com a aba oculta ou sem uso por 10 minutos, e consulta imediata ao voltar, mexer ou gravar (ver a seção v14.10).
  - Exemplo: o desligamento de um funcionário encerra a sessão dele em outro computador.
- **Arquivos:** contratos, termos e comprovantes vão em partes de 1 MB para o Postgres e são servidos em `/_blob/<id>`, só para quem está logado.

## Estrutura

```
netlify.toml                         publish = public, funções em netlify/functions
package.json                         dependência @netlify/database (provisiona o banco no deploy)
public/                              index.html (painel), fcx.html (Fluxo de Caixa), logos
netlify/functions/                   saude, sessao, docs, mudancas, arquivos, ambientes, inter, consulta-cnpj, migracoes, backup-nuvem, notificar, aprovacoes-saidas (rotas /api/*), backup-agendado (rotina das 23:59) e notificacoes-agendadas (cron de 5 min), sem rota
netlify/lib/                         db (getDatabase), ambiente (v13.76), inter, regras de acesso, sessão, senha, usuários, documentos
public/marca-rc/                     logos da RC Consultoria (aplicadas no build quando PAINEL_AMBIENTE=rc)
scripts/run-migrations.mjs           etapa de build (v13.94): aplica as migrações repetíveis pendentes antes de compilar o site
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

**Automação (v13.94):** o build roda `scripts/run-migrations.mjs` antes de compilar o site e o Master tem o botão **Executar Migrações do Banco** (Backup e dados). Ninguém precisa abrir console SQL. A regra de segurança, o que roda e o que fica com o Netlify estão na seção "v13.94 · Automação de migrações do banco", mais abaixo. **Escreva as migrações novas como "só cria o que falta"** (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`): assim a automação também as roda.

## Segurança e LGPD

- O repositório precisa ser **privado**: a migração de semente tem o CPF e o nome do Master e o cadastro das lojas.
- **Previews de deploy** recebem uma cópia dos dados da Produção, e o link de preview é público. Não compartilhe previews.
- Depois de 5 senhas erradas, o CPF fica bloqueado por 5 minutos. Há também um limite de 30 tentativas por IP em 10 minutos.
- Toda gravação exige o cabeçalho `x-painel: 1`, que protege contra CSRF, e o cookie é `SameSite=Strict`.
- A matriz de permissões por módulo (Ler/Modificar/Excluir) continua sendo aplicada pela tela, como no claude.ai. O servidor garante as regras por coleção.

## Limites

- Os arquivos anexados (PDF/imagens) ficam no banco de cada site. A Clonagem copia os registros, mas não os arquivos.

- Importação de Fornecedores e Clientes: até **30.000 linhas e 30 MB** por planilha com a v14.11 ligada (antes, 2.000 linhas e 8 MB), gravada em lotes de 2.000 cadastros por requisição; cada requisição de `/api/docs/massa` aceita no máximo 2.000 cadastros e 5 MB de JSON.
- Até 5,5 MB por registro e 15 MB por arquivo (no painel, 5 MB por anexo e 15 MB por imagem de termo, conferidos antes do envio). Desde a v14.10 as imagens JPG, PNG e WebP são compactadas no navegador antes de subir; PDF segue intacto.
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

## v13.92 · Carga de dados de teste do Módulo Contábil (somente no site da Falco)
Carrega uma base de teste para validar o Diário, o Razão, o Balancete, a DRE, o Balanço e o Radar: os 60 lançamentos de
`LançamentosIniciais.xlsx` (jan–fev/2025) e mais 10 de março/2025.

**Os lançamentos de março (10):**
- empréstimo bancário de longo prazo de R$ 600 mil (metade no circulante);
- compra de matéria-prima com IBS/CBS a recuperar;
- produção;
- venda com IBS/CBS;
- custo da venda;
- folha de março;
- depreciação e seguro;
- 1ª parcela do empréstimo com juros passivos;
- IRPJ e CSLL do 1º trimestre (Lucro Real trimestral: 15% + adicional de 10% acima de R$ 60 mil e 9%);
- distribuição de 50% do lucro aos sócios.

**Travas de segurança** (o site do Netlify da Esposende, de Produção ou de Homologação, recusa sempre com 403):
- **Script:** só roda com `PAINEL_AMBIENTE=falco` (exatamente) no terminal e confere em `/api/saude` que o site informado é o da
  Falco antes de enviar qualquer coisa.
- **Servidor (`POST /api/contabil/carga-teste`):** só aceita no site da Falco (`PAINEL_AMBIENTE=falco`; a variável antiga `rc`
  também identifica a Falco), só para o Master e só com a frase `CARREGAR DADOS DE TESTE NA FALCO`.
- **Desligar a rota:** `PAINEL_CARGA_TESTE=0` no site da Falco.

**O que a carga faz:**
- **Plano de contas:** cria as contas da planilha (1.1.01 Caixa, 1.1.02 Bancos, 2.1.01 Fornecedores, 5.1.01 CMV…) e as de março,
  com a árvore Ativo / Passivo / PL / Receitas / Custos e Despesas, só o que faltar.
  - Classificação automática: natureza pelo grupo, retificadoras "(-)", linhas da DRE/DVA pelo subgrupo e IBS/CBS/IRPJ/CSLL pelo nome.
  - Se o plano padrão já existir, as contas novas entram nele; nomes repetidos na mesma conta-mãe ganham o sufixo
    "— plano de testes", com aviso.
- **Empresa:** tudo fica em uma empresa fictícia própria, "INDÚSTRIA FICTÍCIA DE TESTES FALCO LTDA" (CNPJ 11.444.777/0001-61).
  Lançamentos não se apagam (só estorno), por isso a empresa principal não é tocada.
- **Idempotente:** cada lançamento tem o documento `CARGA-LI-001…060` ou `CARGA-MAR-01…10`; rodar de novo não duplica.
- **Transação única:** a carga é tudo ou nada. `simular: true` confere tudo e desfaz.

**Como rodar — opção 1, terminal** (Node 20+; não precisa do Netlify CLI, porque o script fala com o site publicado):
```bash
PAINEL_AMBIENTE=falco node scripts/seed-contabil-falco.mjs --url https://SEU-SITE-FALCO.netlify.app --planilha "LançamentosIniciais.xlsx" --simular
PAINEL_AMBIENTE=falco node scripts/seed-contabil-falco.mjs --url https://SEU-SITE-FALCO.netlify.app --planilha "LançamentosIniciais.xlsx"
```
- No Windows (PowerShell): `$env:PAINEL_AMBIENTE="falco"; node scripts/seed-contabil-falco.mjs --url … --planilha …`.
- O script pede o CPF e a senha do Master (ou use `PAINEL_CPF` e `PAINEL_SENHA`) e a frase de confirmação.
- Sem `--planilha`, o servidor usa a cópia da planilha que já vem no código (`netlify/lib/carga-falco-dados.mjs`).
- Para regravar essa cópia a partir de outra versão da planilha: `node scripts/seed-contabil-falco.mjs --gerar-dados planilha.xlsx`.

**Como rodar — opção 2, botão oculto:** no site da Falco, entre como Master › Contabilidade › aba Parâmetros ›
"Carga de dados de teste (somente Falco)". Digite a frase e clique em Executar; a opção "Só simular" confere sem gravar.
O botão só aparece para o Master no site da Falco. Ao terminar, a empresa de teste fica ativa, no período de 01/01 a 31/03/2025.

**Resultados esperados (1º trimestre/2025):**

| Item | Valor |
|---|---|
| Σ débitos = Σ créditos | R$ 8.195.161,46 |
| Receita bruta | R$ 974.200,00 |
| Deduções de IBS/CBS | R$ 258.163,00 |
| Receita líquida | R$ 716.037,00 |
| CMV | R$ 409.164,00 |
| LAIR | R$ 41.533,00 |
| IRPJ | R$ 6.229,95 |
| CSLL | R$ 3.737,97 |
| Lucro líquido | R$ 31.565,08 |
| Lucros distribuídos | R$ 15.782,54 |

- O Balanço de 31/03 fecha.
- Teste: `tests/teste-carga-falco.mjs` (19 verificações; passe o caminho da planilha para testar o script com o .xlsx).

**Correções que a carga revelou:**
- **DRE:** uma conta de dedução com dois tributos, como "(-) IBS/CBS s/ Vendas", era somada duas vezes. Agora entra uma vez,
  numa linha "IBS/CBS (escriturados)".
- **Radar, disponibilidades, Livro Caixa e DFC:** agora reconhecem planos de contas próprios pelo nome das contas (ex.:
  1.1.01 Caixa, 1.1.02 Bancos, 1.1.04–06 Estoques), além do plano padrão.

## v13.93 · RH, Viagens, Retaguarda e Lojas (recurso `gestao_v1393`)

Tudo fica atrás do recurso `gestao_v1393`: ativo na Homologação; Produção e Falco só depois de **Liberar Versão em Produção**.
Não há migração de banco, rota nova nem variável de ambiente nova. Para atualizar, descompacte o ZIP na raiz do projeto e envie pelo GitHub Desktop.

**1 · Permissão isolada de salários**
- Nova opção **Pode ver salários** (`rh.ver_salarios`) no módulo RH da Gestão de Acessos. Só quem a recebe (ou o Master) vê salário, líquido e custo.
- O perfil Gestor de Área/Setor deixa de herdar essa visão: continua vendo a equipe, sem os valores.
- No servidor, `salarios` e `rh_folhas` só são lidos com `rh.ver_salarios` (403 sem ela ou com o recurso desligado); a gravação segue só do Master.
- O relatório da equipe ganhou a opção "Incluir salário base, líquido e custo", que só aparece para quem tem a permissão.

**2 · Férias em períodos**
- Até 3 períodos, somando no máximo 30 dias (20 se vender 1/3): um com 14 dias ou mais e os demais com 5 ou mais (CLT, art. 134, §1º), sem sobreposição e sem datas no passado.
- Antes das datas, duas opções: vender 1/3 (abono pecuniário de 10 dias, art. 143 da CLT) e adiantar a 1ª parcela do 13º (art. 2º da Lei 4.749/1965).
- Atenção: **10 + 10 + 10 não passa** (falta um período de 14 dias); 15 + 15, 20 + 10 e 14 + 8 + 8 passam. Não cobre a regra do art. 134, §3º (início das férias nos 2 dias antes de feriado ou descanso semanal).

**3 · Folga por período:** Data Inicial e Data Final, com contagem automática dos dias (até 31).

**4 · Hierarquia transitiva:** o gestor do setor vê e aprova férias, folga e a solicitação de viagem de toda a árvore abaixo dele
(liderados dos liderados, departamentos e sub-departamentos), sem decidir o próprio pedido. Prestação, exclusão de viagem e zerar FCX seguem só do Master.

**5 · Depósitos "Parcialmente":** Check 1 com Sim = 100% dos pontos mantidos, Parcialmente = 50% e Não = 0%. Registros antigos continuam valendo.

**6 · Gestão de Lojas › Máquinas POS Consolidado:** Filial, Adquirente, Qtd de POS, valor unitário de aluguel e custo total, por filial e para a rede (Excel e PDF).

**7 · Gestão de Lojas › Indicadores & KPIs Operacionais:** venda, custo operacional e resultado por m² (área de vendas cadastrada). Custos restritos a quem acessa Contratos; folha só com `rh.ver_salarios`.

**8 · Viagens:** selo vermelho **PRAZO EXCEDIDO - PRESTAÇÃO PENDENTE** quando o prazo da prestação passou, com filtro "Prazo excedido".

**Arquivos do backend alterados:** `netlify/lib/permissoes.mjs` e `netlify/lib/matriz-acessos.mjs` (regerado do painel). `public/index.html` é a v13.93.

**Como conceder a permissão:** Gestão de Acessos › editar o usuário › módulo RH › marque **Pode ver salários**.

**Testes:** `tests/teste-contabil.mjs`, `teste-contabil-v1391.mjs`, `teste-adiantamentos.mjs`, `teste-carga-falco.mjs` e `teste-ambiente-falco.mjs` seguem verdes (rode cada um com o banco recriado por `tests/preparar-banco.sh`).

## v13.94 · Layout 100% da largura e consulta automática de CNPJ/CPF (recurso `gestao_v1394`)

Tudo fica atrás do recurso `gestao_v1394`: ativo na Homologação; Produção e Falco só depois de **Liberar Versão em Produção**.
Há **uma migração nova** (`20261110120000_esquema_empresas_receita.sql`: coluna `receita` em `contab_empresas`, sem perda de dados) e **nenhuma variável de ambiente obrigatória**.
Para atualizar, descompacte o ZIP na raiz do projeto e envie pelo GitHub Desktop (o Netlify aplica a migração no deploy; o build e o botão do Master também sabem aplicá-la — veja "Automação de migrações", abaixo).

**1 · Layout responsivo, 100% da largura, sem rolagem horizontal** (painel, FCX e Módulo Contábil)
- Sem largura máxima nos contêineres principais; respiro lateral fluido de 1,5 a 2 rem (1 rem no celular). Vale para laptop 1366/1440, Full HD 1920 e ultra-wide.
- Grades e cartões (`.g2` a `.g5`, formulários, módulos, FCX, Contábil) se redistribuem sozinhos conforme a largura.
- Tabelas: densidade menor (fonte e espaçamento proporcionais). Se mesmo assim não couberem, o painel mede e troca a barra de rolagem por **cartões**: um cartão por linha, com o nome da coluna acima de cada valor. A medição é refeita a cada render, ao redimensionar e ao abrir/fechar o menu. Vale para Gestão de Pessoal, Rateio de Faturamento por Loja (Ponto de Equilíbrio), Lojas, Contratos, Fornecedores e Clientes etc.
- Fica com rolagem só dentro do próprio quadro: mapas de calor/matrizes (`.heat`), relatórios A4 e impressão, e tabelas marcadas com `data-rt94="off"`.
- O FCX ganhou apenas um bloco `<style id="fw94">` (CSS, só na tela). Nenhuma função do FCX mudou (Regra de Ouro).

**2 · Consulta automática de CNPJ (Receita Federal)**
- Nova função `GET /api/consulta-cnpj?cnpj=…` (`netlify/functions/consulta-cnpj.mjs` + `netlify/lib/consulta-cnpj.mjs`): consulta a **BrasilAPI** e, se ela falhar (erro, tempo esgotado ou resposta vazia), a **MinhaReceita**. Exige sessão aberta (401 sem login), valida os dígitos (400), devolve 404 se o CNPJ não existe, 429 após 40 consultas por minuto por sessão e 502 se as duas fontes estiverem fora. Cache de 10 min em memória (por instância). O navegador nunca chama as APIs públicas.
- Ao digitar o 14º dígito (ou ao sair do campo) o painel mostra "Buscando dados do CNPJ..." e preenche Razão Social, Nome Fantasia, CEP, Logradouro/número/complemento, Bairro, Cidade, UF, Capital Social e Situação Cadastral. Campos vazios na resposta não apagam o que já foi digitado; se a Receita não responder, o formulário segue livre para preencher à mão.
- Onde vale: Gestão de Lojas (CNPJ da loja), Empresa da Conciliação de Meios de Pagamento, **CNPJ do TEF**, Módulo Contábil › Empresas (botão "Consultar Receita") e o novo cadastro de Fornecedores e Clientes.
- Variáveis opcionais (só para testes ou troca de provedor): `CNPJ_URL_BRASILAPI`, `CNPJ_URL_MINHARECEITA` (com `{cnpj}`) e `CNPJ_TIMEOUT_MS`.
- No painel hospedado no claude.ai (sem servidor) a consulta direta fica bloqueada: o painel avisa e o formulário segue livre. A consulta funciona na versão Netlify.

**3 · CPF:** máscara automática 000.000.000-00, conferência dos dígitos verificadores ao sair do campo e alerta (campo vermelho + mensagem) antes de salvar; CPF inválido não grava.

**4 · Novo módulo 13 · Fornecedores e Clientes** (pessoa jurídica pelo CNPJ, pessoa física pelo CPF; papéis fornecedor e/ou cliente; busca e filtros; inativar/reativar; excluir com confirmação; CNPJ/CPF repetido é barrado).
- Permissões na Gestão de Acessos: Ler (`parceiros.ver`), Modificar (`parceiros.editar`) e Excluir (`parceiros.excluir`).
- No servidor, a coleção `parceiros` só é lida/gravada com essas permissões (contém CPF de pessoa física); o perfil Loja nunca acessa; excluir exige `parceiros.excluir`.

**Arquivos do backend alterados/novos:** `netlify/functions/consulta-cnpj.mjs`, `netlify/lib/consulta-cnpj.mjs`, `netlify/functions/contabil.mjs` (empresa guarda o bloco `receita`), `netlify/lib/regras.mjs`, `netlify/lib/permissoes.mjs`, `netlify/lib/documentos.mjs`, `netlify/lib/matriz-acessos.mjs` (regerado), migração `20261110120000_esquema_empresas_receita.sql`. `public/` é a v13.94.

**Testes novos:** `tests/teste-consulta-cnpj.mjs` (API da consulta com a Receita simulada). Para rodá-lo:
`bash tests/preparar-banco.sh` e suba `tests/servidor-local.mjs 8890` com `CNPJ_URL_BRASILAPI='http://127.0.0.1:8895/brasil/{cnpj}' CNPJ_URL_MINHARECEITA='http://127.0.0.1:8895/minha/{cnpj}' CNPJ_TIMEOUT_MS=700`.

### v13.94 · Automação de migrações do banco (revisão do pacote v13.94)

O banco é gerenciado pelo Netlify (Netlify Database) e ninguém usa console SQL. Duas peças aplicam as migrações sozinhas:

1. **Build:** o `netlify.toml` agora roda `node scripts/run-migrations.mjs && node scripts/preparar-ambiente.mjs`. O script lê `netlify/database/migrations/`, conecta com `NETLIFY_DB_URL` (a mesma que as funções usam; se ela não existir, usa `DATABASE_URL`) e aplica as migrações pendentes **antes** de compilar o site.
2. **Botão do Master:** em **Sistema & Segurança › Backup e dados**, logo abaixo da Gestão de Ambientes, há o bloco recolhido **Banco de dados · Migrações** (etiqueta "avançado · só Master"). Ao abrir, ele mostra o que está aplicado e pendente e se o esquema que o painel exige está completo; **Executar Migrações do Banco** pede confirmação e roda na hora, pela função `POST /api/migracoes`. Só aparece para o Master (não simulado), só nos sites do Netlify e só com o recurso `gestao_v1394` ligado. Cada execução vai para o log de auditoria. A função recusa quem não é Master (401/403).

**Por que só as migrações "repetíveis".** O Netlify também aplica essa pasta no deploy, antes de publicar, e a documentação dele manda usar outra pasta quando se quer um sistema próprio, para não haver conflito. Se o script rodasse o esquema inicial ou a semente e depois o Netlify tentasse de novo, o deploy seria bloqueado por duplicidade. Por isso:

- O script só executa migrações **aditivas**, que podem rodar duas vezes sem alterar nada: `CREATE TABLE IF NOT EXISTS`, `CREATE [UNIQUE] INDEX IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS` e `CREATE EXTENSION IF NOT EXISTS`. Quando o Netlify aplicar a mesma migração no deploy, ela é um "não faz nada".
- Todo o resto (esquema inicial, semente, INSERT/UPDATE/DELETE, funções, gatilhos, views, DROP…) continua sendo do Netlify. O script lista essas migrações como "geridas pelo Netlify" e **nunca** as executa. Hoje, das 8 migrações do projeto, 3 são repetíveis (`20261107120000_esquema_adiantamentos.sql`, `20261110120000_esquema_empresas_receita.sql` e, desde a v13.95, `20261111120000_esquema_backups_nuvem.sql`) e 5 são do Netlify.
- Banco novo (ainda sem o esquema inicial): o script não toca em nada; o esquema inicial é do deploy do Netlify.
- Pré-requisito ausente (tabela ou coluna que o Netlify ainda não criou): a migração fica "adiada", sem erro.
- Cada migração roda numa transação (ou entra inteira, ou nada), com trava consultiva: build e botão ao mesmo tempo não se atropelam. `lock_timeout` e `statement_timeout` impedem o build de ficar pendurado.
- Erro de SQL: o build **falha** (sai com 1), mostra o arquivo, o código e a primeira linha da mensagem, e não publica código que depende da migração. Sem conexão com o banco: avisa e segue (o deploy do Netlify aplica); com `MIGRACOES_ESTRITO=1` falha.
- Livro-razão próprio: tabela `painel_migracoes` (nome do arquivo, hash, origem `build`/`botao`, data). Não guarda dado pessoal. Migração já aplicada **não é refeita** mesmo que o arquivo mude (o status avisa "alterado depois de aplicado").
- A saída do script e as respostas da função nunca mostram a URL do banco, host, usuário ou o texto SQL.

**Variáveis (todas opcionais):** `MIGRACOES_DESLIGADAS=1` (pula tudo), `MIGRACOES_ESTRITO=1` (falha o build também sem conexão), `MIGRACOES_LOCK_MS` e `MIGRACOES_STMT_MS` (esperas máximas em ms).

**Comandos:** `npm run migrar` (aplica as pendentes), `npm run migrar:status` (só lista, não altera o banco) e `node scripts/run-migrations.mjs --embutir` (só regenera o módulo embutido).

**Módulo embutido.** As Netlify Functions não leem arquivos .sql no servidor; por isso o build gera `netlify/lib/migracoes-embutidas.mjs` com o SQL **só das migrações repetíveis** (da semente vai só o nome). O arquivo é refeito a cada build e já vem no ZIP; não o edite.

**Quando criar uma migração nova:** escreva-a como "só cria o que falta" (veja acima). Se uma migração precisar de INSERT/UPDATE ou de um `CREATE` sem `IF NOT EXISTS`, ela continua valendo: fica por conta do deploy do Netlify, como sempre. Quando a migração passar a ser exigida pelo painel, acrescente o item em `VERIFICACOES`, em `netlify/lib/migracoes.mjs`, para o bloco do Master mostrar se o esquema está completo.

**Arquivos novos/alterados:** `scripts/run-migrations.mjs`, `netlify/lib/migracoes.mjs`, `netlify/lib/migracoes-embutidas.mjs` (gerado), `netlify/functions/migracoes.mjs`, `netlify.toml` (comando de build), `package.json` (scripts `migrar` e `migrar:status`), `tests/teste-migracoes.mjs`, painel (`public/index.html`).

**Teste:** `tests/teste-migracoes.mjs` (43 verificações: análise do SQL, banco novo e existente, migração pendente da v13.94, idempotência, falha com desfazer, execução simultânea, `lock_timeout`, o script de build com todas as variáveis e a API com 401/403/405/200). Com o servidor local no `painel_teste` (`bash tests/preparar-banco.sh`, `NETLIFY_DB_URL=… node tests/servidor-local.mjs 8890`): `NETLIFY_DB_URL=… node tests/teste-migracoes.mjs`. Ele cria e apaga bancos temporários `painel_mig_*` no mesmo Postgres.

## v13.95 · Pontos de Restauração na Nuvem (recurso `backup_nuvem_v1395`)

O backup deixa de depender de um arquivo `.json` baixado no computador: o próprio banco guarda **fotografias (snapshots) versionadas** dos dados do painel, e o Master volta a qualquer uma delas. O arquivo `.json` continua existindo, mas como **contingência secundária** (bloco recolhido na tela).

**Onde fica.** Sistema & Segurança › **Backup e dados**, seção **Pontos de Restauração na Nuvem** (acima das planilhas): botão **Criar Ponto de Restauração Agora**, tabela dos 30 pontos mais recentes (Data/Hora, Tipo, Criador, Registros · Tamanho) e, só para o Master, **Restaurar esta versão**. Abaixo, o bloco recolhido **Contingência · cópia em arquivo local (.json)** guarda o download e o upload do `.json`. Só aparece nos sites do Netlify, e só com o recurso ligado: a Homologação já nasce com ele; Produção e Falco recebem em **Liberar Versão** (marque Configurações gerais).

**Banco.** Tabela `painel_backups_historico` (migração repetível `20261111120000_esquema_backups_nuvem.sql`, criada no deploy, no build e pelo botão Executar Migrações do Banco): `id`, `data_hora`, `usuario_cpf`, `tipo_backup` (`AUTOMATICO`, `MANUAL` ou `PRIMEIRO_ACESSO`), `payload_json`, `total_registros`, `versao_painel`, e ainda `usuario_nome`, `tamanho_bytes`, `sha256` (integridade), `preventivo` e `nota`. Cada site do Netlify tem o seu banco e, portanto, o seu histórico.

**Quando um ponto é criado.**

- **Primeiro acesso do dia (`PRIMEIRO_ACESSO`):** logo depois do login de **qualquer** usuário (Master, Operacional, Loja…), o painel chama em segundo plano `verificar-primeiro-acesso`. Se ainda não existe ponto de hoje (dia de Brasília), o servidor cria um, sem aviso nem espera na tela. Várias pessoas entrando juntas geram um único ponto (trava consultiva no banco). Se o banco estiver ocupado ou a tabela ainda não existir, o servidor só adia (a tela não é afetada) e a próxima entrada tenta de novo.
- **Agendado (`AUTOMATICO`):** a função `netlify/functions/backup-agendado.mjs` roda todo dia às **23:59 de Brasília**. Como o agendador do Netlify usa UTC, o cron é `59 2 * * *` (Brasília não tem horário de verão). É idempotente: se já houve um ponto agendado nas últimas 20 h, não cria outro.
- **Manual (`MANUAL`):** botão **Criar Ponto de Restauração Agora** (Master). No máximo um a cada 20 s e 20 por dia, para rajadas não empurrarem os pontos antigos para fora da retenção.

**O que entra e o que não entra.** Entram todas as coleções de documentos (lojas, colaboradores, FCX, Retaguarda, contratos, configurações, usuários…). Ficam de fora: log de auditoria, presença, marcadores do sistema, os arquivos anexos (PDFs e imagens) e o livro contábil (os lançamentos contábeis são intangíveis e só se corrigem por estorno). O ponto é montado inteiro dentro do Postgres (sem trazer os dados para a função), com SHA-256 do conteúdo.

**Retenção.** Mantém os 60 pontos mais recentes (variável opcional `BACKUP_NUVEM_RETENCAO`, de 30 a 365). A poda roda depois de cada criação e nunca apaga o ponto recém-criado nem o preventivo da restauração em andamento.

**Restaurar (só Master).** O modal explica o que acontece e só libera **Restaurar agora** quando a palavra **RESTAURAR** é digitada (exata, em maiúsculas); o servidor confere de novo e recusa sem ela. O servidor:

1. cria antes, e grava de forma definitiva, um **ponto preventivo** com o estado de agora (para desfazer, é só restaurá-lo);
2. confere a integridade do ponto escolhido (SHA-256), o formato e se é do mesmo ambiente; recusa ponto vazio ou adulterado;
3. aplica tudo **numa única transação**: o que existe no ponto é recriado ou voltado, o que foi criado depois some, e cada coleção entra no log de mudanças (os outros computadores se atualizam sozinhos pela sincronização). Ou tudo é aplicado, ou nada;
4. antes de confirmar, checa duas travas: precisa continuar existindo ao menos um Master ativo e **quem está restaurando precisa continuar sendo Master ativo** (senão a transação é desfeita e a tela explica);
5. por padrão, **usuários e senhas ficam como estão hoje** (uma senha trocada depois do ponto não volta e ninguém perde o acesso); a caixa "Restaurar também usuários e acessos" muda isso. Sessões abertas continuam válidas.

Depois, a tela mostra o resumo (criados, atualizados, removidos), o número do ponto preventivo e o botão **Recarregar o painel**. Criar e restaurar ficam no log de auditoria (módulo backup). O CPF do criador aparece mascarado (`•••.•••.•••-NN`) e o `payload_json` nunca vai para a tela.

**Função agendada no Netlify.** O Netlify só executa funções agendadas no deploy **publicado** (não em previews e branch deploys). Em **Logs › Functions › backup-agendado** aparecem as execuções, e é possível rodar na hora com **Run now** (pelo painel do Netlify, nunca pelo painel do Esposende). O limite de uma função agendada é de 30 s. Em cada um dos três sites a rotina age sobre o banco do próprio site.

**Limite de tempo da restauração.** A restauração roda na função `/api/backup-nuvem` (limite padrão de 10 s no Netlify, ajustável nas configurações do site para bases grandes). A transação é atômica: se o tempo estourar, a tela mostra o erro do servidor e nada fica aplicado pela metade; o ponto preventivo já foi gravado antes. Se isso acontecer, confira em **Atualizar** se o ponto preventivo apareceu, aumente o limite da função nas configurações do site e tente de novo.

**Arquivos novos/alterados:** `netlify/database/migrations/20261111120000_esquema_backups_nuvem.sql`, `netlify/lib/backup-nuvem.mjs` (núcleo: criar, listar, restaurar, primeiro acesso, agendado), `netlify/functions/backup-nuvem.mjs` (`/api/backup-nuvem`: GET listar; POST `criar`, `listar`, `restaurar`, `verificar-primeiro-acesso`), `netlify/functions/backup-agendado.mjs`, `netlify/lib/migracoes.mjs` (item no `VERIFICACOES`), `netlify/lib/migracoes-embutidas.mjs` (regenerado), `tests/servidor-local.mjs` (ignora funções sem rota), `tests/teste-backup-nuvem.mjs`, `tests/teste-migracoes.mjs`, painel (`public/index.html`).

**Teste:** `tests/teste-backup-nuvem.mjs` (54 verificações: tabela e restrições, 401/403/405/429, ponto de primeiro acesso com 6 pedidos simultâneos gerando 1 ponto, dia de Brasília, agendado idempotente, retenção, restauração completa, preventivo, travas de Master, adulteração, outro ambiente e restaurações simultâneas). Mesmo preparo do `teste-migracoes.mjs`: `bash tests/preparar-banco.sh`, `NETLIFY_DB_URL=… node tests/servidor-local.mjs` e `NETLIFY_DB_URL=… node tests/teste-backup-nuvem.mjs`.

## v13.96 · Recebível sem "LOTE", partidas dobradas coloridas e Biblioteca CPC & Regras Fiscais (recurso `gestao_v1396`)

Tudo fica atrás do recurso `gestao_v1396`: ativo na Homologação; Produção e Falco só depois de **Liberar Versão em Produção**. Desligado, a tela fica exatamente como era na v13.95.
**Não há migração nova, função nova nem variável de ambiente nova.** Para atualizar, descompacte o ZIP na raiz do projeto e envie pelo GitHub Desktop (mudam só `public/index.html`, `public/fcx.html`, `public/contabilidade_v1391.html` e este README).

**1 · Consolidado de Entradas (Vendas + Prestações): rótulo da prestação sem "LOTE"** (painel inicial e FCX · Recebível Diário)
- O identificador interno `LOTE` do arquivo de cartões do ERP continua sendo usado **apenas** para classificar o valor na coluna **Prestação**. Ele não aparece mais para o usuário.
- O rótulo mostra a adquirente e a forma de recebimento, por exemplo **GETNET Débito**, e a bandeira quando o arquivo traz uma (**GETNET Débito · Visa**). Se o arquivo não identifica uma única adquirente, aparece "Cartão de Débito · prestação".
- Os totais não mudam; só o texto. Com o recurso desligado, os rótulos antigos permanecem.

**2 · Módulo Contábil: partidas dobradas redesenhadas**
- Cada linha mostra **[Código] - [Nome da conta]** na primeira coluna; o nome repetido depois do valor foi removido.
- **Débito** e **Crédito** por extenso, em selo (badge) destacado, no lançamento, na lista de lançamentos e no Livro Diário. No Razão e no Balancete, o saldo aparece como Devedor/Credor.
- Cores por grupo contábil (selos e indicadores): **verde** Ativo (grupo 1), **vermelho** Passivo (grupo 2), **azul** Patrimônio Líquido (grupo 3), **laranja** Resultado/DRE (grupos 4, 5 e 6). Indicadores usam #059669, #DC2626, #2563EB e #EA580C no tema claro e #10B981, #EF4444, #3B82F6 e #F97316 nos temas escuros; o texto dos selos usa tons ajustados para contraste mínimo de 4,5:1 (WCAG AA) em todos os temas.
- Layout responsivo (980 e 760 px, e celular), sem rolagem horizontal, com regras de impressão no CSS.

**3 · Módulo Contábil › aba "Biblioteca CPC & Regras Fiscais"**
- Busca por palavra-chave (sem diferenciar acentos) e filtro por categoria (Contábil, Fiscal, Todos), com contador de resultados; com até 3 resultados os cartões abrem sozinhos.
- Oito cartões expansíveis com resumos práticos para varejo de calçados e lojas: **CPC 00** (estrutura conceitual, débito/crédito, ativo/passivo), **CPC 06 (R2)** (aluguéis de lojas em shopping e rua), **CPC 16** (estoques e custo de aquisição), **CPC 27** (imobilizado, benfeitorias em lojas alugadas e depreciação) e o **Guia Fiscal Varejo** (consumidor final × contribuinte, ICMS-ST, PIS/COFINS e tabela rápida de CFOPs de entrada e saída).
- Conteúdo **orientativo**, com data de revisão (novembro de 2026); não substitui a análise do contador. Pontos de atenção do conteúdo: calçados (NCM 64) **não** são monofásicos de PIS/COFINS; o ICMS-ST de calçados depende do estado; a Reforma Tributária (EC 132/2023 e LC 214/2025) tem calendário de transição (CBS/IBS de teste em 2026, PIS/COFINS dando lugar à CBS em 2027, ICMS/ISS dando lugar ao IBS de 2029 a 2032); empresas sob a NBC TG 1000 / ITG 1000 não aplicam o CPC 06 (R2).
- Só aparece dentro do painel (iframe embutido); o Módulo Contábil aberto sozinho trata o recurso como desligado.

**Como o recurso é lido.** O FCX e o Módulo Contábil (que rodam em iframe) consultam `window.parent.Recursos.ativo('gestao_v1396')`; sem o painel pai, ficam no comportamento antigo.

**Testes:** `test1396.js` (Recebível no painel e no FCX, com recurso ligado e desligado, mais as guardas da Regra de Ouro) e `test1396c.js` (Contábil com o servidor Netlify: partidas, cores, selos, Biblioteca, contraste, 5 larguras de tela). Todos os dados de teste são fictícios.

## v13.97 · Consolidado de Entradas reestruturado: PIX real, Crédito e Débito por adquirente e Resumo por Adquirente (recurso `gestao_v1397`)

Tudo fica atrás do recurso `gestao_v1397`: ativo na Homologação; Produção e Falco só depois de **Liberar Versão em Produção**. Desligado, o quadro fica exatamente como na v13.96.
**Não há migração nova, função nova nem variável de ambiente nova.** Para atualizar, descompacte o ZIP na raiz do projeto e envie pelo GitHub Desktop (mudam só `public/index.html`, `public/fcx.html` e este README).
O quadro **Consolidado de Entradas (Vendas + Prestações)** vale no painel (tela inicial › Resumo do Recebível do Dia) e no FCX (Recebível Diário). Os dois usam o mesmo cálculo, então mostram os mesmos números e a mesma estrutura.

**1 · Estrutura** (colunas Meio de pagamento | Vendas | Prestação | Total | Part.)
- **Total em Dinheiro**: como era.
- **Total em PIX**: o valor real do dia nas duas colunas. Vendas: o valor digitado no Recebível Diário; se nada foi digitado, o PIX do dia no **histórico de vendas do FCX** (com aviso da origem). Um R$ 0,00 digitado de propósito é respeitado. Prestação: o PIX da Conciliação dos recebimentos (Retaguarda). Desligado, o histórico não entra.
- **Total Cartões de Crédito** (linha de soma e detalhamento): Credsystem (Cartão da Loja; entra só no dia do vencimento), Getnet - Crédito e Safra - Crédito (já líquidos de MDR, antecipação e POS, como antes).
- **Total Cartões de Débito** (linha de soma e detalhamento): Getnet - Débito e Safra - Débito, com as vendas na coluna Vendas e as prestações na coluna Prestação, na mesma linha. Outra adquirente que apareça no fechamento ganha as próprias linhas de Crédito e Débito.
- **Total Geral de Entradas do Dia**: igual ao de antes. A v13.97 só reparte o que já entrava no cartão; o total do dia não muda (salvo o PIX, quando o histórico do FCX é usado).
- Os grupos Crédito e Débito têm um botão ▾/▸ para recolher e mostrar o detalhamento (começa aberto). Na impressão e no PDF o relatório sai sempre aberto e sem os botões.

**2 · Resumo por Adquirente** (logo abaixo da tabela): Getnet, SafraPay (Safra) e Credsystem (Cartão da Loja), com Débito (vendas + prestação), Crédito, Total e Part., e o total em cartões. A Credsystem fica na coluna Crédito, como na tabela principal.

**3 · Regras de consolidação**
- O identificador `LOTE` do arquivo de cartões do ERP continua sendo só a marca interna de "prestação": ele nunca aparece para o usuário e o valor vai para o Débito da adquirente que o recebeu (Getnet ou Safra), na coluna Prestação.
- A adquirente de cada prestação vem do fechamento da Auditoria de Adquirentes (Conciliação e Cruzamento › Gravar). Se esse fechamento e a Conciliação dos recebimentos não fecham, o valor da Conciliação é repartido na proporção do fechamento e aparece um aviso. Se o fechamento não identifica a adquirente: com uma só adquirente com débito, ela recebe o valor; com mais de uma, aparece a linha "Débito · adquirente não identificada" (e um aviso), sem chutar.
- Débito × Crédito vem da operação gravada no fechamento. Fechamentos gravados antes da v13.87, sem separar débito e crédito, entram em Crédito, com aviso para regravar o Cruzamento.
- No FCX, a prestação continua pelo líquido de MDR (como na v13.87); no painel, pelo valor bruto da Conciliação.
- O rótulo da Credsystem é "Credsystem (Cartão da Loja)", sem o nome da empresa, para o FCX continuar neutro na marca.

**4 · Impressão (A4 paisagem):** a capa continua em uma página. No quadro novo o gráfico "Entradas × Saídas" passa para a coluna das Saídas, e as linhas ficam um pouco mais compactas.

**Como o recurso é lido.** O FCX consulta `window.parent.Recursos.ativo('gestao_v1397')` e usa as funções `PainelFCX.consolidado1397`, `pixReal1397` e `pixDoHistorico1397` do painel; sem o painel pai (FCX aberto sozinho), ele fica no comportamento antigo.

**Testes:** `test1397.js` (38 verificações: estrutura, ordem e valores do quadro no FCX e no painel; Resumo; recolher/mostrar; Credsystem do dia; PIX digitado × histórico × zero; prestação por adquirente, proporcional, sem adquirente e com bandeira "LOTE"; recurso desligado; impressão em A4 com o mesmo número de páginas; celular sem rolagem lateral e com o botão de recolher; guardas da Regra de Ouro, incluindo o patch reverso do FCX). Os testes antigos de Recebível (1382, 1383, 1387 e 1396) passam a rodar com os recursos novos desligados, e os guardas do FCX comparam com `fcx_v1397.html`. Todos os dados de teste são fictícios.

## v13.98 · PIX do Consolidado de Entradas pela entrada prevista do dia e blocos de cartão sem linhas de PIX (recurso `gestao_v1398`)

Tudo fica atrás do recurso `gestao_v1398`: ativo na Homologação; Produção e Falco só depois de **Liberar Versão em Produção**. Desligado, o quadro fica exatamente como na v13.97. O recurso depende da estrutura nova da v13.97 (`gestao_v1397`): se ela estiver desligada, a v13.98 também não age.
**Não há migração nova, função nova nem variável de ambiente nova.** Para atualizar, descompacte o ZIP na raiz do projeto e envie pelo GitHub Desktop (mudam só `public/index.html`, `public/fcx.html` e este README).
Vale no painel (tela inicial › Resumo do Recebível do Dia) e no FCX (Recebível Diário), com o mesmo motor (`PainelFCX.pixPrevisto1398`, `cartaoSemPix1398` e `consolidado1398`).

**1 · PIX = entrada prevista do dia do relatório (D0).** O PIX liquida no próprio dia (prazo 0), então a linha **Total em PIX (Entrada Prevista)** projeta o dia do relatório e **não lê mais as vendas em PIX do dia anterior**.
- **Vendas** = Vendas Previstas do dia em R$ × % do PIX nos Meios de Pagamento do mês. Vendas Previstas do dia = Peso do dia (Parâmetro 2) × Meta de Caixa do mês (Parâmetro 1, já com o redutor), a mesma conta do FCX.
- **Prestação** = Vendas Previstas do dia × % de Impacto da Prestação no Caixa (Parâmetro 3) × % do PIX na distribuição da prestação do dia (Parâmetro 3).
- Exemplo: vendas previstas R$ 100,00 com 10% de PIX = R$ 10,00; prestação de 10% (R$ 10,00) com 20% em PIX = R$ 2,00; o PIX do dia é R$ 12,00.
- Os valores são brutos, como na fórmula (sem a taxa do PIX). Dia com peso zero (por exemplo domingo) dá R$ 0,00 sem aviso. Sem Meta de Caixa, sem pesos dos dias ou sem Meios de Pagamento do mês, o PIX fica em R$ 0,00 e um aviso diz qual parâmetro falta.
- O PIX digitado em Vendas (D-1), o PIX do histórico de vendas do FCX (v13.97) e o PIX da Conciliação dos recebimentos **deixam de ser somados**; uma nota abaixo do quadro avisa. No FCX o campo de PIX do formulário vira somente leitura ("PIX · entrada prevista de <dia>") e só o Dinheiro continua sendo digitado; no painel o aviso de "digitar" pede só o Dinheiro.
- Dinheiro, cartões, prestação em Dinheiro e prestação no Débito continuam como na v13.97 (D-1 e Conciliação). No cartão "Entradas do dia" o **Previsto FCX** passa a usar o PIX previsto de hoje.

**2 · Sem "Pix - Crédito" e "Pix - Débito" nos blocos de cartão.** Essas linhas vinham do fechamento de cartão: a prestação paga em PIX aparecia como uma adquirente chamada "PIX" (e ainda puxava parte da prestação do Débito da Getnet ou da Safra), e operações Pix dentro do arquivo da adquirente caíam no Crédito. Agora o motor tira do cartão a adquirente "PIX" (ou "PIX - POS") e as operações com modalidade Pix de qualquer adquirente, antes de montar o quadro. Total Cartões de Crédito e de Débito só têm credenciadoras (Credsystem, Getnet, Safra e as que aparecerem), e o PIX só existe na linha Total em PIX (Entrada Prevista). O valor retirado do cartão sai do total (não soma duas vezes) e um aviso mostra quanto foi. O mesmo vale na página do cartão do FCX.

**3 · Impressão (A4 paisagem):** a capa continua do mesmo tamanho; o PIX previsto e o PIX digitado não geram aviso diário na capa (a explicação fica numa nota do quadro).

**Como o recurso é lido.** O FCX consulta `window.parent.Recursos.ativo('gestao_v1398')`; sem o painel pai (FCX aberto sozinho), fica no comportamento da v13.97. Os parâmetros (Meta, pesos, meios de pagamento e prestação por modalidade) são os do próprio FCX (`esp2:monthMeta`, `esp2:weightsByMonth`, `esp2:monthParams`, `esp2:prestacaoModalidadePct`); o painel os lê do armazenamento do FCX.

**Testes:** `test1398.js` (41 verificações: o exemplo do pedido, redutor, peso zero, parâmetro faltando, percentuais diferentes, linhas Pix - Crédito/Débito fora dos blocos de cartão com a prova do defeito na v13.97, totais sem somar duas vezes, painel e FCX iguais, recurso desligado, PDF, celular e guardas da Regra de Ouro com o patch reverso do FCX). Os testes de 1388, 1389, 1390, 1393 e 1394 passam a comparar o FCX com `fcx_v1398.html`; 1396 e 1397 desfazem o patch em cadeia (v13.98, v13.97 e v13.96) e o 1397 roda com o recurso novo desligado; o smoke espera 39 atualizações (v13.65 a v13.98). Todos os dados de teste são fictícios.


## v13.99 · Popup universal de crítica de carga e ordenação com relatórios nas tabelas (recurso `gestao_v1399`)

Tudo fica atrás do recurso `gestao_v1399`: ativo na Homologação; Produção e Falco só depois de **Liberar Versão em Produção**. Desligado, o painel, o FCX e o Módulo Contábil ficam exatamente como na v13.98.
**Não há migração nova, função nova nem variável de ambiente nova.** Para atualizar, descompacte o ZIP na raiz do projeto e envie pelo GitHub Desktop (mudam só `public/index.html`, `public/fcx.html`, `public/contabilidade.html`, `public/contabilidade_v1391.html` e este README).

**1 · Popup de crítica de toda carga de arquivo.** Ao terminar de ler qualquer arquivo, abre na hora uma janela com o resultado da operação:
- **Ícone em destaque:** verde (carga concluída), amarelo (concluída com alertas: houve linha ignorada, repetida ou inválida) ou vermelho (carga não concluída, com o motivo em linguagem simples).
- **Resumo da carga:** nome e tamanho do arquivo (ou de cada arquivo), data e hora da operação, linhas lidas, registros processados, ignorados, repetidos, inválidos e o valor total consolidado quando existe (vendas brutas, créditos, saídas, orçamento, folha…), mais os campos próprios de cada tela.
- **Detalhe das inconsistências:** cada item ignorado, repetido ou inválido aparece numa lista com barra de rolagem, com o tipo, a linha do arquivo e o motivo.
- **Botões:** **Copiar Relatório de Carga** (texto pronto para colar em e-mail ou chamado) e **Fechar**. Sem CPF, CNPJ ou dados de cliente na janela: a lista mostra a linha e o motivo, não a pessoa.
- **Onde vale:** ERP (Vendas Consolidadas) e arquivos de adquirentes/LOTE da Auditoria de Adquirentes; Conciliação de Meios de Pagamento (ERP, adquirente, Getnet, OFX e lançamentos); DFC (extratos OFX); Credsystem (relatório diário e metas); Faltas de Caixa (lote) e Base de caixas; Lojas (BASECADASTRO e custos de ocupação); Planejamento Econômico (realizado e vendas); RH (Base Ativa, Folha de pagamento e parametrizações por CSV); Viagens (solicitação por planilha e prestação de contas de Adiantamentos); Backup (leitura e restauração); anexos de PDF e imagem; **FCX** (vendas históricas, pesos por dia, saídas, orçamento e backup) e **Módulo Contábil** (Importar contas do FCX). O FCX e o Módulo Contábil, que rodam dentro do painel, usam a mesma janela do painel; abertos sozinhos continuam como antes.
- **Onde fica a decisão:** a janela só informa. Quem decide continua sendo a tela de cada importação (prévia, confirmação, gravação); a janela de crítica abre por cima e a prévia continua por baixo.

**2 · Ordenação por clique no cabeçalho e "Gerar Relatório / Exportar".** Vale nas tabelas simples do painel. Retaguarda Financeira: Vendas como Consumidor, Faltas de Caixa, Conta Cofre, Depósito de Valores, Ocorrências Globais, Pendências Credsystem e IEO · Ranking. Demais módulos: Início (Resumo do Recebível), Gestão de Lojas, Planejamento Econômico, RH (Colaboradores), Credsystem (Metas), Acessos e Auditoria, todos conferidos no navegador. Pessoal, Viagens, Parceiros, Solicitações, Contratos e Conciliação seguem a mesma regra automática (qualquer tabela simples ganha a barra), mas não tinham dados no ambiente de teste e não foram conferidos tela a tela. A barra também aparece em listas que o módulo redesenha só no corpo (busca e filtro da Gestão de Lojas, por exemplo), mantendo a ordem escolhida.
- **Ordenação:** o título de cada coluna vira botão. Cada clique alterna **crescente (▲)** e **decrescente (▼)**, com a seta no cabeçalho (acessível pelo teclado: Tab e Enter). A coluna é reconhecida como data, número ou texto: período e datas ordenam como data, "R$ 1.234,56" e "12,5%" ordenam como número, o resto em ordem alfabética (acentos e maiúsculas não atrapalham). Célula vazia ("—") vai sempre para o fim. Linha de detalhe acompanha a linha de cima e a linha "Total…" fica no fim. A ordem escolhida continua quando a tela é redesenhada. No celular, a barra acima da tabela traz o seletor **Ordenar por** e o botão ▲/▼.
- **Gerar Relatório / Exportar** (botão no topo da tabela): leva os dados **como estão na tela** (filtros aplicados e ordem atual) em dois formatos. **PDF A4:** cabeçalho com a marca e o título da tela, quantidade de registros, **Filtros aplicados**, **Ordenação** e a tabela (A4 paisagem quando há mais de 6 colunas), com pré-visualização e os botões Imprimir e Baixar PDF. **CSV / Excel:** separador ";" e acentos corretos no Excel (UTF-8 com marca de ordem de bytes), uma coluna por título, números sem "R$" e "%" para somar e filtrar na planilha (a unidade vai no título da coluna, por exemplo "Valor (R$)").
- **Fora desta versão:** matrizes e tabelas de parâmetros, grades de edição, tabelas dentro de janelas, as tabelas paginadas (Contratos, projeção de ocupação, exceções de Adquirentes) e as telas internas do FCX e do Módulo Contábil (que têm seus próprios relatórios) não ganham a barra.

**Como o recurso é lido.** O painel usa `Recursos.ativo('gestao_v1399')`; o FCX consulta `window.parent.Recursos.ativo('gestao_v1399')` e o Módulo Contábil faz o mesmo. Sem o painel pai (FCX ou Contábil abertos sozinhos), ficam no comportamento da v13.98.

**Testes:** `test1399.js` (101 verificações: o popup em si — verde, amarelo e vermelho, copiar, fechar, rolagem, tema escuro e celular —, cada importação com arquivos fictícios (Credsystem, Faltas, Caixas, Ocupação, Planejamento, Backup, ERP, adquirentes, OFX, RH, Folha, Metas, Viagens, Conciliação, FCX e anexos), ordenação de todas as colunas da aba Vendas como Consumidor e de Faltas, Cofre, Depósitos, Ocorrências, Pendências, IEO e Gestão de Lojas (inclusive busca e filtro redesenhando só o corpo), persistência da ordem, teclado, exportação em CSV e PDF A4 com filtro e ordem, linhas de detalhe e total, celular, recurso desligado e guardas da Regra de Ouro) e `test1399c.js` (3 verificações do Módulo Contábil com o servidor local e o Postgres). Os testes antigos passam a rodar com o recurso novo desligado (é o que prova que nada mudou) e os que comparam o FCX e o Contábil desfazem primeiro as trocas da v13.99; o smoke espera 40 atualizações (v13.65 a v13.99). Todos os dados de teste são fictícios.

## v14.00 · Central de Notificações: alertas automáticos por e-mail e WhatsApp (recurso `gestao_v1400`)

Tudo fica atrás do recurso `gestao_v1400`: ativo na Homologação; Produção e Falco só depois de **Liberar Versão em Produção**. Desligado, a tela some do menu, o painel não faz nenhuma chamada nova e o servidor responde `403 recurso_desligado`: o painel, o FCX e o Módulo Contábil ficam exatamente como na v13.99.
**Esta versão muda o backend:** 1 migração aditiva, 2 funções novas, 7 módulos novos em `netlify/lib` e **4 variáveis de ambiente** (a lista está abaixo). Para atualizar, descompacte o ZIP na raiz do projeto e envie pelo GitHub Desktop; o build do Netlify aplica a migração sozinho (`node scripts/run-migrations.mjs`). O FCX e o Módulo Contábil não mudaram.

**Regra de ouro das notificações: faltar chave não trava nada.** Sem as variáveis de ambiente o painel continua igual; a Central mostra "Não configurado" com o **nome** das variáveis que faltam, o teste e o envio automático registram uma linha de **Erro · Configuração** no log com o aviso em português, e o cron simplesmente segue. As regras nascem **todas desligadas**: nada é enviado até o Master ligar.

**1 · Variáveis de ambiente do Netlify** (cada site, ou seja, cada ambiente, tem as suas; nunca vão para o painel, o log ou o ZIP):

| Variável | Para quê |
|---|---|
| `NOTIFICACAO_EMAIL_API_KEY` | Chave da API de e-mail (padrão: Resend, `Authorization: Bearer`). |
| `NOTIFICACAO_EMAIL_FROM` | Remetente, ex.: `Painel de Gestão <alertas@seudominio.com.br>` (domínio verificado no provedor). |
| `NOTIFICACAO_WHATSAPP_ENDPOINT` | URL `https://` completa do envio de texto do provedor de WhatsApp. |
| `NOTIFICACAO_WHATSAPP_TOKEN` | Token/chave do provedor de WhatsApp. |
| `NOTIFICACAO_EMAIL_ENDPOINT` (opcional) | Troca o endereço da API de e-mail (outro provedor REST compatível). Padrão: `https://api.resend.com/emails`. |
| `NOTIFICACAO_WHATSAPP_PROVEDOR` (opcional) | Força `evolution`, `zapi`, `meta` ou `generico` quando a URL não deixa claro. |

O provedor de WhatsApp é reconhecido pela URL: **Evolution API** (`/message/sendText/<instância>`, cabeçalho `apikey`), **Z-API** (`z-api.io`, cabeçalho `Client-Token`), **Meta Cloud API** (`graph.facebook.com`, `Authorization: Bearer`) ou **genérico** (POST JSON com `number`, `phone`, `to`, `text` e `message`, cabeçalhos `Authorization: Bearer` e `apikey`). Endereço que não seja `https://` (exceto localhost, para testes) é recusado. **Meta Cloud API:** texto livre só chega a quem falou com o número nas últimas 24 h; fora dessa janela a Meta exige mensagem de modelo (template) aprovada, e a Central mostra o erro devolvido pelo provedor.

**2 · Banco (migração aditiva `20261112120000_esquema_notificacoes.sql`):**
- `painel_notificacoes_regras` (id, `evento_chave` único, `canal` EMAIL/WHATSAPP/AMBOS, `ativo`, `destinatarios_json`, `parametros_json`, `frequencia`, `ultimo_envio`, mais `ultima_rodada_em`, resumo da rodada e quem alterou).
- `painel_notificacoes_log` (id, `data_hora`, `canal`, `evento_chave`, `destinatario`, `titulo`, `payload_mensagem`, `status` SUCESSO/ERRO, `detalhe_erro`, mais `referencia` (evita envio em dobro), `teste`, `tentativa`, `reenvio_de`). Guarda 120 dias.
- `painel_notificacoes_instantaneo`: o último Resumo do Recebível publicado pelo painel (usado pelo Relatório matinal executivo).
- Só cria tabelas e índices; não mexe em nada existente (o teste de migrações agora confere 9 arquivos, 4 aditivos).

**3 · Funções:**
- `netlify/functions/notificar.mjs` · `/api/notificar` (só o Master): `estado`, `salvar-regra`, `testar`, `logs`, `log` (detalhe), `reenviar` e `instantaneo` (recebe o snapshot do painel). Exige o cabeçalho do painel (CSRF) e o recurso ligado.
- `netlify/functions/notificacoes-agendadas.mjs`: cron `*/5 * * * *` (UTC; a lógica compara no horário de Brasília). Cada rodada: trava (advisory lock) para não rodar duas ao mesmo tempo, avalia as regras ligadas, **janela de 3 horas** depois do horário marcado (se o cron atrasar, ainda envia no mesmo dia), no máximo **60 envios** e **24 s** por rodada (o limite do Netlify é 30 s; o resto fica para a próxima), cada envio é registrado antes de contar como feito (nunca duplica: mesmo evento + referência + canal + destinatário). Falha de rede, 429 ou 5xx tenta de novo até 3 vezes, de 15 em 15 minutos; erro de configuração, destino inválido ou recusa do provedor não repete (aparece no log com o motivo). Só roda no deploy publicado (limite do Netlify para funções agendadas).
- E-mail: HTML limpo (marca, título, tabela de dados, rodapé "Painel de Gestão"), com **PDF A4 anexado** quando o evento tem PDF (gerado no servidor, sem biblioteca externa). Na Homologação o assunto ganha "[Homologação]"; nos testes, "[TESTE]".

**4 · Eventos (9, todos desligados de início):**
- **Adiantamentos de Viagens:** *Lembrete de prestação de contas* (todo dia 09:00; 3 e 1 dia antes do prazo; ao colaborador, e-mail e/ou WhatsApp do cadastro) e *Prazo excedido · prestação pendente* (08:00; quando a viagem vira "PRAZO EXCEDIDO - PRESTAÇÃO PENDENTE": alerta ao colaborador e **resumo à Tesouraria/Financeiro**, só com as viagens ainda não resumidas).
- **Relatório IEO por Gerente Regional:** segunda-feira 08:00; cada Gerente Regional recebe **só os indicadores das lojas da sua regional**, e-mail com **PDF A4** e resumo no WhatsApp. É o mês corrente até a data (na primeira semana do mês, acrescenta o fechamento do mês anterior). Os valores seguem a mesma conta do IEO da tela (conferido no teste contra o código do painel). Regional sem Gerente cadastrado vai só para a cópia (e aparece como Erro · Destino no log).
- **Solicitações Operacionais:** resumo matinal 08:30 para os gestores de controle de loja com as solicitações pendentes acima do SLA (só envia se houver).
- **Relatório matinal executivo (Diretoria/Master):** 07:30; WhatsApp com texto resumido e e-mail com **PDF consolidado**: entradas do dia anterior (vendas + prestações por adquirente), saldo de caixa, faltas de caixa e pendências da Retaguarda.
- **RH:** *Risco de dobra de férias* (60 e 30 dias antes do vencimento do 2º período aquisitivo, para RH e loja) e *Aviso de início de férias* (5 dias antes, ao colaborador).
- **Tesouraria:** *Falta de caixa acima da tolerância*: WhatsApp na hora (verificado a cada 5 min; cada falta é avisada uma vez).
- **TI/Master:** *Confirmação diária do Backup na Nuvem* (07:00): confirma o ponto de restauração da noite (23:59) ou avisa que não foi criado.

**5 · Central de Notificações (Sistema & Segurança, só o Master real; não aparece na simulação de perfil):**
- **Painel de Regras:** faixa de status (E-mail e WhatsApp configurados ou não, envios dos últimos 7 dias, "Como configurar"), um cartão por evento com **liga/desliga**, **Configurar** (canal E-mail, WhatsApp ou Ambos, horário e parâmetros do evento, destinatários automáticos como o colaborador ou o Gerente Regional, destinatários fixos com nome, e-mail e WhatsApp), **Salvar / Descartar alterações** (o rascunho não se perde ao recolher o cartão) e **Testar Disparo** (manda um exemplo marcado como teste para o e-mail/telefone digitado ou para os destinatários salvos; máximo 20 testes por hora).
- **Auditoria de Logs:** tabela dos últimos envios (data e hora, evento, canal, destinatário **mascarado**, mensagem, status) com filtros de status, canal, evento, testes, período e busca; 50 por página com **Carregar mais**; **Detalhes** (motivo do erro, conteúdo enviado, anexos) e **Reenviar Notificação** (com confirmação; grava uma linha nova ligada à original).
- Ligar, salvar, testar e reenviar entram na **Auditoria** do painel só com contagens (sem e-mail, telefone ou chave).

**6 · Resumo do Recebível para o relatório executivo.** O motor do FCX roda só no navegador; por isso o painel, ao calcular o Resumo do Recebível do dia (e a cada 20 minutos quando há alteração), publica o resultado já agregado em `/api/notificar` (`instantaneo`). O relatório matinal usa o instantâneo **de hoje**; se o painel ainda não foi aberto hoje, usa o último publicado e **avisa no próprio relatório** de quando é ("Os valores de entradas e saldo vêm do Resumo do Recebível calculado em …"); se nunca foi publicado, as entradas e o saldo saem vazios com a explicação. Para os números do dia aparecerem às 07:30, o painel (Master ou quem usa o FCX) precisa ter sido aberto antes, e o dinheiro/PIX do dia anterior digitado no FCX (senão entra como R$ 0,00, com aviso). Os instantâneos com mais de 30 dias são apagados.

**7 · Suposições assumidas** (ajustáveis na Central): "falta acima da tolerância" = mais de **10%** das vendas em dinheiro do dia da loja (Credsystem); sem base de comparação, a partir de **R$ 100,00**; janela de 3 dias; "imediato" = até 5 minutos.

**Testes (dados fictícios):** `tests/teste-notificacoes.mjs` **134** (esquema, provedores falsos, PDF, mensagens, paridade do IEO com o painel, cada evento, repetição, limite de tempo, trava, API e permissões, função agendada, segredos); `tests/teste-migracoes.mjs` **43**; `test1400.js` **50** (tela: recurso desligado, menu, 9 cartões, ligar/desligar, configurar e validar, Testar Disparo, logs com filtros, paginação, detalhes e reenvio, servidor **sem chaves**, Resumo do Recebível, celular e escuro). Testes antigos rodam com o recurso novo desligado (`qa_login.js`).

**Regra de Ouro:** região `ADQ_CFG` → `CS_INDICADORES` idêntica à v13.82; OFX/DFC da v13.74.2 intactos; `buildCashBook`/`buildAggregated`/`drawChart` do FCX idênticos à v13.77; `fcx.html`, `contabilidade.html` e `contabilidade_v1391.html` **iguais aos da v13.99**.

**Segurança:** a chave entre ambientes (`PAINEL_CHAVE_AMBIENTES`) deve ser trocada (rotacionada) por quem a divulgou; as chaves de e-mail e WhatsApp ficam só nas variáveis do Netlify; o painel nunca mostra a chave (erros do provedor saem com `***`).

## v14.01 · Correção do Backup: sem o modal "Backup diário obrigatório" quando os pontos de restauração na nuvem estão ativos

**Mudança só no front-end e nos testes: sem migração, função, biblioteca nem variável de ambiente nova.** Para atualizar, descompacte o ZIP na raiz do projeto e envie pelo GitHub Desktop (mudam `public/index.html`, este README e o teste novo `tests/teste-backup-modal.mjs`; `public/fcx.html`, `public/contabilidade.html`, `public/contabilidade_v1391.html` e todo o backend ficam iguais aos da v14.00).

**O defeito.** A trava da v13.64 ("Backup diário obrigatório", tela cheia, exige baixar um .json antes de liberar o painel) nunca consultava o recurso `backup_nuvem_v1395`: ela só era desligada por uma variável de teste (`__QA_SEM_TRAVA_BACKUP`). Por isso, mesmo com os pontos de restauração na nuvem funcionando, o modal continuava abrindo no primeiro acesso do dia, e os testes não pegavam o problema (o test1395 rodava com a trava desligada).

**1 · Modal suprimido.** Com o recurso `backup_nuvem_v1395` ativo **e** o banco Postgres do Netlify conectado, o painel não abre mais o modal "Backup diário obrigatório" (Master) nem o "Painel bloqueado" (demais perfis: Operacional, Loja…) e não bloqueia clique, teclado nem rolagem. Detalhes que evitam o "piscar" do modal:
- Em Produção e Falco os recursos liberados vêm do banco (`config/recursos`); enquanto essa lista não chegou o painel **não decide nada** (se não vier em cerca de 20 s, vale a regra antiga, para a proteção nunca depender da rede de recursos). Na Homologação o recurso é sempre ativo e a resposta é imediata.
- O painel também espera a primeira leitura do estado do dia (`sistema/backup_diario`) antes de decidir.
- Liberar o recurso com o modal aberto **fecha** o modal na hora (no máximo 1 minuto, na próxima verificação); desligar o recurso reabre a trava antiga: é reversível.
- **Sem a nuvem a trava continua como era:** no artefato do claude.ai (sem o banco do Netlify) e em ambientes em que o recurso ainda não foi liberado (Produção/Falco antes de "Liberar Versão em Produção") nada muda, porque nesses casos não existe ponto de restauração na nuvem e o .json diário é a única proteção.

**2 · Fluxo automático na nuvem (só em segundo plano).** Ficam apenas o ponto `PRIMEIRO_ACESSO` (o painel chama `POST /api/backup-nuvem` com `verificar-primeiro-acesso` logo depois do login, qualquer perfil, uma vez por abertura do painel; o servidor só cria se ainda não houver ponto no dia) e o agendamento das 23:59 de Brasília. Se a chamada falhar por instabilidade de rede (ou o servidor responder erro), o painel **só registra um aviso no console** ("ponto de restauração do primeiro acesso não criado agora: …"), não mostra nada na tela e não trava. Como a chamada é idempotente, há **uma nova tentativa depois de 1 minuto** (e outra na próxima abertura do painel).

**3 · O .json fica só na Contingência.** Em Backup e dados, com a nuvem ativa, o único botão "Baixar backup completo" (.json) e a restauração de arquivo ficam no bloco recolhido **Contingência** (abre por clique). O arquivo continua contando como o backup do dia (`sistema/backup_diario`).

**Versão no painel.** A lista de recursos ganhou o marcador `backup_corr_v1401` (v14.01), só para o selo de versão e a lista de "Liberar Versão em Produção"; a trava **não** depende dele: vale sempre que `backup_nuvem_v1395` estiver ativo com o banco do Netlify.

**Como conferir:** entre como Master, Operacional e Loja num ambiente com o recurso ativo: nenhum modal aparece e o painel abre direto; em Backup e dados, abra "Contingência" para o .json. Na aba Backup, a lista de pontos mostra o "1º Acesso" do dia.

**Testes (dados fictícios):** `tests/teste-backup-modal.mjs` **24** (sem navegador nem banco: roda a trava e o primeiro acesso extraídos do `public/index.html`: nuvem ativa nunca abre, sem nuvem abre, liberar/desligar ao vivo, espera da lista de recursos, falha de rede só no console com 1 nova tentativa, .json só na Contingência); `test1401.js` **22** (tela, com a trava de verdade e o Postgres: recurso desligado = modal e "Painel bloqueado" como antes; ligado = nunca aparece, nem por um instante, para Master, Operacional e Loja; liberar/desligar ao vivo; ponto PRIMEIRO_ACESSO; rede caída e erro 500; Contingência baixa o .json e conta como backup do dia); `test1395.js` **28** (agora com a trava de verdade nas abas com o recurso ativo); regressão das versões anteriores sem alteração (smoke ajustado: 42 atualizações, v13.65 a v14.01).

**Regra de Ouro:** região `ADQ_CFG` → `CS_INDICADORES` idêntica à v13.82; OFX/DFC da v13.74.2 intactos; `buildCashBook`/`buildAggregated`/`drawChart` do FCX idênticos à v13.77; `fcx.html`, `contabilidade.html` e `contabilidade_v1391.html` iguais aos da v14.00; backend inalterado.

**Segurança:** a chave entre ambientes (`PAINEL_CHAVE_AMBIENTES`) deve ser trocada (rotacionada) por quem a divulgou; este pacote não contém segredos.

## v14.02 · Recebíveis em accordion no celular, aprovação de pagamentos das Saídas do Dia e revisão estrita das permissões (recurso `gestao_v1402`)

Tudo novo fica atrás do recurso `gestao_v1402`: ativo na Homologação; Produção e Falco só depois de **Liberar Versão em Produção**. Desligado, a Tela Inicial é a da v14.01 (2 blocos, sem checkboxes), o painel não faz nenhuma chamada nova, as duas permissões novas não aparecem na Gestão de Acessos e o servidor responde `403 recurso_desligado` em `/api/aprovacoes-saidas`.
**Esta versão muda o backend:** 1 migração aditiva (`20261113120000_esquema_aprovacoes_saidas.sql`), 1 função nova (`netlify/functions/aprovacoes-saidas.mjs`, rota `/api/aprovacoes-saidas`), 1 biblioteca nova (`netlify/lib/saidas-aprovacoes.mjs`) e ajustes em `permissoes.mjs`, `matriz-acessos.mjs` (gerado do painel), `migracoes.mjs` / `migracoes-embutidas.mjs`, `notificar.mjs` e nos módulos `notif-*` (10º evento). **Nenhuma variável de ambiente nova.** Para atualizar, descompacte o ZIP na raiz do projeto e envie pelo GitHub Desktop; o build do Netlify aplica a migração sozinho. `public/fcx.html`, `public/contabilidade.html` e `public/contabilidade_v1391.html` **não mudaram** (foram auditados: não havia trava Master de negócio neles).

**1 · Recebíveis em accordion (só celular, largura até 768 px).** Na Tela Inicial › Resumo do Recebível do Dia, os 3 cartões ("Entradas do Dia", "Saídas do Dia", "Saldo do Dia") viram botões (`aria-expanded`) e os blocos detalhados abaixo deles **começam recolhidos**:
- **Entradas do Dia** abre o *Consolidado de Entradas* por modalidade; dentro dele, *Crédito* e *Débito* abrem para mostrar as adquirentes e o *Resumo por Adquirente*.
- **Saídas do Dia** abre a lista de contas/títulos a pagar do dia (com os checkboxes de quem pode autorizar).
- **Saldo do Dia** abre o comparativo **Saldo Previsto Total × Saldo Projetado Pós-Aprovações** (Saldo Projetado = entradas do dia − pagamentos autorizados; muda ao vivo conforme a seleção).
- Acima de 768 px nada muda na disposição: os blocos seguem lado a lado, e o bloco do Saldo aparece em largura total. Girar o aparelho ou redimensionar a janela troca o modo na hora.

**2 · Autorização das Saídas do Dia.** Na lista de títulos (celular e computador, para quem tem a permissão *Autorizar Pagamentos nas Saídas do Dia*; o Master sempre tem):
- Um **checkbox** por título e os botões **Selecionar Todos** / **Limpar seleção**. Nada vem marcado de fábrica; só voltam marcados os títulos que a última aprovação do dia já tinha APROVADO.
- Barra fixa com **Total Previsto | Total Autorizado (R$) | Total Retido (R$)**, recalculada a cada clique. Marcado = APROVADO; desmarcado = RETIDO.
- **Finalizar Aprovações** (com confirmação): grava no banco um *lote* com o status de cada título (APROVADO ou RETIDO), o aprovador (usuário, nome e CPF) e a data/hora. Em seguida avisa o Financeiro e o Master pela Central de Notificações e abre o **Relatório de Pagamentos Aprovados**. Quem não tem a permissão vê a lista só para consulta (se enxerga o FCX).
- **Aprovações já finalizadas hoje** (os 5 últimos lotes: número, hora, aprovador, autorizado, retido e situação do aviso), cada uma com o botão **Relatório** para reabrir o PDF/CSV.

**3 · Relatório de Pagamentos Aprovados.** Gerado na hora a partir do lote gravado: **PDF A4** (cabeçalho padrão dos relatórios do painel, com o dia e o número do lote; lista dos títulos aprovados com fornecedor, conta, forma de pagamento, vencimento e valor; resumo dos **retidos**; totais; e a **assinatura digital do aprovador**: nome, CPF mascarado, data/hora e o selo SHA-256 do conteúdo) e **CSV** (separador `;`, UTF-8 com BOM; uma linha por título aprovado ou retido, com aprovador, CPF mascarado e data/hora, e as linhas de total previsto, autorizado e retido). É assinatura eletrônica simples (identifica o usuário logado e sela o conteúdo); **não** é certificado ICP-Brasil.

**4 · Aviso pela Central de Notificações.** Novo 10º evento **"Pagamentos aprovados nas Saídas do Dia"** (`saidas_aprovadas`, imediato, canal E-mail/WhatsApp/Ambos): avisa o Financeiro (papel configurável na Central), todos os **Masters ativos** (automático, com o contato do cadastro do colaborador) e uma cópia opcional, com o valor total liberado e retido; o e-mail leva o **PDF anexado**. O painel dispara `/api/notificar` (`acao: saidas-aprovadas`) depois de gravar; se o navegador fechar ou a função estiver ocupada, **o cron de 5 minutos reenvia** o lote que ficou sem aviso entre 10 minutos e 6 horas depois. Como todas as regras, **nasce DESLIGADO**: ligue em Central de Notificações e cadastre o Financeiro. A aprovação **nunca falha por causa do aviso** (a tela diz se enviou e, se não, por quê: módulo desligado, regra desligada, sem destinatários, provedor sem configuração). Um Master sem e-mail/telefone no cadastro gera uma linha de ERRO no log (comportamento do motor da v14.00).

**5 · Revisão estrita de permissões.** O painel, o `fcx.html` e as funções foram auditados atrás de travas "só Master" que escondiam negócio de quem tinha a permissão marcada. O que mudou:
- **Flags do perfil mandam.** O acesso ao FCX, a montagem do Resumo do Recebível (que lê o fechamento da conciliação, `conc_fechamento`) e as coleções da Retaguarda e Lojas que só o Master lia (`ret_ocorrencias`, `cred_pendencias`, `alertas`, `seguros_vigencia`) passam a seguir **Ler / Modificar / Excluir** do perfil (`netlify/lib/permissoes.mjs`, `COLECOES_MATRIZ`). Menu, tela e servidor respondem igual.
- **Só o Master real** acessa as áreas técnicas: Banco de dados / Migrações, Backup na Nuvem, Gestão de Ambientes, Central de Notificações e Controle de Acessos (também continuam só do Master: Auditoria, Configurações, PDI, Ponto de Equilíbrio e salários). Nenhuma permissão da matriz as libera.
- **Duas permissões novas** na Gestão de Acessos (aparecem só com o recurso ligado):
  - `recebiveis_aprovar_saidas` · *Autorizar Pagamentos nas Saídas do Dia* (dentro de Visão / Dashboard; exige "Ler" lá): libera os checkboxes, o Selecionar Todos e o Finalizar Aprovações. O perfil **Loja nunca** autoriza pagamentos.
  - `liberacao_gerencial` · *Liberação Gerencial / Aprovação de Exclusões* (linha própria "Gerencial"): o Operacional passa a operar **todos os módulos de negócio habilitados** (Ler, Modificar e Excluir), aprova e executa as exclusões da equipe e as decisões de Liberação Remota (excluir adiantamento pago, zerar o FCX, viagens), e vê a base inteira. **Não abre** banco, backup, ambientes, notificações nem acessos. **Não inclui** *autorizar pagamentos* (marque à parte: separação de funções) **nem salários** (continuam só com "Pode ver salários"). Nunca vale para o perfil Loja e não existe sem a Gestão de Acessos v13.83.

**6 · Banco (migração aditiva `20261113120000_esquema_aprovacoes_saidas.sql`, só `IF NOT EXISTS`):** `painel_saidas_lotes` (um lote por "Finalizar": dia, aprovador com id/nome/CPF, totais, selo SHA-256, chave de idempotência, andamento do aviso) e `painel_saidas_decisoes` (uma linha por título: decisão, cópia do título no momento, aprovador e data/hora). **Nada é apagado**: nova aprovação do mesmo dia cria outro lote e a decisão mais recente de cada título vale. O CPF é gravado inteiro (auditoria) e **só a máscara sai** nas telas, no relatório e nos avisos. O servidor lê fornecedor, conta, forma e valor **do FCX gravado no banco** (o navegador só manda id, status e o valor que viu): se o valor mudou ou o título sumiu, responde `409 fcx_mudou` e a tela manda atualizar. A identidade do título é o conteúdo (data, conta, centro, fornecedor, valor, item, observação e forma), então a decisão sobrevive a uma nova importação do FCX. O teste de migrações agora confere 10 arquivos (5 aditivos). Sem banco do Netlify (artefato do claude.ai) a aprovação não grava: só os sites Netlify a oferecem.

**Rotas:** `GET ?dia=` ou `POST { acao: 'estado', dia }` (quem vê), `{ acao: 'lote', id }` (reabrir o relatório) e `{ acao: 'finalizar', dia, idem, itens: [{ id, status, valor }] }` (Master ou a permissão). `401` sem sessão · `403` sem permissão ou recurso desligado · `409` o FCX mudou · `422` dados inválidos (dia fora de 30 dias atrás a 7 à frente, mais de 1.500 títulos, aprovador sem CPF cadastrado…) · `503 sem_esquema` (rode as migrações). Duplo clique ou nova tentativa com a mesma chave devolve o mesmo lote.

**Versão no painel.** `gestao_v1402` na lista de recursos (selo v14.02 e "Liberar Versão em Produção").

**Testes (dados fictícios):** `test1402.js` **65** (navegador + Postgres: accordion no celular e no desktop, aprovação ponta a ponta, relatório PDF/CSV, aviso com provedores falsos, perfis Master/Diretor/Financeiro/Gerencial/Loja/Operacional, matriz de acessos, recurso desligado); `tests/teste-aprovacoes-saidas.mjs` **43** (servidor com banco: recusas, lote, idempotência, decisão mais recente, nova importação do FCX, gravação em fatias, aviso e cron de resgate); `tests/teste-permissoes-1402.mjs` **31** (sem banco: as duas permissões, elevação Gerencial, o que ela não leva, coleções liberadas pela matriz); `tests/teste-notificacoes.mjs` **134** e `tests/teste-migracoes.mjs` **43** atualizados para o 10º evento e a 10ª migração. Regressão executada nesta versão: `test1401` 22, `test1399c` 3 e `test1398` 41 (o teste passou a abrir o accordion das Entradas no celular antes de medir a rolagem) e `test1400`: 48 de 50 passaram; as 2 que falharam eram só a contagem de 9 eventos (a Central agora tem 10), já ajustada no teste, **sem nova execução**. **Não reexecutados na v14.02:** `test1397` e anteriores, Contábil, Adiantamentos, CNPJ, Backup na Nuvem, Backup modal e a bateria local (`test1399`, smoke…); rode a regressão completa na Homologação antes de "Liberar Versão em Produção". Os testes acharam e corrigiram um erro real: data inválida (ex.: mês 13) no "Finalizar" respondia 500 em vez de 422.

**Regra de Ouro:** região `ADQ_CFG` → `CS_INDICADORES` idêntica à v13.82; OFX/DFC da v13.74.2 intactos; `buildCashBook`/`buildAggregated`/`drawChart` do FCX idênticos à v13.77; `fcx.html`, `contabilidade.html` e `contabilidade_v1391.html` iguais aos da v14.01.

**Segurança:** a chave entre ambientes (`PAINEL_CHAVE_AMBIENTES`) deve ser trocada (rotacionada) por quem a divulgou; este pacote não contém segredos, senhas nem CPFs reais (os testes usam CPFs fictícios).

## v14.02.1 · Correção pontual: Indicadores & KPIs Operacionais (Gestão de Lojas) com o custo da folha

Só o **front-end** (`public/index.html`) e um teste novo. **Nenhuma mudança de backend, banco ou variável de ambiente**; `fcx.html`, `contabilidade.html` e `contabilidade_v1391.html` iguais aos da v14.02.

- **Causa do defeito:** a caixa "Incluir folha de pagamento (salário + encargos)" é um `<input>`. O despachante global de cliques ignora campos de formulário e entrega a mudança pelo evento `change` a `Lojas.mudanca()`, que não tratava `lj-v93-folha` (só `Lojas.acao()` tratava, e nunca era chamada). Agora o `change` guarda o estado e redesenha na hora os cards e a tabela. Esse conserto vale em qualquer ambiente.
- **Vínculo da folha:** a lotação do colaborador e a loja são comparadas pelo número oficial de 2 dígitos (`CodLoja.oficial`): `05` = `5` = `05 - CAMARAGIBE` = `05 · CAMARAGIBE` = `loja-005`. Soma-se o custo real da empresa (salário vigente + encargos patronais) dos colaboradores ativos lotados na filial; desligados e admissões futuras ficam fora. Lotação sem número de loja (ex.: "Matriz") não entra em nenhuma filial.
- **Colunas (recurso `gestao_v14021`):** LOJA | TIPO | M² | FATURAMENTO MÉDIO/MÊS | VENDA POR M² | **CTO (OCUPAÇÃO)** | **CUSTO DA FOLHA** (só com a caixa marcada) | **CUSTO OPERACIONAL/MÊS** (= CTO + folha; desmarcada, = CTO) | **CUSTO POR M²** (= custo operacional ÷ m²) | RESULTADO/MÊS | RESULTADO POR M² | MARGEM (recalculados sobre o custo operacional). Uma única definição (`colunasKpi93`) alimenta a tela, o Imprimir / PDF e o Excel; a barra "Ordenar por / Gerar Relatório / Exportar" lê a tela, então a ordem e o estado da caixa são os mesmos em todas as saídas. O Excel ganhou a aba "Parâmetros" (tipo, regional, folha incluída ou não). A linha REDE soma CTO, folha e custo operacional do mês e fica sempre no fim ao ordenar pelos cabeçalhos (atributo `data-tp-fixa`, novo na tabela universal).
- **Card do topo:** "Custo operacional por m²" mostra **"CTO + folha de pagamento"** com a caixa marcada. Com a folha incluída aparece também a linha "Folha incluída · mês (fonte): N colaboradores em M filiais · salários + encargos".
- **Permissões (decisão):** a folha segue a permissão própria "Pode ver salários" (`rh.ver_salarios`, LGPD) e só entra no custo de quem também vê a ocupação (Módulo 3 · Contratos). Com a permissão, o Master e qualquer perfil com a chave leem a folha consolidada; a revisão da v14.02 **não** zera nem bloqueia isso (o servidor entrega `salarios` e `funcionarios` a quem tem a chave). A **Liberação Gerencial** continua sem salários por desenho. Sem a chave, a caixa não aparece; com a chave e sem Contratos, a caixa fica desabilitada com explicação; com os dados do RH ainda carregando, a tela avisa em vez de somar zero.
- **Sem o recurso `gestao_v14021`** (Produção/Falco antes de "Liberar Versão"): layout de colunas da v14.02, mas a caixa já recalcula (o custo operacional/mês inclui a folha).
- **Testes (dados fictícios):** `tests/teste-kpis-folha-1402-1.mjs` **42** (Node, sem navegador: roda o código real de `public/index.html`; caixa desmarcada × marcada, CTO + Folha = Custo operacional/mês por loja e na REDE, formatos de lotação, ordem das colunas, cards, permissões, recurso desligado) e `test14021.js` **60** no navegador (clique real na caixa, tabela e cards, ordenação por cabeçalho, Excel, PDF, Gerar Relatório / Exportar, permissões; não faz parte do pacote). Regressão rápida: `test1399.js` **101** (tabela universal) e Regra de Ouro. **Não foram reexecutadas** as demais baterias (ver o status do projeto).
- **Uso:** `node tests/teste-kpis-folha-1402-1.mjs` (precisa só do Node; lê `public/index.html`).


## v14.03 · Balanced Scorecard (BSC) & Farol Estratégico (recurso `gestao_v1403`, permissão `bsc_visualizar`)

Só o **front-end** (`public/index.html`), a **matriz de permissões do servidor** (`netlify/lib/matriz-acessos.mjs`, regenerada do painel: entra a linha "BSC") e um teste novo. **Nenhuma mudança de banco, rota ou variável de ambiente**; `fcx.html`, `contabilidade.html` e `contabilidade_v1391.html` iguais aos da v14.02 (Regra de Ouro: bloco do Motor de Aluguel/Adquirentes/DFC, OFX→IEO e motor do FCX idênticos às bases anteriores).

- **Onde fica:** menu lateral, grupo **Financeiro & Caixa** › "Balanced Scorecard (BSC)" (e card **Farol BSC** na Tela Inicial › Indicadores / Cards, que abre a tela). Só aparece com o recurso `gestao_v1403` (na Homologação sempre; em Produção/Falco só depois de "Liberar Versão") e a permissão `bsc_visualizar`.
- **13 indicadores em 4 perspectivas**, cada um com Meta/Previsto, Realizado, Variância (%) e Farol:
  - **Financeira:** Liquidez & Cobertura de Caixa (FCX) · Margem de Contribuição e Ponto de Equilíbrio · Custo de Ocupação Eficiente (aluguel fixo × % sobre vendas) · Perda por Vazamento Financeiro (divergência de MDR/antecipação).
  - **Cliente & Vendas:** Atingimento de Meta (global e por segmento: Esposende Tradicional × ES Sports) · Ativação e Penetração Credsystem · Ticket Médio e Mix de Produtos.
  - **Processos Internos:** Placar Médio do IEO · Aderência à Conciliação de Caixas · Radar Renovatório (Zona Verde, > 12 meses).
  - **Aprendizado & Crescimento:** Nota Média das Competências do PDI · Prontidão para Promoção · Produtividade da Folha (vendas ÷ custo real da folha).
- **Regras do Farol:** Verde ≥ 85% da meta · Amarelo 70% a 84,9% · Vermelho < 70% (comparado com 1 casa decimal). IEO: Verde ≥ 85 · Amarelo 60 a 84,9 · Vermelho < 60. Custo e perda ("menor é melhor"): atingimento = meta ÷ realizado (realizado ≤ meta = 100%). **Liquidez (FCX):** Índice de Cobertura = (Saldo + Entradas) ÷ Saídas; Verde ≥ 1,15, Amarelo 1,00 a 1,14, Vermelho < 1,00 (déficit projetado). O índice é **truncado** em 2 casas (1,149 aparece "1,14" e é Amarelo; 0,999 aparece "0,99" e é Vermelho), então a tela nunca mostra uma cobertura maior que a real. Sem saídas previstas (e com base positiva) o índice é "∞" e o farol é Verde. O card mostra também o **Saldo Líquido Projetado** = Saldo + Entradas − Saídas.
- **Fonte dos dados (nada dos módulos existentes foi alterado):** Liquidez = FCX (`PrevistoFCX.doMes`: entradas e saídas previstas do mês) + saldo inicial do mês (informado no FCX › DFC ou do extrato OFX; sem saldo, vale R$ 0,00 e a tela avisa) · Margem/PE = Ponto de Equilíbrio, sobre os dados gravados · Ocupação = Motor de Aluguel · Vazamento = Auditoria de Adquirentes · Meta de vendas = meta comercial do FCX × participação de cada loja ÷ faturamento realizado (PE › Importar Realizado) · Credsystem = resultados importados + Cadastro de Metas · IEO = ranking da Retaguarda · Conciliação = confronto Credsystem × Websystem (divergência "tratada" = com observação ou já lançada como falta decidida) · Radar = Radar Renovatório de Contratos (posição de hoje, não depende do mês) · PDI = última avaliação de cada colaborador até o fim do mês (prontidão = objetivo "Promoção" com nota média ≥ nível-meta) · Folha = custo real da empresa (folha importada do mês ou, sem ela, estimada pelo cadastro).
- **Metas assumidas (ajustáveis em `BSC_MOTOR.P`):** vazamento ≤ 0,5% do volume bruto · conciliação 100% · radar 100% · prontidão 70% · nota do PDI = nível-meta do cargo (padrão 4) · IEO 100. A meta de ativação vem do Cadastro de Metas do Credsystem; a de vendas, do FCX.
- **"Sem dados no período":** indicador sem base lançada no mês aparece em cinza neutro, com o motivo, e **não afeta** o cálculo dos demais (nem o farol geral). **Ticket Médio e Mix de Produtos** ainda não tem fonte: o painel não recebe vendas por cupom nem mix do ERP, então o indicador fica "aguardando a carga" até esse dado existir (o motor já calcula quando a fonte entregar vendas, faturamento e meta de ticket).
- **Filtros:** Escopo (Rede consolidada, Regional/Supervisor ou Loja individual) · Segmento (Todas, Esposende ou ES Sports — só aparece se a empresa tem loja Sports; no Falco os rótulos são "Tradicional"/"Sports") · Mês de referência. **A liquidez do FCX é consolidada da Tesouraria**: o FCX não é segmentado por filial, regional ou segmento; nesses recortes (e para quem só tem parte das lojas) o indicador aparece como "Indicador consolidado" em vez de misturar o saldo da rede com a filial.
- **Laudo Estratégico BSC:** botão que monta o parecer executivo na tela: leitura geral (Saudável / Em atenção / Crítico), alerta de liquidez e cobertura de caixa (déficit projetado, folga abaixo de 15% ou liquidez confortável), pontos fortes (zona verde), gargalos críticos (zona vermelha) com a ação recomendada, pontos de atenção, indicadores sem leitura e encaminhamentos. **Imprimir / Exportar PDF A4** (cabeçalho da empresa, filtros aplicados, 4 perspectivas e laudo; pré-visualização com "Imprimir" e "Baixar PDF") · **CSV** (`;`, UTF-8 com BOM, 11 colunas) e **Excel** (abas Indicadores e Laudo). Cada emissão entra no log de auditoria.
- **Permissões (matriz da v14.02, 100%):** nova flag **`bsc_visualizar`** (Gestão de Acessos › linha "Balanced Scorecard (BSC)" › Ler; só leitura). O Master e a Liberação Gerencial a recebem automaticamente. **Cada indicador exige a permissão do módulo de origem** (FCX `fcx.ver`, PE `pe.ver` (também da Produtividade, que usa o faturamento do PE), Contratos `lojas.contratos.ver`, Adquirentes `retaguarda.adq.ver`, Credsystem `credsystem.ver`, IEO `retaguarda.ieo.ver`, Conciliação `retaguarda.ver`, PDI `pdi.ver`); sem ela, o indicador mostra "Sem acesso" (com a permissão citada) e a base **nem é lida**. **Consequência da matriz atual (decisão a revisar):** `pe.ver` (Ponto de Equilíbrio) e `pdi.*` não pertencem a nenhum módulo da matriz — são só do Master (nem a Liberação Gerencial os concede, e o banco só entrega `lojas_faturamento` e `pdi` a quem os tem). Logo, **5 dos 13 indicadores (Meta de Vendas, Margem/PE, Produtividade da Folha, Nota do PDI e Prontidão para Promoção) só são lidos pelo Master**; os demais perfis veem "Sem acesso" neles e os outros 8 normalmente. Para abri-los a perfis executivos será preciso criar módulos na matriz para o PE e o PDI numa versão própria.
- **Perfil Loja:** com a flag marcada, o escopo é travado na **própria filial** (nunca vira a rede, mesmo que a tela peça) e a **Liquidez do FCX e o consolidado financeiro da rede ficam "Sem acesso"** (o FCX nem é consultado). A Home do perfil Loja mostra o farol só da filial.
- **LGPD (Produtividade da Folha, só com `pe.ver`):** sem "Pode ver salários" o indicador mostra **só o Farol e o atingimento da meta**; meta e realizado aparecem "oculto" — o R$ de venda por R$ 1,00 de folha, multiplicado pelas vendas, revelaria o custo da folha, então ele também fica fora da tela, do laudo, do PDF, do CSV e do Excel. Sem a permissão e sem folha lançada, aparece "Sem acesso" (não "Sem dados"), para não revelar se há folha.
- **White-label (Falco):** a tela, o laudo, o PDF e os arquivos usam a marca e os rótulos de segmento do ambiente (o motor não escreve a marca por conta própria).
- **Testes (dados fictícios):** `tests/teste-bsc-1403.mjs` **69** (Node, sem navegador e sem banco: roda o código real do `BSC_MOTOR` de `public/index.html` e a matriz do servidor; limites exatos do Farol, Liquidez com truncamento, os 13 indicadores, "Sem dados" sem quebrar os demais, filtros, perfil Loja, permissão por indicador, mascaramento da folha, laudo, CSV/Excel, mini-card, flag `bsc_visualizar` e recurso desligado) e, no navegador (bancada local, fora do repositório), `test1403.js` **30** (tela, filtros, laudo, PDF, CSV/Excel, mini-card da Home) e `test1403b.js` **16** (perfil Loja, Operacional, mascaramento da folha e Falco).
- **Uso:** `node tests/teste-bsc-1403.mjs` (precisa só do Node; lê `public/index.html` e `netlify/lib`).

## v14.04 · DFC com Categorias personalizadas, grupo "Atividades não operacionais" e exportações (recurso `gestao_v1404`)

Front-end (`public/index.html`), **uma exceção de permissão no servidor** (`netlify/lib/permissoes.mjs`) e um teste novo. **Nenhuma mudança de banco, rota ou variável de ambiente.** `fcx.html`, `contabilidade.html` e `contabilidade_v1391.html` seguem **idênticos** (Regra de Ouro).

- **Onde:** FCX · Fluxo de Caixa › DFC › **Regras de classificação** › painel **"Categorias da DFC"** (e o botão **+ Nova categoria** no topo da aba e dentro do modal de criar/editar regra).
- **Cadastro (nova, editar, excluir):** Nome · **Sentido** (Entrada/Saída) · **Grupo no Demonstrativo** (Operacional, Investimento, Financiamento ou **Não Operacional**) · **Impacto no Caixa** (**Soma no fluxo líquido**, padrão, ou **Neutra / Transferência**: fica fora de entradas, saídas e da variação líquida, como as transferências entre contas próprias). Nome único (sem diferenciar maiúsculas e acentos), de 3 a 60 caracteres.
- **Base preservada:** as 21 categorias padrão seguem pré-carregadas, aparecem como "padrão" e **não podem ser editadas nem excluídas** (o motor depende delas: "Outras entradas/saídas operacionais" são o destino quando nenhuma regra casa). A categoria personalizada **não pode ser excluída enquanto estiver em uso**: o painel mostra um aviso amigável com a contagem (regras de classificação, lançamentos reclassificados manualmente nos Extratos OFX e contas do De-para FCX → DFC). O **Sentido** de uma categoria em uso fica travado; mudar o grupo ou o impacto recalcula a base mensal (`dfc/AAAA-MM`).
- **Persistência:** `config/dfc.categorias` (`[{ id, nome, sentido, grupo, impacto }]`), no mesmo documento das regras (`regras`) e do De-para (`mapaFCX`); a gravação mescla, não apaga o restante. Registros quebrados são ignorados sem erro.
- **Integração automática:** a categoria nova aparece (1) no seletor **Categoria DFC** da regra, **filtrado pelo Sentido escolhido** (Entrada/Saída/Ambos; muda na hora ao trocar o Sentido; a regra recusa categoria que não combina com o sentido); (2) na **reclassificação manual dos Extratos OFX** (agrupada por atividade, marcada com ★); (3) no **De-para FCX → DFC** (só as de Saída e de impacto "soma", ★); (4) no Realizado × Previsto e na DFC do mês.
- **DFC do mês:** um bloco por atividade, cada um com seu **subtotal isolado** ("Caixa Líquido das Atividades Operacionais", "… de Investimento", "… de Financiamento"), o bloco **Atividades Não Operacionais logo abaixo de Financiamento** (aparece quando há categoria cadastrada no grupo ou valores nele) e a **Variação Líquida de Caixa somando todos os blocos**; movimentações neutras e transferências aparecem à parte, fora do total.
- **Realizado × Previsto:** mesma estrutura (grupos dinâmicos, subtotal por atividade e **Variação Líquida de Caixa** no fim, líquido = entradas − saídas).
- **Exportações (PDF A4, Excel e CSV)** em **DFC do mês** e **Realizado × Previsto** (não existiam antes): botões na barra da aba; PDF na pré-visualização A4 padrão do painel; CSV com `;`, vírgula decimal e BOM UTF-8; Excel com colunas numéricas formatadas. Cada emissão fica na auditoria. Arquivos `DFC_<marca>_<AAAA-MM>` e `Realizado_x_Previsto_<marca>_<AAAA-MM>` (marca Falco no ambiente white-label).
- **Permissões (matriz estrita da v14.02):** criar/editar/excluir categorias exige **`fcx.dfc.regras`** ("Regras de classificação") ou Master; Ler (`fcx.dfc.ver`) vê a tabela e exporta, sem botões de edição. **Servidor:** `config/dfc` (e só ele) passou a aceitar gravação de quem tem `fcx.dfc.regras` — antes só o Master gravava a coleção `config`, então as regras de um Operacional não persistiam no Netlify; o resto de `config` (IEO, saldos, parâmetros) segue só do Master, **excluir** o documento segue só do Master e o perfil Loja nunca grava (`DOCS_MATRIZ` em `permissoes.mjs`).
- **Recurso desligado (Produção/Falco até "Liberar Versão"):** a DFC volta ao comportamento anterior (21 categorias, sem painel, sem exportações, sem subtotais novos).
- **Regra de Ouro, com transparência:** o motor e a tela da DFC ficam dentro das regiões que antes eram protegidas por hash. Esta versão altera **somente o código da DFC** (grupos/categorias/consolidação, regras, Extratos OFX, DFC do mês, Realizado × Previsto, De-para); o restante dessas regiões (OFX e contas bancárias, adquirentes, FCX, Credsystem) foi **conferido por hash e segue idêntico**.
- **Testes (dados fictícios):** `tests/teste-dfc-categorias-1404.mjs` **58** (Node, sem navegador e sem banco: roda o código real da DFC de `public/index.html` e as permissões do servidor: criação de "Saídas não operacionais", validações, regra associada, apuração isolada, neutra, exclusão bloqueada, recurso desligado, registros quebrados e `config/dfc` por perfil). Teste de navegador (local, dados fictícios): 48 verificações da tela. Os testes que precisam de Postgres (`teste-migracoes`, `teste-contabil*`, `teste-adiantamentos`…) seguem como antes.
- **Uso:** `node tests/teste-dfc-categorias-1404.mjs` (precisa só do Node; lê `public/index.html` e `netlify/lib`).

## v14.05 · Fornecedores e Clientes com chaves PIX e Categoria DFC padrão, importação em lote e cruzamento automático com os Extratos OFX e a DFC (recurso `gestao_v1405`)

Somente front-end (`public/index.html`) e um teste novo. **Nenhuma mudança de banco, rota, permissão no servidor ou variável de ambiente.** `fcx.html`, `contabilidade.html` e `contabilidade_v1391.html` seguem **idênticos** aos da v14.04 (Regra de Ouro).

- **Cadastro de parceiros (coleção `parceiros`, Módulo 13):** campo **Tipo** (Fornecedor, padrão, Cliente ou Ambos); seção **"Chaves PIX para Conciliação (OFX)"** com várias chaves por parceiro (CNPJ, CPF, Telefone/Celular, E-mail e Chave Aleatória/EVP; o tipo é detectado ao digitar) e o **CNPJ/CPF principal do cadastro vale como chave automaticamente**; campo opcional **"Categoria DFC Padrão"** com todas as categorias padrão e personalizadas da v14.04 (agrupadas por atividade, as personalizadas com ★).
- **Conflito de chaves:** a mesma chave PIX (depois de normalizada: só dígitos para CNPJ/CPF/telefone, minúsculas para e-mail e aleatória; telefone compara DDD+número com ou sem `+55`/`0`) não pode ficar em dois cadastros. O formulário avisa **ao vivo**, e **Salvar é bloqueado** com o aviso "Chave PIX já vinculada a outro cadastro" dizendo qual fornecedor já a usa. Cadastros antigos com conflito aparecem num aviso no topo da lista.
- **Lista "Fornecedores e Clientes":** nova coluna **"Chaves PIX · Categoria DFC"** e a busca também encontra por chave PIX.
- **Modelo e importação:** botões no topo **Baixar Modelo Planilha** (`.xlsx`, e `.csv` com `;` e BOM UTF-8; 20 colunas, linhas de exemplo e aba de instruções) e **Importar Planilha** (`.xlsx` ou `.csv` com `;` ou `,`). Cabeçalhos lidos sem diferenciar maiúsculas/acentos, com apelidos (Razão Social ou Nome, CNPJ/CPF, `Chaves_PIX` consolidada separada por `;` ou `,` etc.). O Excel que come zeros à esquerda do CNPJ/CPF é corrigido. Limites: 2.000 linhas e 8 MB.
- **Prévia antes de gravar (upsert):** modal com **novos**, **já existentes pelo CNPJ/CPF (completados, com chaves PIX mescladas)**, sem alteração, **CNPJ/CPF ou tipo inválido** (a linha não entra) e **chave PIX duplicada** (a chave fica de fora e a linha entra), com a lista das ocorrências e do que muda em cada linha. Quem já existe **só recebe o que estava vazio**: nada preenchido é apagado e célula vazia não apaga nada (opção explícita "Atualizar também os campos já preenchidos"). Gravação em lotes, **um único registro no log de auditoria** (`importou · parceiros`).
- **Cruzamento automático** (ao importar OFX e no botão **Cruzar Fornecedores / Reprocessar PIX** da aba Extratos OFX, que mostra uma prévia sem gravar: lidos, com fornecedor, vínculos novos, trocados/desfeitos, ambíguos e lançamentos que mudam de categoria; escopo "só o mês" ou "todos"): lê histórico/MEMO/NAME/PAYEE normalizados e procura, nesta ordem, **1) chave PIX cadastrada** (CNPJ e CPF com ou sem máscara, e-mail sem diferenciar maiúsculas, telefone com ou sem `+55`/`0`, chave aleatória), **2) CNPJ/CPF do cadastro** em TED/DOC/boleto/PIX e **3) Razão Social ou Nome Fantasia idênticos** (6 caracteres ou mais e sem ambiguidade; nome em mais de um cadastro não vincula). O vínculo grava no lançamento `par`, `via` (pix/documento/nome), `vch` (tipo da chave) e `pcat` (categoria padrão do cadastro naquele momento).
- **Extratos OFX:** coluna **"Fornecedor / Favorecido"** com selo de como casou (`Chave PIX · e-mail`, `Documento · CNPJ`, `Nome`), **filtro por fornecedor** (todos, com, sem ou um específico) e busca também pelo nome do fornecedor.
- **Prioridade da classificação na DFC:** **1º classificação manual**, **2º regra explícita** de "Regras de classificação da DFC", **3º Categoria DFC Padrão** do fornecedor vinculado, **4º** fornecedor vinculado sem categoria nem regra: **"Pagamento a fornecedores (operacional)"** nas Saídas ou **"Outras entradas operacionais (operacional)"** nas Entradas (o motor usa as categorias de sistema `pag_fornecedores` e `rec_outros`), 5º padrão de sempre. O texto de origem aparece abaixo do seletor ("categoria padrão do fornecedor", "padrão do fornecedor (automático)"). Trocar a categoria padrão do cadastro (ou excluir o parceiro) recalcula `dfc/AAAA-MM` dos meses afetados; categoria personalizada em uso por parceiro **não pode ser excluída** (o aviso conta os fornecedores/clientes).
- **Quem não lê o cadastro de parceiros** (sem `parceiros.ver`) classifica pela categoria gravada no lançamento (`pcat`), sem sumir com o vínculo.
- **Permissões (travas da v14.02/v14.04, sem mudar o servidor):** criar/editar/importar parceiros exige `parceiros.editar` (ou Master); gravar extratos (importar OFX e reprocessar) exige `fcx.dfc.importar`; ler o cadastro, `parceiros.ver`. Sem a permissão, os botões não aparecem e as funções recusam. Funciona igual no ambiente white-label Falco (nenhum nome de empresa no código novo).
- **Recurso `gestao_v1405` (marcador `v14.05`):** ativo na Homologação; na Produção/Falco só depois de **Liberar Versão em Produção**. Desligado, nada muda: sem campos novos, coluna, botões nem cruzamento, e a DFC ignora os vínculos (os dados gravados ficam preservados).
- **Regra de Ouro, com transparência:** o código novo ficou **fora** dos trechos protegidos por hash. `OFX.ler` e `ContasBancarias` **não foram alterados**: o cruzamento roda depois da leitura, em motor próprio (`PARC_PIX`/`PARC_IMP`, antes do marcador da IEO). As mudanças na DFC (coluna, filtro, prioridade) ficam na região da DFC, liberada desde a v14.04.
- **Teste (dados fictícios):** `tests/teste-fornecedores-pix-dfc-1405.mjs` com **78** verificações em Node (sem navegador e sem banco, roda o código real de `public/index.html`): normalização de CNPJ/CPF/telefone (com e sem `+55`)/e-mail, conflitos, importação da planilha (idempotência, mesclagem sem apagar, zeros à esquerda, linhas inválidas, duplicidade), ordem do cruzamento, OFX de ponta a ponta, prioridade manual > regra > categoria do fornecedor > automático, isolamento de "Saídas não operacionais", recurso desligado, categoria em uso e fallback `pcat`.
- **Uso:** `node tests/teste-fornecedores-pix-dfc-1405.mjs` (precisa só do Node; lê `public/index.html`).

## v14.06 · Resumo Executivo Oficial da DFC (padrão bancário / institucional) (recurso `gestao_v1406`)

Somente front-end (`public/index.html`) e um teste novo. **Nenhuma mudança de banco, rota, permissão no servidor ou variável de ambiente.** `fcx.html`, `contabilidade.html` e `contabilidade_v1391.html` seguem **idênticos** à v14.05 (conferidos por hash).

- **Botão "Resumo Executivo DFC (Padrão Banco / PDF)":** aparece no topo da aba **DFC** (ao lado de "Importar OFX", em qualquer sub-aba) e em **"DFC do mês"**, junto de PDF A4 / Excel / CSV. Exige a permissão `fcx.dfc.ver`; sem ela o botão some e a função recusa abrir.
- **Modal de pré-configuração (antes de gerar o A4):** (1) **Empresa emissora**, escolhida no cadastro de empresas do ambiente ativo (`config/empresas`), com razão social e CNPJ já preenchidos e editáveis, ou "Outra empresa (informar abaixo)"; no Falco o painel não injeta empresas padrão da Esposende, então razão e CNPJ vêm do cadastro do próprio ambiente ou são informados na hora (neutralidade white-label); (2) **Período:** mês de referência, trimestre (3 meses terminando no mês), acumulado do ano (janeiro até o mês) ou intervalo personalizado (até 36 meses); (3) **Notas explicativas / parecer da controladoria** (opcional, até 4.000 caracteres) para justificar sazonalidade, investimentos ou movimentações extraordinárias; (4) **Signatários:** nome e cargo da Diretoria / Gestão Financeira e do Contador Responsável, com registro no CRC. A última configuração usada é lembrada no navegador (por ambiente, só dados da empresa e signatários; as notas não são guardadas). Valida CNPJ (dígitos verificadores), razão social, nomes e período e lista o que falta sem fechar o modal.
- **Documento A4 retrato (CPC 03, método direto)**, com **Imprimir** e **Baixar PDF** (mesma pré-visualização dos outros documentos do painel): **cabeçalho** com logo da empresa ativa, razão social, CNPJ, período de competência, critério "Demonstração dos Fluxos de Caixa — Método Direto / CPC 03" e data/hora de emissão; **Quadro 1 · Síntese Executiva e Indicadores de Liquidez** (saldo inicial consolidado com detalhe por conta bancária cadastrada, geração líquida das atividades operacionais com margem de caixa, fluxo líquido de investimento, de financiamento, movimentações não operacionais isoladas conforme a v14.04, variação líquida, movimentações neutras e transferências entre contas próprias, saldo final conciliado × saldo final dos extratos OFX, e índice de cobertura do serviço da dívida); **Quadro 2 · Demonstrativo detalhado por grupo e categoria** (Realizado OFX × Previsto FCX, variação em R$ e %, subtotais por grupo); **Quadro 3 · Notas explicativas da controladoria** (só aparece quando preenchido; o texto é escapado, não aceita HTML); **rodapé** com linhas de assinatura da Diretoria / Gestão Financeira e do Contador (com CRC).
- **Reconciliação de saldos:** saldo inicial = saldo do último extrato do mês anterior ao primeiro mês do período, por conta (ou o saldo manual informado na DFC); saldo final conciliado = saldo inicial + variação líquida + movimentações neutras. O documento compara com o saldo final dos extratos e mostra **Conciliado**, **Divergente** (com a diferença em R$), **Parcial** (alguma conta sem extrato) ou **Sem saldo inicial**, no consolidado e em cada conta.
- **Índice de cobertura do serviço da dívida:** caixa operacional antes dos juros ÷ (amortizações + juros do período). Amortizações = categorias de financiamento com saída (inclui categorias personalizadas); juros = lançamentos de "Tarifas e juros bancários" cujo histórico indica juros, IOF, encargos ou mora (tarifas puras não entram). Faixas: **Confortável ≥ 1,20x**, **Atenção 1,00x a 1,20x**, **Insuficiente < 1,00x**; sem amortizações nem juros no período o indicador fica "n/d" (sem divisão por zero).
- **Sem tags internas:** o documento não mostra ★, contagens de lançamentos, origem da classificação, ids de categoria, nomes de parceiros nem textos de histórico do extrato.
- **Perfil sem "Pode ver salários" (`rh.ver_salarios`):** a linha da folha não aparece nem isolada nem somada de forma que dê para separá-la: a folha é fundida com as demais saídas operacionais numa linha única "Pessoal, administrativas e outras saídas operacionais (detalhe restrito)". Se a folha for a única saída operacional do período, não há como escondê-la sem falsear o total; nesse caso o modal avisa (`mascaraExposta`). As variações líquidas e os subtotais seguem corretos.
- **Auditoria:** cada emissão grava um evento "emitiu · documento" (período, empresa e CNPJ; indica quando a folha saiu agregada).
- **Recurso `gestao_v1406` (marcador `v14.06`):** ativo na Homologação; na Produção/Falco só depois de **Liberar Versão em Produção**. Desligado, nada muda: nenhum botão novo, e as exportações PDF A4 / Excel / CSV da v14.04 seguem iguais.
- **Regra de Ouro, com transparência:** o código novo ficou **fora** dos trechos protegidos por hash (motor `DFC_RESUMO` antes do marcador do IEO; interface em `Object.assign(FluxoDFC…)` antes do Módulo 6). `OFX.ler` e `ContasBancarias` **não foram alterados**.
- **Teste (dados fictícios):** `tests/teste-dfc-resumo-bancario-1406.mjs` com **72** verificações em Node (sem navegador e sem banco, roda o código real de `public/index.html`): períodos e formatação, indicadores, reconciliação (conciliado, divergente, parcial, sem saldo inicial, saldo manual, neutras, mês vazio), cobertura da dívida (juros × tarifas, categoria personalizada, faixas, n/d), Quadro 2 (previsto, variação, subtotais, acumulado trimestral), máscara da folha em cinco cenários, validação e montagem do documento (cabeçalho, ordem dos quadros, notas escapadas, assinaturas, ausência de tags internas, HTML equilibrado, neutralidade white-label).
- **Uso:** `node tests/teste-dfc-resumo-bancario-1406.mjs` (precisa só do Node; lê `public/index.html`).

## v14.07 · Empresas (Matriz) × Contas bancárias da DFC × Resumo Executivo Oficial (recurso `gestao_v1407`)

Somente front-end (`public/index.html`) e um teste novo. **Nenhuma mudança de banco, rota, permissão no servidor ou variável de ambiente.** `fcx.html`, `contabilidade.html` e `contabilidade_v1391.html` seguem **idênticos** à v14.06 (conferidos por hash).

- **Gerenciar Empresas / Matriz:** novo atalho em **FCX › DFC › Contas bancárias** (e o mesmo formulário abre pelo editor de empresas do Conciliador de Meios de Pagamento). O cadastro tem **Nome, Razão social, CNPJ** (com a busca automática na Receita já existente, que também preenche a **Situação**), **Situação** (Ativa, Inativa, Suspensa, Inapta, Baixada, Nula), o checkbox **Empresa Matriz** (só pode haver uma: marcar outra desmarca a atual, com aviso) e a seção **Contas Bancárias Associadas (Padrão desta Empresa)**, com todas as contas da DFC (banco, agência/conta, descrição e titular), "Marcar todas" e "Limpar seleção". A Matriz aparece com o selo **[Matriz]** na lista de empresas (do gerenciador e do Conciliador). O CNPJ não pode repetir entre empresas.
- **Contas bancárias da DFC:** cada conta ganha, de forma opcional, **CNPJ / Empresa titular** (escolha uma empresa do cadastro, que preenche o CNPJ, ou "Outro CNPJ", validado pelos dígitos verificadores) e o checkbox **Conta padrão da Empresa Matriz**. A lista de contas mostra a coluna **Titular** e o selo "Padrão da Matriz". O vínculo "conta padrão" mora **somente no cadastro da empresa** (`contasPadrao`); a conta guarda apenas o titular (`titularEmpresaId`, `titularCnpj`), nunca uma cópia do padrão. Excluir uma conta a retira dos padrões das empresas.
- **Resumo Executivo DFC (Padrão Banco / Institucional):** o campo **Empresa emissora** vem do cadastro do ambiente, com a **[Matriz]** no topo, as demais empresas e "Outra empresa (informar abaixo)". Novo campo **Contas bancárias consideradas no resumo**: checkboxes com banco, agência/conta, descrição e vínculos (padrão da Matriz/da empresa, titular), "Marcar todas" e "Limpar seleção". **Em branco = contas padrão da empresa emissora**: o modal informa "Nenhuma conta marcada manualmente — serão consideradas automaticamente as X contas padrão vinculadas à [empresa]". Marcando 1 ou mais contas, vale **estritamente** a seleção. Sem marcação e sem contas padrão (ou com "Outra empresa"), aparece o alerta orientando marcar ao menos uma conta ou configurar o vínculo, e **o documento não é emitido**.
- **Apuração filtrada (CPC 03):** saldo inicial, entradas e saídas dos extratos, geração operacional, investimentos, financiamentos, não operacionais, cobertura do serviço da dívida e saldo final conciliado são recalculados **somente com as contas do escopo**. O **Quadro 1** lista linha a linha as contas incluídas (banco, agência/conta, saldo inicial, variação líquida, saldo final conciliado, saldo final do extrato e situação) com o total, e o subtítulo e a ficha de identificação trazem o escopo ("Contas consideradas: N contas bancárias (contas padrão da Matriz / contas selecionadas manualmente / todas as contas bancárias cadastradas)"). A emissão registra o escopo na auditoria.
- **Permissões (sem mudar o servidor):** editar empresas e vínculos exige `retaguarda.adq.taxas` (a mesma trava do editor de empresas do Conciliador); editar contas segue `fcx.dfc.contas`; emitir o Resumo segue `fcx.dfc.ver`; a folha continua agregada sem `rh.ver_salarios`. Sem a permissão de empresas, o gerenciador só consulta, o checkbox "Conta padrão da Matriz" fica travado e salvar a conta não mexe na Matriz.
- **White-label (Falco):** nenhuma empresa da Esposende é pré-cadastrada: sem cadastro no ambiente a lista de empresas fica vazia (só "Outra empresa"); a sugestão inicial do Conciliador segue valendo apenas fora do Falco. O motor `DFC_MATRIZ` não tem nome de empresa escrito.
- **Recurso `gestao_v1407` (marcador `v14.07`):** ativo na Homologação; na Produção/Falco só depois de **Liberar Versão em Produção**. Desligado, nada muda: sem atalho, coluna, campos nem seletor, e o Resumo volta a usar todas as contas com extrato, como na v14.06. O editor antigo de empresas do Conciliador passou a preservar `matriz`, `situacao` e `contasPadrao` já gravados mesmo com o recurso desligado.
- **Limites a saber:** (1) no servidor, o documento `config/empresas` continua só do Master; a trava `retaguarda.adq.taxas` é do cliente (o servidor recusa a gravação de quem não é Master). Liberar `config/empresas` para outros perfis exige mudança de servidor, não feita aqui; (2) o **previsto do FCX é da empresa toda**, não por conta: com escopo parcial, a variação do Quadro 2 também reflete a diferença de escopo, e o documento avisa; (3) com escopo parcial o saldo inicial manual consolidado da DFC é ignorado (com aviso), pois se refere a todas as contas; (4) conta do escopo sem extrato aparece na lista e deixa a conciliação "parcial"; (5) só uma Matriz por vez.
- **Regra de Ouro, com transparência:** o código novo ficou **fora** dos trechos protegidos por hash (motor `DFC_MATRIZ` antes do marcador do IEO, ajustes no `DFC_RESUMO`, interface em `Object.assign(FluxoDFC…)` antes do Módulo 6; no Conciliador, só o editor e a lista de empresas). `OFX.ler` e `ContasBancarias` **não foram alterados**.
- **Teste (dados fictícios):** `tests/teste-dfc-matriz-contas-1407.mjs` com **73** verificações em Node (sem navegador e sem banco, roda o código real de `public/index.html`): cadastro da Matriz (uma só, ordem, situação, CNPJ, white-label), contas padrão (marcar, desmarcar, remover conta), escopo manual × fallback em branco com os textos exatos e o alerta, titular divergente, **isolamento dos saldos** (cada conta, subconjuntos e todas) e o documento A4 (Quadro 1 só com as contas do escopo, subtítulo, HTML equilibrado, sem nome de empresa fixo). Foi validado também por mutação (sem o filtro de escopo, 16 verificações falham).
- **Uso:** `node tests/teste-dfc-matriz-contas-1407.mjs` (precisa só do Node; lê `public/index.html`).


## v14.08 · Empresa Matriz no Cadastro de Lojas × Resumo Executivo DFC sem empresas de adquirência (recurso `gestao_v1408`)

Somente front-end (`public/index.html`) e um teste novo. **Nenhuma mudança de banco, rota, permissão no servidor ou variável de ambiente.** `fcx.html`, `contabilidade.html` e `contabilidade_v1391.html` seguem **idênticos** à v14.07 (conferidos por hash).

- **Empresa Matriz na ficha da loja (Gestão de Lojas):** a ficha ganha o checkbox **"Esta unidade é a Empresa Matriz"**. Só pode haver **uma Matriz ativa por ambiente**: marcar outra unidade desmarca a atual (com aviso, e as contas padrão da anterior são limpas). A loja marcada aparece com o selo **[Matriz]** na listagem. Loja inativa não pode ser a Matriz, e a Matriz precisa de **Razão Social** e **CNPJ válido** (a ficha já os tem; a Razão Social pode vir da consulta à Receita).
- **Contas Bancárias Padrão da Matriz:** marcada a Matriz, a própria ficha mostra a seção com **todas as contas cadastradas na DFC** (banco, agência/conta e descrição), com "Marcar todas" e "Limpar seleção". O vínculo fica **na própria loja** (`matriz: true` e `contasPadraoMatriz: [contaId…]`). Desmarcar a Matriz limpa as contas padrão. Excluir uma conta a retira do vínculo. Na aba **Contas** da DFC, o atalho passou a ser "Empresa Matriz (Cadastro de Lojas)" e o checkbox "Conta padrão da Empresa Matriz" grava na loja Matriz.
- **Retrocompatibilidade com a v14.07 (sem perda):** se já existe uma Matriz salva no cadastro de empresas da v14.07, ela continua valendo **virtualmente** (origem "herdada") até alguma loja ser marcada. A loja de **mesmo CNPJ** já aparece como [Matriz] e a ficha dela abre marcada, com as contas padrão da v14.07 já marcadas e um aviso para **salvar e consolidar** (a Razão Social também é aproveitada). O documento `config/empresas` **não é alterado** pela migração. Marcar "Conta padrão" numa conta com a Matriz ainda na v14.07 migra o vínculo para a loja de mesmo CNPJ. Desmarcar de propósito a loja da Matriz herdada **cancela** a Matriz da v14.07; editar outra loja não cancela.
- **Resumo Executivo DFC (Padrão Banco / Institucional) sem empresas de adquirência:** o seletor de empresas (Resilienza, Mar Aberto, Esposende Card, "Outra empresa") **foi removido** do modal. A **Empresa emissora** vem **exclusivamente da Matriz do Cadastro de Lojas**, num cartão de identificação (Razão Social, CNPJ oficial, unidade) com o atalho **"Editar Matriz no Cadastro de Lojas"**, que abre a ficha por cima do modal e atualiza o cartão ao salvar. Sem Matriz definida, o modal mostra um alerta com o atalho para defini-la e **bloqueia a emissão** (não existe emitente livre).
- **Contas abrem em branco, com as padrão aplicadas:** o seletor de contas abre **desmarcado**; havendo contas padrão vinculadas à Matriz no Cadastro de Lojas, elas já valem automaticamente (destacadas com o selo "Padrão da Matriz" e explicadas na mensagem do escopo). Marcando contas à mão, vale **estritamente** a seleção. Matriz sem contas padrão e sem marcação: o modal alerta e a emissão fica bloqueada.
- **Descrições das contas no A4 (parâmetro novo):** "**Exibir descrições internas das contas no documento A4**", **desmarcado por padrão**. Desmarcado, o Quadro 1 mostra só **código e nome do banco** ("033 · Santander") e **agência / conta** ("Ag 3418 · CC 13003698-0"), sem descrições como "ESPOSENDE - CONTAS A PAGAR"; isso vale para o documento inteiro (subtítulo, ficha, notas e avisos de conciliação parcial). Marcado, a descrição aparece logo abaixo do nome do banco, como na v14.07. Na **tela do modal** as descrições continuam visíveis para a conferência interna.
- **Permissões (sem mudar o servidor):** editar a Matriz e o vínculo segue a permissão de editar o Cadastro de Lojas (`lojas.editar`); emitir o Resumo exige `fcx.dfc.ver`; a folha continua agregada/mascarada sem `rh.ver_salarios`. Quem não vê as contas da DFC (`fcx.dfc.ver`) vê só a contagem na ficha e, ao salvar, o vínculo existente **não se perde**.
- **White-label (Falco):** sem lojas marcadas nem empresas gravadas não há Matriz nem empresa pré-cadastrada: o modal mostra o alerta e nenhuma menção à Esposende. O motor `DFC_MATRIZ` não tem nome de empresa escrito.
- **Recurso `gestao_v1408` (marcador `v14.08`):** ativo na Homologação; na Produção/Falco só depois de **Liberar Versão em Produção**. Desligado, tudo volta à v14.07 (seletor de empresas no Resumo, sem checkbox nem selo nas lojas).
- **Limites a saber:** (1) a Matriz agora é editável por quem tem `lojas.editar`; a limitação da v14.07 (`config/empresas` só do Master no servidor) deixa de valer para a Matriz, e **não houve mudança de servidor**; (2) não há emitente em texto livre: sem Matriz no Cadastro de Lojas (ou Matriz herdada da v14.07 já salva), a emissão fica bloqueada com aviso claro; (3) empresas de exemplo da v14.07 **nunca gravadas** não contam como Matriz; (4) com a v14.08 ativa, o editor de empresas do Conciliador esconde "Matriz" e "contas padrão" e **preserva** os dados da v14.07 ao salvar; (5) o **previsto do FCX é da empresa toda**: com escopo parcial, a variação do Quadro 2 reflete também a diferença de escopo (o documento avisa); (6) só uma Matriz por vez e só unidade ativa; (7) o legado da v14.07 só é consolidado na loja ao **salvar a ficha** (ou ao gravar o vínculo pela aba Contas com loja de mesmo CNPJ).
- **Regra de Ouro, com transparência:** o código novo ficou **fora** dos trechos protegidos por hash (motor `DFC_MATRIZ` antes do marcador do IEO, ajustes no `DFC_RESUMO`, interface em `Object.assign(FluxoDFC…)` antes do Módulo 6; em Lojas, só a ficha e a lista). `OFX.ler` e `ContasBancarias` **não foram alterados**.
- **Teste (dados fictícios):** `tests/teste-dfc-matriz-lojas-1408.mjs` com **60** verificações em Node (sem navegador e sem banco, roda o código real de `public/index.html`): Matriz na loja (uma só, ordem, inativa, razão social, CNPJ), contas padrão (marcar, desmarcar, conta excluída), retrocompatibilidade da v14.07, cartão do emissor, escopo (em branco × manual) com os textos exatos, ocultação/exibição das descrições no Quadro 1 e nos avisos, white-label e v14.07 intacta. Validado também por mutação (8 mutantes mortos).
- **Uso:** `node tests/teste-dfc-matriz-lojas-1408.mjs` (precisa só do Node; lê `public/index.html`).


## v14.09 · Extratos OFX (saídas) × Contas a Pagar do FCX × Conta Contábil × De-para FCX → DFC (recurso `gestao_v1409`)

Somente front-end (`public/index.html`) e dois testes novos (o cruzamento com o Contas a Pagar e, no complemento, as categorias padrão editáveis). **Nenhuma mudança de banco, rota, permissão no servidor ou variável de ambiente.** `fcx.html`, `contabilidade.html` e `contabilidade_v1391.html` seguem **idênticos** à v14.08 (conferidos por hash).

- **Cruzamento das saídas do OFX com o Contas a Pagar (FCX → Saídas):** cada saída do extrato é comparada com os títulos do Contas a Pagar do FCX. O **favorecido** do extrato é normalizado (sem acentos e caracteres especiais; sem datas, CNPJ/CPF e sequências longas de dígitos; sem os prefixos PIX ENVIADO, PIX TRANSF, TED ENVIADA, DOC, PAGTO, PAGAMENTO, BOLETO e DB AUTOM). O vínculo exige **valor idêntico (até R$ 0,05 de diferença)**, **razão social do fornecedor igual ou prefixo normalizado de 12 caracteres ou mais** (nomes truncados pelo banco: o nome do extrato precisa ser o início do nome do título) e **data do extrato em até ±5 dias úteis** do vencimento do título (segunda a sexta, **sem calendário de feriados**). Valor e fornecedor são comparados também com o valor líquido do título, quando houver.
- **Desempate:** primeiro o título **Pago/Efetivo**; depois o **Previsto** de vencimento mais próximo da data do extrato. Se dois fornecedores **diferentes** casam só por prefixo, a saída é marcada como **ambígua e não é vinculada**. **Um título casa uma única saída** (também entre importações e meses diferentes): o par é gravado na própria saída (`cp`: id do título, conta contábil, fornecedor, status e se foi nome exato ou prefixo).
- **Conta Contábil → De-para FCX → DFC → Categoria DFC:** a categoria da saída vem da conta contábil do título pelo **De-para FCX → DFC** (override em `config/dfc.mapaFCX` e, na falta dele, o prefixo do código da conta). A categoria é resolvida **na hora de exibir**: mudar o De-para muda a categoria dos lançamentos já vinculados, e **salvar o De-para recalcula a base da DFC** (com o recurso ligado). Categoria personalizada que não existe mais cai no padrão do código.
- **Hierarquia (nunca sobrescreve o manual):** 1) classificação **manual** do usuário; 2) **regra** explícita; 3) **Contas a Pagar** (conta contábil → De-para); 4) categoria padrão do **cadastro de fornecedores** (v14.05); 5) padrão (Pagamento a fornecedores / Outras entradas). Lançamentos manuais **não são tocados** pelo cruzamento. Quando a regra ou a classificação manual prevalece, o vínculo com o título continua gravado e a tabela avisa "vinculado ao Contas a Pagar · Conta … (a regra/classificação manual prevalece)".
- **Onde aparece (Extratos OFX):** na coluna **Categoria DFC**, selo "Contas a Pagar" e a linha **"Contas a Pagar · Conta [Código - Nome]"**, com o fornecedor do título e o status (Pago, Efetivo ou Previsto). A busca também acha pelo fornecedor e pela conta do título. A dica da barra informa quantas saídas foram classificadas pelo Contas a Pagar.
- **Importação e reprocessamento:** o cruzamento roda **na importação do OFX** (a confirmação informa quantas saídas já têm título identificado) e no botão, que passou a se chamar **"Cruzar Fornecedores, PIX e Contas a Pagar"**. A prévia (**nada é gravado antes de confirmar**) mostra os vínculos novos, trocados e desfeitos com fornecedores e com o Contas a Pagar, os ambíguos, quantos lançamentos ficam **classificados via Contas a Pagar / Conta Contábil**, quantos têm vínculo mas a regra/manual prevalece e quantos mudam de categoria. Reprocessar de novo não muda nada (idempotente). Escolha do escopo: só o mês aberto ou todos os meses importados.
- **FCX indisponível:** se o FCX ainda não carregou (o Contas a Pagar vem do motor do FCX, em iframe), o painel espera até 15 s; se continuar indisponível, o cruzamento com as saídas é **pulado**, os vínculos já gravados são **mantidos** e a prévia mostra o aviso.
- **Permissões (sem mudar o servidor):** o botão aparece para quem pode importar extratos (`fcx.dfc.importar`); a parte de fornecedores e clientes só roda para quem pode ler esse cadastro.
- **Recurso `gestao_v1409` (marcador `v14.09`):** ativo na Homologação; na Produção/Falco só depois de **Liberar Versão em Produção**. Desligado, tudo volta à v14.08: botão "Cruzar Fornecedores / Reprocessar PIX", sem linha do Contas a Pagar e a DFC ignora os vínculos `cp` já gravados (que ficam preservados).
- **Regra de Ouro, com transparência:** o código novo (motor `CP_OFX`, passo novo em `DFC.classificar`, interface em `Object.assign(FluxoDFC…)`) ficou **fora** dos trechos protegidos por hash (OFX/contas, adquirentes e FCX, Credsystem). `OFX.ler` e `ContasBancarias` **não foram alterados**.
- **Limites a saber:** (1) dias úteis = segunda a sexta, **sem feriados**; (2) o casamento por prefixo cobre só o truncamento do banco (o nome do extrato precisa ser o início do nome do título); nomes muito diferentes não casam; (3) o desempate usa apenas o status do título no FCX (Pago/Efetivo antes de Previsto), sem checar a baixa em outro lugar; (4) o cruzamento depende do FCX carregado no navegador; (5) os testes usam **dados fictícios**; arquivo OFX real de banco e os testes que dependem do Postgres **não foram executados** nesta versão.
- **Teste (dados fictícios):** `tests/teste-ofx-contas-pagar-dfc-1409.mjs` com **71** verificações em Node (sem navegador e sem banco, roda o código real de `public/index.html`): normalização do favorecido, nome exato × prefixo (nome truncado do PIX + valor exato), tolerância de R$ 0,05, janela de ±5 dias úteis, desempate Pago/Efetivo × Previsto, um título por saída, ambiguidade, Conta Contábil → De-para → DFC (override e padrão), hierarquia completa sem sobrescrever o manual, recurso desligado, prévia e reprocessamento (idempotência, FCX indisponível, permissões) e linhas da tabela.
- **Uso:** `node tests/teste-ofx-contas-pagar-dfc-1409.mjs` (precisa só do Node; lê `public/index.html`).

### Complemento da v14.09 · Categorias padrão da DFC com nome e grupo editáveis (mesmo recurso `gestao_v1409`)

- **Lápis nas 21 categorias padrão:** na tabela "Categorias da DFC" (FCX → DFC → Regras de classificação), as categorias marcadas como `padrão` ganham o ícone de **Editar**. O ícone de **Excluir** segue **bloqueado** (aparece desabilitado), para o motor não perder as referências base. As personalizadas continuam como antes.
- **Modal da categoria padrão:** o **Nome exibido** e o **Grupo no Demonstrativo** (Operacional, Investimento, Financiamento ou Não Operacional) são livres. O **ID interno** e o **Sentido** (Entrada/Saída) ficam **travados**. A **transferência entre contas próprias** só aceita mudar o nome: o grupo fica fixo em "Transferência" para ela continuar fora do fluxo líquido. Se a categoria já foi ajustada, o modal ganha **"Restaurar original"**; digitar de volta o nome e o grupo originais também remove o ajuste.
- **Onde fica gravado:** em `config/dfc.ajustesPadrao` (`{ [id]: { nome, grupo } }`, só o que difere do original), no mesmo documento das regras, do De-para e das categorias personalizadas, que quem tem "Regras de classificação" (`fcx.dfc.regras`) já grava. A constante `DFC_CATEGORIAS` **não é alterada**: o motor devolve a categoria já ajustada em `DFC.categorias()` / `DFC.cat()`. Regras, De-para FCX → DFC, classificações manuais e cadastro de fornecedores continuam apontando pelo **ID**, então nada se perde.
- **Reflexo imediato:** o nome e o grupo novos valem nos seletores de regras e de categoria dos Extratos OFX, na DFC do mês (o bloco muda de grupo), no Realizado × Previsto, nas exportações (PDF A4, Excel e CSV) e no **Resumo Executivo Oficial (A4)**. Mudar o **grupo** regrava a base mensal da DFC (`dfc/AAAA-MM`); só renomear não precisa. O log registra o nome e o grupo antigos e novos.
- **Selo e textos:** a linha ajustada mostra o selo **"ajustada"** (o nome e o grupo originais no `title`). Os textos que citavam "Pagamento a fornecedores" e "Outras entradas operacionais" como destino padrão (Regras e cadastro de Fornecedores e Clientes) passam a mostrar o nome ajustado.
- **Recurso desligado:** nomes e grupos voltam aos originais (os ajustes gravados ficam preservados e voltam a valer ao religar); padrão sem lápis nem lixeira, como na v14.08.
- **Limites a saber:** (1) mudar o **grupo** muda o que o demonstrativo e o Resumo Executivo mostram: uma categoria de **saída** movida para **Financiamento** entra no serviço da dívida (DSCR) do Resumo, e as de entrada/saída movidas para fora do Operacional saem da geração operacional; o modal avisa; (2) o nome ajustado não pode repetir o de outra categoria; (3) planilhas de importação de Fornecedores e Clientes passam a casar a categoria pelo **nome atual** (ou pelo ID); o nome antigo deixa de ser reconhecido; (4) nenhuma mudança de servidor: `config/dfc` já aceita a gravação por quem tem `fcx.dfc.regras`.
- **Teste (dados fictícios):** `tests/teste-dfc-categorias-padrao-1409.mjs` com **72** verificações em Node (roda o código real de `public/index.html`, sem navegador e sem banco): validação do ajuste (nome saneado, 3 a 60 caracteres, sem repetir, os 4 grupos), ID e sentido nunca mudam, transferência só renomeia, reflexo em `categorias()`, seletor por sentido, demonstrativo, consolidação e Resumo A4, referências pelo ID, exclusão da padrão bloqueada, registros quebrados ignorados, recurso desligado e religado, a tabela (21 lápis, lixeira desabilitada, selo, permissão), o modal (campos travados, validações, gravação, recálculo só quando o grupo muda, restaurar) e a constante `DFC_CATEGORIAS` idêntica à da v14.08 (md5).
- **Uso:** `node tests/teste-dfc-categorias-padrao-1409.mjs`.


## v14.10 · Economia silenciosa de consumo no Netlify: sincronização inteligente e imagens compactadas (recurso `gestao_v1410`)

Versão **só de front-end** (`public/index.html`), sem mudar nenhuma tela e sem nenhum botão novo. O objetivo é gastar menos invocações das Netlify Functions e deixar o Postgres do Netlify entrar em suspensão (*scale-to-zero*) quando ninguém está usando o painel. O backend **não mudou** (`mudancas.mjs`, `arquivos.mjs` e todo o `netlify/` são idênticos aos da v14.09). Com o recurso `gestao_v1410` ativo só na **Homologação**; em **Produção** e na **Falco** passa a valer depois de **"Liberar Versão em Produção"** (a página passa do ciclo antigo para o novo na hora, sem recarregar).

### 1 · Sincronização entre computadores (polling inteligente)

- **Aba em uso:** consulta a cada **30 s** (antes: 5 s). A primeira consulta continua saindo 5 s depois de abrir o painel.
- **Aba oculta ou minimizada** (`document.visibilityState === 'hidden'`): **nenhuma** consulta (antes: uma a cada 30 s).
- **Ociosidade de 10 minutos:** sem movimento do mouse, clique, rolagem, toque ou tecla por 10 minutos, **nenhuma** consulta, mesmo com a aba aberta na tela (madrugada, domingos e feriados). Os eventos são vigiados na página e também **dentro do iframe do FCX** (mesma origem), para não tratar como ocioso quem trabalha só no FCX.
- **Retomada imediata e silenciosa**, sem botão, aviso ou modal: ao **voltar para a aba** (`visibilitychange` para visível ou `focus`), ao **voltar a mexer** depois da ociosidade e ao **concluir qualquer gravação** do painel. Pedidos seguidos viram **uma** consulta: no máximo uma a cada 2 s na volta/interação e uma a cada 5 s em rajada de gravações (a primeira sai na hora). Com a aba oculta nem a gravação consulta (a volta à aba é quem sincroniza).
- **Falha de rede ou do servidor:** recuo progressivo **60 s → 120 s**; ao responder de novo volta aos 30 s. **Sessão encerrada (401):** a consulta para (sem insistir a cada ciclo) e tenta de novo na próxima volta, interação ou novo login.
- **Nada se perde na pausa:** o painel guarda o último número da fila de mudanças (`seq`) e, ao retomar, pergunta só o que mudou desde então. Como o servidor guarda o log de mudanças por **3 dias** (`faxina`), se a última consulta bem-sucedida tem **24 h ou mais** (fim de semana, feriadão), a volta **relê também todas as coleções vigiadas** (uma vez). Antes disso relê só o que mudou.
- **Outros temporizadores que mantinham o banco acordado seguem a mesma pausa:** a revalidação da sessão (a cada 60 s) e a publicação do Resumo do Recebível do relatório matinal (a cada 20 min). Ao voltar, a revalidação roda (já rodava ao voltar à aba) e o Resumo do Recebível é publicado se o que ficou adiado mudou ou passou de 20 min.
- **Recurso desligado:** vale exatamente o ciclo da v14.09 (5 s em uso, 30 s oculta, sem pausa por ociosidade, sem consulta por gravação).
- **Estimativa (por pessoa com o painel aberto, só as consultas de sincronização):** 8 h em uso passam de ~5.760 para ~960 consultas; aba oculta passa de ~120 por hora para 0; painel esquecido aberto à noite passa de ~720 por hora para 0 depois dos 10 primeiros minutos.

### 2 · Compactação transparente de imagens antes do envio

- **Quais:** `.jpg`, `.jpeg`, `.png` e `.webp`, no envio de anexos para o servidor (`Arquivos.enviar`: contratos, apólices, comprovantes, vouchers, PDF anexo) e nos termos assinados gravados em Base64 (`Arquivos.reduzirImagem`; a redução antiga de 2000 px/85 % passa a seguir a regra abaixo com o recurso ligado).
- **Regra:** o maior lado só é reduzido se passar de **1600 px** (proporcional, via `<canvas>`, respeitando a orientação EXIF) e a imagem é regravada em **JPEG com qualidade 0,82**; PNG transparente ganha fundo branco. A versão comprimida **só é usada quando fica menor** que o original; se não ficar (JPEG já otimizado), segue o original, o mesmo arquivo.
- **Intactos:** **PDF** (o mesmo arquivo, byte a byte, sem sequer abrir), GIF e qualquer outro tipo. Se o navegador não conseguir decodificar a imagem, segue o original, sem erro e sem aviso.
- **Limites preservados:** 5 MB por anexo e 15 MB por imagem de termo continuam conferidos **antes** da compactação, com as mesmas mensagens (uma imagem acima do limite continua recusada).
- **Nome e tipo:** a imagem compactada vira `.jpg` / `image/jpeg`; o nome, o tamanho e o tipo gravados no registro são os do arquivo final (o servidor confere partes e tamanho do que recebe).
- **Efeito no consumo:** o envio ocupa `1 + partes + 1` chamadas (partes de 1 MB). Uma foto de 2,7 MB passou de 5 chamadas para 3; fotos de celular de 3 a 5 MB costumam caber em uma parte só.
- **Sem passo novo:** acontece durante o envio atual, sem modal, aviso ou botão. A compactação leva cerca de 0,1 s por foto comum.

### O que esta versão NÃO resolve sozinha: a rotina de notificações a cada 5 minutos

A função agendada `notificacoes-agendadas.mjs` roda a cada **5 minutos, 24 horas por dia** (`schedule: '*/5 * * * *'`) e consulta o banco em cada rodada (alertas de falta de caixa, relatório das 07:30, IEO de segunda às 08:00, SLA às 08:30, confirmação do backup). Isso é uma ida ao Postgres a cada 5 minutos, a noite toda, e **por si só impede a suspensão automática do banco**, mesmo com todos os navegadores parados. A v14.10 **não mexe nela** porque os horários e a frequência (a falta de caixa é avisada a cada rodada) são decisão de negócio. Se a economia da madrugada for prioridade, as opções são: limitar o cron às horas de operação (por exemplo `*/5` só entre 10:00 e 01:00 UTC, mantendo a janela do backup das 02:59 UTC), ou espaçar para `*/15` fora do horário comercial. Fica para uma versão própria, com a sua decisão dos horários.

### Limites a saber

1. A pausa por ociosidade olha a interação na página e no iframe do FCX; uma janela de **outra origem** não é vista (o painel não abre nenhuma).
2. O relatório matinal das 07:30 usa o Resumo do Recebível mais recente: se ninguém usar o painel de madrugada, ele não é atualizado por uma aba esquecida aberta, e o relatório avisa que está defasado, como já fazia quando ninguém abria o painel.
3. Uma pessoa que fica parada a 9 min 50 s e volta a mexer continua sem pausa; o limite é contado desde a última interação.
4. Com a aba oculta, uma gravação que termina em segundo plano espera a volta à aba para sincronizar.
5. A compactação regrava a imagem em JPEG: texto pequeno em foto de documento continua legível a 1600 px, mas quem precisa do arquivo original em alta resolução deve anexá-lo como PDF.

### Teste (dados fictícios)

- `tests/teste-economia-netlify-1410.mjs`: **106** verificações em Node, em segundos, **sem navegador, sem banco e sem esperar de verdade** (relógio e temporizadores simulados rodam 24 h de ociosidade em milissegundos). Roda o código real de `public/index.html` (`SyncEco`, `NetlifyAdapter`, `ImgEco`, `Arquivos.enviar`/`reduzirImagem`) e confere: recurso desligado = ciclo da v14.09; 30 s em uso; pausa com a aba oculta; pausa aos 10 min (exata, sem timers pendentes); retomada imediata ao voltar à aba, mexer (os 8 eventos, inclusive no iframe) e gravar; coalescência de rajadas; recuo 60/120 s e volta a 30 s; 401; releitura geral só depois de 24 h; ativação no meio do uso; imagens (dimensões, qualidade, só-se-ficar-menor, PDF/GIF intactos, limites, menos chamadas); CSS, botões e ações idênticos aos da v14.09; servidor intacto; Regra de Ouro.
- **Uso:** `node tests/teste-economia-netlify-1410.mjs`.
- Verificado também fora do ZIP: 32 mutações do código do painel (todas detectadas pelo teste), 34 verificações no Chromium real (mouse, teclado, clique, rolagem, iframe e canvas de verdade, com o relógio simulado do Playwright) e 18 ponta a ponta com o servidor das funções e um Postgres local (Produção antes e depois de liberar o recurso, `/api/arquivos` com imagem compactada e PDF idêntico, dois computadores com um ocioso e outro com a aba oculta).

## v14.11 · Lote 1 de melhorias: pagamentos em acordeão, menu com rolagem, reajuste de contratos pelo Banco Central, Locatários/Locadores e importação de até 30.000 linhas (recurso `gestao_v1411`)

Ativa na **Homologação**; em **Produção** e na **Falco** só depois de "Liberar Versão em Produção" (o recurso vale na hora, sem recarregar). Com o recurso desligado, o painel é o da v14.10. A **Regra de Ouro** foi preservada: `fcx.html`, `contabilidade.html` e `contabilidade_v1391.html` não foram alterados, e nada muda no layout do celular (`<= 768 px`) da Tela Inicial.

### 1 · Tela Inicial: Pagamentos (Saídas) em acordeão (só acima de 768 px)

- Em notebook e iPad (largura acima de 768 px), a lista "Títulos a pagar hoje" das Saídas do Dia ganha um cabeçalho com o resumo (**quantidade de lançamentos e valor total**) e mostra por padrão só os **3 títulos mais próximos do vencimento**, com o botão **"Ver todos os X pagamentos ▾"** / **"Recolher ▴"**.
- Os títulos ocultos continuam no HTML (só levam o atributo `hidden`), então **Selecionar Todos**, os totais e **Finalizar Aprovações** valem para o lote inteiro, aberto ou recolhido. Abrir e fechar não refaz a tela (mantém a rolagem e as marcações).
- A ordem é a do vencimento (empate mantém a ordem do FCX). Atenção: nas Saídas do Dia o vencimento de cada título é a **data da saída no FCX**, então, num dia comum, todos têm a mesma data e aparecem os 3 primeiros na ordem do FCX; a ordenação por data só faz diferença quando há saídas de fim de semana ou feriado que caem no mesmo dia útil.
- **Celular e tablet pequeno (`<= 768 px`):** exatamente como antes (sem cabeçalho, sem botão, sem título oculto).

### 2 · Menu lateral com rolagem própria

- A lista de módulos rola sozinha (`overflow-y: auto`, barra fina e discreta, sem rolagem lateral) em telas de menor altura; a barra superior (logo e ambiente) e o bloco do usuário ficam sempre visíveis. A posição da rolagem é mantida quando a tela é redesenhada e o módulo ativo é trazido para a vista.
- Vale de 769 px para cima (acima de 900 px, o menu fixo à esquerda; de 769 a 900 px, a gaveta). Em `<= 768 px` nenhuma regra nova vale (o CSS computado do menu é idêntico com e sem a versão).

### 3 · Controles de Contratos (Módulo 3)

**Reajuste anual com o botão "Recalcular"** (contratos de locação e "outros" ativos, com valor e índice):

- **Índices e série oficial:** `IPCA` = série **433**, `IGP-M` = **189**, `INPC` = **188** da API pública e gratuita do Banco Central (SGS, `https://api.bcb.gov.br/dados/serie/bcdata.sgs.<série>/dados?formato=json&dataInicial=…&dataFinal=…`). A consulta é feita **pelo navegador**, uma requisição por série (guardada em memória por 6 horas, limite de 9 s), sem chave e sem passar pelo servidor do painel. `% Manual` e `IVAR` (sem série pública) pedem o percentual; `Fixo (sem índice)` não tem o botão.
- **Cálculo:** índice acumulado = produto dos fatores `(1 + i/100)` dos **12 meses que terminam no mês anterior ao da data-base** (data-base 01/03/2026 → mar/2025 a fev/2026), arredondado a 2 casas; novo valor = valor atual × (1 + acumulado/100), em centavos.
- **Prévia comparativa** antes de gravar: **Valor atual**, **Índice acumulado no período** e **Novo valor reajustado** (com a origem, a variação mês a mês e o histórico de reajustes do contrato). Se o acumulado for negativo, uma caixa permite não reduzir o aluguel (piso de 0%).
- **Fallback manual:** API fora do ar, tempo esgotado, mês ainda não divulgado (a janela exige os 12 meses) ou índice sem série: aparece o motivo e o campo **% manual**; nada é inventado.
- **Ao confirmar:** regrava `valor_atual` no contrato, acrescenta ao `historico_reajustes` {data-base, índice, percentual aplicado, acumulado, de, para, fonte (API do Banco Central ou percentual manual), janela, série, quem e quando}, leva a **data-base para +1 ano** e aciona o Motor de Aluguel, que atualiza a projeção/provisão de ocupação no FCX (o mesmo caminho de qualquer alteração de contrato). O mesmo ciclo não é reajustado duas vezes sem a confirmação "Reajustar mesmo assim".
- **Ação em lote** ("Recalcular reajustes", no topo da lista): tabela com os contratos de data-base vencida (há opção para incluir os de data-base futura), % manual por linha, soma "Aluguel mensal: de → para" e confirmação única. No lote, o índice acumulado negativo **não reduz** o aluguel (piso de 0%). Contratos que mudaram depois da prévia são pulados e avisados.
- Novo campo opcional **% manual de reajuste (a.a.)** no contrato e a opção **% Manual** na lista de índices.

**Aba "Locatários / Locadores"** (coleção `partes_contratuais`, permissões `lojas.contratos.ver/editar/excluir`, nunca para o perfil Loja): Razão Social ou Nome, Nome Fantasia, CPF/CNPJ (validados, sem repetição), Chaves PIX (as mesmas regras dos Fornecedores; uma chave não fica em dois cadastros), Loja/Contrato vinculado (vários) e Categoria DFC padrão das saídas (padrão: **Aluguel, condomínio e ocupação**) e das entradas.

**Cruzamento com os Extratos OFX e a DFC** (v14.05/v14.09): as partes entram no índice do cruzamento como cadastros virtuais (`pc-…`). A saída bancária cujo histórico contenha o **CPF/CNPJ**, a **chave PIX**, a **razão social ou o nome fantasia** (inclusive o nome **truncado pelo banco**, com pelo menos 12 caracteres, no fim do histórico) de uma parte é vinculada a ela e classificada na categoria dela ou, se não houver, em **Aluguel, condomínio e ocupação**; a entrada do locatário vai para a categoria de entrada do cadastro ou para "Outras entradas". Regras: classificação manual e regra explícita da DFC continuam valendo antes do cadastro; em chave ou nome igual num Fornecedor e numa parte, vale a **parte**. Para aplicar a partes cadastradas depois aos extratos já importados, use **"Cruzar Fornecedores, PIX e Contas a Pagar"** na DFC.

### 4 · Fornecedores e Clientes: importação de até 30.000 linhas

- **Limite:** de 2.000 para **30.000 linhas** (30 MB). Vale com a v14.11 ligada **e** o banco do Netlify; sem isso, segue o limite e o caminho antigos.
- **Navegador:** leitura e validação em fatias de ~25 ms (a tela continua respondendo), com `Map`/`Set` no planejamento, **barra de progresso** em cada etapa (lendo, validando, conferindo cadastros e chaves PIX) e prévia antes de gravar.
- **Servidor:** novo `POST /api/docs/massa` (`{ colecao: 'parceiros', docs: [{ id, dados }] }`): até **2.000 cadastros e 5 MB por requisição**, **uma única instrução SQL** (`INSERT … SELECT … FROM unnest(…) ON CONFLICT (caminho) DO UPDATE`, idempotente) e **uma** linha de mudança para os outros computadores, numa transação, com a mesma permissão de editar Fornecedores. Só aceita a coleção `parceiros`.
- **Gravação:** lotes de até 2.000 (e ~4,5 MB), com barra "Gravando cadastros: X de N · lote K de L"; falha transitória (rede, 5xx, 429) é repetida até 3 vezes; lote grande demais (413) é dividido ao meio; perda de acesso (401/403) para e informa quantos ficaram de fora; erro permanente de um lote não impede os demais e o relatório lista o que faltou. Reimportar o mesmo arquivo não duplica nada (retoma de onde parou).
- **Log de Auditoria:** **um único** registro com o resumo consolidado (linhas lidas, novos, atualizados, chaves PIX vinculadas, recusadas, chaves duplicadas, lotes).
- **Lista paginada (achado do teste de navegador):** a tela de Fornecedores e Clientes desenhava todas as linhas e ordenava a base várias vezes por tela; com 24.000 cadastros o navegador caiu. Com a v14.11 a lista mostra **200 por página** ("Mostrando 1–200 de 24.000 · página 1 de 120", Anterior/Próxima; a busca e os filtros valem para a base inteira) e a ordenação fica em cache por alteração da coleção.

### Mudanças no servidor (aditivas)

`netlify/functions/docs.mjs` (rota `/api/docs/massa`), `netlify/lib/documentos.mjs` (`gravarMassa`), `netlify/lib/regras.mjs` e `netlify/lib/permissoes.mjs` (coleção `partes_contratuais`). Nenhuma migração, variável de ambiente ou rota existente foi alterada.

### Limites a saber

1. A consulta ao Banco Central parte do navegador de cada pessoa: precisa de internet e a API pública precisa responder (senão, % manual). Fora do Netlify (dentro do claude.ai) a rede costuma bloquear o domínio e vale o % manual.
2. O Banco Central divulga o IPCA e o INPC em torno do dia 10 do mês seguinte e o IGP-M perto do fim do mês: para uma data-base logo no início do mês, o último mês da janela pode ainda não existir (o painel avisa e pede o percentual).
3. A importação de `.xlsx` com 30.000 linhas é lida de uma vez pela biblioteca de planilhas (alguns segundos com a tela parada nessa etapa); prefira `.csv` para arquivos muito grandes.
4. A lista paginada vale só com o recurso ligado; a primeira ordenação de 24.000 cadastros leva uma fração de segundo por alteração da coleção.
5. O cruzamento das partes com extratos já importados não é automático: rode "Cruzar Fornecedores, PIX e Contas a Pagar" depois de cadastrar ou alterar uma parte.

### Teste (dados fictícios)

- `tests/teste-lote1-1411.mjs`: **101** verificações em Node (sem banco): flag e Regra de Ouro; CSS do menu e do acordeão (só `@media`; bloco de celular intacto); acordeão (3 visíveis, ordem, abrir/recolher, celular igual ao legado); cálculo IPCA/IGP-M/INPC com a API simulada, fallback manual e regravação do "Recalcular" (individual e em lote); vínculo Locador/Locatário × OFX × DFC (documento, chave PIX, nome truncado, sem falso positivo); parser e planejamento de **25.000 linhas** em lotes (idêntico ao síncrono, reimportação idempotente, retomada, nova tentativa, divisão em 413, 403, um só log); lista paginada e ordenação em cache; regras e rota do servidor. **Uso:** `node tests/teste-lote1-1411.mjs`.
- `tests/teste-massa-db-1411.mjs`: **18** verificações do `/api/docs/massa` com o **Postgres local** (2.000 numa requisição, idempotência, permissões, 401/403/400/413, uma linha de mudança por lote). **Uso:** `bash tests/preparar-banco.sh`, `NETLIFY_DB_URL=… node tests/servidor-local.mjs 8890` e `node tests/teste-massa-db-1411.mjs`.
- Ajustados por causa desta versão: `tests/teste-economia-netlify-1410.mjs` (CSS e contagem de botões aceitam a v14.10 ou a v14.11) e `tests/teste-ofx-contas-pagar-dfc-1409.mjs` (o ambiente de teste passa a incluir o cadastro de partes).
- Verificado também fora do ZIP, no Chromium com o servidor local e o Postgres (68 verificações, a API do Banco Central simulada): acordeão a 1440, 1024 e 820 px e igual ao legado a 768 e 390 px; menu com rolagem em 1440×560, 1280×640, 1024×600 e 820×600; Recalcular IPCA, fallback com a API fora do ar e lote; cadastro de locador pela tela e cruzamento de um extrato; importação de 25.000 linhas (24.000 gravadas em 12 requisições, barra de progresso, um log, reimportação sem duplicar) e lista paginada.

## v14.12 · Lote 2 de melhorias: Solicitação de Férias com calendário, organograma como base de aprovação, viagens com aprovação delegada ao Financeiro, prestação por foto, devolução × OFX e ClickBus (recurso `gestao_v1412`)

Ativa na **Homologação**; em **Produção** e na **Falco** só depois de "Liberar Versão em Produção" (o recurso vale na hora, sem recarregar). Com o recurso desligado, o painel **e o servidor** são os da v14.11 (testado: o gestor de topo segue com 403 nos salários, só o Master encerra adiantamentos, nenhum botão novo aparece). A **Regra de Ouro** foi preservada: `fcx.html`, `contabilidade.html` e `contabilidade_v1391.html` não foram alterados e nenhuma linha foi acrescentada dentro das três regiões protegidas do `index.html` (OFX/contas, Adquirentes e Credsystem Módulo 6); o cruzamento OFX × devolução é um invólucro **fora** delas, que chama a importação original e só depois roda o cruzamento.

### 1 · Cadastro de Funcionários (RH)

**Botão "Solicitação de Férias"** no bloco "Férias e folgas" da ficha do colaborador (quem pode pedir: o próprio colaborador, o Master, os superiores dele no organograma, quem edita a equipe no seu escopo e o RH). O modal tem:

- **Dois seletores antes das datas:** "Vender 1/3 das férias (Abono Pecuniário, 10 dias, art. 143 da CLT)" e "Adiantar a 1ª parcela do 13º salário (Lei 4.749/1965)".
- **Calendário interativo** de dois meses (toque no primeiro e no último dia; navegação por mês; um chip por período). **Até 3 períodos**, somando no máximo 30 dias de gozo (20 com abono). **Regras da CLT conferidas na hora** pela mesma função de validação da v13.93: um dos períodos com **14 dias corridos ou mais** e os demais com **5 ou mais** (passam 15 + 15, 14 + 8 + 8 e 20 + 10).
- **Prévia estimada em tempo real (bruta):** valor do dia = salário ÷ 30; férias = valor do dia × dias de gozo; 1/3 constitucional; com abono, 10 dias vendidos + 1/3 do abono; com o 13º, **50% do salário**. Mostra uma linha por componente e o total, com a nota "Estimativa bruta, sem INSS, IRRF, descontos nem médias de horas extras/comissões: o valor final é calculado pela folha". Exemplo: salário R$ 3.000,00, 14 dias, abono e 13º = 1.400,00 + 466,67 + 1.000,00 + 333,33 + 1.500,00 = **R$ 4.700,00**.
- **Respeita a visibilidade do salário:** quem não vê o salário daquele colaborador (permissão "Pode ver salários", Master ou gestor de topo da árvore) **não recebe nenhum valor**, só o aviso de que a prévia está indisponível; as datas e as regras da CLT continuam sendo conferidas.
- O pedido não altera o cadastro: vai para a **Liberação Remota** com o resumo (períodos, abono, 13º) e só entra no cadastro depois de aprovado.

**Organograma como base da aprovação (objeto `Org12`):** Férias e Folgas de todos os colaboradores abaixo de um nó de topo seguem para o gestor daquele ramo **mesmo com o campo "Gestor direto" vazio**. O pedido grava `rota` = `{ cadeia, imediato, topo }` (só ids) e `gestorId` (o Gestor direto, se houver; senão o superior imediato). Decide quem está na cadeia (superior imediato e todos acima, até o topo do ramo) ou o Master; **ninguém decide o próprio pedido**; sem superior no organograma, volta para o Master. O cartão da Liberação mostra para quem o pedido foi roteado.

**Salários pela árvore (cliente e servidor):** o gestor de topo (quem tem subordinados: "Gestor direto", responsável de departamento, sub-departamentos e lotados) passa a ver o salário **só da própria árvore**. No servidor, `GET /api/docs?caminho=salarios/<id>` devolve 200 se o colaborador está na árvore do usuário e **403 para outros setores**; a listagem da coleção `salarios` vem filtrada e o aviso de mudanças (`/api/mudancas`) chega ao gestor. **Master e quem tem a permissão global `rh.ver_salarios` continuam vendo todos** (a regra nova só acrescenta). Ler pela árvore não dá direito de gravar nem excluir salário. Vale só para o perfil Operacional (Loja nunca) e só com o recurso ligado; o servidor guarda a árvore em memória por 20 s.

### 2 · Viagens e Adiantamentos

**Permissão delegável `viagens.aprovar`** (Gestão de Acessos › Viagens, opção extra que só existe com o recurso; entrou na matriz `netlify/lib/matriz-acessos.mjs`, a que o `netlify/lib/permissoes.mjs` lê, e na tabela do painel). Para usuários **do setor Financeiro** (departamento com "FINANC" no nome ou abaixo de um, como lotado ou responsável) **com a permissão marcada**: aprovam solicitações de viagem e encerram prestações de contas pela Liberação Remota e pela tela de Adiantamentos. **Autoaprovação bloqueada**: o aprovador não pode ser viajante (inclusive em viagem em grupo) nem quem abriu o pedido; perfil Loja nunca aprova. **No servidor** a regra é imposta em `POST /api/contabil/adiantamentos/encerrar` (403 com mensagem própria para "sem permissão", "fora do Financeiro" e "autoaprovação"). A exclusão de adiantamento já pago continua só do Master.

**Notificações padronizadas** (9 eventos: solicitada, aprovada, recusada, paga, prestação enviada, aguardando OFX, crédito localizado, encerrada, encerrada sem OFX):

- **WhatsApp, resumo curto:** status, viajante, destino, período, valor, link direto do painel e a frase "O documento oficial segue por e-mail".
- **E-mail, versão completa:** assunto, corpo em HTML e texto com todos os fatos, pronto para **anexar o PDF-resumo oficial** (`comPdf`) ou apenas referenciá-lo (Viagens › Imprimir Resumo).
- O gerador do servidor (`netlify/lib/notif-viagem-1412.mjs`) e o do painel (botão **"Resumo para WhatsApp e e-mail"** no cartão da viagem, com "Copiar texto", "Abrir no WhatsApp" e "Abrir no e-mail") geram **exatamente o mesmo texto** (testado).

**Prestação de contas mobile-first com câmera:** o campo de comprovante usa `accept="image/*,application/pdf" capture="environment"` (abre a câmera traseira no celular) e há o botão "Escolher da galeria ou arquivo". A foto é reduzida antes de anexar e o **SHA-256 do arquivo** é calculado no navegador. A **IA lê** Data, CNPJ e Estabelecimento, Valor Total, Categoria e Nº do cupom/nota, preenche o formulário **para conferência** (mostra a confiança e valida os dígitos do CNPJ) e nada é gravado sem o usuário revisar. Conferências antes de gravar a despesa: **período da viagem**, **política** (por exemplo bebida alcoólica) e **teto diário** (alertas que pedem confirmação, a glosa segue com o Financeiro); **duplicidade** (bloqueia): mesmo arquivo (hash), mesmo cupom do mesmo emitente (CNPJ) ou a combinação CNPJ + data + valor, na própria prestação ou em outra viagem. Para o Financeiro há a opção "lançar mesmo assim" (a despesa fica marcada para a análise).

**Devolução de saldo × extrato OFX:**

- **Comprovante da devolução** lido por IA e validado: valor igual ao saldo (±R$ 0,05), data não futura e não anterior ao pagamento do adiantamento; devolução incompleta ou maior que o saldo é recusada.
- **Novo status "Aguardando Confirmação Bancária (OFX)":** o viajante conclui a parte dele e o adiantamento **não encerra**.
- **Cruzamento ao importar o OFX** (Entradas × devoluções pendentes): valor ±R$ 0,05 **e** data na janela de −1 a +5 dias do comprovante **ou** nome do viajante no histórico; um crédito para uma viagem, crédito já vinculado não é reaproveitado, chave = conta + id do lançamento. O crédito aparece no cartão da viagem como **"Crédito localizado no banco"**.
- **Só o Master ou o aprovador do Financeiro clica "Encerrar Adiantamento"** (antes, "Encerrar Prestação de Contas"). **Encerrar antes de o crédito aparecer no OFX exige justificativa** (mínimo de 10 caracteres, máximo de 500; o servidor responde 422 sem ela) e **grava o evento `encerramento_viagem_sem_ofx` no Log de Auditoria** (ramo `auditoria/<uid>/dias/<dia>`, na **mesma transação** do encerramento), além de `acerto.semOfx` e do estado final da devolução (`encerrada_sem_ofx`, ou `confirmada_ofx` quando o crédito já tinha sido localizado). A regra vale também para o Master.

**ClickBus:** com transporte Ônibus (viagem aprovada ou aguardando prestação), o cartão ganha **"Comprar Passagem no ClickBus"**, que abre `https://www.clickbus.com.br/onibus/<origem-uf>/<destino-uf>?departureDate=AAAA-MM-DD` (por exemplo `recife-pe/caruaru-pe`). Sem cidade e UF de origem e destino, o painel avisa em vez de abrir.

### Mudanças no servidor (aditivas, todas atrás do recurso `gestao_v1412`)

Arquivos novos: `netlify/lib/arvore-rh.mjs` (árvore do organograma, salários liberados, aprovador delegado), `netlify/lib/viagem-1412.mjs` (regra do encerramento sem OFX e gravação do evento de auditoria) e `netlify/lib/notif-viagem-1412.mjs` (e-mail e WhatsApp das viagens). Alterados: `netlify/lib/documentos.mjs` e `netlify/functions/mudancas.mjs` (salário pela árvore), `netlify/functions/contabil.mjs` (rota `encerrar`: aprovador delegado, status `aguardando_ofx`, justificativa e auditoria) e `netlify/lib/matriz-acessos.mjs` (opção `viagens.aprovar`). Nenhuma migração, variável de ambiente ou rota nova.

### Limites a saber

1. **A leitura por IA só existe dentro do claude.ai** (capacidade `sample`). No site do Netlify este pacote não tem chamada de IA no servidor: o comprovante é anexado, o hash é calculado e as conferências (duplicidade, período, política, teto) funcionam sobre o que for digitado, mas os campos **não são preenchidos sozinhos**; o painel avisa "Leitura por IA indisponível neste acesso". Levar a leitura para o Netlify exigiria uma função de servidor com chave de API de IA (decisão e custo do negócio).
2. A aprovação **delegada** é imposta no servidor só no **encerramento** do adiantamento. A aprovação da solicitação e da prestação pela Liberação Remota segue a regra do painel (a gravação de documentos genéricos continua checada no cliente, como já era para o Master e os gestores).
3. A **detecção de duplicidade** olha as viagens que o usuário consegue ler.
4. O vínculo do crédito do OFX com a viagem (`devolucao12.ofx`) é gravado pelo painel de quem importa o extrato (Financeiro); o servidor confia nessa marca ao decidir se exige justificativa. O que o servidor garante é o 422 e a auditoria quando a marca não existe.
5. O padrão de endereço do ClickBus (`/onibus/<origem-uf>/<destino-uf>`) foi conferido no portal; **o parâmetro de data `departureDate` não pôde ser confirmado**: se o portal não o aceitar, ele apenas ignora a data.
6. O gerador de notificações das viagens **não está ligado aos disparos automáticos** da Central de Notificações: nesta versão ele entrega o texto pelo botão do cartão da viagem e a função do servidor, pronta para ser chamada.
7. Na devolução com mais de um viajante (repasse individual) há **um comprovante para a soma dos saldos positivos**.
8. A cadeia regional/loja do organograma serve ao **roteamento de Férias e Folgas**; a visibilidade de salários usa só a árvore de subordinação (Gestor direto, responsável e departamentos).
9. O recorte de salários por árvore é **garantido pelo servidor do Netlify** (200 na árvore, 403 fora). Fora do Netlify (painel dentro do claude.ai, sem servidor próprio) o cliente só **esconde** o que não é da árvore: quem filtra a leitura da coleção `salarios` é a regra de acesso da plataforma, que não foi alterada.

### Teste (dados fictícios)

- `tests/teste-lote2-1412.mjs`: **100** verificações em Node, sem navegador e sem banco, sobre o código real do painel e do servidor: recurso e Regra de Ouro; estimativa de férias + 1/3 + abono + 13º, calendário e regras da CLT; prévia só para quem vê o salário; roteamento pelo organograma (colegas e outros ramos não decidem; sem autoaprovação); salário por árvore; permissões delegadas do painel × servidor; resumo de WhatsApp e e-mail (painel = servidor, PDF anexado ou referenciado) e ClickBus; leitura de recibo por IA, duplicidade (hash, cupom, CNPJ + data + valor) e política/período/teto; devolução × OFX (±R$ 0,05, janela de datas, nome, um crédito por viagem) e encerramento sem OFX com justificativa e o evento no Log de Auditoria. **Uso:** `node tests/teste-lote2-1412.mjs`.
- `tests/teste-lote2-1412-servidor.mjs`: **24** verificações com o **Postgres local** e HTTP real: salário 200 na árvore e 403 fora dela (rota, listagem, aviso de mudanças, gravação negada, Master e `rh.ver_salarios` intactos), aprovador delegado no `encerrar` (permissão, setor, autoaprovação, recurso desligado, 409) e justificativa 422 + evento `encerramento_viagem_sem_ofx`. **Uso:** `bash tests/preparar-banco.sh`, `NETLIFY_DB_URL=… node tests/servidor-local.mjs 8890` e `node tests/teste-lote2-1412-servidor.mjs`.
- Bateria antiga de navegador (21 testes locais, painel local com a v14.12 ligada), **comparada com a mesma bateria sobre a base da v14.11**: as falhas são as mesmas de antes (testes que comparam as regiões protegidas e o número de botões de arquivo com versões antigas) e há **três diferenças esperadas desta versão**: o botão do acerto passa a se chamar "Encerrar Adiantamento" (o teste da v13.88 procurava "Encerrar Prestação de Contas"), o gestor de topo passa a carregar os salários da própria árvore (o teste da v13.93 esperava que nenhum gestor carregasse a coleção) e o varredor de botões de arquivo conta os 4 campos novos de câmera (a falha de `par-importar-arq` já existia na v14.11).
- Ajustados por causa desta versão: `tests/teste-economia-netlify-1410.mjs` (contagem de botões da v14.12 e hash do `mudancas.mjs`) e `tests/teste-lote1-1411.mjs` (o CSS do Lote 1 termina onde começa o do Lote 2).
- Verificado também fora do ZIP, no Chromium com o servidor local e o Postgres (**26 verificações**): recurso desligado e ligado e de novo desligado; ficha, modal de férias (calendário, CLT em tempo real, prévia de R$ 1.866,67 e de R$ 4.700,00), pedido roteado ao Gerente Financeiro sem "Gestor direto", decisão pelo gestor de topo, salário por árvore (200 e 403 reais), ClickBus, resumo de WhatsApp e câmera da prestação. **A leitura por IA, a API do Banco Central e a rede foram simuladas ou ficaram de fora**, e a importação de um OFX real pela tela não foi exercitada no navegador (o cruzamento foi testado sobre o código real em Node).


## v14.18 · Contratos × Conta Bancária × Lojas e ECs em tabela única, Taxa Efetiva com Antecipação Apurada, Saldo a Receber com abatimento mensal e Auditoria de Adquirentes × DFC (recurso `gestao_v1418`)

Recurso novo, **dependente da `gestao_v1417`**. Ativo na **Homologação**; em **Produção** e na **Falco** só depois de "Liberar Versão em Produção" (vale na hora, sem recarregar). **Desligado = comportamento da v14.17.** Nenhuma migração, variável de ambiente, rota ou mudança no servidor: os dados novos usam coleções que já existem (`adq_contratos` ganha os campos que já tinha, `config/dfc_cartoes18` é um documento novo do `config`). **`fcx.html`, `contabilidade.html` e `contabilidade_v1391.html` não foram alterados** (o `fcx.html` continua com o md5 da v14.17, `640800e0547886185e7231087f3260d0`).

### Item 1 · Auditoria de Adquirentes › Regras de Taxa Contratuais: **Contratos × Conta Bancária × Lojas e ECs**

- **Tabela única.** A tabela de contratos e a de vínculos de lojas viraram uma só: **Adquirente · Empresa / CNPJ · Conta Bancária (OFX) · Lojas Vinculadas · ECs · Bandeiras com Taxa · Lotes · Ações**, uma linha por contrato (Adquirente + Empresa). Botões: **+ Contrato**, **Editar**, **Remover**, **Vincular conta** (regra de taxa sem contrato) e os novos **Puxar do Cadastro** (na linha) e **Puxar Lojas e ECs do Cadastro (todos)**.
- **Auto-sincronização com o Cadastro de Lojas (Módulo 2).** O contrato lê sozinho as **filiais ATIVAS** que têm aquela adquirente e a empresa do contrato e traz o **código da loja** (2 dígitos, como a coluna Loja do ERP) e o **EC**. A empresa de cada linha de adquirente vem da **Empresa escolhida na loja**; sem ela, do **CNPJ do EC/TEF** e, por último, do **CNPJ da loja** (mesma raiz). Filial inativa e linha de outra adquirente ou de outra empresa **não entram**.
- **Nada é atribuído por palpite.** Com mais de um contrato da mesma adquirente, a linha **sem empresa definida** não vai para nenhum (aparece em "sem empresa definida" para o usuário escolher a Empresa no cadastro da loja); linha **sem EC** entra como loja, mas não gera EC vazio e vem avisada.
- **Só soma.** "Puxar" junta ao contrato o que falta e **mantém o que já estava** (inclusive lojas digitadas à mão que não estão no Cadastro). As linhas que o Cadastro completaria vêm marcadas com **"+ no Cadastro"** e um aviso no topo. **"Puxar (todos)"** lista o impacto por contrato e pede **dupla confirmação de alteração** (não de exclusão); com tudo igual, só avisa. Cada gravação passa pela auditoria como qualquer edição de contrato.
- **Modal Novo contrato / Editar:** ao escolher **Adquirente + Empresa / CNPJ** o modal já **lê o Cadastro de Lojas**, pré-preenche Lojas e ECs, mostra a **prévia** (as linhas do Cadastro usadas, avisos de "sem empresa", "outra empresa" e "sem EC") e tem o botão **Puxar Lojas e ECs do Cadastro de Lojas**; o que o usuário digitou à mão não é apagado. Em **Editar**, Adquirente e Empresa ficam travadas.

### Item 2 · Taxa Efetiva: Antecipação Efetiva e Antecipação Efetiva Apurada (Painel Executivo e Laudo A4)

- **Antecipação Efetiva = a coluna exata do arquivo quando a adquirente entrega:** SafraPay (**Taxa de Antecipação** dos Recebíveis) e Credsystem (coluna **Antecipação** do ERP, Adq 304).
- **Antecipação Efetiva Apurada (Getnet):** o extrato detalhado da Getnet traz só Bruto e MDR. A antecipação passa a ser **apurada contra o OFX da conta do contrato, dia de repasse a dia de repasse**: `(Bruto − MDR efetivo) − líquido efetivamente creditado`. A apuração considera a **virada de mês / trânsito** (repasse ainda sem crédito fica fora e entra pela estimativa do contrato, rotulado como "apuração OFX + estimativa"), **desconta as tarifas/aluguel de POS e as retenções debitados no OFX** que explicam um crédito a menor e usa o **teto/estimativa do contrato** como referência de excesso (folga: só acima de 5% da estimativa **e** R$ 1,00).
- **A linha sempre diz de onde veio o número:** coluna da adquirente · apurada no OFX · apurada no OFX + estimativa do contrato · coluna Antecipação do ERP · estimativa pelo contrato. **Nunca fica em R$ 0,00 sem explicação** quando há antecipação contratada sobre vendas a crédito. A origem aparece na tabela "Composição da taxa efetiva", no CSV dos KPIs e no parecer sugerido do Laudo ("Origem da antecipação: …").
- **Leitor de débitos do OFX ampliado** (conta do contrato, só dentro do mês da competência): **Tarifas e aluguel de POS** (ALUGUEL POS/MAQ, MAQUINETA, TARIFA CARTÃO/POS, MENSALIDADE de POS, COMISSÃO com adquirente) e **Retenções / Chargebacks** (RETENÇÃO, RETIDO, BLOQUEIO, CHARGEBACK, CONTESTAÇÃO, CANCELAMENTO, ESTORNO, AJUSTE, DÉBITO ADQ e débito que cita Getnet / Safra / Credsystem). Termos genéricos só valem se o histórico fala de cartão ou adquirente, e pagamento/transferência comum que apenas cita a adquirente **não** é retenção. As duas linhas somam na **Taxa Efetiva Total** (MDR + antecipação + tarifas de POS + retenções).

### Item 3 · Saldo a Receber de Antecipações / Recebíveis Futuros com **abatimento mensal**

- Novo controle no **Painel Executivo** (e no **Laudo A4**, como **Quadro 5 — Saldo a Receber e Abatimento Mensal das Taxas**, e no **CSV**): **Saldo Bruto a Receber (−) Taxas / Antecipação Cobradas no Mês (=) Saldo Líquido Disponível a Receber**, com a **% do saldo abatida**, a **tabela por contrato** (MDR, antecipação, tarifas de POS, retenções, total abatido, saldo líquido), os **recebíveis futuros por mês de pagamento** e a **série do abatimento mensal** (últimas competências, com o % do bruto).
- **Saldo bruto = valor de face das parcelas ainda não pagas na data de corte** (último dia do mês; no mês corrente, hoje) de vendas feitas até o corte: **Getnet** (parcelas dos lotes depois do corte, antes de MDR e antecipação; o que já foi antecipado ou pago não entra), **SafraPay** (Recebíveis com pagamento futuro + vendas da Agenda ainda sem Recebível; venda já vencida sem Recebível **não entra** no saldo: é divergência, não saldo futuro) e **Credsystem** (ERP com Dt Crédito depois do corte, créditos − estornos DB, só as lojas do contrato).
- **O abatimento do mês é a Taxa Efetiva Total do próprio Painel Executivo**, sem recálculo à parte (por contrato e consolidado, a soma fecha). O saldo líquido é uma **projeção gerencial**: não substitui o extrato.

### Item 4 · FCX › DFC: **Auditoria de Adquirentes × DFC** (DFC do mês, Realizado × Previsto, Resumo Executivo Oficial A4)

- **Categoria automática dos créditos do OFX.** O crédito que a **Auditoria casou com o repasse de uma adquirente** (Getnet e SafraPay → **Recebimento de cartões (adquirentes)**; Credsystem → **Recebimento Credsystem**) ganha essa categoria na DFC quando **não** tem classificação manual nem outra categoria específica (ou seja, estava em *Outras entradas operacionais*, por regra ou por padrão). A DFC mostra a origem **"Auditoria"** na linha do extrato. O crédito que a Auditoria **não casou** continua onde estava: a categoria só vem do casamento, nunca de palpite.
- **A reclassificação só MOVE valor entre categorias:** entradas, saídas e variação líquida são iguais às da v14.17 e a sobreposição é **virtual** (não regrava o extrato, não altera saldo). Ela só vale dentro da leitura da DFC; **o motor da Auditoria sempre lê a classificação original** (sem circularidade). Para classificar um crédito, a Auditoria também olha as **6 competências anteriores** (parcelas caem em meses seguintes); o crédito disputado por duas competências fica com a mais antiga.
- **Painel "Auditoria de Adquirentes × DFC"** (DFC do mês e Realizado × Previsto): quanto foi reclassificado e para onde, o Líquido Esperado da Auditoria por data de repasse no mês e dois seletores gravados em `config/dfc_cartoes18` (permissão `fcx.dfc.regras`; quem não tem a permissão vê o texto):
  - **Categoria dos créditos auditados:** *Pela Auditoria (padrão)* ou *Como no extrato* (volta ao comportamento da v14.17).
  - **Previsto dos cartões:** *Auditoria só onde o FCX não tem meta específica* (padrão) · *Sempre o Líquido Esperado da Auditoria* · *Somente o FCX (como na v14.17)*. No Realizado × Previsto o cabeçalho passa a **"Previsto (FCX / Auditoria)"**, a linha ganha a etiqueta "previsto: Auditoria" e a composição diz "na Auditoria de Adquirentes". A **projeção de saldo do mês continua 100% pelo FCX** (o `fcx.html` não foi alterado).
- **Resumo Executivo Oficial (A4): novo Quadro 3 — Reconciliação de Recebíveis de Cartões (Auditoria × Caixa OFX)**, entre o Quadro 2 e as notas (que passam a ser o **Quadro 4 — Notas Explicativas**): Faturamento Bruto de Cartões → (−) MDR efetivo → (−) Antecipação efetiva → (−) Tarifas e aluguel de POS / retenções e chargebacks → **(=) Líquido Esperado na Competência** → (+/−) Virada de Mês / Trânsito e Divergências → **(=) Total Creditado no OFX (casado pela Auditoria)**. Bruto, MDR, antecipação, tarifas e líquido são **os mesmos do Painel Executivo**; o caixa é o que a Auditoria casou no OFX com data dentro do período. **A ponte fecha sempre ao centavo** e mostra o que a compõe: a receber depois do período (trânsito), dias de repasse sem OFX importado, divergências e **"Outras diferenças de apuração"** (o resíduo: tarifas e retenções debitadas à parte, antecipação estimada, arredondamentos; conferido contra o cálculo teórico). Respeita o **escopo de contas** do Resumo, mês, trimestre e ano.

### Nomes das categorias da DFC

O pedido citava as categorias com nomes longos; **no plano da DFC elas existem com os ids `rec_cartoes` ("Recebimento de cartões (adquirentes)") e `rec_credsystem` ("Recebimento Credsystem")**, que são as usadas (as regras padrão da DFC não foram alteradas).

### Regra de Ouro e testes

- `contabilidade.html`, `contabilidade_v1391.html` e **`fcx.html` byte a byte** (md5 do `fcx.html` `640800e0547886185e7231087f3260d0`, o da v14.17); os três blocos protegidos do painel (OFX/contas, `ADQ_CFG` → `PARTE_EXTRATO` e Credsystem), `CP_OFX`, `DFC_REGRAS_PADRAO` e `DFC_CATEGORIAS` conferidos por hash (o teste novo confere todos).
- `tests/teste-contratos-taxas-dfc-1418.mjs` — **148 verificações** (só Node + código real do painel, dados fictícios): **(1)** auto-pull de Lojas/ECs do Cadastro de Lojas (empresa escolhida, CNPJ do EC/TEF, CNPJ da loja, inativa, outra adquirente, sem empresa, sem EC, "só soma", idempotência, tabela única); **(2)** Antecipação Efetiva (coluna da SafraPay e do ERP; apurada contra o OFX na Getnet; trânsito, tarifas e retenções; origem do número) e a composição de tarifas de POS × retenções/chargebacks do OFX; **(3)** saldo a receber com abatimento mensal (Getnet, SafraPay, Credsystem, corte, série, filtro por contrato, Laudo Quadro 5, CSV); **(4)** Auditoria refletida na DFC e no **Resumo Executivo** (categorias, exceções manual/regra explícita/recurso desligado, sem circularidade, Previsto auto/sempre/FCX, ponte que fecha, escopo, trimestre, A4). **(5)** documentação, versão e flag. Em todos, **recurso desligado ≡ v14.17**.
- `tests/teste-cartoes-kpis-cnab-1417.mjs` (122) ganhou o stub `g18` e o novo número de chamadas de `trDFC`; `tests/teste-economia-netlify-1410.mjs`: novo baseline de botões **527 / 614 / 407**.
- Fora do ZIP: roteiro no **Chromium real com o servidor local e o Postgres** **36/36**, com o recurso desligado (telas da v14.17) e ligado: tabela única, "Puxar do Cadastro" (linha, todos com dupla confirmação de alteração, modal Novo contrato/Editar), Painel Executivo (origem da Antecipação, saldo a receber, filtro por contrato, Laudo com Quadro 5), DFC (painel da Auditoria, categoria "Auditoria" nos Extratos OFX, seletores, Realizado × Previsto nos três modos), Resumo A4 com o Quadro 3, configuração gravada no servidor, persistência depois de recarregar e desligar o recurso de novo.

### Limites a saber (v14.18)

- **Permissão e carga:** a Auditoria de Adquirentes só carrega para quem tem `retaguarda.adq.ver`; sem ela (ou sem lotes/contratos) a reclassificação fica silenciosamente inativa e a DFC é a da v14.17.
- **Bases da DFC já gravadas:** `dfc/AAAA-MM` é atualizada ao importar OFX, reclassificar ou mudar o seletor da Auditoria — **não** quando se importam lotes de adquirente depois. Para refletir lotes novos num mês já gravado, use **Recalcular DFC** (atalho opcional da DFC), reimporte o OFX do mês ou troque o seletor.
- **Saldo a Receber:** é o valor de face depois da data de corte, abatido pela Taxa Efetiva Total do mês (não projeta o MDR nem a antecipação das parcelas futuras). A venda da SafraPay sem par na Agenda é assumida como vendida até o corte e avisada.
- **Antecipação da Getnet:** é uma **apuração contra o OFX** (e, nos dias sem repasse conferido, estimativa pelo contrato); mostra a origem e o que ficou estimado. Sem OFX da conta do contrato, cai na estimativa.
- **Realizado × Previsto:** o Previsto da Auditoria só altera as linhas de cartões; a projeção de caixa do mês segue pelo FCX.
- **Resumo A4:** o Quadro 3 só aparece quando há contratos de adquirente e Auditoria no período; a numeração dos quadros seguintes muda (as notas viram o Quadro 4).

## v14.17 · Conciliação de Cartões: Painel Executivo de Custos e Taxas + Laudo Operacional Mensal (A4) e DFC: desdobramento sintético de Lote CNAB pelo Contas a Pagar + complemento: Contas a Pagar / Baixas do ERP em dois layouts (recurso `gestao_v1417`)

Recurso novo, **dependente da `gestao_v1416`** (e, por ela, da família `gestao_v1414`/`gestao_v1415` na parte de cartões). Ativo na **Homologação**; em **Produção** e na **Falco** só depois de "Liberar Versão em Produção" (vale na hora, sem recarregar). **Desligado = comportamento da v14.16.** Nenhuma migração, variável de ambiente, rota ou mudança no servidor: os dados novos usam coleções genéricas que já existem (`extratos` para a marca `isLoteCnab` e `config` para `config/dfc_cnab17`).

### Frente 1 · Auditoria de Adquirentes › Conciliação de Cartões (por Contrato / CNPJ)

- **Painel Executivo de Custos e Taxas de Cartões** (acima da Triangulação, mesmo mês e mesmo filtro de escopo: Consolidado ou um contrato). Tudo sai da **mesma triangulação ERP × adquirente × OFX da v14.16** (`Adq15.triangular`): o painel não recalcula o cruzamento, só lê os números.
  - **Faturamento bruto conciliado** (base de cálculo das taxas: o bruto dos lotes da competência, o mesmo usado no MDR e na antecipação) ao lado de **ERP × adquirente** nos contratos comparáveis; **diferença não conciliada** em R$ e % (e quantos dias/bandeiras divergem). Para a SafraPay a base vem dos Recebíveis de antecipação e a comparação com o ERP usa a Agenda de Vendas, por isso a base pode diferir do "bruto da adquirente".
  - **Taxa efetiva total** (R$ e % do bruto) = **MDR + antecipação + tarifas/aluguel de POS + retenções bancárias do OFX**. **MDR efetivo × contratado** sobre a mesma base (só vendas com regra de MDR cadastrada; "a maior" e "a menor" separados); **antecipação** (R$, % efetivo × contratado, **prazo médio ponderado em dias**, excesso sobre o teto do contrato).
  - **Saúde do repasse bancário:** líquido esperado × creditado, **% de realização** (só os dias cobertos pelo OFX), **furos** (R$ e dias), **liquidado a menor / a maior**, e **virada de mês / trânsito** (repasses esperados depois do fim do mês).
  - **Comparativo por contrato / adquirente** (Getnet por CNPJ, SafraPay, Credsystem; QR-LINX e CREDNOSSO só como informativo) e **ranking das maiores divergências do mês** (furo, a menor, a maior, ERP × adquirente, MDR acima do contratado, antecipação acima do contrato); avisos de dado faltando; exportação **CSV dos KPIs** (`kpis_cartoes_AAAA-MM.csv`, com BOM).
  - **Tarifas e retenções** vêm do OFX da conta do contrato, **só dentro do mês da competência** (lançamentos fora do mês geram aviso e não entram); tarifa de POS = `Adq14.tarifaPos`; retenção = histórico com retenção/bloqueio/chargeback/contestação/cancelamento/estorno/ajuste de adquirente. Conta compartilhada por vários contratos: rateio pelo bruto.
- **Laudo Operacional Mensal:** botão **"Imprimir Laudo Operacional (PDF)"** no painel. O modal pede **Empresa/Matriz** (as empresas cadastradas; ou outra empresa), Razão Social, **CNPJ válido**, o **Parecer / Notas da Controladoria** (já vem com uma sugestão com os fatos do mês, editável, até 3.000 caracteres, texto escapado) e as **assinaturas** (Gestor Financeiro e Controladoria). Abre na **pré-visualização padrão do painel** (Fechar · Imprimir / Salvar PDF · Baixar PDF), folha **A4**, linhas e cabeçalhos de tabela sem quebrar no meio da página.
  - **Cabeçalho institucional:** empresa/matriz, CNPJ, competência, escopo, data e hora de emissão e **código de verificação** `LOP-AAAAMM-<hash>` (determinístico para o mês/escopo/números).
  - **Quadros:** 1 · Indicadores de custos, taxas efetivas e antecipação; 2 · Resumo comparativo por contrato/adquirente; 3 · Reconciliação de repasses no extrato bancário (OFX), furos e pendências; 4 · Detalhamento das divergências críticas do período; depois o parecer e as assinaturas. Os números são os do painel. A emissão é registrada na **auditoria** e empresa/CNPJ/signatários ficam lembrados **no navegador** (nada novo no servidor).

### Frente 2 · FCX · Fluxo de Caixa › DFC (Extratos OFX, DFC do mês, Realizado × Previsto, Resumo Executivo Oficial): desdobramento sintético de Lote CNAB

O banco debita **um lançamento por arquivo de remessa** (CNAB / "PAGTO FORNECEDORES" / "REMESSA" / "ARQUIVO PAG…") e a DFC jogava tudo em *Pagamento a fornecedores*, embora o lote tenha pago aluguel, marketing, obras. O motor distribui o lote pelas categorias dos títulos **Pago** do Contas a Pagar do FCX, **sem alterar o extrato nem o saldo**: o desdobramento existe só numa **lista virtual** lida pela DFC (os seis consumidores da DFC passam a ler `FluxoDFC.trDFC()`); a aba **Extratos OFX** continua mostrando os lançamentos originais.

1. **Etapa 1 · consumo 1 para 1 antes:** as saídas detalhadas já casadas com um título (vínculo gravado `cp` da v14.09 ou casamento em memória: valor e fornecedor, ±5 dias úteis) consomem o título; **um título consumido nunca é contado duas vezes**.
2. **Etapa 2 · títulos candidatos:** títulos **`Pago`** do FCX → Saídas na **mesma data** do lote, com **tolerância configurável de ±0 a ±3 dias úteis** (padrão ±1), ainda não consumidos. O Previsto e o Pago fora do prazo ficam de fora.
3. **Etapa 3 · agrupar por Categoria DFC** (Conta Contábil → De-para FCX → DFC): o lote vira **um filho por categoria + o resto** (o que não foi explicado), com **alocações virtuais que abatem exatamente de Pagamento a fornecedores** (o resto permanece lá). **Trava de teto:** o total desdobrado nunca passa de |lote|; se os títulos do dia passam do lote, o excedente é cortado **por prioridade** (data exata, maior valor primeiro, só títulos que cabem inteiros) ou **proporcionalmente** (configurável) e sai o alerta **"Excedente Contas a Pagar sem cobertura CNAB no dia"**. Total de saídas, soma dos lançamentos e **SALDO FINAL (EXTRATO)** ficam **idênticos** ao banco: o plano confere a soma em centavos (por conta, por dia e no total) e, se houver qualquer diferença, **desliga o desdobramento daquele cálculo** e a DFC usa os lotes inteiros.
4. **Etapa 4 · Extratos OFX:** o lote é **detectado pelo histórico** (só quando já cai em *Pagamento a fornecedores*, sem vínculo 1 para 1) e qualquer saída pode ser **marcada / desmarcada como Lote CNAB** (grava `isLoteCnab` no lançamento: `true` força, `false` desmarca a detecção, ausente = automático). A linha ganha o **selo** "Desdobrado via Contas a Pagar: X títulos · R$ Y realocados de Fornecedores" com **detalhe expansível** (categoria × títulos × valor, resto e lote) e o botão **"Recalcular Desdobramento CNAB"** fica **ao lado do filtro de mês** (Realizado × Previsto, DFC do mês e Extratos OFX): relê as saídas do FCX, refaz o plano e regrava a base mensal. O painel "Desdobramento de lotes CNAB" (quem pode importar extratos) mostra os lotes do mês, os alertas, a conferência (extrato = DFC) e a configuração (`config/dfc_cnab17`: tolerância e modo da trava).
- **Reflexo:** DFC do mês, **Realizado × Previsto** e o **Resumo Executivo Oficial** passam a ler a lista desdobrada (Aluguel, Marketing, Obras com os valores dos títulos; o total de saídas não muda).

### Complemento · Contas a Pagar / Baixas do ERP em **dois layouts** (FCX · Saídas e DFC · Desdobramento CNAB)

Os dois lugares leem os arquivos pelo **mesmo leitor** (`PAGTO17`, sem tela, só código) e **detectam o layout sozinhos**, sem perguntar ao usuário: a importação de **Saídas** do FCX e o botão novo **"Importar Baixas do ERP (CNAB)"** da DFC (ao lado de "Recalcular Desdobramento CNAB"; só as linhas **Pago** entram por ele, o FCX importa todos os status como sempre). Aceita `.csv` (UTF-8, com BOM ou Windows-1252; `,` ou `;`), `.xlsx` e `.xls`. Tudo atrás de `gestao_v1417`; desligada, o FCX volta ao leitor de sempre e a DFC não mostra os botões novos.

- **Layout A · Contas a Pagar atual (CSV/XLSX):** colunas `Status`, `Fornecedor`, `Valor Pago`/`Valor`, `Data de Pagamento`, `Conta Contábil`, `Centro de Custo`, `Conta Bancária` (**quando vazia, usa `Banco de Pagamento`**) e `Forma de Pagamento`. Valores `R$101355.76`, `R$ 1.234,56` e `1.234,56`; datas `DD/MM/AAAA` → ISO em `dataPagamento` (sem data de pagamento cai no `Vencimento`). O `date` da saída continua sendo o vencimento: **nenhum cálculo do FCX muda**.
- **Layout B · ERP antigo ("Relação dos Títulos Pagos", abas `PGTO.*` / `AgendaPagto`):** cabeçalho **dinâmico** (procurado nas 80 primeiras linhas: `Vlr Líquido`, `Pagamento`, `Item`, `Fornecedor`, `Conta`); lê as abas `PGTO.*` (ou, se não houver, a `AgendaPagto`). Ignora **"Baixa Estornada"** em `Instruções`, as contas internas (CONCILIAÇÃO GETNET/CREDSYSTEM, DEVOLUÇÕES EFETUADAS, RESILIENZA NEGÓCIOS, CAIXA BENEFÍCIOS, 001-CAIXA, SDIGITAL, RECEITAS NÃO OPERACIONAIS) e a Forma Pagto `4-CR` (crediário); a linha de total não conta. A conta perde o prefixo numérico (`070-ESPOSENDE -SANTANDER` → `ESPOSENDE -SANTANDER`). Grava `status = pago`, `dataPagamento = Pagamento`, `valor = Vlr Líquido`, observação = Descrição do Título, centro = Nome Loja (ou "Gestão") e a forma de pagamento.
- **Saída gravada** (campos novos, aditivos): `dataPagamento`, `contaPagamento`, `item`, `itemNome` e `erp17` (`A`/`B`). Ids **estáveis** (`erp17-<A|B>-<hash + ocorrência>`): importar o mesmo arquivo de novo atualiza em vez de duplicar. Contas e centros de custo novos são criados como no leitor de sempre, e o **popup de crítica de carga** informa layout, abas lidas, estornadas, internas, crediário, itens sem vínculo e contas sem cadastro.
- **Item (ERP antigo) → Conta Contábil / Categoria DFC:** tabela padrão com **89 Itens** (fornecedores 005/008/158/350/351/389/477, Credsystem 388, pessoal 187…510, ocupação 337/419/468/469, utilidades, impostos, marketing, tarifas, administrativas e investimento 320/375/376/377/475/483), com as contas exatas do catálogo oficial do FCX. Botão **"Itens do ERP"** (DFC; permissão `fcx.dfc.regras`): editar conta e categoria, marcar **ignorar**, acrescentar Itens novos e ver, ao lado, o que o De-para FCX → DFC diz para a mesma conta (aviso quando diverge). Só as **diferenças** da tabela padrão ficam no servidor (`config/dfc_item17`); "Salvar e reaplicar" atualiza a conta das Saídas do layout antigo já gravadas. **No desdobramento, o Item tem precedência sobre o De-para pela Conta Contábil.**
- **Para conferir (marcados `revisar`):** Item **415 Partes Relacionadas** (→ Outros pagamentos) e **012 Transferências** (→ transferência): confira contra o OFX. Itens cujo nome o ERP não informou (marketing 215…485; viagens, alimentação, locomoção e veículos 314…476; TI 328/333/443; seguros 421/422/424/459) entram por **grupo** e estão marcados `generico`; 445, 446, 205, 158, 350, 368/369, 405/460 e 152 foram mapeados por suposição. Revise e ajuste em "Itens do ERP".
- **Desdobramento CNAB:** passa a usar `dataPagamento` (e a `contaPagamento` para filtrar pelo extrato: nome igual, mesmas palavras em qualquer ordem ou subconjunto de 2+ palavras); títulos **sem** `contaPagamento` não são filtrados (compatível com o que já estava gravado) e, quando a conta do arquivo não existe no cadastro de Contas Bancárias, o plano avisa ("contas sem cadastro"). Mesmo lote com títulos de contas diferentes: cada extrato só consome os da própria conta.
- **Permissões:** importar baixas = `fcx.dfc.importar` + `fcx.editar`; editar Itens = `fcx.dfc.regras`. Auditoria: "Importar Baixas do ERP (CNAB)".
- **O Painel lê o cache de Saídas do FCX:** depois de importar pela tela do FCX, use **Recalcular Desdobramento CNAB** na DFC para refazer o plano. A conta de pagamento da Saída fica fixada na importação (a edição dos Itens só reaplica com "Salvar e reaplicar").
- **Exceção à Regra de Ouro (autorizada):** em `fcx.html` mudou **só** a importação de Saídas (`importSaidasFile` → leitor novo quando o recurso está ligado e o layout é reconhecido; senão o corpo original, agora `importSaidasLegado`). Três regiões idênticas por hash: antes da exceção (md5 `3985ab53…`, inclui `isVencido`, Orçamento, `buildCashBook`, `buildAggregated` e gráficos), o bloco central (Recebível Diário, popups, leitura de planilhas) e de `window.FCXAPI` ao fim. Novo md5 do `fcx.html`: `640800e0547886185e7231087f3260d0`. Layout não reconhecido (inclusive o padrão antigo do FCX sem `Data de Pagamento`) cai no leitor de sempre.

### Regra de Ouro e testes

- `contabilidade.html` e `contabilidade_v1391.html` byte a byte; **`fcx.html` com uma única exceção autorizada** (a importação de Saídas aceitar os dois layouts do ERP, atrás de `gestao_v1417`; todo o resto idêntico por hash, ver o Complemento); os três blocos protegidos do painel (OFX/contas, `ADQ_CFG` → `PARTE_EXTRATO` e Credsystem) e `CP_OFX`, `DFC_REGRAS_PADRAO` e `DFC_CATEGORIAS` com o **mesmo md5** (o novo código mora em `ADQ17`/`Adq17` e `CNAB17`/ganchos de `FluxoDFC`, todos atrás de `g17()`).
- `tests/teste-cartoes-kpis-cnab-1417.mjs` — **122 verificações** (só Node + código real do painel, dados fictícios): KPIs de cartões (bruto, diferença, taxa efetiva, MDR a maior/a menor, antecipação e prazo médio, tarifas e retenções só do mês, realização, furos, a menor/a maior, virada de mês, Credsystem e informativos, escopo por contrato, CSV) e o **Laudo** (HTML/PDF: 4 quadros, parecer editável e escapado, assinaturas, código de verificação, A4 sem cortar tabelas, prévia padrão, auditoria); e o desdobramento CNAB: **(a)** consumo 1 para 1 sem duplicidade, **(b)** realocação para Aluguel/Marketing/Obras abatendo de Pagamento a fornecedores, **(c)** preservação exata das saídas do OFX e trava de teto (por prioridade e proporcional, tolerância 0–3, fim de semana → segunda-feira), marcação manual, FCX indisponível, permissões e **recurso desligado ≡ v14.16**.
- `tests/teste-baixas-erp-layouts-1417.mjs` — **96 verificações** do Complemento (Node + código real do painel e do `fcx.html`, dados fictícios; roda com `XLSX_PATH=node_modules/xlsx` para as leituras de `.xlsx`/`.xls`): **(a)** CSV atual com `Conta Bancária` vazia → fallback para `Banco de Pagamento`, valor `R$101355.76` e `1.234,56`, datas DD/MM/AAAA → ISO; **(b)** Excel legado (`PGTO.JANEIRO26` e `AgendaPagto`) ignorando "Baixa Estornada" e as contas internas de conciliação, removendo o prefixo `070-` e classificando os Itens **468, 187, 475 e 217** no desdobramento CNAB; mais UTF-8/BOM/Windows-1252/`;`, XLSX com células de data, detecção do cabeçalho em qualquer linha, Itens editáveis, idempotência, desempenho (6.720 títulos × 56 lotes) e o código real do `fcx.html` (hashes das regiões protegidas, recurso desligado ≡ leitor de sempre).
- `tests/teste-economia-netlify-1410.mjs`: novo baseline de botões **518 / 604 / 398**; `tests/teste-dfc-regras-backup-1413.mjs`: o stub de `FluxoDFC` ganhou `trDFC()` e `g17`.
- Fora do ZIP: roteiro no **Chromium real com o servidor local e o Postgres** **51/51**, com o recurso desligado (tela da v14.16) e ligado: Painel Executivo, Laudo (prévia A4 com Fechar / Imprimir / Baixar PDF e o PDF baixado de verdade), detecção dos lotes, selo e detalhe, marcar / desmarcar, Recalcular, configuração gravada no servidor, persistência depois de recarregar e desligar o recurso voltando à v14.16.

### Limites a saber (v14.17)

- **Títulos sem conta de pagamento:** o Contas a Pagar do FCX no layout padrão antigo (e as Saídas gravadas antes do Complemento) **não tem conta bancária nem data de pagamento**: para esses títulos o casamento com o lote continua só por **data ± tolerância de dias úteis**, sem filtro de conta. Com o Complemento, as Saídas importadas pelos layouts do ERP guardam `dataPagamento` e `contaPagamento` e o desdobramento filtra pela conta do extrato. Com mais de um lote no mesmo dia em contas diferentes e títulos sem conta, eles são divididos pela ordem do plano; revise com o selo de cada linha.
- A **detecção automática** exige texto de lote no histórico **e** classificação do lançamento em *Pagamento a fornecedores* (as regras padrão da DFC não classificam, por exemplo, "ARQUIVO PAG FORNECEDORES" ali: crie a regra ou use **Marcar como Lote CNAB**). As regras padrão não foram alteradas.
- O **bruto conciliado** do painel é a base de cálculo das taxas (para a SafraPay, os Recebíveis); a comparação ERP × adquirente usa a Agenda de Vendas. Tarifas e retenções **só entram se estiverem no mês da competência** no OFX da conta do contrato.
- Sem o **Contas a Pagar do FCX carregado** (FCX ainda lendo ou indisponível) o painel avisa e a DFC segue com os lotes inteiros; "Recalcular Desdobramento CNAB" tenta de novo. O plano só muda quando o usuário recalcula ou marca/desmarca (não relê o FCX sozinho a cada tela).
- O PDF do laudo é gerado pelo mesmo gerador A4 do painel (html2canvas + jsPDF, bibliotecas carregadas da CDN); sem acesso à CDN use "Imprimir / Salvar PDF".

## v14.16 · DFC · Extratos da Caixa: OFX sem perda de lançamentos e extrato em Excel (.xls / .xlsx) (recurso `gestao_v1416`)

Recurso novo, **independente dos anteriores** (não depende da `gestao_v1414`/`gestao_v1415`). Ativo na **Homologação**; em **Produção** e na **Falco** só depois de "Liberar Versão em Produção" (vale na hora, sem recarregar). **Desligado = comportamento da v14.15.1** (mesmo botão, mesma leitura, mesma gravação). Nenhuma migração, variável de ambiente, rota ou mudança no servidor: os extratos continuam na coleção `extratos` (o servidor não valida o conteúdo das transações).

### 1 · O defeito: lançamentos perdidos nos extratos da Caixa

- **Causa raiz** (extratos reais de jan/2026, `BANKID 0104`): a Caixa repete o **mesmo `<FITID>` / `<CHECKNUM>`** (o código do terminal: `324200`, `064800`, `094300`…) em dezenas de depósitos de R$ 2.000,00 **do mesmo dia** e também entre `DEB PIX CHAVE` (−R$ 157.941,00) e `TAR PIX` (−R$ 8,50). O painel usava o FITID como identidade única: o leitor (`OFX.ler`) devolvia `id = FITID`, a conferência de duplicadas (`importarOFX`: `existentes`) e a gravação (`gravarExtrato`: `Map` por id) descartavam tudo que repetisse o id. Resultado: **832 dos 869 depósitos** (lidos R$ 70.865,50 de R$ 1.245.035,50) e as **20 tarifas PIX** (−R$ 170,00) sumiam.
- **Correção:** a identidade passa a ser **conteúdo + ocorrência**, nunca o FITID sozinho. `OFX16.planejar` compara o arquivo com o que já está gravado **como multiconjunto** (cada lançamento gravado "cobre" no máximo um do arquivo; o que sobra é novo), em três passadas, da mais exata à mais frouxa: (1) **FITID + data + valor + histórico** (reimportar o mesmo arquivo); (2) **FITID + data + valor** (o banco só reescreveu o texto do histórico entre duas exportações — continua sendo o mesmo lançamento); (3) **documento + data + valor**, só entre origens diferentes (**OFX × Excel** do mesmo período).
- **Id do lançamento novo:** o próprio **FITID** quando está livre na conta (compatível com tudo que já estava gravado: classificações manuais, vínculos, referências) e, quando já existe, **`FITID~hash(data|valor|histórico)[#n]`** com o FITID original guardado em `fid`. O id é único na conta e **determinístico** para o mesmo conteúdo; sem FITID no arquivo vale o hash do conteúdo + a ocorrência no arquivo, como antes. O `OFX.ler` original (região protegida) não foi tocado: a leitura nova é `OFX16.ler` (mesma leitura, mais o texto completo para o cruzamento PIX), fora da região protegida.
- **Reimportar o MESMO arquivo continua bloqueado** (0 novos), inclusive dois arquivos que se sobrepõem. **Mesmo FITID com data/valor diferentes** (outro mês, outro depósito) agora **é** um lançamento novo. **Dados gravados pelo caminho antigo** (um lançamento por FITID) são **completados** quando o mesmo arquivo é importado de novo: os que já existiam não são duplicados e mantêm o id.
- **Gravação em partes por tamanho:** cada documento `extratos/<conta>_<AAAA-MM>_<n>` fica abaixo de **~200 KB** (limite do banco do claude.ai: 256 KiB) e de 900 lançamentos; antes eram só 900 por documento. A gravação nunca descarta: se um id repetido escapasse do planejamento, ganha sufixo `#n`.
- **Transparência:** a confirmação mostra, por arquivo, os lançamentos, **créditos e débitos do arquivo**, quantos são novos × já gravados e avisa quando lançamentos compartilham o mesmo código ("todos são gravados, nenhum é descartado"). O popup de crítica de carga (v13.99) usa a mesma contagem.

### 2 · Extrato em Excel (.xls / .xlsx) da conta

- O botão vira **"Importar Extrato (OFX / Excel)"** e aceita `.ofx`, `.xlsx` e `.xls` (vários arquivos de uma vez, misturando formatos). O Excel **não traz a conta**: abre-se a janela **"Conta bancária do extrato em Excel"** com a **Conta Bancária obrigatória** (sem escolher, "Continuar" não avança; se só houver uma conta da Caixa, ela já vem marcada) e a escolha da **data a usar**: *Data Lançamento* (padrão: o dia em que o valor entrou no saldo) ou *Data Movimento*; se a escolhida estiver vazia na linha, vale a outra. Conta que não é da Caixa (banco 104) gera apenas um aviso.
- **Leitor da Caixa** (`OFX16.lerExcelLinhas`): aba `Extrato` (ou a primeira que tiver o cabeçalho); o cabeçalho é procurado nas 80 primeiras linhas por `Data Lancamento`, `Data Movimento`, `Histórico`, `Documento`, `Valor Lançamento`, `Saldo`, `CPF/CNPJ`, `Nome/Razão Social` (sem diferenciar acento, caixa ou pontuação). **Ignora** linhas de saldo (`SALDO DIA`, `SALDO ANTERIOR`…) e valor zero (inclui `Valor Lançamento = 0` com documento `000000`); linhas sem data ou sem valor são contadas e informadas.
- **Valores brasileiros:** `- 136.200,00` (sinal antes, com espaço comum ou **NBSP `\u00A0`**) → `-136200.00`; também `1.234,56`, `136.200,00-`, `(1.234,56)`, `1.234,56 D/C`, `R$ 10,50` e célula numérica. **Datas:** `dd/mm/aaaa [hh:mm]`, `aaaa-mm-dd`, `AAAAMMDD` ou número de série do Excel.
- **CPF/CNPJ e Nome/Razão Social:** o nome e o CPF/CNPJ formatado entram no **histórico** (até 140 caracteres; o CPF/CNPJ nunca é cortado) e ficam em `nm`/`cd`; o texto completo vai ao **cruzamento com Fornecedores e Clientes** (o CNPJ da coluna é reconhecido mesmo fora do histórico) e as **regras de transferência entre contas próprias** (termos como `ESPOSENDE CALCADOS`) enxergam o nome. CPF mascarado (`***.123.456-**`) é ignorado.
- **Saldo final do extrato** (card "Saldo final (extrato)"): o saldo da **última linha válida** do período, em ordem cronológica (o arquivo pode vir do mais antigo ao mais novo ou o contrário); sem saldo nas linhas de movimento, o da última linha `SALDO DIA`.
- **Excel × OFX do mesmo período:** o Excel depois do OFX **não duplica** (documento + data + valor) e **completa** os lançamentos do OFX com CPF/CNPJ e nome, refazendo o cruzamento (sem mudar histórico, id nem classificação manual); o OFX depois do Excel também não duplica. Os lançamentos do Excel têm origem marcada (`o: "x"`) e id `x<documento>` (sem documento: `xh<hash>`); `.xls` (Excel 97-2003) e `.xlsx` usam o mesmo leitor (SheetJS, já usado pelo painel).

### 3 · Limpar / reimportar os extratos de uma conta no mês

Na aba **Extratos OFX** (só quem tem `fcx.dfc.importar`), o botão **"Limpar / reimportar extratos do mês…"** abre a janela com as contas que têm extrato no mês selecionado (e a contagem de lançamentos de cada uma). **"Limpar o mês"** remove **de uma vez** todos os documentos da conta naquele mês (não toca em outros meses nem outras contas) depois de uma confirmação que diz quantos lançamentos saem, quantos têm **classificação manual (que se perde)** e que não tem volta, e **recalcula a DFC do mês**; **"Limpar e reimportar…"** faz o mesmo e abre a janela "Reimportar extrato" com o seletor de arquivos (OFX, `.xlsx` ou `.xls`), já com a conta lembrada. Sem escolher a conta, nada é apagado. O reprocessamento do cruzamento com Fornecedores continua no botão que já existia.

### Regra de Ouro e testes

- `fcx.html`, `contabilidade.html` e `contabilidade_v1391.html` byte a byte; os três blocos protegidos do painel (OFX/contas, `ADQ_CFG` → `PARTE_EXTRATO` e Credsystem) com o **mesmo md5**; a lógica nova mora no módulo `OFX16`/`FluxoDFC.importar16` (fora das regiões protegidas) e os ganchos em `FluxoDFC` são pequenos e todos atrás de `g16()`.
- `tests/teste-extratos-caixa-1416.mjs` — **70 verificações** (só Node + código real do painel, dados fictícios): recurso e Regra de Ouro; **o defeito reproduzido com o recurso desligado** (16 de 895 lançamentos do arquivo de teste; 11 dos depósitos e nenhuma tarifa PIX) e a correção ligada (869 depósitos = R$ 1.245.035,50, 20 TAR PIX = −R$ 170,00, DEB PIX CHAVE); reimportação bloqueada, arquivos sobrepostos, histórico reescrito, mesmo FITID em outro mês; dados antigos completados sem duplicar; Excel (`.xlsx` e `.xls` reais): cabeçalho em qualquer linha, `SALDO DIA` e zero ignorados, NBSP e sinal antes do número, CPF/CNPJ e Nome, saldo final, ordem decrescente, conta obrigatória, Excel × OFX; cruzamento pelo CNPJ do Excel e regra de transferência; limpar/reimportar; partição por tamanho; recurso desligado ≡ v14.15.1. O leitor de planilhas é o SheetJS (`xlsx`), **fora do pacote** (sem `node_modules`): para rodar os blocos de arquivo `.xlsx`/`.xls` use `npm i --no-save xlsx@0.18.5` (ou `XLSX_PATH=/caminho/xlsx`); sem ele esses blocos aparecem como PULADOS.
- `tests/teste-economia-netlify-1410.mjs`: novo baseline de botões **514 / 597 / 394** (só o botão "Limpar / reimportar extratos do mês…").
- Fora do ZIP: roteiro no **Chromium real com o servidor local e o Postgres** (**31/31**): recurso desligado (o defeito no navegador) e ligado; OFX da Caixa sem perda (card "Entradas" R$ 1.245.036); reimportação bloqueada; limpar e "limpar e reimportar" pela tela; `.xlsx` e `.xls` com a Conta Bancária obrigatória, reimportação bloqueada, Excel × OFX nos dois sentidos, vínculo com fornecedor pelo CNPJ do Excel e card "Saldo final (extrato)".

### Limites a saber (v14.16)

- Não havia **amostra real do Excel da Caixa** para validar o leitor: ele segue o layout descrito (cabeçalhos, `SALDO DIA`, `000000`, NBSP, `CPF/CNPJ`, `Nome/Razão Social`) e é flexível na posição do cabeçalho, nas datas e nos valores. Se o arquivo real tiver outra coluna de data ou saldo, a janela de importação mostra o resumo (créditos, débitos, ignoradas) **antes** de gravar, e "Limpar e reimportar…" desfaz uma importação ruim.
- **Limpar o mês perde as classificações manuais** dessa conta nesse mês (a confirmação informa quantas). Dados de outros meses e contas não são tocados.
- A "Data Lançamento" é a data padrão do Excel; se o seu OFX usa o dia do movimento, escolha "Data Movimento" na janela (o mesmo extrato importado com datas diferentes vira lançamentos diferentes).
- Lançamentos antigos já perdidos só voltam importando de novo o arquivo (OFX ou Excel) com o recurso ligado; o painel não tem como recuperá-los sozinho.

## v14.15.1 · Ajuste pontual: Tela Única da Conciliação de Cartões (3 sub-abas, fluxo em 3 etapas, sub-aba legada oculta), ERP gravado em pedaços de JSON puro e Credsystem (Adq 304) conciliada com o OFX (mesmo recurso `gestao_v1415`)

Não há recurso novo: o ERP em pedaços, a Credsystem e as 3 etapas valem com a `gestao_v1415` (que depende da `gestao_v1414`); com ela desligada a tela da Conciliação de Cartões e o servidor continuam sendo os da v14.14. A **Tela Única de navegação** (3 sub-abas, abertura na Conciliação por Contrato / CNPJ e sub-aba legada oculta) vale com a `gestao_v1414` ativa, como pedido; com a `gestao_v1414` desligada a Auditoria de Adquirentes é a de sempre (v14.13). Regra de Ouro preservada (`fcx.html`, `contabilidade.html`, `contabilidade_v1391.html` e os três blocos protegidos do painel com o mesmo md5; `ADQ_CFG` intocido). Nenhuma migração, variável de ambiente ou rota nova.

### 1 · "Gravar ERP" com o mês cheio (erro "arguments must be plain JSON data within the store's limits")

- **Causa:** o ERP de um mês era gravado em **um documento só**. O arquivo real de janeiro (≈ 43,9 mil linhas válidas, ≈ 14,2 mil já agregadas) passa de 1 MB em JSON; o banco do claude.ai aceita no máximo **256 KiB por documento** e só **JSON puro** (sem `Date`, `NaN`, `undefined` nem texto onde se espera número).
- **JSON puro na origem:** datas são sempre texto `AAAA-MM-DD`; Loja é `String(loja).trim()` sem zeros à esquerda (`005` = `5`); valores são `Number.isFinite(v) ? Math.round(v*100)/100 : 0`; tudo passa por `JSON.parse(JSON.stringify(...))` antes de gravar (`numJ`, `dataJ`, `lojaJ`, `tuplaErp` em `adq1415`).
- **Compactação + pedaços de até 250 KB:** cada linha agregada vira uma **tupla** `[Loja, Dt Venda, Dt Crédito, Adq, índice da descrição, DC, OP, Vda Bruta, MDR, Líquido, Antecipação, Tx Extra, nº de linhas]` e as descrições (`GETNET VISA CREDITO 3X`…) ficam num **dicionário** por pedaço. Chaves: `adq_erp` / **`2026-01:meta`** (resumo: arquivos importados, dias, bruto, informativos QR-LINX/CREDNOSSO, marca de gravação `rev`, nº de pedaços) + **`2026-01:p0`, `:p1`, …** (as tuplas). O empacotamento fecha cada pedaço em ≈ 236 KB e **confere o tamanho real** do documento (nunca passa de 250.000 bytes; o teto do banco é 262.144). Um mês de ≈ 14,4 mil linhas agregadas vira 5 pedaços + 1 resumo.
- **Leitura:** `loadERP` reassembla o mês (todos os pedaços da mesma marca `rev`, na ordem). Mês com pedaço faltando é marcado **incompleto**, aparece na tela com aviso e **nunca é calculado pela metade**. O `meta` é gravado por último; pedaços de uma gravação anterior (outra `rev`) são ignorados e **apagados** ao final (inclusive o documento do formato antigo da v14.15, que continua legível até a próxima importação do mês).
- **Reimportar** continua substituindo só os dias do arquivo novo; a gravação mostra "Gravando o ERP em N partes…" e o Log de Auditoria registra pedaços e o maior documento (KB).
- **Servidor** (`adq-1415.mjs`): `validarErp` aceita os ids `AAAA-MM:meta` e `AAAA-MM:p<n>` (e os ids antigos), exige `rev`, o tipo certo, tuplas de 13 campos, datas válidas, números finitos e **recusa documento > 256 KiB com 413**.

### 2 · Credsystem (Adq 304) entra: conciliação direta ERP × OFX pela Dt Crédito

- A Credsystem **não é mais descartada** na importação do ERP; o ERP guarda a **Dt Crédito** de cada linha (se a coluna não existir ou vier vazia, vale o **Vencimento**; sem nenhuma das duas a linha fica "sem Dt Crédito" e é apenas contada). **QR-LINX (303) e CREDNOSSO (372)** seguem só como resumo informativo.
- **Contrato:** o editor de contratos aceita **Adquirente = Credsystem** (Empresa/CNPJ, Conta Bancária de crédito do OFX e **Lojas do ERP** vinculadas). Sem arquivo da adquirente: o cálculo vem do ERP.
- **Dia esperado** = Dt Crédito (fim de semana ou feriado → próximo dia útil). **Líquido esperado do dia** = Σ (**Vda Líquida − Antecipação − Tx Extra**) das linhas `DC = CR` **menos** o mesmo cálculo das linhas `DC = DB` (estornos), só das lojas do contrato. Dia com líquido ≤ 0 não gera repasse a esperar (fica listado à parte).
- **Conferência com o OFX** da conta do contrato, pelo mesmo motor da v14.14: janela **D+0 a D+2 dias úteis**, créditos fracionados somados, histórico reconhecido (`CREDSYSTEM`, `CRED SYSTEM`, `PIX RECEBIDO 04670195000138`…) ou crédito de mesmo valor e data. Aparece nos KPIs (Líquido Esperado, Crédito Confirmado no OFX, Furo / Divergência) e na tabela "Por contrato"; a tela ganha o bloco **ERP × OFX direto (Dt Crédito)** com Antecipação, Tx Extra, Estornos (DB) e os créditos localizados. Na lista de arquivos do período a linha da Credsystem diz "vem do ERP" (sem reimportar/excluir lote: o cálculo não grava nada em `adq_lotes`).

### 3 · Tela Única: tudo em "Conciliação de Cartões (por Contrato / CNPJ)"

- **Só 3 sub-abas.** Com a `gestao_v1414` ativa (e a permissão `retaguarda.adq.ver`), **Auditoria de Adquirentes** mostra apenas **1 · Conciliação de Cartões (por Contrato / CNPJ)**, **2 · Regras de Taxa Contratuais** (cadastro de Contratos e Taxas) e **3 · Resumo do Fechamento**, e abre direto na primeira; a escolha do usuário em outra sub-aba é respeitada.
- **Legado oculto por inteiro.** A sub-aba **Conciliação e Cruzamento**, o painel dela e o link **"Abrir o motor original ERP × adquirente × banco"** não são sequer desenhados (nem escondidos no DOM): a lista `ConcMP.SUBS72` deixa de trazer `cruzamento` e qualquer estado antigo (`cruzamento`, `motor`, `motorOriginal` ligado ou valor desconhecido) cai na Conciliação por Contrato / CNPJ (`ecs` e `auditoria` seguem indo para as Regras de Taxa). O **código legado continua intacto no arquivo** (`renderCruzamento`, `renderMotorOriginal`, o botão `cmp-cz-original` e a lista de fábrica) e é o que roda com a `gestao_v1414` desligada, ou para um perfil sem `retaguarda.adq.ver`; a Regra de Ouro segue conferida por hash. O aviso provisório "Motor legado (v13.74)…" da primeira versão deste ajuste foi retirado, pois a sub-aba deixou de ser alcançável.
- **Fluxo único e linear em 3 etapas** dentro da sub-aba (com a `gestao_v1415`; só a v14.14 ligada mantém a tela da v14.14), **sem nenhum campo de upload de OFX**:
  1. **ERP unificado (Apuração dos Créditos):** upload do `.xlsx` único do ERP (aba `ApuraCreditos`) com todas as operadoras juntas — Getnet, SafraPay e Credsystem (QR-LINX e CREDNOSSO só como resumo informativo).
  2. **Adquirente por contrato (com validação de CNPJ):** escolhe-se o contrato e sobe-se o arquivo padrão da adquirente (CSV da Getnet ou Excel da SafraPay — "Agenda de Vendas" ou "Recebíveis de antecipação"). Antes de gravar o CNPJ do arquivo é conferido com o do contrato: **Getnet divergente é bloqueada** ("Nada foi gravado", com sugestão do contrato certo); na **SafraPay** o CNPJ do cabeçalho é o do Banco Safra, então registra-se o aviso e o lote é vinculado ao contrato escolhido. Para a **Credsystem** não há arquivo: o contrato aparece na escolha como "sem arquivo (usa o ERP)", nada é pedido e um quadro lista Conta Bancária (OFX) e Lojas do ERP de cada contrato dela.
  3. **Extrato bancário (OFX) automático via DFC:** o painel lê sozinho os extratos já importados no DFC (FCX › Extratos OFX) pela Conta Bancária de cada contrato e confere cada repasse esperado em D+0 a D+2 dias úteis; o quadro **"Extratos OFX lidos no DFC"** mostra tudo o que foi lido (com a triangulação ERP × Adquirente × Banco e a auditoria logo abaixo).

### 4 · Testes (dados fictícios)

- `tests/teste-triangulacao-erp-safra-ofx-1415.mjs` — **194/194** (eram 119 na v14.15): os blocos antigos adaptados e quatro novos — **(8)** mês de 43.951 linhas → ≈ 14,4 mil agregadas gravado em pedaços ≤ 250 KB com um armazenamento de teste que recusa > 256 KiB e valor que não seja JSON puro (reproduz o erro), relido idêntico, sanitização (`NaN`, `Date`, `undefined`, Loja com zeros), sobras, exclusão e mês incompleto; **(9)** Credsystem ERP × OFX (Dt Crédito, fim de semana/feriado, `Vda Líquida − Antecipação − Tx Extra`, estorno DB, D+0..D+2, fracionado, só valor, CNPJ no histórico, lojas do contrato, KPIs, tela, recurso desligado = v14.14); **(10)** **Tela Única — ocultação da sub-aba legada** (lista com exatamente 3 sub-abas, abertura na Conciliação por Contrato / CNPJ, "Conciliação e Cruzamento" e o link do motor original ausentes, estados antigos caindo na tela nova, `ecs`/`auditoria` → Regras, perfil sem `retaguarda.adq.ver`, módulo 7.2 desligado, **v14.14 desligada = tudo como era**, código legado ainda no arquivo); **(11)** **as 3 etapas** (ordem, upload do ERP na Etapa 1, contrato + arquivo da adquirente na Etapa 2, triangulação + auditoria + "Extratos OFX lidos no DFC" na Etapa 3, **nenhum campo de upload de OFX**, validação de CNPJ da Getnet/SafraPay, Credsystem "sem arquivo (usa o ERP)", recurso desligado = tela da v14.14).
- Navegador real + servidor real + Postgres: **54/54** (eram 33 na v14.15), incluindo o mês cheio de 43.951 linhas no `.xlsx` gravado em 5 pedaços (com o limite de 256 KiB emulado) e relido do servidor, a Credsystem × OFX de março e a Tela Única no DOM real (3 sub-abas, nada do legado na página, 3 etapas na ordem, sem upload de OFX, Credsystem sem campo de arquivo). Regressões: roteiro da v14.14 **41/41**, bateria de servidor completa, bateria legada de navegador sem falha nova, `teste-conciliacao-adquirentes-cnpj-1414` **124/124**, `teste-economia-netlify-1410` **106/106** (contagem de botões: o atalho "Abrir" do aviso provisório saiu junto com a sub-aba legada).

### Limites a saber (v14.15.1)

1. **`DC = DB` na Credsystem** foi tratado como **estorno** (subtrai do repasse), como pedido; na Getnet `DB` é modalidade débito. Confirme com um arquivo real da Credsystem se há `DB` que não seja estorno.
2. A **Dt Crédito** é lida do ERP do **mês da venda**: repasse de venda do fim do mês que cai no mês seguinte aparece como "Sem OFX" (nunca furo) se o OFX do mês seguinte não cobrir, e um dia de repasse que mistura vendas de dois meses pode mostrar diferença só pela parte do mês importado.
3. Não houve amostra real da Credsystem nem do OFX dela: os históricos reconhecidos vêm do CNPJ e do nome informados; outros textos ainda fecham por **valor + data**.
4. O banco do Artifact também limita **5.000 documentos**: cada mês do ERP usa 1 resumo + N pedaços (≈ 5 para um mês cheio); e a assinatura da coleção `adq_erp` carrega todos os meses gravados. Lotes e agendas da v14.14 também podem passar de 256 KiB no Artifact (não medido).
5. Os ids usam o formato `adq_erp` + `2026-01:meta` (equivalente a `adq_erp:2026-01:meta`) e a tupla tem um 13º campo (nº de linhas agregadas).

## v14.15 · Triangulação ERP × Adquirentes (Getnet e SafraPay) × Banco (OFX) (recurso `gestao_v1415`)

Ativa na **Homologação**; em **Produção** e na **Falco** só depois de "Liberar Versão em Produção" (o recurso vale na hora, sem recarregar). Depende da `gestao_v1414`: com a `gestao_v1415` desligada o painel **e o servidor** são os da v14.14 (tela, regras e redação dos avisos idênticas). Escopo: Getnet e SafraPay; a Credsystem ficou fora nesta versão e **entrou na v14.15.1** (seção acima). Regra de Ouro preservada: `fcx.html`, `contabilidade.html` e `contabilidade_v1391.html` byte a byte, os três blocos protegidos do painel (OFX/contas, `ADQ_CFG` → `PARTE_EXTRATO` e Credsystem) com o mesmo md5 e `ADQ_CFG` intocado; o leitor e o cruzamento antigos do ERP (Getnet, v13.7x) seguem como estavam e o novo módulo é separado (`ADQ15` / `Adq15`, ações `a15-*`, por cima do `Adq14` sem alterá-lo).

### 1 · ERP · Apuração dos Créditos (aba `ApuraCreditos`)

- Importação única em **Conciliação de Meios de Pagamento › Auditoria de Adquirentes › Conciliação de Cartões › ERP · Apuração dos Créditos**. Vale para todos os contratos: cada linha traz a **Loja**, que é ligada ao contrato (item 2). `.xlsx`, `.xls` e `.csv`.
- **Cabeçalhos normalizados** (aceita espaços nas pontas, como `" MDR"`, acentos e caixa). Colunas lidas: Loja, Dt Venda, Dt Crédito, Adq, Descrição, Vda Bruta, MDR, Vda Líquida, Vencimento, Antecipação, Tx Extra, OP (`VE` Venda · `CX` Prestação no POS) e DC (`DB` débito · `CR` crédito). Linhas **sem Loja ou sem Dt Venda são descartadas** (e contadas), assim como a linha de total do arquivo.
- *(Superado na v14.15.1: a Credsystem entra e é conciliada direto com o OFX.)* Na v14.15 a Credsystem (Adq 304) ficava fora: não entrava em nenhum grupo; o painel guarda só a *contagem* de linhas descartadas (nunca valor nem detalhe) e o servidor recusa (422) qualquer documento de ERP que a traga. **QR-LINX (303) e CREDNOSSO (372)** não entram na conciliação: viram um **resumo informativo** separado. Os códigos 303, 304 e 372 são fixos; o código de Getnet e SafraPay é aprendido pela descrição da própria linha.
- *(Formato superado na v14.15.1: pedaços `AAAA-MM:meta` + `AAAA-MM:p<n>`, ≤ 250 KB.)* Gravação em `adq_erp/<AAAA-MM>[__<parte>]`: agregado por **Loja × Dt Venda × Adq × Bandeira × Modalidade × OP**, um documento por competência da Dt Venda (meses grandes se dividem em partes). **Reimportar um arquivo substitui só os dias que vieram nele**; os demais dias do mês ficam. A cobertura (quais dias o ERP importado cobre) é guardada e usada na comparação, e o arquivo (nome, aba, faixa de dias) fica registrado.

### 2 · Lojas do ERP e Estabelecimentos Comerciais por contrato

- O contrato (v14.14) ganhou campos **opcionais**: **Lojas do ERP vinculadas** (ex.: `05, 28, 31`) e **ECs** (ex.: `1454475`). Cada contrato só enxerga o ERP das próprias lojas: por exemplo Lojas 05, 28 e 31 → SafraPay (EC 1454475); outras lojas → Getnet Resilienza ou Mar Aberto. `05` e `5` são a mesma loja.
- Contrato **único** da adquirente sem lojas informadas recebe o ERP inteiro dela; com mais de um contrato e sem lojas o ERP **não é adivinhado** ("sem lojas ligadas"). Uma loja ligada a dois contratos da mesma adquirente é apontada como conflito, e lojas do ERP sem contrato aparecem como "sem contrato".
- Servidor: `adq_contratos` valida `lojas` e `ecs` (listas de texto, sem repetição, com limite).

### 3 · SafraPay com dois layouts (detecção automática)

- **Agenda de Vendas** (visão *venda*: Data da Venda, Horário, Bandeira / Arranjo, Modalidade, Número do Terminal, Estabelecimento Comercial, Valor Bruto da Venda, Valor Líquido da Venda, Número Sequencial Único, Número de Autorização, Parcela…) e **Recebíveis de antecipação** (visão *pagamento*: Data do Pagamento … Valor Recebido). O botão aceita qualquer um dos dois; o layout é reconhecido pelo cabeçalho (linha 7 nos modelos), o CNPJ do Banco Safra (linha 2) só gera aviso e o arquivo é ligado ao **CNPJ do contrato** escolhido.
- **Armazenamento independente** no mesmo contrato SafraPay: os Recebíveis continuam em `adq_lotes` (competência = mês do *pagamento*) e a Agenda vai para `adq_agendas/<SAFRAPAY>__<cnpj14>__<AAAA-MM>` (competência = mês da *venda*). Uma importação nunca sobrescreve a outra; reimportar um mantém o outro byte a byte. A Agenda registra os ECs lidos; uma venda com várias linhas (uma por parcela) conta **uma vez** por **NSU + Autorização + Terminal**.
- **Agenda × Recebíveis** pela mesma chave (NSU + Autorização + Terminal): cada venda fica **Liquidada**, **Liquidada em parte** (parcelas pagas de n), **Pendente (prazo vencido)** ou **Aguardando pagamento** (o prazo previsto ainda não chegou ou os Recebíveis importados ainda não chegam lá). Vendas de 30/01 e 31/01 que liquidam em fevereiro aparecem como "liquida no mês seguinte" e passam a Liquidadas quando os Recebíveis de fevereiro são importados; recebíveis sem venda na Agenda são contados à parte.

### 4 · ERP × Adquirente (Getnet e SafraPay)

- **Getnet:** o ERP é agrupado por Dt Venda + Bandeira + Modalidade **somando OP = VE e OP = CX** e comparado com o lote Getnet aprovado do contrato, com tolerância de **± R$ 0,50 por dia**: *Conciliado ERP × Getnet*, *Diferença ERP × Getnet*, *ERP sem venda na adquirente* ou *Adquirente sem venda no ERP*. A **Antecipação** do ERP é comparada com a estimada pelo contrato (tolerância: a maior entre R$ 1,00 e 1%).
- **SafraPay:** o ERP das lojas ligadas ao EC é comparado com a **Agenda de Vendas** por Dt Venda + Bandeira; diferença de modalidade/parcelamento com valor igual é sinalizada à parte ("modalidade diferente").
- **Cobertura parcial nunca vira divergência falsa:** dia que o ERP importado não cobre, ou que a Agenda/lote não cobre, aparece como informativo ("fora da cobertura"), não como diferença.

### 5 · KPIs da Auditoria (triangulação)

Painel **Triangulação · ERP × Adquirente × Banco (OFX)**, por contrato ou consolidado: **Bruto ERP** · **Bruto Adquirente** · **Diferença ERP × Adquirente** · **Líquido Esperado (após MDR e Antecipação)** · **Crédito Confirmado no OFX** · **Furo / Divergência de Repasse** (furo + a menor + a maior). Mais: comparativo por contrato com só as divergências (opção), Agenda × Recebíveis, resumo informativo (QR-LINX, CREDNOSSO) e **exportação em `.csv`**. O Líquido Esperado e o Crédito Confirmado vêm da auditoria de repasse da v14.14 (não foram refeitos).

### 6 · Busca nos extratos OFX / DFC (revisão do Bloco 1)

As garantias da revisão da v14.14 (item 4b) foram **reauditadas com testes próprios** e seguem valendo sob o novo recurso: carga **direta do servidor/Postgres** de contas e extratos (nunca depende de a FCX ter sido aberta) ao abrir a Auditoria, ao importar e ao clicar **Recalcular**; conta casada por ID e por Banco + Agência + Conta normalizados; varredura de **todos** os créditos (valor > 0) qualquer que seja a categoria na DFC; históricos da Getnet (`GETNET`, `PAGAMENTO CARTAO DE DEBITO/CREDITO`, `ANTECIPACAO GETNET`, `LIQ GETNET`, `VISA ELECTRON`, `MAESTRO`, `ELO DEBITO`…) e da SafraPay (`SAFRA`, `SAFRAPAY`, `BANCO SAFRA`, `CREDITO CARTAO`, `LIQ RECEBIVEIS`, `TED 422`…) com *fallback* por valor + data; créditos fracionados do mesmo dia somados; janela D+0 a D+2 úteis (± R$ 0,10); débito de aluguel/tarifa de POS explicando o líquido a menor; período lido do 1º dia da competência ao 5º dia útil do mês seguinte (virada de mês, ex.: 30–31/01 liquidando em 02/02). O que a v14.15 acrescenta: o **Recalcular** também relê `adq_agendas` e `adq_erp`; o aviso de conta sem extrato passa a dizer *"Nenhum lançamento OFX encontrado no DFC para a conta [Nome] no período (…)"* (a v14.14 dizia "entre … e …") e **nunca** vira "Furo de repasse"; leitura recusada pelo servidor (HTTP 403) é erro explícito na tela, também nunca furo; o painel **"Extratos OFX lidos no DFC para esta conta"** (Data, Conta, Histórico/MEMO, Valor, Status *Casado com Lote* ou *Crédito OFX sem Lote correspondente*) acompanha a triangulação.

### 7 · Servidor, permissões e backup

- Arquivo novo: `netlify/lib/adq-1415.mjs` (`validarAgenda`, `validarErp`, `validarContratoExtras`, `protegerAdq1415`). Alterados: `documentos.mjs` (chama o gancho depois do `protegerAdq1414`), `regras.mjs` (`adq_agendas` e `adq_erp` admin/admin), `permissoes.mjs` (ler: `retaguarda.adq.ver`; gravar: `retaguarda.adq.importar`), `backup-escopo-1413.mjs` (as duas coleções entram na frente "Auditoria de Adquirentes e conciliação", nuvem e `.json`, iguais).
- O servidor só valida com o recurso ligado; recusa (422) agenda cuja chave não seja SAFRAPAY + CNPJ + competência da venda, ERP com id diferente da competência, formato inválido, grupo fora da competência (a recusa à Credsystem foi retirada na v14.15.1) e documento de contrato com `lojas`/`ecs` inválidos (também no ramo de ambiente). **Agendas e ERP não são promovidos** por "Liberar Versão em Produção" (são dados do ambiente, como contratos e lotes). Nenhuma migração, variável de ambiente ou rota nova.

### 8 · Testes (dados fictícios)

- `tests/teste-triangulacao-erp-safra-ofx-1415.mjs` — **119/119 na v14.15 (176/176 na v14.15.1)** (só Node, CNPJs gerados): recurso e Regra de Ouro; leitor do ERP (`" MDR"`, linhas sem Loja/Dt Venda, Credsystem fora, QR-LINX e CREDNOSSO informativos, VE + CX, DB/CR, `.csv`, 30 mil linhas); gravação por competência (mesclagem por dia, partes, exclusão); SafraPay nos dois layouts e armazenamento independente; Agenda × Recebíveis (liquidada, em parte, pendente, aguardando, virada de mês); ERP × Getnet (VE + CX, ± R$ 0,50, antecipação) e ERP × Agenda SafraPay (loja ligada, modalidade, cobertura parcial); KPIs; carga automática do DFC/OFX sem abrir a FCX, créditos fracionados, 30–31/01 → 02/02 e aviso sem OFX; validadores do servidor, ACL e backup; recurso desligado = v14.14.
- Navegador real + servidor real + Postgres, com **arquivos fictícios** (`.xlsx` de ERP, Agenda e Recebíveis gerados na hora): **33/33**. Regressões: o roteiro da v14.14 (com o recurso novo desligado) **41/41**, toda a bateria de servidor da v14.14 e os testes do painel (`teste-conciliacao-adquirentes-cnpj-1414` 124/124; `teste-economia-netlify-1410` com a contagem de botões da v14.15).

### Limites a saber

1. **Os formatos foram construídos pelas listas de colunas**, sem amostra real da Agenda de Vendas nem da Apuração dos Créditos. Se um arquivo real tiver coluna com outro nome, a leitura recusa com a mensagem "Não encontrei o cabeçalho…" e dá para ajustar o mapeamento.
2. O código da coluna **Adq** só é fixo para 303 (QR-LINX), 304 (Credsystem) e 372 (CREDNOSSO); Getnet e SafraPay são reconhecidas pela **descrição** da linha (e o código passa a ser aprendido dentro do arquivo).
3. **"Valor Bruto da Venda" por parcela ou por venda:** a Agenda conta o bruto **uma vez** quando ele é igual nas linhas repetidas da mesma venda e **soma** quando difere.
4. **Competências diferentes:** a Agenda é do mês da *venda*; Recebíveis e OFX são do mês do *pagamento*. Por isso o furo só é apontado quando o OFX cobre D+0 a D+2 do repasse.
5. Ler os extratos exige a permissão do DFC (`fcx.dfc.ver`); sem ela a tela mostra o erro do servidor (não o furo).
6. O ERP precisa ter as **lojas ligadas a cada contrato** para a comparação; sem isso só há o resumo.
7. Em **Produção e Falco**, nada disto aparece antes de "Liberar Versão em Produção".

## v14.14 · Conciliação de Cartões por contrato (Adquirente + Empresa/CNPJ) × Conta Bancária de Crédito (OFX) (recurso `gestao_v1414`)

Ativa na **Homologação**; em **Produção** e na **Falco** só depois de "Liberar Versão em Produção" (o recurso vale na hora, sem recarregar). Com o recurso desligado, o painel **e o servidor** são os da v14.13. O escopo é **somente** o elo *arquivos das adquirentes (Getnet e SafraPay) × Regras de Taxa por CNPJ × Extratos Bancários (OFX do FCX)*: o leitor e o cruzamento do **ERP não foram tocados** (o ERP segue opcional e desacoplado, na aba "Conciliação e Cruzamento") e a **Credsystem** segue em aberto. A Regra de Ouro foi conferida por hash: OFX/contas, adquirentes e FCX (`ADQ_CFG` → `PARTE_EXTRATO`) e Credsystem estão idênticos; `fcx.html` e os dois `contabilidade*.html` não foram tocados. Todo o código novo é um módulo próprio (`Adq14`) ligado por ganchos em tempo de execução.

### 1 · Contrato com a "Conta Bancária de Crédito (OFX)" obrigatória

- Em **Conciliação de Meios de Pagamento › Auditoria de Adquirentes › Regras de Taxa Contratuais** aparece o painel **Contratos × Conta Bancária de Crédito (OFX)**. Um contrato é **Adquirente + Empresa/CNPJ**; o campo **Conta Bancária de Crédito (OFX)** é obrigatório e lista **só as contas já cadastradas** no painel (as mesmas do FCX / Extratos OFX). Exemplo: GETNET · Resilienza → Conta A; GETNET · Mar Aberto → Conta B; SAFRAPAY · Resilienza → Conta C.
- A empresa precisa ter **CNPJ no cadastro** (Empresas · Razão Social / CNPJ): sem ele o contrato não é criado e a importação é bloqueada, porque a trava de CNPJ do upload não teria o que conferir.
- Regras de taxa por Empresa/CNPJ que ainda não têm contrato aparecem como **pendentes**, com o botão "Vincular conta". As taxas continuam sendo as de **Regras de Taxa** (adquirente + bandeira + Empresa/CNPJ; sem regra da empresa vale a Todas / Padrão): fonte única, sem duplicar cadastro.
- Servidor: a coleção `adq_contratos` recusa (422) contrato sem conta ou com conta que não exista na base (também no ramo de ambiente).

### 2 · Importação isolada por contrato e lista "Arquivos carregados no período"

- Nova sub-aba **Conciliação de Cartões** (a 2ª, depois de "Conciliação e Cruzamento"). O primeiro passo é **escolher o contrato**; só então aparece o seletor de arquivo. A tela mostra o CNPJ, a **conta vinculada** e as **taxas cadastradas** do contrato.
- Cada arquivo vira **um lote por competência** guardado na chave **Adquirente + CNPJ + Competência** (`adq_lotes/<adq>__<cnpj14>__<AAAA-MM>`). Importar GETNET · Mar Aberto regrava **somente** os lotes de GETNET · Mar Aberto daquele mês; GETNET · Resilienza, SAFRAPAY e qualquer outro CNPJ ficam intactos **por construção** (e o servidor recusa, com 422, qualquer lote cujo identificador não bata com adquirente + CNPJ + competência do conteúdo). A tela avisa "substitui o lote de dd/mm hh:mm" antes de gravar.
- **Arquivos carregados no período** (por competência, com chips para pular de mês): Adquirente, Empresa/CNPJ, **Conta vinculada**, **Qtd. de transações**, **Valor bruto**, **Líquido esperado**, arquivo e data, com **Reimportar** (só aquele lote: o arquivo pode ter outros meses, mas só a competência escolhida é substituída) e **Excluir** (dupla confirmação; só aquele lote). Remover um contrato não apaga os lotes.
- **Segurança do upload:** o CNPJ do arquivo Getnet precisa ser o do contrato escolhido; se for outro, a leitura é **bloqueada antes de gravar**, a tela cita os dois CNPJs e sugere o contrato certo (botão "Usar o contrato …"). O cabeçalho da SafraPay traz o CNPJ do **Banco Safra** (58.160.789/0001-28 no modelo): não bloqueia, vira aviso, o lote é **vinculado ao CNPJ do contrato** e o **Estabelecimento Comercial** (1454475) fica registrado no lote; se esse EC já foi importado para outro CNPJ, a tela avisa.

### 3 · Leitores exatos dos arquivos reais

- **Getnet (`extrato_detalhado_cartao_….csv`)**: separador `;`, **ISO-8859-1**; linhas em branco e separadoras (`;;;…;-`) ignoradas e contadas; **só `STATUS DA TRANSAÇÃO = "Aprovada"`** entra no financeiro (Negada, Estornada e Desfeita são totalizadas à parte, como informativo). `VALOR TAXA` é só o **MDR** (negativo). Cada venda é conferida pela regra **Empresa/CNPJ + Bandeira + Modalidade (débito, crédito 1x, 2–6x, 7–12x)**. Para contrato **100% antecipado**, o custo de antecipação é calculado **pro rata** (% a.m. do contrato × dias de cada parcela até o repasse em **D+1 útil**) e sai do líquido: é o **Líquido Esperado no Banco**, por data de repasse. O arquivo real de 34 MB (~104 mil linhas) é lido no navegador em poucos segundos; o lote guarda **fatos agregados** (um resumo por venda × 1º pagamento × bandeira × forma × parcelas: ~800 linhas em vez de 100 mil), o que cabe no limite de documento e deixa o cálculo refazível com as regras de hoje.
- **SafraPay (`Recebiveis de antecipação.xlsx`)**: o **cabeçalho é achado sozinho** (linha 7 no modelo), as máscaras `R$ 110,08` e `- R$ 1,97` são limpas, totais e rodapé ignorados. Cada linha é uma **parcela já antecipada**: confere a **Taxa de Administração (MDR)** venda a venda e a **Taxa de Antecipação** contra o contrato; o Líquido Esperado é a **soma do `Valor Recebido` por `Data do Pagamento`**. Competência = mês da **Data do Pagamento** (o arquivo não traz a data da venda).

### 4 · Auditoria Adquirente × Banco (OFX), por contrato ou consolidada

- Filtro: **um contrato** (os créditos são procurados **somente no OFX da conta vinculada** a ele) ou **todos os CNPJs e adquirentes** (consolidado + detalhamento por Empresa/CNPJ e Adquirente).
- **Divergências de taxa:** MDR (e antecipação, na SafraPay) **acima do contrato**, por bandeira/modalidade, e as vendas da SafraPay acima do contrato uma a uma.
- **Divergências de repasse:** **Furo de Repasse** (nada creditado, com o extrato OFX da conta cobrindo toda a janela), **Liquidado a Menor**, **Liquidado a Maior** e **Sem OFX na data** (a conta não tem extrato daquele período: não é furo, falta o arquivo). A chave de conferência é conta + adquirente + dia do repasse, com **janela de D+0 a D+2 dias úteis** (fim de semana e feriados nacionais fora); dois contratos da mesma adquirente que dividem a conta têm os créditos conferidos pela soma. O dia conciliado aparece como **Conciliado (D+0 / D+1 / D+2)**. Tolerâncias: `max(0,10; 0,01%)` quando o valor é exato (SafraPay) e `max(1,00; 0,05%)` quando é estimado pelo contrato (Getnet).
- **Recalcular:** o cálculo é feito em memória a partir dos fatos do lote + as regras de hoje; depois de editar uma taxa (ou carregar um OFX novo), o botão relê do servidor as regras de taxa **e os extratos OFX do DFC** e, para quem pode importar, atualiza o resumo gravado dos lotes — sem reimportar o arquivo. Há exportação em `.csv` das divergências.

### 4b · Blindagem da leitura do OFX / DFC (revisão antes de liberar em Produção)

Motivo: testes reais mostraram "falta de valores / furo de repasse" para créditos que existiam no OFX. Causas tratadas no front (nenhuma mudança no servidor, nenhuma permissão nova):

1. **Carga obrigatória do servidor.** A auditoria **nunca** presume que a lista de extratos já está em memória (ela só é preenchida quando a pessoa abre a FCX/DFC). Ao abrir a Auditoria de Adquirentes, ao clicar **Recalcular** e depois de **importar um lote**, o painel relê `contasBancarias` e `extratos` direto do servidor/Postgres (`Repo.recarregar`) quando a coleção está vazia, nunca foi lida, tem mais de 10 minutos ou o usuário forçou. Enquanto lê, a tela mostra "Carregando os extratos OFX do DFC…". Se o servidor recusar (perfil sem acesso ao DFC, rede), aparece o erro com a causa e os repasses ficam "Sem OFX na data" — **nunca** "Furo de repasse". A leitura de extratos continua exigindo `fcx.dfc.ver` (a ACL do servidor não foi ampliada).
2. **Conta bancária casada por ID e pela conta real.** O OFX da conta vinculada é lido pelo ID interno **e** por Banco + Agência + Conta normalizados (sem zeros à esquerda, traços, DV junto ou separado, `ofxAcctId`), de modo que um cadastro duplicado da mesma conta não esconde créditos. Contas diferentes (outro banco, outra agência ou outro número) nunca se misturam.
3. **Varredura de todos os créditos da conta.** Entram todas as linhas de entrada (valor > 0) do OFX, qualquer que seja a categoria no DFC ("Sem regra", "Outras entradas", transferências). A adquirente é reconhecida pelo histórico (NAME · MEMO) com o apelido cadastrado + a lista padrão — Getnet: `GETNET`, `LIQ GETNET`, `ANTECIPACAO GETNET`, `PAGAMENTO CARTAO DE DEBITO/CREDITO`, `VISA ELECTRON`, `MAESTRO`, `ELO DEBITO`; SafraPay: `SAFRAPAY`, `SAFRA`, `BANCO SAFRA`, `CREDITO CARTAO`, `LIQ RECEBIVEIS`, `TED 422`. Se o banco trouxe só "TED"/"CRÉDITO" genérico, o **crédito único** que bate com o líquido esperado na janela é casado **só pelo valor e pela data** (e a tela diz isso); crédito que cita **outra** adquirente nunca é usado.
4. **Créditos fracionados.** No dia do repasse (e em D+1/D+2) o painel testa o crédito único, a **soma de todos** os créditos da adquirente, o **subconjunto** que fecha o valor (até 12 créditos) e o casamento **por modalidade** (débito + crédito); também junta créditos de mais de um dia da janela. Tolerância ± R$ 0,10 (valor exato) ou ± R$ 1,00 / 0,05% (estimado).
5. **Aluguel/tarifa de POS.** Débitos de aluguel/tarifa/mensalidade que citam a adquirente ou o POS, na janela do repasse, explicam um **Liquidado a Menor** ("explicado por aluguel/tarifa de POS" quando fecha a diferença; "parcialmente" quando não).
6. **Painel de transparência "Extratos OFX lidos no DFC para esta conta".** Por conta vinculada: o período lido (do 1º dia da competência ao 5º dia útil do mês seguinte, o que cobre a virada de mês), o total de lançamentos, cada crédito com Data, Conta Bancária, Histórico/MEMO, Valor e status **Casado com Lote** ou **Crédito OFX sem Lote correspondente**, as faixas de datas com extrato importado e os débitos de POS. Sem nenhum lançamento OFX no período aparece em destaque: **"Nenhum lançamento OFX encontrado no DFC para a conta [conta] entre [data inicial] e [data final]."** — e os repasses dela ficam "Sem OFX na data", não "Furo de repasse". O `.csv` exportado inclui os créditos do OFX sem lote.

Regra de Ouro preservada: `fcx.html`, `contabilidade.html` e `contabilidade_v1391.html` byte a byte; blocos OFX/DFC e `ADQ_CFG` do painel com o mesmo md5 (as tolerâncias novas ficam em `ADQ14.TOL`, sem tocar `ADQ_CFG`). Com o recurso `gestao_v1414` desligado nada disso existe.

### 5 · Servidor, permissões e backup

- Arquivos novos/alterados: `netlify/lib/adq-1414.mjs` (novo); `documentos.mjs` (chama `protegerAdq1414`), `regras.mjs` (`adq_contratos` e `adq_lotes` admin/admin), `permissoes.mjs` (ler: `retaguarda.adq.ver`; contratos gravam com `retaguarda.adq.taxas`; lotes gravam com `retaguarda.adq.importar`), `backup-escopo-1413.mjs` (as duas coleções entram na frente "Auditoria de Adquirentes e conciliação" dos dois backups). Nenhuma migração, variável de ambiente ou rota nova.
- **Contratos e lotes não são promovidos** por "Liberar Versão em Produção" (o identificador da conta bancária é de cada ambiente e os lotes são dados importados): as **taxas** seguem a promoção de sempre; em cada ambiente os contratos são cadastrados uma vez.

### 6 · Testes (dados fictícios)

- `tests/teste-conciliacao-adquirentes-cnpj-1414.mjs` — **124/124** (só Node): Regra de Ouro, leitores com arquivos fictícios nos layouts reais, trava de CNPJ, cálculo por contrato, importação simultânea Getnet Resilienza + Getnet Mar Aberto + SafraPay sem sobrescrita, vínculo contrato→conta, cruzamento com o OFX por contrato e consolidado (isolamento entre contas, conta compartilhada, Furo, a Menor, a Maior, Sem OFX), **leitura direta do DFC/OFX no servidor sem abrir a aba FCX (e erro 403), créditos fracionados do mesmo dia (soma, subconjunto, modalidade), virada de mês (31/01 → 02/02), alerta de conta sem OFX, contas equivalentes (Banco + Agência + Conta), créditos genéricos casados só pelo valor, tarifa de POS e janela D+0..D+2 com tolerância de R$ 0,10**, Recalcular, trava do servidor (422), ACL e catálogo de backup.
- Chromium real + servidor real + Postgres, com os **arquivos reais do cliente** (Getnet Resilienza 34 MB, Getnet Mar Aberto e SafraPay): **41/41**, incluindo contrato sem conta (bloqueado), CNPJ trocado (bloqueado, nada gravado), três arquivos juntos, reimportação só da chave, exclusão de um lote, recusa do servidor, OFX por conta, leitura do OFX direto do servidor numa aba sem extratos em memória, painel "Extratos OFX lidos" por conta, alerta da conta sem OFX e Recalcular. Esse roteiro e os arquivos reais **não fazem parte do ZIP** (dados do cliente).
- Regressão: toda a bateria de servidor da v14.13 (inclusive o teste do catálogo de backup) e `teste-economia-netlify-1410` (contagem de botões ajustada) continuam verdes.

### Limites a saber

1. **Getnet: a antecipação não está no arquivo** (`VALOR TAXA` é só o MDR). O Líquido Esperado é **estimado pelo contrato** (por isso a tolerância maior e a marca "estimado pelo contrato"); a divergência de antecipação da Getnet só aparece como diferença de repasse no OFX.
2. **SafraPay: o arquivo não traz a data da venda nem o número da parcela.** O MDR é conferido exatamente por venda; a antecipação é conferida contra o **máximo plausível** do contrato (faixa de dias úteis), então só diferenças claras são sinalizadas.
3. Os lotes da Getnet guardam fatos **agregados**: o MDR do contrato é calculado por grupo e pode diferir de centavos do cálculo venda a venda (tolerância por raiz da quantidade).
4. O limite por lote é de ~15 mil vendas da SafraPay e ~4,8 MB por documento; acima disso a leitura é bloqueada com a orientação de dividir o arquivo por período.
5. A trava de CNPJ do arquivo Getnet depende de a empresa ter CNPJ no cadastro. Na SafraPay o CNPJ do arquivo é o do banco, então a única pista é o Estabelecimento Comercial.
6. Em **Produção e Falco**, nada disto aparece antes de "Liberar Versão em Produção".

## v14.13 · Regras da DFC "pétreas", reaplicação automática aos meses do OFX e auditoria dos backups (recurso `gestao_v1413`)

Ativa na **Homologação**; em **Produção** e na **Falco** só depois de "Liberar Versão em Produção" (o recurso vale na hora, sem recarregar). Com o recurso desligado, o painel **e o servidor** são os da v14.12. `fcx.html`, `contabilidade.html` e `contabilidade_v1391.html` **não foram tocados** (Regra de Ouro: os 3 hashes conferem). Nenhuma migração de banco, variável de ambiente ou rota nova (há ações novas na rota existente `/api/backup-nuvem`).

### 1 · Regras de classificação da DFC protegidas (documento `config/dfc`)

**O problema que isto fecha:** o `config/dfc` guarda, no mesmo documento, as regras, as categorias da DFC, os ajustes das categorias padrão e o De-para FCX → DFC, e o painel regravava o documento **inteiro** a cada alteração. Uma aba com cópia vazia, antiga ou "de fábrica" (leitura que falhou, tela aberta há horas, outro computador que já alterou) apagava o que o servidor tinha.

- **Servidor (`netlify/lib/dfc-1413.mjs`, dentro da transação de `documentos.gravar`, com lock consultivo):** `regras_inicializadas` é permanente (nunca volta a `false`; um documento antigo que já tem a lista `regras` conta como inicializado, sem migração). A **semente de fábrica** chega marcada (`regras_semente`) e só entra se o servidor respondeu e o documento **nunca foi inicializado**; caso contrário, 409 `regras_ja_inicializadas` e as regras do usuário ficam. `regras_rev` é o contador da lista: quem muda a lista manda o do servidor **+ 1**, senão 409 `regras_desatualizadas`. Gravar só categorias, ajustes ou De-para passa e **preserva a lista do servidor** (uma cópia de fábrica, velha ou vazia enviada por engano não a substitui). Lista inválida: 422 com o motivo.
- **Nenhuma rotina automática grava o `config/dfc`:** abrir a tela, login, F5, ciclo de sincronização (`mudancas.mjs`) e leituras não escrevem nada (testado: o documento mantém a mesma versão). Só uma ação do usuário (criar, editar, **subir ↑, descer ↓**, excluir regra ou categoria, ajuste de categoria padrão, De-para) grava.
- **Gravação confirmada e à vista:** o painel **lê o servidor na hora**, aplica a sua mudança **por id** sobre a versão que está lá (não substitui a lista inteira: duas pessoas criando regras ao mesmo tempo ficam com as duas), grava **esperando a confirmação do servidor** e só então mostra **"Regras salvas no servidor"**. Se outra pessoa mudou no meio (409), relê e refaz (até 3 tentativas). Se não der, abre um **alerta em linguagem simples** ("As regras da DFC NÃO foram salvas… Nada foi alterado no servidor") — nunca silencioso. Sem permissão, ou com a leitura do servidor falhando, **nada é gravado** e o aviso diz o porquê.
- **Polling entre abas e computadores nunca regride:** um snapshot da coleção `config` com contador menor, ou sem o documento, **não troca** a cópia local; uma gravação confirmada por esta aba não é desfeita por uma leitura que viajou ao mesmo tempo (o adaptador descarta e refaz essa leitura). A aba "Regras de classificação" ganhou uma faixa de situação ("Regras de fábrica em uso" até a primeira alteração; depois "Regras protegidas no servidor · versão N") e avisa quando não consegue ler o servidor.
- **"Liberar Versão em Produção" não leva o `config/dfc` da Homologação** quando o recurso está ligado (copiar as regras de teste por cima das regras reais da Produção seria exatamente o que esta versão proíbe).

### 2 · Regras aplicadas sozinhas a todos os meses do OFX

- Depois de **criar, editar, reordenar ou excluir** uma regra (e de mudar categorias, ajustes de categoria padrão ou o De-para), o painel **reclassifica todos os meses importados** e grava as bases mensais (`dfc/AAAA-MM`) — sem clicar em "Recalcular DFC". Cada base mensal guarda a **assinatura das regras** (hash de regras + categorias + ajustes + De-para + versão do motor): só é regravado o mês que mudou (reaplicar sem mudança grava 0 bases), com **um único registro** resumido na auditoria e um aviso de progresso quando são muitos meses.
- **Ao trocar o mês** em Extratos OFX, DFC do mês ou Realizado × Previsto, e **ao gerar o Resumo Executivo (PDF)**, o painel traz as regras vigentes do servidor e reclassifica antes de exibir o mês cuja base tem assinatura antiga. Quem só lê (sem permissão para gravar) vê sempre o cálculo ao vivo e não regrava nada.
- **Classificação manual nunca é sobrescrita:** a classificação do usuário fica no extrato (`cat`; as novas também levam `manual: true`) e a reaplicação **nunca altera os extratos**. Hierarquia (a mesma da v14.09): Manual > Regras > Contas a Pagar do FCX > Categoria padrão do Fornecedor/Cliente > Padrão por sentido.
- **"Recalcular DFC" virou atalho opcional** (relê o servidor e regrava todas as bases). Se a leitura das regras falhou, a base **não** é recalculada (para nunca gravar `dfc/` com regras de fábrica por engano).

### 3 · Auditoria e paridade dos backups

**Um catálogo só** (`netlify/lib/backup-escopo-1413.mjs`): 14 frentes (lojas e PE, RH e organograma com férias e folgas, viagens e adiantamentos, contratos/apólices/reajustes, Fornecedores e Clientes com PIX e categoria DFC, DFC com contas/extratos/bases, FCX, Retaguarda, Credsystem, Auditoria de Adquirentes, configurações, usuários e permissões, Central de Notificações, Contábil). O painel **embute esse mesmo arquivo na hora do build**, então o `.json` e o ponto na nuvem **não podem divergir** (o teste confere); uma coleção nova usada pelo painel e sem frente **reprova o teste**.

- **Ponto na nuvem, formato 2 (recurso ligado):** os quatro tipos — **PRIMEIRO_ACESSO, AUTOMATICO das 23:59, MANUAL e PREVENTIVO** — gravam os documentos de tudo o que está no escopo **mais as tabelas de configuração** `painel_notificacoes_regras` (regras e disparos da Central de Notificações), `contab_empresas` e `contab_depara`, com as contagens por tabela e os destaques da DFC (regras, categorias, ajustes, De-para, inicializada). O formato 1 continua restaurável. A restauração aplica as tabelas **na mesma transação**; o de-para cuja conta do plano não existe mais volta como "pendente" (nunca viola a chave estrangeira) e o **contador `regras_rev` sempre anda para a frente**, para os outros computadores aceitarem a lista restaurada.
- **Arquivo `.json` de contingência (versão 2):** agora inclui **Fornecedores e Clientes (`parceiros`)**, os anexos dos termos assinados em partes (`faltas` e `ret_ocorrencias`) e as **três tabelas** (via `/api/backup-nuvem` `{acao:'tabelas'}`), mais um resumo por módulo. Se uma coleção falhar na leitura, o arquivo **não** é gerado pela metade. Na restauração, uma caixa "Restaurar também as tabelas de configuração do arquivo" cria antes um ponto preventivo e mostra o que foi aplicado; o `config/dfc` do arquivo volta pela trava do servidor (contador do servidor + 1).
- **Resumo conferível:** ao criar o ponto na nuvem, ao baixar o `.json` e no botão **"Ver conteúdo"** de cada ponto, o painel mostra **por módulo** as coleções e tabelas com o total de registros, mais as regras, categorias e ajustes da DFC e o que fica de fora de propósito. Ações novas de `/api/backup-nuvem`: `conteudo`, `tabelas` e `restaurar-tabelas` (só Master, corpo até 2 MB); com o recurso desligado respondem 404 `recurso_indisponivel`.
- **Fica de fora de propósito** (não deve ser sobrescrito por uma restauração): log de auditoria (opcional no `.json`), presença, marcadores do sistema e ramos de ambiente; os arquivos binários enviados (PDF e imagens); o **livro contábil** (lançamentos, partidas e LALUR), o plano de contas e os parâmetros contábeis (data de fechamento — uma restauração nunca reabre período fechado); as decisões de aprovação de pagamentos (`painel_saidas_*`); e o log de envios e os números instantâneos da Central de Notificações (histórico/derivado, não configuração).

### Limites a saber

1. A trava e a reaplicação valem com o recurso ligado; **em Produção, só depois de "Liberar Versão em Produção"**.
2. A **reaplicação aos meses roda no navegador de quem altera a regra** (grava as bases `dfc/AAAA-MM`). Se a pessoa fechar a aba no meio, o que faltou é completado na próxima troca de mês de quem tiver permissão; as telas, de qualquer forma, calculam ao vivo com as regras vigentes.
3. Restaurar o `config/dfc` de um `.json` **substitui a lista de regras pela do arquivo** (é o que o usuário pediu ao restaurar); o contador sobe, então nenhuma aba desatualizada a desfaz.
4. O **livro contábil, o plano de contas e as aprovações de pagamento não entram nos backups** (decisão de segurança acima); uma restauração de ponto não os altera.
5. Uma aba aberta **antes** da v14.13 (sem o contador) que tente mudar a lista recebe o 409 com a orientação de dar F5.
6. A **trava atômica do servidor** (`regras_inicializadas`, `regras_rev`, 409) existe no **Netlify**. Dentro do claude.ai (painel local, sem servidor próprio) valem a leitura fresca, a mudança por id e o aviso de gravação, mas não há a recusa do servidor: o banco do artefato aceita a gravação como sempre (testado no painel local: telas de regras e categorias abrem e salvam; as 2 falhas antigas do teste de categorias da v14.04 são as mesmas da base v14.12).
7. O E2E de navegador e a bateria antiga de navegador ficam fora do ZIP (dependem do painel local e do servidor de teste).

### Teste (dados fictícios)

- `tests/teste-dfc-regras-backup-1413.mjs`: **100** verificações. **Bloco A (Node, sem banco):** recurso e Regra de Ouro; catálogo de backup idêntico no painel e no servidor, todas as coleções do `.json` anterior ainda presentes, **toda coleção usada pelo painel pertence a uma frente**; mesclagem por id (criar, editar, mover, excluir sem pisar no que outra pessoa fez), snapshot que nunca regride, reaplicação em **3 meses de OFX** com o código real da DFC (manual preservado, extratos intocados, idempotente), leitura que falhou não grava, alerta explícito, permissão, recurso desligado = v14.12. **Bloco B (Postgres local e HTTP real):** trava no servidor (semente única, F5/login/sync sem alterar, 409/422, recurso desligado), o **código real do painel falando com o servidor real** (criar/editar/mover/excluir, base velha, snapshot atrasado, adaptador), e a **prova de backup**: registros simulados em todas as frentes (DFC e regras, empresas/Matriz, parceiros/PIX, notificações, contratos, férias, viagens, retaguarda, adquirentes, usuários…), ponto na nuvem (os 4 tipos) **e** `.json`, base apagada e restaurada **duas vezes** (do ponto e do `.json`): documentos e tabelas voltam idênticos; paridade dos conjuntos; auditoria/presença/sistema intactos.
- Regressão (todas verdes): servidor com Postgres — permissões 31, aprovações de saídas 43, notificações 134, migrações 43, backup nuvem 54 (ajustado: formato legado e versão), contábil 38 e 20, adiantamentos 13, consulta CNPJ 15, carga em massa 18, carga Falco 18, ambiente Falco 7, lote 2 servidor 24; painel (Node) — economia 106 (ajustado: contagem de botões da v14.13), lote 1 101, lote 2 100, DFC categorias 58 e 72, matriz 73 e 60, resumo bancário 72, fornecedores/PIX 78, OFX × Contas a Pagar 71, BSC 69, KPIs 42, modal de backup 24.
- Bateria antiga de navegador (21 testes locais, painel local com a v14.13): **as mesmas 28 falhas da mesma bateria sobre a base da v14.12 e o mesmo número de verificações aprovadas em cada teste** — as falhas são de testes que comparam as regiões protegidas, o selo "v14.01" e o número de botões de arquivo com versões antigas (e a visibilidade de salários do gestor de topo, da v14.12); nenhuma é nova.
- Fora do ZIP: roteiro no **Chromium real com o servidor local e o Postgres** (**33/33**): recurso desligado e ligado; criar, editar, ↑, ↓ e excluir regra pela tela com o aviso e a gravação conferida no servidor; reclassificação dos 3 meses sem clicar; F5; segunda aba; duas abas criando regras ao mesmo tempo; servidor derrubado na hora de salvar; troca de mês; Recalcular opcional; ponto na nuvem com resumo e "Ver conteúdo"; download do `.json`; **restauração do `.json` pela tela** com as tabelas.
