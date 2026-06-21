const express = require("express");
const mysql2 = require("mysql2");
const cors = require("cors");
const bodyParser = require("body-parser");
const cron = require("node-cron");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const JWT_SECRET = "mobile_wealth_secret_key_2026";
function verifyToken(req, res, next) {

    const authHeader = req.headers["authorization"];

    if (!authHeader) {
        return res.status(403).send("No token provided");
    }

    const token = authHeader.split(" ")[1];

    jwt.verify(token, JWT_SECRET, (err, decoded) => {

        if (err) {
            return res.status(401).send("Invalid token");
        }

        req.user = decoded;
        next();
    });
}

const app = express();

app.use(cors());
app.use(express.json());
app.use(bodyParser.json());

// ✅ STATIC FILES (FRONTEND)
app.use(express.static(path.join(__dirname, "public")));

//separate admin backend
app.use("/admin", express.static(path.join(__dirname, "admin")));

// ❌ BLOCK DIRECT ACCESS TO ADMIN DASHBOARD FILE
//app.use("admin", (req, res) => {
    //return res.status(403).send("Access denied");
//});

// 🔥 FIX ADMIN SESSION (ONLY ONCE)
global.adminLoggedIn = global.adminLoggedIn || false;

// 🔐 LOGIN PAGE ROUTE
app.get("/admin/login.html", (req, res) => {
    return res.sendFile(
        path.join(__dirname, "admin", "login.html")
    );
});

// 🔐 ADMIN LOGIN ROUTE (IMPORTANT FIX)
app.post("/admin/login", (req, res) => {

    const { phone, password } = req.body;

    db.query(
        "SELECT * FROM users WHERE phone=? AND password=? AND role='admin' LIMIT 1",
        [phone, password],
        (err, result) => {

            if (err) {
                return res.status(500).send("DB error");
            }

            if (!result.length) {
                return res.status(401).send("Invalid admin login");
            }

            global.adminLoggedIn = true;

            res.json({
                success: true,
                admin: result[0]
            });
        }
    );
});

// 🔐 DASHBOARD ROUTE (PROTECTED)
app.get("/admin/dashboard", (req, res) => {

    if (!global.adminLoggedIn) {
        return res.redirect("/admin/login.html");
    }

    return res.sendFile(
        path.join(__dirname, "admin", "dashboard.html")
    );
});

// 🔐 SUPPORT BOTH URL FORMATS
app.get("/admin/dashboard.html", (req, res) => {

    if (!global.adminLoggedIn) {
        return res.redirect("/admin/login.html");
    }

    return res.sendFile(
        path.join(__dirname, "admin", "dashboard.html")
    );
});
// ✅ HOME PAGE ROUTE
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});


// =====================================================
// 🔥 UTILITY FUNCTIONS (REFERRAL SYSTEM)
// =====================================================

// ✅ UNIQUE REFERRAL CODE GENERATOR
function generateReferralCode() {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const numbers = "0123456789";

    let code = "REF-";

    // 3 random letters
    for (let i = 0; i < 3; i++) {
        code += letters[Math.floor(Math.random() * letters.length)];
    }

    // 5 random numbers
    for (let i = 0; i < 5; i++) {
        code += numbers[Math.floor(Math.random() * numbers.length)];
    }

    return code;
}


// =====================
// CREATE UPLOADS FOLDER
// =====================
if (!fs.existsSync("uploads")) {
    fs.mkdirSync("uploads");
}

// =====================
// MULTER CONFIG
// =====================
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, "uploads/");
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + "-" + file.originalname);
    }
});

const upload = multer({ storage });

// =====================
// SERVE UPLOADED FILES
// =====================
app.use("/uploads", express.static("uploads"));

// ================= DATABASE =================
const db = mysql2.createConnection({
    host: "localhost",
    user: "root",
    password: "chiboy9632.@",
    database: "bank_app"
});

