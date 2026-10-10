# Onde Pode Arder? — guia dos painéis e da app

Exposição e app para o Centro Interpretativo, feitas para todas as pessoas: alunos do secundário, pessoas idosas, quem vê ou ouve mal, quem lê com dificuldade e quem fala outra língua.

**A ideia numa frase:** a turma faz um palpite sobre onde o fogo pode chegar, guarda-o num envelope com o carimbo dos bombeiros, compara-o com o que ardeu de verdade e escolhe uma ação para proteger a aldeia.

## Os 8 painéis (A3 vertical)

| # | Estação | Pergunta | Imagem principal |
|---|---|---|---|
| 0 | Começa aqui | Onde pode arder? | O concelho de Alijó em 3D, com quantas vezes ardeu cada sítio |
| 1 | Olha (círculo azul) | Como é a nossa terra, do rio ao monte? | Corte do terreno real do Douro ao monte, a passar por Sanfins + foto do Santuário |
| 2 | Escolhe (triângulo uva) | Onde achas que o fogo pode chegar? | Mapa de relevo com 3 fichas numeradas + 4 cartões-pista (nenhum mostra onde ardeu) |
| 3 | Guarda (quadrado xisto) | Tens pouca, alguma ou muita certeza? | Postal → envelope com carimbo da AHBV → Caixa dos Bombeiros + ecrã da app |
| 4A | Compara (losango vinho) | Onde ardeu de verdade? Acertámos? | Mapa de quantas vezes ardeu, com textura, e as 3 fichas verificadas |
| 4B | Compara | O mapa acerta sempre? | 2017 e 2025 em campos de futebol + 22 verões + o que o mapa não sabe |
| 5 | Protege (casa verde) | O que podemos fazer antes do próximo verão? | Aldeia de Sanfins em 3D (casas vistas por satélite) com o risco + o mato a voltar + 6 ações |
| 6 | Saída | Vida por Vida | Brasão da AHBV, mensagem final, serviços de acessibilidade, apoios |

## Textos alternativos (para audiodescrição, leitor de ecrã e ficheiros digitais)

- **0.** Desenho em 3D do concelho de Alijó, visto de sul. O rio Douro passa em baixo. A norte, no monte, há muitas manchas cor de laranja e castanho-escuro: são os sítios onde o fogo passou mais vezes desde 1990. O sul, junto ao rio, está quase todo cinzento: quase não ardeu. Estão marcados Sanfins do Douro, Alijó e Pinhão. Por baixo, cinco formas com números de 1 a 5 mostram os passos da visita.
- **1.** Desenho do terreno real, de sul para norte, a passar por Sanfins do Douro. À esquerda, o rio Douro. Sobe-se por vinhas em socalcos até à aldeia, a meio. À direita, no alto, o monte com mato e chamas desenhadas onde ardeu muitas vezes. Uma seta mostra 765 metros de subida. Ao lado, uma fotografia do Santuário de Sanfins do Douro.
- **2.** Mapa do concelho com o norte para cima. Três fichas redondas com os números 1, 2 e 3 estão pousadas como exemplo. Ao lado, quatro cartões com desenhos: encosta inclinada, encosta ao sol, mato e um documento (o mapa oficial do perigo).
- **3.** Três desenhos com setas: um postal com um mapa pequeno, três fichas e três caras; um envelope com o carimbo dos Bombeiros Voluntários de Sanfins do Douro; a Caixa dos Bombeiros. Em baixo, um ecrã da app com o botão grande "Guardar o palpite".
- **4A.** Mapa do concelho com os sítios onde o fogo passou desde 1990, com cor e textura: pontos para 1 ou 2 vezes, riscas para 3 ou 4, quadriculado para 5 a 9. O norte tem muitas manchas e o sul quase nenhuma. Das três fichas, duas têm um sinal verde e uma tem uma cruz. Ao lado, dez quadrados, quatro cheios.
- **4B.** Dois mapas. Em 2017, uma grande mancha às riscas no centro e a leste, igual a mais de 5 600 campos de futebol. Em 2025, uma mancha mais pequena no norte, quase 1 000 campos. Por baixo, 21 círculos, um por verão com mais de 5 hectares ardidos; 4 têm um visto. Em baixo, três desenhos: vento, mato e uma chama.
- **5.** A aldeia de Sanfins do Douro em 3D, com as casas vistas por satélite. O chão tem as cores do risco de fogo, com os números 3 e 4 escritos nas zonas. As casas em risco alto têm telhado escuro. Em baixo, quatro desenhos da mesma encosta (logo depois do fogo, 2, 5 e 10 anos depois) e seis ações com desenho: limpar, pastorear, fogo controlado, cuidar da vinha, sem queimadas e ligar 112.
- **6.** Brasão dos Bombeiros Voluntários de Sanfins do Douro, com águia, cachos de uvas, o rio e o lema "Vida por Vida", seguido das frases finais e dos serviços de acessibilidade.

