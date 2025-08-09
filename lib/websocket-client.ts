import { io, Socket } from 'socket.io-client';
import { CursorPosition, UserPresence } from './services/sync-service';

export interface WebSocketClientOptions {
  roomId: string;
  userId: string;
  userName?: string;
  userColor?: string;
}

export interface WebSocketEvents {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onReconnected?: () => void;
  onError?: (error: unknown) => void;
  onUserJoined?: (data: { userId: string; userName?: string; userColor?: string; socketId: string; timestamp: string }) => void;
  onUserLeft?: (data: { userId: string; socketId: string; timestamp: string }) => void;
  onUserReconnected?: (data: { userId: string; socketId: string; timestamp: string }) => void;
  onCursorUpdate?: (data: { roomId: string; cursor: CursorPosition }) => void;
  onPresenceUpdate?: (data: { roomId: string; presence: UserPresence }) => void;
  onYjsUpdate?: (data: { roomId: string; update: number[] }) => void;
  onYjsSyncStep2?: (data: { roomId: string; update: number[] }) => void;
  onYjsSyncStep3?: (data: { roomId: string; update: number[] }) => void;
  onDocumentContent?: (data: { roomId: string; content: string }) => void;
  onReconnectState?: (data: { roomId: string; content: string; presence: UserPresence[] }) => void;
}

export class WebSocketClient {
  private socket: Socket | null = null;
  private options: WebSocketClientOptions;
  private events: WebSocketEvents;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // Start with 1 second
  private maxReconnectDelay = 30000; // Max 30 seconds
  private isConnected = false;
  private isReconnecting = false;

  constructor(options: WebSocketClientOptions, events: WebSocketEvents = {}) {
    this.options = options;
    this.events = events;
  }

  /**
   * Connect to the WebSocket server
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.socket = io({
          path: '/api/socket/io',
          transports: ['websocket', 'polling'],
          timeout: 20000,
          forceNew: true,
          reconnection: true,
          reconnectionAttempts: this.maxReconnectAttempts,
          reconnectionDelay: this.reconnectDelay,
          reconnectionDelayMax: this.maxReconnectDelay
        });

        this.setupEventHandlers();

        // Handle initial connection
        this.socket.on('connect', () => {
          console.log('WebSocket connected');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.reconnectDelay = 1000;
          
          // Join the room
          this.joinRoom();
          
          this.events.onConnected?.();
          resolve();
        });

        // Handle connection errors
        this.socket.on('connect_error', (error) => {
          console.error('WebSocket connection error:', error);
          this.events.onError?.(error);
          
          if (!this.isConnected) {
            reject(error);
          }
        });

      } catch (error) {
        console.error('Failed to create WebSocket connection:', error);
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
    }
  }

  /**
   * Join a room
   */
  private joinRoom(): void {
    if (this.socket && this.isConnected) {
      this.socket.emit('join-room', {
        roomId: this.options.roomId,
        userId: this.options.userId,
        userName: this.options.userName,
        userColor: this.options.userColor
      });
    }
  }

  /**
   * Leave the current room
   */
  leaveRoom(): void {
    if (this.socket && this.isConnected) {
      this.socket.emit('leave-room', {
        roomId: this.options.roomId,
        userId: this.options.userId
      });
    }
  }

  /**
   * Send Yjs update
   */
  sendYjsUpdate(update: Uint8Array): void {
    if (this.socket && this.isConnected) {
      this.socket.emit('yjs-update', {
        roomId: this.options.roomId,
        update: Array.from(update)
      });
    }
  }

  /**
   * Send Yjs sync step 1
   */
  sendYjsSyncStep1(update: Uint8Array): void {
    if (this.socket && this.isConnected) {
      this.socket.emit('yjs-sync-step1', {
        roomId: this.options.roomId,
        update: Array.from(update)
      });
    }
  }

  /**
   * Send Yjs sync step 2
   */
  sendYjsSyncStep2(): void {
    if (this.socket && this.isConnected) {
      this.socket.emit('yjs-sync-step2', {
        roomId: this.options.roomId
      });
    }
  }

  /**
   * Update cursor position
   */
  updateCursor(cursor: CursorPosition): void {
    if (this.socket && this.isConnected) {
      this.socket.emit('cursor-update', {
        roomId: this.options.roomId,
        cursor
      });
    }
  }

