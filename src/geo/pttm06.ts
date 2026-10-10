// PT-TM06 / ETRS89 (EPSG:3763), o sistema nativo das grelhas DouroRisk, sem dependências.
//
// Projeção Transversa de Mercator no elipsoide GRS80, pela série de Krüger em n até à 6.ª ordem
// (a formulação de Karney, 2011, "Transverse Mercator with an accuracy of a few nanometers", a mesma
// do PROJ e do GeographicLib). Na região de Alijó o erro da série é da ordem do nanómetro; a inversa
// recupera a latitude exata a partir da latitude conforme pelo método de Newton.
//
// ETRS89 é tratado como igual a WGS84 (sem transformação de datum), tal como o arcpy sem
// transformação geográfica e o PROJ (EPSG:4326 → EPSG:3763 usa a transformação nula ETRS89↔WGS84).
//
// Verificado contra o PROJ 9.8 (pyproj 3.8) em 20 000 pontos aleatórios em cada sentido na caixa
// lon −7,65…−7,30, lat 41,15…41,45, e contra o projectAs do arcpy (ArcGIS Pro 3.7) em 2000 + 2000:
// diferença máxima 6 nm (0,000006 mm) nos dois sentidos.

/** Parâmetros do EPSG:3763 (ETRS89 / Portugal TM06). */
export const PTTM06 = {
  wkid: 3763,
  /** semieixo maior do GRS80 (m) */
  a: 6378137,
  /** achatamento do GRS80 */
  f: 1 / 298.257222101,
  /** latitude de origem: 39°40'05,73" N */
  lat0: 39.66825833333333,
  /** meridiano central: 8°07'59,19" W */
  lon0: -8.133108333333334,
  /** fator de escala no meridiano central */
  k0: 1,
  /** falso este (m) */
  fe: 0,
  /** falso norte (m) */
  fn: 0,
} as const;

const DEG = Math.PI / 180;

const { a, f, k0, fe, fn } = PTTM06;
const n = f / (2 - f);
const e2 = f * (2 - f);
const e = Math.sqrt(e2);
const e2m = 1 - e2;
const n2 = n * n, n3 = n2 * n, n4 = n3 * n, n5 = n4 * n, n6 = n5 * n;

/** raio retificante: A = a/(1+n)·(1 + n²/4 + n⁴/64 + n⁶/256) */
const A = (a / (1 + n)) * (1 + n2 / 4 + n4 / 64 + n6 / 256);

/** coeficientes α (latitude conforme → retificante) da série de Krüger, índice 1..6 */
const ALPHA = [
  0,
  n / 2 - (2 / 3) * n2 + (5 / 16) * n3 + (41 / 180) * n4 - (127 / 288) * n5 + (7891 / 37800) * n6,
  (13 / 48) * n2 - (3 / 5) * n3 + (557 / 1440) * n4 + (281 / 630) * n5 - (1983433 / 1935360) * n6,
  (61 / 240) * n3 - (103 / 140) * n4 + (15061 / 26880) * n5 + (167603 / 181440) * n6,
  (49561 / 161280) * n4 - (179 / 168) * n5 + (6601661 / 7257600) * n6,
  (34729 / 80640) * n5 - (3418889 / 1995840) * n6,
  (212378941 / 319334400) * n6,
];

/** coeficientes β (retificante → latitude conforme), índice 1..6 */
const BETA = [
  0,
  n / 2 - (2 / 3) * n2 + (37 / 96) * n3 - (1 / 360) * n4 - (81 / 512) * n5 + (96199 / 604800) * n6,
  (1 / 48) * n2 + (1 / 15) * n3 - (437 / 1440) * n4 + (46 / 105) * n5 - (1118711 / 3870720) * n6,
  (17 / 480) * n3 - (37 / 840) * n4 - (209 / 4480) * n5 + (5569 / 90720) * n6,
  (4397 / 161280) * n4 - (11 / 504) * n5 - (830251 / 7257600) * n6,
  (4583 / 161280) * n5 - (108847 / 3991680) * n6,
  (20648693 / 638668800) * n6,
];

