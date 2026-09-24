require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const crypto = require("crypto");
const Razorpay = require("razorpay");

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "rzp_test_TfNQR7ZbZUR2Dz";
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "uYTejmA6cv0V0TanurBULhSz";
let razorpayInstance = null;
try {
    razorpayInstance = new Razorpay({
        key_id: RAZORPAY_KEY_ID,
        key_secret: RAZORPAY_KEY_SECRET
    });
} catch (e) {
    console.warn("[Razorpay Init Warning]:", e.message);
}

const app = express();
const PORT = process.env.PORT || 5000;
const ROOT = path.join(__dirname, "..");
const uploadDir = process.env.VERCEL
    ? path.join("/tmp", "item_images")
    : path.join(ROOT, "frontend", "assets", "item_images");
try {
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }
} catch (e) {
    console.warn("[Upload Dir]", e.message);
}
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname) || ".jpg";
        cb(null, "item_" + Date.now() + "_" + Math.round(Math.random() * 1e4) + ext);
    }
});
const upload = multer({ storage });

const dbName = process.env.DB_NAME || "borrowhub";
let dbConfig = {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "root",
    database: dbName,
    multipleStatements: true,
};

if (process.env.DATABASE_URL || process.env.MYSQL_URL) {
    try {
        const dbUrl = new URL(process.env.DATABASE_URL || process.env.MYSQL_URL);
        dbConfig.host = dbUrl.hostname;
        if (dbUrl.port) dbConfig.port = Number(dbUrl.port);
        if (dbUrl.username) dbConfig.user = dbUrl.username;
        if (dbUrl.password) dbConfig.password = dbUrl.password;
        if (dbUrl.pathname && dbUrl.pathname !== "/") {
            dbConfig.database = dbUrl.pathname.replace(/^\//, "");
        }
    } catch (e) {
        console.warn("[DB Config] Failed to parse DATABASE_URL:", e.message);
    }
}

if (process.env.DB_SSL === "true" || process.env.DB_SSL === "1" || (dbConfig.host !== "localhost" && dbConfig.host !== "127.0.0.1")) {
    dbConfig.ssl = { rejectUnauthorized: false };
}

let pool = mysql.createPool({
    ...dbConfig,
    waitForConnections: true,
    connectionLimit: 10,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
});

async function initialiseDatabase() {
    const targetDb = dbConfig.database || "borrowhub";
    let connection;
    try {
        connection = await mysql.createConnection({ ...dbConfig, multipleStatements: true });
    } catch (err) {
        if (err.code === "ER_BAD_DB_ERROR" || err.errno === 1049) {
            console.log(`[Database Init] Database '${targetDb}' does not exist. Creating...`);
            connection = await mysql.createConnection({ ...dbConfig, database: undefined, multipleStatements: true });
            await connection.query(`CREATE DATABASE IF NOT EXISTS \`${targetDb}\``);
            await connection.query(`USE \`${targetDb}\``);
        } else {
            throw err;
        }
    }

    let needsInit = false;
    try {
        const [tables] = await connection.query(
            "SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = ?",
            [targetDb]
        );
        if (!tables || tables.length === 0) {
            needsInit = true;
        } else {
            console.log(`[Database Init] Database '${targetDb}' already initialized with ${tables.length} tables.`);
        }
    } catch (e) {
        console.warn("[Database Init] Error querying table schema:", e.message);
        needsInit = true;
    }

    if (needsInit) {
        const sqlPath = path.join(ROOT, "BorrowHub_Database.sql");
        if (fs.existsSync(sqlPath)) {
            console.log("[Database Init] Executing schema from: " + sqlPath);
            let schemaSql = fs.readFileSync(sqlPath, "utf8");
            schemaSql = schemaSql.replace(/DROP DATABASE IF EXISTS [^;]+;/gi, "")
                                 .replace(/CREATE DATABASE [^;]+;/gi, "")
                                 .replace(/USE [^;]+;/gi, "");
            await connection.query(schemaSql);
            console.log("[Database Init] BorrowHub_Database.sql applied successfully!");

            try {
                const demoHash = await bcrypt.hash("password123", 10);
                await connection.query(
                    "UPDATE users SET password = ? WHERE password LIKE 'hashed_pw_%'",
                    [demoHash]
                );
                console.log("[Database Init] Default password for sample users set to: 'password123'");
            } catch (err) {
                console.warn("[Database Init] Could not hash sample passwords:", err.message);
            }
        } else {
            console.warn("[Database Init] Warning: " + sqlPath + " not found!");
        }
    }

    await connection.end();

    pool = mysql.createPool({ ...dbConfig, database: targetDb, waitForConnections: true, connectionLimit: 10 });

    // Ensure critical tables exist (and add college_name if missing from existing DBs)
    await pool.query("CREATE TABLE IF NOT EXISTS users (user_id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(120) NOT NULL, email VARCHAR(190) NOT NULL UNIQUE, password VARCHAR(255) NOT NULL, college_name VARCHAR(160) NOT NULL DEFAULT 'Other', role ENUM('student','writer','both') NOT NULL DEFAULT 'student', department VARCHAR(150), year VARCHAR(50), phone VARCHAR(40), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
    try {
        const [uCols] = await pool.query("SHOW COLUMNS FROM users LIKE 'college_name'");
        if (!uCols.length) await pool.query("ALTER TABLE users ADD COLUMN college_name VARCHAR(160) NOT NULL DEFAULT 'Other' AFTER password");
    } catch (e) { console.warn("[DB Column Check]", e.message); }
    await pool.query("CREATE TABLE IF NOT EXISTS categories (category_id INT AUTO_INCREMENT PRIMARY KEY, category_name VARCHAR(100) NOT NULL UNIQUE)");
    try {
        const [catRows] = await pool.query("SELECT COUNT(*) AS count FROM categories");
        if (!catRows[0] || catRows[0].count === 0) {
            const defaultCats = [
                "Academic Equipment",
                "Electronics & Tech",
                "Project Equipment",
                "Sports & Games",
                "Books & Study Material",
                "Lab & Workshop Equipment",
                "Hostel & Daily Essentials",
                "Other"
            ];
            for (const c of defaultCats) {
                await pool.query("INSERT IGNORE INTO categories (category_name) VALUES (?)", [c]);
            }
            console.log("[Database Init] Default categories auto-seeded.");
        }
    } catch (e) { console.warn("[DB Categories Seed]", e.message); }
    await pool.query("CREATE TABLE IF NOT EXISTS items (item_id INT AUTO_INCREMENT PRIMARY KEY, owner_id INT NOT NULL, category_id INT NOT NULL, item_name VARCHAR(160) NOT NULL, description TEXT, item_condition VARCHAR(40), borrowing_type VARCHAR(20) DEFAULT 'free', max_borrow_period INT DEFAULT 3, location VARCHAR(160), availability BOOLEAN DEFAULT TRUE, image_url VARCHAR(500) DEFAULT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (owner_id) REFERENCES users(user_id), FOREIGN KEY (category_id) REFERENCES categories(category_id))");
    try {
        const [iCols] = await pool.query("SHOW COLUMNS FROM items LIKE 'image_url'");
        if (!iCols.length) await pool.query("ALTER TABLE items ADD COLUMN image_url VARCHAR(500) DEFAULT NULL");
    } catch (e) { console.warn("[DB Column Check]", e.message); }
    try {
        const [pCols] = await pool.query("SHOW COLUMNS FROM items LIKE 'price_per_day'");
        if (!pCols.length) await pool.query("ALTER TABLE items ADD COLUMN price_per_day DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER borrowing_type");
    } catch (e) { console.warn("[DB Column Check - price_per_day]", e.message); }
    await pool.query("CREATE TABLE IF NOT EXISTS writing_requests (writing_request_id INT AUTO_INCREMENT PRIMARY KEY, student_id INT NOT NULL, title VARCHAR(180) NOT NULL, subject VARCHAR(120), type VARCHAR(50), description TEXT, length_pages INT, budget DECIMAL(10,2), deadline DATE, status VARCHAR(30) DEFAULT 'open', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (student_id) REFERENCES users(user_id))");
    await pool.query("CREATE TABLE IF NOT EXISTS borrow_requests (request_id INT AUTO_INCREMENT PRIMARY KEY, item_id INT NOT NULL, borrower_id INT NOT NULL, start_date DATE NOT NULL, end_date DATE NOT NULL, reason VARCHAR(255), message TEXT, status VARCHAR(30) DEFAULT 'requested', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (item_id) REFERENCES items(item_id), FOREIGN KEY (borrower_id) REFERENCES users(user_id))");
    try {
        const [brCols] = await pool.query("SHOW COLUMNS FROM borrow_requests LIKE 'total_price'");
        if (!brCols.length) {
            await pool.query("ALTER TABLE borrow_requests ADD COLUMN total_price DECIMAL(10,2) NOT NULL DEFAULT 0.00");
            await pool.query("ALTER TABLE borrow_requests ADD COLUMN payment_id VARCHAR(100) DEFAULT NULL");
            await pool.query("ALTER TABLE borrow_requests ADD COLUMN payment_status VARCHAR(40) NOT NULL DEFAULT 'free'");
            await pool.query("ALTER TABLE borrow_requests ADD COLUMN razorpay_order_id VARCHAR(100) DEFAULT NULL");
        }
    } catch (e) { console.warn("[DB Column Check - borrow_requests payment cols]", e.message); }
    await pool.query("CREATE TABLE IF NOT EXISTS transactions (transaction_id INT AUTO_INCREMENT PRIMARY KEY, request_id INT NOT NULL UNIQUE, borrowed_date DATE NOT NULL, due_date DATE NOT NULL, returned_date DATE NULL, status VARCHAR(30) DEFAULT 'borrowed')");
    try {
        const [txCols] = await pool.query("SHOW COLUMNS FROM transactions LIKE 'amount_paid'");
        if (!txCols.length) {
            await pool.query("ALTER TABLE transactions ADD COLUMN amount_paid DECIMAL(10,2) NOT NULL DEFAULT 0.00");
            await pool.query("ALTER TABLE transactions ADD COLUMN payment_id VARCHAR(100) DEFAULT NULL");
        }
    } catch (e) { console.warn("[DB Column Check - transactions amount cols]", e.message); }
    await pool.query("CREATE TABLE IF NOT EXISTS need_posts (need_id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, item_name VARCHAR(160) NOT NULL, required_from DATE, required_until DATE, reason VARCHAR(255), urgency VARCHAR(20), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(user_id))");
    await pool.query("CREATE TABLE IF NOT EXISTS writing_offers (offer_id INT AUTO_INCREMENT PRIMARY KEY, writing_request_id INT NOT NULL, writer_id INT NOT NULL, proposed_price DECIMAL(10,2), delivery_date DATE, message TEXT, status VARCHAR(30) DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (writing_request_id) REFERENCES writing_requests(writing_request_id), FOREIGN KEY (writer_id) REFERENCES users(user_id))");
    try {
        const [wofCols] = await pool.query("SHOW COLUMNS FROM writing_offers LIKE 'created_at'");
        if (!wofCols.length) await pool.query("ALTER TABLE writing_offers ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP");
    } catch (e) { console.warn("[DB Column Check - writing_offers created_at]", e.message); }
    await pool.query("CREATE TABLE IF NOT EXISTS favorites (user_id INT NOT NULL, item_id INT NOT NULL, PRIMARY KEY (user_id, item_id), FOREIGN KEY (user_id) REFERENCES users(user_id), FOREIGN KEY (item_id) REFERENCES items(item_id))");
    await pool.query("CREATE TABLE IF NOT EXISTS notifications (notification_id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, message TEXT NOT NULL, is_read BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(user_id))");
    await pool.query("CREATE TABLE IF NOT EXISTS writing_orders (writing_order_id INT AUTO_INCREMENT PRIMARY KEY, writing_request_id INT NOT NULL, offer_id INT DEFAULT NULL, student_id INT NOT NULL, writer_id INT NOT NULL, agreed_price DECIMAL(10,2) NOT NULL, advance_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00, platform_fee DECIMAL(10,2) NOT NULL DEFAULT 0.00, total_paid_online DECIMAL(10,2) NOT NULL DEFAULT 0.00, remaining_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00, payment_status VARCHAR(40) NOT NULL DEFAULT 'unpaid', razorpay_order_id VARCHAR(100) DEFAULT NULL, razorpay_payment_id VARCHAR(100) DEFAULT NULL, assigned_date DATE DEFAULT NULL, due_date DATE DEFAULT NULL, delivered_date DATE DEFAULT NULL, status VARCHAR(30) DEFAULT 'in_progress', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (writing_request_id) REFERENCES writing_requests(writing_request_id), FOREIGN KEY (student_id) REFERENCES users(user_id), FOREIGN KEY (writer_id) REFERENCES users(user_id))");
    try {
        const [woCols] = await pool.query("SHOW COLUMNS FROM writing_orders LIKE 'advance_amount'");
        if (!woCols.length) {
            await pool.query("ALTER TABLE writing_orders ADD COLUMN advance_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00");
            await pool.query("ALTER TABLE writing_orders ADD COLUMN platform_fee DECIMAL(10,2) NOT NULL DEFAULT 0.00");
            await pool.query("ALTER TABLE writing_orders ADD COLUMN total_paid_online DECIMAL(10,2) NOT NULL DEFAULT 0.00");
            await pool.query("ALTER TABLE writing_orders ADD COLUMN remaining_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00");
            await pool.query("ALTER TABLE writing_orders ADD COLUMN payment_status VARCHAR(40) NOT NULL DEFAULT 'unpaid'");
            await pool.query("ALTER TABLE writing_orders ADD COLUMN razorpay_order_id VARCHAR(100) DEFAULT NULL");
            await pool.query("ALTER TABLE writing_orders ADD COLUMN razorpay_payment_id VARCHAR(100) DEFAULT NULL");
            await pool.query("ALTER TABLE writing_orders ADD COLUMN offer_id INT DEFAULT NULL");
            await pool.query("ALTER TABLE writing_orders ADD COLUMN delivered_date DATE DEFAULT NULL");
        }
    } catch (e) { console.warn("[DB Column Check - writing_orders payment cols]", e.message); }
    await pool.query("CREATE TABLE IF NOT EXISTS writing_deliverables (deliverable_id INT AUTO_INCREMENT PRIMARY KEY, writing_order_id INT NOT NULL, file_url VARCHAR(500) NOT NULL, file_name VARCHAR(255) DEFAULT NULL, uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, notes TEXT)");
    await pool.query("CREATE TABLE IF NOT EXISTS writing_messages (message_id INT AUTO_INCREMENT PRIMARY KEY, writing_order_id INT NOT NULL, sender_id INT NOT NULL, receiver_id INT NOT NULL, message TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
    await pool.query("CREATE TABLE IF NOT EXISTS writer_profiles (writer_id INT PRIMARY KEY, bio TEXT, subjects VARCHAR(255), price_per_page DECIMAL(8,2) DEFAULT 0.00, sample_work_url VARCHAR(255), is_verified BOOLEAN DEFAULT FALSE, avg_rating DECIMAL(2,1) DEFAULT 0.0, completed_orders INT DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (writer_id) REFERENCES users(user_id) ON DELETE CASCADE)");
}

function safeUser(row) { const { password, password_hash, ...safe } = row; return safe; }
function itemView(row) { 
    const isBooked = Boolean(row.unavailable_until);
    return { 
        ...row, 
        price_per_day: Number(row.price_per_day || 0),
        availability: Boolean(row.availability) && !isBooked,
        unavailable_until: row.unavailable_until ? row.unavailable_until : null
    }; 
}

app.use(cors());
app.use(express.json());
app.use((req, _res, next) => {
    const publicApiRoutes = ["/health", "/auth", "/categories", "/users", "/items", "/colleges", "/borrow-requests", "/transactions", "/need-posts", "/writing-requests", "/writer-profiles", "/writing-orders", "/favorites", "/notifications", "/payment"];
    const isPageRoute = req.path === "/auth" || req.path === "/dashboard";
    if (!isPageRoute && !req.path.startsWith("/api") && publicApiRoutes.some((route) => req.path === route || req.path.startsWith(route + "/"))) req.url = "/api" + req.url;
    next();
});

const apiRoutes = [
    ["GET", "/api/health"],
    ["GET", "/api/colleges"],
    ["GET", "/api/payment/key"],
    ["POST", "/api/payment/create-order"],
    ["POST", "/api/payment/verify"],
    ["POST", "/api/auth/register"], ["POST", "/api/auth/login"], ["PATCH", "/api/auth/password"],
    ["GET", "/api/categories"], ["GET", "/api/users"], ["GET", "/api/users/:id"], ["PUT", "/api/users/:id"], ["PATCH", "/api/users/:id/password"],
    ["GET", "/api/items"], ["POST", "/api/items"], ["PUT", "/api/items/:id"], ["DELETE", "/api/items/:id"],
    ["GET", "/api/borrow-requests"], ["POST", "/api/borrow-requests"], ["PATCH", "/api/borrow-requests/:id/status"],
    ["GET", "/api/transactions"], ["PATCH", "/api/transactions/:id/return"],
    ["GET", "/api/need-posts"], ["POST", "/api/need-posts"],
    ["GET", "/api/writing-requests"], ["POST", "/api/writing-requests"], ["GET", "/api/writing-requests/:id/offers"], ["POST", "/api/writing-requests/:id/offers"],
    ["GET", "/api/writer-profiles"], ["GET", "/api/writing-orders"],
    ["GET", "/api/favorites/:userId"], ["POST", "/api/favorites"], ["DELETE", "/api/favorites/:userId/:itemId"],
    ["GET", "/api/notifications/:userId"], ["PATCH", "/api/notifications/:id/read"],
];
app.get("/api", (_req, res) => res.json({ name: "BorrowHub API", baseUrl: "http://localhost:5000", routes: apiRoutes.map(([method, p]) => ({ method, path: p })) }));
app.get("/routes", (_req, res) => res.redirect("/api"));
app.get("/api/health", async (_req, res) => {
    try {
        await pool.query("SELECT 1");
        res.json({ ok: true, service: "BorrowHub API", database: dbConfig.database, dbConnected: true });
    } catch (err) {
        res.json({ ok: true, service: "BorrowHub API", database: dbConfig.database, dbConnected: false, error: err.message });
    }
});

// List all supported colleges (Pune region)
const PUNE_COLLEGES = [
    "Pune Institute of Computer Technology (PICT)",
    "College of Engineering Pune (COEP)",
    "Vishwakarma Institute of Technology (VIT Pune)",
    "MIT College of Engineering (MITCOE)",
    "Symbiosis Institute of Technology (SIT Pune)",
    "Army Institute of Technology (AIT Pune)",
    "Dr. D.Y. Patil College of Engineering (DYPCE)",
    "Bharati Vidyapeeth College of Engineering (BVCE)",
    "Sinhgad College of Engineering (SCOE)",
    "Maharashtra Institute of Technology (MIT Kothrud)",
    "Indira College of Engineering & Management (ICEM)",
    "Zeal College of Engineering and Research (ZCOER)",
    "Genba Sopanrao Moze College of Engineering (GSMCOE)",
    "Savitribai Phule Pune University (SPPU)",
    "Ferguson College Pune",
    "Modern College of Engineering Pune",
    "Cummins College of Engineering for Women",
    "Pimpri Chinchwad College of Engineering (PCCOE)",
    "Sandip Institute of Engineering and Management",
    "NBN Sinhgad School of Engineering",
    "Q spider Deccan",
    "Other"
];
app.get("/api/colleges", (_req, res) => res.json(PUNE_COLLEGES));

app.post("/api/auth/register", async (req, res, next) => {
    try {
        const { name, email, password, college_name = "Other", department = "", year = "", phone = "", role = "student" } = req.body;
        if (!name || !email || !password) return res.status(400).json({ message: "Name, email and password are required." });
        if (!college_name || college_name === "") return res.status(400).json({ message: "Please select your college." });
        const [existing] = await pool.query("SELECT user_id FROM users WHERE email = ?", [email]);
        if (existing.length) return res.status(409).json({ message: "An account with that email already exists." });
        const hash = await bcrypt.hash(password, 10);
        const [result] = await pool.query("INSERT INTO users (name,email,password,college_name,role,department,year,phone) VALUES (?,?,?,?,?,?,?,?)", [name, email, hash, college_name, role, department, year, phone]);
        const [rows] = await pool.query("SELECT user_id,name,email,college_name,role,department,year,phone FROM users WHERE user_id = ?", [result.insertId]);
        res.status(201).json(rows[0]);
    } catch (error) { next(error); }
});

app.post("/api/auth/login", async (req, res, next) => {
    try {
        const [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [req.body.email || ""]);
        if (!rows.length || !(await bcrypt.compare(req.body.password || "", rows[0].password || rows[0].password_hash || ""))) return res.status(401).json({ message: "Invalid email or password." });
        res.json(safeUser(rows[0]));
    } catch (error) { next(error); }
});

app.patch("/api/auth/password", async (req, res, next) => {
    try {
        const { email, new_password } = req.body;
        if (!email || !new_password || new_password.length < 4) return res.status(400).json({ message: "Email and a new password of at least 4 characters are required." });
        const password = await bcrypt.hash(new_password, 10);
        const [result] = await pool.query("UPDATE users SET password = ? WHERE email = ?", [password, email]);
        if (!result.affectedRows) return res.status(404).json({ message: "No account found for that email." });
        res.json({ ok: true, message: "Password updated." });
    } catch (e) { next(e); }
});

app.get("/api/categories", async (_req, res, next) => { try { const [rows] = await pool.query("SELECT * FROM categories ORDER BY category_name"); res.json(rows); } catch (e) { next(e); } });

app.get("/api/users", async (req, res, next) => {
    try {
        const where = req.query.college_name ? "WHERE college_name = ?" : "";
        const vals = req.query.college_name ? [req.query.college_name] : [];
        const [rows] = await pool.query("SELECT user_id,name,email,college_name,role,department,year,phone FROM users " + where, vals);
        res.json(rows);
    } catch (e) { next(e); }
});
app.get("/api/users/:id", async (req, res, next) => { try { const [rows] = await pool.query("SELECT user_id,name,email,college_name,role,department,year,phone FROM users WHERE user_id = ?", [req.params.id]); rows.length ? res.json(rows[0]) : res.status(404).json({ message: "User not found." }); } catch (e) { next(e); } });
app.put("/api/users/:id", async (req, res, next) => { try { const allowed = ["name", "role", "department", "year", "phone"]; const fields = allowed.filter((key) => req.body[key] !== undefined); if (fields.length) await pool.query("UPDATE users SET " + fields.map((key) => key + " = ?").join(", ") + " WHERE user_id = ?", [...fields.map((key) => req.body[key]), req.params.id]); const [rows] = await pool.query("SELECT user_id,name,email,college_name,role,department,year,phone FROM users WHERE user_id = ?", [req.params.id]); res.json(rows[0]); } catch (e) { next(e); } });
app.patch("/api/users/:id/password", async (req, res, next) => { try { const { new_password } = req.body; if (!new_password || new_password.length < 4) return res.status(400).json({ message: "A new password of at least 4 characters is required." }); const password = await bcrypt.hash(new_password, 10); const [result] = await pool.query("UPDATE users SET password = ? WHERE user_id = ?", [password, req.params.id]); if (!result.affectedRows) return res.status(404).json({ message: "User not found." }); res.json({ ok: true, message: "Password updated." }); } catch (e) { next(e); } });

app.get("/api/items", async (req, res, next) => {
    try {
        // Auto-restore availability for items whose bookings have expired or were returned
        await pool.query(`
            UPDATE items i
            SET availability = TRUE
            WHERE availability = FALSE
            AND NOT EXISTS (
                SELECT 1 FROM transactions t
                JOIN borrow_requests br ON br.request_id = t.request_id
                WHERE br.item_id = i.item_id
                AND t.status = 'borrowed'
                AND t.returned_date IS NULL
                AND t.due_date >= CURDATE()
            )
        `).catch(() => {});

        const where = [];
        const values = [];
        if (req.query.available === "true") where.push("i.availability = TRUE");
        if (req.query.owner_id) { where.push("i.owner_id = ?"); values.push(req.query.owner_id); }
        if (req.query.category_id) { where.push("i.category_id = ?"); values.push(req.query.category_id); }
        // College isolation: only show items from same college if college_name passed
        if (req.query.college_name) { where.push("u.college_name = ?"); values.push(req.query.college_name); }
        const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";
        const [rows] = await pool.query(
            `SELECT i.*, c.category_name, u.name owner_name, u.college_name owner_college,
             (SELECT MAX(t.due_date) FROM transactions t 
              JOIN borrow_requests br ON br.request_id = t.request_id 
              WHERE br.item_id = i.item_id AND t.status = 'borrowed' AND t.returned_date IS NULL AND t.due_date >= CURDATE()
             ) AS unavailable_until
             FROM items i 
             JOIN categories c ON c.category_id=i.category_id 
             JOIN users u ON u.user_id=i.owner_id ` + whereClause + " ORDER BY i.created_at DESC", 
            values
        );
        res.json(rows.map(itemView));
    } catch (e) { next(e); }
});
app.post("/api/upload", upload.single("image"), (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const image_url = "/frontend/assets/item_images/" + req.file.filename;
    res.json({ image_url });
});

app.post("/api/items", async (req, res, next) => {
    try {
        const price_per_day = req.body.borrowing_type === "paid" ? (Number(req.body.price_per_day) || 0) : 0;
        const [result] = await pool.query(
            "INSERT INTO items (owner_id,category_id,item_name,description,item_condition,borrowing_type,price_per_day,max_borrow_period,location,image_url) VALUES (?,?,?,?,?,?,?,?,?,?)",
            [req.body.owner_id, req.body.category_id, req.body.item_name, req.body.description || "", req.body.item_condition || "Good", req.body.borrowing_type || "free", price_per_day, req.body.max_borrow_period || 3, req.body.location || "", req.body.image_url || null]
        );
        res.status(201).json({ item_id: result.insertId, ...req.body, price_per_day, availability: true });
    } catch (e) { next(e); }
});

app.put("/api/items/:id", async (req, res, next) => {
    try {
        const keys = ["item_name", "description", "item_condition", "borrowing_type", "price_per_day", "max_borrow_period", "location", "availability", "image_url"];
        const fields = keys.filter((key) => req.body[key] !== undefined);
        await pool.query("UPDATE items SET " + fields.map((key) => key + " = ?").join(", ") + " WHERE item_id = ?", [...fields.map((key) => req.body[key]), req.params.id]);
        res.json({ ok: true });
    } catch (e) { next(e); }
});
app.delete("/api/items/:id", async (req, res, next) => { try { await pool.query("DELETE FROM items WHERE item_id = ?", [req.params.id]); res.json({ ok: true }); } catch (e) { next(e); } });

// Razorpay Payment Endpoints
app.get("/api/payment/key", (_req, res) => {
    res.json({ key_id: RAZORPAY_KEY_ID });
});

app.post("/api/payment/create-order", async (req, res, next) => {
    try {
        const { item_id, borrower_id, start_date, end_date, reason, message } = req.body;
        if (!item_id || !borrower_id || !start_date || !end_date) {
            return res.status(400).json({ message: "Missing required booking details (item, borrower, dates)." });
        }

        const [items] = await pool.query(
            "SELECT i.*, u.college_name owner_college, u.name owner_name FROM items i JOIN users u ON u.user_id = i.owner_id WHERE i.item_id = ?",
            [item_id]
        );
        if (!items.length) return res.status(404).json({ message: "Item not found." });
        const item = items[0];

        // College restriction
        const [borrowers] = await pool.query("SELECT user_id, name, email, phone, college_name FROM users WHERE user_id = ?", [borrower_id]);
        if (!borrowers.length) return res.status(404).json({ message: "Borrower not found." });
        const borrower = borrowers[0];

        if (borrower.college_name !== item.owner_college) {
            return res.status(403).json({ message: `Cross-college borrowing not permitted. Item is at ${item.owner_college}, your college is ${borrower.college_name}.` });
        }

        // Check if item is currently booked
        const [activeTx] = await pool.query(
            "SELECT t.* FROM transactions t JOIN borrow_requests br ON br.request_id = t.request_id WHERE br.item_id = ? AND t.status = 'borrowed' AND t.returned_date IS NULL AND t.due_date >= CURDATE()",
            [item_id]
        );
        if (activeTx.length || !item.availability) {
            return res.status(400).json({ message: "This item is currently booked and unavailable." });
        }

        // Date calculation
        const start = new Date(start_date);
        const end = new Date(end_date);
        const diffMs = end.getTime() - start.getTime();
        if (diffMs < 0) return res.status(400).json({ message: "End date cannot be earlier than start date." });
        const days = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1);

        const pricePerDay = Number(item.price_per_day) || 0;
        const totalPrice = Math.round(days * pricePerDay * 100) / 100;

        if (item.borrowing_type !== "paid" || totalPrice <= 0) {
            return res.json({ is_free: true, total_price: 0, days, item_name: item.item_name });
        }

        // Amount in paise (minimum 100 paise = 1 INR)
        const amountInPaise = Math.max(100, Math.round(totalPrice * 100));
        const receipt = `rcpt_${item_id}_${Date.now().toString().slice(-8)}`;

        const order = await razorpayInstance.orders.create({
            amount: amountInPaise,
            currency: "INR",
            receipt,
            notes: {
                item_id: String(item_id),
                item_name: item.item_name.substring(0, 30),
                borrower_id: String(borrower_id),
                borrower_name: borrower.name,
                days: String(days),
                start_date,
                end_date
            }
        });

        res.json({
            is_free: false,
            order_id: order.id,
            amount: order.amount,
            currency: order.currency,
            total_price: totalPrice,
            price_per_day: pricePerDay,
            days,
            item_name: item.item_name,
            key_id: RAZORPAY_KEY_ID,
            borrower: {
                name: borrower.name,
                email: borrower.email,
                phone: borrower.phone
            }
        });
    } catch (e) {
        console.error("[Razorpay Create Order Error]:", e);
        next(e);
    }
});

app.post("/api/payment/verify", async (req, res, next) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            item_id,
            borrower_id,
            start_date,
            end_date,
            reason,
            message,
            total_price,
            days
        } = req.body;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({ message: "Missing Razorpay verification credentials." });
        }

        // Verify Razorpay HMAC-SHA256 signature
        const hmac = crypto.createHmac("sha256", RAZORPAY_KEY_SECRET);
        hmac.update(`${razorpay_order_id}|${razorpay_payment_id}`);
        const generatedSignature = hmac.digest("hex");

        if (generatedSignature !== razorpay_signature) {
            return res.status(400).json({ message: "Payment verification failed. Invalid signature." });
        }

        // 1. Create borrow request with status 'approved', payment_status 'paid'
        const [brResult] = await pool.query(
            "INSERT INTO borrow_requests (item_id, borrower_id, start_date, end_date, reason, message, status, total_price, payment_id, payment_status, razorpay_order_id) VALUES (?,?,?,?,?,?,'approved',?,?, 'paid', ?)",
            [item_id, borrower_id, start_date, end_date, reason || "Paid Borrowing", message || "", total_price, razorpay_payment_id, razorpay_order_id]
        );
        const requestId = brResult.insertId;

        // 2. Mark product as NOT AVAILABLE for those days
        await pool.query("UPDATE items SET availability = FALSE WHERE item_id = ?", [item_id]);

        // 3. Insert transaction
        const [txResult] = await pool.query(
            "INSERT INTO transactions (request_id, borrowed_date, due_date, status, amount_paid, payment_id) VALUES (?, ?, ?, 'borrowed', ?, ?)",
            [requestId, start_date, end_date, total_price, razorpay_payment_id]
        );

        // 4. Create notifications
        const [itemData] = await pool.query("SELECT owner_id, item_name FROM items WHERE item_id = ?", [item_id]);
        const [borrowerData] = await pool.query("SELECT name FROM users WHERE user_id = ?", [borrower_id]);
        const itemName = itemData[0]?.item_name || "Item";
        const borrowerName = borrowerData[0]?.name || "Student";

        if (itemData.length) {
            await pool.query("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [
                itemData[0].owner_id,
                `💰 Payment received! ${borrowerName} paid ₹${total_price} to borrow '${itemName}' for ${days || "several"} days (due: ${end_date}).`
            ]);
        }
        await pool.query("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [
            borrower_id,
            `🎉 Payment successful! You paid ₹${total_price} via Razorpay (ID: ${razorpay_payment_id}) for '${itemName}'. Return by ${end_date}.`
        ]);

        res.json({
            ok: true,
            message: "Payment verified successfully! Item booked.",
            request_id: requestId,
            transaction_id: txResult.insertId,
            payment_id: razorpay_payment_id,
            total_price,
            start_date,
            end_date
        });
    } catch (e) {
        console.error("[Razorpay Verify Error]:", e);
        next(e);
    }
});

