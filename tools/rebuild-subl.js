'use strict';
/*
 * lookup.subl 을 sub 테이블에서 다시 만든다.
 *
 *   node tools/rebuild-subl.js [mysql|sqlite]              미리보기 (아무것도 안 쓴다)
 *   node tools/rebuild-subl.js --apply [mysql|sqlite]      실제로 쓴다
 *   node tools/rebuild-subl.js --apply --log <경로> ...    바뀐 내용을 파일로 남긴다
 *
 * ── 왜 ──────────────────────────────────────────────────────────────────
 * sgn_action 은 sub 테이블이 아니라 부모의 subl 배열을 훑어 알림을 보낸다.
 * 둘이 크게 어긋나 있다 (배포 실측, CIN 을 뺀 lookup 34,313행 전수):
 *
 *     subl 항목 14,028   vs   sub 행 3,452
 *     유령 (subl 에만 있고 sub 행이 없다)   9,475건  -> 지금도 발송 중
 *     중복 (같은 subl 에 같은 ri)          1,481묶음
 *     낡은 nu (subl 과 sub 이 다르다)         194건
 *     침묵 (sub 은 있는데 어느 subl 에도 없다)  21건
 *
 * 쓰기 경로는 이미 고쳤다. 새로 어긋나지는 않는다. 이 도구는 **이미 쌓인
 * 것**을 정리한다.
 *
 * ── 무엇이 바뀌나 ───────────────────────────────────────────────────────
 * 부모마다 subl 을 "그 부모를 pi 로 갖는 sub 행들" 로 다시 만든다.
 *   - 유령은 사라진다 (sub 행이 없으므로 다시 만들 때 안 들어간다)
 *   - 중복은 사라진다 (sub.ri 가 유일하므로 항목도 하나씩)
 *   - 낡은 nu 는 sub 행의 값으로 맞춰진다
 *   - 침묵은 깨어난다 (sub 행이 있으므로 들어간다)
 *   - 6필드로 줄어든다 (mobius/subl.js 의 pack)
 *
 * **배포 동작이 눈에 띄게 바뀐다.** 유령이 보내던 알림이 멈추고, 잠자던
 * 구독이 깨어난다. 되돌리려면 tools/snapshot-subl.js 로 떠 둔 파일이 있어야
 * 한다 — 유령의 라우팅 정보는 그 파일 말고는 어디에도 없다.
 *
 * ── sub 테이블의 값 모양 ────────────────────────────────────────────────
 * insert_sub 는 nu 와 enc 를 JSON.stringify 해서 **문자열**로 넣는다.
 * subl 항목은 배열·객체여야 한다. 여기서 반드시 풀어야 한다 — 문자열인 채
 * 심으면 발송기가 그 항목을 건너뛴다(mobius/subl.js 의 read 가 걸러낸다).
 * 예전에는 그 자리에서 워커가 죽었다.
 *
 * ── 순서 ────────────────────────────────────────────────────────────────
 * 부모 안에서는 sub 의 생성 시각(lookup.ct), 같으면 ri 순으로 넣는다.
 * 원래의 삽입 순서를 근사하고, 몇 번을 돌려도 같은 결과가 나온다.
 */

var fs   = require('fs');
var path = require('path');

var subl_entry = require(path.join(__dirname, '..', 'mobius', 'subl'));

// sub 이 붙을 수 있는 타입만. CIN(ty=4)은 자식을 못 갖는다.
var PARENT_TYPES = ['1', '2', '3', '5', '9', '14', '16', '23'];

// 한 번에 쓰는 부모 수. 각 UPDATE 는 PK 접근이라 싸지만, 한 번에 다 던지면
// 커넥션 하나에 수천 문장이 줄을 선다.
var WRITE_BATCH = 50;

var backendArg = null;
var argv = process.argv.slice(2);

function usage() {
    console.log('사용법:');
    console.log('  node tools/rebuild-subl.js [mysql|sqlite]            미리보기');
    console.log('  node tools/rebuild-subl.js --apply [mysql|sqlite]    실제로 쓴다');
    console.log('  ... --log <경로>                                     바뀐 내용을 남긴다');
    console.log('  ... --force                                          읽을 수 없는 sub 행이 있어도 진행');
    console.log('');
    console.log('미리보기가 기본이다. --apply 없이는 아무것도 쓰지 않는다.');
    console.log('nu 나 enc 를 읽을 수 없는 sub 행이 있으면 --apply 를 막는다 —');
    console.log('그대로 두면 그 구독이 목록에 안 들어가 영영 알림을 못 받는다.');
    process.exit(2);
}

