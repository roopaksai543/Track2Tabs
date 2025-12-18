/**
 * Base URL where chord diagram images are hosted.
 * These are static PNGs (e.g., guitar chord diagrams).
 */
const CHORD_IMAGE_BASE =
  "/chords/";

/**
 * Maps chord labels (as returned by the backend)
 * to their corresponding image filenames.
 *
 * IMPORTANT:
 * - Labels must exactly match backend output
 * - Missing entries will simply render no image
 */
const CHORD_IMAGE_MAP = {
  A: "a-major-v1.png",
  Am: "a-minor-v1.png",
  Bm: "b-minor-v1.png",
  C: "c-major-v1.png",
  C7: "c-7th-v1.png",
  D: "d-major-v1.png",
  Dm: "d-minor-v1.png",
  D7: "d-7th-v1.png",
  E: "e-major-v1.png",
  Em: "e-minor-v1.png",
  F: "f-major-v1.png",
  G: "g-major-v1.png",
  G7: "g-7th-v1.png",
};

/**
 * Cache DOM elements once to avoid repeated lookups
 * and keep logic readable.
 */
const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const statusDiv = document.getElementById("status");
const chordsContainer = document.getElementById("chords-container");
const audioEl = document.getElementById("player");
const currentChordSpan = document.getElementById("current-chord");
const chordImageContainer = document.getElementById("chord-image");
const chordTagsDiv = document.getElementById("chord-tags");
const summaryText = document.getElementById("summary-text");
const downloadBtn = document.getElementById("download-btn");

/**
 * Internal API endpoint (Next.js → Python backend)
 */
const API_URL = "/api/analyze";

/**
 * Global state:
 * - currentChords: time-aligned chord segments
 * - lastAudioUrl: used to revoke old object URLs
 */
let currentChords = [];
let lastAudioUrl = null;

/****************************************************
 *  CURRENT CHORD DISPLAY
 ****************************************************/

/**
 * Updates the "Current chord" UI based on playback time.
 * Clears UI if no chord is available.
 */
function setCurrentChordDisplay(chord) {
  if (!chord) {
    currentChordSpan.textContent = "—";
    chordImageContainer.innerHTML = "";
    return;
  }

  currentChordSpan.textContent = chord.label;
  renderChordImage(chord.label);
}

/**
 * Renders the chord diagram image for a given label.
 * If the chord is unsupported, nothing is shown.
 */
function renderChordImage(label) {
  chordImageContainer.innerHTML = "";

  const filename = CHORD_IMAGE_MAP[label];
  if (!filename) return;

  const img = document.createElement("img");
  img.src = CHORD_IMAGE_BASE + filename;
  img.alt = label;

  chordImageContainer.appendChild(img);
}

/****************************************************
 *  DROP ZONE INTERACTIONS
 ****************************************************/

/**
 * Clicking the drop zone triggers the hidden file input.
 */
dropZone.onclick = () => fileInput.click();

/**
 * Visual feedback when dragging a file over the drop zone.
 */
dropZone.ondragover = e => {
  e.preventDefault();
  dropZone.classList.add("dragover");
};

/**
 * Remove highlight when dragging leaves the zone.
 */
dropZone.ondragleave = () =>
  dropZone.classList.remove("dragover");

/**
 * Handle dropped files.
 */
dropZone.ondrop = e => {
  e.preventDefault();
  dropZone.classList.remove("dragover");

  if (e.dataTransfer.files[0]) {
    handleFile(e.dataTransfer.files[0]);
  }
};

/**
 * Handle manual file selection.
 */
fileInput.onchange = e => {
  if (e.target.files[0]) {
    handleFile(e.target.files[0]);
  }
};

/****************************************************
 *  FILE HANDLING + ANALYSIS
 ****************************************************/

/**
 * Main entry point when a user uploads an audio file.
 * - Resets UI state
 * - Loads audio into the player
 * - Sends audio to backend for chord analysis
 */
