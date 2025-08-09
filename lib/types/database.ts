import { Prisma } from '@prisma/client'

// Room types
export type Room = Prisma.RoomGetPayload<{}>
export type RoomWithParticipants = Prisma.RoomGetPayload<{
  include: { participants: true }
}>
export type RoomWithAll = Prisma.RoomGetPayload<{
  include: {
    participants: true
    compileJobs: true
    snapshots: true
  }
}>

// Participant types
export type Participant = Prisma.ParticipantGetPayload<{}>
export type ParticipantWithRoom = Prisma.ParticipantGetPayload<{
  include: { room: true }
}>

// CompileJob types
export type CompileJob = Prisma.CompileJobGetPayload<{}>
export type CompileJobWithRoom = Prisma.CompileJobGetPayload<{
  include: { room: true }
}>

// RoomSnapshot types
export type RoomSnapshot = Prisma.RoomSnapshotGetPayload<{}>
export type RoomSnapshotWithRoom = Prisma.RoomSnapshotGetPayload<{
  include: { room: true }
}>

// Create input types
export type CreateRoomInput = Prisma.RoomCreateInput
export type CreateParticipantInput = Prisma.ParticipantCreateInput
export type CreateCompileJobInput = Prisma.CompileJobCreateInput
export type CreateRoomSnapshotInput = Prisma.RoomSnapshotCreateInput

// Update input types
export type UpdateRoomInput = Prisma.RoomUpdateInput
export type UpdateParticipantInput = Prisma.ParticipantUpdateInput
export type UpdateCompileJobInput = Prisma.CompileJobUpdateInput

// Cursor position type
export interface CursorPosition {
  lineNumber: number
  column: number
}

// Compile options type
export interface CompileOptions {
  flags: string[]
  timeout: number
  memoryLimit: string
  cpuLimit: string
}

// Job status enum
export enum JobStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  TIMEOUT = 'timeout',
  CANCELLED = 'cancelled'
}

// Snapshot type enum
export enum SnapshotType {
  AUTO = 'auto',
  MANUAL = 'manual',
  BACKUP = 'backup'
}