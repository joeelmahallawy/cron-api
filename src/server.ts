import 'dotenv/config';
import crypto from 'crypto';
import fastify, { FastifyError } from 'fastify';
import fastifyRedis from '@fastify/redis';
import {
  exponentialBackOffSafeFetch,
  validateRequestBodyWithFields,
} from './helpers';

const server = fastify({ logger: true });

// store timer objects in memory
const timeoutIds: { [key: string]: NodeJS.Timeout } = {};

server.register(fastifyRedis, { url: process.env.REDIS_URL });

server.get(`/createToken`, async (req, reply) => {
  try {
    const token = crypto.randomUUID();

    const { redis } = server;

    const set = await redis.set(token, JSON.stringify({}));

    if (set === 'OK') return { token, success: true };
  } catch (err) {
    // @ts-expect-error
    return reply.status(400).send({ success: false, error: err.message });
  }
});

server.post(`/once`, async (req, reply) => {
  try {
    //  first check if we have all the valid body parameters
    validateRequestBodyWithFields({
      body: req.body as string,
      requiredFields: ['id', 'runAt', 'payload', 'apiUrl'],
    });
    // runAt should be UNIX timestamp (in milliseconds)
    const { id, runAt, payload, apiUrl } = JSON.parse(req.body as string);
    const { redis } = server;

    const token = req.headers.authorization?.replace(`Bearer `, '');

    // check if there's a token
    if (!token)
      return reply.status(401).send({
        success: false,
        error: `Token error: token was not found in the 'Authorization' header.`,
      });

    const jobsString = await redis.get(token);

    // check if token points to jobs in the database
    if (!jobsString) {
      throw new Error(
        `Invalid token: token doesn't exist or associated with any jobs.`
      );
    }

    // ensure the given time didn't already pass
    if (Date.now() > runAt)
      throw new Error(
        `Invalid date: can only run cron jobs in the future and the timestamp received has already passed.`
      );

    // turn `jobs` to object so we can insert job objects
    const jobs = JSON.parse(jobsString);

    // check if job ID already exists
    if (jobs[id])
      throw new Error(
        `The 'id' parameter is already associated with another job, please pass in a unique ID.`
      );

    // measure delay of job
    const timeFromNowInMilliseconds = runAt - Date.now();

    // run after delay
    const timerObject = setTimeout(() => {
      exponentialBackOffSafeFetch({
        apiUrl,
        attempt: 1,
        id,
        payload,
        token,
        timeoutIds,
        jobs,
      });
    }, timeFromNowInMilliseconds);

    // create time ID to reference to and stop timer
    const timeId = crypto.randomUUID();

    // store timeout object in memory so we can cancel it later on
    timeoutIds[timeId] = timerObject;

    // insert job under user's job store
    jobs[id] = { apiUrl, runAt, payload, timeId, type: 'ONCE' };

    // write to redis
    redis.set(token, JSON.stringify(jobs));

    return { success: true };
  } catch (err) {
    // @ts-expect-error
    return reply.status(400).send({ success: false, error: err.message });
  }
});

server.post(`/periodic`, async (req, reply) => {
  try {
    //  first check if we have all the right body parameters and throw error for missing parameters
    validateRequestBodyWithFields({
      body: req.body as string,
      requiredFields: ['id', 'interval', 'payload', 'apiUrl'],
    });

    // interval should be in milliseconds
    const { id, interval, payload, apiUrl } = JSON.parse(req.body as string);
    const { redis } = server;
    const token = req.headers.authorization?.replace(`Bearer `, '');

    // check if there's a token
    if (!token)
      return reply.status(401).send({
        success: false,
        error: `Token error: missing required token from 'Authorization' header.`,
      });

    const jobsString = await redis.get(token);

    // check if token points to jobs in the database
    if (!jobsString) {
      throw new Error(`Invalid token: token doesn't exist.`);
    }

    // turn `jobs` to object so we can insert job objects
    const jobs = JSON.parse(jobsString);

    // check if job ID already exists
    if (jobs[id])
      throw new Error(
        `The ID received in is already associated with another job, please pass in a unique ID.`
      );

    if (isNaN(interval))
      throw new Error(
        `The 'interval' parameter that was received is not a valid UNIX timestamp. Please make sure to pass in a valid UNIX timestamp in milliseconds.`
      );

    // run for every interval
    const timerObject = setInterval(() => {
      exponentialBackOffSafeFetch({
        apiUrl,
        attempt: 1,
        id,
        payload,
        token,
        timeoutIds,
        jobs,
      });
    }, interval);

    // create time ID to reference to and stop timer
    const timeId = crypto.randomUUID();

    // store timeout object in memory so we can cancel it later on
    timeoutIds[timeId] = timerObject;

    // insert job under user's job store
    jobs[id] = { apiUrl, interval, payload, timeId, type: 'INTERVAL' };

    // write to redis
    redis.set(token, JSON.stringify(jobs));

    return { success: true };
  } catch (err) {
    // @ts-expect-error
    return reply.status(400).send({ success: false, error: err.message });
  }
});

server.post(`/stop`, async (req, reply) => {
  try {
    // get token and reject if not passed
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token)
      throw new Error(
        `Token error: missing required token from 'Authorization' header.`
      );

    const { id } = JSON.parse(req.body as string);

    // get job ID and reject if not passed in
    if (!id) {
      throw new Error(`Missing required body parameter: 'id'.`);
    }

    // get job store and reject if token doesn't exist
    const jobStore = await server.redis.get(token);

    if (!jobStore) throw new Error(`Invalid token: token doesn't exist.`);

    // get jobs associated with token
    const jobs = JSON.parse(jobStore);

    // get job by ID and reject if job doesn't exist
    const job: {
      apiUrl: string;
      runAt: string;
      payload: string;
      timeId: string;
      type: 'ONCE' | 'INTERVAL';
    } = jobs[id];

    if (!job)
      throw new Error(
        `The 'id' received doesn't exist and isn't associated with any job.`
      );

    // get timeout ID from job
    const { timeId } = job;
    // get Node.js timer object from memory using timeout ID
    const timeoutObject = timeoutIds[timeId];

    // cancel timeout or interval so it doesn't run
    if (job.type === 'ONCE') clearTimeout(timeoutObject);
    else clearInterval(timeoutObject);

    //  delete job from job store
    delete jobs[id];

    // delete timer from memory
    delete timeoutIds[timeId];

    // and update the job store
    server.redis.set(token, JSON.stringify(jobs));

    return reply.send({ success: true });
  } catch (err) {
    // @ts-expect-error
    return reply.status(400).send({ success: false, error: err.message });
  }
});

// @ts-expect-error
server.listen({
  port: process.env.PORT || 4001,
  host: '0.0.0.0',
});
