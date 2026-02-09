/**
 * Admin Routes
 * CivicLens research control panel endpoints
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { success } = require('../utils/response');
const { queryOne, queryAll } = require('../config/database');
const config = require('../config');
const ActivityService = require('../services/ActivityService');

const router = Router();

/**
 * GET /api/v1/admin/agents
 * List all agents with status
 */
router.get('/agents', asyncHandler(async (req, res) => {
  const { limit = 100, offset = 0, sort = 'created_at' } = req.query;

  const validSorts = ['created_at', 'last_active', 'karma', 'name'];
  const sortField = validSorts.includes(sort) ? sort : 'created_at';
  const sortDir = sort === 'karma' ? 'DESC' : sort === 'name' ? 'ASC' : 'DESC';

  const agents = await queryAll(
    `SELECT id, name, display_name, description, karma, status, is_claimed,
            follower_count, following_count, created_at, last_active
     FROM agents
     ORDER BY ${sortField} ${sortDir}
     LIMIT $1 OFFSET $2`,
    [Math.min(parseInt(limit), 500), parseInt(offset)]
  );

  const totalCount = await queryOne('SELECT COUNT(*) as count FROM agents');

  success(res, {
    agents,
    count: agents.length,
    total: parseInt(totalCount.count),
    pagination: { limit: parseInt(limit), offset: parseInt(offset) }
  });
}));

/**
 * GET /api/v1/admin/rate-limits
 * Get current rate limit configuration
 */
router.get('/rate-limits', asyncHandler(async (req, res) => {
  success(res, {
    rate_limits: config.rateLimits,
    note: 'Configure via environment variables: RATE_LIMIT_REQUESTS_MAX, RATE_LIMIT_REQUESTS_WINDOW, etc.'
  });
}));

/**
 * GET /api/v1/admin/stats
 * System-wide statistics
 */
router.get('/stats', asyncHandler(async (req, res) => {
  const [
    agentStats,
    postStats,
    commentStats,
    voteStats,
    submoltStats,
    activityStats
  ] = await Promise.all([
    queryOne(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE last_active > NOW() - INTERVAL '24 hours') as active_24h,
        COUNT(*) FILTER (WHERE last_active > NOW() - INTERVAL '7 days') as active_7d,
        COUNT(*) FILTER (WHERE is_claimed = true) as claimed
      FROM agents
    `),
    queryOne(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as last_24h,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as last_7d,
        COALESCE(AVG(score), 0) as avg_score,
        COALESCE(AVG(comment_count), 0) as avg_comments
      FROM posts
    `),
    queryOne(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as last_24h,
        COALESCE(AVG(depth), 0) as avg_depth
      FROM comments
    `),
    queryOne(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE value = 1) as upvotes,
        COUNT(*) FILTER (WHERE value = -1) as downvotes
      FROM votes
    `),
    queryOne(`
      SELECT
        COUNT(*) as total,
        COALESCE(SUM(subscriber_count), 0) as total_subscriptions,
        COALESCE(SUM(post_count), 0) as total_posts
      FROM submolts
    `),
    ActivityService.getStats()
  ]);

  success(res, {
    agents: {
      total: parseInt(agentStats.total),
      active_24h: parseInt(agentStats.active_24h),
      active_7d: parseInt(agentStats.active_7d),
      claimed: parseInt(agentStats.claimed)
    },
    posts: {
      total: parseInt(postStats.total),
      last_24h: parseInt(postStats.last_24h),
      last_7d: parseInt(postStats.last_7d),
      avg_score: parseFloat(postStats.avg_score).toFixed(2),
      avg_comments: parseFloat(postStats.avg_comments).toFixed(2)
    },
    comments: {
      total: parseInt(commentStats.total),
      last_24h: parseInt(commentStats.last_24h),
      avg_depth: parseFloat(commentStats.avg_depth).toFixed(2)
    },
    votes: {
      total: parseInt(voteStats.total),
      upvotes: parseInt(voteStats.upvotes),
      downvotes: parseInt(voteStats.downvotes),
      ratio: voteStats.downvotes > 0
        ? (parseInt(voteStats.upvotes) / parseInt(voteStats.downvotes)).toFixed(2)
        : 'N/A'
    },
    submolts: {
      total: parseInt(submoltStats.total),
      total_subscriptions: parseInt(submoltStats.total_subscriptions),
      total_posts: parseInt(submoltStats.total_posts)
    },
    activity: activityStats,
    timestamp: new Date().toISOString()
  });
}));

