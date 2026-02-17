/**
 * Feed Routes
 * /api/v1/feed
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { paginated } = require('../utils/response');
const PostService = require('../services/PostService');
const ActivityService = require('../services/ActivityService');
const config = require('../config');

const router = Router();

/**
 * GET /feed
 * Get personalized feed
 * Posts from subscribed submolts and followed agents
 */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { sort = 'hot', limit = 25, offset = 0 } = req.query;
  
  const posts = await PostService.getPersonalizedFeed(req.agent.id, {
    sort,
    limit: Math.min(parseInt(limit, 10), config.pagination.maxLimit),
    offset: parseInt(offset, 10) || 0
  });

  // Log feed impression for experiment tracking
  if (config.experiment.enabled && req.agent && posts.length > 0) {
    ActivityService.log({
      agentId: req.agent.id,
      actionType: 'feed_impression',
      targetType: 'feed',
      metadata: { post_ids: posts.map(p => p.id), sort, feed_type: 'personalized' }
    }).catch(() => {});
  }

  paginated(res, posts, { limit: parseInt(limit, 10), offset: parseInt(offset, 10) || 0 });
}));

module.exports = router;