app.get("/api/borrow-requests", async (req, res, next) => {
    try {
        const { borrower_id, owner_id } = req.query;
        let sql = `
            SELECT br.*, i.item_name, i.image_url, i.borrowing_type, i.price_per_day,
                   u1.name AS borrower_name, u2.name AS owner_name
            FROM borrow_requests br
            JOIN items i ON i.item_id = br.item_id
            JOIN users u1 ON u1.user_id = br.borrower_id
            JOIN users u2 ON u2.user_id = i.owner_id
        `;
        const params = [];
        if (borrower_id) {
            sql += " WHERE br.borrower_id = ?";
            params.push(borrower_id);
        } else if (owner_id) {
            sql += " WHERE i.owner_id = ?";
            params.push(owner_id);
        }
        sql += " ORDER BY br.created_at DESC";
        const [rows] = await pool.query(sql, params);
        res.json(rows);
    } catch (e) { next(e); }
});

app.post("/api/borrow-requests", async (req, res, next) => {
    try {
        // Same-college check: borrower and item owner must be from the same college
        const [borrowerRows] = await pool.query("SELECT college_name FROM users WHERE user_id = ?", [req.body.borrower_id]);
        const [itemRows] = await pool.query("SELECT i.item_id, i.availability, i.borrowing_type, i.price_per_day, u.college_name AS owner_college FROM items i JOIN users u ON u.user_id = i.owner_id WHERE i.item_id = ?", [req.body.item_id]);
        if (borrowerRows.length && itemRows.length && borrowerRows[0].college_name !== itemRows[0].owner_college) {
            return res.status(403).json({ message: "Cross-college borrowing is not allowed. This item belongs to a student from " + itemRows[0].owner_college + ". You are from " + borrowerRows[0].college_name + "." });
        }
        if (itemRows.length && !itemRows[0].availability) {
            return res.status(400).json({ message: "This item is currently unavailable." });
        }

        // Calculate days and total_price
        let totalPrice = 0;
        let paymentStatus = "free";
        if (itemRows.length && itemRows[0].borrowing_type === "paid") {
            const start = new Date(req.body.start_date);
            const end = new Date(req.body.end_date);
            const days = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1);
            totalPrice = Math.round(days * (Number(itemRows[0].price_per_day) || 0) * 100) / 100;
            paymentStatus = "unpaid";
        }

        const [result] = await pool.query(
            "INSERT INTO borrow_requests (item_id,borrower_id,start_date,end_date,reason,message,total_price,payment_status) VALUES (?,?,?,?,?,?,?,?)",
            [req.body.item_id, req.body.borrower_id, req.body.start_date, req.body.end_date, req.body.reason || "", req.body.message || "", totalPrice, paymentStatus]
        );
        res.status(201).json({ request_id: result.insertId, ...req.body, total_price: totalPrice, payment_status: paymentStatus, status: "requested" });
    } catch (e) { next(e); }
});

