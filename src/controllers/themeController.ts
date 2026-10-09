import type MapView from "@arcgis/core/views/MapView.js";

export class ThemeController {
  private isDark = true;
  private view: MapView;
  private actionButton: HTMLElement | null = null;

  constructor(view: MapView) {
    this.view = view;
    this.actionButton = document.getElementById("theme-toggle-btn");
  }

  public initialize(): void {
    // Default to dark mode for rich aesthetics
    document.body.classList.add("calcite-mode-dark");
    document.body.classList.remove("calcite-mode-light");
    if (this.view.map) {
      this.view.map.basemap = "dark-gray-vector" as any;
    }

    if (this.actionButton) {
      this.actionButton.addEventListener("click", () => this.toggle());
    }
  }

  public toggle(): void {
    this.isDark = !this.isDark;

    if (this.isDark) {
      document.body.classList.add("calcite-mode-dark");
      document.body.classList.remove("calcite-mode-light");
      if (this.view.map) {
        this.view.map.basemap = "dark-gray-vector" as any;
      }
      if (this.actionButton) {
        this.actionButton.setAttribute("icon", "brightness");
        this.actionButton.setAttribute("text", "Modo Claro");
      }
    } else {
      document.body.classList.add("calcite-mode-light");
      document.body.classList.remove("calcite-mode-dark");
      if (this.view.map) {
        this.view.map.basemap = "gray-vector" as any;
      }
      if (this.actionButton) {
        this.actionButton.setAttribute("icon", "moon");
        this.actionButton.setAttribute("text", "Modo Escuro");
      }
    }
  }
}
