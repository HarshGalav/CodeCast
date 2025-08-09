import { RoomRepository } from '@/lib/repositories/room-repository'
import { prisma } from '@/lib/db'

// Mock Prisma
jest.mock('@/lib/db', () => ({
  prisma: {
    room: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
    },
  },
  handleDatabaseError: jest.fn((error) => {
    throw error
  }),
}))

const mockPrisma = prisma as jest.Mocked<typeof prisma>

describe('RoomRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('create', () => {
    it('should create a room with a unique key', async () => {
      const mockRoom = {
        id: 'test-id',
        key: 'TEST123456',
        createdAt: new Date(),
        lastActivity: new Date(),
        isArchived: false,
        participantCount: 0,
        codeSnapshot: null,
        yjsState: null,
      }

      // Mock the unique key check
      mockPrisma.room.findUnique.mockResolvedValueOnce(null)
      mockPrisma.room.create.mockResolvedValueOnce(mockRoom)

      const result = await RoomRepository.create({})

      expect(mockPrisma.room.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          key: expect.any(String),
        }),
      })
      expect(result).toEqual(mockRoom)
    })
  })

  describe('findByKey', () => {
    it('should find a room by its key', async () => {
      const mockRoom = {
        id: 'test-id',
        key: 'TEST123456',
        createdAt: new Date(),
        lastActivity: new Date(),
        isArchived: false,
        participantCount: 0,
        codeSnapshot: null,
        yjsState: null,
        participants: [],
      }

      mockPrisma.room.findUnique.mockResolvedValueOnce(mockRoom)

      const result = await RoomRepository.findByKey('TEST123456')

      expect(mockPrisma.room.findUnique).toHaveBeenCalledWith({
        where: { key: 'TEST123456' },
        include: {
          participants: {
            where: { isActive: true },
            orderBy: { joinedAt: 'asc' },
          },
        },
      })
      expect(result).toEqual(mockRoom)
    })

    it('should return null if room not found', async () => {
      mockPrisma.room.findUnique.mockResolvedValueOnce(null)

      const result = await RoomRepository.findByKey('NONEXISTENT')

      expect(result).toBeNull()
    })
  })

  describe('updateCodeSnapshot', () => {
    it('should update room code snapshot and last activity', async () => {
      const mockRoom = {
        id: 'test-id',
        key: 'TEST123456',
        createdAt: new Date(),
        lastActivity: new Date(),
        isArchived: false,
        participantCount: 0,
        codeSnapshot: 'updated code',
        yjsState: null,
      }

      mockPrisma.room.update.mockResolvedValueOnce(mockRoom)

      const result = await RoomRepository.updateCodeSnapshot(
        'test-id',
        'updated code'
      )

      expect(mockPrisma.room.update).toHaveBeenCalledWith({
        where: { id: 'test-id' },
        data: {
          codeSnapshot: 'updated code',
          yjsState: undefined,
          lastActivity: expect.any(Date),
        },
      })
      expect(result).toEqual(mockRoom)
    })
  })
})