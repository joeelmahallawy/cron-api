"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
require("dotenv/config");
const crypto_1 = tslib_1.__importDefault(require("crypto"));
const fastify_1 = tslib_1.__importDefault(require("fastify"));
const redis_1 = tslib_1.__importDefault(require("@fastify/redis"));
const helpers_1 = require("./helpers");
const server = (0, fastify_1.default)({ logger: true });
const timeoutIds = {};
server.register(redis_1.default, { url: process.env.REDIS_URL });
server.get(`/createToken`, async (req, reply) => {
    try {
        const token = crypto_1.default.randomUUID();
        const { redis } = server;
        const set = await redis.set(token, JSON.stringify({}));
        if (set === 'OK')
            return { token, success: true };
    }
    catch (err) {
        return reply.status(400).send({ success: false, error: err.message });
    }
});
server.post(`/once`, async (req, reply) => {
    var _a;
    try {
        (0, helpers_1.validateRequestBodyWithFields)({
            body: req.body,
            requiredFields: ['id', 'runAt', 'payload', 'apiUrl'],
        });
        const { id, runAt, payload, apiUrl } = JSON.parse(req.body);
        const { redis } = server;
        const token = (_a = req.headers.authorization) === null || _a === void 0 ? void 0 : _a.replace(`Bearer `, '');
        if (!token)
            return reply.status(401).send({
                success: false,
                error: `Token error: token was not found in the 'Authorization' header.`,
            });
        const jobsString = await redis.get(token);
        if (!jobsString) {
            throw new Error(`Invalid token: token doesn't exist or associated with any jobs.`);
        }
        if (Date.now() > runAt)
            throw new Error(`Invalid date: can only run cron jobs in the future and the timestamp received has already passed.`);
        const jobs = JSON.parse(jobsString);
        if (jobs[id])
            throw new Error(`The 'id' parameter is already associated with another job, please pass in a unique ID.`);
        const timeFromNowInMilliseconds = runAt - Date.now();
        const timerObject = setTimeout(() => {
            (0, helpers_1.exponentialBackOffSafeFetch)({
                apiUrl,
                attempt: 1,
                id,
                payload,
                token,
                timeoutIds,
                jobs,
            });
        }, timeFromNowInMilliseconds);
        const timeId = crypto_1.default.randomUUID();
        timeoutIds[timeId] = timerObject;
        jobs[id] = { apiUrl, runAt, payload, timeId, type: 'ONCE' };
        redis.set(token, JSON.stringify(jobs));
        return { success: true };
    }
    catch (err) {
        return reply.status(400).send({ success: false, error: err.message });
    }
});
server.post(`/periodic`, async (req, reply) => {
    var _a;
    try {
        (0, helpers_1.validateRequestBodyWithFields)({
            body: req.body,
            requiredFields: ['id', 'interval', 'payload', 'apiUrl'],
        });
        const { id, interval, payload, apiUrl } = JSON.parse(req.body);
        const { redis } = server;
        const token = (_a = req.headers.authorization) === null || _a === void 0 ? void 0 : _a.replace(`Bearer `, '');
        if (!token)
            return reply.status(401).send({
                success: false,
                error: `Token error: missing required token from 'Authorization' header.`,
            });
        const jobsString = await redis.get(token);
        if (!jobsString) {
            throw new Error(`Invalid token: token doesn't exist.`);
        }
        const jobs = JSON.parse(jobsString);
        if (jobs[id])
            throw new Error(`The ID received in is already associated with another job, please pass in a unique ID.`);
        if (isNaN(interval))
            throw new Error(`The 'interval' parameter that was received is not a valid UNIX timestamp. Please make sure to pass in a valid UNIX timestamp in milliseconds.`);
        const timerObject = setInterval(() => {
            (0, helpers_1.exponentialBackOffSafeFetch)({
                apiUrl,
                attempt: 1,
                id,
                payload,
                token,
                timeoutIds,
                jobs,
            });
        }, interval);
        const timeId = crypto_1.default.randomUUID();
        timeoutIds[timeId] = timerObject;
        jobs[id] = { apiUrl, interval, payload, timeId, type: 'INTERVAL' };
        redis.set(token, JSON.stringify(jobs));
        return { success: true };
    }
    catch (err) {
        return reply.status(400).send({ success: false, error: err.message });
    }
});
server.post(`/stop`, async (req, reply) => {
    var _a;
    try {
        const token = (_a = req.headers.authorization) === null || _a === void 0 ? void 0 : _a.replace('Bearer ', '');
        if (!token)
            throw new Error(`Token error: missing required token from 'Authorization' header.`);
        const { id } = JSON.parse(req.body);
        if (!id) {
            throw new Error(`Missing required body parameter: 'id'.`);
        }
        const jobStore = await server.redis.get(token);
        if (!jobStore)
            throw new Error(`Invalid token: token doesn't exist.`);
        const jobs = JSON.parse(jobStore);
        const job = jobs[id];
        if (!job)
            throw new Error(`The 'id' received doesn't exist and isn't associated with any job.`);
        const { timeId } = job;
        const timeoutObject = timeoutIds[timeId];
        if (job.type === 'ONCE')
            clearTimeout(timeoutObject);
        else
            clearInterval(timeoutObject);
        delete jobs[id];
        delete timeoutIds[timeId];
        server.redis.set(token, JSON.stringify(jobs));
        return reply.send({ success: true });
    }
    catch (err) {
        return reply.status(400).send({ success: false, error: err.message });
    }
});
server.listen({ port: 4000 });
//# sourceMappingURL=server.js.map