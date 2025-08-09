import { NextRequest } from 'next/server';
import { Server as SocketIOServer } from 'socket.io';
import { Server as NetServer } from 'http';
import { SyncService } from '../../../lib/services/sync-service';

// Extend the global object to store the socket server
declare global {
  var io: SocketIOServer | undefined;
}

export async function GET(req: NextRequest) {
  if (!global.io) {
    console.log('Initializing Socket.io server...');
    
    // Create a mock HTTP server for Socket.io
    const httpServer = new NetServer();
    
    global.io = new SocketIOServer(httpServer, {
      cors: {
        origin: process.env.NODE_ENV === 'production' 
          ? process.env.NEXT_PUBLIC_APP_URL 
          : "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true
      },
      transports: ['websocket', 'polling'],
      pingTimeout: 60000,
      pingInterval: 25000,
      path: '/api/socket/io',
      // Connection retry configuration
      connectTimeout: 45000,
      // Allow reconnection
      allowEIO3: true
    });

    // Set up Socket.io event handlers
    setupSocketHandlers(global.io);
    
    console.log('Socket.io server initialized');
  }

  return new Response('Socket.io server running', { status: 200 });
}

function setupSocketHandlers(io: SocketIOServer) {
  const syncService = SyncService.getInstance();

  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    // Set up Yjs synchronization handlers
    syncService.handleWebSocketConnection(socket, io);

    // Handle room joining
    socket.on('join-room', async (data: { roomId: string; userId: string; userName?: string; userColor?: string }) => {
      try {
        const { roomId, userId, userName, userColor } = data;
        
        // Join the room
        await socket.join(roomId);
        
        // Store user info in socket
        socket.data.roomId = roomId;
        socket.data.userId = userId;
        socket.data.userName = userName;
        socket.data.userColor = userColor;
        
        // Initialize Yjs document for the room
        await syncService.initializeYjsDocument(roomId);
        
        // Get current room presence
        const presence = await syncService.getRoomPresence(roomId);
        
        // Notify other users in the room
        socket.to(roomId).emit('user-joined', {
          userId,
          userName,
          userColor,
          socketId: socket.id,
          timestamp: new Date().toISOString()
        });

        // Send confirmation to the joining user with current presence
        socket.emit('room-joined', {
          roomId,
          userId,
          socketId: socket.id,
          presence
        });

        console.log(`User ${userId} joined room ${roomId}`);
      } catch (error) {
        console.error('Error joining room:', error);
        socket.emit('error', { message: 'Failed to join room' });
      }
    });

    // Handle room leaving
    socket.on('leave-room', async (data: { roomId: string; userId: string }) => {
      try {
        const { roomId, userId } = data;
        
        await socket.leave(roomId);
        
        // Notify other users
        socket.to(roomId).emit('user-left', {
          userId,
          socketId: socket.id,
          timestamp: new Date().toISOString()
        });

        console.log(`User ${userId} left room ${roomId}`);
      } catch (error) {
        console.error('Error leaving room:', error);
      }
    });

    // Handle getting document content
    socket.on('get-document', async (data: { roomId: string }) => {
      try {
        const { roomId } = data;
        const content = await syncService.getDocumentContent(roomId);
        
        socket.emit('document-content', {
          roomId,
          content
        });
      } catch (error) {
        console.error('Error getting document content:', error);
        socket.emit('error', { message: 'Failed to get document content' });
      }
    });

    // Handle disconnection
    socket.on('disconnect', async () => {
      const { roomId, userId } = socket.data;
      
      if (roomId && userId) {
        try {
          // Update user presence to inactive
          const participantRepo = new (await import('../../../lib/repositories/participant-repository')).ParticipantRepository();
          await participantRepo.updatePresence(roomId, userId, false);
          
          // Notify other users in the room
          socket.to(roomId).emit('user-left', {
            userId,
            socketId: socket.id,
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          console.error('Error handling disconnect:', error);
        }
      }

      console.log(`Client disconnected: ${socket.id}`);
    });

    // Handle errors
    socket.on('error', (error) => {
      console.error(`Socket error for ${socket.id}:`, error);
      
      // Send error to client
      socket.emit('server-error', {
        message: 'Server error occurred',
        timestamp: new Date().toISOString()
      });
    });

    // Handle connection errors
    socket.on('connect_error', (error) => {
      console.error(`Connection error for ${socket.id}:`, error);
    });

    // Handle reconnection
    socket.on('reconnect', (attemptNumber) => {
      console.log(`Client ${socket.id} reconnected after ${attemptNumber} attempts`);
      
      // Re-join room if user was in one
      const { roomId, userId } = socket.data;
      if (roomId && userId) {
        socket.join(roomId);
        socket.to(roomId).emit('user-reconnected', {
          userId,
          socketId: socket.id,
          timestamp: new Date().toISOString()
        });
      }
    });

    // Handle ping/pong for connection health
    socket.on('ping', () => {
      socket.emit('pong');
    });

    // Handle client-side reconnection attempts
    socket.on('reconnect-attempt', () => {
      console.log(`Client ${socket.id} attempting to reconnect`);
    });

    // Handle reconnection success
    socket.on('reconnect-success', async (data: { roomId: string; userId: string }) => {
      try {
        const { roomId, userId } = data;
        
        // Re-join the room
        await socket.join(roomId);
        
        // Update socket data
        socket.data.roomId = roomId;
        socket.data.userId = userId;
        
        // Get current document content and presence
        const content = await syncService.getDocumentContent(roomId);
        const presence = await syncService.getRoomPresence(roomId);
        
        // Send current state to reconnected client
        socket.emit('reconnect-state', {
          roomId,
          content,
          presence
        });
        
        // Notify other users
        socket.to(roomId).emit('user-reconnected', {
          userId,
          socketId: socket.id,
          timestamp: new Date().toISOString()
        });
        
        console.log(`User ${userId} successfully reconnected to room ${roomId}`);
      } catch (error) {
        console.error('Error handling reconnection:', error);
        socket.emit('error', { message: 'Failed to reconnect to room' });
      }
    });
  });
}

// Export function to get the io instance
export function getSocketServer(): SocketIOServer | null {
  return global.io || null;
}