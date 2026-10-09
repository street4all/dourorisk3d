export type LayerTarget = "municipalities" | "parishes";

export interface ColorBreak {
  minValue: number;
  maxValue: number;
  color: [number, number, number, number]; // RGBA
  label: string;
}

export interface EconomicIndicator {
  id: string;
  label: string;
  shortLabel: string;
  unit: string;
  description: string;
  attributeField: string;
  targetLayer: LayerTarget;
  breaks: ColorBreak[];
  min: number;
  max: number;
  step: number;
}

export interface MunicipalityProperties {
  id_municipio: string;
  nome_municipio: string;
  distrito: string;
  densidade_empresas: number;
  taxa_nascimento: number;
  poder_compra: number;
  total_empresas: number;
  populacao: number;
}

export interface ParishProperties {
  id_freguesia: string;
  nome_freguesia: string;
  id_municipio: string;
  nome_municipio: string;
  distrito: string;
  pct_empregadores: number;
  pct_trabalhadores_independentes: number;
  pct_servicos: number;
  pct_industria: number;
  pop_ativa: number;
  taxa_atividade: number;
}

export interface FilterState {
  indicatorId: string;
  selectedDistrict: string;
  selectedMunicipality: string;
  minThreshold: number;
  activeLayer: LayerTarget;
}

export const INDICATORS: Record<string, EconomicIndicator> = {
  densidade_empresas: {
    id: "densidade_empresas",
    label: "Densidade Empresarial",
    shortLabel: "Empresas / 1k hab.",
    unit: "emp./1k hab.",
    description: "Número de empresas ativas com sede no concelho por cada 1.000 habitantes.",
    attributeField: "densidade_empresas",
    targetLayer: "municipalities",
    min: 40,
    max: 180,
    step: 5,
    breaks: [
      { minValue: 0, maxValue: 65, color: [237, 248, 251, 0.85], label: "< 65 (Baixa densidade)" },
      { minValue: 65, maxValue: 85, color: [179, 205, 227, 0.85], label: "65 - 85 (Média-baixa)" },
      { minValue: 85, maxValue: 110, color: [140, 150, 198, 0.85], label: "85 - 110 (Média)" },
      { minValue: 110, maxValue: 140, color: [136, 86, 167, 0.85], label: "110 - 140 (Elevada)" },
      { minValue: 140, maxValue: 999, color: [129, 15, 124, 0.85], label: "> 140 (Muito elevada)" },
    ],
  },
  pct_empregadores: {
    id: "pct_empregadores",
    label: "Taxa de Empregadores & Patrões",
    shortLabel: "Empregadores (%)",
    unit: "%",
    description: "Proporção de empregadores face ao total da população empregada na freguesia.",
    attributeField: "pct_empregadores",
    targetLayer: "parishes",
    min: 2,
    max: 18,
    step: 0.5,
    breaks: [
      { minValue: 0, maxValue: 4.5, color: [240, 249, 232, 0.85], label: "< 4.5% (Reduzido)" },
      { minValue: 4.5, maxValue: 6.5, color: [186, 228, 188, 0.85], label: "4.5% - 6.5% (Moderado)" },
      { minValue: 6.5, maxValue: 9.0, color: [123, 204, 196, 0.85], label: "6.5% - 9.0% (Intermédio)" },
      { minValue: 9.0, maxValue: 12.0, color: [67, 162, 202, 0.85], label: "9.0% - 12.0% (Alto)" },
      { minValue: 12.0, maxValue: 100, color: [8, 104, 172, 0.85], label: "> 12.0% (Muito alto)" },
    ],
  },
  pct_servicos: {
    id: "pct_servicos",
    label: "Especialização em Serviços & Tecnologia",
    shortLabel: "Setor Terciário (%)",
    unit: "%",
    description: "Percentagem da população empregada no setor terciário (serviços, tecnologia, finanças e comércio).",
    attributeField: "pct_servicos",
    targetLayer: "parishes",
    min: 30,
    max: 95,
    step: 5,
    breaks: [
      { minValue: 0, maxValue: 45, color: [254, 237, 222, 0.85], label: "< 45% (Incipiente)" },
      { minValue: 45, maxValue: 60, color: [253, 190, 133, 0.85], label: "45% - 60% (Em transição)" },
      { minValue: 60, maxValue: 72, color: [253, 141, 60, 0.85], label: "60% - 72% (Significativo)" },
      { minValue: 72, maxValue: 82, color: [230, 85, 13, 0.85], label: "72% - 82% (Polo de serviços)" },
      { minValue: 82, maxValue: 100, color: [166, 54, 3, 0.85], label: "> 82% (Predominante)" },
    ],
  },
  pct_industria: {
    id: "pct_industria",
    label: "Especialização em Indústria & Produção",
    shortLabel: "Indústria (%)",
    unit: "%",
    description: "Percentagem da população empregada no setor secundário (indústria transformadora e construção).",
    attributeField: "pct_industria",
    targetLayer: "parishes",
    min: 5,
    max: 60,
    step: 2,
    breaks: [
      { minValue: 0, maxValue: 15, color: [246, 239, 247, 0.85], label: "< 15% (Baixa industrialização)" },
      { minValue: 15, maxValue: 25, color: [208, 209, 230, 0.85], label: "15% - 25% (Moderada)" },
      { minValue: 25, maxValue: 35, color: [166, 189, 219, 0.85], label: "25% - 35% (Industrial)" },
      { minValue: 35, maxValue: 45, color: [103, 169, 207, 0.85], label: "35% - 45% (Forte polo fabril)" },
      { minValue: 45, maxValue: 100, color: [1, 108, 89, 0.85], label: "> 45% (Coração fabril)" },
    ],
  },
};
