import * as Y from 'yjs';
import { Socket } from 'socket.io';
import { Server as SocketIOServer } from 'socket.io';
import { RoomRepository } from '../repositories/room-repository';
import { ParticipantRepository } from '../repositories/participant-repository';

export interface CursorPosition {
  lineNumber: number;
  column: number;
  userId: string;
  userName?: string;
  userColor?: string;
}

export interface UserPresence {
  userId: string;
  userName?: string;
  userColor?: string;
  cursor?: CursorPosition;
  isActive: boolean;
  lastSeen: Date;
}

export class SyncService {
  private static instance: SyncService;
  private yjsDocuments: Map<string, Y.Doc> = new Map();
  private roomRepository: RoomRepository;
  private participantRepository: ParticipantRepository;

  constructor() {
    this.roomRepository = new RoomRepository();
    this.participantRepository = new ParticipantRepository();
  }

  static getInstance(): SyncService {
    if (!SyncService.instance) {
      SyncService.instance = new SyncService();
    }
    return SyncService.instance;
  }

  /**
   * Initialize or get existing Yjs document for a room
   */
  async initializeYjsDocument(roomId: string): Promise<Y.Doc> {
    if (this.yjsDocuments.has(roomId)) {
      return this.yjsDocuments.get(roomId)!;
    }

    const ydoc = new Y.Doc();
    
    // Create a shared text type for the code content
    const ytext = ydoc.getText('code');
    
    // Try to restore document state from database
    try {
      const room = await this.roomRepository.findById(roomId);
      if (room?.yjsState) {
        // Apply the stored state to the document
        Y.applyUpdate(ydoc, room.yjsState);
      } else if (room?.codeSnapshot) {
        // If no Yjs state but we have a code snapshot, initialize with that
        ytext.insert(0, room.codeSnapshot);
      }
    } catch (error) {
      console.error(`Failed to restore Yjs document for room ${roomId}:`, error);
    }

    // Set up document change listener for persistence
    ydoc.on('update', async (update: Uint8Array) => {
      try {
        await this.persistSnapshot(roomId, ytext.toString(), update);
      } catch (error) {
        console.error(`Failed to persist snapshot for room ${roomId}:`, error);
      }
    });

    this.yjsDocuments.set(roomId, ydoc);
    return ydoc;
  }

  /**
   * Handle WebSocket connection for Yjs synchronization
   */
  handleWebSocketConnection(socket: Socket, io: SocketIOServer): void {
    // Handle Yjs document synchronization
    socket.on('yjs-sync-step1', async (data: { roomId: string; update: Uint8Array }) => {
      try {
        const { roomId, update } = data;
        const ydoc = await this.initializeYjsDocument(roomId);
        
        // Apply the update to the document
        Y.applyUpdate(ydoc, new Uint8Array(update));
        
        // Broadcast the update to other clients in the room
        socket.to(roomId).emit('yjs-sync-step2', {
          roomId,
          update: Array.from(update)
        });
      } catch (error) {
        console.error('Error handling Yjs sync step 1:', error);
        socket.emit('yjs-error', { message: 'Failed to sync document' });
      }
    });

    socket.on('yjs-sync-step2', async (data: { roomId: string }) => {
      try {
        const { roomId } = data;
        const ydoc = await this.initializeYjsDocument(roomId);
        
        // Send the current document state to the requesting client
        const stateVector = Y.encodeStateVector(ydoc);
        const update = Y.encodeStateAsUpdate(ydoc, stateVector);
        
        socket.emit('yjs-sync-step3', {
          roomId,
          update: Array.from(update)
        });
      } catch (error) {
        console.error('Error handling Yjs sync step 2:', error);
        socket.emit('yjs-error', { message: 'Failed to get document state' });
      }
    });

    socket.on('yjs-update', async (data: { roomId: string; update: Uint8Array }) => {
      try {
        const { roomId, update } = data;
        const ydoc = await this.initializeYjsDocument(roomId);
        
        // Apply the update to the document
        Y.applyUpdate(ydoc, new Uint8Array(update));
        
        // Broadcast the update to other clients in the room (excluding sender)
        socket.to(roomId).emit('yjs-update', {
          roomId,
          update: Array.from(update)
        });
      } catch (error) {
        console.error('Error handling Yjs update:', error);
        socket.emit('yjs-error', { message: 'Failed to apply document update' });
      }
    });

    // Handle cursor position updates
    socket.on('cursor-update', async (data: { roomId: string; cursor: CursorPosition }) => {
      try {
        const { roomId, cursor } = data;
        
        // Update cursor position in database
        await this.updateCursorPosition(roomId, cursor);
        
        // Broadcast cursor update to other clients in the room
        socket.to(roomId).emit('cursor-update', {
          roomId,
          cursor
        });
      } catch (error) {
        console.error('Error handling cursor update:', error);
      }
    });

    // Handle user presence updates
    socket.on('presence-update', async (data: { roomId: string; presence: UserPresence }) => {
      try {
        const { roomId, presence } = data;
        
        // Update user presence in database
        await this.updateUserPresence(roomId, presence);
        
        // Broadcast presence update to other clients in the room
        socket.to(roomId).emit('presence-update', {
          roomId,
          presence
        });
      } catch (error) {
        console.error('Error handling presence update:', error);
      }
    });
  }

