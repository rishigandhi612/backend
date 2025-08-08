const mongoose = require('mongoose');

const sendingLocationSchema = new mongoose.Schema({
  name: { type: String, trim: true },
  street: { type: String, trim: true },
  city: { type: String, trim: true, required: true },
  state: { type: String, trim: true, required: true },
  pincode: { type: String, trim: true }
}, { _id: false });

const transporterSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Transporter name is required'],
    trim: true
  },
  contactPerson: { type: String, trim: true },
  phone: {
    type: String,
    trim: true,
    validate: {
      validator: v => /^(\+91|0)?[6-9]\d{9}$/.test(v),
      message: 'Invalid Indian phone number format'
    }
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    validate: {
      validator: v => !v || /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/.test(v),
      message: 'Invalid email format'
    }
  },
  gstNumber: {
    type: String,
    trim: true,
    uppercase: true,
    validate: {
      validator: v => !v || /\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}/.test(v),
      message: 'Invalid GST number format'
    }
  },
  address: {
    street: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    pincode: { type: String, trim: true },
    country: { type: String, trim: true, default: 'India' }
  },
  sendingLocations: [sendingLocationSchema],
  vehicleTypes: [{ type: String, trim: true }],
  isActive: { type: Boolean, default: true },
  notes: { type: String, trim: true }
}, { timestamps: true });

// Prevent duplicates: transporter name + sending location city/state
transporterSchema.index(
  { name: 1, 'sendingLocations.city': 1, 'sendingLocations.state': 1 },
  { unique: true, partialFilterExpression: { name: { $exists: true } } }
);

module.exports = mongoose.model('Transporter', transporterSchema);