app.get("/api/writing-requests", async (req, res, next) => {
    try {
        const { status, student_id } = req.query;
        let sql = "SELECT wr.*, u.name AS student_name FROM writing_requests wr JOIN users u ON u.user_id = wr.student_id";
        const where = [];
        const params = [];
        if (status) {
            where.push("wr.status = ?");
            params.push(status);
        }
        if (student_id) {
            where.push("wr.student_id = ?");
            params.push(student_id);
        }
        if (where.length) sql += " WHERE " + where.join(" AND ");
        sql += " ORDER BY wr.created_at DESC";
        const [rows] = await pool.query(sql, params);
        res.json(rows);
    } catch (e) { next(e); }
});

app.post("/api/writing-requests", async (req, res, next) => {
    try {
        const { student_id, title, subject, type, description, length_pages, budget, deadline } = req.body;
        const [result] = await pool.query(
            "INSERT INTO writing_requests (student_id, title, subject, type, description, length_pages, budget, deadline) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [student_id, title, subject || "", type || "notes", description || "", length_pages || 1, budget || 0, deadline || null]
        );
        res.status(201).json({ writing_request_id: result.insertId, ...req.body });
    } catch (e) { next(e); }
});

app.get("/api/writer-profiles", async (_req, res, next) => {
    try {
        const [rows] = await pool.query(
            "SELECT u.user_id AS writer_id, u.name, u.email, COALESCE(wp.bio, 'Experienced academic writer') AS bio, COALESCE(wp.subjects, 'Assignments, Notes, Reports') AS subjects, COALESCE(wp.price_per_page, 50.00) AS price_per_page, COALESCE(wp.is_verified, TRUE) AS is_verified, COALESCE(wp.avg_rating, 4.8) AS avg_rating, COALESCE(wp.completed_orders, 5) AS completed_orders FROM users u LEFT JOIN writer_profiles wp ON wp.writer_id = u.user_id WHERE u.role IN ('writer', 'both')"
        );
        res.json(rows);
    } catch (e) { next(e); }
});

