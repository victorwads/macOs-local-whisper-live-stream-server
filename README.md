# 🎙️ macOS Local Whisper Live Stream Server

**Real-time, private, and local speech-to-text transcription running entirely on your machine.**

Whisper Local Live is a lightweight web application that brings the power of OpenAI's Whisper models directly to your computer. No cloud APIs, no subscription costs, and complete privacy for your voice data.

## 🚀 Why this project?

We wanted a simple, efficient way to transcribe audio in real-time without sending data to third-party servers. Whether you are dictating notes, testing voice commands, or just exploring AI speech recognition, this project provides a low-latency playground that runs locally.

It uses **faster-whisper** and **whisper.cpp** under the hood to ensure high performance, specifically optimized for **macOS Apple Silicon (Metal)**.

## ✨ Features

- **🔒 100% Local & Private:** Your audio never leaves your computer.
- **⚡ Real-time Streaming:** Transcribes as you speak.
- **🧠 Smart VAD (Voice Activity Detection):** Automatically detects when you start and stop speaking to segment audio efficiently.
- **🎛️ Customizable:** Adjust silence thresholds, speech duration, and model sizes directly from the UI.
- **📝 Live Logs:** Visual feedback of audio levels and processing status.

## 💻 Compatibility

> **🍎 macOS Only:** This project is designed and tested primarily for **macOS**.
> It leverages **Apple Silicon (M1/M2/M3)** GPU acceleration via Metal for efficient processing. While the underlying Python code is cross-platform, the installation scripts and optimizations are tailored for the Mac ecosystem.

## 🛠️ Getting Started

Follow these simple steps to get up and running.

### Prerequisites & System Requirements
- **Python 3.8+**
- **Node.js** (required to run the local frontend server via `npx`)
- **Disk Space:** You will need at least **5GB of free space**.
    - ~500MB for dependencies (Python packages, `whisper.cpp` compilation).
    - ~3GB to 5GB for the AI Models (e.g., `large-v3` is approx 3GB, `medium` is 1.5GB).

### 1. Setup the Backend
The backend handles the heavy lifting (AI processing). We have a script that sets up the environment and downloads the necessary models.

**What the install script does:**
1. Creates a Python virtual environment and installs dependencies.
2. Checks for `ffmpeg` and installs it via Homebrew if missing.
3. Clones and compiles `whisper.cpp` with **Metal (GPU) support**.
4. Downloads the default Whisper model.

```bash
cd backend
# Give execution permissions
chmod +x install.sh run.sh

# Install dependencies and setup environment
./install.sh
```

### 2. Run the Server
Start the transcription engine:

```bash
./run.sh
```
*Keep this terminal window open.*

### 3. Launch the Frontend
Because modern browsers require secure contexts (HTTPS or localhost) to access the microphone, we need to serve the web app properly.

Open a **new terminal window**:

```bash
cd app
npx serve
```

Click the `localhost` link provided by `npx` (usually `http://localhost:3000`), allow microphone access, and click **Start Mic**!

## ⚙️ How it Works

1.  **Capture:** The web interface captures your microphone audio using the browser's Audio API.
2.  **Analyze:** It monitors volume levels in real-time to detect when you are speaking versus when you are silent.
3.  **Stream:** When speech is detected, raw audio data is streamed instantly to the local Python backend via WebSockets.
4.  **Transcribe:** The backend processes the audio using the Whisper model and sends the text back to your screen.

## 💡 The Story Behind the Project

This project was born out of a specific need for another application I am developing: **[Golden Unicorn Finance Control](https://github.com/victorwads/GolderUnicornFinanceControl)**.

I was looking for a cost-effective, low-latency solution to enable voice commands for my financial app. Instead of paying for expensive cloud APIs, I realized I could host this on my own Mac (M3 Max) for my initial user base. The resource consumption is surprisingly low on Apple Silicon, allowing me to expose this API to my first ~10 clients without any hiccups.

**The Future Vision:**
While it runs on my "macbook server" now, the long-term goal is to run these models (which can be as small as 500MB) natively on mobile devices (Android/iOS). This will enable a fully voice-controlled interface where an LLM interprets speech to perform actions on the screen in real-time.

## 📄 License

This project is open-source and available for everyone. Feel free to fork, modify, and improve it!
