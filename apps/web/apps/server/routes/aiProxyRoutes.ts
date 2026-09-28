import express, { Request, Response, Router } from 'express';

const router: Router = express.Router();

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8000';

/**
 * Helper to proxy HTTP requests directly to Python AI backend
 */
async function proxyToPython(req: Request, res: Response, targetPath: string) {
  const targetUrl = `${PYTHON_BACKEND_URL}${targetPath}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (req.headers['x-forwarded-for']) {
      headers['x-forwarded-for'] = req.headers['x-forwarded-for'] as string;
    }

    const fetchOptions: RequestInit = {
      method: req.method,
      headers,
      signal: controller.signal,
    };

    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, fetchOptions);
    clearTimeout(timeout);

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await response.json();
      return res.status(response.status).json(data);
    } else {
      const text = await response.text();
      return res.status(response.status).send(text);
    }
  } catch (error: any) {
    console.error(`[AI Proxy] Failed to proxy request to ${targetUrl}:`, error.message);
    return res.status(502).json({
      success: false,
      message: 'AI backend service is temporarily unavailable. Please try again.',
      error: error.message,
    });
  }
}

// Mobile Face Recognition Endpoints
router.all('/face/detect', (req: Request, res: Response) => proxyToPython(req, res, '/api/face/detect'));
router.all('/face/check-duplicate', (req: Request, res: Response) => proxyToPython(req, res, '/api/face/check-duplicate'));
router.all('/face/verify', (req: Request, res: Response) => proxyToPython(req, res, '/api/face/verify'));
router.all('/face/verify-active-liveness', (req: Request, res: Response) => proxyToPython(req, res, '/api/face/verify-active-liveness'));
router.all('/face/live-stream/evaluate-frame', (req: Request, res: Response) => proxyToPython(req, res, '/api/face/live-stream/evaluate-frame'));
router.all('/face/register', (req: Request, res: Response) => proxyToPython(req, res, '/api/face/register'));
router.all('/face/registered-users', (req: Request, res: Response) => proxyToPython(req, res, '/api/face/registered-users'));
router.all('/face/residents', (req: Request, res: Response) => proxyToPython(req, res, '/api/face/residents'));
router.all('/face/registration-logs', (req: Request, res: Response) => proxyToPython(req, res, '/api/face/registration-logs'));
router.all('/face/clear-all', (req: Request, res: Response) => proxyToPython(req, res, '/api/face/clear-all'));
router.all('/face/user/:id', (req: Request, res: Response) => proxyToPython(req, res, `/api/face/user/${req.params.id}`));

// ID OCR Endpoint
router.all('/id/verify-document', (req: Request, res: Response) => proxyToPython(req, res, '/api/id/verify-document'));

export default router;
