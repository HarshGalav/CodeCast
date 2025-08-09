import { RoomService } from '@/lib/services/room-service'
import { RoomRepository } from '@/lib/repositories/room-repository'
import { ParticipantRepository } from '@/lib/repositories/participant-repository'
import { RoomSnapshotRepository } from '@/lib/repositories/room-snapshot-repository'

// Mock the repositories
jest.mock('@/lib/repositories/room-repository')
jest.mock('@/lib/repositories/participant-repository')
jest.mock('@/lib/repositories/room-snapshot-repository')

const mockRoomRepository = RoomRepository as jest.Mocked<typeof RoomRepository>
const mockParticipantRepository = ParticipantRepository as jest.Mocked<typeof ParticipantRepository>
const mockRoomSnapshotRepository = RoomSnapshotRepository as jest.Mocked<typeof RoomSnapshotRepository>

describe('RoomService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('createRoom', () => {
    it('should create a room with default code and snapshot', async () => {
      const mockRoom = {
        id: 'room-id',
        key: 'TEST123456',
        createdAt: new Date(),
        lastActivity: new Date(),
        isArchived: false,
        participantCount: 0,
        codeSnapshot: '#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hello, World!" << endl;\n    return 0;\n}',
        yjsState: null,
      }

      mockRoomRepository.create.mockResolvedValueOnce(mockRoom)
      mockRoomSnapshotRepository.createAutoSnapshot.mockResolvedValueOnce({} as any)

      const result = await RoomService.createRoom()

      expect(mockRoomRepository.create).toHaveBeenCalledWith({
        codeSnapshot: expect.stringContaining('Hello, World!'),
      })
      expect(mockRoomSnapshotRepository.createAutoSnapshot).toHaveBeenCalledWith(
        mockRoom.id,
        mockRoom.codeSnapshot
      )
      expect(result).toEqual({
        roomKey: mockRoom.key,
        roomId: mockRoom.id,
        createdAt: mockRoom.createdAt.toISOString(),
      })
    })

    it('should handle room creation failure', async () => {
      mockRoomRepository.create.mockRejectedValueOnce(new Error('Database error'))

      await expect(RoomService.createRoom()).rejects.toThrow('Failed to create room')
    })
  })

  describe('joinRoom', () => {
    it('should successfully join an existing room', async () => {
      const mockRoom = {
        id: 'room-id',
        key: 'TEST123456',
        createdAt: new Date(),
        lastActivity: new Date(),
        isArchived: false,
        participantCount: 1,
        codeSnapshot: 'test code',
        yjsState: null,
        participants: [],
      }

      const mockUpdatedRoom = {
        ...mockRoom,
        participants: [
          {
            id: 'participant-id',
            roomId: 'room-id',
            userId: 'user-123',
            joinedAt: new Date(),
            lastSeen: new Date(),
            isActive: true,
            cursorPosition: null,
            userColor: '#3B82F6',
          },
        ],
      }

      const mockSnapshot = {
        id: 'snapshot-id',
        roomId: 'room-id',
        content: 'test code',
        yjsState: Buffer.from('test-state'),
        createdAt: new Date(),
        snapshotType: 'auto',
      }

      mockRoomRepository.findByKey.mockResolvedValueOnce(mockRoom)
      mockParticipantRepository.findByRoomAndUser.mockResolvedValueOnce(null)
      mockParticipantRepository.markActive.mockResolvedValueOnce({} as any)
      mockRoomRepository.incrementParticipantCount.mockResolvedValueOnce({} as any)
      mockRoomRepository.findById.mockResolvedValueOnce(mockUpdatedRoom)
      mockRoomSnapshotRepository.findLatestByRoom.mockResolvedValueOnce(mockSnapshot)

      const result = await RoomService.joinRoom('TEST123456', 'user-123')

      expect(mockRoomRepository.findByKey).toHaveBeenCalledWith('TEST123456')
      expect(mockParticipantRepository.markActive).toHaveBeenCalledWith('room-id', 'user-123')
      expect(result.roomData.roomId).toBe('room-id')
      expect(result.roomData.roomKey).toBe('TEST123456')
      expect(result.yjsDocumentState).toEqual(mockSnapshot.yjsState)
    })

    it('should throw error for non-existent room', async () => {
      mockRoomRepository.findByKey.mockResolvedValueOnce(null)

      await expect(RoomService.joinRoom('INVALID123', 'user-123')).rejects.toThrow('Room not found')
    })

    it('should throw error for archived room', async () => {
      const mockArchivedRoom = {
        id: 'room-id',
        key: 'TEST123456',
        createdAt: new Date(),
        lastActivity: new Date(),
        isArchived: true,
        participantCount: 0,
        codeSnapshot: 'test code',
        yjsState: null,
        participants: [],
      }

      mockRoomRepository.findByKey.mockResolvedValueOnce(mockArchivedRoom)

      await expect(RoomService.joinRoom('TEST123456', 'user-123')).rejects.toThrow(
        'Room is archived and no longer available'
      )
    })
  })

  describe('validateRoomKey', () => {
    it('should validate correct room key format', () => {
      expect(RoomService.validateRoomKey('TEST123456AB')).toBe(true)
      expect(RoomService.validateRoomKey('ABCD1234EFGH')).toBe(true)
    })

    it('should reject invalid room key formats', () => {
      expect(RoomService.validateRoomKey('test123456ab')).toBe(false) // lowercase
      expect(RoomService.validateRoomKey('TEST12345')).toBe(false) // too short
      expect(RoomService.validateRoomKey('TEST123456ABC')).toBe(false) // too long
      expect(RoomService.validateRoomKey('TEST123456@#')).toBe(false) // special characters
      expect(RoomService.validateRoomKey('')).toBe(false) // empty
    })
  })

  describe('validateUserId', () => {
    it('should validate correct user ID format', () => {
      expect(RoomService.validateUserId('user123')).toBe(true)
      expect(RoomService.validateUserId('test-user_123')).toBe(true)
    })

    it('should reject invalid user ID formats', () => {
      expect(RoomService.validateUserId('')).toBe(false) // empty
      expect(RoomService.validateUserId('a'.repeat(256))).toBe(false) // too long
    })
  })
})