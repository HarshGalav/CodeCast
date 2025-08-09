import { RoomRepository } from '@/lib/repositories/room-repository'
import { ParticipantRepository } from '@/lib/repositories/participant-repository'
import { RoomSnapshotRepository } from '@/lib/repositories/room-snapshot-repository'
import type { Room, RoomWithParticipants, Participant } from '@/lib/types/database'

export interface CreateRoomResponse {
  roomKey: string
  roomId: string
  createdAt: string
}

export interface JoinRoomResponse {
  roomData: RoomData
  yjsDocumentState: Uint8Array | null
}

export interface RoomData {
  roomId: string
  roomKey: string
  participants: Participant[]
  codeContent: string
  lastActivity: string
  participantCount: number
}

export class RoomService {
  /**
   * Create a new room
   */
  static async createRoom(): Promise<CreateRoomResponse> {
    try {
      const room = await RoomRepository.create({
        codeSnapshot: `#include <iostream>
using namespace std;

int main() {
    cout << "Hello, World!" << endl;
    return 0;
}`,
      })

      // Create initial snapshot
      await RoomSnapshotRepository.createAutoSnapshot(
        room.id,
        room.codeSnapshot || ''
      )

      return {
        roomKey: room.key,
        roomId: room.id,
        createdAt: room.createdAt.toISOString(),
      }
    } catch (error) {
      console.error('Failed to create room:', error)
      throw new Error('Failed to create room')
    }
  }

  /**
   * Join an existing room
   */
  static async joinRoom(roomKey: string, userId: string): Promise<JoinRoomResponse> {
    try {
      // Find the room
      const room = await RoomRepository.findByKey(roomKey)
      
      if (!room) {
        throw new Error('Room not found')
      }

      if (room.isArchived) {
        throw new Error('Room is archived and no longer available')
      }

      // Add or update participant
      await ParticipantRepository.markActive(room.id, userId)
      
      // Increment participant count if this is a new participant
      const existingParticipant = await ParticipantRepository.findByRoomAndUser(room.id, userId)
      if (!existingParticipant) {
        await RoomRepository.incrementParticipantCount(room.id)
      }

      // Get updated room data
      const updatedRoom = await RoomRepository.findById(room.id)
      if (!updatedRoom) {
        throw new Error('Failed to retrieve updated room data')
      }

      // Get latest snapshot for Yjs state
      const latestSnapshot = await RoomSnapshotRepository.findLatestByRoom(room.id)

      const roomData: RoomData = {
        roomId: updatedRoom.id,
        roomKey: updatedRoom.key,
        participants: updatedRoom.participants,
        codeContent: updatedRoom.codeSnapshot || '',
        lastActivity: updatedRoom.lastActivity.toISOString(),
        participantCount: updatedRoom.participantCount,
      }

      return {
        roomData,
        yjsDocumentState: latestSnapshot?.yjsState || null,
      }
    } catch (error) {
      console.error('Failed to join room:', error)
      if (error instanceof Error) {
        throw error
      }
      throw new Error('Failed to join room')
    }
  }

  /**
   * Leave a room
   */
  static async leaveRoom(roomId: string, userId: string): Promise<void> {
    try {
      // Mark participant as inactive
      await ParticipantRepository.markInactive(roomId, userId)
      
      // Decrement participant count
      await RoomRepository.decrementParticipantCount(roomId)
      
      // Update room activity
      await RoomRepository.update(roomId, {
        lastActivity: new Date(),
      })
    } catch (error) {
      console.error('Failed to leave room:', error)
      throw new Error('Failed to leave room')
    }
  }

  /**
   * Get room data by ID
   */
  static async getRoomData(roomId: string): Promise<RoomData | null> {
    try {
      const room = await RoomRepository.findById(roomId)
      
      if (!room || room.isArchived) {
        return null
      }

      return {
        roomId: room.id,
        roomKey: room.key,
        participants: room.participants,
        codeContent: room.codeSnapshot || '',
        lastActivity: room.lastActivity.toISOString(),
        participantCount: room.participantCount,
      }
    } catch (error) {
      console.error('Failed to get room data:', error)
      return null
    }
  }

  /**
   * Update room code snapshot
   */
  static async updateRoomSnapshot(
    roomId: string, 
    content: string, 
    yjsState?: Uint8Array
  ): Promise<void> {
    try {
      // Update room snapshot
      await RoomRepository.updateCodeSnapshot(
        roomId, 
        content, 
        yjsState ? Buffer.from(yjsState) : undefined
      )

      // Create automatic snapshot
      await RoomSnapshotRepository.createAutoSnapshot(
        roomId,
        content,
        yjsState ? Buffer.from(yjsState) : undefined
      )
    } catch (error) {
      console.error('Failed to update room snapshot:', error)
      throw new Error('Failed to update room snapshot')
    }
  }

  /**
   * Update participant cursor position
   */
  static async updateParticipantCursor(
    roomId: string,
    userId: string,
    cursorPosition: { lineNumber: number; column: number }
  ): Promise<void> {
    try {
      await ParticipantRepository.updateCursorPosition(roomId, userId, cursorPosition)
    } catch (error) {
      console.error('Failed to update participant cursor:', error)
      // Don't throw error for cursor updates as they're not critical
    }
  }

  /**
   * Get active participants in a room
   */
  static async getActiveParticipants(roomId: string): Promise<Participant[]> {
    try {
      return await ParticipantRepository.findActiveByRoom(roomId)
    } catch (error) {
      console.error('Failed to get active participants:', error)
      return []
    }
  }

  /**
   * Archive inactive rooms
   */
  static async archiveInactiveRooms(hoursInactive: number = 24): Promise<number> {
    try {
      const inactiveRooms = await RoomRepository.findInactiveRooms(hoursInactive)
      let archivedCount = 0

      for (const room of inactiveRooms) {
        // Create backup snapshot before archiving
        if (room.codeSnapshot) {
          await RoomSnapshotRepository.createBackupSnapshot(
            room.id,
            room.codeSnapshot,
            room.yjsState
          )
        }

        // Archive the room
        await RoomRepository.archive(room.id)
        archivedCount++
      }

      return archivedCount
    } catch (error) {
      console.error('Failed to archive inactive rooms:', error)
      return 0
    }
  }

  /**
   * Cleanup inactive participants
   */
  static async cleanupInactiveParticipants(minutesInactive: number = 30): Promise<number> {
    try {
      return await ParticipantRepository.cleanupInactive(minutesInactive)
    } catch (error) {
      console.error('Failed to cleanup inactive participants:', error)
      return 0
    }
  }

  /**
   * Validate room key format
   */
  static validateRoomKey(roomKey: string): boolean {
    // Room keys should be 12 characters, alphanumeric
    const roomKeyRegex = /^[A-Z0-9]{12}$/
    return roomKeyRegex.test(roomKey)
  }

  /**
   * Validate user ID format
   */
  static validateUserId(userId: string): boolean {
    // User IDs should be non-empty strings with reasonable length
    return typeof userId === 'string' && userId.length > 0 && userId.length <= 255
  }
}