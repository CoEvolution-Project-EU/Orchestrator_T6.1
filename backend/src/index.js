// index.js starts everything, the file that starts your backend

import dotenv from "dotenv";                        // Load the package that reads .env
import connectDB from "./config/database.js";        // Bring the function that connects to MongoDB
import app from "./app.js";                          // This is your Express server (routes, middleware, etc.)
import { initMinIO } from './config/minio.js'        // MinIO connection for all 5 pools
import { initKafka } from './config/kafka.js'        // Kafka producer for real-time events

// Read my .env file and load variables so you can see process.env.PORT, process.env.MONGODB_URI
// Only load .env file in development, not in production/kubernetes
// In Kubernetes, environment variables come from backend-secret instead
if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: './.env' })
}

// You create a function that will: connect to DB, init services, start server
const startServer = async () => {

  // 1 — MongoDB first (most critical — app cannot work without it)
  // ❌ If DB fails → stop everything with process.exit(1)
  // ✔ Better to fail early than start with no database
  try {
    await connectDB()

    // Handle app errors — if something breaks inside Express → log it
    app.on("error", (error) => {
      console.log("ERROR", error)
      throw error
    })

  } catch (error) {
    console.log("MongoDB connection Failed!!", error)
    process.exit(1)  // stop the whole app if DB fails
  }

  // 2 — MinIO (important but not critical — server can still start without it)
  // Initializes all 5 pool connections and creates buckets if they don't exist
  try {
    await initMinIO()
  } catch (error) {
    console.log("MinIO init failed:", error.message)
    // don't exit — server still works, file uploads will fail gracefully
  }

  // 3 — Kafka (optional — server works without it, events just won't be published)
  // Connects the producer so we can publish events when files are uploaded
  try {
    await initKafka()
  } catch (error) {
    console.log("Kafka init failed:", error.message)
    // don't exit — server still works, partners just won't be notified
  }

  // 4 — Start Express server last (all connections are ready)
  // Use .env PORT or fallback to 4000
  app.listen(process.env.PORT || 4000, () => {
    console.log(`Server is running at port: ${process.env.PORT}`)
  })
}

// Run everything — this actually starts your app
startServer()