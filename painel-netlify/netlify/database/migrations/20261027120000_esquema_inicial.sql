-- Painel de Gestão Esposende · Netlify Database (Postgres) · esquema inicial (v13.75)
--
-- Os módulos do painel gravam "documentos" em coleções (lojas, funcionarios, credsystem, fcx, config…), o mesmo
-- modelo do banco do claude.ai. Aqui cada documento é uma linha com o conteúdo em JSONB, endereçada pelo caminho
-- "<coleção>/<id>" (coleções podem ser aninhadas: auditoria/<conta>/dias/<dia>; Homologação e RC ficam sob amb/<ambiente>/).
-- Em volta disso, tabelas relacionais de verdade: sessões, tentativas de login, log de mudanças (sincronização entre
-- computadores) e arquivos (PDF/imagens) — e views relacionais para consulta/BI das principais coleções.

-- ---------------------------------------------------------------- documentos
CREATE TABLE documentos (
  caminho        text        PRIMARY KEY,
  colecao        text        NOT NULL,
  doc_id         text        NOT NULL,
  dados          jsonb       NOT NULL,
  versao         integer     NOT NULL DEFAULT 1,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  atualizado_por text,
  CONSTRAINT documentos_caminho_ck CHECK (caminho = colecao || '/' || doc_id),
  CONSTRAINT documentos_dados_ck   CHECK (jsonb_typeof(dados) = 'object')
);
CREATE INDEX documentos_colecao_idx ON documentos (colecao, doc_id);
CREATE INDEX documentos_atualizado_idx ON documentos (atualizado_em);

-- ---------------------------------------------------------------- mudanças (sincronização entre computadores)
CREATE TABLE mudancas (
  seq      bigserial   PRIMARY KEY,
  caminho  text        NOT NULL,
  colecao  text        NOT NULL,
  op       text        NOT NULL CHECK (op IN ('set', 'remove')),
  em       timestamptz NOT NULL DEFAULT now(),
  por      text
);
CREATE INDEX mudancas_em_idx ON mudancas (em);

-- ---------------------------------------------------------------- sessões do login por CPF (cookie HttpOnly)
CREATE TABLE sessoes (
  token_hash       text        PRIMARY KEY,           -- SHA-256 do token; o token em si só existe no cookie
  usuario_caminho  text        NOT NULL,              -- ex.: usuarios/usr-xxx ou amb/homolog/usuarios/usr-xxx
  ambiente         text        NOT NULL DEFAULT 'prod' CHECK (ambiente IN ('prod', 'homolog', 'rc')),
  troca_pendente   boolean     NOT NULL DEFAULT false, -- 1º acesso / senha redefinida: só pode trocar a senha
  criada_em        timestamptz NOT NULL DEFAULT now(),
  expira_em        timestamptz NOT NULL,
  ip               text,
  agente           text
);
CREATE INDEX sessoes_expira_idx ON sessoes (expira_em);
CREATE INDEX sessoes_usuario_idx ON sessoes (usuario_caminho);

