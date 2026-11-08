const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const fs = require("fs");
const path = require("path");
const config = require("../config");

let s3 = null;
let bucket = null;
let useS3 = false;

function initStorage() {
  if (config.storage.endpoint && config.storage.accessKeyId) {
    s3 = new S3Client({
      region: config.storage.region || "auto",
      endpoint: config.storage.endpoint,
      credentials: {
        accessKeyId: config.storage.accessKeyId,
        secretAccessKey: config.storage.secretAccessKey,
      },
      forcePathStyle: true,
    });
    bucket = config.storage.bucket;
    useS3 = true;
    console.log(`  ✓ Storage: S3/R2 (${config.storage.endpoint})`);
  } else {
    const dir = path.resolve(__dirname, "../data/uploads");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    console.log("  ✓ Storage: Local filesystem (server/data/uploads/)");
  }
}

initStorage();

const LOCAL_DIR = path.resolve(__dirname, "../data/uploads");

function localPath(key) {
  const safe = key.replace(/\//g, "_");
  return path.join(LOCAL_DIR, safe);
}

function localMetaPath(key) {
  return localPath(key) + ".meta.json";
}

function flattenMetadata(obj) {
  const flat = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) flat[k] = String(v);
  }
  return flat;
}

const storage = {
  /**
   * Store a buffer (small files / base64 path).
   */
  async put(key, buffer, contentType, metadata = {}) {
    if (useS3) {
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        Metadata: flattenMetadata(metadata),
      }));
    } else {
      if (!fs.existsSync(LOCAL_DIR)) fs.mkdirSync(LOCAL_DIR, { recursive: true });
      fs.writeFileSync(localPath(key), buffer);
      fs.writeFileSync(localMetaPath(key), JSON.stringify({
        contentType,
        size: buffer.length,
        ...metadata,
        createdAt: new Date().toISOString(),
      }));
    }
  },

  /**
   * Store a file from a filesystem path (used by multer disk storage for large uploads).
   * Streams to S3/R2 or moves/renames for local filesystem — avoids doubling memory usage.
   */
  async putFromPath(key, sourcePath, contentType, metadata = {}) {
    if (useS3) {
      const body = fs.createReadStream(sourcePath);
      const stat = fs.statSync(sourcePath);
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: stat.size,
        Metadata: flattenMetadata(metadata),
      }));
    } else {
      if (!fs.existsSync(LOCAL_DIR)) fs.mkdirSync(LOCAL_DIR, { recursive: true });
      // Try rename first (same filesystem), fall back to copy+unlink
      const dest = localPath(key);
      try {
        fs.renameSync(sourcePath, dest);
      } catch {
        fs.copyFileSync(sourcePath, dest);
        try { fs.unlinkSync(sourcePath); } catch {}
      }
      const stat = fs.statSync(dest);
      fs.writeFileSync(localMetaPath(key), JSON.stringify({
        contentType,
        size: stat.size,
        ...metadata,
        createdAt: new Date().toISOString(),
      }));
    }
  },

  async get(key) {
    if (useS3) {
      try {
        const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const chunks = [];
        for await (const chunk of resp.Body) chunks.push(chunk);
        return {
          buffer: Buffer.concat(chunks),
          contentType: resp.ContentType || "application/octet-stream",
          metadata: resp.Metadata || {},
        };
      } catch (err) {
        if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) return null;
        throw err;
      }
    } else {
      const fp = localPath(key);
      if (!fs.existsSync(fp)) return null;
      const buffer = fs.readFileSync(fp);
      let meta = {};
      const mp = localMetaPath(key);
      if (fs.existsSync(mp)) {
        try { meta = JSON.parse(fs.readFileSync(mp, "utf-8")); } catch {}
      }
      return {
        buffer,
        contentType: meta.contentType || "application/octet-stream",
        metadata: meta,
      };
    }
  },

  /**
   * Stream GET — returns { stream, contentType, contentLength, metadata }.
   * For range-request support on video.
   */
  async getStream(key, range) {
    if (useS3) {
      try {
        const cmd = new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ...(range ? { Range: range } : {}),
        });
        const resp = await s3.send(cmd);
        return {
          stream: resp.Body,
          contentType: resp.ContentType || "application/octet-stream",
          contentLength: resp.ContentLength,
          contentRange: resp.ContentRange,
          acceptRanges: resp.AcceptRanges,
          metadata: resp.Metadata || {},
        };
      } catch (err) {
        if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) return null;
        throw err;
      }
    } else {
      const fp = localPath(key);
      if (!fs.existsSync(fp)) return null;
      const stat = fs.statSync(fp);
      let meta = {};
      const mp = localMetaPath(key);
      if (fs.existsSync(mp)) {
        try { meta = JSON.parse(fs.readFileSync(mp, "utf-8")); } catch {}
      }

      if (range) {
        const match = /bytes=(\d+)-(\d*)/.exec(range);
        if (match) {
          const start = parseInt(match[1], 10);
          const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
          const stream = fs.createReadStream(fp, { start, end });
          return {
            stream,
            contentType: meta.contentType || "application/octet-stream",
            contentLength: end - start + 1,
            contentRange: `bytes ${start}-${end}/${stat.size}`,
            acceptRanges: "bytes",
            statusCode: 206,
            metadata: meta,
          };
        }
      }

      const stream = fs.createReadStream(fp);
      return {
        stream,
        contentType: meta.contentType || "application/octet-stream",
        contentLength: stat.size,
        acceptRanges: "bytes",
        metadata: meta,
      };
    }
  },

  async delete(key) {
    if (useS3) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch {}
    } else {
      const fp = localPath(key);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      const mp = localMetaPath(key);
      if (fs.existsSync(mp)) fs.unlinkSync(mp);
    }
  },

  async exists(key) {
    if (useS3) {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch {
        return false;
      }
    } else {
      return fs.existsSync(localPath(key));
    }
  },

  async getSignedUrl(key, expiresIn = 3600) {
    if (!useS3) return null;
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
    return url;
  },

  get isCloud() { return useS3; },
};

module.exports = storage;