db.connect(err => {
    if (err) console.log("DB Error:", err);
    else console.log("MySQL Connected");
});
//check user status for locking
function checkUserStatus(phone, cb) {
    db.query(
        "SELECT status FROM users WHERE phone=?",
        [phone],
        (err, result) => {
            if (err || !result.length) return cb(false);
            cb(result[0].status === "active");
        }
    );
}

// ================= DAILY INVESTMENT SYSTEM =================
// runs every 12AM
cron.schedule("0 0 * * *", () => {

    

    // 1. expire investments
    db.query(
        "UPDATE investments SET status='expired' WHERE end_date <= NOW() AND status='active'",
        (err) => {
            if (err) console.log("Expire error:", err);
        }
    );

    // 2. get active investments grouped by phone
    const sql = `
        SELECT phone, SUM(amount) AS total_amount
        FROM investments
        WHERE status='active'
        GROUP BY phone
    `;

    db.query(sql, (err, results) => {

        if (err) {
            console.log("Interest fetch error:", err);
            return;
        }

        if (!results.length) {
            console.log("⚠️ No active investments found");
            return;
        }

        results.forEach(row => {

            const interest = Number(row.total_amount) * 0.10;

            // 1. UPDATE USER TOTAL RETURNS
            db.query(
                `UPDATE users 
                 SET total_returns = total_returns + ? 
                 WHERE phone=?`,
                [interest, row.phone],
                (err2) => {
                    if (err2) {
                        console.log("Update error:", err2);
                    }
                }
            );

            // 2. SAVE INTEREST HISTORY (THIS FIXES YOUR ISSUE)
            db.query(
                `INSERT INTO interest_history (phone, amount, interest)
                 VALUES (?, ?, ?)`,
                [row.phone, row.total_amount, interest],
                (err3) => {
                    if (err3) {
                        console.log("History save error:", err3);
                    
                    }
                }
            );

        });

    });

}, {
    timezone: "Africa/Lagos"
});
// ================= SIGNUP =================
app.post("/signup", (req, res) => {

    const { phone, password, referredBy } = req.body;

    // 1. Validate phone
    if (!/^\d{11}$/.test(phone)) {
        return res.status(400).send("Phone must be 11 digits");
    }

    // 2. Check if user exists
    db.query("SELECT * FROM users WHERE phone=?", [phone], (err, result) => {

        if (err) return res.status(500).send("DB error");

        if (result.length > 0) {
            return res.status(400).send("User already exists");
        }

        // 3. Generate UNIQUE referral code (USE YOUR FUNCTION)
        const referralCode = generateReferralCode();

        // 4. Validate referral code (simple + safe)
        if (referredBy) {

            db.query(
                "SELECT id FROM users WHERE referral_code=?",
                [referredBy],
                (err2, refUser) => {

                    // if invalid referral → ignore it
                    const validRef = (!err2 && refUser.length > 0)
                        ? referredBy
                        : null;

                    insertUser(validRef);
                }
            );

        } else {
            insertUser(null);
        }

        // 5. Insert user function
        function insertUser(validRef) {

            db.query(
                `INSERT INTO users 
                (phone, password, balance, withdrawable_balance, total_invested, total_returns, status, role, referral_code, referred_by)
                VALUES (?, ?, 0, 0, 0, 0, 'active', 'user', ?, ?)`,
                [phone, password, referralCode, validRef],

                (err3) => {

                    if (err3) {
                        console.log(err3);
                        return res.status(500).send("Signup failed");
                    }

                    db.query(
                        "SELECT * FROM users WHERE phone=?",
                        [phone],
                        (err4, users) => {

                            if (err4) return res.status(500).send("DB error");

                            res.json(users[0]);
                        }
                    );
                }
            );
        }
    });
});
//bank-details

