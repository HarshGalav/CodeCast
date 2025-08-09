import { prisma, handleDatabaseError } from '@/lib/db'
import type { 
  Participant, 
  ParticipantWithRoom, 
  CreateParticipantInput, 
  UpdateParticipantInput,
  CursorPosition 
} from '@/lib/types/database'

export class ParticipantRepository {
  /**
   * Create a new participant
   */
  async create(data: CreateParticipantInput): Promise<Participant> {
    try {
      return await prisma.participant.create({
        data,
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Find participant by room and user ID
   */
  async findByRoomAndUser(
    roomId: string, 
    userId: string
  ): Promise<Participant | null> {
    try {
      return await prisma.participant.findFirst({
        where: {
          roomId,
          userId,
        },
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Find all active participants in a room
   */
  async findActiveByRoomId(roomId: string): Promise<Participant[]> {
    try {
      return await prisma.participant.findMany({
        where: {
          roomId,
          isActive: true,
        },
        orderBy: { joinedAt: 'asc' },
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Update participant data
   */
  async update(
    id: string, 
    data: UpdateParticipantInput
  ): Promise<Participant> {
    try {
      return await prisma.participant.update({
        where: { id },
        data: {
          ...data,
          lastSeen: new Date(),
        },
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Update participant's cursor position
   */
  async updateCursorPosition(
    roomId: string,
    userId: string,
    cursorPosition: CursorPosition
  ): Promise<Participant | null> {
    try {
      const participant = await this.findByRoomAndUser(roomId, userId)
      
      if (!participant) {
        return null
      }

      return await prisma.participant.update({
        where: { id: participant.id },
        data: {
          cursorPosition,
          lastSeen: new Date(),
        },
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Mark participant as active
   */
  async markActive(roomId: string, userId: string): Promise<Participant> {
    try {
      // First try to update existing participant
      const existing = await this.findByRoomAndUser(roomId, userId)
      
      if (existing) {
        return await prisma.participant.update({
          where: { id: existing.id },
          data: {
            isActive: true,
            lastSeen: new Date(),
          },
        })
      }

      // Create new participant if doesn't exist
      return await this.create({
        room: { connect: { id: roomId } },
        userId,
        userColor: ParticipantRepository.generateUserColor(),
        isActive: true,
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Mark participant as inactive
   */
  async markInactive(roomId: string, userId: string): Promise<Participant | null> {
    try {
      const participant = await this.findByRoomAndUser(roomId, userId)
      
      if (!participant) {
        return null
      }

      return await prisma.participant.update({
        where: { id: participant.id },
        data: {
          isActive: false,
          lastSeen: new Date(),
        },
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Remove participant from room
   */
  async remove(roomId: string, userId: string): Promise<void> {
    try {
      await prisma.participant.deleteMany({
        where: {
          roomId,
          userId,
        },
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Find inactive participants for cleanup
   */
  async findInactiveParticipants(minutesInactive: number = 30): Promise<Participant[]> {
    try {
      const cutoffDate = new Date(Date.now() - minutesInactive * 60 * 1000)
      
      return await prisma.participant.findMany({
        where: {
          lastSeen: { lt: cutoffDate },
          isActive: true,
        },
        orderBy: { lastSeen: 'asc' },
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Clean up inactive participants
   */
  async cleanupInactive(minutesInactive: number = 30): Promise<number> {
    try {
      const cutoffDate = new Date(Date.now() - minutesInactive * 60 * 1000)
      
      const result = await prisma.participant.updateMany({
        where: {
          lastSeen: { lt: cutoffDate },
          isActive: true,
        },
        data: {
          isActive: false,
        },
      })

      return result.count
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Update participant presence
   */
  async updatePresence(roomId: string, userId: string, isActive: boolean): Promise<Participant | null> {
    try {
      const participant = await this.findByRoomAndUser(roomId, userId)
      
      if (!participant) {
        return null
      }

      return await prisma.participant.update({
        where: { id: participant.id },
        data: {
          isActive,
          lastSeen: new Date(),
        },
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Generate a random color for user
   */
  private static generateUserColor(): string {
    const colors = [
      '#3B82F6', // Blue
      '#EF4444', // Red
      '#10B981', // Green
      '#F59E0B', // Yellow
      '#8B5CF6', // Purple
      '#F97316', // Orange
      '#06B6D4', // Cyan
      '#84CC16', // Lime
      '#EC4899', // Pink
      '#6B7280', // Gray
    ]
    
    return colors[Math.floor(Math.random() * colors.length)]
  }
}