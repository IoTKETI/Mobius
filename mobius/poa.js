/**
 * DB 에 저장된 poa 컬럼을 배열로 읽는다.
 *
 * poa 는 접속점 목록이고 DB 에는 JSON 문자열로 들어간다. 값이 깨져 있으면
 * JSON.parse 가 던지는데, 호출부가 전부 DB 콜백 안이라 잡을 곳이 없다 —
 * uncaught exception 이 되어 워커가 죽는다.
 *
 * null 도 마찬가지다. JSON.parse(null) 은 던지지 않고 null 을 돌려주므로,
 * 다음 줄의 poa_arr.length 에서 TypeError 가 난다. 이쪽이 더 찾기 어렵다.
 *
 * poa 는 csr.js / ae.js 에서 미지정 시 [] 가 기본값이라, 비어 있는 것은
 * 예외 상황이 아니라 기본 상태다.
 */

/**
 * @param {*} raw        DB 에서 읽은 poa 값
 * @param {string} where 로그에 남길 위치 (어느 리소스인지 알 수 있게)
 * @returns {Array|null} 배열. 읽을 수 없으면 null — 호출부가 오류로 처리한다
 */
exports.parse = function (raw, where) {
    if (Array.isArray(raw)) {
        return raw;               // 백엔드에 따라 이미 배열로 올 수 있다
    }
    if (raw == null || raw === '') {
        return [];                // 미지정. 빈 목록과 같게 다룬다
    }

    var parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (e) {
        console.error('[poa] poa 를 읽을 수 없다 (' + where + '): ' + e.message);
        return null;
    }

    if (parsed === null) {
        return [];                // "null" 문자열이 저장된 경우
    }
    if (!Array.isArray(parsed)) {
        console.error('[poa] poa 가 배열이 아니다 (' + where + ')');
        return null;
    }
    return parsed;
};
