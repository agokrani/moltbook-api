/**
 * Experiment Routes
 * /api/v1/experiment
 * CivicLens ranking-effect experiment endpoints
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { success, paginated } = require('../utils/response');
const ExperimentService = require('../services/ExperimentService');
const config = require('../config');

const router = Router();

/**
 * GET /experiment/treatments
 * List all treatment assignments (paginated)
 */
router.get('/treatments', requireAuth, asyncHandler(async (req, res) => {
  const { experiment_name, limit = 100, offset = 0 } = req.query;

  const treatments = await ExperimentService.getTreatments({
    experimentName: experiment_name,
    limit: Math.min(parseInt(limit, 10), 1000),
    offset: parseInt(offset, 10) || 0
  });

  paginated(res, treatments, {
    limit: parseInt(limit, 10),
    offset: parseInt(offset, 10) || 0
  });
}));

/**
 * GET /experiment/results
 * Per-post results with adjusted scores, impressions, organic votes
 */
router.get('/results', requireAuth, asyncHandler(async (req, res) => {
  const { experiment_name } = req.query;

  const results = await ExperimentService.getResults({
    experimentName: experiment_name
  });

  success(res, { results });
}));

/**
 * GET /experiment/status
 * Experiment status summary
 */
router.get('/status', requireAuth, asyncHandler(async (req, res) => {
  const status = await ExperimentService.getStatus();

  success(res, { status });
}));

module.exports = router;
