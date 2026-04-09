//It connects your backend to the database!

import mongoose from "mongoose"; // mongoose = tool to talk to MongoDB


//Create a function to connect to database, async = allows you to use await, this function will run when your app starts
const connectDB = async () => {
    try {
        const connectionInstance = await mongoose.connect
        (`${process.env.MONGODB_URI}`)
        console.log(`\n MongoDB connected !!
            ${connectionInstance.connection.host}`
        );


    } catch (error) {
        console.log("MongoDB connection Failed", error);
        process.exit(1) //Stop the whole app if DB fails
    }
}

export default connectDB; //Makes this function usable in other files