/**
 * Analytics Routes
 * CivicLens observation layer endpoints
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { success } = require('../utils/response');
const ActivityService = require('../services/ActivityService');

const router = Router();

/**
 * GET /api/v1/analytics/activity
 * Query activity log with filters
 */
router.get('/activity', asyncHandler(async (req, res) => {
  const {
    agent_id,
    action_type,
    target_type,
    start_time,
    end_time,
    limit = 100,
    offset = 0
  } = req.query;

  const activities = await ActivityService.query({
    agentId: agent_id,
    actionType: action_type,
    targetType: target_type,
    startTime: start_time ? new Date(start_time) : undefined,
    endTime: end_time ? new Date(end_time) : undefined,
    limit: Math.min(parseInt(limit), 1000),
    offset: parseInt(offset)
  });

  success(res, {
    activities,
    count: activities.length,
    filters: { agent_id, action_type, target_type, start_time, end_time }
  });
}));

/**
 * GET /api/v1/analytics/interactions
 * Agent-to-agent interaction matrix
 */
router.get('/interactions', asyncHandler(async (req, res) => {
  const { start_time, end_time, limit = 500 } = req.query;

  const interactions = await ActivityService.getInteractionMatrix({
    startTime: start_time ? new Date(start_time) : undefined,
    endTime: end_time ? new Date(end_time) : undefined,
    limit: Math.min(parseInt(limit), 5000)
  });

  // Transform to matrix format if requested
  const format = req.query.format || 'list';

  if (format === 'matrix') {
    // Build adjacency matrix
    const agents = new Set();
    interactions.forEach(i => {
      agents.add(i.source_name);
      agents.add(i.target_name);
    });
    const agentList = [...agents].sort();

    const matrix = {};
    agentList.forEach(source => {
      matrix[source] = {};
      agentList.forEach(target => {
        matrix[source][target] = 0;
      });
    });

    interactions.forEach(i => {
      matrix[i.source_name][i.target_name] += parseInt(i.interaction_count);
    });

    success(res, {
      agents: agentList,
      matrix,
      total_interactions: interactions.reduce((sum, i) => sum + parseInt(i.interaction_count), 0)
    });
  } else {
    success(res, {
      interactions,
      count: interactions.length
    });
  }
}));

/**
 * GET /api/v1/analytics/timeline
 * Chronological event stream for visualization
 */
router.get('/timeline', asyncHandler(async (req, res) => {
  const { start_time, end_time, limit = 500 } = req.query;

  const timeline = await ActivityService.getTimeline({
    startTime: start_time ? new Date(start_time) : undefined,
    endTime: end_time ? new Date(end_time) : undefined,
    limit: Math.min(parseInt(limit), 5000)
  });

  success(res, {
    events: timeline,
    count: timeline.length,
    time_range: timeline.length > 0 ? {
      start: timeline[0].created_at,
      end: timeline[timeline.length - 1].created_at
    } : null
  });
}));

/**
 * GET /api/v1/analytics/agents/:id/behavior
 * Per-agent behavior metrics
 */
router.get('/agents/:id/behavior', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { start_time, end_time } = req.query;

  const behavior = await ActivityService.getAgentBehavior(id, {
    startTime: start_time ? new Date(start_time) : undefined,
    endTime: end_time ? new Date(end_time) : undefined
  });

  success(res, behavior);
}));

/**
 * GET /api/v1/analytics/stats
 * System-wide activity statistics
 */
router.get('/stats', asyncHandler(async (req, res) => {
  const stats = await ActivityService.getStats();
  success(res, stats);
}));

module.exports = router;
