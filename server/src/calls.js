import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export function callRoutes({ app, db, io, peer, publicUser }) {
  const calls = new Map();
  function finish(call, reason = 'Cuộc gọi đã kết thúc.') {
    clearTimeout(call.timer);
    calls.delete(call.id);
    io.to(`user:${call.caller}`)
      .to(`user:${call.callee}`)
      .emit('call:ended', { callId: call.id, reason });
  }
  app.get('/api/calls/config', (_req, res) => {
    let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    if (process.env.WEBRTC_ICE_SERVERS) {
      try {
        iceServers = JSON.parse(process.env.WEBRTC_ICE_SERVERS);
      } catch {}
    }
    res.json({ iceServers });
  });
  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.on('call:ready', () => {
      for (const call of calls.values())
        if (call.callee === user.id && !call.accepted)
          socket.emit('call:incoming', {
            callId: call.id,
            caller: call.callerUser,
            video: call.video,
          });
    });
    const alive = async () =>
      Boolean(
        (
          await db.query('SELECT 1 FROM sessions WHERE token_hash=$1 AND expires_at>NOW()', [
            user.token_hash,
          ])
        ).rows.length,
      );
    socket.on('call:start', async (input, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        const { recipientId, video } = z
          .object({ recipientId: z.uuid(), video: z.boolean() })
          .parse(input);
        if (!(await alive()) || recipientId === user.id) throw Error('Không thể bắt đầu cuộc gọi.');
        await peer(user.id, recipientId);
        if (
          [...calls.values()].some(
            (c) =>
              [c.caller, c.callee].includes(user.id) || [c.caller, c.callee].includes(recipientId),
          )
        )
          throw Error('Một người đang bận trong cuộc gọi khác.');
        const receivers = [...io.of('/').sockets.values()].filter(
          (s) => s.data.user.id === recipientId,
        );
        if (!receivers.length) throw Error('Người nhận đang ngoại tuyến.');
        const call = {
          id: randomUUID(),
          caller: user.id,
          callerUser: publicUser(user),
          callee: recipientId,
          callerSocket: socket.id,
          calleeSocket: null,
          video,
          accepted: false,
        };
        call.timer = setTimeout(() => finish(call, 'Không có người trả lời.'), 45000);
        calls.set(call.id, call);
        io.to(`user:${recipientId}`).emit('call:incoming', {
          callId: call.id,
          caller: publicUser(user),
          video,
        });
        reply({ callId: call.id });
      } catch (e) {
        reply({ error: e.message || 'Không thể gọi lúc này.' });
      }
    });
    socket.on('call:accept', async (input, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        const { callId } = z.object({ callId: z.uuid() }).parse(input);
        const call = calls.get(callId);
        if (!call || call.callee !== user.id || call.accepted || !(await alive()))
          throw Error('Cuộc gọi không còn khả dụng.');
        await peer(call.caller, call.callee);
        clearTimeout(call.timer);
        call.accepted = true;
        call.calleeSocket = socket.id;
        // Bound abandoned calls even if both browser connections stay open.
        call.timer = setTimeout(() => finish(call, 'Đã đạt giới hạn 2 giờ.'), 7200000);
        io.to(`user:${call.callee}`)
          .except(socket.id)
          .emit('call:ended', { callId, reason: 'Đã trả lời trên thiết bị khác.' });
        io.to(call.callerSocket).emit('call:accepted', { callId });
        reply({ ok: true });
      } catch (e) {
        reply({ error: e.message });
      }
    });
    socket.on('call:signal', async (input) => {
      try {
        const data = z
          .object({
            callId: z.uuid(),
            description: z
              .object({ type: z.enum(['offer', 'answer']), sdp: z.string().max(50000) })
              .optional(),
            candidate: z
              .object({
                candidate: z.string().max(4000),
                sdpMid: z.string().nullable().optional(),
                sdpMLineIndex: z.number().nullable().optional(),
                usernameFragment: z.string().nullable().optional(),
              })
              .optional(),
          })
          .parse(input);
        const call = calls.get(data.callId);
        if (
          !call?.accepted ||
          ![call.callerSocket, call.calleeSocket].includes(socket.id) ||
          !(await alive())
        )
          return;
        await peer(call.caller, call.callee);
        io.to(socket.id === call.callerSocket ? call.calleeSocket : call.callerSocket).emit(
          'call:signal',
          data,
        );
      } catch {}
    });
    socket.on('call:end', (input) => {
      const parsed = z.object({ callId: z.uuid() }).safeParse(input);
      if (!parsed.success) return;
      const call = calls.get(parsed.data.callId);
      if (call && [call.caller, call.callee].includes(user.id)) finish(call);
    });
    socket.on('disconnect', () => {
      for (const call of calls.values())
        if ([call.callerSocket, call.calleeSocket].includes(socket.id))
          finish(call, 'Mất kết nối cuộc gọi.');
    });
  });
  io.on('close', () => {
    for (const call of calls.values()) clearTimeout(call.timer);
    calls.clear();
  });
}
