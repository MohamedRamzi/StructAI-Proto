import { Router } from 'express';
import { listUsers, findUserByEmail, findUserById, createUser, updateUser, deleteUser } from '../db.js';
import { requireAuth, requireRole } from '../auth/middleware.js';

export const usersRouter = Router();

usersRouter.use(requireAuth, requireRole('admin'));

usersRouter.get('/', (_req, res) => {
  return res.json({ success: true, users: listUsers() });
});

usersRouter.post('/', (req, res) => {
  const { email, password, role } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'email et password sont requis.' });
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedRole = role === 'admin' ? 'admin' : 'user';

  if (findUserByEmail(normalizedEmail)) {
    return res.status(409).json({ success: false, error: 'Un utilisateur avec cet email existe déjà.' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ success: false, error: 'Le mot de passe doit contenir au moins 8 caractères.' });
  }

  const user = createUser(normalizedEmail, String(password), normalizedRole);
  return res.status(201).json({ success: true, user: { id: user.id, email: user.email, role: user.role, createdAt: user.createdAt } });
});

function countAdmins(): number {
  return listUsers().filter((u) => u.role === 'admin').length;
}

usersRouter.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const target = findUserById(id);
  if (!target) {
    return res.status(404).json({ success: false, error: 'Utilisateur introuvable.' });
  }

  const { role, password } = req.body || {};
  if (role !== undefined && role !== 'admin' && role !== 'user') {
    return res.status(400).json({ success: false, error: 'role doit être "admin" ou "user".' });
  }
  if (target.role === 'admin' && role === 'user' && countAdmins() <= 1) {
    return res.status(400).json({ success: false, error: "Impossible de retirer le rôle admin du dernier administrateur." });
  }
  if (password !== undefined && String(password).length < 8) {
    return res.status(400).json({ success: false, error: 'Le mot de passe doit contenir au moins 8 caractères.' });
  }

  const updated = updateUser(id, { role, password });
  return res.json({ success: true, user: { id: updated!.id, email: updated!.email, role: updated!.role, createdAt: updated!.createdAt } });
});

usersRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const target = findUserById(id);
  if (!target) {
    return res.status(404).json({ success: false, error: 'Utilisateur introuvable.' });
  }
  if (req.user!.userId === id) {
    return res.status(400).json({ success: false, error: 'Vous ne pouvez pas supprimer votre propre compte.' });
  }
  if (target.role === 'admin' && countAdmins() <= 1) {
    return res.status(400).json({ success: false, error: 'Impossible de supprimer le dernier administrateur.' });
  }

  deleteUser(id);
  return res.status(204).send();
});
