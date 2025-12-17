const mongoose = require("mongoose");

const bankschema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },
    account_no: {
      type: String,
      required: true,
      unique: true,
    },
    branch: {
      name: {
        type: String,
        required: true,
      },
    },
    ifsc: {
      type: String,
      required: true,
    },
    email_id: {
      type: String,
      required: true,
    },
    phone_no: {
      type: Number,
      max_length: 10,
      min_length: 10,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("banks", bankschema);
