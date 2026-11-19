-- v13.91 · Módulo Contábil multiempresas.
-- Cada lançamento pertence a uma empresa (CNPJ). O plano de contas, o de-para do FCX e os parâmetros continuam únicos.
-- Os lançamentos que já existem ficam na "Empresa principal" (emp_principal): nada se perde, e a cadeia de conferência
-- (hash) dos lançamentos antigos não muda.
CREATE TABLE IF NOT EXISTS contab_empresas (
  id                     text        PRIMARY KEY,
  cnpj                   text        UNIQUE CHECK (cnpj IS NULL OR cnpj ~ '^[0-9]{14}$'),
  razao_social           text        NOT NULL CHECK (length(razao_social) BETWEEN 2 AND 200),
  nome_fantasia          text,
  regime                 text        NOT NULL DEFAULT 'presumido' CHECK (regime IN ('simples', 'presumido', 'real', 'mei')),
  capital_social_centavos bigint     NOT NULL DEFAULT 0 CHECK (capital_social_centavos >= 0),
  socios                 jsonb       NOT NULL DEFAULT '[]'::jsonb,   -- QSA: [{ nome, documento, qualificacao, participacao }]
  contador               jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- { nome, crc, uf, email }
  endereco               text,
  ativa                  boolean     NOT NULL DEFAULT true,
  criado_em              timestamptz NOT NULL DEFAULT now(),
  criado_por             text,
  atualizado_em          timestamptz NOT NULL DEFAULT now(),
  atualizado_por         text
);
INSERT INTO contab_empresas (id, razao_social, criado_por) VALUES ('emp_principal', 'Empresa principal', 'migracao')
  ON CONFLICT (id) DO NOTHING;

-- ADD COLUMN com DEFAULT não reescreve as linhas (não dispara as travas de lançamento intangível).
ALTER TABLE contab_lancamentos ADD COLUMN IF NOT EXISTS empresa_id text NOT NULL DEFAULT 'emp_principal' REFERENCES contab_empresas (id);
CREATE INDEX IF NOT EXISTS contab_lanc_empresa_data_ix ON contab_lancamentos (empresa_id, data);
