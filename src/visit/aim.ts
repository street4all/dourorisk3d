// Mira do mapa: a alternativa ao toque para quem usa teclado («Ler o centro do mapa», «Acender no centro do
// mapa», «Centro» do Explorar). A mira fica no centro da vista; se a janela aberta a tapar (em ecrãs estreitos a
// janela fica em baixo; num ecrã pouco largo fica à esquerda), passa para o centro do mapa que se vê por cima ou
// ao lado da janela. O ponto lido é sempre o ponto onde a mira está.

/** O que a mira precisa de saber da vista do ArcGIS. */
export interface AimView {
  container?: HTMLElement | null;
  width: number;
  height: number;
  ui?: { padding?: unknown };
}

/** espaço mínimo para a mira (44 px) e as suas linhas (60 px) */
const MIN_PX = 100;

function padding(view: AimView, lado: "top" | "bottom"): number {
  const p = view.ui?.padding;
  if (typeof p === "number") return p;
  const v = (p as Partial<Record<"top" | "bottom", number>> | undefined)?.[lado];
  return typeof v === "number" ? v : 0;
}

/** Ponto da mira, em px dentro da vista (o que view.toMap recebe). */
export function aimPoint(view: AimView): { x: number; y: number } {
  const x = view.width / 2, y = view.height / 2;
  const box = view.container?.getBoundingClientRect();
  const pop = document.querySelector<HTMLElement>(".pop:not([hidden])");
  if (!box || !pop) return { x, y };
  const p = pop.getBoundingClientRect();
  const cx = box.left + x, cy = box.top + y;
  // a janela não tapa o centro: a mira fica no centro
  if (cx < p.left || cx > p.right || cy < p.top || cy > p.bottom) return { x, y };
  const topo = box.top + padding(view, "top");
  // por cima da janela (ecrãs estreitos)
  if (p.top - topo >= MIN_PX) return { x, y: (topo + p.top) / 2 - box.top };
  // ao lado da janela (janela à esquerda)
  if (box.right - p.right >= MIN_PX) {
    return { x: (p.right + box.right) / 2 - box.left, y: (topo + box.bottom - padding(view, "bottom")) / 2 - box.top };
  }
  return { x, y };
}

/** Põe a mira (.crosshair) no ponto que vai ser lido. */
export function placeCrosshair(view: AimView): void {
  const el = document.querySelector<HTMLElement>(".crosshair");
  const box = view.container?.getBoundingClientRect();
  if (!el || !box) return;
  const a = aimPoint(view);
  el.style.left = `${box.left + a.x}px`;
  el.style.top = `${box.top + a.y}px`;
}
