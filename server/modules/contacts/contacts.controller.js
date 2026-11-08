const store = require("../../db/store");
const { normalizePhone } = require("../../utils/phone");
const googleService = require("./google.service");

const contactsController = {
  /**
   * POST /api/contacts/match
   * Accepts { contacts: [{ name, phone }] }
   * Returns matched registered LinguaChat users with minimal safe data.
   */
  async matchContacts(req, res, next) {
    try {
      const { contacts } = req.body;
      if (!Array.isArray(contacts)) {
        return res.status(400).json({ status: "error", message: "contacts must be an array" });
      }

      const limited = contacts.slice(0, 500);
      const phoneMap = new Map();
      for (const c of limited) {
        const raw = c.phone || c.phoneNumber || "";
        const normalized = normalizePhone(raw);
        if (normalized) {
          phoneMap.set(normalized, {
            contactName: c.name || c.displayName || "",
            originalPhone: raw,
            normalizedPhone: normalized,
          });
        }
      }

      if (phoneMap.size === 0) {
        return res.json({
          status: "success",
          data: { matched: [], unmatchedContacts: [], unmatched: 0, total: limited.length },
        });
      }

      const phones = [...phoneMap.keys()];
      const matchedUsers = await store.findUsersByPhones(phones);

      const results = matchedUsers
        .filter((u) => u.id !== req.userId)
        .map((u) => ({
          id: u.id,
          displayName: u.displayName,
          phoneNumber: u.phoneNumber,
          avatarUrl: u.avatarUrl || null,
          primaryLang: u.primaryLang,
          contactName: phoneMap.get(u.phoneNumber)?.contactName || "",
        }));

      // Build unmatched list: phones in phoneMap that had no match
      const matchedPhones = new Set(matchedUsers.map((u) => u.phoneNumber));
      // Also exclude the requesting user's own phone
      const reqUser = await store.findUserById(req.userId);
      if (reqUser?.phoneNumber) matchedPhones.add(reqUser.phoneNumber);

      const unmatchedContacts = [];
      for (const [normalized, entry] of phoneMap) {
        if (!matchedPhones.has(normalized)) {
          unmatchedContacts.push({
            contactName: entry.contactName,
            phoneNumber: normalized,
          });
        }
      }

      res.json({
        status: "success",
        data: {
          matched: results,
          unmatchedContacts,
          unmatched: unmatchedContacts.length,
          total: limited.length,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/contacts/google-sync
   * Accepts { accessToken: "google-oauth-access-token" }
   * Fetches contacts from Google People API, normalizes phones,
   * bulk-matches against registered users, returns privacy-safe results.
   */
  async syncGoogle(req, res, next) {
    try {
      const { accessToken } = req.body;
      if (!accessToken || typeof accessToken !== "string") {
        return res.status(400).json({ status: "error", message: "Google access token is required" });
      }

      const result = await googleService.syncGoogleContacts(accessToken, req.userId);
      res.json({ status: "success", data: result });
    } catch (err) {
      // Surface Google-specific errors cleanly
      if (err.message?.includes("Google")) {
        return res.status(400).json({ status: "error", message: err.message });
      }
      next(err);
    }
  },
};

module.exports = contactsController;
