//with routes we handle the paths
//Router = mini Express app
//app = whole server, router = small part of server
//You take ONLY the Router tool from Express

import {Router} from "express"; // router is the tool from the express framework
import { logoutuser, loginUser, registerUser } from "../controllers/user.controller.js";


const router = Router();

// So why does .route() exist? 👉 To group multiple methods for the same path
router.route('/register').post(registerUser); // When POST request comes to /register → run registerUser
router.route('/login').post(loginUser); 
router.route('/logout').post(logoutuser);

export default router;