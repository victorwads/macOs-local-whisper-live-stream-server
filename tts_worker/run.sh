#!/bin/bash
set -e

# Enter the directory where the script is located
cd "$(dirname "$0")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}--- Narrador XTTS v2 ---${NC}"

# Check for venv
if [ ! -d "tts_env" ]; then
    echo -e "${RED}Error: Environment 'tts_env' not found.${NC}"
    echo "Please run ./install.sh first."
    exit 1
fi

# AUTOMATION: Convert voice_raw.m4a to voice.wav if it exists
if [ -f "voice_raw.m4a" ]; then
    echo -e "${YELLOW}🎙️  Found voice_raw.m4a. Converting to proper WAV format...${NC}"
    ffmpeg -y -i voice_raw.m4a -ac 1 -ar 16000 -c:a pcm_s16le voice.wav > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Conversion successful! Using new voice.wav reference.${NC}"
    else
        echo -e "${RED}❌ Error converting m4a to wav.${NC}"
        exit 1
    fi
fi

# Check for voice reference
if [ ! -f "voice.wav" ]; then
    echo -e "${RED}❌ ERRO: Arquivo 'voice.wav' não encontrado.${NC}"
    echo -e "${YELLOW}Ação necessária:${NC}"
    echo "1. Grave um áudio seu de 20-60 segundos (limpo, natural)."
    echo "2. Salve como 'voice.wav' nesta pasta: $(pwd)"
    echo "3. Execute este script novamente."
    exit 1
fi

# Check for input text
INPUT_FILE="historia.txt"
if [ ! -z "$1" ]; then
    INPUT_FILE="$1"
fi

if [ ! -f "input/$INPUT_FILE" ]; then
    echo -e "${RED}Error: input/$INPUT_FILE not found.${NC}"
    exit 1
fi

# Activate environment
source tts_env/bin/activate

# Auto-agree to Coqui TOS
export COQUI_TOS_AGREED=1

# Enable PyTorch MPS Fallback for Mac
export PYTORCH_ENABLE_MPS_FALLBACK=1

# Run Python script
python process_text.py "$INPUT_FILE"
