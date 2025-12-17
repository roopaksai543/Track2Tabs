# FastAPI framework primitives
from fastapi import FastAPI, UploadFile, File, HTTPException

# ASGI server
import uvicorn

# Audio analysis libraries
import librosa
import numpy as np

# Utilities for temporary file handling
import tempfile
import os

# Initialize FastAPI app
app = FastAPI()


# -------------------------
# Health / status endpoint
# -------------------------
@app.get("/")
async def root():
    """
    Simple health-check endpoint to verify that
    the service is running and reachable.
    """
    return {"status": "ok", "message": "TrackToTab Python service is running"}


# -------------------------------------------------
# Core chord detection logic using librosa + numpy
# -------------------------------------------------
def detect_chords_librosa(file_path: str):
    """
    Improved chord detector with:
    - chroma_cqt features (robust to tuning & timbre)
    - major/minor chord template matching
    - temporal smoothing to reduce jitter
    - suppression of very short ("micro") segments
    """

    # Load audio as mono waveform
    # y = audio samples, sr = sampling rate
    y, sr = librosa.load(file_path, mono=True)

    # Compute Constant-Q chromagram
    # Shape: (12 pitch classes, T time frames)
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)

    # Names for pitch classes (index-aligned with chroma bins)
    note_names = [
        "C", "C#", "D", "D#", "E", "F",
        "F#", "G", "G#", "A", "A#", "B"
    ]

    templates = []  # chord templates (12-d vectors)
    labels = []     # chord labels (e.g., C, D#m)

    # -------------------------
    # Build MAJOR chord templates
    # -------------------------
    for root in range(12):
        t = np.zeros(12)
        # Major chord intervals: root, major third, perfect fifth
        for off in [0, 4, 7]:
            t[(root + off) % 12] = 1

        # Normalize template vector
        templates.append(t / np.linalg.norm(t))
        labels.append(note_names[root])

    # -------------------------
    # Build MINOR chord templates
    # -------------------------
    for root in range(12):
        t = np.zeros(12)
        # Minor chord intervals: root, minor third, perfect fifth
        for off in [0, 3, 7]:
            t[(root + off) % 12] = 1

        templates.append(t / np.linalg.norm(t))
        labels.append(note_names[root] + "m")

    # Stack templates into matrix
    # Shape: (12 pitch classes, 24 chords)
    templates = np.stack(templates, axis=1)

    # -------------------------
    # Normalize chroma per-frame
    # -------------------------
    # Prevents loud frames from dominating similarity scores
    chroma_norm = chroma / (
        np.linalg.norm(chroma, axis=0, keepdims=True) + 1e-6
    )

    # -------------------------
    # Template matching
    # -------------------------
    # Dot product similarity between each frame and chord templates
    # Result shape: (T frames, 24 chords)
    sims = np.dot(chroma_norm.T, templates)

    # Best matching chord per frame
    best_idx = np.argmax(sims, axis=1)
    T = len(best_idx)

    # -------------------------
    # Temporal smoothing
    # -------------------------
    # Reduces rapid frame-to-frame chord flipping
    window = 9  # must be odd; try 7–13 for tuning
    pad = window // 2
    smoothed = np.copy(best_idx)

    for i in range(T):
        start = max(0, i - pad)
        end = min(T, i + pad + 1)

        # Replace frame label with the most common
        # chord in the local window (mode)
        values, counts = np.unique(
            best_idx[start:end],
            return_counts=True
        )
        smoothed[i] = values[np.argmax(counts)]

    # -------------------------
    # Frame → time segmentation
    # -------------------------
    frames = np.arange(chroma.shape[1])
    times = librosa.frames_to_time(frames, sr=sr)

    segments = []
    cur_label = labels[smoothed[0]]
    start_t = times[0]

    # Group consecutive frames with same chord label
    for i in range(1, T):
        label = labels[smoothed[i]]
        if label != cur_label:
            end_t = times[i]
            segments.append((cur_label, start_t, end_t))
            cur_label = label
            start_t = times[i]

    # Add final segment
    segments.append((cur_label, start_t, times[-1]))

    # -------------------------
    # Merge very short segments
    # -------------------------
    merged = []
    MIN_DUR = 0.30  # seconds

    for label, s, e in segments:
        if not merged:
            merged.append([label, s, e])
            continue

        prev_label, prev_s, prev_e = merged[-1]

        # Merge if:
        # 1) Same chord continues
        # 2) Segment is too short to be musically meaningful
        if label == prev_label or (e - s) < MIN_DUR:
            merged[-1][2] = e
        else:
            merged.append([label, s, e])

    # -------------------------
    # Format API response
    # -------------------------
    output = []
    for label, s, e in merged:
        output.append({
            "label": label,
            "startSec": float(s),
            "endSec": float(e)
        })

    return output


# ----------------------------------------
# API endpoint: upload audio → detect chords
# ----------------------------------------
@app.post("/chords")
async def detect_chords(file: UploadFile = File(...)):
    """
    Accepts an uploaded audio file, runs chord detection,
    and returns time-aligned chord labels.
    """

    # Save uploaded file to a temporary location
    try:
        suffix = os.path.splitext(file.filename or "audio.wav")[1]
        if suffix == "":
            suffix = ".wav"

        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        data = await file.read()
        tmp.write(data)
        tmp_path = tmp.name
        tmp.close()
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Could not save upload: {e}"
        )

    # Run chord detection
    try:
        chords = detect_chords_librosa(tmp_path)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Chord detection failed: {e}"
        )
    finally:
        # Clean up temp file
        try:
            os.remove(tmp_path)
        except Exception:
            pass

    return {"chords": chords}


# -------------------------
# Local development entry
# -------------------------
if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000
    )
