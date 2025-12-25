const mongoose = require("mongoose");

const InvoiceOpeningOutstandingSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "customers",
      required: true,
      index: true,
    },

    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "archived",
      required: true,
    },

    invoiceNumber: {
      type: String,
      required: true,
    },

    invoiceDate: {
      type: Date,
      required: true,
    },

    openingPendingAmount: {
      type: Number,
      required: true,
    },

    adjustedAmount: {
      type: Number,
      default: 0,
    },

    balancePending: {
      type: Number,
      required: true,
    },

    asOfDate: {
      type: Date,
      default: new Date("2024-04-01"),
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  "invoice_opening_outstanding",
  InvoiceOpeningOutstandingSchema
);
