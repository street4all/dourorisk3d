# Especificação de Desenho: Módulo de Reanálise Climática e Precipitação Extrema (DouroRisk 3D)

**Data:** 2026-10-28  
**Projeto:** DouroRisk 3D (`dourorisk3d`)  
**Âmbito:** Integração nativa de um dashboard interativo de reanálise climática (Copernicus CERRA / ERA5) e análise de precipitação extrema na vista principal do mapa 3D (`/mapa/`).

---

## 1. Contexto e Objetivo

O projeto **DouroRisk** necessita de uma ferramenta digital interativa de reanálise climática orientada para a visualização e análise de eventos de **precipitação extrema** e dos seus impactos em territórios de baixa densidade (como o concelho de Alijó e a região do Douro), particularmente vulneráveis às alterações climáticas, erosão de encostas em socalcos e enxurradas pós-incêndio.

Em vez de depender de um servidor Python separado (`Streamlit` + `Folium` + `cdsapi` + `xarray`), este módulo é integrado nativamente na aplicação web 3D existente (`TypeScript` + `@arcgis/core` + `Vite`), consumindo dados de reanálise histórica **Copernicus CERRA / ERA5** através da API REST do Open-Meteo (`archive-api.open-meteo.com/v1/archive`) e projetando os resultados diretamente sobre o Gémeo Digital 3D de Alijó.

---

## 2. Arquitetura e Unidades de Código

O sistema é dividido em três módulos independentes com interfaces bem definidas:

### 2.1. `src/alijo3d/cerraService.ts` — Serviço de Dados de Reanálise e Geocodificação
* **Responsabilidade:** Recolher, validar, colocar em cache e estruturar séries temporais horárias/diárias e malhas espaciais para as **7 variáveis meteorológicas**:
  1. `precipitation` — Precipitação total (`mm`)
  2. `temperature_2m` — Temperatura do ar a 2 m (`°C`)
  3. `relative_humidity_2m` — Humidade relativa a 2 m (`%`)
  4. `wind_speed_10m` & `wind_direction_10m` — Velocidade (`km/h`) e direção (`°`) do vento a 10 m
  5. `wind_gusts_10m` — Rajadas máximas de vento a 10 m (`km/h`)
  6. `pressure_msl` — Pressão atmosférica ao nível do mar (`hPa`)
  7. `shortwave_radiation` (e `cloud_cover`) — Radiação solar (`W/m²`) / Nebulosidade (`%`)
* **Modos de Localização:**
  * Atalhos para as **14 freguesias de Alijó** (coordenadas centróides reais) e estações de referência (Alijó, Pinhão, Sanfins do Douro);
  * Coordenadas obtidas por **clique direto no mapa 3D**;
  * Pesquisa livre de **cidade/país** via `geocoding-api.open-meteo.com/v1/search` ou introdução direta de `latitude, longitude`.
* **Malha Espacial (Grid Batch):**
  * Gera uma grelha 4×4 (16 pontos distribuídos numa janela de ~0,24° × 0,24° em redor do ponto selecionado) e efetua um pedido multi-coordenada único à API histórica para obter os campos espaciais de precipitação, temperatura, pressão (`hPa`) e vento (`u, v`).
* **Cache e Fallback Offline:**
  * Cache em memória (`Map<string, ReanalysisDataset>`) indexada por coordenadas e intervalo temporal.
  * Conjunto de dados real embutido (evento extremo de Dezembro de 2019 — Depressão Elsa/Fabien em Alijó) como *fallback* automático caso não haja ligação à Internet.

