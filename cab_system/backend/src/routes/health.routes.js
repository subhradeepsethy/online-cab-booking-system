import { Router } from 'express';

const healthRouter = Router();

healthRouter.get('/', (_request, response) => {
  response.json({
    status: 'ok',
    service: 'cab-system-api',
    timestamp: new Date().toISOString(),
  });
});

export default healthRouter;
