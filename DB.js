const mysql = require("mysql2");
require("dotenv").config();

const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 4000),

    ssl: {
        rejectUnauthorized: false
    },

    connectTimeout: 10000
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