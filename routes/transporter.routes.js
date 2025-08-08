const express = require("express");
const router = express.Router();

const {
  createTransporter,
  getAllTransporters,
  getTransporterById,
  updateTransporter,
  deleteTransporter
} = require("../controllers/transporter.controller");

router.post("/", createTransporter);
router.get("/", getAllTransporters);
router.get("/:id", getTransporterById);
router.put("/:id", updateTransporter);
router.delete("/:id", deleteTransporter);

module.exports = router;
