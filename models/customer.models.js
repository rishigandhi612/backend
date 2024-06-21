const mongoose = require("mongoose");

const customerschema = new mongoose.Schema({
  name: {
    type: String,
    required:true,
    unique:true
  },
  gstin: {
    type: String,
    required:true,
    unique:true,
    max_length:16,
    min_length:16,
  },
  address:{
    line1:{
        type:String,
        required:true
    },
    line2:{
        type:String
    },
    city:{
        type:String
    },
    state:{
        type:String
    },
    pincode:{
        type:Number,
        max_length:6,
        min_length:6
    }
  },
  email_id:{
    type:String,
    required:true
  },
  phone_no:{
    type:Number,
    max_length:10,
    min_length:10,
    required:true
  }
});

module.exports = mongoose.model("customers", customerschema);