## Sistema visual

- **Letra:** Atkinson Hyperlegible (Braille Institute, licença OFL), só Regular e Bold. Perguntas 54 pt, frase principal 30 pt, passos 24–25 pt, legendas e nomes nos mapas 20–24 pt. Nada abaixo de 20 pt, exceto o marcador do código QR, que é só um espaço reservado.
- **Cores:** texto #1C1C1C sobre papel #F7F3EA (15,4:1). Texto branco sobre as cores das estações (7,2:1 a 10,9:1). Rio #1F5C99.
- **Estações:** cada uma tem número, verbo, cor e forma (círculo, triângulo, quadrado, losango, casa). A cor nunca é a única pista.
- **Escalas (painéis):** do claro ao escuro, seguras para daltonismo. Nos mapas de classes, cada classe tem também uma textura (liso, pontos, riscas, quadriculado), e o perigo leva número, palavra e chamas. Na app, os mapas de risco e perigo usam a paleta oficial verde→vermelho (decisão do projeto); a cor nunca vem sozinha: a legenda dá sempre número, palavra e chamas.
- **Números:** sempre comparados com coisas conhecidas (1 campo de futebol = 105 × 68 m ≈ 0,71 ha; 10 quadrados; 22 verões).

## A app (Modo Visita, já implementado em `my-web-map`, commit c8d560c)

- **Ecrã:** mapa 3D em ecrã inteiro; barra discreta em baixo com os 5 passos (número, cor e forma); cada botão abre uma janela com a pergunta, uma frase simples, os controlos e um botão "Seguinte". O passo seguinte sugerido fica destacado. "Mais" (camadas e controlos técnicos) só aparece com `?tecnico` no endereço.
- **Regra 30-30-30 sempre à vista:** três mostradores (calor, ar seco, vento) com o tempo de agora do Pinhão; acendem quando passam o limite. No telemóvel fica só a frase-resumo.
- **Leitura:** A+ (3 tamanhos), alto contraste, tema claro/escuro, Ajuda. Letra Atkinson Hyperlegible.
- **Mapas (botão com as camadas, em qualquer passo):** cartões com miniatura para escolher o mapa a ver — risco e perigo (risco e perigo do estudo DouroRisk, perigo oficial ICNF 2025 e 2020–2030, quantas vezes ardeu) e o que ajuda o fogo (encostas inclinadas, encostas ao sol, quanto mato há) —, cada um com uma frase sobre o que mostra, a legenda logo a seguir (e também sobre o mapa), força da cor e "Mostrar só o concelho de Alijó" (ligado de início: os mapas que passam os limites do concelho ficam cortados pelo limite). "Comparar com outro mapa" divide o mapa com uma cortina: o escolhido a oeste, o outro a este. Mudar de passo termina a comparação.
- **Explorar (botão com a mira, em qualquer passo):** tocar no mapa dá os dados desse ponto (risco, perigo oficial, quantas vezes ardeu, encosta, sol, mato, altitude); carregar sem largar e arrastar desenha um círculo e dá os dados da área (hectares em campos de futebol, casas dentro, barras com as classes e frases). Arrastar sem carregar primeiro continua a mexer o mapa. Alternativa por teclado: "Ler o centro do mapa" com Ponto, 100 m, 250 m, 500 m ou 1 km. Também lê o **concelho todo** (297,8 km², 43 % já ardeu) ou **uma ou várias freguesias** (toca-se na freguesia no mapa ou escolhe-se na lista; "Todas" e "Nenhuma"). Nas áreas, as frases contam sobre a área toda e dizem quanto fica sem dados (aldeias, rio).
- **Olha:** 4 lugares em cartões com desenho (Santuário, Sanfins, Pinhão e o rio, todo o concelho), casas em 3D e nomes das terras, "Dar a volta".
- **Escolhe:** tocar no mapa para pôr 3 fichas numeradas (só dentro do concelho) ou "Pôr ficha no centro do mapa" pelo teclado; as fichas arrastam-se. Pistas que se somam: encosta muito inclinada, virada ao sol, muito mato, perigo alto no mapa oficial (ICNF); ligam-se várias e o mapa mostra quantas se juntam em cada sítio (cor, número e riscas a partir de 3). Ao pôr ou arrastar uma ficha, um termómetro diz quantas pistas há ali.
- **Guarda:** 3 caras de certeza, nome da turma opcional, código de 6 letras (SHA-256); as fichas ficam bloqueadas.
- **Compara:** só depois de guardar. "Revelar onde ardeu" passa uma cortina de oeste para este (ou arrasta-se a cortina); cada ficha ganha ✓ ou ✗ no mapa quando a cortina passa e o placar diz quantas caíram onde já ardeu. Mostra também o tempo de agora (IPMA/Open-Meteo) e a regra 30-30-30.
- **E se uma faísca caísse hoje?** (no passo 4): toca-se no mapa e o fogo anda durante alguns segundos, mais depressa onde o perigo oficial é alto, nas encostas inclinadas, ao sol e a favor do vento de agora (ou sem vento / vento forte). Diz para onde foi e quantos campos de futebol ardeu. É um modelo simplificado para aprender, não uma previsão.
- **Protege:** camada de risco 1–5; toca-se numa casa e aparece o anel de 50 m à volta. Ações em botões grandes (limpar 50 m, pastoreio, sem queimadas, 112, ponto de encontro); limpar e pastorear baixam o risco à volta da casa e o anel fica verde. "Passaram X anos" mostra o mato a voltar e o risco a subir outra vez (limpar é todos os anos). Frase "Eu vou…".
- **Quiosque:** `/mapa/?quiosque` no endereço (o antigo `/?quiosque` reencaminha para lá) — aviso de 20 s ao fim de 2 min sem uso e recomeço limpo; os atalhos para a apresentação ficam escondidos.
- **Camadas acessíveis:** `public/data/dourorisk/a11y/` (imagens na paleta oficial verde→vermelho, com alternativa segura para daltonismo em `--paleta segura`, + grelhas de classes), geradas por `scripts/pro_to_web.py` a partir dos rasters do ArcGIS Pro (manifest em `src/data/dourorisk-grids.json`).

