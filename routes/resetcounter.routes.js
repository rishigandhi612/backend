const express = require("express");
const router = express.Router();
const { resetCounter } = require("../controllers/cust-prod.controller");

router.post("/reset-counter", resetCounter);

module.exports = router;
