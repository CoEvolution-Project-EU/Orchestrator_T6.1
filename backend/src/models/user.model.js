//A model is how you define and interact with data in MongoDB
//Model = rules + structure + tool to save data

import mongoose, { Schema } from "mongoose"; 
import bcrypt from "bcrypt";


//Schema =  variable, It stores a schema object, Schema = rules for your data
const userSchema = new Schema(
    {
        username:{
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true, 
            minLength: 1,
            maxLength: 30
        },

        password:{
            type: String,
            required: true,
            minLength: 6,
            maxLength: 50
        },

        email:{
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true
        }

    },
    {
        timestamps: true
    }
)
// before we save any password we need to hash it
// What is .pre(), "Before something happens, run this code"
// "Before saving to database, run this function"
userSchema.pre("save", async function () {
    if (!this.isModified("password")) return;

    this.password = await bcrypt.hash(this.password, 10);
});

// compare the password
// You are adding a function (method) to your schema
userSchema.methods.comparePassword = async function (password) {
    return await bcrypt.compare(password, this.password)
}


// model = tool to talk to DB
export const User = mongoose.model("User",userSchema)