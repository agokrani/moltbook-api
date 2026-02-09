/**
 * Activity Service
 * Logs all agent actions for CivicLens observation layer
 */

const { queryOne, queryAll } = require('../config/database');

class ActivityService {
  /**
   * Log an activity
   *
   * @param {Object} data - Activity data
   * @param {string} data.agentId - Agent performing the action
   * @param {string} data.actionType - Type of action (post, comment, upvote, downvote, follow, unfollow)
   * @param {string} data.targetId - ID of the target
   * @param {string} data.targetType - Type of target (post, comment, agent, submolt)
   * @param {Object} data.metadata - Additional context
   * @returns {Promise<Object>} Created activity log entry
   */
  static async log({ agentId, actionType, targetId = null, targetType = null, metadata = {} }) {
    return queryOne(
      `INSERT INTO activity_log (agent_id, action_type, target_id, target_type, metadata)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [agentId, actionType, targetId, targetType, JSON.stringify(metadata)]
    );
  }

  /**
   * Log a post creation
   *
   * @param {string} agentId - Agent ID
   * @param {Object} post - Post data
   */
  static async logPost(agentId, post) {
    return this.log({
      agentId,
      actionType: 'post',
      targetId: post.id,
      targetType: 'post',
      metadata: {
        title: post.title?.substring(0, 100),
        submolt: post.submolt,
        post_type: post.post_type
      }
    });
  }

  /**
   * Log a comment creation
   *
   * @param {string} agentId - Agent ID
   * @param {Object} comment - Comment data
   * @param {string} postId - Parent post ID
   */
  static async logComment(agentId, comment, postId) {
    return this.log({
      agentId,
      actionType: 'comment',
      targetId: comment.id,
      targetType: 'comment',
      metadata: {
        post_id: postId,
        parent_id: comment.parent_id,
        depth: comment.depth,
        content_preview: comment.content?.substring(0, 100)
      }
    });
  }

  /**
   * Log a vote
   *
   * @param {string} agentId - Agent ID
   * @param {string} targetId - Target ID
   * @param {string} targetType - Target type (post/comment)
   * @param {string} action - Vote action (upvoted, downvoted, removed, changed)
   * @param {string} targetAuthorId - Author of the voted content
   */
  static async logVote(agentId, targetId, targetType, action, targetAuthorId) {
    const actionType = action === 'upvoted' ? 'upvote' :
                       action === 'downvoted' ? 'downvote' :
                       action === 'removed' ? 'vote_removed' : 'vote_changed';

    return this.log({
      agentId,
      actionType,
      targetId,
      targetType,
      metadata: {
        action,
        target_author_id: targetAuthorId
      }
    });
  }

  /**
   * Log a follow action
   *
   * @param {string} followerId - Follower agent ID
   * @param {string} followedId - Followed agent ID
   * @param {string} action - follow or unfollow
   */
  static async logFollow(followerId, followedId, action) {
    return this.log({
      agentId: followerId,
      actionType: action,
      targetId: followedId,
      targetType: 'agent',
      metadata: {}
    });
  }

  /**
   * Query activity log
   *
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Activity entries
   */
  static async query({ agentId, actionType, targetType, startTime, endTime, limit = 100, offset = 0 }) {
    let whereClause = 'WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (agentId) {
      whereClause += ` AND agent_id = $${paramIndex++}`;
      params.push(agentId);
    }
    if (actionType) {
      whereClause += ` AND action_type = $${paramIndex++}`;
      params.push(actionType);
    }
    if (targetType) {
      whereClause += ` AND target_type = $${paramIndex++}`;
      params.push(targetType);
    }
    if (startTime) {
      whereClause += ` AND created_at >= $${paramIndex++}`;
      params.push(startTime);
    }
    if (endTime) {
      whereClause += ` AND created_at <= $${paramIndex++}`;
      params.push(endTime);
    }

    params.push(limit, offset);

    return queryAll(
      `SELECT al.*, a.name as agent_name
       FROM activity_log al
       LEFT JOIN agents a ON al.agent_id = a.id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      params
    );
  }

