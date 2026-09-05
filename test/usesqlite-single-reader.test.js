'use strict';
// 이 작업의 완료 기준을 실행 가능한 형태로 못박는다.
//
//   **global.usesqlite 를 읽는 곳이 mobius/db/index.js 한 곳뿐일 것.**
//
// 코어가 어느 백엔드인지 알면, 백엔드를 바꿀 때마다 코어를 고쳐야 하고
// 한쪽만 고치면 두 경로가 조용히 갈라진다. 실제로 그렇게 갈라진 것을
// 여럿 고쳤다(discovery 재귀 CTE, cin.cs 의 타입, delete_oldest 의 알고리즘).
//
// 허용 목록은 **줄어들기만 해야 한다.** 새 파일이 늘면 실패하고, 목록에
// 적힌 파일에서 리더가 사라지면 그것도 실패한다(목록을 같이 지우라는 뜻).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

// ── 허용 목록이 여기 있었다. 비었고, 그래서 지웠다 ──────────────────────
//
// 이 파일은 "global.usesqlite 를 읽는 곳이 파사드 하나뿐일 것" 을 기준으로
// 출발했고, 목록이 줄어드는 것이 진척이었다. 그 진척의 마지막 단계에서
// 파사드의 폴백까지 지워 **0 이 되었다.**
//
// 어떻게 줄었나:
//
//   넷   커넥션 원천이 파사드로 옮겨가며 한꺼번에 — db_action(기동),
//        cnt_man·resource·sgn(취득). 넷 다 "내가 sqlite 인가" 를 물었지만
//        진짜 질문은 "커넥션을 누가 주나" 하나였다.
//   둘   cnt_man 의 카운터 갱신과 sql_action 의 delete_oldest. "백엔드마다
//        동작이 달라야 한다" 는 이유로 남아 있었는데, 그 차이는 백엔드가
//        아니라 **정리 주체가 여럿이라는 것**에서 나왔다. 워커 25개가 동시에
//        정리하니 행 잠금이 필요했고, 잠금 없는 백엔드는 그 알고리즘을 못 썼다.
//        정리를 마스터 하나로 옮기자 갈래가 사라졌다.
//   셋   007 마이그레이션과 tools 두 개. 러너와 진입점이 이미 이름을 아는데도
//        전역을 직접 읽고 있었다.
//   하나 파사드 자신의 폴백. 세우는 곳이 다 사라지자 죽은 갈래가 되었다.
//
// 이제 기준은 "하나 이하" 가 아니라 **0** 이다. 아래 테스트가 그것을 못박는다.

// ── 백엔드 이름으로 갈라지는 자리 ───────────────────────────────────────
//
// usesqlite 하나만 보는 것으로는 부족하다. 그 술어를 통과하면서 코어가
// 백엔드를 아는 방법이 셋 더 있다.
//
//   global.usedb 를 직접 읽는다
//   'mysql' / 'sqlite' 같은 이름 리터럴과 견준다
//   global.use_sqlite_* 처럼 백엔드 이름이 붙은 전역을 쓴다
//
// 실제로 이 구멍으로 넷이 들어왔다(헌장 7f~7i). 그중 db_bootstrap.js 의
// `ctx.backend !== 'mysql'` 은 **이 테스트가 초록불인 채로** 들어왔다 —
// 검사가 없는 것보다 나쁘다. 초록불이 "코어가 백엔드를 모른다" 의 근거로
// 쓰이는데 아무것도 못 막고 있었기 때문이다.
//
// 아래는 **아직 안 고친 자리를 그대로 적어 둔 것**이다. 목록에 없는 자리가
// 생기면 즉시 실패하고, 목록의 자리가 사라져도 실패한다(목록을 같이 지우라는 뜻).
// 이 저장소가 SQLite 파리티 진척을 세는 방식과 같다 — 숫자가 줄면 알려준다.
const KNOWN_NAME_SITES = {
    // mobius.js 에 있던 두 자리가 mobius/conf_load.js 로 옮겨 왔다(2026-09-05).
    //   36  파싱이 깨졌을 때 쓰는 DEFAULT_CONF 의 db 기본값
    //   53  백엔드 선택자를 세우는 유일한 곳(select_backend). 원천이라 이름이 나오는 것이 맞다
    //   54  그 값을 global.usedb 에 심는 줄
    // **conf_load.js 의 머리말을 늘리면 셋 다 밀린다** — 그 파일은 설명을 아래쪽에 더한다.
    'mobius/conf_load.js': [36, 53, 54],

    // 설정 표의 기본 백엔드. mobius/db/index.js 의 DEFAULT_BACKEND 와 같은 값을
    // 두 번째로 적은 자리다(헌장 7g).
    // **줄 번호는 그 파일을 손댈 때마다 밀린다.** 이 시험이 실패하면 대개
    // 결함이 아니라 이 숫자다 — 실패 메시지가 새 줄 번호를 알려 주므로
    // 그것으로 바꾸면 된다.
    'mobius/conf_schema.js': [175]
};

