import os
import re
import json
import logging
import tempfile
import subprocess
from datetime import datetime, timezone
import requests
from sqlalchemy.orm import object_session
from PIL import Image
import pytesseract

from ...config import get_settings
from ...models.file import File
from .base import ExtractionResult

logger = logging.getLogger(__name__)


def format_timestamp(seconds: float) -> str:
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    return f"[{hours:02d}:{minutes:02d}:{secs:02d}]"


# ---------------------------------------------------------------------------
# Internal helpers that support both real File ORM objects and
# the _SourceFileAdapter shim used when no matching File row exists.
# ---------------------------------------------------------------------------

def _get_db(file_record):
    """
    Return the SQLAlchemy session associated with file_record.

    Works for:
      * Real File ORM instances  → object_session(file_record)
      * _SourceFileAdapter shims → file_record._db
    """
    db = object_session(file_record)
    if db is None:
        db = getattr(file_record, '_db', None)
    return db


def _save_record(db, file_record) -> None:
    """
    Persist pending changes in file_record to the database.

    Real ORM objects   → db.add() + db.commit() + db.refresh()
    Adapter shims      → just db.commit() (add/refresh are unsupported)
    """
    if db is None:
        return
    try:
        is_orm = object_session(file_record) is not None
        if is_orm:
            db.add(file_record)
        db.commit()
        if is_orm:
            try:
                db.refresh(file_record)
            except Exception:
                pass
    except Exception as exc:
        logger.warning("Could not persist file record to DB: %s", exc)


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------

def update_file_progress(file_record: File, progress: int, status: str, error: str = None, steps: list = None) -> None:
    db = _get_db(file_record)
    if db:
        try:
            file_record.progress_percent = progress
            file_record.extraction_status = status
            if error is not None:
                file_record.extraction_error = error
            if steps is not None:
                file_record.detailed_steps = json.dumps(steps)
            _save_record(db, file_record)
        except Exception as exc:
            logger.warning("Could not write progress update to DB: %s", exc)


def get_initial_steps(is_video: bool, processed_chunks: int = 0) -> list:
    steps = [
        {"name": "Uploading & Queueing", "status": "completed"},
        {"name": "Extracting Audio", "status": "completed" if processed_chunks > 0 else "pending"},
        {"name": "Segmenting Audio", "status": "completed" if processed_chunks > 0 else "pending"},
        {"name": "Transcribing Chunks", "status": "pending"},
    ]
    if is_video:
        steps.append({"name": "Extracting Keyframes", "status": "completed" if processed_chunks > 0 else "pending"})
        steps.append({"name": "Running OCR on Slides", "status": "completed" if processed_chunks > 0 else "pending"})
    steps.append({"name": "Generating Semantic Embeddings", "status": "pending"})
    return steps


def set_step_status(steps: list, name: str, status: str) -> list:
    for step in steps:
        if step["name"] == name:
            step["status"] = status
            break
    return steps


