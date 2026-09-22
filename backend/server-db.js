require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const multer = require("multer");


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
    await pool.query("CREATE TABLE IF NOT EXISTS items (item_id INT AUTO_INCREMENT PRIMARY KEY, owner_id INT NOT NULL, category_id INT NOT NULL, item_name VARCHAR(160) NOT NULL, description TEXT, item_condition VARCHAR(40), borrowing_type VARCHAR(20) DEFAULT 'free', max_borrow_period INT DEFAULT 3, location VARCHAR(160), availability BOOLEAN DEFAULT TRUE, image_url VARCHAR(500) DEFAULT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (owner_id) REFERENCES users(user_id), FOREIGN KEY (category_id) REFERENCES categories(category_id))");
    try {
        const [iCols] = await pool.query("SHOW COLUMNS FROM items LIKE 'image_url'");
        if (!iCols.length) await pool.query("ALTER TABLE items ADD COLUMN image_url VARCHAR(500) DEFAULT NULL");
    } catch (e) { console.warn("[DB Column Check]", e.message); }
    await pool.query("CREATE TABLE IF NOT EXISTS writing_requests (writing_request_id INT AUTO_INCREMENT PRIMARY KEY, student_id INT NOT NULL, title VARCHAR(180) NOT NULL, subject VARCHAR(120), type VARCHAR(50), description TEXT, length_pages INT, budget DECIMAL(10,2), deadline DATE, status VARCHAR(30) DEFAULT 'open', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (student_id) REFERENCES users(user_id))");
    await pool.query("CREATE TABLE IF NOT EXISTS borrow_requests (request_id INT AUTO_INCREMENT PRIMARY KEY, item_id INT NOT NULL, borrower_id INT NOT NULL, start_date DATE NOT NULL, end_date DATE NOT NULL, reason VARCHAR(255), message TEXT, status VARCHAR(30) DEFAULT 'requested', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (item_id) REFERENCES items(item_id), FOREIGN KEY (borrower_id) REFERENCES users(user_id))");
    await pool.query("CREATE TABLE IF NOT EXISTS transactions (transaction_id INT AUTO_INCREMENT PRIMARY KEY, request_id INT NOT NULL UNIQUE, borrowed_date DATE NOT NULL, due_date DATE NOT NULL, returned_date DATE NULL, status VARCHAR(30) DEFAULT 'borrowed')");
    await pool.query("CREATE TABLE IF NOT EXISTS need_posts (need_id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, item_name VARCHAR(160) NOT NULL, required_from DATE, required_until DATE, reason VARCHAR(255), urgency VARCHAR(20), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(user_id))");
    await pool.query("CREATE TABLE IF NOT EXISTS writing_offers (offer_id INT AUTO_INCREMENT PRIMARY KEY, writing_request_id INT NOT NULL, writer_id INT NOT NULL, proposed_price DECIMAL(10,2), delivery_date DATE, message TEXT, status VARCHAR(30) DEFAULT 'pending', FOREIGN KEY (writing_request_id) REFERENCES writing_requests(writing_request_id), FOREIGN KEY (writer_id) REFERENCES users(user_id))");
    await pool.query("CREATE TABLE IF NOT EXISTS favorites (user_id INT NOT NULL, item_id INT NOT NULL, PRIMARY KEY (user_id, item_id), FOREIGN KEY (user_id) REFERENCES users(user_id), FOREIGN KEY (item_id) REFERENCES items(item_id))");
    await pool.query("CREATE TABLE IF NOT EXISTS notifications (notification_id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, message TEXT NOT NULL, is_read BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(user_id))");
    await pool.query("CREATE TABLE IF NOT EXISTS writing_orders (order_id INT AUTO_INCREMENT PRIMARY KEY, writing_request_id INT NOT NULL, student_id INT NOT NULL, writer_id INT NOT NULL, agreed_price DECIMAL(10,2), due_date DATE, status VARCHAR(30) DEFAULT 'assigned', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (writing_request_id) REFERENCES writing_requests(writing_request_id), FOREIGN KEY (student_id) REFERENCES users(user_id), FOREIGN KEY (writer_id) REFERENCES users(user_id))");
}

function safeUser(row) { const { password, password_hash, ...safe } = row; return safe; }
function itemView(row) { return { ...row, availability: Boolean(row.availability) }; }

app.use(cors());
app.use(express.json());
app.use((req, _res, next) => {
    const publicApiRoutes = ["/health", "/auth", "/categories", "/users", "/items", "/colleges", "/borrow-requests", "/transactions", "/need-posts", "/writing-requests", "/writer-profiles", "/writing-orders", "/favorites", "/notifications"];
    const isPageRoute = req.path === "/auth" || req.path === "/dashboard";
    if (!isPageRoute && !req.path.startsWith("/api") && publicApiRoutes.some((route) => req.path === route || req.path.startsWith(route + "/"))) req.url = "/api" + req.url;
    next();
});

