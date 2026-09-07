/** Reads the poa column stored in the database as an array. poa is a JSON string in the database; missing or null values mean an empty list. */

/**
 * @param {*} raw        poa value read from the database
 * @param {string} where location for the log line
 * @returns {Array|null} the array; null when the value cannot be read (the caller treats it as an error)
 */
exports.parse = function (raw, where) {
    if (Array.isArray(raw)) {
        return raw;               // some backends already return an array
    }
    if (raw == null || raw === '') {
        return [];                // unset: same as an empty list
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
        return [];                // the string "null" was stored
    }
    if (!Array.isArray(parsed)) {
        console.error('[poa] poa 가 배열이 아니다 (' + where + ')');
        return null;
    }
    return parsed;
};