// 백엔드 이름이 붙은 전역(global.use_sqlite_* 등)을 코어가 직접 쓰는 자리.
//
// **비었다. 헌장 7g 가 끝났다.**
//
// mobius.js 가 global.use_sqlite_journal_mode / _synchronous / _busy_timeout_ms
// 세 줄을 갖고 있었고, mobius/conf_schema.js 도 같은 세 키를 표에 들고 있었다.
// 그래서 튜닝 값을 갖는 세 번째 백엔드를 붙이려면 코어 두 파일을 열어야 했다 —
// "mobius/db/<이름>.js 파일 하나를 두면 붙는다" 가 거기서 깨졌다.
//
// 지금은 어댑터가 confSchema 로 자기 키를 내보내고 applyConf 로 직접 읽는다.
// 코어는 db.applyConf(conf) 한 줄만 알고 키 이름은 하나도 모른다.
//
// 부수 효과 하나가 함께 사라졌다 — 표에 있으면 화면에 뜨므로, MySQL 로 도는
// 배포의 관리 콘솔이 SQLite 저널 모드·동기화·잠금 대기 세 칸을 보여주고 있었다.
const KNOWN_BACKEND_GLOBALS = {};

const NAME_LITERAL = /(['"])(mysql|sqlite|postgres|mariadb)\1/i;
const USEDB = /global\.usedb\b/;
const BACKEND_GLOBAL = /global\.use_(sqlite|mysql|postgres)_/;

// migrations 의 `backends: ['mysql']` 은 결함이 아니다. 그 필드는 "이 마이그레이션이
// 어느 백엔드용인가" 를 **선언**하는 자리라 이름이 곧 값이다. 러너가 그것을 읽어
// 거른다. 다른 방법이 없으므로 술어에서 뺀다.
const BACKENDS_DECL = /^\s*backends\s*:\s*\[/;

function nameSites(rel, re) {
    // 어댑터와 파사드는 백엔드를 알아도 된다 — 거기가 아는 자리다.
    if (rel.startsWith('mobius/db/')) { return []; }

    // 마이그레이션이 **이름**을 아는 것도 정상이다. backends: ['mysql'] 이
    // 이미 이름으로 선언하고, 백엔드마다 다른 DDL 을 내는 것이 그 파일의 일이다.
    // 중요한 것은 그 이름을 **어디서 얻느냐**다 — 러너가 주는 ctx.backend 는
    // 파사드가 고른 값이라 괜찮고, 전역을 직접 읽으면 안 된다.
    // 그래서 이름 리터럴은 면제하되 아래 USEDB 검사는 그대로 받는다.
    const migration = rel.startsWith('migrations/');
    if (migration && re === NAME_LITERAL) { return []; }

    const out = [];
    fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/).forEach((l, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(l)) { return; }   // 주석은 세지 않는다
        if (BACKENDS_DECL.test(l)) { return; }
        if (re.test(l)) { out.push(i + 1); }
    });
    return out;
}

// mobius.js 는 usesqlite 를 **세팅**하는 곳이라 대상이 아니다.
// tools/ 는 운영 코드가 아니다(백엔드를 인자로 고른다).
//
// migrations/ 는 범위에 넣는다. 예전에는 뺐는데, 그래서 007 이 global.usesqlite
// 를 직접 읽는 것을 이 테스트가 못 봤다 — 헌장이 "단일리더 테스트 범위 밖이라
// 안 걸린다" 고 따로 적어 두어야 했을 정도다. 감시가 있는데 안 보는 것보다
// 범위에 넣고 아는 예외로 두는 편이 낫다.
// **디렉터리를 훑지 않고 git 이 아는 파일만 본다.**
//
// 예전에는 readdirSync 로 훑었다. 그랬더니 배포 서버에서 이 테스트가
// 실패했다 — 거기 굴러다니던 dbq_tmp.js(추적 안 되는 임시 파일)를 코어로
// 세었기 때문이다. 저장소에 없는 파일이 감시를 깨면, "배포에서 테스트를
// 돌려 본다" 가 성립하지 않는다.
//
// 범위는 그대로다. 루트의 진입점들(프록시 pxy_* 와 wdt 포함 — 지금은
// 리더가 없지만 빼면 나중에 새 리더가 들어와도 안 걸린다), mobius/,
// migrations/. mobius.js 는 usesqlite 를 **세팅**하던 곳이라 대상이 아니고,
// tools/ 는 운영 코드가 아니다(백엔드를 인자로 고른다).
//
// migrations/ 를 넣는 이유: 예전에는 뺐는데, 그래서 007 이 global.usesqlite
// 를 직접 읽는 것을 이 테스트가 못 봤다. 감시가 있는데 안 보는 것보다
// 범위에 넣고 아는 예외로 두는 편이 낫다.
function sourceFiles() {
    const tracked = execFileSync('git', ['ls-files', '*.js'],
        { cwd: ROOT, encoding: 'utf8' })
        .split('\n').map((s) => s.trim()).filter(Boolean);

    const out = tracked.filter(function (f) {
        if (f === 'mobius.js') { return false; }
        if (f.indexOf('/') < 0) { return true; }                 // 루트 진입점
        return f.indexOf('mobius/') === 0 || f.indexOf('migrations/') === 0;
    });

    // git 이 아무것도 안 돌려주면 검사가 통째로 헛돈다.
    assert.ok(out.length > 20,
        '코어 파일을 ' + out.length + '개만 찾았다 — git ls-files 가 안 먹는다');
    return out;
}

// 주석 줄은 세지 않는다. 코드가 읽는 것만 리더다.
function readsUsesqlite(rel) {
    const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
    return lines.some((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && /global\.usesqlite/.test(l));
}

test('global.usesqlite 전역은 아무도 읽지 않는다 — 목표 달성', function () {
    // **목표가 달성됐다.** 이 파일의 원래 기준은 "리더가 파사드 한 곳뿐일 것"
    // 이었는데, 이제 한 곳도 없다 — 파사드의 폴백까지 지웠다.
    //
    // 기준을 "하나 이하" 로 두면 되살아나는 것을 못 잡는다. 0 으로 못박는다.
    const actual = sourceFiles().filter(readsUsesqlite).sort();

    assert.deepStrictEqual(actual, [],
        'global.usesqlite 전역이 되살아났다: ' + actual.join(', ') + '\n' +
        'boolean 은 백엔드를 둘까지만 말할 수 있다 — 셋째가 붙으면 무용지물이\n' +
        '아니라 틀린 답을 낸다(usesqlite=false 가 mysql 을 뜻하게 되어 있었다).\n' +
        '백엔드를 물어야 하면 global.usedb 를 세우거나 db.backendName() 을 받아라.');
});

test('전역을 세우는 곳도 없다 — 읽는 이가 없으면 세우는 이도 없어야 한다', function () {
    // 세우기만 하고 아무도 안 읽으면 죽은 값이다. 그런데 죽은 값이 남아 있으면
    // 다음 사람이 "이걸로 백엔드를 물으면 되는구나" 로 읽는다. 실제로 007 과
    // tools 두 개가 그 길로 갔다.
    const writers = [];
    // tools/rebuild-subl.js · snapshot-subl.js 가 여기 있었다 — subl 사본과 함께 지웠다(2026-09-05).
    const scan = sourceFiles().concat(['mobius.js', 'tools/migrate.js']);
    for (const rel of scan) {
        fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/).forEach((l, i) => {
            if (/^\s*(\/\/|\*|\/\*)/.test(l)) { return; }
            if (/global\.usesqlite\s*=/.test(l)) { writers.push(rel + ':' + (i + 1)); }
        });
    }
    assert.deepStrictEqual(writers, [],
        'global.usesqlite 를 세우는 곳이 있다: ' + writers.join(', '));
});

test('conf.json 의 usesqlite 키도 아무도 읽지 않는다', function () {
    // 한 회차 전에는 이 자리에 "경계에서 한 번만 번역된다" 가 있었다.
    // 옛 conf.json 호환이라는 이유로 진입점 넷에 번역을 남겨 뒀었다.
    //
    // 그것도 지웠다. **번역을 남기면 설정 키가 둘인 상태가 끝나지 않기**
    // 때문이다 — 옛 이름이 계속 동작하는 한, 새로 쓰는 코드가 그것을 보고
    // 따라 쓴다. 실제로 그렇게 007 과 tools 두 개가 옛 이름을 붙잡고 있었다.
    //
    // db 키가 그 자리를 완전히 대신한다. 옛 키가 남은 conf.json 은 설정 표에
    // 없는 키라 "모르는 키" 로 걸린다 — 조용히 넘어가지 않는다.
    const bad = [];
    // tools/rebuild-subl.js · snapshot-subl.js 가 여기 있었다 — subl 사본과 함께 지웠다(2026-09-05).
    const scan = sourceFiles().concat(['mobius.js', 'tools/migrate.js']);

    for (const rel of scan) {
        fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/).forEach((l, i) => {
            if (/^\s*(\/\/|\*|\/\*)/.test(l)) { return; }
            if (/conf\.usesqlite/.test(l)) { bad.push(rel + ':' + (i + 1)); }
        });
    }

    assert.deepStrictEqual(bad, [],
        'conf.usesqlite 를 읽는 코드가 되살아났다: ' + bad.join(', ') + '\n' +
        '선택자는 conf.json 의 db 키 하나다.');
});

