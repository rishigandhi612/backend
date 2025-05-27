const mongoose = require("mongoose");

const productschema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  hsn_code: {
    type: Number,
    required: true,
    unique: false
  },
  quantity: {
    type: Number,
    required: true
  },
  desc: {
    type: String
  },
  price: {
    type: Number,
    required: true
  },
  width:  { // New field for width
    type: Number, // Number type, can be adjusted based on your requirements (e.g., unit in cm)
    required: false, // Make it optional if not always required
  },
  netWeight: {
    type: Number,
    required: false, // Optional, only required in inventory context
  },
  grossWeight: {
    type: Number,
    required: false,
  },
  rollId: {
    type: String,
    required: false,
    unique: false, // Prisma has a unique constraint; Mongo allows duplicates unless we enforce
    index: true,
  },
  micron: {
    type: Number,
    required: false,
  },
  mtr: {
    type: Number,
    required: false,
  },
  type: {
    type: String,
    enum: ["film", "non-film"],
    default: "film",
  },
  status: {
    type: String,
    enum: ["available", "damaged", "reserved"],
    default: "available",
    index: true,
  },
  // image: {
  //   type: image
  // }
}, {
  timestamps: true
});

module.exports = mongoose.model("products", productschema);
