-- =====================================================================
-- BorrowHub Database
-- Campus Resource Sharing + Academic Writing Service
-- Compatible: MySQL 8.0+ | Railway, Aiven, TiDB Cloud, MySQL Workbench
-- NOTE: Run this inside your already-created database.
--       Do NOT prefix with CREATE DATABASE / DROP DATABASE.
-- =====================================================================

-- =====================================================================
-- 1. CORE TABLE
-- =====================================================================

CREATE TABLE Users (
    user_id       INT AUTO_INCREMENT PRIMARY KEY,
    name          VARCHAR(100) NOT NULL,
    email         VARCHAR(100) NOT NULL UNIQUE,
    password      VARCHAR(255) NOT NULL,
    college_name  VARCHAR(150) NOT NULL DEFAULT 'Other',
    department    VARCHAR(50),
    year          VARCHAR(10),
    phone         VARCHAR(15),
    role          ENUM('student','writer','both') NOT NULL DEFAULT 'student',
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================================
-- 2. RESOURCE BORROWING MODULE
-- =====================================================================

CREATE TABLE Categories (
    category_id     INT AUTO_INCREMENT PRIMARY KEY,
    category_name   VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE Items (
    item_id             INT AUTO_INCREMENT PRIMARY KEY,
    owner_id            INT NOT NULL,
    category_id         INT NOT NULL,
    item_name           VARCHAR(100) NOT NULL,
    description         TEXT,
    item_condition      VARCHAR(20)  DEFAULT 'Good',
    availability        BOOLEAN DEFAULT TRUE,
    borrowing_type      ENUM('free','paid') DEFAULT 'free',
    price_per_day       DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    max_borrow_period   INT DEFAULT 3,          -- in days
    location            VARCHAR(100),
    image_url           VARCHAR(500) DEFAULT NULL,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_items_owner    FOREIGN KEY (owner_id)   REFERENCES Users(user_id)      ON DELETE CASCADE,
    CONSTRAINT fk_items_category FOREIGN KEY (category_id) REFERENCES Categories(category_id) ON DELETE RESTRICT
);

CREATE TABLE Borrow_Requests (
    request_id          INT AUTO_INCREMENT PRIMARY KEY,
    item_id             INT NOT NULL,
    borrower_id         INT NOT NULL,
    start_date          DATE NOT NULL,
    end_date            DATE NOT NULL,
    reason              TEXT,
    message             TEXT,
    total_price         DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    payment_id          VARCHAR(100) DEFAULT NULL,
    payment_status      VARCHAR(40) NOT NULL DEFAULT 'free',
    razorpay_order_id   VARCHAR(100) DEFAULT NULL,
    status              ENUM('requested','approved','rejected') DEFAULT 'requested',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_br_item     FOREIGN KEY (item_id)     REFERENCES Items(item_id)   ON DELETE CASCADE,
    CONSTRAINT fk_br_borrower FOREIGN KEY (borrower_id) REFERENCES Users(user_id)   ON DELETE CASCADE,
    CONSTRAINT chk_br_dates CHECK (end_date >= start_date)
);

CREATE TABLE Transactions (
    transaction_id  INT AUTO_INCREMENT PRIMARY KEY,
    request_id      INT NOT NULL UNIQUE,
    borrowed_date   DATE NOT NULL,
    due_date        DATE NOT NULL,
    returned_date   DATE NULL,
    amount_paid     DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    payment_id      VARCHAR(100) DEFAULT NULL,
    status          ENUM('borrowed','returned','overdue') DEFAULT 'borrowed',
    CONSTRAINT fk_tx_request FOREIGN KEY (request_id) REFERENCES Borrow_Requests(request_id) ON DELETE CASCADE
);

CREATE TABLE Need_Posts (
    need_id         INT AUTO_INCREMENT PRIMARY KEY,
    user_id         INT NOT NULL,
    item_name       VARCHAR(100) NOT NULL,
    required_from   DATE NOT NULL,
    required_until  DATE NOT NULL,
    reason          TEXT,
    urgency         ENUM('low','medium','high') DEFAULT 'medium',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_need_user FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE
);

CREATE TABLE Reviews (
    review_id       INT AUTO_INCREMENT PRIMARY KEY,
    transaction_id  INT NOT NULL,
    reviewer_id     INT NOT NULL,
    rating          INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment         TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_rev_tx       FOREIGN KEY (transaction_id) REFERENCES Transactions(transaction_id) ON DELETE CASCADE,
    CONSTRAINT fk_rev_reviewer FOREIGN KEY (reviewer_id)    REFERENCES Users(user_id)               ON DELETE CASCADE
);

CREATE TABLE Favorites (
    favorite_id     INT AUTO_INCREMENT PRIMARY KEY,
    user_id         INT NOT NULL,
    item_id         INT NOT NULL,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_fav_user FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE,
    CONSTRAINT fk_fav_item FOREIGN KEY (item_id) REFERENCES Items(item_id) ON DELETE CASCADE,
    CONSTRAINT uq_fav UNIQUE (user_id, item_id)
);

CREATE TABLE Penalties (
    penalty_id      INT AUTO_INCREMENT PRIMARY KEY,
    user_id         INT NOT NULL,
    transaction_id  INT NOT NULL,
    reason          VARCHAR(255) NOT NULL,
    amount          DECIMAL(8,2) DEFAULT 0.00,
    status          ENUM('pending','paid') DEFAULT 'pending',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_pen_user FOREIGN KEY (user_id)        REFERENCES Users(user_id)               ON DELETE CASCADE,
    CONSTRAINT fk_pen_tx   FOREIGN KEY (transaction_id) REFERENCES Transactions(transaction_id) ON DELETE CASCADE
);

-- =====================================================================
-- 3. ACADEMIC WRITING SERVICE MODULE (NEW)
-- =====================================================================

CREATE TABLE Writer_Profiles (
    writer_id           INT PRIMARY KEY,                 -- same as user_id (1:1 extension of Users)
    bio                 TEXT,
    subjects            VARCHAR(255),
    price_per_page      DECIMAL(8,2) DEFAULT 0.00,
    sample_work_url     VARCHAR(255),
    is_verified         BOOLEAN DEFAULT FALSE,
    avg_rating          DECIMAL(2,1) DEFAULT 0.0,
    completed_orders    INT DEFAULT 0,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_wp_user FOREIGN KEY (writer_id) REFERENCES Users(user_id) ON DELETE CASCADE
);

CREATE TABLE Writing_Requests (
    writing_request_id INT AUTO_INCREMENT PRIMARY KEY,
    student_id          INT NOT NULL,
    title                VARCHAR(150) NOT NULL,
    subject              VARCHAR(100),
    type                 ENUM('notes','assignment','record','project_report') DEFAULT 'notes',
    description          TEXT,
    length_pages         INT,
    deadline             DATE NOT NULL,
    budget               DECIMAL(8,2),
    status               ENUM('open','offer_received','assigned','in_progress','delivered','completed','cancelled') DEFAULT 'open',
    created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_wr_student FOREIGN KEY (student_id) REFERENCES Users(user_id) ON DELETE CASCADE
);

CREATE TABLE Writing_Offers (
    offer_id             INT AUTO_INCREMENT PRIMARY KEY,
    writing_request_id   INT NOT NULL,
    writer_id            INT NOT NULL,
    proposed_price        DECIMAL(8,2) NOT NULL,
    message                TEXT,
    delivery_date          DATE NOT NULL,
    status                 ENUM('pending','accepted','rejected','withdrawn') DEFAULT 'pending',
    created_at             DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_wo_request FOREIGN KEY (writing_request_id) REFERENCES Writing_Requests(writing_request_id) ON DELETE CASCADE,
    CONSTRAINT fk_wo_writer  FOREIGN KEY (writer_id)          REFERENCES Writer_Profiles(writer_id)           ON DELETE CASCADE
);

CREATE TABLE Writing_Orders (
    writing_order_id    INT AUTO_INCREMENT PRIMARY KEY,
    writing_request_id  INT NOT NULL,
    offer_id             INT NOT NULL UNIQUE,
    student_id            INT NOT NULL,
    writer_id             INT NOT NULL,
    agreed_price           DECIMAL(8,2) NOT NULL,
    assigned_date           DATE NOT NULL,
    due_date                DATE NOT NULL,
    delivered_date           DATE NULL,
    status                    ENUM('assigned','in_progress','delivered','revision_requested','completed','cancelled','disputed') DEFAULT 'assigned',
    CONSTRAINT fk_word_request FOREIGN KEY (writing_request_id) REFERENCES Writing_Requests(writing_request_id) ON DELETE CASCADE,
    CONSTRAINT fk_word_offer   FOREIGN KEY (offer_id)           REFERENCES Writing_Offers(offer_id)             ON DELETE CASCADE,
    CONSTRAINT fk_word_student FOREIGN KEY (student_id)         REFERENCES Users(user_id)                       ON DELETE CASCADE,
    CONSTRAINT fk_word_writer  FOREIGN KEY (writer_id)          REFERENCES Writer_Profiles(writer_id)           ON DELETE CASCADE
);

CREATE TABLE Writing_Deliverables (
    deliverable_id       INT AUTO_INCREMENT PRIMARY KEY,
    writing_order_id     INT NOT NULL,
    file_url              VARCHAR(255) NOT NULL,
    version_no             INT DEFAULT 1,
    uploaded_at             DATETIME DEFAULT CURRENT_TIMESTAMP,
    notes                    TEXT,
    CONSTRAINT fk_wd_order FOREIGN KEY (writing_order_id) REFERENCES Writing_Orders(writing_order_id) ON DELETE CASCADE
);

CREATE TABLE Writing_Reviews (
    writing_review_id    INT AUTO_INCREMENT PRIMARY KEY,
    writing_order_id      INT NOT NULL,
    reviewer_id             INT NOT NULL,
    reviewee_id              INT NOT NULL,
    rating                    INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment                   TEXT,
    review_type               ENUM('student_to_writer','writer_to_student') NOT NULL,
    created_at                DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_wrev_order    FOREIGN KEY (writing_order_id) REFERENCES Writing_Orders(writing_order_id) ON DELETE CASCADE,
    CONSTRAINT fk_wrev_reviewer FOREIGN KEY (reviewer_id)      REFERENCES Users(user_id)                   ON DELETE CASCADE,
    CONSTRAINT fk_wrev_reviewee FOREIGN KEY (reviewee_id)      REFERENCES Users(user_id)                   ON DELETE CASCADE
);

CREATE TABLE Writing_Payments (
    payment_id            INT AUTO_INCREMENT PRIMARY KEY,
    writing_order_id       INT NOT NULL UNIQUE,
    amount                   DECIMAL(8,2) NOT NULL,
    payment_method            ENUM('upi','cash','wallet') DEFAULT 'upi',
    status                    ENUM('pending','paid','refunded') DEFAULT 'pending',
    paid_at                   DATETIME NULL,
    CONSTRAINT fk_wpay_order FOREIGN KEY (writing_order_id) REFERENCES Writing_Orders(writing_order_id) ON DELETE CASCADE
);

-- =====================================================================
-- 4. SHARED / CROSS-MODULE TABLE
-- =====================================================================

CREATE TABLE Notifications (
    notification_id  INT AUTO_INCREMENT PRIMARY KEY,
    user_id          INT NOT NULL,
    message          TEXT NOT NULL,
    type             VARCHAR(50),
    is_read          BOOLEAN DEFAULT FALSE,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE
);


-- =====================================================================
-- 5. SAMPLE DATA
-- =====================================================================

-- ---------- Users ----------
INSERT INTO Users (name, email, password, college_name, department, year, phone, role) VALUES
('Atharv',   'atharv@college.edu',   'hashed_pw_1', 'Pune Institute of Computer Technology (PICT)', 'Computer Engineering', '3rd Year', '9800000001', 'both'),
('Kadambari','kadambari@college.edu','hashed_pw_2', 'Pune Institute of Computer Technology (PICT)', 'E&TC',                 '2nd Year', '9800000002', 'student'),
('Soniya',   'soniya@college.edu',   'hashed_pw_3', 'Pune Institute of Computer Technology (PICT)', 'Information Technology','3rd Year', '9800000003', 'both'),
('Manish',   'manish@college.edu',   'hashed_pw_4', 'Pune Institute of Computer Technology (PICT)', 'Mechanical',            '2nd Year', '9800000004', 'student'),
('Govind',   'govind@college.edu',   'hashed_pw_5', 'Pune Institute of Computer Technology (PICT)', 'Civil',                 '1st Year', '9800000005', 'student');

-- user_id mapping: 1=Atharv, 2=Kadambari, 3=Soniya, 4=Manish, 5=Govind

-- ---------- Categories ----------
INSERT INTO Categories (category_name) VALUES
('Academic'), ('Electronics'), ('Sports'), ('Project Equipment');

-- category_id mapping: 1=Academic, 2=Electronics, 3=Sports, 4=Project Equipment

-- ---------- Items ----------
INSERT INTO Items (owner_id, category_id, item_name, description, item_condition, availability, borrowing_type, max_borrow_period, location, image_url) VALUES
(1, 1, 'Scientific Calculator', 'Casio FX-991ES, good condition',      'Good', TRUE,  'free', 3, 'College Library', 'https://images.unsplash.com/photo-1611125832047-1d7ad1e8e48b?w=600&auto=format&fit=crop&q=80'),
(2, 2, 'HDMI Cable',            '2 meter HDMI cable for presentations','Good', TRUE,  'free', 1, 'Hostel Block A', 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=600&auto=format&fit=crop&q=80'),
(3, 3, 'Cricket Bat',           'Kashmir willow, lightly used',        'Good', TRUE,  'paid', 5, 'Sports Room', 'https://images.unsplash.com/photo-1531415074968-036ba1b575da?w=600&auto=format&fit=crop&q=80'),
(4, 4, 'Arduino Uno Kit',       'Arduino Uno + breadboard + wires',    'Fair', TRUE,  'free', 4, 'Mechanical Dept', 'https://images.unsplash.com/photo-1608564697071-ddf911d81370?w=600&auto=format&fit=crop&q=80'),
(5, 1, 'Drawing Kit',           'Engineering drawing instrument box',  'Good', TRUE,  'free', 2, 'Civil Dept', 'https://images.unsplash.com/photo-1585336261026-8f5786372966?w=600&auto=format&fit=crop&q=80');

-- item_id mapping: 1=Calculator(Atharv), 2=HDMI(Kadambari), 3=Cricket Bat(Soniya), 4=Arduino(Manish), 5=Drawing Kit(Govind)

-- ---------- Borrow_Requests ----------
INSERT INTO Borrow_Requests (item_id, borrower_id, start_date, end_date, reason, message, status) VALUES
(1, 2, '2026-09-05', '2026-09-07', 'Internal examination',        'Need it for my DBMS exam.',        'approved'),
(4, 3, '2026-09-06', '2026-09-10', 'Mini project demo',           'Need Arduino for a 4-day project.', 'approved'),
(2, 5, '2026-09-08', '2026-09-09', 'Seminar presentation',        'Need HDMI cable for one day.',      'approved'),
(3, 1, '2026-09-12', '2026-09-16', 'Inter-branch cricket match',  'Need a bat for the tournament.',    'requested');

-- request_id mapping: 1=Kadambari->Calculator, 2=Soniya->Arduino, 3=Govind->HDMI, 4=Atharv->Cricket Bat (still pending)

-- ---------- Transactions (only for approved requests) ----------
INSERT INTO Transactions (request_id, borrowed_date, due_date, returned_date, status) VALUES
(1, '2026-09-05', '2026-09-07', '2026-09-07', 'returned'),
(2, '2026-09-06', '2026-09-10', NULL,          'borrowed'),
(3, '2026-09-08', '2026-09-09', '2026-09-11', 'returned');   -- returned 2 days late

-- transaction_id mapping: 1=Calculator tx (on time), 2=Arduino tx (still out), 3=HDMI tx (returned late)

-- ---------- Reviews ----------
INSERT INTO Reviews (transaction_id, reviewer_id, rating, comment) VALUES
(1, 2, 5, 'Atharv responded quickly and the calculator worked perfectly.'),
(1, 1, 5, 'Kadambari returned it on time, very reliable.'),
(3, 5, 4, 'Cable was fine, but pickup took a while.');

-- ---------- Need_Posts ----------
INSERT INTO Need_Posts (user_id, item_name, required_from, required_until, reason, urgency) VALUES
(4, 'Lab Coat',    '2026-09-15', '2026-09-15', 'One-day chemistry practical', 'medium'),
(5, 'DBMS Textbook','2026-09-10', '2026-09-17', 'Preparing for internal exam', 'high');

-- ---------- Favorites ----------
INSERT INTO Favorites (user_id, item_id) VALUES
(3, 1),   -- Soniya favorited the Calculator
(4, 2),   -- Manish favorited the HDMI Cable
(2, 4);   -- Kadambari favorited the Arduino Kit

-- ---------- Penalties ----------
INSERT INTO Penalties (user_id, transaction_id, reason, amount, status) VALUES
(5, 3, 'Late return of HDMI cable by 2 days', 20.00, 'pending');

-- ---------- Writer_Profiles (Atharv and Soniya register as writers) ----------
INSERT INTO Writer_Profiles (writer_id, bio, subjects, price_per_page, sample_work_url, is_verified, avg_rating, completed_orders) VALUES
(1, 'CS student, writes clean and well-structured notes.',           'DBMS, Java, Data Structures', 10.00, 'https://example.com/samples/atharv1.pdf', TRUE, 4.8, 3),
(3, 'IT student, good at diagrams and neat handwriting scans.',      'DBMS, Computer Networks',      8.00,  'https://example.com/samples/soniya1.pdf', TRUE, 4.5, 2);

-- ---------- Writing_Requests ----------
INSERT INTO Writing_Requests (student_id, title, subject, type, description, length_pages, deadline, budget, status) VALUES
(4, 'DBMS Unit 3 Notes',       'DBMS',              'notes',      'Need clear notes on normalization and ER diagrams.', 15, '2026-09-14', 150.00, 'assigned'),
(5, 'Surveying Assignment 2',  'Surveying',         'assignment', 'Assignment on leveling methods with diagrams.',       10, '2026-09-18', 120.00, 'open');

-- writing_request_id mapping: 1=Manish's DBMS notes request, 2=Govind's Surveying assignment request

-- ---------- Writing_Offers ----------
INSERT INTO Writing_Offers (writing_request_id, writer_id, proposed_price, message, delivery_date, status) VALUES
(1, 1, 140.00, 'I can complete this in 2 days with clean diagrams.', '2026-09-13', 'accepted'),
(1, 3, 150.00, 'Can deliver with extra solved examples.',            '2026-09-14', 'rejected'),
(2, 3, 110.00, 'I have handled surveying assignments before.',        '2026-09-17', 'pending');

-- ---------- Writing_Orders (created once an offer is accepted) ----------
INSERT INTO Writing_Orders (writing_request_id, offer_id, student_id, writer_id, agreed_price, assigned_date, due_date, delivered_date, status) VALUES
(1, 1, 4, 1, 140.00, '2026-09-06', '2026-09-13', NULL, 'in_progress');

-- writing_order_id = 1 : Manish (student) hired Atharv (writer) for DBMS notes

-- ---------- Writing_Deliverables ----------
INSERT INTO Writing_Deliverables (writing_order_id, file_url, version_no, notes) VALUES
(1, 'https://example.com/deliverables/dbms_unit3_v1.pdf', 1, 'First draft covering normalization up to 3NF.');

-- ---------- Notifications ----------
INSERT INTO Notifications (user_id, message, type, is_read) VALUES
(1, 'Kadambari requested your Scientific Calculator.',        'request_received',  TRUE),
(2, 'Your request for Scientific Calculator was approved.',   'request_accepted',  TRUE),
(5, 'Your HDMI Cable return is overdue.',                     'item_overdue',      FALSE),
(4, 'Atharv sent an offer on your DBMS Unit 3 Notes request.','new_offer',         TRUE),
(1, 'Manish accepted your offer on DBMS Unit 3 Notes.',       'offer_accepted',    FALSE);

-- =====================================================================
-- 6. QUICK VERIFICATION QUERIES (optional - run to check the data)
-- =====================================================================

-- SELECT * FROM Users;
-- SELECT br.request_id, u.name AS borrower, i.item_name, br.status
--   FROM Borrow_Requests br
--   JOIN Users u ON br.borrower_id = u.user_id
--   JOIN Items i ON br.item_id = i.item_id;
-- SELECT wo.writing_order_id, s.name AS student, w.name AS writer, wo.status
--   FROM Writing_Orders wo
--   JOIN Users s ON wo.student_id = s.user_id
--   JOIN Users w ON wo.writer_id = w.user_id;
