import { Router } from "express";
import { storage } from "../storage";
import { requireAdmin } from "../middlewares/auth";

export const topicsRouter = Router();

topicsRouter.get("/api/topics", async (_req, res) => {
  try {
    res.json(await storage.getTopics());
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch topics" });
  }
});

topicsRouter.post("/api/admin/topics", requireAdmin, async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ message: "Name is required" });
    const topic = await storage.createTopic(name, description);
    res.status(201).json(topic);
  } catch (err) {
    res.status(500).json({ message: "Failed to create topic" });
  }
});

topicsRouter.put("/api/admin/topics/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const { name, description } = req.body;
    const topic = await storage.updateTopic(id, name, description);
    res.json(topic);
  } catch (err) {
    res.status(500).json({ message: "Failed to update topic" });
  }
});

topicsRouter.delete("/api/admin/topics/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    await storage.deleteTopic(id);
    res.json({ message: "Topic deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete topic" });
  }
});
