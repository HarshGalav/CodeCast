#!/usr/bin/env tsx

import { execSync } from 'child_process'
import { checkDatabaseConnection } from '../lib/db'

async function initializeDatabase() {
  console.log('🚀 Initializing database...')

  try {
    // Check if database is accessible
    console.log('📡 Checking database connection...')
    const isConnected = await checkDatabaseConnection()
    
    if (!isConnected) {
      console.error('❌ Cannot connect to database. Please check your DATABASE_URL in .env.local')
      console.log('💡 Make sure PostgreSQL is running and the database exists.')
      process.exit(1)
    }

    console.log('✅ Database connection successful')

    // Push schema to database
    console.log('📋 Pushing schema to database...')
    execSync('npx prisma db push', { stdio: 'inherit' })

    // Generate Prisma client
    console.log('🔧 Generating Prisma client...')
    execSync('npx prisma generate', { stdio: 'inherit' })

    // Run seed data
    console.log('🌱 Seeding database with sample data...')
    execSync('npm run db:seed', { stdio: 'inherit' })

    console.log('🎉 Database initialization complete!')
    console.log('💡 You can now run: npm run dev')
    console.log('🔍 To view your data, run: npm run db:studio')

  } catch (error) {
    console.error('❌ Database initialization failed:', error)
    process.exit(1)
  }
}

// Run if called directly
if (require.main === module) {
  initializeDatabase()
}

export { initializeDatabase }