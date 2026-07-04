import os
import logging
from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional
import requests

from ..config import get_settings

logger = logging.getLogger(__name__)

# Cache loaded model at module level to avoid reloading it
_cached_model = None
_cached_model_size = None


class TranscriptionProvider(ABC):
    @abstractmethod
    def transcribe(self, audio_path: str) -> Dict[str, Any]:
        """
        Transcribes the audio file at audio_path.
        Returns:
            {
                "text": "...",
                "segments": [
                    {"start": 0.0, "end": 5.0, "text": "..."}
                ],
                "duration": ...
            }
        """
        pass


class FasterWhisperProvider(TranscriptionProvider):
    def __init__(self, model_size: str = "small", device: str = "auto", compute_type: str = "int8"):
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type

    def get_model(self):
        # Deferred import: WhisperModel pulls in ctranslate2 + onnxruntime (~60 MB).
        # Only load these when local Whisper transcription is actually requested.
        from faster_whisper import WhisperModel
        global _cached_model, _cached_model_size
        if _cached_model is None or _cached_model_size != self.model_size:
            logger.info("Loading Faster-Whisper model size '%s' on device '%s' with compute_type '%s'",
                        self.model_size, self.device, self.compute_type)
            _cached_model = WhisperModel(
                self.model_size,
                device=self.device,
                compute_type=self.compute_type
            )
            _cached_model_size = self.model_size
        return _cached_model

    def transcribe(self, audio_path: str) -> Dict[str, Any]:
        model = self.get_model()
        logger.info("Starting local Faster-Whisper transcription for %s", audio_path)
        segments_generator, info = model.transcribe(audio_path, beam_size=5)
        
        segments = []
        text_pieces = []
        for segment in segments_generator:
            segments.append({
                "start": segment.start,
                "end": segment.end,
                "text": segment.text.strip()
            })
            text_pieces.append(segment.text)
            
        full_text = "".join(text_pieces).strip()
        logger.info("Completed local transcription. Segments: %d, Duration: %.2fs", len(segments), info.duration)
        return {
            "text": full_text,
            "segments": segments,
            "duration": info.duration
        }


class OpenAIWhisperProvider(TranscriptionProvider):
    def __init__(self, api_key: Optional[str], model: str = "whisper-1"):
        self.api_key = api_key
        self.model = model

    def transcribe(self, audio_path: str) -> Dict[str, Any]:
        if not self.api_key:
            raise ValueError("OpenAI API Key is missing. Server-side transcription is unavailable.")
        
        logger.info("Starting OpenAI Whisper transcription for %s", audio_path)
        headers = {"Authorization": f"Bearer {self.api_key}"}
        url = "https://api.openai.com/v1/audio/transcriptions"
        data = {
            "model": self.model,
            "response_format": "verbose_json"
        }
        with open(audio_path, "rb") as audio_file:
            files = {"file": (os.path.basename(audio_path), audio_file, "audio/wav")}
            response = requests.post(url, headers=headers, data=data, files=files, timeout=120)
        
        response.raise_for_status()
        res_data = response.json()
        
        segments = []
        for seg in res_data.get("segments", []):
            segments.append({
                "start": seg.get("start", 0.0),
                "end": seg.get("end", 0.0),
                "text": seg.get("text", "").strip()
            })
            
        return {
            "text": res_data.get("text", "").strip(),
            "segments": segments,
            "duration": res_data.get("duration", 0.0)
        }


class DeepgramProvider(TranscriptionProvider):
    def __init__(self, api_key: Optional[str]):
        self.api_key = api_key

    def transcribe(self, audio_path: str) -> Dict[str, Any]:
        if not self.api_key:
            raise ValueError("Deepgram API Key is missing. Server-side transcription is unavailable.")
        
        logger.info("Starting Deepgram transcription for %s", audio_path)
        headers = {
            "Authorization": f"Token {self.api_key}",
            "Content-Type": "audio/wav"
        }
        url = "https://api.deepgram.com/v1/listen?smart_format=true&diarize=false"
        with open(audio_path, "rb") as audio_file:
            response = requests.post(url, headers=headers, data=audio_file, timeout=120)
            
        response.raise_for_status()
        res_data = response.json()
        
        channels = res_data.get("results", {}).get("channels", [])
        if not channels:
            return {"text": "", "segments": [], "duration": 0.0}
            
        alternatives = channels[0].get("alternatives", [])
        if not alternatives:
            return {"text": "", "segments": [], "duration": 0.0}
            
        transcript = alternatives[0].get("transcript", "").strip()
        paragraphs = alternatives[0].get("paragraphs", {}).get("paragraphs", [])
        
        segments = []
        if paragraphs:
            for para in paragraphs:
                para_sentences = para.get("sentences", [])
                para_text = " ".join(s.get("text", "") for s in para_sentences).strip()
                segments.append({
                    "start": para.get("start", 0.0),
                    "end": para.get("end", 0.0),
                    "text": para_text
                })
        else:
            words = alternatives[0].get("words", [])
            current_seg = []
            for w in words:
                current_seg.append(w)
                if w.get("punctuated_word", "").endswith((".", "?", "!")) or len(current_seg) >= 15:
                    if current_seg:
                        segments.append({
                            "start": current_seg[0].get("start", 0.0),
                            "end": current_seg[-1].get("end", 0.0),
                            "text": " ".join(item.get("word", "") for item in current_seg).strip()
                        })
                        current_seg = []
            if current_seg:
                segments.append({
                    "start": current_seg[0].get("start", 0.0),
                    "end": current_seg[-1].get("end", 0.0),
                    "text": " ".join(item.get("word", "") for item in current_seg).strip()
                })
                
        duration = res_data.get("metadata", {}).get("duration", 0.0)
        return {
            "text": transcript,
            "segments": segments,
            "duration": duration
        }


def get_transcription_provider() -> TranscriptionProvider:
    settings = get_settings()
    provider_name = settings.transcription_provider.lower().strip()
    
    if provider_name == "openai":
        return OpenAIWhisperProvider(api_key=settings.openai_api_key)
    elif provider_name == "deepgram":
        deepgram_key = os.getenv("DEEPGRAM_API_KEY")
        return DeepgramProvider(api_key=deepgram_key)
    else:
        # Default is Faster-Whisper
        model_size = settings.transcription_model.lower().strip()
        return FasterWhisperProvider(model_size=model_size, device="auto", compute_type="int8")
