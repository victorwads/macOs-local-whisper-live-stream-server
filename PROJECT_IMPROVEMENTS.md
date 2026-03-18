# Melhorias do Projeto (`whisperLocalApp`)

Este documento consolida ideias extraídas da transcrição, priorizando melhorias de produto/UX, performance e confiabilidade para uso real no dia a dia.

## 1. Experiência de Transcrição

### 1.1 Marcadores de contexto ("voltas")
- Ideia: Permitir inserir um marcador visual durante a transcrição ao vivo, como uma "volta" de cronômetro.
- Descrição: Adicionar um botão (ex.: `Marcar Assunto`) que injeta uma linha separadora no feed (ex.: `----- Assunto N -----`). Isso ajuda a delimitar blocos de raciocínio e facilita revisão posterior.

### 1.2 Timestamp por linha transcrita
- Ideia: Exibir data/hora em cada linha final transcrita.
- Descrição: Cada item em `finalTranscript` deve incluir horário local (HH:mm:ss) e opcionalmente data. Isso melhora rastreabilidade e leitura histórica.

### 1.3 Exportar transcrição para TXT
- Ideia: Botão para baixar o conteúdo da sessão atual.
- Descrição: Adicionar ação `Baixar TXT` que exporta linhas finais + timestamps + marcadores, mantendo um formato simples para uso externo.

### 1.4 Persistência local do histórico
- Ideia: Salvar automaticamente transcrições no navegador.
- Descrição: Persistir sessões em `localStorage` (rápido) ou `IndexedDB` (mais robusto), com metadados (início/fim, modelo, idioma, configs). Permitir recuperar sessões antigas.

### 1.5 Modo Start/Pause
- Ideia: Além de Start/Stop, ter pausa sem perder contexto da sessão.
- Descrição: `Pause` interrompe captura/envio temporariamente e `Resume` retoma. Útil para não encerrar a sessão inteira quando houver interrupções rápidas.

### 1.6 Copiar última lap
- Ideia: Ter ação rápida para copiar o conteúdo textual da última lap.
- Descrição: Adicionar botão/link no cabeçalho de `Live Transcription` para copiar ao clipboard todas as linhas da última lap, sem timestamps nem metadados visuais.

## 2. Clareza de Controles (UX de Configuração)

### 2.1 Explicar melhor cada parâmetro
- Ideia: Tornar `Min Silence`, `Min Speak`, `Min Audio` e `Partial Interval` mais autoexplicativos.
- Descrição: Melhorar labels/tooltips com linguagem prática e exemplo real de impacto (latência, contexto e uso de GPU), reduzindo confusão durante ajustes.

### 2.2 Presets por perfil de uso
- Ideia: Oferecer presets prontos (ex.: `Baixa GPU`, `Tempo Real`, `Equilibrado`).
- Descrição: Presets ajustam vários parâmetros em conjunto, evitando tuning manual excessivo e acelerando onboarding.

### 2.3 Painel de diagnóstico de efetividade
- Ideia: Mostrar quando parâmetros estão inconsistentes.
- Descrição: Exibir avisos de validação, como:
  - `Partial Interval` muito baixo para o tempo médio de processamento.
  - Configuração com alto risco de enfileiramento.
  - Threshold/silêncio potencialmente agressivos.

### 2.4 Expor `Max Audio` nas configurações
- Ideia: Tornar configurável no frontend o limite máximo de duração por segmento.
- Descrição: Hoje existe limite técnico de ~10s no backend; expor esse parâmetro na UI melhora previsibilidade do comportamento e permite ajuste por perfil de máquina/modelo.

## 3. Performance e Custo de GPU

### 3.1 Intervalo parcial adaptativo (dinâmico)
- Ideia: Tornar o `partial interval` inteligente ao invés de fixo.
- Descrição: Começar com intervalo curto no início da fala e aumentar progressivamente conforme o segmento cresce ou conforme latência do backend sobe. Reduz retrabalho e picos de GPU.

### 3.2 Controle por feedback de fila/latência
- Ideia: Usar telemetria de processamento para autoajuste.
- Descrição: Se `processing_time` aproximar ou ultrapassar `partial_interval`, aumentar o intervalo automaticamente até estabilizar. Quando aliviar, reduzir gradualmente.

