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
        rollId: { type: String, unique: true, required: true },
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
        netWeight: {
          type: Number,
        },
        grossWeight: {
          type: Number,
        },
        quantity: {
          type: Number,
          required: true,
        },
        micron: {
          type: Number,
        },
        mtr: {
          type: Number,
        },
        type: {
          type: String,
        },
        status: {
          type: String,
          enum: ["available", "sold", "damaged", "reserved"],
          default: "available",
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
    otherCharges: {
      type: Number,
      default: 0, // Default to 0 if no other charges are provided
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