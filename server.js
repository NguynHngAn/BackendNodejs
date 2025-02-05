require("dotenv").config(); // Sử dụng biến môi trường từ file .env

const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const { body, validationResult } = require("express-validator");
const bodyParser = require("body-parser");
const mqtt = require("mqtt");
const { spawn } = require("child_process");
const app = express();
const PORT = process.env.PORT || 8080;
const SECRET_KEY = process.env.JWT_SECRET || "luanvantotnghiep";
// ✅ **Khởi tạo WebSocket Server**
const WebSocket = require("ws");
const wss = new WebSocket.Server({ port: 8081 });
console.log("✅ WebSocket server is running on ws://localhost:8081");
wss.on("connection", (ws) => {
  console.log("✅ New WebSocket client connected");

  // Giữ WebSocket mở bằng cách gửi ping
  const keepAlive = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, 30000);
  ws.on("pong", () => console.log("✅ Pong received - WebSocket is alive"));
  ws.on("error", (error) => console.error("❌ WebSocket error:", error));
  ws.on("close", () => {
    clearInterval(keepAlive);
    console.log("⚠️ WebSocket client disconnected");
  });
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.json());

// Kết nối MongoDB
const mongoURI = process.env.MONGO_URI;
(async () => {
  try {
    await mongoose.connect(mongoURI, { serverSelectionTimeoutMS: 30000, socketTimeoutMS: 45000 });
    console.log("Connected to MongoDB");
  } catch (err) {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  }
})();

// **Schema và Model**
const sensorSchema = new mongoose.Schema({
  deviceID: String,
  force: Number,
  accel_x: Number,
  accel_y: Number,
  accel_z: Number,
  timestamp: { type: Date, default: Date.now },
});
const SensorData = mongoose.model("SensorData", sensorSchema);

const predictedSchema = new mongoose.Schema({
  deviceID: String,
  force: Number,
  accel_x: Number,
  accel_y: Number,
  accel_z: Number,
  predicted_force: Number,
  timestamp: { type: Date, default: Date.now },
});
const PredictedData = mongoose.model("predicteddatas", predictedSchema);

const userSchema = new mongoose.Schema({
  username: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: "user" }, // ✅ Mặc định là "user", có thể là "admin"
});
const User = mongoose.model("Users", userSchema);

const deviceSchema = new mongoose.Schema({
  deviceID: { type: String, required: true, unique: true },
  name: { type: String}, // Tên thiết bị
  status: { type: String, default: "offline" }, // Trạng thái thiết bị
  lastUpdated: { type: Date, default: Date.now }, // Lần cập nhật cuối
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null } // Chủ sở hữu thiết bị (không dùng unique)
});
const Device = mongoose.model("Device", deviceSchema);

// Middleware xác thực JWT
const authMiddleware = (req, res, next) => {
  const token = req.header("Authorization");
  if (!token) return res.status(401).json({ error: "Access Denied" });

  try {
    // Lấy token từ header Authorization
    const verified = jwt.verify(token.split(" ")[1], SECRET_KEY);
    req.user = verified; // Lưu thông tin người dùng vào request
    next();
  } catch (err) {
    return res.status(403).json({ error: "Invalid or Expired Token" });
  }
};

// MQTT Setup
const mqttBroker = process.env.MQTT_BROKER || "mqtt://localhost:1884";
const mqttClient = mqtt.connect(mqttBroker);
const statusTopic = "devices/+/status";
const dataTopic = "devices/+/data";

mqttClient.on("connect", () => {
  console.log("Connected to MQTT broker");
  mqttClient.subscribe([statusTopic, dataTopic], (err) => {
    if (err) console.error("Failed to subscribe to topics:", err);
    else console.log(`Subscribed to topics: ${statusTopic}, ${dataTopic}`);
  });
});

// Trạng thái thiết bị
let deviceStatus = { status: "offline", lastUpdated: null };