### 3.3 Modo "sem parcial"
- Ideia: Opção explícita de não gerar parciais.
- Descrição: Permitir `partial_interval = off` para processar só finais (por silêncio/flush), focando economia de recurso.

### 3.4 Recomendações por modelo
- Ideia: Ajustes iniciais diferentes para `tiny/base/small/medium/large`.
- Descrição: Modelos menores precisam mais contexto para qualidade; o app pode sugerir/autoaplicar janelas e tempos adequados por modelo selecionado.

### 3.5 Pipeline de dois estágios (Tiny parcial + modelo final)
- Ideia: Processar parciais com `tiny` e finais com modelo de maior qualidade (`small/medium/large-v3`).
- Descrição: O `tiny` entrega latência muito baixa para sensação de tempo real, enquanto o modelo maior é usado apenas no fechamento de segmento para melhorar precisão final.

### 3.6 Pré-carga e manutenção de modelos em memória
- Ideia: Manter dois modelos residentes para evitar custo de troca durante sessão.
- Descrição: Carregar `tiny` + modelo final no início (quando viável em RAM/GPU). Se não houver memória suficiente, aplicar fallback para modo de modelo único com aviso ao usuário.

### 3.7 Estratégia de idioma para modelos pequenos
- Ideia: Reduzir tendência de modelos pequenos caírem para inglês com pouco contexto.
- Descrição: Forçar idioma configurado quando definido pelo usuário (ex.: `pt`) nas parciais do `tiny`, evitando auto-detecção prematura em contexto curto.

### 3.8 Janela mínima de contexto por modelo
- Ideia: Definir limites mínimos de áudio por modelo antes de considerar saída estável.
- Descrição: Exigir mais contexto para `tiny/small` antes de exibir parcial “forte”, e permitir menor contexto para `large-v3`, refletindo diferenças reais de precisão.

### 3.9 Prescrição de `partial interval` por latência observada
- Ideia: Ajustar `partial interval` de acordo com a latência típica do modelo ativo.
- Descrição: Exemplo observado: `tiny` em ~80ms suporta intervalo mais curto; `small` em ~200–300ms tende a ficar mais estável com intervalo mais alto (ex.: ~400ms), reduzindo fila e custo.

## 4. Confiabilidade de Captura

### 4.1 Não perder frases curtas
- Ideia: Melhorar detecção de falas muito rápidas ("oi", "ai", reações curtas).
- Descrição: Refinar interplay entre `minSpeak`, `minSilence` e limiar de VAD, com testes para eventos sub-1s sem elevar falsos positivos.

### 4.2 Indicadores de estado mais fiéis
- Ideia: Garantir que indicador de silêncio/fala reflita comportamento real.
- Descrição: Revisar a lógica de `isSilent/isSpeech` e os textos de status para reduzir discrepância percebida pelo usuário durante fala ativa.

## 5. Ajustes Técnicos Observados (Backlog de Engenharia)

### 5.1 Revisar uso de `minSeconds` no frontend
- Ideia: Corrigir possível inconsistência entre UI e parâmetro enviado ao backend.
- Descrição: Hoje o app envia `min_seconds` com `Math.min(0.5, window)`, enquanto existe `minSeconds` no estado/UI. Isso pode causar percepção de "Min Audio não funciona". Priorizar correção e alinhamento semântico.

### 5.2 Documentação operacional do tuning
- Ideia: Criar guia curto de tuning por objetivo.
- Descrição: Um `README`/`TUNING.md` com combinações recomendadas para: `maior qualidade`, `menor GPU`, `mais responsivo`, `fala curta`.

### 5.3 Benchmark por hardware (desktop vs celular)
- Ideia: Medir comportamento real por classe de dispositivo.
- Descrição: Criar matriz de benchmark (latência, uso de GPU, precisão) por modelo e por configuração para evitar assumir que desempenho em GPU desktop se replica em mobile.

### 5.4 Telemetria de qualidade por estágio
- Ideia: Comparar parcial e final para quantificar ganho do pipeline em dois estágios.
- Descrição: Registrar diferença entre texto parcial (`tiny`) e final (`modelo principal`) para calibrar thresholds e decidir quando vale atualizar o parcial com menor frequência.

