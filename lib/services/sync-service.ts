import * as Y from 'yjs';
import { Socket } from 'socket.io';
import { Server as SocketIOServer } from 'socket.io';
import { RoomRepository } from '../repositories/room-repository';
import { ParticipantRepository } from '../repositories/participant-repository';
import { RoomSnapshotRepository } from '../repositories/room-snapshot-repository';
import { SnapshotType } from '../types/database';

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

export interface YjsDocumentConfig {
  maxHistorySize?: number;
  snapshotThreshold?: number;
  autoSnapshotInterval?: number;
}

export interface DocumentIntegrityResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export class SyncService {
  private static instance: SyncService;
  private yjsDocuments: Map<string, Y.Doc> = new Map();
  private roomRepository: RoomRepository;
  private participantRepository: ParticipantRepository;
  private snapshotTimers: Map<string, NodeJS.Timeout> = new Map();
  private pendingSnapshots: Map<string, boolean> = new Map();
  
  // Configuration for Yjs documents
  private readonly defaultConfig: YjsDocumentConfig = {
    maxHistorySize: 1000,
    snapshotThreshold: 100, // Create snapshot after 100 operations
    autoSnapshotInterval: 30000, // 30 seconds
  };

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
   * Initialize or get existing Yjs document for a room with proper configuration
   */
  async initializeYjsDocument(roomId: string, config?: YjsDocumentConfig): Promise<Y.Doc> {
    if (this.yjsDocuments.has(roomId)) {
      return this.yjsDocuments.get(roomId)!;
    }

    const finalConfig = { ...this.defaultConfig, ...config };
    const ydoc = new Y.Doc();
    
    // Configure document options for better performance and conflict resolution
    ydoc.gc = true; // Enable garbage collection
    
    // Create a shared text type for the code content
    const ytext = ydoc.getText('code');
    
    // Try to restore document state from database
    try {
      await this.restoreDocumentFromDatabase(ydoc, roomId);
    } catch (error) {
      console.error(`Failed to restore Yjs document for room ${roomId}:`, error);
    }

    // Set up document change listener for persistence with throttling
    let operationCount = 0;
    ydoc.on('update', async (update: Uint8Array, origin: unknown) => {
      try {
        operationCount++;
        
        // Immediate persistence for critical updates
        if (origin === 'critical') {
          await this.persistSnapshot(roomId, ytext.toString(), update);
          return;
        }
        
        // Throttled persistence for regular updates
        await this.throttledPersistSnapshot(roomId, ytext.toString(), update, finalConfig);
        
        // Create snapshot after threshold operations
        if (operationCount >= finalConfig.snapshotThreshold!) {
          await this.createSnapshot(roomId, ytext.toString(), Y.encodeStateAsUpdate(ydoc), SnapshotType.AUTO);
          operationCount = 0;
        }
      } catch (error) {
        console.error(`Failed to persist snapshot for room ${roomId}:`, error);
      }
    });

    // Set up automatic snapshot creation
    this.setupAutoSnapshot(roomId, finalConfig.autoSnapshotInterval!);

    this.yjsDocuments.set(roomId, ydoc);
    return ydoc;
  }

