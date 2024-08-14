const mongoose = require("mongoose");

const userschema = new mongoose.Schema({
  emailid: {
    type: String,
    required:true
  },
  password: {
    type: String,
    required:true,
    unique:true
  },
},
{
    timestamps:true
})

module.exports = mongoose.model("users", userschema);
