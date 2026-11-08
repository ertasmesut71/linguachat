/**
 * E5 — Media processing tests.
 *
 * Tests processImage, probeVideo, extractPoster, and capability detection.
 * Uses real sharp (available in this environment) and real ffmpeg.
 * Creates tiny test fixtures inline — no external files needed.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const mp = require("../../server/utils/mediaProcessing");

// Generate a minimal 10x10 red JPEG via sharp for image tests
let testImageBuffer = null;

beforeAll(async () => {
  mp._resetForTests();
  try {
    const sharp = require("sharp");
    testImageBuffer = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } },
    }).jpeg().toBuffer();
  } catch {
    testImageBuffer = null;
  }
});

afterAll(() => {
  mp._resetForTests();
});

describe("mediaProcessing (E5)", () => {
  describe("capability detection", () => {
    test("isSharpAvailable returns boolean", () => {
      mp._resetForTests();
      const result = mp.isSharpAvailable();
      expect(typeof result).toBe("boolean");
      // In this test environment, sharp IS available
      expect(result).toBe(true);
    });

    test("isFfmpegAvailable returns boolean", async () => {
      mp._resetForTests();
      const result = await mp.isFfmpegAvailable();
      expect(typeof result).toBe("boolean");
      // In this environment, ffmpeg IS available
      expect(result).toBe(true);
    });

    test("getCapabilities reports both tools", async () => {
      mp._resetForTests();
      const caps = await mp.getCapabilities();
      expect(caps).toEqual({ sharp: true, ffmpeg: true });
    });
  });

  describe("processImage", () => {
    test("processes a JPEG buffer: strips EXIF + generates thumbnail", async () => {
      if (!testImageBuffer) return; // skip if sharp not available

      const result = await mp.processImage(testImageBuffer, "image/jpeg");
      expect(result).not.toBeNull();
      expect(result.processed).toBeInstanceOf(Buffer);
      expect(result.thumbnail).toBeInstanceOf(Buffer);
      expect(result.width).toBe(10);
      expect(result.height).toBe(10);
      expect(result.format).toBe("jpeg");

      // Processed image should be valid JPEG (starts with FF D8)
      expect(result.processed[0]).toBe(0xFF);
      expect(result.processed[1]).toBe(0xD8);

      // Thumbnail should also be valid JPEG
      expect(result.thumbnail[0]).toBe(0xFF);
      expect(result.thumbnail[1]).toBe(0xD8);
    });

    test("returns format 'webp' for WebP input", async () => {
      if (!testImageBuffer) return;
      const sharp = require("sharp");
      const webpBuf = await sharp({
        create: { width: 5, height: 5, channels: 3, background: { r: 0, g: 255, b: 0 } },
      }).webp().toBuffer();

      const result = await mp.processImage(webpBuf, "image/webp");
      expect(result).not.toBeNull();
      expect(result.format).toBe("webp");
    });

    test("returns null for GIFs (skip processing)", async () => {
      const result = await mp.processImage(Buffer.from("GIF89a"), "image/gif");
      expect(result).toBeNull();
    });

    test("returns null for corrupt/invalid buffer", async () => {
      const result = await mp.processImage(Buffer.from("not an image"), "image/jpeg");
      expect(result).toBeNull();
    });
  });

  describe("probeVideo", () => {
    let testVideoPath = null;

    beforeAll(() => {
      // Generate a minimal 1-second test video via ffmpeg
      testVideoPath = path.join(os.tmpdir(), `linguachat-test-${Date.now()}.mp4`);
      try {
        execFileSync("ffmpeg", [
          "-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:d=1",
          "-c:v", "libx264", "-pix_fmt", "yuv420p",
          "-movflags", "+faststart",
          testVideoPath,
        ], { timeout: 10000, stdio: "pipe" });
      } catch {
        testVideoPath = null;
      }
    });

    afterAll(() => {
      if (testVideoPath) try { fs.unlinkSync(testVideoPath); } catch {}
    });

    test("probes a valid video and returns metadata", async () => {
      if (!testVideoPath) return;
      const result = await mp.probeVideo(testVideoPath);
      expect(result).not.toBeNull();
      expect(result.duration).toBeGreaterThan(0);
      expect(result.width).toBe(64);
      expect(result.height).toBe(64);
      expect(typeof result.codec).toBe("string");
    });

    test("returns null for nonexistent file", async () => {
      const result = await mp.probeVideo("/tmp/nonexistent-video-12345.mp4");
      expect(result).toBeNull();
    });
  });

  describe("extractPoster", () => {
    let testVideoPath = null;

    beforeAll(() => {
      testVideoPath = path.join(os.tmpdir(), `linguachat-poster-test-${Date.now()}.mp4`);
      try {
        execFileSync("ffmpeg", [
          "-y", "-f", "lavfi", "-i", "color=c=red:s=64x64:d=2",
          "-c:v", "libx264", "-pix_fmt", "yuv420p",
          testVideoPath,
        ], { timeout: 10000, stdio: "pipe" });
      } catch {
        testVideoPath = null;
      }
    });

    afterAll(() => {
      if (testVideoPath) try { fs.unlinkSync(testVideoPath); } catch {}
    });

    test("extracts a JPEG poster frame from a valid video", async () => {
      if (!testVideoPath) return;
      const poster = await mp.extractPoster(testVideoPath);
      expect(poster).toBeInstanceOf(Buffer);
      expect(poster.length).toBeGreaterThan(100);
      // Valid JPEG starts with FF D8
      expect(poster[0]).toBe(0xFF);
      expect(poster[1]).toBe(0xD8);
    });

    test("returns null for nonexistent file", async () => {
      const result = await mp.extractPoster("/tmp/nonexistent-video-99999.mp4");
      expect(result).toBeNull();
    });
  });
});
