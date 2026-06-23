const mysql = require("mysql2");

const db = mysql.createPool(process.env.DATABASE_URL);

db.getConnection((err, connection) => {
    if (err) {
        console.log("❌ DB Connection Error:", err.message);
    } else {
        console.log("✅ TiDB Connected Successfully");
        connection.release();
    }
});

module.exports = db;