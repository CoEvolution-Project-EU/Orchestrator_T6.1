// index.js starts evything, the file that starts your backend

import dotenv from "dotenv"; //Load the package that reads .env
import connectDB from "./config/database.js"; //Bring the function that connects to MongoDB
import app from "./app.js"; //This is your Express server (routes, middleware, etc.)
import { initMinIO } from './config/minio.js'


//Read my .env file and load variables so you can see process.env.PORT, process.env.MONGODB_URI
dotenv.config({
    path: './.env'
});

//You create a function that will: connect to DB, start server
const startServer = async () => {
    try {
        await initMinIO()
      } catch (error) {
        console.log("MinIO init failed:", error.message)
        // don't exit — server still works without MinIO init
      }
    try {
        await connectDB(); //Wait until MongoDB is connected BEFORE starting server 
                           //why? Because:❌ If server starts without DB → errors later , ✔ Better to fail early

        //Handle app errors , If something breaks inside Express → log it                   
        app.on("error", (error) => {
            console.log("ERROR", error);
            throw error;
            
        });

        //Start server , Start your backend server use .env port or fallback to 8000
        app.listen(process.env.PORT || 8000, () => {
            console.log(`Server is running at port: ${process.env.PORT}`);
        })

    } catch (error) {
        console.log("MongoDB connection Failed!!", error);
        
    }

}

//Run everything, This actually starts your app
startServer();