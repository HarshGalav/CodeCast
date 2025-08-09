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
  static async create(data: Omit<CreateRoomInput, 'key'>): Promise<Room> {
    try {
      // Generate a unique room key
      const key = await this.generateUniqueKey()
      
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
  static async findByKey(key: string): Promise<RoomWithParticipants | null> {
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
  static async findById(id: string): Promise<RoomWithParticipants | null> {
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
  static async update(id: string, data: UpdateRoomInput): Promise<Room> {
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
  static async updateCodeSnapshot(
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
   * Increment participant count
   */
  static async incrementParticipantCount(id: string): Promise<Room> {
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
  static async decrementParticipantCount(id: string): Promise<Room> {
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
  static async findInactiveRooms(hoursInactive: number = 24): Promise<Room[]> {
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
  static async archive(id: string): Promise<Room> {
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
  static async delete(id: string): Promise<void> {
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