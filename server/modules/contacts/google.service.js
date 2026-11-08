/**
 * Google Contacts Service.
 *
 * Fetches contacts from Google People API using a client-provided
 * OAuth access token. Extracts phone numbers, normalizes them via
 * the existing phone utility, and bulk-matches against registered
 * LinguaChat users.
 *
 * Architecture: the client obtains a Google access token via
 * Google Sign-In (client-side OAuth). The token is sent to the
 * server which uses it to call People API. No refresh tokens are
 * stored server-side — each sync requires a fresh client token.
 *
 * Required env vars (for client-side Google Sign-In):
 *   VITE_GOOGLE_CLIENT_ID — Google OAuth 2.0 Client ID
 *     (configured in the Google Cloud Console with
 *      the "People API" enabled and authorized origins set)
 */

const { normalizePhone } = require("../../utils/phone");
const store = require("../../db/store");

const PEOPLE_API_BASE = "https://people.googleapis.com/v1";

/**
 * Fetch contacts from Google People API.
 *
 * @param {string} accessToken  Google OAuth access token with contacts.readonly scope
 * @param {number} pageSize     Max contacts per page (default 200, max 1000)
 * @returns {Promise<Array<{ name: string, phones: string[] }>>}
 */
async function fetchGoogleContacts(accessToken, pageSize = 200) {
  const contacts = [];
  let nextPageToken = null;
  let pages = 0;
  const maxPages = 10; // safety cap: 10 pages × 200 = 2000 contacts max

  do {
    const params = new URLSearchParams({
      personFields: "names,phoneNumbers",
      pageSize: String(Math.min(pageSize, 1000)),
      sortOrder: "LAST_MODIFIED_DESCENDING",
    });
    if (nextPageToken) params.set("pageToken", nextPageToken);

    const url = `${PEOPLE_API_BASE}/people/me/connections?${params}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 401) {
        throw new Error("Google token expired or invalid. Please re-authenticate.");
      }
      throw new Error(`Google People API error (${res.status}): ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    const connections = data.connections || [];

    for (const person of connections) {
      const name = person.names?.[0]?.displayName || "";
      const phones = (person.phoneNumbers || [])
        .map((p) => p.value)
        .filter(Boolean);
      if (phones.length > 0) {
        contacts.push({ name, phones });
      }
    }

    nextPageToken = data.nextPageToken || null;
    pages++;
  } while (nextPageToken && pages < maxPages);

  return contacts;
}

/**
 * Fetch Google contacts, normalize phone numbers, and match against
 * registered LinguaChat users.
 *
 * @param {string} accessToken  Google OAuth access token
 * @param {string} requesterId  ID of the requesting user (excluded from results)
 * @returns {Promise<{ matched: Array, unmatched: number, total: number }>}
 */
async function syncGoogleContacts(accessToken, requesterId) {
  const raw = await fetchGoogleContacts(accessToken);

  // Normalize all phone numbers
  const phoneMap = new Map(); // normalized → { contactName }
  for (const contact of raw) {
    for (const phone of contact.phones) {
      const normalized = normalizePhone(phone);
      if (normalized && !phoneMap.has(normalized)) {
        phoneMap.set(normalized, { contactName: contact.name });
      }
    }
  }

  if (phoneMap.size === 0) {
    return { matched: [], unmatchedContacts: [], unmatched: 0, total: raw.length };
  }

  // Bulk match
  const phones = [...phoneMap.keys()];
  const matchedUsers = await store.findUsersByPhones(phones);

  const results = matchedUsers
    .filter((u) => u.id !== requesterId)
    .map((u) => ({
      id: u.id,
      displayName: u.displayName,
      phoneNumber: u.phoneNumber,
      avatarUrl: u.avatarUrl || null,
      primaryLang: u.primaryLang,
      contactName: phoneMap.get(u.phoneNumber)?.contactName || "",
    }));

  const matchedPhones = new Set(matchedUsers.map((u) => u.phoneNumber));
  const unmatchedContacts = [];
  for (const [normalized, entry] of phoneMap) {
    if (!matchedPhones.has(normalized)) {
      unmatchedContacts.push({ contactName: entry.contactName, phoneNumber: normalized });
    }
  }

  return {
    matched: results,
    unmatchedContacts,
    unmatched: unmatchedContacts.length,
    total: raw.length,
  };
}

module.exports = { fetchGoogleContacts, syncGoogleContacts };
