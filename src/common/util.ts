import { randomInt } from 'node:crypto';

/** Prices travel as pesos in the API (like the front-end) and are stored as centavos. */
export const toCentavos = (pesos: number | null | undefined) => (pesos == null ? null : Math.round(pesos * 100));
export const toPesos = (centavos: number | null | undefined) => (centavos == null ? null : centavos / 100);

/** YYYY-MM-DD for date-only columns. */
export const isoDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
export const parseDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
export const addMonths = (d: Date, months: number) => {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + months);
  return r;
};
export const todayUtc = () => parseDate(new Date().toISOString().slice(0, 10));

export const normalizeEmail = (e: string) => e.trim().toLowerCase();
export const digits = (s: string) => s.replace(/\D/g, '');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I
export const randomCode = (len: number, alphabet = ALPHABET) => Array.from({ length: len }, () => alphabet[randomInt(alphabet.length)]).join('');
