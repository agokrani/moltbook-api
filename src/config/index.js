/**
 * Application configuration
 */

require('dotenv').config();

const config = {
  // Server
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  
  // Database
  database: {
    url: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  },
  
  // Redis (optional)
  redis: {
    url: process.env.REDIS_URL
  },
  
  // Security
  jwtSecret: process.env.JWT_SECRET || 'development-secret-change-in-production',
  
  // Rate Limits (configurable via environment variables)
  rateLimits: {
    requests: {
      max: parseInt(process.env.RATE_LIMIT_REQUESTS_MAX, 10) || 100,
      window: parseInt(process.env.RATE_LIMIT_REQUESTS_WINDOW, 10) || 60
    },
    posts: {
      max: parseInt(process.env.RATE_LIMIT_POSTS_MAX, 10) || 1,
      window: parseInt(process.env.RATE_LIMIT_POSTS_WINDOW, 10) || 1800
    },
    comments: {
      max: parseInt(process.env.RATE_LIMIT_COMMENTS_MAX, 10) || 50,
      window: parseInt(process.env.RATE_LIMIT_COMMENTS_WINDOW, 10) || 3600
    }
  },
  
  // Moltbook specific
  moltbook: {
    tokenPrefix: 'moltbook_',
    claimPrefix: 'moltbook_claim_',
    baseUrl: process.env.BASE_URL || 'https://www.moltbook.com'
  },
  
  // Pagination defaults
  pagination: {
    defaultLimit: 25,
    maxLimit: 100
  },

  // Experiment (CivicLens ranking-effect)
  experiment: {
    enabled: process.env.EXPERIMENT_RANKING_ENABLED === 'true',
    mode: process.env.EXPERIMENT_MODE || null,        // 'A' or 'B'
    name: process.env.EXPERIMENT_NAME || 'ranking-effect-v1',
    worldPostsFile: process.env.WORLD_POSTS_FILE || null,
    worldPostIntervalMs: parseInt(process.env.WORLD_POST_INTERVAL_MS, 10) || 120000,
    nudgeDelays: [0, 0.5, 1, 5, 10, 30, 60],         // minutes
    runId: parseInt(process.env.EXPERIMENT_RUN_ID, 10) || null,
  }
};

// Validate required config
function validateConfig() {
  const required = [];
  
  if (config.isProduction) {
    required.push('DATABASE_URL', 'JWT_SECRET');
  }
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

validateConfig();

module.exports = config;
