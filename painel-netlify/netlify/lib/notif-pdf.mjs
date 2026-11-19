/* v14.00 · Gerador de PDF A4 no servidor (sem dependências): texto, quadros de indicadores e tabelas com quebra de página.
   Usa as fontes padrão do PDF (Helvetica e Helvetica-Bold, codificação WinAnsi): acentos do português funcionam e nada é embutido.
   Serve aos anexos dos e-mails (relatório IEO da regional e relatório matinal executivo). Função pura: devolve um Buffer. */
import { deflateSync } from 'node:zlib';

/* Larguras (em milésimos do corpo da fonte) dos caracteres ASCII 32..126 — métricas oficiais da Helvetica e da Helvetica-Bold */
const WR = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const WB = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975,
  722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333,
  556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
const EXTRA = { '–': 556, '—': 1000, '•': 350, '“': 333, '”': 333, '‘': 278, '’': 278, '€': 556, '…': 1000, '·': 278, ' ': 278, 'º': 365, 'ª': 370, '°': 400, '×': 584, '÷': 584 };
const base = ch => { const c = ch.charCodeAt(0); if (c >= 32 && c <= 126) return ch; const d = ch.normalize('NFD')[0]; const k = d.charCodeAt(0); return k >= 32 && k <= 126 ? d : ''; };
const larguraChar = (ch, negrito) => { const b = base(ch); if (b) { const i = b.charCodeAt(0) - 32; return (negrito ? WB : WR)[i]; } return EXTRA[ch] ?? 556; };
/** Largura do texto em pontos. */
export const larguraTexto = (t, tam, negrito = false) => { let s = 0; for (const ch of String(t ?? '')) s += larguraChar(ch, negrito); return s * tam / 1000; };

const WIN = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F };
/** Texto → bytes WinAnsi dentro de um literal de string do PDF (com escape de parênteses e barra). */
function lit(t) {
  const out = [];
  for (const ch of String(t ?? '').replace(/[\r\n\t]+/g, ' ')) {
    const c = ch.charCodeAt(0); let b;
    if (c >= 32 && c <= 126) b = c; else if (c >= 160 && c <= 255) b = c; else if (WIN[ch] != null) b = WIN[ch]; else if (c === 0x202F || c === 0x2009) b = 32; else b = 63;
    if (b === 40 || b === 41 || b === 92) out.push(92);
    out.push(b);
  }
  return '(' + Buffer.from(out).toString('latin1') + ')';
}
const f2 = n => (Math.round(n * 100) / 100).toString();
const cor = c => (Array.isArray(c) ? c : [0, 0, 0]).map(f2).join(' ');
const hex = h => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255) : [0, 0, 0]; };

/** Quebra o texto em linhas que cabem em `larg` pontos (palavras longas são cortadas). */
export function quebrar(texto, larg, tam, negrito = false) {
  const linhas = [];
  for (const par of String(texto ?? '').split(/\r?\n/)) {
    let atual = '';
    for (const pal of par.split(/\s+/).filter(Boolean)) {
      const tenta = atual ? atual + ' ' + pal : pal;
      if (larguraTexto(tenta, tam, negrito) <= larg) { atual = tenta; continue; }
      if (atual) { linhas.push(atual); atual = ''; }
      if (larguraTexto(pal, tam, negrito) <= larg) { atual = pal; continue; }
      let pedaco = ''; for (const ch of pal) { if (larguraTexto(pedaco + ch, tam, negrito) > larg && pedaco) { linhas.push(pedaco); pedaco = ''; } pedaco += ch; } atual = pedaco;
    }
    linhas.push(atual);
  }
  return linhas.length ? linhas : [''];
}

const AZUL = [0.106, 0.137, 0.384], CINZA = [0.42, 0.45, 0.5], ZEBRA = [0.955, 0.961, 0.975], LINHA = [0.85, 0.87, 0.9];
const TOM = { ok: [0.07, 0.5, 0.3], bad: [0.75, 0.15, 0.15], warn: [0.72, 0.45, 0.0], info: [0.15, 0.35, 0.75], neutro: [0.1, 0.1, 0.1] };

/**
 * gerarPdf({ titulo, subtitulo, marca, emitidoEm, rodape, paisagem, blocos }) → Buffer
 * blocos: { t:'h', texto } · { t:'p', texto, negrito?, tom? } · { t:'kpis', itens:[{ rot, valor, tom? }] }
 *       · { t:'tabela', colunas:[{ rot, alinhar:'e'|'d'|'c', peso? }], linhas:[[texto|{ v, tom, negrito }]], total?:[…], vazio? } · { t:'espaco', h }
 */
