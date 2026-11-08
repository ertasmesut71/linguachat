const { Router } = require("express");
const { authenticate } = require("../../middleware/authenticate");
const ctrl = require("./search.controller");

const router = Router();
router.use(authenticate);
router.get("/", ctrl.search);

module.exports = router;