// Xử lý dữ liệu từ MQTT
mqttClient.on("message", async (topic, message) => {
  try {
    const deviceID = topic.split("/")[1];
    const payload = message.toString();

    if (topic.includes("/status")) {
      // ✅ Cập nhật trạng thái thiết bị vào MongoDB
      await Device.findOneAndUpdate(
        { deviceID },
        { status: payload, lastUpdated: new Date() },
        { upsert: true, new: true }
      );

      console.log(`📡 Device ${deviceID} status updated: ${payload}`);

    } else if (topic.includes("/data")) {
      const sensorData = JSON.parse(payload);
      console.log(`📥 Received data from ${deviceID}:`, sensorData);

      // ✅ Gửi dữ liệu Live Data đến WebSocket
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ deviceID, ...sensorData }));
          console.log("📡 Sent Live Data to WebSocket:", { deviceID, ...sensorData });
        }
      });
      // ✅ Lưu dữ liệu vào MongoDB
      const newSensorData = new SensorData({ deviceID, ...sensorData });
      await newSensorData.save();
      console.log(`💾 Sensor data from ${deviceID} saved to MongoDB`);

      // ✅ Gọi Python script để dự đoán dữ liệu
      const pythonProcess = spawn("python", ["predict_model.py", JSON.stringify(sensorData)]);

      pythonProcess.stdout.on("data", async (data) => {
        const output = data.toString().trim();
        
        if (output.includes("Predicted force")) {
          const predictedForce = parseFloat(output.split(":")[1].trim());
          console.log(`🤖 Prediction: Predicted force: ${predictedForce}`);

          // ✅ Lưu dữ liệu dự đoán vào MongoDB
          const predictedData = new PredictedData({ deviceID, ...sensorData, predicted_force: predictedForce });
          await predictedData.save();
          console.log(`💾 Predicted data from ${deviceID} saved to MongoDB`);

          // ✅ Gửi dữ liệu dự đoán đến WebSocket
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ deviceID, ...sensorData, predicted_force: predictedForce }));
              console.log("📡 Sent Predicted Data to WebSocket:", { deviceID, ...sensorData, predicted_force: predictedForce });
            }
          });

        } else {
          console.error(`⚠️ Unexpected output from Python script: ${output}`);
        }
      });

      pythonProcess.stderr.on("data", (data) => {
        console.error(`❌ Error from Python script: ${data.toString()}`);
      });

      pythonProcess.on("close", (code) => {
        console.log(`✅ Python process exited with code ${code}`);
      });
    }

  } catch (error) {
    console.error("❌ Error processing MQTT message:", error.message || error);
  }
});

// **API**
app.get('/', (req, res) => {
  res.send('Hello, Azure!');
});


app.get("/api/get-status", (req, res) => res.status(200).json(deviceStatus));

app.get("/api/get-data", authMiddleware, async (req, res) => {
  try {
    const { timeframe, deviceID } = req.query;
    const query = {};

    // Lọc theo thiết bị của người dùng
    query.deviceID = { $in: req.user.devices }; // Đảm bảo req.user.devices chứa danh sách deviceID của người dùng

    // Lọc theo thời gian nếu có
    if (timeframe) {
      const now = new Date();
      switch (timeframe) {
        case "1h":
          query.timestamp = { $gte: new Date(now - 60 * 60 * 1000) }; // 1 giờ trước
          break;
        case "24h":
          query.timestamp = { $gte: new Date(now - 24 * 60 * 60 * 1000) }; // 24 giờ trước
          break;
        case "1w":
          query.timestamp = { $gte: new Date(now - 7 * 24 * 60 * 60 * 1000) }; // 1 tuần trước
          break;
        case "1m":
          query.timestamp = { $gte: new Date(now.setMonth(now.getMonth() - 1)) }; // 1 tháng trước
          break;
        default:
          break;
      }
    }

    // Nếu có deviceID được cung cấp, lọc theo deviceID
    if (deviceID) {
      query.deviceID = deviceID;
    }

    // Tìm dữ liệu từ SensorData
    const data = await SensorData.find(query).sort({ timestamp: -1 });
    res.status(200).json(data);
  } catch (err) {
    console.error("Error fetching sensor data:", err);
    res.status(500).json({ error: "Failed to fetch sensor data" });
  }
});

