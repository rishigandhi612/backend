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
    transporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transporter",
      required: false,
    },
    // Proof of Delivery fields
    pod: {
      filename: {
        type: String,
        required: false,
      },
      originalname: {
        type: String,
        required: false,
      },
      mimetype: {
        type: String,
        required: false,
      },
      size: {
        type: Number,
        required: false,
      },
      path: {
        type: String,
        required: false,
      },
      uploadedAt: {
        type: Date,
        required: false,
      },
      uploadedBy: {
        type: String, // or ObjectId if you want to reference a user
        required: false,
      },
    },
    deliveryStatus: {
      type: String,
      enum: ["pending", "in_transit", "delivered", "cancelled"],
      default: "pending",
    },
    paidAmount: { type: Number, default: 0 },
    pendingAmount: { type: Number, required: true },

    paymentStatus: {
      type: String,
      enum: ["UNPAID", "PARTIAL", "PAID", "OVERPAID"],
      default: "UNPAID",
    },

    deliveredAt: {
      type: Date,
      required: false,
    },
    deliveryNotes: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("invoice", InvoiceSchema);
