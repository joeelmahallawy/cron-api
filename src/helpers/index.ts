// recursively retries request upto 3 times
export const exponentialBackOffSafeFetch = async ({
  apiUrl,
  payload,
  token,
  id,
  attempt,
  timeoutIds,
  jobs,
}: {
  apiUrl: string;
  payload: any;
  token: string;
  id: string;
  attempt: number;
  timeoutIds: { [key: string]: NodeJS.Timeout };
  jobs: any;
}) => {
  // delete from queue after 3 attempts
  if (attempt === 4) {
    // get timer ID from current job
    const { timeId, type }: { timeId: string; type: 'ONCE' | 'INTERVAL' } =
      jobs[id];

    // get timeout object from memory using timer ID
    const timeObject = timeoutIds[timeId];

    // clear timer so it doesnt run
    if (type === 'INTERVAL') {
      clearInterval(timeObject);
    }
    if (type === 'ONCE') {
      clearTimeout(timeObject);
    }

    // delete timer from memory
    delete timeoutIds[timeId];

    // NOTE: we can't actually update redis because the job store might be different
    // from when this is executed to when this was first created therefore we'd
    // overwrite the current jobs with the old jobs (the ones present when first created this job)
    return;
  }

  // runs and retries
  fetch(apiUrl, {
    body: JSON.stringify(payload),
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {
    // retry exponentially
    setTimeout(() => {
      exponentialBackOffSafeFetch({
        apiUrl,
        attempt: attempt + 1,
        id,
        payload,
        token,
        timeoutIds,
        jobs,
      });
      // with an exponential backoff timer
    }, attempt ** 2 * 1000);
  });
};

export const validateRequestBodyWithFields = ({
  body,
  requiredFields,
}: {
  body: string;
  requiredFields: string[];
}) => {
  const payload = JSON.parse(body);

  requiredFields.forEach((field) => {
    if (!payload[field])
      throw new Error(`Missing required body parameter: '${field}'.`);
  });
};
