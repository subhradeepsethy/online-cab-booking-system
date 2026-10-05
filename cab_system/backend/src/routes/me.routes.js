import { Router } from 'express';
import { publicUser, removeSavedPlace, setSavedPlace } from '../lib/users.js';
import { requireAuth } from '../middleware/auth.js';

const meRouter = Router();

meRouter.put('/places/:label', requireAuth('customer'), (request, response) => {
  setSavedPlace(request.user, request.params.label, request.body);
  response.json({ user: publicUser(request.user) });
});

meRouter.delete('/places/:label', requireAuth('customer'), (request, response) => {
  removeSavedPlace(request.user, request.params.label);
  response.json({ user: publicUser(request.user) });
});

export default meRouter;