### 2.2. `src/visit/climateMapOverlay.ts` — Visualização Espacial 3D Sobreposta
* **Responsabilidade:** Desenhar sobre o `SceneView` do ArcGIS as três componentes espaciais sincronizadas com o instante temporal selecionado pelo utilizador:
  1. **Heatmap Contínuo (`MediaLayer`):** Interpola por ponderação pelo inverso da distância (IDW) os valores da variável ativa na grelha 4×4 para um `HTMLCanvasElement` (160×160 px) com paleta de cores acessível e legenda clara, posicionado sobre os cantos geográficos da área analisada.
  2. **Isóbaras (`GraphicsLayer`):** Calcula isolinhas de pressão ao nível do mar (`pressure_msl` em passos de 1 ou 2 `hPa`) por interpolação na malha (`marching squares` simplificado) e desenha polilinhas + etiquetas de texto em `hPa`.
  3. **Setas de Vento (`GraphicsLayer`):** Desenha símbolos vetoriais orientados em cada nó da malha indicando direção (`wind_direction_10m`) e velocidade (`wind_speed_10m`), além de atualizar opcionalmente o ambiente 3D da cena (`Alijo3DManager` — intensidade de chuva e fluxo de vento 3D).

### 2.3. `src/visit/climatePanel.ts` — Interface, Séries Temporais Comparáveis e Impactos
* **Responsabilidade:** Gerir a interação no cartão `#climate-card` em `mapa/index.html` e coordenar `cerraService.ts` com `climateMapOverlay.ts` e `VisitMode`.
* **Componentes de UI:**
  * Botão `#btn-climate` na barra superior `.hud-tools` (fecha `#probe-card` e `#maps-card` ao abrir, e vice-versa).
  * Seletor de **Eventos Históricos Extremos** no Douro:
    * *Depressão Elsa & Fabien (18–22 Dez 2019)* — Precipitação extrema e cheias no Douro/Tua;
    * *Trovoada e Enxurrada no Pinhão/Alijó (12–15 Jun 2023)* — Aguaceiros violentos em encosta;
    * *Tempestade Aline / Babet (16–20 Out 2023)* — Chuva persistente e vento forte;
    * *Episódio Extremo de Verão / Fogo (12–18 Jul 2022)* — Secura e calor extremo em Alijó.
  * Seletores de **Data de Início** e **Data de Fim** (com validação automática de limites).
  * Controlo de **Localização** (Freguesia de Alijó, botão *"Clicar no mapa 3D"*, ou pesquisa de cidade/coordenadas).
  * Seletor da **Variável Principal** (para o *Heatmap* e eixo primário do gráfico) + **Variável de Comparação** (para o eixo secundário do gráfico de séries temporais).
  * *Checkboxes* para ligar/desligar **Heatmap**, **Isóbaras (hPa)** e **Setas de Vento**, e *slider* de instante temporal (hora/dia) com botão de reprodução (*Play/Pause*).
  * **Gráfico SVG Interativo de Séries Temporais:** Desenha as duas variáveis escolhidas ao longo do tempo, assinala o limiar de precipitação extrema e permite clicar num ponto do gráfico para posicionar o mapa 3D nessa hora.
  * **Quadro de Impactos em Territórios de Baixa Densidade e Boas Práticas:** Diagnóstico automático do evento (precipitação máxima horária, acumulada no período, rajada máxima e queda de pressão) acompanhado de recomendações específicas para o Douro (estabilidade de muros de xisto/socalcos, escorrentia em áreas ardidas, linhas de água e proteção civil local).

---

## 3. Acessibilidade e Integração com o Modo Visita

* Segue rigorosamente as regras de acessibilidade de `mapa/index.html`:
  * Suporte ao modo escuro/claro, alto contraste (`body.high-contrast`) e ampliação de letra (`#btn-font`).
  * Anúncios `aria-live="polite"` para estados de carregamento e resumo dos dados.
  * Navegação por teclado (`Escape` fecha o painel e devolve o foco ao botão `#btn-climate`).

---

## 4. Plano de Testes e Verificação

1. **Compilação estática:** `npm run build` (`tsc && vite build`) sem erros de tipos.
2. **Teste de dados e fallback:** Verificar resposta da API `archive-api.open-meteo.com` para coordenadas de Alijó e confirmar funcionamento do *fallback* em caso de erro de rede.
3. **Teste visual e espacial no 3D:** Verificar que o *Heatmap*, as *Isóbaras* e as *Setas de Vento* são desenhados nas coordenadas corretas em `SceneView` e limpos ao fechar o painel.
4. **Teste de comparação de séries temporais:** Alternar entre as 7 variáveis meteorológicas e confirmar atualização do gráfico duplo e do resumo de precipitação extrema.

