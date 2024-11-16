const mongoose = require("mongoose");

const CustomerProductschema = new mongoose.Schema({
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref:'customers',
    required: true,
  },
  products: [
    {
      product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'products',
        required: true,
      },
      name: {
        type: String,  
        required: true,
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
  totalAmount: {
    type: Number,
    required: true,
  },
  
},{
  timestamps:true
}
);

module.exports = mongoose.model("customer-product", CustomerProductschema);
