const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 5e6
});

const PORT = process.env.PORT || 3000;
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));
app.use(express.json({ limit: '6mb' }));

const users = new Map();
const onlineByName = new Map();
const messages = new Map();
const rooms = new Map();

rooms.set('general', {
  id: 'general', name: 'Chat général', type: 'public',
  description: 'Tout le monde peut écrire ici', members: new Set(), createdBy: 'system'
});
rooms.set('channel-annonces', {
  id: 'channel-annonces', name: 'Annonces', type: 'channel',
  description: 'Canal d\'annonces', members: new Set(), createdBy: 'system'
});

function getAvatar(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return `https://i.pravatar.cc/100?img=${Math.abs(hash % 70) + 1}`;
}
function getRoomMessages(roomId) {
  if (!messages.has(roomId)) messages.set(roomId, []);
  return messages.get(roomId);
}
function publicUser(u) {
  return { username: u.username, avatar: u.avatar, status: u.status };
}

io.on('connection', (socket) => {
  socket.on('join', ({ username }) => {
    if (!username || username.trim().length < 2) {
      socket.emit('error', { message: 'Pseudo trop court (min 2 caractères)' });
      return;
    }
    const name = username.trim().slice(0, 20);
    if (onlineByName.has(name)) {
      const oldId = onlineByName.get(name);
      const old = io.sockets.sockets.get(oldId);
      if (old) { old.emit('kicked', { reason: 'Connecté depuis un autre appareil' }); old.disconnect(true); }
    }
    const user = { id: socket.id, username: name, avatar: getAvatar(name), status: 'online', currentRoom: 'general' };
    users.set(socket.id, user);
    onlineByName.set(name, socket.id);
    socket.join('general');
    rooms.get('general').members.add(name);
    socket.join('channel-annonces');
    rooms.get('channel-annonces').members.add(name);

    const myRooms = [
      { id: 'general', name: 'Chat général', type: 'public', unread: 0 },
      { id: 'channel-annonces', name: 'Annonces', type: 'channel', unread: 0 }
    ];
    for (const [rid, room] of rooms) {
      if (room.type === 'private' && room.members.has(name)) {
        const other = [...room.members].find(m => m !== name);
        myRooms.push({ id: rid, name: other || rid, type: 'private', unread: 0 });
      }
      if (room.type === 'group' && room.members.has(name)) {
        myRooms.push({ id: rid, name: room.name, type: 'group', unread: 0 });
      }
    }

    socket.emit('welcome', {
      user: publicUser(user),
      online: Array.from(users.values()).map(publicUser),
      rooms: myRooms,
      messages: getRoomMessages('general').slice(-80)
    });
    socket.broadcast.emit('user-joined', {
      user: publicUser(user),
      online: Array.from(users.values()).map(publicUser)
    });
  });

  socket.on('join-room', ({ roomId }) => {
    const user = users.get(socket.id);
    if (!user) return;
    const room = rooms.get(roomId);
    if (!room) { socket.emit('error', { message: 'Salon introuvable' }); return; }
    if (user.currentRoom) socket.leave(user.currentRoom);
    user.currentRoom = roomId;
    socket.join(roomId);
    socket.emit('room-history', {
      roomId,
      messages: getRoomMessages(roomId).slice(-100),
      room: { id: room.id, name: room.name, type: room.type, description: room.description || '' }
    });
  });

  socket.on('start-dm', ({ targetUsername }) => {
    const user = users.get(socket.id);
    if (!user || !targetUsername || targetUsername === user.username) return;
    const ids = [user.username, targetUsername].sort();
    const roomId = 'dm-' + ids.join('-');
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        id: roomId, name: targetUsername, type: 'private',
        members: new Set([user.username, targetUsername]), createdBy: user.username
      });
    }
    socket.join(roomId);
    user.currentRoom = roomId;
    const targetSocketId = onlineByName.get(targetUsername);
    if (targetSocketId) {
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.join(roomId);
        targetSocket.emit('new-room', { id: roomId, name: user.username, type: 'private' });
      }
    }
    socket.emit('room-history', {
      roomId, messages: getRoomMessages(roomId).slice(-100),
      room: { id: roomId, name: targetUsername, type: 'private' }
    });
    socket.emit('new-room', { id: roomId, name: targetUsername, type: 'private' });
  });

  socket.on('create-group', ({ name, members = [] }) => {
    const user = users.get(socket.id);
    if (!user || !name) return;
    const roomId = 'group-' + Date.now().toString(36);
    const memberSet = new Set([user.username, ...members.filter(m => m !== user.username)]);
    rooms.set(roomId, {
      id: roomId, name: name.slice(0, 40), type: 'group',
      members: memberSet, createdBy: user.username
    });
    socket.join(roomId);
    user.currentRoom = roomId;
    for (const m of memberSet) {
      const sid = onlineByName.get(m);
      if (sid) {
        const s = io.sockets.sockets.get(sid);
        if (s) { s.join(roomId); s.emit('new-room', { id: roomId, name, type: 'group' }); }
      }
    }
    socket.emit('room-history', { roomId, messages: [], room: { id: roomId, name, type: 'group' } });
  });

  socket.on('message', (data) => {
    const user = users.get(socket.id);
    if (!user) return;
    const roomId = data.roomId || user.currentRoom || 'general';
    const room = rooms.get(roomId);
    if (!room) return;
    const msg = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      text: String(data.text || '').slice(0, 2000),
      username: user.username, avatar: user.avatar,
      time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      timestamp: Date.now(), roomId,
      type: data.type || 'text',
      fileUrl: data.fileUrl || null,
      fileName: data.fileName || null
    };
    if (!msg.text.trim() && !msg.fileUrl) return;
    const list = getRoomMessages(roomId);
    list.push(msg);
    if (list.length > 300) list.shift();
    io.to(roomId).emit('message', msg);
  });

  socket.on('upload', (data) => {
    const user = users.get(socket.id);
    if (!user || !data.data || !data.name) return;
    if (data.data.length > 5500000) {
      socket.emit('error', { message: 'Fichier trop volumineux (max ~4 Mo)' });
      return;
    }
    const ext = (data.name.split('.').pop() || 'bin').toLowerCase();
    const allowed = ['jpg','jpeg','png','gif','webp','pdf','mp4','webm','mp3','ogg','txt','zip'];
    if (!allowed.includes(ext)) {
      socket.emit('error', { message: 'Type de fichier non autorisé' });
      return;
    }
    const filename = Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '.' + ext;
    const filepath = path.join(uploadsDir, filename);
    try {
      const base64 = data.data.replace(/^data:[^;]+;base64,/, '');
      fs.writeFileSync(filepath, Buffer.from(base64, 'base64'));
      socket.emit('upload-success', {
        fileUrl: '/uploads/' + filename,
        fileName: data.name,
        type: ['jpg','jpeg','png','gif','webp'].includes(ext) ? 'image' :
              ['mp4','webm'].includes(ext) ? 'video' : 'file'
      });
    } catch (e) {
      socket.emit('error', { message: 'Erreur upload' });
    }
  });

  socket.on('typing', ({ roomId }) => {
    const user = users.get(socket.id);
    if (user) socket.to(roomId || user.currentRoom).emit('typing', { username: user.username, roomId: roomId || user.currentRoom });
  });
  socket.on('stop-typing', ({ roomId }) => {
    const user = users.get(socket.id);
    if (user) socket.to(roomId || user.currentRoom).emit('stop-typing', { username: user.username, roomId: roomId || user.currentRoom });
  });

  // WebRTC signaling
  socket.on('call-user', ({ targetUsername, offer, callType }) => {
    const user = users.get(socket.id);
    const targetId = onlineByName.get(targetUsername);
    if (!user || !targetId) { socket.emit('call-error', { message: 'Utilisateur hors ligne' }); return; }
    io.to(targetId).emit('incoming-call', {
      from: user.username, fromAvatar: user.avatar, offer, callType: callType || 'video'
    });
  });
  socket.on('answer-call', ({ targetUsername, answer }) => {
    const targetId = onlineByName.get(targetUsername);
    if (targetId) io.to(targetId).emit('call-answered', { answer });
  });
  socket.on('ice-candidate', ({ targetUsername, candidate }) => {
    const targetId = onlineByName.get(targetUsername);
    if (targetId) io.to(targetId).emit('ice-candidate', { candidate });
  });
  socket.on('end-call', ({ targetUsername }) => {
    const targetId = onlineByName.get(targetUsername);
    if (targetId) io.to(targetId).emit('call-ended');
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      users.delete(socket.id);
      if (onlineByName.get(user.username) === socket.id) onlineByName.delete(user.username);
      io.emit('user-left', { username: user.username, online: Array.from(users.values()).map(publicUser) });
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('ARCANE Messenger running on port', PORT);
});
