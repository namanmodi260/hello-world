
import * as https from 'https'; 
import { Credentials, Lambda } from 'aws-sdk';
import redisCli from 'ioredis';
import { IncomingHttpHeaders } from 'http';

// dotenv.config();

const ROUTE_TABLE = process.env.C1_ROUTE_TABLE_PREFIX;

export const log = {
    error: (...data: any) => {
        console.error(...data); 
    },

    log: (...data: any) => {
        console.log(...data); 
    }
};

export const cli = async (): Promise<redisCli> => {

    const REDIS_HOST = process.env.REDIS_HOST;
    const REDIS_PORT = process.env.REDIS_PORT;
    const REDIS_PASSWORD = process.env.REDIS_PASSWORD;

    if (!REDIS_HOST || !REDIS_PORT || !REDIS_PASSWORD) {
        throw new Error("Required Redis environment variables are missing");
    }

    const redis = new redisCli({
        host: REDIS_HOST,
        port: Number(REDIS_PORT),
        password: REDIS_PASSWORD, 
        lazyConnect: true,
        keepAlive: 1000,
    });

    console.log(redis.status);

    if (redis.status === 'ready') {
        // If the client is already ready, resolve immediately
        return Promise.resolve(redis);
    } else {
    // Connect only if the client is not already connecting or connected
    if (redis.status !== 'connecting' && redis.status !== 'connect') {
        await redis.connect();
    }
    // Wait for the client to be ready, since `connect` does not guarantee the client is ready
    return new Promise((resolve, reject) => {
        if (redis.status === 'ready') {
            resolve(redis);
        } else {
            redis.once('ready', () => resolve(redis));
            redis.once('error', reject);
        }
    });
  }
};


export const forwardToUrl = async (event, url: string): Promise< (number | { body: string, headers: IncomingHttpHeaders })[]> => {
  return new Promise((resolve, reject) => {
    try {
        // Extracting headers, query parameters, and body from the event
        const { headers, queryStringParameters, body } = event;

        // Adding query parameters to the URL, if any
        const urlWithParams = new URL(url);
        if (queryStringParameters) {
            Object.keys(queryStringParameters).forEach(key => {
            urlWithParams.searchParams.append(key, queryStringParameters[key]);
            });
        }

        // Remove forwarding-breaking headers
        delete headers["host"];
        Object.entries(headers).forEach((header) => {
            const [key, _] = header;
            if (key.includes("amzn")) {
                delete headers[key];
            }
        });

        const options = {
            method: event.httpMethod || 'POST',
            headers: headers || {'Content-Type': 'application/text'},
        };

        const req = https.request(urlWithParams, options, (res) => {
            let responseBody = '';

            res.on('data', (chunk) => {
            responseBody += chunk;
            });

            res.on('end', () => {
                resolve([res.statusCode, {
                    body: responseBody,
                    headers: res.headers
                }]);
            });
        });
        
        req.on('error', (error) => {
            log.error(`Error forwarding to URL: ${url}`, error);
            reject([500, 'Error forwarding request']);
        });

        // Send the request
        if (body) {
            if (typeof body === 'string') {
                req.write(body);
            }
            else {
                // Infer that body is JSON
                req.write(JSON.stringify(body));
            }
        }
        req.end();

    } catch (error) {
        log.error(`Error in forwarding request: ${error}`);
        reject([500, 'Error in forwarding request']);
    }
  });
};


export const forwardToArn = async (event, arn: string): Promise<[number, any]> => {
    try {
        const { id, key } = event.queryStringParameters;
        const lambda = new Lambda({
            credentials: new Credentials(id, key)
        });
        const response = await lambda.invoke({
            FunctionName: arn,
            InvocationType: 'RequestResponse',
            Payload: event.body,
        }).promise();

        const payload = JSON.parse(response.Payload as string);
        return [response.StatusCode, payload];
    } catch (error) {
        log.error(`Error forwarding to ARN: ${arn}`, error);
        return [500, 'Error forwarding request'];
    }
};

let clientPromise = cli();

export const getForwardRoute = async (event, cb) => {
    let client = await clientPromise; 
    return client.hget(ROUTE_TABLE, event.rawPath, cb); 
}


export const route = async (event) => {

    let forwardPromise = new Promise((resolve, reject) => {
        try {
            getForwardRoute(event, async (err, result) => {
                if (err) {
                    log.error(`REDIS error trying to find access or forward event: `, event);
                    log.error(err);
                    resolve([500, `C1 router error`]);
                }
                else {
                    log.log(result);
                    let data = JSON.parse(result);
                    if (data === null) {
                        resolve([404, `No known c1 route for provided url: ${event.rawPath}`]);
                    }
                    else if (typeof data === 'object') {
                        if (data['type'] === 'string') {
                            resolve([200, {
                                headers: { 'Content-Type': 'text/plain' },
                                body: data['data']
                            }]);
                        }
                        else if (data['type'] === 'url') {
                            let forwardResult = await forwardToUrl(event, data['data']); 
                            resolve(forwardResult);
                        }
                        else if (data['type'] === 'arn') {
                            let forwardResult = await forwardToArn(event, data['data']); 
                            resolve(forwardResult);
                        }
                        else {
                            log.error(`Access error - no known forward method found for url ${event.rawPath}: `);
                            log.error(`Data was: `, data);
                            log.error(`Event was: `, event);  
                            resolve([500, `No known c1 route for provided url: ${event.rawPath}`])
                        }
                    }
                    else {
                        log.error(`Access error - no known forward method fund for url ${event.rawPath}: `);
                        log.error(`Data was: `, data);
                        log.error(`Event was: `, event);
                        resolve([500, `No known c1 route for provided url: ${event.rawPath}`])
                    }
                }
            });
        } catch (err) {
            log.error(`Error trying to find access or forward event: `, event);
            log.error(err);
            resolve([500, `C1 router error`])
        }
    });

    try {
        let forwardResponse = await forwardPromise;
        let statusCode = forwardResponse[0];
        let responseData = forwardResponse[1];
        return {
            statusCode: statusCode,
            headers: responseData.headers || { 'Content-Type': 'application/json' },
            body: responseData.body || responseData,
        };
    } catch (err) {
        log.error(`Error trying to find access or forward event: `, event);
        log.error(err);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Error in processing request' })
        };
    }
}
