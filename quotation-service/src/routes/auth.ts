import { Router } from 'express';
import { verifyUserCredentials, findUserById } from '../db.js';
import { signAuthToken } from '../auth/jwt.js';
import { requireAuth } from '../auth/middleware.js';

export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'email et password sont requis.' });
  }

  const user = verifyUserCredentials(String(email).trim().toLowerCase(), String(password));
  if (!user) {
    return res.status(401).json({ success: false, error: 'Email ou mot de passe incorrect.' });
  }

  const token = signAuthToken({ userId: user.id, email: user.email, role: user.role });
  return res.json({
    success: true,
    token,
    user: { id: user.id, email: user.email, role: user.role },
  });
});

authRouter.get('/me', requireAuth, (req, res) => {
  const user = findUserById(req.user!.userId);
  if (!user) {
    return res.status(404).json({ success: false, error: 'Utilisateur introuvable.' });
  }
  return res.json({ success: true, user: { id: user.id, email: user.email, role: user.role, createdAt: user.createdAt } });
});
