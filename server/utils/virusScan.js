/**
 * Virus scan hook.
 *
 * This is an architectural integration point for antivirus scanning of
 * uploaded files. In its default unconfigured state, it passes all files
 * through (returns { clean: true }).
 *
 * To enable real scanning, wire this to ClamAV or a cloud service:
 *   - ClamAV via clamd: npm install clamdjs → scan stream
 *   - VirusTotal API: POST file hash → check report
 *   - AWS GuardDuty Malware Protection for S3: automatic, no code needed
 *
 * Always called AFTER size + MIME validation, BEFORE committing to storage.
 *
 * Returned shape: { clean: boolean, reason?: string, skipped?: boolean }
 */

const config = require("../config");

async function scan(_buffer, _mimeType, _filename) {
  // No scanner configured — skip with a clear indicator.
  if (!config.virusScan?.enabled) {
    return { clean: true, skipped: true, reason: "scanner not configured" };
  }

  // Future integration point. Example ClamAV stub:
  //
  // try {
  //   const clam = require("clamdjs").createScanner(
  //     config.virusScan.host,
  //     config.virusScan.port
  //   );
  //   const result = await clam.scanBuffer(buffer, 30000, 1024 * 1024);
  //   if (clam.isCleanReply(result)) return { clean: true };
  //   return { clean: false, reason: result };
  // } catch (err) {
  //   // Fail closed or fail open? Default fails closed.
  //   return { clean: false, reason: "scanner error: " + err.message };
  // }

  return { clean: true, skipped: true, reason: "stub" };
}

module.exports = { scan };
