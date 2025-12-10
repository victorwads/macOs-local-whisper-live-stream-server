import numpy as np
from typing import Callable, Awaitable

class AudioSegmenter:
    def __init__(self, min_seconds: float, max_seconds: float, sample_rate: int, on_segment_ready: Callable[[np.ndarray], Awaitable[None]]):
        self.min_seconds = min_seconds
        self.max_seconds = max_seconds
        self.sample_rate = sample_rate
        self.on_segment_ready = on_segment_ready
        self.buffer = np.zeros(0, dtype=np.float32)

    async def push_audio_chunk(self, chunk: np.ndarray):
        if chunk.size == 0:
            return
        self.buffer = np.concatenate((self.buffer, chunk))
        
        current_duration = self.buffer.size / self.sample_rate
        if current_duration >= self.max_seconds:
            await self._process()

    async def notify_silence(self):
        current_duration = self.buffer.size / self.sample_rate
        if current_duration >= self.min_seconds:
            await self._process()

    async def _process(self):
        if self.buffer.size == 0:
            return
        # Copy buffer to ensure we don't modify it if the callback is slow/async
        data_to_process = np.copy(self.buffer)
        self.buffer = np.zeros(0, dtype=np.float32)
        await self.on_segment_ready(data_to_process)
        
    def reset(self):
        self.buffer = np.zeros(0, dtype=np.float32)