  /**
   * Update user presence
   */
  updatePresence(presence: UserPresence): void {
    if (this.socket && this.isConnected) {
      this.socket.emit('presence-update', {
        roomId: this.options.roomId,
        presence
      });
    }
  }

  /**
   * Get document content
   */
  getDocument(): void {
    if (this.socket && this.isConnected) {
      this.socket.emit('get-document', {
        roomId: this.options.roomId
      });
    }
  }

  /**
   * Check if connected
   */
  isSocketConnected(): boolean {
    return this.isConnected && this.socket?.connected === true;
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    if (!this.socket) return;

    // Connection events
    this.socket.on('disconnect', (reason) => {
      console.log('WebSocket disconnected:', reason);
      this.isConnected = false;
      this.events.onDisconnected?.();
      
      // Attempt reconnection for certain disconnect reasons
      if (reason === 'io server disconnect') {
        // Server initiated disconnect, try to reconnect
        this.attemptReconnection();
      }
    });

    this.socket.on('reconnect', (attemptNumber) => {
      console.log(`WebSocket reconnected after ${attemptNumber} attempts`);
      this.isConnected = true;
      this.isReconnecting = false;
      this.reconnectAttempts = 0;
      
      // Rejoin room and get current state
      this.socket?.emit('reconnect-success', {
        roomId: this.options.roomId,
        userId: this.options.userId
      });
      
      this.events.onReconnected?.();
    });

    this.socket.on('reconnect_error', (error) => {
      console.error('WebSocket reconnection error:', error);
      this.events.onError?.(error);
    });

    this.socket.on('reconnect_failed', () => {
      console.error('WebSocket reconnection failed after maximum attempts');
      this.isReconnecting = false;
      this.events.onError?.(new Error('Failed to reconnect after maximum attempts'));
    });

    // Room events
    this.socket.on('room-joined', (data) => {
      console.log('Successfully joined room:', data);
    });

    this.socket.on('user-joined', (data) => {
      this.events.onUserJoined?.(data);
    });

    this.socket.on('user-left', (data) => {
      this.events.onUserLeft?.(data);
    });

    this.socket.on('user-reconnected', (data) => {
      this.events.onUserReconnected?.(data);
    });

    // Yjs synchronization events
    this.socket.on('yjs-update', (data) => {
      this.events.onYjsUpdate?.(data);
    });

    this.socket.on('yjs-sync-step2', (data) => {
      this.events.onYjsSyncStep2?.(data);
    });

    this.socket.on('yjs-sync-step3', (data) => {
      this.events.onYjsSyncStep3?.(data);
    });

    // Cursor and presence events
    this.socket.on('cursor-update', (data) => {
      this.events.onCursorUpdate?.(data);
    });

    this.socket.on('presence-update', (data) => {
      this.events.onPresenceUpdate?.(data);
    });

    // Document events
    this.socket.on('document-content', (data) => {
      this.events.onDocumentContent?.(data);
    });

    this.socket.on('reconnect-state', (data) => {
      this.events.onReconnectState?.(data);
    });

    // Error events
    this.socket.on('error', (error) => {
      console.error('WebSocket error:', error);
      this.events.onError?.(error);
    });

    this.socket.on('server-error', (error) => {
      console.error('Server error:', error);
      this.events.onError?.(error);
    });

    this.socket.on('yjs-error', (error) => {
      console.error('Yjs error:', error);
      this.events.onError?.(error);
    });

    // Health check
    this.socket.on('pong', () => {
      // Connection is healthy
    });
  }

  /**
   * Attempt manual reconnection with exponential backoff
   */
  private attemptReconnection(): void {
    if (this.isReconnecting || this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    console.log(`Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);

    setTimeout(() => {
      if (this.socket && !this.socket.connected) {
        this.socket.connect();
      }
      
      // Exponential backoff
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      this.isReconnecting = false;
    }, this.reconnectDelay);
  }

  /**
   * Send periodic ping to check connection health
   */
  startHealthCheck(): void {
    setInterval(() => {
      if (this.socket && this.isConnected) {
        this.socket.emit('ping');
      }
    }, 30000); // Ping every 30 seconds
  }
}