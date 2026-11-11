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
  },
  {
    "nome": "20261112120000_esquema_notificacoes.sql",
    "sha256": "3b4a49aca790994365b39ccfedee674d87ffdca52f92ba76a1747ef911073716",
    "aditiva": true,
    "motivo": null,
    "sql": "-- v14.00 · Central de Notificações (e-mail e WhatsApp). Só tabelas e índices \"IF NOT EXISTS\": a migração é repetível\n-- (o Netlify a aplica na publicação e o build / o botão \"Executar Migrações do Banco\" também podem aplicá-la).\n--\n--   painel_notificacoes_regras   uma linha por evento (chave fixa do catálogo): canal, ligado/desligado, destinatários fixos,\n--                                parâmetros (horário, dia da semana, prazos, tolerância…), frequência e o último envio.\n--                                As linhas são criadas pelo código na primeira abertura da Central, sempre DESLIGADAS: nada é\n--                                enviado antes de o Master ligar o evento e cadastrar os destinatários.\n--   painel_notificacoes_log      um registro por mensagem e por destinatário (e-mail ou WhatsApp), com o conteúdo enviado\n--                                (para \"Reenviar\") e, em caso de erro, o motivo em linguagem simples. Chaves de API e tokens\n--                                nunca entram no log. referencia = chave de idempotência do fato (viagem, semana, dia…).\n--   painel_notificacoes_instantaneo  números que só o painel sabe calcular (Resumo do Recebível: entradas por adquirente e\n--                                saldo de caixa), publicados pelo painel para o relatório matinal executivo.\n\nCREATE TABLE IF NOT EXISTS painel_notificacoes_regras (\n  id                 bigserial   PRIMARY KEY,\n  evento_chave       text        NOT NULL UNIQUE CHECK (evento_chave ~ '^[a-z0-9_]{3,60}$'),\n  canal              text        NOT NULL DEFAULT 'EMAIL' CHECK (canal IN ('EMAIL', 'WHATSAPP', 'AMBOS')),\n  ativo              boolean     NOT NULL DEFAULT false,\n  destinatarios_json jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(destinatarios_json) = 'array'),\n  parametros_json    jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(parametros_json) = 'object'),\n  frequencia         text        NOT NULL DEFAULT 'DIARIA' CHECK (frequencia IN ('IMEDIATA', 'DIARIA', 'SEMANAL')),\n  ultimo_envio       timestamptz,\n  ultima_rodada_em   timestamptz,                              -- última vez que a rotina agendada avaliou o evento (mesmo sem nada a enviar)\n  ultima_rodada_resumo text,\n  atualizado_em      timestamptz NOT NULL DEFAULT now(),\n  atualizado_por     text\n);\n\nCREATE TABLE IF NOT EXISTS painel_notificacoes_log (\n  id               bigserial   PRIMARY KEY,\n  data_hora        timestamptz NOT NULL DEFAULT now(),\n  canal            text        NOT NULL CHECK (canal IN ('EMAIL', 'WHATSAPP')),\n  evento_chave     text        NOT NULL,\n  destinatario     text        NOT NULL,\n  titulo           text        NOT NULL,\n  payload_mensagem jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload_mensagem) = 'object'),\n  status           text        NOT NULL CHECK (status IN ('SUCESSO', 'ERRO')),\n  detalhe_erro     text,\n  referencia       text,\n  reenvio_de       bigint,\n  teste            boolean     NOT NULL DEFAULT false,\n  tentativa        integer     NOT NULL DEFAULT 1 CHECK (tentativa >= 1),\n  id_externo       text\n);\nCREATE INDEX IF NOT EXISTS painel_notif_log_data_ix ON painel_notificacoes_log (data_hora DESC, id DESC);\nCREATE INDEX IF NOT EXISTS painel_notif_log_ref_ix ON painel_notificacoes_log (evento_chave, referencia) WHERE referencia IS NOT NULL;\n\nCREATE TABLE IF NOT EXISTS painel_notificacoes_instantaneo (\n  chave      text        PRIMARY KEY CHECK (chave ~ '^[a-z0-9_:.-]{3,80}$'),\n  dados      jsonb       NOT NULL CHECK (jsonb_typeof(dados) = 'object'),\n  gerado_em  timestamptz NOT NULL DEFAULT now(),\n  gerado_por text\n);\n"
  }
];