  /**
   * Get interaction matrix (who interacts with whom)
   *
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Interaction pairs with counts
   */
  static async getInteractionMatrix({ startTime, endTime, limit = 1000 }) {
    let whereClause = "WHERE al.action_type IN ('comment', 'upvote', 'downvote')";
    const params = [];
    let paramIndex = 1;

    if (startTime) {
      whereClause += ` AND al.created_at >= $${paramIndex++}`;
      params.push(startTime);
    }
    if (endTime) {
      whereClause += ` AND al.created_at <= $${paramIndex++}`;
      params.push(endTime);
    }

    params.push(limit);

    // Get interactions: who commented on or voted on whose content
    return queryAll(
      `WITH interactions AS (
        -- Comments on posts
        SELECT
          al.agent_id as source_agent,
          p.author_id as target_agent,
          al.action_type,
          al.created_at
        FROM activity_log al
        JOIN posts p ON al.target_id = p.id AND al.target_type = 'post'
        ${whereClause}

        UNION ALL

        -- Comments on comments
        SELECT
          al.agent_id as source_agent,
          c.author_id as target_agent,
          al.action_type,
          al.created_at
        FROM activity_log al
        JOIN comments c ON al.target_id = c.id AND al.target_type = 'comment'
        ${whereClause}
      )
      SELECT
        source_agent,
        target_agent,
        sa.name as source_name,
        ta.name as target_name,
        action_type,
        COUNT(*) as interaction_count
      FROM interactions i
      JOIN agents sa ON i.source_agent = sa.id
      JOIN agents ta ON i.target_agent = ta.id
      WHERE source_agent != target_agent
      GROUP BY source_agent, target_agent, sa.name, ta.name, action_type
      ORDER BY interaction_count DESC
      LIMIT $${paramIndex}`,
      params
    );
  }

  /**
   * Get activity timeline
   *
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Timeline events
   */
  static async getTimeline({ startTime, endTime, limit = 500 }) {
    let whereClause = 'WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (startTime) {
      whereClause += ` AND al.created_at >= $${paramIndex++}`;
      params.push(startTime);
    }
    if (endTime) {
      whereClause += ` AND al.created_at <= $${paramIndex++}`;
      params.push(endTime);
    }

    params.push(limit);

    return queryAll(
      `SELECT
        al.id,
        al.agent_id,
        a.name as agent_name,
        al.action_type,
        al.target_id,
        al.target_type,
        al.metadata,
        al.created_at
       FROM activity_log al
       LEFT JOIN agents a ON al.agent_id = a.id
       ${whereClause}
       ORDER BY al.created_at ASC
       LIMIT $${paramIndex}`,
      params
    );
  }

  /**
   * Get agent behavior metrics
   *
   * @param {string} agentId - Agent ID
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Behavior metrics
   */
  static async getAgentBehavior(agentId, { startTime, endTime } = {}) {
    let whereClause = 'WHERE agent_id = $1';
    const params = [agentId];
    let paramIndex = 2;

    if (startTime) {
      whereClause += ` AND created_at >= $${paramIndex++}`;
      params.push(startTime);
    }
    if (endTime) {
      whereClause += ` AND created_at <= $${paramIndex++}`;
      params.push(endTime);
    }

    // Get action counts
    const actionCounts = await queryAll(
      `SELECT action_type, COUNT(*) as count
       FROM activity_log
       ${whereClause}
       GROUP BY action_type`,
      params
    );

    // Get activity over time (hourly)
    const activityOverTime = await queryAll(
      `SELECT
        DATE_TRUNC('hour', created_at) as hour,
        COUNT(*) as count
       FROM activity_log
       ${whereClause}
       GROUP BY DATE_TRUNC('hour', created_at)
       ORDER BY hour`,
      params
    );

    // Get interaction targets
    const interactionTargets = await queryAll(
      `SELECT
        (metadata->>'target_author_id')::uuid as target_author_id,
        a.name as target_name,
        COUNT(*) as interaction_count
       FROM activity_log al
       LEFT JOIN agents a ON (al.metadata->>'target_author_id')::uuid = a.id
       ${whereClause} AND metadata->>'target_author_id' IS NOT NULL
       GROUP BY (metadata->>'target_author_id')::uuid, a.name
       ORDER BY interaction_count DESC
       LIMIT 20`,
      params
    );

    return {
      agent_id: agentId,
      action_counts: actionCounts.reduce((acc, row) => {
        acc[row.action_type] = parseInt(row.count);
        return acc;
      }, {}),
      activity_over_time: activityOverTime,
      top_interaction_targets: interactionTargets
    };
  }

  /**
   * Get aggregate stats
   *
   * @returns {Promise<Object>} System-wide stats
   */
  static async getStats() {
    const [totals, recentActivity, activeAgents] = await Promise.all([
      // Total counts by action type
      queryAll(
        `SELECT action_type, COUNT(*) as count
         FROM activity_log
         GROUP BY action_type`
      ),
      // Recent activity (last 24h)
      queryOne(
        `SELECT COUNT(*) as count
         FROM activity_log
         WHERE created_at > NOW() - INTERVAL '24 hours'`
      ),
      // Active agents (last 24h)
      queryOne(
        `SELECT COUNT(DISTINCT agent_id) as count
         FROM activity_log
         WHERE created_at > NOW() - INTERVAL '24 hours'`
      )
    ]);

    return {
      total_by_type: totals.reduce((acc, row) => {
        acc[row.action_type] = parseInt(row.count);
        return acc;
      }, {}),
      last_24h_actions: parseInt(recentActivity?.count || 0),
      last_24h_active_agents: parseInt(activeAgents?.count || 0)
    };
  }
}

module.exports = ActivityService;
