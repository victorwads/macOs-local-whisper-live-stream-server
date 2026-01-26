import os
import sys
import torch
from TTS.api import TTS
import subprocess

# Configutation of paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Default to historia.txt, but allow override via command line arg
input_filename = "historia.txt"
if len(sys.argv) > 1:
    input_filename = sys.argv[1]

INPUT_FILE = os.path.join(BASE_DIR, "input", input_filename)
OUTPUT_DIR = os.path.join(BASE_DIR, "output")
TEMP_DIR = os.path.join(OUTPUT_DIR, "temp")
FINAL_OUTPUT = os.path.join(OUTPUT_DIR, "audiobook.wav")
VOICE_REF = os.path.join(BASE_DIR, "voice.wav")
MODEL_NAME = "tts_models/multilingual/multi-dataset/xtts_v2"
LANGUAGE = "pt"

def clean_text(text):
    """Basic text cleanup."""
    return text.strip()

def main():
    print("--- Local TTS Worker (Coqui XTTS v2) ---")
    
    # 1. Checks
    if not os.path.exists(VOICE_REF):
        print(f"❌ Error: Reference audio '{VOICE_REF}' not found.")
        print("   -> Please record a 20s reference audio (wav mono) and save it as 'voice.wav' in the tts_worker folder.")
        sys.exit(1)

    if not os.path.exists(INPUT_FILE):
        print(f"❌ Error: Input text '{INPUT_FILE}' not found.")
        sys.exit(1)
        
    os.makedirs(TEMP_DIR, exist_ok=True)

    # 2. Load Model
    # Mac Metal/MPS support check
    device = "cpu"
    if torch.backends.mps.is_available():
        device = "mps"
        print("✅ MPS (Metal/GPU) detected. Using GPU acceleration.")
    elif torch.cuda.is_available():
        device = "cuda"
        print("✅ CUDA detected. Using GPU acceleration.")
    else:
        print("⚠️  No GPU detected. Running on CPU (will be slower).")

    print(f"⏳ Loading XTTS model '{MODEL_NAME}' on {device}...")
    # Using gpu=True automatically picks best available if device not explicitly passed to init
    # But explicitly sending .to(device) is safer for TTS API wrapper
    try:
        tts = TTS(model_name=MODEL_NAME, progress_bar=True).to(device)
    except Exception as e:
        print(f"Error loading model: {e}")
        return

    # 3. Read Text
    print(f"📖 Reading text from {INPUT_FILE}...")
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        full_text = f.read()

    # 4. Chunking Strategy
    # Using triple newlines primarily (paragraphs) as requested
    paragraphs = full_text.split("\n\n\n")
    # Clean and filter
    paragraphs = [clean_text(p) for p in paragraphs if clean_text(p)]
    
    # If a paragraph is too long (> 250 chars), XTTS might struggle or hallucinate.
    # XTTS v2 is decent with long sentences but safer to split huge blocks.
    # For now, we trust the model's internal splitter for sentences, 
    # but strictly feed it one paragraph at a time.
    
    print(f"📊 Found {len(paragraphs)} blocks to process.")
    print("---------------------------------------------------")

    valid_audio_files = []

    # 5. Inference Loop
    for i, text_block in enumerate(paragraphs):
        # Create a safe filename
        output_filename = f"part_{i:04d}.wav"
        output_path = os.path.join(TEMP_DIR, output_filename)
        
        # Check if already done (Resume capability)
        if os.path.exists(output_path):
            print(f"[{i+1}/{len(paragraphs)}] Skipping (Exists): {output_filename}")
            valid_audio_files.append(output_path)
            continue

        print(f"[{i+1}/{len(paragraphs)}] Generated audio for block: {output_filename}")
        print(f"   Excerpt: {text_block[:60]}...")
        
        try:
            # Run inference
            # tts_to_file handles generation and saving
            # SPEED CONTROL: 1.0 is normal. Higher (e.g. 1.2) is faster. Lower (e.g. 0.8) is slower.
            # DRAMA/EMOTION: Controlled by 'temperature'.
            #   - 0.1: Robotic, stable, boring.
            #   - 0.7-0.8: Expressive, dramatic, varying.
            #   - >1.0: Chaotic, slurring, "drunk".
            tts.tts_to_file(
                text=text_block,
                speaker_wav=VOICE_REF,
                language=LANGUAGE,
                file_path=output_path,
                split_sentences=True,
                speed=1.0,
                temperature=0.8,  # Increased for more drama/intonation
                repetition_penalty=5.0  # Helps avoid stuttering on dramatic pauses
            )
            valid_audio_files.append(output_path)
        except Exception as e:
            print(f"❌ Error generating block {i}: {e}")
            # Don't stop the whole process, try next
            continue

    # 6. Concatenate using ffmpeg
    if not valid_audio_files:
        print("❌ No audio files were generated successfully.")
        return

    print("---------------------------------------------------")
    print("🔗 Concatenating audio files...")
    
    # Generate list file for ffmpeg
    list_file_path = os.path.join(TEMP_DIR, "concat_list.txt")
    with open(list_file_path, "w", encoding="utf-8") as f:
        for audio_file in valid_audio_files:
            # ffmpeg concat requires 'file 'path'' format
            # Using absolute paths is safest
            abs_path = os.path.abspath(audio_file)
            f.write(f"file '{abs_path}'\n")

    try:
        cmd = [
            "ffmpeg",
            "-y",               # Overwrite
            "-f", "concat",     # Format concat
            "-safe", "0",       # Allow unsafe paths (absolute paths)
            "-i", list_file_path,
            "-c", "copy",       # Stream copy (no re-encoding, extremely fast)
            FINAL_OUTPUT
        ]
        
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        
        print(f"🎉 Success! Full audiobook saved at:")
        print(f"   -> {FINAL_OUTPUT}")
        
    except subprocess.CalledProcessError as e:
        print(f"❌ Error during concatenation: {e}")

if __name__ == "__main__":
    main()
