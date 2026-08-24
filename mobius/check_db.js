
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./mobius.db', (err) => {
    if (err) {
        console.error(err.message);
    } else {
        console.log('Connected to the mobius database.');
        db.all("SELECT * FROM lookup", [], (err, rows) => {
            if (err) {
                console.error("Error selecting from lookup:", err);
            } else {
                console.log("LOOKUP TABLE:", rows);
            }
            db.all("SELECT * FROM cb", [], (err, rows) => {
                if (err) {
                    console.error("Error selecting from cb:", err);
                } else {
                    console.log("CB TABLE:", rows);
                }
            });
        });
    }
});