app.get("/api/get-predicted-data", authMiddleware, async (req, res) => {
  try {
    const { timeframe, deviceID } = req.query;
    const query = {};

    // Lọc theo thiết bị của người dùng
    query.deviceID = { $in: req.user.devices }; // Đảm bảo req.user.devices chứa danh sách deviceID của người dùng

    // Lọc theo thời gian nếu có
    if (timeframe) {
      const now = new Date();
      switch (timeframe) {
        case "1h":
          query.timestamp = { $gte: new Date(now - 60 * 60 * 1000) }; // 1 giờ trước
          break;
        case "24h":
          query.timestamp = { $gte: new Date(now - 24 * 60 * 60 * 1000) }; // 24 giờ trước
          break;
        case "1w":
          query.timestamp = { $gte: new Date(now - 7 * 24 * 60 * 60 * 1000) }; // 1 tuần trước
          break;
        case "1m":
          query.timestamp = { $gte: new Date(now.setMonth(now.getMonth() - 1)) }; // 1 tháng trước
          break;
        default:
          break;
      }
    }

    // Nếu có deviceID được cung cấp, lọc theo deviceID
    if (deviceID) {
      query.deviceID = deviceID;
    }

    // Tìm dữ liệu dự đoán từ PredictedData
    const data = await PredictedData.find(query).sort({ timestamp: -1 });
    res.status(200).json(data);
  } catch (err) {
    console.error("Error fetching predicted data:", err);
    res.status(500).json({ error: "Failed to fetch predicted data" });
  }
});

app.get("/api/get-user-devices", authMiddleware, async (req, res) => {
  try {
    const userDevices = await Device.find({ owner: req.user.id });
    res.status(200).json(userDevices);
  } catch (error) {
    console.error("Error fetching user devices:", error);
    res.status(500).json({ error: "Failed to fetch devices" });
  }
});

app.get("/api/get-device-status", authMiddleware, async (req, res) => {
  try {
    const userDevices = await Device.find({ owner: req.user.id }).select("deviceID status lastUpdated");
    res.status(200).json(userDevices);
  } catch (error) {
    console.error("Error fetching device status:", error);
    res.status(500).json({ error: "Failed to fetch device status" });
  }
});

// API thiết bị
app.get("/api/get-devices", authMiddleware, async (req, res) => {
  try {
    const devices = await SensorData.distinct("deviceID");
    res.status(200).json(devices);
  } catch (err) {
    console.error("Error fetching device list:", err);
    res.status(500).json({ error: "Failed to fetch device list" });
  }
});

