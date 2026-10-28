/* Servidor de teste que imita o Netlify: arquivos de public/ + as Netlify Functions nas rotas de config.path.
   Uso (com um Postgres local):  NETLIFY_DB_URL=postgres://... node tests/servidor-local.mjs 8890
   Em produção quem faz isso é o próprio Netlify (ou "netlify dev" localmente). */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), porta = Number(process.argv[2] || 8890), pub = process.env.PAINEL_PUBLIC || path.join(raiz, 'public');
const funcoes = [];
for (const f of fs.readdirSync(path.join(raiz, 'netlify/functions')).filter(f => f.endsWith('.mjs'))) {
  const m = await import(pathToFileURL(path.join(raiz, 'netlify/functions', f)).href);
  for (const p of [].concat(m.config.path)) funcoes.push({ re: new RegExp('^' + p.replace(/[.]/g, '\\.').replace(/\*/g, '.*') + '$'), fn: m.default });
}
const TIPOS = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.js': 'text/javascript', '.json': 'application/json' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${porta}`), f = funcoes.find(x => x.re.test(url.pathname));
  if (f) {
    const corpo = ['GET', 'HEAD'].includes(req.method) ? undefined : await new Promise(ok => { const b = []; req.on('data', c => b.push(c)); req.on('end', () => ok(Buffer.concat(b))); });
    const r = await f.fn(new Request(url, { method: req.method, headers: req.headers, body: corpo, duplex: 'half' }), { ip: req.socket.remoteAddress });
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  let arq = path.join(pub, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!arq.startsWith(pub) || !fs.existsSync(arq)) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'content-type': TIPOS[path.extname(arq)] || 'application/octet-stream' }); fs.createReadStream(arq).pipe(res);
}).listen(porta, () => console.log('painel local em http://localhost:' + porta));
