-- v14.02 · Aprovação de pagamentos das Saídas do Dia (Tela Inicial › Resumo do Recebível do Dia). Só tabelas e índices "IF NOT EXISTS":
-- a migração é repetível (o Netlify a aplica na publicação; o build e o botão "Executar Migrações do Banco" também podem aplicá-la).
--
--   painel_saidas_lotes     uma linha por "Finalizar Aprovações": o dia das saídas, quem aprovou (id do usuário, nome e CPF), os totais
--                           (previsto, autorizado, retido), o selo de integridade SHA-256 e o andamento do aviso (notificado_em).
--                           idem = chave de idempotência enviada pelo painel (duplo clique ou nova tentativa não cria um segundo lote).
--   painel_saidas_decisoes  uma linha por título do lote: a decisão (APROVADO ou RETIDO), uma cópia dos dados do título no momento da
--                           decisão (fornecedor, conta, forma, vencimento, valor) e o aprovador com data/hora. titulo_id = id do título no FCX
--                           naquele momento; titulo_chave = SHA-256 do conteúdo do título (sobrevive a uma nova importação do FCX). Nada é apagado:
--                           uma nova aprovação do mesmo dia cria outro lote e a decisão mais recente de cada título é a que vale.
--
-- O CPF do aprovador é gravado inteiro (auditoria); o painel, o relatório e os avisos mostram só a máscara.

CREATE TABLE IF NOT EXISTS painel_saidas_lotes (
  id               bigserial     PRIMARY KEY,
  idem             text          UNIQUE CHECK (idem IS NULL OR idem ~ '^[A-Za-z0-9_-]{8,64}$'),
  dia              date          NOT NULL,
  criado_em        timestamptz   NOT NULL DEFAULT now(),
  aprovador_id     text          NOT NULL,
  aprovador_nome   text          NOT NULL,
  aprovador_cpf    text          NOT NULL,
  total_previsto   numeric(14,2) NOT NULL DEFAULT 0,
  total_autorizado numeric(14,2) NOT NULL DEFAULT 0,
  total_retido     numeric(14,2) NOT NULL DEFAULT 0,
  qtd_total        integer       NOT NULL DEFAULT 0,
  qtd_aprovados    integer       NOT NULL DEFAULT 0,
  qtd_retidos      integer       NOT NULL DEFAULT 0,
  selo             text          NOT NULL,
  ambiente         text,
  notificado_em    timestamptz,
  notificacao      text
);
CREATE INDEX IF NOT EXISTS painel_saidas_lotes_dia_ix ON painel_saidas_lotes (dia, id DESC);

CREATE TABLE IF NOT EXISTS painel_saidas_decisoes (
  id              bigserial     PRIMARY KEY,
  lote_id         bigint        NOT NULL REFERENCES painel_saidas_lotes (id) ON DELETE CASCADE,
  dia             date          NOT NULL,
  titulo_id       text          NOT NULL,
  titulo_chave    text,
  fornecedor      text,
  conta           text,
  centro          text,
  forma_pagamento text,
  descricao       text,
  vencimento      date,
  valor           numeric(14,2) NOT NULL,
  status          text          NOT NULL CHECK (status IN ('APROVADO', 'RETIDO')),
  aprovador_id    text          NOT NULL,
  aprovador_nome  text          NOT NULL,
  aprovador_cpf   text          NOT NULL,
  decidido_em     timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS painel_saidas_dec_lote_ix ON painel_saidas_decisoes (lote_id);
CREATE INDEX IF NOT EXISTS painel_saidas_dec_titulo_ix ON painel_saidas_decisoes (dia, titulo_chave, decidido_em DESC, id DESC);