const apiRoutes = [
    ["GET", "/api/health"],
    ["GET", "/api/colleges"],
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
        const where = [];
        const values = [];
        if (req.query.available === "true") where.push("i.availability = TRUE");
        if (req.query.owner_id) { where.push("i.owner_id = ?"); values.push(req.query.owner_id); }
        if (req.query.category_id) { where.push("i.category_id = ?"); values.push(req.query.category_id); }
        // College isolation: only show items from same college if college_name passed
        if (req.query.college_name) { where.push("u.college_name = ?"); values.push(req.query.college_name); }
        const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";
        const [rows] = await pool.query("SELECT i.*, c.category_name, u.name owner_name, u.college_name owner_college FROM items i JOIN categories c ON c.category_id=i.category_id JOIN users u ON u.user_id=i.owner_id " + whereClause + " ORDER BY i.created_at DESC", values);
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
        const [result] = await pool.query(
            "INSERT INTO items (owner_id,category_id,item_name,description,item_condition,borrowing_type,max_borrow_period,location,image_url) VALUES (?,?,?,?,?,?,?,?,?)",
            [req.body.owner_id, req.body.category_id, req.body.item_name, req.body.description || "", req.body.item_condition || "Good", req.body.borrowing_type || "free", req.body.max_borrow_period || 3, req.body.location || "", req.body.image_url || null]
        );
        res.status(201).json({ item_id: result.insertId, ...req.body, availability: true });
    } catch (e) { next(e); }
});

app.put("/api/items/:id", async (req, res, next) => {
    try {
        const keys = ["item_name", "description", "item_condition", "borrowing_type", "max_borrow_period", "location", "availability", "image_url"];
        const fields = keys.filter((key) => req.body[key] !== undefined);
        await pool.query("UPDATE items SET " + fields.map((key) => key + " = ?").join(", ") + " WHERE item_id = ?", [...fields.map((key) => req.body[key]), req.params.id]);
        res.json({ ok: true });
    } catch (e) { next(e); }
});
app.delete("/api/items/:id", async (req, res, next) => { try { await pool.query("DELETE FROM items WHERE item_id = ?", [req.params.id]); res.json({ ok: true }); } catch (e) { next(e); } });

app.get("/api/writing-requests", async (req, res, next) => { try { const values = []; const filter = req.query.status ? "WHERE wr.status = ?" : ""; if (req.query.status) values.push(req.query.status); const [rows] = await pool.query("SELECT wr.*, u.name student_name FROM writing_requests wr JOIN users u ON u.user_id=wr.student_id " + filter + " ORDER BY wr.created_at DESC", values); res.json(rows); } catch (e) { next(e); } });
app.post("/api/writing-requests", async (req, res, next) => { try { const [result] = await pool.query("INSERT INTO writing_requests (student_id,title,subject,type,description,length_pages,budget,deadline) VALUES (?,?,?,?,?,?,?,?)", [req.body.student_id, req.body.title, req.body.subject || "", req.body.type || "notes", req.body.description || "", req.body.length_pages || null, req.body.budget || null, req.body.deadline]); res.status(201).json({ writing_request_id: result.insertId, ...req.body, status: "open" }); } catch (e) { next(e); } });
app.get("/api/writer-profiles", async (_req, res, next) => { try { const [rows] = await pool.query("SELECT user_id,name,department subjects FROM users WHERE role IN ('writer','both')"); res.json(rows.map((row) => ({ ...row, bio: "", price_per_page: 0, avg_rating: null, completed_orders: 0, is_verified: false }))); } catch (e) { next(e); } });

app.get("/api/borrow-requests", async (req, res, next) => {
    try {
        const where = [];
        const values = [];
        if (req.query.borrower_id) { where.push("br.borrower_id = ?"); values.push(req.query.borrower_id); }
        if (req.query.owner_id) { where.push("i.owner_id = ?"); values.push(req.query.owner_id); }
        const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";
        const [rows] = await pool.query("SELECT br.*, i.item_name, owner.name owner_name, borrower.name borrower_name FROM borrow_requests br JOIN items i ON i.item_id=br.item_id JOIN users owner ON owner.user_id=i.owner_id JOIN users borrower ON borrower.user_id=br.borrower_id " + whereClause + " ORDER BY br.created_at DESC", values);
        res.json(rows);
    } catch (e) { next(e); }
});

