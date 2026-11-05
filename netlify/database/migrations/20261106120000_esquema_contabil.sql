-- Painel de Gestão · Netlify Database (Postgres) · Módulo Contábil (v13.86)
--
-- Plano de contas ÚNICO (árvore sintética/analítica), lançamentos em partidas dobradas e livros auxiliares.
-- As regras de integridade ficam no próprio banco (além da API netlify/functions/contabil.mjs):
--   • partidas dobradas: soma dos débitos = soma dos créditos = total do lançamento (trigger de restrição adiada, no COMMIT);
--   • intangibilidade: lançamentos e partidas não podem ser alterados nem excluídos (UPDATE/DELETE/TRUNCATE bloqueados);
--     a correção é sempre por estorno, ligado ao ID da partida original (um único estorno por lançamento);
--   • partidas só em contas ANALÍTICAS e ATIVAS, e só no mesmo instante (transação) em que o lançamento nasce;
--   • período fechado: nenhum lançamento com data até a data de fechamento;
--   • trilha de integridade: cada lançamento guarda o hash SHA-256 do anterior (cadeia conferida em /api/contabil/integridade).
-- Valores em centavos (bigint): nada de ponto flutuante em dinheiro.

-- ---------------------------------------------------------------- plano de contas
CREATE TABLE contab_contas (
  codigo            text        PRIMARY KEY,
  nome              text        NOT NULL,
  grupo             smallint    NOT NULL CHECK (grupo BETWEEN 1 AND 5),   -- 1 Ativo · 2 Passivo · 3 PL · 4 Receitas · 5 Custos e Despesas
  natureza          char(1)     NOT NULL CHECK (natureza IN ('D', 'C')),  -- Devedora / Credora
  tipo              char(1)     NOT NULL CHECK (tipo IN ('S', 'A')),      -- Sintética / Analítica
  pai               text        REFERENCES contab_contas (codigo),
  nivel             smallint    NOT NULL CHECK (nivel BETWEEN 1 AND 8),
  redutora          boolean     NOT NULL DEFAULT false,                   -- retificadora: natureza oposta à do grupo (ex.: (-) Depreciação Acumulada)
  dre               text,                                                 -- linha da DRE (rb, ded, cmv, dv, dga, oro, odo, rf, df, ir)
  dva               text,                                                 -- linha da DVA (CPC 09)
  tributos          text[]      NOT NULL DEFAULT '{}',                    -- ICMS, PIS, COFINS, ISS, IPI, IBS, CBS, IS, IRPJ, CSLL…
  modelo_tributario text        NOT NULL DEFAULT 'nenhum' CHECK (modelo_tributario IN ('nenhum', 'atual', 'reforma', 'ambos')),
  ativa             boolean     NOT NULL DEFAULT true,
  ia                jsonb,                                                -- sugestão da classificação automática (confiança e motivos)
  criado_em         timestamptz NOT NULL DEFAULT now(),
  criado_por        text,
  atualizado_em     timestamptz,
  atualizado_por    text,
  CONSTRAINT contab_contas_codigo_ck CHECK (codigo ~ '^[1-5](\.[0-9]{1,4}){0,7}$'),
  CONSTRAINT contab_contas_nome_ck   CHECK (length(btrim(nome)) BETWEEN 2 AND 160),
  CONSTRAINT contab_contas_grupo_ck  CHECK (substr(codigo, 1, 1)::smallint = grupo),
  CONSTRAINT contab_contas_nivel_ck  CHECK (nivel = array_length(string_to_array(codigo, '.'), 1)),
  CONSTRAINT contab_contas_pai_ck    CHECK ((pai IS NULL AND nivel = 1) OR (pai IS NOT NULL AND codigo LIKE pai || '.%' AND nivel > 1))
);
CREATE INDEX contab_contas_pai_idx ON contab_contas (pai);
CREATE UNIQUE INDEX contab_contas_nome_irmaos_uk ON contab_contas (coalesce(pai, ''), lower(btrim(nome)));

