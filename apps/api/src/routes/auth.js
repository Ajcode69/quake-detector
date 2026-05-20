import { Router } from "express";
import crypto from "crypto";
import prisma from "../../../../shared/db/client.js";

const router = Router();

/**
 * POST /api/auth/login
 * Body: { email, password }
 */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    // Hash the incoming password
    const passwordHash = crypto.createHash("sha256").update(password).digest("hex");

    // Check against DB
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || user.password !== passwordHash) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Success
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Login failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
