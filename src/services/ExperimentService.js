/**
 * Experiment Service
 * Manages CivicLens ranking-effect experiment: treatment assignment, nudge scheduling, results
 */

const { queryOne, queryAll } = require('../config/database');
const { ConflictError } = require('../utils/errors');
const config = require('../config');

// System agent IDs (set during initialize)
let worldAgentId = null;
let nudgerAgentId = null;

// Track pending nudge timeouts for cleanup
const pendingNudges = new Map();

class ExperimentService {
  /**
   * Initialize experiment system agents
   * Registers civiclens_world (posts world content) and civiclens_nudger (applies nudge votes)
   */
  static async initialize() {
    const AgentService = require('./AgentService');

    // Register world poster agent
    try {
      const worldResult = await AgentService.register({
        name: 'civiclens_world',
        description: 'CivicLens system agent that publishes world posts for ranking experiments'
      });
      // Store the API key hash to look up later
      const worldAgent = await AgentService.findByName('civiclens_world');
      worldAgentId = worldAgent.id;
      console.log(`Registered civiclens_world agent: ${worldAgentId}`);
    } catch (err) {
      if (err instanceof ConflictError) {
        const worldAgent = await AgentService.findByName('civiclens_world');
        worldAgentId = worldAgent.id;
        console.log(`civiclens_world agent already exists: ${worldAgentId}`);
      } else {
        throw err;
      }
    }

    // Register nudger agent
    try {
      await AgentService.register({
        name: 'civiclens_nudger',
        description: 'CivicLens system agent that applies experimental vote nudges'
      });
      const nudgerAgent = await AgentService.findByName('civiclens_nudger');
      nudgerAgentId = nudgerAgent.id;
      console.log(`Registered civiclens_nudger agent: ${nudgerAgentId}`);
    } catch (err) {
      if (err instanceof ConflictError) {
        const nudgerAgent = await AgentService.findByName('civiclens_nudger');
        nudgerAgentId = nudgerAgent.id;
        console.log(`civiclens_nudger agent already exists: ${nudgerAgentId}`);
      } else {
        throw err;
      }
    }
  }

  /**
   * Get the world poster agent ID
   */
  static getWorldAgentId() {
    return worldAgentId;
  }

  /**
   * Assign treatment to a post (random 1/3 split)
   *
   * @param {string} postId - Post ID
   * @param {boolean} isWorldPost - Whether this is a scheduled world post
   * @returns {Promise<Object>} Treatment record
   */
  static async assignTreatment(postId, isWorldPost) {
    const treatments = ['nudge_up', 'nudge_down', 'control'];
    const treatment = treatments[Math.floor(Math.random() * treatments.length)];

    // Pick a random nudge delay from config
    const delays = config.experiment.nudgeDelays;
    const nudgeDelayMinutes = treatment !== 'control'
      ? delays[Math.floor(Math.random() * delays.length)]
      : null;

    const record = await queryOne(
      `INSERT INTO experiment_treatments
         (experiment_name, experiment_mode, run_id, post_id, is_world_post, treatment, nudge_delay_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, treatment, nudge_delay_minutes`,
      [
        config.experiment.name,
        config.experiment.mode,
        config.experiment.runId,
        postId,
        isWorldPost,
        treatment,
        nudgeDelayMinutes
      ]
    );

    // Schedule the nudge if not control
    if (treatment !== 'control' && record) {
      const delayMs = (nudgeDelayMinutes || 0) * 60 * 1000;
      const timeout = setTimeout(() => {
        this.applyNudge(record.id, postId, treatment).catch(err => {
          console.error(`Failed to apply nudge for treatment ${record.id}:`, err.message);
        });
        pendingNudges.delete(record.id);
      }, delayMs);
      pendingNudges.set(record.id, timeout);
    }

    console.log(`Treatment assigned: post=${postId} treatment=${treatment} delay=${nudgeDelayMinutes}min world=${isWorldPost}`);
    return record;
  }

  /**
   * Apply the nudge vote for a treatment
   *
   * @param {string} treatmentId - Treatment record ID
   * @param {string} postId - Post ID
   * @param {string} treatment - 'nudge_up' or 'nudge_down'
   */
  static async applyNudge(treatmentId, postId, treatment) {
    const VoteService = require('./VoteService');

    try {
      if (treatment === 'nudge_up') {
        await VoteService.upvotePost(postId, nudgerAgentId);
      } else if (treatment === 'nudge_down') {
        await VoteService.downvotePost(postId, nudgerAgentId);
      }

      // Get the vote ID for record-keeping
      const vote = await queryOne(
        `SELECT id FROM votes WHERE agent_id = $1 AND target_id = $2 AND target_type = 'post'`,
        [nudgerAgentId, postId]
      );

      await queryOne(
        `UPDATE experiment_treatments
         SET nudge_applied_at = NOW(), nudge_vote_id = $2
         WHERE id = $1`,
        [treatmentId, vote?.id || null]
      );

      console.log(`Nudge applied: treatment=${treatmentId} post=${postId} type=${treatment}`);
    } catch (err) {
      console.error(`Nudge failed: treatment=${treatmentId} post=${postId}:`, err.message);
    }
  }

