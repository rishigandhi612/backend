const bank = require("../models/bank.models");

const getAllBanks = async (req, res, next) => {
  try {
    let response = await bank.find();
    res.json({
      success: true,
      data: response,
    });
  } catch (error) {
    res.json({
      success: false,
      error: error,
    });
  }
};
const getBankById = async (req, res, next) => {
  const id = req.params.id;
  try {
    let response = await bank.findById(id);
    res.json({
      success: true,
      data: response,
    });
  } catch (error) {
    res.json({
      success: false,
      error: error,
    });
  }
};
const createBank = async (req, res, next) => {
  let bankData = req.body;

  try {
    let response = await bank.create(bankData);
    res.json({
      success: true,
      data: response,
    });
  } catch (error) {
    res.json({
      success: false,
      error: error,
    });
  }
};
const updateBank = async (req, res, next) => {
  let newBankData = req.body;
  let pid = req.params.id;
  try {
    let response = await bank.findByIdAndUpdate(pid, newBankData);
    res.json({
      success: true,
      data: response,
      newBankData,
    });
  } catch (error) {
    res.json({
      success: false,
      error: error,
    });
  }
};
const deleteBank = async (req, res, next) => {
  let pid = req.params.id;
  console.log("Deleting bank with id:", pid);
  try {
    let response = await bank.findByIdAndDelete(pid);
    res.json({
      success: true,
      data: response,
      message: "Bank Deleted whose id was " + pid,
    });
  } catch (error) {
    res.json({
      success: false,
      error: error,
    });
  }
};

module.exports = {
  getAllBanks,
  getBankById,
  createBank,
  updateBank,
  deleteBank,
};
