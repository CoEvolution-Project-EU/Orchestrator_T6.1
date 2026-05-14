// app.js = your Express application (your backend “engine”)
// app.js = "the thing that handles requests"
// index.js = "the thing that starts everything"
import express from "express"; //Bring Express into my project
import userRouter from './routes/user.routes.js'; // routes import
import modelsRouter from  './routes/models.routes.js';
import filesRouter from './routes/files.routes.js' //minio
import toolsRouter from './routes/tools.routes.js' //minio
import cors from 'cors'
//swagger
import { readFileSync } from 'fs'
import yaml from 'js-yaml'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import swaggerUi from 'swagger-ui-express'


const app = express (); // create an express app

// __dirname equivalent for ES modules
const __dirname = dirname(fileURLToPath(import.meta.url))


// ── Middleware ────────────────────────────────────────────────
app.use(cors())                       
app.use(express.json())

// ── Swagger UI ───────────────────────────────────────────────
const swaggerDoc = yaml.load(
    readFileSync(join(__dirname, '../../docs/swagger.yaml'), 'utf8')
  )
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc))


// ── Routes ───────────────────────────────────────────────────
// routes declaration , If request starts with /api/v1/users → send it to userRouter
app.use("/api/v1/users", userRouter);
app.use("/api/v1/models", modelsRouter);


app.use('/api/v1/files', filesRouter)
app.use('/api/v1/tools', toolsRouter)

// expample route example: http://localhost:4000/api/v1/users/registers

export default app;  //Allow other files to use this app