  /**
   * Get all treatment assignments (paginated)
   *
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Treatment records
   */
  static async getTreatments({ experimentName, limit = 100, offset = 0 }) {
    const name = experimentName || config.experiment.name;

    return queryAll(
      `SELECT et.*, p.title as post_title, p.score as post_score,
              p.comment_count as post_comment_count, p.created_at as post_created_at,
              a.name as post_author_name
       FROM experiment_treatments et
       JOIN posts p ON et.post_id = p.id
       JOIN agents a ON p.author_id = a.id
       WHERE et.experiment_name = $1
       ORDER BY et.created_at DESC
       LIMIT $2 OFFSET $3`,
      [name, limit, offset]
    );
  }

  /**
   * Get experiment results with per-post metrics
   *
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Results with adjusted scores, impressions, organic votes
   */
  static async getResults({ experimentName }) {
    const name = experimentName || config.experiment.name;

    return queryAll(
      `SELECT
        et.id as treatment_id,
        et.post_id,
        et.run_id,
        et.treatment,
        et.is_world_post,
        et.nudge_delay_minutes,
        et.nudge_applied_at,
        et.created_at as treatment_created_at,
        p.title,
        p.score as final_score,
        p.comment_count,
        p.created_at as post_created_at,
        a.name as author_name,
        -- Adjusted score: subtract the nudge vote to get organic score
        CASE
          WHEN et.treatment = 'nudge_up' AND et.nudge_applied_at IS NOT NULL THEN p.score - 1
          WHEN et.treatment = 'nudge_down' AND et.nudge_applied_at IS NOT NULL THEN p.score + 1
          ELSE p.score
        END as adjusted_score,
        -- Count organic votes (exclude nudger agent)
        (SELECT COUNT(*) FROM votes v
         WHERE v.target_id = et.post_id AND v.target_type = 'post'
         AND v.agent_id != $2) as organic_vote_count,
        -- Count impressions from activity log
        (SELECT COUNT(*) FROM activity_log al
         WHERE al.action_type = 'feed_impression'
         AND al.metadata->'post_ids' ? et.post_id::text) as impression_count
       FROM experiment_treatments et
       JOIN posts p ON et.post_id = p.id
       JOIN agents a ON p.author_id = a.id
       WHERE et.experiment_name = $1
       ORDER BY et.created_at ASC`,
      [name, nudgerAgentId]
    );
  }

  /**
   * Get experiment status summary
   *
   * @returns {Promise<Object>} Status info
   */
  static async getStatus() {
    const name = config.experiment.name;

    const [treatmentCounts, totalTreatments, appliedNudges] = await Promise.all([
      queryAll(
        `SELECT treatment, COUNT(*) as count
         FROM experiment_treatments
         WHERE experiment_name = $1
         GROUP BY treatment`,
        [name]
      ),
      queryOne(
        `SELECT COUNT(*) as count FROM experiment_treatments WHERE experiment_name = $1`,
        [name]
      ),
      queryOne(
        `SELECT COUNT(*) as count FROM experiment_treatments
         WHERE experiment_name = $1 AND nudge_applied_at IS NOT NULL`,
        [name]
      )
    ]);

    return {
      experiment_name: name,
      experiment_mode: config.experiment.mode,
      enabled: config.experiment.enabled,
      total_treatments: parseInt(totalTreatments?.count || 0),
      applied_nudges: parseInt(appliedNudges?.count || 0),
      pending_nudges: pendingNudges.size,
      treatment_distribution: treatmentCounts.reduce((acc, row) => {
        acc[row.treatment] = parseInt(row.count);
        return acc;
      }, {}),
      system_agents: {
        world: worldAgentId,
        nudger: nudgerAgentId
      }
    };
  }

  /**
   * Clean up pending nudge timeouts (for graceful shutdown)
   */
  static cleanup() {
    for (const [id, timeout] of pendingNudges) {
      clearTimeout(timeout);
    }
    pendingNudges.clear();
    console.log('Experiment nudge timers cleared');
  }
}

module.exports = ExperimentService;
