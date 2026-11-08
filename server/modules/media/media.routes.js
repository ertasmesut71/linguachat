const { Router } = require("express");
const multer = require("multer");
const os = require("os");
const path = require("path");
const { authenticate } = require("../../middleware/authenticate");
const { uploadLimiter } = require("../../middleware/rateLimit");
const ctrl = require("./media.controller");

const router = Router();

// Multer disk storage — files written to OS temp dir, then moved/streamed
// to final storage by the service layer. Limits: 100MB hard cap (video tier).
// Per-MIME tier limits are enforced in the service after multer accepts.
const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(os.tmpdir(), "linguachat-uploads"),
    filename: (_req, file, cb) => {
      const safe = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
      cb(null, safe);
    },
  }),
  limits: {
    fileSize: 100 * 1024 * 1024,   // hard upper bound (video max)
    files: 1,
  },
});

// Public meta endpoint (authenticated) — reports tier limits to the client
router.get("/limits", authenticate, ctrl.limits);

// Authenticated serve + download. Auth middleware accepts token via header,
// cookie, OR query string (?token=) — see PART 1 fix.
router.get("/:fileId", authenticate, ctrl.serve);
router.get("/:fileId/download", authenticate, ctrl.download);

// Legacy base64 upload (kept for compatibility).
router.post("/upload", authenticate, uploadLimiter, ctrl.upload);

// Streaming multipart upload (preferred; supports progress + large files).
router.post("/upload-stream", authenticate, uploadLimiter, upload.single("file"), ctrl.uploadStream);

module.exports = router;
