const { Router } = require("express");
const { authenticate } = require("../../middleware/authenticate");
const ctrl = require("./contacts.controller");

const router = Router();
router.use(authenticate);

// POST /api/contacts/match — bulk phone match
router.post("/match", ctrl.matchContacts);

// POST /api/contacts/google-sync — fetch Google contacts + match
router.post("/google-sync", ctrl.syncGoogle);

module.exports = router;