### 5.5 Parametrizar limite máximo de segmento no backend
- Ideia: Transformar o limite fixo de 10s em configuração explícita.
- Descrição: Substituir constante rígida por valor configurável (com default seguro), mantendo proteção contra segmentos longos demais e dando transparência para tuning avançado.

## 6. Itens Citados Que Parecem de Outro Projeto (Golden Unicorn)

### 6.1 Visualização de duplicados na importação
- Ideia: Melhorar UI para mostrar registro original/duplicado de forma compreensível.
- Descrição: Sugestão citada: usar mesmo componente da timeline em subnível expansível para comparar itens sem poluir interface.

### 6.2 Persistência de estado de tela na navegação
- Ideia: Manter estado da tela de importação ao navegar para outras telas.
- Descrição: Limpar estado apenas em ações explícitas (`Cancelar`/`Importar`), evitando perda de contexto do usuário.

> Observação: os itens desta seção parecem fora do escopo direto do `whisperLocalApp`, mas foram mantidos como referência da transcrição.

## 7. Evolução de Arquitetura de Áudio (novo backlog de produto)

### 7.1 Processar arquivo gravado com feedback em tempo quase real
- Ideia: Suportar upload de áudio pronto e transcrever progressivamente o mais rápido possível.
- Descrição: Manter experiência semelhante ao modo microfone (atualizações contínuas de transcrição), porém em pipeline acelerado para arquivo local.

### 7.2 Salvar áudio completo (não só pedaços)
- Ideia: Em `Start Microfone` e em `Processar Arquivo`, persistir o arquivo inteiro no storage local.
- Descrição: Trocar o modelo centrado em múltiplos blobs por sessão para um modelo com 1 ativo de áudio por sessão, em formato recuperável após refresh (`F5`) e retomada de estado.

### 7.3 IndexedDB com segmentos por intervalo temporal
- Ideia: Em vez de salvar o nome de cada chunk de áudio, salvar metadados temporais.
- Descrição: Para cada segmento, persistir no `IndexedDB`: `start_ms`, `end_ms`, tipo (`speech`/`silence`), texto transcrito, estado de processamento e confiança opcional.

### 7.4 Player baseado em `seek` no áudio único
- Ideia: Reproduzir trechos transcritos usando `seek` no arquivo completo.
- Descrição: Trocar playback de “pedaço físico” por reprodução da faixa única com posição inicial/final do segmento. Isso simplifica navegação, reduz complexidade de storage e melhora consistência.

### 7.5 Reprocessar apenas trecho com erro
- Ideia: Permitir reprocessamento granular de um segmento específico.
- Descrição: Quando uma transcrição sair errada (corte ruim de silêncio, perda de fala, VAD falho), o usuário pode pedir novo processamento só daquele intervalo, sem reprocessar o arquivo inteiro.

### 7.6 Garantir retenção de todo o conteúdo de áudio
- Ideia: Não depender de decisão do VAD para preservar dados brutos.
- Descrição: Mesmo se o VAD não marcar uma fala corretamente, o áudio original permanece completo para auditoria, replay e reprocessamento futuro.

### 7.7 Feature de reprodução `Skip Silence`
- Ideia: Ao ouvir a sessão, permitir pular automaticamente segmentos marcados como silêncio.
- Descrição: Adicionar toggle `Skip Silence` no player. Quando ativo, ao entrar em segmento `silence`, o player salta para o próximo `speech`, reduzindo drasticamente tempo de escuta em gravações longas.

### 7.8 Reexportar áudio sem silêncio
- Ideia: Gerar novo arquivo final removendo intervalos classificados como `silence`.
- Descrição: Adicionar ação `Exportar sem silêncio` usando o mapa de segmentos (`speech`/`silence`) para concatenar só trechos falados em ordem, com opção de margem pequena configurável para evitar cortes secos.

### 7.9 Edição de segmentos no Live Transcription (modo editor)
- Ideia: Evoluir o feed de linhas para um editor simples de segmentos.
- Descrição: Cada linha deve permitir `Editar` (início/fim), `Reprocessar` e `Mesclar`, com preview curto do áudio do intervalo para validação rápida antes de salvar.

### 7.10 Mesclar duas (ou mais) linhas em um único segmento
- Ideia: Selecionar segmentos contíguos e transformar em um só registro.
- Descrição: Exemplo: unir `1s..2s` + `2s..3s` em `1s..3s`, com atualização no `IndexedDB` e opção de reprocessamento imediato do intervalo combinado.

