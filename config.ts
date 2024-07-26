import { log } from './router';
import redisCli from 'ioredis';


const REDIS_HOST = process.env.REDIS_HOST;
const REDIS_PORT = process.env.REDIS_PORT;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;

const redis = new redisCli({
    host: REDIS_HOST,
    port: Number(REDIS_PORT),
    password: REDIS_PASSWORD,
    lazyConnect: true,
    keepAlive: 1000,
});

redis.on('error', (error) => {
    log.error('Redis connection error:', error);
});

export const connectToRedis = async (): Promise<redisCli> => {
    try {
        log.log(`Connecting to Redis at ${REDIS_HOST}:${REDIS_PORT}`);
        
        if (redis.status === 'ready') {
            log.log('Redis client is already connected');
            return redis;
        } else {
            await redis.connect();
            log.log('Connected to Redis');
            return redis;
        }
    } catch (error) {
        log.error('Error connecting to Redis:', error);
        throw error;
    }
};

export const getRedisStatus = (): string => {
    return redis.status;
};

export const printRedisConfig = () => {
    log.log('Redis Configuration:', {
        host: REDIS_HOST,
        port: REDIS_PORT,
        password: REDIS_PASSWORD ? '*****' : 'Not Set',
    });
};
