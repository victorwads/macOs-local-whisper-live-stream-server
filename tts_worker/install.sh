#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo -e "${GREEN}--- Setup TTS Environment ---${NC}"

# 1. Create venv if not exists
if [ ! -d "tts_env" ]; then
    echo "Creating virtual environment 'tts_env'..."
    /usr/local/bin/python3.11 -m venv tts_env
else
    echo "Virtual environment already exists."
fi

# 2. Activate
source tts_env/bin/activate

# 3. Upgrade pip
echo "Upgrading pip..."
pip install --upgrade pip

# 4. Install dependencies
echo "Installing TTS library (this may take a while)..."
# Installing TTS and specifically torch for Mac performance if needed
# But standard pip install TTS usually grabs a compatible torch
pip install TTS

echo -e "${GREEN}Setup Complete!${NC}"
echo "You can now run: ./run.sh"
