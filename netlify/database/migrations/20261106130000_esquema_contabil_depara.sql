-- v13.86 · Parte 2 — De-para FCX → Plano de Contas do Módulo Contábil.
-- O FCX deixa de cadastrar contas: lê a lista daqui (somente leitura). Cada rótulo do FCX ("4.10.09 – (-) Energia Elétrica")
-- aponta para uma conta do plano único (analítica; os agrupadores do ERP apontam para a sintética correspondente).
-- status: automatico (mapeado pela regra/IA com boa confiança) · revisado (conferido por alguém) · pendente (precisa de revisão).
-- fonte:  fcx (veio do cadastro antigo do FCX ou de uma importação de planilha) · contabil (criado no Módulo Contábil para o FCX,
--         ex.: as contas novas da Reforma Tributária — IBS, CBS e Imposto Seletivo).

CREATE TABLE IF NOT EXISTS contab_depara (
  origem        text NOT NULL DEFAULT 'fcx' CHECK (origem IN ('fcx')),
  chave         text NOT NULL CHECK (length(chave) BETWEEN 1 AND 200),
  erp_codigo    text,
  erp_nome      text,
  agrupador     boolean NOT NULL DEFAULT false,
  conta         text REFERENCES contab_contas (codigo),
  status        text NOT NULL DEFAULT 'pendente' CHECK (status IN ('automatico', 'revisado', 'pendente')),
  confianca     numeric(4, 2),
  motivo        text,
  fonte         text NOT NULL DEFAULT 'fcx' CHECK (fonte IN ('fcx', 'contabil')),
  ativa         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  criado_por    text,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por text,
  PRIMARY KEY (origem, chave),
  CHECK (status <> 'revisado' OR conta IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS contab_depara_conta_ix ON contab_depara (conta);

-- Coerência com o plano: rótulo de movimento → conta ANALÍTICA; agrupador do ERP → conta SINTÉTICA.
CREATE OR REPLACE FUNCTION contab_depara_ck() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t text;
BEGIN
  IF NEW.conta IS NULL THEN RETURN NEW; END IF;
  SELECT tipo INTO t FROM contab_contas WHERE codigo = NEW.conta;
  IF NEW.agrupador AND t <> 'S' THEN RAISE EXCEPTION 'CONTAB: o agrupador "%" deve apontar para uma conta sintética (% é analítica).', NEW.chave, NEW.conta; END IF;
  IF NOT NEW.agrupador AND t <> 'A' THEN RAISE EXCEPTION 'CONTAB: a conta do FCX "%" deve apontar para uma conta analítica (% é sintética).', NEW.chave, NEW.conta; END IF;
  NEW.atualizado_em := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS contab_depara_ck ON contab_depara;
CREATE TRIGGER contab_depara_ck BEFORE INSERT OR UPDATE ON contab_depara FOR EACH ROW EXECUTE FUNCTION contab_depara_ck();
