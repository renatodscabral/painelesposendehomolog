-- v14.00 · Central de Notificações (e-mail e WhatsApp). Só tabelas e índices "IF NOT EXISTS": a migração é repetível
-- (o Netlify a aplica na publicação e o build / o botão "Executar Migrações do Banco" também podem aplicá-la).
--
--   painel_notificacoes_regras   uma linha por evento (chave fixa do catálogo): canal, ligado/desligado, destinatários fixos,
--                                parâmetros (horário, dia da semana, prazos, tolerância…), frequência e o último envio.
--                                As linhas são criadas pelo código na primeira abertura da Central, sempre DESLIGADAS: nada é
--                                enviado antes de o Master ligar o evento e cadastrar os destinatários.
--   painel_notificacoes_log      um registro por mensagem e por destinatário (e-mail ou WhatsApp), com o conteúdo enviado
--                                (para "Reenviar") e, em caso de erro, o motivo em linguagem simples. Chaves de API e tokens
--                                nunca entram no log. referencia = chave de idempotência do fato (viagem, semana, dia…).
--   painel_notificacoes_instantaneo  números que só o painel sabe calcular (Resumo do Recebível: entradas por adquirente e
--                                saldo de caixa), publicados pelo painel para o relatório matinal executivo.

CREATE TABLE IF NOT EXISTS painel_notificacoes_regras (
  id                 bigserial   PRIMARY KEY,
  evento_chave       text        NOT NULL UNIQUE CHECK (evento_chave ~ '^[a-z0-9_]{3,60}$'),
  canal              text        NOT NULL DEFAULT 'EMAIL' CHECK (canal IN ('EMAIL', 'WHATSAPP', 'AMBOS')),
  ativo              boolean     NOT NULL DEFAULT false,
  destinatarios_json jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(destinatarios_json) = 'array'),
  parametros_json    jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(parametros_json) = 'object'),
  frequencia         text        NOT NULL DEFAULT 'DIARIA' CHECK (frequencia IN ('IMEDIATA', 'DIARIA', 'SEMANAL')),
  ultimo_envio       timestamptz,
  ultima_rodada_em   timestamptz,                              -- última vez que a rotina agendada avaliou o evento (mesmo sem nada a enviar)
  ultima_rodada_resumo text,
  atualizado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_por     text
);

CREATE TABLE IF NOT EXISTS painel_notificacoes_log (
  id               bigserial   PRIMARY KEY,
  data_hora        timestamptz NOT NULL DEFAULT now(),
  canal            text        NOT NULL CHECK (canal IN ('EMAIL', 'WHATSAPP')),
  evento_chave     text        NOT NULL,
  destinatario     text        NOT NULL,
  titulo           text        NOT NULL,
  payload_mensagem jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload_mensagem) = 'object'),
  status           text        NOT NULL CHECK (status IN ('SUCESSO', 'ERRO')),
  detalhe_erro     text,
  referencia       text,
  reenvio_de       bigint,
  teste            boolean     NOT NULL DEFAULT false,
  tentativa        integer     NOT NULL DEFAULT 1 CHECK (tentativa >= 1),
  id_externo       text
);
CREATE INDEX IF NOT EXISTS painel_notif_log_data_ix ON painel_notificacoes_log (data_hora DESC, id DESC);
CREATE INDEX IF NOT EXISTS painel_notif_log_ref_ix ON painel_notificacoes_log (evento_chave, referencia) WHERE referencia IS NOT NULL;

CREATE TABLE IF NOT EXISTS painel_notificacoes_instantaneo (
  chave      text        PRIMARY KEY CHECK (chave ~ '^[a-z0-9_:.-]{3,80}$'),
  dados      jsonb       NOT NULL CHECK (jsonb_typeof(dados) = 'object'),
  gerado_em  timestamptz NOT NULL DEFAULT now(),
  gerado_por text
);