app.patch("/api/borrow-requests/:id/status", async (req, res, next) => { try { await pool.query("UPDATE borrow_requests SET status = ? WHERE request_id = ?", [req.body.status, req.params.id]); if (req.body.status === "approved") { const [requests] = await pool.query("SELECT * FROM borrow_requests WHERE request_id = ?", [req.params.id]); const request = requests[0]; await pool.query("UPDATE items SET availability = FALSE WHERE item_id = ?", [request.item_id]); await pool.query("INSERT INTO transactions (request_id,borrowed_date,due_date) VALUES (?,CURDATE(),?)", [request.request_id, request.end_date]); } res.json({ ok: true }); } catch (e) { next(e); } });
app.get("/api/transactions", async (_req, res, next) => { try { const [rows] = await pool.query("SELECT t.*, br.borrower_id, br.item_id, i.item_name FROM transactions t JOIN borrow_requests br ON br.request_id=t.request_id JOIN items i ON i.item_id=br.item_id ORDER BY t.borrowed_date DESC"); res.json(rows); } catch (e) { next(e); } });
app.patch("/api/transactions/:id/return", async (req, res, next) => { try { const [rows] = await pool.query("SELECT br.item_id FROM transactions t JOIN borrow_requests br ON br.request_id=t.request_id WHERE t.transaction_id = ?", [req.params.id]); await pool.query("UPDATE transactions SET status='returned', returned_date=CURDATE() WHERE transaction_id = ?", [req.params.id]); if (rows[0]) await pool.query("UPDATE items SET availability=TRUE WHERE item_id = ?", [rows[0].item_id]); res.json({ ok: true }); } catch (e) { next(e); } });
app.get("/api/need-posts", async (_req, res, next) => { try { const [rows] = await pool.query("SELECT np.*, u.name user_name FROM need_posts np JOIN users u ON u.user_id=np.user_id ORDER BY np.created_at DESC"); res.json(rows); } catch (e) { next(e); } });
app.post("/api/need-posts", async (req, res, next) => { try { const [result] = await pool.query("INSERT INTO need_posts (user_id,item_name,required_from,required_until,reason,urgency) VALUES (?,?,?,?,?,?)", [req.body.user_id, req.body.item_name, req.body.required_from, req.body.required_until, req.body.reason || "", req.body.urgency || "medium"]); res.status(201).json({ need_id: result.insertId, ...req.body }); } catch (e) { next(e); } });