CREATE TABLE tentativas_login (
  id     bigserial   PRIMARY KEY,
  chave  text        NOT NULL,                        -- cpf:<dígitos> ou ip:<endereço>
  em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tentativas_login_idx ON tentativas_login (chave, em);

-- ---------------------------------------------------------------- arquivos (contratos, termos, comprovantes)
CREATE TABLE arquivos (
  id          text        PRIMARY KEY,
  nome        text        NOT NULL,
  tipo        text        NOT NULL,
  tamanho     integer     NOT NULL CHECK (tamanho >= 0 AND tamanho <= 15728640),
  partes      integer     NOT NULL CHECK (partes BETWEEN 1 AND 32),
  concluido   boolean     NOT NULL DEFAULT false,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  criado_por  text
);
CREATE TABLE arquivo_partes (
  arquivo_id  text    NOT NULL REFERENCES arquivos (id) ON DELETE CASCADE,
  n           integer NOT NULL CHECK (n >= 0),
  dados       bytea   NOT NULL,
  PRIMARY KEY (arquivo_id, n)
);

-- ---------------------------------------------------------------- views relacionais (Produção) para consulta e BI
CREATE FUNCTION jnum(j jsonb) RETURNS numeric LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE
    WHEN jsonb_typeof(j) = 'number' THEN (j #>> '{}')::numeric
    WHEN jsonb_typeof(j) = 'string' AND (j #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (j #>> '{}')::numeric
  END
$fn$;

CREATE FUNCTION jarr(j jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE WHEN jsonb_typeof(j) = 'array' THEN j ELSE '[]'::jsonb END
$fn$;

CREATE VIEW vw_lojas AS
  SELECT doc_id AS id, dados->>'codigo' AS codigo, dados->>'nome' AS nome, dados->>'cnpj' AS cnpj,
         dados->>'cidade' AS cidade, dados->>'uf' AS uf, dados->>'tipo' AS tipo, dados->>'bandeira' AS bandeira,
         dados->>'classificacao' AS classificacao, COALESCE(dados->'ativa' <> 'false'::jsonb, true) AS ativa, atualizado_em
  FROM documentos WHERE colecao = 'lojas';

CREATE VIEW vw_lojas_ecs AS
  SELECT d.doc_id AS loja_id, d.dados->>'nome' AS loja, e->>'adquirente' AS adquirente, e->>'ec' AS ec,
         e->>'empresaId' AS empresa_id, jnum(e->'qtdePos') AS qtde_pos, jnum(e->'posAluguel') AS aluguel_pos
  FROM documentos d CROSS JOIN LATERAL jsonb_array_elements(jarr(d.dados->'adquirentes')) AS e
  WHERE d.colecao = 'lojas';

CREATE VIEW vw_empresas AS
  SELECT e->>'id' AS id, e->>'nome' AS nome, e->>'razao' AS razao, e->>'cnpj' AS cnpj
  FROM documentos d CROSS JOIN LATERAL jsonb_array_elements(jarr(d.dados->'lista')) AS e
  WHERE d.caminho = 'config/empresas';

CREATE VIEW vw_usuarios AS                      -- sem a senha
  SELECT doc_id AS id, dados->>'perfil' AS perfil, dados->>'nome' AS nome, dados->>'funcionarioId' AS funcionario_id,
         COALESCE(dados->'ativo' <> 'false'::jsonb, true) AS ativo, COALESCE(dados->'trocarSenha' = 'true'::jsonb, false) AS trocar_senha,
         dados->>'ultimoAcesso' AS ultimo_acesso
  FROM documentos WHERE colecao = 'usuarios';

CREATE VIEW vw_credsystem_recebimentos AS        -- Retaguarda › Conciliação dos recebimentos (loja × dia)
  SELECT d.doc_id::date AS data, l->>'lojaId' AS loja_id, jnum(l->'web') AS websystem, jnum(l->'din') AS dinheiro,
         jnum(l->'cart') AS cartao, jnum(l->'cartLote') AS cartao_lote, jnum(l->'pix') AS pix, jnum(l->'pixLote') AS pix_lote,
         l->>'obs' AS obs
  FROM documentos d CROSS JOIN LATERAL jsonb_array_elements(jarr(d.dados->'linhas')) AS l
  WHERE d.colecao = 'credsystem' AND d.doc_id ~ '^\d{4}-\d{2}-\d{2}$';

CREATE VIEW vw_conc_fechamento AS                -- Auditoria de Adquirentes › Resumo do Fechamento
  SELECT d.doc_id AS documento, l->>'data' AS data, l->>'lojaId' AS loja_id, l->>'empresaId' AS empresa_id,
         l->>'mod' AS modalidade, l->>'adquirente' AS adquirente, jnum(l->'bruto') AS bruto, jnum(l->'brutoLote') AS bruto_lote,
         jnum(l->'liquido') AS liquido, jnum(l->'custoMdr') AS custo_mdr, jnum(l->'custoAntecip') AS custo_antecipacao,
         jnum(l->'custoPos') AS custo_pos, jnum(l->'custo') AS custo_total
  FROM documentos d CROSS JOIN LATERAL jsonb_array_elements(jarr(d.dados->'linhas')) AS l
  WHERE d.colecao = 'conc_fechamento';