async function handleFile(file) {
  statusDiv.textContent = "Analyzing chords…";

  // Reset UI + state
  currentChords = [];
  setCurrentChordDisplay(null);
  chordsContainer.innerHTML = "";
  chordTagsDiv.innerHTML = "";
  summaryText.textContent = "";
  downloadBtn.disabled = true;

  // Clean up previous audio URL
  if (lastAudioUrl) URL.revokeObjectURL(lastAudioUrl);

  // Load audio into <audio> element
  lastAudioUrl = URL.createObjectURL(file);
  audioEl.src = lastAudioUrl;

  // Send base64-encoded audio to API
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      mimetype: file.type,
      data: arrayBufferToBase64(await file.arrayBuffer())
    })
  });

  // Parse response
  const result = await res.json();
  currentChords = result.chords || [];

  // Render UI outputs
  renderChords(currentChords);
  renderChordSummary(currentChords);

  statusDiv.textContent = "Chords detected.";
  downloadBtn.disabled = false;
}

/****************************************************
 *  RENDERING
 ****************************************************/

/**
 * Renders a time-aligned list of detected chords.
 */
function renderChords(chords) {
  const ul = document.createElement("ul");

  chords.forEach(c => {
    const li = document.createElement("li");
    li.textContent =
      `${formatTime(c.startSec)} – ${formatTime(c.endSec)} : ${c.label}`;
    ul.appendChild(li);
  });

  chordsContainer.appendChild(ul);
}

/**
 * Renders a compact summary of unique chords used.
 */
function renderChordSummary(chords) {
  const unique = [...new Set(chords.map(c => c.label))];

  summaryText.textContent =
    `This track uses ${unique.length} chords:`;

  unique.forEach(label => {
    const tag = document.createElement("div");
    tag.className = "chord-tag";
    tag.textContent = label;
    chordTagsDiv.appendChild(tag);
  });
}

/****************************************************
 *  AUDIO ↔ CHORD SYNC
 ****************************************************/

/**
 * Update current chord as audio plays.
 */
audioEl.ontimeupdate = () =>
  setCurrentChordDisplay(
    getChordAtTime(audioEl.currentTime)
  );

/**
 * Returns the chord active at time `t`.
 * Falls back to last chord if playback exceeds range.
 */
function getChordAtTime(t) {
  return (
    currentChords.find(
      c => t >= c.startSec && t < c.endSec
    ) ||
    currentChords.at(-1) ||
    null
  );
}

/****************************************************
 *  PDF DOWNLOAD
 ****************************************************/

/**
 * Generates a printable chord sheet using jsPDF.
 * Includes:
 * - Chord list
 * - Chord diagrams
 */
downloadBtn.onclick = async () => {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();

  pdf.setFontSize(18);
  pdf.text("Track2Tabs – Chord Sheet", 14, 20);

  let y = 30;
  const unique = [...new Set(currentChords.map(c => c.label))];

  pdf.setFontSize(14);
  pdf.text("Chord Map", 14, y);
  y += 8;

  // List chord names
  unique.forEach(ch => {
    pdf.text(`• ${ch}`, 20, y);
    y += 6;
  });

  y += 10;

  // Add chord diagrams
  for (const ch of unique) {
    const img = await loadImage(
      CHORD_IMAGE_BASE + CHORD_IMAGE_MAP[ch]
    );

    pdf.text(ch, 14, y);
    y += 4;
    pdf.addImage(img, "PNG", 14, y, 40, 50);
    y += 60;
  }

  pdf.save("track2tabs.pdf");
};

/**
 * Loads an image with CORS enabled so it can be
 * embedded into the PDF.
 */
function loadImage(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.src = src;
  });
}

/****************************************************
 *  UTILS
 ****************************************************/

/**
 * Converts seconds → mm:ss.ss format.
 */
function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(2).padStart(5, "0");
  return `${m}:${s}`;
}

/**
 * Converts ArrayBuffer → base64 string
 * (used to send audio via JSON).
 */
function arrayBufferToBase64(buffer) {
  let binary = "";
  new Uint8Array(buffer).forEach(
    b => binary += String.fromCharCode(b)
  );
  return btoa(binary);
}