app.get("/api/writing-requests/:id/offers", async (req, res, next) => {
    try {
        const [rows] = await pool.query(
            "SELECT o.*, u.name AS writer_name, wp.avg_rating, wp.completed_orders, wp.is_verified FROM writing_offers o JOIN users u ON u.user_id = o.writer_id LEFT JOIN writer_profiles wp ON wp.writer_id = o.writer_id WHERE o.writing_request_id = ? ORDER BY o.offer_id DESC",
            [req.params.id]
        );
        res.json(rows);
    } catch (e) { next(e); }
});

app.post("/api/writing-requests/:id/offers", async (req, res, next) => {
    try {
        const [result] = await pool.query(
            "INSERT INTO writing_offers (writing_request_id,writer_id,proposed_price,delivery_date,message) VALUES (?,?,?,?,?)",
            [req.params.id, req.body.writer_id, req.body.proposed_price, req.body.delivery_date, req.body.message || ""]
        );
        await pool.query("UPDATE writing_requests SET status = 'offer_received' WHERE writing_request_id = ? AND status = 'open'", [req.params.id]);
        
        // Notify student
        const [reqData] = await pool.query("SELECT student_id, title FROM writing_requests WHERE writing_request_id = ?", [req.params.id]);
        const [writerData] = await pool.query("SELECT name FROM users WHERE user_id = ?", [req.body.writer_id]);
        if (reqData.length) {
            await pool.query("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [
                reqData[0].student_id,
                `✍️ New offer received from ${writerData[0]?.name || "a writer"} for ₹${req.body.proposed_price} on your request '${reqData[0].title}'.`
            ]);
        }
        res.status(201).json({ offer_id: result.insertId, ...req.body });
    } catch (e) { next(e); }
});

