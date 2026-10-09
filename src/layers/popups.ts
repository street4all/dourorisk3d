import PopupTemplate from "@arcgis/core/PopupTemplate.js";

/**
 * Arcade expression for Parishes economic profile classification
 */
const parishProfileArcade = `
  var serv = DefaultValue($feature.pct_servicos, 0);
  var ind = DefaultValue($feature.pct_industria, 0);
  var emp = DefaultValue($feature.pct_empregadores, 0);

  if (serv >= 72) {
    return "🌟 Polo de Serviços & Inovação";
  } else if (ind >= 35) {
    return "🏭 Coração Industrial & Produção";
  } else if (emp >= 8.5) {
    return "💼 Hub de Empreendedorismo";
  } else {
    return "🏘️ Tecido Misto & Comércio Local";
  }
`;

/**
 * Arcade expression for comparison with national average
 */
const parishBenchmarkArcade = `
  var emp = DefaultValue($feature.pct_empregadores, 0);
  var diff = Round(emp - 6.2, 1);
  if (diff > 0) {
    return "+" + Text(diff) + "% acima da média nacional";
  } else if (diff < 0) {
    return Text(diff) + "% abaixo da média nacional";
  }
  return "Na média nacional";
`;

/**
 * Creates PopupTemplate for Parishes (Freguesias)
 */
export function createParishPopupTemplate(): PopupTemplate {
  return new PopupTemplate({
    title: "{nome_freguesia}",
    expressionInfos: [
      {
        name: "perfil_economico",
        title: "Vocação Económica",
        expression: parishProfileArcade,
      },
      {
        name: "comparacao_media",
        title: "Face à Média Nacional",
        expression: parishBenchmarkArcade,
      },
    ],
    content: [
      {
        type: "text",
        text: `
          <div style="font-size: 13px; line-height: 1.5; padding: 4px 0;">
            <p><strong>Município:</strong> {nome_municipio} ({distrito})</p>
            <p><strong>Perfil Territorial:</strong> <span style="font-weight: 600; color: #007ac2;">{expression/perfil_economico}</span></p>
            <p style="font-size: 12px; color: #555;">{expression/comparacao_media}</p>
          </div>
        `,
      },
      {
        type: "fields",
        fieldInfos: [
          {
            fieldName: "pct_empregadores",
            label: "Taxa de Empregadores / Patrões",
            format: { places: 1, digitSeparator: true },
          },
          {
            fieldName: "pct_trabalhadores_independentes",
            label: "Trabalhadores Independentes",
            format: { places: 1, digitSeparator: true },
          },
          {
            fieldName: "pct_servicos",
            label: "População em Serviços (%)",
            format: { places: 0, digitSeparator: true },
          },
          {
            fieldName: "pct_industria",
            label: "População na Indústria (%)",
            format: { places: 0, digitSeparator: true },
          },
          {
            fieldName: "pop_ativa",
            label: "População Ativa Total",
            format: { places: 0, digitSeparator: true },
          },
          {
            fieldName: "taxa_atividade",
            label: "Taxa de Atividade (%)",
            format: { places: 1, digitSeparator: true },
          },
        ],
      },
    ],
  });
}

/**
 * Creates PopupTemplate for Municipalities (Concelhos)
 */
export function createMunicipalPopupTemplate(): PopupTemplate {
  return new PopupTemplate({
    title: "Município de {nome_municipio}",
    content: [
      {
        type: "text",
        text: `
          <div style="font-size: 13px; line-height: 1.5; padding: 4px 0;">
            <p><strong>Distrito:</strong> {distrito}</p>
            <p><strong>População Estimada:</strong> {populacao} habitantes</p>
          </div>
        `,
      },
      {
        type: "fields",
        fieldInfos: [
          {
            fieldName: "densidade_empresas",
            label: "Densidade Empresarial (emp./1k hab.)",
            format: { places: 0, digitSeparator: true },
          },
          {
            fieldName: "total_empresas",
            label: "Total de Empresas Sediadas",
            format: { places: 0, digitSeparator: true },
          },
          {
            fieldName: "taxa_nascimento",
            label: "Taxa Anual de Criação de Empresas (%)",
            format: { places: 1, digitSeparator: true },
          },
          {
            fieldName: "poder_compra",
            label: "Índice de Poder de Compra (Base Nac. 100)",
            format: { places: 0, digitSeparator: true },
          },
        ],
      },
    ],
  });
}
