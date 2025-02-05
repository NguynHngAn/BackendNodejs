const express = require("express");
const { body, validationResult } = require("express-validator");
const SensorData = require("../models/SensorData");

const router = express.Router();

// Endpoint: Thêm dữ liệu mới
router.post(
  "/",
  [
    body("force").isNumeric().withMessage("Force must be a number"),
    body("accel_x").isNumeric().withMessage("Accel X must be a number"),
    body("accel_y").isNumeric().withMessage("Accel Y must be a number"),
    body("accel_z").isNumeric().withMessage("Accel Z must be a number"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const sensorData = new SensorData(req.body);
      await sensorData.save();
      res.status(201).json({ message: "Data saved successfully!" });
    } catch (error) {
      console.error("Error saving data:", error);
      res.status(500).json({ error: "Failed to save data" });
    }
  }
);

// Endpoint: Lấy tất cả dữ liệu
router.get("/", async (req, res) => {
  try {
    const data = await SensorData.find().sort({ timestamp: -1 });
    res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching data:", error);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

module.exports = router;
