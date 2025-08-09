import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Starting database seed...')

  // Create sample rooms for development
  const sampleRoom1 = await prisma.room.create({
    data: {
      key: 'DEMO123456',
      codeSnapshot: `#include <iostream>
using namespace std;

int main() {
    cout << "Hello, Collaborative World!" << endl;
    return 0;
}`,
      participantCount: 0,
    },
  })

  const sampleRoom2 = await prisma.room.create({
    data: {
      key: 'TEST789012',
      codeSnapshot: `#include <iostream>
#include <vector>
using namespace std;

int main() {
    vector<int> numbers = {1, 2, 3, 4, 5};
    
    for (int num : numbers) {
        cout << num << " ";
    }
    cout << endl;
    
    return 0;
}`,
      participantCount: 0,
    },
  })

  // Create sample participants
  await prisma.participant.create({
    data: {
      roomId: sampleRoom1.id,
      userId: 'dev-user-1',
      userColor: '#3B82F6',
      isActive: false,
    },
  })

  await prisma.participant.create({
    data: {
      roomId: sampleRoom1.id,
      userId: 'dev-user-2',
      userColor: '#EF4444',
      isActive: false,
    },
  })

  // Create sample compile job
  await prisma.compileJob.create({
    data: {
      roomId: sampleRoom1.id,
      userId: 'dev-user-1',
      code: sampleRoom1.codeSnapshot!,
      options: {
        flags: ['-std=c++17', '-O2'],
        timeout: 30000,
        memoryLimit: '128m',
        cpuLimit: '0.5',
      },
      status: 'completed',
      stdout: 'Hello, Collaborative World!\n',
      stderr: '',
      exitCode: 0,
      executionTime: 1250,
      memoryUsed: 2048,
      startedAt: new Date(Date.now() - 5000),
      completedAt: new Date(Date.now() - 3000),
    },
  })

  // Create sample snapshots
  await prisma.roomSnapshot.create({
    data: {
      roomId: sampleRoom1.id,
      content: sampleRoom1.codeSnapshot!,
      snapshotType: 'auto',
    },
  })

  await prisma.roomSnapshot.create({
    data: {
      roomId: sampleRoom2.id,
      content: sampleRoom2.codeSnapshot!,
      snapshotType: 'auto',
    },
  })

  console.log('✅ Database seeded successfully!')
  console.log(`📝 Created rooms:`)
  console.log(`   - ${sampleRoom1.key} (${sampleRoom1.id})`)
  console.log(`   - ${sampleRoom2.key} (${sampleRoom2.id})`)
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error('❌ Seed failed:', e)
    await prisma.$disconnect()
    process.exit(1)
  })