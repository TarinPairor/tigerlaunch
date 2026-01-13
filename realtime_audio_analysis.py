#!/usr/bin/env python3
"""
Real-time Audio Analysis with Live Visualization
Records audio and displays live updating graphs showing speech detection and analysis.
"""

import sounddevice as sd
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.animation as animation
from collections import deque
import time
import threading

# Configuration
DURATION = 10  # Total seconds to record (set to None for continuous)
CHUNK_DURATION = 0.1  # Process audio in 0.1 second chunks
fs = 44100  # Sampling frequency
CHUNK_SIZE = int(CHUNK_DURATION * fs)
THRESHOLD = 0.01  # Amplitude threshold for speech detection
MIN_BREAK_SECONDS = 0.7  # Minimum silence duration to separate phrases

class RealTimeAudioAnalyzer:
    def __init__(self, duration=None, sample_rate=44100):
        self.duration = duration
        self.fs = sample_rate
        self.chunk_size = int(CHUNK_DURATION * self.fs)
        self.threshold = THRESHOLD
        self.min_break_samples = int(MIN_BREAK_SECONDS * self.fs)
        
        # Audio buffer
        self.audio_buffer = deque(maxlen=int((duration or 10) * self.fs))
        self.time_buffer = deque(maxlen=int((duration or 10) * self.fs))
        
        # Analysis data
        self.speech_segments = []
        self.phrase_segments = []
        self.total_words = 0
        self.speaking_time = 0
        self.silence_time = 0
        self.speech_rate = 0
        
        # Timing
        self.start_time = None
        self.current_time = 0
        
        # Setup plot
        self.setup_plot()
        
    def setup_plot(self):
        """Setup matplotlib figure and axes"""
        self.fig, self.ax1 = plt.subplots(1, 1, figsize=(12, 6))
        self.fig.suptitle('Real-time Audio Analysis', fontsize=14, fontweight='bold')
        
        # Waveform plot
        self.ax1.set_xlabel("Time [s]")
        self.ax1.set_ylabel("Amplitude")
        self.ax1.set_title("Raw Audio Waveform & Speech Regions")
        self.ax1.set_ylim(-1, 1)
        self.ax1.grid(True, alpha=0.3)
        
        # Initialize plot elements
        self.line, = self.ax1.plot([], [], color='blue', alpha=0.8, linewidth=0.5)
        self.fill_patches = []  # Store fill patches in a list
        
        plt.tight_layout()
        
    def audio_callback(self, indata, frames, time_info, status):
        """Callback function for audio stream"""
        if status:
            print(f"Status: {status}")
        
        # Add audio data to buffer
        audio_chunk = indata[:, 0].flatten()
        current_time = time.time()
        
        if self.start_time is None:
            self.start_time = current_time
        
        elapsed = current_time - self.start_time
        
        # Add to buffers
        for sample in audio_chunk:
            self.audio_buffer.append(sample)
            self.time_buffer.append(elapsed)
            self.current_time = elapsed
        
        # Check if we should stop
        if self.duration and elapsed >= self.duration:
            return sd.CallbackStop()
    
    def analyze_audio(self):
        """Analyze current audio buffer"""
        if len(self.audio_buffer) < self.chunk_size:
            return
        
        # Convert buffer to numpy array
        audio_wave = np.array(self.audio_buffer)
        time_axis = np.array(self.time_buffer)
        
        if len(audio_wave) == 0:
            return
        
        # Detect speech regions
        is_speech = np.abs(audio_wave) > self.threshold
        
        # Find speech segments
        speech_segments = []
        i = 0
        while i < len(is_speech):
            if is_speech[i]:
                seg_start = i
                while i < len(is_speech) and is_speech[i]:
                    i += 1
                seg_end = i
                if seg_end > seg_start:  # Valid segment
                    speech_segments.append((seg_start, seg_end))
            else:
                i += 1
        
        # Calculate speaking time
        if speech_segments:
            speaking_time = sum([end - start for start, end in speech_segments]) / self.fs
            silence_time = self.current_time - speaking_time
        else:
            speaking_time = 0
            silence_time = self.current_time
        
        # Group into phrases (separated by long breaks)
        phrase_segments = []
        segment_start = None
        for idx, (start, end) in enumerate(speech_segments):
            if segment_start is None:
                segment_start = start
            if idx + 1 < len(speech_segments):
                next_start = speech_segments[idx + 1][0]
                gap = next_start - end
                if gap >= self.min_break_samples:
                    phrase_segments.append((segment_start, end))
                    segment_start = None
            else:
                phrase_segments.append((segment_start, end))
        
        # Estimate words
        words = []
        for start, end in phrase_segments:
            seg_len_sec = (end - start) / self.fs
            est_words = max(1, int(np.round(seg_len_sec / 0.5)))
            words.append(est_words)
        total_words = sum(words)
        
        # Calculate speech rate
        if self.current_time > 0:
            speech_rate = total_words / self.current_time
        else:
            speech_rate = 0
        
        # Update stored values
        self.speech_segments = speech_segments
        self.phrase_segments = phrase_segments
        self.total_words = total_words
        self.speaking_time = speaking_time
        self.silence_time = silence_time
        self.speech_rate = speech_rate
        
        return audio_wave, time_axis, is_speech
    
    def update_plot(self, frame):
        """Update plot with latest audio data"""
        # Analyze current audio
        result = self.analyze_audio()
        if result is None:
            return self.line,
        
        audio_wave, time_axis, is_speech = result
        
        if len(audio_wave) == 0:
            return self.line,
        
        # Ensure all arrays have the same length
        min_len = min(len(audio_wave), len(time_axis), len(is_speech))
        if min_len == 0:
            return self.line,
        
        audio_wave = audio_wave[:min_len]
        time_axis = time_axis[:min_len]
        is_speech = is_speech[:min_len]
        
        # Update waveform plot
        self.line.set_data(time_axis, audio_wave)
        
        # Update x-axis limits to show recent audio (last 5 seconds or all)
        if len(time_axis) > 0:
            max_time = max(time_axis)
            min_time = max(0, max_time - 5)  # Show last 5 seconds
            self.ax1.set_xlim(min_time, max_time + 0.5)
        
        # Remove old fill patches
        for patch in self.fill_patches:
            try:
                patch.remove()
            except (ValueError, AttributeError):
                pass  # Already removed or doesn't exist
        self.fill_patches.clear()
        
        # Add new speech regions fill - ensure arrays match
        if len(is_speech) > 0 and len(time_axis) == len(is_speech) and np.any(is_speech):
            fill = self.ax1.fill_between(
                time_axis, -1, 1, where=is_speech, 
                color='yellow', alpha=0.2, label='Speech regions'
            )
            self.fill_patches.append(fill)
        
        return self.line,
    
    def run(self):
        """Start real-time analysis"""
        print(f"Starting real-time audio analysis...")
        if self.duration:
            print(f"Will record for {self.duration} seconds")
        else:
            print("Recording continuously (press Ctrl+C to stop)")
        print(f"Sample rate: {self.fs} Hz")
        print(f"Threshold: {self.threshold}")
        print("\nSpeak now! The graph will update in real-time.\n")
        
        try:
            # Start audio stream
            stream = sd.InputStream(
                samplerate=self.fs,
                channels=1,
                dtype='float32',
                blocksize=self.chunk_size,
                callback=self.audio_callback
            )
            
            with stream:
                # Start animation
                ani = animation.FuncAnimation(
                    self.fig, 
                    self.update_plot, 
                    interval=50,  # Update every 50ms
                    blit=False,
                    cache_frame_data=False
                )
                
                # Print statistics to console periodically
                def print_stats():
                    while stream.active:
                        time.sleep(2)  # Print every 2 seconds
                        if self.current_time > 0:
                            print(f"\rDuration: {self.current_time:.1f}s | "
                                  f"Speaking: {self.speaking_time:.1f}s | "
                                  f"Words: {self.total_words} | "
                                  f"Rate: {self.speech_rate:.2f} words/sec", end='', flush=True)
                
                stats_thread = threading.Thread(target=print_stats, daemon=True)
                stats_thread.start()
                
                # Show plot (this blocks until window is closed)
                plt.show()
                
        except KeyboardInterrupt:
            print("\n\nStopping recording...")
        except Exception as e:
            print(f"Error: {e}")
        finally:
            print("\nFinal Statistics:")
            print(f"  Total Duration: {self.current_time:.2f} seconds")
            print(f"  Speaking Time: {self.speaking_time:.2f} seconds")
            print(f"  Silence Time: {self.silence_time:.2f} seconds")
            print(f"  Estimated Words: {self.total_words}")
            print(f"  Speech Rate: {self.speech_rate:.2f} words/sec")


def main():
    """Main entry point"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Real-time Audio Analysis with Live Visualization')
    parser.add_argument('--duration', type=float, default=10,
                       help='Duration to record in seconds (default: 10, use 0 for continuous)')
    parser.add_argument('--sample-rate', type=int, default=44100,
                       help='Audio sample rate (default: 44100)')
    parser.add_argument('--threshold', type=float, default=0.01,
                       help='Amplitude threshold for speech detection (default: 0.01)')
    
    args = parser.parse_args()
    
    duration = args.duration if args.duration > 0 else None
    
    analyzer = RealTimeAudioAnalyzer(
        duration=duration,
        sample_rate=args.sample_rate
    )
    analyzer.threshold = args.threshold
    
    analyzer.run()


if __name__ == "__main__":
    main()

