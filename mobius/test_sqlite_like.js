var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database(':memory:');

db.serialize(function () {
    db.run("CREATE TABLE t (lbl TEXT)");

    var stmt = db.prepare("INSERT INTO t VALUES (?)");
    stmt.run('["ss"]');
    stmt.run('["aa","ss"]');
    stmt.run('["aa", "ss"]');
    stmt.run('["aass"]');
    stmt.run('["tag"]');
    stmt.finalize();

    console.log("--- Testing LIKE '[\"%ss%\"]' ---");
    db.all("SELECT lbl FROM t WHERE lbl LIKE '[\"%ss%\"]'", function (err, rows) {
        if (err) console.error(err);
        else {
            console.log("Matches:", rows);
        }

        console.log("\n--- Testing LIKE '%\"ss\"%' ---");
        db.all("SELECT lbl FROM t WHERE lbl LIKE '%\"ss\"%'", function (err, rows) {
            if (err) console.error(err);
            else {
                console.log("Matches:", rows);
            }
        });
    });
});
