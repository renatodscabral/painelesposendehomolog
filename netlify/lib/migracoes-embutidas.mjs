/* GERADO por scripts/run-migrations.mjs a partir de netlify/database/migrations/ — não edite (o build refaz este arquivo).
   Só as migrações aditivas (que podem rodar duas vezes sem dano) levam o SQL; as demais ficam só com o nome: são do deploy do Netlify. */
export const MIGRACOES = [
  {
    "nome": "20261027120000_esquema_inicial.sql",
    "sha256": "2673e15782c9316973091d862e197933a02a5a9bd2a433933637663d366daa2c",
    "aditiva": false,
    "motivo": "não é aditiva: CREATE TABLE documentos",
    "sql": null
  },
  {
    "nome": "20261027120100_semente_inicial.sql",
    "sha256": "5fcd685304174ddbdc51b2874b22f5db01dc94bff55729106ad485fac457318f",
    "aditiva": false,
    "motivo": "não é aditiva: INSERT INTO documentos",
    "sql": null
  },
  {
    "nome": "20261106120000_esquema_contabil.sql",
    "sha256": "09832d014f3cb4082be8ce72d7485fda65ba8be6c4ba4fa95f34d81e89e549b6",
    "aditiva": false,
    "motivo": "não é aditiva: CREATE TABLE contab_contas",
    "sql": null
  },
  {
    "nome": "20261106130000_esquema_contabil_depara.sql",
    "sha256": "cb92fb3ce77310eed7938e076756bf8b97b5827e98485769acff01a7a9054ccd",
    "aditiva": false,
    "motivo": "não é aditiva: CREATE OR REPLACE",
    "sql": null
  },
  {
    "nome": "20261107120000_esquema_adiantamentos.sql",
    "sha256": "eb772acffbe05230affccecd6d349b00bd94f9f26984311f3dbc5e64e5e86401",
    "aditiva": true,
    "motivo": null,
    "sql": "-- v13.88 · Acerto de adiantamentos de viagem no Módulo Contábil.\n-- Os lançamentos do acerto usam as tabelas da v13.86 (contab_lancamentos/contab_partidas, com todas as travas de partidas\n-- dobradas e intangibilidade). Cada viagem é identificada pelo documento do lançamento:\n--   ADT-<viagem>             adiantamento pago            (D Adiantamentos a Empregados / C Banco)\n--   ADT-<viagem>-ACERTO      liquidação do acerto final   (D Despesas de viagem [+ D Devolução a receber] / C Adiantamentos [+ C Reembolso a pagar])\n--   ADT-<viagem>-BAIXA-<id>  baixa do título              (devolução recebida ou reembolso pago)\n-- O índice abaixo deixa rápida a checagem de \"já contabilizado\" (encerrar/contabilizar/baixar são idempotentes).\nCREATE INDEX IF NOT EXISTS contab_lanc_doc_ref_ix ON contab_lancamentos (doc_ref) WHERE doc_ref IS NOT NULL;\n"
  },
  {
    "nome": "20261108120000_esquema_empresas.sql",
    "sha256": "42aa47983eef01905e10e861b51d541170f3c7901909378af9d040cb707022e2",
    "aditiva": false,
    "motivo": "não é aditiva: INSERT INTO contab_empresas",
    "sql": null
  },
  {
    "nome": "20261110120000_esquema_empresas_receita.sql",
    "sha256": "fb1598de1f9b89539b51e5c86ae92188f836ee6cb6235ab428246b6a891f4422",
    "aditiva": true,
    "motivo": null,
    "sql": "-- v13.94 · Cadastro de empresas: dados da consulta automática de CNPJ (Receita Federal).\n-- { cep, logradouro, numero, complemento, bairro, cidade, uf, situacao, consultadoEm, fonte } — o \"endereco\" em texto\n-- continua existindo (linha completa para relatórios); aqui ficam os campos separados e a situação cadastral.\n-- ADD COLUMN com DEFAULT não reescreve as linhas existentes (não dispara as travas dos lançamentos).\nALTER TABLE contab_empresas ADD COLUMN IF NOT EXISTS receita jsonb NOT NULL DEFAULT '{}'::jsonb;\n"
  },
  {
    "nome": "20261111120000_esquema_backups_nuvem.sql",
    "sha256": "421b8acbbe34875a11d62def1274a28fb3064669edf55b4e9526c34478a6c7c6",
    "aditiva": true,
    "motivo": null,
    "sql": "-- v13.95 · Pontos de Restauração na Nuvem (Cloud Snapshots & Versioning).\n-- Cada linha é uma fotografia completa dos documentos do painel deste ambiente (cada ambiente é um site com o seu banco):\n--   tipo_backup  AUTOMATICO       rotina diária às 23:59 (horário de Brasília) ou o ponto preventivo que a restauração faz antes de sobrescrever\n--                PRIMEIRO_ACESSO  gerado em segundo plano no primeiro acesso do dia, de qualquer perfil\n--                MANUAL           botão \"Criar Ponto de Restauração Agora\"\n--   payload_json  { formato, ambiente, geradoEm, versaoPainel, colecoes: {coleção: n}, documentos: [{ caminho, colecao, doc_id, dados, … }] }\n--                 (sem auditoria, presença e marcadores do sistema; os arquivos anexos e o livro contábil ficam fora de propósito)\n--   sha256        impressão do payload: a restauração confere antes de aplicar\n--   preventivo    true no ponto que a restauração cria sozinha antes de sobrescrever os dados\n-- Só tabelas e índices \"IF NOT EXISTS\": a migração é repetível (o Netlify a aplica na publicação e o build também pode aplicá-la).\n\nCREATE TABLE IF NOT EXISTS painel_backups_historico (\n  id              bigserial   PRIMARY KEY,\n  data_hora       timestamptz NOT NULL DEFAULT now(),\n  usuario_cpf     text        CHECK (usuario_cpf IS NULL OR usuario_cpf ~ '^[0-9]{11}$'),     -- quem criou (vazio = rotina agendada)\n  usuario_nome    text,\n  tipo_backup     text        NOT NULL CHECK (tipo_backup IN ('AUTOMATICO', 'MANUAL', 'PRIMEIRO_ACESSO')),\n  payload_json    jsonb       NOT NULL CHECK (jsonb_typeof(payload_json) = 'object'),\n  total_registros integer     NOT NULL CHECK (total_registros >= 0),\n  versao_painel   text        NOT NULL,\n  tamanho_bytes   integer     NOT NULL DEFAULT 0 CHECK (tamanho_bytes >= 0),\n  sha256          text,\n  preventivo      boolean     NOT NULL DEFAULT false,\n  nota            text\n);\nCREATE INDEX IF NOT EXISTS painel_backups_hist_data_ix ON painel_backups_historico (data_hora DESC, id DESC);\n"
  }
];
