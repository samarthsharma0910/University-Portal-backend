require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const bodyParser = require("body-parser");
const session = require("express-session");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

const CSV_FILE = path.join(__dirname, "users.csv");

// Middleware
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
// app.use(express.static(__dirname)); // only if you want to serve static files here

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev_secret_change_me",
    resave: false,
    saveUninitialized: false,
  })
);

app.use(passport.initialize());
app.use(passport.session());

// Passport config
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:
        process.env.GOOGLE_CALLBACK_URL ||
        "http://localhost:3000/auth/google/callback",
    },
    (accessToken, refreshToken, profile, done) => {
      const users = readUsers();
      if (!users.find((u) => u.username === profile.id)) {
        addUser({
          username: profile.id,
          email: profile.emails && profile.emails[0] ? profile.emails[0].value : "",
          password: "",
          role: "student",
        });
      }
      return done(null, profile);
    }
  )
);

// Helper to read CSV
function readUsers() {
  if (!fs.existsSync(CSV_FILE)) return [];
  const data = fs.readFileSync(CSV_FILE, "utf8").trim();
  if (!data) return [];
  return data.split("\n").map((line) => {
    const [username, email, password, role] = line.split(",");
    return { username, email, password, role };
  });
}

// Helper to write a new user
function addUser(user) {
  const safeRole = user.role || "student";
  const line = `${user.username},${user.email},${user.password},${safeRole}\n`;
  fs.appendFileSync(CSV_FILE, line);
}

// SIGNUP route
app.post("/signup", (req, res) => {
  const { username, email, password, role } = req.body;

  if (!username || !email || !password || !role) {
    return res.json({ success: false, message: "All fields are required" });
  }

  const users = readUsers();
  if (users.find((u) => u.username === username)) {
    return res.json({ success: false, message: "Username already exists" });
  }

  addUser({ username, email, password, role });

  if (role === "admin") {
    return res.json({ success: true, redirect: "/admin.html" });
  }

  res.json({ success: true, redirect: "/dashboard.html" });
});

// SIGNIN route
app.post("/signin", (req, res) => {
  const { username, password, role } = req.body;

  if (!username || !password || !role) {
    return res.json({ success: false, message: "All fields are required" });
  }

  // ADMIN LOGIN CHECK
  if (role === "admin") {
    if (username === "admin" && password === "admin123") {
      return res.json({ success: true, redirect: "/admin.html" });
    } else {
      return res.json({ success: false, message: "Invalid admin credentials" });
    }
  }

  // STUDENT LOGIN
  const users = readUsers();
  const user = users.find(
    (u) => u.username === username && u.password === password
  );

  if (!user) {
    return res.json({ success: false, message: "Invalid credentials" });
  }

  return res.json({
    success: true,
    redirect: "/dashboard.html",
  });
});

// GOOGLE AUTH
app.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));

app.get(
  "/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/" }),
  (req, res) => {
    res.redirect("/dashboard.html");
  }
);

// Logout route
app.get("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect("/");
  });
});

// Chat route
app.post("/chat", async (req, res) => {
  const userMessage = req.body.message || "";
  const msg = userMessage.toLowerCase();

  if (msg.includes("error") || msg.includes("issue") || msg.includes("not working")) {
    return res.json({
      reply:
        "It seems like a technical issue. Please contact the Registrar Office in Aryabhatta Block (Basement).",
    });
  }

  if (msg.includes("stress") || msg.includes("anxiety")) {
    return res.json({
      reply:
        "It's okay to feel stressed sometimes. Take a short break, breathe, and focus on one small step at a time 💙",
    });
  }

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "system",
            content: `You are a helpful student assistant. Keep answers short and friendly.`,
          },
          {
            role: "user",
            content: userMessage,
          },
        ],
      }),
    });

    const data = await response.json();
    console.log("GROQ RESPONSE:", data);

    if (!data.choices) {
      console.log("Groq Error:", data);
      return res.json({
        reply: "AI not responding. Try again later.",
      });
    }

    res.json({
      reply: data.choices[0].message.content,
    });
  } catch (err) {
    console.error("Chat error:", err);
    res.json({
      reply: "Server error. Please try again later.",
    });
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
