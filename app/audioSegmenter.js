export class AudioSegmenter {
  constructor(config) {
    this.sampleRate = 16000;
    this.preRollMs = config.minSpeak || 200; // Use minSpeak as pre-roll duration or separate config
    this.postRollMs = config.minSilence || 1000; // Post-roll is effectively the silence wait time
    
    this.isRecording = false;
    this.chunks = [];
    this.preRollBuffer = []; // Array of Float32Arrays
    
    this.listeners = {
      segmentReady: [],
      chunkReady: []
    };
  }

  updateConfig(key, value) {
    if (key === 'minSpeak') this.preRollMs = value;
    if (key === 'minSilence') this.postRollMs = value;
  }

  // Called continuously with new audio data
  processChunk(chunk) {
    // Always emit chunk for real-time streaming if we are in recording state
    // OR if we want to stream everything (but usually we stream only when voice active)
    // The requirement says "resume sending raw binary chunks".
    // If we only send when isRecording is true, we save bandwidth.
    
    if (this.isRecording) {
      this.chunks.push(chunk);
      this.emit('chunkReady', chunk);
    } else {
      // Maintain pre-roll buffer
      this.preRollBuffer.push(chunk);
      this.prunePreRoll();
    }
  }

  prunePreRoll() {
    // Calculate total duration of pre-roll buffer
    let totalSamples = 0;
    for (const c of this.preRollBuffer) totalSamples += c.length;
    
    const maxSamples = (this.preRollMs / 1000) * this.sampleRate;
    
    while (totalSamples > maxSamples && this.preRollBuffer.length > 0) {
      const removed = this.preRollBuffer.shift();
      totalSamples -= removed.length;
    }
  }

  startSegment() {
    if (this.isRecording) return;
    this.isRecording = true;
    
    // Move pre-roll buffer into current chunks
    // And emit them for streaming so the backend gets the start of the word
    for (const chunk of this.preRollBuffer) {
      this.chunks.push(chunk);
      this.emit('chunkReady', chunk);
    }
    this.preRollBuffer = [];
  }

  stopSegment() {
    if (!this.isRecording) return;
    this.isRecording = false;
    
    // The chunks collected during the "silence wait" (post-roll) are already in this.chunks
    // because processChunk adds to this.chunks while isRecording is true.
    // And isRecording only flips to false AFTER the silence duration has passed.
    // So post-roll is implicitly handled.

    // Merge chunks into one Float32Array
    const totalLength = this.chunks.reduce((acc, c) => acc + c.length, 0);
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of this.chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    this.emit('segmentReady', {
      audio: merged,
      duration: (totalLength / this.sampleRate) * 1000
    });

    this.chunks = [];
  }

  subscribe(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => cb(data));
    }
  }
}
