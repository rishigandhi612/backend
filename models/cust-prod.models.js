const mongoose = require("mongoose");

const InvoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "customers",
      required: true,
    },
    products: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "products",
          required: true,
        },
        name: {
          type: String,
          required: true,
        },
        width: {
          type: Number,
        },
        quantity: {
          type: Number,
          required: true,
        },
        unit_price: {
          type: Number,
          required: true,
        },
        total_price: {
          type: Number,
          required: true,
        },
      },
    ],
    rollIds: [
      {
        type: String,
        required: false,
      },
    ],
    otherCharges: {
      type: Number,
      default: 0,
    },
    cgst: {
      type: Number,
      default: 0,
    },
    sgst: {
      type: Number,
      default: 0,
    },
    igst: {
      type: Number,
      default: 0,
    },
    grandTotal: {
      type: Number,
      required: true,
    },
    totalAmount: {
      type: Number,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("invoice", InvoiceSchema);
