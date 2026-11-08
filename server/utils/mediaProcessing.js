/**
 * Media processing utilities (E5).
 *
 * Provides image normalization (EXIF strip, auto-rotate, resize, thumbnail)
 * via sharp, and video probing (duration, dimensions) + poster-frame
 * extraction via ffprobe/ffmpeg.
 *
 * ALL FUNCTIONS ARE GRACEFUL:
 *   - If sharp is not installed → image functions return null
 *   - If ffmpeg/ffprobe is not installed → video functions return null
 *   - Errors are caught, logged, and return null — never crash the upload
 *
 * This means the existing v1.0 upload flow works identically with or
 * without these tools installed. The caller (media.service.js) checks
 * the return value and stores processed results alongside the originals
 * only when processing succeeded.
 */

const { execFile } = require("child_process");
const { promisify } = require("util");
const path = require("path");
const fs = require("fs");
const os = require("os");

const execFileAsync = promisify(execFile);

// ─── Capability detection ───

let _sharp = null;
let _sharpAvailable = null;

function isSharpAvailable() {
  if (_sharpAvailable !== null) return _sharpAvailable;
  try {
    _sharp = require("sharp");
    _sharpAvailable = true;
  } catch {
    _sharpAvailable = false;
    console.warn("[mediaProcessing] sharp not available — image processing disabled");
  }
  return _sharpAvailable;
}

let _ffmpegAvailable = null;
let _ffprobePath = null;
let _ffmpegPath = null;

async function isFfmpegAvailable() {
  if (_ffmpegAvailable !== null) return _ffmpegAvailable;
  try {
    const { stdout } = await execFileAsync("ffprobe", ["-version"], { timeout: 5000 });
    if (stdout.includes("ffprobe")) {
      _ffprobePath = "ffprobe";
      _ffmpegPath = "ffmpeg";
      _ffmpegAvailable = true;
    } else {
      _ffmpegAvailable = false;
    }
  } catch {
    _ffmpegAvailable = false;
    console.warn("[mediaProcessing] ffmpeg/ffprobe not available — video processing disabled");
  }
  return _ffmpegAvailable;
}

// ─── Image processing ───

/**
 * Process an uploaded image buffer:
 *   1. Strip EXIF/GPS metadata (privacy)
 *   2. Auto-rotate based on EXIF orientation
 *   3. Normalize to JPEG (or keep WebP/PNG if originally that format)
 *   4. Generate a thumbnail (max 320px on longest side)
 *
 * @param {Buffer} buffer     Raw uploaded image bytes
 * @param {string} mimeType   Original MIME type
 * @returns {Promise<{ processed: Buffer, thumbnail: Buffer, width: number,
 *   height: number, format: string } | null>}
 */
async function processImage(buffer, mimeType) {
  if (!isSharpAvailable()) return null;

  try {
    const img = _sharp(buffer).rotate(); // auto-rotate from EXIF

    // Determine output format
    const isWebp = mimeType === "image/webp";
    const isPng = mimeType === "image/png";
    const isGif = mimeType === "image/gif";

    // For GIFs, skip processing (animated GIFs can't be safely processed)
    if (isGif) return null;

    // Get metadata before stripping
    const meta = await img.metadata();

    // Strip all metadata (EXIF, IPTC, XMP, GPS, ICC profile)
    const pipeline = img.removeAlpha ? img : img; // keep alpha for PNG/WebP
    let processed;
    if (isPng) {
      processed = await pipeline.png({ quality: 90 }).toBuffer();
    } else if (isWebp) {
      processed = await pipeline.webp({ quality: 85 }).toBuffer();
    } else {
      // Default: output as JPEG, strip metadata
      processed = await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    }

    // Generate thumbnail — max 320px on longest side
    const thumbPipeline = _sharp(buffer).rotate();
    const thumbnail = await thumbPipeline
      .resize(320, 320, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 70, mozjpeg: true })
      .toBuffer();

    return {
      processed,
      thumbnail,
      width: meta.width || 0,
      height: meta.height || 0,
      format: isPng ? "png" : isWebp ? "webp" : "jpeg",
    };
  } catch (err) {
    console.error("[mediaProcessing] image processing failed:", err.message);
    return null;
  }
}

// ─── Video processing ───

/**
 * Probe a video file for duration, dimensions, and codec.
 *
 * @param {string} filePath   Absolute path to the video file on disk
 * @returns {Promise<{ duration: number, width: number, height: number,
 *   codec: string, format: string } | null>}
 */
async function probeVideo(filePath) {
  if (!(await isFfmpegAvailable())) return null;

  try {
    const { stdout } = await execFileAsync(_ffprobePath, [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      filePath,
    ], { timeout: 15000 });

    const info = JSON.parse(stdout);
    const videoStream = (info.streams || []).find((s) => s.codec_type === "video");

    return {
      duration: parseFloat(info.format?.duration || "0"),
      width: videoStream?.width || 0,
      height: videoStream?.height || 0,
      codec: videoStream?.codec_name || "unknown",
      format: info.format?.format_name || "unknown",
    };
  } catch (err) {
    console.error("[mediaProcessing] ffprobe failed:", err.message);
    return null;
  }
}

/**
 * Extract a poster frame (thumbnail) from a video at 1 second in.
 *
 * @param {string} filePath   Absolute path to the video
 * @returns {Promise<Buffer | null>}   JPEG poster frame, or null
 */
async function extractPoster(filePath) {
  if (!(await isFfmpegAvailable())) return null;

  const tmpPoster = path.join(os.tmpdir(), `linguachat-poster-${Date.now()}.jpg`);
  try {
    await execFileAsync(_ffmpegPath, [
      "-y",                     // overwrite
      "-i", filePath,
      "-ss", "00:00:01",        // seek to 1s
      "-vframes", "1",          // one frame
      "-q:v", "5",              // quality
      "-vf", "scale=320:-2",    // max width 320, keep aspect, even height
      tmpPoster,
    ], { timeout: 15000 });

    if (fs.existsSync(tmpPoster)) {
      const buf = fs.readFileSync(tmpPoster);
      fs.unlinkSync(tmpPoster);
      return buf;
    }
    return null;
  } catch (err) {
    console.error("[mediaProcessing] poster extraction failed:", err.message);
    try { fs.unlinkSync(tmpPoster); } catch {}
    return null;
  }
}

// ─── Capability report ───

/**
 * Returns which processing tools are available. Useful for health checks
 * and honest feature reporting.
 */
async function getCapabilities() {
  return {
    sharp: isSharpAvailable(),
    ffmpeg: await isFfmpegAvailable(),
  };
}

/**
 * Reset detection caches (for tests).
 */
function _resetForTests() {
  _sharpAvailable = null;
  _sharp = null;
  _ffmpegAvailable = null;
  _ffprobePath = null;
  _ffmpegPath = null;
}

module.exports = {
  processImage,
  probeVideo,
  extractPoster,
  getCapabilities,
  isSharpAvailable,
  isFfmpegAvailable,
  _resetForTests,
};
