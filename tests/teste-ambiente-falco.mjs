/* v13.90 · Falco Controladoria e Gestão (antiga RC Consultoria): o servidor reconhece 'falco' e 'rc' como o mesmo ambiente.
   Sem banco: só as regras de lib/ambiente.mjs e do build. Uso: node tests/teste-ambiente-falco.mjs */
import { normalizarAmbiente, ambienteAtual, urlDe, interPermitido, mapaPublico, ROTULO, COOKIE, ehFalco } from '../netlify/lib/ambiente.mjs';
import fs from 'node:fs';
delete process.env.PAINEL_AMBIENTE; /* o build de marca só roda com PAINEL_AMBIENTE=falco: aqui importa só as funções */
const { catalogoNeutro, NOME } = await import('../scripts/preparar-ambiente.mjs');
const OK = [], FAIL = []; const chk = (n, c, x = '') => { (c ? OK : FAIL).push(n); console.log((c ? 'ok   ' : 'FALHA ') + n + (x && !c ? ' → ' + x : '')); };
const com = (vars, f) => { const ant = {}; for (const k of Object.keys(vars)) { ant[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; } try { return f(); } finally { for (const k of Object.keys(ant)) { if (ant[k] == null) delete process.env[k]; else process.env[k] = ant[k]; } } };

chk("normalizarAmbiente: 'falco', 'FALCO', ' rc ' → 'rc'; prod/homolog iguais; desconhecido → ''",
  normalizarAmbiente('falco') === 'rc' && normalizarAmbiente('FALCO') === 'rc' && normalizarAmbiente(' rc ') === 'rc' && normalizarAmbiente('prod') === 'prod' && normalizarAmbiente('homolog') === 'homolog' && normalizarAmbiente('xyz') === '' && normalizarAmbiente(null) === '' && ehFalco('falco') && ehFalco('rc') && !ehFalco('prod'));
chk('PAINEL_AMBIENTE=falco e PAINEL_AMBIENTE=rc dão o mesmo site (id rc, cookie painel_sessao_rc — as sessões abertas continuam valendo)',
  com({ PAINEL_AMBIENTE: 'falco' }, () => ambienteAtual() === 'rc' && COOKIE() === 'painel_sessao_rc') && com({ PAINEL_AMBIENTE: 'rc' }, () => ambienteAtual() === 'rc' && COOKIE() === 'painel_sessao_rc') && com({ PAINEL_AMBIENTE: null }, () => ambienteAtual() === 'prod'));
chk('endereço do site: PAINEL_URL_FALCO; sem ela, a antiga PAINEL_URL_RC continua valendo',
  com({ PAINEL_URL_FALCO: 'https://falco.exemplo.app', PAINEL_URL_RC: 'https://antigo.exemplo.app' }, () => urlDe('rc') === 'https://falco.exemplo.app' && urlDe('falco') === 'https://falco.exemplo.app')
  && com({ PAINEL_URL_FALCO: null, PAINEL_URL_RC: 'https://antigo.exemplo.app/' }, () => urlDe('falco') === 'https://antigo.exemplo.app'));
chk("política entre ambientes igual para 'falco' e 'rc' (a Falco só lê config/recursos e o status; Produção gerencia a Falco)",
  interPermitido('falco', 'prod', 'get', 'config/recursos') && !interPermitido('falco', 'prod', 'get', 'lojas/x') && interPermitido('rc', 'prod', 'get', 'config/recursos') && !interPermitido('rc', 'prod', 'list', 'lojas')
  && interPermitido('prod', 'falco', 'set', 'lojas/x') && !interPermitido('falco', 'rc', 'get', 'config/recursos'));
const mp = com({ PAINEL_AMBIENTE: 'falco', PAINEL_URL_PROD: 'https://prod.exemplo.app', PAINEL_URL_HOMOLOG: null, PAINEL_MOSTRAR_AMBIENTES: null }, () => mapaPublico());
chk('tela de login: rótulo "Falco Controladoria e Gestão" (sem "RC")', ROTULO.rc === 'Falco Controladoria e Gestão' && mp.rc?.rotulo === 'Falco Controladoria e Gestão' && !JSON.stringify(mp).includes('RC'), JSON.stringify(mp));
const sql = fs.readFileSync(new URL('../netlify/database/migrations/20261027120000_esquema_inicial.sql', import.meta.url), 'utf8');
chk("banco: a coluna sessoes.ambiente continua aceitando 'rc' (registros existentes) e o servidor grava sempre o id normalizado", /CHECK \(ambiente IN \('prod', 'homolog', 'rc'\)\)/.test(sql)
  && /normalizarAmbiente\(ambiente\)/.test(fs.readFileSync(new URL('../netlify/lib/sessao.mjs', import.meta.url), 'utf8')));
chk('build: logomarca oficial da Falco em public/marca-falco/ (logo_falco.png + derivados) e nome oficial', NOME === 'Falco Controladoria e Gestão'
  && ['logo_falco.png', 'logo_falco_transparente.png', 'emblema_falco.png', 'emblema_falco_transparente.png', 'logo_branco.png', 'logo_navy.png', 'logo_fcx.png'].every(f => fs.existsSync(new URL('../public/marca-falco/' + f, import.meta.url))) && typeof catalogoNeutro === 'function');
console.log('\nOK (' + OK.length + ')  FALHAS (' + FAIL.length + ')'); process.exit(FAIL.length ? 1 : 0);
