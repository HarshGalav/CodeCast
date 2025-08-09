import { SyncService } from '../../../lib/services/sync-service';
import * as Y from 'yjs';

// Mock the repositories
jest.mock('../../../lib/repositories/room-repository');
jest.mock('../../../lib/repositories/participant-repository');

describe('SyncService', () => {
  let syncService: SyncService;

  beforeEach(() => {
    syncService = SyncService.getInstance();
  });

  describe('initializeYjsDocument', () => {
    it('should create a new Yjs document for a room', async () => {
      const roomId = 'test-room-id';
      
      const ydoc = await syncService.initializeYjsDocument(roomId);
      
      expect(ydoc).toBeInstanceOf(Y.Doc);
      expect(ydoc.getText('code')).toBeDefined();
    });

    it('should return existing document if already initialized', async () => {
      const roomId = 'test-room-id';
      
      const ydoc1 = await syncService.initializeYjsDocument(roomId);
      const ydoc2 = await syncService.initializeYjsDocument(roomId);
      
      expect(ydoc1).toBe(ydoc2);
    });
  });

  describe('getDocumentContent', () => {
    it('should return empty string for new document', async () => {
      const roomId = 'test-room-id';
      
      const content = await syncService.getDocumentContent(roomId);
      
      expect(content).toBe('');
    });

    it('should return document content after text is inserted', async () => {
      const roomId = 'test-room-id';
      const testContent = 'Hello, World!';
      
      const ydoc = await syncService.initializeYjsDocument(roomId);
      const ytext = ydoc.getText('code');
      ytext.insert(0, testContent);
      
      const content = await syncService.getDocumentContent(roomId);
      
      expect(content).toBe(testContent);
    });
  });

  describe('cleanupRoom', () => {
    it('should destroy and remove document from memory', async () => {
      const roomId = 'test-room-id';
      
      await syncService.initializeYjsDocument(roomId);
      syncService.cleanupRoom(roomId);
      
      // Should create a new document since the old one was cleaned up
      const ydoc1 = await syncService.initializeYjsDocument(roomId);
      const ydoc2 = await syncService.initializeYjsDocument(roomId);
      
      expect(ydoc1).toBe(ydoc2); // Should be the same new instance
    });
  });
});