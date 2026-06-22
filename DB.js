const mysql = require("mysql2");
require("dotenv").config();

const db = mysql.createPool({
    uri: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

db.getConnection((err, connection) => {
    if (err) {
        console.log("❌ DB Connection Error:", err);
    } else {
        console.log("✅ TiDB Connected Successfully");
        connection.release();
    }
});

module.exports = db;
