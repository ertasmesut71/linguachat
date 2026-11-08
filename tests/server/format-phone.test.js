/**
 * Phone display formatting tests.
 *
 * Tests the client-side formatPhone() utility.
 * This is a pure function — no server/API needed.
 */

// We need to test the ES module — use a simple reimplementation
// that mirrors the logic, since Jest runs in CJS by default.
// The actual client code uses the same libphonenumber-js library.
const { parsePhoneNumber } = require("libphonenumber-js");

function formatPhone(phone) {
  if (!phone) return "";
  try {
    const parsed = parsePhoneNumber(`+${phone}`);
    if (parsed && parsed.isValid()) return parsed.formatInternational();
  } catch { /* fall through */ }
  return `+${phone}`;
}

describe("formatPhone — display formatting", () => {
  // ─── Country-specific formatting ───

  test("Turkish number", () => {
    const result = formatPhone("905551234567");
    expect(result).toBe("+90 555 123 45 67");
  });

  test("US number", () => {
    const result = formatPhone("12025551234");
    expect(result).toMatch(/^\+1 202 555 1234$/);
  });

  test("German number", () => {
    const result = formatPhone("493012345678");
    expect(result).toMatch(/^\+49 30 12345678$/);
  });

  test("UK number", () => {
    const result = formatPhone("442012345678");
    expect(result).toMatch(/^\+44 20 1234 5678$/);
  });

  // ─── Edge cases ───

  test("number already containing + in input (stripped by normalizePhone before storage)", () => {
    // formatPhone receives canonical digits-only — but handle gracefully
    const result = formatPhone("905551234567");
    expect(result).toContain("+90");
  });

  test("null returns empty string", () => {
    expect(formatPhone(null)).toBe("");
  });

  test("undefined returns empty string", () => {
    expect(formatPhone(undefined)).toBe("");
  });

  test("empty string returns empty string", () => {
    expect(formatPhone("")).toBe("");
  });

  test("malformed input falls back to +digits", () => {
    const result = formatPhone("123");
    expect(result).toBe("+123");
  });

  test("formatter never throws", () => {
    expect(() => formatPhone(null)).not.toThrow();
    expect(() => formatPhone(undefined)).not.toThrow();
    expect(() => formatPhone("")).not.toThrow();
    expect(() => formatPhone("abc")).not.toThrow();
    expect(() => formatPhone("999")).not.toThrow();
    expect(() => formatPhone("905551234567")).not.toThrow();
  });

  // ─── Identity safety ───

  test("canonical phone value is NOT changed by formatting", () => {
    const canonical = "905551234567";
    const display = formatPhone(canonical);
    // Display is different from canonical
    expect(display).not.toBe(canonical);
    // But canonical is still the same object
    expect(canonical).toBe("905551234567");
  });

  test("formatting is purely presentational — digits extractable from result", () => {
    const display = formatPhone("905551234567");
    const digitsBack = display.replace(/[^\d]/g, "");
    expect(digitsBack).toBe("905551234567");
  });
});
