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