  /**
   * Handle WebSocket connection for Yjs synchronization with enhanced conflict resolution
   */
  handleWebSocketConnection(socket: Socket, io: SocketIOServer): void {
    // Handle Yjs document synchronization - Step 1: Client sends sync request
    socket.on('yjs-sync-step1', async (data: { roomId: string; stateVector?: Uint8Array }) => {
      try {
        const { roomId, stateVector } = data;
        const ydoc = await this.initializeYjsDocument(roomId);
        
        // Create update based on client's state vector
        const clientStateVector = stateVector ? new Uint8Array(stateVector) : new Uint8Array();
        const update = Y.encodeStateAsUpdate(ydoc, clientStateVector);
        
        // Send the update to the requesting client
        socket.emit('yjs-sync-step2', {
          roomId,
          update: Array.from(update)
        });
      } catch (error) {
        console.error('Error handling Yjs sync step 1:', error);
        socket.emit('yjs-error', { 
          message: 'Failed to sync document',
          code: 'SYNC_STEP1_ERROR'
        });
      }
    });

    // Handle client's state vector request
    socket.on('yjs-sync-request', async (data: { roomId: string }) => {
      try {
        const { roomId } = data;
        const ydoc = await this.initializeYjsDocument(roomId);
        
        // Send the current document state to the requesting client
        const stateVector = Y.encodeStateVector(ydoc);
        const update = Y.encodeStateAsUpdate(ydoc);
        
        socket.emit('yjs-sync-response', {
          roomId,
          stateVector: Array.from(stateVector),
          update: Array.from(update)
        });
      } catch (error) {
        console.error('Error handling Yjs sync request:', error);
        socket.emit('yjs-error', { 
          message: 'Failed to get document state',
          code: 'SYNC_REQUEST_ERROR'
        });
      }
    });

    // Handle document updates with conflict resolution
    socket.on('yjs-update', async (data: { roomId: string; update: Uint8Array; origin?: string }) => {
      try {
        const { roomId, update, origin } = data;
        const ydoc = await this.initializeYjsDocument(roomId);
        
        // Validate update before applying
        const updateArray = new Uint8Array(update);
        if (!this.isValidUpdate(updateArray)) {
          socket.emit('yjs-error', { 
            message: 'Invalid update format',
            code: 'INVALID_UPDATE'
          });
          return;
        }
        
        // Apply the update to the document with conflict resolution
        try {
          Y.applyUpdate(ydoc, updateArray, origin);
        } catch (applyError) {
          console.error('Failed to apply update, attempting conflict resolution:', applyError);
          
          // Attempt conflict resolution by creating a backup and resyncing
          await this.resolveConflict(roomId, updateArray, socket);
          return;
        }
        
        // Broadcast the update to other clients in the room (excluding sender)
        socket.to(roomId).emit('yjs-update', {
          roomId,
          update: Array.from(updateArray),
          origin
        });
        
        // Validate document integrity after update
        const validation = await this.validateDocumentIntegrity(ydoc, roomId);
        if (!validation.isValid) {
          console.warn(`Document integrity issues after update for room ${roomId}:`, validation.errors);
          // Notify clients about potential issues
          io.to(roomId).emit('yjs-warning', {
            message: 'Document integrity warning',
            warnings: validation.warnings
          });
        }
        
      } catch (error) {
        console.error('Error handling Yjs update:', error);
        socket.emit('yjs-error', { 
          message: 'Failed to apply document update',
          code: 'UPDATE_ERROR'
        });
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
   * Restore Yjs document from database snapshots
   */
  private async restoreDocumentFromDatabase(ydoc: Y.Doc, roomId: string): Promise<void> {
    const room = await this.roomRepository.findById(roomId);
    
    if (room?.yjsState) {
      // First, try to restore from the room's Yjs state
      try {
        Y.applyUpdate(ydoc, room.yjsState);
        
        // Validate the restored document
        const validation = await this.validateDocumentIntegrity(ydoc, roomId);
        if (!validation.isValid) {
          console.warn(`Document integrity issues for room ${roomId}:`, validation.errors);
          // Fall back to snapshot restoration if validation fails
          await this.restoreFromLatestSnapshot(ydoc, roomId);
        }
      } catch (error) {
        console.error(`Failed to apply Yjs state for room ${roomId}:`, error);
        await this.restoreFromLatestSnapshot(ydoc, roomId);
      }
    } else {
      // Fall back to snapshot restoration
      await this.restoreFromLatestSnapshot(ydoc, roomId);
    }
  }

  /**
   * Restore document from the latest snapshot
   */
  private async restoreFromLatestSnapshot(ydoc: Y.Doc, roomId: string): Promise<void> {
    try {
      const latestSnapshot = await RoomSnapshotRepository.findLatestByRoom(roomId);
      
      if (latestSnapshot) {
        if (latestSnapshot.yjsState) {
          // Try to restore from snapshot's Yjs state
          Y.applyUpdate(ydoc, latestSnapshot.yjsState);
        } else if (latestSnapshot.content) {
          // Fall back to text content
          const ytext = ydoc.getText('code');
          ytext.insert(0, latestSnapshot.content);
        }
      } else {
        // Check if room has a code snapshot as final fallback
        const room = await this.roomRepository.findById(roomId);
        if (room?.codeSnapshot) {
          const ytext = ydoc.getText('code');
          ytext.insert(0, room.codeSnapshot);
        }
      }
    } catch (error) {
      console.error(`Failed to restore from snapshot for room ${roomId}:`, error);
    }
  }

  /**
   * Throttled persistence to avoid excessive database writes
   */
  private async throttledPersistSnapshot(
    roomId: string, 
    content: string, 
    yjsState: Uint8Array,
    _config: YjsDocumentConfig
  ): Promise<void> {
    // Skip if already pending
    if (this.pendingSnapshots.get(roomId)) {
      return;
    }

    this.pendingSnapshots.set(roomId, true);

    // Debounce the persistence
    setTimeout(async () => {
      try {
        await this.persistSnapshot(roomId, content, yjsState);
      } catch (error) {
        console.error(`Throttled persist failed for room ${roomId}:`, error);
      } finally {
        this.pendingSnapshots.set(roomId, false);
      }
    }, 1000); // 1 second debounce
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
   * Create a formal snapshot in the snapshots table
   */
  async createSnapshot(
    roomId: string, 
    content: string, 
    yjsState: Uint8Array, 
    type: SnapshotType = SnapshotType.AUTO
  ): Promise<void> {
    try {
      const yjsBuffer = Buffer.from(yjsState);
      
      switch (type) {
        case SnapshotType.AUTO:
          await RoomSnapshotRepository.createAutoSnapshot(roomId, content, yjsBuffer);
          break;
        case SnapshotType.MANUAL:
          await RoomSnapshotRepository.createManualSnapshot(roomId, content, yjsBuffer);
          break;
        case SnapshotType.BACKUP:
          await RoomSnapshotRepository.createBackupSnapshot(roomId, content, yjsBuffer);
          break;
      }

      // Clean up old snapshots to prevent database bloat
      await RoomSnapshotRepository.deleteOldSnapshots(roomId, 20);
    } catch (error) {
      console.error(`Failed to create snapshot for room ${roomId}:`, error);
      throw error;
    }
  }

  /**
   * Set up automatic snapshot creation
   */
  private setupAutoSnapshot(roomId: string, interval: number): void {
    // Clear existing timer if any
    const existingTimer = this.snapshotTimers.get(roomId);
    if (existingTimer) {
      clearInterval(existingTimer);
    }

    // Set up new timer
    const timer = setInterval(async () => {
      try {
        const ydoc = this.yjsDocuments.get(roomId);
        if (ydoc) {
          const ytext = ydoc.getText('code');
          const content = ytext.toString();
          const yjsState = Y.encodeStateAsUpdate(ydoc);
          
          // Only create snapshot if there's actual content
          if (content.trim().length > 0) {
            await this.createSnapshot(roomId, content, yjsState, SnapshotType.AUTO);
          }
        }
      } catch (error) {
        console.error(`Auto snapshot failed for room ${roomId}:`, error);
      }
    }, interval);

    this.snapshotTimers.set(roomId, timer);
  }

  /**
   * Validate document integrity and detect potential conflicts
   */
  async validateDocumentIntegrity(ydoc: Y.Doc, roomId: string): Promise<DocumentIntegrityResult> {
    const result: DocumentIntegrityResult = {
      isValid: true,
      errors: [],
      warnings: []
    };

    try {
      // Check if document can be encoded/decoded properly
      const stateVector = Y.encodeStateVector(ydoc);
      const update = Y.encodeStateAsUpdate(ydoc, stateVector);
      
      // Try to create a new document and apply the update
      const testDoc = new Y.Doc();
      Y.applyUpdate(testDoc, update);
      
      const originalContent = ydoc.getText('code').toString();
      const testContent = testDoc.getText('code').toString();
      
      if (originalContent !== testContent) {
        result.isValid = false;
        result.errors.push('Document content mismatch after encoding/decoding');
      }

      // Check for excessive history size
      const docSize = update.length;
      if (docSize > 1024 * 1024) { // 1MB threshold
        result.warnings.push(`Document size is large (${docSize} bytes), consider creating a snapshot`);
      }

      // Validate against latest snapshot
      const latestSnapshot = await RoomSnapshotRepository.findLatestByRoom(roomId);
      if (latestSnapshot && latestSnapshot.content) {
        const contentDiff = Math.abs(originalContent.length - latestSnapshot.content.length);
        if (contentDiff > 10000) { // Large content difference
          result.warnings.push('Large content difference from latest snapshot detected');
        }
      }

      testDoc.destroy();
    } catch (error) {
      result.isValid = false;
      result.errors.push(`Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return result;
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
   * Validate if an update is properly formatted
   */
  private isValidUpdate(update: Uint8Array): boolean {
    try {
      // Basic validation - check if it's a valid Yjs update
      if (update.length === 0) return false;
      
      // Try to decode the update structure
      const testDoc = new Y.Doc();
      Y.applyUpdate(testDoc, update);
      testDoc.destroy();
      
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolve conflicts when update application fails
   */
  private async resolveConflict(roomId: string, failedUpdate: Uint8Array, socket: Socket): Promise<void> {
    try {
      console.log(`Attempting conflict resolution for room ${roomId}`);
      
      // Create a backup snapshot before attempting resolution
      const ydoc = this.yjsDocuments.get(roomId);
      if (ydoc) {
        const currentContent = ydoc.getText('code').toString();
        const currentState = Y.encodeStateAsUpdate(ydoc);
        await this.createSnapshot(roomId, currentContent, currentState, SnapshotType.BACKUP);
      }
      
      // Try to create a new document and merge the states
      const newDoc = new Y.Doc();
      
      // First apply the current document state
      if (ydoc) {
        const currentState = Y.encodeStateAsUpdate(ydoc);
        Y.applyUpdate(newDoc, currentState);
      }
      
      // Then try to apply the failed update
      try {
        Y.applyUpdate(newDoc, failedUpdate);
        
        // If successful, replace the current document
        const mergedState = Y.encodeStateAsUpdate(newDoc);
        const mergedContent = newDoc.getText('code').toString();
        
        // Update the stored document
        this.yjsDocuments.set(roomId, newDoc);
        if (ydoc) {
          ydoc.destroy();
        }
        
        // Persist the resolved state
        await this.persistSnapshot(roomId, mergedContent, mergedState);
        
        // Notify the client that conflict was resolved
        socket.emit('yjs-conflict-resolved', {
          roomId,
          resolvedState: Array.from(mergedState)
        });
        
        console.log(`Conflict resolved for room ${roomId}`);
      } catch (mergeError) {
        console.error('Failed to merge conflicting updates:', mergeError);
        
        // If merge fails, restore from latest snapshot
        await this.restoreFromLatestSnapshot(newDoc, roomId);
        
        socket.emit('yjs-error', {
          message: 'Conflict resolution failed, document restored from snapshot',
          code: 'CONFLICT_RESOLUTION_FAILED'
        });
      }
      
      newDoc.destroy();
    } catch (error) {
      console.error('Error during conflict resolution:', error);
      socket.emit('yjs-error', {
        message: 'Conflict resolution error',
        code: 'CONFLICT_RESOLUTION_ERROR'
      });
    }
  }

  /**
   * Force create a manual snapshot
   */
  async createManualSnapshot(roomId: string): Promise<void> {
    try {
      const ydoc = this.yjsDocuments.get(roomId);
      if (!ydoc) {
        throw new Error('Document not found');
      }
      
      const content = ydoc.getText('code').toString();
      const yjsState = Y.encodeStateAsUpdate(ydoc);
      
      await this.createSnapshot(roomId, content, yjsState, SnapshotType.MANUAL);
    } catch (error) {
      console.error(`Failed to create manual snapshot for room ${roomId}:`, error);
      throw error;
    }
  }

  /**
   * Get document history and snapshots
   */
  async getDocumentHistory(roomId: string, limit: number = 10): Promise<{
    snapshots: any[];
    currentContent: string;
    documentStats: any;
  }> {
    try {
      const [snapshots, stats] = await Promise.all([
        RoomSnapshotRepository.findByRoom(roomId, limit),
        RoomSnapshotRepository.getRoomSnapshotStats(roomId)
      ]);
      
      const currentContent = await this.getDocumentContent(roomId);
      
      return {
        snapshots: snapshots.map(snapshot => ({
          id: snapshot.id,
          content: snapshot.content,
          createdAt: snapshot.createdAt,
          type: snapshot.snapshotType,
          size: snapshot.content.length
        })),
        currentContent,
        documentStats: stats
      };
    } catch (error) {
      console.error(`Failed to get document history for room ${roomId}:`, error);
      throw error;
    }
  }

  /**
   * Clean up resources for a room
   */
  cleanupRoom(roomId: string): void {
    // Clear snapshot timer
    const timer = this.snapshotTimers.get(roomId);
    if (timer) {
      clearInterval(timer);
      this.snapshotTimers.delete(roomId);
    }
    
    // Clear pending snapshots
    this.pendingSnapshots.delete(roomId);
    
    // Destroy and remove document
    const ydoc = this.yjsDocuments.get(roomId);
    if (ydoc) {
      ydoc.destroy();
      this.yjsDocuments.delete(roomId);
    }
  }
}