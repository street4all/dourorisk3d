# Especificação de Desenho — Multirrisco Hidro-Geomorfológico Pós-Incêndio & Simulador de Mitigação Local (25 m)

**Data:** 2026-10-28  
**Projeto:** `dourorisk3d` (Concelho de Alijó / Douro)  
**Estado:** Aprovado em fase de Brainstorming

---

## 1. Objetivo e Contexto

Em territórios de montanha e baixa densidade populacional como o concelho de Alijó (Douro), os incêndios florestais e os eventos hidrometeorológicos extremos (chuva torrencial ou fusão rápida de neve) não atuam isoladamente: formam uma **cascata multirrisco**. Quando uma depressão atlântica (ex.: *Depressão Aline*, *Tempestade Elsa* ou *Nevão de Janeiro de 2026*) descarrega precipitação intensa sobre encostas declivosas recentemente ardidas ou sobre vertentes de socalcos vitícolas saturadas, ocorrem:

1. **Erosão laminar severa e enxurradas de cinzas/detritos** nas cicatrizes de fogo recentes (`ultimo_ano >= 2020`), onde a perda de coberto vegetal (`biomassa_t_ha`) e a hidrofobicidade do solo multiplicam a escorrentia superficial.
2. **Derrocada de muros de socalco (*patamares de xisto*) e movimentos de vertente** em encostas com declive acentuado (`declive_pct >= 25%–45%`), ameaçando estradas municipais (EN212, EM533), habitações e linhas de água (Rio Tua, Rio Pinhão, Ribeira da Vilariça).

Este módulo acopla a **Reanálise Climática Horária (Copernicus CERRA / ERA5)** às **grelhas biofísicas e históricas de incêndio de 25 m de resolução** (`848 × 1068` células em PT-TM06 `g25`) e inclui um **Simulador Interativo de Mitigação Local ("Antes vs. Depois")** que quantifica o impacto de três medidas reais de estabilização de emergência pós-fogo.

---

## 2. Arquitetura e Componentes

### 2.1. Motor de Cálculo Espacial a 25 m (`src/visit/climateMapOverlay.ts`)
- Nova camada `hydroRiskOverlay: CanvasOverlay` sobre a grelha `G25` (`848 × 1068`, `0,0625 ha` por célula).
- Estado de configuração da mitigação e estatísticas calculadas em tempo real:
  ```ts
  export interface MitigationConfig {
    mulching: boolean;       // Mulching florestal / hidrossementeira em áreas ardidas recentes (-65% erosão pós-fogo)
    logBarriers: boolean;    // Barreiras de retenção / fascinas em encostas declivosas (-45% escorrentia)
    terraceDrains: boolean;  // Consolidação e drenagem de muros de socalco (-55% risco de colapso em socalcos)
  }

  export interface HydroRiskStats {
    baselineHighRiskHa: number;      // Hectares em risco Elevado + Crítico sem mitigação
    mitigatedHighRiskHa: number;     // Hectares em risco Elevado + Crítico com as medidas ativas
    baselineCriticalHa: number;      // Hectares em risco Crítico (derrocada/escorrentia extrema) sem mitigação
    mitigatedCriticalHa: number;     // Hectares em risco Crítico com as medidas ativas
    baselineSoilLossTons: number;    // Perda potencial de solo estimada na hora/evento (toneladas) sem mitigação
    mitigatedSoilLossTons: number;   // Perda potencial de solo (toneladas) após mitigação
    savedHaPct: number;              // Redução percentual da área de risco elevado/crítico (%)
    savedSoilTons: number;           // Toneladas de solo e cinzas retidas pelas medidas
  }
  ```

### 2.2. Modelo Físico Simplificado (RUSLE / Suscetibilidade Hidro-Geomorfológica Dinâmica)
Para cada célula válida $i$ do concelho de Alijó (`concelhoBytes[i] === 1` e `rioBytes[i] === 0`):

1. **Forçamento Hidrometeorológico ($R_t$):**
   - Lê do passo horário atual `stepIdx` e das 24 horas antecedentes no dataset CERRA/ERA5:
     - Precipitação horária $P_{\text{1h}}$ (`mm/h`)
     - Precipitação acumulada nas últimas 24 h $P_{\text{24h}}$ (`mm`)
     - Equivalente de fusão de neve quando $T > 1{,}5\text{ °C}$ após acumulação de neve
   - Índice de agressividade hídrica:
     $$R_t = \max\left(0{,}25,\; \min\left(3{,}2,\; \frac{P_{\text{1h}}}{6{,}0} + \frac{P_{\text{24h}}}{35{,}0}\right)\right)$$