// Razorpay Writing Order Endpoints
app.post("/api/writing-orders/create-payment-order", async (req, res, next) => {
    try {
        const { offer_id, student_id } = req.body;
        if (!offer_id || !student_id) return res.status(400).json({ message: "Missing offer_id or student_id." });

        const [offers] = await pool.query(
            `SELECT o.*, wr.title, wr.student_id AS req_student_id, u.name AS writer_name 
             FROM writing_offers o 
             JOIN writing_requests wr ON wr.writing_request_id = o.writing_request_id 
             JOIN users u ON u.user_id = o.writer_id 
             WHERE o.offer_id = ?`,
            [offer_id]
        );
        if (!offers.length) return res.status(404).json({ message: "Offer not found." });
        const offer = offers[0];

        if (Number(offer.req_student_id) !== Number(student_id)) {
            return res.status(403).json({ message: "Only the student who created the request can accept this offer." });
        }

        const [students] = await pool.query("SELECT user_id, name, email, phone FROM users WHERE user_id = ?", [student_id]);
        const student = students[0];

        const proposedPrice = Number(offer.proposed_price) || 0;
        const advanceAmount = Math.round(proposedPrice / 2 * 100) / 100;
        const platformFee = proposedPrice <= 200 ? 5.00 : 10.00;
        const totalOnlinePayable = Math.round((advanceAmount + platformFee) * 100) / 100;
        const remainingAmount = Math.round((proposedPrice - advanceAmount) * 100) / 100;

        const amountInPaise = Math.max(100, Math.round(totalOnlinePayable * 100));
        const receipt = `wr_rcpt_${offer_id}_${Date.now().toString().slice(-6)}`;

        const razorpayOrder = await razorpayInstance.orders.create({
            amount: amountInPaise,
            currency: "INR",
            receipt,
            notes: {
                offer_id: String(offer_id),
                writing_request_id: String(offer.writing_request_id),
                student_id: String(student_id),
                writer_id: String(offer.writer_id),
                agreed_price: String(proposedPrice),
                advance_amount: String(advanceAmount),
                platform_fee: String(platformFee),
                remaining_amount: String(remainingAmount)
            }
        });

        res.json({
            order_id: razorpayOrder.id,
            amount: razorpayOrder.amount,
            currency: razorpayOrder.currency,
            agreed_price: proposedPrice,
            advance_amount: advanceAmount,
            platform_fee: platformFee,
            total_online_payable: totalOnlinePayable,
            remaining_amount: remainingAmount,
            key_id: RAZORPAY_KEY_ID,
            request_title: offer.title,
            writer_name: offer.writer_name,
            student: {
                name: student ? student.name : "",
                email: student ? student.email : "",
                phone: student ? student.phone : ""
            }
        });
    } catch (e) {
        console.error("[Razorpay Writing Order Error]:", e);
        next(e);
    }
});