  /**
   * Broadcast cursor position update to all clients in a room
   */
  async broadcastCursorUpdate(
    io: SocketIOServer,
    roomId: string, 
    userId: string, 
    cursor: CursorPosition
  ): Promise<void> {
    try {
      // Update cursor position in database
      await this.updateCursorPosition(roomId, cursor);
      
      // Broadcast to all clients in the room
      io.to(roomId).emit('cursor-update', {
        roomId,
        cursor
      });
    } catch (error) {
      console.error('Error broadcasting cursor update:', error);
    }
  }

  /**
   * Persist document snapshot to database
   */
  async persistSnapshot(roomId: string, content: string, yjsState?: Uint8Array): Promise<void> {
    try {
      await this.roomRepository.updateSnapshot(roomId, content, yjsState);
    } catch (error) {
      console.error(`Failed to persist snapshot for room ${roomId}:`, error);
      throw error;
    }
  }

  /**
   * Update cursor position in database
   */
  private async updateCursorPosition(roomId: string, cursor: CursorPosition): Promise<void> {
    try {
      await this.participantRepository.updateCursorPosition(
        roomId,
        cursor.userId,
        {
          lineNumber: cursor.lineNumber,
          column: cursor.column
        }
      );
    } catch (error) {
      console.error('Failed to update cursor position:', error);
    }
  }

  /**
   * Update user presence in database
   */
  private async updateUserPresence(roomId: string, presence: UserPresence): Promise<void> {
    try {
      await this.participantRepository.updatePresence(
        roomId,
        presence.userId,
        presence.isActive
      );
    } catch (error) {
      console.error('Failed to update user presence:', error);
    }
  }

  /**
   * Get current document content for a room
   */
  async getDocumentContent(roomId: string): Promise<string> {
    try {
      const ydoc = await this.initializeYjsDocument(roomId);
      const ytext = ydoc.getText('code');
      return ytext.toString();
    } catch (error) {
      console.error(`Failed to get document content for room ${roomId}:`, error);
      return '';
    }
  }

  /**
   * Get all active users in a room
   */
  async getRoomPresence(roomId: string): Promise<UserPresence[]> {
    try {
      const participants = await this.participantRepository.findActiveByRoomId(roomId);
      return participants.map(participant => ({
        userId: participant.userId,
        userName: participant.userId, // TODO: Add actual user names
        userColor: participant.userColor || '#000000',
        cursor: participant.cursorPosition as CursorPosition | undefined,
        isActive: participant.isActive,
        lastSeen: participant.lastSeen
      }));
    } catch (error) {
      console.error(`Failed to get room presence for room ${roomId}:`, error);
      return [];
    }
  }

  /**
   * Clean up resources for a room
   */
  cleanupRoom(roomId: string): void {
    const ydoc = this.yjsDocuments.get(roomId);
    if (ydoc) {
      ydoc.destroy();
      this.yjsDocuments.delete(roomId);
    }
  }
}