-- a conta-mãe precisa ser sintética; uma sintética com filhas não vira analítica
CREATE FUNCTION contab_conta_ck() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.pai IS NOT NULL AND (SELECT tipo FROM contab_contas WHERE codigo = NEW.pai) IS DISTINCT FROM 'S' THEN
    RAISE EXCEPTION 'CONTAB: a conta-mãe % precisa ser sintética', NEW.pai USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.codigo <> OLD.codigo OR NEW.grupo <> OLD.grupo OR NEW.pai IS DISTINCT FROM OLD.pai THEN
      RAISE EXCEPTION 'CONTAB: código, grupo e conta-mãe não mudam (crie outra conta e inative esta)' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.tipo = 'A' AND OLD.tipo = 'S' AND EXISTS (SELECT 1 FROM contab_contas WHERE pai = NEW.codigo) THEN
      RAISE EXCEPTION 'CONTAB: a conta % tem contas filhas e não pode virar analítica', NEW.codigo USING ERRCODE = 'P0001';
    END IF;
    IF (NEW.tipo <> OLD.tipo OR NEW.natureza <> OLD.natureza) AND EXISTS (SELECT 1 FROM contab_partidas WHERE conta = NEW.codigo) THEN
      RAISE EXCEPTION 'CONTAB: a conta % já tem lançamentos — tipo e natureza não mudam', NEW.codigo USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------- lançamentos (partidas dobradas)
CREATE TABLE contab_lancamentos (
  id             text        PRIMARY KEY,
  numero         bigserial   UNIQUE,
  data           date        NOT NULL,
  historico      text        NOT NULL CHECK (length(btrim(historico)) BETWEEN 3 AND 500),
  origem         text        NOT NULL DEFAULT 'manual',   -- manual, estorno, encerramento, aumento_capital, dividendos, reserva, ajuste_avaliacao, integracao…
  doc_ref        text,
  estorno_de     text        UNIQUE REFERENCES contab_lancamentos (id),
  total_centavos bigint      NOT NULL CHECK (total_centavos > 0),
  hash_anterior  text,
  hash           text        NOT NULL UNIQUE,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  criado_por     text        NOT NULL,
  CONSTRAINT contab_lanc_estorno_ck CHECK (estorno_de IS NULL OR estorno_de <> id),
  CONSTRAINT contab_lanc_origem_ck  CHECK ((origem = 'estorno') = (estorno_de IS NOT NULL))
);
CREATE INDEX contab_lanc_data_idx ON contab_lancamentos (data, numero);

CREATE TABLE contab_partidas (
  lancamento_id  text     NOT NULL REFERENCES contab_lancamentos (id),
  seq            smallint NOT NULL CHECK (seq BETWEEN 1 AND 500),
  conta          text     NOT NULL REFERENCES contab_contas (codigo),
  dc             char(1)  NOT NULL CHECK (dc IN ('D', 'C')),
  valor_centavos bigint   NOT NULL CHECK (valor_centavos > 0),
  centro         text,
  historico      text,
  PRIMARY KEY (lancamento_id, seq)
);
CREATE INDEX contab_partidas_conta_idx ON contab_partidas (conta);

-- ---------------------------------------------------------------- parâmetros e LALUR
CREATE TABLE contab_parametros (
  chave          text        PRIMARY KEY,
  valor          jsonb       NOT NULL,
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  atualizado_por text
);
CREATE TABLE contab_lalur (
  id             bigserial   PRIMARY KEY,
  ano            smallint    NOT NULL CHECK (ano BETWEEN 2000 AND 2100),
  parte          char(1)     NOT NULL DEFAULT 'A' CHECK (parte IN ('A', 'B')),
  tipo           text        NOT NULL CHECK (tipo IN ('adicao', 'exclusao', 'compensacao')),
  base           text        NOT NULL DEFAULT 'ambos' CHECK (base IN ('irpj', 'csll', 'ambos')),
  descricao      text        NOT NULL CHECK (length(btrim(descricao)) BETWEEN 3 AND 300),
  valor_centavos bigint      NOT NULL CHECK (valor_centavos > 0),
  conta          text        REFERENCES contab_contas (codigo),
  criado_em      timestamptz NOT NULL DEFAULT now(),
  criado_por     text
);

-- ---------------------------------------------------------------- travas
CREATE TRIGGER contab_conta_ck BEFORE INSERT OR UPDATE ON contab_contas FOR EACH ROW EXECUTE FUNCTION contab_conta_ck();

