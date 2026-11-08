const { v4: uuidv4 } = require("uuid");
const storage = require("../../utils/storage");
const virusScan = require("../../utils/virusScan");
const mp = require("../../utils/mediaProcessing");

// ─── MIME classification ───
// Images
const IMAGE_MIME = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml", "image/heic", "image/heif",
]);
// Video
const VIDEO_MIME = new Set([
  "video/mp4", "video/webm", "video/quicktime", "video/x-matroska", "video/ogg",
]);
// Audio (standalone audio files, not voice messages)
const AUDIO_MIME = new Set([
  "audio/mpeg", "audio/wav", "audio/webm", "audio/mp4", "audio/ogg", "audio/x-m4a",
]);
// Documents
const DOC_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
  "application/rtf",
  "application/zip",
]);

// Per-kind size limits (bytes)
const SIZE_LIMITS = {
  image: 15 * 1024 * 1024,      // 15 MB
  video: 100 * 1024 * 1024,     // 100 MB
  audio: 25 * 1024 * 1024,      // 25 MB
  document: 25 * 1024 * 1024,   // 25 MB
};

function classify(mimeType) {
  if (IMAGE_MIME.has(mimeType)) return "image";
  if (VIDEO_MIME.has(mimeType)) return "video";
  if (AUDIO_MIME.has(mimeType)) return "audio";
  if (DOC_MIME.has(mimeType)) return "document";
  return null;
}

function isAllowed(mimeType) {
  return classify(mimeType) !== null;
}

function limitFor(mimeType) {
  const kind = classify(mimeType);
  return kind ? SIZE_LIMITS[kind] : 0;
}

/**
 * Convert a classified kind to a message `type` value used in the DB.
 *   image → "image"
 *   video → "video"
 *   audio → "file"    (voice messages use "voice", audio-file attachments are generic files)
 *   document → "file"
 */
function kindToMessageType(kind) {
  if (kind === "image") return "image";
  if (kind === "video") return "video";
  return "file";
}

class MediaService {
  /**
   * Upload from an in-memory buffer (base64 path — small files).
   * Enforces per-MIME size limits and runs virus scan hook.
   */
  async upload(buffer, originalName, mimeType, uploadedBy) {
    const kind = classify(mimeType);
    if (!kind) throw new Error(`Unsupported file type: ${mimeType}`);

    const max = SIZE_LIMITS[kind];
    if (buffer.length > max) {
      throw new Error(`File exceeds ${Math.round(max / 1024 / 1024)}MB limit for ${kind}`);
    }

    // Virus scan (stub by default — see server/utils/virusScan.js)
    const scanResult = await virusScan.scan(buffer, mimeType, originalName);
    if (!scanResult.clean) {
      throw new Error(`File rejected by security scan: ${scanResult.reason || "unknown"}`);
    }

    const fileId = uuidv4();
    const ext = (originalName || "").split(".").pop() || "";
    const key = `media/${fileId}`;

    // E5 — image processing: EXIF strip + thumbnail
    let imageInfo = null;
    let thumbnailUrl = null;
    if (kind === "image") {
      try {
        imageInfo = await mp.processImage(buffer, mimeType);
        if (imageInfo) {
          // Store the EXIF-stripped processed image as the primary
          await storage.put(key, imageInfo.processed, mimeType, {
            originalName, ext, uploadedBy, size: String(imageInfo.processed.length),
            kind, width: String(imageInfo.width), height: String(imageInfo.height),
          });
          // Store thumbnail alongside
          const thumbKey = `media/${fileId}_thumb`;
          await storage.put(thumbKey, imageInfo.thumbnail, "image/jpeg", {
            originalName: `thumb_${originalName}`, kind: "thumbnail",
          });
          thumbnailUrl = `/api/media/${fileId}_thumb`;
        }
      } catch (err) {
        console.error("[media] image processing failed, storing original:", err.message);
        imageInfo = null;
      }
    }

    // If image processing didn't run or failed, store the raw original
    if (!imageInfo) {
      await storage.put(key, buffer, mimeType, {
        originalName, ext, uploadedBy, size: String(buffer.length), kind,
      });
    }

    return {
      fileId,
      url: `/api/media/${fileId}`,
      thumbnailUrl,
      originalName,
      mimeType,
      size: imageInfo ? imageInfo.processed.length : buffer.length,
      kind,
      messageType: kindToMessageType(kind),
      isImage: kind === "image",
      isVideo: kind === "video",
      width: imageInfo?.width || null,
      height: imageInfo?.height || null,
      virusScan: scanResult.skipped ? "skipped" : "clean",
    };
  }

