// Palavras da visita: uma palavra para cada coisa, iguais na ficha do ponto, nas áreas, nas legendas e no vento.
export const RISK_WORDS = ["muito baixo", "baixo", "médio", "alto", "muito alto"];
export const DIRS = ["norte", "nordeste", "nascente", "sudeste", "sul", "sudoeste", "poente", "noroeste"];
export const rumo = (graus: number): string => DIRS[Math.round((((graus % 360) + 360) % 360) / 45) % 8];
/** Rumos da classe "ao sol" que apanham o sol da tarde. */
export const SOL_TARDE = new Set(["sudoeste", "poente"]);
/**
 * A classe "ao sol" vai de sudeste a poente exatos (135° a 270°): metade do rumo "sudeste" (112,5° a 135°)
 * e metade do "poente" (270° a 292,5°) ficam de fora. Nessas encostas, com menos sol, a ficha diz o rumo
 * («Virada a sudeste») e, na sub-linha, para que vizinho pende («menos sol, mais para nascente»): assim não
 * contradiz a legenda («virada ao sol (de sudeste a poente)») e o rótulo continua a ler bem.
 */
export const FORA_DO_SOL: Readonly<Record<string, string>> = { sudeste: "nascente", poente: "noroeste" };
export const DECL_WORDS = ["", "pouco inclinada", "inclinada", "muito inclinada", "muito íngreme"]; // índice = classe de declive_a11y
export const MATO_WORDS = ["", "muito pouco", "pouco", "algum", "muito", "muito denso"];           // índice = classe de biomassa_2025
export const vezes = (n: number): string => `${n} ${n === 1 ? "vez" : "vezes"}`;
/** "2020–2030" -> "de 2020 a 2030"; "2025" -> "2025" */
export const periodo = (ano: string): string => { const [a, b] = ano.split("–"); return b ? `de ${a} a ${b}` : a; };

/** Texto seguro dentro de HTML (conteúdo e atributos entre aspas). */
export function esc(t: string): string {
  return t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Fonte curta em HTML: o período ("1990–2025") não se parte no fim da linha. */
export const fonteCurtaHtml = (t: string): string => esc(t).replace(/\d{4}–\d{4}/g, (m) => `<span class="nw">${m}</span>`);