app.post("/api/borrow-requests", async (req, res, next) => {
    try {
        // Same-college check: borrower and item owner must be from the same college
        const [borrowerRows] = await pool.query("SELECT college_name FROM users WHERE user_id = ?", [req.body.borrower_id]);
        const [itemRows] = await pool.query("SELECT i.item_id, u.college_name AS owner_college FROM items i JOIN users u ON u.user_id = i.owner_id WHERE i.item_id = ?", [req.body.item_id]);
        if (borrowerRows.length && itemRows.length && borrowerRows[0].college_name !== itemRows[0].owner_college) {
            return res.status(403).json({ message: "Cross-college borrowing is not allowed. This item belongs to a student from " + itemRows[0].owner_college + ". You are from " + borrowerRows[0].college_name + "." });
        }
        const [result] = await pool.query("INSERT INTO borrow_requests (item_id,borrower_id,start_date,end_date,reason,message) VALUES (?,?,?,?,?,?)", [req.body.item_id, req.body.borrower_id, req.body.start_date, req.body.end_date, req.body.reason || "", req.body.message || ""]);
        res.status(201).json({ request_id: result.insertId, ...req.body, status: "requested" });
    } catch (e) { next(e); }
});

app.patch("/api/borrow-requests/:id/status", async (req, res, next) => { try { await pool.query("UPDATE borrow_requests SET status = ? WHERE request_id = ?", [req.body.status, req.params.id]); if (req.body.status === "approved") { const [requests] = await pool.query("SELECT * FROM borrow_requests WHERE request_id = ?", [req.params.id]); const request = requests[0]; await pool.query("UPDATE items SET availability = FALSE WHERE item_id = ?", [request.item_id]); await pool.query("INSERT INTO transactions (request_id,borrowed_date,due_date) VALUES (?,CURDATE(),?)", [request.request_id, request.end_date]); } res.json({ ok: true }); } catch (e) { next(e); } });
app.get("/api/transactions", async (_req, res, next) => { try { const [rows] = await pool.query("SELECT t.*, br.borrower_id, br.item_id, i.item_name FROM transactions t JOIN borrow_requests br ON br.request_id=t.request_id JOIN items i ON i.item_id=br.item_id ORDER BY t.borrowed_date DESC"); res.json(rows); } catch (e) { next(e); } });
app.patch("/api/transactions/:id/return", async (req, res, next) => { try { const [rows] = await pool.query("SELECT br.item_id FROM transactions t JOIN borrow_requests br ON br.request_id=t.request_id WHERE t.transaction_id = ?", [req.params.id]); await pool.query("UPDATE transactions SET status='returned', returned_date=CURDATE() WHERE transaction_id = ?", [req.params.id]); if (rows[0]) await pool.query("UPDATE items SET availability=TRUE WHERE item_id = ?", [rows[0].item_id]); res.json({ ok: true }); } catch (e) { next(e); } });
app.get("/api/need-posts", async (_req, res, next) => { try { const [rows] = await pool.query("SELECT np.*, u.name user_name FROM need_posts np JOIN users u ON u.user_id=np.user_id ORDER BY np.created_at DESC"); res.json(rows); } catch (e) { next(e); } });
app.post("/api/need-posts", async (req, res, next) => { try { const [result] = await pool.query("INSERT INTO need_posts (user_id,item_name,required_from,required_until,reason,urgency) VALUES (?,?,?,?,?,?)", [req.body.user_id, req.body.item_name, req.body.required_from, req.body.required_until, req.body.reason || "", req.body.urgency || "medium"]); res.status(201).json({ need_id: result.insertId, ...req.body }); } catch (e) { next(e); } });
app.get("/api/writing-requests/:id/offers", async (req, res, next) => { try { const [rows] = await pool.query("SELECT o.*, u.name writer_name FROM writing_offers o JOIN users u ON u.user_id=o.writer_id WHERE o.writing_request_id=?", [req.params.id]); res.json(rows); } catch (e) { next(e); } });
app.post("/api/writing-requests/:id/offers", async (req, res, next) => { try { const [result] = await pool.query("INSERT INTO writing_offers (writing_request_id,writer_id,proposed_price,delivery_date,message) VALUES (?,?,?,?,?)", [req.params.id, req.body.writer_id, req.body.proposed_price, req.body.delivery_date, req.body.message || ""]); res.status(201).json({ offer_id: result.insertId, ...req.body }); } catch (e) { next(e); } });
app.get("/api/writing-orders", async (_req, res, next) => { try { const [rows] = await pool.query("SELECT o.*, wr.title, student.name student_name, writer.name writer_name FROM writing_orders o JOIN writing_requests wr ON wr.writing_request_id=o.writing_request_id JOIN users student ON student.user_id=o.student_id JOIN users writer ON writer.user_id=o.writer_id ORDER BY o.writing_order_id DESC"); res.json(rows); } catch (e) { next(e); } });
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