  /**
   * Upload from a filesystem path (multer disk path — large files/video).
   * Enforces size and scans without loading whole file into memory twice.
   */
  async uploadFromPath(sourcePath, originalName, mimeType, size, uploadedBy) {
    const kind = classify(mimeType);
    if (!kind) throw new Error(`Unsupported file type: ${mimeType}`);

    const max = SIZE_LIMITS[kind];
    if (size > max) {
      throw new Error(`File exceeds ${Math.round(max / 1024 / 1024)}MB limit for ${kind}`);
    }

    // For the hook stub we read a small head prefix (up to 2MB) for scanning.
    // A real ClamAV integration would stream the whole file.
    const fs = require("fs");
    const fd = fs.openSync(sourcePath, "r");
    try {
      const headSize = Math.min(size, 2 * 1024 * 1024);
      const head = Buffer.alloc(headSize);
      fs.readSync(fd, head, 0, headSize, 0);
      const scanResult = await virusScan.scan(head, mimeType, originalName);
      if (!scanResult.clean) {
        throw new Error(`File rejected by security scan: ${scanResult.reason || "unknown"}`);
      }
    } finally {
      fs.closeSync(fd);
    }

    const fileId = uuidv4();
    const ext = (originalName || "").split(".").pop() || "";
    const key = `media/${fileId}`;

    await storage.putFromPath(key, sourcePath, mimeType, {
      originalName, ext, uploadedBy, size: String(size), kind,
    });

    // E5 — video processing: probe metadata + extract poster frame
    let videoMeta = null;
    let posterUrl = null;
    if (kind === "video") {
      try {
        videoMeta = await mp.probeVideo(sourcePath);
        const posterBuf = await mp.extractPoster(sourcePath);
        if (posterBuf) {
          const posterKey = `media/${fileId}_poster`;
          await storage.put(posterKey, posterBuf, "image/jpeg", {
            originalName: `poster_${originalName}`, kind: "poster",
          });
          posterUrl = `/api/media/${fileId}_poster`;
        }
      } catch (err) {
        console.error("[media] video processing failed:", err.message);
      }
    }

    return {
      fileId,
      url: `/api/media/${fileId}`,
      posterUrl,
      originalName,
      mimeType,
      size,
      kind,
      messageType: kindToMessageType(kind),
      isImage: kind === "image",
      isVideo: kind === "video",
      duration: videoMeta?.duration || null,
      width: videoMeta?.width || null,
      height: videoMeta?.height || null,
      codec: videoMeta?.codec || null,
      virusScan: "head-scanned",
    };
  }

  async get(fileId) {
    const key = `media/${fileId}`;
    return storage.get(key);
  }

  /** Streaming get for video range requests. */
  async getStream(fileId, range) {
    const key = `media/${fileId}`;
    return storage.getStream(key, range);
  }

  async delete(fileId) {
    const key = `media/${fileId}`;
    await storage.delete(key);
  }

  async getSignedUrl(fileId, expiresIn = 3600) {
    const key = `media/${fileId}`;
    return storage.getSignedUrl(key, expiresIn);
  }

  // Expose classification helpers for use in controller/routes
  classify(mimeType) { return classify(mimeType); }
  isAllowed(mimeType) { return isAllowed(mimeType); }
  limitFor(mimeType) { return limitFor(mimeType); }
  get sizeLimits() { return { ...SIZE_LIMITS }; }

  /** E5 — report which media processing tools are available. */
  async getProcessingCapabilities() { return mp.getCapabilities(); }
}

module.exports = new MediaService();