app.post("/api/writing-orders/verify-payment", async (req, res, next) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            offer_id,
            student_id
        } = req.body;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !offer_id) {
            return res.status(400).json({ message: "Missing Razorpay payment verification parameters." });
        }

        const hmac = crypto.createHmac("sha256", RAZORPAY_KEY_SECRET);
        hmac.update(`${razorpay_order_id}|${razorpay_payment_id}`);
        const generatedSignature = hmac.digest("hex");

        if (generatedSignature !== razorpay_signature) {
            return res.status(400).json({ message: "Payment verification failed. Invalid signature." });
        }

        const [offers] = await pool.query(
            `SELECT o.*, wr.title, wr.writing_request_id 
             FROM writing_offers o 
             JOIN writing_requests wr ON wr.writing_request_id = o.writing_request_id 
             WHERE o.offer_id = ?`,
            [offer_id]
        );
        if (!offers.length) return res.status(404).json({ message: "Offer not found." });
        const offer = offers[0];

        const proposedPrice = Number(offer.proposed_price) || 0;
        const advanceAmount = Math.round(proposedPrice / 2 * 100) / 100;
        const platformFee = proposedPrice <= 200 ? 5.00 : 10.00;
        const totalOnlinePayable = Math.round((advanceAmount + platformFee) * 100) / 100;
        const remainingAmount = Math.round((proposedPrice - advanceAmount) * 100) / 100;

        // Check if writing_order already exists for this offer
        const [existing] = await pool.query("SELECT * FROM writing_orders WHERE offer_id = ?", [offer_id]);
        let writingOrderId;
        if (existing.length) {
            writingOrderId = existing[0].writing_order_id || existing[0].order_id;
            await pool.query(
                "UPDATE writing_orders SET payment_status = 'half_paid', status = 'in_progress', razorpay_order_id = ?, razorpay_payment_id = ?, total_paid_online = ?, advance_amount = ?, platform_fee = ?, remaining_amount = ? WHERE (writing_order_id = ? OR order_id = ?)",
                [razorpay_order_id, razorpay_payment_id, totalOnlinePayable, advanceAmount, platformFee, remainingAmount, writingOrderId, writingOrderId]
            );
        } else {
            const [orderRes] = await pool.query(
                `INSERT INTO writing_orders (writing_request_id, offer_id, student_id, writer_id, agreed_price, advance_amount, platform_fee, total_paid_online, remaining_amount, payment_status, razorpay_order_id, razorpay_payment_id, status, assigned_date, due_date)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'half_paid', ?, ?, 'in_progress', CURDATE(), ?)`,
                [offer.writing_request_id, offer.offer_id, student_id, offer.writer_id, proposedPrice, advanceAmount, platformFee, totalOnlinePayable, remainingAmount, razorpay_order_id, razorpay_payment_id, offer.delivery_date]
            );
            writingOrderId = orderRes.insertId;
        }

        // Mark this offer as accepted, other offers on this request as rejected
        await pool.query("UPDATE writing_offers SET status = 'accepted' WHERE offer_id = ?", [offer_id]);
        await pool.query("UPDATE writing_offers SET status = 'rejected' WHERE writing_request_id = ? AND offer_id != ?", [offer.writing_request_id, offer_id]);
        await pool.query("UPDATE writing_requests SET status = 'assigned' WHERE writing_request_id = ?", [offer.writing_request_id]);

        // Send notifications
        const [studentData] = await pool.query("SELECT name FROM users WHERE user_id = ?", [student_id]);
        const [writerData] = await pool.query("SELECT name FROM users WHERE user_id = ?", [offer.writer_id]);
        const sName = studentData[0]?.name || "Student";
        const wName = writerData[0]?.name || "Writer";

        await pool.query("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [
            offer.writer_id,
            `🎉 Offer accepted! ${sName} paid ₹${totalOnlinePayable} (₹${advanceAmount} advance + ₹${platformFee} platform fee) via Razorpay for '${offer.title}'. Order #${writingOrderId} is active. You can now chat and upload assignments!`
        ]);
        await pool.query("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [
            student_id,
            `✅ Payment successful! You paid ₹${totalOnlinePayable} advance (Payment ID: ${razorpay_payment_id}). Writer ${wName} is assigned to '${offer.title}'. Remaining ₹${remainingAmount} to be paid in person upon delivery.`
        ]);

        res.json({
            ok: true,
            message: "Payment verified successfully! Writing order created.",
            writing_order_id: writingOrderId,
            agreed_price: proposedPrice,
            advance_amount: advanceAmount,
            remaining_amount: remainingAmount,
            platform_fee: platformFee
        });
    } catch (e) {
        console.error("[Razorpay Writing Verify Error]:", e);
        next(e);
    }
});

app.get("/api/writing-orders", async (req, res, next) => {
    try {
        const { user_id } = req.query;
        let sql = `
            SELECT o.*, o.order_id AS writing_order_id, wr.title, wr.subject, wr.type,
                   student.name AS student_name, student.email AS student_email,
                   writer.name AS writer_name, writer.email AS writer_email
            FROM writing_orders o
            JOIN writing_requests wr ON wr.writing_request_id = o.writing_request_id
            JOIN users student ON student.user_id = o.student_id
            JOIN users writer ON writer.user_id = o.writer_id
        `;
        const params = [];
        if (user_id) {
            sql += " WHERE o.student_id = ? OR o.writer_id = ?";
            params.push(user_id, user_id);
        }
        sql += " ORDER BY o.order_id DESC";
        const [rows] = await pool.query(sql, params);
        res.json(rows);
    } catch (e) { next(e); }
});

// Writing Order Chat Routes (Available after 50% advance payment)
app.get("/api/writing-orders/:id/messages", async (req, res, next) => {
    try {
        const [orders] = await pool.query("SELECT * FROM writing_orders WHERE order_id = ?", [req.params.id]);
        if (!orders.length) return res.status(404).json({ message: "Writing order not found." });
        const order = orders[0];

        if (order.payment_status !== "half_paid" && order.payment_status !== "fully_paid") {
            return res.status(403).json({ message: "Chat is only available after 50% advance payment is completed." });
        }

        const [messages] = await pool.query(
            `SELECT m.*, u.name AS sender_name 
             FROM writing_messages m 
             JOIN users u ON u.user_id = m.sender_id 
             WHERE m.writing_order_id = ? 
             ORDER BY m.created_at ASC`,
            [order.order_id]
        );
        res.json(messages);
    } catch (e) { next(e); }
});

