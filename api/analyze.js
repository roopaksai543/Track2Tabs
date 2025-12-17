// ---------------------------------------------
// Next.js API route configuration
// ---------------------------------------------
// Increase body size limit to support large
// base64-encoded audio uploads
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "25mb",
    },
  },
};

// ---------------------------------------------
// Main API handler
// ---------------------------------------------
export default async function handler(req, res) {
  // Only allow POST requests (audio uploads)
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Extract expected fields from request body
    // data = base64-encoded audio
    const { filename, mimetype, data } = req.body;

    // Validate required audio payload
    if (!data) {
      return res.status(400).json({ error: "Missing audio data" });
    }

    // ---------------------------------------------
    // Decode base64 audio into raw binary buffer
    // ---------------------------------------------
    const audioBuffer = Buffer.from(data, "base64");

    // ---------------------------------------------
    // Create multipart/form-data payload
    // ---------------------------------------------
    // Vercel runtime supports Web API FormData, Blob
    const formData = new FormData();

    // Wrap binary audio in a Blob so it behaves like
    // a real file upload for FastAPI
    const blob = new Blob(
      [audioBuffer],
      { type: mimetype || "audio/wav" }
    );

    // Append file under "file" key (matches FastAPI endpoint)
    formData.append(
      "file",
      blob,
      filename || "audio.wav"
    );

    // ---------------------------------------------
    // Forward audio to Python (Railway) backend
    // ---------------------------------------------
    const pythonResponse = await fetch(
      "https://tracktotab-proto3-production.up.railway.app/chords",
      {
        method: "POST",
        body: formData,
        // IMPORTANT:
        // Do NOT manually set Content-Type.
        // FormData automatically sets multipart boundaries.
      }
    );

    // ---------------------------------------------
    // Handle Python backend errors explicitly
    // ---------------------------------------------
    if (!pythonResponse.ok) {
      const text = await pythonResponse.text();
      console.error("Python service error:", text);

      return res.status(500).json({
        error: "Python service failed",
        details: text,
      });
    }

    // Parse successful response
    const result = await pythonResponse.json();

    // Return chord detection output to frontend
    return res.status(200).json(result);

  } catch (err) {
    // ---------------------------------------------
    // Catch unexpected server-side errors
    // ---------------------------------------------
    console.error("Analyze API error:", err);

    return res.status(500).json({
      error: "Server error",
      details: err.message,
    });
  }
}
