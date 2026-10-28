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
| `PAINEL_CHAVE_AMBIENTES` | **o mesmo segredo nos três** (32+ caracteres) | idem | idem |
| `PAINEL_MOSTRAR_AMBIENTES` | — | — | `0` para os clientes da RC não verem a Esposende no seletor (opcional) |
| `PAINEL_SO_MASTER` | — (padrão: todos) | — (padrão: só o Master) | — (padrão: todos) |

Os endereços são completos, com `https://` e sem barra no final, como `https://painel-esposende.netlify.app`.

Para gerar a chave, rode `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` uma vez e cole o mesmo valor nos três sites.

Depois de alterar variáveis, faça um novo deploy (*Deploys › Trigger deploy*).

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
