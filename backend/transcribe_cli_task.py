
import os
import sys
import subprocess
from pathlib import Path

# Add backend to path so we can import modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from cpp_model import download_cpp_model
from whisper_cpp import WhisperCppEngine

def convert_to_wav16(input_path: str, output_path: str):
    print(f"Converting {input_path} to {output_path}...")
    # -ar 16000: set sample rate to 16kHz
    # -ac 1: set audio channels to 1 (mono)
    # -c:a pcm_s16le: set audio codec to PCM 16-bit little endian
    subprocess.run(
        ["ffmpeg", "-y", "-i", input_path, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", output_path],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )

def main():
    # 1. Configuration
    model_size = "large-v3-turbo-q5_0"
    downloads_dir = os.path.expanduser("~/Downloads")
    
    # 2. Find latest file
    try:
        # Get all files, filter out hidden files and non-audio extensions if possible, but mainly hidden
        all_files = [os.path.join(downloads_dir, f) for f in os.listdir(downloads_dir)]
        valid_files = []
        for f in all_files:
            if not os.path.isfile(f):
                continue
            filename = os.path.basename(f)
            if filename.startswith("."):
                continue
            # Basic audio/video extension filter to avoid picking up random binary files
            if not filename.lower().endswith(('.m4a', '.mp3', '.wav', '.mp4', '.mov', '.mk4', '.ogg')):
                continue
            valid_files.append(f)
            
        if not valid_files:
            print("No audio/video files found in Downloads.")
            return
        
        latest_file = max(valid_files, key=os.path.getctime)
        print(f"File to transcribe: {latest_file}")
    except Exception as e:
        print(f"Error finding latest file: {e}")
        return

    # 3. Ensure model exists
    print(f"Ensuring model {model_size} is downloaded...")
    try:
        download_cpp_model(model_size)
    except Exception as e:
        print(f"Error downloading model: {e}")
        return

    # 4. Convert audio
    wav_path = "temp_transcription.wav"
    try:
        convert_to_wav16(latest_file, wav_path)
    except Exception as e:
        print(f"Error converting file (ffmpeg required): {e}")
        return

    # 5. Transcribe
    print("Starting transcription... (this may take a while for large files)")
    try:
        # Usando o binário direto para garantir que o arquivo .txt seja salvo corretamente
        # e para mostrar o progresso real no terminal.
        whisper_bin = os.path.abspath("backend/whisper.cpp/build/bin/whisper-cli")
        if not os.path.exists(whisper_bin):
             whisper_bin = os.path.abspath("backend/whisper.cpp/build/bin/main")
        
        model_path = os.path.abspath(f"backend/models/cpp/ggml-{model_size}.bin")
        
        if not os.path.exists(whisper_bin):
            print(f"Error: Whisper binary not found at {whisper_bin}")
            return

        cmd = [
            whisper_bin,
            "-m", model_path,
            "-f", wav_path,
            "-l", "auto",
            "-otxt",           
            "-of", str(latest_file), 
            "--print-colors"   
        ]
        
        print(f"Running command: {' '.join(cmd)}")
        # Allow stderr/stdout to pass through directly
        result_proc = subprocess.run(cmd)
        
        if result_proc.returncode != 0:
            print(f"Error: Whisper failed with code {result_proc.returncode}")
            return
        
        output_txt = f"{latest_file}.txt"
        if os.path.exists(output_txt):
            print(f"\n✅ Transcription saved successfully to:\n{output_txt}")
        else:
            print(f"\n⚠️ Warning: Could not verify if {output_txt} was created.")

    except subprocess.CalledProcessError as e:
        print(f"Error during transcription process: {e}")
    except Exception as e:
        print(f"Unexpected error: {e}")
    finally:
        if os.path.exists(wav_path):
            os.remove(wav_path)

if __name__ == "__main__":
    main()
