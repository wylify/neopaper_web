// Code 128 encoder (code sets B and C), for the card's reader-app barcode.

const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104, START_C = 105, CODE_B = 100, CODE_C = 99, STOP = 106;

/** Code 128 only carries printable ASCII; anything else becomes '?'. */
export const sanitizeBarcode = (text) =>
  [...String(text)].map((c) => (c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126 && c.length === 1 ? c : '?')).join('') || ' ';

const digitRun = (s, i) => { let n = 0; while (i + n < s.length && s[i + n] >= '0' && s[i + n] <= '9') n++; return n; };

/** Symbol values (start, data, checksum, stop). Runs of 4+ digits (or 2+ at either end) use code C. */
export function code128Values(text) {
  const s = sanitizeBarcode(text);
  const vals = [];
  let set = null, i = 0;
  while (i < s.length) {
    const run = digitRun(s, i);
    const useC = run >= 4 || (run >= 2 && run === s.length - i && set === 'C') || (i === 0 && run === s.length && run >= 2);
    if (useC) {
      const pairs = Math.floor(run / 2);
      if (set !== 'C') { vals.push(set == null ? START_C : CODE_C); set = 'C'; }
      for (let k = 0; k < pairs; k++) { vals.push(parseInt(s.substr(i, 2), 10)); i += 2; }
      continue;
    }
    if (set !== 'B') { vals.push(set == null ? START_B : CODE_B); set = 'B'; }
    vals.push(s.charCodeAt(i) - 32); i++;
  }
  let sum = vals[0];
  for (let k = 1; k < vals.length; k++) sum += vals[k] * k;
  vals.push(sum % 103, STOP);
  return vals;
}

/** Bar widths in modules, alternating bar/space, starting with a bar. Total = module count. */
export function code128Widths(text) {
  const out = [];
  for (const v of code128Values(text)) for (const ch of PATTERNS[v]) out.push(+ch);
  return out;
}