export function gerarPdf({ titulo = 'Relatório', subtitulo = '', marca = 'Painel de Gestão', emitidoEm = '', rodape = '', paisagem = false, blocos = [] } = {}) {
  const PW = paisagem ? 841.89 : 595.28, PH = paisagem ? 595.28 : 841.89, M = 40, LARG = PW - 2 * M, TOPO = PH - M, FUNDO = M + 18;
  const paginas = []; let ops, y;
  const nova = (primeira = false) => {
    ops = []; paginas.push(ops); y = TOPO;
    if (primeira) {
      ops.push(`BT /F2 16 Tf ${cor(AZUL)} rg ${f2(M)} ${f2(y - 14)} Td ${lit(titulo)} Tj ET`); y -= 22;
      if (subtitulo) { for (const l of quebrar(subtitulo, LARG, 10)) { ops.push(`BT /F1 10 Tf ${cor(CINZA)} rg ${f2(M)} ${f2(y - 9)} Td ${lit(l)} Tj ET`); y -= 13; } }
      if (emitidoEm) { ops.push(`BT /F1 9 Tf ${cor(CINZA)} rg ${f2(M)} ${f2(y - 9)} Td ${lit(emitidoEm)} Tj ET`); y -= 13; }
      ops.push(`${cor(AZUL)} RG 1.2 w ${f2(M)} ${f2(y - 4)} m ${f2(PW - M)} ${f2(y - 4)} l S`); y -= 14;
    } else {
      ops.push(`BT /F2 9 Tf ${cor(CINZA)} rg ${f2(M)} ${f2(y - 8)} Td ${lit(titulo)} Tj ET`); ops.push(`${cor(LINHA)} RG 0.6 w ${f2(M)} ${f2(y - 12)} m ${f2(PW - M)} ${f2(y - 12)} l S`); y -= 22;
    }
  };
  const cabo = h => { if (y - h < FUNDO) nova(false); };
  nova(true);

  for (const b of blocos) {
    if (b.t === 'espaco') { y -= b.h ?? 8; continue; }
    if (b.t === 'h') { cabo(30); y -= 6; ops.push(`BT /F2 12 Tf ${cor(AZUL)} rg ${f2(M)} ${f2(y - 11)} Td ${lit(b.texto)} Tj ET`); y -= 18; continue; }
    if (b.t === 'p') {
      const tam = b.tam || 10, c = TOM[b.tom] || TOM.neutro;
      for (const l of quebrar(b.texto, LARG, tam, !!b.negrito)) { cabo(tam + 4); ops.push(`BT /${b.negrito ? 'F2' : 'F1'} ${tam} Tf ${cor(c)} rg ${f2(M)} ${f2(y - tam)} Td ${lit(l)} Tj ET`); y -= tam * 1.35; }
      y -= 3; continue;
    }
    if (b.t === 'kpis') {
      const itens = b.itens || [], n = Math.max(1, Math.min(itens.length, paisagem ? 5 : 4)), larg = LARG / n;
      for (let i = 0; i < itens.length; i += n) {
        const fatia = itens.slice(i, i + n); cabo(46);
        fatia.forEach((it, k) => {
          const x = M + k * larg; ops.push(`${cor(ZEBRA)} rg ${f2(x + 1)} ${f2(y - 40)} ${f2(larg - 4)} 40 re f`);
          ops.push(`BT /F1 8 Tf ${cor(CINZA)} rg ${f2(x + 7)} ${f2(y - 13)} Td ${lit(String(it.rot).toUpperCase().slice(0, Math.floor(larg / 4.4)))} Tj ET`);
          ops.push(`BT /F2 15 Tf ${cor(TOM[it.tom] || TOM.neutro)} rg ${f2(x + 7)} ${f2(y - 33)} Td ${lit(it.valor)} Tj ET`);
        }); y -= 46;
      }
      y -= 4; continue;
    }
    if (b.t === 'tabela') {
      const cols = b.colunas || [], tam = 8.5, pad = 4, lh = tam * 1.25, linhas = b.linhas || [];
      if (!linhas.length) { for (const l of quebrar(b.vazio || 'Nada a listar.', LARG, 9.5)) { cabo(14); ops.push(`BT /F1 9.5 Tf ${cor(CINZA)} rg ${f2(M)} ${f2(y - 10)} Td ${lit(l)} Tj ET`); y -= 13; } y -= 6; continue; }
      const todas = [...linhas, ...(b.total ? [b.total] : [])], txt = c => (c && typeof c === 'object' ? c.v : c) ?? '';
      const nat = cols.map((c, i) => Math.min(LARG, Math.max(larguraTexto(c.rot, tam, true), ...todas.map(l => larguraTexto(txt(l[i]), tam, !!(l[i] && l[i].negrito))), 18) + 2 * pad));
      const pesos = cols.map(c => c.peso || 0), temPeso = pesos.some(Boolean);
      let ws = temPeso ? pesos.map(p => (p || 1) / pesos.reduce((a, x) => a + (x || 1), 0) * LARG) : nat.slice();
      const soma = ws.reduce((a, x) => a + x, 0);
      if (!temPeso) { if (soma > LARG) { const minimo = cols.map(() => 34), sobra = soma - LARG, elasticos = ws.map((w, i) => Math.max(0, w - minimo[i])), te = elasticos.reduce((a, x) => a + x, 0) || 1; ws = ws.map((w, i) => w - sobra * elasticos[i] / te); } else { const extra = (LARG - soma) / cols.length; ws = ws.map(w => w + extra); } }
      const xs = ws.reduce((a, w, i) => (a.push(i ? a[i - 1] + ws[i - 1] : M), a), []);
      const desenhaLinha = (cels, { cab = false, zebra = false, tot = false } = {}) => {
        const quebras = cels.map((c, i) => quebrar(txt(c), ws[i] - 2 * pad, tam, cab || tot || !!(c && c.negrito))), n = Math.max(...quebras.map(q => q.length)), h = n * lh + 2 * pad - 2;
        if (y - h < FUNDO) { nova(false); if (!cab) cabecalho(); }
        const topo = y;
        if (cab) ops.push(`${cor(AZUL)} rg ${f2(M)} ${f2(topo - h)} ${f2(LARG)} ${f2(h)} re f`); else if (zebra) ops.push(`${cor(ZEBRA)} rg ${f2(M)} ${f2(topo - h)} ${f2(LARG)} ${f2(h)} re f`);
        if (tot) ops.push(`${cor(AZUL)} RG 0.8 w ${f2(M)} ${f2(topo)} m ${f2(M + LARG)} ${f2(topo)} l S`);
        quebras.forEach((q, i) => q.forEach((l, k) => {
          const c = cels[i], neg = cab || tot || !!(c && c.negrito), al = cols[i].alinhar || 'e', lw = larguraTexto(l, tam, neg);
          const x = al === 'd' ? xs[i] + ws[i] - pad - lw : al === 'c' ? xs[i] + (ws[i] - lw) / 2 : xs[i] + pad, col = cab ? [1, 1, 1] : TOM[c && c.tom] || TOM.neutro;
          ops.push(`BT /${neg ? 'F2' : 'F1'} ${tam} Tf ${cor(col)} rg ${f2(x)} ${f2(topo - pad - tam - k * lh + 1)} Td ${lit(l)} Tj ET`);
        }));
        if (!cab) ops.push(`${cor(LINHA)} RG 0.4 w ${f2(M)} ${f2(topo - h)} m ${f2(M + LARG)} ${f2(topo - h)} l S`);
        y -= h;
      };
      function cabecalho() { desenhaLinha(cols.map(c => c.rot), { cab: true }); }
      cabo(40); cabecalho();
      linhas.forEach((l, i) => desenhaLinha(l, { zebra: i % 2 === 1 }));
      if (b.total) desenhaLinha(b.total, { tot: true });
      y -= 8; continue;
    }
  }

  /* rodapé e numeração (só agora se sabe quantas páginas são) */
  const total = paginas.length;
  paginas.forEach((p, i) => {
    p.push(`${cor(LINHA)} RG 0.5 w ${f2(M)} ${f2(M + 8)} m ${f2(PW - M)} ${f2(M + 8)} l S`);
    p.push(`BT /F1 8 Tf ${cor(CINZA)} rg ${f2(M)} ${f2(M - 4)} Td ${lit([marca, rodape].filter(Boolean).join(' · '))} Tj ET`);
    const t = `Página ${i + 1} de ${total}`; p.push(`BT /F1 8 Tf ${cor(CINZA)} rg ${f2(PW - M - larguraTexto(t, 8))} ${f2(M - 4)} Td ${lit(t)} Tj ET`);
  });

  /* montagem do arquivo */
  const objs = []; const add = s => { objs.push(s); return objs.length; };
  const cat = add(null), pgs = add(null), f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'), f2o = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const idsPag = paginas.map(p => {
    const dados = deflateSync(Buffer.from(p.join('\n'), 'latin1')), cont = add({ stream: dados, dict: '/Filter /FlateDecode' });
    return add(`<< /Type /Page /Parent ${pgs} 0 R /MediaBox [0 0 ${f2(PW)} ${f2(PH)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2o} 0 R >> >> /Contents ${cont} 0 R >>`);
  });
  objs[cat - 1] = `<< /Type /Catalog /Pages ${pgs} 0 R >>`;
  objs[pgs - 1] = `<< /Type /Pages /Kids [${idsPag.map(i => i + ' 0 R').join(' ')}] /Count ${idsPag.length} >>`;
  const info = add(`<< /Title ${lit(titulo)} /Producer (Painel de Gestao) >>`);
  const partes = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')], offs = []; let pos = partes[0].length;
  objs.forEach((o, i) => {
    offs.push(pos);
    const corpo = typeof o === 'string' ? Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1')
      : Buffer.concat([Buffer.from(`${i + 1} 0 obj\n<< /Length ${o.stream.length} ${o.dict} >>\nstream\n`, 'latin1'), o.stream, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
    partes.push(corpo); pos += corpo.length;
  });
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`; offs.forEach(o => { xref += String(o).padStart(10, '0') + ' 00000 n \n'; });
  partes.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R /Info ${info} 0 R >>\nstartxref\n${pos}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(partes);
}
export { hex as corHex };
