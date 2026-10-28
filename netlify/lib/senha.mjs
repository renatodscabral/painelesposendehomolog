/* Mesmo algoritmo do painel (Senha.gerar): sal + SHA-256 em várias rodadas. Conferido no servidor, nunca no navegador. */
import { createHash, timingSafeEqual } from 'node:crypto';

const sha = s => createHash('sha256').update(s, 'utf8').digest('hex');

export function gerar(senha, sal, rodadas = 3000) {
  let h = sha(sal + ':' + senha);
  for (let i = 0; i < rodadas; i++) h = sha(h + sal);
  return { alg: 'sha256x' + rodadas, sal, hash: h };
}
export function confere(senha, reg) {
  if (!reg || !reg.sal || !reg.hash) return false;
  const rod = Number(String(reg.alg || '').match(/^sha256x(\d+)$/)?.[1] || 3000);
  if (!(rod > 0 && rod <= 100000)) return false;
  const a = Buffer.from(gerar(String(senha), reg.sal, rod).hash), b = Buffer.from(String(reg.hash));
  return a.length === b.length && timingSafeEqual(a, b);
}
export const soDigitos = v => String(v ?? '').replace(/\D/g, '');
