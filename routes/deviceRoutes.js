const express = require("express");
const { body, validationResult } = require("express-validator");
const authMiddleware = require("../middleware/authMiddleware");
const Device = require("../models/Device");
const User = require("../models/User");

const router = express.Router();

// ✅ API: Gán thiết bị cho tài khoản (Admin mới có quyền)
router.post(
  "/assign-device",
  [authMiddleware, body("deviceID").notEmpty(), body("userID").notEmpty()],
  async (req, res) => {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const { deviceID, userID } = req.body;

    try {
      const device = await Device.findOne({ deviceID });
      if (!device) {
        return res.status(404).json({ error: "Device not found" });
      }

      if (device.owner) {
        return res.status(400).json({ error: "This device is already assigned to another user" });
      }

      device.owner = userID;
      await device.save();

      res.status(200).json({ message: "Device assigned successfully" });
    } catch (error) {
      res.status(500).json({ error: "Server error" });
    }
  }
);

// ✅ API: Gỡ thiết bị khỏi tài khoản (Chỉ admin mới có quyền)
router.post("/unassign-device", authMiddleware, async (req, res) => {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Unauthorized" });
    }
  
    const { deviceID } = req.body;
    if (!deviceID) {
      return res.status(400).json({ error: "Missing deviceID" });
    }
  
    try {
      const device = await Device.findOne({ deviceID });
  
      if (!device) {
        return res.status(404).json({ error: "Device not found" });
      }
  
      if (!device.owner) {
        return res.status(400).json({ error: "Device is not assigned to any user" });
      }
  
      // Gỡ thiết bị khỏi tài khoản
      device.owner = null;
      await device.save();
  
      return res.status(200).json({ message: "Device unassigned successfully" });
    } catch (error) {
      console.error("Error unassigning device:", error);
      return res.status(500).json({ error: "Server error" });
    }
  });
  

// ✅ API: Lấy danh sách thiết bị của tài khoản
router.get("/get-user-devices", authMiddleware, async (req, res) => {
  try {
    const devices = await Device.find({ owner: req.user.id });
    res.status(200).json(devices);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch devices" });
  }
});

module.exports = router;
