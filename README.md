# Painel de Gestão Esposende · Netlify + Netlify Database (Postgres)

Versão v14.06. O painel roda no Netlify com um banco **Postgres gerenciado (Netlify Database)** e as rotas da API em
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
