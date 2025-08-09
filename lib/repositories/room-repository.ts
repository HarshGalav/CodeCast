import { prisma, handleDatabaseError } from '@/lib/db'
import type { 
  Room, 
  RoomWithParticipants, 
  CreateRoomInput, 
  UpdateRoomInput 
} from '@/lib/types/database'

export class RoomRepository {
  /**
   * Create a new room with a unique key
   */
  async create(data: Omit<CreateRoomInput, 'key'>): Promise<Room> {
    try {
      // Generate a unique room key
      const key = await RoomRepository.generateUniqueKey()
      
      return await prisma.room.create({
        data: {
          ...data,
          key,
        },
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Find a room by its unique key
   */
  async findByKey(key: string): Promise<RoomWithParticipants | null> {
    try {
      return await prisma.room.findUnique({
        where: { key },
        include: {
          participants: {
            where: { isActive: true },
            orderBy: { joinedAt: 'asc' },
          },
        },
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Find a room by its ID
   */
  async findById(id: string): Promise<RoomWithParticipants | null> {
    try {
      return await prisma.room.findUnique({
        where: { id },
        include: {
          participants: {
            where: { isActive: true },
            orderBy: { joinedAt: 'asc' },
          },
        },
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Update a room's data
   */
  async update(id: string, data: UpdateRoomInput): Promise<Room> {
    try {
      return await prisma.room.update({
        where: { id },
        data: {
          ...data,
          lastActivity: new Date(),
        },
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Update room's code snapshot
   */
  async updateCodeSnapshot(
    id: string, 
    codeSnapshot: string, 
    yjsState?: Buffer
  ): Promise<Room> {
    try {
      return await prisma.room.update({
        where: { id },
        data: {
          codeSnapshot,
          yjsState,
          lastActivity: new Date(),
        },
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Update room snapshot (alias for updateCodeSnapshot)
   */
  async updateSnapshot(
    id: string, 
    content: string, 
    yjsState?: Uint8Array
  ): Promise<Room> {
    const yjsBuffer = yjsState ? Buffer.from(yjsState) : undefined;
    return this.updateCodeSnapshot(id, content, yjsBuffer);
  }

  /**
   * Increment participant count
   */
  async incrementParticipantCount(id: string): Promise<Room> {
    try {
      return await prisma.room.update({
        where: { id },
        data: {
          participantCount: { increment: 1 },
          lastActivity: new Date(),
        },
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Decrement participant count
   */
  async decrementParticipantCount(id: string): Promise<Room> {
    try {
      return await prisma.room.update({
        where: { id },
        data: {
          participantCount: { decrement: 1 },
          lastActivity: new Date(),
        },
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Find inactive rooms for archival
   */
  async findInactiveRooms(hoursInactive: number = 24): Promise<Room[]> {
    try {
      const cutoffDate = new Date(Date.now() - hoursInactive * 60 * 60 * 1000)
      
      return await prisma.room.findMany({
        where: {
          lastActivity: { lt: cutoffDate },
          isArchived: false,
        },
        orderBy: { lastActivity: 'asc' },
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Archive a room
   */
  async archive(id: string): Promise<Room> {
    try {
      return await prisma.room.update({
        where: { id },
        data: { isArchived: true },
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Delete a room and all related data
   */
  async delete(id: string): Promise<void> {
    try {
      await prisma.room.delete({
        where: { id },
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Generate a unique room key
   */
  private static async generateUniqueKey(): Promise<string> {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let attempts = 0
    const maxAttempts = 10

    while (attempts < maxAttempts) {
      let key = ''
      for (let i = 0; i < 12; i++) {
        key += characters.charAt(Math.floor(Math.random() * characters.length))
      }

      // Check if key already exists
      const existingRoom = await prisma.room.findUnique({
        where: { key },
        select: { id: true },
      })

      if (!existingRoom) {
        return key
      }

      attempts++
    }

    throw new Error('Failed to generate unique room key after maximum attempts')
  }
}