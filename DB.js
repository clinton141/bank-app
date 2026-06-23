const mysql = require("mysql2");
require("dotenv").config();

const pool = mysql.createPool({
    uri:process.env.DATABASE_URL,

    ssl: {
        rejectUnauthorized: false
    },
    connectionlimit:5,
    waitforconnections: true,
    queuelimit:0
});

module.exports = db;