test('백엔드 이름으로 갈라지는 자리는 알려진 것뿐이다', function () {
    // mobius.js 도 본다. 예전에는 "usesqlite 를 세팅하는 곳" 이라는 이유로
    // 소스 목록에서 통째로 뺐는데, 그 면제가 use_sqlite_* 세 줄까지 덮어
    // 헌장 7g 가 검사 밖에 있었다. 면제는 술어별로 좁게 준다.
    const scan = sourceFiles().concat(['mobius.js']);
    const bad = [];

    for (const rel of scan) {
        const known = KNOWN_NAME_SITES[rel] || [];
        const hits = nameSites(rel, NAME_LITERAL).concat(nameSites(rel, USEDB))
            .filter((n, i, a) => a.indexOf(n) === i).sort((a, b) => a - b);

        for (const line of hits) {
            if (known.indexOf(line) < 0) { bad.push(rel + ':' + line); }
        }
        for (const line of known) {
            if (hits.indexOf(line) < 0) {
                bad.push(rel + ':' + line + ' (목록이 낡았다 — 고쳤으면 목록에서 지워라)');
            }
        }
    }

    assert.deepStrictEqual(bad, [],
        '코어가 백엔드 이름으로 갈라진다. 동작을 가르는 판단이면 db.can() 으로 묻고,\n' +
        '이름 자체가 데이터인 자리면 db.backendName() 으로 파사드가 고른 것을 받아라.\n' +
        '아직 고칠 수 없는 자리면 KNOWN_NAME_SITES 에 이유와 함께 적어라:\n  ' +
        bad.join('\n  '));
});

