# DouroRisk 3D — Gémeo Digital & Inteligência Territorial

**Domínio:** [dourorisk3d.bvsd.pt](https://dourorisk3d.bvsd.pt)  
**Entidade:** Bombeiros Voluntários de Sanfins do Douro (BVSD) & Concelho de Alijó  
**Autor:** Hugo Vilela (`hugovilela81@gmail.com`)  
**Organização GitHub:** `street4all`

---

## 📌 Visão Geral

O **DouroRisk 3D** é uma plataforma inovadora em formato de **Gémeo Digital (*Digital Twin*) 100% 3D** concebida para a gestão integrada do risco de incêndio rural, resiliência territorial e valorização do património edificado no **Concelho de Alijó** (com destaque para Sanfins do Douro, Favaios e Pinhão).

A aplicação combina:
1. **Modelação Científica DouroRisk (ArcGIS Pro / ArcPy):** Matrizes de risco e perigosidade a 10m e 25m, histórico de recorrência de incêndios (1990–2025), biomassa/combustível e declive topográfico.
2. **ArcGIS Maps SDK for JavaScript 5.1 (`SceneView`):** Renderização tridimensional em relevo real (*world-elevation*), com sobreposição precisa de matrizes via `MediaLayer`.
3. **Património 3D PBR:** Modelação arquitetónica detalhada do Santuário de Nossa Senhora da Piedade (ficheiro GLB PBR) e pegadas de mais de 2.200 edifícios e telhados tradicionais durienses.
4. **Meteorologia Dinâmica & Linhas de Fluxo:** Telemetria em tempo real da estação meteorológica oficial do IPMA no Pinhão (Santa Bárbara) e correntes de vento simuladas via `FlowRenderer`.
5. **Visita Interativa Inclusiva ("Onde Pode Arder?"):** 5 estações pedagógicas e operacionais (*Olha*, *Escolhe*, *Guarda*, *Compara*, *Protege*).

### 🧭 Estrutura de Rotas
* **`/` (Landing Page):** Página de apresentação com identidade visual, objetivos, números e parceiros.
* **`/mapa/` (Gémeo Digital 3D):** Aplicação interativa em ecrã inteiro com ArcGIS SceneView e ferramentas de análise.

---

## 🚀 Como Executar Localmente

### Pré-requisitos
* Node.js 18+ ou 20+
* npm

### Instalação e Execução
```bash
# 1. Instalar dependências
npm install

# 2. Iniciar servidor de desenvolvimento local
npm run dev

# 3. Compilar pacote de produção
npm run build

# 4. Pré-visualizar build local
npm run preview
```

---

## 🌐 Configuração de DNS (dourorisk3d.bvsd.pt)

Para que o domínio personalizado aponte corretamente para as GitHub Pages da organização `street4all`:

| Tipo de Registo | Nome / Host | Destino / Valor | TTL |
| :---: | :---: | :---: | :---: |
| **CNAME** | `dourorisk3d` | `street4all.github.io` | Automático / 3600 |

* O ficheiro `public/CNAME` já contém `dourorisk3d.bvsd.pt` e é injetado automaticamente na raiz de `dist/` durante a compilação.
* A GitHub Action `.github/workflows/deploy.yml` gere o build e a publicação automática a cada push para a branch `main`.

---

## 🛠️ Tecnologias Utilizadas

* **Framework Web:** [Vite](https://vitejs.dev/) + [TypeScript](https://www.typescriptlang.org/)
* **Cartografia 3D:** [@arcgis/core](https://developers.arcgis.com/javascript/latest/) (v5.1.0)
* **Design System:** [@esri/calcite-components](https://developers.arcgis.com/calcite-design-system/) (v5.1.1)
* **Motor 3D & GLTF:** Three.js + WebGL
* **Ponte de Dados SIG:** Python ArcPy (ArcGIS Pro 3.7.1)
