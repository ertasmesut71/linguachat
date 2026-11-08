const mediaService = require("./media.service");
const ApiError = require("../../utils/ApiError");
const config = require("../../config");

function buildPublicSignedUrl(signedUrl) {
  if (!config.storage.publicUrl || !signedUrl) return null;
  try {
    const u = new URL(signedUrl);
    const pub = new URL(config.storage.publicUrl);
    u.protocol = pub.protocol;
    u.host = pub.host;
    return u.toString();
  } catch {
    return null;
  }
}

const mediaController = {
  /**
   * POST /api/media/upload
   * Base64 JSON upload. Kept for backward compatibility and small files.
   */
  async upload(req, res, next) {
    try {
      const { data, originalName, mimeType } = req.body;
      if (!data) throw ApiError.badRequest("No file data");
      if (!originalName) throw ApiError.badRequest("originalName required");
      if (!mimeType) throw ApiError.badRequest("mimeType required");

      const buffer = Buffer.from(data, "base64");
      const result = await mediaService.upload(buffer, originalName, mimeType, req.userId);
      res.status(201).json({ status: "success", data: result });
    } catch (err) {
      if (err.message?.includes("MB limit") || err.message?.includes("Unsupported") || err.message?.includes("security scan")) {
        return next(ApiError.badRequest(err.message));
      }
      next(err);
    }
  },

  /**
   * POST /api/media/upload-stream
   * Multipart upload via multer (disk storage).
   * Supports large files + XHR upload progress on the client side.
   */
  async uploadStream(req, res, next) {
    const file = req.file;
    try {
      if (!file) throw ApiError.badRequest("No file uploaded");
      const result = await mediaService.uploadFromPath(
        file.path,
        file.originalname,
        file.mimetype,
        file.size,
        req.userId,
      );
      res.status(201).json({ status: "success", data: result });
    } catch (err) {
      // Clean up temp file on error
      if (file?.path) {
        try { require("fs").unlinkSync(file.path); } catch {}
      }
      if (err.message?.includes("MB limit") || err.message?.includes("Unsupported") || err.message?.includes("security scan")) {
        return next(ApiError.badRequest(err.message));
      }
      next(err);
    }
  },

  /**
   * GET /api/media/limits
   * Returns current size tiers + allowed MIME types so the client can
   * validate before starting an upload.
   */
  async limits(req, res) {
    res.json({
      status: "success",
      data: {
        sizeLimits: mediaService.sizeLimits,
        note: "bytes, per-kind",
      },
    });
  },

  /**
   * GET /api/media/:fileId
   * Authenticated serve with optional range-request streaming for video.
   */
  async serve(req, res, next) {
    try {
      const { fileId } = req.params;

      // Optional: redirect to public signed URL if configured
      if (config.storage.publicUrl) {
        const signedUrl = await mediaService.getSignedUrl(fileId);
        const publicUrl = buildPublicSignedUrl(signedUrl);
        if (publicUrl) return res.redirect(302, publicUrl);
      }

      const range = req.headers.range;
      const streamResult = await mediaService.getStream(fileId, range);
      if (!streamResult) throw ApiError.notFound("File");

      const originalName = streamResult.metadata?.originalName || "file";
      const contentType = streamResult.contentType;

      const headers = {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${encodeURIComponent(originalName)}"`,
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
        "Accept-Ranges": streamResult.acceptRanges || "bytes",
      };
      if (streamResult.contentLength !== undefined) {
        headers["Content-Length"] = streamResult.contentLength;
      }
      if (streamResult.contentRange) {
        headers["Content-Range"] = streamResult.contentRange;
      }

      res.writeHead(streamResult.statusCode || (streamResult.contentRange ? 206 : 200), headers);

      const stream = streamResult.stream;
      if (stream && typeof stream.pipe === "function") {
        stream.pipe(res);
        stream.on("error", (e) => {
          if (!res.headersSent) next(e);
          else res.destroy(e);
        });
      } else if (stream && typeof stream.getReader === "function") {
        // WHATWG ReadableStream (AWS SDK v3 web stream) — pump to response
        const reader = stream.getReader();
        (async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(Buffer.from(value));
            }
            res.end();
          } catch (e) {
            res.destroy(e);
          }
        })();
      } else {
        // Fallback: async iterable (AWS SDK v3 Node stream)
        (async () => {
          try {
            for await (const chunk of stream) res.write(chunk);
            res.end();
          } catch (e) {
            res.destroy(e);
          }
        })();
      }
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/media/:fileId/download
   * Forces download with attachment disposition.
   */
  async download(req, res, next) {
    try {
      const { fileId } = req.params;
      const file = await mediaService.get(fileId);
      if (!file) throw ApiError.notFound("File");

      const originalName = file.metadata?.originalName || "file";

      res.set({
        "Content-Type": "application/octet-stream",
        "Content-Length": file.buffer.length,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(originalName)}"`,
        "X-Content-Type-Options": "nosniff",
      });
      res.send(file.buffer);
    } catch (err) {
      next(err);
    }
  },
};

module.exports = mediaController;
