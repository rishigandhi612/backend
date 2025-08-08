const Transporter = require('../models/transport.models');

// Create transporter with duplicate check
exports.createTransporter = async (req, res) => {
  try {
    const { name, sendingLocations } = req.body;

    if (!name || !sendingLocations || !Array.isArray(sendingLocations) || sendingLocations.length === 0) {
      return res.status(400).json({ success: false, message: 'Name and at least one sending location are required' });
    }

    // Duplicate check manually (index will also enforce at DB level)
    const existing = await Transporter.findOne({
      name: name.trim(),
      'sendingLocations.city': sendingLocations[0].city.trim(),
      'sendingLocations.state': sendingLocations[0].state.trim()
    });

    if (existing) {
      return res.status(409).json({ success: false, message: 'Transporter already exists for this location' });
    }

    const transporter = new Transporter(req.body);
    await transporter.save();
    res.status(201).json({ success: true, data: transporter });

  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'Duplicate transporter entry' });
    }
    res.status(400).json({ success: false, message: error.message });
  }
};

// Get all transporters (optional filters by name/city/state)
exports.getAllTransporters = async (req, res) => {
  try {
    const { name, city, state } = req.query;
    const filter = {};

    if (name) filter.name = new RegExp(name, 'i');
    if (city) filter['sendingLocations.city'] = new RegExp(city, 'i');
    if (state) filter['sendingLocations.state'] = new RegExp(state, 'i');

    const transporters = await Transporter.find(filter).sort({ name: 1 });
    res.status(200).json({ success: true, data: transporters });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get transporter by ID
exports.getTransporterById = async (req, res) => {
  try {
    const transporter = await Transporter.findById(req.params.id);
    if (!transporter) {
      return res.status(404).json({ success: false, message: 'Transporter not found' });
    }
    res.status(200).json({ success: true, data: transporter });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update transporter (with duplicate check)
exports.updateTransporter = async (req, res) => {
  try {
    const { name, sendingLocations } = req.body;

    if (name && sendingLocations && sendingLocations.length > 0) {
      const existing = await Transporter.findOne({
        _id: { $ne: req.params.id },
        name: name.trim(),
        'sendingLocations.city': sendingLocations[0].city.trim(),
        'sendingLocations.state': sendingLocations[0].state.trim()
      });

      if (existing) {
        return res.status(409).json({ success: false, message: 'Transporter already exists for this location' });
      }
    }

    const transporter = await Transporter.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!transporter) {
      return res.status(404).json({ success: false, message: 'Transporter not found' });
    }

    res.status(200).json({ success: true, data: transporter });

  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'Duplicate transporter entry' });
    }
    res.status(400).json({ success: false, message: error.message });
  }
};

// Delete transporter
exports.deleteTransporter = async (req, res) => {
  try {
    const transporter = await Transporter.findByIdAndDelete(req.params.id);
    if (!transporter) {
      return res.status(404).json({ success: false, message: 'Transporter not found' });
    }
    res.status(200).json({ success: true, message: 'Transporter deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
