const { sanitizeText, sanitizeName } = require("../../server/utils/sanitize");

describe("sanitizeText", () => {
  test("returns empty string for null/undefined/non-string", () => {
    expect(sanitizeText(null)).toBe("");
    expect(sanitizeText(undefined)).toBe("");
    expect(sanitizeText(123)).toBe("");
    expect(sanitizeText("")).toBe("");
  });

  test("strips <script> tags", () => {
    const out = sanitizeText("<script>alert(1)</script>hello");
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("</script>");
    expect(out).toContain("hello");
  });

  test("strips arbitrary HTML tags but keeps inner text", () => {
    const out = sanitizeText("<b>bold</b> <i>italic</i>");
    expect(out).not.toContain("<b>");
    expect(out).not.toContain("<i>");
    expect(out).toContain("bold");
    expect(out).toContain("italic");
  });

  test("strips javascript: and data: URIs", () => {
    expect(sanitizeText("click javascript:alert(1) here")).not.toContain("javascript:");
    expect(sanitizeText("data:text/html,<x>")).not.toMatch(/data\s*:/i);
  });

  test("strips event handler attributes", () => {
    const out = sanitizeText('Hi onclick="evil()" there');
    expect(out).not.toMatch(/onclick/i);
  });

  test("preserves unicode, emoji, newlines, normal punctuation", () => {
    const input = "Hello 🌍 world!\nこんにちは merhaba\nПривет — thanks.";
    const out = sanitizeText(input);
    expect(out).toContain("🌍");
    expect(out).toContain("こんにちは");
    expect(out).toContain("Привет");
    expect(out).toContain("\n");
  });

  test("truncates beyond maxLength", () => {
    const big = "a".repeat(20000);
    expect(sanitizeText(big, { maxLength: 100 }).length).toBe(100);
  });

  test("default maxLength is 10000", () => {
    const big = "a".repeat(20000);
    expect(sanitizeText(big).length).toBe(10000);
  });

  test("trims surrounding whitespace", () => {
    expect(sanitizeText("  hello  ")).toBe("hello");
  });
});

describe("sanitizeName", () => {
  test("strips HTML", () => {
    expect(sanitizeName("<b>Evil</b> Name")).not.toContain("<b>");
    expect(sanitizeName("<b>Evil</b> Name")).toContain("Evil");
  });

  test("caps at 100 chars", () => {
    expect(sanitizeName("x".repeat(200)).length).toBe(100);
  });

  test("returns empty for non-strings", () => {
    expect(sanitizeName(null)).toBe("");
    expect(sanitizeName(42)).toBe("");
  });
});
