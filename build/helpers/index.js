"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateRequestBodyWithFields = exports.exponentialBackOffSafeFetch = void 0;
const exponentialBackOffSafeFetch = async ({ apiUrl, payload, token, id, attempt, timeoutIds, jobs, }) => {
    if (attempt === 4) {
        const { timeId, type } = jobs[id];
        const timeObject = timeoutIds[timeId];
        if (type === 'INTERVAL') {
            clearInterval(timeObject);
        }
        if (type === 'ONCE') {
            clearTimeout(timeObject);
        }
        delete timeoutIds[timeId];
        return;
    }
    fetch(apiUrl, {
        body: JSON.stringify(payload),
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {
        setTimeout(() => {
            (0, exports.exponentialBackOffSafeFetch)({
                apiUrl,
                attempt: attempt + 1,
                id,
                payload,
                token,
                timeoutIds,
                jobs,
            });
        }, attempt ** 2 * 1000);
    });
};
exports.exponentialBackOffSafeFetch = exponentialBackOffSafeFetch;
const validateRequestBodyWithFields = ({ body, requiredFields, }) => {
    const payload = JSON.parse(body);
    requiredFields.forEach((field) => {
        if (!payload[field])
            throw new Error(`Missing required body parameter: '${field}'.`);
    });
};
exports.validateRequestBodyWithFields = validateRequestBodyWithFields;
//# sourceMappingURL=index.js.map