## De onde vêm os números (projeto DOURORISK.aprx, concelho de Alijó, 297,6 km²)

| No painel | Valor real | Nota |
|---|---|---|
| 765 m a subir | do rio (80 m) ao alto do monte (845 m) no corte por Sanfins | MDT 25 m |
| Mais de 4 em cada 10 sítios já arderam | 43 % do concelho (12 845 ha) | recorrência 1990–2025 |
| 2017: mais de 5 600 campos | 4 028 ha com último fogo em 2017 | valor mínimo: zonas que voltaram a arder depois contam noutro ano |
| 2025: quase 1 000 campos | 686 ha | |
| 4 de 21 verões | modelo de exemplo só com declive e exposição, 20 % do território vigiado | não é o modelo da tese; contam só os verões de 2001–2025 com mais de 5 ha ardidos; nos outros 17 o mapa ficou abaixo do acaso |
| Em 10 anos o mato volta a quase metade | biomassa 18,7 em 40 aos 10 anos | contas do modelo de biomassa da tese (não é uma medição) |
| Ardeu 5 ou mais vezes | 829 ha no concelho | 16 ha arderam 9 vezes |

## Antes de imprimir

- Testar os protótipos em papel, à escala 1:1, com uma turma, pessoas idosas de Sanfins, pessoas cegas, surdas e com deficiência intelectual, e turistas.
- Pedir à AHBV autorização para usar o brasão e validar as ações de prevenção.
- Confirmar as regras de uso dos logótipos da FCT e do BPI | Fundação "la Caixa".
- Confirmar os direitos e o crédito da fotografia do Santuário.
- Pôr os códigos QR reais (áudio, LGP, EN/ES/FR) e o botão físico de áudio.
- Confirmar onde fica o Centro Interpretativo, para acrescentar o "Estás aqui".
- Pedir a validação da Leitura Fácil por pessoas com deficiência intelectual.
- Decidir se o "4 de 21" deve usar o modelo completo da tese, quando houver perímetros anuais ICNF.