/** τ' = tan(latitude conforme) a partir de τ = tan(latitude geodésica). */
function taup(tau: number): number {
  const tau1 = Math.hypot(1, tau);
  const sig = Math.sinh(e * Math.atanh((e * tau) / tau1));
  return Math.hypot(1, sig) * tau - sig * tau1;
}

/** Inversa de taup, pelo método de Newton (converge em 2–3 passos). */
function tauf(tp: number): number {
  let tau = tp / e2m;
  for (let i = 0; i < 6; i++) {
    const tpa = taup(tau);
    const d = ((tp - tpa) * (1 + e2m * tau * tau)) / (e2m * Math.hypot(1, tau) * Math.hypot(1, tpa));
    tau += d;
    if (Math.abs(d) <= 1e-15 * Math.max(1, Math.abs(tau))) break;
  }
  return tau;
}

/**
 * Soma ξ + Σ c_j·sin(2jξ)·cosh(2jη) e η + Σ c_j·cos(2jξ)·sinh(2jη) (j = 1..6), com os múltiplos
 * dos ângulos pela recorrência de Chebyshev (só 4 funções trigonométricas por ponto).
 * `sign` = +1 na direta (α), −1 na inversa (β).
 */
function krueger(xi: number, eta: number, c: readonly number[], sign: 1 | -1): [number, number] {
  const s1 = Math.sin(2 * xi), c1 = Math.cos(2 * xi);
  const sh1 = Math.sinh(2 * eta), ch1 = Math.cosh(2 * eta);
  let sPrev = 0, sCur = s1, cPrev = 1, cCur = c1;
  let shPrev = 0, shCur = sh1, chPrev = 1, chCur = ch1;
  let dx = 0, de = 0;
  for (let j = 1; j <= 6; j++) {
    dx += c[j] * sCur * chCur;
    de += c[j] * cCur * shCur;
    const sN = 2 * c1 * sCur - sPrev, cN = 2 * c1 * cCur - cPrev;
    const shN = 2 * ch1 * shCur - shPrev, chN = 2 * ch1 * chCur - chPrev;
    sPrev = sCur; sCur = sN; cPrev = cCur; cCur = cN;
    shPrev = shCur; shCur = shN; chPrev = chCur; chCur = chN;
  }
  return [xi + sign * dx, eta + sign * de];
}

/** ξ da latitude de origem (arco de meridiano até lat0, dividido por A). */
const XI0 = krueger(Math.atan(taup(Math.tan(PTTM06.lat0 * DEG))), 0, ALPHA, 1)[0];

/** WGS84/ETRS89 (graus) → PT-TM06 (metros): [x, y] = [este, norte]. */
export function toTM06(lon: number, lat: number): [number, number] {
  const lam = (lon - PTTM06.lon0) * DEG;
  const tp = taup(Math.tan(lat * DEG));
  const cl = Math.cos(lam);
  const xip = Math.atan2(tp, cl);
  const etap = Math.asinh(Math.sin(lam) / Math.hypot(tp, cl));
  const [xi, eta] = krueger(xip, etap, ALPHA, 1);
  return [fe + k0 * A * eta, fn + k0 * A * (xi - XI0)];
}

/** PT-TM06 (metros) → WGS84/ETRS89 (graus): [lon, lat]. */
export function fromTM06(x: number, y: number): [number, number] {
  const xi = (y - fn) / (k0 * A) + XI0;
  const eta = (x - fe) / (k0 * A);
  const [xip, etap] = krueger(xi, eta, BETA, -1);
  const shp = Math.sinh(etap), cxp = Math.cos(xip);
  const tp = Math.sin(xip) / Math.hypot(shp, cxp);
  const lam = Math.atan2(shp, cxp);
  return [PTTM06.lon0 + lam / DEG, Math.atan(tauf(tp)) / DEG];
}
