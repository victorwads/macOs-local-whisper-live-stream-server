
import os
import subprocess
from TTS.api import TTS

# Setup
raw_audio = "voice_raw.m4a"
test_text = "Esta é a minha voz clonada. Estou testando qual amostra fica mais parecida comigo."
model_name = "tts_models/multilingual/multi-dataset/xtts_v2"
output_dir = "test_samples"

os.makedirs(output_dir, exist_ok=True)

# 1. Create 3 slices of the audio (Start, Middle, Custom Clean)
print("✂️  Fatiando áudios de referência...")

# Slice 1: 00:02 to 00:09 (7 seconds)
subprocess.run(
    ["ffmpeg", "-y", "-i", raw_audio, "-ss", "00:00:02", "-t", "7", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", f"{output_dir}/ref_1_inicio.wav"],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
)

# Slice 2: 00:10 to 00:17 (7 seconds)
subprocess.run(
    ["ffmpeg", "-y", "-i", raw_audio, "-ss", "00:00:10", "-t", "7", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", f"{output_dir}/ref_2_meio.wav"],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
)

# Slice 3: 00:02 to 00:12 (10 seconds with HighPass filter to remove rumble)
subprocess.run(
    ["ffmpeg", "-y", "-i", raw_audio, "-ss", "00:00:02", "-t", "10", "-af", "highpass=f=100", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", f"{output_dir}/ref_3_limpo.wav"],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
)

# 2. Load Model
print("⏳ Carregando modelo...")
tts = TTS(model_name=model_name, progress_bar=False).to("mps") # Mac GPU

# 3. Generate Tests
print("🎙️  Gerando testes...")

refs = ["ref_1_inicio.wav", "ref_2_meio.wav", "ref_3_limpo.wav"]

for ref in refs:
    ref_path = os.path.join(output_dir, ref)
    out_path = os.path.join(output_dir, f"resultado_usando_{ref}")
    
    if not os.path.exists(ref_path):
        print(f"Skipping {ref} (not found)")
        continue
        
    print(f"   -> Gerando com {ref}...")
    tts.tts_to_file(
        text=test_text,
        speaker_wav=ref_path,
        language="pt",
        file_path=out_path,
        speed=1.0
    )

print("\n✅ Pronto! Ouça os arquivos na pasta 'tts_worker/test_samples'")
print("Quando escolher o melhor, renomeie ele para 'voice.wav' na pasta tts_worker.")