// =================user LOGIN =================
app.post("/login", (req, res) => {

    const { phone, password } = req.body;

    if (!phone || !password) {
        return res.status(400).json({ message: "Phone and password required" });
    }

    if (!/^\d{11}$/.test(phone)) {
        return res.status(400).json({ message: "Phone must be 11 digits" });
    }

    db.query(
        "SELECT * FROM users WHERE phone=?",
        [phone],
        (err, result) => {

            if (err) {
                return res.status(500).json({ message: "DB error" });
            }

            if (!result.length) {
                return res.status(401).json({ message: "Invalid login" });
            }

            const user = result[0];

            if (user.status === "locked") {
                return res.status(403).json({ message: "Your account has been locked" });
            }

            if (user.password !== password) {
                return res.status(401).json({ message: "Invalid login" });
            }

            const token = jwt.sign(
                {
                    id: user.id,
                    phone: user.phone,
                    role: user.role
                },
                JWT_SECRET,
                { expiresIn: "7d" }
            );

            res.json({
                token,
                user
            });
        }
    );
});
// ================= RESET PASSWORD =================
app.post("/reset-password", (req, res) => {

    const { phone, newPassword } = req.body;

    // 1. Validate input
    if (!phone || !newPassword) {
        return res.status(400).json("Phone and new password are required");
    }

    // 2. Validate phone format (11 digits)
    if (!/^\d{11}$/.test(phone)) {
        return res.status(400).json({
            error: "Phone must be exactly 11 digits"
        });
    }

    // 3. Check if user exists first
    db.query(
        "SELECT * FROM users WHERE phone=?",
        [phone],
        (err, users) => {

            if (err) {
                return res.status(500).json({ error: "Database error" });
            }

            if (!users.length) {
                return res.status(404).json("User not found");
            }

            // 4. Update password only if user exists
            db.query(
                "UPDATE users SET password=? WHERE phone=?",
                [newPassword, phone],
                (err2, result) => {

                    if (err2) {
                        return res.status(500).json( "Update failed" );
                    }

                    res.json("Password reset successful, please login");
                }
            );
        }
    );
});

// ================= BALANCE =================
app.get("/balance/:phone", (req, res) => {

    db.query(
        "SELECT balance FROM users WHERE phone=?",
        [req.params.phone],
        (err, result) => {

            if (err) return res.status(500).json({ error: "DB error" });

            if (!result.length)
                return res.json({ error: "User not found" });

            res.json({ balance: result[0].balance });
        }
    );
});