### 7.11 Ajuste manual fino de borda temporal
- Ideia: Expandir/reduzir começo e fim de um segmento (ex.: `-0.5s`, `+0.5s` ou valor livre).
- Descrição: Permitir edição do `start_ms/end_ms` sem obrigar reprocessamento. Depois o usuário decide se mantém texto atual ou dispara novo processamento daquele intervalo.

### 7.12 Regra de consistência com vizinhos (anterior/próximo)
- Ideia: Ao editar um segmento, manter timeline consistente sem overlap inválido.
- Descrição: Mudança de borda em um segmento deve ajustar segmentos adjacentes (`speech`/`silence`) quando necessário. Se houver colisão, aplicar regra explícita (ex.: priorizar segmento editado e recalcular vizinhos).

### 7.13 Índice de ordenação para operações de edição
- Ideia: Garantir acesso rápido a anterior/próximo por ordem temporal.
- Descrição: Persistir `chunk_index` e/ou índice por `start_ms` no `IndexedDB` para facilitar merge, split, ajuste de bordas e validações transacionais no editor.

### 7.14 Reprocessamento seletivo por qualidade/custo
- Ideia: Transcrever tudo com modelo mais barato e melhorar só trechos ruins com modelo superior.
- Descrição: Permitir escolha de modelo por trecho no reprocessamento (ex.: base/tiny para bulk e modelo maior para correção pontual), reduzindo custo total mantendo qualidade final.

### 7.15 Testes unitários para regras de timeline e edição
- Ideia: Cobrir cenários críticos de transformação de segmentos.
- Descrição: Criar suíte para `merge`, ajuste de `start/end`, atualização de vizinhos, detecção de overlaps, export sem silêncio e invariantes de ordenação/continuidade da timeline.

## Priorização sugerida (curto prazo)
1. Timestamp por linha + marcador de assunto + exportar TXT.
2. Correção de `minSeconds` e melhoria de textos/tooltips dos controles.
3. Salvar áudio completo por sessão + metadados de segmentos (`start/end`) no `IndexedDB`.
4. Playback por `seek` no áudio único + toggle `Skip Silence`.
5. Reprocessamento de trecho específico + merge/edição de bordas + recuperação robusta após `F5`.
6. Exportar áudio sem silêncio + testes unitários da timeline/edição.

## 8. Arquitetura V2 (TypeScript + Vanilla + SDK)

### 8.1 Novo app em pasta isolada (`App V2`)
- Ideia: Congelar implementação atual e iniciar reescrita limpa sem risco de regressão no app legado.
- Descrição: Criar app independente com build próprio e evolução incremental por fases.

### 8.2 Frontend sem framework de estado
- Ideia: Manter UI em Vanilla JS com tipagem TypeScript.
- Descrição: Evitar complexidade de React/gerenciadores globais para facilitar ajustes finos de UX e lógica de edição temporal.

### 8.3 Pipeline TypeScript simples (strip types + ES modules)
- Ideia: Transpilação mínima, estrutura de arquivos previsível e sem minificação.
- Descrição: Emitir JS modular com sourcemaps em desenvolvimento e produção para debug aberto (projeto OSS).

### 8.4 Separação de responsabilidades: App vs Engine/SDK
- Ideia: Isolar lógica de VAD/transcrição/processamento em módulos reaproveitáveis.
- Descrição: Estruturar para futura extração de pacote npm de processamento, consumível por múltiplos frontends.

### 8.5 Modelo de domínio da V2
- Ideia: Evoluir de `lap` para `chapter` e introduzir `transcription session` como unidade principal.
- Descrição: Modelos base esperados na V2:
  - `TranscriptionSession`: sessão de microfone ou arquivo, com metadados e estado.
  - `Chapter`: agrupador temporal e semântico dentro da sessão.
  - `TranscriptionSegment` / `LiveTranscriptionRow`: linha temporal com `speech`/`silence`/`chapter`, `start/end`, ordenação e metadados de processamento.

### 8.6 UX de app orientado a sessões
- Ideia: Transformar o produto em uma biblioteca de transcrições, não apenas feed único em tela.
- Descrição: Lista de sessões, entrada por sessão específica, filtro por capítulos e operações de edição/reprocessamento por segmento.
