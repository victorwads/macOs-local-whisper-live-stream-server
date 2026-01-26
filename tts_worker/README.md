# Clone de Voz TTS Local (XTTS v2)

Este projeto usa a IA **Coqui XTTS v2** para narrar textos longos usando uma amostra da sua própria voz, rodando 100% offline no seu Mac.

## 📂 Estrutura

- `input/historia.txt`: O texto que será narrado.
- `output/`: Onde o áudio final será salvo.
- `voice.wav`: **(VOCÊ PRECISA CRIAR)** Sua amostra de voz.
- `process_text.py`: O cérebro que divide o texto e gera o áudio.

## 🚀 Como usar

### 1. Instalação
Rode o script de instalação para criar o ambiente virtual e instalar as bibliotecas de IA (pode demorar alguns minutos):
```bash
./install.sh
```

### 2. Preparar a Voz
Grave um áudio de **20 a 60 segundos** com o Gravador de Voz ou QuickTime.
- **Dica:** Fale pausadamente, com a entonação que você quer na história. Use um bom microfone se possível.
- **Exportar:** Salve como `voice.wav` (formato WAV) na raiz desta pasta `tts_worker`.

### 3. Rodar a Narração
```bash
./run.sh
```

O script vai:
1. Ler o `input/historia.txt`.
2. Dividir em parágrafos.
3. Gerar o áudio para cada parágrafo (salvo em `output/temp/`).
4. Juntar tudo em um arquivo final `output/audiobook.wav`.

**Nota:** Se o processo for interrompido, rode novamente. Ele pula os pedaços que já foram gerados!

### ⚙️ Performance no Mac
O script tenta detectar automaticamente se você tem um chip Apple Silicon (M1/M2/M3) e usa a aceleração `mps` (Metal Performance Shaders). Se não, ele usa a CPU (que é mais lenta, mas funciona).
