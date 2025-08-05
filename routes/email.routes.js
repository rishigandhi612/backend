const express = require("express");
const { sendOrderEmail } = require("../controllers/email.controller.js");

const router = express.Router();

router.post("/email", sendOrderEmail);

module.exports = router;