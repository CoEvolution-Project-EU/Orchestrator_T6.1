// Route = "WHEN someone calls URL"
// Controller = "WHAT we do when that happens"

import { User } from "../models/user.model.js";

//this function may do things that take time, and I want to use await inside it
const registerUser = async (req, res) => {
try {
    const {username, email, password} = req.body

    //basic validation
    if (!username || !email || !password){
        return res.status(400).json({message:"All fields are important !"})
    }


    //check if the user already exist
    const existing = await User.findOne ({ email: email.toLowerCase() });


    if (existing){
        return res.status(400).json({ mesage: "user  alwready exists !"});
    }

    //create a user 
    const user = await  User.create({
        username,
        email: email.toLowerCase(),
        password,
        LoggedIn: false,
    })
    res.status(201).json({
        message: "User Registered",
        user: {id: user._id, email: user.email, username: user.username}
    });
} catch (error) {

    res.status(500).json({message: "internal server error", error: error.message});
}
}

// function login
const loginUser = async (req, res) => {
    try {

        // checking if the user already exist
        const {email, password} = req.body;

        const user = await User.findOne({
            email: email.toLowerCase()
        });

        if(!user) return res.status(400).json({
            message: "User not found"
        })
        
        // compare passwords

        const isMatch = await user.comparePassword(password);
        if(!isMatch) return res.status(400).json({
            message: "Invalid credetials"
        })

        res.status(200).json({
            message: "User logged in",
            user: {
                id: user._id,
                email: user.email,
                username: user.username

            }
        })


    } catch (error) {
        res.status(500).json({
            message: "internal server error"
        })
    }
}

const logoutuser = async (req, res) => {
    try {
        const { email } = req.body;

        const user = await User.findOne({
            email
        });

        if(!user) return res.status(404).json({
            message: "User not found"
        });
         
        res.status(200).json({
            message: "Logout successful"
        });

    } catch (error) {
        res.status(500).json({
            message: "Internal Server Error", error
        });
    }
}


export {
    registerUser,
    loginUser,
    logoutuser
};