-- Carga inicial do Painel (semente 2026-10-27a) · gerada por scripts/gerar-semente-sql.mjs em 2026-10-27T18:21:16.930Z
-- 6 documento(s). Não sobrescreve nada que já exista (ON CONFLICT DO NOTHING).
INSERT INTO documentos (caminho, colecao, doc_id, dados, atualizado_por) VALUES
('lojas/loja-901', 'lojas', 'loja-901', $semente${"codigo":"901","nome":"LOJA FICTICIA A","cnpj":"00.000.000/0001-91","cidade":"Recife","uf":"PE","ativa":true,"tipo":"RUA","adquirentes":[{"adquirente":"GETNET","ec":"9901","qtdePos":2}]}$semente$::jsonb, 'semente'),
('lojas/loja-902', 'lojas', 'loja-902', $semente${"codigo":"902","nome":"LOJA FICTICIA B","cnpj":"00.000.000/0002-72","cidade":"Olinda","uf":"PE","ativa":true,"tipo":"SHOPPING","adquirentes":[]}$semente$::jsonb, 'semente'),
('config/empresas', 'config', 'empresas', $semente${"lista":[{"id":"emp-ficticia","nome":"Empresa Ficticia","razao":"Empresa Ficticia LTDA","cnpj":"00000000000191"}]}$semente$::jsonb, 'semente'),
('config/recursos', 'config', 'recursos', $semente${"_versao":"v13.74.3","conc_det_v1373":{"ativo":true,"versao":"v13.73"}}$semente$::jsonb, 'semente'),
('usuarios/usr-semente-qa', 'usuarios', 'usr-semente-qa', $semente${"perfil":"MASTER","nome":"QA Master Semente","cpf":"52998224725","permissoes":{},"ativo":true,"senha":{"alg":"sha256x3000","sal":"a9f723a6ebab2f973a67e1c435a2eeec","hash":"951d278442343005d1d6f2c3250ad287478e6decdd27fc17b3c64d8d9e6c7301"},"trocarSenha":true,"origem":"semente","criadoEm":"2026-10-27T18:21:16.930Z"}$semente$::jsonb, 'semente'),
('sistema/status', 'sistema', 'status', $semente${"configurado":true,"desde":"2026-10-27T18:21:16.930Z"}$semente$::jsonb, 'semente')
ON CONFLICT (caminho) DO NOTHING;