function connect(cb) {
    var conf = {};
    try { conf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'conf.json'), 'utf8')); }
    catch (e) { /* 없으면 기본값 */ }

    // 선택자는 db 키 하나다. 여기 global.usesqlite 불리언과 conf.usesqlite
    // 번역이 있었는데 둘 다 지웠다 — 불리언으로는 백엔드를 둘까지밖에 못 말한다.
    global.usedb = backendArg || conf.db || 'mysql';

    var db = require(path.join(__dirname, '..', 'mobius', 'db'));
    // 파사드가 실제로 고른 것을 찍는다. 여기서 따로 계산하면 파사드가 모르는
    // 이름을 기본값으로 되돌렸을 때(오타) 화면과 실제가 갈린다.
    console.log('백엔드: ' + db.backendName());
    // **applyConf 가 connect 보다 먼저다.** 좌표(비밀번호 포함)는 어댑터가
    // conf 에서 직접 읽으므로, 이 줄이 없으면 어댑터의 conf 가 {} 로 남아
    // 빈 비밀번호로 붙는다. test/db-conf-wiring.test.js 가 이 순서를 지킨다.
    db.applyConf(conf);
    db.connect(function (rsc) {
        if (rsc !== '1') { console.error('DB 연결 실패: ' + rsc); process.exit(1); }
        db.getConnection(function (code, conn) {
            if (code !== '200') { console.error('커넥션 획득 실패: ' + code); process.exit(1); }
            cb(db, conn);
        });
    });
}

// sub 행 하나를 subl 항목으로. nu / enc 는 반드시 푼다.
//
// 못 푸는 행은 **조용히 빈 값으로 바꾸지 않는다.** 그러면 그 구독은 저장은
// 되는데 보낼 주소가 없어 영영 알림이 안 간다 — 침묵을 고치러 와서 새 침묵을
// 만드는 꼴이다. 여기 걸리는 것이 있으면 세어서 보고하고, --apply 를 막는다.
var bad = [];

function entryOf(row) {
    function loose(v, what) {
        if (v === null || v === undefined) { return undefined; }
        if (typeof v !== 'string') { return v; }
        try { return JSON.parse(v); }
        catch (e) { bad.push({ ri: row.ri, what: what, raw: String(v).slice(0, 80) }); return undefined; }
    }
    var nu  = loose(row.nu,  'nu');
    var enc = loose(row.enc, 'enc');

    if (!Array.isArray(nu)) {
        bad.push({ ri: row.ri, what: 'nu', raw: '배열이 아니다: ' + JSON.stringify(nu).slice(0, 60) });
        return null;
    }
    if (!enc || typeof enc !== 'object' || !Array.isArray(enc.net)) {
        bad.push({ ri: row.ri, what: 'enc', raw: 'net 배열이 없다: ' + JSON.stringify(enc).slice(0, 60) });
        return null;
    }

    return subl_entry.pack({
        ri: row.ri, nu: nu, enc: enc,
        nct: row.nct, nec: row.nec, cr: row.cr
    });
}

function num(n) { return Number(n).toLocaleString(); }

