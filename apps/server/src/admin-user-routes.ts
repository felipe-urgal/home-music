import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AdminUserResult, AdminUsersService } from './admin-users.js';

function sendOperationError(reply: FastifyReply, result: Extract<AdminUserResult<unknown>, { ok: false }>) {
  switch (result.error) {
    case 'invalid-username':
      return reply.code(400).send({ error: 'Nome de usuário inválido.' });
    case 'invalid-role':
      return reply.code(400).send({ error: 'Papel de usuário inválido.' });
    case 'invalid-enabled':
      return reply.code(400).send({ error: 'Estado de usuário inválido.' });
    case 'duplicate-username':
      return reply.code(409).send({ error: 'Já existe um usuário com este nome.' });
    case 'not-found':
      return reply.code(404).send({ error: 'Usuário não encontrado.' });
    case 'self-management-not-allowed':
      return reply.code(409).send({ error: 'Esta operação não pode ser aplicada à própria conta pela API administrativa.' });
    case 'last-admin':
      return reply.code(409).send({ error: 'A operação deixaria o Home Music sem administrador ativo.' });
    case 'actor-no-longer-admin':
      return reply.code(403).send({ error: 'Acesso administrativo não está mais disponível para esta conta.' });
  }
}

function actorId(request: { user: { id: string } | null }) {
  if (!request.user) throw new Error('Rota administrativa executada sem identidade autenticada.');
  return request.user.id;
}

export function registerAdminUserRoutes(app: FastifyInstance, users: AdminUsersService) {
  app.get('/api/admin/users', { config: { auth: 'admin' } }, async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return { users: users.listUsers() };
  });

  app.post<{ Body: { username?: unknown; role?: unknown } }>('/api/admin/users', { config: { auth: 'admin' } }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const username = typeof request.body?.username === 'string' ? request.body.username : '';
    const result = await users.createUser(actorId(request), username, request.body?.role);
    if (!result.ok) return sendOperationError(reply, result);
    return reply.code(201).send(result.value);
  });

  app.patch<{ Params: { id: string }; Body: { username?: unknown; role?: unknown; enabled?: unknown } }>('/api/admin/users/:id', { config: { auth: 'admin' } }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const username = typeof request.body?.username === 'string' ? request.body.username : '';
    const result = users.updateUser(actorId(request), request.params.id, username, request.body?.role, request.body?.enabled);
    if (!result.ok) return sendOperationError(reply, result);
    return { user: result.value };
  });

  app.delete<{ Params: { id: string } }>('/api/admin/users/:id', { config: { auth: 'admin' } }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const result = users.deleteUser(actorId(request), request.params.id);
    if (!result.ok) return sendOperationError(reply, result);
    return result.value;
  });

  app.patch<{ Params: { id: string }; Body: { role?: unknown } }>('/api/admin/users/:id/role', { config: { auth: 'admin' } }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const result = users.setRole(actorId(request), request.params.id, request.body?.role);
    if (!result.ok) return sendOperationError(reply, result);
    return { user: result.value };
  });

  app.patch<{ Params: { id: string }; Body: { enabled?: unknown } }>('/api/admin/users/:id/enabled', { config: { auth: 'admin' } }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const result = users.setEnabled(actorId(request), request.params.id, request.body?.enabled);
    if (!result.ok) return sendOperationError(reply, result);
    return { user: result.value };
  });

  app.post<{ Params: { id: string } }>('/api/admin/users/:id/password-reset', { config: { auth: 'admin' } }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const result = await users.resetPassword(actorId(request), request.params.id);
    if (!result.ok) return sendOperationError(reply, result);
    return result.value;
  });

  app.post<{ Params: { id: string } }>('/api/admin/users/:id/sessions/revoke', { config: { auth: 'admin' } }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const result = users.revokeSessions(actorId(request), request.params.id);
    if (!result.ok) return sendOperationError(reply, result);
    return result.value;
  });
}