-- intangibilidade: nada de alterar ou excluir lançamentos e partidas (só estorno)
CREATE FUNCTION contab_intangivel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CONTAB: lançamentos contábeis são intangíveis — não podem ser alterados nem excluídos; faça um estorno' USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER contab_lanc_intangivel BEFORE UPDATE OR DELETE ON contab_lancamentos FOR EACH ROW EXECUTE FUNCTION contab_intangivel();
CREATE TRIGGER contab_part_intangivel BEFORE UPDATE OR DELETE ON contab_partidas FOR EACH ROW EXECUTE FUNCTION contab_intangivel();
CREATE TRIGGER contab_lanc_sem_truncate BEFORE TRUNCATE ON contab_lancamentos FOR EACH STATEMENT EXECUTE FUNCTION contab_intangivel();
CREATE TRIGGER contab_part_sem_truncate BEFORE TRUNCATE ON contab_partidas FOR EACH STATEMENT EXECUTE FUNCTION contab_intangivel();

-- período fechado
CREATE FUNCTION contab_lanc_periodo_ck() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ate date;
BEGIN
  SELECT (valor ->> 'fechadoAte')::date INTO ate FROM contab_parametros WHERE chave = 'fechamento';
  IF ate IS NOT NULL AND NEW.data <= ate THEN
    RAISE EXCEPTION 'CONTAB: o período até % está fechado — lance em data posterior', to_char(ate, 'DD/MM/YYYY') USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contab_lanc_periodo BEFORE INSERT ON contab_lancamentos FOR EACH ROW EXECUTE FUNCTION contab_lanc_periodo_ck();

-- partida: conta analítica e ativa, e só na mesma transação em que o lançamento foi criado
CREATE FUNCTION contab_partida_ck() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t char(1); a boolean; x text;
BEGIN
  SELECT tipo, ativa INTO t, a FROM contab_contas WHERE codigo = NEW.conta;
  IF t IS DISTINCT FROM 'A' THEN RAISE EXCEPTION 'CONTAB: a conta % não é analítica (sintéticas não recebem lançamentos)', NEW.conta USING ERRCODE = 'P0001'; END IF;
  IF NOT a THEN RAISE EXCEPTION 'CONTAB: a conta % está inativa', NEW.conta USING ERRCODE = 'P0001'; END IF;
  SELECT l.xmin::text INTO x FROM contab_lancamentos l WHERE l.id = NEW.lancamento_id;
  IF x IS DISTINCT FROM (txid_current() % 4294967296)::text THEN
    RAISE EXCEPTION 'CONTAB: o lançamento % já foi gravado — não recebe novas partidas', NEW.lancamento_id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contab_partida_ck BEFORE INSERT ON contab_partidas FOR EACH ROW EXECUTE FUNCTION contab_partida_ck();

-- partidas dobradas: conferido no COMMIT (débitos = créditos = total, mínimo de 2 partidas, com débito e crédito)
CREATE FUNCTION contab_lanc_equilibrio_ck() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d bigint; c bigint; n integer;
BEGIN
  SELECT coalesce(sum(valor_centavos) FILTER (WHERE dc = 'D'), 0), coalesce(sum(valor_centavos) FILTER (WHERE dc = 'C'), 0), count(*)
    INTO d, c, n FROM contab_partidas WHERE lancamento_id = NEW.id;
  IF n < 2 OR d = 0 OR c = 0 THEN RAISE EXCEPTION 'CONTAB: o lançamento precisa de ao menos um débito e um crédito' USING ERRCODE = 'P0001'; END IF;
  IF d <> c THEN RAISE EXCEPTION 'CONTAB: partidas dobradas — débitos (%) diferentes dos créditos (%)', d, c USING ERRCODE = 'P0001'; END IF;
  IF d <> NEW.total_centavos THEN RAISE EXCEPTION 'CONTAB: o total do lançamento não confere com as partidas' USING ERRCODE = 'P0001'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER contab_lanc_equilibrio AFTER INSERT ON contab_lancamentos DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION contab_lanc_equilibrio_ck();

-- ---------------------------------------------------------------- consulta (BI)
CREATE VIEW contab_razao_v AS
  SELECT l.data, l.numero, l.id AS lancamento_id, l.historico, l.origem, l.estorno_de, p.seq, p.conta, c.nome AS conta_nome, c.grupo,
         p.dc, p.valor_centavos / 100.0 AS valor, CASE p.dc WHEN 'D' THEN p.valor_centavos ELSE -p.valor_centavos END / 100.0 AS valor_sinal
    FROM contab_partidas p JOIN contab_lancamentos l ON l.id = p.lancamento_id JOIN contab_contas c ON c.codigo = p.conta;