function main() {
    if (argv.indexOf('--help') >= 0 || argv.indexOf('-h') >= 0) { usage(); }
    if (argv.indexOf('sqlite') >= 0) { backendArg = 'sqlite'; }
    else if (argv.indexOf('mysql') >= 0) { backendArg = 'mysql'; }
    var apply = argv.indexOf('--apply') >= 0;
    var li = argv.indexOf('--log');
    var logPath = (li >= 0 && argv[li + 1]) ? argv[li + 1] : null;

    connect(function (db, conn) {
        function fail(msg, res) {
            console.error(msg + ': ' + ((res && (res.sqlMessage || res.message)) || res));
            try { db.release(conn); } catch (e) { /* 이미 닫혔으면 그만 */ }
            process.exit(1);
        }

        // 1) sub 행 전부. 3,452행이라 통째로 읽어도 싸다.
        //    lookup 을 붙여 생성 시각으로 정렬한다 (ri 는 PK 접근).
        db.run(db.k('sub as s')
                 .select('s.ri as ri', 's.pi as pi', 's.nu as nu', 's.enc as enc',
                         's.nct as nct', 's.nec as nec', 's.cr as cr', 'l.ct as ct')
                 .leftJoin('lookup as l', 'l.ri', 's.ri'),
        conn, function (e1, subs) {
            if (e1) { return fail('sub 조회 실패', subs); }
            subs = subs || [];

            var byParent = {};
            subs.forEach(function (r) { (byParent[r.pi] = byParent[r.pi] || []).push(r); });
            Object.keys(byParent).forEach(function (pi) {
                byParent[pi].sort(function (a, b) {
                    var x = String(a.ct || ''), y = String(b.ct || '');
                    if (x !== y) { return x < y ? -1 : 1; }
                    return String(a.ri) < String(b.ri) ? -1 : 1;
                });
            });

            console.log('sub 행 ' + num(subs.length) +
                        ', 서로 다른 부모 ' + num(Object.keys(byParent).length));

            // 2) subl 이 비어 있지 않은 부모 전부. 여기에 유령만 있는 부모가 들어온다.
            db.run(db.k('lookup')
                     .select('ri', 'subl')
                     .whereIn('ty', PARENT_TYPES)
                     .whereNotNull('subl')
                     .whereNot({ subl: '' })
                     .whereNot({ subl: '[]' }),
            conn, function (e2, rows) {
                if (e2) { return fail('lookup 조회 실패', rows); }
                rows = rows || [];
                console.log('subl 이 안 빈 부모 ' + num(rows.length));
                console.log('');

                var current = {};
                rows.forEach(function (r) { current[r.ri] = String(r.subl); });

                // 손볼 부모 = (subl 이 안 빈 부모) ∪ (sub 이 달린 부모)
                var all = {};
                Object.keys(current).forEach(function (ri) { all[ri] = true; });
                Object.keys(byParent).forEach(function (ri) { all[ri] = true; });

                var plan = [], stat = {
                    unchanged: 0, emptied: 0, changed: 0,
                    ghostsDropped: 0, dupsDropped: 0, silentsAdded: 0, nuFixed: 0,
                    bytesBefore: 0, bytesAfter: 0, parentMissing: 0
                };

                Object.keys(all).sort().forEach(function (ri) {
                    var wantRows = byParent[ri] || [];
                    var want = wantRows.map(entryOf).filter(Boolean);
                    var nextStr = JSON.stringify(want);
                    var curStr  = current[ri] === undefined ? '[]' : current[ri];

                    stat.bytesBefore += Buffer.byteLength(curStr);
                    stat.bytesAfter  += Buffer.byteLength(nextStr);

                    if (curStr === nextStr) { stat.unchanged++; return; }

                    // 무엇이 달라지는지 센다
                    var cur = [];
                    try { var p = JSON.parse(curStr); if (Array.isArray(p)) { cur = p; } } catch (e) {}

                    var real = {}; want.forEach(function (x) { real[x.ri] = x; });
                    var seen = {};
                    cur.forEach(function (x) {
                        var xri = x && x.ri;
                        if (!real[xri]) { stat.ghostsDropped++; return; }
                        if (seen[xri]) { stat.dupsDropped++; return; }
                        seen[xri] = true;
                        if (JSON.stringify(x.nu) !== JSON.stringify(real[xri].nu)) { stat.nuFixed++; }
                    });
                    want.forEach(function (x) { if (!seen[x.ri]) { stat.silentsAdded++; } });

                    if (want.length === 0) { stat.emptied++; } else { stat.changed++; }
                    plan.push({ ri: ri, before: curStr, after: nextStr,
                                nBefore: cur.length, nAfter: want.length });
                });

                // sub 은 있는데 부모 lookup 행이 없는 경우 (있으면 안 된다)
                Object.keys(byParent).forEach(function (ri) {
                    if (current[ri] === undefined && !all[ri]) { stat.parentMissing++; }
                });

                console.log('=== 바뀔 내용 ===');
                console.log('  그대로 두는 부모   ' + num(stat.unchanged));
                console.log('  목록이 비는 부모   ' + num(stat.emptied) + '   (유령만 있던 곳)');
                console.log('  목록이 바뀌는 부모 ' + num(stat.changed));
                console.log('');
                console.log('  없어지는 유령      ' + num(stat.ghostsDropped));
                console.log('  없어지는 중복      ' + num(stat.dupsDropped));
                console.log('  고쳐지는 낡은 nu   ' + num(stat.nuFixed));
                console.log('  깨어나는 침묵      ' + num(stat.silentsAdded));
                console.log('');
                console.log('  subl 크기          ' + (stat.bytesBefore / 1048576).toFixed(2) +
                            ' MB -> ' + (stat.bytesAfter / 1048576).toFixed(2) + ' MB');
                if (stat.parentMissing) {
                    console.log('  부모 lookup 행 없는 sub: ' + stat.parentMissing + '건 (이상하다 — 확인할 것)');
                }
                console.log('');

                // sub 행인데 항목으로 못 만든 것. 그대로 두면 그 구독은 목록에
                // 안 들어가 영영 알림을 못 받는다 — 새 침묵이다.
                if (bad.length) {
                    console.log('=== 읽을 수 없는 sub 행 ' + num(bad.length) + '건 ===');
                    bad.slice(0, 8).forEach(function (b) {
                        console.log('  ' + b.ri + '  [' + b.what + ']  ' + b.raw);
                    });
                    if (bad.length > 8) { console.log('  ... 외 ' + num(bad.length - 8) + '건'); }
                    console.log('');
                    console.log('  이 구독들은 다시 만든 목록에 **안 들어간다**. 그대로 적용하면');
                    console.log('  영영 알림을 못 받는다. 먼저 이 행들을 고칠 것.');
                    console.log('');
                    if (apply) {
                        console.log('적용하지 않았다. --force 를 붙이면 이 행들을 빼고 진행한다.');
                        if (argv.indexOf('--force') < 0) {
                            try { db.release(conn); } catch (e) {}
                            return process.exit(1);
                        }
                        console.log('(--force 가 있으므로 진행한다)');
                        console.log('');
                    }
                }

                if (plan.length === 0) {
                    console.log('바꿀 것이 없다.');
                    try { db.release(conn); } catch (e) {}
                    return process.exit(0);
                }

                if (logPath) {
                    var lines = plan.map(function (p) {
                        return JSON.stringify({ ri: p.ri, before: p.before, after: p.after });
                    });
                    fs.writeFileSync(logPath, lines.join('\n') + '\n');
                    console.log('바뀔 내용을 남겼다: ' + logPath + ' (' + num(plan.length) + '행)');
                    console.log('');
                }

                if (!apply) {
                    console.log('미리보기다. 아무것도 쓰지 않았다.');
                    console.log('실제로 쓰려면 --apply 를 붙인다.');
                    console.log('');
                    console.log('되돌리려면 tools/snapshot-subl.js 로 떠 둔 파일이 필요하다 —');
                    console.log('유령의 라우팅 정보는 그 파일 말고는 어디에도 없다.');
                    try { db.release(conn); } catch (e) {}
                    return process.exit(0);
                }

                console.log('=== 적용 ===');
                var i = 0, wrote = 0;
                function writeNext() {
                    if (i >= plan.length) {
                        console.log('    ' + num(wrote) + '개 부모의 subl 을 다시 썼다');
                        console.log('');
                        console.log('확인: node tools/snapshot-subl.js --verify <스냅샷> 으로');
                        console.log('      뜬 시점과 얼마나 달라졌는지 볼 수 있다.');
                        try { db.release(conn); } catch (e) {}
                        return process.exit(0);
                    }
                    var chunk = plan.slice(i, i + WRITE_BATCH);
                    i += chunk.length;
                    var left = chunk.length;
                    var failed = null;
                    chunk.forEach(function (p) {
                        db.run(db.k('lookup').update({ subl: p.after }).where({ ri: p.ri }),
                        conn, function (e3, res) {
                            if (e3 && !failed) { failed = res; }
                            else if (!e3) { wrote++; }
                            if (--left === 0) {
                                if (failed) { return fail('subl 갱신 실패', failed); }
                                if (i % 1000 < WRITE_BATCH) {
                                    console.log('    ' + num(wrote) + ' / ' + num(plan.length));
                                }
                                writeNext();
                            }
                        });
                    });
                }
                writeNext();
            });
        });
    });
}

if (require.main === module) { main(); }
