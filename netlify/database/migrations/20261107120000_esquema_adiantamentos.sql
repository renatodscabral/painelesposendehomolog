-- v13.88 · Acerto de adiantamentos de viagem no Módulo Contábil.
-- Os lançamentos do acerto usam as tabelas da v13.86 (contab_lancamentos/contab_partidas, com todas as travas de partidas
-- dobradas e intangibilidade). Cada viagem é identificada pelo documento do lançamento:
--   ADT-<viagem>             adiantamento pago            (D Adiantamentos a Empregados / C Banco)
--   ADT-<viagem>-ACERTO      liquidação do acerto final   (D Despesas de viagem [+ D Devolução a receber] / C Adiantamentos [+ C Reembolso a pagar])
--   ADT-<viagem>-BAIXA-<id>  baixa do título              (devolução recebida ou reembolso pago)
-- O índice abaixo deixa rápida a checagem de "já contabilizado" (encerrar/contabilizar/baixar são idempotentes).
CREATE INDEX IF NOT EXISTS contab_lanc_doc_ref_ix ON contab_lancamentos (doc_ref) WHERE doc_ref IS NOT NULL;
