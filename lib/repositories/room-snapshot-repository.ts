import { prisma, handleDatabaseError } from '@/lib/db'
import type { 
  RoomSnapshot, 
  RoomSnapshotWithRoom, 
  CreateRoomSnapshotInput,
  SnapshotType 
} from '@/lib/types/database'

export class RoomSnapshotRepository {
  /**
   * Create a new room snapshot
   */
  static async create(data: CreateRoomSnapshotInput): Promise<RoomSnapshot> {
    try {
      return await prisma.roomSnapshot.create({
        data,
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Find snapshots by room ID
   */
  static async findByRoom(
    roomId: string, 
    limit: number = 10
  ): Promise<RoomSnapshot[]> {
    try {
      return await prisma.roomSnapshot.findMany({
        where: { roomId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Find the latest snapshot for a room
   */
  static async findLatestByRoom(roomId: string): Promise<RoomSnapshot | null> {
    try {
      return await prisma.roomSnapshot.findFirst({
        where: { roomId },
        orderBy: { createdAt: 'desc' },
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Find snapshots by type
   */
  static async findByType(
    roomId: string, 
    snapshotType: SnapshotType,
    limit: number = 5
  ): Promise<RoomSnapshot[]> {
    try {
      return await prisma.roomSnapshot.findMany({
        where: { 
          roomId,
          snapshotType,
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Create an automatic snapshot
   */
  static async createAutoSnapshot(
    roomId: string,
    content: string,
    yjsState?: Buffer
  ): Promise<RoomSnapshot> {
    try {
      return await this.create({
        room: { connect: { id: roomId } },
        content,
        yjsState,
        snapshotType: SnapshotType.AUTO,
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Create a manual snapshot
   */
  static async createManualSnapshot(
    roomId: string,
    content: string,
    yjsState?: Buffer
  ): Promise<RoomSnapshot> {
    try {
      return await this.create({
        room: { connect: { id: roomId } },
        content,
        yjsState,
        snapshotType: SnapshotType.MANUAL,
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Create a backup snapshot
   */
  static async createBackupSnapshot(
    roomId: string,
    content: string,
    yjsState?: Buffer
  ): Promise<RoomSnapshot> {
    try {
      return await this.create({
        room: { connect: { id: roomId } },
        content,
        yjsState,
        snapshotType: SnapshotType.BACKUP,
      })
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Delete old snapshots, keeping the most recent ones
   */
  static async deleteOldSnapshots(
    roomId: string,
    keepCount: number = 10
  ): Promise<number> {
    try {
      // Find snapshots to delete (all except the most recent keepCount)
      const snapshotsToDelete = await prisma.roomSnapshot.findMany({
        where: { roomId },
        orderBy: { createdAt: 'desc' },
        skip: keepCount,
        select: { id: true },
      })

      if (snapshotsToDelete.length === 0) {
        return 0
      }

      const result = await prisma.roomSnapshot.deleteMany({
        where: {
          id: { in: snapshotsToDelete.map(s => s.id) },
        },
      })

      return result.count
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Delete snapshots older than specified days
   */
  static async deleteOldSnapshotsByAge(daysOld: number = 30): Promise<number> {
    try {
      const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000)
      
      const result = await prisma.roomSnapshot.deleteMany({
        where: {
          createdAt: { lt: cutoffDate },
          snapshotType: SnapshotType.AUTO, // Only delete auto snapshots
        },
      })

      return result.count
    } catch (error) {
      handleDatabaseError(error)
    }
  }

  /**
   * Get snapshot statistics for a room
   */
  static async getRoomSnapshotStats(roomId: string): Promise<{
    total: number
    auto: number
    manual: number
    backup: number
    oldestDate: Date | null
    newestDate: Date | null
  }> {
    try {
      const [total, auto, manual, backup, oldest, newest] = await Promise.all([
        prisma.roomSnapshot.count({ where: { roomId } }),
        prisma.roomSnapshot.count({ where: { roomId, snapshotType: SnapshotType.AUTO } }),
        prisma.roomSnapshot.count({ where: { roomId, snapshotType: SnapshotType.MANUAL } }),
        prisma.roomSnapshot.count({ where: { roomId, snapshotType: SnapshotType.BACKUP } }),
        prisma.roomSnapshot.findFirst({
          where: { roomId },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        }),
        prisma.roomSnapshot.findFirst({
          where: { roomId },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
      ])

      return {
        total,
        auto,
        manual,
        backup,
        oldestDate: oldest?.createdAt || null,
        newestDate: newest?.createdAt || null,
      }
    } catch (error) {
      handleDatabaseError(error)
    }
  }
}