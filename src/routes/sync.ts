import { Router, Request, Response } from 'express';
import { startSync, cancelSync } from '../workers/imap-worker';
import { getSyncLog } from '../services/supabase';

const router = Router();

// POST /api/sync - Start a new sync
router.post('/', async (req: Request, res: Response) => {
  try {
    const { accountId, dateFrom, dateTo } = req.body;
    
    const syncLogId = await startSync({
      accountId,
      dateFrom,
      dateTo,
    });
    
    res.json({
      syncLogId,
      status: 'started',
      message: 'Sync started successfully',
    });
  } catch (err: any) {
    console.error('Failed to start sync:', err);
    res.status(500).json({
      error: err.message || 'Failed to start sync',
    });
  }
});

// GET /api/sync/:id - Get sync status
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const syncLog = await getSyncLog(id);
    
    if (!syncLog) {
      return res.status(404).json({ error: 'Sync log not found' });
    }
    
    res.json(syncLog);
  } catch (err: any) {
    console.error('Failed to get sync status:', err);
    res.status(500).json({
      error: err.message || 'Failed to get sync status',
    });
  }
});

// POST /api/sync/:id/cancel - Cancel a running sync
router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const cancelled = cancelSync(id);
    
    if (cancelled) {
      res.json({ message: 'Sync cancellation requested' });
    } else {
      res.status(404).json({ error: 'No active sync found with this ID' });
    }
  } catch (err: any) {
    console.error('Failed to cancel sync:', err);
    res.status(500).json({
      error: err.message || 'Failed to cancel sync',
    });
  }
});

export default router;