// ================= DEPOSIT (FIXED SINGLE VERSION) =================
app.post("/deposit", upload.single("receipt"), (req, res) => {

    const { phone, amount } = req.body;
    const receipt = req.file ? req.file.filename : null;

    const depositAmount = Number(amount);

    // 1. Validate input
    if (!phone || !depositAmount || !receipt) {
        return res.status(400).send("Missing fields");
    }

    // 2. Check if user exists first (IMPORTANT FIX)
    db.query(
        "SELECT id FROM users WHERE phone=?",
        [phone],
        (err, users) => {

            if (err) {
                console.log(err);
                return res.status(500).send("DB error");
            }

            if (users.length === 0) {
                return res.status(404).send("User not found");
            }

            const userId = users[0].id;

            // 3. Insert deposit as pending
            db.query(
                `INSERT INTO transactions 
                (user_id, type, amount, status, receipt)
                VALUES (?, 'deposit', ?, 'pending', ?)`,
                [userId, depositAmount, receipt],
                (err2) => {

                    if (err2) {
                        console.log(err2);
                        return res.status(500).send("Deposit failed");
                    }

                    res.send ("Deposit sent for admin approval");
                }
            );
        }
    );
});
//Admin deposit panel
app.get("/admin/deposits", (req, res) => {

    const sql = `
        SELECT 
            t.id,
            t.amount,
            t.status,
            t.receipt,
            u.phone
        FROM transactions t
        JOIN users u ON t.user_id = u.id
        WHERE t.type='deposit'
        ORDER BY t.id DESC
    `;

    db.query(sql, (err, results) => {
        if (err) return res.status(500).send("DB error");
        res.json(results);
    });
});
//Admin deposit approve
app.post("/admin/deposit/approve", (req, res) => {

    const { id } = req.body;

    if (!id) {
        return res.status(400).send("Missing deposit id");
    }

    db.query(
        "SELECT * FROM transactions WHERE id=?",
        [id],
        (err, trx) => {

            if (err) return res.status(500).send("DB error");

            if (!trx || trx.length === 0) {
                return res.status(404).send("Transaction not found");
            }

            const amount = Number(trx[0].amount);
            const user_id = trx[0].user_id;

            // 1. APPROVE TRANSACTION
            db.query(
                "UPDATE transactions SET status='success' WHERE id=?",
                [id]
            );

            // 2. CREDIT USER BALANCE
            db.query(
                "UPDATE users SET balance = balance + ? WHERE id=?",
                [amount, user_id]
            );

            // 3. CHECK REFERRAL INFO
            db.query(
                "SELECT referred_by, referral_bonus_paid FROM users WHERE id=?",
                [user_id],
                (err2, userRes) => {

                    if (err2 || !userRes || userRes.length === 0) {
                        return res.send("Deposit approved");
                    }

                    const referredBy = userRes[0].referred_by;
                    const alreadyPaid = userRes[0].referral_bonus_paid;

                    // ❌ No referral OR already paid
                    if (!referredBy || alreadyPaid === 1) {
                        return res.send("Deposit approved");
                    }

                    // 4. FIND REFERRER
                    db.query(
                        "SELECT id FROM users WHERE referral_code=?",
                        [referredBy],
                        (err3, refUser) => {

                            if (err3 || !refUser || refUser.length === 0) {
                                return res.send("Deposit approved");
                            }

                            const refId = refUser[0].id;

                            const bonus = amount * 0.11;

                            // 5. CREDIT REFERRER
                            db.query(
                                "UPDATE users SET balance = balance + ? WHERE id=?",
                                [bonus, refId]
                            );
                            //save referral history
                            db.query(
                                "INSERT INTO referral_history (referrer_id, referred_user_id, amount) VALUES (?, ?, ?)",
                            [refId, user_id, bonus]
                        );

                            // 6. MARK BONUS PAID (IMPORTANT FIX)
                            db.query(
                                "UPDATE users SET referral_bonus_paid=1 WHERE id=?",
                                [user_id]
                            );

                            return res.send("Deposit approved + referral bonus paid");
                        }
                    );
                }
            );
        }
    );
});
//referral history
app.get("/referral-history/:userId", (req, res) => {

    const userId = req.params.userId;

    const sql = `
        SELECT 
            referral_history.amount,
            referral_history.created_at,
            users.phone AS referred_user
        FROM referral_history
        INNER JOIN users 
            ON users.id = referral_history.referred_user_id
        WHERE referral_history.referrer_id = ?
        ORDER BY referral_history.created_at DESC
    `;

    db.query(sql, [userId], (err, result) => {

        if (err) {
            console.log("Referral History DB Error:", err);
            return res.status(500).json([]);
        }

        return res.json(result);
    });
});
//Admin deposit reject
app.post("/admin/deposit/reject", (req, res) => {

    const { id } = req.body;

    db.query(
        "UPDATE transactions SET status='rejected' WHERE id=?",
        [id],
        (err) => {

            if (err) return res.status(500).send("DB error");

            res.send("Deposit rejected");
        }
    );
});

// ================= BUY / INVEST =================
app.post("/buy", (req, res) => {

    const { phone, amount } = req.body;
    const investAmount = Number(amount);

    db.query(
        "SELECT balance FROM users WHERE phone=?",
        [phone],
        (err, result) => {

            if (err) return res.status(500).json({ error: "DB error" });

            if (!result.length)
                return res.status(404).json({ error: "User not found" });

            const balance = result[0].balance;

            if (balance < investAmount)
                return res.status(400).json({ error: "Insufficient balance" });

            const newBalance = balance - investAmount;

            db.query(
                "UPDATE users SET balance=?, total_invested = total_invested + ? WHERE phone=?",
                [newBalance, investAmount, phone]
            );

            db.query(
                `INSERT INTO investments (phone, amount, status, end_date)
                VALUES (?, ?, 'active', DATE_ADD(NOW(), INTERVAL 15 DAY))`,
                [phone, investAmount],
                (err2) => {

                    if (err2)
                        return res.status(500).json({ error: "Investment failed" });

                    res.json({ message: "Investment successful" });
                }
            );
        }
    );
});

