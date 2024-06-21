const mongoose = require("mongoose");

const CustomerProductschema = new mongoose.Schema({
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref:'customers'
  },
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref:'products'
  },
  quantity:{
    type:Number,
    required:true
  },
  unit_price:{
    type:Number,
    required:true
  }
  
},{
  timestamps:true
}
);

module.exports = mongoose.model("customer-product", CustomerProductschema);