def process_media_file(file_path: str, file_record: File, is_video: bool) -> ExtractionResult:
    settings = get_settings()
    # Support both real ORM File objects and _SourceFileAdapter shims
    db = _get_db(file_record)

    # Check if we are resuming from a previous failure
    start_chunk_idx = file_record.processed_chunks or 0
    is_resume = start_chunk_idx > 0

    steps = get_initial_steps(is_video, processed_chunks=start_chunk_idx)

    # Configure pytesseract path if present
    if settings.tesseract_cmd:
        pytesseract.pytesseract.tesseract_cmd = settings.tesseract_cmd

    initial_progress = 10 if not is_resume else 55 + int((start_chunk_idx / max(1, file_record.total_chunks)) * 35)
    update_file_progress(file_record, initial_progress, "processing", steps=steps)

    # Get precompiled FFmpeg binary path from imageio-ffmpeg
    try:
        import imageio_ffmpeg
        ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:
        err_msg = f"Failed to load precompiled FFmpeg: {exc}"
        logger.exception(err_msg)
        update_file_progress(file_record, initial_progress, "failed", error=err_msg)
        return ExtractionResult(status="failed", content=None, error=err_msg)

    # Create temporary directory for chunks and frames
    with tempfile.TemporaryDirectory() as temp_dir:
        audio_path = os.path.join(temp_dir, "extracted_audio.wav")

        # 1. Extract audio (always run on startup/resumption to generate wav file)
        if not is_resume:
            steps = set_step_status(steps, "Extracting Audio", "processing")
            update_file_progress(file_record, 15, "processing", steps=steps)

        try:
            logger.info("Extracting audio from %s to %s", file_path, audio_path)
            subprocess.run(
                [ffmpeg_exe, "-y", "-i", file_path, "-vn", "-ar", "16000", "-ac", "1", "-f", "wav", audio_path],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            steps = set_step_status(steps, "Extracting Audio", "completed")
            if not is_resume:
                update_file_progress(file_record, 25, "processing", steps=steps)
        except Exception as exc:
            err_msg = f"Audio extraction failed: {exc}"
            logger.exception(err_msg)
            steps = set_step_status(steps, "Extracting Audio", "failed")
            update_file_progress(file_record, 25, "failed", error=err_msg, steps=steps)
            return ExtractionResult(status="failed", content=None, error=err_msg)

        # 2. Segment audio into 10-minute chunks (always run to generate chunk wavs)
        if not is_resume:
            steps = set_step_status(steps, "Segmenting Audio", "processing")
            update_file_progress(file_record, 30, "processing", steps=steps)

        chunk_pattern = os.path.join(temp_dir, "chunk_%03d.wav")
        try:
            subprocess.run(
                [ffmpeg_exe, "-y", "-i", audio_path, "-f", "segment", "-segment_time", "600", "-c", "copy", chunk_pattern],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            steps = set_step_status(steps, "Segmenting Audio", "completed")
            if not is_resume:
                update_file_progress(file_record, 35, "processing", steps=steps)
        except Exception as exc:
            err_msg = f"Audio segmenting failed: {exc}"
            logger.exception(err_msg)
            steps = set_step_status(steps, "Segmenting Audio", "failed")
            update_file_progress(file_record, 35, "failed", error=err_msg, steps=steps)
            return ExtractionResult(status="failed", content=None, error=err_msg)

        # List all chunk files
        chunk_files = sorted([
            os.path.join(temp_dir, f) for f in os.listdir(temp_dir)
            if f.startswith("chunk_") and f.endswith(".wav")
        ])
        total_chunks = len(chunk_files)
        logger.info("Generated %d audio chunks.", total_chunks)

        # Save total_chunks to database
        file_record.total_chunks = total_chunks
        _save_record(db, file_record)

        # Parse existing partial transcript if resuming
        ocr_texts = []
        transcript_segments = []
        if is_resume and file_record.partial_transcript:
            try:
                data = json.loads(file_record.partial_transcript)
                ocr_texts = data.get("ocr_texts", [])
                transcript_segments = data.get("transcript_segments", [])
                logger.info("Resuming media extraction. Loaded %d OCR texts and %d segments from DB.",
                            len(ocr_texts), len(transcript_segments))
            except Exception as e:
                logger.warning("Failed to load partial_transcript: %s. Starting from scratch.", e)
                start_chunk_idx = 0
                is_resume = False

        # 3. OCR (if video and not resume)
        if is_video and not is_resume:
            steps = set_step_status(steps, "Extracting Keyframes", "processing")
            update_file_progress(file_record, 40, "processing", steps=steps)

            frame_pattern = os.path.join(temp_dir, "keyframe_%03d.jpg")
            try:
                # Extract one frame every 3 minutes (1/180 fps)
                subprocess.run(
                    [ffmpeg_exe, "-y", "-i", file_path, "-vf", "fps=1/180,scale=640:-1", "-q:v", "2", frame_pattern],
                    check=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE
                )
                steps = set_step_status(steps, "Extracting Keyframes", "completed")
                steps = set_step_status(steps, "Running OCR on Slides", "processing")
                update_file_progress(file_record, 45, "processing", steps=steps)

                frame_files = sorted([
                    f for f in os.listdir(temp_dir)
                    if f.startswith("keyframe_") and f.endswith(".jpg")
                ])

                for f_idx, f_name in enumerate(frame_files):
                    frame_path = os.path.join(temp_dir, f_name)
                    idx_match = re.search(r"keyframe_(\d+)\.jpg", f_name)
                    if idx_match:
                        frame_index = int(idx_match.group(1)) - 1
                        timestamp_sec = frame_index * 180

                        try:
                            logger.info("Running OCR on frame %s at %d seconds", f_name, timestamp_sec)
                            img = Image.open(frame_path)
                            text = pytesseract.image_to_string(img).strip()
                            if text:
                                clean_text = "\n".join(line.strip() for line in text.splitlines() if line.strip())
                                ocr_texts.append({
                                    "time": timestamp_sec,
                                    "text": f"{format_timestamp(timestamp_sec)} [Visual Slide OCR]:\n{clean_text}"
                                })
                        except Exception as ocr_exc:
                            logger.warning("OCR failed for %s: %s", f_name, ocr_exc)

                steps = set_step_status(steps, "Running OCR on Slides", "completed")
                update_file_progress(file_record, 50, "processing", steps=steps)
            except Exception as exc:
                logger.warning("Keyframe extraction or OCR failed completely: %s. Skipping OCR context.", exc)
                steps = set_step_status(steps, "Extracting Keyframes", "failed")
                steps = set_step_status(steps, "Running OCR on Slides", "failed")
                update_file_progress(file_record, 50, "processing", steps=steps)

        # 4. Transcribe Chunks
        steps = set_step_status(steps, "Transcribing Chunks", "processing")
        if not is_resume:
            update_file_progress(file_record, 55, "processing", steps=steps)

        # Retrieve modular transcription provider (defaults to Faster-Whisper)
        from ...services.transcription import get_transcription_provider
        provider = get_transcription_provider()

        for idx in range(start_chunk_idx, total_chunks):
            chunk_path = chunk_files[idx]
            chunk_base_sec = idx * 600

            # Update detailed step title to show current progress
            steps = set_step_status(
                steps,
                "Transcribing Chunks",
                f"processing (Chunk {idx + 1}/{total_chunks})"
            )
            prog_val = 55 + int(((idx + 1) / total_chunks) * 35)

            # Save intermediate chunk progress and total progress state in DB before transcribing
            file_record.processed_chunks = idx
            file_record.progress_percent = prog_val
            file_record.detailed_steps = json.dumps(steps)
            _save_record(db, file_record)

            try:
                logger.info("Transcribing chunk %d/%d (%s) using provider: %s",
                            idx + 1, total_chunks, chunk_path, provider.__class__.__name__)

                res_data = provider.transcribe(chunk_path)

                segments = res_data.get("segments", [])
                for seg in segments:
                    start_time = chunk_base_sec + seg.get("start", 0)
                    end_time = chunk_base_sec + seg.get("end", 0)
                    seg_text = seg.get("text", "").strip()
                    if seg_text:
                        transcript_segments.append({
                            "time": start_time,
                            "text": f"{format_timestamp(start_time)} {seg_text}"
                        })

                # Save completed chunk text and state
                file_record.processed_chunks = idx + 1
                file_record.partial_transcript = json.dumps({
                    "ocr_texts": ocr_texts,
                    "transcript_segments": transcript_segments
                })
                _save_record(db, file_record)

                update_file_progress(file_record, prog_val, "processing", steps=steps)

            except Exception as exc:
                err_msg = f"Failed transcribing chunk {idx + 1}: {exc}"
                logger.exception(err_msg)
                steps = set_step_status(steps, "Transcribing Chunks", "failed")
                update_file_progress(file_record, prog_val, "failed", error=err_msg, steps=steps)
                return ExtractionResult(status="failed", content=None, error=err_msg)

        steps = set_step_status(steps, "Transcribing Chunks", "completed")
        steps = set_step_status(steps, "Generating Semantic Embeddings", "processing")
        update_file_progress(file_record, 90, "processing", steps=steps)

        # 5. Merge transcript segments and OCR slides by timestamp!
        all_timed_items = []
        for seg in transcript_segments:
            all_timed_items.append((seg["time"], seg["text"], "transcript"))
        for ocr in ocr_texts:
            all_timed_items.append((ocr["time"], ocr["text"], "ocr"))

        # Sort by timestamp
        all_timed_items.sort(key=lambda item: item[0])

        merged_content_blocks = []
        for time_val, text_val, kind in all_timed_items:
            merged_content_blocks.append(text_val)

        final_content = "\n\n".join(merged_content_blocks).strip()

        if not final_content:
            err_msg = "Transcription yielded an empty output."
            update_file_progress(file_record, 90, "failed", error=err_msg, steps=steps)
            return ExtractionResult(status="failed", content=None, error=err_msg)

        # Successful extraction result
        steps = set_step_status(steps, "Generating Semantic Embeddings", "completed")
        update_file_progress(file_record, 95, "processing", steps=steps)

        # Clear partial progress metadata on completion
        file_record.processed_chunks = total_chunks
        file_record.partial_transcript = None
        _save_record(db, file_record)

        logger.info("Successfully extracted audio and OCR from media record %d.", file_record.id)

        return ExtractionResult(
            status="completed",
            content=final_content,
            error=None
        )


def extract_video_content(file_path: str, file_record: File) -> ExtractionResult:
    return process_media_file(file_path, file_record, is_video=True)


def extract_audio_content(file_path: str, file_record: File) -> ExtractionResult:
    return process_media_file(file_path, file_record, is_video=False)
