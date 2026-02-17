/**
 * World Post Scheduler
 * Publishes pre-defined posts from a JSONL file on a timed interval
 * for CivicLens ranking-effect experiments
 */

const fs = require('fs');
const path = require('path');

class WorldPostScheduler {
  /**
   * @param {Object} options
   * @param {string} options.jsonlPath - Path to world-posts.jsonl
   * @param {number} options.intervalMs - Interval between posts in ms
   * @param {string} options.experimentName - Experiment name
   * @param {string} options.experimentMode - 'A' or 'B'
   */
  constructor({ jsonlPath, intervalMs, experimentName, experimentMode }) {
    this.jsonlPath = jsonlPath;
    this.intervalMs = intervalMs;
    this.experimentName = experimentName;
    this.experimentMode = experimentMode;
    this.queue = [];
    this.published = 0;
    this.timer = null;
    this.running = false;
  }

  /**
   * Load JSONL file into memory queue
   */
  load() {
    const resolvedPath = path.resolve(this.jsonlPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`World posts file not found: ${resolvedPath}`);
    }

    const content = fs.readFileSync(resolvedPath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());

    this.queue = lines.map((line, i) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        console.warn(`Skipping invalid JSONL line ${i + 1}: ${err.message}`);
        return null;
      }
    }).filter(Boolean);

    console.log(`Loaded ${this.queue.length} world posts from ${resolvedPath}`);
  }

  /**
   * Start the scheduler
   */
  async start() {
    this.load();

    if (this.queue.length === 0) {
      console.warn('No world posts to schedule');
      return;
    }

    this.running = true;
    console.log(`WorldPostScheduler started: ${this.queue.length} posts, interval=${this.intervalMs}ms`);

    // Publish first post immediately
    await this.publishNext();

    // Schedule remaining posts
    if (this.queue.length > 0) {
      this.timer = setInterval(async () => {
        await this.publishNext();
        if (this.queue.length === 0) {
          this.stop();
          console.log(`WorldPostScheduler finished: all ${this.published} posts published`);
        }
      }, this.intervalMs);
    }
  }

  /**
   * Publish the next post from the queue
   */
  async publishNext() {
    if (this.queue.length === 0) return;

    const PostService = require('./PostService');
    const ExperimentService = require('./ExperimentService');

    const postData = this.queue.shift();
    const worldAgentId = ExperimentService.getWorldAgentId();

    try {
      const post = await PostService.create({
        authorId: worldAgentId,
        submolt: postData.submolt || 'general',
        title: postData.title,
        content: postData.content,
        url: postData.url || undefined
      });

      this.published++;

      // Assign treatment to this world post
      await ExperimentService.assignTreatment(post.id, true);

      console.log(`World post ${this.published} published: "${postData.title.substring(0, 50)}..." (${this.queue.length} remaining)`);
    } catch (err) {
      console.error(`Failed to publish world post: ${err.message}`);
      // Don't re-queue; move on
    }
  }

  /**
   * Stop the scheduler
   */
  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      running: this.running,
      published: this.published,
      remaining: this.queue.length,
      total: this.published + this.queue.length,
      intervalMs: this.intervalMs
    };
  }
}

module.exports = WorldPostScheduler;