// **API Lấy thông tin người dùng**
app.get("/api/user", authMiddleware, async (req, res) => {
  try {
    // Lấy thông tin người dùng từ ID trong token
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Trả về thông tin người dùng
    res.json({ username: user.username, role: user.role });

  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ API: Lấy danh sách tất cả users (Chỉ admin mới được phép truy cập)
app.get("/api/admin/users", async (req, res) => {
  try {
    const token = req.header("Authorization").split(" ")[1]; // Lấy token
    const decoded = jwt.verify(token, SECRET_KEY); // Giải mã token

    // Kiểm tra nếu user là admin
    const adminUser = await User.findById(decoded.id);
    if (!adminUser || adminUser.role !== "admin") {
      return res.status(403).json({ error: "Access denied. Admin only." });
    }

    // ✅ Trả về danh sách tất cả người dùng
    const users = await User.find({}, { password: 0 }); // Không trả về password
    res.json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ API: Lấy danh sách tất cả thiết bị
app.get("/api/admin/devices", async (req, res) => {
  try {
    const devices = await Device.find({});
    res.status(200).json(devices); // Trả về danh sách thiết bị cho admin
  } catch (error) {
    console.error("Error fetching devices:", error);
    res.status(500).json({ error: "Failed to fetch devices" });
  }
});

// Lấy danh sách thiết bị của người dùng hiện tại (kèm token xác thực)
app.get("/api/devices", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id; // ID người dùng từ token
    const devices = await Device.find({ owner: userId });

    if (!devices || devices.length === 0) {
      return res.status(404).json({ message: "No devices found" });
    }

    res.status(200).json(devices);
  } catch (error) {
    console.error("Error fetching devices:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
});

app.get("/api/users", async (req, res) => {
  try {
    const users = await User.find({}, "username email role"); // Trả về các trường cần thiết
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "Lỗi khi lấy danh sách tài khoản" });
  }
});

app.get("/api/devices/unassigned", authMiddleware, async (req, res) => {
  try {
    const devices = await Device.find({ owner: null });
    res.status(200).json(devices);
  } catch (error) {
    res.status(500).json({ error: "Lỗi lấy danh sách thiết bị chưa gán" });
  }
});

app.post("/api/devices/assign", authMiddleware, async (req, res) => {
  try {
    const { deviceID, userID } = req.body;

    // Kiểm tra tài khoản có tồn tại không
    const user = await User.findById(userID);
    if (!user) return res.status(404).json({ error: "Tài khoản không tồn tại" });

    // Kiểm tra thiết bị có tồn tại và chưa có chủ sở hữu
    const device = await Device.findOne({ deviceID });
    if (!device) return res.status(404).json({ error: "Thiết bị không tồn tại" });
    if (device.owner) return res.status(400).json({ error: "Thiết bị đã có chủ sở hữu" });

    // Cập nhật chủ sở hữu thiết bị
    device.owner = userID;
    await device.save();

    res.status(200).json({ message: "Gán thiết bị thành công", device });
  } catch (error) {
    res.status(500).json({ error: "Lỗi khi gán thiết bị" });
  }
});

app.get("/api/devices/by-user/:userID", authMiddleware, async (req, res) => {
  try {
    const userID = req.params.userID;
    const devices = await Device.find({ owner: userID });
    res.status(200).json(devices);
  } catch (error) {
    res.status(500).json({ error: "Lỗi khi lấy thiết bị của người dùng" });
  }
});

// Đăng ký người dùng
app.post("/api/register", [
  body("username").notEmpty().withMessage("Tên người dùng không được để trống."),
  body("email").isEmail().withMessage("Email không hợp lệ."),
  body("password").isLength({ min: 6 }).withMessage("Mật khẩu phải có ít nhất 6 ký tự."),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    // Trả lại tất cả lỗi dưới dạng JSON để người dùng biết nguyên nhân
    return res.status(400).json({ errors: errors.array() });
  }

  const { username, email, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    // Kiểm tra xem email có tồn tại trong cơ sở dữ liệu hay không
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: "Email đã tồn tại. Vui lòng sử dụng email khác." });
    }

    const newUser = new User({ username, email, password: hashedPassword, role: "user" });
    await newUser.save();
    res.status(201).json({ message: "Đăng ký người dùng thành công" });
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
});
// **Đăng nhập người dùng**
// Đảm bảo lấy vai trò từ user khi đăng nhập
// **Đăng nhập người dùng**
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: "User not found" });
    }

    // Kiểm tra mật khẩu với bcrypt.compare()
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    // Tạo JWT token, thêm role vào token để xác thực quyền truy cập
    const token = jwt.sign(
      { id: user._id, username: user.username, role: user.role },
      SECRET_KEY, // Đảm bảo rằng SECRET_KEY là đúng và bảo mật
      { expiresIn: "1h" } // Token hết hạn sau 1 giờ
    );

    // Trả về token cho client
    res.json({ token });

  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error during login" });
  }
});

// Khởi động server
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));