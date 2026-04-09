// app.js = your Express application (your backend “engine”)
// app.js = "the thing that handles requests"
// index.js = "the thing that starts everything"

import express from "express"; //Bring Express into my project

const app = express (); // create an express app

app.use(express.json());

// routes import
import userRouter from './routes/user.routes.js';
import modelsRouter from  './routes/models.routes.js';

// routes declaration , If request starts with /api/v1/users → send it to userRouter
app.use("/api/v1/users", userRouter);
app.use("/api/v1/models", modelsRouter);


//minio
import filesRouter from './routes/files.routes.js'
app.use('/api/v1/files', filesRouter)

// expample route example: http://localhost:4000/api/v1/users/registers

export default app;  //Allow other files to use this app