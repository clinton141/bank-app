const express = require("express");

const cors = require("cors");
const bodyParser = require("body-parser");
const cron = require("node-cron");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const db = require("./DB");

const JWT_SECRET = process.env.JWT_SECRET || "mobile_wealth_secret_key_2026";

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

// STATIC FILES
app.use(express.static(path.join(__dirname, "public")));
app.use("/admin", express.static(path.join(__dirname, "admin")));

// BLOCK ADMIN FILE ACCESS (optional)
// app.use("/admin", (req, res) => {
//     return res.status(403).send("Access denied");
// });

app.get("/admin/login.html", (req, res) => {
    res.sendFile(path.join(__dirname, "admin", "login.html"));
});

app.get("/admin/users", (req, res) => {

    db.query(
        "SELECT id, phone, balance, status FROM users ORDER BY id DESC",
        (err, users) => {

            if (err) {
                return res.status(500).json({ error: "DB error" });
            }

            return res.json(users || []);
        }
    );
});
// ================= DATABASE =================



// ADMIN LOGIN ROUTE

// ADMIN DASHBOARD ROUTE
app.get("/admin/dashboard", (req, res) => {

    return res.sendFile(
        path.join(__dirname, "admin", "dashboard.html")
    );
});

// SUPPORT BOTH URL FORMATS
app.get("/admin/dashboard.html", (req, res) => {

    return res.sendFile(
        path.join(__dirname, "admin", "dashboard.html")
    );
});

// HOME ROUTE
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

    for (let i = 0; i < 3; i++) {
        code += letters[Math.floor(Math.random() * letters.length)];
    }

    for (let i = 0; i < 5; i++) {
        code += numbers[Math.floor(Math.random() * numbers.length)];
    }

    return code;
}

// CREATE UPLOADS FOLDER
if (!fs.existsSync(path.join(__dirname, "uploads"))) {
    fs.mkdirSync(path.join(__dirname, "uploads"));
}

// MULTER CONFIG
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, "uploads"));
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + "-" + file.originalname);
    }
});

const upload = multer({ storage });

// SERVE UPLOADED FILES
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// TEST CONNECTION


// CHECK USER STATUS FOR LOCKING
function checkUserStatus(phone, cb) {
    db.query(
        "SELECT status FROM users WHERE phone=?",
        [phone],
        (err, result) => {
            if (err || !result || !result.length) {
                return cb(false);
            }
            cb(result[0].status === "active");
        }
    );
}