// ================= TOTAL INVESTED =================
app.get("/total-invested/:phone", (req, res) => {

    db.query(
        "SELECT total_invested FROM users WHERE phone=?",
        [req.params.phone],
        (err, result) => {

            if (err) return res.status(500).json({ error: "DB error" });

            res.json({ total: result[0].total_invested || 0 });
        }
    );
});

// ================= RETURNS =================
app.get("/returns/:phone", (req, res) => {

    db.query(
        "SELECT total_returns FROM users WHERE phone=?",
        [req.params.phone],
        (err, result) => {

            if (err) return res.status(500).json({ error: "DB error" });

            res.json({ returns: result[0].total_returns || 0 });
        }
    );
});

// ================= WITHDRAW =================
app.post("/withdraw", (req, res) => {

    const { phone, amount, pin } = req.body;

    const withdrawAmount = Number(amount);

    if (!phone || !withdrawAmount || !pin) {
        return res.status(400).send("Missing fields");
    }

    // STEP 1: MINIMUM WITHDRAWAL (₦7500)
    if (withdrawAmount < 7500) {
        return res.send("Minimum withdrawal is ₦7500");
    }

    // STEP 2: GET BANK DETAILS
    db.query(
        "SELECT * FROM bank_details WHERE phone=?",
        [phone],
        (err, bank) => {

            if (err) return res.status(500).send("DB error");

            if (!bank.length) {
                return res.send("Please set up bank details first");
            }

            const userBank = bank[0];

            // STEP 3: VERIFY PIN
            if (userBank.withdraw_pin !== pin) {
                return res.send("Invalid withdrawal PIN");
            }

            // STEP 4: GET USER
            db.query(
                "SELECT * FROM users WHERE phone=?",
                [phone],
                (err2, users) => {

                    if (err2) return res.status(500).send("DB error");

                    if (!users.length) {
                        return res.send("User not found");
                    }

                    const user = users[0];

                    // STEP 5: CHECK RETURNS BALANCE
                    if (user.total_returns < withdrawAmount) {
                        return res.send("Insufficient returns balance");
                    }

                    // STEP 6: CHECK WEEKLY LIMIT
                        db.query(
                        `SELECT id FROM transactions 
                         WHERE user_id=? 
                         AND type='withdraw' 
                         AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
                        [user.id],
                        (err3, existing) => {

                            if (err3) return res.status(500).send("DB error");

                            if (existing.length > 0) {
                                return res.send("You can only withdraw once per week");
                            }

                            // STEP 7: APPLY 3% TAX
                            const tax = withdrawAmount * 0.03;
                            const finalAmount = withdrawAmount - tax;

                            // STEP 8: INSERT WITHDRAWAL
                            db.query(
                                `INSERT INTO transactions 
                                (user_id, type, amount, status, bank_name, account_name, account_number) 
                                VALUES (?, 'withdraw', ?, 'pending', ?, ?, ?)`,
                                [
                                    user.id,
                                    finalAmount,
                                    userBank.bank_name,
                                    userBank.account_name,
                                    userBank.account_number
                                ],
                                (err4) => {

                                    if (err4) {
                                        console.log(err4);
                                        return res.status(500).send("Transaction failed");
                                    }

                                    res.send(
                                        `Withdrawal submitted successfully. 3% tax deducted (₦${tax.toFixed(2)}). You will receive ₦${finalAmount.toFixed(2)} after approval.`
                                    );
                                }
                            );
                        }
                    );
                }
            );
        }
    );
});
// admin get withdrawal request
// bank details update`
app.post("/bank-details", (req, res) => {

    const { phone, account_name, account_number, bank_name, withdraw_pin } = req.body;

    // 1. Validate input
    if (!phone || !account_name || !account_number || !bank_name || !withdraw_pin) {
        return res.status(400).json({ error: "All fields are required" });
    }

    // 2. Validate PIN (4 digits only)
    if (!/^\d{4}$/.test(withdraw_pin)) {
        return res.status(400).json({ error: "PIN must be 4 digits" });
    }

    // 3. Check if bank already exists for this phone
    db.query(
        "SELECT * FROM bank_details WHERE phone=?",
        [phone],
        (err, result) => {

            if (err) {
                console.log(err);
                return res.status(500).json({ error: "DB error" });
            }

            // 4. UPDATE if exists
            if (result.length > 0) {

                db.query(
                    `UPDATE bank_details 
                    SET account_name=?, account_number=?, bank_name=?, withdraw_pin=? 
                    WHERE phone=?`,
                    [account_name, account_number, bank_name, withdraw_pin, phone],
                    (err2) => {

                        if (err2) {
                            console.log(err2);
                            return res.status(500).json({ error: "Update failed" });
                        }

                        res.json({ message: "Bank details updated successfully" });
                    }
                );

            } else {

                // 5. INSERT new record
                db.query(
                    `INSERT INTO bank_details 
                    (phone, account_name, account_number, bank_name, withdraw_pin) 
                    VALUES (?, ?, ?, ?, ?)`,
                    [phone, account_name, account_number, bank_name, withdraw_pin],
                    (err3) => {

                        if (err3) {
                            console.log("BANK INSERT ERROR:", err3);
                            return res.status(500).json({ error: "Insert failed" });
                        }

                        res.json({ message: "Bank details saved successfully" });
                    }
                );
            }
        }
    );
});
// ================= TRANSACTIONS =================
app.get("/transactions/:phone", (req, res) => {

    const phone = req.params.phone;

    const sql = `
        SELECT 
            t.id,
            t.type,
            t.amount,
            t.status,
            t.created_at
        FROM transactions t
        JOIN users u ON t.user_id = u.id
        WHERE u.phone = ?
        ORDER BY t.id DESC
    `;

    db.query(sql, [phone], (err, results) => {

        if (err) {
            console.log(err);
            return res.status(500).send("DB error");
        }

        res.json(results);
    });
});
// admin approve withdrawal
app.post("/admin/approve-withdraw", (req, res) => {

    const { id } = req.body;

    // 1. get withdrawal
    db.query(
        "SELECT * FROM transactions WHERE id=?",
        [id],
        (err, result) => {

            if (err) return res.status(500).send("DB error");

            const withdrawal = result[0];

            if (!withdrawal) {
                return res.send("Not found");
            }

            // 2. get user
            db.query(
                "SELECT * FROM users WHERE id=?",
                [withdrawal.user_id],
                (err2, users) => {

                    const user = users[0];

                    if (user.returns < withdrawal.amount) {
                        return res.send("Insufficient balance");
                    }

                    // 3. deduct balance
                    db.query(
                        "UPDATE users SET returns = returns - ? WHERE id=?",
                        [withdrawal.amount, user.id]
                    );

                    // 4. mark approved
                    db.query(
                        "UPDATE transactions SET status='approved' WHERE id=?",
                        [id],
                        () => {
                            res.send("Withdrawal approved");
                        }
                    );
                }
            );
        }
    );
});
app.post("/admin/withdrawals/approve", (req, res) => {

    const { id } = req.body;

    if (!id) {
        return res.status(400).send("Missing withdrawal id");
    }

    db.query(
        `SELECT t.id, t.amount, t.user_id, u.total_returns
         FROM transactions t
         JOIN users u ON t.user_id = u.id
         WHERE t.id=?`,
        [id],
        (err, result) => {

            if (err) {
                console.log("DB ERROR:", err);
                return res.status(500).send("DB error");
            }

            if (!result || result.length === 0) {
                return res.send("Transaction not found");
            }

            const trx = result[0];

            const amount = Number(trx.amount);
            const balance = Number(trx.total_returns);

            // ✅ RULE 1: MINIMUM WITHDRAWAL AMOUNT
            if (amount < 500) {
                return res.send("Minimum withdrawal is ₦500");
            }

            // ✅ RULE 2: CHECK FUNDS
            if (balance < amount) {
                return res.send("Insufficient returns balance");
            }

            // ✅ STEP 1: DEDUCT RETURNS FIRST
            db.query(
                "UPDATE users SET total_returns = total_returns - ? WHERE id=?",
                [amount, trx.user_id],
                (err1) => {

                    if (err1) {
                        console.log("UPDATE ERROR:", err1);
                        return res.status(500).send("Failed to deduct returns");
                    }

                    // ✅ STEP 2: UPDATE TRANSACTION STATUS
                    db.query(
                        "UPDATE transactions SET status='success' WHERE id=?",
                        [id],
                        (err2) => {

                            if (err2) {
                                console.log("STATUS ERROR:", err2);
                                return res.status(500).send("Failed to update status");
                            }

                            return res.send("Withdrawal approved successfully");
                        }
                    );
                }
            );
        }
    );
});
app.get("/returns/:phone", (req, res) => {

    db.query(
        "SELECT total_returns FROM users WHERE phone=?",
        [req.params.phone],
        (err, result) => {

            if (err) return res.status(500).json({ error: "DB error" });

            if (!result.length) {
                return res.json({ total: 0 });
            }

            res.json({ total: result[0].total_returns });
        }
    );
});
app.post("/admin/withdrawals/reject", (req, res) => {

    const { id } = req.body;

    db.query(
        "UPDATE transactions SET status='rejected' WHERE id=?",
        [id],
        (err) => {

            if (err) return res.status(500).send("DB error");

            res.send("Withdrawal rejected");
        }
    );
});
//admin withdrawals

app.get("/admin/withdrawals", (req, res) => {

    const sql = `
        SELECT 
            t.id,
            t.amount,
            t.status,
            t.created_at,
            u.phone,
            b.account_name,
            b.account_number,
            b.bank_name,
            b.withdraw_pin
        FROM transactions t
        JOIN users u ON t.user_id = u.id
        LEFT JOIN bank_details b ON b.phone = u.phone
        WHERE t.type = 'withdraw'
        ORDER BY t.id DESC
    `;

    db.query(sql, (err, results) => {

        if (err) {
            console.log(err);
            return res.status(500).send("DB error");
        }

        res.json(results);
    });
});
// admin login
app.post("/admin/login", (req, res) => {

    const { phone, password } = req.body;

    if (!phone || !password) {
        return res.status(400).json({ error: "Phone and password required" });
    }

    db.query(
        "SELECT * FROM users WHERE phone=? AND password=? AND role='admin' LIMIT 1",
        [phone, password],
        (err, result) => {

            if (err) {
                console.log("ADMIN LOGIN ERROR:", err);
                return res.status(500).json({ error: "DB error" });
            }

            if (!result || result.length === 0) {
                return res.status(401).json({ error: "Invalid admin login" });
            }

            const admin = result[0];

            return res.json({
                success: true,
                adminId: admin.id,
                phone: admin.phone,
                role: admin.role
            });
        }
    );
});


//admin users
app.post("/admin/users", (req, res) => {

    const { phone, password } = req.body;

    db.query(
        "SELECT * FROM users WHERE phone=? AND password=? AND role='admin'",
        [phone, password],
        (err, result) => {

            if (err) return res.status(500).send("DB error");

            if (!result.length) {
                return res.status(403).send("Unauthorized");
            }

            db.query(
                "SELECT id, phone, balance, status FROM users",
                (err2, users) => {
                    res.json(users);
                }
            );
        }
    );
});
app.get("/interest-history", (req, res) => {

    const { phone } = req.query;

    db.query(
        "SELECT * FROM interest_history WHERE phone=? ORDER BY id DESC",
        [phone],
        (err, results) => {

            if (err) {
                return res.status(500).send("DB error");
            }

            res.json(results);
        }
    );
});
//admin user bank details
app.get("/admin/user-bank/:phone", (req, res) => {

    const phone = req.params.phone;

    db.query(
        "SELECT account_name, account_number, bank_name FROM bank_details WHERE phone=?",
        [phone],
        (err, result) => {

            if (err) return res.status(500).json({ error: "DB error" });

            if (!result.length) {
                return res.json(null);
            }

            res.json(result[0]);
        }
    );
});
//admin create bonus section


app.post("/admin/create-bonus", (req, res) => {

    const { amount, maxUsers, expiryHours, expiryMinutes } = req.body;

    const code = "BONUS-" + Math.random().toString(36).substring(2, 8).toUpperCase();

    // convert everything into minutes
    const totalMinutes =
        (Number(expiryHours || 0) * 60) + Number(expiryMinutes || 0);

    const expiresAt = new Date(Date.now() + totalMinutes * 60000);

    db.query(
        `INSERT INTO bonus_codes 
        (code, amount, max_users, used_count, expires_at)
        VALUES (?, ?, ?, 0, ?)`,
        [code, amount, maxUsers, expiresAt],
        (err) => {

            if (err) {
                console.log(err);
                return res.status(500).json({ error: "Failed to create bonus" });
            }

            res.json({
                code,
                amount,
                maxUsers,
                expiresAt
            });
        }
    );
});
//user claim bonus

app.post("/claim-bonus", (req, res) => {

    const { userId, code } = req.body;

    if (!userId || !code) {
        return res.status(400).send("Missing data");
    }

    db.query(
        "SELECT * FROM bonus_codes WHERE code=?",
        [code],
        (err, result) => {

            if (err) {
                console.log(err);
                return res.status(500).send("DB error");
            }

            if (!result.length) {
                return res.send("Invalid code");
            }

            const bonus = result[0];

            // ✅ FIXED EXPIRY CHECK (ROBUST)
            const now = Date.now();
            const expiry = new Date(bonus.expires_at).getTime();

            if (isNaN(expiry)) {
                return res.send("Invalid expiry time");
            }

            if (expiry <= now) {
                return res.send("Code expired");
            }

            // usage limit check
            if (bonus.used_count >= bonus.max_users) {
                return res.send("Code already fully used");
            }

            // check if user already used it
            db.query(
                "SELECT * FROM bonus_claims WHERE user_id=? AND code=?",
                [userId, code],
                (err2, used) => {

                    if (err2) {
                        console.log(err2);
                        return res.status(500).send("DB error");
                    }

                    if (used.length > 0) {
                        return res.send("You already used this code");
                    }

                    // add balance
                    db.query(
                        "UPDATE users SET balance = balance + ? WHERE id=?",
                        [bonus.amount, userId]
                    );

                    // log claim
                    db.query(
                        "INSERT INTO bonus_claims (user_id, code, amount) VALUES (?, ?, ?)",
                        [userId, code, bonus.amount]
                    );

                    // increase usage count
                    db.query(
                        "UPDATE bonus_codes SET used_count = used_count + 1 WHERE code=?",
                        [code]
                    );

                    return res.send(`🎉 Congratulations! You received ₦${bonus.amount}`);
                }
            );
        }
    );
});
//check active investment for bonus box
app.get("/user/has-active-investment/:phone", (req, res) => {

    db.query(
        `SELECT * FROM investments 
         WHERE phone=? AND status='active'`,
        [req.params.phone],
        (err, result) => {

            if (err) return res.status(500).send("DB error");

            res.json({
                active: result.length > 0
            });
        }
    );
});
 //admin-all-users
 app.get("/admin/all-users", (req, res) => {

    const sql = `
        SELECT id, phone, status, balance
        FROM users
        ORDER BY id DESC
    `;

    db.query(sql, (err, result) => {

        if (err) {
            console.log(err);
            return res.status(500).json({ error: "DB error" });
        }

        res.json(result);
    });
});
//admin lock/unlock
app.post("/admin/toggle-user-status", (req, res) => {

    const { id, status } = req.body;

    db.query(
        "UPDATE users SET status=? WHERE id=?",
        [status, id],
        (err) => {

            if (err) return res.status(500).send("DB error");

            res.send("User status updated");
        }
    );
});
// ================= START SERVER =================
app.listen(3000, () => {
    console.log("Server running on 3000");
});