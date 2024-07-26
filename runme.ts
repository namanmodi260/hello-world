import { route } from './router';
import { connectToRedis, printRedisConfig } from './config';

export const entry = async (event) => {
  // Connect to Redis and print configuration
  await connectToRedis();
  printRedisConfig();

  // Continue with routing logic
  return route(event);
}
