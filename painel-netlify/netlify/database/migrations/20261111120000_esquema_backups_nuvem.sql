-- v13.95 · Pontos de Restauração na Nuvem (Cloud Snapshots & Versioning).
-- Cada linha é uma fotografia completa dos documentos do painel deste ambiente (cada ambiente é um site com o seu banco):
--   tipo_backup  AUTOMATICO       rotina diária às 23:59 (horário de Brasília) ou o ponto preventivo que a restauração faz antes de sobrescrever
--                PRIMEIRO_ACESSO  gerado em segundo plano no primeiro acesso do dia, de qualquer perfil
--                MANUAL           botão "Criar Ponto de Restauração Agora"
--   payload_json  { formato, ambiente, geradoEm, versaoPainel, colecoes: {coleção: n}, documentos: [{ caminho, colecao, doc_id, dados, … }] }
--                 (sem auditoria, presença e marcadores do sistema; os arquivos anexos e o livro contábil ficam fora de propósito)
--   sha256        impressão do payload: a restauração confere antes de aplicar
--   preventivo    true no ponto que a restauração cria sozinha antes de sobrescrever os dados
-- Só tabelas e índices "IF NOT EXISTS": a migração é repetível (o Netlify a aplica na publicação e o build também pode aplicá-la).

CREATE TABLE IF NOT EXISTS painel_backups_historico (
  id              bigserial   PRIMARY KEY,
  data_hora       timestamptz NOT NULL DEFAULT now(),
  usuario_cpf     text        CHECK (usuario_cpf IS NULL OR usuario_cpf ~ '^[0-9]{11}$'),     -- quem criou (vazio = rotina agendada)
  usuario_nome    text,
  tipo_backup     text        NOT NULL CHECK (tipo_backup IN ('AUTOMATICO', 'MANUAL', 'PRIMEIRO_ACESSO')),
  payload_json    jsonb       NOT NULL CHECK (jsonb_typeof(payload_json) = 'object'),
  total_registros integer     NOT NULL CHECK (total_registros >= 0),
  versao_painel   text        NOT NULL,
  tamanho_bytes   integer     NOT NULL DEFAULT 0 CHECK (tamanho_bytes >= 0),
  sha256          text,
  preventivo      boolean     NOT NULL DEFAULT false,
  nota            text
);
CREATE INDEX IF NOT EXISTS painel_backups_hist_data_ix ON painel_backups_historico (data_hora DESC, id DESC);