2. **Fator Topográfico e de Socalcos ($LS_i$):**
   - A partir de `VALUES.declive` (declive em `%`) e `MDT` (altitude em `m`):
   - Células com declive $< 12\%$ têm suscetibilidade basal reduzida.
   - Células com declive $15\%\text{–}30\%$ têm suscetibilidade moderada; declives $\ge 30\%$ e $\ge 45\%$ escalam de forma não-linear.

3. **Fator Pós-Incêndio e Coberto Vegetal ($C_i$):**
   - A partir de `VALUES.ultimoAno` (codificado de 1990 a 2025), `VALUES.recorrencia` (n.º de fogos) e `VALUES.biomassa`:
   - **Cicatriz recente ($\ge 2020$):** agravamento de $\times 2{,}35$ (solo nu e hidrofóbico).
   - **Cicatriz intermédia ($2015\text{–}2019$) ou recorrência $\ge 3$:** agravamento de $\times 1{,}55$.
   - **Biomassa densa ($\ge 25\text{ t/ha}$) sem fogo recente:** fator de proteção ($\times 0{,}55$).

4. **Efeito das 3 Medidas de Mitigação Local ($M_i$):**
   - **🌾 Mulching / Hidrossementeira (`mulching`):** aplica-se às áreas ardidas desde 2016 (`ultimoAno >= 2016`) ou com recorrência $\ge 2$, reduzindo o índice nessas células em **$65\%$** ($\times 0{,}35$).
   - **🪵 Barreiras de Retenção / Fascinas (`logBarriers`):** aplica-se a encostas com declive $\ge 18\%$ com histórico de fogo (`recorrencia >= 1`), reduzindo o índice em **$45\%$** ($\times 0{,}55$).
   - **🧱 Drenagem e Consolidação de Muros de Socalco (`terraceDrains`):** aplica-se a vertentes de socalco duriense (`declive >= 24%` e altitude `< 600 m`), reduzindo a instabilidade estrutural em **$55\%$** ($\times 0{,}45$).

5. **Classes de Risco no Mapa 3D (25 m):**
   - **Baixo ($I < 1{,}0$):** transparente (terreno visível).
   - **Moderado ($1{,}0 \le I < 1{,}75$):** Amarelo-âmbar (`#facc15`, opacidade suave).
   - **Elevado — Erosão de Solo e Cinzas ($1{,}75 \le I < 2{,}65$):** Laranja intenso (`#f97316`).
   - **Crítico — Derrocada de Socalcos / Enxurrada de Detritos ($I \ge 2{,}65$):** Vermelho vivo (`#dc2626`).

---

## 3. Interface de Utilizador (`mapa/index.html` e `src/visit/climatePanel.ts`)

1. **Toggle de Camada 3D em `#climate-card`:**
   - Checkbox `⛰️ Erosão & Socalcos (25m)` na grelha de camadas sobrepostas no mapa 3D.
2. **Secção Interativa `"🛡️ Mitigação Local & Estabilização Pós-Fogo (25 m)"`:**
   - 3 interruptores (botões/chips interativos com estado `aria-pressed`) para ligar/desligar em tempo real:
     - `🌾 Mulching / Hidrossementeira (-65% nas áreas ardidas)`
     - `🪵 Barreiras de Retenção / Fascinas (-45% nas encostas)`
     - `🧱 Drenagem de Muros de Socalco (-55% nos patamares)`
   - **Painel de Métricas "Antes vs. Depois":**
     - Mostra lado a lado a **Área em Risco Elevado/Crítico (ha)** antes e depois da mitigação, a **percentagem de área protegida (`-XX%`)** e as **toneladas de solo/cinzas retidas** durante o episódio meteorológico.

---

## 4. Testes e Verificação

1. **Validação estática:** `npm run build` (`tsc && vite build`) sem erros de compilação.
2. **Teste funcional nos eventos extremos:**
   - Selecionar *Depressão Aline (Out 2023)* ou *Nevão + Degelo (Jan 2026)* na visão local de Alijó.
   - Ativar `⛰️ Erosão & Socalcos (25m)` e verificar que as manchas críticas coincidem com as encostas íngremes do Douro/Tua/Pinhão e cicatrizes de incêndio recentes.
   - Ativar cada uma das 3 medidas de mitigação e confirmar a redução imediata das manchas vermelhas/laranjas no terreno 3D e a atualização dos indicadores em hectares e toneladas retidas.