test('백엔드 이름이 붙은 전역을 쓰는 자리도 알려진 것뿐이다', function () {
    const scan = sourceFiles().concat(['mobius.js']);
    const bad = [];

    for (const rel of scan) {
        const known = KNOWN_BACKEND_GLOBALS[rel] || [];
        const hits = nameSites(rel, BACKEND_GLOBAL);

        for (const line of hits) {
            if (known.indexOf(line) < 0) { bad.push(rel + ':' + line); }
        }
        for (const line of known) {
            if (hits.indexOf(line) < 0) {
                bad.push(rel + ':' + line + ' (목록이 낡았다 — 고쳤으면 목록에서 지워라)');
            }
        }
    }

    assert.deepStrictEqual(bad, [],
        '코어가 백엔드 이름이 붙은 전역을 쓴다. 튜닝 값은 어댑터가 갖고,\n' +
        '설정 표는 어댑터가 내보낸 항목을 모으는 쪽이 맞다:\n  ' + bad.join('\n  '));
});

test('코어는 백엔드 능력을 묻지 않는다', function () {
    // **이 검사가 이 작업의 종착점이다.**
    //
    // 이름 비교를 없애는 것으로는 부족했다. `can('serverTuning')` 으로 바꾼 뒤에도
    // db_bootstrap 은 그 뒤에서 `SET PERSIST` 를 직접 만들고 있었다 — 능력이 참인
    // 두 번째 백엔드가 붙으면 MySQL 문장이 그쪽으로 날아가는 구조였다.
    // 불리언은 "할 수 있다" 만 말하고 "어떻게" 는 말하지 못하기 때문이다.
    //
    // 그래서 기준을 올린다. 코어는 이름도 능력도 묻지 않는다. 파사드에
    // "그 일을 해 주는 함수" 가 있고 어댑터가 자기 방식으로 구현한다.
    const bad = [];
    for (const rel of sourceFiles()) {
        if (rel.startsWith('mobius/db/')) { continue; }   // 파사드·어댑터는 알아도 된다
        fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/).forEach((l, i) => {
            if (/^\s*(\/\/|\*|\/\*)/.test(l)) { return; }
            if (/\.can\(\s*['"]/.test(l)) { bad.push(rel + ':' + (i + 1)); }
        });
    }

    assert.deepStrictEqual(bad, [],
        '코어가 백엔드 능력을 물어 갈라진다: ' + bad.join(', ') + '\n' +
        '파사드에 그 일을 해 주는 함수를 만들고 어댑터가 구현하게 해라.\n' +
        '예: can(\'rowLock\') -> lockRow(qb), can(\'serverTuning\') -> ensureConnectionCeiling(n, conn, cb)');
});

test('코어는 드라이버 어휘를 모른다', function () {
    // 능력 질의를 없애도 어휘가 남으면 코어는 여전히 백엔드를 안다.
    // discovery 가 errno 3024 / 1176 을 직접 보고 있었고, 그중 하나
    // (ER_MAX_EXECUTION_TIME_EXCEEDED)는 **드라이버에 없는 이름**이라
    // 죽은 가지였다 — 실제 이름은 ER_QUERY_TIMEOUT 이다.
    //
    // 패턴을 좁게 잡는다. ER_[A-Z_]+ 만 보면 oneM2M 응답 코드 이름
    // (INTERNAL_SERVER_ERROR, MAX_NUMBER_OF_MEMBER_EXCEEDED)에 걸린다.
    const FORBIDDEN = [
        [/\.errno\b/, 'MySQL errno 를 직접 본다 — db/errors 의 술어를 써라'],
        [/\.sqlMessage\b/, 'node-mysql 전용 필드를 읽는다 — db_errors.text() 를 써라'],
        [/['"]ER_[A-Z_]+['"]/, '드라이버 에러 이름을 직접 견준다 — 중립 코드를 써라'],
        [/\/\*\+/, '옵티마이저 힌트 표기를 직접 만든다 — db.optimizerHints() 를 써라'],
        [/\.hintComment\(/, '힌트를 직접 붙인다 — db.withStatementTimeout() 을 써라']
    ];

    const bad = [];
    for (const rel of sourceFiles()) {
        // 어댑터는 알아야 한다 — 거기가 어휘를 번역하는 자리다.
        if (rel.startsWith('mobius/db/')) { continue; }

        // 마이그레이션은 **스스로 백엔드를 밝힌다**(backends: ['mysql']).
        // 밝힌 백엔드의 어휘를 쓰는 것은 이름을 쓰는 것과 같은 성격이라 정상이다 —
        // 002·003·008 의 락 재시도(ER_LOCK_WAIT_TIMEOUT)와 010 의 SET PERSIST
        // 진단이 그렇다. 위 nameSites 가 같은 이유로 이름 리터럴을 면제한다.
        if (rel.startsWith('migrations/')) { continue; }

        fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/).forEach((l, i) => {
            if (/^\s*(\/\/|\*|\/\*)/.test(l)) { return; }
            for (const [re, why] of FORBIDDEN) {
                if (re.test(l)) { bad.push(rel + ':' + (i + 1) + ' — ' + why); }
            }
        });
    }

    assert.deepStrictEqual(bad, [],
        '코어가 드라이버 어휘를 안다:\n  ' + bad.join('\n  '));
});

test('선언된 능력은 누군가 실제로 묻는다', function () {
    // serverTuning 은 어댑터에 선언만 돼 있고 저장소 어디서도 묻지 않았다.
    // 그래서 그 자리가 백엔드 이름 비교로 채워져 있었다 — 답이 이미 있는데
    // 아무도 안 물어서 생긴 구멍이다. 능력을 새로 선언하면 소비자도 있어야 한다.
    //
    // 이제 소비자는 코어가 아니라 **파사드**다. 위 검사가 코어를 막으므로,
    // 새 능력은 파사드의 흡수 함수 안에서 쓰여야 한다.
    const mysql = require('../mobius/db/mysql');
    const sqlite = require('../mobius/db/sqlite');
    const declared = new Set(Object.keys(mysql.capabilities)
        .concat(Object.keys(sqlite.capabilities)));

    const scan = sourceFiles().concat(['mobius.js']);
    const asked = new Set();
    for (const rel of scan) {
        const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
        let m;
        const re = /\.can\(\s*['"]([a-zA-Z]+)['"]\s*\)/g;
        while ((m = re.exec(code)) !== null) { asked.add(m[1]); }
        // 파사드가 자기 안에서 쓰는 것도 소비다 (statementTimeoutHint 등).
        for (const cap of declared) {
            if (new RegExp('capabilities\\.' + cap + '\\b').test(code)) { asked.add(cap); }
        }
    }
    // 파사드 자신은 범위 밖이라 따로 읽는다.
    const facade = fs.readFileSync(path.join(ROOT, 'mobius/db/index.js'), 'utf8');
    for (const cap of declared) {
        if (new RegExp('capabilities\\.' + cap + '\\b').test(facade)) { asked.add(cap); }
    }

    const orphan = [...declared].filter((c) => !asked.has(c)).sort();
    assert.deepStrictEqual(orphan, [],
        '어댑터가 선언했는데 아무도 묻지 않는 능력이 있다: ' + orphan.join(', ') +
        '\n선언만 있고 소비자가 없으면, 그 판단이 다른 곳에서 백엔드 이름 비교로 채워진다.');
});

test('파사드가 백엔드를 고르는 방법은 이름 하나뿐이다', function () {
    // 이 자리에 "파사드는 언제나 허용 목록에 있다" 가 있었다. 파사드가 유일한
    // usesqlite 리더가 되는 것이 목표였기 때문이다. 그 목표를 지나쳤다 —
    // 이제 파사드도 안 읽는다. 그래서 기준을 바꾼다: 무엇을 읽는가가 아니라
    // **선택 경로가 하나인가**를 본다.
    const src = fs.readFileSync(path.join(ROOT, 'mobius/db/index.js'), 'utf8');
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

    assert.match(code, /global\.usedb/,
        '파사드가 이름으로 백엔드를 고르지 않는다');
    assert.ok(!/global\.usesqlite/.test(code),
        '파사드에 boolean 폴백이 되살아났다 — 선택 경로가 둘이면 갈린다');

    // 모르는 이름은 기본값으로 간다. 오타 하나로 기동이 막히면 안 된다.
    assert.match(code, /DEFAULT_BACKEND/,
        '모르는 이름일 때의 기본값이 없다');
});

test('can() 은 connect() 전에도 던지지 않는다', function () {
    // check_db_support 는 CREATE 요청마다 도는 동기 게이트다. 여기서 던지면
    // 그 예외가 db.getConnection 콜백 안에서 터져 워커가 죽고 빌린 커넥션이 샌다.
    // (app.js 는 파사드 connect 의 실패를 삼키고 기동을 계속시킨다.)
    delete require.cache[require.resolve('../mobius/db')];
    delete require.cache[require.resolve('../mobius/db/mysql')];
    delete require.cache[require.resolve('../mobius/db/sqlite')];

    const saved = global.usedb;
    try {
        for (const [backend, limited] of [['sqlite', true], ['mysql', false]]) {
            delete require.cache[require.resolve('../mobius/db')];
            global.usedb = backend;
            const db = require('../mobius/db');
            const allowed = db.supportedResourceTypes();
            if (limited) {
                assert.ok(Array.isArray(allowed),
                    backend + ' 이 지원 타입 목록을 안 준다');
            }
            else {
                assert.strictEqual(allowed, null,
                    backend + ' 이 제한을 선언했다 — null 이어야 한다');
            }
            assert.strictEqual(db.can('없는_능력'), false, '없는 키는 false 여야 한다');
        }
    } finally {
        if (saved === undefined) { delete global.usedb; } else { global.usedb = saved; }
        delete require.cache[require.resolve('../mobius/db')];
    }
});

test('501 게이트는 fail-open 이다 — 제한을 선언한 백엔드만 거른다', function () {
    // 극성이 뒤집히면 정상 CREATE 가 501 로 나간다. **목록이 아닌 것**이
    // "제한 없음" 이다 — mysql 은 null 을 적고, 아예 빠뜨린 어댑터도 같다.
    const mysql = require('../mobius/db/mysql');
    const sqlite = require('../mobius/db/sqlite');
    assert.strictEqual(mysql.supportedResourceTypes, null,
        'mysql 이 지원 타입 목록을 선언했다 — 제한 없음은 null 이다');
    assert.ok(Array.isArray(sqlite.supportedResourceTypes),
        'sqlite 가 지원 타입 목록을 선언하지 않았다');

    // 값을 아예 안 적은 어댑터도 fail-open 이어야 한다.
    delete require.cache[require.resolve('../mobius/db')];
    const saved = global.usedb;
    try {
        global.usedb = 'mysql';
        const db = require('../mobius/db');
        const real = mysql.supportedResourceTypes;
        delete mysql.supportedResourceTypes;
        assert.strictEqual(db.supportedResourceTypes(), null,
            '선언을 빠뜨린 어댑터가 제한 있음으로 읽혔다 — 정상 CREATE 가 501 이 된다');
        mysql.supportedResourceTypes = real;
    } finally {
        global.usedb = saved;
        delete require.cache[require.resolve('../mobius/db')];
    }
});

test('지원 타입 목록은 어댑터가 갖는다 — 코어에 백엔드 이름이 없다', function () {
    // 예전에는 resource.js 에 SQLITE_SUPPORTED_TY 가 있었다. 코어에, 한 백엔드
    // 이름을 달고. 그러면 다른 백엔드가 다른 부분집합을 지원할 때 코어를
    // 고쳐야 하고, "어댑터 파일 하나로 붙는다" 가 깨진다.
    // **주석은 빼고 본다.** 왜 옮겼는지 설명하느라 옛 이름을 인용하기 때문이다.
    // (이 저장소에서 소스 스캔 테스트가 자기 주석에 걸린 적이 여러 번 있다.)
    const src = fs.readFileSync(path.join(ROOT, 'mobius/resource.js'), 'utf8');
    const core = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

    assert.strictEqual(/SQLITE_SUPPORTED_TY/.test(core), false,
        'resource.js 에 SQLITE_SUPPORTED_TY 가 되살아났다 — 목록은 어댑터가 갖는다');
    assert.strictEqual(/\b(SQLITE|MYSQL|POSTGRES)_[A-Z_]+\s*=/.test(core), false,
        'resource.js 에 백엔드 이름이 붙은 상수가 있다');
});

test('501 게이트는 타입별 빌더보다 먼저 선다', function () {
    // create_action 안의 게이트만으로는 늦다. build_resource 아래의 타입별
    // 빌더(build_grp 등)가 먼저 DB 를 치고, 그 실패가 500 "database error" 로
    // 뭉개져 나간다. 실측: SQLite 에서 grp 생성이 501 대신 500 이었다
    // (build_grp -> update_route -> `select * from csr`, 그 테이블이 없다).
    const src = fs.readFileSync(path.join(ROOT, 'mobius/resource.js'), 'utf8');
    const at_create = src.indexOf('exports.create = function');
    assert.ok(at_create > 0, 'exports.create 를 못 찾았다');

    const body = src.slice(at_create, src.indexOf('\nexports.', at_create + 10));
    const at_gate = body.indexOf('check_db_support');
    const at_build = body.indexOf('build_resource(');

    assert.ok(at_gate >= 0, 'exports.create 가 check_db_support 를 부르지 않는다');
    assert.ok(at_build >= 0, 'exports.create 에서 build_resource 를 못 찾았다');
    assert.ok(at_gate < at_build,
        '게이트가 build_resource 뒤에 있다 — 타입별 빌더가 먼저 DB 를 친다');
});

test('어댑터의 지원 타입 목록은 그 어댑터 스키마에 테이블이 있는 것만 담는다', function () {
    // 어댑터가 선언한 목록과 그 어댑터의 스키마 파일을 대조한다.
    // 목록에 있는데 테이블이 없으면 CREATE 가 501 이 아니라 500 으로 깨진다.
    const responder = require('../mobius/responder');
    const dir = path.join(ROOT, 'mobius', 'db');

    for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.js') || f === 'index.js' || f === 'errors.js') { continue; }
        const adapter = require(path.join(dir, f));
        const list = adapter.supportedResourceTypes;
        if (!Array.isArray(list)) { continue; }   // 제한 없음

        const schema = fs.readFileSync(adapter.schemaPath, 'utf8');
        for (const ty of list) {
            const table = responder.typeRsrc[ty];
            assert.ok(table, adapter.name + ': ty=' + ty + ' 가 typeRsrc 에 없다');
            const re = new RegExp('CREATE TABLE (IF NOT EXISTS )?`?' + table + '`?\\s*\\(', 'i');
            assert.ok(re.test(schema),
                adapter.name + ': ty=' + ty + '(' + table + ') 가 지원 목록에 있는데 ' +
                adapter.schemaPath + ' 에 테이블이 없다');
        }
    }
});

// ty -> **본문 테이블** 이름.
//
// responder.typeRsrc 는 테이블이 아니라 **루트 이름**을 준다. 대부분 같지만
// (ae -> ae, cnt -> cnt) 둘이 갈리는 데가 있다:
//   hd_*(91~98)  전부 fcnt 테이블을 쓴다 (sql_action 의 BODY_TABLES 참고)
//   rsp(99)      리소스가 아니라 응답 봉투다 — 테이블이 없다
//   mgo(13)      fwr/bat/dvi/dvc/rbo 가 공유하는 추상 타입
function bodyTable(ty, rootnm) {
    if (Number(ty) >= 91 && Number(ty) <= 98) { return 'fcnt'; }
    if (String(ty) === '99') { return null; }
    return rootnm;
}

test('제한 없는 백엔드는 스키마에 모든 타입의 테이블이 있다', function () {
    // 제한을 선언하지 않았다는 것은 "다 받는다" 는 뜻이다. 그런데 스키마에
    // 테이블이 없으면 CREATE 가 500 으로 깨진다 — 501 로 거절되지도 않는다.
    // (SQLite 의 grp 가 그랬다: 목록에 없어 501 이 맞는데, 게이트가 늦어
    //  csr 조회가 먼저 돌아 500 이 나갔다.)
    const responder = require('../mobius/responder');
    const dir = path.join(ROOT, 'mobius', 'db');

    for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.js') || f === 'index.js' || f === 'errors.js') { continue; }
        const adapter = require(path.join(dir, f));
        if (Array.isArray(adapter.supportedResourceTypes)) { continue; }   // 제한 있음

        const schema = fs.readFileSync(adapter.schemaPath, 'utf8');
        const missing = [];
        // responder.typeRsrc 에서 뽑는다. global.ty_list 는 app.js 가 세우는데
        // 이 테스트는 app.js 를 로드하지 않아 언제나 비어 있다 — 그러면 아무것도
        // 검사하지 않고 통과한다.
        for (const ty of Object.keys(responder.typeRsrc)) {
            const table = bodyTable(ty, responder.typeRsrc[ty]);
            if (!table) { continue; }   // 추상 타입(mgo 등)은 본문 테이블이 없다
            const re = new RegExp('CREATE TABLE (IF NOT EXISTS )?`?' + table + '`?\\s*\\(', 'i');
            if (!re.test(schema)) { missing.push(ty + '(' + table + ')'); }
        }
        assert.deepStrictEqual(missing, [],
            adapter.name + ' 이 제한을 선언하지 않았는데 ' + adapter.schemaPath +
            ' 에 테이블이 없는 타입이 있다: ' + missing.join(', '));
    }
});

test('SQLite 가 MySQL 과 같아지기까지 남은 타입을 센다', function () {
    // SQLite 백엔드는 개발 중이고 **MySQL 과 같은 타입을 전부 받는 것이
    // 목표**다(사용자 확인 2026-09-01). 지금의 부분집합은 임시 상태다.
    //
    // 이 테스트는 막지 않는다 — 남은 것을 **보여 준다.** 목록이 줄어드는 것이
    // 진척이고, 0 이 되면 sqlite 의 supportedResourceTypes 를 null 로 바꾸면
    // 된다(그러면 위의 '제한 없는 백엔드는...' 테스트가 스키마를 검사한다).
    const responder = require('../mobius/responder');
    const sqlite = require('../mobius/db/sqlite');
    const schema = fs.readFileSync(sqlite.schemaPath, 'utf8');
    const mysqlSchema = fs.readFileSync(require('../mobius/db/mysql').schemaPath, 'utf8');

    const has = (s, t) =>
        new RegExp('CREATE TABLE (IF NOT EXISTS )?\`?' + t + '\`?\\s*\\(', 'i').test(s);

    // 타입 목록은 responder.typeRsrc 에서 뽑는다. global.ty_list 는 app.js 가
    // 세우는데 이 테스트는 app.js 를 로드하지 않아 언제나 비어 있었다 —
    // 그래서 "남은 것 0개" 라는 거짓 결과가 나왔다.
    const missing = [];
    const tables = new Set();
    for (const ty of Object.keys(responder.typeRsrc)) {
        if (sqlite.supportedResourceTypes.indexOf(String(ty)) >= 0) { continue; }
        const table = bodyTable(ty, responder.typeRsrc[ty]);
        if (!table) { continue; }                    // 응답 봉투 등 리소스가 아닌 것
        if (!has(mysqlSchema, table)) { continue; }  // MySQL 에도 없으면 대상이 아니다
        missing.push(ty + '(' + table + ')' + (has(schema, table) ? ' [테이블 있음]' : ''));
        tables.add(table);
    }

    // 지금 알고 있는 상태. 줄면 이 두 수를 같이 내린다.
    //
    // 타입 수와 테이블 수가 다른 것은 hd_*(91~98) 여덟이 전부 fcnt 를 쓰기
    // 때문이다 — fcnt 하나를 추가하면 아홉 타입이 한꺼번에 열린다.
    const KNOWN_TYPES = 16;
    const KNOWN_TABLES = 8;

    assert.ok(missing.length <= KNOWN_TYPES,
        'SQLite 미지원 타입이 늘었다 (' + missing.length + ' > ' + KNOWN_TYPES + '): ' +
        missing.join(', '));

    if (missing.length < KNOWN_TYPES) {
        assert.fail('진척이다 — SQLite 미지원이 타입 ' + missing.length + '개 / 테이블 ' +
            tables.size + '개로 줄었다. KNOWN_TYPES 를 ' + missing.length +
            ', KNOWN_TABLES 를 ' + tables.size + ' 로 내려라.\n  남은 타입: ' +
            missing.join(', ') + '\n  남은 테이블: ' + [...tables].sort().join(', '));
    }
    assert.strictEqual(tables.size, KNOWN_TABLES,
        '추가해야 할 테이블 수가 ' + tables.size + ' 다 (알고 있던 값 ' + KNOWN_TABLES + '): ' +
        [...tables].sort().join(', '));
});