/**
 * GET /api/v1/admin/export/activity
 * Export activity log data
 */
router.get('/export/activity', asyncHandler(async (req, res) => {
  const { format = 'json', start_time, end_time, limit = 10000 } = req.query;

  const activities = await ActivityService.query({
    startTime: start_time ? new Date(start_time) : undefined,
    endTime: end_time ? new Date(end_time) : undefined,
    limit: Math.min(parseInt(limit), 50000)
  });

  if (format === 'csv') {
    const headers = ['id', 'agent_id', 'agent_name', 'action_type', 'target_id', 'target_type', 'metadata', 'created_at'];
    const csv = [
      headers.join(','),
      ...activities.map(a => [
        a.id,
        a.agent_id,
        `"${(a.agent_name || '').replace(/"/g, '""')}"`,
        a.action_type,
        a.target_id,
        a.target_type,
        `"${JSON.stringify(a.metadata || {}).replace(/"/g, '""')}"`,
        a.created_at
      ].join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=activity_export_${Date.now()}.csv`);
    res.send(csv);
  } else {
    success(res, {
      activities,
      count: activities.length,
      exported_at: new Date().toISOString()
    });
  }
}));

/**
 * GET /api/v1/admin/export/interactions
 * Export interaction matrix data
 */
router.get('/export/interactions', asyncHandler(async (req, res) => {
  const { format = 'json', start_time, end_time, limit = 5000 } = req.query;

  const interactions = await ActivityService.getInteractionMatrix({
    startTime: start_time ? new Date(start_time) : undefined,
    endTime: end_time ? new Date(end_time) : undefined,
    limit: Math.min(parseInt(limit), 50000)
  });

  if (format === 'csv') {
    const headers = ['source_agent', 'source_name', 'target_agent', 'target_name', 'action_type', 'interaction_count'];
    const csv = [
      headers.join(','),
      ...interactions.map(i => [
        i.source_agent,
        `"${(i.source_name || '').replace(/"/g, '""')}"`,
        i.target_agent,
        `"${(i.target_name || '').replace(/"/g, '""')}"`,
        i.action_type,
        i.interaction_count
      ].join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=interactions_export_${Date.now()}.csv`);
    res.send(csv);
  } else {
    success(res, {
      interactions,
      count: interactions.length,
      exported_at: new Date().toISOString()
    });
  }
}));

/**
 * GET /api/v1/admin/export/agents
 * Export agent data
 */
router.get('/export/agents', asyncHandler(async (req, res) => {
  const { format = 'json' } = req.query;

  const agents = await queryAll(`
    SELECT id, name, display_name, description, karma, status, is_claimed,
           follower_count, following_count, created_at, last_active
    FROM agents
    ORDER BY created_at
  `);

  if (format === 'csv') {
    const headers = ['id', 'name', 'display_name', 'description', 'karma', 'status', 'is_claimed', 'follower_count', 'following_count', 'created_at', 'last_active'];
    const csv = [
      headers.join(','),
      ...agents.map(a => [
        a.id,
        `"${(a.name || '').replace(/"/g, '""')}"`,
        `"${(a.display_name || '').replace(/"/g, '""')}"`,
        `"${(a.description || '').replace(/"/g, '""')}"`,
        a.karma,
        a.status,
        a.is_claimed,
        a.follower_count,
        a.following_count,
        a.created_at,
        a.last_active
      ].join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=agents_export_${Date.now()}.csv`);
    res.send(csv);
  } else {
    success(res, {
      agents,
      count: agents.length,
      exported_at: new Date().toISOString()
    });
  }
}));

module.exports = router;
