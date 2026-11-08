/**
 * Device Contacts Abstraction.
 *
 * Uses @capacitor-community/contacts when running inside a native
 * Capacitor shell (Android/iOS). On the web, returns a clean
 * "not available" result so the UI can fall back to manual import
 * or Google Contacts sync.
 *
 * This module never throws — all errors are returned as
 * { available: false, reason: "..." } so the UI can handle them
 * gracefully without try/catch.
 */

import { Capacitor } from "@capacitor/core";

/**
 * Check if native device contacts access is available.
 * True only when running inside a real Capacitor native shell.
 */
export function isDeviceContactsAvailable() {
  return Capacitor.isNativePlatform();
}

/**
 * Request permission and read device contacts.
 *
 * @returns {Promise<{
 *   available: boolean,
 *   granted: boolean,
 *   contacts: Array<{ name: string, phone: string }>,
 *   reason?: string
 * }>}
 */
export async function readDeviceContacts() {
  if (!isDeviceContactsAvailable()) {
    return {
      available: false,
      granted: false,
      contacts: [],
      reason: "Device contacts are only available in the native Android/iOS app.",
    };
  }

  try {
    // Dynamic import — only loaded on native platforms where the plugin exists
    const { Contacts } = await import("@capacitor-community/contacts");

    // Request permission
    const permResult = await Contacts.requestPermissions();
    if (permResult.contacts !== "granted") {
      return {
        available: true,
        granted: false,
        contacts: [],
        reason: "Contacts permission was denied. You can enable it in your device settings.",
      };
    }

    // Read contacts — request only names and phone numbers
    const result = await Contacts.getContacts({
      projection: {
        name: true,
        phones: true,
      },
    });

    // Extract and flatten
    const contacts = [];
    for (const c of result.contacts || []) {
      const name = c.name?.display || "";
      const phones = (c.phones || []).map((p) => p.number).filter(Boolean);
      for (const phone of phones) {
        contacts.push({ name, phone });
      }
    }

    return {
      available: true,
      granted: true,
      contacts,
    };
  } catch (err) {
    return {
      available: true,
      granted: false,
      contacts: [],
      reason: err?.message || "Failed to read device contacts.",
    };
  }
}
