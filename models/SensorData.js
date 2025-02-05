const mongoose = require("mongoose");

// Định nghĩa schema
const sensorSchema = new mongoose.Schema({
  deviceID: { type: String, required: true },
  force: { type: Number, required: true },
  accel_x: { type: Number, required: true },
  accel_y: { type: Number, required: true },
  accel_z: { type: Number, required: true },
  timestamp: { type: Date, default: Date.now },
}, { collection: "sensordatas" }); // Thay đổi tên collection tại đây

// Tạo model
const SensorData = mongoose.model("SensorData", sensorSchema);

module.exports = SensorData;
