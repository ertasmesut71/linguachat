const { Router } = require("express");
const { z } = require("zod");
const { validate } = require("../../middleware/validate");
const { authenticate } = require("../../middleware/authenticate");
const usersController = require("./users.controller");

const router = Router();

// All user routes require authentication
router.use(authenticate);

// ─── Validation Schemas ───

const SUPPORTED_LANGUAGES = [
  "en", "tr", "es", "fr", "de", "ja", "zh", "ar", "ko", "pt", "ru", "hi",
  "it", "nl", "pl", "sv", "da", "fi", "no", "el", "cs", "ro", "hu", "th",
  "vi", "id", "ms", "uk", "bg", "hr", "sk", "sl",
];

const updateProfileSchema = z.object({
  displayName: z
    .string()
    .min(1, "Display name is required")
    .max(100, "Display name too long")
    .trim()
    .optional(),
  bio: z
    .string()
    .max(500, "Bio too long")
    .optional(),
  avatarUrl: z
    .string()
    .url("Invalid avatar URL")
    .max(500)
    .optional()
    .nullable(),
  primaryLang: z
    .enum(SUPPORTED_LANGUAGES, {
      errorMap: () => ({ message: "Unsupported language" }),
    })
    .optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(["online", "away", "offline", "do_not_disturb"], {
    errorMap: () => ({ message: "Invalid status" }),
  }),
});

const updateLanguageSchema = z.object({
  primaryLang: z.enum(SUPPORTED_LANGUAGES, {
    errorMap: () => ({ message: "Unsupported language" }),
  }),
});

// ─── Routes ───

// Current user profile
router.get("/me/profile", usersController.getMyProfile);
router.patch("/me/profile", validate(updateProfileSchema), usersController.updateMyProfile);
router.patch("/me/status", validate(updateStatusSchema), usersController.updateMyStatus);
router.patch("/me/language", validate(updateLanguageSchema), usersController.updateMyLanguage);
router.post("/me/avatar", usersController.uploadAvatar);

// User discovery
router.get("/search", usersController.searchUsers);
router.get("/", usersController.listUsers);
router.get("/:id", usersController.getUserById);

// Block / Report (H)
router.get("/:id/block-status", usersController.getBlockStatus);
router.post("/:id/block", usersController.blockUser);
router.delete("/:id/block", usersController.unblockUser);
router.post("/:id/report", validate(z.object({
  reason: z.string().min(1, "Reason required").max(1000).trim(),
})), usersController.reportUser);

module.exports = router;
