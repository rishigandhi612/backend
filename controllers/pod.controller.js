const CustomerProduct = require("../models/cust-prod.models");
const Product = require("../models/product.models");
const Customer = require("../models/customer.models");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = "uploads/pod/";
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Generate unique filename with timestamp
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const fileExtension = path.extname(file.originalname);
    const filename = `POD-${
      req.params.id || "invoice"
    }-${uniqueSuffix}${fileExtension}`;
    cb(null, filename);
  },
});

// File filter to allow only images and PDFs
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
    "application/pdf",
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        "Invalid file type. Only images (JPEG, PNG, GIF, WebP) and PDF files are allowed."
      ),
      false
    );
  }
};

// Configure multer with size limit (10MB)
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: fileFilter,
});

// Upload POD for an invoice
const uploadPOD = async (req, res) => {
  try {
    const invoiceId = req.params.id;
    const { deliveryNotes, uploadedBy } = req.body;

    // Validate invoice exists
    const invoice = await CustomerProduct.findById(invoiceId);
    if (!invoice) {
      // Clean up uploaded file if invoice not found
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    // Remove old POD file if exists
    if (invoice.pod && invoice.pod.path) {
      try {
        if (fs.existsSync(invoice.pod.path)) {
          fs.unlinkSync(invoice.pod.path);
        }
      } catch (err) {
        console.error("Error deleting old POD file:", err);
      }
    }

    // Update invoice with POD information
    const updatedInvoice = await CustomerProduct.findByIdAndUpdate(
      invoiceId,
      {
        pod: {
          filename: req.file.filename,
          originalname: req.file.originalname,
          mimetype: req.file.mimetype,
          size: req.file.size,
          path: req.file.path,
          uploadedAt: new Date(),
          uploadedBy: uploadedBy || "system",
        },
        deliveryStatus: "delivered",
        deliveredAt: new Date(),
        deliveryNotes: deliveryNotes || "",
      },
      { new: true }
    );

    res.json({
      success: true,
      message: "POD uploaded successfully",
      data: {
        invoiceId: invoiceId,
        pod: updatedInvoice.pod,
        deliveryStatus: updatedInvoice.deliveryStatus,
        deliveredAt: updatedInvoice.deliveredAt,
      },
    });
  } catch (error) {
    // Clean up uploaded file in case of error
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (err) {
        console.error("Error cleaning up file:", err);
      }
    }

    console.error("Error uploading POD:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// Get POD file for download/view
const getPOD = async (req, res) => {
  try {
    const invoiceId = req.params.id;

    const invoice = await CustomerProduct.findById(invoiceId);
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    if (!invoice.pod || !invoice.pod.path) {
      return res.status(404).json({
        success: false,
        message: "POD not found for this invoice",
      });
    }

    // Check if file exists
    if (!fs.existsSync(invoice.pod.path)) {
      return res.status(404).json({
        success: false,
        message: "POD file not found on server",
      });
    }

    // Set appropriate headers
    res.setHeader("Content-Type", invoice.pod.mimetype);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${invoice.pod.originalname}"`
    );

    // Stream the file
    const fileStream = fs.createReadStream(invoice.pod.path);
    fileStream.pipe(res);
  } catch (error) {
    console.error("Error retrieving POD:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// Delete POD
const deletePOD = async (req, res) => {
  try {
    const invoiceId = req.params.id;

    const invoice = await CustomerProduct.findById(invoiceId);
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    if (!invoice.pod || !invoice.pod.path) {
      return res.status(404).json({
        success: false,
        message: "POD not found for this invoice",
      });
    }

    // Delete physical file
    try {
      if (fs.existsSync(invoice.pod.path)) {
        fs.unlinkSync(invoice.pod.path);
      }
    } catch (err) {
      console.error("Error deleting POD file:", err);
    }

    // Update invoice to remove POD
    const updatedInvoice = await CustomerProduct.findByIdAndUpdate(
      invoiceId,
      {
        $unset: { pod: "" },
        deliveryStatus: "in_transit", // Reset status if needed
      },
      { new: true }
    );

    res.json({
      success: true,
      message: "POD deleted successfully",
      data: {
        invoiceId: invoiceId,
        deliveryStatus: updatedInvoice.deliveryStatus,
      },
    });
  } catch (error) {
    console.error("Error deleting POD:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// Update delivery status
const updateDeliveryStatus = async (req, res) => {
  try {
    const invoiceId = req.params.id;
    const { deliveryStatus, deliveryNotes } = req.body;

    const allowedStatuses = ["pending", "in_transit", "delivered", "cancelled"];

    if (!allowedStatuses.includes(deliveryStatus)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid delivery status. Allowed values: " +
          allowedStatuses.join(", "),
      });
    }

    const updateData = { deliveryStatus };

    if (deliveryNotes) {
      updateData.deliveryNotes = deliveryNotes;
    }

    // Set delivered date if status is delivered
    if (deliveryStatus === "delivered") {
      updateData.deliveredAt = new Date();
    }

    const updatedInvoice = await CustomerProduct.findByIdAndUpdate(
      invoiceId,
      updateData,
      { new: true }
    );

    if (!updatedInvoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    res.json({
      success: true,
      message: "Delivery status updated successfully",
      data: {
        invoiceId: invoiceId,
        deliveryStatus: updatedInvoice.deliveryStatus,
        deliveryNotes: updatedInvoice.deliveryNotes,
        deliveredAt: updatedInvoice.deliveredAt,
      },
    });
  } catch (error) {
    console.error("Error updating delivery status:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// Get invoices by delivery status
const getInvoicesByDeliveryStatus = async (req, res) => {
  try {
    const { status } = req.params;
    const page = parseInt(req.query.page) || 1;
    const itemsPerPage = parseInt(req.query.itemsPerPage) || 10;
    const skip = (page - 1) * itemsPerPage;

    const allowedStatuses = ["pending", "in_transit", "delivered", "cancelled"];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid delivery status. Allowed values: " +
          allowedStatuses.join(", "),
      });
    }

    const totalItems = await CustomerProduct.countDocuments({
      deliveryStatus: status,
    });

    const invoices = await CustomerProduct.find({ deliveryStatus: status })
      .populate("customer")
      .populate("products.product")
      .populate("transporter")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(itemsPerPage);

    res.json({
      success: true,
      data: invoices,
      pagination: {
        page,
        itemsPerPage,
        totalItems,
        totalPages: Math.ceil(totalItems / itemsPerPage),
      },
    });
  } catch (error) {
    console.error("Error fetching invoices by delivery status:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

module.exports = {
  upload,
  uploadPOD,
  getPOD,
  deletePOD,
  updateDeliveryStatus,
  getInvoicesByDeliveryStatus,
};