app.post("/api/writing-orders/:id/messages", async (req, res, next) => {
    try {
        const { sender_id, message } = req.body;
        if (!sender_id || !message || !message.trim()) return res.status(400).json({ message: "Sender ID and message content are required." });

        const [orders] = await pool.query("SELECT * FROM writing_orders WHERE order_id = ?", [req.params.id]);
        if (!orders.length) return res.status(404).json({ message: "Writing order not found." });
        const order = orders[0];

        if (order.payment_status !== "half_paid" && order.payment_status !== "fully_paid") {
            return res.status(403).json({ message: "Chat is locked until 50% advance payment is made." });
        }

        const receiverId = Number(sender_id) === Number(order.student_id) ? order.writer_id : order.student_id;

        const [result] = await pool.query(
            "INSERT INTO writing_messages (writing_order_id, sender_id, receiver_id, message) VALUES (?, ?, ?, ?)",
            [order.order_id, sender_id, receiverId, message.trim()]
        );

        res.status(201).json({ message_id: result.insertId, writing_order_id: order.order_id, sender_id, receiver_id: receiverId, message: message.trim(), created_at: new Date() });
    } catch (e) { next(e); }
});

// Writing Deliverables (PDF Assignment Upload/View)
app.get("/api/writing-orders/:id/deliverables", async (req, res, next) => {
    try {
        const [orders] = await pool.query("SELECT * FROM writing_orders WHERE order_id = ?", [req.params.id]);
        if (!orders.length) return res.status(404).json({ message: "Writing order not found." });

        const [rows] = await pool.query("SELECT * FROM writing_deliverables WHERE writing_order_id = ? ORDER BY uploaded_at DESC", [orders[0].order_id]);
        res.json(rows);
    } catch (e) { next(e); }
});

app.post("/api/writing-orders/:id/deliverables", upload.single("pdf"), async (req, res, next) => {
    try {
        const [orders] = await pool.query("SELECT * FROM writing_orders WHERE order_id = ?", [req.params.id]);
        if (!orders.length) return res.status(404).json({ message: "Writing order not found." });
        const order = orders[0];

        let file_url = req.body.file_url;
        let file_name = req.body.file_name || "assignment.pdf";
        if (req.file) {
            file_url = "/frontend/assets/item_images/" + req.file.filename;
            file_name = req.file.originalname;
        }
        if (!file_url) return res.status(400).json({ message: "PDF file upload or file URL is required." });

        const [result] = await pool.query(
            "INSERT INTO writing_deliverables (writing_order_id, file_url, file_name, notes) VALUES (?, ?, ?, ?)",
            [order.order_id, file_url, file_name, req.body.notes || "PDF assignment uploaded by writer."]
        );

        await pool.query("UPDATE writing_orders SET status = 'delivered', delivered_date = CURDATE() WHERE order_id = ? AND status = 'in_progress'", [order.order_id]);
        await pool.query("UPDATE writing_requests SET status = 'delivered' WHERE writing_request_id = ?", [order.writing_request_id]);

        await pool.query("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [
            order.student_id,
            `📄 Writer uploaded the assignment PDF '${file_name}' for your writing order. You can view/download it now!`
        ]);

        res.status(201).json({ deliverable_id: result.insertId, writing_order_id: order.order_id, file_url, file_name });
    } catch (e) { next(e); }
});

// Complete Writing Order (Writer collects remaining 50% in person & marks done)
app.patch("/api/writing-orders/:id/complete", async (req, res, next) => {
    try {
        const [orders] = await pool.query("SELECT o.*, wr.title FROM writing_orders o JOIN writing_requests wr ON wr.writing_request_id = o.writing_request_id WHERE o.order_id = ?", [req.params.id]);
        if (!orders.length) return res.status(404).json({ message: "Writing order not found." });
        const order = orders[0];

        await pool.query(
            "UPDATE writing_orders SET status = 'completed', payment_status = 'fully_paid', delivered_date = COALESCE(delivered_date, CURDATE()) WHERE order_id = ?",
            [order.order_id]
        );
        await pool.query("UPDATE writing_requests SET status = 'completed' WHERE writing_request_id = ?", [order.writing_request_id]);
        await pool.query("UPDATE writer_profiles SET completed_orders = completed_orders + 1 WHERE writer_id = ?", [order.writer_id]);

        await pool.query("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [
            order.student_id,
            `🎉 Writing order '${order.title}' marked as completed! Remaining ₹${order.remaining_amount} paid in person to the writer.`
        ]);
        await pool.query("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [
            order.writer_id,
            `✅ Writing order '${order.title}' marked as completed! Remaining ₹${order.remaining_amount} collected in person.`
        ]);

        res.json({ ok: true, message: "Order marked as completed!" });
    } catch (e) { next(e); }
});
app.get("/api/favorites/:userId", async (req, res, next) => { try { const [rows] = await pool.query("SELECT i.*, c.category_name, u.name owner_name FROM favorites f JOIN items i ON i.item_id=f.item_id JOIN categories c ON c.category_id=i.category_id JOIN users u ON u.user_id=i.owner_id WHERE f.user_id=?", [req.params.userId]); res.json(rows.map(itemView)); } catch (e) { next(e); } });
app.post("/api/favorites", async (req, res, next) => { try { await pool.query("INSERT IGNORE INTO favorites (user_id,item_id) VALUES (?,?)", [req.body.user_id, req.body.item_id]); res.status(201).json({ ok: true }); } catch (e) { next(e); } });
app.delete("/api/favorites/:userId/:itemId", async (req, res, next) => { try { await pool.query("DELETE FROM favorites WHERE user_id=? AND item_id=?", [req.params.userId, req.params.itemId]); res.json({ ok: true }); } catch (e) { next(e); } });
app.get("/api/notifications/:userId", async (req, res, next) => { try { const [rows] = await pool.query("SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC", [req.params.userId]); res.json(rows); } catch (e) { next(e); } });
app.patch("/api/notifications/:id/read", async (req, res, next) => { try { await pool.query("UPDATE notifications SET is_read=TRUE WHERE notification_id=?", [req.params.id]); res.json({ ok: true }); } catch (e) { next(e); } });

app.use(express.static(ROOT));
app.use(express.static(path.join(ROOT, "frontend")));
app.get("/", (_req, res) => res.sendFile(path.join(ROOT, "frontend", "index.html")));
app.get("/auth", (_req, res) => res.sendFile(path.join(ROOT, "frontend", "auth.html")));
app.get("/login", (_req, res) => res.sendFile(path.join(ROOT, "frontend", "login.html")));
app.get("/signup", (_req, res) => res.sendFile(path.join(ROOT, "frontend", "signup.html")));
app.get("/forgot-password", (_req, res) => res.sendFile(path.join(ROOT, "frontend", "forgot-password.html")));
app.get("/frontend/app.js", (_req, res) => res.sendFile(path.join(ROOT, "frontend", "app.js")));
app.get("/backend/app.js", (_req, res) => res.sendFile(path.join(ROOT, "frontend", "app.js")));
app.get("/app.js", (_req, res) => res.sendFile(path.join(ROOT, "frontend", "app.js")));
app.get("/dashboard", (_req, res) => res.sendFile(path.join(ROOT, "frontend", "dashboard.html")));
app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ message: "Database request failed." }); });

if (!process.env.VERCEL) {
    initialiseDatabase()
        .then(() => app.listen(PORT, () => console.log("BorrowHub running at http://localhost:" + PORT)))
        .catch((error) => { console.error("Could not connect to MySQL:", error.message); process.exit(1); });
} else {
    initialiseDatabase().catch((error) => { console.warn("[Database Init Warning]:", error.message); });
}

module.exports = app;