// ================= DAILY INVESTMENT SYSTEM =================
// runs every 12AM
cron.schedule("0 0 * * *", () => {

    // 1. EXPIRE INVESTMENTS
    db.query(
        "UPDATE investments SET status='expired' WHERE end_date <= NOW() AND status='active'",
        (err) => {
            if (err) console.log("Expire error:", err);
        }
    );

    // 2. GET ACTIVE INVESTMENTS
    const sql = `
        SELECT user_id, SUM(amount) AS total_amount
        FROM investments
        WHERE status='active'
        GROUP BY user_id
    `;

    db.query(sql, (err, results) => {

        if (err) {
            console.log("Interest fetch error:", err);
            return;
        }

        if (!results || results.length === 0) {
            console.log("⚠️ No active investments found");
            return;
        }

        results.forEach(row => {

            const totalAmount = Number(row.total_amount || 0);
            const interest = totalAmount * 0.10;

            // UPDATE USER RETURNS
            db.query(
                `UPDATE users 
                 SET total_returns = COALESCE(total_returns,0) + ? 
                 WHERE id=?`,
                [interest, row.user_id],
                (err2) => {
                    if (err2) console.log("Update error:", err2);
                }
            );

            // SAVE INTEREST HISTORY
            db.query(
                `INSERT INTO interest_history (user_id, amount, interest, created_at)
                 VALUES (?, ?, ?, NOW())`,
                [row.user_id, totalAmount, interest],
                (err3) => {
                    if (err3) console.log("History save error:", err3);
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

    // VALIDATE PHONE
    if (!phone || !/^\d{11}$/.test(phone)) {
        return res.status(400).json({ error: "Phone must be 11 digits" });
    }

    if (!password) {
        return res.status(400).json({ error: "Password is required" });
    }

    // CHECK USER EXISTS
    db.query(
        "SELECT id FROM users WHERE phone=?",
        [phone],
        (err, result) => {

            if (err) return res.status(500).json({ error: "DB error" });

            if (result && result.length > 0) {
                return res.status(400).json({ error: "User already exists" });
            }

            const referralCode = generateReferralCode();

            function insertUser(validRef) {

                db.query(
                    `INSERT INTO users 
                    (phone, password, balance, withdrawable_balance, total_invested, total_returns, status, role, referral_code, referred_by)
                    VALUES (?, ?, 0, 0, 0, 0, 'active', 'user', ?, ?)`,
                    [phone, password, referralCode, validRef],
                    (err3) => {

                        if (err3) {
                            console.log("SIGNUP ERROR:", err3);
                            return res.status(500).json({ error: "Signup failed" });
                        }

                        db.query(
                            "SELECT id, phone, referral_code, balance FROM users WHERE phone=?",
                            [phone],
                            (err4, users) => {

                                if (err4) {
                                    return res.status(500).json({ error: "DB error" });
                                }

                                return res.json(users[0]);
                            }
                        );
                    }
                );
            }

            if (referredBy) {

                db.query(
                    "SELECT id FROM users WHERE referral_code=?",
                    [referredBy],
                    (err2, refUser) => {

                        const validRef =
                            (!err2 && refUser && refUser.length > 0)
                                ? referredBy
                                : null;

                        insertUser(validRef);
                    }
                );

            } else {
                insertUser(null);
            }
        }
    );
});

// =================user LOGIN =================
app.post("/login", (req, res) => {

    const { phone, password } = req.body;

    // VALIDATION
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

            if (!result || result.length === 0) {
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

            return res.json({
                token,
                user
            });
        }
    );
});
// ================= RESET PASSWORD =================
app.post("/reset-password", (req, res) => {

    const { phone, newPassword } = req.body;

    // VALIDATE INPUT
    if (!phone || !newPassword) {
        return res.status(400).json({ error: "Phone and new password are required" });
    }

    // VALIDATE PHONE FORMAT
    if (!/^\d{11}$/.test(phone)) {
        return res.status(400).json({ error: "Phone must be exactly 11 digits" });
    }

    // CHECK USER EXISTS
    db.query(
        "SELECT id FROM users WHERE phone=?",
        [phone],
        (err, users) => {

            if (err) {
                return res.status(500).json({ error: "Database error" });
            }

            if (!users || users.length === 0) {
                return res.status(404).json({ error: "User not found" });
            }

            // UPDATE PASSWORD
            db.query(
                "UPDATE users SET password=? WHERE phone=?",
                [newPassword, phone],
                (err2) => {

                    if (err2) {
                        return res.status(500).json({ error: "Update failed" });
                    }

                    return res.json({
                        message: "Password reset successful, please login"
                    });
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

            if (err) {
                return res.status(500).json({ error: "DB error" });
            }

            if (!result || result.length === 0) {
                return res.status(404).json({ error: "User not found" });
            }

            return res.json({
                balance: result[0].balance || 0
            });
        }
    );
});

app.post("/deposit", upload.single("receipt"), (req, res) => {

    const phone = req.body.phone?.trim();
    const amount = Number(req.body.amount);
    const receipt = req.file ? req.file.filename : null;

    if (!phone || !amount || amount <= 0 || !receipt) {
        return res.status(400).json({ error: "Missing or invalid fields" });
    }

    db.query(
        "SELECT id FROM users WHERE phone = ? LIMIT 1",
        [phone],
        (err, users) => {

            if (err) {
                console.log(err);
                return res.status(500).json({ error: "DB error" });
            }

            if (!users || users.length === 0) {
                return res.status(404).json({ error: "User not found" });
            }

            const userId = users[0].id;

            db.query(
                `INSERT INTO transactions (user_id, type, amount, status, receipt)
                 VALUES (?, 'deposit', ?, 'pending', ?)`,
                [userId, amount, receipt],
                (err2) => {

                    if (err2) {
                        console.log(err2);
                        return res.status(500).json({ error: "Deposit failed" });
                    }

                    return res.json({
                        success: true,
                        message: "Deposit submitted for admin approval"
                    });
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
        LEFT JOIN users u ON t.user_id = u.id
        WHERE t.type = 'deposit'
        ORDER BY t.id DESC
    `;

    db.query(sql, (err, results) => {

        if (err) {
            console.log("DB ERROR:", err);
            return res.status(200).json([]); // NEVER return HTML crash
        }

        return res.status(200).json(results || []);
    });
});

app.post("/admin/deposit/approve", (req, res) => {

    const { id } = req.body;

    if (!id) {
        return res.status(400).json({ error: "Missing deposit id" });
    }

    db.query(
        "SELECT * FROM transactions WHERE id=?",
        [id],
        (err, trx) => {

            if (err) {
                return res.status(500).json({ error: "DB error" });
            }

            if (!trx || trx.length === 0) {
                return res.status(404).json({ error: "Transaction not found" });
            }

            const amount = Number(trx[0].amount || 0);
            const user_id = trx[0].user_id;

            // APPROVE TRANSACTION
            db.query(
                "UPDATE transactions SET status='success' WHERE id=?",
                [id]
            );

            // CREDIT USER BALANCE
            db.query(
                "UPDATE users SET balance = balance + ? WHERE id=?",
                [amount, user_id]
            );

            // CHECK REFERRAL INFO
            db.query(
                "SELECT referred_by, referral_bonus_paid FROM users WHERE id=?",
                [user_id],
                (err2, userRes) => {

                    if (err2 || !userRes || userRes.length === 0) {
                        return res.json({ message: "Deposit approved" });
                    }

                    const referredBy = userRes[0].referred_by;
                    const alreadyPaid = userRes[0].referral_bonus_paid;

                    if (!referredBy || alreadyPaid === 1) {
                        return res.json({ message: "Deposit approved" });
                    }

                    db.query(
                        "SELECT id FROM users WHERE referral_code=?",
                        [referredBy],
                        (err3, refUser) => {

                            if (err3 || !refUser || refUser.length === 0) {
                                return res.json({ message: "Deposit approved" });
                            }

                            const refId = refUser[0].id;
                            const bonus = amount * 0.11;

                            // CREDIT REFERRER
                            db.query(
                                "UPDATE users SET balance = balance + ? WHERE id=?",
                                [bonus, refId]
                            );

                            // SAVE REFERRAL HISTORY
                            db.query(
                                "INSERT INTO referral_history (referrer_id, referred_user_id, amount) VALUES (?, ?, ?)",
                                [refId, user_id, bonus]
                            );

                            // MARK BONUS PAID
                            db.query(
                                "UPDATE users SET referral_bonus_paid=1 WHERE id=?",
                                [user_id]
                            );

                            return res.json({
                                message: "Deposit approved + referral bonus paid"
                            });
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
            referral_bonus_history.amount,
            referral_bonus_history.created_at,
            referral_bonus_history.referred_user_id
        FROM referral_bonus_history
        WHERE referrer_id = ?
        ORDER BY created_at DESC
    `;

    db.query(sql, [userId], (err, result) => {

        if (err) {
            console.log(err);
            return res.status(200).json([]); // IMPORTANT
        }

        return res.status(200).json(result || []);
    });
});

app.post("/admin/deposit/reject", (req, res) => {

    const { id } = req.body;

    if (!id) {
        return res.status(400).json({ error: "Missing deposit id" });
    }

    db.query(
        "UPDATE transactions SET status='rejected' WHERE id=?",
        [id],
        (err) => {

            if (err) {
                return res.status(500).json({ error: "DB error" });
            }

            return res.json({ message: "Deposit rejected" });
        }
    );
});

// ================= BUY / INVEST =================
app.post("/buy", (req, res) => {

    const { phone, amount } = req.body;
    const investAmount = Number(amount);

    if (!phone || !investAmount || investAmount <= 0) {
        return res.status(400).json({ error: "Invalid input" });
    }

    db.query(
        "SELECT balance FROM users WHERE phone=?",
        [phone],
        (err, result) => {

            if (err) {
                return res.status(500).json({ error: "DB error" });
            }

            if (!result || result.length === 0) {
                return res.status(404).json({ error: "User not found" });
            }

            const balance = Number(result[0].balance || 0);

            if (balance < investAmount) {
                return res.status(400).json({ error: "Insufficient balance" });
            }

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

                    if (err2) {
                        return res.status(500).json({ error: "Investment failed" });
                    }

                    return res.json({
                        message: "Investment successful"
                    });
                }
            );
        }
    );
})

// ================= TOTAL INVESTED =================
app.get("/total-invested/:phone", (req, res) => {

    db.query(
        "SELECT total_invested FROM users WHERE phone=?",
        [req.params.phone],
        (err, result) => {

            if (err) {
                return res.status(500).json({ error: "DB error" });
            }

            if (!result || result.length === 0) {
                return res.status(404).json({ error: "User not found" });
            }

            return res.json({
                total: Number(result[0].total_invested || 0)
            });
        }
    );
});

// ================= RETURNS =================
app.get("/returns/:phone", (req, res) => {

    db.query(
        "SELECT total_returns FROM users WHERE phone=?",
        [req.params.phone],
        (err, result) => {

            if (err) {
                return res.status(500).json({ error: "DB error" });
            }

            if (!result || result.length === 0) {
                return res.status(404).json({ error: "User not found" });
            }

            return res.json({
                returns: Number(result[0].total_returns || 0)
            });
        }
    );
});

// ================= WITHDRAW =================
app.post("/withdraw", (req, res) => {

    const { phone, amount, pin } = req.body;

    const withdrawAmount = Number(amount);

    // VALIDATION
    if (!phone || !withdrawAmount || withdrawAmount <= 0 || !pin) {
        return res.status(400).json({ error: "Missing or invalid fields" });
    }

    // MINIMUM WITHDRAWAL
    if (withdrawAmount < 7500) {
        return res.status(400).json({ error: "Minimum withdrawal is ₦7500" });
    }

    // GET BANK DETAILS
    db.query(
        "SELECT * FROM bank_details WHERE phone=?",
        [phone],
        (err, bank) => {

            if (err) {
                return res.status(500).json({ error: "DB error" });
            }

            if (!bank || bank.length === 0) {
                return res.status(404).json({ error: "Please set up bank details first" });
            }

            const userBank = bank[0];

            // VERIFY PIN
            if (String(userBank.withdraw_pin) !== String(pin)) {
                return res.status(403).json({ error: "Invalid withdrawal PIN" });
            }

            // GET USER
            db.query(
                "SELECT * FROM users WHERE phone=?",
                [phone],
                (err2, users) => {

                    if (err2) {
                        return res.status(500).json({ error: "DB error" });
                    }

                    if (!users || users.length === 0) {
                        return res.status(404).json({ error: "User not found" });
                    }

                    const user = users[0];

                    const totalReturns = Number(user.total_returns || 0);

                    if (totalReturns < withdrawAmount) {
                        return res.status(400).json({ error: "Insufficient returns balance" });
                    }

                    // WEEKLY LIMIT CHECK
                    db.query(
                        `SELECT id FROM transactions 
                         WHERE user_id=? 
                         AND type='withdraw' 
                         AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
                        [user.id],
                        (err3, existing) => {

                            if (err3) {
                                return res.status(500).json({ error: "DB error" });
                            }

                            if (existing && existing.length > 0) {
                                return res.status(400).json({
                                    error: "You can only withdraw once per week"
                                });
                            }

                            // TAX CALCULATION
                            const tax = withdrawAmount * 0.03;
                            const finalAmount = withdrawAmount - tax;

                            // INSERT WITHDRAWAL
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
                                        return res.status(500).json({ error: "Transaction failed" });
                                    }

                                    return res.json({
                                        message: "Withdrawal submitted successfully",
                                        tax: tax.toFixed(2),
                                        finalAmount: finalAmount.toFixed(2)
                                    });
                                }
                            );
                        }
                    );
                }
            );
        }
    );
});

// bank details update`
app.post("/bank-details", (req, res) => {

    const { phone, account_name, account_number, bank_name, withdraw_pin } = req.body;

    // VALIDATION
    if (!phone || !account_name || !account_number || !bank_name || !withdraw_pin) {
        return res.status(400).json({ error: "All fields are required" });
    }

    // PIN VALIDATION
    if (!/^\d{4}$/.test(String(withdraw_pin))) {
        return res.status(400).json({ error: "PIN must be 4 digits" });
    }

    db.query(
        "SELECT id FROM bank_details WHERE phone=?",
        [phone],
        (err, result) => {

            if (err) {
                console.log(err);
                return res.status(500).json({ error: "DB error" });
            }

            // UPDATE EXISTING
            if (result && result.length > 0) {

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

                        return res.json({
                            message: "Bank details updated successfully"
                        });
                    }
                );

            } else {

                // INSERT NEW
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

                        return res.json({
                            message: "Bank details saved successfully"
                        });
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
            return res.status(500).json({ error: "DB error" });
        }

        return res.json(results || []);
    });
});

app.post("/admin/approve-withdraw", (req, res) => {

    const { id } = req.body;

    if (!id) {
        return res.status(400).json({ error: "Missing withdrawal id" });
    }

    db.query(
        "SELECT * FROM transactions WHERE id=?",
        [id],
        (err, result) => {

            if (err) {
                return res.status(500).json({ error: "DB error" });
            }

            if (!result || result.length === 0) {
                return res.status(404).json({ error: "Not found" });
            }

            const withdrawal = result[0];

            db.query(
                "SELECT * FROM users WHERE id=?",
                [withdrawal.user_id],
                (err2, users) => {

                    if (err2) {
                        return res.status(500).json({ error: "DB error" });
                    }

                    if (!users || users.length === 0) {
                        return res.status(404).json({ error: "User not found" });
                    }

                    const user = users[0];

                    const userBalance = Number(user.returns || user.total_returns || 0);

                    if (userBalance < withdrawal.amount) {
                        return res.status(400).json({ error: "Insufficient balance" });
                    }

                    db.query(
                        "UPDATE users SET returns = returns - ? WHERE id=?",
                        [withdrawal.amount, user.id]
                    );

                    db.query(
                        "UPDATE transactions SET status='approved' WHERE id=?",
                        [id],
                        () => {
                            return res.json({
                                message: "Withdrawal approved"
                            });
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
        return res.status(400).json({ error: "Missing withdrawal id" });
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
                return res.status(500).json({ error: "DB error" });
            }

            if (!result || result.length === 0) {
                return res.status(404).json({ error: "Transaction not found" });
            }

            const trx = result[0];

            const amount = Number(trx.amount || 0);
            const balance = Number(trx.total_returns || 0);

            // RULE 1: MINIMUM WITHDRAWAL AMOUNT
            if (amount < 500) {
                return res.status(400).json({ error: "Minimum withdrawal is ₦500" });
            }

            // RULE 2: CHECK FUNDS
            if (balance < amount) {
                return res.status(400).json({ error: "Insufficient returns balance" });
            }

            // STEP 1: DEDUCT RETURNS FIRST
            db.query(
                "UPDATE users SET total_returns = total_returns - ? WHERE id=?",
                [amount, trx.user_id],
                (err1) => {

                    if (err1) {
                        console.log("UPDATE ERROR:", err1);
                        return res.status(500).json({ error: "Failed to deduct returns" });
                    }

                    // STEP 2: UPDATE TRANSACTION STATUS
                    db.query(
                        "UPDATE transactions SET status='success' WHERE id=?",
                        [id],
                        (err2) => {

                            if (err2) {
                                console.log("STATUS ERROR:", err2);
                                return res.status(500).json({ error: "Failed to update status" });
                            }

                            return res.json({
                                message: "Withdrawal approved successfully"
                            });
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

            if (err) {
                return res.status(500).json({ error: "DB error" });
            }

            if (!result || result.length === 0) {
                return res.json({ total: 0 });
            }

            return res.json({
                total: Number(result[0].total_returns || 0)
            });
        }
    );
});

app.post("/admin/withdrawals/reject", (req, res) => {

    const { id } = req.body;

    if (!id) {
        return res.status(400).json({ error: "Missing withdrawal id" });
    }

    db.query(
        "UPDATE transactions SET status='rejected' WHERE id=?",
        [id],
        (err) => {

            if (err) {
                return res.status(500).json({ error: "DB error" });
            }

            return res.json({
                message: "Withdrawal rejected"
            });
        }
    );
});

// ADMIN WITHDRAWALS LIST
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
            return res.status(500).json({ error: "DB error" });
        }

        return res.json(results || []);
    });
});

// ADMIN LOGIN
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

            const token = "admin_" + admin.id + "_" + Date.now();

            return res.json({
                success: true,
                token,
                admin: {
                    id: admin.id,
                    phone: admin.phone,
                    role: admin.role
                }
            });
        }
    );
});

//admin users
app.post("/admin/users", (req, res) => {

    const { phone, password } = req.body;

    if (!phone || !password) {
        return res.status(400).json({ error: "Missing admin credentials" });
    }

    db.query(
        "SELECT * FROM users WHERE phone=? AND password=? AND role='admin' LIMIT 1",
        [phone, password],
        (err, result) => {

            if (err) {
                return res.status(500).json({ error: "DB error" });
            }

            if (!result || result.length === 0) {
                return res.status(403).json({ error: "Unauthorized" });
            }

            db.query(
                "SELECT id, phone, balance, status FROM users ORDER BY id DESC",
                (err2, users) => {

                    if (err2) {
                        return res.status(500).json({ error: "DB error" });
                    }

                    return res.json(users || []);
                }
            );
        }
    );
});

app.get("/interest-history", (req, res) => {

    const { phone } = req.query;

    if (!phone) {
        return res.status(400).json({ error: "Phone is required" });
    }

    db.query(
        "SELECT * FROM interest_history WHERE phone=? ORDER BY id DESC",
        [phone],
        (err, results) => {

            if (err) {
                return res.status(500).json({ error: "DB error" });
            }

            return res.json(results || []);
        }
    );
});

// ADMIN USER BANK DETAILS
app.get("/admin/user-bank/:phone", (req, res) => {

    const phone = req.params.phone;

    db.query(
        "SELECT account_name, account_number, bank_name FROM bank_details WHERE phone=?",
        [phone],
        (err, result) => {

            if (err) {
                return res.status(500).json({ error: "DB error" });
            }

            if (!result || result.length === 0) {
                return res.json(null);
            }

            return res.json(result[0]);
        }
    );
});


//admin create bonus section
app.post("/admin/create-bonus", (req, res) => {

    const { amount, maxUsers, expiryHours, expiryMinutes } = req.body;

    if (!amount || !maxUsers) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    const code = "BONUS-" + Math.random().toString(36).substring(2, 8).toUpperCase();

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

            return res.json({
                code,
                amount: Number(amount),
                maxUsers: Number(maxUsers),
                expiresAt
            });
        }
    );
});

app.post("/claim-bonus", (req, res) => {

    const { userId, code } = req.body;

    if (!userId || !code) {
        return res.status(400).json({ error: "Missing data" });
    }

    db.query(
        "SELECT * FROM bonus_codes WHERE code=?",
        [code],
        (err, result) => {

            if (err) {
                console.log(err);
                return res.status(500).json({ error: "DB error" });
            }

            if (!result || result.length === 0) {
                return res.status(404).json({ error: "Invalid code" });
            }

            const bonus = result[0];

            const now = Date.now();
            const expiry = new Date(bonus.expires_at).getTime();

            if (isNaN(expiry)) {
                return res.status(400).json({ error: "Invalid expiry time" });
            }

            if (expiry <= now) {
                return res.status(400).json({ error: "Code expired" });
            }

            if (bonus.used_count >= bonus.max_users) {
                return res.status(400).json({ error: "Code already fully used" });
            }

            db.query(
                "SELECT * FROM bonus_claims WHERE user_id=? AND code=?",
                [userId, code],
                (err2, used) => {

                    if (err2) {
                        return res.status(500).json({ error: "DB error" });
                    }

                    if (used && used.length > 0) {
                        return res.status(400).json({ error: "You already used this code" });
                    }

                    // ADD BALANCE
                    db.query(
                        "UPDATE users SET balance = balance + ? WHERE id=?",
                        [bonus.amount, userId]
                    );

                    // LOG CLAIM
                    db.query(
                        "INSERT INTO bonus_claims (user_id, code, amount) VALUES (?, ?, ?)",
                        [userId, code, bonus.amount]
                    );

                    // INCREASE COUNT
                    db.query(
                        "UPDATE bonus_codes SET used_count = used_count + 1 WHERE code=?",
                        [code]
                    );

                    return res.json({
                        message: `🎉 Congratulations! You received ₦${bonus.amount}`
                    });
                }
            );
        }
    );
});
//check active investment for bonus box
app.get("/user/has-active-investment/:phone", (req, res) => {

    db.query(
        `SELECT id FROM investments 
         WHERE phone=? AND status='active'`,
        [req.params.phone],
        (err, result) => {

            if (err) {
                return res.status(500).json({ error: "DB error" });
            }

            return res.json({
                active: result && result.length > 0
            });
        }
    );
});

// ADMIN ALL USERS
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

        return res.json(result || []);
    });
});

// ADMIN TOGGLE USER STATUS
app.post("/admin/toggle-user-status", (req, res) => {

    const { id, status } = req.body;

    if (!id || !status) {
        return res.status(400).json({ error: "Missing data" });
    }

    db.query(
        "UPDATE users SET status=? WHERE id=?",
        [status, id],
        (err) => {

            if (err) {
                return res.status(500).json({ error: "DB error" });
            }

            return res.json({
                message: "User status updated"
            });
        }
    );
});

// START SERVER
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on ${PORT}`);
});