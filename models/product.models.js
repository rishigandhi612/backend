const mongoose = require("mongoose");

const productschema = new mongoose.Schema({
  name: {
    type: String,
    required:true
  },
  hsn_code: {
    type: Number,
    required:true,
    unique:true
  },
  qty:{
    type:Number,
    required:true
  },
  desc:{
    type:String
  },
  price:{
    type:Number,
    required:true
  },
  // image:{
  //   type:image
  // }
});

module.exports = mongoose.model("products", productschema);
