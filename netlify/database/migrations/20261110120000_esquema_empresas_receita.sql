-- v13.94 · Cadastro de empresas: dados da consulta automática de CNPJ (Receita Federal).
-- { cep, logradouro, numero, complemento, bairro, cidade, uf, situacao, consultadoEm, fonte } — o "endereco" em texto
-- continua existindo (linha completa para relatórios); aqui ficam os campos separados e a situação cadastral.
-- ADD COLUMN com DEFAULT não reescreve as linhas existentes (não dispara as travas dos lançamentos).
ALTER TABLE contab_empresas ADD COLUMN IF NOT EXISTS receita jsonb NOT NULL DEFAULT '{}'::jsonb;
