var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database('./mobius.db');

db.serialize(function () {
    console.log('--- Applying ACP Schema Changes ---');

    // 1. Add acpl column to lookup
    // SQLite doesn't support "IF NOT EXISTS" for ADD COLUMN generally, 
    // so we wrap in try-catch logic or just run it and ignore "duplicate column" error.
    db.run("ALTER TABLE lookup ADD COLUMN acpl TEXT", function (err) {
        if (err && err.message.indexOf('duplicate column') !== -1) {
            console.log('Column acpl already exists.');
        } else if (err) {
            console.error('Error adding acpl column:', err.message);
        } else {
            console.log('Column acpl added to lookup.');
        }
    });

    // 2. Create acp table
    var create_acp_sql = `
        CREATE TABLE IF NOT EXISTS acp (
          ri TEXT PRIMARY KEY,
          pv TEXT NOT NULL,
          pvs TEXT NOT NULL,
          FOREIGN KEY (ri) REFERENCES lookup(ri) ON DELETE CASCADE
        )
    `;
    db.run(create_acp_sql, function (err) {
        if (err) console.error('Error creating acp table:', err);
        else console.log('Table acp ensured.');
    });
});

db.close();
